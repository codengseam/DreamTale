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

  // 11 种网文类型模板：对应 genre-X-SLUG-vault.zip
  const GENRE_TEMPLATES = [
    { code: '01', slug: 'xuanhuan', label: '玄幻类', icon: '🗡️', hint: '斗破苍穹、遮天、完美世界' },
    { code: '02', slug: 'xiuzhen', label: '修真仙侠类', icon: '☁️', hint: '凡人修仙传、一念永恒' },
    { code: '03', slug: 'wangyou', label: '网游游戏类', icon: '🎮', hint: '全职高手、网游之近战法师' },
    { code: '04', slug: 'naodong', label: '脑洞系统无限流', icon: '🔮', hint: '诡秘之主、全球高武、无限恐怖' },
    { code: '05', slug: 'dushi', label: '都市类', icon: '🏙️', hint: '重生之都市修仙、大时代1994' },
    { code: '06', slug: 'kehuan', label: '科幻类', icon: '🚀', hint: '三体、流浪地球、间客' },
    { code: '07', slug: 'lishi', label: '历史架空类', icon: '📜', hint: '庆余年、赘婿、宰执天下' },
    { code: '08', slug: 'mori', label: '末日废土类', icon: '☢️', hint: '全球进化、末日蟑螂、第一序列' },
    { code: '09', slug: 'dianjing', label: '电竞竞技类', icon: '🏆', hint: '全职高手、电竞魔王集结营' },
    { code: '10', slug: 'nüpin', label: '女频类', icon: '💕', hint: '甄嬛传、知否、偷偷藏不住' },
    { code: '11', slug: 'zhongtian', label: '种田经营类', icon: '🌾', hint: '随身装着一口泉、放开那个女巫' },
  ];

  // 可用的示例项目：label 对应 assets/XXX.zip
  const DEMO_PROJECTS = [
    { key: 'doupo', label: '斗破苍穹·5 章示例', zip: 'assets/doupo-vault.zip',
      desc: '萧炎三年之约·5 章草稿+章纲+4 个角色完整档案（玄幻升级流标杆）' },
    { key: 'wenjian', label: '问剑长歌·示例 Demo', zip: 'assets/seed-vault.zip',
      desc: '东方玄幻·五卷总纲·42 章节奏曲线·6 角色·31 个伏笔（完整演示 Vault 结构）' },
  ];

  /** 取 base URL（用于 fetch 静态 ZIP，兼容魔搭部署在子路径的场景） */
  function baseUrl() {
    if (global.DreamTale && global.DreamTale.options && global.DreamTale.options.baseUrl) {
      return global.DreamTale.options.baseUrl.replace(/\/$/, '');
    }
    return '';
  }

  /** fetch 并返回一个静态 ZIP 的 Blob */
  async function fetchStaticZip(relPath) {
    const url = baseUrl() + '/' + relPath.replace(/^\//, '');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`下载 ZIP 失败：${url}（${r.status}）`);
    return await r.blob();
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

      // 创建方式（仅新建时展示）：blank / genre / demo
      const defaultCreateMode = 'blank';

      const overlay = createModal({
        title: isEdit ? '✏️ 编辑作品' : '✨ 新建作品',
        extraClass: 'dt-project-modal-large',
        bodyHTML: `
          <div class="dt-project-form">
            ${!isEdit ? `
            <!-- 创建方式 Tab（仅新建） -->
            <div class="dt-create-mode-tabs" id="dt-create-mode-tabs">
              <button type="button" class="dt-create-tab dt-create-tab--active" data-mode="blank">
                <span class="dt-create-tab-icon">📄</span>
                <span class="dt-create-tab-label">空白项目</span>
              </button>
              <button type="button" class="dt-create-tab" data-mode="genre">
                <span class="dt-create-tab-icon">🧩</span>
                <span class="dt-create-tab-label">从类型模板</span>
              </button>
              <button type="button" class="dt-create-tab" data-mode="demo">
                <span class="dt-create-tab-icon">🎬</span>
                <span class="dt-create-tab-label">从示例项目</span>
              </button>
            </div>

            <!-- Tab 子面板 -->
            <div class="dt-create-panel" id="dt-create-panel-blank">
              <p class="dt-create-panel-hint">从一个已包含 00-05 目录骨架 + 11 种网文类型模板库的空白项目开始，完全自定义。</p>
            </div>

            <div class="dt-create-panel dt-create-panel--hidden" id="dt-create-panel-genre">
              <div class="dt-create-panel-hint">选择一个网文类型作为起点：预置该类型的「专属设定模板 + 大纲节奏模板 + 通用 9 模块」。
                创建后类型模板文件位于 <code>07_类型模板/</code>。</div>
              <div class="dt-genre-grid">
                ${GENRE_TEMPLATES.map(g => `
                  <label class="dt-genre-card">
                    <input type="radio" name="dt-genre" value="${g.code}:${g.slug}:${g.label}" />
                    <div class="dt-genre-card-inner">
                      <div class="dt-genre-card-icon">${g.icon}</div>
                      <div class="dt-genre-card-title">${g.label}</div>
                      <div class="dt-genre-card-hint">${g.hint}</div>
                    </div>
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="dt-create-panel dt-create-panel--hidden" id="dt-create-panel-demo">
              <div class="dt-create-panel-hint">选择一个已写好的示例项目导入，作为学习模板快速上手。</div>
              <div class="dt-demo-grid">
                ${DEMO_PROJECTS.map(d => `
                  <label class="dt-demo-card">
                    <input type="radio" name="dt-demo" value="${d.key}" />
                    <div class="dt-demo-card-inner">
                      <div class="dt-demo-card-title">${d.label}</div>
                      <div class="dt-demo-card-desc">${d.desc}</div>
                    </div>
                  </label>
                `).join('')}
              </div>
            </div>
            ` : ''}

            <!-- 基础信息（编辑和新建都展示，新建非 demo 时可填） -->
            <div class="dt-project-form-divider" id="dt-project-form-divider">
              <span>作品基础信息</span>
            </div>
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
          // ------- 创建模式 Tab（仅新建） -------
          let createMode = defaultCreateMode;
          const tabsEl = bodyEl.querySelector('#dt-create-mode-tabs');
          const dividerEl = bodyEl.querySelector('#dt-project-form-divider');
          if (tabsEl) {
            tabsEl.querySelectorAll('.dt-create-tab').forEach(btn => {
              btn.addEventListener('click', () => {
                tabsEl.querySelectorAll('.dt-create-tab').forEach(b => b.classList.remove('dt-create-tab--active'));
                btn.classList.add('dt-create-tab--active');
                createMode = btn.getAttribute('data-mode');
                // 子面板显示
                ['blank', 'genre', 'demo'].forEach(m => {
                  const panel = bodyEl.querySelector(`#dt-create-panel-${m}`);
                  if (panel) {
                    if (m === createMode) panel.classList.remove('dt-create-panel--hidden');
                    else panel.classList.add('dt-create-panel--hidden');
                  }
                });
                // 从 demo 导入时，基础信息不可手动填（会被 ZIP 覆盖）
                const disabled = createMode === 'demo';
                bodyEl.querySelectorAll('.dt-form input, .dt-form select').forEach(el => {
                  if (disabled) el.setAttribute('disabled', 'disabled');
                  else el.removeAttribute('disabled');
                });
                // 选中类型时自动回填 genre 字段
                if (createMode === 'genre') {
                  const sel = bodyEl.querySelector('input[name="dt-genre"]:checked');
                  if (sel) {
                    const label = sel.value.split(':')[2] || '';
                    const genreInput = bodyEl.querySelector('[data-field="genre"]');
                    if (genreInput && !genreInput.value) genreInput.value = label;
                  }
                }
              });
            });

            // 选类型卡片时回填 genre
            bodyEl.querySelectorAll('input[name="dt-genre"]').forEach(r => {
              r.addEventListener('change', () => {
                if (r.checked) {
                  const label = r.value.split(':')[2] || '';
                  const genreInput = bodyEl.querySelector('[data-field="genre"]');
                  if (genreInput) genreInput.value = label;
                  const nameInput = bodyEl.querySelector('[data-field="name"]');
                  if (nameInput && !nameInput.value) nameInput.value = `【${label}】新建作品`;
                }
              });
            });
            // 默认选第一个类型
            const firstGenre = bodyEl.querySelector('input[name="dt-genre"]');
            if (firstGenre) firstGenre.checked = true;
            // 默认选斗破苍穹示例
            const firstDemo = bodyEl.querySelector('input[name="dt-demo"]');
            if (firstDemo) firstDemo.checked = true;
          }
          // ------- 封面预览（仅编辑/空白+genre 模式可见，demo 模式意义不大也保留） -------
          const nameEl = bodyEl.querySelector('[data-field="name"]');
          const genreEl = bodyEl.querySelector('[data-field="genre"]');
          // 动态生成封面预览
          const coverContainer = document.createElement('div');
          coverContainer.className = 'dt-form-cover-wrap';
          coverContainer.innerHTML = `
            <div class="dt-form-cover-preview" id="dt-form-cover"></div>
          `;
          const formEl = bodyEl.querySelector('.dt-project-form');
          if (formEl) formEl.insertBefore(coverContainer, (dividerEl || formEl.firstChild).nextSibling
              || formEl.firstChild);
          const coverEl = bodyEl.querySelector('#dt-form-cover');
          function refreshCover() {
            if (!coverEl || !nameEl) return;
            const n = nameEl.value || '书';
            const g = genreEl ? genreEl.value : '';
            const cv = buildCover(n, g);
            coverEl.setAttribute('style', `background: ${cv.grad};`);
            coverEl.innerHTML = `<div class="dt-form-cover-initial">${esc(n.trim().charAt(0) || '书')}</div><div class="dt-form-cover-genre">${esc(g || '原创')}</div>`;
          }
          if (nameEl) nameEl.addEventListener('input', refreshCover);
          if (genreEl) genreEl.addEventListener('input', refreshCover);
          refreshCover();

          // 保存当前 createMode 到闭包供 onSubmit 读取
          overlay._getCreateMode = () => createMode;
          overlay._getSelectedGenre = () => {
            const r = bodyEl.querySelector('input[name="dt-genre"]:checked');
            if (!r) return null;
            const [code, slug, label] = r.value.split(':');
            return { code, slug, label };
          };
          overlay._getSelectedDemo = () => {
            const r = bodyEl.querySelector('input[name="dt-demo"]:checked');
            if (!r) return null;
            return DEMO_PROJECTS.find(d => d.key === r.value) || null;
          };
        },
        onSubmit: async (formEl) => {
          const isNew = !isEdit;
          const createMode = isNew && overlay._getCreateMode ? overlay._getCreateMode() : 'edit';

          // ------- 模式 A: 从 ZIP 导入（类型模板 ZIP / Demo ZIP）-------
          if (isNew && (createMode === 'genre' || createMode === 'demo')) {
            let zipRelPath = null;
            if (createMode === 'genre') {
              const g = overlay._getSelectedGenre();
              if (!g) { DT().notify('请选择一个类型模板', 'warning'); return false; }
              zipRelPath = `assets/genre-${g.code}-${g.slug}-vault.zip`;
            } else {
              const d = overlay._getSelectedDemo();
              if (!d) { DT().notify('请选择一个示例项目', 'warning'); return false; }
              zipRelPath = d.zip;
            }
            try {
              DT().notify(`正在下载并导入：${zipRelPath} …`, 'info');
              const blob = await fetchStaticZip(zipRelPath);
              const newId = await DT().storage.importVault(blob);
              DT().notify('导入成功，正在加载…', 'success');
              // 切换到导入的项目
              if (typeof DT().switchProject === 'function') await DT().switchProject(newId);
              await loadAndRender();
              return true;
            } catch (err) {
              console.error('[projects] 导入模板 ZIP 失败:', err);
              DT().notify('导入失败：' + (err.message || err), 'error');
              return false;
            }
          }

          // ------- 模式 B: 空白项目 / 编辑：走原逻辑，先创建 project.json 再把 blank ZIP 导入覆盖 -------
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
            if (isNew) {
              // 新建空白项目：导入 blank-vault.zip（含 07_类型模板/）作为基础骨架
              DT().notify('正在创建空白项目…', 'info');
              const blob = await fetchStaticZip('assets/blank-vault.zip');
              // 先导入（含 00_控制面/project.json，其 name 为默认「新建项目」），拿到临时 ID
              const tempId = await DT().storage.importVault(blob);
              // 再用用户填写的 payload 更新 project 元数据（保留用户自定义的名称、类型等）
              const tempProj = await DT().storage.getProject(tempId);
              const merged = tempProj
                ? { ...(tempProj.toJSON ? tempProj.toJSON() : tempProj), ...payload, id: payload.id }
                : payload;
              // 删除临时 ID 对应的 project + 其下所有数据，然后以 payload.id 重新写入
              // 更简单的做法：把所有数据从 tempId 重写到 payload.id
              try {
                await _cloneProject(tempId, payload.id, merged);
                await DT().storage.deleteProject(tempId);
              } catch (_) {
                // 失败兜底：直接用 tempId，但更新名字
                await DT().storage.saveProject({ ...merged, id: tempId });
                payload.id = tempId;
              }
              DT().notify('作品已创建', 'success');
            } else {
              await DT().storage.saveProject(payload);
              DT().notify('作品已更新', 'success');
            }
            if (!isEdit || isEdit) {
              const targetId = payload.id;
              // 新建后自动设为当前作品
              if (typeof DT().switchProject === 'function') {
                await DT().switchProject(targetId);
              } else {
                try {
                  const M = DT().modules && DT().modules.models;
                  DT().state.currentProject = M ? new M.Project(payload) : payload;
                } catch (e) { DT().state.currentProject = payload; }
              }
            }
            if (isEdit) {
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

    /**
     * 把 srcId 项目下所有数据克隆为 dstId，并用 mergedProject 更新 dstId 的 Project 元数据。
     * 用于 blank 项目导入后更换 id（避免所有用户的空白项目 id 都叫 "blank-project"，会冲突）。
     */
    async function _cloneProject(srcId, dstId, mergedProject) {
      const s = DT().storage;
      if (!s) throw new Error('storage 不可用');
      const chapters = await s.listChapters(srcId);
      const hooks = await s.listHooks(srcId);
      const volumes = await s.listVolumes(srcId);
      const characters = await s.listCharacters(srcId);
      const settings = await s.listWorldSettings(srcId);
      const ency = await s.listEncyclopediaEntries(srcId);
      await s.saveProject(mergedProject);
      for (const c of chapters) await s.saveChapter(dstId, c);
      for (const h of hooks) await s.saveHook(dstId, h);
      for (const v of volumes) await s.saveVolume(dstId, v);
      // 注：saveCharacters / saveWorldSettings / saveEncyclopediaEntries 会自动做同步，不影响结果
      if (typeof s.saveCharacters === 'function' && characters.length) {
        await s.saveCharacters(dstId, characters);
      } else {
        for (const c of characters) await s.saveCharacter(dstId, c);
      }
      if (typeof s.saveWorldSettings === 'function' && settings.length) {
        await s.saveWorldSettings(dstId, settings);
      } else {
        for (const w of settings) await s.saveWorldSetting(dstId, w);
      }
      if (typeof s.saveEncyclopediaEntries === 'function' && ency.length) {
        await s.saveEncyclopediaEntries(dstId, ency);
      } else {
        for (const e of ency) await s.saveEncyclopediaEntry(dstId, e);
      }
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
