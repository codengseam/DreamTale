# M4 · 路径契约表模板

> **模块层级**：L1 修复工程债（与 M1/M2/M3 同属并行组 A，互不依赖）
> **对应工程债**：D1（loop_log 2026-07 沉淀教训 1：多 Agent 并行开发的路径契约不一致）
> **文档版本**：v1.0 · 2026-07-18

---

## 一、模块目标

### 1.1 一句话目标

固化「路径契约表」为 NovelForge 所有并行 subagent 派发的必填项，修复 loop_log 2026-07 已识别的 10 项路径断链，杜绝多 Agent 并行开发再次踩坑。

### 1.2 对应的痛点

`docs/loop_log/2026-07.md` 沉淀教训 1（`#lesson ai_course`，2026-07-18）：

> Phase 6 联调发现 10 项断链/路径/schema 不一致——章纲路径 `04_大纲与脉络/ch_NNN_outline.md` vs `vol_NN/ch_NNN_outline.md`、recap 路径 `_recaps/ch_NNN_recap.md` vs `recap_chXXX-YYY.md`、脚本调用形式 `python scripts/...` vs `python -m scripts...`。根因：每个 subagent 各自为政，路径约定在 query 里没有强制统一。**教训：派发并行 subagent 时，query 里必须包含"路径契约表"（明确每个产物的标准路径），并在返回后做路径一致性校验。**

### 1.3 完成后达成的能力

| 能力 | 当前状态 | 完成后 |
|---|---|---|
| `dispatching-parallel-agents` Skill 强制要求路径契约表 | 模板未含路径契约段 | 模板第 6 项「路径契约表」必填，无则拒绝派发 |
| 路径一致性自动化校验 | 无脚本 | 新增 `scripts/check_path_contracts.py`，可扫描全部 SKILL.md 引用路径并与契约表比对 |
| 10 项路径断链修复 | 全部存在 | 全部消除，单测断言通过 |
| `dev-workflow.md` 第三步新增"并行派发前必填路径契约表"规则 | 未提 | 明确条文 + 检查清单项 |
| README/USAGE 项目代号与产物路径统一 | bug_regression_list.md 标题写"HaloRead 项目"，README 同时出现"DreamTale"与"NovelForge" | 全部统一为 NovelForge |

---

## 二、痛点对应

### 2.1 痛点表现：10 项路径断链详表

| # | 断链项 | 路径 A | 路径 B | 影响范围 |
|---|---|---|---|---|
| 1 | 章纲路径 | `04_大纲与脉络/ch_NNN_outline.md`（USAGE.md 速查表 line 209） | `04_大纲与脉络/vol_NN/ch_NNN_outline.md`（architect SKILL line 53、build_context.py `_chapter_outline_path` line 230） | context-composer 找不到章纲 → Protected 层空 |
| 2 | recap 路径 | `_recaps/ch_NNN_recap.md`（USAGE.md 速查表 line 206 模糊表述） | `_recaps/recap_chXXX-YYY.md`（recap-generator SKILL line 154、build_context.py `_check_recaps` line 611） | recap-generator 写出后 build_context 找不到 → 长程记忆保护失效 |
| 3 | 脚本调用形式 | `python scripts/...`（dev-workflow.md line 86/87/94/95） | `python -m scripts.novelforge...`（save_state/build_context/audit_hooks/check_consistency/check_ai_novel.py 的 docstring 与所有 Skill 内引用） | subagent 复制 dev-workflow 命令直接执行 → import 失败或路径错 |
| 4 | 章末摘要路径 | `.state/ch_NNN_summary.md`（writer-polisher SKILL line 234、recap-generator line 138） | （无竞品路径，但 writer-polisher 应产出而 Phase 6 联调发现未稳定产出） | recap-generator/drift-detector 回退读末 500 字正文，违反防漂移铁律 1 |
| 5 | 关键场景存档命名 | `_scenes/` 下命名规范未明确（USAGE.md line 205 只说 `ch_NNN_角色_关键词.md`） | key-scene-archiver SKILL line 84 明确同上 | 命名规范散在 Skill 文件里，新增 Skill 不知道 |
| 6 | shortform 文章路径 | `shortform/YYYY-MM-DD-slug.md`（dev-workflow.md line 84） | `06_短文/article_<slug>.md`（USAGE.md line 124/205）+ `06_短文/drafts/`、`06_短文/published/`（USAGE.md line 213） | shortform 模式产出位置不一致，链接断 |
| 7 | 状态机文件路径 | `.state/characters/protagonist.json` 等（save_state.py `CHARACTERS_DIR_REL` line 68） | `.state/hooks_registry.json`（save_state.py 用 `04_大纲与脉络/hooks_registry.json`，但 recap-generator line 124 写成 `.state/hooks_registry.json`） | recap-generator 读错路径 → 伏笔登记段失真 |
| 8 | 大纲文件路径 | `master_outline.md`（README.md line 51 简写） | `04_大纲与脉络/master_outline.md`（architect SKILL line 51 全路径） | subagent 写到根目录而非 `04_大纲与脉络/` |
| 9 | 卷目录路径 | `卷名/vol_NN/ch_NNN.md`（dev-workflow.md line 84 三级路径） | `vol_NN/ch_NNN.md`（writer-polisher SKILL line 86、175 二级路径 `05_正文/drafts/vol_NN/ch_NNN.md`） | drafts/published 下找不到章节 |
| 10 | bug_regression_list.md 项目代号 | `tests/bug_regression_list.md` 标题仍写"HaloRead 项目"（line 3） | README.md 同时使用"DreamTale"（line 1/8）与"NovelForge"（line 62/152） | 项目身份混乱，新贡献者困惑 |

### 2.2 行业方案

参考大型工程项目的「API contract / schema registry」模式：

- **OpenAPI Specification**：把所有 REST 接口的入参/出参/路径写成 YAML，编译时与代码生成比对。
- **gRPC proto 文件**：路径与消息体作为单一信源，多语言 SDK 自动生成。
- **Terraform Module Registry**：模块输入输出强类型声明，CI 校验。
- **Pydantic / JSON Schema**：把"路径字段"作为 schema 的一等公民，import 时即校验。

共同特征：**契约即文档 + 契约即测试**——契约文件既是人类可读的速查表，也是机器可执行的校验源。

### 2.3 本模块的差异化设计

NovelForge 的差异化在于「**路径契约表是 Skill 派发的 YAML frontmatter**」——既不引入数据库，也不引入额外编译步骤，只用一个 Markdown + YAML 文件实现：

1. **路径契约表为单一信源**：所有 Skill/脚本引用路径都从 `path_contract_table.md` 派生。
2. **派发时强制注入**：`dispatching-parallel-agents` Skill 模板的第 6 项要求每个 subagent 的 query 必须包含路径契约表（复制粘贴 8-15 条相关行）。
3. **机器化扫描**：`check_path_contracts.py` 用正则提取所有 `SKILL.md` 与 `.py` 文件中的路径引用，比对契约表，输出 diff 报告。
4. **零外部依赖**：仅用 Python 标准库（`re`/`os`/`argparse`/`pathlib`），与现有 6 个 novelforge 脚本风格一致。
5. **回归测试断言**：6 个 pytest 用例锁死关键路径不被悄悄改回去。

---

## 三、涉及现有文件

