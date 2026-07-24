# M7 · active enforcement 生成后强制验证

> **核心目标**：在 M2 flag 协议基础上扩展 enforcement 层，每章生成后立即对照 Protected 层关键字段，发现矛盾 P0 阻断保存，实现「生成 → 验证 → 阻断/通过」的闭环。
>
> **所属层级**：L2 防漂移深化 · 主动校验
> **依赖**：M2（schema 同步门禁 + flag 协议接入）必须先合入
> **下游**：M5（角色五层档案）/ M6（伏笔五阶段）/ M18（Persona Vectors）的 enforcement 实现均以本模块的 Protected 层强制校验框架为基础
> **方案原则**：本方案文档详细到「AI 直接读取即可开始优化、验证、修复」的程度，包含目标、痛点对应、涉及文件路径、详细实现步骤、验证命令、回归测试要求、风险点、DoD 清单。

---

## 一、模块目标

### 1.1 一句话目标

强化 `state-consistency-checker` Skill 为 **active enforcement 层**：每章生成后立即对照 Protected 层关键字段（author_intent L0 / characters stable_info / worldbuilding core_rules / style_guide 禁用词表 / hooks_registry status），发现矛盾生成 P0 flag 并阻断 `save_state.py` 保存。

### 1.2 对应的痛点

行业调研发现 Sudowrite 的 Story Bible 与 NovelCrafter 的 Codex 都是 **reference without enforcement**——AI 生成时可以读到设定，但**没有任何系统确认这些设定被尊重**。novarrium 评测进一步发现：AI 模型即使收到了 Protected 层注入的角色稳定属性、世界观规则、风格禁用词表，仍可能在生成中违反它们，而现有流程对此**只能事后通过 check_consistency.py 的 7 类检测被动捕获**——这 7 类检测只覆盖角色状态机字段（境界/物品/位置/关系/复生/伏笔/金手指），不覆盖 Protected 层的「作者意图 / 世界观核心规则 / 风格禁用词」三个维度。

### 1.3 完成后达成的能力

- **生成 → 验证 → 阻断/通过** 的完整闭环：
  - 生成：writer-polisher 阶段一产出 drafts 章节正文
  - 验证：state-consistency-checker 第四阶段「强制验证」对照 Protected 层关键字段做主动校验
  - 阻断：发现 Protected 层违反即生成 P0 flag，M2 已接入的 `save_state.py._check_flags()` 在入口处 raise ValueError
  - 通过：所有 Protected 层字段无矛盾才允许 `save_state.py` 写入
- **新增第 10 类检测 `protected_layer_violation`**：覆盖 author_intent / worldbuilding / style_guide / hooks_status 四个 Protected 子维度，弥补现有 7 类检测只查 character_state 的盲区
- **新增 `enforce_protected_layer.py` 脚本**：与 `check_consistency.py` 同级，专门做 Protected 层关键字段强制校验
- **writer-polisher 四阶段流水线第 4 步强制走 enforcement**：状态更新前必须先跑 enforce_protected_layer

### 1.4 与 M2 的边界声明

| 维度 | M2（schema 同步门禁） | M7（active enforcement） |
|---|---|---|
| 核心问题 | flag 协议未接入导致 P0 无法阻断保存 | 没有 active enforcement 导致 Protected 层违反被放过 |
| 检测维度 | 复用 check_consistency.py 的 7 类检测 | 新增第 10 类 protected_layer_violation 检测 |
| flag 来源 | state-consistency-checker 解析 check_consistency Report | state-consistency-checker 额外调 enforce_protected_layer.py 生成 protected flag |
| 阻断机制 | save_state.py 入口的 `_check_flags()` | 复用 M2 的 `_check_flags()`，无需新增阻断代码 |
| 关系 | M2 提供 flag 协议契约（FLAG_SCHEMA / validate_flags / save_state 阻断入口） | M7 在 M2 的契约上扩展 Protected 层字段校验，**复用 M2 的阻断入口**，不重复造轮子 |

**依赖关系**：M7 必须在 M2 合入后开发。若 M2 未合入，M7 的 protected flag 文件无法被 `save_state.py` 阻断，只能退化为 `--strict` 退出码 1 的弱信号。

---

## 二、痛点对应

### 2.1 痛点表现

**痛点 A · 行业普遍 reference without enforcement**：

| 产品/系统 | 现状 | 缺陷 |
|---|---|---|
| Sudowrite Story Bible | AI 生成时可读 Story Bible 设定 | 无 enforcement，AI 收到信息但无系统确认被尊重 |
| NovelCrafter Codex | Codex 是 reference，无 schema 校验 | 同上 |
| 阅文妙笔 / 彩云小彩 | 内部状态机不公开，推测 reference + 人审 | 黑盒不可借鉴 |
| Letta Filesystem | 文件即记忆，有 block/unblock 协议 | 但不针对创作一致性，只针对记忆读写 |
| 学术 Persona Vectors (arXiv 2507.21509) | 用 embedding 漂移检测角色 | 检测后不阻断生成，检测与执行脱节 |
| **NovelForge 现状（M2 之前）** | check_consistency.py 7 类检测 + `--strict` 退出码 | 检测只覆盖 character_state，不覆盖 Protected 层；M2 之前 flag 协议未接入 save_state.py |

**痛点 B · 7 类检测不覆盖 Protected 层**：

经 Read 现状核查 file:///workspace/scripts/novelforge/check_consistency.py 第 1-11 行与第 182-201 行：

```
现有 7 类检测全部针对 character_state 字段：
1. power_level_jump（境界跳级，P0）→ character_state.power_level.realm
2. phantom_item（物品凭空，P0）→ character_state.inventory
3. relationship_mutation（关系突变，P1）→ character_state.relationships
4. location_jump（位置穿越，P0）→ character_state.location.current
5. foreshadow_forgetting（伏笔遗忘，P1）→ hooks_registry.status
6. character_revival（角色复生，P0）→ character_state.status
7. golden_finger_overreach（金手指越界，P1）→ character_state.power_level.abilities/limitations
```

**未覆盖的 Protected 层维度**：

| Protected 层子项（build_context.py 第 47-56 行） | 来源 | 7 类检测覆盖？ |
|---|---|---|
| 章纲 | architect 生成的本章章纲 | ❌ 不覆盖（章纲要求与正文偏离无人查） |
| 活跃角色状态 stable_info | `.state/characters/*.json` 的 basic / arc_stage / language_fingerprint | ⚠️ 仅覆盖 power_level/inventory/location/relationships/status，**不覆盖 basic.role / arc_stage / language_fingerprint.catchphrases 等稳定属性** |
| 未填伏笔 status | `hooks_registry.json` | ⚠️ 只查超期遗忘，**不查正文是否违反伏笔 status 约束**（如 status=resolved 的伏笔正文又当作未解谜题使用） |
| 焦点 current_focus | `current_focus.md` | ❌ 不覆盖 |
| author_intent L0 摘要 | `author_intent.md` 的 L0 段 | ❌ **完全不覆盖**（主角弧光/世界观核心/爽点曲线/风格基调被正文违反时无人察觉） |
| worldbuilding core_rules | `01_世界观/core_rules.md` | ❌ **完全不覆盖**（如规则"修仙者不能复活死人"被正文违反时无人察觉） |
| style_guide 禁用词表 | `style_guide.md` 禁用词分级 | ⚠️ check_ai_novel.py 部分覆盖，但**不阻断 save_state**（去 AI 味检测独立运行） |

**痛点 C · AI 收到 Protected 层信息但无系统确认被尊重**：

经 Read file:///workspace/.trae/skills/context-composer/SKILL.md 第 231-235 行防漂移铁律与 file:///workspace/scripts/novelforge/build_context.py 第 689-705 行 Protected 层组装逻辑，NovelForge 已实现了 Protected 层注入机制（章纲/角色状态/伏笔/焦点/意图L0 强制注入、不可压缩），但**生成后没有对照这些字段做强制校验**——这导致以下场景全部漏检：

- 主角弧光要求"从复仇走向宽恕"（author_intent L0），但本章正文又把主角写回纯复仇动机
- 世界观规则"修仙者不能复活死人"（worldbuilding core_rules），但本章正文出现主角复活死人的描写
- style_guide 禁用词"AI 翻译腔"被正文违反（"这是 X 的存在""一种 X 的感觉"）
- 主角语言指纹 `catchphrases=["本座"]` 但本章主角全程自称"我"
- status=resolved 的伏笔被正文重新当作未解谜题使用

### 2.2 行业方案

| 产品/系统 | 方案 | 局限 |
|---|---|---|
| **CreAgentive Story Prototype KG** | 用知识图谱做 Story Bible，生成后做图谱一致性检查 | 检测覆盖广但仅做 reference 校验，不阻断保存 |
| **Remember Me 三 agent 迭代构建** | Writer / Critic / Editor 三 agent 迭代，Critic 对照设定做 critic | 三 agent 协作但无 P0 阻断机制，Critic 报告仍可被 Writer 忽略 |
| Sudowrite Story Bible | reference only | 无 enforcement |
| NovelCrafter Codex | reference + 人工 critic | 无 enforcement |
| 学术 Persona Vectors | embedding 漂移检测 | 检测后不阻断生成 |

**行业共识**：检测能力（detection）有，reference 守门（reference guard）部分有，但 **active enforcement**（检测后真正阻断生成/保存，且对照 Protected 层全字段）几乎没有产品实现。这是 NovelForge 的差异化机会——M2 已经把 check_consistency.py 的 7 类检测接入了 flag 协议硬性阻断，M7 把这个阻断从「character_state 7 维」扩展到「Protected 层全字段」。

### 2.3 本模块的差异化设计

```
M2 已实现：
  check_consistency.py 7 类检测（character_state 字段）
    → 输出 Report.issues[]
    → state-consistency-checker 转 flag 文件
    → save_state.py._check_flags() P0 阻断

M7 新增（在 M2 之上扩展）：
  enforce_protected_layer.py（Protected 层全字段强制校验）
    → 对照 author_intent L0 / characters stable_info / worldbuilding core_rules / style_guide 禁用词表 / hooks_registry status
    → 输出 protected_issues[]
    → state-consistency-checker 转 flag 文件（与 check_consistency 共用同一 flag 文件）
    → save_state.py._check_flags() P0 阻断（复用 M2 入口，无新增阻断代码）

  check_consistency.py 新增第 10 类检测 protected_layer_violation（薄包装）
    → 内部调 enforce_protected_layer.py 的核心函数
    → Report.issues[] 类型 = "protected_layer_violation"
    → 与既有 7 类检测共用同一 Report 输出与 flag 生成流程
```

**核心差异**：M2 让 check_consistency.py 的 7 类检测有了「强制力」（save_state.py 入口处 raise），M7 让 Protected 层全字段校验有了「检测力」（enforce_protected_layer.py + 第 10 类检测），二者合起来才构成完整的 active enforcement 闭环。**M7 不重写阻断机制，只扩展检测面**。

---

## 三、涉及现有文件

### 3.1 必须先 Read 的文件清单

| 文件 | 行数 | 现状 | 需要关注的内容 |
|---|---|---|---|
| file:///workspace/.trae/skills/state-consistency-checker/SKILL.md | 347 行 | M2 后第 219-235 行 flag 协议已接入；工作流 7 步只跑 check_consistency.py 7 类 | 本模块新增「第四阶段：强制验证」，工作流扩展为 8 步 |
| file:///workspace/scripts/novelforge/check_consistency.py | 1460 行 | `Issue` 第 207-223 行；`Report` 第 226-248 行；`ALL_DIMENSIONS` 第 182-190 行；`check_all` 第 1212-1289 行；`format_json` 第 1347-1368 行 | 在 `ALL_DIMENSIONS` 末尾追加 `protected_layer_violation`；在 `check_all` 第 1272-1288 行的 for 循环追加分支；新增 `check_protected_layer_violation()` 函数 |
| file:///workspace/scripts/novelforge/save_state.py | 1137 行 | M2 后第 919 行接入 `_check_flags()`；第 948-958 行 dry_run 不消费 flag；第 1000 行附近 `_consume_flags()` | **本模块不修改 save_state.py**——M2 已提供完整的 flag 阻断入口，M7 只复用 |
| file:///workspace/.trae/skills/writer-polisher/SKILL.md | 344 行 | 阶段一写手 / 阶段二审计 / 阶段三精修 / 阶段四状态更新；阶段四第 1-5 步见第 182-254 行 | 阶段四新增「第 0 步：强制验证」，必须先跑 enforce_protected_layer.py |
| file:///workspace/.trae/skills/context-composer/SKILL.md | 269 行 | Protected 层定义见第 47-56 行；防漂移三铁律见第 231-235 行 | **本模块不修改 context-composer**——只读其 Protected 层字段定义作为 enforce_protected_layer 的输入规范 |
| file:///workspace/scripts/novelforge/build_context.py | 977 行 | Protected 层组装见第 689-705 行；`_read_author_intent_l0` 第 328-342 行；`_read_active_characters` 第 241-260 行；`_read_unresolved_hooks` 第 302-307 行 | **本模块不修改 build_context.py**——enforce_protected_layer.py 复用其读取函数（import） |
| file:///workspace/docs/optimization_plan_2026_07/M02_schema_sync_gate.md | 1378 行 | FLAG_SCHEMA 定义见 §5.2；save_state.py 接入见 §5.3；state-consistency-checker SKILL.md 升级见 §5.4 | **本模块依赖 M2 全部产出**：FLAG_SCHEMA / validate_flags / `_check_flags` / `_load_flags` / `_consume_flags` / state-consistency-checker SKILL.md flag 协议段 |

### 3.2 状态字段引用关系（核对依据）

