"""NovelForge 上下文编排脚本（build_context）。

为正文生成精准组装 Prompt 上下文，严格按 Token 预算控制注入量。

防漂移核心策略：不直接注入历史正文全文，而是三层组装——
  - L0 Protected 层：全量注入（章纲/角色状态/伏笔/焦点/作者意图 L0），不可压缩
  - L1 Selective 层：按需直读（前章摘要/前情链/设定文件），可压缩
  - L2 Retrieved 层：关键场景召回（_scenes/ 全文），可压缩

Token 预算按章节类型分桶（regular 8K / hook_resolve 10K / vol_start 12K / climax 12K / transition 6K），
超预算时先压 Selective、再压 Retrieved、Protected 不可压。

CLI 入口：
    python -m scripts.novelforge.build_context --chapter 42
    python -m scripts.novelforge.build_context --chapter 42 --json
    python -m scripts.novelforge.build_context --chapter 42 --dry-run
    python -m scripts.novelforge.build_context --chapter 42 --budget 12000
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

# 第三方依赖：tiktoken 可选，缺失时 fallback 到字符数估算
try:
    import tiktoken  # type: ignore

    _ENC = tiktoken.get_encoding("cl100k_base")
    _TIKTOKEN_AVAILABLE = True
except Exception:
    tiktoken = None  # type: ignore
    _ENC = None
    _TIKTOKEN_AVAILABLE = False

# 同包 schema 导入（包内相对导入，兼容直接 import）
try:
    from .schema import CONTEXT_BUDGET_SCHEMA  # noqa: F401  保留以备扩展校验
except ImportError:  # pragma: no cover - 兜底直接运行
    from scripts.novelforge.schema import CONTEXT_BUDGET_SCHEMA  # type: ignore

# ============================================================================
# 常量
# ============================================================================
DEFAULT_VAULT = Path("/workspace/NovelForge_Vault")

# 章节类型默认预算（与 schema.CONTEXT_BUDGET_SCHEMA 一致，作 fallback）
DEFAULT_BUDGETS: dict[str, int] = {
    "regular": 8000,
    "hook_resolve": 10000,
    "vol_start": 12000,
    "climax": 12000,
    "transition": 6000,
}

# 章节类型合法集合
CHAPTER_TYPES = set(DEFAULT_BUDGETS.keys())

# 角色活跃窗口：last_appeared_ch >= 当前章 - CHARACTER_ACTIVE_WINDOW 视为活跃
CHARACTER_ACTIVE_WINDOW = 10

# 前情链默认章数 / 压缩后章数
OUTLINE_CHAIN_DEFAULT = 5
OUTLINE_CHAIN_COMPRESSED = 3

# 前情链每章摘要字符上限
OUTLINE_SUMMARY_CHARS = 100

# 前章摘要字符上限（无显式摘要时取前 N 字）
PREV_CHAPTER_SUMMARY_CHARS = 300

# 场景压缩后摘要字符上限
SCENE_SUMMARY_CHARS = 300

# 设定文件每文件字符上限（避免单文件撑爆预算）
SETTING_FILE_CHARS = 800


# ============================================================================
# Token 计数
# ============================================================================
def count_tokens(text: str) -> int:
    """计算 text 的 Token 数。

    优先用 tiktoken cl100k_base 编码；若 tiktoken 不可用，按中文 Token 估算
    （字符数 / 1.5，向上取整）。空文本返回 0。
    """
    if not text:
        return 0
    if _TIKTOKEN_AVAILABLE and _ENC is not None:
        try:
            return len(_ENC.encode(text))
        except Exception:
            pass
    # fallback：中文 1 字 ≈ 1.5 token
    return max(1, int(len(text) / 1.5) + (1 if len(text) % 1.5 else 0))


# ============================================================================
# 数据结构
# ============================================================================
@dataclass
class ContextItem:
    """上下文条目：key 为人类可读名称，text 为注入正文，tokens 为已计算的 Token 数。"""

    key: str
    text: str
    tokens: int = 0
    meta: str = ""  # 附加说明，如「3 角色」「5 章」

    def __post_init__(self) -> None:
        if self.tokens == 0:
            self.tokens = count_tokens(self.text)


@dataclass
class LayerReport:
    """单层上下文报告。"""

    name: str
    items: list[ContextItem] = field(default_factory=list)

    @property
    def total_tokens(self) -> int:
        return sum(it.tokens for it in self.items)


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

    @property
    def total_tokens(self) -> int:
        return self.protected.total_tokens + self.selective.total_tokens + self.retrieved.total_tokens

    @property
    def utilization_pct(self) -> float:
        if self.budget <= 0:
            return 0.0
        return round(self.total_tokens / self.budget * 100, 1)


# ============================================================================
# 文件读取辅助
# ============================================================================
def _safe_read(path: Path) -> str:
    """安全读取文本文件，不存在或异常返回空串。"""
    try:
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _safe_read_json(path: Path) -> dict:
    """安全读取 JSON 文件，失败返回空 dict。"""
    try:
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _extract_section(text: str, heading_pattern: str) -> str:
    """从 Markdown 中提取某个 ## / ### 标题下的正文，到下一个同级或更高级标题为止。

    heading_pattern 形如 r"## 三、核心冲突"。
    """
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
        if m:  # 遇到同级或更高级标题，结束
            break
        out.append(line)
    return "\n".join(out).strip()


# ============================================================================
# Vault 路径解析
# ============================================================================
def _find_volume_for_chapter(vault: Path, chapter: int) -> int:
    """定位章节所属卷号。先按章纲文件存在性匹配，否则取第一个 vol_* 目录，再否则 1。"""
    outline_root = vault / "04_大纲与脉络"
    ch_str = f"ch_{chapter:03d}"
    if outline_root.exists():
        for vol_dir in sorted(outline_root.glob("vol_*")):
            if (vol_dir / f"{ch_str}_outline.md").exists():
                m = re.match(r"vol_(\d+)", vol_dir.name)
                if m:
                    return int(m.group(1))
        # 章纲不存在时，退而取第一个 vol_* 目录
        for vol_dir in sorted(outline_root.glob("vol_*")):
            m = re.match(r"vol_(\d+)", vol_dir.name)
            if m:
                return int(m.group(1))
    return 1


def _chapter_outline_path(vault: Path, chapter: int, volume: int) -> Path:
    return vault / "04_大纲与脉络" / f"vol_{volume:02d}" / f"ch_{chapter:03d}_outline.md"


# ============================================================================
# Protected 层读取
# ============================================================================
def _read_chapter_outline(vault: Path, chapter: int, volume: int) -> str:
    """读取当前章纲全文。"""
    return _safe_read(_chapter_outline_path(vault, chapter, volume))


def _read_active_characters(vault: Path, chapter: int) -> list[tuple[Path, dict]]:
    """读取活跃角色：last_appeared_ch >= 当前章 - 10 的角色 JSON。

    主角模板 last_appeared_ch=0，对当前章 1 来说 0 >= -9 为真，故主角恒纳入。
    """
    chars_dir = vault / ".state" / "characters"
    if not chars_dir.exists():
        return []
    threshold = chapter - CHARACTER_ACTIVE_WINDOW
    out: list[tuple[Path, dict]] = []
    for jf in sorted(chars_dir.glob("*.json")):
        data = _safe_read_json(jf)
        if not data:
            continue
        last = data.get("last_appeared_ch", 0)
        if not isinstance(last, (int, float)):
            last = 0
        if last >= threshold:
            out.append((jf, data))
    return out


def _format_character_brief(data: dict) -> str:
    """将角色状态 JSON 渲染为精简 Markdown（location/power_level/emotion/relationships）。"""
    basic = data.get("basic", {}) or {}
    name = basic.get("name") or "(未命名)"
    role = basic.get("role", "")
    role_label = {"protagonist": "主角", "antagonist": "反派", "supporting": "配角", "extra": "龙套"}.get(
        role, role
    )

    lines: list[str] = []
    header = f"### {role_label} {name}".strip()
    lines.append(header)

    loc = data.get("location", {}) or {}
    lines.append(f"- 位置：{loc.get('current') or '未知'}")

    power = data.get("power_level", {}) or {}
    realm = power.get("realm")
    if realm:
        progress = power.get("realm_progress", 0)
        lines.append(f"- 境界：{realm}（进度 {progress}）")

    emo = data.get("emotion", {}) or {}
    if emo.get("current"):
        lines.append(f"- 情绪：{emo['current']}")

    rels = data.get("relationships", []) or []
    if rels:
        lines.append("- 关系：")
        for r in rels:
            target = r.get("target", "?")
            rtype = r.get("type", "?")
            trust = r.get("trust", 0)
            lines.append(f"  - {target}（{rtype}, trust={trust}）")

    lines.append(f"- last_appeared_ch: {data.get('last_appeared_ch', 0)}")
    return "\n".join(lines)


def _read_unresolved_hooks(vault: Path) -> list[dict]:
    """读取未填伏笔：status in (planted, hinted)。"""
    hooks_file = vault / "04_大纲与脉络" / "hooks_registry.json"
    data = _safe_read_json(hooks_file)
    hooks = data.get("hooks", []) if isinstance(data, dict) else []
    return [h for h in hooks if h.get("status") in ("planted", "hinted")]


def _format_hooks(hooks: list[dict]) -> str:
    """渲染伏笔列表：- H-017 (ch12): 描述。"""
    if not hooks:
        return "（无未填伏笔）"
    lines: list[str] = []
    for h in hooks:
        hid = h.get("hook_id", "?")
        desc = h.get("description", "")
        planted = h.get("planted_ch", 0)
        lines.append(f"- {hid} (ch{planted}): {desc}")
    return "\n".join(lines)


def _read_current_focus(vault: Path) -> str:
    """读取 00_控制面/current_focus.md 全文。"""
    return _safe_read(vault / "00_控制面" / "current_focus.md")


def _read_author_intent_l0(vault: Path) -> str:
    """读取 author_intent.md 的 L0 摘要版（用 `---` 分隔 L0 和 L2）。

    文件结构：头部 `# 创作意图` + 引用块 → `---` → `## L0 摘要版` 内容 → `---` → `## L2 全文`。
    本函数返回包含 `## L0 摘要版` 的那段。
    """
    text = _safe_read(vault / "00_控制面" / "author_intent.md")
    if not text:
        return ""
    parts = re.split(r"^---\s*$", text, flags=re.MULTILINE)
    for part in parts:
        if "L0 摘要版" in part or "L0摘要版" in part:
            return part.strip()
    # fallback：返回头部前 500 字
    return text[:500].strip()


# ============================================================================
# Selective 层读取
# ============================================================================
def _read_prev_chapter_summary(vault: Path, chapter: int, volume: int) -> str:
    """读取前 1 章正文的首段摘要，无显式摘要则取正文前 300 字。"""
    if chapter <= 1:
        return ""
    prev_path = vault / "05_正文" / "published" / f"vol_{volume:02d}" / f"ch_{chapter - 1:03d}.md"
    text = _safe_read(prev_path)
    if not text:
        return ""
    # 跳过 H1 标题行与文件头部 `>` 引用块
    lines = text.splitlines()
    body_start = 0
    for i, line in enumerate(lines):
        if line.startswith("# "):
            continue
        if line.startswith(">"):
            continue
        if not line.strip():
            continue
        body_start = i
        break
    body = "\n".join(lines[body_start:]).strip()
    if not body:
        return ""
    # 取第一个非空段落
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    if not paragraphs:
        return body[:PREV_CHAPTER_SUMMARY_CHARS]
    first = paragraphs[0]
    # 若首段过长（>300 字），截断
    if len(first) > PREV_CHAPTER_SUMMARY_CHARS:
        return first[:PREV_CHAPTER_SUMMARY_CHARS]
    return first


def _summarize_outline(outline_text: str, chapter: int) -> str:
    """把一章纲压缩为 ≤100 字的摘要：优先取「核心冲突」段，否则取正文前 100 字。"""
    if not outline_text:
        return ""
    conflict = _extract_section(outline_text, r"核心冲突")
    if conflict:
        # 去掉引用块说明行
        conflict = re.sub(r"^>.*$", "", conflict, flags=re.MULTILINE).strip()
        if conflict:
            return conflict[:OUTLINE_SUMMARY_CHARS]
    # fallback：跳过 H1 + 引用块，取正文前 100 字
    lines = outline_text.splitlines()
    body_lines = [ln for ln in lines if not ln.startswith("# ") and not ln.startswith(">")]
    body = "\n".join(body_lines).strip()
    return body[:OUTLINE_SUMMARY_CHARS]


def _read_recent_outline_chain(
    vault: Path, chapter: int, volume: int, count: int = OUTLINE_CHAIN_DEFAULT
) -> list[tuple[int, str]]:
    """读取最近 N 章的纲级前情链，每章返回 (章号, ≤100字摘要)。"""
    out: list[tuple[int, str]] = []
    if chapter <= 1:
        return out
    start = max(1, chapter - count)
    for ch in range(chapter - 1, start - 1, -1):
        outline = _safe_read(_chapter_outline_path(vault, ch, volume))
        if not outline:
            continue
        summary = _summarize_outline(outline, ch)
        if summary:
            out.append((ch, summary))
    return out


def _match_setting_files(vault: Path, outline_text: str) -> list[tuple[str, str]]:
    """匹配当前场景涉及的设定文件。

    优先从章纲「## 十、上下文召回」段提取 01_世界观/ 或 02_角色/ 路径；
    若无，则按章纲关键词在两个目录下做简单匹配。最多返回 2 个 (相对路径, 文件内容)。
    """
    if not outline_text:
        return []
    candidates: list[str] = []
    recall = _extract_section(outline_text, r"上下文召回")
    if recall:
        # 提取反引号内的路径
        for m in re.finditer(r"`([^`]+\.md)`", recall):
            p = m.group(1)
            if p.startswith("01_世界观/") or p.startswith("02_角色/"):
                candidates.append(p)
    if not candidates:
        # fallback：关键词匹配——在章纲中扫描 01_世界观/02_角色 下文件名关键词
        keywords: list[str] = []
        for kw in ("主角", "反派", "配角", "core_rules", "geography", "factions", "items"):
            if kw in outline_text:
                keywords.append(kw)
        mapping = {
            "主角": "02_角色/protagonist.md",
            "core_rules": "01_世界观/core_rules.md",
            "geography": "01_世界观/geography.md",
            "factions": "01_世界观/factions.md",
            "items": "01_世界观/items_and_concepts.md",
        }
        for kw in keywords:
            if kw in mapping and mapping[kw] not in candidates:
                candidates.append(mapping[kw])
    # 限定 2 个
    candidates = candidates[:2]
    out: list[tuple[str, str]] = []
    for rel in candidates:
        full = vault / rel
        content = _safe_read(full)
        if content:
            # 单文件截断，避免撑爆预算
            if len(content) > SETTING_FILE_CHARS:
                content = content[:SETTING_FILE_CHARS] + "\n…(截断)"
            out.append((rel, content))
    return out


# ============================================================================
# Retrieved 层读取
# ============================================================================
def _parse_retrieve_scenes(focus_text: str) -> list[str]:
    """从 current_focus.md 的「## 五、retrieve_scenes」段解析场景文件名列表。"""
    if not focus_text:
        return []
    section = _extract_section(focus_text, r"retrieve_scenes")
    if not section:
        return []
    names: list[str] = []
    for m in re.finditer(r"`([^`]+\.md)`", section):
        name = m.group(1)
        # 只取 _scenes/ 下的文件名（不含路径）
        name = name.split("/")[-1]
        if name.startswith("ch_") or "scene" in name.lower():
            names.append(name)
    return names


