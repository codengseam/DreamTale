---
title: 第 18 章：慢SQL治理流程
book: MySQL实战45讲
chapter: SQL优化
event: 慢SQL治理流程
sort: 2
chapter_sort: 6
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 18 章：慢SQL治理流程

> 前置知识：第 17 章 Explain 执行计划解读、第 12 章索引失效场景与排查
> 学完你能：①搭建慢 SQL 从采集到治理的完整闭环；②用 pt-query-digest 聚合分析慢日志并定位 Top SQL；③在 CI/CD 流水线加 SQL 审核门禁，把慢 SQL 挡在上线前

## 概念

慢 SQL 治理不是"出问题再排查"，而是一套持续运转的闭环：采集 → 监控 → 聚合 → Review → 优化 → 验证。林晓斌在《MySQL 实战 45 讲》第 15 讲"答疑解惑：锁、日志与并发"里反复强调，线上事故的根因多半是几条反复出现的 Top SQL，治理思路就是"找到它们、消灭它们、别让它们再生"。

判断"慢"的标准是 `long_query_time`，默认 10 秒——这个值在生产环境过于宽松。10 秒才告警，业务早就超时了。生产建议设 1 秒，甚至对核心接口设 0.5 秒。慢日志不是越全越好，全量慢日志会拖累 IO，需要在覆盖率和性能间平衡。

治理流程的核心是"闭环"二字：发现慢 SQL 后要追踪到根因、修复、回归验证、纳入监控，形成可复制的 SOP。一次性修一个 SQL 不叫治理，能持续发现并修复新出现的慢 SQL 才叫治理。

## 原理

### 一、慢日志采集

开启慢查询日志：

```sql
set global slow_query_log = ON;
set global long_query_time = 1;
set global log_queries_not_using_indexes = ON;  -- 未走索引的查询也记录
set global slow_query_log_file = '/data/mysql/slow.log';
```

`long_query_time` 默认 10 秒，生产建议 1 秒。`log_queries_not_using_indexes` 开启后，即使查询很快只要没走索引也记录，用于发现"现在数据少不慢、数据多了必慢"的隐患 SQL。

林晓斌在第 14 讲"count(*) 这么慢，我该怎么办"里提到，慢日志会记录扫描行数（`Rows_examined`），这是判断 SQL 效率的关键指标——扫描行数远大于返回行数，说明索引没起作用。

动态参数 `long_query_time` 是 session 级的，`set global` 只对新连接生效，老连接需要重连。线上调整建议用 `set global` + 滚动重启连接池。

### 二、实时监控：show processlist 与 performance_schema

慢日志是事后分析，`show processlist` 是实时看当前所有连接在干什么：

```sql
show processlist;
show full processlist;  -- 显示完整 SQL
kill <id>;              -- 杀掉问题连接
```

重点看 `Time` 列（执行时长）和 `State` 列（当前状态，如 `Sending data`、`Sorting result`、`Waiting for table metadata lock`）。`Time` 异常长的连接要警惕，可能是慢 SQL 锁表或大事务。

`performance_schema` 是 MySQL 5.7+ 内置的性能监控库，比慢日志更细粒度：

```sql
-- 查看耗时最长的 SQL
select digest_text, count_star, avg_timer_wait/1000000000 avg_ms
from performance_schema.events_statements_summary_by_digest
order by avg_timer_wait desc limit 10;
```

它按 SQL 模板（digest）聚合，能直接看到哪类 SQL 平均耗时最长、执行次数最多。`performance_schema` 默认开启，但有 5%-10% 性能损耗，核心库要评估是否全开。

### 三、慢日志聚合：pt-query-digest

Percona Toolkit 的 `pt-query-digest` 是分析慢日志的事实标准：

```bash
pt-query-digest /data/mysql/slow.log > report.txt
```

输出按"累计耗时"排序的 SQL 排行榜，关键指标：

- `Rank`：排名
- `Query ID`：SQL 模板指纹
- `Response time`：累计耗时（占总耗时百分比）
- `Calls`：调用次数
- `R/Call`：平均每次耗时
- `V/M`：方差均值比，反映耗时波动，越大越不稳定

通常 80% 的慢日志耗时集中在 Top 10 SQL 上，治理优先级就是 Top 10。`pt-query-digest` 还能按时间窗口分析（`--since`、`--until`），对比优化前后效果。

### 四、监控告警：Prometheus + mysqld_exporter

`mysqld_exporter` 暴露 MySQL 指标给 Prometheus，关键字段：

- `mysql_global_status_slow_queries`：慢查询累计数，配 rate() 看增长速率
- `mysql_global_status_questions`：总查询数
- 慢查询占比 = `slow_queries / questions`，超过 1% 告警

告警规则示例（PromQL）：`rate(mysql_global_status_slow_queries[5m]) > 0.5` 表示 5 分钟内每秒超过 0.5 次慢查询。

### 五、治理闭环

完整流程：

1. **采集**：慢日志 + `performance_schema` 双通道
2. **监控**：Prometheus 实时告警慢查询数异常
3. **聚合**：每天用 `pt-query-digest` 生成 Top SQL 报表
4. **Review**：DBA + SDET + 研发每周 Review Top 20，分配责任人
5. **优化**：Explain 排查 → 加索引 / 改写 SQL / 拆分大查询
6. **验证**：优化后复测 Explain，监控对应 digest 的 `avg_timer_wait` 下降
7. **回归**：把优化后的 SQL 加进回归测试集，防止改回原样

### 六、CI/CD SQL 审核门禁

把治理前置到上线前。SDET 在 CI 流水线加 SQL 审核环节：