| Protected 子项 | 数据源 | 现有 schema | M7 是否需新增 schema |
|---|---|---|---|
| author_intent L0 | `00_控制面/author_intent.md` 的 L0 段 | 无 schema（Markdown 文件） | 否，enforce_protected_layer.py 直接读 Markdown |
| characters stable_info | `.state/characters/*.json` 的 `basic` / `arc_stage` / `language_fingerprint` 字段 | `CHARACTER_STATE_SCHEMA` 已覆盖（schema.py） | 否 |
| worldbuilding core_rules | `01_世界观/core_rules.md` | 无 schema（Markdown 文件） | 否，enforce_protected_layer.py 直接读 Markdown |
| style_guide 禁用词表 | `00_控制面/style_guide.md` | 无 schema（Markdown 文件） | 否 |
| hooks_registry status | `04_大纲与脉络/hooks_registry.json` | `FORESHADOW_SCHEMA` 已覆盖（schema.py） | 否 |

**结论**：M7 不需要新增任何 schema 定义，全部复用 M2 已有的 `FLAG_SCHEMA` + `validate_flags`。新增的 `protected_layer_violation` rule 需加入 `FLAG_SCHEMA.properties.rule.enum` 白名单（M2 第 211-217 行枚举了 7 个 rule，M7 追加第 8 个）。

---

## 四、新增/修改文件清单

### 4.1 修改文件

| 文件 | 核心改动点 |
|---|---|
| file:///workspace/.trae/skills/state-consistency-checker/SKILL.md | (1) 描述升级为「active enforcement 层」；(2) 工作流新增「第四阶段：强制验证」（在第 7 步「通过」前插入）；(3) 反模式列表新增「不跑 enforce_protected_layer 就允许 save_state」项；(4) 调用脚本列表追加 `enforce_protected_layer.py` |
| file:///workspace/scripts/novelforge/check_consistency.py | (1) `ALL_DIMENSIONS` 末尾追加 `"protected_layer_violation"`；(2) `DIM_LABELS` 追加 `"protected_layer_violation": "Protected 层违反"`；(3) `DIM_ALIASES` 追加 `"protected": "protected_layer_violation"` 与 `"protected_layer_violation": "protected_layer_violation"`；(4) 新增 `check_protected_layer_violation()` 函数（薄包装，内部 import `enforce_protected_layer` 调核心函数）；(5) `check_all` 第 1272-1288 行的 for 循环追加 `elif dim == "protected_layer_violation"` 分支 |
| file:///workspace/.trae/skills/writer-polisher/SKILL.md | (1) 阶段四「状态更新」第 1 步前插入「第 0 步：强制验证」；(2) 错误处理表新增「enforce_protected_layer 检出 P0 → 阻断 save_state，返回阶段三精修」；(3) 输出格式追加 enforcement 检查行 |
| file:///workspace/scripts/novelforge/schema.py | M2 已定义 `FLAG_SCHEMA.properties.rule.enum` 含 7 个 rule，M7 追加 `"protected_layer_violation"` 第 8 个（一处常量更新） |

### 4.2 新增文件

| 文件 | 作用 |
|---|---|
| file:///workspace/scripts/novelforge/enforce_protected_layer.py | Protected 层强制校验脚本，对照 author_intent L0 / characters stable_info / worldbuilding core_rules / style_guide 禁用词表 / hooks_registry status 做主动校验，输出 Report（与 check_consistency.Issue 同构） |
| file:///workspace/tests/test_active_enforcement.py | 6 个回归测试用例（详见 §七） |

### 4.3 不修改的文件（明确边界）

- file:///workspace/scripts/novelforge/save_state.py（M2 已接入 flag 协议，M7 复用 `_check_flags()` 入口，**不重复阻断逻辑**）
- file:///workspace/scripts/novelforge/build_context.py（M7 复用其 Protected 层读取函数，**不修改组装逻辑**）
- file:///workspace/.trae/skills/context-composer/SKILL.md（Protected 层定义的 SSOT，**不修改**）
- file:///workspace/.trae/skills/writer-polisher/SKILL.md 的阶段一/二/三（**只改阶段四**）
- file:///workspace/.trae/checklists/dev-checklist.md（M7 不新增自检项，M2 已新增「schema 同步检查」项覆盖；若需追加可在 dev-checklist.md 末尾追加一项「active enforcement 检查」，但不在本模块 DoD 硬性要求内）

---

## 五、详细实现步骤

### 5.1 步骤 1 · 定义 Protected 层关键字段清单

基于 file:///workspace/scripts/novelforge/build_context.py 第 47-56 行与 file:///workspace/.trae/skills/context-composer/SKILL.md 第 47-56 行的 Protected 层定义，明确 M7 强制校验的关键字段清单：

#### 5.1.1 Protected 层关键字段表

| # | Protected 子项 | 字段名 | 数据源 | 校验规则 | 违反级别 |
|---|---|---|---|---|---|
| 1 | author_intent L0 摘要 | `protagonist_arc`（主角弧光） | `00_控制面/author_intent.md` 的 L0 段「主角弧光」字段 | 正文主角动机/行为方向与弧光描述冲突时报警（如弧光=「复仇→宽恕」但正文主角仍纯复仇） | P0 |
| 2 | author_intent L0 摘要 | `world_core`（世界观核心） | `author_intent.md` 的 L0 段「世界观核心」字段 | 正文出现与世界观核心冲突的设定（如世界观核心=「修仙者不能复活死人」但正文出现复活描写） | P0 |
| 3 | author_intent L0 摘要 | `style_tone`（风格基调） | `author_intent.md` 的 L0 段「风格基调」字段 | 正文整体风格与基调描述严重偏离（如基调=「冷峻克制」但正文大段煽情排比） | P1 |
| 4 | characters stable_info | `basic.role`（角色定位） | `.state/characters/*.json` 的 `basic.role` | 正文出现与 role 冲突的描写（如 role=antagonist 但正文当作 protagonist 叙述视角） | P1 |
| 5 | characters stable_info | `basic.name` + `aliases`（角色名与别名） | `.state/characters/*.json` 的 `basic.name` / `basic.aliases` | 正文出现角色名拼写错误或未登记的别名 | P2 |
| 6 | characters stable_info | `arc_stage`（角色弧光阶段） | `.state/characters/*.json` 的 `arc_stage` | 正文角色所处阶段与状态机 arc_stage 不一致（如 arc_stage=「觉醒期」但正文已是「顿悟期」描写） | P0 |
| 7 | characters stable_info | `language_fingerprint.catchphrases`（口头禅） | `.state/characters/*.json` 的 `language_fingerprint.catchphrases` | 设定了 catchphrases 但本章正文主角从未使用（且本章主角有台词） | P1 |
| 8 | characters stable_info | `language_fingerprint.forbidden_words`（角色禁用词） | `.state/characters/*.json` 的 `language_fingerprint.forbidden_words` | 正文角色台词出现该角色 forbidden_words 列表中的词 | P0 |
| 9 | worldbuilding core_rules | `core_rules`（核心规则列表） | `01_世界观/core_rules.md` 的「核心规则」段 | 正文出现违反核心规则的描写（如规则=「金丹期不可飞升」但正文金丹期角色飞升） | P0 |
| 10 | style_guide 禁用词表 | `forbidden_words_p0`（P0 禁用词） | `00_控制面/style_guide.md` 的「P0 禁用词」段 | 正文出现 P0 禁用词（如「AI 翻译腔」「视角混乱」） | P0 |
| 11 | style_guide 禁用词表 | `forbidden_words_p2`（P2 控量词） | `00_控制面/style_guide.md` 的「P2 控量词」段 | 正文出现 P2 控量词超量（如「宛如/仿佛/交织」全文 > 2 次/千字） | P2 |
| 12 | hooks_registry status | `hooks[].status` | `04_大纲与脉络/hooks_registry.json` | status=resolved 的伏笔被正文重新当作未解谜题使用；status=abandoned 的伏笔被正文重新铺设 | P0 |

#### 5.1.2 字段优先级与豁免策略

- **P0（不可豁免，阻断 save_state）**：author_intent 主角弧光/世界观核心、characters arc_stage/forbidden_words、worldbuilding core_rules、style_guide P0 禁用词、hooks status=resolved 被违反
- **P1（可豁免，需 bypass_reason 留痕）**：author_intent 风格基调、characters role/catchphrases、style_guide P1 控量词
- **P2（仅提示，不阻断）**：characters name/aliases 拼写、style_guide P2 控量词

豁免策略复用 M2 的 `FLAG_SCHEMA.can_bypass + bypass_reason` 机制，无需新增字段。

### 5.2 步骤 2 · 设计 active enforcement 工作流

#### 5.2.1 完整工作流（M7 升级后）

```
writer-polisher 阶段一：写手
  → 生成 drafts/vol_NN/ch_NNN.md 草稿
  ↓
writer-polisher 阶段二：审计
  → 跑 check_consistency.py（7 类 + 第 10 类 protected_layer_violation = 8 类）
  → 跑 check_ai_novel.py（10 类去 AI 味）
  ↓
writer-polisher 阶段三：精修
  → 定点修复 P0 问题
  → 重跑 check_consistency.py + check_ai_novel.py 验证 P0 清零
  ↓
writer-polisher 阶段四：状态更新
  → 【第 0 步：强制验证（M7 新增）】
    → 跑 enforce_protected_layer.py --chapter {N} --json
    → 解析 protected_report
    → 若有 P0 protected issue → 转 flag 文件 → 阻断 save_state → 返回阶段三精修
    → 若有 P1 protected issue → 转 flag 文件（can_bypass=true，待作者填 bypass_reason）→ 允许 save_state
    → 若全通过 → 合并到 check_consistency 的 flag 文件
  → 【第 1 步：提取本章状态变更】（原步骤）
  → 【第 2 步：构造 Delta JSON】（原步骤）
  → 【第 3 步：调用 save_state.py】（原步骤）
    → M2 的 _check_flags() 入口读 flag 文件
    → P0 flag → raise ValueError 阻断
    → P1 flag + bypass_reason → warning 但允许
    → 成功写入 → _consume_flags() 删除 flag 文件
  → 【第 4 步：写入章末摘要】（原步骤）
  → 【第 5 步：验证】（原步骤）
```

#### 5.2.2 flag 文件合并策略

state-consistency-checker 跑完 `check_consistency.py` 与 `enforce_protected_layer.py` 后，**两个脚本的 issues 合并写入同一个 flag 文件** `.state/.lock/flags_ch{NNN}.json`：

```python
# 伪代码
consistency_report = check_consistency.check_all(chapter, vault)  # 8 类（含 protected_layer_violation 薄包装）
protected_report = enforce_protected_layer.enforce(chapter, vault)  # 详细 Protected 层校验

# 合并 issues（去重：同 type+同 detail 视为重复）
all_issues = consistency_report.issues + protected_report.issues
# 注意：check_consistency.py 的 protected_layer_violation 是薄包装，
# 其 issues 已包含在 consistency_report.issues 中；
# enforce_protected_layer.py 的 issues 是详细版（含 sub_type 区分 5 个子维度），
# 二者去重时优先保留详细版

flags = [issue_to_flag(issue, chapter) for issue in all_issues]
write_flag_file(vault, chapter, flags)
```

**去重规则**：若 `check_consistency.py` 的 `protected_layer_violation` Issue 与 `enforce_protected_layer.py` 的某 Issue 的 `extras.sub_type` 与 `extras.field` 完全一致，视为重复，保留详细版（enforce_protected_layer.py 的输出）。

### 5.3 步骤 3 · enforce_protected_layer.py 完整脚本逻辑

新增 file:///workspace/scripts/novelforge/enforce_protected_layer.py，完整代码如下：

