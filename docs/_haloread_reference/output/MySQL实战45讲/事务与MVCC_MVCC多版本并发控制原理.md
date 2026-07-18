---
title: 第 06 章：MVCC 多版本并发控制原理
book: MySQL实战45讲
chapter: 事务与MVCC
event: MVCC多版本并发控制原理
sort: 2
chapter_sort: 3
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 06 章：MVCC 多版本并发控制原理

> 前置知识：了解事务隔离级别、undo log 与 redo log 的作用
> 学完你能：①讲清 MVCC 三大支柱如何协作 ②手推 ReadView 可见性判断 ③区分快照读与当前读的触发场景

## 概念

MVCC（Multi-Version Concurrency Control，多版本并发控制）是 InnoDB 实现高并发读写的核心机制。它的核心思想是：同一行数据在系统中保留多个历史版本，读操作根据一致性视图访问合适的版本，从而让读写互不阻塞。姜承尧在《MySQL 技术内幕：InnoDB 存储引擎》中将其描述为"无锁并发读"的基础。

MVCC 只在 RC 和 RR 两种隔离级别下生效。RU 不需要 MVCC（直接读最新值），Serializable 用锁替代 MVCC。这意味着 MVCC 解决的是"读写并发"问题，写写并发仍靠锁串行化。

## 原理

MVCC 由三大支柱组成：隐藏字段、undo log 版本链、ReadView。

### 支柱一：三个隐藏字段

InnoDB 给每行数据自动加了三个隐藏字段：

- `DB_ROW_ID`：6 字节，没有主键时 InnoDB 自动生成聚簇索引用
- `DB_TRX_ID`：6 字节，最近一次修改该行的事务 ID（row trx_id）
- `DB_ROLL_PTR`：7 字节，回滚指针，指向该行在 undo log 中的上一版本

其中 `DB_TRX_ID` 和 `DB_ROLL_PTR` 是 MVCC 的关键，前者标记版本，后者串起历史。

### 支柱二：undo log 版本链

每次更新一行，InnoDB 不是原地覆盖旧值，而是：

1. 把旧值写入 undo log，形成一条历史版本记录
2. 在数据页写入新值，新值的 `DB_ROLL_PTR` 指向刚写的 undo log
3. 旧版本的 undo log 同样带有更早的 `DB_ROLL_PTR`，串成链表

于是同一行在逻辑上形成一条版本链：

```
当前页 [trx_id=102, k=22]
   ↑ roll_ptr
undo [trx_id=101, k=11]
   ↑ roll_ptr
undo [trx_id=100, k=10]
```

读到不可见的版本时，沿 `DB_ROLL_PTR` 向历史回溯，直到找到可见版本或链尾。这就是 MVCC 不需要物理拷贝整库数据、却能让每个事务拥有"逻辑快照"的原因。

### 支柱三：ReadView

ReadView（一致性读视图）是判断某个版本是否对当前事务可见的核心数据结构，包含四个关键字段：

- `creator_trx_id`：创建该 ReadView 的事务 ID
- `m_ids`：生成 ReadView 时所有活跃（未提交）事务 ID 列表
- `min_trx_id`：`m_ids` 中的最小值
- `max_trx_id`：生成 ReadView 时系统应分配给下一个事务的 ID（即当前最大事务 ID + 1）

### 可见性判断算法

读到某行时，取该行当前版本的 `DB_TRX_ID` 记为 X，按以下顺序判断：

1. 若 `X == creator_trx_id`：自己改的，可见
2. 若 `X < min_trx_id`：在 ReadView 生成前已提交，可见
3. 若 `X >= max_trx_id`：ReadView 生成后才启动的事务所改，不可见
4. 若 `X in m_ids`：仍活跃未提交，不可见
5. 否则（`min_trx_id <= X < max_trx_id` 且不在 `m_ids`）：已提交，可见

若当前版本不可见，沿 `DB_ROLL_PTR` 找上一版本，重新套用上述规则，直到找到可见版本或回溯到链尾。

记忆口诀：自己改的可见、老事务改的可见、新事务改的不可见、活跃事务改的不可见、都不命中就回溯。

### RC 与 RR 的 ReadView 时机

MVCC 在 RC 和 RR 下的唯一区别就是 ReadView 的生成时机：

