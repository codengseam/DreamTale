/**
 * DreamTale · 作品管理功能模块
 *
 * 提供作品（Project）的列表/新建/编辑/删除/切换/进度展示能力。
 * 通过 window.DreamTaleFeatures.renderProjects(container) 挂载到任意容器。
 *
 * 依赖（由 app.js 全局注入）：
 *   - window.DreamTale.state          全局状态
 *   - window.DreamTale.storage        存储后端（IStorageBackend）
 *   - window.DreamTale.notify(msg, type)  通知
 *   - window.DreamTale.renderView(viewName, params)  视图切换
 *
 * 数据模型对齐 core/models.js 的 Project 类。
 */
(function (global) {
  'use strict';

  // 确保 DreamTaleFeatures 命名空间存在
  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具函数 ----------

  /** 安全获取 DreamTale 全局对象 */
  function DT() {
    if (!global.DreamTale) {
      throw new Error('[projects] window.DreamTale 未初始化');
    }
    return global.DreamTale;
  }

  /** 生成项目 id：proj_<时间戳base36>_<随机4位> */
  function genProjectId() {
    return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  /** 格式化日期：YYYY-MM-DD HH:mm */
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 转义 HTML，防止用户输入破坏 DOM */
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 计算进度百分比（0-100 整数） */
  function progressPct(done, total) {
    if (!total || total <= 0) return 0;
    const v = Math.round((done / total) * 100);
    return Math.max(0, Math.min(100, v));
  }

  /** 状态标签中文 */
  function statusLabel(s) {
    switch (s) {
      case 'draft': return '草稿';
      case 'ongoing': return '连载中';
      case 'completed': return '已完结';
      case 'paused': return '暂停';
      default: return s || '草稿';
    }
  }

  // ---------- 主渲染入口 ----------

  /**
   * 渲染作品管理视图
   * @param {HTMLElement} container
   */
  async function renderProjects(container) {
    if (!container) throw new Error('[projects] container 不能为空');
    container.innerHTML = '';

    // 顶部工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'dt-toolbar';
    toolbar.innerHTML = `
      <h2 class="dt-page-title">作品管理</h2>
      <div class="dt-toolbar-actions">
        <button class="dt-btn dt-btn-primary" data-act="new">+ 新建作品</button>
        <button class="dt-btn" data-act="refresh">刷新</button>
      </div>
    `;
    container.appendChild(toolbar);

    // 列表容器
    const listWrap = document.createElement('div');
    listWrap.className = 'dt-projects-list';
    listWrap.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
    container.appendChild(listWrap);

    // 事件绑定
    toolbar.querySelector('[data-act="new"]').addEventListener('click', () => openProjectModal(null));
    toolbar.querySelector('[data-act="refresh"]').addEventListener('click', () => loadAndRender());

    // 首次加载
    await loadAndRender();

    // ---------- 加载并渲染列表 ----------
    async function loadAndRender() {
      listWrap.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        const projects = await DT().storage.listProjects();
        renderList(projects || []);
      } catch (err) {
        console.error('[projects] 加载失败:', err);
        listWrap.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
        DT().notify('作品列表加载失败', 'error');
      }
    }

    function renderList(projects) {
      if (!projects.length) {
        listWrap.innerHTML = `
          <div class="dt-empty-state">
            <p>还没有任何作品</p>
            <button class="dt-btn dt-btn-primary" data-act="new-empty">创建第一部作品</button>
          </div>`;
        listWrap.querySelector('[data-act="new-empty"]').addEventListener('click', () => openProjectModal(null));
        return;
      }

      const currentId = DT().state.currentProject;
      const cards = projects.map((p) => projectCardHTML(p, p.id === currentId)).join('');
      listWrap.innerHTML = `<div class="dt-cards">${cards}</div>`;

      // 绑定每张卡片事件
      listWrap.querySelectorAll('[data-project-id]').forEach((card) => {
        const id = card.getAttribute('data-project-id');
        card.querySelector('[data-act="open"]').addEventListener('click', () => switchProject(id));
        card.querySelector('[data-act="edit"]').addEventListener('click', (e) => {
          e.stopPropagation();
          const proj = projects.find((x) => x.id === id);
          openProjectModal(proj);
        });
        card.querySelector('[data-act="delete"]').addEventListener('click', (e) => {
          e.stopPropagation();
          const proj = projects.find((x) => x.id === id);
          confirmDelete(proj);
        });
      });
    }

    function projectCardHTML(p, isCurrent) {
      const wpct = progressPct(p.current_words, p.target_words);
      const cpct = progressPct(p.chapters_done, p.chapters_total);
      const vpct = progressPct(p.volumes_done, p.volumes_total);
      const badge = isCurrent ? '<span class="dt-badge dt-badge-current">当前</span>' : '';
      return `
        <div class="dt-card ${isCurrent ? 'dt-card-current' : ''}" data-project-id="${esc(p.id)}">
          <div class="dt-card-header">
            <h3 class="dt-card-title">${esc(p.name) || '未命名作品'} ${badge}</h3>
            <span class="dt-tag">${esc(statusLabel(p.status))}</span>
          </div>
          ${p.subtitle ? `<p class="dt-card-subtitle">${esc(p.subtitle)}</p>` : ''}
          <div class="dt-card-meta">
            <span>类型：${esc(p.genre || '—')}</span>
            <span>作者：${esc(p.author || '—')}</span>
          </div>
          <div class="dt-progress-group">
            ${progressBar('字数', p.current_words || 0, p.target_words || 0, wpct)}
            ${progressBar('章节', p.chapters_done || 0, p.chapters_total || 0, cpct)}
            ${progressBar('卷数', p.volumes_done || 0, p.volumes_total || 0, vpct)}
          </div>
          <div class="dt-card-footer">
            <span class="dt-time">更新：${esc(fmtDate(p.updated))}</span>
            <div class="dt-card-actions">
              <button class="dt-btn dt-btn-sm" data-act="open">打开</button>
              <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
              <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="delete">删除</button>
            </div>
          </div>
        </div>`;
    }

    function progressBar(label, done, total, pct) {
      return `
        <div class="dt-progress-item">
          <div class="dt-progress-label">
            <span>${label}</span>
            <span>${done} / ${total}（${pct}%）</span>
          </div>
          <div class="dt-progress-bar"><div class="dt-progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }

    // ---------- 切换当前作品 ----------
    async function switchProject(id) {
      try {
        const proj = await DT().storage.getProject(id);
        if (!proj) {
          DT().notify('作品不存在', 'error');
          return;
        }
        DT().state.currentProject = id;
        DT().state.currentVol = null;
        DT().state.currentCh = null;
        DT().notify(`已切换到「${proj.name}」`, 'success');
        // 刷新当前视图高亮
        await loadAndRender();
      } catch (err) {
        console.error('[projects] 切换失败:', err);
        DT().notify('切换作品失败：' + (err.message || err), 'error');
      }
    }

    // ---------- 新建/编辑 模态框 ----------
    function openProjectModal(proj) {
      const isEdit = !!proj;
      const data = isEdit
        ? { ...proj }
        : {
            id: '',
            name: '',
            subtitle: '',
            genre: '',
            author: '',
            target_words: 100000,
            status: 'draft',
          };

      const overlay = createModal({
        title: isEdit ? '编辑作品' : '新建作品',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row">
              <label>作品名称 <span class="dt-req">*</span></label>
              <input type="text" data-field="name" value="${esc(data.name)}" placeholder="请输入作品名称" />
            </div>
            <div class="dt-form-row">
              <label>副标题</label>
              <input type="text" data-field="subtitle" value="${esc(data.subtitle)}" placeholder="一句话简介" />
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>类型</label>
                <input type="text" data-field="genre" value="${esc(data.genre)}" placeholder="如：玄幻/都市/科幻" list="dt-genre-list" />
                <datalist id="dt-genre-list">
                  <option value="玄幻"></option>
                  <option value="仙侠"></option>
                  <option value="都市"></option>
                  <option value="科幻"></option>
                  <option value="历史"></option>
                  <option value="悬疑"></option>
                  <option value="言情"></option>
                </datalist>
              </div>
              <div>
                <label>作者</label>
                <input type="text" data-field="author" value="${esc(data.author)}" placeholder="笔名" />
              </div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>目标字数</label>
                <input type="number" data-field="target_words" value="${data.target_words || 0}" min="0" step="1000" />
              </div>
              <div>
                <label>状态</label>
                <select data-field="status">
                  <option value="draft" ${data.status === 'draft' ? 'selected' : ''}>草稿</option>
                  <option value="ongoing" ${data.status === 'ongoing' ? 'selected' : ''}>连载中</option>
                  <option value="completed" ${data.status === 'completed' ? 'selected' : ''}>已完结</option>
                  <option value="paused" ${data.status === 'paused' ? 'selected' : ''}>暂停</option>
                </select>
              </div>
            </div>
          </div>`,
        submitText: isEdit ? '保存' : '创建',
        onSubmit: async (formEl) => {
          const name = formEl.querySelector('[data-field="name"]').value.trim();
          if (!name) {
            DT().notify('作品名称不能为空', 'warning');
            return false;
          }
          const payload = {
            id: isEdit ? data.id : genProjectId(),
            name: name,
            subtitle: formEl.querySelector('[data-field="subtitle"]').value.trim(),
            genre: formEl.querySelector('[data-field="genre"]').value.trim(),
            author: formEl.querySelector('[data-field="author"]').value.trim(),
            target_words: Number(formEl.querySelector('[data-field="target_words"]').value) || 0,
            current_words: data.current_words || 0,
            volumes_done: data.volumes_done || 0,
            volumes_total: data.volumes_total || 0,
            chapters_done: data.chapters_done || 0,
            chapters_total: data.chapters_total || 0,
            status: formEl.querySelector('[data-field="status"]').value,
            updated: new Date().toISOString(),
            created_at: data.created_at || new Date().toISOString(),
          };
          try {
            await DT().storage.saveProject(payload);
            DT().notify(isEdit ? '作品已更新' : '作品已创建', 'success');
            if (!isEdit) {
              // 新建后自动设为当前作品
              DT().state.currentProject = payload.id;
            }
            await loadAndRender();
            return true;
          } catch (err) {
            console.error('[projects] 保存失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }

    // ---------- 删除确认 ----------
    function confirmDelete(proj) {
      const overlay = createModal({
        title: '删除作品',
        bodyHTML: `
          <div class="dt-confirm">
            <p class="dt-warn">⚠ 此操作不可撤销</p>
            <p>即将删除作品「<strong>${esc(proj.name)}</strong>」及其下所有卷、章节、伏笔、设定。</p>
            <p class="dt-confirm-input">请输入作品名称 <code>${esc(proj.name)}</code> 以确认：</p>
            <input type="text" data-field="confirm-name" placeholder="输入作品名称确认" />
          </div>`,
        submitText: '永久删除',
        submitClass: 'dt-btn-danger',
        onSubmit: async (formEl) => {
          const input = formEl.querySelector('[data-field="confirm-name"]').value.trim();
          if (input !== proj.name) {
            DT().notify('名称不匹配，未删除', 'warning');
            return false;
          }
          try {
            await DT().storage.deleteProject(proj.id);
            if (DT().state.currentProject === proj.id) {
              DT().state.currentProject = null;
              DT().state.currentVol = null;
              DT().state.currentCh = null;
            }
            DT().notify('作品已删除', 'success');
            await loadAndRender();
            return true;
          } catch (err) {
            console.error('[projects] 删除失败:', err);
            DT().notify('删除失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }
  }

  // ---------- 通用模态框（本模块内部使用） ----------

  /**
   * 创建模态框
   * @param {Object} opts { title, bodyHTML, submitText, submitClass, onSubmit }
   * @returns {HTMLElement} overlay 元素（已挂载事件，调用方 appendChild）
   */
  function createModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'dt-modal-overlay';
    overlay.innerHTML = `
      <div class="dt-modal">
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

    function close() {
      overlay.remove();
    }

    overlay.querySelector('[data-act="close"]').addEventListener('click', close);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('[data-act="submit"]').addEventListener('click', async () => {
      const btn = overlay.querySelector('[data-act="submit"]');
          if (btn.disabled) return;
          btn.disabled = true;
          btn.textContent = '处理中…';
          try {
            const ok = await opts.onSubmit(body);
            if (ok !== false) close();
          } catch (err) {
            console.error('[projects] 模态框提交异常:', err);
            DT().notify('操作失败：' + (err.message || err), 'error');
          } finally {
            btn.disabled = false;
            btn.textContent = opts.submitText || '确定';
          }
    });

    return overlay;
  }

  // ---------- 导出 ----------

  NS.renderProjects = renderProjects;
})(window);