### 3.1 Skill 文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| dispatching-parallel-agents Skill | `file:///workspace/.trae/skills/dispatching-parallel-agents/SKILL.md` | line 95-114「subagent 指令模板」、line 134-143「验证清单」 |
| writer-polisher Skill | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | line 65-89（草稿/published 路径）、line 226-248（章末摘要路径） |
| recap-generator Skill | `file:///workspace/.trae/skills/recap-generator/SKILL.md` | line 124-139（hooks_registry 路径错误写成 `.state/`）、line 154-167（recap 文件命名） |
| architect Skill | `file:///workspace/.trae/skills/architect/SKILL.md` | line 47-53（章纲/卷纲/master_outline 路径） |
| key-scene-archiver Skill | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | line 84-103（场景文件命名规范） |

### 3.2 规则与文档文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| dev-workflow 规则 | `file:///workspace/.trae/rules/dev-workflow.md` | line 84（章节路径表述与脚本不一致）、line 86-87（`python scripts/...` 与 Skill 内 `python -m` 矛盾） |
| README.md | `file:///workspace/README.md` | line 1（标题写"DreamTale"）、line 8（首段"DreamTale 是一套"）、line 51（`master_outline.md` 简写）、line 62/152（"DreamTale"与"NovelForge"混用） |
| NovelForge_Vault USAGE.md | `file:///workspace/NovelForge_Vault/00_控制面/USAGE.md` | line 124（`06_短文/article_<slug>.md`）、line 205-211（速查表）、line 213（drafts/published 二级路径） |

### 3.3 脚本文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| save_state.py | `file:///workspace/scripts/novelforge/save_state.py` | line 67-73（`.state/` 路径常量）、line 1029（CLI 调用形式 `python -m scripts.novelforge.save_state`） |
| build_context.py | `file:///workspace/scripts/novelforge/build_context.py` | line 213-230（章纲路径函数）、line 352（前章正文路径 `05_正文/published/vol_NN/ch_NNN.md`）、line 607-632（recap 检查正则 `recap_ch(\d+)-(\d+)\.md`） |
| audit_hooks.py | `file:///workspace/scripts/novelforge/audit_hooks.py` | line 54（`HOOKS_REGISTRY_REL = "04_大纲与脉络/hooks_registry.json"`）、line 781-827（CLI 参数 `prog="audit_hooks"`） |
| check_consistency.py | `file:///workspace/scripts/novelforge/check_consistency.py` | line 64-76（状态/正文路径常量）、line 23（CLI 调用形式 `python -m scripts.novelforge.check_consistency`） |
| check_ai_novel.py | `file:///workspace/scripts/novelforge/check_ai_novel.py` | line 20-32（CLI 调用形式 `python -m scripts.novelforge.check_ai_novel`） |

### 3.4 测试文件（参考）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| bug_regression_list.md | `file:///workspace/tests/bug_regression_list.md` | line 3（"HaloRead 项目"标题需改）、line 1002（最新 BUG-049） |

### 3.5 现状速读结论

- **路径在源码层基本正确**（save_state.py、build_context.py、check_consistency.py 的常量与函数实现已对齐 `04_大纲与脉络/vol_NN/ch_NNN_outline.md`）；
- **路径在文档层有偏差**（USAGE.md 速查表 line 209 写成 `04_大纲与脉络/ch_NNN_outline.md` 漏掉 `vol_NN` 一级）；
- **路径在规则层有偏差**（dev-workflow.md line 84 章节路径表述与 line 86/87 脚本调用形式与 Skill 矛盾）；
- **路径在 Skill 间有偏差**（recap-generator line 124 把 hooks_registry.json 错写为 `.state/hooks_registry.json`，实际在 `04_大纲与脉络/`）；
- **项目代号三重混乱**（DreamTale/NovelForge/HaloRead 在 README + bug_regression_list 标题中混用）。

修复策略以「**源码为信源**」+ 「**契约表为单一信源**」双轨并进：源码已经对齐的就改文档/Skill 跟上；源码本身路径与契约表冲突的（如 recap-generator 把 hooks_registry 写错路径）改源码。

---

## 四、新增/修改文件清单

### 4.1 新增文件

| 路径 | 用途 |
|---|---|
| `file:///workspace/scripts/check_path_contracts.py` | 路径契约校验脚本，扫描 SKILL.md 与 .py 引用路径并比对契约表 |
| `file:///workspace/docs/optimization_plan_2026_07/path_contract_table.md` | 路径契约表模板（YAML frontmatter + Markdown 表格，单一信源） |
| `file:///workspace/tests/test_path_contracts.py` | 6 个回归测试用例 |

### 4.2 修改文件

| 路径 | 核心改动点 |
|---|---|
| `file:///workspace/.trae/skills/dispatching-parallel-agents/SKILL.md` | 在「subagent 指令模板」section 新增第 6 项「路径契约表」（必填）；在「验证清单」新增"路径契约表已注入 query"检查项 |
| `file:///workspace/.trae/rules/dev-workflow.md` | 第三步执行中新增「并行派发 subagent 前必须填写路径契约表」条文；line 84/86/87 章节路径与脚本调用形式统一为 `python -m scripts.novelforge.<script>` |
| `file:///workspace/README.md` | line 1/8 标题"DreamTale" → "NovelForge"；line 51 `master_outline.md` 改为完整路径；line 62/152 文案统一 |
| `file:///workspace/NovelForge_Vault/00_控制面/USAGE.md` | line 124/205-211 速查表路径修正；line 209 章纲路径补 `vol_NN/`；line 206 recap 路径明确为 `recap_chXXX-YYY.md` |
| `file:///workspace/.trae/skills/recap-generator/SKILL.md` | line 124 `.state/hooks_registry.json` → `04_大纲与脉络/hooks_registry.json` |
| `file:///workspace/.trae/skills/architect/SKILL.md` | line 51 `master_outline.md` → `04_大纲与脉络/master_outline.md`（统一为全路径） |
| `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | line 65-89 补全 `05_正文/drafts/vol_NN/ch_NNN.md`、`05_正文/published/vol_NN/ch_NNN.md` 路径前缀；line 234 章末摘要路径保持 `.state/ch_NNN_summary.md`，加注释「与契约表 §2.5 一致」 |
| `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | line 84 命名规范加引用「见 path_contract_table.md §2.6」 |
| `file:///workspace/tests/bug_regression_list.md` | line 3 "HaloRead 项目" → "NovelForge 项目"；新增 BUG-054 条目 |
| `file:///workspace/.trae/checklists/dev-checklist.md` | 新增"路径契约一致性"检查项（跑 `check_path_contracts.py`） |

### 4.3 不修改的核心资产

- `scripts/novelforge/save_state.py` / `build_context.py` / `audit_hooks.py` / `check_consistency.py` / `check_ai_novel.py` —— 这些脚本的路径常量已与契约表对齐，本模块不动它们的逻辑。
- `NovelForge_Vault/00_控制面/style_guide.md` —— 不在路径契约范围。

---

## 五、详细实现步骤

### 步骤 1：设计「路径契约表」模板格式

采用「YAML frontmatter（机器可解析）+ Markdown 表格（人类可读）」双形态并存：

