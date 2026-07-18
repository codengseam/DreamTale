---
id: 202603280000
title: MySQL性能调优模块-超详细思维导图
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[MySQL性能调优模块-超详细思维导图]]"
status: published
ai_generated: true
---

关联源素材：[[MySQL实战45讲]]

# MySQL 性能调优模块 - 超详细思维导图

## 🎯 模块概览

> **核心目标**：从底层原理到实战技巧，系统性掌握 MySQL 性能优化方法论

**六大核心主题**：
1. ⭐⭐⭐ **Buffer Pool 深度剖析**（最核心，内存管理的灵魂）
2. 🔍 **慢查询优化方法论**（定位问题→分析原因→解决问题）
3. 📊 **大表优化策略**（分区表 / 分库分表 / Online DDL）
4. 💾 **临时表的使用与优化**（内部临时表的触发与规避）
5. ⚙️ **参数调优建议清单**（生产环境最佳配置）
6. 🚨 **MySQL 抖动问题排查**（性能突降的根本原因）



## 10.2 慢查询优化方法论 🔍

### 开启慢查询日志 📝

#### 为什么需要慢查询日志？
- **定位问题**：找出系统中**最耗时的查询**
- **量化影响**：了解慢查询的**频率和影响范围**
- **持续优化**：建立**基线**，对比优化效果

#### 慢查询日志的基本配置
##### 检查当前状态
```sql
-- 查看慢查询日志是否开启
SHOW VARIABLES LIKE 'slow_query_log';
-- Value = OFF 表示未开启，ON 表示已开启

-- 查看慢查询阈值
SHOW VARIABLES LIKE 'long_query_time';
-- 默认值：10 秒（太长了！建议改为 1 秒）

-- 查看日志文件位置
SHOW VARIABLES LIKE 'slow_query_log_file';
-- 默认位置：/var/lib/mysql/<hostname>-slow.log

-- 是否记录未使用索引的查询
SHOW VARIABLES LIKE 'log_queries_not_using_indexes';
```

##### 开启慢查询日志
###### 方法 1：全局变量（立即生效，重启失效）
```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = ON;

-- 设置阈值为 1 秒（推荐值）
SET GLOBAL long_query_time = 1;

-- 记录未使用索引的查询（开发/测试环境开启）
SET GLOBAL log_queries_not_using_indexes = ON;

-- 记录管理语句（如 ALTER TABLE 等）
SET GLOBAL log_slow_admin_statements = ON;

-- 不使用索引的查询也记录（即使执行很快）
SET GLOBAL log_throttle_queries_not_using_indexes = 0;  -- 0 表示不限流
```

###### 方法 2：配置文件（永久生效）
```ini
# /etc/my.cnf 或 /etc/mysql/my.cnf
[mysqld]
slow_query_log = ON
long_query_time = 1
slow_query_log_file = /var/log/mysql/slow.log
log_queries_not_using_indexes = ON
min_examined_row_limit = 1000  -- 至少扫描 1000 行才记录（过滤简单查询）
```

##### 生产环境的注意事项 ⚠️
- **不要设置过小的阈值**（如 0.1s）：会产生大量日志，影响性能
- **不要在生产环境开启** `log_queries_not_using_indexes`：同样会产生大量日志
- **定期归档**：慢查询日志会持续增长，需要轮转策略
- **监控日志大小**：避免磁盘空间不足

#### 慢查询日志格式解读 📊

##### 日志示例
```
# Time: 2026-04-02T14:23:07.123456Z
# User@Host: app_user@app_host [app_user]  Id: 12345
# Query_time: 3.141592  Lock_time: 0.000123  Rows_sent: 10  Rows_examined: 500000
SET timestamp=1712062987;
SELECT * FROM orders WHERE user_id = 123 ORDER BY create_time DESC LIMIT 10;
```

##### 各字段含义
| 字段 | 含义 | 示例值 |
|------|------|--------|
| **Query_time** | 查询执行总时间（秒） | 3.141592 |
| **Lock_time** | 等待锁的时间（秒） | 0.000123 |
| **Rows_sent** | 返回给客户端的行数 | 10 |
| **Rows_examined** | 扫描的行数（关键指标！） | 500000 |

