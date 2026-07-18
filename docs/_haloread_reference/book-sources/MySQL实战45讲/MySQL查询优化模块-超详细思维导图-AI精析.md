---
id: 202603280000
title: MySQL查询优化模块-超详细思维导图
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[MySQL查询优化模块-超详细思维导图]]"
status: published
ai_generated: true
---

关联源素材：[[MySQL实战45讲]]

# MySQL 查询优化模块 - 超详细思维导图

## 🎯 模块概览

> **核心目标**：让 MySQL 查询从"能用"到"高效"，掌握 Explain 分析 + 场景化优化技巧

**五大核心场景**：
1. ⭐⭐⭐ **Explain 执行计划完全解读**（最重要）
2. 📊 **ORDER BY / GROUP BY 排序优化**
3. 🔗 **JOIN 连接优化**
4. 🔢 **COUNT(*) 性能优化**
5. 📄 **分页查询优化**



#### select_type 字段 📋

##### 含义
- 查询的**类型**（type of query）
- 标识当前查询在整个语句中的角色

##### 常见值详解

###### SIMPLE ✅
- **定义**：简单查询（不包含子查询或 UNION）
- **场景**：最基本的 SELECT 语句
- **示例**：`SELECT * FROM users WHERE id = 1`
- **性能影响**：无额外开销

###### PRIMARY 👑
- **定义**：最外层查询
- **场景**：包含子查询或 UNION 的复杂查询的最外层
- **示例**：
  ```sql
  EXPLAIN SELECT * FROM t1 WHERE id IN (SELECT id FROM t2);
  -- 外层查询 select_type = PRIMARY
  ```

###### SUBQUERY 📦
- **定义**：子查询（在 SELECT 列表中）
- **特点**：只执行一次，结果可缓存
- **示例**：
  ```sql
  EXPLAIN SELECT *, (SELECT COUNT(*) FROM orders) AS cnt FROM users;
  -- 子查询 select_type = SUBQUERY
  ```

###### DEPENDENT SUBQUERY ⚠️
- **定义**：相关子查询（依赖外部查询的值）
- **特点**：外部查询每行都重新执行一次子查询
- **性能问题**：可能产生 N+1 问题
- **示例**：
  ```sql
  EXPLAIN SELECT * FROM t1 WHERE EXISTS (
    SELECT 1 FROM t2 WHERE t2.id = t1.id
  );
  -- 子查询 select_type = DEPENDENT SUBQUERY
  ```
- **优化建议**：改用 JOIN 替代

###### UNIONS 🤝
- **定义**：UNION 中的第二个及后面的查询
- **场景**：UNION 合并多个结果集
- **示例**：
  ```sql
  EXPLAIN SELECT id FROM t1 UNION SELECT id FROM t2;
  -- 第二个查询 select_type = UNION
  ```

###### UNION RESULT 📊
- **定义**：UNION 的结果集
- **特殊值**：table 字段显示为 `<union1,2>`
- **含义**：从临时表中读取结果

##### 优化策略
- 尽量将 DEPENDENT SUBQUERY 改为 JOIN
- 避免过深的子查询嵌套
- 使用 EXPLAIN FORMAT=JSON 查看更详细的依赖关系



#### type 字段 ⭐⭐⭐ **最重要的字段**

##### 含义
- **访问类型**（access type）
- 表示 MySQL 如何查找表中的行
- 直接决定查询性能的好坏

##### 性能等级排序（从优到差）🏆

###### Level 1: system 🚀（忽略）
- **定义**：表只有一行（系统表）
- **引擎限制**：仅 MyISAM 或 Memory 引擎
- **实际意义**：生产环境几乎遇不到
- **示例**：`SELECT * FROM mysql.user`（某些系统表）

###### Level 2: const ⭐ **优秀**
- **定义**：通过索引**一次**就找到了目标行
- **触发条件**：
  - 主键或唯一索引的等值查询
  - 索引列不能为 NULL
- **示例**：
  ```sql
  -- 主键等值查询
  EXPLAIN SELECT * FROM users WHERE id = 1;
  -- type = const

  -- 唯一索引等值查询
  EXPLAIN SELECT * FROM users WHERE unique_email = 'test@example.com';
  -- type = const
  ```
- **性能特征**：O(1) 时间复杂度，最快
- **优化目标**：尽可能达到 const 级别

###### Level 3: eq_ref ⭐ **优秀**
- **定义**：对于前面的每一行，从该表中**精确读取一行**
- **触发条件**：
  - JOIN 操作时使用主键或唯一索引
  - 所有索引列都被使用（联合索引的所有列）
- **示例**：
  ```sql
  EXPLAIN SELECT * FROM t1 JOIN t2 ON t1.id = t2.pk;
  -- t2 表的 type = eq_ref
  ```
