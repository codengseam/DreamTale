---
title: 第 21 章：索引下推ICP与MRR
book: MySQL实战45讲
chapter: SQL优化
event: 索引下推ICP与MRR
sort: 5
chapter_sort: 6
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 21 章：索引下推ICP与MRR

> 前置知识：第 10 章回表与覆盖索引、第 11 章联合索引最左前缀、第 17 章 Explain 执行计划解读
> 学完你能：①讲清 ICP 索引下推的工作原理与触发条件；②区分 MRR 多范围读和 BKA 批量键访问的适用场景；③对比 NLJ、BNL、BKA 三种 JOIN 算法的执行流程

## 概念

ICP（Index Condition Pushdown，索引下推）和 MRR（Multi-Range Read，多范围读）是 MySQL 5.6 引入的两个重要优化，都是减少回表代价。林晓斌在《MySQL 实战 45 讲》第 18 讲"为什么这些 SQL 语句逻辑一样，性能却差很大"里用 ICP 解释了"同样逻辑的 SQL 性能差几倍"的现象，ICP 是否启用直接决定回表次数。

ICP 的核心思想：把 `where` 条件中"能用索引判断的部分"下推到存储引擎层，在索引层先过滤，减少回表次数。MRR 的核心思想：把回表的随机 IO 转成顺序 IO，提升范围查询性能。BKA（Batched Key Access）是 MRR 在 JOIN 场景的扩展，批量回表。三者都是 InnoDB 层优化，对应用透明，但理解它们能解释 Explain 输出中 `Using index condition`、`Using MRR`、`Using join buffer` 的含义。

## 原理

### 一、ICP 索引下推

#### 没有 ICP 的执行流程

表结构：`user(name varchar(20), age int, addr varchar(100))`，联合索引 `idx_name_age(name, age)`。

```sql
select * from user where name like '张%' and age > 18 and addr like '%北京%';
```

联合索引 `idx_name_age(name, age)` 的最左前缀只能用到 `name like '张%'`（前缀匹配），`age > 18` 由于 `like` 是范围查询，按最左前缀规则 `age` 部分用不上索引。

没有 ICP 时：

1. 走 `idx_name_age` 找到所有 `name like '张%'` 的记录（假设 10 万条）
2. 每条都回表查完整行
3. 在 server 层用 `age > 18 and addr like '%北京%'` 过滤
4. 返回满足条件的记录（假设 100 条）

回表 10 万次，绝大多数回表是浪费的——回表后才发现 `age` 或 `addr` 不满足。

#### 有 ICP 的执行流程

ICP 把 `where` 条件中"能用索引判断的部分"下推到存储引擎层。`age` 在联合索引 `idx_name_age` 里，可以在索引层判断：

1. 走 `idx_name_age` 找到 `name like '张%'` 的记录（10 万条）
2. **在索引层用 `age > 18` 过滤**（剩余 1 万条）
3. 只对 1 万条回表
4. 在 server 层用 `addr like '%北京%'` 过滤（`addr` 不在索引，无法下推）
5. 返回 100 条

回表从 10 万次降到 1 万次，性能提升 10 倍。

Explain 启用 ICP 后 `Extra` 显示 `Using index condition`。未启用显示 `Using where`（server 层过滤）。

#### ICP 触发条件

- MySQL 5.6+，InnoDB 和 MyISAM 都支持
- `where` 条件中有列在索引里（联合索引的非首列，或覆盖索引）
- 不是 `between`、`is null` 等少数不支持的场景
- 子查询、存储函数、触发条件不满足时不启用

#### 开关参数

```sql
set optimizer_switch='index_condition_pushdown=on';  -- 默认 on
```

生产环境默认开启，不要关闭。林晓斌在第 18 讲强调，ICP 是"零成本优化"，只要 SQL 写法允许就会自动启用。

### 二、MRR 多范围读

#### 问题：回表的随机 IO

范围查询 `select * from orders where id between 1000 and 2000` 走主键索引扫描，回表是顺序的（主键有序）。但走二级索引范围查询时：

```sql
select * from orders where user_id between 100 and 200;
-- 走 idx_user_id 二级索引
```

二级索引 `idx_user_id` 返回的主键 id 是无序的（按 user_id 排序，主键穿插其中），回表时是随机 IO。机械盘上随机 IO 比顺序 IO 慢 100 倍，SSD 上也有几倍差距。

#### MRR 的优化

MRR 把回表的随机 IO 转成顺序 IO：

1. 走二级索引 `idx_user_id` 拿到一批主键 id
2. **在内存里对主键 id 排序**
3. 按排序后的 id 顺序回表（变成顺序 IO）
4. 利用 InnoDB 的 Buffer Pool 预读和聚簇索引的局部性