##### 关键指标解读
###### Query_time（查询时间）
- **< 100ms**：优秀 ✅
- **100ms - 1s**：可接受 ⚠️
- **1s - 3s**：需要优化 ⚠️
- **> 3s**：严重问题 ❌

###### Rows_examined vs Rows_sent（扫描比）
```sql
-- 好的情况：扫描比接近 1
Rows_sent: 10, Rows_examined: 12  -- 扫描比 = 1.2 ✅

-- 差的情况：扫描比很大
Rows_sent: 10, Rows_examined: 500000  -- 扫描比 = 50000 ❌
-- 说明：为了返回 10 行数据，扫描了 50 万行！
-- 优化方向：添加索引、优化 WHERE 条件
```

#### 分析工具介绍 🔧

##### 工具 1：mysqldumpslow（MySQL 自带）
###### 基本用法
```bash
# 按执行时间排序，显示前 10 条
mysqldumpslow -s t -t 10 /var/lib/mysql/slow.log

# 按扫描行数排序
mysqldumpslow -s r -t 10 /var/lib/mysql/slow.log

# 按执行次数排序
mysqldumpslow -s c -t 10 /var/lib/mysql/slow.log

# 显示完整 SQL（不合并相似语句）
mysqldumpslow -a -s t -t 10 /var/lib/mysql/slow.log
```

###### 输出字段说明
```
Count: 156  -- 该类查询出现了 156 次
Time=3.54s (553s total) -- 平均耗时 3.54s，总耗时 553s
Lock=0.00s (0s total)   -- 平均锁等待 0s
Rows=1000.0 (156000 total) -- 平均扫描 1000 行，总共 156000 行

SELECT * FROM orders WHERE user_id=S  -- S 表示字符串参数被抽象化
```

##### 工具 2：pt-query-digest（Percona Toolkit）⭐推荐
###### 安装
```bash
# Ubuntu/Debian
apt-get install percona-toolkit

# CentOS/RHEL
yum install percona-toolkit

# macOS
brew install percona-toolkit
```

###### 基本用法
```bash
# 分析慢查询日志，输出报告
pt-query-digest /var/lib/mysql/slow.log > slow_report.txt

# 分析最近 1 小时的慢查询
pt-query-digest --since '1h' /var/lib/mysql/slow.log

# 分析特定时间段的查询
pt-query-digest --since '2026-04-01 00:00:00' --until '2026-04-02 00:00:00' \
  /var/lib/mysql/slow.log

# 从 processlist 实时分析（不需要慢查询日志）
pt-query-digest --processlist h=localhost,u=root,p=password

# 从 tcpdump 抓包分析
pt-query-digest --type tcpdump /tmp/mysql.tcpdump
```

###### 报告内容解读
```
# 整体概况
# Overall: 2.35k total, 23 unique, 0.26s QPS, 0.13x concurrency _______
# Time range: 2026-04-01 14:00:00 to 2026-04-02 14:00:00
# Attribute          total     min     max     avg     95%  stddev  median
# ============     ======= ======= ======= ======= ======= =======
# Exec time          5852s      1s     45s      2s      5s      3s      1s
# Rows examined    156.23M       0   10.00M  66.49k 200.00k 245.12k   1.23k
# Query size       185.62B      15B     512B    78B    120B     45B      67B

# Profile（按总耗时排序）
# Rank Query ID           Response time  Calls R/Call   Examined  R/Call Item
# ==== ================== ============= ===== ======= ========== ====== =========
#    1 0xABCD12345678     3200.123 45.2%  1500   2.1335   100.00M  66666.66 SELECT orders?...

# 每条查询的详细信息：
# Query 1: 45.20 QPS, 0.13x concurrency, ID 0xABCD12345678 at byte 1234
# This item is included in the report because it matches --limit.
# Scores: V/M = 0.23
# Attribute            pct   total     min     max     avg     95%  stddev  median
# ============     ======= ======= ======= ======= ======= ======= =======
# Exec time           45%  3200s      1s     30s      2s      4s      2s      1s
# Rows examined       64%  100M       0    5M   66666   200k   100k   1000
```

