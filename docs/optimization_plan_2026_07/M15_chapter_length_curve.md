# M15：章节字数曲线可视化

> NovelForge 优化方案 2026-07 · 模块 M15
> 状态：草案（待执行）
> 编写日期：2026-07-18
> 风险等级：低（新增脚本，不修改核心资产逻辑）

---

## 一、模块目标

**一句话目标**：基于 `NovelForge_Vault/.state/chapter_length_history.json` 生成卷级字数分布报告 + 4 类异常自动告警（前紧后松 / 卷末灌水 / 单章过短 / 单章过长）。

**对应痛点**：
- 字数曲线失衡（前紧后松、卷首铺陈密集、卷中后段字数坍塌）
- 卷末灌水（卷末 3 章为凑节奏大幅注水）
- 单章越界（< 1500 字过短 / > 5000 字过长）但 `check_ai_novel.py` 的硬边界是 1600-3600，更宽的"业务异常"无检测

**完成后达成的能力**：
1. 一键生成 Markdown 字数曲线可视化报告（表格 + ASCII 折线图）
2. 4 类异常自动告警，明确到具体章号
3. 与 `check_ai_novel.py` 第 7 维 `word_count` 形成"单章硬边界 + 卷级分布"双层防护
4. `writer-polisher` Skill 每章后自动触发可视化，让作者在写下一章前看到曲线趋势

---

## 二、痛点对应

### 2.1 痛点表现

| 异常类型 | 判定条件（卷级） | 危害 |
|---|---|---|
| **前紧后松** front_heavy_back_light | 卷前 1/3 章节字数均值 > 后 2/3 字数均值 × 1.3 | 读者从开篇密集信息流骤然掉入稀薄剧情，弃书风险高 |
| **卷末灌水** volume_end_bloat | 卷最后 3 章字数均值 > 卷均值 × 1.5 | 作者为收尾强行注水，节奏失衡，读者疲劳 |
| **单章过短** chapter_too_short | 单章字数 < 1500 字 | 信息密度低、剧情推进弱、读者订阅感差 |
| **单章过长** chapter_too_long | 单章字数 > 5000 字 | 节奏拖沓、阅读疲劳、与网文"30 分钟一章"消费场景冲突 |

### 2.2 行业方案参考

- 起点/番茄等主流网文平台约定俗成 **3000 字/章**
- 黄金三章字数建议 **2500-3000 字**（首章略短，2-3 章略长以承接钩子）
- 完本老作者经验：**卷内字数标准差 / 均值 ≤ 0.20**（即变异系数 ≤ 20%）视为节奏稳定

### 2.3 本模块差异化设计

| 维度 | check_ai_novel.py 第 7 维（已有） | M15（新增） |
|---|---|---|
| 视角 | 单章 + 近 10 章方差 | 卷级分布 + 卷首/卷末对比 |
| 阈值 | 1600-3600 硬边界 | 1500-5000 业务区间 + 1.3/1.5 倍率比 |
| 触发 | 每章执笔后审计 | 每章执笔后 + 卷末/手动触发 |
| 输出 | JSON / 文本报告 | Markdown 表格 + ASCII 折线图 |
| 阻断 | P0 阻断 published | 仅告警不阻断（曲线问题需作者人工判断） |

**差异化定位**：M15 不取代 `check_ai_novel.py` 的单章硬边界，而是补充"卷级节奏分布"视角。两者并行运行，前者管"这章能不能发"，后者管"这卷节奏稳不稳"。

---

## 三、涉及现有文件

执行前必须 Read 以下文件了解现状（已在本方案编写时读取）：

### 3.1 数据源：`file:///workspace/NovelForge_Vault/.state/chapter_length_history.json`

**现状**：
```json
{
  "_comment": "章节字数历史。记录每章实际成稿字数，用于均值计算与节奏控制。",
  "_comment_purpose": "architect 写新章纲时参考最近 N 章均值设定字数目标；polisher 校验成稿字数是否在 ±10% 区间。",
  "_comment_chapters_entry": "chapters 数组每条含：ch=章号 / vol=卷号 / word_count=字数 / target=目标字数 / mode=novel|shortform",
  "version": "1.0.0",
  "chapters": []
}
```

**关键发现**：schema 已定义但 `chapters` 数组为空 → 当前没有任何字数历史在记，说明 `writer-polisher` Skill 完成章节后**没有**把字数写入此文件。这是 M15 必须解决的"上游缺口"。

### 3.2 字数历史更新逻辑：`file:///workspace/scripts/novelforge/save_state.py`

**现状**：`save_state.py` 的 `_route_path` 仅识别 4 类路径根：`characters/` / `hooks/` / `world_timeline` / `pipeline`，**不识别 `chapter_length`**。即 `chapter_length_history.json` 当前**无任何脚本入口**可写入。

**M15 处理策略**：不在 `save_state.py` 中扩展路由（避免改动核心状态机脚本），而是在新增的 `visualize_length_curve.py` 中提供独立的 `update_length_history()` 函数，由 `writer-polisher` Skill 直接调用 CLI 触发更新。

### 3.3 字数检测：`file:///workspace/scripts/novelforge/check_ai_novel.py`

