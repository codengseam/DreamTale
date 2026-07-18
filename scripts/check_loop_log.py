#!/usr/bin/env python3
"""HaloRead loop_log 结构校验脚本。

校验项：
- [核心 P1] 1. 日期倒序：所有分片中的 H2 沉淀按日期倒序排列
- [核心 P1] 2. #lesson slug 合法：每条记录底部 #lesson 标签必须来自受控 slug 表
- [核心 P1] 3. 分片 H2 前必须存在稳定锚点，且锚点全局唯一
- [P3 提示] 4. 索引区链接可解析：主文件索引中的跨文件链接能命中对应分片的锚点
- [P3 提示] 5. #lesson 计数告警：同一 slug 出现 ≥3 次且未标"已入checklist: yes"时告警
- [P3 提示] 6. 化石区已迁出：loop_log 中不应出现"## 一、测评框架"等化石标题

退出码：
- 0：核心校验全部通过（P3 告警不阻断）
- 1：核心校验失败
- --strict 模式下 P3 告警也阻断

用法：
    python scripts/check_loop_log.py
    python scripts/check_loop_log.py --strict
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

# 受控 slug 主题表（与 docs/loop_log.md 文件末"slug 主题表"一致）
CONTROLLED_SLUGS = {
    "git_hygiene",
    "reader_interaction",
    "content_quality",
    "book_structure",
    "deployment",
    "soul_injection",
    "ai_course",
}

# 化石标题正则（应已迁出到 docs/archive/loop_log_fossils.md）
FOSSIL_TITLE_PATTERNS = [
    re.compile(r"^## 一、测评框架", re.MULTILINE),
    re.compile(r"^## 二、循环记录", re.MULTILINE),
    re.compile(r"^## 三、开发沉淀记录", re.MULTILINE),
    re.compile(r"^### 第[一二三四五六七八九十百\d]+章", re.MULTILINE),
    re.compile(r"^### 第\d+章", re.MULTILINE),
]

DATE_RE = re.compile(r"(?P<date>\d{4}-\d{2}-\d{2})")
H2_RE = re.compile(r"^##\s+(?P<heading>.+)$", re.MULTILINE)
LESSON_TAG_RE = re.compile(r"#lesson:\s*(\w+)")
ANCHOR_RE = re.compile(r'<a\s+id="(?P<anchor>loop-\d{8}-[a-f0-9]{6})"\s*></a>')
INDEX_LINK_RE = re.compile(
    r"\]\(loop_log/(?P<shard>[\w\-.]+)\.(?P<ext>md)#(?P<anchor>loop-\d{8}-[a-f0-9]{6})\)"
)
CHECKLIST_MARKER_RE = re.compile(r"^已入checklist:\s*yes\s*$", re.MULTILINE | re.IGNORECASE)

ROOT = Path(__file__).resolve().parent.parent
SHARD_DIR = ROOT / "docs" / "loop_log"
MAIN_FILE = ROOT / "docs" / "loop_log.md"


def _load(path: Path) -> str:
    if not path.exists():
        print(f"[P1] 文件不存在: {path}", file=sys.stderr)
        return ""
    return path.read_text(encoding="utf-8")


def _extract_entries(shards: list[Path]) -> list[dict]:
    """从所有分片中提取沉淀条目。"""
    entries = []
    for shard_path in sorted(shards):
        text = shard_path.read_text(encoding="utf-8")
        for m in H2_RE.finditer(text):
            heading = m.group("heading").strip()
            dm = DATE_RE.search(heading)
            if not dm:
                continue
            entries.append(
                {
                    "date": dm.group("date"),
                    "heading": heading,
                    "shard": shard_path.name,
                    "shard_path": shard_path,
                    "h2_start": m.start(),
                }
            )
    return entries


def _collect_anchors(entries: list[dict], shards: list[Path]) -> dict[str, list[tuple[str, str]]]:
    """收集每个沉淀前是否有稳定锚点。返回 anchor -> [(shard, heading), ...]。"""
    anchors: dict[str, list[tuple[str, str]]] = {}
    shard_texts = {p.name: p.read_text(encoding="utf-8") for p in shards}

    for e in entries:
        text = shard_texts[e["shard"]]
        prefix = text[: e["h2_start"]]
        # 找到 H2 之前最后一个锚点（跳过末尾空白）
        found = None
        for am in ANCHOR_RE.finditer(prefix):
            found = am
        if found and prefix[found.end() :].strip() == "":
            anchor = found.group("anchor")
            anchors.setdefault(anchor, []).append((e["shard"], e["heading"]))
    return anchors


def check_date_descending(entries: list[dict]) -> list[str]:
    """核心 P1：所有 H2 沉淀按阅读顺序（分片文件名降序 + 分片内行号升序）日期倒序排列。

    阅读顺序定义：最新月份分片在前（如 2026-07.md 早于 2026-06.md），
    同分片内按 H2 出现顺序（h2_start 升序，即文件从上到下）。
    该顺序下日期必须严格倒序（新→旧），否则报 P1。
    """
    errors = []
    if not entries:
        return errors

    # 按阅读顺序排序：分片文件名降序（最新月份在前），同分片内按 h2_start 升序
    # 利用 Python 稳定排序：先按 h2_start 升序，再按 shard 降序
    ordered = sorted(entries, key=lambda x: x["h2_start"])
    ordered = sorted(ordered, key=lambda x: x["shard"], reverse=True)
    prev = ordered[0]
    for cur in ordered[1:]:
        if cur["date"] > prev["date"]:
            errors.append(
                f"[P1] 日期非倒序：{cur['shard']} '{cur['heading'][:40]}' "
                f"({cur['date']}) 晚于前一条 {prev['shard']} '{prev['heading'][:40]}' ({prev['date']})"
            )
        prev = cur
    return errors


def check_lesson_slug_legal(entries: list[dict], shards: list[Path]) -> list[str]:
    """核心 P1：所有 #lesson slug 必须来自受控表。"""
    errors = []
    shard_texts = {p.name: p.read_text(encoding="utf-8") for p in shards}
    for e in entries:
        text = shard_texts[e["shard"]]
        block_end = len(text)
        next_h2 = H2_RE.search(text, e["h2_start"] + 1)
        if next_h2:
            block_end = next_h2.start()
        block = text[e["h2_start"] : block_end]
        for m in LESSON_TAG_RE.finditer(block):
            slug = m.group(1)
            if slug not in CONTROLLED_SLUGS:
                errors.append(
                    f"[P1] 非法 #lesson slug '{slug}' in {e['shard']} "
                    f"'{e['heading'][:40]}'，必须来自受控表："
                    + ", ".join(sorted(CONTROLLED_SLUGS))
                )
    return errors


