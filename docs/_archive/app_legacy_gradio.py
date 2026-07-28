# -*- coding: utf-8 -*-
"""DreamTale · 小说创作后台首页

魔搭 ModelScope Studio 入口应用。
提供小说创作项目的总览与各模块可视化展示，包括：
- 总览（项目元信息 + 进度 + 爽点曲线）
- 故事线（章节时间轴 + 阶段说明）
- 地图（地理设定 + 文字地图）
- 大纲（卷→章纲树）
- 埋坑点（伏笔登记表）
- 爽点（爽点曲线 + 爽点列表）
- 人物卡片（角色档案）
- 设定（世界观 / 规则 / 势力）
"""

from __future__ import annotations

import textwrap
from typing import List, Dict, Any

import gradio as gr


# ===========================================================================
# 示例数据：以一部虚构玄幻小说《问剑长歌》为样本
#   所有数据均为本地示例，可在后续接入 NovelForge Vault 真实数据。
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
    {"no": 40, "title": "寒江尽头", "phase": "卷二", "summary": "沈砚与阿箩走出寒江，残剑初次显形剑纹。", "words": 6200, "highlights": "残剑剑纹"},
    {"no": 41, "title": "无相追杀", "phase": "卷二", "summary": "无相门「影杀」再现，沈砚负伤逃入渊海口。", "words": 6400, "highlights": "影杀再现"},
    {"no": 42, "title": "渊海口的风", "phase": "卷二", "summary": "卷二收束，沈砚望海立誓，卷三伏笔铺设。", "words": 6500, "highlights": "卷二收束"},
    {"no": 43, "title": "东海第一夜", "phase": "卷三", "summary": "沈砚乘「白鲨舟」入海，遇海族斥候。", "words": 6300, "highlights": "白鲨舟"},
    {"no": 44, "title": "沉璧传说", "phase": "卷三", "summary": "海族祭司口述「沉璧」剑骨来历。", "words": 6100, "highlights": "沉璧来历"},
    {"no": 45, "title": "渊海暗流", "phase": "卷三", "summary": "三王势力初现，沈砚被卷入海族内斗。", "words": 6600, "highlights": "三王初现"},
]

MAP_REGIONS: List[Dict[str, Any]] = [
    {
        "name": "青云宗",
        "type": "宗门",
        "location": "中州 · 鹤鸣山",
        "desc": "主角沈砚出身之地。分外门、内门、剑峰，剑冢藏于后山深谷。",
        "importance": "★★★★★",
    },
    {
        "name": "寒江",
        "type": "天险",
        "location": "中州 / 北荒界河",
        "desc": "南北分界之江，江底沉有上古剑骨，冬结冰桥，夏行水怪。",
        "importance": "★★★★",
    },
    {
        "name": "无相门",
        "type": "暗势力",
        "location": "北荒 · 隐谷",
        "desc": "专司刺杀的隐秘门派，与上古剑尊有灭门之仇，本作主要反派势力。",
        "importance": "★★★★★",
    },
    {
        "name": "渊海",
        "type": "秘境",
        "location": "东海极东",
        "desc": "卷三主舞台。海族三王分治：白鲨、玄龟、赤蛟。沉璧剑骨藏于渊心。",
        "importance": "★★★★★",
    },
    {
        "name": "神祇故土",
        "type": "禁地",
        "location": "天地之外",
        "desc": "上古诸神陨落之地，卷四入口。被天道封印，唯有剑尊残识可引路。",
        "importance": "★★★★★",
    },
    {
        "name": "剑冢",
        "type": "遗迹",
        "location": "青云宗后山",
        "desc": "万剑归葬之地。残剑「问渊」出土处，剑意凝聚成林。",
        "importance": "★★★★",
    },
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
    {
        "id": "H-001",
        "title": "残剑「问渊」的来历",
        "status": "已回收",
        "planted_ch": "第 1 章",
        "recycle_ch": "第 65 章",
        "priority": "P0",
        "note": "剑骨来自上古剑尊，与卷四神祇故土呼应。",
    },
    {
        "id": "H-002",
        "title": "沈砚身世之谜",
        "status": "已埋设",
        "planted_ch": "第 3 章",
        "recycle_ch": "—",
        "priority": "P0",
        "note": "母亲身份成谜，预计卷四揭穿。",
    },
    {
        "id": "H-003",
        "title": "阿箩的妖族血脉",
        "status": "半回收",
        "planted_ch": "第 35 章",
        "recycle_ch": "第 70 章",
        "priority": "P1",
        "note": "血脉来源尚未明确，预计卷三末揭晓。",
    },
    {
        "id": "H-004",
        "title": "无相门灭门之仇",
        "status": "已埋设",
        "planted_ch": "第 28 章",
        "recycle_ch": "—",
        "priority": "P0",
        "note": "与剑尊因果相关，主线大反派。",
    },
    {
        "id": "H-005",
        "title": "神祇故土的封印",
        "status": "已埋设",
        "planted_ch": "第 42 章",
        "recycle_ch": "—",
        "priority": "P0",
        "note": "卷四入口伏笔。",
    },
    {
        "id": "H-006",
        "title": "剑尊残识的真正目的",
        "status": "已埋设",
        "planted_ch": "第 80 章",
        "recycle_ch": "—",
        "priority": "P0",
        "note": "卷五最终决战的引子。",
    },
    {
        "id": "H-007",
        "title": "寒江底沉剑",
        "status": "已回收",
        "planted_ch": "第 23 章",
        "recycle_ch": "第 41 章",
        "recycle_ch_text": "第 41 章",
        "priority": "P2",
        "note": "伏笔铺垫较短，回收自然。",
    },
]

