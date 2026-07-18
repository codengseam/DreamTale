---
title: 第 29 章：QPS突降定位
book: MySQL实战45讲
chapter: 性能调优与实战
event: QPS突降定位
sort: 2
chapter_sort: 9
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 29 章：QPS突降定位

> 前置知识：读写分离、主从复制、DDL 与 MDL 锁、连接池
> 学完你能：① 按应用→网络→数据库→中间件链路定位 QPS 突降 ② 识别五类导致 QPS 跌的根因 ③ 用 pt-online-schema-change 处置 DDL 锁表

## 概念

QPS 突降比 CPU 飙高更考验排查链路的完整性。CPU 飙高通常局限在数据库层，而 QPS 从 5000 掉到 500，问题可能出在应用连接池、网络、数据库锁、中间件缓存任何一环。SDET 在做全链路压测和线上稳定性值守时，要把 QPS 突降当成一个需要分层定位的信号，而不是直接归因到数据库。

QPS 突降的本质，是请求在某一层被卡住了——要么应用拿不到数据库连接，要么请求在等锁，要么流量被中间件熔断。所以排查的核心是沿着请求路径逐层找堵点，每一层都有对应的快速验证指标。

林晓斌在《MySQL 实战 45 讲》第 28 讲"读写分离有哪些坑"一讲里强调，读写分离架构下主从延迟、从库连接分配不均都会造成业务 QPS 抖动，排查时要把主从链路作为重点怀疑对象。

## 原理

### 分层排查链路

| 层 | 关键指标 | 堵点特征 |
|---|---|---|
| 应用层 | 连接池活跃数、线程池排队 | 活跃连接数打满，请求堆积 |
| 网络层 | TCP 重传、连接建立耗时 | 重传率高，`TIME_WAIT` 堆积 |
| 数据库层 | `Threads_running`、锁等待、慢 SQL | 慢 SQL 阻塞连接池 |
| 中间件 | 缓存命中率、限流计数 | 缓存击穿，限流触发 |

应用层先看连接池：如果活跃连接持续等于最大连接数，说明请求全堵在拿连接这一步，根因在下游。网络层用 `ss -s` 看 `TIME_WAIT` 数量，用 `tcpdump` 看重传。数据库层看 `Threads_running` 是否飙升、`innodb_row_lock_waits` 是否增长、慢 SQL 数量。中间件看缓存命中率是否暴跌，缓存击穿会让请求穿透到数据库。

分层排查有一个顺序原则：从最易验证的层开始，逐步深入。应用层和中间件的指标在监控大盘上一眼能看到，几秒就能排除；网络层用 `ss -s` 和 `tcpdump` 几分钟验证；数据库层要登 MySQL 跑 SQL，耗时最长放最后。千万不要一上来就登数据库翻慢日志，大概率浪费时间。这套顺序在每次故障复盘里都要演练，形成肌肉记忆，线上告警时才不会手忙脚乱。

### 五类常见根因

第一类，慢 SQL 阻塞连接池。一条慢 SQL 占着连接不放，连接池被占满，新请求拿不到连接，QPS 断崖式下跌。特征是应用日志大量"获取连接超时"，数据库 `Threads_running` 正常但 `Threads_connected` 接近上限。

第二类，死锁。死锁会让事务回滚重试，高并发下连锁回滚导致 QPS 抖动。`SHOW ENGINE INNODB STATUS` 的 `LATEST DETECTED DEADLOCK` 段能定位。

第三类，主从切换。读写分离架构下主库宕机触发切换，切换期间写请求失败、读请求打到新主库可能因数据延迟返回旧数据，QPS 短暂下跌。监控看 `Seconds_Behind_Master` 和 VIP 漂移事件。

第四类，DDL 锁表。这是最隐蔽的一类。`ALTER TABLE` 加字段时如果表大，MDL 锁会阻塞后续所有读写，QPS 跌 90% 都有可能。林晓斌在第 30 讲"用动态的观点看加锁"里分析过，DDL 的 MDL 写锁会阻塞所有后续 DML，即使 DDL 本身很快，申请 MDL 的队列也会堆积。

第五类，大事务。长事务持有锁、占用 undo 段，阻塞其他事务并拖慢查询。

### 关键指标速查

```sql
SHOW GLOBAL STATUS LIKE 'Threads%';
SHOW GLOBAL STATUS LIKE 'Innodb_row_lock%';
SHOW SLAVE STATUS\G   -- 8.0.22+ 用 SHOW REPLICA STATUS
```

`Threads_running` 飙升而 QPS 下降，是典型的"请求在等锁或等 IO"信号。`Seconds_Behind_Master` 突增则指向主从延迟。

## 实践

**面试场景**

面试官问："业务 QPS 从 5000 掉到 500，怎么定位？"