def check_anchors(entries: list[dict], shards: list[Path]) -> list[str]:
    """核心 P1：每个 H2 前必须存在稳定锚点，且锚点全局唯一。"""
    errors = []
    anchors = _collect_anchors(entries, shards)
    covered = set(anchors.keys())

    for e in entries:
        expected_anchor = None
        # 根据标题内容重新计算期望锚点（与 regen 脚本一致）
        from hashlib import sha256

        digest = sha256(f"{e['date']}::{e['heading']}".encode("utf-8")).hexdigest()[:6]
        expected_anchor = f"loop-{e['date'].replace('-', '')}-{digest}"
        if expected_anchor not in covered:
            errors.append(
                f"[P1] 沉淀缺少稳定锚点：{e['shard']} '{e['heading'][:40]}'，"
                f"期望 <a id=\"{expected_anchor}\"></a>"
            )

    for anchor, locations in anchors.items():
        if len(locations) > 1:
            locs = ", ".join(f"{s}: '{h[:30]}'" for s, h in locations)
            errors.append(f"[P1] 锚点 '{anchor}' 重复出现：{locs}")

    return errors


def check_index_links(main_text: str, entries: list[dict]) -> list[str]:
    """P3：主文件索引区链接能命中分片中的锚点。"""
    warnings = []
    anchor_set = set()
    for e in entries:
        from hashlib import sha256

        digest = sha256(f"{e['date']}::{e['heading']}".encode("utf-8")).hexdigest()[:6]
        anchor_set.add(f"loop-{e['date'].replace('-', '')}-{digest}")

    for m in INDEX_LINK_RE.finditer(main_text):
        shard = f"{m.group('shard')}.{m.group('ext')}"
        anchor = m.group("anchor")
        shard_path = SHARD_DIR / shard
        if not shard_path.exists():
            warnings.append(f"[P3] 索引指向不存在的分片：{shard}")
            continue
        if anchor not in anchor_set:
            warnings.append(f"[P3] 索引指向缺失的锚点：{shard}#{anchor}")
    return warnings


def _checklist_marker_for_slug(text: str, slug: str) -> bool:
    """检查某 slug 所在沉淀块内是否声明了'已入checklist: yes'。"""
    # 按 H2 切分后，对每个块检查是否同时包含该 slug 和 checklist 标记
    blocks = re.split(r"\n## ", text)
    for block in blocks:
        if f"`#lesson: {slug}`" in block and CHECKLIST_MARKER_RE.search(block):
            return True
    return False


