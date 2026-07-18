---
title: 第 32 章：SDET数据库优化案例
book: MySQL实战45讲
chapter: 性能调优与实战
event: SDET数据库优化案例
sort: 5
chapter_sort: 9
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 32 章：SDET数据库优化案例

> 前置知识：Explain、覆盖索引、延迟关联、慢 SQL 监控
> 学完你能：① 用 STAR 法则讲一个数据库优化项目故事 ② 从压测到 SQL 优化到 CI 门禁全链路落地 ③ 把优化成果沉淀成回归测试和监控告警

## 概念

这一篇换个写法，用我（SDET）第一人称讲一个真实做过的数据库优化案例。面试官最爱问"你做过什么数据库优化"，背一堆概念不如讲一个有数据、有过程、有沉淀的故事。这个故事的核心不是"我加了个索引"，而是"SDET 在性能压测中发现瓶颈、定位根因、推动修复、沉淀防护"的完整闭环。

事情起点是一次性能压测。我负责的订单查询接口在新版本压测中 P99 飙到 500ms，而老版本只有 80ms。SDET 的职责不只是报"P99 不达标"，而是要定位到根因并推动修复。这个案例我用了压测、APM 链路追踪、Explain、SQL 改写四步，把 P99 从 500ms 压到 80ms，QPS 从 200 提到 1500，最后还推动团队建了慢 SQL 监控和 CI 审核门禁。

林晓斌在《MySQL 实战 45 讲》第 34 讲"到底可不可以使用 join"和第 35 讲"join 语句怎么优化"两讲里对 JOIN 的使用和优化做了系统讲解，这次优化的 SQL 改写正是用了这两讲里"用覆盖索引和延迟关联替代大分页 `JOIN`"的思路。

## 原理

### 排查过程

第一步，压测发现接口慢。用压测工具对订单列表接口梯度加压，P99 在并发 50 时就到 500ms，且随并发上升急剧恶化，明显不是网络问题，是后端处理慢。

第二步，APM 链路追踪定位到 SQL。看 APM 链路，接口耗时 90% 在一条 SQL 上：

```sql
SELECT o.*, u.user_name, m.merchant_name
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN merchants m ON o.merchant_id = m.id
WHERE o.user_id = ? AND o.status = 1
ORDER BY o.create_time DESC
LIMIT 100000, 20;
```

第三步，`Explain` 看执行计划。`type` 为 `ALL`（全表扫描），`rows` 估算 800 万，`Extra` 含 `Using filesort` 和 `Using temporary`。两个问题：一是 `(user_id, status)` 没有合适的联合索引，走了全表扫描；二是大分页 `LIMIT 100000, 20` 要先扫 10 万行再丢弃，且 `ORDER BY create_time` 触发 `Using filesort`。

第四步，分析 `JOIN` 顺序。优化器选了 `orders` 作为驱动表但没走索引，被驱动表 `users`、`merchants` 每行都要回表。林晓斌在第 35 讲里讲过，`JOIN` 要让小结果集驱动大结果集，且驱动表要走索引。

根因还和团队习惯有关：这张订单表最初按 `user_id` 单列建了索引，后来加了 `status` 过滤条件没同步补联合索引，单列索引在 `status` 上派不上用场，优化器干脆选了全表扫描。这种"索引没跟上业务演进"是慢 SQL 最常见的来源，SDET 在 SQL 审核时要重点盯索引是否覆盖了新加的查询条件。

### 优化方案

第一，加联合索引：

```sql
ALTER TABLE orders ADD INDEX idx_user_create_status (user_id, create_time, status);
```

把 `user_id` 放最左（等值查询），`create_time` 第二（支持 `ORDER BY` 避免 `Using filesort`），`status` 第三。这条索引同时覆盖了 `WHERE`、`ORDER BY`。

第二，改写 SQL 用覆盖索引。原 SQL `SELECT o.*` 要回表取所有字段，改成先用覆盖索引查出主键，再回表：

```sql
SELECT o.* FROM orders o
JOIN (
  SELECT id FROM orders
  WHERE user_id = ? AND status = 1
  ORDER BY create_time DESC LIMIT 100000, 20
) t ON o.id = t.id
JOIN users u ON o.user_id = u.id
JOIN merchants m ON o.merchant_id = m.id;
```

子查询只 `SELECT id`，能完全走 `idx_user_create_status` 覆盖索引，不回表、不产生 `Using filesort`。这就是延迟关联——先通过覆盖索引快速拿到目标主键，再 `JOIN` 回主表取详情。

第三，大分页改延迟关联后，扫描行数从 10 万降到 20。林晓斌在第 37 讲"什么时候会使用内部临时表"里提到，`Using filesort` 和 `Using temporary` 是 CPU 和内存的隐形消耗大户，消除这两个 `Extra` 是 SQL 优化的关键信号。

### 量化效果

| 指标 | 优化前 | 优化后 |
|---|---|---|
| P99 | 500ms | 80ms |
| QPS | 200 | 1500 |
| 数据库 CPU | 80% | 30% |
| `Explain` 的 `rows` | 800 万 | 20 |

## 实践

**SDET 沉淀**

光优化一条 SQL 不算完，SDET 的价值是把单点优化变成团队防护。我做了三件事：

