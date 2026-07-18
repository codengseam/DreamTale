#!/usr/bin/env python3
"""批量修复考公全周期备考专栏的 sort 字段。

规则（参考系统架构师备考专栏）：
- book 内每个 chapter（公考实战XX）只有一个 event（单事件章节）
- sort = event 内排序，单事件时必须为 1
- chapter_sort = chapter 在 book 内的排序，全书连续 1..50

当前问题：subagent 误把 sort 写成 1..50 连续值，导致 P2 报错。
修复：把所有文件的 sort 改为 1，chapter_sort 保持不变（1..50）。
"""
from __future__ import annotations

import re
from pathlib import Path

BOOK_DIR = Path("output/考公全周期备考")


def fix_sort_in_file(path: Path) -> bool:
    """把 frontmatter 里的 sort 字段改为 1。返回是否修改。"""
    text = path.read_text(encoding="utf-8")
    # 匹配 frontmatter 块
    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.DOTALL)
    if not fm_match:
        return False
    fm_raw = fm_match.group(1)
    # 替换 sort: N 为 sort: 1（只替换 sort 字段，不动 chapter_sort）
    new_fm = re.sub(r"^sort:\s*\d+\s*$", "sort: 1", fm_raw, flags=re.MULTILINE)
    if new_fm == fm_raw:
        return False
    new_text = text[: fm_match.start(1)] + new_fm + text[fm_match.end(1) :]
    path.write_text(new_text, encoding="utf-8")
    return True


def main() -> int:
    fixed = 0
    skipped = 0
    for md in sorted(BOOK_DIR.glob("公考实战*.md")):
        if fix_sort_in_file(md):
            fixed += 1
            print(f"[fixed] {md.name}")
        else:
            skipped += 1
            print(f"[skip]  {md.name}")
    print(f"\n总计：修复 {fixed} 个，跳过 {skipped} 个")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