def check_lesson_count_warning(entries: list[dict], shards: list[Path], main_text: str) -> list[str]:
    """P3：同一 slug 出现 ≥3 次且未在任一分片声明'已入checklist: yes'时告警。"""
    warnings = []
    shard_texts = {p.name: p.read_text(encoding="utf-8") for p in shards}
    all_shard_text = "\n".join(shard_texts.values())
    slug_counter = Counter(LESSON_TAG_RE.findall(all_shard_text))

    for slug, count in slug_counter.items():
        if count >= 3 and not _checklist_marker_for_slug(all_shard_text, slug):
            warnings.append(
                f"[P3] #lesson slug '{slug}' 出现 {count} 次（≥3），"
                f"但未在任一分片中声明'已入checklist: yes'，建议触发方案 C"
            )
    return warnings


def check_fossil_migrated(main_text: str, shards: list[Path]) -> list[str]:
    """P3：loop_log 中不应出现化石标题。"""
    warnings = []
    texts = [main_text] + [p.read_text(encoding="utf-8") for p in shards]
    for text in texts:
        for pattern in FOSSIL_TITLE_PATTERNS:
            for m in pattern.finditer(text):
                warnings.append(
                    f"[P3] 发现化石标题未迁出：'{m.group(0)}'，"
                    f"应移到 docs/archive/loop_log_fossils.md"
                )
    return warnings


def check_counts_match(main_text: str, entries: list[dict], shards: list[Path]) -> list[str]:
    """P3：主文件计数表数字与分片实际统计一致。"""
    warnings = []
    shard_texts = {p.name: p.read_text(encoding="utf-8") for p in shards}
    all_text = "\n".join(shard_texts.values())
    actual_counts = Counter(LESSON_TAG_RE.findall(all_text))

    # 解析主文件表格中的数字（容忍多种格式）
    table_re = re.compile(
        r"\|\s*`#(\w+)`[^|]*\|\s*(\d+)\s*\|"
    )
    declared = {slug: int(count) for slug, count in table_re.findall(main_text)}

    for slug in CONTROLLED_SLUGS:
        actual = actual_counts.get(slug, 0)
        declared_count = declared.get(slug)
        if declared_count is not None and declared_count != actual:
            warnings.append(
                f"[P3] 教训计数表 #{slug} 显示 {declared_count} 次，"
                f"实际分片统计 {actual} 次，请运行 regen_loop_log_index.py 重生成"
            )
    return warnings


def run(strict: bool = False) -> int:
    if not SHARD_DIR.exists():
        print(f"[P1] 分片目录不存在: {SHARD_DIR}", file=sys.stderr)
        return 1

    shards = [p for p in SHARD_DIR.iterdir() if p.suffix == ".md"]
    if not shards:
        print(f"[P1] 分片目录下无 .md 文件: {SHARD_DIR}", file=sys.stderr)
        return 1

    main_text = _load(MAIN_FILE)
    if not main_text:
        return 1

    entries = _extract_entries(shards)
    if not entries:
        print("[P1] 未在任何分片中找到带日期的 H2 沉淀", file=sys.stderr)
        return 1

    core_errors = []
    p3_warnings = []

    core_errors.extend(check_date_descending(entries))
    core_errors.extend(check_lesson_slug_legal(entries, shards))
    core_errors.extend(check_anchors(entries, shards))
    p3_warnings.extend(check_index_links(main_text, entries))
    p3_warnings.extend(check_lesson_count_warning(entries, shards, main_text))
    p3_warnings.extend(check_fossil_migrated(main_text, shards))
    p3_warnings.extend(check_counts_match(main_text, entries, shards))

    print(f"=== loop_log 结构校验 ({len(entries)} 条沉淀, {len(shards)} 个分片) ===")
    print(f"核心校验（P1）：{len(core_errors)} 项失败")
    for e in core_errors:
        print(f"  ❌ {e}")
    print(f"P3 提示：{len(p3_warnings)} 项")
    for w in p3_warnings:
        print(f"  ⚠️  {w}")

    if core_errors:
        print("\n结果：❌ 核心校验失败")
        return 1
    if strict and p3_warnings:
        print("\n结果：❌ --strict 模式下 P3 告警也阻断")
        return 1
    print("\n结果：✅ 核心校验通过" + ("（P3 告警不阻断）" if p3_warnings else ""))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="HaloRead loop_log 结构校验")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="P3 告警也阻断退出码",
    )
    args = parser.parse_args()
    return run(strict=args.strict)


if __name__ == "__main__":
    sys.exit(main())
