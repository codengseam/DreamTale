/**
 * DreamTale · 伏笔管理功能模块
 *
 * 功能：
 * - 顶部统计卡片：总伏笔数 / 已回收 / 回收中 / 已埋 / 废弃
 * - 伏笔列表表格：hook_id / description / status / planted_ch / target_resolve_ch / scope / payoff_type / priority / strength
 * - 状态筛选：全部 / planted / hinted / resolved / abandoned
 * - 新建/编辑伏笔：模态框，8 必填字段
 * - 状态流转按钮：planted→hinted→resolved，abandoned 分支
 * - 删除伏笔（确认对话框）
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
    // state.currentProject 是 Project 实例对象，存储层需要的是 id 字符串
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

  /** 生成 <select> 选项 HTML */
  function optionsHTML(values, selected) {
    return values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label('status', v)}</option>`).join('');
  }

  /** 通用 select 构造器：按枚举组生成 */
  function enumOptions(group, values, selected) {
    return values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label(group, v)}</option>`).join('');
  }

  // ---------- 主渲染入口 ----------

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
        <h2 class="dt-page-title">伏笔管理</h2>
        <div class="dt-toolbar-actions">
          <button class="dt-btn dt-btn-primary" data-act="new">+ 新建伏笔</button>
          <button class="dt-btn" data-act="refresh">刷新</button>
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
      </div>
      <div class="dt-hook-table-wrap"><p class="dt-empty-hint">加载中…</p></div>`;

    let hooks = [];
    let filter = 'all';

    const statsEl = container.querySelector('.dt-hook-stats');
    const tableWrap = container.querySelector('.dt-hook-table-wrap');

    async function reload() {
      statsEl.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      tableWrap.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        hooks = (await DT().storage.listHooks(pid)) || [];
        renderStats();
        renderTable();
      } catch (err) {
        console.error('[hooks] 加载失败:', err);
        statsEl.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
        DT().notify('伏笔列表加载失败', 'error');
      }
    }

    function renderStats() {
      const counts = { total: hooks.length, planted: 0, hinted: 0, resolved: 0, abandoned: 0 };
      hooks.forEach((h) => {
        if (counts[h.status] != null) counts[h.status]++;
      });
      statsEl.innerHTML = `
        <div class="dt-stat-cards">
          ${statCard('总伏笔', counts.total, 'dt-stat-total')}
          ${statCard('已埋', counts.planted, 'dt-stat-planted')}
          ${statCard('提示中', counts.hinted, 'dt-stat-hinted')}
          ${statCard('已回收', counts.resolved, 'dt-stat-resolved')}
          ${statCard('已废弃', counts.abandoned, 'dt-stat-abandoned')}
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

    function renderTable() {
      const filtered = filter === 'all' ? hooks : hooks.filter((h) => h.status === filter);
      if (!filtered.length) {
        tableWrap.innerHTML = `
          <div class="dt-empty-state">
            <p>${filter === 'all' ? '暂无伏笔，点击「新建伏笔」开始' : '该状态下暂无伏笔'}</p>
          </div>`;
        return;
      }
      // 排序：优先级高>中>低，再按 planted_ch 升序
      const priOrder = { high: 0, medium: 1, low: 2 };
      const sorted = [...filtered].sort((a, b) => {
        const pa = priOrder[a.priority] ?? 1;
        const pb = priOrder[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.planted_ch || 0) - (b.planted_ch || 0);
      });

      tableWrap.innerHTML = `
        <table class="dt-hook-table">
          <thead>
            <tr>
              <th>hook_id</th>
              <th>描述</th>
              <th>状态</th>
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
        </table>`;

      // 绑定操作
      tableWrap.querySelectorAll('[data-hook-id]').forEach((tr) => {
        const id = tr.getAttribute('data-hook-id');
        const hook = hooks.find((x) => x.hook_id === id);
        if (!hook) return;
        tr.querySelector('[data-act="edit"]').addEventListener('click', () => openHookModal(hook));
        tr.querySelector('[data-act="del"]').addEventListener('click', () => confirmDelete(hook));
        // 状态流转按钮
        const flowBtn = tr.querySelector('[data-act="flow"]');
        if (flowBtn) {
          flowBtn.addEventListener('click', () => flowStatus(hook));
        }
        const abandonBtn = tr.querySelector('[data-act="abandon"]');
        if (abandonBtn) {
          abandonBtn.addEventListener('click', () => changeStatus(hook, 'abandoned'));
        }
        const reviveBtn = tr.querySelector('[data-act="revive"]');
        if (reviveBtn) {
          reviveBtn.addEventListener('click', () => changeStatus(hook, 'planted'));
        }
      });
    }

    function hookRowHTML(h) {
      const statusClass = 'dt-hook-status-' + (h.status || 'planted');
      // 流转按钮：planted→hinted→resolved；abandoned 单独显示恢复
      let flowBtnHTML = '';
      if (h.status === 'planted') {
        flowBtnHTML = '<button class="dt-btn dt-btn-sm" data-act="flow" title="标记为提示中">→ 提示</button>';
      } else if (h.status === 'hinted') {
        flowBtnHTML = '<button class="dt-btn dt-btn-sm dt-btn-primary" data-act="flow" title="标记为已回收">→ 回收</button>';
      } else if (h.status === 'resolved') {
        flowBtnHTML = '<span class="dt-tag dt-tag-ok">✓ 已回收</span>';
      } else if (h.status === 'abandoned') {
        flowBtnHTML = '<button class="dt-btn dt-btn-sm" data-act="revive" title="恢复为已埋">↺ 恢复</button>';
      }

      let abandonBtnHTML = '';
      if (h.status === 'planted' || h.status === 'hinted') {
        abandonBtnHTML = '<button class="dt-btn dt-btn-sm dt-btn-danger" data-act="abandon" title="废弃">废弃</button>';
      }

      return `
        <tr data-hook-id="${esc(h.hook_id)}">
          <td class="dt-hook-id"><code>${esc(h.hook_id)}</code></td>
          <td class="dt-hook-desc" title="${esc(h.description)}">${esc(h.description || '—')}</td>
          <td><span class="dt-tag ${statusClass}">${esc(label('status', h.status))}</span></td>
          <td>${esc(h.planted_ch || '—')}</td>
          <td>${esc(h.target_resolve_ch || '—')}</td>
          <td>${esc(label('scope', h.scope))}</td>
          <td>${esc(label('payoff_type', h.payoff_type))}</td>
          <td>${esc(label('priority', h.priority))}</td>
          <td>${esc(label('strength', h.strength))}</td>
          <td class="dt-hook-actions">
            <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
            ${flowBtnHTML}
            ${abandonBtnHTML}
            <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">删除</button>
          </td>
        </tr>`;
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
      // 回收时记录回收说明（如果原本没有）
      if (newStatus === 'resolved' && !payload.resolution_note) {
        payload.resolution_note = `于第 ${hook.target_resolve_ch || '?'} 章回收`;
      }
      try {
        await DT().storage.saveHook(pid, payload);
        DT().notify(`伏笔「${hook.hook_id}」状态已更新为「${label('status', newStatus)}」`, 'success');
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
        hook_id: genHookId(),
        description: '',
        status: 'planted',
        planted_ch: 0,
        target_resolve_ch: 0,
        scope: 'short',
        payoff_type: 'reveal',
        priority: 'medium',
        strength: 'medium',
        expected_resolve_vol: 0,
        related_characters: [],
        emotional_valence: 'neutral',
        dependencies: [],
        resolution_note: '',
      };

      const overlay = createModal({
        title: isEdit ? '编辑伏笔' : '新建伏笔',
        size: 'large',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>hook_id <span class="dt-req">*</span></label>
                <input type="text" data-field="hook_id" value="${esc(data.hook_id)}" ${isEdit ? 'readonly' : ''} />
              </div>
              <div>
                <label>状态</label>
                <select data-field="status">${enumOptions('status', STATUS, data.status)}</select>
              </div>
            </div>
            <div class="dt-form-row">
              <label>描述 <span class="dt-req">*</span></label>
              <textarea data-field="description" rows="3" placeholder="伏笔的具体内容，如：主角左臂的胎记">${esc(data.description)}</textarea>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>埋设章 <span class="dt-req">*</span></label>
                <input type="number" data-field="planted_ch" value="${data.planted_ch || 0}" min="0" />
              </div>
              <div>
                <label>目标回收章 <span class="dt-req">*</span></label>
                <input type="number" data-field="target_resolve_ch" value="${data.target_resolve_ch || 0}" min="0" />
              </div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>范围 <span class="dt-req">*</span></label>
                <select data-field="scope">${enumOptions('scope', SCOPE, data.scope)}</select>
              </div>
              <div>
                <label>兑现类型 <span class="dt-req">*</span></label>
                <select data-field="payoff_type">${enumOptions('payoff_type', PAYOFF, data.payoff_type)}</select>
              </div>
            </div>
            <div class="dt-form-row dt-form-row-3col">
              <div>
                <label>优先级 <span class="dt-req">*</span></label>
                <select data-field="priority">${enumOptions('priority', PRIORITY, data.priority)}</select>
              </div>
              <div>
                <label>强度 <span class="dt-req">*</span></label>
                <select data-field="strength">${enumOptions('strength', STRENGTH, data.strength)}</select>
              </div>
              <div>
                <label>情感色彩</label>
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
              <input type="text" data-field="related_characters" value="${esc((data.related_characters || []).join(', '))}" placeholder="如：主角, 赵师兄" />
            </div>
            <div class="dt-form-row">
              <label>依赖伏笔（hook_id，逗号分隔）</label>
              <input type="text" data-field="dependencies" value="${esc((data.dependencies || []).join(', '))}" placeholder="如：H_abc123, H_def456" />
            </div>
            <div class="dt-form-row">
              <label>回收说明</label>
              <textarea data-field="resolution_note" rows="2" placeholder="回收时的具体说明，可后补">${esc(data.resolution_note || '')}</textarea>
            </div>
          </div>`,
        submitText: isEdit ? '保存' : '创建',
        onSubmit: async (formEl) => {
          const hookId = formEl.querySelector('[data-field="hook_id"]').value.trim();
          const description = formEl.querySelector('[data-field="description"]').value.trim();
          if (!hookId) {
            DT().notify('hook_id 不能为空', 'warning');
            return false;
          }
          if (!description) {
            DT().notify('描述不能为空', 'warning');
            return false;
          }
          const plantedCh = Number(formEl.querySelector('[data-field="planted_ch"]').value) || 0;
          const targetCh = Number(formEl.querySelector('[data-field="target_resolve_ch"]').value) || 0;
          if (targetCh > 0 && targetCh < plantedCh) {
            DT().notify('目标回收章不能早于埋设章', 'warning');
            return false;
          }
          const payload = {
            hook_id: hookId,
            description,
            status: formEl.querySelector('[data-field="status"]').value,
            planted_ch: plantedCh,
            target_resolve_ch: targetCh,
            scope: formEl.querySelector('[data-field="scope"]').value,
            payoff_type: formEl.querySelector('[data-field="payoff_type"]').value,
            priority: formEl.querySelector('[data-field="priority"]').value,
            strength: formEl.querySelector('[data-field="strength"]').value,
            emotional_valence: formEl.querySelector('[data-field="emotional_valence"]').value,
            expected_resolve_vol: Number(formEl.querySelector('[data-field="expected_resolve_vol"]').value) || 0,
            related_characters: formEl.querySelector('[data-field="related_characters"]').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            dependencies: formEl.querySelector('[data-field="dependencies"]').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            resolution_note: formEl.querySelector('[data-field="resolution_note"]').value.trim(),
            // 保留运行时字段（编辑时）
            reminder_chapters: data.reminder_chapters || [],
            last_reminder_ch: data.last_reminder_ch || null,
            next_reminder_due_ch: data.next_reminder_due_ch || null,
          };
          try {
            await DT().storage.saveHook(pid, payload);
            DT().notify(isEdit ? '伏笔已更新' : '伏笔已创建', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[hooks] 保存伏笔失败:', err);
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
        submitText: '删除',
        submitClass: 'dt-btn-danger',
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

    // ---------- 筛选事件 ----------
    container.querySelectorAll('.dt-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        filter = btn.getAttribute('data-filter');
        container.querySelectorAll('.dt-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderTable();
      });
    });

    container.querySelector('[data-act="new"]').addEventListener('click', () => openHookModal(null));
    container.querySelector('[data-act="refresh"]').addEventListener('click', reload);

    await reload();
  }

  // ---------- 导出 ----------

  NS.renderHooks = renderHooks;
})(window);
