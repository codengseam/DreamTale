# M2 · schema 同步门禁

> **核心目标**：修复 `schema.py` 与 4 个守护 Skill 的字段断链，把 `state-consistency-checker` 的 flag 协议从「建议协议」升级为「save_state.py 入口处真正阻断保存」的硬性门禁，让 P0 一致性问题**物理上无法**写入状态机。
>
> **所属层级**：L1 修复工程债 · D3
> **依赖**：无前置
> **下游**：M5（角色五层档案）/ M6（伏笔五阶段）/ M7（active enforcement）/ M18（Persona Vectors）均依赖本模块的 schema SSOT 与 flag 门禁
> **方案原则**：本方案文档详细到「AI 直接读取即可开始优化、验证、修复」的程度，包含目标、痛点对应、涉及文件路径、详细实现步骤、验证命令、回归测试要求、风险点、DoD 清单。

---

## 一、模块目标

### 1.1 一句话目标

修复 `schema.py` 与守护 Skill 的字段断链，实现 `state-consistency-checker` 的 flag 协议真正阻断保存，**让 P0 一致性问题无法写入状态机**。

### 1.2 对应的痛点

loop_log 2026-07 沉淀教训 3（schema 滞后于 Skill 设计，原话见 file:///workspace/docs/loop_log/2026-07.md 第 94 行）：

> schema.py 的 PIPELINE_SCHEMA 缺 4 个守护 Skill 引用的字段（last_recap_chapter / last_drift_check_chapter / archived_scenes / last_consistency_check_chapter）。根因：Skill 设计先行，schema 更新滞后。**教训：新增 Skill 引用状态字段时，必须同步更新 schema.py 和 save_state.py 的默认值。**

以及 `state-consistency-checker/SKILL.md` 第 219-235 行明确标注的工程债（file:///workspace/.trae/skills/state-consistency-checker/SKILL.md）：

> **当前状态**：`save_state.py` 尚未接入 flag 检查逻辑（截至本 Skill 编写时）。在接入前，本 Skill 仍**强烈建议**主 Agent 遵守"P0 未清零不调 save_state.py"的纪律；flag 文件可由本 Skill 创建，作为审计痕迹，待 `save_state.py` 后续版本硬性校验。

### 1.3 现状核查（重要）

经实际 Read 现有源码核查（2026-07-18）：

| 项 | 现状 | 任务描述对照 |
|---|---|---|
| `PIPELINE_SCHEMA` 4 字段 | ✅ **已存在**（schema.py 第 247-251 行，loop_log 沉淀阶段补上） | 任务描述"缺失"为历史背景，需补回归测试锁定防复发 |
| `EMPTY_PIPELINE` 默认值 | ✅ **已同步**（save_state.py 第 159-164 行） | 同上 |
| `pipeline.json` 实际状态 | ✅ 已含 4 字段（file:///workspace/NovelForge_Vault/.state/pipeline.json 第 21-24 行） | 无需补 |
| `FLAG_SCHEMA` | ❌ **未定义** | 本模块新增 |
| save_state.py flag 拦截 | ❌ **未实现**（apply_delta 入口无 flag 检查） | 本模块新增 |
| check_schema_sync.py | ❌ **不存在** | 本模块新增（防再次滞后） |
| dev-checklist.md schema 同步项 | ❌ **缺失** | 本模块新增 |
| state-consistency-checker SKILL.md flag 协议描述 | ⚠️ **过时**（标注"建议协议"） | 本模块更新为"已接入" |

**结论**：4 字段断链本身已在 loop_log 沉淀时修复，本模块的核心增量是 (a) 把这一修复**用回归测试锁定**避免复发，(b) 补上 `FLAG_SCHEMA` + save_state.py 真正阻断 + 持续校验脚本 + checklist 项，让"schema 滞后"这类问题未来**结构性不可能再发生**。

### 1.4 完成后达成的能力

- `PIPELINE_SCHEMA` 完整覆盖 4 个守护 Skill 字段（回归测试断言锁定）
- `FLAG_SCHEMA` 定义完整，可作为 `state-consistency-checker` 与 `save_state.py` 的契约层
- `save_state.py` 入口处接入 flag 协议：P0 直接 `raise ValueError` 阻断写入；P1 留痕可豁免
- 新增 Skill 引用状态字段时，`check_schema_sync.py` 一键扫描所有 Skill 文件引用的字段 vs `schema.py` 定义的字段，发现断链即报错
- `dev-checklist.md` 新增"schema 同步检查"项，作为开发自检硬性条目

---

## 二、痛点对应

### 2.1 痛点表现

**痛点 A · schema 滞后（D3 工程债）**：

- `scripts/novelforge/schema.py` 的 `PIPELINE_SCHEMA` 历史上缺失 4 个守护 Skill 引用的字段（loop_log 沉淀后已修复，但无回归测试锁定）
- 4 个守护 Skill（recap-generator / drift-detector / key-scene-archiver / state-consistency-checker）的 SKILL.md 都假设 `pipeline.json` 含这些字段，但 schema.py 一度无定义，导致 `validate_pipeline` 校验时无依据
- save_state.py 的 `EMPTY_PIPELINE` 模板一度未含这些字段，新 Vault 初始化时 `pipeline.json` 缺字段，守护 Skill 读到 `KeyError`

**痛点 B · 守护 Skill 无强制力（D3 工程债核心）**：

- `state-consistency-checker/SKILL.md` 第 219-235 行明确标注"flag 协议是建议协议，待 save_state.py 接入"
- 当前 `check_consistency.py` 检测出 P0 问题后只能输出报告 + `--strict` 退出码 1，但**没有手段阻止主 Agent 继续调 save_state.py**
- 即"P0 阻断保存"在文档里写了，但代码层无强制力，完全依赖 Agent 自觉
- 一旦 Agent 跳过门禁直接 save_state，P0 问题（境界跳级、物品凭空、位置穿越、角色复生）就会污染状态机，后续章节基于错误状态生成，漂移累积不可逆

### 2.2 行业方案

| 产品/系统 | 方案 | 局限 |
|---|---|---|
| Sudowrite | Story Bible 是 reference only，AI 生成时可读但不强制对齐 | 无 enforcement，最终靠人审 |
| NovelCrafter | Codex 同样是 reference，无 schema 校验 | 同上 |
| 阅文妙笔 / 彩云小彩 | 内部状态机不公开，推测是 reference + 人审 | 黑盒不可借鉴 |
| Letta Filesystem | 文件即记忆，但有 block/unblock 协议控制写入 | 但不针对创作一致性 |
| 学术 Persona Vectors (arXiv 2507.21509) | 用 embedding 漂移检测角色，但检测后不阻断生成 | 检测与执行脱节 |

**行业共识**：检测能力（detection）有，但 **active enforcement**（检测后真正阻断生成/保存）几乎没有产品实现。这是 NovelForge 的差异化机会。

### 2.3 本模块的差异化设计

```
state-consistency-checker 跑 check_consistency.py
  → 解析 Report，生成 Flag 列表（含 P0/P1）
  → 把 Flag 列表写入 .state/.lock/flags_ch{NNN}.json

save_state.py apply_delta 入口
  → 读 .state/.lock/flags_ch{NNN}.json
  → 若有 P0 Flag 且 can_bypass=False → raise ValueError 阻断写入
  → 若有 P1 Flag 且 can_bypass=True → 警告但允许写入（bypass_reason 留痕）
  → 写入成功后删除该 flag 文件（避免陈旧 flag 误放行后续章节）
```

**核心差异**：flag 不是"建议"而是**入口处的物理门禁**——save_state.py 在 `validate_delta` 之后、`_apply_op` 之前插入 `_check_flags` 步骤，发现 P0 直接 raise，主 Agent 无法绕过。

---

## 三、涉及现有文件

### 3.1 必须先 Read 的文件清单

