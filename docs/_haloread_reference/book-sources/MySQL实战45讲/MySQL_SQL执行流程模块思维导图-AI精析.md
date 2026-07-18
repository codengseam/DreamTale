---
id: 202603280000
title: MySQL_SQL执行流程模块思维导图
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[MySQL_SQL执行流程模块思维导图]]"
status: published
ai_generated: true
---

关联源素材：[[01_01_基础架构：一条SQL查询语句是如何执行的？]]

# 🗺️ MySQL SQL 执行流程模块 - 超详细思维导图

## 📌 模块概览

**核心定位**：理解 MySQL 如何处理一条 SQL 语句的完整生命周期，从客户端发送到返回结果的每一个环节。

**学习价值**：
- 🔥 **面试高频考点**：几乎每场 MySQL 面试都会问到
- 💡 **性能优化基础**：只有理解流程才能精准优化
- 🛠️ **问题排查利器**：快速定位慢查询瓶颈所在

**前置知识**：
- 基本的 SQL 语法（SELECT/UPDATE/INSERT/DELETE）
- 了解 MySQL 是什么（数据库管理系统）
- 基本的网络概念（TCP 连接）



### 2️⃣ **SELECT 查询完整生命周期（6个阶段）**

#### **阶段 1：连接器工作（Connection Handler）** 🔐

##### 2.1.1 **TCP 连接建立**
- **触发条件**：客户端发起连接请求
- **协议**：基于 TCP/IP 协议
- **端口**：默认 3306
- **过程**：
  ```
  客户端 → TCP 三次握手 → MySQL 服务端接受连接
  ```

##### 2.1.2 **身份认证（Authentication）**
- **认证方式**：
  - 用户名 + 密码验证
  - 插件式认证（如 SHA256 密码）
- **失败处理**：
  - ❌ 返回 `Access denied for user`
  - ❌ 记录错误日志
  - ❌ 断开连接

##### 2.1.3 **权限获取与缓存（Authorization）**
- **权限来源**：读取 `mysql.user` 权限表
- **缓存机制**：
  - ✅ 连接建立后权限固定在内存中
  - ✅ 后续操作使用缓存权限（性能优化）
  - ⚠️ **重要特性**：修改权限仅对新连接生效
- **示例场景**：
  ```sql
  -- 用户 A 已连接
  GRANT SELECT ON db.table TO 'userA'@'%';
  -- 用户 A 的当前连接不会获得新权限！
  -- 必须重新连接才能生效
  ```

##### 2.1.4 **会话建立（Session）**
- **会话对象**：分配内存空间保存连接状态
- **会话变量**：`@variable_name` 会话级别变量
- **连接类型**：
  - **长连接（Long Connection）**：
    - 定义：连接建立后持续使用，不断开
    - 优点：减少 TCP 握手开销，提升性能
    - 缺点：内存累积占用过大 → OOM 异常
    - 解决方案：
      1. 定期断开重连（大查询后主动断开）
      2. MySQL 5.7+ 使用 `mysql_reset_connection`
    
  - **短连接（Short Connection）**：
    - 定义：每次操作都新建连接，用完即断开
    - 优点：不会内存溢出
    - 缺点：频繁建连开销大，性能差

- **超时机制**：
  - 参数：`wait_timeout = 28800 秒`（8小时，默认）
  - 触发：空闲超过阈值自动断开
  - 报错：`MySQL has gone away`

##### 2.1.5 **连接器总结**
```
✅ 成功：返回连接成功，进入下一阶段
❌ 失败：返回错误信息，断开连接
```
📎 [[SQL语句完整执行流程-MySQLAnki]]



#### **阶段 3：分析器解析 SQL（Parser）** 🔍

##### 2.3.1 **词法分析（Lexer）- 第一步**

###### **任务目标**
- 将 SQL 语句拆分成一个个 **Token（标记）**
- 识别每个 Token 的类型和含义

###### **识别内容分类**

**1️⃣ 关键字（Keywords）**
```sql
SELECT * FROM users WHERE age > 18;
-- 识别出：SELECT(关键字)  *(通配符)  FROM(关键字)
--        users(标识符)  WHERE(关键字)  age(标识符)
--        >(运算符)  18(常量)
```

**2️⃣ 标识符（Identifiers）**
- 表名：`users`, `orders`, `products`
- 列名：`id`, `name`, `age`, `created_at`
- 别名：`AS u`, `AS o`

**3️⃣ 常量（Literals）**
- 数字常量：`18`, `3.14`, `100`
- 字符串常量：`'John'`, `'active'`
- 日期常量：`'2026-04-02'`

