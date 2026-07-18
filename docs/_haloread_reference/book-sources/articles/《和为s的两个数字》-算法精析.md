---
id: 20260408143800
title: 《和为s的两个数字》-算法精析
created: 2026-04-08 14:38
updated: 2026-04-08 14:38
tags:
  - algorithm/two_pointers
  - difficulty/Easy
  - leetcode
source: algorithms.md
status: published
ai_generated: true
type: algorithm
leetcode_link: https://leetcode.cn/problems/he-wei-sde-liang-ge-shu-zi-lcof/
difficulty: Easy
---

## 题目信息

**题目名称**：和为s的两个数字

**LeetCode链接**：[和为s的两个数字](https://leetcode.cn/problems/he-wei-sde-liang-ge-shu-zi-lcof/)

**难度**：Easy

**描述**：输入一个递增排序的数组和一个数字s，在数组中查找两个数，使得它们的和正好是s。

## 🛒 题目"人话"翻译

**"左右夹击"**。

*   数组是 **排好序** 的。
*   我们要找两个数加起来等于 `s`。
*   如果你选的两个数太大了，那就让大的那个变小点（右指针左移）。
*   如果你选的两个数太小了，那就让小的那个变大点（左指针右移）。

## 🧊 知识点"破冰"讲解

**双指针 (Two Pointers)**。

*   `left` 指向头，`right` 指向尾。
*   `sum = nums[left] + nums[right]`。
*   如果 `sum > target`，说明右边的数太大了，`right--`。
*   如果 `sum < target`，说明左边的数太小了，`left++`。

## 💡 思路"推导"过程

这道题利用了数组已经排好序的特性。如果数组是无序的，我们可以用哈希表来解决，但既然是有序的，双指针法更高效。

**第一阶段：暴力解法**
*   双重循环，遍历所有可能的组合。
*   时间复杂度 O(N²)，太慢了。

**第二阶段：双指针法**
*   利用有序性，从两端向中间夹击。
*   每次都能排除一半的可能性。
*   时间复杂度 O(N)，空间复杂度 O(1)。

## ❓ "为什么"的解释

**Q：为什么双指针法有效？**

**A：** 因为数组是有序的。如果当前和大于目标，说明右边的数太大了，我们需要减小右边的数；如果当前和小于目标，说明左边的数太小了，我们需要增大左边的数。这样每次都能朝着目标靠近，不会错过正确答案。

## 🚗 代码"带逛"

```python
def twoSum(nums, target):
    left, right = 0, len(nums) - 1
    while left < right:
        s = nums[left] + nums[right]
        if s == target:
            return [nums[left], nums[right]]
        elif s > target:
            right -= 1
        else:
            left += 1
    return []
```

## 相关链接

[[算法与面试-MOC]]
