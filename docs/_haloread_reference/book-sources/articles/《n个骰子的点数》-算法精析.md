---
id: 20260408144200
title: 《n个骰子的点数》-算法精析
created: 2026-04-08 14:42
updated: 2026-04-08 14:42
tags:
  - algorithm/dynamic_programming
  - difficulty/Medium
  - leetcode
source: algorithms.md
status: published
ai_generated: true
type: algorithm
leetcode_link: https://leetcode.cn/problems/nge-tou-zi-de-dian-shu-lcof/
difficulty: Medium
---

## 题目信息

**题目名称**：n个骰子的点数

**LeetCode链接**：[n个骰子的点数](https://leetcode.cn/problems/nge-tou-zi-de-dian-shu-lcof/)

**难度**：Medium

**描述**：把n个骰子扔在地上，所有骰子朝上一面的点数之和为s。输入n，打印出s的所有可能的值出现的概率。

## 🛒 题目"人话"翻译

*   扔 1 个骰子：1~6 的概率都是 1/6。
*   扔 2 个骰子：和为 2 (1+1) 的概率是 1/36，和为 7 (1+6, 2+5, 3+4...) 的概率是 6/36。
*   扔 n 个骰子，求所有和的概率分布。

## 🧊 知识点"破冰"讲解

**动态规划 (DP)**。

*   `dp[i][j]` 表示扔 `i` 个骰子，和为 `j` 的出现次数。
*   **状态转移**：第 `i` 个骰子可能投出 `1~6` 点。
    *   所以 `dp[i][j]` = `dp[i-1][j-1]` + `dp[i-1][j-2]` + ... + `dp[i-1][j-6]`。
    *   意思是：现在的和 `j`，可能是之前和为 `j-1` 加上这次投了 1 点，也可能是之前和为 `j-2` 加上这次投了 2 点...

## 💡 思路"推导"过程

这道题的关键在于理解动态规划的状态转移。

**第一阶段：暴力解法**
*   枚举所有可能的组合，统计每个和出现的次数。
*   时间复杂度 O(6^n)，指数级，太慢了。

**第二阶段：动态规划**
*   利用动态规划，逐步计算每个骰子数量下的概率分布。
*   时间复杂度 O(n * 6n) = O(n²)，空间复杂度 O(n)。

## ❓ "为什么"的解释

**Q：为什么用动态规划？**

**A：** 因为每个状态只依赖于前一个状态。扔 n 个骰子的概率分布，可以从扔 n-1 个骰子的概率分布推导出来。这种重叠子问题和最优子结构的特性，正是动态规划的适用场景。

## 🚗 代码"带逛"

```python
def dicesProbability(n):
    # dp[i] 表示和为 i 的出现次数
    # 初始状态：1 个骰子，和为 1~6 各出现 1 次
    dp = [1/6] * 6
    
    # 从第 2 个骰子开始投
    for i in range(2, n + 1):
        # 新的 dp 数组，长度是 5*i + 1 (最小是 i，最大是 6i，范围长度 5i+1)
        # 这里的逻辑稍微简化一下，直接模拟概率分布
        tmp = [0] * (5 * i + 1)
        
        # 遍历上一轮的每一个概率
        for j in range(len(dp)):
            # 投出 1~6 点
            for k in range(6):
                # 新的和对应的概率 += 上一轮概率 * (1/6)
                tmp[j + k] += dp[j] / 6
        dp = tmp
        
    return dp
```

## 相关链接

[[算法与面试-MOC]]