Explain 启用 MRR 后 `Extra` 显示 `Using MRR`。

#### MRR 适用场景

二级索引范围查询 + 回表场景。机械盘效果显著（随机转顺序），SSD 效果较小；数据量大、回表多时收益明显。

#### 开关参数

```sql
set optimizer_switch='mrr=on';
set optimizer_switch='mrr_cost_based=off';  -- 关闭成本估算强制启用
```

`mrr` 默认 on，但 `mrr_cost_based` 默认 on（优化器按成本决定是否启用）。优化器有时估算 MRR 排序成本高于随机 IO 收益，就不启用。强制启用设 `mrr_cost_based=off`，但不一定每次都快，需测试。

### 三、BKA 批量键访问

BKA 是 MRR 在 JOIN 场景的扩展，结合 NLJ 和 MRR：

#### NLJ（Nested Loop Join）回顾

```sql
select * from t1 join t2 on t1.id = t2.t1_id where t1.name = 'x';
```

NLJ 流程：

1. 遍历驱动表 t1（满足条件的行）
2. 对每行，用 `t1.id` 去被驱动表 t2 查（走 `t2.t1_id` 索引）
3. 每次 JOIN 一行就回表一次

如果驱动表返回 1 万行，被驱动表回表 1 万次，随机 IO。

#### BKA 优化

BKA 把驱动表的主键批量收集，用 MRR 排序后批量回表：

1. 遍历驱动表 t1，收集一批 `t1.id`（如 100 个）
2. 对这 100 个 id 排序
3. 一次性去被驱动表 t2 批量回表（顺序 IO）
4. 重复直到驱动表遍历完

回表从"1 万次随机 IO"变成"100 次批量顺序 IO"。

#### 开关参数

```sql
set optimizer_switch='batched_key_access=on';  -- 默认 off
```

BKA 默认关闭，因为优化器对成本估算保守。需配合 `mrr=on`、`mrr_cost_based=off` 使用。

### 四、NLJ vs BNL vs BKA 对比

| 算法 | 全称 | 适用场景 | 被驱动表索引 | Extra 提示 |
|---|---|---|---|---|
| NLJ | Nested Loop Join | 被驱动表有索引，小批量 JOIN | 有 | 无 |
| BNL | Block Nested Loop | 被驱动表无索引，用 join_buffer | 无 | `Using join buffer` |
| BKA | Batched Key Access | 被驱动表有索引 + MRR 批量回表 | 有 | `Using join buffer` + `Using MRR` |

- **NLJ**：默认 JOIN 算法，被驱动表走索引逐行回表
- **BNL**：被驱动表无索引时，把驱动表结果放 `join_buffer`，被驱动表全表扫描逐行比对，减少被驱动表扫描次数
- **BKA**：NLJ + MRR，批量回表，减少随机 IO

林晓斌在第 18 讲提到，JOIN 优化的核心是"小表驱动大表 + 被驱动表走索引"。BNL 是被驱动表无索引的兜底方案，性能差；BKA 是被驱动表有索引时的进阶优化。

### 五、Hash Join（MySQL 8.0.18+）

MySQL 8.0.18 引入 Hash Join 替代 BNL，扫描小表构建 hash 表放内存，再扫描大表逐行匹配，不需要被驱动表有索引，性能优于 BNL。MySQL 8.0.20 起完全移除 BNL，等值 JOIN 全部用 Hash Join。

## 实践

**面试场景：被问到"什么是索引下推"**

回答模板："ICP 是 MySQL 5.6 引入的优化，把 where 条件中能用索引判断的部分下推到存储引擎层，在索引层先过滤再回表。典型场景是联合索引 `idx(a, b)`，`where a like 'x%' and b > 1`，`a` 走范围扫描后，`b` 虽然不满足最左前缀但能下推到索引层判断，减少回表次数。Explain 显示 `Using index condition`。"

追问"ICP 和覆盖索引区别"：覆盖索引是查询列都在索引里完全不回表，是设计层面；ICP 是减少回表次数仍要回表，是执行层面优化。

**项目场景：like + 范围查询 ICP 提速**

某查询 `select * from user where name like '张%' and age between 20 and 30`，联合索引 `idx_name_age(name, age)`。表 1000 万行，`name like '张%'` 命中 50 万行。无 ICP 时 50 万次回表耗时 6 秒；有 ICP（`age` 下推到索引层）索引层过滤后 5 万行回表 5 万次，耗时 1.2 秒，提升 5 倍。