- **性能特征**：每行只需一次索引查找
- **适用场景**：JOIN 关联主键/唯一索引

###### Level 4: ref ⭐ **良好**
- **定义**：对于前面的每一行，从该表中**读取匹配行**（可能多行）
- **触发条件**：
  - 使用非唯一索引或普通索引
  - 等值查询（=、IN）
- **示例**：
  ```sql
  -- 普通索引等值查询
  EXPLAIN SELECT * FROM users WHERE name = '张三';
  -- type = ref

  -- 联合索引最左前缀匹配
  EXPLAIN SELECT * FROM orders WHERE user_id = 100;
  -- idx(user_id, status)，type = ref
  ```
- **性能特征**：需要扫描索引的部分范围
- **优化建议**：确保索引的选择性（distinct 值多）

###### Level 5: range ⭐ **还行**
- **定义**：只检索给定范围的行
- **触发条件**：
  - 使用索引进行范围查询
  - 操作符：>、<、>=、<=、BETWEEN、IN、LIKE 'prefix%'
- **示例**：
  ```sql
  -- 范围查询
  EXPLAIN SELECT * FROM users WHERE id > 100 AND id < 200;
  -- type = range

  -- IN 查询
  EXPLAIN SELECT * FROM users WHERE id IN (1, 2, 3);
  -- type = range

  -- LIKE 前缀匹配
  EXPLAIN SELECT * FROM users WHERE name LIKE '张%';
  -- type = range（如果 name 有索引）
  ```
- **性能注意**：范围越大，扫描行数越多
- **优化技巧**：缩小范围条件，减少扫描量

###### Level 6: index ⚠️ **需要注意**
- **定义**：**全索引扫描**（遍历整棵索引树）
- **触发条件**：
  - 查询的列正好是索引列（覆盖索引但需全部扫描）
  - ORDER BY/GROUP BY 使用了索引但需要全扫描
- **示例**：
  ```sql
  -- 只查索引列（覆盖索引）
  EXPLAIN SELECT idx_col FROM table;
  -- type = index, Extra = Using index

  -- 无 WHERE 条件的 GROUP BY
  EXPLAIN SELECT status, COUNT(*) FROM users GROUP BY status;
  -- type = index（如果 status 有索引）
  ```
- **性能对比**：比 ALL 好（索引文件通常比数据文件小），但仍较慢
- **优化方向**：增加 WHERE 条件缩小范围

###### Level 7: ALL ❌ **最差**
- **定义**：**全表扫描**（遍历表的每一行）
- **触发条件**：
  - 没有任何索引可用
  - 索引失效（函数操作、类型转换、LIKE '%xxx'）
- **示例**：
  ```sql
  -- 无索引列查询
  EXPLAIN SELECT * FROM users WHERE age > 20;
  -- 如果 age 无索引 → type = ALL

  -- 索引列上使用函数
  EXPLAIN SELECT * FROM users WHERE YEAR(create_time) = 2024;
  -- 即使 create_time 有索引 → type = ALL（索引失效）
  ```
- **性能问题**：随着数据量增长，线性变慢
- **必须优化**：添加合适的索引或重写 SQL

##### **优化目标总结** 🎯
- **理想级别**：const、eq_ref、ref
- **可接受级别**：range
- **需要优化**：index、ALL
- **检查命令**：`EXPLAIN ... \G` 查看 type 字段



#### key 字段 🗝️

##### 含义
- **实际使用**到了哪个索引（actual index used）
- MySQL 优化器最终选择的索引

##### 特殊情况
- **NULL**：表示没有使用索引（全表扫描）
- **PRIMARY**：使用了主键索引

##### 为什么不使用可能的索引？
1. **统计信息不准**：ANALYZE TABLE 更新统计信息
2. **优化器判断成本更高**：回表代价太大
3. **索引选择性差**：重复值太多，不如全表扫描

##### 强制使用指定索引
```sql
-- 强制使用特定索引
SELECT * FROM users FORCE INDEX(idx_name) WHERE name = '张三';

-- 忽略某个索引
SELECT * FROM users IGNORE INDEX(idx_age) WHERE age > 20;
```

##### 优化建议
- 定期执行 `ANALYZE TABLE` 更新统计信息
- 关注 key 是否为 NULL，及时添加索引



#### rows 字段 📊

##### 含义
- **预估**需要扫描的行数（estimated rows to examine）
- MySQL 优化器根据统计信息估算

##### 重要特性
- 是**估算值**，不是精确值
- 基于 Index Statistics（索引统计信息）
- 可能与实际行数有较大偏差

##### 影响因素
- **表的统计信息准确性**：`ANALYZE TABLE` 更新
- **索引的选择性**：distinct 值越多越准确
- **WHERE 条件的过滤性**：过滤条件越强，rows 越小