###### pt-query-digest 的优势
- ✅ **自动分组相似查询**：去除参数差异，识别同一模式
- ✅ **丰富的统计信息**：QPS、并发度、方差等
- ✅ **百分比分布**：95% 的查询耗时多少（关注长尾）
- ✅ **EXPLAIN 建议**：可以直接生成执行计划
- ✅ **多种数据源**：支持慢查询日志、processlist、tcpdump

##### 工具 3：MySQL Enterprise Monitor（商业版）
- **功能**：实时监控、告警、可视化仪表板
- **价格**：付费（企业版）
- **替代方案**：Prometheus + Grafana（开源方案）

#### 优化思路四步法 🔄

##### Step 1：定位瓶颈（Find the Problem）
###### 开启慢查询日志收集数据
```sql
-- 确认慢查询日志已开启
SHOW VARIABLES LIKE 'slow_query_log%';

-- 设置合理的阈值
SET GLOBAL long_query_time = 1;
```

###### 使用分析工具找出 TOP N 慢查询
```bash
# 找出耗时最长的 TOP 10
pt-query-digest /var/lib/mysql/slow.log | head -50

# 关注指标：
# 1. Response time 最长的查询
# 2. Calls（执行次数）最多的查询
# 3. Rows examined 最大的查询
```

###### 建立 SQL 性能基线
```
目标：记录优化前的性能指标
- 平均响应时间
- P95/P99 响应时间
- QPS（每秒查询数）
- CPU/内存/IO 使用率
```

##### Step 2：分析原因（Analyze the Root Cause）
###### 使用 EXPLAIN 查看执行计划
```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 123;
```

重点关注以下字段：

####### type 字段（访问类型）
| type 值 | 含义 | 性能评级 |
|---------|------|---------|
| **system** | 系统表，仅一行 | ⭐⭐⭐⭐⭐ |
| **const** | 主键/唯一索引等值查询 | ⭐⭐⭐⭐⭐ |
| **eq_ref** | JOIN 时使用主键/唯一索引 | ⭐⭐⭐⭐ |
| **ref** | 非唯一索引等值查询 | ⭐⭐⭐ |
| **range** | 索引范围查询 | ⭐⭐⭐ |
| **index** | 全索引扫描 | ⭐⭐ |
| **ALL** | 全表扫描 | ⭐（最差！）|

####### key 字段（实际使用的索引）
- **NULL**：没有使用索引（需要优化！）
- **PRIMARY**：使用了主键
- **索引名**：使用了指定的二级索引

####### rows 字段（预估扫描行数）
- **越小越好**：理想情况接近返回行数
- **如果 rows >> Rows_sent**：说明存在大量无效扫描

####### Extra 字段（额外信息）
- **Using index**：✅ 覆盖索引（很好！）
- **Using where**：需要在 Server 层过滤
- **Using temporary**：❌ 使用了临时表（需优化）
- **Using filesort**：❌ 需要额外排序（需优化）
- **Using join buffer**：JOIN 无法使用索引

###### 检查索引使用情况
```sql
-- 查看表中哪些索引被使用
SELECT * FROM sys.schema_unused_indexes;

-- 查看索引统计信息
SELECT * FROM sys.schema_index_statistics
WHERE table_schema = 'mydb'
ORDER BY rows_selected DESC;
```

##### Step 3：制定方案（Formulate Solution）
###### 方案 A：添加/优化索引
```sql
-- 为 WHERE 条件添加索引
CREATE INDEX idx_user_id ON orders(user_id);

-- 为复合查询添加复合索引
CREATE INDEX idx_user_status_date ON orders(user_id, status, create_date);

-- 删除未使用的索引（减少写入开销）
DROP INDEX idx_unused ON table_name;
```

###### 方案 B：重写 SQL 语句
```sql
-- ❌ 避免 SELECT *
SELECT * FROM users WHERE department = 'IT';
-- ✅ 只查询需要的列
SELECT id, name, email FROM users WHERE department = 'IT';

-- ❌ 避免 OR 条件（可能导致索引失效）
SELECT * FROM orders WHERE user_id = 123 OR user_id = 456;
-- ✅ 使用 UNION ALL 替代
SELECT * FROM orders WHERE user_id = 123
UNION ALL
SELECT * FROM orders WHERE user_id = 456;

-- ❌ 避免 LIKE 左模糊
SELECT * FROM users WHERE name LIKE '%张%';
-- ✅ 使用全文索引或搜索引擎
```

