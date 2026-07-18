# M6 · 伏笔生命周期五阶段升级

> **核心目标**：把 `hooks_registry.json` 的 `status` 从 4 态（planted/hinted/resolved/abandoned）升级为 5 态（planted/progressing/hinted/resolved/archived），新增伏笔回收质量 4 维度评分，章纲生成前主动注入「本章应推进 / 暗示 / 回收的伏笔清单」，让伏笔不再是「埋了就忘」的散点，而是可追踪、可评估、可主动提醒的结构化生命周期对象。
>
> **所属层级**：L2 强化已有能力 · 痛点「伏笔回收质量」补齐
> **依赖**：M2（schema 同步门禁，提供 `FORESHADOW_SCHEMA` 升级的契约层与 `validate_foreshadow` 入口）
> **下游**：M7（active enforcement 可消费 5 态伏笔做章级门禁）、M19（起点神级方法论可引用 5 态伏笔曲线）、M20（自检清单升级汇总本模块检测项）
> **方案原则**：本方案文档详细到「AI 直接读取即可开始优化、验证、修复」的程度，包含目标、痛点对应、涉及文件路径、详细实现步骤、验证命令、回归测试要求、风险点、DoD 清单。

---

## 一、模块目标

### 1.1 一句话目标

将 `hooks_registry.json` 的 `status` 从 4 态升级为 5 态（`planted` → `progressing` → `hinted` → `resolved` → `archived`），新增伏笔回收质量评估（4 维度评分），章纲生成前注入「本章应推进 / 暗示的伏笔清单」，让伏笔全生命周期可追踪、可评估、可主动提醒。

### 1.2 对应的痛点

行业调研发现的三大伏笔类痛点（详见 `00_master_plan.md` §1.3「完全未覆盖的盲区」中「伏笔回收质量」一项）：

| 痛点 | 表现 | 当前覆盖 |
|---|---|---|
| **伏笔丢失** | 第 15 章埋的伏笔到第 40 章仍未回收或重复埋设 | `audit_hooks.py` 4 级分级（critical/warning/healthy/done）已覆盖，但仅提醒"该回收"，不提醒"该推进" |
| **只挖不填** | 作者埋伏笔上瘾，回收率低于 60% | `RECOVERY_HEALTH_LINE = 0.60` 已覆盖告警，但无"推进阶段"过渡态，伏笔长期停在 `planted` 直到超期 |
| **回收质量差** | 伏笔"回收了"但读者觉得烂尾，比未回收更伤体验 | **完全未覆盖**——当前 `status=resolved` 后无质量评估字段，无法区分"惊艳回收"与"敷衍回收" |

### 1.3 完成后达成的能力

- **伏笔全生命周期管理**：5 态状态机覆盖埋设→推进→暗示→回收→归档全过程，每态有明确触发条件与转换规则
- **回收质量分级评估**：4 维度评分（surprise / coherence / payoff / emotional_impact，每维 1-5 分）+ 总分分级（S/A/B/C/D），低质量回收触发预警
- **主动提醒推进**：`audit_hooks.py --due-list --chapter N` 输出"本章应推进 / 暗示 / 回收的伏笔清单"，architect Skill 在章纲生成前强制注入此清单，把伏笔管理从「被动审计」升级为「主动调度」
- **回归测试锁定**：7 个 pytest 用例覆盖 5 态状态机 / 4 维评分 / `--due-list` / 一致性检测升级 / H-001 迁移

---

## 二、痛点对应

### 2.1 痛点表现（数据 / 案例）

**痛点 A · 伏笔丢失 + 重复埋设**：

行业调研发现（见 `00_master_plan.md` §1.2 行业痛点调研报告），长篇 AI 小说普遍存在两类伏笔管理失败模式：

- **丢失模式**：第 15 章埋的伏笔（如「主角眉心的红痣」），到第 40 章仍未回收，且中间无任何提醒；读者早已忘记，作者也忘了，最终成为「断头伏笔」
- **重复埋设模式**：《天命使徒》第 138-157 章中「坚定」一词出现 66 次（行业调研样本数据），作者 / AI 把同一伏笔反复"重新埋设"，既不推进也不回收，读者体验为「剧情原地踏步」

**痛点 B · 只挖不填（回收率低）**：

`audit_hooks.py` 当前的 `RECOVERY_HEALTH_LINE = 0.60` 告警逻辑（file:///workspace/scripts/novelforge/audit_hooks.py 第 83 行）只覆盖了「已回收率低于 60%」这一终态告警，但缺少中间态预警——伏笔在 `planted` 状态停留过久时（如 30 章未推进），系统不会主动提醒"该推进了"，直到 `target_resolve_ch` 超期才触发 critical/warning。

**痛点 C · 回收质量差（本模块的核心增量）**：

`hooks_registry.json` 当前的 `status=resolved` 是一个二值标记——「回收了」或「没回收」。但行业调研表明：

> 伏笔回收了但烂，比未回收更伤读者体验。读者会认为作者在"应付"，对后续伏笔的期待值断崖式下降。

当前 schema（file:///workspace/scripts/novelforge/schema.py 第 176-199 行 `FORESHADOW_SCHEMA`）的 `resolution_note` 字段（第 197 行）是自由文本，无结构化评分，无法量化回收质量，无法在审计报告里聚合"低质量回收率"。

### 2.2 行业方案

| 来源 | 方案 | 局限 |
|---|---|---|
| **Sudowrite**（工业产品） | Plot Pad 伏笔追踪板，标记 planted / hinted / resolved 三态 | 缺"推进"态，无回收质量评分 |
| **NovelCrafter**（工业产品） | Codex 伏笔卡片，关联章节，但不主动提醒推进 | 被动查询型，非主动调度 |
| **CreAgentive Story Prototype KG**（ICLR 2026 投稿） | 把伏笔建模为 KG 节点，状态机含 5 态 | 需要完整 KG 基础设施，NovelForge M17 才引入选择性 KG |
| **Remember Me narrative KG**（ICCC26） | 伏笔节点 + 读者记忆衰减模型，提醒"该刷新读者记忆" | 仅做提醒，不评估回收质量 |

### 2.3 学术方案

- **MemoRAG (WWW 2025)**：线索生成 → 精准召回。本模块借鉴其「主动生成线索清单」思想，落到 `--due-list` 命令输出「本章应推进 / 暗示的伏笔清单」。
- **CreAgentive Story Prototype KG**：伏笔生命周期五阶段建模。本模块直接采纳其五阶段划分，但用 JSON 文件实现，不依赖 KG。
- **Remember Me narrative KG**：读者记忆衰减。本模块借鉴其衰减思想，在 `check_foreshadow_forgetting` 升级版中加入「距上次推进章数」维度（不只是「距上次提醒章数」）。

### 2.4 本模块的差异化设计

| 维度 | 行业方案 | NovelForge M6 |
|---|---|---|
| 状态机 | 三态（planted/hinted/resolved）或五态 | **5 态**（planted/progressing/hinted/resolved/archived），新增 `progressing`（推进态）与 `archived`（归档态，回收后留档供后续章节引用） |
| 回收质量 | 无评估 / 自由文本 note | **4 维度评分**（surprise/coherence/payoff/emotional_impact，每维 1-5 分）+ 总分分级 S/A/B/C/D，D 级触发预警 |
| 主动提醒 | 被动查询 | **`--due-list` 命令**主动输出「本章应推进 / 暗示 / 回收的伏笔清单」，architect Skill 章纲生成前强制注入 |
| 数据载体 | KG / 数据库 | **JSON 文件**（`hooks_registry.json`），保持 NovelForge「文件即真相」核心哲学 |
| 实现路径 | 依赖外部系统 | **纯标准库**（json/os/argparse/re），无新依赖，与 `audit_hooks.py` 现有 945 行无缝衔接 |

---

## 三、涉及现有文件

> 本节列出本模块涉及的全部现有文件，每项标注需修改的具体位置（行号或 section）。**本模块不修改源码**，仅产出方案文档；以下修改将在执行阶段按本方案落地。

### 3.1 核心数据文件

#### `file:///workspace/NovelForge_Vault/04_大纲与脉络/hooks_registry.json`

**现状**：33 行，含 1 条示例伏笔 H-001，13 字段示例（schema 定义 17 字段）。

- 第 4 行：`_comment_status` 注释当前 4 态枚举，需升级为 5 态
- 第 11 行：`version: "1.0.0"`，需升级为 `2.0.0`
- 第 14-31 行：H-001 示例伏笔，需迁移到 5 态 schema + 新增 `quality` 字段

#### `file:///workspace/scripts/novelforge/schema.py`

**现状**：367 行，`FORESHADOW_SCHEMA` 定义在第 176-199 行。

- 第 178 行 `required` 字段：保持 `[hook_id, description, planted_ch, scope, status]`
- 第 185 行 `status` 枚举：`["planted", "hinted", "resolved", "abandoned"]` → 升级为 5 态 `["planted", "progressing", "hinted", "resolved", "archived", "abandoned"]`
- 第 197 行 `resolution_note` 后：新增 `quality` 字段（4 维度评分对象）+ `progress_chapters` 字段（推进章号列表）+ `archived_ch` 字段（归档章号）
- 第 325-335 行 `validate_foreshadow` 函数：`status` 枚举校验需同步升级
- 第 359-367 行 `__all__`：新增 `FORESHADOW_QUALITY_RUBRIC` / `validate_foreshadow_quality` 导出

### 3.2 核心脚本

#### `file:///workspace/scripts/novelforge/audit_hooks.py`

**现状**：945 行，含 4 级分级 + 3 级 scope + REMINDER_INTERVAL。

- 第 56-60 行：`SEVERITY_*` 常量，4 级分级，需新增 `SEVERITY_DUE`（待推进）
- 第 63-67 行：`REMINDER_INTERVAL`，需新增 `PROGRESS_INTERVAL`（推进间隔，短于 reminder）
- 第 157-179 行：`classify_severity` 函数，需支持 `progressing` 态
- 第 182-214 行：`check_forgetting` 函数，需新增「距上次推进章数」检测
- 第 281-376 行：`audit_all` 函数，`by_status` 需扩展为 6 态计数
- 第 476-527 行：`update_hook` 函数，`status` 枚举校验需升级为 5 态 + 状态转换合法性校验
- 第 530-572 行：`add_hook` 函数，需初始化 `progress_chapters` 字段
- 第 781-827 行：`build_arg_parser`，新增 `--due-list` 与 `--quality` 参数
- 第 830-849 行：`cmd_audit`，路由 `--due-list` 与 `--quality` 子命令
- **新增**：`compute_due_list` 函数（输出本章应推进 / 暗示 / 回收的伏笔清单）
- **新增**：`evaluate_resolution_quality` 函数（4 维度评分）

#### `file:///workspace/scripts/novelforge/check_consistency.py`

**现状**：1460 行，`check_foreshadow_forgetting` 函数在第 883-981 行。

- 第 906 行：`if status not in ("planted", "hinted")` → 升级为 `if status not in ("planted", "progressing", "hinted")`
- 第 914-933 行：超期检测逻辑，需新增「`progressing` 态超期」分支
- 第 935-980 行：遗忘预警逻辑，需新增「距上次推进章数」检测（`progress_chapters` 字段）
- 第 157 行 `FORESHADOW_FORGET_THRESHOLD = 20`：新增 `FORESHADOW_PROGRESS_THRESHOLD = 15`（推进阈值，短于遗忘阈值）

### 3.3 Skill 文件

#### `file:///workspace/.trae/skills/hook-auditor/SKILL.md`

**现状**：210 行，5 项职责（全量审计 / 回收建议落地 / 伏笔状态更新 / 新增伏笔 / 章纲一致性检查），4 态 `status`。

- 第 39 行：`status` 枚举说明，需升级为 5 态
- 第 51-129 行：5 项职责，需升级为 6 项（新增「回收质量评估」职责）
- 第 100 行：状态流转描述 `planted → hinted → resolved/abandoned`，需升级为 5 态流转
- 第 196-204 行：反模式列表，需新增「不跳过 progressing 直接 hinted」
- 新增 section：`--due-list` 命令用法 + `--quality` 命令用法

