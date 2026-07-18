---
title: 第 20 章：count函数性能对比
book: MySQL实战45讲
chapter: SQL优化
event: count函数性能对比
sort: 4
chapter_sort: 6
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 20 章：count函数性能对比

> 前置知识：第 09 章聚簇索引与二级索引、第 14 章 InnoDB 与 MyISAM 存储引擎对比、第 17 章 Explain 执行计划解读
> 学完你能：①说清 count(*)、count(1)、count(列) 三者的语义和性能差异；②理解 InnoDB 为什么不维护行数而 MyISAM 维护；③掌握订单总数等"快速 count"的四种替代方案及选型

## 概念

`count(*)`、`count(1)`、`count(列名)` 是面试高频题，也是项目里最容易踩坑的统计查询。三者语义不同、性能不同，网上流传的"`count(1)` 比 `count(*)` 快"是陈年谬误，MySQL 8.0 优化器已将两者等价处理。

林晓斌在《MySQL 实战 45 讲》第 14 讲"count(*) 这么慢，我该怎么办"里把这个问题讲透了：InnoDB 的 `count(*)` 是真的慢，因为它没有维护行数，每次都要选最小的索引扫描一遍。MyISAM 的 `count(*)` 是 O(1) 的，因为表头存了行数——但 MyISAM 不支持事务，生产基本不用。

`count(列名)` 的语义是"统计该列非 NULL 的行数"，比 `count(*)` 多一步判断 NULL，所以更慢。把这三者的语义和性能差异讲清楚，是面试官考察基本功的试金石。

## 原理

### 一、三种 count 的语义

| 写法 | 语义 | 是否统计 NULL |
|---|---|---|
| `count(*)` | 统计总行数 | 统计（含 NULL 行） |
| `count(1)` | 统计总行数（1 是常量，每行都非 NULL） | 统计（含 NULL 行） |
| `count(主键)` | 统计主键非 NULL 行数（主键不可能 NULL） | 统计（主键非 NULL） |
| `count(普通列)` | 统计该列非 NULL 行数 | 不统计 NULL 行 |

核心区别：`count(*)` 和 `count(1)` 统计所有行，`count(列)` 只统计该列非 NULL 的行。所以 `count(列)` 结果可能小于 `count(*)`，取决于列是否有 NULL。

### 二、性能对比

**`count(*)` vs `count(1)`**：MySQL 8.0 优化器对两者等价处理，执行计划完全相同。早期版本（5.7 以前）有人认为 `count(1)` 快，因为 `count(*)` 要解析所有列——这是误传，`count(*)` 早就优化成不解析列值，只数行。

Explain 验证：

```sql
explain select count(*) from orders;
explain select count(1) from orders;
```

两者 `type=index`、`key` 选最小的二级索引、`rows` 相同、`Extra` 相同。MySQL 8.0 甚至在解析阶段就把 `count(1)` 重写为 `count(*)`。

**`count(主键)` vs `count(*)`**：`count(主键)` 略慢于 `count(*)`。InnoDB 走二级索引扫描时，`count(*)` 直接数行不取值，`count(主键)` 要取出主键值判断非 NULL（虽然主键不可能 NULL，但优化器仍要做这步判断）。

**`count(普通列)` vs `count(*)`**：`count(普通列)` 最慢。除了判断 NULL，如果该列不在扫描的索引里，还要回表取列值。

林晓斌在第 14 讲给出明确结论：性能排序 `count(*)` ≈ `count(1)` > `count(主键)` > `count(普通列)`。生产统计行数一律用 `count(*)`。

### 三、InnoDB 为什么不维护行数

MyISAM 在表头 `.MYI` 文件存了行数，`count(*)` 直接读这个值，O(1)。但 MyISAM 不支持事务，没有 MVCC，所有连接看到的行数是一样的。

InnoDB 支持 MVCC，不同事务由于隔离级别和快照不同，看到的行数不同：

- 事务 A 在 RR 隔离级别下，开始时表有 100 行，期间其他事务插入了 50 行，事务 A 的 `count(*)` 仍应返回 100
- 事务 B 在另一时间点开始，看到 150 行

