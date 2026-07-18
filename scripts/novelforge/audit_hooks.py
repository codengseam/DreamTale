"""NovelForge 伏笔审计脚本。

负责伏笔表（``NovelForge_Vault/04_大纲与脉络/hooks_registry.json``）的
全量扫描、分级提醒、读者遗忘预警、回收建议、状态更新与新增。

设计哲学：
- Vault SSOT：伏笔表是唯一真相来源，脚本只读写该 JSON，不引入数据库。
- 纯标准库：仅依赖 json/os/argparse/re/datetime/subprocess/tempfile。
- 原子写入：临时文件 + os.replace，避免写一半崩溃导致数据损坏。
- 与 schema.py 共享校验：新增/更新伏笔前调用 ``validate_foreshadow``。

CLI 速查：
    # 全量审计报告（人类可读）
    python -m scripts.novelforge.audit_hooks --current-ch 42

    # JSON 格式输出（供 Trae Skill 解析）
    python -m scripts.novelforge.audit_hooks --current-ch 42 --json

    # 仅统计摘要
    python -m scripts.novelforge.audit_hooks --stats --current-ch 42

    # 更新伏笔状态（写回 + 可选 git commit）
    python -m scripts.novelforge.audit_hooks --update H-017 --status hinted --reminder-ch 42

    # 新增伏笔（JSON 字符串）
    python -m scripts.novelforge.audit_hooks --add '{"hook_id":"H-018",...}'

    # 检查章纲文件与伏笔表一致性
    python -m scripts.novelforge.audit_hooks --check-outline path/to/outline.md
"""
from __future__ import annotations

import argparse
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
    from .schema import validate_foreshadow
except ImportError:  # 兼容直接 python scripts/novelforge/audit_hooks.py 调用
    from scripts.novelforge.schema import validate_foreshadow  # type: ignore


# ============================================================================
# 常量
# ============================================================================
DEFAULT_VAULT: str = "/workspace/NovelForge_Vault"
HOOKS_REGISTRY_REL: str = "04_大纲与脉络/hooks_registry.json"

# 分级 severity 标识（JSON 输出用英文，文本输出用 emoji 前缀）
SEVERITY_CRITICAL: str = "critical"   # 🔴 强制提醒：卷内伏笔超期
SEVERITY_WARNING: str = "warning"     # 🟡 提醒：跨卷伏笔超期
SEVERITY_HEALTHY: str = "healthy"     # 🟢 健康
SEVERITY_DONE: str = "done"           # ⚪ 已完成（resolved/abandoned）

# scope -> 提醒间隔（章）
REMINDER_INTERVAL: dict[str, int] = {
    "short": 10,
    "long": 30,
    "core": 50,
}

# 优先级/强度排序权重（数值越大越优先回收）
PRIORITY_WEIGHT: dict[str, int] = {"high": 3, "medium": 2, "low": 1}
STRENGTH_WEIGHT: dict[str, int] = {"strong": 2, "weak": 1}

# 章纲关键词（用于 --check-outline 判断伏笔引用是"回收"还是"埋设"）
RECOVERY_KEYWORDS: tuple[str, ...] = (
    "回收", "揭秘", "揭晓", "揭示", "兑现", "呼应", "反转", "揭穿",
)
PLANT_KEYWORDS: tuple[str, ...] = (
    "埋设", "埋下", "埋伏", "新伏笔", "埋新伏笔", "埋设伏笔", "埋下伏笔",
)
HOOK_ID_RE: re.Pattern[str] = re.compile(r"H-(\d{1,4})")

# 健康线：回收率低于此值给出告警
RECOVERY_HEALTH_LINE: float = 0.60


# ============================================================================
# 读写
# ============================================================================
def hooks_registry_path(vault: str) -> str:
    """返回指定 Vault 下的 hooks_registry.json 绝对路径。"""
    return os.path.join(vault, HOOKS_REGISTRY_REL)


def load_hooks(vault: str) -> dict[str, Any]:
    """读取伏笔表 JSON。

    Args:
        vault: Vault 根目录绝对路径。

    Returns:
        完整的 registry dict，至少包含 ``{"version": ..., "hooks": [...]}``。

    Raises:
        FileNotFoundError: 伏笔表文件不存在。
        json.JSONDecodeError: JSON 解析失败。
    """
    path = hooks_registry_path(vault)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "hooks" not in data or not isinstance(data["hooks"], list):
        data["hooks"] = []
    return data


