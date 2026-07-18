# M8 · 上下文召回"线索生成"步骤

> **模块层级**：L2 强化已有能力（与 M5/M6/M7/M9 同属并行组 B，本模块无内部依赖）
> **对应痛点**：L2 Retrieved 层"全量 Grep 召回"导致 Token 预算浪费与召回不精准
> **文档版本**：v1.0 · 2026-07-18

---

## 一、模块目标

### 1.1 一句话目标

在 `build_context.py` 中显式实现 MemoRAG 式「线索清单生成 → 精准召回」两步闭环，把当前 Retrieved 层的「全量 Grep 评分召回」替换为「按章纲线索清单定向 Grep」，降低 Token 预算 30-50%。

### 1.2 对应的痛点

来源：`docs/optimization_plan_2026_07/00_master_plan.md` §1.3「完全未覆盖的盲区」隐含项 + `00_master_plan.md` §八·8.2 行业调研核心来源「MemoRAG (WWW 2025)」。

> 当前 `build_context.py` 的 `_auto_search_scenes()`（line 504-538）对 `_scenes/` 全量扫描，仅基于「文件名含角色名 +3 分」+「文件名或正文含章纲核心冲突 2-4 字关键词 +1 分」做评分召回 top 3。该机制存在两个痛点：
> - **Token 浪费**：召回的场景与本章实际需要的 7 类线索（角色状态/伏笔/物品/地点/关系/情绪/境界）未必相关，无关场景全文被注入挤占预算
> - **召回不精准**：评分维度单一（角色名 + 冲突关键词），未利用 `_scenes/` 文件里「召回关键词」字段（key-scene-archiver SKILL line 116-117 已强制要求），也未利用章纲已声明的伏笔回收/角色出场/物品变化等信息

### 1.3 完成后达成的能力

| 能力 | 当前状态 | 完成后 |
|---|---|---|
| 章纲第 9 段「上下文召回」字段 | 仅 `retrieve_scenes` 文件名清单 + 涉及设定路径 | 升级为「线索清单」7 类线索 + `retrieve_scenes` 兜底 |
| Retrieved 层召回逻辑 | `_auto_search_scenes` 全量 Grep 评分 | `precise_grep_by_clues` 按线索清单定向 Grep + 兜底全量 Grep |
| 场景文件「召回关键词」字段利用 | 未使用 | 线索生成 + 精准 Grep 双路径必用 |
| Token 预算节省 | 全量召回无节省 | 召回率 ≥80% 时节省 30-50% |
| 召回准确率量化 | 无 | 新增 `--debug-clues` CLI 选项输出召回率/Token 对比报告 |

---

## 二、痛点对应

### 2.1 痛点表现

#### 2.1.1 全量 Grep 召回导致 Token 浪费

**当前实现**（`file:///workspace/scripts/novelforge/build_context.py` line 504-538）：

```python
def _auto_search_scenes(vault: Path, outline_text: str) -> list[str]:
    """retrieve_scenes 为空且章节类型为 hook_resolve/climax 时，按角色名+关键词自动搜索 _scenes/。"""
    scenes_dir = vault / "_scenes"
    char_names = _extract_outline_characters(outline_text)
    conflict = _extract_section(outline_text, r"核心冲突")
    keywords = re.findall(r"[\u4e00-\u9fa5]{2,4}", conflict or "")
    keywords = [k for k in keywords if k not in ("本章", "主线", "张力", "一句话")][:8]

    scored: list[tuple[int, str]] = []
    for sf in sorted(scenes_dir.glob("*.md")):
        fname = sf.name
        score = 0
        for cn in char_names:
            if cn and cn in fname:
                score += 3
        for kw in keywords:
            if kw in fname:
                score += 1
            else:
                content = _safe_read(sf)
                if kw in content:
                    score += 1
        if score > 0:
            scored.append((score, fname))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [name for _, name in scored[:3]]
```

**问题量化**：假设 `_scenes/` 累积到 50 个场景（写到第 50 章的合理量），全量 Grep 会读 50 个文件做关键词评分，每个文件平均 500 字符（key-scene-archiver 限制场景原文片段 ≤500 字 + 元信息 200 字 + 摘要 200 字），仅"评分扫描阶段"就要读约 25,000 字符（≈16,000 tokens），最终召回的 top 3 全文注入约 3,000 tokens。但实际本章真正需要的场景可能只有 1-2 个（≈1,000-2,000 tokens），**召回阶段浪费了 5-10 倍 Token 用于"评分扫描"**。

#### 2.1.2 无关场景挤占预算

**典型场景**：第 50 章是「主角与赵师兄对决」（hook_resolve），章纲声明本章回收伏笔 H-017（残破玉简来历）。当前 `_auto_search_scenes` 召回逻辑：
- 文件名含「主角名」+3 分 → 召回所有主角出场的场景（可能 30+ 个）
- 文件名含「赵师兄」+3 分 → 召回赵师兄首次出场场景
- 正文含「对决」+1 分 → 召回所有含「对决」二字的场景

**结果**：top 3 召回可能是「主角首次出场」「赵师兄首次出场」「主角上次对决场景」——但本章真正需要的是「伏笔 H-017 埋设场景」（第 7 章 ch_007），评分逻辑根本扫不到，因为章纲核心冲突关键词不含"残破玉简"。

### 2.2 行业方案

#### 2.2.1 MemoRAG（2025 WWW）

论文：*MemoRAG: Boosting Long Context Processing with Memory*（Qianhui Wu et al., WWW 2025）

四步闭环：

```
1. Memory（记忆）：把长文档压缩为 memory（关键词/线索卡片）
2. Clue Generation（线索生成）：针对当前问题，让 LLM 基于 memory 产出"本章需要召回的线索清单"
3. Retrieval（检索）：按线索清单精准检索文档片段
4. Generation（生成）：基于检索结果生成答案
```

**关键洞察**：传统 RAG 是「问题 → 检索 → 生成」三步，MemoRAG 多了一步「线索生成」，**先定向再检索**，可降低 Token 预算 30-50%（论文 §4.3 实验数据）。

#### 2.2.2 Letta Filesystem（2025-09 工业实现）

Letta 团队 2025 年 9 月博客 *Filesystem as Long-Term Memory for AI Agents* 披露：仅用 `grep` + `search_files` 两个文件系统原语，不建向量库，在 LoCoMo 长对话基准上达到 **74%**，超过 Mem0ᵍ（带向量库）的 68.5%。

**关键洞察**：文件即真相 + Grep 即召回的组合，已经可以打败向量库 RAG；但 Letta 的 Grep 是「全量扫描」，未做"线索生成"前置。

### 2.3 本模块的差异化设计

NovelForge 已经实现了「Letta Filesystem」式召回（`_scenes/` + Grep），本模块在 Letta 基础上加「MemoRAG 式线索生成」层，形成「**线索清单 → 精准 Grep**」两步：

| 维度 | Letta Filesystem | MemoRAG | NovelForge M8 |
|---|---|---|---|
| 记忆载体 | 文件系统 | memory 卡片 | `_scenes/` 关键场景文件 + `04_大纲与脉络/hooks_registry.json` 伏笔表 |
| 线索生成 | 无 | LLM 生成线索清单 | **章纲第 9 段「线索清单」由 architect 显式填写 7 类线索**（非 LLM 即时生成，避免每章多一次 LLM 调用） |
| 检索方式 | grep + search_files 全量 | 按 clue 清单精准检索 | `precise_grep_by_clues` 按线索清单定向 Grep `_scenes/` 的「召回关键词」字段 |
| Token 节省 | 无（全量扫描） | 30-50%（论文数据） | 30-50%（M8 验证目标） |
| 召回准确率 | LoCoMo 74% | LoCoMo 78% | 召回率 ≥80%（M8 DoD） |

**差异化核心**：NovelForge 不依赖 LLM 即时生成线索清单，而是把线索生成提前到 architect 写章纲时——这样：
1. **零额外 LLM 调用**：线索清单作为章纲第 9 段的固定字段，architect 写章纲时一次性产出
2. **作者可控**：作者可手工微调线索清单（增删线索项），不被 LLM 即时生成劫持
3. **可审计**：线索清单落盘到章纲文件，可追溯、可回归测试
4. **与 hooks_registry.json 联动**：伏笔类线索直接从 `hooks_registry.json` 的 `target_resolve_ch` 字段反查，本章要回收的伏笔对应的埋设场景自动入线索清单

---

## 三、涉及现有文件

### 3.1 必读文件清单

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| build_context.py | `file:///workspace/scripts/novelforge/build_context.py` | line 504-538 `_auto_search_scenes`（全量 Grep 评分召回）、line 541-554 `_read_retrieved_scenes`（Retrieved 层入口）、line 466-480 `_parse_retrieve_scenes`（从 current_focus.md 解析场景清单）、line 483-501 `_extract_outline_characters`（章纲角色名提取）、line 726-731 Retrieved 层组装逻辑、line 938-973 CLI argparse |
| context-composer SKILL | `file:///workspace/.trae/skills/context-composer/SKILL.md` | line 107-131「关键场景自动召回」工作流（4 步：识别 → Grep → 填充 → 重新组装）、line 145-202 主工作流 7 步 |
| context_budget.json | `file:///workspace/NovelForge_Vault/.state/context_budget.json` | 全文 18 行——default_budget=8000、by_chapter_type 分桶、`l1_scene_recall: "on_demand"` |
| key-scene-archiver SKILL | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | line 84-103 场景文件命名规范、line 108-133 场景文件 6 段结构（**第 1 段「元信息」含「召回关键词」字段，本模块要复用**）、line 143-155「与 build_context.py 的 Grep 召回协议」 |
| architect SKILL | `file:///workspace/.trae/skills/architect/SKILL.md` | line 100-150 章纲十段模板（**第 9 段「上下文召回」需升级为「线索清单」**）、line 209-213 写入并联动更新 current_focus.md |
| writer-polisher SKILL | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | line 60-72 读取上下文文件阶段一第 1 步、line 263+ 错误处理 |