如果 InnoDB 维护一个全局行数，就无法满足 MVCC 的"每个事务看自己的快照"。所以 InnoDB 必须每次扫描索引计算当前事务可见的行数，这是 `count(*)` 慢的根因。

### 四、InnoDB count(*) 的优化：选最小索引

InnoDB 扫描索引计算行数时，优化器会选最小的二级索引（而非聚簇索引），因为二级索引体积小、IO 少。林晓斌在第 14 讲提到这个优化。

```sql
explain select count(*) from orders;
-- type=index, key=idx_status (最小的二级索引), Extra=Using index
```

如果没有二级索引，InnoDB 只能扫描聚簇索引（整张表数据），极慢。所以即使为了 count，也建议表至少有一个二级索引。

### 五、count 的替代方案

#### 方案一：估算值

```sql
show table status like 'orders'\G
-- Rows 字段是估算值，误差 10%-50%
```

InnoDB 的 `Rows` 是基于统计信息估算的，不精确但 O(1)。适用于展示"约 XX 条"的场景，如后台管理列表的总数提示。

#### 方案二：Redis 计数器

```sql
-- 插入时
insert into orders(...) values(...);
-- 触发器或应用层同步更新 Redis
incr orders:count
```

读 count 时直接 `get orders:count`，O(1)。问题：Redis 和 MySQL 不在同一事务，可能出现不一致；删除操作要同步 `decr`，容易漏。需要补偿机制（定时全量校准）。

#### 方案三：汇总表

```sql
create table orders_count (cnt bigint);
-- 定时任务全量 count 后更新
update orders_count set cnt = (select count(*) from orders);
```

读 count 时查汇总表，O(1)。汇总表更新频率取决于业务对实时性的要求：实时性低可每小时更新，实时性高可每分钟更新。这是报表系统的标准做法。

#### 方案四：ES 异步统计

通过 Canal 监听 binlog 同步到 ES，ES 维护 count 聚合。适合已经有 ES 基础设施且需要多维统计的场景。延迟秒级，构建成本高。

### 六、带 where 的 count 优化

`select count(*) from orders where user_id=?` 走 `idx_user_id`，扫描该用户所有订单行计数。如果用户订单多（如几十万），仍慢。

优化思路：

- 建联合索引覆盖 where 条件，扫描索引而非回表
- 高频 count 缓存到 Redis（key 带条件，如 `count:user_id:123`）
- 汇总表按维度预聚合（如 `user_order_count(user_id, cnt)`）

## 实践

**面试场景：被问到"count(*)、count(1)、count(列) 区别"**

回答模板："语义上，`count(*)` 和 `count(1)` 统计所有行，`count(列)` 只统计该列非 NULL 行。性能上，MySQL 8.0 把 `count(*)` 和 `count(1)` 等价处理，执行计划完全一样；`count(主键)` 略慢因为要判断非 NULL；`count(普通列)` 最慢，要判断 NULL 且可能回表。生产用 `count(*)`。"

追问"InnoDB 为什么 count(*) 慢"：InnoDB 支持 MVCC，不同事务看到的行数不同，无法维护全局行数，每次都要扫描索引计算当前事务可见行数。MyISAM 表头存行数所以 O(1)，但不支持事务。

**项目场景：订单列表总数**

电商后台订单列表，每页 20 条要显示总数。原 SQL `select count(*) from orders where status=1` 在 5000 万订单表上耗时 8 秒。

治理：

- 业务上接受估算值，改用 `show table status` 的 Rows 字段（误差可接受）
- 精确总数走汇总表 `order_count_by_status(status, cnt)`，定时任务每 5 分钟更新
- 用户翻页时总数从汇总表读，O(1)

复测 P99 从 8 秒降到 5ms。

**项目场景：用户中心订单数**

用户中心展示"我的订单 123 单"，原 SQL `select count(*) from orders where user_id=?`，大客户有几十万订单，耗时 2 秒。

