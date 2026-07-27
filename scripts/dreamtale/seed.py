# -*- coding: utf-8 -*-
"""DreamTale 示例数据灌入脚本。

从原 ``app.py`` 第 29-347 行的示例数据迁移，灌入「问剑长歌」示例项目。

包含：
    - 1 个项目（问剑长歌）
    - 6 个章节（ch_040-045）
    - 3 卷大纲条目（卷一 5 条 + 卷二 4 条 + 卷三 4 条 = 13 条）
    - 7 个伏笔
    - 12 个爽点
    - 6 个人物
    - 6 个世界观设定

用法：
    python scripts/dreamtale/seed.py
"""

from __future__ import annotations

import os
import sys
import sqlite3
from typing import Optional

# ---------------------------------------------------------------------------
# 确保项目根目录在 sys.path 中
# 兼容两种运行方式：
#   1. python scripts/dreamtale/seed.py  （sys.path[0] = scripts/dreamtale/）
#   2. python -m scripts.dreamtale.seed  （sys.path[0] = 项目根）
# ---------------------------------------------------------------------------
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from scripts.dreamtale.db import DB_PATH, SCHEMA_PATH  # noqa: E402


# ===========================================================================
# 示例数据（从 app.py 第 29-347 行迁移）
# ===========================================================================

# --- 项目：问剑长歌 ---
# 注意：app.py 中 target_words/current_words 为字符串（"1,200,000 字"），
# 这里按 schema 转为整数。
_PROJECT = {
    "name": "问剑长歌",
    "subtitle": "一个少年握住残剑，走向被遗忘的神祇故土",
    "genre": "东方玄幻 · 长篇网文",
    "author": "DreamTale 工作室",
    "target_words": 1200000,   # 原 "1,200,000 字"
    "current_words": 268400,   # 原 "268,400 字"
    "volumes_done": 2,
    "volumes_total": 5,
    "chapters_done": 42,
    "chapters_total": 220,
    "status": "第 3 卷『渊海沉璧』连载中",
    "updated": "2026-07-18",
}

# --- 章节（ch_040-045） ---
# vol_no 由 phase 推导：卷二=2，卷三=3
_CHAPTERS = [
    {"vol_no": 2, "ch_no": 40, "title": "寒江尽头",
     "summary": "沈砚与阿箩走出寒江，残剑初次显形剑纹。",
     "highlights": "残剑剑纹", "words": 6200},
    {"vol_no": 2, "ch_no": 41, "title": "无相追杀",
     "summary": "无相门「影杀」再现，沈砚负伤逃入渊海口。",
     "highlights": "影杀再现", "words": 6400},
    {"vol_no": 2, "ch_no": 42, "title": "渊海口的风",
     "summary": "卷二收束，沈砚望海立誓，卷三伏笔铺设。",
     "highlights": "卷二收束", "words": 6500},
    {"vol_no": 3, "ch_no": 43, "title": "东海第一夜",
     "summary": "沈砚乘「白鲨舟」入海，遇海族斥候。",
     "highlights": "白鲨舟", "words": 6300},
    {"vol_no": 3, "ch_no": 44, "title": "沉璧传说",
     "summary": "海族祭司口述「沉璧」剑骨来历。",
     "highlights": "沉璧来历", "words": 6100},
    {"vol_no": 3, "ch_no": 45, "title": "渊海暗流",
     "summary": "三王势力初现，沈砚被卷入海族内斗。",
     "highlights": "三王初现", "words": 6600},
]

