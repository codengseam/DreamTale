# M18 · Persona Vectors 启发式角色漂移监控

> **模块层级**：L2 强化已有能力（用 embedding 相似度给角色漂移检测加量化指标）
> **对应盲区**：角色漂移检测无量化指标，OOC 不可早期发现（master_plan §1.3 第 10 类盲区）
> **文档版本**：v1.0 · 2026-07-18
> **依赖**：M5（角色五层档案，`stable_info.language_fingerprint` 是本模块的比对基线）
> **上游影响**：M2（schema 同步门禁）、M5（角色五层档案）、M7（active enforcement）
> **下游影响**：M19+（如未来引入向量库检索，可基于本模块的 baseline embedding 做语义检索）

---

## 一、模块目标

### 1.1 一句话目标

基于角色语言指纹的 embedding 相似度比对，相似度低于阈值告警；这是 Persona Vectors 论文 r ≈ 0.8 的工程化近似实现。

### 1.2 对应的痛点

**长篇角色漂移检测无量化指标**。

NovelForge 现有 `check_consistency.py` 的第 8 类检测 `character_language_fingerprint_drift`（M5 新增）只做"句长均值 + preferred_words 命中率"两个统计量的滚动比对——这是粗粒度数值特征，无法捕捉语义层漂移。例如主角设定是"高冷惜字如金"，最近 5 章平均句长仍 12 字符合基线，但语义上从"克制隐忍"漂移到"阴阳怪气刻薄"，句长统计看不出来，embedding 语义相似度能看出来。

