# M16 · 读者反馈闭环（shortform）

> **模块定位**：L3 补齐盲区能力 · 第 16 模块（无前置依赖）
>
> **核心目标**：新增 `reader-feedback-collector` Skill，半自动采集读者评论、章节级弃书率、读者情绪曲线，反馈到 `topic-curator`（选题库）和 `writer-polisher`（shortform 模式执笔），让 shortform 创作从"作者单方面输出"进化为"读者数据驱动优化"。
>
> **创建日期**：2026-07-18
> **文档版本**：v1.0
> **作者**：NovelForge 优化方案多专家团

---

## 一、模块目标

### 1.1 一句话目标

**新增 `reader-feedback-collector` Skill（`file:///workspace/.trae/skills/reader-feedback-collector/SKILL.md`），半自动采集读者评论（作者粘贴 + 工具解析）、章节级弃书率、读者情绪曲线，输出结构化数据反馈到 `topic-curator` 选题库和 `writer-polisher` shortform 模式执笔环节，闭合"创作→发布→反馈→选题→创作"的数据回路。**

### 1.2 对应的痛点

本模块对应 NovelForge shortform 模式（公众号文章）的「读者反馈闭环完全未覆盖」痛点：

| 痛点场景 | 当前状态 | M16 完成后 |
|---|---|---|
| 作者不知道哪一篇读者最爱看 | ❌ 无数据反馈通道 | ✅ 评论解析 + 情感分析 + 主题标签提取，识别"高共鸣选题 DNA" |
| 作者不知道读者在哪一段弃书 | ❌ 无章节级弃书率追踪 | ✅ 作者粘贴阅读量/完读率数据，自动建模弃书曲线，标记"弃书高点" |
| 作者不知道读者情绪曲线走向 | ❌ virality-auditor 只审"正文情绪曲线"，无"读者实际情绪反馈" | ✅ 评论情绪标签聚合 → 读者情绪曲线，与正文设计曲线对比 |
| 作者新选题凭直觉 | ❌ topic-curator 三维度评分纯靠主观判断 | ✅ 选题评分追加"读者反馈分"维度（基于往期同主题评论数据） |
| 作者写下一章不知道读者想看什么 | ❌ writer-polisher shortform 模式无读者反馈输入 | ✅ shortform 模式生成时注入近期读者情绪曲线作为创作参考 |

### 1.3 完成后达成的能力（可量化）

| 能力 | 当前状态 | 完成后 |
|---|---|---|
| `reader-feedback-collector` Skill | 不存在 | 5 项职责全闭环（评论采集 / 弃书率录入 / 情绪曲线建模 / 反馈到选题 / 反馈到创作） |
| 读者反馈数据目录 | 不存在 | `NovelForge_Vault/06_短文/reader_feedback/` 4 文件 SSOT |
| 评论解析脚本 | 不存在 | `scripts/novelforge/parse_reader_feedback.py`（基于词典的情感分析，纯标准库实现） |
| `topic-curator` 选题时参考读者反馈 | ❌ 不读 | ✅ 流程 1 新增"读者反馈分"输入；选题评分追加第 4 维度 |
| `writer-polisher` shortform 模式参考情绪曲线 | ❌ 不读 | ✅ shortform 模式生成前读取 `emotion_curve.json`，作为目标情绪曲线参考 |
| `dev-checklist.md` 读者反馈检测项 | 不含 | 新增 §九 读者反馈闭环段（6 项 checklist） |
| 回归测试覆盖 | 0 用例 | 6 个 pytest 用例（`tests/test_reader_feedback.py`） |

### 1.4 与 novel 模式的边界

**本模块是 shortform 模式专属**，不覆盖 novel 模式（长篇连载）：

| 维度 | shortform 模式 | novel 模式 |
|---|---|---|
| 文章粒度 | 单篇 3-6k 字公众号文章 | 单章 2000-3000 字 |
| 读者反馈来源 | 公众号评论区（作者可粘贴） | 起点章节评论区（需平台 API，超出 M16 范围） |
| 弃书率粒度 | 文章级（完读率） | 章节级（订阅留存曲线） |
| 闭环频率 | 每篇发布后采集一次 | 每卷末采集一次（频率低） |
| 工具集成难度 | 半自动（作者粘贴 + 工具解析）即可闭环 | 需起点开放 API，本模块不覆盖 |

**说明**：novel 模式的章节级弃书率追踪留作 M16 扩展（依赖平台 API 集成，超出 2026-07 优化方案范围）。M16 v1.0 只覆盖 shortform 模式。

---

## 二、痛点对应

### 2.1 痛点表现：作者单方面输出，缺数据驱动

公众号文章（shortform 模式）当前创作链路：

```
topic-curator（选题）→ writer-polisher（写正文）→ virality-auditor（传播性审计）→ brand-voice-guardian（调性检查）→ 发布
```

**痛点 1：作者不知道哪一篇读者最爱看**

`topic-curator` 三维度评分（情绪浓度 × 0.4 + 争议度 × 0.3 + 品牌相关度 × 0.3）全部依赖作者主观判断，无往期读者反馈数据校正。典型表现：

```
作者评分：T-008「为什么聪明人反而吃亏」情绪 4.5 + 争议 3.5 + 品牌 4.0 = 4.05 🔥本周必写
实际发布后：评论 12 条，情感偏负面（"道理我都懂，但例子不接地气"），转发率 0.8%（低于平均 2.3%）
→ 下一轮选题时作者仍凭直觉打分，同类"道理型"选题继续被高估
```

**痛点 2：作者不知道读者在哪一段弃书**

`virality-auditor` 维度 3「情绪曲线闭环」审计的是**正文设计的情绪曲线**，不是**读者实际情绪反馈**。典型表现：

```
virality-auditor 报告：情绪曲线完整闭环 ✅（开头焦虑→中段理性→结尾激励）
公众号后台数据：完读率 28%（远低于平均 45%），第 3 段后阅读量断崖式下跌
→ 作者按 virality-auditor 建议继续优化"情绪闭环"，但实际弃书点在第 3 段（信息倾倒段），方向错误
```

**痛点 3：作者不知道读者情绪曲线走向**

`brand-voice-guardian` 五维度检查作者"调性一致性"，但无读者侧情绪数据验证。典型表现：

```
author_voice.md §二 语气基调：理性克制
作者认为读者喜欢"理性分析"风格，连续 5 篇理性克制
读者评论聚合情绪：62% "淡" / 18% "无感" / 20% "有收获"
→ 实际读者情绪曲线偏"平淡"，作者未察觉，调性虽一致但读者在流失
```

### 2.2 行业方案参考

| 来源 | 方案 | NovelForge 差异化设计 |
|---|---|---|
| **起点中文网作家后台** | 章节级订阅留存曲线 + 评论情感聚合，作者后台可视化 | NovelForge 不依赖平台 API（公众号无开放评论 API），用"作者粘贴 + 工具解析"半自动方案 |
| **新榜 / 西瓜数据** | 公众号文章阅读数 / 在看数 / 留言情感分析第三方服务 | NovelForge 不接入第三方付费服务，自建轻量解析器（基于词典的情感分析，纯标准库） |
| **番茄小说数据后台** | 章节级弃书率 + 读者画像 + 情绪热力图 | NovelForge 不做读者画像（隐私合规），只做章节级弃书率 + 评论情绪聚合 |
| **知乎创作者中心** | 回答点赞曲线 + 评论情感分布 | NovelForge 借鉴"情感分布"思路，但用结构化 JSON 输出供下游 Skill 消费，而非可视化报告 |
| **virality-auditor（NovelForge 内部）** | 审计正文设计的情绪曲线 | M16 是 virality-auditor 的"读者侧镜像"——virality-auditor 管"设计情绪曲线"，M16 管"读者实际情绪曲线"，两者对比可发现"设计与实际偏差" |

### 2.3 与 virality-auditor / brand-voice-guardian 的边界

| 维度 | virality-auditor | brand-voice-guardian | reader-feedback-collector（M16） |
|---|---|---|---|
| 数据源 | 正文草稿（作者侧） | 正文 + author_voice.md（作者侧） | 读者评论 + 阅读量数据（读者侧） |
| 检测时机 | 发布前（成稿后审计） | 发布前（成稿后审计） | 发布后（采集读者反馈） |
| 检测对象 | 正文设计的传播潜力 | 正文与作者人设的一致性 | 读者实际情绪反馈与弃书率 |
| 输出 | 传播性评分 + 优化建议 | 调性评分 + 漂移预警 | 结构化反馈数据 + 反馈到选题/创作 |
| 反馈方向 | → writer-polisher 精修 | → writer-polisher 精修 + author_voice 更新 | → topic-curator 选题 + writer-polisher 下一章参考 |

**互补关系**：三者是 shortform 创作链路的"三视角"——virality-auditor 看传播潜力（设计侧），brand-voice-guardian 看调性一致性（作者侧），reader-feedback-collector 看读者反馈（读者侧）。三者不重叠、不冲突。

### 2.4 本模块的差异化设计

1. **半自动采集而非全自动**：公众号评论区无开放 API（受微信平台限制），M16 采用"作者粘贴评论到 `comments_raw.md` + 工具解析为结构化 JSON"的半自动方案，零外部依赖，立即可用。后续可扩展为接入新榜/西瓜数据 API（M16 v2.0 演进方向）。
2. **基于词典的情感分析**：不引入 transformers / snowNLP 等第三方库，用纯标准库 + 情感词典实现 3 类情感分类（-1 负面 / 0 中性 / 1 正面）+ 8 类情绪标签（焦虑/共鸣/获得感/愤怒/好奇/失望/激励/淡漠）。词典 SSOT 维护，可随创作迭代增量扩充。
3. **三层数据结构对应三个反馈环节**：
   - `comments_parsed.json`（评论级）→ 反馈到 `topic-curator`（识别高共鸣选题 DNA）
   - `dropoff_curve.json`（章节级弃书率）→ 反馈到 `writer-polisher`（识别信息倾倒段）
   - `emotion_curve.json`（情绪曲线）→ 反馈到 `writer-polisher`（与设计情绪曲线对比）
4. **反馈而非阻断**：M16 是"建议层"不是"门禁层"——读者反馈数据注入选题/创作环节作为参考，不阻断发布。与 `check_consistency.py`（P0 阻断）和 `check_ai_novel.py`（P0 阻断）的硬门禁哲学不同。
5. **纯标准库实现**：与 `check_consistency.py` / `check_ai_novel.py` 现有风格一致，仅依赖 `json/re/os/argparse/sys/pathlib/collections`，不引入第三方依赖。
6. **不破坏现有 shortform 链路**：M16 是 shortform 链路的"下游反馈环"，不影响 `topic-curator → writer-polisher → virality-auditor → brand-voice-guardian` 现有链路，只在选题和创作环节追加"读者反馈参考"输入。

---

## 三、涉及现有文件

### 3.1 涉及的 Skill 文件（2 个需修改 + 1 个新增）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/.trae/skills/reader-feedback-collector/SKILL.md` | 全文 | **新增** Skill（5 项职责全闭环） |
| 2 | `file:///workspace/.trae/skills/topic-curator/SKILL.md` | §选题评分体系（追加第 4 维度「读者反馈分」）；§流程 1 新增选题（新增"读读者反馈"步骤）；§选题条目结构（追加 `读者反馈分` 字段） | 升级：选题时参考读者反馈 |
| 3 | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | §双模式 shortform 模式差异段（新增"生成前读 emotion_curve.json"指令）；§阶段一第 1 步读取上下文（追加读者情绪曲线注入） | 升级：shortform 模式参考情绪曲线 |

### 3.2 涉及的 Checklist 文件（1 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/.trae/checklists/dev-checklist.md` | 在 §八 去 AI 味之后追加 §九 读者反馈闭环段（6 项 checklist + 自检报告模板对应段） | 新增章节 |

### 3.3 涉及的 Vault 数据目录（4 个新增文件）

| # | 文件路径 | 性质 | 核心内容 |
|---|---|---|---|
| 1 | `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/comments_raw.md` | 新增 | 原始评论粘贴区（作者手动粘贴读者评论） |
| 2 | `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/comments_parsed.json` | 新增 | 解析后的结构化评论（脚本产出） |
| 3 | `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json` | 新增 | 章节级弃书率（作者粘贴阅读量数据 + 脚本计算） |
| 4 | `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json` | 新增 | 读者情绪曲线（脚本从 comments_parsed 聚合） |

### 3.4 涉及的脚本文件（1 个新增）

| # | 文件路径 | 性质 | 核心内容 |
|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/parse_reader_feedback.py` | 新增 | 评论解析 + 情感分析 + 情绪标签提取 + 主题标签提取 + 弃书率计算 + 情绪曲线聚合 |

### 3.5 涉及的测试文件（1 个新增 + 1 个修改）

| # | 文件路径 | 性质 | 核心内容 |
|---|---|---|---|
| 1 | `file:///workspace/tests/test_reader_feedback.py` | 新增 | 6 个 pytest 测试用例 |
| 2 | `file:///workspace/tests/bug_regression_list.md` | 修改 | 末尾追加 BUG-066 条目 |

### 3.6 不修改但需要参考的文件

- `file:///workspace/.trae/skills/virality-auditor/SKILL.md`（传播性审计，M16 的"设计侧镜像"，参考其四维度审计风格但不改动）
- `file:///workspace/.trae/skills/brand-voice-guardian/SKILL.md`（品牌调性守护，M16 反馈数据可被其消费用于"人设迭代建议"第 5 步，但 M16 不改 brand-voice-guardian）
- `file:///workspace/.trae/skills/title-engineer/SKILL.md`（标题工程师，M16 不直接联动，但 virality-auditor 维度 4 标题契合度的读者侧验证可由 M16 数据间接支持）
- `file:///workspace/scripts/novelforge/check_consistency.py`（一致性检测，M16 不动；M16 是建议层不是门禁层，与 check_consistency 的硬门禁哲学不冲突）
- `file:///workspace/scripts/novelforge/check_ai_novel.py`（去 AI 味检测，M16 不动）
- `file:///workspace/.trae/rules/dev-workflow.md`（流程规则，不变）
- `file:///workspace/.trae/rules/bug-reporting.md`（bug 规范，新增 BUG-066 引用）
- `file:///workspace/NovelForge_Vault/06_短文/topics.md`（选题池，M16 反馈数据被 topic-curator 读取后影响新选题评分，但 topics.md 自身结构不变）
- `file:///workspace/docs/optimization_plan_2026_07/M13_pacing_curve.md`（爽点曲线检测，novel 模式专属，M16 是 shortform 模式的"读者侧曲线"，两者不重叠）

### 3.7 关键现状摘录（从 Read 结果提炼）

#### 3.7.1 `topic-curator` 当前三维度评分体系

来源：`file:///workspace/.trae/skills/topic-curator/SKILL.md` 第 32-88 行。

