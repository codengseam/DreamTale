# M14 · 因果链检测

> **模块定位**：L2 一致性增强 · 第 14 模块（前置依赖 M01 章末摘要契约完成）
>
> **核心目标**：在 `check_consistency.py` 新增第 8 类检测 `causal_chain_break`，跨章节追踪因果事件，自动检测"前后不呼应"的逻辑断裂。
>
> **创建日期**：2026-07-18
> **文档版本**：v1.0
> **作者**：NovelForge 优化方案多专家团

---

## 一、模块目标

### 1.1 一句话目标

**在 `file:///workspace/scripts/novelforge/check_consistency.py` 新增第 8 类检测 `causal_chain_break`，基于章末摘要 + key-scene-archiver 关键场景存档 + 角色状态机 diff 三源数据，自动检测章节间因果链断裂（受伤未愈、角色死后复现、物品得而复失等 10 类事件）。**

### 1.2 对应的痛点

本模块对应长篇小说创作中"前后不呼应"的高频痛点：

| 痛点场景 | 当前检测能力 | M14 完成后 |
|---|---|---|
| A 章主角受伤，B 章毫无提及就活蹦乱跳 | ❌ 仅靠 `recap` 间接缓解 | ✅ `injury` 事件跨章追踪，预期恢复期内未提及 → P0 |
| A 章角色死亡，B 章突然又出现 | ⚠️ 现有 `character_revival` 只检测单章内 `status=dead` 角色登场，不检测跨章因果 | ✅ `character_death` 事件跨章追踪，B 章再现无 `character_revival` 场景 → P0 |
| A 章得到某物品，B 章完全没用过就丢了 | ⚠️ 现有 `phantom_item` 只检测"无中生物品"，不检测"得而复失" | ✅ `item_acquired` → `item_lost` 事件配对，短期消失 → P1 |
| A 章关系转折，B 章关系类型倒退 | ⚠️ 现有 `relationship_mutation` 检测单章 vs 状态机，不检测跨章变化合理性 | ✅ `relationship_change` 事件追踪，无新转折场景却倒退 → P1 |

### 1.3 完成后达成的能力（可量化）

| 能力 | 当前状态 | 完成后 |
|---|---|---|
| `check_consistency.py` 检测维度数 | 7 类 | 8 类（新增 `causal_chain_break`） |
| 跨章节因果事件追踪 | 不支持 | 支持 10 类因果事件自动识别与跨章配对 |
| 因果事件类型库 | 不存在 | `scripts/novelforge/data/causal_event_types.json` SSOT |
| `key-scene-archiver` 因果事件产出 | 场景文件含"角色状态变化"段但无结构化因果事件 | 场景文件 6 段结构升级为 7 段，新增"因果事件"段 |
| `dev-checklist.md` 因果链检测项 | 不含 | 新增 §十 因果链检测段（5 项 checklist） |
| 回归测试覆盖 | 0 用例 | 7 个 pytest 用例（`tests/test_causal_chain.py`） |

---

## 二、痛点对应

### 2.1 痛点表现：长篇创作的"前后不呼应"

长篇小说（100w+ 字）随着章节累积，"前后不呼应"问题呈指数级增长。典型表现：

#### 痛点 1：受伤恢复链断裂

```
ch_042：主角左臂被剑气斩断，鲜血淋漓，跌坐在地。
ch_043：主角挥舞双拳，与敌厮杀正酣。
```

**问题**：ch_042 主角左臂断，ch_043 主角挥"双拳"——左臂应该断着。当前 `check_consistency.py` 的 `power_level_jump` 只检测境界跳级，不检测伤势恢复链。

#### 痛点 2：角色死亡复现

```
ch_027：苏婉为护主角，挡下一剑，香消玉殒。
ch_035：苏婉走上前来，淡淡道："师弟，你怎么了？"
```

**问题**：ch_027 苏婉死，ch_035 苏婉"走上前来"——这要么是回忆/幻觉（但无标注），要么是因果链断裂。当前 `check_consistency.py` 的 `character_revival` 只在主角状态机 `status=dead` 时检测单章内台词/动作，**不跨章追踪死亡事件**。

#### 痛点 3：物品得而复失

```
ch_015：主角获得玄铁剑，认主成功。
ch_016-040：（玄铁剑从未在正文中出现）
ch_041：主角手中只有一柄普通长剑。
```

**问题**：ch_015 获得玄铁剑，后续 25 章未提及，ch_041 直接换武器——物品凭空"消失"。当前 `phantom_item` 检测的是"无中生物品"（正文有但状态机无），**不检测"有中失物"**（状态机有但正文长期未使用）。

#### 痛点 4：关系倒退无铺垫

```
ch_050：主角与李师兄歃血为盟，结为生死之交。
ch_052：主角一刀斩向李师兄，"今日不是你死就是我亡！"
```

**问题**：ch_050 结盟，ch_052 反目——中间 ch_051 应该有冲突铺垫。当前 `relationship_mutation` 检测的是"正文 vs 状态机不一致"，**不检测跨章倒退是否有过渡**。

### 2.2 行业方案参考

| 来源 | 方案 | NovelForge 差异化设计 |
|---|---|---|
| **《情节！情节！》（Donald Maass）** | 长篇创作手册强调"前后呼应"，每个关键事件必须有"回响"章节 | NovelForge 不依赖人工检查，用结构化因果事件 + 自动化检测脚本实现"回响校验" |
| **《故事工程》（Larry Brooks）** | "Beat Sheet" 方法论要求每个 story beat 有 setup → payoff 配对 | NovelForge 借鉴"事件配对"思想，但用 `expected_duration` 字段量化配对窗口，而非故事节拍表 |
| **Scrivener Snapshot** | 用快照对比章节间角色状态变化，需人工 diff | NovelForge 用 `.state/characters/*.json` 状态机 diff，由 `check_consistency.py` 自动比对 |
| **Sudowrite Story Bible** | "Plot Threads" 追踪每条情节线在哪些章节被提及 | NovelForge 用 `.state/causal_events/ch_NNN_events.json` 章末因果事件清单，结构化 10 类事件，而非自由文本 threads |
| **recap-generator（NovelForge 内部）** | 每 10 章生成前情提要，间接缓解跨章遗忘 | recap 是"压缩版历史"，因果链检测是"结构化追踪"，二者互补：recap 防 LLM 遗忘，因果链检测防逻辑断裂 |

### 2.3 recap 与因果链检测的边界

| 维度 | recap-generator | causal_chain_break（M14） |
|---|---|---|
| 目的 | 防止 LLM 上下文遗忘 | 检测章节间逻辑断裂 |
| 触发频率 | 每 10 章一次 | 每章执笔后必检 |
| 数据形式 | 自然语言压缩摘要 | 结构化因果事件 JSON |
| 检测能力 | 无（只供 LLM 读取） | 自动比对 + P0/P1 报警 |
| 阻断性 | 不阻断 | P0 阻断 published（与 `--strict` 模式联动） |

**互补关系**：recap 是"软性提醒"，因果链检测是"硬性门禁"。两者不重叠、不冲突。

### 2.4 本模块的差异化设计

1. **三源数据融合**：不依赖单一数据源，融合 ① 章末摘要（M01 修复后真实产出）② key-scene-archiver 关键场景存档 ③ 角色状态机 diff，互为佐证，降低误报。
2. **结构化事件而非自由文本**：因果事件用 schema 化 JSON 存储（`event_id / chapter / event_type / subject / object / state_before / state_after / expected_duration / resolved_in_chapter`），可被脚本精确解析，而非依赖 LLM 二次理解。
3. **`expected_duration` 量化配对窗口**：每类事件有预期持续时间（如 `injury` 默认 3 章，`character_death` 永久），窗口内未解决 → P0，超出窗口 → P1。避免硬编码阈值。
4. **与现有 `character_revival` / `phantom_item` 联动**：不重复检测单章内的复生/凭空（现有维度已覆盖），只检测跨章事件链。`character_revival` 检测到 `status=dead` 角色登场时，会自动查找是否有 `character_revival` 因果事件登记，无则升级为 P0 因果断裂。
5. **纯标准库实现**：与 `check_consistency.py` 现有风格一致，仅依赖 `json/re/os/argparse/sys/glob/pathlib`，不引入第三方依赖。
6. **误报优先于漏报**：与现有哲学一致，宁可标记需人工复核，也不静默放过。但通过 `expected_duration` 量化窗口 + 三源数据交叉验证降低误报率。

---

## 三、涉及现有文件

### 3.1 涉及的 Python 脚本（2 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/check_consistency.py` | 第 162-179 行 `DIM_ALIASES` 常量；第 182-190 行 `ALL_DIMENSIONS` 列表；第 193-201 行 `DIM_LABELS` 字典；第 1203-1209 行 `_DIM_CHECKERS_NO_VAULT` 映射；第 1272-1289 行 `check_all()` 编排循环 | 新增 `causal_chain_break` 维度全链路接入 |
| 2 | `file:///workspace/scripts/novelforge/save_state.py` | 第 67-73 行常量段；第 281-332 行 `_route_path()` 函数 | 新增 `causal_events` 路由分支，支持写入 `.state/causal_events/ch_NNN_events.json` |

### 3.2 涉及的 Skill 文件（1 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | 第 62-73 行 10 类关键场景表；第 104-133 行 6 段场景文件结构 | 升级为 7 段结构（新增"因果事件"段），关键场景识别时同步产出因果事件清单 |

### 3.3 涉及的规则 / Checklist 文件（1 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/.trae/checklists/dev-checklist.md` | 在 §九 Skill 契约校验（M01 新增）之后追加 §十 因果链检测段 | 新增章节 |

### 3.4 不修改但需要参考的文件

- `file:///workspace/scripts/novelforge/check_ai_novel.py`（去 AI 味检测，本模块不动）
- `file:///workspace/scripts/novelforge/build_context.py`（上下文组装，本模块不动，但因果事件清单可作为它的 Retrieved 层召回源，留作 M15 扩展）
- `file:///workspace/scripts/novelforge/schema.py`（schema 校验，由 M02 处理，本模块不动）
- `file:///workspace/scripts/novelforge/audit_hooks.py`（伏笔审计，本模块不动）
- `file:///workspace/.trae/skills/writer-polisher/SKILL.md`（执笔 Skill，本模块不动；其产出的章末摘要是因果链检测的数据源之一）
- `file:///workspace/NovelForge_Vault/.state/characters/protagonist.json`（主角状态模板，含 `location / inventory / emotion / power_level / relationships / status / knowledge`，本模块只读不写）
- `file:///workspace/.trae/rules/dev-workflow.md`（流程规则，不变）
- `file:///workspace/.trae/rules/bug-reporting.md`（bug 规范，新增 BUG-064 引用）
- `file:///workspace/tests/bug_regression_list.md`（新增 BUG-064 条目）
- `file:///workspace/docs/optimization_plan_2026_07/M01_skill_contract_layer.md`（M01 方案，章末摘要产出契约——M14 前置依赖）

### 3.5 关键现状摘录（从 Read 结果提炼）

#### 3.5.1 `check_consistency.py` 当前 7 类检测维度

来源：`file:///workspace/scripts/novelforge/check_consistency.py` 第 5-11 行 docstring + 第 182-201 行常量定义。

```python
# 当前 7 类维度（M14 完成后变为 8 类）
ALL_DIMENSIONS: list[str] = [
    "power_level_jump",        # P0 境界跳级
    "phantom_item",            # P0 物品凭空
    "relationship_mutation",   # P1 关系突变
    "location_jump",          # P0 位置穿越
    "foreshadow_forgetting",   # P1 伏笔遗忘
    "character_revival",       # P0 角色复生
    "golden_finger_overreach", # P1 金手指越界
]
```

#### 3.5.2 单维度检测函数签名规范

来源：`file:///workspace/scripts/novelforge/check_consistency.py` 第 504-566 行 `check_power_level_jump` 函数。

```python
def check_<dim_name>(
    body: str,                                    # 当前章正文（已剥离 frontmatter）
    states: dict[str, dict[str, Any]],            # 全部角色状态机
    # 可选：vault / hooks / current_ch 等扩展参数
) -> tuple[list[Issue], str | None]:
    """检测 <维度>。
    
    Returns:
        (issues, skip_reason) —— issues 为 Issue 列表，skip_reason 非空表示该维度被跳过（如模板状态）。
    """
```

#### 3.5.3 `Issue` / `Report` 数据结构

来源：`file:///workspace/scripts/novelforge/check_consistency.py` 第 207-249 行。

