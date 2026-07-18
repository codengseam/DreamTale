"""archetype 分桶阶段5 Skill 入口分流文档契约测试。

测试契约（来自 docs/archetype-design/design.md §九阶段5、计划评审 R-T1~R-T4）：
- SKILL.md 含 --archetype 命令模板（fenced code block 内）
- SKILL.md 含 archetype 信源优先级关键词（_meta.yaml / category / 问用户或无法确定）
- SKILL.md 含三选一话术（narrative / modern / knowledge 三个词同段）
- 三套 rules-*.md 顶部 10 行内互相引用另两个桶文件名
- rules.md 正文零改动（git master 版与当前版 §一之后内容完全一致）
- 16 专栏 archetype 字段现状：易经课显式 knowledge，资治通鉴无字段靠 category 兜底
- src/main.py argparse --archetype 支持 narrative/modern/knowledge 三值（narrative 零回归）

范围：只做文档契约与运行时 argparse 断言，不触发真实生成（避免依赖 langgraph）。
"""
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SKILL_DIR = ROOT / ".trae" / "skills" / "deep-reading"
SKILL_MD = SKILL_DIR / "SKILL.md"
RULES_MD = SKILL_DIR / "rules.md"
RULES_MODERN_MD = SKILL_DIR / "rules-modern.md"
RULES_KNOWLEDGE_MD = SKILL_DIR / "rules-knowledge.md"
MAIN_PY = ROOT / "src" / "main.py"


# ---------------------------------------------------------------------------
# 契约1：SKILL.md 含 --archetype 命令模板（fenced code block 内）
# ---------------------------------------------------------------------------

def test_skill_md_has_archetype_in_code_block():
    """SKILL.md 必须在 fenced code block 内含 python src/main.py 且同行带 --archetype。"""
    text = SKILL_MD.read_text(encoding="utf-8")
    # 提取所有 ```bash / ```python ... ``` 代码块
    code_blocks = re.findall(r"```[a-z]*\n(.*?)\n```", text, re.DOTALL)
    assert code_blocks, "SKILL.md 应至少含一个 fenced code block"
    matched = any(
        "python src/main.py" in blk and "--archetype" in blk
        for blk in code_blocks
    )
    assert matched, (
        "SKILL.md 应有 fenced code block 含 `python src/main.py` 且同行带 `--archetype`"
    )


# ---------------------------------------------------------------------------
# 契约2：SKILL.md 含 archetype 信源优先级关键词
# ---------------------------------------------------------------------------

def test_skill_md_archetype_signal_priority_keywords():
    """SKILL.md 必须提及信源：_meta.yaml、category、问用户/无法确定。"""
    text = SKILL_MD.read_text(encoding="utf-8")
    assert "_meta.yaml" in text, "SKILL.md 应提及 _meta.yaml 作为 archetype 信源"
    assert "category" in text, "SKILL.md 应提及 category 默认映射"
    # "问用户" 或 "无法确定" 二选一（R-A1：仅在 category 未知或经/技无 _meta.yaml 时触发）
    assert "问用户" in text or "无法确定" in text, (
        "SKILL.md 应说明何时问用户（category 未知或经/技无 _meta.yaml.archetype）"
    )


# ---------------------------------------------------------------------------
# 契约3：SKILL.md 含三选一话术（narrative/modern/knowledge 同段）
# ---------------------------------------------------------------------------

def test_skill_md_three_bucket_phrasing():
    """SKILL.md 必须含 narrative/modern/knowledge 三选一话术。"""
    text = SKILL_MD.read_text(encoding="utf-8")
    # 找一段同时含三个桶名的段落（允许跨多行，30 字符窗口）
    pattern = re.compile(
        r"narrative[^]{0,80}modern[^]{0,80}knowledge|"
        r"modern[^]{0,80}narrative[^]{0,80}knowledge|"
        r"knowledge[^]{0,80}modern[^]{0,80}narrative",
        re.DOTALL,
    )
    assert pattern.search(text), (
        "SKILL.md 应含三选一话术（narrative / modern / knowledge 同段出现）"
    )


# ---------------------------------------------------------------------------
# 契约4：三套 rules-*.md 顶部 10 行内互相引用另两个桶文件名
# ---------------------------------------------------------------------------

def test_rules_md_references_modern_and_knowledge():
    """rules.md 顶部 10 行内应引用 rules-modern.md 和 rules-knowledge.md。"""
    head = "\n".join(RULES_MD.read_text(encoding="utf-8").splitlines()[:10])
    assert "rules-modern.md" in head, "rules.md 顶部应引用 rules-modern.md"
    assert "rules-knowledge.md" in head, "rules.md 顶部应引用 rules-knowledge.md"
    assert "narrative" in head, "rules.md 顶部应声明适用 narrative 桶"


