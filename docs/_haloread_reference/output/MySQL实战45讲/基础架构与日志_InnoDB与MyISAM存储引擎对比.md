---
title: 第 02 章：InnoDB 与 MyISAM 存储引擎对比
book: MySQL实战45讲
chapter: 基础架构与日志
event: InnoDB与MyISAM存储引擎对比
sort: 2
chapter_sort: 1
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 02 章：InnoDB 与 MyISAM 存储引擎对比

> 前置知识：第 01 章 SQL 执行流程、知道"事务"和"索引"两个词
> 学完你能：① 面试时讲清 InnoDB 取代 MyISAM 成为默认引擎的 5 个技术原因；② 在生产建表审核中拒绝 MyISAM，并给出迁移到 InnoDB 的依据

## 概念

InnoDB 和 MyISAM 都是 MySQL 存储引擎，分别走"索引组织表（Index Organized Table, IOT）"和"堆组织表（Heap Organized Table）"两条路线。林晓斌在《MySQL 实战 45 讲》第 38 讲用 Memory 引擎类比讲过这两种组织方式——InnoDB 的数据就放在主键索引 B+ 树的叶子节点里，主键查询一次到位；MyISAM 的数据和索引是两个独立文件，索引叶子节点存的是数据行的物理地址，要再回一次表。

一句话定义：**InnoDB 是支持事务、行锁、外键、崩溃恢复的索引组织表引擎**；**MyISAM 是不支持事务、表锁、无崩溃恢复的堆组织表引擎**。MySQL 5.5.5 起 InnoDB 成为默认引擎，5.7 后 MyISAM 几乎只剩历史包袱。

易混淆点：
- "InnoDB 索引组织表" vs "MyISAM 非聚簇索引"：本质区别是"数据本身按主键有序存储"还是"数据独立堆存"。这决定了 InnoDB 主键查询极快、二级索引要回主键树，而 MyISAM 主键和二级索引都要回表（回数据文件）。
- "redo log" vs "binlog"：redo log 是 InnoDB 引擎层物理日志，MyISAM 没有；binlog 是 Server 层逻辑日志，所有引擎都写。MyISAM 崩溃后能用 binlog 恢复，但代价远大于 InnoDB 的 redo log。

## 原理

### 七大核心差异

| 维度 | InnoDB | MyISAM |
|---|---|---|
| 事务 | 支持 ACID | 不支持 |
| 锁粒度 | 行锁（默认）/表锁 | 仅表锁 |
| 外键 | 支持 | 不支持 |
| 崩溃恢复 | 有 redo log，crash-safe | 无，靠 binlog 重放或修复表 |
| 索引组织 | 聚簇索引（IOT），数据在主键 B+ 树叶子 | 非聚簇，数据独立堆存 |
| 全文索引 | 5.6+ 支持 | 一直支持 |
| `count(*)` | 逐行扫描，受 MVCC 影响 | 维护总行数，O(1) |

**1. 事务支持差异**
InnoDB 实现 ACID 靠三件套：redo log 保证持久性（Durability）、undo log 保证原子性与 MVCC、Next-Key Lock 在 RR（可重复读，MySQL 默认隔离级别）下解决幻读。MyISAM 完全没有这套机制，`BEGIN...COMMIT` 在 MyISAM 上不生效，一条 `UPDATE` 出错半截没法回滚。

**2. 锁粒度差异**
林晓斌在第 07 讲讲过：InnoDB 默认行锁，但"行锁是加在索引上的"——没走索引的更新会退化为表锁。MyISAM 只有表锁，一个 `UPDATE` 会阻塞全表所有读写。并发场景下 MyISAM 的 TPS 会直接被打到地板。

**3. 外键支持**
InnoDB 支持外键约束（`FOREIGN KEY`），保证父子表参照完整性。MyISAM 不支持，建外键语法能过但实际不生效（5.5 之前甚至静默忽略）。生产实践里外键很少用（性能与扩展性问题），但 InnoDB 至少给了选项。

**4. 崩溃恢复：redo log 是关键**
林晓斌在第 02 讲讲透了这个机制：InnoDB 用 WAL（Write-Ahead Logging）—— 先写 redo log 再刷数据页，崩溃后靠 redo log 重放已提交事务、靠 undo log 回滚未提交事务，保证 crash-safe。MyISAM 没有 redo log，崩溃后数据文件可能损坏，需要 `myisamchk` 或 `REPAIR TABLE` 修复，期间业务不可用。

```sql
-- 双 1 配置：保证 crash-safe 的最关键两参数
innodb_flush_log_at_trx_commit = 1   -- 每次事务 redo log 持久化
sync_binlog = 1                       -- 每次事务 binlog 持久化
```

**5. 聚簇索引 vs 非聚簇索引**

```
InnoDB（聚簇）：
主键索引 B+ 树叶子节点 = 完整数据行
二级索引叶子节点 = 主键值 → 再回主键树找数据

MyISAM（非聚簇）：
.MYD 文件独立堆存数据
.MYI 文件存索引，叶子节点 = 数据行物理偏移
主键和二级索引地位相同，都要回 .MYD
```