def _extract_outline_characters(outline_text: str) -> list[str]:
    """从章纲「## 四、出场角色」表格提取角色名（第一列，跳过表头）。"""
    section = _extract_section(outline_text, r"出场角色")
    if not section:
        return []
    names: list[str] = []
    for line in section.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")]
        # 形如 ['', '角色', '身份', ..., '']，跳过表头与分隔行
        if len(cells) < 3:
            continue
        first = cells[1]
        if first in ("角色", "") or set(first) <= {"-", ":"}:
            continue
        names.append(first)
    return names


def _auto_search_scenes(vault: Path, outline_text: str) -> list[str]:
    """retrieve_scenes 为空且章节类型为 hook_resolve/climax 时，按角色名+关键词自动搜索 _scenes/。

    简单 grep 实现：扫描 _scenes/*.md 文件名，匹配角色名或章纲核心冲突关键词。
    """
    scenes_dir = vault / "_scenes"
    if not scenes_dir.exists():
        return []
    char_names = _extract_outline_characters(outline_text)
    conflict = _extract_section(outline_text, r"核心冲突")
    # 从冲突段抽 2-4 字关键词
    keywords = re.findall(r"[\u4e00-\u9fa5]{2,4}", conflict or "")
    keywords = [k for k in keywords if k not in ("本章", "主线", "张力", "一句话")][:8]

    scored: list[tuple[int, str]] = []
    for sf in sorted(scenes_dir.glob("*.md")):
        if sf.name.startswith("README"):
            continue
        fname = sf.name
        score = 0
        for cn in char_names:
            if cn and cn in fname:
                score += 3
        for kw in keywords:
            if kw in fname:
                score += 1
            else:
                # 内容匹配
                content = _safe_read(sf)
                if kw in content:
                    score += 1
        if score > 0:
            scored.append((score, fname))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [name for _, name in scored[:3]]