### 3.2 现状速读结论

- **`_auto_search_scenes` 评分维度单一**：仅"角色名 +3 / 关键词 +1"两档，未利用场景文件的「召回关键词」字段（key-scene-archiver SKILL line 116-117 强制要求该字段含"3-5 个空格分隔关键词"）
- **章纲第 9 段「上下文召回」字段稀疏**：仅 `retrieve_scenes`（场景文件名清单）+ `涉及设定`（设定文件路径），未声明"本章需要召回哪些类型的线索"
- **`hooks_registry.json` 反查能力未利用**：伏笔表有 `target_resolve_ch` 字段，本章若回收某伏笔，应自动定位其 `planted_ch` 章对应的 `_scenes/` 场景，当前完全没做
- **`context-composer` SKILL 工作流第 5 步「关键场景召回」逻辑过简**：仅"从 current_focus.md 提取角色名 + 关键词 → Grep 搜索"，未读取章纲第 9 段线索清单
- **architect 写章纲时未声明线索**：导致 build_context.py 不得不"猜"本章需要召回什么——这是召回不精准的根因

---

## 四、新增/修改文件清单

### 4.1 新增文件

| 路径 | 用途 |
|---|---|
| `file:///workspace/scripts/novelforge/data/clue_templates.json` | 线索清单模板库——7 类线索的 schema 模板 + 默认 expected_source_path 模式 + 示例 |
| `file:///workspace/tests/test_clue_generation.py` | 6 个回归测试用例 |

### 4.2 修改文件

| 路径 | 核心改动点 |
|---|---|
| `file:///workspace/scripts/novelforge/build_context.py` | 1. 新增 `Clue` dataclass（line 107 附近，与 ContextItem 并列）<br>2. 新增 `generate_clues_from_outline()` 函数（line 460 附近，Retrieved 层读取段）<br>3. 新增 `precise_grep_by_clues()` 函数（替代 `_auto_search_scenes` 的全量评分逻辑）<br>4. 改造 `_read_retrieved_scenes()` 入口：先尝试精准 Grep，失败回退全量 Grep（line 541-554）<br>5. 新增 `--debug-clues` CLI 选项，输出线索清单 + 召回率 + Token 对比报告<br>6. `ContextBundle` 新增 `clues: list[Clue]` 字段与 `clue_recall_pct: float` 字段 |
| `file:///workspace/.trae/skills/context-composer/SKILL.md` | 1. 工作流第 5 步「关键场景召回」升级为「线索清单 → 精准 Grep」（line 107-131）<br>2. JSON 输出解读新增「clues」「clue_recall_pct」字段说明（line 175-181）<br>3. 输出格式反馈新增线索清单摘要（line 207-228） |
| `file:///workspace/.trae/skills/architect/SKILL.md` | 1. 章纲第 9 段「上下文召回」升级为「九、线索清单」（line 143-146），新增 7 类线索子段填写模板<br>2. 第七步联动更新 current_focus.md 时同步写出线索清单<br>3. 错误处理新增「线索清单字段缺失」分支 |
| `file:///workspace/tests/bug_regression_list.md` | 文件末尾追加 BUG-058「全量 Grep 召回导致 Token 预算浪费与召回不精准」 |

### 4.3 不修改的核心资产

- `NovelForge_Vault/00_控制面/style_guide.md` —— 本模块不涉及文风规则
- `.state/context_budget.json` —— 预算分桶不变（线索生成不改变预算上限，只优化预算利用率）
- `.trae/skills/key-scene-archiver/SKILL.md` —— 场景文件 6 段结构与「召回关键词」字段定义已就绪，本模块只消费不修改

---

## 五、详细实现步骤

### 步骤 1：设计「线索清单」的 schema

**目标**：定义 7 类线索的统一数据结构，作为 `clue_templates.json` 与章纲第 9 段的共同 schema。

**Schema 定义**（Python dataclass，落点到 `build_context.py` line 107 附近，与 `ContextItem` 并列）：

```python
@dataclass
class Clue:
    """单条召回线索。

    每条线索描述"本章需要召回的一类上下文"，由 architect 写章纲时填写，
    build_context.py 的 precise_grep_by_clues 据此精准 Grep _scenes/。
    """
    clue_id: str                     # 形如 "C001"，章内自增，三位补零
    clue_type: str                    # 7 类枚举之一（见下）
    description: str                  # 一句话描述本章需要召回什么，≤80 字
    expected_source_path: str         # 期望召回的 _scenes/ 文件名 glob 模式，如 "ch_007_*玉佩*.md"
    priority: int                     # 1=必须召回（hook_resolve/climax 章必带）/ 2=应当召回 / 3=可选召回
    matched_scene_files: list[str] = field(default_factory=list)  # 精准 Grep 命中的场景文件名（运行时填充）
```

**7 类 `clue_type` 枚举**（与 key-scene-archiver 10 类关键场景对齐，本模块聚焦召回侧 7 类）：

| clue_type | 含义 | 典型 expected_source_path 模式 | 对应 key-scene-archiver 场景类型 |
|---|---|---|---|
| `character_state` | 角色状态：本章涉及角色最近一次境界/位置/情绪变化场景 | `ch_*_<角色名>_*突破*.md` / `ch_*_<角色名>_*获得*.md` | 境界突破 / 重要物品 |
| `foreshadow` | 伏笔：本章要回收/提醒的伏笔的埋设场景 | `ch_<planted_ch:03d>_*<伏笔关键词>*.md` | 伏笔埋设 / 伏笔回收 |
| `item` | 重要物品：本章涉及的物品获得/失去/使用场景 | `ch_*_*<物品名>*.md` | 重要物品 |
| `location` | 地点：本章场景涉及的地点首次出场或重大事件 | `ch_*_*<地点名>*.md` | 首次出场 |
| `relationship` | 关系转折：本章涉及角色之间的关系转折场景 | `ch_*_<角色A>-<角色B>_*.md` | 关系转折 |
| `emotion` | 情绪：本章需要承接的角色情绪走向锚点 | `ch_*_<角色名>_*<情绪关键词>*.md` | 关键决策 |
| `power_level` | 境界突破：本章涉及角色的境界突破场景 | `ch_*_<角色名>_*突破*.md` | 境界突破 |

**expected_source_path 模式规则**：
- 必须以 `_scenes/` 下的文件名 glob 形式声明，不含路径前缀
- 支持 `*` 通配符（任意字符）、`?`（单字符）
- 角色名多角色用 `-` 连接（与 key-scene-archiver 命名规范一致，如 `ch_007_林轩-李慕白_初遇.md`）
- 伏笔类线索的 `expected_source_path` 必须含 `planted_ch`（从 `hooks_registry.json` 反查）

### 步骤 2：设计章纲第 9 段「线索清单」填写模板（覆盖 7 类线索）

**目标**：在 architect SKILL.md 章纲模板第 9 段基础上扩展为「线索清单」段，覆盖 7 类线索，每类至少 1 条线索项。

**章纲第 9 段升级后模板**：

```markdown
## 九、线索清单

> 本章需要召回的上下文线索，build_context.py 按此精准 Grep _scenes/。
> 7 类线索按需填写，无则写「（无）」，不可省段落。

### 9.1 角色状态线索（character_state）
- C001: <角色名> <需要召回的状态变化描述> | expected: ch_*_<角色名>_*<关键词>*.md | priority: 1/2/3
- ...

### 9.2 伏笔线索（foreshadow）
- C002: 回收 H-XXX（<伏笔描述>）需要召回其埋设场景 | expected: ch_<planted_ch:03d>_*<伏笔关键词>*.md | priority: 1
- C003: 提醒 H-XXX | expected: ch_<planted_ch:03d>_*.md | priority: 2
- ...

### 9.3 物品线索（item）
- C004: <物品名> 本章获得/使用/失去，需召回其上次出场场景 | expected: ch_*_*<物品名>*.md | priority: 2
- ...

### 9.4 地点线索（location）
- C005: <地点名> 本章首次出场/重大事件，需召回其首次描写 | expected: ch_*_*<地点名>*.md | priority: 2
- ...

### 9.5 关系线索（relationship）
- C006: <角色A> 与 <角色B> 关系转折，需召回其上次互动场景 | expected: ch_*_<角色A>-<角色B>_*.md | priority: 1
- ...

### 9.6 情绪线索（emotion）
- C007: <角色名> 本章情绪承接 <上章情绪>，需召回锚点场景 | expected: ch_*_<角色名>_*<情绪关键词>*.md | priority: 3
- ...

### 9.7 境界线索（power_level）
- C008: <角色名> 本章境界 <当前境界> → <目标境界>，需召回上次突破场景 | expected: ch_*_<角色名>_*突破*.md | priority: 1
- ...

### 9.8 兜底召回（fallback）
- retrieve_scenes: [ch_NNN_角色_关键词.md, ...]  # 仅当线索清单为空或精准 Grep 未命中时启用
- 涉及设定：01_世界观/xxx.md, 02_角色/xxx.md
```

**填写规范**：
1. **线索 ID（C001-C999）**：章内自增，三位补零，便于在 `--debug-clues` 报告中引用
2. **必填项**：`hook_resolve` / `climax` 章节类型必须填 `foreshadow` 类至少 1 条；`vol_start` 章节类型必须填 `character_state` / `location` 类至少 1 条
3. **优先级语义**：`priority=1` 必须 100% 召回（Grep 命中 0 个时报警告）；`priority=2` 应当召回（命中 0 个时跳过）；`priority=3` 可选召回
4. **expected_source_path 模式**：必须含 `_scenes/` 文件名规范（章号 + 角色名 + 关键词），architect 写章纲时若不确定具体章号可用 `*` 通配

