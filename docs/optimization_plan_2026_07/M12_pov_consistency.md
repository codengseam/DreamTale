# M12 · 多 POV 视角一致性检测

> **层级**：L3 · 补齐盲区能力
> **依赖**：无（独立模块；可叠加复用 M3 的 SSOT 数据流模式与 M9 的 `data/` 目录约定，但无强依赖）
> **下游**：M20（开发自检清单升级，汇总 POV 检测项）、M14（拟议·跨章 POV 一致性，扩展为卷级 POV 调度）

---

## 一、模块目标

- **一句话目标**：在 [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) 新增第 8 类检测 `pov_switch_in_chapter`（P1 警告），并在章纲模板中强制声明规范化 POV 字段（5 种枚举值），把"单章一 POV"原则从人工 polisher 兜底升级为脚本自动门禁。
- **对应的痛点**：长篇小说多 POV 切换是常见痛点，AI 容易在单章内无故切换视角（如从主角第三人称限知突然切到上帝视角或配角内心独白），破坏读者沉浸感。当前 [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) 第 16 行虽有"视角一致：未在单章内无故切换 POV"的人工 checklist 项，[file:///workspace/NovelForge_Vault/00_控制面/style_guide.md](file:///workspace/NovelForge_Vault/00_控制面/style_guide.md) 第 26 行也把"视角混乱"列为 P0 绝对禁用，但仅靠章纲"POV：主角（第三人称限知）"自由文本声明 + 人工 polisher 兜底，无脚本自动检测。
- **完成后达成的能力**：
  1. **自动检测 POV 切换**：扫描正文段落，与章纲声明 POV 比对，发现 ≥ 2 段其他 POV 特征即生成 P1 警告，附段落定位与证据。
  2. **章纲 POV 字段强制**：章纲模板"一、章节信息"段落强制声明 POV 枚举值（`first_person` / `third_limited` / `third_omniscient` / `second_person` / `multi_pov_explicit`）；缺失时 P2 提示。
  3. **多 POV 章节标记门禁**：章纲声明 `multi_pov_explicit` 的章节，正文必须含 `***` / `---` / `【视角切换】` 等显式分隔标记，否则 P1。
  4. **5 种 POV 类型可识别**：基于人称代词分布、内心独白归属、全知关键词、显式切换标记四类特征做启发式识别。

---

## 二、痛点对应

### 2.1 痛点表现

AI 在单章内随意切换视角，典型漂移路径：

- **第三人称限知 → 上帝视角**：开头写"林渊踏入殿中，心中一凛"，中段突然切到"殊不知殿外那道身影早已等候多时"（窥探了林渊不知道的信息）。
- **第三人称限知 → 配角内心独白**：主角视角章节突然插入"韩雪琴心中暗想：此人不可留"（窥探了配角内心）。
- **第三人称限知 → 第一人称**：旁白突然出现"我看着他的背影，不知为何有些心酸"（叙述者身份突变）。
- **多 POV 无标记切换**：章纲未声明 `multi_pov_explicit`，正文却在主角视角与反派视角间反复横跳，读者无法判断"现在是谁的眼睛"。

### 2.2 行业方案

- **网文创作手册**普遍强调"单章一 POV"原则：同一章内尽量锁定一个视角人物，切换 POV 必须有明确场景分隔（`***` 或新场景标题）。
- **传统文学理论**（如《视角的哲学》/ 兹韦坦·托多罗夫叙事学）将视角分为：第一人称、第二人称、第三人称限知、第三人称全知四类，混用即"视角混乱"。
- **起点中文网白金作者经验谈**：多 POV 章节必须有"视角切换标记 + 切换前留钩子 + 切换后快速建立新视角人物锚点"三件套，否则读者流失率显著上升。

### 2.3 本模块的差异化设计

本模块不依赖外部 NLP 库，仅用 Python 标准库（`re` / `json` / `os` / `glob`），与 `check_consistency.py` 现有 7 类检测的"纯标准库 + Vault SSOT + 误报优先于漏报"哲学保持一致。差异化要点：

| 维度 | 本模块设计 |
|---|---|
| 检测依据 | 章纲声明的 POV（SSOT）+ 正文人称代词分布 / 视角特征关键词 |
| 切换判定 | 单章出现 ≥ 2 段（paragraph 级）与声明 POV 不一致的特征段 → P1 |
| 多 POV 容忍 | 章纲声明 `multi_pov_explicit` + 正文含显式分隔标记 → 不报；缺标记 → P1 |
| 误报控制 | 段落长度 < 30 字跳过（避免单行对话误判）；代词密度阈值 ≥ 0.03 且 ≥ 2 次出现 |
| 章纲缺失 | POV 字段缺失 → P2 提示（不阻断保存，但反馈中告警） |
| 特征库外置 | POV 特征库放 `scripts/novelforge/data/pov_signatures.json`，可扩展不改代码 |

---

## 三、涉及现有文件

实现前已 Read 以下 7 个文件，现状摘要如下：

### 3.1 [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py)

- 文件头第 1-42 行 docstring 声明"7 类不一致即报警"。
- 第 162-201 行三个常量 `DIM_ALIASES` / `ALL_DIMENSIONS` / `DIM_LABELS` 控制维度注册表，新增维度只需在此三处登记。
- 第 1202-1209 行 `_DIM_CHECKERS_NO_VAULT` 字典注册无 vault 依赖的检测函数；有 vault 依赖的（`phantom_item` / `location_jump`）在 `check_all` 第 1272-1281 行用 `if/elif` 显式分发。
- 检测函数统一签名 `tuple[list[Issue], str | None]`（返回问题列表 + 跳过原因），新增检测需遵循此契约。
- `Issue` dataclass（第 207-223 行）字段：`severity` / `type` / `detail` / `suggestion` / `extras`。
- 第 1244 行 `load_character_states` 已有 vault 参数；第 1235 行 `load_chapter_text` 已有 volume/chapter 参数，可复用加载章纲文件。

### 3.2 [file:///workspace/scripts/novelforge/schema.py](file:///workspace/scripts/novelforge/schema.py)

- `CHARACTER_STATE_SCHEMA` 无 POV 字段——POV 是章纲属性，不是角色状态属性，本模块不改 schema.py。
- POV 字段归属章纲 `ch_NNN_outline.md` 的"一、章节信息"段落，由 architect Skill 写入。

### 3.3 [file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md](file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md)

- 第 16 行已有 `- **POV**：主角（第三人称限知）` 字段，但值是自由文本，未规范化为枚举。
- 现状问题：LLM 可能写成"主角视角"/"第三人称"/"林渊视角"等多种写法，脚本难以稳定解析。
- 改造方向：保留行位置不变，但值改为枚举（`third_limited` + 中文注释），并在 architect SKILL.md 强制枚举约束。

### 3.4 [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md)

- 第 102-150 行 5.1 节"章纲十段模板"中"一、章节信息"段落模板字段为：`章号` / `卷号` / `字数目标` / `章节类型`——**未列 POV 字段**。
- 第 152-157 行字段约束只规定了章号、卷号、章节类型、字数目标，未约束 POV。
- 改造方向：在 5.1 节模板"一、章节信息"补 `- POV：<枚举值>`，在字段约束段补 POV 五选一规则。

### 3.5 [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md)

- 第 270 行铁律 1 已把"视角混乱（同章多次切 POV 无分隔）"列为 P0 绝对禁用。
- 第 97-114 行阶段二审计表格列出 7 类一致性检测，无 POV 维度。
- 改造方向：审计表格新增第 8 行 POV 检测；铁律 1 的"视角混乱"补充"以章纲声明 POV 为基准，由 check_consistency.py 自动检测"。

### 3.6 [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md)

- 第 16 行"一、创作质量"已有"视角一致：未在单章内无故切换 POV（除非章纲明确要求）"人工 checklist 项。
- 第 30-40 行"三、一致性"段落列了 7 类 check_consistency.py 检测项，无 POV。
- 改造方向：在"三、一致性"段落新增 POV 检测项；保留第 16 行人工项作为兜底。

### 3.7 [file:///workspace/NovelForge_Vault/00_控制面/style_guide.md](file:///workspace/NovelForge_Vault/00_控制面/style_guide.md)

- 第 26 行 1.1 节禁用词表 P0 项已含"视角混乱（同一章内多次切换 POV 且无明确分隔）"。
- 本模块不改 style_guide.md（它已正确定义规则，缺的只是脚本执行），仅在方案中引用。

---

## 四、新增/修改文件清单

| 类型 | 文件路径 | 改动概要 |
|---|---|---|
| 修改 | [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) | 新增 `pov_switch_in_chapter` 检测（第 8 类），登记到 `DIM_ALIASES` / `ALL_DIMENSIONS` / `DIM_LABELS` 三常量，在 `check_all` 编排中新增分支 |
| 修改 | [file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md](file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md) | 章纲模板第 16 行 POV 字段值规范化为枚举 + 中文注释 |
| 修改 | [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) | 5.1 节章纲十段模板"一、章节信息"补 POV 字段；字段约束段补 POV 五选一规则 |
| 修改 | [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | 阶段二审计表格新增 POV 检测行；铁律 1 视角混乱项补充脚本检测说明 |
| 修改 | [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | "三、一致性"段落新增 POV 检测项 |
| 新增 | [file:///workspace/scripts/novelforge/data/pov_signatures.json](file:///workspace/scripts/novelforge/data/pov_signatures.json) | POV 特征库（5 种类型的人称代词 / 关键词 / 切换标记 / 检测阈值） |

---

## 五、详细实现步骤

### 5.1 设计 POV 类型枚举

5 种枚举值，覆盖 NovelForge novel 模式全部视角场景：

| 枚举值 | 中文标签 | 描述 | NovelForge 适用 |
|---|---|---|---|
| `first_person` | 第一人称 | 用「我」叙述，限于「我」的感知范围 | 日记体/回忆录章节 |
| `third_limited` | 第三人称限知 | 用「他/她」叙述，限于单一角色的感知，不窥探其他角色内心 | **默认值**，网文主流 |
| `third_omniscient` | 第三人称全知 | 上帝视角，可窥探任意角色内心，可描述无人感知的事件 | 卷首引子/史诗级场景 |
| `second_person` | 第二人称 | 用「你」叙述，把读者代入主角 | 实验性章节，少用 |
| `multi_pov_explicit` | 多 POV 显式切换 | 单章内明确切换多个视角，必须有 `***` 等分隔标记 | 群像章/双线并进章 |

### 5.2 设计每种 POV 的语言特征库

每种 POV 用四类特征做启发式识别：

| POV 类型 | 人称代词特征 | 视角范围特征 | 内心独白归属 | 上帝视角描述 |
|---|---|---|---|---|
| `first_person` | 「我」密度 ≥ 0.03 且 ≥ 2 次 | 限于「我」感知 | 仅「我」的内心 | 禁止 |
| `third_limited` | 「他/她」为主，「我」密度 < 0.03 | 限于单一角色感知 | 仅 POV 角色的内心（`心想`/`觉得`/`暗道`） | 禁止 |
| `third_omniscient` | 无限制 | 任意角色 | ≥ 2 个不同角色的内心 | 允许（`殊不知`/`与此同时`/`在另一边`） |
| `second_person` | 「你」密度 ≥ 0.03 且 ≥ 2 次 | 限于「你」感知 | 仅「你」的内心 | 禁止 |
| `multi_pov_explicit` | 无限制 | 多视角 | 允许多视角 | 必须有显式切换标记 |

### 5.3 `pov_signatures.json` 完整内容

新增文件 [file:///workspace/scripts/novelforge/data/pov_signatures.json](file:///workspace/scripts/novelforge/data/pov_signatures.json)，内容如下：

```json
{
  "version": "1.0.0",
  "description": "NovelForge POV 视角特征库，供 check_consistency.py 第 8 类检测 pov_switch_in_chapter 使用",
  "pov_types": {
    "first_person": {
      "label": "第一人称",
      "description": "用「我」叙述，限于「我」的感知范围",
      "pronouns": {
        "self": ["我", "我的", "我们"],
        "second_person": ["你", "您", "你的"],
        "third_person": ["他", "她", "它", "他们"]
      },
      "self_pronoun_ratio_min": 0.03,
      "self_pronoun_count_min": 2,
      "markers": ["我", "我心里", "我想", "我看", "我感觉", "我听见", "我知道"]
    },
    "third_limited": {
      "label": "第三人称限知",
      "description": "用「他/她」叙述，限于单一角色的感知范围，不窥探其他角色内心",
      "pronouns": {
        "self": ["他", "她", "它"],
        "first_person": ["我"],
        "other_third": ["他们", "她们"]
      },
      "self_pronoun_ratio_min": 0.0,
      "markers": ["他心想", "她想", "他觉得", "他知道", "他看见", "他听见", "他明白", "暗道", "寻思", "思忖"]
    },
    "third_omniscient": {
      "label": "第三人称全知",
      "description": "上帝视角，可窥探任意角色内心，可描述无人感知的事件",
      "pronouns": {},
      "markers": ["殊不知", "他不知道", "她不知道", "谁也没有想到", "谁也没想到", "与此同时", "在另一边", "在远处", "在彼端", "命运早已", "天意如此", "冥冥之中"]
    },
    "second_person": {
      "label": "第二人称",
      "description": "用「你」叙述，把读者代入主角",
      "pronouns": {
        "self": ["你", "你的"],
        "first_person": ["我"],
        "third_person": ["他", "她"]
      },
      "self_pronoun_ratio_min": 0.03,
      "self_pronoun_count_min": 2,
      "markers": ["你", "你看见", "你听见", "你觉得", "你知道", "你明白"]
    },
    "multi_pov_explicit": {
      "label": "多 POV 显式切换",
      "description": "单章内明确切换多个视角，必须有显式分隔标记",
      "pronouns": {},
      "markers": []
    }
  },
  "switch_markers": ["***", "* * *", "---", "——", "【视角切换】", "【POV 切换】"],
  "detection": {
    "min_paragraph_length": 30,
    "min_switch_paragraphs_for_p1": 2,
    "max_evidence_in_extras": 5,
    "first_person_ratio_min": 0.03,
    "first_person_count_min": 2,
    "second_person_ratio_min": 0.03,
    "second_person_count_min": 2,
    "third_limited_mind_keywords": ["心想", "想道", "觉得", "知道", "明白", "暗道", "寻思", "思忖", "心中", "心头", "暗想"],
    "omniscient_keywords": ["殊不知", "他不知道", "她不知道", "谁也没有想到", "谁也没想到", "与此同时", "在另一边", "在远处", "在彼端", "命运早已", "天意如此", "冥冥之中"],
    "multi_mind_min_for_omniscient": 2
  }
}
```

### 5.4 `check_consistency.py` 新增 `pov_switch_in_chapter` 检测的完整代码片段

#### 5.4.1 常量登记（在第 162-201 行 `DIM_ALIASES` / `ALL_DIMENSIONS` / `DIM_LABELS` 三处补登记）

```python
# DIM_ALIASES 字典末尾追加（在 golden_finger_overreach 行之后）：
DIM_ALIASES: dict[str, str] = {
    # ... 现有 7 类保持不变 ...
    "golden_finger_overreach": "golden_finger_overreach",
    # 新增第 8 类 POV
    "pov": "pov_switch_in_chapter",
    "pov_switch": "pov_switch_in_chapter",
    "pov_switch_in_chapter": "pov_switch_in_chapter",
}

# ALL_DIMENSIONS 列表末尾追加：
ALL_DIMENSIONS: list[str] = [
    "power_level_jump",
    "phantom_item",
    "relationship_mutation",
    "location_jump",
    "foreshadow_forgetting",
    "character_revival",
    "golden_finger_overreach",
    "pov_switch_in_chapter",  # 第 8 类：POV 视角切换
]

# DIM_LABELS 字典末尾追加：
DIM_LABELS: dict[str, str] = {
    # ... 现有 7 类保持不变 ...
    "golden_finger_overreach": "金手指越界",
    "pov_switch_in_chapter": "POV 视角切换",
}
```

#### 5.4.2 文件头 docstring 更新（第 1-12 行）

把 docstring 开头的"7 类不一致"改为"8 类不一致"，并在第 11 行后追加：

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
8. **POV 视角切换**（P1）—— 单章内出现 ≥ 2 段与章纲声明 POV 不一致的特征段，或多 POV 章节缺分隔标记
"""
```

#### 5.4.3 POV 检测核心代码（插入到第 7 类 `check_golden_finger_overreach` 之后、`# 编排：check_all` 注释之前）

```python
# ============================================================================
# 维度 8：POV 视角切换（P1）
# ============================================================================
# POV 特征库相对路径（相对 cwd 或相对本脚本所在目录）
POV_SIGNATURES_REL: str = os.path.join("scripts", "novelforge", "data", "pov_signatures.json")

# POV 类型枚举（与 pov_signatures.json 的 pov_types 键一致）
POV_TYPES: tuple[str, ...] = (
    "first_person",
    "third_limited",
    "third_omniscient",
    "second_person",
    "multi_pov_explicit",
)

# 章纲中允许的 POV 声明值（中英自由文本 → 标准枚举）
POV_DECL_ALIASES: dict[str, str] = {
    # 第一人称
    "第一人称": "first_person",
    "first_person": "first_person",
    "1st": "first_person",
    "first": "first_person",
    # 第三人称限知（NovelForge 默认值）
    "第三人称限知": "third_limited",
    "第三人称限制": "third_limited",
    "第三人称有限": "third_limited",
    "third_limited": "third_limited",
    "third_limited_omniscient": "third_limited",
    "限知": "third_limited",
    "主角（第三人称限知）": "third_limited",
    "主角(第三人称限知)": "third_limited",
    "主角视角": "third_limited",
    # 第三人称全知
    "第三人称全知": "third_omniscient",
    "第三人称上帝视角": "third_omniscient",
    "上帝视角": "third_omniscient",
    "全知": "third_omniscient",
    "全知视角": "third_omniscient",
    "third_omniscient": "third_omniscient",
    "omniscient": "third_omniscient",
    # 第二人称
    "第二人称": "second_person",
    "second_person": "second_person",
    "2nd": "second_person",
    # 多 POV 显式切换
    "多pov": "multi_pov_explicit",
    "多POV": "multi_pov_explicit",
    "multi_pov": "multi_pov_explicit",
    "多视角": "multi_pov_explicit",
    "多视角显式切换": "multi_pov_explicit",
    "multi_pov_explicit": "multi_pov_explicit",
}

# POV 显式切换标记（与 pov_signatures.json 的 switch_markers 一致）
POV_SWITCH_MARKERS: tuple[str, ...] = (
    "***", "* * *", "---", "——", "【视角切换】", "【POV 切换】",
)


def _load_pov_signatures() -> dict[str, Any]:
    """加载 POV 特征库 pov_signatures.json。

    查找顺序：
    1. ``os.path.join(os.getcwd(), scripts/novelforge/data/pov_signatures.json)``
    2. ``os.path.join(os.path.dirname(__file__), data/pov_signatures.json)``

    文件缺失或解析失败返回空 dict（降级为跳过 POV 检测，不阻断整体）。
    """
    candidates = [
        os.path.join(os.getcwd(), POV_SIGNATURES_REL),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "pov_signatures.json"),
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, json.JSONDecodeError):
                return {}
    return {}


def _load_outline_pov(vault: str, volume: int, chapter: int) -> tuple[str | None, str | None]:
    """从章纲文件 ch_NNN_outline.md 解析 POV 声明。

    Returns:
        (standard_pov, outline_path) —— standard_pov 为标准化枚举名（如
        ``third_limited``）；章纲文件不存在或 POV 字段缺失返回 (None, path|None)。
    """
    outline_glob = os.path.join(
        vault, "04_大纲与脉络", f"vol_{volume:02d}", f"ch_{chapter:03d}_outline.md"
    )
    matches = sorted(glob.glob(outline_glob))
    if not matches:
        return None, None
    outline_path = matches[0]
    try:
        with open(outline_path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None, outline_path
    # 匹配 - **POV**：xxx 或 - POV：xxx（大小写不敏感，允许 ** 包裹）
    m = re.search(r"(?im)^\s*[\*\-]?\s*\**\s*POV\s*\**\s*[:：]\s*(.+?)\s*$", text)
    if not m:
        return None, outline_path
    raw = m.group(1).strip().strip("*").strip()
    # 自由文本 → 枚举；未命中尝试子串匹配（如"主角（第三人称限知）"）
    standard = POV_DECL_ALIASES.get(raw)
    if standard is None:
        for alias, std in POV_DECL_ALIASES.items():
            if alias in raw:
                standard = std
                break
    return standard, outline_path


def _detect_paragraph_pov(para: str, signatures: dict[str, Any]) -> str | None:
    """识别单段文字的 POV 类型（启发式）。

    判定优先级：
    1. 全知关键词命中（``殊不知``/``与此同时``/``在另一边`` 等）→ ``third_omniscient``
    2. 多角色内心窥探（≥ 2 个不同角色名 + ``心想``/``觉得`` 等）→ ``third_omniscient``
    3. 「我」密度 ≥ 阈值且 ≥ 阈值次数 → ``first_person``
    4. 「你」密度 ≥ 阈值且 ≥ 阈值次数 → ``second_person``
    5. 出现第三人称限知内心独白关键词或「他/她」→ ``third_limited``
    6. 无法判定 → None（段落太短或特征不显著，跳过）

    Args:
        para: 段落文本（已 strip）。
        signatures: pov_signatures.json 解析后的 dict。

    Returns:
        POV 枚举名或 None。
    """
    if not para or len(para) < 30:
        return None

    detection = signatures.get("detection", {}) if signatures else {}
    omniscient_kws = detection.get(
        "omniscient_keywords",
        ["殊不知", "他不知道", "与此同时", "在另一边", "命运早已"],
    )
    third_limited_mind_kws = detection.get(
        "third_limited_mind_keywords",
        ["心想", "想道", "觉得", "知道", "明白", "暗道", "寻思", "思忖"],
    )
    first_ratio_min = detection.get("first_person_ratio_min", 0.03)
    first_count_min = detection.get("first_person_count_min", 2)
    second_ratio_min = detection.get("second_person_ratio_min", 0.03)
    second_count_min = detection.get("second_person_count_min", 2)
    multi_mind_min = detection.get("multi_mind_min_for_omniscient", 2)

    # 1. 全知关键词命中
    for kw in omniscient_kws:
        if kw in para:
            return "third_omniscient"

    # 2. 多角色内心窥探 → 全知
    mind_pattern = re.compile(
        r"(?P<name>[^\s，。：：「」『』""''！？]{2,6})"
        r"(?:心想|想道|觉得|知道|明白|暗道|寻思|思忖|心中|心头)"
    )
    mind_names = {m.group("name") for m in mind_pattern.finditer(para)}
    if len(mind_names) >= multi_mind_min:
        return "third_omniscient"

    # 3. 第一人称「我」密度
    first_count = para.count("我")
    if first_count >= first_count_min and first_count / len(para) >= first_ratio_min:
        return "first_person"

    # 4. 第二人称「你」密度
    second_count = para.count("你")
    if second_count >= second_count_min and second_count / len(para) >= second_ratio_min:
        return "second_person"

    # 5. 第三人称限知
    if any(kw in para for kw in third_limited_mind_kws):
        return "third_limited"
    if "他" in para or "她" in para:
        return "third_limited"

    return None


def check_pov_switch_in_chapter(
    body: str,
    states: dict[str, dict[str, Any]],
    vault: str,
    volume: int,
    chapter: int,
) -> tuple[list[Issue], str | None]:
    """检测单章内 POV 视角无故切换（第 8 类检测）。

    规则：
    - 加载 ``pov_signatures.json``；缺失 → 跳过（不阻断）。
    - 读取章纲声明的 POV（``ch_NNN_outline.md`` 的 ``**POV**：`` 字段）。
    - 章纲 POV 字段缺失 → P2 提示「章纲缺失 POV 声明」。
    - 章纲 POV = ``multi_pov_explicit``：
        - 正文含任一切换标记（``***``/``---``/``【视角切换】``）→ 不报。
        - 正文无切换标记 → P1「多 POV 章节缺分隔标记」。
    - 章纲 POV 为单一视角（``first_person``/``third_limited``/``third_omniscient``/``second_person``）：
        - 按段落扫描正文，识别每段 POV 特征。
        - 累计与声明 POV 不一致的段落数 ≥ ``min_switch_paragraphs_for_p1``（默认 2）→ P1。
        - 证据段落首 50 字预览写入 ``extras.evidence``（最多 5 条）。
    """
    signatures = _load_pov_signatures()
    if not signatures:
        return [], "pov_signatures.json 未找到或为空，跳过 POV 检测"

    declared_pov, outline_path = _load_outline_pov(vault, volume, chapter)

    if declared_pov is None:
        detail = (
            f"章纲缺失 POV 字段声明\n"
            f"   章纲路径: {outline_path or '<未找到 ch_NNN_outline.md>'}\n"
            f"   建议: 在「一、章节信息」段落新增 `- **POV**：third_limited`"
            f"（可选值: first_person / third_limited / third_omniscient / "
            f"second_person / multi_pov_explicit）"
        )
        return [Issue(
            severity="P2",
            type="pov_switch_in_chapter",
            detail=detail,
            suggestion="章纲强制声明 POV 字段，便于自动检测视角切换。",
            extras={"sub_type": "missing_pov_declaration", "outline_path": outline_path},
        )], None

    if declared_pov not in POV_TYPES:
        detail = (
            f"章纲 POV 声明值无法识别: {declared_pov}\n"
            f"   合法枚举: {', '.join(POV_TYPES)}"
        )
        return [Issue(
            severity="P1",
            type="pov_switch_in_chapter",
            detail=detail,
            suggestion="修正章纲 POV 字段为合法枚举值。",
            extras={"sub_type": "invalid_pov_declaration", "raw": declared_pov},
        )], None

    # 多 POV 显式切换章节：检查显式分隔标记
    if declared_pov == "multi_pov_explicit":
        has_marker = any(marker in body for marker in POV_SWITCH_MARKERS)
        if not has_marker:
            return [Issue(
                severity="P1",
                type="pov_switch_in_chapter",
                detail=(
                    f"章纲声明 POV = multi_pov_explicit，但正文无显式视角切换标记\n"
                    f"   合法标记: {', '.join(POV_SWITCH_MARKERS)}\n"
                    f"   多 POV 章节必须有明确分隔，避免读者混乱"
                ),
                suggestion="在每个视角切换处插入 *** 或「【视角切换】」标记。",
                extras={
                    "sub_type": "multi_pov_missing_marker",
                    "declared_pov": declared_pov,
                },
            )], None
        return [], None  # 多 POV 章节且标记齐全，不检测切换

    # 单一 POV 章节：按段落扫描
    detection = signatures.get("detection", {})
    min_len = detection.get("min_paragraph_length", 30)
    min_switch = detection.get("min_switch_paragraphs_for_p1", 2)
    max_evidence = detection.get("max_evidence_in_extras", 5)

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    switch_evidence: list[tuple[int, str, str]] = []  # (段落序号, 检测到的POV, 段落首50字)
    for idx, para in enumerate(paragraphs, 1):
        if len(para) < min_len:
            continue
        detected = _detect_paragraph_pov(para, signatures)
        if detected and detected != declared_pov:
            switch_evidence.append((idx, detected, para[:50]))

    if len(switch_evidence) >= min_switch:
        evidence_lines = [
            f"   段 {idx}: 检测到 {detected} POV「{preview}...」"
            for idx, detected, preview in switch_evidence[:max_evidence]
        ]
        detail = (
            f"章纲声明 POV: {declared_pov}\n"
            f"   正文出现 {len(switch_evidence)} 段疑似其他 POV 特征\n"
            + "\n".join(evidence_lines)
        )
        return [Issue(
            severity="P1",
            type="pov_switch_in_chapter",
            detail=detail,
            suggestion=(
                "保持单章一 POV；如确需切换，改为 multi_pov_explicit 并在切换处"
                "插入 *** 标记，或拆分为多章。"
            ),
            extras={
                "declared_pov": declared_pov,
                "switch_count": len(switch_evidence),
                "evidence": [
                    {"paragraph": idx, "detected_pov": det, "preview": prev}
                    for idx, det, prev in switch_evidence[:max_evidence]
                ],
                "sub_type": "unauthorized_switch",
            },
        )], None

    return [], None
```

#### 5.4.4 `check_all` 编排分支（在第 1272-1281 行的 `if/elif` 链中追加 POV 分支）

```python
    for dim in target_dims:
        try:
            if dim == "phantom_item":
                issues, skip = check_phantom_item(body, states, vault)
            elif dim == "location_jump":
                issues, skip = check_location_jump(body, states, vault)
            elif dim == "pov_switch_in_chapter":
                # POV 检测需要 vault + volume + chapter（读章纲文件）
                issues, skip = check_pov_switch_in_chapter(
                    body, states, vault, volume, chapter
                )
            elif dim in _DIM_CHECKERS_NO_VAULT:
                issues, skip = _DIM_CHECKERS_NO_VAULT[dim](body, states, hooks, chapter)
            else:
                report.skipped[dim] = f"未知维度: {dim}"
                continue
            if skip:
                report.skipped[dim] = skip
            report.issues.extend(issues)
        except Exception as exc:  # noqa: BLE001 单维度异常不阻断整体
            report.skipped[dim] = f"检测异常: {type(exc).__name__}: {exc}"

    return report
```

#### 5.4.5 CLI `--dim` 帮助文案更新（第 1416-1419 行）

```python
    parser.add_argument(
        "--dim", type=str, default=None,
        help=(
            "只检测指定维度（逗号分隔多个）。"
            "可用短名: power_level/item/relationship/location/foreshadow/"
            "revival/golden_finger/pov"
        ),
    )
```

### 5.5 章纲模板新增 POV 字段的具体位置和文案

修改 [file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md](file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md) 第 16 行，把自由文本值改为枚举 + 中文注释：

**修改前**（第 16 行）：
```markdown
- **POV**：主角（第三人称限知）
```

**修改后**（第 16 行）：
```markdown
- **POV**：third_limited（第三人称限知，主角视角；可选值：first_person / third_limited / third_omniscient / second_person / multi_pov_explicit）
```

并在第 17 行（`---` 分隔符之前）追加一行注释说明：

```markdown
> POV 字段为强制声明，由 check_consistency.py 第 8 类检测 `pov_switch_in_chapter` 读取。multi_pov_explicit 章节正文必须含 `***` / `---` / `【视角切换】` 等显式分隔标记。
```

### 5.6 architect SKILL.md 章纲生成时强制 POV 字段的指令

修改 [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) 5.1 节"章纲十段模板"和字段约束段。

#### 5.6.1 模板代码块（第 106-150 行）"一、章节信息"段落补 POV 字段

**修改前**（第 109-113 行）：
```markdown
## 一、章节信息
- 章号：ch_NNN
- 卷号：vol_NN
- 字数目标：2500-3000
- 章节类型：regular/hook_resolve/vol_start/climax/transition
```

**修改后**：
```markdown
## 一、章节信息
- 章号：ch_NNN
- 卷号：vol_NN
- 字数目标：2500-3000
- 章节类型：regular/hook_resolve/vol_start/climax/transition
- POV：third_limited（强制声明；可选值 first_person / third_limited / third_omniscient / second_person / multi_pov_explicit）
```

#### 5.6.2 字段约束段（第 152-157 行）补 POV 约束

**修改前**（第 152-157 行）：
```markdown
字段约束：
- `章号` 必须三位补零；`卷号` 两位补零。
- `章节类型` 五选一：`vol_start`（卷首）/ `regular`（常规）/ `hook_resolve`（伏笔回收章）/ `climax`（高潮）/ `transition`（过渡）。
- `字数目标` 常规章 2500-3000；高潮章可放宽到 3500；**黄金三章必须 2500-3000，不能短**。
- `伏笔操作` 三类都要列，无则写 `（无）`，不能省段落。
- `节奏标记` 三项必填，与 `04_大纲与脉络/vol_NN/vol_outline.md` 的节奏曲线对齐。
```

**修改后**（追加 POV 约束行）：
```markdown
字段约束：
- `章号` 必须三位补零；`卷号` 两位补零。
- `章节类型` 五选一：`vol_start`（卷首）/ `regular`（常规）/ `hook_resolve`（伏笔回收章）/ `climax`（高潮）/ `transition`（过渡）。
- `POV` 五选一：`first_person`（第一人称）/ `third_limited`（第三人称限知，**默认值**）/ `third_omniscient`（第三人称全知）/ `second_person`（第二人称）/ `multi_pov_explicit`（多 POV 显式切换）。**强制声明**，缺失时 check_consistency.py 第 8 类检测 `pov_switch_in_chapter` 会发 P2 提示。声明 `multi_pov_explicit` 的章节，正文必须含 `***` / `---` / `【视角切换】` 等显式分隔标记。
- `字数目标` 常规章 2500-3000；高潮章可放宽到 3500；**黄金三章必须 2500-3000，不能短**。
- `伏笔操作` 三类都要列，无则写 `（无）`，不能省段落。
- `节奏标记` 三项必填，与 `04_大纲与脉络/vol_NN/vol_outline.md` 的节奏曲线对齐。
```

#### 5.6.3 第七步（第 205-213 行）补 POV 联动说明

在第 213 行后追加：

```markdown
5. **章纲 POV 字段已强制声明**：写章纲时必须在「一、章节信息」段落填入 5 种枚举值之一，默认 `third_limited`。声明 `multi_pov_explicit` 时提醒用户：正文必须在视角切换处插入 `***` 或 `【视角切换】` 标记，否则 writer-polisher 审计阶段会被 check_consistency.py 第 8 类检测标记 P1。
```

### 5.7 writer-polisher SKILL.md 严格遵循 POV 的指令

修改 [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) 阶段二审计表格和铁律 1。

#### 5.7.1 阶段二审计表格（第 97-114 行）新增 POV 检测行

**修改前**（第 103-113 行表格末尾）：
```markdown
| 金手指越界 | P1 | 使用 abilities 列表外能力 / 违反 limitations / 单章 > 2 次 |
```

**修改后**（追加第 8 行）：
```markdown
| 金手指越界 | P1 | 使用 abilities 列表外能力 / 违反 limitations / 单章 > 2 次 |
| POV 视角切换 | P1/P2 | 单章 ≥ 2 段与章纲声明 POV 不一致 / 多 POV 章节缺分隔标记 / 章纲缺 POV 字段（P2） |
```

并在表格下方第 114 行后追加说明：

```markdown
> POV 检测依赖章纲声明的 POV 字段（5 种枚举值，由 architect Skill 写入）。writer 生成正文时必须严格遵循章纲声明的 POV，不得在单一 POV 章节内窥探其他角色内心或切到上帝视角。如章纲声明 `multi_pov_explicit`，正文必须在每次视角切换处插入 `***` 或 `【视角切换】` 标记。
```

#### 5.7.2 铁律 1（第 260-271 行）"视角混乱"项补充脚本检测说明

**修改前**（第 270 行）：
```markdown
| 视角混乱（同章多次切 POV 无分隔） | P0 | 绝对禁用 |
```

**修改后**：
```markdown
| 视角混乱（同章多次切 POV 无分隔） | P0 | 绝对禁用；由 check_consistency.py 第 8 类检测 `pov_switch_in_chapter` 自动门禁，章纲声明单一 POV 但正文出现 ≥ 2 段其他 POV 特征即 P1，多 POV 章节缺 `***` 分隔标记亦 P1 |
```

#### 5.7.3 阶段三精修（第 144-159 行）定点修复表新增 POV 修复策略

在表格末尾（第 159 行后）追加：

```markdown
| POV 视角切换 | 改写越界段落回归章纲声明 POV；多 POV 章节在切换处插入 `***` 标记；或修正章纲 POV 声明为 `multi_pov_explicit` |
```

### 5.8 dev-checklist.md 新增检测项文案

修改 [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) "三、一致性"段落。

#### 5.8.1 第 32 行下方新增 POV 检测项

**修改前**（第 32 行）：
```markdown
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 全部通过（合并前必须完成）
```

**修改后**（在第 32 行后追加）：
```markdown
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 全部通过（合并前必须完成，含 8 类检测：境界跳级 / 物品凭空 / 关系突变 / 位置穿越 / 伏笔遗忘 / 角色复生 / 金手指越界 / POV 视角切换）
- [ ] POV 视角一致：章纲已声明 POV 枚举值（first_person / third_limited / third_omniscient / second_person / multi_pov_explicit），单章内无无故切换；多 POV 章节正文含 `***` / `---` / `【视角切换】` 等显式分隔标记
```

#### 5.8.2 第 16 行人工 checklist 项保留为兜底

第 16 行"视角一致：未在单章内无故切换 POV（除非章纲明确要求）"保留不动，作为人工 polisher 兜底项（脚本检测之外的第二道防线）。

---

## 六、验证方式

### 6.1 单元测试

新增 [file:///workspace/tests/test_pov_consistency.py](file:///workspace/tests/test_pov_consistency.py)，运行：

```bash
pytest -q tests/test_pov_consistency.py
```

预期：6 个用例全部通过（用例清单见 §七）。

### 6.2 集成测试

构造一个含 POV 切换的测试章节（第三人称限知章纲 + 正文混入上帝视角段落），跑检测验证 P1 警告：

```bash
# 准备测试章纲（声明 third_limited）
cat > /tmp/test_vault/04_大纲与脉络/vol_01/ch_001_outline.md <<'EOF'
# 章纲：ch_001 · 测试

## 一、章节信息
- 章号：ch_001
- 卷号：vol_01
- POV：third_limited
EOF

# 准备测试正文（含 ≥ 2 段上帝视角特征）
cat > /tmp/test_vault/05_正文/drafts/vol_01/ch_001.md <<'EOF'
林渊踏入殿中，心中一凛。这地方他从未见过，却莫名熟悉。

殊不知，殿外那道身影早已等候多时。与此同时，在另一边的山崖上，韩雪琴正凝视着月光下的孤影。

林渊握紧了剑柄。他不知道的是，这把剑的来历远比他想象的更复杂。谁也没有想到，命运早已为他铺好了路。

林渊深吸一口气，推开了殿门。
EOF

# 跑检测
python -m scripts.novelforge.check_consistency --chapter 1 --vault /tmp/test_vault --json
```

预期输出 JSON 中：
- `p1_count >= 1`
- `issues[*].type == "pov_switch_in_chapter"`
- `issues[*].extras.sub_type == "unauthorized_switch"`
- `issues[*].extras.declared_pov == "third_limited"`
- `issues[*].extras.switch_count >= 2`

### 6.3 断言清单

| 断言项 | 验证方式 |
|---|---|
| 5 种 POV 类型可识别 | `test_first_person_detection` / `test_third_limited_detection` / `test_third_omniscient_detection`（含 second_person、multi_pov_explicit 的特征库校验在 `test_pov_signatures_json_valid`） |
| 单章无故切换触发 P1 | `test_pov_switch_in_chapter_detected` |
| 多 POV 章节有标记不误报 | `test_multi_pov_with_marker_not_flagged` |
| 章纲缺 POV 字段触发 P2 | 集成测试覆盖（声明缺失场景） |
| 章纲 multi_pov_explicit 但正文无标记触发 P1 | 集成测试覆盖 |
| pov_signatures.json 缺失时降级跳过 | 单元测试覆盖（mock 文件缺失） |

---

## 七、回归测试要求

### 7.1 新增 `tests/test_pov_consistency.py`

新增 [file:///workspace/tests/test_pov_consistency.py](file:///workspace/tests/test_pov_consistency.py)，至少 6 个测试用例。完整代码如下：

```python
"""M12 · 多 POV 视角一致性检测回归测试。

覆盖 check_consistency.py 第 8 类检测 pov_switch_in_chapter：
1. pov_signatures.json 合法性
2. first_person 段落识别
3. third_limited 段落识别
4. third_omniscient 段落识别
5. 单章无故切换触发 P1
6. multi_pov_explicit + 标记不误报
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# 确保 scripts 包可导入
WORKSPACE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKSPACE))

from scripts.novelforge.check_consistency import (  # noqa: E402
    POV_DECL_ALIASES,
    POV_SWITCH_MARKERS,
    POV_TYPES,
    _detect_paragraph_pov,
    _load_outline_pov,
    _load_pov_signatures,
    check_pov_switch_in_chapter,
)


# ----------------------------------------------------------------------------
# 用例 1：pov_signatures.json 合法性
# ----------------------------------------------------------------------------
def test_pov_signatures_json_valid():
    """pov_signatures.json 存在、可解析、5 种 POV 类型齐全。"""
    sigs = _load_pov_signatures()
    assert sigs, "pov_signatures.json 未找到或为空"
    assert "pov_types" in sigs
    pov_types = sigs["pov_types"]
    for pov in POV_TYPES:
        assert pov in pov_types, f"pov_signatures.json 缺少 POV 类型: {pov}"
        assert "label" in pov_types[pov]
        assert "description" in pov_types[pov]
    # switch_markers 与代码常量一致
    assert "switch_markers" in sigs
    for marker in POV_SWITCH_MARKERS:
        assert marker in sigs["switch_markers"], f"switch_markers 缺少: {marker!r}"
    # detection 必填字段
    detection = sigs.get("detection", {})
    for key in (
        "min_paragraph_length",
        "min_switch_paragraphs_for_p1",
        "first_person_ratio_min",
        "second_person_ratio_min",
        "third_limited_mind_keywords",
        "omniscient_keywords",
    ):
        assert key in detection, f"detection 缺少字段: {key}"


# ----------------------------------------------------------------------------
# 用例 2：第一人称段落识别
# ----------------------------------------------------------------------------
def test_first_person_detection():
    """「我」密度 ≥ 0.03 且 ≥ 2 次的段落识别为 first_person。"""
    sigs = _load_pov_signatures()
    para = "我看着他远去的背影，心中百感交集。我不知道他为何要走，也不知道自己该不该追上去。我只能站在原地，任由风吹乱我的衣襟。"
    detected = _detect_paragraph_pov(para, sigs)
    assert detected == "first_person", f"期望 first_person，实际 {detected}"


# ----------------------------------------------------------------------------
# 用例 3：第三人称限知段落识别
# ----------------------------------------------------------------------------
def test_third_limited_detection():
    """仅一个角色内心 + 第三人称代词的段落识别为 third_limited。"""
    sigs = _load_pov_signatures()
    para = "林渊踏入殿中，心中一凛。这地方他从未见过，却莫名熟悉。他握紧了剑柄，目光扫过四周的阴影。"
    detected = _detect_paragraph_pov(para, sigs)
    assert detected == "third_limited", f"期望 third_limited，实际 {detected}"


# ----------------------------------------------------------------------------
# 用例 4：第三人称全知段落识别
# ----------------------------------------------------------------------------
def test_third_omniscient_detection():
    """含「殊不知」「与此同时」等全知关键词或窥探 ≥ 2 角色内心的段落识别为 third_omniscient。"""
    sigs = _load_pov_signatures()
    # 子用例 a：全知关键词
    para_a = "殊不知，殿外那道身影早已等候多时。与此同时，在另一边的山崖上，月光正洒落在一个孤独的旅人身上。"
    assert _detect_paragraph_pov(para_a, sigs) == "third_omniscient"
    # 子用例 b：多角色内心窥探
    para_b = "林渊心中一凛，暗道此人不简单。韩雪琴却觉得这人颇为有趣，心想不妨试探一二。"
    assert _detect_paragraph_pov(para_b, sigs) == "third_omniscient"


# ----------------------------------------------------------------------------
# 用例 5：单章 POV 无故切换触发 P1
# ----------------------------------------------------------------------------
def test_pov_switch_in_chapter_detected(tmp_path):
    """章纲声明 third_limited，正文出现 ≥ 2 段全知特征 → P1。"""
    vault = tmp_path
    # 章纲
    outline_dir = vault / "04_大纲与脉络" / "vol_01"
    outline_dir.mkdir(parents=True)
    (outline_dir / "ch_001_outline.md").write_text(
        "# 章纲：ch_001\n\n## 一、章节信息\n- POV：third_limited\n",
        encoding="utf-8",
    )
    # 正文（含 2 段全知特征）
    drafts_dir = vault / "05_正文" / "drafts" / "vol_01"
    drafts_dir.mkdir(parents=True)
    body = (
        "林渊踏入殿中，心中一凛。这地方他从未见过，却莫名熟悉。\n\n"
        "殊不知，殿外那道身影早已等候多时。与此同时，在另一边的山崖上，韩雪琴正凝视着月光。\n\n"
        "林渊握紧了剑柄。他不知道的是，这把剑的来历远比他想象的更复杂。谁也没有想到，命运早已为他铺好了路。\n\n"
        "林渊深吸一口气，推开了殿门。"
    )
    (drafts_dir / "ch_001.md").write_text(body, encoding="utf-8")

    issues, skip = check_pov_switch_in_chapter(body, {}, str(vault), 1, 1)
    assert skip is None, f"不应跳过: {skip}"
    assert len(issues) == 1
    assert issues[0].severity == "P1"
    assert issues[0].type == "pov_switch_in_chapter"
    assert issues[0].extras["sub_type"] == "unauthorized_switch"
    assert issues[0].extras["declared_pov"] == "third_limited"
    assert issues[0].extras["switch_count"] >= 2


# ----------------------------------------------------------------------------
# 用例 6：multi_pov_explicit + 标记不误报
# ----------------------------------------------------------------------------
def test_multi_pov_with_marker_not_flagged(tmp_path):
    """章纲声明 multi_pov_explicit 且正文含 *** 标记 → 不报警。"""
    vault = tmp_path
    outline_dir = vault / "04_大纲与脉络" / "vol_01"
    outline_dir.mkdir(parents=True)
    (outline_dir / "ch_001_outline.md").write_text(
        "# 章纲：ch_001\n\n## 一、章节信息\n- POV：multi_pov_explicit\n",
        encoding="utf-8",
    )
    body = (
        "林渊踏入殿中，心中一凛。\n\n"
        "***\n\n"
        "韩雪琴在山崖上凝视着月光，心想此人颇有趣。\n\n"
        "***\n\n"
        "林渊推开了殿门。"
    )
    issues, skip = check_pov_switch_in_chapter(body, {}, str(vault), 1, 1)
    assert skip is None
    assert issues == [], f"含标记的多 POV 章节不应报警，实际: {issues}"

    # 子用例 b：multi_pov_explicit 但正文无标记 → P1
    body_no_marker = (
        "林渊踏入殿中，心中一凛。\n\n"
        "韩雪琴在山崖上凝视着月光，心想此人颇有趣。\n\n"
        "林渊推开了殿门。"
    )
    issues_b, _ = check_pov_switch_in_chapter(body_no_marker, {}, str(vault), 1, 1)
    assert len(issues_b) == 1
    assert issues_b[0].severity == "P1"
    assert issues_b[0].extras["sub_type"] == "multi_pov_missing_marker"


# ----------------------------------------------------------------------------
# 额外：章纲缺 POV 字段 → P2
# ----------------------------------------------------------------------------
def test_missing_pov_declaration_p2(tmp_path):
    """章纲缺 POV 字段 → P2 提示（不阻断保存）。"""
    vault = tmp_path
    outline_dir = vault / "04_大纲与脉络" / "vol_01"
    outline_dir.mkdir(parents=True)
    (outline_dir / "ch_001_outline.md").write_text(
        "# 章纲：ch_001\n\n## 一、章节信息\n- 章号：ch_001\n",
        encoding="utf-8",
    )
    issues, _ = check_pov_switch_in_chapter("正文内容", {}, str(vault), 1, 1)
    assert len(issues) == 1
    assert issues[0].severity == "P2"
    assert issues[0].extras["sub_type"] == "missing_pov_declaration"
```

运行命令：

```bash
pytest -q tests/test_pov_consistency.py
```

### 7.2 新增 BUG-062「单章 POV 无故切换破坏读者沉浸感」

在 [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) 追加（按 `.trae/rules/bug-reporting.md` 模板）：

```markdown
## 单章 POV 无故切换破坏读者沉浸感

- **编号**：BUG-062
- **首次出现**：2026-07-18
- **类型**：一致性
- **现象**：第 N 章章纲声明第三人称限知（主角视角），但正文在叙述主角行动时，突然插入"殊不知，殿外那道身影早已等候多时"等上帝视角描述，以及"韩雪琴心想此人不可留"等配角内心独白，导致单章内 POV 在主角限知 / 上帝全知 / 配角限知之间反复横跳，读者沉浸感被破坏。
- **根因**：check_consistency.py 仅有 7 类检测无 POV 维度；章纲虽已有 POV 字段但值是自由文本（"主角（第三人称限知）"），未规范化为枚举，脚本无法稳定解析；architect SKILL.md 章纲十段模板"一、章节信息"未强制 POV 字段；writer-polisher SKILL.md 铁律 1 虽把"视角混乱"列为 P0 绝对禁用，但仅靠人工 polisher 兜底，无脚本自动门禁。
- **修复**：
  1. 在 check_consistency.py 新增第 8 类检测 `pov_switch_in_chapter`（P1 警告），按段落扫描正文 POV 特征，与章纲声明 POV 比对，≥ 2 段不一致即报警。
  2. 新增 `scripts/novelforge/data/pov_signatures.json` POV 特征库（5 种类型枚举 + 人称代词 + 关键词 + 切换标记 + 检测阈值）。
  3. 章纲模板 POV 字段值规范化为枚举（`third_limited` 等），architect SKILL.md 强制声明。
  4. writer-polisher SKILL.md 阶段二审计表格新增 POV 检测行，铁律 1 视角混乱项补充脚本检测说明。
  5. dev-checklist.md "三、一致性"段落新增 POV 检测项。
- **涉及文件**：
  - scripts/novelforge/check_consistency.py
  - scripts/novelforge/data/pov_signatures.json（新增）
  - NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md
  - .trae/skills/architect/SKILL.md
  - .trae/skills/writer-polisher/SKILL.md
  - .trae/checklists/dev-checklist.md
- **回归测试**：tests/test_pov_consistency.py 新增 6 个用例（5 种 POV 识别 + 切换检测 + 多 POV 标记不误报 + 章纲缺 POV 字段 P2）
- **教训**：风格禁令（style_guide.md）必须配套脚本门禁，仅靠人工 polisher 兜底不可靠。POV 字段必须为枚举而非自由文本，否则脚本无法稳定解析。视角切换检测应基于"段落数 ≥ 2"的容忍阈值，避免单段对话误报。
```

### 7.3 完整测试集执行

按 `.trae/rules/dev-workflow.md` 第四步要求，修复后执行：

```bash
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault --chapter 1
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault --chapter 1
pytest -q
```

全部通过后方可进入合并/推送。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**低**。理由：

- 新增检测为 P1/P2 级别，**不阻断保存**（`--strict` 模式仅对 P0 退出码 1，P1/P2 不阻断）。
- POV 特征库外置为 JSON，误报可通过调整阈值快速修正，无需改代码。
- 不修改 `.state/` 状态机文件，不破坏 Vault SSOT。
- 不修改 schema.py，不影响 save_state.py / audit_hooks.py 等其他脚本。

### 8.2 对核心资产的影响

| 资产 | 影响 | 说明 |
|---|---|---|
| check_consistency.py | **修改** | 新增第 8 类检测，登记到三常量 + check_all 编排。改动隔离在新增函数与 3 处常量追加，不动现有 7 类检测逻辑 |
| ch_001_outline.md | **修改** | 第 16 行 POV 字段值规范化为枚举。已有章纲文件需同步迁移（建议用 sed 批量替换"主角（第三人称限知）"→"third_limited（第三人称限知...）"） |
| architect/SKILL.md | **修改** | 模板与字段约束追加 POV 项，不影响现有章纲生成流程（POV 字段缺失时 LLM 仍可生成，只是会被 P2 提示） |
| writer-polisher/SKILL.md | **修改** | 审计表格追加行，铁律 1 补充说明，不改变四阶段流水线 |
| dev-checklist.md | **修改** | 追加 1 项 checklist |
| pov_signatures.json | **新增** | 纯数据文件，无副作用 |
| schema.py | **不动** | POV 是章纲属性，非角色状态属性 |
| style_guide.md | **不动** | 已正确定义规则，仅引用 |
| save_state.py / audit_hooks.py / check_ai_novel.py | **不动** | 与 POV 检测无关 |

### 8.3 已知误报风险与缓解

| 误报场景 | 缓解策略 |
|---|---|
| 单段对话含「我」/「你」被误判为第一/第二人称 | 段落长度 < 30 字跳过；代词密度阈值 ≥ 0.03 且 ≥ 2 次 |
| 单段回忆/梦境中插入其他角色视角 | 风格指南要求回忆/梦境有标注词（`回忆`/`幻觉`/`梦境`），后续可扩展 `_detect_paragraph_pov` 跳过含标注词的段落 |
| 多角色内心独白被误判为全知 | 仅当 ≥ 2 个**不同**角色名 + 内心关键词同时出现才判全知；单角色多次内心独白仍为第三人称限知 |
| 章纲 POV 自由文本写法多样 | `POV_DECL_ALIASES` 提供中英 20+ 别名映射 + 子串匹配兜底 |

### 8.4 回滚方案

1. **分支隔离**：所有改动在 `feature/pov-consistency` 分支开发，不直接合 master。
2. **代码回滚**：`git revert <merge_commit>` 即可回滚 check_consistency.py 与 SKILL.md 改动；`pov_signatures.json` 删除即可。
3. **章纲回滚**：已迁移的章纲 POV 字段值可用 `git checkout` 恢复为自由文本（但建议保留枚举值，因为对人工阅读无害）。
4. **检测禁用**：如误报严重需紧急禁用，可通过 `--dim power_level,item,relationship,location,foreshadow,revival,golden_finger` 显式排除 POV 维度，或临时删除 `pov_signatures.json`（脚本会降级跳过）。

---

## 九、完成标准（DoD 清单）

实现完成后逐项核对：

- [ ] [file:///workspace/scripts/novelforge/data/pov_signatures.json](file:///workspace/scripts/novelforge/data/pov_signatures.json) 创建，含 5 种 POV 类型 + switch_markers + detection 配置
- [ ] [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) 新增 `pov_switch_in_chapter` 检测（含 `_load_pov_signatures` / `_load_outline_pov` / `_detect_paragraph_pov` / `check_pov_switch_in_chapter` 四个函数），登记到 `DIM_ALIASES` / `ALL_DIMENSIONS` / `DIM_LABELS` 三常量，`check_all` 编排新增分支，docstring 从"7 类"改为"8 类"
- [ ] [file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md](file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md) 第 16 行 POV 字段值规范化为枚举 + 中文注释
- [ ] [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) 5.1 节章纲模板"一、章节信息"补 POV 字段；字段约束段补 POV 五选一规则；第七步补 POV 联动说明
- [ ] [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) 阶段二审计表格新增 POV 检测行；铁律 1 视角混乱项补充脚本检测说明；阶段三精修表新增 POV 修复策略
- [ ] [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) "三、一致性"段落新增 POV 检测项
- [ ] [file:///workspace/tests/test_pov_consistency.py](file:///workspace/tests/test_pov_consistency.py) 6 个用例全部通过（`pytest -q tests/test_pov_consistency.py`）
- [ ] [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) 新增 BUG-062「单章 POV 无故切换破坏读者沉浸感」
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 全量通过（8 类检测）
- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 全量通过
- [ ] `pytest -q` 全量通过（含新增 6 个 POV 用例，无现有用例回归）
- [ ] `python scripts/validate_commit_messages.py origin/master..HEAD` 通过（提交标题与正文均为中文）

---

## 附录 · 与其他模块的关系

- **上游**：M11（黄金三章硬约束门禁）——黄金三章 POV 默认 `third_limited`，本模块为其提供检测能力。
- **平级**：M13（节奏曲线检测）——同为 check_consistency.py 新增检测维度，互不依赖。
- **下游**：M20（开发自检清单升级）——汇总本模块新增的 POV 检测项到 dev-checklist.md。
- **拟议**：M14（跨章 POV 一致性）——本模块检测单章 POV 切换；M14 可扩展为卷级 POV 调度一致性（如同一卷内主角 POV 章节占比是否符合卷大纲规划）。
