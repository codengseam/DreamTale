"""NovelForge 状态机 JSON Schema 定义。

所有 .state/ 下的 JSON 文件必须符合此处的 Schema。
save_state.py / check_consistency.py / audit_hooks.py 共享此模块做校验。

设计原则：
- 长篇用每角色一个 JSON（.state/characters/<name>.json），短篇可单文件
- Delta 必须带 op 字段（set/append/remove），禁止整对象覆盖
- 字段命名 snake_case，与 Vault Markdown frontmatter 一致
"""
from __future__ import annotations
from typing import Any


# ============================================================================
# 角色状态 Schema（.state/characters/<name>.json）
# ============================================================================
CHARACTER_STATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["character_id", "basic", "location", "status", "last_appeared_ch"],
    "properties": {
        "character_id": {"type": "string", "description": "角色 ID，如 protagonist_linyuan"},
        "basic": {
            "type": "object",
            "required": ["name", "role"],
            "properties": {
                "name": {"type": "string"},
                "aliases": {"type": "array", "items": {"type": "string"}, "default": []},
                "role": {"type": "string", "enum": ["protagonist", "antagonist", "supporting", "extra"]},
                "age": {"type": ["integer", "null"], "default": None},
                "appearance_keywords": {"type": "array", "items": {"type": "string"}, "default": []},
            },
        },
        "location": {
            "type": "object",
            "required": ["current"],
            "properties": {
                "current": {"type": "string", "description": "当前所在地点"},
                "last_updated_ch": {"type": "integer", "default": 0},
                "recent_trajectory": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "ch": {"type": "integer"},
                            "place": {"type": "string"},
                        },
                    },
                    "default": [],
                },
            },
        },
        "power_level": {
            "type": "object",
            "properties": {
                "realm": {"type": "string", "description": "境界/实力等级"},
                "realm_progress": {"type": "number", "minimum": 0, "maximum": 1, "default": 0},
                "power_value": {"type": "integer", "minimum": 1, "maximum": 100, "description": "实力数值化 1-100"},
                "abilities": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "level": {"type": "integer"},
                            "acquired_ch": {"type": "integer"},
                        },
                    },
                    "default": [],
                },
                "limitations": {"type": "array", "items": {"type": "string"}, "default": []},
                "next_breakthrough": {
                    "type": "object",
                    "properties": {
                        "target": {"type": "string"},
                        "expected_ch": {"type": "integer"},
                        "bottleneck": {"type": "string"},
                    },
                },
            },
        },
        "inventory": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item": {"type": "string"},
                    "acquired_ch": {"type": "integer"},
                    "status": {"type": "string", "enum": ["equipped", "consumable", "stored", "lost"]},
                    "source": {"type": "string"},
                },
            },
            "default": [],
        },
        "emotion": {
            "type": "object",
            "properties": {
                "current": {"type": "string"},
                "last_updated_ch": {"type": "integer", "default": 0},
                "recent_arc": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"ch": {"type": "integer"}, "event": {"type": "string"}, "emotion": {"type": "string"}},
                    },
                    "default": [],
                },
                "baseline": {"type": "string"},
            },
        },
        "relationships": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["target", "type"],
                "properties": {
                    "target": {"type": "string", "description": "对方角色 ID 或名字"},
                    "type": {"type": "string", "enum": ["ally", "enemy", "mentor", "lover", "family", "rival", "neutral", "broken"]},
                    "trust": {"type": "integer", "minimum": -100, "maximum": 100},
                    "last_interaction_ch": {"type": "integer"},
                    "history": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"ch": {"type": "integer"}, "event": {"type": "string"}}},
                    },
                },
            },
            "default": [],
        },
        "knowledge": {
            "type": "object",
            "properties": {
                "known_facts": {"type": "array", "items": {"type": "string"}, "default": []},
                "unknown_facts": {"type": "array", "items": {"type": "string"}, "default": [], "description": "防止上帝视角泄露"},
                "misconceptions": {
                    "type": "array",
                    "items": {"type": "object", "properties": {"content": {"type": "string"}, "corrected_ch": {"type": "integer"}}},
                    "default": [],
                },
            },
        },
        "unresolved_personal_arcs": {
            "type": "array",
            "items": {"type": "object", "properties": {"arc": {"type": "string"}, "progress": {"type": "number"}, "related_hooks": {"type": "array", "items": {"type": "string"}}}},
            "default": [],
        },
        "goals": {
            "type": "object",
            "properties": {
                "short_term": {"type": "string"},
                "long_term": {"type": "string"},
                "secret_goal": {"type": "string"},
            },
        },
        "language_fingerprint": {
            "type": "object",
            "description": "去 AI 味对白检查依据",
            "properties": {
                "avg_sentence_length": {"type": "integer", "default": 12},
                "preferred_words": {"type": "array", "items": {"type": "string"}, "default": []},
                "catchphrases": {"type": "array", "items": {"type": "string"}, "default": []},
                "forbidden_words": {"type": "array", "items": {"type": "string"}, "default": []},
                "address_habits": {"type": "object", "default": {}},
            },
        },
        "arc_stage": {"type": "string", "description": "角色弧光阶段，如 awakening_pre/awakening/awakening_post/low/rebound"},
        "last_appeared_ch": {"type": "integer", "default": 0},
        "first_appear_ch": {"type": "integer", "default": 1},
        "status": {"type": "string", "enum": ["active", "dead", "missing", "unknown", "archived"], "default": "active"},
    },
}


