# 项目开发协作流程规则

本规则用于指导 Agent 在 Trae IDE 中与用户进行**NovelForge AI 小说创作协作**时的默认行为。
详细项目背景见 [README.md](../../README.md)。

NovelForge 是基于 Trae IDE + Obsidian Vault 的极简 AI 小说创作系统，支持双模式：
- **novel 模式**：100w 字+ 纯虚构长篇网文
- **shortform 模式**：3-6k 字公众号文章

## 零、适用范围与边界声明

### 1. 适用场景

本规则**仅适用于 NovelForge 创作协作对话**——即用户在 Trae 中讨论小说/公众号内容生成、章纲设计、状态机维护、伏笔铺设、Bug 修复、流程优化、方案评审等创作类任务时。

**不适用于**：Trae IDE 本身的产品功能咨询、与 NovelForge 创作无关的纯技术问答。这些由 Trae 内置能力或对应 Skill 负责，本规则不干预。

### 2. Trae Skill 能力边界（必须如实遵守）

| 能力 | Skill 是否支持 |
|---|---|
| 识别用户意图、加载规范、引导 Agent 行为 | 支持 |
| 让 Agent 调用 RunCommand / Read / Edit 等内置工具 | 支持（通过 Prompt 引导） |
| **创建 / 调度 sub-agents** | **不支持** |
| **直接调用 MCP tools** | **不支持** |
| 执行代码、保存文件、维护状态 | **不支持** |

**重要**：当用户提到"启用多个 agent""专家团并行""多 Agent 评审"时，不要假装 Skill **文件本身**可以调度子 Agent。可行路径有三条：
- **路径 C（主路径）**：主 Agent 经 Skill 引导，用 Trae `Task` 工具（`subagent_type` 参数）在**当前会话内**启动多个 subagent 并行执行，主 Agent 汇总。无需外部依赖。调度纪律见 `.trae/skills/dispatching-parallel-agents/SKILL.md`。
- **路径 A**：由单个 Agent 串行切换视角（架构师→测试→规则），伪并行。仅当 Task 工具不可用时降级使用。
- **路径 B**：Skill 触发本地 Python 脚本（如 `python scripts/review_plan.py`），由 Python 引擎（LangGraph）做真并行。需 `.env` + `langgraph` 已安装，环境缺失时降级到路径 C。

**能力边界澄清**：上表"创建/调度 sub-agents 不支持"指 **Skill 文件本身**不调度；主 Agent 经 Skill 引导后调用 `Task` 工具启动 subagent 不违反此约束——Skill 只引导，执行靠主 Agent + 原生工具。

NovelForge 的 5 核心 Skill + 4 守护 Skill + 主入口均遵循此边界：它们只负责加载创作规范、引导 Agent 调用 Read/Edit/RunCommand 等工具读写 Vault 文件，不自行调度子 Agent，也不直接调用 MCP。若需要真并行评审（如多视角评审章纲），由主 Agent 用 `Task` 工具启动 subagent（路径 C，主路径），或触发本地 Python 脚本（路径 B，可选增强，需 `langgraph` 已安装）。

## 一、默认协作流程（每次开发对话自动生效）

收到用户的开发类需求后，**必须按以下顺序执行**，不可跳步：

### 第一步：重述需求

用一句话重述用户意图，确认理解一致。格式：

> 我理解你要做的是：____（一句话）。核心目标是：____（用户原话或提炼）。

如果用户已明确给出核心目标，直接引用；如果没有，主动提炼并标注"（我提炼的，请确认）"。

示例（novel 模式）：

> 我理解你要做的是：生成第 42 章章纲，核心冲突是主角与赵师兄对决。核心目标是：完成 ch_042 章纲并通过一致性校验。

### 第二步：生成计划并等确认

围绕核心目标列出计划要点，**等用户确认后再执行**。计划格式：

```
## 计划
- 核心目标：____
- 步骤：
  1. ____
  2. ____
  3. ____
- 涉及文件：____
- 风险点：____
```

**不要在用户确认前开始改代码。** 如果用户说"直接做""开始吧""嗯"等明确同意的话，才进入第三步。

### 第三步：执行