```markdown
---
version: 1.0.0
project: NovelForge
last_updated: 2026-07-18
contract_owner: dev-workflow + dispatching-parallel-agents
contracts:
  - id: chapter_outline
    category: novel
    path_pattern: "NovelForge_Vault/04_大纲与脉络/vol_{vol:02d}/ch_{ch:03d}_outline.md"
    example: "NovelForge_Vault/04_大纲与脉络/vol_01/ch_042_outline.md"
    producers: [architect]
    consumers: [context-composer, build_context.py]
    regex: "04_大纲与脉络/vol_\\d{2}/ch_\\d{3}_outline\\.md"
  # ... 更多契约项
---

# 路径契约表（Path Contract Table）

> NovelForge 所有 Skill / 脚本 / 文档引用路径时，必须与此表保持一致。
> 派发并行 subagent 时必须把相关行复制到 query 中。
> 机器校验：`python scripts/check_path_contracts.py --skills-dir .trae/skills --vault NovelForge_Vault`

## 1. novel 模式产物路径
| ID | 名称 | 路径模板 | 生产者 | 消费者 |
|---|---|---|---|---|
| chapter_outline | 章纲 | `04_大纲与脉络/vol_NN/ch_NNN_outline.md` | architect | context-composer, build_context.py |
| chapter_draft | 章节草稿 | `05_正文/drafts/vol_NN/ch_NNN.md` | writer-polisher | check_consistency.py, check_ai_novel.py |
| chapter_published | 章节定稿 | `05_正文/published/vol_NN/ch_NNN.md` | writer-polisher | recap-generator, key-scene-archiver |
| vol_outline | 卷大纲 | `04_大纲与脉络/vol_NN/vol_outline.md` | architect | architect (向下展开) |
| master_outline | 总大纲 | `04_大纲与脉络/master_outline.md` | architect | architect |
| story_arc | 故事主线 | `04_大纲与脉络/story_arc.md` | architect | architect |
| chapter_summary | 章末摘要 | `.state/ch_NNN_summary.md` | writer-polisher | recap-generator, drift-detector |
| scene_archive | 关键场景存档 | `_scenes/ch_NNN_角色_关键词.md` | key-scene-archiver | build_context.py (Grep 召回) |
| recap | 前情提要 | `_recaps/recap_chXXX-YYY.md` | recap-generator | context-composer, build_context.py |
| drift_report | 漂移报告 | `06_审计/drift_report_chXXX-YYY.md` | drift-detector | （人工阅读） |
| hooks_report | 伏笔审计报告 | `06_审计/hooks_report.md` | hook-auditor | （人工阅读） |

## 2. 状态机文件路径
| ID | 名称 | 路径 | 写入方 | 读取方 |
|---|---|---|---|---|
| character_state | 角色状态 | `.state/characters/<name>.json` | save_state.py | build_context.py, check_consistency.py, recap-generator |
| hooks_registry | 伏笔登记表 | `04_大纲与脉络/hooks_registry.json` | audit_hooks.py, save_state.py | build_context.py, recap-generator, key-scene-archiver |
| pipeline | 流水线状态 | `.state/pipeline.json` | save_state.py | context-composer, recap-generator |
| world_timeline | 世界时间线 | `.state/world_timeline.json` | save_state.py | （查询用） |
| state_log | 状态更新日志 | `.state/state_update_log.json` | save_state.py | （审计用） |
| characters_index | 角色索引 | `.state/characters_index.md` | save_state.py | （人工查阅） |
| context_cache | 上下文缓存 | `.state/.cache/context_chNNN_<ts>.md` | build_context.py | writer-polisher |

## 3. shortform 模式产物路径
| ID | 名称 | 路径模板 | 生产者 | 消费者 |
|---|---|---|---|---|
| shortform_article | 公众号文章 | `06_短文/article_<slug>.md` | writer-polisher (shortform) | brand-voice-guardian, virality-auditor |
| shortform_draft | 公众号草稿 | `06_短文/drafts/article_<slug>.md` | writer-polisher | writer-polisher（精修阶段） |
| shortform_published | 公众号已发 | `06_短文/published/article_<slug>.md` | writer-polisher | （人工发布） |
| topics_pool | 选题库 | `06_短文/topics.md` | topic-curator | topic-curator |

## 4. 控制面与设定文件路径
| ID | 名称 | 路径 | 维护方 |
|---|---|---|---|
| author_intent | 作者意图 | `00_控制面/author_intent.md` | 作者人工 |
| current_focus | 当前焦点 | `00_控制面/current_focus.md` | architect, writer-polisher |
| style_guide | 文风指南 | `00_控制面/style_guide.md` | 作者人工 |
| author_voice | 作者声音档案 | `00_控制面/author_voice.md` | 作者人工 |
| master_index | 全局索引 | `00_控制面/master_index.md` | regen_loop_log_index.py 等脚本 |
| usage_manual | 作者手册 | `00_控制面/USAGE.md` | 作者人工 |
| worldbuilding | 世界观文件 | `01_世界观/{core_rules,geography,factions,items_and_concepts}.md` | architect |
| character_card | 角色设定卡 | `02_角色/<name>.md` | 作者人工 |

## 5. 脚本调用契约
| ID | 名称 | 调用形式（唯一） | 禁止形式 |
|---|---|---|---|
| save_state_cli | 状态写入 | `python -m scripts.novelforge.save_state --json '<delta>'` | `python scripts/novelforge/save_state.py ...` |
| build_context_cli | 上下文组装 | `python -m scripts.novelforge.build_context --chapter N` | `python scripts/novelforge/build_context.py ...` |
| audit_hooks_cli | 伏笔审计 | `python -m scripts.novelforge.audit_hooks --current-ch N` | `python scripts/novelforge/audit_hooks.py ...` |
| check_consistency_cli | 一致性检测 | `python -m scripts.novelforge.check_consistency --chapter N` | `python scripts/novelforge/check_consistency.py ...` |
| check_ai_novel_cli | 去 AI 味检测 | `python -m scripts.novelforge.check_ai_novel --chapter N` | `python scripts/novelforge/check_ai_novel.py ...` |
| check_path_contracts_cli | 路径契约校验（本模块新增） | `python scripts/check_path_contracts.py --skills-dir .trae/skills --vault NovelForge_Vault` | 无 |
```

### 步骤 2：列出 NovelForge 完整路径契约表（写入 `path_contract_table.md`）

按步骤 1 的格式，产出包含 8 大类、约 25 条路径的完整契约表。文件路径：`file:///workspace/docs/optimization_plan_2026_07/path_contract_table.md`。

每条路径必须包含以下字段（YAML frontmatter 内）：

```yaml
- id: <唯一标识>
  category: novel | shortform | state | script | control | worldbuilding | scene | doc
  path_pattern: "<含 {vol} / {ch} / {slug} / {name} 占位符的模板>"
  example: "<一个具体示例>"
  producers: [<Skill 或脚本名>]
  consumers: [<Skill 或脚本名>]
  regex: "<用于 check_path_contracts.py 扫描的正则>"
  notes: "<可选，特殊说明>"
```

Markdown 表格部分是人类可读速查表，与 YAML 字段一一对应。

### 步骤 3：修复 10 项路径断链的具体操作

#### 断链 1：章纲路径

- **现状**：USAGE.md 速查表写 `04_大纲与脉络/ch_NNN_outline.md`（漏 `vol_NN`），源码 `build_context.py` line 230 用 `04_大纲与脉络/vol_{volume:02d}/ch_{chapter:03d}_outline.md`。
- **修复**：改 USAGE.md line 209 为 `04_大纲与脉络/vol_NN/ch_NNN_outline.md`。
- **契约**：`chapter_outline` → `NovelForge_Vault/04_大纲与脉络/vol_{vol:02d}/ch_{ch:03d}_outline.md`。

#### 断链 2：recap 路径

- **现状**：USAGE.md line 206 模糊说"_recaps/recap_chXXX-YYY.md"，recap-generator SKILL line 154 明确。
- **修复**：USAGE.md line 206 补全路径模板与示例；dev-workflow.md 不涉及（不提具体 recap 路径）。
- **契约**：`recap` → `NovelForge_Vault/_recaps/recap_ch{start:03d}-{end:03d}.md`（正则 `recap_ch(\d{3})-(\d{3})\.md`）。

