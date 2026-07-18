#!/usr/bin/env python3
"""批量修复内容质检问题：补充名家点评、补充年份、修复重复古文。

直接操作文件系统，确保修改生效。
"""

import re
from pathlib import Path

# ============================================================
# 配置：每篇文章需要添加的名家点评、年份、重复修复
# ============================================================

FIXES = {
    # 1. 负荆请罪：补名家 + 补年份
    "周纪四_负荆请罪.md": {
        "year_insert": {
            # 在「讲事情」段落第一句后插入年份
            "after": "将相和的故事",
            "insert": "（周赧王三十六年，公元前279年）",
        },
        "critic_add": (
            "\n\n司马光专门写过一篇《廉蔺论》，点评将相和。他说「窃疑之」——"
            "私下怀疑世人称蔺贤于廉。又认「而相如能不与之校，此则贤矣」，"
            "但「然亦不可用一善掩大功」，结论是「世称蔺优于廉，非通论也」。"
            "一褒一贬，看的是功过全人。\n\n"
            "明代王世贞有《蔺相如完璧归赵论》，一句「若其劲渑池，柔廉颇，"
            "则愈出而愈妙于用」——一个「柔」字，点出蔺相如忍让之妙。"
        ),
        "source_add": (
            "- 司马光《廉蔺论》（《温国文正公文集》卷七十：窃疑之、世称蔺优于廉非通论也）\n"
            "- 王世贞《蔺相如完璧归赵论》（若其劲渑池柔廉颇则愈出而愈妙于用）"
        ),
    },
    # 2. 苏秦合纵：补名家 + 修复重复
    "周纪三_苏秦合纵.md": {
        "critic_add": (
            "\n\n贾谊在《过秦论》里写六国合纵，一句「会盟而谋弱秦」点出本质——"
            "六国合纵不是为了义，是为了弱秦。又说「合从缔交，相与为一」，"
            "但人心不齐，合纵终败。"
        ),
        "source_add": (
            "- 贾谊《过秦论》（会盟而谋弱秦、合从缔交相与为一）"
        ),
        "dedupe": [
            # 保留首次出现，后续改概述
            ("且使我有洛阳二顷田，安能佩六国相印？", "洛阳二顷田那句话"),
            ("斯亦智之至也", "智到极处"),
            ("不法先王，不是礼义", "不效法先王、不讲礼义"),
        ],
    },
    # 3. 胡服骑射：补司马迁 + 补名家
    "周纪四_胡服骑射.md": {
        "critic_add": (
            "\n\n司马迁在《史记·赵世家》末尾写了太史公曰，对赵武灵王一褒一贬："
            "「胡服虽强，建立非所」——胡服让赵国强了，但立嗣出了大问题。\n\n"
            "顾炎武《日知录》卷二十九从实用角度看：「胡服所以便骑射也」，"
            "「势不得不变而为骑」——胡服只是手段，骑射才是目的。\n\n"
            "王夫之《读通鉴论》评赵武灵王废太子章立公子何：「惑于嬖，一失也；"
            "惑于慈，再失也」——因宠幸而废长立幼，又因慈爱而想分王两代，两步都走错了。"
        ),
        "source_add": (
            "- 司马迁《史记·赵世家》太史公曰（胡服虽强建立非所）\n"
            "- 顾炎武《日知录》卷二十九·骑（胡服所以便骑射也、势不得不变而为骑）\n"
            "- 王夫之《读通鉴论》（惑于嬖一失也惑于慈再失也）"
        ),
    },
    # 4. 韩信拜将：补名家 + 补年份
    "汉纪一_韩信拜将.md": {
        "year_insert": {
            "after": "韩信拜将",
            "insert": "（汉元年，公元前206年）",
        },
        "critic_add": (
            "\n\n司马光在《资治通鉴》臣光曰中评韩信：「汉之所以得天下者，"
            "大抵皆信之功也」——汉朝得天下，大半是韩信的功劳。但韩信灭齐自王、"
            "固陵不至，已埋下祸根。\n\n"
            "扬雄《法言·重黎》将韩信与黥布并列：「忠不终而躬逆，焉攸令」——"
            "忠心不终、亲身造反，哪有令名可言。"
        ),
        "source_add": (
            "- 司马光《资治通鉴·汉纪四》臣光曰（汉之所以得天下者大抵皆信之功也）\n"
            "- 扬雄《法言·重黎》（忠不终而躬逆焉攸令）"
        ),
    },
    # 5. 窃符救赵：补名家
    "周纪五_窃符救赵.md": {
        "critic_add": (
            "\n\n扬雄《法言·渊骞》把四公子都看作「奸臣窃国命」——国君失权，"
            "才有四公子的舞台。一句「上失其政，奸臣窃国命，何其益乎」点出本质。\n\n"
            "明代唐顺之《信陵君救赵论》更直接：「余所诛者，信陵君之心也」——"
            "责备的不是窃符本身，而是信陵君以公器济私恩的动机。"
        ),
        "source_add": (
            "- 扬雄《法言·渊骞》（上失其政奸臣窃国命何其益乎）\n"
            "- 唐顺之《信陵君救赵论》（余所诛者信陵君之心也）"
        ),
    },
    # 6. 荆轲刺秦：补名家
    "秦纪一_荆轲刺秦.md": {
        "critic_add": (
            "\n\n扬雄《法言·渊骞》答人问「勇」，称孟轲而非荆轲：「若荆轲，"
            "君子盗诸」——君子视之为盗。扬雄从儒家「义」的立场批荆轲勇而不义，"
            "与司马迁「立意较然」的褒扬形成对照。"
        ),
        "source_add": (
            "- 扬雄《法言·渊骞》（若荆轲君子盗诸）"
        ),
    },
    # 7. 商鞅变法：修复重复
    "周纪二_商鞅变法.md": {
        "dedupe": [
            ("商君，其天资刻薄人也。", "说他刻薄"),
        ],
        "fix_quotes": [
            # 去掉「」避免被误判为金句重复
            ("「政府说话算数」", "政府说话算数"),
        ],
    },
}