def _read_retrieved_scenes(
    vault: Path, focus_text: str, chapter_type: str, outline_text: str
) -> list[tuple[str, str]]:
    """读取 Retrieved 层关键场景：返回 (文件名, 全文) 列表。"""
    scene_names = _parse_retrieve_scenes(focus_text)
    if not scene_names and chapter_type in ("hook_resolve", "climax"):
        scene_names = _auto_search_scenes(vault, outline_text)
    out: list[tuple[str, str]] = []
    for name in scene_names:
        path = vault / "_scenes" / name
        content = _safe_read(path)
        if content:
            out.append((name, content))
    return out


# ============================================================================
# 章节类型 & 预算
# ============================================================================
def _detect_chapter_type(focus_text: str, outline_text: str) -> str:
    """从 current_focus.md 或章纲推断章节类型。模板/无法识别时默认 regular。

    current_focus.md 模板里行如「章节类型：regular / vol_start / hook_resolve / climax / transition」，
    这种含 `/` 的枚举串视为未填模板，跳过该源继续找下一个；章纲里行如「章节类型：vol_start」才是真值。
    """
    for text in (focus_text, outline_text):
        if not text:
            continue
        # 格式：**章节类型**：value（章节类型后跟 ** 闭合粗体，再跟冒号）
        m = re.search(r"章节类型\*{0,2}[：:]\s*(.+)", text)
        if not m:
            continue
        raw = m.group(1).strip()
        # 含 / 视为未填模板枚举串，跳过
        if "/" in raw or "／" in raw:
            continue
        value = raw.split()[0].lower() if raw.split() else ""
        if value in CHAPTER_TYPES:
            return value
    return "regular"