#### 断链 3：脚本调用形式

- **现状**：dev-workflow.md line 86/87/94/95 用 `python scripts/...`，与各 Skill 文件内 `python -m scripts.novelforge.<script>` 矛盾。
- **修复**：dev-workflow.md 全部改为 `python -m scripts.novelforge.<script>` 形式。具体改动：
  - line 86：`python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` → `python -m scripts.novelforge.check_consistency --vault NovelForge_Vault`
  - line 87：同上改 `check_ai_novel.py`
  - line 94：`python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` → `python -m scripts.novelforge.check_consistency --vault NovelForge_Vault`
  - line 95：同上改 `check_ai_novel.py`
- **契约**：`script_invocation` → 唯一形式 `python -m scripts.novelforge.<script_name>`（5 个核心脚本统一）。

#### 断链 4：章末摘要路径

- **现状**：writer-polisher SKILL line 234 明确 `.state/ch_NNN_summary.md`，recap-generator line 138 一致，但实际产出不稳定（M1 模块负责保证产出，本模块只固化路径契约）。
- **修复**：在契约表中固化 `.state/ch_NNN_summary.md` 路径，并在 writer-polisher SKILL line 234 加注释「路径契约见 path_contract_table.md §1.8」。
- **契约**：`chapter_summary` → `NovelForge_Vault/.state/ch_NNN_summary.md`。

#### 断链 5：关键场景存档命名

- **现状**：key-scene-archiver SKILL line 84 已明确 `_scenes/ch_NNN_角色_关键词.md`，但其他 Skill 不知道。
- **修复**：在契约表新增 `scene_archive` 项；在 build_context.py line 519 的 `glob("*.md")` 旁加注释引用契约。
- **契约**：`scene_archive` → `NovelForge_Vault/_scenes/ch_NNN_<角色>_<关键词>.md`（角色名多角色用 `-` 连接）。

#### 断链 6：shortform 文章路径

- **现状**：dev-workflow.md line 84 写 `shortform/YYYY-MM-DD-slug.md`（错路径前缀），USAGE.md line 124/205 写 `06_短文/article_<slug>.md`，USAGE.md line 213 又说"草稿在 drafts、定稿在 published"。
- **修复**：
  - dev-workflow.md line 84 改为 `NovelForge_Vault/06_短文/article_<slug>.md`（与 USAGE.md 对齐）。
  - USAGE.md line 213 的 drafts/published 表述保留（草稿 → `06_短文/drafts/article_<slug>.md`；定稿 → `06_短文/published/article_<slug>.md`；`06_短文/article_<slug>.md` 是已发布文章的最终态）。
  - 在契约表新增 `shortform_article` / `shortform_draft` / `shortform_published` 三项。
- **契约**：见步骤 1 表格 §3。

#### 断链 7：状态机文件路径

- **现状**：recap-generator SKILL line 124 错写 `.state/hooks_registry.json`，实际路径是 `04_大纲与脉络/hooks_registry.json`（save_state.py line 69、audit_hooks.py line 54、build_context.py line 305 一致）。
- **修复**：改 recap-generator SKILL line 124 为 `04_大纲与脉络/hooks_registry.json`，并在 step 3 的读取说明里同步。
- **契约**：`hooks_registry` → `NovelForge_Vault/04_大纲与脉络/hooks_registry.json`（注意：不在 `.state/` 下，是 Vault 顶级数据文件）。

#### 断链 8：大纲文件路径

- **现状**：README.md line 51 简写 `master_outline.md`，architect SKILL line 51 全路径 `04_大纲与脉络/master_outline.md`。
- **修复**：README.md line 51 补全路径；契约表新增 `master_outline` 项。
- **契约**：`master_outline` → `NovelForge_Vault/04_大纲与脉络/master_outline.md`。

#### 断链 9：卷目录路径

- **现状**：dev-workflow.md line 84 写 `卷名/vol_NN/ch_NNN.md`（三级，含中文卷名），实际源码 `build_context.py` line 352、writer-polisher SKILL line 86/175 用 `05_正文/published/vol_NN/ch_NNN.md`（不含中文卷名）。
- **修复**：dev-workflow.md line 84 改为 `NovelForge_Vault/05_正文/published/vol_NN/ch_NNN.md`，移除"卷名"前缀（中文卷名只在 vol_outline.md 的元信息里出现，不进入文件路径）。
- **契约**：`chapter_published` → `NovelForge_Vault/05_正文/published/vol_{vol:02d}/ch_{ch:03d}.md`；`chapter_draft` → `NovelForge_Vault/05_正文/drafts/vol_{vol:02d}/ch_{ch:03d}.md`。

#### 断链 10：bug_regression_list.md 标题与项目代号

- **现状**：`tests/bug_regression_list.md` line 3 写"HaloRead 项目"，README.md line 1/8 写"DreamTale"，line 62/152 又写"NovelForge"。
- **修复**：
  - bug_regression_list.md line 3 "HaloRead 项目" → "NovelForge 项目"。
  - README.md line 1 标题"DreamTale：借 AI 写长篇小说的创作系统" → "NovelForge：借 AI 写长篇小说的创作系统"。
  - README.md line 8 首段"DreamTale 是一套" → "NovelForge 是一套"。
  - README.md line 17 表头"DreamTale 支持两种创作模式" → "NovelForge 支持两种创作模式"。
  - README.md line 62/152 同步改。
  - README.md line 184 保留"从 HaloRead 演进而来"的历史说明（这是事实陈述，不改）。
- **契约**：项目代号统一为 `NovelForge`；HaloRead 仅作为历史溯源出现在 README 致谢段。

### 步骤 4：编写 `check_path_contracts.py` 脚本

**文件路径**：`file:///workspace/scripts/check_path_contracts.py`

**脚本逻辑**：

```python
"""NovelForge 路径契约校验脚本。

扫描所有 SKILL.md / .py / 规则文件中引用的路径，比对 path_contract_table.md 契约表，
输出不一致项报告。

设计哲学：
- 契约即信源：path_contract_table.md 是路径唯一信源
- 纯标准库：仅依赖 re/os/argparse/pathlib/yaml（yaml 用 stdlib 替代解析）
- 误报优先：宁可多报，不静默放过
- 不修改源码：只读 + 报告

CLI 速查：
    # 扫描默认目录
    python scripts/check_path_contracts.py --skills-dir .trae/skills --vault NovelForge_Vault

    # JSON 输出
    python scripts/check_path_contracts.py --skills-dir .trae/skills --json

    # strict 模式（发现不一致退出码 1）
    python scripts/check_path_contracts.py --skills-dir .trae/skills --strict

退出码：
    0 - 全部通过
    1 - 发现路径不一致（--strict 模式）
    2 - 脚本错误（契约表缺失/参数错误）
"""
```

**核心函数骨架**：

```python
def load_contract_table(table_path: Path) -> list[ContractEntry]:
    """加载 path_contract_table.md 的 YAML frontmatter，返回 ContractEntry 列表。"""

def scan_skill_files(skills_dir: Path) -> list[PathReference]:
    """扫描所有 SKILL.md，用每个 ContractEntry.regex 提取路径引用。"""

def scan_python_scripts(scripts_dir: Path) -> list[PathReference]:
    """扫描 scripts/novelforge/*.py 中的字符串字面量。"""

def scan_rule_files(rules_dir: Path) -> list[PathReference]:
    """扫描 .trae/rules/*.md。"""

def check_consistency(
    contracts: list[ContractEntry],
    references: list[PathReference],
) -> list[Violation]:
    """比对引用与契约，输出 Violation 列表。
    Violation 字段：file / line / referenced_path / expected_pattern / suggestion。
    """

def render_report(violations: list[Violation], as_json: bool = False) -> str:
    """渲染文本或 JSON 报告。"""

def main(argv: list[str] | None = None) -> int:
    """CLI 入口。"""
```

