---
title: 第 17 章：Explain执行计划解读
book: MySQL实战45讲
chapter: SQL优化
event: Explain执行计划解读
sort: 1
chapter_sort: 6
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 17 章：Explain执行计划解读

> 前置知识：第 09 章聚簇索引与二级索引、第 10 章回表与覆盖索引、第 12 章索引失效场景与排查
> 学完你能：①背熟 Explain 12 个字段含义与 type 排序；②30 秒内读完一条 SQL 的执行计划并定位性能瓶颈；③用 Extra 字段判断是否需要优化索引或改写 SQL

## 概念

Explain 是 MySQL 提供的执行计划查看工具，在 SQL 前加 `explain` 关键字就能看到优化器打算怎么执行这条语句，不真正执行。它是排查慢查询的第一把工具，也是面试高频考点。

林晓斌在《MySQL 实战 45 讲》第 10 讲"MySQL 为什么有时候会选错索引"里反复用 Explain 来佐证优化器的选择，第 18 讲"为什么这些 SQL 语句逻辑一样，性能却差很大"更是直接对比两条逻辑等价 SQL 的 Explain 差异，说明执行计划才是性能的真相。

Explain 输出 12 列，但真正影响判断的就 4-5 列：`type`、`key`、`rows`、`Extra`，外加 `key_len` 用来判断联合索引用了几列。把这几列读熟，足以应对 80% 的慢查询排查。

## 原理

### 12 个字段速览

| 字段 | 含义 | 重点关注 |
|---|---|---|
| `id` | 查询编号，越大越先执行 | 子查询/JOIN 多行时看执行顺序 |
| `select_type` | 查询类型（SIMPLE/PRIMARY/SUBQUERY 等） | 复杂查询判断 |
| `table` | 表名 | 多表时对应到具体表 |
| `partitions` | 分区表命中分区 | 非分区表为 NULL |
| `type` | 访问类型 | **核心**，决定扫描方式 |
| `possible_keys` | 可能用的索引 | 与 `key` 对比看是否选错 |
| `key` | 实际用的索引 | **核心**，NULL 表示没走索引 |
| `key_len` | 索引使用的字节数 | 判断联合索引用了几列 |
| `ref` | 索引比较的常量或列 | JOIN 时看关联字段 |
| `rows` | 预估扫描行数 | **核心**，越少越好 |
| `filtered` | 过滤后剩余百分比 | 越接近 100 越准 |
| `Extra` | 额外信息 | **核心**，隐藏性能问题 |

### type 字段排序

从好到差：

1. `system`：表只有一行（系统表）
2. `const`：主键或唯一索引等值查询，最多命中一行
3. `eq_ref`：JOIN 时被驱动表用主键或唯一索引等值匹配，最多一行
4. `ref`：普通索引等值匹配，可能多行
5. `range`：索引范围扫描（`between`、`>`、`in`）
6. `index`：扫描整棵索引树（比 `ALL` 好，因为索引比数据小）
7. `ALL`：全表扫描，最差

口诀：`const` > `eq_ref` > `ref` > `range` > `index` > `ALL`。生产环境底线是 `range`，看到 `ALL` 基本要优化（小表例外）。

### key_len 计算

`key_len` 表示索引实际使用的字节数，用来判断联合索引用了几列。计算规则：

- 字符串类型：`utf8mb4` 下 `char(n)` = `4n` 字节，`varchar(n)` 还要加 2 字节存长度
- 数值类型：`int` = 4，`bigint` = 8
- 日期：`datetime` = 5，`timestamp` = 4
- 允许 NULL 的列额外加 1 字节

例如联合索引 `idx(a int, b varchar(20), c int)`，若 `where a=1 and b='x'` 命中前两列，`key_len = 4 + (20*4+2) = 86`。通过 `key_len` 能验证联合索引是否真正用足，避免"建了索引却没用上"。

### Extra 字段重点

这是性能优化的"提示灯"，常见值按好坏排序：