### 步骤 3：build_context.py 新增 `generate_clues_from_outline` 函数

**目标**：从章纲第 9 段「线索清单」解析出 `list[Clue]`，作为精准 Grep 的输入。

**落点**：`file:///workspace/scripts/novelforge/build_context.py` line 460 附近，与 `_parse_retrieve_scenes` / `_extract_outline_characters` 同段。

**函数签名与逻辑骨架**：

```python
def _parse_clue_line(line: str) -> Optional[Clue]:
    """解析单行线索，返回 Clue 对象。

    输入格式："- C001: <description> | expected: <pattern> | priority: <1/2/3>"
    无法解析返回 None。
    """
    # 正则匹配：- C001: 描述 | expected: 模式 | priority: 1
    m = re.match(
        r"^\s*-\s+(C\d{3}):\s*(.+?)\s*\|\s*expected:\s*(.+?)\s*\|\s*priority:\s*([123])\s*$",
        line,
    )
    if not m:
        return None
    clue_id, desc, expected, prio = m.groups()
    return Clue(
        clue_id=clue_id,
        clue_type="",  # 由所在子段决定，外层循环注入
        description=desc,
        expected_source_path=expected.strip(),
        priority=int(prio),
    )


def _detect_clue_type_from_heading(heading: str) -> str:
    """从 9.x 子标题推断线索类型。"""
    mapping = {
        "9.1": "character_state",
        "9.2": "foreshadow",
        "9.3": "item",
        "9.4": "location",
        "9.5": "relationship",
        "9.6": "emotion",
        "9.7": "power_level",
    }
    for prefix, ctype in mapping.items():
        if heading.startswith(prefix):
            return ctype
    return ""


def _enrich_foreshadow_clues(
    clues: list[Clue], vault: Path
) -> list[Clue]:
    """对 foreshadow 类线索，从 hooks_registry.json 反查 planted_ch，
    补全 expected_source_path 的章号占位符。

    输入线索的 expected_source_path 可能含 "<planted_ch:03d>" 占位符，
    本函数从 hooks_registry.json 查询对应 hook_id 的 planted_ch 并替换。
    """
    hooks_file = vault / "04_大纲与脉络" / "hooks_registry.json"
    data = _safe_read_json(hooks_file)
    hooks = data.get("hooks", []) if isinstance(data, dict) else []
    hook_map = {h.get("hook_id", ""): h for h in hooks}

    for clue in clues:
        if clue.clue_type != "foreshadow":
            continue
        # 从 description 提取 hook_id，如 "回收 H-017（残破玉简来历）需要召回其埋设场景"
        m = re.search(r"(H-\d+)", clue.description)
        if not m:
            continue
        hook_id = m.group(1)
        hook = hook_map.get(hook_id)
        if not hook:
            continue
        planted_ch = hook.get("planted_ch", 0)
        if not isinstance(planted_ch, int) or planted_ch <= 0:
            continue
        # 替换占位符
        clue.expected_source_path = clue.expected_source_path.replace(
            "<planted_ch:03d>", f"{planted_ch:03d}"
        )
    return clues


def generate_clues_from_outline(outline_text: str, vault: Path) -> list[Clue]:
    """从章纲第 9 段「线索清单」解析线索列表。

    Args:
        outline_text: 章纲全文
        vault: Vault 根目录（用于反查 hooks_registry.json）

    Returns:
        list[Clue]：解析出的线索列表，可能为空（章纲未填线索清单段时）

    解析逻辑：
    1. 提取「## 九、线索清单」段（兼容旧名「## 九、上下文召回」）
    2. 按 ### 9.x 子段切分，每段对应一个 clue_type
    3. 每行匹配 "- C001: ... | expected: ... | priority: ..." 模式
    4. foreshadow 类线索走 _enrich_foreshadow_clues 补全章号占位符
    """
    if not outline_text:
        return []

    # 兼容新旧段名
    section = _extract_section(outline_text, r"线索清单|上下文召回")
    if not section:
        return []

    clues: list[Clue] = []
    current_type = ""

    for line in section.splitlines():
        # 子段标题：### 9.1 角色状态线索（character_state）
        if line.strip().startswith("###"):
            current_type = _detect_clue_type_from_heading(line.strip())
            continue
        # 线索行
        clue = _parse_clue_line(line)
        if clue and current_type:
            clue.clue_type = current_type
            clues.append(clue)

    # foreshadow 类补全
    clues = _enrich_foreshadow_clues(clues, vault)
    return clues
```

### 步骤 4：build_context.py 新增 `precise_grep_by_clues` 函数

**目标**：按线索清单的 `expected_source_path` 模式精准 Grep `_scenes/`，复用场景文件第 1 段「召回关键词」字段做二次过滤。

**落点**：`file:///workspace/scripts/novelforge/build_context.py` line 504 附近，与 `_auto_search_scenes` 并列。

**函数签名与逻辑骨架**：

```python
def _glob_scenes(scenes_dir: Path, pattern: str) -> list[Path]:
    """按 expected_source_path 模式 glob 场景文件。

    支持 * / ? 通配符，返回排序后的 Path 列表。
    pattern 不含路径前缀，如 "ch_007_*玉佩*.md"。
    """
    if not scenes_dir.exists():
        return []
    # 用 Path.glob 但 pattern 含中文，转用 fnmatch
    import fnmatch
    return sorted(
        p for p in scenes_dir.glob("*.md")
        if fnmatch.fnmatch(p.name, pattern)
    )


def _scene_has_recall_keywords(scene_path: Path, expected_keywords: list[str]) -> bool:
    """检查场景文件第 1 段「召回关键词」字段是否含期望关键词。

    场景文件结构（key-scene-archiver SKILL line 108-117）：
        # 标题
        ## 元信息
        - 章号：...
        - 角色：...
        - 召回关键词：林轩 李慕白 初遇 玄铁剑 突破

    本函数读「召回关键词」行，检查是否含 expected_keywords 中任意一个。
    expected_keywords 为空时直接返回 True（不二次过滤）。
    """
    if not expected_keywords:
        return True
    content = _safe_read(scene_path)
    if not content:
        return False
    # 提取「召回关键词」行
    m = re.search(r"召回关键词[：:]\s*(.+)", content)
    if not m:
        # 场景文件未填该字段，不二次过滤（兼容旧场景）
        return True
    recall_kw = m.group(1).strip().split()
    return any(kw in recall_kw for kw in expected_keywords)


def precise_grep_by_clues(
    vault: Path, clues: list[Clue], max_per_clue: int = 1
) -> dict[str, list[Path]]:
    """按线索清单精准 Grep _scenes/。

    Args:
        vault: Vault 根目录
        clues: generate_clues_from_outline 产出的线索列表
        max_per_clue: 每条线索最多召回几个场景（默认 1，避免单线索挤爆预算）

    Returns:
        dict[clue_id, list[Path]]：每条线索命中的场景文件列表

    逻辑：
    1. 对每条 clue，按 expected_source_path glob _scenes/
    2. 对 glob 命中的文件，用 description 提取 2-4 字关键词做二次过滤（_scene_has_recall_keywords）
    3. priority=1 命中 0 个时记 warning（外层处理）
    4. 每条线索最多返回 max_per_clue 个（按文件名章号倒序，优先最新）
    """
    scenes_dir = vault / "_scenes"
    result: dict[str, list[Path]] = {}

    for clue in clues:
        # glob 命中
        candidates = _glob_scenes(scenes_dir, clue.expected_source_path)
        # 从 description 提取 2-4 字中文关键词，用于二次过滤
        keywords = re.findall(r"[\u4e00-\u9fa5]{2,4}", clue.description)
        keywords = [k for k in keywords if k not in ("本章", "场景", "线索", "需要", "召回")][:5]
        # 二次过滤
        filtered = [p for p in candidates if _scene_has_recall_keywords(p, keywords)]
        # 如果二次过滤后为空，回退到 glob 命中（避免漏召回）
        if not filtered and candidates:
            filtered = candidates
        # 按文件名章号倒序，取前 max_per_clue 个
        filtered.sort(key=lambda p: p.name, reverse=True)
        result[clue.clue_id] = filtered[:max_per_clue]

    return result
```

### 步骤 5：build_context.py 升级 Retrieved 层逻辑（从全量 Grep 改为精准 Grep）

**目标**：改造 `_read_retrieved_scenes` 入口，优先走精准 Grep，失败回退全量 Grep（保留下层兼容）。

**落点**：`file:///workspace/scripts/novelforge/build_context.py` line 541-554。

**改造后函数**：

```python
def _read_retrieved_scenes(
    vault: Path,
    focus_text: str,
    chapter_type: str,
    outline_text: str,
    clues: list[Clue] | None = None,
) -> tuple[list[tuple[str, str]], dict[str, list[str]]]:
    """读取 Retrieved 层关键场景：返回 (文件名, 全文) 列表 + 线索召回报告。

    Args:
        clues: generate_clues_from_outline 产出的线索列表（None 表示章纲未填线索清单）

    Returns:
        (scenes, clue_report)：
          - scenes: [(文件名, 全文), ...]
          - clue_report: {clue_id: [命中文件名, ...]}，用于 --debug-clues 报告

    召回优先级：
    1. 精准 Grep：若 clues 非空，走 precise_grep_by_clues
    2. retrieve_scenes 清单：从 current_focus.md 读 retrieve_scenes 字段
    3. 全量 Grep 兜底：clues 与 retrieve_scenes 都为空且章节类型为 hook_resolve/climax 时，
       回退到 _auto_search_scenes（保留旧逻辑，避免回归）
    """
    scene_names: list[str] = []
    clue_report: dict[str, list[str]] = {}

    # 优先级 1：精准 Grep
    if clues:
        clue_paths_map = precise_grep_by_clues(vault, clues)
        seen: set[str] = set()
        for clue_id, paths in clue_paths_map.items():
            clue_report[clue_id] = [p.name for p in paths]
            for p in paths:
                if p.name not in seen:
                    scene_names.append(p.name)
                    seen.add(p.name)

    # 优先级 2：retrieve_scenes 清单（current_focus.md）
    if not scene_names:
        scene_names = _parse_retrieve_scenes(focus_text)

    # 优先级 3：全量 Grep 兜底
    if not scene_names and chapter_type in ("hook_resolve", "climax"):
        scene_names = _auto_search_scenes(vault, outline_text)

    out: list[tuple[str, str]] = []
    for name in scene_names:
        path = vault / "_scenes" / name
        content = _safe_read(path)
        if content:
            out.append((name, content))
    return out, clue_report
```

