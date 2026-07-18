---
title: 第 07 章：RR 如何避免幻读
book: MySQL实战45讲
chapter: 事务与MVCC
event: RR如何避免幻读
sort: 3
chapter_sort: 3
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 07 章：RR 如何避免幻读

> 前置知识：第 05 章隔离级别、第 06 章 MVCC 原理
> 学完你能：①讲清 RR 下快照读与当前读分别如何应对幻读 ②手推 Next-Key Lock 加锁范围 ③识别幻读的边界漏洞并给出工程规避

## 概念

幻读（Phantom Read）的严格定义：同一事务内，按相同条件两次查询，后一次出现了前一次没有的行，且这些新行是其他事务新插入的（不是已有行的修改）。林晓斌在《MySQL 实战 45 讲》第 20 讲特别强调：幻读专指"新插入的行"，已有行的修改属于不可重复读。

一个关键认知：在 InnoDB 的 RR 下，幻读只在当前读场景才可能出现。快照读走 MVCC，事务内复用同一 ReadView，其他事务新插入的行 trx_id 大于 ReadView 的 max_trx_id，按可见性规则不可见——所以快照读不会幻读。

那么幻读为什么还是个问题？因为业务里很多场景必须用当前读（如先查再改、对账加锁），这时 MVCC 不生效，需要另一套机制——锁。

## 原理

### 快照读：靠 MVCC 天然规避

RR 下事务首次快照读生成 ReadView 后整个事务复用。其他事务插入的新行 trx_id 一定大于该 ReadView 的 max_trx_id，按可见性规则不可见。所以普通 SELECT 在 RR 下不会出现幻读。

### 当前读：靠 Next-Key Lock

当前读必须读到最新已提交版本，无法靠 MVCC 规避新插入。InnoDB 的方案是 Next-Key Lock，它由两部分组成：

- Record Lock（行锁）：锁住索引上的一条记录
- Gap Lock（间隙锁）：锁住两个索引记录之间的空隙，防止插入

Next-Key Lock 是前开后闭区间，如 `(5, 10]` 表示 5 到 10 的间隙加 10 这一行。这样既锁住已有行，又锁住前后间隙，新事务无法往间隙里插入，从而杜绝幻读。

### Next-Key Lock 加锁规则

林晓斌在第 21 讲总结了加锁的两条原则、两条优化、一个 bug：

**原则一**：加锁基本单位是 next-key lock（前开后闭）。
**原则二**：查找过程中访问到的对象才会加锁（覆盖索引可能不锁主键索引）。

**优化一**：唯一索引等值查询，命中记录时退化为行锁（不需要间隙，唯一性已保证不会有重复插入）。
**优化二**：等值查询向右遍历，最后一个不满足条件的值，next-key 退化为间隙锁。

**一个 bug**：唯一索引范围查询会多锁第一个不满足条件的值。

举例：表 t 有 id（主键）数据 0, 5, 10, 15, 20, 25。

```sql
-- 唯一索引等值命中：只锁 id=10 这一行
SELECT * FROM t WHERE id=10 FOR UPDATE;

-- 等值不命中，向右遍历到 15，退化为间隙锁 (10,15)
SELECT * FROM t WHERE id=7 FOR UPDATE;

-- 唯一索引范围：id>10 and id<=15 锁 (10,15]，因 bug 会多锁 (15,20]
SELECT * FROM t WHERE id>10 AND id<=15 FOR UPDATE;
```

需要提醒的是，上述加锁规则适用版本为 MySQL 5.x ≤ 5.7.24、8.0 ≤ 8.0.13，后续版本可能调整加锁策略，线上排查以实际版本行为为准。

### 间隙锁的特性与代价

间隙锁有几个反直觉的特性需要记牢：

- 间隙锁之间**不冲突**，只与"往间隙中插入记录"这个操作冲突
- 间隙锁在 RC 下不生效（这也是 RC 仍有幻读的原因）
- 间隙锁会显著降低并发度，并可能引发死锁

死锁典型场景：

```
A: SELECT * FROM t WHERE id=9 FOR UPDATE;  -- 加间隙锁 (5,10)
B: SELECT * FROM t WHERE id=9 FOR UPDATE;  -- 间隙锁不冲突，也加 (5,10) 成功
B: INSERT INTO t VALUES(9,9,9);            -- 被 A 的间隙锁阻塞
A: INSERT INTO t VALUES(9,9,9);            -- 被 B 的间隙锁阻塞 → 死锁
```