def save_hooks(vault: str, data: dict[str, Any]) -> None:
    """原子写回伏笔表（临时文件 + os.replace）。

    Args:
        vault: Vault 根目录绝对路径。
        data: 完整的 registry dict。

    Note:
        使用 ``ensure_ascii=False`` 保留中文可读性，indent=2 与原文件一致。
    """
    path = hooks_registry_path(vault)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # 同目录下写临时文件，确保 os.replace 是原子操作（同文件系统）
    fd, tmp_path = tempfile.mkstemp(
        prefix=".hooks_registry_", suffix=".tmp", dir=os.path.dirname(path)
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


# ============================================================================
# 核心计算
# ============================================================================
def compute_next_reminder_due(base_ch: int, scope: str) -> int:
    """根据基准章号与 scope 计算下次提醒截止章号。

    - short: base + 10
    - long: base + 30
    - core: base + 50
    """
    interval = REMINDER_INTERVAL.get(scope, REMINDER_INTERVAL["short"])
    return base_ch + interval


def classify_severity(hook: dict[str, Any], current_ch: int) -> str:
    """对单条伏笔分级。

    - 🔴 critical: scope=short 且 current_ch > target_resolve_ch（卷内超期）
    - 🟡 warning: scope=long 且 current_ch > target_resolve_ch（跨卷超期）
    - ⚪ done: status in (resolved, abandoned)
    - 🟢 healthy: 其余

    Note:
        scope=core 视为全书级悬念，回收时间灵活，不纳入超期判定。
    """
    status = hook.get("status", "planted")
    if status in ("resolved", "abandoned"):
        return SEVERITY_DONE
    scope = hook.get("scope", "short")
    target = hook.get("target_resolve_ch")
    if target is None or not isinstance(target, int):
        return SEVERITY_HEALTHY
    if scope == "short" and current_ch > target:
        return SEVERITY_CRITICAL
    if scope == "long" and current_ch > target:
        return SEVERITY_WARNING
    return SEVERITY_HEALTHY


def check_forgetting(hook: dict[str, Any], current_ch: int) -> dict[str, Any] | None:
    """检查读者遗忘预警。

    条件（全部满足才预警）：
    1. status in (planted, hinted)
    2. next_reminder_due_ch 存在且 <= current_ch
    3. last_reminder_ch 为 null 或 < next_reminder_due_ch
       （即"到了该提醒的章号却没提醒"）

    Returns:
        预警 dict 或 None。
    """
    if hook.get("status") not in ("planted", "hinted"):
        return None
    due = hook.get("next_reminder_due_ch")
    if not isinstance(due, int) or due > current_ch:
        return None
    last = hook.get("last_reminder_ch")
    if isinstance(last, int) and last >= due:
        # 已在到期后提醒过，不再预警
        return None
    return {
        "hook_id": hook.get("hook_id"),
        "description": hook.get("description", ""),
        "next_reminder_due_ch": due,
        "last_reminder_ch": last,
        "current_ch": current_ch,
        "overdue_by": current_ch - due,
        "suggestion": (
            f"在当前章（ch_{current_ch:03d}）纲中加入「伏笔提醒」情节："
            f"让角色再次提及此伏笔（不揭），刷新读者记忆。"
        ),
    }


def check_unresolved_dependencies(
    hook: dict[str, Any], hooks_by_id: dict[str, dict[str, Any]]
) -> list[str]:
    """返回该伏笔依赖但尚未回收的 hook_id 列表。"""
    unresolved: list[str] = []
    for dep_id in hook.get("dependencies", []) or []:
        dep = hooks_by_id.get(dep_id)
        if dep is None:
            unresolved.append(f"{dep_id}(缺失)")
        elif dep.get("status") not in ("resolved",):
            unresolved.append(dep_id)
    return unresolved


def build_recovery_suggestion(
    hook: dict[str, Any],
    current_ch: int,
    severity: str,
    hooks_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """构建单条超期伏笔的回收建议。"""
    target = hook.get("target_resolve_ch")
    overdue_by = (current_ch - target) if isinstance(target, int) else 0
    unresolved_deps = check_unresolved_dependencies(hook, hooks_by_id)
    scope = hook.get("scope", "short")

    if severity == SEVERITY_CRITICAL:
        prefix = "🔴 [强制]"
        action = "本章必须安排回收：揭秘场景或兑现情节，避免卷内伏笔烂尾。"
    else:
        prefix = "🟡 [提醒]"
        action = "跨卷伏笔可延后，但需更新 target_resolve_ch，或在本章安排呼应。"

    dep_text = "无" if not unresolved_deps else "需先回收 " + ", ".join(unresolved_deps)
    text = (
        f'{prefix} {hook.get("hook_id")} "{hook.get("description", "")}"\n'
        f'   埋于 ch{hook.get("planted_ch", "?")}, '
        f'计划 ch{target if isinstance(target, int) else "?"} 回收, '
        f'当前 ch{current_ch} 已超期 {overdue_by} 章\n'
        f'   优先级 {hook.get("priority", "medium")}, '
        f'强度 {hook.get("strength", "weak")}, '
        f'依赖: {dep_text}\n'
        f'   建议: {action}'
    )

    return {
        "hook_id": hook.get("hook_id"),
        "severity": severity,
        "scope": scope,
        "description": hook.get("description", ""),
        "planted_ch": hook.get("planted_ch"),
        "target_resolve_ch": target,
        "current_ch": current_ch,
        "overdue_by": overdue_by,
        "priority": hook.get("priority", "medium"),
        "strength": hook.get("strength", "weak"),
        "unresolved_dependencies": unresolved_deps,
        "suggestion_text": text,
    }


# ============================================================================
# 全量审计
# ============================================================================
def audit_all(hooks: list[dict[str, Any]], current_ch: int) -> dict[str, Any]:
    """对伏笔列表做全量审计，返回结构化报告。

    Args:
        hooks: 伏笔列表（registry["hooks"]）。
        current_ch: 当前章号。

    Returns:
        审计报告 dict，结构见模块 docstring 的 JSON 示例。
    """
    hooks_by_id: dict[str, dict[str, Any]] = {
        h.get("hook_id", ""): h for h in hooks if h.get("hook_id")
    }

    by_status: dict[str, int] = {"planted": 0, "hinted": 0, "resolved": 0, "abandoned": 0}
    overdue: list[dict[str, Any]] = []
    forgetting_warning: list[dict[str, Any]] = []
    recovery_suggestions: list[dict[str, Any]] = []
    classified: list[dict[str, Any]] = []  # 每条伏笔的分级明细

    for hook in hooks:
        status = hook.get("status", "planted")
        if status in by_status:
            by_status[status] += 1

        severity = classify_severity(hook, current_ch)
        classified.append({
            "hook_id": hook.get("hook_id"),
            "description": hook.get("description", ""),
            "scope": hook.get("scope", "short"),
            "status": status,
            "severity": severity,
            "target_resolve_ch": hook.get("target_resolve_ch"),
            "planted_ch": hook.get("planted_ch"),
        })

        if severity in (SEVERITY_CRITICAL, SEVERITY_WARNING):
            target_ch = hook.get("target_resolve_ch")
            overdue.append({
                "hook_id": hook.get("hook_id"),
                "severity": severity,
                "scope": hook.get("scope"),
                "description": hook.get("description", ""),
                "planted_ch": hook.get("planted_ch"),
                "target_resolve_ch": target_ch,
                "overdue_by": (
                    current_ch - target_ch if isinstance(target_ch, int) else 0
                ),
                "priority": hook.get("priority", "medium"),
                "strength": hook.get("strength", "weak"),
            })
            recovery_suggestions.append(
                build_recovery_suggestion(hook, current_ch, severity, hooks_by_id)
            )

        # 读者遗忘预警（planted/hinted 才检查）
        warn = check_forgetting(hook, current_ch)
        if warn is not None:
            forgetting_warning.append(warn)

    # 回收建议按优先级 + 强度降序
    recovery_suggestions.sort(
        key=lambda s: (
            PRIORITY_WEIGHT.get(s["priority"], 0) * 10
            + STRENGTH_WEIGHT.get(s["strength"], 0)
        ),
        reverse=True,
    )

    total = len(hooks)
    resolved = by_status["resolved"]
    recovery_rate = (resolved / total) if total > 0 else 0.0

    return {
        "current_ch": current_ch,
        "total": total,
        "by_status": by_status,
        "recovery_rate": round(recovery_rate, 4),
        "overdue": overdue,
        "forgetting_warning": forgetting_warning,
        "recovery_suggestions": recovery_suggestions,
        "classified": classified,
        "stats": {
            "total": total,
            "resolved": resolved,
            "in_progress": by_status["planted"] + by_status["hinted"],
            "abandoned": by_status["abandoned"],
            "overdue_count": len(overdue),
            "critical_count": sum(1 for o in overdue if o["severity"] == SEVERITY_CRITICAL),
            "warning_count": sum(1 for o in overdue if o["severity"] == SEVERITY_WARNING),
            "forgetting_count": len(forgetting_warning),
            "recovery_rate": round(recovery_rate, 4),
            "health_line": RECOVERY_HEALTH_LINE,
            "below_health_line": recovery_rate < RECOVERY_HEALTH_LINE,
        },
    }


# ============================================================================
# 文本格式化
# ============================================================================
def _fmt_ch(ch: int) -> str:
    """章号格式化为 ch_042 形式（3 位补零）。"""
    return f"ch_{ch:03d}"


def format_stats(report: dict[str, Any]) -> str:
    """格式化统计摘要（人类可读）。"""
    stats = report["stats"]
    by_status = report["by_status"]
    resolved = stats["resolved"]
    rate_pct = f"{stats['recovery_rate'] * 100:.0f}%"
    current_ch = report["current_ch"]

    lines = [
        f"=== 伏笔审计报告（当前章 {_fmt_ch(current_ch)}）===",
        f"总伏笔数: {stats['total']}",
        f"已回收: {resolved} ({rate_pct})",
        f"进行中: {stats['in_progress']} "
        f"(planted: {by_status['planted']}, hinted: {by_status['hinted']})",
        f"已放弃: {stats['abandoned']}",
        f"超期未回收: {stats['overdue_count']} "
        f"(🔴强制 {stats['critical_count']}, 🟡提醒 {stats['warning_count']})",
        f"读者遗忘预警: {stats['forgetting_count']}",
        f"回收率: {rate_pct}（健康线 ≥{int(RECOVERY_HEALTH_LINE * 100)}%）"
        + (" ⚠️ 低于健康线" if stats["below_health_line"] else " ✅"),
    ]
    return "\n".join(lines)


def format_report(report: dict[str, Any]) -> str:
    """格式化完整审计报告（人类可读）。"""
    parts: list[str] = [format_stats(report), ""]

    # --- 分级明细 ---
    parts.append("--- 分级明细 ---")
    buckets: dict[str, list[dict[str, Any]]] = {
        SEVERITY_CRITICAL: [],
        SEVERITY_WARNING: [],
        SEVERITY_HEALTHY: [],
        SEVERITY_DONE: [],
    }
    for item in report["classified"]:
        buckets.setdefault(item["severity"], []).append(item)

    labels = {
        SEVERITY_CRITICAL: "🔴 强制提醒（卷内伏笔超期）",
        SEVERITY_WARNING: "🟡 提醒（跨卷伏笔超期）",
        SEVERITY_HEALTHY: "🟢 健康",
        SEVERITY_DONE: "⚪ 已完成（resolved/abandoned）",
    }
    for sev in (SEVERITY_CRITICAL, SEVERITY_WARNING, SEVERITY_HEALTHY, SEVERITY_DONE):
        parts.append(f"{labels[sev]}:")
        items = buckets.get(sev, [])
        if not items:
            parts.append("  （无）")
        else:
            for it in items:
                parts.append(
                    f"  {it['hook_id']} [{it['scope']}/{it['status']}] "
                    f"\"{it['description']}\""
                )
    parts.append("")

    # --- 读者遗忘预警 ---
    parts.append("--- 读者遗忘预警 ---")
    warns = report["forgetting_warning"]
    if not warns:
        parts.append("（无）")
    else:
        for w in warns:
            parts.append(
                f"{w['hook_id']} \"{w['description']}\"  "
                f"下次提醒应在 ch{w['next_reminder_due_ch']}，"
                f"当前 ch{w['current_ch']}，已超期 {w['overdue_by']} 章未提醒"
            )
            parts.append(f"  建议: {w['suggestion']}")
    parts.append("")

    # --- 回收建议 ---
    parts.append("--- 回收建议 ---")
    suggestions = report["recovery_suggestions"]
    if not suggestions:
        parts.append("（无超期伏笔）")
    else:
        for s in suggestions:
            parts.append(s["suggestion_text"])
    parts.append("")

    return "\n".join(parts)


# ============================================================================
# 写操作：更新 / 新增
# ============================================================================
def update_hook(
    hooks: list[dict[str, Any]],
    hook_id: str,
    status: str | None = None,
    reminder_ch: int | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    """更新指定伏笔的 status 与 last_reminder_ch。

    Args:
        hooks: 伏笔列表（会被原地修改）。
        hook_id: 目标伏笔 ID，如 H-017。
        status: 新状态（planted/hinted/resolved/abandoned），可选。
        reminder_ch: 提醒章号，可选。提供则更新 last_reminder_ch 并追加到 reminder_chapters。

    Returns:
        (success, message, updated_hook)
    """
    if status is None and reminder_ch is None:
        return False, "未提供 --status 或 --reminder-ch，无更新内容", None

    target: dict[str, Any] | None = None
    for h in hooks:
        if h.get("hook_id") == hook_id:
            target = h
            break
    if target is None:
        return False, f"伏笔 {hook_id} 不存在", None

    if status is not None:
        if status not in ("planted", "hinted", "resolved", "abandoned"):
            return False, f"非法 status: {status}", None
        target["status"] = status

    if reminder_ch is not None:
        target["last_reminder_ch"] = reminder_ch
        reminders = target.get("reminder_chapters")
        if not isinstance(reminders, list):
            reminders = []
            target["reminder_chapters"] = reminders
        if reminder_ch not in reminders:
            reminders.append(reminder_ch)
            reminders.sort()
        # 重新计算 next_reminder_due_ch（基于本次提醒章号 + scope 间隔）
        scope = target.get("scope", "short")
        target["next_reminder_due_ch"] = compute_next_reminder_due(reminder_ch, scope)

    # 校验更新后的伏笔
    errors = validate_foreshadow(target)
    if errors:
        return False, f"校验失败: {'; '.join(errors)}", None

    return True, f"已更新 {hook_id}", target


def add_hook(
    hooks: list[dict[str, Any]],
    hook_data: dict[str, Any],
) -> tuple[bool, str, dict[str, Any] | None]:
    """新增一条伏笔。

    - 校验字段完整性（validate_foreshadow）
    - 自动填充默认值：priority=medium, strength=weak, status=planted
    - 计算 next_reminder_due_ch（short: planted+10, long: planted+30, core: planted+50）
    - 检查 hook_id 唯一性

    Returns:
        (success, message, new_hook)
    """
    hook_id = hook_data.get("hook_id")
    if not hook_id:
        return False, "缺少 hook_id", None
    if any(h.get("hook_id") == hook_id for h in hooks):
        return False, f"伏笔 {hook_id} 已存在", None

    # 自动填充默认值
    hook_data.setdefault("status", "planted")
    hook_data.setdefault("priority", "medium")
    hook_data.setdefault("strength", "weak")
    hook_data.setdefault("reminder_chapters", [])
    hook_data.setdefault("last_reminder_ch", None)
    hook_data.setdefault("dependencies", [])
    hook_data.setdefault("related_characters", [])
    hook_data.setdefault("resolution_note", "")

    # 计算 next_reminder_due_ch（若未提供）
    if "next_reminder_due_ch" not in hook_data:
        planted_ch = hook_data.get("planted_ch")
        scope = hook_data.get("scope", "short")
        if isinstance(planted_ch, int):
            hook_data["next_reminder_due_ch"] = compute_next_reminder_due(planted_ch, scope)

    errors = validate_foreshadow(hook_data)
    if errors:
        return False, f"校验失败: {'; '.join(errors)}", None

    hooks.append(hook_data)
    return True, f"已新增 {hook_id}", hook_data


# ============================================================================
# 章纲一致性检查
# ============================================================================
def check_outline(outline_path: str, hooks: list[dict[str, Any]]) -> dict[str, Any]:
    """检查章纲文件与伏笔表一致性。

    扫描章纲中所有 ``H-XXX`` 引用，根据上下文关键词判断是"回收"还是"埋设"意图，
    然后对比伏笔表，报告不一致项。

    Args:
        outline_path: 章纲 Markdown 文件路径。
        hooks: 伏笔列表。

    Returns:
        一致性报告 dict。
    """
    with open(outline_path, "r", encoding="utf-8") as f:
        content = f.read()

    hooks_by_id: dict[str, dict[str, Any]] = {
        h.get("hook_id", ""): h for h in hooks if h.get("hook_id")
    }

    # 收集章纲中所有 H-XXX 引用及其上下文意图
    references: list[dict[str, Any]] = []
    for match in HOOK_ID_RE.finditer(content):
        hook_id = f"H-{match.group(1)}"
        # 取匹配位置所在行
        line_start = content.rfind("\n", 0, match.start()) + 1
        line_end = content.find("\n", match.end())
        if line_end == -1:
            line_end = len(content)
        line = content[line_start:line_end]

        # 判断意图：回收 vs 埋设（优先回收关键词，因为"回收"更明确）
        intent = "mention"  # 默认仅提及
        if any(kw in line for kw in RECOVERY_KEYWORDS):
            intent = "resolve"
        elif any(kw in line for kw in PLANT_KEYWORDS):
            intent = "plant"

        references.append({
            "hook_id": hook_id,
            "intent": intent,
            "line": line.strip(),
        })

    # 对比伏笔表
    resolve_mismatch: list[dict[str, Any]] = []  # 章纲说要回收但伏笔未到 resolved
    plant_missing: list[dict[str, Any]] = []     # 章纲说要埋但伏笔表无对应
    mention_unknown: list[dict[str, Any]] = []   # 章纲引用了但伏笔表无此伏笔

    seen_ids: set[str] = set()
    for ref in references:
        hid = ref["hook_id"]
        if hid in seen_ids:
            continue
        seen_ids.add(hid)
        hook = hooks_by_id.get(hid)
        if hook is None:
            # intent=plant 的未知伏笔由 plant_missing 处理，避免重复列入
            if ref["intent"] != "plant":
                mention_unknown.append(ref)
            continue
        if ref["intent"] == "resolve" and hook.get("status") not in ("resolved",):
            resolve_mismatch.append({
                "hook_id": hid,
                "current_status": hook.get("status"),
                "outline_line": ref["line"],
                "suggestion": f"章纲计划回收 {hid}，但伏笔状态为 {hook.get('status')}，"
                              f"回收后请用 --update {hid} --status resolved 更新。",
            })
        elif ref["intent"] == "plant" and hook.get("status") not in ("planted",):
            # 已存在但状态不是 planted，可能是重复埋设
            resolve_mismatch.append({
                "hook_id": hid,
                "current_status": hook.get("status"),
                "outline_line": ref["line"],
                "suggestion": f"章纲计划埋设 {hid}，但伏笔已存在且状态为 {hook.get('status')}，"
                              f"请确认是否重复埋设。",
            })

    # 章纲说要埋但伏笔表无对应（建议新增）
    for ref in references:
        if ref["intent"] == "plant" and ref["hook_id"] not in hooks_by_id:
            plant_missing.append({
                "hook_id": ref["hook_id"],
                "outline_line": ref["line"],
                "suggestion": f"章纲计划埋设新伏笔 {ref['hook_id']}，但伏笔表无记录，"
                              f"请用 --add 新增。",
            })

    return {
        "outline_path": outline_path,
        "total_references": len(references),
        "unique_hook_ids": sorted(seen_ids),
        "resolve_mismatch": resolve_mismatch,
        "plant_missing": plant_missing,
        "mention_unknown": mention_unknown,
        "all_consistent": (
            not resolve_mismatch and not plant_missing and not mention_unknown
        ),
    }


def format_outline_report(report: dict[str, Any]) -> str:
    """格式化章纲一致性检查报告（人类可读）。"""
    lines = [
        f"=== 章纲一致性检查（{report['outline_path']}）===",
        f"章纲引用伏笔数: {report['total_references']} 次，"
        f"涉及 {len(report['unique_hook_ids'])} 个伏笔 ID",
        "",
    ]
    if report["all_consistent"]:
        lines.append("✅ 章纲与伏笔表一致，无需处理。")
        return "\n".join(lines)

    if report["resolve_mismatch"]:
        lines.append("--- ⚠️ 回收/埋设状态不一致 ---")
        for m in report["resolve_mismatch"]:
            lines.append(
                f"  {m['hook_id']} (当前 {m['current_status']}): {m['suggestion']}"
            )
            lines.append(f"    章纲原文: {m['outline_line']}")
        lines.append("")

    if report["plant_missing"]:
        lines.append("--- 🆕 章纲计划埋设但伏笔表缺失 ---")
        for m in report["plant_missing"]:
            lines.append(f"  {m['hook_id']}: {m['suggestion']}")
            lines.append(f"    章纲原文: {m['outline_line']}")
        lines.append("")

    if report["mention_unknown"]:
        lines.append("--- ❓ 章纲引用了未知伏笔 ID ---")
        for m in report["mention_unknown"]:
            lines.append(f"  {m['hook_id']}: {m['line']}")
        lines.append("")

    return "\n".join(lines)


# ============================================================================
# Git commit（可选）
# ============================================================================
def trigger_commit(file_path: str, message: str) -> tuple[bool, str]:
    """对指定文件触发 git commit。

    优先调用 save_state.py 的 commit 能力（若存在）；否则用 subprocess 独立 commit。

    Args:
        file_path: 要 commit 的文件绝对路径。
        message: commit message（中文）。

    Returns:
        (success, message)
    """
    # 优先复用 save_state.py
    try:
        from . import save_state  # type: ignore
        commit_fn = getattr(save_state, "git_commit", None) or getattr(
            save_state, "commit", None
        )
        if callable(commit_fn):
            commit_fn(file_path, message)
            return True, f"已通过 save_state.git_commit 提交: {file_path}"
    except Exception:
        pass  # save_state 不可用，降级到独立 commit

    # 独立 commit：仅 add 该文件，避免误提交其他改动
    repo_root = _find_repo_root(file_path)
    if repo_root is None:
        return False, "未找到 git 仓库根目录，跳过 commit"

    try:
        # 用相对路径 add，避免路径含中文/空格问题
        rel = os.path.relpath(file_path, repo_root)
        subprocess.run(
            ["git", "add", rel], cwd=repo_root, check=True,
            capture_output=True, text=True,
        )
        subprocess.run(
            ["git", "commit", "-m", message], cwd=repo_root, check=True,
            capture_output=True, text=True,
        )
        return True, f"已提交: {rel}"
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or str(e)).strip()
        return False, f"git commit 失败: {err}"
    except FileNotFoundError:
        return False, "git 命令不可用，跳过 commit"


def _find_repo_root(file_path: str) -> str | None:
    """从文件路径向上查找 git 仓库根目录。"""
    cur = os.path.dirname(os.path.abspath(file_path))
    while cur != os.path.dirname(cur):  # 未到根
        if os.path.isdir(os.path.join(cur, ".git")):
            return cur
        cur = os.path.dirname(cur)
    return None


# ============================================================================
# CLI
# ============================================================================
def build_arg_parser() -> argparse.ArgumentParser:
    """构建 CLI 参数解析器。"""
    parser = argparse.ArgumentParser(
        prog="audit_hooks",
        description="NovelForge 伏笔审计：扫描、分级、预警、回收建议、状态更新。",
    )
    parser.add_argument(
        "--vault", default=DEFAULT_VAULT,
        help=f"Vault 根目录（默认 {DEFAULT_VAULT}）",
    )
    parser.add_argument(
        "--current-ch", type=int, default=None,
        help="当前章号（用于审计/统计/分级）",
    )
    parser.add_argument(
        "--json", action="store_true", dest="as_json",
        help="以 JSON 格式输出（供 Trae Skill 解析）",
    )
    parser.add_argument(
        "--stats", action="store_true",
        help="仅输出统计摘要",
    )
    parser.add_argument(
        "--update", metavar="HOOK_ID", default=None,
        help="更新指定伏笔（需配合 --status / --reminder-ch）",
    )
    parser.add_argument(
        "--status", choices=["planted", "hinted", "resolved", "abandoned"],
        default=None, help="新状态（与 --update 配合）",
    )
    parser.add_argument(
        "--reminder-ch", type=int, default=None,
        help="提醒章号（与 --update 配合，更新 last_reminder_ch）",
    )
    parser.add_argument(
        "--add", metavar="JSON", default=None,
        help='新增伏笔，JSON 字符串，如 \'{"hook_id":"H-018",...}\'',
    )
    parser.add_argument(
        "--check-outline", metavar="PATH", default=None,
        help="检查章纲文件与伏笔表一致性",
    )
    parser.add_argument(
        "--no-commit", action="store_true",
        help="写操作后不自动触发 git commit",
    )
    return parser


def cmd_audit(args: argparse.Namespace) -> int:
    """执行全量审计或统计。"""
    if args.current_ch is None:
        print("错误：--current-ch 必填（审计需要当前章号）", file=sys.stderr)
        return 2
    registry = load_hooks(args.vault)
    report = audit_all(registry.get("hooks", []), args.current_ch)

    if args.stats:
        if args.as_json:
            print(json.dumps(report["stats"], ensure_ascii=False, indent=2))
        else:
            print(format_stats(report))
    else:
        if args.as_json:
            # JSON 模式输出完整结构化报告
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            print(format_report(report))
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    """执行伏笔更新。"""
    registry = load_hooks(args.vault)
    hooks = registry.get("hooks", [])
    ok, msg, updated = update_hook(
        hooks, args.update, status=args.status, reminder_ch=args.reminder_ch
    )
    if not ok:
        print(f"❌ {msg}", file=sys.stderr)
        return 1
    save_hooks(args.vault, registry)
    print(f"✅ {msg}")
    if updated is not None:
        print(json.dumps(updated, ensure_ascii=False, indent=2))

    if not args.no_commit:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        commit_msg = (
            f"chore(伏笔表): 更新 {args.update} 状态"
            f"{'为 ' + args.status if args.status else ''}"
            f"{'，提醒章号 ch_' + format(args.reminder_ch, '03d') if args.reminder_ch else ''}"
            f"\n\n由 audit_hooks.py 在 {ts} 触发。"
        )
        cok, cmsg = trigger_commit(hooks_registry_path(args.vault), commit_msg)
        print(f"[commit] {cmsg}" if cok else f"[commit] ⚠️ {cmsg}")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    """执行新增伏笔。"""
    try:
        hook_data = json.loads(args.add)
    except json.JSONDecodeError as e:
        print(f"❌ --add JSON 解析失败: {e}", file=sys.stderr)
        return 1
    if not isinstance(hook_data, dict):
        print("❌ --add JSON 必须是对象", file=sys.stderr)
        return 1

    registry = load_hooks(args.vault)
    hooks = registry.get("hooks", [])
    ok, msg, new_hook = add_hook(hooks, hook_data)
    if not ok:
        print(f"❌ {msg}", file=sys.stderr)
        return 1
    save_hooks(args.vault, registry)
    print(f"✅ {msg}")
    if new_hook is not None:
        print(json.dumps(new_hook, ensure_ascii=False, indent=2))

    if not args.no_commit:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        hook_id = new_hook.get("hook_id", "?") if new_hook else "?"
        commit_msg = (
            f"chore(伏笔表): 新增伏笔 {hook_id}\n\n由 audit_hooks.py 在 {ts} 触发。"
        )
        cok, cmsg = trigger_commit(hooks_registry_path(args.vault), commit_msg)
        print(f"[commit] {cmsg}" if cok else f"[commit] ⚠️ {cmsg}")
    return 0


def cmd_check_outline(args: argparse.Namespace) -> int:
    """执行章纲一致性检查。"""
    registry = load_hooks(args.vault)
    report = check_outline(args.check_outline, registry.get("hooks", []))
    if args.as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_outline_report(report))
    return 0 if report["all_consistent"] else 1


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。

    Returns:
        进程退出码：0 成功，1 业务错误，2 参数错误。
    """
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    # 路由到对应子命令
    if args.update is not None:
        return cmd_update(args)
    if args.add is not None:
        return cmd_add(args)
    if args.check_outline is not None:
        return cmd_check_outline(args)
    # 默认：审计/统计
    return cmd_audit(args)


if __name__ == "__main__":
    sys.exit(main())