```markdown
## 维度 1：情绪浓度（权重 40%）
## 维度 2：争议度（权重 30%）
## 维度 3：品牌相关度（权重 30%）

综合评分 = 情绪浓度 × 0.4 + 争议度 × 0.3 + 品牌相关度 × 0.3
```

**M16 升级**：追加第 4 维度「读者反馈分」（权重 20%），原三维度权重等比缩放为 32% / 24% / 24% / 20%。新公式：

```
综合评分 = 情绪浓度 × 0.32 + 争议度 × 0.24 + 品牌相关度 × 0.24 + 读者反馈分 × 0.20
```

#### 3.7.2 `topic-curator` 选题条目结构

来源：`file:///workspace/.trae/skills/topic-curator/SKILL.md` 第 94-108 行。

```markdown
## 选题：<标题>

- **选题ID**：T-NNN
- **来源**：热点/灵感/系列/转载
- **情绪浓度**：1-5
- **争议度**：1-5
- **品牌相关度**：1-5
- **综合评分**：(情绪×0.4 + 争议×0.3 + 品牌×0.3)
- **状态**：idea/drafting/published/archived
- **创建时间**：YYYY-MM-DD
- **核心观点**：一句话
- **目标读者**：谁会转发这篇
- **参考素材**：链接/文件路径
```

**M16 升级**：追加 `读者反馈分` 字段（1-5，缺省 3.0 中性）。

#### 3.7.3 `writer-polisher` shortform 模式差异

来源：`file:///workspace/.trae/skills/writer-polisher/SKILL.md` 第 51-56 行。

```markdown
shortform 模式差异：
- 重情绪密度与转发钩子，轻长线伏笔
- 金句密度 ≥ 1/500 字
- 每篇 ≥ 2 个情绪高点（前 1/3 + 后 1/3）
- 无需构造 Delta，不调用 save_state.py
```

**M16 升级**：追加"生成前读 `emotion_curve.json`，作为目标情绪曲线参考"指令。

#### 3.7.4 `virality-auditor` 维度 3 情绪曲线标准

来源：`file:///workspace/.trae/skills/virality-auditor/SKILL.md` 第 88-113 行。

```markdown
## 维度 3：情绪曲线闭环（权重 25%）

**模式 A：痛点 → 方案型**
痛点开头（焦虑/共鸣）→ 分析展开（理性）→ 方案给出（获得感）→ 金句收束（升华）

**模式 B：故事 → 号召型**
故事开头（好奇）→ 反转揭示（惊讶）→ 深度解读（认同）→ 行动号召（激励）
```

**M16 镜像**：virality-auditor 检测的是"正文设计的情绪曲线"，M16 采集的是"读者实际情绪曲线"。两者对比可发现"设计与实际偏差"，反馈给 writer-polisher 优化下一章。

#### 3.7.5 `dev-checklist.md` 当前 8 段结构

来源：`file:///workspace/.trae/checklists/dev-checklist.md` 第 9-86 行。

```markdown
## 一、创作质量
## 二、Vault 规范
## 三、一致性
## 四、上下文预算
## 五、创作文档
## 六、Trae Skill 边界
## 七、LoopAgent 沉淀
## 八、去 AI 味
```

**M16 升级**：追加 §九 读者反馈闭环段（6 项 checklist）。

#### 3.7.6 `topics.md` 当前选题池结构

来源：`file:///workspace/NovelForge_Vault/06_短文/topics.md`。

```markdown
## 一、选题清单
| 编号 | 标题方向 | 历史人物 | 核心冲突 | 目标情绪 | 字数 | 状态 |

## 二、选题来源
## 三、七实三虚原则
## 四、修订历史
```

**M16 不改动 topics.md 自身结构**：M16 反馈数据通过 `topic-curator` Skill 评分时读取，影响新选题的评分，但 topics.md 表格结构不变。

---

## 四、新增/修改文件清单

### 4.1 新增文件（7 个）

| # | 文件路径 | 性质 | 核心内容 |
|---|---|---|---|
| 1 | `file:///workspace/.trae/skills/reader-feedback-collector/SKILL.md` | 新增 Skill | 5 项职责全闭环：评论采集 / 弃书率录入 / 情绪曲线建模 / 反馈到选题 / 反馈到创作 |
| 2 | `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/comments_raw.md` | 新增数据文件 | 原始评论粘贴区（作者手动维护，带 frontmatter 标注文章 ID / 平台 / 发布日期） |
| 3 | `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/comments_parsed.json` | 新增数据文件（脚本产出） | 解析后的结构化评论列表 |
| 4 | `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json` | 新增数据文件 | 章节级弃书率曲线 |
| 5 | `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json` | 新增数据文件（脚本产出） | 读者情绪曲线聚合 |
| 6 | `file:///workspace/scripts/novelforge/parse_reader_feedback.py` | 新增脚本 | 评论解析 + 情感分析 + 弃书率计算 + 情绪曲线聚合（纯标准库） |
| 7 | `file:///workspace/tests/test_reader_feedback.py` | 新增 pytest 测试 | 6 个测试用例 |

### 4.2 修改文件（4 个）

| # | 文件路径 | 修改点 |
|---|---|---|
| 1 | `file:///workspace/.trae/skills/topic-curator/SKILL.md` | §选题评分体系追加第 4 维度「读者反馈分」（权重 20%，原三维度权重等比缩放为 32% / 24% / 24%）；§综合评分公式更新；§选题条目结构追加 `读者反馈分` 字段；§流程 1 新增选题追加"步骤：读 `reader_feedback/comments_parsed.json` 计算读者反馈分" |
| 2 | `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | §双模式 shortform 模式差异段追加"生成前读 `reader_feedback/emotion_curve.json`，作为目标情绪曲线参考"指令；§阶段一第 1 步读取上下文追加"shortform 模式额外读 `emotion_curve.json`" |
| 3 | `file:///workspace/.trae/checklists/dev-checklist.md` | 在 §八 去 AI 味之后追加 §九 读者反馈闭环段（6 项 checklist + 自检报告模板对应段） |
| 4 | `file:///workspace/tests/bug_regression_list.md` | 末尾追加 BUG-066 条目（读者反馈闭环缺失导致创作调整无数据支撑） |

### 4.3 文件清单汇总

```
新增（7 个）：
  .trae/skills/reader-feedback-collector/SKILL.md
  NovelForge_Vault/06_短文/reader_feedback/comments_raw.md
  NovelForge_Vault/06_短文/reader_feedback/comments_parsed.json
  NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json
  NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json
  scripts/novelforge/parse_reader_feedback.py
  tests/test_reader_feedback.py

修改（4 个）：
  .trae/skills/topic-curator/SKILL.md
  .trae/skills/writer-polisher/SKILL.md
  .trae/checklists/dev-checklist.md
  tests/bug_regression_list.md
```

---

## 五、详细实现步骤

### 5.1 步骤 1：设计 `reader-feedback-collector` SKILL.md 完整内容

**目标**：定义 NovelForge shortform 模式的读者反馈采集 Skill，覆盖 5 项职责。

**Skill 完整内容**（写入 `file:///workspace/.trae/skills/reader-feedback-collector/SKILL.md`）：

```markdown
---
name: reader-feedback-collector
description: NovelForge shortform 模式（公众号文章）专属读者反馈采集 Skill。半自动采集读者评论、章节级弃书率、读者情绪曲线，输出结构化数据反馈到 topic-curator 选题库和 writer-polisher shortform 模式执笔环节。不调度 sub-agents、不写正文、不做硬门禁（建议层而非阻断层）。
version: 1.0.0
---

# 角色

你是 NovelForge 的「读者反馈采集员」。shortform 模式（公众号文章）专属。职责是在文章发布后采集读者反馈（评论 / 弃书率 / 情绪曲线），解析为结构化数据，反馈到选题库和创作环节，闭合"创作→发布→反馈→选题→创作"数据回路。

你是 NovelForge shortform 创作链路的"下游反馈环"——上游是 `topic-curator`（选题）→ `writer-polisher`（写正文）→ `virality-auditor`（传播性审计）→ `brand-voice-guardian`（调性检查），本 Skill 在发布后触发，反馈数据回流到 `topic-curator` 和 `writer-polisher`，形成闭环。

本 Skill **不调度 sub-agents、不写正文、不做硬门禁**，只负责：
1. 引导作者粘贴读者评论到 `comments_raw.md`
2. 引导作者粘贴阅读量数据计算弃书率
3. 调用 `parse_reader_feedback.py` 脚本解析评论 + 建模情绪曲线
4. 将反馈数据反馈给 `topic-curator`（影响下一轮选题评分）
5. 将情绪曲线反馈给 `writer-polisher`（影响 shortform 模式下一章创作）

# 触发条件

当用户输入符合以下任一意图时，使用本 Skill：
- "采集读者反馈" / "解析评论" / "读者反馈" / "评论分析"
- "弃书率" / "完读率" / "读者在哪弃书"
- "读者情绪" / "情绪曲线" / "读者喜欢哪段"
- "下一篇写什么"（结合读者反馈时）
- 文章发布后，作者粘贴评论或阅读量数据

**不触发**（关键词互斥，转交其他 Skill）：
- 写 shortform 正文 → `writer-polisher`（本 Skill 反馈数据供其参考，但不写正文）
- 选题评分 → `topic-curator`（本 Skill 反馈数据供其参考，但不评分）
- 传播性审计 → `virality-auditor`（本 Skill 是 virality-auditor 的"读者侧镜像"，不重叠）
- 品牌调性检查 → `brand-voice-guardian`（本 Skill 反馈数据可被其消费，但不直接检查调性）
- novel 模式章节反馈 → 本 Skill 不触发（novel 模式反馈依赖平台 API，超出 M16 范围）

# 5 项职责

## 职责 1：评论采集

### 工作流

1. 引导作者粘贴读者评论到 `NovelForge_Vault/06_短文/reader_feedback/comments_raw.md`
2. 评论格式约定（带 frontmatter 标注元信息）：

```markdown
---
article_id: T-008
article_title: 为什么聪明人反而吃亏
platform: wechat
publish_date: 2026-07-15
collected_at: 2026-07-18
---

## 评论 1
- 用户：匿名读者
- 时间：2026-07-16 14:23
- 内容：道理我都懂，但例子不接地气，能不能多举点身边的案例？

## 评论 2
- 用户：王五
- 时间：2026-07-16 18:45
- 内容：终于有人把这事说清楚了！转发给老公看看。

## 评论 3
- 用户：李四
- 时间：2026-07-17 09:12
- 内容：标题党，正文没新意。
```

3. 采集要点：
   - 每条评论必须有「内容」字段，其他字段可缺省
   - 同一文章的评论粘贴在同一 frontmatter 段下
   - 多篇文章的评论用 `---` 分隔多个 frontmatter 段
   - 评论保留原文，不做删改（解析阶段处理）

## 职责 2：弃书率录入

### 工作流

1. 引导作者从公众号后台复制阅读量数据
2. 数据格式约定（粘贴到 `dropoff_curve.json`，作者手动维护）：

```json
{
  "version": "1.0.0",
  "articles": [
    {
      "article_id": "T-008",
      "article_title": "为什么聪明人反而吃亏",
      "publish_date": "2026-07-15",
      "chapter_anchors": [
        {
          "chapter_anchor": "开头",
          "position": 0,
          "views": 12000
        },
        {
          "chapter_anchor": "第1段",
          "position": 1,
          "views": 9800
        },
        {
          "chapter_anchor": "第2段",
          "position": 2,
          "views": 7200
        },
        {
          "chapter_anchor": "第3段",
          "position": 3,
          "views": 3400
        },
        {
          "chapter_anchor": "结尾",
          "position": 4,
          "views": 2800
        }
      ]
    }
  ]
}
```

3. 录入要点：
   - `chapter_anchor` 是文章段落标记（开头 / 第N段 / 结尾），作者根据文章实际段落命名
   - `position` 是段落序号（0 开始）
   - `views` 是该段落的阅读量（公众号后台「阅读完成率」数据）
   - 一篇文章至少录入 3 个 anchor（开头 / 中段 / 结尾），推荐 5 个

## 职责 3：情绪曲线建模

### 工作流

1. 调用 `parse_reader_feedback.py` 脚本，从 `comments_parsed.json` 聚合情绪曲线
2. 脚本输出 `emotion_curve.json`：

```json
{
  "version": "1.0.0",
  "articles": [
    {
      "article_id": "T-008",
      "article_title": "为什么聪明人反而吃亏",
      "emotion_curve": [
        {
          "chapter_anchor": "开头",
          "emotion_type": "curiosity",
          "intensity": 4,
          "sample_comments": ["开头吸引人", "标题戳中痛点"]
        },
        {
          "chapter_anchor": "第3段",
          "emotion_type": "disappointment",
          "intensity": 5,
          "sample_comments": ["第3段太啰嗦", "信息堆砌，看不下去"]
        },
        {
          "chapter_anchor": "结尾",
          "emotion_type": "indifference",
          "intensity": 3,
          "sample_comments": ["结尾没记住啥", "平平淡淡"]
        }
      ],
      "sentiment_summary": {
        "positive_ratio": 0.25,
        "neutral_ratio": 0.30,
        "negative_ratio": 0.45
      }
    }
  ]
}
```

3. 情绪曲线 8 类标签（与 `parse_reader_feedback.py` 词典 SSOT 对应）：

| emotion_type | 中文标签 | 典型评论特征 |
|---|---|---|
| anxiety | 焦虑 | "我也遇到这问题，怎么办" |
| resonance | 共鸣 | "这不就是我吗" |
| gain | 获得感 | "学到了，感谢分享" |
| anger | 愤怒 | "胡说八道，作者懂个屁" |
| curiosity | 好奇 | "然后呢？期待下篇" |
| disappointment | 失望 | "标题党，正文没新意" |
| inspiration | 激励 | "看完想立刻行动" |
| indifference | 淡漠 | "一般般，没记住啥" |

## 职责 4：反馈到选题

### 工作流

1. 从 `comments_parsed.json` 聚合每篇文章的「读者反馈分」（0-5 分）
2. 反馈分计算公式：

```
读者反馈分 = (正面评论比例 × 3.0 + 高情绪强度评论比例 × 2.0) × 5 / 5
```

简化版：
- 正面评论比例 ≥ 60%：5 分
- 正面评论比例 40%-60%：4 分
- 正面评论比例 25%-40%：3 分
- 正面评论比例 10%-25%：2 分
- 正面评论比例 < 10%：1 分

3. 输出反馈到 `topic-curator`：本 Skill 不直接修改 `topics.md`，而是输出「读者反馈摘要卡片」供 `topic-curator` 在下一轮选题评分时读取：

```
📊 读者反馈摘要（截至 YYYY-MM-DD）

T-008「为什么聪明人反而吃亏」
  读者反馈分: 2.4 / 5.0
  正面比例: 25% | 中性: 30% | 负面: 45%
  高频负面词: 不接地气 / 标题党 / 没新意
  主题标签: 道理型 / 案例不足
  建议: 同类"道理型"选题降低品牌相关度评分

