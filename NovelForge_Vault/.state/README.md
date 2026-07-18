# .state 隐藏状态机目录

> **本目录由 `scripts/novelforge/` 脚本维护，禁止用 Edit 工具手动编辑，违反会导致状态不一致。**
> 所有状态更新必须通过 `save_state.py` 走 JSON Delta，由 state_update Skill 统一执行。

---

## 一、目录作用

本目录是 NovelForge 的「运行时状态机」，记录所有动态状态：

- 当前章节在哪个 Skill 阶段（pipeline.json）
- 每个角色的位置/境界/情绪/关系（characters/*.json）
- 上下文预算配置（context_budget.json）
- 金手指强度曲线（power_curve.json）
- 节奏曲线（rhythm_curve.json）
- 章节字数历史（chapter_length_history.json）
- 世界时间线（world_timeline.json）
- 状态更新日志（state_update_log.json）

与 `00_控制面/` `02_角色/` 等 Markdown 文件的区别：
- Markdown 文件 = **静态设定**（人工维护，Skill 只读）
- `.state/*.json` = **动态状态**（脚本维护，每次 state_update 后变化）

---

## 二、文件清单

| 文件 | 作用 | 维护者 |
|---|---|---|
| `pipeline.json` | 当前章节流水线阶段 | state_update |
| `characters/*.json` | 每角色一个状态文件 | state_update |
| `characters_index.md` | 角色索引（save_state.py 自动生成） | state_update |
| `context_budget.json` | 上下文预算配置 | 人工 + 脚本 |
| `power_curve.json` | 金手指强度曲线 | state_update |
| `rhythm_curve.json` | 节奏曲线 | state_update |
| `chapter_length_history.json` | 章节字数历史 | state_update |
| `world_timeline.json` | 世界时间线 | state_update |
| `state_update_log.json` | 状态更新日志 | state_update |
| `_archive/` | 卷末状态快照 | 主 Agent 手动归档 |

---

## 三、更新纪律

1. **禁止 Edit 工具直接编辑本目录下任何 JSON**。
2. 所有更新走 `python scripts/novelforge/save_state.py <delta_file>`。
3. `save_state.py` 会：
   - 校验 delta 格式
   - 应用到目标 JSON
   - 写入 `state_update_log.json`
   - 触发相关校验（如 power_curve 越界告警）
4. 卷末状态归档由主 Agent 用 Edit/Write 手动操作：将当前所有 `.state/*.json` 快照复制到 `_archive/vol_NN_states.json`，作为该卷结束时的状态定版。

---

## 四、违规后果

手动编辑会导致：
- pipeline 状态与实际章节错位，writer 找不到正确上下文
- characters 状态与正文不符，后续章节人物行为不一致
- power_curve 失真，金手指强度告警失效

如发现已手动编辑，立即从最近一次合法 commit 恢复：主 Agent 用 `git checkout HEAD -- NovelForge_Vault/.state/` 还原受影响的 JSON 文件，再重新走 `save_state.py` 提交正确的 delta。
