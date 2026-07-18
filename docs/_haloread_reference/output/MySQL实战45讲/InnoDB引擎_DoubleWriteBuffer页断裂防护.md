---
title: 第 24 章：DoubleWriteBuffer 页断裂防护
book: MySQL实战45讲
chapter: InnoDB引擎
event: DoubleWriteBuffer页断裂防护
sort: 3
chapter_sort: 7
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 24 章：DoubleWriteBuffer 页断裂防护

> 前置知识：第 22 章 BufferPool、redo log 的 WAL 机制、InnoDB 页大小 16KB
> 学完你能：① 面试时讲清"页断裂"为什么 redo log 救不了，DoubleWriteBuffer 如何兜底；② 判断哪些场景能关 DoubleWrite、哪些绝不能关

## 概念

DoubleWriteBuffer（双写缓冲）是 InnoDB 用来防"页断裂（partial page write）"的机制。页断裂是指：InnoDB 页是 16KB，但操作系统和磁盘的原子写入单位通常是 4KB（甚至更小扇区）。如果 InnoDB 正把一个脏页写到数据文件，写到一半机器断电，这个页就半新半旧——这叫页断裂。

为什么这事儿严重？因为 redo log 救不了。redo log 是物理日志，记录"页 X 偏移 Y 改成值 Z"，重放的前提是页本身完整。如果页已经断裂（一半新内容一半旧内容），redo log 没法判断该从哪个基线重放，崩溃恢复就卡死。林晓斌在《MySQL 实战 45 讲》第 12 讲"为什么我的 MySQL 会'抖动'一下"一讲里讲 redo log 刷盘时提到，redo log 重放依赖页的完整性，这就是 DoubleWriteBuffer 存在的意义。

DoubleWriteBuffer 的做法：脏页刷盘前，先把这个页的完整副本写到一块连续的共享表空间（DoubleWrite Buffer 区，默认 2MB，共 64 个连续页 × 16KB），再写到数据文件的实际位置。崩溃后如果发现某页断裂，就从 DoubleWriteBuffer 里恢复出完整页，再用 redo log 重放。

## 原理

### 写盘流程

正常刷脏页的流程：

1. 把脏页从 BufferPool 顺序写到 DoubleWriteBuffer 区（连续 2MB，顺序写很快）
2. 调 `fsync` 把 DoubleWriteBuffer 持久化
3. 把脏页写到各自数据文件的实际位置（随机写）
4. 调 `fsync` 持久化数据文件

关键：第 1 步是顺序写、第 3 步是随机写。DoubleWriteBuffer 这步开销主要是一次顺序写 + `fsync`，相对随机写开销小。

### 双写区的两段结构

默认 2MB 的 DoubleWriteBuffer 分成两段，每段 1MB（各 64 个页槽位中一半）。刷脏时，脏页先顺序写入第一段，写满 1MB 后 `fsync`，再写第二段，再 `fsync`，然后才把页写到数据文件的实际位置。两段交替使用的好处是：当一段正在被后台读取用于恢复时，另一段可以继续接收新的脏页写入，恢复和刷脏不互相阻塞。

在版本演进上，5.7 及之前 DoubleWriteBuffer 位于共享表空间（`ibdata` 文件）。MySQL 8.0.1 起，独立表空间（`innodb_file_per_table=ON`，这也是默认值）模式下，DoubleWriteBuffer 改为独立的 `.dblwr` 文件，不再混在 `ibdata` 里，管理更清晰，也避免了共享表空间膨胀问题。

### 崩溃恢复流程

崩溃后重启，InnoDB 扫描数据文件页：

- 若某页校验和（`checksum`）不对，判定为页断裂
- 去 DoubleWriteBuffer 找该页的完整副本，覆盖回数据文件
- 页恢复完整后，再用 redo log 重放该页的修改

校验和（`checksum`）是判断页是否完整的依据。InnoDB 在每个页头和页尾都存了 `checksum`，页写入时按页内容计算。读页时重新计算并比对头尾两个值，任何一个对不上就说明页在中途被破坏（写了一半）。这个机制比单纯靠 redo log 更底层——redo log 重放前必须先确认基线页有效，`checksum` 就是这个有效性检查。

如果 DoubleWriteBuffer 里的副本也断了怎么办？DoubleWriteBuffer 是连续 2MB 顺序写，断电时要么整块写完要么没写，几乎不会半写；而且即使某页断裂，数据文件里的原页可能是好的（步骤 3 还没开始），可以从数据文件恢复。两层互为兜底。

### 与 redo log 的分工

| 机制 | 解决什么 | 性质 |
|---|---|---|
| redo log | 已提交事务的修改不丢 | 物理日志，可重放 |
| DoubleWriteBuffer | 页本身不损坏 | 页级镜像，保基线 |

redo log 管"修改别丢"，DoubleWriteBuffer 管"页别坏"。两者配合才完整：DoubleWriteBuffer 保证页完整，redo log 在完整页上重放出最新状态。没有 DoubleWriteBuffer，redo log 无基线可重放；没有 redo log，DoubleWriteBuffer 只能恢复到刷盘那一刻，之后的修改丢。

### 配置与版本差异

