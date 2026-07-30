# -*- coding: utf-8 -*-
"""DreamTale · FastAPI 后端

提供 DreamTale 平台的全部 CRUD API + 静态文件托管。
依赖 `scripts/dreamtale/db.py`（由另一个 agent 并行实现）提供的数据库工具层：
    get_conn / init_db / query / query_one / execute / DB_PATH

启动：`python server.py`，监听 7860 端口（ModelScope 兼容）。
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# 确保能 import scripts.dreamtale.db（兼容直接运行与 TestClient 导入）
_WORKSPACE = Path(__file__).resolve().parent
if str(_WORKSPACE) not in sys.path:
    sys.path.insert(0, str(_WORKSPACE))

from scripts.dreamtale.db import (  # noqa: E402
    execute,
    init_db,
    query,
    query_one,
)

# ============================================================
# 路径常量
# ============================================================
STATIC_DIR = _WORKSPACE / "static"
VAULT_DIR = _WORKSPACE / "NovelForge_Vault"

# ============================================================
# Pydantic 模型（创建 / 更新 schema）
# ============================================================


# ---- 项目 ----
class ProjectCreate(BaseModel):
    name: str
    subtitle: Optional[str] = None
    genre: Optional[str] = None
    author: Optional[str] = None
    target_words: Optional[int] = None
    current_words: Optional[int] = None
    volumes_done: Optional[int] = None
    volumes_total: Optional[int] = None
    chapters_done: Optional[int] = None
    chapters_total: Optional[int] = None
    status: Optional[str] = None
    updated: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    subtitle: Optional[str] = None
    genre: Optional[str] = None
    author: Optional[str] = None
    target_words: Optional[int] = None
    current_words: Optional[int] = None
    volumes_done: Optional[int] = None
    volumes_total: Optional[int] = None
    chapters_done: Optional[int] = None
    chapters_total: Optional[int] = None
    status: Optional[str] = None
    updated: Optional[str] = None


# ---- 章节 ----
class ChapterCreate(BaseModel):
    vol_no: int
    ch_no: int
    title: str
    content: Optional[str] = None
    summary: Optional[str] = None
    highlights: Optional[str] = None
    status: Optional[str] = "draft"


class ChapterUpdate(BaseModel):
    vol_no: Optional[int] = None
    ch_no: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    summary: Optional[str] = None
    highlights: Optional[str] = None
    status: Optional[str] = None


# ---- 大纲 ----
class OutlineCreate(BaseModel):
    vol_no: int
    vol_name: Optional[str] = None
    vol_goal: Optional[str] = None
    ch_no: Optional[int] = None
    ch_title: Optional[str] = None
    ch_hook: Optional[str] = None
    ch_summary: Optional[str] = None


class OutlineUpdate(BaseModel):
    vol_no: Optional[int] = None
    vol_name: Optional[str] = None
    vol_goal: Optional[str] = None
    ch_no: Optional[int] = None
    ch_title: Optional[str] = None
    ch_hook: Optional[str] = None
    ch_summary: Optional[str] = None


# ---- 伏笔 ----
# 注：schema 中 planted_ch / recycle_ch 为 TEXT，存储「第 N 章」这样的字符串引用
class HookCreate(BaseModel):
    hook_id: str
    title: str
    status: Optional[str] = "planted"
    planted_ch: Optional[str] = None
    recycle_ch: Optional[str] = None
    priority: Optional[str] = "P1"
    note: Optional[str] = None


class HookUpdate(BaseModel):
    hook_id: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    planted_ch: Optional[str] = None
    recycle_ch: Optional[str] = None
    priority: Optional[str] = None
    note: Optional[str] = None


# ---- 爽点 ----
class HighlightCreate(BaseModel):
    ch_no: int
    name: str
    score: float
    type: Optional[str] = None


class HighlightUpdate(BaseModel):
    ch_no: Optional[int] = None
    name: Optional[str] = None
    score: Optional[float] = None
    type: Optional[str] = None


# ---- 人物 ----
class CharacterCreate(BaseModel):
    name: str
    role: Optional[str] = None
    identity: Optional[str] = None
    level: Optional[str] = None
    personality: Optional[str] = None
    arc: Optional[str] = None
    relation: Optional[str] = None
    goal: Optional[str] = None
    color: Optional[str] = None


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    identity: Optional[str] = None
    level: Optional[str] = None
    personality: Optional[str] = None
    arc: Optional[str] = None
    relation: Optional[str] = None
    goal: Optional[str] = None
    color: Optional[str] = None


# ---- 世界观 ----
class WorldSettingCreate(BaseModel):
    category: str
    content: Optional[str] = None
    sort_order: Optional[int] = 0


class WorldSettingUpdate(BaseModel):
    category: Optional[str] = None
    content: Optional[str] = None
    sort_order: Optional[int] = None


# ============================================================
# FastAPI app
# ============================================================
app = FastAPI(title="DreamTale API")

# CORS：本地开发友好，允许所有源
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 模块导入时即建表，保证 TestClient（可能不触发 lifespan）也能直接用
init_db()


# ============================================================
# 通用辅助
# ============================================================

def _now() -> str:
    """返回当前时间字符串（用于 created_at / updated_at）。"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _build_set_clause(data: dict) -> tuple[str, list]:
    """根据非空字段构造 SET 子句，返回 (set_clause, params)。"""
    fields = list(data.keys())
    if not fields:
        return "", []
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    params = [data[k] for k in fields]
    return set_clause, params