| 文件 | 行数/位置 | 现状 | 需要关注的内容 |
|---|---|---|---|
| file:///workspace/scripts/novelforge/schema.py | 368 行 | `PIPELINE_SCHEMA` 第 237-253 行已含 4 字段；无 `FLAG_SCHEMA`；`__all__` 第 359-368 行 | 补 `FLAG_SCHEMA` 定义 + `validate_flags` 函数 + 加入 `__all__` |
| file:///workspace/scripts/novelforge/save_state.py | 1137 行 | `apply_delta` 入口第 882-1020 行无 flag 检查；`EMPTY_PIPELINE` 第 146-165 行已含 4 字段 | 在第 919 行（Delta 校验后、`_apply_op` 之前）插入 `_check_flags` 调用；新增 `_load_flags` / `_consume_flags` 辅助函数；新增 `--skip-flag-check` CLI 参数（仅限 dry-run/测试场景） |
| file:///workspace/scripts/novelforge/check_consistency.py | 1460 行 | `Issue` 数据类第 207-223 行（severity / type / detail / suggestion / extras）；`Report` 第 226-248 行（p0_count / p1_count / passed）；`format_json` 第 1347-1368 行 | flag 协议直接复用 Issue 数据结构，无需改 check_consistency.py 本体；可选新增 `--emit-flags <path>` 参数把 Report 转 flag 文件 |
| file:///workspace/.trae/skills/state-consistency-checker/SKILL.md | 346 行 | 第 219-235 行"flag 协议是建议协议"段落 | 更新该段为"已接入"；新增"flag 文件生成"具体步骤；更新工作流第 7 步 |
| file:///workspace/NovelForge_Vault/.state/pipeline.json | 25 行 | 已含 4 字段（第 21-24 行） | 无需修改，作为已完成状态验证 |
| file:///workspace/.trae/checklists/dev-checklist.md | 144 行 | 无 schema 同步检查项 | 在"二、Vault 规范"末尾新增"schema 同步检查"小节 |
| file:///workspace/.trae/rules/dev-workflow.md | 1+ 行 | 第三步执行规范 / 第四步自检规范 | 本模块不直接改，但自检命令清单需在 checklist 中体现 |
| file:///workspace/tests/bug_regression_list.md | 1041 行 | 当前最大编号 BUG-049 | 新增 BUG-051 / BUG-052 |
| file:///workspace/docs/loop_log/2026-07.md | 1+ 行 | 第 94 行已记录教训 3 | 本模块完成后追加一条 #lesson `state_drift` 沉淀 |

### 3.2 守护 Skill 对 4 字段的引用关系（核对依据）

| 守护 Skill | SKILL.md 路径 | 引用的 pipeline 字段 | 写入时机 |
|---|---|---|---|
| recap-generator | file:///workspace/.trae/skills/recap-generator/SKILL.md | `last_recap_chapter` | 每 10 章冻结 recap 后 |
| drift-detector | file:///workspace/.trae/skills/drift-detector/SKILL.md | `last_drift_check_chapter` | 每 10 章体检后 |
| key-scene-archiver | file:///workspace/.trae/skills/key-scene-archiver/SKILL.md | `archived_scenes` | 每章执笔后归档关键场景时 |
| state-consistency-checker | file:///workspace/.trae/skills/state-consistency-checker/SKILL.md | `last_consistency_check_chapter` | 每章执笔后跑完 check_consistency.py 时 |

---

## 四、新增/修改文件清单

### 4.1 修改文件

| 文件 | 核心改动点 |
|---|---|
| file:///workspace/scripts/novelforge/schema.py | (1) 在 `PIPELINE_SCHEMA` 之后新增 `FLAG_SCHEMA` 常量；(2) 新增 `validate_flags(flags: list[dict]) -> list[str]` 函数；(3) `__all__` 加入 `FLAG_SCHEMA` 与 `validate_flags` |
| file:///workspace/scripts/novelforge/save_state.py | (1) 在 `apply_delta` 入口（第 919 行后）插入 `_check_flags(chapter, vault)` 调用；(2) 新增 `_load_flags(vault, chapter) -> list[dict]`；(3) 新增 `_consume_flags(vault, chapter)`；(4) CLI 新增 `--skip-flag-check` 参数（仅 dry-run 与测试用）；(5) 增加常量 `FLAG_LOCK_DIR_REL = ".state/.lock"` 与 `FLAG_FILE_TMPL = "flags_ch{chapter}.json"` |
| file:///workspace/.trae/skills/state-consistency-checker/SKILL.md | (1) 第 219-235 行"flag 协议（建议协议）"段落改为"flag 协议（已接入）"；(2) 工作流第 7 步新增"调用 check_consistency.py 时追加 `--emit-flags` 参数"；(3) 反模式列表新增"不创建 flag 文件就调 save_state.py"项 |
| file:///workspace/.trae/checklists/dev-checklist.md | 在"二、Vault 规范"末尾新增"schema 同步检查"小节，含 3 项检测：PIPELINE_SCHEMA 字段 / FLAG_SCHEMA 定义 / Skill 引用字段一致性 |
| file:///workspace/tests/bug_regression_list.md | 追加 BUG-051「schema 滞后导致守护 Skill 字段缺失」+ BUG-052「flag 协议未接入导致 P0 无法阻断保存」 |

### 4.2 新增文件

| 文件 | 作用 |
|---|---|
| file:///workspace/scripts/check_schema_sync.py | 扫描 `.trae/skills/*/SKILL.md` 引用的 pipeline 字段 vs `schema.py` 的 `PIPELINE_SCHEMA.properties`，发现断链即报错并退出码 1 |
| file:///workspace/tests/test_schema_sync.py | 6 个回归测试用例（详见 §七） |

---

## 五、详细实现步骤

### 5.1 步骤 1 · 设计 PIPELINE_SCHEMA 4 字段的 schema 定义（验证现状）

经 Read 现状核查，4 字段已在 file:///workspace/scripts/novelforge/schema.py 第 247-251 行定义：

```python
# 守护 Skill 进度字段（由对应 Skill 经 save_state.py 更新）
"last_recap_chapter": {"type": "integer", "default": 0, "description": "上次冻结 recap 的末章号，由 recap-generator 更新"},
"last_drift_check_chapter": {"type": "integer", "default": 0, "description": "上次跑 drift-detector 的末章号，由 drift-detector 更新"},
"archived_scenes": {"type": "array", "items": {"type": "object"}, "default": [], "description": "已归档的关键场景清单，由 key-scene-archiver 追加"},
"last_consistency_check_chapter": {"type": "integer", "default": 0, "description": "上次跑 state-consistency-checker 的章号，由 state-consistency-checker 更新"},
```

**字段定义表**：

| 字段 | 类型 | 默认值 | 是否必填 | 写入者 | description |
|---|---|---|---|---|---|
| `last_recap_chapter` | integer | 0 | 否（有默认） | recap-generator 经 save_state.py `op=set pipeline/last_recap_chapter` | 上次冻结 recap 的末章号 |
| `last_drift_check_chapter` | integer | 0 | 否 | drift-detector 经 save_state.py | 上次跑 drift-detector 的末章号 |
| `archived_scenes` | array of object | `[]` | 否 | key-scene-archiver 经 save_state.py `op=append pipeline/archived_scenes` | 已归档关键场景清单 |
| `last_consistency_check_chapter` | integer | 0 | 否 | state-consistency-checker 经 save_state.py | 上次跑 check_consistency.py 的章号 |

**本步骤产出**：在 `tests/test_schema_sync.py::test_pipeline_schema_has_four_guard_fields` 中以断言形式锁定这 4 字段必须存在，避免后续被误删。

### 5.2 步骤 2 · 设计 FLAG_SCHEMA 的 schema 定义

在 file:///workspace/scripts/novelforge/schema.py 的 `PIPELINE_SCHEMA` 之后（即第 254 行附近）新增：

