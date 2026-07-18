---
title: 第 05 章：ACID 与四种隔离级别
book: MySQL实战45讲
chapter: 事务与MVCC
event: ACID与四种隔离级别
sort: 1
chapter_sort: 3
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 05 章：ACID 与四种隔离级别

> 前置知识：熟悉基本 SQL 增删改查，了解 InnoDB 是 MySQL 默认存储引擎
> 学完你能：①说清 ACID 四特性各自由什么机制保证 ②区分脏读、不可重复读、幻读三种并发异常 ③根据业务场景正确选择隔离级别

## 概念

事务（Transaction）是数据库操作的最小逻辑执行单位，要么全部成功提交，要么全部失败回滚。林晓斌在《MySQL 实战 45 讲》中强调，理解事务的关键不在背诵定义，而在于搞清楚它在并发场景下如何保证数据正确。

ACID 是事务的四个基本特性：

- 原子性（Atomicity）：事务要么全部执行，要么全部不执行
- 一致性（Consistency）：事务执行前后，数据库从一个合法状态转到另一个合法状态
- 隔离性（Isolation）：并发事务之间互不干扰
- 持久性（Durability）：事务提交后对数据的修改永久保存

并发场景下，如果隔离性不足，会出现三种典型异常：

- 脏读（Dirty Read）：事务 A 读到了事务 B 尚未提交的修改，B 回滚后 A 读到的是"脏"数据
- 不可重复读（Non-Repeatable Read）：事务 A 两次读取同一行，结果不同，因为 B 在中间提交了对该行的更新
- 幻读（Phantom Read）：事务 A 两次按同一条件查询，后一次多出了 B 新插入的行

三者的粒度不同：脏读读到的是未提交数据，不可重复读针对已有行的修改，幻读针对新插入的行。区分这三者是后面理解隔离级别的基础。

为应对这些异常，SQL 标准定义了四种隔离级别（Isolation Level），从低到高：

- 读未提交（Read Uncommitted，RU）
- 读提交（Read Committed，RC）
- 可重复读（Repeatable Read，RR）——MySQL 默认
- 串行化（Serializable）

## 原理

### InnoDB 如何实现 ACID

四个特性并非由单一机制保证，而是分工协作：

- **原子性**靠 undo log（回滚日志）。每次修改前，InnoDB 先把修改前的旧值写入 undo log。事务回滚时按 undo log 反向恢复；undo log 同时也是 MVCC 版本链的来源。
- **一致性**靠应用层业务逻辑加数据库约束（主键、外键、唯一索引、CHECK 约束）共同保证。一致性是目标，原子性、隔离性、持久性是手段。数据库约束只能保证结构合法，业务语义合法必须靠代码。
- **隔离性**靠锁和 MVCC（多版本并发控制）共同实现。写写靠行锁串行化，读写靠 MVCC 让读不阻塞写。
- **持久性**靠 redo log（重做日志）和 binlog（归档日志）。redo log 采用 WAL（Write-Ahead Logging，预写日志）机制，先写日志再写数据页，保证 crash 后能恢复；binlog 用于主从复制和数据恢复。

### 四种隔离级别解决什么问题

各隔离级别允许的异常如下：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---|---|---|---|
| RU（读未提交） | 允许 | 允许 | 允许 |
| RC（读提交） | 解决 | 允许 | 允许 |
| RR（可重复读，MySQL 默认） | 解决 | 解决 | 大部分解决 |
| Serializable（串行化） | 解决 | 解决 | 解决 |

RR 是 MySQL InnoDB 的默认隔离级别，这点和 Oracle、PostgreSQL 默认 RC 不同。InnoDB 的 RR 之所以能"大部分解决"幻读，是因为它在 SQL 标准 RR 的基础上额外加了间隙锁（Gap Lock），配合 MVCC 几乎消除幻读——这点会在第 07 章详述。

Serializable 在 InnoDB 中的实现是把所有普通 SELECT 隐式转为 `SELECT ... LOCK IN SHARE MODE`，读写都加锁，并发度最低，生产环境几乎不用。

### RC 与 RR 的视图时机差异

