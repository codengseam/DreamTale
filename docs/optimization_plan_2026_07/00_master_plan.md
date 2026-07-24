# NovelForge 项目大型优化方案 · 2026-07

> **核心目标**：让 NovelForge 真的能通过 AI 创作出起点神级小说（大神现象级文章）。
>
> **方案原则**：每个模块方案文档必须详细到「AI 直接读取即可开始优化、验证、修复」的程度——包含目标、痛点对应、涉及文件路径、详细实现步骤、验证命令、回归测试要求、风险点、DoD 清单。
>
> **设计依据**：项目能力盘点报告（24 Skills + 6 Python 脚本 + 11 状态机 + 49 Bug 记录） + 行业痛点调研报告（60+ 权威来源，覆盖 MemoRAG / Persona Vectors / CreAgentive / Letta Filesystem / 朱雀七维度 / 番茄 11.27 万本拒签 / 黄金三章法则 / 爽点曲线黄金分布）。

---

## 一、当前能力盘点速览

### 1.1 已覆盖较好的痛点（强项，无需重大改动）

| 痛点 | 覆盖机制 |
|---|---|
| AI 味检测 | `check_ai_novel.py` 10 维检测 + `style_guide.md` 禁用词表 + `writer-polisher` Skill 内化铁律 |
| 伏笔丢失 | `audit_hooks.py` 4 级分级 + 3 级 scope + `hooks_registry.json` 13 字段追踪 |
| 战力崩坏 | `check_consistency.py` 的 `power_level_jump` / `golden_finger_overreach` + `power_curve.json` |
| 状态漂移 | `check_consistency.py` 7 类检测 + `save_state.py` Delta 增量 + P0/P1 分级 |
| 记忆断层 | `recap-generator`（每 10 章）+ `key-scene-archiver`（Grep 召回）+ `build_context.py` 三层组装 |
| 上下文超限 | `build_context.py` Token 预算分桶 + 超限三步压缩 |
| 意图漂移 | 防漂移三铁律 + `drift-detector` 5 维度软性预警 |
| 工程基础设施 | 9 个通用工程 Skill + 2 Rules + 1 Checklist + 4 工具链脚本 + LoopAgent 沉淀 |

### 1.2 已识别的工程债（loop_log 沉淀，未完全修复）

| # | 工程债 | 影响 |
|---|---|---|
| D1 | 路径契约 10 项断链（章纲路径 / recap 路径 / 脚本调用形式） | 多 Agent 并行时易再次踩坑 |
| D2 | Skill 间契约缺失（writer-polisher 未产出章末摘要，recap-generator/drift-detector 假设其产出） | 守护 Skill 无法运转 |
| D3 | schema 滞后（PIPELINE_SCHEMA 缺 4 个守护 Skill 字段） | save_state.py 校验失败 |
| D4 | 文档与脚本脱节（style_guide.md 禁用词表 vs check_ai_novel.py 未做 SSOT） | 检测覆盖不全 |

### 1.3 完全未覆盖的盲区（12 类）

合规风险 / 多 POV 检测 / 因果链检测 / 黄金三章硬约束门禁 / 章节字数曲线 / 读者反馈闭环 / 伏笔回收质量 / 平台集成 / 选择性 KG / Persona Vectors 角色漂移监控 / 起点神级小说方法论沉淀 / 自检清单升级。

---

## 二、20 模块概览（按 5 层组织）

### L1 · 修复工程债（让现有能力真正闭环运转）

| # | 模块 | 核心目标 | 依赖 |
|---|---|---|---|
| [M1](./M01_skill_contract_layer.md) | Skill 间契约层修复 | 修复 writer-polisher 章末摘要断链；创建产出/消费契约声明模板；新增联调契约闭环验证脚本 | 无 |
| [M2](./M02_schema_sync_gate.md) | schema 同步门禁 | 修复 PIPELINE_SCHEMA 缺失的 4 个守护 Skill 字段；实现 state-consistency-checker flag 协议真正阻断保存 | 无 |
| [M3](./M03_doc_script_ssot.md) | 文档与脚本 SSOT 校验 | 新增 `check_doc_script_consistency.py`；修复 style_guide.md 禁用词表与 check_ai_novel.py 不一致项 | 无 |
| [M4](./M04_path_contract_template.md) | 路径契约表模板 | 在 dispatching-parallel-agents Skill 中固化"路径契约表"为并行 subagent 必填项；修复 10 项路径断链 | 无 |

### L2 · 强化已有能力（让检测更准更全更深）