def _select_budget(vault: Path, chapter_type: str, override: Optional[int]) -> int:
    """选择 Token 预算：--budget 覆盖 > context_budget.json 配置 > 默认。"""
    if override is not None and override > 0:
        return override
    budget_file = vault / ".state" / "context_budget.json"
    data = _safe_read_json(budget_file)
    by_type = data.get("by_chapter_type", {}) if isinstance(data, dict) else {}
    if chapter_type in by_type and isinstance(by_type[chapter_type], int):
        return int(by_type[chapter_type])
    if isinstance(data, dict) and isinstance(data.get("default_budget"), int):
        return int(data["default_budget"])
    return DEFAULT_BUDGETS.get(chapter_type, DEFAULT_BUDGETS["regular"])


# ============================================================================
# 前情提要检查
# ============================================================================
def _check_recaps(vault: Path, chapter: int) -> list[str]:
    """检查 _recaps/ 下前情提要覆盖情况。

    - 当前章 == 11/21/31...（前 10 章刚写完）：提醒生成 recap_ch{N-10:03d}-{N-1:03d}.md
    - 当前章 > 10 且无任何 recap 覆盖最近一章：警告长程记忆漂移风险
    """
    warnings: list[str] = []
    recaps_dir = vault / "_recaps"
    existing: dict[tuple[int, int], Path] = {}
    if recaps_dir.exists():
        for f in recaps_dir.glob("recap_ch*.md"):
            m = re.match(r"recap_ch(\d+)-(\d+)\.md", f.name)
            if m:
                existing[(int(m.group(1)), int(m.group(2)))] = f

    # 规则 1：当前章是 11/21/31...，应生成覆盖刚写完 10 章的 recap
    if chapter > 1 and (chapter - 1) % 10 == 0:
        start = chapter - 10
        end = chapter - 1
        if (start, end) not in existing:
            warnings.append(
                f"提醒：当前章 ch_{chapter:03d}，应先生成前情提要 recap_ch{start:03d}-{end:03d}.md"
            )

    # 规则 2：当前章 > 10 且无 recap 覆盖 ch_{N-1}
    if chapter > 10:
        covered = any(s <= chapter - 1 <= e for (s, e) in existing.keys())
        if not covered:
            warnings.append(
                f"警告：前情提要缺失（无覆盖 ch_{chapter - 1:03d} 的 recap），长程记忆可能漂移"
            )

    return warnings