**4️⃣ 运算符（Operators）**
- 比较运算符：`=`, `>`, `<`, `>=`, `<=`, `<>`, `!=`
- 逻辑运算符：`AND`, `OR`, `NOT`
- 算术运算符：`+`, `-`, `*`, `/`

##### 2.3.2 **语法分析（Parser）- 第二步**

###### **任务目标**
- 根据 MySQL 语法规则构建 **语法树（Parse Tree / AST）**
- 检查 SQL 语句是否符合语法规范

###### **语法树结构示例**
```sql
SELECT name, age FROM users WHERE age > 18 ORDER BY age DESC;

-- 生成的语法树（简化版）：
QueryStatement
├── SelectClause
│   ├── SelectItem: name
│   └── SelectItem: age
├── FromClause
│   └── Table: users
├── WhereClause
│   └── ComparisonExpression
│       ├── Column: age
│       ├── Operator: >
│       └── Literal: 18
└── OrderByClause
    ├── Column: age
    └── Ordering: DESC
```

###### **错误检测能力**
- ✅ 能检测语法错误
- ✅ 能检测列不存在错误
- ✅ 能检测表不存在错误

**常见错误示例**：
```sql
-- 错误1：语法错误
SELCT * FROM users;
-- 报错：You have an error in your SQL syntax; check the manual...
--       near 'SELCT * FROM users'

-- 错误2：列不存在
SELECT unknown_column FROM users;
-- 报错：Unknown column 'unknown_column' in 'field list'

-- 错误3：表不存在
SELECT * FROM nonexistent_table;
-- 报错：Table 'database.nonexistent_table' doesn't exist
```

##### 2.3.3 **输出产物：解析树（Parse Tree）**
- **定义**：SQL 语句的抽象语法树表示
- **用途**：传递给优化器进行进一步处理
- **特点**：
  - ✅ 结构化表示 SQL 语义
  - ✅ 机器易于理解和处理
  - ✅ 为优化器提供输入



#### **阶段 5：执行器执行查询（Executor）** ⚙️

##### 2.5.1 **执行前的准备工作**

###### **步骤 1：打开表（open table）**
- 调用存储引擎接口打开表
- 将表的定义信息加载到内存
- 获取表的元数据（列信息、索引信息等）

###### **步骤 2：权限再检查（二次验证）**
- **时机**：执行器调用引擎之前
- **检查内容**：确认用户是否有权操作该表
- **原因**：某些情况下优化器无法提前确定操作的表（如子查询、触发器等）

##### 2.5.2 **执行流程（无索引场景示例）**

```sql
SELECT * FROM users WHERE age > 18;
```

**详细执行步骤**：
```
1. 执行器调用引擎接口："请查询 users 表的第一行"
   ↓
2. 引擎读取第一行数据，返回给执行器
   ↓
3. 执行器判断：age > 18 是否成立？
   ├─ 成立 → 加入结果集
   └─ 不成立 → 跳过
   ↓
4. 执行器调用引擎接口："请查询 users 表的下一行"
   ↓
5. 重复步骤 2-4，直到最后一行
   ↓
6. 执行器将结果集返回给客户端
```

**关键指标**：
- **rows_examined**：扫描了多少行（在慢查询日志中可见）
- **理想情况**：rows_examined 接近返回的行数
- **性能问题**：rows_examined 远大于返回行数（需要优化）

##### 2.5.3 **执行流程（有索引场景）**
- **差异**：执行器根据执行计划调用不同的引擎接口
- **优化效果**：
  - 通过索引定位数据，减少扫描行数
  - rows_examined 显著降低

**对比示例**：
```sql
-- 无索引：全表扫描
SELECT * FROM users WHERE id = 123;
-- rows_examined: 100000（假设表有 10 万行）

-- 有主键索引：索引查找
SELECT * FROM users WHERE id = 123;
-- rows_examined: 1（只扫描了 1 行）
```

##### 2.5.4 **Server 层过滤 vs 引擎层过滤**
- **Server 层过滤**：
  - WHERE 条件在执行器中判断
  - 即使使用索引，部分条件仍需 Server 层过滤
  
- **引擎层过滤（ICP - Index Condition Pushdown）**：
  - 将部分 WHERE 条件下推到引擎层
  - 在索引遍历时就进行过滤
  - 减少 Server 层和引擎层的交互次数

