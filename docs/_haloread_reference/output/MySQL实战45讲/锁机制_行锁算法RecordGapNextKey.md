---
title: 第 16 章：行锁算法 Record Gap NextKey
book: MySQL实战45讲
chapter: 锁机制
event: 行锁算法RecordGapNextKey
sort: 3
chapter_sort: 5
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 16 章：行锁算法 Record Gap NextKey

> 前置知识：B+ 树索引、RR/RC 隔离级别、幻读概念、两阶段锁协议
> 学完你能：① 说清 Record/Gap/NextKey 三种锁算法及退化规则 ② 分析"改一行锁多行"的根因并优化

## 概念

InnoDB 在 RR（Repeatable Read，可重复读）隔离级别下，行锁有三种算法。这是 MySQL 默认隔离级别下锁行为的核心，也是面试高频考点。

**Record Lock（记录锁）**：锁定索引上的单条记录。命中唯一索引等值查询时退化为此锁。

**Gap Lock（间隙锁）**：锁定索引记录之间的间隙，但不锁记录本身，开区间 `(a, b)`。作用是防止其他事务向间隙里插入新记录，从而解决幻读。间隙锁的关键特性是**间隙锁之间不互斥**——两个事务可以同时持有同一间隙的 GapLock，但任何插入操作都会被间隙锁阻塞。

**Next-Key Lock（临键锁）**：RecordLock + GapLock，左开右闭区间 `(a, b]`。这是 InnoDB 在 RR 下的默认行锁算法。每条索引记录都有"前一个间隙 + 自身记录"的 NextKeyLock。

举例：表 t 有 id 为 5、10、15、20 的记录，NextKeyLock 划分为 `(-∞, 5]`、`(5, 10]`、`(10, 15]`、`(15, 20]`、`(20, +∞]`。

## 原理

林晓斌在《MySQL 实战 45 讲》第 21 讲总结了 RR 下加锁规则，可概括为"两个原则、两个优化、一个 bug"。这套规则是分析"锁为什么这么大"的核心工具。

**两个原则**

原则一：加锁的基本单位是 NextKeyLock，前开后闭区间。
原则二：查找过程中访问到的对象才会加锁。

**两个优化**

优化一：唯一索引等值查询，命中记录时，NextKeyLock 退化为 RecordLock。
优化二：等值查询向右遍历，最后一个不满足条件的值，NextKeyLock 退化为 GapLock。

**一个 bug**

唯一索引范围查询会多锁一个不满足条件的值（向右多扫一个 NextKeyLock）。这是历史实现，林晓斌标注适用版本为 MySQL 5.x ≤ 5.7.24、8.0 ≤ 8.0.13，后续版本可能调整。

**不同索引类型下的加锁规则**

| 查询类型 | 索引类型 | 加锁结果 |
|---|---|---|
| 等值命中 | 唯一索引 | RecordLock（仅该行） |
| 等值不命中 | 唯一索引 | GapLock（命中间隙） |
| 等值命中 | 非唯一索引 | NextKeyLock + 后一个 Gap |
| 范围查询 | 唯一索引 | 多锁到第一个不满足条件的值 |
| 范围查询 | 非唯一索引 | 完整 NextKeyLock，无退化 |

唯一索引等值命中退化为 RecordLock 的原因：唯一索引保证了该值唯一，不需要再锁间隙防止插入相同值。非唯一索引没有这个保证，相同值可以有多条，必须锁住后续间隙防止幻读。

**覆盖索引的影响**

原则二说"访问到的对象才加锁"。如果查询字段都在二级索引里（覆盖索引），就不需要回表，主键索引上不加锁。`SELECT ... LOCK IN SHARE MODE` 在覆盖索引场景只锁二级索引；而 `FOR UPDATE` 不论是否覆盖，都会锁主键索引（语义上等同于要更新）。林晓斌在第 21 讲案例二专门讲过这个差异，业务侧用错语句会多锁主键索引，影响并发。

## 实践

**案例一：改一行锁多行**

表 t 数据：`(0,0,0)、(5,5,5)、(10,10,10)、(15,15,15)、(20,20,20)`，id 主键，c 普通索引。