```python
"""NovelForge Protected 层强制校验脚本（active enforcement）。

对照 Protected 层关键字段（author_intent L0 / characters stable_info /
worldbuilding core_rules / style_guide 禁用词表 / hooks_registry status）
做主动校验，发现矛盾生成 P0/P1 Issue，与 check_consistency.Issue 同构。

设计哲学：
- **active enforcement**：不依赖 AI 自觉遵守 Protected 层，强制对照校验
- **复用 build_context 读取函数**：避免重复实现 Protected 层字段解析
- **与 check_consistency.Issue 同构**：可直接合并到 flag 文件
- **M2 flag 协议兼容**：P0 Issue 转 flag 后由 save_state.py 入口阻断

CLI 速查：
    # 强制校验第 42 章
    python -m scripts.novelforge.enforce_protected_layer --chapter 42

    # JSON 输出（state-consistency-checker 解析用）
    python -m scripts.novelforge.enforce_protected_layer --chapter 42 --json

    # 严格模式（P0 退出码 1，CI 用）
    python -m scripts.novelforge.enforce_protected_layer --chapter 42 --strict

    # 只校验指定子维度（author_intent / characters / worldbuilding / style_guide / hooks）
    python -m scripts.novelforge.enforce_protected_layer --chapter 42 --sub author_intent,characters

退出码：
- 0：通过（无 P0；--strict 模式下无 P0 也为 0）
- 1：--strict 模式下检测到 P0 问题（阻断保存）
- 2：脚本错误（章节缺失等）
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# 复用同包 schema 校验
try:
    from .schema import validate_character_state
except ImportError:  # 兼容直接 python 调用
    from scripts.novelforge.schema import validate_character_state  # type: ignore

# 复用 build_context 的 Protected 层读取函数（避免重复实现）
try:
    from .build_context import (
        _read_author_intent_l0,
        _read_active_characters,
        _read_current_focus,
        _safe_read,
        _safe_read_json,
        DEFAULT_VAULT as BC_DEFAULT_VAULT,
    )
except ImportError:
    from scripts.novelforge.build_context import (  # type: ignore
        _read_author_intent_l0,
        _read_active_characters,
        _read_current_focus,
        _safe_read,
        _safe_read_json,
        DEFAULT_VAULT as BC_DEFAULT_VAULT,
    )

# 复用 check_consistency 的 Issue 数据结构（保证同构）
try:
    from .check_consistency import Issue, load_chapter_text, strip_frontmatter
except ImportError:
    from scripts.novelforge.check_consistency import (  # type: ignore
        Issue,
        load_chapter_text,
        strip_frontmatter,
    )


# ============================================================================
# 常量
# ============================================================================
DEFAULT_VAULT: str = BC_DEFAULT_VAULT if isinstance(BC_DEFAULT_VAULT, str) else str(BC_DEFAULT_VAULT)

# Protected 层子维度名（与 --sub 参数对应）
SUB_AUTHOR_INTENT = "author_intent"
SUB_CHARACTERS = "characters"
SUB_WORLDBUILDING = "worldbuilding"
SUB_STYLE_GUIDE = "style_guide"
SUB_HOOKS = "hooks"

ALL_SUBS: list[str] = [
    SUB_AUTHOR_INTENT,
    SUB_CHARACTERS,
    SUB_WORLDBUILDING,
    SUB_STYLE_GUIDE,
    SUB_HOOKS,
]

# style_guide P0 禁用词（与 .trae/skills/writer-polisher/SKILL.md 第 268-271 行铁律 1 对齐）
STYLE_P0_FORBIDDEN_WORDS: tuple[str, ...] = (
    "yyds", "破防", "绝绝子",  # 现代网络用语混入古风
    "这是.*的存在", "一种.*的感觉",  # AI 翻译腔（正则模式）
)

# style_guide P2 控量词与阈值（与 writer-polisher SKILL.md 第 274-279 行铁律 2 对齐）
STYLE_P2_CONTROLLED_WORDS: tuple[str, ...] = ("宛如", "仿佛", "交织")
STYLE_P2_THRESHOLD_PER_KCHAR: int = 2  # ≤ 2 次/千字

# hooks status 合法集合
HOOKS_VALID_STATUSES: set[str] = {"planted", "hinted", "resolved", "abandoned"}


# ============================================================================
# Protected 层字段读取
# ============================================================================
def _read_style_guide(vault: str) -> str:
    """读取 00_控制面/style_guide.md 全文。"""
    return _safe_read(Path(vault) / "00_控制面" / "style_guide.md")


def _read_core_rules(vault: str) -> str:
    """读取 01_世界观/core_rules.md 全文。"""
    return _safe_read(Path(vault) / "01_世界观" / "core_rules.md")


def _read_hooks_registry(vault: str) -> dict:
    """读取 04_大纲与脉络/hooks_registry.json。"""
    return _safe_read_json(Path(vault) / "04_大纲与脉络" / "hooks_registry.json")


def _parse_author_intent_fields(intent_l0_text: str) -> dict[str, str]:
    """从 author_intent L0 摘要中解析关键字段。

    解析「主角弧光」「世界观核心」「风格基调」三段，返回 {field: content}。

    模板假设（与 build_context._read_author_intent_l0 输出一致）：
        ## L0 摘要版
        ### 主角弧光
        <content>
        ### 世界观核心
        <content>
        ### 风格基调
        <content>
    """
    if not intent_l0_text:
        return {}
    fields: dict[str, str] = {}
    # 按 ### 标题分段
    sections = re.split(r"^###\s+", intent_l0_text, flags=re.MULTILINE)
    for sec in sections[1:]:  # 跳过首段（## L0 摘要版头部）
        lines = sec.splitlines()
        if not lines:
            continue
        title = lines[0].strip()
        content = "\n".join(lines[1:]).strip()
        if "主角弧光" in title or "弧光" in title:
            fields["protagonist_arc"] = content
        elif "世界观核心" in title or "世界核心" in title:
            fields["world_core"] = content
        elif "风格" in title or "基调" in title:
            fields["style_tone"] = content
    return fields


def _parse_core_rules(core_rules_text: str) -> list[dict[str, str]]:
    """从 core_rules.md 解析核心规则列表。

    每条规则格式（模板假设）：
        ## 规则：<rule_name>
        <rule_description>
        ### 违反示例
        ...

    返回 [{"name": ..., "description": ...}, ...]
    """
    if not core_rules_text:
        return []
    rules: list[dict[str, str]] = []
    # 按 ## 标题分段
    sections = re.split(r"^##\s+", core_rules_text, flags=re.MULTILINE)
    for sec in sections[1:]:
        lines = sec.splitlines()
        if not lines:
            continue
        title = lines[0].strip()
        # 只匹配「规则：」前缀或包含「规则」的标题
        if not (title.startswith("规则") or "规则" in title):
            continue
        # 提取规则名（去掉「规则：」前缀）
        name = re.sub(r"^规则[：:]?\s*", "", title).strip()
        description = "\n".join(lines[1:]).strip()
        # 截到第一个 ### 子段（避免纳入违反示例）
        desc_match = re.split(r"^###\s+", description, flags=re.MULTILINE)
        description = desc_match[0].strip()
        if name and description:
            rules.append({"name": name, "description": description})
    return rules


def _parse_style_guide_forbidden_words(style_text: str) -> tuple[list[str], list[str]]:
    """从 style_guide.md 解析 P0 禁用词与 P2 控量词。

    返回 (p0_forbidden_words, p2_controlled_words)。
    模板假设：style_guide.md 含「禁用词」「P0 禁用」「控量词」等标题段。
    """
    if not style_text:
        return ([], [])
    p0_words: list[str] = list(STYLE_P0_FORBIDDEN_WORDS)  # 兜底常量
    p2_words: list[str] = list(STYLE_P2_CONTROLLED_WORDS)

    # 简单解析：扫描 markdown 表格行 | 词 | 等级 | 适用 |
    for line in style_text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 4:
            continue
        word = cells[1]
        level = cells[2]
        if not word or word in ("词", "词/短语"):
            continue
        if set(word) <= {"-", ":"}:
            continue
        if "P0" in level:
            if word not in p0_words:
                p0_words.append(word)
        elif "P2" in level or "控量" in level:
            if word not in p2_words:
                p2_words.append(word)
    return (p0_words, p2_words)


# ============================================================================
# 校验函数（5 个子维度）
# ============================================================================
def check_author_intent(
    body: str,
    intent_fields: dict[str, str],
    chapter: int,
) -> list[Issue]:
    """校验 author_intent L0 字段（protagonist_arc / world_core / style_tone）。"""
    issues: list[Issue] = []
    if not intent_fields:
        return issues

    # 1. protagonist_arc（主角弧光）—— P0
    arc = intent_fields.get("protagonist_arc", "")
    if arc:
        # 简单冲突检测：弧光描述含「宽恕」「和解」但正文出现纯复仇信号
        if "宽恕" in arc or "和解" in arc:
            revenge_signals = ("复仇", "报仇", "血债血偿", "不死不休")
            hits = [w for w in revenge_signals if w in body]
            if hits:
                issues.append(Issue(
                    severity="P0",
                    type="protected_layer_violation",
                    detail=(
                        f"主角弧光要求「{arc[:60]}」，但本章正文出现纯复仇信号词：{hits}。"
                        f"若本章是弧光转折前的低谷，需在 flag 中豁免并填 bypass_reason。"
                    ),
                    suggestion="修正正文动机描述以匹配主角弧光，或在 flag 中豁免（需填 bypass_reason）",
                    extras={"sub_type": "author_intent", "field": "protagonist_arc",
                            "expected": arc[:100], "violated_signals": hits},
                ))
        # 弧光含「觉醒→顿悟」但 arc_stage 检测在 characters 子维度处理

    # 2. world_core（世界观核心）—— P0
    world_core = intent_fields.get("world_core", "")
    if world_core:
        # 提取世界观核心规则的关键约束词
        # 模板假设：world_core 含「不能 X」「禁止 X」「不可 X」等约束
        constraints = re.findall(
            r"(?:不能|禁止|不可|无法|严禁)\s*([^\s，。；！？]{2,12})",
            world_core,
        )
        for constraint in constraints:
            # 简单检测：正文出现该约束的反向描写
            # 如约束=「复活死人」，正文出现「复活+死人/死者/尸体」
            if constraint in body:
                # 检查上下文是否是「违反」而非「引用规则」
                # 简单实现：直接报警，作者判断
                issues.append(Issue(
                    severity="P0",
                    type="protected_layer_violation",
                    detail=(
                        f"世界观核心约束「不能{constraint}」被本章正文违反："
                        f"正文出现「{constraint}」相关描写。"
                        f"若正文是角色讨论该规则（非违反），需在 flag 中豁免。"
                    ),
                    suggestion="修正正文使其符合世界观核心约束，或在 flag 中豁免（需填 bypass_reason）",
                    extras={"sub_type": "author_intent", "field": "world_core",
                            "constraint": constraint},
                ))

    # 3. style_tone（风格基调）—— P1
    tone = intent_fields.get("style_tone", "")
    if tone:
        # 简单检测：基调=「冷峻克制」但正文大段煽情排比
        if "冷峻" in tone or "克制" in tone:
            # 检测连续 ≥ 3 组「不是 X 而是 Y」结构（与 check_ai_novel 句式检测互补）
            pattern_count = len(re.findall(r"不是.{1,15}而是", body))
            if pattern_count >= 3:
                issues.append(Issue(
                    severity="P1",
                    type="protected_layer_violation",
                    detail=(
                        f"风格基调要求「{tone[:40]}」，但本章正文出现 {pattern_count} 组"
                        f"「不是 X 而是 Y」排比结构，与冷峻克制基调冲突。"
                    ),
                    suggestion="重写排比结构，改为更克制的表达",
                    extras={"sub_type": "author_intent", "field": "style_tone",
                            "pattern_count": pattern_count},
                ))

    return issues


def check_characters_stable_info(
    body: str,
    active_chars: list[tuple[Path, dict]],
    chapter: int,
) -> list[Issue]:
    """校验角色 stable_info（role / arc_stage / language_fingerprint）。"""
    issues: list[Issue] = []

    for char_path, char_data in active_chars:
        basic = char_data.get("basic", {}) or {}
        name = basic.get("name") or char_data.get("character_id", "")
        if not name:
            continue

        # 4. basic.role —— P1（仅当主角 role=protagonist 但正文当 antagonist 叙述时）
        role = basic.get("role", "")
        if role == "protagonist":
            # 简单检测：主角在正文应出现 ≥ 1 次
            if name not in body and not any(a in body for a in basic.get("aliases", [])):
                issues.append(Issue(
                    severity="P1",
                    type="protected_layer_violation",
                    detail=(
                        f"主角 {name}（role=protagonist）在本章正文未出现。"
                        f"若本章是配角视角章，需在 flag 中豁免。"
                    ),
                    suggestion="确认本章是否应为配角视角章，或修正正文加入主角戏份",
                    extras={"sub_type": "characters", "field": "basic.role",
                            "character": name, "role": role},
                ))

        # 5. basic.name + aliases —— P2（拼写错误检测）
        # 简单实现：扫描正文中出现的疑似拼写错误（与 name 编辑距离 ≤ 2）
        # 此处略，留作 P2 增强点
        aliases = basic.get("aliases", []) or []
        all_known_names = [name] + aliases
        # 检测正文出现的 2-6 字名词，与 name 相似但不同
        # 简单实现：检测正文是否出现「<name> 师兄」「<name> 道友」等错误称呼
        # 此处略

        # 6. arc_stage —— P0
        arc_stage = char_data.get("arc_stage", "")
        if arc_stage:
            # 模板假设：arc_stage 取值为「觉醒期」「顿悟期」「突破期」「成熟期」等
            # 简单检测：若 arc_stage=「觉醒期」但正文出现「顿悟」「大彻大悟」等
            stage_signals = {
                "觉醒期": ("顿悟", "大彻大悟", "圆满", "超脱"),
                "顿悟期": ("圆满", "超脱", "大成"),
            }
            forbidden_signals = stage_signals.get(arc_stage, ())
            hits = [w for w in forbidden_signals if w in body]
            if hits:
                issues.append(Issue(
                    severity="P0",
                    type="protected_layer_violation",
                    detail=(
                        f"角色 {name} 当前 arc_stage=「{arc_stage}」，但本章正文出现"
                        f"超前阶段信号词：{hits}。"
                        f"若本章是突破前奏，需在 flag 中豁免并填 bypass_reason。"
                    ),
                    suggestion="修正正文使其符合角色当前 arc_stage，或更新状态机 arc_stage",
                    extras={"sub_type": "characters", "field": "arc_stage",
                            "character": name, "expected": arc_stage,
                            "violated_signals": hits},
                ))

        # 7. language_fingerprint.catchphrases —— P1
        lf = char_data.get("language_fingerprint", {}) or {}
        catchphrases = lf.get("catchphrases", []) or []
        if catchphrases and role == "protagonist":
            # 检测本章主角台词中是否使用至少一个 catchphrase
            # 简单实现：扫描「{name}道：「...」」「{name}说：「...」」段
            dialogue_pattern = re.compile(
                rf"{re.escape(name)}(?:道|说|笑道|喝道|怒道|叹道|问道|答道)[：:]\s*[「『]"
                rf"([^」』]+)[」』]"
            )
            dialogues = dialogue_pattern.findall(body)
            if dialogues:
                used = any(any(cp in d for cp in catchphrases) for d in dialogues)
                if not used:
                    issues.append(Issue(
                        severity="P1",
                        type="protected_layer_violation",
                        detail=(
                            f"角色 {name} 设定了 catchphrases={catchphrases}，"
                            f"但本章 {len(dialogues)} 段台词均未使用任何 catchphrase。"
                        ),
                        suggestion="在主角台词中加入至少一个 catchphrase",
                        extras={"sub_type": "characters", "field": "catchphrases",
                                "character": name, "catchphrases": catchphrases,
                                "dialogue_count": len(dialogues)},
                    ))

        # 8. language_fingerprint.forbidden_words —— P0
        forbidden_words = lf.get("forbidden_words", []) or []
        if forbidden_words:
            # 检测主角台词中是否出现 forbidden_words
            for fw in forbidden_words:
                # 简单实现：正文任意位置出现即报警（更精确应限定在台词内）
                if fw in body:
                    issues.append(Issue(
                        severity="P0",
                        type="protected_layer_violation",
                        detail=(
                            f"角色 {name} 的 forbidden_words 列表含「{fw}」，"
                            f"但本章正文出现该词。"
                        ),
                        suggestion=f"删除或替换正文中的「{fw}」",
                        extras={"sub_type": "characters", "field": "forbidden_words",
                                "character": name, "forbidden_word": fw},
                    ))
                    break  # 每个 char 只报一次 forbidden_words 违反

    return issues


def check_worldbuilding_core_rules(
    body: str,
    core_rules: list[dict[str, str]],
    chapter: int,
) -> list[Issue]:
    """校验 worldbuilding core_rules（每条规则的字面约束）。"""
    issues: list[Issue] = []
    for rule in core_rules:
        name = rule.get("name", "")
        desc = rule.get("description", "")
        if not desc:
            continue
        # 提取规则中的约束关键词
        # 模板假设：desc 含「不能 X」「禁止 X」「不可 X」等
        constraints = re.findall(
            r"(?:不能|禁止|不可|无法|严禁)\s*([^\s，。；！？]{2,12})",
            desc,
        )
        for constraint in constraints:
            if constraint in body:
                issues.append(Issue(
                    severity="P0",
                    type="protected_layer_violation",
                    detail=(
                        f"世界观规则「{name}」约束「不能{constraint}」被本章正文违反："
                        f"正文出现「{constraint}」相关描写。"
                        f"若正文是角色讨论规则（非违反），需在 flag 中豁免。"
                    ),
                    suggestion="修正正文使其符合世界观规则，或在 flag 中豁免",
                    extras={"sub_type": "worldbuilding", "field": "core_rules",
                            "rule_name": name, "constraint": constraint},
                ))

    return issues


def check_style_guide(
    body: str,
    style_text: str,
    chapter: int,
) -> list[Issue]:
    """校验 style_guide 禁用词表（P0 禁用词 / P2 控量词）。"""
    issues: list[Issue] = []
    p0_words, p2_words = _parse_style_guide_forbidden_words(style_text)

    # 10. P0 禁用词 —— P0
    for word in p0_words:
        # word 可能是正则模式（含 .* 等）
        if ".*" in word or "." in word:
            matches = re.findall(word, body)
            if matches:
                issues.append(Issue(
                    severity="P0",
                    type="protected_layer_violation",
                    detail=(
                        f"style_guide P0 禁用词模式「{word}」被本章正文违反："
                        f"匹配到 {matches[:3]}。"
                    ),
                    suggestion=f"删除或重写违反禁用词的段落",
                    extras={"sub_type": "style_guide", "field": "forbidden_words_p0",
                            "pattern": word, "matches": matches[:5]},
                ))
        else:
            if word in body:
                issues.append(Issue(
                    severity="P0",
                    type="protected_layer_violation",
                    detail=(
                        f"style_guide P0 禁用词「{word}」被本章正文违反。"
                    ),
                    suggestion=f"删除或替换正文中的「{word}」",
                    extras={"sub_type": "style_guide", "field": "forbidden_words_p0",
                            "forbidden_word": word},
                ))

    # 11. P2 控量词 —— P2（控量超限才报警）
    body_len = len(body)
    if body_len > 0:
        threshold_count = max(1, body_len // 1000 * STYLE_P2_THRESHOLD_PER_KCHAR)
        for word in p2_words:
            count = body.count(word)
            if count > threshold_count:
                issues.append(Issue(
                    severity="P2",
                    type="protected_layer_violation",
                    detail=(
                        f"style_guide P2 控量词「{word}」本章出现 {count} 次，"
                        f"超过阈值 {threshold_count} 次（{STYLE_P2_THRESHOLD_PER_KCHAR}/千字）。"
                    ),
                    suggestion=f"减少「{word}」的使用次数至阈值以下",
                    extras={"sub_type": "style_guide", "field": "controlled_words_p2",
                            "word": word, "count": count, "threshold": threshold_count},
                ))

    return issues


def check_hooks_status(
    body: str,
    hooks_registry: dict,
    chapter: int,
) -> list[Issue]:
    """校验 hooks_registry status（resolved 被重新当未解使用 / abandoned 被重新铺设）。"""
    issues: list[Issue] = []
    hooks = hooks_registry.get("hooks", []) if isinstance(hooks_registry, dict) else []
    for hook in hooks:
        if not isinstance(hook, dict):
            continue
        status = hook.get("status", "")
        hook_id = hook.get("hook_id", "?")
        description = hook.get("description", "")

        # 12. status=resolved 被正文重新当作未解谜题使用 —— P0
        if status == "resolved":
            # 简单检测：正文出现「{description 关键词} 是个谜」「未解之谜」等
            # 更精确：检测正文是否将该 hook 当作未解状态
            # 简单实现：检测正文是否出现「谜」「未解」「未知」与 hook 描述关键词共现
            keywords = re.findall(r"[\u4e00-\u9fa5]{2,6}", description)[:5]
            mystery_signals = ("谜", "未解", "未知", "悬而未决", "尚未揭晓")
            for kw in keywords:
                if kw in body:
                    # 检测关键词附近 50 字内是否有 mystery_signals
                    idx = body.find(kw)
                    context = body[max(0, idx - 50):idx + 50]
                    if any(sig in context for sig in mystery_signals):
                        issues.append(Issue(
                            severity="P0",
                            type="protected_layer_violation",
                            detail=(
                                f"伏笔 {hook_id}（status=resolved）被本章正文重新当作"
                                f"未解谜题使用：关键词「{kw}」附近出现「谜/未解」信号。"
                            ),
                            suggestion="删除将该伏笔当作未解的描述，或更新 hooks status",
                            extras={"sub_type": "hooks", "field": "status",
                                    "hook_id": hook_id, "status": status,
                                    "keyword": kw},
                        ))
                        break  # 每个 hook 只报一次

        # status=abandoned 被正文重新铺设 —— P0
        if status == "abandoned":
            # 检测正文是否出现该 hook 的关键词（被重新铺设）
            keywords = re.findall(r"[\u4e00-\u9fa5]{2,6}", description)[:5]
            for kw in keywords:
                if kw in body:
                    issues.append(Issue(
                        severity="P0",
                        type="protected_layer_violation",
                        detail=(
                            f"伏笔 {hook_id}（status=abandoned）被本章正文重新铺设："
                            f"正文出现关键词「{kw}」。"
                            f"若要重启该伏笔，需先用 hook-auditor 将 status 改回 planted。"
                        ),
                        suggestion="删除伏笔重铺描写，或用 hook-auditor 将 status 改回 planted",
                        extras={"sub_type": "hooks", "field": "status",
                                "hook_id": hook_id, "status": status,
                                "keyword": kw},
                    ))
                    break

    return issues


# ============================================================================
# 主校验函数
# ============================================================================
@dataclass
class ProtectedReport:
    """Protected 层强制校验报告。"""
    chapter: int
    subs_checked: list[str]
    issues: list[Issue] = field(default_factory=list)
    skipped: dict[str, str] = field(default_factory=dict)

    @property
    def p0_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "P0")

    @property
    def p1_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "P1")


def enforce(
    chapter: int,
    vault: str = DEFAULT_VAULT,
    subs: list[str] | None = None,
) -> ProtectedReport:
    """运行 Protected 层强制校验。

    Args:
        chapter: 章号（整数）。
        vault: Vault 根目录绝对路径。
        subs: 仅校验指定子维度列表；None 则全量校验。

    Returns:
        ``ProtectedReport`` 对象。

    Raises:
        FileNotFoundError: 章正文文件不存在。
    """
    vault_path = Path(vault).resolve()

    # 加载章正文（复用 check_consistency 的 load_chapter_text）
    # 卷号探测：从 pipeline.json
    pipeline = _safe_read_json(vault_path / ".state" / "pipeline.json")
    volume = pipeline.get("current_volume", 1) if isinstance(pipeline, dict) else 1

    body_text, _path = load_chapter_text(str(vault_path), volume, chapter)
    if body_text is None:
        raise FileNotFoundError(
            f"未找到第 {chapter} 章正文文件（卷 {volume}）。"
        )
    body = strip_frontmatter(body_text)

    # 加载 Protected 层字段
    intent_l0 = _read_author_intent_l0(vault_path)
    intent_fields = _parse_author_intent_fields(intent_l0)
    active_chars = _read_active_characters(vault_path, chapter)
    core_rules_text = _read_core_rules(str(vault_path))
    core_rules = _parse_core_rules(core_rules_text)
    style_text = _read_style_guide(str(vault_path))
    hooks_registry = _read_hooks_registry(str(vault_path))

    target_subs = subs if subs else list(ALL_SUBS)
    target_subs = [s for s in target_subs if s in ALL_SUBS]

    report = ProtectedReport(chapter=chapter, subs_checked=target_subs)

    for sub in target_subs:
        try:
            if sub == SUB_AUTHOR_INTENT:
                sub_issues = check_author_intent(body, intent_fields, chapter)
            elif sub == SUB_CHARACTERS:
                sub_issues = check_characters_stable_info(body, active_chars, chapter)
            elif sub == SUB_WORLDBUILDING:
                sub_issues = check_worldbuilding_core_rules(body, core_rules, chapter)
            elif sub == SUB_STYLE_GUIDE:
                sub_issues = check_style_guide(body, style_text, chapter)
            elif sub == SUB_HOOKS:
                sub_issues = check_hooks_status(body, hooks_registry, chapter)
            else:
                report.skipped[sub] = f"未知子维度: {sub}"
                continue
            report.issues.extend(sub_issues)
        except Exception as exc:  # noqa: BLE001 单子维度异常不阻断整体
            report.skipped[sub] = f"检测异常: {type(exc).__name__}: {exc}"

    return report


# ============================================================================
# 格式化输出
# ============================================================================
def format_report(report: ProtectedReport) -> str:
    """格式化人类可读报告。"""
    lines: list[str] = [
        f"=== Protected 层强制校验报告 ch_{report.chapter:03d} ===",
        f"校验子维度: {len(report.subs_checked)} ({'/'.join(report.subs_checked)})",
        f"P0 问题: {report.p0_count}{' (阻断保存)' if report.p0_count else ''}",
        f"P1 警告: {report.p1_count}{' (建议修复)' if report.p1_count else ''}",
        "",
    ]
    sev_emoji = {"P0": "🔴", "P1": "🟡", "P2": "⚪"}
    for issue in report.issues:
        emoji = sev_emoji.get(issue.severity, "⚪")
        sub_type = issue.extras.get("sub_type", "?")
        field = issue.extras.get("field", "?")
        lines.append(f"{emoji} [{issue.severity}] Protected 层违反 [{sub_type}/{field}]")
        for line in issue.detail.splitlines():
            lines.append(f"   {line}")
        lines.append(f"   建议: {issue.suggestion}")
        lines.append("")
    if report.skipped:
        lines.append("--- 跳过的子维度 ---")
        for sub, reason in report.skipped.items():
            lines.append(f"⏭️  {sub}: {reason}")
        lines.append("")
    if not report.issues:
        lines.append("✅ 通过：Protected 层全字段无违反")
    return "\n".join(lines)


def format_json(report: ProtectedReport) -> str:
    """格式化 JSON 输出（与 check_consistency.format_json 同构）。"""
    payload: dict[str, Any] = {
        "chapter": f"ch_{report.chapter:03d}",
        "subs_checked": report.subs_checked,
        "p0_count": report.p0_count,
        "p1_count": report.p1_count,
        "skipped": report.skipped,
        "issues": [
            {
                "severity": i.severity,
                "type": i.type,
                "detail": i.detail,
                "suggestion": i.suggestion,
                "extras": i.extras,
            }
            for i in report.issues
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ============================================================================
# CLI
# ============================================================================
def _parse_subs(sub_str: str) -> list[str]:
    """解析 --sub 参数（逗号分隔）。"""
    parts = [p.strip() for p in sub_str.split(",") if p.strip()]
    result: list[str] = []
    for p in parts:
        if p in ALL_SUBS:
            result.append(p)
        else:
            print(f"警告: 未知子维度 '{p}'，已忽略。可用: {ALL_SUBS}", file=sys.stderr)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.novelforge.enforce_protected_layer",
        description="NovelForge Protected 层强制校验（active enforcement）。",
    )
    parser.add_argument("--chapter", type=int, required=True, help="章号（整数）")
    parser.add_argument("--vault", default=DEFAULT_VAULT, help="Vault 根目录")
    parser.add_argument("--json", dest="as_json", action="store_true", help="JSON 输出")
    parser.add_argument("--strict", action="store_true", help="P0 退出码 1（CI 用）")
    parser.add_argument("--sub", default="", help="只校验指定子维度（逗号分隔）")
    args = parser.parse_args(argv)

    if args.chapter < 1:
        print("错误：--chapter 必须 >= 1", file=sys.stderr)
        return 2

    subs = _parse_subs(args.sub) if args.sub else None

    try:
        report = enforce(args.chapter, args.vault, subs)
    except FileNotFoundError as e:
        print(f"[FAIL] {e}", file=sys.stderr)
        return 2

    if args.as_json:
        print(format_json(report))
    else:
        print(format_report(report))

    if args.strict and report.p0_count > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 5.4 步骤 4 · state-consistency-checker SKILL.md 升级后的完整内容

修改 file:///workspace/.trae/skills/state-consistency-checker/SKILL.md，**新增「第四阶段：强制验证」**段落（在 M2 升级后的「与 save_state.py 的 flag 协议」段落之后、「与 drift-detector 的边界声明」段落之前插入）：

```markdown
# 第四阶段：强制验证（M7 active enforcement 升级新增）