def _insert(table: str, data: dict) -> int:
    """通用插入：data 为字段→值映射，自动补 created_at / updated_at，返回新 id。"""
    now = _now()
    cols = list(data.keys()) + ["created_at", "updated_at"]
    vals = list(data.values()) + [now, now]
    cols_str = ", ".join(cols)
    placeholders = ", ".join("?" for _ in vals)
    sql = f"INSERT INTO {table} ({cols_str}) VALUES ({placeholders})"
    return execute(sql, vals)


def _update_record(table: str, pk_field: str, pk_value: int, data: dict) -> dict:
    """通用更新：根据主键更新指定字段（自动补 updated_at），返回更新后的记录。"""
    set_clause, params = _build_set_clause(data)
    if not set_clause:
        # 没有要更新的字段，直接返回当前记录
        row = query_one(f"SELECT * FROM {table} WHERE {pk_field} = ?", (pk_value,))
        if row is None:
            raise HTTPException(status_code=404, detail=f"{table} {pk_value} 不存在")
        return row
    # 自动更新 updated_at
    set_clause += ", updated_at = ?"
    params.append(_now())
    params.append(pk_value)
    execute(f"UPDATE {table} SET {set_clause} WHERE {pk_field} = ?", params)
    row = query_one(f"SELECT * FROM {table} WHERE {pk_field} = ?", (pk_value,))
    if row is None:
        raise HTTPException(status_code=404, detail=f"{table} {pk_value} 不存在")
    return row


def _get_or_404(table: str, pk_field: str, pk_value: int) -> dict:
    """按主键取一条记录，找不到抛 404。"""
    row = query_one(f"SELECT * FROM {table} WHERE {pk_field} = ?", (pk_value,))
    if row is None:
        raise HTTPException(status_code=404, detail=f"{table} {pk_value} 不存在")
    return row


def _count(table: str, project_id: int) -> int:
    """统计某项目下的子表记录数。"""
    row = query_one(
        f"SELECT COUNT(*) AS n FROM {table} WHERE project_id = ?", (project_id,)
    )
    return int(row["n"]) if row else 0


# ============================================================
# 项目
# ============================================================

@app.get("/api/projects")
def list_projects() -> list:
    """列出所有项目。"""
    return query("SELECT * FROM projects ORDER BY id DESC")


@app.post("/api/projects")
def create_project(payload: ProjectCreate) -> dict:
    """创建项目，返回新 id。"""
    data = payload.model_dump(exclude_none=True)
    if not data.get("name"):
        raise HTTPException(status_code=400, detail="项目名称 name 必填")
    pid = _insert("projects", data)
    return {"id": pid}


@app.get("/api/projects/{pid}")
def get_project(pid: int) -> dict:
    """获取单个项目。"""
    return _get_or_404("projects", "id", pid)


@app.put("/api/projects/{pid}")
def update_project(pid: int, payload: ProjectUpdate) -> dict:
    """更新项目。"""
    data = payload.model_dump(exclude_none=True)
    return _update_record("projects", "id", pid, data)


@app.delete("/api/projects/{pid}")
def delete_project(pid: int) -> dict:
    """删除项目（级联删除所有子表）。"""
    _get_or_404("projects", "id", pid)
    # 级联删除子表
    for child in ["chapters", "outlines", "hooks", "highlights", "characters", "world_settings"]:
        execute(f"DELETE FROM {child} WHERE project_id = ?", (pid,))
    execute("DELETE FROM projects WHERE id = ?", (pid,))
    return {"success": True, "id": pid}