**开始前必读创作焦点**：
1. 读取 `NovelForge_Vault/00_控制面/current_focus.md`，确认当前卷/章进度、待处理伏笔、本轮创作焦点。
2. 读取 `NovelForge_Vault/00_控制面/author_intent.md` 的 **L0 摘要版**（作者意图全局锚点：世界观核心、主角弧光、爽点曲线、风格基调），确保本次创作不偏离作者核心意图。
3. 若本次任务涉及特定角色/场景，额外读取 `.state/characters/`、`.state/worldbuilding/` 下对应状态文件，对齐状态机。
4. 若任务与历史教训可能相关，再用 Grep 检索 `docs/loop_log/` 分片，引用命中的稳定锚点作为前置参考。

**禁止**：跳过 current_focus / author_intent 直接生成内容，会导致状态漂移和意图漂移。必须先读取对齐，方可进入执行。

执行时遵守以下规范：

- **优先复用现有能力**：先查 `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口）、`.trae/rules/`、`.trae/checklists/`、`scripts/novelforge/` 是否已有可复用的 Skill / 规则 / 脚本，避免重复造轮子。
- **并行提速**：能并行的子任务尽量并行（用 Task 工具启动多个 subagent，或调用 Python 脚本做真并行）。例如多章章纲并行生成、多视角并行评审。
- **遵循现有目录结构与命名规范**：novel 模式章节文件遵循 `NovelForge_Vault/卷名/vol_NN/ch_NNN.md` 三级路径；shortform 模式文章遵循 `NovelForge_Vault/shortform/YYYY-MM-DD-slug.md`；`.state/` 目录禁止手动编辑，只能由 Skill/脚本读写。
- **不过度工程化**：只做直接请求或必要的事，不主动加抽象、加配置、加兼容层。能用规则文件解决的不写 Skill；能用 Skill 引导的不写 Python。
- **合并前必须清零所有校验问题**：执行 `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault`（一致性：伏笔回收、角色状态、时间线、金手指强度曲线、节奏曲线）和 `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault`（去 AI 味：信息倾倒、金手指滥用、爽点套路化、语言指纹、心理-生理映射）两项全部通过后方可进入合并/推送。若发现非本次引入的问题，仍须修复；修复后判断是否为会复发的状态漂移/一致性 bug，需要补充回归测试并按 `.trae/rules/bug-reporting.md` 更新 `tests/bug_regression_list.md`。
- **push 前必须校验提交信息**：执行 `python scripts/validate_commit_messages.py origin/master..HEAD`，确保标题与正文均为中文，且准确概括当前修改。scope 示例：`feat(novelforge): 新增伏笔回收检测` / `state(ch_042): 同步主角境界至筑基后期` / `content(vol_01/ch_001): 生成第 1 章正文`。具体规范见 `.trae/skills/git-merge-guardian/SKILL.md`。

### 第四步：自检

完成后**主动启用自检**，对照 `.trae/checklists/dev-checklist.md` 逐项检查并修复。也可由用户触发 `.trae/skills/dev-selfcheck/SKILL.md`。

自检必须包含：
- `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 通过（一致性）。
- `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 通过（去 AI 味）。
- `pytest` 全部通过（脚本/工具链单测）。
- 若修复了历史遗留或会复发的状态漂移/一致性 bug，已补充回归测试或更新 `tests/bug_regression_list.md`。

### 第五步：沉淀（LoopAgent 思维）

每次创作/开发完成后，做一次沉淀复盘：

- 本次改动是否暴露了创作流程的新共性问题（如反复状态漂移、伏笔遗漏、上下文预算超限）？
- 是否需要更新 `.trae/rules/` 或 `scripts/novelforge/check_consistency.py` / `check_ai_novel.py` 的检测项？
- 是否需要更新 `.trae/checklists/dev-checklist.md`？
- 是否需要在 `docs/loop_log/YYYY-MM.md` 当月分片追加一条开发沉淀记录？

**loop_log 写入流程**：
1. 只 append 到当月分片（如 `docs/loop_log/2026-07.md`），不要修改 `docs/loop_log.md` 主文件。
2. 主文件的索引区、教训计数表、稳定锚点由 `scripts/regen_loop_log_index.py` 自动生成，**禁止手写索引条目、禁止手动改计数表、禁止手写 `#L` 行号锚点**。
3. 新增/修改分片后，运行 `python scripts/regen_loop_log_index.py` 重生成主文件，再运行 `python scripts/check_loop_log.py` 校验。
4. 若当月分片不存在，新建 `docs/loop_log/YYYY-MM.md`（文件名格式 `YYYY-MM.md`）。