> 本阶段是 M7 模块的增量能力。M2 之后，flag 协议已接入 save_state.py 入口处，P0 一致性问题物理阻断保存。M7 在此基础上扩展为 active enforcement 层：除了 check_consistency.py 的 7 类检测（character_state 字段），还强制对照 Protected 层全字段（author_intent L0 / characters stable_info / worldbuilding core_rules / style_guide 禁用词表 / hooks_registry status）做主动校验，弥补 7 类检测不覆盖 Protected 层的盲区。

## 触发条件

`writer-polisher` 阶段四「状态更新」第 0 步强制触发（在 save_state.py 之前）。**P0 Protected 违反未修复前禁止 save_state**。这是 M7 在 M2 之上的硬性门禁，不可跳过。

## 与 enforce_protected_layer.py 的关系

| 维度 | enforce_protected_layer.py | state-consistency-checker Skill |
|---|---|---|
| 定位 | 脚本实现，5 个子维度校验函数 | Prompt 入口 |
| 检测逻辑 | 已实现 5 子维度（author_intent / characters / worldbuilding / style_guide / hooks） | 不重写，只调用 |
| 输出 | JSON / 人类可读报告 | 解读 + 修复建议 |
| 触发 | 需手工敲命令 | 引导主 Agent 在阶段四第 0 步调用 |

