/**
 * DreamTale · 沉浸式阅读器模块（ES Module）
 *
 * fork 自 HaloRead 的阅读器设计，简化为 DreamTale 章节阅读专用。
 *
 * 功能：
 * - 侧边栏目录导航（按卷分组，章节树可折叠）
 * - 字体切换：字号 14/16/18/20px、行间距 1.6/1.8/2.0、字族 serif/sans/mono
 * - 背景色切换：亮色 / 护眼米黄 / 暗色 三主题
 * - 沉浸模式：隐藏侧边栏 + 顶栏，全屏阅读（Fullscreen API 失败回退纯 CSS 沉浸）
 * - 自动滚动：可调速度（行/分钟），RAF 循环 + 亚像素累积，到章节末尾暂停
 * - 阅读进度条：底部显示当前章节滚动进度
 * - 章节间导航：上一章 / 下一章按钮（同时支持键盘 ← →）
 * - Markdown 渲染：用 marked.js（vendor/marked.min.js），加载失败回退到极简渲染器
 *
 * Chapter 数据结构（setChapters 接收数组）：
 *   {
 *     vol_no:   number,   // 卷号，如 1
 *     vol_title:string,   // 卷名，如 '第一卷 · 启程'（用于侧边栏分组标题）
 *     ch_no:    number,   // 章号，如 1
 *     title:    string,   // 章节标题
 *     content:  string    // Markdown 正文
 *   }
 *
 * 导出：
 *   - createReader(container, options) → Reader 实例
 *   - Reader 类（默认导出）
 *
 * 用法：
 *   import { createReader } from './reader.js';
 *   const reader = createReader(document.getElementById('reader'), {
 *     chapters: [...],
 *     initialChapter: { vol_no: 1, ch_no: 1 },
 *     onNavigate: (chapter) => { ... },
 *     theme: 'light'
 *   });
 */

// ============ 常量 ============
const VALID_THEMES = new Set(['dark', 'light', 'sepia']);
const VALID_FONT_SIZES = new Set([14, 16, 18, 20]);
const VALID_LINE_HEIGHTS = new Set([1.6, 1.8, 2.0]);
const VALID_FONT_FAMILIES = new Set(['serif', 'sans', 'mono']);
const VALID_AUTO_SPEEDS = [24, 36, 50, 70, 100];  // 行/分钟，对应档位

// 字体栈（与 HaloRead 一致的系统字体优先策略，移除 Google Fonts 依赖）
const FONT_STACKS = {
  serif: '"Songti SC", "STSong", "SimSun", "Source Han Serif SC", "Noto Serif SC", Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  mono: '"SF Mono", "JetBrains Mono", Menlo, Consolas, "Source Code Pro", monospace'
};

// 三主题配色（与 reader.css 的 [data-theme] 变量保持一致）
const THEME_META = {
  light: { label: '亮色', icon: '☀' },
  sepia: { label: '护眼', icon: '📑' },
  dark:  { label: '暗色', icon: '🌙' }
};

// ============ Markdown 渲染适配层 ============
// 与 editor.js 共用同一思路：优先 window.marked，失败回退极简渲染
function renderMarkdown(md) {
  const lib = (typeof window !== 'undefined' && window.marked) ||
              (typeof globalThis !== 'undefined' && globalThis.marked);
  if (lib && typeof lib.parse === 'function') {
    try {
      return lib.parse(md || '', { gfm: true, breaks: false });
    } catch (err) {
      console.warn('[DreamTale Reader] marked.parse 异常，回退到轻量渲染:', err);
      return simpleMarkdownFallback(md || '');
    }
  }
  return simpleMarkdownFallback(md || '');
}

// 极简 fallback（与 editor.js 同款实现，保持模块自洽）
function simpleMarkdownFallback(md) {
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inCode = false, codeBuf = [], inList = false;
  const flushList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      if (inCode) { out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'); codeBuf = []; inCode = false; }
      else { flushList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\s*$/.test(line)) { flushList(); continue; }
    if (/^(\*\*\*|---|___)\s*$/.test(line)) { flushList(); out.push('<hr>'); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushList(); const lv = h[1].length; out.push('<h' + lv + '>' + inlineFmt(h[2]) + '</h' + lv + '>'); continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushList(); out.push('<blockquote>' + inlineFmt(q[1]) + '</blockquote>'); continue; }
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + inlineFmt(ul[1]) + '</li>'); continue; }
    flushList(); out.push('<p>' + inlineFmt(line) + '</p>');
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

