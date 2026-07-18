#!/usr/bin/env python3
"""批量降低 Markdown 文件中的行内引用密度。

规则：
1. 「——《XX》」紧跟在引号「」""后的（成语典故/人物原话）→ 保留
2. 同一出处在前 500 字内已出现 → 删除
3. 普通叙述句后的引用 → 优先删除
4. 删除后清理多余标点
5. 保留文末「参考来源」不动
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def count_chinese(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fff]", text))


def reduce_citations(filepath: str, target_per_1k: int = 3, dry_run: bool = False) -> tuple[int, int]:
    """降低单文件的行内引用密度。返回 (原引用数, 删除数)。"""
    content = Path(filepath).read_text(encoding="utf-8")

    # 分离正文和参考来源
    parts = re.split(r"(\n##?\s*参考来源)", content, maxsplit=1)
    body = parts[0]
    tail = "".join(parts[1:]) if len(parts) > 1 else ""

    # 找到所有行内引用
    pattern = re.compile(r"——《([^》]+)》")
    matches = list(pattern.finditer(body))
    total = len(matches)

    if total == 0:
        return 0, 0

    char_count = count_chinese(body)
    limit = max(1, int(char_count / 1000 * target_per_1k))  # 严格按每千字 target 处

    if total <= limit:
        return total, 0

    # 第一轮：标记哪些保留
    to_keep = [True] * total
    last_source_pos: dict[str, int] = {}

    for i, m in enumerate(matches):
        source = m.group(1)
        start = m.start()

        # 检查前面 5 个字符是否有引号
        before = body[max(0, start - 5): start]
        is_after_quote = any(q in before for q in ["」", '"', "』", "”"])

        # 检查前 500 字内是否有相同出处
        context_before = body[max(0, start - 500): start]
        same_nearby = source in context_before and source in last_source_pos

        if same_nearby and not is_after_quote:
            # 同源连续 + 非引号后 → 删除
            to_keep[i] = False
        elif same_nearby and is_after_quote:
            # 同源连续 + 引号后 → 保留但更新位置
            last_source_pos[source] = start
        else:
            last_source_pos[source] = start

    # 统计第一轮后保留数
    kept = sum(to_keep)
    if kept > limit:
        # 第二轮：从非引号后的引用中删除多余的
        for i in range(total):
            if not to_keep[i]:
                continue
            m = matches[i]
            before = body[max(0, m.start() - 5): m.start()]
            is_after_quote = any(q in before for q in ["」", '"', "』", "”"])
            if not is_after_quote:
                to_keep[i] = False
                kept -= 1
                if kept <= limit:
                    break

    if kept > limit:
        # 第三轮：强制只保留前 limit 个（优先保留引号后的）
        quote_indices = [i for i in range(total) if to_keep[i]]
        # 按"是否引号后"排序，引号后的优先保留
        def sort_key(i):
            m = matches[i]
            before = body[max(0, m.start() - 5): m.start()]
            is_quote = any(q in before for q in ["」", '"', "』", "”"])
            return (0 if is_quote else 1, i)

        sorted_indices = sorted(quote_indices, key=sort_key)
        to_keep = [False] * total
        for i in sorted_indices[:limit]:
            to_keep[i] = True

    # 执行删除（从后往前）
    new_body = body
    deleted = 0
    for i in range(total - 1, -1, -1):
        if not to_keep[i]:
            m = matches[i]
            # 删除「——《XX》」
            new_body = new_body[: m.start()] + new_body[m.end():]
            deleted += 1

    # 清理多余标点：连续句号、破折号后无内容等
    new_body = re.sub(r"。。+", "。", new_body)
    new_body = re.sub(r"\s+——\s*$", "", new_body, flags=re.MULTILINE)
    # 句末破折号后无内容 → 加句号
    new_body = re.sub(r"——\s*\n", "。\n", new_body)

    new_content = new_body + tail

    if not dry_run:
        Path(filepath).write_text(new_content, encoding="utf-8")

    return total, deleted


def main():
    if len(sys.argv) < 2:
        print("用法: python scripts/reduce_citations.py <文件或目录> [--dry-run]")
        sys.exit(1)

    target = Path(sys.argv[1])
    dry_run = "--dry-run" in sys.argv

    if target.is_file():
        files = [target]
    else:
        files = sorted(target.rglob("*.md"))

    total_deleted = 0
    for f in files:
        original, deleted = reduce_citations(str(f), dry_run=dry_run)
        if deleted > 0:
            status = "[DRY-RUN]" if dry_run else "[已优化]"
            print(f"{status} {f.name}: {original} → {original - deleted} 处（删除 {deleted}）")
            total_deleted += deleted

    print(f"\n共删除 {total_deleted} 处冗余引用")


if __name__ == "__main__":
    main()