| # | 模块 | 核心目标 | 依赖 |
|---|---|---|---|
| [M5](./M05_character_five_layer.md) | 角色五层档案模型升级 | 升级 protagonist.json schema（核心欲望/底层恐惧/性格正反面/成长弧光/语言指纹）；拆分 stable/mutable_info；新增语言指纹漂移检测 | M2 |
| [M6](./M06_foreshadow_five_stage.md) | 伏笔生命周期五阶段升级 | hooks_registry.json 从两态升级为五态（planted/progressing/hinted/resolved/archived）；新增伏笔回收质量评估 | M2 |
| [M7](./M07_active_enforcement.md) | active enforcement 生成后强制验证 | 强化 state-consistency-checker：生成后立即对照 Protected 层关键字段，P0 阻断保存 | M2 |
| [M8](./M08_context_clue_generation.md) | 上下文召回"线索生成"步骤 | build_context.py 显式实现 MemoRAG 式"线索清单生成 → 精准召回"，降低 Token 预算 30-50% | 无 |
| [M9](./M09_zhuque_anti_ai_rules.md) | 朱雀七维度对抗规则沉淀 | style_guide.md 沉淀朱雀七维度对抗铁律；check_ai_novel.py 补充句长标准差/转折词密度/em-dash 频率等量化检测 | M3 |

### L3 · 补齐盲区能力

| # | 模块 | 核心目标 | 依赖 |
|---|---|---|---|
| [M10](./M10_compliance_check.md) | 合规风险检测系统 | 新增 `check_compliance.py`（政治/色情/暴力/敏感词/版权）；新增 `platform_compliance.md`（起点/番茄/晋江/阅文系规则感知） | 无 |
| [M11](./M11_golden_three_chapters.md) | 黄金三章硬约束门禁 | check_ai_novel.py 新增 `golden_three_opening` 检测（首段钩子 ≤80 字 / 信息密度 ≤30% / 字数 2500-3000 / 第 3 章末必有钩子） | 无 |
| [M12](./M12_pov_consistency.md) | 多 POV 视角一致性检测 | check_consistency.py 新增第 8 类检测 `pov_switch_in_chapter`；章纲强制声明 POV 字段 | 无 |
| [M13](./M13_pacing_curve.md) | 爽点曲线量化检测 | check_consistency.py 新增 `pacing_curve` 检测（300/1000/3000/1万/30万字黄金分布；连续 3 章无爽点告警；连续 5 章压抑告警） | 无 |
| [M14](./M14_causal_chain.md) | 因果链检测 | check_consistency.py 新增第 9 类检测 `causal_chain_break`（A 章受伤 B 章活蹦乱跳类断裂） | 无 |
| [M15](./M15_chapter_length_curve.md) | 章节字数曲线可视化 | 基于 chapter_length_history.json 生成卷级字数分布报告；异常检测（前紧后松/卷末灌水） | 无 |
| [M16](./M16_reader_feedback_loop.md) | 读者反馈闭环（shortform） | 新增 `reader-feedback-collector` Skill；采集读者评论、弃书率、情绪曲线；反馈到选题库 | 无 |

### L4 · 引入前沿技术

| # | 模块 | 核心目标 | 依赖 |
|---|---|---|---|
| [M17](./M17_selective_kg.md) | 选择性 KG 路线（动感叙事） | 针对玄幻/都市动作戏章节，build_context.py 按需启用角色关系图召回；内省/言情章节保持纯文本召回 | 无 |
| [M18](./M18_persona_vectors_heuristic.md) | Persona Vectors 启发式角色漂移监控 | 基于角色语言指纹的 embedding 相似度比对，相似度低于阈值告警 | M5 |

### L5 · 沉淀方法论

| # | 模块 | 核心目标 | 依赖 |
|---|---|---|---|
| [M19](./M19_qidian_master_rules.md) | 起点神级小说创作方法论沉淀 | 新增 `.trae/rules/qidian-master-rules.md`（黄金三章/爽点曲线/十种爽点公式/反转四招/画面感四法/高潮六招/反派三种/死亡三种/情绪四法）；architect Skill 引用 | M11, M13 |
| [M20](./M20_checklist_loop_upgrade.md) | 开发自检清单 + LoopAgent 沉淀升级 | dev-checklist.md 新增 8 项检测项；loop_log 增加 #lesson slug；每模块完成强制沉淀 | 所有前置模块 |

---

## 三、依赖关系图

