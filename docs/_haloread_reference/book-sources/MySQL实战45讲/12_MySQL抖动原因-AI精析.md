---
id: 202603280000
title: 12_MySQL抖动原因
created: 2026-03-28
updated: 2026-04-08
tags:
  - type/ai-precis
  - topic/MySQL
  - source/MySQL实战45讲
source: "[[12_12_为什么我的MySQL会"抖"一下？.md]]"
status: published
ai_generated: true
---

关联源素材：[[12_12_为什么我的MySQL会"抖"一下？]]

# 核心知识清单（20%关键项）

## 🔹 MySQL抖动的根本原因：脏页刷盘

**核心概念**：
- **脏页**：内存中被修改但未写入磁盘的数据页
- **抖动现象**：SQL语句执行时间突然变长，系统性能瞬间下降

**为什么会产生抖动？**
WAL机制将随机写转换为顺序写，提升性能的同时带来脏页问题。刷脏页时占用IO资源，影响查询和更新语句响应时间。



## 🔹 刷脏页控制策略（核心机制）

### 关键参数1：innodb_io_capacity
- **作用**：告诉InnoDB磁盘的IO能力
- **建议值**：设置为磁盘的IOPS（可用fio工具测试）
- **错误案例**：SSD磁盘但设置成300，导致刷脏页过慢，性能下降

### 关键参数2：脏页比例控制
- **默认上限**：innodb_max_dirty_pages_pct = 75%
- **计算公式**：
  ```
  F1(M) = {
    if M >= 75% then return 100
    else return 100 * M / 75%
  }
  ```
- **监控命令**：
  ```sql
  SELECT VARIABLE_VALUE INTO @a 
  FROM global_status 
  WHERE VARIABLE_NAME = 'Innodb_buffer_pool_pages_dirty';
  
  SELECT VARIABLE_VALUE INTO @b 
  FROM global_status 
  WHERE VARIABLE_NAME = 'Innodb_buffer_pool_pages_total';
  
  SELECT @a/@b;  -- 脏页比例
  ```

### 刷脏页速度计算
```
R = max(F1(脏页比例), F2(redo log写入速度))
刷脏页速度 = innodb_io_capacity × R%
```



# 次要信息速览（80%快速带过）

## 【WAL机制回顾】
- Write-Ahead Logging：先写日志，再写磁盘
- 将随机写转换为顺序写，提升性能
- 代价：产生内存脏页需要后续刷盘

## 【缓冲池内存页状态】
- 未使用页面
- 干净页：内存与磁盘数据一致
- 脏页：内存数据已修改，磁盘未同步

## 【LSN机制】
- 每个数据页头部有LSN（8字节）
- 对比数据页LSN与checkpoint LSN判断是否脏页
- 比checkpoint小的LSN一定是干净页

## 【redo log重放机制】
- 重启时从checkpoint位置往后扫描
- 已刷盘的数据页会被识别并跳过
- 不用修改redo log文件本身



# 实践要点总结

## 必做配置
1. **正确设置innodb_io_capacity**：使用fio测试磁盘IOPS
2. **监控脏页比例**：定期执行监控SQL，避免接近75%
3. **SSD环境关闭连坐**：设置innodb_flush_neighbors=0

## 避免踩坑
- ❌ SSD磁盘但innodb_io_capacity设置过低
- ❌ redo log文件设置过小
- ❌ 忽略脏页比例监控

## 性能优化方向
- 增大缓冲池减少脏页淘汰频率
- 合理设置redo log大小
- 使用SSD提升IO能力