回答模板："我会按分层链路排查。先看应用层连接池是不是打满，再看网络层有没有重传，然后看数据库层 `Threads_running`、锁等待、慢 SQL，最后看中间件缓存命中率和限流计数。最常见的根因是慢 SQL 阻塞连接池或 DDL 锁表，定位到后用 `KILL` 杀慢会话或停 DDL 止血。"

追问"如果是 DDL 锁表呢？"——立刻 `KILL` 掉 DDL 语句释放 MDL 锁，改用 `pt-online-schema-change` 重做，它通过影子表和触发器在线变更，不阻塞业务。

**项目场景**

一次凌晨发布，运维对一张 5000 万行的订单表执行 `ALTER TABLE ADD COLUMN`，发布后业务 QPS 从 8000 跌到 800。排查：应用日志全是"获取连接超时"，数据库 `Threads_running` 不高但 `Threads_connected` 接近 `max_connections`，`SHOW PROCESSLIST` 大量会话 `Waiting for table metadata lock`。根因是 DDL 申请 MDL 写锁时，前面有一个未提交的慢查询占着 MDL 读锁，DDL 卡住，后续所有 DML 都在等 DDL 释放 MDL，形成队列堆积。紧急处置是 `KILL` 掉那条慢查询和 DDL，QPS 立刻恢复；后续把所有大表 DDL 改用 `pt-online-schema-change`，并在发布前检查长事务。

**避坑**

- DDL 不要在业务高峰执行，即使是在线 DDL 也可能因为 MDL 队列堆积影响业务。
- 读写分离架构下，主从切换后要确认从库 `Seconds_Behind_Master` 归零再放读流量。
- 缓存击穿是 QPS 突降的常见元凶，热点 key 过期要做互斥重建或逻辑过期。

## 速查/自测

**速查表**

| 现象 | 最可能根因 | 验证手段 |
|---|---|---|
| 连接池打满加获取超时 | 慢 SQL 阻塞 | `SHOW PROCESSLIST` 找长会话 |
| 大量 MDL 等待 | DDL 锁表 | `SHOW PROCESSLIST` 找 DDL |
| `Seconds_Behind_Master` 突增 | 主从延迟或切换 | `SHOW SLAVE STATUS` |
| 缓存命中率暴跌 | 缓存击穿 | 中间件监控 |
| 死锁频繁 | 死锁连锁回滚 | `SHOW ENGINE INNODB STATUS` |

**自测题**

1.（单选）QPS 突降，应用日志大量"获取连接超时"，但数据库 CPU 不高，最可能是？
A. CPU 不足  B. 慢 SQL 阻塞连接池  C. 网络带宽满  D. 内存不足
<details><summary>参考答案</summary>
B。CPU 不高说明不是计算瓶颈，获取连接超时说明连接被慢 SQL 占着，根因是慢 SQL 阻塞连接池。
</details>

2.（判断）`ALTER TABLE` 加字段即使执行很快，也可能导致 QPS 突降。
<details><summary>参考答案</summary>
对。DDL 申请 MDL 写锁，若前面有未提交事务占着 MDL 读锁，DDL 卡住后所有后续 DML 都在队列里等，造成 QPS 跌。
</details>

3.（单选）处置大表 DDL 锁表的最佳方案是？
A. 调大 `lock_wait_timeout`  B. `KILL` DDL 后用 `pt-online-schema-change`  C. 重启数据库  D. 等待自动完成
<details><summary>参考答案</summary>
B。`pt-online-schema-change` 通过影子表加触发器在线变更，不阻塞业务；先 `KILL` DDL 释放 MDL 止血。
</details>

4.（判断）读写分离架构下主从切换不会影响 QPS。
<details><summary>参考答案</summary>
错。切换期间写请求失败、读请求可能因延迟返回旧数据，QPS 会短暂下跌，需等 `Seconds_Behind_Master` 归零再放读流量。
</details>

5.（单选）`Threads_running` 飙升而 QPS 下降，说明？
A. 请求在等锁或等 IO  B. 数据库空闲  C. 连接数太少  D. 网络断开
<details><summary>参考答案</summary>
A。`Threads_running` 高说明线程都在跑，但 QPS 降说明没产出，是在等锁或等 IO。
</details>

简答：描述 DDL 锁表导致 QPS 突降的完整链路和处置。
<details><summary>参考答案</summary>
链路：DDL 申请 MDL 写锁 → 前面有未提交事务占 MDL 读锁 → DDL 卡住 → 后续所有 DML 在队列等 DDL 释放 MDL → 连接池打满 → QPS 跌。处置：`KILL` 慢查询和 DDL 释放 MDL 止血，改用 `pt-online-schema-change` 在线变更，发布前检查长事务。
</details>

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 28 讲 读写分离有哪些坑
- 林晓斌《MySQL 实战 45 讲》第 29 讲 如何判断一个数据库是不是有问题
- 林晓斌《MySQL 实战 45 讲》第 30 讲 用动态的观点看加锁
- 施瓦茨等《高性能 MySQL》第 11 章：可扩展性与高可用
- Percona Toolkit 文档 pt-online-schema-change