验证 Explain：`Extra=Using index condition`。若显示 `Using where` 说明 ICP 未启用，检查 `optimizer_switch`。

**项目场景：MRR 加速范围查询**

日志查询 `select * from log where user_id between 100 and 200 and create_time > '2026-06-01'`，走 `idx_user_id` 二级索引。表 10 亿行，命中 50 万行。无 MRR 时 50 万次随机回表，机械盘耗时 30 秒；开启 MRR 主键排序后批量回表，耗时 8 秒。SSD 上提升较小（30 秒到 20 秒）。

**项目场景：BKA 优化大表 JOIN**

订单表 JOIN 用户表：`select * from orders o join user u on o.user_id = u.id where o.status = 1`，`orders` 5000 万行，命中 100 万行。NLJ 100 万次回表 `user` 表耗时 40 秒；开启 BKA（`batched_key_access=on, mrr=on, mrr_cost_based=off`）批量回表，耗时 12 秒，提升 3 倍。

**SDET 视角：ICP/MRR 启用验证**

测试平台对接线上 SQL 审计：走二级索引范围查询但 `Extra` 无 `Using index condition` 或 `Using MRR`，标记为"潜在可优化"；JOIN 查询 `Extra` 含 `Using join buffer`（BNL）告警，建议加被驱动表索引或升级 MySQL 8.0 用 Hash Join；CI 流水线自动 Explain 并对比优化前后 `rows` 和 `Extra` 变化。SDET 维护"ICP 触发条件 checklist"，帮助研发判断 SQL 写法是否触发 ICP。

**避坑：ICP 不是万能**

ICP 只能下推"索引列上的条件"。`addr like '%北京%'` 这种列不在索引的条件无法下推，仍要回表判断。期望 ICP 解决所有 where 过滤是误解。MRR 在 SSD 上收益有限（机械盘 100 倍，SSD 仅 1.5-2 倍），不要盲目强制开启，按测试结果决定。

**避坑：BKA 默认关闭有原因**

BKA 需配合 MRR 且 `mrr_cost_based=off` 才稳定启用。优化器默认保守不开 BKA，因为排序开销在某些场景反而拖慢。开启前必须压测，不能想当然。

## 速查/自测

**选择题**

1. ICP 的核心作用是？
   A. 完全避免回表  B. 把 where 条件下推到索引层过滤，减少回表次数  C. 加快排序  D. 替代覆盖索引

2. 下列哪个 Explain 的 Extra 值表示 ICP 已启用？
   A. `Using index`  B. `Using where`  C. `Using index condition`  D. `Using filesort`

3. MRR 优化的本质是？
   A. 减少扫描行数  B. 把回表的随机 IO 转成顺序 IO  C. 增加缓存  D. 关闭事务

4. NLJ、BNL、BKA 的关系，下列哪个正确？
   A. BNL 是 BKA 的优化版  B. BKA 是 NLJ + MRR 的批量回表优化  C. NLJ 用于无索引 JOIN  D. BKA 不需要被驱动表索引

5. MySQL 8.0.20 起，被驱动表无索引的 JOIN 用什么算法？
   A. BNL  B. Hash Join  C. NLJ  D. BKA

**判断题**

6. ICP 可以把 `where` 中所有条件下推到索引层。（  ）
7. 覆盖索引不需要 ICP，因为它根本不回表。（  ）
8. MRR 在机械盘上效果比 SSD 更显著。（  ）
9. BKA 默认开启，无需手动配置。（  ）

**简答题**

10. 用联合索引 `idx(name, age)` 和 SQL `where name like '张%' and age > 18` 说明 ICP 启用前后的回表次数差异。
11. 对比 NLJ、BNL、BKA 三种 JOIN 算法的适用场景和性能特点。

<details>
<summary>参考答案</summary>

1. B  2. C  3. B  4. B  5. B  6. 错（只能下推索引列上的条件）  7. 对  8. 对  9. 错（默认 off，需配合 mrr 开启）  10-11. 见"原理"章节
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 18 讲"为什么这些 SQL 语句逻辑一样，性能却差很大"——ICP 与执行计划差异
- 林晓斌《MySQL 实战 45 讲》第 10 讲"MySQL 为什么有时候会选错索引"——优化器与索引选择
- 《高性能 MySQL（第 4 版）》第 7 章"索引"——ICP、MRR、BKA 特性详解
- 《MySQL 技术内幕：InnoDB 存储引擎》第 8 章"索引"——ICP 与 MRR 实现
- MySQL 8.0 官方文档"Index Condition Pushdown"、"Multi-Range Read Optimization"、"Batched Key Access"章节