**loop_log 写入门槛**（启发式，不强制白名单）：

写了不亏的（建议写）：
- 暴露了创作流程的共性/反复问题（非单章 bug），如某类状态字段反复漂移、某类伏笔反复遗漏
- 产出了可复用资产/方法论（如上下文预算分配策略、爽点曲线设计模板、去 AI 味检查清单）
- 触发了规则/checklist/Skill 的实际更新

别往 loop_log 写的（去对应文件）：
- 单章生成日志 → 去 commit message 或章节 frontmatter
- 单点 bug 修复（如某一章境界跳级）→ 去 `tests/bug_regression_list.md`
- 纯 Vault 配置调整 → 去 commit message 或 README

**写 loop_log 时必带的 #lesson slug**（从下表选，多选用空格分隔）：
- `git_hygiene`（Git 卫生/提交规范） / `state_drift`（状态机漂移/角色一致性） / `content_quality`（内容质量/去 AI 味） / `plot_structure`（伏笔回收/情节结构/节奏曲线） / `context_budget`（上下文预算/Token 管理） / `shortform`（公众号模式特有问题） / `vault_sync`（Vault 同步/索引/master_index）

完整 slug 主题表与方案 C 手册见 `docs/loop_log.md` 主文件末尾。

**目标**：让创作协作本身也变成可迭代的 Loop，沉淀经验，避免同类问题反复出现。

## 二、提示词固化（无需用户每次粘贴）

用户此前每次对话都要粘贴下面这段提示词：

> 启用多个 agent 组成专家团理解下面的创作需求，并使用 skills 和 checklist 规范执行，用多个 agent 并行提速，完成后启用专家团检查并修复完成，采用 loop agent 的思维来优化这个小说项目；主要是得添加核心目标，然后围绕目标去实现

本规则已将这段提示词拆解为上述五个步骤并固化为默认行为。**用户不再需要手动粘贴**。

对应关系：

| 提示词原文 | 固化到 |
|---|---|
| "启用多个 agent 组成专家团理解下面的创作需求" | 第一步重述需求 + 第二步生成计划；如需真并行评审（如架构师/编辑/读者三视角评审章纲），由主 Agent 用 `Task` 工具启动 subagent（路径 C） |
| "使用 skills 和 checklist 规范执行" | 第三步执行中的"优先复用现有能力"（先查 `.trae/skills/novelforge/`） + 第四步自检对照 checklist |
| "用多个 agent 并行提速" | 第三步执行中的"并行提速"（如多章章纲并行生成、多视角并行评审） |
| "完成后启用专家团检查并修复完成" | 第四步自检（含 check_consistency.py + check_ai_novel.py 双校验） |
| "采用 loop agent 的思维来优化这个小说项目" | 第五步沉淀 |
| "主要是得添加核心目标，然后围绕目标去实现" | 第一步重述需求中的"核心目标" + 第二步计划中的"围绕核心目标" |

## 三、语言风格

- 中文为主，自然口语化。
- 重述需求时简洁明了，不堆砌背景。
- 计划要点用列表，不用大段文字。
- 执行过程中及时汇报进度，不沉默操作。
- 自检报告用清单形式，标注通过/未通过。

## 四、禁止事项

- **不在用户确认前改代码**（含 Vault 中的章节/状态文件）。
- **不假装 Skill 可以调度 sub-agents**——做不到就如实说明，给出路径 A 或路径 B 的替代方案。
- **不破坏 NovelForge 核心资产**：`.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口）、`NovelForge_Vault/00_控制面/style_guide.md`、`scripts/novelforge/` 是 NovelForge 的核心资产，不在本规则修改范围外——如需改动须明确说明理由并经用户确认。
- **不过度工程化**：能用规则文件解决的不写 Skill；能用 Skill 引导的不写 Python；只有真需要多 Agent 并行时才动用 LangGraph。
- **不跳过沉淀**：每次创作/开发完成后都要做第五步沉淀复盘，哪怕只是"本次无新沉淀"也要说明。
- **禁止以「问题非本次引入」为由跳过修复**：合并/推送前 `check_consistency.py`、`check_ai_novel.py`、`pytest`、回归测试集必须全部通过。
- **禁止在存在任何校验问题时执行 push/merge**：包括 P2 级别问题。
- **禁止手动编辑 `.state/` 目录**：状态机文件只能由 Skill/脚本读写，手动编辑会导致状态漂移。