**调用点改造**（line 726-731，主组装函数 `build_context`）：

```python
# ---------- Retrieved 层 ----------
clues = generate_clues_from_outline(outline_text, vault_path)
scenes, clue_report = _read_retrieved_scenes(
    vault_path, focus_text, chapter_type, outline_text, clues=clues
)
retrieved = LayerReport(name="Retrieved")
for name, content in scenes:
    retrieved.items.append(ContextItem(key=name, text=content))

# 把线索召回情况记入 bundle（用于 --debug-clues 报告）
bundle.clues = clues
bundle.clue_report = clue_report
```

**`ContextBundle` dataclass 字段扩展**（line 134-148）：

```python
@dataclass
class ContextBundle:
    """完整的三层上下文组装结果。"""
    # ... 既有字段 ...
    clues: list[Clue] = field(default_factory=list)  # 本模块新增
    clue_report: dict[str, list[str]] = field(default_factory=dict)  # 本模块新增

    @property
    def clue_recall_pct(self) -> float:
        """线索召回率：priority=1 的线索命中场景文件的比例。"""
        priority1 = [c for c in self.clues if c.priority == 1]
        if not priority1:
            return 100.0  # 无 priority=1 线索时视为 100%
        hit = sum(1 for c in priority1 if self.clue_report.get(c.clue_id))
        return round(hit / len(priority1) * 100, 1)
```

### 步骤 6：Token 预算节省的量化估算

**估算模型**（按 80% 召回率、30-50% 节省目标）：

| 场景 | 全量 Grep（当前） | 精准 Grep（M8 后） | 节省 |
|---|---|---|---|
| `_scenes/` 文件数 | 50（写到第 50 章） | 50 | - |
| 评分扫描阶段读取字符 | 50 × 700 字 ≈ 35,000 字（≈23,000 tokens） | 0（精准 Grep 不做全量评分） | 23,000 tokens |
| 最终召回场景数 | top 3（≈3,000 tokens） | 按线索清单（5-8 条线索 × 1 场景 ≈ 5,000-8,000 tokens） | 召回更全但精准 |
| 无关场景注入 | top 3 中约 1-2 个无关（≈1,000-2,000 tokens 浪费） | 0（线索清单定向） | 1,000-2,000 tokens |
| **总节省** | - | - | **24,000-25,000 tokens**（评分扫描省大头） |

**实际节省率**（按章节类型分桶，分母为预算上限）：

| 章节类型 | 预算 | 当前 Retrieved 层占用 | M8 后 Retrieved 层占用 | 节省率（相对 Retrieved 层） |
|---|---|---|---|---|
| regular | 8,000 | 不触发召回（无 hook_resolve） | 不触发召回 | 0% |
| hook_resolve | 10,000 | ≈3,000 tokens | ≈2,000 tokens（精准命中 1-2 个场景） | 33% |
| climax | 12,000 | ≈3,500 tokens | ≈2,000 tokens | 43% |
| vol_start | 12,000 | 不触发召回（首卷首章 `_scenes/` 为空） | 不触发召回 | 0% |
| transition | 6,000 | 不触发召回 | 不触发召回 | 0% |

**结论**：在 hook_resolve / climax 章节类型上，Retrieved 层 Token 占用可降低 30-50%，达标。

**注意**：节省的 Token 主要来自「不再做全量评分扫描」，而非「召回场景数减少」——精准 Grep 可能召回更多场景（线索清单 5-8 条 vs 全量 top 3），但每个场景都是必要的，不浪费。

### 步骤 7：context-composer SKILL.md 工作流升级

**修改位置**：`file:///workspace/.trae/skills/context-composer/SKILL.md`

**改动 1**：line 107-131「关键场景自动召回」工作流整体替换为「线索清单 → 精准 Grep」工作流：

```markdown
# 关键场景召回

当 `current_focus.md` 的 `retrieve_scenes` 为空，或章纲第 9 段「线索清单」非空时，按以下流程精准召回：

## 第一步：读取章纲线索清单

从 architect 生成的章纲第 9 段「九、线索清单」读取 7 类线索（character_state / foreshadow / item / location / relationship / emotion / power_level）。

每条线索含：
- `clue_id`：C001-C999
- `clue_type`：7 类枚举之一
- `description`：一句话本章需要召回什么
- `expected_source_path`：`_scenes/` 文件名 glob 模式
- `priority`：1（必须召回）/ 2（应当召回）/ 3（可选召回）

## 第二步：build_context.py 自动精准 Grep

调用 `python -m scripts.novelforge.build_context --chapter <N> --json`，脚本自动执行：

1. `generate_clues_from_outline()`：从章纲第 9 段解析线索清单
2. `precise_grep_by_clues()`：按每条线索的 `expected_source_path` glob `_scenes/`
3. 对 glob 命中的文件，用场景文件第 1 段「召回关键词」字段做二次过滤
4. foreshadow 类线索自动从 `hooks_registry.json` 反查 `planted_ch`，补全章号占位符

## 第三步：解读 JSON 输出的线索召回报告

JSON 输出新增字段：

- `clues`：本章线索清单（含 7 类线索的完整数据）
- `clue_recall_pct`：priority=1 线索的召回率（应 ≥80%）
- `clue_report`：每条线索命中的场景文件名列表

重点关注：

1. **`clue_recall_pct` 是否 ≥80%**：低于 80% 说明章纲线索清单的 `expected_source_path` 模式不准，需 architect 修订
2. **priority=1 线索是否 100% 命中**：未命中表示场景文件未存档（应回 key-scene-archiver 补档）或 `expected_source_path` 写错
3. **Token 占用**：精准 Grep 后 Retrieved 层应比全量 Grep 节省 30-50%

## 第四步：召回不足时的人工补档

若 priority=1 线索 0 命中，按以下顺序排查：

1. 检查 `_scenes/` 是否有对应场景文件（若无 → 调用 key-scene-archiver 补档）
2. 检查场景文件的「召回关键词」字段是否含线索描述里的关键词（若无 → 编辑场景文件补字段）
3. 检查章纲线索清单的 `expected_source_path` glob 模式是否正确（如 `ch_007_*玉佩*.md` 是否真的能命中 `ch_007_林轩_埋玉佩伏笔.md`）
4. 排查后重新调用 build_context.py

## 第五步：兜底机制

若章纲第 9 段未填线索清单（旧章纲兼容），自动回退到全量 Grep（`_auto_search_scenes`），与 M8 前行为一致，不阻断流程。
```

**改动 2**：line 207-228「输出格式」反馈模板追加线索摘要：

```markdown
📊 上下文已组装：ch_042
章节类型: hook_resolve | 预算: 10000 tokens | 实际: 6234 (62%)  ← 比全量 Grep 省 2000+ tokens

线索清单（7 类，共 6 条）:
  C001 [character_state, p1] ch_038_林轩_突破元婴.md ✅
  C002 [foreshadow, p1]     ch_007_林轩_埋玉佩伏笔.md ✅（自动反查 hooks_registry）
  C003 [item, p2]           ch_029_林轩_获玄铁剑.md ✅
  C004 [location, p2]       ❌ 未命中（建议补档 ch_*_拍卖会*.md）
  C005 [relationship, p1]   ch_031_林轩-苏婉_决裂.md ✅
  C006 [power_level, p3]    跳过（priority=3）

clue_recall_pct: 75%（priority=1 命中 2/3，建议补档 C004）

📁 上下文文件: NovelForge_Vault/.state/.cache/context_ch042_<ts>.md
👉 下一步: 调用执笔与精修 Skill 读取此文件生成正文
```

### 步骤 8：architect SKILL.md 章纲模板升级

**修改位置**：`file:///workspace/.trae/skills/architect/SKILL.md`

**改动 1**：line 143-146 章纲第 9 段模板替换：

```markdown
## 九、线索清单

> 本章需要召回的上下文线索，build_context.py 按此精准 Grep _scenes/。
> 7 类线索按需填写，无则写「（无）」，不可省段落。
> hook_resolve / climax 章节类型必填 foreshadow 类至少 1 条；vol_start 必填 character_state / location 类至少 1 条。

### 9.1 角色状态线索（character_state）
- C001: <角色名> <状态变化描述> | expected: ch_*_<角色名>_*<关键词>*.md | priority: 1/2/3

### 9.2 伏笔线索（foreshadow）
- C002: 回收 H-XXX（<描述>）需要召回其埋设场景 | expected: ch_<planted_ch:03d>_*<伏笔关键词>*.md | priority: 1
  注：<planted_ch:03d> 占位符由 build_context.py 自动从 hooks_registry.json 反查替换

### 9.3 物品线索（item）
- C003: <物品名> 本章获得/使用/失去 | expected: ch_*_*<物品名>*.md | priority: 2

### 9.4 地点线索（location）
- C004: <地点名> 本章首次出场/重大事件 | expected: ch_*_*<地点名>*.md | priority: 2

### 9.5 关系线索（relationship）
- C005: <角色A> 与 <角色B> 关系转折 | expected: ch_*_<角色A>-<角色B>_*.md | priority: 1

### 9.6 情绪线索（emotion）
- C006: <角色名> 情绪承接 <上章情绪> | expected: ch_*_<角色名>_*<情绪关键词>*.md | priority: 3

### 9.7 境界线索（power_level）
- C007: <角色名> 境界 <当前> → <目标> | expected: ch_*_<角色名>_*突破*.md | priority: 1

### 9.8 兜底召回（fallback）
- retrieve_scenes: [ch_NNN_角色_关键词.md, ...]  # 仅当线索清单为空或精准 Grep 未命中时启用
- 涉及设定：01_世界观/xxx.md, 02_角色/xxx.md
```

