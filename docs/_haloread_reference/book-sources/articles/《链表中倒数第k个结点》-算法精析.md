---
id: 20260408101212
title: 《链表中倒数第k个结点》-算法精析
created: 2026-04-08 10:12
updated: 2026-04-08 10:12
tags:
  - algorithm/linked_list
  - difficulty/easy
  - leetcode
source: algorithms.md
status: published
ai_generated: true
type: algorithm
leetcode_link: https://leetcode.cn/problems/lian-biao-zhong-dao-shu-di-kge-jie-dian-lcof/
difficulty: Easy
---

关联源素材：[[algorithms.md]]

## 题目信息

**题目信息**：剑指 Offer 22. 链表中倒数第k个节点

*   **原题链接**：[链表中倒数第k个节点](https://leetcode.cn/problems/lian-biao-zhong-dao-shu-di-kge-jie-dian-lcof/)
*   **难度**：Easy
*   **描述**：输入一个链表，输出该链表中倒数第k个节点。

### 🛒 题目 "人话" 翻译

就像跑步。
你要找倒数第 k 名。
但是你不知道一共有多少人跑。

### 🧊 知识点 "破冰" 讲解

**快慢指针 (Fast & Slow Pointers)**。
*   **比喻**：手里拿一根长为 `k` 的棍子。
*   让 `快指针` 先跑 `k` 步。
*   然后 `快指针` 和 `慢指针` 一起跑。
*   当 `快指针` 到达终点时，`慢指针` 刚好在终点往回数 `k` 步的位置（也就是棍子的另一头）。

### 🚗 代码 "带逛"

```python
def last_kth(link, k):
    """
    查找链表中倒数第 k 个节点
    """
    if not link or k <= 0:
        return None
        
    move = link
    # 1. 快指针先走 k-1 步
    while move and k-1 >= 0:
        move = move.next
        k -= 1
    
    # 如果 k 太大，链表没那么长
    if k > 0: # 注意这里根据具体逻辑微调，上面 k-=1 后 k应该为0
        return None
        
    # 2. 快慢指针一起走
    while move:
        move = move.next
        link = link.next
        
    return link.val
```

---

相关笔记：[[算法与面试-MOC]]
