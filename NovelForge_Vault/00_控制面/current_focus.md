# 当前焦点（current_focus）

> 本文件是「写作当下的瞄准镜」，每次 writer / polisher 执行前必须读取。
> 由 architect Skill 在生成章纲时刷新，writer 完稿后由 state_update 落地最新值。
> 与 `author_intent.md` 的区别：意图是「长期」，焦点是「本章/本卷」。

---

## 一、当前位置

- **模式**：novel / shortform（二选一）
- **当前卷号**：vol_NN
- **当前章号**：ch_NNN
- **章标题**：（如已定）____
- **章节类型**：regular / vol_start / hook_resolve / climax / transition

## 二、本章核心冲突

> 一句话讲清本章主线张力，例如「主角识破师弟的偷袭计划但苦于没有证据」。

____

## 三、must-keep（必带元素）

> 本章必须出现的元素，少一项即视为跑题。每条尽量可校验。

- [ ] ____
- [ ] ____
- [ ] ____

## 四、must-avoid（禁忌）

> 本章必须避免的反模式。写完用 polisher 自检。

- [ ] ____
- [ ] ____
- [ ] ____

## 五、retrieve_scenes（关键场景召回清单）

> 列出本章需要召回的 `_scenes/` 文件名，由 context_composer 拼装进提示词。
> 命名规范：`ch_NNN_角色_关键词.md`，例如 `ch_007_主角_识破师弟.md`。

- [ ] `ch_00N_角色_关键词.md`
- [ ] `ch_00N_角色_关键词.md`

## 六、need_full_intent

- **need_full_intent**：false
- **触发条件说明**：当本章为「卷首 / 主线转折 / 伏笔回收」时置为 `true`，context_composer 会把 `author_intent.md` 的 L2 全文一并注入；否则只注入 L0 摘要。
- **本次置 true 理由**：（若为 true 必填）____

## 七、节奏预算

- **本章预期字数**：____（参考 `.state/chapter_length_history.json` 均值 ± 10%）
- **本章爽点等级**：1-5（5 = 章末高潮）
- **本章压抑等级**：1-5（5 = 极致低谷）
- **本章前后节奏**：前爽后抑 / 前抑后爽 / 平推 / 蓄势

## 八、伏笔联动

- **本章埋设**：H-0NN（描述一句话）
- **本章回收**：H-0NN（来自第 N 章）
- **本章提示**：H-0NN（再次提醒读者这条线还活着）
