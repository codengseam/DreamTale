"""scripts/check_loop_log.py 的单元测试（适配分片结构）。

覆盖 7 个用例：
1. 合法分片结构通过
2. 日期非倒序失败
3. 非法 #lesson slug 失败
4. 沉淀缺少稳定锚点失败
5. 锚点重复失败
6. 化石标题未迁出（strict 阻断）
7. #lesson 计数告警与 strict 阻断
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def _anchor(date: str, heading: str) -> str:
    from hashlib import sha256

    digest = sha256(f"{date}::{heading}".encode("utf-8")).hexdigest()[:6]
    return f"loop-{date.replace('-', '')}-{digest}"


from scripts.check_loop_log import (  # noqa: E402
    check_anchors,
    check_date_descending,
    check_fossil_migrated,
    check_index_links,
    check_lesson_count_warning,
    check_lesson_slug_legal,
    run,
)


def _setup(tmp_path: Path, main_content: str, shard_contents: dict[str, str]) -> Path:
    """在临时目录构造 docs/loop_log.md + docs/loop_log/*.md。

    fixture 已提前创建目录，此处仅写文件。
    """
    docs_dir = tmp_path / "docs"
    shard_dir = docs_dir / "loop_log"

    main_file = docs_dir / "loop_log.md"
    main_file.write_text(main_content, encoding="utf-8")

    for name, content in shard_contents.items():
        (shard_dir / name).write_text(content, encoding="utf-8")

    return docs_dir


@pytest.fixture(autouse=True)
def _patch_paths(monkeypatch, tmp_path):
    """每个测试运行时把 SHARD_DIR / MAIN_FILE 指向临时目录。"""
    from scripts import check_loop_log

    docs_dir = tmp_path / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    shard_dir = docs_dir / "loop_log"
    shard_dir.mkdir(exist_ok=True)

    monkeypatch.setattr(check_loop_log, "SHARD_DIR", shard_dir)
    monkeypatch.setattr(check_loop_log, "MAIN_FILE", docs_dir / "loop_log.md")


def _make_main(*links: str) -> str:
    body = "\n".join(f"- {link}" for link in links)
    return f"""# LoopAgent 循环日志

## 索引区

<!-- AUTOGEN START: loop_log index -->
{body}
<!-- AUTOGEN END: loop_log index -->

---

## 方案 C 手册
"""


# ---------- 1. 合法分片结构通过 ----------


def test_valid_shard_structure_passes(tmp_path):
    """构造合法分片结构，run() 返回 0。"""
    h = "2026-06-26 示例 A"
    a = _anchor("2026-06-26", h)
    shard = f"""<a id="{a}"></a>

## {h}

正文 A。

**教训标签**：`#lesson: git_hygiene`
"""
    _setup(
        tmp_path,
        _make_main(f"[2026-06-26 示例 A](loop_log/2026-06.md#{a})"),
        {"2026-06.md": shard},
    )
    assert run(strict=False) == 0


# ---------- 2. 日期非倒序失败 ----------


def test_date_not_descending_fails(tmp_path):
    """跨分片日期乱序应导致核心校验失败。"""
    h1, h2 = "2026-06-25 早的在上", "2026-06-26 晚的在下"
    a1, a2 = _anchor("2026-06-25", h1), _anchor("2026-06-26", h2)
    shard = f"""<a id="{a1}"></a>

## {h1}

正文。

**教训标签**：`#lesson: git_hygiene`

<a id="{a2}"></a>

## {h2}

正文。

**教训标签**：`#lesson: git_hygiene`
"""
    _setup(
        tmp_path,
        _make_main(
            f"[2026-06-26 晚的在下](loop_log/2026-06.md#{a2})",
            f"[2026-06-25 早的在上](loop_log/2026-06.md#{a1})",
        ),
        {"2026-06.md": shard},
    )
    assert run(strict=False) == 1


def test_date_descending_across_shards_passes(tmp_path):
    """跨分片正常情况（新月份分片日期晚于旧月份分片）应通过核心校验。

    阅读顺序为分片文件名降序（2026-07.md 在前，2026-06.md 在后），
    因此 07-01 → 06-25 是合法倒序，不应报 P1。
    """
    h1, h2 = "2026-06-25 六月沉淀", "2026-07-01 七月沉淀"
    a1, a2 = _anchor("2026-06-25", h1), _anchor("2026-07-01", h2)
    _setup(
        tmp_path,
        _make_main(),
        {
            "2026-06.md": f"""<a id="{a1}"></a>

## {h1}

正文。

**教训标签**：`#lesson: git_hygiene`
""",
            "2026-07.md": f"""<a id="{a2}"></a>

## {h2}

正文。

**教训标签**：`#lesson: git_hygiene`
""",
        },
    )
    assert run(strict=False) == 0


def test_date_not_descending_across_shards_fails(tmp_path):
    """真正的跨分片乱序：旧月份分片里混入了比新月份分片更新的日期，应报 P1。"""
    h1, h2 = "2026-07-01 七月沉淀", "2026-07-05 误入六月的七月日期"
    a1, a2 = _anchor("2026-07-01", h1), _anchor("2026-07-05", h2)
    _setup(
        tmp_path,
        _make_main(),
        {
            "2026-07.md": f"""<a id="{a1}"></a>

## {h1}

正文。

**教训标签**：`#lesson: git_hygiene`
""",
            "2026-06.md": f"""<a id="{a2}"></a>

## {h2}

正文。

**教训标签**：`#lesson: git_hygiene`
""",
        },
    )
    assert run(strict=False) == 1


# ---------- 3. 非法 #lesson slug 失败 ----------


def test_invalid_lesson_slug_fails(tmp_path):
    """非法 slug 应触发 P1 失败。"""
    h = "2026-06-26 示例"
    a = _anchor("2026-06-26", h)
    shard = f"""<a id="{a}"></a>

## {h}

正文。

**教训标签**：`#lesson: random_text`
"""
    _setup(tmp_path, _make_main(), {"2026-06.md": shard})
    assert run(strict=False) == 1


# ---------- 4. 沉淀缺少稳定锚点失败 ----------


def test_missing_anchor_fails(tmp_path):
    """H2 前缺少稳定锚点应触发 P1 失败。"""
    shard = """## 2026-06-26 示例

正文。

**教训标签**：`#lesson: git_hygiene`
"""
    _setup(tmp_path, _make_main(), {"2026-06.md": shard})
    assert run(strict=False) == 1


# ---------- 5. 锚点重复失败 ----------


def test_duplicate_anchor_fails(tmp_path):
    """同一锚点出现在两个 H2 前应触发 P1 失败。"""
    a = "loop-20260626-000000"
    shard = f"""<a id="{a}"></a>

## 2026-06-26 示例 A

正文。

**教训标签**：`#lesson: git_hygiene`

<a id="{a}"></a>

## 2026-06-26 示例 B

正文。

**教训标签**：`#lesson: book_structure`
"""
    _setup(tmp_path, _make_main(), {"2026-06.md": shard})
    assert run(strict=False) == 1


# ---------- 6. 化石标题未迁出（strict 阻断） ----------


def test_fossil_section_not_migrated_fails(tmp_path):
    """分片中若残留化石标题，--strict 应阻断。"""
    h = "2026-06-26 示例"
    a = _anchor("2026-06-26", h)
    shard = f"""## 一、测评框架

(化石内容)

<a id="{a}"></a>

## {h}

正文。

**教训标签**：`#lesson: git_hygiene`
"""
    _setup(tmp_path, _make_main(), {"2026-06.md": shard})
    assert run(strict=False) == 0
    assert run(strict=True) == 1


# ---------- 7. #lesson 计数告警与 strict 阻断 ----------


def test_lesson_count_warning_and_strict(tmp_path):
    """同一 slug 出现 ≥3 次且未声明'已入checklist: yes'应 P3 告警，strict 阻断。"""
    h1, h2, h3 = "2026-06-26 A", "2026-06-25 B", "2026-06-24 C"
    a1, a2, a3 = _anchor("2026-06-26", h1), _anchor("2026-06-25", h2), _anchor("2026-06-24", h3)
    shard = f"""<a id="{a1}"></a>

## {h1}

正文。

**教训标签**：`#lesson: book_structure`

<a id="{a2}"></a>

## {h2}

正文。

**教训标签**：`#lesson: book_structure`

<a id="{a3}"></a>

## {h3}

正文。

**教训标签**：`#lesson: book_structure`
"""
    _setup(tmp_path, _make_main(), {"2026-06.md": shard})
    assert run(strict=False) == 0
    assert run(strict=True) == 1


# ---------- 补充：索引链接校验 ----------


def test_index_link_to_missing_anchor_warns(tmp_path):
    """索引指向不存在的锚点应触发 P3 告警。"""
    h = "2026-06-26 示例"
    a = _anchor("2026-06-26", h)
    shard = f"""<a id="{a}"></a>

## {h}

正文。

**教训标签**：`#lesson: git_hygiene`
"""
    _setup(
        tmp_path,
        _make_main("[2026-06-26 示例](loop_log/2026-06.md#loop-20260626-ffffff)"),
        {"2026-06.md": shard},
    )
    assert run(strict=False) == 0
    assert run(strict=True) == 1