`innodb_doublewrite` 默认 `ON`，生产基本不开关。MySQL 8.0.1 起引入 `innodb_doublewrite` 的 `DETECT_AND_RECOVER` 模式（默认值），还有 `DETECT_ONLY`（只检测不恢复）和 `OFF`。8.0.20+ 配合 `innodb_dedicated_server` 自动调优时也会保留 DoubleWrite。

## 实践

**面试场景：被问到"DoubleWriteBuffer 和 redo log 什么关系"**

回答模板：①redo log 是物理日志，重放依赖页完整；②页断裂（半写）时 redo log 无基线重放，崩溃恢复失败；③DoubleWriteBuffer 先写一份完整副本到连续 2MB 区，页断裂时用它恢复基线，再让 redo log 重放；④两者分工：DoubleWriteBuffer 保页不坏，redo log 保修改不丢。追问"能不能关 DoubleWrite 省性能"——能关但风险大，只在容忍数据丢失且追求极致性能的场景关，生产不建议。

**项目场景：SSD 时代还要不要 DoubleWrite**

某团队升级到 NVMe SSD 后想关掉 DoubleWrite 省 IO，SDET 提出质疑：①SSD 一样会断电，页断裂风险仍在；②SSD 的原子写单位虽小但 InnoDB 页 16KB 远大于之；③关掉后一旦页断裂，数据文件损坏，只能从备份恢复，RTO 不可接受；④结论保留 DoubleWrite。补充：部分支持原子写的企业级 SSD 配合 `innodb_doublewrite=OFF` 可省开销，但要确认硬件确有原子写保证，普通云盘别碰。SDET 视角：变更前先在测试库用 `kill -9` 模拟断电，验证重启能否正常恢复，别等线上断电才发现。

**避坑：关 DoubleWrite 不是性能银弹**

关掉 DoubleWrite 省的是一次顺序写 + `fsync`，对随机写为主的 OLTP 提升有限（通常 5%-10%），但换来的是崩溃后数据文件可能损坏的致命风险。除非业务能容忍丢数据（如缓存库、可重建的中间表），否则别关。

**避坑：`innodb_doublewrite=OFF` 时备份要更勤**

关掉 DoubleWrite 后，页断裂只能靠备份恢复。SDET 要把备份频率和恢复演练纳入回归测试，确保 RPO 可控。

**教科书做法 vs 生产做法**

| 场景 | 教科书 | 生产 |
|---|---|---|
| DoubleWrite 开关 | 默认开，别关 | 99% 业务保持默认 `ON`；仅缓存库、可重建中间表等容忍丢数据的场景关 |
| SSD 时代 | 性能敏感可关 | 普通云盘绝不能关；确有硬件原子写保证的企业级 SSD 才考虑关，且必须配套断电恢复测试 |
| 崩溃恢复验证 | 重启不报错即可 | SDET 用 `kill -9` 模拟断电后重启，校验关键表 `checksum` 和行数，纳入发布前回归 |
| 备份策略 | 定期全量 | 关 DoubleWrite 的库备份频率加倍，并定期做恢复演练验证 RTO/RPO |

## 速查/自测

**选择题**

1. DoubleWriteBuffer 默认大小是多少？
   A. 1MB  B. 2MB  C. 4MB  D. 16MB

2. 页断裂（partial page write）是指什么？
   A. 整页丢失  B. 页写了一半崩溃，半新半旧  C. 页被锁  D. redo log 写一半

3. 为什么 redo log 救不了页断裂？
   A. redo log 丢了  B. redo log 重放依赖页完整，页坏了无基线  C. redo log 太小  D. redo log 是逻辑日志

4. `innodb_doublewrite` 默认值是？
   A. `OFF`  B. `ON`  C. `DETECT_ONLY`  D. 不存在

5. MySQL 8.0.1 引入的默认 DoubleWrite 模式是？
   A. `OFF`  B. `DETECT_ONLY`  C. `DETECT_AND_RECOVER`  D. `FORCE`

**判断题**

6. SSD 不会发生页断裂，可以关掉 DoubleWrite。（  ）
7. DoubleWriteBuffer 写入是顺序写，开销相对小。（  ）
8. 关掉 DoubleWrite 后，崩溃恢复完全依赖 redo log。（  ）

**简答题**

9. 说明 DoubleWriteBuffer 和 redo log 在崩溃恢复中的分工与配合。
10. 什么场景可以考虑关闭 DoubleWrite？关闭后要补什么保障？

<details>
<summary>参考答案</summary>

1. B  2. B  3. B  4. B  5. C  6. 错（SSD 也会断电）  7. 对（连续 2MB 顺序写）  8. 错（页断裂时 redo log 无基线，靠备份）  9-10. 见"原理"与"实践"章节
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 12 讲"为什么我的 MySQL 会'抖动'一下"——redo log 刷盘与崩溃恢复
- 林晓斌《MySQL 实战 45 讲》第 08 讲"事务到底是隔离的还是不隔离的"——崩溃恢复与事务状态
- 姜承尧《MySQL 技术内幕：InnoDB 存储引擎》第 2 章 Doublewrite
- MySQL 8.0 官方文档 Doublewrite Buffer
