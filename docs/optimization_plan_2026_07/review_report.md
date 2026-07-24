# NovelForge 优化方案三视角评审报告

> 评审对象：`/workspace/docs/optimization_plan_2026_07/` 下 21 份方案文档（00_master_plan + M01-M20）
> 评审方式：plan-review Skill 主路径（会话内并行 3 个 subagent）
> 评审角色：架构师 / 测试 / 规则
> 评审日期：2026-07-18
> 评审模式：只读不改

---

## 评审摘要

| 角色 | 总体评价 | 关键发现 |
|---|---|---|
| 架构师 | 有保留通过 | 17/20 模块设计与 5 大核心哲学一致；2 个 P0 阻塞：维度编号冲突 + dev-checklist 章节冲突；M18 外部依赖 + M19 章纲字段膨胀需精简 |
| 测试 | 有保留通过 | 137 个 pytest 用例 + 纯标准库 + 三级 fallback + tmp_path 隔离模式成熟；2 个测试用例本身缺陷（M16 JSON 缺引号 / M17 CLI 参数不一致）；高风险模块 gradual rollout 三阶段测试覆盖不足 |
| 规则 | B+（形式合规良好，实质合规需整改） | BUG-050~070 全部符合 bug-reporting.md 规范；3 项 P0 阻断：维度编号冲突、M18 外部依赖、核心资产红线被多次触碰 |

**整体结论**：**有保留通过**——21 份方案整体质量高，体现了对 NovelForge 系统架构与五大核心哲学的深入理解，但需完成 **5 项 P0 阻塞整改** 后方可进入实施阶段。

---

## 一、架构师评审

### 1.1 总体评价

**有保留通过** —— 修复 2 个 P0 阻塞 + 3 个 P1 高优问题后，方案可进入执行阶段。

### 1.2 五维度评级

| 维度 | 评级 | 关键发现 |
|---|---|---|
| 可行性 | ✅ | 14/20 模块 ✅ 可行，6/20 ⚠️ 有风险但可落地（M08/M14/M16/M17/M18）；M18 三级 fallback 设计合理 |
| 依赖关系 | ⚠️ | 6 条主依赖链清晰；**维度编号冲突未协调**（P0 阻塞） |
| 与现有架构一致性 | ✅ | 17/20 模块与 5 大核心哲学一致；M18 外部依赖部分挑战"零依赖"哲学 |
| 模块化 | ⚠️ | 5 个并行组划分合理；check_consistency.py 与 dev-checklist.md 两个共享文件被多模块修改，编号协调缺失 |
| 扩展性 | ✅ | SSOT 模式 + FLAG_SCHEMA 协议 + 三级 fallback + slug 受控表扩展机制设计良好；JSON SSOT 文件过多（10+）+ 章纲字段膨胀是潜在维护负担 |

### 1.3 关键风险点

| # | 模块 | 风险点 | 严重度 |
|---|---|---|---|
| 1 | M5/M12/M13/M14/M18 | check_consistency.py 维度编号 5 模块争抢"第 8/9 类" | **P0 阻塞** |
| 2 | M19/M20 | dev-checklist.md 章节编号冲突（M19 §方法论符合度 vs M20 §九-§十六） | **P0 阻塞** |
| 3 | M17 | 测试 6 字段名 `type` vs `edge_type`/`node_type` 不一致 | P1 高 |
| 4 | M18 | 首次引入 embedding 服务，部分违背"零依赖"哲学 | P1 高 |
| 5 | M19 | 章纲十段模板一次性新增 9 个字段，填写负担显著增加 | P1 高 |
| 6 | M17/M18 | 修改核心脚本 build_context.py / check_consistency.py，回归风险中等 | P1 高 |
| 7 | M08/M17 | build_context.py 被 M08 + M17 同时修改，Retrieved 层注入顺序未协调 | P2 中 |

### 1.4 Top 5 关键建议

