# M01 · Skill 间契约层修复

> **模块定位**：L1 修复工程债 · 第 1 模块（无前置依赖）
>
> **核心目标**：修复 NovelForge 14 个 Skill 之间"产出/消费契约缺失"的工程债 D2，让守护 Skill（recap-generator / drift-detector / state-consistency-checker）真正运转起来。
>
> **创建日期**：2026-07-18
> **文档版本**：v1.0
> **作者**：NovelForge 优化方案多专家团

---

## 一、模块目标

### 1.1 一句话目标

**让每个 NovelForge Skill 的 frontmatter 显式声明"产出什么文件 / 消费什么文件"，新增 `check_skill_contracts.py` 联调脚本验证契约闭环，并首先修复 writer-polisher 章末摘要断链这一最严重的 D2 工程债。**

### 1.2 对应的痛点

本模块对应 `docs/loop_log/2026-07.md` 沉淀教训 2「Skill 间契约缺失（writer-polisher 章末摘要断链，ai_course）」原话引用：

> writer-polisher 没产出 `.state/ch_NNN_summary.md`，但 recap-generator 和 drift-detector 都假设它产出了。根因：Skill 设计时只考虑自身职责，没明确"产出什么文件给下游消费"。**教训：Skill 间契约必须显式声明（产出方写"本 Skill 产出 X 文件"，消费方写"本 Skill 依赖 X 文件"），联调时验证契约闭环。**

同时覆盖 loop_log 沉淀教训 1「多 Agent 并行开发的路径契约不一致」中 10 项断链里的 1-3 项（与 M04 路径契约表模块协同处理）。

### 1.3 完成后达成的能力（可量化）

| 能力 | 当前状态 | 完成后 |
|---|---|---|
| 14 个 SKILL.md 含 produces/contracts frontmatter | 0/14 | 14/14 |
| writer-polisher 真实产出 `.state/ch_NNN_summary.md` | 仅在 SKILL.md 中声称，脚本未落地 | save_state.py 新增 `chapter_summaries/<NNN>` 路由，writer-polisher 阶段四第 4 步真实写入 |
| build_context.py 优先消费章末摘要 | 只读 published 正文首段 | `_read_prev_chapter_summary()` 优先读 `.state/ch_NNN_summary.md`，缺失时才回退正文首段 |
| 契约闭环联调脚本 | 不存在 | `scripts/novelforge/check_skill_contracts.py` 一键扫描全部契约一致性 |
| 契约登记文档 | 不存在 | `docs/contracts_registry.md` 单一信源，14 个 Skill 全部登记 |
| dev-checklist 含契约校验项 | 不含 | 新增 §九 "Skill 契约校验" 段 |

---

## 二、痛点对应

### 2.1 痛点表现：D2 工程债的精确断点

#### 断点 1：writer-polisher 声称产出但脚本未落地

`file:///workspace/.trae/skills/writer-polisher/SKILL.md` 阶段四第 4 步（第 226-248 行）明确写道：

```
### 第 4 步：写入章末摘要

为下游 `recap-generator` / `drift-detector` 准备 100-200 字本章摘要...
写入：
NovelForge_Vault/.state/ch_NNN_summary.md
...
> 本文件是 recap-generator 步骤 4 与 drift-detector 步骤 2 的输入；缺失时下游会回退读末 500 字正文，违反防漂移约束。novel 模式必须产出，shortform 模式跳过。
```

**但实际**：`file:///workspace/scripts/novelforge/save_state.py` 的 `_route_path()` 函数（第 281-332 行）仅支持 4 类 path root：

```python
def _route_path(path: str, vault: str) -> PathTarget:
    """路由 delta path 到目标文件与子路径。

    路由规则：
        - ``characters/<name>/...``  → ``.state/characters/<name>.json``
        - ``hooks/<hook_id>`` 或 ``hooks/<hook_id>/<field>``
        - ``world_timeline/...``     → ``.state/world_timeline.json``
        - ``pipeline/...``           → ``.state/pipeline.json``
    """
    # 仅处理 characters / hooks / world_timeline / pipeline 4 类
    ...
    raise ValueError(
        f"无法识别的 path 根: {root!r} (path={path!r})；"
        f"支持 characters/ / hooks/ / world_timeline / pipeline"
    )
```

即：**writer-polisher 即使按 SKILL.md 描述调用 `save_state.py apply_delta` 写章末摘要，也会因 path root 不识别而抛 ValueError，无法产出文件。** 当前是"声明产出了，但实际无法产出"的状态。

#### 断点 2：build_context.py 未消费章末摘要

`file:///workspace/scripts/novelforge/build_context.py` 的 `_read_prev_chapter_summary()` 函数（第 348-379 行）：

```python
def _read_prev_chapter_summary(vault: Path, chapter: int, volume: int) -> str:
    """读取前 1 章正文的首段摘要，无显式摘要则取正文前 300 字。"""
    if chapter <= 1:
        return ""
    prev_path = vault / "05_正文" / "published" / f"vol_{volume:02d}" / f"ch_{chapter - 1:03d}.md"
    text = _safe_read(prev_path)
    # ... 读取正文首段
```

**问题**：函数名虽含 "summary"，但实际只读 published 正文首段，**完全没有尝试读 `.state/ch_NNN_summary.md`**。这是 D2 断链的另一端——即使章末摘要真的产出，build_context.py 也不会消费它。

#### 断点 3：下游守护 Skill 假设上游已产出

- `file:///workspace/.trae/skills/recap-generator/SKILL.md` 步骤 4：「优先每章 writer-polisher 产出时写到 `NovelForge_Vault/.state/ch_NNN_summary.md` 的摘要，兜底：仅当摘要缺失时，读章节正文末尾 500 字」
- `file:///workspace/.trae/skills/drift-detector/SKILL.md` 工作流第 4 步：「读章末摘要：从 `_recaps/` 或 `.state/` 取 `[start, end]` 每章的 summary（**禁止读正文全文**）」

**问题**：两个守护 Skill 都把 `.state/ch_NNN_summary.md` 当作"已存在的事实"，但因为断点 1 + 断点 2，事实上不可能存在。recap-generator 兜底回退读末 500 字正文，违反防漂移三铁律第一条「不注入历史正文」。

### 2.2 loop_log 中识别的 10 项断链全景

来源：`file:///workspace/docs/loop_log/2026-07.md` Phase 6 联调记录。

| # | 断链 | 类型 | M01 处理范围 |
|---|---|---|---|
| 1 | writer-polisher 章末摘要断链（产出方 vs save_state.py 路由不识别） | 契约缺失 | ✅ 本模块核心修复 |
| 2 | build_context.py `_read_prev_chapter_summary` 未消费章末摘要 | 契约缺失 | ✅ 本模块核心修复 |
| 3 | recap-generator 假设上游产出章末摘要 | 契约缺失 | ✅ 本模块修复（frontmatter 声明） |
| 4 | drift-detector 假设上游产出章末摘要 | 契约缺失 | ✅ 本模块修复（frontmatter 声明） |
| 5 | 章纲路径 `04_大纲与脉络/ch_NNN_outline.md` vs `vol_NN/ch_NNN_outline.md` | 路径契约 | ⚠️ frontmatter 声明，但路径统一由 M04 处理 |
| 6 | recap 路径 `_recaps/ch_NNN_recap.md` vs `recap_chXXX-YYY.md` | 路径契约 | ⚠️ frontmatter 声明，但路径统一由 M04 处理 |
| 7 | 脚本调用形式 `python scripts/...` vs `python -m scripts...` | 路径契约 | ⚠️ frontmatter 声明，路径统一由 M04 |
| 8 | schema.py PIPELINE_SCHEMA 缺 4 个守护 Skill 引用字段 | schema 滞后 | ❌ 由 M02 模块处理 |
| 9 | style_guide.md 禁用词表与 check_ai_novel.py 检测词不一致 | 文档脱节 | ❌ 由 M03 模块处理 |
| 10 | key-scene-archiver 的 `archived_scenes` 字段写入路径不明确 | 契约模糊 | ✅ 本模块 frontmatter 声明 |

**M01 边界**：本模块只处理"契约声明缺失"类（断链 1/2/3/4/10），路径不一致类（5/6/7）由 M04 处理（但 M01 会在 frontmatter 中先固化标准路径，作为 M04 的输入），schema 滞后（8）由 M02 处理，文档脱节（9）由 M03 处理。模块间不重叠。

### 2.3 行业方案参考

| 来源 | 方案 | NovelForge 差异化设计 |
|---|---|---|
| **Sudowrite Story Bible** | 用"Story Bible"统一存储角色/设定/伏笔，每个生成步骤显式声明读取哪些 Bible 条目 | NovelForge 不引入单一 Bible 对象，而是用 **frontmatter YAML 声明 produces/consumes**，分散到 14 个 SKILL.md，更轻量、更易演进 |
| **NovelCrafter Codex** | Codex 是中央知识库，每个章节生成时通过 codex token 引用实体，保证引用闭合 | NovelForge 不引入 token 系统，而是 **用 file 路径做契约锚点**（"产出 `.state/ch_NNN_summary.md`"），契合"文件即真相"哲学 |
| **CreAgentive (ICLR 2026)** | 多 Agent 协作时用 message-passing 协议声明输入/输出 schema | NovelForge 借鉴其"显式声明输入输出 schema"思想，但用 YAML frontmatter 而非 message schema，更适配 Trae Skill 生态 |
| **Letta Filesystem Memory** | 用文件系统分层（core / working / archival）管理 Agent 记忆，每层有读写协议 | NovelForge 的 `.state/` 已是分层文件系统，本模块给它**显式读写协议**（契约 frontmatter） |

### 2.4 本模块的差异化设计

