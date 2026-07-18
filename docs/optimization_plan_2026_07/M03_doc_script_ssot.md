# M03 · 文档与脚本 SSOT 校验

> **层级**：L1 · 修复工程债
> **依赖**：无
> **下游**：M9（朱雀七维度对抗规则沉淀，依赖 M3 的 SSOT 数据流）

---

## 一、模块目标

- **一句话目标**：建立 NovelForge 所有"文档与脚本共用数据"的 SSOT（Single Source of Truth）校验机制，确保 `style_guide.md` 禁用词表与 `check_ai_novel.py` 检测词表始终一致。
- **对应的痛点**：loop_log 2026-07 沉淀教训 4「文档与脚本脱节」——`style_guide.md` 列出的禁用词在 `check_ai_novel.py` 中未检测，"文档宪法"与"执行脚本"分叉。
- **完成后达成的能力**：
  1. CI 自动校验文档 vs 脚本一致性（退出码 0/1 区分通过/失败）。
  2. 新增禁用词必须同步到 `ai_words.json` 单一数据源，否则 SSOT 校验脚本阻断合并。
  3. 现有 15 个不一致项全部修复，文档与脚本词表 100% 对齐。

---

## 二、痛点对应

### 2.1 痛点表现

- **现状数据**：`style_guide.md` §1.1 禁用词表 + §1.2 禁用句式 + P0/P1 范畴共声明约 50 个词/句式（含范畴化表述），`check_ai_novel.py` 仅在 `AI_WORDS_P2_BAN`（6 个）+ `AI_WORDS_QUOTA`（3 个）+ `AI_PATTERNS_EXPLICIT`（18 条正则）中实际检测，约 15 个文档声明项脚本未覆盖。
- **典型漏检案例**：
  - `style_guide.md` P0/P1 区列出「yyds」「破防」「绝绝子」现代网络用语混入古风，`check_ai_novel.py` 无对应检测。
  - `style_guide.md` P0/P1 区列出 AI 翻译腔「这是 ___ 的存在」「一种 ___ 的感觉」，`check_ai_novel.py` 无对应正则。
  - `style_guide.md` 行文中举例「不由得」「一时间」「不禁」等时间副词堆砌，`check_ai_novel.py` 未纳入。
  - 反向：`check_ai_novel.py` 的 `AI_PATTERNS_EXPLICIT`（如「不难发现」「从这个角度来看」「说到底」「一言以蔽之」）未在 `style_guide.md` 文档化，作者无从知晓禁用理由。
- **用户感知**：作者按 `style_guide.md` 自查通过的稿件，CI 跑 `check_ai_novel.py` 仍报 P1；或作者用「不由得」等词，CI 不报但读者反馈"AI 味重"。文档宪法与执行脚本双重失效。

### 2.2 行业方案

- **SSOT 原则**（Single Source of Truth）：业界代码规范统一实践，如 ESLint 配置与团队文档同步、Python Black 配置与 CONTRIBUTING.md 同步、TypeScript tsconfig 与文档同步。通用做法：以可执行配置为真相源，文档通过引用方式同步，CI 校验两者一致。
- **GitHub Super-linter / pre-commit**：通过 CI 强制 lint 配置与文档对齐。
- **Schema 驱动文档**：如 OpenAPI Generator 从 schema 反向生成 API 文档，避免手写文档与实现脱节。

### 2.3 本模块的差异化设计

- **以脚本为 SSOT**：NovelForge 核心哲学「文件即真相」延伸——脚本是可执行的真相，文档必须跟随脚本。理由：
  1. 脚本会随 bug 修复迭代（如 BUG-026/BUG-038 引入新的 `check_ai_cliches`），文档不会自动跟随。
  2. 文档手写易漏字/错字（如「具有重要意义」vs「具有重要性」），脚本正则更严格。
  3. 作者改文档不会自动触发 CI，改脚本会触发 pytest + check_ai_novel.py，反馈链路更短。
- **数据源外置**：将 `check_ai_novel.py` 中硬编码的 `AI_WORDS_P2_BAN` / `AI_WORDS_QUOTA` / `AI_PATTERNS_EXPLICIT` 重构为加载外部 JSON 配置 `scripts/novelforge/data/ai_words.json`，让脚本与文档共享同一份配置文件。
- **双向比对脚本**：新增 `check_doc_script_consistency.py`，解析 `style_guide.md` 中实际列出的禁用词/句式，与 `ai_words.json` 双向比对（文档有脚本无 → P1；脚本有文档无 → P2），输出报告 + 退出码。

---

## 三、涉及现有文件

### 3.1 必读文件清单