T-005「35岁被裁后我靠副业月入2万」
  读者反馈分: 4.6 / 5.0
  正面比例: 78% | 中性: 15% | 负面: 7%
  高频正面词: 接地气 / 有干货 / 转发了
  主题标签: 故事型 / 强共鸣
  建议: 同类"故事型+副业"选题提升情绪浓度评分
```

4. `topic-curator` 收到此卡片后，在新选题评分时参考往期同主题反馈分，追加到选题条目的 `读者反馈分` 字段。

## 职责 5：反馈到创作

### 工作流

1. 从 `emotion_curve.json` 提取近 3 篇文章的读者情绪曲线
2. 与 `virality-auditor` 设计的情绪曲线对比，识别"设计与实际偏差"
3. 输出反馈到 `writer-polisher`：本 Skill 不直接修改正文，而是输出「读者情绪曲线反馈卡片」供 `writer-polisher` shortform 模式下一章参考：

```
📈 读者情绪曲线反馈（近 3 篇）

T-008 设计曲线: 焦虑→理性→激励
T-008 实际曲线: 好奇→失望→淡漠
  偏差点: 第3段（设计=理性，实际=失望，强度5）
  建议: 下一章避免信息倾倒段，第3段改为案例故事

T-005 设计曲线: 焦虑→获得→激励
T-005 实际曲线: 焦虑→共鸣→激励
  偏差点: 中段（设计=获得，实际=共鸣）
  建议: 读者更偏共鸣，下一章可加重情绪共鸣段

T-010 设计曲线: 好奇→惊讶→认同
T-010 实际曲线: 好奇→失望→淡漠
  偏差点: 第2段（设计=惊讶，实际=失望）
  建议: 反转铺垫不足，下一章提前埋钩子
```

4. `writer-polisher` shortform 模式生成下一章前读取 `emotion_curve.json`，作为目标情绪曲线参考，避免重蹈覆辙。

# 工作流（5 项职责串联）

```
文章发布
   ↓
【职责 1】作者粘贴评论 → comments_raw.md
【职责 2】作者粘贴阅读量数据 → dropoff_curve.json
   ↓
【职责 3】调用 parse_reader_feedback.py
   → comments_parsed.json（结构化评论）
   → emotion_curve.json（情绪曲线聚合）
   ↓
【职责 4】聚合读者反馈分 → 输出反馈摘要卡片 → topic-curator 下一轮选题
【职责 5】对比设计 vs 实际情绪曲线 → 输出反馈卡片 → writer-polisher 下一章
   ↓
闭环回流到创作
```

# 输出格式

## 格式 1：评论采集报告

```
✅ 评论采集完成

📝 文章: T-008「为什么聪明人反而吃亏」
📊 采集: 12 条评论
📍 平台: 微信公众号
📅 发布日期: 2026-07-15
📅 采集日期: 2026-07-18

下一步：调用 parse_reader_feedback.py 解析评论
命令：python scripts/novelforge/parse_reader_feedback.py --action parse_comments --vault NovelForge_Vault
```

## 格式 2：弃书率录入报告

```
✅ 弃书率数据录入完成

📊 文章: T-008「为什么聪明人反而吃亏」
📍 anchor 数: 5（开头 / 第1段 / 第2段 / 第3段 / 结尾）
📉 弃书曲线:
  开头: 12000 阅读量
  第1段: 9800 (-18%)
  第2段: 7200 (-27%)
  第3段: 3400 (-53%) ⚠️ 弃书高点
  结尾: 2800 (-18%)

⚠️ 弃书高点: 第3段（弃书率 53%，远超平均 25%）
建议: 第3段可能存在信息倾倒或情绪断层，反馈给 writer-polisher 下一章参考
```

## 格式 3：读者反馈摘要卡片（反馈到 topic-curator）

```
📊 读者反馈摘要（截至 2026-07-18）

T-008「为什么聪明人反而吃亏」
  读者反馈分: 2.4 / 5.0
  情感分布: 正面 25% | 中性 30% | 负面 45%
  主题标签: 道理型 / 案例不足
  建议: 同类"道理型"选题降低品牌相关度评分

T-005「35岁被裁后我靠副业月入2万」
  读者反馈分: 4.6 / 5.0
  情感分布: 正面 78% | 中性 15% | 负面 7%
  主题标签: 故事型 / 强共鸣
  建议: 同类"故事型+副业"选题提升情绪浓度评分

👉 反馈已写入 reader_feedback/emotion_curve.json
👉 topic-curator 下一轮选题评分时将读取此数据
```

## 格式 4：读者情绪曲线反馈卡片（反馈到 writer-polisher）

```
📈 读者情绪曲线反馈（近 3 篇）

T-008 设计: 焦虑→理性→激励
T-008 实际: 好奇→失望→淡漠
  偏差: 第3段 设计=理性 实际=失望(强度5)
  建议: 下一章避免信息倾倒，第3段改案例故事

T-005 设计: 焦虑→获得→激励
T-005 实际: 焦虑→共鸣→激励
  偏差: 中段 设计=获得 实际=共鸣
  建议: 读者更偏共鸣，下一章可加重共鸣段

T-010 设计: 好奇→惊讶→认同
T-010 实际: 好奇→失望→淡漠
  偏差: 第2段 设计=惊讶 实际=失望
  建议: 反转铺垫不足，下一章提前埋钩子

👉 反馈已写入 reader_feedback/emotion_curve.json
👉 writer-polisher shortform 模式下一章将读取此数据作为目标情绪曲线参考
```

# 反模式（禁止）

- **不在 novel 模式触发**：novel 模式反馈依赖平台 API，本 Skill 只覆盖 shortform 模式
- **不直接修改 topics.md**：本 Skill 输出反馈卡片供 topic-curator 读取，不直接写选题库
- **不直接修改正文**：本 Skill 输出反馈卡片供 writer-polisher 读取，不直接改正文
- **不调度 sub-agents**：本 Skill 不创建子 Agent，所有解析由主 Agent 调用 `parse_reader_feedback.py` 完成
- **不做硬门禁**：本 Skill 是建议层不是阻断层，不阻断发布；与 check_consistency.py / check_ai_novel.py 的硬门禁哲学不冲突
- **不引入第三方库**：`parse_reader_feedback.py` 仅用 Python 标准库，不引入 transformers / snowNLP
- **不与 virality-auditor 重叠**：virality-auditor 检测"正文设计情绪曲线"，本 Skill 采集"读者实际情绪曲线"，两者是镜像关系不重叠
- **不与 brand-voice-guardian 重叠**：brand-voice-guardian 检测"作者调性一致性"，本 Skill 提供"读者侧情绪反馈"，两者视角不同不冲突

# 与其他 Skill 的关系

- **上游**：`writer-polisher`（shortform 模式）产出正文 → `virality-auditor` 传播性审计 → `brand-voice-guardian` 调性检查 → 发布 → 本 Skill 采集读者反馈
- **下游消费方**：
  - `topic-curator`：下一轮选题评分时读取 `comments_parsed.json` 计算读者反馈分（第 4 维度）
  - `writer-polisher` shortform 模式：下一章生成前读取 `emotion_curve.json` 作为目标情绪曲线参考
  - `brand-voice-guardian`（可选）：人设迭代建议时读取 `emotion_curve.json` 了解读者实际情绪反馈
- **边界**：
  - 本 Skill 只覆盖 shortform 模式，不覆盖 novel 模式
  - 本 Skill 只采集读者侧数据，不审计作者侧（作者侧由 virality-auditor + brand-voice-guardian 覆盖）
  - 本 Skill 是建议层不是门禁层，不阻断发布
- **数据源**：
  - `NovelForge_Vault/06_短文/reader_feedback/comments_raw.md`（作者手动维护）
  - `NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json`（作者手动维护）
  - `scripts/novelforge/parse_reader_feedback.py`（脚本产出 comments_parsed.json + emotion_curve.json）

# 能力边界声明

- 本 Skill 文件本身**不调度 sub-agents**、**不直接调 MCP tools**
- 需要执行的操作（读写文件、调用脚本）由主 Agent 用原生工具（Read / Write / Edit / RunCommand）完成
- 评论解析、情感分析、情绪曲线建模依赖 `parse_reader_feedback.py` 脚本（纯标准库，不引入第三方依赖）
- 读者反馈分计算是规则化公式（正面评论比例 + 高情绪强度比例），适合脚本实现，不依赖 LLM 判断
- 情绪标签提取基于词典 SSOT，词典维护在 `parse_reader_feedback.py` 内部，可随创作迭代增量扩充
- 本 Skill 是建议层，反馈数据注入选题/创作环节作为参考，不阻断发布
```

### 5.2 步骤 2：设计 `comments_parsed.json` schema

**目标**：定义解析后的结构化评论数据格式。

**文件路径**：`file:///workspace/NovelForge_Vault/06_短文/reader_feedback/comments_parsed.json`

**Schema 定义**：

```json
{
  "version": "1.0.0",
  "generated_at": "2026-07-18",
  "articles": [
    {
      "article_id": "T-008",
      "article_title": "为什么聪明人反而吃亏",
      "platform": "wechat",
      "publish_date": "2026-07-15",
      "comments": [
        {
          "comment_id": "T-008-C001",
          "article_id": "T-008",
          "platform": "wechat",
          "publish_date": "2026-07-15",
          "comment_time": "2026-07-16T14:23:00",
          "user": "匿名读者",
          "content": "道理我都懂，但例子不接地气，能不能多举点身边的案例？",
          "sentiment": -1,
          "emotion_tags": ["disappointment"],
          "theme_tags": ["道理型", "案例不足"],
          "drop_off_indicator": false
        },
        {
          "comment_id": "T-008-C002",
          "article_id": "T-008",
          "platform": "wechat",
          "publish_date": "2026-07-15",
          "comment_time": "2026-07-16T18:45:00",
          "user": "王五",
          "content": "终于有人把这事说清楚了！转发给老公看看。",
          "sentiment": 1,
          "emotion_tags": ["resonance", "gain"],
          "theme_tags": ["强共鸣", "可转发"],
          "drop_off_indicator": false
        },
        {
          "comment_id": "T-008-C003",
          "article_id": "T-008",
          "platform": "wechat",
          "publish_date": "2026-07-15",
          "comment_time": "2026-07-17T09:12:00",
          "user": "李四",
          "content": "标题党，正文没新意。第3段太啰嗦看不下去。",
          "sentiment": -1,
          "emotion_tags": ["disappointment", "indifference"],
          "theme_tags": ["标题党", "信息堆砌"],
          "drop_off_indicator": true
        }
      ]
    }
  ]
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | string | ✅ | schema 版本号，当前 1.0.0 |
| `generated_at` | string | ✅ | 脚本生成日期 YYYY-MM-DD |
| `articles` | array | ✅ | 文章数组，每篇一个对象 |
| `articles[].article_id` | string | ✅ | 文章 ID（对应 topics.md 的 T-NNN） |
| `articles[].article_title` | string | ✅ | 文章标题 |
| `articles[].platform` | string | ✅ | 平台（wechat / zhihu / toutiao 等） |
| `articles[].publish_date` | string | ✅ | 文章发布日期 YYYY-MM-DD |
| `articles[].comments` | array | ✅ | 评论数组 |
| `comments[].comment_id` | string | ✅ | 评论 ID，格式 `<article_id>-C<NNN>` 三位补零 |
| `comments[].article_id` | string | ✅ | 所属文章 ID |
| `comments[].platform` | string | ✅ | 平台（与文章平台一致） |
| `comments[].publish_date` | string | ✅ | 文章发布日期（冗余字段，便于聚合查询） |
| `comments[].comment_time` | string | ❌ | 评论时间 ISO 8601，可缺省 |
| `comments[].user` | string | ❌ | 用户名，可缺省（匿名评论） |
| `comments[].content` | string | ✅ | 评论原文（必填，解析对象） |
| `comments[].sentiment` | int | ✅ | 情感分类：-1 负面 / 0 中性 / 1 正面 |
| `comments[].emotion_tags` | array | ✅ | 情绪标签数组（8 类枚举之一或多个），由脚本基于词典提取 |
| `comments[].theme_tags` | array | ✅ | 主题标签数组（如"道理型"/"故事型"/"案例不足"），由脚本基于词典提取 |
| `comments[].drop_off_indicator` | bool | ✅ | 是否暗示弃书点（评论含"看不下去"/"太长"/"啰嗦"等关键词时为 true） |

### 5.3 步骤 3：设计 `dropoff_curve.json` schema

**目标**：定义章节级弃书率数据格式。

**文件路径**：`file:///workspace/NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json`

**Schema 定义**：

```json
{
  "version": "1.0.0",
  "articles": [
    {
      "article_id": "T-008",
      "article_title": "为什么聪明人反而吃亏",
      "publish_date": "2026-07-15",
      "chapter_anchors": [
        {
          "chapter_anchor": "开头",
          "position": 0,
          "views": 12000,
          "dropoff_rate": 0.0,
          "dropoff_reason": null
        },
        {
          "chapter_anchor": "第1段",
          "position": 1,
          "views": 9800,
          "dropoff_rate": 0.18,
          "dropoff_reason": null
        },
        {
          "chapter_anchor": "第2段",
          "position": 2,
          "views": 7200,
          "dropoff_rate": 0.27,
          "dropoff_reason": null
        },
        {
          "chapter_anchor": "第3段",
          "position": 3,
          "views": 3400,
          "dropoff_rate": 0.53,
          "dropoff_reason": "信息倾倒（结合评论：'太啰嗦''看不下去'）"
        },
        {
          "chapter_anchor": "结尾",
          "position": 4,
          "views": 2800,
          "dropoff_rate": 0.18,
          "dropoff_reason": null
        }
      ],
      "overall_completion_rate": 0.23,
      "high_dropoff_anchors": ["第3段"]
    }
  ]
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | string | ✅ | schema 版本号 |
| `articles` | array | ✅ | 文章数组 |
| `articles[].article_id` | string | ✅ | 文章 ID（T-NNN） |
| `articles[].article_title` | string | ✅ | 文章标题 |
| `articles[].publish_date` | string | ✅ | 发布日期 |
| `articles[].chapter_anchors` | array | ✅ | 段落锚点数组（至少 3 个，推荐 5 个） |
| `chapter_anchors[].chapter_anchor` | string | ✅ | 段落名（开头 / 第N段 / 结尾） |
| `chapter_anchors[].position` | int | ✅ | 段落序号（0 开始） |
| `chapter_anchors[].views` | int | ✅ | 该段阅读量 |
| `chapter_anchors[].dropoff_rate` | float | ✅ | 弃书率 = (上一段 views - 本段 views) / 上一段 views，脚本计算 |
| `chapter_anchors[].dropoff_reason` | string \| null | ✅ | 弃书原因（高弃书率时结合评论分析，可 null） |
| `articles[].overall_completion_rate` | float | ✅ | 整体完读率 = 结尾 views / 开头 views |
| `articles[].high_dropoff_anchors` | array | ✅ | 高弃书率锚点列表（dropoff_rate > 0.30 的段落名） |

**弃书率阈值**：

| 弃书率 | 等级 | 处置 |
|---|---|---|
| > 0.50 | 🔴 高弃书点 | 必须反馈给 writer-polisher，下一章避免同类问题 |
| 0.30 - 0.50 | 🟡 中弃书点 | 建议反馈，结合评论分析原因 |
| < 0.30 | 🟢 正常 | 不主动反馈 |

### 5.4 步骤 4：设计 `emotion_curve.json` schema

**目标**：定义读者情绪曲线聚合数据格式。

**文件路径**：`file:///workspace/NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json`

