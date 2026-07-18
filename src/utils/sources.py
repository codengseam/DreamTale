"""来源提取工具。

为 Specialist Agent 提供统一的来源解析函数。
"""

import re
from typing import Dict, List


MARKERS = ["来源：", "参考资料：", "引用：", "出处：", "参考："]
SECTION_HEADERS = ["## 参考来源", "## 参考文献", "## 来源", "## 参考资料"]

# 匹配 - 《书名·篇名》（内容） 或 - 《书名》（内容） 或 - 书名·篇名（内容）
_REF_LINE_RE = re.compile(
    r"^[-*]\s+"
    r"(?:《(?P<book_cite>[^》·]+)(?:·(?P<chapter_cite>[^》]+))?》|(?P<book_plain>[^（《·]+?)(?:·(?P<chapter_plain>[^（]+?))?)"
    r"(?:[（(](?P<anchor>[）)]*[^）)]*?)[）)])?\s*$"
)


def extract_sources(content: str) -> list[str]:
    """从 LLM 输出中提取文末来源列表。

    匹配常见的来源分段标记，如「来源：」「参考资料：」「引用：」等，
    并返回以 - 或数字开头的非空行列表。
    """
    for marker in MARKERS:
        idx = content.rfind(marker)
        if idx != -1:
            tail = content[idx + len(marker):]
            lines = [
                line.strip().lstrip("-0123456789. ").strip()
                for line in tail.splitlines()
                if line.strip()
            ]
            return [line for line in lines if line]
    return []


def extract_references_structured(content: str) -> List[Dict[str, str]]:
    """从文末「## 参考来源」段提取结构化文献列表。

    解析每行 - 《书名·篇名》（对应内容锚点） 格式，
    返回 [{book, chapter, anchor}] 列表。

    若无结构化章节标记，返回空列表（不降级到 extract_sources 的纯文本列表）。
    """
    # 定位文末参考来源段
    ref_section = ""
    for header in SECTION_HEADERS:
        idx = content.rfind(header)
        if idx != -1:
            ref_section = content[idx + len(header):]
            break
    if not ref_section:
        # 兜底：尝试旧 MARKERS
        for marker in MARKERS:
            idx = content.rfind(marker)
            if idx != -1:
                ref_section = content[idx + len(marker):]
                break
    if not ref_section:
        return []

    refs: List[Dict[str, str]] = []
    for line in ref_section.splitlines():
        line = line.strip()
        if not line or not line.startswith(("-", "*")):
            continue
        m = _REF_LINE_RE.match(line)
        if not m:
            continue
        book = m.group("book_cite") or m.group("book_plain") or ""
        chapter = m.group("chapter_cite") or m.group("chapter_plain") or ""
        anchor = m.group("anchor") or ""
        book = book.strip()
        chapter = chapter.strip()
        anchor = anchor.strip()
        if not book and not chapter:
            continue
        refs.append({"book": book, "chapter": chapter, "anchor": anchor})
    return refs


def build_references_frontmatter(references: List[Dict[str, str]]) -> str:
    """把结构化文献列表转成 frontmatter 中的 references 字段文本。

    生成格式（yaml list 缩进两空格）：
        references:
          - book: 史记
            chapter: 商君列传
            anchor: 商鞅变法内容
    """
    if not references:
        return ""
    lines = ["references:"]
    for ref in references:
        lines.append(f"  - book: {ref.get('book', '')}")
        lines.append(f"    chapter: {ref.get('chapter', '')}")
        lines.append(f"    anchor: {ref.get('anchor', '')}")
    return "\n".join(lines)