# --- 大纲（3 卷，共 13 条章纲） ---
_OUTLINES = [
    # 卷一 · 锋未鸣
    {"vol_no": 1, "vol_name": "卷一 · 锋未鸣",
     "vol_goal": "主角立人设 + 残剑金手指登场 + 外门冲突爆发",
     "ch_no": 1, "ch_title": "剑冢拾剑", "ch_hook": "残剑出世"},
    {"vol_no": 1, "vol_name": "卷一 · 锋未鸣",
     "vol_goal": "主角立人设 + 残剑金手指登场 + 外门冲突爆发",
     "ch_no": 2, "ch_title": "外门杂役", "ch_hook": "立人设"},
    {"vol_no": 1, "vol_name": "卷一 · 锋未鸣",
     "vol_goal": "主角立人设 + 残剑金手指登场 + 外门冲突爆发",
     "ch_no": 3, "ch_title": "剑意初生", "ch_hook": "金手指觉醒"},
    {"vol_no": 1, "vol_name": "卷一 · 锋未鸣",
     "vol_goal": "主角立人设 + 残剑金手指登场 + 外门冲突爆发",
     "ch_no": 4, "ch_title": "内门考核", "ch_hook": "首次爆发"},
    {"vol_no": 1, "vol_name": "卷一 · 锋未鸣",
     "vol_goal": "主角立人设 + 残剑金手指登场 + 外门冲突爆发",
     "ch_no": 5, "ch_title": "斩第一人", "ch_hook": "卷一爆点"},
    # 卷二 · 渡寒江
    {"vol_no": 2, "vol_name": "卷二 · 渡寒江",
     "vol_goal": "扩大世界观 + 引入妖族线 + 反派正式登场",
     "ch_no": 23, "ch_title": "北上渡江", "ch_hook": "换地图"},
    {"vol_no": 2, "vol_name": "卷二 · 渡寒江",
     "vol_goal": "扩大世界观 + 引入妖族线 + 反派正式登场",
     "ch_no": 28, "ch_title": "无相影杀", "ch_hook": "反派登场"},
    {"vol_no": 2, "vol_name": "卷二 · 渡寒江",
     "vol_goal": "扩大世界观 + 引入妖族线 + 反派正式登场",
     "ch_no": 35, "ch_title": "阿箩现身", "ch_hook": "女主线开启"},
    {"vol_no": 2, "vol_name": "卷二 · 渡寒江",
     "vol_goal": "扩大世界观 + 引入妖族线 + 反派正式登场",
     "ch_no": 42, "ch_title": "渊海口的风", "ch_hook": "卷二收束"},
    # 卷三 · 渊海沉璧
    {"vol_no": 3, "vol_name": "卷三 · 渊海沉璧",
     "vol_goal": "金手指升级 + 海族势力交锋 + 剑尊残识苏醒",
     "ch_no": 43, "ch_title": "东海第一夜", "ch_hook": "新地图"},
    {"vol_no": 3, "vol_name": "卷三 · 渊海沉璧",
     "vol_goal": "金手指升级 + 海族势力交锋 + 剑尊残识苏醒",
     "ch_no": 50, "ch_title": "三王议事", "ch_hook": "势力登场"},
    {"vol_no": 3, "vol_name": "卷三 · 渊海沉璧",
     "vol_goal": "金手指升级 + 海族势力交锋 + 剑尊残识苏醒",
     "ch_no": 65, "ch_title": "沉璧现世", "ch_hook": "金手指升级"},
    {"vol_no": 3, "vol_name": "卷三 · 渊海沉璧",
     "vol_goal": "金手指升级 + 海族势力交锋 + 剑尊残识苏醒",
     "ch_no": 80, "ch_title": "剑尊残识", "ch_hook": "卷三大爆点"},
]

# --- 伏笔 ---
# app.py 中 status 为中文，这里映射为 schema 要求的英文
_HOOK_STATUS_MAP = {
    "已回收": "recycled",
    "半回收": "half",
    "已埋设": "planted",
}

