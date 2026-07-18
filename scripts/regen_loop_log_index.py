#!/usr/bin/env python3
"""
自动生成 docs/loop_log.md 的索引区与教训计数表。

扫描 docs/loop_log/*.md 分片中的 H2 沉淀（支持 `## 标题（YYYY-MM-DD[, 副标题]）` 格式），
按日期倒序生成"最近 N 条"索引，统计 #lesson slug 出现次数生成计数表，
并为每个沉淀注入内容哈希稳定锚点 `<a id="loop-YYYYMMDD-<hash6>">`。

用法:
    python scripts/regen_loop_log_index.py
    python scripts/regen_loop_log_index.py --dry-run
"""

import argparse
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARD_DIR = ROOT / "docs" / "loop_log"
MAIN_FILE = ROOT / "docs" / "loop_log.md"
AUTOGEN_START = "<!-- AUTOGEN START: loop_log index -->"
AUTOGEN_END = "<!-- AUTOGEN END: loop_log index -->"

# 支持的 H2 日期格式：
# ## 标题（YYYY-MM-DD）
# ## 标题（YYYY-MM-DD, 副标题）
# ## YYYY-MM-DD 标题
H2_RE = re.compile(r"^##\s+(?P<heading>.+)$")
DATE_RE = re.compile(r"(?P<date>\d{4}-\d{2}-\d{2})")
ANCHOR_RE = re.compile(r'<a\s+id="(?P<anchor>loop-\d{8}-[a-f0-9]{6})"\s*></a>\s*')
LESSON_RE = re.compile(r"`#lesson:\s*([a-z_]+)`")

SLUG_TOPICS = {
    "git_hygiene": "推送/合并/冲突/分支治理/commit 覆盖",
    "reader_interaction": "阅读器/沉浸/翻页/吸底栏/SW 缓存",
    "content_quality": "质检规则/灵魂注入/标题评分",
    "book_structure": "排序/校验/命名/去重/双源同步",
    "deployment": "GitHub Pages/魔搭/.nojekyll/SW",
    "soul_injection": "灵魂注入/章回体/总编Agent",
    "ai_course": "专栏批量生成 / subagent 结果丢失",
}


def _extract_entries(shards):
    """从分片中提取沉淀条目列表。"""
    entries = []
    for shard_path in sorted(shards):
        shard_name = shard_path.name
        text = shard_path.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)

        for idx, line in enumerate(lines):
            m = H2_RE.match(line.rstrip())
            if not m:
                continue
            heading = m.group("heading").strip()
            dm = DATE_RE.search(heading)
            if not dm:
                continue
            date = dm.group("date")
            title = heading
            # 用标题+日期生成稳定哈希，避免同日多分支冲突
            digest = hashlib.sha256(f"{date}::{title}".encode("utf-8")).hexdigest()[:6]
            anchor = f"loop-{date.replace('-', '')}-{digest}"

            # 统计该沉淀的 lesson slug
            block_end = len(lines)
            for j in range(idx + 1, len(lines)):
                if lines[j].startswith("## "):
                    block_end = j
                    break
            block = "".join(lines[idx + 1 : block_end])
            slugs = set(LESSON_RE.findall(block))

            entries.append(
                {
                    "date": date,
                    "title": title,
                    "anchor": anchor,
                    "shard": shard_name,
                    "slugs": slugs,
                }
            )
    return entries


def _anchor_line(anchor):
    return f'<a id="{anchor}"></a>\n\n'


def _inject_anchors(shards, entries):
    """在分片中为每个 H2 前注入稳定锚点（跳过已注入的 H2）。"""
    modified = False
    entry_index = {(e["shard"], e["title"], e["date"]): e["anchor"] for e in entries}

    for shard_path in sorted(shards):
        text = shard_path.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)
        new_lines = []
        # 记录最近一个非空/非空白行的内容，用于判断 H2 前是否已有锚点
        last_non_blank = ""

        for line in lines:
            m = H2_RE.match(line.rstrip())
            need_anchor = False
            if m:
                heading = m.group("heading").strip()
                dm = DATE_RE.search(heading)
                if dm:
                    title = heading
                    date = dm.group("date")
                    anchor = entry_index.get((shard_path.name, title, date))
                    if anchor and not ANCHOR_RE.match(last_non_blank):
                        need_anchor = True
            if need_anchor:
                new_lines.append(_anchor_line(anchor))
                modified = True
                last_non_blank = _anchor_line(anchor).rstrip()
            new_lines.append(line)
            if line.strip():
                last_non_blank = line

        if modified:
            shard_path.write_text("".join(new_lines), encoding="utf-8")
    return modified