1. **不引入新的运行时依赖**：契约声明纯 YAML frontmatter，无 Python 框架，无 message queue，无 token 系统。
2. **不破坏文件即真相**：契约内容描述的是"文件路径"，不是抽象 ID。`produces: [".state/ch_NNN_summary.md"]` 直接对应磁盘文件。
3. **契约校验是 SSOT，非运行时强制**：`check_skill_contracts.py` 是开发期/CI 期校验脚本，不阻塞运行时（与 `state-consistency-checker` 的 P0 阻断协议不同），失败只告警不 kill，避免引入新的运行时风险。
4. **Delta 增量**：契约 frontmatter 是 Skill 文件的一部分，新增契约不破坏现有 SKILL.md 行为（向后兼容）。

---

## 三、涉及现有文件

### 3.1 14 个 NovelForge SKILL.md（全部需新增 frontmatter 契约段）

| # | Skill 名称 | 文件绝对路径 | 角色 |
|---|---|---|---|
| 1 | novelforge 主入口 | `file:///workspace/.trae/skills/novelforge/SKILL.md` | 调度 |
| 2 | idea-forge 灵感熔炉 | `file:///workspace/.trae/skills/idea-forge/SKILL.md` | 核心 |
| 3 | architect 架构师 | `file:///workspace/.trae/skills/architect/SKILL.md` | 核心 |
| 4 | hook-auditor 伏笔审计员 | `file:///workspace/.trae/skills/hook-auditor/SKILL.md` | 核心 |
| 5 | context-composer 上下文编排师 | `file:///workspace/.trae/skills/context-composer/SKILL.md` | 核心 |
| 6 | writer-polisher 执笔与精修 | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | 核心（D2 断点产出方） |
| 7 | key-scene-archiver 关键场景存档器 | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | 守护 |
| 8 | recap-generator 前情提要生成器 | `file:///workspace/.trae/skills/recap-generator/SKILL.md` | 守护（D2 断点消费方） |
| 9 | drift-detector 长程漂移检测器 | `file:///workspace/.trae/skills/drift-detector/SKILL.md` | 守护（D2 断点消费方） |
| 10 | state-consistency-checker 状态一致性检查器 | `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` | 守护 |
| 11 | topic-curator 选题库管理 | `file:///workspace/.trae/skills/topic-curator/SKILL.md` | shortform |
| 12 | title-engineer 标题工程师 | `file:///workspace/.trae/skills/title-engineer/SKILL.md` | shortform |
| 13 | brand-voice-guardian 品牌调性守护 | `file:///workspace/.trae/skills/brand-voice-guardian/SKILL.md` | shortform |
| 14 | virality-auditor 传播性审计 | `file:///workspace/.trae/skills/virality-auditor/SKILL.md` | shortform |

### 3.2 涉及的 Python 脚本（2 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/save_state.py` | 第 67-73 行常量段 + 第 281-332 行 `_route_path()` 函数 | 新增 `CHAPTER_SUMMARIES_DIR_REL` 常量 + 新增 `chapter_summaries/` 路由分支 |
| 2 | `file:///workspace/scripts/novelforge/build_context.py` | 第 348-379 行 `_read_prev_chapter_summary()` 函数 | 改造为优先读 `.state/ch_NNN_summary.md`，缺失时回退正文首段 |

### 3.3 涉及的规则 / Checklist 文件（1 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/.trae/checklists/dev-checklist.md` | 在 §八 去 AI 味 之后新增 §九 Skill 契约校验 | 新增章节 |

### 3.4 不修改但需要参考的文件

- `file:///workspace/.trae/rules/dev-workflow.md`（流程规则，不变）
- `file:///workspace/.trae/rules/bug-reporting.md`（bug 规范，新增 BUG-050 引用）
- `file:///workspace/scripts/novelforge/schema.py`（schema 校验，由 M02 处理，本模块不动）
- `file:///workspace/scripts/novelforge/check_consistency.py`（一致性脚本，本模块不动）
- `file:///workspace/scripts/novelforge/check_ai_novel.py`（去 AI 味脚本，本模块不动）
- `file:///workspace/scripts/novelforge/audit_hooks.py`（伏笔脚本，本模块不动）
- `file:///workspace/tests/bug_regression_list.md`（新增 BUG-050 条目）

---

## 四、新增/修改文件清单

### 4.1 新增文件（3 个）

| # | 文件路径 | 性质 | 核心内容 |
|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/check_skill_contracts.py` | 新增 Python 脚本（约 350 行） | 一键扫描 14 个 SKILL.md frontmatter，校验 produces/consumes 契约闭环；扫描 14 个 Skill 实际声明的文件路径是否与 contracts_registry.md 一致 |
| 2 | `file:///workspace/docs/contracts_registry.md` | 新增契约登记文档 | SSOT：14 个 Skill 的产出/消费文件清单 + 路径约定表（M04 的输入）+ 契约关系图（mermaid） |
| 3 | `file:///workspace/tests/test_skill_contracts.py` | 新增 pytest 测试用例 | 5 个测试用例覆盖契约闭环、章末摘要写入、章末摘要消费、契约登记一致性、回归用例 |

### 4.2 修改文件（17 个）

| # | 文件路径 | 修改点 |
|---|---|---|
| 1 | `file:///workspace/.trae/skills/novelforge/SKILL.md` | frontmatter 新增 `produces` / `consumes` / `produces_format` / `consumes_required` 4 字段 |
| 2 | `file:///workspace/.trae/skills/idea-forge/SKILL.md` | 同上 |
| 3 | `file:///workspace/.trae/skills/architect/SKILL.md` | 同上 |
| 4 | `file:///workspace/.trae/skills/hook-auditor/SKILL.md` | 同上 |
| 5 | `file:///workspace/.trae/skills/context-composer/SKILL.md` | 同上 |
| 6 | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | frontmatter 新增 4 字段；阶段四第 4 步新增"调用 save_state.py 写章末摘要"的真实执行指令（含命令示例） |
| 7 | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | frontmatter 新增 4 字段 |
| 8 | `file:///workspace/.trae/skills/recap-generator/SKILL.md` | frontmatter 新增 4 字段；步骤 4 显式声明"消费 `.state/ch_NNN_summary.md`，兜底读末 500 字" |
| 9 | `file:///workspace/.trae/skills/drift-detector/SKILL.md` | frontmatter 新增 4 字段；工作流第 4 步显式声明"消费 `.state/ch_NNN_summary.md`" |
| 10 | `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` | frontmatter 新增 4 字段 |
| 11 | `file:///workspace/.trae/skills/topic-curator/SKILL.md` | frontmatter 新增 4 字段 |
| 12 | `file:///workspace/.trae/skills/title-engineer/SKILL.md` | frontmatter 新增 4 字段 |
| 13 | `file:///workspace/.trae/skills/brand-voice-guardian/SKILL.md` | frontmatter 新增 4 字段 |
| 14 | `file:///workspace/.trae/skills/virality-auditor/SKILL.md` | frontmatter 新增 4 字段 |
| 15 | `file:///workspace/scripts/novelforge/save_state.py` | 新增 `CHAPTER_SUMMARIES_DIR_REL` 常量；`_route_path()` 新增 `chapter_summaries/` 路由分支；`apply_delta()` 新增对章末摘要的 set 操作支持 |
| 16 | `file:///workspace/scripts/novelforge/build_context.py` | `_read_prev_chapter_summary()` 改造为优先读 `.state/ch_NNN_summary.md`，缺失时回退正文首段（保留现有兜底逻辑） |
| 17 | `file:///workspace/.trae/checklists/dev-checklist.md` | 在 §八 之后新增 §九 Skill 契约校验段（5 项 checklist） |
| 18 | `file:///workspace/tests/bug_regression_list.md` | 新增 BUG-050 条目（writer-polisher 章末摘要断链） |

---

## 五、详细实现步骤

### 5.1 步骤 1：设计 frontmatter YAML 契约 schema

**目标**：定义统一的契约声明 schema，所有 14 个 SKILL.md 都按此格式声明。

**YAML schema 定义**（写入 `docs/contracts_registry.md` 作为 SSOT）：

```yaml
# 契约字段 schema
produces:                      # 本 Skill 产出哪些文件（list of path glob）
  - path: ".state/ch_NNN_summary.md"
    format: "markdown"
    description: "章末摘要，100-200 字，供 recap-generator / drift-detector 消费"
    required_when: "novel"    # novel 模式必产出，shortform 跳过

consumes:                      # 本 Skill 消费哪些文件（来自其他 Skill 的 produces）
  - path: ".state/characters/*.json"
    from_skill: "save_state.py / idea-forge"
    required: true             # 缺失则 Skill 无法启动
    fallback: null            # 无兜底
  - path: ".state/ch_NNN_summary.md"
    from_skill: "writer-polisher"
    required: false            # 可选消费
    fallback: "读 published 正文末尾 500 字"  # 缺失时的兜底策略

produces_format:               # 产出文件的格式规范
  chapter_summary:
    word_count: "100-200 字"
    structure: "## 关键事件 / ## 角色状态变化 / ## 伏笔变动 / ## 章末钩子"
    encoding: "utf-8"
    newline: "lf"

consumes_required:             # 启动前必须存在的文件清单（启动门禁）
  - "NovelForge_Vault/00_控制面/author_intent.md"
  - "NovelForge_Vault/00_控制面/current_focus.md"
```

### 5.2 步骤 2：14 个 SKILL.md 的 frontmatter 具体内容

每个 Skill 的 frontmatter 在现有 `name / description / version` 之后追加 `produces / consumes / produces_format / consumes_required` 4 字段。以下给出 4 个关键 Skill 的完整 frontmatter（其余 10 个 Skill 同理，详见 `docs/contracts_registry.md`）：

#### 5.2.1 writer-polisher（D2 核心修复 - 产出方）

