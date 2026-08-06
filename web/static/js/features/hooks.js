/**
 * DreamTale · 伏笔管理功能模块（番茄/起点读书风格）
 *
 * 核心设计：
 * - 📊 顶部统计看板：大主线钩子 + 支线钩子 双维度统计（总数/已埋/回收中/已埋坑/超期）+ 回收率进度条
 * - 🎯 大主线钩子区（core + long）：推动剧情核心走向，金色主题，视觉权重高
 * - 💧 支线钩子区（short）：实时推动观众情绪，蓝色主题，快速流动感
 * - 🪪 卡片式布局：每个钩子一张卡片，左侧主题色竖条 + 状态徽标 + 埋设章/目标回收章
 * - 🔍 点击溯源：点卡片弹层显示埋设章标题 + 原文片段预览 + 「跳转该章」按钮
 * - ⚰️ 一键埋坑：卡片右下角「埋坑」按钮 → 确认弹窗 → 状态流转为 resolved（动画）
 * - ⏰ 超期预警：目标回收章 < 当前章 且未埋坑时，红色脉冲 + 🚨 超期徽标
 *
 * 通过 window.DreamTaleFeatures.renderHooks(container) 挂载。
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 枚举 ----------
  const STATUS = ['planted', 'hinted', 'resolved', 'abandoned'];
  const SCOPE = ['short', 'long', 'core'];
  const PAYOFF = ['reveal', 'twist', 'powerup', 'emotional', 'callback'];
  const PRIORITY = ['high', 'medium', 'low'];
  const STRENGTH = ['strong', 'medium', 'weak'];
  const VALENCE = ['positive', 'negative', 'bittersweet'];

  const LABELS = {
    status: { planted: '已埋下', hinted: '回收中', resolved: '已埋坑', abandoned: '已废弃' },
    scope: { short: '支线', long: '长线', core: '大主线' },
    payoff_type: { reveal: '真相揭示', twist: '剧情反转', powerup: '能力解锁', emotional: '情感冲击', callback: '回扣前文' },
    priority: { high: '高', medium: '中', low: '低' },
    strength: { strong: '强', medium: '中', weak: '弱' },
    emotional_valence: { positive: '正向爽感', negative: '负面冲击', bittersweet: '苦甜交织', neutral: '中性' },
  };

  function label(group, val) {
    return (LABELS[group] && LABELS[group][val]) || val || '—';
  }

  // scope 是否属于大主线钩子
  function isMainLine(scope) {
    return scope === 'core' || scope === 'long';
  }

  // ---------- 工具 ----------
  function DT() {
    if (!global.DreamTale) throw new Error('[hooks] window.DreamTale 未初始化');
    return global.DreamTale;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function currentProjectId() {
    const proj = DT().state.currentProject;
    if (!proj) {
      DT().notify('请先在「作品」页选择一个作品', 'warning');
      return null;
    }
    return proj.id;
  }

  function genHookId() {
    return 'H_' + Date.now().toString(36).slice(-6) + '_' + Math.random().toString(36).slice(2, 5);
  }

  // ---------- 模态框通用 ----------
  function createModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'fq-modal-overlay';
    overlay.innerHTML = `
      <div class="fq-modal ${opts.size === 'large' ? 'fq-modal-lg' : ''} ${opts.size === 'small' ? 'fq-modal-sm' : ''}">
        ${opts.showHeader !== false ? `
        <div class="fq-modal-header">
          <h3 class="fq-modal-title">${esc(opts.title || '')}</h3>
          ${opts.showClose !== false ? `<button class="fq-modal-close" data-act="close" aria-label="关闭">×</button>` : ''}
        </div>` : ''}
        <div class="fq-modal-body">${opts.bodyHTML || ''}</div>
        ${opts.showFooter !== false ? `
        <div class="fq-modal-footer">
          ${opts.cancelText !== null ? `<button class="fq-btn fq-btn-ghost" data-act="cancel">${esc(opts.cancelText || '取消')}</button>` : ''}
          <button class="fq-btn ${opts.submitClass || 'fq-btn-primary'}" data-act="submit">${esc(opts.submitText || '确定')}</button>
        </div>` : ''}
      </div>`;
    const body = overlay.querySelector('.fq-modal-body');
    const close = () => overlay.remove();
    const c1 = overlay.querySelector('[data-act="close"]'); if (c1) c1.addEventListener('click', close);
    const c2 = overlay.querySelector('[data-act="cancel"]'); if (c2) c2.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const submitBtn = overlay.querySelector('[data-act="submit"]');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;
        const origText = submitBtn.textContent;
        submitBtn.textContent = '处理中…';
        try {
          const ok = await opts.onSubmit?.(body, close);
          if (ok !== false) close();
        } catch (err) {
          console.error('[hooks] 模态框提交异常:', err);
          DT().notify('操作失败：' + (err.message || err), 'error');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = origText;
        }
      });
    }
    document.getElementById('modal-root')?.appendChild(overlay) || document.body.appendChild(overlay);
    return overlay;
  }

  function enumOptions(group, values, selected) {
    return values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label(group, v)}</option>`).join('');
  }

  // ---------- 主渲染入口 ----------
  async function renderHooks(container) {
    if (!container) throw new Error('[hooks] container 不能为空');
    container.innerHTML = '';
    container.classList.add('fq-hooks-page');

    const pid = currentProjectId();
    if (!pid) {
      container.innerHTML = '<div class="fq-empty"><div class="fq-empty-icon">📚</div><p>请先选择一个作品</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="fq-toolbar">
        <div class="fq-toolbar-left">
          <h2 class="fq-page-title">🪝 伏笔管理台</h2>
          <span class="fq-subtitle">大主线钩子推动剧情 · 支线钩子调动情绪</span>
        </div>
        <div class="fq-toolbar-right">
          <button class="fq-btn fq-btn-primary" data-act="new" id="fq-new-hook">
            <span class="fq-btn-icon">+</span>新建伏笔
          </button>
          <button class="fq-btn fq-btn-ghost" data-act="refresh" id="fq-refresh">🔄 刷新</button>
        </div>
      </div>

      <!-- 统计看板 -->
      <div class="fq-stats" id="fq-stats"><p class="fq-empty-text">加载中…</p></div>

      <!-- 筛选条 -->
      <div class="fq-filter-bar">
        <div class="fq-filter-group">
          <span class="fq-filter-label">状态：</span>
          <button class="fq-filter-chip fq-filter-active" data-filter="all">全部</button>
          <button class="fq-filter-chip" data-filter="planted">🎣 已埋下</button>
          <button class="fq-filter-chip" data-filter="hinted">🔔 回收中</button>
          <button class="fq-filter-chip" data-filter="resolved">✅ 已埋坑</button>
          <button class="fq-filter-chip" data-filter="abandoned">🚫 已废弃</button>
        </div>
        <div class="fq-filter-group">
          <button class="fq-filter-chip fq-chip-urgent" data-filter="overdue">🚨 超期未收</button>
          <button class="fq-filter-chip fq-chip-soon" data-filter="soon">⏱ 临近回收</button>
        </div>
      </div>

      <!-- 大主线钩子区 -->
      <div class="fq-section fq-section-mainline">
        <div class="fq-section-head">
          <div class="fq-section-title">
            <span class="fq-section-badge fq-badge-mainline">🎯 大主线</span>
            <span class="fq-section-desc">核心剧情推动器，long 跨卷 + core 全书级</span>
          </div>
          <span class="fq-section-count" id="fq-mainline-count">0 个</span>
        </div>
        <div class="fq-card-grid" id="fq-mainline-grid"></div>
      </div>

      <!-- 支线钩子区 -->
      <div class="fq-section fq-section-sideline">
        <div class="fq-section-head">
          <div class="fq-section-title">
            <span class="fq-section-badge fq-badge-sideline">💧 支线</span>
            <span class="fq-section-desc">情绪实时调动，short 卷内回收</span>
          </div>
          <span class="fq-section-count" id="fq-sideline-count">0 个</span>
        </div>
        <div class="fq-card-grid" id="fq-sideline-grid"></div>
      </div>

      <div id="fq-empty-wrap"></div>
    `;

    let hooks = [];
    let chapters = [];
    let filter = 'all';
    let currentCh = (DT().state.currentFocusChapter) || 1;

    const statsEl = container.querySelector('#fq-stats');
    const mainGrid = container.querySelector('#fq-mainline-grid');
    const sideGrid = container.querySelector('#fq-sideline-grid');
    const mainCountEl = container.querySelector('#fq-mainline-count');
    const sideCountEl = container.querySelector('#fq-sideline-count');
    const emptyWrap = container.querySelector('#fq-empty-wrap');

    async function reload() {
      statsEl.innerHTML = '<p class="fq-empty-text">加载中…</p>';
      mainGrid.innerHTML = '<p class="fq-empty-text">加载中…</p>';
      sideGrid.innerHTML = '<p class="fq-empty-text">加载中…</p>';
      try {
        [hooks, chapters] = await Promise.all([
          DT().storage.listHooks(pid),
          DT().storage.listChapters(pid),
        ]);
        hooks = hooks || [];
        chapters = chapters || [];
        const maxCh = chapters.reduce((m, c) => Math.max(m, Number(c.ch_no) || 0), 0);
        if (maxCh > 0) currentCh = Math.max(currentCh, maxCh);
        renderStats();
        renderGrids();
      } catch (err) {
        console.error('[hooks] 加载失败:', err);
        statsEl.innerHTML = `<p class="fq-empty-text fq-error">加载失败：${esc(err.message || err)}</p>`;
        DT().notify('伏笔列表加载失败', 'error');
      }
    }

    // 超期 / 将到期
    function getStatusEx(h) {
      if (h.status === 'resolved' || h.status === 'abandoned') return { overdue: false, soon: false };
      const target = Number(h.target_resolve_ch) || 0;
      if (!target) return { overdue: false, soon: false };
      const diff = target - currentCh;
      return {
        overdue: currentCh > target,
        soon: (diff >= -3 && diff <= 3 && currentCh <= target),
      };
    }

    // ---------- 统计看板 ----------
    function renderStats() {
      // 大主线（core + long）/ 支线（short）分别统计
      const group = { main: [], side: [] };
      hooks.forEach((h) => (isMainLine(h.scope) ? group.main : group.side).push(h));

      const mk = (arr) => {
        const c = { total: arr.length, planted: 0, hinted: 0, resolved: 0, abandoned: 0, overdue: 0, soon: 0 };
        arr.forEach((h) => {
          if (STATUS.includes(h.status)) c[h.status]++;
          const ex = getStatusEx(h);
          if (ex.overdue) c.overdue++;
          if (ex.soon) c.soon++;
        });
        c.rate = c.total ? Math.round(c.resolved / c.total * 100) : 0;
        return c;
      };
      const m = mk(group.main);
      const s = mk(group.side);
      const all = {
        total: hooks.length,
        resolved: m.resolved + s.resolved,
        rate: hooks.length ? Math.round((m.resolved + s.resolved) / hooks.length * 100) : 0,
        overdue: m.overdue + s.overdue,
      };

      statsEl.innerHTML = `
        <!-- 顶部大卡：总体回收率 -->
        <div class="fq-hero-stat">
          <div class="fq-hero-left">
            <div class="fq-hero-label">📈 总体回收率</div>
            <div class="fq-hero-value">${all.rate}<span class="fq-hero-unit">%</span></div>
            <div class="fq-hero-sub">已埋坑 ${all.resolved} / 总伏笔 ${all.total}</div>
          </div>
          <div class="fq-hero-right">
            <div class="fq-hero-ratebar">
              <div class="fq-ratebar-fill" style="width:${all.rate}%;"></div>
            </div>
            <div class="fq-hero-warns">
              ${all.overdue > 0 ? `<span class="fq-warn-chip fq-warn-red">🚨 ${all.overdue} 个超期未收</span>` : ''}
              ${m.soon + s.soon > 0 ? `<span class="fq-warn-chip fq-warn-orange">⏱ ${m.soon + s.soon} 个临近回收</span>` : ''}
            </div>
          </div>
        </div>
        <!-- 双维度小卡 -->
        <div class="fq-stat-grid">
          ${statCard('mainline', '🎯 大主线钩子', m, '推动核心剧情走向')}
          ${statCard('sideline', '💧 支线钩子', s, '实时调动读者情绪')}
        </div>`;
    }

    function statCard(type, title, c, desc) {
      return `
        <div class="fq-stat-card fq-stat-${type}">
          <div class="fq-stat-head">
            <div class="fq-stat-title">${title}</div>
            <div class="fq-stat-rate">回收率 ${c.rate}%</div>
          </div>
          <div class="fq-stat-body">
            <div class="fq-stat-num fq-num-total">
              <b>${c.total}</b><span>总数</span>
            </div>
            <div class="fq-stat-num fq-num-planted">
              <b>${c.planted}</b><span>已埋下</span>
            </div>
            <div class="fq-stat-num fq-num-hinted">
              <b>${c.hinted}</b><span>回收中</span>
            </div>
            <div class="fq-stat-num fq-num-resolved">
              <b>${c.resolved}</b><span>已埋坑</span>
            </div>
          </div>
          <div class="fq-stat-bar">
            <div class="fq-stat-bar-fill" style="width:${c.rate}%;"></div>
          </div>
          <div class="fq-stat-foot">
            <span>${desc}</span>
            <span>
              ${c.overdue ? `<b class="fq-text-red">🚨${c.overdue}超期</b>` : ''}
              ${c.soon ? `<b class="fq-text-orange">⏱${c.soon}临近</b>` : ''}
            </span>
          </div>
        </div>`;
    }

    // ---------- 过滤 ----------
    function getFiltered(arr) {
      if (filter === 'overdue') return arr.filter((h) => getStatusEx(h).overdue);
      if (filter === 'soon') return arr.filter((h) => getStatusEx(h).soon);
      if (filter !== 'all') return arr.filter((h) => h.status === filter);
      return arr;
    }

    // ---------- 卡片渲染 ----------
    function renderGrids() {
      const mainArr = getFiltered(hooks.filter((h) => isMainLine(h.scope)));
      const sideArr = getFiltered(hooks.filter((h) => !isMainLine(h.scope)));

      mainCountEl.textContent = `${mainArr.length} 个`;
      sideCountEl.textContent = `${sideArr.length} 个`;

      mainGrid.innerHTML = mainArr.length ? '' : emptyCards('当前筛选下暂无大主线钩子', '🎯');
      sideGrid.innerHTML = sideArr.length ? '' : emptyCards('当前筛选下暂无支线钩子', '💧');

      if (!mainArr.length && !sideArr.length && filter === 'all' && !hooks.length) {
        emptyWrap.innerHTML = `
          <div class="fq-empty">
            <div class="fq-empty-icon">🪝</div>
            <div class="fq-empty-title">还没有埋下任何伏笔</div>
            <div class="fq-empty-desc">点击右上角「新建伏笔」开始埋设第一个钩子，推动剧情与情绪！</div>
          </div>`;
      } else {
        emptyWrap.innerHTML = '';
      }

      const priOrder = { high: 0, medium: 1, low: 2 };
      const sortedMain = [...mainArr].sort((a, b) => {
        const pa = priOrder[a.priority] ?? 1; const pb = priOrder[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.planted_ch || 0) - (b.planted_ch || 0);
      });
      const sortedSide = [...sideArr].sort((a, b) => {
        const pa = priOrder[a.priority] ?? 1; const pb = priOrder[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.planted_ch || 0) - (b.planted_ch || 0);
      });

      sortedMain.forEach((h) => mainGrid.appendChild(hookCardEl(h, 'main')));
      sortedSide.forEach((h) => sideGrid.appendChild(hookCardEl(h, 'side')));
    }

    function emptyCards(text, icon) {
      return `<div class="fq-empty-cards"><div class="fq-empty-cards-icon">${icon}</div><div class="fq-empty-cards-text">${text}</div></div>`;
    }

    // 创建卡片 DOM（方便绑定事件）
    function hookCardEl(h, lineType) {
      const el = document.createElement('div');
      const ex = getStatusEx(h);
      const resolved = h.status === 'resolved';
      const abandoned = h.status === 'abandoned';
      const statusClass = 'fq-status-' + (h.status || 'planted');
      const lineClass = lineType === 'main' ? 'fq-card-mainline' : 'fq-card-sideline';
      const cls = [
        'fq-hook-card', lineClass, statusClass,
        ex.overdue ? 'fq-card-overdue' : '',
        ex.soon ? 'fq-card-soon' : '',
        resolved ? 'fq-card-resolved' : '',
        abandoned ? 'fq-card-abandoned' : '',
      ].filter(Boolean).join(' ');

      // 优先级标签样式
      const priMap = {
        high: '<span class="fq-pri fq-pri-high">P0 · 高</span>',
        medium: '<span class="fq-pri fq-pri-mid">P1 · 中</span>',
        low: '<span class="fq-pri fq-pri-low">P2 · 低</span>',
      };
      const priHTML = priMap[h.priority] || '';

      // 超期/临近徽标
      let urgentBadge = '';
      if (ex.overdue) urgentBadge = '<span class="fq-badge fq-badge-overdue">🚨 超期</span>';
      else if (ex.soon) urgentBadge = '<span class="fq-badge fq-badge-soon">⏱ 临近</span>';

      // 埋坑按钮
      let actionBtn = '';
      if (resolved) {
        actionBtn = `<button class="fq-card-action fq-action-done" disabled>✓ 已埋坑</button>`;
      } else if (abandoned) {
        actionBtn = `<button class="fq-card-action fq-action-revive" data-act="revive">↺ 恢复</button>`;
      } else {
        actionBtn = `<button class="fq-card-action fq-action-resolve" data-act="resolve">⚰️ 埋坑</button>`;
      }

      // 兑现类型
      const payoffBadge = h.payoff_type
        ? `<span class="fq-badge fq-badge-payoff fq-payoff-${h.payoff_type}">${label('payoff_type', h.payoff_type)}</span>` : '';

      // 角色（最多显示 2 个）
      const relCh = (h.related_characters || []).slice(0, 2).map((c) => esc(c)).join(' · ');

      el.className = cls;
      el.dataset.hookId = h.hook_id;
      el.innerHTML = `
        <!-- 左侧主题色条 -->
        <div class="fq-card-accent"></div>
        <!-- 卡片主体 -->
        <div class="fq-card-main">
          <!-- 头部：ID + 状态 + 优先级 -->
          <div class="fq-card-top">
            <div class="fq-card-id"><code>${esc(h.hook_id)}</code></div>
            <div class="fq-card-statuses">
              ${urgentBadge}
              <span class="fq-status-chip ${statusClass}">${label('status', h.status)}</span>
            </div>
          </div>
          <!-- 描述 -->
          <div class="fq-card-desc" title="${esc(h.description || '')}">${esc(h.description || '（无描述）')}</div>
          <!-- 元信息 row -->
          <div class="fq-card-meta">
            <div class="fq-meta-item" title="埋设章">
              <span class="fq-meta-icon">📥</span>
              <span>第 ${esc(h.planted_ch || '?')} 章埋下</span>
            </div>
            <div class="fq-meta-item ${ex.overdue ? 'fq-meta-overdue' : ''}" title="目标回收章">
              <span class="fq-meta-icon">🎯</span>
              <span>目标第 ${esc(h.target_resolve_ch || '?')} 章</span>
            </div>
          </div>
          <!-- 徽章 row -->
          <div class="fq-card-tags">
            ${priHTML}
            ${payoffBadge}
            ${relCh ? `<span class="fq-badge fq-badge-char">👤 ${esc(relCh)}</span>` : ''}
            ${h.strength ? `<span class="fq-badge fq-badge-strength">💪 ${label('strength', h.strength)}伏</span>` : ''}
          </div>
          <!-- 底部操作 -->
          <div class="fq-card-bottom">
            <button class="fq-card-trace" data-act="trace" title="查看埋设章原文">
              <span>🔍 溯源埋设章</span>
            </button>
            <div class="fq-card-actions">
              <button class="fq-card-action fq-action-edit" data-act="edit" title="编辑">✏️</button>
              ${!resolved && !abandoned ? `<button class="fq-card-action fq-action-hint" data-act="hint" title="流转为「回收中」">🔔</button>` : ''}
              ${actionBtn}
            </div>
          </div>
        </div>
      `;

      // 绑定事件
      el.querySelector('[data-act="trace"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openTraceModal(h);
      });
      el.querySelector('[data-act="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openHookModal(h);
      });
      const hintBtn = el.querySelector('[data-act="hint"]');
      if (hintBtn) hintBtn.addEventListener('click', (e) => { e.stopPropagation(); flowStatus(h, 'hinted'); });
      const resolveBtn = el.querySelector('[data-act="resolve"]');
      if (resolveBtn) resolveBtn.addEventListener('click', (e) => { e.stopPropagation(); confirmResolve(h); });
      const reviveBtn = el.querySelector('[data-act="revive"]');
      if (reviveBtn) reviveBtn.addEventListener('click', (e) => { e.stopPropagation(); changeStatus(h, 'planted'); });
      // 整个卡片点击 = 溯源
      el.addEventListener('click', () => openTraceModal(h));
      // 悬停动画
      el.style.cursor = 'pointer';

      return el;
    }

    // ---------- 溯源：埋设章原文 ----------
    function openTraceModal(h) {
      const plantedNo = Number(h.planted_ch) || 0;
      // 查找章数据
      const planted = chapters.find((c) => String(c.ch_no).padStart(3, '0') === String(plantedNo).padStart(3, '0')
        || Number(c.ch_no) === plantedNo);
      // 同时找目标回收章（若已写）
      const targetNo = Number(h.target_resolve_ch) || 0;
      const target = targetNo ? chapters.find((c) => Number(c.ch_no) === targetNo) : null;

      const excerpt = (content, len = 240) => {
        if (!content) return '（该章无正文内容，可能还未开始写）';
        const clean = String(content).replace(/\s+/g, ' ').trim();
        if (clean.length <= len) return clean;
        return clean.slice(0, len) + '…';
      };

      const plantedSummary = planted ? `
        <div class="fq-trace-block">
          <div class="fq-trace-head fq-trace-head-plant">
            <span class="fq-trace-label">📥 埋设章</span>
            <span class="fq-trace-ch">第 ${plantedNo} 章 · ${esc(planted.title || '（无标题）')}</span>
          </div>
          <div class="fq-trace-body">
            <div class="fq-trace-excerpt">${esc(excerpt(planted.content))}</div>
            <div class="fq-trace-note">
              ${planted.summary ? `<div><b>本章提要：</b>${esc(planted.summary)}</div>` : ''}
              ${(planted.highlights && planted.highlights.length)
                ? `<div><b>本章亮点：</b>${esc(planted.highlights.join('、'))}</div>` : ''}
            </div>
          </div>
          <div class="fq-trace-actions">
            <button class="fq-btn fq-btn-ghost" id="fq-go-planted">📖 跳转阅读本章</button>
          </div>
        </div>` : `
        <div class="fq-trace-block fq-trace-empty">
          <div class="fq-trace-head fq-trace-head-plant">
            <span class="fq-trace-label">📥 埋设章</span>
            <span class="fq-trace-ch">第 ${plantedNo || '?'} 章</span>
          </div>
          <div class="fq-trace-body fq-trace-body-empty">
            该章尚未创建或还未写入正文，等你动笔埋下这个钩子～
          </div>
        </div>`;

      const targetBlock = target ? `
        <div class="fq-trace-block">
          <div class="fq-trace-head fq-trace-head-target">
            <span class="fq-trace-label">🎯 目标回收章</span>
            <span class="fq-trace-ch">第 ${targetNo} 章 · ${esc(target.title || '（无标题）')}</span>
          </div>
          <div class="fq-trace-body">
            <div class="fq-trace-excerpt">${esc(excerpt(target.content))}</div>
          </div>
          <div class="fq-trace-actions">
            <button class="fq-btn fq-btn-ghost" id="fq-go-target">📖 跳转阅读本章</button>
          </div>
        </div>` : (targetNo ? `
        <div class="fq-trace-block fq-trace-empty">
          <div class="fq-trace-head fq-trace-head-target">
            <span class="fq-trace-label">🎯 目标回收章</span>
            <span class="fq-trace-ch">第 ${targetNo} 章</span>
          </div>
          <div class="fq-trace-body fq-trace-body-empty">
            该章尚未创建，是未来的回收目标。
          </div>
        </div>` : '');

      const reminderBlock = (h.reminder_chapters && h.reminder_chapters.length) ? `
        <div class="fq-trace-block">
          <div class="fq-trace-head fq-trace-head-hint">
            <span class="fq-trace-label">🔔 已提示过的章（${h.reminder_chapters.length} 次）</span>
          </div>
          <div class="fq-trace-body">
            <div class="fq-reminder-list">
              ${h.reminder_chapters.map((ch) => `<span class="fq-reminder-chip">第 ${ch} 章</span>`).join('')}
            </div>
          </div>
        </div>` : '';

      createModal({
        title: `🔍 伏笔溯源 · ${h.hook_id}`,
        size: 'large',
        showFooter: false,
        bodyHTML: `
          <div class="fq-trace-wrap">
            <!-- 左侧：伏笔卡片信息 -->
            <div class="fq-trace-left">
              <div class="fq-trace-hook-card">
                <div class="fq-trace-hook-title">${esc(h.description || '（无描述）')}</div>
                <div class="fq-trace-hook-info">
                  <div><b>类型：</b>${label('scope', h.scope)}（${isMainLine(h.scope) ? '大主线' : '支线'}）</div>
                  <div><b>状态：</b>${label('status', h.status)}</div>
                  <div><b>优先级：</b>${label('priority', h.priority)}</div>
                  <div><b>兑现：</b>${label('payoff_type', h.payoff_type)} · ${label('strength', h.strength)}伏</div>
                  <div><b>情感：</b>${label('emotional_valence', h.emotional_valence)}</div>
                  ${h.related_characters?.length ? `<div><b>角色：</b>${esc(h.related_characters.join('、'))}</div>` : ''}
                  ${h.resolution_note ? `<div><b>埋坑说明：</b>${esc(h.resolution_note)}</div>` : ''}
                </div>
              </div>
              ${h.dependencies?.length ? `
              <div class="fq-trace-hook-deps">
                <div class="fq-trace-deps-title">🔗 依赖伏笔</div>
                <div class="fq-trace-deps-list">
                  ${h.dependencies.map((d) => `<span class="fq-dep-chip">${esc(d)}</span>`).join('')}
                </div>
              </div>` : ''}
            </div>
            <!-- 右侧：原文与时间线 -->
            <div class="fq-trace-right">
              ${plantedSummary}
              ${reminderBlock}
              ${targetBlock}
            </div>
          </div>`,
        onSubmit: null,
      });

      setTimeout(() => {
        document.getElementById('fq-go-planted')?.addEventListener('click', () => {
          if (!plantedNo) { DT().notify('埋设章号未设置', 'warning'); return; }
          gotoChapter(plantedNo, h);
        });
        document.getElementById('fq-go-target')?.addEventListener('click', () => {
          if (!targetNo) { DT().notify('目标回收章号未设置', 'warning'); return; }
          gotoChapter(targetNo, h);
        });
      }, 50);
    }

    function gotoChapter(chNo, hook) {
      try {
        const nav = global.DreamTaleNav || DT().router;
        if (nav?.navigate) nav.navigate('#/reader?ch=' + chNo);
        // 同时尝试切到章节/阅读视图
        if (DT().renderView) {
          try { DT().renderView('reader', { ch_no: chNo, highlight_hook: hook?.hook_id }); } catch (_) {}
        }
      } catch (e) { /* ignore */ }
      DT().notify(`📖 正在跳转到第 ${chNo} 章…（hook: ${hook?.hook_id || ''}）`, 'info', 2500);
    }

    // ---------- 埋坑确认 ----------
    function confirmResolve(h) {
      createModal({
        title: '⚰️ 确认埋坑？',
        size: 'small',
        submitClass: 'fq-btn-resolve',
        submitText: '确认埋坑',
        cancelText: '再想想',
        bodyHTML: `
          <div class="fq-resolve-wrap">
            <div class="fq-resolve-icon">🪦</div>
            <div class="fq-resolve-title">要把这个伏笔收了吗？</div>
            <div class="fq-resolve-hook">
              <code>${esc(h.hook_id)}</code>
              <p>${esc(h.description || '')}</p>
            </div>
            <div class="fq-resolve-form">
              <label class="fq-resolve-label">埋坑说明（可选）</label>
              <textarea id="fq-resolve-note" rows="2" placeholder="例：于第 ${h.target_resolve_ch || currentCh} 章揭穿真相，读者大感意外。">${esc(h.resolution_note || `于第 ${h.target_resolve_ch || currentCh} 章回收`)}</textarea>
            </div>
            <div class="fq-resolve-tip">💡 埋坑后状态将变为「已埋坑」，卡片会打勾变灰。想反悔？点卡片上的「编辑」重新改状态。</div>
          </div>`,
        onSubmit: async (body) => {
          const note = body.querySelector('#fq-resolve-note')?.value?.trim() || h.resolution_note;
          const payload = { ...h, status: 'resolved', resolution_note: note };
          await DT().storage.saveHook(pid, payload);
          DT().notify(`🎉 伏笔「${h.hook_id}」已埋坑！`, 'success');
          await reload();
          return true;
        },
      });
    }

    // ---------- 状态流转 ----------
    async function flowStatus(hook, toStatus) {
      if (!STATUS.includes(toStatus) || hook.status === toStatus) return;
      await changeStatus(hook, toStatus);
    }

    async function changeStatus(hook, newStatus) {
      if (!STATUS.includes(newStatus)) return;
      const payload = { ...hook, status: newStatus };
      if (newStatus === 'resolved' && !payload.resolution_note) {
        payload.resolution_note = `于第 ${hook.target_resolve_ch || currentCh} 章回收`;
      }
      try {
        await DT().storage.saveHook(pid, payload);
        DT().notify(`伏笔「${hook.hook_id}」→「${label('status', newStatus)}」`, 'success');
        await reload();
      } catch (err) {
        console.error('[hooks] 状态更新失败:', err);
        DT().notify('状态更新失败：' + (err.message || err), 'error');
      }
    }

    // ---------- 新建/编辑模态框 ----------
    function openHookModal(hook) {
      const isEdit = !!hook;
      const data = isEdit ? { ...hook } : {
        hook_id: genHookId(), description: '', status: 'planted', planted_ch: currentCh || 0,
        target_resolve_ch: (currentCh || 0) + 5, scope: 'short', payoff_type: 'reveal',
        priority: 'medium', strength: 'medium', expected_resolve_vol: 0,
        related_characters: [], emotional_valence: 'neutral', dependencies: [],
        resolution_note: '', reminder_chapters: [],
      };

      createModal({
        title: isEdit ? '✏️ 编辑伏笔' : '🪝 新建伏笔',
        size: 'large',
        submitText: isEdit ? '保存' : '埋下伏笔',
        bodyHTML: `
          <div class="fq-form">
            <div class="fq-form-row fq-form-2col">
              <div>
                <label class="fq-label">Hook ID <span class="fq-req">*</span></label>
                <input type="text" class="fq-input" data-field="hook_id" value="${esc(data.hook_id)}" ${isEdit ? 'readonly' : ''} />
              </div>
              <div>
                <label class="fq-label">钩子范围（决定它属于大主线还是支线）</label>
                <select class="fq-input" data-field="scope">
                  ${enumOptions('scope', SCOPE, data.scope)}
                </select>
                <div class="fq-form-hint">
                  <b style="color:var(--fq-mainline);">core/long = 🎯大主线</b>
                  ，<b style="color:var(--fq-sideline);">short = 💧支线</b>
                </div>
              </div>
            </div>
            <div class="fq-form-row">
              <label class="fq-label">伏笔描述 <span class="fq-req">*</span></label>
              <textarea class="fq-input" data-field="description" rows="3"
                placeholder="例：第1章主角左臂胎记，实为上古魔族封印，30章破封反转身份。">${esc(data.description)}</textarea>
            </div>
            <div class="fq-form-row fq-form-2col">
              <div>
                <label class="fq-label">埋设章 <span class="fq-req">*</span></label>
                <input type="number" class="fq-input" data-field="planted_ch" value="${data.planted_ch || 0}" min="0" />
              </div>
              <div>
                <label class="fq-label">目标回收章 <span class="fq-req">*</span></label>
                <input type="number" class="fq-input" data-field="target_resolve_ch" value="${data.target_resolve_ch || 0}" min="0" />
              </div>
            </div>
            <div class="fq-form-row fq-form-3col">
              <div>
                <label class="fq-label">状态</label>
                <select class="fq-input" data-field="status">${enumOptions('status', STATUS, data.status)}</select>
              </div>
              <div>
                <label class="fq-label">优先级</label>
                <select class="fq-input" data-field="priority">${enumOptions('priority', PRIORITY, data.priority)}</select>
              </div>
              <div>
                <label class="fq-label">强度</label>
                <select class="fq-input" data-field="strength">${enumOptions('strength', STRENGTH, data.strength)}</select>
              </div>
            </div>
            <div class="fq-form-row fq-form-3col">
              <div>
                <label class="fq-label">兑现类型</label>
                <select class="fq-input" data-field="payoff_type">${enumOptions('payoff_type', PAYOFF, data.payoff_type)}</select>
              </div>
              <div>
                <label class="fq-label">情感色彩</label>
                <select class="fq-input" data-field="emotional_valence">
                  <option value="neutral" ${data.emotional_valence === 'neutral' ? 'selected' : ''}>中性</option>
                  ${enumOptions('emotional_valence', VALENCE, data.emotional_valence)}
                </select>
              </div>
              <div>
                <label class="fq-label">预期回收卷</label>
                <input type="number" class="fq-input" data-field="expected_resolve_vol" value="${data.expected_resolve_vol || 0}" min="0" />
              </div>
            </div>
            <div class="fq-form-row fq-form-2col">
              <div>
                <label class="fq-label">关联角色（逗号分隔）</label>
                <input type="text" class="fq-input" data-field="related_characters" value="${esc((data.related_characters || []).join(', '))}" placeholder="主角, 赵师兄" />
              </div>
              <div>
                <label class="fq-label">依赖伏笔（hook_id，逗号分隔）</label>
                <input type="text" class="fq-input" data-field="dependencies" value="${esc((data.dependencies || []).join(', '))}" placeholder="H_xxx, H_yyy" />
              </div>
            </div>
            <div class="fq-form-row">
              <label class="fq-label">提示章（逗号分隔，用于回收中提醒）</label>
              <input type="text" class="fq-input" data-field="reminder_chapters" value="${esc((data.reminder_chapters || []).join(', '))}" placeholder="例：10, 20, 27" />
            </div>
            <div class="fq-form-row">
              <label class="fq-label">埋坑说明（回收时填写）</label>
              <textarea class="fq-input" data-field="resolution_note" rows="2" placeholder="回收时具体说明，可后补">${esc(data.resolution_note || '')}</textarea>
            </div>
          </div>`,
        onSubmit: async (formEl) => {
          const hookId = formEl.querySelector('[data-field="hook_id"]').value.trim();
          const description = formEl.querySelector('[data-field="description"]').value.trim();
          if (!hookId) { DT().notify('Hook ID 不能为空', 'warning'); return false; }
          if (!description) { DT().notify('伏笔描述不能为空，告诉读者你想埋什么～', 'warning'); return false; }
          const plantedCh = Number(formEl.querySelector('[data-field="planted_ch"]').value) || 0;
          const targetCh = Number(formEl.querySelector('[data-field="target_resolve_ch"]').value) || 0;
          if (targetCh > 0 && targetCh < plantedCh) {
            DT().notify('目标回收章不能早于埋设章哦', 'warning'); return false;
          }
          const reminderChapters = formEl.querySelector('[data-field="reminder_chapters"]').value
            .split(/[,，]/).map((s) => Number(s.trim())).filter((n) => n > 0);
          const payload = {
            hook_id: hookId, description,
            status: formEl.querySelector('[data-field="status"]').value,
            planted_ch: plantedCh, target_resolve_ch: targetCh,
            scope: formEl.querySelector('[data-field="scope"]').value,
            payoff_type: formEl.querySelector('[data-field="payoff_type"]').value,
            priority: formEl.querySelector('[data-field="priority"]').value,
            strength: formEl.querySelector('[data-field="strength"]').value,
            emotional_valence: formEl.querySelector('[data-field="emotional_valence"]').value,
            expected_resolve_vol: Number(formEl.querySelector('[data-field="expected_resolve_vol"]').value) || 0,
            related_characters: formEl.querySelector('[data-field="related_characters"]').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            dependencies: formEl.querySelector('[data-field="dependencies"]').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            reminder_chapters: reminderChapters,
            resolution_note: formEl.querySelector('[data-field="resolution_note"]').value.trim(),
            last_reminder_ch: data.last_reminder_ch || null,
            next_reminder_due_ch: data.next_reminder_due_ch || null,
          };
          try {
            await DT().storage.saveHook(pid, payload);
            DT().notify(isEdit ? '✅ 伏笔已更新' : '🎣 伏笔已埋下！别忘了后续回收～', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[hooks] 保存失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
    }

    // ---------- 筛选切换 ----------
    container.querySelectorAll('.fq-filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        filter = btn.getAttribute('data-filter');
        container.querySelectorAll('.fq-filter-chip').forEach((b) => b.classList.remove('fq-filter-active'));
        btn.classList.add('fq-filter-active');
        renderGrids();
      });
    });

    container.querySelector('#fq-new-hook').addEventListener('click', () => openHookModal(null));
    container.querySelector('#fq-refresh').addEventListener('click', reload);

    await reload();
  }

  NS.renderHooks = renderHooks;
})(window);
