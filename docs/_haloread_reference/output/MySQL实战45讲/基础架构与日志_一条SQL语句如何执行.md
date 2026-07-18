---
title: 第 01 章：一条 SQL 语句如何执行
book: MySQL实战45讲
chapter: 基础架构与日志
event: 一条SQL语句如何执行
sort: 1
chapter_sort: 1
created_at: 2026-06-28
source_agents:
- mysql-expert
---

# 第 01 章：一条 SQL 语句如何执行

> 前置知识：会用客户端连 MySQL、写过 `SELECT`/`UPDATE`、了解 TCP 基本概念
> 学完你能：① 在面试中把一条 SQL 从客户端到返回结果的全链路画出来，并说清每一层职责；② 在生产慢查询排查中能根据扫描行数定位是 Server 层瓶颈还是引擎层瓶颈

## 概念

林晓斌在《MySQL 实战 45 讲》第 01 讲中给出了理解 MySQL 的最核心框架：MySQL 整体可以拆成两层——Server 层和存储引擎层。Server 层负责"做什么、怎么做"，存储引擎层负责"数据怎么存、怎么取"。

**Server 层（Server Layer）** 跨所有存储引擎共用，包含连接器、查询缓存、分析器、优化器、执行器，以及所有内置函数、存储过程、触发器、视图。**存储引擎层（Storage Engine Layer）** 是插件式的，InnoDB、MyISAM、Memory 各自有不同的数据存取实现，MySQL 5.5.5 起默认引擎为 InnoDB。

容易混淆的两个概念：
- "Server 层" vs "客户端"：客户端只是发请求的进程，Server 层是 mysqld 进程内除引擎外的全部逻辑。
- "查询缓存（Query Cache）" vs "Buffer Pool"：前者是 Server 层的结果级缓存，MySQL 8.0 已彻底删除；后者是 InnoDB 引擎层的页级缓存，默认 128MB，至今仍是性能核心。

边界：本章只讲"一条 SQL 走完整条流水线"，不展开 redo log/binlog/两阶段提交（属于第 02 章日志系统）、不展开索引选择细节（属于索引模块）。

## 原理

### 一条 SELECT 的 6 个阶段

林晓斌在《MySQL 实战 45 讲》第 01 讲给出的经典链路：

```
客户端 → ① 连接器 → ② 查询缓存(8.0 已删) → ③ 分析器 → ④ 优化器 → ⑤ 执行器 → ⑥ 存储引擎 → 返回结果
```

**① 连接器（Connector）** 负责 TCP 握手、用户名密码认证（插件式认证，如 `caching_sha2_password`）、读取 `mysql.user` 权限表并缓存到会话对象。权限一旦缓存，后续操作都用这份缓存；`GRANT` 后**老连接不会立即生效，必须重连**。关键参数 `wait_timeout` 默认 28800 秒（8 小时），空闲超时会被服务端主动断开，客户端会看到 `MySQL has gone away`。

**② 查询缓存**：MySQL 5.7 默认关闭，MySQL 8.0 直接移除。林晓斌给出的废弃理由非常工程化——任何对表的更新都会让该表全部缓存失效，命中率极低而维护成本极高，现代数据库依赖 Buffer Pool 而非结果缓存。生产环境别再开。

**③ 分析器（Parser/Analyzer）** 分两步：词法分析把 SQL 拆成 Token（关键字 `SELECT`、标识符 `users`、常量 `18`、运算符 `>`）；语法分析按 MySQL 语法规则构建抽象语法树（AST）。这一步报的是 `You have an error in your SQL syntax`、`Unknown column`、`Table doesn't exist` 这类错误。

**④ 优化器（Optimizer）** 决定"怎么做"：选哪个索引、join 驱动表选谁、是否用临时表排序。优化器基于成本模型（cost model）估算，输出的执行计划可用 `EXPLAIN` 查看。注意优化器选错索引是高频生产问题，林晓斌在第 10 讲专门讲了原因与 `force index`、`analyze table` 等修复手段。

**⑤ 执行器（Executor）** 真正调用存储引擎接口。执行前会做一次权限再校验（防止优化器无法提前确定操作表的场景，如触发器、子查询）。然后按执行计划循环调用引擎 API，伪代码（无索引场景）：

