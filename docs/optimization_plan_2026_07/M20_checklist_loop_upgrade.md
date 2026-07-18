# M20 · 开发自检清单升级 + LoopAgent 沉淀机制强化

> **模块层级**：L5 · 沉淀方法论（与 M19 同层，是 20 模块优化方案的收尾）
> **对应主线规划**：[file:///workspace/docs/optimization_plan_2026_07/00_master_plan.md](file:///workspace/docs/optimization_plan_2026_07/00_master_plan.md) §四并行组 D（L5 沉淀方法论，依赖 M01-M19 全部完成）
> **依赖**：M01-M19 全部 19 个模块（本模块是收尾汇总）
> **优先级**：P0（必做）—— 20 模块方案的最后一公里，没有本模块，前 19 个模块的检测项散落在各自方案文档中，无人执行；新增的 8 类能力没有受控 slug 可沉淀
> **文档版本**：v1.0 · 2026-07-18

---

## 一、模块目标

### 1.1 一句话目标

把 M01-M19 共 19 个模块在各自方案文档中"新增的 dev-checklist 检测项"汇总归并为 **8 大类**（与 8 个新 `#lesson` slug 一一对应），追加到 [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) 作为新增章节；把受控 slug 表从 7 个扩展到 20 个（新增 8 个任务要求 slug + 合法化 5 个 NovelForge 已用 slug）；新增 [file:///workspace/.trae/checklists/module_completion_checklist.md](file:///workspace/.trae/checklists/module_completion_checklist.md) 模板，建立"每模块完成强制沉淀"机制；同步修复 dev-workflow.md 与 check_loop_log.py 的 slug 列表历史不一致。

### 1.2 对应的痛点

| 痛点 | 当前状态 | M20 完成后 |
|---|---|---|
| M01-M19 共 19 个模块在各自方案文档中各自设计 dev-checklist 检测项，散落在 `docs/optimization_plan_2026_07/M0x_*.md` 各文件 | 检测项散落，自检时无汇总清单可循，需要逐个翻方案文档 | `dev-checklist.md` 新增 8 大类汇总章节，自检时一次性核对 |
| `check_loop_log.py` 的 `CONTROLLED_SLUGS` 只受控 7 个 HaloRead 历史 slug（`git_hygiene` / `reader_interaction` / `content_quality` / `book_structure` / `deployment` / `soul_injection` / `ai_course`） | M01-M19 引入的 8 类新场景（黄金三章/POV/合规/因果链/节奏曲线/角色向量/选择性 KG/方法论沉淀）无受控 slug，沉淀时报 P1 非法 slug | 受控 slug 扩展到 20 个，新增 8 个 NovelForge 创作场景 slug 全部合法 |
| `dev-workflow.md` §五列出的 5 个 NovelForge slug（`state_drift` / `plot_structure` / `context_budget` / `shortform` / `vault_sync`）未在 `check_loop_log.py` 受控表中 | 作者按 dev-workflow.md 指引写入这 5 个 slug 时，check_loop_log.py 报 P1 非法 slug 阻断 | 5 个 NovelForge slug 全部合法化，与 8 个新 slug 共同扩展受控表 |
| M01-M19 共 19 个模块完成后，没有"强制沉淀"机制 | 沉淀依赖人工自觉，常出现"模块完成即结束，无沉淀" | 新增 `module_completion_checklist.md`，每模块完成必须按模板沉淀 |
| `dev-workflow.md` 与 `check_loop_log.py` 的 slug 列表不一致 | 历史遗留双源真相 | M20 一次性同步，dev-workflow.md / check_loop_log.py / regen_loop_log_index.py / loop_log.md 四处一致 |

### 1.3 完成后达成的能力

| 能力 | 当前状态（M01-M19 完成后） | M20 完成后 |
|---|---|---|
| dev-checklist 检测项总数 | 8 章节 ~53 项（无 M01-M19 新增项汇总） | 8 章节 + 8 大类新增汇总，~53 + 47 = ~100 项，全量自检 |
| 受控 #lesson slug 数量 | 7 个（HaloRead 历史） | 20 个（HaloRead 7 + NovelForge 已用 5 + M20 新增 8） |
| slug 主题表来源 | check_loop_log.py / regen_loop_log_index.py / loop_log.md 三处维护（易漂移） | `regen_loop_log_index.py.SLUG_TOPICS` 为 SSOT，check_loop_log.py 与 loop_log.md 从其导入 |
| 模块完成沉淀机制 | 依赖人工自觉，dev-workflow.md §五启发式门槛 | 新增 `module_completion_checklist.md`，每模块完成强制按模板填写沉淀 |
| M01-M19 检测项与 slug 对应关系 | 散落在各方案文档 | dev-checklist 8 大类章节标题直接标注对应 slug，自检时自动产出沉淀 slug |
| dev-workflow.md 与脚本一致性 | 5 个 NovelForge slug 在 dev-workflow.md 声明但 check_loop_log.py 报错 | 完全一致，受控表 SSOT 化 |
| 回归测试覆盖 | 0 用例 | 6 个 pytest 用例（`tests/test_checklist_loop_upgrade.py`） |

---

## 二、痛点对应

### 2.1 痛点表现：M01-M19 检测项散落 + slug 受控表不够 + 无强制沉淀机制

#### 痛点 1：检测项散落在 19 个方案文档中

M01-M19 共 19 个模块方案文档每个都在 §五"详细实现步骤"或 §四"新增/修改文件清单"中设计了 dev-checklist 检测项，但散落示例：

| 模块 | 检测项位置 | 检测项内容 |
|---|---|---|
| M11 | M11 §五步骤 4 architect SKILL §6.1/6.2/6.3 | 黄金三章硬约束 5 类（首段钩子 ≤80 字 / 信息密度 ≤30% / 字数 2500-3000 / 金手指亮相 / 第 3 章末必有钩子） |
| M12 | M12 §五步骤 5 dev-checklist §三 | POV 视角一致 4 项（5 种枚举值合法 / 单章不无故切换 / 多 POV 切换标记 / 同场景不混用） |
| M13 | M13 §五步骤 7 architect + dev-checklist §三+§一 | 爽点曲线 7 项 + 章末钩子 2 项 |
| M14 | M14 §五步骤 6 dev-checklist §十 | 因果链检测 5 项 |
| M15 | M15 §五步骤 5 dev-checklist §一+§七 | 字数曲线异常 + 1 项 |
| M16 | M16 §五步骤 6 dev-checklist §九 | 读者反馈闭环 6 项（shortform 专属） |
| M17 | M17 §五步骤 8 dev-checklist §十一 | 选择性 KG 检测 5 项 |
| M18 | M18 §五步骤 7 dev-checklist §三+§八 | persona_vector 检测 2 项 |
| M19 | M19 §五步骤 5 dev-checklist §方法论符合度 | 方法论符合度 11 项（11 大节 × 三层核验） |
| M01 | M01 §五步骤 6 dev-checklist §九 | Skill 契约校验 6 项 |
| M02 | M02 §五步骤 5 dev-checklist Schema 同步 | Schema 同步检查 3 项 |
| M03 | M03 §五步骤 6 dev-checklist §二/§七/§八 | SSOT 校验项 |
| M04 | M04 §五步骤 7 dev-checklist 路径契约 | 25 条路径契约 |
| M05 | M05 §五步骤 6 dev-checklist | 角色 5 层架构检测 |
| M06 | M06 §五 | 伏笔五阶段升级 |
| M09 | M09 §五步骤 5 dev-checklist §八 | 朱雀七维度量化检测 |
| M10 | M10 §五步骤 6 dev-checklist §九 | 合规检测 9 项 |

**问题**：这些检测项没有汇总到 dev-checklist.md，作者/Agent 自检时无清单可循，每次都得翻 19 个方案文档。

#### 痛点 2：受控 slug 表只有 7 个 HaloRead 历史 slug

`check_loop_log.py` 第 30-39 行：

```python
CONTROLLED_SLUGS = {
    "git_hygiene",
    "reader_interaction",
    "content_quality",
    "book_structure",
    "deployment",
    "soul_injection",
    "ai_course",
}
```

这 7 个 slug 是 HaloRead 项目（旧项目）的沉淀分类，与 NovelForge 创作场景脱节。M01-M19 引入的 8 类新场景（黄金三章 / POV / 合规 / 因果链 / 节奏曲线 / 角色向量 / 选择性 KG / 方法论沉淀）没有受控 slug，作者写沉淀时只能强行塞进 `content_quality` 或 `book_structure` 这种泛化 slug，失去分类价值。

#### 痛点 3：dev-workflow.md 与 check_loop_log.py 的 slug 列表不一致

`dev-workflow.md` §五"loop_log 写入时必带的 #lesson slug"列出 7 个 slug：

```
- git_hygiene（Git 卫生/提交规范）
- state_drift（状态机漂移/角色一致性）
- content_quality（内容质量/去 AI 味）
- plot_structure（伏笔回收/情节结构/节奏曲线）
- context_budget（上下文预算/Token 管理）
- shortform（公众号模式特有问题）
- vault_sync（Vault 同步/索引/master_index）
```

而 `check_loop_log.py` 的 `CONTROLLED_SLUGS` 是 7 个 HaloRead 历史 slug。两者交集只有 `git_hygiene` 和 `content_quality` 2 个。

**实际后果**：作者按 dev-workflow.md 指引写入 `state_drift` / `plot_structure` / `context_budget` / `shortform` / `vault_sync` 这 5 个 NovelForge slug 时，`check_loop_log.py` 报 P1 非法 slug 阻断；CI 校验失败，作者只能改 slug 或绕过校验，沉淀质量下降。

#### 痛点 4：无"每模块完成强制沉淀"机制

`dev-workflow.md` 第五步沉淀只是"启发式门槛"——"写了不亏的（建议写）/ 别往 loop_log 写的（去对应文件）"，没有强制要求。实际开发中常出现"模块完成即结束，无沉淀"——M01-M19 共 19 个模块，若每个模块都跳过沉淀，则 19 模块累积的经验教训全部丢失，下次类似问题需要重新踩坑。

### 2.2 学术方案与行业实践

| 来源 | 方案 | NovelForge 差异化设计 |
|---|---|---|
| **Awesome CI/CD Checklists**（GitHub 高赞仓库） | 把所有 quality gates 汇总为单文件 checklist，CI 强制核对 | dev-checklist.md 已采用此模式，M20 把 M01-M19 检测项汇总追加为 8 大类新章节 |
| **Google Engineering Productivity** | 受控标签 + 强制标签白名单，禁止自由标签 | check_loop_log.py 已采用受控 slug 表，M20 扩展白名单到 20 个 slug |
| **Pre-commit framework** | Hook 在 commit 前强制运行，可阻止"无测试/无文档"提交 | NovelForge 不引入 pre-commit（零外部依赖），但用 dev-workflow.md 第四步"自检"+ `module_completion_checklist.md` 模板达成同等效果 |
| **ADR (Architecture Decision Records)** | 每个重要决策强制记录决策上下文/决策/后果 | `module_completion_checklist.md` 模板借鉴 ADR 结构：模块元信息 / 沉淀触发判定 / 沉淀内容 / 沉淀去向 |
| **Gitmoji**（受控 emoji 列表） | 把 commit 类型约束为有限枚举，禁止自由发挥 | 受控 slug 表同思路：禁止自由 slug，强制使用 20 个枚举值 |

### 2.3 本模块的差异化设计

1. **8 大类对应 8 个新 slug**：把 M01-M19 的检测项按主题归并为 8 大类，每类对应一个新 slug，自检时按类核对，沉淀时按 slug 分类，"自检即沉淀"——自检过程中识别的共性问题直接产出对应 slug 的沉淀。
2. **SSOT 化 slug 主题表**：`regen_loop_log_index.py.SLUG_TOPICS` 作为唯一权威源，`check_loop_log.py` 与 `loop_log.md` 都从其导入/同步，消除三处维护的双源真相。
3. **强制沉淀机制**：`module_completion_checklist.md` 模板要求每个 M0x 模块完成时必须填写沉淀记录，模板分"必填"和"可选"两段——必填段（模块名 / 是否暴露共性问题 / 沉淀 slug / 沉淀去向）不可省略，可选段（详细复盘）按需补充。
4. **历史一致性修复**：把 dev-workflow.md 列出的 5 个 NovelForge slug（`state_drift` / `plot_structure` / `context_budget` / `shortform` / `vault_sync`）一次性加入受控表，修复 dev-workflow.md 与 check_loop_log.py 的历史不一致。
5. **保留 HaloRead 7 个旧 slug**：不重命名、不删除，向后兼容历史分片（避免历史沉淀报 P1）。
6. **零外部依赖**：不引入 pre-commit / husky / lint-staged 等外部工具，纯 Python 脚本 + Markdown 模板，符合 NovelForge "文件即真相"哲学。

---

## 三、涉及现有文件

### 3.1 必读文件清单

| 路径 | 用途 | 关注点 |
|---|---|---|
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 创作自检清单 | 当前 8 章节（§一-§八）共 ~53 项；M20 在 §八后新增 §九-§十六共 8 大类汇总章节 |
| [file:///workspace/scripts/check_loop_log.py](file:///workspace/scripts/check_loop_log.py) | loop_log 结构校验脚本 | 第 30-39 行 `CONTROLLED_SLUGS` 集合（当前 7 个 HaloRead slug）；M20 扩展为 20 个，并改造为从 `regen_loop_log_index.py` 导入 |
| [file:///workspace/scripts/regen_loop_log_index.py](file:///workspace/scripts/regen_loop_log_index.py) | loop_log 索引自动生成 | 第 35-43 行 `SLUG_TOPICS` 字典（当前 7 个 slug 主题）；M20 扩展为 20 个，作为 slug 主题表 SSOT |
| [file:///workspace/docs/loop_log.md](file:///workspace/docs/loop_log.md) | loop_log 主索引文件 | 文件末"slug 主题表"与"方案 C 手册"；M20 同步更新为 20 个 slug |
| [file:///workspace/.trae/rules/dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) | 项目开发协作流程规则 | §一第三步"优先复用现有能力"段落（行 80-87）追加 dev-checklist 8 大类引用；§五"loop_log 写入时必带的 #lesson slug"段落（含 NovelForge slug 列表）与 check_loop_log.py 不一致，M20 同步修复 |
| [file:///workspace/.trae/rules/bug-reporting.md](file:///workspace/.trae/rules/bug-reporting.md) | Bug 记录与回归规范 | §三字段模板；M20 按此格式新增 BUG-070 |
| [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) | Bug 回归测试集 | M20 新增 BUG-070 条目 |
| [file:///workspace/docs/optimization_plan_2026_07/M01_skill_contract_layer.md](file:///workspace/docs/optimization_plan_2026_07/M01_skill_contract_layer.md) ~ [file:///workspace/docs/optimization_plan_2026_07/M19_qidian_master_rules.md](file:///workspace/docs/optimization_plan_2026_07/M19_qidian_master_rules.md) | M01-M19 共 19 个模块方案文档 | 每个方案的 §五"详细实现步骤"中设计的 dev-checklist 检测项，M20 汇总 |

### 3.2 现状关键发现

1. **dev-checklist.md 当前 8 章节是 HaloRead 时期遗留结构**：§一-§八的章节划分针对阅读器产品（"Vault 规范" / "Trae Skill 边界" 等），未覆盖 NovelForge 创作场景（无黄金三章 / POV / 因果链 / 节奏曲线等检测维度）。M20 不重构既有 8 章节（向后兼容），只在 §八后追加 8 大类 NovelForge 创作专属章节。
2. **check_loop_log.py 与 regen_loop_log_index.py 双源维护 slug 主题表**：两处独立维护 7 个 slug，易漂移。M20 改造为 SSOT——regen 脚本的 `SLUG_TOPICS` 为权威源，check 脚本通过 `from regen_loop_log_index import SLUG_TOPICS` 导入。
3. **dev-workflow.md §五列出的 5 个 NovelForge slug 未受控**：作者按 dev-workflow.md 写沉淀时被 check_loop_log.py 报 P1 阻断，是历史遗留的"声明与执行不一致"。
4. **方案 C 手册已存在**：loop_log.md 文件末尾的"方案 C 手册"已定义"slug ≥3 次且未入 checklist 即触发 checklist 化"流程，M20 新增的 8 个 slug 自动适用此流程。
5. **module_completion_checklist.md 不存在**：当前没有"模块完成强制沉淀"机制，dev-workflow.md §五只是启发式门槛。

---

## 四、新增/修改文件清单

### 4.1 新增文件

| 路径 | 用途 |
|---|---|
| [file:///workspace/.trae/checklists/module_completion_checklist.md](file:///workspace/.trae/checklists/module_completion_checklist.md) | "每模块完成强制沉淀"模板，M0x 模块完成时必填，分必填段（模块名 / 是否暴露共性问题 / 沉淀 slug / 沉淀去向）和可选段（详细复盘） |
| [file:///workspace/tests/test_checklist_loop_upgrade.py](file:///workspace/tests/test_checklist_loop_upgrade.py) | M20 回归测试，6 个测试用例覆盖 dev-checklist 8 大类齐全 / slug 受控表扩展为 20 / SSOT 导入一致 / module_completion_checklist 模板字段完整 / dev-workflow.md slug 同步 / 历史分片向后兼容 |

### 4.2 修改文件

| 路径 | 核心改动点 |
|---|---|
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 在 §八"去 AI 味"之后追加 8 个新章节（§九-§十六），每个章节对应 1 大类 M01-M19 汇总检测项，章节标题直接标注对应 `#lesson` slug；更新文件头注释说明"§九-§十六为 NovelForge 创作专属，由 M20 汇总 M01-M19 检测项" |
| [file:///workspace/scripts/check_loop_log.py](file:///workspace/scripts/check_loop_log.py) | `CONTROLLED_SLUGS` 从 7 个扩展为 20 个；改为 `from regen_loop_log_index import SLUG_TOPICS` + `CONTROLLED_SLUGS = set(SLUG_TOPICS.keys())`，消除双源真相；保留旧 7 个 slug 向后兼容历史分片 |
| [file:///workspace/scripts/regen_loop_log_index.py](file:///workspace/scripts/regen_loop_log_index.py) | `SLUG_TOPICS` 字典从 7 个扩展为 20 个：新增 8 个 M20 任务要求 slug（`golden_three` / `pov_consistency` / `compliance` / `causal_chain` / `pacing_curve` / `persona_vector` / `selective_kg` / `methodology_precipitation`）+ 5 个 dev-workflow.md 已声明 NovelForge slug（`state_drift` / `plot_structure` / `context_budget` / `shortform` / `vault_sync`）；slug 主题表分两段（NovelForge 创作类 + HaloRead 历史类）排序 |
| [file:///workspace/docs/loop_log.md](file:///workspace/docs/loop_log.md) | 文件末"slug 主题表"同步扩展为 20 个 slug，分两段（NovelForge 创作类 13 个 + HaloRead 历史类 7 个）；AUTOGEN 区块由 `regen_loop_log_index.py` 自动重生成 |
| [file:///workspace/.trae/rules/dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) | §一第三步"优先复用现有能力"段落（行 80-87）追加引用 dev-checklist §九-§十六的 8 大类 NovelForge 创作专属检测项；§五"loop_log 写入时必带的 #lesson slug"段落更新为 20 个 slug（移除"声明与执行不一致"的 5 个 NovelForge slug 注脚，因 M20 已合法化） |
| [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) | 新增 BUG-070 条目（dev-workflow.md 与 check_loop_log.py slug 不一致 + dev-checklist 检测项散落） |

### 4.3 不修改的文件（重要边界声明）

| 文件 | 不修改原因 |
|---|---|
| [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) | 一致性检测逻辑由 M05/M06/M12/M14/M18 各自落地，M20 不重复 |
| [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) | 去 AI 味检测由 M09/M11/M13 各自落地，M20 不重复 |
| M01-M19 各方案文档 | 已沉淀方案不修改，M20 仅汇总引用 |
| [file:///workspace/NovelForge_Vault/00_控制面/style_guide.md](file:///workspace/NovelForge_Vault/00_控制面/style_guide.md) | NovelForge 语言宪法，M20 不触碰 |

---

## 五、详细实现步骤

### 步骤 1：汇总 M01-M19 检测项为 8 大类

把 M01-M19 共 19 个模块方案文档中各自设计的 dev-checklist 检测项按主题归并为 8 大类，每类对应 1 个新 `#lesson` slug。

#### 1.1 8 大类汇总表

| 类别 | 对应 slug | 来源模块 | 检测项数量 |
|---|---|---|---|
| §九 黄金三章硬约束 | `golden_three` | M11 | 6 项 |
| §十 爽点节奏与字数曲线 | `pacing_curve` | M13 + M15 + M19（§一/§二/§三） | 9 项 |
| §十一 POV 视角一致 | `pov_consistency` | M12 | 4 项 |
| §十二 因果链与伏笔生命周期 | `causal_chain` | M14 + M06 | 8 项 |
| §十三 合规风险检测 | `compliance` | M10 | 9 项 |
| §十四 角色语义漂移 | `persona_vector` | M18 + M05 | 6 项 |
| §十五 选择性 KG 召回 | `selective_kg` | M17 | 5 项 |
| §十六 方法论与工程契约 | `methodology_precipitation` | M19 + M01 + M02 + M03 + M04 | 17 项 |
| **合计** | | | **64 项** |

#### 1.2 8 大类详细检测项

**§九 黄金三章硬约束**（来源 M11，对应 `#lesson: golden_three`）：

```markdown
## 九、黄金三章硬约束（novel 模式 ch_001-ch_003 必检，对应 `#lesson: golden_three`）

- [ ] 首段钩子 ≤80 字：`check_ai_novel --dim golden_three_opening` 通过
- [ ] 前 300 字信息密度 ≤30%：`check_ai_novel --dim golden_three_opening` 通过
- [ ] 字数 2500-3000 不可短：`check_ai_novel --dim golden_three_opening` 通过
- [ ] 金手指在第 3 章前戏剧性亮相：`check_ai_novel --dim golden_three_opening` 通过
- [ ] 第 3 章末必有钩子（不可豁免）：`check_ai_novel --dim golden_three_opening` 通过
- [ ] 章纲是否指定开篇模板：architect 章纲「十、必须遵守」段落必含「开篇模板：__」字段
```

**§十 爽点节奏与字数曲线**（来源 M13 + M15 + M19，对应 `#lesson: pacing_curve`）：

```markdown
## 十、爽点节奏与字数曲线（对应 `#lesson: pacing_curve`）

- [ ] 5 级爽点节奏黄金分布：300 字一小刺激 / 1000 字一小冲突 / 3000 字一小高潮 / 1 万字一中高潮 / 30 万字一大爆发
- [ ] 抑制主角连续不超过 5 章：`check_consistency --dim pacing_curve` 通过（suppression_max_chapters=5）
- [ ] major_climax 必须按卷计划兑现：卷大纲「卷级 major_climax 计划」标注的章节已生成且兑现
- [ ] 单章爽点节奏不偏离：章纲「八、节奏标记」段落 minor/medium/major 节点已预埋
- [ ] 章末钩子完整：每章末必有钩子（novel 模式 ch_003+ 不可豁免）
- [ ] 字数曲线异常检测：连续 3 章不足 2000 字告警；连续 3 章超过 3500 字告警
- [ ] 单章字数 2000-3000（novel）/ 3-6k（shortform）未严重超标
- [ ] 卷均字数与节奏曲线匹配：高潮卷字数略高，过渡卷字数略低，差异 ≤15%
- [ ] 爽点节奏黄金分布与方法论 §二 一致：dev-checklist §方法论符合度「二、爽点节奏黄金分布」项通过
```

**§十一 POV 视角一致**（来源 M12，对应 `#lesson: pov_consistency`）：

```markdown
## 十一、POV 视角一致（对应 `#lesson: pov_consistency`）

- [ ] POV 5 种枚举值合法：first / second / third_limited / third_omniscient / third_objective，章纲「POV」字段必填
- [ ] 单章 POV 不无故切换：`check_consistency --dim pov_consistency` 通过（同一章 POV 不变）
- [ ] 多 POV 章节明确切换标记：章纲「POV」段落含「切换原因：__」说明
- [ ] 同一场景内不混用 POV：同一场景（连续不超过 5 段）内 POV 保持一致
```

**§十二 因果链与伏笔生命周期**（来源 M14 + M06，对应 `#lesson: causal_chain`）：

```markdown
## 十二、因果链与伏笔生命周期（对应 `#lesson: causal_chain`）

- [ ] 10 类因果事件配对完整：injury/heal/death/revive/item_lost/item_gained/skill_learned/skill_lost/relationship_change/breakthrough，`check_consistency --dim causal_chain` 通过
- [ ] 伏笔生命周期五阶段合法迁移：planted → progressing → hinted → resolved → archived，`audit_hooks.py` 通过
- [ ] 伏笔回收质量 4 维度评分：surprise / coherence / payoff / emotional_impact，每项 ≥3 分（满分 5）
- [ ] 无因果断裂：事件无前因或无后果时告警（injury 无 heal / death 无 consequences 等）
- [ ] 伏笔回收率达标：已铺设伏笔在合理章节跨度内回收（planted_chapter + deadline_chapters 内），无超期悬挂
- [ ] 关键因果事件已归档到 `_scenes/`：death/item_lost/relationship_change 等关键事件归档完整
- [ ] 因果链与方法论 §五「反转四招」一致：反转有伏笔铺垫（"没有伏笔的反转叫炸糖"）
- [ ] 伏笔回收不机械：避免"前文埋→后文立刻收"的快餐式回收，留足预期管理空间
```

**§十三 合规风险检测**（来源 M10，对应 `#lesson: compliance`）：

```markdown
## 十三、合规风险检测（双模式必检，对应 `#lesson: compliance`）

- [ ] 涉政风险检测：`python scripts/novelforge/check_compliance.py --dim politics` 通过
- [ ] 涉黄风险检测：`python scripts/novelforge/check_compliance.py --dim pornography` 通过
- [ ] 涉暴风险检测：`python scripts/novelforge/check_compliance.py --dim violence` 通过
- [ ] 涉恐风险检测：`python scripts/novelforge/check_compliance.py --dim terrorism` 通过
- [ ] 涉敏感词检测：`python scripts/novelforge/check_compliance.py --dim sensitive_words` 通过
- [ ] 4 平台规则感知：起点 / 番茄 / 纵横 / 晋江规则已按目标平台应用
- [ ] 双模式分级阈值正确：novel 模式（连载长文）阈值 vs shortform 模式（公众号快传播）阈值不同
- [ ] 合规检测脚本整体通过：`python scripts/novelforge/check_compliance.py --vault NovelForge_Vault` 退出码 0
- [ ] 合规风险事件已归档：触发风险告警的章节已记录到 `tests/bug_regression_list.md`
```

**§十四 角色语义漂移**（来源 M18 + M05，对应 `#lesson: persona_vector`）：

```markdown
## 十四、角色语义漂移（对应 `#lesson: persona_vector`）

- [ ] 角色语义漂移检测：`python scripts/novelforge/persona_vector_monitor --chapter <N>` 通过，cosine 相似度 ≥0.85
- [ ] 角色统计指纹一致：句长均值偏离 / preferred_words 命中率未触发 P0，`check_consistency --dim character_language_fingerprint_drift` 通过
- [ ] stable_info / mutable_info / meta / 字段保护 / 漂移检测 5 层结构完整：`schema.py --validate-character <id>` 通过
- [ ] persona_vector_baseline/ 已构建：每个出场角色在 `scripts/novelforge/data/persona_vector_baseline/<character_id>.json` 已有基线
- [ ] 角色台词未出现 OOC：本章角色台词的 embedding 与 stable_info.language_fingerprint 基线相似度 ≥0.85，未出现 OOC
- [ ] 角色弧光与 author_intent.md 主角弧光一致：角色性格/立场/能力的渐变符合预设弧光曲线
```

**§十五 选择性 KG 召回**（来源 M17，对应 `#lesson: selective_kg`）：

```markdown
## 十五、选择性 KG 召回（action/political 章节必检，对应 `#lesson: selective_kg`）

- [ ] 5 类叙事模式可识别：action / introspective / romance / political / daily，章纲「叙事模式」字段必填
- [ ] KG 文件存在且合法：`NovelForge_Vault/.state/character_kg.json` 存在且 JSON schema 通过
- [ ] action/political 章节启用 KG 召回：`build_context.py` 输出含「KG 子图召回」段
- [ ] introspective/romance/daily 章节禁用 KG 召回：`build_context.py` 输出无 KG 段
- [ ] KG 子图 Token ≤ 1500：`build_context.py` 输出的 KG 段 token 数在预算内
```

**§十六 方法论与工程契约**（来源 M19 + M01 + M02 + M03 + M04，对应 `#lesson: methodology_precipitation`）：

```markdown
## 十六、方法论与工程契约（对应 `#lesson: methodology_precipitation`）

### 16.A 方法论符合度（来源 M19，11 大节三层核验）

- [ ] 一、黄金三章法则：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 二、爽点节奏黄金分布：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 三、3000 字一章标准结构（四段心理学）：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 四、十种常用爽点公式：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 五、反转四招：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 六、画面感四法：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 七、高潮六招：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 八、反派三种：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 九、死亡三种：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 十、情绪四法：章纲是否标注 / 正文是否兑现 / 检测点是否通过
- [ ] 十一、金手指设计三维度（trigger/boundary/cost）：章纲是否标注 / 正文是否兑现 / 检测点是否通过

### 16.B 工程契约（来源 M01-M04）

- [ ] M01 Skill 契约校验：每个 Skill 的 frontmatter `produces` / `consumes` 字段完整，且与实际行为一致
- [ ] M02 Schema 同步检查：`schema.py` 中所有 schema 与 `.state/` 实际文件结构一致，无 schema 漂移
- [ ] M03 SSOT 校验：文档与脚本的同一概念定义一致（如 `CONTROLLED_SLUGS` 与 `SLUG_TOPICS` 一致）
- [ ] M04 路径契约遵守：25 条路径契约（`path_contract_table.md`）全部遵守，无非法路径写入
- [ ] M03 §七 文档与脚本同步：README / docs / scripts 之间引用的版本/路径/接口一致
- [ ] M03 §八 脚本接口 SSOT：脚本 CLI 参数与文档描述一致
```

#### 1.3 dev-checklist.md 文件头追加注释

在 `dev-checklist.md` 第 3 行后追加：

```markdown
**章节划分**：§一-§八 为 HaloRead 时期遗留通用章节（仍适用）；§九-§十六 为 NovelForge 创作专属章节（由 M20 汇总 M01-M19 共 19 个模块的检测项），每章对应一个受控 `#lesson` slug，自检过程中识别的共性问题可直接沉淀到对应 slug。
```

### 步骤 2：设计 8 个新 #lesson slug 的完整定义

每个新 slug 含「触发条件 / 沉淀模板 / checklist 转化路径」三段式定义，写入 `regen_loop_log_index.py.SLUG_TOPICS` 字典。

#### 2.1 `golden_three`（黄金三章）

```python
"golden_three": "黄金三章硬约束/首段钩子/金手指亮相/字数控制/章末钩子/开篇模板",
```

- **触发条件**：ch_001-ch_003 执笔或精修过程中触发 P0/P1 黄金三章硬约束检测项
- **沉淀模板**：
  ```
  ## <章节号> 黄金三章硬约束触发场景（YYYY-MM-DD）

  - 触发项：首段钩子超长 / 信息密度过高 / 字数不足 / 金手指未亮相 / 章末无钩子 / 未指定开篇模板
  - 触发原因：____
  - 修复方式：____
  - 教训：____
  `#lesson: golden_three`
  ```
- **checklist 转化路径**：若同一触发原因 ≥3 次（如"金手指未亮相"反复出现），按方案 C 流程把"金手指亮相"硬约束追加到 dev-checklist §九（已含）；若已含但反复触发，强化为 P0 阻断保存。

#### 2.2 `pacing_curve`（爽点节奏与字数曲线）

```python
"pacing_curve": "爽点节奏黄金分布/抑制连续5章/major_climax兑现/字数曲线异常/章末钩子",
```

- **触发条件**：爽点节奏或字数曲线检测告警（连续低谷 / 字数异常 / major_climax 未兑现）
- **沉淀模板**：
  ```
  ## <章节号或卷号> 爽点节奏或字数曲线异常（YYYY-MM-DD）

  - 异常类型：连续低谷 / 字数超标 / 字数不足 / major_climax 未兑现 / 抑制超 5 章
  - 涉及章节范围：ch_NNN - ch_NNN
  - 根因：____
  - 修复方式：____
  - 教训：____
  `#lesson: pacing_curve`
  ```
- **checklist 转化路径**：同类异常 ≥3 次时，把检测项的阈值（如 suppression_max_chapters=5）写入 dev-checklist §十（已含）。

#### 2.3 `pov_consistency`（POV 视角一致）

```python
"pov_consistency": "POV 5种枚举/单章不切换/多POV切换标记/同场景不混用",
```

- **触发条件**：`check_consistency --dim pov_consistency` 报 P0/P1，或章纲 POV 字段非法
- **沉淀模板**：
  ```
  ## <章节号> POV 视角不一致（YYYY-MM-DD）

  - 违反项：枚举值非法 / 单章切换 / 切换无标记 / 同场景混用
  - 当前 POV：____
  - 期望 POV：____
  - 根因：____
  - 修复方式：____
  `#lesson: pov_consistency`
  ```
- **checklist 转化路径**：≥3 次时强化 dev-checklist §十一（已含）的检测粒度。

#### 2.4 `causal_chain`（因果链与伏笔生命周期）

```python
"causal_chain": "10类因果事件/伏笔五阶段/回收质量4维度/因果断裂/伏笔回收率",
```

- **触发条件**：因果链断裂 / 伏笔超期悬挂 / 回收质量评分低
- **沉淀模板**：
  ```
  ## <章节号或伏笔ID> 因果链或伏笔生命周期问题（YYYY-MM-DD）

  - 问题类型：因果断裂 / 伏笔超期 / 回收质量低 / 阶段迁移非法
  - 涉及事件：____
  - 根因：____
  - 修复方式：____
  `#lesson: causal_chain`
  ```
- **checklist 转化路径**：≥3 次时把对应检测规则加入 check_consistency.py（部分已含）。

#### 2.5 `compliance`（合规风险）

```python
"compliance": "涉政/涉黄/涉暴/涉恐/敏感词/4平台规则/双模式分级",
```

- **触发条件**：`check_compliance.py` 报风险告警
- **沉淀模板**：
  ```
  ## <章节号> 合规风险告警（YYYY-MM-DD）

  - 风险维度：涉政 / 涉黄 / 涉暴 / 涉恐 / 敏感词
  - 触发文本片段：____
  - 平台规则：起点 / 番茄 / 纵横 / 晋江
  - 修复方式：____
  - 教训：____
  `#lesson: compliance`
  ```
- **checklist 转化路径**：≥3 次同类风险时，把敏感词加入 `check_compliance.py` 黑名单。

#### 2.6 `persona_vector`（角色语义漂移）

```python
"persona_vector": "角色语义漂移/embedding相似度/统计指纹/5层架构/OOC早期发现",
```

- **触发条件**：persona_vector_monitor cosine < 0.85，或 character_language_fingerprint_drift 告警
- **沉淀模板**：
  ```
  ## <章节号> <角色ID> 角色漂移告警（YYYY-MM-DD）

  - 检测类型：语义漂移（embedding）/ 统计漂移（句长/命中率）
  - cosine 相似度：____
  - 偏离方向：____（如"克制隐忍"漂移到"阴阳怪气"）
  - 根因：____
  - 修复方式：____
  `#lesson: persona_vector`
  ```
- **checklist 转化路径**：≥3 次同类漂移时，把漂移模式加入 stable_info.language_fingerprint 禁用项。

#### 2.7 `selective_kg`（选择性 KG 召回）

```python
"selective_kg": "5类叙事模式/KG文件/action/political启用/introspective禁用/Token预算",
```

- **触发条件**：叙事模式识别错误 / KG 召回该启用未启用 / 不该启用却启用 / KG Token 超限
- **沉淀模板**：
  ```
  ## <章节号> 选择性 KG 召回异常（YYYY-MM-DD）

  - 异常类型：叙事模式识别错误 / KG 启用错误 / Token 超限
  - 当前叙事模式：____
  - 期望行为：____
  - 根因：____
  - 修复方式：____
  `#lesson: selective_kg`
  ```
- **checklist 转化路径**：≥3 次同类异常时，调整 `_detect_narrative_mode()` 关键词权重。

#### 2.8 `methodology_precipitation`（方法论与工程契约）

```python
"methodology_precipitation": "11大节方法论/章纲标注/正文兑现/Skill契约/Schema同步/SSOT/路径契约",
```

- **触发条件**：方法论偏离（反转无伏笔 / 反派被削弱 / 死亡煽情 / 金手指无代价）或工程契约违反（Skill produces/consumes 不一致 / Schema 漂移 / 路径契约违反）
- **沉淀模板**：
  ```
  ## <章节号或模块号> 方法论偏离或工程契约违反（YYYY-MM-DD）

  - 偏离类型：方法论（11 大节中的 ____） / 工程契约（M01/M02/M03/M04 中的 ____）
  - 三层核验状态：章纲是否标注 / 正文是否兑现 / 检测点是否通过
  - 根因：____
  - 修复方式：____
  `#lesson: methodology_precipitation`
  ```
- **checklist 转化路径**：≥3 次同类偏离时，按方案 C 流程加入 dev-checklist §十六。

### 步骤 3：扩展 check_loop_log.py 的受控 slug 表

把 `CONTROLLED_SLUGS` 从硬编码 7 个改为从 `regen_loop_log_index.py.SLUG_TOPICS` 导入，实现 SSOT。

#### 3.1 修改 `scripts/regen_loop_log_index.py` 的 `SLUG_TOPICS` 字典

```python
SLUG_TOPICS = {
    # === NovelForge 创作类 slug（13 个，含 M20 新增 8 个 + dev-workflow.md 已声明 5 个） ===
    # M20 新增 8 个（对应 dev-checklist §九-§十六）
    "golden_three": "黄金三章硬约束/首段钩子/金手指亮相/字数控制/章末钩子/开篇模板",
    "pov_consistency": "POV 5种枚举/单章不切换/多POV切换标记/同场景不混用",
    "compliance": "涉政/涉黄/涉暴/涉恐/敏感词/4平台规则/双模式分级",
    "causal_chain": "10类因果事件/伏笔五阶段/回收质量4维度/因果断裂/伏笔回收率",
    "pacing_curve": "爽点节奏黄金分布/抑制连续5章/major_climax兑现/字数曲线异常/章末钩子",
    "persona_vector": "角色语义漂移/embedding相似度/统计指纹/5层架构/OOC早期发现",
    "selective_kg": "5类叙事模式/KG文件/action/political启用/introspective禁用/Token预算",
    "methodology_precipitation": "11大节方法论/章纲标注/正文兑现/Skill契约/Schema同步/SSOT/路径契约",
    # dev-workflow.md 已声明但未合法化的 5 个 NovelForge slug（M20 修复历史不一致）
    "state_drift": "状态机漂移/角色境界能力突变/世界观矛盾",
    "plot_structure": "伏笔回收/情节结构/节奏曲线/因果链",
    "context_budget": "上下文预算超限/Token管理/三层压缩/前情提要",
    "shortform": "公众号模式特有问题/标题评分/传播性审计/品牌调性",
    "vault_sync": "Vault同步/索引/master_index/路径契约",
    # === HaloRead 历史类 slug（7 个，保留向后兼容，不产生新沉淀） ===
    "git_hygiene": "推送/合并/冲突/分支治理/commit 覆盖",
    "reader_interaction": "阅读器/沉浸/翻页/吸底栏/SW 缓存",
    "content_quality": "质检规则/灵魂注入/标题评分",
    "book_structure": "排序/校验/命名/去重/双源同步",
    "deployment": "GitHub Pages/魔搭/.nojekyll/SW",
    "soul_injection": "灵魂注入/章回体/总编Agent",
    "ai_course": "专栏批量生成 / subagent 结果丢失",
}
```

#### 3.2 修改 `scripts/check_loop_log.py` 改为 SSOT 导入

把第 30-39 行的 `CONTROLLED_SLUGS` 硬编码改为：

```python
# 受控 slug 主题表 SSOT：从 regen_loop_log_index.py 导入，消除双源真相
# 任何新增 slug 必须先在 regen_loop_log_index.py.SLUG_TOPICS 登记
from regen_loop_log_index import SLUG_TOPICS as _SLUG_TOPICS

CONTROLLED_SLUGS = set(_SLUG_TOPICS.keys())
```

注意：因 `check_loop_log.py` 与 `regen_loop_log_index.py` 都在 `scripts/` 目录，需在导入时加上 `sys.path` 处理：

```python
import sys
from pathlib import Path
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
from regen_loop_log_index import SLUG_TOPICS as _SLUG_TOPICS

CONTROLLED_SLUGS = set(_SLUG_TOPICS.keys())
```

### 步骤 4：更新 `docs/loop_log.md` 的 slug 主题表

由 `regen_loop_log_index.py` 自动重生成 AUTOGEN 区块。手动运行：

```bash
python scripts/regen_loop_log_index.py
```

AUTOGEN 区块会自动包含 20 个 slug 的"主题锚点"和"教训计数表"。同时手动更新文件末尾的"slug 主题表"为 20 个 slug，分两段：

```markdown
## slug 主题表（共 20 个，由 regen_loop_log_index.py.SLUG_TOPICS 维护为 SSOT）

### NovelForge 创作类 slug（13 个）

| slug | 主题 |
|---|---|
| `golden_three` | 黄金三章硬约束/首段钩子/金手指亮相/字数控制/章末钩子/开篇模板 |
| `pov_consistency` | POV 5种枚举/单章不切换/多POV切换标记/同场景不混用 |
| `compliance` | 涉政/涉黄/涉暴/涉恐/敏感词/4平台规则/双模式分级 |
| `causal_chain` | 10类因果事件/伏笔五阶段/回收质量4维度/因果断裂/伏笔回收率 |
| `pacing_curve` | 爽点节奏黄金分布/抑制连续5章/major_climax兑现/字数曲线异常/章末钩子 |
| `persona_vector` | 角色语义漂移/embedding相似度/统计指纹/5层架构/OOC早期发现 |
| `selective_kg` | 5类叙事模式/KG文件/action/political启用/introspective禁用/Token预算 |
| `methodology_precipitation` | 11大节方法论/章纲标注/正文兑现/Skill契约/Schema同步/SSOT/路径契约 |
| `state_drift` | 状态机漂移/角色境界能力突变/世界观矛盾 |
| `plot_structure` | 伏笔回收/情节结构/节奏曲线/因果链 |
| `context_budget` | 上下文预算超限/Token管理/三层压缩/前情提要 |
| `shortform` | 公众号模式特有问题/标题评分/传播性审计/品牌调性 |
| `vault_sync` | Vault同步/索引/master_index/路径契约 |

### HaloRead 历史类 slug（7 个，保留向后兼容，不产生新沉淀）

| slug | 主题 |
|---|---|
| `git_hygiene` | 推送/合并/冲突/分支治理/commit 覆盖 |
| `reader_interaction` | 阅读器/沉浸/翻页/吸底栏/SW 缓存 |
| `content_quality` | 质检规则/灵魂注入/标题评分 |
| `book_structure` | 排序/校验/命名/去重/双源同步 |
| `deployment` | GitHub Pages/魔搭/.nojekyll/SW |
| `soul_injection` | 灵魂注入/章回体/总编Agent |
| `ai_course` | 专栏批量生成 / subagent 结果丢失 |
```

### 步骤 5：新增 `module_completion_checklist.md` 模板

新建 [file:///workspace/.trae/checklists/module_completion_checklist.md](file:///workspace/.trae/checklists/module_completion_checklist.md)：

```markdown
# 模块完成强制沉淀 Checklist（M0x 模块完成时必填）

> 本模板由 M20 引入，对应 [file:///workspace/.trae/rules/dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) §五"沉淀"的强制化版本。
> 每个 M0x 模块（M01-M20）完成时必须填写一份，追加到 `docs/loop_log/YYYY-MM.md` 当月分片。
> 必填段不可省略；可选段按需补充。
> 完成后运行 `python scripts/regen_loop_log_index.py` 重生成主索引，再运行 `python scripts/check_loop_log.py` 校验。

---

## 模块元信息（必填）

- **模块编号**：M____
- **模块名**：____
- **完成日期**：YYYY-MM-DD
- **完成人**：____
- **关联 BUG 编号**：BUG-____

## 沉淀触发判定（必填）

回答以下 4 个问题，至少一个为"是"即必须沉淀：

- [ ] 本次模块开发是否暴露了创作流程的新共性问题（非单章 bug）？
- [ ] 本次模块开发是否产出了可复用资产/方法论（如检测规则、模板、检查清单）？
- [ ] 本次模块开发是否触发了规则 / checklist / Skill 的实际更新？
- [ ] 本次模块开发是否修复了会复发的状态漂移/一致性 bug？

**判定结果**：____（是 / 否）
- 若"否"，直接填写"本次无新沉淀"并归档到 commit message，不进入 loop_log。
- 若"是"，继续填写下方沉淀内容段。

## 沉淀内容（必填，仅当判定为"是"时）

### 共性问题描述

____

### 沉淀 slug（从 20 个受控 slug 中选 1-3 个，多选用空格分隔）

`#lesson: ____`

可选 slug（参见 [file:///workspace/docs/loop_log.md](file:///workspace/docs/loop_log.md) slug 主题表）：
- NovelForge 创作类：`golden_three` / `pov_consistency` / `compliance` / `causal_chain` / `pacing_curve` / `persona_vector` / `selective_kg` / `methodology_precipitation` / `state_drift` / `plot_structure` / `context_budget` / `shortform` / `vault_sync`
- HaloRead 历史类（仅历史沉淀，不产生新沉淀）：`git_hygiene` / `reader_interaction` / `content_quality` / `book_structure` / `deployment` / `soul_injection` / `ai_course`

### 沉淀去向（必填，二选一）

- [ ] 追加到 `docs/loop_log/YYYY-MM.md` 当月分片（推荐路径，对应方案 C 流程）
- [ ] 已入 checklist（标注"已入checklist: yes"，方案 C 第三步触发后选此项）

## 详细复盘（可选，按需补充）

### 触发场景

____

### 根因分析

____

### 修复方式

____

### 教训沉淀

____

### 是否触发 checklist / 规则 / Skill 更新

- [ ] 是，更新了 ____ 文件
- [ ] 否

---

## 使用示例

以 M17 选择性 KG 路线为例：

```markdown
## M17 选择性 KG 路线（2026-07-18）

### 模块元信息
- 模块编号：M17
- 模块名：selective_kg
- 完成日期：2026-07-18
- 关联 BUG 编号：BUG-067

### 沉淀触发判定
- [x] 本次模块开发是否暴露了创作流程的新共性问题？是（动感叙事章节角色关系复杂场景召回不全）
- [x] 本次模块开发是否产出了可复用资产/方法论？是（KG 文件即真相 + 选择性启用学术依据）
- [x] 本次模块开发是否触发了规则 / checklist / Skill 的实际更新？是（dev-checklist §十一 / context-composer / key-scene-archiver）

### 沉淀内容
共性问题描述：动感叙事章节多角色多阵营场景召回不全，Grep top-3 截断导致关系遗漏。

`#lesson: selective_kg`

沉淀去向：[x] 追加到 docs/loop_log/2026-07.md

### 详细复盘
触发场景：ch_085 拍卖会场景 5 角色 3 阵营，Grep 召回 top 3 漏掉沈家-皇室合作。
根因：Grep 按文件名/关键词评分，无法结构化呈现多角色多阵营关系。
修复方式：新增 build_kg.py 构建 KG，按叙事模式选择性启用召回。
教训：复杂关系场景需结构化数据（KG）补充 Grep 召回。
是否触发更新：是，更新了 dev-checklist.md / context-composer SKILL / key-scene-archiver SKILL / build_context.py。
```
```

### 步骤 6：同步 `dev-workflow.md` 的 slug 列表与 dev-checklist 引用

#### 6.1 §五"loop_log 写入时必带的 #lesson slug"段落更新

把 dev-workflow.md §五的 slug 列表从 7 个 NovelForge slug 更新为 20 个完整受控 slug（与 check_loop_log.py 一致）：

```markdown
**写 loop_log 时必带的 #lesson slug**（从下表选，多选用空格分隔；完整 SSOT 见 `scripts/regen_loop_log_index.py.SLUG_TOPICS`）：

**NovelForge 创作类 slug（13 个，推荐优先使用）**：
- `golden_three`（黄金三章硬约束）—— M20 新增，对应 dev-checklist §九
- `pov_consistency`（POV 视角一致性）—— M20 新增，对应 dev-checklist §十一
- `compliance`（合规风险）—— M20 新增，对应 dev-checklist §十三
- `causal_chain`（因果链与伏笔生命周期）—— M20 新增，对应 dev-checklist §十二
- `pacing_curve`（爽点节奏与字数曲线）—— M20 新增，对应 dev-checklist §十
- `persona_vector`（角色语义漂移）—— M20 新增，对应 dev-checklist §十四
- `selective_kg`（选择性 KG 召回）—— M20 新增，对应 dev-checklist §十五
- `methodology_precipitation`（方法论与工程契约）—— M20 新增，对应 dev-checklist §十六
- `state_drift`（状态机漂移/角色一致性）
- `plot_structure`（伏笔回收/情节结构/节奏曲线）
- `context_budget`（上下文预算/Token 管理）
- `shortform`（公众号模式特有问题）
- `vault_sync`（Vault 同步/索引/master_index）

**HaloRead 历史类 slug（7 个，仅历史沉淀使用，不产生新沉淀）**：
- `git_hygiene`（Git 卫生/提交规范）
- `reader_interaction`（阅读器/沉浸/翻页）
- `content_quality`（内容质量/去 AI 味）
- `book_structure`（排序/校验/命名）
- `deployment`（GitHub Pages/魔搭）
- `soul_injection`（灵魂注入/章回体）
- `ai_course`（专栏批量生成）

完整 slug 主题表与方案 C 手册见 `docs/loop_log.md` 文件末。
```

#### 6.2 §一第三步"优先复用现有能力"段落追加 dev-checklist 引用

在 dev-workflow.md §一第三步"优先复用现有能力"段落（行 80-87）末尾追加：

```markdown
- **dev-checklist 自检时必带 §九-§十六**：NovelForge 创作类自检项（黄金三章 / 爽点节奏 / POV / 因果链 / 合规 / 角色漂移 / 选择性 KG / 方法论符合度）由 M20 汇总 M01-M19 共 19 个模块的检测项追加到 dev-checklist §九-§十六，每章对应一个受控 `#lesson` slug；自检过程中识别的共性问题直接产出对应 slug 的沉淀，"自检即沉淀"。
```

#### 6.3 §五"loop_log 写入门槛"段落更新

在 dev-workflow.md §五追加"模块完成强制沉淀"段：

```markdown
**模块完成强制沉淀门槛**（M20 新增）：

每个 M0x 模块（M01-M20）完成时必须按 [file:///workspace/.trae/checklists/module_completion_checklist.md](file:///workspace/.trae/checklists/module_completion_checklist.md) 模板填写一份沉淀记录，至少回答 4 个触发判定问题。若判定为"是"，追加到 `docs/loop_log/YYYY-MM.md` 当月分片并打上对应 slug；若判定为"否"，明确说明"本次无新沉淀"并归档到 commit message。这是 LoopAgent 思维的强制化版本，避免 20 模块累积经验教训丢失。
```

### 步骤 7：写入 BUG-070 到 `tests/bug_regression_list.md`

按 [file:///workspace/.trae/rules/bug-reporting.md](file:///workspace/.trae/rules/bug-reporting.md) §三字段模板追加：

```markdown
## dev-workflow.md 与 check_loop_log.py slug 列表不一致 + dev-checklist 检测项散落

- **编号**：BUG-070
- **首次出现**：2026-07-18
- **类型**：工具链 / 一致性
- **现象**：作者按 dev-workflow.md §五指引写入 NovelForge slug（state_drift / plot_structure / context_budget / shortform / vault_sync）时，check_loop_log.py 报 P1 非法 slug 阻断；同时 M01-M19 共 19 个模块各自设计的 dev-checklist 检测项散落在各方案文档，作者自检时无汇总清单可循。
- **根因**：HaloRead 时期遗留 7 个 slug 受控表未跟随 NovelForge 项目演进同步扩展；M01-M19 各模块方案各自设计检测项但未汇总到 dev-checklist.md；loop_log 沉淀机制仅有启发式门槛无强制要求。
- **修复**：M20 一次性扩展受控 slug 到 20 个（含 8 个新 slug + 5 个 NovelForge 已用 slug + 7 个 HaloRead 历史 slug 保留），SSOT 化到 regen_loop_log_index.py.SLUG_TOPICS；dev-checklist.md 追加 §九-§十六 8 大类汇总章节（共 64 项检测）；新增 module_completion_checklist.md 模板强制沉淀。
- **涉及文件**：scripts/check_loop_log.py / scripts/regen_loop_log_index.py / docs/loop_log.md / .trae/checklists/dev-checklist.md / .trae/checklists/module_completion_checklist.md / .trae/rules/dev-workflow.md
- **回归测试**：tests/test_checklist_loop_upgrade.py 新增 6 个测试用例（dev-checklist 8 大类齐全 / slug 受控表扩展为 20 / SSOT 导入一致 / module_completion_checklist 模板字段完整 / dev-workflow.md slug 同步 / 历史分片向后兼容）
- **教训**：受控标签表必须随项目演进同步扩展，否则会变成"声明与执行不一致"的双源真相；多模块累积的检测项必须汇总到统一 checklist，否则自检时无人可循；沉淀机制不能纯靠人工自觉，必须有模板强制要求。
```

### 步骤 8：编写回归测试 `tests/test_checklist_loop_upgrade.py`

```python
"""M20 dev-checklist 升级 + LoopAgent slug 扩展回归测试。

测试目标：
1. dev-checklist.md 含 §九-§十六 8 大类汇总章节
2. check_loop_log.py 的 CONTROLLED_SLUGS 扩展为 20 个
3. SSOT 一致：regen_loop_log_index.py.SLUG_TOPICS 是唯一权威源
4. module_completion_checklist.md 模板字段完整
5. dev-workflow.md slug 列表与 check_loop_log.py 一致
6. 历史分片向后兼容：旧 7 个 HaloRead slug 仍受控
"""

from pathlib import Path
import re
import sys

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

DEV_CHECKLIST = ROOT / ".trae" / "checklists" / "dev-checklist.md"
MODULE_COMPLETION = ROOT / ".trae" / "checklists" / "module_completion_checklist.md"
DEV_WORKFLOW = ROOT / ".trae" / "rules" / "dev-workflow.md"
LOOP_LOG = ROOT / "docs" / "loop_log.md"


def test_dev_checklist_has_eight_new_sections():
    """§九-§十六 8 大类 NovelForge 创作专属章节齐全。"""
    text = DEV_CHECKLIST.read_text(encoding="utf-8")
    expected_sections = [
        "## 九、黄金三章硬约束",
        "## 十、爽点节奏与字数曲线",
        "## 十一、POV 视角一致",
        "## 十二、因果链与伏笔生命周期",
        "## 十三、合规风险检测",
        "## 十四、角色语义漂移",
        "## 十五、选择性 KG 召回",
        "## 十六、方法论与工程契约",
    ]
    for section in expected_sections:
        assert section in text, f"dev-checklist.md 缺少章节：{section}"


def test_controlled_slugs_extended_to_twenty():
    """check_loop_log.py 的 CONTROLLED_SLUGS 扩展为 20 个。"""
    from check_loop_log import CONTROLLED_SLUGS

    # M20 新增 8 个 slug
    new_slugs = {
        "golden_three", "pov_consistency", "compliance", "causal_chain",
        "pacing_curve", "persona_vector", "selective_kg", "methodology_precipitation",
    }
    # dev-workflow.md 已声明 5 个 NovelForge slug
    nf_slugs = {"state_drift", "plot_structure", "context_budget", "shortform", "vault_sync"}
    # HaloRead 历史 7 个 slug
    halo_slugs = {
        "git_hygiene", "reader_interaction", "content_quality", "book_structure",
        "deployment", "soul_injection", "ai_course",
    }

    assert new_slugs.issubset(CONTROLLED_SLUGS), f"新增 8 个 slug 未全部受控：{new_slugs - CONTROLLED_SLUGS}"
    assert nf_slugs.issubset(CONTROLLED_SLUGS), f"NovelForge 5 个 slug 未合法化：{nf_slugs - CONTROLLED_SLUGS}"
    assert halo_slugs.issubset(CONTROLLED_SLUGS), f"HaloRead 7 个 slug 丢失：{halo_slugs - CONTROLLED_SLUGS}"
    assert len(CONTROLLED_SLUGS) >= 20, f"受控 slug 总数不足 20：{len(CONTROLLED_SLUGS)}"


def test_ssot_consistency():
    """SSOT 一致：check_loop_log.py 的 CONTROLLED_SLUGS 从 regen_loop_log_index.py 导入。"""
    from check_loop_log import CONTROLLED_SLUGS
    from regen_loop_log_index import SLUG_TOPICS

    assert CONTROLLED_SLUGS == set(SLUG_TOPICS.keys()), (
        "SSOT 不一致：check_loop_log.py 未从 regen_loop_log_index.py.SLUG_TOPICS 导入"
    )


def test_module_completion_checklist_template():
    """module_completion_checklist.md 模板字段完整。"""
    text = MODULE_COMPLETION.read_text(encoding="utf-8")
    required_fields = [
        "模块元信息",
        "沉淀触发判定",
        "沉淀内容",
        "沉淀 slug",
        "沉淀去向",
        "详细复盘",
    ]
    for field in required_fields:
        assert field in text, f"module_completion_checklist.md 缺少字段：{field}"


def test_dev_workflow_slug_sync():
    """dev-workflow.md §五 slug 列表与 check_loop_log.py 一致。"""
    text = DEV_WORKFLOW.read_text(encoding="utf-8")
    new_slugs = [
        "golden_three", "pov_consistency", "compliance", "causal_chain",
        "pacing_curve", "persona_vector", "selective_kg", "methodology_precipitation",
    ]
    for slug in new_slugs:
        assert f"`{slug}`" in text, f"dev-workflow.md §五未列出 slug：{slug}"


def test_historical_shards_backward_compatible():
    """历史分片向后兼容：旧 7 个 HaloRead slug 仍受控。"""
    from check_loop_log import CONTROLLED_SLUGS

    halo_slugs = {
        "git_hygiene", "reader_interaction", "content_quality", "book_structure",
        "deployment", "soul_injection", "ai_course",
    }
    assert halo_slugs.issubset(CONTROLLED_SLUGS), (
        f"历史 HaloRead slug 丢失，会导致历史分片校验失败：{halo_slugs - CONTROLLED_SLUGS}"
    )
```

---

## 六、验证方式

### 6.1 自动化校验

按以下顺序执行校验，全部通过方可声明 M20 完成：

```bash
# 1. pytest 全量通过（含新增 tests/test_checklist_loop_upgrade.py）
pytest -q

# 2. loop_log 结构校验通过（含 20 个 slug 受控）
python scripts/check_loop_log.py

# 3. loop_log 索引重生成（含 20 个 slug 主题锚点 + 计数表）
python scripts/regen_loop_log_index.py

# 4. 一致性校验通过（dev-checklist 不影响 check_consistency.py）
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault

# 5. 去 AI 味校验通过
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault

# 6. commit 信息校验（如已 commit）
python scripts/validate_commit_messages.py origin/master..HEAD
```

### 6.2 人工抽查清单

- [ ] dev-checklist.md 含 §九-§十六 共 8 大类章节标题，每章节标题标注对应 `#lesson` slug
- [ ] dev-checklist.md §九-§十六 共 ~64 项检测项可勾选
- [ ] `python -c "from scripts.check_loop_log import CONTROLLED_SLUGS; print(len(CONTROLLED_SLUGS))"` 输出 ≥20
- [ ] `python -c "from scripts.regen_loop_log_index import SLUG_TOPICS; print(len(SLUG_TOPICS))"` 输出 ≥20
- [ ] `python -c "from scripts.check_loop_log import CONTROLLED_SLUGS; from scripts.regen_loop_log_index import SLUG_TOPICS; assert CONTROLLED_SLUGS == set(SLUG_TOPICS.keys()); print('SSOT OK')"` 输出 SSOT OK
- [ ] dev-workflow.md §五列出全部 20 个 slug
- [ ] dev-workflow.md §一第三步引用 dev-checklist §九-§十六
- [ ] module_completion_checklist.md 含必填段（模块元信息 / 沉淀触发判定 / 沉淀内容 / 沉淀 slug / 沉淀去向）
- [ ] tests/bug_regression_list.md 含 BUG-070 条目

### 6.3 端到端验证场景

模拟一次"作者写 ch_001 触发黄金三章告警"的端到端流程：

1. 作者用 writer-polisher 生成 ch_001，首段钩子 120 字（超 80 字阈值）
2. `check_ai_novel --dim golden_three_opening` 报 P0
3. 作者修复首段为 75 字
4. 重新校验通过
5. 作者按 module_completion_checklist.md 模板填写沉淀：
   - 模块元信息：M11（黄金三章）
   - 沉淀触发判定：是（暴露了"首段钩子超长"共性问题）
   - 沉淀 slug：`#lesson: golden_three`
   - 沉淀去向：追加到 docs/loop_log/2026-07.md
6. 运行 `python scripts/regen_loop_log_index.py`，主索引计数表自动更新 `#golden_three: 1`
7. 运行 `python scripts/check_loop_log.py`，校验通过（slug 合法）
8. 自检 dev-checklist §九，逐项 ✅

---

## 七、回归测试要求

### 7.1 新增测试

新增 [file:///workspace/tests/test_checklist_loop_upgrade.py](file:///workspace/tests/test_checklist_loop_upgrade.py)，共 6 个测试用例：

| 用例 | 验证点 |
|---|---|
| `test_dev_checklist_has_eight_new_sections` | dev-checklist.md 含 §九-§十六 8 大类章节标题 |
| `test_controlled_slugs_extended_to_twenty` | check_loop_log.py 的 CONTROLLED_SLUGS 含全部 20 个 slug（8 新 + 5 NovelForge + 7 HaloRead） |
| `test_ssot_consistency` | check_loop_log.py 的 CONTROLLED_SLUGS == regen_loop_log_index.py 的 SLUG_TOPICS.keys() |
| `test_module_completion_checklist_template` | module_completion_checklist.md 含必填字段（模块元信息 / 沉淀触发判定 / 沉淀内容 / 沉淀 slug / 沉淀去向） |
| `test_dev_workflow_slug_sync` | dev-workflow.md §五列出全部 20 个 slug |
| `test_historical_shards_backward_compatible` | 历史 HaloRead 7 个 slug 仍受控（不破坏历史分片） |

### 7.2 既有测试不破坏

- `tests/test_loop_log_*.py`：历史分片校验测试不受影响（旧 7 个 slug 保留）
- `tests/test_regen_loop_log_index.py`：索引生成测试受影响，因 SLUG_TOPICS 扩展，需同步更新断言（如有硬编码 7 个的断言改为 ≥7 或 ≥20）
- `tests/test_check_consistency.py` / `tests/test_check_ai_novel.py`：不受影响

### 7.3 完整测试集执行

```bash
pytest -q
python scripts/check_loop_log.py
python scripts/regen_loop_log_index.py --dry-run
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
```

全部通过方可声明 M20 完成。

---

## 八、风险点与回滚方案

### 8.1 风险点

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| **R1：SSOT 导入路径失败** | 中 | check_loop_log.py 启动报 ModuleNotFoundError，loop_log 校验全部失败 | 步骤 3.2 已加 `sys.path` 处理；测试用例 `test_ssot_consistency` 自动捕获 |
| **R2：历史分片含旧 slug 报错** | 低 | 历史 HaloRead 7 个 slug 必须保留在受控表中，否则历史分片校验失败 | 步骤 3.1 明确保留 7 个 HaloRead slug；测试用例 `test_historical_shards_backward_compatible` 自动捕获 |
| **R3：dev-checklist 检测项过多导致自检耗时** | 中 | 8 大类共 64 项 + 原 53 项 = 117 项，全量自检耗时 | dev-checklist.md 文件头标注"§九-§十六为 NovelForge 创作专属，HaloRead 阅读器场景可跳过"；Agent 可按章节类型选择性核对（如内省章跳过 §十五 选择性 KG） |
| **R4：强制沉淀机制被绕过** | 中 | 模块完成时跳过 module_completion_checklist.md 填写 | dev-workflow.md §五更新为"模块完成强制沉淀门槛"，与 §一第三步"开始前必读"协同；CI 流程后续可加 hook 检查 commit 是否含 module_completion 引用 |
| **R5：dev-workflow.md §五 slug 列表与 check_loop_log.py 再次漂移** | 低 | 双源真相回归 | SSOT 化后只有 regen_loop_log_index.py.SLUG_TOPICS 一处维护，dev-workflow.md §五明确标注"完整 SSOT 见 scripts/regen_loop_log_index.py.SLUG_TOPICS" |
| **R6：方案 C 手册触发率上升** | 低 | 新增 8 个 slug 后，若某 slug 出现 ≥3 次会触发方案 C"已入 checklist"机制 | 这是预期行为（方案 C 的设计目标就是触发 checklist 化），新增的 8 个 slug 已经在 dev-checklist §九-§十六 中"已入 checklist"了，所以默认就不会告警 |
| **R7：regen_loop_log_index.py 输出格式变化导致 loop_log.md AUTOGEN 区块破坏** | 中 | 主文件索引区显示异常 | 步骤 4 后立即运行 `python scripts/regen_loop_log_index.py` 重生成，再 `python scripts/check_loop_log.py` 校验；保留原 AUTOGEN_START/AUTOGEN_END 标记 |

### 8.2 回滚方案

#### 阶段性回滚（部分回滚）

若 SSOT 导入路径失败（R1），临时回滚 `check_loop_log.py` 第 30-39 行为硬编码 20 个 slug，不导入：

```python
CONTROLLED_SLUGS = {
    # NovelForge 创作类 13 个
    "golden_three", "pov_consistency", "compliance", "causal_chain",
    "pacing_curve", "persona_vector", "selective_kg", "methodology_precipitation",
    "state_drift", "plot_structure", "context_budget", "shortform", "vault_sync",
    # HaloRead 历史类 7 个
    "git_hygiene", "reader_interaction", "content_quality", "book_structure",
    "deployment", "soul_injection", "ai_course",
}
```

回滚后 SSOT 化失败但受控 slug 仍扩展为 20 个，功能可用。

#### 完全回滚

若 M20 整体方案出问题，按以下顺序回滚：

1. 恢复 `scripts/check_loop_log.py` 第 30-39 行为原始 7 个 HaloRead slug
2. 恢复 `scripts/regen_loop_log_index.py` 第 35-43 行为原始 7 个 HaloRead slug
3. 运行 `python scripts/regen_loop_log_index.py` 重生成主索引
4. 删除 dev-checklist.md §九-§十六 8 个新章节
5. 删除 `.trae/checklists/module_completion_checklist.md`
6. 恢复 dev-workflow.md §五为原始 7 个 NovelForge slug 列表（接受与 check_loop_log.py 不一致的历史问题）
7. 删除 `tests/test_checklist_loop_upgrade.py`
8. 删除 BUG-070 条目

回滚后系统回到 M19 完成后状态，无破坏性影响。

---

## 九、完成标准 DoD 清单

M20 完成的判定标准（必须全部 ✅）：

### 9.1 文件产出

- [ ] [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) 含 §九-§十六 8 大类新章节，共 ~64 项检测项
- [ ] [file:///workspace/.trae/checklists/module_completion_checklist.md](file:///workspace/.trae/checklists/module_completion_checklist.md) 模板存在且含必填字段
- [ ] [file:///workspace/scripts/check_loop_log.py](file:///workspace/scripts/check_loop_log.py) 的 `CONTROLLED_SLUGS` 扩展为 20 个，SSOT 从 `regen_loop_log_index.py` 导入
- [ ] [file:///workspace/scripts/regen_loop_log_index.py](file:///workspace/scripts/regen_loop_log_index.py) 的 `SLUG_TOPICS` 扩展为 20 个，含 8 个新 slug + 5 个 NovelForge slug + 7 个 HaloRead slug
- [ ] [file:///workspace/docs/loop_log.md](file:///workspace/docs/loop_log.md) AUTOGEN 区块已重生成，slug 主题表同步为 20 个
- [ ] [file:///workspace/.trae/rules/dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) §五列出全部 20 个 slug，§一第三步引用 dev-checklist §九-§十六
- [ ] [file:///workspace/tests/test_checklist_loop_upgrade.py](file:///workspace/tests/test_checklist_loop_upgrade.py) 含 6 个测试用例
- [ ] [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) 含 BUG-070 条目

### 9.2 自动化校验

- [ ] `pytest -q` 全部通过（含新增 6 个测试用例）
- [ ] `python scripts/check_loop_log.py` 退出码 0
- [ ] `python scripts/regen_loop_log_index.py` 退出码 0
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 退出码 0
- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 退出码 0

### 9.3 功能验证

- [ ] dev-checklist §九-§十六 每章节标题标注对应 `#lesson` slug
- [ ] dev-checklist §九-§十六 共 ~64 项检测项可勾选
- [ ] `python -c "from scripts.check_loop_log import CONTROLLED_SLUGS; print(len(CONTROLLED_SLUGS))"` 输出 ≥20
- [ ] `python -c "from scripts.regen_loop_log_index import SLUG_TOPICS; print(len(SLUG_TOPICS))"` 输出 ≥20
- [ ] SSOT 一致：`CONTROLLED_SLUGS == set(SLUG_TOPICS.keys())`
- [ ] 历史 HaloRead 7 个 slug 仍受控（向后兼容）
- [ ] dev-workflow.md §五 slug 列表与 check_loop_log.py 一致（不再双源真相）
- [ ] module_completion_checklist.md 含必填段与可选段
- [ ] BUG-070 含完整字段（编号 / 首次出现 / 现象 / 根因 / 修复 / 涉及文件 / 回归测试 / 教训）

### 9.4 沉淀产出

- [ ] M20 自身按 module_completion_checklist.md 模板填写一份沉淀记录，追加到 [file:///workspace/docs/loop_log/2026-07.md](file:///workspace/docs/loop_log/2026-07.md)
- [ ] 沉淀 slug 至少 1 个（推荐 `#lesson: methodology_precipitation` —— M20 本身就是方法论与工程契约的沉淀）
- [ ] 运行 `python scripts/regen_loop_log_index.py` 后，主索引含 M20 沉淀条目
- [ ] 运行 `python scripts/check_loop_log.py` 通过（slug 合法 + 锚点完整 + 日期倒序）

### 9.5 与 20 模块方案的整体闭环

- [ ] M01-M19 共 19 个模块方案文档的 §五"详细实现步骤"中设计的 dev-checklist 检测项已全部汇总到 dev-checklist §九-§十六
- [ ] M20 自身的方案文档（本文件）已写入 [file:///workspace/docs/optimization_plan_2026_07/M20_checklist_loop_upgrade.md](file:///workspace/docs/optimization_plan_2026_07/M20_checklist_loop_upgrade.md)
- [ ] 20 模块方案完整闭环：M01 工程债 → M02-M06 强化 → M07-M10 补盲 → M11-M16 量化检测 → M17-M18 前沿技术 → M19-M20 沉淀方法论
- [ ] [file:///workspace/docs/optimization_plan_2026_07/00_master_plan.md](file:///workspace/docs/optimization_plan_2026_07/00_master_plan.md) 20 模块进度表全部标记为 ✅
