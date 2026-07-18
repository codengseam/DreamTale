#!/usr/bin/env python3
"""全面清理书籍章节标题中的「模块N」前缀。

处理范围：
- frontmatter 中的 chapter 字段
- 文件名中的「模块N」前缀

不改动：
- sort / chapter_sort 值
- 正文内容
- 其他 frontmatter 字段
"""

from __future__ import annotations

import re
from pathlib import Path

OUTPUT_DIR = Path("/workspace/output")
# 覆盖所有被发现含「模块N」前缀的书籍
BOOKS = ["饮食养生课", "饮食养生课第二版", "锻炼养生课", "AI大模型学习"]
FRONTMATTER_RE = re.compile(r"^(---\s*\n)(.*?)(\n---\s*\n?)", re.DOTALL)
MODULE_PREFIX_RE = re.compile(r"^模块\d+")


def parse_frontmatter(content: str) -> tuple[str, dict[str, str | int], str] | None:
    match = FRONTMATTER_RE.match(content)
    if not match:
        return None
    raw = match.group(2)
    data: dict[str, str | int] = {}
    current_key: str | None = None
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("- "):
            if current_key is not None:
                item = stripped[2:].strip().strip('"').strip("'")
                if not isinstance(data.get(current_key), list):
                    data[current_key] = []
                data[current_key].append(item)  # type: ignore[list-item]
            continue
        if ":" in stripped:
            key, _, value = stripped.partition(":")
            current_key = key.strip()
            raw_value = value.strip()
            if raw_value.isdigit():
                data[current_key] = int(raw_value)
            else:
                data[current_key] = raw_value.strip('"').strip("'")
    return raw, data, content[match.end():]


def rebuild_frontmatter(raw: str, data: dict[str, str | int]) -> str:
    lines = raw.splitlines()
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("chapter:"):
            key = line.split(":", 1)[0].strip()
            value = data[key]
            if isinstance(value, str) and any(c in value for c in [":", "#", "'", '"', "\n"]):
                escaped = value.replace('"', '\\"')
                new_lines.append(f'{key}: "{escaped}"')
            else:
                new_lines.append(f"{key}: {value}")
        else:
            new_lines.append(line)
    return "---\n" + "\n".join(new_lines) + "\n---\n"


def main() -> int:
    changed = 0
    for book in BOOKS:
        book_dir = OUTPUT_DIR / book
        if not book_dir.exists():
            print(f"跳过不存在的目录: {book_dir}")
            continue

        for md_path in sorted(book_dir.glob("*.md")):
            if md_path.name.startswith("_"):
                continue

            content = md_path.read_text(encoding="utf-8")
            parsed = parse_frontmatter(content)
            if parsed is None:
                continue

            raw, fm, body = parsed
            chapter = fm.get("chapter")
            if not isinstance(chapter, str):
                continue

            clean_chapter = MODULE_PREFIX_RE.sub("", chapter)
            if clean_chapter == chapter:
                continue

            # 同步更新 frontmatter
            fm["chapter"] = clean_chapter
            new_frontmatter = rebuild_frontmatter(raw, fm)

            # 同步重命名文件：模块N模块名_事件 -> 模块名_事件
            new_stem = MODULE_PREFIX_RE.sub("", md_path.stem)
            new_path = md_path.parent / f"{new_stem}.md"

            if new_path != md_path:
                if new_path.exists():
                    print(f"[WARNING] 目标文件已存在，跳过: {md_path.name} -> {new_path.name}")
                    continue
                new_path.write_text(new_frontmatter + body, encoding="utf-8")
                md_path.unlink()
            else:
                md_path.write_text(new_frontmatter + body, encoding="utf-8")

            print(f"[{book}] {md_path.name} -> {new_path.name} (chapter: {chapter} -> {clean_chapter})")
            changed += 1

    print(f"\n共处理 {changed} 个文件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