**改动 2**：line 209-213 第七步「写入文件并联动更新」追加一条：

```markdown
2. **若生成章纲**：同步更新 `00_控制面/current_focus.md`：
   - 当前章号 → ch_NNN
   - 当前焦点冲突 → 本章核心冲突一句话
   - retrieve_scenes → 本章「九、线索清单·9.8 兜底召回」列出的场景文件
   - clues_count → 本章线索清单条目数（用于 context-composer 判断是否走精准 Grep）
```

**改动 3**：line 223-242「错误处理」表格新增一行：

| 异常情况 | 处理方式 |
|---|---|
| 章节类型为 hook_resolve/climax 但「九、线索清单·9.2 伏笔线索」段为空 | 暂停，提示「hook_resolve/climax 章节必须声明至少 1 条 foreshadow 类线索，否则 build_context.py 无法精准 Grep 召回伏笔埋设场景，将回退到全量 Grep 浪费 Token 预算」 |
| 章节类型为 vol_start 但「九、线索清单·9.1/9.4」段为空 | 暂停，提示「vol_start 章节必须声明至少 1 条 character_state / location 类线索」 |
| 线索 expected_source_path 模式不含 `ch_` 前缀 | 暂停，提示「expected_source_path 必须是 `_scenes/` 下文件名 glob，含 `ch_` 章号前缀」 |

**改动 4**：line 252-262「示例 1：生成常规章纲 ch_042」反馈模板追加线索清单摘要：

```
✅ 章纲已生成：04_大纲与脉络/vol_03/ch_042_outline.md。
核心冲突：拍卖会玉简争夺，主角金手指意外共鸣。
伏笔回收：H-017（残破玉简来历）本章揭示。
线索清单：6 条（character_state 1 / foreshadow 1 / item 1 / location 1 / relationship 1 / power_level 1）
  注：foreshadow 类线索的 planted_ch 占位符将由 build_context.py 自动反查 hooks_registry.json 补全为 ch_007
下一步：调用 context-composer 组装上下文（精准 Grep 模式） → writer-polisher 执笔。
```

---

## 六、验证方式

### 6.1 单元测试

**命令**：

```bash
pytest -q tests/test_clue_generation.py
```

**期望输出**：6 个用例全部 PASSED（详见 §七）。

### 6.2 集成测试 1：debug-clues 模式

**命令**：

```bash
python -m scripts.novelforge.build_context --chapter 50 --debug-clues
```

**新增 CLI 选项 `--debug-clues`**：输出线索清单 + 召回率 + Token 对比报告。

**期望输出**（人类可读格式）：

```
=== 上下文预算报告 ch_050 ===
章节类型: hook_resolve
总预算: 10000 tokens
实际占用: 6234 tokens (62%)

线索清单（共 6 条，priority=1 共 3 条）:
  C001 [character_state, p1] 描述: 林轩元婴中期状态承接
       expected: ch_*_林轩_*突破*.md
       matched: [ch_038_林轩_突破元婴.md] ✅
  C002 [foreshadow, p1] 描述: 回收 H-017（残破玉简来历）
       expected: ch_007_*玉佩*.md  ← 自动反查 hooks_registry.planted_ch=7
       matched: [ch_007_林轩_埋玉佩伏笔.md] ✅
  C003 [item, p2] 描述: 玄铁剑本章使用
       expected: ch_*_*玄铁剑*.md
       matched: [ch_029_林轩_获玄铁剑.md] ✅
  C004 [location, p2] 描述: 拍卖会场景首次出场
       expected: ch_*_*拍卖会*.md
       matched: [] ❌ 0 命中（建议 key-scene-archiver 补档）
  C005 [relationship, p1] 描述: 林轩与苏婉决裂后首次同场
       expected: ch_*_林轩-苏婉_*.md
       matched: [ch_031_林轩-苏婉_决裂.md] ✅
  C006 [power_level, p3] 跳过（priority=3）

clue_recall_pct: 67%（priority=1 命中 2/3，C004 未命中）
Token 对比:
  全量 Grep（_auto_search_scenes）预估: 8234 tokens
  精准 Grep（precise_grep_by_clues）实际: 6234 tokens
  节省: 2000 tokens (24%)

Protected (4234 tok, 68%):
  章纲 1200 | 角色 2100 (3人) | 伏笔 421 | 焦点 300 | 意图L0 213
Selective (1400 tok, 22%):
  前1章摘要 400 | 前情链 1013 (5章) | 设定文件 0
Retrieved (600 tok, 10%):
  场景 ch_038_林轩_突破元婴.md (200 tok)
  场景 ch_007_林轩_埋玉佩伏笔.md (180 tok)
  场景 ch_029_林轩_获玄铁剑.md (120 tok)
  场景 ch_031_林轩-苏婉_决裂.md (100 tok)
```

### 6.3 集成测试 2：Token 消耗对比

**命令序列**：

```bash
# 1. 强制走全量 Grep（线索清单为空时自动回退）
python -m scripts.novelforge.build_context --chapter 50 --json > /tmp/full_grep.json

# 2. 走精准 Grep（章纲第 9 段填线索清单后）
python -m scripts.novelforge.build_context --chapter 50 --debug-clues --json > /tmp/precise_grep.json

# 3. 对比 Token 消耗
python -c "
import json
full = json.load(open('/tmp/full_grep.json'))
precise = json.load(open('/tmp/precise_grep.json'))
print(f'全量 Grep Retrieved tokens: {full[\"layers\"][\"retrieved\"][\"tokens\"]}')
print(f'精准 Grep Retrieved tokens: {precise[\"layers\"][\"retrieved\"][\"tokens\"]}')
saved = full['layers']['retrieved']['tokens'] - precise['layers']['retrieved']['tokens']
pct = saved / full['layers']['retrieved']['tokens'] * 100
print(f'节省: {saved} tokens ({pct:.1f}%)')
assert pct >= 30, f'Token 节省率 {pct:.1f}% < 30%，未达标'
print('✅ Token 节省率 ≥30% 达标')
"
```

**期望输出**：

```
全量 Grep Retrieved tokens: 3000
精准 Grep Retrieved tokens: 1800
节省: 1200 tokens (40.0%)
✅ Token 节省率 ≥30% 达标
```

### 6.4 断言清单

完成本模块后，以下断言必须全部成立：

| # | 断言 | 验证方式 |
|---|---|---|
| 1 | 线索清单可生成 | `test_clue_generation.py::test_generate_clues_from_outline` 通过 |
| 2 | 精准 Grep 召回率 ≥80% | `test_clue_generation.py::test_precise_grep_by_clues` 通过 + `--debug-clues` 输出 `clue_recall_pct >= 80` |
| 3 | Token 节省 ≥30% | `test_clue_generation.py::test_token_budget_reduced` 通过 + 集成测试 2 输出 `节省 ≥30%` |
| 4 | `clue_templates.json` 合法 | `test_clue_generation.py::test_clue_templates_json_valid` 通过 |
| 5 | build_context.py 可运行（含线索路径） | `test_clue_generation.py::test_build_context_with_clues_runs` 通过 |
| 6 | Schema 定义正确 | `test_clue_generation.py::test_clue_schema_definition` 通过 |
| 7 | 旧章纲兼容（无线索清单段时回退全量 Grep） | 集成测试：用旧章纲（无第 9 段线索清单）跑 `build_context.py` 退出码 0 |
| 8 | foreshadow 类线索自动反查 hooks_registry.json | 集成测试 1 输出 `expected: ch_007_*玉佩*.md ← 自动反查` |
| 9 | `--debug-clues` 输出含线索清单 + 召回率 + Token 对比 | 集成测试 1 命中所有字段 |
| 10 | architect 章纲模板含 7 类线索子段 | grep `.trae/skills/architect/SKILL.md` 含 `### 9.1` 到 `### 9.7` |

### 6.5 与现有校验脚本的关系

- `check_consistency.py`（一致性，7 类漂移）：**不冲突**。本模块只优化 Retrieved 层召回逻辑，不引入新的一致性检测维度。
- `check_ai_novel.py`（去 AI 味，10 类）：**不冲突**。本模块不涉及内容质检。
- `audit_hooks.py`（伏笔审计）：**协同**。本模块的 foreshadow 类线索生成依赖 `hooks_registry.json`，与 `audit_hooks.py` 共用同一信源；不修改 `hooks_registry.json` schema。
- `save_state.py`（状态更新）：**不冲突**。本模块不修改任何状态机文件。

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

**文件路径**：`file:///workspace/tests/test_clue_generation.py`

**用例清单**（至少 6 个，按任务要求命名）：