###### 方案 C：优化表结构
```sql
-- 垂直拆分：将大字段拆分到单独的表
-- 原表：users(id, name, email, bio, avatar, ...)
-- 拆分为：
--   users_base(id, name, email)
--   users_profile(id, bio, avatar)

-- 选择合适的数据类型
-- ❌ VARCHAR(255) 用于存储性别
-- ✅ ENUM('M', 'F') 或 CHAR(1)

-- 适当规范化/反规范化
-- 根据查询需求权衡
```

###### 方案 D：调整 MySQL 参数
```ini
# 增大排序缓冲区
sort_buffer_size = 256K

# 增大连接缓冲区
join_buffer_size = 256K

# 增大临时表大小限制
tmp_table_size = 64M
max_heap_table_size = 64M
```

##### Step 4：验证效果（Verify the Improvement）
###### 再次 EXPLAIN 对比
```sql
-- 优化前
EXPLAIN SELECT * FROM orders WHERE user_id = 123;
-- type: ALL, rows: 500000, Extra: Using where

-- 优化后（添加索引后）
EXPLAIN SELECT * FROM orders WHERE user_id = 123;
-- type: ref, rows: 15, Extra: NULL  ✅ 显著改善！
```

###### 使用 Benchmark 测试性能
```sql
-- 使用 MySQL 内置的 benchmark 函数
SELECT BENCHMARK(1000000, MD5('test'));
-- 测试 MD5 函数执行 100 万次的时间

-- 使用存储过程模拟多次查询
DELIMITER //
CREATE PROCEDURE test_performance()
BEGIN
  DECLARE i INT DEFAULT 0;
  WHILE i < 1000 DO
    SELECT * FROM orders WHERE user_id = 123;
    SET i = i + 1;
  END WHILE;
END //
DELIMITER ;

CALL test_performance();
```

###### 生产环境监控对比
```sql
-- 持续监控慢查询日志的变化
pt-query-digest --review h=localhost,D=mysql,t=query_review \
  --history h=localhost,D=mysql,t=query_history \
  /var/lib/mysql/slow.log

-- 对比优化前后的指标：
-- 1. 慢查询数量是否下降
-- 2. 平均响应时间是否改善
-- 3. P95/P99 是否降低
-- 4. 服务器资源使用率是否改善
```

#### 常见优化手段总结 📋

##### 全表扫描 → 添加索引
| 优化前 | 优化后 | 提升 |
|--------|--------|------|
| type: ALL, rows: 1000000 | type: ref, rows: 5 | **10x-1000x** |

##### 索引失效 → 修复 SQL
```sql
-- ❌ 索引失效的场景
WHERE YEAR(create_date) = 2026  -- 函数运算导致失效
WHERE name LIKE '%keyword%'     -- 左模糊导致失效
WHERE column + 1 = 10           -- 表达式计算导致失效

-- ✅ 修复方式
WHERE create_date >= '2026-01-01' AND create_date < '2027-01-01'
WHERE name LIKE 'keyword%'
WHERE column = 9
```
预期提升：**5x-50x**

##### 大量回表 → 使用覆盖索引
```sql
-- ❌ 回表查询
SELECT id, name, email FROM users WHERE department = 'IT';
-- 先通过 idx_department 找到主键，再回表查询 name, email

-- ✅ 覆盖索引
CREATE INDEX idx_dept_name_email ON users(department, name, email);
-- 索引已包含所有需要的列，无需回表
```
预期提升：**2x-10x**

##### 文件排序 → 利用索引排序
```sql
-- ❌ 需要额外 filesort
SELECT * FROM orders WHERE user_id = 123 ORDER BY create_time DESC;
-- 如果只有 idx_user_id 索引，需要额外排序

-- ✅ 复合索引有序
CREATE INDEX idx_user_date ON orders(user_id, create_time DESC);
-- 索引本身有序，无需额外排序
```
预期提升：**3x-20x**

