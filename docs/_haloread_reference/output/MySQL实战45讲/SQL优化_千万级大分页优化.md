---
title: 第 19 章：千万级大分页优化
book: MySQL实战45讲
chapter: SQL优化
event: 千万级大分页优化
sort: 3
chapter_sort: 6
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 19 章：千万级大分页优化

> 前置知识：第 10 章回表与覆盖索引、第 11 章联合索引最左前缀、第 17 章 Explain 执行计划解读
> 学完你能：①说清 `limit 1000000,10` 为什么慢的根因；②掌握主键分页、延迟关联、游标分页三种优化方案及适用场景；③压测深分页接口并验证 P99 延迟达标

## 概念

深分页是指 `limit offset, n` 中 offset 很大的场景，典型如 `limit 1000000, 10`——用户翻到第 10 万页。表面看只返回 10 行，实际 MySQL 要扫描 1000010 行后丢弃前 100 万行，只返回最后 10 行。扫描成本和回表成本都白白浪费在前 100 万行上。

林晓斌在《MySQL 实战 45 讲》第 18 讲"为什么这些 SQL 语句逻辑一样，性能却差很大"里举过类似例子：同样返回 10 行，写法不同性能差几个数量级，核心就是扫描行数和回表次数的差异。

深分页的根因是 `limit offset, n` 的语义：必须先拿到前 offset+n 行才能丢掉前 offset 行。优化思路就是绕过"扫描后丢弃"——要么用主键定位起点（主键分页），要么先用覆盖索引拿到目标行的主键再回表（延迟关联），要么彻底改用游标翻页。

## 原理

### 一、问题复现

```sql
select * from orders order by id limit 1000000, 10;
```

执行流程：

1. 走主键索引扫描前 1000010 行
2. 对每一行回表（聚簇索引本身就是数据，无需回表，但若走二级索引排序则需回表）
3. 丢弃前 100 万行
4. 返回最后 10 行

如果是二级索引排序的场景：

```sql
select * from orders order by create_time desc limit 1000000, 10;
```

执行流程更糟：

1. 走 `idx_create_time` 扫描 1000010 行
2. 每行回表查完整数据（100 万次回表）
3. 丢弃前 100 万行
4. 返回 10 行

100 万次随机回表是深分页慢的根因。Explain 显示 `type=index`、`rows=1000010`、`Extra` 无 `Using index`，典型深分页特征。

### 二、方案一：主键分页（自增主键场景）

```sql
select * from orders where id > 1000000 order by id limit 10;
```

利用自增主键的连续性，`where id > 1000000` 直接定位起点，只扫描 10 行。`type=range`、`rows=10`，性能从秒级降到毫秒级。

**限制**：

- 只适用于自增主键且按主键排序
- 中间不能有删除（id 不连续时空洞会导致页码错位）
- 无法跳页（只能"下一页"，不能直接跳到第 5 万页）

### 三、方案二：延迟关联

```sql
select * from orders o
join (
  select id from orders order by create_time desc limit 1000000, 10
) t on o.id = t.id;
```

执行流程：

1. 子查询 `select id from orders ... limit 1000000, 10` 走 `idx_create_time`，覆盖索引不回表，扫描 1000010 行但只取主键，速度快
2. 拿到 10 个主键后，JOIN 走主键等值查询（`eq_ref`），只回表 10 次

核心思想：把"扫描 100 万行回表"降级为"扫描 100 万行取主键 + 回表 10 次"。子查询覆盖索引扫描比回表快一个数量级（索引比数据小，顺序 IO）。

Explain 对比：

| 方案 | type | rows | Extra |
|---|---|---|---|
| 直接 limit | `index` | 1000010 | `Using filesort` |
| 延迟关联子查询 | `index` | 1000010 | `Using index` |
| 延迟关联外层 | `eq_ref` | 10 | - |

延迟关联适用于"必须按非主键排序 + 必须跳页"的场景，是深分页最常用的方案。

### 四、方案三：游标分页（cursor pagination）

```sql
-- 第一页
select * from orders order by create_time desc, id desc limit 10;
-- 假设最后一条记录的 create_time=2026-06-27 10:00:00, id=987654

-- 下一页
select * from orders
where create_time < '2026-06-27 10:00:00'
   or (create_time = '2026-06-27 10:00:00' and id < 987654)
order by create_time desc, id desc limit 10;
```

用上一页最后一条记录的排序字段值作为下一页的查询起点，每次只扫描 10 行。`type=range`、`rows=10`，性能最优。

**适用场景**：移动端无限滚动列表、消息流、日志查看。这类场景不需要跳页，只需"下一页"。

**限制**：

- 不能跳页（无法直接到第 5 万页）
- 排序字段必须有索引，且索引要包含游标查询的所有列（否则走不了索引）
- 排序字段值重复时要加第二排序键（如 id）保证游标唯一

### 五、方案四：覆盖索引 + 延迟关联组合

针对"查询列多 + 排序字段非主键"的极端场景，先建覆盖索引再延迟关联：

```sql
-- 建覆盖索引（包含查询需要的所有列）
alter table orders add index idx_cover(create_time, id, user_id, amount);

-- 延迟关联但子查询走覆盖索引
select user_id, amount from orders o
join (
  select id from orders order by create_time desc limit 1000000, 10
) t on o.id = t.id;
```

子查询走 `idx_cover`，外层 JOIN 走主键，全程不回表。这种方案索引体积大，写入有损耗，适用于读多写少的报表场景。

### 六、方案对比