```python
# ============================================================================
# Flag Schema（state-consistency-checker 输出，save_state.py 消费）
# ============================================================================
FLAG_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": (
        "P0/P1 一致性问题的结构化标记。"
        "由 state-consistency-checker 经 check_consistency.py 的 Report 转换生成，"
        "写入 .state/.lock/flags_ch{NNN}.json；"
        "save_state.py 入口处消费：P0 且 can_bypass=False 则 raise 阻断写入，"
        "P1 或 can_bypass=True 则警告但允许写入（bypass_reason 留痕）。"
    ),
    "required": ["flag_id", "severity", "chapter", "rule", "message", "can_bypass"],
    "properties": {
        "flag_id": {
            "type": "string",
            "description": "Flag 唯一 ID，如 F-ch042-001；同一 chapter 内自增",
            "pattern": r"^F-ch\d{3,4}-\d{3}$",
        },
        "severity": {
            "type": "string",
            "enum": ["P0", "P1", "P2"],
            "description": "P0=阻断保存 / P1=警告可豁免 / P2=提示",
        },
        "chapter": {
            "type": "string",
            "description": "章号，如 ch_042；与 delta.chapter 一致",
            "pattern": r"^ch_\d{3,4}$",
        },
        "rule": {
            "type": "string",
            "description": "触发的检测规则名，对应 Issue.type，如 power_level_jump / phantom_item",
            "enum": [
                "power_level_jump", "phantom_item", "location_jump",
                "character_revival", "relationship_mutation",
                "foreshadow_forgetting", "golden_finger_overreach",
            ],
        },
        "message": {
            "type": "string",
            "description": "人类可读的问题描述（来自 Issue.detail）",
        },
        "can_bypass": {
            "type": "boolean",
            "default": False,
            "description": "P0=False 不可豁免；P1=True 可豁免（需填 bypass_reason）",
        },
        "bypass_reason": {
            "type": ["string", "null"],
            "default": None,
            "description": "豁免原因，can_bypass=True 且实际豁免时必填",
        },
        "suggestion": {
            "type": "string",
            "default": "",
            "description": "修复建议（来自 Issue.suggestion）",
        },
        "extras": {
            "type": "object",
            "default": {},
            "description": "附加结构化字段（来自 Issue.extras）",
        },
        "created_at": {
            "type": "string",
            "description": "Flag 创建时间 ISO8601，由 state-consistency-checker 填写",
        },
    },
}


# flag 文件整体 schema（.state/.lock/flags_ch{NNN}.json）
FLAG_FILE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["chapter", "flags"],
    "properties": {
        "chapter": {"type": "string", "pattern": r"^ch_\d{3,4}$"},
        "generated_at": {"type": "string"},
        "check_consistency_version": {"type": "string", "default": "1.0"},
        "flags": {
            "type": "array",
            "items": FLAG_SCHEMA,
            "default": [],
        },
    },
}
```

并在 `__all__` 中加入 `FLAG_SCHEMA` 与 `FLAG_FILE_SCHEMA`。

新增校验函数（与现有 `validate_character_state` / `validate_foreshadow` / `validate_delta` 风格一致）：

```python
def validate_flags(flags: list[dict]) -> list[str]:
    """校验 Flag 列表，返回错误列表（空列表=通过）。

    检查项：
    - 每个 flag 含 required 字段
    - severity 合法（P0/P1/P2）
    - rule 在白名单内
    - can_bypass=True 时 bypass_reason 必须非空
    - P0 的 can_bypass 必须为 False（P0 不可豁免）
    """
    errors: list[str] = []
    valid_severities = {"P0", "P1", "P2"}
    valid_rules = {
        "power_level_jump", "phantom_item", "location_jump",
        "character_revival", "relationship_mutation",
        "foreshadow_forgetting", "golden_finger_overreach",
    }
    for i, flag in enumerate(flags):
        for field_name in FLAG_SCHEMA["required"]:
            if field_name not in flag:
                errors.append(f"flag[{i}] 缺少必填字段: {field_name}")
        sev = flag.get("severity")
        if sev not in valid_severities:
            errors.append(f"flag[{i}] severity 非法: {sev}")
        rule = flag.get("rule")
        if rule not in valid_rules:
            errors.append(f"flag[{i}] rule 非法: {rule}")
        # P0 不可豁免
        if sev == "P0" and flag.get("can_bypass") is True:
            errors.append(f"flag[{i}] P0 不允许 can_bypass=True（P0 不可豁免）")
        # 可豁免但未填原因
        if flag.get("can_bypass") is True and not flag.get("bypass_reason"):
            errors.append(f"flag[{i}] can_bypass=True 但未填 bypass_reason")
    return errors
```

### 5.3 步骤 3 · save_state.py 入口处接入 flag 协议

#### 5.3.1 新增常量与导入

在 file:///workspace/scripts/novelforge/save_state.py 第 73 行 `STATE_LOG_REL` 之后新增：

```python
# Flag 协议相关路径（state-consistency-checker 写入，save_state.py 消费）
FLAG_LOCK_DIR_REL: str = ".state/.lock"
FLAG_FILE_TMPL: str = "flags_ch{chapter_num:03d}.json"
```

修改第 47-58 行的 import 块，新增 `validate_flags` 与 `FLAG_FILE_SCHEMA`：

```python
try:
    from .schema import (
        validate_character_state,
        validate_foreshadow,
        validate_delta,
        validate_flags,           # 新增
        FLAG_FILE_SCHEMA,          # 新增
    )
except ImportError:
    from scripts.novelforge.schema import (  # type: ignore
        validate_character_state,
        validate_foreshadow,
        validate_delta,
        validate_flags,           # 新增
        FLAG_FILE_SCHEMA,          # 新增
    )
```

#### 5.3.2 新增辅助函数（放在 `_deep_merge` 之后，第 253 行附近）

```python
def _flag_file_path(vault: str, chapter: str) -> str:
    """返回某章的 flag 文件绝对路径。

    Args:
        vault: Vault 根目录。
        chapter: 章号字符串，如 ``ch_042``。

    Returns:
        ``{vault}/.state/.lock/flags_ch042.json``。
    """
    chapter_num = _parse_chapter_num(chapter)
    return _state_file_path(
        vault, f"{FLAG_LOCK_DIR_REL}/{FLAG_FILE_TMPL.format(chapter_num=chapter_num)}"
    )


def _load_flags(vault: str, chapter: str) -> list[dict[str, Any]]:
    """读取某章的 flag 列表。

    文件不存在 → 返回空列表（视为"未跑 check_consistency.py"）。
    文件存在但 JSON 解析失败 → raise ValueError（flag 文件被污染不应静默）。
    """
    path = _flag_file_path(vault, chapter)
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    flags = data.get("flags", [])
    if not isinstance(flags, list):
        raise ValueError(f"Flag 文件 {path} 的 flags 字段不是数组")
    return flags


def _check_flags(
    vault: str,
    chapter: str,
    skip_flag_check: bool = False,
) -> None:
    """检查 flag 协议：P0 阻断，P1 留痕可豁免。

    Args:
        vault: Vault 根目录。
        chapter: 当前 Delta 的章号。
        skip_flag_check: ``True`` 则跳过检查（仅 dry-run 与单测场景使用，
            生产环境禁止开启）。

    Raises:
        ValueError: 存在 P0 flag（can_bypass=False）时 raise，阻断 save_state。
    """
    if skip_flag_check:
        return

    flags = _load_flags(vault, chapter)
    if not flags:
        # 无 flag 文件：不阻断但 warning（建议先跑 state-consistency-checker）
        # 仅 warn 不阻断是为了兼容历史章节与 shortform 模式
        print(
            f"[WARNING] 章 {chapter} 无 flag 文件，建议先跑 "
            f"state-consistency-checker 后再 save_state（当前仅警告不阻断）",
            file=sys.stderr,
        )
        return

    # flag 文件存在 → 严格校验
    errors = validate_flags(flags)
    if errors:
        raise ValueError(
            f"Flag 文件校验失败 [{chapter}]: {'; '.join(errors)}"
        )

    p0_flags = [f for f in flags if f.get("severity") == "P0" and not f.get("can_bypass")]
    p1_flags = [f for f in flags if f.get("severity") == "P1"]

    if p0_flags:
        # P0 阻断：列出所有 P0 问题
        lines = [f"🔴 章 {chapter} 存在 {len(p0_flags)} 个 P0 一致性问题，阻断 save_state："]
        for f in p0_flags:
            lines.append(f"  - [{f.get('rule')}] {f.get('message')}")
            if f.get("suggestion"):
                lines.append(f"    修复建议: {f.get('suggestion')}")
        lines.append(
            "请先修复 P0 问题后重跑 state-consistency-checker，"
            "再调用 save_state.py。"
        )
        raise ValueError("\n".join(lines))

    if p1_flags:
        # P1 警告但不阻断：bypass_reason 留痕
        bypassed = [f for f in p1_flags if f.get("can_bypass") and f.get("bypass_reason")]
        unhandled = [f for f in p1_flags if not f.get("can_bypass")]
        if bypassed:
            print(
                f"[WARNING] 章 {chapter} 有 {len(bypassed)} 个 P1 flag 已豁免（留痕）：",
                file=sys.stderr,
            )
            for f in bypassed:
                print(
                    f"  - [{f.get('rule')}] {f.get('bypass_reason')}",
                    file=sys.stderr,
                )
        if unhandled:
            print(
                f"[WARNING] 章 {chapter} 有 {len(unhandled)} 个 P1 flag 未豁免，"
                "建议修复后重跑（当前不阻断）",
                file=sys.stderr,
            )


def _consume_flags(vault: str, chapter: str) -> None:
    """save_state 成功写入后删除 flag 文件（避免陈旧 flag 误放行后续章节）。

    失败只 warning 不 raise（消费失败不应阻塞主流程）。
    """
    path = _flag_file_path(vault, chapter)
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError as e:
        print(f"[WARNING] 删除 flag 文件 {path} 失败: {e}", file=sys.stderr)
```