**ICP 优化示例**：
```sql
-- 表有联合索引 idx_name_age(name, age)
SELECT * FROM users WHERE name LIKE '张%' AND age > 18;

-- 无 ICP：
1. 引擎：通过索引找到所有 name LIKE '张%' 的记录（假设 1000 条）
2. 返回给执行器
3. 执行器：过滤 age > 18（假设剩余 100 条）
交互次数：1000 次

-- 有 ICP：
1. 引擎：通过索引找到 name LIKE '张%' 且 age > 18 的记录（100 条）
2. 直接返回给执行器
交互次数：100 次（减少 90%）
```
📎 [[索引下推ICP-MySQLAnki]]

##### 2.5.5 **执行器总结**
- **核心职责**：协调存储引擎完成数据查询
- **关键能力**：
  - ✅ 权限验证
  - ✅ 调用引擎 API
  - ✅ 条件过滤
  - ✅ 构建结果集
- **性能关注点**：rows_examined（扫描行数）



### 3️⃣ **UPDATE 语句执行流程（写操作的特殊性）** ✏️

#### **与 SELECT 的核心差异**
- SELECT：只读操作，不修改数据
- UPDATE：写操作，涉及 **日志记录** 和 **事务提交**

#### **额外步骤详解**

##### 3.1 **步骤 1：调用存储引擎接口写入数据**

###### **3.1.1 定位要更新的记录**
- 通过索引或全表扫描找到目标行
- 加锁（保证并发安全，后续章节详解）

###### **3.1.2 更新内存中的数据（Buffer Pool）**
- **Buffer Pool**：InnoDB 的缓冲池，缓存热点数据页
- **更新位置**：先更新 Buffer Pool 中的数据页（内存）
- **脏页（Dirty Page）**：内存中已修改但未刷盘的数据页

**类比理解**：
```
Buffer Pool 就像草稿纸（内存）
磁盘数据文件就像正式账本（磁盘）
先在草稿纸上修改，之后再抄到账本上
```

###### **3.1.3 写 redo log（Prepare 阶段）**
- **redo log**：重做日志，记录"对哪个数据页做了什么修改"
- **Prepare 状态**：标记为 prepare，表示已写入但未提交
- **目的**：保证崩溃后可恢复（crash-safe）

**写入内容示例**：
```
redo log 记录：
- 数据页号：Page 100
- 偏移量：Offset 256
- 修改前值：age = 20
- 修改后值：age = 21
```

##### 3.2 **步骤 2：写 binlog**

###### **binlog 归档日志**
- **所属层级**：MySQL Server 层（所有引擎可用）
- **日志类型**：逻辑日志（记录 SQL 语句或行变更）
- **写入方式**：追加写（不覆盖历史日志）
- **核心用途**：
  - 📌 **数据恢复**：通过 binlog 恢复到任意时间点
  - 📌 **主从复制**：备库通过 binlog 同步主库数据

###### **binlog 三种格式**

| 格式 | 记录内容 | 优点 | 缺点 | 适用场景 |
|------|---------|------|------|----------|
| **Statement** | SQL 语句原文 | 日志量小 | 时间函数可能导致主从不一致 | 简单场景 |
| **Row** | 行变更前后数据 | 数据一致性最强 | 日志量大 | 推荐（默认）|
| **Mixed** | 自动混合 | 兼顾两者 | 复杂度高 | 特殊需求 |

**Row 格式示例**：
```sql
UPDATE users SET age = 21 WHERE id = 1;

-- binlog 记录（Row 格式）：
Table: users
Before: {id=1, name='Tom', age=20}
After:  {id=1, name='Tom', age=21}
```

##### 3.3 **步骤 3：两阶段提交（Two-Phase Commit, 2PC）** 🔐

###### **为什么需要两阶段提交？**
- **核心问题**：redo log 和 binlog 是两个独立的系统，如何保证一致性？

**反证法分析**：
- ❌ **方案 1：先写 redo log，后写 binlog**
  - redo log 写完 → crash → binlog 未写完
  - 结果：原库已恢复（有 redo log），备份库丢失该语句（无 binlog）
  - 结论：**主备数据不一致**

- ❌ **方案 2：先写 binlog，后写 redo log**
  - binlog 写完 → crash → redo log 未写
  - 结果：原库事务无效（无 redo log），备份库已有记录（有 binlog）
  - 结论：**主备数据不一致**

- ✅ **方案 3：两阶段提交（正确方案）**
  - 保证 redo log 和 binlog 要么都成功，要么都失败
  - 结论：**主备数据一致**