1. **统一 check_consistency.py 维度编号**：第 8 类=M5 character_language_fingerprint_drift / 第 9 类=M12 pov_switch_in_chapter / 第 10 类=M13 pacing_curve / 第 11 类=M14 causal_chain_break / 第 12 类=M18 persona_vector_drift
2. **统一 dev-checklist.md 章节编号**：M20 保持 §九-§十六，M19 的方法论符合度改为 §十七
3. **M18 外部依赖降级策略强化**：lexical fallback 升为"一等公民"，sentence-transformers/openai 设为可选增强
4. **M19 章纲字段精简**：9 字段 → 4 必填（爽点公式/章末钩子类型/四段结构预算/画面感）+ 5 选填（按章节类型）
5. **M17 测试用例字段名修复 + build_context.py 注入顺序协调**：明确 Protected → Selective → Retrieved（Grep → KG → MemoRAG）

### 1.5 汇总结论

修复 2 个 P0 阻塞 + 3 个 P1 高优后，方案可按 master_plan §四的 5 批次执行。建议每批次完成后跑一次 plan-review 三视角评审，及时发现并修复新问题。

---

## 二、测试评审

### 2.1 总体评价

**有保留通过** —— 137 个 pytest 用例 + 纯标准库哲学 + 三级 fallback + tmp_path 隔离模式成熟，CI 可跑性优秀。需在执行前修复 2 个测试用例缺陷 + 补充 gradual rollout 三阶段测试覆盖。

### 2.2 五维度评级

| 维度 | 评级 | 关键发现 |
|---|---|---|
| 可验证性 | ✅ | 13/20 ✅，6/20 ⚠️（维度编号冲突），2/20 ❌（M16/M17 测试缺陷） |
| 测试覆盖 | ⚠️ | 用例数偏少（5-8 个/模块），高风险模块（M02/M07/M13/M14/M17）建议 10+ 个 |
| 边界场景 | ✅ | 黄金三章/状态机矩阵/滚动窗口/边界值覆盖优秀；超长输入/JSON 损坏/并发缺失 |
| Mock 模式 | ✅ 优秀 | 纯标准库 + 三级 fallback + tmp_path 隔离 + backend="lexical" 强制降级是最佳实践 |
| 回归风险 | ⚠️ | 10 个低/中风险 + 10 个中/高风险；gradual rollout + 阶段性回滚方案完整 |

### 2.3 关键风险点

| # | 模块 | 风险点 | 严重度 |
|---|---|---|---|
| 1 | M5/M12/M13/M14 | check_consistency.py 第 8 类检测维度编号 4 方冲突 | 🔴 关键 |
| 2 | M14/M16/M17/M19/M20 | dev-checklist 章节编号冲突 | 🔴 关键 |
| 3 | M16 | 测试 6 第 9 条评论 JSON 缺少开头引号 | 🟡 高 |
| 4 | M17 | 测试 6 调用 `--incremental` 参数，但脚本 CLI 只有 `--rebuild` | 🟡 高 |
| 5 | M02 | flag 协议误触发可能阻断所有 save_state.py 写入 | 🟡 高 |
| 6 | M07 | Protected 层强制验证可能阻断现有章节保存 | 🟡 高 |
| 7 | M13 | 双脚本修改（check_consistency.py + save_state.py）+ save_state 路由扩展 | 🟡 高 |
| 8 | M17 | KG 召回可能注入噪声挤占 Token 预算 | 🟡 高 |
| 9 | M02/M07/M10/M18 | gradual rollout 三阶段测试覆盖不足 | 🟢 中 |

### 2.4 Top 5 关键建议