#### 5.3.3 修改 `apply_delta` 入口（第 882-1020 行）

在 `apply_delta` 函数签名新增 `skip_flag_check` 参数：

```python
def apply_delta(
    delta: dict[str, Any],
    vault: str = DEFAULT_VAULT,
    dry_run: bool = False,
    no_commit: bool = False,
    skip_flag_check: bool = False,   # 新增
) -> dict[str, Any]:
    """应用一个 Delta，执行所有 op 并落盘。

    Args:
        ...
        skip_flag_check: ``True`` 跳过 flag 协议检查（仅 dry-run 与单测场景使用）。
    """
    # === a. Delta 格式校验 ===
    errors = validate_delta(delta)
    if errors:
        raise ValueError("Delta 校验失败:\n  - " + "\n  - ".join(errors))

    chapter = delta.get("chapter", "")
    ops = delta.get("ops", [])

    # === a2. Flag 协议检查（新增）===
    # 在 Delta 校验后、_apply_op 之前；P0 阻断写入
    _check_flags(vault, chapter, skip_flag_check=skip_flag_check)

    # === b. 逐 op 执行（仅在内存中，不落盘）===
    file_states: dict[str, dict[str, Any]] = {}
    # ...（原逻辑不变）
```

在 `dry_run` 分支返回前（第 948-958 行附近）**不消费 flag**（因为没真正写入）；在成功落盘后（第 1000 行 `_git_commit` 之前）调用 `_consume_flags`：

```python
    # === c. 全部成功 → 原子写入所有改动文件 ===
    changed_files_sorted = sorted(changed_files)
    for file_abs in changed_files_sorted:
        _atomic_write_json(file_abs, file_states[file_abs])

    # === c2. 消费 flag 文件（新增）===
    _consume_flags(vault, chapter)

    # === d. characters_index.md 重生成 ===
    # ...（原逻辑不变）
```

#### 5.3.4 修改 CLI 入口（main 函数 + argparse）

在 `_build_arg_parser` 中新增参数：

```python
parser.add_argument(
    "--skip-flag-check",
    dest="skip_flag_check",
    action="store_true",
    help="跳过 flag 协议检查（仅 dry-run 与单测场景使用，生产环境禁止）",
)
```

在 `main` 中调用 `apply_delta` 时传入：

```python
result = apply_delta(
    delta,
    vault=args.vault,
    dry_run=args.dry_run,
    no_commit=args.no_commit,
    skip_flag_check=args.skip_flag_check,   # 新增
)
```

### 5.4 步骤 4 · state-consistency-checker SKILL.md 更新

修改 file:///workspace/.trae/skills/state-consistency-checker/SKILL.md 第 219-235 行的"flag 协议（建议协议，待 save_state.py 接入）"段落，替换为：

```markdown
# 与 save_state.py 的 flag 协议（已接入，硬性门禁）

**设计意图**：`save_state.py` 在 `apply_delta` 入口处（Delta 校验后、`_apply_op` 之前）调用 `_check_flags(vault, chapter)`，发现 P0 flag 直接 `raise ValueError` 阻断写入。

## flag 文件格式

文件路径：``NovelForge_Vault/.state/.lock/flags_ch{NNN}.json``

```json
{
  "chapter": "ch_042",
  "generated_at": "2026-07-18T14:30:00",
  "check_consistency_version": "1.0",
  "flags": [
    {
      "flag_id": "F-ch042-001",
      "severity": "P0",
      "chapter": "ch_042",
      "rule": "power_level_jump",
      "message": "主角状态机境界: 练气三层；正文提及境界: 元婴；本章无突破场景",
      "can_bypass": false,
      "bypass_reason": null,
      "suggestion": "补充突破场景（闭关/顿悟/冲击瓶颈），或修正正文境界描述",
      "extras": {"state_realm": "练气三层", "text_realm": "元婴"},
      "created_at": "2026-07-18T14:30:00"
    }
  ]
}
```

## flag 生成流程

本 Skill 跑完 ``check_consistency.py --chapter {NNN} --json`` 后：

1. 解析 JSON 中的 ``issues[]``，每个 Issue 转换为一个 Flag：
   - ``severity=Issue.severity``（P0/P1）
   - ``rule=Issue.type``
   - ``message=Issue.detail``
   - ``suggestion=Issue.suggestion``
   - ``extras=Issue.extras``
2. 对每个 Flag 设置 ``can_bypass``：
   - P0 → ``can_bypass=false``（不可豁免）
   - P1 → ``can_bypass=true``（可豁免，作者填 ``bypass_reason`` 后豁免）
3. 写入 ``.state/.lock/flags_ch{NNN}.json``（与 ``EMPTY_FLAG_FILE`` 模板一致）。
4. 提示作者：可调用 ``save_state.py``。若是 P1 豁免，必须在 flag 文件中补 ``bypass_reason``。

## flag 生命周期

```
state-consistency-checker 通过检查
  → 写 .state/.lock/flags_ch{NNN}.json

save_state.py apply_delta 入口
  → 读 flags_ch{NNN}.json
  → 有 P0 且 can_bypass=false → raise ValueError 阻断写入
  → 有 P1 且 can_bypass=true（含 bypass_reason）→ warning 但允许写入
  → 无 flag 文件 → warning（建议先跑 check_consistency）
  → 成功写入后 → 删除该 flag 文件（避免陈旧 flag 误放行后续章节）
```

## CLI 用法

```bash
# state-consistency-checker 生成 flag
python -m scripts.novelforge.check_consistency --chapter 42 --emit-flags .state/.lock/flags_ch042.json

# save_state.py 写入（自动检查 flag）
python -m scripts.novelforge.save_state --delta delta.json

# 跳过 flag 检查（仅 dry-run 与单测场景）
python -m scripts.novelforge.save_state --delta delta.json --dry-run --skip-flag-check
```
```

同时在文件末尾"反模式（禁止）"列表新增：

```markdown
- 不创建 flag 文件就直接调 save_state.py —— 即使无 flag 文件 save_state.py 当前仅 warning 不阻断，但这是工程债的临时兼容，正确流程必须先生成 flag。dev-checklist.md 会新增"schema 同步检查"项校验此点。
- 不在 P1 豁免时填 bypass_reason —— P1 flag 的 can_bypass=true 但 bypass_reason 为空会被 validate_flags 拒绝。
```

并更新"工作流"第 7 步（"通过"分支）：

```markdown
7. **通过**：``p0_count = 0`` → 生成 flag 文件（含 P1 警告）→ 允许 ``save_state.py``。save_state.py 入口处会读取该 flag 文件，P0 阻断 / P1 留痕。
```

### 5.5 步骤 5 · check_schema_sync.py 脚本

新增 file:///workspace/scripts/check_schema_sync.py，完整逻辑如下：