**关键检测规则**（10 项断链的回归断言）：

```python
# 检测 1：USAGE.md / dev-workflow.md 不得出现 "04_大纲与脉络/ch_NNN_outline.md"（漏 vol_NN）
FORBIDDEN_PATTERNS = [
    (r"04_大纲与脉络/ch_\d", "断链 1：章纲路径漏 vol_NN 一级，应为 04_大纲与脉络/vol_NN/ch_NNN_outline.md"),
    (r"_recaps/ch_\d+_recap\.md", "断链 2：recap 文件名错，应为 _recaps/recap_chXXX-YYY.md"),
    (r"python scripts/novelforge/\w+\.py", "断链 3：脚本调用形式错，应为 python -m scripts.novelforge.<name>"),
    (r"\.state/hooks_registry\.json", "断链 7：hooks_registry.json 不在 .state/ 下，应在 04_大纲与脉络/"),
    (r"shortform/\d{4}-\d{2}-\d{2}-", "断链 6：shortform 文章路径错，应在 06_短文/ 下"),
    (r"卷名/vol_\d", "断链 9：章节路径不应含中文卷名前缀，应为 05_正文/published/vol_NN/ch_NNN.md"),
]

# 检测 2：项目代号不得混用
PROJECT_NAME_PATTERN = r"(DreamTale|HaloRead)"
# 允许的例外：README.md line 184 致谢段"HaloRead"作为历史溯源
```

**期望产出**（修复后扫描）：

```
=== NovelForge 路径契约校验报告 ===
扫描目录：.trae/skills, scripts/novelforge, .trae/rules, NovelForge_Vault/00_控制面
契约表：docs/optimization_plan_2026_07/path_contract_table.md (v1.0.0, 25 contracts)

扫描文件：32 个 SKILL.md + 6 个 .py + 2 个 rules + 1 个 USAGE.md
路径引用：218 处
不一致项：0 ✅

  断链 1 章纲路径：0 violations
  断链 2 recap 路径：0 violations
  断链 3 脚本调用形式：0 violations
  断链 4 章末摘要路径：0 violations
  断链 5 关键场景存档：0 violations
  断链 6 shortform 路径：0 violations
  断链 7 状态机路径：0 violations
  断链 8 大纲文件路径：0 violations
  断链 9 卷目录路径：0 violations
  断链 10 项目代号：0 violations

✅ 全部通过。
```

### 步骤 5：修改 `dispatching-parallel-agents/SKILL.md`

**修改位置**：`file:///workspace/.trae/skills/dispatching-parallel-agents/SKILL.md`

**改动 1**：在「subagent 指令模板」section（line 95-114）的模板中，在「【约束】」与「【期望输出】」之间，新增一项「【路径契约表】」：

```markdown
【路径契约表】
本次任务涉及以下路径，subagent 必须严格按契约表写入/读取，禁止自创路径：
- 章纲：NovelForge_Vault/04_大纲与脉络/vol_NN/ch_NNN_outline.md
- 章节草稿：NovelForge_Vault/05_正文/drafts/vol_NN/ch_NNN.md
- 章节定稿：NovelForge_Vault/05_正文/published/vol_NN/ch_NNN.md
- 章末摘要：NovelForge_Vault/.state/ch_NNN_summary.md
- 关键场景：NovelForge_Vault/_scenes/ch_NNN_角色_关键词.md
- 状态机：NovelForge_Vault/.state/characters/<name>.json
- 伏笔表：NovelForge_Vault/04_大纲与脉络/hooks_registry.json
- 脚本调用：python -m scripts.novelforge.<script_name>（禁用 python scripts/...py 形式）

完整契约表见：docs/optimization_plan_2026_07/path_contract_table.md
违反任一条路径契约视为任务失败。
```

**改动 2**：在「验证清单」section（line 134-143）末尾新增 2 项：

```markdown
- [ ] subagent 指令 query 中已注入「路径契约表」相关行（至少本任务涉及的 5-10 条）
- [ ] subagent 返回后跑过 `python scripts/check_path_contracts.py --skills-dir .trae/skills` 验证无新断链
```

**改动 3**：在「常见错误」表格（line 118-125）末尾新增 1 行：

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 不注入路径契约表 | subagent 自创路径，与已有文件断链 | query 必含路径契约表相关行 |

### 步骤 6：修改 `dev-workflow.md`

**修改位置**：`file:///workspace/.trae/rules/dev-workflow.md`

**改动 1**：第三步「执行」section 的「并行提速」要点（line 83）后新增一条：

```markdown
- **并行派发 subagent 前必须填写路径契约表**：在 Task 工具的 `query` 参数中，必须复制粘贴 `docs/optimization_plan_2026_07/path_contract_table.md` 中与本任务相关的路径契约行（至少 5 条），明示每个产物的标准路径与脚本调用形式。subagent 返回后跑 `python scripts/check_path_contracts.py --skills-dir .trae/skills` 验证无路径断链。违反此规则的多 Agent 并行开发会导致 loop_log 2026-07 教训 1 重现（10 项路径断链）。
```

**改动 2**：line 84 章节路径表述修正：

```diff
- novel 模式章节文件遵循 `NovelForge_Vault/卷名/vol_NN/ch_NNN.md` 三级路径；shortform 模式文章遵循 `NovelForge_Vault/shortform/YYYY-MM-DD-slug.md`；
+ novel 模式章节文件遵循 `NovelForge_Vault/05_正文/published/vol_NN/ch_NNN.md` 路径（草稿在 drafts/、定稿在 published/）；shortform 模式文章遵循 `NovelForge_Vault/06_短文/article_<slug>.md` 路径（草稿在 06_短文/drafts/、定稿在 06_短文/published/）；
```

**改动 3**：line 86/87/94/95 脚本调用形式统一为 `python -m scripts.novelforge.<name>`：

```diff
- `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault`（一致性：...）
- `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault`（去 AI 味：...）
+ `python -m scripts.novelforge.check_consistency --vault NovelForge_Vault`（一致性：...）
+ `python -m scripts.novelforge.check_ai_novel --vault NovelForge_Vault`（去 AI 味：...）
```

**改动 4**：第四步「自检」section（line 91-97）新增一项：

```markdown
- `python scripts/check_path_contracts.py --skills-dir .trae/skills` 通过（路径契约一致性，无断链）。
```

### 步骤 7：修改 `README.md`（断链 8/10）

**改动 1**：line 1 标题

```diff
- # DreamTale：借 AI 写长篇小说的创作系统
+ # NovelForge：借 AI 写长篇小说的创作系统
```

**改动 2**：line 8 首段

```diff
- DreamTale 是一套以 **Trae Skills** 为编排核心、**Obsidian Vault** 为存储与阅读载体的极简 AI 长篇小说创作系统。
+ NovelForge 是一套以 **Trae Skills** 为编排核心、**Obsidian Vault** 为存储与阅读载体的极简 AI 长篇小说创作系统。
```

**改动 3**：line 17 表头