###### **两阶段提交流程**
```
1. Prepare 阶段：
   引擎写 redo log，状态标记为 prepare
   
2. 写 binlog：
   执行器写 binlog 并持久化到磁盘
   
3. Commit 阶段：
   执行器调用 commit，引擎将 redo log 改为 commit 状态
```

**时间线示意**：
```
时间轴 →

[引擎]  redo log prepare ─────────────────────→ redo log commit
                                    ↑
[执行器]                    写 binlog → fsync → 调用 commit
```

###### **崩溃恢复逻辑（关键！）**

**场景 1：redo log prepare 完成，binlog 未完成**
```
崩溃时刻：
- redo log 状态：prepare
- binlog 状态：不完整

恢复后的处理：
→ 判断 binlog 不完整
→ 回滚该事务（undo log 回滚）
→ 最终结果：事务无效（正确！）
```

**场景 2：redo log prepare 和 binlog 都完成**
```
崩溃时刻：
- redo log 状态：prepare
- binlog 状态：完整

恢复后的处理：
→ 判断 binlog 完整
→ 自动提交该事务（redo log 改为 commit）
→ 最终结果：事务有效（正确！）
```

**一致性保证总结**：
```
prepare + binlog 完整   → 自动 commit ✓
prepare + binlog 不完整 → 回滚 ✗
```

📎 [[两阶段提交2PC-MySQLAnki]]

###### **组提交优化（Group Commit）**
- **问题**：每次事务都要 fsync（刷盘），IOPS 消耗大
- **优化思路**：多个事务共享一次 fsync
- **实现原理**：
  - 多个事务同时到达 binlog write 阶段
  - leader 事务执行 fsync 时，所有 follower 都持久化了
  - 所有 follower 无需再次 fsync

**性能收益**：
```
无组提交：100 个事务 = 100 次 fsync
有组提交：100 个事务 ≈ 10 次 fsync（节约 90% IOPS）
```

##### 3.4 **崩溃恢复的完整流程**

###### **阶段一：扫描 redo log，恢复已提交事务**
- **目标**：将已提交事务的修改恢复到数据文件
- **过程**：
  1. 启动时扫描 redo log
  2. 找到所有状态为 commit 的记录
  3. 将这些修改重新应用到数据页
- **保证**：已提交的事务不丢失

###### **阶段二：处理未提交事务，用 undo log 回滚**
- **目标**：撤销未提交事务的修改
- **过程**：
  1. 找到所有状态为 prepare 但 binlog 不完整的记录
  2. 读取 undo log（记录修改前的值）
  3. 将数据恢复到修改前的状态
- **保证**：未提交的事务不生效

###### **crash-safe 能力**
- **定义**：异常重启后数据不丢失的能力
- **实现基础**：redo log 的 WAL 机制
- **关键参数**：
  ```sql
  innodb_flush_log_at_trx_commit = 1  -- 每次事务都持久化 redo log
  sync_binlog = 1                     -- 每次事务都持久化 binlog
  ```
  - 称为"双 1 配置"，最安全的设置

📎 [[崩溃恢复的原理-MySQLAnki]]



### 5️⃣ **不同 SQL 语句的执行差异对比** ⚖️

#### **5.1 四类基本 SQL 操作对比**

| 操作类型 | 是否需要 redo log | 是否需要 binlog | 是否需要 undo log | 说明 |
|---------|------------------|----------------|------------------|------|
| **SELECT** | ❌ 不需要 | ❌ 不需要 | ❌ 不需要 | 只读操作，不修改数据 |
| **INSERT** | ✅ 需要 | ✅ 需要 | ✅ 需要回滚 | 新增数据，需记录修改 |
| **UPDATE** | ✅ 需要 | ✅ 需要 | ✅ 需要回滚 | 修改数据，需记录前后值 |
| **DELETE** | ✅ 需要 | ✅ 需要 | ✅ 需要回滚 | 删除数据，需记录删除前状态 |

#### **5.2 各日志的作用详解**

##### **redo log（重做日志）**
- **作用**：保证 crash-safe，崩溃恢复
- **记录内容**：物理日志（数据页的修改）
- **何时写入**：事务提交时（prepare 阶段）
- **谁使用**：InnoDB 引擎层

##### **binlog（归档日志）**
- **作用**：数据恢复、主从复制
- **记录内容**：逻辑日志（SQL 或行变更）
- **何时写入**：两阶段提交的第 2 步
- **谁使用**：MySQL Server 层

##### **undo log（回滚日志）**
- **作用**：事务回滚、MVCC 多版本控制
- **记录内容**：修改前的数据快照
- **何时写入**：数据修改时同步写入
- **谁使用**：InnoDB 引擎层