#### `file:///workspace/.trae/skills/architect/SKILL.md`

**现状**：354 行，第四步「若生成章纲，必跑 audit_hooks」在第 90-98 行。

- 第 90-98 行：第四步当前只跑 `audit_hooks --current-ch <N> --json`，需升级为额外跑 `audit_hooks --due-list --chapter <N> --json` 拿到「本章应推进 / 暗示 / 回收的伏笔清单」
- 第 126-130 行：章纲十段模板「五、伏笔操作」段，需新增「推进：H-XXX <如何推进>」子项（当前只有埋设/回收/提醒三类）
- 第 152-158 行：字段约束，需新增「伏笔操作」四类（埋设/推进/回收/提醒）

#### `file:///workspace/.trae/skills/idea-forge/SKILL.md`

**现状**：221 行，第五步「伏笔特殊处理」在第 114-129 行，调 `audit_hooks.py --add`。

- 第 124 行：`--add` 命令的 JSON 示例，需补充 `progress_chapters: []` 字段
- 第 126 行：脚本自动填充字段列表，需新增 `progress_chapters` 与 `archived_ch`

#### `file:///workspace/.trae/skills/writer-polisher/SKILL.md`

**现状**：344 行，第 197-199 行 Delta JSON 示例中含 `hooks/H-017/status` 字段。

- 第 197 行：Delta 示例 `{"op": "set", "path": "hooks/H-017/status", "value": "hinted"}`，需补充 5 态示例
- 第 187 行：伏笔新增 / 提醒 / 回收列表，需新增「推进（progressing）」一项

#### `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md`

**现状**：347 行，第 143-151 行「foreshadow_forgetting」检测解读指南。

- 第 143-151 行：`foreshadow_forgetting` 解读指南，需新增 `progressing` 态的检测说明
- 第 145 行：典型场景「第 3 章埋的 short 伏笔，到第 15 章还没回收」，需补充「progressing 态超期」场景

### 3.4 数据 / 配置文件

#### `file:///workspace/scripts/novelforge/data/foreshadow_quality_rubric.json`（新增）

回收质量评分细则，定义 4 维度 × 5 等级的具体描述，供 `audit_hooks.py --quality` 命令读取。

---

## 四、新增/修改文件清单

| # | 文件路径 | 类型 | 核心改动点 |
|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/schema.py` | 修改 | `FORESHADOW_SCHEMA.status` 枚举升级为 5 态；新增 `quality` / `progress_chapters` / `archived_ch` 字段定义；新增 `FORESHADOW_QUALITY_RUBRIC` 常量；新增 `validate_foreshadow_quality` 函数；`validate_foreshadow` 同步升级 |
| 2 | `file:///workspace/NovelForge_Vault/04_大纲与脉络/hooks_registry.json` | 修改 | `version` 升级为 `2.0.0`；`_comment_status` 升级为 5 态说明；H-001 示例迁移到 5 态 schema（新增 `quality` / `progress_chapters` / `archived_ch` 字段） |
| 3 | `file:///workspace/scripts/novelforge/audit_hooks.py` | 修改 | 5 态状态机实现（`STATUS_TRANSITIONS` 转换矩阵 + `validate_status_transition` 函数）；新增 `compute_due_list` 函数（`--due-list` 命令）；新增 `evaluate_resolution_quality` 函数（`--quality` 命令）；`audit_all` 升级为 6 态计数；`update_hook` 升级为状态转换合法性校验 |
| 4 | `file:///workspace/.trae/skills/hook-auditor/SKILL.md` | 修改 | 5 项职责升级为 6 项（新增「回收质量评估」职责）；`status` 枚举升级为 5 态；新增 `--due-list` / `--quality` 命令用法；反模式新增「不跳过 progressing 直接 hinted」 |
| 5 | `file:///workspace/.trae/skills/architect/SKILL.md` | 修改 | 第四步「必跑 audit_hooks」升级为额外跑 `--due-list`；章纲十段模板「五、伏笔操作」段新增「推进」子项；字段约束「伏笔操作」升级为四类 |
| 6 | `file:///workspace/scripts/novelforge/check_consistency.py` | 修改 | `check_foreshadow_forgetting` 函数升级支持 5 态（`planted/progressing/hinted` 均检测超期与遗忘）；新增 `FORESHADOW_PROGRESS_THRESHOLD = 15`；遗忘预警新增「距上次推进章数」维度 |
| 7 | `file:///workspace/scripts/novelforge/data/foreshadow_quality_rubric.json` | 新增 | 4 维度（surprise/coherence/payoff/emotional_impact）× 5 等级评分细则；总分分级阈值（S ≥ 18 / A ≥ 15 / B ≥ 12 / C ≥ 9 / D < 9） |

**附带修改**（不属核心改动，但需同步）：

| # | 文件 | 改动 |
|---|---|---|
| 8 | `file:///workspace/.trae/skills/idea-forge/SKILL.md` | `--add` 命令示例补 `progress_chapters` 字段 |
| 9 | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | Delta 示例补 5 态 status |
| 10 | `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` | `foreshadow_forgetting` 解读指南补 `progressing` 态 |
| 11 | `file:///workspace/tests/bug_regression_list.md` | 新增 BUG-056 |
| 12 | `file:///workspace/tests/test_foreshadow_five_stage.py` | 新增（7 个用例） |

---

## 五、详细实现步骤

### 5.1 步骤 1 · 设计 5 态状态机

#### 5.1.1 5 态定义

| 状态 | 含义 | 触发条件 |
|---|---|---|
| `planted` | 已埋设，未推进 | `audit_hooks --add` 新增伏笔时的默认状态 |
| `progressing` | 已推进，未暗示 | 章纲安排了「推进」操作（角色调查 / 线索浮现 / 部分揭示，但未到暗示读者的程度） |
| `hinted` | 已暗示，未回收 | 章纲安排了「暗示」操作（角色再次提及 / 道具再次出现，刷新读者记忆） |
| `resolved` | 已回收，未归档 | 章纲安排了「回收」操作（揭秘 / 兑现 / 反转 / 呼应），但 `quality` 评分未填 |
| `archived` | 已归档（含质量评分） | `resolved` 后由 `hook-auditor --quality` 命令填入 4 维度评分，自动转为 `archived` |

> **`abandoned` 仍保留为终态**（伏笔放弃，不进入归档），共 6 个枚举值，但生命周期主路径是 5 态。

#### 5.1.2 状态转换规则

合法转换矩阵（行=当前态，列=目标态，✓=允许，✗=禁止）：

| 当前\目标 | planted | progressing | hinted | resolved | archived | abandoned |
|---|---|---|---|---|---|---|
| **planted** | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| **progressing** | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |
| **hinted** | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |
| **resolved** | ✗ | ✗ | ✗ | ✓ | ✓（填 quality 后自动转） | ✗ |
| **archived** | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **abandoned** | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

**关键规则**：
1. `planted → hinted` 允许（跳过 progressing，但 `hook-auditor` SKILL.md 会标记为「跳过推进」并 warning）
2. `resolved → archived` 必须先填 `quality` 字段（4 维度评分），由 `--quality` 命令自动转换
3. `archived` 与 `abandoned` 均为终态，不可回退
4. `resolved` 不可回退到 `hinted`（回收后不能"取消回收"）

#### 5.1.3 代码片段：状态转换矩阵（待写入 `audit_hooks.py`）

```python
# ============================================================================
# 5 态状态机（M6 新增）
# ============================================================================
FORESHADOW_STATUSES: tuple[str, ...] = (
    "planted", "progressing", "hinted", "resolved", "archived", "abandoned",
)

# 合法状态转换矩阵：STATUS_TRANSITIONS[current] = set(allowed_next)
STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    "planted":     frozenset({"planted", "progressing", "hinted", "resolved", "abandoned"}),
    "progressing": frozenset({"progressing", "hinted", "resolved", "abandoned"}),
    "hinted":      frozenset({"hinted", "resolved", "abandoned"}),
    "resolved":    frozenset({"resolved", "archived"}),
    "archived":    frozenset({"archived"}),
    "abandoned":   frozenset({"abandoned"}),
}

# 推进间隔（章）：短于 reminder 间隔，提醒"该推进了"
PROGRESS_INTERVAL: dict[str, int] = {
    "short": 5,   # 卷内伏笔每 5 章应推进一次
    "long": 15,   # 跨卷伏笔每 15 章应推进一次
    "core": 25,   # 全书级伏笔每 25 章应推进一次
}


def validate_status_transition(current: str, target: str) -> tuple[bool, str]:
    """校验状态转换是否合法。

    Returns:
        (is_valid, message)。is_valid=True 时 message 为空；
        is_valid=False 时 message 含原因。
    """
    if current not in FORESHADOW_STATUSES:
        return False, f"非法当前状态: {current}"
    if target not in FORESHADOW_STATUSES:
        return False, f"非法目标状态: {target}"
    allowed = STATUS_TRANSITIONS.get(current, frozenset())
    if target not in allowed:
        return False, (
            f"非法状态转换: {current} → {target}。"
            f"允许的目标态: {sorted(allowed)}"
        )
    # 跳过 progressing 的 warning（不阻断，仅提示）
    if current == "planted" and target == "hinted":
        return True, "WARNING: 跳过 progressing 阶段直接 hinted，建议补推进场景"
    # resolved → archived 必须先填 quality
    if current == "resolved" and target == "archived":
        return True, ""  # quality 校验由 evaluate_resolution_quality 函数负责
    return True, ""
```

### 5.2 步骤 2 · 设计回收质量 4 维度评分

#### 5.2.1 4 维度定义

| 维度 | 字段名 | 含义 | 1 分 | 5 分 |
|---|---|---|---|---|
| 惊喜度 | `surprise` | 回收时是否超出读者预期 | 完全在意料之中，读者早就猜到 | 完全颠覆读者预期，回头重读前文有「原来如此」感 |
| 一致性 | `coherence` | 回收与前文铺垫是否一致 | 与前文矛盾或强行解释 | 与前文所有铺垫严丝合缝 |
| 兑现度 | `payoff` | 回收是否兑现了埋设时的承诺 | 兑现了一半或敷衍兑现 | 完全兑现且超出承诺（如埋的是"身世"，回收时不仅揭身世还连带解锁能力） |
| 情绪冲击 | `emotional_impact` | 回收时读者的情绪强度 | 无情绪波动 | 强烈情绪（震撼 / 感动 / 反胃 / 燃），且符合 `emotional_valence` 设定 |

#### 5.2.2 总分分级

| 总分（4 维度之和，4-20 分） | 等级 | 含义 | 处置 |
|---|---|---|---|
| 18-20 | S | 惊艳回收 | 无需处置，可作为方法论沉淀案例 |
| 15-17 | A | 优秀回收 | 无需处置 |
| 12-14 | B | 合格回收 | 无需处置 |
| 9-11 | C | 勉强回收 | 警告：建议后续章节补铺垫或追加呼应 |
| < 9 | D | 烂尾回收 | 预警：触发 `audit_hooks` 报告中的「低质量回收率」统计 |

#### 5.2.3 代码片段：评分函数（待写入 `audit_hooks.py`）