林晓斌在第 04 讲指出：InnoDB 这个设计让"主键查询"和"覆盖索引"特别快——主键查询一次 B+ 树（O(log n)）就拿到完整行；覆盖索引不用回表。代价是二级索引要回主键树（两次 B+ 树查找），所以 InnoDB 表"主键尽量短"很重要（自增整型主键是首选）。

**6. 全文索引**
5.6 之前全文索引是 MyISAM 独有，5.6 起 InnoDB 也支持 `FULLTEXT` 索引（基于倒排）。生产实践：MySQL 自带全文索引在中文分词上不如 Elasticsearch，复杂搜索都外移了，这个差异已经不是选型关键。

**7. `count(*)` 差异**
林晓斌在第 14 讲专门讲了这个：

- MyISAM 维护表的总行数（无 WHERE 时 `SELECT COUNT(*) FROM t` 是 O(1)，直接读元数据）。
- InnoDB 因为 MVCC，同一时刻不同事务看到的行数可能不同，没法维护一个全局计数，只能逐行判断可见性累加。优化器会选最小的索引树遍历以减少扫描量。

注意 MyISAM 这个 O(1) 只对**无 WHERE** 的 `count(*)` 有效，带条件照样全表扫。

### 为什么 MySQL 5.5.5 后默认 InnoDB

官方切换默认引擎时给出的核心理由：现代业务几乎都需要事务、并发写入性能（行锁）、崩溃恢复。MyISAM 的优势——`count(*)` 快、表结构简单——在 MVCC 时代和互联网高并发场景下不再重要。Oracle 收购 MySQL 后持续投入 InnoDB 内核优化（5.6 引入全文索引与 ICP、5.7 大幅优化 Buffer Pool、8.0 引入数据字典重构），MyISAM 几乎不再更新。

## 实践

### 验证两种引擎的实际差异（MySQL 8.0 可运行）

```sql
CREATE TABLE t_innodb (id INT PRIMARY KEY, c VARCHAR(100)) ENGINE=InnoDB;
CREATE TABLE t_myisam (id INT PRIMARY KEY, c VARCHAR(100)) ENGINE=MyISAM;

-- 看引擎
SHOW TABLE STATUS FROM db_test LIKE 't_%';

-- count(*) 差异
INSERT INTO t_innodb VALUES (1,'a'),(2,'b'),(3,'c');
INSERT INTO t_myisam VALUES (1,'a'),(2,'b'),(3,'c');

EXPLAIN SELECT COUNT(*) FROM t_innodb;   -- rows=3，逐行扫
EXPLAIN SELECT COUNT(*) FROM t_myisam;  -- 不扫描，直接读元数据
```

### 崩溃恢复对比（生产真实风险）

林晓斌在第 38 讲讲 Memory 引擎时提到，"重启丢数据 + 主备同步中断"是致命缺陷。MyISAM 崩溃虽然不如 Memory 那么彻底，但同样有"修复期间业务不可用"的问题：

```
故障时间线：
mysqld 异常退出 → MyISAM 表标记为 crashed
   → 重启时 SELECT 报 "Table is marked as crashed"
   → DBA 跑 REPAIR TABLE（分钟级到小时级，看表大小）
   → 期间该表完全不可用

InnoDB 同场景：
mysqld 异常退出 → 重启时自动 redo log 重放 + undo 回滚
   → 几秒到几十秒完成
   → 业务恢复
```

### 常见坑与修复

1. **历史项目表是 MyISAM，迁移 InnoDB 注意锁行为变化**：MyISAM 表锁下"读写互不阻塞"的语义在 InnoDB 行锁下成立，但 InnoDB 在没有合适索引时会退化为表锁，迁移前必须检查所有 UPDATE/DELETE 的 WHERE 字段是否有索引。

2. **`count(*)` 从 O(1) 变 O(n)**：业务原来依赖 MyISAM `SELECT COUNT(*)` 做实时统计，迁 InnoDB 后变慢。林晓斌在第 14 讲给的方案——用计数表（在同一事务里 `INSERT` 业务数据 + `UPDATE` 计数表），不要用 Redis 计数（无法和 MySQL 保持一致视图）。

3. **主键设计差异**：InnoDB 二级索引存主键值，主键越长二级索引越大。MyISAM 二级索引存物理偏移，主键长度不影响二级索引。所以 InnoDB 表强烈建议自增整型主键，MyISAM 时代用 UUID 主键的烂摊子迁 InnoDB 后索引膨胀严重。

4. **MyISAM 不支持事务导致业务逻辑错误**：开发者写了 `BEGIN; UPDATE A; UPDATE B; COMMIT;`，在 MyISAM 上第一条成功第二条失败，A 的更新无法回滚。这是把 MyISAM 用在生产环境最隐蔽的坑——开发期看不出，事故时才知道。

### 教科书做法 vs 生产做法