# 爽点：章节号 → 爽点强度（0–10）
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
    {
        "name": "沈砚",
        "role": "主角",
        "identity": "青云宗外门弟子 → 剑修",
        "level": "筑基后期",
        "personality": "隐忍、清醒、对剑道近乎偏执",
        "arc": "杂役→剑修→叩问天道",
        "relation": "残剑「问渊」持有者；与阿箩羁绊渐深",
        "goal": "寻完整剑骨 / 揭身世 / 问剑天道",
        "color": "#3b6fb3",
    },
    {
        "name": "阿箩",
        "role": "女主",
        "identity": "妖族·九尾狐裔",
        "level": "化形中期",
        "personality": "外冷内热、机敏、护短",
        "arc": "独行妖→同行者→并肩问道",
        "relation": "与沈砚互相救赎；与海族有血缘",
        "goal": "寻血脉真相 / 守护沈砚",
        "color": "#b33b7a",
    },
    {
        "name": "剑尊·问渊",
        "role": "金手指/引路人",
        "identity": "上古剑尊残识",
        "level": "—",
        "personality": "冷漠、寡言、亦师亦敌",
        "arc": "残识苏醒→指路→最终考验",
        "relation": "残剑之灵；沈砚引路人",
        "goal": "完成未竟之战",
        "color": "#7a3bb3",
    },
    {
        "name": "裴矩",
        "role": "反派",
        "identity": "无相门·门主",
        "level": "化神初期",
        "personality": "温文尔雅、阴鸷、记仇",
        "arc": "幕后→浮出水面→终局对手",
        "relation": "无相门灭门案主谋",
        "goal": "取剑骨 / 报世仇",
        "color": "#b34a3b",
    },
    {
        "name": "云栖",
        "role": "挚友",
        "identity": "青云宗内门师兄",
        "level": "筑基大圆满",
        "personality": "爽朗、重情、刚直",
        "arc": "挚友→分歧→决裂",
        "relation": "沈砚入门引路人",
        "goal": "守宗门规矩",
        "color": "#3bb36f",
    },
    {
        "name": "海族·赤蛟王",
        "role": "卷三反派",
        "identity": "渊海三王之一",
        "level": "化神中期",
        "personality": "暴烈、傲慢、重诺",
        "arc": "敌→盟→中立",
        "relation": "渊海势力代表",
        "goal": "守渊海秩序",
        "color": "#b3863b",
    },
]

WORLD_SETTINGS: List[Dict[str, Any]] = [
    {
        "category": "境界体系",
        "content": "练气 → 筑基 → 金丹 → 元婴 → 化神 → 渡劫 → 大乘。\n剑修每境可越阶挑战，但破境需以剑意印证，较常人更难。",
    },
    {
        "category": "剑道法则",
        "content": "本作核心法则。剑修可通过「剑骨」「剑意」「剑心」三阶印证天道。\n残剑「问渊」承载上古剑尊未竟之战，是改写剑道法则的关键。",
    },
    {
        "category": "天道封印",
        "content": "上古诸神陨落后，天道被改写，神祇故土被封印。\n唯有剑尊残识可破开一道入口，这也是沈砚被选中的根本原因。",
    },
    {
        "category": "势力格局",
        "content": "中州：青云宗、玄都观、儒家书院并立。\n北荒：无相门隐于暗处。\n东海：渊海三王分治。\n天地之外：神祇故土，封印之地。",
    },
    {
        "category": "金手指规则",
        "content": "残剑「问渊」可吸收上古剑骨片段，逐步完整。\n每完整一截剑骨，沈砚获得对应剑尊记忆片段与剑意印证。\n吸收剑骨需以同等代价交换（伤、业、因果）。",
    },
    {
        "category": "爽点曲线",
        "content": "每 5 章一小爽（金手指小升级 / 打脸），每卷末一大爽（境界突破 / 大势力登场）。\n卷与卷之间以「换地图 + 换反派 + 金手指升级」三件套推进。",
    },
]


# ===========================================================================
# 工具函数
# ===========================================================================

def _progress_pct(done: int, total: int) -> int:
    return int(round(done / total * 100)) if total else 0