```python
"""NovelForge Schema 同步校验脚本。

扫描 .trae/skills/*/SKILL.md 中引用的 pipeline 字段，与
scripts/novelforge/schema.py 的 PIPELINE_SCHEMA.properties 对比，
发现 Skill 引用了 schema 未定义的字段即报错。

设计目的：防止"schema 滞后于 Skill 设计"再次发生（loop_log 2026-07 教训 3）。

CLI 速查：
    # 默认扫描 .trae/skills 全部 Skill
    python scripts/check_schema_sync.py

    # 指定 skills 目录
    python scripts/check_schema_sync.py --skills-dir /custom/skills

    # JSON 输出（CI 集成）
    python scripts/check_schema_sync.py --json

退出码：
- 0：所有 Skill 引用的字段均在 schema 中定义
- 1：发现未同步字段
- 2：脚本错误
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# 复用 NovelForge schema
sys.path.insert(0, str(Path(__file__).parent))
from novelforge.schema import PIPELINE_SCHEMA  # noqa: E402


# 已知的 pipeline 字段引用模式（Skill markdown 中常见写法）
# 匹配 op=set pipeline/<field> / op=append pipeline/<field> / pipeline/<field> 等
PIPELINE_FIELD_PATTERN = re.compile(
    r"pipeline/([a-z_]+)",
    re.IGNORECASE,
)

# Skill 文件中显式声明的字段名（如"本 Skill 更新 pipeline 的 last_recap_chapter 字段"）
EXPLICIT_FIELD_PATTERN = re.compile(
    r"pipeline(?:的|\.?\s*)(?:字段)?\s*[:：]?\s*`?([a-z_][a-z_0-9]+)`?",
    re.IGNORECASE,
)

# 已知合法字段（PIPELINE_SCHEMA.properties 的 key + 注释性字段如 _comment）
KNOWN_NON_SCHEMA_FIELDS = {"_comment", "_comment_purpose", "_comment_mode",
                           "_comment_current_stage", "_comment_stages",
                           "_comment_history"}


def scan_skill_file(skill_path: Path) -> set[str]:
    """扫描单个 SKILL.md，返回其中引用的 pipeline 字段名集合。"""
    text = skill_path.read_text(encoding="utf-8")
    fields: set[str] = set()
    for m in PIPELINE_FIELD_PATTERN.finditer(text):
        fields.add(m.group(1).lower())
    for m in EXPLICIT_FIELD_PATTERN.finditer(text):
        field = m.group(1).lower()
        # 过滤掉明显不是字段的词
        if field not in {"json", "md", "py", "the", "and", "or", "of", "in"}:
            fields.add(field)
    return fields


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python scripts/check_schema_sync.py",
        description="校验 Skill 引用的 pipeline 字段 vs schema.py 的 PIPELINE_SCHEMA",
    )
    parser.add_argument(
        "--skills-dir",
        default=".trae/skills",
        help="Skill 根目录（默认 .trae/skills）",
    )
    parser.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="JSON 输出（CI 集成）",
    )
    args = parser.parse_args(argv)

    skills_root = Path(args.skills_dir)
    if not skills_root.is_dir():
        print(f"[FAIL] Skill 目录不存在: {skills_root}", file=sys.stderr)
        return 2

    # schema.py 定义的 pipeline 字段
    schema_fields = set(PIPELINE_SCHEMA.get("properties", {}).keys())
    # 加上非 schema 的注释字段（允许）
    schema_fields |= KNOWN_NON_SCHEMA_FIELDS

    # 扫描所有 Skill
    skill_files = sorted(skills_root.rglob("SKILL.md"))
    if not skill_files:
        print(f"[WARN] 未在 {skills_root} 找到任何 SKILL.md", file=sys.stderr)

    referenced: dict[str, set[str]] = {}
    for sf in skill_files:
        referenced[str(sf)] = scan_skill_file(sf)

    # 找未同步字段
    unsync: dict[str, list[str]] = {}
    for skill_path, fields in referenced.items():
        missing = sorted(f for f in fields if f not in schema_fields)
        if missing:
            unsync[skill_path] = missing

    if args.as_json:
        print(json.dumps({
            "schema_fields": sorted(schema_fields - KNOWN_NON_SCHEMA_FIELDS),
            "referenced_by_skill": {k: sorted(v) for k, v in referenced.items()},
            "unsynced": unsync,
            "unsynced_count": sum(len(v) for v in unsync.values()),
        }, ensure_ascii=False, indent=2))
    else:
        if unsync:
            print(f"[FAIL] 发现 {sum(len(v) for v in unsync.values())} 个未同步字段：")
            for skill_path, missing in unsync.items():
                print(f"  {skill_path}:")
                for f in missing:
                    print(f"    - pipeline/{f} （未在 PIPELINE_SCHEMA 中定义）")
            print()
            print("修复方法：")
            print("  1. 若字段确实需要 → 在 scripts/novelforge/schema.py 的")
            print("     PIPELINE_SCHEMA.properties 中新增该字段定义")
            print("  2. 若字段不需要 → 修改 Skill 文件移除该引用")
            print("  3. 若字段是注释类（_comment_*）→ 在脚本 KNOWN_NON_SCHEMA_FIELDS 中登记")
            return 1
        else:
            print(f"[OK] 所有 Skill 引用的 pipeline 字段均在 schema 中定义")
            print(f"     扫描 Skill 文件数：{len(skill_files)}")
            print(f"     schema 字段数：{len(schema_fields - KNOWN_NON_SCHEMA_FIELDS)}")
            return 0

    return 0 if not unsync else 1


if __name__ == "__main__":
    sys.exit(main())
```

### 5.6 步骤 6 · dev-checklist.md 新增"schema 同步检查"项

在 file:///workspace/.trae/checklists/dev-checklist.md 的"二、Vault 规范"末尾（第 28 行后）新增：

```markdown
- [ ] schema 同步检查：新增/修改 Skill 引用 pipeline 字段时，已运行 `python scripts/check_schema_sync.py --skills-dir .trae/skills` 全部通过（防止 schema 滞后于 Skill 设计，loop_log 2026-07 教训 3）
- [ ] FLAG_SCHEMA 一致性：若新增守护 Skill 引用 flag 协议，已在 `scripts/novelforge/schema.py` 的 `FLAG_SCHEMA.properties.rule.enum` 中登记新规则名
- [ ] state-consistency-checker flag 协议：调用 save_state.py 前，已确认 `.state/.lock/flags_ch{NNN}.json` 存在；P0 flag 已修复（can_bypass=false 的 P0 会被 save_state.py 入口处 raise 阻断）
```

并在"自检报告模板"的"二、Vault 规范"小节加入对应报告项：

```markdown
- ✅/❌ schema 同步检查：____
- ✅/❌ FLAG_SCHEMA 一致性：____
- ✅/❌ flag 协议：____
```

---

## 六、验证方式

### 6.1 单元测试

```bash
pytest -q tests/test_schema_sync.py
```

期望：6 个用例全部通过（详见 §七）。

### 6.2 集成测试 1 · check_schema_sync 脚本

```bash
python scripts/check_schema_sync.py --skills-dir .trae/skills
```

期望输出：

```
[OK] 所有 Skill 引用的 pipeline 字段均在 schema 中定义
     扫描 Skill 文件数：14
     schema 字段数：11
```

退出码 0。

### 6.3 集成测试 2 · 故意触发 P0 验证 save_state 阻断

```bash
# Step 1：构造一个 P0 flag 文件
mkdir -p NovelForge_Vault/.state/.lock
cat > NovelForge_Vault/.state/.lock/flags_ch099.json <<'EOF'
{
  "chapter": "ch_099",
  "generated_at": "2026-07-18T15:00:00",
  "check_consistency_version": "1.0",
  "flags": [
    {
      "flag_id": "F-ch099-001",
      "severity": "P0",
      "chapter": "ch_099",
      "rule": "power_level_jump",
      "message": "主角状态机境界: 练气三层；正文提及境界: 元婴",
      "can_bypass": false,
      "bypass_reason": null,
      "suggestion": "补充突破场景",
      "extras": {},
      "created_at": "2026-07-18T15:00:00"
    }
  ]
}
EOF

# Step 2：构造一个合法 Delta（写 pipeline.current_chapter）
cat > /tmp/delta_ch099.json <<'EOF'
{
  "chapter": "ch_099",
  "ops": [
    {"op": "set", "path": "pipeline/current_chapter", "value": 99}
  ]
}
EOF

# Step 3：尝试 save_state，期望被 P0 阻断
python -m scripts.novelforge.save_state --delta /tmp/delta_ch099.json --no-commit
echo "Exit code: $?"

# Step 4：清理（不应执行到这步，但万一没阻断要清理）
rm -f NovelForge_Vault/.state/.lock/flags_ch099.json
```

**断言**：Step 3 退出码非 0，stderr 含"P0 一致性问题，阻断 save_state"。

### 6.4 集成测试 3 · P1 可豁免验证

```bash
# 构造 P1 flag（can_bypass=true，含 bypass_reason）
cat > NovelForge_Vault/.state/.lock/flags_ch099.json <<'EOF'
{
  "chapter": "ch_099",
  "generated_at": "2026-07-18T15:00:00",
  "flags": [
    {
      "flag_id": "F-ch099-001",
      "severity": "P1",
      "chapter": "ch_099",
      "rule": "relationship_mutation",
      "message": "关系突变但无转变场景",
      "can_bypass": true,
      "bypass_reason": "作者刻意安排突兀和解，后续章节会补铺垫",
      "suggestion": "补充关系转变场景",
      "extras": {},
      "created_at": "2026-07-18T15:00:00"
    }
  ]
}
EOF

python -m scripts.novelforge.save_state --delta /tmp/delta_ch099.json --no-commit
echo "Exit code: $?"
```

**断言**：退出码 0，stderr 含"1 个 P1 flag 已豁免（留痕）"。

### 6.5 断言清单