# ============================================================
# 章节
# ============================================================

@app.get("/api/projects/{pid}/chapters")
def list_chapters(pid: int) -> list:
    """列出项目下所有章节（按 vol_no, ch_no 排序）。"""
    _get_or_404("projects", "id", pid)
    return query(
        "SELECT * FROM chapters WHERE project_id = ? ORDER BY vol_no ASC, ch_no ASC",
        (pid,),
    )


@app.post("/api/projects/{pid}/chapters")
def create_chapter(pid: int, payload: ChapterCreate) -> dict:
    """创建章节，返回完整记录（含自动计算的 words）。"""
    _get_or_404("projects", "id", pid)
    data = payload.model_dump(exclude_none=True)
    content = data.get("content") or ""
    data["words"] = len(content)
    data["project_id"] = pid
    try:
        cid = _insert("chapters", data)
    except Exception as e:
        # 例如 UNIQUE(project_id, vol_no, ch_no) 冲突
        raise HTTPException(status_code=400, detail=f"创建章节失败：{e}")
    return _get_or_404("chapters", "id", cid)


@app.get("/api/chapters/{cid}")
def get_chapter(cid: int) -> dict:
    """获取单个章节（含 content 全文）。"""
    return _get_or_404("chapters", "id", cid)


@app.put("/api/chapters/{cid}")
def update_chapter(cid: int, payload: ChapterUpdate) -> dict:
    """更新章节。保存正文时自动重算 words = len(content)。"""
    data = payload.model_dump(exclude_none=True)
    if "content" in data:
        data["words"] = len(data["content"])
    return _update_record("chapters", "id", cid, data)


@app.delete("/api/chapters/{cid}")
def delete_chapter(cid: int) -> dict:
    """删除章节。"""
    _get_or_404("chapters", "id", cid)
    execute("DELETE FROM chapters WHERE id = ?", (cid,))
    return {"success": True, "id": cid}


# ============================================================
# 大纲
# ============================================================

@app.get("/api/projects/{pid}/outlines")
def list_outlines(pid: int) -> list:
    """列出项目下所有大纲（按 vol_no, ch_no 排序）。"""
    _get_or_404("projects", "id", pid)
    return query(
        "SELECT * FROM outlines WHERE project_id = ? ORDER BY vol_no ASC, ch_no ASC",
        (pid,),
    )


@app.post("/api/projects/{pid}/outlines")
def create_outline(pid: int, payload: OutlineCreate) -> dict:
    """创建大纲。"""
    _get_or_404("projects", "id", pid)
    data = payload.model_dump(exclude_none=True)
    data["project_id"] = pid
    oid = _insert("outlines", data)
    return _get_or_404("outlines", "id", oid)


@app.put("/api/outlines/{oid}")
def update_outline(oid: int, payload: OutlineUpdate) -> dict:
    """更新大纲。"""
    data = payload.model_dump(exclude_none=True)
    return _update_record("outlines", "id", oid, data)


@app.delete("/api/outlines/{oid}")
def delete_outline(oid: int) -> dict:
    """删除大纲。"""
    _get_or_404("outlines", "id", oid)
    execute("DELETE FROM outlines WHERE id = ?", (oid,))
    return {"success": True, "id": oid}


# ============================================================
# 伏笔
# ============================================================

@app.get("/api/projects/{pid}/hooks")
def list_hooks(pid: int) -> list:
    """列出项目下所有伏笔。"""
    _get_or_404("projects", "id", pid)
    return query("SELECT * FROM hooks WHERE project_id = ? ORDER BY id ASC", (pid,))


@app.post("/api/projects/{pid}/hooks")
def create_hook(pid: int, payload: HookCreate) -> dict:
    """创建伏笔。"""
    _get_or_404("projects", "id", pid)
    data = payload.model_dump(exclude_none=True)
    data["project_id"] = pid
    hid = _insert("hooks", data)
    return _get_or_404("hooks", "id", hid)


@app.put("/api/hooks/{hid}")
def update_hook(hid: int, payload: HookUpdate) -> dict:
    """更新伏笔。"""
    data = payload.model_dump(exclude_none=True)
    return _update_record("hooks", "id", hid, data)