##### 优化目标 🎯
- **越小越好**：理想情况下 rows 接近实际返回行数
- **对比基准**：rows / 返回行数 ≈ 1 为最佳
- **监控指标**：rows 过大说明需要优化索引或 SQL

##### 实战示例
```sql
-- 优化前
EXPLAIN SELECT * FROM orders WHERE user_id = 100;
-- rows: 50000（全表 100 万行，user_id 选择性差）

-- 添加复合索引后
CREATE INDEX idx_user_status ON orders(user_id, status);
EXPLAIN SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';
-- rows: 50（大幅减少！）
```



### Explain 实战检查清单 ✅

#### 快速诊断步骤
1. **查看 type**：是否达到 ref/range 以上？
2. **查看 key**：是否使用了正确的索引？
3. **查看 rows**：预估扫描行数是否合理？
4. **查看 Extra**：是否有 filesort/temporary？
5. **查看 key_len**：联合索引是否充分利用？

#### 常见问题速查
| 问题现象 | 可能原因 | 解决方案 |
|----------|----------|----------|
| type = ALL | 无索引或索引失效 | 添加索引或修复 SQL |
| key = NULL | 没有使用任何索引 | 检查索引是否存在 |
| Extra = filesort | ORDER BY 未命中索引 | 调整索引或减少排序列 |
| Extra = temporary | GROUP BY 未命中索引 | 为分组列建索引 |
| rows 过大 | 索引选择性差 | 优化索引或添加复合条件 |
| key_len 过短 | 联合索引未充分利用 | 调整 SQL 或索引顺序 |

#### 进阶分析工具
```sql
-- 1. JSON 格式（更详细）
EXPLAIN FORMAT=JSON SELECT * FROM users WHERE id = 1;

-- 2. 分析执行成本
SHOW STATUS LIKE 'Handler_read%';
SHOW STATUS LIKE 'Sort%';

-- 3. Optimizer Trace（MySQL 5.6+）
SET optimizer_trace="enabled=on";
-- 执行你的 SQL
SELECT * FROM information_schema.OPTIMIZER_TRACE\G
```

- 📎 [[Explain 执行计划解读 -MySQLAnki]]



#### 方式 2：filesort（文件排序）⚠️ **尽量避免**

##### 定义
- MySQL 需要在**内存或磁盘**上进行额外排序
- 当 ORDER BY 无法使用索引时触发

##### filesort 的两种算法

###### 算法 1：双路排序（Two-Pass Sort）📖 **历史算法**
- **适用版本**：MySQL 4.1 之前（已淘汰）
- **执行流程**：
  1. **第一次扫描**：根据行指针和排序键值进行排序
  2. **第二次扫描**：根据排序后的指针去取完整数据行
- **缺点**：
  - 两次磁盘 I/O（随机读）
  - 效率较低，已被单路排序取代

###### 算法 2：单路排序（One-Pass Sort）⭐ **默认算法**
- **适用版本**：MySQL 4.1+（默认启用）
- **执行流程**：
  1. **一次性读取**：取出排序列 + SELECT 需要的所有列
  2. **内存排序**：在 sort_buffer 中完成排序
  3. **直接输出**：排序后直接返回结果
- **优点**：
  - 只需一次 I/O（避免了第二次随机读）
  - 效率比双路排序高很多
- **缺点**：
  - 占用更多内存（需要存放所有列的数据）
  - 大表排序可能导致内存不足

##### 单路排序的关键参数

###### max_length_for_sort_data
- **默认值**：1024 字节
- **作用**：控制单路排序的最大行长度
- **机制**：
  - 行长度 ≤ 该值 → 使用**单路排序**
  - 行长度 > 该值 → 退化为**双路排序**
- **调优建议**：
  - 增大该值：更多情况下使用单路排序（但内存消耗增大）
  - 减少该值：节省内存，但可能退化为双路排序

###### sort_buffer_size
- **默认值**：256KB（可能因系统而异）
- **作用**：排序操作的缓冲区大小
- **调优建议**：
  - 增大到 2M-8M：适合中等规模排序
  - 不要设置过大：每个连接都会分配，可能导致内存耗尽
  - 监控 `Sort_merge_passes`：如果值很大，说明需要增大

##### filesort 的性能影响
- **内存排序**：消耗 CPU + 内存（相对较快）
- **磁盘排序**：当排序数据超过 sort_buffer 时，使用临时文件（很慢）
- **监控指标**：
  ```sql
  SHOW STATUS LIKE 'Sort_rows';        -- 总排序行数
  SHOW STATUS Like 'Sort_range';       -- 范围排序次数
  SHOW STATUS Like 'Sort_scan';        -- 全表排序次数
  SHOW STATUS Like 'Sort_merge_passes'; -- 磁盘归并次数（应接近 0）
  ```