def plot_highlight_curve() -> str:
    """爽点强度曲线图（纯 SVG，浏览器渲染中文，避免 matplotlib 字体问题）。"""
    pts = HIGHLIGHT_CURVE
    chs = [p["ch"] for p in pts]
    scores = [p["score"] for p in pts]
    ch_min, ch_max = min(chs), max(chs)
    sc_min, sc_max = 0, 11
    W, H = 1100, 380
    PAD_L, PAD_R, PAD_T, PAD_B = 56, 30, 30, 50
    pw = W - PAD_L - PAD_R
    ph = H - PAD_T - PAD_B

    def x(c: float) -> float:
        return PAD_L + (c - ch_min) / (ch_max - ch_min) * pw if ch_max > ch_min else PAD_L

    def y(s: float) -> float:
        return PAD_T + (1 - (s - sc_min) / (sc_max - sc_min)) * ph

    # 网格线（横线 0/2/4/6/8/10）
    grid = []
    for gs in range(0, 11, 2):
        gy = y(gs)
        grid.append(
            f'<line x1="{PAD_L}" y1="{gy}" x2="{W - PAD_R}" y2="{gy}" '
            f'stroke="#243049" stroke-width="1" stroke-dasharray="4 4"/>'
            f'<text x="{PAD_L - 8}" y="{gy + 4}" text-anchor="end" '
            f'fill="#a8b3c8" font-size="11">{gs}</text>'
        )

    # 填充区域
    fill_pts = " ".join(f"{x(c)},{y(s)}" for c, s in zip(chs, scores))
    fill_path = f'<polygon points="{PAD_L},{y(0)} {fill_pts} {x(chs[-1])},{y(0)}" ' \
                f'fill="#e0a93b" fill-opacity="0.18"/>'

    # 折线
    line_path = "M " + " L ".join(f"{x(c)},{y(s)}" for c, s in zip(chs, scores))

    # 节点 + 高分标注
    nodes = []
    for p in pts:
        cx, cy = x(p["ch"]), y(p["score"])
        if p["score"] >= 9.0:
            nodes.append(
                f'<circle cx="{cx}" cy="{cy}" r="7" fill="#ffd86b" '
                f'stroke="#e0a93b" stroke-width="2"/>'
                f'<text x="{cx}" y="{cy - 14}" text-anchor="middle" '
                f'fill="#ffd86b" font-size="12" font-weight="bold">'
                f'{p["name"]} {p["score"]:.1f}</text>'
            )
        else:
            nodes.append(
                f'<circle cx="{cx}" cy="{cy}" r="5" fill="#fff3d6" '
                f'stroke="#e0a93b" stroke-width="2"/>'
            )

    # X 轴章节号
    x_labels = []
    for p in pts:
        cx = x(p["ch"])
        x_labels.append(
            f'<text x="{cx}" y="{H - 18}" text-anchor="middle" '
            f'fill="#a8b3c8" font-size="11">{p["ch"]}</text>'
        )

    svg = f"""
    <svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg"
         style="width:100%;border-radius:12px;background:#0f1626;
                box-shadow:0 6px 24px rgba(0,0,0,.35);display:block;">
      <text x="{W / 2}" y="20" text-anchor="middle" fill="#e8eefc"
            font-size="14" font-weight="bold">爽点强度曲线（卷一—卷三）</text>
      {''.join(grid)}
      {fill_path}
      <path d="{line_path}" fill="none" stroke="#e0a93b" stroke-width="2.4"/>
      {''.join(nodes)}
      {''.join(x_labels)}
      <text x="{PAD_L}" y="{H - 4}" fill="#a8b3c8" font-size="11">章节号 →</text>
    </svg>
    """
    return svg


def plot_progress_donut() -> str:
    """总体进度环（纯 SVG）。"""
    pct = _progress_pct(PROJECT["chapters_done"], PROJECT["chapters_total"])
    r = 80
    cx, cy = 110, 110
    circumference = 2 * 3.14159265 * r
    dash = circumference * pct / 100

    svg = f"""
    <svg viewBox="0 0 220 240" xmlns="http://www.w3.org/2000/svg"
         style="width:100%;max-width:260px;border-radius:12px;background:#0f1626;
                box-shadow:0 6px 24px rgba(0,0,0,.35);display:block;margin:auto;">
      <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#243049" stroke-width="22"/>
      <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#e0a93b" stroke-width="22"
              stroke-dasharray="{dash} {circumference}" stroke-linecap="round"
              transform="rotate(-90 {cx} {cy})"/>
      <text x="{cx}" y="{cy - 4}" text-anchor="middle" fill="#ffd86b"
            font-size="34" font-weight="bold">{pct}%</text>
      <text x="{cx}" y="{cy + 22}" text-anchor="middle" fill="#a8b3c8"
            font-size="13">章节进度</text>
      <text x="{cx}" y="220" text-anchor="middle" fill="#a8b3c8" font-size="11">
        {PROJECT['chapters_done']} / {PROJECT['chapters_total']} 章
      </text>
    </svg>
    """
    return svg


# ===========================================================================
# 各模块渲染
# ===========================================================================

def render_overview() -> gr.Tabs:
    """总览页。"""
    pct = _progress_pct(PROJECT["chapters_done"], PROJECT["chapters_total"])
    vol_pct = _progress_pct(PROJECT["volumes_done"], PROJECT["volumes_total"])

    stat_cards = f"""
    <div class="dt-stat-row">
      <div class="dt-stat-card">
        <div class="dt-stat-label">目标字数</div>
        <div class="dt-stat-value">{PROJECT['target_words']}</div>
        <div class="dt-stat-sub">已写 {PROJECT['current_words']}</div>
      </div>
      <div class="dt-stat-card">
        <div class="dt-stat-label">卷数</div>
        <div class="dt-stat-value">{PROJECT['volumes_done']} / {PROJECT['volumes_total']}</div>
        <div class="dt-stat-sub">完成 {vol_pct}%</div>
      </div>
      <div class="dt-stat-card">
        <div class="dt-stat-label">章节</div>
        <div class="dt-stat-value">{PROJECT['chapters_done']} / {PROJECT['chapters_total']}</div>
        <div class="dt-stat-sub">完成 {pct}%</div>
      </div>
      <div class="dt-stat-card">
        <div class="dt-stat-label">状态</div>
        <div class="dt-stat-value-sm">{PROJECT['status']}</div>
        <div class="dt-stat-sub">更新于 {PROJECT['updated']}</div>
      </div>
    </div>
    """

    intro = f"""
    <div class="dt-hero">
      <div class="dt-hero-title">{PROJECT['title']}
        <span class="dt-hero-sub">· {PROJECT['genre']}</span>
      </div>
      <div class="dt-hero-desc">{PROJECT['subtitle']}</div>
      <div class="dt-hero-meta">作者：{PROJECT['author']} ｜ 类型：{PROJECT['genre']}</div>
    </div>
    """

    with gr.Tabs():
        with gr.Tab("📊 数据看板"):
            gr.HTML(intro)
            gr.HTML(stat_cards)
            with gr.Row():
                gr.HTML(plot_progress_donut())
                gr.HTML(_overview_side_panel())

        with gr.Tab("📈 爽点曲线预览"):
            gr.HTML('<div class="dt-section-title">爽点强度曲线（全卷概览）</div>')
            gr.HTML(plot_highlight_curve())
            gr.HTML(_overview_narrative())


