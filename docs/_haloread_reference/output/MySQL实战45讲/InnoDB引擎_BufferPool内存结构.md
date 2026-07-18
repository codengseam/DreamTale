---
title: 第 22 章：BufferPool 内存结构
book: MySQL实战45讲
chapter: InnoDB引擎
event: BufferPool内存结构
sort: 1
chapter_sort: 7
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 22 章：BufferPool 内存结构

> 前置知识：InnoDB 索引组织表、B+ 树、WAL 机制
> 学完你能：① 面试时画出 BufferPool 的三种链表与改良版 LRU，解释全表扫描为何不冲刷热数据；② 在生产中根据命中率判断是否扩容，定位"MySQL 抖动"的刷脏根因

## 概念

BufferPool 是 InnoDB 在内存里开辟的缓存区，缓存数据页和索引页。InnoDB 访问数据不直接读磁盘，而是先把磁盘上的 16KB 页加载到 BufferPool，再在内存里查找。林晓斌在《MySQL 实战 45 讲》第 12 讲"为什么我的 MySQL 会'抖动'一下"一讲里把 BufferPool 称为 InnoDB 性能的命根子——所有读写都经过它，命中率直接决定数据库快慢。

默认 `innodb_buffer_pool_size` 是 128MB，生产远远不够。生产建议设为物理内存的 50%-70%。一台 64GB 内存的 DB 服务器，BufferPool 通常给到 40GB-48GB，留余量给操作系统、连接池、临时表。

BufferPool 内部按页（16KB）组织，每个页有三种状态：空闲页（`free page`，还没装数据）、干净页（`clean page`，装了数据但没改过）、脏页（`dirty page`，被改过还没刷盘）。

BufferPool 缓存的不只是数据页和索引页，还包括 Undo 页（支撑 MVCC 版本链）、ChangeBuffer、AdaptiveHashIndex、锁信息等。所以它是 InnoDB 内存里最核心的一块，几乎所有读写路径都要经过它，调优时也最先盯它，扩容往往立竿见影。

## 原理

### 三种链表

BufferPool 用三条链表管理这些页：

| 链表 | 作用 | 挂的页 |
|---|---|---|
| `free list` | 空闲页池，新数据页从这里取 | 空闲页 |
| `LRU list` | 最近访问页，决定淘汰谁 | 干净页 + 脏页 |
| `flush list` | 待刷盘的脏页，后台线程处理 | 脏页 |

新页加载流程：从 `free list` 取一个空闲页 → 读磁盘页填进去 → 挂到 `LRU list`。`free list` 耗尽时，InnoDB 从 `LRU list` 尾部淘汰页腾位置；被淘汰的若是脏页，先刷盘再淘汰。

### 改良版 LRU：midpoint 分割

普通 LRU 有个致命问题：一次全表扫描会把整张表所有页读进 BufferPool，把热点数据冲掉，这叫缓冲池污染。InnoDB 用改良版 LRU 解决——把 LRU 分成两段：靠头的 `young` 区存热数据，靠尾的 `old` 区存新进来的页。

新加载的页不插到 LRU 头部，而是插到两段交界处的 `midpoint`。默认 `old` 区占整个 LRU 的 37%（参数 `innodb_old_blocks_pct`，即 5:3 比例），`midpoint` 大致在 5/8 处。

新页进 `old` 区头部后，要满足两个条件才能晋升到 `young` 区头部：①在 `old` 区停留超过 `innodb_old_blocks_time`（默认 1000ms）；②再次被访问。全表扫描的页一般只被访问一次，停留不到 1 秒就被淘汰，不会污染 `young` 区。这是面试高频考点。

### 多实例降低锁竞争

BufferPool 是全局共享的，高并发下所有线程争抢 LRU 链表锁。`innodb_buffer_pool_instances` 把 BufferPool 切成多个独立实例，每个实例有自己的 `free list`、`LRU list`、`flush list`，线程按页哈希分配到实例，减少锁冲突。

MySQL 5.7.5 起，当 `innodb_buffer_pool_size` ≥ 1GB 时 `innodb_buffer_pool_instances` 默认为 1。生产实践：BufferPool 大于 1GB 时建议设为 8 左右，按 CPU 核数和并发量调整，过大反而碎片化。

### flush list 与 checkpoint

`flush list` 上挂的是所有脏页，按脏页最早变脏的顺序排列。后台刷脏线程（page cleaner）从 `flush list` 头部往后刷，保证最老的脏页先落盘。InnoDB 用"LSN（日志序列号）"标记每个页和每条 redo log 的进度，checkpoint 推进表示"此 LSN 之前的脏页都已刷盘"，redo log 中对应部分就可以被覆盖复用。

如果 redo log 写入速度长期快于刷脏速度，redo log 迟早写满，这时 InnoDB 必须停下业务更新，强行同步刷脏把 checkpoint 推过去，业务就卡住——这就是"抖动"。所以 BufferPool 的命中率是读侧指标，刷脏速度是写侧指标，两个都要盯。

### 自适应哈希索引（AHI）

BufferPool 内存里除了数据页，还有一块自适应哈希索引（AdaptiveHashIndex，AHI）。InnoDB 自动监控热点查询模式，如果某些索引页被等值查询高频命中，就在内存里为这些页建哈希索引，把 B+ 树查找降成 O(1) 哈希查找。AHI 默认开启（`innodb_adaptive_hash_index=ON`），由 InnoDB 自治维护，业务无感知。