_HOOKS = [
    {"hook_id": "H-001", "title": "残剑「问渊」的来历", "status": "已回收",
     "planted_ch": "第 1 章", "recycle_ch": "第 65 章", "priority": "P0",
     "note": "剑骨来自上古剑尊，与卷四神祇故土呼应。"},
    {"hook_id": "H-002", "title": "沈砚身世之谜", "status": "已埋设",
     "planted_ch": "第 3 章", "recycle_ch": "—", "priority": "P0",
     "note": "母亲身份成谜，预计卷四揭穿。"},
    {"hook_id": "H-003", "title": "阿箩的妖族血脉", "status": "半回收",
     "planted_ch": "第 35 章", "recycle_ch": "第 70 章", "priority": "P1",
     "note": "血脉来源尚未明确，预计卷三末揭晓。"},
    {"hook_id": "H-004", "title": "无相门灭门之仇", "status": "已埋设",
     "planted_ch": "第 28 章", "recycle_ch": "—", "priority": "P0",
     "note": "与剑尊因果相关，主线大反派。"},
    {"hook_id": "H-005", "title": "神祇故土的封印", "status": "已埋设",
     "planted_ch": "第 42 章", "recycle_ch": "—", "priority": "P0",
     "note": "卷四入口伏笔。"},
    {"hook_id": "H-006", "title": "剑尊残识的真正目的", "status": "已埋设",
     "planted_ch": "第 80 章", "recycle_ch": "—", "priority": "P0",
     "note": "卷五最终决战的引子。"},
    {"hook_id": "H-007", "title": "寒江底沉剑", "status": "已回收",
     "planted_ch": "第 23 章", "recycle_ch": "第 41 章", "priority": "P2",
     "note": "伏笔铺垫较短，回收自然。"},
]

# --- 爽点 ---
_HIGHLIGHTS = [
    {"ch_no": 1, "name": "剑冢拾剑", "score": 6.0, "type": "金手指登场"},
    {"ch_no": 3, "name": "剑意初生", "score": 7.5, "type": "金手指觉醒"},
    {"ch_no": 5, "name": "斩第一人", "score": 9.0, "type": "打脸爆发"},
    {"ch_no": 12, "name": "外门第一", "score": 8.5, "type": "立威"},
    {"ch_no": 22, "name": "卷一收束·辞山", "score": 7.0, "type": "情绪升华"},
    {"ch_no": 28, "name": "无相影杀", "score": 8.0, "type": "危机"},
    {"ch_no": 35, "name": "阿箩现身", "score": 7.5, "type": "新角色"},
    {"ch_no": 41, "name": "寒江沉剑", "score": 8.8, "type": "金手指升级"},
    {"ch_no": 42, "name": "渊海口立誓", "score": 7.5, "type": "情绪转折"},
    {"ch_no": 50, "name": "三王议事", "score": 7.0, "type": "势力登场"},
    {"ch_no": 65, "name": "沉璧现世", "score": 9.5, "type": "金手指升级"},
    {"ch_no": 80, "name": "剑尊残识苏醒", "score": 10.0, "type": "卷三大爆点"},
]

