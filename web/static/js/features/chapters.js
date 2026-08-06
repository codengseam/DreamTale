/**
 * DreamTale · 章节编辑功能模块
 *
 * 布局：左侧章节列表（按卷分组、可折叠、可拖拽排序）+ 右侧 MarkdownEditor 编辑正文
 * - 顶部：章节标题编辑 + 字数统计 + 状态切换（draft/published）+ 保存按钮
 * - 自动保存：onChange 防抖 1500ms 调 storage.saveChapter
 * - 新建章节：选择卷号 → 自动分配章号 → 创建空章节
 * - 字数实时统计：editor.getWordCount()
 *
 * 通过 window.DreamTaleFeatures.renderChapters(container) 挂载。
 *
 * 依赖：
 *   - window.DreamTale.state / storage / notify
 *   - window.DreamTaleEditor.create(container, options)
 *
 * 数据模型对齐 core/models.js 的 Chapter 类。
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------

  function DT() {
    if (!global.DreamTale) throw new Error('[chapters] window.DreamTale 未初始化');
    return global.DreamTale;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function currentProjectId() {
    const proj = DT().state.currentProject;
    if (!proj) {
      DT().notify('请先在「作品管理」中选择一个作品', 'warning');
      return null;
    }
    // state.currentProject 是 Project 实例对象，存储层需要的是 id 字符串
    return proj.id;
  }

  function padVol(n) { return String(n).padStart(2, '0'); }
  function padCh(n) { return String(n).padStart(3, '0'); }

  function chapterKey(c) { return c.vol_no + ':' + c.ch_no; }

  /** 通用模态框 */
  function createModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'dt-modal-overlay';
    overlay.innerHTML = `
      <div class="dt-modal ${opts.size === 'large' ? 'dt-modal-large' : ''}">
        <div class="dt-modal-header">
          <h3>${esc(opts.title || '')}</h3>
          <button class="dt-modal-close" data-act="close" aria-label="关闭">×</button>
        </div>
        <div class="dt-modal-body">${opts.bodyHTML || ''}</div>
        <div class="dt-modal-footer">
          <button class="dt-btn" data-act="cancel">取消</button>
          <button class="dt-btn ${opts.submitClass || 'dt-btn-primary'}" data-act="submit">${esc(opts.submitText || '确定')}</button>
        </div>
      </div>`;
    const body = overlay.querySelector('.dt-modal-body');
    const close = () => overlay.remove();
    overlay.querySelector('[data-act="close"]').addEventListener('click', close);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const submitBtn = overlay.querySelector('[data-act="submit"]');
    submitBtn.addEventListener('click', async () => {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      submitBtn.textContent = '处理中…';
      try {
        const ok = await opts.onSubmit(body, close);
        if (ok !== false) close();
      } catch (err) {
        console.error('[chapters] 模态框提交异常:', err);
        DT().notify('操作失败：' + (err.message || err), 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = opts.submitText || '确定';
      }
    });
    return overlay;
  }

  // ---------- 主渲染入口 ----------

  async function renderChapters(container) {
    if (!container) throw new Error('[chapters] container 不能为空');
    container.innerHTML = '';

    const pid = currentProjectId();
    if (!pid) {
      container.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    // 整体布局
    const layout = document.createElement('div');
    layout.className = 'dt-chapters-layout';
    layout.innerHTML = `
      <aside class="dt-ch-sidebar">
        <div class="dt-ch-sidebar-toolbar">
          <button class="dt-btn dt-btn-sm dt-btn-primary" data-act="new">+ 新章</button>
          <button class="dt-btn dt-btn-sm" data-act="refresh" title="刷新">⟳</button>
        </div>
        <div class="dt-ch-list"><p class="dt-empty-hint">加载中…</p></div>
      </aside>
      <section class="dt-ch-main">
        <div class="dt-ch-empty"><p>请从左侧选择一个章节开始写作</p></div>
      </section>`;
    container.appendChild(layout);

    const listEl = layout.querySelector('.dt-ch-list');
    const mainEl = layout.querySelector('.dt-ch-main');

    let chapters = [];
    let volumes = [];
    let currentCh = null;       // 当前正在编辑的章节对象
    let editor = null;          // 当前编辑器实例
    let autoSaveTimer = null;   // 自动保存定时器
    let isDirty = false;        // 是否有未保存改动

    // ---------- 加载列表 ----------
    async function reload() {
      listEl.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        [chapters, volumes] = await Promise.all([
          DT().storage.listChapters(pid),
          DT().storage.listVolumes(pid),
        ]);
        chapters = chapters || [];
        volumes = (volumes || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        renderList();
      } catch (err) {
        console.error('[chapters] 列表加载失败:', err);
        listEl.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
      }
    }

    function renderList() {
      if (!chapters.length) {
        listEl.innerHTML = '<p class="dt-empty-hint">暂无章节，点击「+ 新章」开始</p>';
        return;
      }
      // 按卷分组
      const byVol = new Map();
      chapters.forEach((c) => {
        const arr = byVol.get(c.vol_no) || [];
        arr.push(c);
        byVol.set(c.vol_no, arr);
      });
      byVol.forEach((arr) => arr.sort((a, b) => String(a.ch_no).localeCompare(String(b.ch_no))));

      const volNames = new Map(volumes.map((v) => [v.vol_no, v.vol_name]));
      const currentKey = currentCh ? chapterKey(currentCh) : '';

      const html = [];
      const knownVols = new Set(volumes.map((v) => v.vol_no));

      // 按卷顺序渲染
      volumes.forEach((v) => {
        const arr = byVol.get(v.vol_no) || [];
        html.push(volGroupHTML(v.vol_no, v.vol_name || '未命名', arr, currentKey, true));
      });
      // 孤儿章节
      const orphans = chapters.filter((c) => !knownVols.has(c.vol_no));
      if (orphans.length) {
        // 按孤儿卷号聚合
        const orphanByVol = new Map();
        orphans.forEach((c) => {
          const arr = orphanByVol.get(c.vol_no) || [];
          arr.push(c);
          orphanByVol.set(c.vol_no, arr);
        });
        orphanByVol.forEach((arr, volNo) => {
          arr.sort((a, b) => String(a.ch_no).localeCompare(String(b.ch_no)));
          html.push(volGroupHTML(volNo, volNames.get(volNo) || '未分卷', arr, currentKey, true));
        });
      }

      listEl.innerHTML = html.join('');
      bindListEvents();
    }

    function volGroupHTML(volNo, volName, arr, currentKey, expanded) {
      return `
        <div class="dt-ch-vol-group" data-vol="${esc(volNo)}">
          <div class="dt-ch-vol-header" data-act="toggle">
            <span class="dt-ch-vol-toggle">${expanded ? '▾' : '▸'}</span>
            <span class="dt-ch-vol-name">第 ${esc(volNo)} 卷 · ${esc(volName)}</span>
            <span class="dt-ch-vol-count">(${arr.length})</span>
          </div>
          <ul class="dt-ch-items" style="${expanded ? '' : 'display:none'}">
            ${arr.map((c) => chListItemHTML(c, chapterKey(c) === currentKey)).join('')}
          </ul>
        </div>`;
    }

    function chListItemHTML(c, isActive) {
      const statusTag = c.status === 'published'
        ? '<span class="dt-badge dt-badge-ok">已发</span>'
        : '<span class="dt-badge dt-badge-warn">草</span>';
      return `
        <li class="dt-ch-item ${isActive ? 'dt-ch-item-active' : ''}" data-ch-key="${esc(chapterKey(c))}" draggable="true">
          <span class="dt-ch-item-no">${esc(c.ch_no)}</span>
          <span class="dt-ch-item-title">${esc(c.title || '未命名')}</span>
          ${statusTag}
        </li>`;
    }

    function bindListEvents() {
      // 卷折叠
      listEl.querySelectorAll('.dt-ch-vol-header').forEach((header) => {
        header.addEventListener('click', () => {
          const items = header.nextElementSibling;
          const toggle = header.querySelector('.dt-ch-vol-toggle');
          if (items.style.display === 'none') {
            items.style.display = '';
            toggle.textContent = '▾';
          } else {
            items.style.display = 'none';
            toggle.textContent = '▸';
          }
        });
      });

      // 点击章节
      listEl.querySelectorAll('.dt-ch-item').forEach((li) => {
        const key = li.getAttribute('data-ch-key');
        li.addEventListener('click', () => selectChapter(key));
        bindDrag(li, key);
      });
    }

    // ---------- 拖拽排序 ----------
    let dragSrcKey = '';
    function bindDrag(li, key) {
      li.addEventListener('dragstart', (e) => {
        dragSrcKey = key;
        li.classList.add('dt-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', key); } catch (_) {}
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dt-dragging');
        listEl.querySelectorAll('.dt-dragover').forEach((el) => el.classList.remove('dt-dragover'));
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        li.classList.add('dt-dragover');
      });
      li.addEventListener('dragleave', () => li.classList.remove('dt-dragover'));
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        li.classList.remove('dt-dragover');
        const targetKey = key;
        if (!dragSrcKey || dragSrcKey === targetKey) return;
        await reorderChapters(dragSrcKey, targetKey);
        dragSrcKey = '';
      });
    }

    async function reorderChapters(srcKey, targetKey) {
      // 简单实现：在同一卷内交换章号（章号即序号）
      const src = chapters.find((c) => chapterKey(c) === srcKey);
      const target = chapters.find((c) => chapterKey(c) === targetKey);
      if (!src || !target) return;
      if (src.vol_no !== target.vol_no) {
        DT().notify('暂不支持跨卷拖拽，请先在同一卷内排序', 'warning');
        return;
      }
      // 交换章号
      const srcChNo = src.ch_no;
      const targetChNo = target.ch_no;
      try {
        // 先删除两个旧章号（避免主键冲突）
        await DT().storage.deleteChapter(pid, src.vol_no, src.ch_no);
        await DT().storage.deleteChapter(pid, target.vol_no, target.ch_no);
        // 用交换后的章号重新保存
        await DT().storage.saveChapter(pid, { ...src, ch_no: targetChNo, updated_at: new Date().toISOString() });
        await DT().storage.saveChapter(pid, { ...target, ch_no: srcChNo, updated_at: new Date().toISOString() });
        DT().notify('章节顺序已交换', 'success');
        await reload();
      } catch (err) {
        console.error('[chapters] 排序失败:', err);
        DT().notify('排序失败：' + (err.message || err), 'error');
        await reload();
      }
    }

    // ---------- 选中章节 ----------
    async function selectChapter(key) {
      // 先保存当前未保存的改动
      await flushSave();
      const ch = chapters.find((c) => chapterKey(c) === key);
      if (!ch) return;
      try {
        // 重新拉取最新内容（避免本地缓存过期）
        currentCh = await DT().storage.getChapter(pid, ch.vol_no, ch.ch_no);
      } catch (err) {
        console.error('[chapters] 加载章节失败:', err);
        DT().notify('加载章节失败：' + (err.message || err), 'error');
        return;
      }
      if (!currentCh) currentCh = ch;
      DT().state.currentVol = currentCh.vol_no;
      DT().state.currentCh = currentCh.ch_no;
      isDirty = false;
      renderEditor();
      // 刷新列表高亮
      listEl.querySelectorAll('.dt-ch-item').forEach((li) => {
        li.classList.toggle('dt-ch-item-active', li.getAttribute('data-ch-key') === key);
      });
    }

    // ---------- 全屏 / 专注模式切换 ----------
    let isZenMode = false;     // CSS 沉浸态
    let isTypewriter = false;  // 打字机模式
    let isFsApi = false;       // Fullscreen API 实际全屏

    function toggleZen() {
      isZenMode = !isZenMode;
      updateWriterModes();
    }
    function toggleTypewriter() {
      isTypewriter = !isTypewriter;
      updateWriterModes();
    }
    function asyncToggleFullscreen() {
      const el = mainEl;
      if (!el) return;
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      try {
        if (!fs) {
          const req = el.requestFullscreen || el.webkitRequestFullscreen;
          if (req) { req.call(el); isFsApi = true; }
          else { isZenMode = true; } // 不支持 Fullscreen API 时 fallback 到 CSS 沉浸
        } else {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) exit.call(document);
          isFsApi = false;
        }
      } catch (e) {
        console.warn('[chapters] 全屏切换失败，fallback 到 CSS 沉浸:', e);
        isZenMode = !fs;
      }
      updateWriterModes();
    }
    function updateWriterModes() {
      if (!mainEl) return;
      mainEl.classList.toggle('dt-fullscreen-zen', isZenMode || isFsApi);
      mainEl.classList.toggle('dt-typewriter', isTypewriter);
      document.body.classList.toggle('dt-app-shell-zen', isZenMode || isFsApi);
      // 同步按钮 pressed 态
      const zenBtn = mainEl.querySelector('[data-act="toggle-zen"]');
      const fsBtn  = mainEl.querySelector('[data-act="toggle-fullscreen"]');
      const twBtn  = mainEl.querySelector('[data-act="toggle-typewriter"]');
      if (zenBtn) zenBtn.setAttribute('aria-pressed', String(isZenMode || isFsApi));
      if (fsBtn)  fsBtn.setAttribute('aria-pressed', String(isFsApi));
      if (twBtn)  twBtn.setAttribute('aria-pressed', String(isTypewriter));
    }
    // ESC 退出沉浸态
    function onDocKey(e) {
      if ((e.key === 'Escape') && (isZenMode || isTypewriter)) {
        isZenMode = false;
        isTypewriter = false;
        updateWriterModes();
      }
      // 快捷键：Ctrl/Cmd + Shift + F 全屏；Ctrl/Cmd+. 打字机；Ctrl/Cmd+Enter 沉浸
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault(); asyncToggleFullscreen();
      } else if (ctrl && (e.key === 'Enter')) {
        e.preventDefault(); toggleZen();
      } else if (ctrl && (e.key === '.')) {
        e.preventDefault(); toggleTypewriter();
      }
    }

    // ---------- 渲染右侧编辑器 ----------
    function renderEditor() {
      if (!currentCh) {
        mainEl.innerHTML = `<div class="dt-ch-empty">
          <div class="dt-ch-empty-icon">✍️</div>
          <p>请从左侧选择一个章节开始写作</p>
          <p style="font-size:12px;margin-top:4px;">或点击右上角 <b>+ 新章</b> 创建你的第一章</p>
        </div>`;
        return;
      }
      // 销毁旧编辑器
      destroyEditor();
      const volName = (volumes.find((v) => v.vol_no === currentCh.vol_no) || {}).vol_name || '未命名卷';
      const curWords = currentCh.words || 0;
      // 默认目标字数（每章 6000 字，可后续改设定）
      const GOAL_WORDS = 6000;
      const isGoalReached = curWords >= GOAL_WORDS;
      const percent = Math.min(100, Math.round((curWords / GOAL_WORDS) * 100));

      mainEl.innerHTML = `
        <!-- 悬浮工具栏（毛玻璃胶囊） -->
        <div class="dt-ch-float-toolbar" role="toolbar" aria-label="写作模式">
          <button type="button" data-act="toggle-typewriter" title="打字机模式 (Ctrl/⌘+.)" aria-pressed="false">⌨</button>
          <button type="button" data-act="toggle-zen" title="沉浸/专注模式 (Ctrl/⌘+Enter)" aria-pressed="false">🧘</button>
          <div class="dt-ft-sep"></div>
          <button type="button" data-act="toggle-fullscreen" title="全屏写作 (Ctrl/⌘+Shift+F)" aria-pressed="false">⛶</button>
          <button type="button" data-act="save" title="立即保存 (Ctrl/⌘+S)">💾</button>
          <button type="button" data-act="goto-reader" title="跳转到阅读模式">📖</button>
          <div class="dt-ft-sep"></div>
          <button type="button" data-act="delete" title="删除本章">🗑</button>
        </div>

        <!-- 编辑头部：元信息 -->
        <div class="dt-ch-header">
          <div class="dt-ch-header-left">
            <div class="dt-ch-breadcrumb">
              <span>作品</span>
              <span class="dt-ch-bc-sep">›</span>
              <span>第 ${esc(currentCh.vol_no)} 卷 · ${esc(volName)}</span>
              <span class="dt-ch-bc-sep">›</span>
              <span class="dt-ch-bc-current">第 ${esc(currentCh.ch_no)} 章</span>
            </div>
            <div class="dt-ch-title-wrap">
              <input type="text" class="dt-ch-title-input" data-f="title" value="${esc(currentCh.title || '')}" placeholder="输入本章标题…" />
            </div>
          </div>
          <div class="dt-ch-header-right">
            <!-- 保存指示 -->
            <div class="dt-ch-save-indicator" data-f="autosave-hint" title="自动保存状态">
              <span class="dt-dot"></span><span>就绪</span>
            </div>
            <!-- 状态切换胶囊 -->
            <div class="dt-ch-status-switch" role="group" aria-label="章节状态">
              <button type="button" class="dt-ch-st-draft ${currentCh.status === 'draft' ? 'active' : ''}" data-f="status" data-val="draft">草稿</button>
              <button type="button" class="dt-ch-st-pub ${currentCh.status === 'published' ? 'active' : ''}" data-f="status" data-val="published">已发布</button>
            </div>
            <!-- 字数胶囊 -->
            <div class="dt-ch-word-count ${isGoalReached ? 'dt-ch-word-goal' : ''}" title="目标 ${GOAL_WORDS} 字 · 已完成 ${percent}%">
              <span>目标 ${percent}%</span>
              <span class="dt-ch-word-num">${curWords.toLocaleString()}</span>
              <span>字</span>
            </div>
          </div>
        </div>

        <!-- 编辑器挂载区 -->
        <div class="dt-ch-editor-wrap" data-f="editor-host"></div>

        <!-- 悬浮右下角字数（全屏模式增强） -->
        <div class="dt-ch-float-wordcount" aria-hidden="false">
          第 <strong>${esc(currentCh.vol_no)}</strong> 卷 · 第 <strong>${esc(currentCh.ch_no)}</strong> 章 ·
          <strong>${curWords.toLocaleString()}</strong> 字 ·
          <span style="color:${isGoalReached ? 'var(--success)' : 'var(--ink-muted)'}">${percent}%</span>
        </div>`;

      const host = mainEl.querySelector('[data-f="editor-host"]');
      try {
        editor = global.DreamTaleEditor.create(host, {
          initialValue: currentCh.content || '',
          theme: DT().state.theme || 'light',
          onChange: (text) => onContentChange(text),
          onSave: () => { flushSave(); return true; },
        });
      } catch (err) {
        console.error('[chapters] 编辑器创建失败:', err);
        host.innerHTML = `<textarea class="dt-ch-fallback" style="width:100%;min-height:60vh;padding:24px;">${esc(currentCh.content || '')}</textarea>`;
        const ta = host.querySelector('.dt-ch-fallback');
        ta.addEventListener('input', () => onContentChange(ta.value));
      }

      // 标题输入
      const titleInput = mainEl.querySelector('[data-f="title"]');
      titleInput.addEventListener('input', () => {
        if (currentCh) {
          currentCh.title = titleInput.value;
          markDirty();
        }
      });

      // 状态切换（按钮胶囊）
      mainEl.querySelectorAll('[data-f="status"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!currentCh) return;
          const val = btn.getAttribute('data-val') || 'draft';
          currentCh.status = val;
          // 切换 active 态
          mainEl.querySelectorAll('[data-f="status"]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-val') === val);
          });
          await flushSave();
          renderList();
        });
      });

      // 保存 / 删除 / 跳转阅读 / 模式切换按钮（悬浮工具栏 + 头部可能的按钮）
      bindAct('save', () => flushSave());
      bindAct('delete', () => confirmDelete(currentCh));
      bindAct('goto-reader', () => {
        if (DT().router && typeof DT().router.go === 'function') {
          DT().router.go('#/reader');
        } else if (window.DreamTale && window.DreamTale.router) {
          window.DreamTale.router.go('#/reader');
        } else {
          window.location.hash = '#/reader';
        }
      });
      bindAct('toggle-zen', toggleZen);
      bindAct('toggle-fullscreen', asyncToggleFullscreen);
      bindAct('toggle-typewriter', toggleTypewriter);

      // 同步按钮 pressed 态
      updateWriterModes();
    }

    function bindAct(act, cb) {
      mainEl.querySelectorAll(`[data-act="${act}"]`).forEach((b) => {
        if (b.dataset.bound) return;
        b.dataset.bound = '1';
        b.addEventListener('click', (e) => { e.preventDefault(); cb && cb(); });
      });
    }

    function destroyEditor() {
      if (editor) {
        try { editor.destroy(); } catch (_) {}
        editor = null;
      }
    }

    // ---------- 内容变更 + 自动保存（防抖 1500ms） ----------
    function onContentChange(text) {
      if (!currentCh) return;
      currentCh.content = text;
      // 实时字数统计
      const words = editor ? editor.getWordCount() : (text ? text.length : 0);
      currentCh.words = words;
      updateWordsUI(words);
      markDirty();
    }

    function updateWordsUI(words) {
      const GOAL_WORDS = 6000;
      const percent = Math.min(100, Math.round((words / GOAL_WORDS) * 100));
      const isGoalReached = words >= GOAL_WORDS;
      // 头部字数胶囊
      const wc = mainEl.querySelector('.dt-ch-word-count');
      if (wc) {
        wc.classList.toggle('dt-ch-word-goal', isGoalReached);
        const num = wc.querySelector('.dt-ch-word-num');
        if (num) num.textContent = words.toLocaleString();
        // 目标百分比
        const first = wc.firstElementChild;
        if (first && first.textContent.startsWith('目标')) first.textContent = `目标 ${percent}%`;
      }
      // 悬浮字数
      const fw = mainEl.querySelector('.dt-ch-float-wordcount');
      if (fw) {
        const strongs = fw.querySelectorAll('strong');
        if (strongs && strongs[2]) strongs[2].textContent = words.toLocaleString();
        const last = fw.lastElementChild || fw.childNodes[fw.childNodes.length - 1];
        if (last && last.style) {
          last.style.color = isGoalReached ? 'var(--success)' : 'var(--ink-muted)';
          last.textContent = `${percent}%`;
        }
      }
    }

    function markDirty() {
      isDirty = true;
      setAutosaveHint('未保存', 'dirty');
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => { flushSave(); }, 1500);
    }

    function setAutosaveHint(text, type) {
      const el = mainEl.querySelector('[data-f="autosave-hint"]');
      if (el) {
        // type: dirty (未保存黄) / saving (保存中蓝) / ok (已保存绿) / error (红)
        el.className = 'dt-ch-save-indicator' + (type ? ' dt-' + (type === 'dirty' ? 'saving' : (type === 'ok' ? 'saved' : type)) : '');
        const span = el.querySelector('span:last-child') || el.lastChild;
        if (span && span.textContent !== undefined) span.textContent = text;
        else el.innerHTML = `<span class="dt-dot"></span><span>${text}</span>`;
      }
    }

    async function flushSave() {
      if (!currentCh || !isDirty) return;
      clearTimeout(autoSaveTimer);
      setAutosaveHint('保存中…', 'saving');
      try {
        const payload = {
          ...currentCh,
          title: mainEl.querySelector('[data-f="title"]') ? mainEl.querySelector('[data-f="title"]').value : currentCh.title,
          words: currentCh.words,
          updated_at: new Date().toISOString(),
        };
        currentCh.title = payload.title;
        await DT().storage.saveChapter(pid, payload);
        isDirty = false;
        const now = new Date().toLocaleTimeString();
        setAutosaveHint('已保存 ' + now, 'ok');
        // 静默更新列表标题
        const li = listEl.querySelector(`[data-ch-key="${esc(chapterKey(currentCh))}"] .dt-ch-item-title`);
        if (li) li.textContent = payload.title || '未命名';
      } catch (err) {
        console.error('[chapters] 自动保存失败:', err);
        setAutosaveHint('保存失败', 'error');
        DT().notify('章节保存失败：' + (err.message || err), 'error');
      }
    }

    // ---------- 新建章节 ----------
    function newChapter() {
      if (!volumes.length) {
        DT().notify('请先在「大纲」中创建至少一卷', 'warning');
        return;
      }
      const overlay = createModal({
        title: '新建章节',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row">
              <label>选择卷</label>
              <select data-field="vol_no">
                ${volumes.map((v) => `<option value="${esc(v.vol_no)}">第 ${esc(v.vol_no)} 卷 · ${esc(v.vol_name || '未命名')}</option>`).join('')}
              </select>
            </div>
            <div class="dt-form-row">
              <label>章节标题</label>
              <input type="text" data-field="title" value="" placeholder="如：初入江湖" />
            </div>
          </div>`,
        submitText: '创建',
        onSubmit: async (formEl) => {
          const volNo = formEl.querySelector('[data-field="vol_no"]').value;
          const title = formEl.querySelector('[data-field="title"]').value.trim() || '新章节';
          // 自动分配章号
          const volChs = chapters.filter((c) => c.vol_no === volNo);
          let maxCh = 0;
          volChs.forEach((c) => { const n = Number(c.ch_no) || 0; if (n > maxCh) maxCh = n; });
          const chNo = padCh(maxCh + 1);
          const payload = {
            vol_no: volNo,
            ch_no: chNo,
            title,
            content: '',
            summary: '',
            highlights: [],
            words: 0,
            status: 'draft',
            updated_at: new Date().toISOString(),
          };
          try {
            await DT().storage.saveChapter(pid, payload);
            DT().notify(`已创建第 ${volNo} 卷 第 ${chNo} 章`, 'success');
            await reload();
            await selectChapter(chapterKey(payload));
            return true;
          } catch (err) {
            console.error('[chapters] 新建失败:', err);
            DT().notify('新建失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }

    // ---------- 删除章节 ----------
    function confirmDelete(ch) {
      const overlay = createModal({
        title: '删除章节',
        bodyHTML: `
          <div class="dt-confirm">
            <p class="dt-warn">⚠ 此操作不可撤销</p>
            <p>确认删除「第 ${esc(ch.vol_no)} 卷 第 ${esc(ch.ch_no)} 章 · ${esc(ch.title || '未命名')}」？</p>
            <p>章节正文与章纲数据将一并删除。</p>
          </div>`,
        submitText: '删除',
        submitClass: 'dt-btn-danger',
        onSubmit: async () => {
          try {
            await DT().storage.deleteChapter(pid, ch.vol_no, ch.ch_no);
            DT().notify('章节已删除', 'success');
            if (currentCh && chapterKey(currentCh) === chapterKey(ch)) {
              currentCh = null;
              destroyEditor();
              renderEditor();
            }
            await reload();
            return true;
          } catch (err) {
            console.error('[chapters] 删除失败:', err);
            DT().notify('删除失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }

    // ---------- 事件绑定 ----------
    layout.querySelector('[data-act="new"]').addEventListener('click', newChapter);
    layout.querySelector('[data-act="refresh"]').addEventListener('click', reload);

    // 全局快捷键（沉浸态+模式切换）
    document.addEventListener('keydown', onDocKey);

    // 离开页面前保存
    window.addEventListener('beforeunload', beforeUnload);
    function beforeUnload() {
      if (isDirty) {
        // 同步保存无法在 beforeunload 完成，仅作提示
        return '有未保存的改动';
      }
    }

    // 清理钩子：挂到容器上，便于切换视图时调用
    container._dtChaptersCleanup = () => {
      clearTimeout(autoSaveTimer);
      document.removeEventListener('keydown', onDocKey);
      window.removeEventListener('beforeunload', beforeUnload);
      // 退出任何可能的沉浸态
      document.body.classList.remove('dt-app-shell-zen', 'dt-app-shell-auto-hide');
      destroyEditor();
    };

    await reload();
  }

  // ---------- 导出 ----------

  NS.renderChapters = renderChapters;
})(window);