@app.delete("/api/hooks/{hid}")
def delete_hook(hid: int) -> dict:
    """删除伏笔。"""
    _get_or_404("hooks", "id", hid)
    execute("DELETE FROM hooks WHERE id = ?", (hid,))
    return {"success": True, "id": hid}


# ============================================================
# 爽点
# ============================================================

@app.get("/api/projects/{pid}/highlights")
def list_highlights(pid: int) -> list:
    """列出项目下所有爽点（按 ch_no 排序）。"""
    _get_or_404("projects", "id", pid)
    return query(
        "SELECT * FROM highlights WHERE project_id = ? ORDER BY ch_no ASC", (pid,)
    )


@app.post("/api/projects/{pid}/highlights")
def create_highlight(pid: int, payload: HighlightCreate) -> dict:
    """创建爽点。"""
    _get_or_404("projects", "id", pid)
    data = payload.model_dump(exclude_none=True)
    data["project_id"] = pid
    hid = _insert("highlights", data)
    return _get_or_404("highlights", "id", hid)


@app.put("/api/highlights/{hid}")
def update_highlight(hid: int, payload: HighlightUpdate) -> dict:
    """更新爽点。"""
    data = payload.model_dump(exclude_none=True)
    return _update_record("highlights", "id", hid, data)


@app.delete("/api/highlights/{hid}")
def delete_highlight(hid: int) -> dict:
    """删除爽点。"""
    _get_or_404("highlights", "id", hid)
    execute("DELETE FROM highlights WHERE id = ?", (hid,))
    return {"success": True, "id": hid}


# ============================================================
# 人物
# ============================================================

@app.get("/api/projects/{pid}/characters")
def list_characters(pid: int) -> list:
    """列出项目下所有人物。"""
    _get_or_404("projects", "id", pid)
    return query("SELECT * FROM characters WHERE project_id = ? ORDER BY id ASC", (pid,))


@app.post("/api/projects/{pid}/characters")
def create_character(pid: int, payload: CharacterCreate) -> dict:
    """创建人物。"""
    _get_or_404("projects", "id", pid)
    data = payload.model_dump(exclude_none=True)
    data["project_id"] = pid
    cid = _insert("characters", data)
    return _get_or_404("characters", "id", cid)


@app.put("/api/characters/{cid}")
def update_character(cid: int, payload: CharacterUpdate) -> dict:
    """更新人物。"""
    data = payload.model_dump(exclude_none=True)
    return _update_record("characters", "id", cid, data)


@app.delete("/api/characters/{cid}")
def delete_character(cid: int) -> dict:
    """删除人物。"""
    _get_or_404("characters", "id", cid)
    execute("DELETE FROM characters WHERE id = ?", (cid,))
    return {"success": True, "id": cid}


# ============================================================
# 世界观
# ============================================================

@app.get("/api/projects/{pid}/world-settings")
def list_world_settings(pid: int) -> list:
    """列出项目下所有世界观设定（按 sort_order 排序）。"""
    _get_or_404("projects", "id", pid)
    return query(
        "SELECT * FROM world_settings WHERE project_id = ? ORDER BY sort_order ASC",
        (pid,),
    )


@app.post("/api/projects/{pid}/world-settings")
def create_world_setting(pid: int, payload: WorldSettingCreate) -> dict:
    """创建世界观设定。"""
    _get_or_404("projects", "id", pid)
    data = payload.model_dump(exclude_none=True)
    data["project_id"] = pid
    if "sort_order" not in data:
        data["sort_order"] = 0
    wid = _insert("world_settings", data)
    return _get_or_404("world_settings", "id", wid)


@app.put("/api/world-settings/{wid}")
def update_world_setting(wid: int, payload: WorldSettingUpdate) -> dict:
    """更新世界观设定。"""
    data = payload.model_dump(exclude_none=True)
    return _update_record("world_settings", "id", wid, data)


@app.delete("/api/world-settings/{wid}")
def delete_world_setting(wid: int) -> dict:
    """删除世界观设定。"""
    _get_or_404("world_settings", "id", wid)
    execute("DELETE FROM world_settings WHERE id = ?", (wid,))
    return {"success": True, "id": wid}


# ============================================================
# Dashboard 聚合
# ============================================================

