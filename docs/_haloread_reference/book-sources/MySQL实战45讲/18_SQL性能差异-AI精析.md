---
id: 202603280000
title: 18_SQL性能差异
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[18_18_为什么这些SQL语句逻辑相同，性能却差异巨大？.md]]"
status: published
ai_generated: true
---

关联源素材：[[18_18_为什么这些SQL语句逻辑相同，性能却差异巨大？]]

# 核心知识清单(20%重点)

## 🔹 核心原则:索引字段函数操作陷阱

**定义**:对索引字段做函数操作,可能破坏索引值的有序性,导致优化器放弃树搜索功能,转而使用全索引扫描。

**应用场景**:
- 显式函数操作:`WHERE MONTH(t_modified)=7`
- 隐式类型转换:`WHERE tradeid=110717`(tradeid是varchar类型)
- 隐式字符编码转换:表连接时字符集不一致(utf8 vs utf8mb4)

**常见错误及规避**:
```sql
-- ❌ 错误:在索引字段上使用函数
SELECT COUNT(*) FROM tradelog WHERE MONTH(t_modified)=7;

-- ✅ 正确:改写字段本身的范围查询
SELECT COUNT(*) FROM tradelog 
WHERE (t_modified >= '2016-7-1' AND t_modified < '2016-8-1')
   OR (t_modified >= '2017-7-1' AND t_modified < '2017-8-1')
   OR (t_modified >= '2018-7-1' AND t_modified < '2018-8-1');
```

*思考:为什么优化器不自动将`WHERE id+1=10000`改写为`WHERE id=9999`?*



## 🔹 隐式字符编码转换

**核心机制**:当连接字段的字符集不同时,MySQL会将较小字符集转换为较大字符集(utf8 → utf8mb4)。

**关键场景**:表连接查询时,如果被驱动表的索引字段需要转换字符集,则无法使用索引。

**优化方案**:
```sql
-- 方案1:统一字符集(推荐)
ALTER TABLE trade_detail MODIFY tradeid VARCHAR(32) CHARACTER SET utf8mb4 DEFAULT NULL;

-- 方案2:手动转换驱动表字段(临时方案)
SELECT d.* FROM tradelog l, trade_detail d 
WHERE d.tradeid = CONVERT(l.tradeid USING utf8) AND l.id=2;
```

**判断逻辑**:
- 驱动表字段字符集 < 被驱动表字段字符集 → 被驱动表索引字段需转换 → 无法使用索引
- 驱动表字段字符集 ≥ 被驱动表字段字符集 → 驱动表字段需转换 → 可以使用被驱动表索引



# 思考问答

1. **深度思考**:如果有一个查询`WHERE YEAR(create_time)=2023 AND MONTH(create_time)=3`,应该如何优化才能使用索引?为什么?

2. **实战应用**:在你的项目中,是否遇到过类似"SQL逻辑相同但性能差异巨大"的情况?可能的原因有哪些?(提示:除了本文提到的三种情况,还可能涉及索引选择、驱动表选择、锁等待等因素)

---

# 关联笔记
- [[04_深入浅出索引上-AI精析]] - B+树索引结构
- [[05_深入浅出索引下-AI精析]] - 索引使用原则
- [[10_MySQL选错索引-AI精析]] - 优化器索引选择机制