# --- 人物 ---
_CHARACTERS = [
    {"name": "沈砚", "role": "主角", "identity": "青云宗外门弟子 → 剑修",
     "level": "筑基后期", "personality": "隐忍、清醒、对剑道近乎偏执",
     "arc": "杂役→剑修→叩问天道",
     "relation": "残剑「问渊」持有者；与阿箩羁绊渐深",
     "goal": "寻完整剑骨 / 揭身世 / 问剑天道", "color": "#3b6fb3"},
    {"name": "阿箩", "role": "女主", "identity": "妖族·九尾狐裔",
     "level": "化形中期", "personality": "外冷内热、机敏、护短",
     "arc": "独行妖→同行者→并肩问道",
     "relation": "与沈砚互相救赎；与海族有血缘",
     "goal": "寻血脉真相 / 守护沈砚", "color": "#b33b7a"},
    {"name": "剑尊·问渊", "role": "金手指/引路人", "identity": "上古剑尊残识",
     "level": "—", "personality": "冷漠、寡言、亦师亦敌",
     "arc": "残识苏醒→指路→最终考验",
     "relation": "残剑之灵；沈砚引路人",
     "goal": "完成未竟之战", "color": "#7a3bb3"},
    {"name": "裴矩", "role": "反派", "identity": "无相门·门主",
     "level": "化神初期", "personality": "温文尔雅、阴鸷、记仇",
     "arc": "幕后→浮出水面→终局对手",
     "relation": "无相门灭门案主谋",
     "goal": "取剑骨 / 报世仇", "color": "#b34a3b"},
    {"name": "云栖", "role": "挚友", "identity": "青云宗内门师兄",
     "level": "筑基大圆满", "personality": "爽朗、重情、刚直",
     "arc": "挚友→分歧→决裂",
     "relation": "沈砚入门引路人",
     "goal": "守宗门规矩", "color": "#3bb36f"},
    {"name": "海族·赤蛟王", "role": "卷三反派", "identity": "渊海三王之一",
     "level": "化神中期", "personality": "暴烈、傲慢、重诺",
     "arc": "敌→盟→中立",
     "relation": "渊海势力代表",
     "goal": "守渊海秩序", "color": "#b3863b"},
]

# --- 世界观设定 ---
_WORLD_SETTINGS = [
    {"category": "境界体系",
     "content": "练气 → 筑基 → 金丹 → 元婴 → 化神 → 渡劫 → 大乘。\n"
                "剑修每境可越阶挑战，但破境需以剑意印证，较常人更难。"},
    {"category": "剑道法则",
     "content": "本作核心法则。剑修可通过「剑骨」「剑意」「剑心」三阶印证天道。\n"
                "残剑「问渊」承载上古剑尊未竟之战，是改写剑道法则的关键。"},
    {"category": "天道封印",
     "content": "上古诸神陨落后，天道被改写，神祇故土被封印。\n"
                "唯有剑尊残识可破开一道入口，这也是沈砚被选中的根本原因。"},
    {"category": "势力格局",
     "content": "中州：青云宗、玄都观、儒家书院并立。\n"
                "北荒：无相门隐于暗处。\n"
                "东海：渊海三王分治。\n"
                "天地之外：神祇故土，封印之地。"},
    {"category": "金手指规则",
     "content": "残剑「问渊」可吸收上古剑骨片段，逐步完整。\n"
                "每完整一截剑骨，沈砚获得对应剑尊记忆片段与剑意印证。\n"
                "吸收剑骨需以同等代价交换（伤、业、因果）。"},
    {"category": "爽点曲线",
     "content": "每 5 章一小爽（金手指小升级 / 打脸），每卷末一大爽（境界突破 / 大势力登场）。\n"
                "卷与卷之间以「换地图 + 换反派 + 金手指升级」三件套推进。"},
]


# ===========================================================================
# 灌入逻辑
# ===========================================================================

# 所有需要 drop 的表（含 projects 本身）
# 顺序无所谓，因为 drop 时会临时关闭外键检查
_ALL_TABLES = [
    "chapters", "outlines", "hooks", "highlights",
    "characters", "world_settings", "projects",
]


def _drop_all_tables(conn: sqlite3.Connection) -> None:
    """删除所有已知表。

    临时关闭外键检查以避免级联依赖导致 drop 失败。
    """
    conn.execute("PRAGMA foreign_keys = OFF;")
    for table in _ALL_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table};")
    conn.execute("PRAGMA foreign_keys = ON;")