#### 技巧 2：减少排序的数据量 📉

##### 方法 1：WHERE 先过滤
```sql
-- ❌ 先排序再过滤（排序大量无用数据）
SELECT * FROM orders ORDER BY amount DESC LIMIT 10;

-- ✅ 先过滤再排序（只排序有效数据）
SELECT * FROM orders 
WHERE status = 'completed'  -- 先过滤
ORDER BY amount DESC 
LIMIT 10;
-- 排序数据量大幅减少
```

##### 方法 2：只查必要的列
```sql
-- ❌ 排序所有列（占用大量 sort_buffer）
SELECT * FROM orders ORDER BY create_time LIMIT 100;

-- ✅ 只排序需要的列（延迟关联）
SELECT o.* FROM orders o 
JOIN (
  SELECT id FROM orders ORDER BY create_time LIMIT 100
) tmp ON o.id = tmp.id;
-- 内层只排 id 列，外层再关联取完整数据
```

##### 方法 3：使用 LIMIT 限制
```sql
-- ✅ 配合 LIMIT 减少排序量
SELECT * FROM users ORDER BY score DESC LIMIT 10;
-- 只需维护 TOP 10 的堆结构，不需要全排序
```



#### 技巧 4：GROUP BY + ORDER BY 联合优化 👥

##### 常见陷阱
```sql
-- ❌ GROUP BY 和 ORDER BY 列不同
SELECT department, COUNT(*), AVG(salary)
FROM employees
GROUP BY department
ORDER BY AVG(salary) DESC;
-- Extra: Using temporary; Using filesort（双重打击！）
```

##### 优化方案
```sql
-- 方案1：调整索引同时满足两者
CREATE INDEX idx_dept_sal ON employees(department, salary);
-- 但通常很难同时满足 GROUP BY 和 ORDER BY

-- 方案2：使用衍生表（牺牲空间换时间）
SELECT * FROM (
  SELECT department, COUNT(*) AS cnt, AVG(salary) AS avg_sal
  FROM employees
  GROUP BY department
) tmp
ORDER BY avg_sal DESC;
-- 至少减少了临时表的大小

-- 方案3：应用程序层排序（适合小数据量）
-- 先查 GROUP BY 结果，在应用代码中排序
```



## 9.3 JOIN 优化 🔗

### JOIN 的几种算法详解

#### 算法 1：Simple Nested-Loop Join (SNLJ) 🐌 **最慢**

##### 算法伪代码
```
for each row in table_a:           -- 外层循环（驱动表）
    for each row in table_b:       -- 内层循环（被驱动表）
        if match(join_condition):
            output joined_row
```

##### 复杂度分析
- **时间复杂度**：O(M × N)
  - M = 驱动表行数
  - N = 被驱动表行数
- **IO 次数**：M 次（每次内层表全表扫描）

##### 性能问题
- 被驱动表被全表扫描 M 次
- 对于大表，效率极低
- **实际很少使用**（MySQL 会自动升级为 BNLJ）

##### 适用场景
- 两表都很小（< 100 行）
- 没有可用索引的特殊情况



#### 算法 3：Batched Key Access Join (BKA) ⚡ **推荐**

##### 优化思路
- 利用**被驱动表的索引**加速查找
- 结合 **MRR（Multi-Range Read）** 优化

##### 算法流程
```
1. 从驱动表批量取出 join_key 值
2. 将这些 key 收集到 range buffer
3. 对 key 进行排序（MRR 优化关键步骤）
4. 用排序后的 key 进行**范围查询**被驱动表索引
5. 将查询结果与驱动表数据合并输出
```

##### 核心优势
- **利用索引**：被驱动表的索引加速查找
- **MRR 优化**：将随机 IO 转为顺序 IO
- **批量操作**：减少交互次数

##### 依赖关系
```
BKA 算法
├── 依赖 MRR 优化（Multi-Range Read）
│   ├── 将随机访问转为顺序访问
│   ├── 提升磁盘 IO 性能
│   └── 参数：read_rnd_buffer_size
└── 依赖被驱动表有索引
    ├── 无索引则退化回 BNLJ
    └── 索引质量影响性能
```

##### 启用配置
```sql
-- 查看当前状态
SHOW VARIABLES LIKE 'optimizer_switch%';

-- 启用 BKA（需要开启 MRR）
SET optimizer_switch='mrr=on,mrr_cost_based=off,batched_key_access=on';

-- 或者永久修改 my.cnf
[mysqld]
optimizer_switch="mrr=on,mrr_cost_based=off,batched_key_access=on"
```