# ============================================================================
# 压缩策略
# ============================================================================
def _compress_selective(bundle: ContextBundle) -> None:
    """压缩 Selective 层：前情链从 5 章缩到 3 章；设定文件截断（已在读取时做）。"""
    acted = False
    for it in bundle.selective.items:
        if it.key == "前情链":
            # 找到前情链 item，截断到前 3 章
            lines = it.text.splitlines()
            # 每章一行 "- ch_NNN: ..."，保留前 3 行
            kept = lines[:OUTLINE_CHAIN_COMPRESSED]
            new_text = "\n".join(kept)
            if len(kept) < len(lines):
                it.text = new_text + f"\n…(原 {len(lines)} 章压缩至 {len(kept)} 章)"
                it.tokens = count_tokens(it.text)
                bundle.compressed_actions.append("前情链 5→3 章")
                acted = True
    return acted


def _compress_retrieved(bundle: ContextBundle) -> None:
    """压缩 Retrieved 层：关键场景从全文取摘要 300 字。"""
    for it in bundle.retrieved.items:
        if len(it.text) > SCENE_SUMMARY_CHARS:
            summary = it.text[:SCENE_SUMMARY_CHARS] + "\n…(场景摘要化，全文已截断)"
            it.text = summary
            it.tokens = count_tokens(it.text)
            bundle.compressed_actions.append(f"场景 {it.key} 摘要化")