| # | 断言 | 验证方式 |
|---|---|---|
| 1 | PIPELINE_SCHEMA 含 4 个守护 Skill 字段 | `test_pipeline_schema_has_four_guard_fields` |
| 2 | FLAG_SCHEMA 定义完整（7 required + 4 optional 字段） | `test_flag_schema_definition` |
| 3 | save_state.py 在 P0 flag 时 raise ValueError | `test_save_state_blocks_on_p0_flag` |
| 4 | save_state.py 在 P1 flag + bypass_reason 时允许写入并 warning | `test_save_state_allows_p1_flag_with_bypass` |
| 5 | check_schema_sync.py 脚本可运行且退出码正确 | `test_check_schema_sync_script_runs` |
| 6 | state-consistency-checker SKILL.md 已更新 flag 协议描述 | `test_state_consistency_checker_flag_protocol` |
| 7 | flag 文件成功写入后被 save_state.py 消费（删除） | 集成测试 3 后断言文件不存在 |
| 8 | 现有 save_state.py 既有用例（无 flag 文件场景）仍可工作（warning 但不阻断） | 跑既有 `pytest -q tests/test_save_state*.py`（若存在） |

### 6.6 与现有校验脚本的关系

- **不冲突** `check_consistency.py`：本模块只读取 Issue 结构，不修改 check_consistency.py 本体；可选新增 `--emit-flags <path>` 参数（若不实现则由 state-consistency-checker Skill 解析 JSON 后自行写 flag 文件）
- **不冲突** `check_ai_novel.py`：去 AI 味检测独立运行，不参与 flag 协议
- **强化** dev-workflow.md 第三步"合并前必须清零所有校验问题"：flag 协议让"清零"从口头要求变成代码强制

---

## 七、回归测试要求

### 7.1 新增 pytest 用例

文件：file:///workspace/tests/test_schema_sync.py

```python
"""NovelForge M2 schema 同步门禁回归测试。

覆盖：
- PIPELINE_SCHEMA 4 个守护 Skill 字段存在性
- FLAG_SCHEMA 定义完整性
- save_state.py flag 协议（P0 阻断 / P1 可豁免）
- check_schema_sync.py 脚本可运行
- state-consistency-checker SKILL.md flag 协议描述已更新
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# 复用 NovelForge 包
WORKSPACE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WORKSPACE))

from scripts.novelforge.schema import (  # noqa: E402
    PIPELINE_SCHEMA,
    FLAG_SCHEMA,
    FLAG_FILE_SCHEMA,
    validate_flags,
)
from scripts.novelforge.save_state import (  # noqa: E402
    apply_delta,
    _flag_file_path,
    DEFAULT_VAULT,
)


# ============================================================================
# 1. PIPELINE_SCHEMA 4 字段存在性
# ============================================================================
def test_pipeline_schema_has_four_guard_fields():
    """断言 PIPELINE_SCHEMA 含 4 个守护 Skill 字段。

    防止 schema 滞后于 Skill 设计（loop_log 2026-07 教训 3）再次发生。
    """
    props = PIPELINE_SCHEMA["properties"]
    assert "last_recap_chapter" in props, "缺 last_recap_chapter（recap-generator 引用）"
    assert "last_drift_check_chapter" in props, "缺 last_drift_check_chapter（drift-detector 引用）"
    assert "archived_scenes" in props, "缺 archived_scenes（key-scene-archiver 引用）"
    assert "last_consistency_check_chapter" in props, "缺 last_consistency_check_chapter（state-consistency-checker 引用）"

    # 字段类型断言
    assert props["last_recap_chapter"]["type"] == "integer"
    assert props["last_drift_check_chapter"]["type"] == "integer"
    assert props["archived_scenes"]["type"] == "array"
    assert props["last_consistency_check_chapter"]["type"] == "integer"

    # 默认值断言
    assert props["last_recap_chapter"]["default"] == 0
    assert props["archived_scenes"]["default"] == []


# ============================================================================
# 2. FLAG_SCHEMA 定义完整性
# ============================================================================
def test_flag_schema_definition():
    """断言 FLAG_SCHEMA 含全部 required 字段且类型正确。"""
    required = FLAG_SCHEMA["required"]
    expected_required = {"flag_id", "severity", "chapter", "rule", "message", "can_bypass"}
    assert set(required) == expected_required, f"required 字段不匹配：{set(required)} vs {expected_required}"

    props = FLAG_SCHEMA["properties"]
    assert props["severity"]["enum"] == ["P0", "P1", "P2"]
    assert props["can_bypass"]["type"] == "boolean"
    assert props["can_bypass"]["default"] is False

    # rule 必须是 check_consistency.py 的 7 类 type
    expected_rules = {
        "power_level_jump", "phantom_item", "location_jump",
        "character_revival", "relationship_mutation",
        "foreshadow_forgetting", "golden_finger_overreach",
    }
    assert set(props["rule"]["enum"]) == expected_rules

    # validate_flags 函数测试
    valid_flag = {
        "flag_id": "F-ch042-001",
        "severity": "P0",
        "chapter": "ch_042",
        "rule": "power_level_jump",
        "message": "境界跳级",
        "can_bypass": False,
    }
    assert validate_flags([valid_flag]) == []

    # P0 不可豁免
    invalid_p0 = dict(valid_flag, can_bypass=True)
    errors = validate_flags([invalid_p0])
    assert any("P0 不允许 can_bypass=True" in e for e in errors)

    # P1 可豁免但需 bypass_reason
    p1_flag = {
        "flag_id": "F-ch042-002",
        "severity": "P1",
        "chapter": "ch_042",
        "rule": "relationship_mutation",
        "message": "关系突变",
        "can_bypass": True,
        "bypass_reason": "作者刻意安排",
    }
    assert validate_flags([p1_flag]) == []

    p1_no_reason = dict(p1_flag, bypass_reason=None)
    errors = validate_flags([p1_no_reason])
    assert any("未填 bypass_reason" in e for e in errors)


# ============================================================================
# 3. save_state.py P0 阻断
# ============================================================================
def test_save_state_blocks_on_p0_flag(tmp_path):
    """构造 P0 flag 文件，验证 save_state.py 入口处 raise。"""
    # 用 tmp_path 作为独立 Vault
    vault = str(tmp_path)
    os.makedirs(os.path.join(vault, ".state", ".lock"), exist_ok=True)
    os.makedirs(os.path.join(vault, ".state", "characters"), exist_ok=True)

    # 写 P0 flag
    flag_path = _flag_file_path(vault, "ch_099")
    with open(flag_path, "w", encoding="utf-8") as f:
        json.dump({
            "chapter": "ch_099",
            "generated_at": "2026-07-18T15:00:00",
            "flags": [{
                "flag_id": "F-ch099-001",
                "severity": "P0",
                "chapter": "ch_099",
                "rule": "power_level_jump",
                "message": "境界跳级",
                "can_bypass": False,
                "suggestion": "补突破场景",
                "extras": {},
                "created_at": "2026-07-18T15:00:00",
            }],
        }, f, ensure_ascii=False)

    # 构造合法 Delta
    delta = {
        "chapter": "ch_099",
        "ops": [{"op": "set", "path": "pipeline/current_chapter", "value": 99}],
    }

    # 期望 raise
    with pytest.raises(ValueError, match=r"P0 一致性问题.*阻断 save_state"):
        apply_delta(delta, vault=vault, no_commit=True)

    # flag 文件应仍存在（未消费）
    assert os.path.exists(flag_path), "P0 阻断时 flag 文件不应被消费"


# ============================================================================
# 4. save_state.py P1 可豁免
# ============================================================================
def test_save_state_allows_p1_flag_with_bypass(tmp_path, capsys):
    """P1 flag + can_bypass=True + bypass_reason → 允许写入并 warning。"""
    vault = str(tmp_path)
    os.makedirs(os.path.join(vault, ".state", ".lock"), exist_ok=True)

    flag_path = _flag_file_path(vault, "ch_099")
    with open(flag_path, "w", encoding="utf-8") as f:
        json.dump({
            "chapter": "ch_099",
            "generated_at": "2026-07-18T15:00:00",
            "flags": [{
                "flag_id": "F-ch099-001",
                "severity": "P1",
                "chapter": "ch_099",
                "rule": "relationship_mutation",
                "message": "关系突变",
                "can_bypass": True,
                "bypass_reason": "作者刻意安排突兀和解",
                "suggestion": "补转变场景",
                "extras": {},
                "created_at": "2026-07-18T15:00:00",
            }],
        }, f, ensure_ascii=False)

    delta = {
        "chapter": "ch_099",
        "ops": [{"op": "set", "path": "pipeline/current_chapter", "value": 99}],
    }

    result = apply_delta(delta, vault=vault, no_commit=True)
    assert result["ok"] is True

    # flag 文件应被消费
    assert not os.path.exists(flag_path), "成功写入后 flag 文件应被删除"

    # stderr 含 warning
    captured = capsys.readouterr()
    assert "P1 flag 已豁免" in captured.err or "P1 flag" in captured.err


# ============================================================================
# 5. check_schema_sync.py 脚本可运行
# ============================================================================
def test_check_schema_sync_script_runs():
    """跑 check_schema_sync.py，期望退出码 0。"""
    result = subprocess.run(
        [sys.executable, str(WORKSPACE / "scripts" / "check_schema_sync.py"),
         "--skills-dir", str(WORKSPACE / ".trae" / "skills")],
        capture_output=True,
        text=True,
        cwd=str(WORKSPACE),
    )
    assert result.returncode == 0, (
        f"check_schema_sync.py 失败：\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    assert "所有 Skill 引用的 pipeline 字段均在 schema 中定义" in result.stdout


# ============================================================================
# 6. state-consistency-checker SKILL.md flag 协议描述已更新
# ============================================================================
def test_state_consistency_checker_flag_protocol():
    """断言 SKILL.md 已从"建议协议"更新为"已接入"。"""
    skill_path = WORKSPACE / ".trae" / "skills" / "state-consistency-checker" / "SKILL.md"
    text = skill_path.read_text(encoding="utf-8")

    # 不应再出现"建议协议，待 save_state.py 接入"
    assert "建议协议" not in text or "已接入" in text, (
        "state-consistency-checker SKILL.md 仍标注 flag 协议为'建议协议'，"
        "需更新为'已接入'"
    )

    # 应包含 flag 文件路径模板
    assert ".state/.lock/flags_ch" in text, "SKILL.md 应说明 flag 文件路径"

    # 应包含 P0 阻断语义
    assert "P0" in text and "阻断" in text
```

