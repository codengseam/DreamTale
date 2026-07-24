# M11 · 黄金三章硬约束门禁

> **层级**：L3 · 补齐盲区能力
> **依赖**：无（独立模块；可叠加复用 M3 的 SSOT 数据流模式与 M9 的 `data/` 目录约定，但无强依赖）
> **下游**：M19（起点神级小说方法论沉淀，引用本模块的黄金三章任务清单与五种开篇模板）、M20（开发自检清单升级，新增黄金三章检测项汇总）

---

## 一、模块目标

- **一句话目标**：在 [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) 新增 `golden_three_opening` 检测维度，对小说前 3 章（ch_001 / ch_002 / ch_003）实施 5 类硬约束门禁（首段钩子 ≤80 字 / 前 300 字信息密度 ≤30% / 字数 2500-3000 不可短 / 金手指在第 3 章前戏剧性亮相 / 第 3 章末必有钩子），任一项不达标即 P0 阻断进入 published 目录。
- **对应的痛点**：
  - 行业调研显示 90% 读者在前三章决定去留，超过 60% 新人作品在开篇阶段就失去潜在读者；阅读平台平均停留时间约 200 字，超过此范围文字阅读率下降约 30%；网文圈有「3000 字定生死」之说。
  - NovelForge 现状：`architect` Skill 已在 [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) §第六步「黄金三章 special_mode」中提出首段钩子 ≤80 字、信息密度 ≤30%、字数 2500-3000 三项约束，`writer-polisher` Skill 也已内化「前 3 章首段钩子 ≤80 字（special_mode）」一句，但 [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) 的 10 维检测中 **未显式实现黄金三章专属检测**——`check_opening_flat` 只检测前 200 字套话/张力，`check_chapter_end_hook` 是通用章末钩子，`check_word_count` 用 ±20% 软边界 1600-3600 远宽于黄金三章 2500-3000 硬约束，无一条 P0 门禁能阻止「第 1 章首段 200 字」「第 1 章仅 1800 字」「金手指直到第 5 章才登场」这类开篇失误。