##### MRR 优化原理详解
```sql
-- 场景：t2 表有索引 idx_b(b)
-- 驱动表 t1 取出 b 值：[100, 50, 200, 150, 80]

-- 无 MRR（随机访问）：
SELECT * FROM t2 WHERE b IN (100, 50, 200, 150, 80);
-- 按 b=100, 50, 200... 顺序查找 → 随机 IO

-- 有 MRR（顺序访问）：
1. 将 [100, 50, 200, 150, 80] 放入 read_rnd_buffer
2. 排序后得到 [50, 80, 100, 150, 200]
3. 按 b=50, 80, 100, 150, 200 顺序查找 → 顺序 IO ✅
-- 性能提升：接近顺序读的速度
```

##### 性能对比
| 算法 | 被驱动表访问方式 | IO 类型 | Buffer Pool 影响 |
|------|------------------|---------|------------------|
| SNLJ | 全表扫描 M 次 | 随机读 | 严重污染 |
| BNLJ | 全表扫描 M/N 次 | 顺序读 | 污染 |
| **BKA** | **索引范围查询** | **顺序读（MRR）** | **轻微** |



### JOIN 优化实战指南 📋

#### 优化建议 Top 5

##### 1️⃣ 确保**驱动表是小表** 🐭
- **原则**：小表驱动大表（Nested Loop 的基本优化）
- **MySQL 自动选择**：优化器会自动选择较小的表作为驱动表
- **手动控制**：使用 `STRAIGHT_JOIN` 强制指定
  ```sql
  -- 强制 t1 作为驱动表
  SELECT STRAIGHT_JOIN * FROM t1 JOIN t2 ON t1.id = t2.t1_id;
  ```

##### 2️⃣ **在被驱动表的连接列上建立索引** 🗝️
- **效果**：BNLJ → BKA（质的飞跃）
- **索引类型**：普通索引即可（唯一索引更好）
- **示例**：
  ```sql
  -- 优化前：BNLJ（慢）
  EXPLAIN SELECT * FROM t1 JOIN t2 ON t1.a = t2.b;
  -- Extra: Using join buffer (Block Nested Loop)

  -- 添加索引后：BKA（快）
  ALTER TABLE t2 ADD INDEX idx_b(b);
  -- Extra: （无 join buffer，使用索引查找）
  ```

##### 3️⃣ **只查询需要的列** 📝
- **避免 SELECT ***：减少 Join Buffer 占用
- **减少数据传输**：降低网络 IO
- **示例**：
  ```sql
  -- ❌ 查询所有列
  SELECT * FROM t1 JOIN t2 ON t1.id = t2.t1_id;

  -- ✅ 只查需要的列
  SELECT t1.name, t2.amount 
  FROM t1 JOIN t2 ON t1.id = t2.t1_id;
  ```

##### 4️⃣ **适当增大 Join Buffer** 💾
- **参数**：`join_buffer_size`
- **默认值**：256 KB（偏小）
- **建议值**：1M - 4M（根据并发量调整）
- **注意事项**：
  - 每个 JOIN 操作都会分配一个 Buffer
  - 并发高时不要设置过大
  - 公式估算：`join_buffer_size × max_connections` 不能超过可用内存

##### 5️⃣ **考虑使用 BKA 或 Hash Join** 🚀
- **BKA**：被驱动表有索引时启用
- **Hash Join**：MySQL 8.0+，无索引的大表 JOIN
- **配置**：
  ```sql
  -- 推荐：全面启用现代优化
  SET optimizer_switch='
    mrr=on,
    mrr_cost_based=off,
    batched_key_access=on,
    hash_join=on
  ';
  ```



#### JOIN 性能监控与诊断

##### 关键监控指标
```sql
-- 1. 全表 JOIN 次数（应该接近 0）
SHOW GLOBAL STATUS LIKE 'Select_full_join';

-- 2. 全表扫描次数
SHOW GLOBAL STATUS LIKE 'Select_scan';

-- 3. 范围 JOIN 次数
SHOW GLOBAL STATUS LIKE 'Select_range';

-- 4. Join Buffer 使用情况
SHOW GLOBAL STATUS LIKE 'Select_full_range_join';
```

##### 诊断 SQL
```sql
-- 查找使用 BNLJ 的慢查询
SELECT * FROM information_schema.PROCESSLIST
WHERE INFO LIKE '%join%'
AND TIME > 5;  -- 执行超过 5 秒的

-- 分析特定查询的 JOIN 算法
EXPLAIN FORMAT=JSON 
SELECT * FROM t1 JOIN t2 ON t1.a = t2.b\G
-- 查看 "blocking_optimization" 和 "nested_loop" 信息
```

