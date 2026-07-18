---
title: 第 23 章：ChangeBuffer 写优化
book: MySQL实战45讲
chapter: InnoDB引擎
event: ChangeBuffer写优化
sort: 2
chapter_sort: 7
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 23 章：ChangeBuffer 写优化

> 前置知识：第 22 章 BufferPool 内存结构、聚簇索引与二级索引、唯一索引与普通索引差异
> 学完你能：① 面试时讲清 ChangeBuffer 为什么只对非唯一索引生效、为什么唯一索引写更慢；② 在写多读少的日志表场景用普通索引配 ChangeBuffer 拿到 30% 写入提升

## 概念

ChangeBuffer 是 BufferPool 里一块特殊区域，专门缓存"对非唯一二级索引的写操作"。林晓斌在《MySQL 实战 45 讲》第 09 讲"普通索引和唯一索引，应该怎么选择"一讲里详细讲过这个机制：当要更新一个二级索引页，而该页恰好不在 BufferPool 里时，InnoDB 不急着把页从磁盘读进来，而是先把这次修改记在 ChangeBuffer 里，等以后这页被读到内存时再合并（merge）。

大白话：二级索引的写如果"目标页不在内存"，普通索引可以"先记账不读盘"，省一次随机 IO；唯一索引不行，因为必须读页才能判断有没有冲突。

ChangeBuffer 默认占 BufferPool 的 25%，上限 50%，由 `innodb_change_buffer_max_size` 控制（取值 0-50，表示百分比）。它本质上是 BufferPool 的一部分，不是独立内存。早期版本叫 InsertBuffer，5.5 起扩展到支持 delete/purge 后改名 ChangeBuffer，`SHOW ENGINE INNODB STATUS` 里仍能看到 `INSERT BUFFER` 字样，是历史遗留命名。

## 原理

### 写流程对比：普通索引 vs 唯一索引

**普通索引的写**（目标页不在 BufferPool）：
1. 不读磁盘页，直接在 ChangeBuffer 记录"页 X 的位置 Y 要改成值 Z"
2. 写 redo log
3. 完成，返回

后续这页被读到内存时，触发 merge，把 ChangeBuffer 里的修改应用上去，再清掉记录。

**唯一索引的写**（目标页不在 BufferPool）：
1. 必须把目标页从磁盘读进 BufferPool（一次随机 IO）
2. 在内存里检查有没有冲突
3. 没冲突才写入，写 redo log
4. 完成

差异就在第 1 步：唯一索引多一次磁盘读。这就是林晓斌在第 09 讲给出的结论——普通索引的写性能优于唯一索引，根因就是 ChangeBuffer 省了那次读盘。

### 为什么唯一索引用不了 ChangeBuffer

唯一索引必须保证约束：插入或更新前要确认目标值不存在。要做这个判断，必须看到页里现有数据，那就得把页读进内存。既然页都读进来了，直接改就行，没必要再记一笔到 ChangeBuffer。所以 ChangeBuffer 对唯一索引失效是逻辑必然，不是实现缺陷。

### innodb_change_buffering 配置

ChangeBuffer 缓存哪些操作由 `innodb_change_buffering` 控制，取值有 `all`（默认，缓存 insert/delete-mark/purge）、`none`（不缓存）、`inserts`、`deletes`、`changes`（insert+delete-mark）、`purges`。生产一般保持默认 `all`。注意这里说的 delete 是"打删除标记（delete-mark）"，InnoDB 二级索引的删除是先标记、后续 purge 线程物理清理，purge 也能进 ChangeBuffer。

### merge 时机与实现

ChangeBuffer 里的修改不是无限期挂着，以下情况触发 merge：

- 该页被其他查询读到内存（自然合并）
- 后台线程定期 merge
- 数据库关闭时 merge
- ChangeBuffer 空间不足

merge 是异步的，对写入路径零阻塞。但如果 ChangeBuffer 里堆积了大量修改一直没 merge，崩溃恢复时要重做这些操作，恢复时间变长。ChangeBuffer 本身也是通过 redo log 持久化的——写 ChangeBuffer 时也会写 redo log，所以崩溃后 ChangeBuffer 内容不丢，重启后能继续 merge。这点容易被忽略：ChangeBuffer 不是纯内存结构，它有自己的 redo log 保护。

### 适用与不适用

| 场景 | ChangeBuffer 是否有效 |
|---|---|
| 写多读少 + 普通索引 | 有效，写入提升明显 |
| 写后立刻读 | 几乎无效，merge 抵消收益 |
| 唯一索引 | 无效 |
| 聚簇索引（主键） | 无效（主键必读页） |
| 强一致性读多 | 不建议，merge 延迟可能影响读 |

## 实践

**面试场景：被问到"普通索引和唯一索引怎么选"**