```python
row = engine.first(table)
while row is not None:
    if row.age > 18:            # Server 层 WHERE 过滤
        result.append(row)
    row = engine.next(table)
return result
```

关键指标 `rows_examined`（扫描行数，慢查询日志可见）：理想值接近返回行数，远大于返回行数说明选错了索引或没下推。

**⑥ 存储引擎**：执行器调 `first`/`next` 等接口，引擎决定是全表扫还是走 B+ 树索引。B+ 树查询复杂度 O(log n)，主键等值查询可只扫描 1 行。

### UPDATE 比 SELECT 多了什么

林晓斌在第 02 讲把 UPDATE 流程拉出来单独讲：执行器调引擎接口写数据 → 引擎更新 Buffer Pool 内存页（脏页）→ 引擎写 redo log（prepare 状态）→ 执行器写 binlog → 执行器调 commit → 引擎把 redo log 改 commit。这就是两阶段提交（Two-Phase Commit, 2PC），第 02 章会展开。

### SQL 逻辑执行顺序 vs 物理执行流程

这是面试常被混淆的两件事：

**逻辑顺序**（SQL 标准定义的语义顺序，面试常考）：

```
FROM → JOIN ON → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT
```

记忆要点：先确定数据源（FROM/JOIN），再过滤（WHERE），再分组聚合（GROUP BY/HAVING），再选列（SELECT），最后排序分页（ORDER BY/LIMIT）。这也解释了为什么 `WHERE` 不能用 `SELECT` 里的别名而 `HAVING` 可以——`WHERE` 在 `SELECT` 之前执行。

**物理顺序**（MySQL 实际跑的流程）：就是上面 Server 层 6 个阶段，由优化器决定先扫哪个表、用哪个索引。逻辑顺序是"语义应当怎么算"，物理顺序是"机器实际怎么算"，两者不是一回事。

## 实践

### 验证连接器权限缓存

```sql
-- Session A：已连接用户 userA
GRANT SELECT ON db_test.t TO 'userA'@'%';
-- Session A 不重连仍报错，重连后生效
```

修复：`GRANT`/`REVOKE` 后让业务侧重连，或调用 `FLUSH PRIVILEGES`（只刷权限表，不刷已建连会话的内存权限对象——所以这条命令对老连接无效，必须重连）。

### 长连接内存增长导致 OOM

林晓斌在第 01 讲明确指出：MySQL 执行过程中临时内存管理在连接对象中，连接断开才释放。长连接跑久了会内存累积。

教科书做法 vs 生产做法：

| 做法 | 适用 |
|---|---|
| 定期断开重连 | 简单可靠，所有版本 |
| `mysql_reset_connection`（MySQL 5.7+） | 不重连、快速重置资源 |

Java 侧生产做法：HikariCP 配 `maxLifetime`（建议 30 分钟，比 `wait_timeout` 小），让连接池周期性轮换；同时监控 `Aborted_clients` 指标。

### 用 EXPLAIN 看优化器选择

```sql
EXPLAIN SELECT * FROM users WHERE age > 18 AND name LIKE '张%';
```

重点看 `type`、`key`、`rows`、`Extra`。如果 `Extra` 出现 `Using index condition`，说明触发了索引下推（Index Condition Pushdown, ICP）——把 `name LIKE` 的过滤下推到引擎层，减少回表次数。MySQL 5.6 引入 ICP，5.5 没有，跨版本迁移要特别注意执行计划可能变。

### 三个常见坑

1. **查询缓存"开了反而更慢"**：高写入表开了 Query Cache，TPS 下降 30%+ 不稀奇。MySQL 8.0 直接删功能是正确决定。
2. **`wait_timeout` 没对齐防火墙**：防火墙/NAT 60 秒掐空闲连接，但 `wait_timeout=28800`，连接池里的连接被掐后业务侧第一次 `SELECT` 才报错。修复：连接池配 `validationQuery` 心跳，或把 `wait_timeout` 调小到防火墙空闲时间以下。
3. **优化器选错索引**：`EXPLAIN` 看到 `rows` 远大于预期。林晓斌给的修复路径——`analyze table t`（重新统计索引信息）→ 还不行就 `force index(idx_xxx)` 强制。生产更稳妥的做法是改 SQL 让索引更明确，少用 `force index`，因为业务变更后索引名一变 `force index` 就报错。