@app.get("/api/projects/{pid}/dashboard")
def get_dashboard(pid: int) -> dict:
    """返回项目仪表盘聚合数据。"""
    project = _get_or_404("projects", "id", pid)

    chapters = query(
        "SELECT status FROM chapters WHERE project_id = ?", (pid,)
    )
    chapters_done = sum(1 for c in chapters if c.get("status") == "published")
    chapters_total = len(chapters)

    hooks = query(
        "SELECT status, priority FROM hooks WHERE project_id = ?", (pid,)
    )
    hooks_pending = sum(1 for h in hooks if h.get("status") != "recycled")
    hooks_p0 = sum(
        1 for h in hooks
        if h.get("priority") == "P0" and h.get("status") != "recycled"
    )

    characters_count = _count("characters", pid)
    highlights_count = _count("highlights", pid)
    outlines_count = _count("outlines", pid)
    world_settings_count = _count("world_settings", pid)

    # 最近 5 章（按卷号/章号倒序）
    recent_chapters = query(
        "SELECT id, vol_no, ch_no, title, summary, highlights, words, status, updated_at "
        "FROM chapters WHERE project_id = ? "
        "ORDER BY vol_no DESC, ch_no DESC LIMIT 5",
        (pid,),
    )
    # 爽点曲线（按章号升序）
    highlights_curve = query(
        "SELECT ch_no, name, score, type FROM highlights "
        "WHERE project_id = ? ORDER BY ch_no ASC",
        (pid,),
    )

    return {
        "project": project,
        "chapters_done": chapters_done,
        "chapters_total": chapters_total,
        "hooks_pending": hooks_pending,
        "hooks_p0": hooks_p0,
        "characters_count": characters_count,
        "highlights_count": highlights_count,
        "outlines_count": outlines_count,
        "world_settings_count": world_settings_count,
        "recent_chapters": recent_chapters,
        "highlights_curve": highlights_curve,
    }


# ============================================================
# 导出 Vault
# ============================================================

