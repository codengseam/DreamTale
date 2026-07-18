---
id: 20260328000000
title: 34_join使用
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[34_34_到底可不可以使用join？.md]]"
status: published
ai_generated: true
---
关联源素材:[[34_34_到底可不可以使用join？]]



# 核心问题

本文解决两个关键问题:
1. **能不能使用join语句?**
2. **如果使用join,应该选择哪个表做驱动表?**

# 核心概念

## 1. Index Nested-Loop Join (NLJ)

### 执行条件
被驱动表的关联字段**有索引**时使用

### 执行流程
```
1. 从驱动表t1读入一行数据R
2. 从R中取出关联字段值,到被驱动表t2通过索引查找
3. 取出t2中满足条件的行,与R组成结果集
4. 重复步骤1-3,直到驱动表扫描结束
```

### 性能分析
- **扫描行数**: N(驱动表) + N*M次索引查找
- **时间复杂度**: N + N*2*log₂M
- **关键结论**: N对性能影响更大,应让**小表做驱动表**

### 实践示例
```sql
-- t1(100行)驱动t2(1000行),t2.a有索引
select * from t1 straight_join t2 on (t1.a=t2.a);
-- 扫描行数: 100 + 100 = 200行
```

## 2. Block Nested-Loop Join (BNL)

### 执行条件
被驱动表的关联字段**无索引**时使用

### 执行流程
```
1. 将驱动表数据读入join_buffer
2. 扫描被驱动表,每行与join_buffer中数据对比
3. 满足条件的作为结果集返回
4. 如果join_buffer不够,分段处理(清空后重复步骤1-3)
```

### 性能分析
- **扫描行数**: N + M(两表全表扫描)
- **内存判断**: N*M次
- **分段影响**: join_buffer_size不足时,被驱动表会被多次扫描

### 实践示例
```sql
-- t1(100行)驱动t2(1000行),t2.b无索引
select * from t1 straight_join t2 on (t1.a=t2.b);
-- 扫描行数: 100 + 1000 = 1100行
-- 内存判断: 100*1000 = 10万次
```

# 关键知识点

## 1. 能否使用join的判断标准

### ✅ 可以使用join的情况
- 被驱动表关联字段**有索引**
- 使用Index Nested-Loop Join算法
- 性能优于拆分成多个单表查询

### ❌ 不建议使用join的情况
- 被驱动表关联字段**无索引**
- 使用Block Nested-Loop Join算法
- 大表join会多次扫描被驱动表,占用大量系统资源

### 🔍 判断方法
查看`EXPLAIN`结果的`Extra`字段:
- 无"Block Nested Loop"字样 → 可以使用
- 有"Block Nested Loop"字样 → 不建议使用

## 2. 驱动表选择原则

### 核心原则
**总是使用小表做驱动表**

### "小表"的准确定义
不是简单的行数少,而是:
> 两个表按照各自条件过滤后,**参与join的字段总数据量**较小的表

### 示例对比

**场景1: WHERE条件影响**
```sql
-- 语句1: t2只有50行参与join
select * from t1 straight_join t2 on (t1.b=t2.b) where t2.id<=50;

-- 语句2: t1有100行参与join
select * from t2 straight_join t1 on (t1.b=t2.b) where t2.id<=50;

-- 结论: 语句1更优,t2(50行)是"小表"
```

**场景2: SELECT字段影响**
```sql
-- 语句1: t1只查字段b,join_buffer占用小
select t1.b,t2.* from t1 straight_join t2 on (t1.b=t2.b) where t2.id<=100;

-- 语句2: t2查所有字段,join_buffer占用大
select t1.b,t2.* from t2 straight_join t1 on (t1.b=t2.b) where t2.id<=100;

-- 结论: 语句1更优,t1(只含b字段)是"小表"
```

## 3. join_buffer_size参数优化

### 参数作用
- 控制join_buffer大小
- 默认值: 256KB
- 影响BNL算法的分段次数

### 优化建议
- join_buffer_size越大,分段越少,被驱动表扫描次数越少
- 如果join语句慢,可适当增大该参数

### 分段机制
```
驱动表N行,被驱动表M行,join_buffer_size可容纳K行
- 分段数: N/K
- 扫描行数: N + (N/K)*M
- 判断次数: N*M(不变)
```

# 实践要点

## 1. 性能优化检查清单

- [ ] 检查被驱动表关联字段是否有索引
- [ ] 使用EXPLAIN确认执行算法
- [ ] 确保小表做驱动表
- [ ] 监控join_buffer_size是否足够
- [ ] 避免大表使用BNL算法

## 2. 潜在风险

### Buffer Pool污染
- BNL算法多次扫描大表(冷数据)
- 间隔超过1秒会污染LRU young区域
- 导致热点数据被淘汰,查询性能下降

### 长事务影响
- 多次全表扫描导致事务时间过长
- 占用行锁,阻塞其他更新
- undo log无法回收,回滚段膨胀

## 3. 最佳实践

### 推荐做法
```sql
-- ✅ 好: 被驱动表有索引,小表驱动
select * from small_table straight_join large_table 
on (small_table.indexed_field = large_table.indexed_field);

-- ✅ 好: 拆分成多个单表查询(无法使用索引时)
-- 步骤1: 查询驱动表
select * from small_table where condition;
-- 步骤2: 应用层循环查询被驱动表
select * from large_table where id in (...);
```

### 避免做法
```sql
-- ❌ 差: 大表驱动小表
select * from large_table straight_join small_table 
on (large_table.field = small_table.field);

-- ❌ 差: 无索引字段join大表
select * from table1 join table2 on (table1.no_index = table2.no_index);
```

# 核心结论总结

| 场景 | 能否使用join | 驱动表选择 | 算法 |
|------|------------|----------|------|
| 被驱动表有索引 | ✅ 可以 | 小表 | Index Nested-Loop Join |
| 被驱动表无索引 | ❌ 不建议 | 小表 | Block Nested-Loop Join |

**关键记忆点**:
1. 有索引用join,无索引慎用
2. 小表做驱动表(数据量小,不是行数少)
3. BNL算法会污染Buffer Pool
4. join_buffer_size影响分段次数

# 思考问题

1. 如果你的业务中有一个大表(1000万行)和一个小表(1万行)需要join,被驱动表无索引,你会如何优化?

2. 为什么说"小表"不是简单的行数少,而是参与join的字段总数据量小?这对实际开发有什么启示?