def _overview_side_panel() -> str:
    pending_hooks = sum(1 for h in HOOKS if h["status"] != "已回收")
    p0_hooks = sum(1 for h in HOOKS if h["priority"] == "P0" and h["status"] != "已回收")
    return f"""
    <div class="dt-side-panel">
      <div class="dt-side-title">关键指标</div>
      <div class="dt-side-item">
        <span class="dt-side-label">活跃伏笔</span>
        <span class="dt-side-num">{pending_hooks}</span>
      </div>
      <div class="dt-side-item">
        <span class="dt-side-label">P0 待回收</span>
        <span class="dt-side-num dt-warn">{p0_hooks}</span>
      </div>
      <div class="dt-side-item">
        <span class="dt-side-label">已出场角色</span>
        <span class="dt-side-num">{len(CHARACTERS)}</span>
      </div>
      <div class="dt-side-item">
        <span class="dt-side-label">地理区域</span>
        <span class="dt-side-num">{len(MAP_REGIONS)}</span>
      </div>
      <div class="dt-side-item">
        <span class="dt-side-label">世界观设定</span>
        <span class="dt-side-num">{len(WORLD_SETTINGS)}</span>
      </div>
      <div class="dt-side-item">
        <span class="dt-side-label">故事阶段</span>
        <span class="dt-side-num">{len(STORY_ARC)}</span>
      </div>
    </div>
    """


def _overview_narrative() -> str:
    return """
    <div class="dt-callout">
      <div class="dt-callout-title">📖 当前阶段叙事要点</div>
      <ul>
        <li>正在推进 <b>卷三 · 渊海沉璧</b>：金手指升级 + 海族势力交锋。</li>
        <li>第 65 章「沉璧现世」是卷三中段核心爆点（强度 9.5）。</li>
        <li>第 80 章「剑尊残识苏醒」是卷三末大爆点（强度 10.0），为卷四「神祇故土」直接铺路。</li>
        <li>P0 伏笔 <b>H-002 沈砚身世</b>、<b>H-005 神祇故土封印</b>需在卷四前持续维持悬念，不可遗忘。</li>
      </ul>
    </div>
    """


def render_story_arc() -> None:
    gr.HTML('<div class="dt-section-title">🗺️ 故事阶段总览（五卷弧光）</div>')
    cards = []
    for i, arc in enumerate(STORY_ARC, 1):
        cur = "dt-arc-current" if arc["phase"].startswith("卷三") else ""
        cards.append(f"""
        <div class="dt-arc-card {cur}">
          <div class="dt-arc-head">
            <span class="dt-arc-no">阶段 {i}</span>
            <span class="dt-arc-phase">{arc['phase']}</span>
          </div>
          <div class="dt-arc-range">{arc['range']}</div>
          <div class="dt-arc-summary">{arc['summary']}</div>
          <div class="dt-arc-meta">
            <span class="dt-tag">{arc['tone']}</span>
            <span class="dt-tag dt-tag-soft">关键：{arc['key_event']}</span>
          </div>
        </div>
        """)
    gr.HTML('<div class="dt-arc-grid">' + "".join(cards) + '</div>')

    gr.HTML('<div class="dt-section-title" style="margin-top:32px;">📅 章节时间轴（近期）</div>')
    timeline_items = []
    for ch in CHAPTERS:
        timeline_items.append(f"""
        <div class="dt-tl-item">
          <div class="dt-tl-dot"></div>
          <div class="dt-tl-body">
            <div class="dt-tl-head">
              <span class="dt-tl-no">第 {ch['no']} 章</span>
              <span class="dt-tl-title">{ch['title']}</span>
              <span class="dt-tag dt-tag-soft">{ch['phase']}</span>
              <span class="dt-tl-words">{ch['words']:,} 字</span>
            </div>
            <div class="dt-tl-summary">{ch['summary']}</div>
            <div class="dt-tl-hl">亮点：{ch['highlights']}</div>
          </div>
        </div>
        """)
    gr.HTML('<div class="dt-timeline">' + "".join(timeline_items) + '</div>')


def render_map() -> None:
    gr.HTML('<div class="dt-section-title">🌏 世界地图 · 地理设定</div>')
    gr.HTML(_text_map_svg())
    gr.HTML('<div class="dt-section-title" style="margin-top:24px;">📍 区域档案</div>')
    cards = []
    for r in MAP_REGIONS:
        cards.append(f"""
        <div class="dt-map-card">
          <div class="dt-map-head">
            <span class="dt-map-name">{r['name']}</span>
            <span class="dt-map-type">{r['type']}</span>
          </div>
          <div class="dt-map-loc">📍 {r['location']} ｜ 重要性 {r['importance']}</div>
          <div class="dt-map-desc">{r['desc']}</div>
        </div>
        """)
    gr.HTML('<div class="dt-map-grid">' + "".join(cards) + '</div>')


