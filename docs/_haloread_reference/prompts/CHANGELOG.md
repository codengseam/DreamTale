# Prompts 变更日志

记录 prompts/ 下三桶（narrative/modern/knowledge）提示词的版本变更。

## 规范

- 每次修改 prompts/ 下文件必须在此追加一条记录
- 格式：`### YYYY-MM-DD｜<桶>/<文件>` 主题
- AB 对照实验需附结果（胜出方、维度差异）

---

## 2026-06-27｜反馈循环第二档：提示词版本化起步

- **变更**：新增本 CHANGELOG，建立版本化机制
- **原因**：design.md §2.1 指出 prompts/ 全目录零 version/changelog，历史只在 git commit
- **影响范围**：仅新增本文件，不改任何 prompt 内容

## 2026-06-27｜archetype 阶段4：modern/knowledge 桶 prompt 迁移完成

- **变更**：modern/、knowledge/ 子目录下 8 个 prompt 文件落地（biographer/chief_editor/context_analyst/critic/editor/historian/philosopher/tone_setter）
- **原因**：archetype-design/design.md §10 阶段4 内容工作——specialist 按桶分桶，解除回落到 narrative 的依赖
- **影响范围**：modern/ + knowledge/ 子目录全部新建
- **对应 commit**：a11b58c feat(archetype): 阶段4 内容工作 modern/knowledge 桶 prompt 迁移 + specialist 接入 + 解除回落

## 2026-06-26｜讲书规则迁移到 deep-reading skill

- **变更**：讲书规则从 prompts/ 内联迁移到 .trae/skills/deep-reading/rules.md（按需加载）
- **原因**：规则膨胀导致 prompt 文件过长，skill 化后按需加载减少 token
- **影响范围**：根目录 prompt 文件瘦身，rules.md 成为规则单一来源
- **对应 commit**：703ebea refactor(rules): 讲书规则迁移到 deep-reading skill 按需加载

## 2026-06-24｜内容质检 Agent 设计与实现

- **变更**：新增 content_reviewer.md、content_reviewer_sub.md（内容质检三视角提示词）
- **原因**：补齐生成后质检环节，三视角并行评审
- **影响范围**：新增 2 个 prompt 文件
- **对应 commit**：0c39207 feat: 内容优化 Agent 设计与实现

## 历史：v1.1 灵魂维度引入

- **变更**：根目录 prompt 文件内联注释 "v1.1 新增灵魂维度"
- **原因**：AB 盲测（明纪·海瑞上疏）验证灵魂维度价值
- **状态**：v1.1 注释散见各文件，无集中 changelog，本次建立后回溯记录
