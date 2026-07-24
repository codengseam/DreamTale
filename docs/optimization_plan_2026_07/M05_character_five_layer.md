# M5 · 角色五层档案模型升级

> **模块层级**：L2 强化已有能力（让检测更准更全更深）
> **对应盲区**：Persona Vectors 角色漂移监控（master_plan §1.3 第 10 类盲区）
> **文档版本**：v1.0 · 2026-07-18
> **依赖**：M2（schema 同步门禁，需先完成 PIPELINE_SCHEMA 修复与 flag 协议）
> **下游影响**：M18（Persona Vectors 启发式角色漂移监控，本模块的 stable_info 是其比对基线）

---

## 一、模块目标

### 1.1 一句话目标

将 `protagonist.json` schema 从扁平字段升级为五层动态档案模型，显式拆分 `stable_info` / `mutable_info`，新增角色语言指纹漂移检测，把 NovelForge 的可承载篇长从 50 万字推进到 200 万+。

### 1.2 对应的痛点

行业调研发现「**动态人物记忆 > 静态角色卡**」是把篇长从 50 万字推到 200 万+ 的核心技术。当前 NovelForge 的角色状态机存在三类致命缺陷：

1. **扁平 schema 无保护层级**：`protagonist.json` 11 个顶层字段平铺，`save_state.py` 的 `_apply_op_to_dict`（`file:///workspace/scripts/novelforge/save_state.py` line 362-404）对任何路径都开放 `set/append/remove/merge`，没有任何字段保护机制。LLM 在生成第 N 章 Delta 时可能把主角的「核心欲望」或「性格正反面」悄悄覆写，导致人设崩塌。
2. **缺少性格的「燃料与刹车」层**：当前 schema 只有 `basic.appearance_keywords` + `emotion.baseline` + `arc_stage`，没有「核心欲望（燃料）」与「底层恐惧（刹车）」字段。AI 写到 50 万字后失去锚点，高冷变话痨、腹黑变圣母、隐忍变暴躁，因为没有「为什么这个角色会这样做」的内驱力约束。
3. **语言指纹是单点快照而非漂移监控对象**：`language_fingerprint` 字段存在（`file:///workspace/scripts/novelforge/schema.py` line 154-164），`check_ai_novel.py` 的 `check_dialogue_identity`（line 825-902）做单章检测，但没有跨章漂移检测——即「连续 N 章主角台词句长逐渐偏离指纹基线」这类慢性漂移无人盯。

### 1.3 完成后达成的能力

| 能力 | 当前状态 | 完成后 |
|---|---|---|
| 角色档案覆盖五层 | 扁平 11 字段，缺核心欲望/底层恐惧/行为标签/弧光节点 | 五层完整：核心欲望与底层恐惧 / 性格正反面与行为标签 / 成长弧光与转变节点 / 人物关系网 / 语言指纹 |
| `save_state.py` 字段级保护 | 全字段开放写入，无保护 | `stable_info` 字段拒绝任何 `set/merge/remove` op，仅 `mutable_info` 可 Delta 更新 |
| 跨章语言指纹漂移检测 | 无（只有单章 `dialogue_identity`） | `check_consistency.py` 新增第 8 类检测 `character_language_fingerprint_drift`，连续 3 章偏离基线 >30% 触发 P1 |
| 角色档案与章纲联动 | `protagonist.md` 弧光阶段表人工维护，与状态机脱节 | `architect` 生成角色时按五层产出；`writer-polisher` 每章只更新 `mutable_info`，弧光推进经 architect 显式迁移 |
| 篇长承载能力 | 50 万字后人设崩塌概率高（无 stable 锚点） | 200 万+ 字可承载（stable_info 强保护 + 漂移检测双保险） |

---

## 二、痛点对应

### 2.1 痛点表现：Transformer 固有特性 + AI 训练目标拧巴

**根因 1：Transformer 远距离注意力衰减**

