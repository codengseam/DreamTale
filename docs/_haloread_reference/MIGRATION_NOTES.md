# HaloRead → NovelForge 迁移记录

本目录是从 HaloRead（讲书笔记生成引擎）剥离的讲书专属资产备份，供 NovelForge 后续 Phase 参考复用。NovelForge 从 HaloRead 的 `aiwork` 分支演进，剥离讲书专属资产后保留通用工程基础设施。

**剥离时间**：2026-07-07
**剥离执行**：NovelForge 剪枝 Phase（剥离 HaloRead 讲书专属资产）
**原项目分支**：`aiwork`（基于 HaloRead master）

---

## 一、剥离资产清单与去向

### 1. Trae Skills（讲书专属）

| 资产 | 去向 | 后续复用建议 |
|---|---|---|
| `.trae/skills/deep-reading/` | `docs/_haloread_reference/skills/deep-reading/` | 整套讲书 Skill 体系（含 SKILL.md、rules.md、rules-fiction.md、rules-knowledge.md、rules-modern.md、content-quality.md、zizhi-continuation-rules.md）。**NovelForge 不直接复用**，但 `rules-fiction.md` 已单独备份（见下），作为 shortform 模式底座参考。 |
| `.trae/skills/content-review/` | `docs/_haloread_reference/skills/content-review/` | **方法论高价值**：Layer1 规则层（check_char_count.py、check_consistency.py、review_content.py）+ Layer2 LLM 三视角并行质检的双层架构。NovelForge 的 `check_consistency.py` 和执笔审计层会借鉴此模式。详见下文「核心方法论复用」。 |

### 2. rules-fiction.md（fiction 桶规则，特殊备份）

| 备份位置 | 用途 |
|---|---|
| `docs/_haloread_reference/rules-fiction.md.bak` | 原始备份，NovelForge 后续 Phase 引用时使用 |
| `NovelForge_Vault/03_素材库/writing_techniques/rules-fiction-reference.md` | 复制到 Vault 素材库，作为 NovelForge shortform 模式（公众号半历史）的写作规则底座 |

`rules-fiction.md` 是 HaloRead 三桶 archetype（narrative/modern/knowledge）中 narrative 桶的写作规则，定义了「讲事情/讲人物/讲背景/讲道理/问道悟道」五段结构。NovelForge shortform 模式继承此结构骨架，但需重写为小说笔法。

### 3. Python 编排引擎（LangGraph 依赖，整目录剥离）

| 资产 | 去向 | 性质 | 后续复用建议 |
|---|---|---|---|
| `src/agents/` | `docs/_haloread_reference/src/agents/` | 13 个 Specialist Agent（biographer、chief_editor、content_reviewer、critic、editor、historian、orchestrator、philosopher、tone_setter 等）+ `from langgraph` 依赖 | **NovelForge 不复用**——NovelForge 走 Trae Skill 路径，不走 Python LangGraph 编排。但 `tone_setter.py`（定调节点）和 `chief_editor.py`（总编一票否决）的设计模式可参考用于 NovelForge 的「定调 Skill」和「总编 Skill」。 |
| `src/core/` | `docs/_haloread_reference/src/core/` | workflow.py、content_review_workflow.py、plan_review_workflow.py、state.py，全部 `from langgraph.graph import StateGraph` | **NovelForge 不复用**——LangGraph 编排被 Trae Skill + Task 工具替代。但 `workflow.py` 的「边链裁剪」思路（按 archetype 反查 specialist 名单动态注册节点）可参考用于 NovelForge 的双模式路由。 |
| `src/utils/quality.py` | `docs/_haloread_reference/src/utils/quality.py` | 讲书五维度质检核心（真实性/可读性/顺序/引用/灵魂），含 `check_ai_cliches`、`check_numeric_facts`、`check_chapter_title_soul` | **检测逻辑高价值**：NovelForge 的小说质检会参考其规则引擎设计，但需重写为小说维度（人物一致性/情节连贯/视角统一/去 AI 味等）。 |
| `src/utils/content_quality.py` | `docs/_haloread_reference/src/utils/content_quality.py` | 双轨质检编排（纯规则 + LangGraph 三视角），依赖 quality、consistency | **双层架构高价值**：见下文「核心方法论复用」。 |
| `src/utils/consistency.py` | `docs/_haloread_reference/src/utils/consistency.py` | 一致性检查（人物世系、年份、术语），依赖 quality | **检测维度参考**：NovelForge 的 `check_consistency.py` 会借鉴其 dataclass + 规则匹配模式，但检查对象从「古籍人物世系」改为「小说人物设定」。 |
| `src/web/` | `docs/_haloread_reference/src/web/` | 静态站点阅读器（Flask app + 静态 HTML/CSS/JS，含沉浸模式/翻页/壁纸/自动阅读） | **NovelForge 不复用**——NovelForge 走 Obsidian Vault 原生阅读，不建独立站点。但移动端交互模式（BUG-021 教训：纯 CSS 沉浸模式、不调用 Fullscreen API）可作为 NovelForge 阅读体验设计的反面参考。 |