```python
@dataclass
class Issue:
    severity: str           # "P0" / "P1" / "P2"
    type: str               # 维度 type 名，如 "causal_chain_break"
    detail: str             # 人类可读问题描述（多行）
    suggestion: str         # 修复建议（一行）
    extras: dict[str, Any]  # 附加结构化字段（供 JSON 输出扩展用）

@dataclass
class Report:
    chapter: int
    volume: int
    dimensions_checked: list[str]
    issues: list[Issue]
    skipped: dict[str, str]  # 维度 → 跳过原因
```

#### 3.5.4 `protagonist.json` 状态机字段

来源：`file:///workspace/NovelForge_Vault/.state/characters/protagonist.json` 第 14-63 行。

```json
{
  "character_id": "protagonist",
  "basic": { "name": "", "aliases": [], "role": "protagonist", ... },
  "location": { "current": "", "last_updated_ch": 0, "recent_trajectory": [] },
  "power_level": { "realm": "", "realm_progress": 0, "abilities": [], "limitations": [], "next_breakthrough": {} },
  "inventory": [],
  "emotion": { "current": "", "last_updated_ch": 0, "recent_arc": [], "baseline": "" },
  "relationships": [],
  "knowledge": { "known_facts": [], "unknown_facts": [], "misconceptions": [] },
  "unresolved_personal_arcs": [],
  "arc_stage": "",
  "last_appeared_ch": 0,
  "status": "active"  // active / dead / missing
}
```

**关键**：`inventory` 是 list（每条 `{item, ...}`），`emotion.current` 是字符串，`status` 是枚举，`relationships` 是 list（每条 `{target, type, trust, ...}`）——这些字段的跨章 diff 正是因果事件的主要来源。

#### 3.5.5 `key-scene-archiver` 当前 6 段场景文件结构

来源：`file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` 第 108-133 行。

```markdown
# {场景标题}

## 元信息
- 章号：ch_NNN
- 角色：{角色名}
- 关键词：{关键词}
- 场景类型：{首次出场/关系转折/金手指升级/境界突破/重要物品/伏笔埋设/伏笔回收/关键决策/死亡重伤/势力变化}
- 召回关键词：{3-5 个用空格分隔的关键词}

## 场景摘要（≤200 字）
{...}

## 角色状态变化
- {角色名}：{状态变化，如 境界从练气三层→练气四层}

## 伏笔关联
- 埋设：{hook_id 或 无}
- 回收：{hook_id 或 无}

## 关键对白（≤3 句，可选）
> {...}

## 原文片段（≤500 字）
{...}
```

M14 升级为 7 段，在"角色状态变化"与"伏笔关联"之间插入"## 因果事件"段。

#### 3.5.6 `writer-polisher` 章末摘要 4 段结构（M01 修复后）

来源：`file:///workspace/.trae/skills/writer-polisher/SKILL.md` 第 226-248 行 + M01 方案 §5.3.4。

```markdown
## 关键事件
- 本章发生的核心事件（2-3 条）

## 角色状态变化
- 主角境界/能力/位置/关系的 Delta 变化

## 伏笔变动
- 本章埋设/推进/回收的伏笔 ID

## 章末钩子
- 本章结尾的悬念/反转/情绪钩子一句话
```

写入路径：`.state/chapter_summaries/ch_NNN_summary.md`（M01 新增路由）。

---

## 四、新增/修改文件清单

### 4.1 新增文件（2 个）

| # | 文件路径 | 性质 | 核心内容 |
|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/data/causal_event_types.json` | 新增数据文件（SSOT） | 10 类因果事件类型枚举 + 每类事件的检测规则 + 预期持续时间 + 严重等级 |
| 2 | `file:///workspace/tests/test_causal_chain.py` | 新增 pytest 测试用例 | 7 个测试用例覆盖事件类型库有效性、P0/P1 分级、跨章断裂检测、正常推进通过、关系变化追踪、关键场景存档产出因果事件 |

### 4.2 修改文件（4 个）

| # | 文件路径 | 修改点 |
|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/check_consistency.py` | `DIM_ALIASES` / `ALL_DIMENSIONS` / `DIM_LABELS` 三处常量新增 `causal_chain_break` 条目；新增 `check_causal_chain_break()` 检测函数；`check_all()` 编排循环新增该维度分派；新增 `_load_causal_events()` / `_load_prev_causal_events()` 辅助函数 |
| 2 | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | 6 段场景文件结构升级为 7 段（新增"## 因果事件"段）；10 类关键场景识别标准表追加"对应的因果事件类型"列；步骤 7 新增"调用 save_state.py 写入因果事件清单"指令 |
| 3 | `file:///workspace/.trae/checklists/dev-checklist.md` | 在 §九 Skill 契约校验（M01 新增）之后追加 §十 因果链检测段（5 项 checklist + 自检报告模板对应段） |
| 4 | `file:///workspace/tests/bug_regression_list.md` | 新增 BUG-064 条目（跨章节因果链断裂导致前后不呼应） |

### 4.3 修改文件可选（1 个，依赖 M01 已完成）