第一，把这条 SQL 加进回归测试。在接口自动化用例里加断言：订单列表接口 P99 小于 100ms，超时即失败。后续任何改动导致 SQL 退化，CI 立刻拦截。后来这套断言又扩展到全量列表接口，每次发布前自动跑一遍，避免一处改动波及多处。

第二，CI/CD 加 SQL 审核门禁。写了个脚本，对提 PR 的 SQL 跑 `Explain`，`type` 为 `ALL` 直接阻断合并。这把"全表扫描"拦在了上线前。

第三，推动团队建慢 SQL 监控告警。`long_query_time` 从默认 10s 调到 1s，慢 SQL 数突增触发企业告警。同时接了 `pt-query-digest` 定期出慢 SQL TOP10 报告。

这套监控上线后第二个月就抓到一次执行计划退化：某次 `ANALYZE TABLE` 没跑，统计信息失准导致优化器选错索引，慢 SQL 数突增触发告警，半小时内回滚。SDET 把"被动救火"变成了"主动预警"，这正是质量左移的价值。

**面试回答模板（STAR）**

Situation：订单查询接口压测 P99 500ms 不达标。
Task：作为 SDET 定位根因并推动修复。
Action：APM 链路定位到多表 `JOIN` SQL，`Explain` 发现 `type` 为 `ALL` 加 `Using filesort` 加大分页；加联合索引 `(user_id, create_time, status)`，改写 SQL 用延迟关联和覆盖索引消除回表与 `Using filesort`。
Result：P99 从 500ms 降到 80ms，QPS 从 200 提到 1500，CPU 从 80% 降到 30%；并沉淀回归测试断言、CI SQL 审核门禁、慢 SQL 监控告警三道防护。

面试官追问"为什么把 `create_time` 放索引第二列？"——因为 `ORDER BY create_time DESC` 要靠索引有序来消除 `Using filesort`，`user_id` 等值查询放最左，`create_time` 第二能让索引直接满足排序，`status` 放第三做范围过滤。

## 速查/自测

**速查表**

| 优化手段 | 解决的问题 |
|---|---|
| 加联合索引 `(user_id, create_time, status)` | 全表扫描 |
| 延迟关联（子查询取 id 再 `JOIN`） | 大分页回表 |
| 覆盖索引 `SELECT id` | 消除回表 |
| 索引有序对齐 `ORDER BY` | 消除 `Using filesort` |
| CI 跑 `Explain` 阻断 `type` 为 `ALL` | 防止退化上线 |

**自测题**

1.（单选）`Explain` 输出 `type` 为 `ALL` 加 `Using filesort`，说明？
A. 走了覆盖索引  B. 全表扫描且需额外排序  C. 索引正常  D. 用了范围查询
<details><summary>参考答案</summary>
B。`ALL` 是全表扫描，`Using filesort` 说明需额外排序，必须加索引或改写 SQL。
</details>

2.（判断）大分页 `LIMIT 100000, 20` 的主要开销在回表取 10 万行字段。
<details><summary>参考答案</summary>
对。`LIMIT 100000, 20` 要先扫描 10 万行，若 `SELECT *` 每行都回表，开销巨大；延迟关联先用覆盖索引取 id 再回表 20 行可消除大部分开销。
</details>

3.（单选）延迟关联的核心思路是？
A. 删除 `JOIN`  B. 子查询用覆盖索引取 id 再 `JOIN` 回主表  C. 加内存  D. 分库分表
<details><summary>参考答案</summary>
B。子查询只 `SELECT id` 走覆盖索引快速定位目标主键，再 `JOIN` 回主表取详情，避免大分页回表。
</details>

4.（判断）`long_query_time` 生产环境建议设为 1s。
<details><summary>参考答案</summary>
对。默认 10s 太宽松，会漏掉大量慢 SQL；生产建议 1s 以便及时捕获性能退化。
</details>

5.（单选）SDET 沉淀 SQL 防护，最有效的是？
A. 手动抽查  B. CI 跑 `Explain` 阻断 `type` 为 `ALL`  C. 加大压测并发  D. 升级硬件
<details><summary>参考答案</summary>
B。CI 门禁把全表扫描拦在上线前，是左移防护；手动抽查不可持续，硬件升级治标不治本。
</details>

简答：用 STAR 法则讲一个你做过的数据库优化案例。
<details><summary>参考答案</summary>
Situation：订单接口压测 P99 500ms。Task：SDET 定位根因推动修复。Action：APM 链路定位多表 `JOIN` SQL，`Explain` 见 `type` 为 `ALL` 加 `Using filesort` 加大分页；加联合索引 `(user_id, create_time, status)`，改写用延迟关联加覆盖索引消除回表和 `Using filesort`。Result：P99 降到 80ms、QPS 从 200 提到 1500、CPU 从 80% 降到 30%，并沉淀回归断言、CI SQL 门禁、慢 SQL 监控三道防护。
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 34 讲 到底可不可以使用 join
- 林晓斌《MySQL 实战 45 讲》第 35 讲 join 语句怎么优化
- 林晓斌《MySQL 实战 45 讲》第 37 讲 什么时候会使用内部临时表
- 施瓦茨等《高性能 MySQL》第 3 章：查询优化与延迟关联
- Percona Toolkit 文档 pt-query-digest
