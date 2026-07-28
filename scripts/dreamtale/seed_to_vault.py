# -*- coding: utf-8 -*-
"""DreamTale Demo 数据转换脚本。

把归档 ``app_legacy_gradio.py`` 的《问剑长歌》示例数据转成
NovelForge_Vault 格式的 ZIP 文件，以及一个空白项目模板 ZIP。

输出：
    web/static/assets/seed-vault.zip   — 问剑长歌 Demo（1:1 镜像 NovelForge_Vault）
    web/static/assets/blank-vault.zip  — 空白项目模板（完整目录骨架 + 空模板）

生成的 ZIP 可被 ``web/src/storage/zip-utils.js`` 的 ``importVaultFromZip`` 解析：
    - 使用 STORE（method=0）方式，UTF-8 文件名
    - 包含 ``manifest.json``，列出所有可导入文件及其类型
    - 伏笔 JSON 字段已按 hooks_registry.json schema 映射

用法：
    python scripts/dreamtale/seed_to_vault.py
"""

from __future__ import annotations

import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# 路径常量
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_OUTPUT_DIR = _PROJECT_ROOT / "web" / "static" / "assets"

# ===========================================================================
# 示例数据（从 docs/_archive/app_legacy_gradio.py 第 29-347 行迁移）
# ===========================================================================

PROJECT: Dict[str, Any] = {
    "title": "问剑长歌",
    "subtitle": "一个少年握住残剑，走向被遗忘的神祇故土",
    "genre": "东方玄幻 · 长篇网文",
    "author": "DreamTale 工作室",
    "target_words": "1,200,000 字",
    "current_words": "268,400 字",
    "volumes_done": 2,
    "volumes_total": 5,
    "chapters_done": 42,
    "chapters_total": 220,
    "status": "第 3 卷『渊海沉璧』连载中",
    "updated": "2026-07-18",
}

STORY_ARC: List[Dict[str, Any]] = [
    {
        "phase": "卷一 · 锋未鸣",
        "range": "第 1–22 章",
        "summary": "少年沈砚在剑冢拾得残剑「问渊」，初入青云宗外门，被欺凌中觉醒剑意，斩内门考核第一人。",
        "tone": "压抑→爆发",
        "key_event": "剑冢拾剑 / 外门试炼 / 觉醒剑意",
    },
    {
        "phase": "卷二 · 渡寒江",
        "range": "第 23–42 章",
        "summary": "沈砚北上渡寒江，遭「无相门」截杀，结识妖族少女阿箩，揭开残剑与上古剑尊的一段因果。",
        "tone": "惊险→悬念",
        "key_event": "寒江血战 / 阿箩现身 / 残剑共鸣",
    },
    {
        "phase": "卷三 · 渊海沉璧",
        "range": "第 43–80 章",
        "summary": "进入东海渊海寻「沉璧」剑骨，与海族三王交锋，残剑第一次完整出鞘，剑尊残识苏醒。",
        "tone": "壮阔→悲怆",
        "key_event": "渊海入界 / 海族三王 / 剑尊残识苏醒",
    },
    {
        "phase": "卷四 · 神祇故土",
        "range": "第 81–160 章",
        "summary": "前往被遗忘的「神祇故土」，揭穿上古诸神陨落的真相，与昔日挚友决裂。",
        "tone": "沉重→悲壮",
        "key_event": "故土入口 / 诸神遗骸 / 挚友决裂",
    },
    {
        "phase": "卷五 · 问剑长歌",
        "range": "第 161–220 章",
        "summary": "沈砚以残剑叩问天道，重写剑道法则，长歌一曲，万剑归宗。",
        "tone": "悲壮→升华",
        "key_event": "问剑天道 / 万剑归宗 / 长歌收束",
    },
]

CHAPTERS: List[Dict[str, Any]] = [
    {"no": 40, "title": "寒江尽头", "phase": "卷二",
     "summary": "沈砚与阿箩走出寒江，残剑初次显形剑纹。",
     "words": 6200, "highlights": "残剑剑纹"},
    {"no": 41, "title": "无相追杀", "phase": "卷二",
     "summary": "无相门「影杀」再现，沈砚负伤逃入渊海口。",
     "words": 6400, "highlights": "影杀再现"},
    {"no": 42, "title": "渊海口的风", "phase": "卷二",
     "summary": "卷二收束，沈砚望海立誓，卷三伏笔铺设。",
     "words": 6500, "highlights": "卷二收束"},
    {"no": 43, "title": "东海第一夜", "phase": "卷三",
     "summary": "沈砚乘「白鲨舟」入海，遇海族斥候。",
     "words": 6300, "highlights": "白鲨舟"},
    {"no": 44, "title": "沉璧传说", "phase": "卷三",
     "summary": "海族祭司口述「沉璧」剑骨来历。",
     "words": 6100, "highlights": "沉璧来历"},
    {"no": 45, "title": "渊海暗流", "phase": "卷三",
     "summary": "三王势力初现，沈砚被卷入海族内斗。",
     "words": 6600, "highlights": "三王初现"},
]

# phase → vol_no 映射
_PHASE_TO_VOL = {"卷一": 1, "卷二": 2, "卷三": 3, "卷四": 4, "卷五": 5}

MAP_REGIONS: List[Dict[str, Any]] = [
    {"name": "青云宗", "type": "宗门", "location": "中州 · 鹤鸣山",
     "desc": "主角沈砚出身之地。分外门、内门、剑峰，剑冢藏于后山深谷。",
     "importance": "★★★★★"},
    {"name": "寒江", "type": "天险", "location": "中州 / 北荒界河",
     "desc": "南北分界之江，江底沉有上古剑骨，冬结冰桥，夏行水怪。",
     "importance": "★★★★"},
    {"name": "无相门", "type": "暗势力", "location": "北荒 · 隐谷",
     "desc": "专司刺杀的隐秘门派，与上古剑尊有灭门之仇，本作主要反派势力。",
     "importance": "★★★★★"},
    {"name": "渊海", "type": "秘境", "location": "东海极东",
     "desc": "卷三主舞台。海族三王分治：白鲨、玄龟、赤蛟。沉璧剑骨藏于渊心。",
     "importance": "★★★★★"},
    {"name": "神祇故土", "type": "禁地", "location": "天地之外",
     "desc": "上古诸神陨落之地，卷四入口。被天道封印，唯有剑尊残识可引路。",
     "importance": "★★★★★"},
    {"name": "剑冢", "type": "遗迹", "location": "青云宗后山",
     "desc": "万剑归葬之地。残剑「问渊」出土处，剑意凝聚成林。",
     "importance": "★★★★"},
]

OUTLINE: List[Dict[str, Any]] = [
    {
        "vol": "卷一 · 锋未鸣",
        "goal": "主角立人设 + 残剑金手指登场 + 外门冲突爆发",
        "chapters": [
            {"ch": "ch_001", "title": "剑冢拾剑", "hook": "残剑出世"},
            {"ch": "ch_002", "title": "外门杂役", "hook": "立人设"},
            {"ch": "ch_003", "title": "剑意初生", "hook": "金手指觉醒"},
            {"ch": "ch_004", "title": "内门考核", "hook": "首次爆发"},
            {"ch": "ch_005", "title": "斩第一人", "hook": "卷一爆点"},
        ],
    },
    {
        "vol": "卷二 · 渡寒江",
        "goal": "扩大世界观 + 引入妖族线 + 反派正式登场",
        "chapters": [
            {"ch": "ch_023", "title": "北上渡江", "hook": "换地图"},
            {"ch": "ch_028", "title": "无相影杀", "hook": "反派登场"},
            {"ch": "ch_035", "title": "阿箩现身", "hook": "女主线开启"},
            {"ch": "ch_042", "title": "渊海口的风", "hook": "卷二收束"},
        ],
    },
    {
        "vol": "卷三 · 渊海沉璧",
        "goal": "金手指升级 + 海族势力交锋 + 剑尊残识苏醒",
        "chapters": [
            {"ch": "ch_043", "title": "东海第一夜", "hook": "新地图"},
            {"ch": "ch_050", "title": "三王议事", "hook": "势力登场"},
            {"ch": "ch_065", "title": "沉璧现世", "hook": "金手指升级"},
            {"ch": "ch_080", "title": "剑尊残识", "hook": "卷三大爆点"},
        ],
    },
]