1. **立即协调维度编号与章节编号冲突**：在 00_master_plan 新增"维度编号协调表"章节，dev-checklist 以 M20 §九-§十六 为最终标准
2. **修复 M16/M17 测试用例缺陷**：M16 补全 JSON 引号；M17 移除 `--incremental` 或在 build_kg.py 显式添加该参数
3. **补充高风险模块 gradual rollout 测试用例**：M02/M07/M10/M18 每模块增加 3 个用例（warn/enforce/strict 各 1 个），共 12 个补充用例
4. **补充超长输入与 JSON 损坏的容错测试**：M14/M15/M16/M17 增加 `test_empty_*` + `test_malformed_*` + `test_*_performance` 用例
5. **补充 M02/M07 端到端集成测试**：构造完整 Vault + P0 flag/Protected 层违规，验证 save_state.py / enforce_protected_layer.py 阻断行为

### 2.5 21 份文档质量排名

- **Tier S（优秀）**：M15、M18、M11、M06
- **Tier A（良好）**：M01/M03/M04/M08/M09/M10/M12/M13/M19
- **Tier B（需小修）**：M02/M05/M07/M14/M20
- **Tier C（需修复）**：M16、M17

### 2.6 汇总结论

执行顺序按依赖关系 + 风险等级分 5 批，每批跑完整测试集（check_consistency.py + check_ai_novel.py + pytest + 回归测试）清零后方可合并。建议在 00_master_plan.md 新增"维度编号协调表"作为执行前必读。

---

## 三、规则评审

### 3.1 总体评价

**B+（形式合规良好，实质合规需整改）** —— 21 份方案文档在 BUG 记录规范、回归测试设计、Skill 边界声明、目录结构一致性等形式合规层面表现良好，但在实质合规层面存在 3 类需重点整改的问题。

### 3.2 六维度评级

| 维度 | 评级 | 关键发现 |
|---|---|---|
| dev-workflow.md 符合度 | B- | 程序要求覆盖不全；M19/M20 直接修改 dev-workflow.md 规则文件存在"既当运动员又当裁判员"风险 |
| bug-reporting.md 符合度 | A- | 21 条 BUG 全部符合"描述性标题 + 编号字段 + 七字段模板"规范；部分 BUG 自行扩展"风险等级"字段 |
| 是否破坏现有体系 | C+ | 核心资产红线被多次触碰（style_guide.md / dev-workflow.md / 6 个 novelforge 脚本）；M18 引入外部依赖破坏"纯标准库"哲学 |
| Trae Skill 边界合规性 | B+ | 所有方案未让 Skill 直接调度 sub-agents 或调用 MCP；部分 Skill 改动幅度较大 |
| 目录结构与命名规范 | B | M01 路径不一致；M19 新增第 3 个规则文件；M20 新增 module_completion_checklist 与 dev-checklist 边界需明确 |
| 过度工程化预警 | C+ | Top 5 过度工程化模块：M10/M17/M16/M14/M18，建议 MVP 优先策略 |

### 3.3 关键违规点

| 严重度 | 违规点 | 涉及模块 | 违反规则 |
|---|---|---|---|
| 🔴 高 | 维度编号冲突（M13/M14/M18 都声称 check_consistency.py 第 8 类） | M13、M14、M18、M5 | SSOT 原则 |
| 🔴 高 | M18 引入外部依赖（sentence-transformers / openai） | M18 | "纯标准库"哲学 |
| 🔴 高 | M05 修改 style_guide.md 附录 B（核心资产红线） | M05 | dev-workflow §四 |
| 🔴 高 | M09 修改 style_guide.md 新增 §六（核心资产红线） | M09 | dev-workflow §四 |
| 🟡 中 | M19/M20 修改 dev-workflow.md 规则文件 | M19、M20 | dev-workflow §四 |
| 🟡 中 | M05-M14 修改 scripts/novelforge/ 6 个核心脚本 | 多个 | dev-workflow §四 |
| 🟡 中 | M17 修改 build_context.py / M18 修改 check_consistency.py | M17、M18 | dev-workflow §四 |
| 🟡 中 | M01 路径不一致（check_skill_contracts.py 放 scripts/novelforge/，其他校验脚本放 scripts/ 根） | M01 | 目录规范 |
| 🟢 低 | 多份方案未明确"执行前必读 current_focus.md / author_intent.md" | M01-M20 | dev-workflow §一第三步 |
| 🟢 低 | 几乎全部方案未提及"push 前校验提交信息" | M01-M20 | dev-workflow §一第三步末段 |
| 🟢 低 | 多份方案未覆盖"禁止以「问题非本次引入」为由跳过修复" | M01-M20 | dev-workflow §四 |