- `Using index`：覆盖索引，索引包含查询所有列，不回表，**最优**
- `Using where`：server 层过滤，索引层没过滤干净，需回表后过滤
- `Using index condition`：索引下推（ICP），把 where 条件下推到索引层，减少回表
- `Using filesort`：额外排序，**警告**，order by 没用上索引
- `Using temporary`：临时表，**严重警告**，常见于 group by/distinct
- `Using join buffer`：JOIN 用了 BNL/BKA 块嵌套循环，**警告**，被驱动表无可用索引
- `Using MRR`：多范围读优化

林晓斌在第 16 讲"order by 是怎么工作的"里讲得很清楚：`Using filesort` 不一定真的用磁盘文件，可能只是内存排序，但出现就意味着 order by 没走索引。`Using temporary` 同理，临时表可能内存也可能落盘，但出现就要警惕。

### 三种"看似有问题实则正常"的情况

**情况一：type=ALL 但表很小**。配置表、字典表只有几百行，全表扫描比走索引 + 回表还快，优化器选 `ALL` 是合理的。判断标准：`rows` 值本身就小。

**情况二：rows 巨大但 Extra=Using index**。例如 `count(*) from log`，扫描上亿行但走覆盖索引不回表，这种统计类查询本身就是慢的，不是索引问题。

**情况三：type=index 但走覆盖索引**。扫描整棵索引树，但因为覆盖索引不用回表，比 `ALL` 快很多。例如 `select id from T`（id 是主键），`type=index`、`Extra=Using index`，正常。

### 30 秒读 Explain 的流程

拿到一条慢 SQL，按这个顺序看：

1. 看 `type`：是不是 `ALL` 或 `index`？是的话索引可能没建对
2. 看 `key`：是 NULL（没走索引）还是预期之外的索引？
3. 看 `rows`：预估扫描行数是否远大于实际需要返回的行数
4. 看 `Extra`：有没有 `Using filesort`、`Using temporary`、`Using join buffer`
5. 看 `key_len`：联合索引是否用足

### format=json 的进阶用法

MySQL 5.6+ 支持 `explain format=json`，输出更详细的成本估算：`read_cost`（IO 成本）、`eval_cost`（CPU 成本）、`prefix_cost`（前缀成本）。林晓斌在第 10 讲提到，优化器选索引就是比 `prefix_cost`，看 JSON 格式能直接验证选错索引的成本偏差。生产排查疑难选错索引时建议用这个。

## 实践

**面试场景：被问到"Explain 重点看哪些字段"**

回答模板："`type`、`key`、`rows`、`Extra` 四列必看，再加 `key_len` 判断联合索引用了几列。`type` 看访问类型从 `const` 到 `ALL`，生产底线 `range`；`key` 看实际走没走索引；`rows` 看预估扫描行数；`Extra` 看有没有 `Using filesort` 或 `Using temporary`。"

追问"`type=index` 和 `ALL` 区别"：`index` 扫描整棵索引树，`ALL` 扫描整张表数据。索引树比数据小，所以 `index` 快于 `ALL`，但本质都是全扫。`index` 配合覆盖索引时不回表，性能接近范围扫描。

**项目场景：30 秒定位慢查询**

某接口告警，SQL：`select * from order where user_id=123 order by create_time desc limit 10`。Explain 输出 `type=ref`、`key=idx_user_id`、`rows=50000`、`Extra=Using filesort`。

判断：走了 `idx_user_id` 但要排序 50000 行（filesort）。优化：建联合索引 `idx_user_id_create_time(user_id, create_time)`，复测 `type=ref`、`key=idx_user_id_create_time`、`rows=10`、`Extra` 无 filesort，P99 从 800ms 降到 15ms。

**项目场景：JOIN 慢查询**

`select * from order o join user u on o.user_id=u.id where o.status=1`，慢。Explain 两行：驱动表 `order` 的 `type=ALL`、`key=NULL`，被驱动表 `user` 的 `type=eq_ref`、`key=PRIMARY`。