HOOKS: List[Dict[str, Any]] = [
    {"id": "H-001", "title": "残剑「问渊」的来历", "status": "已回收",
     "planted_ch": "第 1 章", "recycle_ch": "第 65 章", "priority": "P0",
     "note": "剑骨来自上古剑尊，与卷四神祇故土呼应。"},
    {"id": "H-002", "title": "沈砚身世之谜", "status": "已埋设",
     "planted_ch": "第 3 章", "recycle_ch": "—", "priority": "P0",
     "note": "母亲身份成谜，预计卷四揭穿。"},
    {"id": "H-003", "title": "阿箩的妖族血脉", "status": "半回收",
     "planted_ch": "第 35 章", "recycle_ch": "第 70 章", "priority": "P1",
     "note": "血脉来源尚未明确，预计卷三末揭晓。"},
    {"id": "H-004", "title": "无相门灭门之仇", "status": "已埋设",
     "planted_ch": "第 28 章", "recycle_ch": "—", "priority": "P0",
     "note": "与剑尊因果相关，主线大反派。"},
    {"id": "H-005", "title": "神祇故土的封印", "status": "已埋设",
     "planted_ch": "第 42 章", "recycle_ch": "—", "priority": "P0",
     "note": "卷四入口伏笔。"},
    {"id": "H-006", "title": "剑尊残识的真正目的", "status": "已埋设",
     "planted_ch": "第 80 章", "recycle_ch": "—", "priority": "P0",
     "note": "卷五最终决战的引子。"},
    {"id": "H-007", "title": "寒江底沉剑", "status": "已回收",
     "planted_ch": "第 23 章", "recycle_ch": "第 41 章", "priority": "P2",
     "note": "伏笔铺垫较短，回收自然。"},
]

HIGHLIGHT_CURVE: List[Dict[str, Any]] = [
    {"ch": 1, "name": "剑冢拾剑", "score": 6.0, "type": "金手指登场"},
    {"ch": 3, "name": "剑意初生", "score": 7.5, "type": "金手指觉醒"},
    {"ch": 5, "name": "斩第一人", "score": 9.0, "type": "打脸爆发"},
    {"ch": 12, "name": "外门第一", "score": 8.5, "type": "立威"},
    {"ch": 22, "name": "卷一收束·辞山", "score": 7.0, "type": "情绪升华"},
    {"ch": 28, "name": "无相影杀", "score": 8.0, "type": "危机"},
    {"ch": 35, "name": "阿箩现身", "score": 7.5, "type": "新角色"},
    {"ch": 41, "name": "寒江沉剑", "score": 8.8, "type": "金手指升级"},
    {"ch": 42, "name": "渊海口立誓", "score": 7.5, "type": "情绪转折"},
    {"ch": 50, "name": "三王议事", "score": 7.0, "type": "势力登场"},
    {"ch": 65, "name": "沉璧现世", "score": 9.5, "type": "金手指升级"},
    {"ch": 80, "name": "剑尊残识苏醒", "score": 10.0, "type": "卷三大爆点"},
]

CHARACTERS: List[Dict[str, Any]] = [
    {"name": "沈砚", "role": "主角",
     "identity": "青云宗外门弟子 → 剑修",
     "level": "筑基后期",
     "personality": "隐忍、清醒、对剑道近乎偏执",
     "arc": "杂役→剑修→叩问天道",
     "relation": "残剑「问渊」持有者；与阿箩羁绊渐深",
     "goal": "寻完整剑骨 / 揭身世 / 问剑天道",
     "color": "#3b6fb3"},
    {"name": "阿箩", "role": "女主",
     "identity": "妖族·九尾狐裔", "level": "化形中期",
     "personality": "外冷内热、机敏、护短",
     "arc": "独行妖→同行者→并肩问道",
     "relation": "与沈砚互相救赎；与海族有血缘",
     "goal": "寻血脉真相 / 守护沈砚", "color": "#b33b7a"},
    {"name": "剑尊·问渊", "role": "金手指/引路人",
     "identity": "上古剑尊残识", "level": "—",
     "personality": "冷漠、寡言、亦师亦敌",
     "arc": "残识苏醒→指路→最终考验",
     "relation": "残剑之灵；沈砚引路人",
     "goal": "完成未竟之战", "color": "#7a3bb3"},
    {"name": "裴矩", "role": "反派",
     "identity": "无相门·门主", "level": "化神初期",
     "personality": "温文尔雅、阴鸷、记仇",
     "arc": "幕后→浮出水面→终局对手",
     "relation": "无相门灭门案主谋",
     "goal": "取剑骨 / 报世仇", "color": "#b34a3b"},
    {"name": "云栖", "role": "挚友",
     "identity": "青云宗内门师兄", "level": "筑基大圆满",
     "personality": "爽朗、重情、刚直",
     "arc": "挚友→分歧→决裂",
     "relation": "沈砚入门引路人",
     "goal": "守宗门规矩", "color": "#3bb36f"},
    {"name": "海族·赤蛟王", "role": "卷三反派",
     "identity": "渊海三王之一", "level": "化神中期",
     "personality": "暴烈、傲慢、重诺",
     "arc": "敌→盟→中立",
     "relation": "渊海势力代表",
     "goal": "守渊海秩序", "color": "#b3863b"},
]

WORLD_SETTINGS: List[Dict[str, Any]] = [
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

# 角色文件名映射（task 指定的简化文件名 → 源数据角色名）
_CHARACTER_FILES = [
    ("protagonist.md", CHARACTERS[0]),
    ("阿箩.md", CHARACTERS[1]),
    ("剑尊问渊.md", CHARACTERS[2]),
    ("裴矩.md", CHARACTERS[3]),
    ("云栖.md", CHARACTERS[4]),
    ("赤蛟王.md", CHARACTERS[5]),
]

# 卷号 → 章节范围（用于推断 expected_resolve_vol）
_VOL_CH_RANGES = [(1, 22, 1), (23, 42, 2), (43, 80, 3), (81, 160, 4), (161, 220, 5)]


# ===========================================================================
# 辅助函数
# ===========================================================================

def _pad_vol(n: int) -> str:
    """卷号补零为 2 位字符串。"""
    return f"{int(n):02d}"


def _pad_ch(n: int) -> str:
    """章号补零为 3 位字符串。"""
    return f"{int(n):03d}"


def _extract_ch_num(s: str) -> int:
    """从 "第 65 章" 提取章号 65；无法解析返回 0。"""
    m = re.search(r"(\d+)", str(s))
    return int(m.group(1)) if m else 0


def _ch_to_vol(ch_num: int) -> int:
    """章号 → 卷号；无法判断返回 0。"""
    for lo, hi, vol in _VOL_CH_RANGES:
        if lo <= ch_num <= hi:
            return vol
    return 0


def _infer_payoff_type(note: str) -> str:
    """根据伏笔备注推断 payoff_type。"""
    if any(k in note for k in ("回扣", "铺垫", "呼应")):
        return "callback"
    if any(k in note for k in ("反转", "背叛", "决裂")):
        return "twist"
    if any(k in note for k in ("升级", "觉醒", "突破", "苏醒")):
        return "powerup"
    if any(k in note for k in ("情感", "救赎", "羁绊")):
        return "emotional"
    return "reveal"


def _infer_related_characters(title: str, note: str) -> List[str]:
    """根据伏笔标题/备注推断关联角色。"""
    text = title + note
    related = []
    if "沈砚" in text or "身世" in text or "残剑" in text or "寒江" in text:
        related.append("沈砚")
    if "阿箩" in text or "血脉" in text:
        related.append("阿箩")
    if "剑尊" in text or "问渊" in text:
        related.append("剑尊·问渊")
    if "无相门" in text or "裴矩" in text:
        related.append("裴矩")
    return related


# --- 伏笔字段映射 ---

_HOOK_STATUS_MAP = {"已回收": "resolved", "已埋设": "planted", "半回收": "hinted"}
_HOOK_PRIORITY_MAP = {"P0": "high", "P1": "medium", "P2": "low"}
_HOOK_SCOPE_MAP = {"P0": "core", "P1": "long", "P2": "short"}
_HOOK_STRENGTH_MAP = {"high": "strong", "medium": "medium", "low": "weak"}


def _map_hook(h: Dict[str, Any]) -> Dict[str, Any]:
    """把 app.py 的 HOOKS 字段映射为 hooks_registry.json schema。"""
    priority = _HOOK_PRIORITY_MAP.get(h["priority"], "medium")
    status = _HOOK_STATUS_MAP.get(h["status"], "planted")
    planted_num = _extract_ch_num(h["planted_ch"])
    recycle_raw = h.get("recycle_ch", "—")
    target_ch = h["planted_ch"] if False else None  # placeholder
    # target_resolve_ch：保持 "第 N 章" 字符串格式，"—" → null
    if recycle_raw and recycle_raw not in ("—", "-", ""):
        target_resolve_ch = recycle_raw
        expected_vol = _ch_to_vol(_extract_ch_num(recycle_raw))
    else:
        target_resolve_ch = None
        expected_vol = 0

    return {
        "hook_id": h["id"],
        "description": h["title"],
        "planted_ch": h["planted_ch"],  # 保持 "第 N 章" 字符串格式
        "scope": _HOOK_SCOPE_MAP.get(h["priority"], "short"),
        "status": status,
        "target_resolve_ch": target_resolve_ch,
        "expected_resolve_vol": expected_vol,
        "related_characters": _infer_related_characters(h["title"], h.get("note", "")),
        "priority": priority,
        "strength": _HOOK_STRENGTH_MAP.get(priority, "medium"),
        "payoff_type": _infer_payoff_type(h.get("note", "")),
        "emotional_valence": "positive" if status == "resolved" else (
            "bittersweet" if status == "hinted" else "neutral"),
        "reminder_chapters": [],
        "last_reminder_ch": None,
        "next_reminder_due_ch": None,
        "dependencies": [],
        "resolution_note": h.get("note", ""),
    }


def _build_hooks_registry() -> Dict[str, Any]:
    """构建 hooks_registry.json 完整对象（含 _comment 头）。"""
    return {
        "_comment": "NovelForge 伏笔追踪表。每条伏笔记录埋设/提示/回收的全生命周期。由 hook_auditor Skill 维护，禁止手动编辑。",
        "_comment_scope": "scope 枚举：short=卷内回收 / long=跨卷回收 / core=全书级",
        "_comment_status": "status 枚举：planted=已埋设 → hinted=已提示 → resolved=已回收 / abandoned=已放弃",
        "_comment_strength": "strength 枚举：strong=强伏笔（必回收）/ medium=中等 / weak=弱伏笔（可放弃，但需登记）",
        "_comment_payoff_type": "payoff_type 枚举：reveal=揭示 / twist=反转 / powerup=能力解锁 / emotional=情感冲击 / callback=回扣前文",
        "_comment_emotional_valence": "emotional_valence 枚举：positive=正向爽感 / negative=负面冲击 / bittersweet=苦甜交织",
        "_comment_priority": "priority 枚举：high=高优先级（必回收且不能延期）/ medium / low",
        "_comment_reminder": "reminder_chapters 记录所有提示过的章号；next_reminder_due_ch 由 hook_auditor 计算下次该提示的章号",
        "_comment_dependencies": "dependencies 记录依赖的其他 hook_id，必须先回收依赖才能回收本条",
        "version": "1.0.0",
        "hooks": [_map_hook(h) for h in HOOKS],
    }


# ===========================================================================
# 文件内容生成函数
# ===========================================================================

def _build_project_json() -> Dict[str, Any]:
    """从 PROJECT 构建 project.json（对齐 Project.toJSON schema）。"""
    # 解析字数字符串为整数
    target_words = int(re.sub(r"[^\d]", "", str(PROJECT["target_words"])) or 0)
    current_words = int(re.sub(r"[^\d]", "", str(PROJECT["current_words"])) or 0)
    return {
        "id": "wenjian-changge",
        "name": PROJECT["title"],
        "subtitle": PROJECT["subtitle"],
        "genre": PROJECT["genre"],
        "author": PROJECT["author"],
        "target_words": target_words,
        "current_words": current_words,
        "volumes_done": PROJECT["volumes_done"],
        "volumes_total": PROJECT["volumes_total"],
        "chapters_done": PROJECT["chapters_done"],
        "chapters_total": PROJECT["chapters_total"],
        "status": PROJECT["status"],
        "updated": PROJECT["updated"],
        "created_at": "2026-01-01",
    }


def _build_volume_json(vol_entry: Dict[str, Any], sort_order: int) -> Dict[str, Any]:
    """从 OUTLINE 条目构建 vol_meta.json（对齐 Volume.toJSON schema）。"""
    vol_name = vol_entry["vol"]
    # 从 "卷一 · 锋未鸣" 提取卷号
    m = re.search(r"卷(\S+?)\s*·", vol_name)
    vol_cn = m.group(1) if m else "一"
    vol_no = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5}.get(vol_cn, sort_order + 1)
    return {
        "vol_no": _pad_vol(vol_no),
        "vol_name": vol_name,
        "vol_goal": vol_entry["goal"],
        "sort_order": sort_order,
    }