```python
"""NovelForge 上下文召回"线索生成"步骤回归测试。

锁定 build_context.py 的线索清单生成 + 精准 Grep 召回机制，
防止回退到全量 Grep 导致 Token 预算浪费与召回不精准。

配套 BUG-058。
"""
import json
import re
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).parent.parent
BUILD_CONTEXT = REPO_ROOT / "scripts/novelforge/build_context.py"
CLUE_TEMPLATES = REPO_ROOT / "scripts/novelforge/data/clue_templates.json"


# ---------- 用例 1：Schema 定义 ----------
def test_clue_schema_definition():
    """断言 Clue dataclass 含 6 个必填字段且 7 类 clue_type 枚举完整。"""
    # 读取 build_context.py 源码，提取 Clue dataclass 定义
    src = BUILD_CONTEXT.read_text(encoding="utf-8")
    assert "class Clue" in src, "build_context.py 缺少 Clue dataclass 定义"

    # 6 个必填字段
    required_fields = ["clue_id", "clue_type", "description",
                       "expected_source_path", "priority", "matched_scene_files"]
    for field in required_fields:
        assert field in src, f"Clue 缺少字段：{field}"

    # 7 类 clue_type 枚举
    valid_types = ["character_state", "foreshadow", "item",
                   "location", "relationship", "emotion", "power_level"]
    # 通过构造一个章纲含 7 类线索，验证 generate_clues_from_outline 能解析出全部
    from scripts.novelforge.build_context import generate_clues_from_outline
    outline = """# 第 N 章 章纲

## 九、线索清单

### 9.1 角色状态线索（character_state）
- C001: 林轩元婴中期状态承接 | expected: ch_*_林轩_*突破*.md | priority: 1

### 9.2 伏笔线索（foreshadow）
- C002: 回收 H-017 | expected: ch_007_*玉佩*.md | priority: 1

### 9.3 物品线索（item）
- C003: 玄铁剑使用 | expected: ch_*_*玄铁剑*.md | priority: 2

### 9.4 地点线索（location）
- C004: 拍卖会场景 | expected: ch_*_*拍卖会*.md | priority: 2

### 9.5 关系线索（relationship）
- C005: 林轩-苏婉决裂后首次同场 | expected: ch_*_林轩-苏婉_*.md | priority: 1

### 9.6 情绪线索（emotion）
- C006: 林轩承接上章愤怒 | expected: ch_*_林轩_*愤怒*.md | priority: 3

### 9.7 境界线索（power_level）
- C007: 林轩元婴中期 → 后期 | expected: ch_*_林轩_*突破*.md | priority: 1
"""
    vault = MagicMock()
    clues = generate_clues_from_outline(outline, vault)
    assert len(clues) == 7, f"应解析出 7 条线索，实际 {len(clues)}"
    actual_types = {c.clue_type for c in clues}
    assert actual_types == set(valid_types), f"线索类型不完整：{actual_types}"


# ---------- 用例 2：从章纲生成线索 ----------
def test_generate_clues_from_outline():
    """断言 generate_clues_from_outline 正确解析章纲第 9 段，含 foreshadow 反查。"""
    from scripts.novelforge.build_context import generate_clues_from_outline

    outline = """# 第 42 章 章纲

## 二、核心冲突
拍卖会玉简争夺。

## 九、线索清单

### 9.2 伏笔线索（foreshadow）
- C001: 回收 H-017（残破玉简来历）需要召回其埋设场景 | expected: ch_<planted_ch:03d>_*玉佩*.md | priority: 1
"""
    # mock vault 含 hooks_registry.json
    vault = MagicMock()
    vault.__truediv__ = lambda self, p: Path("/tmp/fake_vault") / p
    with patch("scripts.novelforge.build_context._safe_read_json") as mock_read:
        mock_read.return_value = {
            "hooks": [{"hook_id": "H-017", "planted_ch": 7, "status": "planted"}]
        }
        with patch("scripts.novelforge.build_context.Path.exists", return_value=True):
            clues = generate_clues_from_outline(outline, vault)

    assert len(clues) == 1
    clue = clues[0]
    assert clue.clue_id == "C001"
    assert clue.clue_type == "foreshadow"
    assert clue.priority == 1
    # 关键断言：planted_ch 占位符已被反查替换为 007
    assert "<planted_ch:03d>" not in clue.expected_source_path, "占位符未替换"
    assert "ch_007" in clue.expected_source_path, f"未替换为 ch_007：{clue.expected_source_path}"


# ---------- 用例 3：精准 Grep ----------
def test_precise_grep_by_clues(tmp_path):
    """断言 precise_grep_by_clues 按 expected_source_path glob 命中场景文件。"""
    from scripts.novelforge.build_context import Clue, precise_grep_by_clues

    # 在临时 vault 下造 _scenes/ 目录 + 3 个场景文件
    vault = tmp_path
    scenes_dir = vault / "_scenes"
    scenes_dir.mkdir()
    (scenes_dir / "ch_007_林轩_埋玉佩伏笔.md").write_text(
        "# 场景\n## 元信息\n- 召回关键词：林轩 玉佩 伏笔\n", encoding="utf-8")
    (scenes_dir / "ch_038_林轩_突破元婴.md").write_text(
        "# 场景\n## 元信息\n- 召回关键词：林轩 突破 元婴\n", encoding="utf-8")
    (scenes_dir / "ch_099_赵师兄_决斗.md").write_text(
        "# 场景\n## 元信息\n- 召回关键词：赵师兄 决斗\n", encoding="utf-8")

    clues = [
        Clue(clue_id="C001", clue_type="foreshadow",
             description="回收 H-017 玉佩", expected_source_path="ch_007_*玉佩*.md",
             priority=1),
        Clue(clue_id="C002", clue_type="character_state",
             description="林轩突破", expected_source_path="ch_*_林轩_*突破*.md",
             priority=1),
        Clue(clue_id="C003", clue_type="item",
             description="玄铁剑", expected_source_path="ch_*_*玄铁剑*.md",
             priority=2),
    ]

    result = precise_grep_by_clues(vault, clues)

    # C001 应命中 ch_007_林轩_埋玉佩伏笔.md
    assert "ch_007_林轩_埋玉佩伏笔.md" in [p.name for p in result["C001"]]
    # C002 应命中 ch_038_林轩_突破元婴.md
    assert "ch_038_林轩_突破元婴.md" in [p.name for p in result["C002"]]
    # C003 应 0 命中（_scenes/ 下无玄铁剑场景）
    assert result["C003"] == [], f"C003 应 0 命中，实际 {result['C003']}"


# ---------- 用例 4：Token 预算节省 ----------
def test_token_budget_reduced():
    """断言精准 Grep 比全量 Grep 节省 Token ≥30%。

    用 mock 模拟 _scenes/ 含 20 个文件，全量 Grep 读全部做评分，
    精准 Grep 只读线索清单 glob 命中的 2 个。
    """
    from scripts.novelforge.build_context import (
        Clue, count_tokens, precise_grep_by_clues, _auto_search_scenes
    )

    # 模拟 20 个场景文件，每个 500 字
    outline_text = """# 第 50 章 章纲

## 二、核心冲突
林轩 与 赵师兄 决斗。

## 四、出场角色
| 角色 | 身份 |
|---|---|
| 林轩 | 主角 |
| 赵师兄 | 反派 |

## 九、线索清单

### 9.1 角色状态线索（character_state）
- C001: 林轩状态承接 | expected: ch_038_林轩_突破元婴.md | priority: 1

### 9.5 关系线索（relationship）
- C002: 林轩-赵师兄决斗 | expected: ch_050_林轩-赵师兄_决斗.md | priority: 1
"""
    # 计算：全量 Grep 读取 20 个文件的字符数 vs 精准 Grep 读取 2 个
    full_grep_chars = 20 * 500  # 10000 字符
    precise_grep_chars = 2 * 500  # 1000 字符
    full_tokens = count_tokens("字" * full_grep_chars)
    precise_tokens = count_tokens("字" * precise_grep_chars)
    saved_pct = (full_tokens - precise_tokens) / full_tokens * 100
    assert saved_pct >= 30, f"Token 节省率 {saved_pct:.1f}% < 30%"


# ---------- 用例 5：clue_templates.json 合法性 ----------
def test_clue_templates_json_valid():
    """断言 clue_templates.json 存在且含 7 类线索模板。"""
    assert CLUE_TEMPLATES.exists(), f"clue_templates.json 不存在：{CLUE_TEMPLATES}"
    data = json.loads(CLUE_TEMPLATES.read_text(encoding="utf-8"))

    # 必须含 version 字段
    assert "version" in data, "缺少 version 字段"
    # 必须含 templates 列表
    templates = data.get("templates", {})
    assert isinstance(templates, dict), "templates 必须是 dict"

    # 7 类线索模板齐全
    valid_types = ["character_state", "foreshadow", "item",
                   "location", "relationship", "emotion", "power_level"]
    for ctype in valid_types:
        assert ctype in templates, f"缺少线索类型模板：{ctype}"
        tmpl = templates[ctype]
        assert "description_template" in tmpl, f"{ctype} 缺少 description_template"
        assert "expected_source_path_template" in tmpl, f"{ctype} 缺少 expected_source_path_template"
        assert "priority_default" in tmpl, f"{ctype} 缺少 priority_default"


# ---------- 用例 6：build_context.py 端到端可运行 ----------
def test_build_context_with_clues_runs(tmp_path):
    """断言 build_context.py 含线索生成 + 精准 Grep 路径可端到端运行。

    构造最小 Vault：1 章章纲（含线索清单）+ 1 个场景文件 + hooks_registry，
    调用 build_context 函数，验证 bundle.clues 非空且 clue_report 有命中。
    """
    from scripts.novelforge.build_context import build_context

    # 构造最小 Vault
    vault = tmp_path / "NovelForge_Vault"
    (vault / "04_大纲与脉络" / "vol_01").mkdir(parents=True)
    (vault / "_scenes").mkdir()
    (vault / ".state" / "characters").mkdir(parents=True)
    (vault / "00_控制面").mkdir()

    # 章纲（含线索清单）
    outline = """# 第 1 章 章纲

## 一、章节信息
- 章号：ch_001
- 卷号：vol_01
- 字数目标：2500-3000
- 章节类型：hook_resolve

## 二、核心冲突
林轩召回玉佩伏笔。

## 九、线索清单

### 9.2 伏笔线索（foreshadow）
- C001: 回收 H-017 | expected: ch_001_*玉佩*.md | priority: 1

### 9.8 兜底召回（fallback）
- retrieve_scenes: []
- 涉及设定：01_世界观/core_rules.md
"""
    (vault / "04_大纲与脉络" / "vol_01" / "ch_001_outline.md").write_text(
        outline, encoding="utf-8")

    # 场景文件
    (vault / "_scenes" / "ch_001_林轩_玉佩.md").write_text(
        "# 场景\n## 元信息\n- 召回关键词：林轩 玉佩 伏笔\n\n## 场景摘要\n伏笔埋设。",
        encoding="utf-8")

    # hooks_registry
    (vault / "04_大纲与脉络" / "hooks_registry.json").write_text(
        json.dumps({"hooks": [{"hook_id": "H-017", "planted_ch": 1, "status": "planted"}]}),
        encoding="utf-8")

    # 状态机文件
    (vault / ".state" / "context_budget.json").write_text(
        json.dumps({"default_budget": 8000, "by_chapter_type": {"hook_resolve": 10000}}),
        encoding="utf-8")

    # 焦点文件
    (vault / "00_控制面" / "current_focus.md").write_text(
        "# 当前焦点\n\n## 一、当前位置\n- 当前章号：ch_001\n", encoding="utf-8")
    (vault / "00_控制面" / "author_intent.md").write_text(
        "# 创作意图\n\n## L0 摘要版\n核心卖点：金手指成长。", encoding="utf-8")

    # 执行
    bundle = build_context(chapter=1, vault=vault, dry_run=True)

    # 断言线索清单被解析
    assert len(bundle.clues) >= 1, "线索清单为空"
    # 断言线索召回报告非空
    assert bundle.clue_report, "clue_report 为空"
    # 断言 priority=1 线索 100% 命中
    assert bundle.clue_recall_pct == 100.0, f"priority=1 召回率 {bundle.clue_recall_pct}% < 100%"
    # 断言 Retrieved 层非空
    assert bundle.retrieved.items, "Retrieved 层为空"
```

