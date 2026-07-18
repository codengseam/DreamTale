---
id: 202603280000
title: MySQL高级主题模块-超详细思维导图
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[MySQL高级主题模块-超详细思维导图]]"
status: published
ai_generated: true
---

关联源素材：[[42_42_grant之后要跟着flushprivileges吗？]]

关联源素材：[[27_27_主库出问题了，从库怎么办？]]



# 🔧 MySQL 高级主题模块 — 超详细思维导图

## 一、🛡️ 12.1 权限管理最佳实践

### 1.1 📋 MySQL 权限体系概述

#### 1.1.1 ⚙️ **权限层级架构**（五层权限模型）

- **全局层级（Global Privileges）** 🌍
  - **作用范围**：`*.*`（对所有数据库、所有表）
  - **存储位置**：
    - 磁盘表：`mysql.user`
    - 内存结构：`acl_users` 数组
  - **典型权限**：
    - `SUPER`、`RELOAD`、`SHUTDOWN`
    - `FILE`、`PROCESS`、`REPLICATION SLAVE`
    - `ALL PRIVILEGES`
  - **赋权示例**：
    ```sql
    -- 授予全局所有权限（DBA级别）
    GRANT ALL PRIVILEGES ON *.* TO 'dba_admin'@'management_ip'
      WITH GRANT OPTION;
    ```
  - **生效机制特点**：
    - ✅ 新连接立即生效（从 `acl_users` 拷贝到线程对象）
    - ❌ 已存在连接不受影响（线程对象独立拷贝）
    - ⚠️ **安全风险**：revoke 后已连接用户仍持有原权限

- **数据库层级（Database Privileges）** 🗄️
  - **作用范围**：`db_name.*`（对特定数据库的所有表）
  - **存储位置**：
    - 磁盘表：`mysql.db`
    - 内存结构：`acl_dbs` 数组
  - **典型权限**：
    - `SELECT`、`INSERT`、`UPDATE`、`DELETE`
    - `CREATE`、`ALTER`、`DROP`、`INDEX`
    - `GRANT OPTION`
  - **赋权示例**：
    ```sql
    -- 应用写账号：对 app_db 库拥有完整 DML+DDL 权限
    GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER
      ON app_db.* TO 'app_write'@'app_server_ip';
    ```
  - **生效机制特点**：
    - ✅ 所有线程共享 `acl_dbs` 数组
    - ✅ grant/revoke **立即影响所有连接**
    - 特殊逻辑：当前 `USE` 的库权限保存在会话变量中

- **表层级（Table Privileges）** 📊
  - **作用范围**：`db_name.table_name`（对特定表）
  - **存储位置**：
    - 磁盘表：`mysql.tables_priv`
    - 内存结构：`column_priv_hash`
  - **适用场景**：
    - 需要对单张表精确控制权限
    - 多租户场景下隔离不同用户的表访问
  - **赋权示例**：
    ```sql
    -- 只允许访问 users 表
    GRANT SELECT, INSERT, UPDATE ON mydb.users TO 'app_user'@'%';

    -- 只允许读取配置表（只读）
    GRANT SELECT ON mydb.config_table TO 'report_user'@'192.168.1.%';
    ```

- **列层级（Column Privileges）** 🔬
  - **作用范围**：特定列（最细粒度）
  - **存储位置**：
    - 磁盘表：`mysql.columns_priv`
    - 内存结构：`column_priv_hash`
  - **支持操作**：仅 `SELECT`、`INSERT`、`UPDATE`
  - **赋权示例**：
    ```sql
    -- 只允许查询 id 和 name 列
    GRANT SELECT(id, name) ON mydb.users TO 'readonly_user'@'%';

    -- 允许插入指定列（隐藏敏感字段）
    GRANT INSERT(id, username, email) ON mydb.users TO 'api_user'@'%';
    ```

- **子程序层级（Routine Privileges）** ⚡
  - **作用范围**：存储过程（PROCEDURE）/ 函数（FUNCTION）
  - **存储位置**：`mysql.procs_priv`
  - **赋权示例**：
    ```sql
    -- 允许执行特定存储过程
    GRANT EXECUTE ON PROCEDURE mydb.sp_generate_report TO 'app_user'@'%';

    -- 允许调用函数
    GRANT EXECUTE ON FUNCTION mydb.fn_calculate_score TO 'app_user'@'%';
    ```

#### 1.1.2 🔄 **权限判断流程**

```
用户发起SQL请求
    ↓
连接器验证身份（user + host）
    ↓
从 acl_users 拷贝全局权限到线程对象（新连接时）
    ↓
执行 SQL 时逐层检查权限：
    ├─ 全局权限 → 线程对象（独立拷贝）
    ├─ DB权限   → acl_dbs（共享数组）
    ├─ 表权限   → tables_priv_hash
    └─ 列权限   → column_priv_hash
    ↓
任一层级有权限 → 放行 ❌ 无权限 → 拒绝
```

- 📎 [[权限管理的规则 -MySQLAnki]]

### 1.2 👤 用户管理最佳实践

#### 1.2.1 ✅ **创建用户的正确姿势**

##### **推荐方式：MySQL 8.0+ 标准语法**

```sql
-- 第一步：创建用户（独立于授权）
CREATE USER 'app_user'@'%' IDENTIFIED BY 'StrongPassword123!';

-- 第二步：授予权限（最小权限原则）
GRANT SELECT, INSERT, UPDATE ON mydb.* TO 'app_user'@'%';

-- 第三步：（可选）限制资源使用
GRANT USAGE ON *.* TO 'app_user'@'%'
  WITH MAX_QUERIES_PER_HOUR 1000
       MAX_UPDATES_PER_HOUR 100
       MAX_CONNECTIONS_PER_HOUR 10
       MAX_USER_CONNECTIONS 5;
```

##### **❌ 不推荐的方式（MySQL 8.0 已废弃）**

```sql
-- 直接 GRANT 创建用户（隐式创建，8.0 已废弃）
GRANT ALL PRIVILEGES ON mydb.* TO 'app_user'@'%' IDENTIFIED BY 'password';
```