**Schema 定义**：

```json
{
  "version": "1.0.0",
  "generated_at": "2026-07-18",
  "articles": [
    {
      "article_id": "T-008",
      "article_title": "为什么聪明人反而吃亏",
      "emotion_curve": [
        {
          "chapter_anchor": "开头",
          "emotion_type": "curiosity",
          "intensity": 4,
          "sample_comments": ["开头吸引人", "标题戳中痛点"]
        },
        {
          "chapter_anchor": "第3段",
          "emotion_type": "disappointment",
          "intensity": 5,
          "sample_comments": ["第3段太啰嗦", "信息堆砌，看不下去"]
        },
        {
          "chapter_anchor": "结尾",
          "emotion_type": "indifference",
          "intensity": 3,
          "sample_comments": ["结尾没记住啥", "平平淡淡"]
        }
      ],
      "sentiment_summary": {
        "positive_ratio": 0.25,
        "neutral_ratio": 0.30,
        "negative_ratio": 0.45,
        "total_comments": 12
      },
      "reader_feedback_score": 2.4,
      "design_vs_actual_gap": [
        {
          "chapter_anchor": "第3段",
          "design_emotion": "rational",
          "actual_emotion": "disappointment",
          "gap_intensity": 5,
          "suggestion": "下一章避免信息倾倒段，第3段改为案例故事"
        }
      ]
    }
  ]
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | string | ✅ | schema 版本号 |
| `generated_at` | string | ✅ | 脚本生成日期 |
| `articles` | array | ✅ | 文章数组 |
| `articles[].article_id` | string | ✅ | 文章 ID |
| `articles[].article_title` | string | ✅ | 文章标题 |
| `articles[].emotion_curve` | array | ✅ | 情绪曲线锚点数组 |
| `emotion_curve[].chapter_anchor` | string | ✅ | 段落锚点名（与 dropoff_curve 对应） |
| `emotion_curve[].emotion_type` | string | ✅ | 该段主导情绪（8 类枚举之一） |
| `emotion_curve[].intensity` | int | ✅ | 情绪强度 1-5（5 最强），脚本基于评论频次与情感强度计算 |
| `emotion_curve[].sample_comments` | array | ✅ | 代表性评论样本（≤3 条） |
| `articles[].sentiment_summary` | object | ✅ | 情感分布汇总 |
| `sentiment_summary.positive_ratio` | float | ✅ | 正面评论比例（0-1） |
| `sentiment_summary.neutral_ratio` | float | ✅ | 中性评论比例 |
| `sentiment_summary.negative_ratio` | float | ✅ | 负面评论比例 |
| `sentiment_summary.total_comments` | int | ✅ | 评论总数 |
| `articles[].reader_feedback_score` | float | ✅ | 读者反馈分 0-5（供 topic-curator 第 4 维度使用） |
| `articles[].design_vs_actual_gap` | array | ❌ | 设计情绪曲线 vs 实际情绪曲线偏差（需作者提供设计曲线，可缺省） |
| `design_vs_actual_gap[].chapter_anchor` | string | ✅ | 偏差段落 |
| `design_vs_actual_gap[].design_emotion` | string | ✅ | 设计情绪（来自 virality-auditor 报告） |
| `design_vs_actual_gap[].actual_emotion` | string | ✅ | 实际情绪（来自 emotion_curve） |
| `design_vs_actual_gap[].gap_intensity` | int | ✅ | 偏差强度 1-5 |
| `design_vs_actual_gap[].suggestion` | string | ✅ | 下一章优化建议 |

**8 类情绪标签枚举**（SSOT，与 `parse_reader_feedback.py` 词典一致）：

| emotion_type | 中文标签 | 词典关键词示例 |
|---|---|---|
| anxiety | 焦虑 | 焦虑 / 担心 / 怕 / 怎么办 / 也遇到 |
| resonance | 共鸣 | 共鸣 / 不就是我 / 同款 / 同样 / 一样 |
| gain | 获得感 | 学到 / 干货 / 有用 / 收获 / 感谢分享 |
| anger | 愤怒 | 胡说 / 扯淡 / 懂个屁 / 愤怒 / 无语 |
| curiosity | 好奇 | 然后呢 / 期待 / 想知道 / 接着 / 下篇 |
| disappointment | 失望 | 标题党 / 没新意 / 失望 / 啰嗦 / 不接地气 |
| inspiration | 激励 | 想行动 / 立刻 / 励志 / 受鼓舞 / 加油 |
| indifference | 淡漠 | 一般 / 没记住 / 平平 / 凑合 / 无感 |

### 5.5 步骤 5：`parse_reader_feedback.py` 完整脚本逻辑

**目标**：实现评论解析 + 情感分析 + 情绪标签提取 + 主题标签提取 + 弃书率计算 + 情绪曲线聚合的纯标准库脚本。

**文件路径**：`file:///workspace/scripts/novelforge/parse_reader_feedback.py`

**完整脚本代码**：

