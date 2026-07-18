---
id: 20260328000000
title: 40_insert语句锁
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[40_40_insert语句的锁为什么这么多？.md]]"
status: published
ai_generated: true
---
关联源素材:[[40_40_insert语句的锁为什么这么多？]]



# 核心知识清单(20%)

## 1. insert...select语句的锁机制

**核心问题**:为什么在可重复读隔离级别下,`insert...select`要对源表所有行和间隙加锁?

**关键原因**:保证binlog和数据一致性

**场景示例**:
```sql
-- session B先执行
insert into t2(c,d) select c,d from t;

-- session A后执行但先写入binlog
insert into t values(-1,-1,-1);
```

**不加锁的后果**:
- binlog记录顺序与执行顺序不一致
- 备库执行时会把id=-1写入t2
- 导致主备数据不一致

**加锁范围**:
- 源表主键索引所有行和间隙加next-key lock
- 目标表只锁需要访问的资源

**思考**:为什么不能用快照读避免加锁?因为binlog_format=statement时需要保证语句执行顺序一致性



## 3. insert唯一键冲突加锁机制

**核心发现**:唯一键冲突时加共享next-key lock(S锁)

**场景示例**:
```sql
-- session A插入c=5,唯一键冲突
insert into t values(5,5,5);
-- 持有索引c上(5,10]共享next-key lock

-- session B插入相同值,锁等待
insert into t values(5,5,5);
```

**加锁原因**:
- 官方解释:避免该行被其他事务删除
- 作者观点:未找到完全合理的解释

**重要纠正**:
- 官方文档错误:主键冲突加记录锁,唯一索引加next-key lock
- **实际情况**:两类索引冲突都加next-key lock



## 5. insert...on duplicate key update

**语义**:插入数据,唯一键冲突时执行更新

**加锁规则**:加排他next-key lock(X锁)

**多唯一键冲突处理**:
```sql
-- 表t有(1,1,1)和(2,2,2)
insert into t values(2,1,1) on duplicate key update d=100;
```

**执行结果**:
- 主键id先判断,与id=2冲突
- 修改id=2的行
- affected rows返回2(误导性)

**注意**:按照索引顺序修改第一个冲突的行



# 思考问答

1. **insert...select语句在可重复读隔离级别下,为什么不能用快照读避免加锁?请从binlog一致性角度分析**

2. **同表insert循环写入场景中,为什么临时表方案能避免全表扫描?请结合执行流程说明**

3. **唯一键冲突死锁场景中,为什么session B/C能成功加间隙锁,但记录锁需要等待?这与next-key lock的组成有什么关系?**

---

# 关联笔记
- [[21_改一行锁多-AI精析]] - next-key lock加锁规则
- [[20_幻读问题-AI精析]] - 间隙锁机制
- [[03_事务隔离-AI精析]] - 可重复读隔离级别
