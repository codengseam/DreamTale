---
id: 202603280000
title: 35_join优化
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[35_35_join语句怎么优化？.md]]"
status: published
ai_generated: true
---

关联源素材：[[35_35_join语句怎么优化？]]

# join语句怎么优化？

## 核心知识清单（20%重点）

### 🔹 Multi-Range Read (MRR)优化

**定义**：通过调整查询顺序，将随机访问转为顺序访问，提升读性能。

**核心原理**：
- 大多数数据按主键递增顺序插入
- 按主键递增顺序查询 → 接近顺序读 → 性能提升

**执行流程**：
1. 根据索引a定位记录，将id值放入`read_rnd_buffer`
2. 将`read_rnd_buffer`中的id进行递增排序
3. 排序后的id数组，依次到主键索引中查记录并返回

**关键配置**：
```sql
set optimizer_switch="mrr_cost_based=off";
```

**性能提升核心**：范围查询得到足够多的主键id，排序后体现"顺序性"优势。



### 🔹 BNL算法的三大性能问题

**问题一：多次扫描被驱动表**
- 占用磁盘IO资源
- 执行时间超过1秒会影响Buffer Pool

**问题二：M×N次对比**
- 判断join条件需执行M×N次对比（M、N为两表行数）
- 大表join消耗大量CPU资源

**问题三：影响Buffer Pool**
- 冷表数据页移到LRU链表头部
- 业务正常访问的数据页无法进入young区域
- 影响持续到后续查询恢复内存命中率

**优化方向**：给被驱动表的join字段加索引，转成BKA算法。



### 🔹 Hash Join扩展思路

**现状**：MySQL不支持Hash Join

**业务端实现方案**：
```sql
-- 1. 取驱动表数据到业务端hash结构
select * from t1;  -- 存入C++ set/PHP数组

-- 2. 取被驱动表过滤后数据
select * from t2 where b>=1 and b<=2000;

-- 3. 业务端hash查找匹配
-- 逐行到hash结构中查找匹配数据
```

**性能优势**：100万次hash查找 vs 10亿次判断



## 思考问答

### 1. 为什么MRR优化能提升性能？

**核心**：将随机访问转为顺序访问。

**分析**：
- 按索引a递增查询 → 主键id变成随机值 → 随机访问性能差
- 按主键id排序后查询 → 接近顺序读 → 磁盘IO性能提升
- **关键条件**：范围查询得到足够多的id，排序才有意义



### 3. 三表join的索引设计思路？

**示例SQL**：
```sql
select * from t1 
join t2 on(t1.a=t2.a) 
join t3 on (t2.b=t3.b) 
where t1.c>=X and t2.c>=Y and t3.c>=Z;
```

**设计原则**：
1. **where条件字段建索引**：t1.c、t2.c、t3.c快速过滤
2. **join字段建索引**：t2.a、t3.b支持BKA算法
3. **驱动表选择**：过滤后数据量最小的表作为驱动表
4. **straight_join使用**：人为控制连接顺序，配合索引优化

---

## 实践要点总结

### ✅ 推荐做法
- 默认启用BKA优化
- 大表join前先explain确认算法
- 增大`join_buffer_size`减少扫描次数
- 低频SQL用临时表方案

### ❌ 避免陷阱
- 不要在被驱动表无索引时使用BNL
- 不要忽视Buffer Pool的持续影响
- 不要盲目建索引（考虑维护成本）

### 📊 性能对比
| 算法 | 比较次数 | IO特点 | 适用场景 |
|------|---------|--------|---------|
| NLJ | M次索引查找 | 随机读 | 被驱动表有索引 |
| BKA | M次批量查找 | 顺序读 | NLJ优化版 |
| BNL | M×N次对比 | 多次全表扫描 | 无索引场景 |
| Hash Join | N次hash查找 | 顺序读 | 业务端实现 |