**废弃原因**：
- 模糊了"创建用户"和"授权"两个独立操作的边界
- 不符合安全审计的最佳实践
- 不利于权限的精细化管理

##### **密码策略要求**

```sql
-- 查看当前密码策略
SHOW VARIABLES LIKE 'validate_password%';

-- 推荐配置
SET GLOBAL validate_password.policy = MEDIUM;        -- 中等强度
SET GLOBAL validate_password.length = 12;              -- 最少12位
SET GLOBAL validate_password.mixed_case_count = 1;     -- 至少1个大写+小写
SET GLOBAL validate_password.number_count = 1;         -- 至少1个数字
SET GLOBAL validate_password.special_char_count = 1;  -- 至少1个特殊字符
```

#### 1.2.2 🎯 **最小权限原则（Principle of Least Privilege）**

##### **核心原则**
- 每个账号只授予其工作所需的**最小必要权限**
- 定期审查和清理不再需要的权限
- 避免使用 `GRANT ALL` 或 `SUPER` 权限

##### **角色化权限分配模板**

```sql
-- ==========================================
-- 角色模板 1：只读报表账号（READONLY_REPORTER）
-- ==========================================
CREATE USER 'report_user'@'192.168.1.%'
  IDENTIFIED BY 'Report_Passw0rd!2024'
  PASSWORD EXPIRE INTERVAL 90 DAY
  ACCOUNT LOCK;  -- 创建时锁定，审核后解锁

GRANT SELECT ON analytics.* TO 'report_user'@'192.168.1.%';
UNLOCK ACCOUNT 'report_user'@'192.168.1.%';


-- ==========================================
-- 角色模板 2：应用写账号（APP_WRITER）
-- ==========================================
CREATE USER 'app_write'@'10.0.5.%'
  IDENTIFIED BY 'App_Write_Secure#99'
  WITH MAX_USER_CONNECTIONS 20;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_db.* TO 'app_write'@'10.0.5.%';
-- 注意：不授予 CREATE/ALTER/DROP（防止误操作改表结构）


-- ==========================================
-- 角色模板 3：DBA 管理账号（DBA_ADMIN）
-- ==========================================
CREATE USER 'dba_admin'@'10.0.0.100'
  IDENTIFIED BY 'DBA_Super$ecure2024!'
  REQUIRE SSL  -- 强制SSL连接
  WITH GRANT OPTION;

GRANT ALL PRIVILEGES ON *.* TO 'dba_admin'@'10.0.0.100' WITH GRANT OPTION;


-- ==========================================
-- 角色模板 4：备份账号（BACKUP_OPERATOR）
-- ==========================================
CREATE USER 'backup_op'@'localhost'
  IDENTIFIED BY 'Backup_Op#Secure777';

GRANT SELECT, RELOAD, LOCK TABLES,
      SHOW VIEW, EVENT, TRIGGER ON *.* TO 'backup_op'@'localhost';
```

#### 1.2.3 🌐 **限制登录来源（Host 白名单）**

##### **安全原则**
- ❌ **禁止使用** `'user'@'%'`（允许任何 IP 登录）
- ✅ **必须明确指定** IP 或 IP 段

##### **Host 匹配规则速查**

| Host 格式 | 含义 | 安全等级 |
|-----------|------|---------|
| `'user'@'%'` | 任意主机 | 🔴 极危险 |
| `'user'@'192.168.%'` | 192.168.x.x 网段 | 🟡 中等 |
| `'user'@'192.168.1.0/255.255.255.0'` | CIDR 子网 | 🟢 推荐 |
| `'user'@'10.0.5.100'` | 单一IP | 🟢 最安全 |
| `'user'@'localhost'` | 本机访问 | 🟢 最安全 |

##### **生产环境最佳实践**

```sql
-- 应用服务器网段（内网）
'app_user'@'10.0.5.0/255.255.255.0'

-- 报表服务器（固定IP）
'report_user'@'192.168.1.50'

-- 运维跳板机
'dba_admin'@'10.0.0.100'

-- 备份脚本（本机）
'backup_op'@'localhost'

-- 监控系统
'monitor'@'10.0.6.200'
```

### 1.3 🔄 Grant 和 Revoke 的使用

#### 1.3.1 **GRANT 语句详解**

##### **基本语法**

```sql
GRANT privilege_type [(column_list)]
  [, privilege_type [(column_list)]] ...
ON [object_type]
  {
    *.*
  | db_name.*
  | db_name.tbl_name
  | tbl_name
  | db_name.routine_name
  }
TO user [auth_option] [WITH grant_option ...];
```

##### **常用权限类型清单**

| 权限 | 层级 | 说明 | 危险程度 |
|------|------|------|---------|
| `ALL PRIVILEGES` | 全局/DB/表 | 所有权限（除GRANT OPTION） | 🔴 极高 |
| `SELECT` | 全局/DB/表/列 | 查询数据 | 🟢 低 |
| `INSERT` | 全局/DB/表/列 | 插入数据 | 🟡 中 |
| `UPDATE` | 全局/DB/表/列 | 更新数据 | 🟡 中 |
| `DELETE` | 全局/DB/表 | 删除数据 | 🟡 中 |
| `CREATE` | 全局/DB/表 | 创建对象 | 🟡 中 |
| `DROP` | 全局/DB/表 | 删除对象 | 🔴 高 |
| `ALTER` | 全局/DB/表 | 修改结构 | 🔴 高 |
| `INDEX` | 全局/DB/表 | 管理索引 | 🟡 中 |
| `SUPER` | 全局 | 超级管理员权限 | 🔴 极高 |
| `RELOAD` | 全局 | 重载配置/刷新 | 🟡 中 |
| `SHUTDOWN` | 全局 | 关闭服务 | 🔴 极高 |
| `PROCESS` | 全局 | 查看进程列表 | 🟡 中 |
| `FILE` | 全局 | 读写文件系统 | 🔴 极高 |
| `GRANT OPTION` | 任意 | 可转授权限 | 🔴 高 |
| `REPLICATION SLAVE` | 全局 | 复制从库权限 | 🟡 中 |
| `REPLICATION CLIENT` | 全局 | 查看复制状态 | 🟢 低 |

