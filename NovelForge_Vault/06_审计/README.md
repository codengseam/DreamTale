# 审计报告目录（06_审计）

> 本目录存放 NovelForge 守护 Skill 产出的审计报告，**报告由对应 Skill 自动生成，不需要手动编辑**。
> 作用：让主 Agent 在后续章节生成时回看历史审计结论，避免同类漂移/伏笔遗漏/状态不一致反复出现。

---

## 一、目录作用

本目录归档以下三类守护 Skill 的产出：

- **drift-detector**：每 10 章 / 每卷末跑一次，检测剧情走向、人设、节奏是否偏离大纲与设定。
- **hook-auditor**：伏笔审计，扫描已埋设伏笔的状态与回收进度。
- **state-consistency-checker**：一致性检查，校验 `.state/*.json` 与正文实际内容是否吻合。

---

## 二、报告文件清单

| 文件命名 | 产出 Skill | 触发时机 |
|---|---|---|
| `drift_report_chXXX-YYY.md` | drift-detector | 每 10 章 / 每卷末 |
| `hooks_report.md` | hook-auditor | 伏笔审计周期 |
| `consistency_report_chNNN.md` | state-consistency-checker | 按章触发 |

> 报告命名规则：`drift_report_chXXX-YYY.md` 中 `XXX-YYY` 为审计覆盖的章号区间；`consistency_report_chNNN.md` 中 `NNN` 为被审计的章号。

---

## 三、维护纪律

1. 报告由对应 Skill 在审计完成后自动写入本目录，**禁止手动新建或编辑**。
2. 报告产出后只读不删，作为后续章节生成的回看依据。
3. 主 Agent 在生成新章前可读取最近一份相关报告，作为上下文参考。
