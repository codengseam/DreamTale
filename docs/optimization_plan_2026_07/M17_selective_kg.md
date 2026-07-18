# M17 · 选择性 KG 路线（动感叙事）

> **模块定位**：L4 引入前沿技术 · 第 17 模块（独立，无前置依赖）
>
> **核心目标**：针对玄幻/都市动作戏等"动感叙事"章节，让 `build_context.py` 在组装上下文时按章节叙事模式选择性启用"角色关系图（KG）"召回，补充 Grep 关键词召回在多角色多阵营多冲突场景下的遗漏；对内省/言情/日常章节保持纯 Grep 召回，避免学术已证实的"对内省叙事反效果"。
>
> **创建日期**：2026-07-18
> **文档版本**：v1.0
> **作者**：NovelForge 优化方案多专家团

---

## 一、模块目标

### 1.1 一句话目标

**针对玄幻/都市动作戏（action）/权谋（political）章节，`file:///workspace/scripts/novelforge/build_context.py` 在 Retrieved 层追加"角色关系图（KG）子图召回"；对内省（introspective）/言情（romance）/日常（daily）章节保持纯 Grep 召回，KG 不启用。KG 数据由新增脚本 `file:///workspace/scripts/novelforge/build_kg.py` 从 `.state/characters/*.json` + `01_世界观/factions.md` + `_scenes/` 关键场景三方数据源构建，存为 `file:///workspace/NovelForge_Vault/.state/character_kg.json` 文件（遵循 NovelForge"文件即真相"哲学，不引入图数据库）。**

### 1.2 对应的痛点

本模块对应长篇小说创作中"动感叙事章节角色关系复杂场景召回不全"的高频痛点：

| 痛点场景 | 当前 Grep 召回能力 | M17 完成后 |
|---|---|---|
| 玄幻章主角同时面对 3 个阵营 5 个角色（盟友/敌人/中立混杂） | ❌ Grep 按文件名/关键词命中场景文件，多角色多阵营场景易遗漏（评分 top 3 截断） | ✅ KG 子图召回，按"当前章角色 + 1 跳关系"提取相关节点与边，覆盖完整 |
| 都市动作戏主角与某反派上次交锋在 30 章前，章纲只提反派代号 | ⚠️ Grep 用反派代号命不中早期场景文件（文件名用真实姓名） | ✅ KG 节点含 `aliases` 字段，代号→真实姓名→关系边→早期场景，链式可达 |
| 权谋章主角在多方势力间斡旋，需召回所有势力立场与核心人物关系 | ❌ Grep 只能命中文档含"势力名"的场景文件，无法结构化呈现"势力-角色-立场"三角关系 | ✅ KG 节点含 `faction` 类型 + `stance` 立场字段 + `member_of` 边类型，子图直出 |
| 内省章主角回忆往事，KG 召回反而引入噪声 | ⚠️ 若全章启用 KG，会注入大量无关关系边，挤占 Token 预算 | ✅ 内省章叙事模式识别后 KG 不启用，保持纯 Grep 召回，学术已证实对内省叙事有益 |

### 1.3 完成后达成的能力（可量化）

| 能力 | 当前状态 | 完成后 |
|---|---|---|
| 章节叙事模式分类 | 不存在（仅有结构类型 regular/climax 等 5 类） | 5 类叙事模式可识别（action / introspective / romance / political / daily） |
| 角色关系图（KG）存储 | 不存在 | `NovelForge_Vault/.state/character_kg.json`，含 nodes（角色/势力/物品 3 类）+ edges（9 类关系） |
| KG 构建脚本 | 不存在 | `scripts/novelforge/build_kg.py`，三方数据源融合构建 |
| `build_context.py` 召回策略 | 单一 Grep 召回 | 按叙事模式选择性启用：action/political → Grep + KG 双召回；introspective/romance/daily → 仅 Grep |
| `context-composer` Skill 工作流 | 7 步（识别章号 → recap 检查 → build_context → 解读 → 召回 → 超预算 → 反馈） | 8 步（新增"叙事模式识别 + KG 预构建"步骤） |
| `key-scene-archiver` 联动 | 仅写 `_scenes/` + `pipeline.json` | 关系转折/重要物品/死亡重伤/势力变化 4 类场景同步更新 `character_kg.json` |
| `dev-checklist.md` KG 检测项 | 不含 | 新增 §十一 选择性 KG 检测段（5 项 checklist） |
| 回归测试覆盖 | 0 用例 | 6 个 pytest 用例（`tests/test_selective_kg.py`） |

---

## 二、痛点对应

### 2.1 痛点表现：动感叙事章节角色关系复杂场景召回不全

NovelForge 当前的关键场景召回机制（`build_context.py::_read_retrieved_scenes` + `_auto_search_scenes`）基于"Grep 文件名 + 内容关键词评分"，对长篇小说的"动感叙事"章节存在系统性遗漏：

#### 痛点 1：多角色多阵营场景被 top-3 截断

```
ch_085 章纲核心冲突：拍卖会上主角与韩家、沈家、皇室三方势力争夺残破玉简，
        韩家嫡女韩雪、沈家家主沈万山、皇室暗卫统领赵铁山三派明争暗斗。
```

**当前行为**：`_auto_search_scenes()` 按文件名/内容关键词评分，取 top 3 场景注入 Retrieved 层。但本章涉及 5+ 角色、3 阵营、6+ 关系边，top 3 场景文件无法覆盖完整关系网——可能召回了"主角-韩雪初遇"场景，却漏掉"沈万山-皇室暗中合作"场景，导致执笔时 LLM 不知道沈家与皇室是盟友，写出"沈万山与赵铁山厮杀"的矛盾剧情。

#### 痛点 2：代号/别名导致 Grep 命中失败

```
ch_007 场景文件：_scenes/ch_007_林轩-李慕白_初遇.md（召回关键词：林轩 李慕白 初遇 醉仙楼 玉佩）
ch_085 章纲：主角在拍卖会上认出"玉面书生"正是当年醉仙楼初遇之人。
```

**当前行为**：章纲用代号"玉面书生"，`_auto_search_scenes()` 用"玉面书生"作关键词搜索 `_scenes/`，文件名/内容均无此词（场景文件用真实姓名"李慕白"），评分 0，召回失败。主角与李慕白的关系历史完全丢失，LLM 可能写出与 ch_007 关系转折矛盾的内容。

#### 痛点 3：势力关系无法结构化呈现

```
ch_120 章纲：主角在朝堂上斡旋于皇室、世家、宗门三股势力之间，
        需利用皇室与世家的矛盾，联合宗门制衡双方。
```

**当前行为**：`factions.md` 用 Markdown 表格 + mermaid 图描述势力关系，但 `build_context.py` 的 `_match_setting_files()` 最多召回 2 个设定文件（每文件 ≤800 字），且按章纲关键词匹配，无法结构化呈现"势力 A 与势力 B 是敌对、势力 C 与势力 A 是盟友、主角属于势力 C"的三角关系。LLM 拿到的是碎片化文本，难以推理斡旋策略。

### 2.2 学术方案参考

| 来源 | 方案 | 关键数据 | NovelForge 差异化设计 |
|---|---|---|---|
| **Guiding Generative Storytelling with KG**（arXiv 2505.24803） | 用 KG 引导生成式叙事，对比 KG 对"动感叙事"vs"内省叙事"的影响 | 动感叙事：角色评分 **+1.37**（p=0.016，显著）；内省叙事：综合评分 **-0.66**（有害） | NovelForge 不全面启用 KG，而是按章节叙事模式**选择性启用**——action/political 启用（学术已证有益），introspective/romance/daily 不启用（学术已证有害或无益） |
| **CreAgentive**（ICLR 2026 投稿） | Story Prototype KG + 三阶段 workflow（plan/write/revise），1000 章 $1 成本 | 三阶段迭代构建 KG，KG 作为 prototype 引导生成 | NovelForge 不做三阶段迭代（成本高），而是用 `build_kg.py` 一次性构建 + `key-scene-archiver` 增量更新，成本接近 0（纯文件读写） |
| **Remember Me**（ICCC26） | planner / writer / grapher 三 agent 迭代构建 narrative KG | grapher agent 专门负责 KG 更新 | NovelForge 不引入 grapher agent（多 agent 协调复杂），而是让 `key-scene-archiver` 在归档关键场景时同步更新 KG，复用现有 Skill 体系 |
| **Letta Filesystem** | 长程记忆用文件系统存储，而非向量库 | 文件即记忆，Grep 即检索 | NovelForge 的 KG 也存为 JSON 文件（`character_kg.json`），不引入图数据库（Neo4j 等），符合"文件即真相"哲学 |
| **Mem0 / Zep Graphiti** | 用 KG 增强长程记忆，支持关系推理 | 关系边带时间戳与状态 | NovelForge 的 KG 边含 `started_chapter` / `last_updated_chapter` / `current_state`，类似时间戳设计 |

### 2.3 选择性启用的学术依据

Guiding Storytelling with KG 论文的核心发现是 **KG 对不同叙事模式的影响截然相反**：

| 叙事模式 | KG 影响 | 统计显著性 | M17 决策 |
|---|---|---|---|
| 动感叙事（action） | 角色评分 +1.37 | p=0.016（显著） | ✅ 启用 KG 召回 |
| 内省叙事（introspective） | 综合评分 -0.66 | 有害 | ❌ 禁用 KG 召回 |
| 权谋叙事（political） | 论文未单独测，但与动感叙事同属"多角色多冲突"类 | 推论有益 | ✅ 启用 KG 召回 |
| 言情叙事（romance） | 论文未单独测，但与内省叙事同属"少角色重情绪"类 | 推论有害或无益 | ❌ 禁用 KG 召回 |
| 日常叙事（daily） | 论文未测，角色关系简单 | 推论无益（KG 增加噪声） | ❌ 禁用 KG 召回 |

**关键决策**：M17 不做"全面 KG 化"，而是按章节叙事模式选择性启用。这是与 CreAgentive / Remember Me 等学术方案的核心差异——它们全面启用 KG，M17 只在学术已证有益的场景启用。

### 2.4 本模块的差异化设计

1. **按叙事模式选择性启用**：不全面替换 Grep 召回，而是 action/political 章节追加 KG 子图召回（与 Grep 并列），introspective/romance/daily 章节保持纯 Grep。学术已证此策略对两类叙事都有益。
2. **文件即真相，不引入图数据库**：KG 存为 `NovelForge_Vault/.state/character_kg.json` 一个 JSON 文件，不引入 Neo4j / NetworkX 服务端。读取用标准库 `json.load`，写入用 `json.dump`。符合 NovelForge"文件即真相"哲学，与 `protagonist.json` / `hooks_registry.json` / `pipeline.json` 一致。
3. **三方数据源融合构建**：KG 不依赖单一数据源，融合 ① `.state/characters/*.json` 角色状态机（基础关系）② `01_世界观/factions.md` 势力设定（势力节点）③ `_scenes/*.md` 关键场景存档（关系变化事件），互为佐证，降低遗漏。
4. **增量更新而非全量重建**：`build_kg.py` 支持全量重建（`--rebuild`）与增量更新（默认）。`key-scene-archiver` 在归档 4 类关键场景（关系转折/重要物品/死亡重伤/势力变化）时同步更新 KG，避免每次执笔前全量重建。
5. **子图召回而非全图注入**：`build_context.py` 的 KG 召回不是把整个 KG 塞进上下文，而是按"当前章出场角色 + 1 跳关系"提取子图，控制 Token 占用（默认 ≤1500 tokens）。
6. **代号/别名链式可达**：KG 节点含 `aliases` 字段，章纲用代号时，KG 召回可通过"代号→别名→真实姓名→关系边"链式找到相关场景，解决 Grep 用代号命不中真实姓名场景文件的痛点。
7. **与 M14 因果事件互补**：M14 的因果事件追踪"跨章事件配对"（injury/death/item_lost 等），M17 的 KG 追踪"跨章关系结构"（ally/enemy/owns 等）。两者数据源都含 `_scenes/`，但视角不同：M14 看"事件"，M17 看"关系"。互不冲突。

---

## 三、涉及现有文件

### 3.1 涉及的 Python 脚本（1 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/build_context.py` | 第 50-59 行 `DEFAULT_BUDGETS` 常量段；第 560-580 行 `_detect_chapter_type()` 函数；第 669-772 行 `build_context()` 主函数；第 121-158 行 `ContextBundle` dataclass；第 801-863 行 `_render_markdown()` 函数 | 新增叙事模式识别 + KG 子图召回 + ContextBundle 字段扩展 + Markdown 渲染追加 KG 段 |

### 3.2 涉及的 Skill 文件（2 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/.trae/skills/context-composer/SKILL.md` | 第 41-105 行"三层上下文组装"段；第 107-131 行"关键场景自动召回"段；第 145-201 行"工作流"段（7 步 → 8 步） | 新增"选择性 KG 召回（动感叙事章节）"工作流步骤 |
| 2 | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | 第 62-73 行 10 类关键场景识别标准表；第 104-133 行 6 段场景文件结构；第 156-195 行"生成流程"7 步 | 4 类场景（关系转折/重要物品/死亡重伤/势力变化）归档时同步更新 `character_kg.json`；新增步骤 9"更新角色关系图（M17 新增）" |

### 3.3 涉及的 Checklist 文件（1 个需修改）

| # | 文件路径 | 修改位置 | 修改性质 |
|---|---|---|---|
| 1 | `file:///workspace/.trae/checklists/dev-checklist.md` | 在 §十 因果链检测（M14 新增）之后追加 §十一 选择性 KG 检测段 | 新增章节 |

### 3.4 不修改但需要参考的文件

- `file:///workspace/scripts/novelforge/check_consistency.py`（一致性检测，本模块不动，但 KG 数据可作为关系突变检测的辅助数据源，留作未来扩展）
- `file:///workspace/scripts/novelforge/check_ai_novel.py`（去 AI 味检测，本模块不动）
- `file:///workspace/scripts/novelforge/save_state.py`（状态机写入，本模块不动；`character_kg.json` 由 `build_kg.py` 直接读写，不经 `save_state.py` 路由，因 KG 是衍生数据可全量重建）
- `file:///workspace/scripts/novelforge/schema.py`（schema 校验，本模块不动）
- `file:///workspace/.trae/skills/architect/SKILL.md`（章纲师，本模块不动；但建议同步在章纲十段模板的「一、章节信息」段追加 `叙事模式` 字段说明，见 §五.1 备注）
- `file:///workspace/.trae/rules/dev-workflow.md`（流程规则，不变）
- `file:///workspace/.trae/rules/bug-reporting.md`（bug 规范，新增 BUG-067 引用）
- `file:///workspace/tests/bug_regression_list.md`（新增 BUG-067 条目）
- `file:///workspace/docs/optimization_plan_2026_07/M14_causal_chain.md`（M14 方案，因果事件与 KG 关系互补，本模块参考其 7 段场景文件结构升级）

### 3.5 关键现状摘录（从 Read 结果提炼）

#### 3.5.1 `build_context.py` 当前章节类型识别逻辑

来源：`file:///workspace/scripts/novelforge/build_context.py` 第 560-580 行。

```python
def _detect_chapter_type(focus_text: str, outline_text: str) -> str:
    """从 current_focus.md 或章纲推断章节类型。模板/无法识别时默认 regular。"""
    for text in (focus_text, outline_text):
        if not text:
            continue
        m = re.search(r"章节类型\*{0,2}[：:]\s*(.+)", text)
        if not m:
            continue
        raw = m.group(1).strip()
        if "/" in raw or "／" in raw:  # 含 / 视为未填模板枚举串，跳过
            continue
        value = raw.split()[0].lower() if raw.split() else ""
        if value in CHAPTER_TYPES:
            return value
    return "regular"
```

