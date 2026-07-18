---
id: 20260408133500
title: 《包含min函数的栈》-算法精析
created: 2026-04-08 13:35
updated: 2026-04-08 13:35
tags:
  - algorithm/stack
  - difficulty/Easy
  - leetcode
source: algorithms.md
status: published
ai_generated: true
type: algorithm
leetcode_link: https://leetcode.cn/problems/min-stack/
difficulty: Easy
---

## 题目信息

**题目名称**：包含min函数的栈

**LeetCode链接**：[Min Stack](https://leetcode.cn/problems/min-stack/)

**难度**：Easy

**描述**：设计一个支持 push ，pop ，top 操作，并能在常数时间内检索到最小元素的栈。



## 🧊 知识点"破冰"讲解

**辅助栈 (Auxiliary Stack)** 思想。

*   **主栈 (stack)**：正常存数据。
*   **最小栈 (min_stack)**：就像一本 **"历史书"**。
    *   每次进新元素 `x` 时，看看 `x` 是不是比当前最小的还小？
    *   如果是，在历史书上记下"新纪录 `x`"。
    *   如果不是，在历史书上重复记下"当前纪录"。（为了和主栈保持高度一致，同进同出）。



## ❓ "为什么"的解释

**Q：为什么辅助栈要重复记录最小值？**

**A：** 
*   为了保持主栈和辅助栈的同步。
*   如果辅助栈只记录"新纪录"，那么当主栈 pop 时，辅助栈可能不需要 pop，就会导致长度不一致。
*   重复记录可以保证两个栈的操作完全同步，简化逻辑。

**Q：时间复杂度是多少？**

**A：** 
*   所有操作（push, pop, top, min）都是 O(1)。
*   空间复杂度是 O(N)，因为需要额外的辅助栈。



## 相关链接

- [[算法与面试-MOC]]
