# 计划评审报告：古籍阅读器三个阅读增强功能

评审日期：2026-06-23
评审方式：三视角并行评审（Task 工具启动 3 个专家子代理，因 LLM_API_KEY 未配置未走 LangGraph 路径）
方案文件：`.cache/plan_to_review.md`

## 架构师评审

### 总体评价
有保留通过

### 详细意见
- 可行性：三个功能纯原生 JS+CSS 可实现，无不可逾越障碍。壁纸用 CSS 渐变 + 内联 SVG data URI 无外部图片依赖，合理。
- 依赖：不引入新依赖，复用现有 marked.js、IIFE 结构、CSS 变量体系、localStorage 持久化模式。
- 与现有架构一致性：基本一致。`data-wallpaper` 放 body 上与现有 `data-theme`/`data-font` 一致。翻页模式建议用 `body[data-page-mode="tap|scroll"]`。
- 模块化：新增函数都在 IIFE 内，无全局污染。建议按现有注释分区风格新增三个分区。
- 扩展性：壁纸预设用 CSS 变量切换，新增预设只需加规则；翻页模式用枚举可扩展。

### 风险点
- `.reader::before` 在 `overflow:auto` 容器中是视口固定（不随内容滚动），符合"背景固定"预期，需 iOS 实测硬件加速层影响
- 桌面端启用点击翻页会破坏现有桌面阅读体验（点击正文非链接即翻页）
- 行高取值若取 `.reader` 的 line-height 会返回 normal/继承值，导致 dy 计算错误
- rAF `deltaTime` 未 clamp，页面切后台再回来首帧可能瞬移
- touch/click 双触发防范若依赖 `preventDefault` 会阻止子元素（链接）click
- ModelScope iframe 中 `touchmove preventDefault` 与"让原生滚动"逻辑矛盾
- 自动阅读浮动按钮与移动端 `.bottom-bar` 会重叠

### 建议
- 桌面端 tap 模式仅保留中央点击切换 UI（沿用 `innerWidth > 768`），左右翻页限定移动端；桌面端用 ArrowUp/ArrowDown 键翻页
- 行高取 `elements.reader.querySelector('.markdown-body')` 的计算 line-height（像素值）
- rAF deltaTime clamp：`Math.min(timestamp - lastTimestamp, 100)`
- touch/click 防抖用模块级变量 `tapHandled`，不依赖 preventDefault
- `data-wallpaper` 放 body，翻页模式用 `body[data-page-mode]`
- 自动阅读浮动按钮 `position:fixed`，移动端避让 bottom-bar，`body.ui-hidden` 时隐藏，`body[data-view="home"]` 时隐藏
- `prefers-reduced-motion` 也应让 tap 翻页的 smooth 降级为 auto
- 在 `loadNote` 函数体最开头调用 `pauseAutoScroll()`
- 新增 HTML 元素需在 `elements` 对象注册

---

## 测试评审

### 总体评价
需修改

### 详细意见
- 可验证性：三功能在 jsdom 下可部分验证，视觉层需 Playwright。方案验收标准未对应到具体测试用例。
- 测试覆盖：方案完全未提及新增测试文件或用例，是最大缺口。
- 边界场景：遗漏空内容、超长内容、首章/末章、`pageMode='scroll'` 下点击不翻页、滑块边界等。
- Mock 模式：jsdom 缺 `requestAnimationFrame`/`TouchEvent`/`matchMedia` polyfill，需在测试入口注入。
- 回归风险：高。`tests/test_web_reader.py` 路径与断言与 `site/` 现状不符（引用 `src/web/...`、`#fullscreenBtn`、`.reader-tap-zones` 等不存在元素），基线状态存疑。