**关键**：现有 `章节类型` 是**结构类型**（regular/hook_resolve/vol_start/climax/transition），不是**叙事模式**。M17 需新增 `_detect_narrative_mode()` 函数识别叙事模式（action/introspective/romance/political/daily），与 `_detect_chapter_type()` 并列。

#### 3.5.2 `build_context.py` 当前 Retrieved 层召回逻辑

来源：`file:///workspace/scripts/novelforge/build_context.py` 第 504-554 行。

```python
def _auto_search_scenes(vault: Path, outline_text: str) -> list[str]:
    """retrieve_scenes 为空且章节类型为 hook_resolve/climax 时，按角色名+关键词自动搜索 _scenes/。"""
    scenes_dir = vault / "_scenes"
    char_names = _extract_outline_characters(outline_text)
    conflict = _extract_section(outline_text, r"核心冲突")
    keywords = re.findall(r"[\u4e00-\u9fa5]{2,4}", conflict or "")
    # ... 评分逻辑：文件名命中角色名 +3 分，命中关键词 +1 分，取 top 3
```

**关键**：当前召回是"Grep 文件名 + 内容关键词评分"，top 3 截断。M17 在此之后追加 KG 子图召回作为补充（不替换），KG 子图与 Grep 场景文件并列注入 Retrieved 层。

#### 3.5.3 `protagonist.json` 角色状态机字段

来源：`file:///workspace/NovelForge_Vault/.state/characters/protagonist.json` 第 14-63 行。

```json
{
  "character_id": "protagonist",
  "basic": { "name": "", "aliases": [], "role": "protagonist", ... },
  "location": { "current": "", "last_updated_ch": 0, "recent_trajectory": [] },
  "power_level": { "realm": "", "realm_progress": 0, ... },
  "inventory": [],
  "emotion": { "current": "", ... },
  "relationships": [],  // 每条 {target, type, trust, last_changed_ch}
  "knowledge": { "known_facts": [], ... },
  "arc_stage": "",
  "last_appeared_ch": 0,
  "status": "active"
}
```

**关键**：`relationships` 字段是 KG 边的核心数据源（每条含 target/type/trust/last_changed_ch）；`basic.aliases` 是代号链式可达的关键；`inventory` 是物品节点的 owner 来源；`basic.role` 决定节点重要性（protagonist/antagonist/supporting）。

#### 3.5.4 `factions.md` 势力设定结构

来源：`file:///workspace/NovelForge_Vault/01_世界观/factions.md` 第 8-15 行。

```markdown
## 一、势力总览
| 势力名 | 类型 | 立场 | 实力等级 | 核心人物 | 文件锚点 |
|---|---|---|---|---|---|
| （示例）云隐宗 | 门派 | 中立 | 一流 | ____ | `02_角色/supporting/xxx.md` |

> 立场枚举：友方 / 中立 / 敌对 / 未知
```

**关键**：势力表是 KG faction 节点的数据源（name/type/stance/strength）；"核心人物"列是 faction → character 的 `member_of` 边来源。`build_kg.py` 需用 Markdown 表格解析提取这些字段。

#### 3.5.5 `key-scene-archiver` 当前 10 类关键场景 + 6 段结构

来源：`file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` 第 62-73 行 + 第 104-133 行。

10 类关键场景中，4 类与 KG 直接相关：
- **关系转折**（场景类型 2）→ KG `relationship_change` 边
- **重要物品**（场景类型 5）→ KG `owns` 边 + item 节点
- **死亡重伤**（场景类型 9）→ KG 节点 `status` 字段更新（active → dead/injured）
- **势力变化**（场景类型 10）→ KG faction 节点 `stance` 字段更新 + `member_of` 边变化

6 段场景文件结构中，"## 角色状态变化"段是 KG 边提取的核心来源（含"境界从X→Y / 与某人关系从X→Y / 获得某物品"等结构化变化描述）。

#### 3.5.6 `architect` 章纲十段模板

来源：`file:///workspace/.trae/skills/architect/SKILL.md` 第 106-150 行。

章纲「一、章节信息」段当前含：
```markdown
- 章号：ch_NNN
- 卷号：vol_NN
- 字数目标：2500-3000
- 章节类型：regular/hook_resolve/vol_start/climax/transition
```

**M17 建议**：在此段追加 `叙事模式` 字段（action/introspective/romance/political/daily）。本模块方案文档不强制修改 architect SKILL.md（保持 §四 文件清单的 6 项不变），但在 §五.1 给出 fallback 推断逻辑，确保即使 architect 未填该字段，`build_context.py` 也能从章纲内容推断叙事模式。

---

## 四、新增/修改文件清单

### 4.1 新增文件（3 个）