回答模板：①查询性能两者几乎一样（唯一索引找到一条就停，普通索引多扫几条，差距 1-2%）；②写入性能普通索引更好，因为 ChangeBuffer 省一次读盘，唯一索引必须读页判重；③业务层能保证唯一（如用 `Redis` 分布式锁或应用层校验）就选普通索引，除非有强一致约束需求才用唯一索引。林晓斌在第 09 讲就是这个结论。追问"ChangeBuffer 为什么对唯一索引无效"——必须读页才能判重，页都读进来了就没必要再记账。

**项目场景：日志表插入调优**

某 SDET 团队负责一张埋点日志表，日均写入 2 亿条，字段含 `user_id`、`event_time`、`event_type`。原来在 `user_id` 上建了唯一索引（防重复上报），QPS 卡在 8000。排查：①`SHOW ENGINE INNODB STATUS` 看 `INSERT BUFFER AND ADAPTIVE HASH INDEX` 段，ChangeBuffer 几乎没用到；②根因是唯一索引强制读页判重；③业务侧改用"上报时带去重 `token` + 普通索引"，重复上报由下游 `Flink` 去重；④`user_id` 索引改成普通索引后 ChangeBuffer 生效，QPS 到 11000，提升约 30%。SDET 视角：压测时盯 `SHOW ENGINE INNODB STATUS` 的 `Ibuf` 段，`inserts` 增长快说明 ChangeBuffer 在干活，`merges` 跟得上说明没堆积。

**避坑：写后立刻读的场景别指望 ChangeBuffer**

某业务写入后立刻查询同一行，发现普通索引反而比唯一索引慢。根因：写完立刻读会触发 merge，把省下的读盘 IO 又补回来了，merge 本身还有开销。这种写读紧耦合场景，ChangeBuffer 收益归零。

**避坑：`innodb_change_buffer_max_size` 别盲目调大**

有人为了写性能把 `innodb_change_buffer_max_size` 调到 50，结果 BufferPool 给 ChangeBuffer 占了一半，留给数据页的少了，命中率掉。这个参数只在"写多读少且二级索引多"时调，默认 25 够用。

**教科书做法 vs 生产做法**

| 场景 | 教科书 | 生产 |
|---|---|---|
| 索引唯一性 | 有唯一语义就建唯一索引 | 业务层保证唯一优先用普通索引，享受 ChangeBuffer；只有强一致约束（如资金账户号）才用唯一索引兜底 |
| ChangeBuffer 占比 | 默认 25% | 日志型业务可调到 30-40，OLTP 保持默认，纯读库直接关 |
| 写后读场景 | 普通索引理论更快 | 写读紧耦合时收益归零，要看实际 merge 频率，别想当然 |
| 监控 | 看 `inserts` | `inserts` 增长快且 `merges` 跟得上才健康，堆积说明读太少、恢复有风险 |

## 速查/自测

**选择题**

1. ChangeBuffer 默认占 BufferPool 的多少？
   A. 10%  B. 25%  C. 50%  D. 75%

2. 下列哪种索引能享受 ChangeBuffer 加速？
   A. 主键索引  B. 唯一索引  C. 普通二级索引  D. 聚簇索引

3. 唯一索引写入比普通索引慢的根因是？
   A. B+ 树结构不同  B. 必须读页判重，用不了 ChangeBuffer  C. 锁更多  D. redo log 更多

4. `innodb_change_buffer_max_size` 的最大值是多少？
   A. 25  B. 50  C. 75  D. 100

5. 以下哪种场景 ChangeBuffer 几乎无效？
   A. 写多读少  B. 写后立刻读  C. 普通索引  D. 日志表插入

**判断题**

6. ChangeBuffer 是独立于 BufferPool 的内存区域。（  ）
7. 唯一索引查询性能显著优于普通索引，应优先选唯一索引。（  ）
8. ChangeBuffer 堆积过多会影响崩溃恢复时间。（  ）

**简答题**

9. 用流程图说明普通索引和唯一索引在"目标页不在 BufferPool"时的写入差异。
10. 什么场景适合用普通索引替代唯一索引？什么场景必须用唯一索引？

<details>
<summary>参考答案</summary>

1. B  2. C  3. B  4. B  5. B  6. 错（是 BufferPool 的一部分）  7. 错（差距很小，业务能保证唯一就选普通索引）  8. 对（崩溃恢复要重做）  9-10. 见"原理"与"实践"章节
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 09 讲"普通索引和唯一索引，应该怎么选择"——ChangeBuffer 机制与索引选型
- 林晓斌《MySQL 实战 45 讲》第 08 讲"事务到底是隔离的还是不隔离的"——二级索引与 MVCC
- 姜承尧《MySQL 技术内幕：InnoDB 存储引擎》第 2 章 Insert Buffer
- MySQL 8.0 官方文档 Change Buffer