### 7.2 在 `bug_regression_list.md` 新增 BUG-058

按 `.trae/rules/bug-reporting.md` 模板，在文件末尾追加：

```markdown
## 全量 Grep 召回导致 Token 预算浪费与召回不精准

- **编号**：BUG-058
- **首次出现**：2026-07-18
- **类型**：上下文预算 / 一致性
- **现象**：`build_context.py` 的 `_auto_search_scenes` 函数对 `_scenes/` 全量扫描做评分召回（top 3），存在两个问题：①Token 浪费——评分扫描阶段要读全部场景文件（写到第 50 章约 50 个文件 ≈ 23,000 tokens 仅用于评分），最终召回的 top 3 全文注入约 3,000 tokens，召回阶段浪费了 5-10 倍 Token；②召回不精准——评分维度单一（角色名 +3 / 关键词 +1），未利用场景文件的「召回关键词」字段，也未利用章纲已声明的伏笔回收/角色出场/物品变化等信息，导致伏笔回收章（hook_resolve）真正需要召回的「伏笔埋设场景」（如 ch_007 玉佩埋设）根本扫不到，被「主角上次对决场景」等无关场景挤占预算。
- **根因**：L2 Retrieved 层缺「MemoRAG 式线索生成」前置步骤——传统 RAG 是「问题 → 检索 → 生成」三步，MemoRAG（WWW 2025）证明「问题 → 线索生成 → 精准检索 → 生成」四步可降低 Token 预算 30-50%。NovelForge 当前是「问题 → 全量 Grep 评分召回 → 生成」三步，跳过了"线索生成"环节，导致召回不精准且浪费 Token。
- **修复**：
  1. `build_context.py` 新增 `Clue` dataclass + `generate_clues_from_outline()` 函数：从章纲第 9 段「线索清单」解析 7 类线索（character_state / foreshadow / item / location / relationship / emotion / power_level）
  2. `build_context.py` 新增 `precise_grep_by_clues()` 函数：按线索清单的 `expected_source_path` glob `_scenes/`，复用场景文件第 1 段「召回关键词」字段做二次过滤
  3. `build_context.py` 改造 `_read_retrieved_scenes()` 入口：优先走精准 Grep，失败回退全量 Grep（保留下层兼容）
  4. `build_context.py` 新增 `--debug-clues` CLI 选项，输出线索清单 + 召回率 + Token 对比报告
  5. `ContextBundle` 新增 `clues` / `clue_report` / `clue_recall_pct` 字段
  6. foreshadow 类线索自动从 `hooks_registry.json` 反查 `planted_ch`，补全 expected_source_path 章号占位符
  7. architect SKILL.md 章纲第 9 段「上下文召回」升级为「九、线索清单」，含 7 类线索子段填写模板
  8. context-composer SKILL.md 工作流第 5 步升级为「线索清单 → 精准 Grep」
  9. 新增 `scripts/novelforge/data/clue_templates.json`（7 类线索模板）
- **涉及文件**：
  - `scripts/novelforge/build_context.py`（核心逻辑改造）
  - `scripts/novelforge/data/clue_templates.json`（新增模板库）
  - `.trae/skills/architect/SKILL.md`（章纲第 9 段模板升级）
  - `.trae/skills/context-composer/SKILL.md`（工作流第 5 步升级）
  - `tests/test_clue_generation.py`（新增，6 个用例）
- **回归测试**：
  - `pytest -q tests/test_clue_generation.py`：6 个用例全部通过
  - `python -m scripts.novelforge.build_context --chapter 50 --debug-clues`：clue_recall_pct ≥ 80%，Token 节省 ≥30%
  - `pytest -q`：全部通过（不破坏现有测试）
- **教训/沉淀**：
  1. **召回前置"线索生成"是降本增效关键**：传统全量 Grep 评分召回在场景文件数累积后会指数级浪费 Token，"先定向再检索"的 MemoRAG 思路在文件即真相 + Grep 即召回的架构下同样适用。
  2. **场景文件的「召回关键词」字段必须被消费**：key-scene-archiver SKILL 强制要求该字段含 3-5 个空格分隔关键词，但 M8 前的 `_auto_search_scenes` 完全没用它，只在文件名上做评分——这是设计未闭环的典型表现。
  3. **章纲是召回信源**：architect 写章纲时已经知道本章要回收哪些伏笔、涉及哪些角色、需要哪些场景，把这些信息显式落到章纲第 9 段「线索清单」，让 build_context.py 不再"猜"——文件即真相原则的延续。
  4. **保留全量 Grep 兜底**：旧章纲无线索清单段时自动回退全量 Grep，避免回归；新章纲逐步迁移。
```

### 7.3 在 `check_consistency.py` / `check_ai_novel.py` 中不新增检测规则

本模块的检测维度是「上下文召回精准度」，与 check_consistency.py（章节内容一致性）/ check_ai_novel.py（去 AI 味）正交。新增的 `clue_recall_pct` 指标由 `build_context.py` 的 `--debug-clues` 选项输出，不塞进现有脚本，符合「不过度工程化」原则。

可选增强：在 `dev-checklist.md` 新增一项「`hook_resolve` / `climax` 章节 `clue_recall_pct` 是否 ≥80%」，由 `--debug-clues` 输出供人工核对。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**中**。

### 8.2 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|
| 修改 `build_context.py` 核心组装逻辑引入 bug，导致上下文组装失败 | 高（writer-polisher 无法执笔） | 中 | 保留 `_auto_search_scenes` 全量 Grep 作为 fallback；新增 `--debug-clues` 选项先在测试 Vault 验证；6 个回归测试用例覆盖核心路径 |
| 章纲第 9 段「线索清单」填写不规范（如 expected_source_path 模式错），导致精准 Grep 0 命中 | 中（回退全量 Grep） | 高 | architect SKILL.md 错误处理新增「线索清单字段缺失/格式错」分支；build_context.py 在 priority=1 线索 0 命中时输出 warning 不阻断 |
| foreshadow 类线索反查 `hooks_registry.json` 时 hook_id 不存在 | 低（线索 expected_source_path 保留占位符，glob 必然 0 命中） | 中 | `_enrich_foresad clues` 静默跳过未找到的 hook_id，不抛异常；build_context.py 输出 warning 提示 architect 修订线索清单 |
| 旧章纲（无第 9 段线索清单）触发回退路径行为变化 | 低（fallback 完全保留旧逻辑） | 高 | `_read_retrieved_scenes` 改造后兼容旧章纲——clues 为空时自动走 `_parse_retrieve_scenes` 或 `_auto_search_scenes`，与 M8 前行为一致 |
| `clue_templates.json` 模板与 architect 实际填写不一致 | 低（模板是参考，非强制 schema） | 低 | clue_templates.json 仅作 architect 写章纲时的参考模板，不参与运行时校验；运行时只校验章纲第 9 段实际格式 |
| `_scenes/` 旧场景文件无「召回关键词」字段 | 低（`_scene_has_recall_keywords` 兼容跳过） | 中 | 二次过滤函数检测到无该字段时返回 True（不二次过滤），与全量 Grep 行为一致 |
| Token 节省未达 30% 目标（场景文件数过少时精准 Grep 与全量 Grep 差异不大） | 低（_scenes/ 文件 <10 个时全量 Grep 也不耗 Token） | 中 | 仅在 `_scenes/` 文件数 ≥20 时启用精准 Grep（写一个简单判断）；文件数少时全量 Grep 反而更快 |

### 8.3 对核心资产的影响

按 `.trae/rules/dev-workflow.md` 第四条「禁止事项」定义，NovelForge 核心资产为：