- **静态审核**：用 `sqlcheck`、`soar` 或自研规则扫描 SQL 文本，发现 `select *`、无 where 的 update/delete、隐式类型转换
- **动态审核**：在测试库自动 Explain，规则包括：`type=ALL` 且 `rows>10000` 拒绝；`Extra` 含 `Using temporary` 需人工 review；`key=NULL` 拒绝
- **门禁策略**：阻断上线，研发必须改 SQL 或申请 DBA 例外审批

工具选型：Yearning、Archery 是开源 SQL 审核平台；Soar 是小米开源的 SQL 自动优化建议工具；自研规则最贴合业务但要维护。

## 实践

**面试场景：被问到"线上慢 SQL 怎么治理"**

回答模板："四步闭环。第一步采集，开慢日志 + `log_queries_not_using_indexes`，`long_query_time` 设 1 秒；第二步分析，`pt-query-digest` 聚合慢日志定位 Top 10；第三步优化，Explain 排查走索引情况，加索引或改写 SQL；第四步验证，复测 Explain + Prometheus 监控慢查询数下降。"

追问"`performance_schema` 和慢日志区别"：慢日志是落盘文本，事后分析，粒度到 SQL；`performance_schema` 是内存库，实时细粒度到事件，但重启丢数据。生产建议双开，慢日志做归档，`performance_schema` 做实时监控。

**项目场景：电商大促前的慢 SQL 治理**

大促前两周，SDET 跑全链路压测，导出慢日志用 `pt-query-digest` 分析。Top 1 是 `select * from order where user_id=? and status in (...)`，`type=ALL`、`rows=800万`、平均 4 秒。

治理：建联合索引 `idx_user_id_status(user_id, status)`，复测 `type=range`、`rows=2万`、平均 80ms。把这条 SQL 模板加进 SQL 审核白名单，压测回归通过。

**项目场景：CI 门禁挡住事故**

研发提交 `select * from log where message like '%error%'`，CI 静态审核命中"左模糊"，动态 Explain 显示 `type=ALL`、`rows=10亿`。门禁直接拒绝，要求改用 ES 全文检索。事后证明这条 SQL 上线会把库打挂。

**SDET 视角：监控大盘设计**

测试平台建慢 SQL 大盘，核心指标：

- 慢查询数趋势（按分钟），对比昨日同期
- Top 10 digest 的平均耗时和调用次数
- 慢查询占总查询百分比
- 各业务库慢 SQL 分布

SDET 负责保证大盘数据准确、告警阈值合理（误报率 < 5%），并定期 Review 告警是否有效（有没有"告警疲劳"导致研发忽略）。

**避坑：慢日志开启的 IO 损耗**

慢日志写入是同步 IO，高并发下会拖慢数据库。生产环境若慢 SQL 多，建议：`long_query_time` 不要设太低（0.1 秒以下日志爆炸）；用 `log_output=TABLE` 写 mysql.slow_log 表（内存表，但有锁竞争）；或用 `pt-query-digest --filter` 过滤后再分析。

**避坑：pt-query-digest 的指纹可能合并不同 SQL**

digest 按 SQL 模板归一化，`where id=1` 和 `where id=2` 算同一条。但有时不同业务场景的 SQL 模板相同但性能差异大（参数 selectivity 不同），需要结合 `performance_schema` 的 samples 看具体 SQL 文本。

## 速查/自测

**选择题**

1. `long_query_time` 默认值是多少？生产建议设多少？
   A. 默认 1 秒，生产 10 秒  B. 默认 10 秒，生产 1 秒  C. 默认 5 秒，生产 1 秒  D. 默认 10 秒，生产 0.1 秒

2. `pt-query-digest` 的核心作用是？
   A. 实时杀慢 SQL  B. 聚合慢日志按累计耗时排序  C. 自动加索引  D. 重启 MySQL

3. `performance_schema` 相比慢日志的优势是？
   A. 永久保存  B. 实时细粒度到事件  C. 不占内存  D. 无性能损耗

4. CI/CD SQL 审核门禁，下列哪条规则最合理？
   A. 所有 SQL 都拒绝  B. `type=ALL` 且 `rows>10000` 拒绝  C. 所有 JOIN 拒绝  D. 所有 select 拒绝

5. `log_queries_not_using_indexes=ON` 的作用是？
   A. 禁止未走索引的查询执行  B. 即使查询很快，未走索引也记入慢日志  C. 自动加索引  D. 关闭慢日志

**判断题**

6. `set global long_query_time=1` 立即对当前已存在的连接生效。（  ）
7. `pt-query-digest` 把 `where id=1` 和 `where id=2` 算作同一条 SQL 模板。（  ）
8. `performance_schema` 的数据重启后仍然保留。（  ）
9. 治理慢 SQL 的优先级应按"单次耗时最长"排序，不考虑调用次数。（  ）

**简答题**

10. 描述慢 SQL 治理的完整闭环（6 步）。
11. 为什么生产环境 `long_query_time` 不建议设成 0.1 秒？

<details>
<summary>参考答案</summary>

1. B  2. B  3. B  4. B  5. B  6. 错（session 级参数，老连接需重连）  7. 对  8. 错（内存库，重启丢失）  9. 错（应按累计耗时 = 单次耗时 × 调用次数排序）  10-11. 见"原理"章节
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 14 讲"count(*) 这么慢，我该怎么办"——慢日志 Rows_examined 字段
- 林晓斌《MySQL 实战 45 讲》第 15 讲"答疑解惑：锁、日志与并发"——Top SQL 治理思路
- 《高性能 MySQL（第 4 版）》第 3 章"性能优化"——慢查询日志与 pt-query-digest
- Percona Toolkit 官方文档 pt-query-digest 章节
- MySQL 8.0 官方文档"Performance Schema"章节