类比：本 Skill 之于 `enforce_protected_layer.py`，即 `hook-auditor` 之于 `audit_hooks.py`，即本 Skill 之于 `check_consistency.py`。检测判定规则变更改脚本，不改 Skill。

## 调用脚本

### 强制校验单章（默认人类可读报告）

```bash
python -m scripts.novelforge.enforce_protected_layer --chapter {NNN}
```

### JSON 输出（Skill 解析用，推荐）

```bash
python -m scripts.novelforge.enforce_protected_layer --chapter {NNN} --json
```

### 严格模式（P0 退出码 1，CI 用）

```bash
python -m scripts.novelforge.enforce_protected_layer --chapter {NNN} --strict
```

### 只校验指定子维度

```bash
python -m scripts.novelforge.enforce_protected_layer --chapter {NNN} --sub author_intent,characters
```

可用子维度：`author_intent` / `characters` / `worldbuilding` / `style_guide` / `hooks`。

JSON 输出关键字段：`p0_count` / `p1_count` / `issues[]`（每条含 `severity` / `type` / `detail` / `suggestion` / `extras`，其中 `extras.sub_type` 区分子维度，`extras.field` 区分字段）/ `skipped` / `subs_checked`。

## 5 类 Protected 违反解读指南

| sub_type | 中文 | 字段示例 | 默认级别 |
|---|---|---|---|
| author_intent | 作者意图违反 | protagonist_arc / world_core / style_tone | P0/P0/P1 |
| characters | 角色稳定属性违反 | basic.role / arc_stage / catchphrases / forbidden_words | P1/P0/P1/P0 |
| worldbuilding | 世界观规则违反 | core_rules | P0 |
| style_guide | 风格禁用词违反 | forbidden_words_p0 / controlled_words_p2 | P0/P2 |
| hooks | 伏笔状态违反 | status=resolved 被重新当未解 / status=abandoned 被重新铺设 | P0 |

### 1. author_intent · protagonist_arc（主角弧光违反，P0）

**含义**：author_intent L0 摘要的「主角弧光」字段要求某方向（如「复仇→宽恕」），但本章正文出现与弧光冲突的信号词（如「复仇/报仇/血债血偿」）。
**修复方向**：
1. 改本章正文：修正主角动机描述以匹配弧光。
2. 在 flag 中豁免：填 `bypass_reason="本章是弧光转折前的低谷"`，但 P0 不可豁免，需先修正 arc_stage 或调整 author_intent L0。

### 2. author_intent · world_core（世界观核心违反，P0）

**含义**：author_intent L0 摘要的「世界观核心」字段含「不能 X」约束，但本章正文出现「X」相关描写。
**修复方向**：
1. 改本章正文：删除违反约束的描写。
2. 在 flag 中豁免：填 `bypass_reason="本章是角色讨论规则而非违反"`，但 P0 不可豁免，需修正正文表述。

### 3. characters · arc_stage（角色弧光阶段违反，P0）

**含义**：角色状态机 `arc_stage=觉醒期`，但本章正文出现超前阶段信号词（如「顿悟/大彻大悟/圆满」）。
**修复方向**：
1. 改本章正文：删除超前阶段信号词。
2. 改状态机：用 `save_state.py` 更新 `arc_stage`（若本章确实发生了阶段跃迁，需补铺垫场景）。
3. 在 flag 中豁免：填 `bypass_reason="本章是突破前奏"`，但 P0 不可豁免。

### 4. characters · forbidden_words（角色禁用词违反，P0）

**含义**：角色 `language_fingerprint.forbidden_words` 列表含某词，但本章正文出现该词。
**修复方向**：
1. 改本章正文：删除或替换该词。

### 5. worldbuilding · core_rules（世界观规则违反，P0）

**含义**：`01_世界观/core_rules.md` 的某条规则含「不能 X」约束，但本章正文出现「X」相关描写。
**修复方向**：同 author_intent · world_core。

### 6. style_guide · forbidden_words_p0（P0 禁用词违反，P0）

**含义**：`style_guide.md` 的 P0 禁用词表含某词或模式，但本章正文出现。
**修复方向**：删除或重写违反禁用词的段落。

### 7. hooks · status（伏笔状态违反，P0）

**含义**：`status=resolved` 的伏笔被本章正文重新当作未解谜题使用；或 `status=abandoned` 的伏笔被本章正文重新铺设。
**修复方向**：
1. 改本章正文：删除将该伏笔当作未解/重铺的描写。
2. 改状态机：用 `hook-auditor` 更新 `status`（若确实要重启该伏笔，需先改 `status=planted`）。

## P0/P1 处置流程（M7 升级版）

```
enforce_protected_layer.py --chapter {NNN} --json
  │
  ├─ 解析报告：p0_count / p1_count / issues[]
  │
  ├─ 有 P0 Protected 违反？（p0_count > 0）
  │   ├─ 是 → 🔴 转 flag 文件（与 check_consistency 共用 flags_ch{NNN}.json）
  │   │        → 阻断 save_state.py（M2 入口处 _check_flags raise）
  │   │        → 按 5 类解读指南给出修复建议
  │   │        → 作者修复后重跑 enforce_protected_layer.py
  │   │        → 直到 p0_count = 0
  │   └─ 否 → 进入 P1 检查
  │
  ├─ 有 P1 Protected 违反？（p1_count > 0）
  │   ├─ 是 → 🟡 转 flag 文件（can_bypass=true，待作者填 bypass_reason）
  │   │        → 作者决定：修复 / 豁免（写 bypass_reason）
  │   └─ 否 → ✅ 通过
  │
  └─ 与 check_consistency.py 的 flag 合并 → 允许 save_state.py
```

## flag 文件合并策略

state-consistency-checker 跑完 `check_consistency.py` 与 `enforce_protected_layer.py` 后，**两个脚本的 issues 合并写入同一个 flag 文件** `.state/.lock/flags_ch{NNN}.json`：

```python
# 伪代码
consistency_report = check_consistency.check_all(chapter, vault)  # 8 类（含 protected_layer_violation 薄包装）
protected_report = enforce_protected_layer.enforce(chapter, vault)  # 详细 Protected 层校验

all_issues = consistency_report.issues + protected_report.issues
# 去重：同 type+同 extras.sub_type+同 extras.field 视为重复，保留详细版（enforce_protected_layer 输出）

flags = [issue_to_flag(issue, chapter) for issue in all_issues]
write_flag_file(vault, chapter, flags)
```

## 工作流（M7 升级后，原 7 步扩展为 8 步）

1. **识别意图**：强制触发 / 手动触发 / 批量触发。
2. **确定章号**：单章 `{NNN}` 或范围 `{start}-{end}`。
3. **调用 check_consistency.py**：`python -m scripts.novelforge.check_consistency --chapter {NNN} --json`（8 类检测，含第 10 类 protected_layer_violation 薄包装）。
4. **【M7 新增】调用 enforce_protected_layer.py**：`python -m scripts.novelforge.enforce_protected_layer --chapter {NNN} --json`（5 子维度详细校验）。
5. **解析两份 JSON**：合并 issues，去重。
6. **P0 处置**：若合并后 `p0_count > 0`，按解读指南给修复建议，阻断 save_state，等作者修复后重跑。
7. **P1 处置**：若 `p1_count > 0`，给修复建议；作者选择忽略则引导写 `b1_waiver.log` 与 flag `bypass_reason`。
8. **通过**：`p0_count = 0` → 合并 flag 文件 → 允许 `save_state.py`。
```

并在文件末尾「反模式（禁止）」列表新增：

```markdown
- 不跑 enforce_protected_layer 就允许 save_state —— M7 之后，writer-polisher 阶段四第 0 步必须先跑强制验证。即使 check_consistency.py 的 7 类全通过，Protected 层违反（如 author_intent 主角弧光冲突、worldbuilding 规则违反）仍可能存在，必须 enforce_protected_layer.py 也通过才允许 save_state。
- 不去重就合并 flag —— check_consistency.py 的 protected_layer_violation（薄包装）与 enforce_protected_layer.py 的 detailed issues 可能重复，必须按 sub_type+field 去重，避免同一问题在 flag 文件中出现两次。
- 把 P1 Protected 违反当 P0 处理 —— author_intent.style_tone / characters.role / characters.catchphrases 是 P1，允许豁免（需 bypass_reason）；只有 author_intent.protagonist_arc / world_core / characters.arc_stage / forbidden_words / worldbuilding.core_rules / style_guide.forbidden_words_p0 / hooks.status 是 P0，不可豁免。
```

并在「Skill 元信息」中追加：

```markdown
- **依赖脚本（M7 新增）**：`scripts/novelforge/enforce_protected_layer.py`（Protected 层强制校验）
- **关联 Skill（M7 升级）**：`writer-polisher` 阶段四第 0 步强制走 enforcement；`context-composer` 的 Protected 层定义是 enforce_protected_layer 的输入规范（不修改 context-composer 本身）
```

### 5.5 步骤 5 · writer-polisher SKILL.md 四阶段流水线升级

修改 file:///workspace/.trae/skills/writer-polisher/SKILL.md，**在阶段四「状态更新」第 1 步之前插入「第 0 步：强制验证」**：

```markdown
## 阶段四：状态更新（State Updater）

> shortform 模式跳过本阶段，直接进入反馈。
> **M7 升级**：在原第 1 步「提取本章状态变更」之前，强制插入「第 0 步：强制验证」，跑 enforce_protected_layer.py，P0 Protected 违反未修复前禁止 save_state。

### 第 0 步：强制验证（M7 新增）

调用 enforce_protected_layer.py 对本章正文做 Protected 层强制校验：

```bash
python -m scripts.novelforge.enforce_protected_layer --chapter <N> --json
```

解读 5 类 Protected 违反（详见 `state-consistency-checker` Skill 的「5 类 Protected 违反解读指南」）：

| sub_type | 字段 | 优先级 | 检测内容 |
|---|---|---|---|
| author_intent | protagonist_arc | P0 | 正文主角动机与弧光描述冲突 |
| author_intent | world_core | P0 | 正文违反世界观核心约束 |
| author_intent | style_tone | P1 | 正文风格与基调描述偏离 |
| characters | basic.role | P1 | 主角 role=protagonist 但本章未出现 |
| characters | arc_stage | P0 | 正文出现超前阶段信号词 |
| characters | catchphrases | P1 | 主角台词未使用任何设定 catchphrase |
| characters | forbidden_words | P0 | 正文出现角色 forbidden_words 列表中的词 |
| worldbuilding | core_rules | P0 | 正文违反 core_rules.md 规则约束 |
| style_guide | forbidden_words_p0 | P0 | 正文出现 P0 禁用词 |
| style_guide | controlled_words_p2 | P2 | 控量词超量 |
| hooks | status | P0 | resolved 被当未解 / abandoned 被重新铺设 |

**P0 阻断**：若 enforce_protected_layer.py 报 P0，禁止 save_state，返回阶段三精修，定点修复后重跑。重跑 3 次仍有 P0，暂停向用户报告问题清单，请求人工介入。

**P1 豁免**：若 enforce_protected_layer.py 报 P1，作者可选择豁免（写 bypass_reason），允许 save_state。

**全通过**：与 check_consistency.py 的 flag 合并写入 `.state/.lock/flags_ch{NNN}.json`，进入第 1 步。

### 第 1 步：提取本章状态变更

（原内容不变）
```

并在「错误处理」表中新增：

```markdown
| enforce_protected_layer 检出 P0 | 阻断 save_state，返回阶段三精修，定点修复后重跑 |
| enforce_protected_layer 检出 P1 | 警告，作者可选择修复或豁免（写 bypass_reason） |
```

并在「输出格式」中追加 enforcement 检查行：

```markdown
🔍 审计：
  一致性：7 维度检测，P0=0 P1=1（伏笔遗忘 H-014，建议下章提醒）
  Protected：5 子维度校验，P0=0 P1=1（characters.catchphrases 主角未用「本座」，已修复）
  去 AI 味：10 维度检测，P0=0 P1=0 P2=2（心理描写悬空 2 处，已修复）
