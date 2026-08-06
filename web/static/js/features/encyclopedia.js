/**
 * DreamTale · 设定百科功能模块（encyclopedia.js）
 *
 * 交互参照：番茄小说作家后台 + 起点中文网作品设定中心
 * 布局：三栏（左侧分类 Tab + 标签云 / 中间词条列表 / 右侧详情抽屉）
 *
 * 功能：
 *   1. 8 大分类 Tab：角色/地点/功法/势力/事件/物品/概念/其他（带数量徽标）
 *   2. 顶部全局搜索（防抖 200ms，五字段加权搜索：name/aliases/tags/summary/content）
 *   3. 标签云筛选 + 分类筛选 + 搜索高亮
 *   4. 词条列表支持卡片/列表两种视图
 *   5. 右侧滑入式详情抽屉：编辑 name/type/summary/content/tags/aliases/related/first_appear
 *   6. 导出设定集：Markdown（按分类分章节）/ JSON 双格式
 *   7. 写作站模块复用入口：DTEncyclopediaPanel() 给 writing-station.js 右栏调用
 *
 * 通过 window.DreamTaleFeatures.renderEncyclopedia(container) 挂载。
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ==================== 通用工具 ====================
  function DT() {
    if (!global.DreamTale) throw new Error('[encyclopedia] window.DreamTale 未初始化');
    return global.DreamTale;
  }
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return 'ency_' + Math.random().toString(36).slice(2, 10); }
  function getProjectId() {
    const proj = DT().state.currentProject;
    if (!proj) { DT().notify('请先在「作品管理」中选择一个作品', 'warning'); return null; }
    return proj.id;
  }
  const DEBOUNCE_MS = 200;
  function debounce(fn, ms = DEBOUNCE_MS) {
    let t; return function (...args) {
      clearTimeout(t);
      const ctx = this;
      t = setTimeout(() => fn.apply(ctx, args), ms);
    };
  }
  function formatDate(iso) {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0') + ' '
        + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (_) { return String(iso).slice(0, 16); }
  }
  function typeMeta(typeKey) {
    const types = (DT().modules && DT().models && DT().models.ENCYCLOPEDIA_TYPES) || [
      { key: 'character', label: '角色', icon: '👤', color: '#e74c3c' },
      { key: 'place',     label: '地点', icon: '📍', color: '#3498db' },
      { key: 'skill',     label: '功法', icon: '⚔️', color: '#2ecc71' },
      { key: 'faction',   label: '势力', icon: '🏛️', color: '#9b59b6' },
      { key: 'event',     label: '事件', icon: '📅', color: '#f39c12' },
      { key: 'item',      label: '物品', icon: '💎', color: '#1abc9c' },
      { key: 'concept',   label: '概念', icon: '💡', color: '#e67e22' },
      { key: 'other',     label: '其他', icon: '📁', color: '#7f8c8d' },
    ];
    return types.find(t => t.key === typeKey) || types[types.length - 1];
  }
  function allTypes() {
    return (DT().modules && DT().models && DT().models.ENCYCLOPEDIA_TYPES) || [
      { key: 'character', label: '角色', icon: '👤', color: '#e74c3c' },
      { key: 'place',     label: '地点', icon: '📍', color: '#3498db' },
      { key: 'skill',     label: '功法', icon: '⚔️', color: '#2ecc71' },
      { key: 'faction',   label: '势力', icon: '🏛️', color: '#9b59b6' },
      { key: 'event',     label: '事件', icon: '📅', color: '#f39c12' },
      { key: 'item',      label: '物品', icon: '💎', color: '#1abc9c' },
      { key: 'concept',   label: '概念', icon: '💡', color: '#e67e22' },
      { key: 'other',     label: '其他', icon: '📁', color: '#7f8c8d' },
    ];
  }

  // ==================== 主渲染入口：完整三栏百科视图 ====================
  NS.renderEncyclopedia = async function renderEncyclopedia(container) {
    if (!container) throw new Error('[encyclopedia] container 不能为空');
    const pid = getProjectId();
    if (!pid) {
      container.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    // ---------- 运行时状态 ----------
    const state = {
      pid,
      entries: [],
      filtered: [],
      currentType: 'all',
      activeTags: new Set(),
      searchQuery: '',
      viewMode: 'card', // 'card' | 'list'
      currentEntry: null, // 详情抽屉正在编辑的 entry
      dirty: false,
    };

    // ---------- 渲染主骨架 ----------
    container.innerHTML = SHELL_HTML;
    const shell = container.querySelector('.ency-shell');
    const leftEl = shell.querySelector('.ency-left');
    const listEl = shell.querySelector('.ency-list');
    const drawerEl = shell.querySelector('.ency-drawer');
    const searchInput = shell.querySelector('.ency-search-input');
    const newBtn = shell.querySelector('[data-act="new"]');
    const exportBtn = shell.querySelector('[data-act="export"]');
    const viewBtn = shell.querySelector('[data-act="toggle-view"]');
    const closeDrawerBtn = shell.querySelector('[data-act="close-drawer"]');
    const saveBtn = shell.querySelector('[data-act="save-entry"]');
    const deleteBtn = shell.querySelector('[data-act="delete-entry"]');

    // ---------- 数据加载 ----------
    async function reload() {
      state.entries = await DT().storage.listEncyclopediaEntries(pid);
      applyFilters();
      renderLeft();
      renderList();
    }

    function applyFilters() {
      let list = state.entries.slice();
      // 类型
      if (state.currentType !== 'all') {
        list = list.filter(e => e.type === state.currentType);
      }
      // 标签
      if (state.activeTags.size > 0) {
        list = list.filter(e => (e.tags || []).some(t => state.activeTags.has(t)));
      }
      // 搜索（调用 storage.searchEncyclopedia 做加权搜索）
      const q = state.searchQuery.trim();
      if (q) {
        // 先从 storage 取结果，保留顺序
        DT().storage.searchEncyclopedia(pid, q, {
          type: state.currentType === 'all' ? undefined : state.currentType,
          tags: state.activeTags.size ? [...state.activeTags] : undefined,
        }).then(results => {
          state.filtered = results.map(r => r.entry);
          renderList(results);
        });
        // 先展示一个过滤占位
        state.filtered = list.filter(e =>
          String(e.name || '').toLowerCase().includes(q.toLowerCase())
          || (e.aliases || []).some(a => String(a).toLowerCase().includes(q.toLowerCase()))
        );
        return;
      }
      state.filtered = list;
    }

    // ---------- 左侧：分类 + 标签云 ----------
    function renderLeft() {
      // 计算各分类数量
      const countMap = {};
      for (const e of state.entries) countMap[e.type] = (countMap[e.type] || 0) + 1;
      const total = state.entries.length;

      // 分类列表
      let typeItems = `<div class="ency-type-item ${state.currentType === 'all' ? 'active' : ''}" data-type="all">
        <span class="ency-type-icon">📚</span>
        <span class="ency-type-label">全部</span>
        <span class="ency-type-count">${total}</span>
      </div>`;
      for (const t of allTypes()) {
        const c = countMap[t.key] || 0;
        const active = state.currentType === t.key;
        typeItems += `<div class="ency-type-item ${active ? 'active' : ''}" data-type="${t.key}" style="--type-color:${t.color}">
          <span class="ency-type-icon">${t.icon}</span>
          <span class="ency-type-label">${t.label}</span>
          <span class="ency-type-count">${c}</span>
        </div>`;
      }

      // 标签云（取 Top 30 标签，按 count 排序）
      const tagMap = new Map();
      for (const e of state.entries) {
        for (const t of e.tags || []) {
          tagMap.set(t, (tagMap.get(t) || 0) + 1);
        }
      }
      const tagArr = [...tagMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
      let tagHTML = '';
      const maxCount = tagArr.length ? tagArr[0][1] : 1;
      for (const [name, count] of tagArr) {
        // 标签大小随 count 递增
        const size = 0.85 + Math.min(0.8, count / maxCount * 0.8);
        const active = state.activeTags.has(name);
        tagHTML += `<span class="ency-tag ${active ? 'active' : ''}" data-tag="${esc(name)}" style="font-size:${size.toFixed(2)}rem;">
          ${esc(name)}<span class="ency-tag-count">${count}</span>
        </span>`;
      }
      if (!tagHTML) tagHTML = '<p class="ency-empty-tag">还没有标签，在词条中添加即可自动出现</p>';

      leftEl.innerHTML = `
        <div class="ency-left-section">
          <div class="ency-section-title">📋 分类</div>
          <div class="ency-type-list">${typeItems}</div>
        </div>
        <div class="ency-left-section">
          <div class="ency-section-title">
            🏷️ 标签云
            ${state.activeTags.size > 0 ? `<button class="ency-tags-clear" data-act="clear-tags">清除 (${state.activeTags.size})</button>` : ''}
          </div>
          <div class="ency-tag-cloud">${tagHTML}</div>
        </div>
      `;

      // 绑定分类点击
      leftEl.querySelectorAll('[data-type]').forEach(el => {
        el.addEventListener('click', () => {
          state.currentType = el.getAttribute('data-type');
          applyFilters();
          renderLeft();
          renderList();
        });
      });
      // 绑定标签点击
      leftEl.querySelectorAll('[data-tag]').forEach(el => {
        el.addEventListener('click', () => {
          const tag = el.getAttribute('data-tag');
          if (state.activeTags.has(tag)) state.activeTags.delete(tag);
          else state.activeTags.add(tag);
          applyFilters();
          renderLeft();
          renderList();
        });
      });
      const clearTagsBtn = leftEl.querySelector('[data-act="clear-tags"]');
      if (clearTagsBtn) clearTagsBtn.addEventListener('click', () => {
        state.activeTags.clear();
        applyFilters();
        renderLeft();
        renderList();
      });
    }

    // ---------- 中间：词条列表（卡片 / 列表 双视图）----------
    function renderList(searchResults /* optional pre-weighted results */) {
      const list = state.filtered;
      // 顶部计数
      const headerInfo = listEl.querySelector('.ency-list-header-info');
      if (headerInfo) {
        let info = `共 <b>${list.length}</b> 条`;
        if (state.searchQuery.trim()) info += ` · 搜索「${esc(state.searchQuery.trim())}」`;
        if (state.currentType !== 'all') info += ` · 分类：${typeMeta(state.currentType).label}`;
        if (state.activeTags.size) info += ` · 标签 ${state.activeTags.size} 个`;
        headerInfo.innerHTML = info;
      }
      const listBody = listEl.querySelector('.ency-list-body');
      if (!listBody) return;
      if (!list.length) {
        listBody.innerHTML = `<div class="ency-empty">
          <div class="ency-empty-icon">📚</div>
          <p>${state.searchQuery.trim() ? '没有找到匹配的词条' : '还没有词条，点击右上角「+ 新词条」开始创建'}</p>
        </div>`;
        return;
      }
      // 构建搜索命中映射（供高亮用）
      const hitMap = new Map();
      if (searchResults) for (const r of searchResults) hitMap.set(r.entry.id, r);

      if (state.viewMode === 'card') {
        listBody.innerHTML = `<div class="ency-card-grid">
          ${list.map(e => renderCard(e, hitMap.get(e.id))).join('')}
        </div>`;
      } else {
        listBody.innerHTML = `<table class="ency-list-table">
          <thead><tr>
            <th>名称</th><th>类型</th><th>摘要</th><th>标签</th><th>更新时间</th>
          </tr></thead>
          <tbody>
            ${list.map(e => renderListRow(e, hitMap.get(e.id))).join('')}
          </tbody>
        </table>`;
      }
      // 绑定词条点击
      listBody.querySelectorAll('[data-entry-id]').forEach(el => {
        el.addEventListener('click', () => openEntry(el.getAttribute('data-entry-id')));
      });
    }

    function highlight(text, query) {
      const q = (query || '').trim();
      if (!q) return esc(text || '');
      try {
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(' + safe + ')', 'ig');
        return esc(String(text || '')).replace(re, '<mark class="ency-search-hit">$1</mark>');
      } catch (_) { return esc(text || ''); }
    }

    function renderCard(entry, hit) {
      const meta = typeMeta(entry.type);
      const q = state.searchQuery.trim();
      const summary = (entry.summary || '（暂无摘要）').slice(0, 100);
      let tagsHTML = '';
      for (const t of (entry.tags || []).slice(0, 5)) {
        tagsHTML += `<span class="ency-chip">${esc(t)}</span>`;
      }
      return `<div class="ency-card" data-entry-id="${entry.id}" style="--card-accent:${meta.color}">
        <div class="ency-card-head">
          <span class="ency-type-badge" style="background:${meta.color}22;color:${meta.color};border-color:${meta.color}55;">
            ${meta.icon} ${meta.label}
          </span>
        </div>
        <div class="ency-card-title">${highlight(entry.name, q)}</div>
        ${entry.aliases && entry.aliases.length ? `<div class="ency-card-alias">别名：${esc(entry.aliases.join(' / '))}</div>` : ''}
        <div class="ency-card-summary">${highlight(summary, q)}</div>
        ${tagsHTML ? `<div class="ency-card-tags">${tagsHTML}</div>` : ''}
        <div class="ency-card-foot">
          <span class="ency-card-time">🕑 ${formatDate(entry.updated_at)}</span>
          ${hit && hit.score ? `<span class="ency-card-score">命中 ${hit.score}</span>` : ''}
        </div>
      </div>`;
    }

    function renderListRow(entry, hit) {
      const meta = typeMeta(entry.type);
      const q = state.searchQuery.trim();
      const tagChips = (entry.tags || []).slice(0, 3).map(t => `<span class="ency-chip-sm">${esc(t)}</span>`).join('');
      return `<tr class="ency-list-row" data-entry-id="${entry.id}">
        <td class="ency-col-name">
          <span class="ency-type-badge-sm" style="background:${meta.color}22;color:${meta.color};">${meta.icon}</span>
          ${highlight(entry.name, q)}
        </td>
        <td>${meta.label}</td>
        <td class="ency-col-summary">${highlight((entry.summary || '').slice(0, 60) || '-', q)}</td>
        <td>${tagChips || '-'}</td>
        <td>${formatDate(entry.updated_at)}</td>
      </tr>`;
    }

    // ---------- 右侧：详情抽屉 ----------
    function openEntry(entryId) {
      const entry = state.entries.find(e => e.id === entryId);
      if (!entry) { DT().notify('词条不存在', 'warning'); return; }
      state.currentEntry = JSON.parse(JSON.stringify(entry)); // 深拷贝防止脏写
      state.dirty = false;
      renderDrawer();
      drawerEl.classList.add('open');
    }
    function newEntry(typeKey) {
      const models = DT().modules && DT().modules.models;
      const EntryCtor = (models && models.EncyclopediaEntry) || function (o) { return o; };
      const entry = new EntryCtor({
        id: 'ency_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: '',
        type: typeKey || state.currentType === 'all' ? 'character' : state.currentType,
        summary: '',
        content: '',
        tags: [],
        aliases: [],
        related_entries: [],
        first_appear_ch: '',
        sort_order: state.entries.length,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      state.currentEntry = entry;
      state.dirty = true;
      renderDrawer();
      drawerEl.classList.add('open');
      setTimeout(() => {
        const nameInput = drawerEl.querySelector('[data-field="name"]');
        if (nameInput) nameInput.focus();
      }, 150);
    }
    function closeDrawer() {
      if (state.dirty) {
        if (!confirm('有未保存的修改，确定关闭吗？')) return;
      }
      drawerEl.classList.remove('open');
      state.currentEntry = null;
      state.dirty = false;
    }
    function collectFormData() {
      const e = state.currentEntry;
      if (!e) return null;
      const nameEl = drawerEl.querySelector('[data-field="name"]');
      const typeEl = drawerEl.querySelector('[data-field="type"]');
      const summaryEl = drawerEl.querySelector('[data-field="summary"]');
      const contentEl = drawerEl.querySelector('[data-field="content"]');
      const tagsEl = drawerEl.querySelector('[data-field="tags"]');
      const aliasesEl = drawerEl.querySelector('[data-field="aliases"]');
      const relatedEl = drawerEl.querySelector('[data-field="related"]');
      const firstChEl = drawerEl.querySelector('[data-field="first_appear_ch"]');
      const name = nameEl ? nameEl.value.trim() : '';
      if (!name) { DT().notify('请填写词条名称', 'warning'); return null; }
      const splitByComma = v => String(v || '').split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
      return {
        ...e,
        name,
        type: typeEl ? typeEl.value : e.type,
        summary: summaryEl ? summaryEl.value : e.summary,
        content: contentEl ? contentEl.value : e.content,
        tags: tagsEl ? splitByComma(tagsEl.value) : e.tags,
        aliases: aliasesEl ? splitByComma(aliasesEl.value) : e.aliases,
        related_entries: relatedEl ? splitByComma(relatedEl.value) : e.related_entries,
        first_appear_ch: firstChEl ? firstChEl.value.trim() : e.first_appear_ch,
        updated_at: new Date().toISOString(),
      };
    }
    async function saveCurrentEntry() {
      const data = collectFormData();
      if (!data) return;
      const models = DT().modules && DT().modules.models;
      const EntryCtor = (models && models.EncyclopediaEntry) || function (o) { return o; };
      await DT().storage.saveEncyclopediaEntry(pid, new EntryCtor(data));
      state.dirty = false;
      DT().notify('已保存', 'success', 1500);
      await reload();
      // 重新打开当前条目（刷新内容）
      const newEntry = state.entries.find(e => e.id === data.id);
      if (newEntry) {
        state.currentEntry = JSON.parse(JSON.stringify(newEntry));
        renderDrawer();
      }
    }
    async function deleteCurrentEntry() {
      if (!state.currentEntry) return;
      if (!confirm(`确定删除「${state.currentEntry.name}」？此操作不可恢复。`)) return;
      await DT().storage.deleteEncyclopediaEntry(pid, state.currentEntry.id);
      DT().notify('已删除', 'success', 1500);
      state.dirty = false;
      drawerEl.classList.remove('open');
      state.currentEntry = null;
      await reload();
    }

    function renderDrawer() {
      const e = state.currentEntry;
      if (!e) { drawerEl.innerHTML = EMPTY_DRAWER_HTML; return; }
      const meta = typeMeta(e.type);
      // 类型 select 选项
      let typeOptions = '';
      for (const t of allTypes()) {
        typeOptions += `<option value="${t.key}" ${e.type === t.key ? 'selected' : ''}>${t.icon} ${t.label}</option>`;
      }
      // 关联词条建议列表（当前词条以外的）
      const others = state.entries.filter(x => x.id !== e.id).slice(0, 100);
      const relatedHints = others.map(x => `<option value="${esc(x.name)}">${esc(x.name)}（${typeMeta(x.type).label}）</option>`).join('');
      drawerEl.innerHTML = `
        <div class="ency-drawer-head">
          <div>
            <span class="ency-type-badge" style="background:${meta.color}22;color:${meta.color};border-color:${meta.color}55;">
              ${meta.icon} ${meta.label}
            </span>
            <span class="ency-drawer-meta">创建于 ${formatDate(e.created_at)} · 最近更新 ${formatDate(e.updated_at)}</span>
          </div>
          <button class="ency-drawer-close" data-act="close-drawer" aria-label="关闭">×</button>
        </div>
        <div class="ency-drawer-body">
          <div class="ency-form">
            <div class="ency-form-row">
              <label>词条名称 <span class="ency-required">*</span></label>
              <input class="ency-input" type="text" data-field="name" value="${esc(e.name)}" placeholder="如：沈砚 / 青云宗 / 问渊九式" />
            </div>
            <div class="ency-form-row">
              <label>类型</label>
              <select class="ency-select" data-field="type">${typeOptions}</select>
            </div>
            <div class="ency-form-row">
              <label>摘要（一句话概述）</label>
              <textarea class="ency-textarea ency-textarea-sm" data-field="summary" rows="2" placeholder="一句话讲清楚这个设定">${esc(e.summary)}</textarea>
            </div>
            <div class="ency-form-row">
              <label>别名（用逗号或空格分隔）</label>
              <input class="ency-input" type="text" data-field="aliases" value="${esc((e.aliases || []).join('，'))}" placeholder="如：小砚子 / 沈道友" />
            </div>
            <div class="ency-form-row">
              <label>标签（逗号分隔）</label>
              <input class="ency-input" type="text" data-field="tags" value="${esc((e.tags || []).join('，'))}" placeholder="如：主角, 剑修, 隐忍" list="ency-tag-suggestions" />
              <datalist id="ency-tag-suggestions">
                ${[...new Set(state.entries.flatMap(x => x.tags || []))].slice(0, 50).map(t => `<option value="${esc(t)}">`).join('')}
              </datalist>
            </div>
            <div class="ency-form-row">
              <label>关联词条（名称，逗号分隔）</label>
              <input class="ency-input" type="text" data-field="related" value="${esc((e.related_entries || []).join('，'))}" placeholder="输入关联的其他词条名称" list="ency-related-suggestions" />
              <datalist id="ency-related-suggestions">${relatedHints}</datalist>
            </div>
            <div class="ency-form-row">
              <label>首次登场章节</label>
              <input class="ency-input" type="text" data-field="first_appear_ch" value="${esc(e.first_appear_ch)}" placeholder="如：第 3 章 / 01:003" />
            </div>
            <div class="ency-form-row">
              <label>详细内容（Markdown）</label>
              <textarea class="ency-textarea" data-field="content" rows="14" placeholder="详细描述这个设定，支持 Markdown 格式：

## 性格
...
## 经历
...
## 金句
> 我命由我不由天">${esc(e.content)}</textarea>
            </div>
          </div>
        </div>
        <div class="ency-drawer-foot">
          <button class="ency-btn ency-btn-danger" data-act="delete-entry" ${!state.entries.find(x => x.id === e.id) ? 'disabled style="display:none;"' : ''}>🗑️ 删除</button>
          <div style="flex:1"></div>
          <button class="ency-btn" data-act="close-drawer">取消</button>
          <button class="ency-btn ency-btn-primary" data-act="save-entry">💾 保存</button>
        </div>
      `;
      // 绑定脏标记
      drawerEl.querySelectorAll('[data-field]').forEach(el => {
        el.addEventListener('input', () => { state.dirty = true; });
        el.addEventListener('change', () => { state.dirty = true; });
      });
      // 重新绑定按钮
      const closeBtn2 = drawerEl.querySelector('[data-act="close-drawer"]');
      if (closeBtn2) closeBtn2.addEventListener('click', closeDrawer);
      const saveBtn2 = drawerEl.querySelector('[data-act="save-entry"]');
      if (saveBtn2) saveBtn2.addEventListener('click', saveCurrentEntry);
      const delBtn2 = drawerEl.querySelector('[data-act="delete-entry"]');
      if (delBtn2) delBtn2.addEventListener('click', deleteCurrentEntry);
    }

    // ---------- 导出 ----------
    async function doExport(format) {
      // 先计算要导出的词条：按当前筛选结果
      const entries = state.filtered.length > 0 ? state.filtered : state.entries;
      if (!entries.length) { DT().notify('没有可导出的词条', 'warning'); return; }
      if (format === 'md') exportMarkdown(entries);
      else exportJSON(entries);
    }
    function exportJSON(entries) {
      const payload = {
        exported_at: new Date().toISOString(),
        total: entries.length,
        project: (DT().state.currentProject && DT().state.currentProject.name) || '未命名',
        entries: entries.map(e => e.toJSON ? e.toJSON() : e),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      downloadBlob(blob, `${safeProjName()}-设定百科.json`);
      DT().notify('已导出 JSON（' + entries.length + ' 条）', 'success', 2000);
    }
    function exportMarkdown(entries) {
      const lines = [];
      const projName = (DT().state.currentProject && DT().state.currentProject.name) || '未命名作品';
      lines.push('# ' + projName + ' · 设定百科');
      lines.push('');
      lines.push('> 导出时间：' + formatDate(new Date().toISOString()));
      lines.push('> 词条总数：' + entries.length);
      lines.push('');
      // 按类型分组
      const groups = {};
      for (const e of entries) {
        (groups[e.type] = groups[e.type] || []).push(e);
      }
      for (const t of allTypes()) {
        const arr = groups[t.key] || [];
        if (!arr.length) continue;
        lines.push('## ' + t.icon + ' ' + t.label + '（' + arr.length + '）');
        lines.push('');
        // 词条按字母/创建时间排序
        arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        for (const e of arr) {
          lines.push('### ' + e.name);
          lines.push('');
          if (e.aliases && e.aliases.length) lines.push('- **别名**：' + e.aliases.join(' / '));
          if (e.tags && e.tags.length) lines.push('- **标签**：' + e.tags.map(x => '`' + x + '`').join(' '));
          if (e.first_appear_ch) lines.push('- **首次登场**：' + e.first_appear_ch);
          if (e.related_entries && e.related_entries.length) lines.push('- **关联词条**：' + e.related_entries.join(' / '));
          if (e.summary) { lines.push(''); lines.push('> ' + e.summary.replace(/\n/g, '\n> ')); }
          lines.push('');
          if (e.content) { lines.push(e.content); lines.push(''); }
          lines.push('---');
          lines.push('');
        }
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
      downloadBlob(blob, `${safeProjName()}-设定百科.md`);
      DT().notify('已导出 Markdown 设定集（' + entries.length + ' 条）', 'success', 2000);
    }
    function safeProjName() {
      const n = (DT().state.currentProject && DT().state.currentProject.name) || 'dreamtale';
      return String(n).replace(/[\\/:*?"<>|]/g, '_');
    }
    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }
    // 导出模态框
    function openExportDialog() {
      const entries = state.filtered.length > 0 ? state.filtered : state.entries;
      const overlay = document.createElement('div');
      overlay.className = 'ency-modal-overlay';
      const curHint = state.searchQuery.trim() || state.currentType !== 'all' || state.activeTags.size
        ? `<p style="margin:8px 0 4px;color:var(--ink-secondary);font-size:13px;">当前筛选结果：${entries.length} 条（将导出此筛选集合）</p>`
        : `<p style="margin:8px 0 4px;color:var(--ink-secondary);font-size:13px;">将导出全部词条共 ${entries.length} 条</p>`;
      overlay.innerHTML = `
        <div class="ency-modal">
          <div class="ency-modal-head">
            <h3>📦 导出设定集</h3>
            <button class="ency-drawer-close" data-act="close" aria-label="关闭">×</button>
          </div>
          <div class="ency-modal-body">
            <p>选择导出格式：</p>
            ${curHint}
            <div class="ency-export-options">
              <button class="ency-export-card" data-fmt="md">
                <div class="ency-export-icon">📄</div>
                <div class="ency-export-title">Markdown 设定集</div>
                <div class="ency-export-desc">按分类分章节排版，可直接给读者 / 自己备查</div>
              </button>
              <button class="ency-export-card" data-fmt="json">
                <div class="ency-export-icon">🗂️</div>
                <div class="ency-export-title">JSON 数据</div>
                <div class="ency-export-desc">完整结构化数据，可用于导入备份 / 二次开发</div>
              </button>
            </div>
          </div>
        </div>`;
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      overlay.querySelector('[data-act="close"]').addEventListener('click', () => overlay.remove());
      overlay.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
        doExport(b.getAttribute('data-fmt'));
        overlay.remove();
      }));
      document.body.appendChild(overlay);
    }

    // ---------- 顶部工具栏事件 ----------
    const onSearch = debounce(() => {
      state.searchQuery = searchInput.value;
      applyFilters();
      renderLeft();
      renderList();
    }, 200);
    searchInput.addEventListener('input', onSearch);
    newBtn.addEventListener('click', () => newEntry());
    exportBtn.addEventListener('click', openExportDialog);
    viewBtn.addEventListener('click', () => {
      state.viewMode = state.viewMode === 'card' ? 'list' : 'card';
      viewBtn.textContent = state.viewMode === 'card' ? '☰ 列表' : '▦ 卡片';
      renderList();
    });
    closeDrawerBtn.addEventListener('click', closeDrawer);
    if (saveBtn) saveBtn.addEventListener('click', saveCurrentEntry);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteCurrentEntry);

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerEl.classList.contains('open')) closeDrawer();
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault(); searchInput.focus(); searchInput.select();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && state.currentEntry) {
        e.preventDefault(); saveCurrentEntry();
      }
    });

    // 初始渲染
    renderDrawer(); // 空抽屉
    await reload();
    // Demo 项目时填充示例词条
    if (state.entries.length === 0
        && DT().state.currentProject
        && /示例|Demo|星河序曲/i.test(DT().state.currentProject.name || '')) {
      await seedDemoEntries(pid);
      await reload();
      DT().notify('已为示例项目填充示例设定词条', 'success', 2500);
    }
  };

  // ==================== 写作站右栏百科 mini 面板（复用入口）====================
  /**
   * 给 writing-station.js 用：扫描当前正文内容，匹配命中的百科词条，
   * 返回 { panelHTML, bindHandlers(container, onOpenEntry) }
   * @param {object} opts { pid, entries:EncyclopediaEntry[], content:string }
   */
  NS.DTEncyclopediaPanel = function DTEncyclopediaPanel(opts) {
    const { pid, entries, content } = opts || {};
    // 扫正文：按词条 name + aliases 做关键词匹配（取前 20 条匹配）
    const matched = [];
    const textLower = String(content || '').toLowerCase();
    const list = entries || [];
    for (const e of list) {
      let count = 0;
      const name = String(e.name || '').toLowerCase();
      if (name && textLower.includes(name)) count += (textLower.split(name).length - 1);
      for (const a of e.aliases || []) {
        const al = String(a).toLowerCase();
        if (al && textLower.includes(al)) count += (textLower.split(al).length - 1);
      }
      if (count > 0) matched.push({ entry: e, count });
    }
    matched.sort((a, b) => b.count - a.count);
    matched.length = Math.min(matched.length, 30);
    // 分类汇总
    const typeCountMap = {};
    for (const m of matched) {
      const k = m.entry.type;
      typeCountMap[k] = (typeCountMap[k] || 0) + 1;
    }
    let typeSummary = '';
    for (const t of allTypes()) {
      const c = typeCountMap[t.key];
      if (c) typeSummary += `<span class="ws-ency-total-chip" style="--chip-color:${t.color};">${t.icon}${c}</span>`;
    }
    let listHTML = '';
    if (matched.length === 0) {
      listHTML = `<div class="ws-ency-empty">
        <p>本章节暂未命中设定词条</p>
        <p style="opacity:0.6;font-size:12px;">词条名称或别名出现在正文时会自动出现在这里</p>
      </div>`;
    } else {
      for (const { entry: e, count } of matched) {
        const meta = typeMeta(e.type);
        listHTML += `<div class="ws-ency-item" data-entry-id="${e.id}">
          <span class="ws-ency-item-type" style="color:${meta.color};">${meta.icon}</span>
          <div class="ws-ency-item-main">
            <div class="ws-ency-item-name">${esc(e.name)}
              ${e.aliases && e.aliases.length ? `<span class="ws-ency-item-alias">（${esc(e.aliases[0])}）</span>` : ''}
            </div>
            ${e.summary ? `<div class="ws-ency-item-summary">${esc(e.summary.slice(0, 40))}</div>` : ''}
          </div>
          <span class="ws-ency-item-count">×${count}</span>
        </div>`;
      }
    }
    return {
      matched,
      panelHTML: `
        <div class="ws-ency-mini">
          <div class="ws-ency-mini-toolbar">
            <input class="ws-ency-search" type="text" data-act="ency-search" placeholder="🔍 搜设定…" />
            <button class="ws-btn ws-btn-sm ws-btn-ghost" data-act="ency-open-full" title="打开完整设定百科">📚 全览</button>
          </div>
          <div class="ws-ency-summary">
            ${typeSummary || '<span class="ws-ency-total-empty">本章节未引用设定</span>'}
            <span class="ws-ency-total-count">共 ${matched.length} 条</span>
          </div>
          <div class="ws-ency-list" data-slot="ency-list">${listHTML}</div>
        </div>
      `,
      bindHandlers(container, onOpenEntry) {
        const listEl = container.querySelector('[data-slot="ency-list"]');
        if (listEl) {
          listEl.querySelectorAll('[data-entry-id]').forEach(el => {
            el.addEventListener('click', () => {
              if (typeof onOpenEntry === 'function') onOpenEntry(el.getAttribute('data-entry-id'));
            });
          });
        }
        const openFull = container.querySelector('[data-act="ency-open-full"]');
        if (openFull) openFull.addEventListener('click', () => DT().router.navigate('#/encyclopedia'));
      },
    };
  };

  // ==================== 示例词条种子（Demo 项目首启自动写入）====================
  async function seedDemoEntries(pid) {
    const models = DT().modules && DT().modules.models;
    const EntryCtor = (models && models.EncyclopediaEntry) || function (o) { return o; };
    const now = new Date().toISOString();
    const demo = [
      { name: '沈砚', type: 'character', summary: '主角，青云宗外门→剑修，境界筑基后期，性格隐忍清醒',
        aliases: ['小砚子', '沈道友'], tags: ['主角', '剑修', '隐忍'],
        content: '## 出身\n青云宗外门弟子。\n\n## 性格\n外冷内热，不卑不亢。\n', first_appear_ch: '第 1 章', related_entries: ['问渊', '青云宗'], sort_order: 1 },
      { name: '阿箩', type: 'character', summary: '女主，妖族九尾狐裔，化形中期，外冷内热护短',
        aliases: ['九尾'], tags: ['女主', '妖族', '九尾狐'],
        content: '妖族九尾狐一族遗孤。', first_appear_ch: '第 5 章', related_entries: ['沈砚'], sort_order: 2 },
      { name: '问渊剑尊', type: 'character', summary: '金手指/引路人，上古剑尊残识，冷漠寡言亦师亦敌',
        aliases: ['问渊'], tags: ['金手指', '引路人'],
        content: '残识藏于「问渊」残剑之内。', first_appear_ch: '第 2 章', sort_order: 3 },
      { name: '青云宗', type: 'faction', summary: '主角出身地，中州鹤鸣山，分外门/内门/剑峰',
        aliases: ['鹤鸣山'], tags: ['正道', '宗门'],
        content: '## 山门\n坐落于中州鹤鸣山，云雾缭绕。\n\n## 建制\n外门 → 内门 → 剑峰真传。', first_appear_ch: '第 1 章', related_entries: ['沈砚'], sort_order: 4 },
      { name: '寒江', type: 'place', summary: '南北分界之江，江底沉有上古剑骨，冬结冰桥夏行水怪',
        tags: ['地图', '界河'], first_appear_ch: '第 12 章', sort_order: 5 },
      { name: '残剑「问渊」', type: 'item', summary: '上古剑尊佩剑残片，可吸收剑骨逐步完整，每得一截获对应剑尊记忆',
        aliases: ['问渊'], tags: ['金手指', '武器'], first_appear_ch: '第 2 章', related_entries: ['问渊剑尊'], sort_order: 6 },
      { name: '问渊九式', type: 'skill', summary: '上古剑尊所传绝世剑法，共九式，沈砚目前习得前三式',
        tags: ['功法', '剑道'], first_appear_ch: '第 3 章', sort_order: 7 },
      { name: '青云剑诀', type: 'skill', summary: '青云宗入门基础剑法，共七十二路，沈砚已炉火纯青',
        tags: ['功法', '基础'], first_appear_ch: '第 1 章', sort_order: 8 },
      { name: '剑冢试剑', type: 'event', summary: '青云宗后山剑冢，沈砚于此处拔出残剑「问渊」',
        tags: ['转折点', '金手指觉醒'], first_appear_ch: '第 2 章', related_entries: ['沈砚', '残剑「问渊」'], sort_order: 9 },
      { name: '筑基', type: 'concept', summary: '修真境界之一，聚气成台筑道基，共前中后大圆满四阶',
        tags: ['境界', '修行体系'], sort_order: 10 },
    ];
    const entries = demo.map(d => new EntryCtor({ id: 'ency_seed_' + Math.random().toString(36).slice(2, 8), created_at: now, updated_at: now, ...d }));
    if (typeof DT().storage.saveEncyclopediaEntries === 'function') {
      await DT().storage.saveEncyclopediaEntries(pid, entries);
    } else {
      for (const e of entries) await DT().storage.saveEncyclopediaEntry(pid, e);
    }
  }

  // ==================== HTML 模板常量（避免超长内嵌字符串）====================
  const SHELL_HTML = `
  <div class="ency-shell">
    <div class="ency-topbar">
      <div class="ency-search">
        <span class="ency-search-icon">🔍</span>
        <input class="ency-search-input" type="text" placeholder="搜索设定：输入任何名称 / 别名 / 标签 / 内容…（Ctrl+K 聚焦）" />
        <kbd class="ency-search-kbd">Ctrl+K</kbd>
      </div>
      <div style="flex:1"></div>
      <button class="ency-btn" data-act="toggle-view" title="切换视图">☰ 列表</button>
      <button class="ency-btn ency-btn-primary" data-act="new">＋ 新词条</button>
      <button class="ency-btn ency-btn-ghost" data-act="export" title="导出设定集">📦 导出</button>
    </div>
    <div class="ency-body">
      <aside class="ency-left"></aside>
      <section class="ency-list">
        <div class="ency-list-header">
          <div class="ency-list-header-info"></div>
        </div>
        <div class="ency-list-body"></div>
      </section>
      <aside class="ency-drawer">
        <button class="ency-drawer-close" data-act="close-drawer" aria-label="关闭">×</button>
      </aside>
    </div>
  </div>`;

  const EMPTY_DRAWER_HTML = `
    <div class="ency-drawer-empty">
      <div class="ency-drawer-empty-icon">📚</div>
      <h3>设定百科</h3>
      <p>选择左侧任一分类下的词条以查看详情<br/>或点击「＋ 新词条」创建一个新的设定</p>
      <div class="ency-drawer-empty-tips">
        <div>💡 <b>快捷键</b>：<kbd>Ctrl+K</kbd> 搜索 / <kbd>Ctrl+S</kbd> 保存 / <kbd>Esc</kbd> 关闭</div>
        <div>💡 <b>分类说明</b>：角色、地点、功法、势力、事件、物品、概念、其他</div>
        <div>💡 <b>导出</b>：支持 Markdown（给读者看）和 JSON（结构化备份）</div>
      </div>
    </div>`;

})(window);