```diff
- DreamTale 支持两种创作模式
+ NovelForge 支持两种创作模式
```

**改动 4**：line 51 简写补全

```diff
- ├── 04_大纲与脉络/          ✅ 已建  # master_outline / story_arc / hooks_registry
+ ├── 04_大纲与脉络/          ✅ 已建  # 04_大纲与脉络/master_outline.md / story_arc / hooks_registry
```

**改动 5**：line 62/152 全局把"DreamTale"替换为"NovelForge"（仅指代当前项目处），line 184 致谢段保留"HaloRead"作为历史溯源。

### 步骤 8：修改 `bug_regression_list.md`（断链 10）

**改动 1**：line 3

```diff
- 本文件记录 HaloRead 项目历史上出现过的 bug、根因、复现方式与回归测试。
+ 本文件记录 NovelForge 项目历史上出现过的 bug、根因、复现方式与回归测试。
```

**改动 2**：在文件末尾追加 BUG-054 条目（按 `.trae/rules/bug-reporting.md` 模板）：

```markdown
## 路径契约 10 项断链导致多 Agent 并行踩坑

- **编号**：BUG-054
- **首次出现**：2026-07-18
- **类型**：一致性 / 上下文预算 / 工具链
- **现象**：Phase 6 联调阶段发现 10 项路径断链——章纲路径在 USAGE.md 漏 `vol_NN` 一级、recap 路径表述模糊、dev-workflow.md 用 `python scripts/...` 与 Skill 内 `python -m scripts...` 矛盾、recap-generator 把 hooks_registry.json 错写到 `.state/`、bug_regression_list.md 标题仍写"HaloRead 项目"等。多 Agent 并行开发时各 subagent 路径约定不一致，导致 context-composer 找不到章纲、recap-generator 读不到伏笔表、守护 Skill 互相找不到产物。
- **根因**：派发并行 subagent 时 query 里没有强制注入"路径契约表"，每个 subagent 各自为政；文档/规则/Skill 三层路径约定独立维护，无机器化校验。
- **修复**：
  1. 新增 `docs/optimization_plan_2026_07/path_contract_table.md`（25 条路径契约，YAML frontmatter + Markdown 表格双形态）
  2. 新增 `scripts/check_path_contracts.py`（扫描 SKILL.md / .py / rules 中路径引用，比对契约表）
  3. 修改 `dispatching-parallel-agents` SKILL.md，subagent 指令模板新增「路径契约表」必填段
  4. 修改 `dev-workflow.md` 第三步新增"并行派发前必填路径契约表"规则，第四步新增 `check_path_contracts.py` 自检项
  5. 修复 USAGE.md / README.md / recap-generator SKILL.md / architect SKILL.md 中 10 项具体路径断链
  6. 统一项目代号为 NovelForge（HaloRead 仅作历史溯源保留在 README 致谢段）
- **涉及文件**：
  - `scripts/check_path_contracts.py`（新增）
  - `docs/optimization_plan_2026_07/path_contract_table.md`（新增）
  - `tests/test_path_contracts.py`（新增，6 个用例）
  - `.trae/skills/dispatching-parallel-agents/SKILL.md`
  - `.trae/rules/dev-workflow.md`
  - `README.md`
  - `NovelForge_Vault/00_控制面/USAGE.md`
  - `.trae/skills/recap-generator/SKILL.md`
  - `.trae/skills/architect/SKILL.md`
  - `.trae/skills/writer-polisher/SKILL.md`
  - `.trae/skills/key-scene-archiver/SKILL.md`
  - `tests/bug_regression_list.md`
  - `.trae/checklists/dev-checklist.md`
- **回归测试**：
  - `pytest -q tests/test_path_contracts.py`：6 个用例全部通过
  - `python scripts/check_path_contracts.py --skills-dir .trae/skills --vault NovelForge_Vault --strict`：退出码 0
  - 10 项断链逐项扫描，无残留
- **教训/沉淀**：
  1. 多 Agent 并行开发时路径契约必须在派发时注入，不能依赖 subagent 自己"查文档"——它看不到主会话历史
  2. 路径契约必须机器化校验，人工维护文档与脚本同步不可靠（loop_log 2026-07 教训 1 已暴露）
  3. 项目代号一旦确定就不要再改，改名会引入大量文案同步成本；本次修复后 NovelForge 为唯一代号，HaloRead 仅作历史溯源
```

### 步骤 9：可并行执行的子任务

以下子任务互不依赖，可由主 Agent 用 Task 工具并行派发 3-4 个 subagent：

| 子任务 | 涉及文件 | 路径契约注入行 |
|---|---|---|
| A. 编写 `path_contract_table.md` | `docs/optimization_plan_2026_07/path_contract_table.md` | 全部 25 条 |
| B. 编写 `check_path_contracts.py` | `scripts/check_path_contracts.py` | 全部 25 条 + 6 条 forbidden patterns |
| C. 修复文档层断链（断链 1/2/6/8/9/10） | `README.md` / `USAGE.md` / `dev-workflow.md` / `bug_regression_list.md` | 文档涉及项 |
| D. 修复 Skill 层断链（断链 4/5/7） | `recap-generator/SKILL.md` / `architect/SKILL.md` / `writer-polisher/SKILL.md` / `key-scene-archiver/SKILL.md` / `dispatching-parallel-agents/SKILL.md` | Skill 涉及项 |

子任务 A、B 必须最先完成（B 依赖 A 的契约表作为校验源），C、D 可并行。完成后由主 Agent 跑 `pytest -q tests/test_path_contracts.py` + `python scripts/check_path_contracts.py --strict` 整合验证。

---

## 六、验证方式

### 6.1 单元测试

**命令**：

```bash
pytest -q tests/test_path_contracts.py
```

**期望输出**：6 个用例全部 PASSED。

### 6.2 集成测试

**命令**：

```bash
# 路径契约扫描（默认非 strict，发现断链只告警不阻断）
python scripts/check_path_contracts.py --skills-dir .trae/skills --vault NovelForge_Vault

# strict 模式（CI 用，发现断链退出码 1）
python scripts/check_path_contracts.py --skills-dir .trae/skills --vault NovelForge_Vault --strict

# JSON 输出（供 Trae Skill 解析）
python scripts/check_path_contracts.py --skills-dir .trae/skills --json
```

**期望输出**：

```
=== NovelForge 路径契约校验报告 ===
扫描目录：.trae/skills, scripts/novelforge, .trae/rules, NovelForge_Vault/00_控制面
契约表：docs/optimization_plan_2026_07/path_contract_table.md (v1.0.0, 25 contracts)

扫描文件：32 个 SKILL.md + 6 个 .py + 2 个 rules + 1 个 USAGE.md
路径引用：218 处
不一致项：0 ✅

✅ 全部通过。
```

### 6.3 断言清单

完成本模块后，以下断言必须全部成立：

| # | 断言 | 验证方式 |
|---|---|---|
| 1 | 10 项路径断链全部修复 | `check_path_contracts.py --strict` 退出码 0 |
| 2 | 路径契约表完整（≥ 25 条契约） | `test_path_contracts.py::test_path_contract_table_exists` 通过 |
| 3 | `check_path_contracts.py` 可运行 | `python scripts/check_path_contracts.py --help` 正常输出 |
| 4 | `dispatching-parallel-agents/SKILL.md` 含「路径契约表」段 | grep `路径契约表` 命中 |
| 5 | `dev-workflow.md` 含"并行派发 subagent 前必须填写路径契约表" | grep `路径契约表` 命中 |
| 6 | `README.md` 不再出现"DreamTale"（致谢段 HaloRead 例外） | grep `DreamTale` 仅命中历史说明段 |
| 7 | `bug_regression_list.md` 标题不再写"HaloRead 项目" | grep `HaloRead 项目` 无命中 |
| 8 | `dev-workflow.md` 不再出现 `python scripts/novelforge/.*\.py` | `check_path_contracts.py` 检测通过 |
| 9 | `recap-generator/SKILL.md` 不再写 `.state/hooks_registry.json` | grep `.state/hooks_registry.json` 无命中 |
| 10 | `pytest -q` 全部通过 | 退出码 0 |