### 验证物理执行顺序的最小命令

```sql
-- 看执行计划，确认扫描路径
EXPLAIN SELECT id, name FROM users WHERE age > 18 ORDER BY id LIMIT 10;

-- 慢查询日志看 rows_examined
SHOW VARIABLES LIKE 'slow_query_log%';
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 0;       -- 测试用，生产别这么设
```

## 速查/自测

### Server 层组件职责速查

| 组件 | 职责 | 关键报错/产物 |
|---|---|---|
| 连接器 | 认证 + 权限缓存 | `Access denied`、`MySQL has gone away` |
| 查询缓存 | 结果缓存（8.0 删） | 命中率极低，已废弃 |
| 分析器 | 词法 + 语法 | `SQL syntax`、`Unknown column` |
| 优化器 | 选索引、选驱动表 | `EXPLAIN` 输出 |
| 执行器 | 调引擎接口、Server 层过滤 | `rows_examined` |
| 存储引擎 | 数据存取 | InnoDB/MyISAM/Memory |

### 关键参数速查

| 参数 | 默认值 | 含义 |
|---|---|---|
| `wait_timeout` | 28800（8h） | 空闲连接超时 |
| `innodb_buffer_pool_size` | 128MB | InnoDB 缓冲池 |
| `innodb_page_size` | 16KB | InnoDB 页大小 |
| `long_query_time` | 10（秒） | 慢查询阈值 |
| `slow_query_log` | OFF（8.0） | 是否开慢日志 |

### 自测三问

**Q1（概念辨析）**：Server 层和存储引擎层各自负责什么？为什么 MySQL 要做这种分层？
参考要点：Server 层负责解析、优化、执行调度等跨引擎通用逻辑；引擎层负责数据存取。分层带来插件式架构，同一套 SQL 接口可以接不同引擎；缺点是优化器和引擎之间信息不对称（优化器不一定知道引擎层代价），所以会选错索引。

**Q2（原理边界）**：MySQL 8.0 为什么把查询缓存删了？Buffer Pool 算不算查询缓存的替代？
参考要点：查询缓存以"SQL 文本 + 库表"为 key，表任何更新都让整表缓存失效，命中率低维护成本高，且加锁竞争严重。Buffer Pool 是页级缓存，脏页靠 redo log 保证 crash-safe，命中率天然高。两者不在一个层级，Buffer Pool 不是"替代"，是更合理的方案，查询缓存本就不该存在。

**Q3（实践判断）**：线上发现一条 SQL 慢，`EXPLAIN` 看到 `rows=100000` 但实际只返回 10 行，怎么排查？
参考要点：先看 `key` 是不是预期的索引、`type` 是不是 `ref`/`range`，看 `Extra` 有没有 `Using index condition`（ICP）、有没有 `Using filesort`/`Using temporary`。`rows` 远大于返回行数说明扫描后大量被 Server 层过滤掉——典型场景是没建合适联合索引、或建了但优化器没选。修复路径：`analyze table` 重统计 → 改 SQL 加条件前置 → 必要时 `force index`。

## 参考来源

- 林晓斌《MySQL 实战 45 讲》第 01 讲 基础架构：一条 SQL 查询语句是如何执行的
- 林晓斌《MySQL 实战 45 讲》第 02 讲 日志系统：一条 SQL 更新语句是如何执行的
- 林晓斌《MySQL 实战 45 讲》第 10 讲 MySQL 为什么会选错索引
- Baron Schwartz 等《高性能 MySQL》第 4 章 Schema 与索引优化、第 6 章 查询性能优化
- 姜承尧《MySQL 技术内幕：InnoDB 存储引擎》第 2 章 InnoDB 存储引擎
- MySQL 8.0 官方文档：dev.mysql.com/doc/refman/8.0/en/architecture.html、EXPLAIN：dev.mysql.com/doc/refman/8.0/en/explain.html