##### **实战示例集**

```sql
-- 场景1：授予表级权限并允许转授
GRANT SELECT ON mydb.* TO 'team_lead'@'%' WITH GRANT OPTION;

-- 场景2：授予列级权限（隐藏敏感字段）
GRANT SELECT(id, name, email), UPDATE(email)
  ON mydb.users TO 'customer_service'@'10.0.5.%';

-- 场景3：使用角色（MySQL 8.0+）
CREATE ROLE 'app_developer', 'app_readonly';
GRANT SELECT, INSERT, UPDATE, DELETE ON app_db.* TO 'app_developer';
GRANT SELECT ON app_db.* TO 'app_readonly';
GRANT 'app_developer' TO 'dev_user'@'10.0.5.%';
GRANT 'app_readonly' TO 'readonly_user'@'192.168.1.%';

-- 场景4：带资源限制的授权
GRANT USAGE ON *.* TO 'batch_job'@'localhost'
  WITH MAX_QUERIES_PER_HOUR 5000
       MAX_UPDATES_PER_HOUR 1000
       MAX_CONNECTIONS_PER_HOUR 10
       MAX_USER_CONNECTIONS 3;
```

#### 1.3.2 **REVOKE 语句详解**

##### **基本语法**

```sql
REVOKE privilege_type [(column_list)]
  [, privilege_type [(column_list)]] ...
ON [object_type]
  {
    *.*
  | db_name.*
  | db_name.tbl_name
  | tbl_name
  | db_name.routine_name
  }
FROM user;

-- 撤销所有权限
REVOKE ALL PRIVILEGES, GRANT OPTION FROM user;
```

##### **撤销权限示例**

```sql
-- 撤销单个权限
REVOKE INSERT ON mydb.users FROM 'app_user'@'%';

-- 撤销多个权限
REVOKE SELECT, INSERT, UPDATE ON mydb.* FROM 'app_user'@'%';

-- 撤销所有权限 + 转授能力
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'app_user'@'%';

-- 撤销角色
REVOKE 'app_developer' FROM 'dev_user'@'10.0.5.%';

-- 删除用户（彻底清除）
DROP USER 'app_user'@'%';
```

##### **⚠️ Revoke 的注意事项**

- **全局权限 revoke**：只对新连接生效，已存在连接仍持有旧权限
- **DB/表/列权限 revoke**：立即对所有连接生效
- **REVOKE vs DROP USER**：
  - `REVOKE`：保留用户，只移除权限
  - `DROP USER`：完全删除用户及所有权限
- **建议**：离职人员立即 `DROP USER`，临时禁用用 `REVOKE` 或 `ACCOUNT LOCK`

#### 1.3.3 **💡 是否需要 FLUSH PRIVILEGES？**

##### **核心结论：现代 MySQL 基本不需要手动 FLUSH PRIVILEGES！**

| 操作方式 | 是否需要 FLUSH PRIVILEGES？ | 原因 |
|----------|---------------------------|------|
| `GRANT` / `REVOKE` | ❌ **不需要** | 自动更新磁盘+内存 |
| `CREATE USER` / `DROP USER` | ❌ **不需要** | 自动同步内存 |
| `ALTER USER` / `RENAME USER` | ❌ **不需要** | 自动同步内存 |
| **直接 DML 操作系统权限表** | ✅ **需要！** | 只修改了磁盘，内存未更新 |

##### **唯一需要 FLUSH PRIVILEGES 的场景**

```sql
-- ⚠️ 错误示范：直接删除 mysql.user 表中的记录
DELETE FROM mysql.user WHERE user = 'bad_user';

-- 此时：
-- ✓ 磁盘上该用户已被删除
-- ✗ 内存 acl_users 中仍存在该用户
-- ✗ 该用户仍可登录！（因为权限判断用内存数据）

-- 必须执行以下命令重建内存：
FLUSH PRIVILEGES;
```

##### **直接 DML 操作的危险后果**

1. **删除用户后仍可登录**：内存 `acl_users` 中仍有该用户
2. **无法重新赋权**：`GRANT` 检查磁盘表发现用户不存在
3. **无法重建用户**：`CREATE USER` 检查内存发现用户已存在
4. **陷入死锁状态**：既不能删也不能建

##### **版本差异总结**

- **MySQL 8.0+**：✅ 完全不需要手动 `FLUSH PRIVILEGES`（除非不规范操作）
- **MySQL 5.7 及以前**：
  - 使用标准命令 → 不需要
  - 直接 DML 权限表 → **必须** `FLUSH PRIVILEGES`

##### **最佳实践**

> 💡 **永远不要直接用 INSERT/UPDATE/DELETE 操作 mysql 系统权限表！**
> 始终使用 `GRANT` / `REVOKE` / `CREATE USER` / `DROP USER` 标准语句。