@app.post("/api/projects/{pid}/export-vault")
def export_vault(pid: int) -> dict:
    """把项目数据导出为 Markdown 写入 NovelForge_Vault/ 目录。

    - 章节正文 → NovelForge_Vault/05_正文/published/vol_{NN}/ch_{NNN}.md
    - 大纲     → NovelForge_Vault/04_大纲与脉络/vol_{NN}/ch_{NNN}_outline.md
    - 伏笔     → NovelForge_Vault/04_大纲与脉络/hooks_registry.json
    目录不存在自动创建，文件已存在则覆盖。
    """
    project = _get_or_404("projects", "id", pid)
    exported_files: list[str] = []

    # ---- 章节正文 ----
    chapters = query(
        "SELECT * FROM chapters WHERE project_id = ? ORDER BY vol_no ASC, ch_no ASC",
        (pid,),
    )
    for ch in chapters:
        vol_no = ch.get("vol_no") or 0
        ch_no = ch.get("ch_no") or 0
        vol_dir = VAULT_DIR / "05_正文" / "published" / f"vol_{vol_no:02d}"
        vol_dir.mkdir(parents=True, exist_ok=True)
        fpath = vol_dir / f"ch_{ch_no:03d}.md"
        fpath.write_text(_render_chapter_md(ch, project), encoding="utf-8")
        exported_files.append(str(fpath.relative_to(_WORKSPACE)))

    # ---- 大纲 ----
    outlines = query(
        "SELECT * FROM outlines WHERE project_id = ? ORDER BY vol_no ASC, ch_no ASC",
        (pid,),
    )
    for ol in outlines:
        ch_no = ol.get("ch_no")
        if ch_no is None:
            # 没有章号的大纲（如卷总纲）跳过文件写入，避免命名冲突
            continue
        vol_no = ol.get("vol_no") or 0
        vol_dir = VAULT_DIR / "04_大纲与脉络" / f"vol_{vol_no:02d}"
        vol_dir.mkdir(parents=True, exist_ok=True)
        fpath = vol_dir / f"ch_{ch_no:03d}_outline.md"
        fpath.write_text(_render_outline_md(ol, project), encoding="utf-8")
        exported_files.append(str(fpath.relative_to(_WORKSPACE)))

    # ---- 伏笔合并写入 hooks_registry.json ----
    hooks = query(
        "SELECT * FROM hooks WHERE project_id = ? ORDER BY id ASC", (pid,)
    )
    hooks_path = VAULT_DIR / "04_大纲与脉络" / "hooks_registry.json"
    hooks_path.parent.mkdir(parents=True, exist_ok=True)
    registry = _build_hooks_registry(project, hooks)
    hooks_path.write_text(
        json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    exported_files.append(str(hooks_path.relative_to(_WORKSPACE)))

    return {"success": True, "exported_files": exported_files}


def _render_chapter_md(ch: dict, project: dict) -> str:
    """渲染章节 Markdown。"""
    vol_no = ch.get("vol_no") or 0
    ch_no = ch.get("ch_no") or 0
    lines = [
        "---",
        f"project: {project.get('name', '')}",
        f"vol_no: {vol_no}",
        f"ch_no: {ch_no}",
        f"title: {ch.get('title', '')}",
        f"words: {ch.get('words', 0)}",
        f"status: {ch.get('status', 'draft')}",
        "---",
        "",
        f"# 第 {vol_no} 卷 · 第 {ch_no} 章 {ch.get('title', '')}",
        "",
    ]
    if ch.get("summary"):
        lines.append(f"> {ch['summary']}")
        lines.append("")
    if ch.get("highlights"):
        lines.append(f"**本章亮点**：{ch['highlights']}")
        lines.append("")
    lines.append(ch.get("content") or "")
    lines.append("")
    return "\n".join(lines)


def _render_outline_md(ol: dict, project: dict) -> str:
    """渲染章纲 Markdown。"""
    vol_no = ol.get("vol_no") or 0
    ch_no = ol.get("ch_no") or 0
    lines = [
        "---",
        f"project: {project.get('name', '')}",
        f"vol_no: {vol_no}",
        f"vol_name: {ol.get('vol_name', '') or ''}",
        f"ch_no: {ch_no}",
        f"ch_title: {ol.get('ch_title', '') or ''}",
        "---",
        "",
        f"# 章纲：vol_{vol_no:02d} · ch_{ch_no:03d}",
        "",
    ]
    if ol.get("vol_name"):
        lines.append(f"## 卷名：{ol['vol_name']}")
        lines.append("")
    if ol.get("vol_goal"):
        lines.append(f"**本卷目标**：{ol['vol_goal']}")
        lines.append("")
    if ol.get("ch_title"):
        lines.append(f"## 章标题：{ol['ch_title']}")
        lines.append("")
    if ol.get("ch_hook"):
        lines.append(f"**章末钩子**：{ol['ch_hook']}")
        lines.append("")
    if ol.get("ch_summary"):
        lines.append("## 章节摘要")
        lines.append("")
        lines.append(ol["ch_summary"])
        lines.append("")
    return "\n".join(lines)


def _build_hooks_registry(project: dict, hooks: list) -> dict:
    """构建 hooks_registry.json 结构。"""
    return {
        "_comment": (
            f"DreamTale 导出的伏笔登记表（项目：{project.get('name', '')}）。"
            "由 export-vault 接口生成。"
        ),
        "_comment_status": "status 枚举：planted=已埋设 / half=半回收 / recycled=已回收",
        "_comment_priority": "priority 枚举：P0=必回收 / P1=应回收 / P2=可选",
        "project_id": project.get("id"),
        "project_name": project.get("name", ""),
        "exported_at": _now(),
        "hooks": [
            {
                "hook_id": h.get("hook_id", ""),
                "title": h.get("title", ""),
                "status": h.get("status", "planted"),
                "planted_ch": h.get("planted_ch"),
                "recycle_ch": h.get("recycle_ch"),
                "priority": h.get("priority", "P1"),
                "note": h.get("note", "") or "",
            }
            for h in hooks
        ],
    }


# ============================================================
# 静态文件托管
# ============================================================

# 确保 static/ 目录存在（前端 agent 会往里放文件），以便 StaticFiles 挂载不报错
STATIC_DIR.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index() -> Any:
    """根路径返回 static/index.html；若不存在则返回 API 状态 JSON。"""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return JSONResponse(
        {
            "name": "DreamTale API",
            "docs": "/docs",
            "status": "running",
            "note": "static/index.html 尚未创建，前端 agent 创建后将自动托管。",
        }
    )


# ============================================================
# 全局异常处理（打印 traceback）
# ============================================================

@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException):
    """HTTPException 统一返回 JSON。"""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """未捕获异常打印 traceback 并返回 500。"""
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"服务器内部错误：{exc}"},
    )


# ============================================================
# 入口
# ============================================================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=7860)