def _build_chapter_md(ch: Dict[str, Any]) -> str:
    """从 CHAPTERS 条目构建章节 Markdown（对齐 chapterToMarkdown 格式）。"""
    vol_no = _PHASE_TO_VOL.get(ch["phase"], 1)
    ch_no = ch["no"]
    highlights = [ch["highlights"]] if ch.get("highlights") else []
    lines = [
        "---",
        f'vol_no: "{_pad_vol(vol_no)}"',
        f'ch_no: "{_pad_ch(ch_no)}"',
        f'title: "{ch["title"]}"',
        f'status: "published"',
        f'updated_at: "{PROJECT["updated"]}"',
        f'words: {ch["words"]}',
        f'project: "{PROJECT["title"]}"',
        "---",
        "",
        f"# 第 {ch_no} 章 · {ch['title']}",
        "",
        f"> 摘要：{ch['summary']}",
        "",
    ]
    if highlights:
        lines.append("## 金句")
        for h in highlights:
            lines.append(f"> {h}")
        lines.append("")
    # content 留空（Demo 无正文）
    return "\n".join(lines)


def _build_character_md(c: Dict[str, Any]) -> str:
    """从 CHARACTERS 条目构建角色 Markdown（对齐 buildCharacterMarkdown 格式）。"""
    return "\n".join([
        "---",
        f'name: "{c["name"]}"',
        f'role: "{c["role"]}"',
        f'identity: "{c["identity"]}"',
        f'level: "{c["level"]}"',
        f'color: "{c["color"]}"',
        "---",
        "",
        f"# {c['name']}",
        "",
        "## 性格",
        c.get("personality") or "（暂无）",
        "",
        "## 弧光",
        c.get("arc") or "（暂无）",
        "",
        "## 关系",
        c.get("relation") or "（暂无）",
        "",
        "## 目标",
        c.get("goal") or "（暂无）",
        "",
    ])


def _build_world_setting_md(category: str, content: str, sort_order: int) -> str:
    """构建世界设定 Markdown（对齐 buildWorldSettingMarkdown 格式）。"""
    return "\n".join([
        "---",
        f'category: "{category}"',
        f"sort_order: {sort_order}",
        "---",
        "",
        f"# {category}",
        "",
        content,
        "",
    ])


def _build_core_rules_content() -> str:
    """合并 境界体系 + 剑道法则 + 天道封印 为 core_rules 内容。"""
    parts = []
    for cat in ("境界体系", "剑道法则", "天道封印"):
        for ws in WORLD_SETTINGS:
            if ws["category"] == cat:
                parts.append(f"【{cat}】\n{ws['content']}")
                break
    return "\n\n".join(parts)


def _build_factions_content() -> str:
    """从 势力格局 提取内容。"""
    for ws in WORLD_SETTINGS:
        if ws["category"] == "势力格局":
            return ws["content"]
    return ""


def _build_geography_content() -> str:
    """从 MAP_REGIONS 构建地理设定内容。"""
    parts = []
    for r in MAP_REGIONS:
        parts.append(
            f"【{r['name']}】（{r['type']}）{r['location']}\n"
            f"{r['desc']}\n"
            f"重要性：{r['importance']}"
        )
    return "\n\n".join(parts)


def _build_items_content() -> str:
    """从 金手指规则 提取内容。"""
    for ws in WORLD_SETTINGS:
        if ws["category"] == "金手指规则":
            return ws["content"]
    return ""