| 场景 | 教科书 | 生产 |
|---|---|---|
| 新建业务表 | 选 InnoDB | InnoDB，且禁止建表用 MyISAM（建表审核拦截） |
| 历史 MyISAM 表 | `ALTER TABLE t ENGINE=InnoDB` | 同上，但要先做：① 检查 UPDATE 的 WHERE 字段有没有索引；② 评估磁盘空间（InnoDB 表一般比 MyISAM 大 20%-50%）；③ 选低峰期，`ALTER TABLE` 在线 DDL 仍会锁表（5.6+ 部分操作 INPLACE） |
| 临时表 | Memory 引擎 | InnoDB 临时表（`CREATE TEMPORARY TABLE`），MySQL 8.0 起内部临时表也用 InnoDB（`TempTable` 引擎） |

## 速查/自测

### 引擎特性速查表

| 特性 | InnoDB | MyISAM | Memory |
|---|---|---|---|
| 事务 | ✅ | ❌ | ❌ |
| 行锁 | ✅ | ❌（表锁） | ❌（表锁） |
| 外键 | ✅ | ❌ | ❌ |
| 崩溃恢复 | ✅（redo log） | ❌ | ❌（重启丢数据） |
| 聚簇索引 | ✅ | ❌ | ❌（Hash/B-Tree） |
| 全文索引 | ✅（5.6+） | ✅ | ❌ |
| `count(*)` | 逐行扫 | O(1)（无 WHERE） | 维护计数 |
| 默认引擎 | ✅（5.5.5+） | 5.5.5 前 | 否 |

### 关键参数与文件

| 项 | InnoDB | MyISAM |
|---|---|---|
| 数据文件 | `.ibd`（独立表空间）或共享表空间 | `.MYD`（数据）+ `.MYI`（索引）+ `.frm` |
| 关键参数 | `innodb_buffer_pool_size`（默认 128MB）、`innodb_flush_log_at_trx_commit` | `key_buffer_size` |
| 崩溃修复 | 自动 redo/undo | `myisamchk`/`REPAIR TABLE` |

### 自测三问

**Q1（概念辨析）**：InnoDB 是聚簇索引、MyISAM 不是，这个差异对二级索引查询有什么影响？
参考要点：InnoDB 二级索引叶子节点存主键值，二级索引查询要回主键树（两次 B+ 树查找），除非走覆盖索引；MyISAM 二级索引叶子节点存数据行物理偏移，主键索引和二级索引地位相同，都要回 `.MYD` 文件一次。所以 InnoDB 表"主键尽量短"很重要（影响所有二级索引大小），MyISAM 没这个约束。

**Q2（原理边界）**：InnoDB 崩溃后能自动恢复，MyISAM 崩溃后要 `REPAIR TABLE`，根因是什么？是不是 MyISAM 完全没救？
参考要点：根因是 InnoDB 有 redo log（WAL 机制）+ undo log，崩溃后重启自动重放/回滚；MyISAM 没有 redo log，数据页直接落盘，崩溃时正在写的页可能半新半旧，需要修复工具扫描重建索引。MyISAM 不是完全没救——binlog 是 Server 层的，所有引擎都写，可以用 binlog 重放恢复到崩溃前状态，但恢复时间长且需要人工介入，远不如 InnoDB 自动恢复。

**Q3（实践判断）**：线上有一张 5000 万行的 MyISAM 历史表，业务用 `SELECT COUNT(*)` 做实时计数展示，迁 InnoDB 后这个查询变慢到 5 秒，怎么处理？
参考要点：① 短期：`EXPLAIN` 看是不是用了最小索引树，确认无 WHERE 时优化器已经选了最短索引；② 中期：上计数表方案，业务写事务里同步更新计数表（林晓斌第 14 讲方案）；③ 不要用 `show table status` 的 `TABLE_ROWS` 替代，误差 40%-50%；④ 不要用 Redis 计数，Redis 和 MySQL 没法做分布式事务，会出现"查到行但计数没加"或反向不一致；⑤ 长期：这种统计需求本身适合走 OLAP（ClickHouse/Doris），不该压在 MySQL 上。

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 01 讲 基础架构：一条 SQL 查询语句是如何执行的
- 林晓斌《MySQL 实战 45 讲》第 02 讲 日志系统：一条 SQL 更新语句是如何执行的
- 林晓斌《MySQL 实战 45 讲》第 04 讲 深入浅出索引（上）
- 林晓斌《MySQL 实战 45 讲》第 07 讲 行锁功过
- 林晓斌《MySQL 实战 45 讲》第 14 讲 count(\*) 这么慢，我该怎么办
- 林晓斌《MySQL 实战 45 讲》第 38 讲 都说 InnoDB 好，那还要不要使用 Memory 引擎
- 姜承尧《MySQL 技术内幕：InnoDB 存储引擎》第 1 章 InnoDB 存储引擎、第 8 章 事务
- Baron Schwartz 等《高性能 MySQL》第 1 章 MySQL 架构与历史、第 7 章 高级 MySQL 特性
- MySQL 8.0 官方文档：InnoDB：dev.mysql.com/doc/refman/8.0/en/innodb-storage-engine.html