```python
# ============================================================================
# 回收质量评估（M6 新增）
# ============================================================================
QUALITY_DIMENSIONS: tuple[str, ...] = (
    "surprise", "coherence", "payoff", "emotional_impact",
)

# 总分分级阈值
QUALITY_GRADE_THRESHOLDS: list[tuple[int, str]] = [
    (18, "S"),
    (15, "A"),
    (12, "B"),
    (9, "C"),
]


def evaluate_resolution_quality(
    hook: dict[str, Any],
    scores: dict[str, int],
    rubric_path: str | None = None,
) -> dict[str, Any]:
    """评估伏笔回收质量，返回 4 维度评分 + 总分 + 等级。

    Args:
        hook: 伏笔 dict（必须 status=resolved）。
        scores: 4 维度评分 dict，如 {"surprise": 4, "coherence": 5, "payoff": 4, "emotional_impact": 3}。
        rubric_path: 评分细则 JSON 路径（可选，用于校验分数范围）。

    Returns:
        {
            "hook_id": ...,
            "quality": {
                "surprise": 4, "coherence": 5, "payoff": 4, "emotional_impact": 3,
                "total": 16, "grade": "A",
            },
            "is_low_quality": False,  # grade == "D" 时为 True
        }

    Raises:
        ValueError: scores 缺维度 / 分数越界 / hook 非 resolved 态。
    """
    if hook.get("status") != "resolved":
        raise ValueError(
            f"伏笔 {hook.get('hook_id')} 当前状态为 {hook.get('status')}，"
            f"仅 resolved 态可评估回收质量"
        )

    # 校验 4 维度齐全
    missing = [d for d in QUALITY_DIMENSIONS if d not in scores]
    if missing:
        raise ValueError(f"scores 缺少维度: {missing}")

    # 校验分数范围 1-5
    for dim in QUALITY_DIMENSIONS:
        score = scores[dim]
        if not isinstance(score, int) or score < 1 or score > 5:
            raise ValueError(
                f"维度 {dim} 分数 {score} 越界，必须为 1-5 的整数"
            )

    total = sum(scores[dim] for dim in QUALITY_DIMENSIONS)
    grade = "D"
    for threshold, g in QUALITY_GRADE_THRESHOLDS:
        if total >= threshold:
            grade = g
            break

    return {
        "hook_id": hook.get("hook_id"),
        "quality": {
            **{dim: scores[dim] for dim in QUALITY_DIMENSIONS},
            "total": total,
            "grade": grade,
        },
        "is_low_quality": grade == "D",
    }
```

### 5.3 步骤 3 · `hooks_registry.json` 升级后完整字段清单

升级后 `FORESHADOW_SCHEMA` 含 20 个字段（原 17 + 新增 3）：

| # | 字段 | 类型 | 必填 | 说明 | 升级备注 |
|---|---|---|---|---|---|
| 1 | `hook_id` | string | ✅ | `H-\d{1,4}` 格式 | 不变 |
| 2 | `description` | string | ✅ | 伏笔描述 | 不变 |
| 3 | `planted_ch` | integer | ✅ | 埋设章号 | 不变 |
| 4 | `planted_scene` | string | | 对应关键场景文件名 | 不变 |
| 5 | `scope` | string enum | ✅ | `short` / `long` / `core` | 不变 |
| 6 | `status` | string enum | ✅ | **5 态 + abandoned**：`planted` / `progressing` / `hinted` / `resolved` / `archived` / `abandoned` | **升级**（原 4 态） |
| 7 | `target_resolve_ch` | integer | | 计划回收章号 | 不变 |
| 8 | `expected_resolve_vol` | integer | | 预计回收卷 | 不变 |
| 9 | `related_characters` | array | | 涉及角色列表 | 不变 |
| 10 | `priority` | string enum | | `high` / `medium` / `low`，默认 `medium` | 不变 |
| 11 | `strength` | string enum | | `strong` / `weak`，默认 `weak` | 不变 |
| 12 | `payoff_type` | string enum | | `reveal` / `reverse` / `callback` / `payoff` | 不变 |
| 13 | `emotional_valence` | string enum | | `positive` / `negative` / `twist` | 不变 |
| 14 | `reminder_chapters` | array | | 所有提示过的章号 | 不变 |
| 15 | `last_reminder_ch` | integer / null | | 上次提示章号 | 不变 |
| 16 | `next_reminder_due_ch` | integer | | 下次该提示章号 | 不变 |
| 17 | `dependencies` | array | | 依赖的其他 hook_id | 不变 |
| 18 | `resolution_note` | string | | 回收说明 | 不变 |
| 19 | `progress_chapters` | array | | **所有推进过的章号** | **新增** |
| 20 | `last_progress_ch` | integer / null | | **上次推进章号** | **新增** |
| 21 | `archived_ch` | integer / null | | **归档章号**（填 quality 时自动记录） | **新增** |
| 22 | `quality` | object / null | | **4 维度评分**：`{surprise, coherence, payoff, emotional_impact, total, grade}` | **新增** |

> 共 22 个字段（含 `last_progress_ch` 派生字段），满足「15+ 字段」要求。

### 5.4 步骤 4 · H-001 升级后完整示例 JSON

```json
{
  "hook_id": "H-001",
  "description": "示例伏笔：主角眉心的红痣在觉醒金手指时隐隐发烫，暗示其与某位上古大能的关联",
  "planted_ch": 1,
  "planted_scene": "vol_01/ch_001_主角_红痣.md",
  "scope": "core",
  "status": "archived",
  "target_resolve_ch": 10,
  "expected_resolve_vol": 1,
  "related_characters": ["主角"],
  "priority": "high",
  "strength": "strong",
  "payoff_type": "reveal",
  "emotional_valence": "positive",
  "reminder_chapters": [3, 7],
  "last_reminder_ch": 7,
  "next_reminder_due_ch": 57,
  "dependencies": [],
  "resolution_note": "第 10 章揭示红痣是上古大能传承印记，主角觉醒血脉传承",
  "progress_chapters": [3, 5, 7],
  "last_progress_ch": 7,
  "archived_ch": 11,
  "quality": {
    "surprise": 4,
    "coherence": 5,
    "payoff": 4,
    "emotional_impact": 5,
    "total": 18,
    "grade": "S"
  }
}
```

### 5.5 步骤 5 · `audit_hooks.py` 5 态状态机实现代码片段

#### 5.5.1 修改 `update_hook` 函数（file:///workspace/scripts/novelforge/audit_hooks.py 第 476-527 行）

```python
def update_hook(
    hooks: list[dict[str, Any]],
    hook_id: str,
    status: str | None = None,
    reminder_ch: int | None = None,
    progress_ch: int | None = None,       # M6 新增：推进章号
    quality_scores: dict[str, int] | None = None,  # M6 新增：回收质量评分
) -> tuple[bool, str, dict[str, Any] | None]:
    """更新指定伏笔的 status / reminder_ch / progress_ch / quality。

    M6 升级：
    - status 升级为 5 态 + abandoned（共 6 枚举）
    - 新增状态转换合法性校验（validate_status_transition）
    - 新增 progress_ch 参数（推进章号，更新 progress_chapters / last_progress_ch）
    - 新增 quality_scores 参数（4 维度评分，触发 resolved → archived 自动转换）
    """
    if status is None and reminder_ch is None and progress_ch is None and quality_scores is None:
        return False, "未提供 --status / --reminder-ch / --progress-ch / --quality，无更新内容", None

    target: dict[str, Any] | None = None
    for h in hooks:
        if h.get("hook_id") == hook_id:
            target = h
            break
    if target is None:
        return False, f"伏笔 {hook_id} 不存在", None

    # === M6 新增：状态转换合法性校验 ===
    if status is not None:
        if status not in FORESHADOW_STATUSES:
            return False, f"非法 status: {status}，合法值: {FORESHADOW_STATUSES}", None
        current_status = target.get("status", "planted")
        is_valid, msg = validate_status_transition(current_status, status)
        if not is_valid:
            return False, msg, None
        # resolved → archived 必须先填 quality（由 quality_scores 参数触发）
        if current_status == "resolved" and status == "archived" and quality_scores is None:
            return False, (
                f"{hook_id} 从 resolved 转 archived 必须提供 --quality 参数"
                f"（4 维度评分：surprise/coherence/payoff/emotional_impact）"
            ), None
        target["status"] = status
        if status == "archived":
            # 归档时自动记录归档章号（用 progress_ch 或 reminder_ch 推断当前章号）
            archive_ch = progress_ch or reminder_ch or target.get("last_reminder_ch")
            if isinstance(archive_ch, int):
                target["archived_ch"] = archive_ch
        if msg.startswith("WARNING"):
            print(f"[WARNING] {hook_id}: {msg}", file=sys.stderr)

    # === M6 新增：推进章号更新 ===
    if progress_ch is not None:
        progress_list = target.get("progress_chapters")
        if not isinstance(progress_list, list):
            progress_list = []
            target["progress_chapters"] = progress_list
        if progress_ch not in progress_list:
            progress_list.append(progress_ch)
            progress_list.sort()
        target["last_progress_ch"] = progress_ch
        # 推进后自动从 planted → progressing（若当前是 planted）
        if target.get("status") == "planted":
            target["status"] = "progressing"

    # === reminder_ch 更新（原逻辑保留）===
    if reminder_ch is not None:
        target["last_reminder_ch"] = reminder_ch
        reminders = target.get("reminder_chapters")
        if not isinstance(reminders, list):
            reminders = []
            target["reminder_chapters"] = reminders
        if reminder_ch not in reminders:
            reminders.append(reminder_ch)
            reminders.sort()
        scope = target.get("scope", "short")
        target["next_reminder_due_ch"] = compute_next_reminder_due(reminder_ch, scope)
        # 提醒后若 status 仍是 planted/progressing，自动转 hinted
        if target.get("status") in ("planted", "progressing"):
            target["status"] = "hinted"

    # === M6 新增：回收质量评分 ===
    if quality_scores is not None:
        quality_result = evaluate_resolution_quality(target, quality_scores)
        target["quality"] = quality_result["quality"]
        # 若当前是 resolved 且提供了 quality，自动转 archived
        if target.get("status") == "resolved":
            target["status"] = "archived"
            archive_ch = progress_ch or reminder_ch or target.get("last_reminder_ch")
            if isinstance(archive_ch, int):
                target["archived_ch"] = archive_ch

    # 校验更新后的伏笔
    errors = validate_foreshadow(target)
    if errors:
        return False, f"校验失败: {'; '.join(errors)}", None

    return True, f"已更新 {hook_id}", target
```

#### 5.5.2 修改 `add_hook` 函数（file:///workspace/scripts/novelforge/audit_hooks.py 第 530-572 行）

在自动填充默认值段（第 551-558 行）新增 3 个字段：

```python
    # 自动填充默认值（M6 升级）
    hook_data.setdefault("status", "planted")
    hook_data.setdefault("priority", "medium")
    hook_data.setdefault("strength", "weak")
    hook_data.setdefault("reminder_chapters", [])
    hook_data.setdefault("last_reminder_ch", None)
    hook_data.setdefault("dependencies", [])
    hook_data.setdefault("related_characters", [])
    hook_data.setdefault("resolution_note", "")
    # M6 新增字段
    hook_data.setdefault("progress_chapters", [])
    hook_data.setdefault("last_progress_ch", None)
    hook_data.setdefault("archived_ch", None)
    hook_data.setdefault("quality", None)
```

### 5.6 步骤 6 · `audit_hooks.py` 回收质量评估函数代码片段

#### 5.6.1 修改 `audit_all` 函数（file:///workspace/scripts/novelforge/audit_hooks.py 第 281-376 行）

`by_status` 字典扩展为 6 态计数，新增 `quality_stats` 统计：

