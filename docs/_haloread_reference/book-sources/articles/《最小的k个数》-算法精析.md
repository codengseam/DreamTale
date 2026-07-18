---
id: 20260408120003
title: 《最小的k个数》-算法精析
created: 2026-04-08 12:00
updated: 2026-04-08 12:00
tags:
  - algorithm/heap
  - difficulty/Easy
  - leetcode
source: algorithms.md
status: published
ai_generated: true
type: algorithm
leetcode_link: https://leetcode.cn/problems/zui-xiao-de-kge-shu-lcof/
difficulty: Easy
---

## 题目信息

**题目名称**：最小的k个数

**LeetCode链接**：[最小的k个数](https://leetcode.cn/problems/zui-xiao-de-kge-shu-lcof/)

**难度**：Easy

**描述**：输入整数数组 `arr` ，找出其中最小的 `k` 个数。



## 🧊 知识点"破冰"讲解

**堆 (Heap)**。

*   **方法一：排序**。`sort()` 然后取前 k 个。时间 O(N log N)。太慢。
*   **方法二：大顶堆**。
    *   我们要找 **最小** 的 k 个数，为什么要用 **大顶** 堆？
    *   因为大顶堆可以帮我们维护一个 **"门槛"**。
    *   堆里存 k 个数。堆顶是这 k 个数里 **最大** 的（也就是这群穷人里最有钱的）。
    *   新来一个数，如果比堆顶还大，那肯定不是最小的 k 个之一，滚粗。
    *   如果比堆顶小，说明它比堆里最有钱的那个穷，那它更有资格进入"穷人俱乐部"。把堆顶踢出去，把它加进来。
    *   遍历完，堆里剩下的就是最小的 k 个。
    *   时间 O(N log k)。



## ❓ "为什么"的解释

**Q：为什么要选右上角（或左下角）？左上角不行吗？**

**A：** 问得好！
*   如果你站在 **左上角**（最小值）：
    *   往右走是变大，往下走也是变大。
    *   如果 `Current < Target`，你是该往右还是往下？**不知道啊！** 两个方向都可能藏着目标，这就没法"排除法"了。
*   如果你站在 **右上角**：
    *   往左是变小，往下是变大。
    *   方向是 **互斥** 的，这就给了我们明确的指引。**这就是选它的根本原因！**



## 相关链接

[[算法与面试-MOC]]