### 4. 内容与素材

| 资产 | 去向 | 后续复用建议 |
|---|---|---|
| `output/` | `docs/_haloread_reference/output/` | 讲书笔记成品（16+ 专栏、数百篇 Markdown） |
| `output/洛克菲勒/`（额外备份） | `docs/_haloread_reference/fiction_samples/洛克菲勒/` | **fiction 桶实战样本**：NovelForge shortform 模式的参考语料，展示了 narrative 桶五段结构如何落地为半历史小说笔法。后续 shortform Skill 设计时可引用此样本作为「好例子」。 |
| `book-sources/` | `docs/_haloread_reference/book-sources/` | 讲书源材料（MySQL实战45讲、数据结构与算法之美、大厂晋升指南等专栏的源章节） |
| `demos/` | `docs/_haloread_reference/demos/` | 圣人画像 demo（saints_hall.html + images/） |
| `prompts/` | `docs/_haloread_reference/prompts/` | 13 个 Specialist Agent 的提示词（narrative/modern/knowledge 三桶分目录）+ CHANGELOG.md。**NovelForge 不直接复用**（讲书 specialist 提示词），但提示词工程组织方式（按桶分目录 + 共用层/差异化层）可参考。 |
| `site/` | `docs/_haloread_reference/site/` | 已构建的静态站点（含 A-feishu/B-classic/C-minimal 三版本） |
| `config.yaml` | `docs/_haloread_reference/config.yaml.bak` | 讲书配置（archetype 分桶映射、section_templates、trusted_domains、MCP 服务器映射）。**section_templates 的分桶思路**可参考用于 NovelForge 双模式（novel/shortform）的段名模板设计。 |
| `RULES.md` | `docs/_haloread_reference/RULES.md.bak` | 讲书写作规则从库副本（讲事情/讲人物/讲背景/讲道理/问道悟道 + 引用规范）。NovelForge 不复用，但「五段结构 + 引用克制」的写作骨架可参考。 |

### 5. Scripts（讲书专属脚本）

| 资产 | 去向 | 后续复用建议 |
|---|---|---|
| 22 个讲书专属脚本 | `docs/_haloread_reference/scripts/` | 见下表分类 |

**讲书专属脚本分类**：

- **结构校验类**（可参考用于 NovelForge 结构校验）：`check_book_structure.py`、`check_chapter_order.py`、`check_duplicates.py`、`remove_duplicates.py`、`remove_module_prefixes.py`、`fix_kaogong_sort.py`、`fix_zizhi_chapter_sort.py`、`migrate_stages.py`
- **内容质检类**（可参考用于 NovelForge 内容质检）：`check_char_count.py`、`check_consistency.py`、`extract_references.py`、`reduce_citations.py`、`review_content.py`、`score_aggregate.py`、`fix_content_issues.py`、`fix_punctuation.py`
- **站点构建类**（NovelForge 不复用）：`build_site.py`、`download_sage_portraits.py`、`migrate_wellness_books.py`、`normalize_diet_headings.py`
- **规则同步类**（NovelForge 不复用）：`sync_rules.py`（讲书 rules.md → RULES.md 同步）
- **Plan 评审类**（路径 B LangGraph 引擎，NovelForge 不复用）：`review_plan.py`