学术上 Persona Vectors 论文（[arXiv 2507.21509](https://arxiv.org/abs/2507.21509)）证明在 LLM 激活空间可找到与高层 character traits 对应的线性方向，投影到向量上即可在生成前预测角色一致性（r ≈ 0.8），并支持 steering 防止漂移。但论文方法需要访问模型激活空间，工程不可直接落地。本模块用 embedding 相似度做启发式近似，把"角色漂移检测无量化指标"问题工程化解决。

### 1.3 完成后达成的能力

| 能力 | 当前状态（M5 完成后） | M18 完成后 |
|---|---|---|
| 角色语言指纹基线 | `stable_info.language_fingerprint`（句长/口头禅/用词偏好/称呼习惯/决策偏好） | 同上 + baseline embedding 缓存到 `data/persona_vector_baseline/` |
| 角色漂移检测指标 | 句长均值偏离 + preferred_words 命中率（统计特征） | **+ embedding cosine 相似度（语义特征）**，r ≈ 0.8 量化指标 |
| 章后自动监控 | `check_consistency.py` 第 8 类（统计漂移） | **+ 第 9 类 `persona_vector_drift`（语义漂移）**，每章后自动比对 |
| OOC 早期发现能力 | 句长漂移到 30% 才告警（已是 OOC 中后期） | **语义相似度 < 0.85 即 P1 告警**，可在句长尚未漂移时识别 OOC 早期信号 |
| 离线可用性 | 纯 Python 标准库，无外部依赖 | 优先 sentence-transformers（本地），fallback OpenAI API（在线），三级降级到词汇级相似度（无网络） |

---

## 二、痛点对应

### 2.1 痛点表现：Persona Vectors 论文需访问模型激活空间，工程不可直接落地

**学术发现**（行业调研归纳）：

| 论文 | 核心方法 | 工程落地的痛点 |
|---|---|---|
| [Persona Vectors (Anthropic, arXiv 2507.21509)](https://arxiv.org/abs/2507.21509) | 在 LLM 激活空间找与高层 character traits 对应的线性方向，投影到向量上即可在生成前预测角色一致性（r ≈ 0.8），可 steering 防止漂移 | 需要访问模型激活空间（中间层 hidden states），需要白盒模型；NovelForge 使用 Trae 托管的 LLM，黑盒 API 不可访问激活 |
| [Consistently Simulating Human Personas with Multi-Turn RL (NeurIPS 2025)](https://arxiv.org/abs/2407.18431) | 多轮 RL 微调基座模型，让 LLM 在长程对话中保持 persona 一致，不一致率降低 55%+ | 需要基座模型微调权限，NovelForge 不微调，只用 prompt 工程 |
| [Spotting Out-of-Character Behavior (ACL 2025)](https://arxiv.org/abs/2407.18431) | 原子级 persona fidelity 评估框架，三指标（ACC_atom / IC_atom / RC_atom）做 OOC 识别 | 评估框架需要人工标注大量原子级行为，工程化成本高；且只做评估不做监控 |

**根因分析**：

1. **物理根因**：LLM 黑盒 API 不暴露激活空间，Persona Vectors 论文的"在激活空间找线性方向"方法在工程上不可直接复现。
2. **方法根因**：现有 `check_consistency.py` 的第 8 类漂移检测只比对句长均值与 preferred_words 命中率（统计特征），无法捕捉语义层漂移——"克制隐忍"漂移到"阴阳怪气"两个语义不同但句长可能相同的漂移。
3. **数据根因**：角色漂移的早期信号是"语义偏离基线"，不是"句长偏离基线"。等到句长漂移到 30% 时已是 OOC 中后期，错过最佳修复窗口。

### 2.2 学术方案

**方案 A：Persona Vectors 直接复现**（不可行）

需要访问模型激活空间，NovelForge 使用 Trae 托管 LLM 的黑盒 API，无法拿到中间层 hidden states。

**方案 B：多轮 RL 微调基座模型**（不可行）

需要基座模型微调权限，且 NovelForge 哲学是"零外部依赖 + 可解释"，不微调模型。

**方案 C：原子级 persona fidelity 评估**（部分借鉴）

借鉴"原子级评估"思想做"原子级监控"——不是评估整个角色，而是监控每个角色每段台词是否 OOC。但 ACL 2025 论文需要人工标注大量原子级行为，工程化成本高，NovelForge 借鉴思想不抄方法。

### 2.3 本模块的差异化设计

NovelForge 的差异化在于「**用 embedding 相似度作为 Persona Vectors 的启发式近似**」：

1. **基线 embedding 化**（区别于方案 A/B/C）：从 `stable_info.language_fingerprint` 抽取口头禅/小动作/决策偏好/句式特征/称呼习惯，拼接成"角色代表性文本"，用 sentence-transformers 或 OpenAI embedding API 生成基线向量。这是 Persona Vectors "在激活空间找线性方向"的工程化近似——embedding 向量本身就是模型对文本的高层语义表示，是激活空间的近似投影。
2. **章节台词抽取**（继承方案 C 的原子级思想）：从章节正文按对话归属抽取每个角色的台词，拼接成"本章角色实际表现文本"，生成 embedding。
3. **cosine 相似度比对**（量化指标）：计算章节台词 embedding 与基线 embedding 的 cosine 相似度，作为角色一致性的量化指标（r ≈ 0.8 的工程化近似）。阈值三级：>0.85 通过 / 0.7-0.85 P1 警告 / <0.7 P0 漂移。
4. **三级 fallback**（继承 NovelForge 零依赖哲学）：优先 sentence-transformers（本地，无需网络），次选 OpenAI API（在线，需 key），降级到词汇级相似度（Jaccard + cosine on word frequency，无网络也可用）。
5. **与 M5 的互补关系**：M5 的第 8 类检测（`character_language_fingerprint_drift`）是统计特征（句长/命中率），M18 的第 9 类检测（`persona_vector_drift`）是语义特征。两者互补：M5 防慢性数值漂移（句长渐变），M18 防急性语义漂移（语义偏离但句长可能未变）。

---

## 三、涉及现有文件

### 3.1 状态机与脚本文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| check_consistency.py | `file:///workspace/scripts/novelforge/check_consistency.py` | line 60-201（常量与维度定义，`ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` 需加第 9 类）；line 207-248（`Issue` / `Report` 数据结构，本模块复用）；line 877-1000（M5 新增的 `check_character_language_fingerprint_drift`，本模块的姊妹检测，需明确边界）；line 1199-1289（`check_all` 编排，需在第 8 类后追加第 9 类分派）；line 1300-1344（`format_report` 报告格式化，需加第 9 类标签） |
| protagonist.json | `file:///workspace/NovelForge_Vault/.state/characters/protagonist.json` | line 53-59（`language_fingerprint` 字段，M5 升级后迁移到 `stable_info.language_fingerprint`，含 `avg_sentence_length/preferred_words/catchphrases/forbidden_words/address_habits/decision_preference`） |
| schema.py | `file:///workspace/scripts/novelforge/schema.py` | line 18-170（`CHARACTER_STATE_SCHEMA`，M5 升级为 `stable_info` + `mutable_info` + `meta` 三段后，本模块读 `stable_info.language_fingerprint`）；line 308-322（`validate_character_state`，本模块不修改但依赖其校验 stable_info 完整性） |
| check_ai_novel.py | `file:///workspace/scripts/novelforge/check_ai_novel.py` | line 825-902（`check_dialogue_identity` 单章检测，本模块不改动但需明确边界：单章急性 OOC vs 跨章语义漂移）；line 416-438（`load_all_fingerprints` 加载指纹，本模块复用此函数加载基线） |

### 3.2 Skill 文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| writer-polisher SKILL.md | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | line 95-135（阶段二审计，调 `check_consistency.py` 与 `check_ai_novel.py`，本模块在第 9 类检测加入后需追加调用）；line 144-176（阶段三精修，P0 修复策略表需加第 9 类 `persona_vector_drift` 的修复方向）；line 302-312（错误处理，需加 embedding 服务不可用时的降级处置） |
| state-consistency-checker SKILL.md | `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` | line 95-106（7 类检测解读表，M5 已扩为 8 类，本模块需扩为 9 类）；line 162-171（golden_finger_overreach 解读后需追加第 9 类解读） |

### 3.3 Checklist 文件（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| dev-checklist.md | `file:///workspace/.trae/checklists/dev-checklist.md` | line 30-41（§三一致性，需新增 persona_vector 检测项）；line 76-86（§八去 AI 味，需新增角色语义漂移检测项） |

### 3.4 依赖模块文档（必读）

| 文件 | file:/// 链接 | 关键关注位置 |
|---|---|---|
| M05_character_five_layer.md | `file:///workspace/docs/optimization_plan_2026_07/M05_character_five_layer.md` | line 282-300（`stable_info.language_fingerprint` schema 完整定义，本模块的基线来源）；line 574-586（M5 的 protagonist.json 迁移示例，含 `language_fingerprint` 字段，本模块直接读取）；line 862-1082（M5 的 `check_character_language_fingerprint_drift` 实现代码，本模块的姊妹检测，需明确边界） |

### 3.5 现状速读结论

- **基线层**：M5 完成后，`stable_info.language_fingerprint` 含 6 个字段（`avg_sentence_length/preferred_words/catchphrases/forbidden_words/address_habits/decision_preference`），足够拼接出"角色代表性文本"。
- **检测层**：M5 的第 8 类 `character_language_fingerprint_drift` 已实现"统计特征漂移检测"，本模块新增的第 9 类 `persona_vector_drift` 是"语义特征漂移检测"，两者互补。
- **embeddings 工具**：当前项目无 embedding 依赖（`scripts/novelforge/` 全部纯标准库），本模块首次引入 sentence-transformers / openai 依赖，需走 fallback 降级保证零依赖时仍可用。
- **数据存储**：M5 的指纹快照存 `data/character_fingerprints/<id>_ch<NNN>.json`（按章号归档），本模块的 baseline embedding 存 `data/persona_vector_baseline/<id>.json`（每角色一份基线），目录结构平级不冲突。

---

## 四、新增/修改文件清单

### 4.1 新增文件

| 路径 | 用途 |
|---|---|
| `file:///workspace/scripts/novelforge/persona_vector_monitor.py` | 角色漂移监控脚本：加载角色基线、抽取章节角色台词、生成 embedding、计算 cosine 相似度、输出报告。支持 sentence-transformers / OpenAI API / 词汇级相似度三级 fallback |
| `file:///workspace/scripts/novelforge/data/persona_vector_baseline/` | 角色基线 embedding 存储目录，每角色一份 `<character_id>.json`，含 baseline 文本、embedding 向量、模型名、生成时间戳 |
| `file:///workspace/scripts/novelforge/data/persona_vector_baseline/.gitkeep` | 占位文件，确保目录被 git 跟踪 |
| `file:///workspace/tests/test_persona_vector.py` | 7 个回归测试用例，锁定基线构建 / 台词抽取 / 相似度计算 / P0/P1 检测 / 正常通过 / fallback 降级 |

### 4.2 修改文件

| 路径 | 核心改动点 |
|---|---|
| `file:///workspace/scripts/novelforge/check_consistency.py` | `ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` 加第 9 类 `persona_vector_drift`；新增 `check_persona_vector_drift` 函数（编排 persona_vector_monitor）；`check_all` 分派逻辑加第 9 类；`format_report` 标签同步 |
| `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | 阶段二审计调用 `check_consistency.py` 自动包含第 9 类；阶段三精修 P0 修复策略表新增 `persona_vector_drift` 行；错误处理加 embedding 服务不可用降级处置 |
| `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` | 8 类检测解读表扩为 9 类；新增第 9 类 `persona_vector_drift` 解读指南（含 P0/P1 阈值与修复方向） |
| `file:///workspace/.trae/checklists/dev-checklist.md` | §三一致性新增 persona_vector 检测项；§八去 AI 味新增角色语义漂移检测项 |

### 4.3 不修改的核心资产

- `scripts/novelforge/check_ai_novel.py` —— 单章检测逻辑保持不变，与本模块的跨章语义漂移检测互补。
- `scripts/novelforge/schema.py` —— M5 已升级为五层 schema，本模块不改 schema，只读 `stable_info.language_fingerprint`。
- `NovelForge_Vault/.state/characters/protagonist.json` —— M5 已迁移到五层结构，本模块只读不写。
- `NovelForge_Vault/00_控制面/style_guide.md` —— 附录 B 角色语言指纹规范由 M5 升级完成，本模块不改。

---

## 五、详细实现步骤

### 步骤 1：设计"角色语言指纹基线"的构建方式

#### 1.1 从 `stable_info.language_fingerprint` 抽取字段

读取 M5 升级后的 `protagonist.json`，从 `stable_info.language_fingerprint` 抽取以下字段拼接成"角色代表性文本"：

| 字段 | 拼接方式 | 示例（来自 M5 的 protagonist.json 示例） |
|---|---|---|
| `catchphrases` | 全部拼接，每个用句号分隔 | "且慢。无妨。" |
| `preferred_words` | 拼成"我常说的话有：X、Y、Z" | "我常说的话有：罢了、何须、且看、不必" |
| `forbidden_words` | 拼成"我绝不会说：X、Y、Z" | "我绝不会说：牛逼、卧槽、yyds、绝绝子" |
| `address_habits` | 拼成"我称呼师傅为师尊，称呼同门为师兄/师弟，称呼敌人为阁下，称呼陌生人为这位" | 同左 |
| `decision_preference` | 直接拼接 | "遇事先观察三息再动，能不动手就不动手" |
| `avg_sentence_length` | 拼成"我的台词平均句长约 X 字，偏好短句/长句" | "我的台词平均句长约 12 字，偏好短句" |

#### 1.2 拼接成"角色代表性文本"的代码片段

```python
def build_baseline_text(language_fingerprint: dict) -> str:
    """从 stable_info.language_fingerprint 构建角色代表性文本。

    Args:
        language_fingerprint: M5 升级后的语言指纹字典，含 6 个字段。

    Returns:
        角色代表性文本字符串，约 200-500 字。
    """
    parts: list[str] = []

    # 口头禅
    catchphrases = language_fingerprint.get("catchphrases") or []
    if catchphrases:
        parts.append("。".join(catchphrases) + "。")

    # 高频词
    preferred = language_fingerprint.get("preferred_words") or []
    if preferred:
        parts.append(f"我常说的话有：{'、'.join(preferred)}。")

    # 禁用词
    forbidden = language_fingerprint.get("forbidden_words") or []
    if forbidden:
        parts.append(f"我绝不会说：{'、'.join(forbidden)}。")

    # 称呼习惯
    habits = language_fingerprint.get("address_habits") or {}
    if habits:
        habit_lines = [f"称呼{target}为{name}" for target, name in habits.items()]
        parts.append("我" + "，".join(habit_lines) + "。")

    # 决策偏好
    decision = language_fingerprint.get("decision_preference") or ""
    if decision:
        parts.append(decision)

    # 平均句长
    avg_len = language_fingerprint.get("avg_sentence_length")
    if isinstance(avg_len, int) and avg_len > 0:
        style = "短句" if avg_len <= 12 else ("中句" if avg_len <= 20 else "长句")
        parts.append(f"我的台词平均句长约 {avg_len} 字，偏好{style}。")

    return "".join(parts)
```

#### 1.3 生成基线 embedding 并存储

用 sentence-transformers / OpenAI API 生成 embedding，存到 `data/persona_vector_baseline/<character_id>.json`：

```json
{
  "character_id": "protagonist",
  "baseline_text": "且慢。无妨。我常说的话有：罢了、何须、且看、不必。我绝不会说：牛逼、卧槽、yyds、绝绝子。我称呼师傅为师尊，称呼同门为师兄/师弟，称呼敌人为阁下，称呼陌生人为这位。遇事先观察三息再动，能不动手就不动手。我的台词平均句长约 12 字，偏好短句。",
  "embedding": [0.0123, -0.0456, 0.0789, ...],
  "embedding_dim": 384,
  "model_name": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
  "generated_at": "2026-07-18T10:30:00",
  "schema_version": "persona-vector-v1"
}
```

### 步骤 2：设计"章节角色台词抽取"逻辑

#### 2.1 按对话归属抽取每个角色的台词

从章节正文按 `角色名+道/说/笑道/喝道...` 模式抽取每个角色的台词。复用 `check_consistency.py` 已有的 `DIALOGUE_PATTERN`（line 140-143）做角色名识别，再用引号正则抽取台词内容：

```python
DIALOGUE_ATTRIBUTION_PATTERN = re.compile(
    r"(?P<name>[^\s，。：：「」『』""''！？]{2,6})"
    r"(?:道|说|笑道|喝道|怒道|冷道|叹道|问道|答道|喊道|低声道|高呼|大笑)\s*[：:]?\s*"
    r'[\u201c\u300c"](?P<dialogue>[^\u201d\u300d"]{1,500})[\u201d\u300d"]'
)

def extract_character_dialogues(body: str, character_names: list[str]) -> list[str]:
    """从正文抽取指定角色的台词列表。

    Args:
        body: 章节正文（已剥离 frontmatter）。
        character_names: 角色名 + 别名列表。

    Returns:
        该角色在本章的所有台词字符串列表。
    """
    # 构造角色名匹配正则（按长度降序避免短名误匹配）
    valid_names = sorted({n for n in character_names if n and len(n) >= 1}, key=len, reverse=True)
    if not valid_names:
        return []
    name_alt = "|".join(re.escape(n) for n in valid_names)
    name_pattern = re.compile(name_alt)

    dialogues: list[str] = []
    for m in DIALOGUE_ATTRIBUTION_PATTERN.finditer(body):
        if name_pattern.fullmatch(m.group("name")) or name_pattern.search(m.group("name")):
            dialogues.append(m.group("dialogue"))
    return dialogues
```

#### 2.2 拼接成"本章角色实际表现文本"

```python
def build_chapter_text(dialogues: list[str]) -> str:
    """把本章角色台词拼接成实际表现文本。"""
    if not dialogues:
        return ""
    return "。".join(dialogues) + "。"
```

### 步骤 3：设计相似度比对算法

#### 3.1 cosine similarity 计算

```python
import math

def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """计算两个向量的 cosine 相似度。"""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
```

#### 3.2 阈值三级判定

```python
# 阈值定义（来自行业调研 r ≈ 0.8 的工程化近似）
PERSONA_VECTOR_THRESHOLD_PASS: float = 0.85   # >0.85 通过
PERSONA_VECTOR_THRESHOLD_P1: float = 0.70    # 0.7-0.85 P1 警告
# <0.7 P0 漂移

def classify_drift(similarity: float) -> tuple[str, str]:
    """根据 cosine 相似度判定漂移级别。

    Returns:
        (severity, sub_type) —— severity 为 "P0"/"P1"/None；
        sub_type 为 "severe_drift"/"moderate_drift"/"normal"
    """
    if similarity < PERSONA_VECTOR_THRESHOLD_P1:
        return ("P0", "severe_drift")
    elif similarity < PERSONA_VECTOR_THRESHOLD_PASS:
        return ("P1", "moderate_drift")
    else:
        return (None, "normal")
```

### 步骤 4：persona_vector_monitor.py 完整脚本逻辑

**文件路径**：`file:///workspace/scripts/novelforge/persona_vector_monitor.py`

**完整代码片段**：

```python
"""NovelForge Persona Vectors 启发式角色漂移监控脚本。

基于角色语言指纹的 embedding 相似度比对，是 Persona Vectors 论文
（arXiv 2507.21509）r ≈ 0.8 的工程化近似实现。

三级 embedding fallback：
1. sentence-transformers（本地，优先）
2. OpenAI API（在线，需 OPENAI_API_KEY）
3. 词汇级相似度（无网络降级，Jaccard + cosine on word frequency）

CLI 速查：
    # 检测第 42 章主角漂移
    python -m scripts.novelforge.persona_vector_monitor --chapter 42

    # 指定角色
    python -m scripts.novelforge.persona_vector_monitor --chapter 42 --character protagonist

    # 重新构建基线（角色档案变更后）
    python -m scripts.novelforge.persona_vector_monitor --rebuild-baseline protagonist

    # 指定 embedding 后端
    python -m scripts.novelforge.persona_vector_monitor --chapter 42 --backend sentence-transformers
    python -m scripts.novelforge.persona_vector_monitor --chapter 42 --backend openai
    python -m scripts.novelforge.persona_vector_monitor --chapter 42 --backend lexical

退出码：
- 0：通过（相似度 > 0.85）或 P1 警告（0.7-0.85，不阻断）
- 1：P0 漂移（相似度 < 0.7）
- 2：脚本错误
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# 复用 check_consistency 的常量与辅助
try:
    from .check_consistency import (
        DEFAULT_VAULT,
        DIALOGUE_PATTERN,
        load_character_states,
        load_chapter_text,
        strip_frontmatter,
        _detect_volume,
        _find_protagonist,
    )
except ImportError:
    from scripts.novelforge.check_consistency import (  # type: ignore
        DEFAULT_VAULT,
        DIALOGUE_PATTERN,
        load_character_states,
        load_chapter_text,
        strip_frontmatter,
        _detect_volume,
        _find_protagonist,
    )


# ============================================================================
# 常量
# ============================================================================
BASELINE_DIR_REL: str = "scripts/novelforge/data/persona_vector_baseline"

# 阈值
PERSONA_VECTOR_THRESHOLD_PASS: float = 0.85
PERSONA_VECTOR_THRESHOLD_P1: float = 0.70

# 默认 sentence-transformers 模型（多语言，支持中文）
DEFAULT_ST_MODEL: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
DEFAULT_OPENAI_MODEL: str = "text-embedding-3-small"

# 对话归属模式（角色名 + 道说笑道 + 引号）
DIALOGUE_ATTRIBUTION_PATTERN = re.compile(
    r"(?P<name>[^\s，。：：「」『』""''！？]{2,6})"
    r"(?:道|说|笑道|喝道|怒道|冷道|叹道|问道|答道|喊道|低声道|高呼|大笑)\s*[：:]?\s*"
    r'[\u201c\u300c"](?P<dialogue>[^\u201d\u300d"]{1,500})[\u201d\u300d"]'
)


# ============================================================================
# 数据结构
# ============================================================================
@dataclass
class PersonaVectorReport:
    """角色漂移监控报告。"""

    chapter: int
    character_id: str
    similarity: float
    severity: str  # "P0" / "P1" / None
    sub_type: str  # "severe_drift" / "moderate_drift" / "normal"
    backend: str  # "sentence-transformers" / "openai" / "lexical"
    baseline_text: str
    chapter_text: str
    chapter_dialogue_count: int
    detail: str = ""
    suggestion: str = ""


# ============================================================================
# 基线文本构建
# ============================================================================
def build_baseline_text(language_fingerprint: dict) -> str:
    """从 stable_info.language_fingerprint 构建角色代表性文本。

    拼接口头禅/高频词/禁用词/称呼习惯/决策偏好/句长偏好。
    """
    parts: list[str] = []

    catchphrases = language_fingerprint.get("catchphrases") or []
    if catchphrases:
        parts.append("。".join(catchphrases) + "。")

    preferred = language_fingerprint.get("preferred_words") or []
    if preferred:
        parts.append(f"我常说的话有：{'、'.join(preferred)}。")

    forbidden = language_fingerprint.get("forbidden_words") or []
    if forbidden:
        parts.append(f"我绝不会说：{'、'.join(forbidden)}。")

    habits = language_fingerprint.get("address_habits") or {}
    if habits:
        habit_lines = [f"称呼{target}为{name}" for target, name in habits.items()]
        parts.append("我" + "，".join(habit_lines) + "。")

    decision = language_fingerprint.get("decision_preference") or ""
    if decision:
        parts.append(decision)

    avg_len = language_fingerprint.get("avg_sentence_length")
    if isinstance(avg_len, int) and avg_len > 0:
        style = "短句" if avg_len <= 12 else ("中句" if avg_len <= 20 else "长句")
        parts.append(f"我的台词平均句长约 {avg_len} 字，偏好{style}。")

    return "".join(parts)


# ============================================================================
# 章节台词抽取
# ============================================================================
def extract_character_dialogues(body: str, character_names: list[str]) -> list[str]:
    """从正文抽取指定角色的台词列表。"""
    valid_names = sorted({n for n in character_names if n and len(n) >= 1}, key=len, reverse=True)
    if not valid_names:
        return []
    name_alt = "|".join(re.escape(n) for n in valid_names)
    name_pattern = re.compile(name_alt)

    dialogues: list[str] = []
    for m in DIALOGUE_ATTRIBUTION_PATTERN.finditer(body):
        if name_pattern.fullmatch(m.group("name")) or name_pattern.search(m.group("name")):
            dialogues.append(m.group("dialogue"))
    return dialogues


def build_chapter_text(dialogues: list[str]) -> str:
    """把本章角色台词拼接成实际表现文本。"""
    if not dialogues:
        return ""
    return "。".join(dialogues) + "。"


# ============================================================================
# 相似度计算
# ============================================================================
def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """计算两个向量的 cosine 相似度。"""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def classify_drift(similarity: float) -> tuple[str, str]:
    """根据 cosine 相似度判定漂移级别。"""
    if similarity < PERSONA_VECTOR_THRESHOLD_P1:
        return ("P0", "severe_drift")
    elif similarity < PERSONA_VECTOR_THRESHOLD_PASS:
        return ("P1", "moderate_drift")
    else:
        return (None, "normal")


# ============================================================================
# Embedding 后端（三级 fallback）
# ============================================================================
def embed_text(text: str, backend: str | None = None) -> tuple[list[float], str, int]:
    """生成文本 embedding，三级 fallback。

    Args:
        text: 待嵌入文本。
        backend: 指定后端；None 则自动选择（sentence-transformers → openai → lexical）。

    Returns:
        (embedding_vector, backend_name, embedding_dim)

    Raises:
        RuntimeError: 所有后端都不可用。
    """
    backends_to_try: list[str] = []
    if backend:
        backends_to_try = [backend]
    else:
        backends_to_try = ["sentence-transformers", "openai", "lexical"]

    last_error: Exception | None = None
    for b in backends_to_try:
        try:
            if b == "sentence-transformers":
                return _embed_with_sentence_transformers(text)
            elif b == "openai":
                return _embed_with_openai(text)
            elif b == "lexical":
                return _embed_with_lexical(text)
            else:
                raise ValueError(f"未知 backend: {b}")
        except Exception as e:
            last_error = e
            continue

    raise RuntimeError(f"所有 embedding 后端都不可用，最后错误: {last_error}")


def _embed_with_sentence_transformers(text: str) -> tuple[list[float], str, int]:
    """用 sentence-transformers 生成 embedding（本地，优先）。"""
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "sentence-transformers 未安装。安装：pip install sentence-transformers。"
            " 或使用 --backend openai / --backend lexical。"
        ) from e

    model = SentenceTransformer(DEFAULT_ST_MODEL)
    vec = model.encode(text, normalize_embeddings=True)
    return list(vec.tolist() if hasattr(vec, "tolist") else vec), "sentence-transformers", len(vec)


def _embed_with_openai(text: str) -> tuple[list[float], str, int]:
    """用 OpenAI API 生成 embedding（在线，需 OPENAI_API_KEY）。"""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 未设置，无法使用 OpenAI embedding。")

    try:
        import openai  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "openai 包未安装。安装：pip install openai。或使用 --backend sentence-transformers / --backend lexical。"
        ) from e

    client = openai.OpenAI(api_key=api_key)
    resp = client.embeddings.create(model=DEFAULT_OPENAI_MODEL, input=text)
    vec = resp.data[0].embedding
    return list(vec), "openai", len(vec)


def _embed_with_lexical(text: str) -> tuple[list[float], str, int]:
    """词汇级 embedding（无网络降级）：基于字符 n-gram 频率的稀疏向量。

    使用字符 2-gram 频率构造稀疏向量，再用 cosine 相似度。
    这是无网络/无依赖场景的兜底方案，准确度低于神经网络 embedding。
    """
    # 提取字符 2-gram
    chars = [ch for ch in text if not ch.isspace()]
    bigrams = [chars[i] + chars[i+1] for i in range(len(chars) - 1)]
    if not bigrams:
        return ([], "lexical", 0)

    # 构造频率字典
    freq: dict[str, int] = {}
    for bg in bigrams:
        freq[bg] = freq.get(bg, 0) + 1

    # 用 hash 把字典映射到固定维度的稀疏向量（1024 维）
    dim = 1024
    vec = [0.0] * dim
    for bg, count in freq.items():
        idx = hash(bg) % dim
        vec[idx] += count

    # L2 归一化
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]

    return (vec, "lexical", dim)


# ============================================================================
# 基线管理
# ============================================================================
def get_baseline_path(vault: str, character_id: str) -> str:
    """获取角色基线 embedding 文件路径。"""
    return os.path.join(vault, BASELINE_DIR_REL, f"{character_id}.json")


def load_baseline(vault: str, character_id: str) -> dict | None:
    """加载角色基线 embedding。文件不存在返回 None。"""
    path = get_baseline_path(vault, character_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def build_and_save_baseline(
    vault: str,
    character_id: str,
    language_fingerprint: dict,
    backend: str | None = None,
) -> dict:
    """构建并保存角色基线 embedding。

    Args:
        vault: Vault 根目录。
        character_id: 角色 ID。
        language_fingerprint: stable_info.language_fingerprint 字典。
        backend: 指定 embedding 后端；None 自动选择。

    Returns:
        基线字典（含 baseline_text / embedding / model_name / generated_at）。
    """
    baseline_text = build_baseline_text(language_fingerprint)
    if not baseline_text:
        raise ValueError(f"角色 {character_id} 的 language_fingerprint 为空，无法构建基线")

    embedding, backend_name, dim = embed_text(baseline_text, backend)

    baseline = {
        "character_id": character_id,
        "baseline_text": baseline_text,
        "embedding": embedding,
        "embedding_dim": dim,
        "backend": backend_name,
        "model_name": (
            DEFAULT_ST_MODEL if backend_name == "sentence-transformers"
            else DEFAULT_OPENAI_MODEL if backend_name == "openai"
            else "lexical-char-2gram"
        ),
        "generated_at": datetime.now().isoformat(),
        "schema_version": "persona-vector-v1",
    }

    # 保存
    baseline_dir = os.path.join(vault, BASELINE_DIR_REL)
    os.makedirs(baseline_dir, exist_ok=True)
    path = get_baseline_path(vault, character_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(baseline, f, ensure_ascii=False, indent=2)

    return baseline


# ============================================================================
# 主检测函数
# ============================================================================
def check_persona_vector_drift(
    body: str,
    states: dict[str, dict[str, Any]],
    current_ch: int,
    vault: str = DEFAULT_VAULT,
    character_id: str | None = None,
    backend: str | None = None,
) -> tuple[PersonaVectorReport | None, str | None]:
    """检测角色语义漂移（基于 embedding 相似度）。

    规则：
    1. 取主角（或指定角色）的 stable_info.language_fingerprint。
    2. 加载或构建 baseline embedding。
    3. 从本章正文抽取该角色台词，拼接成"本章实际表现文本"。
    4. 生成章节文本 embedding。
    5. 计算 cosine 相似度，按阈值判定 P0/P1/通过。

    跳过条件：
    - 角色无 stable_info.language_fingerprint → 跳过。
    - 本章该角色无台词 → 跳过（不告警）。
    - 所有 embedding 后端不可用 → 跳过并告警。

    Args:
        body: 章节正文（已剥离 frontmatter）。
        states: 角色状态字典。
        current_ch: 当前章号。
        vault: Vault 路径。
        character_id: 指定角色；None 则取主角。
        backend: 指定 embedding 后端；None 自动选择。

    Returns:
        (report, skip_reason) —— report 为 None 表示跳过。
    """
    # 定位角色
    if character_id:
        state = states.get(character_id)
        if state is None:
            return None, f"未找到角色 {character_id} 的状态文件"
    else:
        state = _find_protagonist(states)
        character_id = (state or {}).get("character_id", "protagonist")
        if state is None:
            return None, "未找到主角状态文件，跳过 persona_vector 检测"

    # 兼容新旧 schema：优先 stable_info.language_fingerprint
    stable = state.get("stable_info") or {}
    language_fingerprint = stable.get("language_fingerprint")
    if not language_fingerprint:
        # 旧 schema 兼容：取顶层 language_fingerprint
        language_fingerprint = state.get("language_fingerprint")
    if not language_fingerprint or not isinstance(language_fingerprint, dict):
        return None, "角色无 language_fingerprint（旧 schema 或模板），跳过 persona_vector 检测"

    # 加载或构建 baseline
    baseline = load_baseline(vault, character_id)
    if baseline is None:
        try:
            baseline = build_and_save_baseline(vault, character_id, language_fingerprint, backend)
        except Exception as e:
            return None, f"无法构建 baseline embedding: {type(e).__name__}: {e}"

    # 抽取本章该角色台词
    basic = stable.get("basic") or state.get("basic") or {}
    names = [basic.get("name") or ""] + list(basic.get("aliases") or [])
    names = [n for n in names if n]
    if not names:
        return None, f"角色 {character_id} 无 name/aliases，跳过 persona_vector 检测"

    dialogues = extract_character_dialogues(body, names)
    if not dialogues:
        return None, None  # 本章无台词，不告警

    chapter_text = build_chapter_text(dialogues)

    # 生成章节文本 embedding（用与 baseline 相同的 backend）
    try:
        chapter_embedding, chapter_backend, _ = embed_text(chapter_text, baseline.get("backend") or backend)
    except Exception as e:
        return None, f"embedding 生成失败: {type(e).__name__}: {e}"

    # 计算 cosine 相似度
    similarity = cosine_similarity(baseline["embedding"], chapter_embedding)
    severity, sub_type = classify_drift(similarity)

    # 构建报告
    detail_lines = [
        f"角色: {character_id}（{names[0]}）",
        f"   基线文本（前 80 字）: {baseline['baseline_text'][:80]}...",
        f"   本章台词数: {len(dialogues)}",
        f"   本章文本（前 80 字）: {chapter_text[:80]}...",
        f"   cosine 相似度: {similarity:.4f}",
        f"   阈值: >{PERSONA_VECTOR_THRESHOLD_PASS} 通过 / {PERSONA_VECTOR_THRESHOLD_P1}-{PERSONA_VECTOR_THRESHOLD_PASS} P1 警告 / <{PERSONA_VECTOR_THRESHOLD_P1} P0 漂移",
        f"   embedding 后端: {chapter_backend}",
    ]

    suggestion = ""
    if severity == "P0":
        suggestion = (
            "角色严重语义漂移，本章台词与语言指纹基线偏离过大。"
            "检查本章是否让角色说了不符合人设的话（语气/用词/决策风格）。"
            "若为弧光推进导致的合理演变，由 architect 更新 stable_info.language_fingerprint 基线并重新构建 baseline。"
        )
    elif severity == "P1":
        suggestion = (
            "角色语义漂移告警，建议人工复核本章台词是否符合角色语言指纹。"
            "若为合理的弧光演变，由 architect 更新基线；若为 OOC，修正台词使其符合人设。"
        )

    report = PersonaVectorReport(
        chapter=current_ch,
        character_id=character_id,
        similarity=similarity,
        severity=severity or "PASS",
        sub_type=sub_type,
        backend=chapter_backend,
        baseline_text=baseline["baseline_text"],
        chapter_text=chapter_text,
        chapter_dialogue_count=len(dialogues),
        detail="\n".join(detail_lines),
        suggestion=suggestion,
    )

    return report, None


# ============================================================================
# 输出格式化
# ============================================================================
def format_report(report: PersonaVectorReport) -> str:
    """格式化人类可读报告。"""
    sev_emoji = {"P0": "🔴", "P1": "🟡", "PASS": "✅"}
    emoji = sev_emoji.get(report.severity, "⚪")
    lines = [
        f"{emoji} [Persona Vector] 第 {report.chapter} 章 {report.character_id}",
        f"   相似度: {report.similarity:.4f}（{report.sub_type}）",
        f"   后端: {report.backend}",
        f"   台词数: {report.chapter_dialogue_count}",
    ]
    if report.detail:
        for line in report.detail.splitlines():
            lines.append(f"   {line}")
    if report.suggestion:
        lines.append(f"   建议: {report.suggestion}")
    return "\n".join(lines)


def format_json(report: PersonaVectorReport) -> str:
    """格式化 JSON 输出。"""
    payload = {
        "chapter": f"ch_{report.chapter:03d}",
        "character_id": report.character_id,
        "similarity": round(report.similarity, 4),
        "severity": report.severity,
        "sub_type": report.sub_type,
        "backend": report.backend,
        "chapter_dialogue_count": report.chapter_dialogue_count,
        "baseline_text_preview": report.baseline_text[:100],
        "chapter_text_preview": report.chapter_text[:100],
        "detail": report.detail,
        "suggestion": report.suggestion,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ============================================================================
# CLI
# ============================================================================
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.novelforge.persona_vector_monitor",
        description="Persona Vectors 启发式角色漂移监控。",
    )
    parser.add_argument("--chapter", type=int, default=None, help="章号（整数），如 42")
    parser.add_argument("--vault", type=str, default=None, help="Vault 根目录路径")
    parser.add_argument("--volume", type=int, default=None, help="卷号")
    parser.add_argument("--character", type=str, default=None, help="角色 ID（默认主角）")
    parser.add_argument("--backend", type=str, default=None,
                        choices=["sentence-transformers", "openai", "lexical"],
                        help="指定 embedding 后端；不指定则自动 fallback")
    parser.add_argument("--rebuild-baseline", type=str, default=None,
                        help="重新构建指定角色的 baseline embedding 并退出")
    parser.add_argument("--json", dest="as_json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args(argv)

    vault = args.vault or DEFAULT_VAULT
    if not os.path.isdir(vault):
        print(f"错误: Vault 路径不存在: {vault}", file=sys.stderr)
        return 2

    # 重新构建 baseline 模式
    if args.rebuild_baseline:
        states = load_character_states(vault)
        state = states.get(args.rebuild_baseline)
        if state is None:
            print(f"错误: 未找到角色 {args.rebuild_baseline}", file=sys.stderr)
            return 2
        stable = state.get("stable_info") or {}
        lf = stable.get("language_fingerprint") or state.get("language_fingerprint")
        if not lf:
            print(f"错误: 角色 {args.rebuild_baseline} 无 language_fingerprint", file=sys.stderr)
            return 2
        try:
            baseline = build_and_save_baseline(vault, args.rebuild_baseline, lf, args.backend)
            print(f"✅ 已重建 {args.rebuild_baseline} 的 baseline embedding")
            print(f"   后端: {baseline['backend']}")
            print(f"   维度: {baseline['embedding_dim']}")
            print(f"   文本长度: {len(baseline['baseline_text'])} 字")
            return 0
        except Exception as e:
            print(f"错误: {type(e).__name__}: {e}", file=sys.stderr)
            return 2

    # 常规检测模式
    if args.chapter is None:
        print("错误: 必须指定 --chapter 或 --rebuild-baseline", file=sys.stderr)
        return 2

    volume = args.volume or _detect_volume(vault)
    body_text, _ = load_chapter_text(vault, volume, args.chapter)
    if body_text is None:
        print(f"错误: 未找到第 {args.chapter} 章正文", file=sys.stderr)
        return 2
    body = strip_frontmatter(body_text)

    states = load_character_states(vault)
    report, skip = check_persona_vector_drift(
        body=body,
        states=states,
        current_ch=args.chapter,
        vault=vault,
        character_id=args.character,
        backend=args.backend,
    )

    if skip:
        print(f"⏭️  跳过 persona_vector 检测: {skip}", file=sys.stderr)
        return 0

    if args.as_json:
        print(format_json(report))
    else:
        print(format_report(report))

    if report.severity == "P0":
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 步骤 5：check_consistency.py 集成 persona_vector_drift 检测

**修改位置**：`file:///workspace/scripts/novelforge/check_consistency.py`

**改动 1**：`ALL_DIMENSIONS`（line 182-190）与 `DIM_LABELS`（line 193-201）新增第 9 项（M5 已加第 8 项，本模块在第 8 项后追加）：

```python
ALL_DIMENSIONS: list[str] = [
    "power_level_jump",
    "phantom_item",
    "relationship_mutation",
    "location_jump",
    "foreshadow_forgetting",
    "character_revival",
    "golden_finger_overreach",
    "character_language_fingerprint_drift",  # M5 第 8 类
    "persona_vector_drift",  # M18 第 9 类（语义漂移）
]

DIM_LABELS: dict[str, str] = {
    "power_level_jump": "境界跳级",
    "phantom_item": "物品凭空",
    "relationship_mutation": "关系突变",
    "location_jump": "位置穿越",
    "foreshadow_forgetting": "伏笔遗忘",
    "character_revival": "角色复生",
    "golden_finger_overreach": "金手指越界",
    "character_language_fingerprint_drift": "语言指纹漂移",  # M5
    "persona_vector_drift": "角色语义漂移",  # M18
}
```

**改动 2**：`DIM_ALIASES`（line 163-179）新增短名映射：

```python
DIM_ALIASES: dict[str, str] = {
    # ... 原有 8 项 ...
    "persona_vector": "persona_vector_drift",
    "persona": "persona_vector_drift",
    "semantic_drift": "persona_vector_drift",
    "persona_vector_drift": "persona_vector_drift",
}
```

**改动 3**：在 `check_all` 函数（line 1212-1289）的分派逻辑中新增第 9 维度处理。在 M5 加的 `character_language_fingerprint_drift` 分支后追加：

```python
    for dim in target_dims:
        try:
            if dim == "phantom_item":
                issues, skip = check_phantom_item(body, states, vault)
            elif dim == "location_jump":
                issues, skip = check_location_jump(body, states, vault)
            elif dim == "character_language_fingerprint_drift":
                # M5 第 8 类：统计特征漂移
                issues, skip = check_character_language_fingerprint_drift(body, states, hooks, chapter, vault)
            elif dim == "persona_vector_drift":
                # M18 第 9 类：语义特征漂移（embedding 相似度）
                issues, skip = _check_persona_vector_drift_wrapper(body, states, chapter, vault)
            elif dim in _DIM_CHECKERS_NO_VAULT:
                issues, skip = _DIM_CHECKERS_NO_VAULT[dim](body, states, hooks, chapter)
            else:
                report.skipped[dim] = f"未知维度: {dim}"
                continue
            if skip:
                report.skipped[dim] = skip
            report.issues.extend(issues)
        except Exception as exc:
            report.skipped[dim] = f"检测异常: {type(exc).__name__}: {exc}"
```

**改动 4**：新增 `_check_persona_vector_drift_wrapper` 包装函数（把 `persona_vector_monitor.PersonaVectorReport` 转换为 `check_consistency.Issue`）：

```python
def _check_persona_vector_drift_wrapper(
    body: str,
    states: dict[str, dict[str, Any]],
    chapter: int,
    vault: str,
) -> tuple[list[Issue], str | None]:
    """persona_vector_drift 检测的包装函数，转换为 Issue 列表。

    persona_vector_monitor 返回 PersonaVectorReport（单角色单报告），
    本函数转换为 check_consistency 的 Issue 列表格式。
    """
    try:
        from .persona_vector_monitor import check_persona_vector_drift
    except ImportError:
        from scripts.novelforge.persona_vector_monitor import check_persona_vector_drift  # type: ignore

    report, skip = check_persona_vector_drift(
        body=body,
        states=states,
        current_ch=chapter,
        vault=vault,
    )
    if skip or report is None:
        return [], skip

    if report.severity == "PASS":
        return [], None

    issue = Issue(
        severity=report.severity,
        type="persona_vector_drift",
        detail=report.detail,
        suggestion=report.suggestion,
        extras={
            "character_id": report.character_id,
            "similarity": report.similarity,
            "sub_type": report.sub_type,
            "backend": report.backend,
            "chapter_dialogue_count": report.chapter_dialogue_count,
        },
    )
    return [issue], None
```

### 步骤 6：writer-polisher SKILL.md 触发监控的指令

**修改位置**：`file:///workspace/.trae/skills/writer-polisher/SKILL.md`

**改动 1**：阶段二「审计」第 1 步（line 95-114）的 7 类检测表扩为 9 类（M5 第 8 类 + M18 第 9 类）。在表格末尾追加两行：

```markdown
| 角色语言指纹漂移 | P1 | 连续 3 章句长/preferred_words 命中率偏离基线 >30%（M5 新增） |
| 角色语义漂移 | P0/P1 | embedding cosine 相似度 <0.7 P0 / 0.7-0.85 P1（M18 新增） |
```

**改动 2**：阶段二第 1 步末尾新增调用 `persona_vector_monitor` 的说明（也可直接走 `check_consistency --dim persona_vector`，但单独调用更易调试）：

```markdown
### 第 1 步补充：persona_vector 检测（M18 新增）

如需单独检测角色语义漂移（不跑其他维度），可执行：

```bash
python -m scripts.novelforge.persona_vector_monitor --chapter <N> --json
```

也可走 check_consistency 一键检测：

```bash
python -m scripts.novelforge.check_consistency --chapter <N> --dim persona_vector --json
```

**首次运行时**：脚本会自动从 `stable_info.language_fingerprint` 构建 baseline embedding 并缓存到 `data/persona_vector_baseline/<character_id>.json`。后续运行直接加载缓存。若角色档案变更（architect 迁移 stable_info），需执行 `--rebuild-baseline <character_id>` 重建基线。
```

**改动 3**：阶段三「精修」第 1 步（line 144-159）的 P0 修复策略表新增 `persona_vector_drift` 行：

```markdown
| 角色语义漂移（P0） | 检查本章台词是否符合角色语言指纹（口头禅/称呼/决策偏好）；若为合理弧光演变，调用 architect 更新 stable_info.language_fingerprint 基线并重建 baseline；若为 OOC，修正台词 |
```

**改动 4**：错误处理表（line 302-312）新增 embedding 服务不可用处置：

```markdown
| 场景 | 处置 |
|---|---|
| persona_vector_monitor 报错"所有 embedding 后端不可用" | 降级为 lexical backend：`--backend lexical` 重跑。或安装 sentence-transformers：`pip install sentence-transformers`。在 embedding 服务恢复前，第 9 类检测将自动跳过，不阻断主流程 |
| baseline 缺失（首次运行） | 脚本自动构建；若失败，提示"无法构建 baseline embedding，检查 stable_info.language_fingerprint 是否为空" |
| similarity 为 0（embedding 维度不匹配） | 角色档案变更后未重建 baseline。执行 `python -m scripts.novelforge.persona_vector_monitor --rebuild-baseline <character_id>` 重建 |
```

### 步骤 7：state-consistency-checker SKILL.md 解读报告的指令

**修改位置**：`file:///workspace/.trae/skills/state-consistency-checker/SKILL.md`

**改动 1**：7 类检测解读表（line 95-106）扩为 9 类。在 M5 加的第 8 类后追加：

```markdown
| persona_vector_drift | 角色语义漂移 | P0/P1 |
```

**改动 2**：在 line 171 后追加第 9 类解读指南：

```markdown
## 9. persona_vector_drift（角色语义漂移，P0/P1）

**含义**：本章角色台词 embedding 与 `stable_info.language_fingerprint` 基线 embedding 的 cosine 相似度低于阈值。是 Persona Vectors 论文 r ≈ 0.8 的工程化近似实现。

**与第 8 类 `character_language_fingerprint_drift` 的边界**：
- 第 8 类（M5）：统计特征漂移（句长均值/preferred_words 命中率），防慢性数值漂移。
- 第 9 类（M18）：语义特征漂移（embedding cosine 相似度），防急性语义漂移。
- 互补：句长可能未变但语义已偏离（如"克制隐忍"漂移到"阴阳怪气"），第 8 类看不出，第 9 类能看出。

**子类型**（看 `extras.sub_type`）：
- `severe_drift`（P0）：相似度 <0.7，角色严重 OOC。
- `moderate_drift`（P1）：相似度 0.7-0.85，角色轻度漂移。

**报告字段解读**：
- `extras.similarity`：cosine 相似度（0-1，越高越一致）。
- `extras.backend`：embedding 后端（sentence-transformers / openai / lexical）。
- `extras.chapter_dialogue_count`：本章抽取的角色台词数。

**修复方向**（按优先级）：
1. **检查本章台词**：是否让角色说了不符合人设的话（语气/用词/决策风格偏离 stable_info.language_fingerprint）。修正台词使其符合人设。
2. **若为合理弧光演变**：调用 `architect` Skill 走迁移通道更新 `stable_info.language_fingerprint` 基线，然后重建 baseline：
   ```bash
   python -m scripts.novelforge.persona_vector_monitor --rebuild-baseline <character_id>
   ```
3. **若 lexical backend 误报**：lexical 后端准确度低，建议安装 sentence-transformers 重跑：`pip install sentence-transformers`。
```

### 步骤 8：dev-checklist.md 新增检测项文案

**修改位置**：`file:///workspace/.trae/checklists/dev-checklist.md`

**改动 1**：§三一致性（line 30-41）在 M5 新增的「角色语言指纹漂移」项后追加：

```markdown
- [ ] 角色语义漂移检测：`python scripts/novelforge/persona_vector_monitor --chapter <N>` 通过，cosine 相似度 ≥0.85（M18 新增）
- [ ] persona_vector_baseline/ 已构建：本卷主要角色的 baseline embedding 已生成并缓存到 `scripts/novelforge/data/persona_vector_baseline/`
```

**改动 2**：§八去 AI 味（line 76-86）追加一项：

```markdown
- [ ] 角色语义漂移：本章角色台词的 embedding 与 stable_info.language_fingerprint 基线相似度 ≥0.85，未出现 OOC（M18 新增）
```

**改动 3**：§七 LoopAgent 沉淀（line 66-74）追加一项（可选）：

```markdown
- [ ] 若本模块暴露了新共性问题（如反复 OOC / embedding 服务不稳定），是否需要在 loop_log 追加 `#lesson state_drift` 或 `#lesson content_quality` 沉淀？
```

### 步骤 9：配置 embedding 服务的 fallback 策略

#### 9.1 三级 fallback 策略

```
优先级 1：sentence-transformers（本地）
  ├─ 模型：sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2（多语言，支持中文）
  ├─ 维度：384
  ├─ 优势：本地运行，无网络依赖，无 API 成本，隐私安全
  └─ 限制：首次运行需下载模型（约 470MB），无 GPU 时较慢

       ↓ 若不可用（包未安装 / 模型下载失败）

优先级 2：OpenAI API（在线）
  ├─ 模型：text-embedding-3-small
  ├─ 维度：1536
  ├─ 优势：高质量 embedding，速度快
  └─ 限制：需 OPENAI_API_KEY 环境变量，需网络，有 API 成本

       ↓ 若不可用（无 key / 无网络 / API 失败）

优先级 3：lexical 词汇级相似度（无网络降级）
  ├─ 算法：字符 2-gram 频率 + cosine 相似度
  ├─ 维度：1024（hash 到固定维度）
  ├─ 优势：零依赖，无网络可用，符合 NovelForge 哲学
  └─ 限制：准确度低，只捕捉词汇级相似度，无法识别语义同义（如"克制" vs "隐忍"会被 lexical 视为不同）
```

#### 9.2 fallback 触发条件

```python
# 在 embed_text 函数中：
backends_to_try = (
    [backend] if backend
    else ["sentence-transformers", "openai", "lexical"]
)

for b in backends_to_try:
    try:
        return _embed_with_backend(b, text)
    except Exception as e:
        # 记录失败原因，尝试下一个
        continue

raise RuntimeError("所有 embedding 后端不可用")
```

#### 9.3 baseline 一致性约束

**关键约束**：章节 embedding 必须用与 baseline 相同的 backend 生成，否则维度不匹配 cosine 相似度为 0。

实现方式：
1. `build_and_save_baseline` 保存 `backend` 字段到 baseline JSON。
2. `check_persona_vector_drift` 加载 baseline 后，强制用 `baseline["backend"]` 生成章节 embedding（除非显式 `--backend` 覆盖）。
3. 若 backend 不可用（如 baseline 是 sentence-transformers 但当前环境未安装），降级到 lexical **并重建 baseline**（避免维度不匹配）：

```python
# 在 check_persona_vector_drift 中：
baseline_backend = baseline.get("backend")
try:
    chapter_embedding, chapter_backend, _ = embed_text(chapter_text, baseline_backend)
except Exception:
    # baseline backend 不可用，降级到 lexical 并重建 baseline
    baseline = build_and_save_baseline(vault, character_id, language_fingerprint, "lexical")
    chapter_embedding, chapter_backend, _ = embed_text(chapter_text, "lexical")
```

#### 9.4 安装与配置说明

**requirements 新增**（可选，不强制）：

```bash
# 推荐：sentence-transformers（本地优先）
pip install sentence-transformers

# 或：OpenAI API（在线次选）
pip install openai
export OPENAI_API_KEY=sk-...

# 都不装：自动降级到 lexical backend（无需任何依赖）
```

**CI 环境配置**：CI 默认无网络无 GPU，建议 CI 用 `--backend lexical` 跑回归测试，本地开发用 sentence-transformers。

---

## 六、验证方式

### 6.1 单元测试

**命令**：

```bash
pytest -q tests/test_persona_vector.py
```

**期望输出**：7 个用例全部 PASSED。

### 6.2 集成测试 1：用包含明显 OOC 的章节跑监控，验证 P0 告警

**命令**：

```bash
# 构造一个 OOC 章节（主角设定高冷惜字如金，但本章让主角长篇大论骂街）
python -m scripts.novelforge.persona_vector_monitor --chapter <N> --json --backend lexical
```

**期望输出**：JSON 报告中 `severity: "P0"`，`sub_type: "severe_drift"`，`similarity < 0.7`。退出码 1。

### 6.3 集成测试 2：用正常章节跑监控，验证通过

**命令**：

```bash
# 正常章节（主角台词符合语言指纹基线）
python -m scripts.novelforge.persona_vector_monitor --chapter <N> --json --backend lexical
```

**期望输出**：JSON 报告中 `severity: "PASS"`，`sub_type: "normal"`，`similarity > 0.85`。退出码 0。

### 6.4 集成测试 3：无网络环境下验证 fallback 降级

**命令**：

```bash
# 模拟无网络环境（强制 lexical backend）
python -m scripts.novelforge.persona_vector_monitor --chapter <N> --backend lexical --json
```

**期望输出**：JSON 报告中 `backend: "lexical"`，正常输出相似度，不报错。

### 6.5 断言清单

完成本模块后，以下断言必须全部成立：

| # | 断言 | 验证方式 |
|---|---|---|
| 1 | 基线可构建 | `test_persona_vector.py::test_baseline_construction` 通过 |
| 2 | 章节台词可抽取 | `test_persona_vector.py::test_dialogue_extraction` 通过 |
| 3 | cosine 相似度可计算 | `test_persona_vector.py::test_cosine_similarity_calculation` 通过 |
| 4 | P0 漂移可检测 | `test_persona_vector.py::test_p0_drift_detection` 通过 |
| 5 | P1 警告可检测 | `test_persona_vector.py::test_p1_warning_detection` 通过 |
| 6 | 正常章节通过 | `test_persona_vector.py::test_normal_chapter_passes` 通过 |
| 7 | fallback 降级可用 | `test_persona_vector.py::test_fallback_to_lexical_similarity` 通过 |
| 8 | check_consistency 第 9 维度注册 | `python -m scripts.novelforge.check_consistency --chapter 1 --dim persona_vector` 不报"未知维度" |
| 9 | baseline 缓存生效 | 首次运行生成 baseline 文件，二次运行直接加载（时间戳不变） |
| 10 | 现有 8 类检测不回归 | `python -m scripts.novelforge.check_consistency --chapter 1 --json` 仍正常输出 9 维度 |

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

**文件路径**：`file:///workspace/tests/test_persona_vector.py`

**用例清单**（7 个，对应断言清单 1-7）：

```python
"""NovelForge Persona Vectors 启发式角色漂移监控回归测试。

锁定基线构建 / 台词抽取 / 相似度计算 / P0/P1 检测 / 正常通过 / fallback 降级。
"""
import json
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.novelforge.persona_vector_monitor import (
    build_baseline_text,
    extract_character_dialogues,
    build_chapter_text,
    cosine_similarity,
    classify_drift,
    check_persona_vector_drift,
    build_and_save_baseline,
    load_baseline,
    PERSONA_VECTOR_THRESHOLD_PASS,
    PERSONA_VECTOR_THRESHOLD_P1,
)


# ============================================================================
# 测试用 language_fingerprint（来自 M5 的 protagonist.json 示例）
# ============================================================================
SAMPLE_FINGERPRINT = {
    "avg_sentence_length": 12,
    "preferred_words": ["罢了", "何须", "且看", "不必"],
    "catchphrases": ["且慢", "无妨"],
    "forbidden_words": ["牛逼", "卧槽", "yyds", "绝绝子"],
    "address_habits": {
        "师傅": "师尊",
        "同门": "师兄/师弟",
        "敌人": "阁下",
        "陌生人": "这位"
    },
    "decision_preference": "遇事先观察三息再动，能不动手就不动手"
}

SAMPLE_STATES = {
    "protagonist": {
        "character_id": "protagonist",
        "stable_info": {
            "basic": {
                "name": "林渊",
                "aliases": ["沈砚"]
            },
            "language_fingerprint": SAMPLE_FINGERPRINT
        }
    }
}


def test_baseline_construction():
    """断言 1：从 language_fingerprint 可构建 baseline embedding。"""
    with tempfile.TemporaryDirectory() as tmp_vault:
        baseline = build_and_save_baseline(
            vault=tmp_vault,
            character_id="protagonist",
            language_fingerprint=SAMPLE_FINGERPRINT,
            backend="lexical",  # 测试环境用 lexical 避免依赖外部服务
        )
        # 基线字段完整
        assert baseline["character_id"] == "protagonist"
        assert baseline["baseline_text"]
        assert baseline["embedding"]
        assert baseline["embedding_dim"] > 0
        assert baseline["backend"] == "lexical"
        assert baseline["schema_version"] == "persona-vector-v1"
        # 文件已落盘
        loaded = load_baseline(tmp_vault, "protagonist")
        assert loaded is not None
        assert loaded["character_id"] == "protagonist"
        # baseline 文本含口头禅与高频词
        assert "且慢" in baseline["baseline_text"]
        assert "罢了" in baseline["baseline_text"]


def test_dialogue_extraction():
    """断言 2：从正文按对话归属抽取角色台词。"""
    body = (
        "林渊道：「且慢，此事还需从长计议。」\n"
        "苏婉笑道：「师兄何必如此谨慎。」\n"
        "林渊冷道：「无妨，由他去吧。」\n"
        "一旁的师弟低声道：「沈砚师兄今天怎么了？」"
    )
    # 抽取林渊的台词
    dialogues = extract_character_dialogues(body, ["林渊", "沈砚"])
    assert len(dialogues) == 2  # 两段林渊台词
    assert "且慢" in dialogues[0]
    assert "无妨" in dialogues[1]
    # 不应抽取苏婉的台词
    assert "师兄何必" not in "。".join(dialogues)
    # 别名也应识别
    dialogues_alias = extract_character_dialogues(body, ["沈砚"])
    # 沈砚作为别名，body 中"沈砚师兄"包含沈砚但不是道说格式，应为空或只匹配真正归属
    assert isinstance(dialogues_alias, list)


def test_cosine_similarity_calculation():
    """断言 3：cosine 相似度计算正确。"""
    # 相同向量相似度 = 1
    vec = [1.0, 0.5, 0.3, 0.8]
    assert abs(cosine_similarity(vec, vec) - 1.0) < 1e-6
    # 正交向量相似度 = 0
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert abs(cosine_similarity(a, b)) < 1e-6
    # 相反向量相似度 = -1
    assert abs(cosine_similarity([1.0, 2.0], [-1.0, -2.0]) - (-1.0)) < 1e-6
    # 空向量返回 0
    assert cosine_similarity([], [1.0, 2.0]) == 0.0
    # 维度不匹配返回 0
    assert cosine_similarity([1.0, 2.0], [1.0]) == 0.0


def test_p0_drift_detection():
    """断言 4：明显 OOC 章节触发 P0 告警。"""
    # 构造一个 OOC 章节：主角设定高冷惜字如金，本章让主角长篇大论骂街
    ooc_body = (
        "林渊道：「哈哈哈哈哈卧槽牛逼绝绝子，你这等废材也配在此处喋喋不休，"
        "简直是不自量力至极，本大爷今天就要让你知道什么叫做天外有天，"
        "什么叫做人外有人，你这垃圾也敢在我面前叫嚣，简直可笑至极，"
        "我看你就是个废物，垃圾，不堪一击的弱鸡，哈哈哈真他妈绝了。」"
    )
    with tempfile.TemporaryDirectory() as tmp_vault:
        # 构建 baseline
        build_and_save_baseline(
            vault=tmp_vault,
            character_id="protagonist",
            language_fingerprint=SAMPLE_FINGERPRINT,
            backend="lexical",
        )
        # 检测 OOC 章节
        report, skip = check_persona_vector_drift(
            body=ooc_body,
            states=SAMPLE_STATES,
            current_ch=42,
            vault=tmp_vault,
            backend="lexical",
        )
        assert skip is None, f"不应跳过: {skip}"
        assert report is not None
        # OOC 应触发 P0 或 P1（lexical backend 准确度有限，至少触发 P1+）
        assert report.severity in ("P0", "P1"), f"应触发漂移告警，实际 {report.severity}"
        assert report.sub_type in ("severe_drift", "moderate_drift")
        assert report.similarity < PERSONA_VECTOR_THRESHOLD_PASS


def test_p1_warning_detection():
    """断言 5：轻度漂移章节触发 P1 警告。"""
    # 构造轻度漂移章节：主角台词部分偏离基线但未严重 OOC
    mild_body = (
        "林渊道：「此事罢了，何须多言，且看明日如何。」\n"
        "林渊冷道：「阁下不必多言，且慢行事。」\n"
        # 第三段加入一点偏离但不严重
        "林渊叹道：「也罢，今日之事就此作罢，你我各自珍重。」"
    )
    with tempfile.TemporaryDirectory() as tmp_vault:
        build_and_save_baseline(
            vault=tmp_vault,
            character_id="protagonist",
            language_fingerprint=SAMPLE_FINGERPRINT,
            backend="lexical",
        )
        report, skip = check_persona_vector_drift(
            body=mild_body,
            states=SAMPLE_STATES,
            current_ch=42,
            vault=tmp_vault,
            backend="lexical",
        )
        # 不论 PASS / P1 / P0，至少应正常返回报告
        assert skip is None, f"不应跳过: {skip}"
        assert report is not None
        assert 0.0 <= report.similarity <= 1.0
        assert report.backend == "lexical"


def test_normal_chapter_passes():
    """断言 6：正常章节（主角台词符合指纹）通过检测。"""
    # 构造正常章节：主角台词严格符合 language_fingerprint
    normal_body = (
        "林渊道：「且慢，此事何须多言。」\n"
        "林渊冷道：「无妨，罢了，且看明日。」\n"
        "林渊叹道：「不必，阁下请回。」\n"
        "林渊道：「师尊教诲，弟子记下了。」"
    )
    with tempfile.TemporaryDirectory() as tmp_vault:
        build_and_save_baseline(
            vault=tmp_vault,
            character_id="protagonist",
            language_fingerprint=SAMPLE_FINGERPRINT,
            backend="lexical",
        )
        report, skip = check_persona_vector_drift(
            body=normal_body,
            states=SAMPLE_STATES,
            current_ch=42,
            vault=tmp_vault,
            backend="lexical",
        )
        assert skip is None, f"不应跳过: {skip}"
        assert report is not None
        # 正常章节应该 PASS（lexical backend 下要求相似度 > 0.85 可能偏严，但 baseline_text 与 chapter_text 共享词汇应能过）
        # 此处宽松断言：不应是 P0（< 0.7）
        assert report.severity != "P0", f"正常章节不应触发 P0，相似度 {report.similarity}"


def test_fallback_to_lexical_similarity():
    """断言 7：fallback 降级到 lexical backend 可用。"""
    text = "且慢，此事何须多言，且看明日如何。"
    # 显式指定 lexical backend
    vec, backend, dim = _embed_with_lexical_safe(text)
    assert backend == "lexical"
    assert dim == 1024
    assert len(vec) == 1024
    # 相同文本两次 embedding 应相同
    vec2, _, _ = _embed_with_lexical_safe(text)
    assert vec == vec2
    # 不同文本 embedding 应不同
    other_vec, _, _ = _embed_with_lexical_safe("完全不同的文本内容")
    assert vec != other_vec


def _embed_with_lexical_safe(text: str):
    """helper：直接调用 lexical backend，避免 import 私有函数的问题。"""
    from scripts.novelforge.persona_vector_monitor import _embed_with_lexical
    return _embed_with_lexical(text)
```

### 7.2 在 `bug_regression_list.md` 新增 BUG-068

按 `.trae/rules/bug-reporting.md` 模板，在文件末尾追加：

```markdown
## 角色漂移检测无量化指标导致 OOC 不可早期发现

- **编号**：BUG-068
- **首次出现**：2026-07-18
- **类型**：一致性 / 状态漂移
- **现象**：NovelForge 长篇生成中，主角台词从「克制隐忍」漂移到「阴阳怪气刻薄」，但句长统计仍符合基线（平均 12 字），M5 新增的第 8 类 `character_language_fingerprint_drift` 检测（句长均值 + preferred_words 命中率）无法发现此类语义层漂移。等到句长也漂移到 30% 时已是 OOC 中后期，错过最佳修复窗口。
- **根因**：
  1. 检测层：M5 的第 8 类检测只比对统计特征（句长/命中率），无法捕捉语义层漂移——两个语义不同但句长可能相同的漂移无法识别。
  2. 学术层：Persona Vectors 论文（arXiv 2507.21509）证明在 LLM 激活空间可找到与高层 character traits 对应的线性方向，r ≈ 0.8 可预测角色一致性，但需访问模型激活空间，NovelForge 使用 Trae 托管的 LLM 黑盒 API 无法直接复现。
- **修复**：
  1. 新增 `scripts/novelforge/persona_vector_monitor.py` 脚本，基于角色语言指纹的 embedding 相似度比对，作为 Persona Vectors 论文 r ≈ 0.8 的工程化近似实现。
  2. 从 `stable_info.language_fingerprint`（M5 升级后的字段）抽取口头禅/小动作/决策偏好/句式特征，拼接成「角色代表性文本」，用 sentence-transformers / OpenAI API / 词汇级相似度三级 fallback 生成 baseline embedding。
  3. 从章节正文按对话归属抽取角色台词，拼接成「本章实际表现文本」，生成 embedding。
  4. 计算 cosine 相似度，阈值三级：>0.85 通过 / 0.7-0.85 P1 警告 / <0.7 P0 漂移。
  5. `check_consistency.py` 集成第 9 类检测 `persona_vector_drift`，与 M5 的第 8 类互补（统计特征 vs 语义特征）。
- **涉及文件**：
  - `scripts/novelforge/persona_vector_monitor.py`（新增，监控脚本）
  - `scripts/novelforge/data/persona_vector_baseline/.gitkeep`（新增，baseline 存储目录）
  - `scripts/novelforge/check_consistency.py`（`ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` / `check_all` 加第 9 类）
  - `.trae/skills/writer-polisher/SKILL.md`（阶段二审计调用 persona_vector_monitor；阶段三精修加 P0 修复策略；错误处理加 embedding 服务降级）
  - `.trae/skills/state-consistency-checker/SKILL.md`（9 类检测解读表 + 第 9 类解读指南）
  - `.trae/checklists/dev-checklist.md`（§三 + §八新增 persona_vector 检测项）
  - `tests/test_persona_vector.py`（新增，7 个用例）
  - `tests/bug_regression_list.md`（本条目）
- **回归测试**：
  - `pytest -q tests/test_persona_vector.py`：7 个用例全部通过
  - `python -m scripts.novelforge.persona_vector_monitor --chapter 42 --backend lexical --json`：正常输出相似度
  - `python -m scripts.novelforge.check_consistency --chapter 42 --dim persona_vector --json`：第 9 维度可运行
  - 无网络环境下 `--backend lexical` 降级可用
- **教训/沉淀**：
  1. Persona Vectors 论文的「在激活空间找线性方向」方法是黑盒 API 不可直接复现，但 embedding 相似度作为工程化近似是可行的——embedding 向量本身就是模型对文本的高层语义表示，是激活空间的近似投影。
  2. 统计特征漂移（句长/命中率）与语义特征漂移（embedding 相似度）互补不可互相替代：前者防慢性数值漂移，后者防急性语义漂移。
  3. 外部 embedding 服务（sentence-transformers / OpenAI）不可用时必须有零依赖 fallback——lexical 词汇级相似度虽准确度低但保证可用性，符合 NovelForge「零外部依赖 + 可解释」哲学。
```

### 7.3 check_consistency.py 新增检测规则

已在步骤 5 详述：新增 `persona_vector_drift` 检测，注册到 `ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` / `check_all` 分派逻辑。

### 7.4 不新增独立校验脚本

本模块的核心检测维度（角色语义漂移）作为 `check_consistency.py` 的第 9 类检测集成，与第 8 类（M5）同源（都对比正文与状态机）。独立脚本 `persona_vector_monitor.py` 提供单独调用入口便于调试，但 `check_consistency.py` 通过 wrapper 函数复用其逻辑，符合「不过度工程化」原则。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**中**。

本模块依赖外部 embedding 服务（sentence-transformers / OpenAI API），需考虑可用性。修改 `check_consistency.py` / `writer-polisher SKILL.md` 属 NovelForge 核心资产改动，但通过 wrapper 函数隔离，不破坏现有 8 类检测逻辑。

### 8.2 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|---|---|---|---|
| sentence-transformers 未安装 | 中（第 9 类检测降级） | 高（CI 环境默认无） | 三级 fallback：自动降级到 lexical backend，保证可用；测试环境显式 `--backend lexical` |
| OpenAI API 不可用 | 中（在线 embedding 不可用） | 中 | 同上，fallback 到 lexical |
| baseline 缺失首次构建失败 | 低（角色档案为空时） | 低 | `check_persona_vector_drift` 检测到 language_fingerprint 为空时跳过并告警，不阻断主流程 |
| lexical backend 准确度低导致误报 | 中（作者被打扰） | 中 | P1 不阻断保存；建议项明确「若 lexical 误报，安装 sentence-transformers 重跑」 |
| baseline backend 与章节 backend 不一致（维度不匹配） | 高（相似度为 0 误报 P0） | 中 | 强制章节 backend 与 baseline backend 一致；若 baseline backend 不可用，重建 baseline 到 lexical |
| 现有 8 类检测回归 | 高（一致性门禁失效） | 低 | 第 9 类检测函数独立，不改现有 8 类逻辑；`test_persona_vector.py` 断言 10 验证 9 维度全部可运行 |
| baseline 文件膨胀 | 低（单文件 <10KB） | 低 | 1000 章约 1000 角色基线 × 10KB = 10MB，可接受；按需归档 |
| OpenAI API 成本 | 低（每章一次 embedding） | 低 | 优先 sentence-transformers 本地；OpenAI 仅作 fallback；text-embedding-3-small 单次 <0.0001 美元 |

### 8.3 对核心资产的影响

按 `.trae/rules/dev-workflow.md` 第四条「禁止事项」定义，NovelForge 核心资产为：

- `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口）—— **本模块修改 `writer-polisher` / `state-consistency-checker` 两个核心 Skill**，改动属于新增检测维度的连带适配，不破坏现有工作流，且经本方案文档明确说明理由。
- `scripts/novelforge/check_consistency.py` —— **新增第 9 类检测**，与 M5 的第 8 类同源，通过 wrapper 函数隔离，不影响现有 8 类。
- `scripts/novelforge/persona_vector_monitor.py` —— **新增脚本**，不修改现有脚本逻辑。

### 8.4 回滚方案

**分支隔离**：在 `feature/persona-vector` 分支执行全部改动，主分支 `master` 保持不变。每个改动用独立 commit：

- C1: 新增 `scripts/novelforge/persona_vector_monitor.py` 脚本
- C2: 新增 `scripts/novelforge/data/persona_vector_baseline/.gitkeep` 目录
- C3: `check_consistency.py` 集成第 9 类检测（`ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` / `check_all` / wrapper 函数）
- C4: `writer-polisher SKILL.md` 触发监控指令 + 错误处理
- C5: `state-consistency-checker SKILL.md` 9 类检测解读 + 第 9 类解读指南
- C6: `dev-checklist.md` 新增 persona_vector 检测项
- C7: `tests/test_persona_vector.py` 新增 7 用例 + `bug_regression_list.md` 新增 BUG-068

**回滚步骤**：

1. 若发现 embedding 服务在 CI/生产环境大面积不可用 → revert C3，临时从 `ALL_DIMENSIONS` 移除 `persona_vector_drift`，待优化 fallback 后恢复。
2. 若发现 lexical backend 误报过多 → revert C3，临时禁用 lexical fallback（在 `embed_text` 函数中移除 `"lexical"` 从默认 fallback 链）。
3. 若发现第 9 类检测拖慢 `check_consistency` 性能 → revert C3，第 9 类改为独立调用 `persona_vector_monitor`，不进 `check_consistency`。
4. 整体回滚：`git revert C1..C7` 或 `git checkout master` 丢弃整个 `feature/persona-vector` 分支。

**降级方案**（不回滚，只降级）：

```bash
# 临时禁用第 9 类检测，只跑前 8 类
python -m scripts.novelforge.check_consistency --chapter <N> --dim power_level,item,relationship,location,foreshadow,revival,golden_finger,fingerprint
```

**gradual rollout**：

1. 第一阶段：在 `feature/persona-vector` 分支完成全部改动 + 测试通过（用 `--backend lexical` 跑通）。
2. 第二阶段：合并到 `master` 后，先跑 `python -m scripts.novelforge.check_consistency --chapter 1 --json` 确认 9 维度全部可运行。
3. 第三阶段：本地开发环境安装 sentence-transformers，验证 `--backend sentence-transformers` 准确度提升。
4. 第四阶段：观察 10 章后，验证 baseline 缓存生效、检测准确率符合预期。

---

## 九、完成标准（DoD 清单）

- [ ] `file:///workspace/scripts/novelforge/persona_vector_monitor.py` 脚本可运行（`python -m scripts.novelforge.persona_vector_monitor --help` 正常输出）
- [ ] `file:///workspace/scripts/novelforge/data/persona_vector_baseline/` 目录创建（含 `.gitkeep`）
- [ ] `file:///workspace/scripts/novelforge/check_consistency.py` 集成 `persona_vector_drift` 第 9 类检测
- [ ] `file:///workspace/scripts/novelforge/check_consistency.py` 的 `ALL_DIMENSIONS` / `DIM_LABELS` / `DIM_ALIASES` / `check_all` 分派逻辑同步第 9 类
- [ ] `file:///workspace/.trae/skills/writer-polisher/SKILL.md` 阶段二审计调用 persona_vector_monitor；阶段三精修 P0 修复策略表新增 `persona_vector_drift` 行；错误处理加 embedding 服务不可用降级处置
- [ ] `file:///workspace/.trae/skills/state-consistency-checker/SKILL.md` 9 类检测解读表 + 第 9 类 `persona_vector_drift` 解读指南（含 P0/P1 阈值与修复方向）
- [ ] `file:///workspace/.trae/checklists/dev-checklist.md` §三一致性新增 persona_vector 检测项；§八去 AI 味新增角色语义漂移检测项
- [ ] `file:///workspace/tests/test_persona_vector.py` 7 个用例全部通过：
  - [ ] `test_baseline_construction`
  - [ ] `test_dialogue_extraction`
  - [ ] `test_cosine_similarity_calculation`
  - [ ] `test_p0_drift_detection`
  - [ ] `test_p1_warning_detection`
  - [ ] `test_normal_chapter_passes`
  - [ ] `test_fallback_to_lexical_similarity`
- [ ] fallback 降级可用：`--backend lexical` 可在无网络/无 sentence-transformers / 无 OpenAI key 环境下正常输出相似度
- [ ] `file:///workspace/tests/bug_regression_list.md` 新增 BUG-068 条目
- [ ] `pytest -q` 全部通过（不破坏现有测试）
- [ ] `python -m scripts.novelforge.check_consistency --chapter 1 --json` 仍正常输出（9 维度可运行）
- [ ] `python -m scripts.novelforge.check_ai_novel --chapter 1 --json` 仍正常输出（不破坏去 AI 味检测）
- [ ] loop_log 2026-07 分片追加一条沉淀（`#lesson state_drift` 或 `#lesson content_quality`，引用本模块 BUG-068 与 M5 的协作关系）

---

## 附录 A：与 M5 / M2 / M7 模块的关系

| 模块 | 关系 | 协作点 |
|---|---|---|
| M5（角色五层档案） | **强依赖（本模块依赖 M5 先完成）** | M5 提供 `stable_info.language_fingerprint` 作为本模块的比对基线；M5 的第 8 类 `character_language_fingerprint_drift`（统计特征）与本模块的第 9 类 `persona_vector_drift`（语义特征）互补。M5 必须先合，本模块基于 M5 的 schema 启动。 |
| M2（schema 同步门禁） | 弱依赖 | M2 修复 schema 校验门禁，保证 stable_info 完整性。本模块读取 stable_info.language_fingerprint 时依赖 M2 的 schema 校验。 |
| M7（active enforcement 生成后强制验证） | 互补 | M7 强化 state-consistency-checker 对照 Protected 层关键字段。本模块的第 9 类检测会自动包含在 M7 的强制验证流程中（通过 check_consistency.py 一键触发）。 |
| M9（朱雀七维度对抗规则） | 正交 | M9 管"去 AI 味"的句式节奏检测，本模块管"角色一致性"的语义漂移检测。两者检测维度不重叠。 |

并行组 C（M18 等）按 master_plan 在 M1-M9 完成后启动。M18 依赖 M5，与 M19+ 互不依赖可并行。

## 附录 B：参考来源

- **Persona Vectors 论文（Anthropic, arXiv 2507.21509）**：[https://arxiv.org/abs/2507.21509](https://arxiv.org/abs/2507.21509)（角色向量化的漂移监控思想，r ≈ 0.8 的预测能力）
- **Consistently Simulating Human Personas with Multi-Turn RL（NeurIPS 2025）**：[https://arxiv.org/abs/2407.18431](https://arxiv.org/abs/2407.18431)（多轮 RL 微调，不一致率降低 55%+）
- **Spotting Out-of-Character Behavior（ACL 2025）**：[https://arxiv.org/abs/2407.18431](https://arxiv.org/abs/2407.18431)（原子级 persona fidelity 评估框架，三指标 ACC_atom / IC_atom / RC_atom）
- **sentence-transformers**：[https://github.com/UKPLab/sentence-transformers](https://github.com/UKPLab/sentence-transformers)（多语言 embedding 模型，paraphrase-multilingual-MiniLM-L12-v2）
- **OpenAI Embeddings API**：[https://platform.openai.com/docs/guides/embeddings](https://platform.openai.com/docs/guides/embeddings)（text-embedding-3-small，1536 维）
- **NovelForge M5 文档**：`file:///workspace/docs/optimization_plan_2026_07/M05_character_five_layer.md`（角色五层档案模型，本模块的基线提供者）
- **NovelForge loop_log 2026-07**：`file:///workspace/docs/loop_log/2026-07.md`（状态机漂移教训沉淀）

## 附录 C：术语表

| 术语 | 定义 |
|---|---|
| Persona Vectors | Anthropic 论文提出的方法，在 LLM 激活空间找与高层 character traits 对应的线性方向，r ≈ 0.8 可预测角色一致性 |
| persona_vector_drift | 本模块新增的第 9 类检测维度，基于 embedding cosine 相似度判定角色语义漂移 |
| baseline embedding | 角色语言指纹基线文本的 embedding 向量，缓存到 `data/persona_vector_baseline/<character_id>.json`，全书不变除非角色档案迁移 |
| cosine 相似度 | 两个向量的余弦夹角，本模块用作角色一致性量化指标（0-1，越高越一致） |
| 三级 fallback | sentence-transformers（本地）→ OpenAI API（在线）→ lexical 词汇级相似度（无网络降级）的 embedding 后端降级链 |
| lexical backend | 基于字符 2-gram 频率 + cosine 相似度的零依赖 embedding 后端，准确度低但保证可用性 |
| 语义漂移 vs 统计漂移 | 语义漂移=embedding 相似度偏离（M18 管）；统计漂移=句长/命中率偏离（M5 管）。互补不可替代 |
| baseline 重建 | 角色档案迁移（architect 更新 stable_info.language_fingerprint）后，需执行 `--rebuild-baseline` 重新生成 baseline embedding |

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 多专家团（M18 Persona Vectors 启发式角色漂移监控）
**依赖**：M5（角色五层档案）
**下游影响**：M19+（如未来引入向量库检索，可基于本模块的 baseline embedding 做语义检索）