```sql
-- session A
BEGIN;
SELECT * FROM t WHERE c = 10 FOR UPDATE;
```

这条语句看起来只动 c=10 一行，实际锁了：

- 二级索引 c 上：`(5, 10]` 的 NextKeyLock + `(10, 15]` 的 GapLock
- 主键索引上：id=10 的 RecordLock

为什么锁到 `(10, 15]`？因为非唯一索引等值查询要向右遍历，扫到 c=15 不满足条件，按优化二退化为 GapLock。为什么锁 `(5, 10]`？这是 c=10 这条记录本身的 NextKeyLock。

后果是 session B 执行 `INSERT INTO t VALUES(8,8,8)` 会被阻塞，因为 8 落在 `(5, 10)` 间隙里。业务侧的感受是"我只更新一行，怎么别人插不进去数据"。

**案例二：limit 减小锁范围**

```sql
DELETE FROM t WHERE c = 10 LIMIT 2;
```

加了 `LIMIT 2` 后，扫描到两条记录就停止，向右不再遍历，锁范围比无 limit 时小很多。生产环境批量删除/更新加 limit 是基本操作，既控制锁范围也控制单次事务大小。

**案例三：间隙锁引发的死锁**

```
session A: SELECT * FROM t WHERE id = 9 FOR UPDATE;  -- 加 GapLock (5, 10)
session B: SELECT * FROM t WHERE id = 9 FOR UPDATE;  -- 也加 GapLock (5, 10)，不冲突
session B: INSERT INTO t VALUES(9,9,9);              -- 被 A 的 GapLock 阻塞
session A: INSERT INTO t VALUES(9,9,9);              -- 被 B 的 GapLock 阻塞
-- 死锁
```

根因是间隙锁之间不互斥，但插入操作会被间隙锁阻塞，形成"互相阻塞"的局面。这类死锁无法靠统一加锁顺序避免，是 RR 隔离级别下间隙锁的固有代价。林晓斌在第 20 讲专门讲过这个场景。

**案例四：RC 消除间隙锁**

切到 RC（Read Committed，读提交）隔离级别，间隙锁失效，只保留 RecordLock。锁范围大幅缩小，并发度提升，但代价是失去防幻读能力。多数互联网业务选 RC + `binlog_format=row`，林晓斌在第 20 讲提过这个权衡。

**实操验证加锁范围**

MySQL 8.0 用 `performance_schema.data_locks` 直接查：

```sql
SELECT index_name, lock_type, lock_mode, lock_data, lock_status
FROM performance_schema.data_locks
WHERE object_name = 't';
```

5.7 用 `SHOW ENGINE INNODB STATUS` 的 `TRANSACTIONS` 段，信息密度低于 8.0 的结构化输出。

## 速查/自测

**退化规则速记**

- 唯一索引 + 等值 + 命中 → RecordLock
- 唯一索引 + 等值 + 不命中 → GapLock
- 非唯一索引 + 等值 + 命中 → NextKeyLock + 后一 Gap
- 范围查询 → 锁到第一个不满足条件的值

**自测题**

1. NextKeyLock 的区间是开闭如何？为什么这么设计？
2. 唯一索引等值命中为什么能退化为 RecordLock？
3. 非唯一索引等值查询为什么要向右多锁一个间隙？
4. 间隙锁之间为什么不互斥？这个设计带来什么副作用？
5. `SELECT ... FOR UPDATE` 和 `LOCK IN SHARE MODE` 在覆盖索引场景锁范围一样吗？
6. RC 隔离级别下还有 GapLock 吗？业务怎么选 RC 还是 RR？

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 20 讲 幻读是什么，幻读有什么问题
- 林晓斌《MySQL 实战 45 讲》第 21 讲 为什么我只改一行的语句，锁这么多
- 林晓斌《MySQL 实战 45 讲》第 40 讲 insert 语句的锁为什么这么多
- 姜承尧《MySQL 技术内幕：InnoDB 存储引擎》第 6 章 InnoDB 锁算法
- MySQL 8.0 官方文档 InnoDB Locking：dev.mysql.com/doc/refman/8.0/en/innodb-locking.html
