"""score_aggregate.py 专栏级评分聚合测试（反馈循环第一档收尾）。"""
import sys
from pathlib import Path

# scripts/ 不在 sys.path，手动加
SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from score_aggregate import aggregate_scores, format_report  # noqa: E402


def _write_md(path: Path, score: int = None) -> None:
    """写一篇带 frontmatter 的 .md，score 可选。"""
    fm_lines = [
        "---",
        'title: "测试"',
        f'book: "{path.parent.name}"',
        'chapter: "测试章"',
        'event: "测试事件"',
    ]
    if score is not None:
        fm_lines.append(f"quality_score: {score}")
    fm_lines.append("---\n")
    fm_lines.append("## 测试\n内容占位\n")
    path.write_text("\n".join(fm_lines), encoding="utf-8")


def test_aggregate_reads_frontmatter_scores(tmp_path):
    """aggregate_scores 默认读已有 frontmatter 的 quality_score。"""
    book_dir = tmp_path / "测试书"
    book_dir.mkdir()
    _write_md(book_dir / "ch1_event1.md", score=92)
    _write_md(book_dir / "ch2_event2.md", score=88)

    result = aggregate_scores(tmp_path)

    assert result["overall"] is not None
    assert result["overall"]["total"] == 2
    assert result["overall"]["avg"] == 90.0
    assert result["overall"]["min"] == 88
    assert result["overall"]["max"] == 92
    assert "测试书" in result["books"]
    assert result["books"]["测试书"]["count"] == 2


def test_aggregate_book_filter(tmp_path):
    """--book 仅跑指定书。"""
    book1 = tmp_path / "书A"
    book1.mkdir()
    _write_md(book1 / "a.md", score=95)
    book2 = tmp_path / "书B"
    book2.mkdir()
    _write_md(book2 / "b.md", score=80)

    result = aggregate_scores(tmp_path, book_filter="书A")
    assert "书A" in result["books"]
    assert "书B" not in result["books"]


def test_aggregate_no_scores_returns_none_overall(tmp_path):
    """无 quality_score 字段的 .md 不计入聚合。"""
    book_dir = tmp_path / "无分书"
    book_dir.mkdir()
    _write_md(book_dir / "ch1_event1.md", score=None)

    result = aggregate_scores(tmp_path)
    assert result["overall"] is None
    assert result["books"]["无分书"]["count"] == 0


def test_format_report_renders_markdown(tmp_path):
    """format_report 输出 Markdown 表格。"""
    book_dir = tmp_path / "测试书"
    book_dir.mkdir()
    _write_md(book_dir / "ch1_event1.md", score=90)

    result = aggregate_scores(tmp_path)
    md = format_report(result)
    assert "## 专栏级评分聚合报告" in md
    assert "| 书名 | 篇数 |" in md
    assert "测试书" in md


def test_aggregate_rerun_option(tmp_path):
    """--rerun 重新跑评分引擎，不依赖 frontmatter 字段。"""
    book_dir = tmp_path / "重跑书"
    book_dir.mkdir()
    # 不写 quality_score，靠 --rerun 跑出来
    _write_md(book_dir / "ch1_event1.md", score=None)

    result = aggregate_scores(tmp_path, rerun=True)
    assert result["rerun_count"] >= 1
    assert result["overall"] is not None
