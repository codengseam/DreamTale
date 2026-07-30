/**
 * DreamTale · 灵感库页面功能模块（IIFE 经典脚本）
 *
 * 功能：
 * - 8 大类标签栏（灵感/语音转录/片段/人物/世界观/金手指/爽点/素材）
 * - 灵感列表：标题 / 类型 / 标签 / 内容预览 / 关联章节 / 编辑/删除按钮
 * - 新建灵感模态框：类型 / 标题 / 内容（Markdown）/ 标签 / 来源链接 / 关联章节
 * - 搜索框
 * - 导入导出按钮（导出为 inspirations.md）
 *
 * 通过 window.DreamTaleFeatures.renderInspirations(container) 挂载。
 *
 * 依赖：
 *   - window.DreamTale.state / notify
 *   - 动态 import('../../src/extension/inspiration-library.js')
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------

  function DT() {
    if (!global.DreamTale) throw new Error('[inspirations] window.DreamTale 未初始化');
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

  function fmtTime(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 8 大类
  const TYPES = [
    { value: 'all', label: '全部' },
    { value: 'idea', label: '💡 灵感' },
    { value: 'voice', label: '🎙 语音转录' },
    { value: 'snippet', label: '✂️ 片段' },
    { value: 'character', label: '👤 人物' },
    { value: 'worldview', label: '🌍 世界观' },
    { value: 'golden_finger', label: '✨ 金手指' },
    { value: 'highlight', label: '⚡ 爽点' },
    { value: 'material', label: '📚 素材' },
  ];

  function typeLabel(t) {
    const found = TYPES.find((x) => x.value === t);
    return found ? found.label : t;
  }

  // 懒加载的 ES Module
  let _libMod = null;
  let _libInstance = null;
  async function loadLib() {
    if (_libInstance) return _libInstance;
    _libMod = await import('../../src/extension/inspiration-library.js');
    _libInstance = new _libMod.InspirationLibrary();
    return _libInstance;
  }

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
        console.error('[inspirations] 模态框提交异常:', err);
        DT().notify('操作失败：' + (err.message || err), 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = opts.submitText || '确定';
      }
    });
    return overlay;
  }

  // ---------- 主渲染入口 ----------

  async function renderInspirations(container) {
    if (!container) throw new Error('[inspirations] container 不能为空');
    container.innerHTML = '';

    // 顶部工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'dt-toolbar';
    toolbar.innerHTML = `
      <h2 class="dt-page-title">💡 灵感库</h2>
      <div class="dt-toolbar-actions">
        <input type="text" class="dt-input" data-act="keyword" placeholder="搜索灵感…" style="min-width:200px;" />
        <button class="dt-btn" data-act="export">导出 .md</button>
        <button class="dt-btn" data-act="import">导入 .md</button>
        <input type="file" data-act="import-input" accept=".md,.txt" hidden />
        <button class="dt-btn dt-btn-primary" data-act="new">+ 新建灵感</button>
      </div>
    `;
    container.appendChild(toolbar);

    // 类型标签栏
    const filterBar = document.createElement('div');
    filterBar.className = 'dt-filter-bar';
    filterBar.innerHTML = `<span class="dt-filter-label">类型：</span>` +
      TYPES.map((t) => `<button class="dt-btn dt-btn-sm dt-filter-btn ${t.value === 'all' ? 'active' : ''}" data-type="${t.value}">${esc(t.label)}</button>`).join('');

    // 列表容器
    const listWrap = document.createElement('div');
    listWrap.className = 'dt-inspiration-list';
    listWrap.innerHTML = '<p class="dt-empty-hint">加载中…</p>';

    container.appendChild(filterBar);
    container.appendChild(listWrap);

    // ---------- 状态 ----------
    let state = {
      type: 'all',
      keyword: '',
      items: [],
    };

    // ---------- 加载灵感库 ----------
    let lib = null;
    try {
      lib = await loadLib();
    } catch (err) {
      console.error('[inspirations] 模块加载失败:', err);
      listWrap.innerHTML = `<p class="dt-empty-hint dt-error">模块加载失败：${esc(err.message || err)}</p>`;
      return;
    }

    // ---------- 事件绑定 ----------
    filterBar.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterBar.querySelectorAll('[data-type]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.type = btn.getAttribute('data-type');
        renderList();
      });
    });

    const kwInput = toolbar.querySelector('[data-act="keyword"]');
    let kwTimer = null;
    kwInput.addEventListener('input', (e) => {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(() => {
        state.keyword = e.target.value.trim();
        renderList();
      }, 250);
    });

    toolbar.querySelector('[data-act="new"]').addEventListener('click', () => openInspirationModal(null));
    toolbar.querySelector('[data-act="refresh"]')?.addEventListener('click', () => loadAndRender());

    toolbar.querySelector('[data-act="export"]').addEventListener('click', async () => {
      try {
        const md = await lib.exportToMarkdown();
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inspirations.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        DT().notify('已导出 inspirations.md', 'success');
      } catch (err) {
        DT().notify('导出失败：' + (err.message || err), 'error');
      }
    });

    const importInput = toolbar.querySelector('[data-act="import-input"]');
    toolbar.querySelector('[data-act="import"]').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const inserted = await lib.importFromMarkdown(text);
        DT().notify(`已导入 ${inserted.length} 条灵感`, 'success');
        await loadAndRender();
      } catch (err) {
        DT().notify('导入失败：' + (err.message || err), 'error');
      } finally {
        e.target.value = '';
      }
    });

    // ---------- 加载并渲染 ----------
    async function loadAndRender() {
      listWrap.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        let items;
        if (state.keyword) {
          items = await lib.searchInspirations(state.keyword);
        } else {
          items = await lib.listInspirations();
        }
        state.items = items || [];
        renderList();
      } catch (err) {
        console.error('[inspirations] 加载失败:', err);
        listWrap.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
        DT().notify('灵感列表加载失败', 'error');
      }
    }

    function renderList() {
      let list = state.items.slice();
      // 类型筛选
      if (state.type !== 'all') {
        list = list.filter((it) => it.type === state.type);
      }
      // 关键词筛选（已在加载时处理，但也兜底本地过滤）
      if (state.keyword) {
        const kw = state.keyword.toLowerCase();
        list = list.filter((it) =>
          (it.title || '').toLowerCase().includes(kw) ||
          (it.content || '').toLowerCase().includes(kw) ||
          (it.tags || []).some((t) => t.toLowerCase().includes(kw))
        );
      }
      if (list.length === 0) {
        listWrap.innerHTML = `
          <div class="dt-empty-state">
            <p>${state.keyword || state.type !== 'all' ? '没有匹配的灵感' : '暂无灵感，点击「+ 新建灵感」开始记录'}</p>
          </div>`;
        return;
      }
      listWrap.innerHTML = `<div class="dt-cards">${list.map(inspirationCardHTML).join('')}</div>`;

      // 绑定操作
      listWrap.querySelectorAll('[data-ins-id]').forEach((card) => {
        const id = card.getAttribute('data-ins-id');
        const item = list.find((x) => x.id === id);
        if (!item) return;
        card.querySelector('[data-act="edit"]').addEventListener('click', () => openInspirationModal(item));
        card.querySelector('[data-act="del"]').addEventListener('click', () => confirmDelete(item));
      });
    }

    function inspirationCardHTML(it) {
      const tags = (it.tags || []).map((t) => `<span class="dt-tag">${esc(t)}</span>`).join('');
      const preview = (it.content || '').replace(/[#*>`]/g, '').slice(0, 120);
      return `
        <div class="dt-card dt-inspiration-card" data-ins-id="${esc(it.id)}">
          <div class="dt-card-header">
            <h3 class="dt-card-title">${esc(it.title || '无标题')}</h3>
            <span class="dt-tag dt-tag-type">${esc(typeLabel(it.type))}</span>
          </div>
          ${preview ? `<p class="dt-card-summary">${esc(preview)}${(it.content || '').length > 120 ? '…' : ''}</p>` : ''}
          <div class="dt-card-meta">${tags}</div>
          <div class="dt-card-footer">
            <span class="dt-time">创建：${esc(fmtTime(it.createdAt))} · 更新：${esc(fmtTime(it.updatedAt))}</span>
            ${it.relatedChapter ? `<span class="dt-tag">章节 ${esc(it.relatedChapter)}</span>` : ''}
            ${it.sourceUrl ? `<a class="dt-link" href="${esc(it.sourceUrl)}" target="_blank" rel="noopener">来源 ↗</a>` : ''}
            <div class="dt-card-actions">
              <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
              <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">删除</button>
            </div>
          </div>
        </div>`;
    }

    // ---------- 新建/编辑 模态框 ----------
    function openInspirationModal(item) {
      const isEdit = !!item;
      const data = isEdit ? { ...item } : {
        type: 'idea',
        title: '',
        content: '',
        tags: [],
        sourceUrl: '',
        relatedChapter: '',
      };
      const overlay = createModal({
        title: isEdit ? '编辑灵感' : '新建灵感',
        size: 'large',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row">
              <label>类型 <span class="dt-req">*</span></label>
              <select data-field="type">
                ${TYPES.filter((t) => t.value !== 'all').map((t) =>
                  `<option value="${t.value}" ${t.value === data.type ? 'selected' : ''}>${esc(t.label)}</option>`
                ).join('')}
              </select>
            </div>
            <div class="dt-form-row">
              <label>标题 <span class="dt-req">*</span></label>
              <input type="text" data-field="title" value="${esc(data.title)}" placeholder="一句话概括" />
            </div>
            <div class="dt-form-row">
              <label>内容（Markdown）</label>
              <textarea data-field="content" rows="10" placeholder="支持 Markdown 格式">${esc(data.content)}</textarea>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>标签（逗号分隔）</label>
                <input type="text" data-field="tags" value="${esc((data.tags || []).join(', '))}" placeholder="如：修仙, 反派, 转折" />
              </div>
              <div>
                <label>关联章节</label>
                <input type="text" data-field="relatedChapter" value="${esc(data.relatedChapter || '')}" placeholder="如：vol_01/ch_001" />
              </div>
            </div>
            <div class="dt-form-row">
              <label>来源链接</label>
              <input type="text" data-field="sourceUrl" value="${esc(data.sourceUrl || '')}" placeholder="可选" />
            </div>
          </div>`,
        submitText: isEdit ? '保存' : '创建',
        onSubmit: async (formEl) => {
          const type = formEl.querySelector('[data-field="type"]').value;
          const title = formEl.querySelector('[data-field="title"]').value.trim();
          if (!title) {
            DT().notify('标题不能为空', 'warning');
            return false;
          }
          const content = formEl.querySelector('[data-field="content"]').value;
          const tagsStr = formEl.querySelector('[data-field="tags"]').value;
          const tags = tagsStr ? tagsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
          const relatedChapter = formEl.querySelector('[data-field="relatedChapter"]').value.trim();
          const sourceUrl = formEl.querySelector('[data-field="sourceUrl"]').value.trim();
          try {
            if (isEdit) {
              await lib.updateInspiration(data.id, { type, title, content, tags, relatedChapter, sourceUrl });
              DT().notify('灵感已更新', 'success');
            } else {
              await lib.addInspiration({ type, title, content, tags, relatedChapter, sourceUrl });
              DT().notify('灵感已创建', 'success');
            }
            await loadAndRender();
            return true;
          } catch (err) {
            console.error('[inspirations] 保存失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }

    // ---------- 删除确认 ----------
    function confirmDelete(item) {
      const overlay = createModal({
        title: '删除灵感',
        bodyHTML: `
          <div class="dt-confirm">
            <p class="dt-warn">⚠ 此操作不可撤销</p>
            <p>即将删除灵感「<strong>${esc(item.title || '无标题')}</strong>」。</p>
          </div>`,
        submitText: '删除',
        submitClass: 'dt-btn-danger',
        onSubmit: async () => {
          try {
            await lib.deleteInspiration(item.id);
            DT().notify('灵感已删除', 'success');
            await loadAndRender();
            return true;
          } catch (err) {
            console.error('[inspirations] 删除失败:', err);
            DT().notify('删除失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }

    // ---------- 首次加载 ----------
    await loadAndRender();
  }

  NS.renderInspirations = renderInspirations;
})(window);
