#!/usr/bin/env python3
"""批量回填历史 output 的 references frontmatter 字段（反馈循环第二档）。

遍历 output/ 下所有 *.md，从文末「## 参考来源」段抽取结构化文献，
注入 frontmatter 的 references 字段。

用法：
    python scripts/extract_references.py                      # 跑全部（dry-run）
    python scripts/extract_references.py --apply              # 实际写入
    python scripts/extract_references.py --book 史记 --apply   # 仅跑史记
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

_WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
if str(_WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKSPACE_ROOT))

from src.utils.sources import (  # noqa: E402
    build_references_frontmatter,
    extract_references_structured,
)

_FRONTMATTER_RE = re.compile(r"^(---\n)(.*?)(\n---\n)", re.DOTALL)


def _inject_references(content: str, references_text: str) -> tuple[str, bool]:
    """把 references 字段注入 frontmatter（幂等）。

    Returns:
        (new_content, changed)
    """
    if not references_text:
        return content, False
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return content, False
    fm_body = m.group(2)
    # 幂等：已存在 references: 字段则跳过
    if re.search(r"^references:", fm_body, re.MULTILINE):
        return content, False
    new_fm = fm_body.rstrip("\n") + "\n" + references_text + "\n"
    new_content = content[: m.start(2)] + new_fm + content[m.end(2):]
    return new_content, True


def process_file(md_path: Path, apply: bool) -> dict:
    """处理单个 .md 文件，返回统计。"""
    try:
        content = md_path.read_text(encoding="utf-8")
    except OSError as exc:
        return {"file": str(md_path), "error": str(exc)}

    refs = extract_references_structured(content)
    if not refs:
        return {"file": str(md_path), "refs": 0, "skipped": "no_refs"}

    refs_text = build_references_frontmatter(refs)
    new_content, changed = _inject_references(content, refs_text)

    if not changed:
        return {"file": str(md_path), "refs": len(refs), "skipped": "already_has"}

    if apply:
        md_path.write_text(new_content, encoding="utf-8")

    return {
        "file": str(md_path),
        "refs": len(refs),
        "changed": changed,
        "applied": apply,
    }


def main():
    parser = argparse.ArgumentParser(description="批量回填 references frontmatter")
    parser.add_argument("--output", default="output", help="output 目录路径")
    parser.add_argument("--book", default=None, help="仅处理指定书")
    parser.add_argument("--apply", action="store_true", help="实际写入（默认 dry-run）")
    args = parser.parse_args()

    output_dir = Path(args.output)
    if not output_dir.exists():
        print(f"错误：{output_dir} 不存在", file=sys.stderr)
        sys.exit(1)

    if args.book:
        book_dirs = [output_dir / args.book]
        if not book_dirs[0].exists():
            print(f"错误：{book_dirs[0]} 不存在", file=sys.stderr)
            sys.exit(1)
    else:
        book_dirs = [d for d in output_dir.iterdir() if d.is_dir()]

    total_files = 0
    total_refs = 0
    total_changed = 0
    for book_dir in sorted(book_dirs):
        for md_path in sorted(book_dir.glob("*.md")):
            result = process_file(md_path, args.apply)
            total_files += 1
            if result.get("refs", 0) > 0:
                total_refs += result["refs"]
            if result.get("changed"):
                total_changed += 1
                status = "已写入" if args.apply else "待写入(dry-run)"
                print(f"[{status}] {result['file']} ({result['refs']} 条)")

    mode = "应用" if args.apply else "预演(dry-run)"
    print(f"\n{mode}完成：处理 {total_files} 篇，提取 {total_refs} 条文献，"
          f"变更 {total_changed} 篇")


if __name__ == "__main__":
    main()