def _build_ch_outline_md(vol_no: int, ch_entry: Dict[str, Any], vol_goal: str) -> str:
    """从 OUTLINE 章节条目构建章纲十段模板。"""
    ch_str = ch_entry["ch"]  # "ch_001"
    ch_num = int(re.search(r"(\d+)", ch_str).group(1))
    title = ch_entry["title"]
    hook = ch_entry["hook"]

    # 章节类型推断
    if ch_num == 1:
        ch_type = "vol_start"
    elif ch_num in (42, 80, 160, 220):
        ch_type = "climax"
    elif ch_num in (22, 42):
        ch_type = "transition"
    else:
        ch_type = "regular"

    # 找到本章埋设的伏笔
    planted = []
    for h in HOOKS:
        if _extract_ch_num(h["planted_ch"]) == ch_num:
            planted.append(h)

    # 找到本章回收的伏笔
    resolved = []
    for h in HOOKS:
        if h.get("recycle_ch") and _extract_ch_num(h["recycle_ch"]) == ch_num:
            resolved.append(h)

    # 爽点
    climax_score = 0
    for hl in HIGHLIGHT_CURVE:
        if hl["ch"] == ch_num:
            climax_score = int(hl["score"] / 2)  # 0-10 → 0-5
            break

    lines = [
        f"# 章纲：ch_{_pad_ch(ch_num)} · {title}",
        "",
        "> 本文件是单章的「细纲」，writer 按此扩写正文，polisher 按此校验。",
        "> 由 architect Skill 生成，hook_auditor 校验伏笔，context_composer 据此拼装上下文。",
        "",
        "---",
        "",
        "## 一、章基本信息",
        "",
        f"- **章号**：ch_{_pad_ch(ch_num)}",
        f"- **卷号**：vol_{_pad_vol(vol_no)}",
        f"- **章标题**：{title}",
        f"- **章节类型**：{ch_type}",
        f"- **字数目标**：6000 字",
        "- **POV**：主角（第三人称限知）",
        "",
        "---",
        "",
        "## 二、场景列表",
        "",
        "### 场景 1",
        "",
        "- **地点**：____",
        "- **时间**：____",
        "- **出场角色**：沈砚",
        f"- **核心动作**：{hook}",
        f"- **场景目的**：____",
        "",
        "---",
        "",
        "## 三、核心冲突",
        "",
        f"> {hook}",
        "",
        "---",
        "",
        "## 四、出场角色",
        "",
        "| 角色 | 身份 | 本章作用 | 状态锚点文件 |",
        "|---|---|---|---|",
        "| 沈砚 | protagonist | ____ | `.state/characters/protagonist.json` |",
        "",
        "---",
        "",
        "## 五、伏笔埋设",
        "",
        "| 伏笔 ID | 一句话描述 | scope | 目标回收章 |",
        "|---|---|---|---|",
    ]
    if planted:
        for h in planted:
            mapped = _map_hook(h)
            lines.append(
                f"| {mapped['hook_id']} | {mapped['description']} | "
                f"{mapped['scope']} | {mapped['target_resolve_ch'] or '—'} |"
            )
    else:
        lines.append("| （空） | | | |")
    lines += [
        "",
        "---",
        "",
        "## 六、伏笔回收",
        "",
        "| 伏笔 ID | 来自章 | 回收方式 | 是否符合预期 |",
        "|---|---|---|---|",
    ]
    if resolved:
        for h in resolved:
            lines.append(
                f"| {h['id']} | {h['planted_ch']} | {h['note']} | 是 |"
            )
    else:
        lines.append("| （空） | | | |")
    lines += [
        "",
        "---",
        "",
        "## 七、章末钩子",
        "",
        f"- **钩子类型**：{'悬念' if ch_type == 'climax' else '伏笔提示'}",
        f"- **钩子内容**：{hook}",
        "",
        "---",
        "",
        "## 八、must-keep / must-avoid",
        "",
        "### 8.1 must-keep",
        "",
        f"- [ ] {hook} 必须在本章完成",
        "- [ ] 保持主角性格一致性",
        "",
        "### 8.2 must-avoid",
        "",
        "- [ ] 避免金手指越级",
        "",
        "---",
        "",
        "## 九、节奏预算",
        "",
        f"- **爽点等级**：1-5（本章 {climax_score}）",
        f"- **压抑等级**：1-5（本章 {max(1, 5 - climax_score)})",
        f"- **金句预留**：{hook}",
        "",
        "---",
        "",
        "## 十、上下文召回",
        "",
        "- `00_控制面/author_intent.md`（L0 摘要）",
        "- `02_角色/protagonist.md`",
        "- `01_世界观/core_rules.md`",
        "",
        "---",
        "",
        "## 十一、修订历史",
        "",
        "| 日期 | 修订内容 |",
        "|---|---|",
        f"| {PROJECT['updated']} | 初版（DreamTale Demo 自动生成） |",
        "",
    ]
    return "\n".join(lines)


def _build_vol_outline_md(vol_entry: Dict[str, Any]) -> str:
    """从 OUTLINE 卷条目构建卷大纲。"""
    lines = [
        f"# {vol_entry['vol']} · 卷大纲",
        "",
        "> 本文件是单卷的「卷纲」，architect 据此拆分章纲。",
        "",
        "---",
        "",
        "## 一、卷目标",
        "",
        f"{vol_entry['goal']}",
        "",
        "---",
        "",
        "## 二、章节列表",
        "",
        "| 章号 | 章标题 | 核心钩子 |",
        "|---|---|---|",
    ]
    for ch in vol_entry["chapters"]:
        lines.append(f"| {ch['ch']} | {ch['title']} | {ch['hook']} |")
    lines += [
        "",
        "---",
        "",
        "## 三、修订历史",
        "",
        "| 日期 | 修订内容 |",
        "|---|---|",
        f"| {PROJECT['updated']} | 初版（DreamTale Demo 自动生成） |",
        "",
    ]
    return "\n".join(lines)


def _build_master_outline_md() -> str:
    """从 STORY_ARC 构建总大纲。"""
    lines = [
        f"# {PROJECT['title']} · 总大纲",
        "",
        "> 本文件是全书的「总纲」，architect 据此拆分卷纲与章纲。",
        "",
        "---",
        "",
        "## 一、作品概要",
        "",
        f"- **作品名**：{PROJECT['title']}",
        f"- **副标题**：{PROJECT['subtitle']}",
        f"- **类型**：{PROJECT['genre']}",
        f"- **目标字数**：{PROJECT['target_words']}",
        f"- **卷数**：{PROJECT['volumes_total']}",
        f"- **总章数**：{PROJECT['chapters_total']}",
        "",
        "---",
        "",
        "## 二、五卷弧光",
        "",
    ]
    for i, arc in enumerate(STORY_ARC, 1):
        lines += [
            f"### {arc['phase']}（{arc['range']}）",
            "",
            f"- **基调**：{arc['tone']}",
            f"- **关键事件**：{arc['key_event']}",
            f"- **梗概**：{arc['summary']}",
            "",
        ]
    lines += [
        "---",
        "",
        "## 三、修订历史",
        "",
        "| 日期 | 修订内容 |",
        "|---|---|",
        f"| {PROJECT['updated']} | 初版（DreamTale Demo 自动生成） |",
        "",
    ]
    return "\n".join(lines)


def _build_story_arc_md() -> str:
    """从 STORY_ARC 构建故事弧光文档。"""
    lines = [
        "# 故事弧光（story_arc）",
        "",
        "> 本文件记录全书五卷的弧光阶段，architect 据此把控全局节奏。",
        "",
        "---",
        "",
    ]
    for i, arc in enumerate(STORY_ARC, 1):
        cur = " **（当前）**" if arc["phase"].startswith("卷三") else ""
        lines += [
            f"## 阶段 {i}：{arc['phase']}{cur}",
            "",
            f"- **章节范围**：{arc['range']}",
            f"- **基调**：{arc['tone']}",
            f"- **关键事件**：{arc['key_event']}",
            f"- **梗概**：{arc['summary']}",
            "",
        ]
    return "\n".join(lines)


def _build_author_intent_md() -> str:
    """从 STORY_ARC 提炼作者意图。"""
    tones = " → ".join(a["tone"] for a in STORY_ARC)
    lines = [
        "# 作者意图（author_intent）",
        "",
        "> 本文件是作者意图的全局锚点，所有 Skill 必读。",
        "> 分为 L0 摘要（300 字以内）与 L1 详述。architect/writer/polisher 不得偏离本文件。",
        "",
        "---",
        "",
        "## L0 摘要",
        "",
        f"- **作品名**：{PROJECT['title']}",
        f"- **类型**：{PROJECT['genre']}",
        f"- **核心脑洞**：{PROJECT['subtitle']}",
        f"- **主角弧光**：{CHARACTERS[0]['arc']}",
        f"- **风格基调**：{tones}",
        f"- **目标字数**：{PROJECT['target_words']}",
        "",
        "---",
        "",
        "## L1 详述",
        "",
        "### 世界观核心",
        "",
        "少年沈砚在剑冢拾得残剑「问渊」，由此踏入修仙世界。残剑承载上古剑尊未竟之战，"
        "沈砚需收集散落各地的剑骨片段，逐步揭开剑尊往事与神祇故土的真相。",
        "",
        "### 主角弧光",
        "",
        f"- **表层动机**：{CHARACTERS[0]['goal']}",
        "- **深层动机**：在被欺凌中证明自己存在的价值",
        "- **隐藏动机**：与上古剑尊的因果羁绊（卷四揭示）",
        "",
        "### 爽点曲线",
        "",
        "每 5 章一小爽（金手指小升级 / 打脸），每卷末一大爽（境界突破 / 大势力登场）。"
        "卷与卷之间以「换地图 + 换反派 + 金手指升级」三件套推进。",
        "",
    ]
    return "\n".join(lines)