##### 临时表 → 优化 GROUP BY / DISTINCT
```sql
-- ❌ 产生临时表
SELECT department, COUNT(*) FROM users GROUP BY department;
-- 如果 department 没有索引，需要临时表

-- ✅ 添加索引避免临时表
CREATE INDEX idx_department ON users(department);
```
预期提升：**2x-5x**

- 📎 [[慢查询优化思路 -MySQLAnki]]



## 10.4 临时表的使用与优化 💾

#### 内部临时表的触发条件

##### 什么时候 MySQL 会创建内部临时表？
MySQL 在执行以下类型的查询时，可能会自动创建内部临时表：

###### 条件 1：GROUP BY + 聚合函数
```sql
-- 如果 group by 的列没有索引
SELECT department, COUNT(*), AVG(salary)
FROM employees
GROUP BY department;
-- 如果 department 列没有索引，需要临时表来存储中间结果
```

###### 条件 2：DISTINCT 去重
```sql
-- 如果 DISTINCT 的列没有索引
SELECT DISTINCT email FROM users;
-- 需要临时表来去重
```

###### 条件 3：UNION / UNION ALL
```sql
-- UNION 需要合并两个结果集并去重
(SELECT id FROM table_a)
UNION
(SELECT id FROM table_b);
-- UNION ALL 不需要去重，但仍可能创建临时表（如果结构不同）
```

###### 条件 4：ORDER BY + LIMIT（无法利用索引排序时）
```sql
-- 当排序列没有索引时
SELECT * FROM products ORDER BY price DESC LIMIT 10;
-- 需要临时表来排序
```

###### 条件 5：派生表（FROM 子查询）
```sql
-- 子查询作为派生表
SELECT * FROM (
  SELECT user_id, COUNT(*) as order_count
  FROM orders
  GROUP BY user_id
) AS t
WHERE order_count > 10;
-- 子查询的结果需要存储在临时表中
```

###### 条件 6：某些窗口函数
```sql
-- MySQL 8.0+ 的窗口函数
SELECT *,
  ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) as rank
FROM employees;
-- 可能需要临时表来计算窗口函数
```

#### 如何检测是否使用了临时表？

##### 方法 1：EXPLAIN 命令
```sql
EXPLAIN SELECT department, COUNT(*) FROM employees GROUP BY department;

-- 关注 Extra 列：
-- Using temporary：使用了内部临时表 ⚠️
-- Using filesort：需要额外的排序操作 ⚠️
-- Using index：使用了覆盖索引（好！）
```

##### 方法 2：Performance Schema 监控
```sql
-- 查看临时表创建统计
SELECT * FROM performance_schema.global_status
WHERE VARIABLE_NAME LIKE 'Created_tmp%';

-- 输出：
-- Created_tmp_disk_tables: 1234      -- 创建的磁盘临时表数量（越少越好）
-- Created_tmp_tables: 56789          -- 创建的总临时表数量
-- Created_tmp_files: 45              -- 临时文件数量

-- 计算磁盘临时表比例
SELECT
  ROUND(
    (SELECT VARIABLE_VALUE FROM performance_schema.global_status
     WHERE VARIABLE_NAME = 'Created_tmp_disk_tables') /
    (SELECT VARIABLE_VALUE FROM performance_schema.global_status
     WHERE VARIABLE_NAME = 'Created_tmp_tables') * 100,
    2
  ) AS disk_tmp_percentage;
-- 目标：< 10%（大部分临时表应该在内存中）
```

##### 方法 3：Status 命令
```sql
SHOW STATUS LIKE 'Created_tmp%';
-- Created_tmp_disk_tables: 1234
-- Created_tmp_tables: 56789
-- Created_tmp_files: 45
```

#### 内存临时表 vs 磁盘临时表 ⚡

##### 内存临时表（Memory Engine）
- **存储位置**：内存（RAM）
- **引擎**：MEMORY（HEAP）或 TempTable（MySQL 8.0+）
- **速度**：⚡⚡⚡ **非常快**（微秒级操作）
- **大小限制**：由以下参数控制

###### tmp_table_size
```sql
SHOW VARIABLES LIKE 'tmp_table_size';
-- 默认值：16MB（MySQL 5.7）/ 16MB（MySQL 8.0）
-- 含义：单个临时表的最大内存大小
```

