-- ===========================================================================
-- DreamTale 数据库 Schema
-- 7 张表：项目 / 章节 / 大纲 / 伏笔 / 爽点 / 人物 / 世界观设定
-- 幂等：所有表使用 IF NOT EXISTS，可重复执行
-- ===========================================================================

-- 项目表
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subtitle TEXT,
    genre TEXT,
    author TEXT,
    target_words INTEGER DEFAULT 0,
    current_words INTEGER DEFAULT 0,
    volumes_done INTEGER DEFAULT 0,
    volumes_total INTEGER DEFAULT 0,
    chapters_done INTEGER DEFAULT 0,
    chapters_total INTEGER DEFAULT 0,
    status TEXT,
    updated TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 章节表（正文）
CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    vol_no INTEGER NOT NULL,
    ch_no INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    highlights TEXT DEFAULT '',
    words INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',  -- draft / published
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE (project_id, vol_no, ch_no)
);

-- 大纲表（卷→章纲）
CREATE TABLE IF NOT EXISTS outlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    vol_no INTEGER NOT NULL,
    vol_name TEXT,
    vol_goal TEXT,
    ch_no INTEGER NOT NULL,
    ch_title TEXT NOT NULL,
    ch_hook TEXT,
    ch_summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 伏笔表
CREATE TABLE IF NOT EXISTS hooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    hook_id TEXT NOT NULL,  -- 如 H-001
    title TEXT NOT NULL,
    status TEXT DEFAULT 'planted',  -- planted / half / recycled
    planted_ch TEXT,
    recycle_ch TEXT,
    priority TEXT DEFAULT 'P2',  -- P0 / P1 / P2
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 爽点表
CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    ch_no INTEGER NOT NULL,
    name TEXT NOT NULL,
    score REAL NOT NULL,  -- 0-10
    type TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 人物表
CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    identity TEXT,
    level TEXT,
    personality TEXT,
    arc TEXT,
    relation TEXT,
    goal TEXT,
    color TEXT DEFAULT '#3b6fb3',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 世界观设定表
CREATE TABLE IF NOT EXISTS world_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    content TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 启用外键级联
PRAGMA foreign_keys = ON;