def _count_slugs(entries):
    counts = {slug: 0 for slug in SLUG_TOPICS}
    for e in entries:
        for slug in e["slugs"]:
            if slug in counts:
                counts[slug] += 1
    return counts


def _clean_title(heading, date):
    """去掉标题中的日期前缀或括号日期，避免索引中重复显示。"""
    title = heading
    # 去掉全角/半角括号包裹的日期及可选副标题
    bracket_re = re.compile(r"[（(]\s*" + re.escape(date) + r"\s*(?:,[^）)]*)?[）)]\s*$")
    title = bracket_re.sub("", title).strip()
    # 去掉行首的日期前缀（如 ## 2026-06-26 标题）
    prefix_re = re.compile(r"^" + re.escape(date) + r"\s*[-–—\s]\s*")
    title = prefix_re.sub("", title).strip()
    return title


def _generate_index(entries, counts):
    """生成索引区 Markdown 文本。"""
    sorted_entries = sorted(entries, key=lambda x: (x["date"], x["title"]), reverse=True)

    lines = [AUTOGEN_START + "\n", "\n"]
    lines.append("### 最近 20 条沉淀（按日期倒序）\n\n")
    for e in sorted_entries[:20]:
        display_title = _clean_title(e["title"], e["date"])
        lines.append(
            f"- [{e['date']} {display_title}](loop_log/{e['shard']}#{e['anchor']})\n"
        )
    lines.append("\n### 主题锚点\n\n")
    for slug, desc in SLUG_TOPICS.items():
        lines.append(f"- `#{slug}`：{desc}\n")

    lines.append('\n### 教训计数表（≥3 次且未入 checklist 即触发方案 C，见文件末"方案 C 手册"）\n\n')
    lines.append("| #lesson slug | 出现次数 | 说明 |\n")
    lines.append("|---|---|---|\n")
    for slug, desc in SLUG_TOPICS.items():
        lines.append(f"| `#{slug}`（{desc}） | {counts[slug]} | — |\n")

    lines.append(f"\n> 共 {len(entries)} 条沉淀，按月份分片存储于 `docs/loop_log/`。\n")
    lines.append("\n" + AUTOGEN_END + "\n")
    return "".join(lines)


def _replace_autogen(main_text, generated):
    start = main_text.find(AUTOGEN_START)
    end = main_text.find(AUTOGEN_END)
    if start == -1 or end == -1:
        raise RuntimeError(
            f"{MAIN_FILE} 中缺少 AUTOGEN 占位标记，请确认包含 "
            f"{AUTOGEN_START} 和 {AUTOGEN_END}。"
        )
    end += len(AUTOGEN_END)
    # 吃掉 suffix 开头多余的一个换行，保证生成内容与 footer 之间只有一行空距，且幂等
    suffix = main_text[end:]
    if suffix.startswith("\n"):
        suffix = suffix[1:]
    return main_text[:start] + generated + suffix


def run(dry_run: bool = False) -> int:
    """核心执行逻辑。返回 0 成功，1 失败。"""
    if not SHARD_DIR.exists():
        print(f"错误：分片目录不存在 {SHARD_DIR}", file=sys.stderr)
        return 1

    shards = [p for p in SHARD_DIR.iterdir() if p.suffix == ".md"]
    if not shards:
        print(f"错误：{SHARD_DIR} 下未找到 .md 分片", file=sys.stderr)
        return 1

    entries = _extract_entries(shards)

    if dry_run:
        print(f"发现 {len(entries)} 条沉淀，来自 {len(shards)} 个分片。")
        for e in sorted(entries, key=lambda x: (x["date"], x["title"]), reverse=True)[:5]:
            print(f"  {e['date']} {e['title']} → {e['anchor']} in {e['shard']}")
        counts = _count_slugs(entries)
        print("\n教训计数：")
        for slug, c in counts.items():
            if c:
                print(f"  #{slug}: {c}")
        return 0

    _inject_anchors(shards, entries)
    counts = _count_slugs(entries)
    generated = _generate_index(entries, counts)

    main_text = MAIN_FILE.read_text(encoding="utf-8")
    new_main = _replace_autogen(main_text, generated)
    MAIN_FILE.write_text(new_main, encoding="utf-8")

    print(f"已更新 {MAIN_FILE}：索引 {len(entries)} 条沉淀，{len(shards)} 个分片。")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Regenerate loop_log index.")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写文件")
    args = parser.parse_args()
    sys.exit(run(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
