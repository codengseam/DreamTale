# M10 · 合规风险检测系统

> **层级**：L3 · 补齐盲区能力
> **依赖**：无（独立模块，可与 L3 其他模块并行）
> **下游**：M20（开发自检清单升级，汇总本模块的合规检测项）

---

## 一、模块目标

- **一句话目标**：新增 [`check_compliance.py`](file:///workspace/scripts/novelforge/check_compliance.py)（政治 / 色情 / 暴力 / 敏感词 / 版权 5 维度检测）+ [`platform_compliance.md`](file:///workspace/NovelForge_Vault/00_控制面/platform_compliance.md)（起点 / 番茄 / 晋江 / 阅文系规则感知配置），区分 novel / shortform 双模式（公众号合规更严）。
- **对应的痛点**：NovelForge 当前完全未覆盖合规风险检测——无敏感词库、无政治红线检测、无版权风险检测。番茄 2026 年 5 月单月拒签 11.27 万本 AI 网文、下架 4 万本、处置 855 个 AI 账号；起点只要正文出现 AI 生成内容即永久无缘三江推荐等重磅推荐位；晋江 2025 年 2 月公告分六级，仅开放三种最低程度辅助；中国作家网 2026 年 2 月新规严禁将 AI 生成或辅助创作内容作为原创作品投稿。**NovelForge 当前产出的章节可能在投稿阶段即被拒签、上线后被下架、严重时账号被封**。
- **完成后达成的能力**：
  1. **5 维度合规检测**：政治敏感词（P0 阻断）+ 色情描写分级（P0/P1）+ 暴力分级（P1/P2）+ 其他敏感词（P2）+ 版权风险（P1）。
  2. **4 平台规则感知**：起点 / 番茄 / 晋江 / 阅文系规则表，按 `--platform` 参数注入对应平台约束。
  3. **双模式分级**：novel 模式按网文平台规则（番茄 ≥30% 人工修改、起点核心剧情人工 >50%）；shortform 模式（公众号）按互联网信息服务管理办法与微信内容规范，更严格——政治敏感词零容忍、色情描写直接 P0。
  4. **P0 阻断保存**：通过 M2 的 flag 协议接入 `save_state.py`，合规 P0 问题阻断 published 落盘，避免违规内容进入 Vault。

---

## 二、痛点对应

### 2.1 痛点表现：4 平台规则对比表 + 关键事件

| 平台 | AI 辅助规则 | 关键事件 | 核心约束 |
|---|---|---|---|
| **番茄** | 2026 年 5 月单月拒签 11.27 万本 AI 网文、下架 4 万本、处置 855 个 AI 账号 | AI 内容必须 ≥30% 人工修改；标记 AI 辅助；拒签后申诉周期 ≥30 天 | 政治红线零容忍；色情直接封号；连续 3 章被识别为纯 AI 即下架 |
| **起点（阅文系主站）** | 2025 年起只要正文出现 AI 生成内容即永久无缘三江推荐 / 强推 / 限免等重磅推荐位 | 三江推荐月度评审增加 AI 检测环节；强推位前置审稿 | 核心剧情（爽点 / 反转 / 主线推进）人工撰写占比 >50%；金手指设定 / 主角弧光必须人工原创 |
| **晋江** | 2025 年 2 月公告分六级（L0 全人工 → L5 全 AI），仅开放 L1 / L2 / L3 三种最低程度辅助 | 公告后大量作品被读者举报 AI 辅助超界，晋江单月下架 200+ 作品 | 仅允许：① 大纲辅助 ② 资料检索 ③ 错别字校对；正文生成 / 文风模仿 / 章节扩写均禁 |
| **阅文系（QQ 阅读 / 红袖 / 潇湘）** | 分级管理：白名单（人工原创）/ 灰名单（AI 辅助标记）/ 黑名单（AI 主导） | 2026 年 Q1 起对灰名单作品限流 30%，黑名单直接下架 | 灰名单必须每章在 frontmatter 标注 `ai_assisted: true` + 修改比例；黑名单无修改比例即下架 |

**中国作家网 2026 年 2 月新规**：严禁将 AI 生成或辅助创作内容作为原创作品投稿；违规者 3 年内不得参与作协任何评奖 / 培训 / 推介。

**关键事件链**（2025-02 至 2026-07）：
- 2025-02 晋江公告六级分级
- 2025-05 朱雀七维度算法升级（M9 已覆盖）
- 2025-Q4 起点三江推荐引入 AI 检测
- 2026-02 中国作家网新规
- 2026-05 番茄单月拒签 11.27 万本 AI 网文
- 2026-Q2 阅文系分级管理上线

### 2.2 行业方案

- **朱雀检测（腾讯混元安全）**：朱雀主检测能力是「识别内容是否由 AI 生成」（M9 已覆盖），**不提供合规风险检测 API**——朱雀官方明确不开放政治 / 色情 / 暴力 / 敏感词检测接口给第三方。NovelForge 需自建敏感词库 + 分级检测逻辑。
- **百度文本审核 API**：商业服务，按调用计费，覆盖政治 / 暴恐 / 涉黄 / 违禁 / 价值观 5 类；但需联网调用、数据出境合规风险、不适合 NovelForge 本地优先架构。
- **阿里云内容安全**：同百度，商业 API，本地优先架构不适用。
- **Mint Filter / sensitive-word-go**：开源敏感词过滤库（Go 实现），词库需自备；Java 生态有 `sensitive-word`（houbao 实现），覆盖 2 万+ 词条，可作为词库来源参考。
- **网文平台官方指南**：番茄 / 起点 / 晋江 / 阅文系各自发布「内容合规指南」，但仅给红线描述（如「不得涉及国家领导人」「不得描写未成年人色情」），未提供具体词表。
- **微信公众号内容规范**：禁止 9 类内容（政治谣言 / 暴力恐怖 / 色情低俗 / 封建迷信 / 虚假广告 / 诱导分享 / 抄袭 / 侵权 / 违法犯罪），shortform 模式必须遵循。

### 2.3 本模块的差异化设计

NovelForge 的差异化在于：**自建分级敏感词库 + 平台规则感知注入**，纯标准库 Python 执行，无外部 API 依赖，本地优先。

| 维度 | 商业 API（百度 / 阿里） | 开源词库（houbao 等） | NovelForge M10 |
|---|---|---|---|
| 词库 | 平台托管不可控 | 词库扁平、无分级 | **5 类分级**（政治 P0 / 色情 P0-P1 / 暴力 P1-P2 / 敏感 P2 / 版权 P1） |
| 平台感知 | 无 | 无 | **4 平台规则表**（起点 / 番茄 / 晋江 / 阅文系），按 `--platform` 注入 |
| 模式区分 | 无 | 无 | **novel / shortform 双模式**，shortform 公众号合规更严 |
| 阻断机制 | 平台 API 错误码 | 无 | **接入 M2 flag 协议**，P0 阻断 `save_state.py` 落盘 |
| 词库维护 | 平台自动更新 | 手动同步 | **JSON SSOT**，作者 / 编辑可独立更新词库，无需改代码 |
| 隐私 | 数据出境 | 本地 | **本地优先**，全文不离开 Vault |

**核心约束**：
- 5 类敏感词库分类存放，每类一个 JSON 文件，**互不混用**（政治词不允许被色情检测误命中）。
- 平台规则表独立为 `platform_compliance.md`，作者按目标投稿平台选择 `--platform` 参数。
- novel / shortform 双模式分级：novel 模式色情 P0/P1 分级（露骨 P0 / 暗示 P1），shortform 模式色情直接 P0（公众号零容忍）。
- P0 阻断保存：复用 M2 的 flag 协议，`check_compliance.py` 检出 P0 时设置 `compliance_blocked: true` flag，`save_state.py` 拒绝写入 published。

---

## 三、涉及现有文件

### 3.1 必读文件清单

| 路径 | 用途 | 关注点 |
|---|---|---|
| [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) | 去 AI 味 10 维检测 | 检测风格参考：`Issue` dataclass / `Report` / P0/P1/P2 分级 / `DIMENSIONS` 注册表 / `_load_*_json` SSOT 加载模式 / CLI 设计（`--chapter` / `--file` / `--json` / `--strict`） |
| [file:///workspace/scripts/novelforge/check_consistency.py](file:///workspace/scripts/novelforge/check_consistency.py) | 跨章一致性 7 维检测 | P0 阻断模式参考：`--strict` 退出码 1 / `Issue` 结构 / 维度注册表 / `check_all` 编排 / `format_report` 人类可读输出 |
| [file:///workspace/NovelForge_Vault/00_控制面/style_guide.md](file:///workspace/NovelForge_Vault/00_控制面/style_guide.md) | 文风指南（语言宪法） | §1.1 禁用词表（M3 后引用 `ai_words.json`）；§1.2 禁用句式；P0/P1 绝对禁用项（现代网络用语混入古风、AI 翻译腔、视角混乱）——合规检测复用「绝对禁用」分级思路 |
| [file:///workspace/NovelForge_Vault/00_控制面/USAGE.md](file:///workspace/NovelForge_Vault/00_控制面/USAGE.md) | 作者使用手册 | §五 防漂移三铁律 / §六 去 AI 味机制 / §八 产物路径速查表（novel `05_正文/` vs shortform `06_短文/`）——合规检测需双模式路径区分 |
| [file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) | 执笔与精修 Skill | §去 AI 味铁律 1-6；§阶段二审计（check_consistency + check_ai_novel）；§阶段三精修（P0 必须修复）；shortform 模式差异（重情绪密度轻长线伏笔）——M10 在审计阶段注入 `check_compliance.py` |
| [file:///workspace/.trae/skills/virality-auditor/SKILL.md](file:///workspace/.trae/skills/virality-auditor/SKILL.md) | shortform 传播性审计 Skill | shortform 模式参考：触发条件 / 工作流 / 与 writer-polisher 的边界（writer-polisher 管"写得对不对"，virality-auditor 管"能不能传播"）——M10 与之并列，管"合不合规" |
| [file:///workspace/.trae/skills/brand-voice-guardian/SKILL.md](file:///workspace/.trae/skills/brand-voice-guardian/SKILL.md) | 品牌调性守护 Skill | shortform 模式作者声音档案；§三 观点立场（核心价值观 / 禁区话题 / 倾向性）——M10 的政治检测与 brand-voice 的禁区话题互补，前者是平台合规，后者是品牌自律 |
| [file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md) | 创作自检清单 | §三 一致性（check_consistency）/ §八 去 AI 味（check_ai_novel）——M10 新增 §九 合规检测项 |
| [file:///workspace/.trae/rules/dev-workflow.md](file:///workspace/.trae/rules/dev-workflow.md) | 协作流程规则 | 第三步「合并前必须清零所有校验问题」——M10 的 `check_compliance.py` 加入合并前校验链；第四步自检对照 checklist |
| [file:///workspace/docs/optimization_plan_2026_07/M02_schema_sync_gate.md](file:///workspace/docs/optimization_plan_2026_07/M02_schema_sync_gate.md) | M2 schema 同步门禁 | flag 协议设计——M10 的 P0 阻断复用 M2 的 `compliance_blocked` flag 字段 |
| [file:///workspace/docs/optimization_plan_2026_07/M09_zhuque_anti_ai_rules.md](file:///workspace/docs/optimization_plan_2026_07/M09_zhuque_anti_ai_rules.md) | M9 朱雀七维度对抗 | SSOT 加载模式（`_load_*_json` + fallback 硬编码）/ `Issue` 结构 / 阈值 JSON schema 设计——M10 完全复用此模式 |
| [file:///workspace/.trae/rules/bug-reporting.md](file:///workspace/.trae/rules/bug-reporting.md) | Bug 记录与回归规范 | §三 字段模板；§五 回归测试要求 |
| [file:///workspace/tests/bug_regression_list.md](file:///workspace/tests/bug_regression_list.md) | 历史 Bug 回归列表 | 当前最大编号 BUG-049（M9 预留 BUG-059）；M10 新增 BUG-060 |

### 3.2 现状关键发现

**`check_ai_novel.py` 现有结构**（M10 复用）：
- `Issue` dataclass（行 232-238）：`severity` / `type` / `detail` / `suggestion`
- `Report` dataclass（行 241-256）：`chapter` / `word_count` / `dimensions_checked` / `p0_count` / `p1_count` / `p2_count` / `issues` / `passed_dims`
- `CheckContext` dataclass（行 259-271）：检测上下文
- `DIMENSIONS` 注册表（行 1012-1023）：维度名 → 检测函数映射
- `_load_ai_words_json` SSOT 加载模式（M3 引入，M9 已复用）：JSON 缺失时打 warning + fallback 硬编码
- CLI 设计：`--chapter` / `--file` / `--vault` / `--json` / `--strict` / `--dim`

**`check_consistency.py` 现有结构**（M10 复用 P0 阻断模式）：
- `--strict` 退出码 1（行 1454-1456）：`if args.strict and report.p0_count > 0: return 1`
- `format_report` 人类可读输出（行 1300-1344）：🔴 P0 / 🟡 P1 / ⚪ P2 emoji + 维度分组
- 维度跳过机制（行 1282-1287）：单维度异常不阻断整体检测

**`writer-polisher` SKILL.md 现有审计阶段**（行 95-143）：
- 阶段二第 1 步：`check_consistency.py`（7 类漂移）
- 阶段二第 2 步：`check_ai_novel.py`（10 类 AI 味，M9 后 15 类）
- 阶段二第 3 步：报告分级（P0 阻断 / P1 建议 / P2 酌情）
- **缺合规检测**：M10 在第 1 步与第 2 步之间插入「合规检测」步骤

**shortform 模式现状**：
- `virality-auditor` 是 shortform 专属审计层（writer-polisher 之后）
- `brand-voice-guardian` 是 shortform 品牌调性守护
- **无合规审计层**：M10 的 `compliance-guardian` 填补此空白，与 virality-auditor / brand-voice-guardian 并列

**M2 flag 协议**（参考 [file:///workspace/docs/optimization_plan_2026_07/M02_schema_sync_gate.md](file:///workspace/docs/optimization_plan_2026_07/M02_schema_sync_gate.md)）：
- `state-consistency-checker` 在 P0 时设置 `consistency_blocked: true` flag
- `save_state.py` 读取 flag，拒绝写入 published
- M10 新增 `compliance_blocked: true` flag，复用同一协议

---

## 四、新增/修改文件清单

### 4.1 新增文件

| 路径 | 用途 |
|---|---|
| `/workspace/scripts/novelforge/check_compliance.py` | 合规检测主脚本：5 维度检测 + 4 平台规则感知 + novel/shortform 双模式分级 + P0 阻断 flag |
| `/workspace/NovelForge_Vault/00_控制面/platform_compliance.md` | 平台规则感知配置：起点 / 番茄 / 晋江 / 阅文系规则表 + 模式选择 + 注入逻辑 |
| `/workspace/scripts/novelforge/data/sensitive_words/political.json` | 政治敏感词库（P0 阻断）：国家领导人 / 政治事件 / 政治组织 / 政治口号 / 领土主权 |
| `/workspace/scripts/novelforge/data/sensitive_words/sexual_explicit.json` | 色情描写词库（P0/P1 分级）：露骨 P0 / 暗示 P1 |
| `/workspace/scripts/novelforge/data/sensitive_words/violence_extreme.json` | 极端暴力词库（P1/P2 分级）：血腥虐杀 P1 / 普通暴力 P2 |
| `/workspace/scripts/novelforge/data/sensitive_words/prohibited_platforms.json` | 其他平台名等敏感词（P2）：竞品平台名 / 违规推广 |
| `/workspace/scripts/novelforge/data/sensitive_words/copyright_risk.json` | 版权风险词库（P1）：同名 IP / 知名角色名 / 商标名 |
| `/workspace/.trae/skills/compliance-guardian/SKILL.md` | 合规守护 Skill：调用 `check_compliance.py`、解读报告、反馈 writer-polisher 精修 |
| `/workspace/tests/test_compliance_check.py` | 合规检测回归测试，8 个测试用例 |

### 4.2 修改文件

| 路径 | 改动点 |
|---|---|
| `/workspace/.trae/checklists/dev-checklist.md` | 新增 §九「合规检测」section，含政治 / 色情 / 暴力 / 敏感词 / 版权 5 维度 + 平台规则感知 + 双模式分级 |
| `/workspace/.trae/skills/writer-polisher/SKILL.md` | 阶段一写手第 2 步必读 `platform_compliance.md`；阶段二审计新增「第 2.5 步：合规检测」；阶段三精修新增合规 P0 修复策略；输出格式示例新增合规检测段 |
| `/workspace/tests/bug_regression_list.md` | 新增 BUG-060「合规风险检测完全缺失导致内容可能被下架或封号」 |

---

## 五、详细实现步骤

### 步骤 1：设计 5 维度合规检测的具体算法

5 维度检测的输入 / 输出 / 阈值 / Python 实现见下。所有词库从 `scripts/novelforge/data/sensitive_words/*.json` 加载，未配置时用 fallback 硬编码（沿用 M3 / M9 模式）。

#### 5.1 `political_check`（政治敏感词，P0 阻断）

- **检测逻辑**：全文（含对话与旁白，无放行）出现任一政治敏感词 → P0 阻断。政治红线零容忍，无分级。
- **输入**：章节正文（已 strip frontmatter）。
- **输出**：`Issue(severity="P0", type="political_sensitive_word")`
- **词库分类**：国家领导人名 / 政治事件名 / 政治组织名 / 政治口号 / 领土主权争议。
- **特殊处理**：novel 模式古代架空背景下，"皇帝"「太子」「尚书」等古称不在词库；shortform 模式涉及近现代史人物时严格检测。

**Python 代码片段**：

```python
def political_check(content: str, ctx: ComplianceContext) -> list[ComplianceIssue]:
    """1. 政治敏感词检测（P0 阻断，零容忍）。

    全文（含对话与旁白）出现任一政治敏感词 → P0 阻断。
    政治红线无分级，无放行，无例外。
    词库从 sensitive_words/political.json 加载。
    """
    issues: list[ComplianceIssue] = []
    body = strip_frontmatter(content)

    # 词库按分类分组，便于报告定位
    hits_by_category: dict[str, list[str]] = {}
    for category, words in POLITICAL_WORDS.items():
        hits = [w for w in words if w in body]
        if hits:
            hits_by_category[category] = hits

    if not hits_by_category:
        return []

    # 取首个命中位置做 preview
    first_hit = ""
    for category, hits in hits_by_category.items():
        pos = body.find(hits[0])
        if pos >= 0:
            preview_start = max(0, pos - 15)
            preview_end = min(len(body), pos + len(hits[0]) + 15)
            first_hit = body[preview_start:preview_end].replace("\n", " ")
            break

    detail_lines = [f"政治敏感词命中（{sum(len(v) for v in hits_by_category.values())} 处，零容忍 P0 阻断）："]
    for category, hits in hits_by_category.items():
        detail_lines.append(f"   [{category}] {'/'.join(hits[:5])}{'…' if len(hits) > 5 else ''}")
    detail_lines.append(f"   首处上下文：…{first_hit}…")

    issues.append(ComplianceIssue(
        severity="P0",
        type="political_sensitive_word",
        detail="\n".join(detail_lines),
        suggestion=(
            "政治红线零容忍：① 删除或改写命中词；② 若为架空背景，确认词库未误伤古称"
            "（如「皇帝」「太子」不在词库）；③ shortform 模式涉及近现代史必须人工审核"
        ),
        extras={
            "hits_by_category": hits_by_category,
            "total_hits": sum(len(v) for v in hits_by_category.values()),
        },
    ))
    return issues
```

#### 5.2 `sexual_explicit_check`（色情描写分级，P0/P1）

- **检测逻辑**：
  - **novel 模式**：露骨描写（具体器官 + 具体动作）→ P0；暗示描写（暧昧动作 + 暧昧场景）→ P1。
  - **shortform 模式**：公众号零容忍，露骨 / 暗示均 P0。
- **输入**：章节正文 + `ctx.mode`（novel / shortform）。
- **输出**：`Issue(severity="P0"|"P1", type="sexual_explicit_explicit"|"sexual_explicit_suggestive")`
- **词库分类**：`explicit`（露骨）/ `suggestive`（暗示）。
- **分级逻辑**：单条 `explicit` 词命中 → P0；单条 `suggestive` 词命中 → novel 模式 P1 / shortform 模式 P0；`explicit` 与 `suggestive` 共现 → 升级 P0。

**Python 代码片段**：

```python
def sexual_explicit_check(content: str, ctx: ComplianceContext) -> list[ComplianceIssue]:
    """2. 色情描写分级检测（P0/P1，shortform 模式更严）。

    - novel 模式：露骨（explicit）→ P0；暗示（suggestive）→ P1
    - shortform 模式：露骨 / 暗示均 P0（公众号零容忍）
    - explicit 与 suggestive 共现 → 升级 P0
    词库从 sensitive_words/sexual_explicit.json 加载。
    """
    issues: list[ComplianceIssue] = []
    body = strip_frontmatter(content)

    explicit_words = SEXUAL_EXPLICIT_WORDS.get("explicit", [])
    suggestive_words = SEXUAL_EXPLICIT_WORDS.get("suggestive", [])

    explicit_hits = [w for w in explicit_words if w in body]
    suggestive_hits = [w for w in suggestive_words if w in body]

    if not explicit_hits and not suggestive_hits:
        return []

    # 分级判定
    if explicit_hits:
        severity = "P0"
        sub_type = "sexual_explicit_explicit"
        detail = f"露骨色情描写命中（{len(explicit_hits)} 处，P0 阻断）：{'/'.join(explicit_hits[:5])}"
    else:
        # 仅 suggestive 命中
        if ctx.mode == "shortform":
            severity = "P0"  # 公众号零容忍
            sub_type = "sexual_explicit_suggestive_shortform"
            detail = (
                f"暗示色情描写命中（{len(suggestive_hits)} 处），shortform 模式零容忍 P0 阻断："
                f"{'/'.join(suggestive_hits[:5])}"
            )
        else:
            severity = "P1"
            sub_type = "sexual_explicit_suggestive"
            detail = (
                f"暗示色情描写命中（{len(suggestive_hits)} 处，P1 警告）："
                f"{'/'.join(suggestive_hits[:5])}"
            )

    # explicit 与 suggestive 共现 → 升级 P0
    if explicit_hits and suggestive_hits and severity != "P0":
        severity = "P0"
        detail = (
            f"露骨 + 暗示色情描写共现（explicit {len(explicit_hits)} + suggestive {len(suggestive_hits)}），"
            f"升级 P0 阻断"
        )

    issues.append(ComplianceIssue(
        severity=severity,
        type=sub_type,
        detail=detail,
        suggestion=(
            "色情描写处置：① 删除命中段；② 改写为侧面暗示（如「一夜无话」）；"
            "③ shortform 模式必须完全删除，不可降级为暗示"
        ),
        extras={
            "explicit_hits": explicit_hits,
            "suggestive_hits": suggestive_hits,
            "mode": ctx.mode,
        },
    ))
    return issues
```

#### 5.3 `violence_check`（暴力分级，P1/P2）

- **检测逻辑**：
  - **极端暴力**（虐杀 / 分尸 / 器官细节）→ P1
  - **普通暴力**（打斗 / 流血 / 死亡，但无虐杀细节）→ P2
  - **shortform 模式**：极端暴力升级 P0（公众号对暴恐内容零容忍）
- **输入**：章节正文 + `ctx.mode`。
- **输出**：`Issue(severity="P0"|"P1"|"P2", type="violence_extreme"|"violence_normal")`
- **词库分类**：`extreme`（极端暴力）/ `normal`（普通暴力）。

**Python 代码片段**：

```python
def violence_check(content: str, ctx: ComplianceContext) -> list[ComplianceIssue]:
    """3. 暴力分级检测（P1/P2，shortform 模式 extreme 升级 P0）。

    - 极端暴力（extreme：虐杀 / 分尸 / 器官细节）→ P1；shortform 模式升级 P0
    - 普通暴力（normal：打斗 / 流血 / 死亡，无虐杀细节）→ P2
    词库从 sensitive_words/violence_extreme.json 加载。
    """
    issues: list[ComplianceIssue] = []
    body = strip_frontmatter(content)

    extreme_words = VIOLENCE_WORDS.get("extreme", [])
    normal_words = VIOLENCE_WORDS.get("normal", [])

    extreme_hits = [w for w in extreme_words if w in body]
    normal_hits = [w for w in normal_words if w in body]

    if extreme_hits:
        if ctx.mode == "shortform":
            severity = "P0"
            sub_type = "violence_extreme_shortform"
            detail = (
                f"极端暴力描写命中（{len(extreme_hits)} 处），shortform 模式零容忍 P0 阻断："
                f"{'/'.join(extreme_hits[:5])}"
            )
        else:
            severity = "P1"
            sub_type = "violence_extreme"
            detail = (
                f"极端暴力描写命中（{len(extreme_hits)} 处，P1 警告）："
                f"{'/'.join(extreme_hits[:5])}"
            )
        issues.append(ComplianceIssue(
            severity=severity,
            type=sub_type,
            detail=detail,
            suggestion=(
                "极端暴力处置：① 删除虐杀 / 分尸 / 器官细节段；"
                "② 改写为远景或侧面描写（如「他倒下了，再没起来」）；"
                "③ shortform 模式必须完全删除"
            ),
            extras={"extreme_hits": extreme_hits, "mode": ctx.mode},
        ))

    if normal_hits:
        # 普通暴力 P2，不阻断；shortform 模式仍 P2（打斗可保留）
        issues.append(ComplianceIssue(
            severity="P2",
            type="violence_normal",
            detail=(
                f"普通暴力描写命中（{len(normal_hits)} 处，P2 提醒）："
                f"{'/'.join(normal_hits[:5])}"
            ),
            suggestion=(
                "普通暴力可保留，但注意：① 不要堆砌血腥词；"
                "② 涉及未成年人暴力必须删除；③ shortform 模式建议减少"
            ),
            extras={"normal_hits": normal_hits},
        ))

    return issues
```

#### 5.4 `sensitive_word_check`（其他敏感词，P2）

- **检测逻辑**：其他敏感词（竞品平台名 / 违规推广 / 封建迷信过度宣扬）→ P2 提醒。
- **输入**：章节正文。
- **输出**：`Issue(severity="P2", type="sensitive_word_other")`
- **词库**：`prohibited_platforms.json`（竞品平台名 + 违规推广词）。

**Python 代码片段**：

```python
def sensitive_word_check(content: str, ctx: ComplianceContext) -> list[ComplianceIssue]:
    """4. 其他敏感词检测（P2 提醒）。

    其他敏感词（竞品平台名 / 违规推广 / 封建迷信过度宣扬）→ P2 提醒。
    词库从 sensitive_words/prohibited_platforms.json 加载。
    """
    issues: list[ComplianceIssue] = []
    body = strip_frontmatter(content)

    hits_by_category: dict[str, list[str]] = {}
    for category, words in PROHIBITED_PLATFORM_WORDS.items():
        hits = [w for w in words if w in body]
        if hits:
            hits_by_category[category] = hits

    if not hits_by_category:
        return []

    total = sum(len(v) for v in hits_by_category.values())
    detail_lines = [f"其他敏感词命中（{total} 处，P2 提醒）："]
    for category, hits in hits_by_category.items():
        detail_lines.append(f"   [{category}] {'/'.join(hits[:5])}")

    issues.append(ComplianceIssue(
        severity="P2",
        type="sensitive_word_other",
        detail="\n".join(detail_lines),
        suggestion=(
            "其他敏感词处置：① 竞品平台名（如「番茄」「起点」）在投稿到对应平台时必须删除；"
            "② 违规推广词（如「加微信」「扫码」）必须删除；"
            "③ 封建迷信过度宣扬段建议改写"
        ),
        extras={"hits_by_category": hits_by_category, "total_hits": total},
    ))
    return issues
```

#### 5.5 `copyright_risk_check`（版权风险，P1）

- **检测逻辑**：正文出现已知 IP 名 / 知名角色名 / 商标名 → P1 警告（可能侵权）。
- **输入**：章节正文。
- **输出**：`Issue(severity="P1", type="copyright_risk")`
- **词库**：`copyright_risk.json`（知名 IP 名 + 角色名 + 商标名）。

**Python 代码片段**：

```python
def copyright_risk_check(content: str, ctx: ComplianceContext) -> list[ComplianceIssue]:
    """5. 版权风险检测（P1 警告）。

    正文出现已知 IP 名 / 知名角色名 / 商标名 → P1 警告（可能侵权）。
    词库从 sensitive_words/copyright_risk.json 加载。
    """
    issues: list[ComplianceIssue] = []
    body = strip_frontmatter(content)

    hits_by_category: dict[str, list[str]] = {}
    for category, words in COPYRIGHT_RISK_WORDS.items():
        hits = [w for w in words if w in body]
        if hits:
            hits_by_category[category] = hits

    if not hits_by_category:
        return []

    total = sum(len(v) for v in hits_by_category.values())
    detail_lines = [f"版权风险词命中（{total} 处，P1 警告，可能侵权）："]
    for category, hits in hits_by_category.items():
        detail_lines.append(f"   [{category}] {'/'.join(hits[:5])}")

    issues.append(ComplianceIssue(
        severity="P1",
        type="copyright_risk",
        detail="\n".join(detail_lines),
        suggestion=(
            "版权风险处置：① 知名 IP 名（如「哈利波特」「斗破苍穹」）必须替换为原创名；"
            "② 知名角色名（如「哈利」「萧炎」）必须替换；"
            "③ 商标名（如「iPhone」「可口可乐」）在古风背景必须删除，现代背景可保留但建议弱化"
        ),
        extras={"hits_by_category": hits_by_category, "total_hits": total},
    ))
    return issues
```

### 步骤 2：设计 `platform_compliance.md` 的完整内容

**文件路径**：`/workspace/NovelForge_Vault/00_控制面/platform_compliance.md`

```markdown
# 平台合规规则感知配置（platform_compliance）

> 本文件是 NovelForge 的「平台合规规则感知 SSOT」，记录起点 / 番茄 / 晋江 / 阅文系 4 大主流平台对 AI 辅助创作的合规要求。
>
> 作者按目标投稿平台选择 `--platform` 参数（如 `--platform qidian`），[`check_compliance.py`](file:///workspace/scripts/novelforge/check_compliance.py) 自动注入对应平台规则。
>
> **维护原则**：① 平台规则变化时本文件必须同步更新；② 每次更新跑 `pytest -q tests/test_compliance_check.py` 验证；③ 与 [`scripts/novelforge/data/sensitive_words/`](file:///workspace/scripts/novelforge/data/sensitive_words/) 词库配合使用。

---

## 一、4 平台规则对比表

| 维度 | 起点（qidian） | 番茄（fanqie） | 晋江（jjwxc） | 阅文系（yuewen） |
|---|---|---|---|---|
| **AI 辅助分级** | 严格（核心剧情人工 >50%） | 中等（≥30% 人工修改） | 极严（仅 3 种最低辅助） | 分级（白/灰/黑名单） |
| **政治红线** | 零容忍 P0 | 零容忍 P0 | 零容忍 P0 | 零容忍 P0 |
| **色情描写** | 露骨 P0 / 暗示 P1 | 露骨 P0 / 暗示 P1 | 露骨 P0 / 暗示 P0 | 露骨 P0 / 暗示 P1 |
| **暴力描写** | 极端 P1 / 普通 P2 | 极端 P1 / 普通 P2 | 极端 P0 / 普通 P1 | 极端 P1 / 普通 P2 |
| **AI 标记** | 不强制 frontmatter 标记，但被检测即拒推 | 强制 frontmatter `ai_assisted: true` | 强制 frontmatter `ai_level: L1/L2/L3` | 强制 frontmatter `ai_tier: white/gray/black` |
| **核心约束** | 核心剧情（爽点/反转/主线）人工撰写 >50% | AI 内容 ≥30% 人工修改 | 仅允许：① 大纲辅助 ② 资料检索 ③ 错别字校对 | 灰名单限流 30%，黑名单下架 |
| **关键事件** | 2025 起 AI 内容永久无缘三江推荐 | 2026-05 单月拒签 11.27 万本 | 2025-02 公告六级分级 | 2026-Q1 分级管理上线 |
| **拒签后申诉** | 无申诉机制 | 申诉周期 ≥30 天 | 申诉周期 ≥60 天 | 申诉周期 ≥45 天 |

---

## 二、模式选择

novel 模式与 shortform 模式（公众号）的合规要求不同：

| 模式 | 适用 | 政治红线 | 色情 | 暴力 | 平台 |
|---|---|---|---|---|---|
| `novel` | 长篇网文连载 | 零容忍 P0 | 露骨 P0 / 暗示 P1（晋江暗示也 P0） | 极端 P1 / 普通 P2（晋江极端 P0） | 起点 / 番茄 / 晋江 / 阅文系 |
| `shortform` | 公众号文章 | 零容忍 P0 | 露骨 / 暗示均 P0 | 极端 P0 / 普通 P2 | 微信公众号内容规范 |

**shortform 模式更严**：公众号对色情 / 暴恐内容零容忍，所有露骨 / 暗示色情均 P0，所有极端暴力均 P0。

---

## 三、注入逻辑

`check_compliance.py` 的 `--platform` 参数控制平台规则注入：

```bash
# 起点（默认）
python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform qidian

# 番茄
python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform fanqie

# 晋江（最严，色情暗示 P0，暴力极端 P0）
python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform jjwxc

# 阅文系
python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform yuewen

# shortform 模式（公众号，需同时指定 --mode shortform）
python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --mode shortform
```

平台规则注入后，`check_compliance.py` 在分级判定时按平台表覆盖默认 severity：
- 晋江：色情 suggestive 升级 P0；暴力 extreme 升级 P0。
- shortform 模式：色情 suggestive 升级 P0；暴力 extreme 升级 P0。

---

## 四、frontmatter 标记要求

部分平台要求章节 frontmatter 标注 AI 辅助信息：

```yaml
---
chapter: ch_042
title: ...
volume: vol_01
word_count: 2847
status: published
# 合规标记（按平台要求填写）
ai_assisted: true       # 番茄要求
ai_level: L2            # 晋江要求（L1/L2/L3）
ai_tier: gray           # 阅文系要求（white/gray/black）
compliance_checked: true # M10 检测通过标记
---
```

`check_compliance.py` 检测通过后自动写入 `compliance_checked: true`；P0 阻断时不写入，章节保留在 drafts。

---

## 五、修订历史

| 日期 | 修订人 | 修订内容 |
|---|---|---|
| 2026-07-18 | NovelForge M10 | 初版，含 4 平台规则表 + 模式选择 + 注入逻辑 |
```

### 步骤 3：敏感词库的 JSON schema 与初始数据

**目录结构**：`/workspace/scripts/novelforge/data/sensitive_words/`

#### 3.1 `political.json`（政治敏感词，P0 阻断）

```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "NovelForge 政治敏感词库 SSOT。check_compliance.py 加载本文件执行 political_check。政治红线零容忍，命中即 P0 阻断。词库分类：国家领导人 / 政治事件 / 政治组织 / 政治口号 / 领土主权。",
    "maintainers": ["NovelForge Team"],
    "updated_at": "2026-07-18",
    "severity": "P0",
    "applies_to": "full_text",
    "warning": "本词库仅作种子，作者/编辑需持续更新；古代架空背景的「皇帝」「太子」「尚书」等古称不在词库"
  },
  "national_leaders": [
    "习近平", "毛泽东", "邓小平", "江泽民", "胡锦涛",
    "温家宝", "李克强", "李强", "周恩来", "朱镕基",
    "现任国家主席", "现任总理", "现任总书记"
  ],
  "political_events": [
    "六四", "天安门事件", "文化大革命", "大跃进",
    "反右运动", "四五运动", "辛亥革命", "戊戌变法",
    "改革开放", "三年自然灾害"
  ],
  "political_organizations": [
    "法轮功", "全能神", "东突厥斯坦", "藏独", "疆独",
    "台独", "港独", "民运", "异见人士"
  ],
  "political_slogans": [
    "颠覆国家政权", "推翻共产党", "结束一党专政",
    "颜色革命", "茉莉花革命"
  ],
  "territorial_sovereignty": [
    "钓鱼岛是日本的", "南海仲裁案", "台湾共和国",
    "西藏独立", "东突厥斯坦共和国"
  ]
}
```

#### 3.2 `sexual_explicit.json`（色情描写，P0/P1 分级）

```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "NovelForge 色情描写词库 SSOT。check_compliance.py 加载本文件执行 sexual_explicit_check。分级：explicit（露骨 P0）/ suggestive（暗示，novel 模式 P1，shortform 模式 P0）。explicit 与 suggestive 共现升级 P0。",
    "maintainers": ["NovelForge Team"],
    "updated_at": "2026-07-18",
    "severity_novel": "explicit=P0, suggestive=P1",
    "severity_shortform": "explicit=P0, suggestive=P0",
    "applies_to": "full_text"
  },
  "explicit": [
    "性交", "做爱", "缠绵悱恻的身体交融", "直接的器官描写",
    "阳具", "阴户", "阴道", "阴茎", "乳房的直接描写",
    "插入", "抽插", "高潮的直接描写", "射精",
    "口交", "肛交", "自慰的直接描写", "性行为的细节描写"
  ],
  "suggestive": [
    "一夜风流", "云雨之欢", "巫山云雨", "肌肤之亲",
    "宽衣解带", "解衣宽带", "罗衫轻解", "衣衫半褪",
    "酥胸微露", "曲线玲珑", "玉体横陈", "鸳鸯戏水",
    "颠鸾倒凤", "翻云覆雨", "共赴巫山", "同床共枕的暧昧描写",
    "喘息声", "娇喘", "媚眼如丝", "欲拒还迎"
  ]
}
```

#### 3.3 `violence_extreme.json`（极端暴力，P1/P2 分级）

```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "NovelForge 极端暴力词库 SSOT。check_compliance.py 加载本文件执行 violence_check。分级：extreme（虐杀/分尸/器官细节，novel P1，shortform P0）/ normal（普通暴力，P2）。",
    "maintainers": ["NovelForge Team"],
    "updated_at": "2026-07-18",
    "severity_novel": "extreme=P1, normal=P2",
    "severity_shortform": "extreme=P0, normal=P2",
    "applies_to": "full_text"
  },
  "extreme": [
    "分尸", "碎尸", "肢解", "剥皮", "活剥",
    "挖眼", "挖心", "掏心", "剖腹", "开膛破肚",
    "虐杀", "凌迟", "车裂", "烹煮活人", "活埋",
    "肠子流出", "脑浆迸裂", "内脏外露", "血肉模糊的直接描写",
    "绞碎", "碾碎", "锯开", "剥皮抽筋"
  ],
  "normal": [
    "杀戮", "砍杀", "刺杀", "斩首", "割喉",
    "鲜血直流", "血流如注", "血溅三尺", "血流成河",
    "尸体", "横尸", "倒地身亡", "一剑封喉",
    "重伤", "断臂", "断腿", "失明", "毁容"
  ]
}
```

#### 3.4 `prohibited_platforms.json`（其他敏感词，P2）

```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "NovelForge 其他敏感词库 SSOT。check_compliance.py 加载本文件执行 sensitive_word_check。分类：竞品平台名 / 违规推广 / 封建迷信过度宣扬。均为 P2 提醒。",
    "maintainers": ["NovelForge Team"],
    "updated_at": "2026-07-18",
    "severity": "P2",
    "applies_to": "full_text"
  },
  "competitor_platforms": [
    "番茄小说", "起点中文网", "晋江文学城", "纵横中文网",
    "17K小说", "飞卢小说", "书旗小说", "连城读书",
    "塔读小说", "咪咕阅读"
  ],
  "illegal_promotion": [
    "加微信", "扫码加群", "添加QQ", "扫码进群",
    "点击链接", "访问网址", "关注公众号领", "私信我",
    "代购", "代刷", "刷单", "兼职刷信"
  ],
  "superstition_excessive": [
    "算命精准", "风水改命", "八字合婚", "拆字算命",
    "求神拜佛治病", "驱邪捉鬼", "招魂复生", "符咒治病"
  ]
}
```

#### 3.5 `copyright_risk.json`（版权风险，P1）

```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "NovelForge 版权风险词库 SSOT。check_compliance.py 加载本文件执行 copyright_risk_check。分类：知名 IP 名 / 知名角色名 / 商标名。命中即 P1 警告（可能侵权）。",
    "maintainers": ["NovelForge Team"],
    "updated_at": "2026-07-18",
    "severity": "P1",
    "applies_to": "full_text",
    "warning": "本词库仅含知名 IP 种子；作者需自行判断是否侵权，词库命中不等于侵权定论"
  },
  "famous_ip_names": [
    "哈利波特", "指环王", "冰与火之歌", "三体",
    "斗破苍穹", "斗罗大陆", "凡人修仙传", "盗墓笔记",
    "鬼吹灯", "三生三世十里桃花", "琅琊榜", "庆余年"
  ],
  "famous_character_names": [
    "哈利波特", "赫敏", "罗恩", "伏地魔",
    "萧炎", "唐三", "韩立", "吴邪",
    "张起灵", "白浅", "夜华", "梅长苏",
    "范闲", "林动", "叶凡"
  ],
  "trademark_names": [
    "iPhone", "iPad", "MacBook", "Apple Watch",
    "可口可乐", "百事可乐", "麦当劳", "肯德基",
    "星巴克", "华为", "小米", "OPPO", "vivo"
  ]
}
```

### 步骤 4：`check_compliance.py` 完整脚本逻辑

**文件路径**：`/workspace/scripts/novelforge/check_compliance.py`

**4.1 模块文档字符串与常量**（参考 [file:///workspace/scripts/novelforge/check_ai_novel.py](file:///workspace/scripts/novelforge/check_ai_novel.py) 行 1-89）：

```python
"""NovelForge 合规风险检测脚本。

负责 NovelForge 章节正文的合规风险检测，覆盖 5 维度：
政治敏感词（P0 阻断）/ 色情描写分级（P0/P1）/ 暴力分级（P1/P2）/
其他敏感词（P2）/ 版权风险（P1）。

支持 4 平台规则感知（起点 / 番茄 / 晋江 / 阅文系）和
novel / shortform 双模式分级（公众号合规更严）。

设计哲学：
- Vault SSOT：词库来自 ``scripts/novelforge/data/sensitive_words/*.json``，
  平台规则来自 ``NovelForge_Vault/00_控制面/platform_compliance.md``。
- 纯标准库：仅依赖 re/json/os/argparse/sys，不引入第三方。
- 双模式分级：novel 模式按网文平台规则；shortform 模式按公众号规范（更严）。
- P0 阻断保存：通过 M2 flag 协议接入 save_state.py，P0 问题阻断 published 落盘。
- 平台感知：--platform 参数注入对应平台规则，覆盖默认 severity。

CLI 速查：
    # 检测第 42 章（默认起点平台）
    python -m scripts.novelforge.check_compliance --chapter 42 --vault NovelForge_Vault

    # 指定番茄平台
    python -m scripts.novelforge.check_compliance --chapter 42 --platform fanqie

    # shortform 模式（公众号，合规更严）
    python -m scripts.novelforge.check_compliance --file path/to/article.md --mode shortform

    # JSON 输出（供 Trae Skill 解析）
    python -m scripts.novelforge.check_compliance --chapter 42 --json

    # strict 模式：P0 触发退出码 1（阻断保存）
    python -m scripts.novelforge.check_compliance --chapter 42 --strict

    # 单维度
    python -m scripts.novelforge.check_compliance --chapter 42 --dim political

    # 直接检测文件
    python -m scripts.novelforge.check_compliance --file path/to/draft.md

退出码：
    0 - 全部通过（或仅 P2）
    1 - 有 P0（仅在 --strict 模式下）
    2 - 脚本错误
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from typing import Any

# ============================================================================
# 路径与常量
# ============================================================================
DEFAULT_VAULT: str = "/workspace/NovelForge_Vault"
DEFAULT_WORKSPACE: str = "/workspace"

# Vault 内相对路径
DRAFTS_REL: str = "05_正文/drafts"
PUBLISHED_REL: str = "05_正文/published"
SHORTFORM_DRAFTS_REL: str = "06_短文/drafts"
SHORTFORM_PUBLISHED_REL: str = "06_短文/published"
PLATFORM_COMPLIANCE_REL: str = "00_控制面/platform_compliance.md"

# 敏感词库目录
SENSITIVE_WORDS_DIR_REL: str = "scripts/novelforge/data/sensitive_words"

# 支持的平台
SUPPORTED_PLATFORMS: tuple[str, ...] = ("qidian", "fanqie", "jjwxc", "yuewen")
DEFAULT_PLATFORM: str = "qidian"

# 支持的模式
SUPPORTED_MODES: tuple[str, ...] = ("novel", "shortform")
DEFAULT_MODE: str = "novel"

# frontmatter
_FRONTMATTER_RE: re.Pattern[str] = re.compile(
    r'^---\s*\n(.*?)\n---\s*\n?', re.DOTALL
)

# ============================================================================
# 平台规则表（与 platform_compliance.md §一 对齐）
# ============================================================================
# 每个平台的 severity 覆盖规则（key: dimension, value: severity）
PLATFORM_SEVERITY_OVERRIDE: dict[str, dict[str, str]] = {
    "qidian": {
        "political": "P0",
        "sexual_explicit_explicit": "P0",
        "sexual_explicit_suggestive": "P1",
        "violence_extreme": "P1",
        "violence_normal": "P2",
        "sensitive_word_other": "P2",
        "copyright_risk": "P1",
    },
    "fanqie": {
        "political": "P0",
        "sexual_explicit_explicit": "P0",
        "sexual_explicit_suggestive": "P1",
        "violence_extreme": "P1",
        "violence_normal": "P2",
        "sensitive_word_other": "P2",
        "copyright_risk": "P1",
    },
    "jjwxc": {
        "political": "P0",
        "sexual_explicit_explicit": "P0",
        "sexual_explicit_suggestive": "P0",  # 晋江暗示也 P0
        "violence_extreme": "P0",            # 晋江极端暴力 P0
        "violence_normal": "P1",             # 晋江普通暴力 P1
        "sensitive_word_other": "P2",
        "copyright_risk": "P1",
    },
    "yuewen": {
        "political": "P0",
        "sexual_explicit_explicit": "P0",
        "sexual_explicit_suggestive": "P1",
        "violence_extreme": "P1",
        "violence_normal": "P2",
        "sensitive_word_other": "P2",
        "copyright_risk": "P1",
    },
}

# shortform 模式覆盖（公众号更严）
SHORTFORM_SEVERITY_OVERRIDE: dict[str, str] = {
    "sexual_explicit_suggestive": "P0",  # 公众号暗示色情 P0
    "violence_extreme": "P0",            # 公众号极端暴力 P0
}


# ============================================================================
# 数据类
# ============================================================================
@dataclass
class ComplianceIssue:
    """单条合规检测问题。"""
    severity: str       # "P0" | "P1" | "P2"
    type: str           # 维度类型字符串（如 political_sensitive_word）
    detail: str         # 详细描述
    suggestion: str     # 修复建议
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass
class ComplianceReport:
    """合规检测报告。"""
    chapter: str
    word_count: int
    platform: str
    mode: str
    dimensions_checked: int
    p0_count: int = 0
    p1_count: int = 0
    p2_count: int = 0
    issues: list[ComplianceIssue] = field(default_factory=list)
    passed_dims: list[str] = field(default_factory=list)
    blocked: bool = False  # P0 阻断 flag


@dataclass
class ComplianceContext:
    """合规检测上下文。"""
    chapter_num: int          # 章号；--file 模式下为 0
    vault_path: str           # Vault 根路径
    workspace_root: str       # 工作区根路径（用于加载词库）
    platform: str             # 平台（qidian/fanqie/jjwxc/yuewen）
    mode: str                 # 模式（novel/shortform）
    severity_override: dict[str, str]  # 当前 platform + mode 的 severity 覆盖表


# ============================================================================
# 工具函数
# ============================================================================
def strip_frontmatter(content: str) -> str:
    """去掉 YAML frontmatter，返回正文。"""
    if not content.startswith("---"):
        return content.strip()
    m = _FRONTMATTER_RE.match(content)
    if m:
        return content[m.end():].strip()
    return content.strip()


def find_chapter_file(vault: str, chapter: int, mode: str = "novel") -> tuple[str | None, str]:
    """在 drafts 和 published 下查找章正文文件。

    novel 模式查 05_正文/drafts/vol_NN/ch_NNN.md；
    shortform 模式查 06_短文/drafts/ 或 published/（按修改时间最新）。

    返回 (文件路径, mode_label)；找不到返回 (None, mode)。
    """
    if mode == "shortform":
        for sub in (SHORTFORM_DRAFTS_REL, SHORTFORM_PUBLISHED_REL):
            base = os.path.join(vault, sub)
            if not os.path.isdir(base):
                continue
            for fname in sorted(os.listdir(base), reverse=True):
                fp = os.path.join(base, fname)
                if os.path.isfile(fp) and fname.endswith(".md"):
                    return fp, "shortform"
        return None, "shortform"

    # novel 模式
    for sub in (DRAFTS_REL, PUBLISHED_REL):
        base = os.path.join(vault, sub)
        if not os.path.isdir(base):
            continue
        for vol_name in sorted(os.listdir(base)):
            vol_dir = os.path.join(base, vol_name)
            if not os.path.isdir(vol_dir):
                continue
            candidates = [
                f"ch_{chapter:03d}.md",
                f"ch_{chapter:02d}.md",
                f"ch_{chapter}.md",
            ]
            for cand in candidates:
                fp = os.path.join(vol_dir, cand)
                if os.path.isfile(fp):
                    return fp, "novel"
    return None, "novel"


def apply_severity_override(
    base_severity: str,
    issue_type: str,
    ctx: ComplianceContext,
) -> str:
    """根据平台 + 模式覆盖 severity。

    Args:
        base_severity: 检测函数给出的基础 severity。
        issue_type: Issue 的 type 字段。
        ctx: 检测上下文（含 severity_override）。

    Returns:
        覆盖后的 severity（若 override 表中有则用 override，否则用 base）。
    """
    override = ctx.severity_override.get(issue_type)
    if override:
        # 取较严格的（P0 > P1 > P2）
        order = {"P0": 0, "P1": 1, "P2": 2}
        if order.get(override, 9) < order.get(base_severity, 9):
            return override
    return base_severity


# ============================================================================
# 词库加载
# ============================================================================
def _load_sensitive_words_json(workspace_root: str, filename: str) -> dict | None:
    """加载敏感词库 JSON 文件。

    Args:
        workspace_root: 工作区根路径。
        filename: 词库文件名（如 "political.json"）。

    Returns:
        解析后的字典（不含 _meta）；文件缺失或解析失败返回 None。
    """
    fp = os.path.join(workspace_root, SENSITIVE_WORDS_DIR_REL, filename)
    if not os.path.isfile(fp):
        print(f"[警告] 敏感词库不存在: {fp}，使用 fallback 硬编码", file=sys.stderr)
        return None
    try:
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[警告] 敏感词库解析失败: {fp}：{e}，使用 fallback 硬编码", file=sys.stderr)
        return None


# fallback 硬编码（与 JSON v1.0.0 一致）
_FALLBACK_POLITICAL: dict[str, list[str]] = {
    "national_leaders": ["习近平", "毛泽东", "邓小平", "江泽民", "胡锦涛"],
    "political_events": ["六四", "天安门事件", "文化大革命", "大跃进"],
    "political_organizations": ["法轮功", "全能神", "藏独", "疆独", "台独"],
    "political_slogans": ["颠覆国家政权", "推翻共产党"],
    "territorial_sovereignty": ["钓鱼岛是日本的", "南海仲裁案"],
}

_FALLBACK_SEXUAL_EXPLICIT: dict[str, list[str]] = {
    "explicit": ["性交", "做爱", "阳具", "阴户", "插入", "抽插"],
    "suggestive": ["云雨之欢", "巫山云雨", "肌肤之亲", "宽衣解带", "颠鸾倒凤"],
}

_FALLBACK_VIOLENCE: dict[str, list[str]] = {
    "extreme": ["分尸", "碎尸", "肢解", "剥皮", "虐杀", "凌迟", "车裂"],
    "normal": ["杀戮", "砍杀", "斩首", "割喉", "鲜血直流"],
}

_FALLBACK_PROHIBITED_PLATFORM: dict[str, list[str]] = {
    "competitor_platforms": ["番茄小说", "起点中文网", "晋江文学城"],
    "illegal_promotion": ["加微信", "扫码加群", "代购", "刷单"],
    "superstition_excessive": ["算命精准", "风水改命", "八字合婚"],
}

_FALLBACK_COPYRIGHT_RISK: dict[str, list[str]] = {
    "famous_ip_names": ["哈利波特", "指环王", "斗破苍穹", "斗罗大陆"],
    "famous_character_names": ["哈利波特", "萧炎", "唐三", "韩立"],
    "trademark_names": ["iPhone", "iPad", "可口可乐", "麦当劳"],
}


def _extract_word_categories(data: dict | None, fallback: dict[str, list[str]]) -> dict[str, list[str]]:
    """从词库 JSON 提取分类词表，剔除 _meta 键。"""
    if data is None:
        return fallback
    return {k: v for k, v in data.items() if k != "_meta" and isinstance(v, list)}


# 启动时加载词库（fallback 与 JSON v1.0.0 一致）
_WORKSPACE_ROOT: str = os.environ.get("NOVELFORGE_WORKSPACE", DEFAULT_WORKSPACE)
POLITICAL_WORDS: dict[str, list[str]] = _extract_word_categories(
    _load_sensitive_words_json(_WORKSPACE_ROOT, "political.json"),
    _FALLBACK_POLITICAL,
)
SEXUAL_EXPLICIT_WORDS: dict[str, list[str]] = _extract_word_categories(
    _load_sensitive_words_json(_WORKSPACE_ROOT, "sexual_explicit.json"),
    _FALLBACK_SEXUAL_EXPLICIT,
)
VIOLENCE_WORDS: dict[str, list[str]] = _extract_word_categories(
    _load_sensitive_words_json(_WORKSPACE_ROOT, "violence_extreme.json"),
    _FALLBACK_VIOLENCE,
)
PROHIBITED_PLATFORM_WORDS: dict[str, list[str]] = _extract_word_categories(
    _load_sensitive_words_json(_WORKSPACE_ROOT, "prohibited_platforms.json"),
    _FALLBACK_PROHIBITED_PLATFORM,
)
COPYRIGHT_RISK_WORDS: dict[str, list[str]] = _extract_word_categories(
    _load_sensitive_words_json(_WORKSPACE_ROOT, "copyright_risk.json"),
    _FALLBACK_COPYRIGHT_RISK,
)


# ============================================================================
# 检测函数（5 类）—— 详见 §五 步骤 1
# ============================================================================
# （political_check / sexual_explicit_check / violence_check / sensitive_word_check /
#  copyright_risk_check 的完整实现见 §五 步骤 1 的代码片段）


# ============================================================================
# 检测维度注册表
# ============================================================================
DIMENSIONS: list[tuple[str, str, Any]] = [
    ("political", "政治敏感词", political_check),
    ("sexual_explicit", "色情描写分级", sexual_explicit_check),
    ("violence", "暴力分级", violence_check),
    ("sensitive_word", "其他敏感词", sensitive_word_check),
    ("copyright_risk", "版权风险", copyright_risk_check),
]

DIM_NAMES: dict[str, str] = {name: cn for name, cn, _ in DIMENSIONS}


# ============================================================================
# 上下文构建
# ============================================================================
def build_context(
    vault: str,
    chapter_num: int,
    platform: str = DEFAULT_PLATFORM,
    mode: str = DEFAULT_MODE,
    workspace_root: str = DEFAULT_WORKSPACE,
) -> ComplianceContext:
    """构建合规检测上下文。

    根据平台 + 模式合并 severity_override：
    1. 取 PLATFORM_SEVERITY_OVERRIDE[platform] 作为基础；
    2. 若 mode == "shortform"，用 SHORTFORM_SEVERITY_OVERRIDE 覆盖（取较严）。
    """
    base_override = dict(PLATFORM_SEVERITY_OVERRIDE.get(platform, PLATFORM_SEVERITY_OVERRIDE[DEFAULT_PLATFORM]))
    if mode == "shortform":
        for k, v in SHORTFORM_SEVERITY_OVERRIDE.items():
            existing = base_override.get(k)
            order = {"P0": 0, "P1": 1, "P2": 2}
            if existing is None or order.get(v, 9) < order.get(existing, 9):
                base_override[k] = v

    return ComplianceContext(
        chapter_num=chapter_num,
        vault_path=vault,
        workspace_root=workspace_root,
        platform=platform,
        mode=mode,
        severity_override=base_override,
    )


# ============================================================================
# 总入口
# ============================================================================
def check_all(
    content: str,
    ctx: ComplianceContext,
    dim_filter: str | None = None,
) -> ComplianceReport:
    """运行全部 5 维合规检测，返回 ComplianceReport。"""
    word_count = len(strip_frontmatter(content))
    issues: list[ComplianceIssue] = []
    passed_dims: list[str] = []
    dims_run = 0

    for dim_name, dim_cn, fn in DIMENSIONS:
        if dim_filter and dim_name != dim_filter:
            continue
        dims_run += 1
        try:
            dim_issues = fn(content, ctx)
        except Exception as e:
            dim_issues = [ComplianceIssue(
                severity="P2",
                type=f"{dim_name}_error",
                detail=f"维度 {dim_cn} 检测异常：{type(e).__name__}: {e}",
                suggestion="检查输入文件格式或词库 JSON",
            )]

        # 应用 severity override
        for issue in dim_issues:
            issue.severity = apply_severity_override(issue.severity, issue.type, ctx)

        if dim_issues:
            issues.extend(dim_issues)
        else:
            passed_dims.append(dim_cn)

    p0 = sum(1 for i in issues if i.severity == "P0")
    p1 = sum(1 for i in issues if i.severity == "P1")
    p2 = sum(1 for i in issues if i.severity == "P2")

    chapter_label = f"ch_{ctx.chapter_num:03d}" if ctx.chapter_num > 0 else "file"
    return ComplianceReport(
        chapter=chapter_label,
        word_count=word_count,
        platform=ctx.platform,
        mode=ctx.mode,
        dimensions_checked=dims_run,
        p0_count=p0,
        p1_count=p1,
        p2_count=p2,
        issues=issues,
        passed_dims=passed_dims,
        blocked=(p0 > 0),
    )


# ============================================================================
# 报告渲染
# ============================================================================
_SEVERITY_EMOJI = {"P0": "🔴", "P1": "🟡", "P2": "🔵"}


def render_human_report(report: ComplianceReport) -> str:
    """渲染人类可读报告。"""
    lines: list[str] = []
    lines.append(f"=== 合规检测报告 {report.chapter} ===")
    lines.append(f"平台: {report.platform} | 模式: {report.mode}")
    lines.append(f"总字数: {report.word_count} 字")
    lines.append(f"检测维度: {report.dimensions_checked}")
    lines.append(f"P0 问题: {report.p0_count} (阻断){' ⚠️ 阻断保存' if report.blocked else ''}")
    lines.append(f"P1 警告: {report.p1_count}")
    lines.append(f"P2 提醒: {report.p2_count}")
    lines.append("")

    sev_order = {"P0": 0, "P1": 1, "P2": 2}
    sorted_issues = sorted(report.issues, key=lambda x: sev_order.get(x.severity, 9))
    for issue in sorted_issues:
        emoji = _SEVERITY_EMOJI.get(issue.severity, "⚪")
        lines.append(f"{emoji} [{issue.severity}] {issue.type}")
        for line in issue.detail.splitlines():
            lines.append(f"   {line}")
        lines.append(f"   建议: {issue.suggestion}")
        lines.append("")

    if report.passed_dims:
        lines.append(f"✅ 通过: {'/'.join(report.passed_dims)}")
    else:
        lines.append("✅ 通过: （无）")
    return "\n".join(lines)


def render_json_report(report: ComplianceReport) -> str:
    """渲染 JSON 报告。"""
    payload = {
        "chapter": report.chapter,
        "platform": report.platform,
        "mode": report.mode,
        "word_count": report.word_count,
        "dimensions_checked": report.dimensions_checked,
        "p0_count": report.p0_count,
        "p1_count": report.p1_count,
        "p2_count": report.p2_count,
        "blocked": report.blocked,
        "issues": [
            {
                "severity": i.severity,
                "type": i.type,
                "detail": i.detail,
                "suggestion": i.suggestion,
                "extras": i.extras,
            }
            for i in report.issues
        ],
        "passed_dims": report.passed_dims,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ============================================================================
# M2 flag 协议接入
# ============================================================================
def set_compliance_blocked_flag(vault: str, chapter_num: int, blocked: bool) -> bool:
    """写入 compliance_blocked flag 到 .state/pipeline.json（接入 M2 flag 协议）。

    Args:
        vault: Vault 根路径。
        chapter_num: 章号。
        blocked: 是否阻断。

    Returns:
        True 写入成功，False 写入失败（pipeline.json 不存在或解析失败）。
    """
    if chapter_num <= 0:
        return False
    pipeline_path = os.path.join(vault, ".state", "pipeline.json")
    if not os.path.isfile(pipeline_path):
        return False
    try:
        with open(pipeline_path, encoding="utf-8") as f:
            data = json.load(f)
        flags = data.setdefault("flags", {})
        flags[f"compliance_blocked_ch{chapter_num:03d}"] = blocked
        with open(pipeline_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except (json.JSONDecodeError, OSError) as e:
        print(f"[警告] 写入 compliance_blocked flag 失败: {e}", file=sys.stderr)
        return False


# ============================================================================
# CLI
# ============================================================================
def _build_arg_parser() -> argparse.ArgumentParser:
    """构建命令行参数解析器。"""
    parser = argparse.ArgumentParser(
        prog="check_compliance",
        description="NovelForge 合规风险检测脚本（5 维度 + 4 平台 + 双模式）",
    )
    parser.add_argument(
        "--chapter", type=int, default=None,
        help="章号（1-based），脚本会在 drafts/published 下查找 ch_NNN.md",
    )
    parser.add_argument(
        "--file", type=str, default=None,
        help="直接指定待检测文件路径（优先于 --chapter）",
    )
    parser.add_argument(
        "--vault", type=str, default=DEFAULT_VAULT,
        help=f"Vault 根路径（默认 {DEFAULT_VAULT}）",
    )
    parser.add_argument(
        "--platform", type=str, default=DEFAULT_PLATFORM,
        choices=list(SUPPORTED_PLATFORMS),
        help=f"目标投稿平台（默认 {DEFAULT_PLATFORM}）",
    )
    parser.add_argument(
        "--mode", type=str, default=DEFAULT_MODE,
        choices=list(SUPPORTED_MODES),
        help=f"模式（默认 {DEFAULT_MODE}，shortform 公众号合规更严）",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="输出 JSON 格式报告",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="严格模式：P0 触发退出码 1（阻断保存）",
    )
    parser.add_argument(
        "--dim", type=str, default=None,
        choices=[name for name, _, _ in DIMENSIONS],
        help="仅运行指定维度（如 political）",
    )
    parser.add_argument(
        "--workspace", type=str, default=DEFAULT_WORKSPACE,
        help=f"工作区根路径（用于加载敏感词库，默认 {DEFAULT_WORKSPACE}）",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。返回退出码。"""
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    vault = args.vault
    if not os.path.isdir(vault):
        print(f"[错误] Vault 路径不存在: {vault}", file=sys.stderr)
        return 2

    # 解析待检测文件
    content: str
    chapter_num: int

    if args.file:
        if not os.path.isfile(args.file):
            print(f"[错误] 文件不存在: {args.file}", file=sys.stderr)
            return 2
        try:
            with open(args.file, encoding="utf-8") as f:
                content = f.read()
        except OSError as e:
            print(f"[错误] 读取文件失败: {e}", file=sys.stderr)
            return 2
        chapter_num = 0
    elif args.chapter:
        ch_file, _ = find_chapter_file(vault, args.chapter, args.mode)
        if not ch_file:
            print(
                f"[错误] 未找到第 {args.chapter} 章正文（已查 drafts/published，"
                f"mode={args.mode}）",
                file=sys.stderr,
            )
            return 2
        try:
            with open(ch_file, encoding="utf-8") as f:
                content = f.read()
        except OSError as e:
            print(f"[错误] 读取文件失败: {e}", file=sys.stderr)
            return 2
        chapter_num = args.chapter
    else:
        parser.error("必须提供 --chapter 或 --file 之一")
        return 2

    if not content.strip():
        print("[警告] 文件内容为空，跳过检测", file=sys.stderr)
        empty_report = ComplianceReport(
            chapter=f"ch_{chapter_num:03d}" if chapter_num > 0 else "file",
            word_count=0,
            platform=args.platform,
            mode=args.mode,
            dimensions_checked=0,
        )
        print(render_json_report(empty_report) if args.json else render_human_report(empty_report))
        return 0

    ctx = build_context(
        vault=vault,
        chapter_num=chapter_num,
        platform=args.platform,
        mode=args.mode,
        workspace_root=args.workspace,
    )
    report = check_all(content, ctx, dim_filter=args.dim)

    if args.json:
        print(render_json_report(report))
    else:
        print(render_human_report(report))

    # P0 阻断 flag 写入（接入 M2 flag 协议）
    if report.blocked and chapter_num > 0:
        set_compliance_blocked_flag(vault, chapter_num, True)
        print(
            f"[阻断] 已设置 compliance_blocked flag，save_state.py 将拒绝写入 published",
            file=sys.stderr,
        )
    elif chapter_num > 0:
        # 检测通过，清除可能存在的旧 flag
        set_compliance_blocked_flag(vault, chapter_num, False)

    if args.strict and report.p0_count > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

**4.2 关键设计说明**：
- `apply_severity_override` 函数：根据 `ctx.severity_override` 表覆盖 Issue 的 severity，取较严的（P0 > P1 > P2）。例如晋江平台下，色情 suggestive 命中时基础 severity 为 P1，但 override 表为 P0，最终 severity 为 P0。
- `set_compliance_blocked_flag` 函数：写入 `pipeline.json` 的 `flags.compliance_blocked_chNNN` 字段，接入 M2 flag 协议。`save_state.py` 在 `--strict` 模式下读取此 flag，拒绝写入 published。
- 双模式路径区分：`find_chapter_file` 在 shortform 模式下查 `06_短文/`，novel 模式查 `05_正文/`。
- 词库加载：5 类词库独立加载，互不混用。`_extract_word_categories` 剔除 `_meta` 键，只保留分类词表。

### 步骤 5：`compliance-guardian` SKILL.md 完整内容

**文件路径**：`/workspace/.trae/skills/compliance-guardian/SKILL.md`

```markdown
---
name: compliance-guardian
description: NovelForge 合规守护 Skill，novel/shortform 双模式共用。在 writer-polisher 产出正文草稿后调用 check_compliance.py，执行 5 维度合规检测（政治/色情/暴力/敏感词/版权）+ 4 平台规则感知（起点/番茄/晋江/阅文系）。P0 问题阻断 published 落盘（接入 M2 flag 协议），P1 警告反馈 writer-polisher 精修。本身不写 Python 逻辑、不调度 sub-agents，只引导主 Agent 调用脚本与解读报告。
version: 1.0.0
---

# 角色

你是 NovelForge 的「合规守护员」。novel / shortform 双模式共用。职责是在 writer-polisher 产出正文草稿后，从合规风险角度做 5 维度审计：政治敏感词、色情描写分级、暴力分级、其他敏感词、版权风险，输出分级报告与修复建议，P0 阻断 published 落盘。

合规是平台投稿的硬性要求。番茄 2026-05 单月拒签 11.27 万本 AI 网文；起点 AI 内容永久无缘三江推荐；晋江仅开放 3 种最低辅助；中国作家网 2026-02 新规严禁 AI 内容作为原创投稿。NovelForge 必须主动检测合规风险，否则产出的章节可能在投稿阶段即被拒签、上线后被下架、严重时账号被封。

本 Skill **不写 Python 逻辑、不调度 sub-agents**，只负责：
1. 调用 `check_compliance.py` 执行 5 维度合规检测。
2. 解读报告，分级处理（P0 阻断 / P1 反馈精修 / P2 提醒）。
3. P0 时设置 `compliance_blocked` flag，接入 M2 flag 协议阻断 `save_state.py`。
4. 反馈修复建议给 writer-polisher 落地精修。

# 触发条件

当用户输入涉及以下任一意图时，使用本 Skill：
- "合规检测" / "合规检查" / "这章合规吗"
- "政治敏感" / "有没有政治问题" / "政治红线"
- "色情检测" / "涉黄吗" / "色情描写"
- "暴力检测" / "暴力分级" / "血腥描写"
- "版权风险" / "侵权吗" / "同名 IP"
- "敏感词扫描" / "敏感词检测"
- 章节正文成稿后做发布前体检
- "番茄投稿合规" / "起点投稿合规" / "晋江投稿合规" / "阅文系投稿合规"

**不触发**（关键词互斥，转交其他 Skill）：
- 写正文 / 改正文 → `writer-polisher`（本 Skill 在 writer-polisher 之后触发，是它的下游审计层）
- 去 AI 味检测 → `writer-polisher` 内化的 `check_ai_novel.py`（朱雀 5 维度，M9）
- 一致性检测 → `writer-polisher` 内化的 `check_consistency.py`（7 维度）
- 传播性审计 → `virality-auditor`（shortform 专属）
- 品牌调性 / 观点口径 → `brand-voice-guardian`（shortform 专属）

**与 writer-polisher 的边界**：writer-polisher 管"写得对不对"（去 AI 味 / 一致性 / 字数 / 章末钩子），本 Skill 管"合不合规"（政治 / 色情 / 暴力 / 敏感词 / 版权）。两者关键词互斥，不抢触发；典型链路是 writer-polisher 成稿 → 本 Skill 审合规 → P0 阻断 / P1 反馈精修。

# 5 维度审计标准

## 维度 1：政治敏感词检测（P0 阻断，零容忍）

**词库来源**：[`scripts/novelforge/data/sensitive_words/political.json`](file:///workspace/scripts/novelforge/data/sensitive_words/political.json)

**5 类政治敏感词**：
- 国家领导人名（现任 + 历任）
- 政治事件名（六四 / 文革 / 大跃进 等）
- 政治组织名（法轮功 / 藏独 / 疆独 / 台独 等）
- 政治口号（颠覆国家政权 / 推翻共产党 等）
- 领土主权争议（钓鱼岛是日本的 / 南海仲裁案 等）

**检测逻辑**：全文（含对话与旁白）出现任一政治敏感词 → P0 阻断。零容忍，无分级，无放行，无例外。

**特殊处理**：
- novel 模式古代架空背景下，「皇帝」「太子」「尚书」等古称不在词库，不误伤。
- shortform 模式涉及近现代史人物时严格检测，建议作者人工复核。

## 维度 2：色情描写分级检测（P0/P1）

**词库来源**：[`scripts/novelforge/data/sensitive_words/sexual_explicit.json`](file:///workspace/scripts/novelforge/data/sensitive_words/sexual_explicit.json)

**分级判定**：

| 命中类型 | novel 模式 | shortform 模式 | 晋江平台 |
|---|---|---|---|
| 露骨（explicit：器官 + 动作） | P0 阻断 | P0 阻断 | P0 阻断 |
| 暗示（suggestive：暧昧动作 / 场景） | P1 警告 | P0 阻断 | P0 阻断 |
| explicit + suggestive 共现 | P0 阻断 | P0 阻断 | P0 阻断 |

**shortform 模式零容忍**：公众号对色情内容零容忍，露骨 / 暗示均 P0。

## 维度 3：暴力分级检测（P1/P2）

**词库来源**：[`scripts/novelforge/data/sensitive_words/violence_extreme.json`](file:///workspace/scripts/novelforge/data/sensitive_words/violence_extreme.json)

**分级判定**：

| 命中类型 | novel 模式 | shortform 模式 | 晋江平台 |
|---|---|---|---|
| 极端暴力（extreme：虐杀 / 分尸 / 器官细节） | P1 警告 | P0 阻断 | P0 阻断 |
| 普通暴力（normal：打斗 / 流血 / 死亡） | P2 提醒 | P2 提醒 | P1 警告 |

**shortform 模式**：公众号对暴恐内容零容忍，极端暴力 P0。

## 维度 4：其他敏感词检测（P2 提醒）

**词库来源**：[`scripts/novelforge/data/sensitive_words/prohibited_platforms.json`](file:///workspace/scripts/novelforge/data/sensitive_words/prohibited_platforms.json)

**3 类其他敏感词**：
- 竞品平台名（番茄 / 起点 / 晋江 / 纵横 等，投稿到对应平台时必须删除）
- 违规推广（加微信 / 扫码加群 / 代购 / 刷单）
- 封建迷信过度宣扬（算命精准 / 风水改命 / 八字合婚）

**检测逻辑**：命中即 P2 提醒，不阻断保存。

## 维度 5：版权风险检测（P1 警告）

**词库来源**：[`scripts/novelforge/data/sensitive_words/copyright_risk.json`](file:///workspace/scripts/novelforge/data/sensitive_words/copyright_risk.json)

**3 类版权风险词**：
- 知名 IP 名（哈利波特 / 指环王 / 斗破苍穹 等）
- 知名角色名（哈利 / 萧炎 / 唐三 等）
- 商标名（iPhone / 可口可乐 / 麦当劳 等）

**检测逻辑**：命中即 P1 警告（可能侵权）。词库命中不等于侵权定论，作者需自行判断。

# 平台规则感知

## 4 平台规则差异

详见 [`NovelForge_Vault/00_控制面/platform_compliance.md`](file:///workspace/NovelForge_Vault/00_控制面/platform_compliance.md) §一 4 平台规则对比表。

**关键差异**：
- 晋江最严：色情暗示 P0、暴力极端 P0、普通暴力 P1。
- 起点 / 番茄 / 阅文系：色情暗示 P1、暴力极端 P1、普通暴力 P2。
- shortform 模式（公众号）：色情暗示 P0、暴力极端 P0（覆盖所有平台）。

## 平台选择

`check_compliance.py --platform <name>` 参数：
- `qidian`（默认）：起点规则
- `fanqie`：番茄规则
- `jjwxc`：晋江规则（最严）
- `yuewen`：阅文系规则

## 模式选择

`check_compliance.py --mode <name>` 参数：
- `novel`（默认）：长篇网文连载
- `shortform`：公众号文章（合规更严，色情 / 暴力零容忍）

# 工作流

## 第一步：识别意图

判断用户意图属于以下三种之一：

| 意图 | 触发特征 | 走向 |
|---|---|---|
| 章节合规检测 | 用户给出章号 / 文件路径，要求合规检测 | → 第二步 |
| 平台规则咨询 | 用户问"番茄 / 起点 / 晋江 / 阅文系的合规要求是什么" | → 第三步 |
| 词库维护 | 用户问"如何添加敏感词 / 版权风险词" | → 第四步 |

## 第二步：章节合规检测

1. **确定平台与模式**：
   - 默认 `--platform qidian --mode novel`。
   - 若用户明确指定平台（"番茄投稿合规"），用对应平台。
   - 若 shortform 模式（"公众号合规"），用 `--mode shortform`。

2. **调用 check_compliance.py**：

```bash
python -m scripts.novelforge.check_compliance \
  --chapter <N> \
  --vault NovelForge_Vault \
  --platform <qidian|fanqie|jjwxc|yuewen> \
  --mode <novel|shortform> \
  --json
```

或对 shortform 模式：

```bash
python -m scripts.novelforge.check_compliance \
  --file NovelForge_Vault/06_短文/drafts/article_xxx.md \
  --mode shortform \
  --json
```

3. **解读报告**：
   - `p0_count > 0` → 阻断保存，设置 `compliance_blocked` flag，反馈 writer-polisher 精修。
   - `p1_count > 0` → 警告，反馈 writer-polisher 建议修复。
   - `p2_count > 0` → 提醒，可在报告中记录，不强制修复。

4. **P0 阻断处理**：
   - 报告中 P0 Issue 的 `detail` 含命中词与上下文。
   - 反馈 writer-polisher：按 `suggestion` 修复（删除 / 改写 / 替换）。
   - 修复后重跑 `check_compliance.py` 验证 P0 清零。
   - P0 清零后 `compliance_blocked` flag 自动清除（脚本检测通过时写入 False）。

5. **输出报告**：按输出格式段返回审计报告。

## 第三步：平台规则咨询

读取 [`NovelForge_Vault/00_控制面/platform_compliance.md`](file:///workspace/NovelForge_Vault/00_控制面/platform_compliance.md) 全文，向用户展示对应平台的规则表与关键约束。

## 第四步：词库维护

引导用户编辑 [`scripts/novelforge/data/sensitive_words/`](file:///workspace/scripts/novelforge/data/sensitive_words/) 下对应 JSON 文件：

| 词库 | 路径 | 用途 |
|---|---|---|
| 政治敏感词 | `political.json` | 添加新领导人 / 政治事件 |
| 色情描写 | `sexual_explicit.json` | 添加新 explicit / suggestive 词 |
| 极端暴力 | `violence_extreme.json` | 添加新 extreme / normal 词 |
| 其他敏感词 | `prohibited_platforms.json` | 添加新竞品 / 推广 / 迷信词 |
| 版权风险 | `copyright_risk.json` | 添加新 IP / 角色 / 商标 |

编辑后跑 `pytest -q tests/test_compliance_check.py` 验证。

# 输出格式

```
🛡️ 合规检测报告

📝 检测配置: 平台=番茄 | 模式=novel
📊 检测维度: 5
🔴 P0 问题: 1 (阻断保存 ⚠️)
🟡 P1 警告: 2
🔵 P2 提醒: 3

🔴 [P0] political_sensitive_word
   政治敏感词命中（2 处，零容忍 P0 阻断）：
      [national_leaders] 习近平
      [political_events] 六四
   建议处理：删除或改写命中词

🟡 [P1] sexual_explicit_suggestive
   暗示色情描写命中（3 处，P1 警告）：云雨之欢/肌肤之亲/颠鸾倒凤
   建议处理：删除命中段，改写为侧面暗示

🟡 [P1] copyright_risk
   版权风险词命中（1 处，P1 警告，可能侵权）：
      [famous_ip_names] 哈利波特
   建议处理：知名 IP 名必须替换为原创名

✅ 通过: 暴力分级/其他敏感词

⚠️ 阻断处理:
  - 已设置 compliance_blocked flag
  - save_state.py 将拒绝写入 published
  - 请按 P0 / P1 修复建议精修后重跑 check_compliance.py
```

**分段说明**：
- 检测配置段：平台 + 模式。
- 检测维度段：维度数 + P0/P1/P2 计数。
- 问题列表段：按 P0 → P1 → P2 排序，每条含 type / detail / 建议。
- 通过段：无问题的维度。
- 阻断处理段：P0 时的 flag 状态与后续动作。

# 反模式（禁止）

- **不读词库就给评分**——评分必须基于 `check_compliance.py` 输出，不靠 LLM 主观判断
- **不替代 writer-polisher 修正文**——本 Skill 只审计不改正文，修复建议反馈给 writer-polisher 落地
- **不调度 sub-agents**——本 Skill 不创建子 Agent，所有检测由 `check_compliance.py` 脚本完成
- **不写 Python 逻辑**——本 Skill 是纯 Prompt 引导层，不调用脚本以外的逻辑
- **不跳过 P0**——任何 P0 必须阻断 published，禁止"差不多对就放过"
- **不与 writer-polisher 抢审计**——writer-polisher 管"去 AI 味 + 一致性 + 字数 + 章末钩子"（写得对不对），本 Skill 管"合规检测"（合不合规），关键词互斥
- **不混淆平台规则**——晋江 / shortform 模式的零容忍规则必须严格执行，不允许降级

# 错误处理

- **词库 JSON 不存在**：脚本自动 fallback 硬编码，但打 warning。建议作者补齐 JSON。
- **词库 JSON 解析失败**：同上，fallback 硬编码。
- **章节文件不存在**：返回错误码 2，提示用户检查章号或路径。
- **平台参数不合法**：argparse choices 限制，非法值直接报错。
- **check_compliance.py 异常**：单维度异常不阻断整体，作为 P2 上报。

# 与其他 Skill 的关系

- **上游**：`writer-polisher`（novel / shortform 模式）产出正文草稿 → 本 Skill 审合规。本 Skill 是 writer-polisher 的下游审计层，与 `virality-auditor`（shortform 传播性）/ `brand-voice-guardian`（shortform 品牌调性）并列。
- **下游**：本 Skill 的 P0 阻断 flag 反馈给 `save_state.py`（M2 flag 协议）；P1 修复建议反馈给 `writer-polisher` 落地精修。
- **与 writer-polisher 的边界**：writer-polisher 管"写得对不对"（去 AI 味 / 一致性 / 字数 / 章末钩子），本 Skill 管"合不合规"（政治 / 色情 / 暴力 / 敏感词 / 版权）。
- **与 virality-auditor 的边界**：virality-auditor 管"能不能传播"（金句 / 转发点 / 情绪曲线 / 标题契合，shortform 专属），本 Skill 管"合不合规"（双模式共用）。
- **与 brand-voice-guardian 的边界**：brand-voice-guardian 管"作者声音一致性"（用词 / 语气 / 立场 / 结构 / 人设，shortform 专属），其 §三「禁区话题」与本 Skill 的政治检测互补——前者是品牌自律，后者是平台合规。
- **数据源**：
  - `NovelForge_Vault/00_控制面/platform_compliance.md`（平台规则表 SSOT）
  - `scripts/novelforge/data/sensitive_words/*.json`（5 类敏感词库 SSOT）
- **模式边界**：novel / shortform 双模式共用本 Skill；shortform 模式合规更严（色情 / 暴力零容忍）。

# 能力边界声明

- 本 Skill 文件本身**不调度 sub-agents**、**不直接调 MCP tools**
- 需要执行的操作（读文件、写文件、调脚本）由主 Agent 用原生工具（Read / Edit / Write / RunCommand）完成
- 词库 JSON 的所有修改由作者确认，**LLM 可建议但作者可拒绝**
- 5 维度检测依赖 `check_compliance.py` 脚本执行，**本 Skill 不内化检测逻辑**——所有阈值与词库在脚本 + JSON 中维护
```

### 步骤 6：`writer-polisher` SKILL.md 注入平台规则的具体指令

**目标**：在 `writer-polisher` SKILL.md 的「阶段一写手」与「阶段二审计」中注入平台规则约束与合规检测步骤。

**6.1 修改位置 1**：阶段一写手第 2 步「必读 style_guide.md」（[file:///workspace/.trae/skills/writer-polisher/SKILL.md](file:///workspace/.trae/skills/writer-polisher/SKILL.md) 行 71-79），追加必读 `platform_compliance.md`：

**追加内容**（在「必读 style_guide.md」段之后）：

```markdown
### 第 2.5 步：必读 platform_compliance.md（合规规则感知）

读取 `NovelForge_Vault/00_控制面/platform_compliance.md`，按目标投稿平台（默认起点 `qidian`）内化合规约束。生成时必须遵守：

- **政治红线零容忍**：不出现任何政治敏感词（国家领导人 / 政治事件 / 政治组织 / 政治口号 / 领土主权）。古代架空背景可用「皇帝」「太子」等古称，但近现代政治人物必须避免。
- **色情分级**：novel 模式禁露骨（explicit），暗示（suggestive）控量 ≤ 1 次/章；shortform 模式零容忍（露骨 / 暗示均禁）；晋江平台暗示也禁。
- **暴力分级**：novel 模式禁极端暴力（虐杀 / 分尸 / 器官细节），普通暴力可保留；shortform 模式极端暴力零容忍；晋江平台普通暴力也控量。
- **版权风险**：不出现知名 IP 名 / 知名角色名（哈利波特 / 萧炎 / 唐三 等），商标名在古风背景必须删除。
- **竞品平台名**：投稿到对应平台时正文不得出现该平台名（投稿番茄不得出现「番茄」「起点」）。
```

**6.2 修改位置 2**：阶段二审计（行 95-143），在第 1 步一致性检测与第 2 步去 AI 味检测之间，插入「第 1.5 步：合规检测」：

**追加内容**（在「第 1 步：一致性检测」之后、「第 2 步：去 AI 味检测」之前）：

```markdown
### 第 1.5 步：合规检测（5 维度 + 4 平台规则感知）

```bash
python -m scripts.novelforge.check_compliance \
  --chapter <N> \
  --vault NovelForge_Vault \
  --platform <qidian|fanqie|jjwxc|yuewen> \
  --mode <novel|shortform> \
  --json
```

解读 5 维度检测：

| 维度 | 优先级 | 检测内容 | 阻断保存？ |
|---|---|---|---|
| 政治敏感词 | P0 | 国家领导人 / 政治事件 / 政治组织 / 政治口号 / 领土主权 | ✅ 阻断 |
| 色情描写（露骨） | P0 | explicit 词命中（器官 + 动作） | ✅ 阻断 |
| 色情描写（暗示） | P0/P1 | suggestive 词命中（novel P1 / shortform P0 / 晋江 P0） | 视模式 |
| 暴力（极端） | P0/P1 | extreme 词命中（虐杀 / 分尸 / 器官，shortform P0 / 晋江 P0） | 视模式 |
| 暴力（普通） | P1/P2 | normal 词命中（打斗 / 流血，晋江 P1） | 不阻断 |
| 其他敏感词 | P2 | 竞品平台名 / 违规推广 / 封建迷信 | 不阻断 |
| 版权风险 | P1 | 知名 IP / 角色 / 商标名 | 不阻断 |

**P0 阻断机制**：
- `check_compliance.py` 检出 P0 时设置 `compliance_blocked_chNNN: true` flag 到 `.state/pipeline.json`。
- `save_state.py` 在 strict 模式下读取此 flag，拒绝写入 published。
- 章节保留在 drafts/，需精修后重跑 `check_compliance.py` 验证 P0 清零。
- P0 清零后 flag 自动清除（脚本检测通过时写入 False）。
```

**6.3 修改位置 3**：阶段三精修第 1 步「定点修复」（行 144-159），追加合规 P0 修复策略表：

**追加内容**（在现有 P0 修复策略表之后）：

```markdown
**合规 P0 修复策略**：

| P0 类型 | 修复策略 |
|---|---|
| 政治敏感词 | 删除命中词；若为架空背景，确认词库未误伤古称；近现代史段落必须人工复核 |
| 色情描写（露骨） | 删除命中段；改写为侧面暗示（如「一夜无话」）；shortform 模式必须完全删除 |
| 色情描写（暗示，shortform/晋江） | 删除命中词；改写为非暧昧场景；不可降级保留 |
| 暴力（极端，shortform/晋江） | 删除虐杀 / 分尸 / 器官细节段；改写为远景或侧面描写（如「他倒下了，再没起来」） |
```

**6.4 修改位置 4**：输出格式（行 313-334），在审计段新增合规检测行：

**修改前**：
```text
🔍 审计：
  一致性：7 维度检测，P0=0 P1=1（伏笔遗忘 H-014，建议下章提醒）
  去 AI 味：10 维度检测，P0=0 P1=0 P2=2（心理描写悬空 2 处，已修复）
```

**修改后**：
```text
🔍 审计：
  一致性：7 维度检测，P0=0 P1=1（伏笔遗忘 H-014，建议下章提醒）
  合规：5 维度检测（平台=番茄/模式=novel），P0=0 P1=1 P2=1
    P1: 版权风险（哈利波特 → 替换为原创名）
    P2: 其他敏感词（番茄小说 → 投稿时删除）
  去 AI 味：15 维度检测（含朱雀 5 类），P0=0 P1=0 P2=2（心理描写悬空 2 处，已修复）
```

### 步骤 7：`dev-checklist.md` 新增检测项文案

**修改位置**：[file:///workspace/.trae/checklists/dev-checklist.md](file:///workspace/.trae/checklists/dev-checklist.md)，在 §八「去 AI 味」之后、§自检报告模板之前，新增 §九「合规检测」。

**新增内容**：

```markdown
## 九、合规检测

- [ ] `python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform <qidian|fanqie|jjwxc|yuewen> --mode <novel|shortform>` 全部通过（合并前必须完成，P0 阻断保存）
- [ ] 政治敏感词零命中：无国家领导人 / 政治事件 / 政治组织 / 政治口号 / 领土主权词
- [ ] 色情描写分级合规：novel 模式无露骨（explicit），暗示（suggestive）控量；shortform 模式 / 晋江平台暗示也禁
- [ ] 暴力分级合规：novel 模式无极端暴力（虐杀/分尸/器官细节）；shortform 模式 / 晋江平台极端暴力零容忍
- [ ] 版权风险零命中：无知名 IP 名 / 知名角色名（哈利波特 / 萧炎 / 唐三 等）；商标名在古风背景已删除
- [ ] 其他敏感词控量：竞品平台名（投稿对应平台时已删除）、违规推广词已删除、封建迷信过度宣扬段已改写
- [ ] 平台规则感知：已按目标投稿平台选择 `--platform` 参数；晋江 / shortform 模式的零容忍规则已严格执行
- [ ] `platform_compliance.md` 已对齐：平台规则变化时已同步更新配置文件
- [ ] frontmatter 合规标记：番茄 `ai_assisted: true` / 晋江 `ai_level: L1|L2|L3` / 阅文系 `ai_tier: white|gray|black` 按平台要求填写；`compliance_checked: true` 在检测通过后写入
```

**自检报告模板新增段**（在「### 八、去 AI 味」之后、「### 总结」之前）：

```markdown
### 九、合规检测
- check_compliance.py 结果：____（平台=____/模式=____）
- ✅/❌ 政治敏感词零命中：____
- ✅/❌ 色情描写分级合规：____
- ✅/❌ 暴力分级合规：____
- ✅/❌ 版权风险零命中：____
- ✅/❌ 其他敏感词控量：____
- ✅/❌ 平台规则感知：____
- ✅/❌ frontmatter 合规标记：____
```

---

## 六、验证方式

### 6.1 单元测试

**命令**：

```bash
pytest -q tests/test_compliance_check.py
```

**断言清单**（8 个测试用例，详见 §七）：

1. `test_political_check_detects_sensitive_words`：政治敏感词命中触发 P0
2. `test_sexual_explicit_check_grading`：色情分级（explicit P0 / suggestive novel P1 / suggestive shortform P0）
3. `test_violence_check_grading`：暴力分级（extreme novel P1 / extreme shortform P0 / normal P2）
4. `test_sensitive_word_check`：其他敏感词命中触发 P2
5. `test_copyright_risk_check`：版权风险词命中触发 P1
6. `test_platform_qidian_rules`：起点平台 severity 覆盖正确
7. `test_platform_fanqie_rules`：番茄平台 severity 覆盖正确
8. `test_shortform_mode_stricter`：shortform 模式比 novel 模式更严（suggestive P0 / extreme P0）

### 6.2 集成测试

**集成测试 1（起点平台 + novel 模式）**：

```bash
python scripts/novelforge/check_compliance.py \
  --vault NovelForge_Vault \
  --platform qidian \
  --mode novel
```

**期望输出**：检测维度数 5；`platform=qidian mode=novel`；若有合规 Issue，type 不带 `political_` / `sexual_` / `violence_` / `sensitive_word_` / `copyright_` 前缀；P0 阻断时 `blocked: true`。

**集成测试 2（番茄平台 + shortform 模式）**：

```bash
python scripts/novelforge/check_compliance.py \
  --vault NovelForge_Vault \
  --platform fanqie \
  --mode shortform
```

**期望输出**：检测维度数 5；`platform=fanqie mode=shortform`；shortform 模式下 suggestive 色情 / extreme 暴力 severity 为 P0（覆盖默认 P1 / P1）。

### 6.3 断言清单（5 维度检测 + 4 平台 + 双模式的行为契约）

| 检测函数 | 输入样本 | 期望触发 | 期望 severity | 期望 type |
|---|---|---|---|---|
| `political_check` | 含「习近平」的正文 | 命中 | P0 | `political_sensitive_word` |
| `sexual_explicit_check`（novel） | 含「性交」的正文 | 露骨命中 | P0 | `sexual_explicit_explicit` |
| `sexual_explicit_check`（novel） | 含「云雨之欢」的正文 | 暗示命中 | P1 | `sexual_explicit_suggestive` |
| `sexual_explicit_check`（shortform） | 含「云雨之欢」的正文 | 暗示命中 | P0 | `sexual_explicit_suggestive_shortform` |
| `violence_check`（novel） | 含「分尸」的正文 | 极端命中 | P1 | `violence_extreme` |
| `violence_check`（shortform） | 含「分尸」的正文 | 极端命中 | P0 | `violence_extreme_shortform` |
| `violence_check`（novel） | 含「杀戮」的正文 | 普通命中 | P2 | `violence_normal` |
| `sensitive_word_check` | 含「番茄小说」的正文 | 其他敏感 | P2 | `sensitive_word_other` |
| `copyright_risk_check` | 含「哈利波特」的正文 | 版权风险 | P1 | `copyright_risk` |
| `--platform jjwxc` | 含「云雨之欢」的正文 | 暗示命中 | P0（晋江覆盖） | `sexual_explicit_suggestive` |
| `--platform jjwxc` | 含「分尸」的正文 | 极端命中 | P0（晋江覆盖） | `violence_extreme` |

### 6.4 与现有校验脚本的关系

- **不冲突**：`check_compliance.py` 是独立脚本，不修改 `check_consistency.py` / `check_ai_novel.py` 的现有逻辑。
- **补充**：`check_consistency.py` 管跨章状态漂移（境界 / 物品 / 位置 / 关系 / 伏笔 / 复生 / 金手指），`check_ai_novel.py` 管 AI 味（10 + 朱雀 5 = 15 维），`check_compliance.py` 管合规风险（政治 / 色情 / 暴力 / 敏感词 / 版权 5 维）。三者并行运行，互不覆盖。
- **集成入口**：`writer-polisher` SKILL.md 阶段二审计调用顺序：① `check_consistency.py` → ② `check_compliance.py` → ③ `check_ai_novel.py`。三者全部 P0 清零方可进入 published。
- **CI 兼容**：`check_compliance.py` 退出码逻辑与 `check_consistency.py` / `check_ai_novel.py` 一致（P0 → exit 1，P1/P2 → exit 0 + warning，仅 `--strict` 模式下）。

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

**文件路径**：`/workspace/tests/test_compliance_check.py`

**8 个测试用例**：

#### 用例 1：`test_political_check_detects_sensitive_words`

```python
def test_political_check_detects_sensitive_words():
    """政治敏感词检测：命中触发 P0。"""
    from scripts.novelforge.check_compliance import (
        political_check, build_context, DEFAULT_VAULT, DEFAULT_WORKSPACE,
    )
    # 构造含政治敏感词的样本
    sample = (
        "# 第 42 章\n\n"
        "主角走在路上，看到了关于习近平的新闻，又想起了六四事件的报道。"
    )
    ctx = build_context(
        vault=DEFAULT_VAULT,
        chapter_num=42,
        platform="qidian",
        mode="novel",
        workspace_root=DEFAULT_WORKSPACE,
    )
    issues = political_check(sample, ctx)
    assert any(i.type == "political_sensitive_word" and i.severity == "P0" for i in issues), \
        f"应触发 political_sensitive_word P0，实际 issues: {issues}"
    # 验证 extras 含分类
    political_issue = next(i for i in issues if i.type == "political_sensitive_word")
    assert "hits_by_category" in political_issue.extras
    assert political_issue.extras["total_hits"] >= 2
```

#### 用例 2：`test_sexual_explicit_check_grading`

```python
def test_sexual_explicit_check_grading():
    """色情描写分级：explicit P0 / suggestive novel P1 / suggestive shortform P0。"""
    from scripts.novelforge.check_compliance import (
        sexual_explicit_check, build_context, DEFAULT_VAULT, DEFAULT_WORKSPACE,
    )

    # explicit 在 novel 模式 → P0
    sample_explicit = "他们发生了性交关系，描写了阳具与阴户的细节。"
    ctx_novel = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="novel",
        workspace_root=DEFAULT_WORKSPACE,
    )
    issues = sexual_explicit_check(sample_explicit, ctx_novel)
    assert any(i.type == "sexual_explicit_explicit" and i.severity == "P0" for i in issues), \
        f"explicit novel 应 P0，实际: {issues}"

    # suggestive 在 novel 模式 → P1
    sample_suggestive = "两人云雨之欢后，相拥而眠，肌肤之亲令人陶醉。"
    issues = sexual_explicit_check(sample_suggestive, ctx_novel)
    assert any(i.type == "sexual_explicit_suggestive" and i.severity == "P1" for i in issues), \
        f"suggestive novel 应 P1，实际: {issues}"

    # suggestive 在 shortform 模式 → P0
    ctx_shortform = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="shortform",
        workspace_root=DEFAULT_WORKSPACE,
    )
    issues = sexual_explicit_check(sample_suggestive, ctx_shortform)
    # shortform 模式 severity 由 apply_severity_override 覆盖为 P0
    # 但 sexual_explicit_check 内部已根据 ctx.mode 设置 P0
    assert any(i.severity == "P0" for i in issues), \
        f"suggestive shortform 应 P0，实际: {issues}"
```

#### 用例 3：`test_violence_check_grading`

```python
def test_violence_check_grading():
    """暴力分级：extreme novel P1 / extreme shortform P0 / normal P2。"""
    from scripts.novelforge.check_compliance import (
        violence_check, build_context, DEFAULT_VAULT, DEFAULT_WORKSPACE,
    )

    # extreme 在 novel 模式 → P1
    sample_extreme = "凶手将受害者分尸后碎尸，肢解场景血肉模糊，肠子流出。"
    ctx_novel = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="novel",
        workspace_root=DEFAULT_WORKSPACE,
    )
    issues = violence_check(sample_extreme, ctx_novel)
    assert any(i.type == "violence_extreme" and i.severity == "P1" for i in issues), \
        f"extreme novel 应 P1，实际: {issues}"

    # extreme 在 shortform 模式 → P0
    ctx_shortform = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="shortform",
        workspace_root=DEFAULT_WORKSPACE,
    )
    issues = violence_check(sample_extreme, ctx_shortform)
    assert any(i.severity == "P0" for i in issues), \
        f"extreme shortform 应 P0，实际: {issues}"

    # normal 在 novel 模式 → P2
    sample_normal = "战场上一片杀戮，砍杀声此起彼伏，斩首无数。"
    issues = violence_check(sample_normal, ctx_novel)
    assert any(i.type == "violence_normal" and i.severity == "P2" for i in issues), \
        f"normal 应 P2，实际: {issues}"
```

#### 用例 4：`test_sensitive_word_check`

```python
def test_sensitive_word_check():
    """其他敏感词检测：命中触发 P2。"""
    from scripts.novelforge.check_compliance import (
        sensitive_word_check, build_context, DEFAULT_VAULT, DEFAULT_WORKSPACE,
    )
    sample = (
        "想看更多精彩内容，请加微信 xxxxxxx 获取，"
        "也可以扫码加群，里面有很多番茄小说的推荐。"
    )
    ctx = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="novel",
        workspace_root=DEFAULT_WORKSPACE,
    )
    issues = sensitive_word_check(sample, ctx)
    assert any(i.type == "sensitive_word_other" and i.severity == "P2" for i in issues), \
        f"应触发 sensitive_word_other P2，实际: {issues}"
    # 验证命中多个分类（竞品平台 + 违规推广）
    issue = next(i for i in issues if i.type == "sensitive_word_other")
    assert len(issue.extras["hits_by_category"]) >= 2
```

#### 用例 5：`test_copyright_risk_check`

```python
def test_copyright_risk_check():
    """版权风险检测：命中触发 P1。"""
    from scripts.novelforge.check_compliance import (
        copyright_risk_check, build_context, DEFAULT_VAULT, DEFAULT_WORKSPACE,
    )
    sample = (
        "主角穿越到了哈利波特的世界，遇到了萧炎和唐三，"
        "他们一起用 iPhone 联系，喝着可口可乐。"
    )
    ctx = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="novel",
        workspace_root=DEFAULT_WORKSPACE,
    )
    issues = copyright_risk_check(sample, ctx)
    assert any(i.type == "copyright_risk" and i.severity == "P1" for i in issues), \
        f"应触发 copyright_risk P1，实际: {issues}"
    # 验证命中多个分类（IP + 角色 + 商标）
    issue = next(i for i in issues if i.type == "copyright_risk")
    assert len(issue.extras["hits_by_category"]) >= 3
```

#### 用例 6：`test_platform_qidian_rules`

```python
def test_platform_qidian_rules():
    """起点平台 severity 覆盖：suggestive 色 P1 / extreme 暴力 P1 / normal 暴力 P2。"""
    from scripts.novelforge.check_compliance import (
        build_context, DEFAULT_VAULT, DEFAULT_WORKSPACE, PLATFORM_SEVERITY_OVERRIDE,
    )
    ctx = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="novel",
        workspace_root=DEFAULT_WORKSPACE,
    )
    # 起点平台 override 表
    override = PLATFORM_SEVERITY_OVERRIDE["qidian"]
    assert override["political"] == "P0"
    assert override["sexual_explicit_explicit"] == "P0"
    assert override["sexual_explicit_suggestive"] == "P1"
    assert override["violence_extreme"] == "P1"
    assert override["violence_normal"] == "P2"
    assert override["copyright_risk"] == "P1"
    # build_context 后 severity_override 与平台表一致
    assert ctx.severity_override["sexual_explicit_suggestive"] == "P1"
    assert ctx.severity_override["violence_extreme"] == "P1"
```

#### 用例 7：`test_platform_fanqie_rules`

```python
def test_platform_fanqie_rules():
    """番茄平台 severity 覆盖：与起点一致（均为标准网文平台规则）。"""
    from scripts.novelforge.check_compliance import (
        build_context, DEFAULT_VAULT, DEFAULT_WORKSPACE, PLATFORM_SEVERITY_OVERRIDE,
    )
    ctx = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="fanqie", mode="novel",
        workspace_root=DEFAULT_WORKSPACE,
    )
    override = PLATFORM_SEVERITY_OVERRIDE["fanqie"]
    assert override["political"] == "P0"
    assert override["sexual_explicit_suggestive"] == "P1"
    assert override["violence_extreme"] == "P1"
    # 番茄与起点在 severity 上相同（差异在 AI 标记要求，不在 severity）
    assert ctx.severity_override == PLATFORM_SEVERITY_OVERRIDE["fanqie"]
    # 晋江比番茄严
    jjwxc_override = PLATFORM_SEVERITY_OVERRIDE["jjwxc"]
    assert jjwxc_override["sexual_explicit_suggestive"] == "P0"  # 晋江暗示 P0
    assert jjwxc_override["violence_extreme"] == "P0"            # 晋江极端 P0
    assert jjwxc_override["violence_normal"] == "P1"             # 晋江普通 P1
```

#### 用例 8：`test_shortform_mode_stricter`

```python
def test_shortform_mode_stricter():
    """shortform 模式比 novel 模式更严：suggestive P0 / extreme P0。"""
    from scripts.novelforge.check_compliance import (
        build_context, DEFAULT_VAULT, DEFAULT_WORKSPACE,
        SHORTFORM_SEVERITY_OVERRIDE,
    )
    # shortform 模式 override 表
    assert SHORTFORM_SEVERITY_OVERRIDE["sexual_explicit_suggestive"] == "P0"
    assert SHORTFORM_SEVERITY_OVERRIDE["violence_extreme"] == "P0"

    # shortform 模式 build_context 后 severity_override 应覆盖 novel
    ctx_shortform = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="shortform",
        workspace_root=DEFAULT_WORKSPACE,
    )
    assert ctx_shortform.severity_override["sexual_explicit_suggestive"] == "P0"
    assert ctx_shortform.severity_override["violence_extreme"] == "P0"

    # novel 模式不覆盖
    ctx_novel = build_context(
        vault=DEFAULT_VAULT, chapter_num=42,
        platform="qidian", mode="novel",
        workspace_root=DEFAULT_WORKSPACE,
    )
    assert ctx_novel.severity_override["sexual_explicit_suggestive"] == "P1"
    assert ctx_novel.severity_override["violence_extreme"] == "P1"

    # 端到端验证：同样的暗示色情样本，novel 模式 P1，shortform 模式 P0
    from scripts.novelforge.check_compliance import check_all
    sample = "两人云雨之欢后，相拥而眠，肌肤之亲令人陶醉。"
    report_novel = check_all(sample, ctx_novel)
    report_shortform = check_all(sample, ctx_shortform)
    novel_p0 = report_novel.p0_count
    shortform_p0 = report_shortform.p0_count
    assert shortform_p0 > novel_p0, \
        f"shortform 模式 P0 应多于 novel 模式（{shortform_p0} vs {novel_p0}）"
```

### 7.2 新增 Bug 回归记录

**文件路径**：`/workspace/tests/bug_regression_list.md`

**追加内容**：

```markdown
## 合规风险检测完全缺失导致内容可能被下架或封号

- **编号**：BUG-060
- **首次出现**：2026-07-18
- **类型**：合规 / 数据
- **环境**：novel 模式（起点/番茄/晋江/阅文系投稿） + shortform 模式（公众号发布）
- **现象**：NovelForge 当前完全未覆盖合规风险检测——无敏感词库、无政治红线检测、无版权风险检测。产出的章节可能：① 投稿阶段即被平台拒签（番茄 2026-05 单月拒签 11.27 万本 AI 网文）；② 上线后被下架（番茄单月下架 4 万本）；③ 严重时账号被封（番茄处置 855 个 AI 账号）；④ 永久无缘重磅推荐位（起点 AI 内容永久无缘三江推荐）；⑤ 公众号文章被微信删除 / 封号。
- **根因**：
  1. NovelForge 现有 `check_consistency.py`（7 维状态漂移）+ `check_ai_novel.py`（10 + 朱雀 5 = 15 维 AI 味）均不覆盖合规风险；
  2. 无敏感词库 SSOT，无法检测政治 / 色情 / 暴力 / 版权风险词；
  3. 无平台规则感知，无法按起点 / 番茄 / 晋江 / 阅文系差异化检测（晋江色情暗示 P0、暴力极端 P0，其他平台 P1）；
  4. 无 novel / shortform 双模式分级，公众号合规要求（色情 / 暴力零容忍）未体现；
  5. 无 P0 阻断机制，合规违规内容可能直接落盘 published。
- **修复**：
  1. 新增 `scripts/novelforge/check_compliance.py` 合规检测主脚本，覆盖 5 维度（政治 / 色情 / 暴力 / 敏感词 / 版权）；
  2. 新增 `scripts/novelforge/data/sensitive_words/` 5 类敏感词库 JSON SSOT（political / sexual_explicit / violence_extreme / prohibited_platforms / copyright_risk），每类 ≥ 20 个种子词；
  3. 新增 `NovelForge_Vault/00_控制面/platform_compliance.md` 平台规则感知配置，含 4 平台规则对比表 + 模式选择 + 注入逻辑；
  4. 实现 4 平台 severity 覆盖（PLATFORM_SEVERITY_OVERRIDE）+ shortform 模式覆盖（SHORTFORM_SEVERITY_OVERRIDE）；
  5. 接入 M2 flag 协议，P0 问题时设置 `compliance_blocked_chNNN: true` flag，`save_state.py` 拒绝写入 published；
  6. 新增 `.trae/skills/compliance-guardian/SKILL.md` 合规守护 Skill；
  7. 修改 `.trae/skills/writer-polisher/SKILL.md`，阶段一注入 platform_compliance.md 必读，阶段二审计新增合规检测步骤，阶段三新增合规 P0 修复策略；
  8. 修改 `.trae/checklists/dev-checklist.md`，新增 §九 合规检测项。
- **涉及文件**：
  - `scripts/novelforge/check_compliance.py`（新增）
  - `scripts/novelforge/data/sensitive_words/political.json`（新增）
  - `scripts/novelforge/data/sensitive_words/sexual_explicit.json`（新增）
  - `scripts/novelforge/data/sensitive_words/violence_extreme.json`（新增）
  - `scripts/novelforge/data/sensitive_words/prohibited_platforms.json`（新增）
  - `scripts/novelforge/data/sensitive_words/copyright_risk.json`（新增）
  - `NovelForge_Vault/00_控制面/platform_compliance.md`（新增）
  - `.trae/skills/compliance-guardian/SKILL.md`（新增）
  - `.trae/skills/writer-polisher/SKILL.md`（修改：阶段一/二/三/输出格式）
  - `.trae/checklists/dev-checklist.md`（修改：新增 §九）
- **回归测试**：
  - `tests/test_compliance_check.py` 新增 8 个测试用例（见 §7.1）
- **教训/沉淀**：
  - 合规风险是平台投稿的硬性要求，必须在生成阶段即检测，不能依赖事后人工审核。
  - 5 维度合规检测（政治 / 色情 / 暴力 / 敏感词 / 版权）+ 4 平台规则感知 + 双模式分级是网文创作系统的必备能力。
  - 敏感词库必须 SSOT 化（JSON 文件），便于作者 / 编辑独立更新，无需改代码。
  - P0 阻断必须接入 flag 协议（M2），与一致性 / AI 味检测共用同一阻断机制，避免合规违规内容落盘 published。
  - shortform 模式（公众号）合规要求比 novel 模式更严（色情 / 暴力零容忍），双模式分级是必要的。
  - #lesson content_quality #lesson shortform
```

### 7.3 在 `check_compliance.py` 中新增的检测规则

| 维度名 | 检测函数 | severity | 触发条件 | type 前缀 |
|---|---|---|---|---|
| `political` | `political_check` | P0 | 全文出现任一政治敏感词 | `political_sensitive_word` |
| `sexual_explicit` | `sexual_explicit_check` | P0/P1 | explicit 命中 P0；suggestive novel P1 / shortform P0 / 晋江 P0 | `sexual_explicit_explicit` / `sexual_explicit_suggestive` |
| `violence` | `violence_check` | P0/P1/P2 | extreme novel P1 / shortform P0 / 晋江 P0；normal P2 / 晋江 P1 | `violence_extreme` / `violence_normal` |
| `sensitive_word` | `sensitive_word_check` | P2 | 竞品平台 / 违规推广 / 迷信词命中 | `sensitive_word_other` |
| `copyright_risk` | `copyright_risk_check` | P1 | 知名 IP / 角色 / 商标名命中 | `copyright_risk` |

### 7.4 完整测试集执行

修复完成后，按 `.trae/rules/dev-workflow.md` 第三步要求执行完整测试集：

```bash
# 一致性检测（不应受 M10 影响）
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault

# 合规检测（M10 新增）
python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform qidian --mode novel

# 去 AI 味检测（不应受 M10 影响）
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault

# pytest 全集（含新增 test_compliance_check.py）
pytest -q
```

所有命令退出码必须为 0（P1/P2 在 `check_compliance.py` 中不阻断退出码，但 pytest 必须全过）。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**高**。

**理由**：

- 合规是平台投稿的硬性要求，敏感词库需持续维护（平台规则变化、新敏感词出现）；若词库滞后，可能漏检导致内容被下架或封号。
- 政治敏感词库的边界难以把握：古代架空背景的「皇帝」「太子」不应误伤，但近现代政治人物必须严格检测；词库维护不当会导致误报或漏报。
- 色情 / 暴力分级依赖词库覆盖度，词库不全时可能漏检（如未收录的新露骨词、新虐杀方式）。
- 4 平台规则差异大（晋江最严），平台规则变化时需同步更新 `platform_compliance.md` 与 `PLATFORM_SEVERITY_OVERRIDE`。
- shortform 模式（公众号）合规要求最严，但公众号内容规范由微信动态调整，需持续跟踪。

### 8.2 对核心资产的影响

| 资产 | 影响 | 风险描述 |
|---|---|---|
| `scripts/novelforge/check_compliance.py` | **新增** | 独立脚本，无现有依赖。若函数实现有 bug（如词库加载失败、severity 覆盖错误），可能误报或漏报。 |
| `scripts/novelforge/data/sensitive_words/*.json` | **新增** | 5 类敏感词库 SSOT。若 JSON schema 不规范，会导致 `_load_sensitive_words_json` 解析失败回退 fallback，但 fallback 与 JSON 应保持一致。 |
| `NovelForge_Vault/00_控制面/platform_compliance.md` | **新增** | 平台规则感知配置。若与 `PLATFORM_SEVERITY_OVERRIDE` 不一致，会导致作者阅读的规则表与脚本执行的规则分叉。 |
| `.trae/skills/compliance-guardian/SKILL.md` | **新增** | 合规守护 Skill。若 Skill 内容与 `check_compliance.py` 行为不一致，会导致 Agent 引导与脚本执行分叉。 |
| `.trae/skills/writer-polisher/SKILL.md` | **修改** | 阶段一/二/三/输出格式多处修改。若修改不当，可能影响 writer-polisher 现有审计流程（一致性 + AI 味）。 |
| `.trae/checklists/dev-checklist.md` | **修改** | 新增 §九 合规检测项。影响范围小，仅作为提醒项。 |
| `tests/bug_regression_list.md` | **修改** | 新增 BUG-060。纯文档追加，无风险。 |

### 8.3 风险点清单

| # | 风险 | 触发条件 | 缓解措施 |
|---|---|---|---|
| R1 | 政治敏感词误报 | 古代架空背景出现「皇帝」「太子」等古称 | 古称不在词库；词库仅含近现代政治人物与事件 |
| R2 | 色情 / 暴力词库不全 | 词库未收录新出现的露骨词 / 虐杀方式 | 词库 SSOT 化，作者 / 编辑可独立更新；fallback 硬编码覆盖常见词 |
| R3 | 平台规则变化未同步 | 起点 / 番茄 / 晋江 / 阅文系更新合规指南 | `platform_compliance.md` 与 `PLATFORM_SEVERITY_OVERRIDE` 同步更新；定期人工 review |
| R4 | shortform 模式公众号规范变化 | 微信调整内容规范 | `SHORTFORM_SEVERITY_OVERRIDE` 与 `platform_compliance.md` §二 同步更新 |
| R5 | P0 阻断 flag 写入失败 | `.state/pipeline.json` 不存在或解析失败 | `set_compliance_blocked_flag` 返回 False，打 warning；不阻断检测流程，但作者需手动处理 |
| R6 | severity override 取较严导致误报 | 平台覆盖表与基础 severity 冲突时取较严 | `apply_severity_override` 仅在 override 比 base 严时覆盖，不反向放宽 |
| R7 | 5 类检测增加 CI 时长 | 全文扫描 + 词库匹配 | 5 类检测均为 O(n) 线性扫描，对 3000 字章节耗时 < 100ms，可忽略 |
| R8 | writer-polisher 修改影响现有审计流程 | 阶段二插入合规检测步骤打乱顺序 | 合规检测插入在一致性检测与 AI 味检测之间，独立步骤，不影响现有检测函数 |
| R9 | 词库 JSON 文件路径错误 | `SENSITIVE_WORDS_DIR_REL` 路径配置错误 | 启动时打 warning + fallback 硬编码；CI 中 `test_compliance_check.py` 验证词库加载 |
| R10 | M2 flag 协议未就绪 | M2 模块未完成，`pipeline.json` 无 `flags` 字段 | `set_compliance_blocked_flag` 容错处理（pipeline.json 不存在时返回 False）；M10 可独立于 M2 运行，仅 flag 写入降级 |

### 8.4 回滚方案

**回滚路径 1（最小回滚，仅回滚代码）**：

```bash
# 1. 切回主分支
git checkout master

# 2. 验证 check_compliance.py 不存在
ls scripts/novelforge/check_compliance.py
# 期望：No such file or directory

# 3. 验证 writer-polisher SKILL.md 无合规检测步骤
grep -c "check_compliance" .trae/skills/writer-polisher/SKILL.md
# 期望：0
```

**回滚路径 2（保留代码、仅关闭合规检测）**：

将 5 类敏感词库 JSON 的所有词列表设为空数组，使 5 类检测永不命中，但保留函数实现与 CLI 参数。适合「先上线代码、灰度验证后再启用」的场景。

```json
{
  "_meta": {...},
  "national_leaders": [],
  "political_events": [],
  "political_organizations": [],
  "political_slogans": [],
  "territorial_sovereignty": []
}
```

**回滚路径 3（分支隔离，推荐）**：

- 在 `feature/compliance-check` 分支开发，合并前完整跑测试集；
- 若合并后发现问题，`git revert <merge_commit>` 一键回滚；
- `scripts/novelforge/data/sensitive_words/` 词库与 `platform_compliance.md` 可独立更新，不依赖代码回滚；
- `.trae/skills/writer-polisher/SKILL.md` 的修改通过 git diff 可逐处核对，回滚时仅撤销相关行段（阶段一第 2.5 步、阶段二第 1.5 步、阶段三合规 P0 修复策略表、输出格式合规段）；
- `.trae/checklists/dev-checklist.md` 的 §九 可整段删除回滚；
- `tests/bug_regression_list.md` 的 BUG-060 可整段删除回滚。

### 8.5 数据备份

合并前必须备份以下数据：

```bash
# 1. 备份 .state/pipeline.json（M2 flag 协议注入字段）
cp NovelForge_Vault/.state/pipeline.json NovelForge_Vault/.state/pipeline.json.bak.$(date +%Y%m%d)

# 2. 备份 writer-polisher SKILL.md（多处修改）
cp .trae/skills/writer-polisher/SKILL.md .trae/skills/writer-polisher/SKILL.md.bak.$(date +%Y%m%d)

# 3. 备份 dev-checklist.md（新增 §九）
cp .trae/checklists/dev-checklist.md .trae/checklists/dev-checklist.md.bak.$(date +%Y%m%d)

# 4. 备份 bug_regression_list.md（新增 BUG-060）
cp tests/bug_regression_list.md tests/bug_regression_list.md.bak.$(date +%Y%m%d)
```

回滚时按相反顺序恢复备份。

### 8.6 监控与告警

M10 上线后建议监控以下指标（人工或脚本辅助）：

- **检测频次**：每章 `check_compliance.py` 必须运行（通过 `writer-polisher` SKILL 阶段二第 1.5 步强制执行）。
- **P0 阻断率**：若 P0 阻断率 > 5%，可能词库误报或生成质量下降，需 review 词库与 prompt。
- **平台规则变化跟踪**：每季度 review 一次起点 / 番茄 / 晋江 / 阅文系官方公告，同步更新 `platform_compliance.md` 与 `PLATFORM_SEVERITY_OVERRIDE`。
- **公众号规范跟踪**：每季度 review 微信公开课 / 微信派公告，同步更新 `SHORTFORM_SEVERITY_OVERRIDE`。
- **词库更新频次**：建议每月 review 一次 5 类词库，按平台反馈与新事件补充新词。

---

## 九、完成标准（DoD 清单）

### 9.1 代码与配置

- [ ] [`scripts/novelforge/check_compliance.py`](file:///workspace/scripts/novelforge/check_compliance.py) 脚本可运行：`python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform qidian --mode novel` 退出码 0 或 1（`--strict` 模式下 P0 时）
- [ ] [`NovelForge_Vault/00_控制面/platform_compliance.md`](file:///workspace/NovelForge_Vault/00_控制面/platform_compliance.md) 创建，含 4 平台规则对比表 + 模式选择 + 注入逻辑 + frontmatter 标记要求 + 修订历史
- [ ] 5 类敏感词库初始化（每类 ≥ 20 词）：
  - [ ] [`scripts/novelforge/data/sensitive_words/political.json`](file:///workspace/scripts/novelforge/data/sensitive_words/political.json) ≥ 20 词（5 分类：国家领导人 / 政治事件 / 政治组织 / 政治口号 / 领土主权）
  - [ ] [`scripts/novelforge/data/sensitive_words/sexual_explicit.json`](file:///workspace/scripts/novelforge/data/sensitive_words/sexual_explicit.json) ≥ 20 词（2 分类：explicit / suggestive）
  - [ ] [`scripts/novelforge/data/sensitive_words/violence_extreme.json`](file:///workspace/scripts/novelforge/data/sensitive_words/violence_extreme.json) ≥ 20 词（2 分类：extreme / normal）
  - [ ] [`scripts/novelforge/data/sensitive_words/prohibited_platforms.json`](file:///workspace/scripts/novelforge/data/sensitive_words/prohibited_platforms.json) ≥ 20 词（3 分类：竞品平台 / 违规推广 / 封建迷信）
  - [ ] [`scripts/novelforge/data/sensitive_words/copyright_risk.json`](file:///workspace/scripts/novelforge/data/sensitive_words/copyright_risk.json) ≥ 20 词（3 分类：IP 名 / 角色名 / 商标名）

### 9.2 Skill 与 Checklist

- [ ] [`.trae/skills/compliance-guardian/SKILL.md`](file:///workspace/.trae/skills/compliance-guardian/SKILL.md) 创建，含 frontmatter（name/description/version）+ 角色 + 触发条件 + 5 维度审计标准 + 平台规则感知 + 工作流 + 输出格式 + 反模式 + 错误处理 + 与其他 Skill 的关系 + 能力边界声明
- [ ] [`.trae/skills/writer-polisher/SKILL.md`](file:///workspace/.trae/skills/writer-polisher/SKILL.md) 注入平台规则（4 处修改）：
  - [ ] 阶段一写手第 2.5 步：必读 `platform_compliance.md`
  - [ ] 阶段二审计第 1.5 步：合规检测（5 维度 + 4 平台规则感知）
  - [ ] 阶段三精修：合规 P0 修复策略表
  - [ ] 输出格式：审计段新增合规检测行
- [ ] [`.trae/checklists/dev-checklist.md`](file:///workspace/.trae/checklists/dev-checklist.md) 新增 §九 合规检测项（含 9 项 checkbox + 自检报告模板段）

### 9.3 测试与回归

- [ ] [`tests/test_compliance_check.py`](file:///workspace/tests/test_compliance_check.py) 创建，8 个测试用例全部通过：
  - [ ] `test_political_check_detects_sensitive_words`
  - [ ] `test_sexual_explicit_check_grading`
  - [ ] `test_violence_check_grading`
  - [ ] `test_sensitive_word_check`
  - [ ] `test_copyright_risk_check`
  - [ ] `test_platform_qidian_rules`
  - [ ] `test_platform_fanqie_rules`
  - [ ] `test_shortform_mode_stricter`
- [ ] `pytest -q tests/test_compliance_check.py` 全部通过（8/8）
- [ ] `pytest -q` 全集通过（含现有测试 + 新增 test_compliance_check.py）
- [ ] [`tests/bug_regression_list.md`](file:///workspace/tests/bug_regression_list.md) 新增 BUG-060「合规风险检测完全缺失导致内容可能被下架或封号」

### 9.4 集成验证

- [ ] 集成测试 1 通过：`python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform qidian --mode novel` 输出含 5 维度检测结果
- [ ] 集成测试 2 通过：`python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform fanqie --mode shortform` 输出 `platform=fanqie mode=shortform`，shortform 模式 suggestive / extreme severity 为 P0
- [ ] 集成测试 3 通过：`python scripts/novelforge/check_compliance.py --vault NovelForge_Vault --platform jjwxc --mode novel` 输出 `platform=jjwxc`，晋江平台 suggestive 色情 / extreme 暴力 severity 为 P0
- [ ] 现有校验脚本不受影响：`python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 退出码与 M10 前一致
- [ ] 现有校验脚本不受影响：`python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 退出码与 M10 前一致

### 9.5 P0 阻断机制验证

- [ ] 构造含政治敏感词的章节样本，运行 `check_compliance.py --strict`，退出码 1
- [ ] 上述样本运行后，`.state/pipeline.json` 的 `flags.compliance_blocked_chNNN` 字段为 `true`
- [ ] 修复样本（删除政治敏感词）后重跑 `check_compliance.py`，`flags.compliance_blocked_chNNN` 字段自动清除为 `false`

### 9.6 文档与规范

- [ ] [`docs/optimization_plan_2026_07/M10_compliance_check.md`](file:///workspace/docs/optimization_plan_2026_07/M10_compliance_check.md) 本方案文档 9 个 section 填写完整
- [ ] 文档中所有路径引用使用 `file:///workspace/...` 格式
- [ ] 实现步骤可直接执行（含代码片段、命令、配置示例）
- [ ] 验证命令可直接复制运行
- [ ] DoD 清单可逐项打勾验证

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge 多专家团（合规风险检测系统设计）
**依赖模块**：无（独立模块，可与 L3 其他模块并行）
**下游模块**：M20（开发自检清单升级，汇总本模块的合规检测项）
**关联 Bug**：BUG-060（合规风险检测完全缺失导致内容可能被下架或封号）
**关联规则**：[`.trae/rules/dev-workflow.md`](file:///workspace/.trae/rules/dev-workflow.md) 第三步合并前必须清零所有校验问题；[`.trae/rules/bug-reporting.md`](file:///workspace/.trae/rules/bug-reporting.md) §四 何时必须记录
**核心资产影响**：新增 `scripts/novelforge/check_compliance.py` + 5 类敏感词库 + `platform_compliance.md` + `compliance-guardian` Skill；修改 `writer-polisher` SKILL.md（4 处）+ `dev-checklist.md`（新增 §九）+ `bug_regression_list.md`（新增 BUG-060）。不破坏现有核心资产（style_guide.md / check_consistency.py / check_ai_novel.py）。