- 📎 [[Join 语句优化 -MySQLAnki]]
- 📎 [[Join 语句的原理 -MySQLAnki]]



### 优化方案一览 🛠️

#### 方案 1：近似值估算（可接受误差的场景）📊

##### 适用场景
- 数据大屏显示（如"约 100 万用户"）
- 统计报表（不需要精确值）
- 后台管理系统的概览页面

##### 方法 1：EXPLAIN 的 rows 估算
```sql
-- 使用 EXPLAIN 的 rows 字段作为估算值
EXPLAIN SELECT COUNT(*) FROM users;
-- 输出的 rows 字段就是估算值

-- 示例输出：
-- rows: 1048576（估算约 100 万行）
-- 实际可能是 1050000 或 1030000（误差 1-2%）
```

**优点**：
- ⚡ 极快（毫秒级）
- 💰 零成本（不需要额外存储）

**缺点**：
- ⚠️ 不是精确值
- 📉 误差可能较大（取决于统计信息的准确性）

##### 方法 2：information_schema 查询
```sql
-- 从 information_schema 获取估算行数
SELECT 
  TABLE_ROWS,
  ROUND(DATA_LENGTH/1024/1024, 2) AS size_mb
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'mydb' 
  AND TABLE_NAME = 'users';
```

**参数说明**：
- `TABLE_ROWS`：估算行数（InnoDB 是近似值）
- `DATA_LENGTH`：数据文件大小（MB）
- 更新时机：执行 `ANALYZE TABLE` 后更新

**优点**：
- 可以同时获取表大小信息
- 适用于监控脚本

**缺点**：
- 同样是估算值
- 需要定期 ANALYZE TABLE 保持准确

##### 方法 3：SHOW TABLE STATUS
```sql
-- 快速获取表信息
SHOW TABLE STATUS LIKE 'users'\G
-- 关注 Rows 字段（估算行数）
```



#### 方案 3：使用缓存（Redis/Memcached）⚡

##### 架构设计
```
Application Layer
├── 读请求 → 查 Redis 缓存
│   ├── 命中 → 直接返回（< 1ms）
│   └── 未命中 → 查数据库 → 写入缓存 → 返回
└── 写请求 → 更新数据库 → 删除/更新缓存
```

##### Redis 实现示例

###### 基础版：简单缓存
```python
# Python 伪代码
import redis
import mysql.connector

r = redis.Redis(host='localhost', port=6379, db=0)
db = mysql.connector.connect(...)

def get_user_count():
    # 1. 先查缓存
    count = r.get('user:count')
    if count is not None:
        return int(count)
    
    # 2. 缓存未命中，查数据库
    cursor = db.cursor()
    cursor.execute("SELECT COUNT(*) FROM users")
    count = cursor.fetchone()[0]
    
    # 3. 写入缓存（设置过期时间）
    r.setex('user:count', 300, count)  # 缓存 5 分钟
    return count
```

###### 进阶版：Write-Through 策略
```python
def insert_user(name, email):
    # 1. 插入数据库
    cursor = db.cursor()
    cursor.execute("INSERT INTO users (name, email) VALUES (%s, %s)", (name, email))
    db.commit()
    
    # 2. 同步更新缓存（原子操作）
    r.incr('user:count')
    # 或者删除缓存让下次读取时重建
    # r.delete('user:count')

def delete_user(user_id):
    # 1. 删除数据库记录
    cursor = db.cursor()
    cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
    db.commit()
    
    # 2. 同步更新缓存
    r.decr('user:count')
```

##### 缓存策略选择

| 策略 | 写入时 | 读取时 | 一致性 | 复杂度 |
|------|--------|--------|--------|--------|
| **Cache Aside** | 删除缓存 | 先读缓存，未命中读 DB | 最终一致 | 中等 |
| **Read Through** | 更新缓存 | 缓存负责加载 | 强一致 | 复杂 |
| **Write Through** | 同步更新缓存 | 先读缓存 | 强一致 | 中等 |
| **Write Behind** | 异步更新缓存 | 先读缓存 | 最终一致 | 简单 |

##### 缓存过期时间设置
```bash
# 高频变化的数据：短过期时间
SETEX user:count 60 1000000      # 60 秒

# 低频变化的数据：长过期时间
SETEX product_count 3600 5000    # 1 小时

# 实时性要求高：不过期 + 主动失效
SET user:count 1000000           # 不过期
# 写入时主动 DEL 或更新
```