### 7.2 BUG-051 · schema 滞后导致守护 Skill 字段缺失

在 file:///workspace/tests/bug_regression_list.md 末尾追加：

```markdown
## schema 滞后导致守护 Skill 字段缺失

- **编号**：BUG-051
- **首次出现**：2026-07-18（loop_log 2026-07 教训 3 沉淀时识别）
- **类型**：一致性 / 数据
- **现象**：`scripts/novelforge/schema.py` 的 `PIPELINE_SCHEMA` 一度缺失 4 个守护 Skill 引用的字段（`last_recap_chapter` / `last_drift_check_chapter` / `archived_scenes` / `last_consistency_check_chapter`），导致守护 Skill 读 `pipeline.json` 时出现 KeyError，save_state.py 校验时无依据。
- **根因**：Skill 设计先行，schema 更新滞后。4 个守护 Skill（recap-generator / drift-detector / key-scene-archiver / state-consistency-checker）的 SKILL.md 假设 `pipeline.json` 含这些字段，但 schema.py 一度无定义，save_state.py 的 `EMPTY_PIPELINE` 模板也未含这些字段。
- **修复**：(1) `schema.py` 第 247-251 行已补 `PIPELINE_SCHEMA.properties` 的 4 字段定义；(2) `save_state.py` 第 159-164 行 `EMPTY_PIPELINE` 已补默认值；(3) 新增 `scripts/check_schema_sync.py` 持续校验 Skill 引用字段 vs schema 定义字段；(4) 新增 `tests/test_schema_sync.py::test_pipeline_schema_has_four_guard_fields` 锁定字段存在性；(5) `dev-checklist.md` 新增"schema 同步检查"项。
- **涉及文件**：`scripts/novelforge/schema.py`、`scripts/novelforge/save_state.py`、`scripts/check_schema_sync.py`（新增）、`.trae/checklists/dev-checklist.md`、`tests/test_schema_sync.py`（新增）
- **回归测试**：`tests/test_schema_sync.py::test_pipeline_schema_has_four_guard_fields` 断言 4 字段必须存在；`tests/test_schema_sync.py::test_check_schema_sync_script_runs` 断言 Skill-schema 同步校验脚本可运行
- **教训/沉淀**：新增 Skill 引用状态字段时，必须同步更新 `schema.py` 和 `save_state.py` 的默认值。已沉淀至 `docs/loop_log/2026-07.md` 教训 3，本 bug 是该教训的回归测试锁定。
```

### 7.3 BUG-052 · flag 协议未接入导致 P0 无法阻断保存

```markdown
## flag 协议未接入导致 P0 无法阻断保存

- **编号**：BUG-052
- **首次出现**：2026-07-18
- **类型**：一致性 / 工具链
- **现象**：`state-consistency-checker/SKILL.md` 标注"flag 协议是建议协议，待 save_state.py 接入"，导致 `check_consistency.py` 检测出 P0 问题（境界跳级、物品凭空、位置穿越、角色复生）后只能输出报告 + `--strict` 退出码 1，但无手段阻止主 Agent 继续调 `save_state.py`。"P0 阻断保存"在文档里写了，代码层无强制力，完全依赖 Agent 自觉。
- **根因**：`save_state.py` 的 `apply_delta` 入口无 flag 检查逻辑；`schema.py` 无 `FLAG_SCHEMA` 定义；`state-consistency-checker` 无 flag 文件生成机制。设计文档与代码实现脱节。
- **修复**：(1) `schema.py` 新增 `FLAG_SCHEMA` / `FLAG_FILE_SCHEMA` 定义 + `validate_flags` 函数；(2) `save_state.py` 入口处新增 `_check_flags` / `_load_flags` / `_consume_flags` 三函数，在 `validate_delta` 后 `_apply_op` 前插入 flag 检查；P0 flag `can_bypass=False` 时直接 `raise ValueError` 阻断写入；(3) 成功写入后消费 flag 文件（避免陈旧 flag 误放行后续章节）；(4) `state-consistency-checker/SKILL.md` 第 219-235 行从"建议协议"更新为"已接入，硬性门禁"。
- **涉及文件**：`scripts/novelforge/schema.py`、`scripts/novelforge/save_state.py`、`.trae/skills/state-consistency-checker/SKILL.md`
- **回归测试**：`tests/test_schema_sync.py::test_flag_schema_definition` 断言 FLAG_SCHEMA 定义完整；`tests/test_schema_sync.py::test_save_state_blocks_on_p0_flag` 断言 P0 flag 时 raise；`tests/test_schema_sync.py::test_save_state_allows_p1_flag_with_bypass` 断言 P1 + bypass_reason 时允许写入；`tests/test_schema_sync.py::test_state_consistency_checker_flag_protocol` 断言 SKILL.md 已更新描述
- **教训/沉淀**：检测能力（detection）≠ 强制力（enforcement）。行业方案（Sudowrite/NovelCrafter）都是 reference without enforcement；NovelForge 要做 active enforcement，必须把"建议"落到代码入口的物理阻断。本 bug 是 NovelForge 实现差异化的关键节点。
- **频次**：第 1 次（设计文档与代码脱节的典型）
```

### 7.4 在 check_consistency.py / check_ai_novel.py 中新增的检测规则

**本模块不修改 check_consistency.py 检测规则**（7 类检测已就绪，本模块只消费其输出）。

**可选增强**（不在本模块 DoD 内，作为 M7 的扩展点）：在 `check_consistency.py` 新增 `--emit-flags <path>` 参数，把 `Report.issues` 直接序列化为 flag 文件，省去 state-consistency-checker Skill 自行转换。本模块实现时若工作量允许顺手做，否则由 Skill 解析 JSON 自行写文件。

---

## 八、风险点与回滚方案

### 8.1 风险等级

**高**（修改 save_state.py 入口逻辑，影响所有状态更新）。

### 8.2 风险分析