根因在于间隙锁只防插入、不互斥，导致双方都能加锁成功、却都在插入时被对方阻塞。

## 实践

### 幻读的边界漏洞

即使有 MVCC + Next-Key Lock，RR 下仍存在一类绕过 MVCC 的"伪幻读"。林晓斌在第 08 讲指出：

事务 A 在 RR 下用快照读看不到事务 B 新插入的行。但如果 A 对这行做了 UPDATE（当前读触发的更新），该行的 `DB_TRX_ID` 会被改成 A 的事务 ID，于是这行对 A 变得可见——A 再快照读就能看到原本看不见的行，出现"幻读"。

```sql
-- A: BEGIN; SELECT * FROM t WHERE id=1;  -- 看不到 id=1（B 还没插入或刚插入未提交）
-- B: INSERT INTO t VALUES(1,...); COMMIT;
-- A: UPDATE t SET ... WHERE id=1;        -- 当前读，A 更新了它，trx_id 变成 A
-- A: SELECT * FROM t WHERE id=1;         -- 现在能看到了 → 伪幻读
```

根因：UPDATE 是当前读，会"接管"那行，使其 trx_id 变为当前事务，绕过 MVCC 可见性判断。这是 RR 下 MVCC 与当前读混用时的固有边界。

### 工程规避

针对上述漏洞和生产场景，给出三条建议：

1. **关键业务用 `SELECT ... FOR UPDATE` 显式加锁**。对账、扣减库存、防重等场景，先当前读加锁再操作，把 MVCC 不保护的并发交给 Next-Key Lock。
2. **删除/更新加 `LIMIT`**。林晓斌第 21 讲案例七表明，`DELETE FROM t WHERE c=10 LIMIT 2` 比 `DELETE FROM t WHERE c=10` 锁范围小得多，limit 提前终止向右遍历，访问到的记录更少。
3. **高并发写场景考虑降级到 RC**。RC 无间隙锁，锁范围小、死锁少，但必须配 `binlog_format=ROW` 保证复制一致性。代价是放弃可重复读，需在业务层用乐观锁或显式加锁补齐。

### 锁范围排查

线上遇到锁等待，用以下手段定位：

```sql
-- MySQL 8.0 查看当前锁
SELECT * FROM performance_schema.data_locks;
SELECT * FROM performance_schema.data_lock_waits;

-- 查看事务
SELECT * FROM information_schema.innodb_trx;
```

MySQL 8.0 用 `performance_schema.data_locks` 替代了 5.7 的 `information_schema.innodb_locks`，能直接看到锁的具体类型（RECORD / GAP / NEXT-KEY）和锁定的区间，排查 next-key 范围比 5.7 直观很多。

## 速查/自测

### 速查表

| 读类型 | 幻读防护 | 机制 |
|---|---|---|
| 快照读（普通 SELECT） | 天然规避 | MVCC + ReadView 复用 |
| 当前读（FOR UPDATE 等） | Next-Key Lock | 行锁 + 间隙锁 |

### 自测题

1. 为什么 RR 下快照读不会幻读，当前读会？
2. Next-Key Lock 由哪两部分组成？为什么唯一索引等值命中会退化为行锁？
3. 间隙锁之间为什么互不冲突？这会带来什么风险？
4. 事务 A 用 UPDATE 更新了一行原本对它不可见的记录，会发生什么？为什么？
5. 同样的删除语句，加 `LIMIT 2` 后锁范围为什么会变小？

### 参考答案要点

1. 快照读复用 ReadView，新行 trx_id > max_trx_id 不可见；当前读读最新已提交，新插入可见，需靠锁防插入。
2. Record Lock + Gap Lock；唯一索引等值命中时唯一性已保证不会有重复插入，间隙锁多余。
3. 间隙锁防的是"插入"，两个事务都想阻止同一间隙被插入，目标一致不冲突；但会导致双方各自插入时互相阻塞，引发死锁。
4. UPDATE 是当前读，会把该行 trx_id 改为 A 的 ID，A 后续快照读就可见该行，出现伪幻读。
5. LIMIT 提前终止向右遍历，减少访问到的记录数，按"原则二访问到才加锁"，锁范围缩小。

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 20 讲"幻读是什么，幻读有什么问题"、第 21 讲"为什么我只改一行的语句，锁这么多"、第 08 讲"事务到底是隔离的还是不隔离的"
- MySQL 8.0 官方文档 InnoDB Locking 章节
