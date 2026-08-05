/**
 * DreamTale · 伏笔管理功能模块（NovelForge 升级版）
 *
 * 功能升级：
 * - 顶部统计卡片：总伏笔/已埋/提示中/已回收/废弃 + 超期未收（红色）/将到期（橙色）/回收率
 * - 两个视图 Tab：
 *    📋 表格视图（保留原有全部功能）
 *    🪝 时间线泳道视图（新增）
 * - 泳道视图：
 *    · 每条伏笔一条泳道，左侧 hook_id/描述/状态/scope，右侧横向时间轴
 *    · 埋设→目标回收 横条（short/long/core 三色）
 *    · 提示章黄色节点、超期红脉冲高亮、将到期橙色高亮
 *    · 当前章位置垂直指示线（可手动输入定位）
 *    · 提示节点 tooltip 预览、点击泳道打开编辑
 *    · 底部时间刻度（按章号均匀分布）
 * - 超期/将到期筛选快捷筛选按钮：一键筛选
 * - 泳道点击可跳转到「章纲」某章并添加「回收伏笔」
 * - 原有表格视图：新增 scope/优先级/scope 徽章样式保留并优化
 *
 * 通过 window.DreamTaleFeatures.renderHooks(container) 挂载。
 *
 * 依赖：
 *   - window.DreamTale.state / storage / notify
 *
 * 数据模型对齐 core/models.js 的 Hook 类与 HOOK_* 枚举。
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 枚举（对齐 models.js HOOK_* 常量） ----------

  const STATUS = ['planted', 'hinted', 'resolved', 'abandoned'];
  const SCOPE = ['short', 'long', 'core'];
  const PAYOFF = ['reveal', 'twist', 'powerup', 'emotional', 'callback'];
  const PRIORITY = ['high', 'medium', 'low'];
  const STRENGTH = ['strong', 'medium', 'weak'];
  const VALENCE = ['positive', 'negative', 'bittersweet'];

  // 中文标签映射
  const LABELS = {
    status: { planted: '已埋', hinted: '提示中', resolved: '已回收', abandoned: '已废弃' },
    scope: { short: '短篇', long: '长篇', core: '核心' },
    payoff_type: { reveal: '揭示', twist: '反转', powerup: '升级', emotional: '情感', callback: '呼应' },
    priority: { high: '高', medium: '中', low: '低' },
    strength: { strong: '强', medium: '中', weak: '弱' },
    emotional_valence: { positive: '正向', negative: '负向', bittersweet: '苦甜' },
  };

  function label(group, val) {
    return (LABELS[group] && LABELS[group][val]) || val || '—';
  }

  // ---------- 工具 ----------

  function DT() {
    if (!global.DreamTale) throw new Error('[hooks] window.DreamTale 未初始化');
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
    return proj.id;
  }

  /** 生成 hook_id：H_<时间戳base36>_<随机3位> */
  function genHookId() {
    return 'H_' + Date.now().toString(36).slice(-6) + '_' + Math.random().toString(36).slice(2, 5);
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
        console.error('[hooks] 模态框提交异常:', err);
        DT().notify('操作失败：' + (err.message || err), 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = opts.submitText || '确定';
      }
    });
    return overlay;
  }

  /** 通用 select 构造器：按枚举组生成 */
  function enumOptions(group, values, selected) {
    return values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label(group, v)}</option>`).join('');
  }

  // ---------- 主渲染入口（双视图） ----------

  async function renderHooks(container) {
    if (!container) throw new Error('[hooks] container 不能为空');
    container.innerHTML = '';

    const pid = currentProjectId();
    if (!pid) {
      container.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    container.innerHTML = `
      <div class="dt-toolbar">
        <h2 class="dt-page-title">伏笔管理（含时间线泳道）</h2>
        <div class="dt-toolbar-actions">
          <button class="dt-btn dt-btn-primary" data-act="new">+ 新建伏笔</button>
          <button class="dt-btn" data-act="refresh">刷新</button>
        </div>
      </div>

      <div class="dt-tabs">
        <div class="dt-tab-bar">
          <button class="dt-tab active" data-view="table">📋 表格视图</button>
          <button class="dt-tab" data-view="swimlane">🪝 时间线泳道</button>
        </div>
      </div>

      <div class="dt-hook-stats"><p class="dt-empty-hint">加载中…</p></div>

      <div class="dt-hook-filter">
        <span class="dt-hook-filter-label">状态筛选：</span>
        <button class="dt-btn dt-btn-sm dt-filter-btn active" data-filter="all">全部</button>
        <button class="dt-btn dt-btn-sm dt-filter-btn" data-filter="planted">已埋</button>
        <button class="dt-btn dt-btn-sm dt-filter-btn" data-filter="hinted">提示中</button>
        <button class="dt-btn dt-btn-sm dt-filter-btn" data-filter="resolved">已回收</button>
        <button class="dt-btn dt-btn-sm dt-filter-btn" data-filter="abandoned">已废弃</button>
        <span style="margin-left:14px;" class="dt-hook-filter-label">紧急：</span>
        <button class="dt-btn dt-btn-sm dt-filter-btn" data-filter="overdue" style="border-color:#ef4444;color:#ef4444;">🚨 超期未收</button>
        <button class="dt-btn dt-btn-sm dt-filter-btn" data-filter="soon" style="border-color:#f97316;color:#f97316;">⏱ 将到期(±3章)</button>
      </div>

      <div class="dt-hook-view" id="dt-hook-view"><p class="dt-empty-hint">加载中…</p></div>`;

    let hooks = [];
    let chapters = [];
    let filter = 'all';
    let view = 'table';
    let currentCh = (DT().state.currentFocusChapter) || 1;

    const statsEl = container.querySelector('.dt-hook-stats');
    const viewEl = container.querySelector('#dt-hook-view');

    async function reload() {
      statsEl.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      viewEl.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        [hooks, chapters] = await Promise.all([
          DT().storage.listHooks(pid),
          DT().storage.listChapters(pid),
        ]);
        hooks = hooks || [];
        chapters = chapters || [];
        // 估算当前写作章：取最大章号
        const maxCh = chapters.reduce((m, c) => Math.max(m, Number(c.ch_no) || 0), 0);
        if (maxCh > 0) currentCh = Math.max(currentCh, maxCh);
        renderStats();
        renderView();
      } catch (err) {
        console.error('[hooks] 加载失败:', err);
        statsEl.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
        DT().notify('伏笔列表加载失败', 'error');
      }
    }

    // 超期 / 将到期 计算
    function getStatusEx(h) {
      if (h.status === 'resolved' || h.status === 'abandoned') return { overdue: false, soon: false };
      const target = Number(h.target_resolve_ch) || 0;
      if (!target) return { overdue: false, soon: false };
      const diff = target - currentCh;
      return { overdue: currentCh > target, soon: (diff >= -3 && diff <= 3 && currentCh <= target) };
    }

    function renderStats() {
      const counts = { total: hooks.length, planted: 0, hinted: 0, resolved: 0, abandoned: 0, overdue: 0, soon: 0 };
      hooks.forEach((h) => {
        if (counts[h.status] != null) counts[h.status]++;
        const ex = getStatusEx(h);
        if (ex.overdue) counts.overdue++;
        if (ex.soon) counts.soon++;
      });
      statsEl.innerHTML = `
        <div class="dt-stat-cards">
          ${statCard('总伏笔', counts.total, 'dt-stat-total')}
          ${statCard('已埋', counts.planted, 'dt-stat-planted')}
          ${statCard('提示中', counts.hinted, 'dt-stat-hinted')}
          ${statCard('已回收', counts.resolved, 'dt-stat-resolved')}
          ${statCard('已废弃', counts.abandoned, 'dt-stat-abandoned')}
          ${statCard('超期未收 ⚠', counts.overdue, 'dt-stat-overdue')}
          ${statCard('将到期 ⏱', counts.soon, 'dt-stat-soon')}
        </div>
        <div class="dt-stat-progress">
          <span>回收率</span>
          <div class="dt-progress-bar"><div class="dt-progress-fill" style="width:${counts.total ? Math.round(counts.resolved / counts.total * 100) : 0}%"></div></div>
          <span>${counts.total ? Math.round(counts.resolved / counts.total * 100) : 0}%</span>
        </div>`;
    }

    function statCard(label, num, cls) {
      return `<div class="dt-stat-card ${cls}"><div class="dt-stat-num">${num}</div><div class="dt-stat-label">${label}</div></div>`;
    }

    function renderView() {
      if (view === 'table') renderTable();
      else renderSwimlane();
    }

    // ---------- 过滤 ----------
    function getFiltered() {
      let arr = hooks;
      if (filter === 'overdue') {
        arr = hooks.filter(h => getStatusEx(h).overdue);
      } else if (filter === 'soon') {
        arr = hooks.filter(h => getStatusEx(h).soon);
      } else if (filter !== 'all') {
        arr = hooks.filter(h => h.status === filter);
      }
      return arr;
    }

    // ==================== 视图 1：表格（保留 + 升级样式） ====================

    function renderTable() {
      const filtered = getFiltered();
      if (!filtered.length) {
        viewEl.innerHTML = `
          <div class="dt-empty-state">
            <p>${filter === 'all' ? '暂无伏笔，点击「新建伏笔」开始' : '当前筛选下暂无伏笔'}</p>
          </div>`;
        return;
      }
      const priOrder = { high: 0, medium: 1, low: 2 };
      const sorted = [...filtered].sort((a, b) => {
        const pa = priOrder[a.priority] ?? 1;
        const pb = priOrder[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.planted_ch || 0) - (b.planted_ch || 0);
      });

      viewEl.innerHTML = `
        <div class="dt-hook-table-wrap">
          <table class="dt-hook-table">
            <thead>
            <tr>
              <th>hook_id</th>
              <th>描述</th>
              <th>状态</th>
              <th>紧急</th>
              <th>埋设章</th>
              <th>目标回收章</th>
              <th>范围</th>
              <th>兑现类型</th>
              <th>优先级</th>
              <th>强度</th>
              <th>操作</th>
            </tr>
            </thead>
            <tbody>
              ${sorted.map((h) => hookRowHTML(h)).join('')}
            </tbody>
          </table>
        </div>`;

      viewEl.querySelectorAll('[data-hook-id]').forEach((tr) => {
        const id = tr.getAttribute('data-hook-id');
        const hook = hooks.find((x) => x.hook_id === id);
        if (!hook) return;
        tr.querySelector('[data-act="edit"]').addEventListener('click', () => openHookModal(hook));
        tr.querySelector('[data-act="del"]').addEventListener('click', () => confirmDelete(hook));
        const flowBtn = tr.querySelector('[data-act="flow"]');
        if (flowBtn) flowBtn.addEventListener('click', () => flowStatus(hook));
        const abandonBtn = tr.querySelector('[data-act="abandon"]');
        if (abandonBtn) abandonBtn.addEventListener('click', () => changeStatus(hook, 'abandoned'));
        const reviveBtn = tr.querySelector('[data-act="revive"]');
        if (reviveBtn) reviveBtn.addEventListener('click', () => changeStatus(hook, 'planted'));
        const gotoBtn = tr.querySelector('[data-act="goto-resolve"]');
        if (gotoBtn) gotoBtn.addEventListener('click', () => gotoResolveInChapter(hook));
      });
    }

    function hookRowHTML(h) {
      const statusClass = 'dt-hook-status-' + (h.status || 'planted');
      const ex = getStatusEx(h);
      let urgentBadge = '';
      if (ex.overdue) urgentBadge = '<span class="dt-tag dt-tag-danger" style="animation:dt-pulse 1.2s infinite;">超期</span>';
      else if (ex.soon) urgentBadge = '<span class="dt-tag dt-tag-warn">将到期</span>';
      else urgentBadge = '<span class="dt-tag" style="opacity:.5;">—</span>';

      let flowBtnHTML = '';
      if (h.status === 'planted') flowBtnHTML = '<button class="dt-btn dt-btn-sm" data-act="flow">→ 提示</button>';
      else if (h.status === 'hinted') flowBtnHTML = '<button class="dt-btn dt-btn-sm dt-btn-primary" data-act="flow">→ 回收</button>';
      else if (h.status === 'resolved') flowBtnHTML = '<span class="dt-tag dt-tag-ok">✓ 已回收</span>';
      else if (h.status === 'abandoned') flowBtnHTML = '<button class="dt-btn dt-btn-sm" data-act="revive">↺ 恢复</button>';

      let abandonBtnHTML = '';
      if (h.status === 'planted' || h.status === 'hinted') {
        abandonBtnHTML = '<button class="dt-btn dt-btn-sm dt-btn-danger" data-act="abandon">废弃</button>';
      }
      const gotoResolveHTML = (h.status !== 'resolved' && h.target_resolve_ch
        ? `<button class="dt-btn dt-btn-sm" data-act="goto-resolve" title="在章纲里添加回收操作">📝 到章纲回收</button>`
        : '';

      return `
        <tr data-hook-id="${esc(h.hook_id)}" style="${ex.overdue ? 'background:rgba(239,68,68,0.05);' : (ex.soon ? 'background:rgba(249,115,22,0.04);' : ''}">
          <td class="dt-hook-id"><code>${esc(h.hook_id)}</code></td>
          <td class="dt-hook-desc" title="${esc(h.description)}">${esc(h.description || '—')}</td>
          <td><span class="dt-tag ${statusClass}">${esc(label('status', h.status))}</span></td>
          <td>${urgentBadge}</td>
          <td>${esc(h.planted_ch || '—')}</td>
          <td>${esc(h.target_resolve_ch || '—')}</td>
          <td><span class="dt-scope-tag scope-${h.scope || 'short'}">${esc(label('scope', h.scope))}</span></td>
          <td>${esc(label('payoff_type', h.payoff_type))}</td>
          <td>${esc(label('priority', h.priority))}</td>
          <td>${esc(label('strength', h.strength))}</td>
          <td class="dt-hook-actions">
            <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
            ${flowBtnHTML}
            ${gotoResolveHTML}
            ${abandonBtnHTML}
            <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">删除</button>
          </td>
        </tr>`;
    }

    // 跳转到章纲里去写回收操作（提示用户 + 切 Tab）
    function gotoResolveInChapter(h) {
      const chNo = Number(h.target_resolve_ch) || 0;
      if (!chNo) {
        DT().notify('此伏笔未填写目标回收章，先点编辑填好', 'warning');
        return;
      }
      // 切到大纲→章纲：通过调用主页面导航或提示
      try {
        const nav = global.DreamTaleNav;
        if (nav && nav.switchFeature) nav.switchFeature('outline');
      } catch (_) {}
      DT().notify(`✍️ 请在「大纲→章纲」找到第 ${chNo} 章→编辑→「🔴 回收伏笔」区，选这个 hook_id：${h.hook_id}，即可写回收`, 'info');
    }

    // ==================== 视图 2：时间线泳道 ====================

    function renderSwimlane() {
      const filtered = getFiltered();
      const totalCh = Math.max(
        ...[...(chapters.map(c => Number(c.ch_no) || 0),
            ...hooks.map(h => Number(h.target_resolve_ch) || 0),
            ...hooks.map(h => Number(h.planted_ch) || 0),
            currentCh], 1
      );

      // 泳道信息面板
      viewEl.innerHTML = `
        <div class="dt-hook-swimlane-wrap">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
            <label style="font-size:13px;color:var(--ink);">
              当前写作章：
              <input type="number" id="dt-current-ch" value="${currentCh}" min="1" max="${Math.max(1, totalCh)}" style="width:90px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-muted);color:var(--ink);" />
            </label>
            <button class="dt-btn dt-btn-sm" id="dt-redraw-swim">重绘</button>
            <span style="font-size:12px;color:var(--ink-muted);margin-left:10px;">图例：</span>
            <span class="dt-legend-item"><span class="dt-legend-bar scope-core"></span>核心</span>
            <span class="dt-legend-item"><span class="dt-legend-bar scope-long"></span>长篇</span>
            <span class="dt-legend-item"><span class="dt-legend-bar scope-short"></span>短篇</span>
            <span class="dt-legend-item"><span class="dt-legend-dot plant"></span>埋设</span>
            <span class="dt-legend-item"><span class="dt-legend-dot hint"></span>提示</span>
            <span class="dt-legend-item"><span class="dt-legend-dot resv"></span>回收</span>
            <span class="dt-legend-item" style="border-left:2px solid #3b82f6;height:16px;"></span>当前章线
          </div>
          <div id="dt-swim-body" style="overflow-x:auto;">
            ${filtered.length
              ? filtered.map(h => swimLaneHTML(h, totalCh)).join('') + ticksHTML(totalCh))
              : `<div style="padding:40px;text-align:center;color:var(--ink-muted);">
                  <div style="font-size:40px;">🪝</div>
                  <div style="margin-top:8px;">暂无伏笔（当前筛选条件下</div>
                </div>`
            }
          </div>
        </div>`;

      // 重绘按钮 + 当前章线
      const curInp = viewEl.querySelector('#dt-current-ch');
      if (curInp) {
        curInp.addEventListener('change', () => {
          const v = Number(curInp.value) || 1;
          if (v > 0) {
            currentCh = v;
            renderStats();
            renderSwimlane();
          }
        });
      }
      const rdBt = viewEl.querySelector('#dt-redraw-swim');
      if (rdBt) rdBt.addEventListener('click', () => renderSwimlane());

      // 绑定泳道点击：编辑
      viewEl.querySelectorAll('[data-swim-hook-id]').forEach((el) => {
        const id = el.getAttribute('data-swim-hook-id');
        const hook = hooks.find(x => x.hook_id === id);
        if (!hook) return;
        el.addEventListener('click', () => openHookModal(hook));
      });
    }

    function swimLaneHTML(h, totalCh) {
      const planted = Number(h.planted_ch) || 1;
      const target  = Number(h.target_resolve_ch) || Math.max(totalCh, planted + 5);
      const leftPct  = Math.max(0, ((planted - 1) / Math.max(1, totalCh)) * 100);
      const widthPct = Math.max(1.5, ((target - planted + 1) / Math.max(1, totalCh)) * 100);
      const ex = getStatusEx(h);
      let statusCls = 'status-' + (h.status || 'planted');
      let statusTxt = label('status', h.status || 'planted');
      let cls = '';
      if (ex.overdue) { statusCls = 'status-overdue'; statusTxt = '超期未收 ⚠'; cls = 'overdue-swim'; }
      else if (ex.soon) { statusCls = 'status-soon'; statusTxt = '临近回收'; cls = 'soon-swim'; }
      // 当前章位置
      const curPct = Math.min(100, Math.max(0, ((currentCh - 1) / Math.max(1, totalCh)) * 100));
      // 提示章节点
      const hintDots = (h.reminder_chapters || []).slice(0, 12).map(ch => {
        const pct = ((Number(ch) - 1) / Math.max(1, totalCh)) * 100;
        return `<div class="dt-hook-dot hint" style="left:${pct}%;" title="第${ch}章 提示"></div>`;
      }).join('');
      const relCh = (h.related_characters || []).slice(0, 3).join('/');

      // 进度条内部文字（埋设→目标）
      const scopeCls = 'scope-' + (h.scope || 'short');

      return `
        <div class="dt-hook-swimlane ${cls ? ' '+cls : ''}" data-swim-hook-id="${esc(h.hook_id)}" style="cursor:pointer;">
          <div class="dt-hook-info">
            <div class="dt-hook-head">
              <span class="dt-hook-id" title="点击编辑"><code>${esc(h.hook_id)}</code></span>
              <span class="dt-hook-status ${statusCls}">${esc(statusTxt)}</span>
              <span class="dt-scope-tag ${scopeCls}">${esc(label('scope', h.scope))}</span>
              ${h.priority ? `<span class="dt-tag dt-tag-warn" style="font-size:10px;padding:0 6px;">优先级·${esc(label('priority', h.priority))}</span>` : ''}
            </div>
            <div class="dt-hook-desc">${esc(h.description || '（无描述）')}</div>
            <div class="dt-hook-meta">
              <span>埋设 ch${planted} → 目标 ch${target}</span>
              <span>回收：${esc(label('payoff_type', h.payoff_type))}</span>
              ${relCh ? `<span>角色：${esc(relCh)}</span>` : ''}
            </div>
          </div>
          <div class="dt-hook-track" style="position:relative;">
            <div class="dt-hook-axis">
              <div class="dt-hook-bar ${scopeCls}" style="left:${leftPct}%;width:${widthPct}%;"></div>
              <div class="dt-hook-dot plant" style="left:${leftPct}%;" title="第${planted}章 埋设"></div>
              ${hintDots}
              <div class="dt-hook-dot resv" style="left:${Math.min(100, ((target-1)/Math.max(1,totalCh))*100)}%;" title="目标第${target}章 回收"></div>
              <!-- 当前章指示线 -->
              <div style="position:absolute;left:${curPct}%;top:-4px;bottom:-4px;width:2px;background:#3b82f6;z-index:5;pointer-events:none;box-shadow:0 0 4px #3b82f6aa;"></div>
              <div style="position:absolute;left:calc(${curPct}% - 18px);top:-22px;background:#3b82f6;color:#fff;font-size:10.5px;padding:1px 6px;border-radius:10px;pointer-events:none;z-index:5;">ch${currentCh}</div>
            </div>
          </div>
        </div>`;
    }

    function ticksHTML(totalCh) {
      const count = Math.min(12, totalCh);
      const arr = [];
      for (let i = 0; i < count; i++) {
        const ch = Math.round(1 + (totalCh - 1) * (i / Math.max(1, count - 1)));
        arr.push(`<span>ch${ch}</span>`);
      }
      return `<div style="display:grid;grid-template-columns:260px 1fr;gap:14px;padding:4px 4px 18px;">
          <div></div>
          <div class="dt-hook-axis-ticks">${arr.join('')}</div>
        </div>`;
    }

    // ---------- 状态流转 ----------
    async function flowStatus(hook) {
      const next = hook.status === 'planted' ? 'hinted' : (hook.status === 'hinted' ? 'resolved' : hook.status);
      if (next === hook.status) return;
      await changeStatus(hook, next);
    }

    async function changeStatus(hook, newStatus) {
      if (!STATUS.includes(newStatus)) return;
      const payload = { ...hook, status: newStatus };
      if (newStatus === 'resolved' && !payload.resolution_note) {
        payload.resolution_note = `于第 ${hook.target_resolve_ch || '?'} 章回收`;
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
        hook_id: genHookId(), description: '', status: 'planted', planted_ch: 0,
        target_resolve_ch: 0, scope: 'short', payoff_type: 'reveal',
        priority: 'medium', strength: 'medium', expected_resolve_vol: 0,
        related_characters: [], emotional_valence: 'neutral', dependencies: [],
        resolution_note: '', reminder_chapters: [],
      };

      const overlay = createModal({
        title: isEdit ? '编辑伏笔' : '新建伏笔', size: 'large',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row dt-form-row-2col">
              <div><label>hook_id <span class="dt-req">*</span></label>
                <input type="text" data-field="hook_id" value="${esc(data.hook_id)}" ${isEdit ? 'readonly' : ''} />
              </div>
              <div><label>状态</label>
                <select data-field="status">${enumOptions('status', STATUS, data.status)}</select>
              </div>
            </div>
            <div class="dt-form-row">
              <label>描述 <span class="dt-req">*</span></label>
              <textarea data-field="description" rows="3" placeholder="例：主角左臂胎记实为上古魔族封印标记，30章后破封">${esc(data.description)}</textarea>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>埋设章 <span class="dt-req">*</span></label>
                <input type="number" data-field="planted_ch" value="${data.planted_ch || 0}" min="0" />
              </div>
              <div><label>目标回收章 <span class="dt-req">*</span></label>
                <input type="number" data-field="target_resolve_ch" value="${data.target_resolve_ch || 0}" min="0" />
              </div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>范围</label>
                <select data-field="scope">${enumOptions('scope', SCOPE, data.scope)}</select>
              </div>
              <div><label>兑现类型</label>
                <select data-field="payoff_type">${enumOptions('payoff_type', PAYOFF, data.payoff_type)}</select>
              </div>
            </div>
            <div class="dt-form-row dt-form-row-3col">
              <div><label>优先级</label>
                <select data-field="priority">${enumOptions('priority', PRIORITY, data.priority)}</select>
              </div>
              <div><label>强度</label>
                <select data-field="strength">${enumOptions('strength', STRENGTH, data.strength)}</select>
              </div>
              <div><label>情感色彩</label>
                <select data-field="emotional_valence">
                  <option value="neutral" ${data.emotional_valence === 'neutral' ? 'selected' : ''}>中性</option>
                  ${enumOptions('emotional_valence', VALENCE, data.emotional_valence)}
                </select>
              </div>
            </div>
            <div class="dt-form-row">
              <label>预期回收卷</label>
              <input type="number" data-field="expected_resolve_vol" value="${data.expected_resolve_vol || 0}" min="0" />
            </div>
            <div class="dt-form-row">
              <label>关联角色（逗号分隔）</label>
              <input type="text" data-field="related_characters" value="${esc((data.related_characters || []).join(', '))}" placeholder="主角, 赵师兄" />
            </div>
            <div class="dt-form-row">
              <label>依赖伏笔（hook_id，逗号分隔）</label>
              <input type="text" data-field="dependencies" value="${esc((data.dependencies || []).join(', '))}" placeholder="H_xxx, H_yyy" />
            </div>
            <div class="dt-form-row">
              <label>提示章（逗号分隔，用于泳道黄色节点）</label>
              <input type="text" data-field="reminder_chapters" value="${esc((data.reminder_chapters || []).join(', '))}" placeholder="例：10, 20, 27" />
            </div>
            <div class="dt-form-row">
              <label>回收说明</label>
              <textarea data-field="resolution_note" rows="2" placeholder="回收时具体说明，可后补">${esc(data.resolution_note || '')}</textarea>
            </div>
          </div>`,
        submitText: isEdit ? '保存' : '创建',
        onSubmit: async (formEl) => {
          const hookId = formEl.querySelector('[data-field="hook_id"]').value.trim();
          const description = formEl.querySelector('[data-field="description"]').value.trim();
          if (!hookId) { DT().notify('hook_id 不能为空', 'warning'); return false; }
          if (!description) { DT().notify('描述不能为空', 'warning'); return false; }
          const plantedCh = Number(formEl.querySelector('[data-field="planted_ch"]').value) || 0;
          const targetCh = Number(formEl.querySelector('[data-field="target_resolve_ch"]').value) || 0;
          if (targetCh > 0 && targetCh < plantedCh) {
            DT().notify('目标回收章不能早于埋设章', 'warning'); return false;
          }
          const reminderChapters = formEl.querySelector('[data-field="reminder_chapters"]').value
            .split(/[,，]/).map(s => Number(s.trim())).filter(n => n > 0);

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
            related_characters: formEl.querySelector('[data-field="related_characters"]').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
            dependencies: formEl.querySelector('[data-field="dependencies"]').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
            reminder_chapters: reminderChapters,
            resolution_note: formEl.querySelector('[data-field="resolution_note"]').value.trim(),
            last_reminder_ch: data.last_reminder_ch || null,
            next_reminder_due_ch: data.next_reminder_due_ch || null,
          };
          try {
            await DT().storage.saveHook(pid, payload);
            DT().notify(isEdit ? '伏笔已更新' : '伏笔已创建', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[hooks] 保存失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }

    // ---------- 删除确认 ----------
    function confirmDelete(hook) {
      const overlay = createModal({
        title: '删除伏笔',
        bodyHTML: `
          <div class="dt-confirm">
            <p class="dt-warn">⚠ 此操作不可撤销</p>
            <p>确认删除伏笔「<code>${esc(hook.hook_id)}</code>」？</p>
            <p>描述：${esc(hook.description || '—')}</p>
          </div>`,
        submitText: '删除', submitClass: 'dt-btn-danger',
        onSubmit: async () => {
          try {
            await DT().storage.deleteHook(pid, hook.hook_id);
            DT().notify('伏笔已删除', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[hooks] 删除失败:', err);
            DT().notify('删除失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      container.appendChild(overlay);
    }

    // ---------- Tab 切换 & 筛选 ----------
    container.querySelectorAll('.dt-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        view = btn.getAttribute('data-view');
        container.querySelectorAll('.dt-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderView();
      });
    });
    container.querySelectorAll('.dt-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        filter = btn.getAttribute('data-filter');
        container.querySelectorAll('.dt-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderView();
      });
    });

    container.querySelector('[data-act="new"]').addEventListener('click', () => openHookModal(null));
    container.querySelector('[data-act="refresh"]').addEventListener('click', reload);

    await reload();
  }

  // ---------- 导出 ----------
  NS.renderHooks = renderHooks;
})(window);