| 方案 | 扫描行数 | 回表次数 | 能跳页 | 适用场景 |
|---|---|---|---|---|
| 直接 limit | 100万+ | 100万 | 能 | 不推荐 |
| 主键分页 | 10 | 0 | 不能 | 自增主键、顺序翻页 |
| 延迟关联 | 100万+ | 10 | 能 | 通用，最常用 |
| 游标分页 | 10 | 10 | 不能 | 无限滚动列表 |
| 覆盖索引+延迟关联 | 100万+ | 0 | 能 | 读多写少报表 |

### 七、count 配合分页的优化

深分页常伴随 `select count(*)` 慢的问题。前端展示总页数时不要每页都 count，建议：估算值（`show table status`）+ Redis 缓存 + 异步刷新。或干脆不显示总页数，只显示"上一页/下一页"。

## 实践

**面试场景：被问到"limit 深分页怎么优化"**

回答模板："深分页慢的根因是扫描 offset+n 行后丢弃前 offset 行，回表浪费。三种方案：第一，主键分页，`where id > 上次最大 ID limit 10`，只适用于自增主键且不能跳页；第二，延迟关联，子查询走覆盖索引拿主键再 JOIN 回表，通用方案；第三，游标分页，用上一页最后记录的排序值作为下一页起点，无限滚动场景最优。"

追问"延迟关联为什么快"：子查询 `select id` 走覆盖索引不回表，扫描 100 万行只取主键，速度比回表快一个数量级；外层 JOIN 用主键等值查询，只回表 10 次。把"100 万次回表"降级为"10 次回表"。

**项目场景：订单列表深分页**

某 SDET 平台订单列表接口，用户翻到第 8 万页时 P99 达 6 秒。SQL：`select * from orders where user_id=? order by id desc limit 800000, 10`。Explain `type=ref`（走 `idx_user_id`）、`rows=800010`、`Extra` 无 `Using index`，800 万次回表。

治理：改延迟关联 `select * from orders o join (select id from orders where user_id=? order by id desc limit 800000, 10) t on o.id=t.id`，子查询建联合索引 `idx_user_id_id(user_id, id)` 走覆盖索引。复测 P99 从 6 秒降到 200ms。

**项目场景：消息流改游标分页**

IM 系统消息列表原用 `limit offset, 20`，深翻页慢。业务上用户只往下翻不跳页，改游标分页：`where (create_time, id) < (上次时间, 上次 ID) order by create_time desc, id desc limit 20`，建联合索引 `idx_create_time_id`。P99 从 3 秒降到 20ms，且不随页深增加。

**SDET 视角：深分页压测**

测试平台对分页接口设计专项压测用例：

- 浅翻页：第 1、10、100 页，验证基础性能
- 深翻页：第 1万、10万、50万 页，验证优化效果
- 边界：最后一页、超出总页数、offset=0

压测指标：P99 延迟（深翻页应 < 500ms）、错误率、QPS 衰减比（深翻页 QPS 不应断崖下跌）。SDET 在 CI 加回归：每次 SQL 变更跑深分页压测，P99 退化超过 20% 阻断上线。

**避坑：延迟关联不是万能**

延迟关联子查询仍扫描 100 万行，offset 越大越慢。当 offset 到千万级，延迟关联也会到秒级。最终方案是限制最大翻页深度（如产品上禁止翻到第 1 万页以后）+ 游标分页兜底。

**避坑：order by rand() 的深分页陷阱**

`select * from orders order by rand() limit 10` 看似只返回 10 行，实际要给全表生成随机数排序，扫描全表 + filesort。林晓斌在第 17 讲"如何正确地显示随机消息"专门讲过这个，正确做法是用 `where id >= (select max(id) * rand() from T) limit 10`。

## 速查/自测

**选择题**

1. `select * from T order by create_time desc limit 1000000, 10` 慢的根因是？
   A. 返回 10 行太多  B. 扫描 1000010 行且 100 万次回表  C. order by 语法错误  D. 没有主键

2. 下列哪种方案不能跳页？
   A. 直接 limit  B. 主键分页 `where id > 上次 ID`  C. 延迟关联  D. 覆盖索引 + 延迟关联

3. 延迟关联为什么快？
   A. 子查询走覆盖索引不回表，外层 JOIN 只回表 10 次  B. 用了缓存  C. 关闭了事务  D. 主键变短了

4. 游标分页的游标字段要求是？
   A. 必须是主键  B. 必须有索引且值唯一（或加第二排序键）  C. 必须是字符串  D. 必须允许 NULL

5. 下列哪个场景最适合游标分页？
   A. 后台管理列表需要跳页  B. 移动端消息流无限滚动  C. 报表导出  D. 全表统计

**判断题**

6. 主键分页适用于"用户直接跳转到第 5 万页"的场景。（  ）
7. 延迟关联的子查询必须用覆盖索引，否则优化效果有限。（  ）
8. `order by rand()` 配合 limit 是高效随机取数方案。（  ）
9. 游标分页每次只扫描 limit 行数，性能不随页深增加。（  ）

**简答题**

10. 对比主键分页、延迟关联、游标分页三种方案的适用场景和限制。
11. 为什么延迟关联子查询 `select id` 比直接 `select *` 快？覆盖索引在这里起什么作用？

<details>
<summary>参考答案</summary>

1. B  2. B  3. A  4. B  5. B  6. 错（主键分页只能顺序翻页不能跳页）  7. 对  8. 错（要全表生成随机数排序，极慢）  9. 对  10-11. 见"原理"章节
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 18 讲"为什么这些 SQL 语句逻辑一样，性能却差很大"——limit 深分页与延迟关联
- 林晓斌《MySQL 实战 45 讲》第 17 讲"如何正确地显示随机消息"——order by rand() 优化
- 《高性能 MySQL（第 4 版）》第 7 章"索引"——延迟关联与游标分页
- MySQL 8.0 官方文档"LIMIT Optimization"章节
- 丁奇《MySQL 实战 45 讲》极客时间课程评论区深分页实战案例