def _build_current_focus_md() -> str:
    """自动生成当前创作焦点。"""
    lines = [
        "# 当前创作焦点（current_focus）",
        "",
        "> 本文件记录当前正在处理的卷/章进度、待处理伏笔、本轮创作焦点。",
        "> 每次 state_update 后由 save_state.py 自动刷新。",
        "",
        "---",
        "",
        "## 一、进度",
        "",
        f"- **当前卷**：vol_03",
        f"- **当前章**：ch_046（下一章待写）",
        f"- **已完成章数**：{PROJECT['chapters_done']} / {PROJECT['chapters_total']}",
        f"- **已完成卷数**：{PROJECT['volumes_done']} / {PROJECT['volumes_total']}",
        f"- **状态**：{PROJECT['status']}",
        "",
        "---",
        "",
        "## 二、本卷目标",
        "",
        f"{STORY_ARC[2]['summary']}",
        "",
        "---",
        "",
        "## 三、待处理伏笔",
        "",
        "| 伏笔 ID | 描述 | 优先级 | 状态 |",
        "|---|---|---|---|",
    ]
    for h in HOOKS:
        if h["status"] != "已回收":
            mapped = _map_hook(h)
            lines.append(
                f"| {mapped['hook_id']} | {mapped['description']} | "
                f"{mapped['priority']} | {mapped['status']} |"
            )
    lines += [
        "",
        "---",
        "",
        "## 四、本轮焦点",
        "",
        "- 推进卷三「渊海沉璧」剧情：海族三王势力交锋。",
        "- 第 65 章「沉璧现世」是卷三中段核心爆点（强度 9.5）。",
        "- 第 80 章「剑尊残识苏醒」是卷三末大爆点（强度 10.0），为卷四铺路。",
        "",
    ]
    return "\n".join(lines)


def _build_master_index_md() -> str:
    """自动生成全局索引。"""
    lines = [
        "# 全局索引（master_index）",
        "",
        f"> {PROJECT['title']} · NovelForge Vault 全局文件索引。",
        "",
        "---",
        "",
        "## 00_控制面",
        "- project.json — 项目元信息",
        "- author_intent.md — 作者意图（L0 摘要 + L1 详述）",
        "- current_focus.md — 当前创作焦点",
        "- master_index.md — 本文件",
        "",
        "## 01_世界观",
        "- core_rules.md — 核心法则（境界体系 + 剑道法则 + 天道封印）",
        "- factions.md — 势力格局",
        "- geography.md — 地理设定",
        "- items_and_concepts.md — 金手指规则",
        "",
        "## 02_角色",
    ]
    for fname, c in _CHARACTER_FILES:
        lines.append(f"- {fname} — {c['name']}（{c['role']}）")
    lines += [
        "",
        "## 03_素材库",
        "- inspirations.md — 灵感碎片",
        "- names_and_places.md — 姓名与地名索引",
        "- plot_devices.md — 情节装置",
        "- writing_techniques.md — 写作技法",
        "",
        "## 04_大纲与脉络",
        "- master_outline.md — 总大纲",
        "- story_arc.md — 故事弧光",
        "- hooks_registry.json — 伏笔登记表",
        "- vol_01/ — 卷一大纲 + 章纲",
        "- vol_02/ — 卷二大纲 + 章纲",
        "- vol_03/ — 卷三大纲 + 章纲",
        "",
        "## 05_正文",
        "- drafts/ — 草稿",
        "- published/ — 已发布",
        "",
        "## .state/",
        "- pipeline.json — 流水线状态",
        "- protagonist.json — 主角状态机",
        "- hooks_registry.json — 伏笔状态（镜像）",
        "- power_curve.json — 金手指强度曲线",
        "- rhythm_curve.json — 节奏曲线",
        "- context_budget.json — 上下文预算",
        "- world_timeline.json — 世界时间线",
        "- chapter_length_history.json — 章节字数历史",
        "- characters_index.md — 角色索引",
        "- state_update_log.json — 状态更新日志",
        "",
    ]
    return "\n".join(lines)


def _build_names_and_places_md() -> str:
    """从 MAP_REGIONS 提取姓名与地名索引。"""
    lines = [
        "# 姓名与地名索引（names_and_places）",
        "",
        "> 本文件记录作品中出现的所有角色姓名与地名，供 writer 查阅避免命名冲突。",
        "",
        "---",
        "",
        "## 地名",
        "",
        "| 名称 | 类型 | 位置 | 重要性 |",
        "|---|---|---|---|",
    ]
    for r in MAP_REGIONS:
        lines.append(f"| {r['name']} | {r['type']} | {r['location']} | {r['importance']} |")
    lines += [
        "",
        "## 人名",
        "",
        "| 姓名 | 角色 | 身份 |",
        "|---|---|---|",
    ]
    for _, c in _CHARACTER_FILES:
        lines.append(f"| {c['name']} | {c['role']} | {c['identity']} |")
    lines.append("")
    return "\n".join(lines)


def _build_protagonist_state() -> Dict[str, Any]:
    """从 CHARACTERS[0] 构建主角状态机 JSON。"""
    c = CHARACTERS[0]
    return {
        "_comment": "主角状态模板。所有动态字段由 state_update Skill 通过 save_state.py 维护，禁止手动 Edit。",
        "_comment_basic": "basic 段为半静态信息，仅在角色档案变更时更新",
        "_comment_location": "location 段记录主角当前位置，recent_trajectory 保留最近 5 个位置",
        "_comment_power_level": "power_level.realm 对应 core_rules.md 的境界表",
        "_comment_inventory": "inventory 记录主角持有的关键物品",
        "_comment_emotion": "emotion.current 是当前情绪关键词；baseline 是主角默认情绪底色",
        "_comment_relationships": "relationships 每条记录：对方角色ID、关系类型、当前态度值 -100~100",
        "_comment_knowledge": "knowledge 区分已知/未知/误解",
        "_comment_goals": "goals.short_term 是本章/本卷目标；long_term 是全书目标",
        "_comment_language_fingerprint": "语言指纹与 style_guide.md 附录 B 一致",
        "_comment_arc_stage": "arc_stage 对应 protagonist.md 的弧光阶段表",
        "character_id": "protagonist",
        "basic": {
            "name": c["name"],
            "aliases": [],
            "role": "protagonist",
            "age": None,
            "appearance_keywords": [],
        },
        "location": {
            "current": "渊海口",
            "last_updated_ch": 42,
            "recent_trajectory": ["青云宗", "寒江", "渊海口"],
        },
        "power_level": {
            "realm": c["level"],
            "realm_progress": 70,
            "abilities": ["剑意初生", "残剑共鸣"],
            "limitations": ["境界不足", "残剑未完整"],
            "next_breakthrough": {
                "target_realm": "金丹期",
                "condition": "寻得沉璧剑骨，剑意印证",
                "expected_ch": 65,
            },
        },
        "inventory": [
            {"name": "残剑「问渊」", "type": "武器", "note": "金手指，可吸收剑骨片段"},
        ],
        "emotion": {
            "current": "坚定",
            "last_updated_ch": 42,
            "recent_arc": [
                {"ch": 40, "emotion": "警觉"},
                {"ch": 41, "emotion": "伤痛"},
                {"ch": 42, "emotion": "坚定"},
            ],
            "baseline": c["personality"],
        },
        "relationships": [
            {"character_id": "阿箩", "type": "同伴", "attitude": 80, "last_change_ch": 42},
            {"character_id": "剑尊·问渊", "type": "引路人", "attitude": 30, "last_change_ch": 42},
            {"character_id": "裴矩", "type": "宿敌", "attitude": -80, "last_change_ch": 28},
            {"character_id": "云栖", "type": "挚友", "attitude": 60, "last_change_ch": 1},
        ],
        "knowledge": {
            "known_facts": ["残剑可吸收剑骨", "无相门是宿敌"],
            "unknown_facts": ["母亲身份", "神祇故土真相", "剑尊真正目的"],
            "misconceptions": [],
        },
        "unresolved_personal_arcs": [
            {"arc": "寻母", "goal": "揭穿身世之谜", "progress": 0.3},
            {"arc": "复仇", "goal": "了结无相门灭门之仇", "progress": 0.2},
        ],
        "goals": {
            "short_term": "寻沉璧剑骨",
            "long_term": c["goal"],
            "secret_goal": "改写剑道法则",
        },
        "language_fingerprint": {
            "avg_sentence_length": 12,
            "preferred_words": ["剑", "道", "心"],
            "catchphrases": [],
            "forbidden_words": [],
            "address_habits": {},
        },
        "arc_stage": c["arc"],
        "last_appeared_ch": 42,
        "first_appear_ch": 1,
        "status": "active",
    }