##### 缓存一致性保障
```python
# 方案1：延迟双删（解决并发问题）
def update_with_double_delete():
    # 1. 先删除缓存
    r.delete('user:count')
    
    # 2. 更新数据库
    db_execute("INSERT INTO users ...")
    
    # 3. 延迟后再删一次（防止步骤1和2之间有人读了旧缓存）
    time.sleep(0.5)
    r.delete('user:count')

# 方案2：使用 Redis 事务（Lua 脚本）
lua_script = """
local current = redis.call('GET', KEYS[1])
if current == false then
    current = 0
end
redis.call('SETEX', KEYS[1], ARGV[2], current + ARGV[1])
return current + ARGV[1]
"""
r.eval(lua_script, 1, 'user:count', 1, 300)
```



### COUNT 优化决策树 🌳

```
需要精确值吗？
├─ 否 → 使用近似值
│   ├─ 快速估算 → EXPLAIN rows / information_schema
│   └─ 展示用途 → 四舍五入到万/亿单位
│
└─ 是 → 需要精确计数
    ├─ 数据量 < 100 万？
    │   └─ 是 → 直接 COUNT(*)（可接受）
    │
    └─ 数据量 ≥ 100 万？
        ├─ 读多写少？
        │   └─ 是 → 方案2：计数器表（推荐）
        │
        ├─ 读写均衡？
        │   └─ 是 → 方案3：Redis 缓存（推荐）
        │
        └─ 超大表（亿级）？
            └─ 是 → 方案4：分区表 + 预计算
```



## 9.5 分页查询优化 📄

### 传统分页的性能陷阱 🕳️

#### 标准 LIMIT 分页语法
```sql
-- 基本语法
SELECT * FROM table_name 
ORDER BY column_name 
LIMIT offset, page_size;

-- 示例：第 1000001 页，每页 10 条
SELECT * FROM orders 
ORDER BY id 
LIMIT 9999990, 10;
```

#### 性能问题剖析

##### MySQL 的 LIMIT 执行机制
```
LIMIT 9999990, 10 的执行过程：

1. MySQL 按照 ORDER BY id 扫描索引
2. 按顺序读取前 9999990 + 10 = 10000000 行
3. 丢弃前 9999990 行（纯浪费！）
4. 返回最后 10 行

问题：
- 前 9999990 行的读取完全是浪费
- 随着 offset 增大，性能线性下降
- offset = 1000000 时，可能需要数秒甚至更久
```

##### 性能测试数据（参考）
| Offset | 耗时（百万级表） | 扫描行数 |
|--------|-------------------|----------|
| 0 | ~10ms | 10 |
| 1,000 | ~15ms | 1,010 |
| 10,000 | ~50ms | 10,010 |
| 100,000 | ~200ms | 100,010 |
| **1,000,000** | **~2s** | **1,000,010** |
| **10,000,000** | **~20s+** | **10,000,010** |

##### 为什么不能直接跳到 offset 位置？
- **B+Tree 索引的特性**：只能顺序遍历，不能随机定位（除非用主键）
- **没有全局行号**：InnoDB 没有物理行号的概念
- **MVCC 的复杂性**：每行对不同事务可能可见或不可见



#### 方案 2：书签记录法（Bookmark）🔖 **高性能**

##### 核心思想
- 记录**上一页最后一条记录的位置**（通常是主键 ID）
- 下一页查询从这条记录**之后**开始
- **完全避免 OFFSET**

##### 工作原理
```
传统分页：
Page 1: LIMIT 0, 10         → 返回 [1, 2, ..., 10]
Page 2: LIMIT 10, 10        → 返回 [11, 12, ..., 20]
...
Page N: LIMIT (N-1)*10, 10  → 需要扫描 N*10 行！

书签分页：
Page 1: WHERE id > 0 LIMIT 10       → 返回 [1, 2, ..., 10]，记住最后 id=10
Page 2: WHERE id > 10 LIMIT 10      → 返回 [11, 12, ..., 20]，记住最后 id=20
...
Page N: WHERE id > last_id LIMIT 10 → 只需扫描 10 行！
```

##### 实现代码
```sql
-- 第一页查询（初始请求）
SELECT * FROM orders 
WHERE id > 0  -- 或者不加这个条件
ORDER BY id 
LIMIT 10;
-- 返回数据 + 最后一条记录的 id（假设 id=100）

-- 第二页查询（客户端传入 last_id=100）
SELECT * FROM orders 
WHERE id > 100  -- 从上一页最后一条之后开始
ORDER BY id 
LIMIT 10;
-- 返回数据 + 新的最后一条 id（假设 id=110）

-- 第三页查询（客户端传入 last_id=110）
SELECT * FROM orders 
WHERE id > 110
ORDER BY id 
LIMIT 10;
-- 以此类推...
```

##### 服务端 API 设计
```json
// 响应格式
{
  "data": [...],           // 当前页数据
  "pagination": {
    "next_cursor": 110,    // 下一页的书签（最后一条 id）
    "has_more": true       // 是否还有下一页
  }
}

// 请求格式
// GET /api/orders?cursor=110&limit=10
```