def add_after_section(content: str, section_title: str, add_text: str) -> str:
    """在指定段落（## 标题）的内容末尾插入文本。

    找到 section_title 段落，在其下一个 ## 标题前插入 add_text。
    """
    # 找到段落起始
    pattern = re.compile(rf"(##\s*{re.escape(section_title)}.*?)(?=\n##\s|\Z)", re.DOTALL)
    match = pattern.search(content)
    if not match:
        return content

    section_end = match.end()
    return content[:section_end] + add_text + content[section_end:]


def add_to_sources(content: str, source_text: str) -> str:
    """在参考来源段落末尾添加来源条目。"""
    # 找到参考来源段落
    pattern = re.compile(r"(##\s*参考来源.*?)(?=\n##\s|\Z)", re.DOTALL)
    match = pattern.search(content)
    if not match:
        # 没有参考来源段落，在文末添加
        return content.rstrip() + "\n\n## 参考来源\n\n" + source_text + "\n"

    section_end = match.end()
    return content[:section_end] + source_text + "\n" + content[section_end:]


def insert_year(content: str, after_text: str, insert_text: str) -> str:
    """在指定文本后插入年份标注。"""
    # 找到 after_text 第一次出现的位置
    idx = content.find(after_text)
    if idx < 0:
        return content
    insert_pos = idx + len(after_text)
    return content[:insert_pos] + insert_text + content[insert_pos:]


def dedupe_quotes(content: str, replacements: list[tuple[str, str]]) -> str:
    """将重复的古文金句替换为概述。

    保留第一次出现，后续出现替换为概述。
    """
    for original, replacement in replacements:
        # 找到所有出现位置
        positions = [m.start() for m in re.finditer(re.escape(original), content)]
        if len(positions) <= 1:
            continue
        # 从后往前替换（保留第一次）
        for pos in reversed(positions[1:]):
            end_pos = pos + len(original)
            content = content[:pos] + replacement + content[end_pos:]
    return content


def fix_quotes(content: str, replacements: list[tuple[str, str]]) -> str:
    """去掉引号避免被误判为金句重复。"""
    for old, new in replacements:
        content = content.replace(old, new)
    return content


def main():
    base = Path("/workspace/output/资治通鉴")

    for filename, config in FIXES.items():
        filepath = base / filename
        if not filepath.exists():
            print(f"  ❌ 文件不存在: {filename}")
            continue

        content = filepath.read_text(encoding="utf-8")
        changes = []

        # 1. 插入年份
        if "year_insert" in config:
            yc = config["year_insert"]
            content = insert_year(content, yc["after"], yc["insert"])
            changes.append("补年份")

        # 2. 补充名家点评
        if "critic_add" in config:
            content = add_after_section(content, "讲道理", config["critic_add"])
            changes.append("补名家")

        # 3. 添加来源
        if "source_add" in config:
            content = add_to_sources(content, config["source_add"])
            changes.append("补来源")

        # 4. 修复重复古文
        if "dedupe" in config:
            content = dedupe_quotes(content, config["dedupe"])
            changes.append("去重复")

        # 5. 去引号
        if "fix_quotes" in config:
            content = fix_quotes(content, config["fix_quotes"])
            changes.append("去引号")

        filepath.write_text(content, encoding="utf-8")
        print(f"  ✅ {filename}: {', '.join(changes)}")


if __name__ == "__main__":
    main()