**undo log 在 MVCC 中的作用**：
```sql
-- 事务 A（Read View 创建时刻）：age = 20
-- 事务 B：UPDATE users SET age = 21 WHERE id = 1;（未提交）

-- undo log 记录：
{transaction_id=B, data_page=Page100, before_value=age=20}

-- 事务 A 再次查询：
SELECT age FROM users WHERE id = 1;
-- 结果：age = 20（通过 undo log 读到历史版本）
-- 实现：可重复读（Repeatable Read）
```
📎 [[MVCC实现原理-MySQLAnki]]

#### **5.3 写操作的完整流程总结**

```
以 UPDATE 为例：

1. 【分析器】解析 SQL → 解析树
2. 【优化器】生成执行计划
3. 【执行器】调用引擎接口
4. 【引擎】定位记录 + 加锁
5. 【引擎】更新 Buffer Pool（内存）
6. 【引擎】写 redo log（prepare 状态）← redo log ✅
7. 【引擎】写 undo log（用于回滚/MVCC）← undo log ✅
8. 【执行器】写 binlog（归档日志）← binlog ✅
9. 【执行器】调用 commit
10.【引擎】redo log 改为 commit 状态
11.【后台线程】适时将脏页刷盘（Checkpoint）
```



## 🔗 相关知识点导航

### 核心关联笔记
- 📎 [[SQL语句完整执行流程-MySQLAnki]] - 执行流程总览
- 📎 [[两阶段提交2PC-MySQLAnki]] - 两阶段提交详解
- 📎 [[崩溃恢复的原理-MySQLAnki]] - 崩溃恢复机制
- 📎 [[MySQL选错索引的原因-MySQLAnki]] - 索引选择问题
- 📎 [[redo-log的WAL机制-MySQLAnki]] - WAL 机制深度解析
- 📎 [[查询缓存的废弃-MySQLAnki]] - 查询缓存废弃原因

### 扩展学习路径
- 📘 **索引相关**：[[B+树索引原理-MySQLAnki]] → [[聚簇索引与二级索引的区别-MySQLAnki]] → [[覆盖索引-MySQLAnki]]
- 🔄 **事务相关**：[[ACID特性及实现原理-MySQLAnki]] → [[事务隔离级别-MySQLAnki]] → [[MVCC实现原理-MySQLAnki]]
- 🔒 **锁机制**：[[MySQL锁机制-MySQLAnki]] → [[间隙锁与next-key-lock-MySQLAnki]] → [[死锁的排查与解决-MySQLAnki]]
- 📊 **性能优化**：[[Explain执行计划解读-MySQLAnki]] → [[慢查询优化思路-MySQLAnki]] → [[Join语句优化-MySQLAnki]]

### AI 精析源素材
- 📖 [[01_基础架构-AI精析]] - SQL 执行流程基础
- 📖 [[02_日志系统-AI精析]] - 日志系统详解
- 📖 [[23_保证数据不丢-AI精析]] - 数据持久化机制



## ✅ 自检清单（学习完成后勾选）

- [ ] 能够画出 MySQL 双层架构图并解释各组件职责
- [ ] 能够完整描述 SELECT 查询的 6 个执行阶段
- [ ] 理解查询缓存为什么被废弃及其缺陷
- [ ] 掌握分析器的词法分析和语法分析过程
- [ ] 理解优化器的成本估算模型和索引选择逻辑
- [ ] 知道优化器选错索引的三大原因及解决方案
- [ ] 能够描述 UPDATE 语句相对于 SELECT 的额外步骤
- [ ] 完整掌握两阶段提交的流程和崩溃恢复逻辑
- [ ] 深刻理解 WAL 机制的核心思想和两大优势
- [ ] 掌握 redo log 的循环写结构和三种写入状态
- [ ] 能够解释 innodb_flush_log_at_trx_commit 参数的含义
- [ ] 知道 redo log、binlog、undo log 的区别和作用
- [ ] 能够回答上述 6 个面试高频问题

---

> 💡 **提示**：本思维导图共包含 **50+ 知识点**，深度达到 **7 层**，涵盖了 MySQL SQL 执行流程的所有核心内容。建议配合 Anki 卡片进行间隔复习，加深记忆。
>
> 🎯 **下一步行动**：
> 1. 先通读一遍整体框架，建立知识体系
> 2. 重点攻克标有 ⚠️ 的难点（两阶段提交、WAL 机制）
> 3. 动手实验，验证理论理解
> 4. 使用 Anki 卡片进行间隔重复记忆