# ============================================================================
# 主组装函数
# ============================================================================
def build_context(
    chapter: int,
    vault: Path | str = DEFAULT_VAULT,
    budget_override: Optional[int] = None,
    dry_run: bool = False,
) -> ContextBundle:
    """组装第 N 章的三层上下文。

    Args:
        chapter: 章号（整数，如 42）
        vault: Vault 根目录路径
        budget_override: 覆盖预算（>0 时生效）
        dry_run: 只报告不写文件

    Returns:
        ContextBundle：含三层内容、Token 明细、输出路径、recap 警告等
    """
    vault_path = Path(vault).resolve()
    volume = _find_volume_for_chapter(vault_path, chapter)

    # ---------- Protected 层 ----------
    outline_text = _read_chapter_outline(vault_path, chapter, volume)
    active_chars = _read_active_characters(vault_path, chapter)
    hooks = _read_unresolved_hooks(vault_path)
    focus_text = _read_current_focus(vault_path)
    intent_l0 = _read_author_intent_l0(vault_path)

    chapter_type = _detect_chapter_type(focus_text, outline_text)

    protected = LayerReport(name="Protected")
    protected.items.append(ContextItem(key="章纲", text=outline_text))
    chars_text = "\n\n".join(_format_character_brief(d) for _, d in active_chars) or "（无活跃角色）"
    protected.items.append(ContextItem(key="角色状态", text=chars_text, meta=f"{len(active_chars)} 角色"))
    protected.items.append(ContextItem(key="伏笔", text=_format_hooks(hooks), meta=f"{len(hooks)} 条"))
    protected.items.append(ContextItem(key="焦点", text=focus_text))
    protected.items.append(ContextItem(key="意图L0", text=intent_l0))

    # ---------- Selective 层 ----------
    prev_summary = _read_prev_chapter_summary(vault_path, chapter, volume)
    chain = _read_recent_outline_chain(vault_path, chapter, volume, OUTLINE_CHAIN_DEFAULT)
    chain_text = (
        "\n".join(f"- ch_{ch:03d}: {summary}" for ch, summary in chain)
        if chain
        else "（无前情链）"
    )
    setting_files = _match_setting_files(vault_path, outline_text)
    setting_text = (
        "\n\n".join(f"### {rel}\n{content}" for rel, content in setting_files)
        if setting_files
        else "（无设定文件召回）"
    )

    selective = LayerReport(name="Selective")
    selective.items.append(ContextItem(key="前1章摘要", text=prev_summary or "（无前章）"))
    selective.items.append(ContextItem(key="前情链", text=chain_text, meta=f"{len(chain)} 章"))
    selective.items.append(ContextItem(key="设定文件", text=setting_text, meta=f"{len(setting_files)} 文件"))

    # ---------- Retrieved 层 ----------
    scenes = _read_retrieved_scenes(vault_path, focus_text, chapter_type, outline_text)
    retrieved = LayerReport(name="Retrieved")
    for name, content in scenes:
        retrieved.items.append(ContextItem(key=name, text=content))

    # ---------- 预算 & 压缩 ----------
    budget = _select_budget(vault_path, chapter_type, budget_override)
    bundle = ContextBundle(
        chapter=chapter,
        chapter_type=chapter_type,
        budget=budget,
        protected=protected,
        selective=selective,
        retrieved=retrieved,
    )

    if bundle.total_tokens > budget:
        # Step 1: 压缩 Selective（前情链 5→3）
        _compress_selective(bundle)
        if bundle.total_tokens > budget:
            # Step 2: 压缩 Retrieved（场景摘要化）
            _compress_retrieved(bundle)
        if bundle.total_tokens > budget:
            # Step 3: Protected 不可压缩，报错
            bundle.error = (
                f"Token 超预算且 Protected 层不可压缩："
                f"实际 {bundle.total_tokens} > 预算 {budget}（Protected {protected.total_tokens} / "
                f"Selective {selective.total_tokens} / Retrieved {retrieved.total_tokens}）"
            )

    # ---------- 前情提要检查 ----------
    bundle.recap_warnings = _check_recaps(vault_path, chapter)

    # ---------- .gitignore 检查 ----------
    bundle.gitignore_excluded = _check_gitignore(vault_path)

    # ---------- 输出文件 ----------
    if not dry_run and not bundle.error:
        cache_dir = vault_path / ".state" / ".cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        out_path = cache_dir / f"context_ch{chapter:03d}_{ts}.md"
        out_path.write_text(_render_markdown(bundle), encoding="utf-8")
        bundle.output_path = out_path

    return bundle


