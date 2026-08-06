/**
 * DreamTale · Markdown 编辑器模块（ES Module）
 *
 * 设计要点：
 * - 三模式切换：source（单栏 textarea）/ split（左右分屏）/ preview（纯预览）
 * - 源码用 textarea 承载（10 万字性能足够，避免 CodeMirror 的 vendor 复杂性）
 * - 分屏 / 预览用 marked.js 实时渲染（依赖 window.marked，由 vendor/marked.min.js 挂载）
 * - 工具栏：加粗 / 斜体 / 标题 / 引用 / 列表 / 链接 / 分隔线，包裹选中文本
 * - 字数实时统计（content.length）
 * - 自动保存：onChange 防抖 1500ms + 失焦立即保存
 * - 快捷键：Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+S 保存
 * - 主题跟随全局：dark / light / sepia
 *
 * 导出：
 *   - createMarkdownEditor(container, options) → MarkdownEditor 实例（工厂函数）
 *   - MarkdownEditor 类（默认导出，便于直接 new）
 *
 * 用法：
 *   import { createMarkdownEditor } from './editor.js';
 *   const editor = createMarkdownEditor(document.getElementById('editor'), {
 *     initialValue: '# 标题',
 *     onChange: (text) => { ... },
 *     onSave: (text) => { ... },
 *     theme: 'light'
 *   });
 */

// ============ 常量 ============
const DEBOUNCE_MS = 1500;        // 自动保存防抖时长
const VALID_MODES = new Set(['source', 'split', 'preview']);
const VALID_THEMES = new Set(['dark', 'light', 'sepia']);

// ============ Markdown 渲染适配层 ============
// 优先使用 vendor/marked.min.js（UMD 挂载到 window.marked）；
// 若加载失败则回退到内置极简渲染器，保证编辑器在任何网络环境下都可用。
function renderMarkdown(md) {
  const lib = (typeof window !== 'undefined' && window.marked) ||
              (typeof globalThis !== 'undefined' && globalThis.marked);
  if (lib && typeof lib.parse === 'function') {
    try {
      return lib.parse(md || '', { gfm: true, breaks: false });
    } catch (err) {
      console.warn('[DreamTale Editor] marked.parse 异常，回退到轻量渲染:', err);
      return simpleMarkdownFallback(md || '');
    }
  }
  return simpleMarkdownFallback(md || '');
}