// ============ Reader 类 ============
class Reader {
  /**
   * @param {HTMLElement} container 阅读器挂载容器
   * @param {Object} options
   * @param {Array<Chapter>} [options.chapters=[]] 章节数组
   * @param {{vol_no:number,ch_no:number}} [options.initialChapter] 初始章节
   * @param {(chapter:Chapter)=>void} [options.onNavigate] 章节切换回调
   * @param {'dark'|'light'|'sepia'} [options.theme='light'] 主题
   */
  constructor(container, options = {}) {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[DreamTale Reader] container 必须是 HTMLElement');
    }
    this.container = container;
    this.options = options;
    this.onNavigate = typeof options.onNavigate === 'function' ? options.onNavigate : null;

    // 状态
    this.chapters = Array.isArray(options.chapters) ? options.chapters.slice() : [];
    this.currentIdx = -1;     // 当前章节在 chapters 中的索引
    this.theme = VALID_THEMES.has(options.theme) ? options.theme : 'light';
    this.fontSize = 18;
    this.lineHeight = 1.8;
    this.fontFamily = 'serif';
    this.autoSpeed = 50;       // 行/分钟
    this._autoRafId = null;
    this._autoLastTs = 0;
    this._autoPxAccumulator = 0;
    this._immersive = false;
    this._destroyed = false;
    this._sidebarOpenMobile = false;

    // 构建 DOM
    this._buildDom();
    this._bindEvents();
    this._applyTheme(this.theme);
    this._applyFontAll();

    // 渲染目录
    this._renderTree();