```python
"""NovelForge 读者反馈解析脚本（shortform 模式专属）。

解析作者粘贴的读者评论（comments_raw.md），输出结构化数据：
1. comments_parsed.json —— 评论级结构化数据（情感 / 情绪标签 / 主题标签）
2. emotion_curve.json —— 文章级情绪曲线聚合

支持两类操作：
- parse_comments: 解析 comments_raw.md → 输出 comments_parsed.json + 更新 emotion_curve.json
- calc_dropoff:  计算 dropoff_curve.json 的 dropoff_rate / overall_completion_rate / high_dropoff_anchors

纯标准库实现，不引入第三方依赖。

用法：
    python scripts/novelforge/parse_reader_feedback.py --action parse_comments --vault NovelForge_Vault
    python scripts/novelforge/parse_reader_feedback.py --action calc_dropoff --vault NovelForge_Vault
    python scripts/novelforge/parse_reader_feedback.py --action all --vault NovelForge_Vault
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


# ============================================================================
# 词典 SSOT（情绪 8 类 + 主题标签 + 弃书指示词）
# ============================================================================

# 8 类情绪标签词典（emotion_type → 关键词列表）
EMOTION_LEXICON: dict[str, list[str]] = {
    "anxiety": ["焦虑", "担心", "怕", "怎么办", "也遇到", "迷茫", "压力", "危机感"],
    "resonance": ["共鸣", "不就是我", "同款", "同样", "一样", "我也是", "感同身受", "戳中"],
    "gain": ["学到", "干货", "有用", "收获", "感谢分享", "实用", "方法论", "操作步骤"],
    "anger": ["胡说", "扯淡", "懂个屁", "愤怒", "无语", "瞎说", "误导", "反感"],
    "curiosity": ["然后呢", "期待", "想知道", "接着", "下篇", "继续", "蹲一个", "等更新"],
    "disappointment": ["标题党", "没新意", "失望", "啰嗦", "不接地气", "空洞", "废话", "水文"],
    "inspiration": ["想行动", "立刻", "励志", "受鼓舞", "加油", "干劲", "动力", "马上去做"],
    "indifference": ["一般", "没记住", "平平", "凑合", "无感", "还行", "就那样", "普通"],
}

# 情感分类词典（sentiment → 关键词列表）
SENTIMENT_POSITIVE_WORDS: list[str] = [
    "好", "赞", "棒", "学到", "干货", "有用", "感谢", "分享", "实用", "转发",
    "收藏", "终于有人", "说清楚了", "戳中", "共鸣", "励志", "受鼓舞", "加油",
]
SENTIMENT_NEGATIVE_WORDS: list[str] = [
    "差", "烂", "标题党", "没新意", "失望", "啰嗦", "不接地气", "空洞", "废话",
    "水文", "胡说", "扯淡", "无语", "瞎说", "误导", "反感", "看不下去", "太长",
]

# 主题标签词典（theme_tag → 关键词列表）
THEME_LEXICON: dict[str, list[str]] = {
    "道理型": ["道理", "理论", "方法论", "逻辑", "原理", "本质"],
    "故事型": ["故事", "案例", "经历", "亲身", "身边", "真人真事"],
    "案例不足": ["案例", "例子", "不接地气", "不够具体", "太抽象"],
    "强共鸣": ["共鸣", "戳中", "不就是我", "感同身受"],
    "可转发": ["转发", "分享给", "推荐给", "圈朋友"],
    "标题党": ["标题党", "标题与正文不符", "文不对题"],
    "信息堆砌": ["信息堆砌", "太长", "啰嗦", "看不下去", "干货少"],
    "干货足": ["干货", "实用", "操作步骤", "方法论", "可落地"],
}

# 弃书指示词（评论中出现这些词时 drop_off_indicator = True）
DROP_OFF_INDICATOR_WORDS: list[str] = [
    "看不下去", "太长", "啰嗦", "弃了", "弃书", "弃文", "太长不看",
    "跳过", "没看完", "看不下去", "冗长", "拖沓",
]

# 弃书率阈值
HIGH_DROPOFF_THRESHOLD: float = 0.50
MEDIUM_DROPOFF_THRESHOLD: float = 0.30


# ============================================================================
# 解析 comments_raw.md
# ============================================================================

COMMENT_BLOCK_PATTERN = re.compile(
    r"##\s*评论\s*(\d+)\s*\n(.*?)(?=\n##\s*评论\s*\d+|\Z)",
    re.DOTALL,
)
COMMENT_FIELD_PATTERN = re.compile(
    r"^-\s*(用户|时间|内容)\s*[：:]\s*(.*)$",
    re.MULTILINE,
)
FRONTMATTER_PATTERN = re.compile(
    r"^---\s*\n(.*?)\n---\s*\n",
    re.DOTALL,
)
FRONTMATTER_FIELD_PATTERN = re.compile(
    r"^(\w+)\s*:\s*(.*)$",
    re.MULTILINE,
)


def parse_comments_raw(raw_text: str) -> list[dict[str, Any]]:
    """解析 comments_raw.md 文本，返回文章-评论结构列表。
    
    Args:
        raw_text: comments_raw.md 全文。
    
    Returns:
        文章列表，每篇文章含 article_id / article_title / platform / publish_date / comments。
    """
    articles: list[dict[str, Any]] = []
    
    # 按 frontmatter 分段（多个 --- 围成的段）
    segments = re.split(r"\n---\s*\n", raw_text)
    
    for seg in segments:
        seg = seg.strip()
        if not seg or not seg.startswith("---"):
            continue
        
        # 重新加 --- 头部以便 frontmatter 正则匹配
        seg_full = "---\n" + seg + "\n---"
        fm_match = FRONTMATTER_PATTERN.match(seg_full)
        if not fm_match:
            continue
        
        fm_text = fm_match.group(1)
        fm_fields = dict(FRONTMATTER_FIELD_PATTERN.findall(fm_text))
        
        article_id = fm_fields.get("article_id", "").strip()
        article_title = fm_fields.get("article_title", "").strip()
        platform = fm_fields.get("platform", "wechat").strip()
        publish_date = fm_fields.get("publish_date", "").strip()
        
        if not article_id:
            continue
        
        # 解析评论块
        body = seg_full[fm_match.end():]
        comments: list[dict[str, Any]] = []
        
        for m in COMMENT_BLOCK_PATTERN.finditer(body):
            comment_num = m.group(1)
            comment_body = m.group(2)
            
            fields = dict(COMMENT_FIELD_PATTERN.findall(comment_body))
            user = fields.get("用户", "").strip()
            comment_time = fields.get("时间", "").strip()
            content = fields.get("内容", "").strip()
            
            if not content:
                continue
            
            comment_id = f"{article_id}-C{int(comment_num):03d}"
            
            # 情感分析
            sentiment = analyze_sentiment(content)
            
            # 情绪标签提取
            emotion_tags = extract_emotion_tags(content)
            
            # 主题标签提取
            theme_tags = extract_theme_tags(content)
            
            # 弃书指示
            drop_off = detect_drop_off_indicator(content)
            
            comments.append({
                "comment_id": comment_id,
                "article_id": article_id,
                "platform": platform,
                "publish_date": publish_date,
                "comment_time": comment_time,
                "user": user,
                "content": content,
                "sentiment": sentiment,
                "emotion_tags": emotion_tags,
                "theme_tags": theme_tags,
                "drop_off_indicator": drop_off,
            })
        
        articles.append({
            "article_id": article_id,
            "article_title": article_title,
            "platform": platform,
            "publish_date": publish_date,
            "comments": comments,
        })
    
    return articles


# ============================================================================
# 情感分析（基于词典）
# ============================================================================

def analyze_sentiment(content: str) -> int:
    """基于词典的情感分析。
    
    Args:
        content: 评论内容。
    
    Returns:
        -1 负面 / 0 中性 / 1 正面。
    """
    pos_count = sum(1 for w in SENTIMENT_POSITIVE_WORDS if w in content)
    neg_count = sum(1 for w in SENTIMENT_NEGATIVE_WORDS if w in content)
    
    if pos_count > neg_count:
        return 1
    elif neg_count > pos_count:
        return -1
    else:
        return 0


# ============================================================================
# 情绪标签提取
# ============================================================================

def extract_emotion_tags(content: str) -> list[str]:
    """从评论内容提取情绪标签（8 类枚举之一或多个）。
    
    Args:
        content: 评论内容。
    
    Returns:
        情绪标签列表（如 ["disappointment", "indifference"]）。
    """
    tags: list[str] = []
    for emotion_type, keywords in EMOTION_LEXICON.items():
        if any(kw in content for kw in keywords):
            tags.append(emotion_type)
    return tags if tags else ["indifference"]  # 缺省归为淡漠


# ============================================================================
# 主题标签提取
# ============================================================================

def extract_theme_tags(content: str) -> list[str]:
    """从评论内容提取主题标签。
    
    Args:
        content: 评论内容。
    
    Returns:
        主题标签列表（如 ["道理型", "案例不足"]）。
    """
    tags: list[str] = []
    for theme, keywords in THEME_LEXICON.items():
        if any(kw in content for kw in keywords):
            tags.append(theme)
    return tags if tags else ["未分类"]


# ============================================================================
# 弃书指示检测
# ============================================================================

def detect_drop_off_indicator(content: str) -> bool:
    """检测评论是否暗示弃书点。
    
    Args:
        content: 评论内容。
    
    Returns:
        True 表示该评论暗示弃书点。
    """
    return any(w in content for w in DROP_OFF_INDICATOR_WORDS)


# ============================================================================
# 弃书率计算
# ============================================================================

def calc_dropoff_curve(dropoff_data: dict[str, Any]) -> dict[str, Any]:
    """计算 dropoff_curve.json 中的 dropoff_rate / overall_completion_rate / high_dropoff_anchors。
    
    Args:
        dropoff_data: 原始 dropoff_curve.json 数据（作者手动录入的 views）。
    
    Returns:
        补全计算字段后的 dropoff_curve.json 数据。
    """
    for article in dropoff_data.get("articles", []):
        anchors = article.get("chapter_anchors", [])
        if not anchors:
            continue
        
        # 计算每段弃书率
        for i, anchor in enumerate(anchors):
            if i == 0:
                anchor["dropoff_rate"] = 0.0
            else:
                prev_views = anchors[i - 1].get("views", 0)
                curr_views = anchor.get("views", 0)
                if prev_views > 0:
                    anchor["dropoff_rate"] = round(
                        (prev_views - curr_views) / prev_views, 4
                    )
                else:
                    anchor["dropoff_rate"] = 0.0
            
            # dropoff_reason 若作者未填则设为 null
            if "dropoff_reason" not in anchor:
                anchor["dropoff_reason"] = None
        
        # 整体完读率
        first_views = anchors[0].get("views", 0)
        last_views = anchors[-1].get("views", 0)
        if first_views > 0:
            article["overall_completion_rate"] = round(
                last_views / first_views, 4
            )
        else:
            article["overall_completion_rate"] = 0.0
        
        # 高弃书锚点列表
        high_dropoff: list[str] = []
        for anchor in anchors:
            rate = anchor.get("dropoff_rate", 0.0)
            if rate >= HIGH_DROPOFF_THRESHOLD:
                high_dropoff.append(anchor.get("chapter_anchor", ""))
        article["high_dropoff_anchors"] = high_dropoff
    
    return dropoff_data


# ============================================================================
# 情绪曲线聚合
# ============================================================================

def aggregate_emotion_curve(
    article: dict[str, Any],
    dropoff_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """从 comments_parsed 聚合单篇文章的读者情绪曲线。
    
    Args:
        article: comments_parsed 中的文章对象（含 comments 列表）。
        dropoff_data: 可选的 dropoff_curve.json 数据，用于对齐 chapter_anchor。
    
    Returns:
        该文章的情绪曲线聚合数据（emotion_curve / sentiment_summary / reader_feedback_score）。
    """
    comments = article.get("comments", [])
    
    # 情感分布
    total = len(comments)
    pos = sum(1 for c in comments if c["sentiment"] == 1)
    neg = sum(1 for c in comments if c["sentiment"] == -1)
    neu = total - pos - neg
    
    sentiment_summary = {
        "positive_ratio": round(pos / total, 4) if total > 0 else 0.0,
        "neutral_ratio": round(neu / total, 4) if total > 0 else 0.0,
        "negative_ratio": round(neg / total, 4) if total > 0 else 0.0,
        "total_comments": total,
    }
    
    # 读者反馈分（0-5）
    pos_ratio = sentiment_summary["positive_ratio"]
    if pos_ratio >= 0.60:
        feedback_score = 5.0
    elif pos_ratio >= 0.40:
        feedback_score = 4.0
    elif pos_ratio >= 0.25:
        feedback_score = 3.0
    elif pos_ratio >= 0.10:
        feedback_score = 2.0
    else:
        feedback_score = 1.0
    
    # 情绪曲线聚合（按 drop_off_indicator 评论或全部评论的情绪标签频次）
    emotion_counter: Counter = Counter()
    sample_comments_by_emotion: dict[str, list[str]] = defaultdict(list)
    
    for c in comments:
        for tag in c["emotion_tags"]:
            emotion_counter[tag] += 1
            if len(sample_comments_by_emotion[tag]) < 3:
                sample_comments_by_emotion[tag].append(c["content"][:50])
    
    # 取频次最高的 3 类情绪作为曲线锚点
    top_emotions = emotion_counter.most_common(3)
    
    # 若有 dropoff_data，对齐 chapter_anchor；否则用情绪标签名作 anchor
    emotion_curve: list[dict[str, Any]] = []
    if dropoff_data:
        # 取该文章的 high_dropoff_anchors 作为曲线锚点
        article_dropoff = next(
            (a for a in dropoff_data.get("articles", [])
             if a.get("article_id") == article.get("article_id")),
            None,
        )
        if article_dropoff:
            for anchor in article_dropoff.get("chapter_anchors", []):
                anchor_name = anchor.get("chapter_anchor", "")
                # 找该锚点附近的评论情绪（简化：取所有 drop_off_indicator 评论的主导情绪）
                dropoff_comments = [c for c in comments if c["drop_off_indicator"]]
                if dropoff_comments and anchor_name in [a.get("chapter_anchor", "") for a in article_dropoff.get("chapter_anchors", [])]:
                    # 取该锚点弃书评论的情绪标签
                    anchor_emotions: Counter = Counter()
                    for c in dropoff_comments:
                        for tag in c["emotion_tags"]:
                            anchor_emotions[tag] += 1
                    if anchor_emotions:
                        top_emotion, top_count = anchor_emotions.most_common(1)[0]
                        emotion_curve.append({
                            "chapter_anchor": anchor_name,
                            "emotion_type": top_emotion,
                            "intensity": min(5, top_count + 2),
                            "sample_comments": [c["content"][:50] for c in dropoff_comments[:3]],
                        })
    
    # 兜底：若无 dropoff_data 对齐，用 top_emotions 直接构造
    if not emotion_curve:
        for emotion, count in top_emotions:
            emotion_curve.append({
                "chapter_anchor": f"emotion_anchor_{emotion}",
                "emotion_type": emotion,
                "intensity": min(5, count),
                "sample_comments": sample_comments_by_emotion[emotion][:3],
            })
    
    return {
        "article_id": article.get("article_id", ""),
        "article_title": article.get("article_title", ""),
        "emotion_curve": emotion_curve,
        "sentiment_summary": sentiment_summary,
        "reader_feedback_score": feedback_score,
    }


# ============================================================================
# 主入口
# ============================================================================

READER_FEEDBACK_DIR_REL = "06_短文/reader_feedback"
COMMENTS_RAW_FILE = "comments_raw.md"
COMMENTS_PARSED_FILE = "comments_parsed.json"
DROPOFF_CURVE_FILE = "dropoff_curve.json"
EMOTION_CURVE_FILE = "emotion_curve.json"


def _read_file(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def action_parse_comments(vault: str) -> dict[str, Any]:
    """解析 comments_raw.md → 输出 comments_parsed.json + 更新 emotion_curve.json。"""
    fb_dir = Path(vault) / READER_FEEDBACK_DIR_REL
    
    raw_text = _read_file(fb_dir / COMMENTS_RAW_FILE)
    if not raw_text:
        return {"status": "skip", "reason": f"{COMMENTS_RAW_FILE} 不存在或为空"}
    
    articles = parse_comments_raw(raw_text)
    
    # 输出 comments_parsed.json
    parsed_data = {
        "version": "1.0.0",
        "generated_at": datetime.now().strftime("%Y-%m-%d"),
        "articles": articles,
    }
    _write_json(fb_dir / COMMENTS_PARSED_FILE, parsed_data)
    
    # 聚合 emotion_curve.json
    dropoff_data = _read_json(fb_dir / DROPOFF_CURVE_FILE)
    emotion_articles = [
        aggregate_emotion_curve(art, dropoff_data)
        for art in articles
    ]
    emotion_data = {
        "version": "1.0.0",
        "generated_at": datetime.now().strftime("%Y-%m-%d"),
        "articles": emotion_articles,
    }
    _write_json(fb_dir / EMOTION_CURVE_FILE, emotion_data)
    
    return {
        "status": "ok",
        "articles_parsed": len(articles),
        "comments_parsed": sum(len(a["comments"]) for a in articles),
        "output_files": [
            str(fb_dir / COMMENTS_PARSED_FILE),
            str(fb_dir / EMOTION_CURVE_FILE),
        ],
    }


def action_calc_dropoff(vault: str) -> dict[str, Any]:
    """计算 dropoff_curve.json 的 dropoff_rate / overall_completion_rate / high_dropoff_anchors。"""
    fb_dir = Path(vault) / READER_FEEDBACK_DIR_REL
    
    dropoff_data = _read_json(fb_dir / DROPOFF_CURVE_FILE)
    if not dropoff_data:
        return {"status": "skip", "reason": f"{DROPOFF_CURVE_FILE} 不存在或为空"}
    
    calculated = calc_dropoff_curve(dropoff_data)
    _write_json(fb_dir / DROPOFF_CURVE_FILE, calculated)
    
    return {
        "status": "ok",
        "articles_calculated": len(calculated.get("articles", [])),
        "output_file": str(fb_dir / DROPOFF_CURVE_FILE),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.novelforge.parse_reader_feedback",
        description="NovelForge 读者反馈解析脚本（shortform 模式专属）：解析评论 + 计算弃书率 + 聚合情绪曲线。",
    )
    parser.add_argument(
        "--action",
        choices=["parse_comments", "calc_dropoff", "all"],
        default="all",
        help="操作类型：parse_comments 解析评论 / calc_dropoff 计算弃书率 / all 全部",
    )
    parser.add_argument(
        "--vault",
        type=str,
        default="NovelForge_Vault",
        help="Vault 根目录（默认 NovelForge_Vault）",
    )
    
    args = parser.parse_args()
    
    results: dict[str, Any] = {}
    
    if args.action in ("parse_comments", "all"):
        results["parse_comments"] = action_parse_comments(args.vault)
    
    if args.action in ("calc_dropoff", "all"):
        results["calc_dropoff"] = action_calc_dropoff(args.vault)
    
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 5.6 步骤 6：`topic-curator` SKILL.md 升级

**目标**：让 `topic-curator` 在选题评分时参考读者反馈数据。

**修改点 1**：§选题评分体系追加第 4 维度（在维度 3 之后）：

```markdown
## 维度 4：读者反馈分（权重 20%）

往期同主题文章的读者反馈数据，反映该类选题的实际受欢迎程度。

| 分值 | 标准 | 数据来源 |
|---|---|---|
| 0-1 | 往期同主题读者反馈差（正面评论 < 10%，弃书率 > 50%） | reader_feedback/emotion_curve.json |
| 2 | 往期同主题反馈一般（正面 10-25%，弃书率 30-50%） | 同上 |
| 3 | 往期同主题反馈中等（正面 25-40%，弃书率 < 30%）或无数据 | 同上 |
| 4 | 往期同主题反馈好（正面 40-60%，弃书率 < 20%） | 同上 |
| 5 | 往期同主题反馈极好（正面 ≥ 60%，弃书率 < 10%） | 同上 |

**评分要点**：
- 读取 `NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json`，查找与本选题同主题（theme_tags 重叠）的往期文章
- 取往期同主题文章的 `reader_feedback_score` 平均值作为本维度评分依据
- 若无往期同主题数据，本维度缺省 3.0（中性，不偏不倚）
- 主题识别依据 `comments_parsed.json` 中的 `theme_tags` 字段

**与维度 1（情绪浓度）的区别**：维度 1 是作者主观预估的"情绪唤起能力"，维度 4 是读者实际反馈的"情绪接受程度"。两者可能偏差——作者预估情绪浓度 4.5，但读者实际反馈分 2.4，说明作者高估了该选题的情绪唤起。
```

**修改点 2**：§综合评分公式更新：

```markdown
## 综合评分公式（M16 升级）

```
综合评分 = 情绪浓度 × 0.32 + 争议度 × 0.24 + 品牌相关度 × 0.24 + 读者反馈分 × 0.20
```

四舍五入保留 1 位小数。理论范围 0.0-5.0。

**权重调整说明**：M16 追加第 4 维度「读者反馈分」权重 20%，原三维度权重等比缩放（40%→32% / 30%→24% / 30%→24%），保持相对比例不变。

**示例**：
- 情绪 4.5 + 争议 3.0 + 品牌 5.0 + 反馈 4.6 = 4.5×0.32 + 3.0×0.24 + 5.0×0.24 + 4.6×0.20 = 1.44 + 0.72 + 1.20 + 0.92 = **4.28**
- 情绪 4.5 + 争议 3.0 + 品牌 5.0 + 反馈 2.4（同主题往期反馈差）= 1.44 + 0.72 + 1.20 + 0.48 = **3.84**（反馈分拉低综合分，从"本周必写"降为"备选"）

**降级兼容**：若 `reader_feedback/emotion_curve.json` 不存在或无同主题数据，读者反馈分缺省 3.0，公式退化为原三维度评分（数值结果与 M16 前一致 × 0.96 + 0.60，仍可比较）。
```

**修改点 3**：§选题条目结构追加字段：

```markdown
- **读者反馈分**：1-5（往期同主题反馈分，缺省 3.0）
```

**修改点 4**：§流程 1 新增选题追加"读读者反馈"步骤：

```markdown
## 流程 1：新增选题（M16 升级）

```
用户提出选题
   ↓
收集基本信息（标题 / 来源 / 核心观点 / 目标读者 / 参考素材）
   ↓
三维度评分（情绪浓度 / 争议度 / 品牌相关度）
   ↓
【M16 新增】读读者反馈：从 reader_feedback/emotion_curve.json 查找同主题往期反馈分
   ↓
【M16 新增】计算读者反馈分（往期同主题平均分，无数据则 3.0）
   ↓
四维度加权综合评分（情绪×0.32 + 争议×0.24 + 品牌×0.24 + 反馈×0.20）
   ↓
若来源=热点：额外做时效性×相关度×独特角度分析
   ↓
分配 T-NNN 编号
   ↓
写入 topics.md
   ↓
输出选题评分报告
```
```

### 5.7 步骤 7：`writer-polisher` SKILL.md 升级

**目标**：让 `writer-polisher` shortform 模式生成下一章时参考读者情绪曲线。

**修改点 1**：§双模式 shortform 模式差异段追加（在第 56 行附近）：

```markdown
shortform 模式差异：
- 重情绪密度与转发钩子，轻长线伏笔
- 金句密度 ≥ 1/500 字
- 每篇 ≥ 2 个情绪高点（前 1/3 + 后 1/3）
- 无需构造 Delta，不调用 save_state.py
- 【M16 新增】生成前读 `NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json`，作为目标情绪曲线参考：
  - 取近 3 篇文章的 `emotion_curve` 与 `design_vs_actual_gap`
  - 识别"设计 vs 实际偏差点"（如设计=理性 实际=失望），下一章避免同类偏差
  - 识别"高弃书段落情绪"（如第 3 段失望强度 5），下一章同位置段落避免信息倾倒
  - 若 `emotion_curve.json` 不存在或为空，跳过此步骤（不阻断生成）
