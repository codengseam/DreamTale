#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CI 门禁：扫描 web/src/core/ 确保零 AI 关键词污染。

阶段1 铁律：Core 层零 AI 依赖。
执行：`python scripts/check_core_no_ai.py`
退出码 0 = 通过，1 = 发现 AI 关键词。

CI 集成：在 GitHub Actions 中作为强制门禁，失败即阻断 merge。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# 精确禁词清单（小写匹配）
# 注意：'model' / 'chat' 是高频词，仅在特定上下文匹配，避免误报
AI_KEYWORDS = [
    r"api[_-]?key",
    r"apikey",
    r"openai",
    r"anthropic",
    r"claude",
    r"gpt-\d",
    r"chat/completions",
    r"chat\.completions",
    r"Authorization:\s*Bearer",
    r"from\s+openai",
    r"import\s+openai",
    r"from\s+anthropic",
    r"import\s+anthropic",
    r"@anthropic-ai/sdk",
    r"langchain",
    r"langgraph",
    r"streamGenerate",
    r"generateStructured",
    r"BaseAIAdapter",
    r"AIClient",
    r"AIAdapter",
]

# 扫描范围
SCAN_DIRS = [
    "web/src/core",
    "web/src/storage",
]

# 扫描文件扩展名
SCAN_EXTS = {".ts", ".js", ".tsx", ".jsx", ".mjs", ".mts"}

# 白名单注释（命中以下注释行的，跳过）
ALLOWLIST_PATTERNS = [
    r"^\s*//\s*阶段2.*AI",
    r"^\s*//\s*占位.*阶段2",
    r"^\s*\*\s*阶段2",
]


def is_allowlist_line(line: str) -> bool:
    return any(re.search(p, line, re.IGNORECASE) for p in ALLOWLIST_PATTERNS)


def scan_file(path: Path) -> list[tuple[int, str, str]]:
    """返回 [(行号, 关键词, 行内容)] 列表，空列表表示无命中。"""
    hits = []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return hits
    for i, line in enumerate(text.splitlines(), 1):
        if is_allowlist_line(line):
            continue
        for kw in AI_KEYWORDS:
            if re.search(kw, line, re.IGNORECASE):
                hits.append((i, kw, line.strip()))
                break
    return hits


def main() -> int:
    workspace = Path(__file__).resolve().parent.parent
    total_hits = 0
    scanned = 0

    for rel in SCAN_DIRS:
        scan_dir = workspace / rel
        if not scan_dir.exists():
            print(f"⚠️  目录不存在，跳过：{rel}")
            continue
        for f in scan_dir.rglob("*"):
            if f.suffix not in SCAN_EXTS:
                continue
            scanned += 1
            hits = scan_file(f)
            if hits:
                total_hits += len(hits)
                rel_path = f.relative_to(workspace)
                print(f"\n❌ {rel_path}")
                for line_no, kw, line in hits:
                    print(f"   L{line_no} [{kw}]: {line}")

    print(f"\n扫描完成：{scanned} 个文件，{total_hits} 处 AI 关键词命中")
    if total_hits > 0:
        print("🚫 Core 层 AI 隔离门禁失败！请移除上述 AI 相关代码。")
        print("   阶段1 铁律：web/src/core/ 与 web/src/storage/ 必须零 AI 依赖。")
        return 1
    print("✅ Core 层 AI 隔离门禁通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