##### 性能优势
- ⚡ **恒定速度**：无论翻到第几页，都是扫描 limit 行
- 🚀 **极速响应**：毫秒级返回（即使第 100 万页）
- 💾 **低资源消耗**：不需要扫描和丢弃大量行

##### 局限性
- ❌ **不支持随机跳页**（只能"下一页"/"上一页"）
- ❌ **只能用于有序的分页场景**
- ❌ **需要客户端配合**（保存和传递 cursor）
- ⚠️ **数据可能重复/遗漏**（如果在两次查询之间有数据插入/删除）

##### 解决数据一致性问题
```sql
-- 方案1：使用稳定排序字段（如创建时间）
SELECT * FROM orders 
WHERE create_time > '2024-01-01 12:00:00'  -- 上一页最后的时间
ORDER BY create_time, id                   -- 双字段排序保证稳定性
LIMIT 10;

-- 方案2：使用唯一且单调递增的字段
-- 自增主键、雪花算法 ID、时间戳等

-- 方案3：接受微小的不一致（大多数业务场景可接受）
-- 微博/微信的"加载更多"就是这样做的
```

##### 适用场景
- ✅ APP 的"下拉加载更多"
- ✅ 微博/微信的时间线
- ✅ 无限滚动（Infinite Scroll）
- ✅ 日志查看器
- ✅ 实时数据流



#### 方案 4：覆盖索引 + 延迟关联（终极优化）🏆

##### 适用场景
- 超深分页（OFFSET > 100 万）
- 需要返回多列数据
- 表数据量极大（千万级以上）

##### 优化思路
```sql
-- 传统方式（慢）
SELECT * FROM large_table ORDER BY id LIMIT 1000000, 10;
-- 耗时：可能 10 秒+

-- 优化方式（快）
-- Step 1: 覆盖索引快速定位 ID 范围
SELECT id FROM large_table 
WHERE id BETWEEN (
  SELECT id FROM large_table ORDER BY id LIMIT 1000000, 1
) AND (
  SELECT id FROM large_table ORDER BY id LIMIT 1000000 + 10, 1
);

-- Step 2: 根据 ID 范围查询完整数据
SELECT * FROM large_table 
WHERE id IN (...Step1 得到的 ID 列表...);
```

##### 更实用的变体
```sql
-- 使用 INNER JOIN + 子查询
SELECT lt.* 
FROM large_table lt
INNER JOIN (
  SELECT id FROM large_table ORDER BY id LIMIT 1000000, 10
) AS tmp USING (id);

-- 如果有复合索引，效果更好
-- 假设索引 idx_status_time(status, create_time)
SELECT lt.* 
FROM large_table lt
INNER JOIN (
  SELECT id FROM large_table 
  WHERE status = 'active'  -- 先过滤
  ORDER BY create_time 
  LIMIT 1000000, 10
) AS tmp USING (id);
```



## 🎯 模块总结与知识图谱

### 核心优化口诀 📜

```
Explain 先看 type 列，
const eq_ref 最为佳。
ref range 也能用，
index ALL 要优化。

key_len 算索引，
rows 越小越优秀。
Extra 看 filesort，
temporary 要警惕。

ORDER BY 命中索引，
filesort 就能避免。
GROUP BY 同理优化，
松散扫描最给力。

JOIN 要用 BKA，
被驱动表要有索引。
Hash Join 8.0 新特性，
大表等值 JOIN 首选。

COUNT(*) 慢怎么办？
计数器表 or 缓存。
分页深时用书签，
延迟关联也很快。
```

### 五大场景速查卡 🃏

| 场景 | 核心命令 | 关键指标 | 优化目标 |
|------|----------|----------|----------|
| **Explain 分析** | `EXPLAIN SQL\G` | type, key, rows, Extra | type ≥ ref |
| **排序优化** | `EXPLAIN ... ORDER BY` | Extra: filesort? | Using Index |
| **JOIN 优化** | `EXPLAIN ... JOIN` | Extra: join buffer? | BKA / Hash Join |
| **COUNT 优化** | `EXPLAIN SELECT COUNT(*)` | rows, 耗时 | < 100ms |
| **分页优化** | `EXPLAIN ... LIMIT` | 扫描行数 | O(limit) |

### 相关笔记链接 📎

- 📎 [[Explain 执行计划解读 -MySQLAnki]]
- 📎 [[group-by 和 order-by 优化 -MySQLAnki]]
- 📎 [[Join 语句优化 -MySQLAnki]]
- 📎 [[Join 语句的原理 -MySQLAnki]]
- 📎 [[COUNT 查询优化 -MySQLAnki]]
- 📎 [[分页查询优化 -MySQLAnki]]