###### max_heap_table_size
```sql
SHOW VARIABLES LIKE 'max_heap_table_size';
-- 默认值：16MB
-- 含义：用户创建的 MEMORY 表的最大大小
-- 注意：临时表的大小限制是 min(tmp_table_size, max_heap_table_size)
```

###### internal_tmp_mem_storage_engine（MySQL 8.0+）
```sql
SHOW VARIABLES LIKE 'internal_tmp_mem_storage_engine';
-- 可选值：MEMORY（传统）| TempTable（推荐）
-- TempTable 引擎的优势：
-- - 支持 VARCHAR/VARBINARY 的可变长度存储
-- - 减少内存碎片
-- - 更好的内存管理
```

##### 磁盘临时表
- **触发条件**：临时表超过内存限制（`min(tmp_table_size, max_heap_table_size)`）
- **存储位置**：磁盘（tmpdir 目录）
- **引擎**：InnoDB（默认）或 MyISAM
- **速度**：🐢 **慢很多**（涉及磁盘 IO）
- **影响**：查询性能显著下降

###### tmpdir 参数
```sql
SHOW VARIABLES LIKE 'tmpdir';
-- 默认值：/tmp（Linux）或 C:\Windows\Temp（Windows）
-- 建议：将 tmpdir 放到最快的磁盘（如 SSD）
```

###### 临时表存储引擎
```sql
SHOW VARIABLES LIKE 'internal_tmp_disk_storage_engine';
-- MySQL 8.0+ 可选：
-- INNODB（默认，支持事务）
-- MYISAM（老版本默认）
```

#### 临时表性能优化策略 ✅

##### 策略 1：优化 SQL 避免临时表
###### 避免 SELECT *
```sql
-- ❌ 查询所有列（可能产生大临时表）
SELECT * FROM users GROUP BY department;

-- ✅ 只查询需要的列（减小临时表大小）
SELECT department, COUNT(*) FROM users GROUP BY department;
```

###### 为 GROUP BY/DISTINCT 列添加索引
```sql
-- ❌ 没有索引，需要临时表
SELECT department, COUNT(*) FROM employees GROUP BY department;

-- ✅ 添加索引后，可能避免临时表
CREATE INDEX idx_department ON employees(department);
-- 再次执行 EXPLAIN，Extra 列可能变为 "Using index"
```

###### 使用覆盖索引
```sql
-- 创建覆盖索引（包含所有查询的列）
CREATE INDEX idx_dept_salary ON employees(department, salary);

-- 查询时直接从索引获取数据，无需临时表
SELECT department, AVG(salary) FROM employees GROUP BY department;
-- Extra: Using index; Using temporary（可能仍需要临时表做聚合）
-- 但至少避免了回表
```

##### 策略 2：适当增大内存限制
```ini
# my.cnf 配置
# 增大临时表内存限制（注意：每个连接都可能创建临时表！）
tmp_table_size = 64M
max_heap_table_size = 64M

# ⚠️ 不要设置过大！
# 假设 max_connections=500，每个连接创建一个 64M 的临时表
# 最坏情况：500 * 64M = 32GB 内存！
# 所以要根据实际情况调整
```

##### 策略 3：使用 UNION ALL 替代 UNION
```sql
-- ❌ UNION 会去重，需要临时表
(SELECT user_id FROM orders WHERE status = 'paid')
UNION
(SELECT user_id FROM refunds WHERE status = 'approved');

-- ✅ UNION ALL 不去重（如果确定无重复）
(SELECT user_id FROM orders WHERE status = 'paid')
UNION ALL
(SELECT user_id FROM refunds WHERE status = 'approved');
-- 性能提升：2x-5x（取决于数据量）
```

##### 策略 4：优化派生表/子查询
```sql
-- ❌ 使用子查询（可能创建临时表）
SELECT * FROM (
  SELECT user_id, COUNT(*) as cnt
  FROM orders
  GROUP BY user_id
) t WHERE cnt > 10;

-- ✅ 使用 WITH 子句（MySQL 8.0+ Common Table Expression）
WITH user_order_count AS (
  SELECT user_id, COUNT(*) as cnt
  FROM orders
  GROUP BY user_id
)
SELECT * FROM user_order_count WHERE cnt > 10;
-- 优化器可能更好地优化 CTE
```