```python
def audit_all(hooks: list[dict[str, Any]], current_ch: int) -> dict[str, Any]:
    """对伏笔列表做全量审计，返回结构化报告（M6 升级为 5 态 + 质量统计）。"""
    hooks_by_id: dict[str, dict[str, Any]] = {
        h.get("hook_id", ""): h for h in hooks if h.get("hook_id")
    }

    # M6 升级：6 态计数
    by_status: dict[str, int] = {
        "planted": 0, "progressing": 0, "hinted": 0,
        "resolved": 0, "archived": 0, "abandoned": 0,
    }
    overdue: list[dict[str, Any]] = []
    forgetting_warning: list[dict[str, Any]] = []
    recovery_suggestions: list[dict[str, Any]] = []
    classified: list[dict[str, Any]] = []
    # M6 新增：低质量回收列表
    low_quality_list: list[dict[str, Any]] = []
    # M6 新增：质量统计
    quality_stats: dict[str, Any] = {
        "graded_count": 0,        # 已评分伏笔数
        "grade_distribution": {"S": 0, "A": 0, "B": 0, "C": 0, "D": 0},
        "low_quality_count": 0,   # D 级数量
        "low_quality_rate": 0.0,  # D 级占比
    }

    for hook in hooks:
        status = hook.get("status", "planted")
        if status in by_status:
            by_status[status] += 1

        severity = classify_severity(hook, current_ch)
        classified.append({
            "hook_id": hook.get("hook_id"),
            "description": hook.get("description", ""),
            "scope": hook.get("scope", "short"),
            "status": status,
            "severity": severity,
            "target_resolve_ch": hook.get("target_resolve_ch"),
            "planted_ch": hook.get("planted_ch"),
            "last_progress_ch": hook.get("last_progress_ch"),  # M6 新增
        })

        if severity in (SEVERITY_CRITICAL, SEVERITY_WARNING):
            target_ch = hook.get("target_resolve_ch")
            overdue.append({
                "hook_id": hook.get("hook_id"),
                "severity": severity,
                "scope": hook.get("scope"),
                "description": hook.get("description", ""),
                "planted_ch": hook.get("planted_ch"),
                "target_resolve_ch": target_ch,
                "overdue_by": (
                    current_ch - target_ch if isinstance(target_ch, int) else 0
                ),
                "priority": hook.get("priority", "medium"),
                "strength": hook.get("strength", "weak"),
                "current_status": status,  # M6 新增
            })
            recovery_suggestions.append(
                build_recovery_suggestion(hook, current_ch, severity, hooks_by_id)
            )

        # M6 新增：质量统计
        quality = hook.get("quality")
        if isinstance(quality, dict) and "grade" in quality:
            quality_stats["graded_count"] += 1
            grade = quality["grade"]
            if grade in quality_stats["grade_distribution"]:
                quality_stats["grade_distribution"][grade] += 1
            if grade == "D":
                quality_stats["low_quality_count"] += 1
                low_quality_list.append({
                    "hook_id": hook.get("hook_id"),
                    "description": hook.get("description", ""),
                    "quality": quality,
                    "suggestion": "D 级回收，建议后续章节补铺垫或追加呼应",
                })

        # 读者遗忘预警（planted/progressing/hinted 才检查）
        warn = check_forgetting(hook, current_ch)
        if warn is not None:
            forgetting_warning.append(warn)

    # ...（排序与统计逻辑保留）

    total = len(hooks)
    archived = by_status["archived"]
    resolved = by_status["resolved"]
    recovery_rate = ((archived + resolved) / total) if total > 0 else 0.0
    # M6 新增：低质量回收率
    quality_stats["low_quality_rate"] = (
        quality_stats["low_quality_count"] / quality_stats["graded_count"]
        if quality_stats["graded_count"] > 0 else 0.0
    )

    return {
        "current_ch": current_ch,
        "total": total,
        "by_status": by_status,
        "recovery_rate": round(recovery_rate, 4),
        "overdue": overdue,
        "forgetting_warning": forgetting_warning,
        "recovery_suggestions": recovery_suggestions,
        "classified": classified,
        # M6 新增
        "quality_stats": quality_stats,
        "low_quality_list": low_quality_list,
        "stats": {
            "total": total,
            "planted": by_status["planted"],
            "progressing": by_status["progressing"],   # M6 新增
            "hinted": by_status["hinted"],
            "resolved": resolved,
            "archived": archived,                       # M6 新增
            "abandoned": by_status["abandoned"],
            "in_progress": by_status["planted"] + by_status["progressing"] + by_status["hinted"],
            "overdue_count": len(overdue),
            "critical_count": sum(1 for o in overdue if o["severity"] == SEVERITY_CRITICAL),
            "warning_count": sum(1 for o in overdue if o["severity"] == SEVERITY_WARNING),
            "forgetting_count": len(forgetting_warning),
            "recovery_rate": round(recovery_rate, 4),
            "health_line": RECOVERY_HEALTH_LINE,
            "below_health_line": recovery_rate < RECOVERY_HEALTH_LINE,
            # M6 新增
            "graded_count": quality_stats["graded_count"],
            "low_quality_count": quality_stats["low_quality_count"],
            "low_quality_rate": round(quality_stats["low_quality_rate"], 4),
            "low_quality_health_line": LOW_QUALITY_HEALTH_LINE,
            "below_low_quality_line": quality_stats["low_quality_rate"] > LOW_QUALITY_HEALTH_LINE,
        },
    }
```

新增常量（与 `RECOVERY_HEALTH_LINE` 并列）：

```python
# 健康线：低质量回收率高于此值给出告警（D 级占比 > 20% 即告警）
LOW_QUALITY_HEALTH_LINE: float = 0.20
```

### 5.7 步骤 7 · `audit_hooks.py` 新增 `--due-list` 命令

#### 5.7.1 新增 `compute_due_list` 函数

在 `audit_all` 函数之后新增：

```python
# ============================================================================
# 本章应推进/暗示/回收的伏笔清单（M6 新增）
# ============================================================================
def compute_due_list(
    hooks: list[dict[str, Any]],
    current_ch: int,
) -> dict[str, Any]:
    """计算本章应推进 / 暗示 / 回收的伏笔清单。

    Returns:
        {
            "current_ch": N,
            "due_progress": [...],   # 本章应推进的伏笔（planted 态且距上次推进超 PROGRESS_INTERVAL）
            "due_hint": [...],       # 本章应暗示的伏笔（progressing/hinted 态且距上次提醒超 REMINDER_INTERVAL）
            "due_resolve": [...],    # 本章应回收的伏笔（target_resolve_ch <= current_ch 且未 resolved）
            "due_archive": [...],    # 本章应归档的伏笔（resolved 态但 quality 未填）
            "stats": {...},
        }
    """
    due_progress: list[dict[str, Any]] = []
    due_hint: list[dict[str, Any]] = []
    due_resolve: list[dict[str, Any]] = []
    due_archive: list[dict[str, Any]] = []

    for hook in hooks:
        status = hook.get("status", "planted")
        scope = hook.get("scope", "short")
        hook_id = hook.get("hook_id")
        desc = hook.get("description", "")

        # === 应推进：planted 态且距上次推进超 PROGRESS_INTERVAL ===
        if status == "planted":
            last_progress = hook.get("last_progress_ch")
            base = last_progress if isinstance(last_progress, int) else hook.get("planted_ch", current_ch)
            interval = PROGRESS_INTERVAL.get(scope, PROGRESS_INTERVAL["short"])
            if current_ch - base >= interval:
                due_progress.append({
                    "hook_id": hook_id,
                    "description": desc,
                    "scope": scope,
                    "status": status,
                    "planted_ch": hook.get("planted_ch"),
                    "last_progress_ch": last_progress,
                    "interval_due": current_ch - base - interval,
                    "suggestion": f"在 ch_{current_ch:03d} 安排推进场景（角色调查/线索浮现/部分揭示）",
                })

        # === 应暗示：progressing/hinted 态且距上次提醒超 REMINDER_INTERVAL ===
        elif status in ("progressing", "hinted"):
            last_reminder = hook.get("last_reminder_ch")
            base = last_reminder if isinstance(last_reminder, int) else hook.get("planted_ch", current_ch)
            interval = REMINDER_INTERVAL.get(scope, REMINDER_INTERVAL["short"])
            if current_ch - base >= interval:
                due_hint.append({
                    "hook_id": hook_id,
                    "description": desc,
                    "scope": scope,
                    "status": status,
                    "planted_ch": hook.get("planted_ch"),
                    "last_reminder_ch": last_reminder,
                    "interval_due": current_ch - base - interval,
                    "suggestion": f"在 ch_{current_ch:03d} 安排暗示场景（角色再次提及/道具再次出现）",
                })

        # === 应回收：target_resolve_ch <= current_ch 且未 resolved/archived ===
        target = hook.get("target_resolve_ch")
        if (status in ("planted", "progressing", "hinted")
                and isinstance(target, int) and current_ch >= target):
            due_resolve.append({
                "hook_id": hook_id,
                "description": desc,
                "scope": scope,
                "status": status,
                "planted_ch": hook.get("planted_ch"),
                "target_resolve_ch": target,
                "overdue_by": current_ch - target,
                "payoff_type": hook.get("payoff_type"),
                "priority": hook.get("priority", "medium"),
                "strength": hook.get("strength", "weak"),
                "suggestion": f"在 ch_{current_ch:03d} 安排回收场景（{hook.get('payoff_type', 'reveal')}）",
            })

        # === 应归档：resolved 态但 quality 未填 ===
        elif status == "resolved" and not hook.get("quality"):
            due_archive.append({
                "hook_id": hook_id,
                "description": desc,
                "resolved_at_ch": hook.get("last_reminder_ch"),
                "suggestion": (
                    f"伏笔 {hook_id} 已 resolved 但未评估回收质量，"
                    f"请调用 audit_hooks --update {hook_id} --quality "
                    f"'{{\"surprise\":N,\"coherence\":N,\"payoff\":N,\"emotional_impact\":N}}' "
                    f"完成归档"
                ),
            })

    return {
        "current_ch": current_ch,
        "due_progress": due_progress,
        "due_hint": due_hint,
        "due_resolve": due_resolve,
        "due_archive": due_archive,
        "stats": {
            "due_progress_count": len(due_progress),
            "due_hint_count": len(due_hint),
            "due_resolve_count": len(due_resolve),
            "due_archive_count": len(due_archive),
            "total_due": len(due_progress) + len(due_hint) + len(due_resolve) + len(due_archive),
        },
    }


def format_due_list(report: dict[str, Any]) -> str:
    """格式化 due-list 报告（人类可读）。"""
    ch = report["current_ch"]
    lines = [
        f"=== 本章伏笔待办清单（ch_{ch:03d}）===",
        f"应推进: {report['stats']['due_progress_count']} | "
        f"应暗示: {report['stats']['due_hint_count']} | "
        f"应回收: {report['stats']['due_resolve_count']} | "
        f"应归档: {report['stats']['due_archive_count']}",
        "",
    ]

    if report["due_resolve"]:
        lines.append("--- 🔴 应回收（超期伏笔，强制本章安排）---")
        for item in report["due_resolve"]:
            lines.append(
                f"  {item['hook_id']} [{item['scope']}/{item['status']}] "
                f"\"{item['description']}\""
            )
            lines.append(
                f"    埋于 ch{item['planted_ch']}, 计划 ch{item['target_resolve_ch']} 回收, "
                f"超期 {item['overdue_by']} 章"
            )
            lines.append(f"    建议: {item['suggestion']}")
        lines.append("")

    if report["due_progress"]:
        lines.append("--- 🟠 应推进（planted 态停留过久）---")
        for item in report["due_progress"]:
            lines.append(
                f"  {item['hook_id']} [{item['scope']}] \"{item['description']}\""
            )
            lines.append(f"    建议: {item['suggestion']}")
        lines.append("")

    if report["due_hint"]:
        lines.append("--- 🟡 应暗示（读者可能遗忘）---")
        for item in report["due_hint"]:
            lines.append(
                f"  {item['hook_id']} [{item['scope']}/{item['status']}] "
                f"\"{item['description']}\""
            )
            lines.append(f"    建议: {item['suggestion']}")
        lines.append("")

    if report["due_archive"]:
        lines.append("--- ⚪ 应归档（resolved 但未评估质量）---")
        for item in report["due_archive"]:
            lines.append(f"  {item['hook_id']} \"{item['description']}\"")
            lines.append(f"    建议: {item['suggestion']}")
        lines.append("")

    return "\n".join(lines)
```

#### 5.7.2 修改 `build_arg_parser` 新增 `--due-list` 与 `--quality` 参数

在 file:///workspace/scripts/novelforge/audit_hooks.py 第 781-827 行 `build_arg_parser` 函数中新增：

```python
    # M6 新增参数
    parser.add_argument(
        "--due-list", action="store_true",
        help="输出本章应推进/暗示/回收的伏笔清单（章纲生成前必跑）",
    )
    parser.add_argument(
        "--chapter", type=int, default=None,
        help="目标章号（与 --due-list 配合，等同 --current-ch）",
    )
    parser.add_argument(
        "--quality", metavar="JSON", default=None,
        help='回收质量评分，JSON 字符串，如 \'{"surprise":4,"coherence":5,"payoff":4,"emotional_impact":3}\'',
    )
    parser.add_argument(
        "--progress-ch", type=int, default=None,
        help="推进章号（与 --update 配合，更新 progress_chapters）",
    )
```