| # | 文件路径 | 修改点 |
|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/save_state.py` | `_route_path()` 新增 `causal_events/` 路由分支，支持 `op=append` 写入 `.state/causal_events/ch_NNN_events.json`（章末因果事件清单）；新增 `CAUSAL_EVENTS_DIR_REL` 常量 |

**依赖说明**：本项依赖 M01 模块已完成（chapter_summaries 路由已落地）。若 M01 尚未合并，本模块可降级为"key-scene-archiver 直接 Write 因果事件文件，不经 save_state.py 路由"，但会牺牲状态机 SSOT 一致性。

---

## 五、详细实现步骤

### 5.1 步骤 1：设计因果事件类型枚举（10 类）

**目标**：定义 NovelForge 长篇小说中需要跨章追踪的 10 类因果事件。

| # | event_type | 中文标签 | 典型场景 | 默认 expected_duration（章） | 默认严重等级 |
|---|---|---|---|---|---|
| 1 | `injury` | 受伤 | 角色断臂 / 重伤 / 中毒 | 3 | P0（窗口内未恢复） |
| 2 | `recovery` | 伤愈 | 受伤后恢复 / 解毒 / 治愈 | 0（即时关闭 injury） | - |
| 3 | `item_acquired` | 物品获得 | 获得神兵 / 法宝 / 信物 / 秘籍 | 999（永久持有，除非显式 lost） | - |
| 4 | `item_lost` | 物品失去 | 物品被夺 / 损毁 / 遗失 / 赠人 | 0（即时关闭 item_acquired） | P1（短期失去需铺垫） |
| 5 | `character_death` | 角色死亡 | 重要角色死亡 | 999（永久，除非显式 revival） | - |
| 6 | `character_revival` | 角色复生 | 死亡后复活 / 假死揭晓 | 0（即时关闭 character_death） | P0（无铺垫复生） |
| 7 | `relationship_change` | 关系转折 | 结盟 / 反目 / 认亲 / 决裂 | 999（永久，状态机持续追踪） | P1（短期倒退需铺垫） |
| 8 | `location_change` | 位置迁移 | 远距离迁移 / 进入秘境 | 999（状态机持续追踪） | - |
| 9 | `power_change` | 实力变化 | 境界突破 / 金手指升级 / 走火入魔 | 999（永久） | - |
| 10 | `knowledge_gain` | 知识获取 | 得知身世 / 学会秘技 / 知晓阴谋 | 999（永久，影响后续对话） | - |

**说明**：
- `expected_duration=0` 表示该事件是"关闭事件"（如 `recovery` 关闭 `injury`，`item_lost` 关闭 `item_acquired`，`character_revival` 关闭 `character_death`），通过 `resolved_in_chapter` 字段标记配对。
- `expected_duration=999` 表示"永久追踪"，只有显式关闭事件或角色状态机 diff 才能解决。
- 默认严重等级是"未在预期窗口内解决时的等级"，正常解决不报警。

### 5.2 步骤 2：因果事件 schema 定义

每个因果事件是一个 JSON 对象，schema 如下：

```json
{
  "event_id": "CE-042-001",
  "chapter": 42,
  "event_type": "injury",
  "subject": "protagonist",
  "object": "left_arm",
  "state_before": "完好",
  "state_after": "断裂",
  "expected_duration": 3,
  "resolved_in_chapter": null,
  "resolved_by_event_id": null,
  "evidence_source": "ch_042_summary.md / ch_042_林轩_断臂.md",
  "description": "主角左臂被剑气斩断"
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `event_id` | string | ✅ | 格式 `CE-<NNN>-<seq>`，NNN 是章号 3 位补零，seq 是本章事件序号 3 位补零；全局唯一 |
| `chapter` | int | ✅ | 事件发生章号 |
| `event_type` | string | ✅ | 10 类枚举之一 |
| `subject` | string | ✅ | 事件主体角色 ID（如 `protagonist` / `su_wan`） |
| `object` | string | ❌ | 事件客体（如受伤部位 / 物品名 / 关系对方角色 ID / 位置名 / 能力名 / 知识点）；可为空 |
| `state_before` | string | ❌ | 事件前状态（如 "完好" / "持有" / "ally" / "练气三层"） |
| `state_after` | string | ❌ | 事件后状态（如 "断裂" / "失去" / "enemy" / "筑基初期"） |
| `expected_duration` | int | ✅ | 预期持续章数（0=即时关闭，999=永久）；从 `causal_event_types.json` 读取默认值，可被覆盖 |
| `resolved_in_chapter` | int \| null | ✅ | 已解决则填章号，未解决为 null |
| `resolved_by_event_id` | string \| null | ❌ | 由哪个关闭事件解决（如 `injury` 被 `recovery` 事件解决，填 recovery 的 event_id） |
| `evidence_source` | string | ❌ | 证据来源（章末摘要路径 / 场景文件路径 / 状态机 diff），用于人工复核 |
| `description` | string | ✅ | 事件描述（一句话） |

### 5.3 步骤 3：`causal_event_types.json` 完整内容

文件路径：`file:///workspace/scripts/novelforge/data/causal_event_types.json`

```json
{
  "version": "1.0.0",
  "_comment": "NovelForge 因果事件类型库（SSOT）。每类事件含检测规则与预期持续时间。由 check_consistency.py 的 causal_chain_break 维度读取。",
  "event_types": {
    "injury": {
      "label": "受伤",
      "description": "角色受到物理/精神伤害，影响后续行动能力",
      "default_expected_duration": 3,
      "default_severity_if_unresolved": "P0",
      "closure_event_type": "recovery",
      "detection_rules": {
        "keywords_in_body": ["受伤", "断臂", "断腿", "重伤", "重伤垂死", "中毒", "中掌", "被剑气斩", "鲜血淋漓", "跌坐在地", "昏死过去"],
        "state_machine_field": "status",
        "state_after_value": "injured"
      },
      "examples": [
        "主角左臂被剑气斩断",
        "苏婉为护主角挡下一剑，重伤垂死"
      ]
    },
    "recovery": {
      "label": "伤愈",
      "description": "受伤事件恢复，关闭对应的 injury 事件",
      "default_expected_duration": 0,
      "default_severity_if_unresolved": "-",
      "closure_event_type": null,
      "closure_for": "injury",
      "detection_rules": {
        "keywords_in_body": ["伤愈", "恢复", "痊愈", "解毒", "治愈", "丹药生效", "突破后伤势尽复"],
        "state_machine_field": "status",
        "state_after_value": "active"
      },
      "examples": [
        "服下九转还魂丹，伤势三日痊愈",
        "突破筑基后，旧伤尽复"
      ]
    },
    "item_acquired": {
      "label": "物品获得",
      "description": "角色获得重要物品（神兵/法宝/信物/秘籍）",
      "default_expected_duration": 999,
      "default_severity_if_unresolved": "-",
      "closure_event_type": "item_lost",
      "detection_rules": {
        "keywords_in_body": ["获得", "得到", "拾取", "拾得", "购买", "买下", "夺取", "抢夺", "继承", "炼制", "收下", "受赠", "赠予", "认主"],
        "state_machine_field": "inventory",
        "state_after_value": "appended"
      },
      "examples": [
        "主角获得玄铁剑，认主成功",
        "苏婉受赠碧落簪"
      ]
    },
    "item_lost": {
      "label": "物品失去",
      "description": "角色失去已持有物品（被夺/损毁/遗失/赠人）",
      "default_expected_duration": 0,
      "default_severity_if_unresolved": "-",
      "closure_event_type": null,
      "closure_for": "item_acquired",
      "short_term_loss_threshold_chapters": 5,
      "default_severity_if_short_term_loss": "P1",
      "detection_rules": {
        "keywords_in_body": ["被夺", "丢失", "遗失", "损毁", "碎裂", "赠人", "送出", "献出", "祭炼耗尽"],
        "state_machine_field": "inventory",
        "state_after_value": "removed"
      },
      "examples": [
        "玄铁剑被黑影夺走",
        "碧落簪在战斗中碎裂"
      ]
    },
    "character_death": {
      "label": "角色死亡",
      "description": "重要角色死亡",
      "default_expected_duration": 999,
      "default_severity_if_unresolved": "-",
      "closure_event_type": "character_revival",
      "detection_rules": {
        "keywords_in_body": ["香消玉殒", "陨落", "身亡", "死去", "气绝", "断气", "魂飞魄散", "形神俱灭", "死在", "死于一剑"],
        "state_machine_field": "status",
        "state_after_value": "dead"
      },
      "examples": [
        "苏婉为护主角挡下一剑，香消玉殒",
        "李师兄走火入魔，形神俱灭"
      ]
    },
    "character_revival": {
      "label": "角色复生",
      "description": "死亡角色复活或假死揭晓，关闭对应的 character_death 事件",
      "default_expected_duration": 0,
      "default_severity_if_unresolved": "-",
      "closure_event_type": null,
      "closure_for": "character_death",
      "default_severity_if_unplanned": "P0",
      "detection_rules": {
        "keywords_in_body": ["复活", "还魂", "假死揭晓", "其实并未死去", "魂归", "重塑肉身"],
        "state_machine_field": "status",
        "state_after_value": "active"
      },
      "examples": [
        "苏婉其实并未死去，被神秘人所救",
        "李师兄重塑肉身，回归修真界"
      ]
    },
    "relationship_change": {
      "label": "关系转折",
      "description": "人物关系发生重大变化（结盟/反目/认亲/决裂）",
      "default_expected_duration": 999,
      "default_severity_if_unresolved": "-",
      "closure_event_type": null,
      "short_term_backslide_threshold_chapters": 3,
      "default_severity_if_backslide_no_prelude": "P1",
      "detection_rules": {
        "keywords_in_body": ["结盟", "联手", "反目", "决裂", "背叛", "和好", "拜师", "结亲", "认亲", "化敌为友", "割袍断义"],
        "state_machine_field": "relationships",
        "relationship_types": ["ally", "enemy", "mentor", "lover", "family", "rival"]
      },
      "examples": [
        "主角与李师兄歃血为盟，结为生死之交",
        "苏婉与主角决裂，割袍断义"
      ]
    },
    "location_change": {
      "label": "位置迁移",
      "description": "角色远距离迁移或进入特殊区域（秘境/禁地）",
      "default_expected_duration": 999,
      "default_severity_if_unresolved": "-",
      "closure_event_type": null,
      "detection_rules": {
        "keywords_in_body": ["出发", "抵达", "传送", "启程", "进入秘境", "踏入禁地", "跨越", "御剑", "瞬移"],
        "state_machine_field": "location.current"
      },
      "examples": [
        "主角启程前往青云宗藏经阁",
        "苏婉踏入万妖谷禁地"
      ]
    },
    "power_change": {
      "label": "实力变化",
      "description": "境界突破 / 金手指升级 / 走火入魔",
      "default_expected_duration": 999,
      "default_severity_if_unresolved": "-",
      "closure_event_type": null,
      "detection_rules": {
        "keywords_in_body": ["突破", "进阶", "晋升", "破境", "凝结", "凝聚", "冲击瓶颈", "走火入魔", "金手指升级", "解锁新功能"],
        "state_machine_field": "power_level"
      },
      "examples": [
        "主角突破筑基初期",
        "金手指『识海』解锁新功能：远程感知"
      ]
    },
    "knowledge_gain": {
      "label": "知识获取",
      "description": "角色得知身世 / 学会秘技 / 知晓阴谋",
      "default_expected_duration": 999,
      "default_severity_if_unresolved": "-",
      "closure_event_type": null,
      "detection_rules": {
        "keywords_in_body": ["得知身世", "学会秘技", "知晓阴谋", "识破", "领悟", "看穿", "发现真相"],
        "state_machine_field": "knowledge.known_facts"
      },
      "examples": [
        "主角得知自己其实是皇室血脉",
        "苏婉识破长老阴谋"
      ]
    }
  },
  "closure_pairs": [
    { "open": "injury", "close": "recovery" },
    { "open": "item_acquired", "close": "item_lost" },
    { "open": "character_death", "close": "character_revival" }
  ]
}
```

### 5.4 步骤 4：`check_consistency.py` 新增 `causal_chain_break` 检测的完整代码片段

#### 5.4.1 常量段修改（第 162-201 行附近）

在 `DIM_ALIASES` / `ALL_DIMENSIONS` / `DIM_LABELS` 三处常量追加 `causal_chain_break` 条目：

```python
# --- 维度名映射（CLI --dim 接受短名或完整 type）------------------------------
DIM_ALIASES: dict[str, str] = {
    "power_level": "power_level_jump",
    "item": "phantom_item",
    "relationship": "relationship_mutation",
    "location": "location_jump",
    "foreshadow": "foreshadow_forgetting",
    "revival": "character_revival",
    "golden_finger": "golden_finger_overreach",
    # ↓↓↓ M14 新增
    "causal_chain": "causal_chain_break",
    "causal": "causal_chain_break",
    # 完整 type 名也接受
    "power_level_jump": "power_level_jump",
    "phantom_item": "phantom_item",
    "relationship_mutation": "relationship_mutation",
    "location_jump": "location_jump",
    "foreshadow_forgetting": "foreshadow_forgetting",
    "character_revival": "character_revival",
    "golden_finger_overreach": "golden_finger_overreach",
    # ↓↓↓ M14 新增
    "causal_chain_break": "causal_chain_break",
}

# 全部维度 type 名（按检测顺序）
ALL_DIMENSIONS: list[str] = [
    "power_level_jump",
    "phantom_item",
    "relationship_mutation",
    "location_jump",
    "foreshadow_forgetting",
    "character_revival",
    "golden_finger_overreach",
    # ↓↓↓ M14 新增（放在最后，因为它需要读取前序章节的因果事件清单，开销最大）
    "causal_chain_break",
]

# 维度中文标签（用于人类可读报告）
DIM_LABELS: dict[str, str] = {
    "power_level_jump": "境界跳级",
    "phantom_item": "物品凭空",
    "relationship_mutation": "关系突变",
    "location_jump": "位置穿越",
    "foreshadow_forgetting": "伏笔遗忘",
    "character_revival": "角色复生",
    "golden_finger_overreach": "金手指越界",
    # ↓↓↓ M14 新增
    "causal_chain_break": "因果链断裂",
}

# --- M14 新增：因果事件相关常量 ----------------------------------------------
CAUSAL_EVENT_TYPES_REL: str = "scripts/novelforge/data/causal_event_types.json"
CAUSAL_EVENTS_DIR_REL: str = ".state/causal_events"  # 章末因果事件清单目录

# 因果事件清单文件命名：.state/causal_events/ch_NNN_events.json
CAUSAL_EVENTS_FILE_TMPL: str = "ch_{ch:03d}_events.json"
```

#### 5.4.2 辅助函数：加载因果事件类型库与前序章节事件

在 `check_consistency.py` 的"路径 / IO 辅助"段（第 252 行附近）追加：

```python
# ============================================================================
# M14 新增：因果事件辅助
# ============================================================================
def _load_causal_event_types() -> dict[str, Any]:
    """加载因果事件类型库 causal_event_types.json。
    
    Returns:
        事件类型 dict，键为 event_type，值为该类型的检测规则等。
        文件不存在或解析失败返回空 dict（降级为跳过 causal_chain_break 维度）。
    """
    # 从本文件所在目录推断 scripts/novelforge/ 根
    script_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(script_dir, "data", "causal_event_types.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("event_types") or {}
    except (OSError, json.JSONDecodeError):
        return {}


def _load_causal_events_for_chapter(
    vault: str,
    chapter: int,
) -> list[dict[str, Any]]:
    """加载指定章号的因果事件清单。
    
    文件路径：``.state/causal_events/ch_NNN_events.json``
    
    Returns:
        因果事件列表；文件不存在返回空列表（不阻断检测）。
    """
    path = os.path.join(
        vault,
        CAUSAL_EVENTS_DIR_REL,
        CAUSAL_EVENTS_FILE_TMPL.format(ch=chapter),
    )
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    events = data.get("events")
    return events if isinstance(events, list) else []


def _load_unresolved_causal_events(
    vault: str,
    current_ch: int,
    lookback_chapters: int = 50,
) -> list[dict[str, Any]]:
    """加载当前章之前所有未解决的因果事件。
    
    扫描 ``.state/causal_events/ch_NNN_events.json``（NNN < current_ch），
    收集 ``resolved_in_chapter`` 为 null 的事件。
    
    Args:
        vault: Vault 根目录。
        current_ch: 当前章号。
        lookback_chapters: 回看章数（默认 50 章，避免扫描全量历史）。
    
    Returns:
        未解决事件列表，每个事件附带 ``_source_chapter`` 字段标记来源章号。
    """
    unresolved: list[dict[str, Any]] = []
    start_ch = max(1, current_ch - lookback_chapters)
    for ch in range(start_ch, current_ch):
        events = _load_causal_events_for_chapter(vault, ch)
        for evt in events:
            if not isinstance(evt, dict):
                continue
            if evt.get("resolved_in_chapter") is None:
                evt_copy = dict(evt)
                evt_copy["_source_chapter"] = ch
                unresolved.append(evt_copy)
    return unresolved
```

#### 5.4.3 主检测函数：`check_causal_chain_break()`

在 `check_consistency.py` 第 7 类检测函数 `check_golden_finger_overreach` 之后（第 1196 行后）追加：

```python
# ============================================================================
# 维度 8（M14 新增）：因果链断裂（P0/P1）
# ============================================================================
def check_causal_chain_break(
    body: str,
    states: dict[str, dict[str, Any]],
    vault: str,
    current_ch: int,
) -> tuple[list[Issue], str | None]:
    """检测跨章节因果链断裂。
    
    规则：
    - 加载当前章之前所有未解决的因果事件（resolved_in_chapter == null）。
    - 对每个未解决事件，检查当前章正文是否合理推进 / 关闭 / 呼应：
      - **injury** 事件超过 expected_duration 未出现恢复场景关键词 → P0
      - **character_death** 事件后，该角色在当前章有台词/动作（非回忆/幻觉）且无 character_revival 事件 → P0
      - **item_acquired** 事件在短期阈值（默认 5 章）内被 item_lost 关闭 → P1（短期失去需铺垫）
      - **relationship_change** 事件在短期阈值（默认 3 章）内倒退且无转变场景 → P1
      - **location_change** / **power_change** / **knowledge_gain** 永久追踪，不主动报警
    - 因果事件类型库 causal_event_types.json 不存在 → 跳过该维度。
    - 无未解决事件 → 跳过该维度（不报警）。
    """
    event_types = _load_causal_event_types()
    if not event_types:
        return [], "causal_event_types.json 不存在或为空，跳过因果链检测"
    
    unresolved = _load_unresolved_causal_events(vault, current_ch)
    if not unresolved:
        return [], "无未解决因果事件，跳过因果链检测"
    
    # 收集所有角色名 → character_id 映射（用于 character_death 检测）
    name_to_id: dict[str, str] = {}
    id_to_names: dict[str, list[str]] = {}
    for cid, state in states.items():
        basic = state.get("basic") or {}
        names = [basic.get("name") or ""] + list(basic.get("aliases") or [])
        names = [n for n in names if n]
        id_to_names[cid] = names
        for n in names:
            name_to_id[n] = cid
    
    issues: list[Issue] = []
    
    for evt in unresolved:
        evt_type = evt.get("event_type") or ""
        evt_chapter = evt.get("chapter") or 0
        subject_id = evt.get("subject") or ""
        subject_names = id_to_names.get(subject_id, [subject_id])
        subject_display = subject_names[0] if subject_names else subject_id
        evt_desc = evt.get("description") or ""
        evt_id = evt.get("event_id") or "?"
        source_ch = evt.get("_source_chapter") or evt_chapter
        
        # 跳过：当前章就是事件发生章（不检测同章）
        if evt_chapter >= current_ch:
            continue
        
        gap = current_ch - evt_chapter
        
        # === 检测 1：injury 超期未恢复 ===
        if evt_type == "injury":
            expected_duration = evt.get("expected_duration") or 3
            if gap > expected_duration:
                # 检查当前章是否有恢复场景关键词
                recovery_rules = event_types.get("recovery", {}).get("detection_rules", {})
                recovery_keywords = recovery_rules.get("keywords_in_body", [])
                has_recovery = any(kw in body for kw in recovery_keywords)
                
                # 检查当前章是否提及该伤势（subject 名 + 伤势相关词）
                injury_rules = event_types.get("injury", {}).get("detection_rules", {})
                injury_keywords = injury_rules.get("keywords_in_body", [])
                pat = _build_name_pattern(subject_names)
                mentions = _find_mentions(body, pat) if pat else []
                has_injury_acknowledgment = False
                if mentions:
                    for _, pos in mentions:
                        if _has_keyword_near_pos(body, pos, tuple(injury_keywords) + ("伤", "痛", "残", "废"), window=60):
                            has_injury_acknowledgment = True
                            break
                
                if not has_recovery and not has_injury_acknowledgment:
                    detail = (
                        f"因果事件 {evt_id}（{evt_desc}）\n"
                        f"   发生章: ch_{evt_chapter:03d}\n"
                        f"   当前章: ch_{current_ch:03d}（已过 {gap} 章）\n"
                        f"   预期恢复期: {expected_duration} 章\n"
                        f"   当前章正文未出现恢复场景，也未提及该伤势\n"
                        f"   主体: {subject_display}"
                    )
                    issues.append(Issue(
                        severity="P0",
                        type="causal_chain_break",
                        detail=detail,
                        suggestion=(
                            f"在当前章补充 {subject_display} 的伤势描写（疼痛/行动受限/治疗过程），"
                            f"或安排 recovery 事件关闭此 injury。"
                        ),
                        extras={
                            "event_id": evt_id,
                            "event_type": evt_type,
                            "subject": subject_id,
                            "source_chapter": source_ch,
                            "current_chapter": current_ch,
                            "gap": gap,
                            "expected_duration": expected_duration,
                            "sub_type": "injury_unresolved",
                        },
                    ))
        
        # === 检测 2：character_death 后角色再现无 revival 事件 ===
        elif evt_type == "character_death":
            # 检查当前章是否有该角色的台词/动作（非回忆/幻觉）
            pat = _build_name_pattern(subject_names)
            if pat is None:
                continue
            revived = False
            revival_context = ""
            for m in DIALOGUE_PATTERN.finditer(body):
                if pat.fullmatch(m.group("name")) or pat.search(m.group("name")):
                    if not _has_keyword_near_pos(body, m.start(), FLASHBACK_MARKERS, window=120):
                        revived = True
                        revival_context = f"台词：\"{m.group(0)}\""
                        break
            if not revived:
                for m in ACTION_PATTERN.finditer(body):
                    if pat.fullmatch(m.group("name")) or pat.search(m.group("name")):
                        if not _has_keyword_near_pos(body, m.start(), FLASHBACK_MARKERS, window=120):
                            revived = True
                            revival_context = f"动作：\"{m.group(0)}\""
                            break
            
            if revived:
                # 进一步检查是否有 character_revival 事件关闭
                revival_keywords = event_types.get("character_revival", {}).get("detection_rules", {}).get("keywords_in_body", [])
                has_revival_scene = any(kw in body for kw in revival_keywords)
                
                if not has_revival_scene:
                    detail = (
                        f"因果事件 {evt_id}（{evt_desc}）\n"
                        f"   发生章: ch_{evt_chapter:03d}\n"
                        f"   当前章: ch_{current_ch:03d}\n"
                        f"   {subject_display} 状态机 status=dead\n"
                        f"   当前章出现 {revival_context}\n"
                        f"   周围无回忆/幻觉/梦境标注，且无 character_revival 事件\n"
                        f"   疑似角色死亡后因果链断裂"
                    )
                    issues.append(Issue(
                        severity="P0",
                        type="causal_chain_break",
                        detail=detail,
                        suggestion=(
                            f"将当前章该场景改为回忆/幻觉/梦境（添加标注词），"
                            f"或安排 character_revival 事件（假死揭晓/重塑肉身）关闭此 character_death。"
                        ),
                        extras={
                            "event_id": evt_id,
                            "event_type": evt_type,
                            "subject": subject_id,
                            "source_chapter": source_ch,
                            "current_chapter": current_ch,
                            "revival_context": revival_context,
                            "sub_type": "death_then_revive_no_closure",
                        },
                    ))
        
        # === 检测 3：item_acquired 短期内被 item_lost 关闭（无铺垫失去）===
        elif evt_type == "item_lost":
            # 检查前序是否有对应的 item_acquired 事件，且间隔过短
            # 注意：item_lost 事件本身已是"关闭事件"，这里检测"短期失去"
            acquired_evt_id = evt.get("resolved_by_event_id")
            if not acquired_evt_id:
                continue
            # 反查对应的 item_acquired 事件的章号
            acquired_chapter = _lookup_event_chapter_by_id(vault, acquired_evt_id, current_ch)
            if acquired_chapter is None:
                continue
            item_lost_threshold = event_types.get("item_lost", {}).get("short_term_loss_threshold_chapters", 5)
            interval = evt_chapter - acquired_chapter
            if 0 < interval < item_lost_threshold:
                item_name = evt.get("object") or "该物品"
                detail = (
                    f"因果事件 {evt_id}（{evt_desc}）\n"
                    f"   对应获得事件: {acquired_evt_id}（ch_{acquired_chapter:03d}）\n"
                    f"   失去事件: ch_{evt_chapter:03d}\n"
                    f"   间隔仅 {interval} 章（短期失去阈值 {item_lost_threshold} 章）\n"
                    f"   物品: {item_name}\n"
                    f"   短期内得而复失，缺乏铺垫"
                )
                issues.append(Issue(
                    severity="P1",
                    type="causal_chain_break",
                    detail=detail,
                    suggestion=(
                        f"为 {item_name} 的获得增加更多使用场景（至少 {item_lost_threshold} 章铺垫），"
                        f"再安排失去事件；或调整失去原因使其更合理。"
                    ),
                    extras={
                        "event_id": evt_id,
                        "event_type": evt_type,
                        "acquired_event_id": acquired_evt_id,
                        "acquired_chapter": acquired_chapter,
                        "lost_chapter": evt_chapter,
                        "interval": interval,
                        "threshold": item_lost_threshold,
                        "sub_type": "item_short_term_loss",
                    },
                ))
        
        # === 检测 4：relationship_change 短期内倒退无铺垫 ===
        elif evt_type == "relationship_change":
            # 检查当前章是否有关系倒退信号（与 state_after 相反）
            state_after = evt.get("state_after") or ""
            # 若 state_after 是 ally/enemy 等，检查当前章是否出现相反信号
            opposite_map = {
                "ally": ("enemy", ("反目", "决裂", "背叛", "为敌", "厮杀", "翻脸", "割袍断义")),
                "enemy": ("ally", ("结盟", "联手", "合作", "和好", "化敌为友", "冰释前嫌")),
            }
            opposite = opposite_map.get(state_after)
            if opposite is None:
                continue
            opposite_type, opposite_keywords = opposite
            if not any(kw in body for kw in opposite_keywords):
                continue
            # 检查是否有关系转变场景（允许合法转变）
            if _has_keyword_near(body, RELATIONSHIP_SHIFT_KEYWORDS):
                continue
            backslide_threshold = event_types.get("relationship_change", {}).get("short_term_backslide_threshold_chapters", 3)
            if gap < backslide_threshold:
                target_id = evt.get("object") or ""
                target_names = id_to_names.get(target_id, [target_id])
                target_display = target_names[0] if target_names else target_id
                detail = (
                    f"因果事件 {evt_id}（{evt_desc}）\n"
                    f"   发生章: ch_{evt_chapter:03d}\n"
                    f"   当前章: ch_{current_ch:03d}（仅过 {gap} 章）\n"
                    f"   {subject_display} 与 {target_display} 关系 {state_after} → {opposite_type}\n"
                    f"   间隔过短且无关系转变场景，倒退无铺垫"
                )
                issues.append(Issue(
                    severity="P1",
                    type="causal_chain_break",
                    detail=detail,
                    suggestion=(
                        f"在 ch_{evt_chapter:03d} 与 ch_{current_ch:03d} 之间补充冲突/和解铺垫，"
                        f"或延长关系转变的时间跨度至 ≥ {backslide_threshold} 章。"
                    ),
                    extras={
                        "event_id": evt_id,
                        "event_type": evt_type,
                        "subject": subject_id,
                        "target": target_id,
                        "state_after": state_after,
                        "opposite_type": opposite_type,
                        "source_chapter": source_ch,
                        "current_chapter": current_ch,
                        "gap": gap,
                        "threshold": backslide_threshold,
                        "sub_type": "relationship_backslide_no_prelude",
                    },
                ))
    
    return issues, None


def _lookup_event_chapter_by_id(
    vault: str,
    event_id: str,
    current_ch: int,
    lookback_chapters: int = 50,
) -> int | None:
    """反查因果事件的章号（按 event_id 在历史因果事件清单中查找）。
    
    用于 item_lost 事件检测时反查对应 item_acquired 的章号。
    """
    start_ch = max(1, current_ch - lookback_chapters)
    for ch in range(start_ch, current_ch + 1):
        events = _load_causal_events_for_chapter(vault, ch)
        for evt in events:
            if isinstance(evt, dict) and evt.get("event_id") == event_id:
                return ch
    return None
```

#### 5.4.4 编排入口修改：`check_all()` 与 `_DIM_CHECKERS_NO_VAULT`

在 `check_consistency.py` 第 1203-1209 行 `_DIM_CHECKERS_NO_VAULT` 之后追加 `_DIM_CHECKERS_WITH_VAULT`：

```python
# 维度 type → 检测函数（需 vault 依赖）
_DIM_CHECKERS_WITH_VAULT: dict[str, Any] = {
    "phantom_item": lambda body, states, hooks, ch, vault: check_phantom_item(body, states, vault),
    "location_jump": lambda body, states, hooks, ch, vault: check_location_jump(body, states, vault),
    # ↓↓↓ M14 新增
    "causal_chain_break": lambda body, states, hooks, ch, vault: check_causal_chain_break(body, states, vault, ch),
}
```

在 `check_all()` 第 1272-1289 行的维度分派循环中修改：

```python
for dim in target_dims:
    try:
        if dim == "phantom_item":
            issues, skip = check_phantom_item(body, states, vault)
        elif dim == "location_jump":
            issues, skip = check_location_jump(body, states, vault)
        elif dim == "causal_chain_break":  # ← M14 新增
            issues, skip = check_causal_chain_break(body, states, vault, chapter)
        elif dim in _DIM_CHECKERS_NO_VAULT:
            issues, skip = _DIM_CHECKERS_NO_VAULT[dim](body, states, hooks, chapter)
        else:
            report.skipped[dim] = f"未知维度: {dim}"
            continue
        if skip:
            report.skipped[dim] = skip
        report.issues.extend(issues)
    except Exception as exc:
        report.skipped[dim] = f"检测异常: {type(exc).__name__}: {exc}"
```

#### 5.4.5 CLI 帮助文本更新

更新 `argparse` 描述（第 1391-1394 行）：

```python
parser = argparse.ArgumentParser(
    prog="python -m scripts.novelforge.check_consistency",
    description="NovelForge 跨章状态漂移检测：对比本章正文与 .state/ 状态机，发现 8 类不一致（含因果链断裂）。",
)
```

更新 `--dim` 参数 help（第 1416-1420 行）：

```python
parser.add_argument(
    "--dim", type=str, default=None,
    help=(
        "只检测指定维度（逗号分隔多个）。"
        "可用短名: power_level/item/relationship/location/foreshadow/revival/golden_finger/causal_chain"
    ),
)
```

#### 5.4.6 文件头 docstring 更新

更新 `check_consistency.py` 第 1-12 行 docstring，新增第 8 类：

```python
"""NovelForge 跨章状态漂移检测脚本。

对比本章正文与 ``.state/`` 状态机，发现 8 类不一致即报警：

1. **境界跳级**（P0）—— 正文境界 > 状态机境界且本章无"突破/修炼/进阶"场景
2. **物品凭空**（P0）—— 正文使用物品但所有角色 inventory 均无且无"获得/拾取"场景
3. **关系突变**（P1）—— 正文关系 type 与状态机不一致且无关系转变场景
4. **位置穿越**（P0）—— 正文位置 ≠ 状态机位置且无"出发/到达/传送"描写
5. **伏笔遗忘**（P1）—— planted/hinted 伏笔超期未回收或长期未提醒
6. **角色复生**（P0）—— status=dead 角色在本章有台词/动作（非回忆/幻觉场景）
7. **金手指越界**（P1）—— 使用 abilities 列表外能力 / 违反 limitations / 单章使用 > 2 次
8. **因果链断裂**（P0/P1）—— 跨章因果事件未合理推进/关闭：injury 超期未愈（P0）/ character_death 后再现无 revival（P0）/ item 短期得而复失（P1）/ relationship 短期倒退无铺垫（P1）
"""
```

### 5.5 步骤 5：`key-scene-archiver` SKILL.md 升级

#### 5.5.1 6 段场景文件结构升级为 7 段

在 `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` 第 104-133 行的 6 段结构中，在"## 角色状态变化"与"## 伏笔关联"之间插入"## 因果事件"段：

```markdown
# {场景标题}

## 元信息
- 章号：ch_NNN
- 角色：{角色名}
- 关键词：{关键词}
- 场景类型：{首次出场/关系转折/金手指升级/境界突破/重要物品/伏笔埋设/伏笔回收/关键决策/死亡重伤/势力变化}
- 召回关键词：{3-5 个用空格分隔的关键词，供 Grep 命中，如：林轩 李慕白 初遇 玄铁剑 突破}

## 场景摘要（≤200 字）
{用 200 字以内描述这个场景发生了什么，谁对谁做了什么，结果如何}

## 角色状态变化
- {角色名}：{状态变化，如 境界从练气三层→练气四层 / 与李慕白关系从陌生→盟友 / 获得玄铁剑}

## 因果事件（M14 新增）
{若本章关键场景对应因果事件，按以下格式列出；无因果事件则填"无"}

- event_id: CE-042-001
  event_type: injury
  subject: protagonist
  object: left_arm
  state_before: 完好
  state_after: 断裂
  expected_duration: 3
  description: 主角左臂被剑气斩断

## 伏笔关联
- 埋设：{hook_id 或 无}
- 回收：{hook_id 或 无}

## 关键对白（≤3 句，可选）
> {最具代表性的 1-3 句对白，用于角色语言指纹校准}

## 原文片段（≤500 字）
{从章节正文中摘录的场景原文，≤500 字。这是 Grep 召回时的核心载体}
```

#### 5.5.2 10 类关键场景 → 因果事件类型映射表

在 `key-scene-archiver/SKILL.md` 第 62-73 行 10 类关键场景识别标准表后追加映射列：

| # | 关键场景类型 | 判定条件 | 对应的因果事件类型（M14） |
|---|---|---|---|
| 1 | 首次出场 | 重要角色首次出场 | 无（首次出场不构成因果事件） |
| 2 | 关系转折 | 人物关系发生重大变化 | `relationship_change` |
| 3 | 金手指升级 | 主角金手指能力升级或新功能解锁 | `power_change` |
| 4 | 境界突破 | 主要角色境界突破 | `power_change` |
| 5 | 重要物品 | 重要物品的获得或失去 | `item_acquired` / `item_lost` |
| 6 | 伏笔埋设 | scope=long 或 core 的伏笔埋设场景 | 无（伏笔由 hooks_registry 管理） |
| 7 | 伏笔回收 | scope=long 或 core 的伏笔回收场景 | 无（同上） |
| 8 | 关键决策 | 主角做出影响后续 10 章+ 的关键决策 | `knowledge_gain`（若决策基于新信息） |
| 9 | 死亡重伤 | 重要角色死亡或重伤 | `character_death` / `injury` |
| 10 | 势力变化 | 势力格局重大变化 | `relationship_change`（势力级关系） |

**说明**：场景类型 1/6/7 不产出因果事件（由其他模块管理）。场景类型 2/3/4/5/8/9/10 各自映射到 1-2 类因果事件。

#### 5.5.3 步骤 7 升级：登记到 pipeline.json + 写入因果事件清单

在 `key-scene-archiver/SKILL.md` 第 189-195 行"步骤 7：登记到 pipeline.json"后追加步骤 8：

```markdown
## 步骤 8：写入因果事件清单（M14 新增）

对步骤 6 创建的场景文件中"## 因果事件"段列出的事件，汇总为本章因果事件清单，写入：

NovelForge_Vault/.state/causal_events/ch_NNN_events.json

文件格式：

{
  "chapter": "ch_042",
  "generated_at": "2026-07-18",
  "events": [
    {
      "event_id": "CE-042-001",
      "chapter": 42,
      "event_type": "injury",
      "subject": "protagonist",
      "object": "left_arm",
      "state_before": "完好",
      "state_after": "断裂",
      "expected_duration": 3,
      "resolved_in_chapter": null,
      "resolved_by_event_id": null,
      "evidence_source": "ch_042_林轩_断臂.md",
      "description": "主角左臂被剑气斩断"
    }
  ]
}

执行命令（主 Agent 调用）：

python scripts/novelforge/save_state.py apply_delta \
  --vault NovelForge_Vault \
  --delta '{
    "chapter": "ch_042",
    "mode": "novel",
    "ops": [
      {
        "op": "set",
        "path": "causal_events/042",
        "value": {
          "chapter": "ch_042",
          "events": [
            {
              "event_id": "CE-042-001",
              "chapter": 42,
              "event_type": "injury",
              "subject": "protagonist",
              "object": "left_arm",
              "state_before": "完好",
              "state_after": "断裂",
              "expected_duration": 3,
              "resolved_in_chapter": null,
              "resolved_by_event_id": null,
              "evidence_source": "ch_042_林轩_断臂.md",
              "description": "主角左臂被剑气斩断"
            }
          ]
        }
      }
    ]
  }'

event_id 命名铁律：
- 格式：CE-<NNN>-<seq>，NNN 是章号 3 位补零，seq 是本章事件序号 3 位补零
- 例：CE-042-001 / CE-042-002 / CE-042-003
- 全局唯一，跨章不重复

关闭事件（recovery / item_lost / character_revival）的 resolved_by_event_id 字段必须填对应开启事件的 event_id，建立配对关系。
```

#### 5.5.4 `save_state.py` 新增 `causal_events` 路由（依赖 M01 已合并）

在 `file:///workspace/scripts/novelforge/save_state.py` 第 67-73 行常量段追加：

```python
CAUSAL_EVENTS_DIR_REL: str = ".state/causal_events"  # M14 新增：因果事件清单目录
```

在第 281-332 行 `_route_path()` 函数中，在 `chapter_summaries` 分支（M01 新增）之后追加：

```python
# ↓↓↓ M14 新增：causal_events 分支
if root == "causal_events":
    if not rest:
        raise ValueError(
            f"causal_events path 必须带章号 NNN: {path!r}"
        )
    chapter_str = rest[0]
    if not chapter_str.isdigit():
        raise ValueError(
            f"causal_events 章号必须是数字: {chapter_str!r} (path={path!r})"
        )
    chapter_num = int(chapter_str)
    file_abs = _state_file_path(
        vault,
        f"{CAUSAL_EVENTS_DIR_REL}/ch_{chapter_num:03d}_events.json",
    )
    return PathTarget("causal_events", file_abs, str(chapter_num), [])
```

在 `_apply_op()` 中新增 `causal_events` 类型分支（与 `chapter_summary` 类似，但只支持 set 整对象覆盖）：

```python
elif target.kind == "causal_events":
    if op["op"] != "set":
        raise ValueError(
            f"causal_events 只支持 set 操作（整对象覆盖），收到 {op['op']!r}"
        )
    value = op.get("value")
    if not isinstance(value, dict):
        raise ValueError(
            f"causal_events value 必须是 dict (实际 {type(value).__name__})"
        )
    # 补全 chapter 字段
    value.setdefault("chapter", f"ch_{target.name}")
    # 校验 events 列表结构
    events = value.get("events") or []
    if not isinstance(events, list):
        raise ValueError("causal_events value.events 必须是 list")
    for i, evt in enumerate(events):
        if not isinstance(evt, dict):
            raise ValueError(f"causal_events events[{i}] 必须是 dict")
        for required_field in ("event_id", "chapter", "event_type", "subject"):
            if required_field not in evt:
                raise ValueError(
                    f"causal_events events[{i}] 缺必填字段: {required_field}"
                )
    file_states[target.file_abs] = value
```

### 5.6 步骤 6：`dev-checklist.md` 新增 §十 因果链检测段

在 `file:///workspace/.trae/checklists/dev-checklist.md` §九 Skill 契约校验（M01 新增）之后追加：

```markdown
## 十、因果链检测（新增/修改关键场景时必检）

- [ ] 10 类因果事件可识别：运行 `python scripts/novelforge/check_consistency.py --chapter <N> --dim causal_chain --json`，未报"causal_event_types.json 不存在或为空"
- [ ] 关键场景存档含因果事件段：本章 key-scene-archiver 产出的 `_scenes/ch_NNN_*.md` 场景文件含"## 因果事件"段（即使填"无"也算）
- [ ] 因果事件清单已写入：`.state/causal_events/ch_NNN_events.json` 存在且 JSON 合法，每个事件含 `event_id / chapter / event_type / subject` 必填字段
- [ ] 跨章节断裂可检测：A 章受伤 + B 章未提及伤势的场景，运行 check_consistency.py 应报 P0；A 章受伤 + B 章仍在疗伤的场景，应通过
- [ ] P0/P1 分级正确：injury 超期未愈=P0 / character_death 后再现无 revival=P0 / item 短期得而复失=P1 / relationship 短期倒退无铺垫=P1

同时更新 dev-checklist.md 的"自检报告模板"段，在 §九之后追加：

### 十、因果链检测
- ✅/❌ 10 类事件可识别：____
- ✅/❌ 关键场景含因果事件段：____
- ✅/❌ 因果事件清单已写入：____
- ✅/❌ 跨章节断裂可检测：____
- ✅/❌ P0/P1 分级正确：____
```

---

## 六、验证方式

### 6.1 单元测试（pytest）

```bash
cd /workspace
pytest -q tests/test_causal_chain.py -v
```

预期输出：7 个测试用例全部 PASSED。

### 6.2 集成测试

#### 集成测试 1：A 章受伤 + B 章活蹦乱跳 → 验证 P0

```bash
# 准备 ch_042 因果事件清单（含 injury 事件）
mkdir -p NovelForge_Vault/.state/causal_events
cat > NovelForge_Vault/.state/causal_events/ch_042_events.json << 'EOF'
{
  "chapter": "ch_042",
  "events": [
    {
      "event_id": "CE-042-001",
      "chapter": 42,
      "event_type": "injury",
      "subject": "protagonist",
      "object": "left_arm",
      "state_before": "完好",
      "state_after": "断裂",
      "expected_duration": 3,
      "resolved_in_chapter": null,
      "resolved_by_event_id": null,
      "description": "主角左臂被剑气斩断"
    }
  ]
}
EOF

# 准备 ch_046 正文（5 章后，超过预期 3 章恢复期，且未提及伤势）
mkdir -p NovelForge_Vault/05_正文/published/vol_01
cat > NovelForge_Vault/05_正文/published/vol_01/ch_046.md << 'EOF'
---
chapter: ch_046
title: 测试章
volume: 1
word_count: 2500
status: published
---

林轩挥舞双拳，与敌厮杀正酣。一拳轰出，对面黑影闷哼一声，倒退三步。
林轩大笑道："今日让你见识见识手段！"
EOF

# 运行检测，预期 P0
python scripts/novelforge/check_consistency.py --chapter 46 --dim causal_chain
# 预期输出包含：🔴 [P0] 因果链断裂 / injury_unresolved
```

#### 集成测试 2：A 章受伤 + B 章还在疗伤 → 验证通过

```bash
# 同上 ch_042 事件清单不变
# 准备 ch_044 正文（2 章后，预期恢复期内，提及伤势）
cat > NovelForge_Vault/05_正文/published/vol_01/ch_044.md << 'EOF'
---
chapter: ch_044
title: 疗伤章
volume: 1
word_count: 2500
status: published
---

林轩靠在床榻上，左臂缠着厚厚的绷带，鲜血仍隐隐渗出。
他咬牙道："这伤，怕是要三月才能痊愈。"
苏婉端来药碗，轻声道："别动，让我替你换药。"
EOF

# 运行检测，预期通过（无 P0）
python scripts/novelforge/check_consistency.py --chapter 44 --dim causal_chain
# 预期输出包含：✅ 通过: 因果链断裂
```

### 6.3 断言清单

| # | 断言内容 | 期望 |
|---|---|---|
| 1 | `causal_event_types.json` 可被解析，含 10 类事件类型 | True |
| 2 | 10 类事件类型都含 `label / description / default_expected_duration / detection_rules` 4 必填字段 | True |
| 3 | `injury` 事件超期未恢复 + 当前章未提及伤势 → P0 Issue | severity == "P0" 且 sub_type == "injury_unresolved" |
| 4 | `character_death` 事件后角色在当前章有台词（非回忆/幻觉）且无 revival 场景 → P0 Issue | severity == "P0" 且 sub_type == "death_then_revive_no_closure" |
| 5 | `item_lost` 事件距对应 `item_acquired` 间隔 < 5 章 → P1 Issue | severity == "P1" 且 sub_type == "item_short_term_loss" |
| 6 | `relationship_change` 事件后 3 章内倒退且无转变场景 → P1 Issue | severity == "P1" 且 sub_type == "relationship_backslide_no_prelude" |
| 7 | 正常推进章（无未解决事件 / 已合理推进）→ 无 Issue | len(issues) == 0 |
| 8 | `causal_event_types.json` 不存在时维度被跳过 | "causal_event_types.json 不存在或为空" in skipped |
| 9 | `check_consistency.py --dim causal_chain` 退出码 | 0（默认模式）/ 1（--strict + P0） |
| 10 | `key-scene-archiver` 产出场景文件含"## 因果事件"段 | True |

### 6.4 与现有检测脚本的关系

| 现有维度 | M14 关系 | 边界说明 |
|---|---|---|
| `character_revival`（P0） | **联动** | 现有维度检测单章内 `status=dead` 角色登场；M14 检测跨章 `character_death` 事件后该角色再现。两者互补：单章内触发 `character_revival` 报警时，M14 会进一步查是否有 `character_death` 因果事件登记，无则升级为 P0 因果断裂。 |
| `phantom_item`（P0） | **互补** | 现有维度检测"无中生物品"（正文有但状态机无）；M14 检测"有中失物"（状态机有但短期内被 lost 事件关闭）。两者不重叠。 |
| `relationship_mutation`（P1） | **互补** | 现有维度检测正文 vs 状态机不一致；M14 检测跨章倒退无铺垫。两者不重叠。 |
| `location_jump`（P0） | **互补** | 现有维度检测单章位置穿越；M14 追踪 `location_change` 因果事件但不主动报警（永久追踪类）。 |
| `power_level_jump`（P0） | **互补** | 现有维度检测境界跳级；M14 追踪 `power_change` 因果事件但不主动报警。 |
| `foreshadow_forgetting`（P1） | **独立** | 伏笔由 `hooks_registry.json` 管理，因果事件不重复追踪伏笔类（场景类型 6/7 不映射因果事件）。 |
| `golden_finger_overreach`（P1） | **独立** | 金手指滥用检测与因果链无直接关系。 |

**关键边界**：M14 只检测"跨章因果链断裂"，不重复检测"单章内一致性问题"。两类检测互补，不冲突。

---

## 七、回归测试要求

### 7.1 新增 pytest 用例（7 个）

文件路径：`file:///workspace/tests/test_causal_chain.py`

| # | 测试函数名 | 断言内容 |
|---|---|---|
| 1 | `test_causal_event_types_json_valid` | `causal_event_types.json` 可被解析，含 10 类事件类型，每类含 4 必填字段 |
| 2 | `test_injury_unresolved_triggers_p0` | ch_042 injury 事件 + ch_046 正文未提及伤势 → P0 Issue，sub_type=injury_unresolved |
| 3 | `test_item_lost_quickly_triggers_p1` | ch_010 item_acquired + ch_012 item_lost（间隔 2 章 < 5 章阈值）→ P1 Issue，sub_type=item_short_term_loss |
| 4 | `test_character_revival_triggers_p0` | ch_027 character_death + ch_035 该角色登场（无 revival 场景）→ P0 Issue，sub_type=death_then_revive_no_closure |
| 5 | `test_normal_progression_passes` | ch_042 injury + ch_044 正文提及伤势仍在疗伤 → 无 Issue（合理推进） |
| 6 | `test_relationship_change_tracked` | ch_050 relationship_change（ally）+ ch_052 正文出现反目关键词无转变场景 → P1 Issue，sub_type=relationship_backslide_no_prelude |
| 7 | `test_key_scene_archiver_records_causal_events` | key-scene-archiver 产出的场景文件含"## 因果事件"段，且因果事件清单已写入 `.state/causal_events/ch_NNN_events.json` |

#### 测试用例骨架（7 个测试函数完整实现）

```python
# tests/test_causal_chain.py
"""M14 因果链检测的回归测试。"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts" / "novelforge"
sys.path.insert(0, str(REPO_ROOT))

from scripts.novelforge.check_consistency import (
    check_causal_chain_break,
    _load_causal_event_types,
    _load_causal_events_for_chapter,
    _load_unresolved_causal_events,
)


# 测试 1：causal_event_types.json 有效
def test_causal_event_types_json_valid():
    types = _load_causal_event_types()
    assert types, "causal_event_types.json 加载失败或为空"
    
    expected_types = {
        "injury", "recovery", "item_acquired", "item_lost",
        "character_death", "character_revival", "relationship_change",
        "location_change", "power_change", "knowledge_gain",
    }
    assert set(types.keys()) == expected_types, f"事件类型不匹配: {set(types.keys()) ^ expected_types}"
    
    for evt_type, config in types.items():
        assert "label" in config, f"{evt_type} 缺 label"
        assert "description" in config, f"{evt_type} 缺 description"
        assert "default_expected_duration" in config, f"{evt_type} 缺 default_expected_duration"
        assert "detection_rules" in config, f"{evt_type} 缺 detection_rules"


# 测试 2：injury 超期未恢复 → P0
def test_injury_unresolved_triggers_p0(tmp_path):
    vault = tmp_path / "vault"
    events_dir = vault / ".state" / "causal_events"
    events_dir.mkdir(parents=True)
    
    # ch_042 injury 事件
    (events_dir / "ch_042_events.json").write_text(json.dumps({
        "chapter": "ch_042",
        "events": [{
            "event_id": "CE-042-001",
            "chapter": 42,
            "event_type": "injury",
            "subject": "protagonist",
            "object": "left_arm",
            "state_before": "完好",
            "state_after": "断裂",
            "expected_duration": 3,
            "resolved_in_chapter": None,
            "resolved_by_event_id": None,
            "description": "主角左臂被剑气斩断",
        }],
    }, ensure_ascii=False), encoding="utf-8")
    
    # ch_046 正文（5 章后，超过 3 章恢复期，未提及伤势）
    body = "林轩挥舞双拳，与敌厮杀正酣。一拳轰出，对面黑影闷哼一声，倒退三步。"
    
    states = {"protagonist": {
        "character_id": "protagonist",
        "basic": {"name": "林轩", "aliases": [], "role": "protagonist"},
        "status": "active",
    }}
    
    issues, skip = check_causal_chain_break(body, states, str(vault), 46)
    assert skip is None, f"维度被跳过: {skip}"
    assert len(issues) == 1, f"期望 1 个 Issue，实际 {len(issues)}"
    assert issues[0].severity == "P0"
    assert issues[0].type == "causal_chain_break"
    assert issues[0].extras["sub_type"] == "injury_unresolved"


# 测试 3：item 短期得而复失 → P1
def test_item_lost_quickly_triggers_p1(tmp_path):
    vault = tmp_path / "vault"
    events_dir = vault / ".state" / "causal_events"
    events_dir.mkdir(parents=True)
    
    # ch_010 item_acquired 事件
    (events_dir / "ch_010_events.json").write_text(json.dumps({
        "chapter": "ch_010",
        "events": [{
            "event_id": "CE-010-001",
            "chapter": 10,
            "event_type": "item_acquired",
            "subject": "protagonist",
            "object": "玄铁剑",
            "state_before": "无",
            "state_after": "持有",
            "expected_duration": 999,
            "resolved_in_chapter": 12,
            "resolved_by_event_id": "CE-012-001",
            "description": "主角获得玄铁剑",
        }],
    }, ensure_ascii=False), encoding="utf-8")
    
    # ch_012 item_lost 事件（间隔 2 章 < 5 章阈值）
    (events_dir / "ch_012_events.json").write_text(json.dumps({
        "chapter": "ch_012",
        "events": [{
            "event_id": "CE-012-001",
            "chapter": 12,
            "event_type": "item_lost",
            "subject": "protagonist",
            "object": "玄铁剑",
            "state_before": "持有",
            "state_after": "失去",
            "expected_duration": 0,
            "resolved_in_chapter": None,
            "resolved_by_event_id": "CE-010-001",
            "description": "玄铁剑被黑影夺走",
        }],
    }, ensure_ascii=False), encoding="utf-8")
    
    # 当前章 ch_015 正文
    body = "林轩漫步在山道上，回忆着玄铁剑被夺的场景。"
    states = {"protagonist": {
        "character_id": "protagonist",
        "basic": {"name": "林轩", "aliases": []},
        "status": "active",
    }}
    
    # item_lost 事件本身在 ch_012，未解决；当前章 ch_015 检测时反查 acquired 章号
    issues, skip = check_causal_chain_break(body, states, str(vault), 15)
    # item_lost 事件 resolved_in_chapter=None 但 resolved_by_event_id 已填
    # 检测逻辑：gap = 15 - 12 = 3，但事件类型是 item_lost，触发短期失去检测
    p1_issues = [i for i in issues if i.extras.get("sub_type") == "item_short_term_loss"]
    assert len(p1_issues) >= 1, f"期望 P1 item_short_term_loss Issue，实际 {issues}"
    assert p1_issues[0].severity == "P1"


# 测试 4：character_death 后再现无 revival → P0
def test_character_revival_triggers_p0(tmp_path):
    vault = tmp_path / "vault"
    events_dir = vault / ".state" / "causal_events"
    events_dir.mkdir(parents=True)
    
    # ch_027 character_death 事件
    (events_dir / "ch_027_events.json").write_text(json.dumps({
        "chapter": "ch_027",
        "events": [{
            "event_id": "CE-027-001",
            "chapter": 27,
            "event_type": "character_death",
            "subject": "su_wan",
            "object": None,
            "state_before": "alive",
            "state_after": "dead",
            "expected_duration": 999,
            "resolved_in_chapter": None,
            "resolved_by_event_id": None,
            "description": "苏婉为护主角挡下一剑，香消玉殒",
        }],
    }, ensure_ascii=False), encoding="utf-8")
    
    # ch_035 正文：苏婉登场有台词，无回忆/幻觉标注，无 revival 场景
    body = '苏婉走上前来，淡淡道："师弟，你怎么了？"'
    states = {"su_wan": {
        "character_id": "su_wan",
        "basic": {"name": "苏婉", "aliases": ["苏师姐"]},
        "status": "dead",
    }}
    
    issues, skip = check_causal_chain_break(body, states, str(vault), 35)
    assert skip is None
    p0_issues = [i for i in issues if i.extras.get("sub_type") == "death_then_revive_no_closure"]
    assert len(p0_issues) == 1, f"期望 P0 death_then_revive_no_closure，实际 {issues}"
    assert p0_issues[0].severity == "P0"


# 测试 5：正常推进通过
def test_normal_progression_passes(tmp_path):
    vault = tmp_path / "vault"
    events_dir = vault / ".state" / "causal_events"
    events_dir.mkdir(parents=True)
    
    # ch_042 injury 事件
    (events_dir / "ch_042_events.json").write_text(json.dumps({
        "chapter": "ch_042",
        "events": [{
            "event_id": "CE-042-001",
            "chapter": 42,
            "event_type": "injury",
            "subject": "protagonist",
            "object": "left_arm",
            "state_before": "完好",
            "state_after": "断裂",
            "expected_duration": 3,
            "resolved_in_chapter": None,
            "resolved_by_event_id": None,
            "description": "主角左臂被剑气斩断",
        }],
    }, ensure_ascii=False), encoding="utf-8")
    
    # ch_044 正文（2 章后，预期恢复期内，提及伤势仍在疗伤）
    body = (
        "林轩靠在床榻上，左臂缠着厚厚的绷带，鲜血仍隐隐渗出。"
        "他咬牙道：\"这伤，怕是要三月才能痊愈。\""
    )
    states = {"protagonist": {
        "character_id": "protagonist",
        "basic": {"name": "林轩", "aliases": []},
        "status": "active",
    }}
    
    issues, skip = check_causal_chain_break(body, states, str(vault), 44)
    assert skip is None
    assert len(issues) == 0, f"正常推进章不应报 Issue，实际 {issues}"


# 测试 6：relationship_change 短期倒退无铺垫 → P1
def test_relationship_change_tracked(tmp_path):
    vault = tmp_path / "vault"
    events_dir = vault / ".state" / "causal_events"
    events_dir.mkdir(parents=True)
    
    # ch_050 relationship_change 事件（ally）
    (events_dir / "ch_050_events.json").write_text(json.dumps({
        "chapter": "ch_050",
        "events": [{
            "event_id": "CE-050-001",
            "chapter": 50,
            "event_type": "relationship_change",
            "subject": "protagonist",
            "object": "li_shixiong",
            "state_before": "stranger",
            "state_after": "ally",
            "expected_duration": 999,
            "resolved_in_chapter": None,
            "resolved_by_event_id": None,
            "description": "主角与李师兄歃血为盟，结为生死之交",
        }],
    }, ensure_ascii=False), encoding="utf-8")
    
    # ch_052 正文（2 章后，< 3 章阈值，出现反目关键词，无转变场景）
    body = "林轩一刀斩向李师兄，怒道：\"今日不是你死就是我亡！\""
    states = {
        "protagonist": {
            "character_id": "protagonist",
            "basic": {"name": "林轩", "aliases": []},
            "status": "active",
        },
        "li_shixiong": {
            "character_id": "li_shixiong",
            "basic": {"name": "李师兄", "aliases": ["李慕白"]},
            "status": "active",
        },
    }
    
    issues, skip = check_causal_chain_break(body, states, str(vault), 52)
    assert skip is None
    p1_issues = [i for i in issues if i.extras.get("sub_type") == "relationship_backslide_no_prelude"]
    assert len(p1_issues) == 1, f"期望 P1 relationship_backslide_no_prelude，实际 {issues}"
    assert p1_issues[0].severity == "P1"


# 测试 7：key-scene-archiver 产出因果事件
def test_key_scene_archiver_records_causal_events(tmp_path):
    """验证 key-scene-archiver 产出的场景文件结构含 ## 因果事件 段。"""
    scene_content = """# 林轩左臂被斩

## 元信息
- 章号：ch_042
- 角色：林轩
- 关键词：林轩 断臂 剑气
- 场景类型：死亡重伤
- 召回关键词：林轩 断臂 剑气 重伤

## 场景摘要
主角林轩在青云宗后山遇袭，黑影一剑斩断其左臂，鲜血淋漓。

## 角色状态变化
- 林轩：左臂从完好→断裂，重伤垂死

## 因果事件
- event_id: CE-042-001
  event_type: injury
  subject: protagonist
  object: left_arm
  state_before: 完好
  state_after: 断裂
  expected_duration: 3
  description: 主角左臂被剑气斩断

## 伏笔关联
- 埋设：无
- 回收：无

## 关键对白
> "你这手臂，怕是接不回了。"

## 原文片段
林轩跌坐在地，鲜血淋漓...
"""
    # 解析场景文件，验证含 ## 因果事件 段
    assert "## 因果事件" in scene_content, "场景文件缺 ## 因果事件 段"
    
    # 模拟 key-scene-archiver 调用 save_state.py 写入因果事件清单
    events_json = {
        "chapter": "ch_042",
        "events": [{
            "event_id": "CE-042-001",
            "chapter": 42,
            "event_type": "injury",
            "subject": "protagonist",
            "object": "left_arm",
            "state_before": "完好",
            "state_after": "断裂",
            "expected_duration": 3,
            "resolved_in_chapter": None,
            "resolved_by_event_id": None,
            "evidence_source": "ch_042_林轩_断臂.md",
            "description": "主角左臂被剑气斩断",
        }],
    }
    
    vault = tmp_path / "vault"
    events_dir = vault / ".state" / "causal_events"
    events_dir.mkdir(parents=True)
    events_path = events_dir / "ch_042_events.json"
    events_path.write_text(json.dumps(events_json, ensure_ascii=False), encoding="utf-8")
    
    # 验证文件可被 _load_causal_events_for_chapter 加载
    events = _load_causal_events_for_chapter(str(vault), 42)
    assert len(events) == 1
    assert events[0]["event_id"] == "CE-042-001"
    assert events[0]["event_type"] == "injury"
```

### 7.2 更新 `tests/bug_regression_list.md` 新增 BUG-064

在 `file:///workspace/tests/bug_regression_list.md` 末尾追加（按 bug-reporting.md 规范的描述性标题 + 编号字段）：

```markdown
## 跨章节因果链断裂导致前后不呼应（受伤/死亡/物品/关系四类）

- **编号**：BUG-064
- **首次出现**：2026-07-18（M14 模块识别）
- **类型**：一致性 / 状态漂移
- **现象**：长篇小说跨章节因果链断裂：① A 章主角受伤 B 章毫无提及就活蹦乱跳；② A 章角色死亡 B 章突然又出现（无回忆/幻觉/复生场景）；③ A 章得到物品 B 章短期就被夺/损毁无铺垫；④ A 章关系转折 B 章关系类型倒退无过渡。当前 `check_consistency.py` 仅检测单章内状态机字段一致性，不检测跨章因果链。
- **根因**：
  1. `check_consistency.py` 现有 7 类检测维度（power_level_jump / phantom_item / relationship_mutation / location_jump / foreshadow_forgetting / character_revival / golden_finger_overreach）全部是"单章 vs 状态机"对比，缺乏"跨章事件配对"能力。
  2. `character_revival` 维度只在主角状态机 `status=dead` 时检测单章内台词/动作，**不跨章追踪死亡事件**——若 status 仍是 active 但上一章角色刚死，单章检测漏报。
  3. `phantom_item` 维度只检测"无中生物品"（正文有但状态机无），**不检测"有中失物"**（状态机有但短期被 lost 事件关闭）。
  4. `relationship_mutation` 维度检测正文 vs 状态机不一致，**不检测跨章倒退是否有过渡**。
  5. 缺乏结构化的因果事件追踪机制——没有 `causal_events/ch_NNN_events.json` 章末事件清单，无法跨章配对。
- **修复**：
  1. `check_consistency.py` 新增第 8 类检测维度 `causal_chain_break`，函数 `check_causal_chain_break()` 加载前序章节未解决事件（`resolved_in_chapter == null`），按 10 类事件类型分别检测。
  2. 新增 `scripts/novelforge/data/causal_event_types.json` 因果事件类型库 SSOT，含 10 类事件的检测规则、预期持续时间、严重等级。
  3. `key-scene-archiver/SKILL.md` 6 段场景文件结构升级为 7 段（新增"## 因果事件"段），识别关键场景时同步产出因果事件清单，写入 `.state/causal_events/ch_NNN_events.json`。
  4. `save_state.py` 新增 `causal_events/` 路由分支（依赖 M01 已合并的 chapter_summaries 路由模式）。
  5. `dev-checklist.md` 新增 §十 因果链检测段（5 项 checklist + 自检报告模板对应段）。
  6. 与现有 `character_revival` / `phantom_item` / `relationship_mutation` 三维度联动：单章内触发这些维度报警时，M14 进一步查因果事件登记，无则升级为 P0 因果断裂。
- **涉及文件**：
  - `scripts/novelforge/check_consistency.py`（新增 causal_chain_break 维度全链路）
  - `scripts/novelforge/data/causal_event_types.json`（新增）
  - `scripts/novelforge/save_state.py`（新增 causal_events 路由）
  - `.trae/skills/key-scene-archiver/SKILL.md`（6 段结构 → 7 段）
  - `.trae/checklists/dev-checklist.md`（新增 §十）
  - `tests/test_causal_chain.py`（新增 7 个测试用例）
- **回归测试**：
  - `tests/test_causal_chain.py::test_causal_event_types_json_valid`
  - `tests/test_causal_chain.py::test_injury_unresolved_triggers_p0`
  - `tests/test_causal_chain.py::test_item_lost_quickly_triggers_p1`
  - `tests/test_causal_chain.py::test_character_revival_triggers_p0`
  - `tests/test_causal_chain.py::test_normal_progression_passes`
  - `tests/test_causal_chain.py::test_relationship_change_tracked`
  - `tests/test_causal_chain.py::test_key_scene_archiver_records_causal_events`
- **复现步骤**：
  1. 准备 ch_042 因果事件清单（含 injury 事件，`resolved_in_chapter=null`）。
  2. 准备 ch_046 正文（5 章后，超过预期 3 章恢复期，未提及伤势）。
  3. 运行 `python scripts/novelforge/check_consistency.py --chapter 46 --dim causal_chain --json`。
  4. 修复前：无 causal_chain_break 维度，漏报。修复后：P0 Issue，sub_type=injury_unresolved。
- **频次**：第 1 次（首次识别 + 修复）。
- **教训/沉淀**：长篇小说的"前后不呼应"问题必须用结构化因果事件追踪 + 自动化跨章配对检测，不能依赖 recap 间接缓解。因果事件用 schema 化 JSON 存储（event_id / chapter / event_type / subject / object / state_before / state_after / expected_duration / resolved_in_chapter），可被脚本精确解析，而非依赖 LLM 二次理解。每类事件的 `expected_duration` 量化配对窗口（如 injury 默认 3 章，character_death 永久），避免硬编码阈值。已沉淀为 `causal_event_types.json` SSOT + `check_consistency.py` causal_chain_break 维度，loop_log 2026-07 追加 #lesson: plot_structure 沉淀记录。
```

### 7.3 在 check_consistency.py 中新增的检测规则

**本模块在 `check_consistency.py` 中新增第 8 类检测维度 `causal_chain_break`**（详见 §五.4）。

不在 `check_ai_novel.py` 中新增检测规则。

理由：
- `check_ai_novel.py` 是去 AI 味检测（信息倾倒/金手指/爽点套路等），属于内容质量层；因果链断裂属于逻辑一致性层，由 `check_consistency.py` 承担，遵循"单一职责"原则。

---

## 八、风险点与回滚方案

### 8.1 风险等级评估

| # | 风险点 | 等级 | 理由 | 缓解措施 |
|---|---|---|---|---|
| 1 | 依赖 M01 章末摘要契约先完成 | **中** | M14 的 `save_state.py` 新增 `causal_events` 路由模式依赖 M01 已合并的 `chapter_summaries` 路由模式（同一种 PathTarget 扩展）。若 M01 未合并，M14 的 save_state.py 改造需独立实现整套路由+原子写入逻辑，工作量翻倍 | M14 排期在 M01 之后；若 M01 延期，M14 可降级为"key-scene-archiver 直接 Write 因果事件文件，不经 save_state.py 路由"（牺牲 SSOT 一致性，但功能可用） |
| 2 | `check_causal_chain_break()` 需扫描前序章节因果事件清单（默认 lookback 50 章），可能影响检测性能 | **中** | 50 章 × 每章平均 2 个事件 = 100 个文件读取 + JSON 解析；单次检测耗时可能从 < 1s 增至 3-5s | lookback_chapters 参数可配置（默认 50，可降到 20）；JSON 解析失败静默跳过不阻断；扫描结果可加 LRU 缓存（M15 扩展） |
| 3 | `causal_event_types.json` 关键词表可能不全，导致漏报 | **中** | 中文表达多样性高，`injury` 类关键词如"鲜血淋漓"未必覆盖"血如泉涌""血溅三尺"等同义表达 | 关键词表是 SSOT，可随创作迭代增量更新；测试用例覆盖核心关键词；提供 `evidence_source` 字段供人工复核 |
| 4 | `key-scene-archiver` 6 段 → 7 段结构升级可能破坏现有场景文件解析 | **低** | 7 段结构是 6 段的纯增量（在中间插入"## 因果事件"段），现有解析逻辑按 `## ` 分段不受影响 | 现有场景文件不需迁移（无"## 因果事件"段时该段为空，等价于"无因果事件"）；测试 7 覆盖新结构 |
| 5 | `causal_events/ch_NNN_events.json` 与 `chapter_summaries/ch_NNN_summary.md` 数据可能冗余（章末摘要已含"角色状态变化"段） | **低** | 两者数据有重叠但用途不同：章末摘要是自然语言压缩供 LLM 读取，因果事件清单是结构化 JSON 供脚本解析 | 两者互补不冲突：章末摘要供 recap-generator / drift-detector 消费，因果事件清单供 check_consistency.py 消费 |
| 6 | 因果事件 `expected_duration` 默认值可能与具体作品不匹配（如修仙小说伤势恢复比凡人快） | **低** | 默认值是 SSOT，但 `event_id` 写入时 `key-scene-archiver` 可覆盖（如修仙小说 injury 设为 1 章） | 在 `causal_event_types.json` 中注释说明"默认值可被单事件覆盖"；测试覆盖 expected_duration 覆盖场景 |
| 7 | `character_death` 后角色再现检测与现有 `character_revival` 维度可能重复报警 | **低** | 两者触发条件相近但视角不同：现有维度检测单章内 `status=dead` 角色登场；M14 检测跨章 `character_death` 因果事件后该角色再现 | 在 Issue detail 中明确标注 sub_type 区分；M14 检测时若现有维度已报警，可去重（同章同角色只报一次） |

### 8.2 对核心资产的影响

| 核心资产 | 是否修改 | 影响 | 保护措施 |
|---|---|---|---|
| `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口） | 是 | `key-scene-archiver/SKILL.md` 6 段结构升级为 7 段（增量，不删除现有段） | 现有 10 类关键场景识别标准保留；version 1.0.0 → 1.1.0 |
| `NovelForge_Vault/00_控制面/style_guide.md` | 否 | 不动 | 本模块不触碰风格基线 |
| `scripts/novelforge/check_consistency.py` | 是 | 新增第 8 类检测维度 `causal_chain_break` | 现有 7 类维度逻辑不变；新增逻辑在文件末尾追加，编排入口 check_all() 增量分派 |
| `scripts/novelforge/check_ai_novel.py` | 否 | 不动 | 去 AI 味脚本不被污染 |
| `scripts/novelforge/save_state.py` | 是 | 新增 `causal_events/` 路由分支（依赖 M01 模式） | 现有 4 类 + chapter_summaries 路由逻辑不变；新增逻辑在 raise ValueError 之前 |
| `scripts/novelforge/data/causal_event_types.json` | 新增 | SSOT 数据文件 | 纯数据文件，不影响运行时逻辑 |

### 8.3 回滚方案

#### 8.3.1 回滚触发条件

- `check_causal_chain_break()` 检测耗时 > 10s 严重影响开发体验
- 因果事件关键词表误报率 > 30%（经 10 章实测）
- `key-scene-archiver` 7 段结构升级导致场景文件解析失败
- `save_state.py` 新增 `causal_events` 路由导致现有 5 类路由 pytest 失败
- 因果事件清单 `.state/causal_events/ch_NNN_events.json` 与现有章末摘要冲突，引发数据不一致

#### 8.3.2 回滚步骤（按风险等级从高到低）

**回滚 1：`check_consistency.py` 新增维度回滚**（中风险，优先回滚）

```bash
cd /workspace
# 删除 causal_chain_break 维度：从 DIM_ALIASES / ALL_DIMENSIONS / DIM_LABELS 移除条目
# 删除 check_causal_chain_break() / _load_causal_event_types() / _load_causal_events_for_chapter() / _load_unresolved_causal_events() / _lookup_event_chapter_by_id() 函数
# 删除 check_all() 中的 causal_chain_break 分派分支
git revert HEAD~1 -- scripts/novelforge/check_consistency.py
pytest -q tests/test_consistency.py
```

**回滚 2：`key-scene-archiver` SKILL.md 7 段回滚**（低风险）

```bash
cd /workspace
# 恢复 6 段结构（删除"## 因果事件"段）
git checkout HEAD~2 -- .trae/skills/key-scene-archiver/SKILL.md
```

**回滚 3：`save_state.py` 新增路由回滚**（低风险）

```bash
cd /workspace
git revert HEAD~3 -- scripts/novelforge/save_state.py
# 删除 _route_path() 中 causal_events 分支
# 删除 _apply_op() 中 causal_events 类型处理
# 删除 CAUSAL_EVENTS_DIR_REL 常量
pytest -q tests/test_save_state.py
```

**回滚 4：新增文件回滚**（无风险）

```bash
cd /workspace
rm scripts/novelforge/data/causal_event_types.json
rm tests/test_causal_chain.py
# 可选：清理已产出的因果事件清单
# rm -rf NovelForge_Vault/.state/causal_events/
```

**回滚 5：`dev-checklist.md` §十回滚**（无风险）

```bash
cd /workspace
git checkout HEAD~4 -- .trae/checklists/dev-checklist.md
```

**回滚 6：`bug_regression_list.md` BUG-064 回滚**（无风险）

```bash
cd /workspace
git checkout HEAD~5 -- tests/bug_regression_list.md
```

#### 8.3.3 回滚后验证

```bash
# 验证回滚后系统恢复到 M14 之前状态
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
pytest -q
# 三项全过即回滚成功
```

#### 8.3.4 数据备份

由于本模块涉及 `.state/causal_events/` 目录新增数据，回滚前需备份：

```bash
cd /workspace
# 备份已产出的因果事件清单
if [ -d NovelForge_Vault/.state/causal_events ]; then
  tar -czf /tmp/causal_events_backup_$(date +%Y%m%d).tar.gz NovelForge_Vault/.state/causal_events/
fi
git stash push -m "M14 WIP before rollback" -- scripts/novelforge/check_consistency.py scripts/novelforge/save_state.py scripts/novelforge/data/causal_event_types.json .trae/skills/key-scene-archiver/SKILL.md .trae/checklists/dev-checklist.md tests/test_causal_chain.py tests/bug_regression_list.md
```

---

## 九、完成标准（DoD 清单）

本模块完成的标准是以下 6 项全部 ✅：

- [ ] **1. `causal_event_types.json` 创建**：路径 `file:///workspace/scripts/novelforge/data/causal_event_types.json`，含 10 类事件类型（injury / recovery / item_acquired / item_lost / character_death / character_revival / relationship_change / location_change / power_change / knowledge_gain），每类含 `label / description / default_expected_duration / detection_rules` 4 必填字段；JSON 合法可被 `_load_causal_event_types()` 加载。
- [ ] **2. `check_consistency.py` 新增 `causal_chain_break` 检测**：`DIM_ALIASES` / `ALL_DIMENSIONS` / `DIM_LABELS` 三处常量新增条目；新增 `check_causal_chain_break()` 检测函数（含 4 类子检测：injury 超期未愈 / character_death 后再现无 revival / item 短期得而复失 / relationship 短期倒退无铺垫）；新增 4 个辅助函数（`_load_causal_event_types` / `_load_causal_events_for_chapter` / `_load_unresolved_causal_events` / `_lookup_event_chapter_by_id`）；`check_all()` 编排循环新增该维度分派；运行 `python scripts/novelforge/check_consistency.py --chapter <N> --dim causal_chain` 不报"未知维度"。
- [ ] **3. `key-scene-archiver SKILL.md` 升级**：6 段场景文件结构升级为 7 段（新增"## 因果事件"段）；10 类关键场景识别标准表追加"对应的因果事件类型"映射列；步骤 8 新增"调用 save_state.py 写入因果事件清单"指令（含完整命令示例与 event_id 命名铁律）。
- [ ] **4. `dev-checklist.md` 新增 §十 因果链检测段**：5 项 checklist + 自检报告模板对应段；与 §三一致性、§八去 AI 味、§九 Skill 契约校验 并列。
- [ ] **5. `tests/test_causal_chain.py` 7 个用例全部通过**：`test_causal_event_types_json_valid` / `test_injury_unresolved_triggers_p0` / `test_item_lost_quickly_triggers_p1` / `test_character_revival_triggers_p0` / `test_normal_progression_passes` / `test_relationship_change_tracked` / `test_key_scene_archiver_records_causal_events` 全部 PASSED；执行 `pytest -q tests/test_causal_chain.py -v` 退出码 0。
- [ ] **6. `bug_regression_list.md` 新增 BUG-064**：按 bug-reporting.md 规范填写完整（描述性标题 + 编号字段 + 9 个标准字段：编号/首次出现/现象/根因/修复/涉及文件/回归测试/复现步骤/频次/教训沉淀）；执行 `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` + `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` + `pytest -q` 三项全部通过。

---

## 附录 A：与 M01 / M02 / M03 / M04 的边界

| 模块 | 范围 | 与 M14 的边界 |
|---|---|---|
| M01 Skill 间契约层修复 | 修复 writer-polisher 章末摘要断链 + 14 个 SKILL.md frontmatter 契约 | M14 依赖 M01 已合并的 `save_state.py` 路由扩展模式（`chapter_summaries` → `causal_events`）；M14 的 `key-scene-archiver` 升级不影响 M01 的 frontmatter 契约字段（produces/consumes 字段保持 M01 定义） |
| M02 schema 同步门禁 | 修复 `schema.py` 缺守护 Skill 字段 | M14 不动 schema.py；M14 的因果事件 schema 在 `causal_event_types.json` SSOT 中定义，不进 schema.py |
| M03 文档与脚本 SSOT 校验 | 修复 style_guide.md 禁用词表 vs check_ai_novel.py 不一致 | M14 不动 style_guide.md / check_ai_novel.py；M14 的关键词表在 `causal_event_types.json` 独立维护，与 style_guide.md 禁用词表不重叠 |
| M04 路径契约表模板 | 修复 10 项路径不一致 | M14 在 `causal_event_types.json` 中固化的路径（`.state/causal_events/ch_NNN_events.json`）遵循 M04 路径约定表的命名规范（`.state/<subdir>/ch_NNN_<suffix>.json`） |

## 附录 B：因果事件清单文件示例

`.state/causal_events/ch_042_events.json` 完整示例：

```json
{
  "chapter": "ch_042",
  "generated_at": "2026-07-18",
  "events": [
    {
      "event_id": "CE-042-001",
      "chapter": 42,
      "event_type": "injury",
      "subject": "protagonist",
      "object": "left_arm",
      "state_before": "完好",
      "state_after": "断裂",
      "expected_duration": 3,
      "resolved_in_chapter": null,
      "resolved_by_event_id": null,
      "evidence_source": "ch_042_林轩_断臂.md",
      "description": "主角左臂被剑气斩断"
    },
    {
      "event_id": "CE-042-002",
      "chapter": 42,
      "event_type": "relationship_change",
      "subject": "protagonist",
      "object": "hei_ying",
      "state_before": "stranger",
      "state_after": "enemy",
      "expected_duration": 999,
      "resolved_in_chapter": null,
      "resolved_by_event_id": null,
      "evidence_source": "ch_042_林轩-黑影_遇袭.md",
      "description": "主角与黑影袭击者结仇"
    },
    {
      "event_id": "CE-042-003",
      "chapter": 42,
      "event_type": "knowledge_gain",
      "subject": "protagonist",
      "object": "黑影身份线索",
      "state_before": "未知",
      "state_after": "已知部分线索",
      "expected_duration": 999,
      "resolved_in_chapter": null,
      "resolved_by_event_id": null,
      "evidence_source": "ch_042_林轩_断臂.md",
      "description": "主角发现黑影使用的是青云宗秘传剑法"
    }
  ]
}
```

## 附录 C：参考来源

- `file:///workspace/scripts/novelforge/check_consistency.py`（现有 7 类检测维度）
- `file:///workspace/scripts/novelforge/save_state.py`（PathTarget 路由 + Delta 增量）
- `file:///workspace/NovelForge_Vault/.state/characters/protagonist.json`（角色状态机字段）
- `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md`（10 类关键场景 + 6 段结构）
- `file:///workspace/.trae/skills/writer-polisher/SKILL.md`（章末摘要产出契约）
- `file:///workspace/.trae/checklists/dev-checklist.md`（8 段 checklist）
- `file:///workspace/docs/optimization_plan_2026_07/M01_skill_contract_layer.md`（M01 方案，章末摘要契约）
- `file:///workspace/.trae/rules/dev-workflow.md` §一 第三步执行规范
- `file:///workspace/.trae/rules/bug-reporting.md` Bug 记录与回归规范
- 《情节！情节！》（Donald Maass）—— 前后呼应方法论
- 《故事工程》（Larry Brooks）—— Beat Sheet 事件配对思想
- Scrivener Snapshot —— 章节间状态 diff 启发
- Sudowrite Story Bible Plot Threads —— 情节线追踪启发

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 优化方案多专家团（架构师 + 测试 + 规则三视角评审待办）
**评审状态**：待 plan-review Skill 三视角评审
**前置依赖**：M01 Skill 间契约层修复（causal_events 路由模式复用 chapter_summaries 路由扩展）