### 6.4 与现有校验脚本的关系

- `check_consistency.py`（一致性，7 类漂移）：**不冲突**。本模块只校验"路径引用"，不校验"章节内容"。
- `check_ai_novel.py`（去 AI 味，10 类）：**不冲突**。本模块不涉及内容质检。
- `validate_commit_messages.py`（提交信息）：**不冲突**。本模块不涉及 git。
- `check_loop_log.py`（loop_log 一致性）：**不冲突**。本模块不涉及 loop_log 索引。
- 新增检测项：路径契约一致性是新增维度，建议在 `dev-checklist.md` 中加入"路径契约无断链"一项，由本模块的 `check_path_contracts.py` 提供。

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

**文件路径**：`file:///workspace/tests/test_path_contracts.py`

**用例清单**（至少 6 个）：

```python
"""NovelForge 路径契约回归测试。

锁定 10 项路径断链的修复，防止后续被悄悄改回去。
"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
CONTRACT_TABLE = REPO_ROOT / "docs/optimization_plan_2026_07/path_contract_table.md"
CHECK_SCRIPT = REPO_ROOT / "scripts/check_path_contracts.py"


def test_path_contract_table_exists():
    """断链修复前置：契约表文件存在且至少含 25 条契约。"""
    assert CONTRACT_TABLE.exists(), f"路径契约表不存在：{CONTRACT_TABLE}"
    content = CONTRACT_TABLE.read_text(encoding="utf-8")
    # YAML frontmatter 内 contracts 列表至少 25 条
    contract_count = len(re.findall(r"^\s+- id:\s+\w+", content, re.MULTILINE))
    assert contract_count >= 25, f"契约条目不足 25 条，实际 {contract_count}"


def test_chapter_outline_path_consistency():
    """断链 1：章纲路径必须含 vol_NN 一级。"""
    usage = (REPO_ROOT / "NovelForge_Vault/00_控制面/USAGE.md").read_text(encoding="utf-8")
    # 不应再出现 "04_大纲与脉络/ch_NNN_outline.md" 漏 vol_NN
    assert not re.search(r"04_大纲与脉络/ch_\d", usage), \
        "USAGE.md 仍含错误章纲路径（漏 vol_NN）"
    # 契约表必须含正确路径模板
    contract = CONTRACT_TABLE.read_text(encoding="utf-8")
    assert "04_大纲与脉络/vol_{vol:02d}/ch_{ch:03d}_outline.md" in contract, \
        "契约表缺少正确的章纲路径模板"


def test_recap_path_consistency():
    """断链 2：recap 文件名必须为 recap_chXXX-YYY.md。"""
    contract = CONTRACT_TABLE.read_text(encoding="utf-8")
    assert "recap_ch{start:03d}-{end:03d}.md" in contract, \
        "契约表缺少正确的 recap 路径模板"
    recap_skill = (REPO_ROOT / ".trae/skills/recap-generator/SKILL.md").read_text(encoding="utf-8")
    assert "recap_ch{start:03d}-{end:03d}.md" in recap_skill, \
        "recap-generator SKILL.md 缺少正确的 recap 文件名模板"


def test_script_invocation_consistency():
    """断链 3：dev-workflow.md 不应再出现 python scripts/novelforge/...py 形式。"""
    workflow = (REPO_ROOT / ".trae/rules/dev-workflow.md").read_text(encoding="utf-8")
    # 允许在引用历史错误时提及，但命令本身必须用 -m 形式
    forbidden = re.findall(r"python\s+scripts/novelforge/\w+\.py", workflow)
    assert not forbidden, f"dev-workflow.md 仍含旧脚本调用形式：{forbidden}"
    # 必须含新形式
    assert "python -m scripts.novelforge." in workflow, \
        "dev-workflow.md 缺少 python -m 调用形式"


def test_shortform_path_consistency():
    """断链 6：shortform 文章路径必须在 06_短文/ 下。"""
    workflow = (REPO_ROOT / ".trae/rules/dev-workflow.md").read_text(encoding="utf-8")
    # 不应再出现 shortform/YYYY-MM-DD-slug.md 错误路径
    assert not re.search(r"shortform/\d{4}-\d{2}-\d{2}-", workflow), \
        "dev-workflow.md 仍含错误 shortform 路径"
    contract = CONTRACT_TABLE.read_text(encoding="utf-8")
    assert "06_短文/article_<slug>.md" in contract or "06_短文/article_" in contract, \
        "契约表缺少 shortform 文章路径"


def test_check_path_contracts_runs():
    """断链全部修复：check_path_contracts.py 可运行且无 violation。"""
    assert CHECK_SCRIPT.exists(), f"check_path_contracts.py 不存在：{CHECK_SCRIPT}"
    # 直接 import 模块的 main 函数，避免 subprocess 开销
    import subprocess
    result = subprocess.run(
        ["python", str(CHECK_SCRIPT),
         "--skills-dir", str(REPO_ROOT / ".trae/skills"),
         "--vault", str(REPO_ROOT / "NovelForge_Vault"),
         "--strict"],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0, (
        f"check_path_contracts.py 失败（退出码 {result.returncode}）：\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
```

### 7.2 在 `bug_regression_list.md` 新增 BUG-054

按步骤 8 改动 2 的完整模板写入，标题用描述性语言「路径契约 10 项断链导致多 Agent 并行踩坑」。

### 7.3 在 `dev-checklist.md` 新增检查项

```markdown
- [ ] 路径契约一致性：`python scripts/check_path_contracts.py --skills-dir .trae/skills --vault NovelForge_Vault` 通过（无路径断链）
```

### 7.4 不新增 check_consistency.py / check_ai_novel.py 检测规则

本模块的检测维度是"路径引用一致性"，与 check_consistency.py（章节内容一致性）/ check_ai_novel.py（去 AI 味）正交，不互相覆盖。新增独立脚本 `check_path_contracts.py` 而非塞进现有脚本，符合「不过度工程化」原则。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**中**。

### 8.2 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|
| 修改 `dispatching-parallel-agents` SKILL.md 后 subagent 指令模板变长，Token 占用增加 | 中（每次并行派发多 ~300 token） | 高 | 模板精简，只列本任务相关 5-10 条；契约表全文单独存档不内联 |
| 修改 `dev-workflow.md` 后历史命令失效（如外部脚本调用 `python scripts/...`） | 低（CI 脚本已用 `python -m`） | 低 | 兼容性兜底：`scripts/novelforge/*.py` 都已设计为可直接运行（含 `if __name__ == "__main__"`），旧命令仍可工作 |
| `check_path_contracts.py` 误报（false positive）影响日常协作 | 中 | 中 | 默认非 strict 模式只告警不阻断；strict 模式仅在 CI 用 |
| 改 README/USAGE 后用户旧链接失效 | 低 | 低 | Obsidian Vault 内部双链基于文件名，不基于 README；改 README 不影响 Vault |
| 项目代号从 DreamTale → NovelForge 后某些外部引用断 | 低 | 低 | README line 184 致谢段保留 HaloRead 历史溯源；DreamTale 是早期内部代号，外部公开文档已用 NovelForge |
| `path_contract_table.md` 与脚本常量漂移（未来脚本路径变更但契约表没更新） | 中 | 中 | `check_path_contracts.py` 同时扫描脚本中的路径常量，反向校验契约表是否过时 |

