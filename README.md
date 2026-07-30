# DreamTale：纯本地 HTML 小说创作阅读站 + AI 可插拔增强

> 浏览器即应用，文件即真相。一个不依赖任何后台的纯本地 HTML 小说创作与阅读站；AI 是可插拔增强，不装 AI 也能完整写作。
> 数据格式与 `NovelForge_Vault` 1:1 对齐，ZIP 导入导出可直接丢给 Obsidian 打开。

## 一、项目定位

DreamTale 是一个**纯本地 HTML 小说创作阅读站**：

- **零后台依赖**：纯静态 HTML + JS，`python3 -m http.server` 即可启动，无数据库、无服务端、无向量库。
- **AI 可插拔**：AI 是增强而非必需。不配 AI 也能完整写作、阅读、管理 Vault；接入 AI 后获得大纲生成、爽点挖掘、润色、纠错四项辅助能力。
- **文件即真相**：所有产出是 Markdown / JSON 文件，与 `NovelForge_Vault` 目录结构 1:1 对齐，ZIP 包可丢给 Obsidian 直接打开。
- **Trae Skill 双轨**：网页版（`web/`）与原 Trae IDE Skill 体系（`.trae/skills/`）是两条独立路径，共用同一套 Vault 数据格式与 `scripts/novelforge/` 核心脚本。

## 二、四层解耦架构

`web/src/` 下五层解耦，Core 层零 AI 依赖（由 `scripts/check_core_no_ai.py` 守护）：

| 层级 | 目录 | 职责 | AI 依赖 |
|---|---|---|---|
| Core | `web/src/core/` | models / vault-schema / markdown，数据模型与渲染 | 零依赖 |
| Adapter | `web/src/ai/` | base / openai / ide / mock adapter + config-manager + factory，多后端 AI 调用封装 | 可切换 |
| Modules | `web/src/modules/` | outline-generator / highlight-miner / text-polisher / manifest-loader，AI 创作辅助 | 依赖 Adapter |
| Extension | `web/src/extension/` | hotspot-aggregator / inspiration-library / genre-matcher，热点与灵感库 | 可选 |
| Audit | `web/src/audit/` | consistency-checker / file-watcher，对接本地桥接服务 | 桥接可选 |

UI 功能模块位于 `web/static/js/features/`：projects / settings / outline / chapters / hooks / ai-panel / ai-writer / hotspots / inspirations / audit / trae-integration。阅读器与编辑器位于 `web/static/js/`（`reader.js` / `editor.js`），三主题 CSS 在 `web/static/css/`（sepia / light / dark）。

存储双模位于 `web/src/storage/`：IndexedDB（默认）+ File System Access API（直读本地目录），并支持 ZIP 导入导出。

## 三、5 阶段实现状态

| Phase | 内容 | 状态 |
|---|---|---|
| Phase 1 | 架构底座：四层解耦 + Core 零 AI 依赖 + 存储双模 | ✅ |
| Phase 2 | 纯本地核心：作品/设定/大纲/章节/伏笔/阅读器/编辑器/三主题 | ✅ |
| Phase 3 | AI 创作辅助：Adapter 多后端 + 4 Tab（大纲生成/爽点挖掘/润色/纠错） | ✅ |
| Phase 4 | 扩展生态：热点聚合 + 灵感库 + 题材匹配 | ✅ |
| Phase 5 | 高级审计 + Trae 集成：consistency-checker / file-watcher / 桥接服务 / Trae 面板 | ✅ |

**当前状态**：Phase 1-5 全部完成。前端单测 14 个 `.test.js`（Vitest + jsdom + fake-indexeddb）全绿；后端沿用 NovelForge 原版 5 个核心 Python 脚本。

## 四、Vault 目录结构

`NovelForge_Vault/` 是 Obsidian Vault，DreamTale 网页版与该目录结构 1:1 对齐：

```
NovelForge_Vault/
├── 00_控制面/     # author_intent / current_focus / master_index / style_guide
├── 01_世界观/     # core_rules / factions / geography / items_and_concepts
├── 02_角色/       # protagonist / antagonists / supporting / extras
├── 03_素材库/     # inspirations / names_and_places / plot_devices / writing_techniques
├── 04_大纲与脉络/ # master_outline / story_arc / hooks_registry / vol_NN/ch_NNN_outline
├── 06_审计/       # 执笔审计报告
├── 06_短文/       # shortform 模式产出（topics / drafts / published）
├── _recaps/       # 每 10 章冻结的前情提要（稳定锚点）
├── _scenes/       # 关键场景存档（替代 RAG 召回）
└── .state/        # 状态机（角色/世界/伏笔），由脚本读写，禁止手编
```

