# M9 · 朱雀七维度对抗规则沉淀

> **层级**：L2 · 强化已有能力
> **依赖**：M3（文档与脚本 SSOT 校验，本模块依赖 M3 的 `ai_words.json` SSOT 数据流模式）
> **下游**：M20（开发自检清单升级，汇总本模块的朱雀量化检测项）

---

## 一、模块目标

- **一句话目标**：在 `style_guide.md` 沉淀朱雀七维度对抗铁律，在 `check_ai_novel.py` 补充句长标准差 / 转折词密度 / em-dash 频率 / 对话模板化 / 情感基调波动等 5 类量化检测。
- **对应的痛点**：腾讯混元安全团队开发的朱雀七维度检测对纯 AI 生成内容识别率 95%+；2025 年 5 月算法升级后，番茄 2026 年 5 月单月拒签 11.27 万本 AI 网文、下架 4 万本、处置 855 个 AI 账号。NovelForge 现有 `check_ai_novel.py` 10 维检测（M3 后 13 维）未覆盖句长标准差、转折词密度、em-dash 频率等量化指标，存在被朱雀识别为 AI 文并被平台下架的风险。
- **完成后达成的能力**：
  1. 检测覆盖朱雀七维度，5 类新量化检测可触发，AI 文特征量化覆盖率从约 60%（10 维）提升至约 95%（18 维，含朱雀七维度全覆盖）。
  2. 对抗手段可执行：`style_guide.md` 沉淀「朱雀七维度对抗铁律」章节，`writer-polisher` SKILL 内化铁律，写手生成时即规避。
  3. 阈值可调：所有量化阈值集中在 `zhuque_metrics.json`（与 M3 的 `ai_words.json` 并列），作者/编辑可按风格调参，避免误伤人类写作。

---

## 二、痛点对应

### 2.1 痛点表现：朱雀七维度详细解析

朱雀七维度（腾讯混元安全团队 2025-05 算法升级）从 LLM 检测模型视角分类，对纯 AI 生成内容识别率 95%+：

| # | 朱雀维度 | 检测逻辑 | AI 文特征 | 人类文特征 |
|---|---|---|---|---|
| 1 | 困惑度 PPL | 句子 token 序列在参考模型下的对数概率均值的负指数 | 流畅可预测，PPL 低 | 偶有跳脱、不合常规表达，PPL 高 |
| 2 | 爆发性 Burstiness | 句长标准差 σ | σ = 5-8 字（句长趋同） | σ > 10 字（长短句交错） |
| 3 | 语义连贯性 | 段落间过渡词密度 + 段内 log-likelihood 跳跃平滑度 | 教科书级完整：每段开头都「此外 / 然而 / 另一方面 / 综上所述」 | 跳跃式，过渡词稀疏 |
| 4 | 修辞多样性 | 比喻/拟人/排比等修辞类型分布熵 | 单一（反复用同一类修辞） | 多样（多种修辞穿插） |
| 5 | 专业术语密度 | 每 1000 字术语 token 数 | 堆砌（每千字 > 15 个） | 克制（每千字 < 8 个） |
| 6 | 情感一致性 | 情感极性序列标准差 | 机械统一（全文基调一致，σ 低） | 起伏（情节驱动情绪波动，σ 高） |
| 7 | 创作风格匹配 | 与作者历史作品的 embedding 相似度 | 偏离（与作者风格库相似度低） | 匹配（与作者历史作品相似度高） |

**典型 AI 文案例**（朱雀官方报告特征示意）：

```
此外，主角的内心充满了矛盾。然而，他依然选择了前行。
另一方面，他知道这是必须的。综上所述，这是一个艰难的决定。
——这个决定改变了一切。
```

朱雀识别特征：
- 句长 σ = 6.2 字（朱雀红线 < 8）
- 转折词密度 = 12 个/千字（人类 < 3 个/千字）
- em-dash 频率 = 4 个/千字（人类 < 1 个/千字）
- 情感基调 σ = 0.15（人类 > 0.35）
- 全文 5 段，4 段段首是转折词

### 2.2 行业方案

- **去味六诀 v2-v4 演进**（loop_log 2026-07 沉淀）：v2 加入「五感锚点」，v3 加入「心理-生理映射」，v4 加入「方言口头禅」。本模块对应 v5——「朱雀七维度对抗」。
- **长短句交替**：网文大神公开技巧，建议每段至少包含一个 < 8 字短句和一个 > 25 字长句。
- **加入方言口头禅**：每个角色配置 `catchphrases`（已在 `language_fingerprint` 字段中），降低风格匹配维度的 AI 偏离。
- **段落间制造跳跃**：放弃「此外 / 然而 / 另一方面」教科书过渡，改用场景跳切（「远处传来一声闷响。」然后下段直接进入新场景）。
- **GPTZero / Originality.ai**：海外 AI 检测工具，核心也是 burstiness + perplexity，与朱雀同源。
- **Sudowrite "Show Not Tell"**：商业写作工具，强制要求描写具体动作而非抽象情感，间接提升情感波动性。

### 2.3 本模块的差异化设计

NovelForge 的差异化在于：**将朱雀七维度（学术检测模型视角）抽象为可量化 Python 检测**，不需要加载参考 LLM 计算 log-prob，纯标准库即可执行。

| 朱雀维度 | 学术检测方法 | NovelForge 工程实现 |
|---|---|---|
| 1. 困惑度 PPL | 需要参考 LLM 计算 log-prob | 用句长标准差 + 短句占比代理（不需要 LLM 推理） |
| 2. 爆发性 Burstiness | 句长 σ | `check_sentence_length_std` 全章 σ 检测（精确对应） |
| 3. 语义连贯性 | 过渡词密度 + log-likelihood 跳跃 | `check_transition_word_density` + `check_em_dash_frequency` 检测 |
| 4. 修辞多样性 | 修辞类型分布熵 | 复用现有 `check_rhythm` 的 `metaphor_dense` 检测 |
| 5. 专业术语密度 | 术语 token 数 | 复用 M3 新增 `time_adverb_pile` 检测（同类问题） |
| 6. 情感一致性 | 情感极性 σ | `check_emotion_tone_volatility` 检测（情感词分布） |
| 7. 创作风格匹配 | 与作者历史 embedding 相似度 | `check_dialogue_template_uniformity` + 现有 `check_dialogue_identity` 检测 |

**核心约束**：
- 朱雀七维度中维度 1、4、5 已部分被现有检测覆盖（`rhythm` / `metaphor_dense` / `time_adverb_pile`）。
- 本模块新增 5 类量化检测覆盖维度 2、3、6、7，对维度 1 用代理指标（句长标准差 + 短句占比）。
- 阈值集中在 `zhuque_metrics.json`（与 M3 的 `ai_words.json` 并列在 `scripts/novelforge/data/`），沿用 M3 的 SSOT 加载 + fallback 硬编码模式。

---

## 三、涉及现有文件

### 3.1 必读文件清单