# ============================================================================
# .gitignore 检查
# ============================================================================
def _check_gitignore(vault: Path) -> bool:
    """检查 .gitignore 是否排除 .cache/ 目录。未排除返回 False。"""
    patterns = [".cache", ".state/.cache", "**/.cache"]
    for gitignore in (vault / ".gitignore", vault.parent / ".gitignore", Path(".gitignore")):
        if not gitignore.exists():
            continue
        try:
            content = gitignore.read_text(encoding="utf-8")
        except Exception:
            continue
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            for pat in patterns:
                if pat in line:
                    return True
    return False


# ============================================================================
# 输出渲染
# ============================================================================
def _render_markdown(bundle: ContextBundle) -> str:
    """渲染上下文 Markdown 文件。"""
    lines: list[str] = []
    lines.append(f"# 上下文：ch_{bundle.chapter:03d}")
    lines.append("")
    lines.append(f"> 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"> 章节类型：{bundle.chapter_type}")
    lines.append(f"> Token 预算：{bundle.budget} / 实际：{bundle.total_tokens}（{bundle.utilization_pct}%）")
    if bundle.compressed_actions:
        lines.append(f"> 压缩动作：{', '.join(bundle.compressed_actions)}")
    lines.append("")

    # Protected
    lines.append("## [Protected] 当前章纲")
    lines.append("")
    lines.append(bundle.protected.items[0].text or "（章纲缺失）")
    lines.append("")
    lines.append("## [Protected] 活跃角色状态")
    lines.append("")
    lines.append(bundle.protected.items[1].text)
    lines.append("")
    lines.append("## [Protected] 未填伏笔")
    lines.append("")
    lines.append(bundle.protected.items[2].text)
    lines.append("")
    lines.append("## [Protected] 焦点")
    lines.append("")
    lines.append(bundle.protected.items[3].text or "（焦点缺失）")
    lines.append("")
    lines.append("## [Protected] 作者意图 L0")
    lines.append("")
    lines.append(bundle.protected.items[4].text or "（L0 缺失）")
    lines.append("")

    # Selective
    lines.append("## [Selective] 前 1 章摘要")
    lines.append("")
    lines.append(bundle.selective.items[0].text)
    lines.append("")
    chain_meta = bundle.selective.items[1].meta
    lines.append(f"## [Selective] 前情链（{chain_meta}）")
    lines.append("")
    lines.append(bundle.selective.items[1].text)
    lines.append("")
    lines.append("## [Selective] 设定文件")
    lines.append("")
    lines.append(bundle.selective.items[2].text)
    lines.append("")

    # Retrieved
    lines.append("## [Retrieved] 关键场景")
    lines.append("")
    if bundle.retrieved.items:
        for it in bundle.retrieved.items:
            lines.append(f"### {it.key}")
            lines.append("")
            lines.append(it.text)
            lines.append("")
    else:
        lines.append("（无关键场景召回）")
        lines.append("")

    return "\n".join(lines)


def _render_report_text(bundle: ContextBundle) -> str:
    """渲染控制台预算报告（文本格式）。"""
    lines: list[str] = []
    lines.append(f"=== 上下文预算报告 ch_{bundle.chapter:03d} ===")
    lines.append(f"章节类型: {bundle.chapter_type}")
    lines.append(f"总预算: {bundle.budget} tokens")
    util = bundle.utilization_pct
    lines.append(f"实际占用: {bundle.total_tokens} tokens ({util}%)")

    total = bundle.total_tokens or 1
    for layer in (bundle.protected, bundle.selective, bundle.retrieved):
        lt = layer.total_tokens
        share = round(lt / total * 100, 1)
        lines.append(f"  {layer.name}: {lt} tokens ({share}%)")
        for it in layer.items:
            extra = f" ({it.meta})" if it.meta else ""
            lines.append(f"    - {it.key}: {it.tokens}{extra}")

    if bundle.compressed_actions:
        lines.append(f"压缩动作: {', '.join(bundle.compressed_actions)}")
    if bundle.error:
        lines.append(f"错误: {bundle.error}")
    if bundle.recap_warnings:
        lines.append("前情提要:")
        for w in bundle.recap_warnings:
            lines.append(f"  - {w}")
    if not bundle.gitignore_excluded:
        lines.append("警告: .gitignore 未排除 .cache/，临时上下文可能被提交")

    if bundle.output_path:
        lines.append(f"输出: {bundle.output_path}")
    else:
        lines.append("输出: (dry-run 或出错，未写文件)")
    return "\n".join(lines)


def _render_report_json(bundle: ContextBundle) -> str:
    """渲染 JSON 格式预算报告。"""
    total = bundle.total_tokens or 1

    def _layer_dict(layer: LayerReport) -> dict:
        return {
            "tokens": layer.total_tokens,
            "share_pct": round(layer.total_tokens / total * 100, 1),
            "items": [
                {"key": it.key, "tokens": it.tokens, "meta": it.meta} for it in layer.items
            ],
        }

    obj = {
        "chapter": bundle.chapter,
        "chapter_type": bundle.chapter_type,
        "budget": bundle.budget,
        "total_tokens": bundle.total_tokens,
        "utilization_pct": bundle.utilization_pct,
        "layers": {
            "protected": _layer_dict(bundle.protected),
            "selective": _layer_dict(bundle.selective),
            "retrieved": _layer_dict(bundle.retrieved),
        },
        "compressed_actions": bundle.compressed_actions,
        "recap_warnings": bundle.recap_warnings,
        "gitignore_excluded": bundle.gitignore_excluded,
        "output_path": str(bundle.output_path) if bundle.output_path else None,
        "error": bundle.error,
    }
    return json.dumps(obj, ensure_ascii=False, indent=2)


# ============================================================================
# CLI
# ============================================================================
def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.novelforge.build_context",
        description="NovelForge 上下文编排：为正文生成精准组装 Prompt 上下文。",
    )
    parser.add_argument("--chapter", type=int, required=True, help="章号（整数，如 42）")
    parser.add_argument(
        "--vault",
        type=str,
        default=str(DEFAULT_VAULT),
        help=f"Vault 根目录（默认 {DEFAULT_VAULT}）",
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="JSON 输出（含预算明细）")
    parser.add_argument("--dry-run", action="store_true", help="只报告不写文件")
    parser.add_argument("--budget", type=int, default=None, help="覆盖 Token 预算")
    args = parser.parse_args(argv)

    if args.chapter < 1:
        print("错误：--chapter 必须 >= 1", file=sys.stderr)
        return 2

    bundle = build_context(
        chapter=args.chapter,
        vault=Path(args.vault),
        budget_override=args.budget,
        dry_run=args.dry_run,
    )

    if args.as_json:
        print(_render_report_json(bundle))
    else:
        print(_render_report_text(bundle))

    if bundle.error:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