- 📎 [[grant 之后要跟着 flush privileges 吗？.md]]（[42_grant权限-AI精析](file:///Users/dengxiongshihao/Documents/trae_projects/yuanqi/second-brain/288%20AI精析笔记/books/MySQL实战45讲/42_grant权限-AI精析.md)）
- 📎 [[权限管理的规则 -MySQLAnki]]（[权限管理的规则](file:///Users/dengxiongshihao/Documents/trae_projects/yuanqi/second-brain/300%20研读文献卡/MySQL_anki卡片/权限管理的规则-MySQLAnki.md)）



## 三、📊 12.3 其他高级话题

### 3.1 ⚙️ MySQL 参数调优速查表

#### 3.1.1 **InnoDB 存储引擎参数**

| 参数名 | 推荐值 | 单位 | 说明 | 影响范围 |
|--------|--------|------|------|---------|
| **`innodb_buffer_pool_size`** | **物理内存 × 0.65** | 字节 | ⭐ **最重要的 InnoDB 参数**<br>缓存数据和索引页<br>命中率应 > 99% | 内存占用 |
| **`innodb_buffer_pool_instances`** | **8**（若 buffer_pool > 1GB） | 个数 | 缓冲池分片数<br>减少内部锁竞争 | 并发性能 |
| **`innodb_log_file_size`** | **512M ~ 2G** | 字节 | redo log 文件大小<br>越大 → checkpoint 频率越低 → 写入性能越好<br>但崩溃恢复时间变长 | 写入性能/崩溃恢复速度 |
| **`innodb_log_buffer_size`** | **16M ~ 64M** | 字节 | redo log 缓冲区<br>大事务多的场景调大 | 大事务性能 |
| **`innodb_flush_log_at_trx_commit`** | **1**（默认，最安全） | - | ⭐ **ACID 保证的关键参数**<br>`1`: 每次 commit 都刷盘（最安全）<br>`0`: 每秒刷盘（最快，可能丢1秒数据）<br>`2`: 每秒刷写到OS缓存（折中） | 数据安全性 vs 性能 |
| **`innodb_flush_method`** | **O_DIRECT**（Linux） | - | 刷新方式<br>`O_DIRECT`: 绕过OS缓存，直接写磁盘<br>`fsync`: 通过OS缓存 | IO 性能 |
| **`innodb_file_per_table`** | **ON**（强烈推荐） | - | 独立表空间<br>每张表一个 .ibd 文件<br>方便 `OPTIMIZE TABLE` 回收空间 | 磁盘空间管理 |
| **`innodb_io_capacity`** | **2000**（SSD）<br>**200**（HDD） | IOPS | InnoDB 后台任务的 IO 能力<br>影响 flush/purge 速度 | 后台任务效率 |
| **`innodb_io_capacity_max`** | **io_capacity × 2** | IOPS | 最大 IO 能力（突发情况） | 突发负载处理 |
| **`innodb_read_io_threads`** | **8** | 个数 | 读 IO 线程数 | 读并发能力 |
| **`innodb_write_io_threads`** | **8** | 个数 | 写 IO 线程数 | 写并发能力 |
| **`innodb_purge_threads`** | **4** | 个数 | purge 线程数（回收 undo） | undo 回收效率 |
| **`innodb_lock_wait_timeout`** | **50** | 秒 | 行锁等待超时时间 | 死锁/长事务检测 |
| **`innodb_deadlock_detect`** | **ON** | - | 开启死锁检测 | 死锁发现能力 |
| **`innodb_open_files`** | **大于 table_open_cache** | 个数 | InnoDB 可同时打开的文件数 | 文件句柄限制 |

##### **Buffer Pool 调优公式**

```bash
# 推荐 buffer pool size 计算
# 公式：(物理内存 - OS预留 - 其他服务占用) × 0.65 ~ 0.75

# 示例：32GB 内存的专用 MySQL 服务器
Total_Memory = 32 GB
OS_Reserve = 2 GB           # 操作系统预留
Other_Services = 2 GB       # 监控、SSH 等
Available_For_MySQL = 28 GB
Buffer_Pool_Recommended = 28 × 0.70 = 19.6 GB ≈ 20 GB

# my.cnf 配置
[mysqld]
innodb_buffer_pool_size = 20G
innodb_buffer_pool_instances = 20  # 每个 instance 约 1GB
```

#### 3.1.2 **连接与线程参数**

| 参数名 | 推荐值 | 单位 | 说明 | 影响范围 |
|--------|--------|------|------|---------|
| **`max_connections`** | **300 ~ 500** | 个数 | 最大连接数<br>应根据应用连接池大小设置 | 并发连接上限 |
| **`max_connect_errors`** | **100** | 个数 | 最大连接错误次数<br>超过则触发 host block | 安全防护 |
| **`connect_timeout`** | **10** | 秒 | 连接超时时间 | 连接建立速度 |
| **`wait_timeout`** | **28800**（8小时） | 秒 | 空闲连接超时时间 | 空闲连接回收 |
| **`interactive_timeout`** | **28800** | 秒 | 交互式连接超时 | 同上 |
| **`thread_cache_size`** | **64** | 个数 | 线程缓存大小<br>减少线程创建/销毁开销 | 连接响应速度 |
| **`thread_handling`** | **one-thread-per-connection** | - | 线程处理模式 | 并发模型 |

##### **max_connections 设置建议**

```sql
-- 计算公式：max_connections = 应用最大并发 × 1.2 ~ 1.5（预留余量）

-- 示例：应用连接池配置 maxActive=200
-- 则 max_connections 建议设为 250 ~ 300

-- 动态调整（无需重启）
SET GLOBAL max_connections = 350;

-- 永久修改（my.cnf）
[mysqld]
max_connections = 350
```

#### 3.1.3 **临时表与排序参数**

| 参数名 | 推荐值 | 单位 | 说明 | 影响范围 |
|--------|--------|------|------|---------|
| **`tmp_table_size`** | **64M** | 字节 | 内存临时表最大大小 | 临时表溢出到磁盘的概率 |
| **`max_heap_table_size`** | **64M** | 字节 | MEMORY 引擎表最大大小 | 同上 |
| **`sort_buffer_size`** | **256K** | 字节 | 排序缓冲区<br>⚠️ 每个连接独占！不宜过大 | ORDER BY/GROUP BY 性能 |
| **`join_buffer_size`** | **256K** | 字节 | Join 缓冲区<br>⚠️ 每个连接独占！ | 无索引 JOIN 性能 |
| **`read_buffer_size`** | **128K** | 字节 | 顺序读缓冲区（MyISAM/全表扫描） | 全表扫描性能 |
| **`read_rnd_buffer_size`** | **256K** | 字节 | 随机读缓冲区（排序后的随机读） | 排序后回表性能 |
| **`bulk_insert_buffer_size`** | **64M** | 字节 | 批量插入缓冲区 | LOAD DATA/批量 INSERT 性能 |

##### **⚠️ sort_buffer_size / join_buffer_size 的陷阱**

```sql
-- 这些参数是 per-session 的！
-- 如果设置过大，高并发时会耗尽内存

-- ❌ 错误配置（会导致 OOM）
SET SESSION sort_buffer_size = 256M;  -- 500个连接 × 256M = 128GB！！！

-- ✅ 正确配置（保持较小值）
sort_buffer_size = 256K;  -- 500个连接 × 256K = 125MB（可控）
```

#### 3.1.4 **表缓存与文件描述符**

| 参数名 | 推荐值 | 单位 | 说明 | 影响范围 |
|--------|--------|------|------|---------|
| **`table_open_cache`** | **4000** | 个数 | 表描述符缓存<br>应大于 `SHOW TABLE STATUS` 数量 | 表打开速度 |
| **`table_definition_cache`** | **2000** | 个数 | 表定义（.frm）缓存 | 同上 |
| **`open_files_limit`** | **65535** | 个数 | mysqld 进程的文件描述符上限 | 文件句柄限制 |

##### **table_open_cache 调优**

```sql
-- 查看当前表缓存命中情况
SHOW STATUS LIKE 'Opened_table_definitions';  -- 应尽量低（表示命中缓存）
SHOW STATUS LIKE 'Open_table_definitions';     -- 当前缓存的表定义数量

-- 如果 Opened_table_definitions 持续增大
-- → 说明 table_open_cache 不够，应调大
```

#### 3.1.5 **查询缓存（MySQL 8.0 已移除）**

| 参数名 | MySQL 5.7 | MySQL 8.0 | 说明 |
|--------|-----------|-----------|------|
| `query_cache_type` | **OFF**（推荐关闭） | ❌ **已移除** | 查询缓存开关 |
| `query_cache_size` | **0**（推荐设为0） | ❌ **已移除** | 查询缓存大小 |

**为什么 MySQL 8.0 移除了查询缓存？**
- 在高并发写场景下，缓存失效开销 > 缓存命中收益
- 缓存失效是粒度为表的（一行更新导致整个表缓存失效）
- 现代应用通常有自己的缓存层（Redis、Memcached）

#### 3.1.6 **慢查询日志参数**

| 参数名 | 推荐值 | 单位 | 说明 |
|--------|--------|------|------|
| **`slow_query_log`** | **ON** | - | 开启慢查询日志 |
| **`long_query_time`** | **1** | 秒 | 慢查询阈值（建议 1 秒） |
| **`log_queries_not_using_indexes`** | **ON** | - | 记录未使用索引的查询 |
| **`slow_query_log_file`** | `/var/log/mysql/slow.log` | - | 慢查询日志路径 |
| **`min_examined_row_limit`** | **1000** | 行数 | 最少扫描行数才记录（过滤简单查询） |
| **`log_slow_admin_statements`** | **ON** | - | 记录慢的管理语句（ALTER TABLE 等） |
| **`log_slow_slave_statements`** | **ON** | - | 记录备库上的慢查询 |

##### **慢查询配置示例**

```ini
[mysqld]
# 慢查询基础配置
slow_query_log = ON
slow_query_log_file = /var/log/mysql/mysql-slow.log
long_query_time = 1

# 进阶配置
log_queries_not_using_indexes = ON
log_slow_admin_statements = ON
log_slow_slave_statements = ON
min_examined_row_limit = 1000
```

### 3.2 📈 监控指标和告警设置

#### 3.2.1 **关键监控指标 SQL**

##### **① QPS（每秒查询数）**

```sql
-- 方法一：通过 Status 计算
SHOW GLOBAL STATUS LIKE 'Questions';
SHOW GLOBAL STATUS LIKE 'Uptime';

-- QPS = Questions / Uptime
-- 或通过 pt-query-digest 等工具实时统计

-- 方法二：实时采样（每秒采样一次）
-- 脚本实现：
while true; do
  Q1=$(mysql -N -e "SHOW GLOBAL STATUS LIKE 'Questions'" | awk '{print $2}')
  sleep 1
  Q2=$(mysql -N -e "SHOW GLOBAL STATUS LIKE 'Questions'" | awk '{print $2}')
  echo "QPS: $((Q2 - Q1))"
done
```

##### **② TPS（每秒事务数）**

```sql
-- TPS = Com_commit + Com_rollback（每秒增量）
SHOW GLOBAL STATUS LIKE 'Com_commit';
SHOW GLOBAL STATUS LIKE 'Com_rollback';

-- 实际计算：取两次采样的差值 / 时间间隔
-- 例如：10秒内 commit 增加 500，rollback 增加 10
-- TPS = (500 + 10) / 10 = 51 TPS
```

##### **③ 连接数监控**

```sql
-- 当前活跃连接数
SHOW STATUS LIKE 'Threads_connected';

-- 当前运行的查询数
SHOW STATUS LIKE 'Threads_running';

-- 最大连接数限制
SHOW VARIABLES LIKE 'max_connections';

-- 自启动以来创建的总线程数（过高说明频繁创建/销毁线程）
SHOW STATUS like 'Threads_created';

-- 线程缓存命中率
-- Threads_created 越低越好（说明 thread_cache_size 足够）
-- 命中率 = 1 - (Threads_created / Connections)

-- 连接使用率告警阈值
-- Threads_connected / max_connections > 0.8 → 🟡 告警
-- Threads_connected / max_connections > 0.9 → 🔴 严重告警
```

##### **④ Buffer Pool 命中率**（⭐ 最重要指标之一）

```sql
-- Buffer Pool 总请求数
SHOW STATUS LIKE 'Innodb_buffer_pool_read_requests';

-- 磁盘物理读取次数（未命中）
SHOW STATUS LIKE 'Innodb_buffer_pool_reads';

-- 命中率计算公式：
-- Hit Rate = 1 - (Innodb_buffer_pool_reads / Innodb_buffer_pool_read_requests)
-- 目标：> 99%（理想值 > 99.9%）

-- 示例：
-- read_requests = 100,000,000
-- reads = 100,000
-- Hit Rate = 1 - (100,000 / 100,000,000) = 99.9% ✅

-- 如果命中率 < 98%
-- → 考虑增加 innodb_buffer_pool_size
-- → 或优化高频查询（减少全表扫描）
```

##### **⑤ InnoDB 行锁监控**

```sql
-- 行锁等待次数
SHOW STATUS LIKE 'Innodb_row_lock_waits';

-- 行锁平均等待时间（毫秒）
SHOW STATUS LIKE 'Innodb_row_lock_time';
SHOW STATUS LIKE 'Innodb_row_lock_current_waits';

-- 行锁超时次数
SHOW STATUS like 'Innodb_row_lock_timeouts';

-- 告警规则：
-- Innodb_row_lock_waits/s > 100  → 🟡 告警（锁竞争严重）
-- Innodb_row_lock_avg_time > 10ms → 🟡 告警（锁等待时间长）
-- Innodb_row_lock_current_waits > 10 → 🔴 严重（当前有大量锁等待）
```

##### **⑥ 主备复制延迟监控**

```sql
-- 在备库上执行
SHOW SLAVE STATUS\G

-- 关键字段：
-- Seconds_Behind_Master: 备库落后主库的秒数
--   > 10s → 🟠 注意
--   > 60s → 🟡 告警
--   > 300s → 🔴 严重

-- Slave_IO_Running: IO Thread 状态
--   应为 Yes

-- Slave_SQL_Running: SQL Thread 状态
--   应为 Yes

-- Last_IO_Error / Last_SQL_Error: 最近错误信息
--   应为空

-- Retried_GTKID: 重试的事务数
--   持续增大说明有复制冲突

-- 更精准的延迟测量（PT 工具）
-- pt-heartbeat --host=slave --create-table
-- pt-heartbeat --host=slave --monitor
```

##### **⑦ 慢查询统计**

```sql
-- 自启动以来的慢查询总数
SHOW GLOBAL STATUS LIKE 'Slow_queries';

-- 慢查询速率（建议每分钟采样）
-- Slow_queries/min > 10 → 🟡 告警（需要分析优化）

-- 开启 performance_schema 后的详细分析
SELECT schema_name, SUM(count_star) AS total,
       SUM(sum_timer_wait)/1000000000 AS total_time_ms
FROM performance_schema.events_statements_summary_by_schema
WHERE schema_name NOT IN ('mysql', 'information_schema', 'performance_schema')
GROUP BY schema_name
ORDER BY total DESC
LIMIT 10;
```

##### **⑧ IO 状态监控**

```sql
-- 待处理的 fsync 请求数
SHOW STATUS LIKE 'Innodb_data_pending_fsyncs';
-- > 100 → 🔴 严重（IO 瓶颈，考虑升级存储）

-- InnoDB 数据读取次数
SHOW STATUS LIKE 'Innodb_data_reads';

-- InnoDB 数据写入次数
SHOW STATUS LIKE 'Innodb_data_writes';

-- InnoDB 双写次数
SHOW STATUS LIKE 'Innodb_dblwr_writes';
SHOW STATUS LIKE 'Innodb_dblwr_pages_written';
```

#### 3.2.2 **📊 建议的告警规则汇总表**

| # | 监控指标 | 🟢 正常 | 🟡 警告 | 🔴 严重 | 处理建议 |
|---|---------|---------|---------|---------|---------|
| 1 | **Connections / Max_Conn** | < 60% | 60% ~ 80% | > 80% | 增大 `max_connections` 或优化应用连接池 |
| 2 | **Buffer Pool 命中率** | > 99.9% | 99% ~ 99.9% | < 99% | 增大 `innodb_buffer_pool_size` 或优化查询 |
| 3 | **Slow_queries/min** | < 5 | 5 ~ 10 | > 10 | 分析慢查询日志，优化 TOP SQL |
| 4 | **Slave Delay（正常备库）** | < 5s | 5s ~ 30s | > 30s | 检查大事务、网络带宽、IO 瓶颈 |
| 5 | **Row Lock Waits/s** | < 10 | 10 ~ 100 | > 100 | 检查锁竞争热点、优化长事务 |
| 6 | **Pending Fsyncs** | < 10 | 10 ~ 100 | > 100 | IO 瓶颈！升级 SSD 或优化写入负载 |
| 7 | **Threads_running** | < CPU核数×2 | CPU核数×2 ~ ×4 | > CPU核数×4 | CPU 竞争严重，排查慢查询 |
| 8 | **Created_tmp_disk_tables/s** | < 1 | 1 ~ 10 | > 10 | 临时表溢出到磁盘，增大 tmp_table_size |
| 9 | **Sort_merge_passes/s** | < 1 | 1 ~ 10 | > 10 | 排序内存不足，增大 sort_buffer_size 或优化排序 |
| 10 | **Table_open_cache_misses/s** | < 1 | 1 ~ 5 | > 5 | 表缓存不足，增大 table_open_cache |
| 11 | **Innodb_log_waits/s** | < 0.1 | 0.1 ~ 1 | > 1 | redo log buffer 不足，增大 innodb_log_buffer_size |
| 12 | **Aborted_connects/h** | < 10 | 10 ~ 100 | > 100 | 密码错误/连接风暴，检查应用配置和安全 |

### 3.3 🛠️ 常用运维脚本模板

#### 3.3.1 **每日健康检查脚本（完整版）**

```bash
#!/bin/bash
# ============================================================
# MySQL 每日健康检查脚本 v2.0
# 功能：全面检查 MySQL 运行状态，输出报告
# 用法：crontab -e → 0 8 * * * /path/to/mysql_health_check.sh
# ============================================================

set -euo pipefail

# ========== 配置区 ==========
MYSQL_HOST="127.0.0.1"
MYSQL_PORT="3306"
MYSQL_USER="monitor"
MYSQL_PASS="monitor_secure_password"
ALERT_EMAIL="dba-team@company.com"
LOG_DIR="/var/log/mysql/healthcheck"
LOG_FILE="${LOG_DIR}/health_$(date +%Y%m%d).log"
THRESHOLD_CONN_USAGE=80    # 连接使用率告警阈值(%)
THRESHOLD_BUF_HIT=99       # Buffer Pool 命中率告警阈值(%)
THRESHOLD_SLAVE_DELAY=60   # 备库延迟告警阈值(秒)

# ========== 初始化 ==========
mkdir -p "$LOG_DIR"
MYSQL_CMD="mysql -h${MYSQL_HOST} -P${MYSQL_PORT} -u${MYSQL_USER} -p${MYSQL_PASS}"

echo "==========================================" >> "$LOG_FILE"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') MySQL Health Check ===" >> "$LOG_FILE"
echo "==========================================" >> "$LOG_FILE"

ERROR_COUNT=0
WARN_COUNT=0

# ========== 1. 检查 MySQL 进程 ==========
check_process() {
  if pgrep -x mysqld > /dev/null 2>&1; then
    echo "[OK] MySQL process is running (PID: $(pgrep -x mysqld))" >> "$LOG_FILE"
  else
    echo "[FAIL] MySQL process is NOT running!" >> "$LOG_FILE"
    ((ERROR_COUNT++))
    return 1
  fi
}

# ========== 2. 检查连接数 ==========
check_connections() {
  local conn_usage
  CONNECTIONS=$($MYSQL_CMD -N -e "SHOW STATUS LIKE 'Threads_connected'" | awk '{print $2}')
  MAX_CONN=$($MYSQL_CMD -N -e "SELECT @@max_connections")
  conn_usage=$(awk "BEGIN {printf \"%.1f\", ($CONNECTIONS / $MAX_CONN) * 100}")

  if (( $(echo "$conn_usage >= $THRESHOLD_CONN_USAGE" | bc -l) )); then
    echo "[WARN] Connection usage HIGH: ${conn_usage}% (${CONNECTIONS}/${MAX_CONN})" >> "$LOG_FILE"
    ((WARN_COUNT++))
  else
    echo "[OK] Connection usage: ${conn_usage}% (${CONNECTIONS}/${MAX_CONN})" >> "$LOG_FILE"
  fi
}

# ========== 3. 检查 Buffer Pool 命中率 ==========
check_buffer_pool() {
  local requests reads hit_rate
  requests=$($MYSQL_CMD -N -e "SHOW STATUS LIKE 'Innodb_buffer_pool_read_requests'" | awk '{print $2}')
  reads=$($MYSQL_CMD -N -e "SHOW STATUS LIKE 'Innodb_buffer_pool_reads'" | awk '{print $2}')

  if [ "$requests" -gt 0 ] 2>/dev/null; then
    hit_rate=$(awk "BEGIN {printf \"%.4f\", 1 - ($reads / $requests)}")
    hit_pct=$(awk "BEGIN {printf \"%.2f\", $hit_rate * 100}")

    if (( $(echo "$hit_pct < $THRESHOLD_BUF_HIT" | bc -l) )); then
      echo "[WARN] Buffer Pool hit rate LOW: ${hit_pct}% (reads=$reads, requests=$requests)" >> "$LOG_FILE"
      ((WARN_COUNT++))
    else
      echo "[OK] Buffer Pool hit rate: ${hit_pct}%" >> "$LOG_FILE"
    fi
  else
    echo "[INFO] Buffer Pool: insufficient data for calculation" >> "$LOG_FILE"
  fi
}

# ========== 4. 检查 Slave 状态（如果有） ==========
check_slave() {
  local slave_status delay
  slave_status=$($MYSQL_CMD -N -e "SHOW SLAVE STATUS" 2>/dev/null) || return 0

  if [ -z "$slave_status" ]; then
    echo "[INFO] Not a slave server, skipping slave check" >> "$LOG_FILE"
    return 0
  fi

  # IO Thread
  local io_running
  io_running=$(echo "$slave_status" | grep -oP 'Slave_IO_Running: \K\S+')
  if [ "$io_running" != "Yes" ]; then
    echo "[FAIL] Slave IO Thread is NOT running!" >> "$LOG_FILE"
    ((ERROR_COUNT++))
  else
    echo "[OK] Slave IO Thread: running" >> "$LOG_FILE"
  fi

  # SQL Thread
  local sql_running
  sql_running=$(echo "$slave_status" | grep -oP 'SQL_Running: \K\S+')
  if [ "$sql_running" != "Yes" ]; then
    echo "[FAIL] Slave SQL Thread is NOT running!" >> "$LOG_FILE"
    ((ERROR_COUNT++))
  else
    echo "[OK] Slave SQL Thread: running" >> "$LOG_FILE"
  fi

  # Delay
  delay=$(echo "$slave_status" | grep -oP 'Seconds_Behind_Master: \K\S+')
  if [ "$delay" = "NULL" ]; then
    echo "[INFO] Slave delay: N/A" >> "$LOG_FILE"
  elif [ "$delay" -gt "$THRESHOLD_SLAVE_DELAY" ]; then
    echo "[WARN] Slave delay is HIGH: ${delay}s (threshold: ${THRESHOLD_SLAVE_DELAY}s)" >> "$LOG_FILE"
    ((WARN_COUNT++))
  else
    echo "[OK] Slave delay: ${delay}s" >> "$LOG_FILE"
  fi
}

# ========== 5. 检查慢查询（最近 1 小时） ==========
check_slow_queries() {
  local slow_count
  slow_count=$($MYSQL_CMD -N -e "
    SELECT COUNT(*) FROM mysql.slow_log
    WHERE start_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)
  " 2>/dev/null || echo "0")

  if [ "$slow_count" -gt 10 ]; then
    echo "[WARN] High slow query count in last hour: ${slow_count}" >> "$LOG_FILE"
    ((WARN_COUNT++))
  else
    echo "[OK] Slow queries in last hour: ${slow_count}" >> "$LOG_FILE"
  fi
}

# ========== 6. 检查磁盘空间 ==========
check_disk() {
  local data_dir disk_usage
  data_dir=$($MYSQL_CMD -N -e "SELECT @@datadir" | tr -d '/')
  disk_usage=$(df -h "$data_dir" | tail -1 | awk '{print $5}' | tr -d '%')

  if [ "$disk_usage" -gt 90 ]; then
    echo "[FAIL] Disk usage CRITICAL: ${disk_usage}% on ${data_dir}" >> "$LOG_FILE"
    ((ERROR_COUNT++))
  elif [ "$disk_usage" -gt 80 ]; then
    echo "[WARN] Disk usage HIGH: ${disk_usage}% on ${data_dir}" >> "$LOG_FILE"
    ((WARN_COUNT++))
  else
    echo "[OK] Disk usage: ${disk_usage}% on ${data_dir}" >> "$LOG_FILE"
  fi
}

# ========== 7. 检查 InnoDB 行锁 ==========
check_row_locks() {
  local lock_waits lock_time_avg
  lock_waits=$($MYSQL_CMD -N -e "SHOW STATUS LIKE 'Innodb_row_lock_waits'" | awk '{print $2}')

  if [ "$lock_waits" -gt 100 ]; then
    echo "[WARN] High row lock waits: ${lock_waits}" >> "$LOG_FILE"
    ((WARN_COUNT++))
  else
    echo "[OK] Row lock waits: ${lock_waits}" >> "$LOG_FILE"
  fi
}

# ========== 执行所有检查 ==========
{
  check_process
  check_connections
  check_buffer_pool
  check_slave
  check_slow_queries
  check_disk
  check_row_locks
} >> "$LOG_FILE" 2>&1

# ========== 输出汇总 ==========
echo "" >> "$LOG_FILE"
echo "--- Summary ---" >> "$LOG_FILE"
echo "Errors: $ERROR_COUNT | Warnings: $WARN_COUNT" >> "$LOG_FILE"
echo "==========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# 发送告警邮件（如有错误）
if [ "$ERROR_COUNT" -gt 0 ]; then
  echo "MySQL Health Check FAILED with $ERROR_ERROR error(s)" | mail -s "🔴 MySQL Alert: Health Check Failed" "$ALERT_EMAIL" < "$LOG_FILE"
elif [ "$WARN_COUNT" -gt 0 ]; then
  echo "MySQL Health Check has $WARN_COUNT warning(s)" | mail -s "🟡 MySQL Warning: Health Check Warnings" "$ALERT_EMAIL" < "$LOG_FILE"
fi

exit $ERROR_COUNT
```

#### 3.3.2 **慢查询 Top SQL 分析脚本**

```sql
-- ============================================================
-- 慢查询 Top 10 分析 SQL（基于 performance_schema / sys schema）
-- ============================================================

-- 方法1：使用 sys.schema_table_statistics_with_buffer（推荐）
SELECT
  table_schema AS `数据库`,
  table_name AS `表名`,
  rows_fetched AS `读取行数`,
  rows_changed AS `修改行数`,
  full_scans AS `全表扫描次数`,
  FORMAT_PICO_TIME(sum_timer_wait) AS `总耗时`
FROM sys.schema_table_statistics_with_buffer
WHERE sum_timer_wait > 1000000000000  -- 超过1秒
ORDER BY sum_timer_wait DESC
LIMIT 10;

-- 方法2：按 SQL 语句统计（找出最耗时的 SQL 模板）
SELECT
  DIGEST_TEXT AS `SQL模板`,
  COUNT_STAR AS `执行次数`,
  FORMAT_PICO_TIME(SUM_TIMER_WAIT) AS `总耗时`,
  FORMAT_PICO_TIME(AVG_TIMER_WAIT) AS `平均耗时`,
  FORMAT_PICO_TIME(MAX_TIMER_WAIT) AS `最大耗时`,
  SUM_ROWS_SENT AS `返回行数`,
  SUM_ROWS_EXAMINED AS `扫描行数`,
  SUM_CREATED_TMP_TABLES AS `临时表数`,
  SUM_CREATED_TMP_DISK_TABLES AS `磁盘临时表数`,
  SUM_SORT_MERGE_PASSES AS `排序合并次数`,
  FIRST_SEEN AS `首次出现`,
  LAST_SEEN AS `最后出现`
FROM performance_schema.events_statements_summary_by_digest
WHERE SUM_TIMER_WAIT > 0
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;

-- 方法3：查找全表扫描最多的表
SELECT
  object_schema,
  object_name,
  count_fetched AS `全表扫描次数`,
  FORMAT_PICO_TIME(sum_timer_fetch) AS `全表扫描耗时`
FROM sys.schema_tables_with_full_table_scans
ORDER BY sum_timer_fetch DESC
LIMIT 10;

-- 方法4：查找未使用索引的查询
SELECT
  DIGEST_TEXT AS `SQL模板`,
  SCHEMA_NAME AS `数据库`,
  no_index_used_count AS `无索引使用次数`,
  no_good_index_used_count AS `无合适索引次数`
FROM performance_schema.events_statements_summary_by_digest
WHERE no_index_used_count > 0
   OR no_good_index_used_count > 0
ORDER BY (no_index_used_count + no_good_index_used_count) DESC
LIMIT 10;
```

#### 3.3.3 **主备一致性校验工具**

```bash
#!/bin/bash
# ============================================================
# pt-table-checksum 主备一致性检查
# 前提：安装 percona-toolkit
# ============================================================

MASTER_HOST="192.168.1.10"
SLAVE_HOST="192.168.1.20"
CHECK_USER="checksum_user"
CHECK_PASS="Checksum_Pass#2024"
DATABASES="app_db,analytics"  # 要检查的数据库（逗号分隔）

echo "$(date) Starting consistency check..."

pt-table-checksum \
  h="${MASTER_HOST}",u="${CHECK_USER}",p="${CHECK_PASS}" \
  --replicate-check-only \
  --databases "${DATABASES}" \
  --no-check-binlog-format \
  --chunk-size=5000 \
  --max-lag=2 \
  --critical-speed-regression=0.25 \
  --progress=time,30

if [ $? -eq 0 ]; then
  echo "$(date) Consistency check PASSED ✅"
else
  echo "$(date) Consistency check FAILED! Differences detected:"
  # 显示不一致的表
  pt-table-sync \
    --print \
    h="${SLAVE_HOST}",u="${CHECK_USER}",p="${CHECK_PASS}" \
    --replicate percona.checksums
fi
```