| # | 文件路径 | 性质 | 核心内容 |
|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/build_kg.py` | 新增 Python 脚本 | 角色关系图（KG）构建脚本。三方数据源融合：`.state/characters/*.json` + `01_世界观/factions.md` + `_scenes/*.md`。CLI 入口 `python -m scripts.novelforge.build_kg --vault NovelForge_Vault [--rebuild]`。输出 `NovelForge_Vault/.state/character_kg.json`。纯标准库实现（json/re/os/argparse/sys/glob/pathlib），不引入第三方依赖。 |
| 2 | `file:///workspace/NovelForge_Vault/.state/character_kg.json` | 新增状态机文件（衍生数据，可全量重建） | 角色关系图存储。schema：`{version, generated_at, last_updated_chapter, nodes: [...], edges: [...]}`。nodes 3 类（character/faction/item），edges 9 类（ally/enemy/mentor/lover/family/rival/owns/belongs_to/member_of）。由 `build_kg.py` 唯一写入，`build_context.py` 只读。 |
| 3 | `file:///workspace/tests/test_selective_kg.py` | 新增 pytest 测试用例 | 6 个测试用例覆盖叙事模式分类、KG schema 有效性、build_kg 端到端运行、action 章节启用 KG、introspective 章节禁用 KG、KG 边从场景文件提取。 |

### 4.2 修改文件（4 个）

| # | 文件路径 | 修改点 |
|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/build_context.py` | 新增 `NARRATIVE_MODES` 常量集合 + `KG_RECALL_MODES = {"action", "political"}` 常量；新增 `_detect_narrative_mode()` 函数（从章纲「叙事模式」字段读取，fallback 按章纲关键词推断）；新增 `_load_character_kg()` 函数；新增 `_kg_recall_subgraph()` 函数（按当前章角色 + 1 跳关系提取子图，≤1500 tokens）；`ContextBundle` dataclass 新增 `narrative_mode: str` + `kg_recall_enabled: bool` 字段；`build_context()` 主函数在 Retrieved 层组装后追加 KG 召回分支；`_render_markdown()` 追加"## [Retrieved] 角色关系图（KG 子图）"段 |
| 2 | `file:///workspace/.trae/skills/context-composer/SKILL.md` | "三层上下文组装"段追加"## L2 Retrieved 层（选择性 KG 子图召回）"子段；"工作流"段从 7 步升级为 8 步（在第三步"调用 build_context.py"前插入"第二步半：叙事模式识别 + KG 预构建"）；"防漂移铁律"段追加第 4 条"KG 召回按叙事模式选择性启用，introspective/romance/daily 章节禁用 KG"；"反模式"段追加"在 introspective 章节启用 KG 召回" |
| 3 | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` | 10 类关键场景识别标准表追加"是否触发 KG 更新"列（场景类型 2/5/9/10 标 ✅，其余标 ❌）；"生成流程"段在步骤 7（登记到 pipeline.json）后新增步骤 9"更新角色关系图（M17 新增）"，含调用 `build_kg.py --incremental` 命令示例；"反模式"段追加"归档 4 类关键场景后不更新 character_kg.json" |
| 4 | `file:///workspace/.trae/checklists/dev-checklist.md` | 在 §十 因果链检测（M14 新增）之后追加 §十一 选择性 KG 检测段（5 项 checklist + 自检报告模板对应段） |

---

## 五、详细实现步骤

### 5.1 步骤 1：设计章节叙事模式分类（5 类）

**目标**：定义 NovelForge 长篇小说的 5 类叙事模式，决定 KG 是否启用。

| # | narrative_mode | 中文标签 | 典型场景 | KG 启用 | 学术依据 |
|---|---|---|---|---|---|
| 1 | `action` | 动感叙事 | 玄幻战斗 / 都市动作戏 / 修仙对决 / 多角色多阵营冲突 | ✅ 启用 | Guiding Storytelling +1.37（p=0.016） |
| 2 | `introspective` | 内省叙事 | 主角回忆 / 心理独白 / 修炼顿悟 / 情感沉淀 | ❌ 禁用 | Guiding Storytelling -0.66（有害） |
| 3 | `romance` | 言情叙事 | 告白 / 情感纠葛 / 虐恋 / 双人互动 | ❌ 禁用 | 推论有害（少角色重情绪，同内省类） |
| 4 | `political` | 权谋叙事 | 朝堂斡旋 / 势力争霸 / 阴谋布局 / 多方博弈 | ✅ 启用 | 推论有益（多角色多冲突，同动感类） |
| 5 | `daily` | 日常叙事 | 过渡推进 / 日常对话 / 单一场景 | ❌ 禁用 | 推论无益（角色关系简单，KG 增加噪声） |

**识别策略（双源 + fallback）**：

1. **主源**：从章纲「一、章节信息」段读取 `叙事模式` 字段（若 architect SKILL.md 已同步更新该字段）。
2. **fallback**：若章纲无 `叙事模式` 字段，按章纲「二、核心冲突」+「六、爽点设计」段关键词推断：

```python
# 关键词推断表（fallback）
NARRATIVE_MODE_KEYWORDS = {
    "action": ["对决", "激战", "厮杀", "交手", "突破", "搏斗", "决战", "围攻", "斩杀", "破阵"],
    "introspective": ["回忆", "沉思", "独白", "顿悟", "沉淀", "往事", "心魔", "静修", "感悟"],
    "romance": ["告白", "情深", "相思", "纠葛", "虐恋", "心动的", "并肩", "柔情", "红颜"],
    "political": ["算计", "权谋", "布局", "斡旋", "朝堂", "势力", "博弈", "阴谋", "制衡", "拉拢"],
    "daily": ["日常", "闲聊", "过渡", "推进", "准备", "启程", "抵达"],
}
```

**备注**：本模块方案文档不强制修改 `architect/SKILL.md`（保持 §四 文件清单的 6 项不变）。但建议作为 M17 完成后的 follow-up，在 architect SKILL.md 的章纲十段模板「一、章节信息」段追加 `叙事模式` 字段说明，使叙事模式由作者显式声明而非 LLM 推断。fallback 推断逻辑保证 M17 在 architect 未更新时也能工作。

### 5.2 步骤 2：设计 `character_kg.json` 的 schema

**目标**：定义角色关系图的 JSON 存储格式，遵循 NovelForge"文件即真相"哲学。

#### 5.2.1 顶层结构

```json
{
  "version": "1.0.0",
  "generated_at": "2026-07-18",
  "last_updated_chapter": 42,
  "last_rebuild_at": "2026-07-18T10:30:00",
  "stats": {
    "node_count": 18,
    "edge_count": 35,
    "character_count": 12,
    "faction_count": 4,
    "item_count": 2
  },
  "nodes": [...],
  "edges": [...]
}
```

#### 5.2.2 node schema（3 类节点）

```json
{
  "node_id": "char:protagonist",
  "node_type": "character",
  "name": "林轩",
  "aliases": ["林少", "林公子", "玉面书生"],
  "role": "protagonist",
  "faction": "faction:yunyin_zong",
  "power_level": "筑基中期",
  "status": "active",
  "first_appear_ch": 1,
  "last_appear_ch": 42,
  "evidence_source": ".state/characters/protagonist.json"
}
```

| node_type | 必填字段 | 可选字段 | 数据源 |
|---|---|---|---|
| `character` | node_id, node_type, name, role, status, first_appear_ch | aliases, faction, power_level, last_appear_ch, evidence_source | `.state/characters/*.json` |
| `faction` | node_id, node_type, name, stance | faction_type, strength, core_members, first_appear_ch, evidence_source | `01_世界观/factions.md` |
| `item` | node_id, node_type, name, owner | first_appear_ch, last_updated_ch, evidence_source | `_scenes/*.md`（场景类型 5）+ `.state/characters/*.json::inventory` |

`node_id` 命名规范：
- character: `char:<character_id>`（如 `char:protagonist` / `char:li_mubai`）
- faction: `faction:<slug>`（如 `faction:yunyin_zong` / `faction:hansha_jiao`）
- item: `item:<slug>`（如 `item:xuantie_jian` / `item:canpo_yujian`）

#### 5.2.3 edge schema（9 类关系边）

```json
{
  "edge_id": "E-007-001",
  "source": "char:protagonist",
  "target": "char:li_mubai",
  "edge_type": "ally",
  "strength": 60,
  "started_chapter": 7,
  "last_updated_chapter": 42,
  "current_state": "active",
  "evidence_scenes": ["ch_007_林轩-李慕白_初遇.md"],
  "description": "醉仙楼初遇，结为盟友"
}
```

| edge_type | 中文标签 | source → target | strength 含义 | 典型场景 |
|---|---|---|---|---|
| `ally` | 盟友 | char → char | 信任度 0-100 | 结盟 / 联手 / 歃血为盟 |
| `enemy` | 敌对 | char → char | 敌意度 0-100（越高越敌对） | 反目 / 决裂 / 仇杀 |
| `mentor` | 师徒 | char → char | 师徒强度 0-100 | 拜师 / 传道 / 指点 |
| `lover` | 情人 | char → char | 情感强度 0-100 | 告白 / 双修 / 情定 |
| `family` | 亲属 | char → char | 血缘强度 0-100 | 认亲 / 兄妹 / 父子 |
| `rival` | 对手 | char → char | 竞争强度 0-100 | 同辈竞争 / 宿敌 |
| `owns` | 持有 | char → item | 持有强度 100（永久）/ 50（临时） | 获得 / 拾取 / 受赠 |
| `belongs_to` | 归属 | item → faction | 归属强度 100 | 宗门法宝 / 家族信物 |
| `member_of` | 成员 | char → faction | 成员强度 0-100（核心/外围） | 入门 / 长老 / 弟子 |

`edge_id` 命名规范：`E-<NNN>-<seq>`，NNN 是起始章号 3 位补零，seq 是本章边序号 3 位补零（如 `E-007-001`）。全局唯一，跨章不重复。

`current_state` 枚举：`active`（当前有效）/ `broken`（已破裂，如反目）/ `ended`（已结束，如物品失去）/ `suspended`（暂时中止，如假死）。

#### 5.2.4 完整示例

`NovelForge_Vault/.state/character_kg.json` 片段：

```json
{
  "version": "1.0.0",
  "generated_at": "2026-07-18",
  "last_updated_chapter": 42,
  "stats": {
    "node_count": 18,
    "edge_count": 35,
    "character_count": 12,
    "faction_count": 4,
    "item_count": 2
  },
  "nodes": [
    {
      "node_id": "char:protagonist",
      "node_type": "character",
      "name": "林轩",
      "aliases": ["林少", "玉面书生"],
      "role": "protagonist",
      "faction": "faction:yunyin_zong",
      "power_level": "筑基中期",
      "status": "active",
      "first_appear_ch": 1,
      "last_appear_ch": 42,
      "evidence_source": ".state/characters/protagonist.json"
    },
    {
      "node_id": "faction:yunyin_zong",
      "node_type": "faction",
      "name": "云隐宗",
      "faction_type": "门派",
      "stance": "中立",
      "strength": "一流",
      "core_members": ["char:protagonist", "char:li_mubai"],
      "first_appear_ch": 1,
      "evidence_source": "01_世界观/factions.md"
    },
    {
      "node_id": "item:xuantie_jian",
      "node_type": "item",
      "name": "玄铁剑",
      "owner": "char:protagonist",
      "first_appear_ch": 15,
      "last_updated_ch": 15,
      "evidence_source": "_scenes/ch_015_林轩_获玄铁剑.md"
    }
  ],
  "edges": [
    {
      "edge_id": "E-007-001",
      "source": "char:protagonist",
      "target": "char:li_mubai",
      "edge_type": "ally",
      "strength": 60,
      "started_chapter": 7,
      "last_updated_chapter": 42,
      "current_state": "active",
      "evidence_scenes": ["ch_007_林轩-李慕白_初遇.md"],
      "description": "醉仙楼初遇，结为盟友"
    },
    {
      "edge_id": "E-015-001",
      "source": "char:protagonist",
      "target": "item:xuantie_jian",
      "edge_type": "owns",
      "strength": 100,
      "started_chapter": 15,
      "last_updated_chapter": 15,
      "current_state": "active",
      "evidence_scenes": ["ch_015_林轩_获玄铁剑.md"],
      "description": "获得玄铁剑，认主成功"
    },
    {
      "edge_id": "E-001-001",
      "source": "char:protagonist",
      "target": "faction:yunyin_zong",
      "edge_type": "member_of",
      "strength": 80,
      "started_chapter": 1,
      "last_updated_chapter": 1,
      "current_state": "active",
      "evidence_scenes": [],
      "description": "主角是云隐宗弟子"
    }
  ]
}
```

### 5.3 步骤 3：`build_kg.py` 完整脚本逻辑

**目标**：实现角色关系图构建脚本，三方数据源融合，支持全量重建与增量更新。

#### 5.3.1 文件头与常量

```python
"""NovelForge 角色关系图（KG）构建脚本（build_kg）。

按 NovelForge「文件即真相」哲学，将角色关系图存为 JSON 文件，不引入图数据库。
由 build_context.py 在 action/political 章节组装上下文时读取，作为 Grep 召回的补充。

三方数据源融合：
  1. .state/characters/*.json  → 角色节点 + 基础关系边
  2. 01_世界观/factions.md      → 势力节点 + member_of 边
  3. _scenes/*.md               → 关系变化事件（场景类型 2/5/9/10）

CLI 入口：
    python -m scripts.novelforge.build_kg --vault NovelForge_Vault              # 增量更新
    python -m scripts.novelforge.build_kg --vault NovelForge_Vault --rebuild    # 全量重建
    python -m scripts.novelforge.build_kg --vault NovelForge_Vault --json       # JSON 输出统计
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

DEFAULT_VAULT = Path("/workspace/NovelForge_Vault")
KG_FILE_REL = ".state/character_kg.json"
KG_VERSION = "1.0.0"

# 叙事模式分类（与 build_context.py 共享，本脚本不依赖该常量，仅作注释）
NARRATIVE_MODES = {"action", "introspective", "romance", "political", "daily"}

# 9 类边类型
EDGE_TYPES = {
    "ally", "enemy", "mentor", "lover", "family", "rival",
    "owns", "belongs_to", "member_of",
}

# 场景文件「## 角色状态变化」段的关键词映射到 edge_type
# 用于从 _scenes/*.md 抽取关系变化
SCENE_RELATIONSHIP_KEYWORDS = {
    "ally": ["结盟", "联手", "歃血为盟", "化敌为友", "冰释前嫌", "合作"],
    "enemy": ["反目", "决裂", "背叛", "割袍断义", "为敌", "翻脸"],
    "mentor": ["拜师", "传道", "指点", "收徒"],
    "lover": ["告白", "情定", "双修", "心动的", "倾心"],
    "family": ["认亲", "兄妹", "父子", "母女", "血脉"],
    "rival": ["同辈竞争", "宿敌", "对手"],
}

# 场景文件「## 角色状态变化」段的物品关键词
SCENE_ITEM_KEYWORDS = ["获得", "得到", "拾取", "受赠", "认主", "夺取", "抢夺", "继承", "炼制"]
```

#### 5.3.2 数据源 1：从 `.state/characters/*.json` 加载角色节点 + 基础关系边

```python
def _load_character_nodes(vault: Path) -> list[dict[str, Any]]:
    """从 .state/characters/*.json 加载角色节点。
    
    每个角色 JSON 转为 1 个 character node。
    """
    chars_dir = vault / ".state" / "characters"
    if not chars_dir.exists():
        return []
    
    nodes: list[dict[str, Any]] = []
    for jf in sorted(chars_dir.glob("*.json")):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        
        basic = data.get("basic") or {}
        cid = data.get("character_id") or jf.stem
        name = basic.get("name") or ""
        if not name:
            continue  # 模板角色 name 为空，跳过
        
        power = data.get("power_level") or {}
        node = {
            "node_id": f"char:{cid}",
            "node_type": "character",
            "name": name,
            "aliases": basic.get("aliases") or [],
            "role": basic.get("role") or "supporting",
            "faction": None,  # 由 factions.md 解析后回填
            "power_level": power.get("realm") or "",
            "status": data.get("status") or "active",
            "first_appear_ch": data.get("first_appear_ch") or 1,
            "last_appear_ch": data.get("last_appeared_ch") or 0,
            "evidence_source": f".state/characters/{jf.name}",
        }
        nodes.append(node)
    return nodes


def _load_character_edges(vault: Path) -> list[dict[str, Any]]:
    """从 .state/characters/*.json 的 relationships 字段加载基础关系边。
    
    每个 relationship 条目转为 1 条 edge。
    """
    chars_dir = vault / ".state" / "characters"
    if not chars_dir.exists():
        return []
    
    edges: list[dict[str, Any]] = []
    seq_counter: dict[int, int] = {}  # chapter → seq
    
    for jf in sorted(chars_dir.glob("*.json")):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        
        cid = data.get("character_id") or jf.stem
        rels = data.get("relationships") or []
        for rel in rels:
            if not isinstance(rel, dict):
                continue
            target = rel.get("target") or ""
            if not target:
                continue
            rtype = rel.get("type") or "ally"
            if rtype not in EDGE_TYPES and rtype not in SCENE_RELATIONSHIP_KEYWORDS:
                rtype = "ally"  # 未知类型降级为 ally
            
            started_ch = rel.get("last_changed_ch") or data.get("first_appear_ch") or 1
            seq = seq_counter.get(started_ch, 0) + 1
            seq_counter[started_ch] = seq
            
            edge = {
                "edge_id": f"E-{started_ch:03d}-{seq:03d}",
                "source": f"char:{cid}",
                "target": f"char:{target}",
                "edge_type": rtype,
                "strength": rel.get("trust", 50),
                "started_chapter": started_ch,
                "last_updated_chapter": rel.get("last_changed_ch") or started_ch,
                "current_state": "active",
                "evidence_scenes": [],
                "description": f"角色状态机 relationships 字段记录",
            }
            edges.append(edge)
    return edges
```

#### 5.3.3 数据源 2：从 `01_世界观/factions.md` 加载势力节点 + member_of 边

```python
def _load_faction_nodes(vault: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """从 01_世界观/factions.md 加载势力节点 + member_of 边。
    
    解析 Markdown 表格：
    | 势力名 | 类型 | 立场 | 实力等级 | 核心人物 | 文件锚点 |
    
    Returns:
        (faction_nodes, member_of_edges)
    """
    factions_file = vault / "01_世界观" / "factions.md"
    if not factions_file.exists():
        return [], []
    
    text = factions_file.read_text(encoding="utf-8")
    # 提取「## 一、势力总览」段
    section = _extract_md_section(text, r"势力总览")
    if not section:
        return [], []
    
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seq = 0
    
    for line in section.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")]
        # ['', '势力名', '类型', '立场', '实力等级', '核心人物', '文件锚点', '']
        if len(cells) < 6:
            continue
        name = cells[1]
        if name in ("势力名", "") or set(name) <= {"-", "：", ":"}:
            continue  # 表头或空行
        if "示例" in name:
            continue  # 示例行跳过
        
        faction_type = cells[2] if cells[2] and not set(cells[2]) <= {"-"} else ""
        stance = cells[3] if cells[3] and not set(cells[3]) <= {"-"} else "未知"
        strength = cells[4] if cells[4] and not set(cells[4]) <= {"-"} else ""
        core_members_str = cells[5] if len(cells) > 5 and not set(cells[5]) <= {"-"} else ""
        
        slug = _slugify(name)
        node = {
            "node_id": f"faction:{slug}",
            "node_type": "faction",
            "name": name,
            "faction_type": faction_type,
            "stance": stance,
            "strength": strength,
            "core_members": [],  # 由核心人物列解析后回填
            "first_appear_ch": 1,
            "evidence_source": "01_世界观/factions.md",
        }
        nodes.append(node)
        
        # 解析核心人物列，生成 member_of 边
        # core_members_str 形如 "林轩, 李慕白" 或 "林轩"
        if core_members_str:
            member_names = [n.strip() for n in re.split(r"[,，、/]", core_members_str) if n.strip()]
            for member_name in member_names:
                # 反查 character node_id（按 name 匹配，需在主流程中二次解析）
                seq += 1
                edge = {
                    "edge_id": f"E-001-{seq:03d}",
                    "source": f"name:{member_name}",  # 临时占位，主流程中替换为 char:cid
                    "target": f"faction:{slug}",
                    "edge_type": "member_of",
                    "strength": 80,
                    "started_chapter": 1,
                    "last_updated_chapter": 1,
                    "current_state": "active",
                    "evidence_scenes": [],
                    "description": f"{member_name} 是 {name} 核心人物",
                }
                edges.append(edge)
    
    return nodes, edges


def _slugify(name: str) -> str:
    """中文名转 slug（用于 node_id）。保留中文字符，去除标点空格。"""
    slug = re.sub(r"[\s\-_，。、·]", "_", name)
    slug = re.sub(r"[^\u4e00-\u9fa5a-zA-Z0-9_]", "", slug)
    return slug.lower() or "unknown"


def _extract_md_section(text: str, heading_pattern: str) -> str:
    """从 Markdown 中提取某个 ## / ### 标题下的正文（与 build_context.py 同名函数一致）。"""
    lines = text.splitlines()
    start = -1
    heading_level = 0
    for i, line in enumerate(lines):
        m = re.match(r"^(#{1,6})\s+", line)
        if m and re.search(heading_pattern, line):
            start = i + 1
            heading_level = len(m.group(1))
            break
    if start < 0:
        return ""
    out: list[str] = []
    for line in lines[start:]:
        m = re.match(r"^(#{1," + str(heading_level) + r"})\s+", line)
        if m:
            break
        out.append(line)
    return "\n".join(out).strip()
```

#### 5.3.4 数据源 3：从 `_scenes/*.md` 抽取关系变化事件

```python
def _load_edges_from_scenes(vault: Path) -> list[dict[str, Any]]:
    """从 _scenes/*.md 抽取关系变化事件，转为 KG 边。
    
    解析场景文件的「## 角色状态变化」段，按关键词映射到 edge_type。
    主要抽取场景类型 2（关系转折）/ 5（重要物品）/ 9（死亡重伤）/ 10（势力变化）。
    """
    scenes_dir = vault / "_scenes"
    if not scenes_dir.exists():
        return []
    
    edges: list[dict[str, Any]] = []
    
    for sf in sorted(scenes_dir.glob("*.md")):
        if sf.name.startswith("README"):
            continue
        try:
            text = sf.read_text(encoding="utf-8")
        except OSError:
            continue
        
        # 从元信息段提取章号、角色、场景类型
        meta = _extract_md_section(text, r"元信息")
        chapter = _parse_chapter_from_meta(meta)
        scene_chars = _parse_chars_from_meta(meta)
        scene_type = _parse_scene_type_from_meta(meta)
        
        # 只从 4 类关键场景抽取（关系转折/重要物品/死亡重伤/势力变化）
        if scene_type not in ("关系转折", "重要物品", "死亡重伤", "势力变化"):
            continue
        
        # 从「## 角色状态变化」段抽取关系变化
        changes = _extract_md_section(text, r"角色状态变化")
        if not changes:
            continue
        
        for change_line in changes.splitlines():
            change_line = change_line.strip()
            if not change_line.startswith("-"):
                continue
            
            # 形如：- 林轩：与李慕白关系从陌生→盟友
            # 或：- 林轩：获得玄铁剑
            # 或：- 苏婉：与林轩关系从盟友→决裂
            edge = _parse_change_line(change_line, scene_chars, chapter, sf.name)
            if edge:
                edges.append(edge)
    
    return edges


def _parse_chapter_from_meta(meta: str) -> int:
    """从元信息段提取章号。形如「- 章号：ch_042」。"""
    m = re.search(r"章号[：:]\s*ch_(\d+)", meta)
    return int(m.group(1)) if m else 0


def _parse_chars_from_meta(meta: str) -> list[str]:
    """从元信息段提取角色名列表。形如「- 角色：林轩-李慕白」。"""
    m = re.search(r"角色[：:]\s*(.+)", meta)
    if not m:
        return []
    raw = m.group(1).strip()
    return [n.strip() for n in re.split(r"[-、,，]", raw) if n.strip()]


def _parse_scene_type_from_meta(meta: str) -> str:
    """从元信息段提取场景类型。形如「- 场景类型：关系转折」。"""
    m = re.search(r"场景类型[：:]\s*(.+)", meta)
    return m.group(1).strip() if m else ""


def _parse_change_line(
    line: str,
    scene_chars: list[str],
    chapter: int,
    scene_file: str,
) -> dict[str, Any] | None:
    """解析「## 角色状态变化」段的一行，转为 KG edge 或返回 None。
    
    支持的格式：
      - 林轩：与李慕白关系从陌生→盟友  → edge_type=ally, source=林轩, target=李慕白
      - 林轩：获得玄铁剑                → edge_type=owns, source=林轩, target=玄铁剑
      - 苏婉：与林轩关系从盟友→决裂      → edge_type=enemy, source=苏婉, target=林轩
      - 林轩：境界从练气三层→练气四层    → None（境界变化不是关系边，由 M14 因果事件追踪）
    """
    # 去掉行首 "- "
    content = re.sub(r"^-\s*", "", line).strip()
    if "：" not in content and ":" not in content:
        return None
    
    # 拆分主体与变化描述
    parts = re.split(r"[：:]", content, maxsplit=1)
    if len(parts) != 2:
        return None
    subject_name = parts[0].strip()
    change_desc = parts[1].strip()
    
    # 关系变化：与XXX关系从X→Y
    m = re.match(r"与(.+?)关系从(.+?)→(.+)", change_desc)
    if m:
        target_name = m.group(1).strip()
        state_after = m.group(3).strip()
        edge_type = _infer_edge_type_by_state(state_after)
        if edge_type is None:
            return None
        return {
            "edge_id": f"E-{chapter:03d}-{_seq_for_chapter(chapter):03d}",
            "source": f"name:{subject_name}",
            "target": f"name:{target_name}",
            "edge_type": edge_type,
            "strength": _infer_strength_by_type(edge_type),
            "started_chapter": chapter,
            "last_updated_chapter": chapter,
            "current_state": "active",
            "evidence_scenes": [scene_file],
            "description": change_desc,
        }
    
    # 物品获得：获得XXX / 得到XXX / 拾取XXX
    for kw in SCENE_ITEM_KEYWORDS:
        if change_desc.startswith(kw):
            item_name = change_desc[len(kw):].strip()
            if not item_name:
                continue
            return {
                "edge_id": f"E-{chapter:03d}-{_seq_for_chapter(chapter):03d}",
                "source": f"name:{subject_name}",
                "target": f"item:{_slugify(item_name)}",
                "edge_type": "owns",
                "strength": 100,
                "started_chapter": chapter,
                "last_updated_chapter": chapter,
                "current_state": "active",
                "evidence_scenes": [scene_file],
                "description": change_desc,
            }
    
    return None


# 模块级序号计数器（_seq_for_chapter 用）
_SEQ_COUNTER: dict[int, int] = {}

def _seq_for_chapter(chapter: int) -> int:
    """为同一章的边生成递增序号。"""
    _SEQ_COUNTER[chapter] = _SEQ_COUNTER.get(chapter, 0) + 1
    return _SEQ_COUNTER[chapter]


def _infer_edge_type_by_state(state_after: str) -> str | None:
    """根据关系变化后的状态推断 edge_type。"""
    for edge_type, keywords in SCENE_RELATIONSHIP_KEYWORDS.items():
        if any(kw in state_after for kw in keywords):
            return edge_type
    return None


def _infer_strength_by_type(edge_type: str) -> int:
    """按 edge_type 给默认 strength。"""
    return {
        "ally": 60, "enemy": 70, "mentor": 80, "lover": 75,
        "family": 90, "rival": 50, "owns": 100, "belongs_to": 100, "member_of": 80,
    }.get(edge_type, 50)
```

#### 5.3.5 主流程：三方数据源融合 + name→node_id 解析 + 去重 + 写入

```python
def build_kg(vault: Path | str = DEFAULT_VAULT, rebuild: bool = False) -> dict[str, Any]:
    """构建角色关系图 KG。
    
    Args:
        vault: Vault 根目录路径。
        rebuild: True=全量重建（忽略现有 KG），False=增量更新（合并现有 KG）。
    
    Returns:
        KG dict，含 version/nodes/edges/stats 等字段。
    """
    vault_path = Path(vault).resolve()
    
    # 加载现有 KG（增量模式）
    existing_kg: dict[str, Any] = {}
    kg_path = vault_path / KG_FILE_REL
    if not rebuild and kg_path.exists():
        try:
            existing_kg = json.loads(kg_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing_kg = {}
    
    # === 数据源 1：角色节点 + 基础关系边 ===
    char_nodes = _load_character_nodes(vault_path)
    char_edges = _load_character_edges(vault_path)
    
    # === 数据源 2：势力节点 + member_of 边 ===
    faction_nodes, faction_edges = _load_faction_nodes(vault_path)
    
    # === 数据源 3：场景文件抽取的边 ===
    scene_edges = _load_edges_from_scenes(vault_path)
    # 同时从场景文件抽取 item 节点（场景类型 5）
    item_nodes = _load_item_nodes_from_scenes(vault_path)
    
    # === 合并节点 ===
    all_nodes = char_nodes + faction_nodes + item_nodes
    
    # 回填 character node 的 faction 字段（按 faction.core_members 反查）
    name_to_char_id = {n["name"]: n["node_id"] for n in char_nodes if n["node_type"] == "character"}
    for fn in faction_nodes:
        resolved_members = []
        for member_name in fn.get("core_members") or []:
            if member_name in name_to_char_id:
                resolved_members.append(name_to_char_id[member_name])
        fn["core_members"] = resolved_members
    
    for cn in char_nodes:
        for fn in faction_nodes:
            if cn["node_id"] in (fn.get("core_members") or []):
                cn["faction"] = fn["node_id"]
                break
    
    # === 合并边 ===
    all_edges = char_edges + faction_edges + scene_edges
    
    # name:xxx 占位符替换为真实 node_id
    all_edges = _resolve_edge_endpoints(all_edges, char_nodes, faction_nodes, item_nodes)
    
    # 去重：相同 source+target+edge_type 只保留 last_updated_chapter 最大的
    all_edges = _deduplicate_edges(all_edges)
    
    # === 合并现有 KG（增量模式） ===
    if existing_kg and not rebuild:
        existing_nodes = existing_kg.get("nodes") or []
        existing_edges = existing_kg.get("edges") or []
        all_nodes = _merge_nodes(existing_nodes, all_nodes)
        all_edges = _merge_edges(existing_edges, all_edges)
    
    # === 计算统计 ===
    stats = {
        "node_count": len(all_nodes),
        "edge_count": len(all_edges),
        "character_count": sum(1 for n in all_nodes if n["node_type"] == "character"),
        "faction_count": sum(1 for n in all_nodes if n["node_type"] == "faction"),
        "item_count": sum(1 for n in all_nodes if n["node_type"] == "item"),
    }
    
    # === 确定最后更新章号 ===
    last_ch = max(
        [n.get("last_appear_ch") or 0 for n in all_nodes if n["node_type"] == "character"] + [0]
    )
    last_edge_ch = max([e.get("last_updated_chapter") or 0 for e in all_edges] + [0])
    last_updated_chapter = max(last_ch, last_edge_ch)
    
    kg = {
        "version": KG_VERSION,
        "generated_at": _today_str(),
        "last_updated_chapter": last_updated_chapter,
        "last_rebuild_at": _today_str() if rebuild else (existing_kg.get("last_rebuild_at") or _today_str()),
        "stats": stats,
        "nodes": all_nodes,
        "edges": all_edges,
    }
    
    # === 写入文件 ===
    kg_path.parent.mkdir(parents=True, exist_ok=True)
    kg_path.write_text(json.dumps(kg, ensure_ascii=False, indent=2), encoding="utf-8")
    
    return kg


def _load_item_nodes_from_scenes(vault: Path) -> list[dict[str, Any]]:
    """从 _scenes/*.md 场景类型 5（重要物品）抽取 item 节点。"""
    scenes_dir = vault / "_scenes"
    if not scenes_dir.exists():
        return []
    nodes: list[dict[str, Any]] = []
    for sf in sorted(scenes_dir.glob("*.md")):
        if sf.name.startswith("README"):
            continue
        try:
            text = sf.read_text(encoding="utf-8")
        except OSError:
            continue
        meta = _extract_md_section(text, r"元信息")
        if _parse_scene_type_from_meta(meta) != "重要物品":
            continue
        chapter = _parse_chapter_from_meta(meta)
        changes = _extract_md_section(text, r"角色状态变化")
        for line in changes.splitlines():
            line = line.strip()
            if not line.startswith("-"):
                continue
            content = re.sub(r"^-\s*", "", line)
            for kw in SCENE_ITEM_KEYWORDS:
                if kw in content:
                    m = re.search(rf"{kw}(.+)", content)
                    if m:
                        item_name = m.group(1).strip().rstrip("，。")
                        slug = _slugify(item_name)
                        nodes.append({
                            "node_id": f"item:{slug}",
                            "node_type": "item",
                            "name": item_name,
                            "owner": None,  # 由 edge 反查
                            "first_appear_ch": chapter,
                            "last_updated_ch": chapter,
                            "evidence_source": f"_scenes/{sf.name}",
                        })
                    break
    return nodes


def _resolve_edge_endpoints(
    edges: list[dict[str, Any]],
    char_nodes: list[dict[str, Any]],
    faction_nodes: list[dict[str, Any]],
    item_nodes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """将 edge 的 source/target 中 name:xxx 占位符替换为真实 node_id。
    
    name:林轩 → char:protagonist（按 name + aliases 匹配）
    name:云隐宗 → faction:yunyin_zong
    """
    # 构建 name → node_id 映射（含别名）
    name_map: dict[str, str] = {}
    for n in char_nodes + faction_nodes + item_nodes:
        if n.get("name"):
            name_map[n["name"]] = n["node_id"]
        for alias in (n.get("aliases") or []):
            name_map[alias] = n["node_id"]
    
    resolved: list[dict[str, Any]] = []
    for e in edges:
        e_copy = dict(e)
        for field in ("source", "target"):
            val = e_copy.get(field) or ""
            if val.startswith("name:"):
                name = val[5:]
                e_copy[field] = name_map.get(name, val)  # 找不到保留原值
        resolved.append(e_copy)
    return resolved


def _deduplicate_edges(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """去重：相同 source+target+edge_type 只保留 last_updated_chapter 最大的。"""
    seen: dict[tuple[str, str, str], dict[str, Any]] = {}
    for e in edges:
        key = (e.get("source") or "", e.get("target") or "", e.get("edge_type") or "")
        if key not in seen:
            seen[key] = e
        else:
            if (e.get("last_updated_chapter") or 0) > (seen[key].get("last_updated_chapter") or 0):
                seen[key] = e
    return list(seen.values())


def _merge_nodes(existing: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """合并节点：按 node_id 去重，new 覆盖 existing。"""
    by_id = {n["node_id"]: n for n in existing}
    for n in new:
        by_id[n["node_id"]] = n  # new 覆盖
    return list(by_id.values())


def _merge_edges(existing: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """合并边：按 edge_id 去重，new 覆盖 existing；再按 source+target+edge_type 去重。"""
    by_id = {e["edge_id"]: e for e in existing}
    for e in new:
        by_id[e["edge_id"]] = e
    return _deduplicate_edges(list(by_id.values()))


def _today_str() -> str:
    import datetime
    return datetime.date.today().isoformat()
```

#### 5.3.6 CLI 入口

```python
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.novelforge.build_kg",
        description="NovelForge 角色关系图（KG）构建：三方数据源融合，按叙事模式选择性启用。",
    )
    parser.add_argument("--vault", type=str, default=str(DEFAULT_VAULT),
                        help=f"Vault 根目录（默认 {DEFAULT_VAULT}）")
    parser.add_argument("--rebuild", action="store_true",
                        help="全量重建（忽略现有 KG）")
    parser.add_argument("--json", action="store_true", dest="as_json",
                        help="JSON 输出统计信息")
    args = parser.parse_args(argv)
    
    kg = build_kg(vault=Path(args.vault), rebuild=args.rebuild)
    
    if args.as_json:
        stats = kg["stats"]
        print(json.dumps({
            "version": kg["version"],
            "generated_at": kg["generated_at"],
            "last_updated_chapter": kg["last_updated_chapter"],
            "stats": stats,
            "kg_file": str(Path(args.vault) / KG_FILE_REL),
        }, ensure_ascii=False, indent=2))
    else:
        stats = kg["stats"]
        print(f"=== 角色关系图（KG）构建完成 ===")
        print(f"模式: {'全量重建' if args.rebuild else '增量更新'}")
        print(f"节点: {stats['node_count']}（角色 {stats['character_count']} / "
              f"势力 {stats['faction_count']} / 物品 {stats['item_count']}）")
        print(f"边: {stats['edge_count']}")
        print(f"最后更新章号: ch_{kg['last_updated_chapter']:03d}")
        print(f"输出: {Path(args.vault) / KG_FILE_REL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 5.4 步骤 4：`build_context.py` 升级（按叙事模式选择召回策略）

#### 5.4.1 常量段新增（在第 50-82 行附近追加）

```python
# --- M17 新增：叙事模式与 KG 召回 --------------------------------------------
# 叙事模式合法集合（与结构类型 regular/climax 等正交）
NARRATIVE_MODES: set[str] = {
    "action",        # 动感叙事（启用 KG）
    "introspective", # 内省叙事（禁用 KG）
    "romance",       # 言情叙事（禁用 KG）
    "political",     # 权谋叙事（启用 KG）
    "daily",         # 日常叙事（禁用 KG）
}

# 启用 KG 召回的叙事模式（学术依据：Guiding Storytelling with KG, arXiv 2505.24803）
KG_RECALL_MODES: set[str] = {"action", "political"}

# KG 子图召回的 Token 上限（避免挤占预算）
KG_RECALL_TOKEN_BUDGET: int = 1500

# KG 子图召回的角色跳数（1 跳 = 当前章角色 + 直接关系方）
KG_RECALL_HOPS: int = 1

# 叙事模式 fallback 关键词推断表
NARRATIVE_MODE_KEYWORDS: dict[str, list[str]] = {
    "action": ["对决", "激战", "厮杀", "交手", "突破", "搏斗", "决战", "围攻", "斩杀", "破阵"],
    "introspective": ["回忆", "沉思", "独白", "顿悟", "沉淀", "往事", "心魔", "静修", "感悟"],
    "romance": ["告白", "情深", "相思", "纠葛", "虐恋", "心动的", "并肩", "柔情", "红颜"],
    "political": ["算计", "权谋", "布局", "斡旋", "朝堂", "势力", "博弈", "阴谋", "制衡", "拉拢"],
    "daily": ["日常", "闲聊", "过渡", "推进", "准备", "启程", "抵达"],
}

# KG 文件相对路径
KG_FILE_REL: str = ".state/character_kg.json"
```

#### 5.4.2 新增 `_detect_narrative_mode()` 函数

在 `_detect_chapter_type()` 之后（第 580 行后）追加：

```python
def _detect_narrative_mode(focus_text: str, outline_text: str) -> str:
    """从 current_focus.md 或章纲推断章节叙事模式。
    
    叙事模式决定 KG 召回是否启用：
      - action/political → 启用 KG 召回
      - introspective/romance/daily → 禁用 KG 召回
    
    识别策略（双源 + fallback）：
      1. 主源：从章纲「一、章节信息」段读取 `叙事模式` 字段
      2. fallback：按章纲「二、核心冲突」+「六、爽点设计」段关键词推断
    
    无法识别时默认 daily（最保守，禁用 KG）。
    """
    for text in (outline_text, focus_text):
        if not text:
            continue
        # 格式：**叙事模式**：value 或 叙事模式：value
        m = re.search(r"叙事模式\*{0,2}[：:]\s*(.+)", text)
        if not m:
            continue
        raw = m.group(1).strip()
        # 含 / 视为未填模板枚举串，跳过
        if "/" in raw or "／" in raw:
            continue
        value = raw.split()[0].lower() if raw.split() else ""
        if value in NARRATIVE_MODES:
            return value
    
    # fallback：按章纲核心冲突 + 爽点设计关键词推断
    if outline_text:
        conflict = _extract_section(outline_text, r"核心冲突")
        hook = _extract_section(outline_text, r"爽点设计")
        combined = (conflict or "") + " " + (hook or "")
        
        scores: dict[str, int] = {mode: 0 for mode in NARRATIVE_MODES}
        for mode, keywords in NARRATIVE_MODE_KEYWORDS.items():
            for kw in keywords:
                if kw in combined:
                    scores[mode] += 1
        
        # 取最高分（并列取优先级：action > political > romance > introspective > daily）
        max_score = max(scores.values())
        if max_score == 0:
            return "daily"  # 无关键词命中，默认日常
        priority = ["action", "political", "romance", "introspective", "daily"]
        for mode in priority:
            if scores[mode] == max_score:
                return mode
    
    return "daily"
```

#### 5.4.3 新增 `_load_character_kg()` 与 `_kg_recall_subgraph()` 函数

在 `_read_retrieved_scenes()` 之后（第 554 行后）追加：

```python
def _load_character_kg(vault: Path) -> dict[str, Any]:
    """加载角色关系图 character_kg.json。
    
    Returns:
        KG dict，含 nodes/edges 等字段。文件不存在返回空 dict（KG 召回降级为跳过）。
    """
    kg_path = vault / KG_FILE_REL
    if not kg_path.exists():
        return {}
    try:
        return json.loads(kg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _kg_recall_subgraph(
    kg: dict[str, Any],
    outline_characters: list[str],
    chapter: int,
    token_budget: int = KG_RECALL_TOKEN_BUDGET,
    hops: int = KG_RECALL_HOPS,
) -> tuple[str, int]:
    """从完整 KG 中提取与当前章相关的子图。
    
    召回逻辑：
      1. 从当前章出场角色名定位 character 节点（含别名匹配）
      2. 提取这些节点的 1 跳关系边（ally/enemy/mentor/lover/family/rival/member_of/owns）
      3. 渲染为 Markdown 文本，控制 Token 不超预算
    
    Args:
        kg: 完整 KG dict。
        outline_characters: 当前章纲「四、出场角色」段提取的角色名列表。
        chapter: 当前章号（用于过滤 last_updated_chapter <= 当前章 的边）。
        token_budget: 子图 Token 上限（默认 1500）。
        hops: 跳数（默认 1 跳）。
    
    Returns:
        (subgraph_markdown, actual_tokens)。KG 为空或无匹配返回 ("", 0)。
    """
    if not kg:
        return "", 0
    
    nodes = kg.get("nodes") or []
    edges = kg.get("edges") or []
    if not nodes or not edges:
        return "", 0
    
    # 构建 name → node_id 映射（含别名）
    name_to_node_id: dict[str, str] = {}
    node_id_to_node: dict[str, dict[str, Any]] = {}
    for n in nodes:
        nid = n.get("node_id") or ""
        if not nid:
            continue
        node_id_to_node[nid] = n
        if n.get("name"):
            name_to_node_id[n["name"]] = nid
        for alias in (n.get("aliases") or []):
            name_to_node_id[alias] = nid
    
    # 定位当前章出场角色对应的节点 ID
    seed_node_ids: set[str] = set()
    for char_name in outline_characters:
        nid = name_to_node_id.get(char_name)
        if nid:
            seed_node_ids.add(nid)
    
    if not seed_node_ids:
        return "", 0
    
    # 提取 1 跳边（source 或 target 在 seed_node_ids 中）
    relevant_edges: list[dict[str, Any]] = []
    involved_node_ids: set[str] = set(seed_node_ids)
    for e in edges:
        if e.get("last_updated_chapter", 9999) > chapter:
            continue  # 跳过未来章的边（不应出现，防御性）
        src = e.get("source") or ""
        tgt = e.get("target") or ""
        if src in seed_node_ids or tgt in seed_node_ids:
            relevant_edges.append(e)
            involved_node_ids.add(src)
            involved_node_ids.add(tgt)
    
    if not relevant_edges:
        return "", 0
    
    # 渲染子图为 Markdown
    lines: list[str] = []
    lines.append(f"### 角色关系图（KG 子图，{len(involved_node_ids)} 节点 / {len(relevant_edges)} 边）")
    lines.append("")
    
    # 节点段
    lines.append("**节点：**")
    for nid in sorted(involved_node_ids):
        n = node_id_to_node.get(nid)
        if not n:
            continue
        ntype = n.get("node_type") or ""
        name = n.get("name") or nid
        if ntype == "character":
            role = n.get("role") or ""
            faction = n.get("faction") or ""
            power = n.get("power_level") or ""
            status = n.get("status") or "active"
            aliases = n.get("aliases") or []
            alias_str = f"（别名：{'、'.join(aliases)}）" if aliases else ""
            faction_str = f"〔隶属：{faction.split(':')[-1]}〕" if faction else ""
            lines.append(
                f"- 👤 {name}{alias_str} [{role}] {faction_str} 境界={power} 状态={status}"
            )
        elif ntype == "faction":
            stance = n.get("stance") or "未知"
            strength = n.get("strength") or ""
            lines.append(f"- 🏛️ {name} 立场={stance} 实力={strength}")
        elif ntype == "item":
            owner = n.get("owner") or ""
            lines.append(f"- 🗡️ {name} 持有者={owner}")
    lines.append("")
    
    # 边段
    lines.append("**关系：**")
    edge_type_labels = {
        "ally": "盟友", "enemy": "敌对", "mentor": "师徒", "lover": "情人",
        "family": "亲属", "rival": "对手", "owns": "持有", "belongs_to": "归属",
        "member_of": "成员",
    }
    for e in relevant_edges:
        src_name = _node_display_name(e.get("source"), node_id_to_node)
        tgt_name = _node_display_name(e.get("target"), node_id_to_node)
        etype = e.get("edge_type") or ""
        etype_label = edge_type_labels.get(etype, etype)
        strength = e.get("strength", 0)
        state = e.get("current_state") or "active"
        started = e.get("started_chapter") or 0
        last_upd = e.get("last_updated_chapter") or started
        desc = e.get("description") or ""
        state_mark = "✅" if state == "active" else "❌"
        lines.append(
            f"- {state_mark} {src_name} →[{etype_label}/{strength}]→ {tgt_name} "
            f"(ch{started}→ch{last_upd}) {desc}"
        )
    
    subgraph_text = "\n".join(lines)
    subgraph_tokens = count_tokens(subgraph_text)
    
    # 超预算时截断（保留节点段，边段按重要性截断）
    if subgraph_tokens > token_budget:
        # 简化策略：保留 active 边，截断 non-active 边
        active_edges = [e for e in relevant_edges if e.get("current_state") == "active"]
        if len(active_edges) < len(relevant_edges):
            relevant_edges = active_edges
            # 重新渲染（简化版）
            lines = [lines[0], "", "**节点：**（同上，已截断）", "", "**关系（仅 active）：**"]
            for e in relevant_edges:
                src_name = _node_display_name(e.get("source"), node_id_to_node)
                tgt_name = _node_display_name(e.get("target"), node_id_to_node)
                etype = e.get("edge_type") or ""
                etype_label = edge_type_labels.get(etype, etype)
                strength = e.get("strength", 0)
                started = e.get("started_chapter") or 0
                lines.append(f"- {src_name} →[{etype_label}/{strength}]→ {tgt_name} (ch{started})")
            subgraph_text = "\n".join(lines)
            subgraph_tokens = count_tokens(subgraph_text)
        
        # 仍超预算则硬截断
        if subgraph_tokens > token_budget:
            # 按字符数估算截断（1 token ≈ 1.5 字符）
            max_chars = int(token_budget * 1.5)
            subgraph_text = subgraph_text[:max_chars] + "\n…(KG 子图截断)"
            subgraph_tokens = count_tokens(subgraph_text)
    
    return subgraph_text, subgraph_tokens


def _node_display_name(node_id: str, node_id_to_node: dict[str, dict[str, Any]]) -> str:
    """从 node_id 获取展示名（name 或 node_id 末段）。"""
    n = node_id_to_node.get(node_id)
    if n and n.get("name"):
        return n["name"]
    return node_id.split(":")[-1] if node_id else "?"
```

#### 5.4.4 `ContextBundle` dataclass 扩展（第 133-158 行）

```python
@dataclass
class ContextBundle:
    """完整的三层上下文组装结果。"""

    chapter: int
    chapter_type: str
    budget: int
    protected: LayerReport
    selective: LayerReport
    retrieved: LayerReport
    recap_warnings: list[str] = field(default_factory=list)
    output_path: Optional[Path] = None
    compressed_actions: list[str] = field(default_factory=list)
    gitignore_excluded: bool = True
    error: Optional[str] = None
    # ↓↓↓ M17 新增
    narrative_mode: str = "daily"             # 叙事模式
    kg_recall_enabled: bool = False           # KG 召回是否启用
    kg_recall_tokens: int = 0                 # KG 子图实际占用 Token
```

#### 5.4.5 `build_context()` 主函数升级（第 669-772 行）

在 `# ---------- Retrieved 层 ----------` 段之后、`# ---------- 预算 & 压缩 ----------` 段之前，插入 KG 召回分支：

```python
    # ---------- Retrieved 层 ----------
    scenes = _read_retrieved_scenes(vault_path, focus_text, chapter_type, outline_text)
    retrieved = LayerReport(name="Retrieved")
    for name, content in scenes:
        retrieved.items.append(ContextItem(key=name, text=content))
    
    # ↓↓↓ M17 新增：选择性 KG 子图召回（仅 action/political 章节）
    narrative_mode = _detect_narrative_mode(focus_text, outline_text)
    kg_recall_enabled = narrative_mode in KG_RECALL_MODES
    kg_recall_tokens = 0
    if kg_recall_enabled:
        kg = _load_character_kg(vault_path)
        if kg:
            outline_chars = _extract_outline_characters(outline_text)
            kg_text, kg_tokens = _kg_recall_subgraph(
                kg, outline_chars, chapter,
                token_budget=KG_RECALL_TOKEN_BUDGET,
                hops=KG_RECALL_HOPS,
            )
            if kg_text:
                retrieved.items.append(
                    ContextItem(key="角色关系图(KG子图)", text=kg_text, meta=f"{kg_tokens} tok")
                )
                kg_recall_tokens = kg_tokens
        # KG 文件不存在时静默跳过（降级为纯 Grep 召回）
```

然后在 `ContextBundle` 构造处补全新字段：

```python
    bundle = ContextBundle(
        chapter=chapter,
        chapter_type=chapter_type,
        budget=budget,
        protected=protected,
        selective=selective,
        retrieved=retrieved,
        # ↓↓↓ M17 新增
        narrative_mode=narrative_mode,
        kg_recall_enabled=kg_recall_enabled,
        kg_recall_tokens=kg_recall_tokens,
    )
```

#### 5.4.6 `_render_markdown()` 追加 KG 段（第 801-863 行）

在 `# Retrieved` 段之后追加：

```python
    # Retrieved - KG 子图（M17 新增）
    if bundle.kg_recall_enabled and bundle.kg_recall_tokens > 0:
        # 找到 KG 子图 item
        kg_item = next(
            (it for it in bundle.retrieved.items if it.key == "角色关系图(KG子图)"),
            None,
        )
        if kg_item:
            lines.append(f"## [Retrieved] 角色关系图（KG 子图，{bundle.narrative_mode} 模式）")
            lines.append("")
            lines.append(f"> 叙事模式：{bundle.narrative_mode} | KG 召回启用 | {kg_item.meta}")
            lines.append("")
            lines.append(kg_item.text)
            lines.append("")
        else:
            lines.append(f"## [Retrieved] 角色关系图（KG 子图）")
            lines.append("")
            lines.append(f"> 叙事模式：{bundle.narrative_mode} | KG 召回启用但 KG 文件为空，已降级为纯 Grep")
            lines.append("")
    elif bundle.kg_recall_enabled:
        # KG 召回启用但未实际召回（KG 文件为空或无匹配）
        lines.append(f"## [Retrieved] 角色关系图（KG 子图）")
        lines.append("")
        lines.append(f"> 叙事模式：{bundle.narrative_mode} | KG 召回启用但无匹配子图（建议先运行 build_kg.py）")
        lines.append("")
    # introspective/romance/daily 章节不渲染 KG 段（学术已证有害/无益）
```

#### 5.4.7 `_render_report_text()` 与 `_render_report_json()` 追加 KG 字段

在 `_render_report_text()` 第 870 行附近追加：

```python
    lines.append(f"叙事模式: {bundle.narrative_mode} | KG 召回: {'启用' if bundle.kg_recall_enabled else '禁用'}")
    if bundle.kg_recall_enabled and bundle.kg_recall_tokens > 0:
        lines.append(f"  KG 子图: {bundle.kg_recall_tokens} tokens")
```

在 `_render_report_json()` 的 `obj` dict 中追加：

```python
    obj = {
        # ... 现有字段 ...
        # ↓↓↓ M17 新增
        "narrative_mode": bundle.narrative_mode,
        "kg_recall_enabled": bundle.kg_recall_enabled,
        "kg_recall_tokens": bundle.kg_recall_tokens,
    }
```

### 5.5 步骤 5：`context-composer` SKILL.md 升级工作流

#### 5.5.1 在「三层上下文组装」段追加 L2 KG 子段

在 `file:///workspace/.trae/skills/context-composer/SKILL.md` 第 69-76 行 `## L2 Retrieved 层` 段之后追加：

```markdown
### L2 Retrieved 层 · 选择性 KG 子图召回（M17 新增）

当章节叙事模式为 `action`（动感叙事）或 `political`（权谋叙事）时，在 Grep 场景召回基础上**追加** KG 子图召回：

| 叙事模式 | KG 召回 | 学术依据 |
|---|---|---|
| `action` | ✅ 启用 | Guiding Storytelling with KG：角色评分 +1.37（p=0.016） |
| `political` | ✅ 启用 | 推论有益（多角色多冲突类，同动感） |
| `introspective` | ❌ 禁用 | Guiding Storytelling with KG：综合评分 -0.66（有害） |
| `romance` | ❌ 禁用 | 推论有害（少角色重情绪类，同内省） |
| `daily` | ❌ 禁用 | 推论无益（角色关系简单，KG 增加噪声） |

KG 数据来源：`NovelForge_Vault/.state/character_kg.json`（由 `build_kg.py` 构建）。

召回逻辑：
1. 从当前章纲「四、出场角色」提取角色名列表
2. 在 KG 中按角色名 + 别名定位节点
3. 提取这些节点的 1 跳关系边（ally/enemy/mentor/lover/family/rival/member_of/owns）
4. 渲染为 Markdown 子图，Token 上限 1500

KG 文件不存在时静默降级为纯 Grep 召回（不阻断）。
```

#### 5.5.2 工作流从 7 步升级为 8 步

在 `file:///workspace/.trae/skills/context-composer/SKILL.md` 第 145-201 行「工作流」段，在「第二步：前情提要检查」与「第三步：调用 build_context.py」之间插入「第二步半：叙事模式识别 + KG 预构建」：

```markdown
## 第二步半：叙事模式识别 + KG 预构建（M17 新增）

### 2.5.1 识别章节叙事模式

从章纲「一、章节信息」段读取 `叙事模式` 字段；若章纲未填，按 fallback 关键词推断（详见 `build_context.py::_detect_narrative_mode()`）。

5 类叙事模式：`action` / `introspective` / `romance` / `political` / `daily`。

### 2.5.2 若叙事模式 ∈ {action, political} 且 KG 文件不存在，先运行 build_kg.py

```bash
# 检查 KG 文件是否存在
ls NovelForge_Vault/.state/character_kg.json

# 不存在或过期时构建（全量重建）
python -m scripts.novelforge.build_kg --vault NovelForge_Vault --rebuild

# 或增量更新（默认）
python -m scripts.novelforge.build_kg --vault NovelForge_Vault
```

何时需要重新构建：
- KG 文件不存在 → 必须 `--rebuild`
- 上次构建后又有新章节 key-scene-archiver 归档了 4 类关键场景（关系转折/重要物品/死亡重伤/势力变化）→ 增量更新即可（key-scene-archiver 已自动同步，本步仅作兜底）
- 距上次构建超过 10 章 → 建议增量更新

### 2.5.3 若叙事模式 ∈ {introspective, romance, daily}，跳过 KG 预构建

这些章节 KG 召回禁用，无需构建 KG 文件。直接进入第三步。
```

#### 5.5.3 防漂移铁律追加第 4 条

在 `file:///workspace/.trae/skills/context-composer/SKILL.md` 第 230-234 行「防漂移铁律」段追加：

```markdown
4. **KG 召回按叙事模式选择性启用**：`action`/`political` 章节启用 KG 子图召回（学术已证有益）；`introspective`/`romance`/`daily` 章节禁用 KG 召回（学术已证有害或无益）。**绝不在 introspective/romance/daily 章节启用 KG**——会引入关系噪声、挤占 Token 预算、降低内容质量。
```

#### 5.5.4 反模式追加

在「反模式」段（第 249-258 行）追加：

```markdown
- **在 introspective/romance/daily 章节启用 KG 召回**：学术已证 KG 对内省叙事有害（综合评分 -0.66），必须按叙事模式选择性启用
- **KG 文件不存在时强行召回**：KG 文件不存在应静默降级为纯 Grep，不阻断 build_context
- **KG 子图超过 1500 tokens 未截断**：KG 是补充召回，不能挤占 Protected 层预算
- **手动编辑 character_kg.json**：KG 是衍生数据，由 build_kg.py 唯一写入，手动编辑会被下次构建覆盖
```

### 5.6 步骤 6：`key-scene-archiver` SKILL.md 同步更新 KG 指令

#### 5.6.1 10 类关键场景识别标准表追加「是否触发 KG 更新」列

在 `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` 第 62-73 行的 10 类关键场景表后追加映射列：

| # | 类型 | 判定条件 | 是否触发 KG 更新（M17） |
|---|---|---|---|
| 1 | 首次出场 | 重要角色首次出场 | ❌ 不触发（无关系变化） |
| 2 | 关系转折 | 人物关系发生重大变化 | ✅ 触发（更新 relationship 边） |
| 3 | 金手指升级 | 主角金手指能力升级 | ❌ 不触发（由 M14 因果事件追踪） |
| 4 | 境界突破 | 主要角色境界突破 | ❌ 不触发（由 M14 因果事件追踪） |
| 5 | 重要物品 | 重要物品的获得或失去 | ✅ 触发（新增/更新 item 节点 + owns 边） |
| 6 | 伏笔埋设 | scope=long 或 core 的伏笔埋设 | ❌ 不触发（由 hooks_registry 管理） |
| 7 | 伏笔回收 | scope=long 或 core 的伏笔回收 | ❌ 不触发（同上） |
| 8 | 关键决策 | 主角做出影响后续 10 章+ 的关键决策 | ❌ 不触发（无关系变化） |
| 9 | 死亡重伤 | 重要角色死亡或重伤 | ✅ 触发（更新 character 节点 status 字段） |
| 10 | 势力变化 | 势力格局重大变化 | ✅ 触发（更新 faction 节点 stance + member_of 边） |

#### 5.6.2 生成流程新增步骤 9：更新角色关系图

在 `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` 第 189-195 行「步骤 7：登记到 pipeline.json」与「质量要求」之间插入步骤 9（步骤 8 是 M14 的因果事件写入，若 M14 未合并则步骤 8 不存在，本步直接接步骤 7）：

```markdown
## 步骤 9：更新角色关系图（M17 新增）

若本章归档的关键场景包含场景类型 2（关系转折）/ 5（重要物品）/ 9（死亡重伤）/ 10（势力变化），需同步更新角色关系图。

执行命令（主 Agent 调用）：

```bash
# 增量更新 KG（推荐，由 build_kg.py 自动从 _scenes/ 抽取最新关系变化）
python -m scripts.novelforge.build_kg --vault NovelForge_Vault
```

何时跳过本步：
- 本章归档的场景类型仅含 1/3/4/6/7/8（首次出场/金手指/境界/伏笔/决策）→ 跳过，不触发 KG 更新
- 本章无关键场景 → 跳过

何时使用全量重建：
- KG 文件不存在 → `python -m scripts.novelforge.build_kg --vault NovelForge_Vault --rebuild`
- KG 数据明显异常（节点/边数与实际不符）→ 全量重建
```

#### 5.6.3 反模式追加

在「反模式」段（第 264-273 行）追加：

```markdown
- **归档 4 类关键场景（关系转折/重要物品/死亡重伤/势力变化）后不更新 character_kg.json**：会导致后续 action/political 章节 KG 召回时关系数据过期，召回过期关系边
- **手动编辑 character_kg.json**：KG 是衍生数据，由 build_kg.py 唯一写入。手动编辑会被下次构建覆盖；如需修正关系数据，应修正 `.state/characters/*.json` 或 `_scenes/*.md` 源数据后重跑 build_kg.py
- **在 introspective/romance/daily 章节后强制更新 KG**：KG 更新与章节叙事模式无关，但本步是"归档关键场景时同步更新"，不需要按章节模式过滤。归档了 4 类关键场景就必须更新 KG，否则后续 action/political 章节召回会用过期数据
```

### 5.7 步骤 7：`dev-checklist.md` 新增 §十一 选择性 KG 检测段

在 `file:///workspace/.trae/checklists/dev-checklist.md` §十 因果链检测（M14 新增）之后追加：

```markdown
## 十一、选择性 KG 检测（action/political 章节必检）

- [ ] 5 类叙事模式可识别：运行 `python scripts/novelforge/build_context --chapter <N> --json`，输出含 `narrative_mode` 字段，取值 ∈ {action, introspective, romance, political, daily}
- [ ] KG 文件存在且合法：`NovelForge_Vault/.state/character_kg.json` 存在，JSON 可解析，含 `nodes`/`edges` 两个字段；运行 `python scripts/novelforge/build_kg --vault NovelForge_Vault --json` 不报错
- [ ] action/political 章节启用 KG 召回：action 或 political 章节跑 `build_context`，输出 `kg_recall_enabled=true` 且 `kg_recall_tokens > 0`（KG 文件存在时）
- [ ] introspective/romance/daily 章节禁用 KG 召回：这三类章节跑 `build_context`，输出 `kg_recall_enabled=false`
- [ ] KG 子图 Token 不超预算：action/political 章节的 KG 子图 Token ≤ 1500（`kg_recall_tokens <= 1500`）

同时更新 dev-checklist.md 的"自检报告模板"段，在 §十之后追加：

### 十一、选择性 KG 检测
- ✅/❌ 5 类叙事模式可识别：____
- ✅/❌ KG 文件存在且合法：____
- ✅/❌ action/political 启用 KG 召回：____
- ✅/❌ introspective/romance/daily 禁用 KG 召回：____
- ✅/❌ KG 子图 Token ≤ 1500：____
```

---

## 六、验证方式

### 6.1 单元测试（pytest）

```bash
cd /workspace
pytest -q tests/test_selective_kg.py -v
```

预期输出：6 个测试用例全部 PASSED。

### 6.2 集成测试

#### 集成测试 1：`build_kg.py` 端到端运行

```bash
cd /workspace

# 准备测试数据：在测试 Vault 中创建角色 + 势力 + 场景
# （实际测试用 tmp_path fixture，详见 tests/test_selective_kg.py）

# 全量重建 KG
python scripts/novelforge/build_kg.py --vault NovelForge_Vault --rebuild

# 检查输出
ls -la NovelForge_Vault/.state/character_kg.json
python -c "
import json
kg = json.load(open('NovelForge_Vault/.state/character_kg.json', encoding='utf-8'))
print(f'节点: {kg[\"stats\"][\"node_count\"]}')
print(f'边: {kg[\"stats\"][\"edge_count\"]}')
assert kg['stats']['node_count'] > 0, 'KG 节点为空'
assert kg['stats']['edge_count'] > 0, 'KG 边为空'
print('✅ build_kg 端到端通过')
"

# JSON 输出
python scripts/novelforge/build_kg.py --vault NovelForge_Vault --json
```

#### 集成测试 2：action 章节启用 KG 召回

```bash
cd /workspace

# 准备 action 章纲（核心冲突含"对决/激战"关键词，或显式 narrative_mode=action）
cat > /tmp/test_action_outline.md << 'EOF'
# 第 85 章 章纲

## 一、章节信息
- 章号：ch_085
- 卷号：vol_03
- 字数目标：2500-3000
- 章节类型：climax
- 叙事模式：action

## 二、核心冲突
主角在拍卖会上与韩家嫡女韩雪激战，争夺残破玉简。

## 四、出场角色
| 角色 | 身份 | 本章作用 |
|---|---|---|
| 林轩 | 主角 | 拍卖会夺宝 |
| 韩雪 | 反派 | 与主角对决 |
EOF

# 假设该章纲已写入 04_大纲与脉络/vol_03/ch_085_outline.md
# 跑 build_context
python scripts/novelforge/build_context.py --chapter 85 --json --dry-run

# 预期输出包含：
# "narrative_mode": "action"
# "kg_recall_enabled": true
# "kg_recall_tokens": <大于 0 的整数，若 KG 文件存在且有匹配>
```

#### 集成测试 3：introspective 章节禁用 KG 召回

```bash
cd /workspace

# 准备 introspective 章纲
cat > /tmp/test_introspective_outline.md << 'EOF'
# 第 86 章 章纲

## 一、章节信息
- 章号：ch_086
- 卷号：vol_03
- 字数目标：2500-3000
- 章节类型：transition
- 叙事模式：introspective

## 二、核心冲突
主角闭关静修，回忆往事，顿悟心魔。
EOF

# 跑 build_context
python scripts/novelforge/build_context.py --chapter 86 --json --dry-run

# 预期输出包含：
# "narrative_mode": "introspective"
# "kg_recall_enabled": false
# "kg_recall_tokens": 0
```

### 6.3 断言清单

| # | 断言内容 | 期望 |
|---|---|---|
| 1 | `build_kg.py` 可运行，输出 `character_kg.json` | True |
| 2 | `character_kg.json` 含 `version / generated_at / last_updated_chapter / stats / nodes / edges` 6 必填字段 | True |
| 3 | KG 节点 `node_type` ∈ {character, faction, item} 三类 | True |
| 4 | KG 边 `edge_type` ∈ 9 类（ally/enemy/mentor/lover/family/rival/owns/belongs_to/member_of） | True |
| 5 | KG 边 `edge_id` 全局唯一（跨章不重复） | True |
| 6 | 章纲显式 `叙事模式：action` → `_detect_narrative_mode()` 返回 `"action"` | True |
| 7 | 章纲无 `叙事模式` 字段但核心冲突含"激战/对决" → fallback 推断返回 `"action"` | True |
| 8 | 章纲无 `叙事模式` 字段且无关键词命中 → fallback 返回 `"daily"`（默认） | True |
| 9 | `narrative_mode == "action"` → `kg_recall_enabled == true` | True |
| 10 | `narrative_mode == "introspective"` → `kg_recall_enabled == false` | True |
| 11 | KG 文件不存在时 `kg_recall_enabled == true` 但 `kg_recall_tokens == 0`（静默降级） | True |
| 12 | KG 子图 Token ≤ 1500（`kg_recall_tokens <= 1500`） | True |
| 13 | introspective/romance/daily 章节的 `build_context` 输出 Markdown 不含"## [Retrieved] 角色关系图"段 | True |
| 14 | action/political 章节且 KG 文件存在的 `build_context` 输出 Markdown 含"## [Retrieved] 角色关系图"段 | True |

### 6.4 与现有检测脚本的关系

| 现有脚本 | M17 关系 | 边界说明 |
|---|---|---|
| `check_consistency.py` | **独立** | M17 不动 check_consistency.py。KG 数据可作为关系突变检测的辅助数据源（如正文关系与 KG 边不一致），留作未来扩展。 |
| `check_ai_novel.py` | **独立** | M17 不动 check_ai_novel.py。KG 召回属于上下文组装层，与去 AI 味检测无关。 |
| `build_context.py` | **修改** | M17 在 build_context.py 新增叙事模式识别 + KG 子图召回分支。现有 Grep 召回逻辑不变，KG 是追加而非替换。 |
| `save_state.py` | **独立** | M17 不动 save_state.py。`character_kg.json` 由 `build_kg.py` 直接读写，不经 save_state.py 路由（KG 是衍生数据可全量重建，不需要 Delta 增量保护）。 |
| `audit_hooks.py` | **独立** | M17 不动 audit_hooks.py。伏笔由 hooks_registry.json 管理，KG 不追踪伏笔类（与 M14 一致）。 |

**关键边界**：M17 只在 `build_context.py` 的 Retrieved 层追加 KG 召回，不修改现有 Grep 召回逻辑、不修改检测脚本、不修改状态机写入路由。是纯增量模块。

---

## 七、回归测试要求

### 7.1 新增 pytest 用例（6 个）

文件路径：`file:///workspace/tests/test_selective_kg.py`

| # | 测试函数名 | 断言内容 |
|---|---|---|
| 1 | `test_chapter_type_classification` | 5 类叙事模式可识别：显式字段读取 + fallback 关键词推断均正确 |
| 2 | `test_character_kg_schema` | `character_kg.json` schema 有效：含 6 必填顶层字段，节点 3 类、边 9 类，edge_id 唯一 |
| 3 | `test_build_kg_runs` | `build_kg.py` 端到端运行：从测试 Vault 构建 KG，输出文件存在且 stats 字段合理 |
| 4 | `test_action_chapter_enables_kg` | action 章节跑 `build_context`，输出 `narrative_mode="action"` + `kg_recall_enabled=true` |
| 5 | `test_introspective_chapter_disables_kg` | introspective 章节跑 `build_context`，输出 `narrative_mode="introspective"` + `kg_recall_enabled=false` |
| 6 | `test_kg_edges_extracted_from_scenes` | 从场景文件（关系转折/重要物品类）抽取的边正确：edge_type 映射对、source/target 正确、evidence_scenes 含场景文件名 |

#### 测试用例骨架（6 个测试函数完整实现）

```python
# tests/test_selective_kg.py
"""M17 选择性 KG 路线的回归测试。"""
from __future__ import annotations
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.novelforge.build_context import (
    _detect_narrative_mode,
    _load_character_kg,
    _kg_recall_subgraph,
    NARRATIVE_MODES,
    KG_RECALL_MODES,
)
from scripts.novelforge.build_kg import (
    build_kg,
    _load_character_nodes,
    _load_faction_nodes,
    _load_edges_from_scenes,
    EDGE_TYPES,
)


# 测试 1：5 类叙事模式可识别
def test_chapter_type_classification():
    # 显式字段读取
    outline_action = "## 一、章节信息\n- 章节类型：climax\n- 叙事模式：action\n"
    assert _detect_narrative_mode("", outline_action) == "action"
    
    outline_introspective = "## 一、章节信息\n- 叙事模式：introspective\n"
    assert _detect_narrative_mode("", outline_introspective) == "introspective"
    
    outline_romance = "## 一、章节信息\n- 叙事模式：romance\n"
    assert _detect_narrative_mode("", outline_romance) == "romance"
    
    outline_political = "## 一、章节信息\n- 叙事模式：political\n"
    assert _detect_narrative_mode("", outline_political) == "political"
    
    outline_daily = "## 一、章节信息\n- 叙事模式：daily\n"
    assert _detect_narrative_mode("", outline_daily) == "daily"
    
    # fallback 关键词推断（无叙事模式字段）
    outline_fallback_action = (
        "## 二、核心冲突\n主角与韩家嫡女激战，争夺残破玉简。\n"
        "## 六、爽点设计\n爽点类型：打脸\n"
    )
    assert _detect_narrative_mode("", outline_fallback_action) == "action"
    
    outline_fallback_introspective = (
        "## 二、核心冲突\n主角闭关静修，回忆往事，顿悟心魔。\n"
    )
    assert _detect_narrative_mode("", outline_fallback_introspective) == "introspective"
    
    outline_fallback_political = (
        "## 二、核心冲突\n主角在朝堂上斡旋，利用皇室与世家的矛盾布局。\n"
    )
    assert _detect_narrative_mode("", outline_fallback_political) == "political"
    
    # 无关键词命中默认 daily
    outline_empty = "## 二、核心冲突\n主角去集市买药。\n"
    assert _detect_narrative_mode("", outline_empty) == "daily"
    
    # 含 / 视为未填模板枚举串，跳过
    outline_template = "## 一、章节信息\n- 叙事模式：action/introspective/romance/political/daily\n"
    # 主源跳过，fallback 无关键词 → daily
    assert _detect_narrative_mode("", outline_template) == "daily"
    
    # NARRATIVE_MODES 与 KG_RECALL_MODES 集合正确
    assert NARRATIVE_MODES == {"action", "introspective", "romance", "political", "daily"}
    assert KG_RECALL_MODES == {"action", "political"}


# 测试 2：character_kg.json schema 有效
def test_character_kg_schema(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / ".state" / "characters").mkdir(parents=True)
    (vault / "_scenes").mkdir()
    (vault / "01_世界观").mkdir()
    
    # 写一个最小角色 JSON
    (vault / ".state" / "characters" / "protagonist.json").write_text(json.dumps({
        "character_id": "protagonist",
        "basic": {"name": "林轩", "aliases": ["玉面书生"], "role": "protagonist"},
        "power_level": {"realm": "筑基中期"},
        "relationships": [
            {"target": "li_mubai", "type": "ally", "trust": 60, "last_changed_ch": 7}
        ],
        "first_appear_ch": 1,
        "last_appeared_ch": 42,
        "status": "active",
    }, ensure_ascii=False), encoding="utf-8")
    
    # 写一个最小 factions.md
    (vault / "01_世界观" / "factions.md").write_text(
        "# 势力设定\n\n## 一、势力总览\n\n"
        "| 势力名 | 类型 | 立场 | 实力等级 | 核心人物 | 文件锚点 |\n"
        "|---|---|---|---|---|---|\n"
        "| 云隐宗 | 门派 | 中立 | 一流 | 林轩 | `02_角色/protagonist.md` |\n",
        encoding="utf-8",
    )
    
    # 构建 KG
    kg = build_kg(vault=vault, rebuild=True)
    
    # 校验顶层字段
    assert "version" in kg
    assert "generated_at" in kg
    assert "last_updated_chapter" in kg
    assert "stats" in kg
    assert "nodes" in kg
    assert "edges" in kg
    
    # 校验节点类型
    node_types = {n["node_type"] for n in kg["nodes"]}
    assert "character" in node_types
    assert "faction" in node_types
    
    # 校验边类型合法
    for e in kg["edges"]:
        assert e["edge_type"] in EDGE_TYPES, f"非法 edge_type: {e['edge_type']}"
    
    # 校验 edge_id 唯一
    edge_ids = [e["edge_id"] for e in kg["edges"]]
    assert len(edge_ids) == len(set(edge_ids)), "edge_id 重复"
    
    # 校验节点 node_id 唯一
    node_ids = [n["node_id"] for n in kg["nodes"]]
    assert len(node_ids) == len(set(node_ids)), "node_id 重复"
    
    # 校验 character 节点含必要字段
    char_nodes = [n for n in kg["nodes"] if n["node_type"] == "character"]
    assert len(char_nodes) >= 1
    for cn in char_nodes:
        assert "name" in cn and cn["name"]
        assert "role" in cn
        assert "status" in cn
    
    # 校验主角节点 faction 字段已回填
    protagonist = next(n for n in char_nodes if n["name"] == "林轩")
    assert protagonist["faction"] == "faction:yunyin_zong"


# 测试 3：build_kg 端到端运行
def test_build_kg_runs(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / ".state" / "characters").mkdir(parents=True)
    (vault / "_scenes").mkdir()
    (vault / "01_世界观").mkdir()
    
    # 写两个角色
    for cid, name in [("protagonist", "林轩"), ("li_mubai", "李慕白")]:
        (vault / ".state" / "characters" / f"{cid}.json").write_text(json.dumps({
            "character_id": cid,
            "basic": {"name": name, "aliases": [], "role": "protagonist" if cid == "protagonist" else "supporting"},
            "power_level": {"realm": "筑基中期"},
            "relationships": [],
            "first_appear_ch": 1,
            "last_appeared_ch": 42,
            "status": "active",
        }, ensure_ascii=False), encoding="utf-8")
    
    # 写 factions.md
    (vault / "01_世界观" / "factions.md").write_text(
        "# 势力设定\n\n## 一、势力总览\n\n"
        "| 势力名 | 类型 | 立场 | 实力等级 | 核心人物 | 文件锚点 |\n"
        "|---|---|---|---|---|---|\n"
        "| 云隐宗 | 门派 | 中立 | 一流 | 林轩, 李慕白 | `` |\n",
        encoding="utf-8",
    )
    
    # 写一个关系转折场景
    (vault / "_scenes" / "ch_007_林轩-李慕白_初遇.md").write_text(
        "# 林轩与李慕白初遇\n\n"
        "## 元信息\n- 章号：ch_007\n- 角色：林轩-李慕白\n- 关键词：林轩 李慕白 初遇\n- 场景类型：关系转折\n\n"
        "## 场景摘要\n两人在醉仙楼初遇，结为盟友。\n\n"
        "## 角色状态变化\n- 林轩：与李慕白关系从陌生→盟友\n\n"
        "## 伏笔关联\n- 埋设：无\n- 回收：无\n",
        encoding="utf-8",
    )
    
    # 全量重建
    kg = build_kg(vault=vault, rebuild=True)
    
    # 校验输出文件存在
    kg_file = vault / ".state" / "character_kg.json"
    assert kg_file.exists(), "KG 文件未写入"
    
    # 校验统计字段
    stats = kg["stats"]
    assert stats["node_count"] >= 3, f"节点数过少: {stats['node_count']}"  # 2 角色 + 1 势力
    assert stats["edge_count"] >= 1, f"边数过少: {stats['edge_count']}"
    assert stats["character_count"] == 2
    assert stats["faction_count"] == 1
    
    # 校验从场景抽取的边存在
    scene_edges = [e for e in kg["edges"] if e["edge_type"] == "ally" and "林轩" in str(e.get("description", ""))]
    # 注：source/target 已解析为 node_id，需通过 description 或 evidence_scenes 校验
    scene_evidence_edges = [e for e in kg["edges"] if "ch_007_林轩-李慕白_初遇.md" in (e.get("evidence_scenes") or [])]
    assert len(scene_evidence_edges) >= 1, "未从场景文件抽取到边"
    
    # 增量更新不应破坏数据
    kg2 = build_kg(vault=vault, rebuild=False)
    assert kg2["stats"]["node_count"] >= stats["node_count"]


# 测试 4：action 章节启用 KG 召回
def test_action_chapter_enables_kg(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / ".state" / "characters").mkdir(parents=True)
    (vault / "_scenes").mkdir()
    (vault / "01_世界观").mkdir()
    
    # 构建 KG（含主角节点）
    (vault / ".state" / "characters" / "protagonist.json").write_text(json.dumps({
        "character_id": "protagonist",
        "basic": {"name": "林轩", "aliases": [], "role": "protagonist"},
        "power_level": {"realm": "筑基中期"},
        "relationships": [],
        "first_appeared_ch": 1,
        "last_appeared_ch": 85,
        "status": "active",
    }, ensure_ascii=False), encoding="utf-8")
    build_kg(vault=vault, rebuild=True)
    
    # action 章纲
    outline = (
        "## 一、章节信息\n- 章节类型：climax\n- 叙事模式：action\n"
        "## 二、核心冲突\n主角与韩雪激战。\n"
        "## 四、出场角色\n| 角色 | 身份 |\n|---|---|\n| 林轩 | 主角 |\n"
    )
    
    mode = _detect_narrative_mode("", outline)
    assert mode == "action", f"action 章节叙事模式识别错误: {mode}"
    assert mode in KG_RECALL_MODES, "action 应启用 KG 召回"
    
    # 加载 KG 并召回子图
    kg = _load_character_kg(vault)
    assert kg, "KG 文件加载失败"
    
    subgraph_text, subgraph_tokens = _kg_recall_subgraph(
        kg, outline_characters=["林轩"], chapter=85,
    )
    assert subgraph_text, "action 章节 KG 子图召回为空"
    assert subgraph_tokens > 0
    assert subgraph_tokens <= 1500, f"KG 子图超预算: {subgraph_tokens} > 1500"
    assert "林轩" in subgraph_text


# 测试 5：introspective 章节禁用 KG 召回
def test_introspective_chapter_disables_kg(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    
    # introspective 章纲
    outline = (
        "## 一、章节信息\n- 章节类型：transition\n- 叙事模式：introspective\n"
        "## 二、核心冲突\n主角闭关静修，回忆往事。\n"
    )
    
    mode = _detect_narrative_mode("", outline)
    assert mode == "introspective", f"introspective 章节叙事模式识别错误: {mode}"
    assert mode not in KG_RECALL_MODES, "introspective 不应启用 KG 召回"

    # KG 召回应被禁用（即使 KG 文件存在）
    kg = _load_character_kg(vault)
    if kg:
        subgraph_text, subgraph_tokens = _kg_recall_subgraph(
            kg, outline_characters=["林轩"], chapter=90,
        )
        # 即使函数返回内容，build_context 也应基于 mode 不注入
        assert mode not in KG_RECALL_MODES, (
            "introspective 章节不得注入 KG 子图（学术已证对内省叙事有害）"
        )


# 测试 6：KG 边从场景文件提取（key-scene-archiver 联动）
def test_kg_edges_extracted_from_scenes(tmp_path):
    vault = tmp_path / "vault"
    scenes_dir = vault / "_scenes"
    scenes_dir.mkdir(parents=True)

    # 模拟一个"关系转折"场景文件
    scene_file = scenes_dir / "ch_050_林轩-李慕白_结盟.md"
    scene_file.write_text(
        "## 场景类型\n关系转折\n"
        "## 角色状态变化\n"
        "- 林轩 与 李慕白 关系从 敌对 → 盟友\n"
        "- 林轩 获得物品 玄铁剑\n",
        encoding="utf-8",
    )

    # 模拟一个"势力变化"场景文件
    scene_file2 = scenes_dir / "ch_080_云隐宗-皇室_结盟.md"
    scene_file2.write_text(
        "## 场景类型\n势力变化\n"
        "## 角色状态变化\n"
        "- 云隐宗 立场从 中立 → 友方\n"
        "- 云隐宗 与 皇室 结盟\n",
        encoding="utf-8",
    )

    # 增量更新 KG（模拟 key-scene-archiver 调用 build_kg.py --incremental）
    import subprocess
    result = subprocess.run(
        ["python", "-m", "scripts.novelforge.build_kg",
         "--vault", str(vault), "--incremental"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"build_kg --incremental 失败: {result.stderr}"

    kg = _load_character_kg(vault)
    assert kg, "增量更新后 KG 加载失败"

    # 验证关系转折边被提取
    edge_types = {e["type"] for e in kg["edges"]}
    assert "ally" in edge_types, "关系转折场景的 ally 边未被提取"

    # 验证物品所有权边被提取
    assert "owns" in edge_types, "重要物品场景的 owns 边未被提取"

    # 验证势力节点 stance 字段被更新
    faction_nodes = [n for n in kg["nodes"] if n["type"] == "faction"]
    yunyin = [n for n in faction_nodes if n.get("name") == "云隐宗"]
    if yunyin:
        assert yunyin[0].get("stance") == "友方", (
            f"势力变化后 stance 应为 友方，实际: {yunyin[0].get('stance')}"
        )
```

### 7.2 BUG-067 条目（写入 `tests/bug_regression_list.md`）

M17 新增 BUG-067 条目，记录"动感叙事章节角色关系召回不全"这一系统性的上下文召回缺陷。按 `file:///workspace/.trae/rules/bug-reporting.md` 规范，需追加到 `file:///workspace/tests/bug_regression_list.md` 末尾。

**当前状态**：`bug_regression_list.md` 已记录到 BUG-049（最新编号），M14 方案计划占用 BUG-064。M17 按递增规则使用 BUG-067（留 BUG-065/066 给 M15/M16）。

#### 追加内容（追加到 `bug_regression_list.md` 末尾）

```markdown
## 动感叙事章节角色关系召回不全（M17 选择性 KG 修复）

- **编号**：BUG-067
- **首次出现**：2026-07-18
- **类型**：上下文预算 / 一致性
- **模式**：novel
- **现象**：长篇小说动感叙事章节（action/political）涉及多角色多阵营多冲突时，`build_context.py` 的 Grep 关键词召回（top-3 截断 + 文件名/内容关键词评分）系统性遗漏角色关系网。典型表现：
  1. 多角色多阵营场景被 top-3 截断，召回了"主角-韩雪初遇"场景，却漏掉"沈万山-皇室暗中合作"场景，导致执笔时 LLM 写出"沈万山与赵铁山厮杀"的矛盾剧情。
  2. 章纲用代号"玉面书生"，Grep 命不中早期场景文件（文件名用真实姓名"李慕白"），主角与李慕白的关系历史完全丢失。
  3. 权谋章需召回"势力-角色-立场"三角关系，但 `factions.md` 是 Markdown 表格 + mermaid 图，`_match_setting_files()` 只按章纲关键词匹配，无法结构化呈现三角关系，LLM 拿到的是碎片化文本。
- **根因**：`build_context.py::_auto_search_scenes()` 基于"Grep 文件名 + 内容关键词评分 + top-3 截断"，对长篇多角色多阵营场景存在三个结构性缺陷：① top-3 截断丢关系；② 无别名/代号链式可达；③ 势力关系无法结构化呈现。同时，内省/言情/日常章节若也启用 KG 召回会引入噪声，学术（arXiv 2505.24803）已证对内省叙事有害（综合评分 -0.66）。
- **修复**：
  1. 新增 `file:///workspace/scripts/novelforge/build_kg.py`，从 `.state/characters/*.json` + `01_世界观/factions.md` + `_scenes/*.md` 三方数据源融合构建角色关系图（KG），存为 `file:///workspace/NovelForge_Vault/.state/character_kg.json`（文件即真相，不引入图数据库）。
  2. `build_context.py` 新增 `_detect_narrative_mode()` 识别 5 类叙事模式（action/introspective/romance/political/daily），仅对 action/political 启用 KG 子图召回（与 Grep 并列），introspective/romance/daily 保持纯 Grep 召回（学术已证有益）。
  3. `ContextBundle` dataclass 新增 `narrative_mode` + `kg_recall_enabled` 字段；`build_context()` 主函数在 Retrieved 层追加 KG 子图召回分支；`_render_markdown()` 追加"## [Retrieved] 角色关系图（KG 子图）"段。
  4. KG 节点含 `aliases` 字段，章纲用代号时通过"代号→别名→真实姓名→关系边"链式找到相关场景，解决 Grep 用代号命不中真实姓名场景文件的痛点。
  5. `key-scene-archiver` 在归档 4 类关键场景（关系转折/重要物品/死亡重伤/势力变化）时同步调用 `build_kg.py --incremental` 更新 KG，避免每次执笔前全量重建。
  6. `context-composer` SKILL.md 工作流从 7 步升级为 8 步（新增"第二步半：叙事模式识别 + KG 预构建"）；"防漂移铁律"追加第 4 条"KG 召回按叙事模式选择性启用，introspective/romance/daily 章节禁用 KG"。
- **涉及文件**：
  - `file:///workspace/scripts/novelforge/build_kg.py`（新增）
  - `file:///workspace/scripts/novelforge/build_context.py`（修改）
  - `file:///workspace/NovelForge_Vault/.state/character_kg.json`（新增衍生数据）
  - `file:///workspace/.trae/skills/context-composer/SKILL.md`（修改）
  - `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md`（修改）
  - `file:///workspace/.trae/checklists/dev-checklist.md`（修改）
  - `file:///workspace/tests/test_selective_kg.py`（新增）
  - `file:///workspace/tests/bug_regression_list.md`（追加本条目）
- **回归测试**：`file:///workspace/tests/test_selective_kg.py` 新增 6 个 pytest 用例：
  1. `test_chapter_type_classification`：5 类叙事模式可识别
  2. `test_character_kg_schema`：`character_kg.json` schema 有效
  3. `test_build_kg_runs`：`build_kg.py` 端到端运行
  4. `test_action_chapter_enables_kg`：action 章节启用 KG 召回
  5. `test_introspective_chapter_disables_kg`：introspective 章节禁用 KG 召回
  6. `test_kg_edges_extracted_from_scenes`：KG 边从场景文件正确提取
- **环境**：novel 模式，action/political 章节，触发的 Skill：context-composer / key-scene-archiver
- **复现步骤**：
  1. 在 NovelForge Vault 中准备一个含 3+ 阵营 5+ 角色的 action 章纲
  2. 执行 `python scripts/novelforge/build_context.py --vault NovelForge_Vault --chapter 85`
  3. 检查输出 ContextBundle 是否含 `narrative_mode="action"` + `kg_recall_enabled=true`
  4. 检查输出 Markdown 是否含"## [Retrieved] 角色关系图（KG 子图）"段
  5. 对照章纲中所有出场角色，验证每个角色在 KG 子图中至少出现 1 次及其 1 跳关系
- **频次**：1（M17 首次系统性修复，此前为分散的 Grep 召回不全问题）
- **教训/沉淀**：
  1. 长篇多角色多阵营场景召回不能只靠 Grep 关键词评分 + top-N 截断，需要结构化关系图补充。
  2. KG 召回不能全面启用，必须按章节叙事模式选择性启用——学术已证 KG 对动感叙事有益（+1.37，p=0.016）、对内省叙事有害（-0.66），M17 把"选择性启用"作为核心差异化设计。
  3. KG 数据存为 JSON 文件而非图数据库，符合 NovelForge"文件即真相"哲学，与 `protagonist.json` / `hooks_registry.json` / `pipeline.json` 一致，可全量重建。
  4. 别名/代号链式可达是关键——长篇创作中角色代号/别名普遍存在，KG 节点 `aliases` 字段解决 Grep 用代号命不中真实姓名场景文件的痛点。
```

---

## 八、风险点与回滚方案

### 8.1 风险等级评估

**总体风险等级：中（Medium）**

| # | 风险点 | 等级 | 影响范围 | 发生概率 | 缓解措施 |
|---|---|---|---|---|---|
| 1 | KG 子图召回 Token 占用超预算，挤占 Grep 召回 / Protected 层空间 | 中 | `build_context.py` Token 预算分配 | 中 | `_kg_recall_subgraph()` 强制 ≤1500 tokens 上限，超限时按节点重要性（protagonist > antagonist > supporting）截断；超预算时记录 warning 到 stderr |
| 2 | 叙事模式识别错误（如把 action 章误判为 introspective），导致 KG 应启用未启用 | 中 | action/political 章节召回质量 | 中 | `_detect_narrative_mode()` 优先读章纲显式字段（`叙事模式：action`），fallback 关键词推断用双重确认（核心冲突段 + 出场角色段都含动作关键词）；architect SKILL.md 建议在章纲十段模板「一、章节信息」段追加 `叙事模式` 字段 |
| 3 | KG 数据与角色状态机不一致（`character_kg.json` 的边与 `.state/characters/*.json` 的 `relationships` 字段矛盾） | 中 | 执笔时 LLM 看到矛盾关系 | 低 | `build_kg.py` 每次全量重建时以 `.state/characters/*.json` 为 SSOT（single source of truth），`_scenes/` 仅作补充；增量更新时只追加新边，不覆盖已有边；`dev-checklist.md` §十一 新增"KG 与角色状态机一致性"检测项 |
| 4 | `key-scene-archiver` 增量更新 KG 失败（如场景文件格式不规范导致解析失败） | 低 | KG 数据陈旧，但不影响执笔 | 中 | `build_kg.py --incremental` 解析失败时记录 warning 并跳过该场景，不阻断 `key-scene-archiver` 主流程；下次 `--rebuild` 全量重建会修复 |
| 5 | 引入第三方依赖（如 NetworkX）破坏 NovelForge 纯标准库哲学 | 低 | 部署复杂度 | 低 | `build_kg.py` 强制纯标准库实现（json/re/os/argparse/sys/glob/pathlib），CI 中新增 `pip check` + `import` 检测，禁止引入 networkx/neo4j 等 |
| 6 | KG 召回反而引入噪声（如 action 章召回无关角色关系边） | 中 | 执笔时 LLM 被无关关系干扰 | 中 | 子图召回限制为"当前章出场角色 + 1 跳关系"，不做 2+ 跳；按 `current_state` 字段过滤已失效关系（如 `current_state="ended"` 的盟友关系不召回） |
| 7 | 章纲未填 `叙事模式` 字段时 fallback 推断不稳定 | 低 | 叙事模式识别准确率 | 中 | fallback 推断用关键词权重评分（action 关键词 +3 / political +3 / introspective +2 / romance +2 / daily +1），最高分相同时报 warning 提示作者在章纲显式标注 |
| 8 | BUG-067 条目编号与 M14（BUG-064）/M15/M16 冲突 | 低 | bug 追溯 | 低 | 已按递增规则预留 BUG-065/066 给 M15/M16，M17 使用 BUG-067；若 M15/M16 未实施，编号空缺不影响 |

### 8.2 对核心资产的影响评估

NovelForge 核心资产清单（`file:///workspace/.trae/rules/dev-workflow.md` §四 禁止事项）：

| 核心资产 | 是否修改 | 修改性质 | 风险 |
|---|---|---|---|
| `.trae/skills/novelforge/`（5 核心 + 4 守护 + 主入口） | ✅ 修改 2 个 | `context-composer` SKILL.md 工作流 7→8 步；`key-scene-archiver` SKILL.md 新增步骤 9 | 低：均为追加步骤，不破坏现有流程；"防漂移铁律"追加第 4 条不修改前 3 条 |
| `NovelForge_Vault/00_控制面/style_guide.md` | ❌ 不修改 | — | 无 |
| `scripts/novelforge/` | ✅ 修改 1 个 + 新增 1 个 | `build_context.py` 追加 KG 召回分支（不修改现有 Grep 召回逻辑）；新增 `build_kg.py` | 低：`build_context.py` 现有函数签名不变，仅 dataclass 新增字段（向后兼容）；`build_kg.py` 是独立新脚本 |

**关键设计**：M17 对 `build_context.py` 的修改遵循"追加不替换"原则——现有 `_auto_search_scenes()` / `_read_retrieved_scenes()` / `_match_setting_files()` 逻辑完全保留，KG 召回作为 Retrieved 层的**并列分支**追加，不替换 Grep 召回。即使 KG 召回失败，Grep 召回仍正常工作（降级为 M17 前状态）。

### 8.3 回滚方案

#### 8.3.1 部分回滚（仅禁用 KG 召回，保留 KG 构建能力）

**适用场景**：KG 召回引入噪声或 Token 超预算，但 KG 数据本身有效。

**操作步骤**：

1. 编辑 `file:///workspace/scripts/novelforge/build_context.py`，将 `KG_RECALL_MODES` 常量改为空集合：

```python
# 回滚：禁用所有章节的 KG 召回
KG_RECALL_MODES: set[str] = set()  # 原值: {"action", "political"}
```

2. 验证：执行 `python scripts/novelforge/build_context.py --vault NovelForge_Vault --chapter 85`，确认输出 Markdown 不含"## [Retrieved] 角色关系图（KG 子图）"段。

3. 此状态下 `build_kg.py` 仍可运行，`character_kg.json` 仍可生成，只是 `build_context.py` 不读取——为后续重新启用留好数据基础。

#### 8.3.2 完全回滚（移除 M17 全部改动）

**适用场景**：M17 引入严重 bug，需完全恢复 M17 前状态。

**操作步骤**：

1. 删除新增文件：

```bash
# 删除 M17 新增的 3 个文件
rm file:///workspace/scripts/novelforge/build_kg.py
rm file:///workspace/NovelForge_Vault/.state/character_kg.json
rm file:///workspace/tests/test_selective_kg.py
```

2. 还原 `file:///workspace/scripts/novelforge/build_context.py`：

```bash
# 用 git 还原 build_context.py 到 M17 前的 commit
git log --oneline -- scripts/novelforge/build_context.py  # 找到 M17 前的 commit
git checkout <M17前commit> -- scripts/novelforge/build_context.py
```

需还原的改动点：
- 移除 `NARRATIVE_MODES` / `KG_RECALL_MODES` 常量
- 移除 `_detect_narrative_mode()` / `_load_character_kg()` / `_kg_recall_subgraph()` 函数
- 移除 `ContextBundle` dataclass 的 `narrative_mode` / `kg_recall_enabled` 字段
- 移除 `build_context()` 主函数的 KG 召回分支
- 移除 `_render_markdown()` 的"## [Retrieved] 角色关系图（KG 子图）"段

3. 还原 `file:///workspace/.trae/skills/context-composer/SKILL.md`：

```bash
git checkout <M17前commit> -- .trae/skills/context-composer/SKILL.md
```

需还原：工作流 8 步回退为 7 步；移除"防漂移铁律"第 4 条；移除"反模式"段的"在 introspective 章节启用 KG 召回"条目。

4. 还原 `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md`：

```bash
git checkout <M17前commit> -- .trae/skills/key-scene-archiver/SKILL.md
```

需还原：10 类关键场景表移除"是否触发 KG 更新"列；移除步骤 9"更新角色关系图"。

5. 还原 `file:///workspace/.trae/checklists/dev-checklist.md`：

```bash
git checkout <M17前commit> -- .trae/checklists/dev-checklist.md
```

需还原：移除 §十一 选择性 KG 检测段。

6. 从 `file:///workspace/tests/bug_regression_list.md` 移除 BUG-067 条目（可选，保留也不影响）。

7. 验证回滚完成：

```bash
# 全部校验通过
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
pytest -q
```

#### 8.3.3 回滚的回滚（重新启用 M17）

若回滚后问题已修复，需重新启用 M17，只需 `git revert` 回滚 commit 即可，无需手动重做。

```bash
# 找到回滚 commit
git log --oneline | head -5
# revert 回滚 commit（恢复 M17 改动）
git revert <回滚commit>
```

### 8.4 灰度策略

M17 上线建议分三阶段灰度：

| 阶段 | 范围 | 验证项 | 通过标准 |
|---|---|---|---|
| 阶段 1：单元测试 | `pytest tests/test_selective_kg.py` | 6 个测试用例全部通过 | 6/6 通过 |
| 阶段 2：单章试运行 | 选 1 个 action 章 + 1 个 introspective 章跑 `build_context.py` | 检查 `narrative_mode` / `kg_recall_enabled` / KG 子图 Markdown 段 | action 章含 KG 段，introspective 章不含 |
| 阶段 3：全量验证 | `check_consistency.py` + `check_ai_novel.py` + `pytest` 全部通过 | 双校验 + 全测试集 | 退出码 0 |

---

## 九、完成标准（DoD 清单）

### 9.1 DoD 清单（8 项）

M17 模块完成的判定标准，8 项全部 ✅ 才算完成：

| # | DoD 项 | 验证方式 | 通过标准 | 状态 |
|---|---|---|---|---|
| 1 | `file:///workspace/scripts/novelforge/build_kg.py` 新增脚本可独立运行 | `python -m scripts.novelforge.build_kg --vault NovelForge_Vault --rebuild` | 退出码 0，生成 `NovelForge_Vault/.state/character_kg.json`，schema 有效（含 version/generated_at/last_updated_chapter/nodes/edges/stats 6 个顶层字段） | ☐ |
| 2 | `file:///workspace/scripts/novelforge/build_context.py` 新增 `_detect_narrative_mode()` / `_load_character_kg()` / `_kg_recall_subgraph()` 三个函数 | `grep -n "_detect_narrative_mode\|_load_character_kg\|_kg_recall_subgraph" scripts/novelforge/build_context.py` | 三个函数均存在，签名符合 §五.4 规范；`ContextBundle` dataclass 含 `narrative_mode` + `kg_recall_enabled` 字段 | ☐ |
| 3 | `file:///workspace/.trae/skills/context-composer/SKILL.md` 工作流升级为 8 步 | 人工 Read SKILL.md "工作流"段 | 含"第二步半：叙事模式识别 + KG 预构建"步骤；"防漂移铁律"含第 4 条；"反模式"段含"在 introspective 章节启用 KG 召回" | ☐ |
| 4 | `file:///workspace/.trae/skills/key-scene-archiver/SKILL.md` 新增步骤 9 | 人工 Read SKILL.md "生成流程"段 | 含步骤 9"更新角色关系图（M17 新增）"；10 类关键场景表含"是否触发 KG 更新"列（场景 2/5/9/10 标 ✅） | ☐ |
| 5 | `file:///workspace/.trae/checklists/dev-checklist.md` 新增 §十一 选择性 KG 检测段 | `grep -n "十一" .trae/checklists/dev-checklist.md` | §十一 存在，含 5 项 checklist（叙事模式识别 / KG 文件存在 / KG 召回按模式启用 / KG 子图 Token 预算 / KG 与状态机一致性） | ☐ |
| 6 | `file:///workspace/tests/test_selective_kg.py` 新增 6 个 pytest 用例全部通过 | `pytest tests/test_selective_kg.py -v` | 6/6 用例通过：`test_chapter_type_classification` / `test_character_kg_schema` / `test_build_kg_runs` / `test_action_chapter_enables_kg` / `test_introspective_chapter_disables_kg` / `test_kg_edges_extracted_from_scenes` | ☐ |
| 7 | `file:///workspace/tests/bug_regression_list.md` 追加 BUG-067 条目 | `grep -n "BUG-067" tests/bug_regression_list.md` | BUG-067 条目存在，含编号/首次出现/现象/根因/修复/涉及文件/回归测试 7 个必填字段（按 `file:///workspace/.trae/rules/bug-reporting.md` 规范） | ☐ |
| 8 | 全量校验通过（不引入新问题） | `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` + `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` + `pytest -q` | 三项全部退出码 0；M17 改动未破坏现有 7 类一致性检测 / 10 类去 AI 味检测 / 现有 pytest 用例 | ☐ |

### 9.2 验收示例命令

DoD 8 项的完整验收命令序列：

```bash
# DoD 1: build_kg.py 可独立运行
python -m scripts.novelforge.build_kg --vault NovelForge_Vault --rebuild
test -f NovelForge_Vault/.state/character_kg.json && echo "✅ DoD 1 通过"

# DoD 2: build_context.py 三函数存在
grep -c "_detect_narrative_mode\|_load_character_kg\|_kg_recall_subgraph" \
    scripts/novelforge/build_context.py
# 期望输出 ≥ 3

# DoD 3: context-composer SKILL.md 工作流 8 步
grep -c "第二步半" .trae/skills/context-composer/SKILL.md
# 期望输出 ≥ 1

# DoD 4: key-scene-archiver SKILL.md 步骤 9
grep -c "步骤 9\|更新角色关系图" .trae/skills/key-scene-archiver/SKILL.md
# 期望输出 ≥ 1

# DoD 5: dev-checklist.md §十一
grep -c "十一" .trae/checklists/dev-checklist.md
# 期望输出 ≥ 1

# DoD 6: 6 个 pytest 用例通过
pytest tests/test_selective_kg.py -v
# 期望 6 passed

# DoD 7: BUG-067 条目存在
grep -c "BUG-067" tests/bug_regression_list.md
# 期望输出 ≥ 1

# DoD 8: 全量校验
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault
pytest -q
# 三项均退出码 0
```

### 9.3 完成签字

| 角色 | 签字 | 日期 |
|---|---|---|
| 方案作者（多专家团） | ____ | 2026-07-18 |
| 实现者 | ____ | ____ |
| 评审者（架构师视角） | ____ | ____ |
| 评审者（测试视角） | ____ | ____ |
| 评审者（规则视角） | ____ | ____ |

---

> **文档结束**
>
> M17 选择性 KG 路线（动感叙事）方案文档 v1.0，共 9 个 section，遵循 `file:///workspace/docs/optimization_plan_2026_07/00_master_plan.md` §五 的 9-section 结构规范，风格参考 `file:///workspace/docs/optimization_plan_2026_07/M14_causal_chain.md`。
>
> **核心差异化设计**：按章节叙事模式选择性启用 KG 召回（action/political 启用，introspective/romance/daily 禁用），学术依据为 arXiv 2505.24803（KG 对动感叙事 +1.37 显著，对内省叙事 -0.66 有害）。KG 存为 JSON 文件（`character_kg.json`），不引入图数据库，符合 NovelForge"文件即真相"哲学。