| 风险 | 影响 | 缓解 |
|---|---|---|
| 修改 `apply_delta` 入口逻辑可能引入回归 | save_state.py 是状态机核心，所有 Skill 调用入口，回归会导致状态写入全面失败 | (a) 新增参数 `skip_flag_check` 默认 False，仅在 dry-run 与单测场景 True；(b) `tests/test_schema_sync.py` 6 个用例覆盖；(c) 跑既有 pytest 全集验证不破坏历史用例 |
| Flag 文件被污染（手工编辑出错） | `validate_flags` 失败时 raise，会阻断所有 save_state | `validate_flags` 报错信息明确（含 flag 索引与具体字段），便于定位；可临时用 `--skip-flag-check` 绕过（仅 dry-run） |
| 无 flag 文件场景的处理 | 历史章节与 shortform 模式可能未跑 check_consistency | 当前选择"warning 不阻断"（兼容历史与 shortform），后续 M7 升级为 strict 模式时再收紧 |
| `check_schema_sync.py` 误报 | Skill markdown 中"pipeline/json"等模式被误识别为字段引用 | 在 `EXPLICIT_FIELD_PATTERN` 中过滤常见词（json/md/py/the/and 等）；过滤 `_comment*` 注释字段 |
| 陈旧 flag 文件污染下一章 | `flags_ch042.json` 残留到 ch_043 时被误读 | `_consume_flags` 在写入成功后删除；flag_id 含 chapter 字段，跨章读不会匹配 |
| 主 Agent 不生成 flag 就调 save_state | 当前 warning 不阻断，状态写入会"漏过"P0 | dev-checklist.md 新增项校验；M7 升级为 strict 模式时改为阻断 |

### 8.3 对核心资产的影响

| 资产 | 影响 | 防护 |
|---|---|---|
| `scripts/novelforge/save_state.py`（状态机核心） | 入口逻辑修改 | 完整回归测试 + `--skip-flag-check` 应急开关 |
| `scripts/novelforge/schema.py`（SSOT） | 新增 FLAG_SCHEMA | 不修改既有 schema 定义，纯增量 |
| `.trae/skills/state-consistency-checker/SKILL.md`（守护 Skill） | flag 协议描述更新 | 仅文档层修改，不影响检测逻辑 |
| `.trae/checklists/dev-checklist.md`（自检清单） | 新增 3 项 | 纯增量 |
| `scripts/novelforge/check_consistency.py` | 不修改本体（可选新增 `--emit-flags` 参数） | 不破坏 7 类检测 |

### 8.4 回滚方案

**分支隔离**：

```bash
git checkout -b feature/schema-sync-gate
# 全部改动在本分支提交
# 验证通过后再合 master
```

**数据备份**：

```bash
# 修改前备份 schema.py / save_state.py / pipeline.json
cp scripts/novelforge/schema.py /tmp/schema.py.bak.$(date +%Y%m%d)
cp scripts/novelforge/save_state.py /tmp/save_state.py.bak.$(date +%Y%m%d)
cp NovelForge_Vault/.state/pipeline.json /tmp/pipeline.json.bak.$(date +%Y%m%d)
```

**Gradual Rollout（推荐）**：

1. **阶段 1（warn 模式，1 周）**：`_check_flags` 中 P0 也只 warning 不 raise，观察 log 中误报率
2. **阶段 2（enforce 模式，正式上线）**：恢复 P0 raise，正式生效
3. **阶段 3（strict 模式，M7 模块）**：无 flag 文件时也阻断（彻底强制）

阶段切换通过环境变量 `NOVELFORGE_FLAG_MODE=warn|enforce|strict` 控制：

```python
import os
FLAG_MODE = os.environ.get("NOVELFORGE_FLAG_MODE", "enforce")

def _check_flags(vault, chapter, skip_flag_check=False):
    if skip_flag_check or FLAG_MODE == "warn":
        # warn 模式：P0 也只 warning
        ...
    # enforce 模式：P0 raise
    ...
```

**紧急回滚**：

```bash
# 1. 切回主分支
git checkout master

# 2. 或 revert 单个 commit
git revert <commit_hash>

# 3. 或临时设环境变量降级为 warn 模式
export NOVELFORGE_FLAG_MODE=warn
```

---

## 九、完成标准（DoD 清单）

- [ ] `PIPELINE_SCHEMA` 含 4 个守护 Skill 字段（已存在，由 `test_pipeline_schema_has_four_guard_fields` 锁定）
- [ ] `FLAG_SCHEMA` 定义完整（7 required + 4 optional 字段，由 `test_flag_schema_definition` 验证）
- [ ] `FLAG_FILE_SCHEMA` 定义完整（chapter + generated_at + flags 数组）
- [ ] `validate_flags` 函数实现（P0 不可豁免 / P1 需 bypass_reason）
- [ ] `save_state.py` 接入 flag 协议（`_check_flags` / `_load_flags` / `_consume_flags` 三函数 + `apply_delta` 入口调用）
- [ ] P0 flag `can_bypass=False` 时 `raise ValueError` 阻断写入（`test_save_state_blocks_on_p0_flag` 通过）
- [ ] P1 flag `can_bypass=True` + `bypass_reason` 时允许写入并 warning（`test_save_state_allows_p1_flag_with_bypass` 通过）
- [ ] 成功写入后消费 flag 文件（避免陈旧 flag 误放行后续章节）
- [ ] CLI 新增 `--skip-flag-check` 参数（仅 dry-run 与单测用）
- [ ] `state-consistency-checker/SKILL.md` 第 219-235 行更新为"已接入，硬性门禁"
- [ ] SKILL.md 工作流第 7 步新增"flag 文件生成"
- [ ] SKILL.md 反模式列表新增"不创建 flag 文件就调 save_state.py"
- [ ] `check_schema_sync.py` 脚本可运行（`test_check_schema_sync_script_runs` 通过）
- [ ] `dev-checklist.md` 新增"schema 同步检查"3 项（PIPELINE_SCHEMA 字段 / FLAG_SCHEMA 一致性 / flag 协议）
- [ ] `tests/test_schema_sync.py` 6 个用例全部通过
- [ ] `bug_regression_list.md` 新增 BUG-051 + BUG-052
- [ ] `pytest -q` 全集通过（不破坏历史用例）
- [ ] `python scripts/novelforge/check_consistency.py --vault NovelForge_Vault` 仍正常（不破坏 7 类检测）
- [ ] `python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault` 仍正常（独立检测不受影响）
- [ ] `docs/loop_log/2026-07.md` 追加一条 #lesson `state_drift` 沉淀（flag 协议从建议到强制的差异化设计）

---

## 附录 A · 关键路径速查

| 文件 | 路径 |
|---|---|
| schema.py | file:///workspace/scripts/novelforge/schema.py |
| save_state.py | file:///workspace/scripts/novelforge/save_state.py |
| check_consistency.py | file:///workspace/scripts/novelforge/check_consistency.py |
| state-consistency-checker SKILL.md | file:///workspace/.trae/skills/state-consistency-checker/SKILL.md |
| dev-checklist.md | file:///workspace/.trae/checklists/dev-checklist.md |
| pipeline.json | file:///workspace/NovelForge_Vault/.state/pipeline.json |
| bug_regression_list.md | file:///workspace/tests/bug_regression_list.md |
| loop_log 2026-07 | file:///workspace/docs/loop_log/2026-07.md |
| check_schema_sync.py（新增） | file:///workspace/scripts/check_schema_sync.py |
| test_schema_sync.py（新增） | file:///workspace/tests/test_schema_sync.py |
| 本方案文档 | file:///workspace/docs/optimization_plan_2026_07/M02_schema_sync_gate.md |

## 附录 B · 验证命令一键运行

```bash
# 1. 单元测试
pytest -q tests/test_schema_sync.py

# 2. schema 同步校验
python scripts/check_schema_sync.py --skills-dir .trae/skills

# 3. 既有校验不破坏
python scripts/novelforge/check_consistency.py --vault NovelForge_Vault
python scripts/novelforge/check_ai_novel.py --vault NovelForge_Vault

# 4. 完整 pytest
pytest -q

# 5. 集成测试（手动构造 P0 flag）
mkdir -p NovelForge_Vault/.state/.lock
cat > NovelForge_Vault/.state/.lock/flags_ch099.json <<'EOF'
{"chapter":"ch_099","generated_at":"2026-07-18T15:00:00","flags":[{"flag_id":"F-ch099-001","severity":"P0","chapter":"ch_099","rule":"power_level_jump","message":"境界跳级","can_bypass":false,"suggestion":"补突破场景","extras":{},"created_at":"2026-07-18T15:00:00"}]}
EOF
echo '{"chapter":"ch_099","ops":[{"op":"set","path":"pipeline/current_chapter","value":99}]}' > /tmp/delta_ch099.json
python -m scripts.novelforge.save_state --delta /tmp/delta_ch099.json --no-commit
# 期望：退出码 1，stderr 含"P0 一致性问题，阻断 save_state"
rm -f NovelForge_Vault/.state/.lock/flags_ch099.json
```

---

**文档版本**：v1.0
**创建日期**：2026-07-18
**作者**：NovelForge M2 模块（schema 同步门禁）
**依赖**：无前置
**下游**：M5 / M6 / M7 / M18