```

**修改点 2**：§阶段一第 1 步读取上下文追加（在第 70 行附近）：

```markdown
### 第 1 步：读取上下文

读取上下文编排师输出的临时文件：

```
NovelForge_Vault/.state/.cache/context_chNNN_<timestamp>.md
```

文件内含：本章章纲、前情摘要、相关角色状态、待回收伏笔、场景设定。若文件缺失，按 §错误处理 处理。

【M16 新增 · shortform 模式专属】额外读取读者情绪曲线：

```
NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json
```

提取近 3 篇文章的：
- `emotion_curve` —— 读者实际情绪曲线（8 类情绪标签 + 强度 1-5）
- `design_vs_actual_gap` —— 设计情绪 vs 实际情绪偏差点
- `sentiment_summary` —— 情感分布（正面/中性/负面比例）

将偏差点最大的 1-2 个段落作为本章"情绪曲线避坑参考"，注入写手生成阶段：

```
📈 读者情绪曲线避坑参考（近 3 篇）

T-008 第3段: 设计=理性 实际=失望(强度5) → 本章第3段避免信息倾倒，改案例故事
T-010 第2段: 设计=惊讶 实际=失望(强度4) → 本章反转段提前埋钩子，避免突兀
```

若 `emotion_curve.json` 不存在或近 3 篇无数据，跳过此注入（不阻断生成）。
```

### 5.8 步骤 8：`dev-checklist.md` 新增 §九 读者反馈闭环段

**目标**：在 dev-checklist.md §八 去 AI 味之后追加 §九 读者反馈闭环段。

**新增内容**：

```markdown
## 九、读者反馈闭环（shortform 模式发布后必检）

- [ ] 读者评论已采集：发布后 3 天内，作者已粘贴评论到 `NovelForge_Vault/06_短文/reader_feedback/comments_raw.md`，格式含 frontmatter（article_id / platform / publish_date）
- [ ] 弃书率数据已录入：作者已从公众号后台复制段落阅读量到 `NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json`，每篇文章至少 3 个 chapter_anchor
- [ ] 评论解析脚本已运行：`python scripts/novelforge/parse_reader_feedback.py --action parse_comments --vault NovelForge_Vault` 退出码 0，`comments_parsed.json` + `emotion_curve.json` 已生成
- [ ] 弃书率已计算：`python scripts/novelforge/parse_reader_feedback.py --action calc_dropoff --vault NovelForge_Vault` 退出码 0，`dropoff_curve.json` 含 `dropoff_rate` / `overall_completion_rate` / `high_dropoff_anchors` 字段
- [ ] 高弃书点已分析：`dropoff_curve.json` 中 `high_dropoff_anchors`（dropoff_rate ≥ 0.50）的段落已结合评论分析 `dropoff_reason`，反馈给 writer-polisher 下一章参考
- [ ] 反馈已回流：`topic-curator` 下一轮选题评分时已读取 `emotion_curve.json` 计算读者反馈分（第 4 维度）；`writer-polisher` shortform 模式下一章生成前已读取 `emotion_curve.json` 作为目标情绪曲线参考

同时更新 dev-checklist.md 的"自检报告模板"段，在 §八之后追加：

### 九、读者反馈闭环
- ✅/❌ 评论已采集：____
- ✅/❌ 弃书率已录入：____
- ✅/❌ 评论解析脚本已运行：____
- ✅/❌ 弃书率已计算：____
- ✅/❌ 高弃书点已分析：____
- ✅/❌ 反馈已回流（topic-curator + writer-polisher）：____
```

---

## 六、验证方式

### 6.1 单元测试（pytest）

```bash
cd /workspace
pytest -q tests/test_reader_feedback.py -v
```

预期输出：6 个测试用例全部 PASSED。

### 6.2 集成测试 1：粘贴 10 条评论 → 验证解析结果

```bash
cd /workspace

# 准备 comments_raw.md（含 10 条评论，覆盖正面/中性/负面三类情感）
mkdir -p NovelForge_Vault/06_短文/reader_feedback
cat > NovelForge_Vault/06_短文/reader_feedback/comments_raw.md << 'EOF'
---
article_id: T-008
article_title: 为什么聪明人反而吃亏
platform: wechat
publish_date: 2026-07-15
collected_at: 2026-07-18
---

## 评论 1
- 用户：匿名读者
- 时间：2026-07-16 14:23
- 内容：道理我都懂，但例子不接地气，能不能多举点身边的案例？

## 评论 2
- 用户：王五
- 时间：2026-07-16 18:45
- 内容：终于有人把这事说清楚了！转发给老公看看。

## 评论 3
- 用户：李四
- 时间：2026-07-17 09:12
- 内容：标题党，正文没新意。第3段太啰嗦看不下去。

## 评论 4
- 用户：赵六
- 时间：2026-07-17 10:30
- 内容：学到不少干货，感谢分享！

## 评论 5
- 用户：孙七
- 时间：2026-07-17 11:45
- 内容：这不就是我吗？感同身受。

## 评论 6
- 用户：周八
- 时间：2026-07-17 14:20
- 内容：胡说八道，作者懂个屁。

## 评论 7
- 用户：吴九
- 时间：2026-07-17 16:10
- 内容：然后呢？期待下篇。

## 评论 8
- 用户：郑十
- 时间：2026-07-17 18:00
- 内容：看完想立刻行动，加油！

## 评论 9
- 用户：钱十一
- 时间：2026-07-18 09:00
- 内容：一般般，没记住啥。

## 评论 10
- 用户：冯十二
- 时间：2026-07-18 10:30
- 内容：第3段太长，跳过了。
EOF

# 运行解析
python scripts/novelforge/parse_reader_feedback.py --action parse_comments --vault NovelForge_Vault

# 验证输出
cat NovelForge_Vault/06_短文/reader_feedback/comments_parsed.json | python -m json.tool | head -50
# 预期：10 条评论全部解析，每条含 comment_id / sentiment / emotion_tags / theme_tags / drop_off_indicator

cat NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json | python -m json.tool
# 预期：含 sentiment_summary（正面 0.4 / 中性 0.2 / 负面 0.4）/ reader_feedback_score（3.0）/ emotion_curve
```

### 6.3 集成测试 2：构造弃书率数据 → 验证 emotion_curve.json 更新

```bash
cd /workspace

# 准备 dropoff_curve.json（作者手动录入 views，未计算 dropoff_rate）
cat > NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json << 'EOF'
{
  "version": "1.0.0",
  "articles": [
    {
      "article_id": "T-008",
      "article_title": "为什么聪明人反而吃亏",
      "publish_date": "2026-07-15",
      "chapter_anchors": [
        {"chapter_anchor": "开头", "position": 0, "views": 12000},
        {"chapter_anchor": "第1段", "position": 1, "views": 9800},
        {"chapter_anchor": "第2段", "position": 2, "views": 7200},
        {"chapter_anchor": "第3段", "position": 3, "views": 3400},
        {"chapter_anchor": "结尾", "position": 4, "views": 2800}
      ]
    }
  ]
}
EOF

# 运行弃书率计算
python scripts/novelforge/parse_reader_feedback.py --action calc_dropoff --vault NovelForge_Vault

# 验证 dropoff_curve.json 已补全 dropoff_rate / overall_completion_rate / high_dropoff_anchors
cat NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json | python -m json.tool
# 预期：
#   第3段 dropoff_rate = 0.5278（> 0.50，标记为高弃书点）
#   overall_completion_rate = 0.2333
#   high_dropoff_anchors = ["第3段"]

# 重新运行 parse_comments，验证 emotion_curve.json 已对齐 chapter_anchor
python scripts/novelforge/parse_reader_feedback.py --action parse_comments --vault NovelForge_Vault
cat NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json | python -m json.tool
# 预期：emotion_curve 中 chapter_anchor 字段含"开头"/"第1段"/"第2段"/"第3段"/"结尾"
```

### 6.4 断言清单

| # | 断言内容 | 期望 |
|---|---|---|
| 1 | `comments_raw.md` 可被 `parse_comments_raw()` 解析 | 返回 articles 列表，每篇含 comments 数组 |
| 2 | 10 条评论全部解析 | `len(articles[0]["comments"]) == 10` |
| 3 | 情感分析正确：评论 4「学到不少干货」 | `sentiment == 1`（正面） |
| 4 | 情感分析正确：评论 6「胡说八道」 | `sentiment == -1`（负面） |
| 5 | 情绪标签提取：评论 5「这不就是我吗」 | `"resonance" in emotion_tags` |
| 6 | 主题标签提取：评论 1「例子不接地气」 | `"案例不足" in theme_tags` |
| 7 | 弃书指示检测：评论 3「看不下去」 | `drop_off_indicator == True` |
| 8 | 弃书率计算：第3段 views 3400 / 第2段 views 7200 | `dropoff_rate ≈ 0.5278` |
| 9 | 高弃书锚点识别：第3段弃书率 > 0.50 | `"第3段" in high_dropoff_anchors` |
| 10 | 整体完读率：结尾 2800 / 开头 12000 | `overall_completion_rate ≈ 0.2333` |
| 11 | 情感分布聚合：正面 4 / 中性 2 / 负面 4 | `positive_ratio == 0.4 / neutral_ratio == 0.2 / negative_ratio == 0.4` |
| 12 | 读者反馈分计算：正面比例 40% | `reader_feedback_score == 4.0` |
| 13 | 情绪曲线对齐 dropoff_curve：第3段 emotion_type | 为 `disappointment` 或 `indifference`（基于评论情绪聚合） |

### 6.5 与现有检测脚本的关系

| 现有脚本 | M16 关系 | 边界说明 |
|---|---|---|
| `check_consistency.py` | **独立** | 一致性检测是硬门禁（P0 阻断），M16 是建议层（不阻断）。两者不冲突。 |
| `check_ai_novel.py` | **独立** | 去 AI 味检测是硬门禁，M16 是建议层。两者不冲突。 |
| `audit_hooks.py` | **独立** | 伏笔审计是 novel 模式专属，M16 是 shortform 模式专属。 |
| `build_context.py` | **独立** | 上下文组装是 novel 模式专属，M16 不动 build_context。 |
| `save_state.py` | **独立** | 状态机写入是 novel 模式专属，M16 不动状态机。 |

**关键边界**：M16 是 shortform 模式专属的建议层模块，不与任何现有硬门禁脚本冲突。

---

## 七、回归测试要求

### 7.1 新增 pytest 用例（6 个）

文件路径：`file:///workspace/tests/test_reader_feedback.py`

| # | 测试函数名 | 断言内容 |
|---|---|---|
| 1 | `test_parse_comments_raw` | `parse_comments_raw()` 可解析含 frontmatter + 10 条评论的 `comments_raw.md`，返回 1 篇文章 + 10 条评论 |
| 2 | `test_sentiment_analysis` | `analyze_sentiment()` 对正面/负面/中性评论分别返回 1 / -1 / 0 |
| 3 | `test_emotion_tags_extraction` | `extract_emotion_tags()` 对"这不就是我吗"返回含 `resonance` 的列表；对"胡说八道"返回含 `anger` 的列表 |
| 4 | `test_theme_tags_extraction` | `extract_theme_tags()` 对"例子不接地气"返回含 `案例不足` 的列表；对"干货足"返回含 `干货足` 的列表 |
| 5 | `test_dropoff_curve_update` | `calc_dropoff_curve()` 对 5 段 views 数据计算 dropoff_rate，第3段（7200→3400）dropoff_rate ≈ 0.5278，high_dropoff_anchors 含"第3段" |
| 6 | `test_emotion_curve_update` | `aggregate_emotion_curve()` 对 10 条评论聚合 sentiment_summary（正面 0.4 / 中性 0.2 / 负面 0.4），reader_feedback_score == 4.0 |

#### 测试用例骨架（6 个测试函数完整实现）