```
                    ┌─────────────────────────────────────┐
                    │           L1 修复工程债              │
                    │                                     │
                    │  M1 ─────┐  M2 ─────┐  M3 ─────┐ M4 │
                    │          │          │          │    │
                    └──────────┼──────────┼──────────┼────┘
                               │          │          │
                               ▼          ▼          ▼
                    ┌─────────────────────────────────────┐
                    │           L2 强化已有能力           │
                    │                                     │
                    │  M5 ◄─ M2     M8 ────┐  M9 ◄─ M3    │
                    │  M6 ◄─ M2           │              │
                    │  M7 ◄─ M2           │              │
                    └─────────────────────┼──────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────┐
                    │           L3 补齐盲区能力           │
                    │                                     │
                    │  M10  M11  M12  M13  M14  M15  M16 │
                    │  (全部独立，无内部依赖)              │
                    └─────────────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────┐
                    │           L4 引入前沿技术           │
                    │                                     │
                    │  M17 (独立)        M18 ◄─ M5        │
                    └─────────────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────┐
                    │           L5 沉淀方法论             │
                    │                                     │
                    │  M19 ◄─ M11, M13                    │
                    │  M20 ◄─ 所有前置模块                 │
                    └─────────────────────────────────────┘
```

### 3.1 关键依赖链（必须按顺序执行）

| 链 | 顺序 | 说明 |
|---|---|---|
| **schema 链** | M2 → M5/M6/M7 → M18 | schema 修复是所有依赖状态机字段模块的前置 |
| **SSOT 链** | M3 → M9 | 文档脚本一致性是朱雀对抗规则沉淀的前置 |
| **黄金三章链** | M11 → M19 | 硬约束门禁是方法论沉淀的前置 |
| **爽点曲线链** | M13 → M19 | 量化检测是方法论沉淀的前置 |
| **角色档案链** | M5 → M18 | 五层档案是 Persona Vectors 启发式实现的前置 |
| **汇总链** | 所有模块 → M20 | 自检清单升级必须汇总所有模块的检测项 |

### 3.2 可并行执行的模块组

| 并行组 | 模块 | 说明 |
|---|---|---|
| **并行组 A**（L1 全部） | M1, M2, M3, M4 | 4 个工程债修复，互不依赖 |
| **并行组 B**（L2 全部 + L4 部分） | M5, M6, M7, M8, M9 | L2 五个强化模块（依赖 L1） |
| **并行组 C**（L3 全部 + L4 部分） | M10, M11, M12, M13, M14 | L3 前五个补盲模块（独立） |
| **并行组 D**（L3 后段 + L4 + L5 部分） | M15, M16, M17, M18, M19 | L3 后两个 + L4 两个 + L19（依赖 M11/M13 已完成） |
| **并行组 E**（L5 收尾） | M20 | 汇总所有模块，必须最后做 |

---

## 四、执行顺序建议

### 4.1 推荐执行批次

```
批次 1（并行组 A）：M1 → M2 → M3 → M4
   ↓ 等待全部完成
批次 2（并行组 B）：M5 → M6 → M7 → M8 → M9
   ↓ 等待全部完成
批次 3（并行组 C）：M10 → M11 → M12 → M13 → M14
   ↓ 等待全部完成
批次 4（并行组 D）：M15 → M16 → M17 → M18 → M19
   ↓ 等待全部完成
批次 5（并行组 E）：M20
   ↓ 等待完成
评审：plan-review Skill 三视角评审全部 21 份文档
   ↓ 修订
最终方案集
```

### 4.2 灵活执行策略

如果时间紧迫，可按以下优先级裁剪：

| 优先级 | 模块 | 理由 |
|---|---|---|
| **P0 必做** | M1, M2, M3, M4, M10, M11 | 修复工程债 + 合规风险 + 黄金三章硬约束 |
| **P1 强烈推荐** | M5, M6, M7, M9, M13, M19 | 角色档案 + 伏笔五阶段 + 强制验证 + 朱雀对抗 + 爽点曲线 + 方法论 |
| **P2 可选** | M8, M12, M14, M15, M16, M17, M18, M20 | 锦上添花，资源紧张可延后 |

---

## 五、每个模块方案文档的标准结构

每份 `Mxx_xxx.md` 必须包含以下 8 个 section，确保 AI 可直接读取执行：