def _build_power_curve() -> Dict[str, Any]:
    """从 HIGHLIGHT_CURVE 构建 power_curve.json。"""
    chapters = []
    for h in HIGHLIGHT_CURVE:
        chapters.append({
            "ch": h["ch"],
            "level": h["score"],
            "bottleneck": h["score"] < 8.0,
            "note": f"{h['name']}（{h['type']}）",
        })
    return {
        "_comment": "金手指强度曲线。追踪主角金手指在每章的强度等级，防止战力崩坏。",
        "_comment_purpose": "state_update 每章追加一条记录；alert_rules 触发告警时 hook_auditor 介入。",
        "_comment_chapters_entry": "chapters 数组每条含：ch=章号 / level=金手指强度1-10 / bottleneck=是否有瓶颈 / note=备注",
        "_comment_alert_rules": "alert_rules.consecutive_no_bottleneck=连续N章无瓶颈则告警；single_chapter_jump=单章强度跳变超过N级则告警",
        "chapters": chapters,
        "alert_rules": {
            "consecutive_no_bottleneck": 3,
            "single_chapter_jump": 1,
        },
    }


def _build_rhythm_curve() -> Dict[str, Any]:
    """自动生成 rhythm_curve.json。"""
    chapters = []
    for h in HIGHLIGHT_CURVE:
        chapters.append({
            "ch": h["ch"],
            "satisfaction": min(5, int(h["score"] / 2)),
            "suppression": max(1, 5 - int(h["score"] / 2)),
            "note": h["name"],
        })
    return {
        "_comment": "节奏曲线。追踪每章爽点等级与压抑等级，防止节奏失衡。",
        "_comment_purpose": "state_update 每章追加一条；alert_rules 触发告警时 architect 介入调整下章章纲。",
        "_comment_chapters_entry": "chapters 数组每条含：ch=章号 / satisfaction=爽点等级1-5 / suppression=压抑等级1-5 / note=备注",
        "_comment_alert_rules": "alert_rules.consecutive_low_satisfaction=连续N章爽点≤2则告警；consecutive_high_suppression=连续N章压抑≥4则告警",
        "chapters": chapters,
        "alert_rules": {
            "consecutive_low_satisfaction": 3,
            "consecutive_high_suppression": 3,
        },
    }


def _build_context_budget() -> Dict[str, Any]:
    """自动生成 context_budget.json。"""
    return {
        "_comment": "上下文预算配置。定义不同章节类型在调用 LLM 时可使用的上下文窗口大小（token 数）。",
        "_comment_purpose": "context_composer Skill 按本配置拼装提示词，避免超窗或浪费。",
        "_comment_default_budget": "default_budget 是常规章节默认 token 预算",
        "_comment_by_chapter_type": "by_chapter_type 按章节类型覆盖默认值",
        "_comment_l0_injection": "l0_injection=true 表示始终注入 author_intent.md 的 L0 摘要",
        "_comment_l1_scene_recall": "l1_scene_recall=on_demand 表示按需召回 _scenes/",
        "default_budget": 8000,
        "by_chapter_type": {
            "regular": 8000,
            "hook_resolve": 10000,
            "vol_start": 12000,
            "climax": 12000,
            "transition": 6000,
        },
        "l0_injection": True,
        "l1_scene_recall": "on_demand",
    }


def _build_world_timeline() -> Dict[str, Any]:
    """从 STORY_ARC 构建 world_timeline.json。"""
    events = []
    for i, arc in enumerate(STORY_ARC, 1):
        ch_match = re.search(r"(\d+)", arc["range"])
        first_ch = int(ch_match.group(1)) if ch_match else 0
        events.append({
            "event_id": f"W-{i:03d}",
            "world_date": "",
            "chapter_anchor": first_ch,
            "event_type": "world",
            "description": arc["key_event"],
            "related_characters": ["沈砚"],
            "impact": arc["summary"],
        })
    return {
        "_comment": "世界时间线。记录小说世界中发生的大事件，按世界时间排序。由 state_update Skill 维护。",
        "_comment_purpose": "避免时间线穿帮，处理跨卷时间跨度。",
        "_comment_era": "era 是世界纪元，world_date 是该纪元下的具体日期/时段",
        "_comment_chapter_anchor": "chapter_anchor 是事件对应的章号",
        "_comment_event_type": "event_type 枚举：character=角色相关 / faction=势力相关 / world=世界级 / foreshadow=伏笔事件",
        "version": "1.0.0",
        "era": "",
        "current_world_date": "",
        "events": events,
    }


def _build_pipeline() -> Dict[str, Any]:
    """自动生成 pipeline.json。"""
    return {
        "_comment": "当前章节流水线状态。记录正在处理的章节在哪个 Skill 阶段。",
        "_comment_purpose": "writer/polisher 等 Skill 启动前先读本文件确认当前阶段，避免重复执行或跳阶段。",
        "_comment_mode": "mode 枚举：novel=长篇网文 / shortform=公众号短文",
        "_comment_current_stage": "current_stage 枚举：idle=空闲 / architect=章纲生成 / hook_auditor=伏笔校验 / context_composer=上下文拼装 / writer=正文生成 / polisher=润色 / state_update=状态落地",
        "_comment_stages": "stages 是完整流水线阶段顺序，state_update 完成后回到 idle 等待下一章",
        "_comment_history": "history 记录最近 N 章的流水线执行轨迹",
        "current_chapter": 42,
        "current_volume": 3,
        "mode": "novel",
        "current_stage": "idle",
        "stages": [
            "architect", "hook_auditor", "context_composer",
            "writer", "polisher", "state_update",
        ],
        "history": [],
        "last_recap_chapter": 40,
        "last_drift_check_chapter": 40,
        "archived_scenes": [],
        "last_consistency_check_chapter": 42,
    }


def _build_chapter_length_history() -> Dict[str, Any]:
    """自动生成 chapter_length_history.json。"""
    chapters = []
    for ch in CHAPTERS:
        vol_no = _PHASE_TO_VOL.get(ch["phase"], 1)
        chapters.append({
            "ch": ch["no"],
            "vol": vol_no,
            "word_count": ch["words"],
            "target": 6000,
            "mode": "novel",
        })
    return {
        "_comment": "章节字数历史。记录每章实际成稿字数，用于均值计算与节奏控制。",
        "_comment_purpose": "architect 写新章纲时参考最近 N 章均值设定字数目标；polisher 校验成稿字数。",
        "_comment_chapters_entry": "chapters 数组每条含：ch=章号 / vol=卷号 / word_count=字数 / target=目标字数 / mode=novel|shortform",
        "version": "1.0.0",
        "chapters": chapters,
    }


def _build_state_update_log() -> Dict[str, Any]:
    """自动生成 state_update_log.json。"""
    return {
        "_comment": "状态更新日志。记录每次 save_state.py 执行的 delta，用于审计与回滚。",
        "_comment_purpose": "排查状态不一致时按本日志定位是哪次更新引入的问题。",
        "_comment_log_entry": "logs 数组每条含：log_id=自增ID / timestamp=ISO时间 / chapter=涉及章号 / target_file=被更新的JSON / delta_summary=变更摘要 / trigger_skill=触发更新的Skill",
        "version": "1.0.0",
        "logs": [
            {
                "log_id": 1,
                "timestamp": f"{PROJECT['updated']}T12:00:00",
                "chapter": "ch_042",
                "ops_count": 1,
                "files_changed": [
                    ".state/characters/protagonist.json",
                    ".state/power_curve.json",
                ],
                "summary": "DreamTale Demo 初始化：导入问剑长歌示例数据",
            },
        ],
    }


def _build_characters_index() -> str:
    """自动生成 characters_index.md。"""
    lines = [
        "# 角色索引（characters_index）",
        "",
        "> 本文件由 save_state.py 自动生成，禁止手动编辑。",
        "",
        "---",
        "",
        "## 角色清单",
        "",
        "| name | role | location.current | status | last_appeared_ch | filename |",
        "|---|---|---|---|---|---|",
        "| 沈砚 | protagonist | 渊海口 | active | 42 | `protagonist.json` |",
        "",
        "---",
        "",
        f"> 最后更新：{PROJECT['updated']}（DreamTale Demo 自动生成）",
        "",
    ]
    return "\n".join(lines)


# ===========================================================================
# manifest 构建
# ===========================================================================

def _build_manifest(project_id: str, file_entries: List[Dict[str, str]]) -> Dict[str, Any]:
    """构建 manifest.json。"""
    return {
        "version": "1.0.0",
        "exported_at": datetime.now().isoformat(),
        "project_id": project_id,
        "files": file_entries,
    }


# ===========================================================================
# ZIP 写入
# ===========================================================================