```

### 5.6 步骤 6 · check_consistency.py 新增 protected_layer_violation 检测

修改 file:///workspace/scripts/novelforge/check_consistency.py，**新增第 10 类检测 `protected_layer_violation`**（薄包装，内部调用 enforce_protected_layer 的核心函数）：

#### 5.6.1 修改 ALL_DIMENSIONS 与 DIM_LABELS

在第 182-190 行 `ALL_DIMENSIONS` 列表末尾追加：

```python
# 全部维度 type 名（按检测顺序）
ALL_DIMENSIONS: list[str] = [
    "power_level_jump",
    "phantom_item",
    "relationship_mutation",
    "location_jump",
    "foreshadow_forgetting",
    "character_revival",
    "golden_finger_overreach",
    "protected_layer_violation",  # M7 新增：第 10 类
]
```

在第 193-201 行 `DIM_LABELS` 字典末尾追加：

```python
# 维度中文标签（用于人类可读报告）
DIM_LABELS: dict[str, str] = {
    "power_level_jump": "境界跳级",
    "phantom_item": "物品凭空",
    "relationship_mutation": "关系突变",
    "location_jump": "位置穿越",
    "foreshadow_forgetting": "伏笔遗忘",
    "character_revival": "角色复生",
    "golden_finger_overreach": "金手指越界",
    "protected_layer_violation": "Protected 层违反",  # M7 新增
}
```

在第 163-179 行 `DIM_ALIASES` 字典末尾追加：

```python
    "golden_finger": "golden_finger_overreach",
    "protected": "protected_layer_violation",  # M7 新增短名
    "protected_layer": "protected_layer_violation",
    "protected_layer_violation": "protected_layer_violation",
```

#### 5.6.2 新增 check_protected_layer_violation 函数

在第 1063-1211 行 `check_golden_finger_overreach` 函数之后插入新函数（薄包装）：

```python
def check_protected_layer_violation(
    body: str,
    states: dict[str, dict[str, Any]],
    hooks: list[dict[str, Any]],
    chapter: int,
    vault: str = DEFAULT_VAULT,
) -> tuple[list[Issue], str | None]:
    """第 10 类检测：Protected 层违反（薄包装，调 enforce_protected_layer 核心函数）。

    M7 模块新增。本函数是 check_consistency 与 enforce_protected_layer 之间的薄包装：
    - 不重新实现 Protected 层字段解析与校验逻辑
    - import enforce_protected_layer 的核心函数（enforce()）
    - 把 ProtectedReport.issues 转为本脚本的 Issue 列表
    - 失败时降级为 skip（不阻断整体检测）

    Args:
        body: 本章正文（已 strip frontmatter）。
        states: 角色状态 dict（本函数不直接使用，但保持签名一致）。
        hooks: 伏笔列表（本函数不直接使用）。
        chapter: 章号。
        vault: Vault 根目录（用于 enforce_protected_layer 加载 Protected 层字段）。

    Returns:
        (issues, skip_reason) 二元组。
        skip_reason 非 None 表示该维度被跳过（如 enforce_protected_layer 不可用）。
    """
    try:
        # 延迟 import 避免循环依赖
        try:
            from .enforce_protected_layer import enforce as _enforce
        except ImportError:
            from scripts.novelforge.enforce_protected_layer import (  # type: ignore
                enforce as _enforce,
            )

        protected_report = _enforce(chapter, vault)
        # 直接复用 ProtectedReport.issues（Issue 数据结构同构）
        return (protected_report.issues, None)
    except ImportError as e:
        return ([], f"enforce_protected_layer 模块不可用: {e}")
    except Exception as e:  # noqa: BLE001
        return ([], f"检测异常: {type(e).__name__}: {e}")