def _text_map_svg() -> str:
    """用 SVG 画一张简化的世界关系图。"""
    regions = [
        ("青云宗", 120, 220, "#3b6fb3"),
        ("寒江", 260, 140, "#3bb3a8"),
        ("无相门", 400, 90, "#b34a3b"),
        ("渊海", 540, 230, "#b3863b"),
        ("剑冢", 130, 290, "#7a7ab3"),
        ("神祇故土", 560, 350, "#b33b7a"),
    ]
    edges = [
        ("青云宗", "寒江"),
        ("寒江", "无相门"),
        ("寒江", "渊海"),
        ("青云宗", "剑冢"),
        ("渊海", "神祇故土"),
    ]
    pos = {n: (x, y) for n, x, y, _ in regions}
    svg = [
        '<svg viewBox="0 0 680 420" xmlns="http://www.w3.org/2000/svg" '
        'style="width:100%;border-radius:12px;background:#0f1626;box-shadow:0 6px 24px rgba(0,0,0,.35);">'
    ]
    # 连线
    for a, b in edges:
        x1, y1 = pos[a]
        x2, y2 = pos[b]
        svg.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="#3a4459" stroke-width="2" stroke-dasharray="6 5"/>'
        )
    # 节点
    for name, x, y, color in regions:
        svg.append(f'<circle cx="{x}" cy="{y}" r="22" fill="{color}" opacity="0.25"/>')
        svg.append(f'<circle cx="{x}" cy="{y}" r="12" fill="{color}"/>')
        svg.append(
            f'<text x="{x}" y="{y + 38}" text-anchor="middle" fill="#e8eefc" '
            f'font-size="14" font-weight="600">{name}</text>'
        )
    svg.append('</svg>')
    return "".join(svg)


def render_outline() -> None:
    gr.HTML('<div class="dt-section-title">📚 卷·章纲树</div>')
    blocks = []
    for vol in OUTLINE:
        ch_items = []
        for ch in vol["chapters"]:
            ch_items.append(
                f'<li><span class="dt-ol-ch">{ch["ch"]}</span>'
                f'<span class="dt-ol-title">{ch["title"]}</span>'
                f'<span class="dt-tag dt-tag-soft">{ch["hook"]}</span></li>'
            )
        blocks.append(f"""
        <div class="dt-ol-vol">
          <div class="dt-ol-vol-head">
            <span class="dt-ol-vol-name">{vol['vol']}</span>
          </div>
          <div class="dt-ol-vol-goal">本卷目标：{vol['goal']}</div>
          <ul class="dt-ol-list">{''.join(ch_items)}</ul>
        </div>
        """)
    gr.HTML('<div class="dt-ol-grid">' + "".join(blocks) + '</div>')


def render_hooks() -> None:
    gr.HTML('<div class="dt-section-title">🪝 埋坑点 · 伏笔登记表</div>')
    # 汇总
    total = len(HOOKS)
    done = sum(1 for h in HOOKS if h["status"] == "已回收")
    half = sum(1 for h in HOOKS if h["status"] == "半回收")
    pending = total - done - half
    gr.HTML(f"""
    <div class="dt-summary-row">
      <div class="dt-summary-card"><b>{total}</b><span>总伏笔</span></div>
      <div class="dt-summary-card dt-ok"><b>{done}</b><span>已回收</span></div>
      <div class="dt-summary-card dt-warn"><b>{half}</b><span>半回收</span></div>
      <div class="dt-summary-card dt-danger"><b>{pending}</b><span>已埋设</span></div>
    </div>
    """)
    # 表格
    rows = []
    for h in HOOKS:
        status_cls = {
            "已回收": "dt-tag-ok",
            "半回收": "dt-tag-warn",
            "已埋设": "dt-tag-danger",
        }.get(h["status"], "dt-tag-soft")
        prio_cls = "dt-tag-danger" if h["priority"] == "P0" else (
            "dt-tag-warn" if h["priority"] == "P1" else "dt-tag-soft"
        )
        rows.append(f"""
        <tr>
          <td><code>{h['id']}</code></td>
          <td><b>{h['title']}</b><div class="dt-row-note">{h['note']}</div></td>
          <td><span class="dt-tag {status_cls}">{h['status']}</span></td>
          <td>{h['planted_ch']}</td>
          <td>{h['recycle_ch']}</td>
          <td><span class="dt-tag {prio_cls}">{h['priority']}</span></td>
        </tr>
        """)
    table = f"""
    <table class="dt-table">
      <thead>
        <tr>
          <th>编号</th><th>伏笔</th><th>状态</th>
          <th>埋设</th><th>回收</th><th>优先级</th>
        </tr>
      </thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
    """
    gr.HTML(table)


def render_highlights() -> None:
    gr.HTML('<div class="dt-section-title">🔥 爽点曲线</div>')
    gr.HTML(plot_highlight_curve())
    gr.HTML('<div class="dt-section-title" style="margin-top:24px;">🎯 爽点列表</div>')
    rows = []
    for h in HIGHLIGHT_CURVE:
        score_cls = (
            "dt-score-s" if h["score"] >= 9.0
            else "dt-score-a" if h["score"] >= 8.0
            else "dt-score-b"
        )
        rows.append(f"""
        <tr>
          <td>第 {h['ch']} 章</td>
          <td><b>{h['name']}</b></td>
          <td><span class="dt-tag dt-tag-soft">{h['type']}</span></td>
          <td><span class="dt-score {score_cls}">{h['score']:.1f}</span></td>
        </tr>
        """)
    table = f"""
    <table class="dt-table">
      <thead>
        <tr><th>章节</th><th>爽点名</th><th>类型</th><th>强度</th></tr>
      </thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
    """
    gr.HTML(table)
    gr.HTML("""
    <div class="dt-callout" style="margin-top:20px;">
      <div class="dt-callout-title">📐 爽点节奏说明</div>
      <ul>
        <li><b>每 5 章一小爽</b>：金手指小升级 / 小打脸，强度 7.0–8.0。</li>
        <li><b>每卷末一大爽</b>：境界突破 / 大势力登场，强度 8.5+。</li>
        <li><b>每 30 章一爆点</b>：金手指质变 / 关键伏笔回收，强度 9.0+。</li>
        <li>低谷章节（5–6 分）用于铺垫情绪与关系，避免审美疲劳。</li>
      </ul>
    </div>
    """)


