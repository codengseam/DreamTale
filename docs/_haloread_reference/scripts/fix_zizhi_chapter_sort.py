#!/usr/bin/env python3
"""批量修正资治通鉴各纪的 chapter_sort。

根因：生成/迁移过程中 chapter_sort 值混乱——有的按朝代阶段写（汉纪=3），
有的按绝对顺序写（周纪四=4、秦纪二=3），有的甚至缺失。结果 sort_notes_tree
优先使用 frontmatter 的 chapter_sort 后，大章节顺序完全错乱。

修正规则：对资治通鉴这类「阶段模式」书籍，chapter_sort 只表示朝代/纪的阶段
顺序；同一阶段内再按章节名中的中文序号排序。因此把所有「周纪」文件统一设为 1、
「秦纪」统一设为 2、「汉纪」统一设为 3……依 BOOK_CATEGORY_ORDER 配置。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.utils.sorting import BOOK_CATEGORY_ORDER

BOOK = "资治通鉴"
CHAPTER_SORT_RE = re.compile(r"^(chapter_sort:\s*).*$", re.MULTILINE)


def _stage_order_for(chapter: str) -> int | None:
    """根据 BOOK_CATEGORY_ORDER 返回章节所属阶段序号。"""
    categories = BOOK_CATEGORY_ORDER.get(BOOK)
    if not categories:
        return None
    for prefix in sorted(categories.keys(), key=len, reverse=True):
        if chapter.startswith(prefix):
            return categories[prefix]
    return None


def fix_zizhi_chapter_sort(output_dir: str = "output") -> tuple[int, int]:
    """遍历 output/资治通鉴 下所有 Markdown，修正 chapter_sort。

    返回 (已修正文件数, 已跳过文件数)。
    """
    book_dir = Path(output_dir) / BOOK
    if not book_dir.exists():
        raise FileNotFoundError(f"目录不存在: {book_dir}")

    fixed = 0
    skipped = 0

    for md_path in sorted(book_dir.rglob("*.md")):
        if md_path.name.startswith("_"):
            continue

        content = md_path.read_text(encoding="utf-8")
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", content, re.DOTALL)
        if not match:
            skipped += 1
            continue

        # 简单解析 frontmatter 取 chapter
        fm: dict[str, str | int] = {}
        for line in match.group(1).splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if value.isdigit():
                value = int(value)
            fm[key] = value

        chapter = str(fm.get("chapter", ""))
        if not chapter:
            skipped += 1
            continue

        expected = _stage_order_for(chapter)
        if expected is None:
            skipped += 1
            continue

        if CHAPTER_SORT_RE.search(content):
            new_content, count = CHAPTER_SORT_RE.subn(
                rf"\g<1>{expected}", content, count=1
            )
            if count:
                md_path.write_text(new_content, encoding="utf-8")
                fixed += 1
            else:
                skipped += 1
        else:
            # 没有 chapter_sort 行，在 frontmatter 内插入
            fm_text = match.group(1)
            new_fm_text = fm_text.rstrip() + f"\nchapter_sort: {expected}"
            new_content = content[: match.start(1)] + new_fm_text + content[match.end(1) :]
            md_path.write_text(new_content, encoding="utf-8")
            fixed += 1

    return fixed, skipped


if __name__ == "__main__":
    fixed, skipped = fix_zizhi_chapter_sort()
    print(f"已修正 {fixed} 个文件，跳过 {skipped} 个文件。")