#### 5.7.3 修改 `--status` 参数的 choices 升级为 5 态

```python
    parser.add_argument(
        "--status",
        choices=["planted", "progressing", "hinted", "resolved", "archived", "abandoned"],
        default=None, help="新状态（与 --update 配合，M6 升级为 5 态 + abandoned）",
    )
```

#### 5.7.4 新增 `cmd_due_list` 与 `cmd_quality` 子命令路由

在 `main` 函数（第 924-941 行）中新增路由：

```python
def cmd_due_list(args: argparse.Namespace) -> int:
    """输出本章应推进/暗示/回收的伏笔清单。"""
    chapter = args.chapter or args.current_ch
    if chapter is None:
        print("错误：--due-list 需配合 --chapter <N> 或 --current-ch <N>", file=sys.stderr)
        return 2
    registry = load_hooks(args.vault)
    report = compute_due_list(registry.get("hooks", []), chapter)
    if args.as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_due_list(report))
    return 0


def cmd_quality(args: argparse.Namespace) -> int:
    """对已 resolved 的伏笔评估回收质量，自动转 archived。"""
    try:
        scores = json.loads(args.quality)
    except json.JSONDecodeError as e:
        print(f"❌ --quality JSON 解析失败: {e}", file=sys.stderr)
        return 1
    registry = load_hooks(args.vault)
    hooks = registry.get("hooks", [])
    ok, msg, updated = update_hook(
        hooks, args.update,
        status="archived",      # 自动转 archived
        quality_scores=scores,
        progress_ch=args.progress_ch or args.reminder_ch,
    )
    if not ok:
        print(f"❌ {msg}", file=sys.stderr)
        return 1
    save_hooks(args.vault, registry)
    print(f"✅ {msg}")
    if updated is not None:
        print(json.dumps(updated, ensure_ascii=False, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    # M6 新增路由
    if args.due_list:
        return cmd_due_list(args)
    if args.quality is not None and args.update is not None:
        return cmd_quality(args)

    # 原路由保留
    if args.update is not None:
        return cmd_update(args)
    if args.add is not None:
        return cmd_add(args)
    if args.check_outline is not None:
        return cmd_check_outline(args)
    return cmd_audit(args)
```

### 5.8 步骤 8 · `architect` SKILL.md 章纲生成前注入伏笔清单

#### 5.8.1 修改第四步（file:///workspace/.trae/skills/architect/SKILL.md 第 90-98 行）

将原第四步替换为：

```markdown
## 第四步：若生成章纲，必跑 audit_hooks（双命令）

生成章纲前必须执行**两个**命令：

```bash
# 命令 1：全量审计（拿超期伏笔清单）
python -m scripts.novelforge.audit_hooks --current-ch <N> --json

# 命令 2：本章待办清单（M6 新增，拿应推进/暗示/回收的伏笔清单）
python -m scripts.novelforge.audit_hooks --due-list --chapter <N> --json
```

读取命令 2 输出的 `due_progress` / `due_hint` / `due_resolve` / `due_archive` 字段，在本章纲的「五、伏笔操作」段落**强制安排**：

- `due_resolve` 中的伏笔 → 本章纲「五、伏笔操作·回收」段必须列明回收方案（🔴 强制）
- `due_progress` 中的伏笔 → 本章纲「五、伏笔操作·推进」段必须列明推进方案（🟠 强制）
- `due_hint` 中的伏笔 → 本章纲「五、伏笔操作·提醒」段必须列明暗示方案（🟡 强制）
- `due_archive` 中的伏笔 → 反馈中提醒作者用 `audit_hooks --update H-XXX --quality '{...}'` 完成归档

**禁止跳过此步直接写章纲**——否则会埋下超期伏笔烂尾，或 planted 态伏笔长期不推进。

若 `due_resolve` 非空但本章纲确实无法安排回收（如本章是过渡章），必须在章纲「十、必须遵守」段标注 `H-XXX 超期未回收，本章提醒，建议 ch_NNN+K 回收`，并在反馈中告警。
```

#### 5.8.2 修改章纲十段模板「五、伏笔操作」段（第 126-130 行）

将原模板替换为：

```markdown
## 五、伏笔操作
- 埋设：H-XXX <描述>（章纲生成时若埋新伏笔，需调 audit_hooks --add 登记）
- 推进：H-XXX <如何推进>（M6 新增：planted → progressing）
- 回收：H-XXX <如何回收>（resolved 后需调 audit_hooks --quality 评估质量转 archived）
- 提醒：H-XXX <如何提及>（progressing/hinted → hinted）

> 本章若来自 `--due-list` 输出的 `due_progress` / `due_hint` / `due_resolve`，对应伏笔必须在此段列明，不得省略。
```

#### 5.8.3 修改字段约束（第 152-158 行）

在字段约束中新增：

```markdown
- `伏笔操作` 四类都要列，无则写 `（无）`，不能省段落。M6 升级为四类：埋设/推进/回收/提醒。
```

### 5.9 步骤 9 · `check_consistency.py` foreshadow_forgetting 检测升级

#### 5.9.1 新增 `FORESHADOW_PROGRESS_THRESHOLD` 常量

在 file:///workspace/scripts/novelforge/check_consistency.py 第 157 行 `FORESHADOW_FORGET_THRESHOLD = 20` 之后新增：

```python
# --- 伏笔推进阈值（M6 新增）---
# 距上次推进超过此章数 → 警告"伏笔停滞，该推进了"
FORESHADOW_PROGRESS_THRESHOLD: int = 15
```

#### 5.9.2 修改 `check_foreshadow_forgetting` 函数（第 883-981 行）

完整升级版：

```python
def check_foreshadow_forgetting(
    body: str,
    states: dict[str, dict[str, Any]],
    hooks: list[dict[str, Any]],
    current_ch: int,
) -> tuple[list[Issue], str | None]:
    """检测伏笔遗忘（M6 升级为 5 态 + 推进停滞检测）。

    规则：
    - 对 status in (planted, progressing, hinted) 的伏笔：
      - 若 ``target_resolve_ch < current_ch`` → P1「超期未回收」。
      - 若 ``last_reminder_ch`` 距 ``current_ch`` > 20 章 → P1「读者可能遗忘」。
      - 若 ``last_reminder_ch`` 为 null 且 ``current_ch - planted_ch > 20`` → P1。
    - M6 新增：
      - 对 status=planted 的伏笔，若 ``last_progress_ch`` 距 ``current_ch`` >
        ``FORESHADOW_PROGRESS_THRESHOLD`` → P1「伏笔停滞」。
      - 对 status=planted 且无 ``progress_chapters`` 的伏笔，若
        ``current_ch - planted_ch > FORESHADOW_PROGRESS_THRESHOLD`` → P1。
    - hooks 为空（模板）→ 跳过。
    """
    if not hooks:
        return [], "伏笔表为空（模板状态），跳过伏笔遗忘检测"

    issues: list[Issue] = []
    for hook in hooks:
        if not isinstance(hook, dict):
            continue
        status = hook.get("status")
        # M6 升级：5 态中 planted/progressing/hinted 均检测
        if status not in ("planted", "progressing", "hinted"):
            continue
        hook_id = hook.get("hook_id") or "?"
        desc = hook.get("description") or ""
        planted_ch = hook.get("planted_ch")
        target = hook.get("target_resolve_ch")
        last_reminder = hook.get("last_reminder_ch")
        last_progress = hook.get("last_progress_ch")  # M6 新增

        # 超期未回收
        if isinstance(target, int) and current_ch > target:
            detail = (
                f"{hook_id} \"{desc}\" 埋于 ch{planted_ch}, "
                f"计划 ch{target} 回收, 当前 ch{current_ch} 已超期 {current_ch - target} 章"
                f"（当前态: {status}）"
            )
            issues.append(Issue(
                severity="P1",
                type="foreshadow_forgetting",
                detail=detail,
                suggestion="本章安排回收（揭秘/兑现/呼应），或更新 target_resolve_ch。",
                extras={
                    "hook_id": hook_id,
                    "planted_ch": planted_ch,
                    "target_resolve_ch": target,
                    "current_ch": current_ch,
                    "current_status": status,  # M6 新增
                    "sub_type": "overdue",
                },
            ))
            continue  # 已报超期，不再叠加遗忘预警

        # M6 新增：伏笔停滞检测（仅 planted 态）
        if status == "planted":
            if isinstance(last_progress, int):
                progress_gap = current_ch - last_progress
            elif isinstance(planted_ch, int):
                progress_gap = current_ch - planted_ch
            else:
                progress_gap = 0

            if progress_gap > FORESHADOW_PROGRESS_THRESHOLD:
                detail = (
                    f"{hook_id} \"{desc}\" 埋于 ch{planted_ch}, "
                    f"当前 ch{current_ch}, last_progress_ch={last_progress}\n"
                    f"   距上次推进: {progress_gap} 章，伏笔停滞，该推进了"
                )
                issues.append(Issue(
                    severity="P1",
                    type="foreshadow_forgetting",
                    detail=detail,
                    suggestion=(
                        "在本章安排推进场景（角色调查/线索浮现/部分揭示），"
                        "用 audit_hooks --update H-XXX --status progressing --progress-ch N 更新。"
                    ),
                    extras={
                        "hook_id": hook_id,
                        "planted_ch": planted_ch,
                        "last_progress_ch": last_progress,
                        "current_ch": current_ch,
                        "gap": progress_gap,
                        "current_status": status,
                        "sub_type": "stalled",  # M6 新增子类型
                    },
                ))
                continue  # 已报停滞，不再叠加遗忘预警

        # 读者遗忘预警（progressing/hinted 态）
        if isinstance(last_reminder, int):
            gap = current_ch - last_reminder
            if gap > FORESHADOW_FORGET_THRESHOLD:
                detail = (
                    f"{hook_id} \"{desc}\" 埋于 ch{planted_ch}, "
                    f"当前 ch{current_ch}, last_reminder_ch={last_reminder}\n"
                    f"   距上次提醒: {gap} 章，读者可能遗忘（当前态: {status}）"
                )
                issues.append(Issue(
                    severity="P1",
                    type="foreshadow_forgetting",
                    detail=detail,
                    suggestion="在本章安排角色再次提及此伏笔（不揭），刷新读者记忆。",
                    extras={
                        "hook_id": hook_id,
                        "planted_ch": planted_ch,
                        "last_reminder_ch": last_reminder,
                        "current_ch": current_ch,
                        "gap": gap,
                        "current_status": status,
                        "sub_type": "forgetting",
                    },
                ))
        elif isinstance(planted_ch, int):
            gap = current_ch - planted_ch
            if gap > FORESHADOW_FORGET_THRESHOLD:
                detail = (
                    f"{hook_id} \"{desc}\" 埋于 ch{planted_ch}, "
                    f"当前 ch{current_ch}, last_reminder_ch=null\n"
                    f"   自埋设以来 {gap} 章未提醒，读者可能遗忘（当前态: {status}）"
                )
                issues.append(Issue(
                    severity="P1",
                    type="foreshadow_forgetting",
                    detail=detail,
                    suggestion="在本章安排角色再次提及此伏笔（不揭），刷新读者记忆。",
                    extras={
                        "hook_id": hook_id,
                        "planted_ch": planted_ch,
                        "last_reminder_ch": None,
                        "current_ch": current_ch,
                        "gap": gap,
                        "current_status": status,
                        "sub_type": "never_reminded",
                    },
                ))
    return issues, None
```

#### 5.9.3 同步更新 `state-consistency-checker` SKILL.md 解读指南

修改 file:///workspace/.trae/skills/state-consistency-checker/SKILL.md 第 143-151 行「foreshadow_forgetting」段，新增 `stalled` 子类型说明：