def _insert_data(conn: sqlite3.Connection) -> int:
    """向已建好表的数据库灌入全部示例数据。

    Args:
        conn: 已启用外键的 sqlite3 连接。

    Returns:
        新插入的项目 id。
    """
    # --- 项目 ---
    cur = conn.execute(
        """INSERT INTO projects
           (name, subtitle, genre, author, target_words, current_words,
            volumes_done, volumes_total, chapters_done, chapters_total,
            status, updated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            _PROJECT["name"], _PROJECT["subtitle"], _PROJECT["genre"],
            _PROJECT["author"], _PROJECT["target_words"], _PROJECT["current_words"],
            _PROJECT["volumes_done"], _PROJECT["volumes_total"],
            _PROJECT["chapters_done"], _PROJECT["chapters_total"],
            _PROJECT["status"], _PROJECT["updated"],
        ),
    )
    project_id = cur.lastrowid

    # --- 章节 ---
    for ch in _CHAPTERS:
        conn.execute(
            """INSERT INTO chapters
               (project_id, vol_no, ch_no, title, content, summary,
                highlights, words, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                project_id, ch["vol_no"], ch["ch_no"], ch["title"],
                "",  # content 留空（示例只灌元信息）
                ch["summary"], ch["highlights"], ch["words"],
                "published",
            ),
        )

    # --- 大纲 ---
    for ol in _OUTLINES:
        conn.execute(
            """INSERT INTO outlines
               (project_id, vol_no, vol_name, vol_goal, ch_no,
                ch_title, ch_hook, ch_summary)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                project_id, ol["vol_no"], ol["vol_name"], ol["vol_goal"],
                ol["ch_no"], ol["ch_title"], ol["ch_hook"], None,
            ),
        )

    # --- 伏笔 ---
    for h in _HOOKS:
        # "—" 表示未回收，转为 None
        recycle_ch = h["recycle_ch"]
        if recycle_ch in ("—", "", "-"):
            recycle_ch = None
        conn.execute(
            """INSERT INTO hooks
               (project_id, hook_id, title, status, planted_ch,
                recycle_ch, priority, note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                project_id, h["hook_id"], h["title"],
                _HOOK_STATUS_MAP.get(h["status"], "planted"),
                h["planted_ch"], recycle_ch, h["priority"], h["note"],
            ),
        )

    # --- 爽点 ---
    for hl in _HIGHLIGHTS:
        conn.execute(
            """INSERT INTO highlights
               (project_id, ch_no, name, score, type)
               VALUES (?, ?, ?, ?, ?)""",
            (project_id, hl["ch_no"], hl["name"], hl["score"], hl["type"]),
        )

    # --- 人物 ---
    for c in _CHARACTERS:
        conn.execute(
            """INSERT INTO characters
               (project_id, name, role, identity, level, personality,
                arc, relation, goal, color)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                project_id, c["name"], c["role"], c["identity"],
                c["level"], c["personality"], c["arc"],
                c["relation"], c["goal"], c["color"],
            ),
        )

    # --- 世界观设定 ---
    for idx, ws in enumerate(_WORLD_SETTINGS):
        conn.execute(
            """INSERT INTO world_settings
               (project_id, category, content, sort_order)
               VALUES (?, ?, ?, ?)""",
            (project_id, ws["category"], ws["content"], idx),
        )

    return project_id


def seed_all(db_path: Optional[str] = None) -> None:
    """重置并灌入全部示例数据。

    执行步骤：
        1. drop 所有已知表
        2. 重新建表（执行 schema.sql）
        3. 灌入示例项目及其关联数据

    Args:
        db_path: 可选，指定数据库文件路径。None 时使用 db.DB_PATH 默认值。
            相对路径按项目根目录解析。
    """
    # 确定数据库路径
    if db_path is None:
        db_path = DB_PATH
    # 相对路径按项目根目录解析
    if not os.path.isabs(db_path):
        db_path = os.path.join(_PROJECT_ROOT, db_path)

    # 自动创建父目录
    parent = os.path.dirname(db_path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)

    # 读取 schema.sql
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    conn = sqlite3.connect(db_path)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")

        # 1. drop 所有表
        _drop_all_tables(conn)
        conn.commit()

        # 2. 建表
        conn.executescript(schema_sql)

        # 3. 灌入数据
        _insert_data(conn)
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    seed_all()
    print("已灌入示例数据")