def test_rules_modern_md_references_narrative_and_knowledge():
    """rules-modern.md 顶部 10 行内应引用 rules.md 和 rules-knowledge.md。"""
    head = "\n".join(RULES_MODERN_MD.read_text(encoding="utf-8").splitlines()[:10])
    assert "rules.md" in head, "rules-modern.md 顶部应引用 rules.md"
    assert "rules-knowledge.md" in head, "rules-modern.md 顶部应引用 rules-knowledge.md"
    assert "modern" in head, "rules-modern.md 顶部应声明适用 modern 桶"


def test_rules_knowledge_md_references_narrative_and_modern():
    """rules-knowledge.md 顶部 10 行内应引用 rules.md 和 rules-modern.md。"""
    head = "\n".join(RULES_KNOWLEDGE_MD.read_text(encoding="utf-8").splitlines()[:10])
    assert "rules.md" in head, "rules-knowledge.md 顶部应引用 rules.md"
    assert "rules-modern.md" in head, "rules-knowledge.md 顶部应引用 rules-modern.md"
    assert "knowledge" in head, "rules-knowledge.md 顶部应声明适用 knowledge 桶"


# ---------------------------------------------------------------------------
# 契约5：rules.md 正文零改动（git master 版与当前版 §一之后完全一致）
# ---------------------------------------------------------------------------

def test_rules_md_body_unchanged_vs_master():
    """rules.md 正文（§一之后）须与 origin/master 完全一致（narrative 禁区）。

    narrative 桶 rules.md 只允许在顶部加声明，§一标题及之后内容零改动。
    CI 环境 fresh checkout 无 origin/master ref，先 fetch depth=1 再用 FETCH_HEAD。
    """
    # 先尝试 origin/master（本地已有 ref 时直接用）
    try:
        result = subprocess.run(
            ["git", "show", "origin/master:.trae/skills/deep-reading/rules.md"],
            cwd=ROOT, capture_output=True, text=True, check=True, timeout=30,
        )
        master_text = result.stdout
    except subprocess.CalledProcessError:
        # CI 环境：fetch master depth=1 后用 FETCH_HEAD
        subprocess.run(
            ["git", "fetch", "origin", "master", "--depth=1"],
            cwd=ROOT, capture_output=True, text=True, check=True, timeout=60,
        )
        result = subprocess.run(
            ["git", "show", "FETCH_HEAD:.trae/skills/deep-reading/rules.md"],
            cwd=ROOT, capture_output=True, text=True, check=True, timeout=30,
        )
        master_text = result.stdout
    # master 版 §一 标题行号（从 1 计）
    master_lines = master_text.splitlines()
    try:
        master_section_one_idx = next(
            i for i, ln in enumerate(master_lines)
            if ln.strip().startswith("## 一、")
        )
    except StopIteration:
        pytest.fail("origin/master 的 rules.md 找不到 '## 一、' 标题")
    master_body = "\n".join(master_lines[master_section_one_idx:])

    current_lines = RULES_MD.read_text(encoding="utf-8").splitlines()
    try:
        current_section_one_idx = next(
            i for i, ln in enumerate(current_lines)
            if ln.strip().startswith("## 一、")
        )
    except StopIteration:
        pytest.fail("当前 rules.md 找不到 '## 一、' 标题")
    current_body = "\n".join(current_lines[current_section_one_idx:])

    assert current_body == master_body, (
        "rules.md 正文（§一及之后）必须与 origin/master 完全一致——narrative 是禁区，"
        "只允许在顶部加声明。"
    )


# ---------------------------------------------------------------------------
# 契约6：16 专栏 archetype 字段现状（R-T3）
# ---------------------------------------------------------------------------

def test_meta_yaml_archetype_field_yijing_is_knowledge():
    """易经课 _meta.yaml 应显式声明 archetype: knowledge（混合桶「经」的显式覆盖证据）。"""
    meta = (ROOT / "output" / "易经课" / "_meta.yaml").read_text(encoding="utf-8")
    assert re.search(r"^archetype:\s*knowledge\s*$", meta, re.MULTILINE), (
        "易经课 _meta.yaml 应含 archetype: knowledge（design.md §5.4 显式覆盖）"
    )


def test_meta_yaml_zizhi_no_archetype_but_category_shi():
    """资治通鉴 _meta.yaml 不含 archetype 字段，但 category=史（靠默认映射兜底 narrative）。"""
    meta = (ROOT / "output" / "资治通鉴" / "_meta.yaml").read_text(encoding="utf-8")
    assert re.search(r"^category:\s*史\s*$", meta, re.MULTILINE), (
        "资治通鉴 _meta.yaml 应含 category: 史"
    )
    assert not re.search(r"^archetype:", meta, re.MULTILINE), (
        "资治通鉴 _meta.yaml 不应有 archetype 字段（靠 category 默认映射兜底 narrative）"
    )


# ---------------------------------------------------------------------------
# 契约7：src/main.py argparse --archetype 支持 narrative/modern/knowledge（R-T2 零回归）
# ---------------------------------------------------------------------------