- **完成后达成的能力**：
  1. 前 3 章自动检测：执行 `python -m scripts.novelforge.check_ai_novel --chapter {1|2|3} --strict` 时自动叠加 5 类硬约束检测，无需额外参数。
  2. P0 阻断不达标章节：首段钩子超 80 字 / 信息密度超 30% / 字数不足 2500 或超 3000 / 第 3 章末无钩子 / 金手指在 ch_003 末未亮相 任一触发即 P0，进入 published 前由 `writer-polisher` 强制返工。
  3. 第 4 章及之后不误报：通过 `CheckContext.is_opening_chapter`（1 ≤ chapter_num ≤ 3）严格门控，5 类检测仅对前 3 章生效，常规章/卷末/终章不受影响。
  4. 阈值可调：所有 5 类硬约束的阈值集中在 [file:///workspace/scripts/novelforge/data/golden_three_rules.json](file:///workspace/scripts/novelforge/data/golden_three_rules.json)，作者/编辑可按风格调参（例如科幻开篇允许首段钩子放宽到 100 字），与 M3 的 `ai_words.json` / M9 的 `zhuque_metrics.json` 并列在 `scripts/novelforge/data/` 目录，沿用同一 SSOT 加载 + fallback 硬编码模式。

---

## 二、痛点对应

### 2.1 痛点表现：黄金三章决定作品命运

| 数据点 | 来源 | 含义 |
|---|---|---|
| 90% 读者在前三章决定去留 | 网文行业公开调研 | 前三章是留客窗口，错过即永久流失 |
| 60%+ 新人作品在开篇阶段就失去潜在读者 | 平台追踪数据 | 开篇失败是新人作者最大死因 |
| 阅读平台平均停留时间约 200 字 | 平台日志统计 | 前 200 字定生死，超此范围阅读率下降 30% |
| 「3000 字定生死」 | 网文圈共识 | 黄金三章累计字数应控制在 7500-9000 字区间，单章 2500-3000 |

**NovelForge 当前盲区**：architect SKILL.md §第六步已写明 3 项约束，但 check_ai_novel.py 未做量化门禁，导致 writer-polisher 阶段生成的第 1 章若首段 200 字、字数 1800 字、第 3 章末无钩子等开篇失误均能直接进 published 目录而无人拦截。本模块把 SKILL 的「软引导」升级为脚本的「硬门禁」。

### 2.2 行业方案

#### 2.2.1 黄金三章任务清单

| 章 | 使命 | 字数目标 |
|---|---|---|
| ch_001 | 抛出悬念或金手指；300 字内必须有钩子；首段 ≤80 字；信息密度 ≤30% | 2500-3000 |
| ch_002 | 尝试使用金手指 + 小高潮或反转；确立核心矛盾 | 2500-3000 |
| ch_003 | 明确下一步行动 + 章末新钩子；第一个小高潮明确爽点；金手指边界明确 | 2500-3000 |

#### 2.2.2 五种经典开篇模板

| 模板 | 一句话定位 | 代表作 |
|---|---|---|
| 反常切入 | 以不可能/反常识场景开篇，制造疑问 | 「拍卖锤落第三声，沈砚才意识到自己被人当成了牌位。」 |
| 冲突前置 | 上来就是矛盾最尖锐的瞬间，省去铺垫 | 「刀已经架在脖子上，他还在算账。」 |
| 悬念抛出 | 抛出一个谜题或秘密，留作长线钩子 | 「老皇帝死的那天，玉玺不在宫里。」 |
| 金手指初现 | 开篇就让金手指亮相，让读者知道爽点在哪 | 「系统提示音响起的瞬间，他看见了自己剩余的寿命：72 小时。」 |
| 身份反差 | 用主角身份与处境的反差制造代入 | 「百岁老人坐在小学课堂里，没人知道他活过三朝。」 |

#### 2.2.3 开头五法（写手生成时参考）

1. **动作起手**：以一个具体动作切入，避免心理描写铺陈。
2. **对话起手**：以一句有冲突感的对话切入。
3. **场景起手**：以一个有五感细节的场景切入，但不超过 80 字。
4. **悬念起手**：以一个反常事实切入，引发疑问。
5. **金手指起手**：直接让金手指亮相，省去铺垫。

### 2.3 本模块的差异化设计

NovelForge 的差异化在于：**将黄金三章的 5 类行业经验约束抽象为可量化 Python 检测**，纯标准库执行，无需 LLM 二次推理，与既有 10 维检测共用 `CheckContext` / `Report` / `Issue` 数据结构，复用 `is_opening_chapter` 门控。

| 硬约束 | 行业经验表述 | NovelForge 工程实现 |
|---|---|---|
| 1. 首段钩子 ≤80 字 | 「首段必须一句话制造代入或悬念」（architect SKILL.md §第六步） | `check_first_paragraph_hook_length`：取正文第一段，剔除标点后字数 > 80 → P0 |
| 2. 信息密度 ≤30% | 「世界规则滴灌式展示，禁止大段设定灌输」（architect SKILL.md §第六步） | `check_info_density_first_300`：前 300 字中「设定性名词 + 解释性长句」字符占比 > 30% → P0 |
| 3. 字数 2500-3000 不可短 | 「黄金三章必须 2500-3000，不能短——黄金三章是留客章」（architect SKILL.md §第六步） | `check_chapter_word_count_2500_3000`：复用 `count_chars`，前 3 章 < 2500 或 > 3000 → P0（比 `check_word_count` 的 1600-3600 软边界更严） |
| 4. 金手指在第 3 章前戏剧性亮相 | 「ch_001 金手指初现 / ch_002 尝试使用金手指 / ch_003 金手指边界明确」（architect SKILL.md §第六步任务表） | `check_golden_finger_appearance`：从 protagonist.json 读取 abilities，到 ch_003 末为止金手指名在已发布正文中累计出现 < 1 次 → P0 |
| 5. 第 3 章末必有钩子 | 「ch_003 明确下一步行动 + 章末新钩子」（任务清单） | `check_chapter_3_end_hook`：ch_003 末 100 字无 ?/!/对话/动作动词，或含收束词 → P0（与通用 `check_chapter_end_hook` 叠加，但本检测对 ch_003 不可豁免） |

**核心约束**：
- 5 类检测仅在 `ctx.is_opening_chapter == True` 时执行（即 chapter_num ∈ {1, 2, 3}），第 4 章及之后跳过。
- 5 类检测的阈值集中在 `golden_three_rules.json`，未配置时用 fallback 硬编码（沿用 M3 模式）。
- 5 类检测均产 P0 问题，与 `writer-polisher` 阶段三「P0 必须全部清零方可进入 published」契约无缝衔接，无需修改 writer-polisher 的修复流程。
- 与既有 `check_opening_flat` / `check_chapter_end_hook` / `check_word_count` 不冲突：本检测是黄金三章专属的「叠加更严约束」，既有检测仍照常运行（黄金三章同时受两套约束管制，取严不取松）。

---

## 三、涉及现有文件

### 3.1 必读文件清单

| 路径 | 用途 | 关注点 |
|---|---|---|
| [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) | 去 AI 味 10 维检测主脚本 | 行 64-68 字数常量 `WORD_COUNT_MIN=2000` / `WORD_COUNT_HARD_MIN=1600` / `WORD_COUNT_HARD_MAX=3600`；行 71-76 检测窗口常量 `OPENING_WINDOW=200` / `CHAPTER_END_WINDOW=100` / `INFO_DUMP_PARAGRAPH=300`；行 127-131 `OPENING_CLICHE_STARTERS` 套话开头词表；行 134-138 `CHAPTER_END_CLOSURE_WORDS` 收束词表；行 259-271 `CheckContext` 数据类（含 `is_opening_chapter` / `golden_finger_names`）；行 390-413 `load_golden_finger_names` 从 protagonist.json 读取 abilities；行 547-583 `check_opening_flat` 开局平庸检测（仅前 3 章，前 200 字）；行 738-783 `check_chapter_end_hook` 章末钩子检测；行 786-822 `check_word_count` 字数控制检测；行 1012-1023 `DIMENSIONS` 注册表；行 1055 `is_opening_chapter=1 <= chapter_num <= 3` 门控逻辑 |
| [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) | 架构师 Skill（黄金三章 special_mode 发起方） | §第六步「黄金三章 special_mode」（行 189-203）：ch_001/002/003 三章任务表 + 4 项额外约束（首段钩子≤80 字、信息密度≤30%、字数 2500-3000 不能短、章纲顶部标注 `special_mode=golden_three`）；§5.1 章纲十段模板的「字数目标 2500-3000；高潮章可放宽到 3500；黄金三章必须 2500-3000，不能短」（行 155） |
| [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | 执笔与精修 Skill（黄金三章检测的执行入口） | §阶段一第 3 步硬约束（行 88-94）：「字数 2000-3000（novel 模式，±20% 硬边界 1600-3600）」「章末钩子：末 100 字必须有悬念/危机/反转/对话/动作动词」「黄金三章：前 3 章首段钩子 ≤80 字（special_mode）」；§阶段二第 2 步去 AI 味检测调用 `check_ai_novel --chapter <N> --json`；§阶段三 P0 必须全部清零方可进入 published |
| [file:///workspace/NovelForge_Vault/00_控制面/style_guide.md](file:///workspace/NovelForge_Vault/00_控制面/style_guide.md) | 文风指南（语言宪法） | §1.4 节奏控制（行 42-46）：「章末必须有钩子」「单章字数控制在 ±10% 均值」「爽点间隔：每 3 章至少 1 个明确爽点」；§五 修订历史（行 142-146），本模块需在修订历史追加一行 |
| [file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md](file:///workspace/NovelForge_Vault/04_大纲与脉络/vol_01/ch_001_outline.md) | 章纲模板 | §一 章基本信息（行 8-16）：含「字数目标：____ 字」「章节类型：vol_start」字段；§七 章末钩子（行 79-85）：「钩子类型 / 钩子内容」字段；§九 节奏预算（行 102-106）：「爽点等级 1-5 / 压抑等级 1-5」。本模块需在 ch_001/ch_002/ch_003 章纲顶部 frontmatter 或正文首行追加 `special_mode=golden_three` 标注 |
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 创作自检清单 | §一 创作质量（行 9-17）：「字数控制」「章末钩子完整性」；§八 去 AI 味（行 77-85）：「check_ai_novel.py 全部通过」「无信息倾倒」；本模块需在 §一 新增「黄金三章硬约束检测」项 |

### 3.2 现状关键发现

**`check_ai_novel.py` 黄金三章覆盖现状**：

| 硬约束 | 现有检测 | 覆盖情况 |
|---|---|---|
| 首段钩子 ≤80 字 | `check_opening_flat`（行 547-583）检测前 200 字套话开头 + 张力，**无首段字数检测** | ❌ 未覆盖 |
| 前 300 字信息密度 ≤30% | `check_info_dump`（行 586-630）检测单段说明性文字 > 300 字，**无前 300 字设定密度量化** | ❌ 未覆盖 |
| 字数 2500-3000 不可短 | `check_word_count`（行 786-822）用 `WORD_COUNT_HARD_MIN=1600` / `WORD_COUNT_HARD_MAX=3600` 软边界（±20%），**黄金三章专属 2500 下限未实现** | ❌ 未覆盖（既有 1600 远宽于 2500） |
| 金手指在第 3 章前戏剧性亮相 | `check_golden_finger`（行 633-672）检测单章金手指滥用（> 2 次），**无跨章累计亮相检测** | ❌ 未覆盖 |
| 第 3 章末必有钩子 | `check_chapter_end_hook`（行 738-783）通用章末钩子检测，**无 ch_003 专属硬约束**（卷末/终章还会被 `is_exempt_end` 豁免） | ❌ 未覆盖（ch_003 不应被豁免） |

**`CheckContext.is_opening_chapter` 门控已就绪**：行 1055 `is_opening_chapter=1 <= chapter_num <= 3`，本模块的 5 类检测可直接复用此门控，无需新增上下文字段。

**`load_golden_finger_names` 已就绪**：行 390-413 从 `protagonist.json` 的 `power_level.abilities` 提取金手指名（支持字符串列表与对象列表两种格式），本模块的 `check_golden_finger_appearance` 直接复用 `ctx.golden_finger_names`。

**`DIMENSIONS` 注册表扩展位**：当前 10 项（行 1012-1023），本模块新增 1 项 `golden_three_opening`（聚合 5 类硬约束于一个维度函数内，便于 `--dim golden_three_opening` 单维度调用），注册表扩展为 11 项。M9 计划新增 5 项扩展为 15 项，本模块与 M9 互不冲突（不同维度名）。

**`architect` SKILL.md §第六步约束文字已就绪**：5 项约束中已有 3 项（首段钩子≤80 字、信息密度≤30%、字数 2500-3000）写在 SKILL.md 行 195-203，本模块把这些「软引导」升级为脚本的「硬门禁」，并在 SKILL.md 中显式引用 `check_ai_novel` 检测命令。

---

## 四、新增/修改文件清单

### 4.1 新增文件

| 路径 | 用途 |
|---|---|
| `/workspace/scripts/novelforge/data/golden_three_rules.json` | 黄金三章 5 类硬约束阈值配置 SSOT：每条规则的阈值 + 检测逻辑 + 对抗建议 |
| `/workspace/tests/test_golden_three_chapters.py` | 黄金三章硬约束门禁回归测试，7 个测试用例 |

### 4.2 修改文件

| 路径 | 改动点 |
|---|---|
| `/workspace/scripts/novelforge/check_ai_novel.py` | 新增 `check_golden_three_opening` 聚合检测函数（内含 5 类子检测）；在 `DIMENSIONS` 注册表追加 1 项；新增 `_load_golden_three_rules_json` 加载 `golden_three_rules.json` + fallback 硬编码；新增 5 类子检测的常量与词库（设定性名词词表、收束词补充）；新增 `--debug-golden-three` CLI 参数（可选，用于打印检测详情） |
| `/workspace/.trae/skills/architect/SKILL.md` | §第六步「黄金三章 special_mode」升级：在「黄金三章额外约束」段落追加「生成章纲后必跑 `python -m scripts.novelforge.check_ai_novel --chapter {1\|2\|3} --strict`，P0 不达标不得进入 writer-polisher 阶段」一句；在任务表新增「金手指亮相」列 |
| `/workspace/.trae/skills/writer-polisher/SKILL.md` | §阶段一第 3 步硬约束「黄金三章：前 3 章首段钩子 ≤80 字（special_mode）」一句升级为「黄金三章：前 3 章强制走 `check_ai_novel --dim golden_three_opening` 检测，5 类硬约束任一不达标 P0 阻断 published」；§阶段二第 2 步去 AI 味检测表格新增「黄金三章硬约束（前 3 章）P0」一行 |
| `/workspace/.trae/checklists/dev-checklist.md` | §一 创作质量新增「黄金三章硬约束：前 3 章 `check_ai_novel --dim golden_three_opening` 5 类硬约束全部通过（首段钩子≤80 字 / 信息密度≤30% / 字数 2500-3000 / 金手指亮相 / ch_003 末钩子）」项 |
| `/workspace/tests/bug_regression_list.md` | 新增 BUG-061「黄金三章硬约束门禁未实现导致开篇质量失控」 |

---

## 五、详细实现步骤

### 步骤 1：设计 5 类硬约束检测的具体算法

5 类硬约束检测的输入 / 输出 / 阈值 / 检测逻辑见下。所有阈值从 `golden_three_rules.json` 加载，未配置时用 fallback 硬编码（沿用 M3 模式）。

#### 5.1 `check_first_paragraph_hook_length`（首段钩子 ≤80 字）

- **检测逻辑**：取正文第一段（strip frontmatter 后第一个非空段落），剔除标点空白后字数 > 80 → P0。首段过长意味着开篇铺陈过多，违反「首段必须一句话制造代入或悬念」。
- **输入**：章节正文（含 frontmatter）。
- **输出**：`Issue(severity="P0", type="golden_three_first_paragraph_too_long")`
- **阈值**：`first_paragraph_max_chars=80`（architect SKILL.md §第六步明文规定）。
- **边界**：若首段是对话（含双引号/直角引号），仍按 80 字硬约束——黄金三章首段不允许长对话铺陈，必须是钩子。

#### 5.2 `check_info_density_first_300`（前 300 字信息密度 ≤30%）

- **检测逻辑**：取正文前 300 字窗口（strip frontmatter 后），统计「设定性名词 + 解释性长句」字符占窗口总字符的比例，> 30% → P0。设定性名词来自 `golden_three_rules.json` 的 `setting_nouns` 列表（如「修炼」「境界」「灵根」「宗门」「丹药」「阵法」「血脉」「功法」等玄幻常用设定词 + 用户自定义）；解释性长句定义为「单句 > 50 字且无对话」。
- **输入**：章节正文。
- **输出**：`Issue(severity="P0", type="golden_three_info_dump_in_first_300")`
- **阈值**：`first_300_window=300`；`info_density_max=0.30`；`explanatory_sentence_min_chars=50`。
- **对抗建议**：将世界规则通过角色动作/对话渗透，禁止前 300 字堆砌设定。

#### 5.3 `check_chapter_word_count_2500_3000`（字数 2500-3000 不可短）

- **检测逻辑**：复用 `count_chars(content)`，前 3 章字数 < 2500 或 > 3000 → P0。比既有 `check_word_count` 的 1600-3600 软边界更严——黄金三章是留客章，短了直接掉读者，长了稀释钩子。
- **输入**：章节正文。
- **输出**：`Issue(severity="P0", type="golden_three_word_count_violation")`
- **阈值**：`word_count_min=2500`；`word_count_max=3000`；`tolerance=0`（黄金三章无容忍度，不像常规章有 ±20%）。
- **与既有 `check_word_count` 关系**：两者叠加运行。例如第 1 章 1800 字，既触发 `check_word_count` 的 P0（< 1600 不触发，但 < 2000 触发越界告警），也触发本检测的 P0（< 2500）。两者不冲突，取严不取松。

#### 5.4 `check_golden_finger_appearance`（金手指在第 3 章前戏剧性亮相）

- **检测逻辑**：到 ch_003 末为止（含 ch_001 / ch_002 / ch_003），从 `ctx.golden_finger_names`（来源 `protagonist.json` 的 `power_level.abilities`）中任一金手指名在已发布正文（drafts 或 published）中累计出现次数 < 1 → P0。检测时机：每生成一章前 3 章后触发；ch_001/ch_002 检测时容忍金手指未亮相（仅 P2 提醒），ch_003 检测时若仍未亮相 → P0（金手指必须在第 3 章前戏剧性亮相）。
- **输入**：章节正文 + `ctx.golden_finger_names` + `ctx.chapter_num` + `ctx.vault_path`。
- **输出**：ch_003 时 `Issue(severity="P0", type="golden_three_golden_finger_missing")`；ch_001/ch_002 时 `Issue(severity="P2", type="golden_three_golden_finger_not_yet")`。
- **阈值**：`min_appearance_count=1`；`hard_deadline_chapter=3`（ch_003 为硬截止）。
- **边界**：若 `ctx.golden_finger_names` 为空（protagonist.json 未配置 abilities），跳过本检测并产 P2 提醒「未配置金手指名，无法检测亮相」。

#### 5.5 `check_chapter_3_end_hook`（第 3 章末必须有钩子）

- **检测逻辑**：仅 ch_003 触发。取末 100 字窗口，若无 `?` / `!` / 对话 / 动作动词，或含收束词（于是/就这样/从此/自此/也就）→ P0。与既有 `check_chapter_end_hook` 的差异：本检测**对 ch_003 不可豁免**（即便章纲类型标 `vol_end` 或 `climax`，ch_003 仍须有钩子——黄金三章结尾必须有钩子留住读者到第 4 章）。
- **输入**：章节正文 + `ctx.chapter_num`。
- **输出**：`Issue(severity="P0", type="golden_three_chapter_3_end_no_hook")`
- **阈值**：复用 `CHAPTER_END_WINDOW=100`、`CHAPTER_END_CLOSURE_WORDS`、`ACTION_VERBS` 既有常量。
- **与既有 `check_chapter_end_hook` 关系**：两者叠加运行。ch_003 即使被 `is_exempt_end` 豁免了通用检测，本检测仍强制执行。

### 步骤 2：`golden_three_rules.json` 完整内容

文件路径：`/workspace/scripts/novelforge/data/golden_three_rules.json`

```json
{
  "schema_version": "1.0",
  "description": "NovelForge 黄金三章硬约束门禁阈值 SSOT。被 check_ai_novel.py 的 check_golden_three_opening 维度加载。",
  "applicable_chapters": [1, 2, 3],
  "rules": {
    "first_paragraph_hook_length": {
      "enabled": true,
      "severity": "P0",
      "threshold": {
        "first_paragraph_max_chars": 80
      },
      "detection_logic": "取正文第一段（strip frontmatter 后第一个非空段落），剔除标点空白后字数 > 80 → P0。首段必须一句话制造代入或悬念。",
      "countermeasure": "用五种经典开篇模板之一重写首段：反常切入 / 冲突前置 / 悬念抛出 / 金手指初现 / 身份反差。参考 architect SKILL.md §第六步示例「拍卖锤落第三声，沈砚才意识到自己被人当成了牌位。」（25 字）",
      "issue_type": "golden_three_first_paragraph_too_long"
    },
    "info_density_first_300": {
      "enabled": true,
      "severity": "P0",
      "threshold": {
        "first_300_window": 300,
        "info_density_max": 0.30,
        "explanatory_sentence_min_chars": 50
      },
      "setting_nouns": [
        "修炼", "境界", "灵根", "宗门", "丹药", "阵法", "血脉", "功法",
        "灵气", "经脉", "元婴", "化神", "渡劫", "天道", "因果", "劫数",
        "灵石", "法器", "符箓", "灵兽", "秘境", "传承", "领悟", "突破",
        "星舰", "量子", "意识", "模因", "硅基", "碳基", "AI", "智械",
        "灵界", "魔界", "仙界", "凡界", "界域", "位面"
      ],
      "detection_logic": "前 300 字窗口中「设定性名词出现次数 × 平均词长 + 单句 > 50 字且无对话的字符数」占窗口总字符比例 > 30% → P0。设定性名词来自 setting_nouns 列表 + 用户自定义。",
      "countermeasure": "世界规则滴灌式展示：把设定转化为角色动作/对话/事件结果。例如不写「修炼分为九个大境界」，改写为「他掌心一翻，灵气凝成的水珠悬在半空——这是练气期三层才有的迹象。」",
      "issue_type": "golden_three_info_dump_in_first_300"
    },
    "chapter_word_count_2500_3000": {
      "enabled": true,
      "severity": "P0",
      "threshold": {
        "word_count_min": 2500,
        "word_count_max": 3000,
        "tolerance": 0
      },
      "detection_logic": "复用 count_chars(content)，前 3 章字数 < 2500 或 > 3000 → P0。黄金三章无容忍度，不像常规章有 ±20%。",
      "countermeasure": "不足 2500 字：扩展冲突细节、补五感锚点、加角色对话。超过 3000 字：删冗余景物、合并次要场景、把设定铺陈移到第 4 章后。",
      "issue_type": "golden_three_word_count_violation"
    },
    "golden_finger_appearance": {
      "enabled": true,
      "severity": "P0",
      "threshold": {
        "min_appearance_count": 1,
        "hard_deadline_chapter": 3
      },
      "detection_logic": "到 ch_003 末为止（含 ch_001/ch_002/ch_003），ctx.golden_finger_names 中任一金手指名在已发布正文中累计出现 < 1 次 → ch_003 时 P0，ch_001/ch_002 时 P2 提醒。金手指名来自 protagonist.json 的 power_level.abilities。",
      "countermeasure": "ch_001 让金手指初现（哪怕只是一个征兆），ch_002 让主角尝试使用，ch_003 让金手指边界明确并制造第一次小高潮。参考 architect SKILL.md §第六步任务表。",
      "issue_type": "golden_three_golden_finger_missing",
      "issue_type_warning": "golden_three_golden_finger_not_yet"
    },
    "chapter_3_end_hook": {
      "enabled": true,
      "severity": "P0",
      "threshold": {
        "chapter_end_window": 100
      },
      "closure_words": [
        "于是", "就这样", "从此", "就这样结束了",
        "自此", "便罢", "便作罢", "也就作罢",
        "一切归于平静", "一切恢复了平静", "也就这样"
      ],
      "action_verbs": [
        "走", "跑", "跳", "挥", "抓", "推", "拉", "踢", "打",
        "拔", "刺", "砍", "挡", "退", "进", "跪", "站", "坐",
        "看", "听", "说", "喊", "笑", "哭", "叹", "瞪", "望",
        "推开门", "转身", "抬头", "低头", "伸手", "收回"
      ],
      "detection_logic": "仅 ch_003 触发。末 100 字无 ?/!/对话/动作动词，或含收束词 → P0。本检测对 ch_003 不可豁免（即便章纲类型标 vol_end 或 climax）。",
      "countermeasure": "ch_003 末必须留钩子留住读者到第 4 章。推荐四种钩子：①新角色登场 ②新危机降临 ③金手指异变 ④核心矛盾升级。禁用收束词。",
      "issue_type": "golden_three_chapter_3_end_no_hook"
    }
  },
  "fallback_hardcoded": {
    "first_paragraph_max_chars": 80,
    "first_300_window": 300,
    "info_density_max": 0.30,
    "explanatory_sentence_min_chars": 50,
    "word_count_min": 2500,
    "word_count_max": 3000,
    "min_appearance_count": 1,
    "hard_deadline_chapter": 3,
    "chapter_end_window": 100
  }
}
```

### 步骤 3：`check_ai_novel.py` 新增 `golden_three_opening` 检测的完整代码片段

在 `check_ai_novel.py` 的常量区（行 89 附近）追加：

```python
# ============================================================================
# 黄金三章硬约束阈值（前 3 章专属，fallback 硬编码；优先从 golden_three_rules.json 加载）
# ============================================================================
GOLDEN_THREE_FIRST_PARA_MAX: int = 80          # 首段钩子字数上限
GOLDEN_THREE_FIRST_300_WINDOW: int = 300       # 前 300 字信息密度窗口
GOLDEN_THREE_INFO_DENSITY_MAX: float = 0.30    # 前 300 字信息密度上限
GOLDEN_THREE_EXPLANATORY_SENT_MIN: int = 50    # 解释性长句字数下限
GOLDEN_THREE_WORD_COUNT_MIN: int = 2500        # 黄金三章字数下限（比 WORD_COUNT_HARD_MIN=1600 更严）
GOLDEN_THREE_WORD_COUNT_MAX: int = 3000        # 黄金三章字数上限（比 WORD_COUNT_HARD_MAX=3600 更严）
GOLDEN_THREE_GF_MIN_APPEARANCE: int = 1        # 金手指最小亮相次数
GOLDEN_THREE_GF_DEADLINE_CH: int = 3           # 金手指亮相硬截止章号
GOLDEN_THREE_CH3_END_WINDOW: int = 100         # ch_003 末钩子检测窗口

# 设定性名词词表（fallback；优先从 golden_three_rules.json 加载）
GOLDEN_THREE_SETTING_NOUNS: tuple[str, ...] = (
    "修炼", "境界", "灵根", "宗门", "丹药", "阵法", "血脉", "功法",
    "灵气", "经脉", "元婴", "化神", "渡劫", "天道", "因果", "劫数",
    "灵石", "法器", "符箓", "灵兽", "秘境", "传承", "领悟", "突破",
    "星舰", "量子", "意识", "模因", "硅基", "碳基", "AI", "智械",
    "灵界", "魔界", "仙界", "凡界", "界域", "位面",
)
```

在 `check_ai_novel.py` 的工具函数区（行 460 附近，`parse_psycho_physio_from_style_guide` 之后）追加 SSOT 加载函数：

```python
def _load_golden_three_rules_json(workspace_root: str) -> dict[str, Any] | None:
    """加载 scripts/novelforge/data/golden_three_rules.json。

    解析失败返回 None，调用方使用 fallback 硬编码常量。
    沿用 M3 的 _load_ai_words_json + fallback 模式。
    """
    fp = os.path.join(
        workspace_root, "scripts", "novelforge", "data",
        "golden_three_rules.json",
    )
    if not os.path.isfile(fp):
        return None
    try:
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _resolve_golden_three_thresholds(workspace_root: str) -> dict[str, Any]:
    """解析黄金三章阈值：JSON 优先，fallback 硬编码。

    返回 dict 含：first_paragraph_max_chars / first_300_window / info_density_max /
    explanatory_sentence_min_chars / word_count_min / word_count_max /
    min_appearance_count / hard_deadline_chapter / chapter_end_window /
    setting_nouns / closure_words / action_verbs。
    """
    cfg = _load_golden_three_rules_json(workspace_root) or {}
    rules = cfg.get("rules", {}) if isinstance(cfg, dict) else {}
    fallback = cfg.get("fallback_hardcoded", {}) if isinstance(cfg, dict) else {}

    def _get(rule_name: str, field: str, fallback_const: Any) -> Any:
        rule = rules.get(rule_name, {})
        if not isinstance(rule, dict):
            return fallback_const
        threshold = rule.get("threshold", {})
        if isinstance(threshold, dict) and field in threshold:
            return threshold[field]
        return fallback.get(field, fallback_const)

    # 设定性名词词表
    info_rule = rules.get("info_density_first_300", {}) if isinstance(rules, dict) else {}
    setting_nouns = info_rule.get("setting_nouns") if isinstance(info_rule, dict) else None
    if not isinstance(setting_nouns, list) or not setting_nouns:
        setting_nouns = list(GOLDEN_THREE_SETTING_NOUNS)

    # ch_003 末钩子收束词与动作动词（与既有 CHAPTER_END_CLOSURE_WORDS / ACTION_VERBS 一致）
    ch3_rule = rules.get("chapter_3_end_hook", {}) if isinstance(rules, dict) else {}
    closure_words = ch3_rule.get("closure_words") if isinstance(ch3_rule, dict) else None
    if not isinstance(closure_words, list) or not closure_words:
        closure_words = list(CHAPTER_END_CLOSURE_WORDS)
    action_verbs = ch3_rule.get("action_verbs") if isinstance(ch3_rule, dict) else None
    if not isinstance(action_verbs, list) or not action_verbs:
        action_verbs = list(ACTION_VERBS)

    return {
        "first_paragraph_max_chars": _get(
            "first_paragraph_hook_length", "first_paragraph_max_chars",
            GOLDEN_THREE_FIRST_PARA_MAX,
        ),
        "first_300_window": _get(
            "info_density_first_300", "first_300_window",
            GOLDEN_THREE_FIRST_300_WINDOW,
        ),
        "info_density_max": _get(
            "info_density_first_300", "info_density_max",
            GOLDEN_THREE_INFO_DENSITY_MAX,
        ),
        "explanatory_sentence_min_chars": _get(
            "info_density_first_300", "explanatory_sentence_min_chars",
            GOLDEN_THREE_EXPLANATORY_SENT_MIN,
        ),
        "word_count_min": _get(
            "chapter_word_count_2500_3000", "word_count_min",
            GOLDEN_THREE_WORD_COUNT_MIN,
        ),
        "word_count_max": _get(
            "chapter_word_count_2500_3000", "word_count_max",
            GOLDEN_THREE_WORD_COUNT_MAX,
        ),
        "min_appearance_count": _get(
            "golden_finger_appearance", "min_appearance_count",
            GOLDEN_THREE_GF_MIN_APPEARANCE,
        ),
        "hard_deadline_chapter": _get(
            "golden_finger_appearance", "hard_deadline_chapter",
            GOLDEN_THREE_GF_DEADLINE_CH,
        ),
        "chapter_end_window": _get(
            "chapter_3_end_hook", "chapter_end_window",
            GOLDEN_THREE_CH3_END_WINDOW,
        ),
        "setting_nouns": setting_nouns,
        "closure_words": closure_words,
        "action_verbs": action_verbs,
    }
```

在 `check_ai_novel.py` 的检测函数区（行 1004 附近，`check_rhythm` 之后）追加聚合检测函数：

```python
def check_golden_three_opening(content: str, ctx: CheckContext) -> list[Issue]:
    """11. 黄金三章硬约束门禁（P0，仅前 3 章）。

    聚合 5 类硬约束子检测：
    - first_paragraph_hook_length（首段钩子 ≤80 字）
    - info_density_first_300（前 300 字信息密度 ≤30%）
    - chapter_word_count_2500_3000（字数 2500-3000 不可短）
    - golden_finger_appearance（金手指在第 3 章前戏剧性亮相）
    - chapter_3_end_hook（第 3 章末必须有钩子，不可豁免）

    仅当 ctx.is_opening_chapter == True（chapter_num ∈ {1,2,3}）时执行。
    阈值从 golden_three_rules.json 加载，未配置用 fallback 硬编码。
    """
    if not ctx.is_opening_chapter:
        return []  # 非前 3 章跳过

    issues: list[Issue] = []
    cfg = _resolve_golden_three_thresholds(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    )

    issues.extend(_check_first_paragraph_hook_length(content, cfg))
    issues.extend(_check_info_density_first_300(content, cfg))
    issues.extend(_check_chapter_word_count_2500_3000(content, cfg))
    issues.extend(_check_golden_finger_appearance(content, ctx, cfg))
    if ctx.chapter_num == cfg["hard_deadline_chapter"]:
        issues.extend(_check_chapter_3_end_hook(content, cfg))

    return issues


def _check_first_paragraph_hook_length(
    content: str, cfg: dict[str, Any],
) -> list[Issue]:
    """5.1 首段钩子 ≤80 字。"""
    issues: list[Issue] = []
    paras = split_paragraphs(content)
    if not paras:
        return issues
    first_para = paras[0]
    char_cnt = len(_strip_punct(first_para))
    max_chars = cfg["first_paragraph_max_chars"]
    if char_cnt > max_chars:
        preview = first_para[:60].replace("\n", " ")
        issues.append(Issue(
            severity="P0",
            type="golden_three_first_paragraph_too_long",
            detail=(
                f"首段 {char_cnt} 字（>{max_chars}），违反黄金三章首段钩子约束：{preview}…"
            ),
            suggestion=(
                "用五种经典开篇模板之一重写首段：反常切入 / 冲突前置 / 悬念抛出 / "
                "金手指初现 / 身份反差。参考「拍卖锤落第三声，沈砚才意识到自己被人当成了牌位。」（25 字）"
            ),
        ))
    return issues


def _check_info_density_first_300(
    content: str, cfg: dict[str, Any],
) -> list[Issue]:
    """5.2 前 300 字信息密度 ≤30%。"""
    issues: list[Issue] = []
    body = strip_frontmatter(content)
    window = body[:cfg["first_300_window"]]
    window_chars = len(_strip_punct(window))
    if window_chars == 0:
        return issues

    # 设定性名词字符占比
    setting_nouns = cfg["setting_nouns"]
    setting_chars = sum(
        window.count(n) * len(n) for n in setting_nouns
    )

    # 解释性长句字符占比（单句 > 50 字且无对话）
    explanatory_chars = 0
    for sent in split_sentences(window):
        sent_chars = len(_strip_punct(sent))
        has_dialogue = bool(_DIALOGUE_RE.search(sent))
        if sent_chars > cfg["explanatory_sentence_min_chars"] and not has_dialogue:
            explanatory_chars += sent_chars

    # 信息密度 = (设定字符 + 解释性长句字符) / 窗口总字符
    # 避免双重计数：解释性长句中可能含设定性名词，取并集上限
    density = min(
        (setting_chars + explanatory_chars) / window_chars,
        1.0,
    )
    if density > cfg["info_density_max"]:
        issues.append(Issue(
            severity="P0",
            type="golden_three_info_dump_in_first_300",
            detail=(
                f"前 {cfg['first_300_window']} 字信息密度 {density*100:.1f}%"
                f"（>{cfg['info_density_max']*100:.0f}%）：设定性名词 {setting_chars} 字 + "
                f"解释性长句 {explanatory_chars} 字 / 窗口 {window_chars} 字"
            ),
            suggestion=(
                "世界规则滴灌式展示：把设定转化为角色动作/对话/事件结果。"
                "例如不写「修炼分为九个大境界」，改写为「他掌心一翻，灵气凝成的水珠悬在半空——"
                "这是练气期三层才有的迹象。」"
            ),
        ))
    return issues


def _check_chapter_word_count_2500_3000(
    content: str, cfg: dict[str, Any],
) -> list[Issue]:
    """5.3 字数 2500-3000 不可短。"""
    issues: list[Issue] = []
    wc = count_chars(content)
    wc_min = cfg["word_count_min"]
    wc_max = cfg["word_count_max"]
    if wc < wc_min or wc > wc_max:
        issues.append(Issue(
            severity="P0",
            type="golden_three_word_count_violation",
            detail=(
                f"黄金三章字数 {wc}，要求 {wc_min}-{wc_max}（无容忍度，"
                f"比常规章 1600-3600 更严）"
            ),
            suggestion=(
                "不足 2500 字：扩展冲突细节、补五感锚点、加角色对话。"
                "超过 3000 字：删冗余景物、合并次要场景、把设定铺陈移到第 4 章后。"
            ),
        ))
    return issues


def _check_golden_finger_appearance(
    content: str, ctx: CheckContext, cfg: dict[str, Any],
) -> list[Issue]:
    """5.4 金手指在第 3 章前戏剧性亮相。"""
    issues: list[Issue] = []
    if not ctx.golden_finger_names:
        issues.append(Issue(
            severity="P2",
            type="golden_three_golden_finger_not_configured",
            detail="protagonist.json 未配置 power_level.abilities，无法检测金手指亮相",
            suggestion="在 .state/characters/protagonist.json 配置 power_level.abilities 字段",
        ))
        return issues

    # 累计 ch_001 到当前章的金手指出现次数
    deadline_ch = cfg["hard_deadline_chapter"]
    min_count = cfg["min_appearance_count"]
    total_count = 0
    for ch in range(1, ctx.chapter_num + 1):
        ch_file, _ = find_chapter_file(ctx.vault_path, ch)
        if not ch_file or not os.path.isfile(ch_file):
            continue
        try:
            with open(ch_file, encoding="utf-8") as f:
                ch_content = f.read()
        except OSError:
            continue
        for name in ctx.golden_finger_names:
            total_count += ch_content.count(name)

    if ctx.chapter_num >= deadline_ch and total_count < min_count:
        names_str = "/".join(ctx.golden_finger_names)
        issues.append(Issue(
            severity="P0",
            type="golden_three_golden_finger_missing",
            detail=(
                f"到 ch_{ctx.chapter_num:03d} 末金手指「{names_str}」累计出现 {total_count} 次"
                f"（<{min_count}），未在第 3 章前戏剧性亮相"
            ),
            suggestion=(
                "ch_001 让金手指初现（哪怕只是一个征兆），ch_002 让主角尝试使用，"
                "ch_003 让金手指边界明确并制造第一次小高潮。"
            ),
        ))
    elif ctx.chapter_num < deadline_ch and total_count < min_count:
        names_str = "/".join(ctx.golden_finger_names)
        issues.append(Issue(
            severity="P2",
            type="golden_three_golden_finger_not_yet",
            detail=(
                f"ch_{ctx.chapter_num:03d} 末金手指「{names_str}」尚未亮相"
                f"（累计 {total_count} 次，硬截止 ch_{deadline_ch:03d}）"
            ),
            suggestion=f"建议在 ch_{ctx.chapter_num+1:03d} 安排金手指初现，避免拖到 ch_{deadline_ch:03d} 才亮相",
        ))
    return issues


def _check_chapter_3_end_hook(
    content: str, cfg: dict[str, Any],
) -> list[Issue]:
    """5.5 第 3 章末必须有钩子（不可豁免）。"""
    issues: list[Issue] = []
    body = strip_frontmatter(content)
    paras = split_paragraphs(body)
    if not paras:
        return issues

    last_para = paras[-1]
    window = cfg["chapter_end_window"]
    tail = body[-window:]

    # 收束词检测
    closure_words = cfg["closure_words"]
    for word in closure_words:
        if word in last_para:
            preview = last_para[-60:].replace("\n", " ")
            issues.append(Issue(
                severity="P0",
                type="golden_three_chapter_3_end_no_hook",
                detail=(
                    f"ch_003 末段含收束词「{word}」，违反黄金三章 ch_003 末必有钩子约束：…{preview}"
                ),
                suggestion=(
                    "ch_003 末必须留钩子留住读者到第 4 章。推荐四种钩子："
                    "①新角色登场 ②新危机降临 ③金手指异变 ④核心矛盾升级。"
                ),
            ))
            return issues  # 一条足够

    # 章末平淡检测
    has_question = "？" in tail or "?" in tail
    has_exclaim = "！" in tail or "!" in tail
    has_dialogue = bool(_DIALOGUE_RE.search(tail))
    action_verbs = cfg["action_verbs"]
    has_action = any(v in tail for v in action_verbs)
    if not (has_question or has_exclaim or has_dialogue or has_action):
        preview = tail.replace("\n", " ").strip()
        issues.append(Issue(
            severity="P0",
            type="golden_three_chapter_3_end_no_hook",
            detail=(
                f"ch_003 末 {window} 字无 ?/!/对话/动作动词，章末平淡：{preview}"
            ),
            suggestion=(
                "用动作卡断 / 危机降临 / 悬念抛出 / 新角色登场作钩子。"
                "ch_003 末钩子不可豁免，即便章纲类型标 vol_end 或 climax。"
            ),
        ))
    return issues
```

在 `DIMENSIONS` 注册表（行 1012-1023）追加 1 项：

```python
DIMENSIONS: list[tuple[str, str, Any]] = [
    ("ai_word", "AI 感词", check_ai_word),
    ("opening_flat", "开局平庸", check_opening_flat),
    ("info_dump", "信息倾倒", check_info_dump),
    ("golden_finger", "金手指滥用", check_golden_finger),
    ("plot_cliche", "爽点套路化", check_plot_cliche),
    ("chapter_end_hook", "章末钩子缺失", check_chapter_end_hook),
    ("word_count", "字数控制", check_word_count),
    ("dialogue_identity", "对话身份", check_dialogue_identity),
    ("psycho_physio", "心理-生理映射", check_psycho_physio),
    ("rhythm", "句式节奏", check_rhythm),
    # ↓ M11 新增（黄金三章硬约束门禁，仅前 3 章）
    ("golden_three_opening", "黄金三章硬约束", check_golden_three_opening),
]
```

可选：在 `_build_arg_parser`（行 1180-1211）追加 `--debug-golden-three` 参数，用于打印 5 类子检测的中间值（首段字数、信息密度、金手指累计次数等），便于调试阈值：

```python
parser.add_argument(
    "--debug-golden-three", action="store_true",
    help="打印黄金三章 5 类子检测的中间值（首段字数/信息密度/金手指累计次数等）",
)
```

### 步骤 4：`architect` SKILL.md 黄金三章 special_mode 升级内容

在 [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) §第六步「黄金三章 special_mode」的「黄金三章额外约束」段落（行 199-203）之后追加：

```markdown
### 6.1 黄金三章硬约束门禁（自动检测）

architect 生成黄金三章章纲后，writer-polisher 执笔完成正文后，**必跑**以下检测：

```bash
python -m scripts.novelforge.check_ai_novel --chapter <1|2|3> --strict --dim golden_three_opening
```

5 类硬约束任一不达标即 P0 阻断进入 published：

| 硬约束 | 阈值 | 检测函数 |
|---|---|---|
| 首段钩子 ≤80 字 | `first_paragraph_max_chars=80` | `_check_first_paragraph_hook_length` |
| 前 300 字信息密度 ≤30% | `info_density_max=0.30` | `_check_info_density_first_300` |
| 字数 2500-3000 不可短 | `word_count_min=2500, word_count_max=3000` | `_check_chapter_word_count_2500_3000` |
| 金手指在第 3 章前戏剧性亮相 | `min_appearance_count=1, hard_deadline_chapter=3` | `_check_golden_finger_appearance` |
| 第 3 章末必有钩子（不可豁免） | `chapter_end_window=100` | `_check_chapter_3_end_hook` |

阈值 SSOT：`scripts/novelforge/data/golden_three_rules.json`，作者/编辑可按风格调参。

### 6.2 黄金三章任务表（含金手指亮相列）

| 章 | 使命 | 字数目标 | 金手指亮相 |
|---|---|---|---|
| ch_001 | 首段钩子（≤80 字）+ 主角代入 + 金手指初现（征兆即可）+ 世界规则滴灌式展示（信息密度 ≤30%） | 2500-3000 | 至少 1 次征兆 |
| ch_002 | 核心冲突升级 + 第一个爽点 + 配角登场 + 主角尝试使用金手指 | 2500-3000 | 至少 1 次使用 |
| ch_003 | 金手指边界明确 + 第一个小高潮 + 中期悬念抛出 + 章末新钩子 | 2500-3000 | 边界明确（不可豁免末钩子） |

### 6.3 五种经典开篇模板（写手参考）

architect 在 ch_001 章纲「八、must-keep / must-avoid」段落必须指定一种开篇模板：

1. **反常切入**：以不可能/反常识场景开篇，制造疑问。
2. **冲突前置**：上来就是矛盾最尖锐的瞬间，省去铺垫。
3. **悬念抛出**：抛出一个谜题或秘密，留作长线钩子。
4. **金手指初现**：开篇就让金手指亮相，让读者知道爽点在哪。
5. **身份反差**：用主角身份与处境的反差制造代入。
```

### 步骤 5：`writer-polisher` SKILL.md 前 3 章强制检测的指令

在 [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) §阶段一第 3 步硬约束（行 88-94）的「黄金三章」一行升级为：

```markdown
- **黄金三章**：前 3 章（ch_001/002/003）强制走 `check_ai_novel --chapter <N> --strict --dim golden_three_opening` 检测，5 类硬约束（首段钩子 ≤80 字 / 前 300 字信息密度 ≤30% / 字数 2500-3000 不可短 / 金手指在第 3 章前戏剧性亮相 / 第 3 章末必有钩子）任一不达标 P0 阻断 published。阈值见 `scripts/novelforge/data/golden_three_rules.json`。
```

在 §阶段二第 2 步去 AI 味检测表格（行 122-134）追加一行：

```markdown
| 黄金三章硬约束（前 3 章） | P0 | 首段钩子 ≤80 字 / 信息密度 ≤30% / 字数 2500-3000 / 金手指亮相 / ch_003 末钩子 |
```

在 §阶段三第 1 步定点修复策略表（行 150-159）追加：

```markdown
| 黄金三章硬约束 P0 | 重写首段（用五种经典开篇模板之一）/ 拆设定为对话动作 / 扩字或删字至 2500-3000 / 补金手指亮相场景 / 重写 ch_003 末 100 字加钩子 |
```

### 步骤 6：`dev-checklist.md` 新增检测项文案

在 [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) §一「创作质量」（行 9-17）末尾追加：

```markdown
- [ ] 黄金三章硬约束（前 3 章专属）：`python -m scripts.novelforge.check_ai_novel --chapter {1|2|3} --strict --dim golden_three_opening` 5 类硬约束全部通过：
  - 首段钩子 ≤80 字（`first_paragraph_max_chars=80`）
  - 前 300 字信息密度 ≤30%（`info_density_max=0.30`）
  - 字数 2500-3000 不可短（`word_count_min=2500, word_count_max=3000`）
  - 金手指在第 3 章前戏剧性亮相（`min_appearance_count=1, hard_deadline_chapter=3`）
  - 第 3 章末必有钩子（不可豁免，即便章纲类型标 vol_end 或 climax）
  - 阈值 SSOT：`scripts/novelforge/data/golden_three_rules.json`，可调参
```

---

## 六、验证方式

### 6.1 单元测试

```bash
pytest -q tests/test_golden_three_chapters.py
```

### 6.2 集成测试 1：用前 3 章正文跑检测，验证 5 类硬约束生效

```bash
# 准备：在 NovelForge_Vault/05_正文/drafts/vol_01/ 下放置 ch_001.md / ch_002.md / ch_003.md
# 在 .state/characters/protagonist.json 配置 power_level.abilities 至少 1 个金手指名

# 跑前 3 章黄金三章检测
python -m scripts.novelforge.check_ai_novel --chapter 1 --strict --dim golden_three_opening --json
python -m scripts.novelforge.check_ai_novel --chapter 2 --strict --dim golden_three_opening --json
python -m scripts.novelforge.check_ai_novel --chapter 3 --strict --dim golden_three_opening --json

# 期望：每章输出含 "golden_three_opening" 维度的检测，5 类子检测均有运行痕迹
# 期望：第 4 章及之后 is_opening_chapter=False，golden_three_opening 维度返回空 issues
python -m scripts.novelforge.check_ai_novel --chapter 4 --strict --dim golden_three_opening --json
```

### 6.3 集成测试 2：故意写不达标第 1 章，验证 P0 阻断

故意构造一份不达标的 `ch_001.md`，触发 5 类硬约束中的至少 3 类 P0：

```bash
# 准备：ch_001.md 内容设计
# - 首段 150 字（超 80）→ 触发 first_paragraph_too_long
# - 前 300 字堆砌「修炼/境界/灵根/宗门/丹药」设定 → 触发 info_dump_in_first_300
# - 全章 1800 字 → 触发 word_count_violation
# - 全章未出现金手指名 → ch_001 时仅 P2 提醒（不阻断）
# - 末段「就这样，他开始了修炼之路。」→ 不触发 ch_003 末钩子检测（ch_001 不检）

python -m scripts.novelforge.check_ai_novel --chapter 1 --strict --dim golden_three_opening --json

# 期望退出码 1（P0 触发 strict 模式退出码 1）
# 期望 issues 至少含 3 条 P0：golden_three_first_paragraph_too_long / golden_three_info_dump_in_first_300 / golden_three_word_count_violation
```

### 6.4 断言清单

| # | 断言 | 验证方式 |
|---|---|---|
| 1 | 首段 ≤80 字可触发 P0 | 构造首段 81+ 字的 ch_001，断言 `golden_three_first_paragraph_too_long` 出现 |
| 2 | 前 300 字信息密度 >30% 可触发 P0 | 构造前 300 字堆砌设定名词的 ch_001，断言 `golden_three_info_dump_in_first_300` 出现 |
| 3 | 字数 <2500 或 >3000 可触发 P0 | 构造 1800 字 / 3500 字的 ch_001，断言 `golden_three_word_count_violation` 出现 |
| 4 | 金手指在 ch_003 末未亮相可触发 P0 | 构造 ch_001/002/003 均不含金手指名的正文，断言 ch_003 时 `golden_three_golden_finger_missing` 出现（P0） |
| 5 | ch_003 末无钩子可触发 P0 | 构造 ch_003 末段含「就这样」或无 ?/!/对话/动作的正文，断言 `golden_three_chapter_3_end_no_hook` 出现 |
| 6 | 第 4 章及之后不误报 | ch_004 首段 200 字、字数 1800 字，断言 `golden_three_opening` 维度返回空 issues |
| 7 | `golden_three_rules.json` 加载与 fallback | 删除 JSON 文件后跑检测，断言仍用 fallback 硬编码阈值正常运行 |

---

## 七、回归测试要求

### 7.1 新增 `tests/test_golden_three_chapters.py`

文件路径：`/workspace/tests/test_golden_three_chapters.py`

至少 7 个测试用例：

```python
"""M11 黄金三章硬约束门禁回归测试。

验证 check_ai_novel.py 的 check_golden_three_opening 维度对前 3 章
实施 5 类硬约束门禁，第 4 章及之后不误报。
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.novelforge.check_ai_novel import (  # noqa: E402
    CheckContext,
    Issue,
    check_golden_three_opening,
    _resolve_golden_three_thresholds,
)


def _make_ctx(chapter_num: int, vault: str, golden_finger_names: list[str] | None = None) -> CheckContext:
    return CheckContext(
        chapter_num=chapter_num,
        vol_num=1,
        vault_path=vault,
        outline_path=None,
        is_opening_chapter=1 <= chapter_num <= 3,
        is_exempt_end=False,
        golden_finger_names=golden_finger_names or [],
        fingerprints={},
        length_history=[],
    )


def _make_chapter_file(vault: str, chapter: int, content: str) -> None:
    """在 vault 的 drafts/vol_01/ 下创建 ch_NNN.md。"""
    drafts_dir = Path(vault) / "05_正文" / "drafts" / "vol_01"
    drafts_dir.mkdir(parents=True, exist_ok=True)
    (drafts_dir / f"ch_{chapter:03d}.md").write_text(content, encoding="utf-8")


# ---------- 1. test_first_paragraph_hook_length ----------
def test_first_paragraph_hook_length(tmp_path):
    """首段 > 80 字 → P0 golden_three_first_paragraph_too_long。"""
    cfg = _resolve_golden_three_thresholds(str(Path(__file__).resolve().parents[1]))
    long_first_para = "这是一个故意写得很长的首段用于触发黄金三章首段钩子字数硬约束的测试用例，" + "啊" * 60
    content = f"{long_first_para}\n\n后续段落。"
    issues = check_golden_three_opening(content, _make_ctx(1, str(tmp_path)))
    types = [i.type for i in issues if i.severity == "P0"]
    assert "golden_three_first_paragraph_too_long" in types


# ---------- 2. test_info_density_first_300 ----------
def test_info_density_first_300(tmp_path):
    """前 300 字信息密度 > 30% → P0 golden_three_info_dump_in_first_300。"""
    cfg = _resolve_golden_three_thresholds(str(Path(__file__).resolve().parents[1]))
    setting_dump = (
        "修炼分为九个大境界，每个境界又分九个小境界。"
        "灵根决定修炼速度，宗门提供功法传承。"
        "丹药分九品，阵法需要灵石驱动。"
        "血脉觉醒者天赋异禀，经脉通畅方能突破。"
        "天道因果循环，劫数不可违逆。"
    )
    content = setting_dump + "\n\n后续正文" + "字" * 2500
    issues = check_golden_three_opening(content, _make_ctx(1, str(tmp_path)))
    types = [i.type for i in issues if i.severity == "P0"]
    assert "golden_three_info_dump_in_first_300" in types


# ---------- 3. test_chapter_word_count_2500_3000 ----------
def test_chapter_word_count_2500_3000(tmp_path):
    """字数 < 2500 → P0 golden_three_word_count_violation。"""
    cfg = _resolve_golden_three_thresholds(str(Path(__file__).resolve().parents[1]))
    short_content = "首段钩子。\n\n" + "正文内容。" * 100  # 远不足 2500 字
    issues = check_golden_three_opening(short_content, _make_ctx(1, str(tmp_path)))
    types = [i.type for i in issues if i.severity == "P0"]
    assert "golden_three_word_count_violation" in types


# ---------- 4. test_golden_finger_appearance ----------
def test_golden_finger_appearance(tmp_path):
    """ch_003 末金手指未亮相 → P0 golden_three_golden_finger_missing。"""
    cfg = _resolve_golden_three_thresholds(str(Path(__file__).resolve().parents[1]))
    vault = str(tmp_path)
    # 构造 ch_001/002/003 均不含金手指名「系统」
    chapter_content = "首段钩子。\n\n" + "正文内容。" * 350 + "\n\n末段钩子？"
    for ch in (1, 2, 3):
        _make_chapter_file(vault, ch, chapter_content)
    ctx = _make_ctx(3, vault, golden_finger_names=["系统"])
    issues = check_golden_three_opening(chapter_content, ctx)
    types = [i.type for i in issues if i.severity == "P0"]
    assert "golden_three_golden_finger_missing" in types


# ---------- 5. test_chapter_3_end_hook ----------
def test_chapter_3_end_hook(tmp_path):
    """ch_003 末段含收束词 → P0 golden_three_chapter_3_end_no_hook。"""
    cfg = _resolve_golden_three_thresholds(str(Path(__file__).resolve().parents[1]))
    content = "首段钩子。\n\n" + "正文内容。" * 350 + "\n\n就这样，他开始了修炼之路。"
    issues = check_golden_three_opening(content, _make_ctx(3, str(tmp_path)))
    types = [i.type for i in issues if i.severity == "P0"]
    assert "golden_three_chapter_3_end_no_hook" in types


# ---------- 6. test_chapter_4_not_affected ----------
def test_chapter_4_not_affected(tmp_path):
    """第 4 章 is_opening_chapter=False，golden_three_opening 返回空 issues。"""
    cfg = _resolve_golden_three_thresholds(str(Path(__file__).resolve().parents[1]))
    # 第 4 章首段 200 字、字数 1800 字（违反黄金三章但不检测）
    long_first_para = "首段超长。" * 50
    content = f"{long_first_para}\n\n" + "正文。" * 200
    ctx = _make_ctx(4, str(tmp_path))  # chapter_num=4
    assert ctx.is_opening_chapter is False
    issues = check_golden_three_opening(content, ctx)
    assert issues == []


# ---------- 7. test_golden_three_rules_json_valid ----------
def test_golden_three_rules_json_valid():
    """golden_three_rules.json 格式合法，含 5 条规则且阈值齐全。"""
    json_path = Path(__file__).resolve().parents[1] / "scripts" / "novelforge" / "data" / "golden_three_rules.json"
    assert json_path.is_file(), f"golden_three_rules.json 不存在：{json_path}"
    with open(json_path, encoding="utf-8") as f:
        cfg = json.load(f)
    assert cfg.get("schema_version") == "1.0"
    rules = cfg.get("rules", {})
    expected = {
        "first_paragraph_hook_length",
        "info_density_first_300",
        "chapter_word_count_2500_3000",
        "golden_finger_appearance",
        "chapter_3_end_hook",
    }
    assert expected.issubset(set(rules.keys())), f"缺失规则：{expected - set(rules.keys())}"
    for name, rule in rules.items():
        assert rule.get("severity") == "P0", f"{name} severity 应为 P0"
        assert "threshold" in rule, f"{name} 缺 threshold"
        assert "detection_logic" in rule, f"{name} 缺 detection_logic"
        assert "countermeasure" in rule, f"{name} 缺 countermeasure"
```

### 7.2 新增 BUG-061「黄金三章硬约束门禁未实现导致开篇质量失控」

在 [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) 末尾追加（按 `.trae/rules/bug-reporting.md` 字段模板）：

```markdown
## 黄金三章硬约束门禁未实现导致开篇质量失控

- **编号**：BUG-061
- **首次出现**：2026-07-18
- **类型**：一致性 / 去 AI 味
- **模式**：novel
- **现象**：architect SKILL.md §第六步已规定黄金三章首段钩子 ≤80 字、信息密度 ≤30%、字数 2500-3000 三项约束，writer-polisher SKILL.md 也已内化首段钩子约束，但 check_ai_novel.py 的 10 维检测未显式实现黄金三章专属检测，导致 writer-polisher 阶段生成的第 1 章若首段 200 字、字数 1800 字、第 3 章末无钩子等开篇失误均能直接进 published 目录而无人拦截。
- **根因**：architect SKILL.md §第六步的黄金三章约束是「软引导」，未对应到 check_ai_novel.py 的「硬门禁」；既有 check_opening_flat 只检测前 200 字套话/张力，check_word_count 用 ±20% 软边界 1600-3600 远宽于 2500-3000，check_chapter_end_hook 是通用章末钩子（ch_003 无专属硬约束），无一条 P0 门禁能阻止开篇失误。
- **修复**：在 check_ai_novel.py 新增 check_golden_three_opening 聚合检测维度，含 5 类硬约束子检测（首段钩子 ≤80 字 / 前 300 字信息密度 ≤30% / 字数 2500-3000 不可短 / 金手指在第 3 章前戏剧性亮相 / 第 3 章末必有钩子不可豁免）；阈值 SSOT 集中在 scripts/novelforge/data/golden_three_rules.json；architect / writer-polisher SKILL.md 引用检测命令；dev-checklist.md 新增检测项。
- **涉及文件**：scripts/novelforge/check_ai_novel.py、scripts/novelforge/data/golden_three_rules.json、.trae/skills/architect/SKILL.md、.trae/skills/writer-polisher/SKILL.md、.trae/checklists/dev-checklist.md
- **回归测试**：tests/test_golden_three_chapters.py 新增 7 个测试用例（5 类硬约束可触发 / 第 4 章不误报 / JSON 格式合法）
- **教训**：Skill 的「软引导」必须对应到脚本的「硬门禁」，否则 LLM 生成时不会自觉遵守。黄金三章决定作品命运，必须 P0 阻断不达标章节。
```

### 7.3 完整测试集执行

```bash
# 黄金三章专项回归
pytest -q tests/test_golden_three_chapters.py

# check_ai_novel 全量检测（含新维度）
python -m scripts.novelforge.check_ai_novel --chapter 1 --strict
python -m scripts.novelforge.check_ai_novel --chapter 2 --strict
python -m scripts.novelforge.check_ai_novel --chapter 3 --strict
python -m scripts.novelforge.check_ai_novel --chapter 4 --strict  # 第 4 章不应触发 golden_three_opening

# 一致性检测（确保未破坏既有检测）
python -m scripts.novelforge.check_consistency --vault NovelForge_Vault

# 全量 pytest
pytest -q
```

---

## 八、风险点与回滚方案

### 8.1 风险等级：中

主要风险集中在阈值调参与既有检测的叠加效应：

| 风险 | 等级 | 影响 | 缓解措施 |
|---|---|---|---|
| 信息密度 30% 阈值误伤 | 中 | 设定性名词词表覆盖玄幻常用词，科幻/都市/言情开篇可能误报 | `setting_nouns` 列表可按风格扩展；作者可在 `golden_three_rules.json` 中关闭 `info_density_first_300.enabled` 或调高 `info_density_max` |
| 字数 2500-3000 硬约束过严 | 中 | 部分作者风格偏好 2200-2400 字短章，会被 P0 阻断 | 作者可在 `golden_three_rules.json` 中调低 `word_count_min` 至 2200；或对个别章节在章纲 frontmatter 标注 `golden_three_strict=false` 跳过（后续迭代支持） |
| 金手指亮相检测依赖 protagonist.json | 低 | 若 `power_level.abilities` 未配置，检测降级为 P2 提醒，不阻断 | 在 architect SKILL.md §第六步任务表标注「金手指亮相」列，提醒作者配置 abilities |
| 与既有 check_opening_flat / check_chapter_end_hook / check_word_count 叠加 | 低 | 同一章可能同时触发既有检测和黄金三章检测的 P0，issues 列表变长 | 不冲突，取严不取松；writer-polisher §阶段三修复时一并处理 |
| ch_003 末钩子不可豁免与 vol_end 冲突 | 低 | 若 ch_003 恰好是卷末章（罕见，通常卷末在第 20+ 章），本检测仍强制要求钩子 | 黄金三章不可能同时是卷末（卷末至少在第 10+ 章），实际不冲突；若发生，作者可在 `golden_three_rules.json` 中关闭 `chapter_3_end_hook.enabled` |

### 8.2 对核心资产的影响

本模块修改的核心资产：

| 资产 | 修改类型 | 风险 |
|---|---|---|
| [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) | 新增 1 个聚合检测函数 + 5 个子检测函数 + 1 个 SSOT 加载函数 + 1 项 DIMENSIONS 注册 + 常量区追加 | 低：纯增量，不修改既有 10 维检测逻辑；复用 `CheckContext.is_opening_chapter` 门控，第 4 章及之后零影响 |
| [file:///workspace/.trae/skills/architect/SKILL.md](file:///workspace/.trae/skills/architect/SKILL.md) | §第六步追加 §6.1/6.2/6.3 三个子节 | 低：纯追加，不修改既有约束文字 |
| [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | §阶段一/二/三各追加 1 行/1 行/1 行 | 低：纯追加，不修改既有四阶段流水线 |
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | §一末尾追加 1 项 | 低：纯追加 |

### 8.3 回滚方案

1. **分支策略**：在 `feature/golden-three` 分支开发，合并前完整跑 `pytest -q` + `check_ai_novel --chapter {1,2,3,4}` + `check_consistency --vault NovelForge_Vault`，全绿方可合并 master。
2. **阈值回滚**：所有阈值集中在 `golden_three_rules.json`，回滚只需修改 JSON 文件，无需改代码。极端情况下可将 5 条规则的 `enabled` 全设为 `false`，等同禁用本模块。
3. **代码回滚**：若 `check_golden_three_opening` 引入 bug 影响既有检测，可直接从 `DIMENSIONS` 注册表移除该行，等同禁用本维度，既有 10 维检测不受影响。
4. **JSON 加载容错**：`_load_golden_three_rules_json` 解析失败返回 None，`_resolve_golden_three_thresholds` 自动 fallback 到硬编码常量，不会因 JSON 损坏导致脚本崩溃。

---

## 九、完成标准（DoD 清单）

- [ ] `scripts/novelforge/data/golden_three_rules.json` 创建，含 5 条规则 + fallback_hardcoded 区，schema_version=1.0
- [ ] `scripts/novelforge/check_ai_novel.py` 新增 `check_golden_three_opening` 聚合检测函数 + 5 个子检测函数 + `_load_golden_three_rules_json` + `_resolve_golden_three_thresholds` + 常量区追加 + `DIMENSIONS` 注册表追加 1 项
- [ ] `.trae/skills/architect/SKILL.md` §第六步追加 §6.1 硬约束门禁表 + §6.2 任务表（含金手指亮相列）+ §6.3 五种经典开篇模板
- [ ] `.trae/skills/writer-polisher/SKILL.md` §阶段一硬约束升级 + §阶段二检测表追加 1 行 + §阶段三修复策略表追加 1 行
- [ ] `.trae/checklists/dev-checklist.md` §一新增「黄金三章硬约束」检测项
- [ ] `tests/test_golden_three_chapters.py` 7 个测试用例全部通过：
  - [ ] test_first_paragraph_hook_length
  - [ ] test_info_density_first_300
  - [ ] test_chapter_word_count_2500_3000
  - [ ] test_golden_finger_appearance
  - [ ] test_chapter_3_end_hook
  - [ ] test_chapter_4_not_affected
  - [ ] test_golden_three_rules_json_valid
- [ ] `tests/bug_regression_list.md` 新增 BUG-061「黄金三章硬约束门禁未实现导致开篇质量失控」
- [ ] `pytest -q` 全量通过（含既有测试 + 新增 7 个用例）
- [ ] `python -m scripts.novelforge.check_ai_novel --chapter 4 --strict --dim golden_three_opening` 返回空 issues（第 4 章不误报验证）
- [ ] `python -m scripts.novelforge.check_consistency --vault NovelForge_Vault` 仍通过（未破坏一致性检测）
- [ ] commit message 符合 `.trae/skills/git-merge-guardian/SKILL.md` 规范，scope 示例：`feat(check_ai_novel): 新增黄金三章硬约束门禁检测（M11）`