# ============================================================================
# 伏笔 Schema（04_大纲与脉络/hooks_registry.json 的 hooks 数组项）
# ============================================================================
FORESHADOW_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["hook_id", "description", "planted_ch", "scope", "status"],
    "properties": {
        "hook_id": {"type": "string", "description": "如 H-001"},
        "description": {"type": "string"},
        "planted_ch": {"type": "integer", "minimum": 1},
        "planted_scene": {"type": "string", "description": "对应关键场景文件名"},
        "scope": {"type": "string", "enum": ["short", "long", "core"], "description": "short卷内/long跨卷/core全书"},
        "status": {"type": "string", "enum": ["planted", "hinted", "resolved", "abandoned"], "description": "planted→hinted→resolved/abandoned 四态"},
        "target_resolve_ch": {"type": "integer"},
        "expected_resolve_vol": {"type": "integer", "description": "预计回收卷"},
        "related_characters": {"type": "array", "items": {"type": "string"}, "default": []},
        "priority": {"type": "string", "enum": ["high", "medium", "low"], "default": "medium"},
        "strength": {"type": "string", "enum": ["strong", "weak"], "default": "weak", "description": "strong必须回收/weak锦上添花"},
        "payoff_type": {"type": "string", "enum": ["reveal", "reverse", "callback", "payoff"], "description": "揭秘/反转/呼应/兑现"},
        "emotional_valence": {"type": "string", "enum": ["positive", "negative", "twist"]},
        "reminder_chapters": {"type": "array", "items": {"type": "integer"}, "default": [], "description": "在哪些章节提醒读者这伏笔还在"},
        "last_reminder_ch": {"type": ["integer", "null"], "default": None},
        "next_reminder_due_ch": {"type": "integer", "description": "超过此章未提醒则预警读者遗忘"},
        "dependencies": {"type": "array", "items": {"type": "string"}, "default": [], "description": "依赖其他伏笔先回收"},
        "resolution_note": {"type": "string", "default": ""},
    },
}


# ============================================================================
# Delta Schema（save_state.py 输入）
# ============================================================================
DELTA_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["chapter", "ops"],
    "properties": {
        "chapter": {"type": "string", "description": "如 ch_042"},
        "mode": {"type": "string", "enum": ["novel", "shortform"], "default": "novel"},
        "ops": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["op", "path"],
                "properties": {
                    "op": {"type": "string", "enum": ["set", "append", "remove", "merge"], "description": "set覆盖值/append追加数组/remove删除/merge深合并对象"},
                    "path": {"type": "string", "description": "目标路径，如 characters/protagonist/location/current 或 hooks/H-001/status"},
                    "value": {"description": "op=set/append/merge 时必填；op=remove 时可省略"},
                },
            },
        },
        "hooks_planted": {"type": "array", "items": {"type": "string"}, "default": [], "description": "本章新埋伏笔 ID"},
        "hooks_resolved": {"type": "array", "items": {"type": "string"}, "default": [], "description": "本章回收伏笔 ID"},
        "world_events": {
            "type": "array",
            "items": {"type": "object", "properties": {"time": {"type": "string"}, "event": {"type": "string"}}},
            "default": [],
        },
    },
}


# ============================================================================
# Pipeline Schema（.state/pipeline.json）
# ============================================================================
PIPELINE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["current_chapter", "current_volume", "mode", "current_stage"],
    "properties": {
        "current_chapter": {"type": "integer", "default": 0},
        "current_volume": {"type": "integer", "default": 1},
        "mode": {"type": "string", "enum": ["novel", "shortform"], "default": "novel"},
        "current_stage": {"type": "string", "enum": ["idle", "architect", "hook_auditor", "context_composer", "writer", "polisher", "state_update"], "default": "idle"},
        "stages": {"type": "array", "items": {"type": "string"}},
        "history": {"type": "array", "items": {"type": "object"}, "default": []},
        # 守护 Skill 进度字段（由对应 Skill 经 save_state.py 更新）
        "last_recap_chapter": {"type": "integer", "default": 0, "description": "上次冻结 recap 的末章号，由 recap-generator 更新"},
        "last_drift_check_chapter": {"type": "integer", "default": 0, "description": "上次跑 drift-detector 的末章号，由 drift-detector 更新"},
        "archived_scenes": {"type": "array", "items": {"type": "object"}, "default": [], "description": "已归档的关键场景清单，由 key-scene-archiver 追加"},
        "last_consistency_check_chapter": {"type": "integer", "default": 0, "description": "上次跑 state-consistency-checker 的章号，由 state-consistency-checker 更新"},
    },
}


