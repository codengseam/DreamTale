# NovelForge 创作自检 Checklist

本 checklist 用于 NovelForge 创作完成后的自检。配合 `.trae/rules/dev-workflow.md` 第四步使用，也可由 `.trae/skills/dev-selfcheck/SKILL.md` 触发。

**使用方式**：逐项检查，标注 ✅ 通过 / ❌ 未通过 / ➖ 不适用。未通过项必须修复或说明原因。

---

## 一、创作质量

- [ ] 章纲对齐度：正文实际走向与章纲预设一致，无偏离/跑题
- [ ] 字数控制：novel 模式单章 2000-3000 字（±20%），shortform 模式 3-6k 字，未严重超标或不足
- [ ] 章末钩子完整性：每章结尾有明确的悬念/反转/情绪钩子，不平淡收束
- [ ] 场景描写到位：关键场景有视听嗅触多感官细节，非纯对话推进
- [ ] 对话推动剧情：无废话对话，每段对话承载信息增量或性格刻画
- [ ] 视角一致：未在单章内无故切换 POV（除非章纲明确要求）
- [ ] 节奏得当：action 章节有张力，breath 章节有情绪沉淀，不拖沓不跳跃

## 二、Vault 规范

- [ ] 文件路径遵循三级结构：`NovelForge_Vault/卷名/vol_NN/ch_NNN.md`（novel 模式）；shortform 模式为 `NovelForge_Vault/shortform/YYYY-MM-DD-slug.md`
- [ ] 章节文件命名用 `ch_NNN.md`（三位数字补零），卷目录用 `vol_NN/`（两位数字补零），未出现中文/空格/特殊字符
- [ ] `.state/` 目录禁止手动编辑：状态机文件（characters/、worldbuilding/、timeline/ 等）只能由 Skill/脚本读写
- [ ] `NovelForge_Vault/00_控制面/master_index.md` 索引已同步：新增/重命名章节后索引已更新
- [ ] 章节 frontmatter 字段完整（chapter、title、volume、word_count、status 等），无缺失
- [ ] 未破坏 `.trae/skills/novelforge/` 下 5 核心 + 4 守护 + 主入口 Skill 的行为
- [ ] 未破坏 `NovelForge_Vault/00_控制面/style_guide.md` 的风格基线（人称、时态、文风、禁用词）
- [ ] 未破坏 `scripts/novelforge/check_consistency.py` / `check_ai_novel.py` 的检测逻辑

## 三、一致性

- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 全部通过（合并前必须完成）
- [ ] 伏笔回收率达标：已铺设伏笔在合理章节跨度内得到回收，无遗漏/无超期悬挂
- [ ] 角色状态一致：人物境界/能力/位置/关系与 `.state/characters/*.json` 状态机一致，无突变
- [ ] 时间线无倒置：事件发生顺序与 `.state/timeline/` 记录一致，无穿越/回溯矛盾
- [ ] 金手指强度曲线无越界：主角能力提升有铺垫，未出现无理由跳级
- [ ] 节奏曲线无连续低谷：连续多章无爽点/无推进时已被识别并标注
- [ ] 世界观设定一致：地理/势力/规则与 `.state/worldbuilding/` 一致，无自相矛盾
- [ ] 修复了会复发的状态漂移/一致性 bug 时，已补充回归测试并按 `.trae/rules/bug-reporting.md` 更新 `tests/bug_regression_list.md`
- [ ] push 前已运行 `python scripts/validate_commit_messages.py origin/master..HEAD`，提交标题与正文均为中文且准确概括当前修改

## 四、上下文预算

- [ ] L0 摘要注入完整：`author_intent.md` L0 版（世界观核心、主角弧光、爽点曲线、风格基调）已作为全局锚点注入
- [ ] L1 关键场景按需召回：本卷/近期章节的关键场景已按需召回，未漏召也未冗余召回
- [ ] Token 预算不超限：本次生成注入的上下文总量在预算上限内（L0 固定 + L1 召回 + 当前章纲）
- [ ] 状态机字段已注入：涉及的角色/世界观点位已从 `.state/` 读入上下文，未依赖 LLM 记忆
- [ ] 前情提要已对齐：若距上次前情提要超过 10 章，已重新生成前情提要并注入

## 五、创作文档