- RC：每条快照读语句执行前生成新 ReadView，所以能看到该语句执行前已提交的修改
- RR：事务内首次快照读时生成 ReadView，整个事务复用，保证可重复读

林晓斌在《MySQL 实战 45 讲》第 08 讲用事务 A/B/C 的经典例子说明：RR 下事务 A 启动时视图锁定，后续 B、C 的提交对 A 不可见；RC 下 A 每次查询都刷新视图，能看到 B 已提交的更新。这一处时机差异，决定了 RC 出现不可重复读、RR 不会。

## 实践

### 快照读 vs 当前读

MVCC 只对快照读生效。两类读要分清：

| 类型 | 触发语句 | 是否走 MVCC | 是否加锁 |
|---|---|---|---|
| 快照读 | 普通 `SELECT` | 是 | 否 |
| 当前读 | `UPDATE` / `DELETE` / `INSERT` / `SELECT ... FOR UPDATE` / `SELECT ... LOCK IN SHARE MODE` | 否 | 是 |

**为什么 UPDATE 必须用当前读？** 如果允许在历史版本上更新，会丢失其他事务已提交的修改。比如事务 A 基于旧版本 k=10 更新为 k=20，而事务 B 已经把 k 提交为 k=15，A 的更新会覆盖 B 的成果。当前读保证 UPDATE 总是基于最新已提交版本，避免丢失更新。

### 长事务对 MVCC 的伤害

版本链依赖 undo log 串联。如果一个长事务持有老 ReadView，所有可能被它回溯的 undo log 都不能被 purge 线程清理，undo 表空间持续膨胀。

监控 undo 积压：

```sql
SHOW ENGINE INNODB STATUS\G
```

观察输出 `TRANSACTIONS` 段中的 `History list length`，长期居高不下说明 undo 没被回收，多半是长事务在拖。

### 表结构为什么没有 MVCC

林晓斌提到一个易被忽视的点：表结构（DDL）没有 `DB_TRX_ID`，不支持 MVCC。一个事务内执行 DDL 后，再查表结构拿到的是最新值，而非事务启动时的快照。MySQL 8.0 把表结构放入 InnoDB 数据字典，未来可能支持表结构一致性读，跨版本部署时需注意这个差异。

## 速查/自测

### 速查表

| 隐藏字段 | 作用 |
|---|---|
| `DB_ROW_ID` | 无主键时聚簇索引键 |
| `DB_TRX_ID` | 最近修改事务 ID |
| `DB_ROLL_PTR` | 指向 undo log 上一版本 |

| ReadView 字段 | 含义 |
|---|---|
| `creator_trx_id` | 创建者事务 ID |
| `m_ids` | 活跃事务列表 |
| `min_trx_id` | 活跃事务最小 ID |
| `max_trx_id` | 下一个待分配 ID |

### 自测题

1. MVCC 三大支柱分别是什么？为什么缺一不可？
2. 一行数据的 `DB_TRX_ID = 150`，当前 ReadView 的 `min_trx_id = 100`、`max_trx_id = 200`、`m_ids = [100, 150]`，该版本可见吗？如何找到可见版本？
3. 为什么 UPDATE 必须用当前读而非快照读？
4. RC 和 RR 下 MVCC 行为唯一的区别是什么？
5. 长事务为什么会导致 undo log 膨胀？

### 参考答案要点

1. 隐藏字段（标记版本）、undo log 版本链（保留历史）、ReadView（判断可见性）；缺隐藏字段无法标记版本，缺版本链无法回溯，缺 ReadView 无法判断。
2. 150 在 m_ids 中，不可见；沿 `DB_ROLL_PTR` 回溯 undo log，对每个历史版本重新套用可见性规则。
3. 在历史版本上更新会丢失其他事务已提交的修改；当前读保证基于最新已提交版本。
4. ReadView 生成时机：RC 每条语句生成，RR 事务内首次快照读生成后复用。
5. 老 ReadView 持有不释放，所有可能被回溯的 undo log 都不能被 purge 清理。

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 03 讲"事务隔离"、第 08 讲"事务到底是隔离的还是不隔离的"
- 姜承尧《MySQL 技术内幕：InnoDB 存储引擎》MVCC 相关章节
- MySQL 8.0 官方文档 InnoDB Multi-Versioning 章节