```python
# tests/test_reader_feedback.py
"""M16 读者反馈闭环的回归测试（shortform 模式专属）。"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.novelforge.parse_reader_feedback import (
    parse_comments_raw,
    analyze_sentiment,
    extract_emotion_tags,
    extract_theme_tags,
    detect_drop_off_indicator,
    calc_dropoff_curve,
    aggregate_emotion_curve,
)


# 测试 1：parse_comments_raw 可解析评论
def test_parse_comments_raw():
    raw_text = """---
article_id: T-008
article_title: 为什么聪明人反而吃亏
platform: wechat
publish_date: 2026-07-15
collected_at: 2026-07-18
---

## 评论 1
- 用户：匿名读者
- 时间：2026-07-16 14:23
- 内容：道理我都懂，但例子不接地气，能不能多举点身边的案例？

## 评论 2
- 用户：王五
- 时间：2026-07-16 18:45
- 内容：终于有人把这事说清楚了！转发给老公看看。
"""
    articles = parse_comments_raw(raw_text)
    assert len(articles) == 1, f"期望 1 篇文章，实际 {len(articles)}"
    assert articles[0]["article_id"] == "T-008"
    assert articles[0]["article_title"] == "为什么聪明人反而吃亏"
    assert len(articles[0]["comments"]) == 2, f"期望 2 条评论，实际 {len(articles[0]['comments'])}"
    
    c1 = articles[0]["comments"][0]
    assert c1["comment_id"] == "T-008-C001"
    assert c1["article_id"] == "T-008"
    assert c1["platform"] == "wechat"
    assert "不接地气" in c1["content"]


# 测试 2：sentiment_analysis 情感分类正确
def test_sentiment_analysis():
    # 正面
    assert analyze_sentiment("学到不少干货，感谢分享！") == 1
    assert analyze_sentiment("终于有人把这事说清楚了！转发给老公看看。") == 1
    # 负面
    assert analyze_sentiment("胡说八道，作者懂个屁。") == -1
    assert analyze_sentiment("标题党，正文没新意。") == -1
    # 中性（无明显情感词）
    assert analyze_sentiment("今天天气不错。") == 0


# 测试 3：emotion_tags 提取
def test_emotion_tags_extraction():
    # 共鸣
    tags = extract_emotion_tags("这不就是我吗？感同身受。")
    assert "resonance" in tags, f"期望含 resonance，实际 {tags}"
    
    # 愤怒
    tags = extract_emotion_tags("胡说八道，作者懂个屁。")
    assert "anger" in tags, f"期望含 anger，实际 {tags}"
    
    # 获得感
    tags = extract_emotion_tags("学到不少干货，感谢分享！")
    assert "gain" in tags, f"期望含 gain，实际 {tags}"
    
    # 失望
    tags = extract_emotion_tags("标题党，正文没新意。")
    assert "disappointment" in tags, f"期望含 disappointment，实际 {tags}"
    
    # 无匹配时缺省 indifference
    tags = extract_emotion_tags("今天天气不错。")
    assert tags == ["indifference"], f"期望 ['indifference']，实际 {tags}"


# 测试 4：theme_tags 提取
def test_theme_tags_extraction():
    # 案例不足
    tags = extract_theme_tags("例子不接地气，能不能多举点身边的案例？")
    assert "案例不足" in tags, f"期望含 案例不足，实际 {tags}"
    
    # 干货足
    tags = extract_theme_tags("学到不少干货，感谢分享！")
    assert "干货足" in tags, f"期望含 干货足，实际 {tags}"
    
    # 强共鸣
    tags = extract_theme_tags("这不就是我吗？感同身受。")
    assert "强共鸣" in tags, f"期望含 强共鸣，实际 {tags}"
    
    # 可转发
    tags = extract_theme_tags("终于有人把这事说清楚了！转发给老公看看。")
    assert "可转发" in tags, f"期望含 可转发，实际 {tags}"
    
    # 标题党
    tags = extract_theme_tags("标题党，正文没新意。")
    assert "标题党" in tags, f"期望含 标题党，实际 {tags}"


# 测试 5：dropoff_curve 计算正确
def test_dropoff_curve_update():
    dropoff_data = {
        "version": "1.0.0",
        "articles": [
            {
                "article_id": "T-008",
                "article_title": "为什么聪明人反而吃亏",
                "publish_date": "2026-07-15",
                "chapter_anchors": [
                    {"chapter_anchor": "开头", "position": 0, "views": 12000},
                    {"chapter_anchor": "第1段", "position": 1, "views": 9800},
                    {"chapter_anchor": "第2段", "position": 2, "views": 7200},
                    {"chapter_anchor": "第3段", "position": 3, "views": 3400},
                    {"chapter_anchor": "结尾", "position": 4, "views": 2800},
                ],
            }
        ],
    }
    
    calculated = calc_dropoff_curve(dropoff_data)
    article = calculated["articles"][0]
    anchors = article["chapter_anchors"]
    
    # 第1段弃书率 = (12000-9800)/12000 ≈ 0.1833
    assert abs(anchors[1]["dropoff_rate"] - 0.1833) < 0.01, f"第1段 dropoff_rate={anchors[1]['dropoff_rate']}"
    
    # 第3段弃书率 = (7200-3400)/7200 ≈ 0.5278（高弃书点）
    assert abs(anchors[3]["dropoff_rate"] - 0.5278) < 0.01, f"第3段 dropoff_rate={anchors[3]['dropoff_rate']}"
    
    # 整体完读率 = 2800/12000 ≈ 0.2333
    assert abs(article["overall_completion_rate"] - 0.2333) < 0.01, f"完读率={article['overall_completion_rate']}"
    
    # 高弃书锚点含"第3段"
    assert "第3段" in article["high_dropoff_anchors"], f"高弃书锚点={article['high_dropoff_anchors']}"


# 测试 6：emotion_curve 聚合正确
def test_emotion_curve_update():
    article = {
        "article_id": "T-008",
        "article_title": "为什么聪明人反而吃亏",
        "comments": [
            # 4 正面
            {"content": "学到不少干货，感谢分享！", "sentiment": 1, "emotion_tags": ["gain"], "drop_off_indicator": False},
            {"content": "终于有人把这事说清楚了！", "sentiment": 1, "emotion_tags": ["resonance"], "drop_off_indicator": False},
            {"content":这不就是我吗？感同身受。", "sentiment": 1, "emotion_tags": ["resonance"], "drop_off_indicator": False},
            {"content": "看完想立刻行动，加油！", "sentiment": 1, "emotion_tags": ["inspiration"], "drop_off_indicator": False},
            # 2 中性
            {"content": "今天天气不错。", "sentiment": 0, "emotion_tags": ["indifference"], "drop_off_indicator": False},
            {"content": "还行。", "sentiment": 0, "emotion_tags": ["indifference"], "drop_off_indicator": False},
            # 4 负面
            {"content": "胡说八道，作者懂个屁。", "sentiment": -1, "emotion_tags": ["anger"], "drop_off_indicator": False},
            {"content": "标题党，正文没新意。", "sentiment": -1, "emotion_tags": ["disappointment"], "drop_off_indicator": True},
            {"content": "第3段太啰嗦看不下去。", "sentiment": -1, "emotion_tags": ["disappointment"], "drop_off_indicator": True},
            {"content": "例子不接地气。", "sentiment": -1, "emotion_tags": ["disappointment"], "drop_off_indicator": False},
        ],
    }
    
    result = aggregate_emotion_curve(article)
    
    # 情感分布：正面 0.4 / 中性 0.2 / 负面 0.4
    summary = result["sentiment_summary"]
    assert summary["total_comments"] == 10
    assert abs(summary["positive_ratio"] - 0.4) < 0.01, f"正面比例={summary['positive_ratio']}"
    assert abs(summary["neutral_ratio"] - 0.2) < 0.01, f"中性比例={summary['neutral_ratio']}"
    assert abs(summary["negative_ratio"] - 0.4) < 0.01, f"负面比例={summary['negative_ratio']}"
    
    # 读者反馈分：正面比例 40% → 4.0
    assert result["reader_feedback_score"] == 4.0, f"反馈分={result['reader_feedback_score']}"
    
    # 情绪曲线非空
    assert len(result["emotion_curve"]) >= 1, f"情绪曲线={result['emotion_curve']}"
```

> **注意**：测试 6 中第 9 条评论内容 `{"content":这不就是我吗？感同身受。", ...}` 缺少开头引号，实际写入测试文件时需补全为 `{"content": "这不就是我吗？感同身受。", ...}`。

### 7.2 更新 `tests/bug_regression_list.md` 新增 BUG-066

在 `file:///workspace/tests/bug_regression_list.md` 末尾追加（按 bug-reporting.md 规范的描述性标题 + 编号字段）：

```markdown
## shortform 模式读者反馈闭环缺失导致创作调整无数据支撑

- **编号**：BUG-066
- **首次出现**：2026-07-18（M16 模块识别）
- **类型**：上下文预算 / 数据 / 工具链
- **现象**：shortform 模式（公众号文章）创作链路完全无读者反馈数据回流：① `topic-curator` 三维度评分（情绪浓度 × 0.4 + 争议度 × 0.3 + 品牌相关度 × 0.3）全部依赖作者主观判断，无往期读者反馈数据校正；② `virality-auditor` 维度 3 情绪曲线审计的是"正文设计的情绪曲线"，无"读者实际情绪反馈"对比；③ `brand-voice-guardian` 五维度检查作者调性一致性，但无读者侧情绪数据验证；④ 作者不知道哪一篇读者最爱看、不知道读者在哪一段弃书、不知道读者情绪曲线走向。导致 shortform 创作从"作者单方面输出"无法进化为"读者数据驱动优化"。
- **根因**：
  1. NovelForge shortform 模式现有 4 个 Skill（topic-curator / title-engineer / brand-voice-guardian / virality-auditor）全部是"作者侧"或"正文侧"检测，无"读者侧"反馈采集 Skill。
  2. 公众号评论区无开放 API（受微信平台限制），无法全自动采集读者评论，需"作者粘贴 + 工具解析"半自动方案，但 NovelForge 缺该方案的工具链（无评论解析脚本、无结构化数据存储、无反馈回流机制）。
  3. `topic-curator` 三维度评分体系中无"读者反馈分"维度，选题评分纯靠主观判断，无法用往期数据校正。
  4. `writer-polisher` shortform 模式生成下一章时不读取任何读者反馈数据，无"避坑参考"注入。
  5. `dev-checklist.md` 8 段 checklist 不含读者反馈闭环检测项，发布后无强制采集流程。
- **修复**：
  1. 新增 `.trae/skills/reader-feedback-collector/SKILL.md`（5 项职责：评论采集 / 弃书率录入 / 情绪曲线建模 / 反馈到选题 / 反馈到创作），是 shortform 模式专属的"读者侧反馈采集 Skill"。
  2. 新增 `NovelForge_Vault/06_短文/reader_feedback/` 数据目录（4 文件：`comments_raw.md` / `comments_parsed.json` / `dropoff_curve.json` / `emotion_curve.json`），作为读者反馈数据 SSOT。
  3. 新增 `scripts/novelforge/parse_reader_feedback.py`（纯标准库实现），含评论解析 + 情感分析（基于词典）+ 情绪标签提取（8 类枚举）+ 主题标签提取 + 弃书率计算 + 情绪曲线聚合。
  4. `topic-curator/SKILL.md` 升级：§选题评分体系追加第 4 维度「读者反馈分」（权重 20%，原三维度权重等比缩放为 32% / 24% / 24%）；§流程 1 新增"读读者反馈"步骤；§选题条目结构追加 `读者反馈分` 字段。
  5. `writer-polisher/SKILL.md` 升级：§双模式 shortform 模式差异段追加"生成前读 `emotion_curve.json`"指令；§阶段一第 1 步读取上下文追加"shortform 模式额外读 `emotion_curve.json`"。
  6. `dev-checklist.md` 新增 §九 读者反馈闭环段（6 项 checklist + 自检报告模板对应段）。
- **涉及文件**：
  - `.trae/skills/reader-feedback-collector/SKILL.md`（新增）
  - `NovelForge_Vault/06_短文/reader_feedback/comments_raw.md`（新增）
  - `NovelForge_Vault/06_短文/reader_feedback/comments_parsed.json`（新增）
  - `NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json`（新增）
  - `NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json`（新增）
  - `scripts/novelforge/parse_reader_feedback.py`（新增）
  - `.trae/skills/topic-curator/SKILL.md`（追加第 4 维度读者反馈分）
  - `.trae/skills/writer-polisher/SKILL.md`（shortform 模式追加 emotion_curve 注入）
  - `.trae/checklists/dev-checklist.md`（新增 §九）
  - `tests/test_reader_feedback.py`（新增 6 个测试用例）
- **回归测试**：
  - `tests/test_reader_feedback.py::test_parse_comments_raw`
  - `tests/test_reader_feedback.py::test_sentiment_analysis`
  - `tests/test_reader_feedback.py::test_emotion_tags_extraction`
  - `tests/test_reader_feedback.py::test_theme_tags_extraction`
  - `tests/test_reader_feedback.py::test_dropoff_curve_update`
  - `tests/test_reader_feedback.py::test_emotion_curve_update`
- **复现步骤**：
  1. 准备 `comments_raw.md` 含 10 条评论（覆盖正面/中性/负面三类情感）。
  2. 运行 `python scripts/novelforge/parse_reader_feedback.py --action parse_comments --vault NovelForge_Vault`。
  3. 修复前：无 `parse_reader_feedback.py` 脚本，无 `comments_parsed.json` / `emotion_curve.json` 产出，反馈数据无法结构化。修复后：脚本退出码 0，3 个 JSON 文件产出，10 条评论全部解析。
  4. 准备 `dropoff_curve.json` 含 5 段 views 数据，运行 `--action calc_dropoff`。
  5. 修复前：无弃书率计算，作者无法识别高弃书段落。修复后：第3段弃书率 0.5278 被识别为高弃书点，`high_dropoff_anchors` 含"第3段"。
- **频次**：第 1 次（首次识别 + 修复）。
- **教训/沉淀**：长篇小说连载依赖读者反馈调整节奏，公众号文章（shortform 模式）同理。"作者单方面输出"模式无法进化为"读者数据驱动优化"，必须建立"创作→发布→反馈→选题→创作"的闭环回路。读者反馈采集受平台 API 限制时，采用"作者粘贴 + 工具解析"半自动方案即可立即闭环，不必等待平台 API 开放。情感分析不引入第三方库（transformers / snowNLP），用纯标准库 + 词典 SSOT 实现轻量解析器，词典可随创作迭代增量扩充。M16 是建议层不是门禁层——读者反馈数据注入选题/创作环节作为参考，不阻断发布，与 check_consistency.py / check_ai_novel.py 的硬门禁哲学不冲突。已沉淀为 `reader-feedback-collector` Skill + `parse_reader_feedback.py` 脚本 + 4 文件 SSOT 数据目录，loop_log 2026-07 追加 #lesson: shortform 沉淀记录。
```

### 7.3 在 `check_consistency.py` / `check_ai_novel.py` 中新增的检测规则

**本模块不在 `check_consistency.py` / `check_ai_novel.py` 中新增检测规则。**

理由：
- `check_consistency.py` 是一致性硬门禁（P0 阻断 published），M16 是建议层（不阻断），哲学不同。
- `check_ai_novel.py` 是去 AI 味硬门禁（P0 阻断），M16 不检测 AI 味，检测读者反馈。
- M16 的"检测"由 `parse_reader_feedback.py` 独立承担，不污染现有硬门禁脚本。

---

## 八、风险点与回滚方案

### 8.1 风险等级评估

| # | 风险点 | 等级 | 理由 | 缓解措施 |
|---|---|---|---|---|
| 1 | `topic-curator` 综合评分公式从三维度升级为四维度，可能影响现有选题评分连续性 | **低** | 公式权重等比缩放（40%→32% / 30%→24% / 30%→24%），保持相对比例不变；缺省读者反馈分 3.0 时数值结果与原公式可比较 | 评分公式变更在 SKILL.md 中明确说明；测试覆盖缺省 3.0 场景；现有选题可按原公式重算对照 |
| 2 | `writer-polisher` shortform 模式追加 emotion_curve 注入，可能影响生成质量 | **低** | 注入是"避坑参考"非"硬约束"，且 `emotion_curve.json` 不存在时跳过注入（不阻断生成） | 测试覆盖文件缺失场景；注入内容明确标注"参考"非"约束" |
| 3 | 评论解析基于词典的情感分析准确率有限（中文表达多样性高） | **中** | 词典 SSOT 可能不全，"血如泉涌"等同义表达可能漏检 | 词典可随创作迭代增量扩充；测试覆盖核心关键词；提供 `sample_comments` 字段供人工复核 |
| 4 | 作者粘贴评论格式不规范可能导致解析失败 | **中** | frontmatter 字段缺失或评论块格式不符约定时解析跳过 | 解析脚本对缺省字段兜底（如 platform 缺省 wechat）；测试覆盖缺省字段场景 |
| 5 | `emotion_curve.json` 与 `virality-auditor` 设计情绪曲线对比可能引入主观偏差 | **低** | `design_vs_actual_gap` 字段需作者提供设计曲线，可缺省；缺省时不计算偏差，只输出实际曲线 | `design_vs_actual_gap` 是可选字段；测试覆盖缺省场景 |
| 6 | 半自动采集依赖作者主动粘贴，可能采集频率低 | **中** | 作者可能忘记粘贴评论，反馈数据稀疏 | `dev-checklist.md` §九 新增"发布后 3 天内采集评论"硬性 checklist；reader-feedback-collector Skill 触发词覆盖"采集读者反馈" |
| 7 | 新增 `reader_feedback/` 目录可能与其他 shortform 数据目录冲突 | **低** | 目录在 `06_短文/` 下独立子目录，不与 `topics.md` / `published/` / `drafts/` 冲突 | 目录命名唯一；测试覆盖目录创建 |
| 8 | `parse_reader_feedback.py` 引入新依赖（虽是标准库）可能影响 CI | **低** | 仅用 `json/re/os/argparse/sys/pathlib/collections/datetime`，全部 Python 3.8+ 标准库 | 测试在 CI 环境（Python 3.8+）运行；不引入第三方库 |