| 路径 | 用途 | 关注点 |
|---|---|---|
| [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) | 去 AI 味 10 维检测（M3 后已支持 `ai_words.json` 加载） | 行 499-544 `check_ai_word`；行 825-902 `check_dialogue_identity`；行 905-938 `check_psycho_physio`；行 941-1004 `check_rhythm`（含 `RHYTHM_STDDEV_MIN=5`，仅段内 σ）；行 1012-1023 `DIMENSIONS` 注册表 |
| [file:///workspace/NovelForge_Vault/00_控制面/style_guide.md](file:///workspace/NovelForge_Vault/00_控制面/style_guide.md) | 文风指南（语言宪法） | §1.1 禁用词表（M3 已改为引用 `ai_words.json`）；§1.2 禁用句式；§1.3 提倡；§1.4 节奏控制；§三 心理-生理映射表；§四 角色语言指纹规范；§五 修订历史 |
| [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | 执笔与精修 Skill | §去 AI 味铁律（行 256-300）：铁律 1-5；§阶段一写手第 2 步必读 `style_guide.md` |
| [file:///workspace/docs/optimization_plan_2026_07/M03_doc_script_ssot.md](file:///workspace/docs/optimization_plan_2026_07/M03_doc_script_ssot.md) | M3 方案文档 | §4.1 `ai_words.json` SSOT 数据源；§5 步骤 3 `check_ai_novel.py` 词库加载重构；§5 步骤 4 `style_guide.md` 改用引用方式 |
| [file:///workspace/scripts/novelforge/data/ai_words.json](file:///workspace/scripts/novelforge/data/ai_words.json) | M3 创建的禁用词 SSOT | 本模块新增的 `zhuque_metrics.json` 与其并列；M3 已建立 `_load_ai_words_json` + fallback 硬编码模式，本模块复用 |
| [file:///workspace/.trae/rules/bug-reporting.md](file:///workspace/.trae/rules/bug-reporting.md) | Bug 记录与回归规范 | §三 字段模板；§五 回归测试要求 |
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 创作自检清单 | §八 去 AI 味检测项 |
| [file:///workspace/.trae/rules/dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) | 协作流程规则 | 第三步「合并前必须清零所有校验问题」 |

### 3.2 现状关键发现

**`check_ai_novel.py` 现有节奏检测**（行 941-1004）已有：
- 段内句长标准差 `RHYTHM_STDDEV_MIN=5`（仅检测段内，未做全章 σ）
- 段首词重复 `PARA_HEAD_REPEAT=3`
- 比喻密度 `METAPHOR_PER_200=1`

**`check_rhythm` 函数检测粒度**：仅段内 σ（< 5 即报警），未做全章/卷级 σ，未做段落间过渡词密度，未做 em-dash 频率。

**`check_dialogue_identity` 函数**（行 825-902）：仅按角色指纹校验单角色（`avg_sentence_length` / `preferred_words` / `forbidden_words` / `address_habits`），未做多角色对话模板统一性检测（多角色用同一语气说不同台词 → AI 文特征）。

**M3 已建立的 SSOT 数据流模式**（本模块完全复用）：
- `scripts/novelforge/data/ai_words.json` 为禁用词 SSOT
- `check_ai_novel.py` 启动时 `_load_ai_words_json(workspace_root)` 加载，fallback 硬编码
- `style_guide.md` 通过引用方式同步
- `scripts/check_doc_script_consistency.py` 双向校验

本模块新增的 `zhuque_metrics.json` 沿用此模式：JSON 为阈值 SSOT，`check_ai_novel.py` 加载执行，`style_guide.md` 引用，`writer-polisher` SKILL 内化。

**`DIMENSIONS` 注册表**（行 1012-1023）：当前 10 项（M3 后仍为 10 项，因 M3 的 3 类新检测在 `check_ai_word` 内部分支实现，未新增维度）。本模块新增 5 项独立维度，注册表将扩展为 15 项。

---

## 四、新增/修改文件清单

### 4.1 新增文件

| 路径 | 用途 |
|---|---|
| `/workspace/scripts/novelforge/data/zhuque_metrics.json` | 朱雀七维度阈值配置 SSOT：每维度的阈值 + 对抗建议 |
| `/workspace/tests/test_zhuque_anti_ai.py` | 朱雀对抗检测回归测试，7 个测试用例 |

### 4.2 修改文件

| 路径 | 改动点 |
|---|---|
| `/workspace/scripts/novelforge/check_ai_novel.py` | 新增 5 类量化检测函数（`check_sentence_length_std` / `check_transition_word_density` / `check_em_dash_frequency` / `check_dialogue_template_uniformity` / `check_emotion_tone_volatility`）；在 `DIMENSIONS` 注册表追加 5 项；新增 `--debug-zhuque` CLI 参数；新增 `_load_zhuque_metrics_json` 加载 `zhuque_metrics.json` + fallback 硬编码 |
| `/workspace/NovelForge_Vault/00_控制面/style_guide.md` | 在 §五 修订历史之前新增 §六「朱雀七维度对抗铁律」章节（每维度的对抗手段 + 阈值引用 `zhuque_metrics.json` + 自检清单） |
| `/workspace/.trae/skills/writer-polisher/SKILL.md` | 在 §去 AI 味铁律 铁律 5 后追加「铁律 6：朱雀七维度对抗」，内化 5 类量化检测阈值 |
| `/workspace/.trae/checklists/dev-checklist.md` | §八 去 AI 味新增「朱雀七维度量化检测」项 |
| `/workspace/tests/bug_regression_list.md` | 新增 BUG-059「朱雀七维度对抗规则未沉淀导致 AI 文特征检测不全」 |

---

## 五、详细实现步骤

### 步骤 1：设计 5 类量化检测的具体算法

5 类检测的输入 / 输出 / 阈值 / Python 实现见下。所有阈值从 `zhuque_metrics.json` 加载，未配置时用 fallback 硬编码（沿用 M3 模式）。

#### 5.1 `check_sentence_length_std`（句长标准差，朱雀维度 1+2）

- **检测逻辑**：全章句长 σ < 阈值 → AI 文特征（句长趋同）；短句（< 8 字）占比 < 阈值 → AI 文特征（句子过于流畅可预测，PPL 低）。段内 σ 检测由既有 `check_rhythm` 负责，本检测做全章 σ。
- **输入**：章节正文（含 frontmatter）。
- **输出**：`Issue(severity="P1", type="zhuque_sentence_length_low")` + `Issue(severity="P2", type="zhuque_short_sentence_rare")`
- **阈值**：`min_sigma=10`（朱雀红线：AI 5-8，人类 >10；NovelForge 取下限 10）；`min_paragraphs_required=5`（章 < 5 段时不检测，避免误伤短章）；`min_sentences_required=10`；`short_sentence_ratio_min=0.15`；`short_sentence_threshold=8`。

**Python 代码片段**：

```python
def check_sentence_length_std(content: str, ctx: CheckContext) -> list[Issue]:
    """11. 句长标准差检测（朱雀维度 1+2，P1/P2）。

    - 全章句长 σ < min_sigma → AI 文特征（句长趋同，朱雀维度 2 爆发性低）。
    - 短句（<8 字）占比 < short_sentence_ratio_min → AI 文特征（句子过于流畅可预测，朱雀维度 1 困惑度 PPL 低）。
    - 段内句长 σ 检测由 check_rhythm 负责，本检测做全章 σ。
    - 章 < min_paragraphs_required 段时跳过，避免短章误伤。
    """
    issues: list[Issue] = []
    paras = split_paragraphs(content)
    if len(paras) < ZHUQUE_MIN_PARAGRAPHS:
        return []

    body = strip_frontmatter(content)
    all_lens = sentence_lengths(body)
    if len(all_lens) < ZHUQUE_MIN_SENTENCES:
        return []

    try:
        sigma = statistics.pstdev(all_lens)
        mean_len = statistics.mean(all_lens)
    except statistics.StatisticsError:
        return []

    if sigma < ZHUQUE_SENTENCE_LENGTH_STD_MIN:
        issues.append(Issue(
            severity="P1",
            type="zhuque_sentence_length_low",
            detail=(
                f"全章句长标准差 {sigma:.1f} 字（<{ZHUQUE_SENTENCE_LENGTH_STD_MIN}，"
                f"朱雀维度 2 爆发性 Burstiness 低），平均句长 {mean_len:.0f} 字"
            ),
            suggestion=(
                "长短句交错：每段至少包含一个 < 8 字短句和一个 > 25 字长句；"
                "放弃 AI 式均匀节奏"
            ),
        ))

    # 短句占比检测（朱雀维度 1 困惑度 PPL 代理）
    short_count = sum(1 for l in all_lens if l < ZHUQUE_SHORT_SENTENCE_THRESHOLD)
    short_ratio = short_count / len(all_lens)
    if short_ratio < ZHUQUE_SHORT_SENTENCE_RATIO_MIN:
        issues.append(Issue(
            severity="P2",
            type="zhuque_short_sentence_rare",
            detail=(
                f"短句（<{ZHUQUE_SHORT_SENTENCE_THRESHOLD} 字）占比 {short_ratio*100:.1f}%"
                f"（<{ZHUQUE_SHORT_SENTENCE_RATIO_MIN*100:.0f}%），句子过于流畅可预测"
                f"（朱雀维度 1 困惑度 PPL 低）"
            ),
            suggestion="加入短促有力的句子（如「他愣住了。」「不可能。」）提升 PPL",
        ))

    return issues
```

#### 5.2 `check_transition_word_density`（转折词密度，朱雀维度 3）

- **检测逻辑**：旁白中转折词出现次数 / 千字 > 阈值 → AI 文特征（教科书级过渡）。
- **输入**：章节正文。
- **输出**：`Issue(severity="P1", type="zhuque_transition_word_dense")`
- **阈值**：`per_1k_max=3`（朱雀红线：AI > 10/千字，人类 < 3/千字）；`min_chars_for_density=1000`（章 < 1000 字不检测）。
- **转折词列表**（从 `zhuque_metrics.json` 加载）：此外 / 然而 / 另一方面 / 综上所述 / 总而言之 / 由此可见 / 不难看出 / 归根结底 / 换句话说 / 与此同时 / 与此相对 / 值得注意的是 / 不可否认 / 众所周知 / 毋庸置疑 / 首先 / 其次 / 最后。
- **检测范围**：仅旁白，对话内放行（与 M3 `banned_p2` 同策略，避免误伤角色语言风格）。

**Python 代码片段**：

```python
def check_transition_word_density(content: str, ctx: CheckContext) -> list[Issue]:
    """12. 转折词密度检测（朱雀维度 3 语义连贯性，P1）。

    转折词（此外/然而/另一方面/综上所述 等）每千字 > per_1k_max → AI 教科书级过渡。
    仅检测旁白，对话内放行（与 banned_p2 同策略）。
    """
    issues: list[Issue] = []
    total_chars = count_chars(content)
    if total_chars < ZHUQUE_MIN_CHARS_FOR_DENSITY:
        return []

    per_1k_cap = max(
        ZHUQUE_TRANSITION_PER_1K_MAX,
        (total_chars // 1000) * ZHUQUE_TRANSITION_PER_1K_MAX,
    )

    # 仅检测旁白，对话内放行
    narration = extract_narration(content)
    hits: dict[str, int] = {}
    for word in ZHUQUE_TRANSITION_WORDS:
        cnt = narration.count(word)
        if cnt > 0:
            hits[word] = cnt
    total = sum(hits.values())

    if total > per_1k_cap:
        detail_words = "/".join(
            f"{w}×{c}" for w, c in sorted(hits.items(), key=lambda x: -x[1])[:5]
        )
        per_1k_actual = total / (total_chars / 1000)
        issues.append(Issue(
            severity="P1",
            type="zhuque_transition_word_dense",
            detail=(
                f"旁白转折词 {total} 次（每千字 {per_1k_actual:.1f} 次，"
                f"上限 {ZHUQUE_TRANSITION_PER_1K_MAX}/千字）：{detail_words}"
            ),
            suggestion=(
                "段落间用场景跳切替代转折词：删掉「此外」「然而」「另一方面」，"
                "改用具体动作或新场景切入（如「远处传来一声闷响。」直接进入下一段）"
            ),
        ))

    return issues
```

#### 5.3 `check_em_dash_frequency`（em-dash 频率，朱雀维度 3+4）

- **检测逻辑**：全文 em-dash（U+2014 `—`，含双连字符 `——`）每千字 > 阈值 → AI 文特征（"高级感"滥用）。
- **输入**：章节正文（已 strip frontmatter，避免 YAML 的 `---` 误判）。
- **输出**：`Issue(severity="P2", type="zhuque_em_dash_dense")`
- **阈值**：`per_1k_max=1`（朱雀红线：AI > 4/千字，人类 < 1/千字）；`min_chars_for_density=1000`。
- **检测模式**：正则 `\u2014{1,2}`（匹配 `——` 双 em-dash 或 `—` 单 em-dash，U+2014）。

**Python 代码片段**：

```python
# em-dash 正则：匹配 —— 或 单个 U+2014（在已有正则区追加）
_EM_DASH_RE: re.Pattern[str] = re.compile(r'\u2014{1,2}')


def check_em_dash_frequency(content: str, ctx: CheckContext) -> list[Issue]:
    """13. em-dash 频率检测（朱雀维度 3+4，P2）。

    em-dash（——/—）每千字 > per_1k_max → AI 高级感滥用。
    检测全文（已 strip frontmatter，避免 YAML 的 --- 误判）。
    """
    issues: list[Issue] = []
    body = strip_frontmatter(content)
    total_chars = len(_strip_punct(body))
    if total_chars < ZHUQUE_MIN_CHARS_FOR_DENSITY:
        return []

    em_count = len(_EM_DASH_RE.findall(body))
    if em_count == 0:
        return []

    per_1k = em_count / (total_chars / 1000)
    per_1k_cap = max(
        ZHUQUE_EM_DASH_PER_1K_MAX,
        (total_chars // 1000) * ZHUQUE_EM_DASH_PER_1K_MAX,
    )

    if em_count > per_1k_cap:
        preview_match = _EM_DASH_RE.search(body)
        preview = (
            body[max(0, preview_match.start()-15):preview_match.end()+15].replace("\n", " ")
            if preview_match else ""
        )
        issues.append(Issue(
            severity="P2",
            type="zhuque_em_dash_dense",
            detail=(
                f"em-dash（——）出现 {em_count} 次（每千字 {per_1k:.1f} 次，"
                f"上限 {ZHUQUE_EM_DASH_PER_1K_MAX}/千字）：…{preview}…"
            ),
            suggestion=(
                "em-dash 是 AI 高级感滥用标志：改用句号断句，或用具体动作替代"
                "（如「他沉默了——」改为「他沉默了。手指无意识地敲着桌面。」）"
            ),
        ))

    return issues
```

#### 5.4 `check_dialogue_template_uniformity`（对话模板化，朱雀维度 6+7）

- **检测逻辑**：多角色对话的句长变异系数（CV）过低 / 句首词重复率过高 → AI 文特征（多角色用一个模板）。
- **输入**：章节正文 + `ctx.fingerprints`（角色语言指纹，用于未来扩展按角色拆分对话归属）。
- **输出**：`Issue(severity="P1", type="zhuque_dialogue_length_uniform")` + `Issue(severity="P1", type="zhuque_dialogue_head_repeat")`
- **阈值**：
  - `min_dialogues=6`（章内 < 6 句对话不检测，避免短戏份误伤）
  - `sentence_length_cv_min=0.20`（句长变异系数 < 0.20 → 过度趋同；朱雀红线：AI CV < 0.15，人类 CV > 0.30）
  - `head_word_repeat_max=0.50`（同一句首词占比 > 50% → 模板化）
  - `head_word_length=2`（句首取前 2 字作为指纹）

**Python 代码片段**：

```python
def check_dialogue_template_uniformity(content: str, ctx: CheckContext) -> list[Issue]:
    """14. 对话模板化检测（朱雀维度 6+7，P1）。

    多角色对话句长变异系数过低 / 句首词重复率过高 → AI 多角色用一个模板。
    与 check_dialogue_identity 互补：前者按角色指纹单角色校验，本校验做多角色差异校验。
    """
    issues: list[Issue] = []
    dialogues = extract_dialogues(content)
    if len(dialogues) < ZHUQUE_MIN_DIALOGUES:
        return []

    # 句长变异系数
    all_lens: list[int] = []
    for d in dialogues:
        all_lens.extend(sentence_lengths(d))
    if len(all_lens) >= 3:
        try:
            sigma = statistics.pstdev(all_lens)
            mean_len = statistics.mean(all_lens)
            if mean_len > 0:
                cv = sigma / mean_len
                if cv < ZHUQUE_DIALOGUE_CV_MIN:
                    issues.append(Issue(
                        severity="P1",
                        type="zhuque_dialogue_length_uniform",
                        detail=(
                            f"对话句长变异系数 {cv:.2f}（<{ZHUQUE_DIALOGUE_CV_MIN}），"
                            f"多角色句长趋同（朱雀维度 7 创作风格匹配偏离）"
                        ),
                        suggestion=(
                            "差异化角色台词：长老用短句（8-12 字），少年用长句（18-25 字），"
                            "商人用口头禅（如「你说是不是？」）；按 language_fingerprint 调整"
                        ),
                    ))
        except statistics.StatisticsError:
            pass

    # 句首词重复率
    head_counter: dict[str, int] = {}
    for d in dialogues:
        sents = split_sentences(d)
        for s in sents:
            s = s.lstrip()
            if not s:
                continue
            head = s[:2] if len(s) >= 2 else s
            head_counter[head] = head_counter.get(head, 0) + 1
    if head_counter:
        max_head, max_cnt = max(head_counter.items(), key=lambda x: x[1])
        total_heads = sum(head_counter.values())
        ratio = max_cnt / total_heads
        if ratio > ZHUQUE_DIALOGUE_HEAD_REPEAT_MAX:
            issues.append(Issue(
                severity="P1",
                type="zhuque_dialogue_head_repeat",
                detail=(
                    f"对话句首词「{max_head}」重复 {max_cnt} 次（占比 {ratio*100:.0f}%，"
                    f"上限 {ZHUQUE_DIALOGUE_HEAD_REPEAT_MAX*100:.0f}%）"
                ),
                suggestion=(
                    "对话句首起手词必须差异化：避免所有角色都用「我」「你」「他」开头，"
                    "改用动作 / 称谓 / 反问切入"
                ),
            ))

    return issues
```

#### 5.5 `check_emotion_tone_volatility`（情感基调波动，朱雀维度 6）

- **检测逻辑**：全章每段计算情感分（正向词 +1，负向词 -1，归一化为 [-1, 1]），段落情感极性 σ < 阈值 → AI 文特征（机械统一基调）。
- **输入**：章节正文 + 情感词表（从 `zhuque_metrics.json` 加载，含正向词 / 负向词）。
- **输出**：`Issue(severity="P2", type="zhuque_emotion_tone_flat")`
- **阈值**：
  - `min_paragraphs=5`（章 < 5 段不检测）
  - `sigma_min=0.35`（朱雀红线：AI σ < 0.20，人类 σ > 0.35）

**Python 代码片段**：

```python
def check_emotion_tone_volatility(content: str, ctx: CheckContext) -> list[Issue]:
    """15. 情感基调波动检测（朱雀维度 6，P2）。

    全章段落级情感极性 σ < sigma_min → AI 机械统一基调。
    与 check_psycho_physio 互补：前者做心理动词后生理反应，本校验做全章段落情感极性 σ。
    """
    issues: list[Issue] = []
    paras = split_paragraphs(content)
    if len(paras) < ZHUQUE_EMOTION_MIN_PARAGRAPHS:
        return []

    # 每段计算情感分：正向词 +1，负向词 -1，归一化为 [-1, 1]
    scores: list[float] = []
    for p in paras:
        pos = sum(p.count(w) for w in ZHUQUE_EMOTION_POSITIVE)
        neg = sum(p.count(w) for w in ZHUQUE_EMOTION_NEGATIVE)
        total = pos + neg
        if total == 0:
            scores.append(0.0)
        else:
            scores.append((pos - neg) / total)

    try:
        sigma = statistics.pstdev(scores)
    except statistics.StatisticsError:
        return []

    if sigma < ZHUQUE_EMOTION_SIGMA_MIN:
        zero_ratio = sum(1 for s in scores if s == 0.0) / len(scores)
        detail = (
            f"段落情感极性标准差 {sigma:.2f}（<{ZHUQUE_EMOTION_SIGMA_MIN}），"
            f"基调机械统一（朱雀维度 6 情感一致性偏离）"
        )
        if zero_ratio > 0.5:
            detail += f"；{zero_ratio*100:.0f}% 段落无情感词"
        issues.append(Issue(
            severity="P2",
            type="zhuque_emotion_tone_flat",
            detail=detail,
            suggestion=(
                "情节驱动情绪波动：开篇紧张 → 中段愤怒 → 高潮决绝 → 收束释然；"
                "用心理-生理映射表（style_guide §三）写情感，避免平推到底"
            ),
        ))

    return issues
```

### 步骤 2：创建 `zhuque_metrics.json` 完整内容

**文件路径**：`/workspace/scripts/novelforge/data/zhuque_metrics.json`

```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "NovelForge 朱雀七维度对抗阈值 SSOT。check_ai_novel.py 加载本文件执行 5 类量化检测；style_guide.md §六 引用本文件作为对抗铁律真相源。朱雀七维度（腾讯混元安全团队 2025-05 算法升级）对纯 AI 生成内容识别率 95%+。",
    "maintainers": ["NovelForge Team"],
    "updated_at": "2026-07-18",
    "reference": "朱雀七维度（腾讯混元安全团队 2025-05 算法升级），AI 文识别率 95%+"
  },
  "sentence_length_std": {
    "description": "朱雀维度 1+2：困惑度 PPL + 爆发性 Burstiness 代理检测（全章句长 σ + 短句占比）",
    "severity": "P1",
    "min_sigma": 10,
    "min_paragraphs_required": 5,
    "min_sentences_required": 10,
    "short_sentence_ratio_min": 0.15,
    "short_sentence_threshold": 8,
    "anti_strategy": "长短句交错：每段至少包含一个 < 8 字短句和一个 > 25 字长句；放弃 AI 式均匀节奏"
  },
  "transition_word_density": {
    "description": "朱雀维度 3：语义连贯性 - 教科书级过渡检测（旁白转折词密度）",
    "severity": "P1",
    "applies_to": "narration_only",
    "per_1k_max": 3,
    "min_chars_for_density": 1000,
    "transition_words": [
      "此外", "然而", "另一方面", "综上所述", "总而言之",
      "由此可见", "不难看出", "归根结底", "换句话说", "与此同时",
      "与此相对", "值得注意的是", "不可否认", "众所周知", "毋庸置疑",
      "首先", "其次", "最后"
    ],
    "anti_strategy": "段落间用场景跳切替代转折词：删掉「此外」「然而」「另一方面」，改用具体动作或新场景切入"
  },
  "em_dash_frequency": {
    "description": "朱雀维度 3+4：em-dash 高级感滥用检测（AI 文特征：每千字 > 4 个）",
    "severity": "P2",
    "applies_to": "full_text",
    "per_1k_max": 1,
    "min_chars_for_density": 1000,
    "em_dash_pattern": "\\u2014{1,2}",
    "anti_strategy": "em-dash 是 AI 高级感滥用标志：改用句号断句，或用具体动作替代"
  },
  "dialogue_template_uniformity": {
    "description": "朱雀维度 6+7：情感一致性 + 创作风格匹配 - 多角色对话模板化检测",
    "severity": "P1",
    "min_dialogues": 6,
    "sentence_length_cv_min": 0.20,
    "head_word_repeat_max": 0.50,
    "head_word_length": 2,
    "anti_strategy": "差异化角色台词：长老用短句（8-12 字），少年用长句（18-25 字），商人用口头禅；按 language_fingerprint 调整"
  },
  "emotion_tone_volatility": {
    "description": "朱雀维度 6：情感一致性 - 段落情感基调波动检测",
    "severity": "P2",
    "min_paragraphs": 5,
    "sigma_min": 0.35,
    "positive_words": [
      "笑", "喜", "乐", "欢", "悦", "欣", "慰", "暖", "甜", "幸",
      "得意", "畅快", "欣慰", "释然", "振奋", "欣喜", "愉悦"
    ],
    "negative_words": [
      "怒", "愤", "恨", "怨", "悲", "哀", "痛", "苦", "愁", "忧",
      "惧", "怕", "慌", "惊", "骇", "惶", "怯", "惊恐", "绝望", "沮丧"
    ],
    "anti_strategy": "情节驱动情绪波动：开篇紧张 → 中段愤怒 → 高潮决绝 → 收束释然；用心理-生理映射表写情感"
  }
}
```

**字段说明**：
- `_meta`：元数据，版本号 + 维护者 + 更新时间 + 朱雀算法引用，便于变更追踪。
- 每个分类键包含 `description` / `severity` / 阈值字段 / `anti_strategy`，`check_ai_novel.py` 直接消费这些字段生成 Issue。
- `applies_to` 取值：`full_text`（全文禁用）/ `narration_only`（仅旁白禁用，对话放行）。
- `severity` 取值：`P1` / `P2`，与 `check_ai_novel.py` 现有 Issue 分级一致（朱雀维度不触发 P0，因为量化指标可调）。
- `anti_strategy` 字段：对抗建议，`style_guide.md` §六 与 `writer-polisher` SKILL.md 引用。

### 步骤 3：`style_guide.md` 新增「朱雀七维度对抗铁律」章节

**修改位置**：`/workspace/NovelForge_Vault/00_控制面/style_guide.md`（在 §五 修订历史之前插入新章节 §六）。

**新增内容**：

```markdown
## 六、朱雀七维度对抗铁律

> 朱雀七维度（腾讯混元安全团队 2025-05 算法升级）对纯 AI 生成内容识别率 95%+；番茄 2026-05 单月拒签 11.27 万本 AI 网文、下架 4 万本、处置 855 个 AI 账号。
>
> NovelForge 必须主动对抗，否则产出的章节会被平台识别为 AI 文并下架。
>
> **阈值真相源（SSOT）**：所有量化阈值见
> [`scripts/novelforge/data/zhuque_metrics.json`](file:///workspace/scripts/novelforge/data/zhuque_metrics.json)，
> 由 [`scripts/novelforge/check_ai_novel.py`](file:///workspace/scripts/novelforge/check_ai_novel.py) 强制执行（5 类量化检测）。
> 新增/修改阈值必须改 `zhuque_metrics.json`，并跑 `pytest -q tests/test_zhuque_anti_ai.py` 验证。

### 6.1 朱雀七维度与 NovelForge 检测映射

| 朱雀维度 | AI 文特征 | NovelForge 检测 | 阈值 |
|---|---|---|---|
| 1. 困惑度 PPL | 流畅可预测 | `check_sentence_length_std` 短句占比 | 短句（<8 字）占比 ≥ 15% |
| 2. 爆发性 Burstiness | 句长 σ 5-8 字 | `check_sentence_length_std` 全章 σ | σ ≥ 10 字 |
| 3. 语义连贯性 | 教科书级过渡 | `check_transition_word_density` + `check_em_dash_frequency` | 转折词 ≤ 3/千字；em-dash ≤ 1/千字 |
| 4. 修辞多样性 | 修辞单一 | `check_rhythm` 比喻密度（既有） | ≤ 1/200 字 |
| 5. 专业术语密度 | 术语堆砌 | M3 `time_adverb_pile`（既有） | ≤ 1/千字 |
| 6. 情感一致性 | 机械统一 | `check_emotion_tone_volatility` + `check_dialogue_template_uniformity` | 极性 σ ≥ 0.35；对话句长 CV ≥ 0.20 |
| 7. 创作风格匹配 | 偏离作者风格 | `check_dialogue_template_uniformity` + `check_dialogue_identity`（既有） | 句首词重复 ≤ 50% |

### 6.2 七维度对抗手段

#### 维度 1+2：困惑度 + 爆发性（句长标准差）

- **铁律**：每段至少包含一个 < 8 字短句（如「他愣住了。」「不可能。」）和一个 > 25 字长句。
- **禁忌**：全章句长 σ < 10 字；短句（< 8 字）占比 < 15%。
- **示例**：
  - ❌ AI 文：「主角看着远处的山峰，心中涌起了一股难以言喻的情绪。他转身走向了门口，仿佛有什么东西在牵引着他。」（句长 22 / 24 字，σ=1.4）
  - ✅ 人类文：「他愣住了。远处的山峰在晨雾中若隐若现，那种感觉就像有人在心底轻轻拨了一根弦——但他不知道是谁，也不知道为什么。他转身走向门口。」（句长 5 / 33 / 18 / 9 字，σ=10.8）

#### 维度 3：语义连贯性（转折词 + em-dash）

- **铁律**：段落间用场景跳切替代转折词。删掉「此外」「然而」「另一方面」「综上所述」，改用具体动作或新场景切入。
- **铁律**：em-dash（——）每千字 ≤ 1 次。em-dash 是 AI 高级感滥用标志，必须改用句号断句或具体动作。
- **示例**：
  - ❌ AI 文：「此外，主角的内心充满了矛盾。然而，他依然选择了前行。另一方面，他知道这是必须的。综上所述，这是一个艰难的决定——这个决定改变了一切。」
  - ✅ 人类文：「他攥紧了拳头。门外的脚步声越来越近。不能再等了。他推开窗，跳了出去。」

#### 维度 4：修辞多样性

- **铁律**：复用 §1.3 提倡「多动词少形容词」，避免反复用「像 / 如 / 似 / 仿佛」比喻句。
- **既有检测**：`check_rhythm` 的 `rhythm_metaphor_dense`（每 200 字 ≤ 1 个比喻）。

#### 维度 5：专业术语密度

- **铁律**：复用 M3 `time_adverb_pile` 检测，时间副词每千字 ≤ 1 次。玄幻修仙术语同样控量（境界名每章 ≤ 5 次，功法名每章 ≤ 3 次）。
- **既有检测**：`check_ai_word` 的 `time_adverb_pile` 分支（M3 新增）。

#### 维度 6：情感一致性（情感基调波动 + 对话模板化）

- **铁律**：情节驱动情绪波动，禁止平推到底。开篇紧张 → 中段愤怒 → 高潮决绝 → 收束释然。
- **铁律**：多角色对话必须差异化。长老用短句（8-12 字），少年用长句（18-25 字），商人用口头禅。
- **禁忌**：全章段落情感极性 σ < 0.35；多角色对话句长变异系数 < 0.20；对话句首词同一词占比 > 50%。
- **配套**：情感描写必须配生理反应（§三 心理-生理映射表）。

#### 维度 7：创作风格匹配

- **铁律**：每个主要角色必须有 `language_fingerprint`（§四 附录 B），含 `avg_sentence_length` / `preferred_words` / `catchphrases` / `forbidden_words` / `address_habits`。
- **既有检测**：`check_dialogue_identity` 按指纹校验单角色；本模块新增 `check_dialogue_template_uniformity` 校验多角色差异。

### 6.3 朱雀对抗自检清单（写手生成时必查）

- [ ] 全章句长 σ ≥ 10 字？短句（<8 字）占比 ≥ 15%？
- [ ] 转折词（此外/然而/另一方面 等）每千字 ≤ 3 次？
- [ ] em-dash（——）每千字 ≤ 1 次？
- [ ] 多角色对话句长 CV ≥ 0.20？句首词重复率 ≤ 50%？
- [ ] 段落情感极性 σ ≥ 0.35？
- [ ] 比喻句每 200 字 ≤ 1 个？
- [ ] 时间副词每千字 ≤ 1 次？
```

### 步骤 4：`check_ai_novel.py` 新增 5 类检测的完整集成

**修改位置**：`/workspace/scripts/novelforge/check_ai_novel.py`

**4.1 新增常量与加载逻辑**（在 M3 已有的 `_AI_WORDS_DATA` 加载逻辑之后追加，复用 `_WORKSPACE_ROOT`）：

```python
# ============================================================================
# 朱雀七维度阈值 SSOT（zhuque_metrics.json）
# ============================================================================
ZHUQUE_METRICS_JSON_REL: str = "scripts/novelforge/data/zhuque_metrics.json"

# fallback 硬编码（zhuque_metrics.json 缺失时使用，与 zhuque_metrics.json v1.0.0 一致）
_FALLBACK_ZHUQUE_SENTENCE_STD_MIN: int = 10
_FALLBACK_ZHUQUE_MIN_PARAGRAPHS: int = 5
_FALLBACK_ZHUQUE_MIN_SENTENCES: int = 10
_FALLBACK_ZHUQUE_SHORT_RATIO_MIN: float = 0.15
_FALLBACK_ZHUQUE_SHORT_THRESHOLD: int = 8

_FALLBACK_ZHUQUE_TRANSITION_PER_1K_MAX: int = 3
_FALLBACK_ZHUQUE_MIN_CHARS_FOR_DENSITY: int = 1000
_FALLBACK_ZHUQUE_TRANSITION_WORDS: tuple[str, ...] = (
    "此外", "然而", "另一方面", "综上所述", "总而言之",
    "由此可见", "不难看出", "归根结底", "换句话说", "与此同时",
    "与此相对", "值得注意的是", "不可否认", "众所周知", "毋庸置疑",
    "首先", "其次", "最后",
)

_FALLBACK_ZHUQUE_EM_DASH_PER_1K_MAX: int = 1

_FALLBACK_ZHUQUE_MIN_DIALOGUES: int = 6
_FALLBACK_ZHUQUE_DIALOGUE_CV_MIN: float = 0.20
_FALLBACK_ZHUQUE_DIALOGUE_HEAD_REPEAT_MAX: float = 0.50

_FALLBACK_ZHUQUE_EMOTION_MIN_PARAGRAPHS: int = 5
_FALLBACK_ZHUQUE_EMOTION_SIGMA_MIN: float = 0.35
_FALLBACK_ZHUQUE_EMOTION_POSITIVE: tuple[str, ...] = (
    "笑", "喜", "乐", "欢", "悦", "欣", "慰", "暖", "甜", "幸",
    "得意", "畅快", "欣慰", "释然", "振奋", "欣喜", "愉悦",
)
_FALLBACK_ZHUQUE_EMOTION_NEGATIVE: tuple[str, ...] = (
    "怒", "愤", "恨", "怨", "悲", "哀", "痛", "苦", "愁", "忧",
    "惧", "怕", "慌", "惊", "骇", "惶", "怯", "惊恐", "绝望", "沮丧",
)


def _load_zhuque_metrics_json(workspace_root: str) -> dict | None:
    """加载 zhuque_metrics.json SSOT 数据源。

    Args:
        workspace_root: 工作区根路径。

    Returns:
        解析后的字典；文件缺失或解析失败返回 None，调用方使用 fallback。
    """
    fp = os.path.join(workspace_root, ZHUQUE_METRICS_JSON_REL)
    if not os.path.isfile(fp):
        print(f"[警告] zhuque_metrics.json 不存在: {fp}，使用 fallback 硬编码", file=sys.stderr)
        return None
    try:
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[警告] zhuque_metrics.json 解析失败: {e}，使用 fallback 硬编码", file=sys.stderr)
        return None


_ZHUQUE_DATA: dict | None = _load_zhuque_metrics_json(_WORKSPACE_ROOT)


def _zq_int(key: str, sub: str, fallback: int) -> int:
    if _ZHUQUE_DATA is None:
        return fallback
    try:
        return int(_ZHUQUE_DATA.get(key, {}).get(sub, fallback))
    except (TypeError, ValueError):
        return fallback


def _zq_float(key: str, sub: str, fallback: float) -> float:
    if _ZHUQUE_DATA is None:
        return fallback
    try:
        return float(_ZHUQUE_DATA.get(key, {}).get(sub, fallback))
    except (TypeError, ValueError):
        return fallback


def _zq_tuple(key: str, sub: str, fallback: tuple[str, ...]) -> tuple[str, ...]:
    if _ZHUQUE_DATA is None:
        return fallback
    val = _ZHUQUE_DATA.get(key, {}).get(sub)
    if isinstance(val, list) and val:
        return tuple(str(v) for v in val)
    return fallback


# 朱雀检测实际使用的阈值（启动时确定）
ZHUQUE_SENTENCE_LENGTH_STD_MIN: int = _zq_int("sentence_length_std", "min_sigma", _FALLBACK_ZHUQUE_SENTENCE_STD_MIN)
ZHUQUE_MIN_PARAGRAPHS: int = _zq_int("sentence_length_std", "min_paragraphs_required", _FALLBACK_ZHUQUE_MIN_PARAGRAPHS)
ZHUQUE_MIN_SENTENCES: int = _zq_int("sentence_length_std", "min_sentences_required", _FALLBACK_ZHUQUE_MIN_SENTENCES)
ZHUQUE_SHORT_SENTENCE_RATIO_MIN: float = _zq_float("sentence_length_std", "short_sentence_ratio_min", _FALLBACK_ZHUQUE_SHORT_RATIO_MIN)
ZHUQUE_SHORT_SENTENCE_THRESHOLD: int = _zq_int("sentence_length_std", "short_sentence_threshold", _FALLBACK_ZHUQUE_SHORT_THRESHOLD)

ZHUQUE_TRANSITION_PER_1K_MAX: int = _zq_int("transition_word_density", "per_1k_max", _FALLBACK_ZHUQUE_TRANSITION_PER_1K_MAX)
ZHUQUE_MIN_CHARS_FOR_DENSITY: int = _zq_int("transition_word_density", "min_chars_for_density", _FALLBACK_ZHUQUE_MIN_CHARS_FOR_DENSITY)
ZHUQUE_TRANSITION_WORDS: tuple[str, ...] = _zq_tuple("transition_word_density", "transition_words", _FALLBACK_ZHUQUE_TRANSITION_WORDS)

ZHUQUE_EM_DASH_PER_1K_MAX: int = _zq_int("em_dash_frequency", "per_1k_max", _FALLBACK_ZHUQUE_EM_DASH_PER_1K_MAX)

ZHUQUE_MIN_DIALOGUES: int = _zq_int("dialogue_template_uniformity", "min_dialogues", _FALLBACK_ZHUQUE_MIN_DIALOGUES)
ZHUQUE_DIALOGUE_CV_MIN: float = _zq_float("dialogue_template_uniformity", "sentence_length_cv_min", _FALLBACK_ZHUQUE_DIALOGUE_CV_MIN)
ZHUQUE_DIALOGUE_HEAD_REPEAT_MAX: float = _zq_float("dialogue_template_uniformity", "head_word_repeat_max", _FALLBACK_ZHUQUE_DIALOGUE_HEAD_REPEAT_MAX)

ZHUQUE_EMOTION_MIN_PARAGRAPHS: int = _zq_int("emotion_tone_volatility", "min_paragraphs", _FALLBACK_ZHUQUE_EMOTION_MIN_PARAGRAPHS)
ZHUQUE_EMOTION_SIGMA_MIN: float = _zq_float("emotion_tone_volatility", "sigma_min", _FALLBACK_ZHUQUE_EMOTION_SIGMA_MIN)
ZHUQUE_EMOTION_POSITIVE: tuple[str, ...] = _zq_tuple("emotion_tone_volatility", "positive_words", _FALLBACK_ZHUQUE_EMOTION_POSITIVE)
ZHUQUE_EMOTION_NEGATIVE: tuple[str, ...] = _zq_tuple("emotion_tone_volatility", "negative_words", _FALLBACK_ZHUQUE_EMOTION_NEGATIVE)
```

**4.2 新增 em-dash 正则**（在已有正则区追加）：

```python
# em-dash 正则：匹配 —— 或 单个 U+2014
_EM_DASH_RE: re.Pattern[str] = re.compile(r'\u2014{1,2}')
```

**4.3 在 `DIMENSIONS` 注册表追加 5 项**（修改行 1012-1023）：

```python
DIMENSIONS: list[tuple[str, str, Any]] = [
    ("ai_word", "AI 感词", check_ai_word),
    ("opening_flat", "开局平庸", check_opening_flat),
    ("info_dump", "信息倾倒", check_info_dump),
    ("golden_finger", "金手指滥用", check_golden_finger),
    ("plot_cliche", "爽点套路化", check_plot_cliche),
    ("chapter_end_hook", "章末钩子缺失", check_chapter_end_hook),
    ("word_count", "字数控制", check_word_count),
    ("dialogue_identity", "对话身份", check_dialogue_identity),
    ("psycho_physio", "心理-生理映射", check_psycho_physio),
    ("rhythm", "句式节奏", check_rhythm),
    # M9 朱雀七维度对抗（5 类量化检测）
    ("zhuque_sentence_length_std", "朱雀·句长标准差", check_sentence_length_std),
    ("zhuque_transition_word_density", "朱雀·转折词密度", check_transition_word_density),
    ("zhuque_em_dash_frequency", "朱雀·em-dash 频率", check_em_dash_frequency),
    ("zhuque_dialogue_template_uniformity", "朱雀·对话模板化", check_dialogue_template_uniformity),
    ("zhuque_emotion_tone_volatility", "朱雀·情感基调波动", check_emotion_tone_volatility),
]
```

**4.4 在 CLI 新增 `--debug-zhuque` 参数**（修改 `_build_arg_parser`，在 `--dim` 参数后追加）：

```python
parser.add_argument(
    "--debug-zhuque", action="store_true",
    help="调试模式：仅运行朱雀七维度 5 类量化检测，过滤其他维度",
)
```

**4.5 在 `main` 函数处理 `--debug-zhuque`**（在 `report = check_all(...)` 之后追加过滤逻辑）：

```python
if args.debug_zhuque:
    # 仅保留朱雀 5 类检测的 issues 与 passed_dims
    zhuque_dim_names = {
        "zhuque_sentence_length_std", "zhuque_transition_word_density",
        "zhuque_em_dash_frequency", "zhuque_dialogue_template_uniformity",
        "zhuque_emotion_tone_volatility",
    }
    report.issues = [i for i in report.issues if i.type.startswith("zhuque_")]
    report.passed_dims = [d for d in report.passed_dims if "朱雀" in d]
    report.dimensions_checked = 5
    report.p0_count = sum(1 for i in report.issues if i.severity == "P0")
    report.p1_count = sum(1 for i in report.issues if i.severity == "P1")
    report.p2_count = sum(1 for i in report.issues if i.severity == "P2")
```

### 步骤 5：writer-polisher SKILL.md 内化「铁律 6：朱雀七维度对抗」

**目标**：在 `writer-polisher` SKILL.md 的「去 AI 味铁律」章节，于「铁律 5：章末钩子」之后追加「铁律 6」，将 5 类量化检测的阈值与对抗手段固化为写手生成时必须内化的硬约束。

**修改位置**：`/workspace/.trae/skills/writer-polisher/SKILL.md` 行 296-300（「铁律 5：章末钩子」结束后、「# 错误处理」之前）。

**追加内容**：

```markdown
## 铁律 6：朱雀七维度对抗（量化检测）

> 朱雀（腾讯混元安全团队）对纯 AI 生成内容识别率 95%+，2025-05 算法升级后番茄单月拒签 11.27 万本 AI 网文。以下 5 项量化指标在 `check_ai_novel.py` 强制检测，阈值配置见 `scripts/novelforge/data/zhuque_metrics.json`。写手生成时必须主动规避，精修时按此核对。

| 维度 | 量化指标 | 阈值（人类下限） | 写手对策 |
|---|---|---|---|
| 爆发性 Burstiness | 全章句长标准差 σ | σ ≥ 10 字 | 每段至少包含 1 个 < 8 字短句 + 1 个 > 25 字长句；放弃 AI 式均匀节奏 |
| 困惑度 PPL（代理） | 短句（< 8 字）占比 | ≥ 15% | 加入短促有力的句子（「他愣住了。」「不可能。」）提升 PPL |
| 语义连贯性 | 旁白转折词密度 | ≤ 3 个/千字 | 段落间用场景跳切替代「此外/然而/另一方面」教科书过渡 |
| 语义连贯性 | em-dash（——）频率 | ≤ 1 个/千字 | 改用句号断句，或用具体动作替代（「他沉默了——」改为「他沉默了。手指无意识地敲着桌面。」） |
| 创作风格匹配 | 多角色对话句长变异系数 CV | CV ≥ 0.20 | 不同角色台词长度必须有差异；禁止多角色用同一语气说不同台词 |
| 情感一致性 | 情感基调 σ | σ ≥ 0.30 | 情节驱动情绪波动，禁止全文机械统一基调（朱雀维度 6） |

**朱雀红线（绝对禁用）**：

- ❌ 段首词连续 3 段以上重复（含转折词开篇）
- ❌ 多角色对话句长 CV < 0.20（多角色用一个模板）
- ❌ 全章句长 σ < 8 字（朱雀维度 2 爆发性过低，AI 文特征）
- ❌ 旁白转折词 > 10 个/千字（朱雀维度 3 教科书级过渡）

**精修核对顺序**（朱雀 5 类检测出问题时的修复优先级）：

1. P1 级（句长 σ 低 / 转折词密度高 / 对话模板化）→ 必须修复，定点重写
2. P2 级（短句占比低 / em-dash 频率高 / 情感基调 σ 低）→ 建议修复，可批量替换

**与既有铁律的关系**：

- 铁律 1-5 是「定性约束」（禁用词、禁用句式、章末钩子等），覆盖朱雀维度 1/4/5 的部分场景。
- 铁律 6 是「定量约束」（5 类量化指标），补齐朱雀维度 2/3/6/7 的盲区。
- 二者并行生效，互不替代：定性约束管「不能用什么词」，定量约束管「整体节奏与分布」。
```

**关联改动**：SKILL.md 的「输出格式」示例中，去 AI 味检测维度数从 `10 维度检测` 改为 `15 维度检测`（朱雀 5 类加入后总数）。同时将「审计」段的输出示例调整为：

```text
🔍 审计：
  一致性：7 维度检测，P0=0 P1=1（伏笔遗忘 H-014，建议下章提醒）
  去 AI 味：15 维度检测，P0=0 P1=1（朱雀·转折词密度超标，建议精修）P2=2（心理描写悬空 2 处，已修复）
```

### 步骤 6：与现有 10 维检测的关系（补充而非替代）

**核心原则**：朱雀 5 类量化检测是现有 10 维检测的**补充而非替代**，二者并行运行，互不覆盖。

**6.1 检测维度对照表**：

| 维度类别 | 现有 10 维（M3 后 13 维） | 朱雀 5 类量化检测 | 关系 |
|---|---|---|---|
| 词级 | ai_word（禁用词 / 控量词 / 翻译腔 / 古今冲突 / 时间副词堆砌） | — | 现有覆盖 |
| 句级 | opening_flat / chapter_end_hook / rhythm（段内 σ） | sentence_length_std（全章 σ）/ em_dash_frequency | 现有管段内，朱雀管全章；em-dash 是新维度 |
| 段级 | info_dump / plot_cliche / golden_finger / word_count | transition_word_density（旁白转折词密度） | 现有管内容，朱雀管过渡 |
| 篇级 | dialogue_identity（角色指纹）/ psycho_physio（心理-生理映射） | dialogue_template_uniformity（多角色模板化）/ emotion_tone_volatility（情感基调 σ） | 现有管单角色，朱雀管多角色协调与全文情感曲线 |

**6.2 互补场景示例**：

- **现有检测抓不到的 AI 文**（朱雀补齐）：

  ```
  此外，主角的内心充满了矛盾。然而，他依然选择了前行。
  另一方面，他知道这是必须的。综上所述，这是一个艰难的决定。
  ```

  现有 10 维检测：无禁用词、无信息倾倒、无套路化、章末有钩子 → **通过**。
  朱雀检测：转折词密度 12/千字（>3）、句长 σ = 6.2 字（<10）→ **P1 阻断**。

- **朱雀检测抓不到的 AI 文**（现有补齐）：

  ```
  他猛地转身。剑光如电。对手应声倒地。一切归于平静。
  ```

  朱雀检测：句长 σ 高、转折词密度低、em-dash 0、情感 σ 可接受 → **通过**。
  现有检测：心理-生理映射缺失（"猛地转身"无生理反应）、爽点套路化（剑光如电+应声倒地）→ **P1 阻断**。

**6.3 DIMENSIONS 注册表的执行顺序**：

`check_ai_novel.py` 的 `DIMENSIONS` 注册表是顺序执行的列表。朱雀 5 类追加在末尾（位置 11-15），不影响现有 10 维的执行顺序与结果。所有 Issue 在最终报告中合并呈现，按 severity（P0 > P1 > P2）排序。

**6.4 阈值冲突的处理原则**：

- 若朱雀检测与现有检测对同一现象给出不同 severity（如 em-dash 同时被 `rhythm` 检测为 P2 和被 `em_dash_frequency` 检测为 P2），取较高 severity，不重复计数。
- 若朱雀检测与现有检测阈值不一致（如 `rhythm` 段内 σ 阈值 5 vs `sentence_length_std` 全章 σ 阈值 10），二者独立判断，互不干扰——段内 σ 管段落节奏，全章 σ 管全章爆发性，二者关注的 AI 文特征不同。

---

## 六、验证方式

### 6.1 单元测试

**命令**：

```bash
pytest -q tests/test_zhuque_anti_ai.py
```

**断言清单**（7 个测试用例，详见 §七）：

1. `test_sentence_length_std_detection`：全章句长 σ < 10 时触发 P1
2. `test_transition_word_density_detection`：旁白转折词 > 3/千字时触发 P1
3. `test_em_dash_frequency_detection`：em-dash > 1/千字时触发 P2
4. `test_dialogue_template_uniformity_detection`：多角色对话 CV < 0.20 时触发 P1
5. `test_emotion_tone_volatility_detection`：情感基调 σ < 0.30 时触发 P2
6. `test_zhuque_metrics_json_valid`：`zhuque_metrics.json` schema 校验通过（必填字段齐全 + 类型正确）
7. `test_human_writing_not_false_positive`：人类样本（人类作家短篇）通过所有 5 类朱雀检测，无误报

### 6.2 集成测试

**命令 1（全量检测）**：

```bash
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
```

**期望输出**：检测维度数从 10 升至 15；朱雀 5 类在 `dimensions_checked` 字段中体现；若有朱雀相关 Issue，type 以 `zhuque_` 前缀呈现。

**命令 2（仅朱雀调试）**：

```bash
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault --debug-zhuque
```

**期望输出**：`dimensions_checked: 5`；`passed_dims` 中只包含含「朱雀」字样的维度；`issues` 中只包含 `type` 以 `zhuque_` 开头的项。便于作者单独调参验证。

### 6.3 断言清单（朱雀 5 类检测的行为契约）

| 检测函数 | 输入样本 | 期望触发 | 期望 severity | 期望 type |
|---|---|---|---|---|
| `check_sentence_length_std` | 30 段、每段 5 句、句长全部 15 字 | 全章 σ ≈ 0 < 10 | P1 | `zhuque_sentence_length_low` |
| `check_sentence_length_std` | 30 段、短句占比 5% < 15% | 短句占比低 | P2 | `zhuque_short_sentence_rare` |
| `check_transition_word_density` | 2000 字旁白含 8 个「此外/然而」 | 8/2 = 4 > 3 | P1 | `zhuque_transition_word_dense` |
| `check_em_dash_frequency` | 2000 字含 5 个 `——` | 5/2 = 2.5 > 1 | P2 | `zhuque_em_dash_dense` |
| `check_dialogue_template_uniformity` | 8 句对话句长全 12 字（CV ≈ 0） | CV < 0.20 | P1 | `zhuque_dialogue_length_uniform` |
| `check_dialogue_template_uniformity` | 8 句对话 5 句以「他说」开头 | 重复率 62.5% > 30% | P1 | `zhuque_dialogue_head_repeat` |
| `check_emotion_tone_volatility` | 10 段全用中性词 | σ ≈ 0 < 0.30 | P2 | `zhuque_emotion_tone_flat` |

### 6.4 与现有校验脚本的关系

- **不冲突**：朱雀 5 类检测追加在 `DIMENSIONS` 末尾，不修改现有 10 维检测函数的签名与行为。
- **补充**：朱雀检测关注全章级量化指标（σ / CV / 密度），现有检测关注段落级与词级，二者互补。
- **集成入口统一**：所有检测通过 `check_all(content, ctx)` 统一调度，作者只需运行一条命令即可获得全量报告。
- **CI 兼容**：`check_ai_novel.py` 退出码逻辑不变（P0 → exit 1，P1/P2 → exit 0 + warning），新增朱雀 P1 不改变退出码策略，但会在报告中明确呈现。

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

**文件路径**：`/workspace/tests/test_zhuque_anti_ai.py`

**7 个测试用例**：

#### 用例 1：`test_sentence_length_std_detection`

```python
def test_sentence_length_std_detection():
    """朱雀·句长标准差检测：全章 σ < 10 触发 P1。"""
    from scripts.novelforge.check_ai_novel import check_sentence_length_std, CheckContext
    # 构造 30 段、每段 5 句、句长全部 15 字的样本
    sample = build_uniform_length_sample(paragraphs=30, sentences_per_para=5, sent_len=15)
    ctx = CheckContext(workspace_root=WORKSPACE_ROOT, fingerprints={})
    issues = check_sentence_length_std(sample, ctx)
    assert any(i.type == "zhuque_sentence_length_low" and i.severity == "P1" for i in issues), \
        f"应触发 zhuque_sentence_length_low P1，实际 issues: {issues}"
```

#### 用例 2：`test_transition_word_density_detection`

```python
def test_transition_word_density_detection():
    """朱雀·转折词密度检测：旁白转折词 > 3/千字 触发 P1。"""
    from scripts.novelforge.check_ai_novel import check_transition_word_density, CheckContext
    # 构造 2000 字旁白含 8 个转折词（此外×3 / 然而×3 / 综上所述×2）
    sample = build_narration_with_transitions(total_chars=2000, transition_count=8)
    ctx = CheckContext(workspace_root=WORKSPACE_ROOT, fingerprints={})
    issues = check_transition_word_density(sample, ctx)
    assert any(i.type == "zhuque_transition_word_dense" and i.severity == "P1" for i in issues), \
        f"应触发 zhuque_transition_word_dense P1，实际 issues: {issues}"
```

#### 用例 3：`test_em_dash_frequency_detection`

```python
def test_em_dash_frequency_detection():
    """朱雀·em-dash 频率检测：> 1/千字 触发 P2。"""
    from scripts.novelforge.check_ai_novel import check_em_dash_frequency, CheckContext
    # 构造 2000 字含 5 个 ——
    sample = build_text_with_em_dashes(total_chars=2000, em_dash_count=5)
    ctx = CheckContext(workspace_root=WORKSPACE_ROOT, fingerprints={})
    issues = check_em_dash_frequency(sample, ctx)
    assert any(i.type == "zhuque_em_dash_dense" and i.severity == "P2" for i in issues), \
        f"应触发 zhuque_em_dash_dense P2，实际 issues: {issues}"
```

#### 用例 4：`test_dialogue_template_uniformity_detection`

```python
def test_dialogue_template_uniformity_detection():
    """朱雀·对话模板化检测：多角色对话 CV < 0.20 触发 P1。"""
    from scripts.novelforge.check_ai_novel import (
        check_dialogue_template_uniformity, CheckContext,
    )
    # 构造 8 句对话、句长全 12 字（CV ≈ 0）
    sample = build_uniform_dialogue_sample(dialogue_count=8, sent_len=12)
    ctx = CheckContext(workspace_root=WORKSPACE_ROOT, fingerprints={})
    issues = check_dialogue_template_uniformity(sample, ctx)
    assert any(i.type == "zhuque_dialogue_length_uniform" and i.severity == "P1" for i in issues), \
        f"应触发 zhuque_dialogue_length_uniform P1，实际 issues: {issues}"

    # 构造 8 句对话 5 句以「他说」开头
    sample2 = build_dialogue_with_repeated_head(dialogue_count=8, head="他说", repeat=5)
    issues2 = check_dialogue_template_uniformity(sample2, ctx)
    assert any(i.type == "zhuque_dialogue_head_repeat" and i.severity == "P1" for i in issues2), \
        f"应触发 zhuque_dialogue_head_repeat P1，实际 issues: {issues2}"
```

#### 用例 5：`test_emotion_tone_volatility_detection`

```python
def test_emotion_tone_volatility_detection():
    """朱雀·情感基调波动检测：σ < 0.30 触发 P2。"""
    from scripts.novelforge.check_ai_novel import (
        check_emotion_tone_volatility, CheckContext,
    )
    # 构造 10 段全用中性词的样本
    sample = build_neutral_emotion_sample(paragraphs=10)
    ctx = CheckContext(workspace_root=WORKSPACE_ROOT, fingerprints={})
    issues = check_emotion_tone_volatility(sample, ctx)
    assert any(i.type == "zhuque_emotion_tone_flat" and i.severity == "P2" for i in issues), \
        f"应触发 zhuque_emotion_tone_flat P2，实际 issues: {issues}"
```

#### 用例 6：`test_zhuque_metrics_json_valid`

```python
def test_zhuque_metrics_json_valid():
    """zhuque_metrics.json schema 校验：必填字段齐全 + 类型正确。"""
    import json
    from pathlib import Path
    path = Path(WORKSPACE_ROOT) / "scripts" / "novelforge" / "data" / "zhuque_metrics.json"
    data = json.loads(path.read_text(encoding="utf-8"))

    # 必填分类键
    required_keys = {
        "sentence_length_std", "transition_word_density", "em_dash_frequency",
        "dialogue_template_uniformity", "emotion_tone_volatility", "_meta",
    }
    assert required_keys.issubset(data.keys()), \
        f"缺少分类键: {required_keys - set(data.keys())}"

    # 各分类必填字段
    for key in required_keys - {"_meta"}:
        sub = data[key]
        assert "description" in sub, f"{key} 缺 description"
        assert "severity" in sub, f"{key} 缺 severity"
        assert sub["severity"] in {"P0", "P1", "P2"}, f"{key} severity 非法: {sub['severity']}"

    # sentence_length_std 阈值类型
    sl = data["sentence_length_std"]
    assert isinstance(sl["min_sigma"], (int, float)) and sl["min_sigma"] > 0
    assert isinstance(sl["short_sentence_ratio_min"], (int, float)) and 0 < sl["short_sentence_ratio_min"] < 1

    # transition_word_density 词表非空
    tw = data["transition_word_density"]
    assert isinstance(tw["transition_words"], list) and len(tw["transition_words"]) > 0
```

#### 用例 7：`test_human_writing_not_false_positive`

```python
def test_human_writing_not_false_positive():
    """人类写作样本不误报：5 类朱雀检测全部通过。"""
    from scripts.novelforge.check_ai_novel import (
        check_sentence_length_std, check_transition_word_density,
        check_em_dash_frequency, check_dialogue_template_uniformity,
        check_emotion_tone_volatility, CheckContext,
    )
    # 读取 tests/fixtures/human_sample_ch001.md（人类作家短篇样本）
    sample = (Path(WORKSPACE_ROOT) / "tests" / "fixtures" / "human_sample_ch001.md").read_text(encoding="utf-8")
    ctx = CheckContext(workspace_root=WORKSPACE_ROOT, fingerprints={})

    issues = []
    issues += check_sentence_length_std(sample, ctx)
    issues += check_transition_word_density(sample, ctx)
    issues += check_em_dash_frequency(sample, ctx)
    issues += check_dialogue_template_uniformity(sample, ctx)
    issues += check_emotion_tone_volatility(sample, ctx)

    # 人类样本允许少量 P2（如偶用 em-dash），但不应有 P1
    p1_issues = [i for i in issues if i.severity == "P1"]
    assert not p1_issues, \
        f"人类样本误报 P1: {[(i.type, i.detail) for i in p1_issues]}"
```

**辅助 fixture**：

- `tests/fixtures/human_sample_ch001.md`：人类作家公开短篇样本（≥ 3000 字、≥ 10 段、含对话），用于用例 7 验证不误报。
- `tests/test_zhuque_anti_ai.py` 内的 `build_*` helper 函数：构造极小可复现样本，避免依赖外部数据。

### 7.2 新增 Bug 回归记录

**文件路径**：`/workspace/tests/bug_regression_list.md`

**追加内容**：

```markdown
## 朱雀七维度对抗规则未沉淀导致 AI 文特征检测不全

- **编号**：BUG-059
- **首次出现**：2026-07-18
- **类型**：去 AI 味 / 上下文预算
- **现象**：NovelForge 现有 `check_ai_novel.py` 10 维检测未覆盖朱雀七维度（腾讯混元安全团队，AI 文识别率 95%+）中的句长标准差、转折词密度、em-dash 频率、对话模板化、情感基调波动等量化指标，导致符合现有 10 维检测的章节仍可能被朱雀识别为 AI 文并被平台（如番茄 2026-05 单月拒签 11.27 万本）下架。
- **根因**：
  1. 现有 `check_rhythm` 仅做段内句长 σ 检测（`RHYTHM_STDDEV_MIN=5`），未做全章 σ；
  2. 现有 `check_dialogue_identity` 仅做单角色指纹校验，未做多角色对话模板统一性检测；
  3. 转折词密度、em-dash 频率、情感基调波动三类量化指标完全缺失；
  4. 朱雀七维度中维度 2/3/6/7 是 AI 文检测的核心维度，缺失会导致 NovelForge 输出无法通过平台 AI 检测。
- **修复**：
  1. 在 `scripts/novelforge/check_ai_novel.py` 新增 5 类量化检测函数（`check_sentence_length_std` / `check_transition_word_density` / `check_em_dash_frequency` / `check_dialogue_template_uniformity` / `check_emotion_tone_volatility`）；
  2. 新增 `scripts/novelforge/data/zhuque_metrics.json` 阈值 SSOT，沿用 M3 的 SSOT 加载 + fallback 硬编码模式；
  3. 在 `DIMENSIONS` 注册表追加 5 项；
  4. 新增 `--debug-zhuque` CLI 参数，便于作者单独调参验证；
  5. 在 `style_guide.md` 新增 §六「朱雀七维度对抗铁律」章节；
  6. 在 `writer-polisher` SKILL.md 新增「铁律 6：朱雀七维度对抗」，内化 5 类阈值。
- **涉及文件**：
  - `scripts/novelforge/check_ai_novel.py`（新增 5 类检测 + DIMENSIONS 追加 + CLI 参数）
  - `scripts/novelforge/data/zhuque_metrics.json`（新增）
  - `NovelForge_Vault/00_控制面/style_guide.md`（新增 §六）
  - `.trae/skills/writer-polisher/SKILL.md`（新增铁律 6）
  - `.trae/checklists/dev-checklist.md`（§八 新增朱雀量化检测项）
- **回归测试**：
  - `tests/test_zhuque_anti_ai.py` 新增 7 个测试用例（见 §7.1）
  - `tests/fixtures/human_sample_ch001.md` 人类样本 fixture
- **教训/沉淀**：
  - 去 AI 味检测必须覆盖「学术检测模型视角」（朱雀七维度），不能只看「读者感知视角」（禁用词/翻译腔/套路化）。
  - 量化指标（σ / CV / 密度）必须配置化（`zhuque_metrics.json`），便于按风格调参，避免误伤人类写作。
  - 朱雀七维度中维度 1（PPL）需要参考 LLM 计算 log-prob，NovelForge 用「句长标准差 + 短句占比」代理，是工程上的折中——后续若引入本地 LLM 可升级为真实 PPL 检测。
  - #lesson content_quality #lesson state_drift
```

### 7.3 在 `check_ai_novel.py` 中新增的检测规则

| 维度名 | 检测函数 | severity | 触发条件 | type 前缀 |
|---|---|---|---|---|
| `zhuque_sentence_length_std` | `check_sentence_length_std` | P1/P2 | 全章句长 σ < 10（P1）/ 短句占比 < 15%（P2） | `zhuque_sentence_length_low` / `zhuque_short_sentence_rare` |
| `zhuque_transition_word_density` | `check_transition_word_density` | P1 | 旁白转折词 > 3 个/千字 | `zhuque_transition_word_dense` |
| `zhuque_em_dash_frequency` | `check_em_dash_frequency` | P2 | em-dash > 1 个/千字 | `zhuque_em_dash_dense` |
| `zhuque_dialogue_template_uniformity` | `check_dialogue_template_uniformity` | P1 | 多角色对话 CV < 0.20 / 句首词重复率 > 30% | `zhuque_dialogue_length_uniform` / `zhuque_dialogue_head_repeat` |
| `zhuque_emotion_tone_volatility` | `check_emotion_tone_volatility` | P2 | 情感基调 σ < 0.30 | `zhuque_emotion_tone_flat` |

### 7.4 完整测试集执行

修复完成后，按 `.trae/rules/dev-workflow.md` 第三步要求执行完整测试集：

```bash
# 一致性检测（不应受 M9 影响）
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault

# 去 AI 味检测（应包含朱雀 5 类）
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault

# pytest 全集（含新增 test_zhuque_anti_ai.py）
pytest -q

# SSOT 一致性校验（M3 引入，验证 zhuque_metrics.json 与 style_guide.md §六 对齐）
python scripts/check_doc_script_consistency.py
```

所有命令退出码必须为 0（P1/P2 在 `check_ai_novel.py` 中不阻断退出码，但 pytest 必须全过）。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**中**。

**理由**：

- 5 类量化检测均依赖阈值（σ / CV / 密度），阈值过严会误伤人类写作（特别是节奏均匀的抒情段、对话密集的速写段）；阈值过松会放过 AI 文特征。
- 朱雀官方未公开阈值细节（仅给区间），NovelForge 取人类下限作为阈值，需要用真实人类样本验证。
- em-dash 在中文网文中有合法使用场景（如引出补充说明、强调语气），完全禁用会损伤表达力；只能按密度控量。
- 多角色对话模板化检测依赖「句长 CV」和「句首词重复率」两个粗粒度指标，无法识别「同模板不同句长」的高级模板化。

### 8.2 对核心资产的影响

| 资产 | 影响 | 风险描述 |
|---|---|---|
| `scripts/novelforge/check_ai_novel.py` | **修改** | 新增 5 类检测函数 + DIMENSIONS 追加 5 项 + CLI 参数。若函数实现有 bug（如除零、空列表 σ），可能阻断全章检测流程。 |
| `scripts/novelforge/data/zhuque_metrics.json` | **新增** | 阈值 SSOT，无现有依赖。若 JSON schema 不规范，会导致 `_load_zhuque_metrics_json` 解析失败回退 fallback，但 fallback 与 JSON 应保持一致。 |
| `NovelForge_Vault/00_控制面/style_guide.md` | **修改** | 新增 §六「朱雀七维度对抗铁律」。若章节内容与 `zhuque_metrics.json` 阈值不一致，M3 的 `check_doc_script_consistency.py` 会报警。 |
| `.trae/skills/writer-polisher/SKILL.md` | **修改** | 新增「铁律 6」。若铁律内容与 `style_guide.md` §六 不一致，会导致写手生成时内化的规则与文档宪法分叉。 |
| `.trae/checklists/dev-checklist.md` | **修改** | §八 新增朱雀量化检测项。影响范围小，仅作为提醒项。 |
| `tests/bug_regression_list.md` | **修改** | 新增 BUG-059。纯文档追加，无风险。 |

### 8.3 风险点清单

| # | 风险 | 触发条件 | 缓解措施 |
|---|---|---|---|
| R1 | 阈值误伤人类写作 | 抒情段句长均匀（σ < 10）但属人类风格 | 用 `tests/fixtures/human_sample_ch001.md` 验证；阈值可在 `zhuque_metrics.json` 调参 |
| R2 | em-dash 完全禁用损伤表达 | 网文作者习惯用 —— 引出心理活动 | em-dash 检测为 P2（不阻断），仅密度 > 1/千字时报警 |
| R3 | 对话模板化误报 | 短戏份（< 6 句对话）CV 偶然低 | `min_dialogues=6` 阈值，章内 < 6 句对话不检测 |
| R4 | 情感基调 σ 计算依赖词表 | 情感词表覆盖不全（如未收录"愣住""哑然"） | 词表从 `zhuque_metrics.json` 加载，可扩展；fallback 词表覆盖 50+ 常见情感词 |
| R5 | 朱雀 5 类检测增加 CI 时长 | 全章扫描 + 统计计算 | 5 类检测均为 O(n) 线性扫描，对 3000 字章节耗时 < 50ms，可忽略 |
| R6 | `--debug-zhuque` 过滤逻辑破坏现有 CLI 行为 | `report.issues` 被 in-place 修改 | 仅在 `args.debug_zhuque` 为 True 时过滤，正常流程不受影响 |
| R7 | 朱雀 P1 与现有 P1 重复计数 | 同一现象被 rhythm 与 sentence_length_std 同时检出 | §6.4 已规定取较高 severity，不重复计数；但实现上需在 `check_all` 后做去重 |

### 8.4 回滚方案

**回滚路径 1（最小回滚，仅回滚代码）**：

```bash
# 1. 切回主分支
git checkout master

# 2. 验证 check_ai_novel.py 仍为 10 维（无朱雀）
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault --help | grep -i zhuque
# 期望：无输出（无 --debug-zhuque 参数）
```

**回滚路径 2（保留代码、仅关闭朱雀检测）**：

在 `zhuque_metrics.json` 中将所有阈值调到极大（如 `min_sigma: 999`、`per_1k_max: 999`），使 5 类检测永不触发，但保留函数实现与 CLI 参数。适合「先上线代码、灰度验证后再启用」的场景。

```json
{
  "sentence_length_std": {"min_sigma": 999, ...},
  "transition_word_density": {"per_1k_max": 999, ...},
  "em_dash_frequency": {"per_1k_max": 999, ...},
  "dialogue_template_uniformity": {"sentence_length_cv_min": 0.0, ...},
  "emotion_tone_volatility": {"sigma_min": 0.0, ...}
}
```

**回滚路径 3（分支隔离，推荐）**：

- 在 `feature/zhuque-anti-ai` 分支开发，合并前完整跑测试集；
- 若合并后发现问题，`git revert <merge_commit>` 一键回滚；
- `zhuque_metrics.json` 与 `style_guide.md` §六 可保留（文档不影响功能），仅回滚 `check_ai_novel.py` 与 `writer-polisher/SKILL.md`。

**数据备份**：

- 修改前备份 `check_ai_novel.py`：`cp scripts/novelforge/check_ai_novel.py scripts/novelforge/check_ai_novel.py.bak`
- 修改前备份 `style_guide.md`：`cp NovelForge_Vault/00_控制面/style_guide.md NovelForge_Vault/00_控制面/style_guide.md.bak`
- 修改前备份 `writer-polisher/SKILL.md`：`cp .trae/skills/writer-polisher/SKILL.md .trae/skills/writer-polisher/SKILL.md.bak`

---

## 九、完成标准（DoD 清单）

### 9.1 代码层

- [ ] `scripts/novelforge/data/zhuque_metrics.json` 已创建，包含 5 个分类键（`sentence_length_std` / `transition_word_density` / `em_dash_frequency` / `dialogue_template_uniformity` / `emotion_tone_volatility`）+ `_meta`，每分类含 `description` / `severity` / 阈值字段。
- [ ] `scripts/novelforge/check_ai_novel.py` 新增 5 类量化检测函数，函数签名与 §五 步骤 1 一致；每个函数返回 `list[Issue]`，Issue 的 `type` 以 `zhuque_` 前缀。
- [ ] `DIMENSIONS` 注册表追加 5 项，位置在现有 10 项之后，顺序与 §五 步骤 4.3 一致。
- [ ] 新增 `_load_zhuque_metrics_json` 函数，沿用 M3 的 SSOT 加载 + fallback 硬编码模式（JSON 缺失时打 warning 并用 fallback）。
- [ ] 新增 `--debug-zhuque` CLI 参数，`main` 函数中正确处理过滤逻辑（仅保留 `zhuque_` 前缀的 issues 与含「朱雀」的 passed_dims）。
- [ ] 5 类检测函数均使用 `statistics` 标准库计算 σ / CV，无外部依赖（如 numpy / sklearn）。

### 9.2 文档层

- [ ] `NovelForge_Vault/00_控制面/style_guide.md` 在 §五 修订历史之前新增 §六「朱雀七维度对抗铁律」章节，包含 6.1 朱雀七维度映射表 / 6.2 七维度对抗手段 / 6.3 自检清单。
- [ ] `.trae/skills/writer-polisher/SKILL.md` 在「铁律 5：章末钩子」之后追加「铁律 6：朱雀七维度对抗」，内化 5 类阈值与对抗手段；输出格式示例中维度数从 10 改为 15。
- [ ] `.trae/checklists/dev-checklist.md` §八 去 AI 味新增「朱雀七维度量化检测」项，引用 `zhuque_metrics.json` 与 `--debug-zhuque`。
- [ ] `tests/bug_regression_list.md` 新增 BUG-059「朱雀七维度对抗规则未沉淀导致 AI 文特征检测不全」，字段齐全（编号 / 现象 / 根因 / 修复 / 涉及文件 / 回归测试 / 教训）。

### 9.3 测试层

- [ ] `tests/test_zhuque_anti_ai.py` 已创建，7 个测试用例全部通过：
  - [ ] `test_sentence_length_std_detection`
  - [ ] `test_transition_word_density_detection`
  - [ ] `test_em_dash_frequency_detection`
  - [ ] `test_dialogue_template_uniformity_detection`
  - [ ] `test_emotion_tone_volatility_detection`
  - [ ] `test_zhuque_metrics_json_valid`
  - [ ] `test_human_writing_not_false_positive`
- [ ] `tests/fixtures/human_sample_ch001.md` 已创建（人类作家短篇样本，≥ 3000 字、≥ 10 段、含对话），用例 7 验证不误报 P1。
- [ ] `pytest -q tests/test_zhuque_anti_ai.py` 全部通过，无 failed / error。
- [ ] `pytest -q` 全集通过（不引入新的失败用例）。

### 9.4 集成层

- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 输出 `dimensions_checked: 15`，无报错。
- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault --debug-zhuque` 输出 `dimensions_checked: 5`，仅含朱雀相关 issues。
- [ ] `python scripts/check_doc_script_consistency.py` 通过（`zhuque_metrics.json` 与 `style_guide.md` §六 分类键对齐）。
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 退出码 0（M9 不影响一致性检测）。

### 9.5 哲学层（NovelForge 核心哲学对齐）

- [ ] **去 AI 味第一公民**：朱雀 5 类检测作为独立维度加入 `DIMENSIONS`，与现有 10 维并列，不降级为子检测。
- [ ] **文件即真相**：阈值 SSOT 集中在 `zhuque_metrics.json`，`style_guide.md` 通过引用方式同步，`check_doc_script_consistency.py` 校验对齐。
- [ ] **Skill 编排**：朱雀对抗铁律通过 `writer-polisher` SKILL.md 内化，写手生成时即规避，不依赖事后检测。
- [ ] **Delta 增量**：本模块新增的 5 类检测与 `save_state.py` 无耦合（不写入状态机），不影响 Delta 增量机制。
- [ ] **防漂移三铁律**：朱雀 5 类检测不依赖历史正文，仅扫描当前章节，不违反「不注入历史正文」铁律。

### 9.6 验收命令一键运行

```bash
# 一键验收脚本（可保存为 scripts/verify_m09.sh）
set -e

echo "=== 1. pytest 朱雀回归 ==="
pytest -q tests/test_zhuque_anti_ai.py

echo "=== 2. pytest 全集 ==="
pytest -q

echo "=== 3. check_ai_novel 全量 ==="
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault | grep -E "dimensions_checked|朱雀"

echo "=== 4. check_ai_novel 朱雀调试 ==="
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault --debug-zhuque | grep -E "dimensions_checked|朱雀"

echo "=== 5. SSOT 一致性 ==="
python scripts/check_doc_script_consistency.py

echo "=== 6. check_consistency 不受影响 ==="
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault

echo "=== M9 验收完成 ==="
```

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 多专家团（朱雀七维度对抗规则沉淀模块）
**依赖模块**：M3（文档与脚本 SSOT 校验）
**下游模块**：M20（开发自检清单升级，汇总朱雀 5 类量化检测项）