**现状**：第 7 维 `check_word_count`（[L786-822](file:///workspace/scripts/novelforge/check_ai_novel.py)）：
- 单章硬边界：`WORD_COUNT_HARD_MIN=1600` / `WORD_COUNT_HARD_MAX=3600`
- 近 10 章方差：`stdev / mean > 0.25` 报 P1
- 已加载 `chapter_length_history.json`（`load_length_history()` at [L441-452](file:///workspace/scripts/novelforge/check_ai_novel.py)）

**M15 关系**：复用 `load_length_history()` 的加载逻辑思路，但阈值与视角不同。M15 的"单章过短 < 1500 / 过长 > 5000"是更宽松的业务阈值，与 `check_ai_novel` 的 1600-3600 硬边界不冲突。

### 3.4 一致性检测：`file:///workspace/scripts/novelforge/check_consistency.py`

**现状**：7 类漂移检测（境界跳级 / 物品凭空 / 关系突变 / 位置穿越 / 伏笔遗忘 / 角色复生 / 金手指越界），**不涉及字数曲线**。

**M15 关系**：M15 不并入 `check_consistency.py`，因为字数曲线属于"节奏质量"而非"状态漂移"，归口不同。两者并行运行。

### 3.5 执笔 Skill：`file:///workspace/.trae/skills/writer-polisher/SKILL.md`

**现状**：四阶段流水线（写手 → 审计 → 精修 → 状态更新），阶段四"状态更新"调用 `save_state.py` 写 characters/hooks/world_timeline/pipeline，**未包含**字数历史更新步骤。

**M15 改动**：在阶段四第 3 步（调用 `save_state.py`）之后新增"第 3.5 步：更新字数历史并触发可视化"。

### 3.6 自检 checklist：`file:///workspace/.trae/checklists/dev-checklist.md`

**现状**：第三节"一致性"与第八节"去 AI 味"均无字数曲线项。第一节"创作质量"有"字数控制：novel 模式单章 2000-3000 字（±20%）"但仅限单章。

**M15 改动**：在第一节"创作质量"末尾新增"字数曲线异常"检测项。

### 3.7 进度状态：`file:///workspace/NovelForge_Vault/.state/pipeline.json`

**现状**：含 `current_chapter` / `current_volume` 字段，可供可视化脚本读取以确定"当前卷"。

**M15 用法**：`visualize_length_curve.py --vault NovelForge_Vault` 默认可视化当前卷；`--volume N` 可指定历史卷。

---

## 四、新增/修改文件清单

### 4.1 新增

| 文件 | 用途 |
|---|---|
| `file:///workspace/scripts/novelforge/visualize_length_curve.py` | 字数曲线可视化 + 4 类异常检测 + 字数历史更新（一站式 CLI） |
| `file:///workspace/tests/test_length_curve.py` | 至少 6 个回归测试用例 |

### 4.2 修改

| 文件 | 改动 |
|---|---|
| `file:///workspace/.trae/checklists/dev-checklist.md` | 第一节"创作质量"末尾新增字数曲线检测项文案 |
| `file:///workspace/.trae/skills/writer-polisher/SKILL.md` | 阶段四新增"第 3.5 步：更新字数历史并触发可视化" |
| `file:///workspace/tests/bug_regression_list.md` | 新增 BUG-065「字数曲线无异常检测导致前紧后松/卷末灌水」 |

### 4.3 不修改

- `save_state.py` —— 不在核心状态机脚本中扩展路由，避免影响 characters/hooks/world_timeline/pipeline 四类原子写入逻辑
- `check_consistency.py` —— 字数曲线不属于状态漂移
- `check_ai_novel.py` —— 单章硬边界已存在，M15 是补充而非替代
- `chapter_length_history.json` —— 数据 schema 不变，只是开始有数据写入

---

## 五、详细实现步骤

### 5.1 设计 4 类异常检测算法

#### 5.1.1 front_heavy_back_light（前紧后松）

```
输入：单卷所有章节字数列表 wcs（按章号升序）
n = len(wcs)
若 n < 6：跳过（章数太少不判断分布）
front_n = max(1, n // 3)
front_mean = mean(wcs[:front_n])
back_mean = mean(wcs[front_n:])
若 back_mean == 0：跳过
若 front_mean > back_mean × 1.3：触发告警
告警详情含 front_mean / back_mean / 比值 / 涉及章号区间
```

**阈值 1.3 来源**：行业经验"前段字数比后段多 30% 以上"会被读者感知为节奏坍塌。

#### 5.1.2 volume_end_bloat（卷末灌水）

```
输入：单卷所有章节字数列表 wcs（按章号升序）
n = len(wcs)
若 n < 6：跳过
end_n = min(3, n)
end_mean = mean(wcs[-end_n:])
vol_mean = mean(wcs)
若 vol_mean == 0：跳过
若 end_mean > vol_mean × 1.5：触发告警
告警详情含 end_mean / vol_mean / 比值 / 末尾章号区间
```

**阈值 1.5 来源**：卷末 3 章比卷均值多 50% 以上，基本可判定为注水收尾。

#### 5.1.3 chapter_too_short（单章过短 < 1500）

```
对每章 word_count：
若 word_count < 1500：触发告警
告警详情含 ch / vol / word_count
```

**阈值 1500 来源**：低于 `check_ai_novel.py` 硬下限 1600 的更宽松业务线，避免与硬边界重复告警。当 `word_count < 1600` 时 `check_ai_novel` 已 P0 阻断，M15 的 1500 阈值覆盖"1600-1500 之间的灰区"以及"shortform 模式下硬边界不适用但仍有最小篇幅需求"的场景。

#### 5.1.4 chapter_too_long（单章过长 > 5000）

```
对每章 word_count：
若 word_count > 5000：触发告警
告警详情含 ch / vol / word_count
```

**阈值 5000 来源**：远高于 `check_ai_novel.py` 硬上限 3600，覆盖 shortform 模式（3-6k 字）的上界以及 novel 模式偶发的"双倍章节"异常。

### 5.2 设计可视化报告格式

报告采用 Markdown 格式，含三部分：

#### 5.2.1 卷级字数分布表

```markdown
## 卷 01 字数分布报告

> 生成时间：2026-07-18 14:32
> 数据源：NovelForge_Vault/.state/chapter_length_history.json
> 当前卷：vol_01（共 12 章）

### 字数分布表

| 章号 | 字数 | 目标 | 偏差% | 状态 |
|---|---|---|---|---|
| ch_001 | 2847 | 2800 | +1.7% | ✅ |
| ch_002 | 2956 | 2800 | +5.6% | ✅ |
| ch_003 | 1645 | 2800 | -41.3% | ⚠️ 过短 |
| ... | ... | ... | ... | ... |
| ch_012 | 5234 | 3000 | +74.5% | ⚠️ 过长 |

### 卷级统计

- 章节数：12
- 总字数：32156
- 均值：2680
- 标准差：892
- 变异系数：33.3%（> 20% 节奏不稳定）
- 最短章：ch_003（1645 字）
- 最长章：ch_012（5234 字）
```

#### 5.2.2 ASCII 折线图

```
### 字数曲线（ASCII）

ch_001  ████████████████░░░░░░░░░░  2847
ch_002  █████████████████░░░░░░░░░  2956
ch_003  █████████░░░░░░░░░░░░░░░░░  1645 ⚠️
ch_004  ██████████████░░░░░░░░░░░░  2534
ch_005  ██████████████░░░░░░░░░░░░  2601
ch_006  █████████████░░░░░░░░░░░░░  2412
ch_007  ██████████████░░░░░░░░░░░░  2567
ch_008  █████████████░░░░░░░░░░░░░  2398
ch_009  ██████████████░░░░░░░░░░░░  2545
ch_010  ██████████████░░░░░░░░░░░░  2623
ch_011  ██████████████████░░░░░░░░  3145
ch_012  ██████████████████████████  5234 ⚠️

均值线  ██████████████░░░░░░░░░░░░  2680
```

**实现要点**：每章一行，柱长 = `int(word_count / max_wc * 26)`，最长 26 字符。末尾标注字数与异常标记。

#### 5.2.3 异常告警清单

```markdown
### 异常告警

#### 🔴 前紧后松（front_heavy_back_light）

- 卷 01 前 4 章均值 2851 字，后 8 章均值 2424 字，比值 1.18
- 状态：未触发（阈值 1.3）

#### 🔴 卷末灌水（volume_end_bloat）

- 卷 01 末 3 章均值 3667 字，卷均值 2680 字，比值 1.37
- 状态：未触发（阈值 1.5）

#### 🟡 单章过短（chapter_too_short < 1500）

- ch_003（卷 01）：1645 字  ← 注意：未触发 1500 阈值，但 check_ai_novel.py 已 P0 阻断（< 1600）

#### 🔴 单章过长（chapter_too_long > 5000）

- ch_012（卷 01）：5234 字
- 建议：拆分为两章，或在 published 前精修删减冗余景物
```

### 5.3 visualize_length_curve.py 完整脚本逻辑

脚本位于 `file:///workspace/scripts/novelforge/visualize_length_curve.py`，纯标准库（json/os/sys/argparse/statistics/datetime），与 NovelForge 既有脚本风格一致。

```python
"""NovelForge 章节字数曲线可视化脚本。

基于 .state/chapter_length_history.json 生成卷级字数分布报告，
检测 4 类异常：前紧后松 / 卷末灌水 / 单章过短 / 单章过长。

设计哲学：
- Vault SSOT：字数历史来自 .state/chapter_length_history.json
- 纯标准库：仅依赖 json/os/sys/argparse/statistics/datetime
- 模板友好：chapters 为空时返回空报告，不崩溃
- 不阻断：异常仅告警，退出码始终 0（除非脚本错误）

CLI 速查：
    # 可视化当前卷
    python -m scripts.novelforge.visualize_length_curve --vault NovelForge_Vault

    # 可视化指定卷
    python -m scripts.novelforge.visualize_length_curve --volume 2

    # 可视化全卷
    python -m scripts.novelforge.visualize_length_curve --all-volumes

    # 写入报告到文件（默认输出 stdout）
    python -m scripts.novelforge.visualize_length_curve --output reports/length_curve.md

    # 更新字数历史（writer-polisher Skill 调用）
    python -m scripts.novelforge.visualize_length_curve --update ch_042 2847 --target 2800

退出码：
    0 - 报告生成成功（即使有异常告警）
    2 - 脚本错误（文件缺失 / 参数错误等）
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from statistics import mean, pstdev
from typing import Any

# ============================================================================
# 常量
# ============================================================================
DEFAULT_VAULT: str = "/workspace/NovelForge_Vault"

LENGTH_HISTORY_REL: str = ".state/chapter_length_history.json"
PIPELINE_REL: str = ".state/pipeline.json"

# 4 类异常阈值
FRONT_HEAVY_RATIO: float = 1.3       # 前 1/3 均值 > 后 2/3 均值 × 1.3
VOLUME_END_BLOAT_RATIO: float = 1.5  # 末 3 章均值 > 卷均值 × 1.5
CHAPTER_TOO_SHORT: int = 1500
CHAPTER_TOO_LONG: int = 5000

# 卷级节奏稳定度
VOLUME_MIN_CHAPTERS: int = 6          # < 此数不判断分布异常
VARIATION_COEFF_THRESHOLD: float = 0.20  # 变异系数阈值

# ASCII 折线图
ASCII_BAR_MAX_LEN: int = 26


# ============================================================================
# 数据类
# ============================================================================
@dataclass
class Anomaly:
    """单条异常告警。"""
    type: str          # front_heavy_back_light / volume_end_bloat / chapter_too_short / chapter_too_long
    severity: str      # "warning" / "critical"
    detail: str
    suggestion: str
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass
class VolumeReport:
    """单卷报告。"""
    volume: int
    chapters: list[dict[str, Any]]   # 该卷所有章节记录
    anomalies: list[Anomaly] = field(default_factory=list)
    total_words: int = 0
    mean_words: float = 0.0
    stdev_words: float = 0.0
    variation_coeff: float = 0.0
    min_chapter: tuple[str, int] = ("", 0)  # (ch_id, word_count)
    max_chapter: tuple[str, int] = ("", 0)


# ============================================================================
# IO 辅助
# ============================================================================
def load_length_history(vault: str) -> list[dict[str, Any]]:
    """加载 chapter_length_history.json 的 chapters 数组。"""
    path = os.path.join(vault, LENGTH_HISTORY_REL)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    chapters = data.get("chapters", []) or []
    return [c for c in chapters if isinstance(c, dict)]


def load_current_volume(vault: str) -> int:
    """从 pipeline.json 读当前卷号，失败返回 1。"""
    path = os.path.join(vault, PIPELINE_REL)
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        vol = data.get("current_volume", 1)
        if isinstance(vol, int) and vol >= 1:
            return vol
    except (OSError, json.JSONDecodeError):
        pass
    return 1


def save_length_history(vault: str, chapters: list[dict[str, Any]]) -> None:
    """原子写入 chapter_length_history.json。"""
    path = os.path.join(vault, LENGTH_HISTORY_REL)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "_comment": "章节字数历史。记录每章实际成稿字数，用于均值计算与节奏控制。",
        "_comment_purpose": "architect 写新章纲时参考最近 N 章均值设定字数目标；polisher 校验成稿字数是否在 ±10% 区间。",
        "_comment_chapters_entry": "chapters 数组每条含：ch=章号 / vol=卷号 / word_count=字数 / target=目标字数 / mode=novel|shortform",
        "version": "1.0.0",
        "chapters": chapters,
    }
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


# ============================================================================
# 异常检测
# ============================================================================
def detect_front_heavy_back_light(wcs: list[int]) -> Anomaly | None:
    """前紧后松：前 1/3 均值 > 后 2/3 均值 × 1.3。"""
    n = len(wcs)
    if n < VOLUME_MIN_CHAPTERS:
        return None
    front_n = max(1, n // 3)
    front_mean = mean(wcs[:front_n])
    back_mean = mean(wcs[front_n:])
    if back_mean == 0:
        return None
    ratio = front_mean / back_mean
    if ratio > FRONT_HEAVY_RATIO:
        return Anomaly(
            type="front_heavy_back_light",
            severity="warning",
            detail=(
                f"前 {front_n} 章均值 {front_mean:.0f} 字，"
                f"后 {n - front_n} 章均值 {back_mean:.0f} 字，"
                f"比值 {ratio:.2f}（阈值 {FRONT_HEAVY_RATIO}）"
            ),
            suggestion="后段章节扩展冲突细节或对话，避免剧情坍塌；或在章纲阶段重新平衡字数目标。",
            extras={
                "front_mean": front_mean,
                "back_mean": back_mean,
                "ratio": ratio,
                "threshold": FRONT_HEAVY_RATIO,
            },
        )
    return None


def detect_volume_end_bloat(wcs: list[int]) -> Anomaly | None:
    """卷末灌水：末 3 章均值 > 卷均值 × 1.5。"""
    n = len(wcs)
    if n < VOLUME_MIN_CHAPTERS:
        return None
    end_n = min(3, n)
    end_mean = mean(wcs[-end_n:])
    vol_mean = mean(wcs)
    if vol_mean == 0:
        return None
    ratio = end_mean / vol_mean
    if ratio > VOLUME_END_BLOAT_RATIO:
        return Anomaly(
            type="volume_end_bloat",
            severity="warning",
            detail=(
                f"末 {end_n} 章均值 {end_mean:.0f} 字，"
                f"卷均值 {vol_mean:.0f} 字，"
                f"比值 {ratio:.2f}（阈值 {VOLUME_END_BLOAT_RATIO}）"
            ),
            suggestion="卷末章节删减冗余景物/独白，或将部分剧情前置到中段；避免为收尾强行注水。",
            extras={
                "end_mean": end_mean,
                "vol_mean": vol_mean,
                "ratio": ratio,
                "threshold": VOLUME_END_BLOAT_RATIO,
            },
        )
    return None


def detect_chapter_too_short(ch_id: str, vol: int, wc: int) -> Anomaly | None:
    if wc < CHAPTER_TOO_SHORT:
        return Anomaly(
            type="chapter_too_short",
            severity="critical",
            detail=f"{ch_id}（卷 {vol}）：{wc} 字（< {CHAPTER_TOO_SHORT}）",
            suggestion="扩展场景描写或对话，或与相邻章合并；注意 check_ai_novel.py 硬下限 1600 字会阻断 published。",
            extras={"ch": ch_id, "vol": vol, "word_count": wc, "threshold": CHAPTER_TOO_SHORT},
        )
    return None


def detect_chapter_too_long(ch_id: str, vol: int, wc: int) -> Anomaly | None:
    if wc > CHAPTER_TOO_LONG:
        return Anomaly(
            type="chapter_too_long",
            severity="critical",
            detail=f"{ch_id}（卷 {vol}）：{wc} 字（> {CHAPTER_TOO_LONG}）",
            suggestion="拆分为两章，或删减冗余景物/独白；shortform 模式下考虑精简到 6k 以内。",
            extras={"ch": ch_id, "vol": vol, "word_count": wc, "threshold": CHAPTER_TOO_LONG},
        )
    return None


def detect_all_for_volume(vol_chapters: list[dict[str, Any]], vol: int) -> list[Anomaly]:
    """对单卷跑 4 类异常检测。"""
    anomalies: list[Anomaly] = []
    wcs = [c.get("word_count", 0) for c in vol_chapters if isinstance(c.get("word_count"), int)]
    if not wcs:
        return anomalies

    # 卷级分布异常
    fh = detect_front_heavy_back_light(wcs)
    if fh:
        anomalies.append(fh)
    eb = detect_volume_end_bloat(wcs)
    if eb:
        anomalies.append(eb)

    # 单章异常
    for c in vol_chapters:
        ch_id = f"ch_{c.get('ch', 0):03d}" if isinstance(c.get("ch"), int) else str(c.get("ch", "?"))
        wc = c.get("word_count", 0)
        if not isinstance(wc, int):
            continue
        ts = detect_chapter_too_short(ch_id, vol, wc)
        if ts:
            anomalies.append(ts)
        tl = detect_chapter_too_long(ch_id, vol, wc)
        if tl:
            anomalies.append(tl)

    return anomalies


# ============================================================================
# 报告渲染
# ============================================================================
def build_volume_report(vol: int, vol_chapters: list[dict[str, Any]]) -> VolumeReport:
    """构建单卷报告对象。"""
    report = VolumeReport(volume=vol, chapters=vol_chapters)
    wcs = [c.get("word_count", 0) for c in vol_chapters if isinstance(c.get("word_count"), int)]
    if not wcs:
        return report
    report.total_words = sum(wcs)
    report.mean_words = mean(wcs)
    report.stdev_words = pstdev(wcs) if len(wcs) >= 2 else 0.0
    report.variation_coeff = report.stdev_words / report.mean_words if report.mean_words > 0 else 0.0
    # 最短/最长
    sorted_by_wc = sorted(vol_chapters, key=lambda c: c.get("word_count", 0) if isinstance(c.get("word_count"), int) else 0)
    if sorted_by_wc:
        min_c = sorted_by_wc[0]
        max_c = sorted_by_wc[-1]
        report.min_chapter = (f"ch_{min_c.get('ch', 0):03d}", min_c.get("word_count", 0))
        report.max_chapter = (f"ch_{max_c.get('ch', 0):03d}", max_c.get("word_count", 0))
    report.anomalies = detect_all_for_volume(vol_chapters, vol)
    return report


def render_ascii_bar(wc: int, max_wc: int, label: str, marker: str = "") -> str:
    """渲染单行 ASCII 柱。"""
    if max_wc <= 0:
        ratio = 0.0
    else:
        ratio = wc / max_wc
    bar_len = int(ratio * ASCII_BAR_MAX_LEN)
    bar = "█" * bar_len + "░" * (ASCII_BAR_MAX_LEN - bar_len)
    return f"{label}  {bar}  {wc}{marker}"


def render_volume_report(report: VolumeReport) -> str:
    """渲染单卷 Markdown 报告。"""
    lines: list[str] = []
    lines.append(f"## 卷 {report.volume:02d} 字数分布报告")
    lines.append("")
    lines.append(f"> 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"> 数据源：.state/chapter_length_history.json")
    lines.append(f"> 章节数：{len(report.chapters)}")
    lines.append("")

    if not report.chapters:
        lines.append("（无章节数据）")
        return "\n".join(lines)

    # 字数分布表
    lines.append("### 字数分布表")
    lines.append("")
    lines.append("| 章号 | 字数 | 目标 | 偏差% | 状态 |")
    lines.append("|---|---|---|---|---|")
    for c in report.chapters:
        ch_id = f"ch_{c.get('ch', 0):03d}" if isinstance(c.get("ch"), int) else str(c.get("ch", "?"))
        wc = c.get("word_count", 0) if isinstance(c.get("word_count"), int) else 0
        target = c.get("target", 0) if isinstance(c.get("target"), int) else 0
        dev = f"{(wc - target) / target * 100:+.1f}%" if target > 0 else "—"
        status = "✅"
        if wc < CHAPTER_TOO_SHORT:
            status = "⚠️ 过短"
        elif wc > CHAPTER_TOO_LONG:
            status = "⚠️ 过长"
        lines.append(f"| {ch_id} | {wc} | {target or '—'} | {dev} | {status} |")
    lines.append("")

    # 卷级统计
    lines.append("### 卷级统计")
    lines.append("")
    lines.append(f"- 章节数：{len(report.chapters)}")
    lines.append(f"- 总字数：{report.total_words}")
    lines.append(f"- 均值：{report.mean_words:.0f}")
    lines.append(f"- 标准差：{report.stdev_words:.0f}")
    lines.append(f"- 变异系数：{report.variation_coeff * 100:.1f}%（> 20% 节奏不稳定）")
    lines.append(f"- 最短章：{report.min_chapter[0]}（{report.min_chapter[1]} 字）")
    lines.append(f"- 最长章：{report.max_chapter[0]}（{report.max_chapter[1]} 字）")
    lines.append("")

    # ASCII 折线图
    lines.append("### 字数曲线（ASCII）")
    lines.append("")
    lines.append("```")
    max_wc = max(
        (c.get("word_count", 0) for c in report.chapters if isinstance(c.get("word_count"), int)),
        default=0,
    )
    for c in report.chapters:
        ch_id = f"ch_{c.get('ch', 0):03d}" if isinstance(c.get("ch"), int) else str(c.get("ch", "?"))
        wc = c.get("word_count", 0) if isinstance(c.get("word_count"), int) else 0
        marker = ""
        if wc < CHAPTER_TOO_SHORT or wc > CHAPTER_TOO_LONG:
            marker = " ⚠️"
        lines.append(render_ascii_bar(wc, max_wc, ch_id, marker))
    # 均值线
    if report.mean_words > 0:
        lines.append(render_ascii_bar(int(report.mean_words), max_wc, "均值线"))
    lines.append("```")
    lines.append("")

    # 异常告警
    lines.append("### 异常告警")
    lines.append("")
    if not report.anomalies:
        lines.append("✅ 无异常")
        lines.append("")
        return "\n".join(lines)

    # 按 type 分组
    by_type: dict[str, list[Anomaly]] = {}
    for a in report.anomalies:
        by_type.setdefault(a.type, []).append(a)

    type_labels = {
        "front_heavy_back_light": "前紧后松（front_heavy_back_light）",
        "volume_end_bloat": "卷末灌水（volume_end_bloat）",
        "chapter_too_short": "单章过短（chapter_too_short < 1500）",
        "chapter_too_long": "单章过长（chapter_too_long > 5000）",
    }
    sev_emoji = {"warning": "🟡", "critical": "🔴"}

    for t in ("front_heavy_back_light", "volume_end_bloat", "chapter_too_short", "chapter_too_long"):
        items = by_type.get(t, [])
        if not items:
            # 显示"未触发"以便作者确认检测覆盖
            lines.append(f"#### {sev_emoji['warning']} {type_labels[t]}")
            lines.append("")
            lines.append("- 状态：未触发")
            lines.append("")
            continue
        lines.append(f"#### {sev_emoji.get(items[0].severity, '⚪')} {type_labels[t]}")
        lines.append("")
        for a in items:
            lines.append(f"- {a.detail}")
            lines.append(f"  - 建议：{a.suggestion}")
        lines.append("")

    return "\n".join(lines)


def render_json_report(reports: list[VolumeReport]) -> str:
    """渲染 JSON 报告（供 Trae Skill 解析）。"""
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "volumes": [
            {
                "volume": r.volume,
                "chapter_count": len(r.chapters),
                "total_words": r.total_words,
                "mean_words": round(r.mean_words, 2),
                "stdev_words": round(r.stdev_words, 2),
                "variation_coeff": round(r.variation_coeff, 4),
                "min_chapter": r.min_chapter,
                "max_chapter": r.max_chapter,
                "anomalies": [
                    {
                        "type": a.type,
                        "severity": a.severity,
                        "detail": a.detail,
                        "suggestion": a.suggestion,
                        "extras": a.extras,
                    }
                    for a in r.anomalies
                ],
            }
            for r in reports
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ============================================================================
# 字数历史更新（writer-polisher 调用）
# ============================================================================
def update_length_history(
    vault: str,
    ch_num: int,
    word_count: int,
    target: int = 0,
    mode: str = "novel",
) -> None:
    """更新字数历史：若该章已存在则覆盖，否则追加。

    Args:
        vault: Vault 根目录
        ch_num: 章号（整数）
        word_count: 实际字数
        target: 目标字数（可选）
        mode: novel / shortform
    """
    chapters = load_length_history(vault)
    vol = load_current_volume(vault)
    # 查找已有记录
    found = False
    for c in chapters:
        if c.get("ch") == ch_num:
            c["word_count"] = word_count
            c["vol"] = vol
            if target:
                c["target"] = target
            c["mode"] = mode
            found = True
            break
    if not found:
        chapters.append({
            "ch": ch_num,
            "vol": vol,
            "word_count": word_count,
            "target": target,
            "mode": mode,
        })
    # 按 ch 升序排序
    chapters.sort(key=lambda c: c.get("ch", 0) if isinstance(c.get("ch"), int) else 0)
    save_length_history(vault, chapters)


# ============================================================================
# 主入口
# ============================================================================
def run_report(
    vault: str,
    volume: int | None = None,
    all_volumes: bool = False,
) -> list[VolumeReport]:
    """生成报告列表。"""
    chapters = load_length_history(vault)
    if not chapters:
        return []

    # 按卷分组
    by_vol: dict[int, list[dict[str, Any]]] = {}
    for c in chapters:
        v = c.get("vol", 1) if isinstance(c.get("vol"), int) else 1
        by_vol.setdefault(v, []).append(c)

    # 选择目标卷
    if all_volumes:
        target_vols = sorted(by_vol.keys())
    elif volume is not None:
        target_vols = [volume]
    else:
        target_vols = [load_current_volume(vault)]

    reports: list[VolumeReport] = []
    for v in target_vols:
        vol_chs = by_vol.get(v, [])
        if not vol_chs:
            continue
        # 按章号升序
        vol_chs.sort(key=lambda c: c.get("ch", 0) if isinstance(c.get("ch"), int) else 0)
        reports.append(build_volume_report(v, vol_chs))
    return reports


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.novelforge.visualize_length_curve",
        description="NovelForge 章节字数曲线可视化 + 4 类异常检测",
    )
    parser.add_argument("--vault", default=DEFAULT_VAULT, help=f"Vault 根目录（默认 {DEFAULT_VAULT}）")
    parser.add_argument("--volume", type=int, default=None, help="指定卷号（默认当前卷）")
    parser.add_argument("--all-volumes", action="store_true", help="可视化全部卷")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    parser.add_argument("--output", default=None, help="写入文件路径（默认 stdout）")
    # 更新模式
    parser.add_argument("--update", nargs=2, metavar=("CH_ID", "WORD_COUNT"),
                        help="更新字数历史，例：--update ch_042 2847")
    parser.add_argument("--target", type=int, default=0, help="配合 --update 指定目标字数")
    parser.add_argument("--mode", default="novel", choices=["novel", "shortform"], help="配合 --update 指定模式")
    args = parser.parse_args(argv)

    vault = args.vault
    if not os.path.isdir(vault):
        print(f"[错误] Vault 路径不存在: {vault}", file=sys.stderr)
        return 2

    # 更新模式
    if args.update:
        ch_id_str, wc_str = args.update
        # 解析 ch_042 → 42
        import re
        m = re.search(r"(\d+)", ch_id_str)
        if not m:
            print(f"[错误] 章号格式无效: {ch_id_str}（期望 ch_042 或 42）", file=sys.stderr)
            return 2
        ch_num = int(m.group(1))
        try:
            wc = int(wc_str)
        except ValueError:
            print(f"[错误] 字数无效: {wc_str}", file=sys.stderr)
            return 2
        update_length_history(vault, ch_num, wc, target=args.target, mode=args.mode)
        print(f"[OK] 已更新 {ch_id_str} 字数历史：{wc} 字（target={args.target}, mode={args.mode}）")
        return 0

    # 报告模式
    reports = run_report(vault, volume=args.volume, all_volumes=args.all_volumes)
    if not reports:
        msg = "[警告] 无字数历史数据，请先通过 --update 写入。"
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(msg + "\n")
        else:
            print(msg)
        return 0

    if args.json:
        output = render_json_report(reports)
    else:
        parts = [render_volume_report(r) for r in reports]
        output = "\n---\n\n".join(parts)

    if args.output:
        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output + "\n")
        print(f"[OK] 报告已写入 {args.output}")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 5.4 writer-polisher SKILL.md 每章后更新字数历史并触发可视化的指令

在 `file:///workspace/.trae/skills/writer-polisher/SKILL.md` 的"阶段四：状态更新"中，在第 3 步（调用 `save_state.py`）与第 4 步（写入章末摘要）之间插入新步骤：

```markdown
### 第 3.5 步：更新字数历史并触发可视化

> novel 模式必须执行；shortform 模式可选。

#### 3.5.1 统计本章字数

使用 `check_ai_novel.py` 同口径的字数统计（去 frontmatter、去标点空白）。可从阶段二审计报告的 `word_count` 字段直接取。

#### 3.5.2 调用 visualize_length_curve.py 更新字数历史

```bash
python -m scripts.novelforge.visualize_length_curve \
  --vault NovelForge_Vault \
  --update ch_<NNN> <word_count> \
  --target <target_word_count> \
  --mode novel
```

- `<NNN>`：三位补零章号，如 `ch_042`
- `<word_count>`：本章实际字数
- `<target_word_count>`：章纲设定目标字数（若无则填 0）
- `--mode`：novel / shortform

#### 3.5.3 触发卷级可视化（每 5 章或卷末）

判断条件（满足任一即触发）：
- `(current_chapter % 5 == 0)`：每 5 章一次
- 章纲类型为 `vol_end` / `volume_end`：卷末必触发
- 检测到 `check_ai_novel.py` 第 7 维 P0/P1 字数问题：立即触发

```bash
python -m scripts.novelforge.visualize_length_curve \
  --vault NovelForge_Vault \
  --output NovelForge_Vault/.state/length_curve_report.md
```

#### 3.5.4 解读报告

读取生成的 `length_curve_report.md`，关注：
- 🔴 单章过短/过长：定点修复本章
- 🟡 前紧后松/卷末灌水：在下章章纲中调整字数目标，向后段倾斜
- 变异系数 > 20%：全卷节奏不稳，建议 architect Skill 重新平衡章纲字数目标

#### 3.5.5 异常处置

| 场景 | 处置 |
|---|---|
| `chapter_length_history.json` 不存在 | 脚本自动创建，无需预处理 |
| `--update` 失败（章号解析错） | 检查 ch_NNN 格式，三位补零 |
| 字数历史为空首次运行 | 报告输出"无章节数据"，不阻断；下次写入后正常 |
| 报告生成失败 | 不阻断 published，但需在阶段四验证步骤标注降级 |

#### 3.5.6 验证

- `length_curve_report.md` 已写入 `.state/`（或 stdout 已输出）
- `chapter_length_history.json` 的 `chapters` 数组已含本章记录
- 退出码 0 = 成功；非 0 = 失败，按 §错误处理 提示重试
```

### 5.5 dev-checklist.md 新增检测项文案

在 `file:///workspace/.trae/checklists/dev-checklist.md` 的"一、创作质量"节末尾（第 17 行"节奏得当"项之后）新增一项：

```markdown
- [ ] 字数曲线异常：`python scripts/novelforge/visualize_length_curve.py --vault NovelForge_Vault` 未触发前紧后松 / 卷末灌水 / 单章过短 / 单章过长告警；卷级变异系数 ≤ 20%
```

同时在"七、LoopAgent 沉淀"节中追加一条提示（在"是否需要更新本 checklist"项之后）：

```markdown
- [ ] 字数曲线可视化报告（.state/length_curve_report.md）已生成并解读，4 类异常已记录或修复
```

---

## 六、验证方式

### 6.1 单元测试

```bash
pytest -q tests/test_length_curve.py
```

测试用例覆盖 4 类异常 + 报告生成 + 正常波动不误伤，详见第七节。

### 6.2 集成测试 1：空数据不崩溃

```bash
# 现状：chapter_length_history.json 的 chapters 为空
python -m scripts.novelforge.visualize_length_curve --vault NovelForge_Vault
# 期望：输出"[警告] 无字数历史数据"，退出码 0
```

### 6.3 集成测试 2：构造异常字数数据，验证 4 类告警

```bash
# 步骤 1：写入构造数据（前紧后松 + 卷末灌水 + 单章过短 + 单章过长）
python -m scripts.novelforge.visualize_length_curve --update ch_001 3200 --target 2800
python -m scripts.novelforge.visualize_length_curve --update ch_002 3100 --target 2800
python -m scripts.novelforge.visualize_length_curve --update ch_003 3300 --target 2800
python -m scripts.novelforge.visualize_length_curve --update ch_004 1400 --target 2800  # 过短
python -m scripts.novelforge.visualize_length_curve --update ch_005 2000 --target 2800
python -m scripts.novelforge.visualize_length_curve --update ch_006 1800 --target 2800
python -m scripts.novelforge.visualize_length_curve --update ch_007 1900 --target 2800
python -m scripts.novelforge.visualize_length_curve --update ch_008 2000 --target 2800
python -m scripts.novelforge.visualize_length_curve --update ch_009 2100 --target 2800
python -m scripts.novelforge.visualize_length_curve --update ch_010 5200 --target 3000  # 过长 + 卷末灌水
python -m scripts.novelforge.visualize_length_curve --update ch_011 5300 --target 3000
python -m scripts.novelforge.visualize_length_curve --update ch_012 5400 --target 3000

# 步骤 2：生成报告
python -m scripts.novelforge.visualize_length_curve --vault NovelForge_Vault --output /tmp/test_report.md

# 步骤 3：验证 4 类告警全部触发
grep -c "front_heavy_back_light" /tmp/test_report.md  # 期望 ≥ 1
grep -c "volume_end_bloat" /tmp/test_report.md         # 期望 ≥ 1
grep -c "chapter_too_short" /tmp/test_report.md        # 期望 ≥ 1
grep -c "chapter_too_long" /tmp/test_report.md         # 期望 ≥ 1
```

### 6.4 集成测试 3：正常波动不误伤

```bash
# 构造字数均匀的卷（均值 2800，标准差 100，变异系数 ~3.6%）
for i in 2700 2750 2800 2850 2780 2820 2790 2810 2770 2830 2760 2840; do
  ch=$(printf "ch_%03d" $((RANDOM % 100 + 1)))
  python -m scripts.novelforge.visualize_length_curve --update $ch $i --target 2800
done
python -m scripts.novelforge.visualize_length_curve --vault NovelForge_Vault --json | python -c "
import json, sys
data = json.load(sys.stdin)
anomalies = [a for v in data['volumes'] for a in v['anomalies']]
assert not anomalies, f'误伤：{anomalies}'
print('✅ 正常波动未触发告警')
"
```

### 6.5 断言清单

| 断言 | 验证方式 |
|---|---|
| 4 类异常可独立触发 | `pytest -q tests/test_length_curve.py::test_front_heavy_back_light_detection` 等 4 个测试 |
| 4 类异常互不误伤 | 单一异常构造数据，断言仅触发预期类型 |
| 可视化报告可生成 | `pytest -q tests/test_length_curve.py::test_visualize_length_curve_runs` |
| 正常波动不触发 | `pytest -q tests/test_length_curve.py::test_normal_curve_not_flagged` |
| 空数据不崩溃 | 集成测试 1 |
| JSON 报告可被解析 | `--json` 输出可被 `json.loads` 解析 |

---

## 七、回归测试要求

### 7.1 新增 `file:///workspace/tests/test_length_curve.py`

至少 6 个测试用例，使用 `pytest` + `tmp_path` fixture 构造临时 Vault，避免污染真实状态机。

```python
"""M15 字数曲线可视化回归测试。

覆盖 4 类异常检测 + 报告生成 + 正常波动不误伤。
"""
import json
import os
import sys
from pathlib import Path

import pytest

# 让测试能 import scripts.novelforge.visualize_length_curve
sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.novelforge.visualize_length_curve import (
    CHAPTER_TOO_LONG,
    CHAPTER_TOO_SHORT,
    FRONT_HEAVY_RATIO,
    VOLUME_END_BLOAT_RATIO,
    Anomaly,
    build_volume_report,
    detect_all_for_volume,
    detect_chapter_too_long,
    detect_chapter_too_short,
    detect_front_heavy_back_light,
    detect_volume_end_bloat,
    load_length_history,
    main,
    render_volume_report,
    update_length_history,
)


# ---------- fixtures ----------
@pytest.fixture
def fake_vault(tmp_path: Path) -> Path:
    """构造空 Vault，含 pipeline.json 指向 vol_01。"""
    state_dir = tmp_path / ".state"
    state_dir.mkdir(parents=True)
    # pipeline.json
    (state_dir / "pipeline.json").write_text(
        json.dumps({"current_volume": 1, "current_chapter": 0}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # 空 chapter_length_history.json
    (state_dir / "chapter_length_history.json").write_text(
        json.dumps({"version": "1.0.0", "chapters": []}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return tmp_path


def _make_chapters(vol: int, wcs: list[int]) -> list[dict]:
    return [
        {"ch": i + 1, "vol": vol, "word_count": wc, "target": 2800, "mode": "novel"}
        for i, wc in enumerate(wcs)
    ]


# ---------- 1. 前紧后松 ----------
def test_front_heavy_back_light_detection(fake_vault: Path):
    """前 1/3 均值 > 后 2/3 均值 × 1.3 → 触发。"""
    # 6 章：前 2 章 4000，后 4 章 2000，比值 2.0 > 1.3
    chapters = _make_chapters(1, [4000, 4000, 2000, 2000, 2000, 2000])
    anomalies = detect_all_for_volume(chapters, 1)
    types = [a.type for a in anomalies]
    assert "front_heavy_back_light" in types, f"未触发前紧后松：{types}"

    # 反例：均匀分布不触发
    chapters_uniform = _make_chapters(1, [2800, 2820, 2790, 2810, 2780, 2800])
    anomalies_uniform = detect_all_for_volume(chapters_uniform, 1)
    types_uniform = [a.type for a in anomalies_uniform]
    assert "front_heavy_back_light" not in types_uniform


# ---------- 2. 卷末灌水 ----------
def test_volume_end_bloat_detection(fake_vault: Path):
    """末 3 章均值 > 卷均值 × 1.5 → 触发。"""
    # 9 章：前 6 章 2000，末 3 章 5000，卷均值 2666，末均值 5000，比值 1.875 > 1.5
    chapters = _make_chapters(1, [2000] * 6 + [5000, 5000, 5000])
    anomalies = detect_all_for_volume(chapters, 1)
    types = [a.type for a in anomalies]
    assert "volume_end_bloat" in types, f"未触发卷末灌水：{types}"

    # 反例：末 3 章略高但不超阈值
    chapters_ok = _make_chapters(1, [2800, 2800, 2800, 2800, 2800, 2800, 3200, 3200, 3200])
    anomalies_ok = detect_all_for_volume(chapters_ok, 1)
    types_ok = [a.type for a in anomalies_ok]
    assert "volume_end_bloat" not in types_ok


# ---------- 3. 单章过短 ----------
def test_chapter_too_short_detection(fake_vault: Path):
    """word_count < 1500 → 触发。"""
    a = detect_chapter_too_short("ch_003", 1, 1499)
    assert a is not None
    assert a.type == "chapter_too_short"
    assert a.severity == "critical"

    # 1500 字边界不触发
    a_boundary = detect_chapter_too_short("ch_003", 1, 1500)
    assert a_boundary is None

    # 1501 字不触发
    a_above = detect_chapter_too_short("ch_003", 1, 1501)
    assert a_above is None


# ---------- 4. 单章过长 ----------
def test_chapter_too_long_detection(fake_vault: Path):
    """word_count > 5000 → 触发。"""
    a = detect_chapter_too_long("ch_042", 1, 5001)
    assert a is not None
    assert a.type == "chapter_too_long"
    assert a.severity == "critical"

    # 5000 字边界不触发
    a_boundary = detect_chapter_too_long("ch_042", 1, 5000)
    assert a_boundary is None

    # 4999 字不触发
    a_below = detect_chapter_too_long("ch_042", 1, 4999)
    assert a_below is None


# ---------- 5. 报告生成 ----------
def test_visualize_length_curve_runs(fake_vault: Path, capsys):
    """端到端：update + report 流程不崩溃。"""
    # 更新 3 章字数
    update_length_history(str(fake_vault), 1, 2800, target=2800)
    update_length_history(str(fake_vault), 2, 2900, target=2800)
    update_length_history(str(fake_vault), 3, 2750, target=2800)

    # CLI 运行
    rc = main(["--vault", str(fake_vault), "--json"])
    assert rc == 0
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert "volumes" in payload
    assert len(payload["volumes"]) == 1
    assert payload["volumes"][0]["volume"] == 1
    assert payload["volumes"][0]["chapter_count"] == 3

    # Markdown 报告也能生成
    rc_md = main(["--vault", str(fake_vault)])
    assert rc_md == 0


# ---------- 6. 正常波动不误伤 ----------
def test_normal_curve_not_flagged(fake_vault: Path):
    """变异系数 ≤ 20% 且无单章越界 → 0 异常。"""
    # 12 章，均值 2800，标准差 ~50，变异系数 ~1.8%
    chapters = _make_chapters(1, [
        2800, 2820, 2790, 2810, 2780, 2800,
        2815, 2795, 2805, 2785, 2825, 2775,
    ])
    anomalies = detect_all_for_volume(chapters, 1)
    assert anomalies == [], f"正常波动误伤：{[a.type for a in anomalies]}"

    # 端到端验证
    for c in chapters:
        update_length_history(str(fake_vault), c["ch"], c["word_count"], target=2800)
    rc = main(["--vault", str(fake_vault), "--json"])
    assert rc == 0
    # （输出校验已在 test_visualize_length_curve_runs 覆盖）


# ---------- 补充：章数 < 6 不判断分布异常 ----------
def test_too_few_chapters_skip_distribution_check(fake_vault: Path):
    """章数 < 6 时跳过 front_heavy / volume_end_bloat，仅检测单章越界。"""
    chapters = _make_chapters(1, [4000, 1400, 5000])  # 3 章
    anomalies = detect_all_for_volume(chapters, 1)
    types = [a.type for a in anomalies]
    # 仅触发单章异常
    assert "front_heavy_back_light" not in types
    assert "volume_end_bloat" not in types
    assert "chapter_too_short" in types
    assert "chapter_too_long" in types
```

### 7.2 新增 BUG-065

按 `file:///workspace/.trae/rules/bug-reporting.md` 规范，在 `file:///workspace/tests/bug_regression_list.md` 中追加：

```markdown
## 字数曲线无异常检测导致前紧后松/卷末灌水

- **编号**：BUG-065
- **首次出现**：2026-07-18
- **类型**：内容质量
- **现象**：长篇小说卷内字数曲线失衡（前紧后松、卷末灌水、单章过短/过长）无任何工具检测，作者凭感觉写作易导致节奏坍塌、读者弃书；`check_ai_novel.py` 第 7 维仅覆盖单章硬边界（1600-3600）与近 10 章方差，无卷级分布视角。
- **根因**：`chapter_length_history.json` 数据 schema 已就绪但 `writer-polisher` Skill 完成章节后未写入字数历史；`save_state.py` 路由表不含 `chapter_length` 路径根；缺少卷级字数分布异常检测脚本。
- **修复**：
  1. 新增 `scripts/novelforge/visualize_length_curve.py`，提供字数历史更新（`--update`）与卷级可视化报告（`--volume` / `--all-volumes`）双模式 CLI；
  2. 实现 4 类异常检测：前紧后松（前 1/3 均值 > 后 2/3 × 1.3）、卷末灌水（末 3 章均值 > 卷均值 × 1.5）、单章过短（< 1500）、单章过长（> 5000）；
  3. 输出 Markdown 报告（表格 + ASCII 折线图）与 JSON 报告（供 Skill 解析）；
  4. `writer-polisher` SKILL.md 阶段四新增"第 3.5 步：更新字数历史并触发可视化"；
  5. `dev-checklist.md` 第一节新增字数曲线检测项。
- **涉及文件**：
  - 新增 `scripts/novelforge/visualize_length_curve.py`
  - 新增 `tests/test_length_curve.py`
  - 修改 `.trae/skills/writer-polisher/SKILL.md`
  - 修改 `.trae/checklists/dev-checklist.md`
- **回归测试**：`tests/test_length_curve.py` 新增 6 个用例（test_front_heavy_back_light_detection / test_volume_end_bloat_detection / test_chapter_too_short_detection / test_chapter_too_long_detection / test_visualize_length_curve_runs / test_normal_curve_not_flagged），并补充 1 个边界用例 test_too_few_chapters_skip_distribution_check。
- **教训/沉淀**：数据 schema 已就绪但无写入入口 = 死数据。新增状态文件时必须同步在 `writer-polisher` Skill 中明确"何时写入、由谁写入"，否则数据永远为空，下游检测无源可依。字数曲线问题归口"节奏质量"而非"状态漂移"，与 `check_consistency.py` 解耦，避免检测脚本职责膨胀。
```

---

## 八、风险点与回滚方案

### 8.1 风险等级

**低**

### 8.2 风险分析

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 字数历史为空（首次运行） | 高（当前现状） | 低（脚本输出"无数据"提示，不崩溃） | 集成测试 1 已覆盖 |
| 4 类异常阈值不合适导致误报/漏报 | 中 | 低（仅告警不阻断 published） | 阈值参数化（常量集中在文件头），可后续调优 |
| `writer-polisher` Skill 更新步骤被忽略 | 中 | 中（字数历史继续为空） | dev-checklist 新增检测项强制验证 |
| ASCII 折线图在 Windows 终端显示乱码 | 低 | 低（报告中字符是 UTF-8） | 写入文件用 `encoding="utf-8"`，stdout 由用户终端决定 |
| 与 `check_ai_novel.py` 第 7 维重复告警 | 低 | 低（阈值不同：1500 vs 1600 / 5000 vs 3600） | 文档明确"双层防护"定位，互不替代 |

### 8.3 对核心资产的影响

- **不修改** `save_state.py` / `check_consistency.py` / `check_ai_novel.py` 三个核心脚本
- **不修改** `chapter_length_history.json` 的 schema（只是开始有数据写入）
- **修改** `writer-polisher SKILL.md`（新增阶段四第 3.5 步，不影响既有四阶段流程）
- **修改** `dev-checklist.md`（新增检测项，不影响既有项）

### 8.4 回滚方案

1. **分支策略**：在 `feature/length-curve` 分支开发，合并到 master 前完整跑 `pytest -q` + `check_consistency.py` + `check_ai_novel.py` 三项校验。
2. **回滚步骤**：
   ```bash
   git checkout master
   git branch -D feature/length-curve
   ```
3. **数据回滚**：若 `chapter_length_history.json` 被写入错误数据，可清空 `chapters` 数组：
   ```bash
   python -c "
   import json
   with open('NovelForge_Vault/.state/chapter_length_history.json', 'r+', encoding='utf-8') as f:
       data = json.load(f)
       data['chapters'] = []
       f.seek(0)
       json.dump(data, f, ensure_ascii=False, indent=2)
       f.write('\n')
       f.truncate()
   "
   ```
4. **Skill 回滚**：`writer-polisher SKILL.md` 的第 3.5 步是新增内容，直接 git revert 即可，不影响既有阶段一至阶段四。

---

## 九、完成标准（DoD 清单）

- [ ] `file:///workspace/scripts/novelforge/visualize_length_curve.py` 脚本可运行（`python -m scripts.novelforge.visualize_length_curve --vault NovelForge_Vault` 退出码 0）
- [ ] 4 类异常检测生效（`detect_front_heavy_back_light` / `detect_volume_end_bloat` / `detect_chapter_too_short` / `detect_chapter_too_long` 函数已实现且通过测试）
- [ ] 可视化报告可生成（Markdown 表格 + ASCII 折线图 + JSON 双格式输出）
- [ ] `file:///workspace/.trae/skills/writer-polisher/SKILL.md` 已更新（阶段四新增第 3.5 步）
- [ ] `file:///workspace/.trae/checklists/dev-checklist.md` 已新增检测项
- [ ] `file:///workspace/tests/test_length_curve.py` 6 个用例全部通过（`pytest -q tests/test_length_curve.py` 退出码 0）
- [ ] `file:///workspace/tests/bug_regression_list.md` 已新增 BUG-065 条目
- [ ] 完整测试集通过：`python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` + `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` + `pytest -q` 三项均无新增失败
- [ ] LoopAgent 沉淀：在 `file:///workspace/docs/loop_log/2026-07.md` 追加一条 `#content_quality` 沉淀记录（"字数曲线异常检测的卷级视角补充"）

---

## 附录：与 NovelForge 核心哲学对齐

| 哲学 | M15 落实 |
|---|---|
| Vault SSOT | 字数历史唯一来源 `chapter_length_history.json`，脚本只读不直接编辑（通过 `update_length_history` 原子写入） |
| 纯标准库 | `visualize_length_curve.py` 仅依赖 json/os/sys/argparse/statistics/datetime/re，无第三方 |
| 模板友好 | chapters 为空时返回空报告，不崩溃；章数 < 6 时跳过分布异常检测 |
| 误报优先于漏报 | 4 类异常阈值偏宽松（1500/5000/1.3/1.5），宁可多报也勿放过 |
| 不阻断 | 异常仅告警，退出码始终 0（除非脚本错误），不影响 published 流程 |
| 与既有脚本解耦 | 不并入 `check_consistency.py`（非状态漂移）也不取代 `check_ai_novel.py` 第 7 维（非单章硬边界），独立成脚本 |
| Skill 不调度 sub-agents | `visualize_length_curve.py` 是 Python 脚本，由主 Agent 调用 CLI，符合 dev-workflow.md §零 路径 B |
```