| 路径 | 用途 | 关注点 |
|---|---|---|
| [file:///workspace/NovelForge_Vault/00_控制面/style_guide.md](file:///workspace/NovelForge_Vault/00_控制面/style_guide.md) | 文风指南（语言宪法） | §1.1 禁用词表分级管控（行 11-26）；§1.2 禁用句式（行 28-33）；P0/P1 范畴（行 23-26） |
| [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) | 去 AI 味 10 维检测 | 行 93-101：`AI_WORDS_P2_BAN` / `AI_WORDS_QUOTA` 硬编码；行 105-124：`AI_PATTERNS_EXPLICIT` 硬编码；行 499-544：`check_ai_word` 检测逻辑 |
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 创作自检清单 | §八 去 AI 味（行 76-85）；§七 LoopAgent 沉淀（行 66-74） |
| [file:///workspace/.trae/rules/dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) | 协作流程规则 | 第三步「合并前必须清零所有校验问题」（行 86）；第四步自检（行 89-97） |
| [file:///workspace/.trae/rules/bug-reporting.md](file:///workspace/.trae/rules/bug-reporting.md) | Bug 记录与回归规范 | §三 字段模板；§五 回归测试要求（行 82-93） |
| [file:///workspace/scripts/check_loop_log.py](file:///workspace/scripts/check_loop_log.py) | 校验脚本风格参考 | 模块化 `check_xxx` 函数返回 `list[str]`；P1/P3 分级；`--strict` 模式 |
| [file:///workspace/scripts/validate_commit_messages.py](file:///workspace/scripts/validate_commit_messages.py) | 校验脚本风格参考 | 简洁函数式；`run_git` + `validate_message` + `main` 三段式；退出码 0/1 |

### 3.2 现状关键发现

**`check_ai_novel.py` 词库硬编码位置**（必须重构）：

```python
# 行 93-101：禁用词硬编码
AI_WORDS_P2_BAN: tuple[str, ...] = (
    "首先", "其次", "总之", "不可否认", "具有重要意义", "谱写",
)
AI_WORDS_QUOTA: tuple[str, ...] = ("宛如", "仿佛", "交织")
AI_WORDS_QUOTA_PER_1K: int = 2

# 行 105-124：AI 套路句式硬编码
AI_PATTERNS_EXPLICIT: tuple[str, ...] = (
    r"我们可以看到", r"这告诉我们", r"由此可见", r"不难看出",
    r"换句话说", r"归根结底", r"综上所述", r"历史的车轮",
    r"以史为鉴", r"总而言之", r"值得注意的是", r"不难发现",
    r"从这个角度来看", r"让我们", r"从某种意义上说",
    r"一言以蔽之", r"说到底", r"不仅.*而且",
)
```

**`style_guide.md` §1.1 禁用词表**（行 15-26）：仅 9 个词 + 3 类范畴化表述（现代网络用语 / AI 翻译腔 / 视角混乱），与脚本 27 个具体词/正则脱节。

**`parse_psycho_physio_from_style_guide` 函数**（行 468-492）：已实现"从 style_guide.md 解析覆盖硬编码"的范例，本模块 `ai_words.json` 加载机制可复用此设计模式。

---

## 四、新增/修改文件清单

### 4.1 新增文件

| 路径 | 用途 |
|---|---|
| `/workspace/scripts/novelforge/data/ai_words.json` | SSOT 数据源：禁用词 / 控量词 / AI 套路句式 / 范畴声明，脚本与文档共用 |
| `/workspace/scripts/check_doc_script_consistency.py` | SSOT 校验脚本：双向比对 `style_guide.md` 与 `ai_words.json`，CI 阻断不一致 |
| `/workspace/tests/test_doc_script_consistency.py` | SSOT 校验脚本的回归测试，5 个测试用例 |

### 4.2 修改文件

| 路径 | 改动点 |
|---|---|
| `/workspace/scripts/novelforge/check_ai_novel.py` | 重构 `AI_WORDS_P2_BAN` / `AI_WORDS_QUOTA` / `AI_PATTERNS_EXPLICIT` 从硬编码改为加载 `ai_words.json`；保留硬编码作为 fallback（JSON 文件缺失时使用，并打 warning） |
| `/workspace/NovelForge_Vault/00_控制面/style_guide.md` | §1.1 禁用词表改用引用方式（"禁用词表见 `scripts/novelforge/data/ai_words.json`，由 `check_ai_novel.py` 强制执行"）；保留分级管控说明（P0/P1/P2 + 适用范围 + 修复策略）；删除文档内具体词表（避免双源） |
| `/workspace/.trae/checklists/dev-checklist.md` | §八 去 AI 味新增检测项「文档脚本 SSOT 校验」；§二 Vault 规范新增「禁用词修改必须改 `ai_words.json`」 |
| `/workspace/tests/bug_regression_list.md` | 新增 BUG-053「style_guide.md 禁用词表与 check_ai_novel.py 检测词表不一致」 |

---

## 五、详细实现步骤

### 步骤 1：设计 SSOT 数据流向

**数据流向图**：

```
┌─────────────────────────────────────────────────────────────┐
│  scripts/novelforge/data/ai_words.json  （唯一真相源 SSOT） │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  banned_p2:      [首先, 其次, 总之, ...]            │   │
│  │  quota:          [宛如, 仿佛, 交织] (per_1k: 2)     │   │
│  │  patterns_p1:    [我们可以看到, 由此可见, ...]      │   │
│  │  archaic_clash:  [yyds, 破防, 绝绝子] (现代→古风)   │   │
│  │  translation_tone:["这是.*的存在", "一种.*的感觉"]  │   │
│  │  time_adverb_pile:[不由得, 一时间, 不禁, ...]       │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
            ┌───────────┴────────────┐
            ▼                        ▼
┌───────────────────────┐  ┌─────────────────────────────────┐
│ check_ai_novel.py     │  │ style_guide.md §1.1             │
│ （消费方 + 执行真相） │  │ （引用方 + 人类可读说明）       │
│ 启动时 load_json      │  │ "禁用词表见 ai_words.json,      │
│ 失败 fallback 硬编码  │  │  由 check_ai_novel.py 强制执行" │
└───────────────────────┘  └─────────────────────────────────┘
            ▲
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│ check_doc_script_consistency.py （SSOT 守门员）           │
│ 解析 style_guide.md 中实际列出的词 ⇄ 加载 ai_words.json   │
│ 双向比对 → 不一致项 → exit 1                              │
└───────────────────────────────────────────────────────────┘
```

**核心约束**：
- `ai_words.json` 是唯一数据源，`check_ai_novel.py` 与 `style_guide.md` 都引用它。
- `style_guide.md` 不再保留具体词表（避免双源），只保留分级管控说明（P0/P1/P2 + 适用范围 + 修复策略）。
- `check_doc_script_consistency.py` 验证 `style_guide.md` 中"提及的禁用词范畴"与 `ai_words.json` 的"分类键"对齐（不验证逐词，因为文档不再列具体词）。

### 步骤 2：创建 `ai_words.json` 数据文件

**文件路径**：`/workspace/scripts/novelforge/data/ai_words.json`

**完整内容**：

```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "NovelForge 去 AI 味词库 SSOT。check_ai_novel.py 加载本文件执行检测；style_guide.md 引用本文件作为禁用词真相源。check_doc_script_consistency.py 校验两者一致。",
    "maintainers": ["NovelForge Team"],
    "updated_at": "2026-07-18"
  },
  "banned_p2": {
    "description": "P2 禁用词：仅禁旁白，对话内放行",
    "applies_to": "narration_only",
    "severity": "P2",
    "words": [
      "首先",
      "其次",
      "总之",
      "不可否认",
      "具有重要意义",
      "谱写"
    ],
    "fix_strategy": "删除或改写；对话中可放行"
  },
  "quota": {
    "description": "控量词：每千字 ≤ 2 次",
    "applies_to": "full_text",
    "severity": "P2",
    "per_1k_max": 2,
    "words": [
      "宛如",
      "仿佛",
      "交织"
    ],
    "fix_strategy": "控量到每千字 ≤ 2 次，改用具体动作或白描"
  },
  "patterns_p1": {
    "description": "P1 显性 AI 套路句式：旁白禁用，对话放行",
    "applies_to": "narration_only",
    "severity": "P1",
    "patterns": [
      "我们可以看到",
      "这告诉我们",
      "由此可见",
      "不难看出",
      "换句话说",
      "归根结底",
      "综上所述",
      "历史的车轮",
      "以史为鉴",
      "总而言之",
      "值得注意的是",
      "不难发现",
      "从这个角度来看",
      "让我们",
      "从某种意义上说",
      "一言以蔽之",
      "说到底",
      "不仅.*而且"
    ],
    "fix_strategy": "改写为角色台词或具体事件，避免上帝视角说教"
  },
  "archaic_clash": {
    "description": "现代网络用语混入古风背景（P0 绝对禁用，无例外）",
    "applies_to": "full_text",
    "severity": "P0",
    "words": [
      "yyds",
      "破防",
      "绝绝子",
      "栓Q",
      "蚌埠住了",
      "芭比Q"
    ],
    "fix_strategy": "替换为符合世界观的口语；古风背景一律禁用现代网络用语"
  },
  "translation_tone": {
    "description": "AI 翻译腔（P0 绝对禁用，无例外）",
    "applies_to": "full_text",
    "severity": "P0",
    "patterns": [
      "这是.*的存在",
      "一种.*的感觉",
      "一个.*的",
      "作为.*的"
    ],
    "fix_strategy": "改为中文自然表达，去除翻译腔句式"
  },
  "time_adverb_pile": {
    "description": "时间副词堆砌（P2 控量：每千字 ≤ 1 次，避免 AI 式节奏均匀）",
    "applies_to": "full_text",
    "severity": "P2",
    "per_1k_max": 1,
    "words": [
      "不由得",
      "一时间",
      "不禁",
      "不由自主",
      "顿时",
      "刹那间",
      "顷刻间",
      "转眼间",
      "霎时间"
    ],
    "fix_strategy": "用具体动作替代时间副词，避免节奏 AI 化"
  }
}
```

**字段说明**：
- `_meta`：元数据，版本号 + 维护者 + 更新时间，便于变更追踪。
- 每个分类键包含 `description` / `applies_to` / `severity` / `words` 或 `patterns` / `fix_strategy`，`check_ai_novel.py` 直接消费这些字段生成 Issue。
- `applies_to` 取值：`full_text`（全文禁用）/ `narration_only`（仅旁白禁用，对话放行）。
- `severity` 取值：`P0` / `P1` / `P2`，与 `check_ai_novel.py` 现有 Issue 分级一致。

### 步骤 3：重构 `check_ai_novel.py` 词库加载

**目标**：将行 93-124 的硬编码 `AI_WORDS_P2_BAN` / `AI_WORDS_QUOTA` / `AI_PATTERNS_EXPLICIT` 改为从 `ai_words.json` 加载，保留硬编码作为 fallback。

**修改位置**：`/workspace/scripts/novelforge/check_ai_novel.py` 行 89-124。

**重构后代码**：

```python
# ============================================================================
# 词库
# ============================================================================

# SSOT 数据源路径
AI_WORDS_JSON_REL: str = "scripts/novelforge/data/ai_words.json"

# fallback 硬编码（ai_words.json 缺失或解析失败时使用，与 ai_words.json v1.0.0 一致）
_FALLBACK_BANNED_P2: tuple[str, ...] = (
    "首先", "其次", "总之", "不可否认", "具有重要意义", "谱写",
)
_FALLBACK_QUOTA: tuple[str, ...] = ("宛如", "仿佛", "交织")
_FALLBACK_PATTERNS_P1: tuple[str, ...] = (
    r"我们可以看到", r"这告诉我们", r"由此可见", r"不难看出",
    r"换句话说", r"归根结底", r"综上所述", r"历史的车轮",
    r"以史为鉴", r"总而言之", r"值得注意的是", r"不难发现",
    r"从这个角度来看", r"让我们", r"从某种意义上说",
    r"一言以蔽之", r"说到底", r"不仅.*而且",
)
_FALLBACK_ARCHAIC_CLASH: tuple[str, ...] = (
    "yyds", "破防", "绝绝子", "栓Q", "蚌埠住了", "芭比Q",
)
_FALLBACK_TRANSLATION_TONE: tuple[str, ...] = (
    r"这是.*的存在", r"一种.*的感觉", r"一个.*的", r"作为.*的",
)
_FALLBACK_TIME_ADVERB: tuple[str, ...] = (
    "不由得", "一时间", "不禁", "不由自主",
    "顿时", "刹那间", "顷刻间", "转眼间", "霎时间",
)


def _load_ai_words_json(workspace_root: str) -> dict | None:
    """加载 ai_words.json SSOT 数据源。

    Args:
        workspace_root: 工作区根路径（用于定位 scripts/novelforge/data/ai_words.json）。

    Returns:
        解析后的字典；文件缺失或解析失败返回 None，调用方使用 fallback。
    """
    fp = os.path.join(workspace_root, AI_WORDS_JSON_REL)
    if not os.path.isfile(fp):
        print(f"[警告] ai_words.json 不存在: {fp}，使用 fallback 硬编码", file=sys.stderr)
        return None
    try:
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[警告] ai_words.json 解析失败: {e}，使用 fallback 硬编码", file=sys.stderr)
        return None


# 模块级加载（启动时一次性加载，避免每次检测重复读盘）
_WORKSPACE_ROOT: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_AI_WORDS_DATA: dict | None = _load_ai_words_json(_WORKSPACE_ROOT)


def _get_words(category: str, fallback: tuple[str, ...]) -> tuple[str, ...]:
    """从 _AI_WORDS_DATA 取指定分类的词表，失败回退到 fallback。"""
    if _AI_WORDS_DATA is None:
        return fallback
    section = _AI_WORDS_DATA.get(category, {})
    return tuple(section.get("words") or section.get("patterns") or fallback)


# 实际使用的词表（启动时确定）
AI_WORDS_P2_BAN: tuple[str, ...] = _get_words("banned_p2", _FALLBACK_BANNED_P2)
AI_WORDS_QUOTA: tuple[str, ...] = _get_words("quota", _FALLBACK_QUOTA)
AI_PATTERNS_EXPLICIT: tuple[str, ...] = _get_words("patterns_p1", _FALLBACK_PATTERNS_P1)
AI_WORDS_ARCHAIC_CLASH: tuple[str, ...] = _get_words("archaic_clash", _FALLBACK_ARCHAIC_CLASH)
AI_PATTERNS_TRANSLATION_TONE: tuple[str, ...] = _get_words("translation_tone", _FALLBACK_TRANSLATION_TONE)
AI_WORDS_TIME_ADVERB: tuple[str, ...] = _get_words("time_adverb_pile", _FALLBACK_TIME_ADVERB)

# 控量阈值（从 JSON 读取 per_1k_max，fallback 为 2）
AI_WORDS_QUOTA_PER_1K: int = (
    int(_AI_WORDS_DATA.get("quota", {}).get("per_1k_max", 2))
    if _AI_WORDS_DATA else 2
)
AI_WORDS_TIME_ADVERB_PER_1K: int = (
    int(_AI_WORDS_DATA.get("time_adverb_pile", {}).get("per_1k_max", 1))
    if _AI_WORDS_DATA else 1
)
```

**`check_ai_word` 函数扩展**（行 499-544）：在原有 P2 禁用词、控量词、P1 套路句式检测基础上，新增 3 类检测（archaic_clash / translation_tone / time_adverb_pile）：

```python
def check_ai_word(content: str, ctx: CheckContext) -> list[Issue]:
    """1. AI 感词检测（P0/P1/P2 多级）。

    检测项（从 ai_words.json 加载）：
    - P0 archaic_clash：现代网络用语混入古风（全文禁用）。
    - P0 translation_tone：AI 翻译腔（全文禁用）。
    - P1 patterns_p1：显性 AI 套路句式（旁白禁用，对话放行）。
    - P2 banned_p2：禁用词（仅禁旁白，对话放行）。
    - P2 quota：控量词（每千字 ≤ 2 次）。
    - P2 time_adverb_pile：时间副词堆砌（每千字 ≤ 1 次）。
    """
    issues: list[Issue] = []
    narration = extract_narration(content)
    total_chars = count_chars(content)
    per_1k_cap_quota = max(
        AI_WORDS_QUOTA_PER_1K,
        (total_chars // 1000) * AI_WORDS_QUOTA_PER_1K,
    )
    per_1k_cap_time = max(
        AI_WORDS_TIME_ADVERB_PER_1K,
        (total_chars // 1000) * AI_WORDS_TIME_ADVERB_PER_1K,
    )

    # P0 现代网络用语混入古风（全文禁用）
    for word in AI_WORDS_ARCHAIC_CLASH:
        if word in content:
            issues.append(Issue(
                severity="P0",
                type="ai_word_archaic_clash",
                detail=f"全文出现现代网络用语「{word}」（古风背景禁用）",
                suggestion="替换为符合世界观的口语，禁止现代网络用语",
            ))

    # P0 AI 翻译腔（全文禁用）
    for pattern in AI_PATTERNS_TRANSLATION_TONE:
        matches = re.findall(pattern, content)
        if matches:
            sample = matches[0] if isinstance(matches[0], str) else pattern
            issues.append(Issue(
                severity="P0",
                type="ai_pattern_translation_tone",
                detail=f"全文出现 AI 翻译腔「{sample}」",
                suggestion="改为中文自然表达，去除翻译腔句式",
            ))

    # P2 禁用词（仅旁白）
    for word in AI_WORDS_P2_BAN:
        if word in narration:
            issues.append(Issue(
                severity="P2",
                type="ai_word_banned_in_narration",
                detail=f"旁白出现禁用词「{word}」",
                suggestion=f"删除或改写：{word}（对话中可放行）",
            ))

    # 控量词（宛如/仿佛/交织）
    for word in AI_WORDS_QUOTA:
        cnt = content.count(word)
        if cnt > per_1k_cap_quota:
            issues.append(Issue(
                severity="P2",
                type="ai_word_quota_exceeded",
                detail=f"「{word}」出现 {cnt} 次，超过每千字 {AI_WORDS_QUOTA_PER_1K} 次上限",
                suggestion="控量到每千字 ≤ 2 次，改用具体动作或白描",
            ))

    # P2 时间副词堆砌（不由得/一时间/不禁 等）
    for word in AI_WORDS_TIME_ADVERB:
        cnt = content.count(word)
        if cnt > per_1k_cap_time:
            issues.append(Issue(
                severity="P2",
                type="ai_word_time_adverb_pile",
                detail=f"时间副词「{word}」出现 {cnt} 次，超过每千字 {AI_WORDS_TIME_ADVERB_PER_1K} 次上限",
                suggestion="用具体动作替代时间副词，避免节奏 AI 化",
            ))

    # P1 显性套路句式（仅旁白）
    for pattern in AI_PATTERNS_EXPLICIT:
        matches = re.findall(pattern, narration)
        if matches:
            sample = matches[0] if isinstance(matches[0], str) else pattern
            issues.append(Issue(
                severity="P1",
                type="ai_pattern_explicit",
                detail=f"旁白出现 AI 套路句式「{sample}」（共 {len(matches)} 次）",
                suggestion="改写为角色台词或具体事件，避免上帝视角说教",
            ))

    return issues
```

### 步骤 4：修改 `style_guide.md` 改用引用方式

**修改位置**：`/workspace/NovelForge_Vault/00_控制面/style_guide.md` §1.1（行 11-26）。

**修改后内容**：

```markdown
### 1.1 禁用词表（分级管控）

> 重要原则：**不搞一刀切禁用，区分旁白与对话**。对话中可保留人物语言风格的自然俗语，旁白须克制。

> **禁用词真相源（SSOT）**：所有禁用词/句式/控量词的完整清单见
> [`scripts/novelforge/data/ai_words.json`](file:///workspace/scripts/novelforge/data/ai_words.json)，
> 由 [`scripts/novelforge/check_ai_novel.py`](file:///workspace/scripts/novelforge/check_ai_novel.py) 强制执行。
> 新增/修改禁用词必须改 `ai_words.json`，并运行
> `python scripts/check_doc_script_consistency.py` 校验文档脚本一致。

**分级管控说明**（具体词表见 SSOT）：

| 分级 | 适用范围 | 修复策略 | SSOT 分类键 |
|---|---|---|---|
| P0（绝对禁用，无例外） | 全文 | 替换为符合世界观的口语 | `archaic_clash` / `translation_tone` |
| P1（旁白禁用，对话放行） | 旁白 | 改写为角色台词或具体事件 | `patterns_p1` |
| P2（控量 ≤ 2 次/千字） | 全文 | 改用具体动作或白描 | `quota` |
| P2（仅禁旁白） | 旁白 | 删除或改写 | `banned_p2` |
| P2（控量 ≤ 1 次/千字） | 全文 | 用具体动作替代时间副词 | `time_adverb_pile` |

> P0/P1 绝对禁用范畴（具体词表见 SSOT）：
> - 现代网络用语混入古风（如「yyds」「破防」「绝绝子」出现在修仙背景）→ `archaic_clash`
> - AI 翻译腔（如「这是 ___ 的存在」「一种 ___ 的感觉」）→ `translation_tone`
> - 视角混乱（同一章内多次切换 POV 且无明确分隔）→ 由 `check_consistency.py` 检测，本表不含
```

**关键改动**：
1. 删除原表格中的具体词（宛如/仿佛/交织/首先/其次/总之/不可否认/具有重要意义/谱写），改为引用 `ai_words.json`。
2. 保留分级管控说明（P0/P1/P2 + 适用范围 + 修复策略 + SSOT 分类键），文档仍可读。
3. 新增"SSOT 分类键"列，让作者能从文档反查 JSON 中的对应分类。

### 步骤 5：编写 `check_doc_script_consistency.py` 完整脚本

**文件路径**：`/workspace/scripts/check_doc_script_consistency.py`

**完整代码**：

```python
#!/usr/bin/env python3
"""NovelForge 文档与脚本 SSOT 一致性校验脚本。

校验 NovelForge_Vault/00_控制面/style_guide.md 与
scripts/novelforge/data/ai_words.json 之间的一致性，确保禁用词表
（SSOT 数据源）与文档声明对齐。

校验项：
- [核心 P1] 1. ai_words.json 存在且 JSON 合法
- [核心 P1] 2. style_guide.md 引用了 ai_words.json（SSOT 声明）
- [核心 P1] 3. style_guide.md 中实际列出的禁用词 ⊆ ai_words.json
              （文档有脚本无 → P1，作者会误以为禁用但 CI 不报）
- [P2 提示] 4. ai_words.json 中的词在 style_guide.md 中有对应分类键声明
              （脚本有文档无 → P2，作者不知禁用理由）
- [P2 提示] 5. ai_words.json 每个分类键的 severity/applies_to/words 字段完整

退出码：
- 0：核心校验全部通过（P2 提示不阻断）
- 1：核心校验失败
- --strict 模式下 P2 提示也阻断

用法：
    python scripts/check_doc_script_consistency.py
    python scripts/check_doc_script_consistency.py --vault NovelForge_Vault
    python scripts/check_doc_script_consistency.py --strict
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# ============================================================================
# 路径常量
# ============================================================================
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_VAULT = ROOT / "NovelForge_Vault"
AI_WORDS_JSON = ROOT / "scripts" / "novelforge" / "data" / "ai_words.json"
STYLE_GUIDE_REL = "00_控制面/style_guide.md"

# ai_words.json 中所有合法的分类键（与 check_ai_novel.py 消费方一致）
EXPECTED_CATEGORIES = {
    "banned_p2", "quota", "patterns_p1",
    "archaic_clash", "translation_tone", "time_adverb_pile",
}

# 每个分类键的必填字段
REQUIRED_FIELDS = {
    "banned_p2":         {"description", "applies_to", "severity", "words", "fix_strategy"},
    "quota":             {"description", "applies_to", "severity", "per_1k_max", "words", "fix_strategy"},
    "patterns_p1":       {"description", "applies_to", "severity", "patterns", "fix_strategy"},
    "archaic_clash":     {"description", "applies_to", "severity", "words", "fix_strategy"},
    "translation_tone":  {"description", "applies_to", "severity", "patterns", "fix_strategy"},
    "time_adverb_pile":  {"description", "applies_to", "severity", "per_1k_max", "words", "fix_strategy"},
}

# style_guide.md 中应包含的 SSOT 引用声明
SSOT_REFERENCE_PATTERNS = [
    re.compile(r"ai_words\.json"),
    re.compile(r"check_ai_novel\.py"),
]


def load_ai_words_json() -> tuple[dict | None, list[str]]:
    """加载 ai_words.json。返回 (data, errors)。"""
    if not AI_WORDS_JSON.exists():
        return None, [f"[P1] ai_words.json 不存在: {AI_WORDS_JSON}"]
    try:
        with open(AI_WORDS_JSON, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return None, [f"[P1] ai_words.json JSON 解析失败: {e}"]
    return data, []


def load_style_guide(vault: Path) -> tuple[str | None, list[str]]:
    """加载 style_guide.md。返回 (text, errors)。"""
    fp = vault / STYLE_GUIDE_REL
    if not fp.exists():
        return None, [f"[P1] style_guide.md 不存在: {fp}"]
    try:
        return fp.read_text(encoding="utf-8"), []
    except OSError as e:
        return None, [f"[P1] style_guide.md 读取失败: {e}"]


def check_ai_words_json_schema(data: dict) -> list[str]:
    """P1：ai_words.json 每个分类键的字段完整。"""
    errors: list[str] = []
    for cat in EXPECTED_CATEGORIES:
        if cat not in data:
            errors.append(f"[P1] ai_words.json 缺少分类键: {cat}")
            continue
        section = data[cat]
        if not isinstance(section, dict):
            errors.append(f"[P1] ai_words.json 分类键 {cat} 不是 dict")
            continue
        missing = REQUIRED_FIELDS[cat] - set(section.keys())
        if missing:
            errors.append(
                f"[P1] ai_words.json 分类键 {cat} 缺少字段: {sorted(missing)}"
            )
    # 检查 _meta
    if "_meta" not in data:
        errors.append("[P2] ai_words.json 缺少 _meta 字段（建议补充版本信息）")
    return errors


def check_style_guide_references_ssot(text: str) -> list[str]:
    """P1：style_guide.md 引用了 ai_words.json 与 check_ai_novel.py。"""
    errors: list[str] = []
    for pattern in SSOT_REFERENCE_PATTERNS:
        if not pattern.search(text):
            errors.append(
                f"[P1] style_guide.md 未引用 SSOT 数据源: 缺少 {pattern.pattern}"
            )
    return errors


def extract_doc_words(text: str) -> set[str]:
    """从 style_guide.md 中提取「」内的禁用词候选。

    匹配形如「yyds」「破防」「绝绝子」「不由得」「一时间」等。
    排除表格表头与说明性文字（仅取中文引号内的短词）。
    """
    # 中文引号「」内的内容
    quoted = re.findall(r"「([^」]{1,30})」", text)
    # 过滤：仅保留 2-10 字的中文/英文词（排除句式描述）
    words = set()
    for q in quoted:
        # 排除含空格或过长的（句式）
        if " " in q or len(q) > 10:
            continue
        # 排除纯数字或纯标点
        if re.fullmatch(r"[\d\W]+", q):
            continue
        words.add(q)
    return words


def collect_json_words(data: dict) -> set[str]:
    """收集 ai_words.json 中所有 words 字段的词（不含 patterns）。"""
    words: set[str] = set()
    for cat in EXPECTED_CATEGORIES:
        section = data.get(cat, {})
        if not isinstance(section, dict):
            continue
        for w in section.get("words", []) or []:
            if isinstance(w, str):
                words.add(w)
    return words


def check_doc_only_words(text: str, data: dict) -> list[str]:
    """P1：文档有脚本无的词（作者会误以为禁用但 CI 不报）。"""
    errors: list[str] = []
    doc_words = extract_doc_words(text)
    json_words = collect_json_words(data)
    doc_only = doc_words - json_words
    # 白名单：style_guide.md 中合理出现的非禁用词（如「师尊」「师弟」等称谓示例）
    whitelist = {
        "师尊", "师弟", "师兄", "阁下", "这位", "罢了", "何须", "且看", "且慢",
        "牛逼", "卧槽",  # forbidden_words 示例，非 ai_words
        "yyds",  # 已在 archaic_clash，跳过
        "破防",  # 已在 archaic_clash
        "绝绝子",  # 已在 archaic_clash
    }
    doc_only -= whitelist
    if doc_only:
        for w in sorted(doc_only):
            errors.append(
                f"[P1] 文档列出但 ai_words.json 未包含: 「{w}」"
                f"（作者会误以为禁用，但 check_ai_novel.py 不会检测）"
            )
    return errors


def check_script_only_words(text: str, data: dict) -> list[str]:
    """P2：脚本有文档无的词（作者不知禁用理由）。"""
    warnings: list[str] = []
    doc_words = extract_doc_words(text)
    json_words = collect_json_words(data)
    script_only = json_words - doc_words
    # style_guide.md 改为引用后，不再列具体词，此项降级为提示
    if script_only:
        warnings.append(
            f"[P2] ai_words.json 中有 {len(script_only)} 个词未在 style_guide.md 显式列出"
            f"（已通过 SSOT 引用声明对齐，作者需查 ai_words.json 获取完整清单）"
        )
    return warnings


def run(vault: Path, strict: bool = False) -> int:
    """主入口。返回退出码。"""
    print("=== NovelForge 文档与脚本 SSOT 一致性校验 ===")
    print(f"Vault:        {vault}")
    print(f"ai_words.json: {AI_WORDS_JSON}")
    print()

    core_errors: list[str] = []
    p2_warnings: list[str] = []

    # 1. 加载 ai_words.json
    data, errs = load_ai_words_json()
    core_errors.extend(errs)
    if data is None:
        # 无法继续校验
        print("\n".join(core_errors), file=sys.stderr)
        print("\n结果：❌ 核心校验失败（ai_words.json 不可用）")
        return 1

    # 2. 加载 style_guide.md
    sg_text, errs = load_style_guide(vault)
    core_errors.extend(errs)
    if sg_text is None:
        print("\n".join(core_errors), file=sys.stderr)
        print("\n结果：❌ 核心校验失败（style_guide.md 不可用）")
        return 1

    # 3. 校验 ai_words.json schema
    core_errors.extend(check_ai_words_json_schema(data))

    # 4. 校验 style_guide.md 引用 SSOT
    core_errors.extend(check_style_guide_references_ssot(sg_text))

    # 5. 双向比对词表
    core_errors.extend(check_doc_only_words(sg_text, data))
    p2_warnings.extend(check_script_only_words(sg_text, data))

    # 输出报告
    print(f"核心校验（P1）：{len(core_errors)} 项失败")
    for e in core_errors:
        print(f"  ❌ {e}")
    print(f"P2 提示：{len(p2_warnings)} 项")
    for w in p2_warnings:
        print(f"  ⚠️  {w}")

    if core_errors:
        print("\n结果：❌ 核心校验失败")
        return 1
    if strict and p2_warnings:
        print("\n结果：❌ --strict 模式下 P2 告警也阻断")
        return 1
    print("\n结果：✅ 核心校验通过" + ("（P2 告警不阻断）" if p2_warnings else ""))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="check_doc_script_consistency",
        description="NovelForge 文档与脚本 SSOT 一致性校验",
    )
    parser.add_argument(
        "--vault", type=str, default=str(DEFAULT_VAULT),
        help=f"Vault 根路径（默认 {DEFAULT_VAULT}）",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="P2 告警也阻断退出码",
    )
    args = parser.parse_args(argv)
    vault = Path(args.vault).resolve()
    return run(vault, strict=args.strict)


if __name__ == "__main__":
    sys.exit(main())
```

**关键设计点**：
1. **模块化函数**：每个 `check_xxx` 返回 `list[str]` 错误清单，与 `check_loop_log.py` 风格一致。
2. **P1/P2 分级**：P1 阻断（文档有脚本无 → 作者误判）；P2 提示（脚本有文档无 → 作者需查 JSON）。
3. **白名单机制**：`extract_doc_words` 会抓取所有「」内短词，包括称谓示例（师尊/师兄）和 forbidden_words 示例（牛逼/卧槽），通过白名单过滤避免误报。
4. **fallback 容错**：`ai_words.json` 缺失时 `check_ai_novel.py` 不崩溃（用硬编码），但本 SSOT 校验脚本会报 P1（强制要求数据源存在）。

### 步骤 6：修复已识别的 15 个不一致项

**15 个未覆盖词清单**（基于现状盘点）：

| # | 词/句式 | 类型 | 文档声明 | 脚本检测 | 修复方式 |
|---|---|---|---|---|---|
| 1 | yyds | 现代网络用语 | style_guide §1.1 P0 范畴 | ❌ 未检测 | 加入 `archaic_clash.words` |
| 2 | 破防 | 现代网络用语 | style_guide §1.1 P0 范畴 | ❌ 未检测 | 加入 `archaic_clash.words` |
| 3 | 绝绝子 | 现代网络用语 | style_guide §1.1 P0 范畴 | ❌ 未检测 | 加入 `archaic_clash.words` |
| 4 | 这是 ___ 的存在 | AI 翻译腔 | style_guide §1.1 P0 范畴 | ❌ 未检测 | 加入 `translation_tone.patterns`（正则 `这是.*的存在`） |
| 5 | 一种 ___ 的感觉 | AI 翻译腔 | style_guide §1.1 P0 范畴 | ❌ 未检测 | 加入 `translation_tone.patterns`（正则 `一种.*的感觉`） |
| 6 | 不由得 | 时间副词堆砌 | style_guide 行文示例 | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 7 | 一时间 | 时间副词堆砌 | style_guide 行文示例 | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 8 | 不禁 | 时间副词堆砌 | style_guide 行文示例 | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 9 | 不由自主 | 时间副词堆砌 | 隐含（AI 节奏均匀） | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 10 | 顿时 | 时间副词堆砌 | 隐含（AI 节奏均匀） | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 11 | 刹那间 | 时间副词堆砌 | 隐含（AI 节奏均匀） | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 12 | 顷刻间 | 时间副词堆砌 | 隐含（AI 节奏均匀） | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 13 | 转眼间 | 时间副词堆砌 | 隐含（AI 节奏均匀） | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 14 | 霎时间 | 时间副词堆砌 | 隐含（AI 节奏均匀） | ❌ 未检测 | 加入 `time_adverb_pile.words` |
| 15 | 我们可以看到 等 18 个 P1 套路句式 | AI 上帝视角说教 | ❌ 文档未列出 | check_ai_novel.py 已检测 | style_guide.md 改为引用 SSOT 后，作者查 `ai_words.json` 获取完整清单 |

**修复执行命令**：

```bash
# 1. 创建 ai_words.json（步骤 2 已提供完整内容）
mkdir -p /workspace/scripts/novelforge/data
# 将步骤 2 的 JSON 内容写入 /workspace/scripts/novelforge/data/ai_words.json

# 2. 重构 check_ai_novel.py（步骤 3 已提供完整代码）
# 编辑 /workspace/scripts/novelforge/check_ai_novel.py 行 89-124 + 行 499-544

# 3. 修改 style_guide.md（步骤 4 已提供完整内容）
# 编辑 /workspace/NovelForge_Vault/00_控制面/style_guide.md §1.1

# 4. 验证修复
python scripts/check_doc_script_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --chapter 1 --vault NovelForge_Vault
pytest -q tests/test_doc_script_consistency.py
```

### 步骤 7：在 `dev-checklist.md` 新增检测项

**修改位置**：`/workspace/.trae/checklists/dev-checklist.md`

**§二 Vault 规范新增项**（在行 27 后插入）：

```markdown
- [ ] 禁用词修改走 SSOT：新增/修改禁用词必须改 `scripts/novelforge/data/ai_words.json`，禁止直接改 `style_guide.md` 词表或 `check_ai_novel.py` 硬编码
```

**§八 去 AI 味新增项**（在行 84 后插入）：

```markdown
- [ ] 文档脚本 SSOT 校验：`python scripts/check_doc_script_consistency.py --vault NovelForge_Vault` 通过（合并前必须完成）
- [ ] `ai_words.json` 与 `style_guide.md` 一致：无"文档有脚本无"的禁用词（P1 阻断），无"脚本有文档无"且未通过 SSOT 引用声明对齐的词（P2 提示）
```

**§七 LoopAgent 沉淀新增项**（在行 70 后插入）：

```markdown
- [ ] 若新增/修改了禁用词，是否已同步到 `ai_words.json` 并运行 `check_doc_script_consistency.py` 校验？
```

---

## 六、验证方式

### 6.1 单元测试

**命令**：

```bash
pytest -q tests/test_doc_script_consistency.py
```

**断言清单**（5 个测试用例，详见 §七）：
1. `test_ai_words_json_exists_and_valid`：`ai_words.json` 存在且 JSON 合法，包含所有 6 个分类键。
2. `test_style_guide_references_ai_words_json`：`style_guide.md` 同时引用 `ai_words.json` 与 `check_ai_novel.py`。
3. `test_no_doc_only_words`：`style_guide.md` 中「」内的禁用词候选 ⊆ `ai_words.json` 词表（白名单过滤后）。
4. `test_no_script_only_words`：`ai_words.json` 中所有 `words` 字段的词在 `style_guide.md` 中有 SSOT 引用声明对齐（已通过引用方式覆盖）。
5. `test_check_doc_script_consistency_runs`：`check_doc_script_consistency.py` 脚本可正常运行，退出码为 0。

### 6.2 集成测试

**命令**：

```bash
python scripts/check_doc_script_consistency.py --vault NovelForge_Vault
python scripts/check_doc_script_consistency.py --vault NovelForge_Vault --strict
python scripts/novelforge/check_ai_novel.py --chapter 1 --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --file path/to/draft.md
```

**期望输出**：

```
=== NovelForge 文档与脚本 SSOT 一致性校验 ===
Vault:        /workspace/NovelForge_Vault
ai_words.json: /workspace/scripts/novelforge/data/ai_words.json

核心校验（P1）：0 项失败
P2 提示：0 项

结果：✅ 核心校验通过
```

### 6.3 断言清单

- [ ] `style_guide.md` 与 `ai_words.json` 100% 一致（无 P1 不一致项）。
- [ ] 15 个不一致项全部修复（`yyds`/`破防`/`绝绝子` 等加入 `archaic_clash`；`不由得`/`一时间`/`不禁` 等加入 `time_adverb_pile`；`这是 ___ 的存在` 等加入 `translation_tone`）。
- [ ] `check_ai_novel.py` 重构后能正常运行，原 10 维检测不回归（`pytest -q tests/` 全绿）。
- [ ] `check_ai_novel.py` 新增 3 类检测（`archaic_clash` / `translation_tone` / `time_adverb_pile`），用包含「yyds」的测试文本验证 P0 触发。
- [ ] `ai_words.json` 缺失时 `check_ai_novel.py` fallback 硬编码不崩溃（删除 JSON 文件后跑 `check_ai_novel.py` 应打印 warning 但正常退出）。
- [ ] `check_doc_script_consistency.py` 在 `ai_words.json` 与 `style_guide.md` 不一致时退出码为 1。

### 6.4 与现有校验脚本的关系

| 校验脚本 | 检测对象 | 与本模块关系 |
|---|---|---|
| `scripts/novelforge/check_consistency.py` | 一致性（伏笔/角色状态/时间线/金手指/节奏） | 不冲突，独立维度 |
| `scripts/novelforge/check_ai_novel.py` | 去 AI 味（10 维） | **本模块重构其词库加载方式，新增 3 类检测** |
| `scripts/check_loop_log.py` | loop_log 结构 | 不冲突，独立维度 |
| `scripts/validate_commit_messages.py` | 提交信息规范 | 不冲突，独立维度 |
| `scripts/check_doc_script_consistency.py`（新增） | 文档脚本 SSOT 一致性 | 本模块新增，与上述脚本并列 |

---

## 七、回归测试要求

### 7.1 新增测试文件

**文件路径**：`/workspace/tests/test_doc_script_consistency.py`

**完整代码**：

```python
"""tests/test_doc_script_consistency.py

回归测试 for BUG-053: style_guide.md 禁用词表与 check_ai_novel.py 检测词表不一致。

测试覆盖：
1. ai_words.json 存在且 JSON 合法
2. style_guide.md 引用了 ai_words.json
3. 文档列出的禁用词 ⊆ ai_words.json（无 doc_only_words）
4. ai_words.json 中的词通过 SSOT 引用声明对齐（无 script_only_words 阻断）
5. check_doc_script_consistency.py 脚本可正常运行
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
AI_WORDS_JSON = ROOT / "scripts" / "novelforge" / "data" / "ai_words.json"
STYLE_GUIDE = ROOT / "NovelForge_Vault" / "00_控制面" / "style_guide.md"
CHECK_SCRIPT = ROOT / "scripts" / "check_doc_script_consistency.py"

EXPECTED_CATEGORIES = {
    "banned_p2", "quota", "patterns_p1",
    "archaic_clash", "translation_tone", "time_adverb_pile",
}


def test_ai_words_json_exists_and_valid():
    """1. ai_words.json 存在且 JSON 合法，包含所有 6 个分类键。"""
    assert AI_WORDS_JSON.exists(), f"ai_words.json 不存在: {AI_WORDS_JSON}"
    with open(AI_WORDS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    assert isinstance(data, dict)
    for cat in EXPECTED_CATEGORIES:
        assert cat in data, f"ai_words.json 缺少分类键: {cat}"
        assert "description" in data[cat], f"{cat} 缺少 description"
        assert "applies_to" in data[cat], f"{cat} 缺少 applies_to"
        assert "severity" in data[cat], f"{cat} 缺少 severity"
        assert "fix_strategy" in data[cat], f"{cat} 缺少 fix_strategy"
        # words 或 patterns 二选一
        assert ("words" in data[cat]) or ("patterns" in data[cat]), \
            f"{cat} 必须包含 words 或 patterns"


def test_style_guide_references_ai_words_json():
    """2. style_guide.md 同时引用 ai_words.json 与 check_ai_novel.py。"""
    assert STYLE_GUIDE.exists(), f"style_guide.md 不存在: {STYLE_GUIDE}"
    text = STYLE_GUIDE.read_text(encoding="utf-8")
    assert "ai_words.json" in text, "style_guide.md 未引用 ai_words.json（SSOT 数据源）"
    assert "check_ai_novel.py" in text, "style_guide.md 未引用 check_ai_novel.py（执行脚本）"
    # 必须有 SSOT 声明（让作者知道禁用词真相源）
    assert "SSOT" in text or "真相源" in text, \
        "style_guide.md 未声明 SSOT/真相源（作者无法定位禁用词真相）"


def test_no_doc_only_words():
    """3. style_guide.md 中「」内的禁用词候选 ⊆ ai_words.json 词表（白名单过滤后）。"""
    import re
    with open(AI_WORDS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    json_words = set()
    for cat in EXPECTED_CATEGORIES:
        for w in data.get(cat, {}).get("words", []) or []:
            json_words.add(w)

    text = STYLE_GUIDE.read_text(encoding="utf-8")
    quoted = re.findall(r"「([^」]{1,10})」", text)
    doc_words = {q for q in quoted if " " not in q and not re.fullmatch(r"[\d\W]+", q)}

    # 白名单：style_guide.md 中合理出现的非 ai_words 词（称谓示例 / forbidden_words 示例 / 已在 ai_words 的词）
    whitelist = {
        "师尊", "师弟", "师兄", "阁下", "这位", "罢了", "何须", "且看", "且慢",
        "牛逼", "卧槽",
        "yyds", "破防", "绝绝子",  # 已在 archaic_clash
    }
    doc_only = doc_words - json_words - whitelist
    assert not doc_only, (
        f"文档列出但 ai_words.json 未包含的词: {sorted(doc_only)}；"
        f"作者会误以为禁用，但 check_ai_novel.py 不会检测"
    )


def test_no_script_only_words():
    """4. ai_words.json 中的词通过 SSOT 引用声明对齐（style_guide 已改为引用方式）。

    style_guide.md 改为引用 ai_words.json 后，不再逐词列出，而是通过 SSOT 声明对齐。
    本测试验证：style_guide.md 中包含分级管控说明表格，且表格中列出了所有分类键。
    """
    text = STYLE_GUIDE.read_text(encoding="utf-8")
    # 验证 style_guide.md 列出了所有分类键（在分级管控表格的"SSOT 分类键"列）
    for cat in EXPECTED_CATEGORIES:
        assert cat in text, \
            f"style_guide.md 分级管控表格未列出 SSOT 分类键: {cat}（作者无法从文档反查 JSON）"


def test_check_doc_script_consistency_runs():
    """5. check_doc_script_consistency.py 脚本可正常运行，退出码为 0。"""
    assert CHECK_SCRIPT.exists(), f"check_doc_script_consistency.py 不存在: {CHECK_SCRIPT}"
    result = subprocess.run(
        [sys.executable, str(CHECK_SCRIPT), "--vault", str(ROOT / "NovelForge_Vault")],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    assert result.returncode == 0, (
        f"check_doc_script_consistency.py 退出码非 0: {result.returncode}\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    assert "核心校验通过" in result.stdout or "✅" in result.stdout
```

### 7.2 新增 BUG-053

**修改文件**：`/workspace/tests/bug_regression_list.md`

**新增条目**（追加到文件末尾）：

```markdown
## style_guide.md 禁用词表与 check_ai_novel.py 检测词表不一致

- **编号**：BUG-053
- **首次出现**：2026-07-18
- **类型**：去 AI 味 / 工具链
- **现象**：style_guide.md 列出约 50 个禁用词/句式（含范畴化表述），check_ai_novel.py 仅检测约 35 个，15 个未覆盖。典型漏检：style_guide 声明禁用「yyds」「破防」「绝绝子」「不由得」「一时间」「这是 ___ 的存在」等，但 check_ai_novel.py 无对应检测；反向，check_ai_novel.py 的 18 个 AI_PATTERNS_EXPLICIT（如「不难发现」「说到底」）未在 style_guide 文档化。作者按文档自查通过的稿件，CI 跑脚本仍报 P1；或作者用「不由得」等词，CI 不报但读者反馈"AI 味重"。
- **根因**：文档与脚本未做 SSOT（Single Source of Truth）校验。style_guide.md 与 check_ai_novel.py 各自维护词表，无单一数据源，无一致性校验。新增禁用词时作者改了文档忘记改脚本（或反之），导致两者漂移。loop_log 2026-07 沉淀教训 4 已识别此问题。
- **修复**：
  1. 新增 `scripts/novelforge/data/ai_words.json` 作为 SSOT 数据源，包含 6 个分类键（banned_p2 / quota / patterns_p1 / archaic_clash / translation_tone / time_adverb_pile）。
  2. 重构 `check_ai_novel.py` 行 89-124 的硬编码 `AI_WORDS_P2_BAN` / `AI_WORDS_QUOTA` / `AI_PATTERNS_EXPLICIT` 改为加载 `ai_words.json`，保留硬编码作为 fallback；新增 3 类检测（archaic_clash / translation_tone / time_adverb_pile）。
  3. 修改 `style_guide.md` §1.1 改用引用方式（"禁用词表见 ai_words.json，由 check_ai_novel.py 强制执行"），删除文档内具体词表，保留分级管控说明 + SSOT 分类键映射。
  4. 新增 `scripts/check_doc_script_consistency.py` 校验脚本，双向比对文档与 JSON，P1 阻断不一致项。
  5. 在 `dev-checklist.md` §二/§七/§八 新增 SSOT 校验检测项。
- **涉及文件**：
  - `scripts/novelforge/data/ai_words.json`（新增）
  - `scripts/novelforge/check_ai_novel.py`（重构词库加载 + 新增 3 类检测）
  - `NovelForge_Vault/00_控制面/style_guide.md`（§1.1 改用引用方式）
  - `scripts/check_doc_script_consistency.py`（新增）
  - `.trae/checklists/dev-checklist.md`（新增 SSOT 校验检测项）
  - `tests/test_doc_script_consistency.py`（新增 5 个测试用例）
- **回归测试**：
  - `tests/test_doc_script_consistency.py` 5 个测试用例（test_ai_words_json_exists_and_valid / test_style_guide_references_ai_words_json / test_no_doc_only_words / test_no_script_only_words / test_check_doc_script_consistency_runs）
  - `python scripts/check_doc_script_consistency.py --vault NovelForge_Vault` 退出码 0
  - `python scripts/novelforge/check_ai_novel.py --chapter 1 --vault NovelForge_Vault` 原 10 维检测不回归
- **教训**：文档与脚本共用数据必须 SSOT 化。NovelForge 核心哲学「文件即真相」的延伸——脚本是可执行的真相，文档通过引用方式跟随脚本。新增共用数据时必须先建 SSOT 数据源（JSON/YAML），再让脚本与文档引用，禁止双源维护。CI 必须有 SSOT 校验脚本作为守门员，否则文档与脚本会随时间漂移。
```

### 7.3 在 `check_ai_novel.py` 新增的检测规则

按 `.trae/rules/bug-reporting.md` §五要求，去 AI 味问题应在 `check_ai_novel.py` 中增加检测：

| 新增检测维度 | 检测函数 | 严重级别 | 触发条件 |
|---|---|---|---|
| 现代网络用语混入古风 | `check_ai_word` 内 `archaic_clash` 分支 | P0 | 全文出现 `yyds`/`破防`/`绝绝子`/`栓Q`/`蚌埠住了`/`芭比Q` |
| AI 翻译腔 | `check_ai_word` 内 `translation_tone` 分支 | P0 | 全文匹配 `这是.*的存在`/`一种.*的感觉`/`一个.*的`/`作为.*的` |
| 时间副词堆砌 | `check_ai_word` 内 `time_adverb_pile` 分支 | P2 | 全文「不由得」/「一时间」/「不禁」/「不由自主」/「顿时」/「刹那间」/「顷刻间」/「转眼间」/「霎时间」每千字 > 1 次 |

**未在 `check_consistency.py` 新增检测**（本模块属去 AI 味范畴，不涉及一致性）。

### 7.4 完整测试集执行

按 `.trae/rules/bug-reporting.md` §五第 4 条，修复完成后执行：

```bash
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
python scripts/check_doc_script_consistency.py --vault NovelForge_Vault
pytest -q
```

四项全部通过方可合并。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**低**。理由：
1. 本模块仅引入新数据源（`ai_words.json`）与新校验脚本（`check_doc_script_consistency.py`），不破坏现有检测逻辑。
2. `check_ai_novel.py` 重构有 fallback 机制（JSON 缺失时用硬编码），不会因 JSON 文件问题导致脚本崩溃。
3. `style_guide.md` 改为引用方式后，作者通过 SSOT 声明仍能定位禁用词清单，可读性不降低。

### 8.2 对核心资产的影响

| 资产 | 影响 | 风险控制 |
|---|---|---|
| `style_guide.md`（核心资产） | §1.1 改用引用方式，删除具体词表 | 保留分级管控说明表格 + SSOT 分类键映射，作者仍可从文档反查 JSON；改动需经用户确认 |
| `check_ai_novel.py`（核心资产） | 重构词库加载方式 + 新增 3 类检测 | 保留硬编码 fallback；重构后必须跑 `pytest -q tests/` 全绿；新增检测可能触发既有章节报 P0/P2，需评估既有章节影响 |
| `.trae/checklists/dev-checklist.md` | 新增 3 项检测项 | 纯增量，不修改既有项 |
| `tests/bug_regression_list.md` | 新增 BUG-053 条目 | 纯增量 |

### 8.3 主要风险点

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `check_ai_novel.py` 重构后既有章节触发新 P0（如既有章节含「破防」） | 中 | 既有章节报 P0 阻断合并 | 重构后先跑全量章节扫描，识别影响范围；既有章节中的 P0 视为历史遗留，单独修复或加白名单 |
| `extract_doc_words` 误抓非禁用词导致 P1 误报 | 低 | SSOT 校验脚本阻断合并 | 白名单机制过滤称谓示例 / forbidden_words 示例；测试用例覆盖 |
| `ai_words.json` 路径在不同环境（CI / 本地 / Trae 沙箱）下解析失败 | 低 | `check_ai_novel.py` fallback 硬编码，检测覆盖不全 | 用绝对路径（基于 `__file__` 推算 ROOT）；fallback 机制保证不崩溃 |
| 作者不熟悉 SSOT 流程，直接改 `style_guide.md` 词表 | 中 | SSOT 校验脚本阻断，作者困惑 | `style_guide.md` §1.1 顶部明确声明"新增/修改禁用词必须改 ai_words.json"；`dev-checklist.md` 新增 SSOT 检测项 |

### 8.4 回滚方案

**分支隔离**：
- 在 `feature/doc-script-ssot` 分支开发，不直接合 `master`。
- 开发期间所有改动（`ai_words.json` / `check_ai_novel.py` / `style_guide.md` / `check_doc_script_consistency.py` / `dev-checklist.md` / `tests/`）均在分支内。

**保留旧硬编码作为 fallback**：
- `check_ai_novel.py` 重构后保留 `_FALLBACK_BANNED_P2` / `_FALLBACK_QUOTA` / `_FALLBACK_PATTERNS_P1` 等常量，`ai_words.json` 缺失时自动回退。
- 回滚时只需删除 `ai_words.json` 文件，`check_ai_novel.py` 即回退到硬编码行为（但 `check_doc_script_consistency.py` 会报 P1，需一并回滚该脚本）。

**完整回滚命令**：

```bash
# 1. 切回 master
git checkout master

# 2. 删除 feature 分支（如有需要）
git branch -D feature/doc-script-ssot

# 或在 feature 分支上 revert 单个 commit
git revert <commit-hash>
```

**部分回滚**（仅回滚 `style_guide.md`，保留 `ai_words.json` 与脚本）：
- `git checkout master -- NovelForge_Vault/00_控制面/style_guide.md`
- 此时 `check_doc_script_consistency.py` 会报 P1（style_guide 未引用 SSOT），需同时调整校验脚本白名单或回滚校验脚本。

---

## 九、完成标准（DoD 清单）

- [ ] `scripts/novelforge/data/ai_words.json` 数据文件创建，包含 6 个分类键 + `_meta` 元数据
- [ ] `scripts/novelforge/check_ai_novel.py` 重构为加载 `ai_words.json`，保留 fallback 硬编码
- [ ] `check_ai_novel.py` 新增 3 类检测：`archaic_clash`（P0）/ `translation_tone`（P0）/ `time_adverb_pile`（P2）
- [ ] `NovelForge_Vault/00_控制面/style_guide.md` §1.1 改为引用 `ai_words.json`，删除具体词表，保留分级管控说明 + SSOT 分类键映射
- [ ] `scripts/check_doc_script_consistency.py` 脚本可运行，P1/P2 分级输出，退出码 0/1 正确
- [ ] 15 个不一致项全部修复（`yyds`/`破防`/`绝绝子` 加入 `archaic_clash`；`这是 ___ 的存在` 等加入 `translation_tone`；`不由得`/`一时间`/`不禁` 等加入 `time_adverb_pile`；18 个 P1 套路句式通过 SSOT 引用对齐）
- [ ] `tests/test_doc_script_consistency.py` 5 个测试用例全部通过（`test_ai_words_json_exists_and_valid` / `test_style_guide_references_ai_words_json` / `test_no_doc_only_words` / `test_no_script_only_words` / `test_check_doc_script_consistency_runs`）
- [ ] `tests/bug_regression_list.md` 新增 BUG-053「style_guide.md 禁用词表与 check_ai_novel.py 检测词表不一致」
- [ ] `.trae/checklists/dev-checklist.md` §二/§七/§八 新增 SSOT 校验检测项
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 通过（一致性不回归）
- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 通过（去 AI 味不回归，新检测项对既有章节的影响已评估）
- [ ] `python scripts/check_doc_script_consistency.py --vault NovelForge_Vault` 通过（SSOT 校验核心 P1 全绿）
- [ ] `pytest -q` 全部通过（含新增 5 个测试用例 + 既有测试不回归）

---

## 附录：参考文档

- [file:///workspace/docs/optimization_plan_2026_07/00_master_plan.md](file:///workspace/docs/optimization_plan_2026_07/00_master_plan.md) · 总览方案（M3 属 L1 修复工程债层）
- [file:///workspace/.trae/rules/dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) · 协作流程规则（合并前必须清零所有校验问题）
- [file:///workspace/.trae/rules/bug-reporting.md](file:///workspace/.trae/rules/bug-reporting.md) · Bug 记录与回归规范
- [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) · 创作自检 Checklist
- [file:///workspace/scripts/check_loop_log.py](file:///workspace/scripts/check_loop_log.py) · 校验脚本风格参考
- [file:///workspace/scripts/validate_commit_messages.py](file:///workspace/scripts/validate_commit_messages.py) · 校验脚本风格参考

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 优化方案 M3 模块
**下游依赖**：M9（朱雀七维度对抗规则沉淀，依赖 M3 的 `ai_words.json` SSOT 数据流）