def _write_zip(files: Dict[str, bytes], output_path: Path) -> int:
    """把 {path: content} 写入 ZIP 文件。

    使用 ZIP_STORED（method=0），UTF-8 文件名，与 zip-utils.js parseZip 兼容。

    Returns:
        写入的文件数。
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_STORED) as zf:
        for path, data in files.items():
            # 确保数据是 bytes
            if isinstance(data, str):
                data = data.encode("utf-8")
            zf.writestr(path, data)
            count += 1
    return count


# ===========================================================================
# seed-vault.zip 构建
# ===========================================================================

def _build_seed_files() -> Tuple[Dict[str, bytes], List[Dict[str, str]]]:
    """构建问剑长歌 Demo 的所有文件。

    Returns:
        (files_dict, manifest_entries)
        files_dict: {path: content_bytes}
        manifest_entries: [{path, type}] 供 manifest 使用
    """
    files: Dict[str, bytes] = {}
    manifest_entries: List[Dict[str, str]] = []

    def add(path: str, content: Any, mtype: Optional[str] = None,
            extra: Optional[Dict[str, str]] = None) -> None:
        """添加文件到 files dict，可选登记到 manifest。"""
        if isinstance(content, (dict, list)):
            content = json.dumps(content, ensure_ascii=False, indent=2)
        if isinstance(content, str):
            content = content.encode("utf-8")
        files[path] = content
        if mtype:
            entry = {"path": path, "type": mtype}
            if extra:
                entry.update(extra)
            manifest_entries.append(entry)

    # --- 00_控制面 ---
    project_json = _build_project_json()
    add("00_控制面/project.json", project_json, "project")
    add("00_控制面/author_intent.md", _build_author_intent_md())
    add("00_控制面/current_focus.md", _build_current_focus_md())
    add("00_控制面/master_index.md", _build_master_index_md())

    # --- 01_世界观 ---
    add("01_世界观/core_rules.md",
        _build_world_setting_md("core_rules", _build_core_rules_content(), 1),
        "world_setting")
    add("01_世界观/factions.md",
        _build_world_setting_md("factions", _build_factions_content(), 2),
        "world_setting")
    add("01_世界观/geography.md",
        _build_world_setting_md("geography", _build_geography_content(), 3),
        "world_setting")
    add("01_世界观/items_and_concepts.md",
        _build_world_setting_md("items_and_concepts", _build_items_content(), 4),
        "world_setting")

    # --- 02_角色 ---
    for fname, c in _CHARACTER_FILES:
        add(f"02_角色/{fname}", _build_character_md(c), "character")

    # --- 03_素材库 ---
    add("03_素材库/inspirations.md",
        "# 灵感碎片（inspirations）\n\n> 暂无灵感记录。\n")
    add("03_素材库/names_and_places.md", _build_names_and_places_md())
    add("03_素材库/plot_devices.md",
        "# 情节装置（plot_devices）\n\n> 暂无情节装置记录。\n")
    add("03_素材库/writing_techniques.md",
        "# 写作技法（writing_techniques）\n\n> 暂无写作技法记录。\n")

    # --- 04_大纲与脉络 ---
    add("04_大纲与脉络/master_outline.md", _build_master_outline_md())
    add("04_大纲与脉络/story_arc.md", _build_story_arc_md())

    hooks_registry = _build_hooks_registry()
    add("04_大纲与脉络/hooks_registry.json", hooks_registry, "hooks")

    for vol_idx, vol_entry in enumerate(OUTLINE):
        vol_json = _build_volume_json(vol_entry, vol_idx)
        vol_no_str = vol_json["vol_no"]  # "01", "02", "03"
        vol_no_int = int(vol_no_str)
        vol_dir = f"04_大纲与脉络/vol_{vol_no_str}"

        # vol_meta.json（供 importVault 解析卷数据）
        add(f"{vol_dir}/vol_meta.json", vol_json, "volume")
        # vol_outline.md（NovelForge_Vault 规范文件）
        add(f"{vol_dir}/vol_outline.md", _build_vol_outline_md(vol_entry))

        # 章纲
        for ch_entry in vol_entry["chapters"]:
            ch_num = int(re.search(r"(\d+)", ch_entry["ch"]).group(1))
            ch_outline = _build_ch_outline_md(vol_no_int, ch_entry, vol_entry["goal"])
            add(f"{vol_dir}/ch_{_pad_ch(ch_num)}_outline.md", ch_outline)

    # --- 05_正文 ---
    # drafts/ 空目录
    add("05_正文/drafts/", b"")
    # published 章节
    for ch in CHAPTERS:
        vol_no = _PHASE_TO_VOL.get(ch["phase"], 1)
        ch_path = f"05_正文/published/vol_{_pad_vol(vol_no)}/ch_{_pad_ch(ch['no'])}.md"
        add(ch_path, _build_chapter_md(ch), "chapter",
            extra={"status": "published"})

    # --- 空目录 ---
    add("06_短文/", b"")
    add("06_审计/", b"")
    add("_recaps/", b"")
    add("_scenes/", b"")

    # --- .state ---
    protagonist_state = _build_protagonist_state()
    add(".state/pipeline.json", _build_pipeline())
    add(".state/protagonist.json", protagonist_state)
    add(".state/hooks_registry.json", hooks_registry)  # 镜像
    add(".state/power_curve.json", _build_power_curve())
    add(".state/rhythm_curve.json", _build_rhythm_curve())
    add(".state/context_budget.json", _build_context_budget())
    add(".state/world_timeline.json", _build_world_timeline())
    add(".state/chapter_length_history.json", _build_chapter_length_history())
    add(".state/characters_index.md", _build_characters_index())
    add(".state/state_update_log.json", _build_state_update_log())
    add(".state/characters/protagonist.json", protagonist_state)

    return files, manifest_entries


def build_seed_zip() -> Path:
    """构建并写入 seed-vault.zip。"""
    files, manifest_entries = _build_seed_files()
    project_json = _build_project_json()
    manifest = _build_manifest(project_json["id"], manifest_entries)
    files["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")

    output = _OUTPUT_DIR / "seed-vault.zip"
    count = _write_zip(files, output)
    print(f"  seed-vault.zip: {count} 个文件 → {output.relative_to(_PROJECT_ROOT)}")
    return output


# ===========================================================================
# blank-vault.zip 构建
# ===========================================================================

def _build_blank_files() -> Tuple[Dict[str, bytes], List[Dict[str, str]]]:
    """构建空白项目模板的所有文件。"""
    files: Dict[str, bytes] = {}
    manifest_entries: List[Dict[str, str]] = []

    def add(path: str, content: Any, mtype: Optional[str] = None) -> None:
        if isinstance(content, (dict, list)):
            content = json.dumps(content, ensure_ascii=False, indent=2)
        if isinstance(content, str):
            content = content.encode("utf-8")
        files[path] = content
        if mtype:
            manifest_entries.append({"path": path, "type": mtype})

    # 空白项目
    blank_project = {
        "id": "blank-project",
        "name": "新建项目",
        "subtitle": "",
        "genre": "",
        "author": "",
        "target_words": 0,
        "current_words": 0,
        "volumes_done": 0,
        "volumes_total": 0,
        "chapters_done": 0,
        "chapters_total": 0,
        "status": "draft",
        "updated": datetime.now().strftime("%Y-%m-%d"),
        "created_at": datetime.now().strftime("%Y-%m-%d"),
    }
    add("00_控制面/project.json", blank_project, "project")
    add("00_控制面/author_intent.md",
        "# 作者意图（author_intent）\n\n> 请填写作者意图全局锚点。\n")
    add("00_控制面/current_focus.md",
        "# 当前创作焦点（current_focus）\n\n> 请填写当前创作焦点。\n")
    add("00_控制面/master_index.md",
        "# 全局索引（master_index）\n\n> 请填写全局文件索引。\n")

    # 世界观空模板
    for i, cat in enumerate(["core_rules", "factions", "geography", "items_and_concepts"], 1):
        add(f"01_世界观/{cat}.md",
            _build_world_setting_md(cat, "（暂无内容，请填写）", i),
            "world_setting")

    # 角色空模板
    add("02_角色/protagonist.md",
        _build_character_md({
            "name": "主角", "role": "protagonist", "identity": "",
            "level": "", "personality": "", "arc": "", "relation": "",
            "goal": "", "color": "#3b6fb3",
        }), "character")

    # 素材库空模板
    for fname in ["inspirations", "names_and_places", "plot_devices", "writing_techniques"]:
        add(f"03_素材库/{fname}.md",
            f"# {fname}\n\n> 暂无记录。\n")

    # 大纲空模板
    add("04_大纲与脉络/master_outline.md",
        "# 总大纲（master_outline）\n\n> 请填写总大纲。\n")
    add("04_大纲与脉络/story_arc.md",
        "# 故事弧光（story_arc）\n\n> 请填写故事弧光。\n")
    empty_hooks = {
        "_comment": "NovelForge 伏笔追踪表。",
        "_comment_scope": "scope 枚举：short=卷内回收 / long=跨卷回收 / core=全书级",
        "_comment_status": "status 枚举：planted=已埋设 → hinted=已提示 → resolved=已回收 / abandoned=已放弃",
        "_comment_strength": "strength 枚举：strong=强伏笔 / medium=中等 / weak=弱伏笔",
        "_comment_payoff_type": "payoff_type 枚举：reveal / twist / powerup / emotional / callback",
        "_comment_emotional_valence": "emotional_valence 枚举：positive / negative / bittersweet",
        "_comment_priority": "priority 枚举：high / medium / low",
        "_comment_reminder": "reminder_chapters 记录所有提示过的章号",
        "_comment_dependencies": "dependencies 记录依赖的其他 hook_id",
        "version": "1.0.0",
        "hooks": [],
    }
    add("04_大纲与脉络/hooks_registry.json", empty_hooks, "hooks")

    # 正文空目录
    add("05_正文/drafts/", b"")
    add("05_正文/published/", b"")

    # 空目录
    add("06_短文/", b"")
    add("06_审计/", b"")
    add("_recaps/", b"")
    add("_scenes/", b"")

    # .state 空模板
    add(".state/pipeline.json", _build_pipeline())
    blank_protagonist = _build_protagonist_state()
    # 清空 demo 数据
    blank_protagonist["basic"]["name"] = ""
    blank_protagonist["location"]["current"] = ""
    blank_protagonist["location"]["last_updated_ch"] = 0
    blank_protagonist["location"]["recent_trajectory"] = []
    blank_protagonist["power_level"]["realm"] = ""
    blank_protagonist["power_level"]["abilities"] = []
    blank_protagonist["power_level"]["next_breakthrough"] = {}
    blank_protagonist["inventory"] = []
    blank_protagonist["emotion"]["current"] = ""
    blank_protagonist["emotion"]["recent_arc"] = []
    blank_protagonist["emotion"]["baseline"] = ""
    blank_protagonist["relationships"] = []
    blank_protagonist["knowledge"] = {"known_facts": [], "unknown_facts": [], "misconceptions": []}
    blank_protagonist["unresolved_personal_arcs"] = []
    blank_protagonist["goals"] = {"short_term": "", "long_term": "", "secret_goal": ""}
    blank_protagonist["arc_stage"] = ""
    blank_protagonist["last_appeared_ch"] = 0
    blank_protagonist["first_appear_ch"] = 0
    blank_protagonist["current_chapter"] = 0
    blank_protagonist["current_volume"] = 1

    add(".state/protagonist.json", blank_protagonist)
    add(".state/hooks_registry.json", empty_hooks)
    add(".state/power_curve.json", {
        "_comment": "金手指强度曲线。",
        "chapters": [],
        "alert_rules": {"consecutive_no_bottleneck": 3, "single_chapter_jump": 1},
    })
    add(".state/rhythm_curve.json", {
        "_comment": "节奏曲线。",
        "chapters": [],
        "alert_rules": {"consecutive_low_satisfaction": 3, "consecutive_high_suppression": 3},
    })
    add(".state/context_budget.json", _build_context_budget())
    add(".state/world_timeline.json", {
        "_comment": "世界时间线。",
        "version": "1.0.0", "era": "", "current_world_date": "", "events": [],
    })
    add(".state/chapter_length_history.json", {
        "_comment": "章节字数历史。",
        "version": "1.0.0", "chapters": [],
    })
    add(".state/characters_index.md",
        "# 角色索引（characters_index）\n\n> 暂无角色。\n")
    add(".state/state_update_log.json", {
        "_comment": "状态更新日志。",
        "version": "1.0.0", "logs": [],
    })
    add(".state/characters/protagonist.json", blank_protagonist)

    return files, manifest_entries


def build_blank_zip() -> Path:
    """构建并写入 blank-vault.zip。"""
    files, manifest_entries = _build_blank_files()
    manifest = _build_manifest("blank-project", manifest_entries)
    files["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")

    output = _OUTPUT_DIR / "blank-vault.zip"
    count = _write_zip(files, output)
    print(f"  blank-vault.zip: {count} 个文件 → {output.relative_to(_PROJECT_ROOT)}")
    return output


# ===========================================================================
# 校验
# ===========================================================================

def _validate_zip(zip_path: Path) -> Dict[str, Any]:
    """校验 ZIP 文件的可导入性。

    检查项：
        1. manifest.json 存在且 JSON 合法
        2. manifest.files 中每条记录的 path 在 ZIP 中存在
        3. hooks_registry.json（如有）每条 hook 含必填字段
        4. project.json（如有）含必填字段
        5. ZIP 使用 STORE 方式（method=0）

    Returns:
        校验报告 dict。
    """
    report = {
        "zip": str(zip_path.relative_to(_PROJECT_ROOT)),
        "total_entries": 0,
        "manifest_ok": False,
        "manifest_files_count": 0,
        "missing_files": [],
        "hooks_valid": False,
        "hooks_count": 0,
        "hooks_missing_fields": [],
        "project_valid": False,
        "project_missing_fields": [],
        "all_store_method": False,
        "errors": [],
    }

    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        report["total_entries"] = len(names)

        # 检查所有条目使用 STORE
        non_store = [i for i in zf.infolist() if i.compress_type != zipfile.ZIP_STORED]
        report["all_store_method"] = len(non_store) == 0
        if non_store:
            report["errors"].append(
                f"非 STORE 方式的条目: {[i.filename for i in non_store[:3]]}")

        # 读 manifest
        if "manifest.json" not in names:
            report["errors"].append("缺少 manifest.json")
            return report
        try:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            report["manifest_ok"] = True
        except Exception as e:
            report["errors"].append(f"manifest.json 解析失败: {e}")
            return report

        # 检查 manifest.files 中的 path 都存在
        mfiles = manifest.get("files", [])
        report["manifest_files_count"] = len(mfiles)
        for entry in mfiles:
            p = entry.get("path", "")
            if p and p not in names:
                report["missing_files"].append(p)

        # 校验 hooks_registry.json
        hooks_entry = next(
            (e for e in mfiles if e.get("type") == "hooks"), None)
        if hooks_entry:
            hp = hooks_entry["path"]
            if hp in names:
                try:
                    reg = json.loads(zf.read(hp).decode("utf-8"))
                    hooks = reg.get("hooks", [])
                    report["hooks_count"] = len(hooks)
                    required = {"hook_id", "description", "status", "planted_ch",
                                "scope", "priority", "strength", "payoff_type"}
                    missing_all = []
                    for h in hooks:
                        miss = required - set(h.keys())
                        if miss:
                            missing_all.append(
                                f"{h.get('hook_id', '?')}: {miss}")
                    report["hooks_missing_fields"] = missing_all
                    report["hooks_valid"] = len(missing_all) == 0
                except Exception as e:
                    report["errors"].append(f"hooks_registry.json 解析失败: {e}")

        # 校验 project.json
        proj_entry = next(
            (e for e in mfiles if e.get("type") == "project"), None)
        if proj_entry:
            pp = proj_entry["path"]
            if pp in names:
                try:
                    proj = json.loads(zf.read(pp).decode("utf-8"))
                    required_p = {"id", "name", "target_words", "chapters_total"}
                    miss = required_p - set(proj.keys())
                    report["project_missing_fields"] = list(miss)
                    report["project_valid"] = len(miss) == 0
                except Exception as e:
                    report["errors"].append(f"project.json 解析失败: {e}")

    return report


# ===========================================================================
# 主入口
# ===========================================================================

def main() -> None:
    """生成 seed-vault.zip 和 blank-vault.zip 并校验。"""
    print("DreamTale Demo 数据转换")
    print("=" * 60)

    # 生成
    print("\n[1] 生成 ZIP 文件：")
    seed_path = build_seed_zip()
    blank_path = build_blank_zip()

    # 校验
    print("\n[2] 校验 ZIP 文件：")
    for label, path in [("seed-vault.zip", seed_path), ("blank-vault.zip", blank_path)]:
        report = _validate_zip(path)
        print(f"\n  --- {label} ---")
        print(f"  ZIP 条目数: {report['total_entries']}")
        print(f"  manifest 合法: {'✓' if report['manifest_ok'] else '✗'}")
        print(f"  manifest 文件数: {report['manifest_files_count']}")
        print(f"  缺失文件: {len(report['missing_files'])}")
        if report['missing_files']:
            print(f"    → {report['missing_files'][:5]}")
        print(f"  伏笔校验: {'✓' if report['hooks_valid'] else '✗'}"
              f"（{report['hooks_count']} 条）")
        if report['hooks_missing_fields']:
            for m in report['hooks_missing_fields'][:3]:
                print(f"    → {m}")
        print(f"  项目校验: {'✓' if report['project_valid'] else '✗'}")
        if report['project_missing_fields']:
            print(f"    → 缺少字段: {report['project_missing_fields']}")
        print(f"  STORE 方式: {'✓' if report['all_store_method'] else '✗'}")
        if report['errors']:
            print(f"  错误: {report['errors']}")

    print("\n" + "=" * 60)
    print("完成。")


if __name__ == "__main__":
    main()