def render_characters() -> None:
    gr.HTML('<div class="dt-section-title">👥 人物卡片</div>')
    cards = []
    for c in CHARACTERS:
        initial = c["name"][0]
        cards.append(f"""
        <div class="dt-char-card" style="border-top:3px solid {c['color']};">
          <div class="dt-char-head">
            <div class="dt-char-avatar" style="background:{c['color']};">{initial}</div>
            <div class="dt-char-name-box">
              <div class="dt-char-name">{c['name']}</div>
              <div class="dt-char-role">{c['role']}</div>
            </div>
          </div>
          <div class="dt-char-row"><span class="dt-char-key">身份</span><span>{c['identity']}</span></div>
          <div class="dt-char-row"><span class="dt-char-key">境界</span><span>{c['level']}</span></div>
          <div class="dt-char-row"><span class="dt-char-key">性格</span><span>{c['personality']}</span></div>
          <div class="dt-char-row"><span class="dt-char-key">弧光</span><span>{c['arc']}</span></div>
          <div class="dt-char-row"><span class="dt-char-key">关系</span><span>{c['relation']}</span></div>
          <div class="dt-char-row"><span class="dt-char-key">目标</span><span>{c['goal']}</span></div>
        </div>
        """)
    gr.HTML('<div class="dt-char-grid">' + "".join(cards) + '</div>')


def render_settings() -> None:
    gr.HTML('<div class="dt-section-title">⚙️ 世界观与设定</div>')
    cards = []
    for s in WORLD_SETTINGS:
        body = "<br>".join(textwrap.indent(s["content"], "").split("\n"))
        cards.append(f"""
        <div class="dt-set-card">
          <div class="dt-set-cat">{s['category']}</div>
          <div class="dt-set-body">{body}</div>
        </div>
        """)
    gr.HTML('<div class="dt-set-grid">' + "".join(cards) + '</div>')


# ===========================================================================
# 自定义 CSS
# ===========================================================================

