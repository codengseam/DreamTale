# M13 · 爽点曲线量化检测

> **层级**：L3 · 补齐盲区能力
> **依赖**：无（独立模块）
> **下游**：M19（起点神级小说方法论沉淀，引用本模块的爽点节奏黄金分布与五种爽点公式）、M20（开发自检清单升级，汇总本模块的爽点曲线检测项）
> **对应主线规划**：`00_master_plan.md` §四并行组 C（L3 补盲模块，独立）

---

## 一、模块目标

- **一句话目标**：在 [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) 新增 `pacing_curve` 检测，按章扫描爽点节奏（5 级量化 + 三种绝对错误节奏 + 标准情绪曲线五段式），连续 3 章无爽点告警 / 连续 5 章压抑无释放告警；与 [file:///workspace/NovelForge_Vault/.state/rhythm_curve.json](file:///workspace/NovelForge_Vault/.state/rhythm_curve.json) 联动。
- **对应的痛点**：节奏失控、流水账（一直平）、情绪过载（一直虐）、爽点疲劳（一直爽）；AI 写长篇因缺乏节奏感而出现"3000 字一段平推 / 主角被虐 8 章不给爽点 / 卷末无大爆发"三类典型问题。
- **完成后达成的能力**：
  1. **5 级爽点节奏量化检测**：300 字一小刺激 / 1000 字一小冲突 / 3000 字一小高潮 / 1 万字一中高潮 / 30 万字一大爆发，按章扫描自动识别。
  2. **三种绝对错误节奏识别**：一直平（流水账）/ 一直爽（无压力很快腻）/ 一直虐（情绪过载直接弃书），压抑主角情节超过 5 章告警。
  3. **标准情绪曲线五段式校验**：1.平静 → 2.压力上升 → 3.危机顶点 → 4.爽点释放 → 5.回落 + 新钩子，对每章 `pacing_events` 数组做阶段闭环检查。
  4. **卷级曲线可视化数据**：rhythm_curve.json 升级 schema 后承载 `pacing_events` 数组，architect 可基于此绘制卷级爽点分布图。

---

## 二、痛点对应

### 2.1 痛点表现：AI 写长篇三类典型节奏失控

**痛点 A：流水账（一直平）**

```
第 31 章：主角去集市买菜，遇到老王，聊了几句，回家做饭。
第 32 章：主角去书院上课，听了讲座，下课回来。
第 33 章：主角去师弟家串门，喝茶，回家。
```

连续 3 章无任何爽点（赚小钱 / 打脸喽啰 / 获宝物），读者留存率断崖式下跌。`check_ai_novel.py` 现有 `check_plot_cliche` 只能检测"连续 3 章重复同一爽点模式"，**检测不到"连续 3 章根本没爽点"**——这是盲区。

**痛点 B：情绪过载（一直虐）**

```
第 41 章：主角被师弟陷害，逐出师门。
第 42 章：主角被仇家追杀，重伤逃亡。
第 43 章：主角在山洞中疗伤，灵根被废。
第 44 章：主角被仇敌围攻，肉身残破。
第 45 章：主角陷入绝望，准备自尽。
```

连续 5 章压抑（suppression ≥ 4）无任何爽点释放，读者情绪过载直接弃书。NovelForge 现有 `rhythm_curve.json` 的 `alert_rules.consecutive_high_suppression` 阈值是 3，但 `check_consistency.py` **没有任何代码读取 rhythm_curve.json 做告警**——alert_rules 只是数据声明，无执行入口。

**痛点 C：爽点疲劳（一直爽）**

```
第 51 章：主角打脸长老，获得宝物。
第 52 章：主角打脸内门弟子，获得宝物。
第 53 章：主角打脸外门弟子，获得宝物。
```

连续 3 章爽点（satisfaction ≥ 4）无压力铺垫，读者很快腻。这是 `check_plot_cliche` 的相邻问题但角度不同——套路化检测管"模式雷同"，本模块管"压力-释放曲线缺失"。

### 2.2 行业方案：爽点节奏黄金分布

来源：起点 / 番茄 / 晋江大神公开技巧 + loop_log 2026-07 行业调研报告（`00_master_plan.md` §六网文方法论引用）。

**5 级爽点节奏黄金分布**：

| 等级 | 间隔 | 字数估算 | 典型场景 |
|---|---|---|---|
| 微刺激 micro_stimulation | 每 300 字 | 300 字 | 一句反讽、一个眼神杀、一次小试探 |
| 小冲突 minor_conflict | 每 1000 字 | 1000 字 | 一次口角、一次小摩擦、一次低强度对抗 |
| 小高潮 minor_climax | 每 1-3 章 | 3000 字 | 赚第一笔钱、打脸小喽啰、获得小宝物 |
| 中高潮 medium_climax | 每 10-20 章 | 1 万字 | 打败小 Boss、完成重要任务、实力大幅提升 |
| 大爆发 major_climax | 每一卷 | 30 万字 | 打败最终 Boss、实现长期目标、人生逆袭 |

**三种绝对错误节奏**：
- 一直平（流水账）：连续 ≥ 3 章无任何 micro/minor_climax
- 一直爽（无压力很快腻）：连续 ≥ 5 章 satisfaction ≥ 4 且无 suppression ≥ 3 章节
- 一直虐（情绪过载直接弃书）：连续 ≥ 5 章 suppression ≥ 4 且无 climax 释放

**压抑主角情节不能超过 5 章**：连续 5 章 suppression ≥ 4 即触发 P0 告警，要求下章必须安排 climax 释放或情绪转折。

**标准情绪曲线五段式**（单章或跨章闭环）：

```
1.平静（200-400 字）
   ↓ 引入日常或新场景
2.压力上升（400-800 字）
   ↓ 冲突浮现，主角受挫或受压
3.危机顶点（300-600 字）
   ↓ 矛盾激化，主角陷险或决断
4.爽点释放（300-500 字）
   ↓ 主角反击/突破/获得/打脸
5.回落 + 新钩子（100-200 字）
   ↓ 收尾并埋下章钩子
```

每章 `pacing_events` 数组应能映射到这五段之一；连续多章未出现阶段 4（爽点释放）即告警。

### 2.3 本模块的差异化设计

NovelForge 现状盘点：

| 资产 | 现状 | 缺口 |
|---|---|---|
| [file:///workspace/NovelForge_Vault/.state/rhythm_curve.json](file:///workspace/NovelForge_Vault/.state/rhythm_curve.json) | 已有 `chapters` 数组（ch/satisfaction/suppression/note）+ `alert_rules`（consecutive_low_satisfaction=3 / consecutive_high_suppression=3） | **未实现**：5 级量化、pacing_events 详细事件、卷级大爽点检测、情绪曲线五段式 |
| [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) | 7 类检测（境界跳级 / 物品凭空 / 关系突变 / 位置穿越 / 伏笔遗忘 / 角色复生 / 金手指越界） | **完全未读取 rhythm_curve.json**，alert_rules 形同虚设 |
| [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) | `check_plot_cliche`（连续 3 章重复同一爽点模式 P1） | 只看模式雷同，不看节奏缺失；与 rhythm_curve.json 无联动 |
| [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) | 章纲十段模板有「八、节奏标记」（爽点值 1-5 / 压抑值 1-5 / 情绪走向） | 卷大纲的「节奏曲线（爽点分布）」段落无量化约束，章纲无 5 级爽点节点预埋 |
| [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | 阶段四状态更新构造 Delta JSON | **未要求**写入 pacing_events 到 rhythm_curve.json，状态更新与节奏数据脱节 |

**差异化设计**：

1. **以 rhythm_curve.json 为 SSOT**：5 级爽点数据集中在状态机，不分散在章纲 / 正文，避免多源真相。
2. **检测与告警分离**：rhythm_curve.json 只存数据，pacing_rules.json 存阈值，check_consistency.py 做检测——三者职责清晰。
3. **Delta 增量更新**：复用 save_state.py 现有 `append` op，writer-polisher 每章追加 pacing_events，避免整对象覆盖。
4. **五段式闭环校验**：不只看"有没有爽点"，还看"压力-释放曲线是否闭环"——这是与 `check_plot_cliche` 的根本差异。
5. **卷级大爆发检测**：每 30 万字必须有一次 major_climax，防止卷末灌水或卷末烂尾。

---

## 三、涉及现有文件

### 3.1 必读文件清单

| 路径 | 用途 | 关注点 |
|---|---|---|
| [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) | 7 类一致性检测主脚本 | 行 162-201 `DIM_ALIASES` / `ALL_DIMENSIONS` / `DIM_LABELS` 维度注册表；行 1202-1289 `_DIM_CHECKERS_NO_VAULT` + `check_all` 编排函数；行 504-1057 各 `check_*` 函数范式（Issue dataclass + skip 返回）；本模块在第 8 维度 `pacing_curve` 注册 |
| [file:///workspace/NovelForge_Vault/.state/rhythm_curve.json](file:///workspace/NovelForge_Vault/.state/rhythm_curve.json) | 节奏曲线状态机 | 现 schema：`chapters: [{ch, satisfaction, suppression, note}]` + `alert_rules: {consecutive_low_satisfaction, consecutive_high_suppression}`；本模块升级 schema 新增 `pacing_events` 数组 |
| [file:///workspace/NovelForge_Vault/.state/power_curve.json](file:///workspace/NovelForge_Vault/.state/power_curve.json) | 金手指强度曲线（结构参考） | `chapters: [{ch, level, bottleneck, note}]` + `alert_rules: {consecutive_no_bottleneck, single_chapter_jump}`；本模块的 `pacing_events` 结构借鉴此格式 |
| [file:///workspace/scripts/novelforge/save_state.py](file:///workspace/scripts/novelforge/save_state.py) | Delta 增量更新 + Schema 校验 + 原子写入 | 行 281-333 `_route_path` 路由规则；行 362-404 `_apply_op_to_dict` 通用 op 应用；行 544-624 `_apply_op` 调度；**rhythm_curve.json 当前未在路由表**，本模块新增 `rhythm_curve` kind |
| [file:///workspace/scripts/novelforge/schema.py](file:///workspace/scripts/novelforge/schema.py) | JSON Schema 定义 | 现 schema：`CHARACTER_STATE_SCHEMA` / `FORESHADOW_SCHEMA` / `DELTA_SCHEMA` / `PIPELINE_SCHEMA` / `CONTEXT_BUDGET_SCHEMA`；**无 RHYTHM_CURVE_SCHEMA**，本模块新增 |
| [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) | 架构师 Skill | §5.1 章纲十段模板「六、爽点设计」「八、节奏标记」；§5.2 卷大纲模板「节奏曲线（爽点分布）」段落；本模块在此预埋 5 级爽点节点 |
| [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | 执笔与精修 Skill | §阶段四状态更新「第 2 步构造 Delta JSON」示例；本模块在此追加 pacing_events 更新指令 |
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 创作自检清单 | §一创作质量「节奏得当」；§三一致性「节奏曲线无连续低谷」；本模块新增量化检测项 |
| [file:///workspace/NovelForge_Vault/04_大纲与脉络/master_outline.md](file:///workspace/NovelForge_Vault/04_大纲与脉络/master_outline.md) | 总大纲 | §二卷级规划「主要爽点 / 卷末高潮」字段；本模块的卷级 major_climax 检测对齐此字段 |

### 3.2 现状关键发现

1. **rhythm_curve.json 已有 alert_rules 但无执行入口**：`consecutive_low_satisfaction=3` 和 `consecutive_high_suppression=3` 写在 JSON 里，但 check_consistency.py 从未读取此文件——alert_rules 形同虚设。本模块的核心价值之一就是把 alert_rules 真正激活。
2. **`check_plot_cliche` 与本模块互补**：前者管"连续 3 章爽点模式雷同"（P1），本模块管"连续 3 章根本没爽点"（P0）和"连续 5 章压抑无释放"（P0）。两者检测维度不同，不冲突。
3. **power_curve.json 已有结构范式**：`chapters` 数组 + `alert_rules` 字典的格式可被本模块直接复用，新增 `pacing_events` 数组作为更细粒度的事件流。
4. **save_state.py 路由表未含 rhythm_curve**：当前 `_route_path` 只识别 `characters/` / `hooks/` / `world_timeline` / `pipeline` 四种 root，rhythm_curve.json 的更新需要走"裸文件 Edit"——这是 Vault SSOT 原则的违反。本模块必须把 `rhythm_curve` 加入路由表。
5. **章纲十段已有「八、节奏标记」**：爽点值 1-5 / 压抑值 1-5 / 情绪走向——本模块只需在此段落追加「5 级爽点节点预埋」子段，无需重构章纲模板。
6. **master_outline.md 卷级规划已有「主要爽点 / 卷末高潮」字段**：本模块的卷级 major_climax 检测对齐此字段，每卷必须有至少 1 个 major_climax。

---

## 四、新增/修改文件清单

### 4.1 修改

| 路径 | 修改类型 | 修改要点 |
|---|---|---|
| [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) | 新增维度 | 注册第 8 维度 `pacing_curve`：新增 `check_pacing_curve` 函数、`RHYTHM_CURVE_REL` 常量、`PACING_RULES_PATH` 常量、`load_rhythm_curve` / `load_pacing_rules` 辅助函数；`ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` / `_DIM_CHECKERS_NO_VAULT` / `check_all` 同步登记 |
| [file:///workspace/NovelForge_Vault/.state/rhythm_curve.json](file:///workspace/NovelForge_Vault/.state/rhythm_curve.json) | schema 升级 | 保留旧字段（chapters / alert_rules），新增 `pacing_events: []` 数组 + `volume_climax_records: []` 数组 + `_comment_pacing_events` 注释；alert_rules 新增 `consecutive_no_climax` / `consecutive_suppression_no_release` / `volume_major_climax_missing` 三个键 |
| [file:///workspace/scripts/novelforge/schema.py](file:///workspace/scripts/novelforge/schema.py) | 新增 schema | 新增 `RHYTHM_CURVE_SCHEMA` + `PACING_EVENT_SCHEMA` + `PACING_RULES_SCHEMA` + `validate_rhythm_curve` / `validate_pacing_event` 校验函数；`__all__` 同步导出 |
| [file:///workspace/scripts/novelforge/save_state.py](file:///workspace/scripts/novelforge/save_state.py) | 路由扩展 | `_route_path` 新增 `rhythm_curve` kind 分支；`EMPTY_RHYTHM_CURVE` 模板；`_apply_op` 调度新增 `rhythm_curve` 分支调用 `_apply_op_to_dict`；`_apply_op_to_rhythm_curve` 辅助函数（特殊：`pacing_events` 用 append） |
| [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) | 模板增强 | §5.1 章纲十段「八、节奏标记」段落追加「5 级爽点节点预埋」子段；§5.2 卷大纲「节奏曲线（爽点分布）」段落追加「卷级 major_climax 计划」子段 |
| [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | 流程增强 | §阶段四状态更新「第 2 步构造 Delta JSON」追加 pacing_events 更新指令；新增「第 2.5 步：追加 pacing_events 到 rhythm_curve.json」 |
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 新增检测项 | §三一致性追加「爽点曲线：连续 3 章无 climax / 连续 5 章压抑无释放 / 卷级 major_climax 缺失」三项；§一创作质量追加「5 级爽点节点预埋齐全」一项 |

### 4.2 新增

| 路径 | 用途 |
|---|---|
| [file:///workspace/scripts/novelforge/data/pacing_rules.json](file:///workspace/scripts/novelforge/data/pacing_rules.json) | 爽点节奏规则配置 SSOT——5 级阈值 + 告警规则 + 三种绝对错误节奏判定条件。与 M3 的 `ai_words.json` / M9 的 `zhuque_metrics.json` 并列在 `data/` 目录，沿用 SSOT 加载 + fallback 硬编码模式 |
| [file:///workspace/tests/test_pacing_curve.py](file:///workspace/tests/test_pacing_curve.py) | 回归测试套件，7 个测试用例覆盖 5 级爽点识别 + 三种错误节奏 + 卷级大爽点缺失 |

---

## 五、详细实现步骤

### 步骤 1：设计 5 级爽点类型枚举

在 [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) 顶部常量区追加：

```python
# --- 5 级爽点类型枚举（与 pacing_rules.json 同步）---------------------------
# 等级从低到高：micro_stimulation < minor_conflict < minor_climax
#               < medium_climax < major_climax
PACING_EVENT_TYPES: tuple[str, ...] = (
    "micro_stimulation",   # 300 字一小刺激
    "minor_conflict",      # 1000 字一小冲突
    "minor_climax",        # 3000 字一小高潮（每 1-3 章）
    "medium_climax",       # 1 万字一中高潮（每 10-20 章）
    "major_climax",        # 30 万字一大爆发（每一卷）
)

# 等级 → 强度值（用于排序与阈值比较）
PACING_INTENSITY_MAP: dict[str, int] = {
    "micro_stimulation": 1,
    "minor_conflict": 2,
    "minor_climax": 3,
    "medium_climax": 4,
    "major_climax": 5,
}

# 爽点释放型事件（用于"连续 N 章无爽点"判定）
# 注：micro_stimulation / minor_conflict 是过程性事件，不算"释放"
CLIMAX_EVENT_TYPES: tuple[str, ...] = (
    "minor_climax",
    "medium_climax",
    "major_climax",
)

# 单章标准情绪曲线五段式（用于闭环校验）
EMOTION_CURVE_STAGES: tuple[str, ...] = (
    "calm",              # 1. 平静
    "pressure_rising",   # 2. 压力上升
    "crisis_peak",       # 3. 危机顶点
    "climax_release",    # 4. 爽点释放
    "fall_with_hook",    # 5. 回落 + 新钩子
)
```

### 步骤 2：设计 pacing_events 字段 schema

在 [file:///workspace/scripts/novelforge/schema.py](file:///workspace/scripts/novelforge/schema.py) 追加：

```python
# ============================================================================
# 爽点事件 Schema（rhythm_curve.json 的 pacing_events 数组项）
# ============================================================================
PACING_EVENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["event_id", "chapter", "event_type", "intensity"],
    "properties": {
        "event_id": {
            "type": "string",
            "description": "事件 ID，如 P-001、P-042",
        },
        "chapter": {
            "type": "integer",
            "minimum": 1,
            "description": "所在章号",
        },
        "event_type": {
            "type": "string",
            "enum": [
                "micro_stimulation",
                "minor_conflict",
                "minor_climax",
                "medium_climax",
                "major_climax",
            ],
            "description": "5 级爽点类型",
        },
        "intensity": {
            "type": "integer",
            "minimum": 1,
            "maximum": 5,
            "description": "强度值 1-5，与 event_type 对应",
        },
        "position_in_chapter": {
            "type": "string",
            "enum": ["opening", "middle", "ending", "whole"],
            "default": "middle",
            "description": "事件在章节中的位置：开篇/中段/结尾/全章",
        },
        "emotion_stage": {
            "type": "string",
            "enum": [
                "calm",
                "pressure_rising",
                "crisis_peak",
                "climax_release",
                "fall_with_hook",
            ],
            "description": "对应标准情绪曲线五段式哪一段",
        },
        "description": {
            "type": "string",
            "default": "",
            "description": "事件描述（一句话）",
        },
        "word_offset": {
            "type": "integer",
            "minimum": 0,
            "description": "在本章正文的字偏移量（用于精确可视化）",
        },
    },
}


# ============================================================================
# 节奏曲线 Schema（rhythm_curve.json 升级版）
# ============================================================================
RHYTHM_CURVE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "chapters": {
            "type": "array",
            "description": "每章爽点/压抑等级（旧字段，保留兼容）",
            "items": {
                "type": "object",
                "properties": {
                    "ch": {"type": "integer"},
                    "satisfaction": {"type": "integer", "minimum": 1, "maximum": 5},
                    "suppression": {"type": "integer", "minimum": 1, "maximum": 5},
                    "note": {"type": "string"},
                },
            },
            "default": [],
        },
        "pacing_events": {
            "type": "array",
            "description": "5 级爽点事件流（本模块新增）",
            "items": PACING_EVENT_SCHEMA,
            "default": [],
        },
        "volume_climax_records": {
            "type": "array",
            "description": "卷级大爆发记录（每卷至少 1 条 major_climax）",
            "items": {
                "type": "object",
                "properties": {
                    "volume": {"type": "integer", "minimum": 1},
                    "chapter": {"type": "integer", "minimum": 1},
                    "event_id": {"type": "string"},
                    "description": {"type": "string"},
                },
            },
            "default": [],
        },
        "alert_rules": {
            "type": "object",
            "properties": {
                "consecutive_low_satisfaction": {
                    "type": "integer", "default": 3,
                    "description": "连续 N 章爽点 ≤ 2 则告警（旧字段，保留）",
                },
                "consecutive_high_suppression": {
                    "type": "integer", "default": 3,
                    "description": "连续 N 章压抑 ≥ 4 则告警（旧字段，保留）",
                },
                "consecutive_no_climax": {
                    "type": "integer", "default": 3,
                    "description": "连续 N 章无 climax 释放则告警（本模块新增）",
                },
                "consecutive_suppression_no_release": {
                    "type": "integer", "default": 5,
                    "description": "连续 N 章压抑（suppression ≥ 4）且无 climax 则告警（本模块新增）",
                },
                "volume_major_climax_missing": {
                    "type": "boolean", "default": True,
                    "description": "每卷缺少 major_climax 则告警（本模块新增）",
                },
                "consecutive_high_satisfaction_no_pressure": {
                    "type": "integer", "default": 5,
                    "description": "连续 N 章爽点 ≥ 4 且无 suppression ≥ 3 则告警（一直爽）",
                },
            },
            "default": {},
        },
    },
}


# ============================================================================
# 爽点规则配置 Schema（pacing_rules.json）
# ============================================================================
PACING_RULES_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "word_thresholds": {
            "type": "object",
            "description": "5 级爽点字数阈值",
            "properties": {
                "micro_stimulation": {"type": "integer", "default": 300},
                "minor_conflict": {"type": "integer", "default": 1000},
                "minor_climax": {"type": "integer", "default": 3000},
                "medium_climax": {"type": "integer", "default": 10000},
                "major_climax": {"type": "integer", "default": 300000},
            },
        },
        "chapter_intervals": {
            "type": "object",
            "description": "5 级爽点章节间隔（章数）",
            "properties": {
                "minor_climax": {"type": "integer", "default": 3},
                "medium_climax": {"type": "integer", "default": 15},
                "major_climax": {"type": "integer", "default": 100},
            },
        },
        "wrong_rhythm_thresholds": {
            "type": "object",
            "description": "三种绝对错误节奏判定阈值",
            "properties": {
                "flat_chapters": {"type": "integer", "default": 3,
                                  "description": "一直平：连续 N 章无 climax"},
                "all_爽_chapters": {"type": "integer", "default": 5,
                                    "description": "一直爽：连续 N 章 satisfaction ≥ 4 且无 suppression ≥ 3"},
                "all_虐_chapters": {"type": "integer", "default": 5,
                                    "description": "一直虐：连续 N 章 suppression ≥ 4 且无 climax"},
            },
        },
        "suppression_threshold": {
            "type": "integer", "default": 5,
            "description": "压抑主角情节不能超过 N 章",
        },
        "satisfaction_low": {"type": "integer", "default": 2,
                             "description": "satisfaction ≤ 此值视为低爽点"},
        "suppression_high": {"type": "integer", "default": 4,
                             "description": "suppression ≥ 此值视为高压抑"},
        "satisfaction_high": {"type": "integer", "default": 4,
                              "description": "satisfaction ≥ 此值视为高爽点"},
    },
}
```

同步追加校验函数：

```python
def validate_pacing_event(data: dict) -> list[str]:
    """校验单个 pacing_event，返回错误列表。"""
    errors: list[str] = []
    for field in PACING_EVENT_SCHEMA["required"]:
        if field not in data:
            errors.append(f"pacing_event 缺少必填字段: {field}")
    if data.get("event_type") not in [
        "micro_stimulation", "minor_conflict",
        "minor_climax", "medium_climax", "major_climax",
    ]:
        errors.append(f"event_type 非法: {data.get('event_type')}")
    intensity = data.get("intensity")
    if not isinstance(intensity, int) or not (1 <= intensity <= 5):
        errors.append(f"intensity 必须是 1-5 整数，实际: {intensity!r}")
    expected = {
        "micro_stimulation": 1, "minor_conflict": 2,
        "minor_climax": 3, "medium_climax": 4, "major_climax": 5,
    }
    if data.get("event_type") in expected and data.get("intensity") != expected[data["event_type"]]:
        errors.append(
            f"intensity {data.get('intensity')} 与 event_type "
            f"{data.get('event_type')} 不匹配（应为 {expected[data['event_type']]}）"
        )
    return errors


def validate_rhythm_curve(data: dict) -> list[str]:
    """校验 rhythm_curve.json，返回错误列表。"""
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["rhythm_curve 必须是对象"]
    chapters = data.get("chapters", [])
    if not isinstance(chapters, list):
        errors.append("chapters 必须是数组")
    events = data.get("pacing_events", [])
    if not isinstance(events, list):
        errors.append("pacing_events 必须是数组")
    else:
        for i, evt in enumerate(events):
            if not isinstance(evt, dict):
                errors.append(f"pacing_events[{i}] 不是对象")
                continue
            evt_errors = validate_pacing_event(evt)
            for e in evt_errors:
                errors.append(f"pacing_events[{i}]: {e}")
    return errors
```

`__all__` 追加导出：

```python
__all__ = [
    # ... 现有 ...
    "PACING_EVENT_SCHEMA",
    "RHYTHM_CURVE_SCHEMA",
    "PACING_RULES_SCHEMA",
    "validate_pacing_event",
    "validate_rhythm_curve",
]
```

### 步骤 3：pacing_rules.json 完整内容

新建 [file:///workspace/scripts/novelforge/data/pacing_rules.json](file:///workspace/scripts/novelforge/data/pacing_rules.json)：

```json
{
  "_comment": "爽点节奏规则配置 SSOT。check_consistency.py 的 pacing_curve 维度加载此文件做阈值判定。",
  "_comment_load_strategy": "优先加载此文件；缺失时 fallback 到 check_consistency.py 内置硬编码常量。",
  "_comment_sync": "本文件与 rhythm_curve.json 的 alert_rules 字段协同：本文件定阈值，rhythm_curve.json 存数据。",
  "word_thresholds": {
    "micro_stimulation": 300,
    "minor_conflict": 1000,
    "minor_climax": 3000,
    "medium_climax": 10000,
    "major_climax": 300000
  },
  "chapter_intervals": {
    "minor_climax": 3,
    "medium_climax": 15,
    "major_climax": 100
  },
  "wrong_rhythm_thresholds": {
    "flat_chapters": 3,
    "all_爽_chapters": 5,
    "all_虐_chapters": 5
  },
  "suppression_max_chapters": 5,
  "satisfaction_low": 2,
  "suppression_high": 4,
  "satisfaction_high": 4,
  "emotion_curve_stages": [
    "calm",
    "pressure_rising",
    "crisis_peak",
    "climax_release",
    "fall_with_hook"
  ],
  "volume_word_budget": 300000,
  "fallback_hardcoded": {
    "consecutive_no_climax": 3,
    "consecutive_suppression_no_release": 5,
    "consecutive_high_satisfaction_no_pressure": 5
  }
}
```

### 步骤 4：check_consistency.py 新增 pacing_curve 检测

在 [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) 追加以下代码块。

#### 4.1 顶部常量追加

```python
# 节奏曲线状态文件相对路径
RHYTHM_CURVE_REL: str = ".state/rhythm_curve.json"
# 爽点规则配置文件路径（与 ai_words.json / zhuque_metrics.json 并列）
PACING_RULES_REL: str = "scripts/novelforge/data/pacing_rules.json"

# 默认阈值（pacing_rules.json 缺失时 fallback）
DEFAULT_PACING_RULES: dict[str, Any] = {
    "word_thresholds": {
        "micro_stimulation": 300,
        "minor_conflict": 1000,
        "minor_climax": 3000,
        "medium_climax": 10000,
        "major_climax": 300000,
    },
    "chapter_intervals": {"minor_climax": 3, "medium_climax": 15, "major_climax": 100},
    "wrong_rhythm_thresholds": {"flat_chapters": 3, "all_爽_chapters": 5, "all_虐_chapters": 5},
    "suppression_max_chapters": 5,
    "satisfaction_low": 2,
    "suppression_high": 4,
    "satisfaction_high": 4,
}
```

#### 4.2 加载函数

```python
def load_rhythm_curve(vault: str) -> dict[str, Any]:
    """加载 rhythm_curve.json；不存在返回空字典（不阻断检测）。"""
    path = os.path.join(vault, RHYTHM_CURVE_REL)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def load_pacing_rules() -> dict[str, Any]:
    """加载 pacing_rules.json；不存在返回 DEFAULT_PACING_RULES（fallback）。

    搜索路径：
    1. scripts/novelforge/data/pacing_rules.json（仓库根相对）
    2. DEFAULT_PACING_RULES 常量
    """
    candidates = [
        os.path.join(os.getcwd(), PACING_RULES_REL),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "pacing_rules.json"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
    return DEFAULT_PACING_RULES
```

#### 4.3 主检测函数 `check_pacing_curve`

```python
def check_pacing_curve(
    body: str,
    states: dict[str, dict[str, Any]],
    rhythm_curve: dict[str, Any],
    current_ch: int,
    vault: str,
) -> tuple[list[Issue], str | None]:
    """第 8 维度：爽点曲线量化检测。

    规则（4 类告警）：
    1. **连续 N 章无 climax 释放**（一直平，P0）—— 最近 N 章（默认 3）
       在 pacing_events 中无 minor/medium/major_climax。
    2. **连续 N 章压抑无释放**（一直虐，P0）—— 最近 N 章（默认 5）
       suppression ≥ 4 且无 climax。
    3. **连续 N 章爽点无压力**（一直爽，P1）—— 最近 N 章（默认 5）
       satisfaction ≥ 4 且无 suppression ≥ 3 章节。
    4. **卷级 major_climax 缺失**（P1）—— 当前卷无 major_climax 事件
       且当前章距卷首已超过 100 章（约 30 万字）。

    Args:
        body: 本章正文（pacing_curve 不直接分析正文，仅用 current_ch 检索 rhythm_curve）。
        states: 角色状态（未使用，保留接口一致性）。
        rhythm_curve: rhythm_curve.json 全文 dict。
        current_ch: 当前章号。
        vault: Vault 根路径。

    Returns:
        (issues, skip_reason)
    """
    if not rhythm_curve:
        return [], "rhythm_curve.json 不存在或为空（模板状态），跳过爽点曲线检测"

    chapters_data = rhythm_curve.get("chapters") or []
    if not isinstance(chapters_data, list) or not chapters_data:
        return [], "rhythm_curve.chapters 为空，跳过爽点曲线检测"

    pacing_events = rhythm_curve.get("pacing_events") or []
    if not isinstance(pacing_events, list):
        pacing_events = []

    rules = load_pacing_rules()
    alert_rules = rhythm_curve.get("alert_rules") or {}

    # 阈值优先从 rhythm_curve.alert_rules 取，缺失则从 pacing_rules.json 取
    flat_threshold = alert_rules.get(
        "consecutive_no_climax",
        rules.get("wrong_rhythm_thresholds", {}).get("flat_chapters", 3),
    )
    abuse_threshold = alert_rules.get(
        "consecutive_suppression_no_release",
        rules.get("wrong_rhythm_thresholds", {}).get("all_虐_chapters", 5),
    )
    all_爽_threshold = alert_rules.get(
        "consecutive_high_satisfaction_no_pressure",
        rules.get("wrong_rhythm_thresholds", {}).get("all_爽_chapters", 5),
    )
    suppression_max = rules.get("suppression_max_chapters", 5)
    sat_low = rules.get("satisfaction_low", 2)
    sup_high = rules.get("suppression_high", 4)
    sat_high = rules.get("satisfaction_high", 4)

    issues: list[Issue] = []

    # 构造章号 → 章数据映射
    ch_map: dict[int, dict[str, Any]] = {}
    for entry in chapters_data:
        if isinstance(entry, dict) and isinstance(entry.get("ch"), int):
            ch_map[entry["ch"]] = entry

    # 构造章号 → 该章 pacing_events 列表映射
    events_by_ch: dict[int, list[dict[str, Any]]] = {}
    for evt in pacing_events:
        if not isinstance(evt, dict):
            continue
        ch = evt.get("chapter")
        if isinstance(ch, int):
            events_by_ch.setdefault(ch, []).append(evt)

    def has_climax_in_chapter(ch: int) -> bool:
        """该章是否有 climax 释放型事件。"""
        for evt in events_by_ch.get(ch, []):
            if evt.get("event_type") in CLIMAX_EVENT_TYPES:
                return True
        return False

    def has_suppression_in_chapter(ch: int) -> bool:
        """该章是否有 suppression ≥ 3 的压抑段。"""
        entry = ch_map.get(ch)
        if not entry:
            return False
        return entry.get("suppression", 0) >= 3

    # === 检测 1：连续 N 章无 climax（一直平）===
    # 从当前章回溯，统计连续无 climax 的章数
    no_climax_streak = 0
    no_climax_chs: list[int] = []
    for ch in range(current_ch, max(0, current_ch - 50), -1):
        if ch not in ch_map:
            continue  # 该章无数据，跳过
        if has_climax_in_chapter(ch):
            break
        no_climax_streak += 1
        no_climax_chs.append(ch)

    if no_climax_streak >= flat_threshold:
        detail = (
            f"连续 {no_climax_streak} 章无 climax 释放（ch{min(no_climax_chs)}-ch{max(no_climax_chs)}）\n"
            f"   阈值: 连续 {flat_threshold} 章无 climax 即告警（一直平/流水账）\n"
            f"   行业规则: 每 1-3 章应有 1 个 minor_climax（3000 字一小高潮）"
        )
        issues.append(Issue(
            severity="P0",
            type="pacing_curve",
            detail=detail,
            suggestion=(
                "在下一章安排 minor_climax（打脸小喽啰/获得小宝物/赚第一笔钱等），"
                "打破流水账节奏；或在当前章纲补埋爽点节点。"
            ),
            extras={
                "sub_type": "flat_no_climax",
                "streak": no_climax_streak,
                "chapters": sorted(no_climax_chs),
                "threshold": flat_threshold,
            },
        ))

    # === 检测 2：连续 N 章压抑无释放（一直虐）===
    abuse_streak = 0
    abuse_chs: list[int] = []
    for ch in range(current_ch, max(0, current_ch - 50), -1):
        if ch not in ch_map:
            continue
        entry = ch_map[ch]
        sup = entry.get("suppression", 0)
        if sup >= sup_high:
            if has_climax_in_chapter(ch):
                break  # 有释放，中断虐待链
            abuse_streak += 1
            abuse_chs.append(ch)
        else:
            break

    if abuse_streak >= abuse_threshold:
        detail = (
            f"连续 {abuse_streak} 章压抑（suppression ≥ {sup_high}）且无 climax 释放\n"
            f"   涉及章: ch{min(abuse_chs)}-ch{max(abuse_chs)}\n"
            f"   阈值: 连续 {abuse_threshold} 章即告警（一直虐/情绪过载）\n"
            f"   行业规则: 压抑主角情节不能超过 {suppression_max} 章"
        )
        issues.append(Issue(
            severity="P0",
            type="pacing_curve",
            detail=detail,
            suggestion=(
                "下一章必须安排 climax 释放（反杀/突破/获得/打脸），"
                "或安排情绪转折（盟友救援/真相揭露/转机出现），"
                "打破虐待链避免读者弃书。"
            ),
            extras={
                "sub_type": "all_虐_no_release",
                "streak": abuse_streak,
                "chapters": sorted(abuse_chs),
                "threshold": abuse_threshold,
            },
        ))

    # === 检测 3：连续 N 章爽点无压力（一直爽）===
    all_爽_streak = 0
    all_爽_chs: list[int] = []
    for ch in range(current_ch, max(0, current_ch - 50), -1):
        if ch not in ch_map:
            continue
        entry = ch_map[ch]
        sat = entry.get("satisfaction", 0)
        if sat >= sat_high and not has_suppression_in_chapter(ch):
            all_爽_streak += 1
            all_爽_chs.append(ch)
        else:
            break

    if all_爽_streak >= all_爽_threshold:
        detail = (
            f"连续 {all_爽_streak} 章高爽点（satisfaction ≥ {sat_high}）且无压抑铺垫\n"
            f"   涉及章: ch{min(all_爽_chs)}-ch{max(all_爽_chs)}\n"
            f"   阈值: 连续 {all_爽_threshold} 章即告警（一直爽/读者很快腻）\n"
            f"   行业规则: 标准情绪曲线需要 1.平静 → 2.压力上升 → 3.危机 → 4.释放 → 5.回落"
        )
        issues.append(Issue(
            severity="P1",
            type="pacing_curve",
            detail=detail,
            suggestion=(
                "在下一章安排压力上升段（受挫/被困/被压制），"
                "为后续爽点铺垫张力；避免连续爽点导致读者疲劳。"
            ),
            extras={
                "sub_type": "all_爽_no_pressure",
                "streak": all_爽_streak,
                "chapters": sorted(all_爽_chs),
                "threshold": all_爽_threshold,
            },
        ))

    # === 检测 4：卷级 major_climax 缺失 ===
    volume = _detect_volume(vault)
    volume_records = rhythm_curve.get("volume_climax_records") or []
    has_volume_climax = any(
        isinstance(r, dict) and r.get("volume") == volume
        for r in volume_records
    )
    # 也检查 pacing_events 中是否有当前卷的 major_climax
    has_major_in_events = any(
        isinstance(e, dict)
        and e.get("event_type") == "major_climax"
        and e.get("chapter", 0) > 0
        for e in pacing_events
    )

    # 卷首章号估算：每卷约 100 章（与 pacing_rules.chapter_intervals.major_climax 对齐）
    vol_start_ch = (volume - 1) * rules.get("chapter_intervals", {}).get("major_climax", 100) + 1
    ch_in_volume = current_ch - vol_start_ch + 1

    if (
        alert_rules.get("volume_major_climax_missing", True)
        and not has_volume_climax
        and not has_major_in_events
        and ch_in_volume >= rules.get("chapter_intervals", {}).get("major_climax", 100)
    ):
        detail = (
            f"卷 {volume} 已写 {ch_in_volume} 章但无 major_climax（大爆发）事件\n"
            f"   卷首章号估算: ch{vol_start_ch}\n"
            f"   行业规则: 每卷（约 30 万字 / {rules.get('chapter_intervals', {}).get('major_climax', 100)} 章）"
            f"应有 1 个 major_climax（打败最终 Boss / 实现长期目标 / 人生逆袭）"
        )
        issues.append(Issue(
            severity="P1",
            type="pacing_curve",
            detail=detail,
            suggestion=(
                "在本卷末尾（或当前章）安排 major_climax 大爆发事件，"
                "对齐 master_outline.md 卷级规划的「卷末高潮」字段；"
                "并在 pacing_events 追加 event_type=major_climax 记录。"
            ),
            extras={
                "sub_type": "volume_major_climax_missing",
                "volume": volume,
                "vol_start_ch": vol_start_ch,
                "ch_in_volume": ch_in_volume,
            },
        ))

    return issues, None
```

#### 4.5 维度注册

在 [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) 的注册表区追加：

```python
# DIM_ALIASES 追加
DIM_ALIASES["pacing"] = "pacing_curve"
DIM_ALIASES["pacing_curve"] = "pacing_curve"
DIM_ALIASES["rhythm"] = "pacing_curve"

# ALL_DIMENSIONS 追加（在第 8 位）
ALL_DIMENSIONS.append("pacing_curve")

# DIM_LABELS 追加
DIM_LABELS["pacing_curve"] = "爽点曲线"
```

#### 4.6 编排入口

`_DIM_CHECKERS_NO_VAULT` 不含 pacing_curve（它需要 vault 参数读 rhythm_curve.json），在 `check_all` 中单独调度：

```python
# 在 check_all 函数的维度调度循环中追加：
for dim in target_dims:
    try:
        if dim == "phantom_item":
            issues, skip = check_phantom_item(body, states, vault)
        elif dim == "location_jump":
            issues, skip = check_location_jump(body, states, vault)
        elif dim == "pacing_curve":
            rhythm_data = load_rhythm_curve(vault)
            issues, skip = check_pacing_curve(body, states, rhythm_data, chapter, vault)
        elif dim in _DIM_CHECKERS_NO_VAULT:
            issues, skip = _DIM_CHECKERS_NO_VAULT[dim](body, states, hooks, chapter)
        else:
            report.skipped[dim] = f"未知维度: {dim}"
            continue
        # ... 后续逻辑不变 ...
```

### 步骤 5：rhythm_curve.json schema 升级

升级 [file:///workspace/NovelForge_Vault/.state/rhythm_curve.json](file:///workspace/NovelForge_Vault/.state/rhythm_curve.json)，保留旧字段，新增 pacing_events / volume_climax_records / 新 alert_rules 键：

```json
{
  "_comment": "节奏曲线。追踪每章爽点等级与压抑等级 + 5 级爽点事件流，防止节奏失衡。",
  "_comment_purpose": "state_update 每章追加一条 chapters 记录 + 0-N 条 pacing_events；alert_rules 触发告警时 architect 介入调整下章章纲。",
  "_comment_chapters_entry": "chapters 数组每条含：ch=章号 / satisfaction=爽点等级1-5 / suppression=压抑等级1-5 / note=备注",
  "_comment_pacing_events": "pacing_events 数组每条含：event_id / chapter / event_type(5级) / intensity(1-5) / position_in_chapter / emotion_stage / description / word_offset",
  "_comment_volume_climax": "volume_climax_records 数组每条含：volume / chapter / event_id / description —— 每卷至少 1 条 major_climax",
  "_comment_alert_rules": "alert_rules 触发告警：consecutive_low_satisfaction=连续N章爽点≤2；consecutive_high_suppression=连续N章压抑≥4；consecutive_no_climax=连续N章无climax；consecutive_suppression_no_release=连续N章压抑且无climax；consecutive_high_satisfaction_no_pressure=连续N章爽点且无压抑；volume_major_climax_missing=每卷缺major_climax则告警",
  "chapters": [],
  "pacing_events": [],
  "volume_climax_records": [],
  "alert_rules": {
    "consecutive_low_satisfaction": 3,
    "consecutive_high_suppression": 3,
    "consecutive_no_climax": 3,
    "consecutive_suppression_no_release": 5,
    "consecutive_high_satisfaction_no_pressure": 5,
    "volume_major_climax_missing": true
  }
}
```

### 步骤 6：save_state.py 支持新字段 Delta 更新

在 [file:///workspace/scripts/novelforge/save_state.py](file:///workspace/scripts/novelforge/save_state.py) 追加 rhythm_curve 路由支持。

#### 6.1 路由扩展

```python
# 顶部常量追加
RHYTHM_CURVE_REL: str = ".state/rhythm_curve.json"

# 默认模板追加
EMPTY_RHYTHM_CURVE: dict[str, Any] = {
    "chapters": [],
    "pacing_events": [],
    "volume_climax_records": [],
    "alert_rules": {
        "consecutive_low_satisfaction": 3,
        "consecutive_high_suppression": 3,
        "consecutive_no_climax": 3,
        "consecutive_suppression_no_release": 5,
        "consecutive_high_satisfaction_no_pressure": 5,
        "volume_major_climax_missing": True,
    },
}
```

在 `_route_path` 函数追加分支：

```python
if root == "rhythm_curve":
    file_abs = _state_file_path(vault, RHYTHM_CURVE_REL)
    return PathTarget("rhythm_curve", file_abs, None, rest)
```

#### 6.2 op 应用辅助

```python
def _apply_op_to_rhythm_curve(
    state: dict[str, Any],
    op: dict[str, Any],
    sub_path: list[str],
) -> None:
    """在 rhythm_curve.json 上执行 op。

    特殊处理：
    - 无 sub_path + op=merge → 合并到根对象
    - 无 sub_path + op=append → 追加到 pacing_events 数组（默认行为）
    - sub_path=pacing_events + op=append → 追加事件
    - sub_path=chapters + op=append → 追加章记录
    - sub_path=volume_climax_records + op=append → 追加卷记录
    - sub_path=alert_rules/<key> + op=set → 设置阈值
    """
    op_name = op["op"]
    value = op.get("value")

    if not sub_path:
        if op_name == "append":
            # 默认追加到 pacing_events
            if not isinstance(value, dict):
                raise ValueError("rhythm_curve append 需要 dict value")
            events = state.setdefault("pacing_events", [])
            # 自动补 event_id（若未提供）
            if "event_id" not in value:
                max_n = 0
                for e in events:
                    eid = e.get("event_id", "") if isinstance(e, dict) else ""
                    if isinstance(eid, str) and eid.startswith("P-"):
                        try:
                            max_n = max(max_n, int(eid[2:]))
                        except ValueError:
                            pass
                value = {**value, "event_id": f"P-{max_n + 1:03d}"}
            events.append(copy.deepcopy(value))
        elif op_name == "merge":
            if not isinstance(value, dict):
                raise ValueError("rhythm_curve merge 需要 dict value")
            _deep_merge(state, copy.deepcopy(value))
        elif op_name == "set":
            if not isinstance(value, dict):
                raise ValueError("rhythm_curve set 需要 dict value")
            state.clear()
            state.update(copy.deepcopy(value))
        else:
            raise ValueError(f"rhythm_curve 整对象不支持 op={op_name}")
        return

    # 有 sub_path：按通用方式导航
    _apply_op_to_dict(state, op, sub_path)
```

#### 6.3 _apply_op 调度扩展

在 `_apply_op` 函数中追加分支：

```python
elif target.kind == "rhythm_curve":
    if target.file_abs not in file_states:
        file_states[target.file_abs] = _load_json(
            target.file_abs, EMPTY_RHYTHM_CURVE
        )
    state = file_states[target.file_abs]
    _apply_op_to_rhythm_curve(state, op, target.sub_path)
    # 校验
    errors = validate_rhythm_curve(state)
    if errors:
        raise ValueError(
            f"rhythm_curve 校验失败: {'; '.join(errors)}"
        )
    return target.file_abs
```

同时在文件顶部 import 处追加：

```python
try:
    from .schema import (
        validate_character_state,
        validate_foreshadow,
        validate_delta,
        validate_rhythm_curve,  # 新增
    )
except ImportError:
    from scripts.novelforge.schema import (  # type: ignore
        validate_character_state,
        validate_foreshadow,
        validate_delta,
        validate_rhythm_curve,  # 新增
    )
```

#### 6.4 Delta JSON 示例（writer-polisher 调用）

```json
{
  "chapter": "ch_042",
  "mode": "novel",
  "ops": [
    {
      "op": "append",
      "path": "rhythm_curve/chapters",
      "value": {"ch": 42, "satisfaction": 4, "suppression": 2, "note": "打脸韩家嫡女，金手指共鸣"}
    },
    {
      "op": "append",
      "path": "rhythm_curve/pacing_events",
      "value": {
        "event_id": "P-042",
        "chapter": 42,
        "event_type": "minor_climax",
        "intensity": 3,
        "position_in_chapter": "ending",
        "emotion_stage": "climax_release",
        "description": "拍卖会金手指共鸣，打脸韩家嫡女",
        "word_offset": 2400
      }
    }
  ]
}
```

### 步骤 7：architect SKILL.md 卷纲/章纲预埋爽点节点

在 [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) §5.1 章纲十段模板「八、节奏标记」段落追加「5 级爽点节点预埋」子段：

```markdown
## 八、节奏标记
- 爽点值（1-5）：N
- 压抑值（1-5）：N
- 情绪走向：上扬/下沉/转折

### 八.1 5 级爽点节点预埋（必填，M13 强制）
- micro_stimulation（300 字一小刺激）：__（如「韩家嫡女冷笑一声」）__
- minor_conflict（1000 字一小冲突）：__（如「主角与韩家嫡女竞价」）__
- minor_climax（3000 字一小高潮）：__（如「金手指共鸣，残破玉简认主」）__
- medium_climax（如有，每 10-20 章 1 次）：__（如「击败拍卖会守护傀儡」）__
- major_climax（如有，每卷 1 次）：__（如「揭开玉简真相，主角实力跃迁」）__

> 章纲必须至少预埋 1 个 micro_stimulation + 1 个 minor_climax（或更高），
> 否则 check_consistency.py 的 pacing_curve 维度会判定为"流水账"告警。
```

在 §5.2 卷大纲模板「节奏曲线（爽点分布）」段落追加：

```markdown
## 节奏曲线（爽点分布）

### 卷级 major_climax 计划（M13 强制）
- 卷内 major_climax 章号：ch_NNN（建议卷末前 1-3 章）
- major_climax 事件描述：__（如「主角击败宗门叛徒，夺回师门遗物」）__
- major_climax 前置铺垫章号：ch_NNN（建议 major_climax 前 5-10 章开始压力上升）

### 卷内 medium_climax 计划（每 10-20 章 1 次）
| 章号 | 事件 | 强度 |
|---|---|---|
| ch_NNN | __ | 4 |

### 卷内 minor_climax 分布（每 1-3 章 1 次）
> 列出本卷全部 minor_climax 章号 + 一句话描述，确保无连续 3 章空白。

> check_consistency.py 会按章扫描 pacing_events，卷末无 major_climax 即告警。
```

### 步骤 8：writer-polisher SKILL.md 每章后更新 pacing_events

在 [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) §阶段四状态更新「第 2 步构造 Delta JSON」之后追加：

```markdown
### 第 2.5 步：追加 pacing_events 到 rhythm_curve.json（M13 强制）

> novel 模式必须执行；shortform 模式跳过。

从本章正文与章纲「八.1 5 级爽点节点预埋」提取实际兑现的爽点事件，
构造 Delta 追加到 rhythm_curve.json。

#### 提取规则

1. 遍历章纲预埋的 5 级爽点节点，对照正文确认是否兑现：
   - 兑现的节点 → 构造 pacing_event 追加
   - 未兑现的节点 → 在精修阶段补回或调整章纲
2. 每个事件必填字段：event_id / chapter / event_type / intensity / position_in_chapter / emotion_stage / description
3. event_id 自增：取 rhythm_curve.json 中现有最大 P-NNN 序号 +1
4. event_type 与 intensity 严格对应（参见 PACING_INTENSITY_MAP）

#### Delta JSON 模板

```json
{
  "chapter": "ch_042",
  "mode": "novel",
  "ops": [
    {
      "op": "append",
      "path": "rhythm_curve/chapters",
      "value": {
        "ch": 42,
        "satisfaction": 4,
        "suppression": 2,
        "note": "拍卖会打脸韩家嫡女"
      }
    },
    {
      "op": "append",
      "path": "rhythm_curve/pacing_events",
      "value": {
        "event_id": "P-042",
        "chapter": 42,
        "event_type": "minor_climax",
        "intensity": 3,
        "position_in_chapter": "ending",
        "emotion_stage": "climax_release",
        "description": "金手指共鸣，残破玉简认主，打脸韩家嫡女",
        "word_offset": 2400
      }
    }
  ]
}
```

#### 卷末章追加 volume_climax_records

若本章是 major_climax 事件（卷末大爆发），额外追加：

```json
{
  "op": "append",
  "path": "rhythm_curve/volume_climax_records",
  "value": {
    "volume": 1,
    "chapter": 100,
    "event_id": "P-100",
    "description": "主角击败宗门叛徒，夺回师门遗物，实力跃迁"
  }
}
```

#### 调用命令

```bash
python -m scripts.novelforge.save_state --json '<delta_json>'
```

#### 验证

执行后跑一次 check_consistency 确认 pacing_curve 维度无新增告警：

```bash
python -m scripts.novelforge.check_consistency --chapter <N> --dim pacing_curve --json
```

若返回 P0 告警（连续 3 章无 climax / 连续 5 章压抑无释放），返回阶段三精修，
在本章补 climax 释放场景后重跑。
```

### 步骤 9：dev-checklist.md 新增检测项

在 [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) §三一致性追加：

```markdown
- [ ] 爽点曲线：`python scripts/novelforge/check_consistency.py --vault NovelForge_Vault --dim pacing_curve` 通过（合并前必须完成）
- [ ] 连续 3 章无 climax 释放告警已处理（P0，一直平/流水账）
- [ ] 连续 5 章压抑无释放告警已处理（P0，一直虐/情绪过载）
- [ ] 卷级 major_climax 缺失告警已处理（P1，每卷必须有 1 次大爆发）
- [ ] 连续 5 章高爽点无压力告警已处理（P1，一直爽/读者疲劳）
- [ ] rhythm_curve.json 的 pacing_events 已按章追加（writer-polisher 阶段四第 2.5 步）
- [ ] 章纲「八.1 5 级爽点节点预埋」子段已填写且正文已兑现
```

在 §一创作质量追加：

```markdown
- [ ] 5 级爽点节点预埋齐全：章纲至少预埋 1 个 micro_stimulation + 1 个 minor_climax（或更高）
- [ ] 标准情绪曲线五段式闭环：本章 pacing_events 至少覆盖「压力上升 → 危机顶点 → 爽点释放」三段
```

---

## 六、验证方式

### 6.1 单元测试

```bash
pytest -q tests/test_pacing_curve.py
```

预期：7 个测试用例全部通过。

### 6.2 集成测试

构造一个含连续 3 章无 climax 的 rhythm_curve.json 测试 fixture，跑：

```bash
# 准备测试 Vault（在 tests/fixtures/pacing_vault/）
# 含 rhythm_curve.json：chapters 有 ch_001-005 数据，pacing_events 只在 ch_001 有 minor_climax

python -m scripts.novelforge.check_consistency \
  --chapter 5 \
  --vault tests/fixtures/pacing_vault \
  --dim pacing_curve \
  --json
```

预期输出 JSON 含：
```json
{
  "issues": [
    {
      "severity": "P0",
      "type": "pacing_curve",
      "extras": {
        "sub_type": "flat_no_climax",
        "streak": 3,
        "chapters": [3, 4, 5],
        "threshold": 3
      }
    }
  ]
}
```

### 6.3 断言清单

| # | 断言 | 期望 |
|---|---|---|
| 1 | 5 级爽点可识别 | PACING_EVENT_TYPES 含 5 个枚举值，PACING_INTENSITY_MAP 1-5 对应 |
| 2 | 连续 3 章无爽点告警 | check_pacing_curve 返回 P0 issue，sub_type=flat_no_climax |
| 3 | 连续 5 章压抑告警 | check_pacing_curve 返回 P0 issue，sub_type=all_虐_no_release |
| 4 | 卷级大爽点缺失告警 | check_pacing_curve 返回 P1 issue，sub_type=volume_major_climax_missing |
| 5 | 一直爽告警 | check_pacing_curve 返回 P1 issue，sub_type=all_爽_no_pressure |
| 6 | pacing_rules.json 缺失时 fallback | load_pacing_rules 返回 DEFAULT_PACING_RULES |
| 7 | rhythm_curve.json 缺失时跳过 | check_pacing_curve 返回 skip_reason 非 None |

---

## 七、回归测试要求

### 7.1 新增测试文件

新建 [file:///workspace/tests/test_pacing_curve.py](file:///workspace/tests/test_pacing_curve.py)，至少 7 个测试用例：

```python
"""M13 爽点曲线量化检测回归测试。

覆盖：
1. pacing_rules.json 格式校验
2. 5 级爽点识别（micro_stimulation / minor_climax 等）
3. 连续 3 章无 climax 告警（一直平）
4. 连续 5 章压抑无释放告警（一直虐）
5. 卷级 major_climax 缺失告警
6. 三种绝对错误节奏识别（一直平 / 一直爽 / 一直虐）
7. rhythm_curve.json 缺失时跳过 + pacing_rules.json 缺失时 fallback
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# 将仓库根加入 sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.novelforge.check_consistency import (  # noqa: E402
    check_pacing_curve,
    load_pacing_rules,
    DEFAULT_PACING_RULES,
    PACING_EVENT_TYPES,
    PACING_INTENSITY_MAP,
    CLIMAX_EVENT_TYPES,
)
from scripts.novelforge.schema import (  # noqa: E402
    validate_pacing_event,
    validate_rhythm_curve,
    PACING_EVENT_SCHEMA,
    RHYTHM_CURVE_SCHEMA,
)


# ============================================================================
# 1. pacing_rules.json 格式校验
# ============================================================================
def test_pacing_rules_json_valid():
    """pacing_rules.json 必须存在且字段齐全。"""
    rules_path = ROOT / "scripts" / "novelforge" / "data" / "pacing_rules.json"
    assert rules_path.is_file(), f"pacing_rules.json 不存在: {rules_path}"

    with open(rules_path, "r", encoding="utf-8") as f:
        rules = json.load(f)

    # 必填字段
    assert "word_thresholds" in rules
    assert "chapter_intervals" in rules
    assert "wrong_rhythm_thresholds" in rules
    assert "suppression_max_chapters" in rules

    # 5 级阈值齐全
    wt = rules["word_thresholds"]
    assert wt["micro_stimulation"] == 300
    assert wt["minor_conflict"] == 1000
    assert wt["minor_climax"] == 3000
    assert wt["medium_climax"] == 10000
    assert wt["major_climax"] == 300000

    # 三种错误节奏阈值
    wr = rules["wrong_rhythm_thresholds"]
    assert wr["flat_chapters"] == 3
    assert wr["all_爽_chapters"] == 5
    assert wr["all_虐_chapters"] == 5

    # 加载函数与文件一致
    loaded = load_pacing_rules()
    assert loaded["word_thresholds"]["minor_climax"] == 3000


# ============================================================================
# 2. 5 级爽点识别（micro_stimulation 等）
# ============================================================================
def test_micro_stimulation_detection():
    """5 级爽点类型枚举与强度映射正确。"""
    assert len(PACING_EVENT_TYPES) == 5
    assert "micro_stimulation" in PACING_EVENT_TYPES
    assert "minor_conflict" in PACING_EVENT_TYPES
    assert "minor_climax" in PACING_EVENT_TYPES
    assert "medium_climax" in PACING_EVENT_TYPES
    assert "major_climax" in PACING_EVENT_TYPES

    # 强度映射
    assert PACING_INTENSITY_MAP["micro_stimulation"] == 1
    assert PACING_INTENSITY_MAP["minor_climax"] == 3
    assert PACING_INTENSITY_MAP["major_climax"] == 5

    # climax 释放型事件
    assert "minor_climax" in CLIMAX_EVENT_TYPES
    assert "medium_climax" in CLIMAX_EVENT_TYPES
    assert "major_climax" in CLIMAX_EVENT_TYPES
    assert "micro_stimulation" not in CLIMAX_EVENT_TYPES

    # schema 校验：micro_stimulation 事件
    evt = {
        "event_id": "P-001",
        "chapter": 1,
        "event_type": "micro_stimulation",
        "intensity": 1,
        "position_in_chapter": "opening",
        "emotion_stage": "calm",
        "description": "韩家嫡女冷笑一声",
    }
    assert validate_pacing_event(evt) == []

    # 强度不匹配应报错
    bad_evt = {**evt, "intensity": 5}
    errors = validate_pacing_event(bad_evt)
    assert any("不匹配" in e for e in errors)


def test_minor_climax_detection():
    """minor_climax 事件可被正确识别为 climax 释放型。"""
    rhythm_curve = {
        "chapters": [
            {"ch": 1, "satisfaction": 4, "suppression": 2, "note": "打脸"},
        ],
        "pacing_events": [
            {
                "event_id": "P-001",
                "chapter": 1,
                "event_type": "minor_climax",
                "intensity": 3,
                "position_in_chapter": "ending",
                "emotion_stage": "climax_release",
                "description": "金手指共鸣",
            }
        ],
        "alert_rules": {},
    }
    # 当前章 ch=1 有 climax，不应触发 flat_no_climax
    issues, skip = check_pacing_curve("", {}, rhythm_curve, 1, "/tmp/fake_vault")
    assert skip is None
    sub_types = [i.extras.get("sub_type") for i in issues]
    assert "flat_no_climax" not in sub_types


# ============================================================================
# 3. 连续 3 章无 climax 告警
# ============================================================================
def test_consecutive_3_chapters_no_climax():
    """连续 3 章无 climax 释放 → P0 flat_no_climax 告警。"""
    rhythm_curve = {
        "chapters": [
            {"ch": 1, "satisfaction": 3, "suppression": 2, "note": "ch1"},
            {"ch": 2, "satisfaction": 2, "suppression": 2, "note": "ch2"},
            {"ch": 3, "satisfaction": 2, "suppression": 3, "note": "ch3"},
            {"ch": 4, "satisfaction": 1, "suppression": 2, "note": "ch4"},
            {"ch": 5, "satisfaction": 2, "suppression": 2, "note": "ch5"},
        ],
        "pacing_events": [
            # 只有 ch1 有 climax，ch3-5 连续 3 章无
            {"event_id": "P-001", "chapter": 1, "event_type": "minor_climax",
             "intensity": 3, "position_in_chapter": "ending",
             "emotion_stage": "climax_release", "description": "ch1 climax"},
        ],
        "alert_rules": {},
    }
    issues, skip = check_pacing_curve("", {}, rhythm_curve, 5, "/tmp/fake_vault")
    assert skip is None

    flat_issues = [i for i in issues if i.extras.get("sub_type") == "flat_no_climax"]
    assert len(flat_issues) == 1
    assert flat_issues[0].severity == "P0"
    assert flat_issues[0].extras["streak"] == 4  # ch2/3/4/5 连续 4 章无 climax
    assert set(flat_issues[0].extras["chapters"]) == {2, 3, 4, 5}


# ============================================================================
# 4. 连续 5 章压抑无释放告警
# ============================================================================
def test_consecutive_5_chapters_suppression():
    """连续 5 章 suppression ≥ 4 且无 climax → P0 all_虐_no_release 告警。"""
    rhythm_curve = {
        "chapters": [
            {"ch": 1, "satisfaction": 1, "suppression": 4, "note": "被陷害"},
            {"ch": 2, "satisfaction": 1, "suppression": 5, "note": "被追杀"},
            {"ch": 3, "satisfaction": 1, "suppression": 5, "note": "灵根被废"},
            {"ch": 4, "satisfaction": 1, "suppression": 4, "note": "被围攻"},
            {"ch": 5, "satisfaction": 1, "suppression": 5, "note": "绝望"},
        ],
        "pacing_events": [],  # 无任何 climax
        "alert_rules": {},
    }
    issues, skip = check_pacing_curve("", {}, rhythm_curve, 5, "/tmp/fake_vault")
    assert skip is None

    abuse_issues = [i for i in issues if i.extras.get("sub_type") == "all_虐_no_release"]
    assert len(abuse_issues) == 1
    assert abuse_issues[0].severity == "P0"
    assert abuse_issues[0].extras["streak"] == 5
    assert set(abuse_issues[0].extras["chapters"]) == {1, 2, 3, 4, 5}


# ============================================================================
# 5. 卷级 major_climax 缺失告警
# ============================================================================
def test_volume_level_major_climax_missing(tmp_path, monkeypatch):
    """卷 1 写满 100 章但无 major_climax → P1 volume_major_climax_missing 告警。"""
    # 构造 pipeline.json 让 _detect_volume 返回 1
    vault = tmp_path / "vault"
    state_dir = vault / ".state"
    state_dir.mkdir(parents=True)
    (state_dir / "pipeline.json").write_text(
        json.dumps({"current_volume": 1, "current_chapter": 100}),
        encoding="utf-8",
    )

    # 构造 rhythm_curve：100 章数据，无 major_climax
    chapters = [
        {"ch": i, "satisfaction": 3, "suppression": 2, "note": f"ch{i}"}
        for i in range(1, 101)
    ]
    rhythm_curve = {
        "chapters": chapters,
        "pacing_events": [
            {"event_id": f"P-{i:03d}", "chapter": i, "event_type": "minor_climax",
             "intensity": 3, "position_in_chapter": "ending",
             "emotion_stage": "climax_release", "description": f"ch{i} climax"}
            for i in range(1, 101)
        ],
        "volume_climax_records": [],  # 卷 1 无 major_climax
        "alert_rules": {"volume_major_climax_missing": True},
    }

    issues, skip = check_pacing_curve("", {}, rhythm_curve, 100, str(vault))
    assert skip is None

    vol_issues = [i for i in issues if i.extras.get("sub_type") == "volume_major_climax_missing"]
    assert len(vol_issues) == 1
    assert vol_issues[0].severity == "P1"
    assert vol_issues[0].extras["volume"] == 1


# ============================================================================
# 6. 三种绝对错误节奏识别
# ============================================================================
def test_three_wrong_rhythms_detection():
    """三种绝对错误节奏（一直平 / 一直爽 / 一直虐）均可被识别。"""
    # 一直平：连续 5 章无 climax 且 suppression 低
    flat_curve = {
        "chapters": [
            {"ch": i, "satisfaction": 2, "suppression": 2, "note": f"ch{i}"}
            for i in range(1, 6)
        ],
        "pacing_events": [],
        "alert_rules": {},
    }
    issues, _ = check_pacing_curve("", {}, flat_curve, 5, "/tmp/fake_vault")
    sub_types = [i.extras.get("sub_type") for i in issues]
    assert "flat_no_climax" in sub_types

    # 一直爽：连续 5 章 satisfaction ≥ 4 且无 suppression ≥ 3
    all_爽_curve = {
        "chapters": [
            {"ch": i, "satisfaction": 5, "suppression": 1, "note": f"ch{i}"}
            for i in range(1, 6)
        ],
        "pacing_events": [
            {"event_id": f"P-{i}", "chapter": i, "event_type": "minor_climax",
             "intensity": 3, "position_in_chapter": "ending",
             "emotion_stage": "climax_release", "description": "climax"}
            for i in range(1, 6)
        ],
        "alert_rules": {},
    }
    issues, _ = check_pacing_curve("", {}, all_爽_curve, 5, "/tmp/fake_vault")
    sub_types = [i.extras.get("sub_type") for i in issues]
    assert "all_爽_no_pressure" in sub_types

    # 一直虐：连续 5 章 suppression ≥ 4 且无 climax
    all_虐_curve = {
        "chapters": [
            {"ch": i, "satisfaction": 1, "suppression": 5, "note": f"ch{i}"}
            for i in range(1, 6)
        ],
        "pacing_events": [],
        "alert_rules": {},
    }
    issues, _ = check_pacing_curve("", {}, all_虐_curve, 5, "/tmp/fake_vault")
    sub_types = [i.extras.get("sub_type") for i in issues]
    assert "all_虐_no_release" in sub_types


# ============================================================================
# 7. 边界：rhythm_curve 缺失跳过 + pacing_rules fallback
# ============================================================================
def test_rhythm_curve_missing_skips():
    """rhythm_curve.json 缺失时跳过检测，不报错。"""
    issues, skip = check_pacing_curve("", {}, {}, 5, "/tmp/fake_vault")
    assert issues == []
    assert skip is not None
    assert "rhythm_curve" in skip


def test_pacing_rules_fallback():
    """pacing_rules.json 缺失时 fallback 到 DEFAULT_PACING_RULES。"""
    # load_pacing_rules 在文件缺失时返回 DEFAULT_PACING_RULES
    rules = load_pacing_rules()
    assert "word_thresholds" in rules
    assert rules["word_thresholds"]["minor_climax"] == 3000
    assert rules["wrong_rhythm_thresholds"]["flat_chapters"] == 3
```

### 7.2 新增 BUG-063

在 [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) 末尾追加：

```markdown
## BUG-063：爽点曲线无量化检测导致节奏失控

- **首次出现**：2026-07-18
- **类型**：一致性 / 节奏曲线
- **现象**：NovelForge 已有 rhythm_curve.json 但 check_consistency.py 未读取此文件做告警，alert_rules 形同虚设。AI 写长篇时出现连续 3 章无爽点（流水账）/ 连续 5 章压抑无释放（情绪过载）/ 卷末无大爆发（烂尾）三类典型节奏失控问题，无任何脚本检测拦截。
- **根因**：rhythm_curve.json 的 alert_rules 字段（consecutive_low_satisfaction / consecutive_high_suppression）只是数据声明，无执行入口；check_consistency.py 7 类检测维度中无节奏曲线维度；save_state.py 路由表未含 rhythm_curve，writer-polisher 无法通过 Delta 增量更新 pacing_events。
- **修复**：
  1. check_consistency.py 新增第 8 维度 `pacing_curve`：检测连续 3 章无 climax / 连续 5 章压抑无释放 / 卷级 major_climax 缺失 / 一直爽四种告警。
  2. rhythm_curve.json schema 升级：新增 pacing_events 数组（5 级量化）+ volume_climax_records 数组 + 3 个新 alert_rules 键。
  3. save_state.py 路由表新增 rhythm_curve kind，支持 Delta append pacing_events。
  4. schema.py 新增 RHYTHM_CURVE_SCHEMA / PACING_EVENT_SCHEMA / validate_rhythm_curve / validate_pacing_event。
  5. 新增 pacing_rules.json（SSOT 阈值配置）+ DEFAULT_PACING_RULES fallback。
  6. architect SKILL.md 章纲/卷纲模板新增「5 级爽点节点预埋」子段。
  7. writer-polisher SKILL.md 阶段四新增「第 2.5 步：追加 pacing_events」。
  8. dev-checklist.md 新增 7 项爽点曲线检测项。
- **涉及文件**：
  - scripts/novelforge/check_consistency.py
  - scripts/novelforge/save_state.py
  - scripts/novelforge/schema.py
  - scripts/novelforge/data/pacing_rules.json（新增）
  - NovelForge_Vault/.state/rhythm_curve.json
  - .trae/skills/architect/SKILL.md
  - .trae/skills/writer-polisher/SKILL.md
  - .trae/checklists/dev-checklist.md
- **回归测试**：tests/test_pacing_curve.py 共 7 个测试用例
  - test_pacing_rules_json_valid
  - test_micro_stimulation_detection
  - test_minor_climax_detection
  - test_consecutive_3_chapters_no_climax
  - test_consecutive_5_chapters_suppression
  - test_volume_level_major_climax_missing
  - test_three_wrong_rhythms_detection
- **教训/沉淀**：状态机文件的 alert_rules 字段不能只做"数据声明"，必须有对应的执行入口（check_*.py 检测维度）；新增状态机字段时必须同步：(1) schema.py 校验 → (2) save_state.py 路由 → (3) check_consistency.py 检测 → (4) Skill 写入指令 → (5) checklist 检测项，五环缺一即失效。本 bug 暴露了"状态机字段创建后未在检测层落地"的共性问题，已在 dev-checklist.md §三追加检测项防止复发。
```

### 7.3 完整测试集执行

修复完成后必须执行完整测试集（参见 [file:///workspace/.trae/rules/bug-reporting.md](file:///workspace/.trae/rules/bug-reporting.md) §五）：

```bash
# 一致性检测
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault

# 去 AI 味检测
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault

# 单元测试
pytest -q tests/test_pacing_curve.py
pytest -q

# 涉及具体章节的 bug，重新生成/校验该章节确认修复
python -m scripts.novelforge.check_consistency --chapter <N> --dim pacing_curve --json
```

---

## 八、风险点与回滚方案

### 8.1 风险等级

**中**（需调参，可能误判）

### 8.2 主要风险

| # | 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|---|
| 1 | pacing_rules.json 阈值过严，误判人类写作风格（如慢热型作品前 5 章本就是铺垫） | 中 | P0 误报阻断保存 | 阈值集中在 pacing_rules.json，作者可调；rhythm_curve.alert_rules 可单卷覆盖；--strict 模式才阻断 |
| 2 | 卷级 major_climax 检测依赖卷首章号估算（每卷 100 章），实际卷长可能差异大 | 中 | P1 误报 | 卷首章号基于 pipeline.json 的 current_volume 计算，可被 master_outline.md 的实际卷长覆盖；阈值 chapter_intervals.major_climax 可调 |
| 3 | writer-polisher 漏写 pacing_events，导致 rhythm_curve 数据缺失 | 高 | 检测降级为跳过 | dev-checklist.md 新增「pacing_events 已按章追加」检测项；writer-polisher SKILL.md 第 2.5 步为强制步骤 |
| 4 | save_state.py 路由新增 rhythm_curve kind 后，旧 Delta JSON 兼容性 | 低 | 旧 Delta 仍可正常应用 | rhythm_curve 路由只对 path 以 "rhythm_curve/" 开头的 op 生效，不影响其他 path |
| 5 | check_pacing_curve 在 chapters 数据稀疏时（前 5 章只有 1-2 条记录）误判 | 中 | P0 误报 | 检测逻辑使用 `if ch not in ch_map: continue` 跳过无数据章节，streak 只统计有数据的章节 |
| 6 | pacing_events 的 event_id 冲突（手动写入与 save_state 自动生成冲突） | 低 | 数据完整性 | save_state.py 的 _apply_op_to_rhythm_curve 自动检测 max P-NNN 序号 +1，手动 event_id 优先保留 |

### 8.3 对核心资产的影响

本模块修改的核心资产：

| 文件 | 影响范围 | 可回滚性 |
|---|---|---|
| [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) | 新增第 8 维度，不改现有 7 维度逻辑 | 高（删除新增代码块即可） |
| [file:///workspace/NovelForge_Vault/.state/rhythm_curve.json](file:///workspace/NovelForge_Vault/.state/rhythm_curve.json) | schema 升级，保留旧字段 | 高（旧字段未删除，回滚后旧数据仍可用） |
| [file:///workspace/scripts/novelforge/save_state.py](file:///workspace/scripts/novelforge/save_state.py) | 路由表新增 kind，不改现有 4 种 kind | 高（删除 rhythm_curve 分支即可） |
| [file:///workspace/scripts/novelforge/schema.py](file:///workspace/scripts/novelforge/schema.py) | 新增 schema 与校验函数，不改现有 | 高（删除新增即可） |
| [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) | 模板新增子段，不改现有 | 高（删除新增子段即可） |
| [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | 阶段四新增第 2.5 步 | 高（删除新增步骤即可） |
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 新增检测项 | 高（删除新增项即可） |

### 8.4 回滚方案

**分支策略**：在 `feature/pacing-curve` 分支开发，独立 PR 合并。

**回滚步骤**：

1. **代码回滚**：
   ```bash
   git revert <merge_commit_sha>
   # 或
   git checkout master -- scripts/novelforge/check_consistency.py
   git checkout master -- scripts/novelforge/save_state.py
   git checkout master -- scripts/novelforge/schema.py
   git checkout master -- .trae/skills/architect/SKILL.md
   git checkout master -- .trae/skills/writer-polisher/SKILL.md
   git checkout master -- .trae/checklists/dev-checklist.md
   ```

2. **数据回滚**：rhythm_curve.json 的旧字段（chapters / alert_rules 旧键）未删除，无需回滚数据；新增的 pacing_events / volume_climax_records 数组可保留为空数组（不影响旧逻辑）。

3. **测试回滚**：删除 tests/test_pacing_curve.py 与 tests/fixtures/pacing_vault/（如有）。

4. **bug_regression_list.md 回滚**：保留 BUG-063 记录（即使回滚也作为历史教训），但标注「已回滚，待重新实施」。

5. **验证回滚**：
   ```bash
   pytest -q  # 确保现有测试不受影响
   python scripts/novelforge/check_consistency.py --vault NovelForge_Vault  # 7 维度仍正常
   ```

---

## 九、完成标准（DoD 清单）

- [ ] [file:///workspace/scripts/novelforge/data/pacing_rules.json](file:///workspace/scripts/novelforge/data/pacing_rules.json) 创建，含 5 级阈值 + 三种错误节奏阈值 + suppression_max_chapters
- [ ] [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) 新增 `pacing_curve` 检测维度（第 8 维度），含 `check_pacing_curve` / `load_rhythm_curve` / `load_pacing_rules` 函数
- [ ] [file:///workspace/NovelForge_Vault/.state/rhythm_curve.json](file:///workspace/NovelForge_Vault/.state/rhythm_curve.json) schema 升级，新增 pacing_events / volume_climax_records / 3 个新 alert_rules 键
- [ ] [file:///workspace/scripts/novelforge/schema.py](file:///workspace/scripts/novelforge/schema.py) 新增 RHYTHM_CURVE_SCHEMA / PACING_EVENT_SCHEMA / PACING_RULES_SCHEMA / validate_rhythm_curve / validate_pacing_event
- [ ] [file:///workspace/scripts/novelforge/save_state.py](file:///workspace/scripts/novelforge/save_state.py) 路由表新增 rhythm_curve kind，支持 Delta append pacing_events
- [ ] [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) 章纲模板新增「八.1 5 级爽点节点预埋」子段；卷大纲模板新增「卷级 major_climax 计划」子段
- [ ] [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) 阶段四新增「第 2.5 步：追加 pacing_events 到 rhythm_curve.json」
- [ ] [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) 新增 7 项爽点曲线检测项
- [ ] [file:///workspace/tests/test_pacing_curve.py](file:///workspace/tests/test_pacing_curve.py) 创建，7 个测试用例全部通过：
  - [ ] test_pacing_rules_json_valid
  - [ ] test_micro_stimulation_detection
  - [ ] test_minor_climax_detection
  - [ ] test_consecutive_3_chapters_no_climax
  - [ ] test_consecutive_5_chapters_suppression
  - [ ] test_volume_level_major_climax_missing
  - [ ] test_three_wrong_rhythms_detection
- [ ] [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) 新增 BUG-063「爽点曲线无量化检测导致节奏失控」
- [ ] 完整测试集通过：`pytest -q` + `check_consistency.py --vault NovelForge_Vault` + `check_ai_novel.py --vault NovelForge_Vault`
- [ ] loop_log 当月分片追加 1 条沉淀记录（#lesson slug: `plot_structure` / `content_quality`），说明"状态机字段创建后必须在检测层落地"的共性教训
- [ ] 提交信息符合规范：`feat(novelforge): 新增爽点曲线量化检测（M13）` / `state(rhythm_curve): 升级 schema 新增 pacing_events` / `test(pacing_curve): 新增 7 个回归用例`

---

## 附录：与现有检测的边界划分

| 检测项 | 现有归属 | M13 后归属 | 边界说明 |
|---|---|---|---|
| 爽点模式雷同（连续 3 章重复同一爽点类型） | check_ai_novel.py `check_plot_cliche` (P1) | 不变 | M13 不重复检测，专注"缺失"而非"雷同" |
| 章末钩子缺失 | check_ai_novel.py `check_chapter_end_hook` (P0) | 不变 | M13 不检测单章钩子，专注跨章节奏 |
| 连续 3 章无 climax 释放 | 无 | check_consistency.py `pacing_curve` (P0) | M13 新增 |
| 连续 5 章压抑无释放 | 无 | check_consistency.py `pacing_curve` (P0) | M13 新增 |
| 卷级 major_climax 缺失 | 无 | check_consistency.py `pacing_curve` (P1) | M13 新增 |
| 一直爽（连续 5 章高爽点无压力） | 无 | check_consistency.py `pacing_curve` (P1) | M13 新增 |

**核心边界**：`check_ai_novel.py` 管单章内部质量（章末钩子 / 信息倾倒 / 爽点套路化），`check_consistency.py` 的 `pacing_curve` 管跨章节奏曲线（连续 N 章的爽点分布）。两者互补不冲突。