```yaml
---
name: NovelForge 执笔与精修
description: NovelForge AI 长篇小说创作的执笔与精修 Skill...
version: 1.1.0   # bump from 1.0.0 → 1.1.0，契约层升级

produces:
  - path: "05_正文/published/vol_NN/ch_NNN.md"
    format: "markdown"
    description: "章节正文最终成品"
    required_when: "novel + shortform"
  - path: ".state/ch_NNN_summary.md"
    format: "markdown"
    description: "章末摘要，100-200 字，供 recap-generator / drift-detector 消费。novel 模式必产出，shortform 模式跳过"
    required_when: "novel"
  - path: ".state/characters/*.json"
    format: "json"
    description: "经 save_state.py 写入的角色状态 Delta"
    required_when: "novel + shortform"
  - path: ".state/pipeline.json"
    format: "json"
    description: "经 save_state.py 更新的进度状态"
    required_when: "novel + shortform"

consumes:
  - path: ".state/.cache/context_chNNN_<ts>.md"
    from_skill: "context-composer"
    required: true
    fallback: null
  - path: "NovelForge_Vault/00_控制面/author_intent.md"
    from_skill: "architect"
    required: true
    fallback: null
  - path: "NovelForge_Vault/00_控制面/current_focus.md"
    from_skill: "manual"
    required: true
    fallback: null
  - path: "NovelForge_Vault/00_控制面/style_guide.md"
    from_skill: "manual"
    required: true
    fallback: null
  - path: "04_大纲与脉络/vol_NN/ch_NNN_outline.md"
    from_skill: "architect"
    required: true
    fallback: null

produces_format:
  chapter_summary:
    word_count: "100-200 字"
    structure: |
      ## 关键事件
      ...
      ## 角色状态变化
      ...
      ## 伏笔变动
      ...
      ## 章末钩子
      ...
    encoding: "utf-8"
    newline: "lf"

consumes_required:
  - "NovelForge_Vault/00_控制面/author_intent.md"
  - "NovelForge_Vault/00_控制面/current_focus.md"
  - "NovelForge_Vault/00_控制面/style_guide.md"
---
```

#### 5.2.2 recap-generator（D2 核心修复 - 消费方）

```yaml
---
name: NovelForge 前情提要生成器
description: NovelForge 长篇小说前情提要生成器...
version: 1.1.0

produces:
  - path: "NovelForge_Vault/.state/_recaps/recap_chXXX-YYY.md"
    format: "markdown"
    description: "前情提要，覆盖 chXXX-YYY 章节，供 context-composer / drift-detector 消费"
    required_when: "novel"
  - path: ".state/pipeline.json"
    format: "json"
    description: "经 save_state.py 更新 last_recap_chapter 字段"
    required_when: "novel"

consumes:
  - path: ".state/ch_NNN_summary.md"
    from_skill: "writer-polisher"
    required: false
    fallback: "读章节正文末尾 500 字（违反防漂移三铁律，需告警）"
  - path: "NovelForge_Vault/00_控制面/author_intent.md"
    from_skill: "architect"
    required: true
    fallback: null

produces_format:
  recap:
    word_count: "800-1500 字"
    structure: |
      # 前情提要（chXXX-YYY）
      ## 主线推进
      ## 角色弧光
      ## 伏笔进度
      ## 关键场景
    encoding: "utf-8"
    newline: "lf"

consumes_required:
  - "NovelForge_Vault/00_控制面/author_intent.md"
---
```

#### 5.2.3 drift-detector（D2 核心修复 - 消费方）

```yaml
---
name: drift-detector
description: NovelForge 长程漂移检测器...
version: 1.1.0

produces:
  - path: "docs/drift_reports/drift_chXXX-YYY_<YYYYMMDD>.md"
    format: "markdown"
    description: "漂移体检报告，五维度软性预警，不阻断保存"
    required_when: "novel"

consumes:
  - path: ".state/ch_NNN_summary.md"
    from_skill: "writer-polisher"
    required: false
    fallback: "读章节正文末尾 500 字（违反防漂移三铁律，需告警）"
  - path: ".state/_recaps/recap_chXXX-YYY.md"
    from_skill: "recap-generator"
    required: true
    fallback: null
  - path: "NovelForge_Vault/00_控制面/author_intent.md"
    from_skill: "architect"
    required: true
    fallback: null

consumes_required:
  - "NovelForge_Vault/00_控制面/author_intent.md"
---
```

#### 5.2.4 context-composer（消费章末摘要）

```yaml
---
name: NovelForge 上下文编排师
description: NovelForge 长篇小说生成正文前的上下文组装入口...
version: 1.1.0

produces:
  - path: ".state/.cache/context_chNNN_<ts>.md"
    format: "markdown"
    description: "组装好的上下文文件，供 writer-polisher 消费"
    required_when: "novel + shortform"

consumes:
  - path: ".state/ch_NNN_summary.md"
    from_skill: "writer-polisher"
    required: false
    fallback: "读 published 正文首段（build_context.py 现有兜底）"
  - path: "NovelForge_Vault/00_控制面/author_intent.md"
    from_skill: "architect"
    required: true
    fallback: null
  - path: "NovelForge_Vault/00_控制面/current_focus.md"
    from_skill: "manual"
    required: true
    fallback: null
  - path: "04_大纲与脉络/vol_NN/ch_NNN_outline.md"
    from_skill: "architect"
    required: true
    fallback: null
  - path: ".state/characters/*.json"
    from_skill: "save_state.py / idea-forge"
    required: true
    fallback: null
  - path: "04_大纲与脉络/hooks_registry.json"
    from_skill: "hook-auditor / idea-forge"
    required: true
    fallback: null
  - path: ".state/_recaps/recap_chXXX-YYY.md"
    from_skill: "recap-generator"
    required: false
    fallback: "不注入历史 recap（防漂移）"
  - path: ".state/_scenes/*.md"
    from_skill: "key-scene-archiver"
    required: false
    fallback: "Grep 召回关键场景"

consumes_required:
  - "NovelForge_Vault/00_控制面/author_intent.md"
  - "NovelForge_Vault/00_控制面/current_focus.md"
---
```

#### 5.2.5 其余 10 个 SKILL.md 的契约要点