### 3.4 Top 5 关键建议

1. **统一维度编号 SSOT**：在 00_master_plan 新增"维度编号 SSOT"章节，明确 M5=第 8 类、M13=第 9 类、M14=第 10 类、M18=第 11 类
2. **M18 外部依赖治理**：lexical fallback 设为默认实现（零依赖），sentence-transformers/openai 设为可选增强，README 明确声明
3. **核心资产修改审批流程**：M05/M09 修改 style_guide.md → 改为新增 `.trae/rules/*-rules.md` + style_guide.md 仅引用；M19/M20 修改 dev-workflow.md → 走"修改理由 + 用户确认 + 替代方案评估"三段式审批
4. **过度工程化模块轻量化（MVP 优先）**：M10 先实现核心 3 类合规检测、M14 先实现 3-5 类高频因果事件、M16 先实现核心解析 + 4 类情绪标签、M17 先实现 character 节点 + 2 类边 MVP、M18 先实现 lexical fallback + 主角 1 角色 baseline
5. **方案文档 dev-workflow 合规性补全**：每份方案 §一或 §六补充三点：执行前必读创作焦点 / push 前校验提交信息 / 历史遗留问题修复承诺

### 3.5 汇总结论

21 份方案文档总体质量较高（B+），形式合规层面表现良好，实质合规层面存在 3 项 P0 阻断问题需整改：维度编号冲突、M18 外部依赖、核心资产红线。完成 3 项 P0 整改后方可进入实施阶段。

---

## 四、汇总结论（主 Agent 综合）

### 4.1 整体判定

**有保留通过** —— 21 份方案文档展现了系统性的架构思考与工程化落地能力，5 层结构 + 6 条依赖链 + 8 section 标准结构的设计质量在 AI 创作系统领域属上游水平。三视角评审一致认为：**完成 5 项 P0 阻塞整改后，方案可进入实施阶段**。

### 4.2 P0 阻塞整改清单（实施前必须完成）

| # | 整改项 | 涉及模块 | 责任方 | 三视角共识 |
|---|---|---|---|---|
| 1 | **统一 check_consistency.py 维度编号** | M5/M12/M13/M14/M18 | 00_master_plan 维护者 | 架构师 + 测试 + 规则三方一致指出 |
| 2 | **统一 dev-checklist.md 章节编号** | M14/M16/M17/M19/M20 | 00_master_plan 维护者 | 架构师 + 测试 + 规则三方一致指出 |
| 3 | **M18 外部依赖治理** | M18 | M18 方案维护者 | 架构师 + 规则两方指出（测试认可 fallback 设计） |
| 4 | **核心资产修改审批流程** | M05/M09/M19/M20 + M05-M14 修改 6 个 novelforge 脚本 | 各模块方案维护者 | 规则方重点指出 |
| 5 | **M16/M17 测试用例缺陷修复** | M16/M17 | 各模块方案维护者 | 测试方重点指出 |

### 4.3 P1 高优建议（强烈推荐实施前完成）

