"""scripts/regen_loop_log_index.py 的单元测试。

覆盖：
1. 自动生成索引、计数表、锚点
2. 幂等性：连续两次运行输出不变
3. 跨月分片聚合
4. 零 lesson 月份不报错
5. --dry-run 不写文件
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from scripts.regen_loop_log_index import (  # noqa: E402
    SHARD_DIR as REAL_SHARD_DIR,
    MAIN_FILE as REAL_MAIN_FILE,
    run,
)


def _anchor(date: str, heading: str) -> str:
    digest = hashlib.sha256(f"{date}::{heading}".encode("utf-8")).hexdigest()[:6]
    return f"loop-{date.replace('-', '')}-{digest}"


@pytest.fixture(autouse=True)
def _patch_paths(monkeypatch, tmp_path):
    """把 regen 脚本操作路径指向临时目录。"""
    from scripts import regen_loop_log_index

    docs_dir = tmp_path / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    shard_dir = docs_dir / "loop_log"
    shard_dir.mkdir(exist_ok=True)

    monkeypatch.setattr(regen_loop_log_index, "SHARD_DIR", shard_dir)
    monkeypatch.setattr(regen_loop_log_index, "MAIN_FILE", docs_dir / "loop_log.md")


def _write_main(path: Path) -> None:
    path.write_text(
        """# LoopAgent 循环日志

## 索引区

<!-- AUTOGEN START: loop_log index -->
<!-- AUTOGEN END: loop_log index -->

---

## 方案 C 手册
""",
        encoding="utf-8",
    )


# ---------- 1. 自动生成索引、计数表、锚点 ----------


def test_regen_creates_index_and_anchors(tmp_path, capsys):
    """运行 regen 后，主文件生成索引，分片注入锚点。"""
    from scripts import regen_loop_log_index

    shard_dir = regen_loop_log_index.SHARD_DIR
    main_file = regen_loop_log_index.MAIN_FILE

    _write_main(main_file)
    h = "2026-06-26 示例"
    (shard_dir / "2026-06.md").write_text(
        f"## {h}\n\n正文。\n\n**教训标签**：`#lesson: git_hygiene`\n",
        encoding="utf-8",
    )

    run()
    captured = capsys.readouterr()
    assert "已更新" in captured.out

    main_text = main_file.read_text(encoding="utf-8")
    a = _anchor("2026-06-26", h)
    assert f"[2026-06-26 示例](loop_log/2026-06.md#{a})" in main_text
    assert "| `#git_hygiene`" in main_text
    assert "| `#book_structure`" in main_text

    shard_text = (shard_dir / "2026-06.md").read_text(encoding="utf-8")
    assert f'<a id="{a}"></a>' in shard_text


# ---------- 2. 幂等性 ----------


def test_regen_is_idempotent(tmp_path):
    """连续运行两次 regen，文件哈希不变。"""
    from scripts import regen_loop_log_index

    shard_dir = regen_loop_log_index.SHARD_DIR
    main_file = regen_loop_log_index.MAIN_FILE

    _write_main(main_file)
    (shard_dir / "2026-06.md").write_text(
        "## 2026-06-26 示例\n\n正文。\n\n**教训标签**：`#lesson: git_hygiene`\n",
        encoding="utf-8",
    )

    run()
    main_hash_1 = hashlib.sha256(main_file.read_bytes()).hexdigest()
    shard_hash_1 = hashlib.sha256((shard_dir / "2026-06.md").read_bytes()).hexdigest()

    run()
    main_hash_2 = hashlib.sha256(main_file.read_bytes()).hexdigest()
    shard_hash_2 = hashlib.sha256((shard_dir / "2026-06.md").read_bytes()).hexdigest()

    assert main_hash_1 == main_hash_2
    assert shard_hash_1 == shard_hash_2


# ---------- 3. 跨月分片聚合 ----------


def test_regen_aggregates_multiple_shards(tmp_path):
    """多个分片按日期倒序聚合到同一份索引。"""
    from scripts import regen_loop_log_index

    shard_dir = regen_loop_log_index.SHARD_DIR
    main_file = regen_loop_log_index.MAIN_FILE

    _write_main(main_file)
    (shard_dir / "2026-05.md").write_text(
        "## 2026-05-01 五月沉淀\n\n正文。\n\n**教训标签**：`#lesson: deployment`\n",
        encoding="utf-8",
    )
    (shard_dir / "2026-06.md").write_text(
        "## 2026-06-26 六月沉淀\n\n正文。\n\n**教训标签**：`#lesson: git_hygiene`\n",
        encoding="utf-8",
    )

    run()
    main_text = main_file.read_text(encoding="utf-8")
    # 六月应在五月之前
    june_pos = main_text.find("2026-06-26 六月沉淀")
    may_pos = main_text.find("2026-05-01 五月沉淀")
    assert june_pos != -1
    assert may_pos != -1
    assert june_pos < may_pos


# ---------- 4. 零 lesson 月份不报错 ----------


def test_regen_handles_zero_lesson(tmp_path):
    """分片中无 lesson slug 时，计数表显示 0，不报错。"""
    from scripts import regen_loop_log_index

    shard_dir = regen_loop_log_index.SHARD_DIR
    main_file = regen_loop_log_index.MAIN_FILE

    _write_main(main_file)
    (shard_dir / "2026-06.md").write_text(
        "## 2026-06-26 无标签沉淀\n\n正文。\n",
        encoding="utf-8",
    )

    run()
    main_text = main_file.read_text(encoding="utf-8")
    assert "| `#git_hygiene`" in main_text
    # 所有 slug 计数都应为 0
    for line in main_text.splitlines():
        if line.startswith("| `#") and "| 0 |" in line:
            break
    else:
        pytest.fail("计数表未显示 0 次")


# ---------- 5. --dry-run 不写文件 ----------


def test_regen_dry_run_does_not_write(tmp_path):
    """--dry-run 模式下不修改主文件和分片。"""
    from scripts import regen_loop_log_index

    shard_dir = regen_loop_log_index.SHARD_DIR
    main_file = regen_loop_log_index.MAIN_FILE

    original_main = """# LoopAgent 循环日志

## 索引区

<!-- AUTOGEN START: loop_log index -->
<!-- AUTOGEN END: loop_log index -->

---

## 方案 C 手册
"""
    main_file.write_text(original_main, encoding="utf-8")
    original_shard = "## 2026-06-26 示例\n\n正文。\n"
    (shard_dir / "2026-06.md").write_text(original_shard, encoding="utf-8")

    run(dry_run=True)

    assert main_file.read_text(encoding="utf-8") == original_main
    assert (shard_dir / "2026-06.md").read_text(encoding="utf-8") == original_shard
