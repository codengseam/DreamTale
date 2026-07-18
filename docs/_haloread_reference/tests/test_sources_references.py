"""文献结构化测试（反馈循环第二档）。

覆盖 src/utils/sources.py 的 extract_references_structured / build_references_frontmatter，
以及 scripts/extract_references.py 的 _inject_references 注入逻辑。
"""
from pathlib import Path

import sys

WORKSPACE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WORKSPACE))
sys.path.insert(0, str(WORKSPACE / "scripts"))

from src.utils.sources import (  # noqa: E402
    build_references_frontmatter,
    extract_references_structured,
)


_SAMPLE_CONTENT = """---
title: "测试"
book: "史记"
---

## 讲事情
正文占位。

## 参考来源

- 《史记·商君列传》（商鞅变法内容）
- 《史记·秦本纪》（献公流亡）
- 《战国策·秦策一》（苏秦说秦惠王）
"""


def test_extract_references_structured_parses_book_chapter_anchor():
    """extract_references_structured 应解析出 book/chapter/anchor。"""
    refs = extract_references_structured(_SAMPLE_CONTENT)
    assert len(refs) == 3, f"应解析 3 条，实际: {len(refs)}"
    assert refs[0]["book"] == "史记"
    assert refs[0]["chapter"] == "商君列传"
    assert "商鞅变法" in refs[0]["anchor"]
    assert refs[2]["book"] == "战国策"
    assert refs[2]["chapter"] == "秦策一"


def test_extract_references_structured_no_section_returns_empty():
    """无参考来源段返回空列表。"""
    content = "---\ntitle: x\n---\n# 标题\n正文无来源段。"
    refs = extract_references_structured(content)
    assert refs == []


def test_extract_references_structured_handles_book_only():
    """仅有书名无篇名也能解析。"""
    content = "## 参考来源\n\n- 《史记》（全书引用）\n"
    refs = extract_references_structured(content)
    assert len(refs) == 1
    assert refs[0]["book"] == "史记"
    assert refs[0]["chapter"] == ""


def test_build_references_frontmatter_format():
    """build_references_frontmatter 输出 yaml list 缩进格式。"""
    refs = [
        {"book": "史记", "chapter": "商君列传", "anchor": "变法"},
        {"book": "战国策", "chapter": "秦策", "anchor": ""},
    ]
    text = build_references_frontmatter(refs)
    assert text.startswith("references:")
    assert "  - book: 史记" in text
    assert "    chapter: 商君列传" in text
    assert "  - book: 战国策" in text


def test_build_references_frontmatter_empty_returns_empty():
    """空列表返回空字符串。"""
    assert build_references_frontmatter([]) == ""


def test_inject_references_idempotent():
    """已存在 references 字段时不应重复注入。"""
    from extract_references import _inject_references

    content_with_refs = (
        "---\n"
        "title: x\n"
        "references:\n"
        "  - book: 已有\n"
        "---\n\n## 参考来源\n\n- 《新书》（内容）\n"
    )
    refs_text = build_references_frontmatter([{"book": "新书", "chapter": "", "anchor": ""}])
    new_content, changed = _inject_references(content_with_refs, refs_text)
    assert not changed, "已存在 references 字段时不应注入"


def test_inject_references_writes_into_frontmatter(tmp_path):
    """_inject_references 应把 references 写入 frontmatter 末尾。"""
    from extract_references import _inject_references

    content = (
        "---\n"
        "title: 测试\n"
        "book: 史记\n"
        "---\n\n## 参考来源\n\n- 《史记·商君列传》（内容）\n"
    )
    refs = extract_references_structured(content)
    refs_text = build_references_frontmatter(refs)
    new_content, changed = _inject_references(content, refs_text)
    assert changed, "应注入 references 字段"
    assert "references:" in new_content
    assert "  - book: 史记" in new_content


def test_process_file_dry_run_does_not_write(tmp_path):
    """dry-run 模式不写文件。"""
    from extract_references import process_file

    md = tmp_path / "test.md"
    md.write_text(_SAMPLE_CONTENT, encoding="utf-8")
    original = md.read_text(encoding="utf-8")

    result = process_file(md, apply=False)
    assert result["refs"] == 3
    assert result.get("changed") is True
    assert result["applied"] is False
    # 文件未变
    assert md.read_text(encoding="utf-8") == original


def test_process_file_apply_writes(tmp_path):
    """apply 模式写入 references 字段。"""
    from extract_references import process_file

    md = tmp_path / "test.md"
    md.write_text(_SAMPLE_CONTENT, encoding="utf-8")

    result = process_file(md, apply=True)
    assert result["applied"] is True
    new_text = md.read_text(encoding="utf-8")
    assert "references:" in new_text
    assert "  - book: 史记" in new_text
