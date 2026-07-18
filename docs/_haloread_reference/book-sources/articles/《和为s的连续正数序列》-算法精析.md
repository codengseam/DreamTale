---
id: 20260408103939
title: 《和为s的连续正数序列》-算法精析
created: 2026-04-08 10:39
updated: 2026-04-08 10:39
tags:
  - algorithm/two_pointers
  - difficulty/easy
  - leetcode
source: algorithms.md
status: published
ai_generated: true
type: algorithm
leetcode_link: https://leetcode.cn/problems/he-wei-sde-lian-xu-zheng-shu-xu-lie-lcof/
difficulty: Easy
---

关联源素材：[[algorithms.md]]

## 题目信息

**题目信息**：LeetCode 剑指 Offer 57 - II. 和为s的连续正数序列

*   **原题链接**：[和为s的连续正数序列](https://leetcode.cn/problems/he-wei-sde-lian-xu-zheng-shu-xu-lie-lcof/)
*   **难度**：Easy
*   **描述**：输入一个正整数 `target` ,输出所有和为 `target` 的连续正整数序列（至少含有两个数）。

### 🛒 题目 "人话" 翻译

**"毛毛虫吃菜"**。

*   比如 target = 9。
*   可以是 `2 + 3 + 4`。
*   可以是 `4 + 5`。
*   我们要找所有这种连续的组合。



### 💡 思路 "推导" 过程

我们来模拟一下小白的思考过程：

**第一阶段：暴力枚举** 🐢
*   **想法**：枚举所有可能的连续序列,计算和。
*   **问题**：时间复杂度 O(N^2),效率太低。

**第二阶段：滑动窗口** 🐇
*   **想法**：用两个指针维护一个窗口。
*   **关键点**：
    *   窗口内的和可以用等差数列求和公式：`(i + j) * (j - i + 1) / 2`
    *   根据和与 target 的关系调整窗口大小
*   **优点**：时间复杂度 O(N),空间复杂度 O(1)。

**第三阶段：优化实现** ✨
*   **想法**：窗口左边界最多到 target/2,因为至少需要两个数。
*   **终止条件**：当左边界超过 target/2 时停止。



### 🚗 代码 "带逛"

```python
def findContinuousSequence(target):
    i, j = 1, 2 # 窗口初始化 [1, 2]
    res = []
    
    # 窗口左边界最多到 target 的一半
    # 因为至少要是两个数,比如 9 的一半是 4.5,也就是 4+5。超过一半就不可能凑出两个数了
    while i <= target // 2:
        # 计算窗口和：等差数列求和公式 (首项+末项)*项数/2
        current_sum = (i + j) * (j - i + 1) // 2
        
        if current_sum == target:
            # 记录当前窗口 [i, i+1, ..., j]
            res.append(list(range(i, j + 1)))
            i += 1 # 找到一个后,左边缩一下,继续找
        elif current_sum < target:
            j += 1 # 不够,右边扩
        else:
            i += 1 # 多了,左边缩
            
    return res
```

---

相关笔记：[[算法与面试-MOC]]
