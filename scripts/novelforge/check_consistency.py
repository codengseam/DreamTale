"""NovelForge 跨章状态漂移检测脚本。

对比本章正文与 ``.state/`` 状态机，发现 7 类不一致即报警：

1. **境界跳级**（P0）—— 正文境界 > 状态机境界且本章无"突破/修炼/进阶"场景
2. **物品凭空**（P0）—— 正文使用物品但所有角色 inventory 均无且无"获得/拾取"场景
3. **关系突变**（P1）—— 正文关系 type 与状态机不一致且无关系转变场景
4. **位置穿越**（P0）—— 正文位置 ≠ 状态机位置且无"出发/到达/传送"描写
5. **伏笔遗忘**（P1）—— planted/hinted 伏笔超期未回收或长期未提醒
6. **角色复生**（P0）—— status=dead 角色在本章有台词/动作（非回忆/幻觉场景）
7. **金手指越界**（P1）—— 使用 abilities 列表外能力 / 违反 limitations / 单章使用 > 2 次

设计哲学：
- **Vault SSOT**：``.state/`` 状态机是唯一真相来源，脚本只读不写。
- **纯标准库**：仅依赖 json/re/os/argparse/sys/glob/pathlib，不引入第三方。
- **模板友好**：状态字段为空（模板初始化）时跳过对应维度，不崩溃。
- **误报优先于漏报**：境界/物品/位置/复生类宁可标记需人工复核，也不静默放过。
- **与 schema.py 共享校验**：读入角色状态先过 ``validate_character_state``，
  状态机本身不合法时降级为只告警不阻断。

CLI 速查：
    # 检测第 42 章（默认 Vault = /workspace/NovelForge_Vault）
    python -m scripts.novelforge.check_consistency --chapter 42

    # JSON 输出（供 Trae Skill 解析）
    python -m scripts.novelforge.check_consistency --chapter 42 --json

    # P0 问题退出码 1（阻断保存模式）
    python -m scripts.novelforge.check_consistency --chapter 42 --strict

    # 只检测指定维度（可逗号分隔多个）
    python -m scripts.novelforge.check_consistency --chapter 42 --dim power_level
    python -m scripts.novelforge.check_consistency --chapter 42 --dim power_level,item

    # 指定 Vault 路径（相对 cwd 或绝对路径）
    python -m scripts.novelforge.check_consistency --chapter 42 --vault path/to/vault

退出码：
- 0：通过（默认模式始终为 0 除非脚本错误；--strict 模式下无 P0 也为 0）
- 1：--strict 模式下检测到 P0 问题（阻断保存）
- 2：脚本错误（章节文件缺失 / Vault 路径无效等）
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any

# 复用同包 schema 校验
try:
    from .schema import validate_character_state
except ImportError:  # 兼容直接 python scripts/novelforge/check_consistency.py 调用
    from scripts.novelforge.schema import validate_character_state  # type: ignore


# ============================================================================
# 常量
# ============================================================================
DEFAULT_VAULT: str = "/workspace/NovelForge_Vault"

# 状态/设定文件相对路径
CHARACTERS_DIR_REL: str = ".state/characters"
HOOKS_REGISTRY_REL: str = "04_大纲与脉络/hooks_registry.json"
PIPELINE_REL: str = ".state/pipeline.json"
GEOGRAPHY_REL: str = "01_世界观/geography.md"
ITEMS_CONCEPTS_REL: str = "01_世界观/items_and_concepts.md"
ITEMS_CONCEPTS_FALLBACK_REL: str = "04_大纲与脉络/items_and_concepts.md"  # 历史路径兼容

# 正文目录相对路径模板
DRAFTS_GLOB_TMPL: str = "05_正文/drafts/vol_{vol:02d}/ch_{ch:03d}*.md"
PUBLISHED_GLOB_TMPL: str = "05_正文/published/vol_{vol:02d}/ch_{ch:03d}*.md"

# --- 境界体系（修仙常见进阶序列，可扩展）--------------------------------------
# 顺序从低到高；index 即等级数值。未列出的境界视为不可比较（跳过该维度）。
REALM_TIERS: list[str] = [
    "凡人", "凡躯", "感应", "通脉", "凝气", "练气", "筑基",
    "开光", "融合", "心动", "金丹", "元婴", "出窍", "分神",
    "化神", "炼虚", "洞虚", "合体", "渡劫", "大乘", "飞升", "仙人",
]

# 境界进度修饰词 → 进度偏移（0.0~1.0，加到 tier index 上做精细化比较）
REALM_PROGRESS: dict[str, float] = {
    "初期": 0.0, "初阶": 0.0, "入门": 0.0,
    "中期": 0.3, "中阶": 0.3,
    "后期": 0.6, "后阶": 0.6,
    "圆满": 0.8,
    "巅峰": 0.9, "极境": 0.95,
    "大圆满": 1.0,
}

# 突破场景关键词（出现任一即视为"有修炼/突破描写"，境界变化合法）
BREAKTHROUGH_KEYWORDS: tuple[str, ...] = (
    "突破", "进阶", "晋升", "破境", "凝结", "凝聚", "冲击瓶颈",
    "修炼", "闭关", "顿悟", "渡劫", "蜕变", "境破", "踏入", "迈入",
)

# --- 物品获得场景关键词 ------------------------------------------------------
# 注意：仅包含"获取新物品"的动词，不包含"使用已有物品"的动词（如"祭出/取出/挥动"）。
# "祭出/取出"表示从储物器中取出已持有的物品使用，不代表本章新获得。
ACQUISITION_KEYWORDS: tuple[str, ...] = (
    "获得", "得到", "拾取", "拾得", "购买", "买下", "夺取", "抢夺",
    "继承", "炼制", "收下", "受赠", "赠予", "认主",
)

# --- 关系类型信号词 ----------------------------------------------------------
# 正文关系信号 → 状态机 relationship.type
RELATIONSHIP_SIGNALS: dict[str, tuple[str, ...]] = {
    "ally": ("结盟", "联手", "合作", "同盟", "并肩", "助阵", "援手"),
    "enemy": ("反目", "决裂", "背叛", "敌对", "为敌", "厮杀", "对决", "翻脸"),
    "mentor": ("拜师", "师父", "师傅", "徒弟", "师尊", "传道", "授业"),
    "lover": ("恋人", "相爱", "成婚", "结发", "倾心", "情愫", "厮守"),
    "family": ("血脉", "族人", "兄长", "弟弟", "姐姐", "妹妹", "父亲", "母亲"),
    "rival": ("对手", "宿敌", "较劲", "争锋", "比试"),
}

# 关系转变场景关键词（出现任一即允许关系 type 跳变）
RELATIONSHIP_SHIFT_KEYWORDS: tuple[str, ...] = (
    "决裂", "反目", "结盟", "背叛", "和好", "拜师", "结亲",
    "反目成仇", "化敌为友", "割袍断义", "冰释前嫌",
)

# 关系历史中的前置冲突事件关键词（用于判断 ally→enemy 是否有铺垫）
CONFLICT_EVENT_KEYWORDS: tuple[str, ...] = (
    "冲突", "不和", "隔阂", "争执", "反目", "翻脸", "嫌隙", "龃龉", "间隙",
)

# --- 位置位移场景关键词 ------------------------------------------------------
TRAVEL_KEYWORDS: tuple[str, ...] = (
    "出发", "到达", "抵达", "路途", "传送", "启程", "动身", "赶路",
    "跨越", "飞行", "御剑", "瞬移", "遁走", "穿行", "进入", "离开", "返回",
)

# --- 角色"活"信号（台词/动作，用于复生检测）---------------------------------
# 形如 "林渊道：" / "林渊说：" / "林渊挥剑" / "林渊走上前"
DIALOGUE_PATTERN: re.Pattern[str] = re.compile(
    r"(?P<name>[^\s，。：：「」『』""''！？]{2,6})"
    r"(?:道|说|笑道|喝道|怒道|冷道|叹道|问道|答道|喊道|低声道|高呼|大笑)"
)
ACTION_PATTERN: re.Pattern[str] = re.compile(
    r"(?P<name>[^\s，。：：「」『』""''！？]{2,6})"
    r"(?:挥|举|提|拔|握|跨|迈|走|冲|扑|退|闪|挡|斩|刺|劈|砸|掷|扔|接|扶|拉|推)"
)

# 回忆/幻觉场景标注（出现任一则 dead 角色登场不算复生）
FLASHBACK_MARKERS: tuple[str, ...] = (
    "回忆", "幻觉", "梦境", "幻象", "幻境", "昔日", "当年", "往事",
    "脑海中", "浮现", "梦魇", "走马灯", "记忆中",
)

# --- 伏笔遗忘阈值 ------------------------------------------------------------
# 距上次提醒超过此章数 → 警告"读者可能遗忘"
FORESHADOW_FORGET_THRESHOLD: int = 20

# --- 金手指滥用阈值 ----------------------------------------------------------
GOLDEN_FINGER_ABUSE_THRESHOLD: int = 2

# --- 维度名映射（CLI --dim 接受短名或完整 type）------------------------------
DIM_ALIASES: dict[str, str] = {
    "power_level": "power_level_jump",
    "item": "phantom_item",
    "relationship": "relationship_mutation",
    "location": "location_jump",
    "foreshadow": "foreshadow_forgetting",
    "revival": "character_revival",
    "golden_finger": "golden_finger_overreach",
    # 完整 type 名也接受
    "power_level_jump": "power_level_jump",
    "phantom_item": "phantom_item",
    "relationship_mutation": "relationship_mutation",
    "location_jump": "location_jump",
    "foreshadow_forgetting": "foreshadow_forgetting",
    "character_revival": "character_revival",
    "golden_finger_overreach": "golden_finger_overreach",
}

# 全部维度 type 名（按检测顺序）
ALL_DIMENSIONS: list[str] = [
    "power_level_jump",
    "phantom_item",
    "relationship_mutation",
    "location_jump",
    "foreshadow_forgetting",
    "character_revival",
    "golden_finger_overreach",
]

# 维度中文标签（用于人类可读报告）
DIM_LABELS: dict[str, str] = {
    "power_level_jump": "境界跳级",
    "phantom_item": "物品凭空",
    "relationship_mutation": "关系突变",
    "location_jump": "位置穿越",
    "foreshadow_forgetting": "伏笔遗忘",
    "character_revival": "角色复生",
    "golden_finger_overreach": "金手指越界",
}


# ============================================================================
# 数据结构
# ============================================================================
@dataclass
class Issue:
    """单个一致性问题。

    Attributes:
        severity: ``"P0"`` 阻断保存 / ``"P1"`` 建议修复 / ``"P2"`` 提示。
        type: 维度 type 名，如 ``"power_level_jump"``。
        detail: 人类可读的问题描述（多行）。
        suggestion: 修复建议（一行）。
        extras: 附加结构化字段（供 JSON 输出扩展用）。
    """

    severity: str
    type: str
    detail: str
    suggestion: str
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass
class Report:
    """一致性检测报告。"""

    chapter: int
    volume: int
    dimensions_checked: list[str]
    issues: list[Issue] = field(default_factory=list)
    skipped: dict[str, str] = field(default_factory=dict)  # 维度 → 跳过原因（如模板空）

    @property
    def p0_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "P0")

    @property
    def p1_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "P1")

    @property
    def passed(self) -> list[str]:
        """无问题的维度 type 名列表（按检测顺序）。"""
        issue_types = {i.type for i in self.issues}
        return [d for d in self.dimensions_checked if d not in issue_types]


# ============================================================================
# 路径 / IO 辅助
# ============================================================================
def _resolve_vault(vault_arg: str | None) -> str:
    """解析 Vault 路径。

    - 显式给出 → 按相对 cwd / 绝对路径解析。
    - 未给出 → 回落 ``DEFAULT_VAULT``。
    """
    if vault_arg:
        return os.path.abspath(vault_arg)
    return DEFAULT_VAULT


def _chapter_glob(vault: str, volume: int, chapter: int) -> str | None:
    """在 drafts / published 中查找章正文文件，返回第一个命中路径。

    查找顺序：drafts 优先（写作中），其次 published（已发布）。
    文件命名约定：``ch_NNN[_标题].md``。
    """
    for tmpl in (DRAFTS_GLOB_TMPL, PUBLISHED_GLOB_TMPL):
        pattern = os.path.join(vault, tmpl.format(vol=volume, ch=chapter))
        matches = sorted(glob.glob(pattern))
        if matches:
            return matches[0]
    return None


def _detect_volume(vault: str) -> int:
    """从 ``.state/pipeline.json`` 读取当前卷号，失败回落 1。"""
    path = os.path.join(vault, PIPELINE_REL)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        vol = data.get("current_volume", 1)
        if isinstance(vol, int) and vol >= 1:
            return vol
    except (OSError, json.JSONDecodeError):
        pass
    return 1


def load_chapter_text(vault: str, volume: int, chapter: int) -> tuple[str | None, str | None]:
    """加载章正文。

    Returns:
        (text, path) —— text 为正文字符串（含 frontmatter），path 为文件绝对路径。
        文件不存在返回 (None, None)。
    """
    path = _chapter_glob(vault, volume, chapter)
    if path is None:
        return None, None
    with open(path, "r", encoding="utf-8") as f:
        return f.read(), path


def load_character_states(vault: str) -> dict[str, dict[str, Any]]:
    """加载 ``.state/characters/*.json`` 全部角色状态。

    Returns:
        ``{character_id: state_dict}``，键取 ``character_id`` 字段；
        若该字段缺失则取文件名（去扩展名）。
    """
    chars_dir = os.path.join(vault, CHARACTERS_DIR_REL)
    result: dict[str, dict[str, Any]] = {}
    for path in sorted(glob.glob(os.path.join(chars_dir, "*.json"))):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        cid = data.get("character_id") or os.path.splitext(os.path.basename(path))[0]
        result[cid] = data
    return result


def load_hooks(vault: str) -> list[dict[str, Any]]:
    """加载伏笔表。文件不存在或解析失败返回空列表（不阻断检测）。"""
    path = os.path.join(vault, HOOKS_REGISTRY_REL)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    hooks = data.get("hooks")
    return hooks if isinstance(hooks, list) else []


def load_geography_places(vault: str) -> list[str]:
    """从 ``geography.md`` 提取地名清单。

    解析两种结构：
    - Markdown 表格首列：``| 区域名 | ...``
    - 加粗地标：``**地名**：``
    """
    path = os.path.join(vault, GEOGRAPHY_REL)
    places: list[str] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return places
    # 表格首列：跳过分隔行和表头
    for line in text.splitlines():
        m = re.match(r"\|\s*([^\|]+?)\s*\|", line)
        if not m:
            continue
        cell = m.group(1).strip()
        if cell.startswith("---") or cell in ("区域名", "起点", "物品名", "日期"):
            continue
        if cell.startswith("（示例）"):
            cell = cell.replace("（示例）", "").strip()
        if 2 <= len(cell) <= 12 and not cell.startswith("____"):
            places.append(cell)
    # 加粗地标：**地名**：
    for m in re.finditer(r"\*\*([^*]{2,12})\*\*\s*[：:]", text):
        name = m.group(1).strip()
        if name not in places:
            places.append(name)
    return places


def load_concept_items(vault: str) -> list[str]:
    """从 ``items_and_concepts.md`` 提取已定义物品名清单。

    解析「特殊物品」表格首列。文件缺失时尝试历史路径 ``04_大纲与脉络/``。
    """
    primary = os.path.join(vault, ITEMS_CONCEPTS_REL)
    fallback = os.path.join(vault, ITEMS_CONCEPTS_FALLBACK_REL)
    path = primary if os.path.exists(primary) else fallback
    items: list[str] = []
    if not os.path.exists(path):
        return items
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return items
    for line in text.splitlines():
        m = re.match(r"\|\s*([^\|]+?)\s*\|", line)
        if not m:
            continue
        cell = m.group(1).strip()
        if cell.startswith("---") or cell in ("物品名", "起点", "区域名", "日期", "名词"):
            continue
        if cell.startswith("（示例）"):
            cell = cell.replace("（示例）", "").strip()
        if 2 <= len(cell) <= 12 and not cell.startswith("____"):
            items.append(cell)
    return items


# ============================================================================
# 文本辅助
# ============================================================================
def strip_frontmatter(content: str) -> str:
    """剥离 YAML frontmatter（``--- ... ---``），返回正文。"""
    if content.startswith("---"):
        end = content.find("\n---", 3)
        if end != -1:
            return content[end + 4:].lstrip("\n")
    return content


def _line_of(text: str, pos: int) -> int:
    """根据字符位置反推行号（1-based）。"""
    return text.count("\n", 0, pos) + 1


def _build_name_pattern(names: list[str]) -> re.Pattern[str] | None:
    """构造角色名匹配正则。names 为空返回 None。

    名字按长度降序排列，避免短名先匹配（如"林"误匹配"林渊"）。
    """
    valid = sorted({n for n in names if n and len(n) >= 1}, key=len, reverse=True)
    if not valid:
        return None
    # 转义特殊字符
    escaped = "|".join(re.escape(n) for n in valid)
    return re.compile(escaped)


def _find_mentions(body: str, pattern: re.Pattern[str] | None) -> list[tuple[str, int]]:
    """返回 [(name, position)] 列表。pattern 为 None 时返回空。"""
    if pattern is None:
        return []
    return [(m.group(0), m.start()) for m in pattern.finditer(body)]


def _parse_realm(text: str) -> tuple[int, float] | None:
    """解析境界字符串/片段，返回 (tier_index, progress_offset)。

    如 ``"筑基中期"`` → (6, 0.3)；``"金丹"`` → (10, 0.0)。
    未识别返回 None。
    """
    # 找 tier
    tier_idx = -1
    for i, tier in enumerate(REALM_TIERS):
        if tier in text:
            tier_idx = i
            break
    if tier_idx < 0:
        return None
    # 找 progress
    progress = 0.0
    for keyword, offset in REALM_PROGRESS.items():
        if keyword in text:
            progress = offset
            break
    return (tier_idx, progress)


def _extract_realm_mentions(body: str) -> list[tuple[str, int, int, float]]:
    """从正文提取所有境界提及。

    匹配模式：``<tier>[progress]`` 或 ``[progress]<tier>``。

    Returns:
        [(matched_text, position, tier_index, value)] —— value = tier_index + progress。
    """
    results: list[tuple[str, int, int, float]] = []
    # 构造正则：可选 progress 前缀 + tier + 可选 progress 后缀
    # 语序兼容：「筑基中期」「中期筑基」「筑基」三种写法
    tier_alt = "|".join(re.escape(t) for t in REALM_TIERS)
    progress_alt = "|".join(re.escape(p) for p in REALM_PROGRESS.keys())
    pattern = re.compile(rf"(?:({progress_alt})?)({tier_alt})(?:({progress_alt})?)")
    for m in pattern.finditer(body):
        pre, tier, post = m.group(1), m.group(2), m.group(3)
        tier_idx = REALM_TIERS.index(tier)
        prog = 0.0
        for kw in (pre, post):
            if kw and kw in REALM_PROGRESS:
                prog = max(prog, REALM_PROGRESS[kw])
        results.append((m.group(0), m.start(), tier_idx, tier_idx + prog))
    return results


def _has_keyword_near(body: str, keywords: tuple[str, ...]) -> bool:
    """正文中是否出现任一关键词。"""
    return any(kw in body for kw in keywords)


def _has_keyword_near_pos(body: str, pos: int, keywords: tuple[str, ...], window: int = 80) -> bool:
    """在 pos 周围 window 字符窗口内是否出现任一关键词。"""
    start = max(0, pos - window)
    end = min(len(body), pos + window)
    segment = body[start:end]
    return any(kw in segment for kw in keywords)


# ============================================================================
# 维度 1：境界跳级（P0）
# ============================================================================
def check_power_level_jump(
    body: str,
    states: dict[str, dict[str, Any]],
) -> tuple[list[Issue], str | None]:
    """检测境界跳级。

    规则：
    - 取主角（``character_id == "protagonist"`` 或 role=protagonist）的 power_level.realm。
    - 在正文提取所有境界提及，取最大值。
    - 若正文境界 > 状态机境界且本章无突破场景关键词 → P0。
    - 状态机 realm 为空（模板）→ 跳过。
    - 状态机 realm 解析失败（自定义体系）→ 跳过并告警。
    """
    protagonist = _find_protagonist(states)
    if protagonist is None:
        return [], "未找到主角状态文件，跳过境界检测"

    power = protagonist.get("power_level") or {}
    state_realm = power.get("realm") or ""
    if not state_realm:
        return [], "主角 power_level.realm 为空（模板状态），跳过境界检测"

    state_parsed = _parse_realm(state_realm)
    if state_parsed is None:
        return [], f"主角境界 '{state_realm}' 不在 REALM_TIERS 中（自定义体系），跳过"

    # state_parsed = (tier_index, progress_offset)；value = tier + progress
    state_value = state_parsed[0] + state_parsed[1]
    mentions = _extract_realm_mentions(body)
    if not mentions:
        return [], None  # 正文未提及境界，不报

    # 取正文最大境界
    max_mention = max(mentions, key=lambda x: x[3])
    body_value = max_mention[3]

    if body_value <= state_value + 0.05:  # 容差：同境界不同 progress 视为合法
        return [], None

    # 境界跳升，检查是否有突破场景
    has_breakthrough = _has_keyword_near(body, BREAKTHROUGH_KEYWORDS)
    if has_breakthrough:
        return [], None  # 有突破场景，跳变合法

    state_label = state_realm
    body_label = max_mention[0]
    detail = (
        f"主角状态机境界: {state_label}\n"
        f"   正文提及境界: {body_label}\n"
        f"   本章无\"突破/修炼/进阶\"场景描写"
    )
    return [Issue(
        severity="P0",
        type="power_level_jump",
        detail=detail,
        suggestion="补充突破场景（闭关/顿悟/冲击瓶颈），或修正正文境界描述以匹配状态机。",
        extras={
            "state_realm": state_label,
            "body_realm": body_label,
            "state_value": state_value,
            "body_value": body_value,
        },
    )], None


def _find_protagonist(states: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """从角色状态字典中找出主角。

    优先级：``character_id == "protagonist"`` → ``basic.role == "protagonist"`` → 第一个。
    """
    for cid, state in states.items():
        if cid == "protagonist":
            return state
    for state in states.values():
        if (state.get("basic") or {}).get("role") == "protagonist":
            return state
    # 回落：取第一个
    return next(iter(states.values()), None) if states else None


# ============================================================================
# 维度 2：物品凭空（P0）
# ============================================================================
def check_phantom_item(
    body: str,
    states: dict[str, dict[str, Any]],
    vault: str,
) -> tuple[list[Issue], str | None]:
    """检测物品凭空。

    规则：
    - 汇总所有角色 inventory 中的物品名 → ``held_items``。
    - 解析 ``items_and_concepts.md`` 已定义物品名 → ``defined_items``。
    - 候选物品集 = ``held_items ∪ defined_items``。
    - 对每个候选物品：若正文提及但无任何角色持有，且本章无获得场景关键词 → P0。
    - 候选集为空（模板）→ 跳过。
    """
    held_items: dict[str, list[str]] = {}  # item → [holder_id, ...]
    for cid, state in states.items():
        inv = state.get("inventory") or []
        if not isinstance(inv, list):
            continue
        for entry in inv:
            if not isinstance(entry, dict):
                continue
            name = entry.get("item") or ""
            if name:
                held_items.setdefault(name, []).append(cid)

    defined_items = load_concept_items(vault)
    candidate_items = sorted(set(held_items.keys()) | set(defined_items))
    if not candidate_items:
        return [], "物品库为空（模板状态），跳过物品凭空检测"

    issues: list[Issue] = []
    for item in candidate_items:
        # 正文是否提及该物品
        if item not in body:
            continue
        # 有人持有 → OK
        if held_items.get(item):
            continue
        # 无人持有但本章有获得场景 → OK
        if _has_keyword_near(body, ACQUISITION_KEYWORDS):
            continue
        in_concepts = item in defined_items
        detail = (
            f"正文出现物品: {item}\n"
            f"   所有角色 inventory 均无此物品\n"
            f"   {'01_世界观/items_and_concepts.md 已定义' if in_concepts else 'items_and_concepts.md 无定义'}\n"
            f"   本章无\"获得/拾取/购买\"场景描写"
        )
        issues.append(Issue(
            severity="P0",
            type="phantom_item",
            detail=detail,
            suggestion=(
                "补充\"获得该物品\"场景，或新增物品定义到 items_and_concepts.md，"
                "或修正正文物品名。"
            ),
            extras={
                "item": item,
                "in_inventory": False,
                "in_concepts": in_concepts,
            },
        ))
    return issues, None


# ============================================================================
# 维度 3：关系突变（P1）
# ============================================================================
def check_relationship_mutation(
    body: str,
    states: dict[str, dict[str, Any]],
) -> tuple[list[Issue], str | None]:
    """检测关系突变。

    规则：
    - 对每个角色 A 的 relationships 条目 ``{target: B, type: T}``：
      - 在正文找 A、B 共现的段落。
      - 检测正文关系信号词，推断 body_relation_type。
      - 若 body_type 与 T 不一致且无关系转变场景关键词 → P1。
      - 若 T=ally → body_type=enemy 且 history 无前置冲突事件 → 额外 P1「无铺垫」。
    - A 或 B 任一在正文未出现 → 跳过该条。
    - relationships 为空（模板）→ 跳过整个维度。
    """
    # 收集所有角色名 → character_id 映射（支持别名）
    name_to_id: dict[str, str] = {}
    id_to_names: dict[str, list[str]] = {}
    for cid, state in states.items():
        basic = state.get("basic") or {}
        names = [basic.get("name") or ""] + list(basic.get("aliases") or [])
        names = [n for n in names if n]
        id_to_names[cid] = names
        for n in names:
            name_to_id[n] = cid

    if not name_to_id:
        return [], "无角色名（模板状态），跳过关系突变检测"

    # 检查是否任何角色有 relationships
    has_relationships = any(
        (s.get("relationships") and isinstance(s.get("relationships"), list))
        for s in states.values()
    )
    if not has_relationships:
        return [], "relationships 为空（模板状态），跳过关系突变检测"

    issues: list[Issue] = []
    for cid_a, state_a in states.items():
        rels = state_a.get("relationships") or []
        if not isinstance(rels, list):
            continue
        names_a = id_to_names.get(cid_a, [])
        if not names_a:
            continue
        pat_a = _build_name_pattern(names_a)
        if pat_a is None:
            continue
        for rel in rels:
            if not isinstance(rel, dict):
                continue
            target_b = rel.get("target") or ""
            state_type = rel.get("type") or ""
            if not target_b or not state_type:
                continue
            # 解析 B 的名字（target 可能是 id 或名字）
            names_b = id_to_names.get(target_b) or ([target_b] if target_b else [])
            if not names_b:
                continue
            pat_b = _build_name_pattern(names_b)
            if pat_b is None:
                continue

            # A、B 必须都在正文出现
            mentions_a = _find_mentions(body, pat_a)
            mentions_b = _find_mentions(body, pat_b)
            if not mentions_a or not mentions_b:
                continue

            # 检测正文关系信号
            body_types: set[str] = set()
            for btype, signals in RELATIONSHIP_SIGNALS.items():
                for sig in signals:
                    if sig in body:
                        body_types.add(btype)
            if not body_types:
                continue  # 正文无明确关系信号，不报

            # 状态机 type 若不在 body_types 中 → 可能突变
            if state_type in body_types:
                continue  # 一致

            # 检查是否有关系转变场景
            if _has_keyword_near(body, RELATIONSHIP_SHIFT_KEYWORDS):
                continue  # 有转变场景，跳变合法

            # ally → enemy 特殊检查：history 是否有前置冲突
            extra_no_prelude = ""
            if state_type == "ally" and "enemy" in body_types:
                history = rel.get("history") or []
                has_conflict = any(
                    _has_keyword_near(
                        (h.get("event") or "") if isinstance(h, dict) else str(h),
                        CONFLICT_EVENT_KEYWORDS,
                    )
                    for h in history
                )
                if not has_conflict:
                    extra_no_prelude = "（无前置冲突铺垫）"

            detail = (
                f"{names_a[0]} 与 {names_b[0]} 状态机关系: {state_type}\n"
                f"   正文关系信号: {','.join(sorted(body_types))}\n"
                f"   本章无关系转变场景描写{extra_no_prelude}"
            )
            issues.append(Issue(
                severity="P1",
                type="relationship_mutation",
                detail=detail,
                suggestion=(
                    "补充关系转变场景（决裂/反目/结盟/拜师等），"
                    "或在 history 中追加前置冲突事件做铺垫。"
                ),
                extras={
                    "character_a": cid_a,
                    "character_b": target_b,
                    "state_type": state_type,
                    "body_types": sorted(body_types),
                },
            ))
    return issues, None


# ============================================================================
# 维度 4：位置穿越（P0）
# ============================================================================
def check_location_jump(
    body: str,
    states: dict[str, dict[str, Any]],
    vault: str,
) -> tuple[list[Issue], str | None]:
    """检测位置穿越。

    规则：
    - 对每个角色 state.location.current 非空的角色：
      - 提取正文出现该角色的位置附近地名。
      - 若正文地名 ≠ 状态机地名，且本章无位移场景关键词 → P0。
    - 地名清单从 ``geography.md`` 解析；若该文件为空（模板），仍可用 state.location 做"非空校验"。
    """
    geography_places = load_geography_places(vault)
    # 角色 → 名字清单
    name_to_id: dict[str, str] = {}
    id_to_names: dict[str, list[str]] = {}
    for cid, state in states.items():
        basic = state.get("basic") or {}
        names = [basic.get("name") or ""] + list(basic.get("aliases") or [])
        names = [n for n in names if n]
        id_to_names[cid] = names
        for n in names:
            name_to_id[n] = cid

    if not name_to_id:
        return [], "无角色名（模板状态），跳过位置穿越检测"

    # 检查是否有任何角色设置了 location.current
    has_location = any(
        (s.get("location") or {}).get("current")
        for s in states.values()
    )
    if not has_location:
        return [], "location.current 全部为空（模板状态），跳过位置穿越检测"

    issues: list[Issue] = []
    for cid, state in states.items():
        loc = state.get("location") or {}
        state_place = loc.get("current") or ""
        if not state_place:
            continue
        names = id_to_names.get(cid, [])
        if not names:
            continue
        pat = _build_name_pattern(names)
        if pat is None:
            continue
        mentions = _find_mentions(body, pat)
        if not mentions:
            continue

        # 在每个角色提及位置附近找地名
        body_places: set[str] = set()
        for _, pos in mentions:
            window_start = max(0, pos - 40)
            window_end = min(len(body), pos + 60)
            segment = body[window_start:window_end]
            for place in geography_places:
                if place and place in segment:
                    body_places.add(place)
            # 也检查 state_place 本身
            if state_place in segment:
                body_places.add(state_place)

        if not body_places:
            continue  # 正文未提及地名，不报

        # 若正文地名包含状态机地名 → OK
        if state_place in body_places:
            continue

        # 检查位移场景
        if _has_keyword_near(body, TRAVEL_KEYWORDS):
            continue

        detail = (
            f"{names[0]} 状态机位置: {state_place}\n"
            f"   正文提及位置: {','.join(sorted(body_places))}\n"
            f"   本章无\"出发/到达/传送\"等位移描写"
        )
        issues.append(Issue(
            severity="P0",
            type="location_jump",
            detail=detail,
            suggestion=(
                "补充位移场景（出发/抵达/御剑/传送），"
                "或修正正文位置描述以匹配状态机。"
            ),
            extras={
                "character": cid,
                "state_place": state_place,
                "body_places": sorted(body_places),
            },
        ))
    return issues, None


# ============================================================================
# 维度 5：伏笔遗忘（P1）
# ============================================================================
def check_foreshadow_forgetting(
    body: str,
    states: dict[str, dict[str, Any]],
    hooks: list[dict[str, Any]],
    current_ch: int,
) -> tuple[list[Issue], str | None]:
    """检测伏笔遗忘。

    规则：
    - 对 status in (planted, hinted) 的伏笔：
      - 若 ``target_resolve_ch < current_ch`` → P1「超期未回收」。
      - 若 ``last_reminder_ch`` 距 ``current_ch`` > 20 章 → P1「读者可能遗忘」。
      - 若 ``last_reminder_ch`` 为 null 且 ``current_ch - planted_ch > 20`` → P1。
    - hooks 为空（模板）→ 跳过。
    """
    if not hooks:
        return [], "伏笔表为空（模板状态），跳过伏笔遗忘检测"

    issues: list[Issue] = []
    for hook in hooks:
        if not isinstance(hook, dict):
            continue
        status = hook.get("status")
        if status not in ("planted", "hinted"):
            continue
        hook_id = hook.get("hook_id") or "?"
        desc = hook.get("description") or ""
        planted_ch = hook.get("planted_ch")
        target = hook.get("target_resolve_ch")
        last_reminder = hook.get("last_reminder_ch")

        # 超期未回收
        if isinstance(target, int) and current_ch > target:
            detail = (
                f"{hook_id} \"{desc}\" 埋于 ch{planted_ch}, "
                f"计划 ch{target} 回收, 当前 ch{current_ch} 已超期 {current_ch - target} 章"
            )
            issues.append(Issue(
                severity="P1",
                type="foreshadow_forgetting",
                detail=detail,
                suggestion="本章安排回收（揭秘/兑现/呼应），或更新 target_resolve_ch。",
                extras={
                    "hook_id": hook_id,
                    "planted_ch": planted_ch,
                    "target_resolve_ch": target,
                    "current_ch": current_ch,
                    "sub_type": "overdue",
                },
            ))
            continue  # 已报超期，不再叠加遗忘预警

        # 读者遗忘预警
        if isinstance(last_reminder, int):
            gap = current_ch - last_reminder
            if gap > FORESHADOW_FORGETTING_THRESHOLD:
                detail = (
                    f"{hook_id} \"{desc}\" 埋于 ch{planted_ch}, "
                    f"当前 ch{current_ch}, last_reminder_ch={last_reminder}\n"
                    f"   距上次提醒: {gap} 章，读者可能遗忘"
                )
                issues.append(Issue(
                    severity="P1",
                    type="foreshadow_forgetting",
                    detail=detail,
                    suggestion="在本章安排角色再次提及此伏笔（不揭），刷新读者记忆。",
                    extras={
                        "hook_id": hook_id,
                        "planted_ch": planted_ch,
                        "last_reminder_ch": last_reminder,
                        "current_ch": current_ch,
                        "gap": gap,
                        "sub_type": "forgetting",
                    },
                ))
        elif isinstance(planted_ch, int):
            # 从未提醒过
            gap = current_ch - planted_ch
            if gap > FORESHADOW_FORGETTING_THRESHOLD:
                detail = (
                    f"{hook_id} \"{desc}\" 埋于 ch{planted_ch}, "
                    f"当前 ch{current_ch}, last_reminder_ch=null\n"
                    f"   自埋设以来 {gap} 章未提醒，读者可能遗忘"
                )
                issues.append(Issue(
                    severity="P1",
                    type="foreshadow_forgetting",
                    detail=detail,
                    suggestion="在本章安排角色再次提及此伏笔（不揭），刷新读者记忆。",
                    extras={
                        "hook_id": hook_id,
                        "planted_ch": planted_ch,
                        "last_reminder_ch": None,
                        "current_ch": current_ch,
                        "gap": gap,
                        "sub_type": "never_reminded",
                    },
                ))
    return issues, None


# ============================================================================
# 维度 6：角色复生（P0）
# ============================================================================
def check_character_revival(
    body: str,
    states: dict[str, dict[str, Any]],
) -> tuple[list[Issue], str | None]:
    """检测角色复生。

    规则：
    - 对 status=dead 的角色：
      - 在正文找其名字/别名出现位置。
      - 在每个出现位置附近检查是否有台词/动作信号。
      - 若有台词/动作，且周围无回忆/幻觉/梦境标注 → P0「角色复生」。
    - 无 dead 角色 → 跳过。
    """
    dead_chars: list[tuple[str, dict[str, Any], list[str]]] = []
    for cid, state in states.items():
        if state.get("status") != "dead":
            continue
        basic = state.get("basic") or {}
        names = [basic.get("name") or ""] + list(basic.get("aliases") or [])
        names = [n for n in names if n]
        if names:
            dead_chars.append((cid, state, names))

    if not dead_chars:
        return [], "无 status=dead 的角色，跳过角色复生检测"

    issues: list[Issue] = []
    for cid, state, names in dead_chars:
        pat = _build_name_pattern(names)
        if pat is None:
            continue
        # 在台词/动作模式中找该角色名
        revived = False
        revival_context = ""
        for m in DIALOGUE_PATTERN.finditer(body):
            if pat.fullmatch(m.group("name")) or pat.search(m.group("name")):
                # 检查周围是否有回忆/幻觉标注
                if not _has_keyword_near_pos(body, m.start(), FLASHBACK_MARKERS, window=120):
                    revived = True
                    revival_context = f"台词：\"{m.group(0)}\""
                    break
        if not revived:
            for m in ACTION_PATTERN.finditer(body):
                if pat.fullmatch(m.group("name")) or pat.search(m.group("name")):
                    if not _has_keyword_near_pos(body, m.start(), FLASHBACK_MARKERS, window=120):
                        revived = True
                        revival_context = f"动作：\"{m.group(0)}\""
                        break

        if not revived:
            continue

        detail = (
            f"{names[0]} 状态机 status=dead\n"
            f"   本章出现 {revival_context}\n"
            f"   周围无回忆/幻觉/梦境标注"
        )
        issues.append(Issue(
            severity="P0",
            type="character_revival",
            detail=detail,
            suggestion=(
                "将该场景改为回忆/幻觉/梦境（添加标注词），"
                "或将状态机 status 改为 active/missing 并补充复活剧情。"
            ),
            extras={
                "character": cid,
                "revival_context": revival_context,
            },
        ))
    return issues, None


# ============================================================================
# 维度 7：金手指越界（P1）
# ============================================================================
def check_golden_finger_overreach(
    body: str,
    states: dict[str, dict[str, Any]],
) -> tuple[list[Issue], str | None]:
    """检测金手指越界。

    规则：
    - 取主角 ``power_level.abilities``（list of {name, level, acquired_ch}）。
    - 取 ``power_level.limitations``（list of str）。
    - 在正文匹配每个 ability.name 出现次数。
    - 若正文出现"金手指使用信号"但不在 abilities 列表 → P1「金手指越界」。
    - 若单章 ability 使用次数 > 2 → P1「金手指滥用」。
    - limitations 检查：解析"不超过X/不能Y"模式，启发式校验。
    - abilities 为空（模板）→ 跳过。
    """
    protagonist = _find_protagonist(states)
    if protagonist is None:
        return [], "未找到主角状态文件，跳过金手指检测"

    power = protagonist.get("power_level") or {}
    abilities = power.get("abilities") or []
    limitations = power.get("limitations") or []
    if not isinstance(abilities, list) or not abilities:
        return [], "abilities 为空（模板状态），跳过金手指检测"

    # 已知能力名清单
    ability_names: list[str] = []
    for ab in abilities:
        if isinstance(ab, dict):
            name = ab.get("name") or ""
            if name:
                ability_names.append(name)
    if not ability_names:
        return [], "abilities 无 name 字段，跳过金手指检测"

    issues: list[Issue] = []

    # 统计每个能力在本章的使用次数
    usage_counts: dict[str, int] = {}
    for name in ability_names:
        # 精确匹配能力名出现次数
        usage_counts[name] = len(re.findall(re.escape(name), body))

    # 金手指滥用：单章总使用次数 > 阈值
    total_usage = sum(usage_counts.values())
    if total_usage > GOLDEN_FINGER_ABUSE_THRESHOLD:
        detail_lines = [f"本章金手指总使用次数: {total_usage}（阈值 {GOLDEN_FINGER_ABUSE_THRESHOLD}）"]
        for name, cnt in sorted(usage_counts.items(), key=lambda x: -x[1]):
            if cnt > 0:
                detail_lines.append(f"   - {name}: {cnt} 次")
        issues.append(Issue(
            severity="P1",
            type="golden_finger_overreach",
            detail="\n".join(detail_lines),
            suggestion="减少本章金手指使用次数，将部分爽点后置到后续章节。",
            extras={
                "total_usage": total_usage,
                "usage_counts": usage_counts,
                "sub_type": "abuse",
            },
        ))

    # limitations 检查：解析"不超过X"模式
    if isinstance(limitations, list):
        for lim in limitations:
            if not isinstance(lim, str) or not lim:
                continue
            # 简化检查：若 limitation 含"不能/禁止/不可" + 关键词，
            # 且正文出现该关键词与能力名共现 → 疑似越界
            if any(kw in lim for kw in ("不能", "禁止", "不可", "不得")):
                # 提取 limitation 中的能力名（若有）
                related_ability = next(
                    (n for n in ability_names if n and n in lim), None
                )
                if related_ability is None:
                    continue
                # 检查正文是否同时出现能力名 + 违规行为
                # 启发式：limitation 含"不能"后的 4-10 字作为违规行为描述
                m = re.search(r"(?:不能|禁止|不可|不得)(.{2,10})", lim)
                if m:
                    violation = m.group(1).strip("，。；")
                    # 在能力名附近 100 字窗口内找违规行为
                    for am in re.finditer(re.escape(related_ability), body):
                        if _has_keyword_near_pos(body, am.start(), (violation,), window=100):
                            detail = (
                                f"能力 \"{related_ability}\" 违反 limitation:\n"
                                f"   限制: {lim}\n"
                                f"   正文出现违规行为: \"{violation}\""
                            )
                            issues.append(Issue(
                                severity="P1",
                                type="golden_finger_overreach",
                                detail=detail,
                                suggestion="修正正文使其符合 limitation，或调整 limitation 边界并更新 core_rules.md。",
                                extras={
                                    "ability": related_ability,
                                    "limitation": lim,
                                    "violation": violation,
                                    "sub_type": "limitation_violation",
                                },
                            ))
                            break  # 同一 limitation 只报一次

    # 检测 abilities 列表外的能力使用
    # 启发式：正文出现"施展/催动/使出/动用" + 能力名模式
    out_of_scope_pattern = re.compile(
        r"(?:施展|催动|使出|动用|发动|激发|释放)\s*(?P<ability>[^\s，。：：「」『』""''！？]{2,8})"
    )
    known_set = set(ability_names)
    for m in out_of_scope_pattern.finditer(body):
        ab_name = m.group("ability")
        if ab_name in known_set:
            continue
        # 排除明显不是能力名的词（如"全力"/"身法"等通用词）
        if ab_name in ("全力", "身法", "力量", "全部", "实力", "神识"):
            continue
        detail = (
            f"正文使用能力: {ab_name}\n"
            f"   不在 abilities 列表中: {', '.join(ability_names)}"
        )
        issues.append(Issue(
            severity="P1",
            type="golden_finger_overreach",
            detail=detail,
            suggestion="将该能力加入 protagonist.power_level.abilities，或修正正文能力名。",
            extras={
                "ability": ab_name,
                "known_abilities": ability_names,
                "sub_type": "out_of_scope",
            },
        ))
        break  # 同类只报一次，避免刷屏

    return issues, None


# ============================================================================
# 编排：check_all
# ============================================================================
# 维度 type → 检测函数（无 vault 依赖）
_DIM_CHECKERS_NO_VAULT: dict[str, Any] = {
    "power_level_jump": lambda body, states, hooks, ch: check_power_level_jump(body, states),
    "relationship_mutation": lambda body, states, hooks, ch: check_relationship_mutation(body, states),
    "character_revival": lambda body, states, hooks, ch: check_character_revival(body, states),
    "golden_finger_overreach": lambda body, states, hooks, ch: check_golden_finger_overreach(body, states),
    "foreshadow_forgetting": lambda body, states, hooks, ch: check_foreshadow_forgetting(body, states, hooks, ch),
}


def check_all(
    chapter: int,
    vault: str = DEFAULT_VAULT,
    volume: int | None = None,
    dims: list[str] | None = None,
) -> Report:
    """运行完整一致性检测。

    Args:
        chapter: 章号（整数）。
        vault: Vault 根目录绝对路径。
        volume: 卷号；None 则从 ``.state/pipeline.json`` 自动探测。
        dims: 仅检测指定维度 type 名列表；None 则全量检测。

    Returns:
        ``Report`` 对象。

    Raises:
        FileNotFoundError: 章正文文件不存在。
    """
    if volume is None:
        volume = _detect_volume(vault)

    body_text, _path = load_chapter_text(vault, volume, chapter)
    if body_text is None:
        raise FileNotFoundError(
            f"未找到第 {chapter} 章正文文件（卷 {volume}）。"
            f"查找路径：{DRAFTS_GLOB_TMPL.format(vol=volume, ch=chapter)} / "
            f"{PUBLISHED_GLOB_TMPL.format(vol=volume, ch=chapter)}"
        )
    body = strip_frontmatter(body_text)

    # 加载状态
    states = load_character_states(vault)
    hooks = load_hooks(vault)

    # 维度校验：先过 validate_character_state，记录但不阻断
    schema_errors: dict[str, list[str]] = {}
    for cid, state in states.items():
        errs = validate_character_state(state)
        if errs:
            schema_errors[cid] = errs

    target_dims = dims if dims else list(ALL_DIMENSIONS)
    # 过滤未知维度
    target_dims = [d for d in target_dims if d in ALL_DIMENSIONS]

    report = Report(chapter=chapter, volume=volume, dimensions_checked=target_dims)

    # 若状态机本身不合法，作为 P1 警告附加
    if schema_errors:
        for cid, errs in schema_errors.items():
            report.issues.append(Issue(
                severity="P1",
                type="relationship_mutation",  # 归到一个已有 type 以便 JSON 输出
                detail=f"角色 {cid} 状态机校验失败: {'; '.join(errs)}",
                suggestion="修正 .state/characters/<name>.json 使其符合 CHARACTER_STATE_SCHEMA。",
                extras={"character": cid, "schema_errors": errs, "sub_type": "schema_violation"},
            ))

    for dim in target_dims:
        try:
            if dim == "phantom_item":
                issues, skip = check_phantom_item(body, states, vault)
            elif dim == "location_jump":
                issues, skip = check_location_jump(body, states, vault)
            elif dim in _DIM_CHECKERS_NO_VAULT:
                issues, skip = _DIM_CHECKERS_NO_VAULT[dim](body, states, hooks, chapter)
            else:
                report.skipped[dim] = f"未知维度: {dim}"
                continue
            if skip:
                report.skipped[dim] = skip
            report.issues.extend(issues)
        except Exception as exc:  # noqa: BLE001 单维度异常不阻断整体
            report.skipped[dim] = f"检测异常: {type(exc).__name__}: {exc}"

    return report


# ============================================================================
# 格式化输出
# ============================================================================
def _fmt_ch(ch: int) -> str:
    """章号格式化为 ch_042 形式（3 位补零）。"""
    return f"ch_{ch:03d}"


def format_report(report: Report) -> str:
    """格式化人类可读报告。"""
    lines: list[str] = [
        f"=== 一致性检测报告 {_fmt_ch(report.chapter)}（卷 {report.volume}）===",
        f"检测维度: {len(report.dimensions_checked)}",
        f"P0 问题: {report.p0_count}{' (阻断保存)' if report.p0_count else ''}",
        f"P1 警告: {report.p1_count}{' (建议修复)' if report.p1_count else ''}",
        "",
    ]

    # 按维度分组输出问题
    issues_by_dim: dict[str, list[Issue]] = {}
    for issue in report.issues:
        issues_by_dim.setdefault(issue.type, []).append(issue)

    sev_emoji = {"P0": "🔴", "P1": "🟡", "P2": "⚪"}
    for dim in report.dimensions_checked:
        label = DIM_LABELS.get(dim, dim)
        dim_issues = issues_by_dim.get(dim, [])
        if not dim_issues:
            continue
        for issue in dim_issues:
            emoji = sev_emoji.get(issue.severity, "⚪")
            lines.append(f"{emoji} [{issue.severity}] {label}")
            # detail 多行缩进对齐
            for line in issue.detail.splitlines():
                lines.append(f"   {line}")
            lines.append(f"   建议: {issue.suggestion}")
            lines.append("")

    # 跳过的维度
    if report.skipped:
        lines.append("--- 跳过的维度 ---")
        for dim, reason in report.skipped.items():
            label = DIM_LABELS.get(dim, dim)
            lines.append(f"⏭️  {label}: {reason}")
        lines.append("")

    # 通过的维度
    passed = report.passed
    if passed:
        passed_labels = "/".join(DIM_LABELS.get(d, d) for d in passed)
        lines.append(f"✅ 通过: {passed_labels}")

    return "\n".join(lines)


def format_json(report: Report) -> str:
    """格式化 JSON 输出。"""
    payload: dict[str, Any] = {
        "chapter": _fmt_ch(report.chapter),
        "volume": report.volume,
        "dimensions_checked": len(report.dimensions_checked),
        "p0_count": report.p0_count,
        "p1_count": report.p1_count,
        "passed": report.passed,
        "skipped": report.skipped,
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
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ============================================================================
# CLI
# ============================================================================
def _parse_dims(dim_str: str) -> list[str]:
    """解析 --dim 参数（逗号分隔），返回标准 type 名列表。"""
    parts = [p.strip() for p in dim_str.split(",") if p.strip()]
    result: list[str] = []
    for p in parts:
        normalized = DIM_ALIASES.get(p)
        if normalized is None:
            print(f"警告: 未知维度 '{p}'，已忽略。可用: {list(DIM_ALIASES.keys())}", file=sys.stderr)
            continue
        if normalized not in result:
            result.append(normalized)
    return result


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。"""
    parser = argparse.ArgumentParser(
        prog="python -m scripts.novelforge.check_consistency",
        description="NovelForge 跨章状态漂移检测：对比本章正文与 .state/ 状态机，发现 7 类不一致。",
    )
    parser.add_argument(
        "--chapter", type=int, required=True,
        help="章号（整数），如 42",
    )
    parser.add_argument(
        "--vault", type=str, default=None,
        help=f"Vault 根目录路径（默认 {DEFAULT_VAULT}）",
    )
    parser.add_argument(
        "--volume", type=int, default=None,
        help="卷号（默认从 .state/pipeline.json 自动探测）",
    )
    parser.add_argument(
        "--json", dest="as_json", action="store_true",
        help="输出 JSON 格式（供 Trae Skill 解析）",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="严格模式：检测到 P0 问题退出码 1（阻断保存）",
    )
    parser.add_argument(
        "--dim", type=str, default=None,
        help=(
            "只检测指定维度（逗号分隔多个）。"
            "可用短名: power_level/item/relationship/location/foreshadow/revival/golden_finger"
        ),
    )
    args = parser.parse_args(argv)

    vault = _resolve_vault(args.vault)
    if not os.path.isdir(vault):
        print(f"错误: Vault 路径不存在: {vault}", file=sys.stderr)
        return 2

    dims = _parse_dims(args.dim) if args.dim else None
    if args.dim and not dims:
        print("错误: --dim 指定的维度全部无效", file=sys.stderr)
        return 2

    try:
        report = check_all(
            chapter=args.chapter,
            vault=vault,
            volume=args.volume,
            dims=dims,
        )
    except FileNotFoundError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"脚本错误: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    # 输出报告
    if args.as_json:
        print(format_json(report))
    else:
        print(format_report(report))

    # 退出码
    if args.strict and report.p0_count > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