```
# Mxx · 模块名称

## 一、模块目标
- 一句话目标
- 对应的痛点（来自调研报告的具体引用）
- 完成后达成的能力（可量化）

## 二、痛点对应
- 痛点表现（数据/案例）
- 行业方案（Sudowrite/NovelCrafter/学术前沿）
- 本模块的差异化设计

## 三、涉及现有文件
- 精确路径列表（file:/// 链接）
- 每个文件需要修改的具体位置（行号或 section）

## 四、新增/修改文件清单
- 新增文件路径
- 修改文件路径
- 每个文件的核心改动点

## 五、详细实现步骤
- 编号步骤（1. 2. 3. ...）
- 每步可直接执行（包含命令、代码片段、配置示例）
- 标注哪些步骤可并行

## 六、验证方式
- 单元测试命令（pytest -q tests/test_xxx.py）
- 集成测试命令（python scripts/novelforge/check_xxx.py --vault NovelForge_Vault）
- 断言清单（具体检测什么、期望输出什么）
- 与现有校验脚本的关系（是否冲突、是否补充）

## 七、回归测试要求
- 新增 pytest 用例（路径 + 测试函数名 + 断言）
- 是否需要更新 tests/bug_regression_list.md（BUG-050+）
- 在 check_consistency.py / check_ai_novel.py 中新增的检测规则

## 八、风险点与回滚方案
- 风险等级（低/中/高）+ 理由
- 对核心资产的影响（style_guide.md / check_consistency.py / check_ai_novel.py 等）
- 回滚方案（git revert / 分支隔离 / 数据备份）

## 九、完成标准（DoD 清单）
- [ ] item 1
- [ ] item 2
- ...
```

---

## 六、验证与评审流程

### 6.1 模块级验证

每份方案文档完成后，由作者 subagent 自行执行一次"自检"，确保：

1. 8 个 section 全部填写完整
2. 涉及文件路径全部为绝对路径（file:/// 链接）
3. 实现步骤可直接执行（无模糊表述如"适当调整"）
4. 验证命令可直接复制运行
5. DoD 清单可逐项打勾验证

### 6.2 整体评审

21 份文档全部完成后，启用 `plan-review` Skill 三视角并行评审：

| 视角 | 关注点 |
|---|---|
| **架构师视角** | 模块间依赖是否合理；是否过度工程化；是否破坏 NovelForge 核心哲学（文件即真相 / Skill 编排 / Delta 增量 / 防漂移三铁律 / 去 AI 味第一公民） |
| **测试视角** | 验证命令是否可直接运行；回归测试是否覆盖；DoD 是否可量化验证 |
| **规则视角** | 是否符合 dev-workflow.md / bug-reporting.md；是否引入新的路径契约不一致；是否需要更新 rules / checklist |

### 6.3 修订闭环

评审报告标识需修订的模块 → 修订 → 再次评审 → 直至全部通过。

---

## 七、整体完成标准（DoD）

- [ ] 21 份方案文档全部完成（1 总览 + 20 模块）
- [ ] 每份文档 8 个 section 填写完整
- [ ] 依赖关系图与实际方案一致
- [ ] plan-review 三视角评审通过
- [ ] 评审报告归档至 `docs/optimization_plan_2026_07/review_report.md`
- [ ] 用户确认可进入执行阶段

---

## 八、参考调研

### 8.1 项目能力盘点（截至 2026-07-18）

- 14 个 NovelForge Skill（1 主入口 + 5 核心 + 4 shortform + 4 守护）
- 9 个通用工程 Skill
- 6 个 novelforge Python 脚本（共 6157 行）
- 4 个根级工具链脚本
- 2 Rules + 1 Checklist
- 11 个状态机文件
- 49 条 Bug 回归记录
- 2 个月 loop_log 沉淀（65 条 H2）

### 8.2 行业调研核心来源

| 类别 | 来源 |
|---|---|
| 学术论文 | MemoRAG (WWW 2025) / Persona Vectors (arXiv 2507.21509) / Consistently Simulating Personas (NeurIPS 2025) / Spotting OOC (ACL 2025) / Chameleon LLMs (EMNLP 2025) / CreAgentive (ICLR 2026 投稿) / Guiding Storytelling with KG (arXiv 2505.24803) / Remember Me (ICCC26) / StoryBox (arXiv 2510.11618) |
| 工业产品 | Sudowrite / NovelCrafter / 阅文妙笔 / 彩云小梦 / 秘塔写作猫 / 蛙蛙写作 / NovelAI / WriteWise / 量探 |
| AI 检测 | 朱雀七维度（腾讯混元安全） / PaperYY / 平台规则（番茄/起点/晋江/阅文系） |
| 长篇记忆 | Letta Filesystem / Mem0 / MemGPT / Zep (Graphiti) |
| 网文方法论 | 三文件法 / 五步 SOP / 五层角色模型 / 五种 AI 辅助方法 / Stepwise AI Method / 黄金三章法则 / 大神 1888 元技巧 / 爽点曲线黄金分布 |
| 起点 2025-2026 神作 | 《青山》《捞尸人》《十日终焉》《谁让他修仙的！》《玄鉴仙族》《灵境行者》 |

完整来源索引见各模块文档附录。

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 多专家团（项目能力盘点 + 行业痛点调研 + 方案设计）