```markdown
## 5. foreshadow_forgetting（伏笔遗忘/停滞，P1）

**含义**：planted/progressing/hinted 状态的伏笔超期未回收，或距上次提醒超过 20 章读者可能遗忘，或 planted 态伏笔距上次推进超过 15 章停滞（M6 新增子类型 `stalled`）。
**典型场景**：
- 超期：第 3 章埋的 short 伏笔，到第 15 章还没回收。
- 停滞：第 3 章埋的伏笔，到第 18 章仍是 planted 态，从未推进（M6 新增）。
- 遗忘：progressing/hinted 态伏笔距上次提醒 > 20 章。
**修复方向**（看 `extras.sub_type`）：
1. `overdue`：本章安排回收（揭秘/兑现/呼应），用 `hook-auditor` 更新 `status=resolved`。
2. `stalled`（M6 新增）：本章安排推进场景（角色调查/线索浮现/部分揭示），用 `audit_hooks --update H-XXX --status progressing --progress-ch N` 更新。
3. `forgetting` / `never_reminded`：本章安排 hinted 提醒（角色再次提及，不揭），刷新读者记忆。
4. 确实放弃：用 `hook-auditor` 改 `status=abandoned` 并补 `reason`。
```

---

## 六、验证方式

### 6.1 单元测试

```bash
pytest -q tests/test_foreshadow_five_stage.py
```

期望：7 个用例全部通过（详见 §七）。

### 6.2 集成测试 1 · `--due-list` 命令

```bash
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --due-list --chapter 50
```

期望输出（人类可读报告）：

```
=== 本章伏笔待办清单（ch_050）===
应推进: 1 | 应暗示: 0 | 应回收: 0 | 应归档: 0

--- 🟠 应推进（planted 态停留过久）---
  H-001 [core] "示例伏笔：主角眉心的红痣..."
    建议: 在 ch_050 安排推进场景（角色调查/线索浮现/部分揭示）
```

JSON 模式：

```bash
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --due-list --chapter 50 --json
```

期望：JSON 含 `due_progress` / `due_hint` / `due_resolve` / `due_archive` / `stats` 字段。

### 6.3 集成测试 2 · `--quality` 命令

```bash
# 先把 H-001 更新为 resolved
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --update H-001 --status resolved --reminder-ch 10 --no-commit

# 评估回收质量，自动转 archived
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --update H-001 --quality '{"surprise":4,"coherence":5,"payoff":4,"emotional_impact":5}' --no-commit
```

期望输出：

```json
{
  "hook_id": "H-001",
  "status": "archived",
  "archived_ch": 10,
  "quality": {
    "surprise": 4,
    "coherence": 5,
    "payoff": 4,
    "emotional_impact": 5,
    "total": 18,
    "grade": "S"
  }
}
```

### 6.4 集成测试 3 · `check_consistency.py` 升级

```bash
python -m scripts.novelforge.check_consistency --vault NovelForge_Vault
```

期望：
- 5 态伏笔（planted/progressing/hinted）均能被 `foreshadow_forgetting` 检测
- `planted` 态伏笔超 `FORESHADOW_PROGRESS_THRESHOLD=15` 章未推进 → 触发 `sub_type=stalled` 的 P1
- 既有 `overdue` / `forgetting` / `never_reminded` 子类型不破坏

### 6.5 集成测试 4 · `architect` Skill 章纲生成前注入伏笔清单

模拟 architect 生成 ch_050 章纲：

```bash
# 命令 1：全量审计
python -m scripts.novelforge.audit_hooks --current-ch 50 --json

# 命令 2：本章待办清单
python -m scripts.novelforge.audit_hooks --due-list --chapter 50 --json
```

期望：architect Skill 读取命令 2 输出后，章纲「五、伏笔操作·推进」段列明 H-001 的推进方案。

### 6.6 断言清单

| # | 断言 | 验证方式 |
|---|---|---|
| 1 | `FORESHADOW_SCHEMA.status` 枚举含 5 态 + abandoned | `test_foreshadow_schema_has_five_stages` |
| 2 | `planted → progressing` 转换合法 | `test_status_transition_planted_to_progressing` |
| 3 | `progressing → hinted` 转换合法 | `test_status_transition_progressing_to_hinted` |
| 4 | 回收质量 4 维度评分可计算 + 等级可分级 | `test_quality_evaluation_four_dimensions` |
| 5 | `--due-list` 命令输出 `due_progress/due_hint/due_resolve/due_archive` 四类 | `test_due_list_command_outputs_correctly` |
| 6 | `check_consistency.py` 的 `foreshadow_forgetting` 支持 5 态 + `stalled` 子类型 | `test_check_consistency_supports_five_stages` |
| 7 | H-001 可迁移到 5 态 schema（含 quality 字段） | `test_h_001_migrated_to_five_stage` |

### 6.7 与现有校验脚本的关系

- **不冲突** `check_consistency.py` 的其他 6 类检测：本模块只升级 `foreshadow_forgetting` 一项，其他 6 类（power_level_jump / phantom_item / location_jump / character_revival / relationship_mutation / golden_finger_overreach）不动
- **不冲突** `check_ai_novel.py`：去 AI 味检测独立运行，与伏笔状态机无交集
- **强化** `audit_hooks.py`：从 4 态升级为 5 态，新增 `--due-list` / `--quality` 两命令，但既有 `--current-ch` / `--update` / `--add` / `--check-outline` 命令保持兼容
- **依赖** M2 的 `validate_foreshadow` 入口：本模块升级 `FORESHADOW_SCHEMA` 后，`validate_foreshadow` 同步升级，M2 的 flag 协议自动适配新枚举

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

文件：`file:///workspace/tests/test_foreshadow_five_stage.py`

```python
"""NovelForge M6 伏笔生命周期五阶段升级回归测试。

覆盖：
- FORESHADOW_SCHEMA 5 态枚举
- 状态转换合法性（planted → progressing → hinted）
- 回收质量 4 维度评分
- --due-list 命令输出
- check_consistency.py foreshadow_forgetting 升级支持 5 态
- H-001 迁移到 5 态 schema
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

WORKSPACE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WORKSPACE))

from scripts.novelforge.schema import (  # noqa: E402
    FORESHADOW_SCHEMA,
    validate_foreshadow,
)
from scripts.novelforge.audit_hooks import (  # noqa: E402
    FORESHADOW_STATUSES,
    STATUS_TRANSITIONS,
    PROGRESS_INTERVAL,
    validate_status_transition,
    evaluate_resolution_quality,
    compute_due_list,
    format_due_list,
    update_hook,
    add_hook,
)


# ============================================================================
# 1. FORESHADOW_SCHEMA 5 态枚举
# ============================================================================
def test_foreshadow_schema_has_five_stages():
    """断言 FORESHADOW_SCHEMA.status 枚举含 5 态 + abandoned（共 6 枚举）。"""
    status_enum = FORESHADOW_SCHEMA["properties"]["status"]["enum"]
    expected = {"planted", "progressing", "hinted", "resolved", "archived", "abandoned"}
    assert set(status_enum) == expected, (
        f"status 枚举不匹配：{set(status_enum)} vs {expected}"
    )

    # M6 新增字段存在
    props = FORESHADOW_SCHEMA["properties"]
    assert "progress_chapters" in props, "缺 progress_chapters 字段"
    assert "last_progress_ch" in props, "缺 last_progress_ch 字段"
    assert "archived_ch" in props, "缺 archived_ch 字段"
    assert "quality" in props, "缺 quality 字段"

    # validate_foreshadow 同步升级
    valid_hook = {
        "hook_id": "H-TEST",
        "description": "测试伏笔",
        "planted_ch": 1,
        "scope": "short",
        "status": "progressing",  # M6 新增态
    }
    assert validate_foreshadow(valid_hook) == [], "progressing 态应通过校验"

    invalid_hook = dict(valid_hook, status="invalid_status")
    errors = validate_foreshadow(invalid_hook)
    assert any("status 非法" in e for e in errors), "非法 status 应被拦截"


# ============================================================================
# 2. planted → progressing 状态转换
# ============================================================================
def test_status_transition_planted_to_progressing():
    """断言 planted → progressing 合法，且通过 --progress-ch 自动转换。"""
    # validate_status_transition 直接调用
    is_valid, msg = validate_status_transition("planted", "progressing")
    assert is_valid, f"planted → progressing 应合法：{msg}"

    # update_hook 自动转换：planted + progress_ch → progressing
    hooks = [{
        "hook_id": "H-001",
        "description": "测试",
        "planted_ch": 1,
        "scope": "short",
        "status": "planted",
        "progress_chapters": [],
        "last_progress_ch": None,
    }]
    ok, msg, updated = update_hook(hooks, "H-001", progress_ch=5)
    assert ok, msg
    assert updated["status"] == "progressing", "planted + progress_ch 应自动转 progressing"
    assert updated["progress_chapters"] == [5]
    assert updated["last_progress_ch"] == 5

    # 非法转换：archived → planted
    is_valid, msg = validate_status_transition("archived", "planted")
    assert not is_valid, "archived → planted 应非法"


# ============================================================================
# 3. progressing → hinted 状态转换
# ============================================================================
def test_status_transition_progressing_to_hinted():
    """断言 progressing → hinted 合法，且通过 --reminder-ch 自动转换。"""
    is_valid, msg = validate_status_transition("progressing", "hinted")
    assert is_valid, f"progressing → hinted 应合法：{msg}"

    # update_hook 自动转换：progressing + reminder_ch → hinted
    hooks = [{
        "hook_id": "H-001",
        "description": "测试",
        "planted_ch": 1,
        "scope": "short",
        "status": "progressing",
        "progress_chapters": [3],
        "last_progress_ch": 3,
        "reminder_chapters": [],
        "last_reminder_ch": None,
    }]
    ok, msg, updated = update_hook(hooks, "H-001", reminder_ch=7)
    assert ok, msg
    assert updated["status"] == "hinted", "progressing + reminder_ch 应自动转 hinted"
    assert updated["reminder_chapters"] == [7]

    # 非法转换：hinted → progressing（不可回退）
    is_valid, msg = validate_status_transition("hinted", "progressing")
    assert not is_valid, "hinted → progressing 应非法（不可回退）"


# ============================================================================
# 4. 回收质量 4 维度评分
# ============================================================================
def test_quality_evaluation_four_dimensions():
    """断言 4 维度评分可计算 + 等级分级正确 + D 级触发 low_quality。"""
    hook = {
        "hook_id": "H-001",
        "description": "测试",
        "status": "resolved",
    }

    # S 级（18 分）
    result = evaluate_resolution_quality(hook, {
        "surprise": 5, "coherence": 5, "payoff": 4, "emotional_impact": 4,
    })
    assert result["quality"]["total"] == 18
    assert result["quality"]["grade"] == "S"
    assert result["is_low_quality"] is False

    # A 级（16 分）
    result = evaluate_resolution_quality(hook, {
        "surprise": 4, "coherence": 4, "payoff": 4, "emotional_impact": 4,
    })
    assert result["quality"]["total"] == 16
    assert result["quality"]["grade"] == "A"

    # D 级（8 分）
    result = evaluate_resolution_quality(hook, {
        "surprise": 1, "coherence": 2, "payoff": 2, "emotional_impact": 3,
    })
    assert result["quality"]["total"] == 8
    assert result["quality"]["grade"] == "D"
    assert result["is_low_quality"] is True

    # 缺维度 → raise
    with pytest.raises(ValueError, match="缺少维度"):
        evaluate_resolution_quality(hook, {"surprise": 5})

    # 分数越界 → raise
    with pytest.raises(ValueError, match="越界"):
        evaluate_resolution_quality(hook, {
            "surprise": 0, "coherence": 5, "payoff": 5, "emotional_impact": 5,
        })

    # 非 resolved 态 → raise
    with pytest.raises(ValueError, match="仅 resolved 态"):
        evaluate_resolution_quality(
            {"hook_id": "H-001", "status": "hinted"},
            {"surprise": 5, "coherence": 5, "payoff": 5, "emotional_impact": 5},
        )


# ============================================================================
# 5. --due-list 命令输出
# ============================================================================
def test_due_list_command_outputs_correctly():
    """断言 compute_due_list 输出 4 类清单 + stats 统计。"""
    hooks = [
        # 应推进：planted 态，距 planted_ch 超 PROGRESS_INTERVAL.short=5
        {
            "hook_id": "H-001", "description": "红痣", "planted_ch": 1,
            "scope": "short", "status": "planted",
            "progress_chapters": [], "last_progress_ch": None,
        },
        # 应暗示：progressing 态，距 last_reminder_ch 超 REMINDER_INTERVAL.short=10
        {
            "hook_id": "H-002", "description": "玉简", "planted_ch": 5,
            "scope": "short", "status": "progressing",
            "last_reminder_ch": 10, "reminder_chapters": [10],
            "progress_chapters": [8], "last_progress_ch": 8,
        },
        # 应回收：target_resolve_ch <= current_ch
        {
            "hook_id": "H-003", "description": "身世", "planted_ch": 1,
            "scope": "short", "status": "hinted",
            "target_resolve_ch": 50, "last_reminder_ch": 45,
            "progress_chapters": [10, 30], "last_progress_ch": 30,
        },
        # 应归档：resolved 但无 quality
        {
            "hook_id": "H-004", "description": "印记", "planted_ch": 1,
            "scope": "short", "status": "resolved",
            "last_reminder_ch": 50, "quality": None,
        },
    ]

    report = compute_due_list(hooks, current_ch=55)

    # 4 类清单均非空
    assert len(report["due_progress"]) == 1
    assert len(report["due_hint"]) == 1
    assert len(report["due_resolve"]) == 1
    assert len(report["due_archive"]) == 1

    # stats 统计正确
    assert report["stats"]["due_progress_count"] == 1
    assert report["stats"]["due_hint_count"] == 1
    assert report["stats"]["due_resolve_count"] == 1
    assert report["stats"]["due_archive_count"] == 1
    assert report["stats"]["total_due"] == 4

    # 格式化输出可读
    text = format_due_list(report)
    assert "应推进" in text
    assert "应暗示" in text
    assert "应回收" in text
    assert "应归档" in text


# ============================================================================
# 6. check_consistency.py 支持 5 态
# ============================================================================
def test_check_consistency_supports_five_stages():
    """断言 check_consistency.py 的 foreshadow_forgetting 检测支持 5 态 + stalled 子类型。"""
    # 读取脚本源码，断言关键升级点存在
    script_path = WORKSPACE / "scripts" / "novelforge" / "check_consistency.py"
    source = script_path.read_text(encoding="utf-8")

    # 5 态枚举支持
    assert '"planted", "progressing", "hinted"' in source, (
        "check_foreshadow_forgetting 应支持 planted/progressing/hinted 三态检测"
    )

    # FORESHADOW_PROGRESS_THRESHOLD 常量存在
    assert "FORESHADOW_PROGRESS_THRESHOLD" in source, "应定义 FORESHADOW_PROGRESS_THRESHOLD 常量"

    # stalled 子类型存在
    assert '"stalled"' in source, "应新增 stalled 子类型（伏笔停滞）"

    # current_status 字段在 extras 中
    assert '"current_status"' in source, "extras 应含 current_status 字段"

    # 跑既有脚本不破坏
    result = subprocess.run(
        [sys.executable, "-m", "scripts.novelforge.check_consistency",
         "--vault", str(WORKSPACE / "NovelForge_Vault")],
        capture_output=True, text=True, cwd=str(WORKSPACE),
    )
    # 退出码 0 或 1（1 表示有 P0/P1 问题，但不破坏）
    assert result.returncode in (0, 1, 2), (
        f"check_consistency.py 跑挂了：\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )


# ============================================================================
# 7. H-001 迁移到 5 态 schema
# ============================================================================
def test_h_001_migrated_to_five_stage():
    """断言 hooks_registry.json 的 H-001 已迁移到 5 态 schema（含 quality 字段）。"""
    registry_path = WORKSPACE / "NovelForge_Vault" / "04_大纲与脉络" / "hooks_registry.json"
    with open(registry_path, "r", encoding="utf-8") as f:
        registry = json.load(f)

    # version 升级
    assert registry["version"] == "2.0.0", (
        f"version 应为 2.0.0，实际 {registry.get('version')}"
    )

    hooks = registry.get("hooks", [])
    assert len(hooks) >= 1, "应至少含 H-001 示例伏笔"

    h001 = next((h for h in hooks if h.get("hook_id") == "H-001"), None)
    assert h001 is not None, "缺 H-001"

    # status 是 5 态之一
    assert h001["status"] in FORESHADOW_STATUSES, (
        f"H-001 status 应为 5 态之一，实际 {h001.get('status')}"
    )

    # M6 新增字段存在
    assert "progress_chapters" in h001, "H-001 缺 progress_chapters 字段"
    assert "last_progress_ch" in h001, "H-001 缺 last_progress_ch 字段"
    assert "archived_ch" in h001, "H-001 缺 archived_ch 字段"
    assert "quality" in h001, "H-001 缺 quality 字段"

    # 若 quality 非 null，应有 total + grade
    if h001["quality"] is not None:
        q = h001["quality"]
        for dim in ("surprise", "coherence", "payoff", "emotional_impact"):
            assert dim in q, f"quality 缺 {dim} 维度"
        assert "total" in q, "quality 缺 total"
        assert "grade" in q, "quality 缺 grade"

    # validate_foreshadow 通过
    errors = validate_foreshadow(h001)
    assert errors == [], f"H-001 schema 校验失败：{errors}"
```