    // 定位初始章节
    if (this.chapters.length > 0) {
      const init = options.initialChapter;
      if (init) {
        this.setCurrentChapter(init.vol_no, init.ch_no);
      } else {
        this._gotoIndex(0);
      }
    }
  }

  // ============ DOM 构建 ============
  _buildDom() {
    const root = document.createElement('div');
    root.className = 'dreamtale-reader';
    root.dataset.theme = this.theme;
    root.dataset.fontFamily = this.fontFamily;
    root.dataset.fontSize = String(this.fontSize);
    root.dataset.lineHeight = String(this.lineHeight);

    // ───── 顶栏 ─────
    const toolbar = document.createElement('header');
    toolbar.className = 'dr-toolbar';

    const toolbarLeft = document.createElement('div');
    toolbarLeft.className = 'dr-toolbar-left';
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'dr-icon-btn dr-menu-btn';
    menuBtn.setAttribute('aria-label', '切换目录');
    menuBtn.innerHTML = '<span class="dr-icon">☰</span>';
    menuBtn.addEventListener('click', () => this._toggleSidebar());
    toolbarLeft.appendChild(menuBtn);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'dr-toolbar-title';
    const bookTitle = document.createElement('span');
    bookTitle.className = 'dr-book-title';
    bookTitle.textContent = 'DreamTale';
    const chapterTitle = document.createElement('span');
    chapterTitle.className = 'dr-chapter-title';
    chapterTitle.textContent = '—';
    titleWrap.appendChild(bookTitle);
    titleWrap.appendChild(chapterTitle);
    toolbarLeft.appendChild(titleWrap);
    toolbar.appendChild(toolbarLeft);
    this._chapterTitleEl = chapterTitle;

    const toolbarRight = document.createElement('div');
    toolbarRight.className = 'dr-toolbar-right';

    // 字号下拉
    const fontBtn = document.createElement('button');
    fontBtn.type = 'button';
    fontBtn.className = 'dr-icon-btn';
    fontBtn.setAttribute('aria-label', '字体设置');
    fontBtn.innerHTML = '<span class="dr-icon">Aa</span>';
    fontBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleFontPanel();
    });
    toolbarRight.appendChild(fontBtn);
    this._fontBtn = fontBtn;

    // 主题切换按钮
    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'dr-icon-btn dr-theme-btn';
    themeBtn.setAttribute('aria-label', '切换主题');
    themeBtn.innerHTML = '<span class="dr-icon">' + THEME_META[this.theme].icon + '</span>';
    themeBtn.addEventListener('click', () => this._cycleTheme());
    toolbarRight.appendChild(themeBtn);
    this._themeBtn = themeBtn;

    // 自动滚动
    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'dr-icon-btn dr-auto-btn';
    autoBtn.setAttribute('aria-label', '自动滚动');
    autoBtn.innerHTML = '<span class="dr-icon">▶</span>';
    autoBtn.addEventListener('click', () => this._toggleAutoScroll());
    toolbarRight.appendChild(autoBtn);
    this._autoBtn = autoBtn;

    // 沉浸
    const immerseBtn = document.createElement('button');
    immerseBtn.type = 'button';
    immerseBtn.className = 'dr-icon-btn dr-immerse-btn';
    immerseBtn.setAttribute('aria-label', '沉浸阅读');
    immerseBtn.innerHTML = '<span class="dr-icon">⛶</span>';
    immerseBtn.addEventListener('click', () => this._toggleImmersive());
    toolbarRight.appendChild(immerseBtn);
    this._immerseBtn = immerseBtn;

    toolbar.appendChild(toolbarRight);
    root.appendChild(toolbar);
    this._toolbar = toolbar;

    // ───── 字体面板（弹出层）─────
    const fontPanel = document.createElement('div');
    fontPanel.className = 'dr-font-panel';
    fontPanel.setAttribute('aria-hidden', 'true');

    // 字号
    const fsGroup = document.createElement('div');
    fsGroup.className = 'dr-fp-group';
    fsGroup.innerHTML = '<label class="dr-fp-label">字号</label>';
    const fsBtns = document.createElement('div');
    fsBtns.className = 'dr-fp-btns';
    [14, 16, 18, 20].forEach((px) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dr-fp-btn' + (px === this.fontSize ? ' active' : '');
      b.dataset.fontSize = String(px);
      b.textContent = px + 'px';
      b.addEventListener('click', () => this.setFontSize(px));
      fsBtns.appendChild(b);
    });
    fsGroup.appendChild(fsBtns);
    fontPanel.appendChild(fsGroup);

    // 行间距
    const lhGroup = document.createElement('div');
    lhGroup.className = 'dr-fp-group';
    lhGroup.innerHTML = '<label class="dr-fp-label">行间距</label>';
    const lhBtns = document.createElement('div');
    lhBtns.className = 'dr-fp-btns';
    [1.6, 1.8, 2.0].forEach((lh) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dr-fp-btn' + (lh === this.lineHeight ? ' active' : '');
      b.dataset.lineHeight = String(lh);
      b.textContent = lh.toFixed(1);
      b.addEventListener('click', () => this.setLineHeight(lh));
      lhBtns.appendChild(b);
    });
    lhGroup.appendChild(lhBtns);
    fontPanel.appendChild(lhGroup);

    // 字族
    const ffGroup = document.createElement('div');
    ffGroup.className = 'dr-fp-group';
    ffGroup.innerHTML = '<label class="dr-fp-label">字族</label>';
    const ffBtns = document.createElement('div');
    ffBtns.className = 'dr-fp-btns';
    [['serif', '衬线'], ['sans', '无衬线'], ['mono', '等宽']].forEach(([key, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dr-fp-btn' + (key === this.fontFamily ? ' active' : '');
      b.dataset.fontFamily = key;
      b.textContent = label;
      b.addEventListener('click', () => this._setFontFamily(key));
      ffBtns.appendChild(b);
    });
    ffGroup.appendChild(ffBtns);
    fontPanel.appendChild(ffGroup);

    // 自动滚动速度
    const asGroup = document.createElement('div');
    asGroup.className = 'dr-fp-group';
    asGroup.innerHTML = '<label class="dr-fp-label">自动滚动速度 <span class="dr-fp-val"></span></label>';
    const asVal = asGroup.querySelector('.dr-fp-val');
    asVal.textContent = this.autoSpeed + ' 行/分';
    const asRange = document.createElement('input');
    asRange.type = 'range';
    asRange.className = 'dr-fp-range';
    asRange.min = '24';
    asRange.max = '100';
    asRange.step = '1';
    asRange.value = String(this.autoSpeed);
    asRange.addEventListener('input', (e) => {
      this.autoSpeed = parseInt(e.target.value, 10) || 50;
      asVal.textContent = this.autoSpeed + ' 行/分';
    });
    asGroup.appendChild(asRange);
    fontPanel.appendChild(asGroup);

    root.appendChild(fontPanel);
    this._fontPanel = fontPanel;
    this._fontPanelSpeedVal = asVal;

    // ───── 主体：侧边栏 + 阅读区 ─────
    const main = document.createElement('div');
    main.className = 'dr-main';

    // 侧边栏
    const sidebar = document.createElement('aside');
    sidebar.className = 'dr-sidebar';
    const sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'dr-sidebar-header';
    sidebarHeader.innerHTML = '<h2 class="dr-sidebar-title">目录</h2>';
    const collapseAllBtn = document.createElement('button');
    collapseAllBtn.type = 'button';
    collapseAllBtn.className = 'dr-sidebar-action';
    collapseAllBtn.textContent = '全部折叠';
    collapseAllBtn.addEventListener('click', () => this._collapseAll());
    sidebarHeader.appendChild(collapseAllBtn);
    sidebar.appendChild(sidebarHeader);

    const treeNav = document.createElement('nav');
    treeNav.className = 'dr-tree-nav';
    treeNav.setAttribute('aria-label', '章节目录');
    sidebar.appendChild(treeNav);
    this._treeNav = treeNav;

    main.appendChild(sidebar);
    this._sidebar = sidebar;

    // 侧边栏遮罩（移动端抽屉）
    const sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'dr-sidebar-overlay';
    sidebarOverlay.addEventListener('click', () => this._closeSidebarMobile());
    main.appendChild(sidebarOverlay);
    this._sidebarOverlay = sidebarOverlay;

    // 阅读区
    const readerArea = document.createElement('div');
    readerArea.className = 'dr-reader';

    const article = document.createElement('article');
    article.className = 'dr-article markdown-body';
    readerArea.appendChild(article);
    this._articleEl = article;

    // 章节导航（上一章/下一章）
    const chapterNav = document.createElement('nav');
    chapterNav.className = 'dr-chapter-nav';
    chapterNav.setAttribute('aria-label', '章节导航');
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'dr-nav-btn dr-prev-btn';
    prevBtn.innerHTML = '<span class="dr-nav-arrow">←</span><span>上一章</span>';
    prevBtn.addEventListener('click', () => this._gotoPrev());
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'dr-nav-btn dr-next-btn';
    nextBtn.innerHTML = '<span>下一章</span><span class="dr-nav-arrow">→</span>';
    nextBtn.addEventListener('click', () => this._gotoNext());
    chapterNav.appendChild(prevBtn);
    chapterNav.appendChild(nextBtn);
    readerArea.appendChild(chapterNav);
    this._prevBtn = prevBtn;
    this._nextBtn = nextBtn;

    main.appendChild(readerArea);
    this._readerArea = readerArea;

    root.appendChild(main);

    // ───── 阅读进度条 ─────
    const progressBar = document.createElement('div');
    progressBar.className = 'dr-progress-bar';
    progressBar.setAttribute('aria-hidden', 'true');
    const progressFill = document.createElement('div');
    progressFill.className = 'dr-progress-fill';
    progressBar.appendChild(progressFill);
    root.appendChild(progressBar);
    this._progressBar = progressBar;
    this._progressFill = progressFill;

    // ───── 退出沉浸按钮（沉浸模式下浮动）─────
    const exitImmerseBtn = document.createElement('button');
    exitImmerseBtn.type = 'button';
    exitImmerseBtn.className = 'dr-exit-immerse';
    exitImmerseBtn.setAttribute('aria-label', '退出沉浸阅读');
    exitImmerseBtn.innerHTML = '<span class="dr-icon">✕</span>';
    exitImmerseBtn.addEventListener('click', () => this.exitImmersive());
    root.appendChild(exitImmerseBtn);
    this._exitImmerseBtn = exitImmerseBtn;

    // 挂载
    this.container.innerHTML = '';
    this.container.appendChild(root);
    this._rootEl = root;
  }

  // ============ 事件绑定 ============
  _bindEvents() {
    // 阅读区滚动 → 更新进度条
    this._onScroll = () => {
      this._updateProgress();
      // 手动滚动时暂停自动阅读
      if (this._autoRafId) this._pauseAutoScroll();
    };
    this._readerArea.addEventListener('scroll', this._onScroll, { passive: true });

    // 点击阅读区空白处（沉浸模式下）切换 UI 显隐
    this._onClick = (e) => {
      if (this._immersive) {
        // 点击正文区域切换 UI 显隐
        if (e.target.closest('.dr-article')) {
          this._rootEl.classList.toggle('ui-hidden');
        }
      }
    };
    this._readerArea.addEventListener('click', this._onClick);

    // 手动滚动（wheel/touchmove）暂停自动阅读
    this._readerArea.addEventListener('wheel', () => {
      if (this._autoRafId) this._pauseAutoScroll();
    }, { passive: true });
    this._readerArea.addEventListener('touchmove', () => {
      if (this._autoRafId) this._pauseAutoScroll();
    }, { passive: true });

    // 全局键盘
    this._onKeyDown = (e) => this._handleKeyDown(e);
    document.addEventListener('keydown', this._onKeyDown);

    // 全屏状态变化
    this._onFullscreenChange = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFs && this._immersive) {
        // 用户手动退出全屏时同步退出沉浸
        this._setImmersiveState(false);
      }
    };
    document.addEventListener('fullscreenchange', this._onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this._onFullscreenChange);

    // 点击外部关闭字体面板
    this._onDocClick = (e) => {
      if (!this._fontPanel) return;
      if (this._fontPanel.classList.contains('open') &&
          !this._fontPanel.contains(e.target) &&
          !this._fontBtn.contains(e.target)) {
        this._fontPanel.classList.remove('open');
        this._fontPanel.setAttribute('aria-hidden', 'true');
      }
    };
    document.addEventListener('click', this._onDocClick);

    // 窗口尺寸变化
    this._onResize = () => {
      if (window.innerWidth > 768) {
        this._closeSidebarMobile();
      }
    };
    window.addEventListener('resize', this._onResize);
  }

  _handleKeyDown(e) {
    // 左右键导航章节（仅在阅读器可见且非输入态时）
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this._gotoPrev();
      return;
    }
    if (e.key === 'ArrowRight' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this._gotoNext();
      return;
    }
    // Esc 退出沉浸
    if (e.key === 'Escape' && this._immersive) {
      e.preventDefault();
      this.exitImmersive();
      return;
    }
    // 空格切换自动滚动
    if (e.key === ' ' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // 仅在阅读区聚焦态切换，避免与按钮冲突
      if (e.target === document.body || e.target === this._readerArea) {
        e.preventDefault();
        this._toggleAutoScroll();
      }
    }
  }

  // ============ 目录树渲染 ============
  _renderTree() {
    const tree = this._treeNav;
    if (!tree) return;
    tree.innerHTML = '';

    if (this.chapters.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dr-empty';
      empty.textContent = '暂无章节';
      tree.appendChild(empty);
      return;
    }

    // 按卷分组
    const volMap = new Map();  // vol_no → { vol_title, chapters: [] }
    this.chapters.forEach((ch, idx) => {
      const volNo = ch.vol_no != null ? ch.vol_no : 0;
      if (!volMap.has(volNo)) {
        volMap.set(volNo, {
          vol_title: ch.vol_title || ('卷 ' + volNo),
          chapters: []
        });
      }
      volMap.get(volNo).chapters.push({ ch, idx });
    });

    const ul = document.createElement('ul');
    ul.className = 'dr-tree-list';
    volMap.forEach((vol, volNo) => {
      const li = document.createElement('li');
      li.className = 'dr-tree-node expanded';
      li.dataset.depth = '0';

      // 卷标题（可折叠）
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'dr-tree-toggle';
      toggle.innerHTML =
        '<span class="dr-tree-arrow" aria-hidden="true">▶</span>' +
        '<span class="dr-tree-icon" aria-hidden="true">📁</span>' +
        '<span class="dr-tree-text">' + escapeHtml(vol.vol_title) + '</span>';
      toggle.addEventListener('click', () => li.classList.toggle('expanded'));
      li.appendChild(toggle);

      // 章节列表
      const childUl = document.createElement('ul');
      childUl.className = 'dr-tree-children';
      vol.chapters.forEach(({ ch, idx }) => {
        const chLi = document.createElement('li');
        chLi.className = 'dr-tree-node';
        chLi.dataset.depth = '1';
        const leaf = document.createElement('button');
        leaf.type = 'button';
        leaf.className = 'dr-tree-leaf';
        leaf.dataset.idx = String(idx);
        leaf.dataset.volNo = String(ch.vol_no != null ? ch.vol_no : '');
        leaf.dataset.chNo = String(ch.ch_no != null ? ch.ch_no : '');
        leaf.innerHTML =
          '<span class="dr-tree-icon" aria-hidden="true">📑</span>' +
          '<span class="dr-tree-text">' + escapeHtml(ch.title || ('第 ' + ch.ch_no + ' 章')) + '</span>';
        leaf.addEventListener('click', () => {
          this._gotoIndex(idx);
          this._closeSidebarMobile();
        });
        chLi.appendChild(leaf);
        childUl.appendChild(chLi);
      });
      li.appendChild(childUl);
      ul.appendChild(li);
    });
    tree.appendChild(ul);
  }

  _collapseAll() {
    if (!this._treeNav) return;
    this._treeNav.querySelectorAll('.dr-tree-node').forEach((node) => {
      if (node.dataset.depth === '0') node.classList.remove('expanded');
    });
  }

  _markActiveLeaf(idx) {
    if (!this._treeNav) return;
    this._treeNav.querySelectorAll('.dr-tree-leaf').forEach((leaf) => {
      leaf.classList.toggle('active', Number(leaf.dataset.idx) === idx);
    });
    // 展开当前章节所在卷
    const activeLeaf = this._treeNav.querySelector('.dr-tree-leaf.active');
    if (activeLeaf) {
      let parent = activeLeaf.closest('.dr-tree-node[data-depth="0"]');
      if (parent) parent.classList.add('expanded');
      // 滚动到可见
      try { activeLeaf.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    }
  }

  // ============ 章节加载与渲染 ============
  _gotoIndex(idx) {
    if (idx < 0 || idx >= this.chapters.length) return;
    this.currentIdx = idx;
    const ch = this.chapters[idx];

    // 渲染正文
    const html = renderMarkdown(ch.content || '');
    const titleHtml = '<h1 class="dr-article-title">' + escapeHtml(ch.title || '') + '</h1>';
    if (this._articleEl) {
      this._articleEl.innerHTML = titleHtml + html;
    }
    // 顶栏标题
    if (this._chapterTitleEl) {
      this._chapterTitleEl.textContent = ch.title || ('第 ' + ch.ch_no + ' 章');
    }
    // 重置滚动
    if (this._readerArea) {
      this._readerArea.scrollTop = 0;
    }
    this._updateProgress();
    this._updateNavButtons();
    this._markActiveLeaf(idx);

    // 暂停自动滚动
    this._pauseAutoScroll();

    // 回调
    if (this.onNavigate) {
      try { this.onNavigate(ch); } catch (err) {
        console.error('[DreamTale Reader] onNavigate 回调异常:', err);
      }
    }
  }

  _gotoPrev() {
    if (this.currentIdx > 0) this._gotoIndex(this.currentIdx - 1);
  }

  _gotoNext() {
    if (this.currentIdx >= 0 && this.currentIdx < this.chapters.length - 1) {
      this._gotoIndex(this.currentIdx + 1);
    }
  }

  _updateNavButtons() {
    if (this._prevBtn) this._prevBtn.disabled = (this.currentIdx <= 0);
    if (this._nextBtn) this._nextBtn.disabled = (this.currentIdx >= this.chapters.length - 1);
  }

  // ============ 公开 API ============
  /**
   * 设置章节列表
   * @param {Array<Chapter>} chapters
   */
  setChapters(chapters) {
    this.chapters = Array.isArray(chapters) ? chapters.slice() : [];
    this.currentIdx = -1;
    this._renderTree();
    if (this.chapters.length > 0) {
      this._gotoIndex(0);
    } else if (this._articleEl) {
      this._articleEl.innerHTML = '<div class="dr-empty">暂无章节</div>';
    }
  }

  /**
   * 跳转到指定章节
   * @param {number} vol_no
   * @param {number} ch_no
   */
  setCurrentChapter(vol_no, ch_no) {
    const idx = this.chapters.findIndex((ch) =>
      (ch.vol_no != null ? ch.vol_no : 0) === Number(vol_no) &&
      (ch.ch_no != null ? ch.ch_no : 0) === Number(ch_no)
    );
    if (idx >= 0) {
      this._gotoIndex(idx);
    } else {
      console.warn('[DreamTale Reader] 未找到章节: vol_no=' + vol_no + ', ch_no=' + ch_no);
    }
  }

  /**
   * 设置主题
   * @param {'dark'|'light'|'sepia'} theme
   */
  setTheme(theme) {
    if (!VALID_THEMES.has(theme)) {
      console.warn('[DreamTale Reader] 无效的主题:', theme);
      return;
    }
    this._applyTheme(theme);
  }

  _applyTheme(theme) {
    if (!VALID_THEMES.has(theme)) return;
    this.theme = theme;
    if (this._rootEl) this._rootEl.dataset.theme = theme;
    if (this._themeBtn) {
      const iconEl = this._themeBtn.querySelector('.dr-icon');
      if (iconEl) iconEl.textContent = THEME_META[theme].icon;
      this._themeBtn.setAttribute('aria-label', '切换主题（当前：' + THEME_META[theme].label + '）');
    }
  }

  _cycleTheme() {
    const order = ['light', 'sepia', 'dark'];
    const idx = order.indexOf(this.theme);
    const next = order[(idx + 1) % order.length];
    this._applyTheme(next);
  }

  /**
   * 设置字号
   * @param {number} px
   */
  setFontSize(px) {
    px = Number(px);
    if (!VALID_FONT_SIZES.has(px)) {
      console.warn('[DreamTale Reader] 无效的字号:', px);
      return;
    }
    this.fontSize = px;
    this._applyFontAll();
    this._updateFontPanelActive();
  }

  /**
   * 设置行间距
   * @param {number} value
   */
  setLineHeight(value) {
    value = Number(value);
    if (!VALID_LINE_HEIGHTS.has(value)) {
      console.warn('[DreamTale Reader] 无效的行间距:', value);
      return;
    }
    this.lineHeight = value;
    this._applyFontAll();
    this._updateFontPanelActive();
  }

  _setFontFamily(family) {
    if (!VALID_FONT_FAMILIES.has(family)) {
      console.warn('[DreamTale Reader] 无效的字族:', family);
      return;
    }
    this.fontFamily = family;
    this._applyFontAll();
    this._updateFontPanelActive();
  }

  _applyFontAll() {
    if (!this._rootEl) return;
    this._rootEl.dataset.fontSize = String(this.fontSize);
    this._rootEl.dataset.lineHeight = String(this.lineHeight);
    this._rootEl.dataset.fontFamily = this.fontFamily;
    if (this._articleEl) {
      this._articleEl.style.fontSize = this.fontSize + 'px';
      this._articleEl.style.lineHeight = String(this.lineHeight);
      this._articleEl.style.fontFamily = FONT_STACKS[this.fontFamily];
    }
  }

  _updateFontPanelActive() {
    if (!this._fontPanel) return;
    this._fontPanel.querySelectorAll('[data-font-size]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.fontSize) === this.fontSize);
    });
    this._fontPanel.querySelectorAll('[data-line-height]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.lineHeight) === this.lineHeight);
    });
    this._fontPanel.querySelectorAll('[data-font-family]').forEach((b) => {
      b.classList.toggle('active', b.dataset.fontFamily === this.fontFamily);
    });
  }

  _toggleFontPanel() {
    if (!this._fontPanel) return;
    const isOpen = this._fontPanel.classList.toggle('open');
    this._fontPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  // ============ 侧边栏（移动端抽屉）============
  _toggleSidebar() {
    if (window.innerWidth <= 768) {
      this._sidebarOpenMobile ? this._closeSidebarMobile() : this._openSidebarMobile();
    } else {
      // 桌面端切换折叠/展开
      if (this._sidebar) this._sidebar.classList.toggle('collapsed');
    }
  }

  _openSidebarMobile() {
    if (!this._sidebar || !this._sidebarOverlay) return;
    this._sidebar.classList.add('open-mobile');
    this._sidebarOverlay.classList.add('open');
    this._sidebarOpenMobile = true;
  }

  _closeSidebarMobile() {
    if (!this._sidebar || !this._sidebarOverlay) return;
    this._sidebar.classList.remove('open-mobile');
    this._sidebarOverlay.classList.remove('open');
    this._sidebarOpenMobile = false;
  }

  // ============ 阅读进度条 ============
  _updateProgress() {
    if (!this._readerArea || !this._progressFill) return;
    const el = this._readerArea;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) {
      this._progressFill.style.width = '0%';
      return;
    }
    const pct = Math.max(0, Math.min(1, el.scrollTop / max));
    this._progressFill.style.width = (pct * 100).toFixed(2) + '%';
  }

  // ============ 自动滚动 ============
  _getLineHeightPx() {
    if (this._articleEl) {
      const lh = parseFloat(getComputedStyle(this._articleEl).lineHeight);
      if (!isNaN(lh) && lh > 0) return lh;
    }
    return this.fontSize * this.lineHeight;
  }

  _autoScrollLoop(ts) {
    if (!this._autoRafId) return;
    if (!this._autoLastTs) this._autoLastTs = ts;
    // clamp dt，防止后台切回瞬移
    const dt = Math.min(ts - this._autoLastTs, 100);
    this._autoLastTs = ts;

    const reader = this._readerArea;
    if (!reader) { this._pauseAutoScroll(); return; }

    // 到达章节末尾暂停
    if (reader.scrollHeight - reader.scrollTop - reader.clientHeight < 2) {
      this._pauseAutoScroll();
      return;
    }

    // 速度：行/分钟 → 像素/毫秒
    let speed = this.autoSpeed || 50;
    const prefersReduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) speed = Math.min(speed, 24);

    const lhPx = this._getLineHeightPx();
    const pxPerMs = (speed * lhPx) / 60000;
    const dy = pxPerMs * dt;
    // 亚像素累积：浏览器对 scrollBy(0, 0.xx) 取整为 0 会导致速度无差异
    this._autoPxAccumulator += dy;
    if (this._autoPxAccumulator >= 1) {
      const px = Math.floor(this._autoPxAccumulator);
      reader.scrollBy(0, px);
      this._autoPxAccumulator -= px;
    }

    this._autoRafId = window.requestAnimationFrame((t) => this._autoScrollLoop(t));
  }

  _startAutoScroll() {
    if (this._autoRafId) return;
    if (!this._readerArea) return;
    this._autoLastTs = 0;
    this._autoPxAccumulator = 0;
    this._autoRafId = window.requestAnimationFrame((t) => this._autoScrollLoop(t));
    this._updateAutoBtn(true);
  }

  _pauseAutoScroll() {
    if (this._autoRafId) {
      window.cancelAnimationFrame(this._autoRafId);
      this._autoRafId = null;
    }
    this._autoLastTs = 0;
    this._autoPxAccumulator = 0;
    this._updateAutoBtn(false);
  }

  _toggleAutoScroll() {
    if (this._autoRafId) this._pauseAutoScroll();
    else this._startAutoScroll();
  }

  _updateAutoBtn(isPlaying) {
    if (!this._autoBtn) return;
    const icon = this._autoBtn.querySelector('.dr-icon');
    if (icon) icon.textContent = isPlaying ? '⏸' : '▶';
    this._autoBtn.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
  }

  // ============ 沉浸模式 ============
  _toggleImmersive() {
    if (this._immersive) this.exitImmersive();
    else this.enterImmersive();
  }

  _setImmersiveState(active) {
    this._immersive = active;
    if (!this._rootEl) return;
    this._rootEl.classList.toggle('immersive-mode', active);
    if (active) {
      this._rootEl.classList.add('ui-hidden');
    } else {
      this._rootEl.classList.remove('ui-hidden');
    }
    if (this._immerseBtn) {
      const icon = this._immerseBtn.querySelector('.dr-icon');
      if (icon) icon.textContent = active ? '✕' : '⛶';
      this._immerseBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  /**
   * 进入沉浸阅读：隐藏侧边栏 + 顶栏，全屏阅读
   */
  enterImmersive() {
    if (this._immersive) return;
    this._setImmersiveState(true);
    this._closeSidebarMobile();
    // 尝试浏览器全屏 API（失败回退到纯 CSS 沉浸，body class 已加）
    try {
      const el = this._rootEl || document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (fn) {
        const p = fn.call(el);
        if (p && p.catch) p.catch(() => { /* 静默 fallback */ });
      }
    } catch (e) { /* 静默 fallback */ }
  }

  /**
   * 退出沉浸阅读
   */
  exitImmersive() {
    if (!this._immersive) return;
    this._setImmersiveState(false);
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (fn) { try { fn.call(document); } catch (e) { /* ignore */ } }
    }
  }

  // ============ 销毁 ============
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    // 暂停自动滚动
    this._pauseAutoScroll();

    // 退出沉浸
    if (this._immersive) this._setImmersiveState(false);

    // 移除全局监听
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('fullscreenchange', this._onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this._onFullscreenChange);
    document.removeEventListener('click', this._onDocClick);
    window.removeEventListener('resize', this._onResize);

    // 移除 DOM
    if (this._rootEl && this._rootEl.parentNode) {
      this._rootEl.parentNode.removeChild(this._rootEl);
    }
    this._rootEl = null;
    this._treeNav = null;
    this._sidebar = null;
    this._sidebarOverlay = null;
    this._readerArea = null;
    this._articleEl = null;
    this._progressFill = null;
    this._progressBar = null;
    this._fontPanel = null;
    this._fontBtn = null;
    this._themeBtn = null;
    this._autoBtn = null;
    this._immerseBtn = null;
    this._exitImmerseBtn = null;
    this._prevBtn = null;
    this._nextBtn = null;
    this._chapterTitleEl = null;
    this._toolbar = null;
    this.container = null;
    this.onNavigate = null;
    this.chapters = [];
  }
}

// ============ 工具函数 ============
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ 工厂函数 ============
/**
 * 创建 Reader 实例
 * @param {HTMLElement} container
 * @param {Object} options 见构造函数
 * @returns {Reader}
 */
export function createReader(container, options) {
  return new Reader(container, options);
}

// 默认导出
export default Reader;
