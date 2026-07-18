# DreamTale：借 AI 写长篇小说的创作系统

> 基于 Trae IDE Skills + Obsidian Vault 的 AI 长篇小说创作系统。Markdown / JSON 文件即真相，不做 RAG、不向量化、不依赖向量数据库。
> 双模式：**novel**（长篇纯虚构，目标 100 万字+）+ **shortform**（公众号半历史短篇，3-6k 字/篇）。让 AI 写出有「活人感」、去 AI 味、人物弧光扎实的小说。

## 一、项目定位

DreamTale 是一套以 **Trae Skills** 为编排核心、**Obsidian Vault** 为存储与阅读载体的极简 AI 长篇小说创作系统。它不跑 Python LangGraph 编排，不建独立站点，所有产出都是 Markdown 文件直接进 Vault，可链接、可检索、可沉淀。

- **本地优先**：所有产出 Markdown，直接进 Obsidian Vault。
- **文件即真相**：世界观、人物设定、章节正文、意图、Delta 增量全部是 Markdown / JSON 文件，无数据库、无向量库。
- **Skill 编排**：创作流程由 Trae Skills 串联，主 Agent 用 Task 工具调度 subagent 并行，无需外部编排引擎。
- **去 AI 味**：从定调、执笔到审计全链路压制 AI 套路句式与套路剧情。

## 二、双模式

DreamTale 支持两种创作模式，共用工程基础设施，差异化在写作规则与质检维度：

| 维度 | novel（长篇纯虚构） | shortform（公众号半历史） |
|---|---|---|
| 用途 | 长篇小说（多卷多章） | 公众号半历史小说（单篇成文） |
| 真实性约束 | 纯虚构，人物设定即真相 | 半历史，史实骨架不可改，细节可虚构 |
| 篇幅 | 单章 3000-8000 字，多卷连载 | 单篇 5000-12000 字，独立成文 |
| 质检维度 | 人物一致性 / 情节连贯 / 视角统一 / 去 AI 味 / 灵魂 | 同左，但增加「史实骨架不可改」硬约束 |

## 三、核心哲学

1. **Markdown / JSON 文件即真相**：不引入 RAG、向量库、数据库。Vault 里的每一个 `.md` / `.json` 都是唯一真相源，Agent 读写文件即读写世界。
2. **Skill 编排而非代码编排**：创作流程由 Trae Skills 串联，主 Agent 调度，不依赖 Python LangGraph / langchain。
3. **Delta 增量而非全量重写**：每次执笔只写新增章节，不动历史正文，避免漂移。
4. **防漂移三铁律**（见下文）：从架构上保证世界观与人物设定不漂移。
5. **去 AI 味是第一公民**：从定调到审计，每个环节都有去 AI 味检查，不只靠终审。

## 四、Vault 目录结构

`NovelForge_Vault/` 是 Obsidian Vault，所有创作产出在此沉淀。目录结构概览（标注当前进度）：

```
NovelForge_Vault/
├── 00_控制面/              ✅ 已建  # 创作意图与全局索引
│   ├── author_intent.md            # 作者意图（必读意图文件）
│   ├── current_focus.md            # 当前写作焦点
│   ├── master_index.md             # 全局索引
│   └── style_guide.md              # 文风指南
├── 01_世界观/              ✅ 已建  # 世界设定
│   ├── core_rules.md               # 核心规则
│   ├── factions.md                 # 势力
│   └── geography.md                # 地理
├── 02_角色/                🚧 规划中  # 人物设定卡（人设、关系、弧光）
├── 03_素材库/              🚧 规划中  # 写作素材与方法论
├── 04_大纲与脉络/          ✅ 已建  # master_outline / story_arc / hooks_registry
├── 06_审计/                🚧 规划中  # 执笔审计报告
├── 06_短文/                ✅ 已建  # shortform 模式产出（选题/草稿/已发）
├── _recaps/                ✅ 已建  # 每 10 章冻结的前情提要（稳定锚点）
└── _scenes/                ✅ 已建  # 关键场景存档（替代 RAG 召回）
```

