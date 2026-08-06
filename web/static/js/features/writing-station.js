/**
 * DreamTale · 写作工作站（三栏沉浸式写作）
 *
 * 仿照起点/番茄作家后台：
 * - 左栏：大纲联动章节树（卷分组 + 章纲浮层 + 状态徽标 + 拖拽）
 * - 中栏：MarkdownEditor 增强版（@提及 + 排版优化 + AI 工具栏钩子）
 * - 右栏：多模块速览（角色/设定/伏笔/搜索百科），智能关键词增量匹配
 * - 视图配置 + 专注模式 + 写作目标/打卡 + AI 接入点
 *
 * 通过 window.DreamTaleFeatures.renderWritingStation(container) 挂载。
 * 替换原 renderChapters 作为 #/chapters 的主视图。
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ==================== 工具 ====================
  function DT() {
    if (!global.DreamTale) throw new Error('[writing-station] window.DreamTale 未初始化');
    return global.DreamTale;
  }
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function padVol(n) { return String(n).padStart(2, '0'); }
  function padCh(n) { return String(n).padStart(3, '0'); }
  function chKey(c) { return c.vol_no + ':' + c.ch_no; }
  function load(key, dft) { try { const v = localStorage.getItem(key); return v == null ? dft : JSON.parse(v); } catch (_) { return dft; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} }

  // ==================== 默认视图配置 ====================
  const DEFAULT_CONFIG = {
    showRoles: true,
    showSettings: true,
    showHooks: true,
    showEncyclopedia: true,
    showSearch: true,
    showWritingGoal: true,
    showAIToolbar: true,
  };
  const CONFIG_KEY = 'dreamtale:ws:config';
  const GOAL_KEY = 'dreamtale:ws:goal';
  const STREAK_KEY = 'dreamtale:ws:streak';

  // ==================== 虚拟设定词汇（真实项目时从 storage 拉取） ====================
  function buildMockVocab() {
    return {
      roles: [
        { id: '沈砚', name: '沈砚', brief: '主角，青云宗外门→剑修，境界筑基后期，性格隐忍清醒' },
        { id: '阿箩', name: '阿箩', brief: '女主，妖族九尾狐裔，化形中期，外冷内热护短' },
        { id: '问渊剑尊', name: '问渊剑尊', brief: '金手指/引路人，上古剑尊残识，冷漠寡言亦师亦敌' },
        { id: '裴矩', name: '裴矩', brief: '反派，无相门门主，化神初期，温文尔雅阴鸷记仇' },
        { id: '云栖', name: '云栖', brief: '挚友，青云宗内门师兄，筑基大圆满，爽朗重情刚直' },
        { id: '赤蛟王', name: '赤蛟王', brief: '卷三反派，渊海三王之一，化神中期，暴烈傲慢重诺' },
      ],
      places: [
        { id: '青云宗', name: '青云宗', brief: '主角出身地，中州鹤鸣山，分外门/内门/剑峰' },
        { id: '寒江', name: '寒江', brief: '南北分界之江，江底沉有上古剑骨，冬结冰桥夏行水怪' },
        { id: '无相门', name: '无相门', brief: '北荒隐谷，专司刺杀，与上古剑尊有灭门之仇' },
        { id: '渊海', name: '渊海', brief: '东海极东，卷三主舞台，海族三王分治，沉璧剑骨藏渊心' },
        { id: '神祇故土', name: '神祇故土', brief: '天地之外，上古诸神陨落之地，卷四入口，被天道封印' },
        { id: '剑冢', name: '剑冢', brief: '青云宗后山，万剑归葬之地，残剑问渊出土处' },
      ],
      items: [
        { id: '问渊', name: '残剑「问渊」', brief: '上古剑尊佩剑残片，可吸收剑骨逐步完整，每得一截获对应剑尊记忆' },
        { id: '沉璧', name: '沉璧剑骨', brief: '渊海渊心所藏上古剑骨，卷三核心宝物，对应金手指升级大爆点' },
      ],
      arts: [
        { id: '问渊九式', name: '问渊九式', brief: '上古剑尊所传绝世剑法，共九式，沈砚目前习得前三式' },
        { id: '青云剑诀', name: '青云剑诀', brief: '青云宗入门基础剑法，共七十二路，沈砚已炉火纯青' },
      ],
    };
  }

  // ==================== 主渲染入口 ====================
  async function renderWritingStation(container) {
    if (!container) throw new Error('[writing-station] container 不能为空');
    container.innerHTML = '';
    const pid = getProjectId();
    if (!pid) {
      container.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    // ---------- 状态 ----------
    const state = {
      pid,
      chapters: [],
      volumes: [],
      currentCh: null,
      editor: null,
      dirty: false,
      autoSaveTimer: null,
      vocab: buildMockVocab(),
      config: load(CONFIG_KEY, { ...DEFAULT_CONFIG }),
      goal: load(GOAL_KEY, { daily: 6000, today: 0, date: todayStr() }),
      streak: load(STREAK_KEY, { days: 0, last: '' }),
      rolesInChapter: [],     // 当前章节出现的角色（用于右侧速览）
      settingsInChapter: [],  // 当前章节出现的设定/地点/功法/物品
      hooksInChapter: [],     // 当前章节涉及的伏笔
      allHooks: [],           // 所有真实伏笔（从 storage.listHooks 拉取）
      lastScannedLen: 0,      // 增量扫描用
      atPopoverEl: null,
      atQueryMode: false,
      atTab: '角色',
    };
    function debounce(fn, wait = 200) {
      let t = null;
      return function (...a) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, a), wait);
      };
    }
    // 重置今日写作字数（如果是新的一天）
    if (state.goal.date !== todayStr()) {
      state.goal = { daily: state.goal.daily || 6000, today: 0, date: todayStr() };
      save(GOAL_KEY, state.goal);
      // 连续打卡更新：如果昨天写了，+1，否则重置
      const y = yesterdayStr();
      if (state.streak.last === y) state.streak.days = (state.streak.days || 0) + 1;
      else if (state.streak.last !== todayStr()) state.streak.days = 0;
      save(STREAK_KEY, state.streak);
    }

    // ---------- 渲染三栏骨架 ----------
    container.innerHTML = `
      <div class="ws-shell" id="ws-shell" data-theme="${DT().state.theme || 'light'}">
        <!-- 左栏：大纲/章节列表 -->
        <aside class="ws-left" id="ws-left">
          <div class="ws-left-toolbar">
            <button class="ws-btn ws-btn-primary ws-btn-sm" data-act="new-ch">+ 新章</button>
            <button class="ws-btn ws-btn-sm" data-act="refresh" title="刷新">⟳</button>
          </div>
          <div class="ws-chapter-list" id="ws-chapter-list"><p class="dt-empty-hint">加载中…</p></div>
        </aside>
        <!-- 中栏：编辑器 + 顶/底栏 -->
        <section class="ws-center">
          <div class="ws-toolbar" id="ws-toolbar">
            <div class="ws-tb-left">
              <button class="ws-btn ws-btn-sm ws-btn-ghost" data-act="toggle-left" title="折叠左栏">◀ 章节</button>
            </div>
            <div class="ws-tb-mid">
              <span class="ws-title-vol" id="ws-title-vol">第 -- 卷</span>
              <span class="ws-title-ch" id="ws-title-ch">第 --- 章</span>
              <input type="text" class="ws-title-input" id="ws-title-input" placeholder="章节标题（点击编辑）" />
            </div>
            <div class="ws-tb-right">
              <button class="ws-btn ws-btn-sm ws-btn-ghost" data-act="config" title="视图配置">⚙️</button>
              <button class="ws-btn ws-btn-sm ws-btn-ghost" data-act="focus" title="专注写作模式（Ctrl+Shift+F）">🎯 专注</button>
              <select class="ws-status-sel" id="ws-status-sel" title="章节状态">
                <option value="draft">草稿</option><option value="todo">待写</option><option value="published">已发</option>
              </select>
              <button class="ws-btn ws-btn-sm ws-btn-primary" data-act="save" title="保存（Ctrl+S）">💾 保存</button>
            </div>
          </div>
          <div class="ws-editor-wrap" id="ws-editor-wrap">
            <div class="dt-ch-empty" id="ws-empty"><p>👈 请从左侧选择一个章节开始写作</p><p>或点击「+ 新章」创建新章节</p></div>
          </div>
          <div class="ws-bottom-bar" id="ws-bottom-bar">
            <div class="ws-goal" id="ws-goal">
              <span class="ws-streak" id="ws-streak" title="连续写作打卡">🔥 0</span>
              <div class="ws-goal-progress" title="今日写作进度">
                <div class="ws-goal-bar" id="ws-goal-bar"></div>
                <span class="ws-goal-text" id="ws-goal-text">0 / 6000 字</span>
              </div>
            </div>
            <div class="ws-wc" id="ws-wc">字数：0</div>
            <div class="ws-tools">
              <button class="ws-btn ws-btn-xs ws-btn-ghost" data-act="format" title="小说排版一键优化">📝 排版优化</button>
              <button class="ws-btn ws-btn-xs ws-btn-ghost" data-act="ai-panel" title="AI 辅助面板">🤖 AI</button>
            </div>
          </div>
        </section>
        <!-- 右栏：速览面板 -->
        <aside class="ws-right" id="ws-right">
          <div class="ws-search" id="ws-search">
            <input type="text" id="ws-search-input" placeholder="🔍 搜索设定百科（角色/地点/功法/物品）…" />
            <div class="ws-search-results" id="ws-search-results"></div>
          </div>
          <div class="ws-panel" id="ws-panel-encyclopedia" data-panel="encyclopedia">
            <div class="ws-panel-title">📚 设定百科速览</div>
            <div class="ws-panel-body" id="ws-panel-encyclopedia-body"><p class="ws-empty">写作时会自动识别正文中的设定词条，可点击「📚 全览」打开完整设定百科</p></div>
          </div>
          <div class="ws-panel" id="ws-panel-hooks" data-panel="hooks">
            <div class="ws-panel-title">🪝 伏笔提醒</div>
            <div class="ws-panel-body"><p class="ws-empty">本章暂无关联伏笔</p></div>
          </div>
          <div class="ws-panel" id="ws-panel-roles" data-panel="roles">
            <div class="ws-panel-title">👥 本章角色速览</div>
            <div class="ws-panel-body"><p class="ws-empty">写作时会自动识别文中出现的角色</p></div>
          </div>
          <div class="ws-panel" id="ws-panel-settings" data-panel="settings">
            <div class="ws-panel-title">⚙️ 本章设定速览</div>
            <div class="ws-panel-body"><p class="ws-empty">写作时会自动识别提及的地点/功法/物品</p></div>
          </div>
        </aside>
      </div>
      <!-- AI 浮动工具栏 -->
      <div class="ws-ai-float" id="ws-ai-float">
        <button class="ws-ai-btn" data-ai="outline" title="📋 AI 写章纲">📋</button>
        <button class="ws-ai-btn" data-ai="check" title="✅ AI 查错">✅</button>
        <button class="ws-ai-btn" data-ai="polish" title="✨ AI 润色">✨</button>
        <button class="ws-ai-btn" data-ai="continue" title="➡️ AI 续写">➡️</button>
        <button class="ws-ai-btn" data-ai="highlight" title="🔥 AI 想爽点">🔥</button>
      </div>
      <!-- @提及 选择器 -->
      <div class="ws-at-popover" id="ws-at-popover" style="display:none;">
        <div class="ws-at-tabs">
          <button class="ws-at-tab active" data-tab="角色">角色</button>
          <button class="ws-at-tab" data-tab="地点">地点</button>
          <button class="ws-at-tab" data-tab="功法">功法</button>
          <button class="ws-at-tab" data-tab="物品">物品</button>
        </div>
        <div class="ws-at-list" id="ws-at-list"></div>
      </div>
    `;

    const shell = container.querySelector('#ws-shell');
    const listEl = container.querySelector('#ws-chapter-list');
    const editorWrap = container.querySelector('#ws-editor-wrap');
    const emptyEl = container.querySelector('#ws-empty');
    const volEl = container.querySelector('#ws-title-vol');
    const chEl = container.querySelector('#ws-title-ch');
    const titleInput = container.querySelector('#ws-title-input');
    const statusSel = container.querySelector('#ws-status-sel');
    const wcEl = container.querySelector('#ws-wc');
    const goalBar = container.querySelector('#ws-goal-bar');
    const goalText = container.querySelector('#ws-goal-text');
    const streakEl = container.querySelector('#ws-streak');
    const panelHooks = container.querySelector('#ws-panel-hooks');
    const panelRoles = container.querySelector('#ws-panel-roles');
    const panelSettings = container.querySelector('#ws-panel-settings');
    const panelEncyclopedia = container.querySelector('#ws-panel-encyclopedia');
    const panelEncyclopediaBody = container.querySelector('#ws-panel-encyclopedia-body');
    const searchWrap = container.querySelector('#ws-search');
    const searchInput = container.querySelector('#ws-search-input');
    const searchResults = container.querySelector('#ws-search-results');
    const aiFloat = container.querySelector('#ws-ai-float');
    const atPopover = container.querySelector('#ws-at-popover');
    const atList = container.querySelector('#ws-at-list');

    state.atPopoverEl = atPopover;

    // ---------- 百科词条异步加载（真实 data，写入 state.vocab 兼容老逻辑）----------
    state.encyEntries = [];
    function loadEncyclopedia() {
      const pid2 = getProjectId();
      if (!pid2) return Promise.resolve();
      const stg = DT().storage;
      if (!stg || typeof stg.listEncyclopediaEntries !== 'function') return Promise.resolve();
      return Promise.resolve(stg.listEncyclopediaEntries(pid2)).then(entries => {
        state.encyEntries = entries || [];
        // 回填到 vocab，保持 @提及 等老逻辑可用
        const roles = [], places = [], items = [], arts = [];
        for (const e of state.encyEntries) {
          const pack = { id: e.id, name: e.name, brief: e.summary || '' };
          switch (e.type) {
            case 'character': roles.push(pack); break;
            case 'place': places.push(pack); break;
            case 'item': items.push(pack); break;
            case 'skill': arts.push(pack); break;
          }
        }
        if (roles.length) state.vocab.roles = roles;
        if (places.length) state.vocab.places = places;
        if (items.length) state.vocab.items = items;
        if (arts.length) state.vocab.arts = arts;
      }).catch(err => {
        console.warn('[ws] 加载设定百科失败，回退到默认 mock 词汇：', err);
      });
    }

    // ---------- 应用视图配置显示/隐藏 ----------
    applyConfig();

    // ---------- 工具函数 ----------
    function todayStr() { return new Date().toISOString().slice(0, 10); }
    function yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

    function applyConfig() {
      const c = state.config;
      panelRoles.style.display = c.showRoles ? '' : 'none';
      panelSettings.style.display = c.showSettings ? '' : 'none';
      panelHooks.style.display = c.showHooks ? '' : 'none';
      panelEncyclopedia.style.display = c.showEncyclopedia ? '' : 'none';
      searchWrap.style.display = c.showSearch ? '' : 'none';
      container.querySelector('#ws-bottom-bar').style.display = c.showWritingGoal ? '' : 'none';
      aiFloat.style.display = c.showAIToolbar ? '' : 'none';
    }

    // ---------- 加载章节 & 卷 ----------
    async function reload() {
      listEl.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        [state.chapters, state.volumes, state.allHooks] = await Promise.all([
          DT().storage.listChapters(pid),
          DT().storage.listVolumes(pid),
          DT().storage.listHooks(pid),
          loadEncyclopedia(), // 并行加载百科词条
        ]);
        state.chapters = state.chapters || [];
        state.allHooks = state.allHooks || [];
        state.volumes = (state.volumes || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        renderList();
        // 章节/百科/伏笔加载完成后重扫右侧
        scanAndUpdateSidebar(true);
      } catch (err) {
        console.error('[ws] 加载失败', err);
        listEl.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
      }
    }

    // ---------- 渲染左侧章节树 ----------
    function renderList() {
      if (!state.chapters.length) {
        listEl.innerHTML = '<p class="dt-empty-hint">暂无章节，点击「+ 新章」开始</p>';
        return;
      }
      const byVol = new Map();
      state.chapters.forEach((c) => {
        const a = byVol.get(c.vol_no) || []; a.push(c); byVol.set(c.vol_no, a);
      });
      byVol.forEach((arr) => arr.sort((a, b) => String(a.ch_no).localeCompare(String(b.ch_no))));
      const volNames = new Map(state.volumes.map((v) => [v.vol_no, v.vol_name]));
      const curKey = state.currentCh ? chKey(state.currentCh) : '';
      const known = new Set(state.volumes.map((v) => v.vol_no));
      const html = [];
      state.volumes.forEach((v) => {
        const arr = byVol.get(v.vol_no) || [];
        html.push(volGroupHTML(v.vol_no, v.vol_name || '未命名卷', arr, curKey, true));
      });
      const orphans = state.chapters.filter((c) => !known.has(c.vol_no));
      if (orphans.length) {
        const ob = new Map();
        orphans.forEach((c) => { const a = ob.get(c.vol_no) || []; a.push(c); ob.set(c.vol_no, a); });
        ob.forEach((arr, vn) => {
          arr.sort((a, b) => String(a.ch_no).localeCompare(String(b.ch_no)));
          html.push(volGroupHTML(vn, volNames.get(vn) || '未分卷', arr, curKey, true));
        });
      }
      listEl.innerHTML = html.join('');
      bindListEvents();
    }

    function volGroupHTML(vn, vname, arr, curKey, expanded) {
      return `
        <div class="ws-vol-group" data-vol="${esc(vn)}">
          <div class="ws-vol-header" data-act="toggle">
            <span class="ws-vol-toggle">${expanded ? '▾' : '▸'}</span>
            <span class="ws-vol-name">第 ${esc(vn)} 卷 · ${esc(vname)}</span>
            <span class="ws-vol-count">${arr.length}</span>
          </div>
          <ul class="ws-ch-list" style="${expanded ? '' : 'display:none'}">
            ${arr.map((c) => chItemHTML(c, chKey(c) === curKey)).join('')}
          </ul>
        </div>`;
    }

    function chItemHTML(c, active) {
      const words = (c.words || 0) > 0 ? `<span class="ws-badge ws-badge-outline" title="字数">${c.words}</span>` : '';
      const statusBadge = c.status === 'published'
        ? '<span class="ws-badge ws-badge-pub">已发</span>'
        : c.status === 'todo' ? '<span class="ws-badge ws-badge-draft">待写</span>'
        : '<span class="ws-badge ws-badge-draft">草</span>';
      const hasOutline = Math.random() > 0.5; // 真实时按章纲文件存在判断
      const outlineBadge = hasOutline ? '<span class="ws-badge ws-badge-outline" title="已编写章纲">📋</span>' : '';
      return `
        <li class="ws-ch-item ${active ? 'ws-ch-item-active' : ''}" data-key="${esc(chKey(c))}" draggable="true">
          <span class="ws-ch-no">${esc(c.ch_no)}</span>
          <span class="ws-ch-title" title="${esc(c.title || '未命名')}">${esc(c.title || '未命名')}</span>
          <button class="ws-ch-outline-btn" data-act="view-outline" title="查看章纲">🔖</button>
          ${outlineBadge}
          ${words}
          ${statusBadge}
        </li>`;
    }

    let dragSrc = '';
    function bindListEvents() {
      listEl.querySelectorAll('.ws-vol-header').forEach((h) => {
        h.addEventListener('click', () => {
          const ul = h.nextElementSibling;
          const tg = h.querySelector('.ws-vol-toggle');
          if (ul.style.display === 'none') { ul.style.display = ''; tg.textContent = '▾'; }
          else { ul.style.display = 'none'; tg.textContent = '▸'; }
        });
      });
      listEl.querySelectorAll('.ws-ch-item').forEach((li) => {
        const key = li.getAttribute('data-key');
        li.addEventListener('click', (e) => {
          if (e.target && e.target.getAttribute && e.target.getAttribute('data-act') === 'view-outline') {
            showOutlineModal(key);
            e.stopPropagation();
            return;
          }
          selectChapter(key);
        });
        bindDrag(li, key);
      });
    }
    function bindDrag(li, key) {
      li.addEventListener('dragstart', (e) => {
        dragSrc = key; li.classList.add('dt-dragging');
        try { e.dataTransfer.setData('text/plain', key); } catch (_) {}
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dt-dragging');
        listEl.querySelectorAll('.dt-dragover').forEach((el) => el.classList.remove('dt-dragover'));
      });
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('dt-dragover'); });
      li.addEventListener('dragleave', () => li.classList.remove('dt-dragover'));
      li.addEventListener('drop', async (e) => {
        e.preventDefault(); li.classList.remove('dt-dragover');
        if (!dragSrc || dragSrc === key) return;
        await reorder(dragSrc, key); dragSrc = '';
      });
    }
    async function reorder(srcKey, tgtKey) {
      const src = state.chapters.find((c) => chKey(c) === srcKey);
      const tgt = state.chapters.find((c) => chKey(c) === tgtKey);
      if (!src || !tgt || src.vol_no !== tgt.vol_no) { DT().notify('仅支持同卷内交换顺序', 'warning'); return; }
      const scn = src.ch_no, tcn = tgt.ch_no;
      try {
        await DT().storage.deleteChapter(pid, src.vol_no, src.ch_no);
        await DT().storage.deleteChapter(pid, tgt.vol_no, tgt.ch_no);
        await DT().storage.saveChapter(pid, { ...src, ch_no: tcn, updated_at: new Date().toISOString() });
        await DT().storage.saveChapter(pid, { ...tgt, ch_no: scn, updated_at: new Date().toISOString() });
        DT().notify('顺序已交换', 'success');
        await reload();
      } catch (err) {
        console.error(err); DT().notify('排序失败：' + (err.message || err), 'error');
      }
    }

    // ---------- 章纲浮层 ----------
    function showOutlineModal(key) {
      const c = state.chapters.find((x) => chKey(x) === key);
      if (!c) return;
      const mockOutline = `# 第 ${c.ch_no} 章 · ${c.title || '未命名'}\n\n## 核心目标\n- 推进主角与反派的首次正面交锋\n- 揭示残剑新的剑纹能力\n\n## 场景 1：密室相遇\n- 开场：主角追踪气息进入密室\n- 对话：与反派影杀简短对峙\n- 冲突：影杀放出暗器，主角以剑格挡\n\n## 场景 2：残剑共鸣\n- 金手指升级：残剑剑纹亮起，主角感知剑骨方位\n- 情绪转折：主角从防御转进攻\n\n## 结尾钩子\n- 影沙逃走时留下线索，指向东海渊海`;
      const modal = document.createElement('div');
      modal.className = 'dt-modal-overlay';
      modal.innerHTML = `
        <div class="dt-modal dt-modal-large">
          <div class="dt-modal-header"><h3>📋 第 ${esc(c.ch_no)} 章 · ${esc(c.title || '未命名')} 章纲</h3>
            <button class="dt-modal-close" data-act="close">×</button>
          </div>
          <div class="dt-modal-body" style="max-height:60vh;overflow:auto;"><pre style="white-space:pre-wrap;font-family:var(--ws-font-serif);line-height:1.8;padding:12px;">${esc(mockOutline)}</pre></div>
          <div class="dt-modal-footer">
            <button class="dt-btn" data-act="close">关闭</button>
            <button class="dt-btn dt-btn-primary" data-act="use">作为写作参考</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      const close = () => modal.remove();
      modal.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', close));
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      modal.querySelector('[data-act="use"]').addEventListener('click', () => {
        DT().notify('已把章纲加入参考，写作时会出现在设定速览', 'success');
        close();
      });
    }

    // ---------- 选中章节 & 加载编辑器 ----------
    async function selectChapter(key) {
      await flushSave();
      const c = state.chapters.find((x) => chKey(x) === key);
      if (!c) return;
      try {
        state.currentCh = await DT().storage.getChapter(pid, c.vol_no, c.ch_no) || c;
      } catch (_) { state.currentCh = c; }
      DT().state.currentVol = state.currentCh.vol_no;
      DT().state.currentCh = state.currentCh.ch_no;
      state.dirty = false;
      state.lastScannedLen = 0;
      state.rolesInChapter = [];
      state.settingsInChapter = [];
      state.hooksInChapter = [];
      renderHeader();
      renderEditor();
      renderList(); // 高亮
      scanAndUpdateSidebar(true); // 全量扫描一次
    }

    function renderHeader() {
      if (!state.currentCh) return;
      volEl.textContent = '第 ' + state.currentCh.vol_no + ' 卷';
      chEl.textContent = '第 ' + state.currentCh.ch_no + ' 章';
      titleInput.value = state.currentCh.title || '';
      statusSel.value = state.currentCh.status || 'draft';
      wcEl.textContent = '字数：' + (state.currentCh.words || 0);
    }

    function destroyEditor() {
      if (state.editor) { try { state.editor.destroy(); } catch (_) {} state.editor = null; }
      if (DT().state.editor) DT().state.editor = null;
    }

    function renderEditor() {
      if (!state.currentCh) {
        editorWrap.innerHTML = ''; editorWrap.appendChild(emptyEl); emptyEl.style.display = '';
        return;
      }
      destroyEditor();
      editorWrap.innerHTML = '';
      const host = document.createElement('div'); host.className = 'ws-editor-host';
      editorWrap.appendChild(host);

      const DTGlobal = DT();
      const creator = (global.DreamTaleEditor && global.DreamTaleEditor.create)
        || (DTGlobal.modules && DTGlobal.modules.editor && DTGlobal.modules.editor.createMarkdownEditor);
      try {
        state.editor = creator ? creator(host, {
          initialValue: state.currentCh.content || '',
          theme: DTGlobal.state.theme || 'light',
          onChange: onContentChange,
          onSave: () => { flushSave(); return true; },
          plainText: true, // ← 小说纯文本写作模式：隐藏 Markdown 格式按钮和三模式切换
        }) : null;
      } catch (err) {
        console.error('[ws] editor create failed', err);
        host.innerHTML = `<textarea class="dt-ch-fallback" style="width:100%;height:100%;">${esc(state.currentCh.content || '')}</textarea>`;
        const ta = host.querySelector('.dt-ch-fallback');
        ta.addEventListener('input', () => onContentChange(ta.value));
      }
      if (state.editor) DTGlobal.state.editor = state.editor;

      // 注册 @提及 钩子（如果编辑器支持）
      if (state.editor && typeof state.editor === 'object' && DTGlobal.modules && DTGlobal.modules.editor && DTGlobal.modules.editor.registerHook) {
        DTGlobal.modules.editor.registerHook('atMention', atMentionAPI);
      }

      wcEl.textContent = '字数：' + ((state.currentCh && state.currentCh.words) || 0);
      updateGoalBar(state.currentCh ? (state.currentCh.words || 0) : 0);
    }

    // ---------- 内容变更 ----------
    function onContentChange(text) {
      if (!state.currentCh) return;
      state.currentCh.content = text;
      const w = state.editor ? state.editor.getWordCount() : (text ? text.length : 0);
      state.currentCh.words = w;
      wcEl.textContent = '字数：' + w;
      markDirty();
      updateGoalBar(w);
      // 增量扫描右侧面板（500ms 防抖）
      clearTimeout(state._scanT);
      state._scanT = setTimeout(() => scanAndUpdateSidebar(false), 500);
    }
    function markDirty() {
      state.dirty = true;
      clearTimeout(state.autoSaveTimer);
      state.autoSaveTimer = setTimeout(() => flushSave(), 1500);
    }
    async function flushSave() {
      if (!state.currentCh || !state.dirty) return;
      clearTimeout(state.autoSaveTimer);
      try {
        const payload = {
          ...state.currentCh,
          title: titleInput ? titleInput.value : state.currentCh.title,
          words: state.currentCh.words,
          status: statusSel ? statusSel.value : state.currentCh.status,
          updated_at: new Date().toISOString(),
        };
        state.currentCh.title = payload.title;
        state.currentCh.status = payload.status;
        await DT().storage.saveChapter(pid, payload);
        state.dirty = false;
        // 更新今日写作字数
        if (state.goal.date === todayStr()) {
          state.goal.today = Math.max(state.goal.today || 0, payload.words || 0);
          save(GOAL_KEY, state.goal);
          if ((payload.words || 0) >= 100) {
            state.streak.last = todayStr();
            if (state.streak.days === 0) state.streak.days = 1;
            save(STREAK_KEY, state.streak);
            streakEl.textContent = '🔥 ' + (state.streak.days || 1);
          }
          updateGoalBar(payload.words || 0);
        }
        // 静默更新列表项标题
        const li = listEl.querySelector(`[data-key="${esc(chKey(state.currentCh))}"] .ws-ch-title`);
        if (li) li.textContent = payload.title || '未命名';
      } catch (err) {
        console.error('[ws] 保存失败', err);
        DT().notify('保存失败：' + (err.message || err), 'error');
      }
    }

    // ---------- 写作目标/打卡 ----------
    function updateGoalBar(w) {
      const daily = state.goal.daily || 6000;
      const today = Math.max(state.goal.today || 0, w);
      const pct = Math.min(100, Math.round(today / daily * 100));
      goalBar.style.width = pct + '%';
      goalText.textContent = today + ' / ' + daily + ' 字  (' + pct + '%)';
      streakEl.textContent = '🔥 ' + (state.streak.days || 0);
    }

    // ---------- 右侧面板：智能关键词匹配 ----------
    function scanAndUpdateSidebar(full) {
      if (!state.currentCh) return;
      const text = state.currentCh.content || '';
      // 从上次位置之后的增量（如果非全量），不足 200 字就全量
      const scanFrom = (!full && state.lastScannedLen && text.length - state.lastScannedLen < 5000) ? state.lastScannedLen : 0;
      const sub = text.slice(scanFrom);
      if (!sub && !full) return;
      state.lastScannedLen = text.length;

      // 这里使用 format-utils 的 matchKeywords（如果已加载，否则降级实现）
      Promise.resolve().then(async () => {
        const DTGlobal = DT();
        let mk;
        if (DTGlobal.modules && DTGlobal.modules._formatUtils && DTGlobal.modules._formatUtils.matchKeywords) {
          mk = DTGlobal.modules._formatUtils.matchKeywords;
        } else {
          try {
            const m = await import('../../src/core/format-utils.js');
            if (!DTGlobal.modules) DTGlobal.modules = {};
            DTGlobal.modules._formatUtils = m;
            mk = m.matchKeywords;
          } catch (_) { mk = fallbackMatch; }
        }
        const vocab = {
          roles: state.vocab.roles.map((r) => r.name),
          places: state.vocab.places.map((r) => r.name),
          items: state.vocab.items.map((r) => r.name),
          arts: state.vocab.arts.map((r) => r.name),
        };
        const found = mk(sub, vocab);
        if (full) {
          state.rolesInChapter = []; state.settingsInChapter = [];
        }
        found.roles.forEach((n) => { if (!state.rolesInChapter.includes(n)) state.rolesInChapter.push(n); });
        ['places', 'items', 'arts'].forEach((k) => {
          found[k].forEach((n) => { if (!state.settingsInChapter.find((x) => x.name === n)) {
            const pool = state.vocab[k] || []; const hit = pool.find((x) => x.name === n);
            if (hit) state.settingsInChapter.push({ type: k, ...hit });
          }});
        });
        // 伏笔：从真实 allHooks 中按当前章节区间过滤，并适配渲染格式
        state.hooksInChapter = filterHooksForCurrentChapter(state.allHooks, state.currentCh);
        renderSidebar();
      });

      function fallbackMatch(t, v) {
        const r = { roles: [], places: [], items: [], arts: [] };
        Object.keys(r).forEach((k) => {
          (v[k] || []).forEach((w) => { if (w && t.indexOf(w) >= 0 && !r[k].includes(w)) r[k].push(w); });
        });
        return r;
      }
    }
    function filterHooksForCurrentChapter(allHooks, currentCh) {
      if (!Array.isArray(allHooks) || !allHooks.length || !currentCh) return [];
      const chNo = Number(currentCh.ch_no) || 0;
      // 优先级映射
      const prioMap = { high: 'P0', medium: 'P1', low: 'P2' };
      const statusLabel = { planted: '已埋设', hinted: '回收中', resolved: '已回收', abandoned: '已废弃' };
      const strengthLabel = { strong: '强', medium: '中', weak: '弱' };
      const results = [];
      allHooks.forEach((h) => {
        // 排除已废弃和已回收的（除非当前章就在回收章，用于提示确认回收）
        if (h.status === 'abandoned') return;
        const planted = Number(h.planted_ch) || 0;
        const target = Number(h.target_resolve_ch) || 0;
        // 判断是否关联本章：planted<=当前章<=target（活跃期），或临近 planted/target ±3 章
        const windowLeft = Math.max(1, Math.min(planted, target) - 3);
        const windowRight = Math.max(planted, target) + 3;
        const inWindow = chNo >= windowLeft && chNo <= windowRight;
        if (!inWindow && !(!planted && !target)) return; // 全无章号也保留（新伏笔待安排）
        // 组装 tip
        const tips = [];
        if (target && chNo < target) {
          tips.push(`目标第 ${target} 章回收`);
        } else if (target && chNo >= target) {
          tips.push(`⚠️ 已超过目标回收章（第 ${target} 章），请尽快处理`);
        }
        if (h.strength) tips.push(`强度：${strengthLabel[h.strength] || h.strength}`);
        if (h.payoff_type) {
          const payoffLabel = { reveal: '真相揭示', twist: '剧情反转', powerup: '能力解锁', emotional: '情感冲击', callback: '回扣前文' };
          tips.push(`回收方式：${payoffLabel[h.payoff_type] || h.payoff_type}`);
        }
        const desc = h.description || '（无描述）';
        // 显示用"标题"：desc 前 30 字截断
        const title = desc.length > 30 ? desc.slice(0, 30) + '…' : desc;
        const plantedText = planted ? `第 ${planted} 章` : '待埋设';
        results.push({
          id: h.hook_id || String(h.id || ''),
          prio: prioMap[h.priority] || 'P2',
          title,
          status: statusLabel[h.status] || h.status || '未知',
          planted: plantedText,
          tip: tips.length ? tips.join('，') : (desc.length > 60 ? desc.slice(0, 60) + '…' : desc),
          _raw: h,
        });
      });
      // 排序：P0 > P1 > P2，再按 planted/target 临近度
      const prioOrder = { P0: 0, P1: 1, P2: 2 };
      results.sort((a, b) => {
        const pa = prioOrder[a.prio] ?? 3, pb = prioOrder[b.prio] ?? 3;
        if (pa !== pb) return pa - pb;
        const ra = a._raw ? Math.abs((Number(a._raw.target_resolve_ch) || 99999) - chNo) : 99999;
        const rb = b._raw ? Math.abs((Number(b._raw.target_resolve_ch) || 99999) - chNo) : 99999;
        return ra - rb;
      });
      return results;
    }

    function renderSidebar() {
      // 角色
      if (state.config.showRoles) {
        const body = panelRoles.querySelector('.ws-panel-body');
        if (!state.rolesInChapter.length) {
          body.innerHTML = '<p class="ws-empty">写作时会自动识别文中出现的角色</p>';
        } else {
          body.innerHTML = state.rolesInChapter.map((n) => {
            const r = state.vocab.roles.find((x) => x.name === n);
            if (!r) return '';
            const initial = (r.name || '').slice(0, 1);
            return `
              <div class="ws-role-card" data-id="${esc(r.id)}">
                <div class="ws-role-head">
                  <div class="ws-role-avatar">${esc(initial)}</div>
                  <div class="ws-role-info">
                    <div class="ws-role-name">${esc(r.name)}</div>
                    <div class="ws-role-extra">${esc(r.brief.split('，')[0] || '')}</div>
                  </div>
                </div>
                <div class="ws-role-brief">${esc(r.brief)}</div>
                <button class="ws-btn ws-btn-xs ws-btn-ghost ws-role-ref" data-id="${esc(r.id)}">@引用</button>
              </div>`;
          }).join('');
          body.querySelectorAll('.ws-role-ref').forEach((b) => b.addEventListener('click', () => {
            const id = b.getAttribute('data-id');
            const r = state.vocab.roles.find((x) => x.id === id);
            if (r) insertAtToEditor(`[[角色:${r.name}]]`, 0);
          }));
        }
      }
      // 设定
      if (state.config.showSettings) {
        const body = panelSettings.querySelector('.ws-panel-body');
        if (!state.settingsInChapter.length) {
          body.innerHTML = '<p class="ws-empty">写作时会自动识别提及的地点/功法/物品</p>';
        } else {
          body.innerHTML = state.settingsInChapter.map((s) => {
            const tmap = { places: '地点', arts: '功法', items: '物品' };
            const tname = tmap[s.type] || '设定';
            return `
              <div class="ws-setting-item">
                <div class="ws-setting-head"><span class="ws-setting-name">${esc(s.name)}</span><span class="ws-badge ws-badge-outline">${tname}</span></div>
                <div class="ws-setting-brief">${esc(s.brief)}</div>
                <button class="ws-btn ws-btn-xs ws-btn-ghost ws-set-ref" data-type="${tname}" data-name="${esc(s.name)}">@引用</button>
              </div>`;
          }).join('');
          body.querySelectorAll('.ws-set-ref').forEach((b) => b.addEventListener('click', () => {
            const t = b.getAttribute('data-type'), n = b.getAttribute('data-name');
            insertAtToEditor(`[[${t}:${n}]]`, 0);
          }));
        }
      }
      // 伏笔
      if (state.config.showHooks) {
        const body = panelHooks.querySelector('.ws-panel-body');
        if (!state.hooksInChapter.length) {
          body.innerHTML = '<p class="ws-empty">本章暂无关联伏笔</p>';
        } else {
          body.innerHTML = `<div class="ws-hook-summary">本章涉及 <b>${state.hooksInChapter.length}</b> 条伏笔，其中 P0 <b>${state.hooksInChapter.filter(h=>h.prio==='P0').length}</b> 条</div>`
            + state.hooksInChapter.map((h) => {
              const prioClass = h.prio === 'P0' ? 'ws-badge-pub' : h.prio === 'P1' ? 'ws-badge-draft' : 'ws-badge-outline';
              return `
                <div class="ws-hook-item">
                  <span class="ws-badge ${prioClass}">${esc(h.prio)}</span>
                  <div class="ws-hook-info">
                    <div class="ws-hook-title">${esc(h.id)} · ${esc(h.title)}</div>
                    <div class="ws-hook-tip">${esc(h.tip)}</div>
                    <div class="ws-hook-meta">${esc(h.status)} · 埋设：${esc(h.planted)}</div>
                  </div>
                </div>`;
            }).join('');
        }
      }
      // 设定百科速览（调用 encyclopedia.js 暴露的 DTEncyclopediaPanel）
      if (state.config.showEncyclopedia) {
        try {
          const Features = window.DreamTaleFeatures;
          const panelAPI = Features && typeof Features.DTEncyclopediaPanel === 'function'
            ? Features.DTEncyclopediaPanel({
                pid: getProjectId(),
                entries: state.encyEntries,
                content: state.currentCh ? state.currentCh.content || '' : '',
              })
            : null;
          if (panelAPI) {
            panelEncyclopediaBody.innerHTML = panelAPI.panelHTML;
            if (typeof panelAPI.bindHandlers === 'function') {
              panelAPI.bindHandlers(panelEncyclopediaBody, (entryId) => {
                // 点击条目 → 弹出 mini 详情抽屉（或跳转到完整百科）
                const entry = state.encyEntries.find(e => e.id === entryId);
                if (!entry) return;
                openEncyclopediaMini(entry);
              });
            }
            // 绑定 mini 搜索
            const miniSearch = panelEncyclopediaBody.querySelector('[data-act="ency-search"]');
            if (miniSearch) {
              const origBind = panelAPI && panelAPI.bindHandlers;
              miniSearch.addEventListener('input', debounce(() => {
                const q = miniSearch.value.trim().toLowerCase();
                const slot = panelEncyclopediaBody.querySelector('[data-slot="ency-list"]');
                if (!slot) return;
                const all = state.encyEntries || [];
                let filtered = !q ? all : all.filter(e =>
                  String(e.name || '').toLowerCase().includes(q)
                  || (e.aliases || []).some(a => String(a).toLowerCase().includes(q))
                  || (e.tags || []).some(t => String(t).toLowerCase().includes(q))
                  || String(e.summary || '').toLowerCase().includes(q)
                );
                if (filtered.length === 0) {
                  slot.innerHTML = `<div class="ws-ency-empty"><p>没有匹配「${esc(q)}」的设定</p></div>`;
                } else {
                  // 重绘 mini 列表（命中计数按 q）
                  const out = [];
                  for (const e of filtered.slice(0, 40)) {
                    const nameLower = String(e.name || '').toLowerCase();
                    let count = q ? (nameLower.includes(q) ? 1 : 0) : 0;
                    const typeColor = (e.type === 'character' ? '#e74c3c' : e.type === 'place' ? '#3498db'
                      : e.type === 'skill' ? '#2ecc71' : e.type === 'faction' ? '#9b59b6'
                      : e.type === 'event' ? '#f39c12' : e.type === 'item' ? '#1abc9c'
                      : e.type === 'concept' ? '#e67e22' : '#7f8c8d');
                    const typeIcon = (e.type === 'character' ? '👤' : e.type === 'place' ? '📍'
                      : e.type === 'skill' ? '⚔️' : e.type === 'faction' ? '🏛️'
                      : e.type === 'event' ? '📅' : e.type === 'item' ? '💎'
                      : e.type === 'concept' ? '💡' : '📁');
                    out.push(`<div class="ws-ency-item" data-entry-id="${esc(e.id)}">
                      <span class="ws-ency-item-type" style="color:${typeColor};">${typeIcon}</span>
                      <div class="ws-ency-item-main">
                        <div class="ws-ency-item-name">${esc(e.name)}
                          ${e.aliases && e.aliases.length ? `<span class="ws-ency-item-alias">（${esc(e.aliases[0])}）</span>` : ''}
                        </div>
                        ${e.summary ? `<div class="ws-ency-item-summary">${esc(e.summary.slice(0, 40))}</div>` : ''}
                      </div>
                      ${q && count ? `<span class="ws-ency-item-count">命中</span>` : ''}
                    </div>`);
                  }
                  slot.innerHTML = out.join('');
                  slot.querySelectorAll('[data-entry-id]').forEach(el => {
                    el.addEventListener('click', () => {
                      const eid = el.getAttribute('data-entry-id');
                      const en = state.encyEntries.find(x => x.id === eid);
                      if (en) openEncyclopediaMini(en);
                    });
                  });
                }
                const sum = panelEncyclopediaBody.querySelector('.ws-ency-total-count');
                if (sum) sum.textContent = `共 ${filtered.length} 条`;
              }, 150));
            }
          } else {
            panelEncyclopediaBody.innerHTML = '<p class="ws-empty">设定百科模块尚未就绪</p>';
          }
        } catch (err) {
          console.warn('[ws] 渲染百科速览失败：', err);
          panelEncyclopediaBody.innerHTML = `<p class="ws-empty">渲染失败：${esc(err.message || err)}</p>`;
        }
      }
    }

    // ---------- 百科 mini 详情弹窗（起点式抽屉式浮层）----------
    let _encyMiniOverlay = null;
    function openEncyclopediaMini(entry) {
      if (_encyMiniOverlay) _encyMiniOverlay.remove();
      const typeColor = (entry.type === 'character' ? '#e74c3c' : entry.type === 'place' ? '#3498db'
        : entry.type === 'skill' ? '#2ecc71' : entry.type === 'faction' ? '#9b59b6'
        : entry.type === 'event' ? '#f39c12' : entry.type === 'item' ? '#1abc9c'
        : entry.type === 'concept' ? '#e67e22' : '#7f8c8d');
      const typeLabel = (entry.type === 'character' ? '角色' : entry.type === 'place' ? '地点'
        : entry.type === 'skill' ? '功法' : entry.type === 'faction' ? '势力'
        : entry.type === 'event' ? '事件' : entry.type === 'item' ? '物品'
        : entry.type === 'concept' ? '概念' : '其他');
      const typeIcon = (entry.type === 'character' ? '👤' : entry.type === 'place' ? '📍'
        : entry.type === 'skill' ? '⚔️' : entry.type === 'faction' ? '🏛️'
        : entry.type === 'event' ? '📅' : entry.type === 'item' ? '💎'
        : entry.type === 'concept' ? '💡' : '📁');
      const tagsHTML = (entry.tags || []).map(t => `<span class="ws-ency-chip">${esc(t)}</span>`).join('');
      const aliasesHTML = entry.aliases && entry.aliases.length ? `<div class="ws-ency-meta-line"><span class="ws-ency-meta-k">别名</span><span>${esc(entry.aliases.join(' / '))}</span></div>` : '';
      const firstHTML = entry.first_appear_ch ? `<div class="ws-ency-meta-line"><span class="ws-ency-meta-k">首次登场</span><span>${esc(entry.first_appear_ch)}</span></div>` : '';
      const relHTML = entry.related_entries && entry.related_entries.length ? `<div class="ws-ency-meta-line"><span class="ws-ency-meta-k">关联</span><span>${esc(entry.related_entries.join(' / '))}</span></div>` : '';
      _encyMiniOverlay = document.createElement('div');
      _encyMiniOverlay.className = 'ws-ency-mini-overlay';
      _encyMiniOverlay.innerHTML = `
        <div class="ws-ency-mini-card">
          <div class="ws-ency-mini-head">
            <span class="ws-ency-mini-type" style="background:${typeColor}22;color:${typeColor};">${typeIcon} ${typeLabel}</span>
            <button class="ws-ency-mini-close" data-act="close" aria-label="关闭">×</button>
          </div>
          <h3 class="ws-ency-mini-title">${esc(entry.name)}</h3>
          <div class="ws-ency-meta-block">
            ${aliasesHTML}${firstHTML}${relHTML}
            ${tagsHTML ? `<div class="ws-ency-meta-line"><span class="ws-ency-meta-k">标签</span><span>${tagsHTML}</span></div>` : ''}
          </div>
          ${entry.summary ? `<blockquote class="ws-ency-mini-summary">${esc(entry.summary)}</blockquote>` : ''}
          ${entry.content ? `<div class="ws-ency-mini-content">${esc(entry.content).replace(/\n/g, '<br/>')}</div>` : ''}
          <div class="ws-ency-mini-foot">
            <button class="ws-btn ws-btn-xs ws-btn-ghost" data-act="open-full">📚 打开完整百科</button>
            <button class="ws-btn ws-btn-xs ws-btn-ghost" data-act="cite">@ 引用到正文</button>
          </div>
        </div>`;
      _encyMiniOverlay.addEventListener('click', e => {
        if (e.target === _encyMiniOverlay) { _encyMiniOverlay.remove(); _encyMiniOverlay = null; }
      });
      _encyMiniOverlay.querySelector('[data-act="close"]').addEventListener('click', () => {
        _encyMiniOverlay.remove(); _encyMiniOverlay = null;
      });
      _encyMiniOverlay.querySelector('[data-act="open-full"]').addEventListener('click', () => {
        _encyMiniOverlay.remove(); _encyMiniOverlay = null;
        DT().router.navigate('#/encyclopedia');
      });
      _encyMiniOverlay.querySelector('[data-act="cite"]').addEventListener('click', () => {
        insertAtToEditor(`[[${typeLabel}:${entry.name}]]`, 0);
        _encyMiniOverlay.remove(); _encyMiniOverlay = null;
      });
      document.body.appendChild(_encyMiniOverlay);
    }

    function insertAtToEditor(inserted, rangeLen) {
      if (!state.editor) return;
      if (typeof state.editor.insertAtText === 'function') {
        state.editor.insertAtText(inserted, rangeLen);
      } else {
        // 回退：把字符串拼到标题输入（仅提醒，因为拿不到 textarea 引用）
        DT().notify('已复制到剪贴板，可手动粘贴：' + inserted, 'success');
        try { navigator.clipboard && navigator.clipboard.writeText(inserted); } catch (_) {}
      }
    }

    // ---------- @提及 接口 ----------
    const atMentionAPI = {
      show: (opts) => {
        const q = (opts && opts.query) || '';
        state.atQueryMode = true;
        // 渲染候选
        renderAtList(q);
        // 定位：优先拿编辑器 textarea 位置，否则固定在中栏右上
        atPopover.style.display = '';
        if (opts && opts.el && typeof opts.el.getBoundingClientRect === 'function') {
          const r = opts.el.getBoundingClientRect();
          const sr = shell.getBoundingClientRect();
          atPopover.style.left = (r.left - sr.left + 12) + 'px';
          atPopover.style.top = (r.bottom - sr.top + 6) + 'px';
        } else {
          atPopover.style.left = '10%'; atPopover.style.top = '15%';
        }
      },
      hide: () => { state.atQueryMode = false; atPopover.style.display = 'none'; },
      onSelect: (cb) => { atMentionAPI._onSelect = cb; },
    };
    atPopover.querySelectorAll('.ws-at-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        atPopover.querySelectorAll('.ws-at-tab').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        state.atTab = btn.getAttribute('data-tab');
        const curQ = atPopover.getAttribute('data-last-q') || '';
        renderAtList(curQ);
      });
    });
    function renderAtList(q) {
      atPopover.setAttribute('data-last-q', q || '');
      const tabToKey = { '角色': 'roles', '地点': 'places', '功法': 'arts', '物品': 'items' };
      const key = tabToKey[state.atTab] || 'roles';
      const pool = state.vocab[key] || [];
      const needle = (q || '').toLowerCase();
      const filtered = pool.filter((x) => !needle || x.name.toLowerCase().includes(needle) || (x.brief || '').toLowerCase().includes(needle)).slice(0, 10);
      atList.innerHTML = filtered.length ? filtered.map((x) => `
          <div class="ws-at-item" data-type="${state.atTab}" data-name="${esc(x.name)}">
            <span class="ws-at-name">${esc(x.name)}</span>
            <span class="ws-at-brief">${esc(x.brief || '').slice(0, 36)}</span>
          </div>`).join('')
        : `<div class="ws-at-empty">无匹配「${esc(q||'')}」的${state.atTab}</div>`;
      atList.querySelectorAll('.ws-at-item').forEach((it) => {
        it.addEventListener('click', () => {
          const t = it.getAttribute('data-type'), n = it.getAttribute('data-name');
          const inserted = `[[${t}:${n}]]`;
          // 尝试调用编辑器插入
          const dt = (state.editor && typeof state.editor.insertAtText === 'function')
            ? state.editor.insertAtText(inserted, (q || '').length + 1)
            : Promise.resolve();
          atMentionAPI.hide();
          if (atMentionAPI._onSelect) atMentionAPI._onSelect({ type: t, name: n, inserted });
          DT().notify(`已插入：${inserted}`, 'success');
        });
      });
    }

    // ---------- 设定百科搜索 ----------
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      if (!q) { searchResults.innerHTML = ''; return; }
      const ql = q.toLowerCase();
      const all = [
        ...state.vocab.roles.map((x) => ({ ...x, type: '角色' })),
        ...state.vocab.places.map((x) => ({ ...x, type: '地点' })),
        ...state.vocab.arts.map((x) => ({ ...x, type: '功法' })),
        ...state.vocab.items.map((x) => ({ ...x, type: '物品' })),
      ];
      const hits = all.filter((x) => x.name.toLowerCase().includes(ql) || (x.brief || '').toLowerCase().includes(ql)).slice(0, 12);
      searchResults.innerHTML = hits.length ? hits.map((x) => `
        <div class="ws-sr-item" data-type="${esc(x.type)}" data-name="${esc(x.name)}">
          <span class="ws-badge ws-badge-outline">${esc(x.type)}</span>
          <b class="ws-sr-name">${esc(x.name)}</b>
          <span class="ws-sr-brief">${esc((x.brief||'').slice(0,40))}</span>
        </div>`).join('')
        : `<div class="ws-sr-empty">无匹配「${esc(q)}」的设定</div>`;
      searchResults.querySelectorAll('.ws-sr-item').forEach((it) => {
        it.addEventListener('click', () => {
          const t = it.getAttribute('data-type'), n = it.getAttribute('data-name');
          insertAtToEditor(`[[${t}:${n}]]`, 0);
          searchResults.innerHTML = ''; searchInput.value = '';
        });
      });
    });
    document.addEventListener('click', (e) => {
      if (!searchWrap.contains(e.target)) searchResults.innerHTML = '';
    });

    // ---------- 顶部工具栏按钮 ----------
    shell.querySelector('[data-act="toggle-left"]').addEventListener('click', () => {
      const l = container.querySelector('#ws-left');
      const isHidden = l.style.width === '0px' || l.style.display === 'none';
      l.style.display = isHidden ? '' : 'none';
    });
    shell.querySelector('[data-act="config"]').addEventListener('click', openConfigModal);
    shell.querySelector('[data-act="focus"]').addEventListener('click', toggleFocus);
    shell.querySelector('[data-act="save"]').addEventListener('click', () => flushSave());
    shell.querySelector('[data-act="new-ch"]').addEventListener('click', newChapter);
    shell.querySelector('[data-act="refresh"]').addEventListener('click', () => reload());
    shell.querySelector('[data-act="format"]').addEventListener('click', runFormat);
    shell.querySelector('[data-act="ai-panel"]').addEventListener('click', () => {
      DT().notify('🤖 AI 面板：选择右下工具栏按钮（📋章纲 / ✅查错 / ✨润色 / ➡️续写 / 🔥爽点）', 'success');
    });
    titleInput.addEventListener('input', () => { if (state.currentCh) { state.currentCh.title = titleInput.value; markDirty(); } });
    statusSel.addEventListener('change', async () => {
      if (!state.currentCh) return;
      state.currentCh.status = statusSel.value;
      markDirty(); // ← 关键修复：未标记 dirty 会被 flushSave 短路返回
      await flushSave();
      renderList();
      renderHeader(); // 同步 header 中 statusSel 显示（防止被覆盖）
    });
    // 快捷键 Ctrl+Shift+F 专注模式
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault(); toggleFocus();
      }
    });

    function toggleFocus() {
      shell.classList.toggle('ws-focus');
      const btn = shell.querySelector('[data-act="focus"]');
      if (btn) btn.textContent = shell.classList.contains('ws-focus') ? '🎯 退出专注' : '🎯 专注';
    }

    function openConfigModal() {
      const c = state.config;
      const overlay = document.createElement('div');
      overlay.className = 'dt-modal-overlay';
      overlay.innerHTML = `
        <div class="dt-modal">
          <div class="dt-modal-header"><h3>⚙️ 视图配置</h3><button class="dt-modal-close" data-act="close">×</button></div>
          <div class="dt-modal-body">
            <div class="ws-config-list">
              <label><input type="checkbox" data-k="showEncyclopedia" ${c.showEncyclopedia?'checked':''}> 显示「设定百科速览」面板（起点式 mini 百科）</label>
              <label><input type="checkbox" data-k="showRoles" ${c.showRoles?'checked':''}> 显示「本章角色速览」面板</label>
              <label><input type="checkbox" data-k="showSettings" ${c.showSettings?'checked':''}> 显示「本章设定速览」面板</label>
              <label><input type="checkbox" data-k="showHooks" ${c.showHooks?'checked':''}> 显示「伏笔提醒」面板</label>
              <label><input type="checkbox" data-k="showSearch" ${c.showSearch?'checked':''}> 显示「设定百科搜索」框</label>
              <label><input type="checkbox" data-k="showWritingGoal" ${c.showWritingGoal?'checked':''}> 显示「写作目标/打卡」底部栏</label>
              <label><input type="checkbox" data-k="showAIToolbar" ${c.showAIToolbar?'checked':''}> 显示「AI 浮动工具栏」</label>
              <div class="ws-config-sep"></div>
              <div class="ws-config-row"><label>每日写作目标字数</label>
                <input type="number" min="100" step="500" value="${state.goal.daily||6000}" data-goal="daily" style="width:120px;" />
              </div>
            </div>
          </div>
          <div class="dt-modal-footer">
            <button class="dt-btn" data-act="reset">恢复默认</button>
            <button class="dt-btn dt-btn-primary" data-act="save">保存</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', close));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      overlay.querySelector('[data-act="reset"]').addEventListener('click', () => {
        state.config = { ...DEFAULT_CONFIG };
        save(CONFIG_KEY, state.config);
        applyConfig(); close();
        DT().notify('已恢复默认视图配置', 'success');
      });
      overlay.querySelector('[data-act="save"]').addEventListener('click', () => {
        overlay.querySelectorAll('input[type="checkbox"][data-k]').forEach((i) => {
          state.config[i.getAttribute('data-k')] = i.checked;
        });
        const gi = overlay.querySelector('[data-goal="daily"]');
        if (gi) { const v = Number(gi.value) || 6000; state.goal.daily = v; save(GOAL_KEY, state.goal); updateGoalBar(state.currentCh ? (state.currentCh.words||0) : 0); }
        save(CONFIG_KEY, state.config);
        applyConfig(); close();
        DT().notify('配置已保存', 'success');
      });
    }

    // ---------- 排版优化 ----------
    async function runFormat() {
      if (!state.editor) { DT().notify('请先选择一个章节', 'warning'); return; }
      const text = state.editor.getValue() || '';
      if (!text) return;
      const DTGlobal = DT();
      let opt;
      if (DTGlobal.modules && DTGlobal.modules._formatUtils && DTGlobal.modules._formatUtils.optimizeNovelFormat) {
        opt = DTGlobal.modules._formatUtils.optimizeNovelFormat;
      } else {
        try {
          const m = await import('../../src/core/format-utils.js');
          if (!DTGlobal.modules) DTGlobal.modules = {};
          DTGlobal.modules._formatUtils = m; opt = m.optimizeNovelFormat;
        } catch (_) {
          DT().notify('排版工具加载失败，请通过 server.py 启动（避免 file:// CORS）', 'error'); return;
        }
      }
      const newText = opt(text);
      state.editor.setValue(newText);
      DT().notify('✅ 已完成排版优化：缩进/空行/标点/对话分段', 'success');
    }

    // ---------- AI 浮动工具栏 ----------
    aiFloat.querySelectorAll('.ws-ai-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const kind = b.getAttribute('data-ai');
        const map = {
          outline: '📋 写章纲', check: '✅ 查错', polish: '✨ 润色',
          continue: '➡️ 续写', highlight: '🔥 想爽点',
        };
        // 优先调用 AI 适配层
        const DTGlobal = DT();
        const ai = (DTGlobal && DTGlobal.modules && DTGlobal.modules.ai && DTGlobal.modules.ai.default)
          || (typeof window !== 'undefined' && window.DreamTaleAI);
        if (ai && typeof ai === 'object' && typeof ai.call === 'function') {
          DT().notify(`${map[kind]||''} 正在请求 AI…`, 'info');
          // 真实调用在 Modules 层实现，此处为钩子占位
          setTimeout(() => DT().notify(`${map[kind]||''}：未配置 AI 适配器，请前往「AI 配置」面板`, 'warning'), 800);
        } else {
          DT().notify(`${map[kind]||''}：未配置 AI 适配器，请前往「🤖 AI 配置」面板连接服务`, 'warning');
        }
      });
    });

    // ---------- 新建章节 ----------
    function newChapter() {
      if (!state.volumes.length) { DT().notify('请先在「大纲」中创建至少一卷', 'warning'); return; }
      const overlay = document.createElement('div');
      overlay.className = 'dt-modal-overlay';
      overlay.innerHTML = `
        <div class="dt-modal">
          <div class="dt-modal-header"><h3>+ 新建章节</h3><button class="dt-modal-close" data-act="close">×</button></div>
          <div class="dt-modal-body">
            <div class="dt-form">
              <div class="dt-form-row"><label>选择卷</label>
                <select data-f="vol_no">
                  ${state.volumes.map((v) => `<option value="${esc(v.vol_no)}">第 ${esc(v.vol_no)} 卷 · ${esc(v.vol_name||'未命名')}</option>`).join('')}
                </select>
              </div>
              <div class="dt-form-row"><label>章节标题</label>
                <input type="text" data-f="title" placeholder="例如：初入青云宗" />
              </div>
            </div>
          </div>
          <div class="dt-modal-footer">
            <button class="dt-btn" data-act="cancel">取消</button>
            <button class="dt-btn dt-btn-primary" data-act="submit">创建</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelectorAll('[data-act="close"], [data-act="cancel"]').forEach((b) => b.addEventListener('click', close));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      overlay.querySelector('[data-act="submit"]').addEventListener('click', async () => {
        const vn = overlay.querySelector('[data-f="vol_no"]').value;
        const title = overlay.querySelector('[data-f="title"]').value.trim() || '新章节';
        const volChs = state.chapters.filter((c) => c.vol_no === vn);
        let max = 0; volChs.forEach((c) => { const n = Number(c.ch_no) || 0; if (n > max) max = n; });
        const cn = padCh(max + 1);
        const payload = { vol_no: vn, ch_no: cn, title, content: '', summary: '', highlights: [], words: 0, status: 'draft', updated_at: new Date().toISOString() };
        try {
          await DT().storage.saveChapter(pid, payload);
          DT().notify(`已创建第 ${vn} 卷 第 ${cn} 章：${title}`, 'success');
          close();
          await reload();
          await selectChapter(chKey(payload));
        } catch (err) {
          console.error(err); DT().notify('创建失败：' + (err.message || err), 'error');
        }
      });
    }

    // ---------- 离开前保存 ----------
    const beforeUnload = () => { if (state.dirty) return '有未保存的改动'; };
    window.addEventListener('beforeunload', beforeUnload);

    // 清理钩子
    container._dtChaptersCleanup = () => {
      clearTimeout(state.autoSaveTimer); clearTimeout(state._scanT);
      window.removeEventListener('beforeunload', beforeUnload);
      destroyEditor();
    };

    // 主题同步
    try { shell.setAttribute('data-theme', DT().state.theme || 'light'); } catch (_) {}
    const origSetTheme = DT().theme && DT().theme.set;
    if (origSetTheme) {
      DT().theme.set = function (t) {
        origSetTheme(t);
        try { shell.setAttribute('data-theme', t || 'light'); } catch (_) {}
        if (state.editor && typeof state.editor.setTheme === 'function') {
          try { state.editor.setTheme(t); } catch (_) {}
        }
      };
    }

    // 初次加载 & 底部打卡渲染
    updateGoalBar(0);
    await reload();
  }

  function getProjectId() {
    const proj = DT().state.currentProject;
    if (!proj) { DT().notify('请先在「作品管理」中选择一个作品', 'warning'); return null; }
    return proj.id;
  }

  NS.renderWritingStation = renderWritingStation;
  // 兼容旧 renderChapters 调用（作为默认实现替换）
  NS.renderChapters = renderWritingStation;
})(window);