##### 策略 5：考虑使用会话级别的自定义临时表
```sql
-- 对于复杂的报表查询，可以手动创建临时表
CREATE TEMPORARY TABLE temp_report (
  user_id BIGINT,
  order_count INT,
  total_amount DECIMAL(12,2),
  INDEX (user_id)
) ENGINE=Memory;

-- 分批填充数据
INSERT INTO temp_report
SELECT user_id, COUNT(*), SUM(amount)
FROM orders
WHERE create_date >= '2026-01-01'
GROUP BY user_id;

-- 基于临时表进行后续查询（更快）
SELECT * FROM temp_report WHERE order_count > 100;

-- 用完即删（会话结束自动删除）
DROP TEMPORARY TABLE temp_report;
```

#### 临时表监控与诊断 📊

##### 实时监控脚本
```sql
-- 创建一个诊断视图
CREATE OR REPLACE VIEW v_tmp_table_stats AS
SELECT
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status
   WHERE VARIABLE_NAME = 'Created_tmp_tables') AS total_tmp_tables,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status
   WHERE VARIABLE_NAME = 'Created_tmp_disk_tables') AS disk_tmp_tables,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status
   WHERE VARIABLE_NAME = 'Created_tmp_files') AS tmp_files,
  ROUND(
    (SELECT VARIABLE_VALUE FROM performance_schema.global_status
     WHERE VARIABLE_NAME = 'Created_tmp_disk_tables') /
    NULLIF((SELECT VARIABLE_VALUE FROM performance_schema.global_status
     WHERE VARIABLE_NAME = 'Created_tmp_tables'), 0) * 100,
    2
  ) AS disk_tmp_ratio_pct;

-- 定期查询
SELECT * FROM v_tmp_table_stats;
-- 关注 disk_tmp_ratio_pct，如果 > 25% 需要优化
```

##### 优化前后对比
```
优化前：
  Created_tmp_tables: 100000
  Created_tmp_disk_tables: 45000
  磁盘临时表比例: 45% ❌

优化后（添加索引 + 优化 SQL）：
  Created_tmp_tables: 50000
  Created_tmp_disk_tables: 2000
  磁盘临时表比例: 4% ✅
```

- 📎 [[临时表的使用场景 -MySQLAnki]]



## 🎯 总结：性能调优优先级矩阵

### 第一优先级（P0 - 立即执行）⚡
1. ✅ **合理设置 Buffer Pool 大小**（物理内存的 60-80%）
2. ✅ **正确配置 innodb_io_capacity**（匹配磁盘真实能力）
3. ✅ **开启慢查询日志**（long_query_time = 1）
4. ✅ **为关键查询添加合适的索引**

### 第二优先级（P1 - 尽快执行）📈
5. 🔄 **优化 Top 10 慢查询**（使用 pt-query-digest 分析）
6. 🔄 **调整脏页刷盘策略**（设置 lwm 水位线）
7. 🔄 **评估是否需要分区表**（千万级大表）
8. 🔄 **优化连接数和超时配置**

### 第三优先级（P2 - 持续改进）🔍
9. 📊 **建立性能基线和监控体系**
10. 📊 **定期审查索引使用情况**
11. 📊 **评估分库分表的必要性**
12. 📊 **参数调优后的回归测试**

---

## 🔗 衍生笔记与关联知识

### 本模块关联的 Anki 卡片
- 📎 [[Buffer Pool 的改进 LRU 算法 -MySQLAnki]]
- 📎 [[慢查询优化思路 -MySQLAnki]]
- 📎 [[分区表的使用场景 -MySQLAnki]]
- 📎 [[分库分表 -MySQLAnki]]
- 📎 [[大表 DDL 优化 -MySQLAnki]]
- 📎 [[临时表的使用场景 -MySQLAnki]]

### 相关模块
- [[MySQL查询优化模块-超详细思维导图-AI精析]] - Explain 执行计划、Join 优化、排序优化
- [[MySQL索引体系模块]] - B+ 树原理、索引设计原则、覆盖索引
- [[MySQL锁机制模块]] - 各种锁的类型、死锁排查
- [[MySQL日志系统模块-超详细思维导图-AI精析]] - Redo Log、Binlog、Undo Log