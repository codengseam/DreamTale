---
id: 202603280000
title: 42_grant权限
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[42_42_grant之后要跟着flushprivileges吗？.md]]"
status: published
ai_generated: true
---

关联源素材：[[42_42_grant之后要跟着flushprivileges吗？]]

# grant之后要跟着flush privileges吗？

## 核心知识清单（20%关键项）

### 🔹 核心结论：grant后无需flush privileges

**关键认知**：grant语句会同时修改磁盘表和内存数据，命令完成后即时生效，**正常情况下不需要执行flush privileges**。

**原理机制**：
- **磁盘操作**：直接修改mysql.user/db/tables_priv/columns_priv表
- **内存操作**：同步更新acl_users/acl_dbs/column_priv_hash等内存结构
- **权限判断**：使用内存数据，非磁盘数据

*思考：为什么MySQL要同时维护磁盘和内存两套权限数据？性能与持久化的平衡点在哪里？*



### 🔹 flush privileges的正确使用场景

#### 使用时机
**仅在权限数据不一致时使用**，用于重建内存权限数据。

#### 不一致产生原因
**直接用DML操作系统权限表**（不规范操作）：
```sql
-- 错误示范
delete from mysql.user where user='ua';  -- 只删磁盘，内存还在
```

#### 不规范操作的后果
1. **用户删除后仍可登录**：内存acl_users中仍有该用户
2. **无法重新赋权**：磁盘表无记录，grant失败
3. **无法重建用户**：内存判断用户存在，create user失败

#### flush privileges的作用
清空内存权限数组，从磁盘表重新加载，强制内存与磁盘一致。

*实操要点：永远不要直接DML操作系统权限表，使用grant/revoke语句*

---

### 🔹 用户创建与权限管理最佳实践

#### 创建用户
```sql
create user 'ua'@'%' identified by 'pa';
```
- **用户标识**：user+host才表示