### 8.3 对核心资产的影响

按 `.trae/rules/dev-workflow.md` 第四条「禁止事项」定义，NovelForge 核心资产为：

- `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口）—— **本模块不修改 `novelforge/` 目录下任何 Skill**，只修改 `dispatching-parallel-agents`（属通用工程 Skill，不在核心资产列表）。
- `NovelForge_Vault/00_控制面/style_guide.md` —— **不修改**。
- `scripts/novelforge/` —— **不修改任何现有脚本逻辑**，只新增 `scripts/check_path_contracts.py`（在 `scripts/` 根而非 `scripts/novelforge/`，因路径契约校验是工程基础设施，不属小说创作逻辑）。

修改 `dev-workflow.md` 第三步/第四步属于规则层增强，不破坏现有流程。

### 8.4 回滚方案

**分支隔离**：在 `feature/path-contract` 分支执行全部改动，主分支 `master` 保持不变。每个改动用独立 commit：

- C1: 新增 `path_contract_table.md`
- C2: 新增 `check_path_contracts.py` + `tests/test_path_contracts.py`
- C3: 修改 `dispatching-parallel-agents/SKILL.md`
- C4: 修改 `dev-workflow.md` + `dev-checklist.md`
- C5: 修复文档层断链（USAGE / README / bug_regression_list）
- C6: 修复 Skill 层断链（recap-generator / architect / writer-polisher / key-scene-archiver）
- C7: 新增 BUG-054 条目

**回滚步骤**：

1. 若发现 subagent 指令模板过长影响协作 → revert C3，保留契约表与校验脚本（契约表本身不强制注入）。
2. 若发现 `check_path_contracts.py` 误报过多 → revert C2，先停用 strict 模式，待优化正则后再启用。
3. 若发现 README/USAGE 改动引入新断链 → revert C5，单独修复。
4. 整体回滚：`git revert C1..C7` 或 `git checkout master` 丢弃整个 `feature/path-contract` 分支。

**数据备份**：本模块不涉及 Vault 数据迁移，无需备份 `.state/` 或章节正文。

---

## 九、完成标准（DoD 清单）

- [ ] `file:///workspace/docs/optimization_plan_2026_07/path_contract_table.md` 模板创建（含 YAML frontmatter + Markdown 表格，≥ 25 条契约）
- [ ] 10 项路径断链全部修复（USAGE / README / dev-workflow / bug_regression_list / 4 个 Skill 文件）
- [ ] `file:///workspace/scripts/check_path_contracts.py` 脚本可运行（`--help` 正常输出，`--strict` 退出码 0）
- [ ] `file:///workspace/.trae/skills/dispatching-parallel-agents/SKILL.md` 更新（新增「路径契约表」段 + 验证清单 2 项）
- [ ] `file:///workspace/.trae/rules/dev-workflow.md` 更新（第三步新增规则 + 第四步新增自检项 + 脚本调用形式统一）
- [ ] `file:///workspace/README.md` 项目代号统一为 NovelForge（致谢段 HaloRead 例外保留）
- [ ] `file:///workspace/tests/bug_regression_list.md` 标题改"NovelForge 项目" + 新增 BUG-054 条目
- [ ] `file:///workspace/tests/test_path_contracts.py` 6 个用例全部通过：
  - [ ] `test_path_contract_table_exists`
  - [ ] `test_chapter_outline_path_consistency`
  - [ ] `test_recap_path_consistency`
  - [ ] `test_script_invocation_consistency`
  - [ ] `test_shortform_path_consistency`
  - [ ] `test_check_path_contracts_runs`
- [ ] `python scripts/check_path_contracts.py --skills-dir .trae/skills --vault NovelForge_Vault --strict` 退出码 0
- [ ] `pytest -q` 全部通过（不破坏现有测试）
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 仍通过（不引入新一致性错误）
- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 仍通过（不引入新 AI 味错误）
- [ ] `dev-checklist.md` 新增"路径契约一致性"检查项
- [ ] loop_log 2026-07 分片追加一条沉淀（`#lesson vault_sync`，引用本模块 BUG-054）

---

## 附录 A：与 M1/M2/M3 模块的关系

| 模块 | 关系 | 协作点 |
|---|---|---|
| M1（Skill 间契约层修复） | 互补 | M1 管"产出/消费契约"（Skill 间数据流），M4 管"路径契约"（文件落点）。两者维度正交，但都依赖 dispatching-parallel-agents SKILL.md 模板。M4 完成后 M1 可在路径契约表基础上加"数据契约表"段。 |
| M2（schema 同步门禁） | 互补 | M2 修 PIPELINE_SCHEMA 字段，M4 修路径引用。两者都修改 `dev-workflow.md` 第三步/第四步，需协调避免冲突（M4 先合，M2 后合时基于 M4 版本）。 |
| M3（文档与脚本 SSOT） | 互补 | M3 管 style_guide.md 与 check_ai_novel.py 的禁用词 SSOT，M4 管路径 SSOT。两者都新增独立校验脚本（`check_doc_script_consistency.py` vs `check_path_contracts.py`），可并行开发，集成时合并到 `dev-checklist.md` 同一节。 |

并行组 A（M1/M2/M3/M4）按 master_plan 4.1 节"批次 1"全部完成后，再进入批次 2（L2 强化模块）。

## 附录 B：参考来源

- **NovelForge loop_log 2026-07 教训 1**：`file:///workspace/docs/loop_log/2026-07.md` line 90（10 项路径断链原始记录）
- **OpenAPI Specification 3.1**：https://spec.openapis.org/oas/v3.1.0（契约即文档思想）
- **gRPC proto 文件**：https://protobuf.dev/programming-guides/proto3/（单一信源 + 多语言 SDK 思想）
- **Pydantic Schema**：https://docs.pydantic.dev/latest/（Python 路径字段强类型校验）
- **Terraform Module Registry**：https://developer.hashicorp.com/terraform/registry/modules/standard（模块输入输出强声明）
- **obra/superpowers dispatching-parallel-agents**（MIT）：NovelForge `dispatching-parallel-agents` Skill 的原生来源，本模块在其基础上扩展路径契约段

## 附录 C：术语表

| 术语 | 定义 |
|---|---|
| 路径契约 | NovelForge 中某个产物（章节/状态/伏笔/recap/场景等）的标准文件路径与命名规则，由 path_contract_table.md 定义 |
| 路径断链 | Skill/脚本/文档对同一产物的路径引用不一致，导致 A 写入、B 读取失败 |
| 契约表 | path_contract_table.md 的简称，YAML frontmatter + Markdown 表格双形态 |
| 单一信源（SSOT） | Single Source of Truth，路径以契约表为唯一信源，其他文件引用而非重新定义 |
| 误报优先 | check_path_contracts.py 宁可多报疑似断链，不静默放过真实断链 |
| subagent 指令模板 | dispatching-parallel-agents SKILL.md line 95-114 定义的 query 参数模板 |

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 多专家团（M4 路径契约表模板）
**依赖**：无（与 M1/M2/M3 同属并行组 A，互不依赖）
**下游影响**：M20 自检清单升级将汇总本模块的 `check_path_contracts.py` 检测项