## 五、防漂移三铁律（创作哲学，网页版工程化执行）

1. **不注入历史正文**：执笔时只读意图文件 + 上一章末尾摘要，不把历史章节全文塞进上下文。网页版 Modules 层默认按此约束组装 prompt。
2. **Delta 增量**：每次执笔只写新增章节，状态机由 `save_state.py` 写入 `.state/`，网页版通过桥接服务读取，禁止前端直写。
3. **必读意图文件**：每次执笔前必读 `00_控制面/author_intent.md` 与 `current_focus.md`。

违反三铁律任一条，Audit 层 `check_consistency.py` 直接打回。网页版通过 `scripts/dreamtale/bridge-server.py` 调用同一套检测脚本，不重复造轮子。

## 六、Trae Skill 体系（IDE 内路径）

`.trae/skills/` 下保留 14 个 NovelForge Skill（1 主入口 + 5 核心 + 4 shortform + 4 守护）+ 9 个通用工程 Skill，是 Trae IDE 内的创作编排路径，与网页版独立。完整列表与职责见 [`.trae/skills/`](.trae/skills/) 各子目录 `SKILL.md`，作者手册见 [NovelForge_Vault/00_控制面/USAGE.md](NovelForge_Vault/00_控制面/USAGE.md)。

## 七、核心脚本

| 脚本 | 用途 |
|---|---|
| `scripts/novelforge/save_state.py` | Delta 增量写入 `.state/`，维护角色/世界/伏笔状态机 |
| `scripts/novelforge/audit_hooks.py` | 伏笔审计，扫描超期伏笔并分级提醒 |
| `scripts/novelforge/build_context.py` | 三层上下文组装（Protected/Selective/Retrieved），Token 预算动态分桶 |
| `scripts/novelforge/check_consistency.py` | 章级一致性门禁（7 类检测） |
| `scripts/novelforge/check_ai_novel.py` | 去 AI 味检测（10 类 AI 味模式） |
| `scripts/novelforge/skills_manifest.json` | 5 个核心 AI 能力的 prompt 模板，与 Trae Skill 对齐 |
| `scripts/dreamtale/bridge-server.py` | 本地 HTTP 桥接（端口 7861），封装上述脚本调用 + SSE 文件变更事件 |
| `scripts/check_core_no_ai.py` | 扫描 Core 层 AI 关键字泄漏，守住四层解耦 |

## 八、快速开始

### 方式 1：纯前端启动（推荐，零依赖）

```bash
cd /workspace/web
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000/
```

### 方式 2：项目根目录启动

```bash
cd /workspace
python3 server.py
# 浏览器访问 http://localhost:8000/
```

### 方式 3：启用 AI 增强

1. 浏览器内打开应用 →「AI 配置」面板
2. 选择适配器类型（OpenAI 兼容 / Trae IDE 内置 / Mock 测试）
3. 填入 API Key 或选择 IDE 集成
4.「AI 写作」面板的 4 个 Tab 即可用

### 方式 4：启用本地桥接（可选，用于审计功能）

```bash
python3 scripts/dreamtale/bridge-server.py --port 7861 --vault NovelForge_Vault
# 浏览器内「审计」面板会自动连接
```

### 自检与校验

```bash
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
python scripts/check_core_no_ai.py
cd web && npx vitest run
```

## 九、致谢

DreamTale 从 HaloRead（讲书笔记生成引擎）演进而来，先后经历三个阶段：

1. **HaloRead**：讲书笔记生成引擎，沉淀了 9 个通用工程 Trae Skills、dev-workflow 协作流程、bug-reporting 规范、loop_log 沉淀机制。
2. **NovelForge Skills**：在 HaloRead 通用资产之上构建 14 个小说创作 Skill，确立防漂移三铁律、四层上下文组装、去 AI 味双模式等核心方法论。
3. **DreamTale 网页版**：将 NovelForge Skill 体系重构为纯本地 HTML 站点，AI 可插拔，文件格式与 NovelForge_Vault 1:1 对齐，让创作流程脱离 IDE 也能跑。

讲书相关的历史参考材料保留在 `docs/_haloread_reference/`，迁移说明见 [docs/_haloread_reference/MIGRATION_NOTES.md](docs/_haloread_reference/MIGRATION_NOTES.md)。开发沉淀见 [docs/loop_log/](docs/loop_log/)。

## License

本项目仅供学习与个人创作使用，未经授权不得用于商业出版。