治理：

- 建汇总表 `user_order_count(user_id, cnt)`，订单创建/删除时事务内同步更新
- 读 count 走汇总表，O(1)
- 定时任务每天凌晨全量校准，防止同步丢失

复测 P99 从 2 秒降到 3ms。

**SDET 视角：count 查询监控**

测试平台对 count 类查询专项监控：

- 单次 count 耗时 > 1 秒告警
- count 扫描行数（Explain 的 rows）> 100 万告警
- count 调用频率异常（如某接口 1 秒内 count 100 次）告警，可能是 N+1 查询

SDET 在压测时关注 count 接口的 QPS 衰减：随着并发增加，count 慢查询锁等待会导致 QPS 断崖下跌，这是容量规划的依据。

**避坑：count(列) 不等于 count(*)**

某统计 SQL `select count(remark) from orders`，研发以为统计订单总数，实际 `remark` 列允许 NULL 且很多订单没填，结果比 `count(*)` 少 30%。根因是语义理解错误，`count(列)` 统计非 NULL 行。改 `count(*)` 修正。

**避坑：show table status 的 Rows 误差大**

`show table status` 的 Rows 是估算值，小表误差小，大表误差可达 50%。某报表显示"约 1.2 亿订单"，实际只有 8000 万，误差 50%。业务对精度有要求时不能用估算值，要走汇总表。

**避坑：Redis 计数器的不一致**

Redis 计数器在 MySQL 主从切换、Redis 故障转移时容易丢计数。某次 Redis 主从切换丢失 10 万计数，导致显示总数比实际少。补偿方案：定时任务每小时全量校准 Redis 计数器，差异超过阈值告警。

## 速查/自测

**选择题**

1. 下列哪个 count 写法统计"该列非 NULL 的行数"？
   A. `count(*)`  B. `count(1)`  C. `count(主键)`  D. `count(普通列)`

2. MySQL 8.0 中 `count(*)` 和 `count(1)` 的性能关系是？
   A. `count(1)` 快得多  B. `count(*)` 快得多  C. 优化器等价处理，性能相同  D. 看表大小决定

3. InnoDB 的 `count(*)` 为什么慢？
   A. 索引设计差  B. MVCC 导致无法维护全局行数，每次扫描索引  C. 没有查询缓存  D. 主键太长

4. `show table status` 的 Rows 字段特点？
   A. 精确值，O(1)  B. 估算值，O(1)，大表误差可达 50%  C. 精确值，慢  D. 估算值，慢

5. MyISAM 的 `count(*)` 为什么是 O(1)？
   A. 用了缓存  B. 表头存了行数  C. 不支持 SQL  D. 没有 MVCC 所以快

**判断题**

6. `count(*)` 会统计值为 NULL 的行。（  ）
7. `count(主键)` 比 `count(*)` 快，因为主键有索引。（  ）
8. InnoDB 的 `count(*)` 会选最小的二级索引扫描以减少 IO。（  ）
9. Redis 计数器和 MySQL 在同一事务内，绝对不会不一致。（  ）

**简答题**

10. 解释 InnoDB 为什么不维护行数而 MyISAM 维护，从 MVCC 角度说明。
11. 列出"快速 count"的四种替代方案及各自适用场景。

<details>
<summary>参考答案</summary>

1. D  2. C  3. B  4. B  5. B  6. 对  7. 错（略慢，要多判断非 NULL）  8. 对  9. 错（不在同一事务，可能不一致）  10-11. 见"原理"章节
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 14 讲"count(*) 这么慢，我该怎么办"——count 性能与替代方案
- 林晓斌《MySQL 实战 45 讲》第 15 讲"答疑解惑：锁、日志与并发"——MVCC 与 count
- 《高性能 MySQL（第 4 版）》第 7 章"索引"——count 优化与汇总表
- 《MySQL 技术内幕：InnoDB 存储引擎》第 6 章"锁"——MVCC 与可见性
- MySQL 8.0 官方文档"Aggregate Functions"与"SHOW TABLE STATUS"章节