AHI 不是银弹：高并发下 AHI 自身的读写锁可能成为瓶颈，某些场景关掉反而更快。`SHOW ENGINE INNODB STATUS` 的 `INSERT BUFFER AND ADAPTIVE HASH INDEX` 段能看到 AHI 命中情况，如果 `non-searches/s` 远高于 `searches/s`，说明 AHI 在空转，可以尝试关闭验证。

## 实践

**面试场景：被问到"BufferPool 命中率低怎么排查"**

回答模板：①先 `SHOW ENGINE INNODB STATUS` 看 `Buffer pool hit rate`，确认是否真低；②看 `innodb_buffer_pool_size` 是否只给了默认 128MB，生产至少物理内存 50%；③`EXPLAIN` 检查慢 SQL 是否走索引，全表扫描会疯狂读页冲掉热数据；④看是否有大事务长期占用 Undo 段导致版本链过长。追问"改了 LRU 还会污染吗"——`midpoint` 只能缓解全表扫描，如果扫描的页本身在 `young` 区仍会被访问晋升，关键还是别让全表扫描上生产。

**项目场景：SDET 压测发现命中率 95%**

某次压测前 SDET 用 `SHOW ENGINE INNODB STATUS` 抓到 hit rate 95%，QPS 上不去。排查步骤：①BufferPool 只配了 4GB，物理内存 64GB；②`EXPLAIN` 发现订单查询 SQL 走全表扫描（缺联合索引）；③先加索引让查询走覆盖索引，命中率升到 97%；④再把 BufferPool 扩到 40GB（物理内存 62%），命中率稳定 99.5%，QPS 翻倍。SDET 视角：压测前必须把 `Buffer pool hit rate` 加入监控大盘，低于 99% 报警，而不是等业务反馈慢。

**避坑：`innodb_old_blocks_time` 调优**

有同学为防污染把 `innodb_old_blocks_time` 调到 10 秒，结果正常业务的热点页晋升变慢，命中率反而下降。这个参数默认 1000ms 是经验值，除非确认有特定扫描模式，否则别动。

**避坑：BufferPool 在线调大要预热**

MySQL 5.7+ 支持在线调 `innodb_buffer_pool_size`，但调大后新页是冷的，会有几分钟命中率掉坑。SDET 做容量变更演练时要把这段预热时间算进 SLA，别在业务高峰调。

**教科书做法 vs 生产做法**

| 场景 | 教科书 | 生产 |
|---|---|---|
| BufferPool 大小 | 物理内存 50%-70% | 先压测定命中率拐点，再按 60% 落地，留余量给 OS 和临时表 |
| 实例数 | 8 个 | 按 CPU 核数和并发估算，单实例不低于 1GB，过大碎片化 |
| 预热 | 重启后自然预热 | 5.6+ 用 `innodb_buffer_pool_dump_now` 关机前 dump、启动 `innodb_buffer_pool_load_at_startup=ON` 加载，把冷启动窗口从分钟级压到秒级 |
| 命中率监控 | 看 `hit rate` | 加进监控大盘，低于 99% 报警，同时盯 `young-making rate` 判断晋升是否异常 |

## 速查/自测

**选择题**

1. BufferPool 默认大小是多少？
   A. 64MB  B. 128MB  C. 256MB  D. 1GB

2. 改良版 LRU 中，新加载的页插入到哪个位置？
   A. LRU 头部  B. LRU 尾部  C. `midpoint`  D. `flush list`

3. `innodb_old_blocks_pct` 默认值是多少？
   A. 25  B. 37  C. 50  D. 62

4. 下列哪种页会同时出现在 `LRU list` 和 `flush list` 上？
   A. 空闲页  B. 干净页  C. 脏页  D. 新加载页

5. redo log 写满会导致什么？
   A. 直接丢数据  B. 强制同步刷脏页，业务停顿  C. BufferPool 清空  D. 无影响

**判断题**

6. BufferPool 命中率低于 99% 一定是 BufferPool 太小。（  ）
7. 改良版 LRU 能完全避免全表扫描冲刷热数据。（  ）
8. `innodb_buffer_pool_instances` 越大越好。（  ）

**简答题**

9. 说明 BufferPool 三条链表的协作关系，解释一个页从磁盘到被淘汰的完整生命周期。
10. 为什么 MySQL 偶尔会"抖动"一下？从 BufferPool 和 redo log 角度解释。

<details>
<summary>参考答案</summary>

1. B  2. C  3. B  4. C  5. B  6. 错（也可能是 SQL 没走索引）  7. 错（只能缓解，扫描页本身在 young 区仍会晋升）  8. 错（按并发调，过大碎片化）  9-10. 见"原理"章节
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 12 讲"为什么我的 MySQL 会'抖动'一下"——刷脏与 redo log 配合
- 林晓斌《MySQL 实战 45 讲》第 08 讲"事务到底是隔离的还是不隔离的"——BufferPool 与 MVCC 快照
- 姜承尧《MySQL 技术内幕：InnoDB 存储引擎》第 2 章 InnoDB 内存结构
- MySQL 8.0 官方文档 The InnoDB Buffer Pool