| Skill | produces 关键文件 | consumes 关键文件 |
|---|---|---|
| novelforge 主入口 | 无文件产出（调度） | author_intent.md, current_focus.md |
| idea-forge | 02_角色/*.md, 03_素材库/*.md, 01_世界观/*.md, 04_大纲与脉络/hooks_registry.json, 06_短文/topics.md, master_index.md | 用户输入, hooks_registry.json（读最大序号） |
| architect | 00_控制面/author_intent.md, 01_世界观/*.md, 04_大纲与脉络/story_arc.md, master_outline.md, vol_NN/vol_outline.md, vol_NN/ch_NNN_outline.md | author_intent.md L0, current_focus.md, vol_outline.md, hook-auditor 输出 |
| hook-auditor | hooks_registry.json 状态更新, 审计报告 | hooks_registry.json, audit_hooks.py 输出 |
| key-scene-archiver | _scenes/ch_NNN_角色_关键词.md, .state/pipeline.json 的 archived_scenes 字段 | 05_正文/published/vol_NN/ch_NNN.md, 02_角色/*.md, hooks_registry.json, .state/characters/*.json |
| state-consistency-checker | P0/P1 报告, .state/.lock/consistency_pass_ch{NNN}.flag 文件 | check_consistency.py 输出, .state/characters/*.json, hooks_registry.json, 章节正文 |
| topic-curator | 06_短文/topics.md 选题条目 | 03_素材库/inspirations.md, 06_短文/published/, author_voice.md |
| title-engineer | 标题候选 + 评分报告（对话内输出，无文件） | 06_短文/topics.md T-XXX 条目, 正文草稿 |
| brand-voice-guardian | 检查报告（无文件产出）, 初始化 00_控制面/author_voice.md | author_voice.md, 06_短文/ 正文 |
| virality-auditor | 传播性审计报告（无文件产出） | 06_短文/drafts/ 或 published/ 正文, style_guide.md §2 |

### 5.3 步骤 3：修复 writer-polisher 章末摘要产出（D2 核心修复）

#### 5.3.1 save_state.py 新增章末摘要路由

在 `file:///workspace/scripts/novelforge/save_state.py` 第 67-73 行常量段追加：

```python
# 各状态文件的相对路径
STATE_DIR_REL: str = ".state"
CHARACTERS_DIR_REL: str = ".state/characters"
HOOKS_REGISTRY_REL: str = "04_大纲与脉络/hooks_registry.json"
WORLD_TIMELINE_REL: str = ".state/world_timeline.json"
PIPELINE_REL: str = ".state/pipeline.json"
STATE_LOG_REL: str = ".state/state_update_log.json"
CHARACTERS_INDEX_REL: str = ".state/characters_index.md"
# ↓↓↓ 新增：章末摘要目录
CHAPTER_SUMMARIES_DIR_REL: str = ".state/chapter_summaries"  # 注意：存放 ch_NNN_summary.md
# 旧路径兼容（writer-polisher SKILL.md 历史声称写 .state/ch_NNN_summary.md，但本模块统一改为 .state/chapter_summaries/ch_NNN_summary.md，避免 .state/ 根目录文件混杂）
CHAPTER_SUMMARY_LEGACY_DIR_REL: str = ".state"  # 兼容历史声称，但推荐用新目录
```

**说明**：将章末摘要从 `.state/ch_NNN_summary.md`（混杂根目录）迁移到 `.state/chapter_summaries/ch_NNN_summary.md`（专用子目录），与 `.state/characters/` `.state/_recaps/` `.state/_scenes/` `.state/.cache/` 等子目录风格一致。`recap-generator` 和 `drift-detector` 的 SKILL.md frontmatter 同步更新路径。

#### 5.3.2 `_route_path()` 新增 chapter_summaries 分支

在 `file:///workspace/scripts/novelforge/save_state.py` 第 281-332 行的 `_route_path()` 函数中，在 `if root == "pipeline":` 分支之后、`raise ValueError` 之前插入：

```python
def _route_path(path: str, vault: str) -> PathTarget:
    """路由 delta path 到目标文件与子路径。

    路由规则：
        - ``characters/<name>/...``      → ``.state/characters/<name>.json``
        - ``hooks/<hook_id>``            → ``04_大纲与脉络/hooks_registry.json``
        - ``world_timeline/...``         → ``.state/world_timeline.json``
        - ``pipeline/...``               → ``.state/pipeline.json``
        - ``chapter_summaries/<NNN>``    → ``.state/chapter_summaries/ch_<NNN>_summary.md``  ← 新增
    """
    rest_str, rest = _split_path(path)
    if not rest:
        raise ValueError(f"path 不能为空: {path!r}")
    root = rest[0]
    rest = rest[1:]

    # ... 现有 characters / hooks / world_timeline / pipeline 分支保持不变 ...

    # ↓↓↓ 新增 chapter_summaries 分支
    if root == "chapter_summaries":
        if not rest:
            raise ValueError(
                f"chapter_summaries path 必须带章号 NNN: {path!r}"
            )
        chapter_str = rest[0]
        if not chapter_str.isdigit():
            raise ValueError(
                f"chapter_summaries 章号必须是数字: {chapter_str!r} (path={path!r})"
            )
        chapter_num = int(chapter_str)
        file_abs = _state_file_path(
            vault,
            f"{CHAPTER_SUMMARIES_DIR_REL}/ch_{chapter_num:03d}_summary.md",
        )
        return PathTarget("chapter_summary", file_abs, str(chapter_num), [])

    raise ValueError(
        f"无法识别的 path 根: {root!r} (path={path!r})；"
        f"支持 characters/ / hooks/ / world_timeline / pipeline / chapter_summaries"
    )
```

#### 5.3.3 `apply_delta()` 新增对章末摘要的 set 操作支持

章末摘要是纯文本文件（不是 JSON），需要在 `_apply_op()` 中新增 `chapter_summary` 类型分支。具体：

```python
# 在 _apply_op() 函数中新增 chapter_summary 类型处理
def _apply_op(op: Op, vault: str, file_states: dict) -> None:
    target = _route_path(op["path"], vault)

    # 加载初始状态
    if target.file_abs not in file_states:
        if target.kind == "character":
            # 现有逻辑
            ...
        elif target.kind == "chapter_summary":
            # 章末摘要是纯文本，不存在则视为空字符串
            file_states[target.file_abs] = ""
        # ... 其他类型 ...

    # 应用操作
    if target.kind == "chapter_summary":
        # 章末摘要只支持 set 操作（每次整体覆盖）
        if op["op"] != "set":
            raise ValueError(
                f"chapter_summary 只支持 set 操作，收到 {op['op']!r}"
            )
        # 校验字数 100-200（软告警，不阻断）
        content = op.get("value", "")
        if not isinstance(content, str):
            raise ValueError(
                f"chapter_summary value 必须是字符串，收到 {type(content).__name__}"
            )
        # 写入 .state/chapter_summaries/ch_NNN_summary.md
        _atomic_write_text(target.file_abs, content)
        file_states[target.file_abs] = content
        # 字数软校验
        word_count = len(content.replace(" ", "").replace("\n", ""))
        if word_count < 100 or word_count > 200:
            print(
                f"⚠️  警告：章末摘要 ch_{target.name} 字数 {word_count} 不在 100-200 范围",
                file=sys.stderr,
            )
        return

    # ... 其他类型的现有逻辑 ...
```

#### 5.3.4 writer-polisher SKILL.md 阶段四第 4 步真实执行指令

在 `file:///workspace/.trae/skills/writer-polisher/SKILL.md` 第 226-248 行"第 4 步：写入章末摘要"段，将现有描述替换为可直接执行的指令：

```markdown
### 第 4 步：写入章末摘要

为下游 `recap-generator` / `drift-detector` 准备 100-200 字本章摘要，避免它们读正文全文（防漂移三铁律之一）。

**生成内容**（写入 `.state/chapter_summaries/ch_NNN_summary.md`）：

\`\`\`markdown
## 关键事件
- 本章发生的核心事件（2-3 条）

## 角色状态变化
- 主角境界/能力/位置/关系的 Delta 变化

## 伏笔变动
- 本章埋设/推进/回收的伏笔 ID

## 章末钩子
- 本章结尾的悬念/反转/情绪钩子一句话
\`\`\`

**执行命令**（主 Agent 调用）：

\`\`\`bash
python scripts/novelforge/save_state.py apply_delta \
  --vault NovelForge_Vault \
  --delta '{
    "ops": [
      {
        "op": "set",
        "path": "chapter_summaries/<NNN>",
        "value": "## 关键事件\n- ...\n\n## 角色状态变化\n- ...\n\n## 伏笔变动\n- ...\n\n## 章末钩子\n- ..."
      }
    ]
  }'
\`\`\`

其中 `<NNN>` 替换为本章章号（3 位补零，如 `042`）。

**契约验证**：执行后用 `python scripts/novelforge/check_skill_contracts.py --skill writer-polisher --chapter <NNN>` 验证文件已生成且字数合规。

**契约约束**：
- novel 模式必须产出，shortform 模式跳过。
- 本文件是 recap-generator 步骤 4 与 drift-detector 步骤 2 的输入。
- 缺失时下游会回退读末 500 字正文，**违反防漂移三铁律第一条"不注入历史正文"**，必须在 dev-checklist §九 中标记为未通过。
```

### 5.4 步骤 4：修复 build_context.py 消费章末摘要（D2 核心修复）

在 `file:///workspace/scripts/novelforge/build_context.py` 第 348-379 行的 `_read_prev_chapter_summary()` 函数改造为：

```python
def _read_prev_chapter_summary(vault: Path, chapter: int, volume: int) -> str:
    """读取前 1 章的章末摘要。

    优先级：
        1. 优先读 writer-polisher 产出的 `.state/chapter_summaries/ch_<NNN>_summary.md`
        2. 兼容旧路径 `.state/ch_<NNN>_summary.md`（M01 之前的版本声称但未真实产出）
        3. 兜底：读 published 正文首段前 300 字（违反防漂移三铁律，输出告警到 stderr）

    Args:
        vault: Vault 根目录 Path。
        chapter: 当前章号（1-based）。
        volume: 当前卷号。

    Returns:
        章末摘要字符串；前 1 章不存在或摘要缺失时返回空字符串。
    """
    if chapter <= 1:
        return ""

    prev_chapter = chapter - 1

    # 优先级 1：新路径 .state/chapter_summaries/ch_<NNN>_summary.md
    summary_new_path = (
        vault / ".state" / "chapter_summaries" / f"ch_{prev_chapter:03d}_summary.md"
    )
    summary_text = _safe_read(summary_new_path)
    if summary_text:
        return summary_text

    # 优先级 2：旧路径 .state/ch_<NNN>_summary.md（兼容历史声称）
    summary_legacy_path = vault / ".state" / f"ch_{prev_chapter:03d}_summary.md"
    summary_text = _safe_read(summary_legacy_path)
    if summary_text:
        import sys
        print(
            f"⚠️  警告：检测到旧路径章末摘要 {summary_legacy_path}，"
            f"建议迁移到 .state/chapter_summaries/ch_{prev_chapter:03d}_summary.md",
            file=sys.stderr,
        )
        return summary_text

    # 优先级 3：兜底读 published 正文首段前 300 字（违反防漂移三铁律）
    prev_path = (
        vault / "05_正文" / "published" / f"vol_{volume:02d}" / f"ch_{prev_chapter:03d}.md"
    )
    text = _safe_read(prev_path)
    if not text:
        return ""

    import sys
    print(
        f"⚠️  警告：章末摘要 ch_{prev_chapter:03d}_summary.md 缺失，"
        f"违反防漂移三铁律第一条'不注入历史正文'，已回退读 published 正文首段。"
        f"请检查 writer-polisher 阶段四第 4 步是否真实产出章末摘要。",
        file=sys.stderr,
    )
    # ... 现有读正文首段逻辑保持不变 ...
    first_para = _extract_first_paragraph(text)
    return first_para[:300]
```

### 5.5 步骤 5：新增 `check_skill_contracts.py` 联调脚本

#### 5.5.1 伪代码

```
function check_skill_contracts(vault, skills_dir):
    contracts = load_all_skill_contracts(skills_dir)  # 解析 14 个 SKILL.md frontmatter
    registry = load_contracts_registry()              # 读 docs/contracts_registry.md

    errors = []

    # 1. 检查每个 Skill 的 frontmatter 是否含 produces / consumes 字段
    for skill in contracts:
        if not skill.has('produces'):
            errors.append(f"{skill.name}: frontmatter 缺 produces 字段")
        if not skill.has('consumes'):
            errors.append(f"{skill.name}: frontmatter 缺 consumes 字段")

    # 2. 检查 produces/consumes 闭环：每个 consumes 必须有对应 produces
    all_produced = collect_all_produced_files(contracts)
    for skill in contracts:
        for consume in skill.consumes:
            if consume.required and consume.path not in all_produced:
                errors.append(f"{skill.name}: 消费 {consume.path} 但无 Skill 声明产出")

    # 3. 检查契约登记一致性：frontmatter 与 contracts_registry.md 一致
    for skill in contracts:
        if not registry.match(skill):
            errors.append(f"{skill.name}: frontmatter 与 contracts_registry.md 不一致")

    # 4. 检查章末摘要是否真实产出（针对 writer-polisher 章节）
    if args.chapter:
        summary_path = vault / ".state" / "chapter_summaries" / f"ch_{args.chapter:03d}_summary.md"
        if not summary_path.exists():
            errors.append(f"章末摘要缺失: {summary_path}")

    # 5. 输出报告
    if errors:
        print("❌ 契约校验失败:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("✅ 契约校验通过：14 个 Skill 契约闭环")
        sys.exit(0)
```

#### 5.5.2 实际可执行 Python 代码片段

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NovelForge Skill 契约闭环校验脚本。

校验 14 个 SKILL.md frontmatter 的 produces/consumes 契约是否闭环。

Usage:
    python scripts/novelforge/check_skill_contracts.py
    python scripts/novelforge/check_skill_contracts.py --vault NovelForge_Vault
    python scripts/novelforge/check_skill_contracts.py --skill writer-polisher --chapter 042
"""

from __future__ import annotations
import argparse
import re
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    yaml = None  # 降级到正则解析

DEFAULT_SKILLS_DIR = "/workspace/.trae/skills"
DEFAULT_VAULT = "/workspace/NovelForge_Vault"
DEFAULT_REGISTRY = "/workspace/docs/contracts_registry.md"

# 14 个 NovelForge Skill 名称（用于校验完整性）
EXPECTED_SKILLS = [
    "novelforge",
    "idea-forge",
    "architect",
    "hook-auditor",
    "context-composer",
    "writer-polisher",
    "key-scene-archiver",
    "recap-generator",
    "drift-detector",
    "state-consistency-checker",
    "topic-curator",
    "title-engineer",
    "brand-voice-guardian",
    "virality-auditor",
]


def parse_frontmatter(skill_md_path: Path) -> dict[str, Any]:
    """解析 SKILL.md 的 YAML frontmatter（支持 yaml 库缺失时降级到正则）。"""
    text = skill_md_path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end == -1:
        return {}
    fm_text = text[3:end].strip()
    if yaml:
        return yaml.safe_load(fm_text) or {}
    # 降级：正则解析 produces/consumes 顶层字段（不解析嵌套结构）
    result: dict[str, Any] = {}
    for key in ("name", "description", "version", "produces", "consumes"):
        m = re.search(rf"^{key}:\s*(.+?)$", fm_text, re.MULTILINE)
        if m:
            result[key] = m.group(1)
    return result


def collect_all_produced_files(contracts: list[dict]) -> set[str]:
    """收集所有 Skill 声明产出的文件路径 glob。"""
    produced = set()
    for c in contracts:
        for p in c.get("produces") or []:
            if isinstance(p, dict):
                produced.add(p.get("path", ""))
            elif isinstance(p, str):
                produced.add(p)
    return produced


def check_contracts闭环(contracts: list[dict]) -> list[str]:
    """检查每个 consumes 必须有对应 produces（闭环）。"""
    errors = []
    all_produced = collect_all_produced_files(contracts)
    for c in contracts:
        name = c.get("name", "?")
        for cs in c.get("consumes") or []:
            if isinstance(cs, dict):
                path = cs.get("path", "")
                required = cs.get("required", False)
                if required and path and not _path_in_produced(path, all_produced):
                    errors.append(
                        f"{name}: 消费 {path}（required=true）但无 Skill 声明产出"
                    )
    return errors


def _path_in_produced(consume_path: str, produced: set[str]) -> bool:
    """检查 consume_path 是否在 produced 集合中（支持 glob 通配）。"""
    for p in produced:
        if p == consume_path:
            return True
        # 简单通配：*.json 匹配任意 .json
        if "*" in p:
            pattern = re.escape(p).replace(r"\*", ".*")
            if re.fullmatch(pattern, consume_path):
                return True
    return False


def check_frontmatter_complete(contracts: list[dict]) -> list[str]:
    """检查每个 Skill 的 frontmatter 是否含 produces/consumes 字段。"""
    errors = []
    for c in contracts:
        name = c.get("name", "?")
        if "produces" not in c:
            errors.append(f"{name}: frontmatter 缺 produces 字段")
        if "consumes" not in c:
            errors.append(f"{name}: frontmatter 缺 consumes 字段")
    return errors


def check_skill_list_complete(found_skills: list[str]) -> list[str]:
    """检查 14 个 Skill 是否全部存在。"""
    errors = []
    for expected in EXPECTED_SKILLS:
        if expected not in found_skills:
            errors.append(f"缺失 Skill 文件: {expected}/SKILL.md")
    return errors


def check_chapter_summary_exists(vault: Path, chapter: int) -> list[str]:
    """检查指定章号的章末摘要是否真实产出。"""
    errors = []
    summary_path = vault / ".state" / "chapter_summaries" / f"ch_{chapter:03d}_summary.md"
    if not summary_path.exists():
        errors.append(f"章末摘要缺失: {summary_path}")
        return errors
    # 字数校验
    content = summary_path.read_text(encoding="utf-8")
    word_count = len(content.replace(" ", "").replace("\n", ""))
    if word_count < 100 or word_count > 200:
        errors.append(
            f"章末摘要字数 {word_count} 不在 100-200 范围: {summary_path}"
        )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="NovelForge Skill 契约闭环校验")
    parser.add_argument("--skills-dir", default=DEFAULT_SKILLS_DIR)
    parser.add_argument("--vault", default=DEFAULT_VAULT)
    parser.add_argument("--registry", default=DEFAULT_REGISTRY)
    parser.add_argument("--skill", help="只校验指定 Skill")
    parser.add_argument("--chapter", type=int, help="额外校验指定章号的章末摘要")
    args = parser.parse_args()

    skills_dir = Path(args.skills_dir)
    vault = Path(args.vault)

    # 1. 加载所有 SKILL.md frontmatter
    contracts: list[dict] = []
    found_skills: list[str] = []
    for skill_dir in skills_dir.iterdir():
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        fm = parse_frontmatter(skill_md)
        if fm:
            fm["_skill_dir"] = skill_dir.name
            contracts.append(fm)
            found_skills.append(skill_dir.name)

    # 2. 校验
    errors: list[str] = []
    errors.extend(check_skill_list_complete(found_skills))
    errors.extend(check_frontmatter_complete(contracts))
    errors.extend(check_contracts闭环(contracts))

    # 3. 额外校验章末摘要
    if args.chapter:
        errors.extend(check_chapter_summary_exists(vault, args.chapter))

    # 4. 输出报告
    if errors:
        print("❌ 契约校验失败:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print(f"✅ 契约校验通过：{len(contracts)} 个 Skill 契约闭环")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 5.6 步骤 6：新增 `docs/contracts_registry.md` 契约登记文档

```markdown
# NovelForge Skill 契约登记（SSOT）

> 本文件是 NovelForge 14 个 Skill 产出/消费文件契约的单一信源。
> 每次新增/修改 Skill 时必须同步更新本文件，并运行 `python scripts/novelforge/check_skill_contracts.py` 验证闭环。
> 创建日期：2026-07-18（M01 模块产出）

---

## 一、契约字段 schema

详见 [M01 方案文档 §五.1](./optimization_plan_2026_07/M01_skill_contract_layer.md#51-步骤-1设计-frontmatter-yaml-契约-schema)。

## 二、14 个 Skill 契约登记

### 2.1 novelforge 主入口

| 字段 | 值 |
|---|---|
| produces | 无文件产出（调度） |
| consumes | author_intent.md, current_focus.md |

### 2.2 idea-forge

| 字段 | 值 |
|---|---|
| produces | 02_角色/*.md, 03_素材库/*.md, 01_世界观/*.md, 04_大纲与脉络/hooks_registry.json, 06_短文/topics.md, master_index.md |
| consumes | 用户输入, hooks_registry.json（读最大序号） |

### 2.3 architect

| 字段 | 值 |
|---|---|
| produces | 00_控制面/author_intent.md, 01_世界观/*.md, 04_大纲与脉络/story_arc.md, master_outline.md, vol_NN/vol_outline.md, vol_NN/ch_NNN_outline.md |
| consumes | author_intent.md L0, current_focus.md, vol_outline.md, hook-auditor 输出 |

### 2.4 hook-auditor

| 字段 | 值 |
|---|---|
| produces | hooks_registry.json 状态更新, 审计报告 |
| consumes | hooks_registry.json, audit_hooks.py 输出 |

### 2.5 context-composer

| 字段 | 值 |
|---|---|
| produces | .state/.cache/context_chNNN_<ts>.md |
| consumes | .state/ch_NNN_summary.md (writer-polisher), author_intent.md, current_focus.md, ch_NNN_outline.md, .state/characters/*.json, hooks_registry.json, _recaps/recap_chXXX-YYY.md, _scenes/*.md |

### 2.6 writer-polisher

| 字段 | 值 |
|---|---|
| produces | 05_正文/published/vol_NN/ch_NNN.md, **.state/chapter_summaries/ch_NNN_summary.md**, .state/characters/*.json, .state/pipeline.json |
| consumes | .state/.cache/context_chNNN_<ts>.md (context-composer), author_intent.md, current_focus.md, style_guide.md, ch_NNN_outline.md |

### 2.7 key-scene-archiver

| 字段 | 值 |
|---|---|
| produces | _scenes/ch_NNN_角色_关键词.md, .state/pipeline.json 的 archived_scenes 字段 |
| consumes | 05_正文/published/vol_NN/ch_NNN.md, 02_角色/*.md, hooks_registry.json, .state/characters/*.json |

### 2.8 recap-generator

| 字段 | 值 |
|---|---|
| produces | .state/_recaps/recap_chXXX-YYY.md, .state/pipeline.json 的 last_recap_chapter 字段 |
| consumes | **.state/chapter_summaries/ch_NNN_summary.md (writer-polisher)**, author_intent.md |

### 2.9 drift-detector

| 字段 | 值 |
|---|---|
| produces | docs/drift_reports/drift_chXXX-YYY_<YYYYMMDD>.md |
| consumes | **.state/chapter_summaries/ch_NNN_summary.md (writer-polisher)**, _recaps/recap_chXXX-YYY.md (recap-generator), author_intent.md |

### 2.10 state-consistency-checker

| 字段 | 值 |
|---|---|
| produces | P0/P1 报告, .state/.lock/consistency_pass_ch{NNN}.flag |
| consumes | check_consistency.py 输出, .state/characters/*.json, hooks_registry.json, 章节正文 |

### 2.11 topic-curator

| 字段 | 值 |
|---|---|
| produces | 06_短文/topics.md 选题条目 |
| consumes | 03_素材库/inspirations.md, 06_短文/published/, author_voice.md |

### 2.12 title-engineer

| 字段 | 值 |
|---|---|
| produces | 标题候选 + 评分报告（对话内输出，无文件） |
| consumes | 06_短文/topics.md T-XXX 条目, 正文草稿 |

### 2.13 brand-voice-guardian

| 字段 | 值 |
|---|---|
| produces | 检查报告（无文件产出）, 初始化 00_控制面/author_voice.md |
| consumes | author_voice.md, 06_短文/ 正文 |

### 2.14 virality-auditor

| 字段 | 值 |
|---|---|
| produces | 传播性审计报告（无文件产出） |
| consumes | 06_短文/drafts/ 或 published/ 正文, style_guide.md §2 |

---

## 三、契约关系图（mermaid）

\`\`\`mermaid
graph LR
    architect -->|author_intent.md| context-composer
    architect -->|ch_NNN_outline.md| context-composer
    architect -->|author_intent.md| writer-polisher
    hook-auditor -->|hooks_registry.json| context-composer
    context-composer -->|context_chNNN.md| writer-polisher
    writer-polisher -->|ch_NNN.md| key-scene-archiver
    writer-polisher -->|ch_NNN_summary.md| recap-generator
    writer-polisher -->|ch_NNN_summary.md| drift-detector
    writer-polisher -->|ch_NNN_summary.md| context-composer
    recap-generator -->|recap_chXXX-YYY.md| drift-detector
    recap-generator -->|recap_chXXX-YYY.md| context-composer
    key-scene-archiver -->|_scenes/*.md| context-composer
    writer-polisher -->|characters/*.json| state-consistency-checker
    hook-auditor -->|hooks_registry.json| state-consistency-checker
\`\`\`

---

## 四、路径约定表（M04 路径契约模块的输入）

| 资源类型 | 标准路径 | 备注 |
|---|---|---|
| 章纲 | `04_大纲与脉络/vol_NN/ch_NNN_outline.md` | M04 统一 |
| 章末摘要 | `.state/chapter_summaries/ch_NNN_summary.md` | M01 新增 |
| 前情提要 | `.state/_recaps/recap_chXXX-YYY.md` | M04 统一 |
| 关键场景 | `.state/_scenes/ch_NNN_角色_关键词.md` | M04 统一 |
| 漂移报告 | `docs/drift_reports/drift_chXXX-YYY_<YYYYMMDD>.md` | M01 新增 |
| 上下文缓存 | `.state/.cache/context_chNNN_<ts>.md` | 现有 |
| 一致性 flag | `.state/.lock/consistency_pass_ch{NNN}.flag` | 现有 |
| 脚本调用 | `python scripts/novelforge/<script>.py` | M04 统一（非 `python -m`） |

---

## 五、契约变更流程

1. 修改任一 SKILL.md 的 frontmatter 后，**必须同步更新本文件**对应 Skill 的契约登记段。
2. 运行 `python scripts/novelforge/check_skill_contracts.py` 验证闭环。
3. 在 `docs/loop_log/YYYY-MM.md` 追加一条契约变更记录（#lesson: ai_course）。
```

### 5.7 步骤 7：在 `dev-checklist.md` 新增 §九 Skill 契约校验段

在 `file:///workspace/.trae/checklists/dev-checklist.md` 现有 §八去 AI 味之后追加：

```markdown
## 九、Skill 契约校验（新增/修改 Skill 时必检）

- [ ] 14 个 SKILL.md 的 frontmatter 含 `produces` / `consumes` / `produces_format` / `consumes_required` 4 字段（运行 `python scripts/novelforge/check_skill_contracts.py` 全部通过）
- [ ] 契约闭环：每个 `consumes` 中 `required=true` 的文件都有对应 Skill 在 `produces` 中声明
- [ ] `docs/contracts_registry.md` 与 SKILL.md frontmatter 一致（修改 Skill 时同步更新登记文档）
- [ ] writer-polisher 产出章节时，`.state/chapter_summaries/ch_NNN_summary.md` 真实生成（章末摘要字数 100-200，运行 `check_skill_contracts.py --skill writer-polisher --chapter <NNN>` 通过）
- [ ] build_context.py 优先消费 `.state/chapter_summaries/ch_NNN_summary.md`，缺失时 stderr 告警（不静默回退）
- [ ] 新增 Skill 时已在本文件登记契约（详见 §五 实现步骤 6）
```

同时更新 `dev-checklist.md` 的"自检报告模板"段，在 §八去 AI 味之后追加：

```markdown
### 九、Skill 契约校验
- ✅/❌ 14 个 SKILL.md frontmatter 完整：____
- ✅/❌ 契约闭环：____
- ✅/❌ contracts_registry.md 一致：____
- ✅/❌ 章末摘要真实产出：____
- ✅/❌ build_context.py 优先消费章末摘要：____
- ✅/❌ 新增 Skill 已登记：____
```

---

## 六、验证方式

### 6.1 单元测试（pytest）

```bash
# 运行契约校验脚本的单元测试
cd /workspace
pytest -q tests/test_skill_contracts.py -v
```

预期输出：5 个测试用例全部 PASSED。

### 6.2 集成测试

```bash
# 1. 校验 14 个 Skill frontmatter 闭环
python scripts/novelforge/check_skill_contracts.py

# 2. 校验指定章节的章末摘要（需先有 writer-polisher 产出的章节）
python scripts/novelforge/check_skill_contracts.py --skill writer-polisher --chapter 001

# 3. 验证 save_state.py 新路由可用（dry-run）
python scripts/novelforge/save_state.py apply_delta \
  --vault NovelForge_Vault \
  --delta '{"ops":[{"op":"set","path":"chapter_summaries/999","value":"## 关键事件\n- 测试\n\n## 角色状态变化\n- 无\n\n## 伏笔变动\n- 无\n\n## 章末钩子\n- 测试钩子"}]}'

# 4. 验证文件已生成
ls -la NovelForge_Vault/.state/chapter_summaries/ch_999_summary.md

# 5. 验证 build_context.py 优先消费
python -c "
from pathlib import Path
import sys
sys.path.insert(0, 'scripts/novelforge')
from build_context import _read_prev_chapter_summary
result = _read_prev_chapter_summary(Path('NovelForge_Vault'), 1000, 1)
print('读到摘要:', result[:80])
"

# 6. 清理 dry-run 测试文件
rm NovelForge_Vault/.state/chapter_summaries/ch_999_summary.md
```

### 6.3 断言清单

| # | 断言内容 | 期望 |
|---|---|---|
| 1 | `check_skill_contracts.py` 退出码 | 0（全部通过） |
| 2 | `save_state.py apply_delta` 写入 chapter_summaries/999 后文件存在 | True |
| 3 | 写入的章末摘要字数 | 100-200 |
| 4 | `build_context._read_prev_chapter_summary(vault, 1000, 1)` 返回非空 | True（读到 dry-run 摘要） |
| 5 | 14 个 SKILL.md frontmatter 含 produces + consumes 字段 | 14/14 |
| 6 | 每个 `consumes: required=true` 都有对应 produces | 全部闭环 |
| 7 | 章末摘要缺失时 stderr 输出告警 | "违反防漂移三铁律第一条" |

### 6.4 与现有校验脚本的关系

| 现有脚本 | 关系 | 说明 |
|---|---|---|
| `check_consistency.py` | 互补，不冲突 | 一致性脚本管"状态机字段漂移"；契约脚本管"Skill 间文件路径闭环"，互不重叠 |
| `check_ai_novel.py` | 互补，不冲突 | 去 AI 味脚本管"内容质量"；契约脚本管"工程契约"，互不重叠 |
| `state-consistency-checker` Skill | 互补，不冲突 | 该 Skill 是 P0 阻断门禁；契约脚本是开发期/CI 期告警，不阻断运行时 |
| `audit_hooks.py` | 互补，不冲突 | 伏笔脚本管"伏笔回收"；契约脚本管"Skill 间文件契约" |

**关键边界**：`check_skill_contracts.py` 是开发期/CI 期校验，不阻塞运行时（即使契约校验失败，writer-polisher 仍可继续运行，但会在 dev-checklist §九 标记未通过）。这避免了引入新的运行时风险。

---

## 七、回归测试要求

### 7.1 新增 pytest 用例（5 个）

文件路径：`file:///workspace/tests/test_skill_contracts.py`

| # | 测试函数名 | 断言内容 |
|---|---|---|
| 1 | `test_all_14_skills_have_contract_frontmatter` | 14 个 SKILL.md 的 frontmatter 都含 `produces` 和 `consumes` 字段 |
| 2 | `test_contracts_闭环_no_orphan_consumes` | 每个 `consumes: required=true` 都有对应 Skill 在 `produces` 中声明（无孤儿消费） |
| 3 | `test_save_state_writes_chapter_summary` | `save_state.py apply_delta` 调用 `chapter_summaries/<NNN>` 路由后，文件 `.state/chapter_summaries/ch_<NNN>_summary.md` 真实生成，字数 100-200 |
| 4 | `test_build_context_prefers_chapter_summary` | `_read_prev_chapter_summary()` 在章末摘要存在时优先返回摘要内容，不读 published 正文 |
| 5 | `test_build_context_warns_when_summary_missing` | 章末摘要缺失时，stderr 输出包含"违反防漂移三铁律第一条"告警，回退读正文首段 |

测试用例骨架（5 个测试函数完整实现）：

```python
# tests/test_skill_contracts.py
"""M01 Skill 契约层修复的回归测试。"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SKILLS_DIR = REPO_ROOT / ".trae" / "skills"
SCRIPTS_DIR = REPO_ROOT / "scripts" / "novelforge"

EXPECTED_SKILLS = [
    "novelforge", "idea-forge", "architect", "hook-auditor",
    "context-composer", "writer-polisher", "key-scene-archiver",
    "recap-generator", "drift-detector", "state-consistency-checker",
    "topic-curator", "title-engineer", "brand-voice-guardian", "virality-auditor",
]


def _parse_frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end == -1:
        return {}
    fm_text = text[3:end].strip()
    try:
        import yaml
        return yaml.safe_load(fm_text) or {}
    except ImportError:
        return {"_raw": fm_text}


# 测试 1：14 个 Skill 都有契约 frontmatter
def test_all_14_skills_have_contract_frontmatter():
    missing = []
    for skill_name in EXPECTED_SKILLS:
        skill_md = SKILLS_DIR / skill_name / "SKILL.md"
        if not skill_md.exists():
            missing.append(f"{skill_name}: SKILL.md 不存在")
            continue
        fm = _parse_frontmatter(skill_md)
        if "produces" not in fm:
            missing.append(f"{skill_name}: 缺 produces")
        if "consumes" not in fm:
            missing.append(f"{skill_name}: 缺 consumes")
    assert not missing, "契约 frontmatter 缺失: " + "; ".join(missing)


# 测试 2：契约闭环 - 无孤儿 consumes
def test_contracts_闭环_no_orphan_consumes():
    all_produced = set()
    contracts = []
    for skill_name in EXPECTED_SKILLS:
        skill_md = SKILLS_DIR / skill_name / "SKILL.md"
        if not skill_md.exists():
            continue
        fm = _parse_frontmatter(skill_md)
        contracts.append((skill_name, fm))
        for p in fm.get("produces") or []:
            if isinstance(p, dict):
                all_produced.add(p.get("path", ""))
            elif isinstance(p, str):
                all_produced.add(p)

    orphans = []
    for skill_name, fm in contracts:
        for cs in fm.get("consumes") or []:
            if isinstance(cs, dict) and cs.get("required"):
                path = cs.get("path", "")
                if path and path not in all_produced:
                    orphans.append(f"{skill_name}: 消费 {path} 但无 Skill 产出")
    assert not orphans, "孤儿 consumes: " + "; ".join(orphans)


# 测试 3：save_state.py 能写入章末摘要
def test_save_state_writes_chapter_summary(tmp_path):
    """用临时 vault 测试 save_state.py 的 chapter_summaries 路由。"""
    vault = tmp_path / "vault"
    (vault / ".state").mkdir(parents=True)

    # 构造 delta
    delta = {
        "ops": [
            {
                "op": "set",
                "path": "chapter_summaries/999",
                "value": "## 关键事件\n- 测试事件A\n- 测试事件B\n\n"
                         "## 角色状态变化\n- 主角境界从筑基初期到筑基中期\n\n"
                         "## 伏笔变动\n- 埋设 HOOK-001\n\n"
                         "## 章末钩子\n- 突然出现的黑影",
            }
        ]
    }
    delta_file = tmp_path / "delta.json"
    delta_file.write_text(json.dumps(delta, ensure_ascii=False), encoding="utf-8")

    # 调用 save_state.py
    import subprocess
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS_DIR / "save_state.py"),
            "apply_delta",
            "--vault", str(vault),
            "--delta-file", str(delta_file),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"save_state 失败: {result.stderr}"

    summary_path = vault / ".state" / "chapter_summaries" / "ch_999_summary.md"
    assert summary_path.exists(), f"章末摘要未生成: {summary_path}"

    content = summary_path.read_text(encoding="utf-8")
    word_count = len(content.replace(" ", "").replace("\n", ""))
    assert 100 <= word_count <= 200, f"章末摘要字数 {word_count} 不在 100-200 范围"


# 测试 4：build_context 优先读章末摘要
def test_build_context_prefers_chapter_summary(tmp_path, monkeypatch):
    """build_context._read_prev_chapter_summary 优先读 .state/chapter_summaries/。"""
    vault = tmp_path / "vault"
    summary_dir = vault / ".state" / "chapter_summaries"
    summary_dir.mkdir(parents=True)
    summary_path = summary_dir / "ch_041_summary.md"
    summary_path.write_text("## 关键事件\n- 这是章末摘要内容", encoding="utf-8")

    # published 正文也存在（应不被读到）
    published_dir = vault / "05_正文" / "published" / "vol_01"
    published_dir.mkdir(parents=True)
    (published_dir / "ch_041.md").write_text("这是正文首段，不应被读到", encoding="utf-8")

    sys.path.insert(0, str(SCRIPTS_DIR))
    from build_context import _read_prev_chapter_summary
    result = _read_prev_chapter_summary(vault, 42, 1)
    assert "章末摘要内容" in result
    assert "正文首段" not in result


# 测试 5：章末摘要缺失时告警 + 回退
def test_build_context_warns_when_summary_missing(tmp_path, capsys):
    """章末摘要缺失时 stderr 告警 + 回退读正文首段。"""
    vault = tmp_path / "vault"
    # 故意不创建章末摘要
    published_dir = vault / "05_正文" / "published" / "vol_01"
    published_dir.mkdir(parents=True)
    (published_dir / "ch_041.md").write_text("正文首段作为兜底", encoding="utf-8")

    sys.path.insert(0, str(SCRIPTS_DIR))
    from build_context import _read_prev_chapter_summary
    result = _read_prev_chapter_summary(vault, 42, 1)
    assert "正文首段" in result
    captured = capsys.readouterr()
    assert "违反防漂移三铁律" in captured.err or "违反防漂移三铁律" in captured.out
```

### 7.2 更新 `tests/bug_regression_list.md` 新增 BUG-050

在 `file:///workspace/tests/bug_regression_list.md` 末尾追加（按 bug-reporting.md 规范的描述性标题 + 编号字段）：

```markdown
## writer-polisher 章末摘要断链（recap-generator / drift-detector 无法运转）

- **编号**：BUG-050
- **首次出现**：2026-07-18（M01 模块识别）
- **类型**：契约缺失 / 状态漂移
- **现象**：writer-polisher SKILL.md 阶段四第 4 步声称写入 `.state/ch_NNN_summary.md`，但实际未产出文件。recap-generator 和 drift-detector 假设其产出，导致守护 Skill 兜底回退读 published 正文末尾 500 字，违反防漂移三铁律第一条"不注入历史正文"。
- **根因**：
  1. save_state.py 的 `_route_path()` 函数（第 281-332 行）只支持 4 类 path root（characters/hooks/world_timeline/pipeline），没有 chapter_summaries 路由，导致 writer-polisher 即使按 SKILL.md 描述调用 apply_delta 也会抛 ValueError。
  2. build_context.py 的 `_read_prev_chapter_summary()` 函数（第 348-379 行）只读 published 正文首段，未消费 `.state/ch_NNN_summary.md`。
  3. Skill 设计时只考虑自身职责，未明确"产出什么文件给下游消费"（loop_log 2026-07 沉淀教训 2）。
- **修复**：
  1. save_state.py 新增 `CHAPTER_SUMMARIES_DIR_REL` 常量 + `_route_path()` 新增 `chapter_summaries/` 路由分支 + `apply_delta()` 新增 chapter_summary 类型 set 操作支持。
  2. build_context.py `_read_prev_chapter_summary()` 改造为优先读 `.state/chapter_summaries/ch_<NNN>_summary.md`，缺失时 stderr 告警并回退正文首段。
  3. 14 个 SKILL.md frontmatter 新增 produces/consumes 契约字段。
  4. 新增 `check_skill_contracts.py` 联调脚本 + `docs/contracts_registry.md` SSOT 登记。
  5. dev-checklist.md 新增 §九 Skill 契约校验段。
- **涉及文件**：
  - `scripts/novelforge/save_state.py`（_route_path 新增 chapter_summaries 路由）
  - `scripts/novelforge/build_context.py`（_read_prev_chapter_summary 改造）
  - `.trae/skills/writer-polisher/SKILL.md`（阶段四第 4 步真实执行指令 + frontmatter）
  - `.trae/skills/recap-generator/SKILL.md`（frontmatter 显式消费 ch_NNN_summary.md）
  - `.trae/skills/drift-detector/SKILL.md`（同上）
  - `.trae/skills/context-composer/SKILL.md`（同上）
  - 其余 10 个 SKILL.md（frontmatter 新增契约字段）
  - `scripts/novelforge/check_skill_contracts.py`（新增）
  - `docs/contracts_registry.md`（新增）
  - `.trae/checklists/dev-checklist.md`（新增 §九）
  - `tests/test_skill_contracts.py`（新增 5 个测试用例）
- **回归测试**：
  - `tests/test_skill_contracts.py::test_all_14_skills_have_contract_frontmatter`
  - `tests/test_skill_contracts.py::test_contracts_闭环_no_orphan_consumes`
  - `tests/test_skill_contracts.py::test_save_state_writes_chapter_summary`
  - `tests/test_skill_contracts.py::test_build_context_prefers_chapter_summary`
  - `tests/test_skill_contracts.py::test_build_context_warns_when_summary_missing`
- **复现步骤**：
  1. 调用 writer-polisher 生成 ch_001 正文。
  2. 检查 `.state/ch_001_summary.md` 或 `.state/chapter_summaries/ch_001_summary.md` 是否存在。
  3. 修复前：文件不存在。修复后：文件存在且字数 100-200。
- **频次**：第 1 次（首次识别 + 修复）。
- **教训/沉淀**：Skill 间契约必须显式声明（产出方写"本 Skill 产出 X 文件"，消费方写"本 Skill 依赖 X 文件"），联调时验证契约闭环。已沉淀为 `docs/contracts_registry.md` SSOT + `check_skill_contracts.py` 联调脚本，避免同类断链复发。loop_log 2026-07 沉淀教训 2 已入 checklist（dev-checklist §九）。
```

### 7.3 在 check_consistency.py / check_ai_novel.py 中新增的检测规则

**本模块不在 check_consistency.py / check_ai_novel.py 中新增检测规则**。

理由：
- `check_consistency.py` 是状态机字段一致性检测（角色/伏笔/时间线等），契约层属于工程层不属于内容层。
- `check_ai_novel.py` 是去 AI 味检测（信息倾倒/金手指/爽点套路等），与契约层无关。
- 契约层校验由独立的 `check_skill_contracts.py` 承担，遵循"单一职责"原则，避免污染现有检测脚本。

**例外**：在 `dev-checklist.md §九` 中新增"运行 `check_skill_contracts.py` 全部通过"作为合并前必检项，与 check_consistency.py / check_ai_novel.py 并列。

---

## 八、风险点与回滚方案

### 8.1 风险等级评估

| # | 风险点 | 等级 | 理由 | 缓解措施 |
|---|---|---|---|---|
| 1 | save_state.py `_route_path()` 新增 chapter_summaries 路由分支可能影响现有 4 类路由 | **低** | 新增分支是纯增量，不动现有 characters/hooks/world_timeline/pipeline 路由逻辑；只在 raise ValueError 之前插入 | 完整 pytest 回归覆盖现有 4 类路由 |
| 2 | build_context.py `_read_prev_chapter_summary()` 改造可能影响现有上下文组装行为 | **中** | 改变了"读什么"的优先级，可能让旧版本（无章末摘要）的 Vault 行为变化 | 保留兜底逻辑（缺失时回退读正文首段），并通过 stderr 告警；测试 5 覆盖兜底路径 |
| 3 | 章末摘要路径从 `.state/ch_NNN_summary.md`（writer-polisher 历史声称）迁移到 `.state/chapter_summaries/ch_NNN_summary.md`（M01 新增）可能与历史文档冲突 | **中** | writer-polisher SKILL.md 第 233 行、recap-generator SKILL.md、drift-detector SKILL.md 都引用了旧路径 | build_context.py 同时支持新旧两路径（优先新，兼容旧并 stderr 告警）；同步更新所有 SKILL.md 引用 |
| 4 | 14 个 SKILL.md frontmatter 批量修改可能引入 YAML 语法错误 | **低** | YAML 解析有标准库支撑，CI 会立即报错 | 新增 `test_all_14_skills_have_contract_frontmatter` 测试用例 + `check_skill_contracts.py` 校验 |
| 5 | `check_skill_contracts.py` 是新增脚本，可能与未来 M02 schema 校验、M04 路径契约校验重叠 | **低** | M01 范围明确（契约 frontmatter + 章末摘要闭环），M02 管 schema，M04 管路径，互不冲突 | 在 contracts_registry.md §四 路径约定表中标注"M04 输入"，明确边界 |
| 6 | writer-polisher SKILL.md 阶段四第 4 步新增"调用 save_state.py apply_delta"指令，可能让主 Agent 误以为这是 Skill 自动调度 | **低** | dev-workflow.md §零 已明确 Skill 不调度，由主 Agent 调用工具；指令写"主 Agent 调用" | 在指令前加注释"主 Agent 用 RunCommand 工具执行以下命令" |

### 8.2 对核心资产的影响

| 核心资产 | 是否修改 | 影响 | 保护措施 |
|---|---|---|---|
| `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口） | 是 | frontmatter 追加 4 字段（不删除现有字段）；writer-polisher 阶段四第 4 步新增执行指令 | 现有 description / 工作流 / 反模式段全部保留；version 1.0.0 → 1.1.0 |
| `NovelForge_Vault/00_控制面/style_guide.md` | 否 | 不动 | 本模块不触碰风格基线 |
| `scripts/novelforge/check_consistency.py` | 否 | 不动 | 一致性脚本不被污染 |
| `scripts/novelforge/check_ai_novel.py` | 否 | 不动 | 去 AI 味脚本不被污染 |
| `scripts/novelforge/save_state.py` | 是 | 新增 chapter_summaries 路由 + 新增 chapter_summary 类型 set 操作 | 现有 4 类路由逻辑不变；新增逻辑在 raise ValueError 之前 |
| `scripts/novelforge/build_context.py` | 是 | `_read_prev_chapter_summary()` 改造 | 保留兜底逻辑；测试 5 覆盖兜底路径 |

### 8.3 回滚方案

#### 8.3.1 回滚触发条件

- 任一核心 Skill（writer-polisher / recap-generator / drift-detector / context-composer）的 frontmatter 修改导致 Skill 加载失败
- save_state.py 新增 chapter_summaries 路由导致现有 4 类路由 pytest 失败
- build_context.py 改造导致上下文组装产出异常（Token 超限、内容为空等）
- `check_skill_contracts.py` 在 CI 中持续报错无法收敛

#### 8.3.2 回滚步骤（按风险等级从高到低）

**回滚 1：build_context.py 改造回滚**（中风险，优先回滚）

```bash
cd /workspace
git revert HEAD~1 -- scripts/novelforge/build_context.py
# 或手动恢复 _read_prev_chapter_summary() 为只读 published 正文首段的旧逻辑
pytest -q tests/test_build_context.py
```

**回滚 2：save_state.py 新增路由回滚**（低风险）

```bash
cd /workspace
git revert HEAD~2 -- scripts/novelforge/save_state.py
# 删除 _route_path() 中 chapter_summaries 分支
# 删除 apply_delta() 中 chapter_summary 类型处理
# 删除 CHAPTER_SUMMARIES_DIR_REL 常量
pytest -q tests/test_save_state.py
```

**回滚 3：14 个 SKILL.md frontmatter 回滚**（低风险）

```bash
cd /workspace
# 批量回滚 14 个 SKILL.md（用 git checkout 单文件）
for skill in novelforge idea-forge architect hook-auditor context-composer writer-polisher key-scene-archiver recap-generator drift-detector state-consistency-checker topic-curator title-engineer brand-voice-guardian virality-auditor; do
  git checkout HEAD~3 -- .trae/skills/$skill/SKILL.md
done
```

**回滚 4：新增文件回滚**（无风险）

```bash
cd /workspace
rm scripts/novelforge/check_skill_contracts.py
rm docs/contracts_registry.md
rm tests/test_skill_contracts.py
```

**回滚 5：dev-checklist.md §九回滚**（无风险）

```bash
cd /workspace
git checkout HEAD~4 -- .trae/checklists/dev-checklist.md
```

#### 8.3.3 回滚后验证

```bash
# 验证回滚后系统恢复到 M01 之前状态
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
pytest -q
# 三项全过即回滚成功
```

#### 8.3.4 数据备份

由于本模块只新增/修改代码文件，不涉及 Vault 数据迁移，无需额外数据备份。但建议在回滚前用 `git stash` 保存当前未提交修改：

```bash
cd /workspace
git stash push -m "M01 WIP before rollback" -- scripts/ .trae/skills/ .trae/checklists/ docs/contracts_registry.md tests/test_skill_contracts.py
```

---

## 九、完成标准（DoD 清单）

本模块完成的标准是以下 7 项全部 ✅：

- [ ] **1. save_state.py 新增 chapter_summaries 路由**：`_route_path()` 支持 `chapter_summaries/<NNN>` 路径，`apply_delta()` 支持 chapter_summary 类型的 set 操作，写入 `.state/chapter_summaries/ch_<NNN>_summary.md`，字数 100-200 软告警。
- [ ] **2. build_context.py 优先消费章末摘要**：`_read_prev_chapter_summary()` 改造为优先读 `.state/chapter_summaries/ch_<NNN>_summary.md`，缺失时 stderr 告警并回退正文首段（保留兜底）。
- [ ] **3. 14 个 SKILL.md frontmatter 含契约字段**：每个 SKILL.md 的 frontmatter 含 `produces` / `consumes` / `produces_format` / `consumes_required` 4 字段；运行 `python scripts/novelforge/check_skill_contracts.py` 全部通过。
- [ ] **4. 新增 `check_skill_contracts.py` 联调脚本**：脚本路径 `scripts/novelforge/check_skill_contracts.py`，支持 `--vault` / `--skill` / `--chapter` 参数，退出码 0=通过 / 1=失败，CI 可直接集成。
- [ ] **5. 新增 `docs/contracts_registry.md` SSOT**：14 个 Skill 契约全部登记，含 mermaid 契约关系图 + 路径约定表（作为 M04 输入）+ 契约变更流程。
- [ ] **6. dev-checklist.md 新增 §九 Skill 契约校验段**：6 项 checklist + 自检报告模板对应段；与 §三一致性、§八去 AI 味 并列。
- [ ] **7. 5 个 pytest 测试用例全部通过 + BUG-050 入册**：`tests/test_skill_contracts.py` 5 个测试函数 PASSED；`tests/bug_regression_list.md` 新增 BUG-050 条目按 bug-reporting.md 规范填写完整；执行 `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` + `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` + `pytest -q` 三项全部通过。

---

## 附录 A：与 M02 / M03 / M04 的边界

| 模块 | 范围 | 与 M01 的边界 |
|---|---|---|
| M02 schema 同步门禁 | 修复 PIPELINE_SCHEMA 缺 4 个守护 Skill 字段 | M01 不动 schema.py，M02 不动 SKILL.md frontmatter；M02 完成后契约 frontmatter 的 `consumes: .state/pipeline.json` 字段引用才真正有效 |
| M03 文档与脚本 SSOT 校验 | 修复 style_guide.md 禁用词表 vs check_ai_novel.py 不一致 | M01 不动 style_guide.md / check_ai_novel.py；M03 完成后契约 frontmatter 的 `consumes: style_guide.md` 才是真正 SSOT |
| M04 路径契约表模板 | 修复 10 项路径不一致（章纲/recap/脚本调用形式等） | M01 在 contracts_registry.md §四 路径约定表中固化标准路径作为 M04 输入；M04 在 dispatching-parallel-agents Skill 中使用该表 |

## 附录 B：参考来源

- `file:///workspace/docs/loop_log/2026-07.md` 沉淀教训 2「Skill 间契约缺失」
- `file:///workspace/docs/loop_log/2026-07.md` 沉淀教训 1「多 Agent 并行开发的路径契约不一致」
- `file:///workspace/.trae/rules/dev-workflow.md` §一 第三步执行规范
- `file:///workspace/.trae/rules/bug-reporting.md` Bug 记录与回归规范
- Sudowrite Story Bible（前端产出/消费契约模式）
- NovelCrafter Codex（中央知识库 token 引用模式）
- CreAgentive (ICLR 2026 投稿)（多 Agent message-passing 协议）
- Letta Filesystem Memory（分层文件系统读写协议）

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 优化方案多专家团（架构师 + 测试 + 规则三视角评审待办）
**评审状态**：待 plan-review Skill 三视角评审