Transformer 的自注意力机制对远距离上下文的注意力权重天然衰减（[Vaswani et al., 2017](https://arxiv.org/abs/1706.03762)）。写到第 200 章时，第 1 章确立的「主角核心欲望是寻母」这个锚点，在注意力分布中可能已经被 199 章的近端上下文稀释到几乎不可见。LLM 不是「忘了」，而是「注意力够不到」。

**根因 2：AI 训练目标天生拧巴**

LLM 的训练目标是「生成流畅有创意的文本」，而创作系统的要求是「遵循设定 + 生成流畅有创意的文本」。这两个目标在长篇生成中会冲突——当 LLM 为了让本段更流畅、更有戏剧张力时，会本能地牺牲「设定一致性」。例如主角设定是「惜字如金」，但本章为了制造冲突让主角长篇大论，LLM 会选择流畅性而牺牲指纹。

**典型崩塌场景**（行业调研归纳）：

| 崩塌类型 | 50 万字处表现 | 根因 |
|---|---|---|
| 性格反转 | 高冷主角变话痨 | 无 stable 性格锚点，LLM 按近期上下文推断性格 |
| 动机断裂 | 复仇主角突然原谅仇人 | 无核心欲望字段，LLM 按本章情绪推进 |
| 语言漂移 | 主角句长从 12 字渐变到 28 字 | 无跨章漂移检测，单章检测容忍 ±30% |
| 关系突变 | 仇人变盟友无铺垫 | relationships 无 origin/trajectory 字段 |
| 弧光跳跃 | 觉醒阶段直接跳到超脱 | arc_stage 无转变节点约束 |

### 2.2 行业方案

**方案 A：五层动态行为准则档案**（本模块主参考）

行业最佳实践（[Persona Vectors 论文](https://arxiv.org/abs/2407.18431) + [Letta Filesystem Memory](https://github.com/letta-ai/letta) + [CreAgentive 角色卡设计](https://github.com/langboat/CreAgentive)）建议角色档案分五层，每层有明确的「稳定 vs 动态」属性：

1. **核心欲望与底层恐惧**（强稳定）：性格的燃料和刹车，全书不变，除非有「核心转变事件」
2. **性格正反面与行为标签**（强稳定）：具体行为标签如「遇到问题时先转笔，停顿三秒再开口」远胜抽象的「他很聪明」
3. **成长弧光与转变节点**（半稳定）：至少三个核心转变，每个有明确触发事件，触发前后的性格可变
4. **人物关系网**（动态）：每条关系线有起点和走向，信任值/态度值随章节更新
5. **语言指纹**（基线稳定 + 漂移监控）：口头禅/小动作/决策偏好作为基线，实际台词偏离基线时告警

**方案 B：三文件法**（Character Card + State Machine + Dialogue Log）

将角色信息分散到三个文件：静态卡（人工维护）、动态状态机（脚本维护）、对话日志（每章追加）。优点是职责清晰，缺点是文件多、同步成本高。

**方案 C：记忆层 + 创作层 + 审核层三层架构**（[MemoRAG](https://arxiv.org/abs/2409.05591) 思路）

记忆层存全量角色历史，创作层只取近期上下文，审核层对比记忆层与创作层输出。优点是漂移检测自动化，缺点是 Token 成本高。

### 2.3 本模块的差异化设计

NovelForge 的差异化在于「**stable_info / mutable_info 显式拆分 + Delta 写保护 + 跨章漂移检测**」三位一体：

1. **stable_info 强保护**（区别于方案 A/B/C）：在 JSON schema 层显式拆分 `stable_info` / `mutable_info` 两个顶层对象；`save_state.py` 的 `apply_delta` 对任何 `stable_info/...` 路径的 `set/merge/remove` op 直接 `raise ValueError` 拒绝。只有 `architect` Skill 在「核心转变事件」时经作者确认后走专用迁移通道修改 stable_info。
2. **Delta 增量只动 mutable**（继承 NovelForge 现有哲学）：`writer-polisher` 每章产出的 Delta 只能命中 `mutable_info/...` 路径，`stable_info` 在写作过程中完全冻结，杜绝 LLM 在生成 Delta 时悄悄覆写性格锚点。
3. **跨章漂移检测**（区别于 check_ai_novel 的单章检测）：`check_consistency.py` 新增第 8 类检测 `character_language_fingerprint_drift`，加载最近 N 章对话统计，计算滚动均值与 `stable_info.language_fingerprint` 基线对比，连续 3 章偏离 >30% 触发 P1。这是「慢性漂移」检测，与 `check_ai_novel.py` 的「急性偏离」检测（单章偏离 >30%）互补。
4. **零外部依赖**（继承 NovelForge 哲学）：仅用 Python 标准库（`json`/`re`/`os`/`statistics`），不引入 embedding 模型（那是 M18 的职责），不引入向量库（那是 M17 的职责）。本模块只做「基线 vs 实际」的统计比对，可解释、可调试。

---

## 三、涉及现有文件

### 3.1 状态机与脚本文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| protagonist.json | `file:///workspace/NovelForge_Vault/.state/characters/protagonist.json` | 全文（当前扁平 schema，11 个顶层字段，需迁移为五层 stable_info + mutable_info） |
| schema.py | `file:///workspace/scripts/novelforge/schema.py` | line 18-170（`CHARACTER_STATE_SCHEMA` 定义）、line 308-322（`validate_character_state` 只校验 required 字段，需扩展五层校验） |
| save_state.py | `file:///workspace/scripts/novelforge/save_state.py` | line 81-132（`EMPTY_CHARACTER_TEMPLATE` 模板需同步五层）、line 362-404（`_apply_op_to_dict` 无字段保护，需加 stable_info 守卫）、line 563-624（`_apply_op` 路由分派，需在 character 分支前置 stable_info 检查） |
| check_consistency.py | `file:///workspace/scripts/novelforge/check_consistency.py` | line 182-201（`ALL_DIMENSIONS` 与 `DIM_LABELS` 需加第 8 类）、line 1203-1209（`_DIM_CHECKERS_NO_VAULT` 字典需注册新检测函数）、line 1212-1289（`check_all` 编排，需把新维度加入分派） |
| check_ai_novel.py | `file:///workspace/scripts/novelforge/check_ai_novel.py` | line 825-902（`check_dialogue_identity` 单章检测，本模块不改动它，但需明确与新跨章漂移检测的边界）、line 416-438（`load_all_fingerprints` 加载指纹，新检测复用此函数） |

### 3.2 Skill 文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| architect SKILL.md | `file:///workspace/.trae/skills/architect/SKILL.md` | line 40-75（生成流水线，需新增「角色档案生成」层级）、line 100-150（章纲十段模板，需在「四、出场角色」段引用五层档案）、line 237-242（禁止事项，需加「禁止自动覆写 stable_info」） |
| writer-polisher SKILL.md | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | line 178-249（阶段四状态更新，需约束 Delta 只命中 mutable_info）、line 192-205（Delta JSON 示例，需改为 mutable_info/... 路径）、line 302-312（错误处理，需加 stable_info 写入拒绝的处理） |
| state-consistency-checker SKILL.md | `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` | line 95-106（7 类检测解读表，需扩为 8 类）、line 162-171（golden_finger_overreach 解读后需追加第 8 类解读） |

### 3.3 Vault 文档文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| style_guide.md | `file:///workspace/NovelForge_Vault/00_控制面/style_guide.md` | line 102-138（附录 B 角色语言指纹规范，需升级为五层档案规范引用） |
| protagonist.md | `file:///workspace/NovelForge_Vault/02_角色/protagonist.md` | 全文（当前十段模板，需对齐五层结构：基本信息→外貌→性格→背景→动机→弧光→语言指纹→关系网→金手指，需补核心欲望/底层恐惧/行为标签） |

### 3.4 现状速读结论

- **schema 层**：`CHARACTER_STATE_SCHEMA` 是扁平结构，`required` 只有 5 个字段（`character_id/basic/location/status/last_appeared_ch`），`validate_character_state` 只做存在性校验，不校验五层完整性，不区分 stable/mutable。
- **写入层**：`save_state.py` 的 `_apply_op_to_dict`（line 362-404）对任何 `sub_path` 都执行 `set/append/remove/merge`，没有任何字段保护。`_apply_op`（line 544-624）在 character 分支只做 `validate_character_state` 后置校验，不做前置 stable_info 守卫。
- **检测层**：`check_consistency.py` 的 `ALL_DIMENSIONS`（line 182-190）是 7 项列表，`_DIM_CHECKERS_NO_VAULT`（line 1203-1209）注册了 5 个无 vault 依赖的检测函数。新增第 8 类只需在两个字典各加一行 + 写一个 `check_character_language_fingerprint_drift` 函数。
- **角色卡层**：`protagonist.md` 的「三、性格」「五、动机」「六、弧光阶段」三段与五层模型部分对应，但缺少「核心欲望 vs 底层恐惧」的张力对、「行为标签」具体化、「弧光转变节点」的触发事件字段。
- **语言指纹层**：`style_guide.md` 附录 B 已有 5 个字段（`avg_sentence_length/preferred_words/catchphrases/forbidden_words/address_habits`），`check_ai_novel.py` 已有单章检测，跨章漂移检测是空白。

修复策略以「**schema 升级为信源**」+ 「**save_state 守卫为门禁**」+ 「**check_consistency 漂移检测为预警**」三层并进：schema 定义五层结构与 stable/mutable 边界；save_state 在 op 应用前拦截 stable_info 写入；check_consistency 在章后检测跨章漂移趋势。

---

## 四、新增/修改文件清单

### 4.1 修改文件

| 路径 | 核心改动点 |
|---|---|
| `file:///workspace/scripts/novelforge/schema.py` | `CHARACTER_STATE_SCHEMA` 升级为五层结构（`stable_info` + `mutable_info` + `meta`）；新增 `STABLE_INFO_FIELDS` 常量集合；`validate_character_state` 扩展五层完整性校验 |
| `file:///workspace/NovelForge_Vault/.state/characters/protagonist.json` | 迁移到五层结构，`stable_info` 含核心欲望/底层恐惧/性格正反面/行为标签/弧光定义/语言指纹基线；`mutable_info` 含位置/境界/情绪/关系/知识/目标/当前弧光阶段；`meta` 含首末出场/状态 |
| `file:///workspace/scripts/novelforge/save_state.py` | `EMPTY_CHARACTER_TEMPLATE` 同步五层；`_apply_op` 在 character 分支前置 `_check_stable_info_protection` 守卫；新增 `STABLE_INFO_FIELDS` 常量与守卫函数 |
| `file:///workspace/scripts/novelforge/check_consistency.py` | `ALL_DIMENSIONS` 加第 8 项 `character_language_fingerprint_drift`；`DIM_LABELS` 加中文标签；`_DIM_CHECKERS_NO_VAULT` 注册新函数；新增 `check_character_language_fingerprint_drift` 函数 |
| `file:///workspace/.trae/skills/architect/SKILL.md` | 生成流水线新增「角色档案生成」层级（L0.5，位于世界观与 story_arc 之间）；新增五层生成模板；禁止事项加「禁止自动覆写 stable_info」 |
| `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | 阶段四状态更新约束 Delta 只命中 `mutable_info/...`；Delta JSON 示例改为 `mutable_info/...` 路径；错误处理加 stable_info 写入拒绝处置 |
| `file:///workspace/NovelForge_Vault/00_控制面/style_guide.md` | 附录 B 升级为「角色五层档案规范」，引用五层 schema；保留原指纹字段表作为第五层细化 |
| `file:///workspace/NovelForge_Vault/02_角色/protagonist.md` | 十段模板对齐五层：补「核心欲望与底层恐惧」段、「行为标签」段；弧光阶段表加「触发事件」列 |
| `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` | 7 类检测解读表扩为 8 类；新增第 8 类 `character_language_fingerprint_drift` 解读指南 |
| `file:///workspace/tests/bug_regression_list.md` | 新增 BUG-055 条目「角色档案缺失核心欲望与底层恐惧层导致人设漂移」 |

### 4.2 新增文件

| 路径 | 用途 |
|---|---|
| `file:///workspace/scripts/novelforge/data/character_fingerprints/` | 角色指纹库目录，存放每个角色的语言指纹快照（按章号归档），供跨章漂移检测加载历史。每文件命名 `<character_id>_ch<NNN>.json`，内容为本章对话统计快照 |
| `file:///workspace/tests/test_character_five_layer.py` | 6 个回归测试用例，锁定五层结构 / stable_info 保护 / mutable_info Delta / 漂移检测 / architect 生成 / protagonist.json 迁移 |

### 4.3 不修改的核心资产

- `scripts/novelforge/check_ai_novel.py` 的 `check_dialogue_identity` —— 单章检测逻辑保持不变，与本模块的跨章漂移检测互补。
- `scripts/novelforge/build_context.py` —— 上下文组装逻辑不改，但其读取 `protagonist.json` 时会自动适配新结构（`stable_info` 全量注入 Protected 层，`mutable_info` 按需注入）。
- `NovelForge_Vault/00_控制面/style_guide.md` 的 §一/§二/附录 A —— novel/shortform 文风规范与心理-生理映射表不动，只升级附录 B。

---

## 五、详细实现步骤

### 步骤 1：设计五层 schema 的完整 JSON 结构

将 `CHARACTER_STATE_SCHEMA` 从扁平 11 字段升级为 `stable_info` + `mutable_info` + `meta` 三段。五层分别落在 `stable_info`（层 1/2/3 的定义部分 + 层 5 基线）与 `mutable_info`（层 3 当前阶段 + 层 4 + 层 5 滚动值）中。

**完整 schema 结构**（写入 `file:///workspace/scripts/novelforge/schema.py`）：

```python
CHARACTER_STATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["character_id", "stable_info", "mutable_info", "meta"],
    "properties": {
        "character_id": {"type": "string", "description": "角色 ID，如 protagonist"},

        # ====================================================================
        # stable_info —— 强保护层，禁止 save_state.py 的 Delta 写入
        # 只能由 architect Skill 在「核心转变事件」时经作者确认后迁移
        # ====================================================================
        "stable_info": {
            "type": "object",
            "required": ["basic", "core_desire_fear", "personality", "arc_definition", "language_fingerprint"],
            "description": "强保护层：角色的不变属性，全书不变除非核心转变",
            "properties": {

                # --- 层 1：核心欲望与底层恐惧 ---
                "core_desire_fear": {
                    "type": "object",
                    "required": ["core_desire", "deep_fear"],
                    "description": "性格的燃料与刹车，全书不变",
                    "properties": {
                        "core_desire": {
                            "type": "string",
                            "description": "核心欲望（燃料）：推动角色行动的根本内驱力，如「寻母」",
                        },
                        "deep_fear": {
                            "type": "string",
                            "description": "底层恐惧（刹车）：角色最害怕的事，如「再次被至亲抛弃」",
                        },
                        "contradictory_belief": {
                            "type": "string",
                            "default": "",
                            "description": "矛盾信念：欲望与恐惧的张力点，如「寻母意味着面对她抛弃自己的真相」",
                        },
                    },
                },

                # --- 层 2：性格正反面与行为标签 ---
                "personality": {
                    "type": "object",
                    "required": ["positive_traits", "negative_traits"],
                    "properties": {
                        "positive_traits": {
                            "type": "array",
                            "description": "性格正面：每个含性格词 + 行为示例",
                            "items": {
                                "type": "object",
                                "required": ["trait", "behavior_example"],
                                "properties": {
                                    "trait": {"type": "string", "description": "如「隐忍」"},
                                    "behavior_example": {"type": "string", "description": "如「被师弟羞辱时不还口，转身把怨气化作修炼动力」"},
                                },
                            },
                            "default": [],
                        },
                        "negative_traits": {
                            "type": "array",
                            "description": "性格反面：每个含性格词 + 行为示例",
                            "items": {
                                "type": "object",
                                "required": ["trait", "behavior_example"],
                                "properties": {
                                    "trait": {"type": "string", "description": "如「偏执」"},
                                    "behavior_example": {"type": "string", "description": "如「为达目的不惜利用至友」"},
                                },
                            },
                            "default": [],
                        },
                        "behavior_tags": {
                            "type": "array",
                            "description": "行为标签：具体可观察的小动作，远胜抽象性格词",
                            "items": {"type": "string"},
                            "default": [],
                            # 示例：["遇到问题时先转笔，停顿三秒再开口", "愤怒时左手会摸向剑柄"]
                        },
                    },
                },

                # --- 层 3：成长弧光定义（转变节点结构，半稳定） ---
                "arc_definition": {
                    "type": "object",
                    "required": ["stages"],
                    "description": "弧光阶段定义：至少 3 个核心转变，每个有触发事件",
                    "properties": {
                        "stages": {
                            "type": "array",
                            "description": "弧光阶段列表，至少 3 个",
                            "minItems": 3,
                            "items": {
                                "type": "object",
                                "required": ["stage_id", "stage_name", "belief", "trigger_event"],
                                "properties": {
                                    "stage_id": {"type": "string", "description": "阶段 ID，如 awakening_pre"},
                                    "stage_name": {"type": "string", "description": "阶段名，如「蒙昧」"},
                                    "belief": {"type": "string", "description": "此阶段的信念，如「强者才能活」"},
                                    "behavior_pattern": {"type": "string", "description": "行为模式，如「隐忍、苟」"},
                                    "trigger_event": {
                                        "type": "string",
                                        "description": "触发进入下一阶段的事件描述，如「师门灭门」",
                                    },
                                    "trigger_ch": {
                                        "type": ["integer", "null"],
                                        "default": None,
                                        "description": "触发章号，未触发为 null",
                                    },
                                    "volume": {"type": "string", "description": "对应卷，如 vol_01"},
                                },
                            },
                        },
                    },
                },

                # --- 层 5：语言指纹基线（强稳定，漂移检测的比对锚点） ---
                "language_fingerprint": {
                    "type": "object",
                    "description": "语言指纹基线：跨章漂移检测的比对锚点",
                    "required": ["avg_sentence_length"],
                    "properties": {
                        "avg_sentence_length": {"type": "integer", "default": 12, "description": "台词平均句长（字）"},
                        "preferred_words": {"type": "array", "items": {"type": "string"}, "default": [], "description": "高频词"},
                        "catchphrases": {"type": "array", "items": {"type": "string"}, "default": [], "description": "口头禅"},
                        "forbidden_words": {"type": "array", "items": {"type": "string"}, "default": [], "description": "绝不会说的词"},
                        "address_habits": {"type": "object", "default": {}, "description": "称呼习惯"},
                        "decision_preference": {
                            "type": "string",
                            "default": "",
                            "description": "决策偏好：如「遇事先观察三息再动」",
                        },
                    },
                },

                # --- basic（半稳定：换名/新别名时由 architect 迁移） ---
                "basic": {
                    "type": "object",
                    "required": ["name", "role"],
                    "properties": {
                        "name": {"type": "string"},
                        "aliases": {"type": "array", "items": {"type": "string"}, "default": []},
                        "role": {"type": "string", "enum": ["protagonist", "antagonist", "supporting", "extra"]},
                        "age": {"type": ["integer", "null"], "default": None},
                        "appearance_keywords": {"type": "array", "items": {"type": "string"}, "default": []},
                        "origin": {"type": "string", "default": "", "description": "出身背景，500-1000 字"},
                    },
                },
            },
        },

        # ====================================================================
        # mutable_info —— Delta 增量层，每章由 writer-polisher 经 save_state 更新
        # ====================================================================
        "mutable_info": {
            "type": "object",
            "required": ["location", "status"],
            "description": "动态层：每章可变的状态",
            "properties": {

                # --- 层 3 当前弧光阶段（动态：指向 arc_definition.stages 中的某个 stage_id） ---
                "current_arc_stage": {
                    "type": "string",
                    "default": "",
                    "description": "当前所处弧光阶段 ID，对应 stable_info.arc_definition.stages[].stage_id",
                },

                # --- 层 4：人物关系网（动态：信任值/态度随章更新；origin/trajectory 在 stable 不变） ---
                "relationships": {
                    "type": "array",
                    "default": [],
                    "items": {
                        "type": "object",
                        "required": ["target", "type"],
                        "properties": {
                            "target": {"type": "string", "description": "对方角色 ID 或名字"},
                            "type": {"type": "string", "enum": ["ally", "enemy", "mentor", "lover", "family", "rival", "neutral", "broken"]},
                            "trust": {"type": "integer", "minimum": -100, "maximum": 100, "description": "当前信任值"},
                            "attitude": {"type": "string", "default": "", "description": "当前态度一句话"},
                            "last_interaction_ch": {"type": "integer", "default": 0},
                            "origin": {"type": "string", "default": "", "description": "关系起点：如何相识"},
                            "trajectory": {"type": "string", "default": "", "description": "关系走向：预期发展"},
                            "history": {
                                "type": "array",
                                "default": [],
                                "items": {"type": "object", "properties": {"ch": {"type": "integer"}, "event": {"type": "string"}}},
                            },
                        },
                    },
                },

                # --- 层 5 滚动值：最近 N 章的对话统计快照（漂移检测用） ---
                "language_fingerprint_recent": {
                    "type": "object",
                    "default": {},
                    "description": "最近 N 章对话统计滚动值，由 check_consistency 写入快照",
                    "properties": {
                        "last_5_ch_avg_sentence_length": {"type": "number", "default": 0},
                        "last_5_ch_preferred_hit_rate": {"type": "number", "default": 0},
                        "last_updated_ch": {"type": "integer", "default": 0},
                    },
                },

                # --- 以下为原扁平结构的动态字段，平移到 mutable_info ---
                "location": {
                    "type": "object",
                    "required": ["current"],
                    "properties": {
                        "current": {"type": "string"},
                        "last_updated_ch": {"type": "integer", "default": 0},
                        "recent_trajectory": {
                            "type": "array",
                            "items": {"type": "object", "properties": {"ch": {"type": "integer"}, "place": {"type": "string"}}},
                            "default": [],
                        },
                    },
                },
                "power_level": {
                    "type": "object",
                    "properties": {
                        "realm": {"type": "string"},
                        "realm_progress": {"type": "number", "minimum": 0, "maximum": 1, "default": 0},
                        "abilities": {"type": "array", "default": []},
                        "limitations": {"type": "array", "items": {"type": "string"}, "default": []},
                        "next_breakthrough": {"type": "object", "default": {}},
                    },
                },
                "inventory": {"type": "array", "default": []},
                "emotion": {
                    "type": "object",
                    "properties": {
                        "current": {"type": "string"},
                        "last_updated_ch": {"type": "integer", "default": 0},
                        "recent_arc": {"type": "array", "default": []},
                        "baseline": {"type": "string"},
                    },
                },
                "knowledge": {
                    "type": "object",
                    "properties": {
                        "known_facts": {"type": "array", "items": {"type": "string"}, "default": []},
                        "unknown_facts": {"type": "array", "items": {"type": "string"}, "default": []},
                        "misconceptions": {"type": "array", "default": []},
                    },
                },
                "unresolved_personal_arcs": {"type": "array", "default": []},
                "goals": {
                    "type": "object",
                    "properties": {
                        "short_term": {"type": "string"},
                        "long_term": {"type": "string"},
                        "secret_goal": {"type": "string"},
                    },
                },
            },
        },

        # ====================================================================
        # meta —— 元信息层
        # ====================================================================
        "meta": {
            "type": "object",
            "required": ["status", "last_appeared_ch"],
            "properties": {
                "first_appear_ch": {"type": "integer", "default": 1, "description": "首出场章（半稳定）"},
                "last_appeared_ch": {"type": "integer", "default": 0, "description": "最后出场章（动态）"},
                "status": {"type": "string", "enum": ["active", "dead", "missing", "unknown", "archived"], "default": "active"},
                "schema_version": {"type": "string", "default": "5layer-v1", "description": "schema 版本标识"},
            },
        },
    },
}

# stable_info 顶层字段集合 —— save_state.py 守卫用
STABLE_INFO_FIELDS: frozenset[str] = frozenset({
    "basic", "core_desire_fear", "personality", "arc_definition", "language_fingerprint",
})
```

**字段约束说明**：

| 字段 | 类型 | 默认值 | 必填 | 所属层 |
|---|---|---|---|---|
| `stable_info.core_desire_fear.core_desire` | string | — | ✅ | 层 1 |
| `stable_info.core_desire_fear.deep_fear` | string | — | ✅ | 层 1 |
| `stable_info.core_desire_fear.contradictory_belief` | string | "" | ❌ | 层 1 |
| `stable_info.personality.positive_traits` | array | [] | ✅ | 层 2 |
| `stable_info.personality.negative_traits` | array | [] | ✅ | 层 2 |
| `stable_info.personality.behavior_tags` | array | [] | ❌ | 层 2 |
| `stable_info.arc_definition.stages` | array(minItems:3) | — | ✅ | 层 3 定义 |
| `stable_info.language_fingerprint.avg_sentence_length` | int | 12 | ✅ | 层 5 基线 |
| `stable_info.basic.name` | string | — | ✅ | 基本信息 |
| `mutable_info.current_arc_stage` | string | "" | ❌ | 层 3 当前 |
| `mutable_info.relationships` | array | [] | ❌ | 层 4 |
| `mutable_info.location.current` | string | — | ✅ | 位置 |
| `mutable_info.power_level` | object | {} | ❌ | 境界 |
| `mutable_info.language_fingerprint_recent` | object | {} | ❌ | 层 5 滚动 |
| `meta.status` | enum | active | ✅ | 元信息 |
| `meta.last_appeared_ch` | int | 0 | ✅ | 元信息 |

### 步骤 2：设计 stable_info / mutable_info 拆分的具体字段清单

| 原扁平字段 | 迁移目标 | 拆分理由 |
|---|---|---|
| `character_id` | 顶层（不变） | 角色唯一标识，全书不变 |
| `basic.name/aliases/role/age/appearance_keywords` | `stable_info.basic` | 姓名/角色定位/外貌关键词全书不变；`age` 跟随 `mutable_info` 时间推进但不由 save_state 自动改，归 stable |
| `basic` 新增 `origin` | `stable_info.basic.origin` | 出身背景 500-1000 字，全书不变 |
| `location` | `mutable_info.location` | 位置每章可变 |
| `power_level` | `mutable_info.power_level` | 境界/能力每章可变（突破时） |
| `inventory` | `mutable_info.inventory` | 物品每章可变（获得/消耗） |
| `emotion` | `mutable_info.emotion` | 情绪每章可变 |
| `relationships` | `mutable_info.relationships`（增强 `origin/trajectory/attitude` 字段） | 关系状态每章可变；`origin/trajectory` 在关系建立时确定，但仍归 mutable（建立本身就是动态事件） |
| `knowledge` | `mutable_info.knowledge` | 已知/未知每章可变 |
| `unresolved_personal_arcs` | `mutable_info.unresolved_personal_arcs` | 个人支线进度每章可变 |
| `goals` | `mutable_info.goals` | 短期/长期/隐藏目标可变（长期目标较稳定但允许调整） |
| `language_fingerprint` | `stable_info.language_fingerprint`（基线）+ `mutable_info.language_fingerprint_recent`（滚动值） | 基线全书不变（漂移检测锚点）；滚动值由 check_consistency 每章更新 |
| `arc_stage` | `mutable_info.current_arc_stage` | 当前所处阶段可变（转变时） |
| `last_appeared_ch` | `meta.last_appeared_ch` | 元信息 |
| `first_appear_ch` | `meta.first_appear_ch` | 元信息（半稳定） |
| `status` | `meta.status` | 元信息 |
| **新增** `core_desire_fear` | `stable_info.core_desire_fear` | 层 1：核心欲望与底层恐惧，全书不变 |
| **新增** `personality.positive_traits/negative_traits/behavior_tags` | `stable_info.personality` | 层 2：性格正反面与行为标签，弧光转变时可由 architect 迁移 |
| **新增** `arc_definition.stages` | `stable_info.arc_definition` | 层 3：弧光阶段定义（含触发事件），结构全书不变 |
| **新增** `mutable_info.relationships[].origin/trajectory` | `mutable_info.relationships` | 层 4 增强：关系起点与走向 |

### 步骤 3：protagonist.json 迁移到五层结构的完整示例 JSON

写入 `file:///workspace/NovelForge_Vault/.state/characters/protagonist.json`（以一个修仙主角「林渊」为例，实际迁移时由 architect 按作者意图填充）：

```json
{
  "_comment": "主角五层档案。stable_info 强保护（禁止 save_state.py 自动覆写），mutable_info 由 writer-polisher 每章 Delta 更新。",
  "_comment_stable": "stable_info 含层 1（核心欲望与底层恐惧）/层 2（性格正反面与行为标签）/层 3 定义（弧光阶段）/层 5 基线（语言指纹）/基本信息",
  "_comment_mutable": "mutable_info 含层 3 当前（弧光阶段）/层 4（关系网）/层 5 滚动（近期对话统计）/位置/境界/情绪/知识/目标",
  "_comment_meta": "meta 含首末出场/状态/schema 版本",
  "character_id": "protagonist",
  "stable_info": {
    "basic": {
      "name": "林渊",
      "aliases": ["沈砚", "废材"],
      "role": "protagonist",
      "age": 16,
      "appearance_keywords": ["眉心红痣", "瘦削", "少年老成"],
      "origin": "出身青云宗外门弟子，幼年丧母，被师弟羞辱为废材。金手指为眉心红痣（残破玉简认主后觉醒）。500-1000 字背景详见 02_角色/protagonist.md 第四节。"
    },
    "core_desire_fear": {
      "core_desire": "寻母——查明母亲当年离开的真相，无论真相多残酷都要面对面问一句为什么",
      "deep_fear": "再次被至亲抛弃——任何形式的「被放弃」都会触发他的应激反应",
      "contradictory_belief": "寻母意味着面对她可能主动抛弃自己的真相，而真相本身就是「被放弃」的终极证明"
    },
    "personality": {
      "positive_traits": [
        {"trait": "隐忍", "behavior_example": "被师弟羞辱时不还口，转身把怨气化作修炼动力"},
        {"trait": "果决", "behavior_example": "一旦决定杀人，不留活口，补刀不犹豫"},
        {"trait": "重情", "behavior_example": "为救兄弟敢闯死地，明知是陷阱也去"}
      ],
      "negative_traits": [
        {"trait": "偏执", "behavior_example": "为达目的不惜利用至友，事后才自责"},
        {"trait": "多疑", "behavior_example": "对任何示好都先假设对方有所图，验证三遍才信"}
      ],
      "behavior_tags": [
        "遇到问题时先转笔，停顿三秒再开口",
        "愤怒时左手会摸向剑柄，即使没带剑",
        "说谎时眼神会看向左下方",
        "紧张时呼吸会刻意放慢，反而比平时更深"
      ]
    },
    "arc_definition": {
      "stages": [
        {
          "stage_id": "ignorance",
          "stage_name": "蒙昧",
          "belief": "强者才能活",
          "behavior_pattern": "隐忍、苟、不出头",
          "trigger_event": "师门灭门，被诬陷为叛徒",
          "trigger_ch": null,
          "volume": "vol_01"
        },
        {
          "stage_id": "awakening",
          "stage_name": "觉醒",
          "belief": "我命由我",
          "behavior_pattern": "主动出击，不再隐忍",
          "trigger_event": "金手指红痣觉醒第二阶段，识破师门灭门幕后黑手",
          "trigger_ch": null,
          "volume": "vol_02"
        },
        {
          "stage_id": "struggle",
          "stage_name": "挣扎",
          "belief": "力量是手段也是枷锁",
          "behavior_pattern": "谨慎用强，开始反思复仇的代价",
          "trigger_event": "复仇中误伤无辜，第一次怀疑自己",
          "trigger_ch": null,
          "volume": "vol_03"
        },
        {
          "stage_id": "transcendence",
          "stage_name": "超脱",
          "belief": "寻到真相不是为了惩罚，是为了放下",
          "behavior_pattern": "不再被欲望与恐惧驱动，主动选择",
          "trigger_event": "面对面见到母亲，听到真相后选择原谅",
          "trigger_ch": null,
          "volume": "vol_04+"
        }
      ]
    },
    "language_fingerprint": {
      "avg_sentence_length": 12,
      "preferred_words": ["罢了", "何须", "且看", "不必"],
      "catchphrases": ["且慢", "无妨"],
      "forbidden_words": ["牛逼", "卧槽", "yyds", "绝绝子"],
      "address_habits": {
        "师傅": "师尊",
        "同门": "师兄/师弟",
        "敌人": "阁下",
        "陌生人": "这位"
      },
      "decision_preference": "遇事先观察三息再动，能不动手就不动手"
    }
  },
  "mutable_info": {
    "current_arc_stage": "ignorance",
    "location": {
      "current": "",
      "last_updated_ch": 0,
      "recent_trajectory": []
    },
    "power_level": {
      "realm": "",
      "realm_progress": 0,
      "abilities": [],
      "limitations": [],
      "next_breakthrough": {}
    },
    "inventory": [],
    "emotion": {
      "current": "",
      "last_updated_ch": 0,
      "recent_arc": [],
      "baseline": "压抑隐忍"
    },
    "relationships": [],
    "knowledge": {
      "known_facts": [],
      "unknown_facts": [],
      "misconceptions": []
    },
    "unresolved_personal_arcs": [],
    "goals": {
      "short_term": "",
      "long_term": "寻母",
      "secret_goal": "证明自己不是废材"
    },
    "language_fingerprint_recent": {
      "last_5_ch_avg_sentence_length": 0,
      "last_5_ch_preferred_hit_rate": 0,
      "last_updated_ch": 0
    }
  },
  "meta": {
    "first_appear_ch": 1,
    "last_appeared_ch": 0,
    "status": "active",
    "schema_version": "5layer-v1"
  }
}
```

### 步骤 4：save_state.py 的 stable_info 保护逻辑代码片段

**修改位置**：`file:///workspace/scripts/novelforge/save_state.py`

**改动 1**：在文件顶部常量区（line 64-76 附近）新增 `STABLE_INFO_FIELDS` 常量与守卫函数。注意：为避免循环依赖，`STABLE_INFO_FIELDS` 在 `schema.py` 定义后 import，但也允许在 `save_state.py` 内部硬编码副本作为防御性兜底。

```python
# 复用同包 schema 的 stable_info 字段集合
try:
    from .schema import STABLE_INFO_FIELDS as _SCHEMA_STABLE_FIELDS
except ImportError:
    from scripts.novelforge.schema import STABLE_INFO_FIELDS as _SCHEMA_STABLE_FIELDS  # type: ignore

# save_state 内部硬编码副本（防御性兜底：若 schema.py 未升级，守卫仍生效）
_STABLE_INFO_FIELDS_LOCAL: frozenset[str] = frozenset({
    "basic", "core_desire_fear", "personality", "arc_definition", "language_fingerprint",
})

# 实际使用的字段集合（schema 优先，本地兜底）
STABLE_INFO_FIELDS: frozenset[str] = _SCHEMA_STABLE_FIELDS or _STABLE_INFO_FIELDS_LOCAL


def _check_stable_info_protection(sub_path: list[str], op_name: str, character_id: str) -> None:
    """拒绝任何对 stable_info 字段的写操作（除 architect 显式迁移通道）。

    Args:
        sub_path: delta path 在 character 文件内的剩余路径片段。
            如 `["mutable_info", "location", "current"]` 或 `["stable_info", "core_desire_fear"]`。
        op_name: op 类型（set/append/remove/merge）。
        character_id: 角色 ID，用于错误信息。

    Raises:
        ValueError: 当 sub_path[0] in STABLE_INFO_FIELDS 且非 architect 迁移通道时。
    """
    if not sub_path:
        return
    top = sub_path[0]
    if top in STABLE_INFO_FIELDS:
        raise ValueError(
            f"角色 [{character_id}] 的 stable_info 字段 '{top}' 受保护，"
            f"禁止通过 save_state.py 的 {op_name} op 修改。"
            f"stable_info 含核心欲望/底层恐惧/性格/弧光定义/语言指纹基线，"
            f"全书不变除非核心转变事件。"
            f"如需变更（如弧光推进、性格转变），请由 architect Skill 生成迁移脚本，"
            f"经作者确认后走专用迁移通道（见 architect SKILL.md §角色档案迁移）。"
        )
```

**改动 2**：在 `_apply_op` 函数（line 544-624）的 character 分支前置 stable_info 守卫。修改 line 596-603：

```python
    # 按类型分派
    if target.kind == "character":
        # === stable_info 守卫（前置，在 op 应用前拦截）===
        _check_stable_info_protection(target.sub_path, op["op"], target.name or "")
        # === 原 _apply_op_to_dict 调用 ===
        _apply_op_to_dict(state, op, target.sub_path)
        errors = validate_character_state(state)
        if errors:
            raise ValueError(
                f"角色 state 校验失败 [{target.name}]: {'; '.join(errors)}"
            )
```

**改动 3**：`EMPTY_CHARACTER_TEMPLATE`（line 81-132）同步五层结构。完整新模板：

```python
EMPTY_CHARACTER_TEMPLATE: dict[str, Any] = {
    "character_id": "",
    "stable_info": {
        "basic": {
            "name": "",
            "aliases": [],
            "role": "protagonist",
            "age": None,
            "appearance_keywords": [],
            "origin": "",
        },
        "core_desire_fear": {
            "core_desire": "",
            "deep_fear": "",
            "contradictory_belief": "",
        },
        "personality": {
            "positive_traits": [],
            "negative_traits": [],
            "behavior_tags": [],
        },
        "arc_definition": {
            "stages": [
                # 至少 3 个阶段，模板给 4 个占位
                {"stage_id": "stage_1", "stage_name": "", "belief": "", "behavior_pattern": "", "trigger_event": "", "trigger_ch": None, "volume": ""},
                {"stage_id": "stage_2", "stage_name": "", "belief": "", "behavior_pattern": "", "trigger_event": "", "trigger_ch": None, "volume": ""},
                {"stage_id": "stage_3", "stage_name": "", "belief": "", "behavior_pattern": "", "trigger_event": "", "trigger_ch": None, "volume": ""},
            ]
        },
        "language_fingerprint": {
            "avg_sentence_length": 12,
            "preferred_words": [],
            "catchphrases": [],
            "forbidden_words": [],
            "address_habits": {},
            "decision_preference": "",
        },
    },
    "mutable_info": {
        "current_arc_stage": "",
        "location": {"current": "", "last_updated_ch": 0, "recent_trajectory": []},
        "power_level": {"realm": "", "realm_progress": 0, "abilities": [], "limitations": [], "next_breakthrough": {}},
        "inventory": [],
        "emotion": {"current": "", "last_updated_ch": 0, "recent_arc": [], "baseline": ""},
        "relationships": [],
        "knowledge": {"known_facts": [], "unknown_facts": [], "misconceptions": []},
        "unresolved_personal_arcs": [],
        "goals": {"short_term": "", "long_term": "", "secret_goal": ""},
        "language_fingerprint_recent": {"last_5_ch_avg_sentence_length": 0, "last_5_ch_preferred_hit_rate": 0, "last_updated_ch": 0},
    },
    "meta": {
        "first_appear_ch": 1,
        "last_appeared_ch": 0,
        "status": "active",
        "schema_version": "5layer-v1",
    },
}
```

**改动 4**：`schema.py` 的 `validate_character_state`（line 308-322）扩展五层校验：

```python
def validate_character_state(data: dict) -> list[str]:
    """校验角色状态 JSON，返回错误列表（空列表=通过）。"""
    errors: list[str] = []
    # 顶层必填
    for field in ("character_id", "stable_info", "mutable_info", "meta"):
        if field not in data:
            errors.append(f"缺少必填字段: {field}")
    if errors:
        return errors  # 缺顶层字段，后续校验无意义

    # stable_info 必填子字段
    stable = data.get("stable_info") or {}
    for f in ("basic", "core_desire_fear", "personality", "arc_definition", "language_fingerprint"):
        if f not in stable:
            errors.append(f"stable_info 缺少必填字段: {f}")

    # 层 1：core_desire_fear 必填
    cdf = stable.get("core_desire_fear") or {}
    for f in ("core_desire", "deep_fear"):
        if not cdf.get(f):
            errors.append(f"stable_info.core_desire_fear.{f} 为空（层 1 核心欲望与底层恐惧必填）")

    # 层 2：personality 正反面至少各 1 个
    personality = stable.get("personality") or {}
    if not personality.get("positive_traits"):
        errors.append("stable_info.personality.positive_traits 为空（层 2 性格正面至少 1 个）")
    if not personality.get("negative_traits"):
        errors.append("stable_info.personality.negative_traits 为空（层 2 性格反面至少 1 个）")

    # 层 3：arc_definition.stages 至少 3 个
    stages = (stable.get("arc_definition") or {}).get("stages") or []
    if len(stages) < 3:
        errors.append(f"stable_info.arc_definition.stages 不足 3 个（层 3 弧光至少 3 个转变节点），实际 {len(stages)}")

    # 层 5：language_fingerprint.avg_sentence_length 必填
    lf = stable.get("language_fingerprint") or {}
    if not lf.get("avg_sentence_length"):
        errors.append("stable_info.language_fingerprint.avg_sentence_length 为空（层 5 基线必填）")

    # mutable_info 必填子字段
    mutable = data.get("mutable_info") or {}
    if "location" not in mutable:
        errors.append("mutable_info 缺少必填字段: location")
    elif not (mutable.get("location") or {}).get("current") and (mutable.get("location") or {}).get("current") != "":
        errors.append("mutable_info.location 缺少 current 字段")

    # meta
    meta = data.get("meta") or {}
    if meta.get("status") not in ("active", "dead", "missing", "unknown", "archived"):
        errors.append(f"meta.status 非法: {meta.get('status')}")

    return errors
```

**向后兼容说明**：旧扁平 schema 的 `validate_character_state` 调用会因缺少 `stable_info/mutable_info/meta` 而报错——这是预期行为，强制迁移。`architect` Skill 的迁移脚本（步骤 6）会负责把旧文件升级。

### 步骤 5：check_consistency.py 新增 `character_language_fingerprint_drift` 检测

**修改位置**：`file:///workspace/scripts/novelforge/check_consistency.py`

**改动 1**：`ALL_DIMENSIONS`（line 182-190）与 `DIM_LABELS`（line 193-201）新增第 8 项：

```python
ALL_DIMENSIONS: list[str] = [
    "power_level_jump",
    "phantom_item",
    "relationship_mutation",
    "location_jump",
    "foreshadow_forgetting",
    "character_revival",
    "golden_finger_overreach",
    "character_language_fingerprint_drift",  # 新增第 8 类
]

DIM_LABELS: dict[str, str] = {
    "power_level_jump": "境界跳级",
    "phantom_item": "物品凭空",
    "relationship_mutation": "关系突变",
    "location_jump": "位置穿越",
    "foreshadow_forgetting": "伏笔遗忘",
    "character_revival": "角色复生",
    "golden_finger_overreach": "金手指越界",
    "character_language_fingerprint_drift": "语言指纹漂移",  # 新增
}
```

**改动 2**：`DIM_ALIASES`（line 163-179）新增短名映射：

```python
DIM_ALIASES: dict[str, str] = {
    # ... 原有 7 项 ...
    "fingerprint": "character_language_fingerprint_drift",
    "fingerprint_drift": "character_language_fingerprint_drift",
    "character_language_fingerprint_drift": "character_language_fingerprint_drift",
}
```

**改动 3**：新增 `check_character_language_fingerprint_drift` 函数（放在维度 7 之后，编排区之前）：

```python
# ============================================================================
# 维度 8：语言指纹漂移（P1）—— 跨章慢性漂移检测
# ============================================================================
# 漂移检测窗口：最近 N 章的对话统计滚动值与 stable_info.language_fingerprint 基线对比
FINGERPRINT_DRIFT_WINDOW: int = 5  # 最近 5 章
FINGERPRINT_DRIFT_DEVIATION: float = 0.30  # 偏离基线 30%
FINGERPRINT_DRIFT_CONSECUTIVE: int = 3  # 连续 3 章偏离才告警（避免单章误报）

# 指纹快照目录（相对 Vault 根）
FINGERPRINT_SNAPSHOT_DIR_REL: str = "scripts/novelforge/data/character_fingerprints"


def check_character_language_fingerprint_drift(
    body: str,
    states: dict[str, dict[str, Any]],
    hooks: list[dict[str, Any]],
    current_ch: int,
    vault: str = DEFAULT_VAULT,
) -> tuple[list[Issue], str | None]:
    """检测角色语言指纹跨章漂移（慢性漂移，P1）。

    与 check_ai_novel.py 的 check_dialogue_identity（单章急性偏离）互补：
    - check_dialogue_identity：本章对话 vs 指纹基线，单章偏离 >30% → P1
    - 本检测：最近 N 章滚动均值 vs 指纹基线，连续 3 章偏离 >30% → P1

    规则：
    1. 取主角 stable_info.language_fingerprint 作为基线。
    2. 加载最近 N 章的对话统计快照（从 data/character_fingerprints/ 读取）。
    3. 计算滚动均值（avg_sentence_length / preferred_words 命中率）。
    4. 若滚动均值偏离基线 >30% 且连续 3 章以上 → P1 漂移告警。
    5. 同时写入本章快照到 data/character_fingerprints/，供下次检测用。
    6. 更新 mutable_info.language_fingerprint_recent（由调用方 save_state 落盘）。

    跳过条件：
    - 主角无 stable_info.language_fingerprint → 跳过（旧 schema 兼容）。
    - 历史快照不足 3 章 → 跳过（数据不足以判断趋势）。
    - 当前章无对话 → 跳过（不写入快照）。
    """
    protagonist = _find_protagonist(states)
    if protagonist is None:
        return [], "未找到主角状态文件，跳过语言指纹漂移检测"

    # 兼容新旧 schema：优先取 stable_info.language_fingerprint
    stable = protagonist.get("stable_info") or {}
    baseline_fp = stable.get("language_fingerprint")
    if not baseline_fp:
        # 旧 schema 兼容：取顶层 language_fingerprint
        baseline_fp = protagonist.get("language_fingerprint")
    if not baseline_fp or not isinstance(baseline_fp, dict):
        return [], "主角无 language_fingerprint 基线（旧 schema 或模板），跳过漂移检测"

    baseline_avg_len = baseline_fp.get("avg_sentence_length")
    if not isinstance(baseline_avg_len, int) or baseline_avg_len <= 0:
        return [], "主角 language_fingerprint.avg_sentence_length 无效，跳过漂移检测"

    baseline_preferred = baseline_fp.get("preferred_words") or []

    # 提取本章对话
    dialogues = _extract_dialogues_from_body(body)
    if not dialogues:
        return [], None  # 本章无对话，不告警也不写快照

    # 计算本章对话统计
    ch_avg_len = _compute_avg_sentence_length(dialogues)
    ch_preferred_hit = _compute_preferred_hit_rate(dialogues, baseline_preferred)

    # 写入本章快照（供未来章节检测用）
    _write_fingerprint_snapshot(vault, protagonist.get("character_id", "protagonist"), current_ch, ch_avg_len, ch_preferred_hit)

    # 加载历史快照
    snapshots = _load_fingerprint_snapshots(vault, protagonist.get("character_id", "protagonist"), current_ch, FINGERPRINT_DRIFT_WINDOW)
    if len(snapshots) < FINGERPRINT_DRIFT_CONSECUTIVE:
        return [], f"历史快照不足 {FINGERPRINT_DRIFT_CONSECUTIVE} 章（实际 {len(snapshots)}），跳过漂移检测"

    # 计算最近 N 章滚动均值
    recent_avg_lens = [s["avg_sentence_length"] for s in snapshots[-FINGERPRINT_DRIFT_WINDOW:]]
    recent_hit_rates = [s["preferred_hit_rate"] for s in snapshots[-FINGERPRINT_DRIFT_WINDOW:]]
    rolling_avg_len = sum(recent_avg_lens) / len(recent_avg_lens)
    rolling_hit_rate = sum(recent_hit_rates) / len(recent_hit_rates)

    # 偏离检测
    avg_len_deviation = abs(rolling_avg_len - baseline_avg_len) / baseline_avg_len
    # preferred_words 命中率偏离：基线期望命中率应 ≥0.5（高频词至少用一半），滚动命中率 <0.2 视为漂移
    hit_rate_drift = rolling_hit_rate < 0.2 and len(baseline_preferred) >= 3

    # 连续 N 章偏离判断
    consecutive_avg_drift = _count_consecutive_deviation(recent_avg_lens, baseline_avg_len, FINGERPRINT_DRIFT_DEVIATION)

    issues: list[Issue] = []
    if avg_len_deviation > FINGERPRINT_DRIFT_DEVIATION and consecutive_avg_drift >= FINGERPRINT_DRIFT_CONSECUTIVE:
        detail = (
            f"主角语言指纹基线 avg_sentence_length: {baseline_avg_len}\n"
            f"   最近 {len(recent_avg_lens)} 章滚动均值: {rolling_avg_len:.1f}\n"
            f"   偏离: {avg_len_deviation*100:.0f}%（阈值 {FINGERPRINT_DRIFT_DEVIATION*100:.0f}%）\n"
            f"   连续偏离章数: {consecutive_avg_drift}（阈值 {FINGERPRINT_DRIFT_CONSECUTIVE}）\n"
            f"   各章句长: {recent_avg_lens}"
        )
        issues.append(Issue(
            severity="P1",
            type="character_language_fingerprint_drift",
            detail=detail,
            suggestion=(
                "主角台词句长连续漂移，可能正在 OOC。检查最近章节是否让主角说了不符合人设的长段台词。"
                "若为弧光推进导致的合理演变（如觉醒期话变多），由 architect 更新 stable_info.language_fingerprint 基线并留痕。"
            ),
            extras={
                "baseline_avg_length": baseline_avg_len,
                "rolling_avg_length": rolling_avg_len,
                "deviation": avg_len_deviation,
                "consecutive_drift_chapters": consecutive_avg_drift,
                "sub_type": "avg_length_drift",
            },
        ))

    if hit_rate_drift:
        detail = (
            f"主角 preferred_words 基线: {baseline_preferred}\n"
            f"   最近 {len(recent_hit_rates)} 章平均命中率: {rolling_hit_rate:.2f}\n"
            f"   命中率 <0.2 视为角色失声（preferred_words 一个都没用）"
        )
        issues.append(Issue(
            severity="P1",
            type="character_language_fingerprint_drift",
            detail=detail,
            suggestion=(
                "主角 preferred_words 连续低命中，台词正在失去语言指纹。"
                "检查最近章节是否让主角用了不属于他的词汇。"
            ),
            extras={
                "baseline_preferred": baseline_preferred,
                "rolling_hit_rate": rolling_hit_rate,
                "sub_type": "preferred_words_lost",
            },
        ))

    return issues, None


def _extract_dialogues_from_body(body: str) -> list[str]:
    """从正文提取所有对话（双引号/直角引号内文本）。复用 check_ai_novel 的正则。"""
    import re as _re
    pattern = _re.compile(r'[\u201c\u300c"]([^\u201d\u300d"]{1,500})[\u201d\u300d"]', _re.UNICODE)
    return [m.group(1) for m in pattern.finditer(body)]


def _compute_avg_sentence_length(dialogues: list[str]) -> float:
    """计算对话平均句长（按句末标点切分后取均值）。"""
    import re as _re
    sentence_re = _re.compile(r'[。！？!?]')
    punct = "，。！？；：""''「」『』（）—…《》、· \t\r\n"
    lens = []
    for d in dialogues:
        for s in sentence_re.split(d):
            s = s.strip()
            if not s:
                continue
            clean = "".join(ch for ch in s if ch not in punct)
            if clean:
                lens.append(len(clean))
    return sum(lens) / len(lens) if lens else 0.0


def _compute_preferred_hit_rate(dialogues: list[str], preferred_words: list[str]) -> float:
    """计算 preferred_words 在对话中的命中率（命中词数 / 总词数）。"""
    if not preferred_words:
        return 1.0  # 无 preferred_words 配置时不报失声
    all_text = "".join(dialogues)
    hit = sum(1 for w in preferred_words if w in all_text)
    return hit / len(preferred_words)


def _write_fingerprint_snapshot(vault: str, character_id: str, ch: int, avg_len: float, hit_rate: float) -> None:
    """写入本章指纹快照到 data/character_fingerprints/<character_id>_ch<NNN>.json。"""
    import json as _json
    import os as _os
    snapshot_dir = _os.path.join(vault, FINGERPRINT_SNAPSHOT_DIR_REL)
    _os.makedirs(snapshot_dir, exist_ok=True)
    snapshot_path = _os.path.join(snapshot_dir, f"{character_id}_ch{ch:03d}.json")
    snapshot = {
        "character_id": character_id,
        "chapter": ch,
        "avg_sentence_length": round(avg_len, 2),
        "preferred_hit_rate": round(hit_rate, 4),
        "timestamp": _os.times().elapsed,
    }
    with open(snapshot_path, "w", encoding="utf-8") as f:
        _json.dump(snapshot, f, ensure_ascii=False, indent=2)


def _load_fingerprint_snapshots(vault: str, character_id: str, current_ch: int, window: int) -> list[dict]:
    """加载最近 window 章的指纹快照（不含当前章）。"""
    import json as _json
    import os as _os
    snapshot_dir = _os.path.join(vault, FINGERPRINT_SNAPSHOT_DIR_REL)
    if not _os.path.isdir(snapshot_dir):
        return []
    snapshots = []
    for ch in range(max(1, current_ch - window), current_ch):
        path = _os.path.join(snapshot_dir, f"{character_id}_ch{ch:03d}.json")
        if _os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    snapshots.append(_json.load(f))
            except (_json.JSONDecodeError, OSError):
                continue
    return snapshots


def _count_consecutive_deviation(values: list[float], baseline: float, threshold: float) -> int:
    """从末尾往前数连续偏离基线 threshold 的个数。"""
    count = 0
    for v in reversed(values):
        if baseline > 0 and abs(v - baseline) / baseline > threshold:
            count += 1
        else:
            break
    return count
```

**改动 4**：`_DIM_CHECKERS_NO_VAULT`（line 1203-1209）注册新函数。因新检测需要 vault 参数加载快照，单独处理：

```python
# 维度 type → 检测函数（无 vault 依赖）
_DIM_CHECKERS_NO_VAULT: dict[str, Any] = {
    "power_level_jump": lambda body, states, hooks, ch: check_power_level_jump(body, states),
    "relationship_mutation": lambda body, states, hooks, ch: check_relationship_mutation(body, states),
    "character_revival": lambda body, states, hooks, ch: check_character_revival(body, states),
    "golden_finger_overreach": lambda body, states, hooks, ch: check_golden_finger_overreach(body, states),
    "foreshadow_forgetting": lambda body, states, hooks, ch: check_foreshadow_forgetting(body, states, hooks, ch),
    # 新增：语言指纹漂移（需 vault 加载快照，单独在 check_all 中处理）
}

# 维度 type → 检测函数（需 vault 依赖）
_DIM_CHECKERS_WITH_VAULT: dict[str, Any] = {
    "character_language_fingerprint_drift": lambda body, states, hooks, ch, vault: check_character_language_fingerprint_drift(body, states, hooks, ch, vault),
}
```

**改动 5**：`check_all`（line 1212-1289）的分派逻辑新增对第 8 维度的处理。在 line 1272-1285 的循环中：

```python
    for dim in target_dims:
        try:
            if dim == "phantom_item":
                issues, skip = check_phantom_item(body, states, vault)
            elif dim == "location_jump":
                issues, skip = check_location_jump(body, states, vault)
            elif dim == "character_language_fingerprint_drift":
                # 新增：语言指纹漂移检测（需 vault）
                issues, skip = check_character_language_fingerprint_drift(body, states, hooks, chapter, vault)
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

**检测逻辑伪代码总结**：

```
输入：本章正文 body，主角状态 states，当前章号 current_ch，vault 路径
输出：(issues[], skip_reason)

1. 取主角 stable_info.language_fingerprint 作为基线 baseline_fp
   - 若无（旧 schema）→ 跳过
2. 提取本章对话 dialogues
   - 若无对话 → 跳过（不告警不写快照）
3. 计算本章统计：
   - ch_avg_len = 对话平均句长
   - ch_preferred_hit = preferred_words 命中率
4. 写入本章快照到 data/character_fingerprints/<id>_ch<NNN>.json
5. 加载最近 N-1 章快照（N=5）
   - 若历史快照 <3 章 → 跳过（数据不足）
6. 计算滚动均值：
   - rolling_avg_len = 最近 N 章句长均值
   - rolling_hit_rate = 最近 N 章命中率均值
7. 偏离检测：
   - avg_len_deviation = |rolling_avg_len - baseline| / baseline
   - consecutive_drift = 从末尾数连续偏离 >30% 的章数
   - if avg_len_deviation > 30% and consecutive_drift >= 3 → P1 句长漂移
   - if rolling_hit_rate < 0.2 and preferred_words >= 3 → P1 角色失声
8. 返回 issues
```

### 步骤 6：architect SKILL.md 中五层生成模板

**修改位置**：`file:///workspace/.trae/skills/architect/SKILL.md`

**改动 1**：在「第二步：生成流水线」（line 55-75）的生成链中，在「世界观」与「故事主线」之间新增「角色档案」层级：

```markdown
核心脑洞（author_intent.md L0 摘要）
    ↓
世界观（01_世界观/）
  ├─ core_rules.md / geography.md / factions.md / items_and_concepts.md
    ↓
角色档案（02_角色/<name>.md + .state/characters/<name>.json）  ← 新增层级
  ├─ 五层档案：核心欲望与底层恐惧 / 性格正反面与行为标签 / 成长弧光与转变节点 / 人物关系网 / 语言指纹
  ├─ 02_角色/<name>.md：人类可读设定书（十段模板，对齐五层）
  └─ .state/characters/<name>.json：机器可读状态机（stable_info + mutable_info + meta）
    ↓
故事主线 story_arc.md（核心冲突脉络 + 主角弧光 + 卷划分）
    ↓
总大纲 master_outline.md
    ↓
卷大纲 vol_NN/vol_outline.md
    ↓
章纲 vol_NN/ch_NNN_outline.md
```

**改动 2**：在「第五步：按模板生成内容」新增 §5.5 角色档案五层生成模板：

```markdown
### 5.5 角色档案五层生成模板（02_角色/<name>.md + .state/characters/<name>.json）

生成新角色时必须按五层产出，缺层不可 Write。两个文件同步生成：
- `02_角色/<name>.md`：人类可读设定书（作者查阅）
- `.state/characters/<name>.json`：机器可读状态机（脚本读写）

#### 五层字段清单（两文件对齐）

| 层 | 字段 | .md 段落 | .json 路径 | 稳定/动态 |
|---|---|---|---|---|
| 1 | 核心欲望 | 五、动机·核心欲望 | stable_info.core_desire_fear.core_desire | 强稳定 |
| 1 | 底层恐惧 | 五、动机·底层恐惧 | stable_info.core_desire_fear.deep_fear | 强稳定 |
| 1 | 矛盾信念 | 五、动机·矛盾信念 | stable_info.core_desire_fear.contradictory_belief | 强稳定 |
| 2 | 性格正面 | 三、性格·正面 | stable_info.personality.positive_traits[] | 强稳定 |
| 2 | 性格反面 | 三、性格·反面 | stable_info.personality.negative_traits[] | 强稳定 |
| 2 | 行为标签 | 三、性格·行为标签 | stable_info.personality.behavior_tags[] | 强稳定 |
| 3 | 弧光阶段定义 | 六、弧光阶段 | stable_info.arc_definition.stages[] | 半稳定 |
| 3 | 当前弧光阶段 | 六、弧光阶段（标注当前） | mutable_info.current_arc_stage | 动态 |
| 4 | 关系网 | 八、关系网 | mutable_info.relationships[] | 动态 |
| 5 | 语言指纹基线 | 七、语言指纹 | stable_info.language_fingerprint | 强稳定 |
| 5 | 近期对话统计 | （不写入 .md） | mutable_info.language_fingerprint_recent | 动态 |

#### 生成约束

1. **层 1 必填**：core_desire 与 deep_fear 不可为空，是角色的燃料与刹车。
2. **层 2 至少各 1 个**：positive_traits 与 negative_traits 各至少 1 个，每个含 trait + behavior_example。behavior_tags 至少 2 个具体可观察的小动作。
3. **层 3 至少 3 个阶段**：每个 stage 含 stage_id / stage_name / belief / trigger_event。trigger_ch 初始为 null，由 writer-polisher 在触发时经 architect 迁移填写。
4. **层 5 avg_sentence_length 必填**：根据角色设定给出合理值（少年主角 8-15，长老 15-25，话痨 18-30）。
5. **禁止自动覆写 stable_info**：生成后，stable_info 全书不变除非「核心转变事件」。stable_info 的修改必须经作者确认，走 §角色档案迁移 通道。

#### 角色档案迁移通道（核心转变事件时）

当剧情推进到 stable_info.arc_definition.stages[].trigger_event 触发时，按以下流程迁移：

1. architect 识别到本章正文出现 trigger_event 描述的场景。
2. architect 生成迁移 Delta（仅含 stable_info 字段，如更新 current_arc_stage、填写 trigger_ch、可能调整 personality）。
3. **迁移 Delta 不走 save_state.py 常规通道**（会被 stable_info 守卫拒绝），而是由 architect 直接编辑 .state/characters/<name>.json 并在 commit message 标注 `architect-migration: <character_id> stable_info 更新（trigger: <event>）`。
4. 迁移必须在 commit message 留痕，并在 02_角色/<name>.md 的「十、修订历史」追加一行。
5. 迁移后跑 `python -m scripts.novelforge.check_consistency --chapter <N>` 确认无新 P0。
```

**改动 3**：在「禁止事项」（line 237-242）新增一条：

```markdown
- **禁止自动覆写 stable_info**：stable_info（核心欲望/底层恐惧/性格/弧光定义/语言指纹基线）全书不变除非核心转变事件。save_state.py 已加守卫拒绝任何 stable_info 写入；architect 迁移 stable_info 必须经作者确认并在 commit message 标注 `architect-migration`。
```

### 步骤 7：writer-polisher SKILL.md 中 mutable_only 更新规则

**修改位置**：`file:///workspace/.trae/skills/writer-polisher/SKILL.md`

**改动 1**：阶段四「状态更新」第 2 步「构造 Delta JSON」（line 190-213）的示例改为 `mutable_info/...` 路径，并新增 mutable_only 约束说明：

```markdown
### 第 2 步：构造 Delta JSON（mutable_info only）

**铁律：Delta 只能命中 `mutable_info/...` 路径，禁止触碰 `stable_info/...`。**

save_state.py 已加 stable_info 守卫，任何对 `stable_info/...` 的 set/merge/remove op 会被直接拒绝并 raise ValueError。若 Delta 中含 stable_info 写入，save_state 会失败，本章草稿保留在 drafts/ 不落盘。

正确的 Delta 示例（路径全部以 `mutable_info/` 开头）：

```json
{
  "chapter": "ch_042",
  "mode": "novel",
  "ops": [
    {"op": "set", "path": "characters/protagonist/mutable_info/location/current", "value": "青云宗藏经阁"},
    {"op": "merge", "path": "characters/protagonist/mutable_info/emotion", "value": {"current": "警惕", "last_updated_ch": 42}},
    {"op": "set", "path": "characters/protagonist/mutable_info/current_arc_stage", "value": "awakening"},
    {"op": "set", "path": "hooks/H-017/status", "value": "hinted"}
  ],
  "hooks_planted": ["H-018"],
  "hooks_resolved": ["H-009"],
  "world_events": [{"time": "建元三年秋", "event": "主角入藏经阁"}]
}
```

**禁止的 Delta 示例**（会被 save_state 拒绝）：

```json
{
  "chapter": "ch_042",
  "ops": [
    {"op": "set", "path": "characters/protagonist/stable_info/core_desire_fear/core_desire", "value": "复仇"}
  ]
}
```

↑ 这会触发 `ValueError: 角色 [protagonist] 的 stable_info 字段 'core_desire_fear' 受保护`。

**弧光推进的正确做法**：当本章正文触发 stable_info.arc_definition.stages[].trigger_event 时，不要在 Delta 中写 stable_info，而是：
1. 在章末摘要 `.state/ch_NNN_summary.md` 中标注「触发 <stage_id> 转变事件」。
2. 反馈中提示作者：「本章触发弧光转变，建议调用 architect Skill 走迁移通道更新 stable_info（current_arc_stage / trigger_ch）」。
3. architect 迁移后，下章 writer-polisher 读取新的 current_arc_stage 生成符合新阶段的台词与行为。
```

**改动 2**：错误处理表（line 302-312）新增 stable_info 写入拒绝的处置：

```markdown
| 场景 | 处置 |
|---|---|
| save_state 报错 `stable_info 字段受保护` | Delta 中误含 stable_info 路径。检查 Delta，把所有 `stable_info/...` 路径移除；若确需更新 stable_info（弧光推进），提示作者调用 architect 走迁移通道，不在本 Skill 内强行写入 |
```

**改动 3**：阶段四第 1 步「提取本章状态变更」（line 182-189）新增弧光转变识别：

```markdown
### 第 1 步：提取本章状态变更

从本章正文提取：
- 角色位置变更（谁从哪到哪）→ mutable_info.location
- 角色情绪/状态变更 → mutable_info.emotion
- 伏笔新增（planted）/ 提醒（hinted）/ 回收（resolved）→ hooks_registry
- 世界事件（time + event）→ world_timeline
- **弧光转变事件识别**（新增）：若本章正文出现 stable_info.arc_definition.stages[].trigger_event 描述的场景，在章末摘要中标注「触发 <stage_id> 转变事件」，并反馈提示作者调用 architect 走迁移通道。**禁止在本 Delta 中直接写 stable_info.current_arc_stage**——current_arc_stage 在 mutable_info，但更新它需要 architect 确认转变事件已触发，writer-polisher 不单方面推进弧光。
```

---

## 六、验证方式

### 6.1 单元测试

**命令**：

```bash
pytest -q tests/test_character_five_layer.py
```

**期望输出**：6 个用例全部 PASSED。

### 6.2 集成测试 1：新增检测生效

**命令**：

```bash
# 检测第 42 章，包含第 8 类语言指纹漂移检测
python -m scripts.novelforge.check_consistency --chapter 42 --json

# 只检测语言指纹漂移维度
python -m scripts.novelforge.check_consistency --chapter 42 --dim fingerprint --json
```

**期望输出**：JSON 报告中 `dimensions_checked: 8`，`character_language_fingerprint_drift` 出现在 `passed` 或 `issues[]` 中（取决于是否有漂移）。

### 6.3 集成测试 2：stable_info 写入被拒绝

**命令**：

```bash
# 故意尝试写 stable_info，验证 save_state.py 拒绝
python -m scripts.novelforge.save_state --json '{
  "chapter": "ch_042",
  "ops": [
    {"op": "set", "path": "characters/protagonist/stable_info/core_desire_fear/core_desire", "value": "复仇"}
  ]
}' --no-commit
```

**期望输出**：退出码 1，stderr 含 `stable_info 字段 'core_desire_fear' 受保护`。

### 6.4 集成测试 3：mutable_info Delta 正常

**命令**：

```bash
# 写 mutable_info，验证正常通过
python -m scripts.novelforge.save_state --json '{
  "chapter": "ch_042",
  "ops": [
    {"op": "set", "path": "characters/protagonist/mutable_info/location/current", "value": "青云宗藏经阁"}
  ]
}' --no-commit
```

**期望输出**：退出码 0，stdout 含 `[OK] ch_042 状态已更新`。

### 6.5 断言清单

完成本模块后，以下断言必须全部成立：

| # | 断言 | 验证方式 |
|---|---|---|
| 1 | schema 五层完整 | `test_character_five_layer.py::test_character_schema_has_five_layers` 通过 |
| 2 | stable_info 不可写 | `test_character_five_layer.py::test_stable_info_protected_from_delta` 通过 |
| 3 | mutable_info Delta 正常 | `test_character_five_layer.py::test_mutable_info_delta_applies` 通过 |
| 4 | 语言指纹漂移检测可触发 | `test_character_five_layer.py::test_language_fingerprint_drift_detection` 通过 |
| 5 | architect 生成五层角色 | `test_character_five_layer.py::test_architect_generates_five_layer_character` 通过 |
| 6 | protagonist.json 已迁移 | `test_character_five_layer.py::test_protagonist_json_migrated` 通过 |
| 7 | check_consistency 第 8 维度注册 | `python -m scripts.novelforge.check_consistency --chapter 1 --dim fingerprint` 不报"未知维度" |
| 8 | stable_info 守卫拒绝 set op | 集成测试 2 退出码 1 |
| 9 | mutable_info 写入正常 | 集成测试 3 退出码 0 |
| 10 | 现有 7 类检测不回归 | `python -m scripts.novelforge.check_consistency --chapter 1 --json` 仍正常输出 7+1=8 维度 |

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

**文件路径**：`file:///workspace/tests/test_character_five_layer.py`

**用例清单**（6 个）：

```python
"""NovelForge 角色五层档案模型回归测试。

锁定五层结构 / stable_info 保护 / mutable_info Delta / 漂移检测 / architect 生成 / protagonist.json 迁移。
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.novelforge.schema import (
    CHARACTER_STATE_SCHEMA,
    STABLE_INFO_FIELDS,
    validate_character_state,
)
from scripts.novelforge.save_state import apply_delta, EMPTY_CHARACTER_TEMPLATE


def test_character_schema_has_five_layers():
    """断言 1：schema 含 stable_info / mutable_info / meta 三段，五层字段齐全。"""
    props = CHARACTER_STATE_SCHEMA["properties"]
    # 三段顶层
    assert "stable_info" in props, "schema 缺 stable_info 段"
    assert "mutable_info" in props, "schema 缺 mutable_info 段"
    assert "meta" in props, "schema 缺 meta 段"
    # 层 1：核心欲望与底层恐惧
    stable = props["stable_info"]["properties"]
    assert "core_desire_fear" in stable, "stable_info 缺层 1 core_desire_fear"
    cdf_props = stable["core_desire_fear"]["properties"]
    assert "core_desire" in cdf_props, "层 1 缺 core_desire"
    assert "deep_fear" in cdf_props, "层 1 缺 deep_fear"
    # 层 2：性格正反面与行为标签
    assert "personality" in stable, "stable_info 缺层 2 personality"
    pers_props = stable["personality"]["properties"]
    assert "positive_traits" in pers_props, "层 2 缺 positive_traits"
    assert "negative_traits" in pers_props, "层 2 缺 negative_traits"
    assert "behavior_tags" in pers_props, "层 2 缺 behavior_tags"
    # 层 3：弧光定义（至少 3 阶段）
    assert "arc_definition" in stable, "stable_info 缺层 3 arc_definition"
    stages = stable["arc_definition"]["properties"]["stages"]
    assert stages.get("minItems") == 3, "层 3 stages minItems 应为 3"
    # 层 5：语言指纹基线
    assert "language_fingerprint" in stable, "stable_info 缺层 5 language_fingerprint"
    # mutable_info 含层 3 当前 + 层 4 关系 + 层 5 滚动
    mutable = props["mutable_info"]["properties"]
    assert "current_arc_stage" in mutable, "mutable_info 缺层 3 当前 current_arc_stage"
    assert "relationships" in mutable, "mutable_info 缺层 4 relationships"
    assert "language_fingerprint_recent" in mutable, "mutable_info 缺层 5 滚动 language_fingerprint_recent"
    # STABLE_INFO_FIELDS 常量
    assert "core_desire_fear" in STABLE_INFO_FIELDS
    assert "personality" in STABLE_INFO_FIELDS
    assert "arc_definition" in STABLE_INFO_FIELDS
    assert "language_fingerprint" in STABLE_INFO_FIELDS


def test_stable_info_protected_from_delta():
    """断言 2：save_state.py 拒绝任何对 stable_info 字段的写操作。"""
    # 用临时 vault 避免污染真实状态
    with tempfile.TemporaryDirectory() as tmp_vault:
        # 初始化一个五层 protagonist.json
        chars_dir = os.path.join(tmp_vault, ".state", "characters")
        os.makedirs(chars_dir, exist_ok=True)
        protag = json.loads(json.dumps(EMPTY_CHARACTER_TEMPLATE))
        protag["character_id"] = "protagonist"
        protag["stable_info"]["basic"]["name"] = "测试主角"
        protag["stable_info"]["core_desire_fear"]["core_desire"] = "寻母"
        protag["stable_info"]["core_desire_fear"]["deep_fear"] = "被抛弃"
        protag["stable_info"]["personality"]["positive_traits"] = [
            {"trait": "隐忍", "behavior_example": "不还口"}
        ]
        protag["stable_info"]["personality"]["negative_traits"] = [
            {"trait": "偏执", "behavior_example": "利用至友"}
        ]
        protag["mutable_info"]["location"]["current"] = "青云宗"
        with open(os.path.join(chars_dir, "protagonist.json"), "w", encoding="utf-8") as f:
            json.dump(protag, f, ensure_ascii=False, indent=2)

        # 尝试写 stable_info.core_desire_fear.core_desire —— 应被拒绝
        delta = {
            "chapter": "ch_001",
            "ops": [
                {"op": "set", "path": "characters/protagonist/stable_info/core_desire_fear/core_desire", "value": "复仇"}
            ]
        }
        try:
            apply_delta(delta, vault=tmp_vault, no_commit=True)
            assert False, "save_state 应拒绝 stable_info 写入，但未拒绝"
        except ValueError as e:
            assert "stable_info" in str(e), f"错误信息未提及 stable_info: {e}"
            assert "core_desire_fear" in str(e), f"错误信息未提及受保护字段: {e}"

        # 尝试 merge stable_info.personality —— 应被拒绝
        delta2 = {
            "chapter": "ch_001",
            "ops": [
                {"op": "merge", "path": "characters/protagonist/stable_info/personality", "value": {"behavior_tags": ["新标签"]}}
            ]
        }
        try:
            apply_delta(delta2, vault=tmp_vault, no_commit=True)
            assert False, "save_state 应拒绝 stable_info merge，但未拒绝"
        except ValueError as e:
            assert "personality" in str(e)


def test_mutable_info_delta_applies():
    """断言 3：mutable_info 字段的 Delta 正常应用。"""
    with tempfile.TemporaryDirectory() as tmp_vault:
        chars_dir = os.path.join(tmp_vault, ".state", "characters")
        os.makedirs(chars_dir, exist_ok=True)
        protag = json.loads(json.dumps(EMPTY_CHARACTER_TEMPLATE))
        protag["character_id"] = "protagonist"
        protag["stable_info"]["basic"]["name"] = "测试主角"
        protag["stable_info"]["core_desire_fear"]["core_desire"] = "寻母"
        protag["stable_info"]["core_desire_fear"]["deep_fear"] = "被抛弃"
        protag["stable_info"]["personality"]["positive_traits"] = [
            {"trait": "隐忍", "behavior_example": "不还口"}
        ]
        protag["stable_info"]["personality"]["negative_traits"] = [
            {"trait": "偏执", "behavior_example": "利用至友"}
        ]
        protag["mutable_info"]["location"]["current"] = "青云宗"
        with open(os.path.join(chars_dir, "protagonist.json"), "w", encoding="utf-8") as f:
            json.dump(protag, f, ensure_ascii=False, indent=2)

        # 写 mutable_info.location.current —— 应成功
        delta = {
            "chapter": "ch_042",
            "ops": [
                {"op": "set", "path": "characters/protagonist/mutable_info/location/current", "value": "藏经阁"}
            ]
        }
        result = apply_delta(delta, vault=tmp_vault, no_commit=True)
        assert result["ok"], f"mutable_info Delta 应成功，但失败: {result}"

        # 验证落盘
        with open(os.path.join(chars_dir, "protagonist.json"), "r", encoding="utf-8") as f:
            updated = json.load(f)
        assert updated["mutable_info"]["location"]["current"] == "藏经阁"
        # stable_info 不变
        assert updated["stable_info"]["core_desire_fear"]["core_desire"] == "寻母"


def test_language_fingerprint_drift_detection():
    """断言 4：check_consistency.py 的语言指纹漂移检测可触发。"""
    from scripts.novelforge.check_consistency import (
        check_character_language_fingerprint_drift,
        _write_fingerprint_snapshot,
        _compute_avg_sentence_length,
    )

    # 构造主角状态（五层 schema）
    states = {
        "protagonist": {
            "character_id": "protagonist",
            "stable_info": {
                "language_fingerprint": {
                    "avg_sentence_length": 12,
                    "preferred_words": ["罢了", "何须", "且看"],
                }
            },
        }
    }

    with tempfile.TemporaryDirectory() as tmp_vault:
        # 写 4 章历史快照（句长均偏离基线 12 → 28，偏离 >30%）
        for ch in range(38, 42):
            _write_fingerprint_snapshot(tmp_vault, "protagonist", ch, avg_len=28.0, hit_rate=0.1)

        # 本章正文（含对话，句长也偏离）
        body = '"哈哈哈哈哈哈哈哈哈哈哈哈，今日我便让你知道什么叫做天外有天，你这等废材也配在此处喋喋不休，简直是不自量力至极。"'

        issues, skip = check_character_language_fingerprint_drift(
            body, states, hooks=[], current_ch=42, vault=tmp_vault
        )
        # 应检测到漂移（4 章历史 + 本章 = 5 章滚动，连续偏离 >=3）
        assert skip is None, f"不应跳过: {skip}"
        assert len(issues) > 0, "应检测到语言指纹漂移"
        assert issues[0].type == "character_language_fingerprint_drift"
        assert issues[0].severity == "P1"


def test_architect_generates_five_layer_character():
    """断言 5：architect SKILL.md 含五层生成模板与迁移通道说明。"""
    skill_path = REPO_ROOT / ".trae/skills/architect/SKILL.md"
    content = skill_path.read_text(encoding="utf-8")
    # 含五层生成模板
    assert "五层" in content, "architect SKILL.md 缺五层生成模板"
    assert "core_desire_fear" in content or "核心欲望与底层恐惧" in content, "缺层 1 字段说明"
    assert "behavior_tags" in content or "行为标签" in content, "缺层 2 字段说明"
    assert "arc_definition" in content or "弧光阶段" in content, "缺层 3 字段说明"
    # 含迁移通道
    assert "迁移通道" in content or "architect-migration" in content, "缺迁移通道说明"
    # 禁止事项含 stable_info 保护
    assert "stable_info" in content, "禁止事项未提 stable_info 保护"


def test_protagonist_json_migrated():
    """断言 6：protagonist.json 已迁移到五层结构。"""
    protag_path = REPO_ROOT / "NovelForge_Vault/.state/characters/protagonist.json"
    assert protag_path.exists(), f"protagonist.json 不存在: {protag_path}"
    with open(protag_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # 三段顶层
    assert "stable_info" in data, "protagonist.json 未迁移：缺 stable_info"
    assert "mutable_info" in data, "protagonist.json 未迁移：缺 mutable_info"
    assert "meta" in data, "protagonist.json 未迁移：缺 meta"
    # 层 1 必填
    cdf = data["stable_info"].get("core_desire_fear", {})
    assert cdf.get("core_desire"), "层 1 core_desire 为空"
    assert cdf.get("deep_fear"), "层 1 deep_fear 为空"
    # 层 2 至少各 1 个
    personality = data["stable_info"].get("personality", {})
    assert len(personality.get("positive_traits", [])) >= 1, "层 2 positive_traits 为空"
    assert len(personality.get("negative_traits", [])) >= 1, "层 2 negative_traits 为空"
    # 层 3 至少 3 阶段
    stages = data["stable_info"].get("arc_definition", {}).get("stages", [])
    assert len(stages) >= 3, f"层 3 stages 不足 3 个，实际 {len(stages)}"
    # 层 5 基线
    lf = data["stable_info"].get("language_fingerprint", {})
    assert lf.get("avg_sentence_length"), "层 5 avg_sentence_length 为空"
    # schema_version
    assert data["meta"].get("schema_version") == "5layer-v1", "meta.schema_version 未标 5layer-v1"
    # validate_character_state 通过
    errors = validate_character_state(data)
    assert not errors, f"protagonist.json 五层校验失败: {errors}"
```

### 7.2 在 `bug_regression_list.md` 新增 BUG-055

按 `.trae/rules/bug-reporting.md` 模板，在文件末尾追加：

```markdown
## 角色档案缺失核心欲望与底层恐惧层导致人设漂移

- **编号**：BUG-055
- **首次出现**：2026-07-18
- **类型**：一致性 / 状态漂移
- **现象**：NovelForge 长篇生成中，写到 50 万字后主角人设崩塌——高冷变话痨、腹黑变圣母、隐忍变暴躁。check_consistency.py 的 7 类检测无法发现此类慢性漂移，因为角色状态机只有扁平的 emotion.baseline 与 arc_stage 字段，缺少「核心欲望（燃料）」与「底层恐惧（刹车）」层，LLM 在远距离上下文注意力衰减后失去性格锚点。
- **根因**：
  1. schema 层：CHARACTER_STATE_SCHEMA 是扁平 11 字段，无 stable/mutable 拆分，save_state.py 对任何字段开放写入，LLM 可在生成 Delta 时悄悄覆写性格锚点。
  2. 内容层：缺少核心欲望与底层恐惧字段，AI 写到 50 万字后没有「为什么这个角色会这样做」的内驱力约束，按近期上下文推断性格导致反转。
  3. 检测层：check_ai_novel.py 的 check_dialogue_identity 只做单章检测（偏离 >30% 报 P1），无跨章漂移检测，连续 N 章渐变漂移无人盯。
- **修复**：
  1. 升级 CHARACTER_STATE_SCHEMA 为五层结构（stable_info + mutable_info + meta），stable_info 含核心欲望与底层恐惧（层 1）/性格正反面与行为标签（层 2）/弧光定义（层 3）/语言指纹基线（层 5）。
  2. save_state.py 新增 _check_stable_info_protection 守卫，拒绝任何对 stable_info 字段的 set/merge/remove op。
  3. check_consistency.py 新增第 8 类检测 character_language_fingerprint_drift，加载最近 5 章对话统计快照，计算滚动均值与基线对比，连续 3 章偏离 >30% 触发 P1。
  4. architect SKILL.md 新增五层生成模板与 stable_info 迁移通道（核心转变事件时经作者确认迁移）。
  5. writer-polisher SKILL.md 约束 Delta 只命中 mutable_info/... 路径，弧光推进经 architect 迁移通道。
- **涉及文件**：
  - `scripts/novelforge/schema.py`（CHARACTER_STATE_SCHEMA 升级 + STABLE_INFO_FIELDS + validate_character_state 扩展）
  - `scripts/novelforge/save_state.py`（_check_stable_info_protection 守卫 + EMPTY_CHARACTER_TEMPLATE 同步）
  - `scripts/novelforge/check_consistency.py`（第 8 类检测 character_language_fingerprint_drift + 快照读写函数）
  - `NovelForge_Vault/.state/characters/protagonist.json`（迁移到五层结构）
  - `.trae/skills/architect/SKILL.md`（五层生成模板 + 迁移通道）
  - `.trae/skills/writer-polisher/SKILL.md`（mutable_only 更新规则）
  - `.trae/skills/state-consistency-checker/SKILL.md`（8 类检测解读）
  - `NovelForge_Vault/00_控制面/style_guide.md`（附录 B 升级）
  - `NovelForge_Vault/02_角色/protagonist.md`（十段模板对齐五层）
  - `tests/test_character_five_layer.py`（新增，6 个用例）
  - `tests/bug_regression_list.md`（本条目）
- **回归测试**：
  - `pytest -q tests/test_character_five_layer.py`：6 个用例全部通过
  - `python -m scripts.novelforge.check_consistency --chapter 42 --dim fingerprint --json`：第 8 维度可运行
  - 故意写 stable_info 的 Delta 被 save_state.py 拒绝（退出码 1）
- **教训/沉淀**：
  1. 长篇生成的角色一致性必须靠「强保护锚点 + 漂移检测」双保险，不能依赖 LLM 记忆——Transformer 远距离注意力衰减是物理限制，不是 prompt 工程能解决的。
  2. stable/mutable 拆分是状态机设计的核心模式：stable 全书不变（除非核心转变），mutable 每章可变。save_state 必须在 op 应用前拦截 stable 写入，不能靠后置校验（后置校验时数据已被覆写）。
  3. 单章检测（急性）与跨章检测（慢性）互补：check_ai_novel 管「本章对话是否偏离指纹」，check_consistency 管「连续 N 章是否在漂移」。两者阈值不同（单章 30% / 连续 3 章 30%），不可互相替代。
```

### 7.3 check_consistency.py 新增检测规则

已在步骤 5 详述：新增 `character_language_fingerprint_drift` 检测，注册到 `ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` / `check_all` 分派逻辑。

### 7.4 不新增独立校验脚本

本模块的检测维度（语言指纹漂移）与 check_consistency.py 现有 7 类检测同源（都对比正文与状态机），塞进 check_consistency.py 而非新建脚本，符合「不过度工程化」原则。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**高**。

修改 `schema.py` / `save_state.py` / `protagonist.json` / `check_consistency.py` 均属 NovelForge 核心资产改动，且 `protagonist.json` 需数据迁移，schema 变更影响所有读取角色状态的脚本（`build_context.py` / `check_ai_novel.py` / `audit_hooks.py` 等）。

### 8.2 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|
| schema 变更导致 build_context.py 读取失败 | 高（上下文组装断裂） | 中 | build_context.py 当前读 `protagonist.get("basic")` / `.get("language_fingerprint")` 等扁平路径，需同步改为 `protagonist["stable_info"]["basic"]` 等。本模块在步骤 4 的 schema 升级中已提供旧/新 schema 兼容的 `validate_character_state`；build_context.py 的适配作为 M5 的隐性依赖项，需在集成测试中验证 |
| schema 变更导致 check_ai_novel.py 的 `load_all_fingerprints` 失败 | 高（去 AI 味检测断） | 中 | `load_all_fingerprints`（line 416-438）当前读 `data.get("language_fingerprint")`，需改为优先读 `data.get("stable_info", {}).get("language_fingerprint")` 兼容新旧 schema。本模块在 check_consistency 的新检测中已做兼容（优先 stable_info 再回退顶层），check_ai_novel 需同步兼容 |
| protagonist.json 迁移后旧 Delta 失效 | 中（历史 Delta 重放失败） | 低 | save_state.py 的 Delta 是一次性的（应用即落盘），不重放历史 Delta。迁移后新 Delta 用新路径，旧 Delta 不再使用 |
| stable_info 守卫误拒合法的 architect 迁移 | 中（弧光推进被卡） | 中 | architect 迁移走专用通道（直接编辑 JSON + commit message 标注），不经 save_state.py 常规通道。守卫只拦 save_state.py 的 op，不拦 architect 直接编辑 |
| 指纹快照目录膨胀（每章一文件） | 低（单文件 <1KB） | 低 | 快照按 `<id>_ch<NNN>.json` 命名，可定期归档；1000 章约 1MB，可接受 |
| 漂移检测误报（弧光合理演变被报为漂移） | 中（作者被打扰） | 中 | 检测只报 P1 不阻断保存；建议项明确「若为弧光推进导致的合理演变，由 architect 更新基线并留痕」 |
| 现有 7 类检测回归 | 高（一致性门禁失效） | 低 | 新检测函数独立，不改现有 7 类逻辑；`test_character_five_layer.py` 的断言 10 验证 8 维度全部可运行 |

### 8.3 对核心资产的影响

按 `.trae/rules/dev-workflow.md` 第四条「禁止事项」定义，NovelForge 核心资产为：

- `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口）—— **本模块修改 `architect` / `writer-polisher` / `state-consistency-checker` 三个核心 Skill**，改动属于 schema 升级的连带适配，不破坏现有工作流，且经本方案文档明确说明理由。
- `NovelForge_Vault/00_控制面/style_guide.md` —— **修改附录 B**，从单层指纹规范升级为五层档案规范引用，novel/shortform 文风规范不动。
- `scripts/novelforge/` —— **修改 `schema.py` / `save_state.py` / `check_consistency.py`**，是本模块的核心改动。

修改 `protagonist.json` 属于数据迁移，需备份。

### 8.4 回滚方案

**分支隔离**：在 `feature/character-five-layer` 分支执行全部改动，主分支 `master` 保持不变。每个改动用独立 commit：

- C1: schema.py 升级（CHARACTER_STATE_SCHEMA 五层 + STABLE_INFO_FIELDS + validate_character_state 扩展）
- C2: save_state.py 升级（守卫函数 + EMPTY_CHARACTER_TEMPLATE 同步）
- C3: check_consistency.py 新增第 8 类检测
- C4: protagonist.json 迁移到五层结构
- C5: architect / writer-polisher / state-consistency-checker SKILL.md 更新
- C6: style_guide.md 附录 B 升级 + protagonist.md 对齐五层
- C7: tests/test_character_five_layer.py 新增 6 用例 + bug_regression_list.md 新增 BUG-055
- C8: build_context.py / check_ai_novel.py 适配新 schema（兼容读写）

**回滚步骤**：

1. 若发现 schema 变更导致 build_context.py / check_ai_novel.py 大面积失败 → revert C8 + C1-C4，保留 C5-C7 文档与测试（不生效但不删除）。
2. 若发现 stable_info 守卫误拒合法操作 → revert C2，临时关闭守卫（在 `_check_stable_info_protection` 首行加 `return`），待修正后恢复。
3. 若发现漂移检测误报过多 → revert C3，临时从 `ALL_DIMENSIONS` 移除 `character_language_fingerprint_drift`，待优化阈值后恢复。
4. 整体回滚：`git revert C1..C8` 或 `git checkout master` 丢弃整个 `feature/character-five-layer` 分支。

**数据备份**：迁移 `protagonist.json` 前先备份：

```bash
cp NovelForge_Vault/.state/characters/protagonist.json \
   NovelForge_Vault/.state/characters/protagonist.json.backup_pre_5layer
```

**gradual rollout**：

1. 第一阶段：在 `feature/character-five-layer` 分支完成全部改动 + 测试通过。
2. 第二阶段：合并到 `master` 后，先跑 `python -m scripts.novelforge.check_consistency --chapter 1 --json` 确认 8 维度全部可运行。
3. 第三阶段：让 writer-polisher 生成下一章，验证 Delta 只命中 mutable_info、stable_info 守卫生效、漂移检测写快照。
4. 第四阶段：观察 5 章后，验证漂移检测能正确加载历史快照。

---

## 九、完成标准（DoD 清单）

- [ ] `file:///workspace/scripts/novelforge/schema.py` 的 `CHARACTER_STATE_SCHEMA` 升级为五层结构（stable_info + mutable_info + meta）
- [ ] `file:///workspace/scripts/novelforge/schema.py` 新增 `STABLE_INFO_FIELDS` 常量集合
- [ ] `file:///workspace/scripts/novelforge/schema.py` 的 `validate_character_state` 扩展五层完整性校验
- [ ] `file:///workspace/NovelForge_Vault/.state/characters/protagonist.json` 迁移到五层结构（含层 1 核心欲望/底层恐惧、层 2 性格正反面/行为标签、层 3 至少 3 弧光阶段、层 5 语言指纹基线）
- [ ] `file:///workspace/scripts/novelforge/save_state.py` 新增 `_check_stable_info_protection` 守卫函数
- [ ] `file:///workspace/scripts/novelforge/save_state.py` 的 `_apply_op` 在 character 分支前置 stable_info 守卫
- [ ] `file:///workspace/scripts/novelforge/save_state.py` 的 `EMPTY_CHARACTER_TEMPLATE` 同步五层结构
- [ ] `file:///workspace/scripts/novelforge/check_consistency.py` 新增第 8 类检测 `character_language_fingerprint_drift`
- [ ] `file:///workspace/scripts/novelforge/check_consistency.py` 的 `ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` / `check_all` 分派逻辑同步第 8 类
- [ ] `file:///workspace/scripts/novelforge/data/character_fingerprints/` 目录创建（含 .gitkeep）
- [ ] `file:///workspace/.trae/skills/architect/SKILL.md` 新增五层生成模板 + 迁移通道 + 禁止覆写 stable_info 条款
- [ ] `file:///workspace/.trae/skills/writer-polisher/SKILL.md` 约束 Delta 只命中 mutable_info + stable_info 拒绝处置
- [ ] `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` 8 类检测解读表 + 第 8 类解读指南
- [ ] `file:///workspace/NovelForge_Vault/00_控制面/style_guide.md` 附录 B 升级为五层档案规范
- [ ] `file:///workspace/NovelForge_Vault/02_角色/protagonist.md` 十段模板对齐五层（补核心欲望/底层恐惧/行为标签/触发事件列）
- [ ] `file:///workspace/tests/test_character_five_layer.py` 6 个用例全部通过：
  - [ ] `test_character_schema_has_five_layers`
  - [ ] `test_stable_info_protected_from_delta`
  - [ ] `test_mutable_info_delta_applies`
  - [ ] `test_language_fingerprint_drift_detection`
  - [ ] `test_architect_generates_five_layer_character`
  - [ ] `test_protagonist_json_migrated`
- [ ] `file:///workspace/tests/bug_regression_list.md` 新增 BUG-055 条目
- [ ] `pytest -q` 全部通过（不破坏现有测试）
- [ ] `python -m scripts.novelforge.check_consistency --chapter 1 --json` 仍正常输出（8 维度可运行）
- [ ] `python -m scripts.novelforge.check_ai_novel --chapter 1 --json` 仍正常输出（兼容新 schema）
- [ ] 集成测试 2 通过：故意写 stable_info 的 Delta 被 save_state.py 拒绝（退出码 1）
- [ ] 集成测试 3 通过：写 mutable_info 的 Delta 正常落盘（退出码 0）
- [ ] loop_log 2026-07 分片追加一条沉淀（`#lesson state_drift`，引用本模块 BUG-055）

---

## 附录 A：与 M2 / M18 模块的关系

| 模块 | 关系 | 协作点 |
|---|---|---|
| M2（schema 同步门禁） | **强依赖（本模块依赖 M2 先完成）** | M2 修复 PIPELINE_SCHEMA 缺失的守护 Skill 字段并实现 state-consistency-checker flag 协议真正阻断保存。本模块的 schema 升级在 M2 之后进行，避免 schema 变更冲突。M2 的 flag 协议与本模块的 stable_info 守卫互补：flag 管"P0 未清零不保存"，stable_info 守卫管"stable_info 不可写"。 |
| M18（Persona Vectors 启发式角色漂移监控） | **下游（本模块是 M18 的基线提供者）** | M18 基于角色语言指纹的 embedding 相似度比对，需要 `stable_info.language_fingerprint` 作为基线。本模块的 stable_info 强保护确保基线全书不变，M18 的漂移监控才有意义。M18 在本模块完成后启动。 |
| M6（伏笔生命周期五阶段升级） | 互补 | M6 升级 hooks_registry.json 从两态到五态，本模块升级 character.json 从扁平到五层。两者都修改 schema.py，需协调避免冲突（建议 M5 先合，M6 后合时基于 M5 版本）。 |
| M7（active enforcement 生成后强制验证） | 互补 | M7 强化 state-consistency-checker 对照 Protected 层关键字段。本模块的 stable_info 是 Protected 层的核心组成部分，M7 的强制验证会覆盖 stable_info 完整性。 |
| M9（朱雀七维度对抗规则） | 正交 | M9 管"去 AI 味"的句式节奏检测，本模块管"角色一致性"的五层档案。两者检测维度不重叠。 |

并行组 B（M5/M6/M7/M8/M9）按 master_plan 4.1 节"批次 2"在 M1-M4 完成后启动。M5 依赖 M2，与 M6/M7/M8/M9 互不依赖可并行。

## 附录 B：参考来源

- **Persona Vectors 论文**：[https://arxiv.org/abs/2407.18431](https://arxiv.org/abs/2407.18431)（角色向量化的漂移监控思想）
- **Letta Filesystem Memory**：[https://github.com/letta-ai/letta](https://github.com/letta-ai/letta)（记忆层 + 创作层 + 审核层三层架构）
- **CreAgentive 角色卡设计**：[https://github.com/langboat/CreAgentive](https://github.com/langboat/CreAgentive)（五层动态行为准则档案）
- **MemoRAG**：[https://arxiv.org/abs/2409.05591](https://arxiv.org/abs/2409.05591)（线索生成 → 精准召回，跨章记忆）
- **Vaswani et al., 2017（Attention Is All You Need）**：[https://arxiv.org/abs/1706.03762](https://arxiv.org/abs/1706.03762)（Transformer 远距离注意力衰减的物理根因）
- **NovelForge loop_log 2026-07**：`file:///workspace/docs/loop_log/2026-07.md`（状态机漂移教训沉淀）

## 附录 C：术语表

| 术语 | 定义 |
|---|---|
| 五层档案模型 | 角色状态机按「核心欲望与底层恐惧 / 性格正反面与行为标签 / 成长弧光与转变节点 / 人物关系网 / 语言指纹」五层组织 |
| stable_info | 强保护层：角色的不变属性（层 1/2/3 定义/层 5 基线/基本信息），全书不变除非核心转变事件 |
| mutable_info | 动态层：每章可变的状态（层 3 当前/层 4/层 5 滚动/位置/境界/情绪/知识/目标） |
| 核心转变事件 | 触发 stable_info 迁移的剧情事件，如弧光阶段推进、性格根本性转变；经 architect 迁移通道 + 作者确认 |
| 语言指纹漂移 | 主角台词的统计特征（句长/用词）连续 N 章偏离 stable_info.language_fingerprint 基线，是慢性 OOC 的早期信号 |
| stable_info 守卫 | save_state.py 的 `_check_stable_info_protection` 函数，在 op 应用前拦截任何对 stable_info 路径的写入 |
| 迁移通道 | architect Skill 修改 stable_info 的专用流程，不经 save_state.py 常规通道，直接编辑 JSON + commit message 标注 `architect-migration` |
| 指纹快照 | 每章对话统计的 JSON 文件，存于 `data/character_fingerprints/<id>_ch<NNN>.json`，供跨章漂移检测加载历史 |
| 急性偏离 vs 慢性漂移 | 急性=单章偏离指纹 >30%（check_ai_novel 管）；慢性=连续 N 章滚动均值偏离 >30%（check_consistency 管） |

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 多专家团（M5 角色五层档案模型升级）
**依赖**：M2（schema 同步门禁）
**下游影响**：M18（Persona Vectors 启发式角色漂移监控）
