/**
 * DreamTale · 设定管理功能模块（v2 重构版）
 *
 * 两级架构：
 *   1. 设定中心首页（Dashboard）— 6 大模块卡片总览 + 完成度进度 + 已配置计数
 *   2. 模块详情页 — 每个模块内部分 sub-tab + 结构化编辑 + 可视化
 *
 * 6 大模块：
 *   🗺️ WorldView  世界观（时代/地理/社会/经济/文化/超凡 6 维度）
 *   ⚡ Power      力量体系（等级/晋升/战斗/代价/特殊/物品 6 子Tab）
 *   👤 Char       角色人设（14字段完整档案 + 弧光可视化 + 列表筛选）
 *   🔗 Relations  关系网（力导向布局+缩放+关系筛选+新增关系编辑）
 *   📖 Plot       剧情结构（主线/卷弧/节奏/伏笔联动/支线）
 *   🧩 Misc       杂项（时间线/名词百科/基调风格）
 *
 * 数据持久化：
 *   - 世界观、力量体系、剧情结构、杂项：统一走 WorldSetting，通过 category 前缀区分
 *     例：worldview.era / power.levels / plot.arc / misc.timeline 等
 *   - 角色：listCharacters / saveCharacter
 *   - 关系：存储到 WorldSetting(relations.graph)
 *
 * 通过 window.DreamTaleFeatures.renderSettings(container) 挂载。
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 通用工具 ----------
  function DT() {
    if (!global.DreamTale) throw new Error('[settings] window.DreamTale 未初始化');
    return global.DreamTale;
  }
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return 'k_' + Math.random().toString(36).slice(2, 10); }
  function currentProjectId() {
    const proj = DT().state.currentProject;
    if (!proj) { DT().notify('请先在「作品管理」中选择一个作品', 'warning'); return null; }
    return proj.id;
  }
  const COLOR_PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#16a085','#c0392b'];
  const REL_COLORS = {
    '亲情': '#f39c12', '爱情': '#e91e63', '友情': '#2ecc71', '师徒': '#9c27b0',
    '宿敌': '#e74c3c', '同盟': '#3498db', '敌对': '#c0392b', '暗恋': '#ff80ab',
    '背叛': '#795548', '亲属': '#ff9800', '其他': '#7f8c8d'
  };

  // ---------- 通用模态框 ----------
  function createModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'dt-modal-overlay';
    overlay.innerHTML = `
      <div class="dt-modal ${opts.size === 'large' ? 'dt-modal-large' : ''} ${opts.size === 'xlarge' ? 'dt-modal-xlarge' : ''}">
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
      submitBtn.disabled = true; submitBtn.textContent = '处理中…';
      try {
        const ok = await opts.onSubmit(body, close);
        if (ok !== false) close();
      } catch (err) {
        console.error('[settings] modal submit:', err);
        DT().notify('操作失败：' + (err.message || err), 'error');
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = opts.submitText || '确定';
      }
    });
    return overlay;
  }

  // ---------- storage 封装：按 category 前缀分组 ----------
  async function loadAllSettings(pid) {
    const raw = (await DT().storage.listWorldSettings(pid)) || [];
    raw.sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
    return raw;
  }
  function groupSettings(raw) {
    const g = { worldview:{}, power:{}, plot:{}, misc:{}, relations:null, other:[] };
    for (const s of raw) {
      const c = s.category || '';
      if (c.startsWith('worldview.')) g.worldview[c.slice(10)] = s;
      else if (c.startsWith('power.')) g.power[c.slice(6)] = s;
      else if (c.startsWith('plot.')) g.plot[c.slice(5)] = s;
      else if (c.startsWith('misc.')) g.misc[c.slice(5)] = s;
      else if (c === 'relations.graph') {
        try { g.relations = JSON.parse(s.content || '{}'); } catch(_) { g.relations = { edges: [] }; }
      } else g.other.push(s);
    }
    return g;
  }
  async function saveKV(pid, prefix, key, content, allRaw) {
    const category = `${prefix}.${key}`;
    const existing = allRaw.find(s => s.category === category);
    const payload = {
      category,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      sort_order: existing ? existing.sort_order : allRaw.length,
    };
    await DT().storage.saveWorldSetting(pid, payload);
  }

  /**
   * 批量保存设定项（单事务原子写入）。
   * items: [{ prefix, key, content }]
   * 返回合并更新后的 allRaw（供调用方在内存中直接使用，避免 reload）
   */
  async function saveKVBatch(pid, items, allRaw) {
    if (!items || !items.length) return allRaw;
    // 1. 生成 payload，计算 sort_order
    let maxSort = allRaw.reduce((m, s) => Math.max(m, s.sort_order || 0), 0);
    const byCat = new Map(allRaw.map(s => [s.category, s]));
    const payloads = items.map(it => {
      const category = `${it.prefix}.${it.key}`;
      const existing = byCat.get(category);
      const sort_order = existing ? existing.sort_order : ++maxSort;
      const content = typeof it.content === 'string' ? it.content : JSON.stringify(it.content);
      return { category, content, sort_order };
    });
    // 2. 调用 storage 批量接口（原子事务）
    if (typeof DT().storage.saveWorldSettings === 'function') {
      await DT().storage.saveWorldSettings(pid, payloads);
    } else {
      // 降级：逐个保存
      for (const p of payloads) await DT().storage.saveWorldSetting(pid, p);
    }
    // 3. 合并更新到内存 allRaw：同 category 覆盖，新 category 追加
    const updatedByCat = new Map(allRaw.map(s => [s.category, { ...s }]));
    for (const p of payloads) updatedByCat.set(p.category, { ...(updatedByCat.get(p.category) || {}), ...p });
    const merged = [...updatedByCat.values()];
    merged.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return merged;
  }

  async function saveRelations(pid, edges) {
    await DT().storage.saveWorldSetting(pid, {
      category: 'relations.graph',
      content: JSON.stringify({ edges, savedAt: Date.now() }),
      sort_order: 9999,
    });
  }

  // ---------- 完成度估算 ----------
  function estimateCompleteness(grouped, characters) {
    const worldviewKeys = ['era','geography','society','economy','culture','transcend'];
    const powerKeys = ['levels','promotion','battle','cost','special','items'];
    const plotKeys = ['mainline','arcs','rhythm','hooks','subplots'];
    const miscKeys = ['timeline','glossary','tone'];
    const countFilled = (keys, obj) => keys.filter(k => obj[k] && (obj[k].content || '').trim().length > 20).length;
    const items = [
      { name: '世界观', icon:'🗺️', module:'worldview',
        count: countFilled(worldviewKeys, grouped.worldview), total: worldviewKeys.length,
        desc: '时代·地理·社会·经济·文化·超凡 6 维度',
        tip: '先确定 1 个核心差异点，再推演社会结构与文化' },
      { name: '力量体系', icon:'⚡', module:'power',
        count: countFilled(powerKeys, grouped.power), total: powerKeys.length,
        desc: '等级·晋升·战斗·代价·特殊·物品 6 子项',
        tip: '上限明确，下限留白；规则必须有代价' },
      { name: '角色人设', icon:'👤', module:'characters',
        count: Math.min(characters.length, 8), total: 8,
        desc: `已配置 ${characters.length} 个角色档案（建议核心 5-8 人）`,
        tip: '先定主角+终极反派，再补功能性配角' },
      { name: '人物关系网', icon:'🔗', module:'relations',
        count: (grouped.relations && grouped.relations.edges ? grouped.relations.edges.length : 0),
        total: Math.max(3, Math.ceil(characters.length * 1.5)),
        desc: '角色↔角色 / 势力↔势力 / 动态关系变化',
        tip: '任意两个重要角色之间要有张力' },
      { name: '剧情结构', icon:'📖', module:'plot',
        count: countFilled(plotKeys, grouped.plot), total: plotKeys.length,
        desc: '主线·卷弧·节奏·伏笔联动·支线',
        tip: '爽→压→爽→大压→大爽 节奏循环' },
      { name: '杂项', icon:'🧩', module:'misc',
        count: countFilled(miscKeys, grouped.misc), total: miscKeys.length,
        desc: '时间线·名词百科·基调风格',
        tip: '决定一切设定的「味道」' },
    ];
    return items;
  }

  // ==================================================
  // 主入口
  // ==================================================
  async function renderSettings(container) {
    if (!container) throw new Error('[settings] container 不能为空');
    container.innerHTML = '';

    const pid = currentProjectId();
    if (!pid) {
      container.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    // 全局状态
    const state = {
      view: 'dashboard',    // dashboard | worldview | power | characters | relations | plot | misc
      grouped: null,
      allRaw: [],
      characters: [],
    };

    // 预加载
    try {
      state.allRaw = await loadAllSettings(pid);
      state.grouped = groupSettings(state.allRaw);
      state.characters = (await DT().storage.listCharacters(pid)) || [];
    } catch (err) {
      console.error('[settings] preload:', err);
      container.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message||err)}</p>`;
      return;
    }

    // 渲染主容器
    const root = document.createElement('div');
    root.className = 'dt-settings-root';
    container.appendChild(root);

    async function reload() {
      state.allRaw = await loadAllSettings(pid);
      state.grouped = groupSettings(state.allRaw);
      state.characters = (await DT().storage.listCharacters(pid)) || [];
      render();
    }

    async function switchView(view) {
      state.view = view;
      render();
      window.scrollTo && window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function render() {
      root.innerHTML = '';
      // 面包屑
      const crumb = document.createElement('div');
      crumb.className = 'dt-crumb';
      if (state.view === 'dashboard') {
        crumb.innerHTML = `<div class="dt-crumb-current">🎯 设定中心</div>
          <div class="dt-crumb-tip">点击模块卡片进入详情编辑，6 大模块齐备才是完整的小说骨架</div>`;
      } else {
        const meta = META_VIEWS[state.view];
        crumb.innerHTML = `
          <button class="dt-btn dt-btn-sm" data-act="back">← 返回设定中心</button>
          <div class="dt-crumb-current">${meta.icon} ${meta.name}</div>
          <div class="dt-crumb-tip">${meta.tip || ''}</div>`;
        crumb.querySelector('[data-act="back"]').addEventListener('click', () => switchView('dashboard'));
      }
      root.appendChild(crumb);

      // 内容
      const viewWrap = document.createElement('div');
      viewWrap.className = 'dt-view-wrap';
      root.appendChild(viewWrap);

      if (state.view === 'dashboard') renderDashboard(viewWrap, state, switchView);
      else if (state.view === 'worldview') renderWorldView(viewWrap, state, reload, pid);
      else if (state.view === 'power') renderPower(viewWrap, state, reload, pid);
      else if (state.view === 'characters') renderCharacters(viewWrap, state, reload, pid);
      else if (state.view === 'relations') renderRelations(viewWrap, state, reload, pid);
      else if (state.view === 'plot') renderPlot(viewWrap, state, reload, pid);
      else if (state.view === 'misc') renderMisc(viewWrap, state, reload, pid);
    }

    render();
  }

  const META_VIEWS = {
    worldview: { name:'世界观设定', icon:'🗺️', tip:'冰山底座：故事发生在什么样的世界？先确定 1 个核心差异点' },
    power:     { name:'力量体系 / 规则', icon:'⚡', tip:'爽感核心：等级有质变、升级有代价、克制有平衡' },
    characters:{ name:'角色人设', icon:'👤', tip:'先主角+终极反派，再补 5-8 个核心配角' },
    relations: { name:'人物关系网', icon:'🔗', tip:'冲突与情感发动机：关系必须有张力、随剧情变化' },
    plot:      { name:'剧情结构 / 大纲', icon:'📖', tip:'爽→压→爽→大压→大爽 的节奏循环' },
    misc:      { name:'杂项 · 时间线 / 百科 / 基调', icon:'🧩', tip:'时间线+名词表避免前后矛盾，基调决定一切「味道」' },
  };

  // ==================================================
  // View 1：设定中心 Dashboard
  // ==================================================
  function renderDashboard(root, state, switchView) {
    const items = estimateCompleteness(state.grouped, state.characters);
    const totalCount = items.reduce((s,i) => s + i.count, 0);
    const totalTotal = items.reduce((s,i) => s + i.total, 0);
    const overallPct = Math.round(totalCount / Math.max(1, totalTotal) * 100);

    const hero = document.createElement('div');
    hero.className = 'dt-dash-hero';
    hero.innerHTML = `
      <div class="dt-dash-hero-left">
        <h2 class="dt-dash-title">🎯 设定中心</h2>
        <p class="dt-dash-sub">把整部小说的设定想象成一座冰山：读者看到的是故事，支撑故事的是水面下这 6 大模块</p>
      </div>
      <div class="dt-dash-hero-right">
        <div class="dt-dash-overall">
          <div class="dt-dash-overall-ring">
            <svg viewBox="0 0 120 120" width="110" height="110">
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--divider)" stroke-width="10"/>
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--accent)" stroke-width="10"
                stroke-dasharray="${overallPct * 3.14159} 314.159" stroke-linecap="round"
                transform="rotate(-90 60 60)"/>
              <text x="60" y="58" text-anchor="middle" font-size="24" font-weight="700" fill="var(--ink-primary)">${overallPct}%</text>
              <text x="60" y="78" text-anchor="middle" font-size="11" fill="var(--ink-muted)">整体完成度</text>
            </svg>
          </div>
          <div class="dt-dash-overall-info">
            <div class="dt-dash-overall-num">${totalCount} / ${totalTotal}</div>
            <div class="dt-dash-overall-desc">关键项已配置，补齐后进入执笔更顺畅</div>
          </div>
        </div>
      </div>`;
    root.appendChild(hero);

    const grid = document.createElement('div');
    grid.className = 'dt-dash-grid';
    items.forEach(it => {
      const pct = Math.round(it.count / Math.max(1, it.total) * 100);
      const card = document.createElement('div');
      card.className = 'dt-module-card';
      card.style.setProperty('--module-color', MODULE_COLOR(it.module));
      card.innerHTML = `
        <div class="dt-module-card-head">
          <div class="dt-module-icon">${it.icon}</div>
          <div class="dt-module-title">
            <h3>${it.name}</h3>
            <div class="dt-module-sub">${it.desc}</div>
          </div>
          <div class="dt-module-pct">${pct}<span>%</span></div>
        </div>
        <div class="dt-progress-bar"><div class="dt-progress-fill" style="width:${pct}%"></div></div>
        <div class="dt-module-foot">
          <div class="dt-module-tip">💡 ${it.tip}</div>
          <button class="dt-btn dt-btn-primary dt-btn-sm" data-act="enter">进入 →</button>
        </div>`;
      card.querySelector('[data-act="enter"]').addEventListener('click', () => switchView(it.module));
      grid.appendChild(card);
    });
    root.appendChild(grid);

    // 快捷统计条
    const quick = document.createElement('div');
    quick.className = 'dt-dash-quick';
    quick.innerHTML = `
      <div class="dt-stat-card-mini"><b>${state.characters.length}</b><span>角色数</span></div>
      <div class="dt-stat-card-mini"><b>${state.grouped.other.length}</b><span>零散设定</span></div>
      <div class="dt-stat-card-mini"><b>${(state.grouped.relations && state.grouped.relations.edges ? state.grouped.relations.edges.length : 0)}</b><span>关系边</span></div>
      <div class="dt-stat-card-mini"><b>${totalCount}</b><span>已配置项</span></div>`;
    root.appendChild(quick);
  }

  function MODULE_COLOR(m) {
    return ({
      worldview: '#3498db', power: '#f39c12', characters: '#2ecc71',
      relations: '#9b59b6', plot: '#e74c3c', misc: '#7f8c8d'
    })[m] || 'var(--accent)';
  }

  // ==================================================
  // 通用子 Tab 外壳 + Markdown 编辑器封装
  // ==================================================
  function createSubTabs(root, tabDefs, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'dt-subtabs-wrap';
    const tabbar = document.createElement('div');
    tabbar.className = 'dt-subtabs';
    tabDefs.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'dt-subtab' + (i === 0 ? ' active' : '');
      b.dataset.tab = t.key;
      b.innerHTML = `<span class="dt-subtab-icon">${t.icon || ''}</span>${esc(t.name)}${t.badge ? `<span class="dt-badge dt-badge-current">${t.badge}</span>` : ''}`;
      tabbar.appendChild(b);
    });
    const panel = document.createElement('div');
    panel.className = 'dt-subpanel';
    // 每个 tab 的子 panel 容器：第一次 render 后保留，后续只切换 display
    const subPanels = new Map();
    wrap.appendChild(tabbar); wrap.appendChild(panel);
    root.appendChild(wrap);

    let cur = tabDefs[0].key;
    async function switchTo(k) {
      cur = k;
      tabbar.querySelectorAll('.dt-subtab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === k);
      });
      // 隐藏所有已存在的子 panel
      subPanels.forEach(el => { el.style.display = 'none'; });
      // 若该 tab 第一次进入，创建 panel 并 render
      let targetEl = subPanels.get(k);
      if (!targetEl) {
        targetEl = document.createElement('div');
        targetEl.className = 'dt-subpanel-inner';
        targetEl.dataset.tab = k;
        targetEl.style.display = '';
        panel.appendChild(targetEl);
        subPanels.set(k, targetEl);
        const def = tabDefs.find(t => t.key === k);
        if (def && def.render) {
          try {
            await def.render(targetEl);
          } catch (e) {
            console.error('[settings] subTab render 失败:', k, e);
            targetEl.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(e.message || e)}</p>`;
          }
        }
      } else {
        targetEl.style.display = '';
      }
      onChange && onChange(k);
    }
    tabbar.querySelectorAll('.dt-subtab').forEach(b => {
      b.addEventListener('click', () => switchTo(b.dataset.tab));
    });
    // 先创建首 tab panel（异步）
    switchTo(cur);
    return {
      get: () => cur,
      switchTo,
      /** 获取指定 tab 的子 panel DOM（用于保存时遍历 editor 值） */
      getPanel: (k) => subPanels.get(k),
      /** 获取全部已渲染 tab 的子 panel Map */
      allPanels: () => subPanels,
    };
  }

  function createMarkdownEditor(container, initialValue, theme) {
    container.innerHTML = '';
    if (global.DreamTaleEditor) {
      try { return global.DreamTaleEditor.create(container, { initialValue: initialValue || '', theme: theme || 'light' }); }
      catch(e) { /* fallback textarea */ }
    }
    const ta = document.createElement('textarea');
    ta.className = 'dt-fallback-editor';
    ta.value = initialValue || '';
    ta.rows = 14;
    container.appendChild(ta);
    return {
      getValue: () => ta.value,
      setValue: v => { ta.value = v; },
    };
  }

  // 通用维度编辑页外壳（6维度模块通用）
  // opts 新增字段（用于「保存当前Tab = 保存整个模块所有子Tab」）：
  //   - prefix:      模块前缀 (worldview / power / plot / misc)
  //   - tabKey:      当前子Tab的 key (era / geography / ...)
  //   - allTabs:     模块下所有子Tab定义 [{key,placeholder,...}]
  //   - getTabCtrl:  取 createSubTabs 返回的控制器（用于获取其他Tab panel）
  //   - state:       渲染级 state（含 allRaw/grouped/characters）
  //   - pid:         当前项目 id
  //   - afterBatchSave(mergedAllRaw): 批量保存成功后的钩子，用于同步 state.allRaw + grouped + 重算进度
  function makeDimensionEditor(opts) {
    return async (panel) => {
      panel.innerHTML = `
        <div class="dt-dim-head">
          <div>
            <h3 class="dt-dim-title">${opts.title}</h3>
            <p class="dt-dim-tip">${opts.tip || ''}</p>
          </div>
          <div class="dt-dim-actions">
            <button class="dt-btn dt-btn-primary" data-act="save">保存</button>
          </div>
        </div>
        <div class="dt-dim-editor" data-host></div>`;
      const host = panel.querySelector('[data-host]');
      const editor = createMarkdownEditor(host, opts.getCurrent() || opts.placeholder || '', DT().state.theme);
      // 把 editor 挂到 panel 上，供其他 tab 批量保存时遍历取值
      panel._editor = editor;
      panel._tabKey = opts.tabKey;

      let savePending = false;
      panel.querySelector('[data-act="save"]').addEventListener('click', async () => {
        if (savePending) return;
        savePending = true;
        try {
          // ====== 批量保存：当前模块的所有子Tab ======
          const prefix = opts.prefix;
          const allTabs = opts.allTabs || [];
          const tabCtrl = (typeof opts.getTabCtrl === 'function') ? opts.getTabCtrl() : null;
          const pid = opts.pid;
          const state = opts.state;

          // 1) 收集所有子Tab的值：
          //    - 如果该Tab已被打开过（已渲染 & 有editor实例）：从 panel._editor 取 getValue()（即使用户没动）
          //    - 如果该Tab从未被打开过：跳过（避免把空占位符或数据库无值情况写空 category）
          const items = [];
          for (const t of allTabs) {
            let content = '';
            let hasEditor = false;
            const subPanel = tabCtrl ? tabCtrl.getPanel(t.key) : null;
            if (subPanel && subPanel._editor && typeof subPanel._editor.getValue === 'function') {
              content = subPanel._editor.getValue();
              hasEditor = true;
            }
            // ★ 关键过滤规则（避免写入噪音/空 category）：
            // 情况 A：该 tab 被打开过（存在 editor 实例）
            if (hasEditor) {
              const dbHasValue = !!(state.grouped && state.grouped[prefix] && state.grouped[prefix][t.key]);
              // ① 如果数据库已经有值：始终保存（用户可能选择清空内容）
              // ② 如果数据库没值 且 内容等于 placeholder（没编辑过）：跳过
              // ③ 如果数据库没值 且 内容不等于placeholder（编辑过了）：保存
              if (!dbHasValue && content === (t.placeholder || '')) {
                continue; // 没编辑过且没旧值 → 不入库
              }
              if (!dbHasValue && content === '') {
                continue; // 编辑器打开了但全删了且数据库无值 → 也不入库造噪音
              }
              items.push({ prefix, key: t.key, content });
            }
            // 情况 B：该 tab 从未被打开过 → 直接跳过（不写空 category）
          }

          // 2) 如果用户点保存时，当前模块下连一个有效值都没有（全是初始placeholder没动过），
          //    至少把当前Tab的值落库，避免白忙活
          if (!items.length) {
            items.push({ prefix, key: opts.tabKey, content: editor.getValue() });
          }

          // 3) 调用批量保存（单事务原子写入）
          const mergedAllRaw = await saveKVBatch(pid, items, state.allRaw);

          // 4) 同步内存 state（进度会立刻反映，不用 reload 整个视图）
          if (state) {
            state.allRaw = mergedAllRaw;
            state.grouped = groupSettings(mergedAllRaw);
          }
          if (typeof opts.afterBatchSave === 'function') {
            await opts.afterBatchSave(mergedAllRaw);
          }

          const savedCount = items.length;
          DT().notify(savedCount > 1 ? `已保存 ${savedCount} 个子项` : '已保存', 'success');
          if (typeof opts.reload === 'function') await opts.reload();
        } finally { savePending = false; }
      });
    };
  }

  // ==================================================
  // View 2：世界观（6维度）
  // ==================================================
  function renderWorldView(root, state, reload, pid) {
    const prefix = 'worldview';
    const dims = [
      { key:'era',         icon:'📜', name:'时代与背景',
        tip:'古代/现代/未来/架空？有没有真实历史原型？核心差异点：和现实世界最大的不同是什么？',
        placeholder: `# 时代与背景\n\n## 时代类型\n架空东方玄幻 / 灵气复苏现代都市 / 西幻中古 / 未来星际 / 历史原型（如：盛唐+修真）\n\n## 核心差异点（必须先写！）\n这是整个世界与现实世界最大的不同，后续所有设定由此推演：\n- 例：上古剑尊陨落后，剑意可具象化为实体剑骨\n- 例：灵气在 2033 年突然复苏，高考加入「灵能测试」\n\n## 时间跨度\n故事发生在纪元 XX 年，距核心历史事件约 XX 年` },
      { key:'geography',   icon:'🌏', name:'地理空间',
        tip:'大陆/星球/位面怎么划分？关键地点有哪些？舞台在哪？',
        placeholder: `# 地理空间\n\n## 大陆/位面划分\n- 中州：宗门林立的核心大陆\n- 北荒：严寒之地，隐世势力蛰伏\n- 东海渊海：海族统治，秘境「沉璧」所在\n- 天地之外：神祇故土（封印之地）\n\n## 关键地点档案\n| 地点 | 类型 | 重要性 | 说明 |\n|------|------|--------|------|\n| 青云宗·鹤鸣山 | 宗门 | ★★★★★ | 主角出身地，后山有剑冢 |\n| 寒江 | 天险 | ★★★★ | 南北分界，江底沉有上古剑骨 |\n| 无相门·隐谷 | 暗势力 | ★★★★★ | 本作主要反派宗门 |` },
      { key:'society',     icon:'🏛️', name:'社会结构',
        tip:'政治体制、阶层、种族、势力分布？谁掌权？谁被压迫？',
        placeholder: `# 社会结构\n\n## 势力格局\n- 正道：青云宗、玄都观、儒家书院 三派并立\n- 邪道：无相门隐于北荒暗处\n- 妖族：九尾狐族等古族避世\n- 海族：渊海三王分治（白鲨/玄龟/赤蛟）\n\n## 阶层\n凡人 → 练气修士 → 宗门弟子 → 内门/长老 → 掌门/宗主 → 化神大能\n\n## 种族关系\n人族掌权，妖族避世，海族与人族互市但互不侵犯` },
      { key:'economy',     icon:'💰', name:'经济与资源',
        tip:'什么驱动世界运转？货币、稀缺资源是什么？',
        placeholder: `# 经济与资源\n\n## 通用货币\n下品灵石（1）→ 中品（100）→ 上品（10000）→ 极品灵石\n\n## 核心稀缺资源\n| 资源 | 用途 | 获取方式 |\n|------|------|----------|\n| 上古剑骨 | 剑意升华/境界突破 | 遗迹/秘境/拍卖行 |\n| 洗髓丹 | 筑基前资质提升 | 丹师炼制/宗门赏赐 |\n| 天地灵脉 | 修炼速度翻倍 | 占据灵脉洞府 |\n\n## 经济支柱\n- 宗门：灵田+丹药+法器的自给自足\n- 散修：猎杀妖兽+采集灵草换灵石\n- 海族：海灵珠与人族炼器材料贸易` },
      { key:'culture',     icon:'🎭', name:'文化与信仰',
        tip:'宗教、禁忌、习俗、价值观？什么是荣？什么是耻？',
        placeholder: `# 文化与信仰\n\n## 主流信仰\n天道信仰：万物遵循天道法则，逆天而行会遭天劫。但「剑修」以人剑合一试图改写规则，是信仰中的异类。\n\n## 禁忌（违者人人得而诛之）\n- 血祭：以凡人精血修炼邪功\n- 弑师：师徒如父子，欺师灭祖是最大禁忌\n- 破封：神祇故土封印不可破开，否则万劫不复\n\n## 习俗\n- 拜剑礼：剑修入门/突破时，需对本命剑行三拜之礼\n- 问心酒：宗门大比前，饮烈酒一碗立誓` },
      { key:'transcend',   icon:'✨', name:'科技 / 超凡水平',
        tip:'这个世界的「天花板」在哪？最强者是什么状态？',
        placeholder: `# 超凡水平（世界天花板）\n\n## 境界上限\n最高「渡劫期」，但「飞升成仙」是上古神话，无人成功。传言渡劫成功者都会「神秘失踪」，实为天道封印吞噬。\n\n## 战力极值\n- 化神期大能：可一击摧城，寿命 3000 年\n- 渡劫期传说：改写地域天象，寿命近乎无限\n\n## 超凡 vs 科技\n纯修真世界，无现代科技。但「传音符」等同电话、「储物袋」等同空间装备。\n\n## 关键铁则（不可打破）\n- 不可成仙：天道封印未破，无人可飞升\n- 剑修破境必须以剑意印证，比常人难 3 倍但可越阶挑战\n- 残剑「问渊」是唯一能接触到封印的载体` },
    ];
    // 给每个子Tab附上 _getCurrent（未打开过的Tab批量保存时用数据库已有值）
    dims.forEach(d => {
      d._getCurrent = () => (state.grouped[prefix] && state.grouped[prefix][d.key]) ? state.grouped[prefix][d.key].content : '';
    });
    // tabCtrl 占位：解决「tabDefs 依赖 tabCtrl」和「createSubTabs 依赖 tabDefs」的循环引用
    const tabCtrlHolder = { ctrl: null };
    const tabDefs = dims.map(d => ({
      key: d.key, icon: d.icon, name: d.name,
      render: makeDimensionEditor({
        title: `${d.icon} ${d.name}`,
        tip: d.tip,
        placeholder: d.placeholder,
        getCurrent: d._getCurrent,
        prefix, tabKey: d.key,
        allTabs: dims,
        getTabCtrl: () => tabCtrlHolder.ctrl,
        state, pid, reload,
      }),
    }));
    // 加上「原始设定」tab 兼容旧数据
    if (state.grouped.other && state.grouped.other.length) {
      tabDefs.push({
        key: 'legacy', icon:'📦', name: `原设定(${state.grouped.other.length})`,
        render: (panel) => {
          panel.innerHTML = `<div class="dt-dim-head"><h3 class="dt-dim-title">📦 兼容模式：旧版零散设定</h3>
            <p class="dt-dim-tip">v2 升级前创建的 category 未按 worldview./power. 等前缀归类，在此展示。建议逐步迁移到 6 维度。</p></div>
            <ul class="dt-wv-items">${state.grouped.other.map((s,i)=>`
              <li class="dt-wv-item" data-idx="${i}">
                <div class="dt-wv-item-main">
                  <span class="dt-wv-cat">${esc(s.category||'未分类')}</span>
                  <span class="dt-wv-preview">${esc((s.content||'').slice(0,120).replace(/\n/g,' '))}${(s.content||'').length>120?'…':''}</span>
                </div>
              </li>`).join('')}</ul>`;
        },
      });
    }
    tabCtrlHolder.ctrl = createSubTabs(root, tabDefs);
  }

  // ==================================================
  // View 3：力量体系（6子Tab）
  // ==================================================
  function renderPower(root, state, reload, pid) {
    const prefix = 'power';
    const subs = [
      { key:'levels',    icon:'📊', name:'等级划分',
        tip:'修炼/升级分几个大境界？每个境界有什么「质变」？升级感必须可感知',
        placeholder: `# 等级划分（境界阶梯）\n\n| 大境界 | 小层次 | 寿命 | 质变表现 | 典型战力 |\n|--------|--------|------|----------|----------|\n| 练气 | 一至九层 | 120年 | 感知灵气，可用低阶符箓 | 单打 3-5 凡人 |\n| 筑基 | 初期/中期/后期/大圆满 | 300年 | 灵力化液，可御剑飞行 | 灭山寨 |\n| 金丹 | 同上 | 800年 | 结丹成域，低阶法术免疫 | 灭小镇 |\n| 元婴 | 同上 | 1500年 | 元神出窍，瞬移百里 | 灭一城 |\n| 化神 | 同上 | 3000年 | 法则碎片，领域成型 | 灭一军 |\n| 渡劫 | 三重天劫 | ≈永生 | 触碰到天道法则（但不可飞升） | 毁国级 |\n\n## 剑修特殊\n剑修每境界可越一阶挑战，但破境需剑意印证，失败率 60%，失败 = 道心破碎。` },
      { key:'promotion', icon:'🎯', name:'晋升条件',
        tip:'怎么升级？需要什么资源/机缘/领悟？不是光靠打怪',
        placeholder: `# 晋升条件\n\n## 通用条件\n- 灵力积累达标（硬指标）\n- 心境过关（瓶颈考验）\n- 无明显心魔（或心魔被压制）\n\n## 关键境界门槛\n### 练气 → 筑基\n- 资源：洗髓丹 × 1 + 筑基功法（黄阶以上）\n- 机缘：无，但需选「主修方向」（剑修/丹修/符修……）\n- 失败代价：经脉损伤 → 资质下降 10%\n\n### 筑基 → 金丹\n- 资源：金丹草 + 地脉灵泉 × 3\n- 机缘：一次「问心关」幻境考验\n- 剑修额外：需以本命剑斩去一件执念之物（代价）\n\n### 金丹 → 元婴\n- 资源：元婴果 + 九瓣莲座\n- 机缘：雷劫洗礼，渡过后心性蜕变\n- 失败代价：金丹破裂 → 境界跌落筑基\n\n## 代价交换\n金手指（残剑问渊）：每吸收一截剑骨，交换同等代价——\n- 第一截（剑冢）→ 代价：寒毒缠身，需每年极阴之地温养\n- 第二截（寒江底）→ 代价：记忆碎片丢失（忘记母亲的脸）` },
      { key:'battle',    icon:'⚔️', name:'战斗规则',
        tip:'越级挑战 possible 吗？克制关系是什么？不能碾压一切',
        placeholder: `# 战斗规则与克制\n\n## 越阶挑战规则\n- 通用：同境界内可跨小层（如筑基中期打后期），不可越整大境界\n- 剑修例外：每境界可靠剑意越整整一阶（筑基打金丹），但消耗巨大，战后虚弱 3 天\n- 功法/法宝：天阶功法可补 1 小层差距；本命法宝 +1 小层\n\n## 五行 / 体系克制\n| 进攻方 | 克制 | 被克制 |\n|--------|------|--------|\n| 剑修（锋利） | 丹修/符修（脆皮远程） | 体修（硬抗） |\n| 体修（防御） | 剑修 | 法修（灵力穿透） |\n| 法修（AOE） | 体修 | 剑修（单点破防） |\n| 丹修（辅助） | 消耗战 | 速攻剑修 |\n\n## 战斗三要素\n1. 灵力储备量 = 血条\n2. 法则/剑意 领悟度 = 暴击率\n3. 心境稳定度 = 操作上限，心魔发作 = 直接判负` },
      { key:'cost',      icon:'💀', name:'代价与限制',
        tip:'力量不是免费的！代价制造戏剧张力',
        placeholder: `# 代价与限制（有得必有失）\n\n## 通用代价\n- 寿命：每突破大境界，需消耗「本源寿命」（不是净增，实际可用≈净增的一半）\n- 心魔：境界越高，心魔劫越烈（化神心魔劫失败率 30%）\n- 天劫：金丹起每突破都渡天劫，雷劫可能劈死\n\n## 金手指代价（残剑问渊专属，核心戏剧张力来源）\n| 吸收剑骨 | 获得能力 | 付出代价 |\n|----------|----------|----------|\n| 第1截·剑冢 | 剑意初成，可越阶 | 寒毒缠身（每年极阴之地温养 7 日） |\n| 第2截·寒江 | 剑灵传音，指点迷津 | 丢失一段记忆（忘记母亲面容） |\n| 第3截·沉璧 | 剑尊一战之力（1次） | 失明 3 个月 + 寿命 -200 年 |\n| 第4截·故土 | 剑道法则 | 需要献祭一个珍视之人的羁绊 |\n\n## 绝对限制（不可打破！）\n- 无人可在「神祇故土」使用灵力（封印压制）\n- 残剑出鞘时间 = 获得剑骨数 × 1 分钟，超时反噬` },
      { key:'special',   icon:'💠', name:'特殊体系',
        tip:'功法、血脉、天赋、武魂、系统……主角的独特优势',
        placeholder: `# 特殊体系 / 金手指\n\n## 主角金手指：残剑「问渊」\n- 本质：上古剑尊「问渊」的本命剑碎片，承载剑尊残识与未竟之战\n- 吸收机制：可吸收同出一源的「剑骨」补全自身\n- 被动：持剑者对剑意感悟速度 × 5；在剑意浓密度高的地方自动共鸣\n- 主动：剑尊残识附体 1 分钟（每截剑骨 1 分钟上限）\n\n## 功法品阶\n黄阶 → 玄阶 → 地阶 → 天阶 → 古法（失传）\n- 青云宗镇宗：「青云剑诀」（地阶上品）\n- 残剑自带：「问渊十三剑」（古法，现只解锁前 3 式）\n\n## 特殊体质 / 血脉\n- 主角沈砚：「剑骨天生」（未觉醒前表现为经脉异常狭窄，觉醒后=剑修圣体）\n- 阿箩：「九尾天狐」血脉（每化一条尾=一次境界质变，但情绪波动会失控）\n- 无相门门主裴矩：「无面」体质（可复制他人气息，伪装任何人）` },
      { key:'items',     icon:'🎒', name:'物品体系',
        tip:'法宝/丹药/阵法的品级与规则，读者关心的「装备系统」',
        placeholder: `# 物品 / 装备体系\n\n## 法宝品阶\n凡器 → 灵器（上中下）→ 灵宝 → 玄宝 → 天宝 → 古宝（道器）\n| 品阶 | 举例 | 威能 |\n|------|------|------|\n| 灵器 | 制式佩剑 | 灌注灵力可削铁如泥 |\n| 灵宝 | 本命剑 | 心神相连，剑心通明 |\n| 天宝 | 问渊残剑 | 承载法则碎片 |\n| 古宝 | 完整问渊剑 | 可劈开封印（传说） |\n\n## 丹药品阶\n下品 → 中品 → 上品 → 极品 → 仙丹（无人能炼）\n- 同品丹：丹师品级 ≥ 丹药品阶才能炼制\n\n## 核心物品清单（关键剧情道具）\n1. 残剑问渊（金手指）— 卷1剑冢出土\n2. 沉璧剑骨（第3截）— 卷3渊海核心\n3. 阿箩的九尾尾羽（信物）— 可解一次残剑反噬\n4. 神祇故土封印碎片 — 卷4入口钥匙\n5. 无相面具（裴矩的信物）— 伏笔：与主角母亲遗物同款` },
    ];
    subs.forEach(s => {
      s._getCurrent = () => (state.grouped[prefix] && state.grouped[prefix][s.key]) ? state.grouped[prefix][s.key].content : '';
    });
    const tabCtrlHolder = { ctrl: null };
    const tabDefs = subs.map(s => ({
      key: s.key, icon: s.icon, name: s.name,
      render: makeDimensionEditor({
        title: `${s.icon} ${s.name}`,
        tip: s.tip, placeholder: s.placeholder,
        getCurrent: s._getCurrent,
        prefix, tabKey: s.key, allTabs: subs,
        getTabCtrl: () => tabCtrlHolder.ctrl,
        state, pid, reload,
      }),
    }));
    tabCtrlHolder.ctrl = createSubTabs(root, tabDefs);
  }

  // ==================================================
  // View 4：角色人设（列表筛选 → 14字段档案编辑）
  // ==================================================
  function renderCharacters(root, state, reload, pid) {
    const wrap = document.createElement('div');
    wrap.className = 'dt-char-page';

    // 顶部工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'dt-toolbar';
    toolbar.innerHTML = `
      <div class="dt-toolbar-left">
        <input class="dt-input dt-search" type="search" data-act="search" placeholder="🔍 搜索角色姓名/身份/目标…" />
        <div class="dt-filter-chips" data-chips></div>
      </div>
      <div class="dt-toolbar-actions">
        <button class="dt-btn" data-act="refresh">刷新</button>
        <button class="dt-btn dt-btn-primary" data-act="new">+ 新建角色</button>
      </div>`;
    wrap.appendChild(toolbar);
    root.appendChild(wrap);

    const cardGrid = document.createElement('div');
    cardGrid.className = 'dt-cards dt-char-page-grid';
    wrap.appendChild(cardGrid);

    const ROLE_FILTERS = ['全部', '主角', '女主', '反派', '重要配角', '次要配角', '工具人'];
    let activeFilter = '全部';
    let searchText = '';

    function renderList() {
      const chipsEl = toolbar.querySelector('[data-chips]');
      chipsEl.innerHTML = ROLE_FILTERS.map(r =>
        `<span class="dt-filter-chip ${r===activeFilter?'active':''}" data-role="${esc(r)}">${esc(r)}</span>`
      ).join('');
      chipsEl.querySelectorAll('.dt-filter-chip').forEach(c => {
        c.addEventListener('click', () => { activeFilter = c.dataset.role; renderList(); });
      });

      const chars = state.characters.filter(c => {
        if (activeFilter !== '全部' && (c.role || '') !== activeFilter) return false;
        if (searchText) {
          const hay = [c.name, c.identity, c.goal, c.personality, c.arc, c.relation].join(' ');
          if (!hay.toLowerCase().includes(searchText.toLowerCase())) return false;
        }
        return true;
      });

      if (!chars.length) {
        cardGrid.innerHTML = `<div class="dt-empty-state"><p>${state.characters.length ? '没有匹配的角色' : '暂无角色档案'}</p>
          ${!state.characters.length ? '<button class="dt-btn dt-btn-primary" data-act="new-empty">+ 创建第一个角色（主角）</button>' : ''}</div>`;
        const nb = cardGrid.querySelector('[data-act="new-empty"]');
        if (nb) nb.addEventListener('click', () => openEditor(null, true));
        return;
      }
      cardGrid.innerHTML = chars.map((c, origIdx) => {
        const idx = state.characters.indexOf(c);
        const color = c.color || COLOR_PALETTE[idx % COLOR_PALETTE.length];
        const initial = (c.name || '?').charAt(0);
        const personalityTags = (c.personality || '').split(/[,，、\/\s]+/).filter(Boolean).slice(0, 3);
        return `
        <div class="dt-card dt-char-card-v2" data-idx="${idx}" style="border-top:3px solid ${esc(color)};">
          <div class="dt-char-v2-head">
            <div class="dt-char-avatar" style="background:${esc(color)};width:56px;height:56px;font-size:22px;">${esc(initial)}</div>
            <div class="dt-char-v2-title">
              <div class="dt-char-v2-name">${esc(c.name || '未命名')}</div>
              <div class="dt-char-v2-meta">
                ${c.role ? `<span class="dt-tag">${esc(c.role)}</span>` : ''}
                ${c.level ? `<span class="dt-tag dt-tag-type">${esc(c.level)}</span>` : ''}
              </div>
            </div>
          </div>
          ${c.identity ? `<div class="dt-char-v2-identity">💼 ${esc(c.identity)}</div>` : ''}
          <div class="dt-char-v2-tags">
            ${personalityTags.map(t => `<span class="dt-tag dt-tag-type">#${esc(t)}</span>`).join('')}
          </div>
          <div class="dt-char-v2-summary">
            ${c.goal ? `<div class="dt-char-v2-row"><span>🎯 目标</span><div>${esc((c.goal||'').slice(0,40))}${c.goal.length>40?'…':''}</div></div>` : ''}
            ${c.arc ? `<div class="dt-char-v2-row"><span>📈 弧光</span><div>${esc((c.arc||'').slice(0,40))}${c.arc.length>40?'…':''}</div></div>` : ''}
          </div>
          ${c.background ? `<div class="dt-char-v2-bg">📖 ${esc((c.background||'').slice(0,80))}${c.background.length>80?'…':''}</div>` : ''}
          <div class="dt-card-footer">
            <div class="dt-char-v2-counts">
              <span>字段 ${filledCount(c)}/14</span>
            </div>
            <div class="dt-card-actions">
              <button class="dt-btn dt-btn-sm" data-act="view">详情</button>
              <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
              <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">删</button>
            </div>
          </div>
        </div>`;
      }).join('');
      cardGrid.querySelectorAll('.dt-char-card-v2').forEach(card => {
        const idx = Number(card.getAttribute('data-idx'));
        card.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(state.characters[idx]));
        card.querySelector('[data-act="view"]').addEventListener('click', () => openViewer(state.characters[idx]));
        const d = card.querySelector('[data-act="del"]');
        if (d) d.addEventListener('click', () => confirmDelete(state.characters[idx]));
      });
    }
    function filledCount(c) {
      return ['name','role','identity','level','personality','arc','relation','goal','age','appearance','fear','quirk','background','weakness']
        .filter(k => c[k] && String(c[k]).trim().length).length;
    }

    toolbar.querySelector('[data-act="search"]').addEventListener('input', (e) => {
      searchText = e.target.value; renderList();
    });
    toolbar.querySelector('[data-act="refresh"]').addEventListener('click', reload);
    toolbar.querySelector('[data-act="new"]').addEventListener('click', () => openEditor(null));

    // 角色详情查看器
    function openViewer(c) {
      const color = c.color || COLOR_PALETTE[0];
      const initial = (c.name||'?').charAt(0);
      const fields = [
        ['姓名 / 别名', c.name, 'primary'],
        ['年龄', c.age],
        ['外貌（关键特征）', c.appearance],
        ['性格关键词', c.personality],
        ['核心动机 / 欲望', c.motivation || c.goal, 'accent'],
        ['恐惧 / 弱点', c.fear || c.weakness],
        ['口癖 / 习惯动作', c.quirk],
        ['背景故事', c.background],
        ['身份', c.identity],
        ['角色定位', c.role],
        ['境界 / 等级', c.level],
        ['金手指 / 特殊能力', c.special_power],
        ['致命弱点', c.weakness],
        ['与主角的关系', c.relation_to_protagonist || c.relation],
        ['角色弧线（起点→终点）', c.arc],
      ];
      const overlay = createModal({
        title: `📂 角色档案 · ${c.name}`,
        size: 'xlarge',
        bodyHTML: `
          <div class="dt-char-viewer">
            <div class="dt-char-viewer-head" style="border-left:4px solid ${esc(color)}">
              <div class="dt-char-avatar" style="background:${esc(color)};width:64px;height:64px;font-size:26px;">${esc(initial)}</div>
              <div class="dt-char-viewer-title">
                <h3 style="margin:0;">${esc(c.name||'未命名')}</h3>
                <div class="dt-char-viewer-meta">
                  ${c.role ? `<span class="dt-tag">${esc(c.role)}</span>` : ''}
                  ${c.level ? `<span class="dt-tag dt-tag-type">${esc(c.level)}</span>` : ''}
                  ${c.identity ? `<span class="dt-tag">💼 ${esc(c.identity)}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="dt-char-viewer-fields">
              ${fields.map(([k, v, type]) => v && String(v).trim().length ? `
                <div class="dt-char-viewer-field">
                  <div class="dt-char-viewer-key">${esc(k)}</div>
                  <div class="dt-char-viewer-value ${type==='accent'?'accent':''}">${esc(String(v))}</div>
                </div>` : ''
              ).join('')}
            </div>
            ${c.arc ? `
            <div class="dt-char-viewer-arc">
              <div class="dt-arc-title">📈 角色弧光</div>
              <div class="dt-arc-flow">${renderArcFlow(c.arc)}</div>
            </div>` : ''}
          </div>`,
        submitText: '编辑',
        onSubmit: async () => { openEditor(c); return false; },
      });
      root.appendChild(overlay);
    }
    function renderArcFlow(arc) {
      const parts = String(arc).split(/→|->|→|~|至/).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) return `<div class="dt-arc-simple">${esc(arc)}</div>`;
      return parts.map((p, i) => `
        <div class="dt-arc-node">
          <div class="dt-arc-node-num">${i + 1}</div>
          <div class="dt-arc-node-label">${esc(p)}</div>
        </div>${i < parts.length-1 ? '<div class="dt-arc-arrow">→</div>' : ''}
      `).join('');
    }

    // 角色编辑器（14字段）
    function openEditor(char, isNewProtagonist) {
      const isEdit = !!char;
      const data = Object.assign({
        name: isNewProtagonist ? '' : '',
        role: isNewProtagonist ? '主角' : '',
        identity: '', level: '', personality: '',
        arc: '', relation: '', goal: '',
        age: '', appearance: '', fear: '', weakness: '', quirk: '',
        background: '', motivation: '', special_power: '', relation_to_protagonist: '',
        color: COLOR_PALETTE[(state.characters.length) % COLOR_PALETTE.length],
      }, char || {});
      const overlay = createModal({
        title: isEdit ? '编辑角色档案' : (isNewProtagonist ? '创建主角档案' : '新建角色档案'),
        size: 'xlarge',
        submitText: isEdit ? '保存修改' : '创建角色',
        bodyHTML: `
          <div class="dt-form dt-form-char">
            <div class="dt-form-section-title">👤 基础信息</div>
            <div class="dt-form-row dt-form-row-3col">
              <div><label>姓名 <span class="dt-req">*</span></label>
                <input type="text" data-f="name" value="${esc(data.name)}" placeholder="沈砚"/></div>
              <div><label>年龄</label>
                <input type="text" data-f="age" value="${esc(data.age)}" placeholder="16岁"/></div>
              <div><label>角色定位</label>
                <select data-f="role">
                  ${['','主角','女主','反派','重要配角','次要配角','工具人','导师','挚友','卷反派']
                    .map(r => `<option value="${esc(r)}" ${data.role===r?'selected':''}>${esc(r||'— 未选择 —')}</option>`).join('')}
                </select></div>
            </div>
            <div class="dt-form-row">
              <label>外貌（关键特征，不要全身描写）</label>
              <textarea data-f="appearance" rows="2" placeholder="例：眉间一点朱砂；左袖有剑痕；发间总插一支铜簪">${esc(data.appearance)}</textarea>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>身份</label>
                <input type="text" data-f="identity" value="${esc(data.identity)}" placeholder="青云宗外门弟子 → 剑修"/></div>
              <div><label>境界 / 等级</label>
                <input type="text" data-f="level" value="${esc(data.level)}" placeholder="筑基后期"/></div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>代表色</label>
                <input type="color" data-f="color" value="${esc(data.color||'#3498db')}"/></div>
              <div><label>性格关键词（2-3个，逗号分隔）</label>
                <input type="text" data-f="personality" value="${esc(data.personality)}" placeholder="隐忍、清醒、偏执"/></div>
            </div>

            <div class="dt-form-section-title">❤️ 内核（制造冲突的关键）</div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>核心动机 / 欲望（他到底要什么？）</label>
                <textarea data-f="motivation" rows="3" placeholder="例：寻找完整剑骨；揭开身世之谜；以凡人之躯问剑天道">${esc(data.motivation || data.goal)}</textarea></div>
              <div><label>恐惧 / 致命弱点（不完美才有张力）</label>
                <textarea data-f="fear" rows="3" placeholder="例：害怕被抛弃；面对极寒会失控；心魔=母亲的死">${esc(data.fear || data.weakness)}</textarea></div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>口癖 / 习惯动作</label>
                <input type="text" data-f="quirk" value="${esc(data.quirk)}" placeholder="思考时手指会无意识敲剑鞘；生气时语调反而更冷"/></div>
              <div><label>金手指 / 特殊能力</label>
                <input type="text" data-f="special_power" value="${esc(data.special_power)}" placeholder="残剑「问渊」持有者；剑骨天生"/></div>
            </div>

            <div class="dt-form-section-title">📖 故事与关系</div>
            <div class="dt-form-row">
              <label>背景故事（简要，不超过 300 字）</label>
              <textarea data-f="background" rows="4" placeholder="例：沈砚自小在青云宗外门长大，母亲早逝，只留下一支铜簪。被外门管事欺压三年，直到在后山剑冢拾到残剑，命运齿轮开始转动……">${esc(data.background)}</textarea>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>与主角的关系</label>
                <input type="text" data-f="relation_to_protagonist" value="${esc(data.relation_to_protagonist || (data.role==='主角'?'自己':''))}" placeholder="残剑持有者；互相救赎；宿敌；引路人……"/></div>
              <div><label>其他角色关系（一句话）</label>
                <input type="text" data-f="relation" value="${esc(data.relation)}" placeholder="与阿箩羁绊渐深；云栖入门引路人；裴矩灭门仇人"/></div>
            </div>
            <div class="dt-form-row">
              <label>角色弧线（起点 → 转变点 → 终点，用 → 连接）</label>
              <textarea data-f="arc" rows="2" placeholder="杂役 → 剑意觉醒 → 剑修 → 叩问天道">${esc(data.arc)}</textarea>
            </div>
          </div>`,
        onSubmit: async (formEl) => {
          const get = (k) => (formEl.querySelector(`[data-f="${k}"]`) || { value: '' }).value.trim();
          const name = get('name');
          if (!name) { DT().notify('姓名不能为空', 'warning'); return false; }
          const payload = {
            name, role: get('role'), identity: get('identity'), level: get('level'),
            personality: get('personality'), arc: get('arc'),
            relation: get('relation_to_protagonist') + (get('relation') ? ' / ' + get('relation') : ''),
            goal: get('motivation'), color: formEl.querySelector('[data-f="color"]').value,
            // 新增字段 v2：序列化到 goal/relation 组合里太散，直接加到 payload — storage JSON 兼容
            age: get('age'), appearance: get('appearance'), fear: get('fear'),
            weakness: get('fear'), quirk: get('quirk'), background: get('background'),
            motivation: get('motivation'), special_power: get('special_power'),
            relation_to_protagonist: get('relation_to_protagonist'),
          };
          await DT().storage.saveCharacter(pid, payload);
          DT().notify(isEdit ? '角色已更新' : '角色已创建', 'success');
          await reload();
          return true;
        },
      });
      root.appendChild(overlay);
    }

    function confirmDelete(char) {
      const overlay = createModal({
        title: '删除角色',
        bodyHTML: `<p>确认删除角色「<strong>${esc(char.name)}</strong>」？此操作不可撤销。</p>
          <p class="dt-hint" style="font-size:12px;color:var(--ink-muted);">如存储后端不支持删除，会自动转为隐藏角色。</p>`,
        submitText: '确认删除', submitClass: 'dt-btn-danger',
        onSubmit: async () => {
          try {
            // 尝试通过写入特殊标记作为软删除
            const payload = Object.assign({}, char, { _deleted: true, role: '已删除·' + (char.role || '') });
            await DT().storage.saveCharacter(pid, payload);
            DT().notify('角色已删除（软删除）', 'success');
          } catch(e) {
            DT().notify('当前后端不支持删除：' + (e.message||e), 'warning');
            return false;
          }
          await reload();
          return true;
        },
      });
      root.appendChild(overlay);
    }

    renderList();
  }

  // ==================================================
  // View 5：关系网（力导向+缩放+关系编辑）
  // ==================================================
  function renderRelations(root, state, reload, pid) {
    const characters = state.characters.filter(c => !c._deleted);
    const existingEdges = (state.grouped.relations && state.grouped.relations.edges) || [];

    const wrap = document.createElement('div');
    wrap.className = 'dt-rel-page';

    const toolbar = document.createElement('div');
    toolbar.className = 'dt-toolbar';
    toolbar.innerHTML = `
      <div class="dt-toolbar-left">
        <div class="dt-filter-chips" data-type-filters>
          <span class="dt-filter-chip active" data-rel="all">全部关系</span>
          ${Object.keys(REL_COLORS).map(r => `<span class="dt-filter-chip" data-rel="${esc(r)}">${esc(r)}</span>`).join('')}
        </div>
      </div>
      <div class="dt-toolbar-actions">
        <button class="dt-btn" data-act="add-edge">＋ 新增关系</button>
        <button class="dt-btn" data-act="zoom-out">−</button>
        <button class="dt-btn" data-act="zoom-reset">⊙</button>
        <button class="dt-btn" data-act="zoom-in">＋</button>
        <button class="dt-btn" data-act="refresh">刷新</button>
      </div>`;
    wrap.appendChild(toolbar);
    root.appendChild(wrap);

    // 说明 + 关系边统计
    const info = document.createElement('div');
    info.className = 'dt-rel-info';
    info.innerHTML = `
      <div class="dt-stat-card-mini"><b>${characters.length}</b><span>角色节点</span></div>
      <div class="dt-stat-card-mini"><b>${existingEdges.length}</b><span>关系边</span></div>
      <div class="dt-rel-tip">💡 拖动节点调整位置；滚轮缩放画布；点击节点编辑角色；点击边编辑关系</div>`;
    wrap.appendChild(info);

    const svgWrap = document.createElement('div');
    svgWrap.className = 'dt-rel-svg-wrap';
    svgWrap.innerHTML = `<svg class="dt-rel-svg-v2" viewBox="0 0 800 600" width="100%" height="540">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a8a8a"/>
        </marker>
      </defs>
      <g data-group>
        <g data-edges></g>
        <g data-nodes></g>
      </g>
    </svg>`;
    wrap.appendChild(svgWrap);
    root.appendChild(wrap);

    // 初始化节点位置（环形）
    const W = 800, H = 600;
    const nodes = characters.map((c, i) => {
      const angle = (i / Math.max(1, characters.length)) * Math.PI * 2 - Math.PI / 2;
      const R = Math.min(W, H) / 2 - 90;
      return {
        id: c.name, char: c,
        x: W / 2 + R * Math.cos(angle),
        y: H / 2 + R * Math.sin(angle),
        vx: 0, vy: 0,
      };
    });
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    // 合并 edges：1) 已存储的 existingEdges；2) 从每个角色 relation 字段推断
    const inferred = [];
    nodes.forEach(n => {
      const rel = (n.char.relation || '') + ' / ' + (n.char.relation_to_protagonist || '');
      nodes.forEach(m => {
        if (m === n) return;
        if (rel.includes(m.char.name) && !existingEdges.find(e =>
            (e.from===n.id && e.to===m.id) || (e.from===m.id && e.to===n.id)
          ) && !inferred.find(e => (e.from===n.id&&e.to===m.id)||(e.from===m.id&&e.to===n.id))
        ) {
          let type = '其他';
          for (const t of Object.keys(REL_COLORS)) {
            if (rel.includes(t)) { type = t; break; }
          }
          // 从 relation_to_protagonist 推断
          const rtp = n.char.relation_to_protagonist || '';
          if (rtp === '自己' || rtp === '宿敌') type = rtp === '宿敌' ? '宿敌' : type;
          inferred.push({ from: n.id, to: m.id, label: rtp.slice(0, 14) || '有关联', type, _inferred: true });
        }
      });
    });
    const edges = [...existingEdges, ...inferred];

    // 状态
    let zoom = 1, panX = 0, panY = 0;
    let filterType = 'all';
    let dragging = null;
    let simTick = null;

    const svg = svgWrap.querySelector('svg');
    const group = svg.querySelector('[data-group]');
    const edgesG = svg.querySelector('[data-edges]');
    const nodesG = svg.querySelector('[data-nodes]');

    function applyTransform() {
      group.setAttribute('transform', `translate(${panX},${panY}) scale(${zoom})`);
    }

    function simulate() {
      // 简化力导向：节点互斥 + 边弹簧
      const nodesArr = [...nodes];
      for (let t = 0; t < 60; t++) {
        // 节点互斥
        for (let i = 0; i < nodesArr.length; i++) {
          for (let j = i + 1; j < nodesArr.length; j++) {
            const a = nodesArr[i], b = nodesArr[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let dist = Math.sqrt(dx*dx + dy*dy) || 1;
            const force = 5000 / (dist * dist);
            const fx = dx / dist * force, fy = dy / dist * force;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          }
        }
        // 边弹簧
        for (const e of edges) {
          const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
          if (!a || !b) continue;
          let dx = b.x - a.x, dy = b.y - a.y;
          let dist = Math.sqrt(dx*dx + dy*dy) || 1;
          const rest = 140;
          const force = (dist - rest) * 0.02;
          const fx = dx / dist * force, fy = dy / dist * force;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
        // 向中心
        for (const n of nodesArr) {
          n.vx += (W/2 - n.x) * 0.002;
          n.vy += (H/2 - n.y) * 0.002;
        }
        // 阻尼 + 位置
        for (const n of nodesArr) {
          if (n === dragging) continue;
          n.vx *= 0.85; n.vy *= 0.85;
          n.x += n.vx; n.y += n.vy;
          n.x = Math.max(50, Math.min(W - 50, n.x));
          n.y = Math.max(50, Math.min(H - 50, n.y));
        }
      }
    }

    function draw() {
      // 画边
      edgesG.innerHTML = '';
      edges.forEach((e, i) => {
        if (filterType !== 'all' && e.type !== filterType) return;
        const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
        if (!a || !b) return;
        const color = REL_COLORS[e.type] || '#7f8c8d';
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
        line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', e._inferred ? '1.2' : '2');
        line.setAttribute('stroke-dasharray', e._inferred ? '4 3' : '');
        line.setAttribute('marker-end', 'url(#arrow)');
        line.style.cursor = 'pointer';
        line.addEventListener('click', (ev) => { ev.stopPropagation(); openEdgeEditor(e, i); });
        edgesG.appendChild(line);
        if (e.label) {
          const tx = (a.x + b.x) / 2, ty = (a.y + b.y) / 2;
          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          const w = Math.max(50, e.label.length * 11 + 12);
          bg.setAttribute('x', tx - w / 2); bg.setAttribute('y', ty - 10);
          bg.setAttribute('width', w); bg.setAttribute('height', 20);
          bg.setAttribute('rx', 10); bg.setAttribute('fill', color);
          bg.setAttribute('opacity', 0.85);
          edgesG.appendChild(bg);
          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', tx); txt.setAttribute('y', ty + 4);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('fill', '#fff');
          txt.setAttribute('font-size', '11');
          txt.setAttribute('font-weight', '600');
          txt.textContent = e.label;
          txt.style.pointerEvents = 'none';
          edgesG.appendChild(txt);
        }
      });
      // 画节点
      nodesG.innerHTML = '';
      nodes.forEach((n, i) => {
        const color = n.char.color || COLOR_PALETTE[i % COLOR_PALETTE.length];
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${n.x},${n.y})`);
        g.style.cursor = 'grab';

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('r', '32'); halo.setAttribute('fill', color); halo.setAttribute('opacity', '0.18');
        g.appendChild(halo);

        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', '24'); c.setAttribute('fill', color);
        c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '2');
        g.appendChild(c);

        const initial = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        initial.setAttribute('text-anchor','middle'); initial.setAttribute('y','6');
        initial.setAttribute('fill','#fff'); initial.setAttribute('font-size','18');
        initial.setAttribute('font-weight','700');
        initial.textContent = (n.char.name||'?').charAt(0);
        initial.style.pointerEvents = 'none';
        g.appendChild(initial);

        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('text-anchor','middle'); lbl.setAttribute('y','48');
        lbl.setAttribute('fill','var(--ink-primary)'); lbl.setAttribute('font-size','13');
        lbl.setAttribute('font-weight','600');
        lbl.textContent = n.char.name || '';
        lbl.style.pointerEvents = 'none';
        g.appendChild(lbl);

        if (n.char.role) {
          const rl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          rl.setAttribute('text-anchor','middle'); rl.setAttribute('y','63');
          rl.setAttribute('fill','var(--ink-muted)'); rl.setAttribute('font-size','10');
          rl.textContent = n.char.role;
          rl.style.pointerEvents = 'none';
          g.appendChild(rl);
        }

        // 拖动
        let startX, startY, origX, origY, moved = false;
        g.addEventListener('pointerdown', (ev) => {
          ev.preventDefault(); moved = false;
          dragging = n;
          const pt = screenToSvg(ev);
          startX = pt.x; startY = pt.y; origX = n.x; origY = n.y;
          g.setPointerCapture && g.setPointerCapture(ev.pointerId);
          g.style.cursor = 'grabbing';
        });
        g.addEventListener('pointermove', (ev) => {
          if (dragging !== n) return;
          const pt = screenToSvg(ev);
          n.x = origX + (pt.x - startX);
          n.y = origY + (pt.y - startY);
          moved = true;
          draw();
        });
        g.addEventListener('pointerup', (ev) => {
          if (dragging === n) {
            dragging = null; g.style.cursor = 'grab';
          }
          if (!moved) {
            // 当作点击
            openCharViewer(n.char);
          }
        });
        g.addEventListener('pointercancel', () => { if (dragging===n) dragging = null; });

        nodesG.appendChild(g);
      });
    }

    function screenToSvg(ev) {
      const rect = svg.getBoundingClientRect();
      const scaleX = W / rect.width, scaleY = H / rect.height;
      return {
        x: (ev.clientX - rect.left) * scaleX,
        y: (ev.clientY - rect.top) * scaleY,
      };
    }

    simulate(); draw(); applyTransform();

    // 连续微小模拟（布局更稳定）
    simTick = setInterval(() => {
      if (dragging) return;
      for (let i = 0; i < 6; i++) simulateOneStep();
      draw();
    }, 80);
    function simulateOneStep() {
      const nodesArr = [...nodes];
      for (let i = 0; i < nodesArr.length; i++) {
        for (let j = i + 1; j < nodesArr.length; j++) {
          const a = nodesArr[i], b = nodesArr[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let dist = Math.sqrt(dx*dx + dy*dy) || 1;
          if (dist > 400) continue;
          const force = 2000 / (dist * dist);
          const fx = dx/dist*force, fy = dy/dist*force;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      for (const e of edges) {
        const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
        if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx*dx + dy*dy) || 1;
        const force = (dist - 140) * 0.01;
        const fx = dx/dist*force, fy = dy/dist*force;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (const n of nodesArr) {
        if (n === dragging) continue;
        n.vx *= 0.9; n.vy *= 0.9;
        if (Math.abs(n.vx) < 0.05 && Math.abs(n.vy) < 0.05) continue;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(50, Math.min(W - 50, n.x));
        n.y = Math.max(50, Math.min(H - 50, n.y));
      }
    }
    // 清理
    const oldObserver = new MutationObserver(() => {});
    const ro = new ResizeObserver(() => {});
    const origRemove = wrap.remove;
    wrap._cleanup = () => { if (simTick) clearInterval(simTick); };
    // 使用 MutationObserver 检测 DOM 移除
    const mo = new MutationObserver(() => {
      if (!document.body.contains(wrap)) {
        if (simTick) clearInterval(simTick);
        mo.disconnect();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // 画布缩放
    svgWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = -Math.sign(e.deltaY);
      const factor = delta > 0 ? 1.12 : 0.9;
      zoom = Math.max(0.3, Math.min(3, zoom * factor));
      applyTransform();
    }, { passive: false });

    toolbar.querySelector('[data-act="zoom-in"]').addEventListener('click', () => { zoom = Math.min(3, zoom*1.2); applyTransform(); });
    toolbar.querySelector('[data-act="zoom-out"]').addEventListener('click', () => { zoom = Math.max(0.3, zoom/1.2); applyTransform(); });
    toolbar.querySelector('[data-act="zoom-reset"]').addEventListener('click', () => { zoom = 1; panX = 0; panY = 0; applyTransform(); });
    toolbar.querySelector('[data-act="refresh"]').addEventListener('click', reload);
    toolbar.querySelector('[data-act="add-edge"]').addEventListener('click', () => openEdgeEditor(null, -1));
    toolbar.querySelectorAll('[data-type-filters] .dt-filter-chip').forEach(c => {
      c.addEventListener('click', () => {
        toolbar.querySelectorAll('[data-type-filters] .dt-filter-chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        filterType = c.dataset.rel;
        draw();
      });
    });

    function openCharViewer(c) {
      // 简化 viewer：复用角色模块的查看器（通过事件？直接导入可能复杂，这里做一个简化模态）
      const color = c.color || '#3498db';
      const fields = [
        ['角色定位', c.role], ['身份', c.identity], ['境界', c.level],
        ['性格', c.personality], ['核心目标', c.goal || c.motivation], ['弧光', c.arc],
        ['关系', c.relation], ['背景', c.background],
      ];
      const overlay = createModal({
        title: `👤 ${c.name || '角色'} · 档案`,
        size: 'large',
        bodyHTML: `
          <div class="dt-char-viewer-head" style="border-left:4px solid ${esc(color)}">
            <div class="dt-char-avatar" style="background:${esc(color)};width:56px;height:56px;font-size:22px;">${esc((c.name||'?').charAt(0))}</div>
            <div><h3 style="margin:0;">${esc(c.name||'')}</h3>
              <div>${c.role ? `<span class="dt-tag">${esc(c.role)}</span>` : ''} ${c.level ? `<span class="dt-tag dt-tag-type">${esc(c.level)}</span>` : ''} ${c.identity ? `<span class="dt-tag">💼 ${esc(c.identity)}</span>` : ''}</div>
            </div>
          </div>
          <div class="dt-char-viewer-fields">
            ${fields.filter(([,v])=>v).map(([k,v])=>`
              <div class="dt-char-viewer-field"><div class="dt-char-viewer-key">${esc(k)}</div>
              <div class="dt-char-viewer-value">${esc(String(v))}</div></div>`).join('')}
          </div>`,
        submitText: '在角色模块编辑',
        onSubmit: async () => { return false; },
      });
      root.appendChild(overlay);
    }

    function openEdgeEditor(edge, idx) {
      const isNew = !edge;
      const data = edge ? { ...edge } : { from: '', to: '', label: '', type: '友情' };
      const overlay = createModal({
        title: isNew ? '新增角色关系' : '编辑关系',
        size: 'large',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row dt-form-row-2col">
              <div><label>角色 A <span class="dt-req">*</span></label>
                <select data-f="from">
                  <option value="">— 选择 —</option>
                  ${characters.map(c => `<option value="${esc(c.name)}" ${data.from===c.name?'selected':''}>${esc(c.name)}${c.role?' · '+esc(c.role):''}</option>`).join('')}
                </select></div>
              <div><label>角色 B <span class="dt-req">*</span></label>
                <select data-f="to">
                  <option value="">— 选择 —</option>
                  ${characters.map(c => `<option value="${esc(c.name)}" ${data.to===c.name?'selected':''}>${esc(c.name)}${c.role?' · '+esc(c.role):''}</option>`).join('')}
                </select></div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>关系类型</label>
                <select data-f="type">
                  ${Object.keys(REL_COLORS).map(t => `<option value="${esc(t)}" ${data.type===t?'selected':''}>${esc(t)}</option>`).join('')}
                </select></div>
              <div><label>关系标签（简短描述）</label>
                <input type="text" data-f="label" value="${esc(data.label||'')}" placeholder="如：师徒 / 杀父之仇 / 青梅竹马"/></div>
            </div>
            ${!isNew ? `<p class="dt-hint" style="font-size:12px;color:var(--ink-muted);">虚线关系 = 从角色 relation 字段自动推断，可在此手动覆盖为实线</p>` : ''}
          </div>`,
        submitText: isNew ? '创建关系' : '保存',
        submitClass: isNew ? 'dt-btn-primary' : 'dt-btn-primary',
        onSubmit: async (formEl) => {
          const get = (k) => (formEl.querySelector(`[data-f="${k}"]`) || { value: '' }).value.trim();
          const from = get('from'), to = get('to');
          if (!from || !to) { DT().notify('请选择两个角色', 'warning'); return false; }
          if (from === to) { DT().notify('不能选同一个角色', 'warning'); return false; }
          const newEdge = { from, to, type: get('type'), label: get('label') };
          // 移除旧的同 from-to 关系（含推断），写入新的
          const filtered = edges.filter(e => !((e.from===from && e.to===to) || (e.from===to && e.to===from)) || e._inferred===false);
          // 如果存在推断的同对边，也移除
          const clean = filtered.filter(e => !((e.from===from && e.to===to) || (e.from===to && e.to===from)));
          clean.push(newEdge);
          const toSave = clean.filter(e => !e._inferred); // 只存手动创建的
          await saveRelations(pid, toSave);
          DT().notify(isNew ? '关系已创建' : '已保存', 'success');
          await reload();
          return true;
        },
      });
      root.appendChild(overlay);
      // 提供删除按钮
      if (!isNew) {
        const delBtn = document.createElement('button');
        delBtn.className = 'dt-btn dt-btn-danger';
        delBtn.textContent = '删除此关系';
        delBtn.style.marginRight = 'auto';
        delBtn.addEventListener('click', async () => {
          if (idx >= 0 && idx < edges.length) {
            const target = edges[idx];
            const clean = edges.filter(e => e !== target);
            const toSave = clean.filter(e => !e._inferred);
            await saveRelations(pid, toSave);
            DT().notify('关系已删除', 'success');
            overlay.querySelector('[data-act="close"]').click();
            await reload();
          }
        });
        const footer = overlay.querySelector('.dt-modal-footer');
        footer.insertBefore(delBtn, footer.firstChild);
      }
    }
  }

  // ==================================================
  // View 6：剧情结构
  // ==================================================
  function renderPlot(root, state, reload, pid) {
    const prefix = 'plot';
    const subs = [
      { key:'mainline', icon:'🎯', name:'主线一句话',
        tip:'电梯测试：30 秒说清楚这部小说讲了什么故事',
        placeholder: `# 主线一句话\n\n## 一句话概括（推荐公式：身份 + 金手指 + 核心冲突 + 最终目标）\n\n「经脉狭窄被视为废柴的青云宗杂役少年沈砚，在后山剑冢拾到承载上古剑尊残识的残剑「问渊」，以剑骨交换代价一路叩问天道，最终揭开神祇故土封印的真相，重写被天道篡改的剑道法则。」\n\n## 核心卖点（爽点根因）\n- 反差：杂役废柴 → 天道挑战者（身份反差）\n- 代价：每一次变强都伴随失去（情感张力）\n- 悬念：残剑的过去 = 主角的身世（谜题钩连）\n- 终极燃点：凡人以一柄残剑，单挑被改写的天道（史诗感）\n\n## 核心冲突\n- 外部冲突：无相门灭门之仇、天道封印压制\n- 内部冲突：变强的代价是否值得？\n- 哲学冲突：「天道注定」 vs 「我命由我」` },
      { key:'arcs',     icon:'📚', name:'卷 / 弧划分',
        tip:'每卷一个小目标 + 一个小高潮，卷与卷之间换地图+换反派+金手指升级',
        placeholder: `# 卷 / 弧划分（建议每卷 30-80 章）\n\n## 卷一 · 锋未鸣（1-22 章）\n- **小目标**：在外门活下去 + 通过内门考核\n- **小高潮**：第 5 章「斩第一人」（以练气九层斩筑基内门第一）\n- **核心功能**：立人设 + 残剑金手指登场 + 外门冲突爆发\n- **换地图**：青云宗外门 → 北上渡寒江\n\n## 卷二 · 渡寒江（23-42 章）\n- **小目标**：穿过寒江，活着抵达渊海口\n- **小高潮**：第 41 章「寒江沉剑」（残剑吸收第二截剑骨，代价失忆）\n- **核心功能**：扩大世界观 + 引入妖族线 + 反派无相门正式登场\n- **换地图**：寒江 → 东海渊海\n\n## 卷三 · 渊海沉璧（43-80 章）★ 中期爆发\n- **小目标**：取得「沉璧」第三截剑骨\n- **小高潮**：第 65 章「沉璧现世」（金手指升级）、第 80 章「剑尊残识苏醒」（卷三大爆点）\n- **核心功能**：金手指升级 + 海族势力交锋 + 剑尊残识苏醒\n- **换地图**：渊海 → 神祇故土外围\n\n## 卷四 · 神祇故土（81-160 章）★ 真相揭露\n- **小目标**：进入神祇故土，揭开诸神陨落真相\n- **小高潮**：挚友云栖决裂 + 沈砚身世揭穿\n- **核心功能**：世界观真相全部摊牌 + 主角成长弧光转捩点\n\n## 卷五 · 问剑长歌（161-220 章）★ 终局\n- **小目标**：以残剑叩问天道，重写剑道法则\n- **大高潮**：长歌一曲，万剑归宗（残剑完整，付出最终代价）\n- **核心功能**：所有伏笔回收，主线与人物弧光全部收束。` },
      { key:'rhythm',   icon:'🎢', name:'节奏曲线',
        tip:'爽→压→爽→大压→大爽，不能一直爽也不能一直压',
        placeholder: `# 节奏曲线设计\n\n## 基础循环单元\n  爽（打脸/小升级） → 压（新危机/旧敌回归/代价发作） → 爽（破局/越阶/关系进展） → 大压（生死/背叛/失去珍视之人） → 大爽（爆种/伏笔回收/境界质变）\n\n## 节奏密度表\n| 层级 | 频率 | 强度范围 | 举例 |\n|------|------|----------|------|\n| 微爽 | 每 1-2 章 | 5-6 分 | 小打脸、小道具到手 |\n| 小爽 | 每 5 章 | 7-8 分 | 金手指小升级、小越阶 |\n| 中爽 | 每 15 章 | 8-9 分 | 大越阶、身份曝光、关系升温 |\n| 大爽（卷末） | 每卷末 | 9-10 分 | 境界突破、大反派受挫、金手指质变 |\n| 爆点 | 每 50-80 章 | 10 分 | 核心伏笔回收、世界观真相揭露 |\n\n## 低谷设计（必须有！）\n- 卷一中段：被诬陷逐出外门，寒毒发作濒死\n- 卷二末：残剑反噬，忘记母亲的脸\n- 卷四中：挚友决裂 + 身世真相 = 道心动摇，修为尽失 30 天\n\n## 爽点类型配比\n打脸 30% + 金手指升级 25% + 关系进展 15% + 装逼/身份曝光 15% + 真相揭露 15%` },
      { key:'hooks',    icon:'🪝', name:'伏笔管理',
        tip:'哪里埋了伏笔、计划在哪里回收；H-001 级别 P0 必须有日期',
        placeholder: `# 伏笔管理\n\n> 完整登记表已在「伏笔」模块维护，这里汇总剧情结构层面的大伏笔\n\n## P0 级（主线相关，忘记会崩）\n| 编号 | 伏笔 | 埋设章 | 计划回收 | 关联剧情线 |\n|------|------|--------|----------|------------|\n| H-001 | 残剑「问渊」的来历 | 1 | 65（沉璧）+ 卷五 | 金手指主线 |\n| H-002 | 沈砚身世之谜 | 3 | 卷四 | 人物主线 |\n| H-004 | 无相门灭门之仇 | 28 | 卷五 | 反派主线 |\n| H-005 | 神祇故土的封印 | 42 | 卷四 | 世界观主线 |\n| H-006 | 剑尊残识的真正目的 | 80 | 卷五 | 终极反转 |\n\n## P1 级（角色/情感）\n| 编号 | 伏笔 | 埋设章 | 计划回收 |\n|------|------|--------|----------|\n| H-003 | 阿箩的妖族血脉 | 35 | 卷三末 |\n| H-008 | 母亲留下的铜簪 | 1 | 卷四（身世揭晓时） |\n| H-009 | 云栖父亲的死因 | 卷一 | 卷四决裂时 |\n\n## 超期预警机制\n- 埋设后 30 章未回收 → 黄色提醒（出现在创作焦点页）\n- 埋设后 50 章未回收 → 红色阻断（执笔前强制弹窗）` },
      { key:'subplots', icon:'🌿', name:'支线',
        tip:'丰富世界观、丰满配角，但不能喧宾夺主',
        placeholder: `# 支线列表\n\n## 支线设计三原则\n1. 每条支线必须**服务主线**（要么丰满配角动机，要么补充世界观规则，要么为主线埋伏笔）\n2. 单支线长度 ≤ 10 章\n3. 支线结束必须**回馈主线**（主角获得能力/信息/人脉/代价）\n\n## 已规划支线\n| 编号 | 支线名 | 主角团成员 | 章数 | 回馈主线 |\n|------|--------|------------|------|----------|\n| S-01 | 阿箩寻亲 | 阿箩视角 | 6（卷二） | 阿箩九尾血脉初步觉醒 |\n| S-02 | 海族祭司之托 | 沈砚+阿箩 | 5（卷三初） | 获得渊海地图 + 沉璧位置线索 |\n| S-03 | 云栖下山历练 | 云栖单线 | 8（卷二中） | 揭示其父亲与无相门的关联（卷四决裂铺垫） |\n| S-04 | 散修集市淘宝 | 沈砚+海族小队长 | 4（卷三前） | 淘到母亲遗物铜簪的同款碎片（H-008 加深） |\n\n## 被砍掉的废案（记录避免重复走坑）\n- ❌ 青云宗内斗 20 章大支线：与卷一「辞山」目标冲突，压缩为 5 章内斗 + 赶走` },
    ];
    subs.forEach(s => {
      s._getCurrent = () => (state.grouped[prefix] && state.grouped[prefix][s.key]) ? state.grouped[prefix][s.key].content : '';
    });
    const tabCtrlHolder = { ctrl: null };
    const tabDefs = subs.map(s => ({
      key: s.key, icon: s.icon, name: s.name,
      render: makeDimensionEditor({
        title: `${s.icon} ${s.name}`, tip: s.tip, placeholder: s.placeholder,
        getCurrent: s._getCurrent,
        prefix, tabKey: s.key, allTabs: subs,
        getTabCtrl: () => tabCtrlHolder.ctrl,
        state, pid, reload,
      }),
    }));
    tabCtrlHolder.ctrl = createSubTabs(root, tabDefs);
  }

  // ==================================================
  // View 7：杂项
  // ==================================================
  function renderMisc(root, state, reload, pid) {
    const prefix = 'misc';
    const subs = [
      { key:'timeline', icon:'📅', name:'大事年表 / 时间线',
        tip:'历史事件 + 故事内时间，避免前后矛盾。卷三发生在故事内第几春？',
        placeholder: `# 大事年表 / 时间线\n\n## 上古（故事开始前 10000+ 年）\n- **诸神陨落**：上古诸神对决，天道被改写，神祇故土被封印\n- **问渊剑尊战死**：本命剑「问渊」碎裂，剑骨散于天下\n\n## 古代（故事开始前 200 年）\n- 无相门创立：祖上为剑尊仇家，发誓夺回剑骨复仇\n- 青云宗建宗于鹤鸣山\n\n## 故事主线时间\n### 故事第 1 年 · 春\n- 第 1 章：沈砚（16 岁）剑冢拾剑\n- 第 3-5 章：外门大比，剑意觉醒\n- 第 22 章：辞山北上\n\n### 故事第 1 年 · 冬\n- 第 23 章：抵达寒江，冰封期渡江\n- 第 28 章：无相门首次截杀\n- 第 35 章：阿箩现身于雪夜破庙\n\n### 故事第 2 年 · 春\n- 第 42 章：到达渊海口，立誓\n- 第 43 章：卷三开启，进入东海\n\n## 年龄时间线（关键节点）\n| 年份 | 沈砚年龄 | 大事件 |\n|------|----------|--------|\n| 故事 0 年 | 16 | 剑冢拾剑 |\n| 故事 1 年 | 17 | 筑基成功 / 阿箩加入 |\n| 故事 2 年 | 18 | 金丹 / 剑尊残识苏醒 |\n| 故事 5 年 | 21 | 元婴 / 进入神祇故土 |\n| 故事 8 年 | 24 | 化神 / 卷五终局` },
      { key:'glossary', icon:'📖', name:'名词表 / 设定百科',
        tip:'所有专有名词、地名、功法名统一定义。避免 40 章写「青云宗」50 章写成「青峰宗」',
        placeholder: `# 名词表 / 设定百科\n\n> 建议：在章节中第一次出现的专有名词，都要加回链到这里\n\n## 核心道具\n| 名词 | 定义 / 说明 | 首次出场 |\n|------|-------------|----------|\n| 残剑·问渊 | 上古剑尊问渊的本命剑碎片，承载剑尊残识 | 第 1 章 |\n| 剑骨 | 剑修死后凝结的本命剑精华，问渊剑可吸收补全 | 第 1 章（概念）/ 第 41 章（吸收第二截） |\n| 沉璧 | 问渊剑的第三截剑骨，藏于渊海深处 | 第 42 章 |\n| 铜簪 | 沈砚母亲留下的唯一遗物，实为神祇故土封印碎片 | 第 1 章 |\n\n## 地理名词\n| 名词 | 定义 |\n|------|------|\n| 青云宗 | 正道三大宗门之一，宗址中州鹤鸣山 |\n| 鹤鸣山 | 青云宗所在，后山有剑冢遗迹 |\n| 寒江 | 中州与北荒的界河，冬结坚冰，江底沉有第二截剑骨 |\n| 渊海 | 东海极东的秘境海域，海族三王分治，卷三主舞台 |\n| 无相门·隐谷 | 北荒深山中的无相门总部位置 |\n| 神祇故土 | 上古诸神陨落之地，被天道封印，卷四入口 |\n\n## 境界 / 修炼名词\n| 名词 | 定义 |\n|------|------|\n| 练气九层 | 修士入门，感知灵气 |\n| 剑修 vs 普通修士 | 剑修以「剑意」为核心，可越阶但破境更难 |\n| 剑心通明 | 剑修筑基后第一个关键心境，可辨真伪 |\n| 问渊十三剑 | 古法剑法，随残剑完整度解锁 |\n\n## 宗门 / 势力名词\n| 名词 | 说明 |\n|------|------|\n| 青云宗 | 正道三派之一，主角阵营 |\n| 玄都观 | 正道三派之一，丹修最强 |\n| 儒家书院 | 正道三派之一，修浩然气 |\n| 无相门 | 本作主要反派势力，专司刺杀 |\n| 渊海三王 | 海族分治三方的三位王者：白鲨（商）、玄龟（守）、赤蛟（战） |\n\n## 文化 / 习俗\n| 名词 | 说明 |\n|------|------|\n| 拜剑礼 | 剑修入门/突破时的仪式，向本命剑三拜 |\n| 问心酒 | 宗门大比前立誓酒 |\n| 血祭禁忌 | 以凡人精血修炼 = 正道公敌` },
      { key:'tone',     icon:'🎨', name:'基调与风格',
        tip:'热血？暗黑？搞笑？种田？基调决定一切设定的「味道」',
        placeholder: `# 基调与风格\n\n## 一句话风格\n东方玄幻 · 燃向 · 偏黑暗底色+热血内核 · 情感细腻 · 代价感强烈\n\n## 风格光谱定位\n| 维度 | 选择（两端取中间位置请打勾） | 说明 |\n|------|------------------------------|------|\n| 主色调 | ■ 冷色系（深蓝/暗金）/□ 暖色系 | 配合「剑」的锋利感 + 代价的沉重感 |\n| 搞笑度 | □ 高 /□ 中 / ■ 低 | 正剧风，偶尔用配角冷幽默调节 |\n| 虐度 | □ 无虐 / ■ 中虐（有代价有失去）/□ 高虐 | 每次变强都要失去，虐是爽的前提 |\n| 爽度密度 | □ 爽文快餐 / ■ 爽压交织 /□ 慢热 | 爽→压→爽 循环 |\n| 感情线占比 | □ 无女主 / ■ 20% 情感线 /□ 50% | 情感线 = 互相救赎，不拖主线 |\n| 世界观深度 | □ 背景板 / ■ 深层隐喻 /□ 哲学向 | 天道封印=被操控的命运 |\n\n## 文风 / 语言指纹约束（作者声音）\n- 禁用：「嘴角微微上扬」「眼中闪过一丝」等 AI 常用句式（check_ai_novel.py 会检测）\n- 偏好：短句 + 留白（打斗快、情感慢）\n- 战斗描写：镜头切（环境→兵器→人→眼神→一刀结束）\n- 情感描写：心理描写 ≠ 直白独白，用生理反应（握拳/指节发白/呼吸停顿）映射\n\n## 封面 / 标题风格\n- 书名：问剑长歌（4 字 · 动词+意象）\n- 卷名：ABAB 结构（锋未鸣、渡寒江、渊海沉璧、神祇故土、问剑长歌）\n- 章名：2-5 字 · 名词/意象型（寒江尽头、无相追杀、沉璧传说）\n\n## 对标作品（口味锚点）\n- 《剑来》：文气+道理型打斗 × 我们的爽度更密\n- 《诡秘之主》：代价金手指+世界观真相揭露 √ 我们也是代价驱动\n- 《斗破苍穹》：退婚流爽文模板 × 我们虐度更低，代价更真实\n- 《道诡异仙》：疯狂感 × 我们底色温暖，代价但不绝望` },
    ];
    subs.forEach(s => {
      s._getCurrent = () => (state.grouped[prefix] && state.grouped[prefix][s.key]) ? state.grouped[prefix][s.key].content : '';
    });
    const tabCtrlHolder = { ctrl: null };
    const tabDefs = subs.map(s => ({
      key: s.key, icon: s.icon, name: s.name,
      render: makeDimensionEditor({
        title: `${s.icon} ${s.name}`, tip: s.tip, placeholder: s.placeholder,
        getCurrent: s._getCurrent,
        prefix, tabKey: s.key, allTabs: subs,
        getTabCtrl: () => tabCtrlHolder.ctrl,
        state, pid, reload,
      }),
    }));
    tabCtrlHolder.ctrl = createSubTabs(root, tabDefs);
  }

  // ---------- 导出 ----------
  NS.renderSettings = renderSettings;
})(window);