> 注：目录编号沿用历史规划，`05_Delta/` 已合并进 `.state/` 状态机，由 `save_state.py` 维护。

## 五、Skill 体系概览

DreamTale 共 14 个 Skill（1 主入口 + 5 核心 + 4 shortform + 4 守护），均已实现。配合 `NovelForge_Vault/00_控制面/USAGE.md` 作者手册使用。

### 1. 主入口（1 个）

| Skill | 用途 |
|---|---|
| `novelforge` | 主入口，识别意图 + 调度链固化。识别 11 类作者意图，路由到对应 Skill 链路（链路 A 写下一章 / 链路 B 写公众号） |

### 2. 5 核心 Skill（novel + shortform 共用工程基础设施）

| Skill | 用途 |
|---|---|
| `idea-forge` | 灵感熔炉，8 类文本分类入库（灵感/语音/片段/人物/世界观/金手指/爽点/素材） |
| `architect` | 架构师，单章章纲生成。黄金三章 special_mode，章纲十段模板 |
| `hook-auditor` | 伏笔审计员，调用 audit_hooks.py，7 项职责，伏笔 4 态 status |
| `context-composer` | 上下文编排师，调用 build_context.py，三层组装 + Token 预算动态分桶，防漂移三铁律执行者 |
| `writer-polisher` | 执笔与精修，四阶段（写手/审计/精修/状态更新），产出章末摘要供下游消费 |

### 3. 4 shortform Skill（公众号文章链路专用）

| Skill | 用途 |
|---|---|
| `topic-curator` | 选题库管理，三维度评分（情绪浓度/争议度/品牌相关度） |
| `title-engineer` | 标题工程师，三维度打分 + 5 好 4 坏模式 + 7 种标题风格 |
| `brand-voice-guardian` | 品牌调性守护，维护 author_voice.md，五维度一致性检查 |
| `virality-auditor` | 传播性审计，四维度评分（金句密度/转发点/情绪曲线/标题契合） |

### 4. 4 守护 Skill（章级/卷级守护）

| Skill | 用途 |
|---|---|
| `state-consistency-checker` | 章级门禁，每章后跑 check_consistency.py，P0 阻断保存，P1 可豁免留痕 |
| `key-scene-archiver` | 关键场景存档器，每章后识别关键场景归档到 _scenes/，供 build_context.py Grep 召回（替代 RAG） |
| `recap-generator` | 前情提要生成器，每 10 章冻结一份 _recaps/recap_chXXX-YYY.md，作为稳定锚点 |
| `drift-detector` | 漂移检测器，每 10 章跑 5 维度长程漂移体检（意图/弧光/伏笔/套路/AI 味），不阻断 |

### 5. 通用工程 Skill

9 个通用 Skill：`dev-selfcheck`、`git-merge-guardian`、`verification-before-completion`、`writing-plans`、`tdd`、`plan-review`、`dispatching-parallel-agents`、`receiving-code-review`、`systematic-debugging`。这些与小说创作无关，是开发协作基础设施。

## 六、防漂移三铁律

DreamTale 从架构上保证世界观与人物设定不漂移，三条铁律不可违反：

1. **不注入历史正文**：执笔时只读 `00_控制面/author_intent.md` + `01_世界观/` + `02_人物/` + 上一章末尾摘要，不把历史章节全文塞进上下文。避免 Agent 改写历史正文导致设定漂移。
2. **Delta 增量**：每次执笔只写新增章节，Delta 记录由 `save_state.py` 写入 `.state/`。下一章执笔时只读上一章 Delta，不读全量历史。
3. **必读意图文件**：每次执笔前必读 `00_控制面/author_intent.md` 与 `current_focus.md`，确保当前章节服务于作者意图与全局弧光，不跑偏。

违反三铁律任一条，审计 Skill 直接打回重做。

## 七、去 AI 味双模式

去 AI 味贯穿 novel 与 shortform 两种模式，但侧重点不同：

