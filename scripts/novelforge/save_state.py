"""NovelForge 状态机核心脚本。

负责 JSON Delta 增量合并、Schema 校验、原子写入、自动 git commit。
所有 Skill 状态更新的唯一入口，禁止 Trae Agent 直接 Read+Edit JSON（有覆盖风险）。

设计哲学：
- Vault SSOT：``NovelForge_Vault/.state/`` 下的 JSON 是唯一真相来源
- Delta 增量：禁止整对象覆盖，所有更新必须通过 op（set/append/remove/merge）
- 原子写入：临时文件 + ``os.replace``，避免半写状态
- 校验前置：每个 op 应用后立即校验，任一失败全部回滚（内存丢弃即回滚）
- 与 schema.py 共享校验：从同包 import ``validate_*``，不重复实现

CLI 速查：
    # 从文件读 Delta
    python -m scripts.novelforge.save_state --delta path/to/delta.json

    # 直接传 JSON 字符串
    python -m scripts.novelforge.save_state --json '{"chapter":"ch_042","ops":[...]}'

    # 只校验不写入
    python -m scripts.novelforge.save_state --dry-run --delta delta.json

    # 禁用自动 git commit
    python -m scripts.novelforge.save_state --delta delta.json --no-commit

    # 覆盖 Vault 根路径
    python -m scripts.novelforge.save_state --delta delta.json --vault /path/to/vault

Python import：
    from scripts.novelforge.save_state import apply_delta
    apply_delta(delta_dict)
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from typing import Any

# 复用同包 schema 校验
try:
    from .schema import (
        validate_character_state,
        validate_foreshadow,
        validate_delta,
    )
except ImportError:  # 兼容直接 python scripts/novelforge/save_state.py 调用
    from scripts.novelforge.schema import (  # type: ignore
        validate_character_state,
        validate_foreshadow,
        validate_delta,
    )


# ============================================================================
# 常量
# ============================================================================
DEFAULT_VAULT: str = "/workspace/NovelForge_Vault"

# 各状态文件的相对路径
STATE_DIR_REL: str = ".state"
CHARACTERS_DIR_REL: str = ".state/characters"
HOOKS_REGISTRY_REL: str = "04_大纲与脉络/hooks_registry.json"
WORLD_TIMELINE_REL: str = ".state/world_timeline.json"
PIPELINE_REL: str = ".state/pipeline.json"
STATE_LOG_REL: str = ".state/state_update_log.json"
CHARACTERS_INDEX_REL: str = ".state/characters_index.md"

# 章号正则：ch_042 → 42
CHAPTER_RE: re.Pattern[str] = re.compile(r"ch_(\d+)", re.IGNORECASE)

# ============================================================================
# 默认模板（目标文件不存在时初始化用）
# ============================================================================
EMPTY_CHARACTER_TEMPLATE: dict[str, Any] = {
    "character_id": "",
    "basic": {
        "name": "",
        "aliases": [],
        "role": "protagonist",
        "age": None,
        "appearance_keywords": [],
    },
    "location": {
        "current": "",
        "last_updated_ch": 0,
        "recent_trajectory": [],
    },
    "power_level": {
        "realm": "",
        "realm_progress": 0,
        "abilities": [],
        "limitations": [],
        "next_breakthrough": {},
    },
    "inventory": [],
    "emotion": {
        "current": "",
        "last_updated_ch": 0,
        "recent_arc": [],
        "baseline": "",
    },
    "relationships": [],
    "knowledge": {
        "known_facts": [],
        "unknown_facts": [],
        "misconceptions": [],
    },
    "unresolved_personal_arcs": [],
    "goals": {
        "short_term": "",
        "long_term": "",
        "secret_goal": "",
    },
    "language_fingerprint": {
        "avg_sentence_length": 12,
        "preferred_words": [],
        "catchphrases": [],
        "forbidden_words": [],
        "address_habits": {},
    },
    "arc_stage": "",
    "last_appeared_ch": 0,
    "first_appear_ch": 1,
    "status": "active",
}

EMPTY_HOOKS_REGISTRY: dict[str, Any] = {
    "version": "1.0.0",
    "hooks": [],
}

EMPTY_WORLD_TIMELINE: dict[str, Any] = {
    "version": "1.0.0",
    "era": "",
    "current_world_date": "",
    "events": [],
}

EMPTY_PIPELINE: dict[str, Any] = {
    "current_chapter": 0,
    "current_volume": 1,
    "mode": "novel",
    "current_stage": "idle",
    "stages": [
        "architect",
        "hook_auditor",
        "context_composer",
        "writer",
        "polisher",
        "state_update",
    ],
    "history": [],
    # 守护 Skill 进度字段（与 schema.PIPELINE_SCHEMA 同步）
    "last_recap_chapter": 0,
    "last_drift_check_chapter": 0,
    "archived_scenes": [],
    "last_consistency_check_chapter": 0,
}

EMPTY_STATE_LOG: dict[str, Any] = {
    "version": "1.0.0",
    "logs": [],
}


# ============================================================================
# 工具函数
# ============================================================================
def _state_file_path(vault: str, rel: str) -> str:
    """返回 Vault 下状态文件的绝对路径。"""
    return os.path.join(vault, rel)


def _load_json(path: str, default: dict[str, Any] | None = None) -> dict[str, Any]:
    """读取 JSON 文件；不存在则返回 default 的深拷贝。"""
    if not os.path.exists(path):
        return copy.deepcopy(default) if default is not None else {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _atomic_write_json(path: str, data: dict[str, Any]) -> None:
    """原子写入 JSON：先写同目录 .tmp 再 ``os.replace`` 替换。

    同目录保证 ``os.replace`` 在同一文件系统上是原子操作。
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix="." + os.path.basename(path) + "_",
        suffix=".tmp",
        dir=os.path.dirname(path),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)
    except Exception:
        # 出错时清理临时文件，避免残留
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def _atomic_write_text(path: str, text: str) -> None:
    """原子写入文本文件（用于 characters_index.md）。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix="." + os.path.basename(path) + "_",
        suffix=".tmp",
        dir=os.path.dirname(path),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def _parse_chapter_num(chapter: str) -> int:
    """从 ``ch_042`` 解析出整数章号 42，失败返回 0。"""
    m = CHAPTER_RE.search(chapter or "")
    if m:
        return int(m.group(1))
    return 0


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """深合并：patch 覆盖 base 同名字段，保留 base 未提及字段。

    递归对嵌套 dict 做合并；非 dict 类型直接覆盖。
    """
    for key, val in patch.items():
        if (
            key in base
            and isinstance(base[key], dict)
            and isinstance(val, dict)
        ):
            _deep_merge(base[key], val)
        else:
            base[key] = copy.deepcopy(val)
    return base


# ============================================================================
# 路由：path → 目标文件 + 子路径
# ============================================================================
class PathTarget:
    """解析后的 path 目标信息。

    Attributes:
        kind: ``character`` / ``hooks`` / ``world_timeline`` / ``pipeline``
        file_abs: 目标文件绝对路径
        name: character 名 / hook_id；其余为 None
        sub_path: 文件内剩余路径片段（list[str]）
    """

    def __init__(
        self,
        kind: str,
        file_abs: str,
        name: str | None,
        sub_path: list[str],
    ) -> None:
        self.kind = kind
        self.file_abs = file_abs
        self.name = name
        self.sub_path = sub_path


def _route_path(path: str, vault: str) -> PathTarget:
    """路由 delta path 到目标文件与子路径。

    路由规则：
        - ``characters/<name>/...``  → ``.state/characters/<name>.json``
        - ``hooks/<hook_id>`` 或 ``hooks/<hook_id>/<field>``
          → ``04_大纲与脉络/hooks_registry.json``
        - ``world_timeline`` 或 ``world_timeline/...``
          → ``.state/world_timeline.json``
        - ``pipeline`` 或 ``pipeline/...``
          → ``.state/pipeline.json``
    """
    segments = [p for p in path.split("/") if p]
    if not segments:
        raise ValueError(f"非法 path（空）: {path!r}")

    root = segments[0]
    rest = segments[1:]

    if root == "characters":
        if not rest:
            raise ValueError(
                f"characters path 必须带角色名: {path!r}"
            )
        name = rest[0]
        sub = rest[1:]
        file_abs = _state_file_path(
            vault, f"{CHARACTERS_DIR_REL}/{name}.json"
        )
        return PathTarget("character", file_abs, name, sub)

    if root == "hooks":
        if not rest:
            raise ValueError(
                f"hooks path 必须带 hook_id: {path!r}"
            )
        hook_id = rest[0]
        sub = rest[1:]
        file_abs = _state_file_path(vault, HOOKS_REGISTRY_REL)
        return PathTarget("hooks", file_abs, hook_id, sub)

    if root == "world_timeline":
        file_abs = _state_file_path(vault, WORLD_TIMELINE_REL)
        return PathTarget("world_timeline", file_abs, None, rest)

    if root == "pipeline":
        file_abs = _state_file_path(vault, PIPELINE_REL)
        return PathTarget("pipeline", file_abs, None, rest)

    raise ValueError(
        f"无法识别的 path 根: {root!r} (path={path!r})；"
        f"支持 characters/ / hooks/ / world_timeline / pipeline"
    )


# ============================================================================
# Op 应用：在单个 dict 上执行 op（通用工具）
# ============================================================================
def _navigate_to_parent(
    data: dict[str, Any],
    sub_path: list[str],
) -> tuple[dict[str, Any], str]:
    """导航到 sub_path 的父节点，返回 (parent, last_key)。

    自动创建中间 dict 节点（用于 op=set/merge/append）。
    """
    if not sub_path:
        raise ValueError("sub_path 为空，无法导航")
    cur: dict[str, Any] = data
    for key in sub_path[:-1]:
        if not isinstance(cur, dict):
            raise ValueError(f"路径中间节点不是 dict: {key!r}")
        if key not in cur or not isinstance(cur[key], dict):
            cur[key] = {}
        cur = cur[key]
    last_key = sub_path[-1]
    if not isinstance(cur, dict):
        raise ValueError(f"父节点不是 dict，无法设置字段: {last_key!r}")
    return cur, last_key


def _apply_op_to_dict(
    state: dict[str, Any],
    op: dict[str, Any],
    sub_path: list[str],
) -> None:
    """在通用 dict 上执行单个 op（set/append/remove/merge）。

    被 character / hook 字段级 / pipeline 字段级 / world_timeline 字段级 共用。
    """
    op_name = op["op"]
    value = op.get("value")

    if op_name == "set":
        parent, key = _navigate_to_parent(state, sub_path)
        parent[key] = copy.deepcopy(value)
    elif op_name == "append":
        parent, key = _navigate_to_parent(state, sub_path)
        if key not in parent or parent[key] is None:
            parent[key] = []
        if not isinstance(parent[key], list):
            raise ValueError(
                f"append 目标不是 list: {key!r} (实际 {type(parent[key]).__name__})"
            )
        parent[key].append(copy.deepcopy(value))
    elif op_name == "merge":
        parent, key = _navigate_to_parent(state, sub_path)
        if key not in parent or not isinstance(parent[key], dict):
            parent[key] = {}
        if not isinstance(parent[key], dict):
            raise ValueError(
                f"merge 目标不是 dict: {key!r} (实际 {type(parent[key]).__name__})"
            )
        if not isinstance(value, dict):
            raise ValueError(
                f"merge value 必须是 dict (实际 {type(value).__name__})"
            )
        _deep_merge(parent[key], copy.deepcopy(value))
    elif op_name == "remove":
        parent, key = _navigate_to_parent(state, sub_path)
        if key in parent:
            del parent[key]
    else:
        raise ValueError(f"未知 op: {op_name!r}")


def _apply_op_to_hooks(
    registry: dict[str, Any],
    op: dict[str, Any],
    hook_id: str,
    sub_path: list[str],
) -> None:
    """在 hooks_registry 上执行 op。

    - ``hooks/<hook_id>`` + ``op=remove`` → 从 hooks 列表删除
    - ``hooks/<hook_id>`` + ``op=set``     → 替换/新增整个 hook 对象
    - ``hooks/<hook_id>`` + ``op=merge``   → 深合并到 hook 对象（不存在则新建）
    - ``hooks/<hook_id>/<field>`` + 任意 op → 在 hook 内操作字段
    """
    op_name = op["op"]
    value = op.get("value")
    hooks: list[Any] = registry.setdefault("hooks", [])

    # 定位目标 hook 索引
    idx = -1
    for i, h in enumerate(hooks):
        if isinstance(h, dict) and h.get("hook_id") == hook_id:
            idx = i
            break

    # 整 hook 操作（无 sub_path）
    if not sub_path:
        if op_name == "remove":
            if idx >= 0:
                hooks.pop(idx)
            return
        if op_name == "set":
            if not isinstance(value, dict):
                raise ValueError("hooks/<id> set 需要 dict value")
            new_hook = copy.deepcopy(value)
            if "hook_id" not in new_hook:
                new_hook["hook_id"] = hook_id
            if idx >= 0:
                hooks[idx] = new_hook
            else:
                hooks.append(new_hook)
            return
        if op_name == "merge":
            if not isinstance(value, dict):
                raise ValueError("hooks/<id> merge 需要 dict value")
            if idx < 0:
                new_hook: dict[str, Any] = {"hook_id": hook_id}
                _deep_merge(new_hook, copy.deepcopy(value))
                hooks.append(new_hook)
            else:
                _deep_merge(hooks[idx], copy.deepcopy(value))
            return
        if op_name == "append":
            raise ValueError(
                "hooks/<id> 整对象不支持 append；请用 set 或 merge"
            )
        raise ValueError(f"未知 op: {op_name!r}")

    # 字段级操作（有 sub_path）
    if idx < 0:
        raise ValueError(
            f"伏笔 {hook_id} 不存在，无法设置字段 {sub_path[0]!r}；"
            f"请先用 op=set hooks/{hook_id} 创建完整伏笔"
        )
    _apply_op_to_dict(hooks[idx], op, sub_path)


def _apply_op_to_world_timeline(
    state: dict[str, Any],
    op: dict[str, Any],
    sub_path: list[str],
) -> None:
    """在 world_timeline.json 上执行 op。

    特殊：``path=world_timeline`` 且 ``op=append`` 时，默认追加到 events 数组。
    """
    op_name = op["op"]
    value = op.get("value")

    # 无 sub_path：默认对 events 数组操作
    if not sub_path:
        events = state.setdefault("events", [])
        if op_name == "append":
            if not isinstance(value, dict):
                raise ValueError("world_timeline append 需要 dict value")
            events.append(copy.deepcopy(value))
        elif op_name == "set":
            if not isinstance(value, list):
                raise ValueError("world_timeline set 需要 list value（events 数组）")
            state["events"] = copy.deepcopy(value)
        elif op_name == "merge":
            if not isinstance(value, dict):
                raise ValueError("world_timeline merge 需要 dict value")
            _deep_merge(state, copy.deepcopy(value))
        elif op_name == "remove":
            raise ValueError(
                "world_timeline 整对象不支持 remove；请指定字段或用 hooks/<id>"
            )
        else:
            raise ValueError(f"未知 op: {op_name!r}")
        return

    # 有 sub_path：按通用方式导航（如 world_timeline/current_world_date）
    _apply_op_to_dict(state, op, sub_path)


def _apply_op_to_pipeline(
    state: dict[str, Any],
    op: dict[str, Any],
    sub_path: list[str],
) -> None:
    """在 pipeline.json 上执行 op。"""
    op_name = op["op"]

    if not sub_path:
        # 整 pipeline 对象：只支持 merge / set
        value = op.get("value")
        if op_name == "merge":
            if not isinstance(value, dict):
                raise ValueError("pipeline merge 需要 dict value")
            _deep_merge(state, copy.deepcopy(value))
        elif op_name == "set":
            if not isinstance(value, dict):
                raise ValueError("pipeline set 需要 dict value")
            state.clear()
            state.update(copy.deepcopy(value))
        else:
            raise ValueError(
                f"pipeline 整对象不支持 op={op_name}（用 merge 或带子路径）"
            )
        return

    _apply_op_to_dict(state, op, sub_path)


# ============================================================================
# 单个 op 调度
# ============================================================================
def _apply_op(
    file_states: dict[str, dict[str, Any]],
    op: dict[str, Any],
    vault: str,
) -> str:
    """执行单个 op，返回目标文件绝对路径。

    Args:
        file_states: 文件状态缓存 ``{file_abs: current_state_dict}``；
                     会被原地修改（用于事务性批量应用）。
        op: delta op dict，至少含 ``op`` / ``path`` 字段。
        vault: Vault 根目录。

    Returns:
        目标文件绝对路径。

    Raises:
        ValueError: op 应用或校验失败。
    """
    target = _route_path(op["path"], vault)

    # 加载初始状态（缓存避免重复读盘；首用即装入）
    if target.file_abs not in file_states:
        if target.kind == "character":
            # 角色文件不存在则用空模板，并自动填 character_id
            default = copy.deepcopy(EMPTY_CHARACTER_TEMPLATE)
            if target.name:
                default["character_id"] = target.name
            # 若磁盘已有文件，覆盖用真实内容
            if os.path.exists(target.file_abs):
                file_states[target.file_abs] = _load_json(
                    target.file_abs, default
                )
            else:
                file_states[target.file_abs] = default
        elif target.kind == "hooks":
            file_states[target.file_abs] = _load_json(
                target.file_abs, EMPTY_HOOKS_REGISTRY
            )
        elif target.kind == "world_timeline":
            file_states[target.file_abs] = _load_json(
                target.file_abs, EMPTY_WORLD_TIMELINE
            )
        elif target.kind == "pipeline":
            file_states[target.file_abs] = _load_json(
                target.file_abs, EMPTY_PIPELINE
            )
        else:
            file_states[target.file_abs] = _load_json(target.file_abs, {})

    state = file_states[target.file_abs]

    # 按类型分派
    if target.kind == "character":
        _apply_op_to_dict(state, op, target.sub_path)
        errors = validate_character_state(state)
        if errors:
            raise ValueError(
                f"角色 state 校验失败 [{target.name}]: {'; '.join(errors)}"
            )
    elif target.kind == "hooks":
        _apply_op_to_hooks(state, op, target.name or "", target.sub_path)
        # 校验单条伏笔（set/merge 整对象 + 字段级操作 都校验）
        hooks = state.get("hooks", [])
        target_hook: dict[str, Any] | None = None
        for h in hooks:
            if isinstance(h, dict) and h.get("hook_id") == target.name:
                target_hook = h
                break
        if target_hook is not None and op["op"] != "remove":
            errors = validate_foreshadow(target_hook)
            if errors:
                raise ValueError(
                    f"伏笔校验失败 [{target.name}]: {'; '.join(errors)}"
                )
    elif target.kind == "world_timeline":
        _apply_op_to_world_timeline(state, op, target.sub_path)
    elif target.kind == "pipeline":
        _apply_op_to_pipeline(state, op, target.sub_path)

    return target.file_abs


# ============================================================================
# 辅助：摘要 / 索引 / 日志 / 世界事件 / git
# ============================================================================
def _build_summary(delta: dict[str, Any]) -> str:
    """从 delta 提取摘要用于 log 与 commit message。

    优先使用 hooks_planted / hooks_resolved / world_events；
    都没有则退化为 op 数量与类型。
    """
    parts: list[str] = []
    planted = delta.get("hooks_planted") or []
    resolved = delta.get("hooks_resolved") or []
    world_events = delta.get("world_events") or []

    if planted:
        parts.append(f"埋设伏笔 {','.join(planted)}")
    if resolved:
        parts.append(f"回收伏笔 {','.join(resolved)}")
    if world_events:
        # 取第一条事件的描述作为摘要
        first = world_events[0]
        if isinstance(first, dict):
            evt = first.get("event") or first.get("description") or ""
            if evt:
                evt_short = evt if len(evt) <= 30 else evt[:30] + "…"
                parts.append(f"世界事件: {evt_short}")
    if not parts:
        ops = delta.get("ops") or []
        op_kinds = [o.get("op", "?") for o in ops]
        parts.append(f"{len(ops)} ops ({','.join(op_kinds)})")
    return "；".join(parts)


def _regen_characters_index(vault: str) -> str:
    """重新生成 ``characters_index.md``，返回其绝对路径。

    格式：``| <name> | <role> | <location.current> | <status> | <last_appeared_ch> | <filename> |``
    """
    chars_dir = _state_file_path(vault, CHARACTERS_DIR_REL)
    lines: list[str] = [
        "# 角色索引（characters_index）",
        "",
        "> 本文件由 `scripts/novelforge/save_state.py` 自动生成，**禁止手动编辑**。",
        "> 每次新增/修改 `.state/characters/*.json` 后触发重生成。",
        "",
        "---",
        "",
        "## 角色清单",
        "",
        "| name | role | location.current | status | last_appeared_ch | filename |",
        "|---|---|---|---|---|---|",
    ]

    rows: list[str] = []
    if os.path.isdir(chars_dir):
        files = sorted(
            f for f in os.listdir(chars_dir) if f.endswith(".json")
        )
        for fname in files:
            path = os.path.join(chars_dir, fname)
            try:
                data = _load_json(path)
            except (OSError, json.JSONDecodeError):
                continue
            name = (
                data.get("basic", {}).get("name")
                or data.get("character_id", "")
                or fname[:-5]
            )
            role = data.get("basic", {}).get("role", "")
            loc = data.get("location", {}).get("current", "")
            status = data.get("status", "")
            last_ch = data.get("last_appeared_ch", 0)
            rows.append(
                f"| {name} | {role} | {loc} | {status} | {last_ch} | `{fname}` |"
            )

    if not rows:
        rows.append("| （无角色文件） |  |  |  |  |  |")
    lines.extend(rows)

    lines.extend([
        "",
        "---",
        "",
        f"> 最后更新：{datetime.now().strftime('%Y-%m-%d %H:%M')}"
        "（save_state.py 自动写入）",
    ])

    index_path = _state_file_path(vault, CHARACTERS_INDEX_REL)
    _atomic_write_text(index_path, "\n".join(lines) + "\n")
    return index_path


def _append_state_log(
    vault: str,
    chapter: str,
    ops_count: int,
    files_changed: list[str],
    summary: str,
) -> None:
    """追加一条更新记录到 ``state_update_log.json``。"""
    log_path = _state_file_path(vault, STATE_LOG_REL)
    log_data = _load_json(log_path, EMPTY_STATE_LOG)
    logs = log_data.setdefault("logs", [])
    # 自增 log_id
    next_id = 1
    for entry in logs:
        if isinstance(entry, dict) and isinstance(entry.get("log_id"), int):
            next_id = max(next_id, entry["log_id"] + 1)
    entry = {
        "log_id": next_id,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "chapter": chapter,
        "ops_count": ops_count,
        "files_changed": files_changed,
        "summary": summary,
    }
    logs.append(entry)
    _atomic_write_json(log_path, log_data)


def _append_world_events(
    file_states: dict[str, dict[str, Any]],
    delta: dict[str, Any],
    vault: str,
) -> str | None:
    """把 ``delta.world_events`` 追加到 ``world_timeline.json``。

    自动转换为完整事件格式（补 ``event_id`` / ``chapter_anchor`` 等）。

    Returns:
        world_timeline.json 绝对路径（若有事件被追加），否则 None。
    """
    world_events = delta.get("world_events") or []
    if not world_events:
        return None

    target_file = _state_file_path(vault, WORLD_TIMELINE_REL)
    if target_file not in file_states:
        file_states[target_file] = _load_json(target_file, EMPTY_WORLD_TIMELINE)
    state = file_states[target_file]
    events = state.setdefault("events", [])

    chapter_num = _parse_chapter_num(delta.get("chapter", ""))
    # 找最大 event_id 序号，自增生成新 ID
    max_n = 0
    for e in events:
        eid = e.get("event_id", "") if isinstance(e, dict) else ""
        if isinstance(eid, str) and eid.startswith("W-"):
            try:
                max_n = max(max_n, int(eid[2:]))
            except ValueError:
                pass

    for we in world_events:
        if not isinstance(we, dict):
            continue
        max_n += 1
        events.append({
            "event_id": f"W-{max_n:03d}",
            "world_date": we.get("time", ""),
            "chapter_anchor": chapter_num,
            "event_type": "world",
            "description": we.get("event", ""),
            "related_characters": [],
            "impact": "",
        })

    return target_file


def _git_commit(
    vault: str,
    files: list[str],
    message: str,
) -> str | None:
    """对改动的文件执行 ``git add`` + ``git commit``，返回 commit hash 或 None。

    失败只 warning 不 raise（commit 不阻塞主流程）。
    """
    # 检查是否在 git 仓库内
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=vault,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0 or result.stdout.strip() != "true":
            print(
                "[WARNING] 不在 git 仓库内，跳过 commit",
                file=sys.stderr,
            )
            return None
    except (subprocess.SubprocessError, OSError) as e:
        print(f"[WARNING] git 检测失败: {e}", file=sys.stderr)
        return None

    # git add（按 Vault 相对路径）
    rel_files: list[str] = []
    for f in files:
        try:
            rel = os.path.relpath(f, vault)
            rel_files.append(rel)
        except ValueError:
            rel_files.append(f)

    try:
        subprocess.run(
            ["git", "add", "--"] + rel_files,
            cwd=vault,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        result = subprocess.run(
            ["git", "commit", "-m", message],
            cwd=vault,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            # 可能没有变更（"nothing to commit"）
            msg = (result.stdout + result.stderr).strip()
            if "nothing to commit" in msg or "no changes" in msg:
                return None
            print(
                f"[WARNING] git commit 失败: {msg[:200]}",
                file=sys.stderr,
            )
            return None
        # 取 commit hash
        hash_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=vault,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if hash_result.returncode == 0:
            return hash_result.stdout.strip()
    except (subprocess.SubprocessError, OSError) as e:
        print(f"[WARNING] git 操作异常: {e}", file=sys.stderr)
    return None


# ============================================================================
# 主入口：apply_delta
# ============================================================================
def apply_delta(
    delta: dict[str, Any],
    vault: str = DEFAULT_VAULT,
    dry_run: bool = False,
    no_commit: bool = False,
) -> dict[str, Any]:
    """应用一个 Delta，执行所有 op 并落盘。

    Args:
        delta: Delta dict，必须符合 ``DELTA_SCHEMA``。
        vault: Vault 根目录，默认 ``/workspace/NovelForge_Vault``。
        dry_run: ``True`` 则只校验不写入。
        no_commit: ``True`` 则跳过自动 git commit。

    Returns:
        结果 dict，结构::

            {
                "ok": True/False,
                "chapter": "ch_042",
                "ops_count": 5,
                "files_changed": ["/abs/path/to/protagonist.json", ...],
                "summary": "...",
                "commit_hash": "abc123..." or None,
                "dry_run": False,
                "errors": [...]  # ok=False 时
            }

    Raises:
        ValueError: Delta 格式不合法或 op 应用失败（含校验失败）。
            任一 op 失败则全部回滚（内存丢弃，不落盘）。
    """
    # === a. Delta 格式校验 ===
    errors = validate_delta(delta)
    if errors:
        raise ValueError(
            "Delta 校验失败:\n  - " + "\n  - ".join(errors)
        )

    chapter = delta.get("chapter", "")
    ops = delta.get("ops", [])

    # === b. 逐 op 执行（仅在内存中，不落盘）===
    # file_states: {file_abs: state_dict}，所有改动先在内存里做
    file_states: dict[str, dict[str, Any]] = {}
    changed_files: set[str] = set()

    for i, op in enumerate(ops):
        try:
            target_file = _apply_op(file_states, op, vault)
            changed_files.add(target_file)
        except ValueError as e:
            # 任一 op 失败：丢弃内存中的 file_states 即"回滚"
            raise ValueError(
                f"ops[{i}] 应用失败 "
                f"(path={op.get('path')!r}, op={op.get('op')!r}): {e}"
            ) from e

    # === 追加 delta.world_events 到 world_timeline.json ===
    wt_file = _append_world_events(file_states, delta, vault)
    if wt_file is not None:
        changed_files.add(wt_file)

    summary = _build_summary(delta)

    # === dry-run：到此为止，不落盘 ===
    if dry_run:
        return {
            "ok": True,
            "chapter": chapter,
            "ops_count": len(ops),
            "files_changed": sorted(changed_files),
            "summary": summary,
            "commit_hash": None,
            "dry_run": True,
            "errors": [],
        }

    # 没有实际改动：直接返回，不写 log 不 commit
    if not changed_files:
        return {
            "ok": True,
            "chapter": chapter,
            "ops_count": len(ops),
            "files_changed": [],
            "summary": summary,
            "commit_hash": None,
            "dry_run": False,
            "errors": [],
        }

    # === c. 全部成功 → 原子写入所有改动文件 ===
    changed_files_sorted = sorted(changed_files)
    for file_abs in changed_files_sorted:
        _atomic_write_json(file_abs, file_states[file_abs])

    # === d. characters_index.md 重生成（若有 characters 文件改动）===
    chars_touched = any(
        os.path.relpath(f, vault).startswith(CHARACTERS_DIR_REL)
        for f in changed_files_sorted
    )
    if chars_touched:
        index_path = _regen_characters_index(vault)
        changed_files_sorted.append(index_path)

    # === e. state_update_log.json 追加（不计入 files_changed 头条数）===
    # 日志的 files_changed 字段记录 op 触及的文件（不含索引与日志本身）
    rel_op_files = [
        os.path.relpath(f, vault) for f in changed_files_sorted
        if not f.endswith("characters_index.md")
    ]
    _append_state_log(
        vault,
        chapter=chapter,
        ops_count=len(ops),
        files_changed=rel_op_files,
        summary=summary,
    )

    # === f. git commit（可选，默认开启）===
    commit_hash: str | None = None
    if not no_commit:
        commit_msg = f"state({chapter}): {summary}"
        # 把 state_update_log.json 也加入 commit
        commit_files = list(changed_files_sorted) + [
            _state_file_path(vault, STATE_LOG_REL),
        ]
        commit_hash = _git_commit(vault, commit_files, commit_msg)

    return {
        "ok": True,
        "chapter": chapter,
        "ops_count": len(ops),
        "files_changed": changed_files_sorted,
        "summary": summary,
        "commit_hash": commit_hash,
        "dry_run": False,
        "errors": [],
    }


# ============================================================================
# CLI
# ============================================================================
def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.novelforge.save_state",
        description=(
            "NovelForge 状态机：Delta 增量更新 + Schema 校验 + 原子写入 + git commit"
        ),
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--delta",
        help="Delta JSON 文件路径",
    )
    src.add_argument(
        "--json",
        dest="json_str",
        help="Delta JSON 字符串（直接传内联 JSON）",
    )
    parser.add_argument(
        "--vault",
        default=DEFAULT_VAULT,
        help=f"Vault 根目录（默认 {DEFAULT_VAULT}）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只校验不写入",
    )
    parser.add_argument(
        "--no-commit",
        dest="no_commit",
        action="store_true",
        help="跳过自动 git commit",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI 入口，返回退出码（0=成功，1=失败）。"""
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    # 读取 Delta
    if args.delta:
        delta_path = args.delta
        if not os.path.exists(delta_path):
            print(f"[FAIL] Delta 文件不存在: {delta_path}", file=sys.stderr)
            return 1
        try:
            with open(delta_path, "r", encoding="utf-8") as f:
                delta = json.load(f)
        except json.JSONDecodeError as e:
            print(f"[FAIL] Delta JSON 解析失败: {e}", file=sys.stderr)
            return 1
    else:
        try:
            delta = json.loads(args.json_str)
        except json.JSONDecodeError as e:
            print(f"[FAIL] --json 解析失败: {e}", file=sys.stderr)
            return 1

    # 执行
    try:
        result = apply_delta(
            delta,
            vault=args.vault,
            dry_run=args.dry_run,
            no_commit=args.no_commit,
        )
    except ValueError as e:
        print(f"[FAIL] {e}", file=sys.stderr)
        return 1

    # 输出
    if result["dry_run"]:
        if result["files_changed"]:
            rel_files = ", ".join(
                os.path.relpath(f, args.vault) for f in result["files_changed"]
            )
        else:
            rel_files = "（无）"
        print(
            f"[DRY-RUN] 校验通过，未写入。将改动：{rel_files}"
        )
        return 0

    if not result["ok"]:
        errs = result.get("errors") or []
        print(
            f"[FAIL] {'; '.join(errs) if errs else '未知错误'}",
            file=sys.stderr,
        )
        return 1

    if result["files_changed"]:
        rel_files = ", ".join(
            os.path.relpath(f, args.vault) for f in result["files_changed"]
        )
    else:
        rel_files = "（无）"
    msg = (
        f"[OK] {result['chapter']} 状态已更新："
        f"{result['ops_count']} ops, 改动 {len(result['files_changed'])} 文件"
    )
    if result.get("commit_hash"):
        msg += f" | commit {result['commit_hash'][:8]}"
    msg += f"\n  文件: {rel_files}"
    print(msg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
