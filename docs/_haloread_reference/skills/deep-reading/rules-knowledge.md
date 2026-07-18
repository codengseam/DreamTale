# 知识专栏写作规则（knowledge 桶）

本规则用于指导 Agent 生成 knowledge 桶 Markdown 讲书笔记。详细项目背景见 [README.md](../../../README.md)。

> **适用范围声明**：本规则仅适用 **knowledge 桶**（知识体系类专栏：AI课、易经课、技术类知识，如 AI 大模型学习、易经课、未来的数据结构/算法/Python/Redis 等）。
> - **narrative 桶**（古籍专栏：史/经/子/集）见 [rules.md](rules.md)。
> - **modern 桶**（理财/职场/养生类现代专栏）见 [rules-modern.md](rules-modern.md)。
> - archetype 信源优先级与路由逻辑见 [design.md §5.6](../../../docs/archetype-design/design.md#五数据流设计)。
> - **分工边界**：本文件管「怎么写」（写作风格/结构/术语规范/教学节奏）；「怎么查」（白名单清单/阈值/扣分规则）见 [content-quality.md §8.3](content-quality.md#83-knowledge-桶ai课易经课) knowledge 桶规则集。两者协同：本文件给骨架与笔法，§8.3 给质检标尺。

## 一、结构模板（四段）

按 `config.yaml` 的 `section_templates.knowledge` 配置，顺序固定：

| 段名 | 作用 | 写作要点 |
|---|---|---|
| 概念 | 核心概念定义与边界 | 用一句话给出准确定义，再划清边界（"是什么、不是什么"）；首次出现的术语给中英对照（见 §三） |
| 原理 | 底层原理与机制 | 讲清楚"为什么这样做能work"，含必要的形式化描述（复杂度、数学公式、架构图说明）；按递进逻辑展开，不跳跃 |
| 实践 | 应用场景与案例 | 配 1-2 个真实/可考案例说明如何用，含输入输出预期；命令/代码须可直接运行核验 |
| 速查/自测 | 速查表或自测题 | 给 3-5 道自测题（含答案折叠）或一张速查表（复杂度表、命令对照表、参数表等） |

> 数据结构/算法/Python/Redis 等技术教程完全契合此结构：概念（栈/队列定义）→原理（复杂度证明）→实践（代码实现）→速查（复杂度表/命令表）。

## 二、语言风格

**要做：**
- 模块化教学，每段聚焦一个知识点，段间用过渡句衔接（"了解了 X，下一步看 Y 怎么实现"）。
- 术语密集但首次出现必给中英对照和一句白话解释（见 §三）。
- 强调准确性与递进性：概念准确→原理严谨→实践可复现→速查可检索。
- 命令、代码、公式用代码块或行内代码格式，不混入正文叙述。

**不做：**
- 不用叙事讲书笔法（knowledge 桶不是讲故事，是讲体系）。
- 不堆砌"我们可以看到""这告诉我们"等 AI 套路句式。
- 不编造论文结论或基准数据（见 §四真实性）。
- 不在没有定义的情况下直接用术语，假设读者已知。

## 三、术语规范（knowledge 桶的核心特征）

### 3.1 中英对照

术语首次出现时给中英对照，格式：「Transformer（变换器）」或「Attention（注意力机制）」。后续可用任一形式。

### 3.2 术语白名单

knowledge 桶的中英混杂白名单最宽，容纳技术术语（详见 `src/utils/content_quality.py` 的 `KNOWLEDGE_TERMS_WHITELIST`）：

- 模型/算法类：Transformer、Attention、Token、Tokenizer、Embedding、RAG、LLM、GPT、BERT
- 硬件类：GPU、CPU、TPU
- 接口/协议类：API、REST、GraphQL、gRPC
- 存储/数据库类：SQL、NoSQL、ACID、BASE、CAP、RDBMS、BTree、LSM
- 编程语言类：Python、Java、Rust

非白名单的中英紧邻混杂（如「这个 model 很 powerful」）仍报。

### 3.3 命令与代码

- 命令、API、函数名、文件路径用反引号代码格式。
- 代码块标注语言（```python / ```sql / ```bash）。
- 命令须可直接复制运行，不含未声明的环境变量。

## 四、真实性规则

### 4.1 技术原理准确

- 复杂度（O(n log n)、O(1) 等）须与算法实际匹配，不靠估算。
- 数学公式须正确（如 softmax 分母含 exp 求和、attention 的 Q/K/V 维度对齐）。
- 架构描述须与官方文档/论文一致（如 Transformer 的多头注意力、LayerNorm 位置）。

### 4.2 不编造论文结论或基准数据

- 引用论文须给标题、作者、年份、机构（如「Vaswani et al., 2017, Google Brain」）。
- 不编造基准数据（如"在 GLUE 上达到 92.4"）——必须有出处或明确标注"截至本文写作时"。
- 引用 arXiv 论文给编号（如「arXiv:1706.03762」）。

### 4.3 命令可核验

- 命令须可在对应软件版本下运行，不写已废弃或幻觉的命令。
- 跨版本差异须标注（如「Python 3.10+」「PostgreSQL 14+」）。

### 4.4 易经课等带古典知识体系的专栏

- 经典原文须真实有据、单段 ≤ 20 字、出处准确（同 narrative 桶要求）。
- 卦象、爻辞、卦序须与《周易》原文一致，不编造。
- 历代注解（如王弼、朱熹、来知德）须准确归属，不张冠李戴。
- 成书年代与作者争议须交代（如"经传分篇"的传统与现代考据）。

## 五、跳过项（与 narrative 桶的差异）

knowledge 桶**跳过**以下 narrative 桶专属检查（详见 content-quality.md §8.0 路由表）：

- `check_years_present`（年份必填）——知识体系不强求年份，除非是论文发表年
- `check_famous_critics`（古籍名家）——见 §4.4 易经课等古典知识体系按需引用
- `check_temporal_order`（时间线）——knowledge 桶按概念递进而非时间展开
- `check_modern_jargon`（现代术语禁用）——见 §3.2 术语白名单最宽
- `check_chapter_title_soul`（古籍向章回体灵魂标题）——knowledge 桶标题聚焦"概念/原理/速查"而非"事件冲突"

## 六、通用项保留（全桶共享，详见 content-quality.md）

以下检查全桶都跑，不跳过（BUG-026 教训：灵魂再好数字错了仍是 P0）：

- `check_ai_cliches`（套话黑名单）——详见 content-quality.md §9.2
- `check_numeric_facts` auto（数字硬错误）——详见 content-quality.md §9.3
- `check_numeric_facts` manual（N年/岁/品）——knowledge 桶过滤误标项（如"N 个 token""N 层 Transformer"是正常表达）
- `check_soft_ai_pattern`、`check_redundant_citation`、`check_inline_references`/`check_sources_section`、`check_modern_jargon_terms`（硬套术语）

## 七、错别字清单与并行质检核对

详见 content-quality.md §8.5（通用错别字清单）和 §8.6（并行质检后核对五步）。knowledge 桶不豁免。

## 八、与文风注入的关系

knowledge 桶当前**跳过** tone_setter / chief_editor 节点（走原 else 分支 `orchestrator→specialists` + `quality→save`，save 链路完整不断链）。阶段4 落地 knowledge 版 tone_setter/chief_editor prompt 后再开启对应桶（详见 design.md §10.6）。

写作时无需考虑 soul injection——knowledge 桶的"灵魂"由本规则的"准确性 + 深度独家性 + 可操作性"承载，而非古籍桶的"残酷底色 + 史观穿透"，也非 modern 桶的"洞察独家性 + 落地可行性"。