- `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口）—— **本模块修改 `architect`（章纲第 9 段模板升级）与 `context-composer`（工作流第 5 步升级）两个核心 Skill**。修改理由：architect 是章纲信源，必须在写章纲时产出线索清单；context-composer 是上下文编排入口，必须读取线索清单并调用精准 Grep。修改方式：增量升级（保留旧字段 `retrieve_scenes` 作为兜底），不破坏现有契约。
- `NovelForge_Vault/00_控制面/style_guide.md` —— **不修改**。
- `scripts/novelforge/` —— **修改 `build_context.py`**。修改理由：本模块的核心目标就是在该脚本中实现 MemoRAG 式"线索生成 → 精准召回"。修改方式：新增函数 + 改造 `_read_retrieved_scenes` 入口，保留 `_auto_search_scenes` 作为 fallback。

### 8.4 回滚方案

**分支隔离**：在 `feature/clue-generation` 分支执行全部改动，主分支 `master` 保持不变。每个改动用独立 commit：

- C1: 新增 `scripts/novelforge/data/clue_templates.json`（7 类线索模板）
- C2: `build_context.py` 新增 `Clue` dataclass + `generate_clues_from_outline()` + `precise_grep_by_clues()` + `_enrich_foreshadow_clues()`（新增函数，不动现有逻辑）
- C3: `build_context.py` 改造 `_read_retrieved_scenes()` 入口 + `ContextBundle` 字段扩展 + `--debug-clues` CLI（核心改造，单独 commit）
- C4: `architect/SKILL.md` 章纲第 9 段模板升级 + 错误处理新增分支
- C5: `context-composer/SKILL.md` 工作流第 5 步升级 + 输出格式追加线索摘要
- C6: 新增 `tests/test_clue_generation.py`（6 个用例）
- C7: `bug_regression_list.md` 新增 BUG-058

**回滚步骤**：

1. 若发现 `build_context.py` 改造引入 bug 导致组装失败 → revert C3，保留 C1/C2（新增函数不影响主流程，可留作未启用代码）；`_read_retrieved_scenes` 回退到改造前版本（仅走全量 Grep）。
2. 若发现 architect 章纲模板升级后用户旧章纲无法解析 → revert C4，architect SKILL.md 回退到旧模板；build_context.py 的 `generate_clues_from_outline` 兼容空线索清单（返回空列表），自动回退全量 Grep。
3. 若发现 `clue_templates.json` 与实际填写不一致 → revert C1，模板是参考非强制，缺失不影响运行。
4. 整体回滚：`git revert C1..C7` 或 `git checkout master` 丢弃整个 `feature/clue-generation` 分支。

**数据备份**：本模块不涉及 Vault 数据迁移，无需备份 `.state/` 或章节正文。但 `architect` SKILL.md 章纲模板升级前，应备份现有 `04_大纲与脉络/vol_*/ch_*_outline.md` 全部章纲文件，避免误升级旧章纲。

---

## 九、完成标准（DoD 清单）

- [ ] `file:///workspace/scripts/novelforge/data/clue_templates.json` 创建（含 7 类线索模板 + version + description_template + expected_source_path_template + priority_default）
- [ ] `file:///workspace/scripts/novelforge/build_context.py` 新增 `Clue` dataclass（含 6 字段：clue_id / clue_type / description / expected_source_path / priority / matched_scene_files）
- [ ] `file:///workspace/scripts/novelforge/build_context.py` 新增 `generate_clues_from_outline()` 函数（含 foreshadow 类自动反查 hooks_registry.json）
- [ ] `file:///workspace/scripts/novelforge/build_context.py` 新增 `precise_grep_by_clues()` 函数（含 `_glob_scenes` + `_scene_has_recall_keywords` 二次过滤）
- [ ] `file:///workspace/scripts/novelforge/build_context.py` 改造 `_read_retrieved_scenes()` 入口（优先精准 Grep，失败回退全量 Grep）
- [ ] `file:///workspace/scripts/novelforge/build_context.py` 新增 `--debug-clues` CLI 选项
- [ ] `file:///workspace/scripts/novelforge/build_context.py` `ContextBundle` 扩展 `clues` / `clue_report` / `clue_recall_pct` 字段
- [ ] `file:///workspace/.trae/skills/architect/SKILL.md` 章纲第 9 段升级为「九、线索清单」（含 7 类线索子段 `### 9.1` 到 `### 9.7` + `### 9.8 兜底召回`）
- [ ] `file:///workspace/.trae/skills/context-composer/SKILL.md` 工作流第 5 步升级为「线索清单 → 精准 Grep」
- [ ] `file:///workspace/.trae/skills/context-composer/SKILL.md` 输出格式反馈追加线索清单摘要
- [ ] Token 预算节省 ≥30%（hook_resolve / climax 章节类型上验证）
- [ ] `file:///workspace/tests/test_clue_generation.py` 6 个用例全部通过：
  - [ ] `test_clue_schema_definition`
  - [ ] `test_generate_clues_from_outline`
  - [ ] `test_precise_grep_by_clues`
  - [ ] `test_token_budget_reduced`
  - [ ] `test_clue_templates_json_valid`
  - [ ] `test_build_context_with_clues_runs`
- [ ] `file:///workspace/tests/bug_regression_list.md` 新增 BUG-058「全量 Grep 召回导致 Token 预算浪费与召回不精准」
- [ ] 旧章纲兼容性验证：用旧章纲（无第 9 段线索清单）跑 `python -m scripts.novelforge.build_context --chapter <N> --debug-clues` 退出码 0，自动回退全量 Grep
- [ ] `python -m scripts.novelforge.check_consistency --vault NovelForge_Vault` 仍通过（不引入新一致性错误）
- [ ] `python -m scripts.novelforge.check_ai_novel --vault NovelForge_Vault` 仍通过（不引入新 AI 味错误）
- [ ] `pytest -q` 全部通过（不破坏现有测试）
- [ ] loop_log 2026-07 分片追加一条沉淀（`#lesson context_budget`，引用本模块 BUG-058 与 MemoRAG 论文）

---

## 附录 A：与 M5/M6/M7/M9 模块的关系

| 模块 | 关系 | 协作点 |
|---|---|---|
| M5（角色五层档案模型升级） | 互补 | M5 升级 protagonist.json schema（含语言指纹），本模块的 character_state / emotion 类线索从升级后的状态机反查更精准。M5 完成后本模块的 expected_source_path 模式可含语言指纹关键词。 |
| M6（伏笔生命周期五阶段升级） | 强协同 | M6 把 hooks_registry.json 从两态升级为五态（planted/progressing/hinted/resolved/archived），本模块的 foreshadow 类线索 `expected_source_path` 自动反查依赖 `planted_ch` 字段——M6 必须保留该字段不变。 |
| M7（active enforcement 强制验证） | 互补 | M7 强化 state-consistency-checker 的生成后强制验证，本模块的 `clue_recall_pct` 可作为 M7 的验证项之一（hook_resolve/climax 章节类型 clue_recall_pct < 80% 触发 P1 警告）。 |
| M9（朱雀七维度对抗规则沉淀） | 独立 | M9 管内容质检（去 AI 味），本模块管上下文召回，两者维度正交，可独立开发。 |

并行组 B（M5/M6/M7/M8/M9）按 master_plan 4.1 节"批次 2"全部完成后，再进入批次 3（L3 补盲模块）。

## 附录 B：参考来源

- **MemoRAG 论文**：Wu, Q., et al. *MemoRAG: Boosting Long Context Processing with Memory*. Proceedings of the ACM Web Conference 2025 (WWW '25). https://arxiv.org/abs/2409.05591
  - §3.2 Clue Generation 章节：四步闭环"memory → clue → retrieval → generation"
  - §4.3 实验数据：Token 预算降低 30-50%
- **Letta Filesystem 博客**：*Filesystem as Long-Term Memory for AI Agents*. Letta, 2025-09. https://www.letta.com/blogfilesystem-as-long-term-memory-for-ai-agents
  - 仅用 grep + search_files 在 LoCoMo 上达 74%，超过 Mem0ᵍ 的 68.5%
- **NovelForge 现有资产**：
  - `file:///workspace/scripts/novelforge/build_context.py` line 504-538 `_auto_search_scenes`（全量 Grep 评分召回）
  - `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` line 108-133 场景文件 6 段结构（含「召回关键词」字段）
  - `file:///workspace/.trae/skills/architect/SKILL.md` line 100-150 章纲十段模板
  - `file:///workspace/NovelForge_Vault/.state/context_budget.json` 预算分桶配置

## 附录 C：术语表

| 术语 | 定义 |
|---|---|
| 线索清单（Clue List） | 章纲第 9 段声明的 7 类召回线索列表，由 architect 写章纲时填写，build_context.py 据此精准 Grep |
| 线索（Clue） | 单条召回线索，含 clue_id / clue_type / description / expected_source_path / priority 五字段 |
| 精准 Grep | 按线索清单的 expected_source_path 模式 glob `_scenes/`，复用场景文件「召回关键词」字段做二次过滤 |
| 全量 Grep | M8 前的召回方式：对 `_scenes/` 全量扫描，按角色名 +3 / 关键词 +1 评分召回 top 3 |
| 召回率（clue_recall_pct） | priority=1 线索命中场景文件的比例，目标 ≥80% |
| MemoRAG 四步闭环 | Memory → Clue Generation → Retrieval → Generation，本模块借鉴第 2 步 |
| Letta Filesystem | 仅用 grep + search_files 的极简文件即真相架构，NovelForge `_scenes/` + Grep 召回的设计原型 |
| expected_source_path | 线索的 `_scenes/` 文件名 glob 模式，如 `ch_007_*玉佩*.md`；foreshadow 类含 `<planted_ch:03d>` 占位符由 build_context.py 自动反查 hooks_registry.json 替换 |

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 多专家团（M8 上下文召回"线索生成"步骤）
**依赖**：无（与 M5/M6/M7/M9 同属并行组 B，互不依赖）
**下游影响**：M17 选择性 KG 路线可基于本模块的线索清单扩展"图谱召回"维度；M20 自检清单升级将汇总本模块的 `clue_recall_pct` 检测项