# ============================================================================
# 上下文预算 Schema（.state/context_budget.json）
# ============================================================================
CONTEXT_BUDGET_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "default_budget": {"type": "integer", "default": 8000},
        "by_chapter_type": {
            "type": "object",
            "properties": {
                "regular": {"type": "integer", "default": 8000},
                "hook_resolve": {"type": "integer", "default": 10000},
                "vol_start": {"type": "integer", "default": 12000},
                "climax": {"type": "integer", "default": 12000},
                "transition": {"type": "integer", "default": 6000},
            },
        },
        "l0_injection": {"type": "boolean", "default": True, "description": "Protected 层全量注入"},
        "l1_scene_recall": {"type": "string", "enum": ["on_demand", "always", "never"], "default": "on_demand", "description": "关键场景召回策略"},
    },
}


# ============================================================================
# 校验工具
# ============================================================================
def _check_type(value: Any, expected: str) -> list[str]:
    """简单类型校验，返回错误列表（空列表=通过）。"""
    errors: list[str] = []
    type_map = {
        "string": str, "integer": int, "number": (int, float),
        "boolean": bool, "array": list, "object": dict,
    }
    if expected == "null":
        if value is not None:
            errors.append(f"期望 null，实际 {type(value).__name__}")
    elif expected.startswith("[") and expected.endswith("]"):
        # 联合类型如 ["integer", "null"]
        inner = expected[1:-1].split(",")
        inner = [x.strip() for x in inner]
        if not any(_check_type(value, t) == [] for t in inner):
            errors.append(f"期望 {expected}，实际 {type(value).__name__}")
    elif expected in type_map:
        python_type = type_map[expected]
        # bool 是 int 的子类，需排除
        if expected == "integer" and isinstance(value, bool):
            errors.append(f"期望 integer，实际 bool")
        elif not isinstance(value, python_type) or (expected == "boolean" and not isinstance(value, bool)):
            errors.append(f"期望 {expected}，实际 {type(value).__name__}")
    return errors


def validate_character_state(data: dict) -> list[str]:
    """校验角色状态 JSON，返回错误列表（空列表=通过）。"""
    errors: list[str] = []
    for field in CHARACTER_STATE_SCHEMA["required"]:
        if field not in data:
            errors.append(f"缺少必填字段: {field}")
    if "basic" in data:
        for f in CHARACTER_STATE_SCHEMA["properties"]["basic"]["required"]:
            if f not in data["basic"]:
                errors.append(f"basic 缺少必填字段: {f}")
    if "location" in data and "current" not in data["location"]:
        errors.append("location 缺少必填字段: current")
    if data.get("status") not in ["active", "dead", "missing", "unknown", "archived"]:
        errors.append(f"status 非法: {data.get('status')}")
    return errors


def validate_foreshadow(data: dict) -> list[str]:
    """校验伏笔 JSON，返回错误列表。"""
    errors: list[str] = []
    for field in FORESHADOW_SCHEMA["required"]:
        if field not in data:
            errors.append(f"伏笔缺少必填字段: {field}")
    if data.get("scope") not in ["short", "long", "core"]:
        errors.append(f"scope 非法: {data.get('scope')}")
    if data.get("status") not in ["planted", "hinted", "resolved", "abandoned"]:
        errors.append(f"status 非法: {data.get('status')}")
    return errors


def validate_delta(data: dict) -> list[str]:
    """校验 Delta JSON，返回错误列表。"""
    errors: list[str] = []
    if "chapter" not in data:
        errors.append("Delta 缺少 chapter 字段")
    if "ops" not in data or not isinstance(data["ops"], list):
        errors.append("Delta 缺少 ops 数组")
        return errors
    for i, op in enumerate(data["ops"]):
        if "op" not in op:
            errors.append(f"ops[{i}] 缺少 op 字段")
            continue
        if op["op"] not in ["set", "append", "remove", "merge"]:
            errors.append(f"ops[{i}] op 非法: {op['op']}")
        if "path" not in op:
            errors.append(f"ops[{i}] 缺少 path 字段")
        if op["op"] in ["set", "append", "merge"] and "value" not in op:
            errors.append(f"ops[{i}] op={op['op']} 需要 value 字段")
    return errors


__all__ = [
    "CHARACTER_STATE_SCHEMA",
    "FORESHADOW_SCHEMA",
    "DELTA_SCHEMA",
    "PIPELINE_SCHEMA",
    "CONTEXT_BUDGET_SCHEMA",
    "validate_character_state",
    "validate_foreshadow",
    "validate_delta",
]