### 7.2 新增 BUG-056

在 `file:///workspace/tests/bug_regression_list.md` 末尾追加：

```markdown
## 伏笔追踪缺失 progressing 阶段导致回收质量差

- **编号**：BUG-056
- **首次出现**：2026-07-18（M6 模块方案设计时识别）
- **类型**：一致性 / 状态漂移
- **现象**：`hooks_registry.json` 的 `status` 字段仅有 4 态（planted/hinted/resolved/abandoned），缺少「推进」中间态，导致：
  1. 伏笔长期停在 `planted` 状态直到超期，作者 / AI 不知道「该推进了」；
  2. 伏笔回收后无质量评估字段（`resolution_note` 是自由文本），无法量化回收质量，无法在审计报告中聚合「低质量回收率」；
  3. `architect` Skill 章纲生成前只跑 `audit_hooks --current-ch` 拿超期清单，不主动注入「本章应推进 / 暗示的伏笔清单」，导致伏笔管理是被动审计而非主动调度。
- **根因**：伏笔 schema 设计滞后于伏笔生命周期管理需求。行业调研（CreAgentive Story Prototype KG / Remember Me narrative KG）表明伏笔是结构化对象，需要五阶段生命周期（埋设 → 推进 → 暗示 → 回收 → 归档），但 NovelForge 初版 schema 只覆盖了三阶段（埋设 → 暗示 → 回收），缺「推进」与「归档」两态；同时未引入回收质量评估，导致「回收了但烂」的伏笔与「回收得惊艳」的伏笔在 `status=resolved` 上无法区分。
- **修复**：
  1. `schema.py` 的 `FORESHADOW_SCHEMA.status` 枚举升级为 5 态 + abandoned（共 6 枚举）；新增 `progress_chapters` / `last_progress_ch` / `archived_ch` / `quality` 四字段。
  2. `audit_hooks.py` 新增 `STATUS_TRANSITIONS` 状态转换矩阵 + `validate_status_transition` 函数；新增 `compute_due_list` 函数（`--due-list` 命令）输出本章应推进 / 暗示 / 回收 / 归档的伏笔清单；新增 `evaluate_resolution_quality` 函数（`--quality` 命令）做 4 维度评分；`audit_all` 升级为 6 态计数 + `quality_stats` 统计；`update_hook` 升级为状态转换合法性校验 + 自动转换（planted + progress_ch → progressing；progressing + reminder_ch → hinted；resolved + quality → archived）。
  3. `check_consistency.py` 的 `check_foreshadow_forgetting` 升级支持 5 态（planted/progressing/hinted 均检测）；新增 `FORESHADOW_PROGRESS_THRESHOLD = 15`；新增 `stalled` 子类型（planted 态停留过久）。
  4. `architect` SKILL.md 第四步升级为双命令（`--current-ch` + `--due-list`），章纲「五、伏笔操作」段新增「推进」子项。
  5. `hook-auditor` SKILL.md 5 项职责升级为 6 项（新增「回收质量评估」职责）。
  6. `hooks_registry.json` version 升级为 2.0.0，H-001 迁移到 5 态 schema。
- **涉及文件**：`scripts/novelforge/schema.py`、`scripts/novelforge/audit_hooks.py`、`scripts/novelforge/check_consistency.py`、`NovelForge_Vault/04_大纲与脉络/hooks_registry.json`、`.trae/skills/hook-auditor/SKILL.md`、`.trae/skills/architect/SKILL.md`、`.trae/skills/idea-forge/SKILL.md`、`.trae/skills/writer-polisher/SKILL.md`、`.trae/skills/state-consistency-checker/SKILL.md`、`scripts/novelforge/data/foreshadow_quality_rubric.json`（新增）、`tests/test_foreshadow_five_stage.py`（新增）
- **回归测试**：`tests/test_foreshadow_five_stage.py` 7 个用例（5 态 schema / 状态转换 / 4 维评分 / `--due-list` / `check_consistency` 升级 / H-001 迁移）；`pytest -q tests/test_foreshadow_five_stage.py` 全部通过
- **教训/沉淀**：伏笔是结构化生命周期对象，不是二值标记。行业方案（Sudowrite 三态 / NovelCrafter 被动查询 / CreAgentive KG 五态）各有局限，NovelForge 用 JSON 文件实现 5 态 + 4 维评分 + 主动提醒，在不引入 KG 基础设施的前提下达到了 CreAgentive 的生命周期管理粒度。本 bug 是 NovelForge 伏笔管理从「被动审计」升级为「主动调度」的关键节点。
- **频次**：第 1 次（schema 设计滞后的典型，与 BUG-051 schema 滞后同源）
```

### 7.3 在 `check_consistency.py` / `check_ai_novel.py` 中新增的检测规则

**`check_consistency.py` 升级**（已在 §5.9 详述）：
- `check_foreshadow_forgetting` 函数支持 5 态（planted/progressing/hinted 均检测）
- 新增 `FORESHADOW_PROGRESS_THRESHOLD = 15` 常量
- 新增 `stalled` 子类型（planted 态停留过久）
- extras 新增 `current_status` 字段

**`check_ai_novel.py` 不动**：去 AI 味检测与伏笔状态机无交集。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**中**（修改 `hooks_registry.json` schema 需迁移已有数据，但当前仅 1 条示例伏笔 H-001，迁移成本低）。

### 8.2 风险分析

| 风险 | 影响 | 缓解 |
|---|---|---|
| `hooks_registry.json` schema 升级导致既有数据不兼容 | 当前仅 1 条示例伏笔 H-001，迁移成本低；但若有用户已用 4 态 schema 写了大量伏笔，需迁移脚本 | (a) 提供 `migrate_hooks_to_five_stage.py` 迁移脚本（自动给既有伏笔补 `progress_chapters=[]` / `last_progress_ch=null` / `archived_ch=null` / `quality=null`）；(b) `validate_foreshadow` 对缺字段的旧伏笔给出明确报错；(c) 保留旧 `hooks_registry.json` 备份 |
| `audit_hooks.py` 状态转换合法性校验可能拦截合法操作 | `STATUS_TRANSITIONS` 矩阵可能漏掉某些边界场景（如 `planted → resolved` 直接回收短伏笔） | (a) 矩阵设计时允许 `planted → resolved`（短伏笔可一次性回收）；(b) 7 个 pytest 用例覆盖关键转换路径；(c) 跑既有 `pytest -q` 全集验证不破坏历史用例 |
| `check_consistency.py` 升级可能误报 `stalled` | `planted` 态伏笔若 `last_progress_ch=null` 且 `current_ch - planted_ch > 15`，会触发 `stalled`，但某些 short 伏笔本就不需要推进（直接回收） | (a) `stalled` 是 P1 不阻断保存；(b) 作者可在 `p1_waiver.log` 留痕豁免；(c) `progress_chapters` 字段填入 `planted_ch` 本身可避免误报 |
| `--due-list` 命令输出可能过多 | 若伏笔表有 50+ 条伏笔，`due_progress` 可能很长 | (a) 按 `priority` + `strength` 降序排序；(b) `architect` Skill 只取 top 5 安排推进 |
| `architect` SKILL.md 双命令路由可能被跳过 | 主 Agent 可能只跑 `--current-ch` 不跑 `--due-list` | (a) SKILL.md 第四步明确标注「双命令」；(b) `dev-checklist.md` 新增「章纲生成前双命令校验」项 |
| 回收质量评分主观性强 | 不同评分者（作者 vs AI）对同一伏笔的评分可能差异大 | (a) `foreshadow_quality_rubric.json` 评分细则明确每个等级的描述；(b) 评分由作者主导，AI 仅建议；(c) 评分记录在 `quality` 字段，可追溯 |