### 6. Docs（讲书专属文档）

| 资产 | 去向 | 后续复用建议 |
|---|---|---|
| `docs/algorithm-column/` | `docs/_haloread_reference/docs/algorithm-column/` | 算法专栏规划 |
| `docs/archetype-design/` | `docs/_haloread_reference/docs/archetype-design/` | **archetype 设计文档**：双维度正交（category/archetype）、三桶分桶、边链裁剪的设计思路。NovelForge 双模式（novel/shortform）路由可参考此设计哲学。 |
| `docs/comments-system/` | `docs/_haloread_reference/docs/comments-system/` | 评论系统设计 |
| `docs/feedback-loop/` | `docs/_haloread_reference/docs/feedback-loop/` | 反馈闭环设计 |
| `docs/reviews/` | `docs/_haloread_reference/docs/reviews/` | AB 盲测、灵魂注入 spec、Plan review 等评审记录。**soul-injection-spec-20260626.md** 可参考用于 NovelForge 去 AI 味设计。 |
| `docs/superpowers/` | `docs/_haloread_reference/docs/superpowers/` | deep-reading master plan + 4 track 开发规划 |
| `docs/financial-freedom-references.md` | `docs/_haloread_reference/docs/` | 财务自由参考文档 |

---

## 二、核心方法论复用（重点）

### 1. content-review 双层架构（Layer1 规则层 + Layer2 LLM 三视角）

**原 HaloRead 实现**：
- **Layer1 规则层**：纯 Python 规则检测（`check_char_count.py` 字数、`check_consistency.py` 一致性、`review_content.py` 综合），快速、确定性、零成本。
- **Layer2 LLM 三视角**：LangGraph 编排三个 subagent 并行（史实核验 / 可读性 / 引用克制），再 summarize。慢、贵、但能捕获语义级问题。
- **双轨触发**：先跑 Layer1 拿确定性结论，再触发 Layer2 做语义深检，结果合并打分。

**NovelForge 复用建议**：
- NovelForge 的 `check_consistency.py`（执笔审计层）采用 Layer1 模式：纯规则检测人物设定一致性、时间线、视角统一等，零 LLM 成本。
- NovelForge 的「总编 Skill」采用 Layer2 模式：LLM 三视角并行评审（人物弧光 / 情节张力 / 去 AI 味），可由主 Agent 用 Task 工具启动 subagent 实现，无需 LangGraph。
- 双轨触发逻辑保留：执笔审计层先跑，总编 Skill 后跑，结果合并。

### 2. 五维度质检评分体系

**原 HaloRead 维度**：真实性 35 + 可读性 25 + 顺序 15 + 引用克制 10 + 灵魂 15 = 100 分，≥85 合格。

**NovelForge 适配建议**（待 Phase 重写）：
- 真实性 → **人物一致性**（设定不漂移、对话符合人设）
- 可读性 → **可读性**（去 AI 味、节奏、对白自然度）
- 顺序 → **情节连贯**（因果链、时间线、伏笔回收）
- 引用克制 → **去 AI 味**（套路句式、转折词、升华段）
- 灵魂 → **灵魂**（人物弧光、主题深度、情感冲击）
- 评分阈值与权重待 NovelForge Phase 重新校准。

### 3. 章回体灵魂标题三维度评分

**原 HaloRead 实现**：信息密度(0-2) / 灵魂指向(0-2) / 呼应节奏(0-1)，<3 分必重写，5 好 4 坏模式 + 决策树，由 `quality.py` 的 `check_chapter_title_soul` 自动拦截。

**NovelForge 复用建议**：`chapter-title-soul` Skill 已保留在原位（待 Phase 5 改写为小说版），三维度评分框架可保留，但「灵魂指向」从「史观穿透」改为「人物弧光/主题深化」。

### 4. archetype 边链裁剪思路

**原 HaloRead 实现**：`build_workflow` 从 `SECTION_TEMPLATES[archetype]` 反查所需 specialist 名单，按需 `add_node` + `add_edge`，未映射者不注册，避免占位节点产空段。