- [ ] `NovelForge_Vault/00_控制面/current_focus.md` 已更新：当前卷/章进度、待处理伏笔、本轮创作焦点已同步
- [ ] `author_intent.md` L0 摘要未漂移：作者意图全局锚点未因单章生成而偏移
- [ ] 前情提要已生成：每 10 章已生成一次前情提要，供后续章节上下文召回使用
- [ ] 章节 frontmatter 已更新：word_count、status、continuity_refs（本章引用的伏笔/角色/设定）已填写
- [ ] master_index.md 索引已同步：新章节已在索引登记
- [ ] 若新增/修改了 Skill / 规则 / 脚本，已在 README 中登记

## 六、Trae Skill 边界（新增/修改 Skill 时检查）

- [ ] Skill 文件未声称能"调度 sub-agents"或"直接调用 MCP tools"（Skill 文件本身做不到）
- [ ] Skill 需要真并行时，优先引导主 Agent 用 `Task` 工具启动 subagent（路径 C，主路径）；或触发 Python 脚本（路径 B，可选增强）。详见 `.trae/rules/dev-workflow.md §零`
- [ ] Skill 的触发条件清晰、不与 `.trae/skills/novelforge/` 下现有 Skill（5 核心 + 4 守护 + 主入口）重叠
- [ ] Skill 与 `.trae/rules/dev-workflow.md` 声明的边界一致

## 七、LoopAgent 沉淀（每次创作/开发完成后必做）

- [ ] 本次改动是否暴露了创作流程的新共性问题（状态漂移/伏笔遗漏/上下文超限等）？
- [ ] 是否需要更新 `.trae/rules/` 下的规则文件？
- [ ] 是否需要更新 `scripts/novelforge/check_consistency.py` / `check_ai_novel.py` 的检测项？
- [ ] 是否需要更新本 checklist（`dev-checklist.md`）？
- [ ] 是否需要在 `docs/loop_log/YYYY-MM.md` 当月分片追加一条开发沉淀记录？
- [ ] 若修复了历史遗留 bug，是否已记录到 `tests/bug_regression_list.md` 并更新频次？
- [ ] 本次无新沉淀时，明确说明"本次无新沉淀"

## 八、去 AI 味

- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 全部通过（合并前必须完成）
- [ ] 无信息倾倒：未出现大段设定/背景一次性堆砌，设定通过剧情自然释放
- [ ] 无金手指滥用：主角能力提升有代价/铺垫，未出现无理由的"天降神助"
- [ ] 无爽点套路化：爽点节奏有变化，未陷入"打脸-装逼-再打脸"机械循环
- [ ] 角色语言指纹一致：每个角色有独特的语言习惯/口头禅/语气，未出现角色混声
- [ ] 心理-生理映射完整：情绪有对应的生理反应描写（心跳/呼吸/肌肉等），非纯概念化情绪陈述
- [ ] 无 AI 感词：未出现"值得注意的是""总而言之""不仅...而且"等典型 AI 套话
- [ ] 比喻/描写有新意：未大量复用常见比喻套路，意象贴近世界观

---

## 自检报告模板

```
## 自检报告

### 一、创作质量
- ✅/❌ 章纲对齐度：____
- ✅/❌ 字数控制：____
- ✅/❌ 章末钩子：____
- ...

### 二、Vault 规范
- ✅/❌ 文件路径三级结构：____
- ✅/❌ .state/ 未手动编辑：____
- ✅/❌ master_index 同步：____
- ...

### 三、一致性
- check_consistency.py 结果：____
- ✅/❌ 伏笔回收率：____
- ✅/❌ 角色状态一致：____
- ✅/❌ 时间线无倒置：____
- ...

### 四、上下文预算
- ✅/❌ L0 注入完整：____
- ✅/❌ L1 按需召回：____
- ✅/❌ Token 预算：____
- ...

### 五、创作文档
- ✅/❌ current_focus.md 已更新：____
- ✅/❌ author_intent.md L0 未漂移：____
- ✅/❌ 前情提要已生成：____
- ...

### 六、Trae Skill 边界
- ...

### 七、LoopAgent 沉淀
- 新共性问题：____
- 规则更新：____
- checklist 更新：____
- loop_log 追加：____

### 八、去 AI 味
- check_ai_novel.py 结果：____
- ✅/❌ 无信息倾倒：____
- ✅/❌ 无金手指滥用：____
- ✅/❌ 角色语言指纹：____
- ...

### 总结
- 通过项：__ / 总项数 __
- 未通过项及处理：____
```
