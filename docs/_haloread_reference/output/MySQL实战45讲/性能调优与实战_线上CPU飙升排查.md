---
title: 第 28 章：线上CPU飙升排查
book: MySQL实战45讲
chapter: 性能调优与实战
event: 线上CPU飙升排查
sort: 1
chapter_sort: 9
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 28 章：线上CPU飙升排查

> 前置知识：InnoDB 行锁、Explain 执行计划、慢查询日志
> 学完你能：① 按四步法在 10 分钟内定位 CPU 飙高根因 ② 区分 MySQL 引起 CPU 飙高的五类原因 ③ 给出杀长事务、加索引、限流降级的处置方案

## 概念

线上 CPU 飙高是 SDET 和 DBA 最常接到的告警之一。监控系统一片飘红，业务方催命式问"是不是数据库挂了"，你必须在最短时间内判断：CPU 飙高到底是不是 MySQL 引起的，如果是，又是哪一类 SQL 或会话在烧 CPU。

MySQL 本身是"重 IO、轻计算"的系统，正常情况下 CPU 不会是瓶颈。一旦 CPU 持续高于 80%，多半是出现了"本该走索引却走了全表扫描""本该几行却扫了几百万行""大量行在等锁导致自旋"这类异常。所以排查 CPU 飙高的核心思路，不是去看 CPU 本身，而是去找"谁在让 MySQL 做大量无用的计算"。

林晓斌在《MySQL 实战 45 讲》第 29 讲"如何判断一个数据库是不是有问题"一讲里给出过一个判断框架：先看操作系统层的 CPU、IO、网络，再看数据库层的会话数、锁等待、慢 SQL，最后定位到具体语句。这个"由外到内、由粗到细"的顺序，是排查任何数据库异常的通用套路。

## 原理

### 排查四步法

第一步，操作系统层定位进程和线程。

```bash
top -c
top -Hp <mysqld_pid>
```

`top -c` 看是不是 `mysqld` 进程占了 CPU。如果是别的进程（比如备份脚本、`pt-query-digest` 离线分析），就不用往数据库方向查。确认是 `mysqld` 后，用 `top -Hp <pid>` 看哪个线程烧 CPU，记下线程号，再转成十六进制，到 `performance_schema.threads` 里反查这个线程正在执行什么 SQL。

第二步，数据库层看会话。

```sql
SHOW PROCESSLIST;
SELECT * FROM information_schema.INNODB_TRX ORDER BY trx_started;
```

`SHOW PROCESSLIST` 一眼能看到当前所有连接在干什么，重点看 `Time` 大、`State` 为 `Sending data`、`Sorting result`、`Waiting for table metadata lock` 的会话。`INNODB_TRX` 按 `trx_started` 升序排，最早开始的事务往往是阻塞源头。

第三步，对慢会话的 SQL 跑 `Explain`。

```sql
EXPLAIN SELECT ...;
```

重点看 `type` 列：`ALL` 是全表扫描，`index` 是全索引扫描，`range` 才算走了范围索引。再看 `rows` 列（估算扫描行数）和 `Extra` 列里的 `Using filesort`、`Using temporary`，这两个出现意味着有额外排序和临时表，CPU 消耗会成倍上升。

第四步，翻慢查询日志看历史。

```bash
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
```

`mysqldumpslow` 按总耗时排序，`pt-query-digest` 能给出更细的指纹化报告。线上突发 CPU 飙高，往往不是新出现的 SQL，而是一条老 SQL 在数据量增长或统计信息失准后执行计划退化。

### 五大常见原因

| 原因 | 典型特征 | 处置方向 |
|---|---|---|
| 全表扫描 | `type` 为 `ALL`，`rows` 远大于实际返回 | 加索引，修正统计信息 |
| 锁等待与死锁检测 | `Threads_running` 高，`innodb_row_lock_waits` 增长 | 杀长事务，热点行打散 |
| 大量临时表排序 | `Extra` 含 `Using filesort` / `Using temporary` | 优化 ORDER BY，加覆盖索引 |
| 触发器或存储过程异常 | 某张表写入触发级联计算 | 拆触发器逻辑到应用层 |
| 连接数打满 | `Threads_connected` 接近 `max_connections` | 收缩连接池，限流降级 |

其中死锁检测的开销最容易被忽略。林晓斌在第 29 讲里提到，`innodb_deadlock_detect` 默认开启，并发线程争抢同一热点行时，每个被阻塞的线程都要遍历等待链判断是否成环，1000 个并发线程的 CPU 开销可达百万量级操作。表现就是 CPU 接近 100%，但 TPS 只有几十。

## 实践

**面试场景**

面试官问："线上 MySQL CPU 100%，你怎么排查？"

回答模板："我会分四步。第一步 `top -c` 确认是 `mysqld` 占 CPU，再 `top -Hp` 定位到具体线程，转十六进制反查 SQL。第二步 `SHOW PROCESSLIST` 和 `INNODB_TRX` 看长会话和长事务。第三步对慢 SQL 跑 `Explain`，重点看 `type`、`rows`、`Extra`。第四步用 `mysqldumpslow` 或 `pt-query-digest` 分析慢日志，看是不是执行计划退化。定位到根因后，紧急用 `KILL` 杀长事务止血，再补索引或限流根治。"

