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

  /** 状态对应的样式类 */
  function statusClass(s) {
    switch (s) {
      case 'ongoing': return 'dt-tag-status-ongoing';
      case 'completed': return 'dt-tag-status-completed';
      case 'paused': return 'dt-tag-status-paused';
      default: return 'dt-tag-status-draft';
    }
  }

  /** 格式化大数字（万单位） */
  function fmtW(n) {
    const v = Number(n) || 0;
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(v);
  }

  /** 根据作品名/类型选一个封面渐变色 + 首字 */
  function buildCover(name, genre) {
    const palettes = [
      ['#667eea', '#764ba2'], // 紫蓝
      ['#f093fb', '#f5576c'], // 粉
      ['#4facfe', '#00f2fe'], // 天蓝
      ['#43e97b', '#38f9d7'], // 青绿
      ['#fa709a', '#fee140'], // 粉黄
      ['#30cfd0', '#330867'], // 蓝紫
      ['#a8edea', '#fed6e3'], // 淡粉蓝
      ['#ff9a9e', '#fecfef'], // 樱花
      ['#ffecd2', '#fcb69f'], // 暖阳
      ['#a1c4fd', '#c2e9fb'], // 清蓝
    ];
    const key = (name || genre || '书').length;
    const pal = palettes[key % palettes.length];
    const initial = (name || '书').trim().charAt(0) || '书';
    return {
      grad: `linear-gradient(135deg, ${pal[0]} 0%, ${pal[1]} 100%)`,
      initial: initial,
    };
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
      <div class="dt-toolbar-left">
        <h2 class="dt-page-title">📚 作品管理</h2>
        <span class="dt-toolbar-subtitle">创作你的下一部爆款</span>
      </div>
      <div class="dt-toolbar-actions">
        <button class="dt-btn" data-act="import" title="导入 ZIP 或 MD 文件">📂 导入</button>
        <button class="dt-btn" data-act="export" title="导出当前作品为 ZIP">⬇ 导出</button>
        <button class="dt-btn" data-act="refresh" title="刷新列表">🔄 刷新</button>
        <button class="dt-btn dt-btn-primary" data-act="new">✍️ 新建作品</button>
      </div>
      <input type="file" id="dt-projects-import-input" accept=".zip,.md,.markdown,application/zip,text/markdown" multiple hidden />
    `;
    container.appendChild(toolbar);

    // 统计条 + 搜索/筛选
    const metaBar = document.createElement('div');
    metaBar.className = 'dt-projects-meta';
    metaBar.innerHTML = `
      <div class="dt-projects-stats" id="dt-projects-stats">共 — 部作品</div>
      <div class="dt-projects-filter">
        <input type="search" class="dt-input dt-search-input" id="dt-projects-search" placeholder="🔍 搜索作品名、作者、类型…" />
      </div>
    `;
    container.appendChild(metaBar);

    // 列表容器
    const listWrap = document.createElement('div');
    listWrap.className = 'dt-projects-list';
    listWrap.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
    container.appendChild(listWrap);

    // 事件绑定
    toolbar.querySelector('[data-act="new"]').addEventListener('click', () => openProjectModal(null));
    toolbar.querySelector('[data-act="refresh"]').addEventListener('click', () => loadAndRender());
    toolbar.querySelector('[data-act="export"]').addEventListener('click', () => {
      if (typeof DT().exportVault === 'function') DT().exportVault();
    });
    const importInput = toolbar.querySelector('#dt-projects-import-input');
    toolbar.querySelector('[data-act="import"]').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0 && typeof DT().importVault === 'function') {
        DT().importVault(e.target.files);
      }
      e.target.value = '';
    });
    metaBar.querySelector('#dt-projects-search').addEventListener('input', (e) => {
      _filterKeyword = e.target.value.trim().toLowerCase();
      renderList(_lastProjects || []);
    });

    let _lastProjects = [];
    let _filterKeyword = '';

    // 首次加载
    await loadAndRender();

    // ---------- 加载并渲染列表 ----------
    async function loadAndRender() {
      listWrap.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        const projects = await DT().storage.listProjects();
        _lastProjects = projects || [];
        // 按更新时间倒序
        _lastProjects.sort((a, b) => {
          const ta = new Date(a.updated || 0).getTime();
          const tb = new Date(b.updated || 0).getTime();
          return tb - ta;
        });
        // 更新统计
        const total = _lastProjects.length;
        const ongoing = _lastProjects.filter((p) => p.status === 'ongoing').length;
        const words = _lastProjects.reduce((s, p) => s + (Number(p.current_words) || 0), 0);
        document.getElementById('dt-projects-stats').innerHTML =
          `共 <strong>${total}</strong> 部作品 · 连载中 <strong>${ongoing}</strong> 部 · 累计 <strong>${fmtW(words)}</strong> 字`;
        renderList(_lastProjects);
      } catch (err) {
        console.error('[projects] 加载失败:', err);
        listWrap.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
        DT().notify('作品列表加载失败', 'error');
      }
    }

    function renderList(projects) {
      const keyword = _filterKeyword;
      const list = keyword
        ? projects.filter((p) =>
            [p.name, p.subtitle, p.author, p.genre].join(' ').toLowerCase().includes(keyword)
          )
        : projects;

      if (!list.length) {
        if (keyword) {
          listWrap.innerHTML = `
            <div class="dt-empty-state">
              <p>🔍 没有匹配「${esc(keyword)}」的作品</p>
              <button class="dt-btn dt-btn-secondary" data-act="clear-search">清除搜索</button>
            </div>`;
          listWrap.querySelector('[data-act="clear-search"]').addEventListener('click', () => {
            const inp = document.getElementById('dt-projects-search');
            if (inp) { inp.value = ''; _filterKeyword = ''; renderList(projects); }
          });
        } else {
          listWrap.innerHTML = `
            <div class="dt-empty-state dt-empty-state-hero">
              <div class="dt-empty-illust">📖</div>
              <h3>还没有任何作品</h3>
              <p>点击右上角「新建作品」，开启你的创作之旅</p>
              <div class="dt-empty-actions">
                <button class="dt-btn dt-btn-primary dt-btn-lg" data-act="new-empty">✨ 创建第一部作品</button>
                <button class="dt-btn dt-btn-lg" data-act="demo-empty">🎬 打开示例项目</button>
              </div>
            </div>`;
          listWrap.querySelector('[data-act="new-empty"]').addEventListener('click', () => openProjectModal(null));
          listWrap.querySelector('[data-act="demo-empty"]').addEventListener('click', () => {
            if (typeof DT().renderWelcome === 'function' && DT().modules && DT().modules.models) {
              // 复用 openDemo 思路，但不破坏欢迎页流程：直接调 renderWelcome 的 openDemo 行为
              const M = DT().modules.models;
              const now = new Date().toISOString();
              const demo = new M.Project({
                id: 'demo-' + Date.now(),
                name: '示例项目：星河序曲',
                subtitle: 'DreamTale 演示 · 太空歌剧题材',
                genre: '科幻',
                author: 'DreamTale',
                target_words: 100000,
                status: 'draft',
                created_at: now,
                updated: now,
              });
              DT().storage.saveProject(demo).then(() => {
                return DT().refreshProjects ? DT().refreshProjects() : null;
              }).then(() => {
                return DT().switchProject(demo.id);
              }).then(() => loadAndRender());
            }
          });
        }
        return;
      }

      const currentId = (() => {
        const cp = DT().state.currentProject;
        return typeof cp === 'object' && cp ? cp.id : cp;
      })();

      const cards = list.map((p) => projectCardHTML(p, String(p.id) === String(currentId))).join('');
      listWrap.innerHTML = `<div class="dt-cards dt-project-cards">${cards}</div>`;

      // 绑定每张卡片事件
      listWrap.querySelectorAll('[data-project-id]').forEach((card) => {
        const id = card.getAttribute('data-project-id');
        // 卡片整体点击 = 打开
        card.addEventListener('click', (e) => {
          // 按钮点击冒泡过滤：按钮本身有 data-act 会 stopPropagation
          if (!e.target.closest('[data-act]')) switchProject(id);
        });
        const openBtn = card.querySelector('[data-act="open"]');
        if (openBtn) openBtn.addEventListener('click', (e) => { e.stopPropagation(); switchProject(id); });
        const editBtn = card.querySelector('[data-act="edit"]');
        if (editBtn) editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const proj = list.find((x) => String(x.id) === String(id));
          openProjectModal(proj);
        });
        const delBtn = card.querySelector('[data-act="delete"]');
        if (delBtn) delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const proj = list.find((x) => String(x.id) === String(id));
          confirmDelete(proj);
        });
      });
    }

    function projectCardHTML(p, isCurrent) {
      const cover = buildCover(p.name, p.genre);
      const wpct = progressPct(p.current_words, p.target_words);
      const badge = isCurrent
        ? `<span class="dt-badge dt-badge-current" title="当前正在创作">✓ 当前</span>`
        : '';
      const statusCls = statusClass(p.status);
      const subtitle = p.subtitle || '暂无简介，点击编辑添加一句话介绍～';
      return `
        <article class="dt-card dt-book-card ${isCurrent ? 'dt-card-current' : ''}" data-project-id="${esc(p.id)}">
          <!-- 左：封面（番茄/起点风格：带书脊阴影 + 首字） -->
          <div class="dt-book-cover" style="background: ${cover.grad};">
            <div class="dt-book-spine"></div>
            <div class="dt-book-cover-inner">
              <div class="dt-book-initial">${esc(cover.initial)}</div>
              <div class="dt-book-genre">${esc(p.genre || '原创')}</div>
            </div>
            ${badge}
          </div>
          <!-- 右：元信息 -->
          <div class="dt-book-body">
            <header class="dt-book-head">
              <h3 class="dt-book-title" title="${esc(p.name)}">${esc(p.name) || '未命名作品'}</h3>
              <span class="dt-tag dt-tag-status ${statusCls}">${esc(statusLabel(p.status))}</span>
            </header>
            <p class="dt-book-subtitle" title="${esc(subtitle)}">${esc(subtitle)}</p>
            <div class="dt-book-meta">
              ${p.author ? `<span class="dt-meta-item"><em>✍️</em><b>作者</b>${esc(p.author)}</span>` : ''}
              ${p.genre ? `<span class="dt-meta-item"><em>📚</em><b>类型</b>${esc(p.genre)}</span>` : ''}
              <span class="dt-meta-item"><em>📝</em><b>字数</b>${fmtW(p.current_words || 0)}${p.target_words ? ` / ${fmtW(p.target_words)}` : ''}</span>
              <span class="dt-meta-item"><em>📖</em><b>章节</b>${p.chapters_done || 0}${p.chapters_total ? ` / ${p.chapters_total}` : ''}</span>
              <span class="dt-meta-item"><em>📕</em><b>卷数</b>${p.volumes_done || 0}${p.volumes_total ? ` / ${p.volumes_total}` : ''}</span>
            </div>
            <div class="dt-book-progress">
              <div class="dt-progress-label-row">
                <span>创作进度</span>
                <span>${wpct}%</span>
              </div>
              <div class="dt-progress-bar dt-progress-bar-lg">
                <div class="dt-progress-fill" style="width:${wpct}%"></div>
              </div>
            </div>
            <footer class="dt-book-footer">
              <span class="dt-time" title="最后更新">🕘 ${esc(fmtDate(p.updated))}</span>
              <div class="dt-card-actions">
                <button class="dt-btn dt-btn-sm dt-btn-primary" data-act="open">打开</button>
                <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
                <button class="dt-btn dt-btn-sm dt-btn-ghost" data-act="delete" title="删除作品">🗑</button>
              </div>
            </footer>
          </div>
        </article>`;
    }

    // ---------- 切换当前作品 ----------
    async function switchProject(id) {
      try {
        const proj = await DT().storage.getProject(id);
        if (!proj) {
          DT().notify('作品不存在', 'error');
          return;
        }
        // 调用全局 switchProject，确保顶栏选择器、localStorage、所有视图同步刷新
        if (typeof DT().switchProject === 'function') {
          await DT().switchProject(id);
        } else {
          // 兜底：手动同步状态
          DT().state.currentProject = proj;
          DT().state.currentVol = null;
          DT().state.currentCh = null;
          try { localStorage.setItem('dreamtale:lastProject', id); } catch (e) {}
          DT().notify(`已切换到「${proj.name}」`, 'success');
        }
        // 刷新当前卡片列表高亮
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
        ? { ...(proj.toJSON ? proj.toJSON() : proj) }
        : {
            id: '',
            name: '',
            subtitle: '',
            genre: '',
            author: '',
            target_words: 1000000,
            chapters_total: 200,
            volumes_total: 5,
            status: 'draft',
            current_words: 0,
            chapters_done: 0,
            volumes_done: 0,
          };

      const overlay = createModal({
        title: isEdit ? '✏️ 编辑作品' : '✨ 新建作品',
        bodyHTML: `
          <div class="dt-project-form">
            <!-- 封面预览 -->
            <div class="dt-form-cover-preview" id="dt-form-cover"></div>
            <div class="dt-form">
              <div class="dt-form-row">
                <label>作品名称 <span class="dt-req">*</span></label>
                <input type="text" data-field="name" value="${esc(data.name)}" placeholder="如：星河序曲" maxlength="60" />
              </div>
              <div class="dt-form-row">
                <label>副标题 / 一句话简介</label>
                <input type="text" data-field="subtitle" value="${esc(data.subtitle)}" placeholder="吸引人的一句话简介，会展示在书籍卡片上" maxlength="120" />
              </div>
              <div class="dt-form-row dt-form-row-2col">
                <div>
                  <label>类型 / 题材</label>
                  <input type="text" data-field="genre" value="${esc(data.genre)}" placeholder="如：玄幻/都市/科幻/历史" list="dt-genre-list" />
                  <datalist id="dt-genre-list">
                    <option value="玄幻"></option>
                    <option value="仙侠"></option>
                    <option value="都市"></option>
                    <option value="科幻"></option>
                    <option value="历史"></option>
                    <option value="悬疑"></option>
                    <option value="言情"></option>
                    <option value="游戏"></option>
                    <option value="竞技"></option>
                    <option value="灵异"></option>
                    <option value="同人"></option>
                    <option value="轻小说"></option>
                    <option value="现实"></option>
                    <option value="军事"></option>
                    <option value="短篇"></option>
                  </datalist>
                </div>
                <div>
                  <label>作者 / 笔名</label>
                  <input type="text" data-field="author" value="${esc(data.author)}" placeholder="你的笔名" />
                </div>
              </div>
              <div class="dt-form-row dt-form-row-3col">
                <div>
                  <label>🎯 目标总字数</label>
                  <input type="number" data-field="target_words" value="${data.target_words || 0}" min="0" step="10000" />
                  <div class="dt-hint">常见：短篇 3w / 中篇 30w / 长篇 100w+</div>
                </div>
                <div>
                  <label>📖 总章节数</label>
                  <input type="number" data-field="chapters_total" value="${data.chapters_total || 0}" min="0" step="10" />
                  <div class="dt-hint">可编辑，每章约 3000-5000 字</div>
                </div>
                <div>
                  <label>📕 总卷数</label>
                  <input type="number" data-field="volumes_total" value="${data.volumes_total || 0}" min="0" step="1" />
                  <div class="dt-hint">每卷约 30-80 章</div>
                </div>
              </div>
              <div class="dt-form-row dt-form-row-3col dt-form-row-readonly">
                <div>
                  <label>已写字数</label>
                  <input type="number" data-field="current_words" value="${data.current_words || 0}" min="0" step="1000" />
                  <div class="dt-hint">当前进度（可手动同步）</div>
                </div>
                <div>
                  <label>已写章节</label>
                  <input type="number" data-field="chapters_done" value="${data.chapters_done || 0}" min="0" step="1" />
                  <div class="dt-hint">写了几章就填几</div>
                </div>
                <div>
                  <label>已写卷数</label>
                  <input type="number" data-field="volumes_done" value="${data.volumes_done || 0}" min="0" step="1" />
                  <div class="dt-hint">完成了几卷</div>
                </div>
              </div>
              <div class="dt-form-row">
                <label>作品状态</label>
                <select data-field="status">
                  <option value="draft" ${data.status === 'draft' ? 'selected' : ''}>📝 草稿（未公开）</option>
                  <option value="ongoing" ${data.status === 'ongoing' ? 'selected' : ''}>🔥 连载中（稳定更新）</option>
                  <option value="paused" ${data.status === 'paused' ? 'selected' : ''}>⏸ 暂停（暂时停更）</option>
                  <option value="completed" ${data.status === 'completed' ? 'selected' : ''}>✅ 已完结（完本）</option>
                </select>
              </div>
            </div>
          </div>`,
        submitText: isEdit ? '💾 保存修改' : '🚀 创建作品',
        onMount: (bodyEl) => {
          // 实时封面预览 + 名字变化时刷新
          const nameEl = bodyEl.querySelector('[data-field="name"]');
          const genreEl = bodyEl.querySelector('[data-field="genre"]');
          const coverEl = bodyEl.querySelector('#dt-form-cover');
          function refreshCover() {
            const n = nameEl.value || '书';
            const g = genreEl.value || '';
            const cv = buildCover(n, g);
            coverEl.setAttribute('style', `background: ${cv.grad};`);
            coverEl.innerHTML = `<div class="dt-form-cover-initial">${esc(n.trim().charAt(0) || '书')}</div><div class="dt-form-cover-genre">${esc(g || '原创')}</div>`;
          }
          nameEl.addEventListener('input', refreshCover);
          genreEl.addEventListener('input', refreshCover);
          refreshCover();
        },
        onSubmit: async (formEl) => {
          const name = formEl.querySelector('[data-field="name"]').value.trim();
          if (!name) {
            DT().notify('作品名称不能为空', 'warning');
            return false;
          }
          const num = (sel) => Number(formEl.querySelector(sel).value) || 0;
          const payload = {
            id: isEdit ? data.id : genProjectId(),
            name: name,
            subtitle: formEl.querySelector('[data-field="subtitle"]').value.trim(),
            genre: formEl.querySelector('[data-field="genre"]').value.trim(),
            author: formEl.querySelector('[data-field="author"]').value.trim(),
            target_words: num('[data-field="target_words"]'),
            chapters_total: num('[data-field="chapters_total"]'),
            volumes_total: num('[data-field="volumes_total"]'),
            current_words: num('[data-field="current_words"]'),
            chapters_done: num('[data-field="chapters_done"]'),
            volumes_done: num('[data-field="volumes_done"]'),
            status: formEl.querySelector('[data-field="status"]').value,
            updated: new Date().toISOString(),
            created_at: data.created_at || new Date().toISOString(),
          };
          try {
            await DT().storage.saveProject(payload);
            DT().notify(isEdit ? '作品已更新' : '作品已创建', 'success');
            if (!isEdit) {
              // 新建后自动设为当前作品
              if (typeof DT().switchProject === 'function') {
                await DT().switchProject(payload.id);
              } else {
                try {
                  const M = DT().modules && DT().modules.models;
                  DT().state.currentProject = M ? new M.Project(payload) : payload;
                } catch (e) { DT().state.currentProject = payload; }
              }
            } else {
              // 编辑：如果是当前项目，同步刷新内存对象
              const curId = typeof DT().state.currentProject === 'object' && DT().state.currentProject
                ? DT().state.currentProject.id
                : DT().state.currentProject;
              if (String(curId) === String(payload.id)) {
                try {
                  const M = DT().modules && DT().modules.models;
                  DT().state.currentProject = M ? new M.Project(payload) : payload;
                } catch (e) { /* ignore */ }
              }
              if (typeof DT().refreshProjects === 'function') await DT().refreshProjects();
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
      if (!proj) return;
      const overlay = createModal({
        title: '⚠️ 删除作品',
        bodyHTML: `
          <div class="dt-confirm">
            <p class="dt-warn">此操作不可撤销</p>
            <p>即将永久删除作品「<strong>${esc(proj.name)}</strong>」及其下所有卷、章节、伏笔、设定。</p>
            <div class="dt-confirm-stats">
              <span>📝 ${fmtW(proj.current_words || 0)} 字</span>
              <span>📖 ${proj.chapters_done || 0} 章</span>
              <span>📕 ${proj.volumes_done || 0} 卷</span>
            </div>
            <p class="dt-confirm-input">请输入作品名称 <code>${esc(proj.name)}</code> 以确认：</p>
            <input type="text" data-field="confirm-name" placeholder="输入作品名称确认删除" />
          </div>`,
        submitText: '🗑 永久删除',
        submitClass: 'dt-btn-danger',
        onSubmit: async (formEl) => {
          const input = formEl.querySelector('[data-field="confirm-name"]').value.trim();
          if (input !== proj.name) {
            DT().notify('名称不匹配，未删除', 'warning');
            return false;
          }
          try {
            await DT().storage.deleteProject(proj.id);
            const curId = typeof DT().state.currentProject === 'object' && DT().state.currentProject
              ? DT().state.currentProject.id
              : DT().state.currentProject;
            if (String(curId) === String(proj.id)) {
              DT().state.currentProject = null;
              DT().state.currentVol = null;
              DT().state.currentCh = null;
            }
            if (typeof DT().refreshProjects === 'function') await DT().refreshProjects();
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
   * @param {Object} opts { title, bodyHTML, submitText, submitClass, onSubmit, onMount }
   * @returns {HTMLElement} overlay 元素（已挂载事件，调用方 appendChild）
   */
  function createModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'dt-modal-overlay';
    overlay.innerHTML = `
      <div class="dt-modal dt-modal-large">
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
    // ESC 关闭
    function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);

    // onMount 钩子（表单实时预览等）
    if (typeof opts.onMount === 'function') {
      try { opts.onMount(body); } catch (e) { console.warn('[projects] onMount error:', e); }
    }

    overlay.querySelector('[data-act="submit"]').addEventListener('click', async () => {
      const btn = overlay.querySelector('[data-act="submit"]');
          if (btn.disabled) return;
          btn.disabled = true;
          const prevText = btn.textContent;
          btn.textContent = '处理中…';
          try {
            const ok = await opts.onSubmit(body);
            if (ok !== false) close();
          } catch (err) {
            console.error('[projects] 模态框提交异常:', err);
            DT().notify('操作失败：' + (err.message || err), 'error');
          } finally {
            btn.disabled = false;
            btn.textContent = prevText;
          }
    });

    return overlay;
  }

  // ---------- 导出 ----------

  NS.renderProjects = renderProjects;
})(window);