```

#### 5.6.3 修改 check_all 的 for 循环

在第 1272-1288 行的 for 循环中追加 `elif dim == "protected_layer_violation"` 分支：

```python
    for dim in target_dims:
        try:
            if dim == "phantom_item":
                issues, skip = check_phantom_item(body, states, vault)
            elif dim == "location_jump":
                issues, skip = check_location_jump(body, states, vault)
            elif dim == "protected_layer_violation":
                # M7 新增：薄包装调 enforce_protected_layer
                issues, skip = check_protected_layer_violation(
                    body, states, hooks, chapter, vault
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

#### 5.6.4 修改 schema.py 的 FLAG_SCHEMA rule enum

修改 file:///workspace/scripts/novelforge/schema.py 的 `FLAG_SCHEMA.properties.rule.enum`（M2 第 211-217 行），追加第 8 个 rule：

```python
"rule": {
    "type": "string",
    "description": "触发的检测规则名，对应 Issue.type",
    "enum": [
        "power_level_jump", "phantom_item", "location_jump",
        "character_revival", "relationship_mutation",
        "foreshadow_forgetting", "golden_finger_overreach",
        "protected_layer_violation",  # M7 新增
    ],
},
```

同步修改 `validate_flags` 函数（M2 第 272-306 行）的 `valid_rules` 集合：

```python
valid_rules = {
    "power_level_jump", "phantom_item", "location_jump",
    "character_revival", "relationship_mutation",
    "foreshadow_forgetting", "golden_finger_overreach",
    "protected_layer_violation",  # M7 新增
}
```

---

## 六、验证方式

### 6.1 单元测试

```bash
pytest -q tests/test_active_enforcement.py
```

期望：6 个用例全部通过（详见 §七）。

### 6.2 集成测试 1 · 故意生成包含矛盾的章节，验证 enforcement 阻断保存

```bash
# Step 1：构造一个违反 Protected 层的章节正文
mkdir -p NovelForge_Vault/05_正文/drafts/vol_01
cat > NovelForge_Vault/05_正文/drafts/vol_01/ch_099.md <<'EOF'
# 第 99 章 测试章

林渊道：「我要复仇，血债血偿！」他挥剑斩向赵师兄，眼中满是杀意。
这是复仇的存在，一种杀意的感觉。
EOF

# Step 2：构造 author_intent L0 含「宽恕」弧光
mkdir -p NovelForge_Vault/00_控制面
cat > NovelForge_Vault/00_控制面/author_intent.md <<'EOF'
# 创作意图

> 全局锚点

---

## L0 摘要版

### 主角弧光
从复仇走向宽恕，最终放下执念

### 世界观核心
修仙者不能复活死人

### 风格基调
冷峻克制

---

## L2 全文

（略）
EOF

# Step 3：跑 enforce_protected_layer
python -m scripts.novelforge.enforce_protected_layer --chapter 99 --strict
echo "Exit code: $?"

# Step 4：生成 flag 文件（手动模拟 state-consistency-checker）
python - <<'PY'
import json, os
from scripts.novelforge.enforce_protected_layer import enforce
report = enforce(99, "/workspace/NovelForge_Vault")
flags = []
for i, issue in enumerate(report.issues, 1):
    flags.append({
        "flag_id": f"F-ch099-{i:03d}",
        "severity": issue.severity,
        "chapter": "ch_099",
        "rule": issue.type,
        "message": issue.detail,
        "can_bypass": issue.severity != "P0",
        "bypass_reason": None if issue.severity == "P0" else "",
        "suggestion": issue.suggestion,
        "extras": issue.extras,
        "created_at": "2026-07-18T16:00:00",
    })
os.makedirs("NovelForge_Vault/.state/.lock", exist_ok=True)
with open("NovelForge_Vault/.state/.lock/flags_ch099.json", "w", encoding="utf-8") as f:
    json.dump({
        "chapter": "ch_099",
        "generated_at": "2026-07-18T16:00:00",
        "check_consistency_version": "1.0",
        "flags": flags,
    }, f, ensure_ascii=False, indent=2)
print(f"Generated {len(flags)} flags, P0={sum(1 for f in flags if f['severity']=='P0')}")
PY

# Step 5：尝试 save_state，期望被 P0 阻断
echo '{"chapter":"ch_099","ops":[{"op":"set","path":"pipeline/current_chapter","value":99}]}' > /tmp/delta_ch099.json
python -m scripts.novelforge.save_state --delta /tmp/delta_ch099.json --no-commit
echo "Exit code: $?"

# Step 6：清理
rm -f NovelForge_Vault/.state/.lock/flags_ch099.json
rm -f NovelForge_Vault/05_正文/drafts/vol_01/ch_099.md
```

**断言**：
- Step 3 退出码 1（`--strict` 模式 P0 阻断）
- Step 3 stdout 含「Protected 层违反 [author_intent/protagonist_arc]」与「复仇」「宽恕」
- Step 5 退出码非 0，stderr 含「P0 一致性问题，阻断 save_state」

### 6.3 集成测试 2 · 正常章节，验证 enforcement 通过

```bash
# Step 1：构造一个不违反 Protected 层的章节正文
cat > NovelForge_Vault/05_正文/drafts/vol_01/ch_098.md <<'EOF'
# 第 98 章 测试章

林渊道：「本座已悟，过往恩怨可放下。」他收剑入鞘，望向远方。
EOF

# Step 2：跑 enforce_protected_layer
python -m scripts.novelforge.enforce_protected_layer --chapter 98 --strict
echo "Exit code: $?"

# Step 3：清理
rm -f NovelForge_Vault/05_正文/drafts/vol_01/ch_098.md
```

**断言**：
- 退出码 0
- stdout 含「✅ 通过：Protected 层全字段无违反」

### 6.4 断言清单

| # | 断言 | 验证方式 |
|---|---|---|
| 1 | enforce_protected_layer.py 可独立运行 | `test_enforce_protected_layer_runs` |
| 2 | characters stable_info 违反（arc_stage 超前）被检测为 P0 | `test_protected_layer_blocks_character_stable_info_violation` |
| 3 | worldbuilding core_rules 违反被检测为 P0 | `test_protected_layer_blocks_worldbuilding_violation` |
| 4 | style_guide P0 禁用词违反被检测为 P0 | `test_protected_layer_blocks_style_guide_violation` |
| 5 | 正常章节（不违反 Protected 层）enforcement 通过 | `test_normal_chapter_passes_enforcement` |
| 6 | writer-polisher 阶段四第 0 步会调 enforce_protected_layer | `test_writer_polisher_invokes_enforcement`（断言 SKILL.md 含「第 0 步：强制验证」段落） |
| 7 | check_consistency.py 第 10 类 protected_layer_violation 检测可运行 | `python -m scripts.novelforge.check_consistency --chapter <N> --dim protected_layer_violation --json` 退出码 0 |
| 8 | FLAG_SCHEMA.rule enum 含 protected_layer_violation | `test_flag_schema_includes_protected_rule`（可选，已在 M2 测试覆盖） |
| 9 | Protected 层关键字段全覆盖（5 子维度 × 12 字段） | 集成测试 1 + 2 |
| 10 | P0 矛盾必阻断 save_state | 集成测试 1 Step 5 |
| 11 | 正常章节通过 enforcement 不阻断 save_state | 集成测试 2 |

### 6.5 与现有校验脚本的关系

- **不冲突** `check_consistency.py` 7 类检测：第 10 类是薄包装，独立维度，不修改既有 7 类逻辑
- **不冲突** `check_ai_novel.py`：去 AI 味检测独立运行；style_guide P0 禁用词在 enforce_protected_layer 中只做 Protected 层视角的二次校验，不与 check_ai_novel 重复（check_ai_novel 关注 AI 翻译腔等 10 类，enforce_protected_layer 关注 style_guide 禁用词表的对照）
- **不冲突** M2 flag 协议：M7 复用 M2 的 `_check_flags` 入口与 `FLAG_SCHEMA`，只追加 rule enum 第 8 项
- **强化** `state-consistency-checker` Skill：从「被动消费 check_consistency.py 输出」升级为「主动调用 enforce_protected_layer.py 做 Protected 层全字段校验」

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

文件：file:///workspace/tests/test_active_enforcement.py

```python
"""NovelForge M7 active enforcement 回归测试。

覆盖：
- enforce_protected_layer.py 脚本可独立运行
- characters stable_info（arc_stage / forbidden_words）违反被检测为 P0
- worldbuilding core_rules 违反被检测为 P0
- style_guide P0 禁用词违反被检测为 P0
- 正常章节通过 enforcement
- writer-polisher SKILL.md 已升级（阶段四第 0 步强制验证）
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

# 复用 NovelForge 包
WORKSPACE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WORKSPACE))

from scripts.novelforge.enforce_protected_layer import (  # noqa: E402
    enforce,
    format_json,
    SUB_AUTHOR_INTENT,
    SUB_CHARACTERS,
    SUB_WORLDBUILDING,
    SUB_STYLE_GUIDE,
    SUB_HOOKS,
)
from scripts.novelforge.check_consistency import (  # noqa: E402
    ALL_DIMENSIONS,
    DIM_LABELS,
    check_protected_layer_violation,
)


# ============================================================================
# 测试夹具：构造一个临时 Vault
# ============================================================================
@pytest.fixture
def temp_vault(tmp_path: Path) -> Path:
    """构造一个临时 Vault，含 Protected 层所需的最小文件集。"""
    vault = tmp_path / "vault"
    # 创建目录结构
    (vault / "00_控制面").mkdir(parents=True)
    (vault / "01_世界观").mkdir(parents=True)
    (vault / "04_大纲与脉络").mkdir(parents=True)
    (vault / "05_正文" / "drafts" / "vol_01").mkdir(parents=True)
    (vault / ".state" / "characters").mkdir(parents=True)
    (vault / ".state" / ".lock").mkdir(parents=True)

    # author_intent.md
    (vault / "00_控制面" / "author_intent.md").write_text(
        "# 创作意图\n\n> 全局锚点\n\n---\n\n"
        "## L0 摘要版\n\n"
        "### 主角弧光\n从复仇走向宽恕，最终放下执念\n\n"
        "### 世界观核心\n修仙者不能复活死人\n\n"
        "### 风格基调\n冷峻克制\n\n---\n\n## L2 全文\n\n（略）\n",
        encoding="utf-8",
    )

    # style_guide.md
    (vault / "00_控制面" / "style_guide.md").write_text(
        "# 风格指南\n\n"
        "## 禁用词\n\n"
        "| 词/短语 | 等级 | 适用 |\n"
        "|---|---|---|\n"
        "| yyds | P0 | 全文禁 |\n"
        "| 破防 | P0 | 全文禁 |\n"
        "| 宛如 | P2 | ≤ 2 次/千字 |\n\n",
        encoding="utf-8",
    )

    # core_rules.md
    (vault / "01_世界观" / "core_rules.md").write_text(
        "# 世界观核心规则\n\n"
        "## 规则：金丹期不可飞升\n"
        "金丹期修士不能飞升，必须先凝结元婴。\n\n"
        "## 规则：禁制不可穿越\n"
        "禁制之力不可穿越，必须先破禁。\n\n",
        encoding="utf-8",
    )

    # hooks_registry.json
    (vault / "04_大纲与脉络" / "hooks_registry.json").write_text(
        json.dumps({
            "version": "1.0.0",
            "hooks": [
                {
                    "hook_id": "H-001",
                    "description": "主角身世之谜",
                    "status": "resolved",
                    "planted_ch": 1,
                },
                {
                    "hook_id": "H-002",
                    "description": "玄铁剑下落",
                    "status": "abandoned",
                    "planted_ch": 5,
                },
            ],
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # pipeline.json
    (vault / ".state" / "pipeline.json").write_text(
        json.dumps({
            "current_chapter": 99,
            "current_volume": 1,
            "mode": "novel",
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # 主角状态机
    (vault / ".state" / "characters" / "protagonist.json").write_text(
        json.dumps({
            "character_id": "protagonist",
            "basic": {"name": "林渊", "aliases": ["林少侠"], "role": "protagonist"},
            "location": {"current": "青云宗", "last_updated_ch": 99},
            "power_level": {"realm": "练气", "realm_progress": 0,
                            "abilities": [], "limitations": [], "next_breakthrough": {}},
            "inventory": [],
            "emotion": {"current": "警惕", "last_updated_ch": 99},
            "relationships": [],
            "arc_stage": "觉醒期",
            "language_fingerprint": {
                "avg_sentence_length": 12,
                "preferred_words": [],
                "catchphrases": ["本座"],
                "forbidden_words": ["吾辈"],
                "address_habits": {},
            },
            "last_appeared_ch": 99,
            "first_appear_ch": 1,
            "status": "active",
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return vault


def _write_chapter(vault: Path, chapter: int, body: str) -> None:
    """写入章节正文到 drafts/vol_01/ch_NNN.md。"""
    path = vault / "05_正文" / "drafts" / "vol_01" / f"ch_{chapter:03d}.md"
    path.write_text(f"# 第 {chapter} 章 测试章\n\n{body}\n", encoding="utf-8")


# ============================================================================
# 1. enforce_protected_layer 可独立运行
# ============================================================================
def test_enforce_protected_layer_runs(temp_vault: Path):
    """脚本可独立运行，无异常则通过。"""
    _write_chapter(temp_vault, 99, "林渊道：「本座已悟。」他收剑入鞘。")
    report = enforce(99, str(temp_vault))
    assert report.chapter == 99
    assert set(report.subs_checked) == {
        SUB_AUTHOR_INTENT, SUB_CHARACTERS, SUB_WORLDBUILDING,
        SUB_STYLE_GUIDE, SUB_HOOKS,
    }
    # 正常章节应无 P0
    assert report.p0_count == 0


# ============================================================================
# 2. characters stable_info（arc_stage）违反被检测为 P0
# ============================================================================
def test_protected_layer_blocks_character_stable_info_violation(temp_vault: Path):
    """arc_stage=觉醒期 但正文出现「顿悟」→ P0。"""
    _write_chapter(
        temp_vault, 99,
        "林渊忽然顿悟，大彻大悟，他终于明白了修仙的真谛。"
        "本座已悟，过往恩怨可放下。"
    )
    report = enforce(99, str(temp_vault), subs=[SUB_CHARACTERS])
    p0_issues = [i for i in report.issues if i.severity == "P0"
                 and i.extras.get("sub_type") == "characters"
                 and i.extras.get("field") == "arc_stage"]
    assert len(p0_issues) >= 1, "应检测到 arc_stage 违反（P0）"
    assert "顿悟" in p0_issues[0].detail or "大彻大悟" in p0_issues[0].detail


# ============================================================================
# 3. worldbuilding core_rules 违反被检测为 P0
# ============================================================================
def test_protected_layer_blocks_worldbuilding_violation(temp_vault: Path):
    """core_rules 含「金丹期不能飞升」但正文出现飞升 → P0。"""
    _write_chapter(
        temp_vault, 99,
        "林渊金丹期圆满，竟直接飞升仙界，令众人震惊。"
        "本座已悟，过往恩怨可放下。"
    )
    report = enforce(99, str(temp_vault), subs=[SUB_WORLDBUILDING])
    p0_issues = [i for i in report.issues if i.severity == "P0"
                 and i.extras.get("sub_type") == "worldbuilding"]
    assert len(p0_issues) >= 1, "应检测到 worldbuilding 违反（P0）"
    assert "飞升" in p0_issues[0].detail or "金丹" in p0_issues[0].detail


# ============================================================================
# 4. style_guide P0 禁用词违反被检测为 P0
# ============================================================================
def test_protected_layer_blocks_style_guide_violation(temp_vault: Path):
    """style_guide P0 禁用词「yyds」出现在正文 → P0。"""
    _write_chapter(
        temp_vault, 99,
        "林渊道：「本座已悟。」这yyds的招式震惊了所有人。"
    )
    report = enforce(99, str(temp_vault), subs=[SUB_STYLE_GUIDE])
    p0_issues = [i for i in report.issues if i.severity == "P0"
                 and i.extras.get("sub_type") == "style_guide"]
    assert len(p0_issues) >= 1, "应检测到 style_guide P0 禁用词违反"
    assert "yyds" in p0_issues[0].detail


# ============================================================================
# 5. 正常章节通过 enforcement
# ============================================================================
def test_normal_chapter_passes_enforcement(temp_vault: Path):
    """正常章节（不违反 Protected 层）→ 全通过，P0=0 P1=0。"""
    _write_chapter(
        temp_vault, 99,
        "林渊道：「本座已悟，过往恩怨可放下。」他收剑入鞘，望向远方青云宗山门。"
        "身后传来一阵风声，吹动他的衣袍。"
    )
    report = enforce(99, str(temp_vault))
    assert report.p0_count == 0, f"正常章节不应有 P0，但报了：{report.issues}"
    # P1 可能有 catchphrases 检测，但本例主角用了「本座」，应不报
    # 允许有 P2（控量词未超量也不报）
    json_output = format_json(report)
    parsed = json.loads(json_output)
    assert parsed["p0_count"] == 0


# ============================================================================
# 6. writer-polisher SKILL.md 已升级（阶段四第 0 步强制验证）
# ============================================================================
def test_writer_polisher_invokes_enforcement():
    """断言 writer-polisher SKILL.md 含「第 0 步：强制验证」段落。"""
    skill_path = WORKSPACE / ".trae" / "skills" / "writer-polisher" / "SKILL.md"
    text = skill_path.read_text(encoding="utf-8")

    # 应包含「第 0 步：强制验证」标题
    assert "第 0 步：强制验证" in text or "第0步：强制验证" in text, (
        "writer-polisher SKILL.md 应在阶段四新增「第 0 步：强制验证」段落"
    )
    # 应引用 enforce_protected_layer
    assert "enforce_protected_layer" in text, (
        "writer-polisher SKILL.md 应引用 enforce_protected_layer.py 脚本"
    )
    # 应包含 M7 标记
    assert "M7" in text, "writer-polisher SKILL.md 应标注 M7 升级"


# ============================================================================
# 7. check_consistency.py 第 10 类 protected_layer_violation 已注册
# ============================================================================
def test_check_consistency_has_protected_dimension():
    """断言 ALL_DIMENSIONS 含 protected_layer_violation，DIM_LABELS 有中文标签。"""
    assert "protected_layer_violation" in ALL_DIMENSIONS, (
        "ALL_DIMENSIONS 应含 protected_layer_violation（M7 第 10 类）"
    )
    assert DIM_LABELS.get("protected_layer_violation") == "Protected 层违反", (
        "DIM_LABELS 应含 protected_layer_violation 中文标签"
    )


# ============================================================================
# 8. enforce_protected_layer CLI 可运行
# ============================================================================
def test_enforce_protected_layer_cli_runs(temp_vault: Path):
    """CLI 入口可运行，--json 输出合法 JSON。"""
    _write_chapter(temp_vault, 99, "林渊道：「本座已悟。」他收剑入鞘。")
    result = subprocess.run(
        [sys.executable, "-m", "scripts.novelforge.enforce_protected_layer",
         "--chapter", "99", "--vault", str(temp_vault), "--json"],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    assert result.returncode == 0, f"CLI 失败：\nstderr: {result.stderr}"
    parsed = json.loads(result.stdout)
    assert parsed["chapter"] == "ch_099"
    assert "issues" in parsed
    assert "subs_checked" in parsed
```

### 7.2 新增 BUG-057 · reference without enforcement 导致生成内容违反 Protected 层

在 file:///workspace/tests/bug_regression_list.md 末尾追加：

```markdown
## reference without enforcement 导致生成内容违反 Protected 层

- **编号**：BUG-057
- **首次出现**：2026-07-18（M7 模块识别）
- **类型**：一致性 / 状态漂移
- **现象**：行业调研发现 Sudowrite 的 Story Bible 和 NovelCrafter 的 Codex 都是 "reference without enforcement"——AI 收到 Protected 层信息但无系统确认被尊重。NovelForge 在 M2 之前存在同样问题：`check_consistency.py` 的 7 类检测只覆盖 character_state 字段（境界/物品/位置/关系/复生/伏笔/金手指），不覆盖 Protected 层的 author_intent L0（主角弧光/世界观核心/风格基调）、worldbuilding core_rules、style_guide 禁用词表、characters stable_info（arc_stage/language_fingerprint）、hooks_registry status 违反。导致 AI 生成时即使收到了 Protected 层注入，仍可能在正文中违反这些字段，而现有检测漏检。
- **根因**：(1) `check_consistency.py` 7 类检测的设计目标是 character_state 字段漂移，未覆盖 Protected 层全字段；(2) `state-consistency-checker` Skill 只跑 check_consistency.py，未做额外的 Protected 层主动校验；(3) `writer-polisher` 阶段四状态更新前无强制验证步骤，直接调 save_state.py；(4) context-composer 已实现 Protected 层注入（不可压缩），但生成后无对照校验。
- **修复**：(1) 新增 `scripts/novelforge/enforce_protected_layer.py` 脚本，对照 Protected 层 5 子维度（author_intent / characters / worldbuilding / style_guide / hooks）做主动校验，输出与 check_consistency.Issue 同构的 ProtectedReport；(2) `check_consistency.py` 新增第 10 类检测 `protected_layer_violation`（薄包装，调 enforce_protected_layer 核心函数）；(3) `state-consistency-checker` SKILL.md 新增「第四阶段：强制验证」，工作流从 7 步扩展为 8 步；(4) `writer-polisher` SKILL.md 阶段四新增「第 0 步：强制验证」，在 save_state 前必须先跑 enforce_protected_layer；(5) `schema.py` 的 `FLAG_SCHEMA.properties.rule.enum` 追加 `protected_layer_violation` 第 8 项，使 protected flag 可被 M2 的 `_check_flags()` 阻断；(6) 复用 M2 的 flag 协议阻断入口，无需新增阻断代码。
- **涉及文件**：`scripts/novelforge/enforce_protected_layer.py`（新增）、`scripts/novelforge/check_consistency.py`（修改：ALL_DIMENSIONS / DIM_LABELS / DIM_ALIASES / check_protected_layer_violation / check_all）、`scripts/novelforge/schema.py`（修改：FLAG_SCHEMA.rule.enum + validate_flags.valid_rules）、`.trae/skills/state-consistency-checker/SKILL.md`（修改：新增第四阶段段落 + 反模式 + 元信息）、`.trae/skills/writer-polisher/SKILL.md`（修改：阶段四第 0 步 + 错误处理 + 输出格式）
- **回归测试**：`tests/test_active_enforcement.py` 6 个用例：`test_enforce_protected_layer_runs` / `test_protected_layer_blocks_character_stable_info_violation` / `test_protected_layer_blocks_worldbuilding_violation` / `test_protected_layer_blocks_style_guide_violation` / `test_normal_chapter_passes_enforcement` / `test_writer_polisher_invokes_enforcement`；外加 `test_check_consistency_has_protected_dimension` 与 `test_enforce_protected_layer_cli_runs` 共 8 个用例
- **教训/沉淀**：检测能力（detection）≠ 强制力（enforcement）≠ 主动校验（active verification）。M2 解决了「检测后阻断」（detection → enforcement），M7 解决了「未检测到的字段不做主动校验」（active verification of Protected layer）。三者合起来才是完整的 active enforcement 闭环。已沉淀至 `docs/loop_log/2026-07.md` 当月分片（#lesson `state_drift` `content_quality`）。
- **频次**：第 1 次（设计文档与代码脱节的典型，与 BUG-052 同源）
```

### 7.3 在 check_consistency.py / check_ai_novel.py 中新增的检测规则

**check_consistency.py**：本模块新增第 10 类检测 `protected_layer_violation`（薄包装），不修改既有 7 类检测逻辑。新增函数 `check_protected_layer_violation()`，注册到 `ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES`，在 `check_all` 的 for 循环追加 `elif` 分支。

**check_ai_novel.py**：本模块不修改 check_ai_novel.py。style_guide 禁用词在 enforce_protected_layer 中只做 Protected 层视角的二次校验，不与 check_ai_novel 重复。

### 7.4 集成测试执行

```bash
# 1. 单元测试
pytest -q tests/test_active_enforcement.py

# 2. 既有校验不破坏
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault

# 3. 完整 pytest
pytest -q

# 4. M2 测试不破坏（M7 依赖 M2）
pytest -q tests/test_schema_sync.py
```

---

## 八、风险点与回滚方案

### 8.1 风险等级

**中**（依赖 M2 flag 协议先接入；新增检测脚本与第 10 类检测，但 save_state.py 入口逻辑不修改，复用 M2 阻断机制）。

### 8.2 风险分析

| 风险 | 影响 | 缓解 |
|---|---|---|
| M2 未合入导致 M7 flag 无法阻断 | M7 的 protected flag 文件无法被 save_state.py 入口识别，退化为 `--strict` 退出码 1 的弱信号 | M7 必须在 M2 合入后开发；DoD 第 1 项断言 M2 已接入 |
| enforce_protected_layer 误报 | author_intent / worldbuilding 的简单关键词匹配可能误报（如正文是角色讨论规则而非违反） | (a) Issue.detail 提示「若正文是角色讨论规则而非违反，需在 flag 中豁免」；(b) P0 不可豁免但可通过修正状态机字段（如 arc_stage）解决；(c) Gradual Rollout 阶段 1 warn 模式观察误报率 |
| check_consistency.py 第 10 类薄包装失败 | `check_protected_layer_violation` 函数 import enforce_protected_layer 失败时降级为 skip，不阻断整体检测 | try/except 包裹 ImportError，返回 `([], "enforce_protected_layer 模块不可用")` |
| 循环 import 风险 | enforce_protected_layer import check_consistency 的 Issue / load_chapter_text，check_consistency 又 import enforce_protected_layer 的 enforce | (a) check_consistency 在函数体内延迟 import enforce_protected_layer（不在模块顶部）；(b) enforce_protected_layer 在模块顶部 import check_consistency（单向依赖） |
| Protected 层字段解析不准 | author_intent L0 / core_rules.md 的 Markdown 解析依赖模板格式，模板变化时解析失败 | (a) 解析失败时降级为跳过该子维度（report.skipped）；(b) 后续 M5/M6 模块升级字段结构时同步更新解析函数 |
| schema.py 的 FLAG_SCHEMA.rule enum 漏更新 | protected_layer_violation flag 在 validate_flags 时被拒绝 | M7 步骤 5.6.4 显式更新 rule enum；M2 的 `test_flag_schema_definition` 测试需扩展（或新增 `test_flag_schema_includes_protected_rule`） |
| flag 文件合并去重逻辑出错 | 同一问题在 flag 文件中出现两次，导致 save_state 报错 | state-consistency-checker SKILL.md 工作流第 5 步明确去重规则（按 sub_type+field 去重） |
| 现有章节无 Protected 层字段（历史章节） | enforce_protected_layer 跑历史章节时 author_intent / core_rules 等字段为空，跳过对应子维度 | 解析失败时降级为 skip（report.skipped[sub]=原因），不阻断；只对新建章节强制 |

### 8.3 对核心资产的影响

| 资产 | 影响 | 防护 |
|---|---|---|
| `scripts/novelforge/check_consistency.py`（一致性检测核心） | 新增第 10 类检测（薄包装）+ ALL_DIMENSIONS 等常量更新 | 不修改既有 7 类检测逻辑；薄包装失败时降级为 skip；完整回归测试 |
| `scripts/novelforge/save_state.py`（状态机核心） | **不修改**（M7 复用 M2 的 `_check_flags` 入口） | 无需新增防护 |
| `scripts/novelforge/schema.py`（SSOT） | FLAG_SCHEMA.rule enum 追加 1 项 | 纯增量，不破坏既有 schema |
| `scripts/novelforge/build_context.py`（Protected 层组装） | **不修改**（enforce_protected_layer 复用其读取函数） | 无需新增防护 |
| `.trae/skills/state-consistency-checker/SKILL.md`（守护 Skill） | 新增第四阶段段落 + 反模式 + 元信息 | 仅文档层修改，不影响检测逻辑 |
| `.trae/skills/writer-polisher/SKILL.md`（执笔 Skill） | 阶段四第 0 步 + 错误处理 + 输出格式 | 仅文档层修改，不影响既有四阶段流水线 |
| `.trae/skills/context-composer/SKILL.md`（上下文编排 Skill） | **不修改** | Protected 层定义的 SSOT 不变 |

### 8.4 回滚方案

**分支隔离**：

```bash
git checkout -b feature/active-enforcement
# 全部改动在本分支提交
# 验证通过后再合 master
```

**数据备份**：

```bash
# 修改前备份 check_consistency.py / schema.py / 两个 SKILL.md
cp scripts/novelforge/check_consistency.py /tmp/check_consistency.py.bak.$(date +%Y%m%d)
cp scripts/novelforge/schema.py /tmp/schema.py.bak.$(date +%Y%m%d)
cp .trae/skills/state-consistency-checker/SKILL.md /tmp/state-consistency-checker.SKILL.md.bak.$(date +%Y%m%d)
cp .trae/skills/writer-polisher/SKILL.md /tmp/writer-polisher.SKILL.md.bak.$(date +%Y%m%d)
```

**Gradual Rollout（推荐）**：

1. **阶段 1（warn 模式，1 周）**：`enforce_protected_layer.py` 输出报告但不接入 state-consistency-checker 工作流；手动跑观察误报率
2. **阶段 2（enforce 模式，正式上线）**：接入 state-consistency-checker 工作流第 4 步；P0 转 flag 阻断 save_state
3. **阶段 3（strict 模式，未来增强）**：无 flag 文件时也阻断（彻底强制，与 M2 strict 模式联动）

阶段切换通过环境变量 `NOVELFORGE_ENFORCEMENT_MODE=warn|enforce|strict` 控制（可选项，不在 DoD 硬性要求内）：

```python
import os
ENFORCEMENT_MODE = os.environ.get("NOVELFORGE_ENFORCEMENT_MODE", "enforce")

def enforce(chapter, vault, subs=None):
    if ENFORCEMENT_MODE == "warn":
        # warn 模式：跑校验但 P0 不转 flag（仅输出报告）
        report = _run_enforce(chapter, vault, subs)
        return report
    # enforce / strict 模式：正常逻辑
    return _run_enforce(chapter, vault, subs)
```

**降级为 warn 模式（应急）**：

若上线后发现误报率高，可临时降级：

```bash
# 1. 切回主分支
git checkout master

# 2. 或 revert 单个 commit
git revert <commit_hash>

# 3. 或临时设环境变量降级为 warn 模式
export NOVELFORGE_ENFORCEMENT_MODE=warn

# 4. 或临时回退 state-consistency-checker SKILL.md 跳过第 4 步
#    （注释掉「第四阶段：强制验证」段落）
```

**紧急回滚**：

```bash
# 回退 check_consistency.py 第 10 类检测（保留 7 类）
git checkout HEAD~1 -- scripts/novelforge/check_consistency.py

# 回退 schema.py 的 rule enum
git checkout HEAD~1 -- scripts/novelforge/schema.py

# 删除 enforce_protected_layer.py
rm scripts/novelforge/enforce_protected_layer.py

# 回退两个 SKILL.md
git checkout HEAD~1 -- .trae/skills/state-consistency-checker/SKILL.md
git checkout HEAD~1 -- .trae/skills/writer-polisher/SKILL.md
```

---

## 九、完成标准（DoD 清单）

- [ ] `enforce_protected_layer.py` 脚本可独立运行（`test_enforce_protected_layer_runs` + `test_enforce_protected_layer_cli_runs` 通过）
- [ ] `enforce_protected_layer.py` 实现 5 子维度校验函数（author_intent / characters / worldbuilding / style_guide / hooks）
- [ ] `enforce_protected_layer.py` 复用 build_context 的 Protected 层读取函数（不重复实现）
- [ ] `enforce_protected_layer.py` 输出与 check_consistency.Issue 同构的 ProtectedReport
- [ ] `state-consistency-checker` SKILL.md 升级（新增「第四阶段：强制验证」段落 + 工作流 8 步 + 反模式 + 元信息）
- [ ] `writer-polisher` SKILL.md 阶段四升级（新增「第 0 步：强制验证」+ 错误处理 + 输出格式）
- [ ] `check_consistency.py` 新增 `protected_layer_violation` 检测（ALL_DIMENSIONS / DIM_LABELS / DIM_ALIASES / `check_protected_layer_violation` / `check_all` 分支）
- [ ] `check_consistency.py` 第 10 类检测是薄包装（不重新实现 Protected 层字段解析逻辑）
- [ ] `schema.py` 的 `FLAG_SCHEMA.properties.rule.enum` 追加 `protected_layer_violation` 第 8 项
- [ ] `schema.py` 的 `validate_flags.valid_rules` 集合同步追加 `protected_layer_violation`
- [ ] `tests/test_active_enforcement.py` 6 个核心用例全部通过（`test_enforce_protected_layer_runs` / `test_protected_layer_blocks_character_stable_info_violation` / `test_protected_layer_blocks_worldbuilding_violation` / `test_protected_layer_blocks_style_guide_violation` / `test_normal_chapter_passes_enforcement` / `test_writer_polisher_invokes_enforcement`）
- [ ] `tests/test_active_enforcement.py` 2 个附加用例通过（`test_check_consistency_has_protected_dimension` / `test_enforce_protected_layer_cli_runs`）
- [ ] `bug_regression_list.md` 新增 BUG-057「reference without enforcement 导致生成内容违反 Protected 层」
- [ ] `pytest -q` 全集通过（不破坏历史用例，特别是 M2 的 `tests/test_schema_sync.py`）
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 仍正常（不破坏既有 7 类检测）
- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 仍正常（独立检测不受影响）
- [ ] `python -m scripts.novelforge.check_consistency --chapter <N> --dim protected_layer_violation --json` 可运行（第 10 类检测可单独调用）
- [ ] 集成测试 1（包含矛盾的章节）enforcement 阻断 save_state 验证通过
- [ ] 集成测试 2（正常章节）enforcement 通过验证
- [ ] 循环 import 风险已规避（check_consistency 函数体内延迟 import enforce_protected_layer）
- [ ] `docs/loop_log/2026-07.md` 追加一条 #lesson `state_drift` `content_quality` 沉淀（active enforcement 闭环：detection → enforcement → active verification）

---

## 附录 A · 关键路径速查

| 文件 | 路径 |
|---|---|
| check_consistency.py | file:///workspace/scripts/novelforge/check_consistency.py |
| enforce_protected_layer.py（新增） | file:///workspace/scripts/novelforge/enforce_protected_layer.py |
| schema.py | file:///workspace/scripts/novelforge/schema.py |
| save_state.py（M7 不修改） | file:///workspace/scripts/novelforge/save_state.py |
| build_context.py（M7 不修改） | file:///workspace/scripts/novelforge/build_context.py |
| state-consistency-checker SKILL.md | file:///workspace/.trae/skills/state-consistency-checker/SKILL.md |
| writer-polisher SKILL.md | file:///workspace/.trae/skills/writer-polisher/SKILL.md |
| context-composer SKILL.md（M7 不修改） | file:///workspace/.trae/skills/context-composer/SKILL.md |
| bug_regression_list.md | file:///workspace/tests/bug_regression_list.md |
| loop_log 2026-07 | file:///workspace/docs/loop_log/2026-07.md |
| test_active_enforcement.py（新增） | file:///workspace/tests/test_active_enforcement.py |
| M02 方案文档（依赖） | file:///workspace/docs/optimization_plan_2026_07/M02_schema_sync_gate.md |
| 本方案文档 | file:///workspace/docs/optimization_plan_2026_07/M07_active_enforcement.md |

## 附录 B · 验证命令一键运行

```bash
# 1. 单元测试（M7 核心）
pytest -q tests/test_active_enforcement.py

# 2. M2 测试不破坏
pytest -q tests/test_schema_sync.py

# 3. 既有校验不破坏
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault

# 4. 第 10 类检测可单独调用
python -m scripts.novelforge.check_consistency --chapter 1 --dim protected_layer_violation --json

# 5. enforce_protected_layer 可独立运行
python -m scripts.novelforge.enforce_protected_layer --chapter 1 --json

# 6. 完整 pytest
pytest -q

# 7. 集成测试（手动构造 Protected 违反）
mkdir -p NovelForge_Vault/05_正文/drafts/vol_01
cat > NovelForge_Vault/05_正文/drafts/vol_01/ch_099.md <<'EOF'
# 第 99 章 测试章

林渊道：「我要复仇，血债血偿！」他挥剑斩向赵师兄。
EOF

python -m scripts.novelforge.enforce_protected_layer --chapter 99 --strict
echo "Exit code: $?（期望 1，P0 阻断）"

rm -f NovelForge_Vault/05_正文/drafts/vol_01/ch_099.md
```

---

## 附录 C · 与 M2 的契约复用清单

M7 复用 M2 的以下产出，**不重复实现**：

| M2 产出 | M7 复用方式 |
|---|---|
| `FLAG_SCHEMA` 定义 | M7 只追加 `rule.enum` 第 8 项 `protected_layer_violation` |
| `FLAG_FILE_SCHEMA` 定义 | M7 直接复用，protected flag 与 consistency flag 共用同一 flag 文件 |
| `validate_flags` 函数 | M7 只追加 `valid_rules` 集合的第 8 项 |
| `save_state.py._check_flags()` 入口 | M7 不修改，protected flag 通过同一 flag 文件被阻断 |
| `save_state.py._load_flags()` | M7 不修改 |
| `save_state.py._consume_flags()` | M7 不修改，写入成功后删除合并后的 flag 文件 |
| state-consistency-checker SKILL.md flag 协议段 | M7 在其后追加「第四阶段：强制验证」段落，不修改 flag 协议段 |
| dev-checklist.md schema 同步检查项 | M7 不新增项（M2 已覆盖 schema 同步） |
| `tests/test_schema_sync.py` | M7 不修改（M2 测试覆盖 flag 协议本体） |

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge M7 模块（active enforcement 生成后强制验证）
**依赖**：M2（schema 同步门禁 + flag 协议接入）必须先合入
**下游**：M5（角色五层档案）/ M6（伏笔五阶段）/ M18（Persona Vectors）的 enforcement 实现均以本模块的 Protected 层强制校验框架为基础
