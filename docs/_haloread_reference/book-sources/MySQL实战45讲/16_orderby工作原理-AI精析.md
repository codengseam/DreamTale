---
id: 20260328000000
title: 16_orderby工作原理
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[16_16_"orderby"是怎么工作的？.md]]"
status: published
ai_generated: true
---
关联源素材:[[16_16_"orderby"是怎么工作的？]]



# "orderby"是怎么工作的？

## 核心知识清单(20%)

### 1. 全字段排序机制

**定义**: MySQL将查询需要的所有字段都放入sort_buffer中进行排序的方式。

**执行流程**:
1. 初始化sort_buffer,确定放入name、city、age三个字段
2. 从索引city找到满足条件的主键id
3. 到主键索引取出整行,取需要的字段存入sort_buffer
4. 重复步骤2-3直到条件不满足
5. 对sort_buffer中的数据按name字段做快速排序
6. 取前1000行返回给客户端

**关键参数**:
- `sort_buffer_size`: 控制排序内存大小
  - 数据量 < sort_buffer_size: 内存中完成排序
  - 数据量 > sort_buffer_size: 使用磁盘临时文件辅助排序

**判断是否使用临时文件**:
```sql
SET optimizer_trace='enabled=on';
select city, name, age from t where city='杭州' order by name limit 1000;
SELECT * FROM information_schema.OPTIMIZER_TRACE\G
```
查看`number_of_tmp_files`字段:
- 0: 内存排序
- >0: 使用临时文件(归并排序)

**思考**: 为什么MySQL要分成多个临时文件而不是一个大文件?



### 3. 联合索引优化排序

**核心思想**: 通过建立合适的联合索引,让数据天然有序,避免排序操作。

**优化方案一: (city, name)联合索引**
```sql
alter table t add index city_user(city, name);
```

**执行流程**:
1. 从索引(city,name)找到第一个满足city='杭州'的主键id
2. 到主键索引取出整行,返回结果
3. 从索引(city,name)取下一个记录
4. 重复步骤2-3,直到取够1000条

**优势**:
- 不需要临时表
- 不需要排序
- 只需扫描1000次(而非全部4000行)

**优化方案二: (city, name, age)联合索引(覆盖索引)**
```sql
alter table t add index city_user_age(city, name, age);
```

**执行流程**:
1. 从索引(city,name,age)找到第一个满足条件的记录
2. 直接从索引中取出city、name、age返回
3. 取下一个记录,重复步骤2

**优势**:
- 不需要回表(Using index)
- 性能最优

**权衡**: 索引维护成本 vs 查询性能提升

**思考**: 为什么联合索引要按照(city, name, age)的顺序,而不是(name, city, age)?



## 思考问答

1. 如果查询语句是`select * from t where city in ('杭州','苏州') order by name limit 100`,已经有了(city, name)联合索引,还会有排序过程吗?为什么?

2. 在实际开发中,如何权衡"建立联合索引避免排序"和"索引维护成本"之间的关系?什么情况下应该建立覆盖索引?

3. 假设sort_buffer_size设置为256KB,要排序的数据有100万行,每行100字节,MySQL会如何处理?会创建多少个临时文件?



## 关键概念链接

- [[04_深入浅出索引上-AI精析]] - 索引基础原理
- [[05_深入浅出索引下-AI精析]] - 联合索引与覆盖索引
- [[17_显示随机消息-AI精析]] - 堆排序优化(limit场景)