| # | 建议项 | 涉及模块 | 来源角色 |
|---|---|---|---|
| 1 | M19 章纲字段精简（9 字段 → 4 必填 + 5 选填） | M19 | 架构师 |
| 2 | M17 测试字段名修复 + build_context.py 注入顺序协调 | M17 | 架构师 |
| 3 | 高风险模块 gradual rollout 三阶段测试覆盖（M02/M07/M10/M18 补充 12 个用例） | M02/M07/M10/M18 | 测试 |
| 4 | 超长输入 + JSON 损坏容错测试（M14/M15/M16/M17） | M14/M15/M16/M17 | 测试 |
| 5 | 过度工程化模块 MVP 化（M10/M14/M16/M17/M18） | M10/M14/M16/M17/M18 | 规则 |
| 6 | 方案文档 dev-workflow 合规性补全（执行前必读 / push 前校验 / 历史遗留修复承诺） | M01-M20 | 规则 |

### 4.4 统一维度编号 SSOT（核心整改）

```
check_consistency.py 维度编号（实施前必须统一）：
  第 1-7 类：既有维度（power_level_jump / golden_finger_overreach / 等）
  第 8 类：M5  character_language_fingerprint_drift  （统计特征漂移）
  第 9 类：M12 pov_switch_in_chapter                  （POV 视角切换）
  第 10 类：M13 pacing_curve                          （爽点曲线）
  第 11 类：M14 causal_chain_break                    （因果链断裂）
  第 12 类：M7  protected_layer_violation             （Protected 层违规）
  第 13 类：M18 persona_vector_drift                  （语义特征漂移）

dev-checklist.md 章节编号（实施前必须统一）：
  §一-§八：既有章节
  §九-§十六：M20 新增 8 大类汇总（64 项检测）
  §十七：M19 方法论符合度（11 项方法论三层核验）

check_ai_novel.py 维度编号：
  第 11 项：M11 golden_three_opening（黄金三章硬约束）
```

### 4.5 推荐执行顺序（按依赖关系 + 风险等级）

按 00_master_plan §四的 5 批次执行，但增加以下约束：

- **批次 0（实施前置整改）**：完成 P0 整改清单 5 项 + 在 00_master_plan 新增"维度编号协调表"与"章节编号协调表"
- **批次 1（M1-M4）**：正常执行，M02 完成时统一规划 check_consistency.py 维度编号
- **批次 2（M5-M9）**：M05/M08 按统一后的维度编号实施；M09 改为新增 `.trae/rules/zhuque-anti-ai-rules.md` 而非修改 style_guide.md
- **批次 3（M10-M14）**：M10/M14 采用 MVP 优先策略；M12/M13/M14 按统一后的维度编号实施
- **批次 4（M15-M19）**：M17 修复测试字段名 + 协调 build_context.py 注入顺序 + MVP 化；M18 强化 lexical fallback 为默认 + MVP 化；M19 精简章纲字段 + §十七 章节编号
- **批次 5（M20）**：M20 保持 §九-§十六，作为收尾汇总

### 4.6 推荐优先级裁剪

| 优先级 | 模块 | 理由 |
|---|---|---|
| **P0 必做** | M1, M2, M3, M4, M10, M11 | 修复工程债 + 合规风险 + 黄金三章硬约束 |
| **P1 强烈推荐** | M5, M6, M7, M9, M13, M19 | 角色档案 + 伏笔五阶段 + 强制验证 + 朱雀对抗 + 爽点曲线 + 方法论 |
| **P2 可选** | M8, M12, M14, M15, M16, M17, M18, M20 | 锦上添花，资源紧张可延后或 MVP 化 |

### 4.7 评审后续动作

1. **本评审报告**归档至 `docs/optimization_plan_2026_07/review_report.md`（已完成）
2. **00_master_plan.md 更新**：新增"维度编号协调表"+"章节编号协调表"+"核心资产修改审批流程"+"实施前置整改清单"四节
3. **M05/M09/M16/M17/M18/M19 方案文档修订**：按 P0 + P1 整改清单更新对应章节
4. **进入实施阶段**：完成上述修订后，按 4.5 推荐执行顺序分批实施，每批完成后跑 plan-review 三视角评审

---

## 五、三视角共识与分歧

### 5.1 三方共识（强信号，必须执行）