判断：`order` 表全表扫描（`status` 无索引），但 `user` 表 JOIN 走主键是正常的。瓶颈在驱动表 `order`，给 `status` 加索引后，`type=range`、`rows` 从千万级降到百万级。

**SDET 视角：CI/CD SQL 审核门禁**

测试平台对接 SQL 审核工具（如 Yearning、Archery），在 CI 流水线加门禁：扫描代码里的 SQL，自动 Explain，规则包括：`type=ALL` 且 `rows>10000` 直接拒绝上线；`Extra` 含 `Using temporary` 必须人工 review；`key=NULL` 直接拒绝。SDET 负责维护规则库和误报率，让研发改不了但能挡住事故。

**避坑：Explain 的 rows 是估算值**

`rows` 是基于统计信息估算的，不一定准确。林晓斌在第 10 讲强调，InnoDB 采样 8 个数据页估算索引基数，统计信息偏差会导致 `rows` 严重偏离实际。看到 `rows` 异常先 `analyze table` 更新统计信息，再重新 Explain。

**避坑：Explain 不执行 SQL**

Explain 只看计划不真正执行，所以它显示的 `rows` 是估算值，真实执行可能完全不同。排查"Explain 看着没问题但实际慢"的查询，用 `EXPLAIN ANALYZE`（MySQL 8.0.18+，会真正执行 SQL 并输出每步耗时和实际行数）或开启 `performance_schema` 看真实执行统计。

## 速查/自测

**选择题**

1. Explain 的 `type` 字段，下列哪个值性能最好？
   A. `ALL`  B. `index`  C. `ref`  D. `const`

2. `Extra` 字段出现 `Using filesort` 说明什么？
   A. 命中覆盖索引  B. order by 没走索引需额外排序  C. 用了临时表  D. 索引下推

3. 联合索引 `idx(a int, b varchar(20), c int)`，`where a=1 and c=3` 的 `key_len` 是？
   A. 4  B. 8  C. 86  D. 4（只用 a 列，c 不满足最左前缀中间断档）

4. `select id from T`（id 是主键）的 Explain 显示 `type=index`、`Extra=Using index`，正确判断是？
   A. 全表扫描需优化  B. 扫描索引树但覆盖索引不回表，正常  C. 索引失效  D. 临时表

5. `possible_keys` 有值但 `key` 为 NULL，说明？
   A. 优化器估算后放弃索引选了全表扫描  B. 没有可用索引  C. SQL 语法错误  D. 走了主键

**判断题**

6. `type=index` 一定比 `type=ALL` 慢。（  ）
7. `Extra=Using index` 表示命中覆盖索引，不需要回表。（  ）
8. Explain 显示的 `rows` 是真实扫描行数，绝对准确。（  ）
9. 配置表只有 100 行，`type=ALL` 是合理的，不需要优化。（  ）

**简答题**

10. 简述 30 秒读 Explain 的五个步骤。
11. `Using filesort` 和 `Using temporary` 分别在什么场景出现？哪个更严重？

<details>
<summary>参考答案</summary>

1. D  2. B  3. D（c 不满足最左前缀，只用 a 列，key_len=4）  4. B  5. A  6. 错  7. 对  8. 错（估算值，统计信息偏差会失准）  9. 对  10-11. 见"原理"章节
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 10 讲"MySQL 为什么有时候会选错索引"——优化器成本估算与 Explain 解读
- 林晓斌《MySQL 实战 45 讲》第 16 讲"order by 是怎么工作的"——Using filesort 原理
- 林晓斌《MySQL 实战 45 讲》第 18 讲"为什么这些 SQL 语句逻辑一样，性能却差很大"——执行计划差异分析
- 《高性能 MySQL（第 4 版）》第 7 章"索引"——Explain 字段详解
- MySQL 8.0 官方文档"EXPLAIN Output Format"章节