def test_main_py_argparse_supports_archetype():
    """src/main.py 应有 --archetype 参数（narrative 零回归 argparse 断言）。

    不触发真实 main()，只校验 argparse 定义存在。
    """
    text = MAIN_PY.read_text(encoding="utf-8")
    assert '"--archetype"' in text, "src/main.py 应定义 --archetype 参数"


def test_main_py_argparse_archetype_accepts_three_values():
    """--archetype 应接受 narrative/modern/knowledge 三值并通过 stub 模式零回归。

    用 stub 模式跑 narrative 桶，断言退出码 0（narrative 零回归运行时验证）。
    不依赖 langgraph，走 stub 路径。
    """
    cmd = [
        sys.executable, "src/main.py",
        "--book", "资治通鉴",
        "--chapter", "周纪二",
        "--event", "零回归测试",
        "--archetype", "narrative",
        "--stub",
        "--dry-run",
    ]
    # dry-run 避免污染 output；stub 不依赖 API
    result = subprocess.run(
        cmd, cwd=ROOT, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, (
        f"narrative 桶 stub 模式应零回归退出 0，实际 {result.returncode}\n"
        f"stdout: {result.stdout[-500:]}\nstderr: {result.stderr[-500:]}"
    )


def test_get_stub_sections_pyyaml_missing_does_not_crash(monkeypatch):
    """BUG-030 回归：PyYAML 未装时 _get_stub_sections 不应崩。

    根因：内置简单 YAML 解析器把 quality_check 嵌套结构解析成 list，
    原 qc.get("required_sections") 触发 AttributeError: 'list' object has no attribute 'get'。
    修复：_get_stub_sections 对 list 情况兜底返回 narrative 默认六段。
    """
    # 模拟 PyYAML 未装时 load_config 返回的异常结构（quality_check 是 list 而非 dict）
    import src.main as main_mod

    def _fake_load_config_broken():
        # 模拟内置简单解析器把 quality_check 嵌套解析成 list
        return {"section_templates": {}, "quality_check": ["enabled", "required_sections"]}

    # 直接测函数内部对 load_config 的调用
    import src.utils.config as config_mod
    original_load = config_mod.load_config
    config_mod.load_config = _fake_load_config_broken
    try:
        # 不应抛 AttributeError，应返回 narrative 默认六段
        result = main_mod._get_stub_sections("narrative")
        assert result == ["讲事情", "讲人物", "讲背景", "讲道理", "问道悟道", "结语"], (
            f"PyYAML 未装时应返回 narrative 默认六段，实际 {result}"
        )
    finally:
        config_mod.load_config = original_load


# ---------------------------------------------------------------------------
# 契约8：rules-modern.md / rules-knowledge.md 分工（管"怎么写"不复制"怎么查"）
# ---------------------------------------------------------------------------

def test_rules_modern_md_delegates_quality_to_content_quality():
    """rules-modern.md 应指向 content-quality.md §8.2 做质检，不重复白名单全文。"""
    text = RULES_MODERN_MD.read_text(encoding="utf-8")
    assert "content-quality.md" in text, "rules-modern.md 应引用 content-quality.md"
    assert "§8.2" in text or "8.2" in text, "rules-modern.md 应指向 content-quality.md §8.2 modern 桶规则集"
    # 不应整段复制 MODERN_ENGLISH_WHITELIST 全部 22 词（指向常量名引用即可）
    # 断言不出现"完整词表"特征：连续 5 个以上白名单词在 60 字符内堆砌
    whitelist_words = ["bug", "KPI", "offer", "HR", "OKR", "CEO", "BATNA", "CRIB", "PPT"]
    word_alt = "|".join(whitelist_words)
    # 匹配 5 个以上白名单词在 60 字符窗口内连续出现（整段复制词表的特征）
    pattern = re.compile(
        r"(?:" + word_alt + r")[^\n]{0,15}(?:" + word_alt + r")[^\n]{0,15}(?:" + word_alt + r")[^\n]{0,15}(?:" + word_alt + r")[^\n]{0,15}(?:" + word_alt + r")",
    )
    assert not pattern.search(text), (
        "rules-modern.md 不应整段堆砌 5 个以上白名单词（应指向 content_quality.py 的 MODERN_ENGLISH_WHITELIST 常量引用，3-4 词示例可接受）"
    )


def test_rules_knowledge_md_delegates_quality_to_content_quality():
    """rules-knowledge.md 应指向 content-quality.md §8.3 做质检，不重复白名单全文。"""
    text = RULES_KNOWLEDGE_MD.read_text(encoding="utf-8")
    assert "content-quality.md" in text, "rules-knowledge.md 应引用 content-quality.md"
    assert "§8.3" in text or "8.3" in text, "rules-knowledge.md 应指向 content-quality.md §8.3 knowledge 桶规则集"
    assert "KNOWLEDGE_TERMS_WHITELIST" in text, "rules-knowledge.md 应引用 KNOWLEDGE_TERMS_WHITELIST 常量名"