// 极简 Markdown fallback：仅覆盖标题/段落/列表/引用/粗体斜体/代码块/分隔线/链接
// 仅在 marked.min.js 加载失败时启用，保证编辑器不致完全失能。
function simpleMarkdownFallback(md) {
  const escapeHtml = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let inList = false;

  const flushList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块围栏
    if (/^```/.test(line)) {
      if (inCode) {
        out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // 空行
    if (/^\s*$/.test(line)) { flushList(); continue; }

    // 分隔线
    if (/^(\*\*\*|---|___)\s*$/.test(line)) {
      flushList();
      out.push('<hr>');
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      out.push('<h' + level + '>' + inlineFmt(h[2]) + '</h' + level + '>');
      continue;
    }

    // 引用
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flushList();
      out.push('<blockquote>' + inlineFmt(q[1]) + '</blockquote>');
      continue;
    }

    // 无序列表
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inlineFmt(ul[1]) + '</li>');
      continue;
    }

    // 普通段落
    flushList();
    out.push('<p>' + inlineFmt(line) + '</p>');
  }
  flushList();
  if (inCode) out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
  return out.join('\n');

  function inlineFmt(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }
}

// ============ 工具栏定义 ============
// 每个按钮的 wrap 函数：根据当前选区包裹前缀/后缀
const TOOLBAR_ACTIONS = [
  {
    name: 'bold', label: 'B', title: '加粗 (Ctrl+B)', caret: 'B',
    wrap: (sel) => ({ prefix: '**', suffix: '**', placeholder: '加粗文字' })
  },
  {
    name: 'italic', label: 'I', title: '斜体 (Ctrl+I)', caret: 'I',
    wrap: (sel) => ({ prefix: '*', suffix: '*', placeholder: '斜体文字' })
  },
  {
    name: 'h1', label: 'H1', title: '一级标题', caret: '',
    wrap: (sel) => ({ prefix: '# ', suffix: '', placeholder: '标题' })
  },
  {
    name: 'h2', label: 'H2', title: '二级标题', caret: '',
    wrap: (sel) => ({ prefix: '## ', suffix: '', placeholder: '标题' })
  },
  {
    name: 'quote', label: '“', title: '引用', caret: '',
    wrap: (sel) => ({ prefix: '> ', suffix: '', placeholder: '引用文字' })
  },
  {
    name: 'list', label: '•', title: '无序列表', caret: '',
    wrap: (sel) => ({ prefix: '- ', suffix: '', placeholder: '列表项' })
  },
  {
    name: 'link', label: '🔗', title: '链接', caret: '',
    wrap: (sel) => ({
      prefix: '[',
      suffix: '](https://)',
      placeholder: '链接文字'
    })
  },
  {
    name: 'hr', label: '—', title: '分隔线', caret: '',
    wrap: (sel) => ({ prefix: '\n---\n', suffix: '', placeholder: '' })
  }
];

// ============ MarkdownEditor 类 ============
class MarkdownEditor {
  /**
   * @param {HTMLElement} container 编辑器挂载容器
   * @param {Object} options
   * @param {string} [options.initialValue=''] 初始内容
   * @param {(text:string)=>void} [options.onChange] 内容变更回调（防抖 1500ms）
   * @param {(text:string)=>void} [options.onSave] 保存回调（Ctrl+S 或失焦触发）
   * @param {'dark'|'light'|'sepia'} [options.theme='light'] 主题
   * @param {boolean} [options.plainText=false] 纯文本写作模式（隐藏 Markdown 格式按钮、源码/分屏/预览切换，移除预览区）
   */
  constructor(container, options = {}) {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[DreamTale Editor] container 必须是 HTMLElement');
    }
    this.container = container;
    this.options = options;
    this.value = options.initialValue || '';
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this.onSave = typeof options.onSave === 'function' ? options.onSave : null;
    this.plainText = !!options.plainText;

    // 状态
    this.mode = 'source';   // 默认源码模式（纯文本模式固定 source，忽略切换）
    this.theme = VALID_THEMES.has(options.theme) ? options.theme : 'light';
    this.wordCount = this.value.length;
    this._debounceTimer = null;
    this._lastEmittedValue = this.value;
    this._destroyed = false;

    // 构建 DOM
    this._buildDom();
    this._bindEvents();
    this._applyTheme(this.theme);
    this._applyMode(this.mode);
    this._updateWordCount();
    this._updatePreview();
  }

  // ============ DOM 构建 ============
  _buildDom() {
    const root = document.createElement('div');
    root.className = 'dreamtale-editor' + (this.plainText ? ' de-plain-text' : '');
    root.dataset.theme = this.theme;
    root.dataset.mode = this.mode;

    // 工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'de-toolbar';

    if (!this.plainText) {
      // 工具栏：动作按钮组（仅非纯文本模式显示 Markdown 格式按钮）
      const actions = document.createElement('div');
      actions.className = 'de-toolbar-actions';
      TOOLBAR_ACTIONS.forEach((act) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'de-btn de-btn-' + act.name;
        btn.title = act.title;
        btn.textContent = act.label;
        btn.dataset.action = act.name;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this._applyAction(act);
        });
        actions.appendChild(btn);
      });
      EXTERNAL_HOOKS.extraToolbarButtons.forEach((act) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'de-btn de-btn-' + act.name;
        btn.title = act.title;
        btn.textContent = act.label;
        btn.dataset.action = act.name;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          act.onClick(this);
        });
        actions.appendChild(btn);
      });
      toolbar.appendChild(actions);
    }

    // 工具栏：模式切换 + 字数
    const right = document.createElement('div');
    right.className = 'de-toolbar-right';

    if (!this.plainText) {
      // 仅非纯文本模式显示 源码/分屏/预览 三切换
      const modeGroup = document.createElement('div');
      modeGroup.className = 'de-mode-group';
      modeGroup.setAttribute('role', 'tablist');
      modeGroup.setAttribute('aria-label', '编辑器视图模式');
      [
        { mode: 'source', label: '源码' },
        { mode: 'split', label: '分屏' },
        { mode: 'preview', label: '预览' }
      ].forEach((m) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'de-mode-btn' + (m.mode === this.mode ? ' active' : '');
        btn.dataset.mode = m.mode;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', m.mode === this.mode ? 'true' : 'false');
        btn.textContent = m.label;
        btn.addEventListener('click', () => this.setMode(m.mode));
        modeGroup.appendChild(btn);
      });
      right.appendChild(modeGroup);
    }

    // 字数统计
    const counter = document.createElement('span');
    counter.className = 'de-counter';
    counter.title = '字数统计';
    counter.textContent = '0 字';
    right.appendChild(counter);
    this._counterEl = counter;

    // 保存指示（含状态图标：保存中脉冲点 / 已保存对勾）
    const saveFlag = document.createElement('span');
    saveFlag.className = 'de-save-flag';
    saveFlag.setAttribute('aria-live', 'polite');
    saveFlag.innerHTML =
      '<span class="de-save-icon" aria-hidden="true"></span>' +
      '<span class="de-save-text"></span>';
    right.appendChild(saveFlag);
    this._saveFlagEl = saveFlag;
    this._saveFlagIconEl = saveFlag.querySelector('.de-save-icon');
    this._saveFlagTextEl = saveFlag.querySelector('.de-save-text');

    toolbar.appendChild(right);
    root.appendChild(toolbar);

    // 编辑区主体
    const body = document.createElement('div');
    body.className = 'de-body';

    // 源码 textarea
    const textareaWrap = document.createElement('div');
    textareaWrap.className = 'de-pane de-pane-source';
    const textarea = document.createElement('textarea');
    textarea.className = 'de-textarea';
    textarea.value = this.value;
    textarea.placeholder = this.plainText ? '在此输入正文…' : '在此输入 Markdown 正文…';
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', this.plainText ? '正文编辑区' : 'Markdown 源码编辑区');
    // 纯文本模式：移除默认 monospace 字体暗示（用正文字体）
    if (this.plainText) {
      textarea.style.fontFamily = 'inherit';
      textarea.style.lineHeight = '1.8';
      textarea.style.fontSize = '16px';
    }
    textareaWrap.appendChild(textarea);
    body.appendChild(textareaWrap);
    this._textarea = textarea;
    this._textareaWrap = textareaWrap;

    if (!this.plainText) {
      // 分隔条（split 模式可见，仅非纯文本模式）
      const divider = document.createElement('div');
      divider.className = 'de-divider';
      divider.setAttribute('aria-hidden', 'true');
      body.appendChild(divider);
      this._dividerEl = divider;

      // 预览区（仅非纯文本模式）
      const previewWrap = document.createElement('div');
      previewWrap.className = 'de-pane de-pane-preview';
      previewWrap.setAttribute('aria-label', 'Markdown 预览区');
      const preview = document.createElement('div');
      preview.className = 'de-preview markdown-body';
      previewWrap.appendChild(preview);
      body.appendChild(previewWrap);
      this._previewEl = preview;
      this._previewWrap = previewWrap;
    }

    root.appendChild(body);

    // 清空容器并挂载
    this.container.innerHTML = '';
    this.container.appendChild(root);
    this._rootEl = root;
  }

  // ============ 事件绑定 ============
  _bindEvents() {
    // 输入：防抖触发 onChange + 即时更新字数与预览 + 写作聚焦淡入工具栏
    this._onInput = () => {
      this.value = this._textarea.value;
      this._updateWordCount();
      this._updatePreview();
      this._scheduleEmitChange();
      this._monitorAtQuery();
      // 写作聚焦：连续输入时淡出工具栏（减少干扰），停下后恢复
      if (this._rootEl) this._rootEl.classList.add('writing-focus');
      clearTimeout(this._focusTimer);
      this._focusTimer = setTimeout(() => {
        if (this._rootEl) this._rootEl.classList.remove('writing-focus');
      }, 900);
    };
    this._textarea.addEventListener('input', this._onInput);

    // 失焦：立即触发保存与 onChange + 清除写作聚焦
    this._onBlur = () => {
      this._flushChange();
      this._emitSave();
      clearTimeout(this._focusTimer);
      if (this._rootEl) this._rootEl.classList.remove('writing-focus');
    };
    this._textarea.addEventListener('blur', this._onBlur);

    // 聚焦时快速恢复工具栏（便于操作按钮）
    this._onFocus = () => {
      if (this._rootEl) this._rootEl.classList.remove('writing-focus');
    };
    this._textarea.addEventListener('focus', this._onFocus);

    // 快捷键
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._textarea.addEventListener('keydown', this._onKeyDown);
  }

  _handleKeyDown(e) {
    // Ctrl+B 加粗
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      const act = TOOLBAR_ACTIONS.find((a) => a.name === 'bold');
      this._applyAction(act);
      return;
    }
    // Ctrl+I 斜体
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      const act = TOOLBAR_ACTIONS.find((a) => a.name === 'italic');
      this._applyAction(act);
      return;
    }
    // Ctrl+S 保存
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      this._flushChange();
      this._emitSave();
      return;
    }
    // Tab 缩进：插入两个空格
    if (e.key === 'Tab') {
      e.preventDefault();
      this._insertAtCursor('  ', '');
    }
    // @提及监测
    if (e.key === '@' && EXTERNAL_HOOKS.atMention) {
      setTimeout(() => {
        EXTERNAL_HOOKS.atMention.show({ el: this._textarea, query: '', editor: this });
      }, 50);
    }
  }

  // ============ 工具栏动作 ============
  _applyAction(act) {
    if (!act) return;
    // split / preview 模式下，工具栏动作只在 source 可见时生效；
    // 但允许在 split 模式操作（textarea 仍可聚焦），preview 模式禁止
    if (this.mode === 'preview') return;

    const { prefix, suffix, placeholder } = act.wrap(this._getSelectionText());
    this._insertAtCursor(prefix, suffix, placeholder);
    this._textarea.focus();
    this.value = this._textarea.value;
    this._updateWordCount();
    this._updatePreview();
    this._scheduleEmitChange();
  }

  // 在光标处插入 / 包裹选中文本
  _insertAtCursor(prefix, suffix, placeholder = '') {
    const ta = this._textarea;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const sel = ta.value.slice(start, end);
    const after = ta.value.slice(end);

    const fillText = sel.length > 0 ? sel : (placeholder || '');
    const inserted = prefix + fillText + suffix;
    ta.value = before + inserted + after;

    // 调整选区：选中插入的占位文字（便于直接替换）
    const selStart = start + prefix.length;
    const selEnd = selStart + fillText.length;
    ta.focus();
    ta.setSelectionRange(selStart, selEnd);

    // 触发 input 以同步状态
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _getSelectionText() {
    return this._textarea.value.slice(
      this._textarea.selectionStart,
      this._textarea.selectionEnd
    );
  }

  // ============ @提及查询监测 ============
  _monitorAtQuery() {
    if (!EXTERNAL_HOOKS.atMention) return;
    const ta = this._textarea;
    const caret = ta.selectionStart;
    const textBefore = ta.value.slice(0, caret);
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) {
      EXTERNAL_HOOKS.atMention.hide && EXTERNAL_HOOKS.atMention.hide();
      return;
    }
    const between = textBefore.slice(atIndex + 1);
    if (/\s/.test(between)) {
      EXTERNAL_HOOKS.atMention.hide && EXTERNAL_HOOKS.atMention.hide();
      return;
    }
    EXTERNAL_HOOKS.atMention.show({ el: ta, query: between, editor: this });
  }

  // ============ 外部插入文本（替换 @查询） ============
  insertAtText(inserted, rangeLen) {
    const ta = this._textarea;
    const caret = ta.selectionStart;
    const start = caret - rangeLen;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(caret);
    ta.value = before + inserted + after;
    const newCaret = start + inserted.length;
    ta.focus();
    ta.setSelectionRange(newCaret, newCaret);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ============ 字数统计 ============
  _updateWordCount() {
    this.wordCount = this.value.length;
    if (this._counterEl) {
      this._counterEl.textContent = this.wordCount + ' 字';
    }
  }

  // ============ 预览渲染 ============
  _updatePreview() {
    if (!this._previewEl) return;
    // 仅在 split / preview 模式下渲染（节省性能）
    if (this.mode === 'source') return;
    const html = renderMarkdown(this.value);
    this._previewEl.innerHTML = html;
  }

  // ============ onChange 防抖 ============
  _scheduleEmitChange() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flushChange(), DEBOUNCE_MS);
  }

  _flushChange() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this.onChange && this.value !== this._lastEmittedValue) {
      this._lastEmittedValue = this.value;
      try {
        this.onChange(this.value);
      } catch (err) {
        console.error('[DreamTale Editor] onChange 回调异常:', err);
      }
    }
  }

  _emitSave() {
    if (!this.onSave) return;
    // 先显示"保存中"脉冲，回调结束后显示"已保存"微弹
    this._setSaveState('saving', '保存中…');
    try {
      const result = this.onSave(this.value);
      // 支持回调返回 Promise
      Promise.resolve(result)
        .then(()  => this._setSaveState('saved', '已保存'))
        .catch(() => this._setSaveState('error', '保存失败'));
    } catch (err) {
      console.error('[DreamTale Editor] onSave 回调异常:', err);
      this._setSaveState('error', '保存失败');
    }
  }

  /**
   * 设置保存状态视觉反馈
   * @param {'saving'|'saved'|'error'|''} state
   * @param {string} text 文本提示
   */
  _setSaveState(state, text = '') {
    const el = this._saveFlagEl;
    if (!el) return;
    // 先清理旧状态类
    el.classList.remove('saving', 'saved', 'error');
    this._saveFlagIconEl.className = 'de-save-icon';
    this._saveFlagTextEl.textContent = text;

    if (state === 'saving') {
      el.classList.add('saving', 'visible');
      this._saveFlagIconEl.classList.add('de-save-dot');
    } else if (state === 'saved') {
      el.classList.add('saved', 'visible');
      this._saveFlagIconEl.classList.add('de-save-check');
      this._saveFlagIconEl.textContent = '✓';
      // 1.8s 后淡出
      clearTimeout(this._saveFlagTimer);
      this._saveFlagTimer = setTimeout(() => {
        el.classList.remove('visible', 'saved');
        this._saveFlagIconEl.textContent = '';
        this._saveFlagTextEl.textContent = '';
      }, 1800);
    } else if (state === 'error') {
      el.classList.add('error', 'visible');
      this._saveFlagIconEl.classList.add('de-save-check');
      this._saveFlagIconEl.textContent = '!';
      clearTimeout(this._saveFlagTimer);
      this._saveFlagTimer = setTimeout(() => {
        el.classList.remove('visible', 'error');
        this._saveFlagIconEl.textContent = '';
        this._saveFlagTextEl.textContent = '';
      }, 3000);
    } else {
      el.classList.remove('visible');
    }
  }

  // 兼容旧方法名（避免外部调用断裂）
  _flashSaveFlag(text) {
    this._setSaveState('saved', text || '已保存');
  }

  // ============ 模式切换 ============
  _applyMode(mode) {
    // 纯文本模式：永远强制 source 模式，隐藏预览/分屏逻辑
    if (this.plainText) mode = 'source';
    if (!VALID_MODES.has(mode)) return;
    this.mode = mode;
    if (this._rootEl) this._rootEl.dataset.mode = mode;

    // 同步工具栏模式按钮
    if (this._rootEl) {
      this._rootEl.querySelectorAll('.de-mode-btn').forEach((btn) => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    // 分栏可见性（纯文本模式没有预览/分隔条，跳过）
    if (!this.plainText) {
      if (this._textareaWrap) this._textareaWrap.classList.toggle('hidden', mode === 'preview');
      if (this._previewWrap) this._previewWrap.classList.toggle('hidden', mode === 'source');
      if (this._dividerEl) this._dividerEl.classList.toggle('hidden', mode !== 'split');

      // preview 模式下渲染最新内容
      if (mode === 'preview' || mode === 'split') {
        this._updatePreview();
      }
    }

    // 工具栏在 preview 模式下整体禁用（动作按钮）
    if (this._rootEl) {
      this._rootEl.querySelectorAll('.de-btn').forEach((btn) => {
        btn.disabled = (mode === 'preview');
      });
    }
  }

  setMode(mode) {
    // 纯文本模式：忽略任何切换请求
    if (this.plainText) return;
    if (!VALID_MODES.has(mode)) {
      console.warn('[DreamTale Editor] 无效的模式:', mode);
      return;
    }
    this._applyMode(mode);
  }

  getMode() {
    return this.mode;
  }

  // ============ 主题切换 ============
  _applyTheme(theme) {
    if (!VALID_THEMES.has(theme)) return;
    this.theme = theme;
    if (this._rootEl) this._rootEl.dataset.theme = theme;
  }

  setTheme(theme) {
    if (!VALID_THEMES.has(theme)) {
      console.warn('[DreamTale Editor] 无效的主题:', theme);
      return;
    }
    this._applyTheme(theme);
  }

  // ============ 取值 / 赋值 ============
  getValue() {
    return this.value;
  }

  setValue(text) {
    text = String(text || '');
    this.value = text;
    if (this._textarea) this._textarea.value = text;
    this._updateWordCount();
    this._updatePreview();
    this._lastEmittedValue = text;  // 避免外部赋值触发 onChange
  }

  getWordCount() {
    return this.wordCount;
  }

  // ============ 销毁 ============
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    // 清理定时器
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._saveFlagTimer) {
      clearTimeout(this._saveFlagTimer);
      this._saveFlagTimer = null;
    }

    // 移除事件监听（textarea 已随 root 一并从 DOM 移除，无需手动 removeEventListener）
    if (this._rootEl && this._rootEl.parentNode) {
      this._rootEl.parentNode.removeChild(this._rootEl);
    }
    this._rootEl = null;
    this._textarea = null;
    this._textareaWrap = null;
    this._previewEl = null;
    this._previewWrap = null;
    this._dividerEl = null;
    this._counterEl = null;
    this._saveFlagEl = null;
    this.container = null;
    this.onChange = null;
    this.onSave = null;
  }
}

// ============ 外部插件钩子（供 writing-station 挂载） ============
const EXTERNAL_HOOKS = {
  // @提及：输入 @ 时触发，返回 {show(popoverEl, position), hide(), onSelect(cb)}
  atMention: null,
  // 工具栏扩展按钮：Array<{name, label, title, onClick(editorInstance)}>
  extraToolbarButtons: [],
  // 内容变更回调（防抖后触发，含增量 diff）
  onContentProcessed: null,
};
export function registerHook(name, value) {
  if (name === 'extraToolbarButtons' && Array.isArray(value)) {
    EXTERNAL_HOOKS.extraToolbarButtons.push(...value);
  } else {
    EXTERNAL_HOOKS[name] = value;
  }
}
export function getHooks() { return EXTERNAL_HOOKS; }

// ============ 工厂函数 ============
/**
 * 创建 MarkdownEditor 实例
 * @param {HTMLElement} container
 * @param {Object} options 见构造函数
 * @returns {MarkdownEditor}
 */
export function createMarkdownEditor(container, options) {
  return new MarkdownEditor(container, options);
}

// 默认导出类，便于 `import MarkdownEditor from './editor.js'`
export default MarkdownEditor;