### 8.2 对核心资产的影响

| 核心资产 | 是否修改 | 影响 | 保护措施 |
|---|---|---|---|
| `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口） | 否 | 不动 | M16 是新增 Skill，不修改核心 9 + 主入口 |
| `.trae/skills/topic-curator/SKILL.md` | 是 | §评分体系追加第 4 维度；§流程 1 追加读反馈步骤；§条目结构追加字段 | 现有三维度评分逻辑保留；公式权重等比缩放；缺省 3.0 兼容原公式；version 1.0.0 → 1.1.0 |
| `.trae/skills/writer-polisher/SKILL.md` | 是 | §shortform 模式差异追加读 emotion_curve；§阶段一第 1 步追加注入 | 现有 novel 模式逻辑不变；shortform 模式增量注入；文件缺失时跳过不阻断；version 1.0.0 → 1.1.0 |
| `.trae/skills/virality-auditor/SKILL.md` | 否 | 不动 | M16 是 virality-auditor 的"读者侧镜像"，不修改 virality-auditor 自身 |
| `.trae/skills/brand-voice-guardian/SKILL.md` | 否 | 不动 | M16 反馈数据可被 brand-voice-guardian 第 5 步人设迭代建议消费，但不修改 brand-voice-guardian |
| `NovelForge_Vault/00_控制面/style_guide.md` | 否 | 不动 | 本模块不触碰风格基线 |
| `scripts/novelforge/check_consistency.py` | 否 | 不动 | M16 是建议层不是硬门禁，不污染一致性检测 |
| `scripts/novelforge/check_ai_novel.py` | 否 | 不动 | 去 AI 味脚本不被污染 |
| `scripts/novelforge/parse_reader_feedback.py` | 新增 | 独立脚本 | 纯标准库实现，不引入第三方依赖；不与现有脚本耦合 |
| `.trae/checklists/dev-checklist.md` | 是 | §九 新增 6 项 checklist + 自检报告模板段 | 现有 8 段不变；新增段在 §八 之后 |
| `tests/bug_regression_list.md` | 是 | 末尾追加 BUG-066 | 现有 49 条 bug 不变 |
| `NovelForge_Vault/06_短文/topics.md` | 否 | 不动 | M16 反馈数据通过 topic-curator 评分时读取，影响新选题评分，但 topics.md 自身结构不变 |

### 8.3 回滚方案

#### 8.3.1 回滚触发条件

- `parse_reader_feedback.py` 脚本运行报错率 > 30%（经 10 篇文章实测）
- `topic-curator` 四维度评分公式导致选题评分明显失真（如所有选题综合分都下降 > 1.0）
- `writer-polisher` shortform 模式注入 emotion_curve 后生成质量下降（连续 3 篇 virality-auditor 评分 < 1.2）
- `dev-checklist.md` §九 新增项导致自检流程阻塞
- 作者反馈"半自动采集流程过重，不愿粘贴评论"

#### 8.3.2 回滚步骤（按风险等级从高到低）

**回滚 1：`writer-polisher` shortform 模式注入回滚**（中风险，优先回滚）

```bash
cd /workspace
# 删除 §shortform 模式差异段的 M16 新增指令
# 删除 §阶段一第 1 步的 emotion_curve 注入段
git revert HEAD~1 -- .trae/skills/writer-polisher/SKILL.md
pytest -q tests/test_writer_polisher.py  # 若存在
```

**回滚 2：`topic-curator` 四维度评分回滚**（中风险）

```bash
cd /workspace
# 恢复三维度评分公式（删除第 4 维度读者反馈分）
# 恢复 §流程 1（删除"读读者反馈"步骤）
# 恢复 §选题条目结构（删除 读者反馈分 字段）
git revert HEAD~2 -- .trae/skills/topic-curator/SKILL.md
pytest -q tests/test_topic_curator.py  # 若存在
```

**回滚 3：`parse_reader_feedback.py` 脚本回滚**（低风险）

```bash
cd /workspace
rm scripts/novelforge/parse_reader_feedback.py
rm tests/test_reader_feedback.py
```

**回滚 4：`reader-feedback-collector` SKILL.md 回滚**（低风险）

```bash
cd /workspace
rm .trae/skills/reader-feedback-collector/SKILL.md
```

**回滚 5：`reader_feedback/` 数据目录回滚**（无风险）

```bash
cd /workspace
# 备份后删除（数据可能含作者已采集的评论，需先备份）
if [ -d NovelForge_Vault/06_短文/reader_feedback ]; then
  tar -czf /tmp/reader_feedback_backup_$(date +%Y%m%d).tar.gz NovelForge_Vault/06_短文/reader_feedback/
  rm -rf NovelForge_Vault/06_短文/reader_feedback/
fi
```

**回滚 6：`dev-checklist.md` §九回滚**（无风险）

```bash
cd /workspace
git revert HEAD~3 -- .trae/checklists/dev-checklist.md
```

**回滚 7：`bug_regression_list.md` BUG-066 回滚**（无风险）

```bash
cd /workspace
git revert HEAD~4 -- tests/bug_regression_list.md
```

#### 8.3.3 回滚后验证

```bash
# 验证回滚后系统恢复到 M16 之前状态
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
pytest -q
# 三项全过即回滚成功
```

#### 8.3.4 数据备份

由于本模块涉及 `NovelForge_Vault/06_短文/reader_feedback/` 目录新增数据（作者可能已粘贴评论），回滚前需备份：

```bash
cd /workspace
# 备份已采集的读者反馈数据
if [ -d NovelForge_Vault/06_短文/reader_feedback ]; then
  tar -czf /tmp/reader_feedback_backup_$(date +%Y%m%d).tar.gz NovelForge_Vault/06_短文/reader_feedback/
fi
git stash push -m "M16 WIP before rollback" \
  .trae/skills/reader-feedback-collector/SKILL.md \
  .trae/skills/topic-curator/SKILL.md \
  .trae/skills/writer-polisher/SKILL.md \
  .trae/checklists/dev-checklist.md \
  scripts/novelforge/parse_reader_feedback.py \
  tests/test_reader_feedback.py \
  tests/bug_regression_list.md
```

#### 8.3.5 分支策略

建议在 `feature/reader-feedback` 分支开发，合并前充分测试：

```bash
cd /workspace
git checkout -b feature/reader-feedback
# ... 开发 + 测试 ...
pytest -q tests/test_reader_feedback.py -v
python scripts/novelforge/parse_reader_feedback.py --action all --vault NovelForge_Vault
# 测试通过后合并到 master
git checkout master
git merge --no-ff feature/reader-feedback -m "feat(reader-feedback): M16 读者反馈闭环（shortform 模式专属）"
```

---

## 九、完成标准（DoD 清单）

本模块完成的标准是以下 8 项全部 ✅：

- [ ] **1. `reader-feedback-collector SKILL.md` 创建**：路径 `file:///workspace/.trae/skills/reader-feedback-collector/SKILL.md`，含 5 项职责全闭环（评论采集 / 弃书率录入 / 情绪曲线建模 / 反馈到选题 / 反馈到创作）；含触发条件、工作流、输出格式、反模式、与其他 Skill 的关系、能力边界声明 6 段；frontmatter 含 name / description / version 字段。
- [ ] **2. `reader_feedback/` 数据目录创建（4 文件）**：
  - `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/comments_raw.md`（含格式约定示例）
  - `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/comments_parsed.json`（含 schema 示例）
  - `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/dropoff_curve.json`（含 schema 示例）
  - `file:///workspace/NovelForge_Vault/06_短文/reader_feedback/emotion_curve.json`（含 schema 示例）
- [ ] **3. `parse_reader_feedback.py` 脚本可运行**：路径 `file:///workspace/scripts/novelforge/parse_reader_feedback.py`，含 6 个核心函数（`parse_comments_raw` / `analyze_sentiment` / `extract_emotion_tags` / `extract_theme_tags` / `detect_drop_off_indicator` / `calc_dropoff_curve` / `aggregate_emotion_curve`）；支持 `--action parse_comments / calc_dropoff / all` 三类操作；纯标准库实现（无第三方依赖）；执行 `python scripts/novelforge/parse_reader_feedback.py --action all --vault NovelForge_Vault` 退出码 0。
- [ ] **4. `topic-curator SKILL.md` 升级**：§选题评分体系追加第 4 维度「读者反馈分」（权重 20%，原三维度权重等比缩放为 32% / 24% / 24%）；§综合评分公式更新；§选题条目结构追加 `读者反馈分` 字段；§流程 1 新增"读读者反馈"步骤；version 1.0.0 → 1.1.0。
- [ ] **5. `writer-polisher SKILL.md` 升级（shortform 模式）**：§双模式 shortform 模式差异段追加"生成前读 `emotion_curve.json`"指令；§阶段一第 1 步读取上下文追加"shortform 模式额外读 `emotion_curve.json`"注入；version 1.0.0 → 1.1.0。
- [ ] **6. `dev-checklist.md` 新增检测项**：§九 读者反馈闭环段（6 项 checklist + 自检报告模板对应段）；与 §一创作质量 ~ §八去 AI 味并列。
- [ ] **7. `tests/test_reader_feedback.py` 6 个用例全部通过**：`test_parse_comments_raw` / `test_sentiment_analysis` / `test_emotion_tags_extraction` / `test_theme_tags_extraction` / `test_dropoff_curve_update` / `test_emotion_curve_update` 全部 PASSED；执行 `pytest -q tests/test_reader_feedback.py -v` 退出码 0。
- [ ] **8. `bug_regression_list.md` 新增 BUG-066**：按 bug-reporting.md 规范填写完整（描述性标题 + 编号字段 + 9 个标准字段：编号 / 首次出现 / 类型 / 现象 / 根因 / 修复 / 涉及文件 / 回归测试 / 复现步骤 / 频次 / 教训沉淀）；执行 `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` + `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` + `pytest -q` 三项全部通过。

---

## 附录 A：与 M13 / M14 / M15 的边界

| 模块 | 范围 | 与 M16 的边界 |
|---|---|---|
| M13 爽点曲线量化检测 | novel 模式专属，check_consistency.py 新增 `pacing_curve` 检测 | M16 是 shortform 模式专属，与 M13 模式互斥不重叠 |
| M14 因果链检测 | novel 模式专属，check_consistency.py 新增 `causal_chain_break` 检测 | M16 是 shortform 模式专属，与 M14 模式互斥不重叠 |
| M15 章节字数曲线 | novel 模式专属，章节字数分布报告 | M16 是 shortform 模式专属，与 M15 模式互斥不重叠 |

**关键边界**：M13 / M14 / M15 是 novel 模式的一致性/曲线检测增强（硬门禁或可视化），M16 是 shortform 模式的读者反馈闭环（建议层）。四者模式互斥、哲学不同、不冲突。

## 附录 B：`comments_raw.md` 完整示例

`NovelForge_Vault/06_短文/reader_feedback/comments_raw.md` 完整示例（含 3 篇文章评论）：

```markdown
---
article_id: T-005
article_title: 35岁被裁后我靠副业月入2万
platform: wechat
publish_date: 2026-07-10
collected_at: 2026-07-13
---

## 评论 1
- 用户：张三
- 时间：2026-07-10 20:15
- 内容：这不就是我吗？感同身受，转发给老婆看看。

## 评论 2
- 用户：李四
- 时间：2026-07-11 09:30
- 内容：学到不少干货，感谢分享！副业方向很实用。

## 评论 3
- 用户：王五
- 时间：2026-07-11 14:20
- 内容：看完想立刻行动，加油！马上去试。

---

---
article_id: T-008
article_title: 为什么聪明人反而吃亏
platform: wechat
publish_date: 2026-07-15
collected_at: 2026-07-18
---

## 评论 1
- 用户：匿名读者
- 时间：2026-07-16 14:23
- 内容：道理我都懂，但例子不接地气，能不能多举点身边的案例？

## 评论 2
- 用户：王五
- 时间：2026-07-16 18:45
- 内容：终于有人把这事说清楚了！转发给老公看看。

## 评论 3
- 用户：李四
- 时间：2026-07-17 09:12
- 内容：标题党，正文没新意。第3段太啰嗦看不下去。

---

---
article_id: T-010
article_title: AI时代的中年危机
platform: wechat
publish_date: 2026-07-12
collected_at: 2026-07-15
---

## 评论 1
- 用户：赵六
- 时间：2026-07-12 21:00
- 内容：焦虑，我也面临这问题，怎么办？

## 评论 2
- 用户：孙七
- 时间：2026-07-13 10:15
- 内容：期待下篇，想知道怎么应对。
```

## 附录 C：参考来源

- `file:///workspace/.trae/skills/topic-curator/SKILL.md`（三维度评分体系，M16 追加第 4 维度）
- `file:///workspace/.trae/skills/virality-auditor/SKILL.md`（四维度传播性审计，M16 的"设计侧镜像"）
- `file:///workspace/.trae/skills/brand-voice-guardian/SKILL.md`（五维度品牌调性，M16 反馈数据可被其消费）
- `file:///workspace/.trae/skills/writer-polisher/SKILL.md`（双模式执笔精修，M16 shortform 模式追加 emotion_curve 注入）
- `file:///workspace/.trae/checklists/dev-checklist.md`（8 段 checklist，M16 新增 §九 读者反馈闭环段）
- `file:///workspace/NovelForge_Vault/06_短文/topics.md`（shortform 选题池，M16 反馈数据通过 topic-curator 影响新选题评分）
- `file:///workspace/.trae/rules/dev-workflow.md` §一 第三步执行规范
- `file:///workspace/.trae/rules/bug-reporting.md` Bug 记录与回归规范
- `file:///workspace/docs/optimization_plan_2026_07/M13_pacing_curve.md`（爽点曲线检测，novel 模式专属，与 M16 shortform 模式互斥）
- `file:///workspace/docs/optimization_plan_2026_07/M14_causal_chain.md`（因果链检测，novel 模式专属，与 M16 shortform 模式互斥）
- `file:///workspace/docs/optimization_plan_2026_07/M15_chapter_length_curve.md`（章节字数曲线，novel 模式专属，与 M16 shortform 模式互斥）
- 起点中文网作家后台 —— 章节级订阅留存曲线启发
- 新榜 / 西瓜数据 —— 公众号文章阅读数 / 评论情感分析启发
- 番茄小说数据后台 —— 章节级弃书率启发
- 知乎创作者中心 —— 回答点赞曲线 + 评论情感分布启发

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 优化方案多专家团（架构师 + 测试 + 规则三视角评审待办）
**评审状态**：待 plan-review Skill 三视角评审
**前置依赖**：无（M16 是新增模块，不依赖 M01-M15 任何前置模块）