林晓斌在《MySQL 实战 45 讲》第 08 讲指出，RC 和 RR 的核心区别在于一致性读视图（ReadView）的生成时机：

- RC：每条 SELECT 语句执行前都生成新的 ReadView，所以能看到该语句执行前已提交的修改——这导致不可重复读
- RR：事务中第一条快照读语句执行时生成 ReadView，整个事务复用同一份——所以可重复读

需要澄清一个常见误解：RR 下 ReadView 不是在 `BEGIN` 时生成，而是在事务内第一次执行快照读时才生成。若用 `START TRANSACTION WITH CONSISTENT SNAPSHOT`，则立即创建 ReadView。

## 实践

### 查看与设置隔离级别

查看当前隔离级别：

```sql
SHOW VARIABLES LIKE 'transaction_isolation';
```

MySQL 5.7 及以前用 `tx_isolation`，8.0 改为 `transaction_isolation`，输出形如：

```
+-----------------------+-----------------+
| Variable_name         | Value           |
+-----------------------+-----------------+
| transaction_isolation | REPEATABLE-READ |
+-----------------------+-----------------+
```

会话级切换到 RC：

```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

全局级（需重启连接生效）：

```sql
SET GLOBAL TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

持久化建议写进配置文件 `my.cnf`：

```ini
[mysqld]
transaction-isolation = READ-COMMITTED
```

### 长事务的危害

林晓斌特别警告长事务的三大风险：

1. **undo log 膨胀**：RR 下事务持有的 ReadView 越老，所有可能被该视图回溯的 undo log 都不能被 purge 线程回收。长事务能把 undo 表空间撑到几百 GB，林晓斌给出过极端案例——数据 20 GB，回滚段膨胀到 200 GB，最后只能重建库。
2. **锁占用**：长事务持有的行锁、间隙锁一直不释放，阻塞其他事务。
3. **连接池污染**：很多客户端框架默认 `autocommit=0`，连接复用时容易把短事务拖成长事务。

排查长事务：

```sql
SELECT trx_id, trx_started, trx_state, trx_query
FROM information_schema.innodb_trx
WHERE TIMESTAMPDIFF(SECOND, trx_started, NOW()) > 60;
```

### 隔离级别选型建议

- 绝大多数互联网业务：RR（默认）即可，平衡一致性与并发
- Oracle 迁移过来的系统、或对账类业务希望每次读到最新已提交值：用 RC，需配合 `binlog_format=ROW`，避免 RC + STATEMENT 格式的复制数据不一致
- 金融核心强一致场景：评估能否用 RR + 显式行锁替代 Serializable，避免 Serializable 拖垮并发

## 速查/自测

### 速查表

| 特性 | 实现机制 |
|---|---|
| 原子性 A | undo log |
| 一致性 C | 业务逻辑 + 数据库约束 |
| 隔离性 I | 锁 + MVCC |
| 持久性 D | redo log（WAL）+ binlog |

### 自测题

1. ACID 中"一致性"由谁保证？为什么不能只靠数据库？
2. MySQL 默认隔离级别是什么？为什么和 Oracle 不同？
3. 脏读、不可重复读、幻读三者的本质区别是什么？
4. RC 和 RR 下 ReadView 生成时机有何不同？这会导致什么现象？
5. 一个事务里先 `BEGIN`，再隔 10 分钟才执行第一条 SELECT，ReadView 何时生成？

### 参考答案要点

1. 一致性是目标，由原子性+隔离性+持久性+业务约束共同保证；数据库约束只能保证结构合法，业务语义合法必须靠代码。
2. RR；InnoDB 的设计选择，兼顾一致性与复制安全。
3. 脏读=读未提交，不可重复读=读已提交的更新，幻读=读已提交的插入。
4. RC 每条语句生成，RR 事务内首次快照读生成；导致 RC 不可重复读、RR 可重复读。
5. RR 下在该 SELECT 执行时生成，不是 BEGIN 时；除非用 `START TRANSACTION WITH CONSISTENT SNAPSHOT`。

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 03 讲"事务隔离：为什么你改了我还看不见"、第 08 讲"事务到底是隔离的还是不隔离的"
- MySQL 8.0 官方文档 Transaction Isolation Levels 章节