CUSTOM_CSS = """
:root {
  --dt-bg: #0a0f1c;
  --dt-panel: #131a2b;
  --dt-panel-2: #18203a;
  --dt-border: #243049;
  --dt-text: #e8eefc;
  --dt-text-dim: #a8b3c8;
  --dt-accent: #e0a93b;
  --dt-accent-2: #ffd86b;
  --dt-danger: #e0533b;
  --dt-warn: #e0a93b;
  --dt-ok: #3bb36f;
}

#dt-root { max-width: 1280px !important; margin: 0 auto; }

.dt-header {
  background: linear-gradient(135deg, #1a2542 0%, #0a0f1c 100%);
  border-radius: 16px;
  padding: 22px 28px;
  margin-bottom: 18px;
  border: 1px solid var(--dt-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dt-brand {
  display: flex; align-items: center; gap: 14px;
}
.dt-logo {
  width: 44px; height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #e0a93b, #b36f3b);
  display: flex; align-items: center; justify-content: center;
  color: #0a0f1c; font-weight: 800; font-size: 22px;
  box-shadow: 0 4px 14px rgba(224,169,59,.35);
}
.dt-brand-name { color: var(--dt-text); font-size: 22px; font-weight: 700; letter-spacing: 1px;}
.dt-brand-sub { color: var(--dt-text-dim); font-size: 12px; margin-top: 2px;}
.dt-header-meta {
  color: var(--dt-text-dim); font-size: 12px; text-align: right; line-height: 1.7;
}
.dt-header-meta b { color: var(--dt-accent-2); }

.dt-section-title {
  color: var(--dt-text);
  font-size: 16px;
  font-weight: 700;
  margin: 18px 0 12px;
  padding-left: 10px;
  border-left: 3px solid var(--dt-accent);
}

.dt-hero {
  background: linear-gradient(135deg, #1f2c4d 0%, #131a2b 100%);
  border-radius: 14px;
  padding: 20px 24px;
  margin-bottom: 16px;
  border: 1px solid var(--dt-border);
}
.dt-hero-title {
  color: var(--dt-text);
  font-size: 26px;
  font-weight: 800;
}
.dt-hero-sub { color: var(--dt-accent); font-size: 14px; font-weight: 500; margin-left: 8px;}
.dt-hero-desc { color: var(--dt-text-dim); font-size: 14px; margin-top: 8px; line-height: 1.7;}
.dt-hero-meta { color: var(--dt-text-dim); font-size: 12px; margin-top: 8px;}

.dt-stat-row {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px;
}
.dt-stat-card {
  background: var(--dt-panel);
  border: 1px solid var(--dt-border);
  border-radius: 12px;
  padding: 16px 18px;
}
.dt-stat-label { color: var(--dt-text-dim); font-size: 12px; }
.dt-stat-value { color: var(--dt-accent-2); font-size: 24px; font-weight: 700; margin-top: 4px;}
.dt-stat-value-sm { color: var(--dt-accent-2); font-size: 15px; font-weight: 600; margin-top: 4px; line-height: 1.4;}
.dt-stat-sub { color: var(--dt-text-dim); font-size: 11px; margin-top: 4px;}

.dt-side-panel {
  background: var(--dt-panel);
  border: 1px solid var(--dt-border);
  border-radius: 12px;
  padding: 14px 18px;
}
.dt-side-title {
  color: var(--dt-text); font-size: 13px; font-weight: 700;
  margin-bottom: 10px; padding-bottom: 8px;
  border-bottom: 1px solid var(--dt-border);
}
.dt-side-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 0; font-size: 13px;
}
.dt-side-label { color: var(--dt-text-dim); }
.dt-side-num { color: var(--dt-accent-2); font-weight: 700; font-size: 16px;}
.dt-side-num.dt-warn { color: var(--dt-danger); }

.dt-callout {
  background: rgba(224,169,59,.06);
  border: 1px solid rgba(224,169,59,.35);
  border-radius: 12px;
  padding: 14px 18px;
  margin-top: 16px;
}
.dt-callout-title {
  color: var(--dt-accent-2); font-size: 13px; font-weight: 700; margin-bottom: 6px;
}
.dt-callout ul { color: var(--dt-text); font-size: 13px; line-height: 1.9; padding-left: 18px; margin: 0;}
.dt-callout b { color: var(--dt-accent-2); }

.dt-arc-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px;
}
.dt-arc-card {
  background: var(--dt-panel);
  border: 1px solid var(--dt-border);
  border-radius: 12px;
  padding: 16px 18px;
}
.dt-arc-current {
  border-color: var(--dt-accent);
  box-shadow: 0 0 0 1px var(--dt-accent) inset, 0 6px 20px rgba(224,169,59,.18);
}
.dt-arc-head {
  display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
}
.dt-arc-no {
  background: var(--dt-panel-2); color: var(--dt-text-dim);
  font-size: 11px; padding: 2px 8px; border-radius: 8px;
}
.dt-arc-phase { color: var(--dt-text); font-size: 16px; font-weight: 700;}
.dt-arc-range { color: var(--dt-accent); font-size: 12px; margin-bottom: 8px;}
.dt-arc-summary { color: var(--dt-text); font-size: 13px; line-height: 1.8;}
.dt-arc-meta { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;}

.dt-tag {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--dt-panel-2);
  color: var(--dt-text-dim);
  border: 1px solid var(--dt-border);
}
.dt-tag-soft { background: rgba(59,111,179,.15); color: #8fb6e8; border-color: rgba(59,111,179,.35);}
.dt-tag-ok { background: rgba(59,179,111,.15); color: #8fe0b6; border-color: rgba(59,179,111,.35);}
.dt-tag-warn { background: rgba(224,169,59,.15); color: #ffd86b; border-color: rgba(224,169,59,.4);}
.dt-tag-danger { background: rgba(224,83,59,.15); color: #ff8f78; border-color: rgba(224,83,59,.4);}

.dt-timeline { position: relative; padding-left: 18px;}
.dt-timeline::before {
  content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px;
  width: 2px; background: var(--dt-border);
}
.dt-tl-item { position: relative; padding: 0 0 18px 18px;}
.dt-tl-dot {
  position: absolute; left: -16px; top: 5px;
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--dt-accent);
  box-shadow: 0 0 0 3px rgba(224,169,59,.2);
}
.dt-tl-body {
  background: var(--dt-panel); border: 1px solid var(--dt-border);
  border-radius: 10px; padding: 12px 14px;
}
.dt-tl-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 6px;
}
.dt-tl-no { color: var(--dt-accent-2); font-size: 12px; font-weight: 700;}
.dt-tl-title { color: var(--dt-text); font-size: 15px; font-weight: 700;}
.dt-tl-words { color: var(--dt-text-dim); font-size: 11px; margin-left: auto;}
.dt-tl-summary { color: var(--dt-text); font-size: 13px; line-height: 1.7;}
.dt-tl-hl { color: var(--dt-accent); font-size: 12px; margin-top: 4px;}

.dt-map-grid, .dt-set-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px;
}
.dt-map-card, .dt-set-card {
  background: var(--dt-panel); border: 1px solid var(--dt-border);
  border-radius: 12px; padding: 14px 16px;
}
.dt-map-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;}
.dt-map-name { color: var(--dt-text); font-size: 16px; font-weight: 700;}
.dt-map-type { color: var(--dt-accent); font-size: 11px;}
.dt-map-loc { color: var(--dt-text-dim); font-size: 12px; margin-bottom: 8px;}
.dt-map-desc { color: var(--dt-text); font-size: 13px; line-height: 1.7;}

.dt-set-cat {
  color: var(--dt-accent-2); font-size: 14px; font-weight: 700;
  margin-bottom: 8px; padding-bottom: 6px;
  border-bottom: 1px solid var(--dt-border);
}
.dt-set-body { color: var(--dt-text); font-size: 13px; line-height: 1.85; white-space: pre-wrap;}

.dt-ol-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
}
.dt-ol-vol {
  background: var(--dt-panel); border: 1px solid var(--dt-border);
  border-radius: 12px; padding: 14px 16px;
}
.dt-ol-vol-head { color: var(--dt-text); font-size: 15px; font-weight: 700; margin-bottom: 4px;}
.dt-ol-vol-goal {
  color: var(--dt-text-dim); font-size: 12px; margin-bottom: 10px;
  padding-bottom: 8px; border-bottom: 1px dashed var(--dt-border);
}
.dt-ol-list { list-style: none; padding: 0; margin: 0;}
.dt-ol-list li {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; font-size: 13px;
  border-bottom: 1px dashed rgba(36,48,73,.5);
}
.dt-ol-list li:last-child { border-bottom: none;}
.dt-ol-ch { color: var(--dt-accent); font-family: monospace; font-size: 12px; min-width: 64px;}
.dt-ol-title { color: var(--dt-text); flex: 1;}

.dt-summary-row {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;
}
.dt-summary-card {
  background: var(--dt-panel); border: 1px solid var(--dt-border);
  border-radius: 10px; padding: 12px 14px;
  text-align: center;
}
.dt-summary-card b { display: block; color: var(--dt-accent-2); font-size: 22px; font-weight: 700;}
.dt-summary-card span { color: var(--dt-text-dim); font-size: 12px;}
.dt-summary-card.dt-ok b { color: var(--dt-ok);}
.dt-summary-card.dt-warn b { color: var(--dt-warn);}
.dt-summary-card.dt-danger b { color: var(--dt-danger);}

.dt-table {
  width: 100%; border-collapse: collapse;
  background: var(--dt-panel);
  border: 1px solid var(--dt-border);
  border-radius: 12px; overflow: hidden;
  font-size: 13px;
}
.dt-table th {
  background: var(--dt-panel-2);
  color: var(--dt-accent-2);
  font-weight: 600;
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dt-border);
}
.dt-table td {
  padding: 10px 12px;
  color: var(--dt-text);
  border-bottom: 1px solid var(--dt-border);
  vertical-align: top;
}
.dt-table tr:last-child td { border-bottom: none;}
.dt-row-note { color: var(--dt-text-dim); font-size: 11px; margin-top: 3px;}
.dt-table code {
  background: var(--dt-panel-2); padding: 1px 6px;
  border-radius: 4px; color: var(--dt-accent);
  font-size: 12px;
}

.dt-score {
  display: inline-block; padding: 2px 10px; border-radius: 6px;
  font-weight: 700; font-size: 13px;
}
.dt-score-s { background: rgba(224,83,59,.18); color: #ff8f78; border: 1px solid rgba(224,83,59,.4);}
.dt-score-a { background: rgba(224,169,59,.18); color: #ffd86b; border: 1px solid rgba(224,169,59,.4);}
.dt-score-b { background: rgba(59,179,111,.15); color: #8fe0b6; border: 1px solid rgba(59,179,111,.35);}

.dt-char-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
}
.dt-char-card {
  background: var(--dt-panel); border: 1px solid var(--dt-border);
  border-radius: 12px; padding: 14px 16px;
}
.dt-char-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px;}
.dt-char-avatar {
  width: 42px; height: 42px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #0a0f1c; font-weight: 800; font-size: 18px;
}
.dt-char-name { color: var(--dt-text); font-size: 16px; font-weight: 700;}
.dt-char-role { color: var(--dt-accent); font-size: 11px;}
.dt-char-row {
  display: flex; gap: 8px; padding: 5px 0; font-size: 12px;
  border-bottom: 1px dashed rgba(36,48,73,.5);
  line-height: 1.6;
}
.dt-char-row:last-child { border-bottom: none;}
.dt-char-key {
  color: var(--dt-text-dim); min-width: 36px; flex-shrink: 0;
}

.dt-footer {
  text-align: center; color: var(--dt-text-dim); font-size: 12px;
  padding: 20px 0 10px; border-top: 1px solid var(--dt-border); margin-top: 24px;
}
.dt-footer b { color: var(--dt-accent); }

/* gradio 原生组件暗色适配 */
.gradio-container { background: var(--dt-bg) !important; }
.tabitem { background: transparent !important; }
.tabs > .tab-nav { gap: 4px !important; border-bottom: 1px solid var(--dt-border) !important; }
.tabs > .tab-nav > button {
  color: var(--dt-text-dim) !important;
  font-weight: 600 !important;
  font-size: 14px !important;
  border: none !important;
  padding: 8px 14px !important;
  border-radius: 8px 8px 0 0 !important;
}
.tabs > .tab-nav > button:hover { color: var(--dt-text) !important; background: rgba(224,169,59,.06) !important;}
.tabs > .tab-nav >button.selected {
  color: var(--dt-accent-2) !important;
  background: var(--dt-panel) !important;
  border-bottom: 2px solid var(--dt-accent) !important;
}
footer { display: none !important; }
"""