### 风险点
- `tests/test_web_reader.py` 路径与断言均与 `site/` 现状不符，基线状态存疑
- `handleReaderTap` 替换后若未排除 `.book-card/.tree-leaf/.chapter-btn/.search-result-title`，会误拦截现有 e2e 点击流
- jsdom 不支持 rAF/TouchEvent/CSS 变量真实计算
- 自动阅读 rAF 若未在 `loadNote`/切章/`openSettings` 中取消，会泄漏到书架视图
- 夜间壁纸覆盖机制（CSS 还是 JS）未明确

### 建议
- 先跑 `pytest tests/test_web_reader.py` 和 `node tests/site_e2e_test.js` 确认基线
- 新增 `tests/test_reader_features.js`（jsdom）覆盖壁纸/翻页/自动阅读
- 翻页测试：stub `clientHeight`，spy `scrollBy`，按 clientX 分区断言
- 自动阅读测试：注入 fake rAF + fake timer，断言 scrollBy 调用次数和 dy
- touch/click 双触发测试：dispatch touchstart→touchend→click，断言 handleReaderTap 只调用一次
- localStorage 持久化测试：设置后新建 JSDOM 实例模拟刷新，断言恢复

---

## 规则评审

### 总体评价
有保留通过

### 详细意见
- 符合 dev-workflow.md：基本符合，但缺少显式「风险点」字段
- 符合 rules.md：完全符合，不触及讲书笔记写作规则
- 未破坏现有体系：完全符合，改动仅限 `site/` 三文件
- Skill 边界：符合，未涉及 Skill
- 目录规范：符合，沿用现有 `data-*` 命名模式和扁平 key 风格
- 是否过度工程化：基本合理，保留点是三功能合并交付 blast radius 较大

### 风险点
- 计划缺少 dev-workflow.md 第二步模板要求的显式「风险点」字段
- 功能2 是破坏性改动（tap 分区 35%~65% → 25%/50%/25%），建议拆为三个独立提交
- 需补测试用例，与 dev-checklist.md §三"新功能有对应的单元测试"存在潜在冲突
- `prefers-reduced-motion` 下降速策略二选一未定

### 建议
- 补「风险点」字段
- 三个功能拆为三个独立提交，便于单独回滚
- 明确测试策略：各补 1~2 个 e2e 用例
- README 追加功能说明
- `docs/` 补设计决策记录
- 明确 `prefers-reduced-motion` 行为：降速到 24 行/分钟并保留可用，不弹提示
- config.yaml / .env.example 无需更新

---

## 汇总结论与采纳决策

### 总体结论
方案经三视角评审后**有条件通过**。测试视角提出「需修改」主要因测试覆盖缺口和基线状态存疑，需在实现时补齐。

### 采纳的关键修改（实现时执行）
1. **桌面端翻页**：tap 模式下桌面端（innerWidth>768）仅保留中央点击切换 UI，左右翻页限定移动端；桌面端用 ArrowUp/ArrowDown 键翻页
2. **行高取值**：取 `.markdown-body` 的计算 line-height（像素值）
3. **rAF deltaTime clamp**：`Math.min(dt, 100)`
4. **touch/click 防抖**：模块级 `tapHandled` 变量，不依赖 preventDefault
5. **data-wallpaper 放 body**：与 data-theme 一致；夜间用 CSS 覆盖 `--reader-wallpaper`
6. **翻页模式**：`body[data-page-mode="tap|scroll"]`
7. **自动阅读按钮**：fixed 定位，移动端避让 bottom-bar，ui-hidden/home 时隐藏
8. **prefers-reduced-motion**：tap 翻页 smooth→auto，自动阅读降速到 24 行/分钟，不弹提示
9. **loadNote 开头暂停自动阅读**
10. **handleReaderTap 排除**：a/button/input/textarea/select + .book-card/.tree-leaf/.chapter-btn/.search-result-title + 弹层打开 + selection 非空
11. **applySettings 异常回退**：DEFAULT_SETTINGS 必须含所有新字段
12. **先确认 tests/test_web_reader.py 基线**
13. **补测试用例**：新增 tests/test_reader_features.js
14. **三个功能分步实现**，最终统一测试后合并