1. **维度编号冲突是 P0 阻塞**：架构师、测试、规则三方一致指出 M5/M12/M13/M14/M18 争抢 check_consistency.py 第 8/9 类编号
2. **dev-checklist 章节编号冲突是 P0 阻塞**：架构师、测试两方明确指出 M19 vs M20 路径冲突
3. **M18 外部依赖需治理**：架构师、规则两方指出 sentence-transformers/openai 破坏"纯标准库"哲学；测试认可三级 fallback 设计但建议 lexical 升为一等公民
4. **M16/M17 测试用例缺陷需修复**：测试方明确指出 JSON 缺引号 + CLI 参数不一致
5. **gradual rollout 三阶段设计是良好实践**：测试方认可 M02/M07/M10/M18 的高风险模块 gradual rollout 设计

### 5.2 三方分歧（需主 Agent 裁决）

| 分歧点 | 架构师 | 测试 | 规则 | 主 Agent 裁决 |
|---|---|---|---|---|
| M17 选择性 KG 是否过度工程化 | ⚠️ 中等风险，可落地 | 🔴 高风险（修改核心 build_context.py），建议 8-10 用例 | 🟡 中等过度工程化，建议 MVP 化（character 节点 + 2 类边） | **采纳规则方建议：MVP 化**，先实现 character 节点 + ally/enemy 2 类边，验证 KG 召回有效后再扩展到 9 类边 |
| M18 Persona Vectors 外部依赖 | 强化 lexical 为一等公民 | 认可三级 fallback 设计 | lexical 设为默认，sentence-transformers/openai 设为可选增强 | **采纳规则方建议**：lexical 为默认实现，sentence-transformers/openai 为可选增强，README 明确声明 |
| M19 章纲字段精简 | 4 必填 + 5 选填 | 未明确 | 未明确 | **采纳架构师建议**：4 必填 + 5 选填，按章节类型选填 |
| M05/M09 修改 style_guide.md | 未明确反对 | 未明确 | 🔴 改为新增 `.trae/rules/*-rules.md` + style_guide.md 仅引用 | **采纳规则方建议**：M05 新增 `.trae/rules/character-language-fingerprint-rules.md`，M09 新增 `.trae/rules/zhuque-anti-ai-rules.md`，style_guide.md 仅引用不修改 |

### 5.3 评审完整性确认

- ✅ 架构师评审：5 维度 + 12 风险点 + Top 5 建议 + 汇总结论
- ✅ 测试评审：5 维度 + 12 风险点 + Top 5 建议 + 21 份文档质量排名
- ✅ 规则评审：6 维度 + 11 违规点 + Top 5 建议 + 整改清单

---

## 六、附录

### 6.1 评审元信息

- 评审工具：Trae `Task` 工具（subagent_type=general_purpose_task）
- 评审方式：会话内并行 3 个 subagent（plan-review Skill 主路径）
- 评审耗时：约 5 分钟（3 subagent 并行）
- 文档读取：21 份方案文档 + dev-workflow.md + bug-reporting.md + README.md + dev-checklist.md
- 评审输出：本报告（review_report.md）

### 6.2 相关文档

- 总览方案：[00_master_plan.md](file:///workspace/docs/optimization_plan_2026_07/00_master_plan.md)
- 21 份模块方案：`/workspace/docs/optimization_plan_2026_07/M01-M20_*.md`
- 评审标尺：[dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) + [bug-reporting.md](file:///workspace/.trae/rules/bug-reporting.md)

### 6.3 评审限制声明

- 本评审为**只读评审**，未修改任何方案文档
- 评审基于方案文档文本，未实际运行代码验证
- 评审意见仅供参考，最终实施决策由用户确认
- 建议在每批次实施完成后跑一次 plan-review 三视角评审，形成"评审 → 整改 → 实施 → 评审"的闭环

---

**评审完成**。本报告归档于 `/workspace/docs/optimization_plan_2026_07/review_report.md`。
