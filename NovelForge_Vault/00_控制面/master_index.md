# 全局素材索引（master_index）

> 本文件是 NovelForge Vault 的「目录页」，由主 Agent 在新增章节/角色/伏笔时手动同步，或由 novelforge 主入口在调度链末尾更新。
> 修改时保持索引与其他文件的对应关系，不要凭空增删条目。
> 作用：让 LLM 在生成新章时快速定位「相关角色/伏笔/场景」所在文件，避免全仓扫描。

---

## 一、角色索引

| 角色名 | 文件路径 | 一句话状态 |
|---|---|---|
| 主角 | `02_角色/protagonist.md` | （状态由 `.state/characters/protagonist.json` 同步）|
| 反派 1 | `02_角色/antagonists/xxx.md` | ____ |

## 二、伏笔索引

| 伏笔 ID | 状态 | 埋设章 | 目标回收章 | 关键文件 |
|---|---|---|---|---|
| H-001 | planted | ch_001 | ch_010 | `04_大纲与脉络/hooks_registry.json` |

> 状态枚举：planted（已埋）→ hinted（已提示）→ resolved（已回收）/ abandoned（已放弃）

## 三、关键场景索引

| 场景关键词 | 章号 | 文件路径 |
|---|---|---|
| 主角觉醒金手指 | ch_001 | `_scenes/ch_001_主角_觉醒.md` |

> 场景文件命名规范：`ch_NNN_角色_关键词.md`，仅存「需要 L1 召回的关键场景」，普通流水章不入库。

## 四、卷章快速定位

| 卷号 | 章号范围 | 卷大纲 | 草稿 | 定稿 |
|---|---|---|---|---|
| vol_01 | ch_001 ~ ch_0NN | `04_大纲与脉络/vol_01/vol_outline.md` | `05_正文/drafts/vol_01/` | `05_正文/published/vol_01/` |

## 五、世界设定快速定位

| 设定类别 | 文件路径 |
|---|---|
| 力量体系 | `01_世界观/core_rules.md` |
| 地理 | `01_世界观/geography.md` |
| 势力 | `01_世界观/factions.md` |
| 物品/概念 | `01_世界观/items_and_concepts.md` |

## 六、状态机快速定位

| 状态 | 文件路径 |
|---|---|
| 当前章节流水线阶段 | `.state/pipeline.json` |
| 上下文预算 | `.state/context_budget.json` |
| 金手指强度曲线 | `.state/power_curve.json` |
| 节奏曲线 | `.state/rhythm_curve.json` |
| 章节字数历史 | `.state/chapter_length_history.json` |
| 世界时间线 | `.state/world_timeline.json` |

---

> 最后更新：YYYY-MM-DD HH:MM（主 Agent 同步后手动写入）
