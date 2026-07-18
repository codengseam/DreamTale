"""NovelForge 网文 AI 味检测脚本。

负责 NovelForge 网文成稿的"去 AI 味"质检，覆盖 10 个维度：
AI 感词、开局平庸、信息倾倒、金手指滥用、爽点套路化、章末钩子缺失、
字数控制、对话身份、心理-生理映射、句式节奏。

设计哲学：
- Vault SSOT：金手指名来自 ``.state/characters/protagonist.json`` 的
  ``power_level.abilities``；字数历史来自 ``.state/chapter_length_history.json``；
  章纲来自 ``04_大纲与脉络/vol_NN/ch_NNN_outline.md``；
  语言指纹来自 ``.state/characters/<name>.json`` 的 ``language_fingerprint``。
- 纯标准库：仅依赖 re/json/os/argparse/statistics/sys。
- 双引号检测：支持中文弯引号 " "（U+201C/U+201D）、直角引号 「 」
  （U+300C/U+300D）、英文直引号 "（U+0022）三种。
- 控量非禁用：废弃 HaloRead 误禁词（宛如/仿佛/交织），改为"每千字 ≤ 2 次"
  控量；旁白禁用词在对话内放行，避免误伤人物语言风格。

CLI 速查：
    # 检测第 42 章（drafts 优先，找不到则查 published）
    python -m scripts.novelforge.check_ai_novel --chapter 42 --vault NovelForge_Vault

    # JSON 输出（供 Trae Skill 解析）
    python -m scripts.novelforge.check_ai_novel --chapter 42 --json

    # strict 模式：P0/P1 触发退出码 1
    python -m scripts.novelforge.check_ai_novel --chapter 42 --strict

    # 单维度
    python -m scripts.novelforge.check_ai_novel --chapter 42 --dim chapter_end_hook

    # 直接检测文件
    python -m scripts.novelforge.check_ai_novel --file path/to/draft.md

退出码：
    0 - 全部通过（或仅 P2）
    1 - 有 P0/P1（仅在 --strict 模式下）
    2 - 脚本错误
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

# ============================================================================
# 路径与常量
# ============================================================================
DEFAULT_VAULT: str = "/workspace/NovelForge_Vault"

# Vault 内相对路径
STYLE_GUIDE_REL: str = "00_控制面/style_guide.md"
DRAFTS_REL: str = "05_正文/drafts"
PUBLISHED_REL: str = "05_正文/published"
OUTLINES_REL: str = "04_大纲与脉络"
CHARACTERS_REL: str = ".state/characters"
LENGTH_HISTORY_REL: str = ".state/chapter_length_history.json"

# 字数硬约束（网文）
WORD_COUNT_MIN: int = 2000
WORD_COUNT_MAX: int = 3000
WORD_COUNT_TOLERANCE: float = 0.20  # ±20%
WORD_COUNT_HARD_MIN: int = 1600
WORD_COUNT_HARD_MAX: int = 3600

# 检测窗口
OPENING_WINDOW: int = 200      # 开局检测前 N 字
CHAPTER_END_WINDOW: int = 100  # 章末检测末 N 字
INFO_DUMP_PARAGRAPH: int = 300  # 单段说明性文字阈值
MONOLOGUE_PARAGRAPHS: int = 3   # 连续无对话段数阈值
MONOLOGUE_TOTAL: int = 800      # 连续无对话总字数阈值
PSYCHO_WINDOW: int = 50         # 心理动词后生理词检测窗口

# 金手指阈值
GOLDEN_FINGER_MAX: int = 2  # 每章金手指使用上限

# 对话身份阈值
SENTENCE_LENGTH_DEVIATION: float = 0.30  # 句长偏离阈值 30%

# 句式节奏阈值
RHYTHM_STDDEV_MIN: int = 5       # 段内句长 σ 下限
PARA_HEAD_REPEAT: int = 3        # 段首词重复阈值
METAPHOR_PER_200: int = 1        # 比喻密度阈值（每 200 字）

# ============================================================================
# 词库
# ============================================================================

# P2 禁用词（仅禁旁白，对话内放行）
# 与 HaloRead quality.py 一致：首先/其次/总之/不可否认/具有重要意义/谱写
AI_WORDS_P2_BAN: tuple[str, ...] = (
    "首先", "其次", "总之", "不可否认", "具有重要意义", "谱写",
)

# 控量词（每千字 ≤ 2 次）—— 废弃 HaloRead 的"误禁"，改为控量
AI_WORDS_QUOTA: tuple[str, ...] = ("宛如", "仿佛", "交织")
AI_WORDS_QUOTA_PER_1K: int = 2

# P1 显性 AI 套路句式（旁白禁用，对话放行）
# 复用 HaloRead AI_PATTERNS_EXPLICIT 思路 + 网文上帝视角说教
AI_PATTERNS_EXPLICIT: tuple[str, ...] = (
    r"我们可以看到",
    r"这告诉我们",
    r"由此可见",
    r"不难看出",
    r"换句话说",
    r"归根结底",
    r"综上所述",
    r"历史的车轮",
    r"以史为鉴",
    r"总而言之",
    r"值得注意的是",
    r"不难发现",
    r"从这个角度来看",
    r"让我们",
    r"从某种意义上说",
    r"一言以蔽之",
    r"说到底",
    r"不仅.*而且",
)

# 开局套话开头（前 200 字出现 → 开局平庸）
OPENING_CLICHE_STARTERS: tuple[str, ...] = (
    "如今社会", "在这个时代", "话说", "很久以前",
    "曾经有一", "传说中", "在那个年代", "众所周知",
    "话说回来", "自古以来",
)

# 章末收束词（末段出现 → 章末收束无钩子）
CHAPTER_END_CLOSURE_WORDS: tuple[str, ...] = (
    "于是", "就这样", "从此", "就这样结束了",
    "自此", "便罢", "便作罢", "也就作罢",
    "一切归于平静", "一切恢复了平静", "也就这样",
)

# 动作动词（用于章末张力检测、信息倾倒切分检测）
ACTION_VERBS: tuple[str, ...] = (
    "走", "跑", "跳", "挥", "抓", "推", "拉", "踢", "打",
    "拔", "刺", "砍", "挡", "退", "进", "跪", "站", "坐",
    "看", "听", "说", "喊", "笑", "哭", "叹", "瞪", "望",
    "推开门", "转身", "抬头", "低头", "伸手", "收回",
)

# 爽点模式关键词（用于爽点套路化检测）
PLOT_PATTERNS: tuple[str, ...] = (
    "扮猪吃虎", "打脸", "掉马甲", "逆袭",
    "扮猪", "掉马", "翻盘", "反杀", "装弱",
)

# 心理动词（心理描写悬空检测）
PSYCHO_VERBS: tuple[str, ...] = (
    "想", "觉得", "认为", "明白",
    "恐惧", "愤怒", "紧张", "害怕",
    "犹豫", "得意", "悲伤", "羞愧", "决绝",
)

# 心理-生理映射表（硬编码常用映射，紧张/愤怒/恐惧/得意/犹豫 各 5-8 个生理词）
# 与 style_guide.md 附录 A 一致；可被 style_guide.md 解析结果覆盖
PSYCHO_PHYSIO_MAP: dict[str, tuple[str, ...]] = {
    "紧张": (
        "心跳加速", "手心出汗", "呼吸变浅", "喉咙发紧",
        "掌心冒汗", "心跳", "脉搏",
    ),
    "愤怒": (
        "太阳穴跳动", "拳头攥紧", "牙关咬合", "太阳穴血管凸起",
        "咬牙", "握紧", "青筋",
    ),
    "恐惧": (
        "后背发凉", "腿软", "汗毛倒竖", "胃部抽搐",
        "寒意", "战栗", "发抖",
    ),
    "得意": (
        "嘴角上扬", "眼神发亮", "步伐变轻", "手指轻叩",
        "扬眉", "笑意", "挑眉",
    ),
    "犹豫": (
        "手指敲击", "目光游移", "咬嘴唇", "脚尖转方向",
        "沉吟", "迟疑", "踌躇",
    ),
}

# 卷末/终章类型（章末钩子豁免）
CHAPTER_END_EXEMPT_TYPES: tuple[str, ...] = (
    "vol_end", "volume_end", "series_end", "finale", "终章", "卷末",
)

# ============================================================================
# 正则
# ============================================================================

# 双引号对话匹配：支持中文弯引号 " "、直角引号 「 」、英文直引号 "
_DIALOGUE_RE: re.Pattern[str] = re.compile(
    r'[\u201c\u300c"]([^\u201d\u300d"]{1,500})[\u201d\u300d"]',
    re.UNICODE,
)

# 句子切分（中文句末标点 + 英文）
_SENTENCE_RE: re.Pattern[str] = re.compile(r'[。！？!?]')

# 段落切分（两个及以上换行）
_PARAGRAPH_SPLIT_RE: re.Pattern[str] = re.compile(r'\n\s*\n+')

# 标点与空白（字数统计时剔除）
_PUNCT_CHARS: str = (
    "，。！？；：""''「」『』（）—…《》、·"
    ",.!?;:'\"()<>[]{}"
    "\u2014\u2013\u2026\u00b7"
    " \t\r\n\u3000"
    "#*- >`|_~"
)

# frontmatter（YAML）
_FRONTMATTER_RE: re.Pattern[str] = re.compile(
    r'^---\s*\n(.*?)\n---\s*\n?', re.DOTALL
)

# 章节类型提取（从 outline 解析）
# 兼容加粗格式「**章节类型**：vol_start」与非加粗格式「章节类型：regular」
_CHAPTER_TYPE_RE: re.Pattern[str] = re.compile(
    r'章节类型\*{0,2}[：:]\s*(\S+)'
)


# ============================================================================
# 数据类
# ============================================================================

@dataclass
class Issue:
    """单条检测问题。"""
    severity: str       # "P0" | "P1" | "P2"
    type: str           # 维度类型字符串（如 chapter_end_hook_missing）
    detail: str         # 详细描述
    suggestion: str     # 修复建议


@dataclass
class Report:
    """检测报告。"""
    chapter: str
    word_count: int
    dimensions_checked: int
    p0_count: int = 0
    p1_count: int = 0
    p2_count: int = 0
    issues: list[Issue] = field(default_factory=list)
    passed_dims: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """序列化为可 JSON 化的字典。"""
        d = asdict(self)
        return d


@dataclass
class CheckContext:
    """检测上下文，承载章节号、卷号、Vault 路径等元信息。"""
    chapter_num: int          # 章号（1-based）；--file 模式下为 0
    vol_num: int              # 卷号；未知为 0
    vault_path: str           # Vault 根路径
    outline_path: str | None  # 章纲文件路径；无则为 None
    is_opening_chapter: bool  # 是否属于前 3 章
    is_exempt_end: bool       # 是否卷末/终章（豁免章末钩子）
    golden_finger_names: list[str]   # 金手指名（从 protagonist.abilities 提取）
    fingerprints: dict[str, dict]    # 角色 ID -> language_fingerprint
    length_history: list[dict]       # 章节字数历史


# ============================================================================
# 工具函数
# ============================================================================

def _strip_punct(text: str) -> str:
    """剔除中英文标点、空白与 Markdown 符号，返回纯字符序列。

    与 HaloRead quality.py 的 _strip_punct_for_char_count 保持一致口径。
    """
    return "".join(ch for ch in text if ch not in _PUNCT_CHARS)


def strip_frontmatter(content: str) -> str:
    """去掉 YAML frontmatter，返回正文。

    仅当内容以 ``---\\n`` 开头才视为有 frontmatter；找不到闭合 ``---`` 则原样返回。
    """
    if not content.startswith("---"):
        return content.strip()
    m = _FRONTMATTER_RE.match(content)
    if m:
        return content[m.end():].strip()
    return content.strip()


def count_chars(content: str) -> int:
    """统计正文字数（不含 frontmatter、不含标点空白）。"""
    body = strip_frontmatter(content)
    return len(_strip_punct(body))


def extract_dialogues(content: str) -> list[str]:
    """提取所有对话内容（双引号/直角引号/直引号内文本）。"""
    return [m.group(1) for m in _DIALOGUE_RE.finditer(content)]


def extract_narration(content: str) -> str:
    """提取旁白（去掉对话后的文本）。

    用于 P2 禁用词检测：对话内放行，旁白内禁用。
    """
    return _DIALOGUE_RE.sub("", content)


def split_paragraphs(content: str) -> list[str]:
    """按空行切分段落，返回非空段落列表。"""
    body = strip_frontmatter(content)
    paras = [p.strip() for p in _PARAGRAPH_SPLIT_RE.split(body) if p.strip()]
    return paras


def split_sentences(text: str) -> list[str]:
    """按句末标点切分句子，返回非空句子列表（保留句内字符）。"""
    parts = _SENTENCE_RE.split(text)
    return [s.strip() for s in parts if s.strip()]


def sentence_lengths(text: str) -> list[int]:
    """返回 text 内每句的字数（已剔标点）。"""
    return [len(_strip_punct(s)) for s in split_sentences(text) if _strip_punct(s)]


def find_chapter_file(vault: str, chapter: int) -> tuple[str | None, int]:
    """在 drafts 和 published 下查找章正文文件。

    优先 drafts，找不到再查 published。返回 (文件路径, 卷号)；找不到返回 (None, 0)。
    """
    for sub in (DRAFTS_REL, PUBLISHED_REL):
        base = os.path.join(vault, sub)
        if not os.path.isdir(base):
            continue
        for vol_name in sorted(os.listdir(base)):
            vol_dir = os.path.join(base, vol_name)
            if not os.path.isdir(vol_dir):
                continue
            # 文件名形如 ch_042.md
            candidates = [
                f"ch_{chapter:03d}.md",
                f"ch_{chapter:02d}.md",
                f"ch_{chapter}.md",
            ]
            for cand in candidates:
                fp = os.path.join(vol_dir, cand)
                if os.path.isfile(fp):
                    vol_num = _parse_vol_num(vol_name)
                    return fp, vol_num
    return None, 0


def _parse_vol_num(vol_name: str) -> int:
    """从目录名 vol_NN 解析卷号；解析失败返回 0。"""
    m = re.search(r'(\d+)', vol_name)
    return int(m.group(1)) if m else 0


def find_outline_file(vault: str, chapter: int, vol_num: int) -> str | None:
    """查找章纲文件。

    路径形如 ``04_大纲与脉络/vol_NN/ch_NNN_outline.md``。
    """
    if vol_num <= 0:
        # 卷号未知时遍历所有 vol 目录
        outlines_root = os.path.join(vault, OUTLINES_REL)
        if not os.path.isdir(outlines_root):
            return None
        for vol_name in sorted(os.listdir(outlines_root)):
            cand = os.path.join(outlines_root, vol_name, f"ch_{chapter:03d}_outline.md")
            if os.path.isfile(cand):
                return cand
        return None
    cand = os.path.join(
        vault, OUTLINES_REL, f"vol_{vol_num:02d}",
        f"ch_{chapter:03d}_outline.md",
    )
    return cand if os.path.isfile(cand) else None


def load_golden_finger_names(vault: str) -> list[str]:
    """从 protagonist.json 的 power_level.abilities 提取金手指名。

    abilities 可能是字符串列表，也可能是对象列表（含 name 字段）。
    """
    fp = os.path.join(vault, CHARACTERS_REL, "protagonist.json")
    if not os.path.isfile(fp):
        return []
    try:
        with open(fp, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    abilities = data.get("power_level", {}).get("abilities", []) or []
    names: list[str] = []
    for a in abilities:
        if isinstance(a, str):
            if a.strip():
                names.append(a.strip())
        elif isinstance(a, dict):
            n = a.get("name") or a.get("id")
            if n and isinstance(n, str) and n.strip():
                names.append(n.strip())
    return names


def load_all_fingerprints(vault: str) -> dict[str, dict]:
    """加载 .state/characters/ 下所有角色的 language_fingerprint。

    返回 {角色 ID: language_fingerprint dict}。
    """
    result: dict[str, dict] = {}
    chars_dir = os.path.join(vault, CHARACTERS_REL)
    if not os.path.isdir(chars_dir):
        return result
    for fname in os.listdir(chars_dir):
        if not fname.endswith(".json"):
            continue
        fp = os.path.join(chars_dir, fname)
        try:
            with open(fp, encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        cid = data.get("character_id") or os.path.splitext(fname)[0]
        fp_data = data.get("language_fingerprint")
        if isinstance(fp_data, dict) and fp_data:
            result[cid] = fp_data
    return result


def load_length_history(vault: str) -> list[dict]:
    """加载 chapter_length_history.json 的 chapters 数组。"""
    fp = os.path.join(vault, LENGTH_HISTORY_REL)
    if not os.path.isfile(fp):
        return []
    try:
        with open(fp, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    chapters = data.get("chapters", []) or []
    return [c for c in chapters if isinstance(c, dict)]


def parse_chapter_type(outline_path: str | None) -> str:
    """从章纲解析章节类型；无章纲返回空串。"""
    if not outline_path or not os.path.isfile(outline_path):
        return ""
    try:
        with open(outline_path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return ""
    m = _CHAPTER_TYPE_RE.search(text)
    return m.group(1).strip() if m else ""


def parse_psycho_physio_from_style_guide(vault: str) -> dict[str, tuple[str, ...]] | None:
    """尝试从 style_guide.md 解析心理-生理映射表。

    解析失败返回 None，调用方使用硬编码 PSYCHO_PHYSIO_MAP。
    """
    fp = os.path.join(vault, STYLE_GUIDE_REL)
    if not os.path.isfile(fp):
        return None
    try:
        with open(fp, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    # 匹配形如 "| 紧张 | 心跳加速 / 手心出汗 / ... |" 的行
    result: dict[str, tuple[str, ...]] = {}
    for m in re.finditer(r'\|\s*([^\s|]+)\s*\|\s*([^|]+?)\s*\|', text):
        psycho = m.group(1).strip()
        # 仅匹配 PSYCHO_PHYSIO_MAP 已知键，避免误抓表头
        if psycho not in PSYCHO_PHYSIO_MAP:
            continue
        words_raw = m.group(2)
        words = [w.strip() for w in re.split(r'[/／、]', words_raw) if w.strip()]
        if words:
            result[psycho] = tuple(words)
    return result or None


# ============================================================================
# 检测函数（10 类）
# ============================================================================

def check_ai_word(content: str, ctx: CheckContext) -> list[Issue]:
    """1. AI 感词检测（P2，控量非禁用）。

    - P2 禁用词（首先/其次/总之/不可否认/具有重要意义/谱写）：仅禁旁白，对话放行。
    - 控量词（宛如/仿佛/交织）：每千字 ≤ 2 次。
    - P1 显性套路句式（我们可以看到/由此可见/综上所述/历史的车轮 等）：旁白禁。
    """
    issues: list[Issue] = []
    narration = extract_narration(content)
    total_chars = count_chars(content)
    per_1k_cap = max(AI_WORDS_QUOTA_PER_1K, (total_chars // 1000) * AI_WORDS_QUOTA_PER_1K)

    # P2 禁用词（仅旁白）
    for word in AI_WORDS_P2_BAN:
        if word in narration:
            issues.append(Issue(
                severity="P2",
                type="ai_word_banned_in_narration",
                detail=f"旁白出现禁用词「{word}」",
                suggestion=f"删除或改写：{word}（对话中可放行）",
            ))

    # 控量词
    for word in AI_WORDS_QUOTA:
        cnt = content.count(word)
        if cnt > per_1k_cap:
            issues.append(Issue(
                severity="P2",
                type="ai_word_quota_exceeded",
                detail=f"「{word}」出现 {cnt} 次，超过每千字 {AI_WORDS_QUOTA_PER_1K} 次上限",
                suggestion="控量到每千字 ≤ 2 次，改用具体动作或白描",
            ))

    # P1 显性套路句式（仅旁白）
    for pattern in AI_PATTERNS_EXPLICIT:
        matches = re.findall(pattern, narration)
        if matches:
            sample = matches[0] if isinstance(matches[0], str) else pattern
            issues.append(Issue(
                severity="P1",
                type="ai_pattern_explicit",
                detail=f"旁白出现 AI 套路句式「{sample}」（共 {len(matches)} 次）",
                suggestion="改写为角色台词或具体事件，避免上帝视角说教",
            ))

    return issues


def check_opening_flat(content: str, ctx: CheckContext) -> list[Issue]:
    """2. 开局平庸检测（P0，仅前 3 章）。

    - 前 200 字出现套话开头（如今社会/在这个时代/话说/很久以前）→ 开局平庸。
    - 前 200 字无 ? ! 对话 → 开局缺乏张力。
    """
    if not ctx.is_opening_chapter:
        return []  # 非前 3 章跳过

    issues: list[Issue] = []
    body = strip_frontmatter(content)
    head = body[:OPENING_WINDOW]

    # 套话开头
    for starter in OPENING_CLICHE_STARTERS:
        if starter in head:
            issues.append(Issue(
                severity="P0",
                type="opening_cliche_starter",
                detail=f"开局前 {OPENING_WINDOW} 字出现套话开头「{starter}」",
                suggestion="以反常细节/悬念/冲突/金手指初现切入，避免套话铺陈",
            ))
            break  # 一条足够

    # 缺乏张力
    has_question = "？" in head or "?" in head
    has_exclaim = "！" in head or "!" in head
    has_dialogue = bool(_DIALOGUE_RE.search(head))
    if not (has_question or has_exclaim or has_dialogue):
        issues.append(Issue(
            severity="P0",
            type="opening_lack_tension",
            detail=f"开局前 {OPENING_WINDOW} 字无疑问/感叹/对话，缺乏张力",
            suggestion="加入冲突对话或反常动作，制造开篇悬念",
        ))

    return issues


def check_info_dump(content: str, ctx: CheckContext) -> list[Issue]:
    """3. 信息倾倒检测（info dump，P0）。

    - 单段连续说明性文字 > 300 字且无对话/动作切分 → 信息倾倒。
    - 连续 3 段无对话且总字数 > 800 → 大段独白。
    """
    issues: list[Issue] = []
    paras = split_paragraphs(content)

    # 单段信息倾倒
    for i, p in enumerate(paras, 1):
        char_cnt = len(_strip_punct(p))
        has_dialogue = bool(_DIALOGUE_RE.search(p))
        has_action = any(v in p for v in ACTION_VERBS)
        if char_cnt > INFO_DUMP_PARAGRAPH and not has_dialogue and not has_action:
            preview = p[:50].replace("\n", " ")
            issues.append(Issue(
                severity="P0",
                type="info_dump_paragraph",
                detail=f"第 {i} 段连续说明性文字 {char_cnt} 字（>{INFO_DUMP_PARAGRAPH}），无对话/动作切分：{preview}…",
                suggestion="用对话或动作切分段落，把说明性内容拆散到场景中",
            ))

    # 连续 3 段无对话且总字数 > 800
    no_dialogue_streak: list[tuple[int, str, int]] = []  # (段号, 段文本, 字数)
    for i, p in enumerate(paras, 1):
        has_dialogue = bool(_DIALOGUE_RE.search(p))
        if not has_dialogue:
            no_dialogue_streak.append((i, p, len(_strip_punct(p))))
        else:
            no_dialogue_streak = []
        if len(no_dialogue_streak) >= MONOLOGUE_PARAGRAPHS:
            recent = no_dialogue_streak[-MONOLOGUE_PARAGRAPHS:]
            total = sum(c for _, _, c in recent)
            if total > MONOLOGUE_TOTAL:
                start_para = recent[0][0]
                issues.append(Issue(
                    severity="P0",
                    type="info_dump_monologue",
                    detail=f"第 {start_para}-{recent[-1][0]} 段连续无对话，总字数 {total}（>{MONOLOGUE_TOTAL}）",
                    suggestion="插入对话或场景切换，打破大段独白",
                ))
                break  # 一处即可

    return issues


def check_golden_finger(content: str, ctx: CheckContext) -> list[Issue]:
    """4. 金手指滥用检测（P1）。

    - 本章金手指使用次数 > 2 → 金手指滥用。
    - 章末冲突解决段（末段）含金手指名 → 金手指依赖。
    """
    if not ctx.golden_finger_names:
        return []  # 无金手指配置则跳过

    issues: list[Issue] = []
    used: dict[str, int] = {}
    for name in ctx.golden_finger_names:
        cnt = content.count(name)
        if cnt > 0:
            used[name] = cnt
    total_used = sum(used.values())

    if total_used > GOLDEN_FINGER_MAX:
        names_str = "/".join(f"{n}×{c}" for n, c in used.items())
        issues.append(Issue(
            severity="P1",
            type="golden_finger_overuse",
            detail=f"本章金手指使用 {total_used} 次（>{GOLDEN_FINGER_MAX}）：{names_str}",
            suggestion="减少金手指依赖，增加策略性对抗",
        ))

    # 章末冲突解决段（末段）含金手指名
    paras = split_paragraphs(content)
    if paras:
        last_para = paras[-1]
        dep_names = [n for n in ctx.golden_finger_names if n in last_para]
        if dep_names:
            issues.append(Issue(
                severity="P1",
                type="golden_finger_dependence",
                detail=f"章末冲突解决段依赖金手指：{'/'.join(dep_names)}",
                suggestion="让主角靠谋略或外部条件破局，避免金手指兜底",
            ))

    return issues


def check_plot_cliche(content: str, ctx: CheckContext) -> list[Issue]:
    """5. 爽点套路化检测（P1）。

    读取最近 3 章（含本章）的 plot_pattern：
    - 优先从章纲提取（在 outline 全文中匹配 PLOT_PATTERNS 关键词）。
    - 退而从正文首尾段提取。
    - 连续 3 章模式重复 → 爽点套路化。
    - 无章纲则跳过。
    """
    issues: list[Issue] = []
    if ctx.chapter_num <= 0:
        return []

    # 收集最近 3 章（含本章）的爽点模式
    chapter_patterns: dict[int, set[str]] = {}
    has_outline = False
    for ch in range(max(1, ctx.chapter_num - 2), ctx.chapter_num + 1):
        patterns: set[str] = set()
        # 优先章纲
        outline_path = find_outline_file(ctx.vault_path, ch, ctx.vol_num)
        if outline_path and os.path.isfile(outline_path):
            has_outline = True
            try:
                with open(outline_path, encoding="utf-8") as f:
                    outline_text = f.read()
            except OSError:
                outline_text = ""
            for kw in PLOT_PATTERNS:
                if kw in outline_text:
                    patterns.add(kw)
        # 退而求正文
        if not patterns:
            ch_file, _ = find_chapter_file(ctx.vault_path, ch)
            if ch_file and os.path.isfile(ch_file):
                try:
                    with open(ch_file, encoding="utf-8") as f:
                        body = strip_frontmatter(f.read())
                except OSError:
                    body = ""
                paras = split_paragraphs(body)
                head_tail = (paras[0] if paras else "") + (paras[-1] if paras else "")
                for kw in PLOT_PATTERNS:
                    if kw in head_tail:
                        patterns.add(kw)
        chapter_patterns[ch] = patterns

    if not has_outline:
        return []  # 无章纲则跳过

    # 找出 3 章共同含有的模式
    if len(chapter_patterns) >= 3:
        common = set.intersection(*chapter_patterns.values())
        if common:
            issues.append(Issue(
                severity="P1",
                type="plot_cliche_repetition",
                detail=f"连续 3 章重复爽点模式：{'/'.join(sorted(common))}",
                suggestion="变换爽点类型，避免读者疲劳",
            ))

    return issues


def check_chapter_end_hook(content: str, ctx: CheckContext) -> list[Issue]:
    """6. 章末钩子缺失检测（P0）。

    - 末段含收束词（于是/就这样/从此/就这样结束了）→ 章末收束无钩子。
    - 末段无 ? ! 对话 动作动词 → 章末平淡。
    - 卷末章/终章可豁免。
    """
    if ctx.is_exempt_end:
        return []

    issues: list[Issue] = []
    body = strip_frontmatter(content)
    paras = split_paragraphs(body)
    if not paras:
        return []

    last_para = paras[-1]
    tail = body[-CHAPTER_END_WINDOW:]

    # 收束词检测
    for word in CHAPTER_END_CLOSURE_WORDS:
        if word in last_para:
            preview = last_para[-60:].replace("\n", " ")
            issues.append(Issue(
                severity="P0",
                type="chapter_end_closure_no_hook",
                detail=f"末段含收束词「{word}」：…{preview}",
                suggestion="末段加入悬念/危机/爽点预告，避免平推收尾",
            ))
            break  # 一条足够

    # 章末平淡检测
    has_question = "？" in tail or "?" in tail
    has_exclaim = "！" in tail or "!" in tail
    has_dialogue = bool(_DIALOGUE_RE.search(tail))
    has_action = any(v in tail for v in ACTION_VERBS)
    if not (has_question or has_exclaim or has_dialogue or has_action):
        preview = tail.replace("\n", " ").strip()
        issues.append(Issue(
            severity="P0",
            type="chapter_end_flat",
            detail=f"末 {CHAPTER_END_WINDOW} 字无 ? ! 对话 动作，章末平淡：{preview}",
            suggestion="用动作卡断/危机降临/悬念抛出作钩子",
        ))

    return issues


def check_word_count(content: str, ctx: CheckContext) -> list[Issue]:
    """7. 字数控制检测（P0）。

    - 网文每章 2000-3000 字硬约束，±20% 即 1600-3600。
    - < 1600 或 > 3600 → 字数越界。
    - 近 10 章均长方差过大 → 字数不均（P1）。
    """
    issues: list[Issue] = []
    wc = count_chars(content)

    if wc < WORD_COUNT_HARD_MIN or wc > WORD_COUNT_HARD_MAX:
        issues.append(Issue(
            severity="P0",
            type="word_count_violation",
            detail=f"本章字数 {wc}，要求 {WORD_COUNT_MIN}-{WORD_COUNT_MAX}（±{int(WORD_COUNT_TOLERANCE*100)}% 即 {WORD_COUNT_HARD_MIN}-{WORD_COUNT_HARD_MAX}）",
            suggestion="扩展场景描写或对话（不足时）/删减冗余铺陈（超量时）",
        ))

    # 近 10 章字数方差
    recent = ctx.length_history[-10:] if ctx.length_history else []
    if len(recent) >= 5:
        wcs = [c.get("word_count", 0) for c in recent if isinstance(c.get("word_count"), int)]
        if len(wcs) >= 5:
            try:
                stdev = statistics.pstdev(wcs)
                mean = statistics.mean(wcs)
                if mean > 0 and stdev / mean > 0.25:
                    issues.append(Issue(
                        severity="P1",
                        type="word_count_uneven",
                        detail=f"近 {len(wcs)} 章字数标准差 {stdev:.0f}（均值 {mean:.0f}，变异系数 {stdev/mean:.2f}）",
                        suggestion="控制单章字数在均值 ±10% 区间，保持节奏均匀",
                    ))
            except statistics.StatisticsError:
                pass

    return issues


def check_dialogue_identity(content: str, ctx: CheckContext) -> list[Issue]:
    """8. 对话身份检测（P1）。

    基于角色 language_fingerprint 校验本章对话：
    - 平均句长偏离 fingerprint.avg_sentence_length > 30% → 语气失常。
    - preferred_words 重叠率为 0（一个都没用）→ 角色失声。
    - 出现 forbidden_words → 角色用词违规。
    - 称谓违反 address_habits → 称谓不符。

    说明：本章无法精确归属每句对话到具体角色，故对主角（POV）做句长/用词
    校验；forbidden_words/address_habits 对所有角色指纹交叉校验。
    """
    issues: list[Issue] = []
    dialogues = extract_dialogues(content)
    if not dialogues or not ctx.fingerprints:
        return []

    # 主角优先（character_id == "protagonist"）
    protag_fp = ctx.fingerprints.get("protagonist")
    if protag_fp:
        # 句长
        avg_target = protag_fp.get("avg_sentence_length")
        if isinstance(avg_target, int) and avg_target > 0:
            all_dialogue_text = "".join(dialogues)
            lens = sentence_lengths(all_dialogue_text)
            if lens:
                avg_actual = statistics.mean(lens)
                deviation = abs(avg_actual - avg_target) / avg_target
                if deviation > SENTENCE_LENGTH_DEVIATION:
                    issues.append(Issue(
                        severity="P1",
                        type="dialogue_tone_off",
                        detail=f"主角平均对话句长 {avg_actual:.0f} 字（指纹 {avg_target} 字，偏离 {deviation*100:.0f}%）",
                        suggestion="调整该角色对话句长，向指纹靠拢",
                    ))

        # preferred_words 重叠率
        preferred = protag_fp.get("preferred_words") or []
        if preferred:
            all_dialogue_text = "".join(dialogues)
            hit = sum(1 for w in preferred if w in all_dialogue_text)
            if hit == 0:
                issues.append(Issue(
                    severity="P1",
                    type="dialogue_voice_lost",
                    detail=f"主角 preferred_words 一个未出现：{preferred}",
                    suggestion="让主角使用其高频词（如「罢了/何须/且看」），保持语言指纹",
                ))

    # forbidden_words / address_habits 对所有角色交叉校验
    for cid, fp in ctx.fingerprints.items():
        forbidden = fp.get("forbidden_words") or []
        for w in forbidden:
            for d in dialogues:
                if w in d:
                    issues.append(Issue(
                        severity="P1",
                        type="dialogue_forbidden_word",
                        detail=f"角色 {cid} 对话出现 forbidden_word「{w}」",
                        suggestion=f"该角色绝不会说「{w}」，改写台词",
                    ))
                    break  # 每角色每词一条

        # 称谓习惯
        habits = fp.get("address_habits") or {}
        for target_key, expected_call in habits.items():
            # 若对话中提到 target_key 但未使用 expected_call → 称谓不符
            for d in dialogues:
                if target_key in d and expected_call not in d:
                    issues.append(Issue(
                        severity="P1",
                        type="dialogue_address_mismatch",
                        detail=f"角色 {cid} 提到「{target_key}」未使用规范称谓「{expected_call}」",
                        suggestion=f"该角色应称 {target_key} 为「{expected_call}」",
                    ))
                    break

    return issues


def check_psycho_physio(content: str, ctx: CheckContext) -> list[Issue]:
    """9. 心理-生理映射检测（P2）。

    心理动词（想/觉得/认为/明白/恐惧/愤怒/紧张/害怕）后 50 字内无生理反应词
    → 心理描写悬空。

    生理词库优先从 style_guide.md 解析，解析失败用硬编码 PSYCHO_PHYSIO_MAP。
    """
    issues: list[Issue] = []
    body = strip_frontmatter(content)

    # 生理词库：尝试从 style_guide.md 解析覆盖
    physio_map = parse_psycho_physio_from_style_guide(ctx.vault_path) or PSYCHO_PHYSIO_MAP
    all_physio: set[str] = set()
    for words in physio_map.values():
        all_physio.update(words)

    # 心理动词检测
    for verb in PSYCHO_VERBS:
        for m in re.finditer(re.escape(verb), body):
            window = body[m.end():m.end() + PSYCHO_WINDOW]
            has_physio = any(w in window for w in all_physio)
            if not has_physio:
                snippet = body[max(0, m.start()-10):m.end() + PSYCHO_WINDOW].replace("\n", " ")
                issues.append(Issue(
                    severity="P2",
                    type="psycho_physio_dangling",
                    detail=f"心理动词「{verb}」后 {PSYCHO_WINDOW} 字内无生理反应：…{snippet}…",
                    suggestion=f"配生理反应（{verb}→心跳/手心出汗/腿软 等），避免纯心理独白",
                ))
                if len(issues) >= 5:
                    return issues  # 限制单维度上报数量

    return issues


def check_rhythm(content: str, ctx: CheckContext) -> list[Issue]:
    """10. 句式节奏检测（P2）。

    - 段落内句长标准差 σ < 5 字 → 句式节奏均匀（AI 味）。
    - 段首词重复：同一章 ≥ 3 段同首词 → 段首词重复。
    - 比喻密度：识别"像/如/似/仿佛"句，> 1 个/200 字 → 比喻过度。
    """
    issues: list[Issue] = []
    paras = split_paragraphs(content)

    # 段内句长标准差
    for i, p in enumerate(paras, 1):
        lens = sentence_lengths(p)
        if len(lens) >= 3:
            try:
                sigma = statistics.pstdev(lens)
                if sigma < RHYTHM_STDDEV_MIN:
                    preview = p[:40].replace("\n", " ")
                    issues.append(Issue(
                        severity="P2",
                        type="rhythm_too_uniform",
                        detail=f"第 {i} 段句长标准差 {sigma:.1f} 字（<{RHYTHM_STDDEV_MIN}），节奏过于均匀：{preview}…",
                        suggestion="长短句交错，打破 AI 式均匀节奏",
                    ))
                    if len(issues) >= 5:
                        break
            except statistics.StatisticsError:
                pass

    # 段首词重复
    head_counter: dict[str, int] = {}
    for p in paras:
        # 取段首第一个非空白字符
        stripped = p.lstrip()
        if not stripped:
            continue
        head = stripped[0]
        head_counter[head] = head_counter.get(head, 0) + 1
    for head, cnt in head_counter.items():
        if cnt >= PARA_HEAD_REPEAT:
            issues.append(Issue(
                severity="P2",
                type="rhythm_para_head_repeat",
                detail=f"段首词「{head}」重复 {cnt} 次（≥{PARA_HEAD_REPEAT}）",
                suggestion="变换段首起手词，避免模板化",
            ))
            break  # 一条足够

    # 比喻密度
    body = strip_frontmatter(content)
    char_cnt = len(_strip_punct(body))
    if char_cnt > 0:
        metaphor_cnt = sum(body.count(w) for w in ("像", "如", "似", "仿佛"))
        # 每 200 字比喻数
        per_200 = metaphor_cnt / (char_cnt / 200) if char_cnt >= 200 else metaphor_cnt
        if char_cnt >= 200 and per_200 > METAPHOR_PER_200:
            issues.append(Issue(
                severity="P2",
                type="rhythm_metaphor_dense",
                detail=f"比喻密度 {per_200:.2f} 个/200 字（>{METAPHOR_PER_200}），共 {metaphor_cnt} 处",
                suggestion="减少比喻句，多用白描与动作",
            ))

    return issues


# ============================================================================
# 检测维度注册表
# ============================================================================

# 维度名 -> (检测函数, 中文展示名)
DIMENSIONS: list[tuple[str, str, Any]] = [
    ("ai_word", "AI 感词", check_ai_word),
    ("opening_flat", "开局平庸", check_opening_flat),
    ("info_dump", "信息倾倒", check_info_dump),
    ("golden_finger", "金手指滥用", check_golden_finger),
    ("plot_cliche", "爽点套路化", check_plot_cliche),
    ("chapter_end_hook", "章末钩子缺失", check_chapter_end_hook),
    ("word_count", "字数控制", check_word_count),
    ("dialogue_identity", "对话身份", check_dialogue_identity),
    ("psycho_physio", "心理-生理映射", check_psycho_physio),
    ("rhythm", "句式节奏", check_rhythm),
]

DIM_NAMES: dict[str, str] = {name: cn for name, cn, _ in DIMENSIONS}


# ============================================================================
# 总入口
# ============================================================================

def build_context(
    vault: str,
    chapter_num: int,
    vol_num: int = 0,
    outline_path: str | None = None,
) -> CheckContext:
    """构建检测上下文。

    会读取 protagonist.json（金手指）、characters/*.json（指纹）、
    chapter_length_history.json（字数历史），失败容错。
    """
    # 若 outline_path 未提供且 chapter_num 已知，则尝试查找
    if chapter_num > 0 and not outline_path:
        outline_path = find_outline_file(vault, chapter_num, vol_num)

    chapter_type = parse_chapter_type(outline_path)
    is_exempt_end = any(t in chapter_type for t in CHAPTER_END_EXEMPT_TYPES) if chapter_type else False

    return CheckContext(
        chapter_num=chapter_num,
        vol_num=vol_num,
        vault_path=vault,
        outline_path=outline_path,
        is_opening_chapter=1 <= chapter_num <= 3,
        is_exempt_end=is_exempt_end,
        golden_finger_names=load_golden_finger_names(vault),
        fingerprints=load_all_fingerprints(vault),
        length_history=load_length_history(vault),
    )


def check_all(
    content: str,
    ctx: CheckContext,
    dim_filter: str | None = None,
) -> Report:
    """运行全部 10 维检测，返回 Report。

    Args:
        content: 章节正文（含 frontmatter）。
        ctx: 检测上下文。
        dim_filter: 仅运行指定维度（维度名）；None 表示全部。

    Returns:
        Report 对象。
    """
    word_count = count_chars(content)
    issues: list[Issue] = []
    passed_dims: list[str] = []
    dims_run = 0

    for dim_name, dim_cn, fn in DIMENSIONS:
        if dim_filter and dim_name != dim_filter:
            continue
        dims_run += 1
        try:
            dim_issues = fn(content, ctx)
        except Exception as e:  # 单维度异常不应中断整体检测
            dim_issues = [Issue(
                severity="P2",
                type=f"{dim_name}_error",
                detail=f"维度 {dim_cn} 检测异常：{type(e).__name__}: {e}",
                suggestion="检查输入文件格式或 Vault 状态文件",
            )]
        if dim_issues:
            issues.extend(dim_issues)
        else:
            passed_dims.append(dim_cn)

    p0 = sum(1 for i in issues if i.severity == "P0")
    p1 = sum(1 for i in issues if i.severity == "P1")
    p2 = sum(1 for i in issues if i.severity == "P2")

    chapter_label = f"ch_{ctx.chapter_num:03d}" if ctx.chapter_num > 0 else "file"
    return Report(
        chapter=chapter_label,
        word_count=word_count,
        dimensions_checked=dims_run,
        p0_count=p0,
        p1_count=p1,
        p2_count=p2,
        issues=issues,
        passed_dims=passed_dims,
    )


# ============================================================================
# 报告渲染
# ============================================================================

_SEVERITY_EMOJI = {"P0": "🔴", "P1": "🟡", "P2": "🔵"}


def render_human_report(report: Report) -> str:
    """渲染人类可读报告。"""
    lines: list[str] = []
    lines.append(f"=== 去 AI 味检测报告 {report.chapter} ===")
    lines.append(f"总字数: {report.word_count} 字")
    lines.append(f"检测维度: {report.dimensions_checked}")
    lines.append(f"P0 问题: {report.p0_count} (阻断)")
    lines.append(f"P1 警告: {report.p1_count}")
    lines.append(f"P2 提醒: {report.p2_count}")
    lines.append("")

    # 按 P0 -> P1 -> P2 排序
    sev_order = {"P0": 0, "P1": 1, "P2": 2}
    sorted_issues = sorted(report.issues, key=lambda x: sev_order.get(x.severity, 9))
    for issue in sorted_issues:
        emoji = _SEVERITY_EMOJI.get(issue.severity, "⚪")
        lines.append(f"{emoji} [{issue.severity}] {issue.type}")
        lines.append(f"   详情: {issue.detail}")
        lines.append(f"   建议: {issue.suggestion}")
        lines.append("")

    if report.passed_dims:
        lines.append(f"✅ 通过: {'/'.join(report.passed_dims)}")
    else:
        lines.append("✅ 通过: （无）")
    return "\n".join(lines)


def render_json_report(report: Report) -> str:
    """渲染 JSON 报告。"""
    payload = {
        "chapter": report.chapter,
        "word_count": report.word_count,
        "dimensions_checked": report.dimensions_checked,
        "p0_count": report.p0_count,
        "p1_count": report.p1_count,
        "p2_count": report.p2_count,
        "issues": [
            {
                "severity": i.severity,
                "type": i.type,
                "detail": i.detail,
                "suggestion": i.suggestion,
            }
            for i in report.issues
        ],
        "passed_dims": report.passed_dims,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ============================================================================
# CLI
# ============================================================================

def _build_arg_parser() -> argparse.ArgumentParser:
    """构建命令行参数解析器。"""
    parser = argparse.ArgumentParser(
        prog="check_ai_novel",
        description="NovelForge 网文 AI 味检测脚本（10 维去 AI 味质检）",
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
        "--json", action="store_true",
        help="输出 JSON 格式报告",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="严格模式：P0/P1 触发退出码 1",
    )
    parser.add_argument(
        "--dim", type=str, default=None,
        choices=[name for name, _, _ in DIMENSIONS],
        help="仅运行指定维度（如 chapter_end_hook）",
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
    vol_num: int
    outline_path: str | None

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
        vol_num = 0
        # 文件模式下也尝试从 frontmatter 解析 ch/vol
        outline_path = None
    elif args.chapter:
        ch_file, vol_num = find_chapter_file(vault, args.chapter)
        if not ch_file:
            print(
                f"[错误] 未找到第 {args.chapter} 章正文（已查 drafts/published）",
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
        outline_path = find_outline_file(vault, chapter_num, vol_num)
    else:
        parser.error("必须提供 --chapter 或 --file 之一")
        return 2

    # 空文件/模板不崩溃：检查 content 是否为空或纯模板
    if not content.strip():
        print("[警告] 文件内容为空，跳过检测", file=sys.stderr)
        empty_report = Report(
            chapter=f"ch_{chapter_num:03d}" if chapter_num > 0 else "file",
            word_count=0,
            dimensions_checked=0,
        )
        print(render_json_report(empty_report) if args.json else render_human_report(empty_report))
        return 0

    ctx = build_context(vault, chapter_num, vol_num, outline_path)
    report = check_all(content, ctx, dim_filter=args.dim)

    if args.json:
        print(render_json_report(report))
    else:
        print(render_human_report(report))

    # 退出码
    if args.strict and (report.p0_count > 0 or report.p1_count > 0):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
