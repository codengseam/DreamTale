# -*- coding: utf-8 -*-
"""DreamTale 数据库连接与通用 CRUD 工具。

基于 Python 标准库 sqlite3，不引入 ORM。
提供连接管理、建表初始化、通用查询/执行工具。

路径策略：
    - 默认数据库文件：``<项目根>/data/dreamtale.db``
    - 可通过环境变量 ``DREAMTALE_DB`` 覆盖（绝对路径或相对项目根的路径）
"""

from __future__ import annotations

import os
import sqlite3
from typing import Any, Optional

# ---------------------------------------------------------------------------
# 路径配置
# ---------------------------------------------------------------------------

# 项目根目录：本文件位于 <root>/scripts/dreamtale/db.py，向上三级
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 数据库文件默认路径：相对项目根目录的 data/dreamtale.db
# 可通过环境变量 DREAMTALE_DB 覆盖
DB_PATH = os.environ.get(
    "DREAMTALE_DB",
    os.path.join(_PROJECT_ROOT, "data", "dreamtale.db"),
)

# schema.sql 路径（与本文件同目录）
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")


# ---------------------------------------------------------------------------
# 连接与初始化
# ---------------------------------------------------------------------------

def get_conn() -> sqlite3.Connection:
    """获取 SQLite 数据库连接。

    返回启用外键级联、行工厂为 ``sqlite3.Row`` 的连接对象。
    若数据库文件父目录不存在会自动创建。

    Returns:
        已配置好的 sqlite3.Connection。
    """
    # 解析路径：相对路径按项目根目录解析
    db_path = DB_PATH
    if not os.path.isabs(db_path):
        db_path = os.path.join(_PROJECT_ROOT, db_path)

    # 自动创建父目录
    parent = os.path.dirname(db_path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """读取 schema.sql 执行建表，初始化数据库。

    幂等操作：schema.sql 中使用 ``IF NOT EXISTS``，可重复执行。
    执行后所有 7 张表（projects/chapters/outlines/hooks/highlights/characters/world_settings）就绪。
    """
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema_sql = f.read()
    with get_conn() as conn:
        conn.executescript(schema_sql)


# ---------------------------------------------------------------------------
# 通用 CRUD 工具
# ---------------------------------------------------------------------------

def query(sql: str, params: tuple = ()) -> list[dict]:
    """执行查询，返回 ``list[dict]``。

    Args:
        sql: SQL 查询语句（使用 ``?`` 占位符）。
        params: 参数元组，默认空。

    Returns:
        每行转为 dict 的列表；无结果时返回空列表。
    """
    with get_conn() as conn:
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def query_one(sql: str, params: tuple = ()) -> Optional[dict]:
    """执行查询，返回单行 ``dict | None``。

    Args:
        sql: SQL 查询语句（使用 ``?`` 占位符）。
        params: 参数元组，默认空。

    Returns:
        首行转为 dict；无结果返回 None。
    """
    with get_conn() as conn:
        cur = conn.execute(sql, params)
        row = cur.fetchone()
    return dict(row) if row else None


def execute(sql: str, params: tuple = ()) -> int:
    """执行写操作（INSERT/UPDATE/DELETE），返回 lastrowid。

    Args:
        sql: SQL 写语句（使用 ``?`` 占位符）。
        params: 参数元组，默认空。

    Returns:
        最后插入行的 rowid；UPDATE/DELETE 时可能为 0。
    """
    with get_conn() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid or 0


# ---------------------------------------------------------------------------
# 通用表查询工具
# ---------------------------------------------------------------------------

# 允许通过 table_to_dict 查询的表白名单
# 表名不能用参数化绑定，故用白名单防止 SQL 注入
_ALLOWED_TABLES = {
    "projects", "chapters", "outlines", "hooks",
    "highlights", "characters", "world_settings",
}


def table_to_dict(table: str, project_id: Optional[int] = None) -> list[dict]:
    """通用查询工具：按表名读取数据，返回 ``list[dict]``。

    Args:
        table: 表名，必须在白名单内（projects/chapters/outlines/hooks/
            highlights/characters/world_settings）。
        project_id: 可选，按 project_id 过滤。projects 表无此字段，传入会被忽略。

    Returns:
        每行转为 dict 的列表，按 id 升序。

    Raises:
        ValueError: 表名不在白名单中。
    """
    if table not in _ALLOWED_TABLES:
        raise ValueError(
            f"不支持的表名: {table}（允许: {sorted(_ALLOWED_TABLES)}）"
        )

    # projects 表没有 project_id 字段
    if table == "projects":
        return query(f"SELECT * FROM {table} ORDER BY id")

    if project_id is not None:
        return query(
            f"SELECT * FROM {table} WHERE project_id = ? ORDER BY id",
            (project_id,),
        )
    return query(f"SELECT * FROM {table} ORDER BY id")
