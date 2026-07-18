#!/usr/bin/env python3
"""一次性迁移脚本：将非资治通鉴书籍从"一章一事件"重构为"按阶段大章节"。

迁移逻辑：
1. 每本书定义阶段映射：{阶段名: [事件名(按时间序)]}
2. 对每个文件，找到其事件所属阶段，确定新 chapter 名和 sort 值
3. 重命名文件：{book}/{old_chapter}_{event}.md → {book}/{new_chapter}_{event}.md
4. 更新 frontmatter：chapter 字段改为新阶段名，添加/更新 sort 字段

迁移后运行 python scripts/check_chapter_order.py 校验。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"

# 各书阶段映射：{阶段名: [事件名（按时间序）]}
# sort 值 = 事件在列表中的位置 + 1
STAGE_MAP: dict[str, dict[str, list[str]]] = {
    "三国": {
        "黄巾之乱与董卓专权": ["天下大乱", "桃园结义", "董卓乱政", "诸侯讨董"],
        "群雄逐鹿": ["曹操崛起", "官渡之战", "平定北方", "曹操文治"],
        "隆中对策与赤壁": ["三顾茅庐", "隆中对", "赤壁之战"],
        "三国鼎立": [
            "刘备入蜀", "汉中之战", "关羽北伐",
            "曹操之死与曹丕篡汉", "夷陵之战", "白帝托孤",
        ],
        "治国与北伐": [
            "江东基业", "孙权治国", "诸葛亮治蜀", "北伐中原", "五丈原",
        ],
        "三分归晋": ["高平陵之变", "蜀汉灭亡", "晋灭东吴"],
    },
    "史记": {
        "秦人立国与图霸": [
            "始封西垂", "襄公立国", "文公东猎", "穆公图霸", "哭庭救楚",
        ],
        "商鞅变法与连横扩张": [
            "商鞅变法", "张仪连横", "太后主政", "长平之战",
        ],
        "秦扫六合与暴政": [
            "韩非之死", "王翦灭楚", "始皇立制", "焚书坑儒", "长城骊山",
        ],
        "秦末大乱与楚汉相争": [
            "大泽乡起义", "沛公起兵", "项梁渡江", "破釜沉舟", "指鹿为马",
            "先入关中", "鸿门宴", "火烧咸阳", "韩信拜将", "还定三秦",
            "彭城之战", "背水一战", "鸿沟划界", "垓下之围",
        ],
        "汉初立国与文景之治": [
            "汉高祖称帝", "白登之围", "鸟尽弓藏", "高祖还乡", "高祖驾崩",
            "吕后称制", "诸吕之乱", "文帝即位", "缇萦救父", "七国之乱",
        ],
        "武帝雄风": [
            "建元新政", "马邑之谋", "卫青击匈奴", "封狼居胥", "张骞通西域",
            "苏武牧羊", "李陵降匈奴", "司马迁受刑", "巫蛊之祸", "轮台罪己",
        ],
        "昭宣中兴与西汉衰亡": ["霍光辅政", "昭宣中兴", "王莽篡汉"],
    },
    "唐纪": {
        "建国与统一": ["晋阳起兵", "定鼎长安", "扫平群雄"],
        "贞观之治": [
            "玄武门之变", "贞观开局", "君臣共治", "纳谏与用人",
            "修律与治国", "民族政策", "贞观之治的成就与局限",
        ],
        "武周代唐": [
            "高宗继位", "武则天入宫", "二圣临朝", "女主称帝",
            "酷吏政治", "神龙政变",
        ],
        "开元盛世": [
            "姚崇宋璟", "张说与制度改革", "开元盛世",
            "杨贵妃入宫", "安禄山崛起",
        ],
        "安史之乱": [
            "渔阳鼙鼓", "潼关失守", "马嵬驿之变", "肃宗灵武即位",
            "郭子仪李光弼", "安史之乱平定",
        ],
        "藩镇割据与唐亡": [
            "藩镇割据", "永贞革新", "牛李党争", "甘露之变",
            "黄巢起义", "朱温篡唐",
        ],
    },
    "宋纪": {
        "北宋建国与统一": [
            "陈桥兵变", "杯酒释兵权", "先南后北", "灭南唐",
            "烛影斧声", "灭北汉",
        ],
        "雍熙北伐与澶渊之盟": [
            "高粱河与雍熙北伐", "王小波李顺起义", "澶渊之盟",
        ],
        "仁宗盛治与庆历新政": [
            "刘太后临朝", "宋夏战争", "庆历新政", "仁宗盛治", "濮议之争",
        ],
        "熙宁变法与党争": [
            "王安石变法", "党争初起", "五路伐夏", "元祐更化", "哲宗绍述",
        ],
        "靖康之耻与南宋偏安": [
            "徽宗与蔡京", "花石纲与方腊", "海上之盟", "靖康之耻",
            "建炎南渡", "岳飞抗金", "绍兴和议",
        ],
        "南宋衰亡": [
            "采石之战", "隆兴乾淳", "庆元开禧", "史弥远专权", "端平入洛",
            "襄阳之战", "崖山之战",
        ],
    },
    "明纪": {
        "元末群雄与明朝建立": [
            "元末乱世", "少年朱元璋", "濠州投军", "朱元璋崛起",
            "鄱阳湖大战", "平定江南", "北伐大都", "洪武开国",
        ],
        "洪武之治与集权": ["胡蓝之狱", "废相集权", "洪武之治"],
        "永乐盛世与仁宣之治": [
            "靖难之役", "永乐盛世", "郑和下西洋", "仁宣之治",
        ],
        "土木之变与夺门之变": [
            "王振乱政", "土木堡之变", "京城保卫战", "夺门之变",
        ],
        "成弘正之治与社会转型": [
            "成化朝的隐患", "弘治中兴", "荒唐皇帝正德",
            "明代社会转型", "刘瑾之乱", "宁王之乱",
        ],
        "嘉靖隆庆与张居正改革": [
            "大礼议", "严嵩专权", "庚戌之变", "海瑞上疏",
            "隆庆开关", "张居正改革", "张居正死后清算",
        ],
        "万历怠政与晚明危机": [
            "万历怠政", "国本之争", "三大征", "萨尔浒之战",
            "东林党争", "魏忠贤专权",
        ],
        "明亡与清军入关": [
            "崇祯登基", "袁崇焕之死", "甲申之变", "南明与清军入关",
        ],
    },
    "孔子传": {
        "圣人降生与少年孤苦": [
            "孔氏源流", "叔梁纥与颜徵在", "尼丘降生", "三岁丧父", "吾少也贱",
        ],
        "求学立志": ["五父之衢", "志于学", "入太庙", "问礼老子", "闻韶"],
        "三十而立与创办私学": ["三十而立", "有教无类", "孔门三杰"],
        "鲁国从政": ["阳虎之乱", "中都宰", "夹谷之会", "堕三都"],
        "周游列国": ["见南子", "匡地桓魋", "陈蔡绝粮"],
        "归鲁修业与身后哀荣": [
            "归鲁", "删诗定礼", "作春秋", "获麟与卒",
            "弟子守丧", "追封孔庙",
        ],
    },
    "论语": {
        "孔子其人": ["孔子的一生", "孔子的性格", "孔子的困顿"],
        "教育之道": ["有教无类", "因材施教", "学而时习", "启发式教学"],
        "仁礼之学": ["仁的本质", "礼的精神", "仁与礼的关系"],
        "修身处世与齐家": [
            "君子与小人", "修身之道", "处世智慧", "朋友之道", "孝悌齐家",
        ],
        "为政与治国": ["为政以德", "治国理想", "孔子的政治遗憾"],
        "弟子群像": ["颜回", "子路", "孔门群像"],
        "天命与终极关怀": ["生死观", "天命与人", "孔子的终极关怀"],
    },
}

FRONTMATTER_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


def build_event_to_stage(book: str) -> dict[str, tuple[str, int, int]]:
    """构建 {event: (stage_name, chapter_sort, event_sort)} 映射。

    chapter_sort = 阶段在该书中的顺序号（1起），
    event_sort = 事件在该阶段中的顺序号（1起）。
    """
    mapping: dict[str, tuple[str, int, int]] = {}
    stages = STAGE_MAP[book]
    for stage_idx, (stage_name, events) in enumerate(stages.items()):
        for event_idx, event in enumerate(events):
            mapping[event] = (stage_name, stage_idx + 1, event_idx + 1)
    return mapping


def update_frontmatter(
    content: str, new_chapter: str, sort_val: int, chapter_sort: int
) -> str:
    """更新 frontmatter 的 chapter 字段，添加/更新 sort 和 chapter_sort 字段。

    若文件无 frontmatter，则补加一个。
    """
    match = FRONTMATTER_PATTERN.match(content)
    if not match:
        # 无 frontmatter，补加
        fm = (
            f'---\n'
            f'chapter: "{new_chapter}"\n'
            f'sort: {sort_val}\n'
            f'chapter_sort: {chapter_sort}\n'
            f'---\n'
        )
        return fm + content

    fm = match.group(1)
    body = content[match.end():]

    lines = fm.splitlines()
    new_lines: list[str] = []
    sort_added = False
    chapter_sort_added = False

    for line in lines:
        stripped = line.strip()
        # 更新 chapter
        if stripped.startswith("chapter:"):
            new_lines.append(f'chapter: "{new_chapter}"')
            continue
        # 跳过已有 sort 和 chapter_sort（稍后统一插入）
        if stripped.startswith("sort:"):
            continue
        if stripped.startswith("chapter_sort:"):
            continue
        new_lines.append(line)

    # 在 event 行后插入 sort 和 chapter_sort
    final_lines: list[str] = []
    for line in new_lines:
        final_lines.append(line)
        if line.strip().startswith("event:"):
            final_lines.append(f"sort: {sort_val}")
            final_lines.append(f"chapter_sort: {chapter_sort}")
            sort_added = True
            chapter_sort_added = True

    if not sort_added:
        final_lines.append(f"sort: {sort_val}")
    if not chapter_sort_added:
        final_lines.append(f"chapter_sort: {chapter_sort}")

    new_fm = "\n".join(final_lines)
    return f"---\n{new_fm}\n---\n{body}"


def migrate_book(book: str) -> tuple[int, list[str]]:
    """迁移一本书。返回 (迁移文件数, 错误列表)。"""
    book_dir = OUTPUT / book
    if not book_dir.exists():
        return 0, [f"目录不存在: {book_dir}"]

    event_map = build_event_to_stage(book)
    migrated = 0
    errors: list[str] = []

    for md_path in sorted(book_dir.rglob("*.md")):
        if md_path.name.startswith("_"):
            continue

        stem = md_path.stem
        if "_" in stem:
            old_chapter, event = stem.split("_", 1)
        else:
            old_chapter, event = stem, ""

        if event not in event_map:
            errors.append(f"未找到事件映射: {book}/{stem} (event={event!r})")
            continue

        new_chapter, chapter_sort, sort_val = event_map[event]
        new_name = f"{new_chapter}_{event}.md"
        new_path = md_path.parent / new_name

        # 读内容并更新 frontmatter
        content = md_path.read_text(encoding="utf-8")
        new_content = update_frontmatter(content, new_chapter, sort_val, chapter_sort)

        # 写新文件
        new_path.write_text(new_content, encoding="utf-8")

        # 删旧文件（如果路径不同）
        if new_path != md_path:
            md_path.unlink()

        migrated += 1

    return migrated, errors


def main() -> int:
    """主入口。"""
    total_migrated = 0
    all_errors: list[str] = []

    for book in STAGE_MAP:
        migrated, errors = migrate_book(book)
        total_migrated += migrated
        all_errors.extend(errors)
        print(f"【{book}】迁移 {migrated} 个文件")
        for err in errors:
            print(f"  ❌ {err}")

    print(f"\n总计迁移 {total_migrated} 个文件")
    if all_errors:
        print(f"❌ {len(all_errors)} 个错误")
        return 1
    print("✅ 全部迁移成功")
    return 0


if __name__ == "__main__":
    sys.exit(main())