# ===========================================================================
# 主入口
# ===========================================================================

def _gradio_ver() -> tuple:
    """返回 Gradio 主次版本号元组，用于兼容 4.x/5.x/6.x。"""
    parts = []
    for x in gr.__version__.split(".")[:2]:
        try:
            parts.append(int(x))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def build_app() -> gr.Blocks:
    # Gradio 6.0 起 css/theme 参数从 Blocks() 移到 launch()。
    blocks_kwargs = {"title": "DreamTale · 小说创作后台"}
    if _gradio_ver() < (6, 0):
        blocks_kwargs["css"] = CUSTOM_CSS
    with gr.Blocks(**blocks_kwargs) as demo:
        gr.HTML(f"""
        <div class="dt-header">
          <div class="dt-brand">
            <div class="dt-logo">DT</div>
            <div>
              <div class="dt-brand-name">DreamTale · 小说创作后台</div>
              <div class="dt-brand-sub">Story · Map · Outline · Hooks · Highlights · Characters · Settings</div>
            </div>
          </div>
          <div class="dt-header-meta">
            项目：<b>{PROJECT['title']}</b><br>
            当前：<b>{PROJECT['status']}</b><br>
            更新：<b>{PROJECT['updated']}</b>
          </div>
        </div>
        """)

        with gr.Tabs():
            with gr.Tab("📊 总览"):
                render_overview()
            with gr.Tab("🗺️ 故事线"):
                render_story_arc()
            with gr.Tab("🌏 地图"):
                render_map()
            with gr.Tab("📚 大纲"):
                render_outline()
            with gr.Tab("🪝 埋坑点"):
                render_hooks()
            with gr.Tab("🔥 爽点"):
                render_highlights()
            with gr.Tab("👥 人物卡片"):
                render_characters()
            with gr.Tab("⚙️ 设定"):
                render_settings()

        gr.HTML("""
        <div class="dt-footer">
          DreamTale · 小说创作后台 · Powered by Gradio on ModelScope Studio
        </div>
        """)

    return demo


demo = build_app()


if __name__ == "__main__":
    launch_kwargs = {
        "server_name": "0.0.0.0",
        "server_port": 7860,
    }
    # Gradio 6.0 起 css 在 launch() 中传；旧版已在 Blocks() 中传。
    if _gradio_ver() >= (6, 0):
        launch_kwargs["css"] = CUSTOM_CSS
    demo.queue().launch(**launch_kwargs)