追问"如果 `SHOW PROCESSLIST` 里全是 `Waiting for table metadata lock` 呢？"——这是 MDL 锁阻塞，说明有大事务或未提交事务占着表元数据锁，第一个要查的就是 `INNODB_TRX` 里最早开始的那个事务，`KILL` 掉它就能恢复。

**项目场景**

一次营销活动上线后，订单查询接口 P99 从 50ms 飙到 3s，监控显示 MySQL 主库 CPU 持续 100%。按四步法排查：`top -Hp` 发现某线程持续高 CPU，反查到一条 `SELECT * FROM order WHERE mobile = '...'`；`Explain` 看到 `type` 为 `ALL`，全表扫描 8000 万行。根因是活动用手机号查订单，但 `mobile` 字段没建索引，活动前数据量小走全表还能扛，活动流量一来直接打满 CPU。紧急处置是给 `mobile` 加索引（用 `pt-online-schema-change` 在线加，避免锁表），同时在网关层对手机号查询接口限流到 500 QPS。加完索引后 CPU 回落到 30%，P99 回到 80ms。

**避坑**

- `KILL` 长事务前先评估回滚代价，大事务回滚可能比执行还慢，必要时联系业务方先摘流量。
- 不要在 CPU 飙高时直接 `ALTER TABLE` 加索引，在线 DDL 可能进一步锁表，用 `pt-online-schema-change`。
- `Explain` 的 `rows` 是估算值，统计信息失准时偏差很大，必要时 `ANALYZE TABLE` 重新采样。

## 速查/自测

**速查表**

| 命令或工具 | 作用 |
|---|---|
| `top -Hp <pid>` | 定位 mysqld 内烧 CPU 的线程 |
| `SHOW PROCESSLIST` | 看当前会话状态 |
| `SHOW ENGINE INNODB STATUS` | 看行锁等待、死锁、长事务 |
| `INNODB_TRX` | 查活跃事务的开始时间和 SQL |
| `Explain` | 看执行计划 type/rows/Extra |
| `pt-query-digest` | 慢日志指纹化分析 |

**自测题**

1.（判断）MySQL CPU 飙高到 100%，一定是 SQL 慢引起的。
<details><summary>参考答案</summary>
错。也可能是死锁检测开销、连接数打满、备份脚本或 `pt-query-digest` 离线分析占用，需先用 `top -c` 确认是不是 `mysqld`。
</details>

2.（单选）`Explain` 输出里 `type` 为 `ALL` 且 `Extra` 含 `Using filesort`，最可能的原因是？
A. 走了聚簇索引  B. 全表扫描且需额外排序  C. 用了覆盖索引  D. 走了等值查询
<details><summary>参考答案</summary>
B。`ALL` 是全表扫描，`Using filesort` 说明需额外排序，两者叠加 CPU 消耗最大。
</details>

3.（单选）`SHOW PROCESSLIST` 大量会话显示 `Waiting for table metadata lock`，应优先？
A. 重启 MySQL  B. 杀最早开始的长事务  C. 加内存  D. 调大 `max_connections`
<details><summary>参考答案</summary>
B。MDL 锁阻塞多由未提交的长事务占着表元数据锁引起，`KILL` 掉 `INNODB_TRX` 里最早的事务即可恢复。
</details>

4.（判断）`innodb_deadlock_detect` 在热点行高并发更新场景下可能成为 CPU 飙高的元凶。
<details><summary>参考答案</summary>
对。1000 个并发线程争抢同一行时，死锁检测的等待链遍历是 O(n) 复杂度，CPU 可飙到接近 100% 而 TPS 极低。
</details>

5.（单选）线上突发 CPU 飙高，加索引止血应选用？
A. `ALTER TABLE` 直接加  B. `CREATE INDEX` 直接建  C. `pt-online-schema-change`  D. 重启数据库
<details><summary>参考答案</summary>
C。在线 DDL 可能锁表，`pt-online-schema-change` 通过影子表加触发器在线变更，不影响业务写入。
</details>

简答：用四步法描述一次 CPU 飙高排查的完整流程。
<details><summary>参考答案</summary>
① `top -c` 确认 `mysqld`，`top -Hp` 定位线程并转十六进制反查 SQL；② `SHOW PROCESSLIST` 加 `INNODB_TRX` 找长会话长事务；③ 对慢 SQL 跑 `Explain` 看 `type`、`rows`、`Extra`；④ `pt-query-digest` 分析慢日志判断是否执行计划退化；止血 `KILL` 长事务，根治加索引或限流。
</details>

简答：为什么死锁检测会成为 CPU 瓶颈？如何权衡开关？
<details><summary>参考答案</summary>
死锁检测在事务申请锁被阻塞时立即遍历等待链判断是否成环，热点行高并发下每个阻塞线程都触发检测，复杂度 O(n)，1000 并发可达百万级 CPU 操作。权衡：业务侧把热点行更新打散到多行或队列串行化；极端高并发可临时关闭 `innodb_deadlock_detect` 靠 `innodb_lock_wait_timeout` 兜底，但要承担真死锁等满超时的代价。
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 29 讲 如何判断一个数据库是不是有问题
- 林晓斌《MySQL 实战 45 讲》第 32 讲 为什么还有 kill 不掉的语句
- 林晓斌《MySQL 实战 45 讲》第 33 讲 我查这么多数据，会不会把数据库内存打爆
- 施瓦茨等《高性能 MySQL》第 3 章：剖析 MySQL 查询
- Percona Toolkit 文档 pt-query-digest：www.percona.com/doc/percona-toolkit/