### 8.3 对核心资产的影响

| 资产 | 影响 | 防护 |
|---|---|---|
| `scripts/novelforge/audit_hooks.py`（伏笔审计核心，945 行） | 5 态状态机 + `--due-list` + `--quality` 三项升级 | 完整回归测试 + 既有 4 态命令保持兼容（`--current-ch` / `--update` / `--add` / `--check-outline`） |
| `scripts/novelforge/schema.py`（SSOT） | `FORESHADOW_SCHEMA` 升级 | 不修改既有字段定义，纯增量（新增 4 字段 + status 枚举扩展） |
| `scripts/novelforge/check_consistency.py`（一致性检测核心，1460 行） | `check_foreshadow_forgetting` 升级 | 只升级 1/7 类检测，其他 6 类不动；既有 `overdue` / `forgetting` / `never_reminded` 子类型不破坏 |
| `NovelForge_Vault/04_大纲与脉络/hooks_registry.json`（伏笔 SSOT） | schema 升级 + H-001 迁移 | version 2.0.0 + 备份旧版本 |
| `.trae/skills/hook-auditor/SKILL.md`（守护 Skill） | 5 项职责升级为 6 项 | 仅文档层修改，不影响检测逻辑 |
| `.trae/skills/architect/SKILL.md`（核心 Skill） | 第四步升级 + 章纲模板升级 | 仅文档层修改，章纲十段结构不变 |

### 8.4 回滚方案

**分支隔离**：

```bash
git checkout -b feature/foreshadow-five-stage
# 全部改动在本分支提交
# 验证通过后再合 master
```

**数据备份**：

```bash
# 修改前备份 hooks_registry.json / schema.py / audit_hooks.py / check_consistency.py
cp NovelForge_Vault/04_大纲与脉络/hooks_registry.json /tmp/hooks_registry.json.bak.$(date +%Y%m%d)
cp scripts/novelforge/schema.py /tmp/schema.py.bak.$(date +%Y%m%d)
cp scripts/novelforge/audit_hooks.py /tmp/audit_hooks.py.bak.$(date +%Y%m%d)
cp scripts/novelforge/check_consistency.py /tmp/check_consistency.py.bak.$(date +%Y%m%d)
```

**数据迁移**：

```bash
# 若回滚后需要把 5 态伏笔降级回 4 态
python -c "
import json
with open('NovelForge_Vault/04_大纲与脉络/hooks_registry.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
# 把 archived 转 resolved，progressing 转 planted
for h in data.get('hooks', []):
    if h.get('status') == 'archived':
        h['status'] = 'resolved'
    elif h.get('status') == 'progressing':
        h['status'] = 'planted'
    # 删除 M6 新增字段
    for field in ('progress_chapters', 'last_progress_ch', 'archived_ch', 'quality'):
        h.pop(field, None)
data['version'] = '1.0.0'
with open('NovelForge_Vault/04_大纲与脉络/hooks_registry.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print('回滚完成')
"
```

**紧急回滚**：

```bash
# 1. 切回主分支
git checkout master

# 2. 或 revert 单个 commit
git revert <commit_hash>

# 3. 恢复备份的 hooks_registry.json
cp /tmp/hooks_registry.json.bak.YYYYMMDD NovelForge_Vault/04_大纲与脉络/hooks_registry.json
```

---

## 九、完成标准（DoD 清单）

- [ ] `FORESHADOW_SCHEMA` 升级为 5 态 + abandoned（共 6 枚举），由 `test_foreshadow_schema_has_five_stages` 锁定
- [ ] `FORESHADOW_SCHEMA` 新增 `progress_chapters` / `last_progress_ch` / `archived_ch` / `quality` 四字段
- [ ] `validate_foreshadow` 函数同步升级，支持 5 态枚举校验
- [ ] `hooks_registry.json` 迁移完成：version=2.0.0，H-001 含 5 态 schema 全字段，由 `test_h_001_migrated_to_five_stage` 锁定
- [ ] `audit_hooks.py` 实现 5 态状态机（`STATUS_TRANSITIONS` 矩阵 + `validate_status_transition` 函数）
- [ ] `audit_hooks.py` 实现回收质量评估（`evaluate_resolution_quality` 函数，4 维度评分 + S/A/B/C/D 分级）
- [ ] `audit_hooks.py` `--due-list` 命令可用，输出 `due_progress` / `due_hint` / `due_resolve` / `due_archive` 四类清单，由 `test_due_list_command_outputs_correctly` 锁定
- [ ] `audit_hooks.py` `--quality` 命令可用，对 resolved 伏笔评分后自动转 archived
- [ ] `audit_hooks.py` `audit_all` 升级为 6 态计数 + `quality_stats` 统计 + `low_quality_list` 列表
- [ ] `audit_hooks.py` `update_hook` 升级为状态转换合法性校验 + 自动转换（planted + progress_ch → progressing；progressing + reminder_ch → hinted；resolved + quality → archived）
- [ ] `architect` SKILL.md 第四步升级为双命令（`--current-ch` + `--due-list`），章纲「五、伏笔操作」段新增「推进」子项，字段约束升级为四类
- [ ] `hook-auditor` SKILL.md 5 项职责升级为 6 项（新增「回收质量评估」职责），`status` 枚举升级为 5 态，反模式新增「不跳过 progressing 直接 hinted」
- [ ] `check_consistency.py` 的 `check_foreshadow_forgetting` 升级支持 5 态（planted/progressing/hinted 均检测），由 `test_check_consistency_supports_five_stages` 锁定
- [ ] `check_consistency.py` 新增 `FORESHADOW_PROGRESS_THRESHOLD = 15` 常量 + `stalled` 子类型
- [ ] `state-consistency-checker` SKILL.md 的 `foreshadow_forgetting` 解读指南同步升级（含 `stalled` 子类型）
- [ ] `idea-forge` SKILL.md 的 `--add` 命令示例补 `progress_chapters` 字段
- [ ] `writer-polisher` SKILL.md 的 Delta 示例补 5 态 status
- [ ] 新增 `scripts/novelforge/data/foreshadow_quality_rubric.json`（4 维度 × 5 等级评分细则）
- [ ] `tests/test_foreshadow_five_stage.py` 7 个用例全部通过
- [ ] `bug_regression_list.md` 新增 BUG-056
- [ ] `pytest -q` 全集通过（不破坏历史用例）
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 仍正常（不破坏其他 6 类检测）
- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 仍正常（独立检测不受影响）
- [ ] `python scripts/novelforge/audit_hooks --vault NovelForge_Vault --current-ch 50 --json` 仍正常（既有命令兼容）
- [ ] `docs/loop_log/2026-07.md` 追加一条 #lesson `plot_structure` 沉淀（伏笔从 4 态到 5 态 + 回收质量评估的差异化设计）

---

## 附录 A · 关键路径速查

| 文件 | 路径 |
|---|---|
| schema.py | file:///workspace/scripts/novelforge/schema.py |
| audit_hooks.py | file:///workspace/scripts/novelforge/audit_hooks.py |
| check_consistency.py | file:///workspace/scripts/novelforge/check_consistency.py |
| hooks_registry.json | file:///workspace/NovelForge_Vault/04_大纲与脉络/hooks_registry.json |
| hook-auditor SKILL.md | file:///workspace/.trae/skills/hook-auditor/SKILL.md |
| architect SKILL.md | file:///workspace/.trae/skills/architect/SKILL.md |
| idea-forge SKILL.md | file:///workspace/.trae/skills/idea-forge/SKILL.md |
| writer-polisher SKILL.md | file:///workspace/.trae/skills/writer-polisher/SKILL.md |
| state-consistency-checker SKILL.md | file:///workspace/.trae/skills/state-consistency-checker/SKILL.md |
| foreshadow_quality_rubric.json（新增） | file:///workspace/scripts/novelforge/data/foreshadow_quality_rubric.json |
| bug_regression_list.md | file:///workspace/tests/bug_regression_list.md |
| loop_log 2026-07 | file:///workspace/docs/loop_log/2026-07.md |
| test_foreshadow_five_stage.py（新增） | file:///workspace/tests/test_foreshadow_five_stage.py |
| 本方案文档 | file:///workspace/docs/optimization_plan_2026_07/M06_foreshadow_five_stage.md |

## 附录 B · 验证命令一键运行

```bash
# 1. 单元测试
pytest -q tests/test_foreshadow_five_stage.py

# 2. --due-list 集成测试
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --due-list --chapter 50
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --due-list --chapter 50 --json

# 3. --quality 集成测试（先 resolved 再 quality）
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --update H-001 --status resolved --reminder-ch 10 --no-commit
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --update H-001 --quality '{"surprise":4,"coherence":5,"payoff":4,"emotional_impact":5}' --no-commit

# 4. check_consistency 升级验证
python -m scripts.novelforge.check_consistency --vault NovelForge_Vault

# 5. 既有命令兼容验证
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --current-ch 50 --json
python -m scripts.novelforge.audit_hooks --vault NovelForge_Vault --stats --current-ch 50

# 6. 完整 pytest
pytest -q

# 7. 回滚脚本（紧急时用）
# 见 §8.4 回滚方案
```

## 附录 C · `foreshadow_quality_rubric.json` 模板

```json
{
  "_comment": "NovelForge 伏笔回收质量评分细则。4 维度 × 5 等级。由 audit_hooks.py --quality 命令读取。",
  "version": "1.0.0",
  "dimensions": {
    "surprise": {
      "description": "惊喜度：回收时是否超出读者预期",
      "levels": {
        "1": "完全在意料之中，读者早就猜到",
        "2": "大部分在意料之中，有小惊喜",
        "3": "中等惊喜，部分超出预期",
        "4": "较大惊喜，颠覆部分预期",
        "5": "完全颠覆读者预期，回头重读前文有「原来如此」感"
      }
    },
    "coherence": {
      "description": "一致性：回收与前文铺垫是否一致",
      "levels": {
        "1": "与前文矛盾或强行解释",
        "2": "与前文有出入但能自圆其说",
        "3": "与前文基本一致，无明显矛盾",
        "4": "与前文铺垫高度一致",
        "5": "与前文所有铺垫严丝合缝，无任何矛盾"
      }
    },
    "payoff": {
      "description": "兑现度：回收是否兑现了埋设时的承诺",
      "levels": {
        "1": "兑现了一半或敷衍兑现",
        "2": "基本兑现但不够精彩",
        "3": "完全兑现承诺",
        "4": "完全兑现且超出承诺",
        "5": "完全兑现且连带解锁新情节 / 新能力 / 新伏笔"
      }
    },
    "emotional_impact": {
      "description": "情绪冲击：回收时读者的情绪强度",
      "levels": {
        "1": "无情绪波动",
        "2": "轻微情绪波动",
        "3": "中等情绪冲击",
        "4": "强烈情绪（震撼 / 感动 / 反胃 / 燃）",
        "5": "极强情绪，符合 emotional_valence 设定，读者会截图分享"
      }
    }
  },
  "grade_thresholds": {
    "S": {"min_total": 18, "description": "惊艳回收"},
    "A": {"min_total": 15, "description": "优秀回收"},
    "B": {"min_total": 12, "description": "合格回收"},
    "C": {"min_total": 9, "description": "勉强回收，建议补铺垫"},
    "D": {"min_total": 0, "description": "烂尾回收，触发预警"}
  },
  "low_quality_health_line": 0.20
}
```

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge M6 模块（伏笔生命周期五阶段升级）
**依赖**：M2（schema 同步门禁）
**下游**：M7（active enforcement）/ M19（起点神级方法论）/ M20（自检清单升级）