| 维度 | novel 模式 | shortform 模式 |
|---|---|---|
| 套路句式 | 「我们可以看到」「这告诉我们」「不禁让人」等转折升华句 | 同左 |
| 套路剧情 | 金手指无代价、配角工具人、反派脸谱化 | 同左，但允许史实骨架决定的部分剧情 |
| 对白 | 解释性对白、信息倾倒对白 | 同左 |
| 节奏 | 每章必有高潮、每段必有转折 | 同左 |
| 升华段 | 章末强行升华、主题外露 | 同左 |

去 AI 味检测在审计 Skill（Layer1 规则）与总编 Skill（Layer2 LLM）双层执行。

## 八、核心脚本

`scripts/novelforge/` 下提供 5 个核心 Python 脚本，被 Skill 调用：

| 脚本 | 用途 |
|---|---|
| `save_state.py` | Delta 增量写入 `.state/`，维护角色/世界/伏笔状态机 |
| `audit_hooks.py` | 伏笔审计，扫描超期伏笔并分级提醒（critical/warning/forgetting） |
| `build_context.py` | 三层上下文组装（Protected/Selective/Retrieved），Token 预算动态分桶 |
| `check_consistency.py` | 章级一致性门禁（7 类检测：境界跳级/伏笔超期/角色状态/时间线/金手指强度/节奏曲线/语言指纹） |
| `check_ai_novel.py` | 去 AI 味检测（10 类 AI 味模式：信息倾倒/金手指滥用/爽点套路化/对白解释/升华外露等） |

## 九、快速开始

### 1. 环境准备

- [Trae IDE](https://trae.cn/)（用于加载 Skills 并调度 Agent）
- [Obsidian](https://obsidian.md/)（可选，用于阅读 Vault 产出）
- Python 3.9+（用于运行 `scripts/novelforge/` 下的脚本）

### 2. 打开项目

在 Trae IDE 中打开本仓库，`.trae/skills/` 与 `.trae/rules/` 会被自动加载，主入口 Skill `novelforge` 即可识别作者意图并路由。

### 3. 开始创作

参考 [NovelForge_Vault/00_控制面/USAGE.md](NovelForge_Vault/00_控制面/USAGE.md) 作者手册。常见入口：

- 「写下一章」→ 链路 A：`architect` → `context-composer` → `writer-polisher` → `state-consistency-checker`
- 「写一篇公众号」→ 链路 B：`topic-curator` → `title-engineer` → `writer-polisher`（shortform 模式）→ `virality-auditor`
- 「审计伏笔」→ `hook-auditor`
- 「体检漂移」→ `drift-detector`

### 4. 自检与校验

```bash
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
pytest -q
```

## 十、项目状态

- **当前 Phase**：Phase 0-7 全部完成（系统从 0 到 1 搭建就绪）。
- **已完成**：
  - Phase 0：Vault 骨架 + 通用工程资产就位
  - Phase 1：5 核心脚本（save_state / audit_hooks / build_context / check_consistency / check_ai_novel + schema）
  - Phase 2：5 核心 Skill（idea-forge / architect / hook-auditor / context-composer / writer-polisher）
  - Phase 3：4 shortform Skill（topic-curator / title-engineer / brand-voice-guardian / virality-auditor）
  - Phase 4：4 守护 Skill + 主入口（drift-detector / recap-generator / state-consistency-checker / key-scene-archiver / novelforge）
  - Phase 5：去 AI 味规则 + style_guide 双模式 + 角色语言指纹
  - Phase 6：联调修复 10 项断链 + USAGE.md 作者手册
  - Phase 7：全量自检 + loop_log 沉淀
- **下一步**：试写验证（用第 1 章做端到端 E2E，验证调度链全流程跑通）。
- **开发沉淀**：见 [docs/loop_log/2026-07.md](docs/loop_log/2026-07.md)。

## 十一、致谢

DreamTale 从 HaloRead（讲书笔记生成引擎）演进而来，继承了 9 个通用工程 Trae Skills、dev-workflow 协作流程、bug-reporting 规范、loop_log 沉淀机制等通用工程资产。讲书相关的历史参考材料保留在 `docs/_haloread_reference/`，详见 [MIGRATION_NOTES.md](docs/_haloread_reference/MIGRATION_NOTES.md)。

## License

本项目仅供学习与个人创作使用，未经授权不得用于商业出版。