**NovelForge 复用建议**：双模式（novel/shortform）路由可借鉴——根据模式反查所需 Skill 链路，按需启用，避免通用 Skill 被错误模式调用。

---

## 三、保留在原位的通用工程资产（NovelForge 核心）

以下资产未剥离，构成 NovelForge 的通用工程基础设施：

### Trae Skills（10 个，保留原位）
- **9 个通用 Skill**：dev-selfcheck、git-merge-guardian、tdd、plan-review、dispatching-parallel-agents、verification-before-completion、receiving-code-review、writing-plans、systematic-debugging
- **chapter-title-soul**：待 Phase 5 改写为小说版

### 规则与清单（待另一个 agent 改写，未动）
- `.trae/rules/dev-workflow.md`、`.trae/rules/bug-reporting.md`
- `.trae/checklists/dev-checklist.md`、`.trae/checklists/book-structure-checklist.md`、`.trae/checklists/content-checklist.md`

### 沉淀机制（保留，内容待 Phase 7 清空重写）
- `docs/loop_log/`、`docs/loop_log.md`、`docs/archive/`
- `tests/bug_regression_list.md`、`tests/run_regression_suite.sh`

### 通用脚本（5 个，保留原位）
- `scripts/regen_loop_log_index.py`、`scripts/check_loop_log.py`、`scripts/validate_commit_messages.py`、`scripts/branch_governance.py`、`scripts/install-git-hooks.sh`

### Git 与 CI
- `githooks/pre-push`、`.github/workflows/`（branch-cleanup.yml、deploy-modelscope.yml、pages.yml、regression.yml）
- `.gitignore`、`.env.example`

### src/ 保留部分
- `src/main.py`、`src/__init__.py`
- `src/storage/`（file_manager.py、metadata_store.py、vault_sync.py，纯文件操作，不依赖 langgraph）
- `src/tools/`（obsidian_writer.py、pdf_reader.py、source_cache.py、web_search.py，纯工具）
- `src/utils/`（config.py、llm.py、logger.py、markdown.py、prompts.py、sorting.py、sources.py、__init__.py）

### docs/ 保留
- `docs/git-merge-prompt.md`（通用 Git 流程）

---

## 四、未完成事项与待主 Agent 确认

1. **NovelForge_Vault 复制步骤已完成**：任务执行中发现 NovelForge_Vault 已被另一个 agent 创建（含 00_控制面/、01_世界观/），已创建 `03_素材库/writing_techniques/` 子目录并复制 `rules-fiction-reference.md`。
2. **tests/ 目录未处理**：tests/ 下有 39 个测试文件，多数依赖被剥离的 src/agents、src/core、src/utils/quality.py（如 test_workflow.py、test_orchestrator.py、test_editor.py、test_quality.py、test_consistency.py 等），剥离后会失效。任务规则未明列 tests/ 处理（仅要求保留 bug_regression_list.md 模式），故未动。**待主 Agent 确认**：是否在 Phase 7 清空重写 tests/，或现在剥离失效测试。
3. **package.json / package-lock.json / requirements.txt 未处理**：顶层这三个依赖文件，package.json 可能是讲书站点构建（site/）的依赖，requirements.txt 可能含 langchain/langgraph 依赖。任务规则未明列，故未动。**待主 Agent 确认**：是否在后续 Phase 清理依赖文件。
4. **src/utils/llm.py 依赖 langchain**：llm.py 不在剥离列表（仅 quality/content_quality/consistency 三文件明列剥离），但其 `from langchain_openai import ChatOpenAI` 是讲书 LangGraph 编排链路依赖，NovelForge 不需要 langgraph。已保留在原位。**待主 Agent 确认**：是否在 Phase 5+ 剥离 llm.py 或重写为 NovelForge 的 LLM 调用层。
5. **.trae/checklists/book-structure-checklist.md、content-checklist.md**：这两个 checklist 是讲书专属（书结构、内容质检），但任务规则要求"不修改 .trae/checklists/（另一个 agent 在改写）"，故未动。待另一个 agent 处理。
6. **.trae/documents/孔子人物卡片Demo方案.md**：讲书专属 demo 方案文档，任务规则未明列。已保留原位。**待主 Agent 确认**是否剥离。
