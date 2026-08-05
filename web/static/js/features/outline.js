/**
 * DreamTale · 大纲体系功能模块（NovelForge 升级版）
 *
 * 七级 Tab：总纲 / 分卷 / 章纲 / ✨写作引导 / 🌳故事脉络树 / 📈节奏曲线 / 🪝伏笔时间线
 * - 总纲：MarkdownEditor 编辑，存储于 localStorage（按项目隔离）
 * - 分卷：列表 + 新建/编辑/删除 + HTML5 原生拖拽排序
 * - 章纲：按卷分组列表，点击打开「十五段模板」填空编辑器（起承转合/爽点10选1/钩子7选1/自检清单/伏笔快速选择）
 * - ✨写作引导：左侧分类导航 + 右侧 Markdown 渲染大纲/章纲写作指南，支持一键套用模板
 * - 🌳故事脉络树：书→卷→弧→章 四级纯 CSS/CSS 树状图，节点颜色标记埋/提/收伏笔，悬停卡片+点击跳转
 * - 📈节奏曲线：爽点/压抑双轴折线（Chart.js + 纯CSS降级）+ 连续低爽/高压告警 + 起承转合色块 + 主角境界副图
 * - 🪝伏笔时间线：每条伏笔一条泳道，生命周期可视化，超期/将到期高亮
 *
 * 通过 window.DreamTaleFeatures.renderOutline(container) 挂载。
 *
 * 依赖：
 *   - window.DreamTale.state / storage / notify
 *   - window.DreamTaleEditor.create(container, options)（总纲 Tab）
 *   - window.Chart（节奏曲线 Tab，CDN 加载失败降级纯 CSS 条形图）
 *   - window.marked（写作引导 Markdown 渲染）
 *
 * 章纲十五段模板对应 core/models.js 的 Outline 类字段。
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------

  function DT() {
    if (!global.DreamTale) throw new Error('[outline] window.DreamTale 未初始化');
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

  /** 卷号补零 2 位 */
  function padVol(n) {
    return String(n).padStart(2, '0');
  }
  /** 章号补零 3 位 */
  function padCh(n) {
    return String(n).padStart(3, '0');
  }

  /** localStorage 中总纲的 key */
  function masterOutlineKey(pid) {
    return 'dt:master_outline:' + pid;
  }

  /** 读取总纲 Markdown */
  function readMasterOutline(pid) {
    try {
      return global.localStorage.getItem(masterOutlineKey(pid)) || '';
    } catch (e) {
      return '';
    }
  }

  /** 写入总纲 Markdown */
  function writeMasterOutline(pid, md) {
    try {
      global.localStorage.setItem(masterOutlineKey(pid), md || '');
      return true;
    } catch (e) {
      console.error('[outline] 总纲保存失败:', e);
      return false;
    }
  }

  /** 章纲 JSON 标记前缀，用于在 chapter.summary 中区分章纲与普通摘要 */
  const OUTLINE_MARK = '/*DT-OUTLINE*/';

  /** 判断 chapter.summary 是否为章纲 JSON */
  function isOutlineSummary(summary) {
    return typeof summary === 'string' && summary.startsWith(OUTLINE_MARK);
  }

  /** 从 chapter.summary 解析章纲对象 */
  function parseOutlineFromSummary(summary) {
    if (!isOutlineSummary(summary)) return null;
    try {
      const json = summary.slice(OUTLINE_MARK.length);
      return JSON.parse(json);
    } catch (e) {
      console.warn('[outline] 章纲 JSON 解析失败:', e);
      return null;
    }
  }

  /** 把章纲对象序列化为 chapter.summary 字符串 */
  function serializeOutlineToSummary(outline) {
    return OUTLINE_MARK + JSON.stringify(outline);
  }

  // =============================================================
  //  章纲十五段模板 · 空结构（含新增字段）
  // =============================================================
  function emptyOutline(volNo, chNo) {
    return {
      vol_no: volNo,
      ch_no: chNo,
      title: '',
      chapter_type: '',
      word_target: 0,
      pov: '',
      special_mode: '',
      qicige_loc: '',           // 起承转合定位：起段/承段/转段/合段
      // 起承转合四段式：每段 { summary, detail }
      qicige: {
        qi:    { pct: '≈25%', summary: '', detail: '' },
        cheng: { pct: '≈35%', summary: '', detail: '' },
        zhuan: { pct: '≈30%', summary: '', detail: '' },
        he:    { pct: '≈10%', summary: '', detail: '' }
      },
      core_conflict: '',
      // 爽点设计
      climax: { type: '', strength: 5, formula: { flag: '', crowd: '', moment: '', ending: '' } },
      // 章末钩子设计
      chapter_hook: { type: '', strength: 3, content: '', cuttip: '' },
      scenes: [],            // [{location, time, characters, event, purpose}]
      characters: [],        // [{name, role, effect_in_chapter, state_change, state_file}]
      hook_planted: [],      // [{hook_id, description, scope, strength, target_ch, plant_method}]
      hook_hinted: [],       // [{hook_id, method, strength, next_hint_ch}]
      hook_resolved: [],     // [{hook_id, from_ch, method, ok, payoff_strength}]
      rhythm: { satisfaction: 0, suppression: 0, trend: '', info_density_max: 50, golden_quote: '' },
      context_recall: [],    // [场景文件名]
      must_keep: [],
      must_avoid: [],
      // 自检清单（10 条，true=已过）
      selfcheck: {
        qicige_full: false, word_ok: false, has_hook: false, rhythm_ok: false,
        conflict_clear: false, scene_count_ok: false, density_ok: false,
        hooks_filled: false, overdue_handled: false, state_safe: false
      }
    };
  }

  /** 通用模态框 */
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
      submitBtn.disabled = true;
      submitBtn.textContent = '处理中…';
      try {
        const ok = await opts.onSubmit(body, close);
        if (ok !== false) close();
      } catch (err) {
        console.error('[outline] 模态框提交异常:', err);
        DT().notify('操作失败：' + (err.message || err), 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = opts.submitText || '确定';
      }
    });
    return overlay;
  }

  // =============================================================
  //  写作引导数据（映射到 Markdown 文档的 anchor）
  // =============================================================
  const GUIDE_CONTENT = {
    outline: [
      { key: 'why',     title: '为什么写大纲',      icon: '🤔', file: '大纲写作指南.md', anchor: '一为什么先写大纲' },
      { key: 'gold3',   title: '模板1·黄金三章',    icon: '🥇', file: '大纲写作指南.md', anchor: '模板-1黄金三章开篇模板-' },
      { key: 'village', title: '模板2·新手村卷',    icon: '🏘️', file: '大纲写作指南.md', anchor: '模板-2新手村卷一卷模板-' },
      { key: 'upgrade', title: '模板3·升级流卷',    icon: '📈', file: '大纲写作指南.md', anchor: '模板-3升级流常规卷模板-' },
      { key: 'scheme',  title: '模板4·权谋流卷',    icon: '♟️', file: '大纲写作指南.md', anchor: '模板-4权谋流布局卷模板-' },
      { key: 'love',    title: '模板5·感情线嵌入',  icon: '💕', file: '大纲写作指南.md', anchor: '模板-5感情线嵌入卷模板-' },
      { key: 'check',   title: '全书大纲自检',      icon: '✅', file: '大纲写作指南.md', anchor: '三全书大纲自检-checklist12-条全过再动笔' },
      { key: 'plat',    title: '番茄vs起点差异',    icon: '🍅', file: '大纲写作指南.md', anchor: '四番茄-vs-起点平台差异对大纲的影响' },
    ],
    chapter: [
      { key: 'qicige',  title: '起承转合四段式',    icon: '🧩', file: '章纲写作指南.md', anchor: '一起承转合四段式每章的通用骨架' },
      { key: 'hooks7',  title: '章末钩子7种写法',  icon: '🪝', file: '章纲写作指南.md', anchor: '二章末钩子的-7-种写法附案例' },
      { key: 'climax10',title: '爽点设计10公式',    icon: '🔥', file: '章纲写作指南.md', anchor: '三爽点设计的-10-种公式附写作提示' },
      { key: 'density', title: '信息密度控制',      icon: '💧', file: '章纲写作指南.md', anchor: '四信息密度控制让读者追更不累' },
      { key: 'check10', title: '章纲10条自检',      icon: '✅', file: '章纲写作指南.md', anchor: '五章纲自检-checklist10-条全过再动笔写正文' },
      { key: '急救包',  title: '卡文急救包',        icon: '🩹', file: '章纲写作指南.md', anchor: '六卡文了怎么办急救包' },
    ]
  };

  // ---------- 主渲染入口：7 个 Tab ----------

  async function renderOutline(container) {
    if (!container) throw new Error('[outline] container 不能为空');
    container.innerHTML = '';

    // 顶部 Tab：7 个
    const tabs = document.createElement('div');
    tabs.className = 'dt-tabs';
    tabs.innerHTML = `
      <div class="dt-tab-bar">
        <button class="dt-tab active" data-tab="master">总纲</button>
        <button class="dt-tab" data-tab="volumes">分卷</button>
        <button class="dt-tab" data-tab="chapters">章纲</button>
        <button class="dt-tab" data-tab="guide">✨ 写作引导</button>
        <button class="dt-tab" data-tab="mindmap">🌳 故事脉络</button>
        <button class="dt-tab" data-tab="rhythm">📈 节奏曲线</button>
        <button class="dt-tab" data-tab="hookline">🪝 伏笔时间线</button>
      </div>`;
    container.appendChild(tabs);

    const panel = document.createElement('div');
    panel.className = 'dt-tab-panel';
    container.appendChild(panel);

    async function switchTab(name) {
      tabs.querySelectorAll('.dt-tab').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tab') === name);
      });
      panel.innerHTML = '';
      switch (name) {
        case 'master':   await renderMaster(panel); break;
        case 'volumes':  await renderVolumes(panel); break;
        case 'chapters': await renderChapterOutlines(panel); break;
        case 'guide':    await renderGuide(panel); break;
        case 'mindmap':  await renderMindmap(panel); break;
        case 'rhythm':   await renderRhythm(panel); break;
        case 'hookline': await renderHookTimeline(panel); break;
      }
    }

    tabs.querySelectorAll('.dt-tab').forEach((b) => {
      b.addEventListener('click', () => switchTab(b.getAttribute('data-tab')));
    });

    await switchTab('master');
  }

  // ==================== Tab 1：总纲 ====================

  async function renderMaster(panel) {
    const pid = currentProjectId();
    if (!pid) {
      panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">总纲（master_outline）</h3>
        <div class="dt-toolbar-actions">
          <button class="dt-btn dt-btn-primary" data-act="save">保存</button>
        </div>
      </div>
      <div class="dt-master-editor-wrap"></div>
      <p class="dt-hint">总纲存储于浏览器 localStorage（按项目隔离），用于全局设定与故事主线。写作引导请切换到「✨ 写作引导」Tab。</p>`;

    let editor = null;
    const host = panel.querySelector('.dt-master-editor-wrap');
    try {
      editor = global.DreamTaleEditor.create(host, {
        initialValue: readMasterOutline(pid),
        theme: DT().state.theme || 'light',
        onSave: () => saveMaster(),
      });
    } catch (err) {
      console.error('[outline] 总纲编辑器创建失败:', err);
      host.innerHTML = `<textarea class="dt-master-fallback" style="width:100%;min-height:480px;">${esc(readMasterOutline(pid))}</textarea>`;
    }

    function saveMaster() {
      const md = editor ? editor.getValue() : host.querySelector('.dt-master-fallback').value;
      const ok = writeMasterOutline(pid, md);
      DT().notify(ok ? '总纲已保存' : '总纲保存失败', ok ? 'success' : 'error');
      return ok;
    }

    panel.querySelector('[data-act="save"]').addEventListener('click', saveMaster);
  }

  // ==================== Tab 2：分卷 ====================

  async function renderVolumes(panel) {
    const pid = currentProjectId();
    if (!pid) {
      panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">分卷管理</h3>
        <div class="dt-toolbar-actions">
          <button class="dt-btn dt-btn-primary" data-act="new">+ 新建卷</button>
          <button class="dt-btn" data-act="refresh">刷新</button>
        </div>
      </div>
      <p class="dt-hint">提示：拖动卷卡片可调整顺序。模板使用请切换到「✨ 写作引导」Tab。</p>
      <ul class="dt-volume-list"><li class="dt-empty-hint">加载中…</li></ul>`;

    let volumes = [];
    let dragSrcIdx = -1;

    async function reload() {
      const list = panel.querySelector('.dt-volume-list');
      list.innerHTML = '<li class="dt-empty-hint">加载中…</li>';
      try {
        volumes = (await DT().storage.listVolumes(pid)) || [];
        volumes.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        renderList();
      } catch (err) {
        console.error('[outline] 分卷加载失败:', err);
        list.innerHTML = `<li class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</li>`;
      }
    }

    function renderList() {
      const list = panel.querySelector('.dt-volume-list');
      if (!volumes.length) {
        list.innerHTML = '<li class="dt-empty-hint">暂无分卷，点击「新建卷」开始</li>';
        return;
      }
      list.innerHTML = volumes.map((v, i) => `
        <li class="dt-volume-item" draggable="true" data-idx="${i}">
          <span class="dt-drag-handle" title="拖动排序">⠿</span>
          <span class="dt-vol-no">第 ${esc(v.vol_no)} 卷</span>
          <div class="dt-vol-main">
            <div class="dt-vol-name">${esc(v.vol_name || '未命名')}</div>
            ${v.vol_goal ? `<div class="dt-vol-goal">${esc(v.vol_goal)}</div>` : ''}
          </div>
          <div class="dt-vol-actions">
            <button class="dt-btn dt-btn-sm" data-act="edit">编辑</button>
            <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">删除</button>
          </div>
        </li>`).join('');

      list.querySelectorAll('.dt-volume-item').forEach((li) => {
        const idx = Number(li.getAttribute('data-idx'));
        li.querySelector('[data-act="edit"]').addEventListener('click', () => openVolumeModal(volumes[idx]));
        li.querySelector('[data-act="del"]').addEventListener('click', () => confirmDeleteVolume(volumes[idx]));
        bindDrag(li, idx);
      });
    }

    // ---------- HTML5 原生拖拽排序 ----------
    function bindDrag(li, idx) {
      li.addEventListener('dragstart', (e) => {
        dragSrcIdx = idx;
        li.classList.add('dt-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dt-dragging');
        listClearDragOver();
      });
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        li.classList.add('dt-dragover');
      });
      li.addEventListener('dragleave', () => li.classList.remove('dt-dragover'));
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        li.classList.remove('dt-dragover');
        const targetIdx = idx;
        if (dragSrcIdx < 0 || dragSrcIdx === targetIdx) return;
        await reorderVolumes(dragSrcIdx, targetIdx);
        dragSrcIdx = -1;
      });
    }
    function listClearDragOver() {
      panel.querySelectorAll('.dt-dragover').forEach((el) => el.classList.remove('dt-dragover'));
    }
    async function reorderVolumes(fromIdx, toIdx) {
      const moved = volumes.splice(fromIdx, 1)[0];
      volumes.splice(toIdx, 0, moved);
      try {
        for (let i = 0; i < volumes.length; i++) {
          const v = { ...volumes[i], sort_order: i };
          volumes[i] = v;
          await DT().storage.saveVolume(pid, v);
        }
        DT().notify('卷顺序已更新', 'success');
        renderList();
      } catch (err) {
        console.error('[outline] 卷排序失败:', err);
        DT().notify('排序失败：' + (err.message || err), 'error');
        await reload();
      }
    }

    // ---------- 新建/编辑卷 ----------
    function openVolumeModal(vol) {
      const isEdit = !!vol;
      const data = isEdit ? { ...vol } : { vol_no: nextVolNo(), vol_name: '', vol_goal: '', sort_order: volumes.length };
      const overlay = createModal({
        title: isEdit ? '编辑卷' : '新建卷',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>卷号 <span class="dt-req">*</span></label>
                <input type="number" data-field="vol_no" value="${Number(data.vol_no) || 1}" min="1" ${isEdit ? 'disabled' : ''} />
              </div>
              <div>
                <label>排序权重</label>
                <input type="number" data-field="sort_order" value="${data.sort_order || 0}" min="0" />
              </div>
            </div>
            <div class="dt-form-row">
              <label>卷名 <span class="dt-req">*</span></label>
              <input type="text" data-field="vol_name" value="${esc(data.vol_name)}" placeholder="如：初入江湖" />
            </div>
            <div class="dt-form-row">
              <label>本卷目标</label>
              <textarea data-field="vol_goal" rows="3" placeholder="本卷的核心剧情目标与爽点设计">${esc(data.vol_goal)}</textarea>
            </div>
          </div>`,
        submitText: isEdit ? '保存' : '创建',
        onSubmit: async (formEl) => {
          const volNo = isEdit ? data.vol_no : padVol(Number(formEl.querySelector('[data-field="vol_no"]').value) || 1);
          const volName = formEl.querySelector('[data-field="vol_name"]').value.trim();
          if (!volName) {
            DT().notify('卷名不能为空', 'warning');
            return false;
          }
          const payload = {
            vol_no: volNo,
            vol_name: volName,
            vol_goal: formEl.querySelector('[data-field="vol_goal"]').value.trim(),
            sort_order: Number(formEl.querySelector('[data-field="sort_order"]').value) || 0,
          };
          try {
            await DT().storage.saveVolume(pid, payload);
            DT().notify(isEdit ? '卷已更新' : '卷已创建', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[outline] 保存卷失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      panel.appendChild(overlay);
    }

    function nextVolNo() {
      let max = 0;
      volumes.forEach((v) => {
        const n = Number(v.vol_no) || 0;
        if (n > max) max = n;
      });
      return padVol(max + 1);
    }

    function confirmDeleteVolume(vol) {
      const overlay = createModal({
        title: '删除卷',
        bodyHTML: `<p>确认删除「第 ${esc(vol.vol_no)} 卷 · ${esc(vol.vol_name)}」？该卷下的章节不会自动删除，但可能失去卷归属。</p>`,
        submitText: '删除',
        submitClass: 'dt-btn-danger',
        onSubmit: async () => {
          DT().notify('当前存储后端未提供删除卷接口，建议编辑卷名加「[废弃]」前缀实现软删除', 'warning');
          return false;
        },
      });
      panel.appendChild(overlay);
    }

    panel.querySelector('[data-act="new"]').addEventListener('click', () => openVolumeModal(null));
    panel.querySelector('[data-act="refresh"]').addEventListener('click', reload);
    await reload();
  }

  // ==================== Tab 3：章纲（十五段升级模板） ====================

  async function renderChapterOutlines(panel) {
    const pid = currentProjectId();
    if (!pid) { panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>'; return; }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">章纲（十五段模板 · 含起承转合/爽点钩子引导）</h3>
        <div class="dt-toolbar-actions">
          <button class="dt-btn dt-btn-primary" data-act="new">+ 新建章纲</button>
          <button class="dt-btn" data-act="refresh">刷新</button>
        </div>
      </div>
      <div class="dt-outline-list"><p class="dt-empty-hint">加载中…</p></div>`;

    let chapters = [];
    let volumes = [];
    let hooks = [];

    async function reload() {
      const list = panel.querySelector('.dt-outline-list');
      list.innerHTML = '<p class="dt-empty-hint">加载中…</p>';
      try {
        [chapters, volumes, hooks] = await Promise.all([
          DT().storage.listChapters(pid),
          DT().storage.listVolumes(pid),
          DT().storage.listHooks(pid),
        ]);
        chapters = chapters || [];
        volumes = (volumes || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        hooks = hooks || [];
        renderList();
      } catch (err) {
        console.error('[outline] 章纲加载失败:', err);
        list.innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
      }
    }

    function renderList() {
      const list = panel.querySelector('.dt-outline-list');
      if (!chapters.length) {
        list.innerHTML = `<div class="dt-empty-state"><p>暂无章节，点击「新建章纲」开始。<br/>写法参考：「✨ 写作引导」→「章纲写作指南」。</p></div>`;
        return;
      }
      const byVol = new Map();
      chapters.forEach((c) => {
        const arr = byVol.get(c.vol_no) || [];
        arr.push(c);
        byVol.set(c.vol_no, arr);
      });
      byVol.forEach((arr) => arr.sort((a, b) => String(a.ch_no).localeCompare(String(b.ch_no))));
      const volNames = new Map(volumes.map((v) => [v.vol_no, v.vol_name]));

      const html = [];
      volumes.forEach((v) => {
        const arr = byVol.get(v.vol_no) || [];
        if (!arr.length) return;
        html.push(`
          <div class="dt-vol-group">
            <h4 class="dt-vol-group-title">第 ${esc(v.vol_no)} 卷 · ${esc(v.vol_name || '未命名')}</h4>
            <ul class="dt-ch-outline-items">
              ${arr.map((c) => chItemHTML(c)).join('')}
            </ul>
          </div>`);
      });
      const knownVols = new Set(volumes.map((v) => v.vol_no));
      const orphans = chapters.filter((c) => !knownVols.has(c.vol_no));
      if (orphans.length) {
        html.push(`
          <div class="dt-vol-group">
            <h4 class="dt-vol-group-title">未分卷章节</h4>
            <ul class="dt-ch-outline-items">
              ${orphans.map((c) => chItemHTML(c)).join('')}
            </ul>
          </div>`);
      }
      list.innerHTML = html.join('') || '<p class="dt-empty-hint">暂无章纲</p>';

      list.querySelectorAll('[data-ch-key]').forEach((li) => {
        const key = li.getAttribute('data-ch-key');
        const ch = chapters.find((c) => chapterKey(c) === key);
        li.querySelector('[data-act="edit"]').addEventListener('click', () => openOutlineEditor(ch));
        li.querySelector('[data-act="del"]').addEventListener('click', () => confirmDeleteOutline(ch));
      });
    }

    function chItemHTML(c) {
      const outline = parseOutlineFromSummary(c.summary);
      const hasOutline = !!outline;
      const title = hasOutline ? (outline.title || c.title || '未命名') : (c.title || '未命名');
      const conflict = hasOutline && outline.core_conflict ? outline.core_conflict : '（未填核心冲突）';
      const qloc = hasOutline && outline.qicige_loc ? `· <span class="dt-badge dt-badge-type">${esc(outline.qicige_loc)}</span>` : '';
      const hookStatus = (hasOutline && outline.hook_planted && outline.hook_planted.length) ? '🟢' : '';
      const hookResolved = (hasOutline && outline.hook_resolved && outline.hook_resolved.length) ? '🔴' : '';
      const sat = hasOutline && outline.rhythm && outline.rhythm.satisfaction ? '★'.repeat(outline.rhythm.satisfaction) : '';
      return `
        <li class="dt-ch-outline-item" data-ch-key="${esc(chapterKey(c))}">
          <span class="dt-ch-no">第${esc(c.ch_no)}章</span>
          <div class="dt-ch-outline-main">
            <div class="dt-ch-outline-title">${esc(title)} ${hasOutline ? '<span class="dt-badge dt-badge-ok">已设</span>' : '<span class="dt-badge dt-badge-warn">空</span>'} ${qloc} ${hookStatus}${hookResolved}</div>
            <div class="dt-ch-outline-conflict">${esc(conflict)} ${sat ? `<span style="color:#f2c24e">${esc(sat)}</span>` : ''}</div>
          </div>
          <div class="dt-ch-outline-actions">
            <button class="dt-btn dt-btn-sm" data-act="edit">${hasOutline ? '编辑' : '填写'}</button>
            <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">清空</button>
          </div>
        </li>`;
    }

    function chapterKey(c) { return c.vol_no + ':' + c.ch_no; }

    // ---------- 新建/编辑章纲（十五段 + 引导选择器） ----------
    function openOutlineEditor(ch) {
      let outline = parseOutlineFromSummary(ch.summary);
      if (!outline) {
        outline = emptyOutline(ch.vol_no, ch.ch_no);
        outline.title = ch.title || '';
      }
      // 兼容老字段结构
      if (!outline.qicige) outline.qicige = emptyOutline().qicige;
      if (!outline.rhythm) outline.rhythm = emptyOutline().rhythm;
      if (!outline.selfcheck) outline.selfcheck = emptyOutline().selfcheck;
      if (typeof outline.chapter_hook === 'string') {
        outline.chapter_hook = { type: '', strength: 3, content: outline.chapter_hook, cuttip: '' };
      }
      if (outline.climax && !outline.climax.formula) {
        outline.climax.formula = { flag: '', crowd: '', moment: '', ending: '' };
      }
      if (!outline.climax) outline.climax = emptyOutline().climax;
      if (!outline.hook_planted) outline.hook_planted = [];
      if (!outline.hook_hinted)  outline.hook_hinted  = [];
      if (!outline.hook_resolved) outline.hook_resolved = [];

      const overlay = createModal({
        title: `章纲编辑 · 第${esc(ch.vol_no)}卷 第${esc(ch.ch_no)}章`,
        size: 'xlarge',
        bodyHTML: outlineFormHTML(outline),
        submitText: '保存章纲',
        onSubmit: async (formEl) => {
          const updated = collectOutlineFromForm(formEl, outline);
          const payload = {
            ...ch,
            title: updated.title || ch.title,
            summary: serializeOutlineToSummary(updated),
            updated_at: new Date().toISOString(),
          };
          try {
            await DT().storage.saveChapter(pid, payload);
            DT().notify('章纲已保存', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[outline] 章纲保存失败:', err);
            DT().notify('保存失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      panel.appendChild(overlay);
      bindOutlineFormBehaviors(overlay, outline);
    }

    // 章纲表单 HTML（十五段）
    function outlineFormHTML(o) {
      const chapterTypes = ['', '开篇', '推进', '高潮', '转折', '收尾', '过渡', '日常'];
      const qicigeOpts = ['', '起段', '承段', '转段', '合段'];
      const climaxTypes = [
        { v: '',      l: '— 无 / 不填 —' },
        { v: '打脸',   l: '打脸 · 爽', s: 5 },
        { v: '逆袭',   l: '逆袭 · 爽', s: 5 },
        { v: '扮猪吃虎', l: '扮猪吃虎 · 爽', s: 4 },
        { v: '掉马甲', l: '掉马甲 · 反转爽', s: 5 },
        { v: '英雄救美', l: '英雄救美/美救英雄', s: 4 },
        { v: '反杀',   l: '反杀 · 对决爽', s: 5 },
        { v: '揭秘',   l: '揭秘 · 伏笔回收爽', s: 4 },
        { v: '升级获宝', l: '升级获宝 · 成长爽', s: 4 },
        { v: '旧敌上门', l: '旧敌上门 · 回归爽', s: 4 },
        { v: '贵人相助', l: '贵人相助 · 过渡爽', s: 3 },
      ];
      const hookTypes = [
        { v: '',         l: '— 请选择类型 —' },
        { v: '危机型',   l: '危机型', s: 5 },
        { v: '反转型',   l: '反转型', s: 5 },
        { v: '悬念型',   l: '悬念型', s: 4 },
        { v: '伏笔提示型', l: '伏笔提示型', s: 4 },
        { v: '新角色登场型', l: '新角色登场型', s: 3 },
        { v: '环境突变型', l: '环境突变型', s: 3 },
        { v: '内心独白型', l: '内心独白型（情感文）', s: 2 },
      ];
      const emotionTrends = ['', '上扬', '下沉', '转折', '平推', '蓄势'];

      return `
        <div class="dt-outline-form">
          ${section(1, '章节信息', `
            <div class="dt-form-row dt-form-row-3col">
              <div><label>卷号</label><input type="text" data-f="vol_no" value="${esc(o.vol_no)}" readonly /></div>
              <div><label>章号</label><input type="text" data-f="ch_no" value="${esc(o.ch_no)}" readonly /></div>
              <div><label>章节类型</label>
                <select data-f="chapter_type">
                  ${chapterTypes.map(t => `<option value="${t}" ${o.chapter_type === t ? 'selected' : ''}>${t || '—'}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="dt-form-row dt-form-row-3col">
              <div><label>章节标题 <span class="dt-req">*</span></label><input type="text" data-f="title" value="${esc(o.title)}" placeholder="本章标题" /></div>
              <div><label>目标字数</label><input type="number" data-f="word_target" value="${o.word_target || 0}" min="0" step="100" placeholder="常规2500-3000" /></div>
              <div><label>视点（POV）</label><input type="text" data-f="pov" value="${esc(o.pov)}" placeholder="如：主角（三限）" /></div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>起承转合定位</label>
                <select data-f="qicige_loc">
                  ${qicigeOpts.map(t => `<option value="${t}" ${o.qicige_loc === t ? 'selected' : ''}>${t || '—'}</option>`).join('')}
                </select>
              </div>
              <div><label>特殊模式</label>
                <select data-f="special_mode">
                  <option value="" ${!o.special_mode ? 'selected' : ''}>常规章</option>
                  <option value="golden_three" ${o.special_mode === 'golden_three' ? 'selected' : ''}>黄金三章（字数 2500-3000）</option>
                </select>
              </div>
            </div>
          `)}

          ${section(2, '起承转合四段式拆解', `
            <p class="dt-hint">每段先填 ≤30 字的一句话概要，正文按骨架填肉，不会水也不会跑偏。占比可微调（高潮章转段可放大到 40%）。</p>
            <div class="dt-outline-qicige">
              ${qicigeCardHTML('qi',    '起 · 铺垫', '≈25%', o.qicige && o.qicige.qi)}
              ${qicigeCardHTML('cheng', '承 · 推进', '≈35%', o.qicige && o.qicige.cheng)}
              ${qicigeCardHTML('zhuan', '转 · 高潮', '≈30%', o.qicige && o.qicige.zhuan)}
              ${qicigeCardHTML('he',    '合 · 钩子', '≈10%', o.qicige && o.qicige.he)}
            </div>
          `)}

          ${section(3, '核心冲突', `
            <div class="dt-form-row"><label>一句话核心矛盾（≤40字）</label>
              <input type="text" data-f="core_conflict" value="${esc(o.core_conflict)}" placeholder="例：主角被师弟栽赃偷丹药，需长老来前找到真凶" maxlength="60" />
            </div>
          `)}

          ${section(4, '爽点设计（10 选 1）', `
            <p class="dt-hint">写法参考：「✨ 写作引导」→「爽点设计 10 公式」。选好类型后会自动给套用提示。</p>
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>爽点类型</label>
                <div class="dt-picker-grid" data-picker="climax_type">
                  ${climaxTypes.map(c => `
                    <div class="dt-picker-card ${o.climax.type === c.v ? 'selected' : ''}" data-val="${esc(c.v)}" data-star="${c.s || 0}">
                      <div>${esc(c.l)}</div>
                      ${c.s ? `<div class="stars">${'★'.repeat(c.s)}</div>` : ''}
                    </div>`).join('')}
                </div>
              </div>
              <div>
                <label>爽点强度（1-10）</label>
                <input type="range" data-f="climax_strength" min="1" max="10" value="${(o.climax || {}).strength || 5}" />
                <span data-f="climax_strength_val">${(o.climax || {}).strength || 5}</span>
                <div style="margin-top:14px;">
                  <label>爽点公式套用提示（可选填，辅助写正文）</label>
                  <div class="dt-form">
                    <div class="dt-form-row"><label>① 反派/对手怎么立 Flag（读者积愤）</label>
                      <input type="text" data-f="climax_formula_flag" value="${esc((o.climax.formula || {}).flag || '')}" />
                    </div>
                    <div class="dt-form-row"><label>② 围观群众/路人反应（增加代入）</label>
                      <input type="text" data-f="climax_formula_crowd" value="${esc((o.climax.formula || {}).crowd || '')}" />
                    </div>
                    <div class="dt-form-row"><label>③ 主角出手瞬间的关键画面</label>
                      <input type="text" data-f="climax_formula_moment" value="${esc((o.climax.formula || {}).moment || '')}" />
                    </div>
                    <div class="dt-form-row"><label>④ 收尾：轻描淡写 or 霸气宣言</label>
                      <input type="text" data-f="climax_formula_ending" value="${esc((o.climax.formula || {}).ending || '')}" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `)}

          ${section(5, '章末钩子（7 选 1 · 必填）', `
            <p class="dt-hint">写法参考：「✨ 写作引导」→「章末钩子 7 种写法」。无钩子的结尾 = 读者弃书。</p>
            <div class="dt-form-row">
              <label>钩子类型</label>
              <div class="dt-picker-grid" data-picker="hook_type">
                ${hookTypes.map(h => `
                  <div class="dt-picker-card ${(o.chapter_hook || {}).type === h.v ? 'selected' : ''}" data-val="${esc(h.v)}" data-star="${h.s || 0}">
                    <div>${esc(h.l)}</div>
                    ${h.s ? `<div class="stars">强度 ${'★'.repeat(h.s)}</div>` : ''}
                  </div>`).join('')}
              </div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>钩子强度（1-5，卷末≥4，黄金三章≥4）</label>
                <input type="range" data-f="hook_strength" min="1" max="5" value="${(o.chapter_hook || {}).strength || 3}" />
                <span data-f="hook_strength_val">${(o.chapter_hook || {}).strength || 3}</span>
              </div>
              <div>
                <label>断在最痒的地方（提示：例「火球刚进门，不写炸不炸直接本章完」）</label>
                <input type="text" data-f="hook_cuttip" value="${esc((o.chapter_hook || {}).cuttip || '')}" placeholder="断章位置提示" />
              </div>
            </div>
            <div class="dt-form-row">
              <label>钩子内容（一句话，写在章末最后 100 字内） <span class="dt-req">*</span></label>
              <input type="text" data-f="chapter_hook_content" value="${esc((o.chapter_hook || {}).content || '')}" placeholder="例：主角刚松口气，殿外三道破空声炸开——三颗火球裹着杀气砸进来！" />
            </div>
          `)}

          ${section(6, '场景列表（一章通常 2-4 个）', `
            <div class="dt-repeatable" data-repeat="scenes">
              ${(o.scenes || []).map((s, i) => sceneItemHTML(s, i)).join('') || '<p class="dt-empty-hint">暂无场景，点击下方添加</p>'}
            </div>
            <button class="dt-btn dt-btn-sm" data-act="add-scene">+ 添加场景</button>
          `)}

          ${section(7, '出场角色', `
            <div class="dt-repeatable" data-repeat="characters">
              ${(o.characters || []).map((c, i) => charItemHTML(c, i)).join('') || '<p class="dt-empty-hint">暂无角色，点击下方添加</p>'}
            </div>
            <button class="dt-btn dt-btn-sm" data-act="add-char">+ 添加角色</button>
          `)}

          ${section(8, '伏笔操作（埋/提/收，三类必填·无则留空）', `
            <p class="dt-hint">从下拉选择已有的伏笔 ID，避免手动敲错。也可直接填新 ID 创建。已登记的伏笔：${hooks.length ? hooks.map(h => `<code style="margin:0 2px;">${esc(h.hook_id)}</code>`).join('') : '（暂无，可直接创建新的）'}</p>
            <div class="dt-form-row dt-form-row-3col">
              <div>
                <label>🟢 埋设伏笔</label>
                <div class="dt-hook-mini-list" data-group="planted">
                  ${(o.hook_planted || []).map((h, i) => hookMiniHTML(h, i, 'planted')).join('') || '<p class="dt-empty-hint">本章不埋</p>'}
                </div>
                <button class="dt-btn dt-btn-sm" data-act="add-hook-planted">+ 新增埋设</button>
              </div>
              <div>
                <label>🟡 提示伏笔（提醒读者这条线还在）</label>
                <div class="dt-hook-mini-list" data-group="hinted">
                  ${(o.hook_hinted || []).map((h, i) => hookMiniHTML(h, i, 'hinted')).join('') || '<p class="dt-empty-hint">本章不提</p>'}
                </div>
                <button class="dt-btn dt-btn-sm" data-act="add-hook-hinted">+ 新增提示</button>
              </div>
              <div>
                <label>🔴 回收伏笔（对照 audit_hooks 超期清单）</label>
                <div class="dt-hook-mini-list" data-group="resolved">
                  ${(o.hook_resolved || []).map((h, i) => hookMiniHTML(h, i, 'resolved')).join('') || '<p class="dt-empty-hint">本章不收</p>'}
                </div>
                <button class="dt-btn dt-btn-sm" data-act="add-hook-resolved">+ 新增回收</button>
              </div>
            </div>
          `)}

          ${section(9, '节奏预算', `
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>爽点等级（1-5，5=章末高潮）</label>
                <input type="range" data-f="rhythm_sat" min="1" max="5" value="${(o.rhythm || {}).satisfaction || 3}" />
                <span data-f="rhythm_sat_val">${(o.rhythm || {}).satisfaction || 3}</span>
              </div>
              <div>
                <label>压抑等级（1-5，5=极致低谷）</label>
                <input type="range" data-f="rhythm_sup" min="1" max="5" value="${(o.rhythm || {}).suppression || 2}" />
                <span data-f="rhythm_sup_val">${(o.rhythm || {}).suppression || 2}</span>
              </div>
            </div>
            <div class="dt-form-row dt-form-row-3col">
              <div><label>情绪走向</label>
                <select data-f="rhythm_trend">
                  ${emotionTrends.map(t => `<option value="${t}" ${(o.rhythm || {}).trend === t ? 'selected' : ''}>${t || '—'}</option>`).join('')}
                </select>
              </div>
              <div><label>信息密度上限 %</label>
                <select data-f="rhythm_density">
                  <option value="30" ${(o.rhythm || {}).info_density_max === 30 ? 'selected' : ''}>30%（黄金三章/卷首）</option>
                  <option value="40" ${(o.rhythm || {}).info_density_max === 40 ? 'selected' : ''}>40%</option>
                  <option value="50" ${(!o.rhythm || !o.rhythm.info_density_max || o.rhythm.info_density_max === 50) ? 'selected' : ''}>50%（常规章上限）</option>
                  <option value="60" ${(o.rhythm || {}).info_density_max === 60 ? 'selected' : ''}>60%（仅限世界观揭示章）</option>
                </select>
              </div>
              <div><label>金句预留（选填）</label>
                <input type="text" data-f="rhythm_quote" value="${esc((o.rhythm || {}).golden_quote || '')}" placeholder="一句让读者想截图转发的话" />
              </div>
            </div>
          `)}

          ${section(10, '上下文召回', `
            <div class="dt-repeatable" data-repeat="context_recall">
              ${(o.context_recall || []).map((f, i) => recallItemHTML(f, i)).join('') || '<p class="dt-empty-hint">暂无召回场景</p>'}
            </div>
            <button class="dt-btn dt-btn-sm" data-act="add-recall">+ 添加召回场景</button>
            <p class="dt-hint">填写 _scenes/ 下的场景文件名，执笔时 context-composer 会自动拼装。</p>
          `)}

          ${section(11, 'must-keep / must-avoid', `
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>✅ 必须保留（少一项即跑题）</label>
                <textarea data-f="must_keep" rows="5" placeholder="每行一条，例：起承转合四段齐全&#10;章末按「危机型」写钩子&#10;主角境界不能超过感应中阶">${esc((o.must_keep || []).join('\n'))}</textarea>
              </div>
              <div>
                <label>❌ 必须避免（犯一项扣大分）</label>
                <textarea data-f="must_avoid" rows="5" placeholder="每行一条，例：禁止大段设定倾倒&#10;禁止主角无支撑跳级&#10;禁止核心冲突没推进">${esc((o.must_avoid || []).join('\n'))}</textarea>
              </div>
            </div>
          `)}

          ${section(12, '章纲自检 Checklist（保存前对照打勾）', `
            <p class="dt-hint">参考「章纲写作指南」10 条自检。全过后再交给 writer 写正文。</p>
            <div class="dt-checklist-wrap">
              ${selfcheckItemHTML(o.selfcheck, 'qicige_full',       '1. 起承转合四段概要都填了（不是全铺垫没高潮）')}
              ${selfcheckItemHTML(o.selfcheck, 'word_ok',           '2. 字数目标合理（黄金三章 2500-3000，不能短）')}
              ${selfcheckItemHTML(o.selfcheck, 'has_hook',          '3. 章末明确钩子 7 选 1，不是「本章完」式收尾')}
              ${selfcheckItemHTML(o.selfcheck, 'rhythm_ok',         '4. 爽压值合理，和卷节奏曲线对齐（不连续低爽/高压）')}
              ${selfcheckItemHTML(o.selfcheck, 'conflict_clear',    '5. 核心冲突一句话讲清（写在第三节）')}
              ${selfcheckItemHTML(o.selfcheck, 'scene_count_ok',    '6. 场景 2-4 个（不是 1 个全章水对话，不是 8 个碎片跳）')}
              ${selfcheckItemHTML(o.selfcheck, 'density_ok',        '7. 信息密度≤上限（黄金三章≤30%，常规≤50%）')}
              ${selfcheckItemHTML(o.selfcheck, 'hooks_filled',      '8. 伏笔埋/提/收三类均填了（无则留空，不能漏节）')}
              ${selfcheckItemHTML(o.selfcheck, 'overdue_handled',   '9. audit_hooks 超期伏笔处理了（本章回收 或 提醒）')}
              ${selfcheckItemHTML(o.selfcheck, 'state_safe',        '10. 角色状态不跳级（若有突变，必须在「转段」有支撑场景）')}
            </div>
          `)}
        </div>`;
    }

    // 辅助：起承转合卡片
    function qicigeCardHTML(key, name, pct, data) {
      data = data || { summary: '', detail: '' };
      return `<div class="dt-qc-card ${key}">
        <div class="dt-qc-head">
          <span class="dt-qc-name">${name}</span>
          <span class="dt-qc-pct">${pct}</span>
        </div>
        <div class="dt-form" style="padding:0;">
          <div class="dt-form-row">
            <label>一句话概要（≤30字）</label>
            <input type="text" data-qicige="${key}" data-field="summary" value="${esc(data.summary || '')}" maxlength="40" placeholder="例：场景建立+承接上章钩子" />
          </div>
          <div class="dt-form-row">
            <label>关键细节/对话提示</label>
            <textarea data-qicige="${key}" data-field="detail" rows="3" placeholder="地点/动作/渗透≤3句设定/局势升级点">${esc(data.detail || '')}</textarea>
          </div>
        </div>
      </div>`;
    }

    // 辅助：自检项
    function selfcheckItemHTML(sc, key, label) {
      sc = sc || {};
      const ok = !!sc[key];
      return `<label class="${ok ? 'ok' : ''}">
        <input type="checkbox" data-selfcheck="${key}" ${ok ? 'checked' : ''} />
        <span>${esc(label)}</span>
      </label>`;
    }

    // 辅助：场景项
    function sceneItemHTML(s, i) {
      return `
        <div class="dt-repeat-item" data-item-idx="${i}">
          <div class="dt-form-row dt-form-row-2col">
            <div><label>地点</label><input type="text" data-f="scene_location" value="${esc(s.location || '')}" /></div>
            <div><label>时间</label><input type="text" data-f="scene_time" value="${esc(s.time || '')}" placeholder="如：辰时 / 三天后 / 夜" /></div>
          </div>
          <div class="dt-form-row dt-form-row-2col">
            <div><label>出场人物</label><input type="text" data-f="scene_characters" value="${esc(s.characters || '')}" placeholder="逗号分隔" /></div>
            <div><label>场景目的</label>
              <select data-f="scene_purpose">
                ${['','建立主角处境','铺垫冲突','承接上章钩子','升级冲突','信息渗透','配角登场','爽点爆发','反转揭秘','危机升级','余波+钩子'].map(p =>
                  `<option value="${p}" ${s.purpose === p ? 'selected' : ''}>${p || '— 自定义 —'}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="dt-form-row"><label>本场景核心动作/事件</label>
            <input type="text" data-f="scene_event" value="${esc(s.event || '')}" />
          </div>
          <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del-item">删除场景</button>
        </div>`;
    }

    // 辅助：角色项
    function charItemHTML(c, i) {
      return `
        <div class="dt-repeat-item" data-item-idx="${i}">
          <div class="dt-form-row dt-form-row-2col">
            <div><label>角色名</label>
              <input list="hook_char_select_list" type="text" data-f="char_name" value="${esc(c.name || '')}" />
            </div>
            <div><label>作用</label><input type="text" data-f="char_role" value="${esc(c.role || '')}" /></div>
          </div>
          <div class="dt-form-row dt-form-row-2col">
            <div><label>本章状态变化</label>
              <input type="text" data-f="char_delta" value="${esc(c.effect_in_chapter || c.state_change || '')}" placeholder="如：境界突破→筑基 / 与主角从敌转友" />
            </div>
            <div><label>状态锚点文件</label>
              <input type="text" data-f="char_statefile" value="${esc(c.state_file || '')}" placeholder="如：02_角色/antagonists/韩墨.md" />
            </div>
          </div>
          <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del-item">删除角色</button>
        </div>`;
    }

    // 辅助：伏笔迷你行（三类通用）
    function hookMiniHTML(h, i, group) {
      const isPlanted  = group === 'planted';
      const isHinted   = group === 'hinted';
      const isResolved = group === 'resolved';
      h = typeof h === 'string' ? { hook_id: h } : (h || {});
      // 生成下拉选项（已登记的伏笔 ID）
      const selectOpts = hooks.map(x => `<option value="${esc(x.hook_id)}" ${h.hook_id === x.hook_id ? 'selected' : ''}>${esc(x.hook_id)} · ${esc(x.description || '').slice(0, 18)}</option>`).join('');
      let extras = '';
      if (isPlanted) {
        extras = `
          <div class="dt-form-row dt-form-row-3col" style="margin-top:6px;">
            <div><label>scope</label>
              <select data-f="hp_scope">
                ${['','short','long','core'].map(s => `<option ${h.scope === s ? 'selected' : ''}>${s || '—'}</option>`).join('')}
              </select>
            </div>
            <div><label>强度</label>
              <select data-f="hp_strength">
                ${['','强','中','弱'].map(s => `<option ${h.strength === s ? 'selected' : ''}>${s || '—'}</option>`).join('')}
              </select>
            </div>
            <div><label>目标回收章</label>
              <input type="text" data-f="hp_target" value="${esc(h.target_ch || '')}" placeholder="如：ch_040" />
            </div>
          </div>
          <div class="dt-form-row"><label>埋设方式（小细节/意味深长话/物品）</label>
            <input type="text" data-f="hp_method" value="${esc(h.plant_method || '')}" />
          </div>`;
      } else if (isHinted) {
        extras = `
          <div class="dt-form-row dt-form-row-2col" style="margin-top:6px;">
            <div><label>提醒方式（念头/配角提/画面闪）</label>
              <input type="text" data-f="hh_method" value="${esc(h.method || '')}" />
            </div>
            <div><label>提醒强度 1-5</label>
              <input type="number" data-f="hh_strength" min="1" max="5" value="${h.strength || 3}" />
            </div>
          </div>`;
      } else if (isResolved) {
        extras = `
          <div class="dt-form-row dt-form-row-3col" style="margin-top:6px;">
            <div><label>来自章</label>
              <input type="text" data-f="hr_from" value="${esc(h.from_ch || '')}" placeholder="ch_008" />
            </div>
            <div><label>回收方式</label>
              <select data-f="hr_method">
                ${['','reveal揭示','twist反转','powerup能力解锁','emotional情感冲击','callback回扣前文'].map(s => `<option ${h.method === s ? 'selected' : ''}>${s || '—'}</option>`).join('')}
              </select>
            </div>
            <div><label>回收爽感 1-5</label>
              <input type="number" data-f="hr_payoff" min="1" max="5" value="${h.payoff_strength || 4}" />
            </div>
          </div>`;
      }
      return `
        <div class="dt-repeat-item" data-hook-idx="${i}" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
          <div class="dt-form-row" style="margin:0;">
            <label>伏笔 ID（可从下拉选已登记的）</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <select data-f="hook_id_select" style="flex:1;">
                <option value="">— 新建或选择 —</option>
                ${selectOpts}
              </select>
              <input type="text" data-f="hook_id_text" value="${esc(h.hook_id || '')}" placeholder="或手动输入 ID" style="flex:1;" />
              <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del-hookmini">删除</button>
            </div>
          </div>
          ${isPlanted ? `<div class="dt-form-row" style="margin:6px 0 0;"><label>一句话描述（新建必填）</label><input type="text" data-f="hp_desc" value="${esc(h.description || '')}" /></div>` : ''}
          ${extras}
        </div>`;
    }

    // 辅助：召回项
    function recallItemHTML(f, i) {
      return `
        <div class="dt-repeat-item" data-item-idx="${i}">
          <div class="dt-form-row">
            <label>召回场景文件</label>
            <input type="text" data-f="recall_file" value="${esc(f || '')}" placeholder="如：ch_042_对决赵师兄.md" />
          </div>
          <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del-item">删除</button>
        </div>`;
    }

    function section(num, title, inner) {
      return `<fieldset class="dt-outline-section"><legend><span class="dt-section-num">${num}</span>${esc(title)}</legend>${inner}</fieldset>`;
    }

    // ---------- 表单行为绑定 ----------
    function bindOutlineFormBehaviors(overlay, outline) {
      const body = overlay.querySelector('.dt-modal-body');

      // Picker 通用：爽点类型 / 钩子类型
      ['climax_type', 'hook_type'].forEach((pickerKey) => {
        const picker = body.querySelector(`[data-picker="${pickerKey}"]`);
        if (!picker) return;
        picker.querySelectorAll('.dt-picker-card').forEach((card) => {
          card.addEventListener('click', () => {
            picker.querySelectorAll('.dt-picker-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            // 如果没选强度，用星级做默认建议
            const star = Number(card.getAttribute('data-star')) || 0;
            if (pickerKey === 'climax_type' && star) {
              const input = body.querySelector('[data-f="climax_strength"]');
              const val = body.querySelector('[data-f="climax_strength_val"]');
              const suggest = Math.min(10, star * 2);
              input.value = suggest; val.textContent = suggest;
            }
            if (pickerKey === 'hook_type' && star) {
              const input = body.querySelector('[data-f="hook_strength"]');
              const val = body.querySelector('[data-f="hook_strength_val"]');
              input.value = star; val.textContent = star;
            }
          });
        });
      });

      // Range 滑块实时值
      [['climax_strength','climax_strength_val'],
       ['hook_strength','hook_strength_val'],
       ['rhythm_sat','rhythm_sat_val'],
       ['rhythm_sup','rhythm_sup_val']].forEach(([a, b]) => {
        const inp = body.querySelector(`[data-f="${a}"]`); const out = body.querySelector(`[data-f="${b}"]`);
        if (inp && out) inp.addEventListener('input', () => out.textContent = inp.value);
      });

      // 自检清单
      body.querySelectorAll('[data-selfcheck]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const label = cb.closest('label');
          if (label) label.classList.toggle('ok', cb.checked);
        });
      });

      // --- 可重复项：场景 / 角色 / 召回 ---
      // 添加场景
      bindAddRepeat(body, 'add-scene', 'scenes', sceneItemHTML({}, 0));
      // 添加角色
      bindAddRepeat(body, 'add-char', 'characters', charItemHTML({}, 0));
      // 添加召回
      bindAddRepeat(body, 'add-recall', 'context_recall', recallItemHTML('', 0));
      // 已有删除
      bindDelItem(body, '[data-repeat="scenes"]');
      bindDelItem(body, '[data-repeat="characters"]');
      bindDelItem(body, '[data-repeat="context_recall"]');

      // --- 伏笔三类：埋设 / 提示 / 回收 ---
      ['planted','hinted','resolved'].forEach((g) => {
        const btn = body.querySelector(`[data-act="add-hook-${g}"]`);
        if (!btn) return;
        btn.addEventListener('click', () => {
          const wrap = body.querySelector(`[data-group="${g}"]`);
          const idx = wrap.querySelectorAll('.dt-repeat-item').length;
          const div = document.createElement('div');
          div.innerHTML = hookMiniHTML({}, idx, g);
          const item = div.firstElementChild;
          wrap.appendChild(item);
          bindHookMiniBehavior(item, g);
          // 去掉空提示
          const hint = wrap.querySelector('.dt-empty-hint');
          if (hint) hint.remove();
        });
      });
      body.querySelectorAll('[data-hook-idx]').forEach(it => bindHookMiniBehavior(it, it.closest('[data-group]').getAttribute('data-group')));

      function bindHookMiniBehavior(item, group) {
        const delBtn = item.querySelector('[data-act="del-hookmini"]');
        if (delBtn) delBtn.addEventListener('click', () => {
          item.remove();
          const wrap = item.parentElement;
          if (!wrap.querySelector('.dt-repeat-item')) {
            wrap.insertAdjacentHTML('beforeend', '<p class="dt-empty-hint">本章不操作</p>');
          }
          // 重新编号
          wrap.querySelectorAll('[data-hook-idx]').forEach((el, i) => el.setAttribute('data-hook-idx', String(i)));
        });
        // select 和 text 同步
        const sel = item.querySelector('[data-f="hook_id_select"]');
        const txt = item.querySelector('[data-f="hook_id_text"]');
        if (sel && txt) {
          sel.addEventListener('change', () => {
            if (sel.value) txt.value = sel.value;
          });
        }
      }
    }

    function bindAddRepeat(body, btnAct, repeatKey, templateHTML) {
      const btn = body.querySelector(`[data-act="${btnAct}"]`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        const wrap = body.querySelector(`[data-repeat="${repeatKey}"]`);
        const div = document.createElement('div');
        div.innerHTML = templateHTML;
        const item = div.firstElementChild;
        wrap.appendChild(item);
        bindDelItemSingle(item, wrap);
        const hint = wrap.querySelector('.dt-empty-hint');
        if (hint) hint.remove();
      });
    }
    function bindDelItem(body, scopeSel) {
      body.querySelectorAll(`${scopeSel} .dt-repeat-item`).forEach(it => bindDelItemSingle(it, body.querySelector(scopeSel)));
    }
    function bindDelItemSingle(item, wrap) {
      const btn = item.querySelector('[data-act="del-item"]');
      if (!btn) return;
      btn.addEventListener('click', () => {
        item.remove();
        if (!wrap.querySelector('.dt-repeat-item')) {
          wrap.insertAdjacentHTML('beforeend', '<p class="dt-empty-hint">暂无</p>');
        }
        wrap.querySelectorAll('.dt-repeat-item').forEach((it, i) => it.setAttribute('data-item-idx', String(i)));
      });
    }

    /** 从表单收集章纲数据（兼容新老结构） */
    function collectOutlineFromForm(formEl, base) {
      const get = (name) => {
        const el = formEl.querySelector(`[data-f="${name}"]`);
        return el ? el.value : '';
      };

      // --- 起承转合 ---
      const qicige = {
        qi:    { pct: '≈25%', summary: qVal(formEl, 'qi',    'summary'), detail: qVal(formEl, 'qi',    'detail') },
        cheng: { pct: '≈35%', summary: qVal(formEl, 'cheng', 'summary'), detail: qVal(formEl, 'cheng', 'detail') },
        zhuan: { pct: '≈30%', summary: qVal(formEl, 'zhuan', 'summary'), detail: qVal(formEl, 'zhuan', 'detail') },
        he:    { pct: '≈10%', summary: qVal(formEl, 'he',    'summary'), detail: qVal(formEl, 'he',    'detail') },
      };

      // --- 爽点类型 picker ---
      const climaxTypeSel = formEl.querySelector('[data-picker="climax_type"] .dt-picker-card.selected');
      const hookTypeSel   = formEl.querySelector('[data-picker="hook_type"]   .dt-picker-card.selected');

      // --- 场景 / 角色 / 召回 ---
      const scenes = [];
      formEl.querySelectorAll('[data-repeat="scenes"] .dt-repeat-item').forEach((it) => {
        scenes.push({
          location:   it.querySelector('[data-f="scene_location"]').value.trim(),
          time:       it.querySelector('[data-f="scene_time"]').value.trim(),
          characters: it.querySelector('[data-f="scene_characters"]').value.trim(),
          purpose:    it.querySelector('[data-f="scene_purpose"]').value,
          event:      it.querySelector('[data-f="scene_event"]').value.trim(),
        });
      });
      const characters = [];
      formEl.querySelectorAll('[data-repeat="characters"] .dt-repeat-item').forEach((it) => {
        characters.push({
          name:            it.querySelector('[data-f="char_name"]').value.trim(),
          role:            it.querySelector('[data-f="char_role"]').value.trim(),
          effect_in_chapter: it.querySelector('[data-f="char_delta"]').value.trim(),
          state_change:    it.querySelector('[data-f="char_delta"]').value.trim(),
          state_file:      it.querySelector('[data-f="char_statefile"]').value.trim(),
        });
      });
      const context_recall = [];
      formEl.querySelectorAll('[data-repeat="context_recall"] .dt-repeat-item').forEach((it) => {
        const v = it.querySelector('[data-f="recall_file"]').value.trim();
        if (v) context_recall.push(v);
      });

      // --- 伏笔三类：埋设 / 提示 / 回收 ---
      const hook_planted = collectHooks(formEl, 'planted');
      const hook_hinted  = collectHooks(formEl, 'hinted');
      const hook_resolved = collectHooks(formEl, 'resolved');

      // --- 自检 ---
      const selfcheck = {};
      formEl.querySelectorAll('[data-selfcheck]').forEach((cb) => {
        selfcheck[cb.getAttribute('data-selfcheck')] = cb.checked;
      });

      return {
        ...(base || emptyOutline('', '')),
        vol_no: get('vol_no'),
        ch_no: get('ch_no'),
        title: get('title').trim(),
        chapter_type: get('chapter_type'),
        word_target: Number(get('word_target')) || 0,
        pov: get('pov').trim(),
        special_mode: get('special_mode'),
        qicige_loc: get('qicige_loc'),
        qicige,
        core_conflict: get('core_conflict').trim(),
        climax: {
          type: climaxTypeSel ? climaxTypeSel.getAttribute('data-val') || '' : '',
          strength: Number(get('climax_strength')) || 5,
          formula: {
            flag:   get('climax_formula_flag').trim(),
            crowd:  get('climax_formula_crowd').trim(),
            moment: get('climax_formula_moment').trim(),
            ending: get('climax_formula_ending').trim(),
          },
        },
        chapter_hook: {
          type: hookTypeSel ? hookTypeSel.getAttribute('data-val') || '' : '',
          strength: Number(get('hook_strength')) || 3,
          content: get('chapter_hook_content').trim(),
          cuttip: get('hook_cuttip').trim(),
        },
        scenes, characters,
        hook_planted, hook_hinted, hook_resolved,
        rhythm: {
          satisfaction: Number(get('rhythm_sat')) || 3,
          suppression:  Number(get('rhythm_sup')) || 2,
          trend:        get('rhythm_trend'),
          info_density_max: Number(get('rhythm_density')) || 50,
          golden_quote: get('rhythm_quote').trim(),
        },
        context_recall,
        must_keep: get('must_keep').split('\n').map(s => s.trim()).filter(Boolean),
        must_avoid: get('must_avoid').split('\n').map(s => s.trim()).filter(Boolean),
        selfcheck,
      };
    }

    function qVal(formEl, key, field) {
      const el = formEl.querySelector(`[data-qicige="${key}"][data-field="${field}"]`);
      return el ? el.value.trim() : '';
    }

    function collectHooks(formEl, group) {
      const arr = [];
      const wrap = formEl.querySelector(`[data-group="${group}"]`);
      if (!wrap) return arr;
      wrap.querySelectorAll('[data-hook-idx]').forEach((item) => {
        const idSel = item.querySelector('[data-f="hook_id_select"]');
        const idTxt = item.querySelector('[data-f="hook_id_text"]');
        const id = (idTxt ? idTxt.value.trim() : '') || (idSel ? idSel.value.trim() : '');
        if (!id) return;
        const h = { hook_id: id };
        if (group === 'planted') {
          h.description = item.querySelector('[data-f="hp_desc"]').value.trim();
          h.scope = item.querySelector('[data-f="hp_scope"]').value || '';
          h.strength = item.querySelector('[data-f="hp_strength"]').value || '';
          h.target_ch = item.querySelector('[data-f="hp_target"]').value.trim();
          h.plant_method = item.querySelector('[data-f="hp_method"]').value.trim();
        } else if (group === 'hinted') {
          h.method = item.querySelector('[data-f="hh_method"]').value.trim();
          h.strength = Number(item.querySelector('[data-f="hh_strength"]').value) || 3;
        } else if (group === 'resolved') {
          h.from_ch = item.querySelector('[data-f="hr_from"]').value.trim();
          h.method = item.querySelector('[data-f="hr_method"]').value || '';
          h.payoff_strength = Number(item.querySelector('[data-f="hr_payoff"]').value) || 4;
        }
        arr.push(h);
      });
      return arr;
    }

    // ---------- 新建章纲 ----------
    function newOutline() {
      if (!volumes.length) {
        DT().notify('请先在「分卷」中创建至少一卷', 'warning');
        return;
      }
      const overlay = createModal({
        title: '新建章纲',
        bodyHTML: `
          <div class="dt-form">
            <div class="dt-form-row">
              <label>选择卷</label>
              <select data-field="vol_no">
                ${volumes.map((v) => `<option value="${esc(v.vol_no)}">第 ${esc(v.vol_no)} 卷 · ${esc(v.vol_name || '未命名')}</option>`).join('')}
              </select>
            </div>
          </div>`,
        submitText: '下一步',
        onSubmit: async (formEl, closeFn) => {
          const volNo = formEl.querySelector('[data-field="vol_no"]').value;
          const volChs = chapters.filter((c) => c.vol_no === volNo);
          let maxCh = 0;
          volChs.forEach((c) => {
            const n = Number(c.ch_no) || 0;
            if (n > maxCh) maxCh = n;
          });
          const chNo = padCh(maxCh + 1);
          const newChapter = {
            vol_no: volNo, ch_no: chNo,
            title: '新章节 ' + chNo, content: '',
            summary: serializeOutlineToSummary(emptyOutline(volNo, chNo)),
            highlights: [], words: 0, status: 'draft',
            updated_at: new Date().toISOString(),
          };
          try {
            await DT().storage.saveChapter(pid, newChapter);
            DT().notify(`已创建第 ${volNo} 卷 第 ${chNo} 章`, 'success');
            closeFn();
            await reload();
            const created = (await DT().storage.listChapters(pid)).find((c) => c.vol_no === volNo && c.ch_no === chNo);
            if (created) openOutlineEditor(created);
            return true;
          } catch (err) {
            console.error('[outline] 新建章纲失败:', err);
            DT().notify('新建失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      panel.appendChild(overlay);
    }

    function confirmDeleteOutline(ch) {
      const overlay = createModal({
        title: '清空章纲',
        bodyHTML: `<p>确认清空第 ${esc(ch.vol_no)} 卷 第 ${esc(ch.ch_no)} 章的章纲数据？章节正文不会被删除，仅清除 summary 中的章纲信息。</p>`,
        submitText: '清空',
        submitClass: 'dt-btn-danger',
        onSubmit: async () => {
          const payload = { ...ch, summary: '', updated_at: new Date().toISOString() };
          try {
            await DT().storage.saveChapter(pid, payload);
            DT().notify('章纲已清空', 'success');
            await reload();
            return true;
          } catch (err) {
            console.error('[outline] 清空章纲失败:', err);
            DT().notify('清空失败：' + (err.message || err), 'error');
            return false;
          }
        },
      });
      panel.appendChild(overlay);
    }

    panel.querySelector('[data-act="new"]').addEventListener('click', newOutline);
    panel.querySelector('[data-act="refresh"]').addEventListener('click', reload);
    await reload();
  }

  // ==================== Tab 4：✨ 写作引导 ====================

  async function renderGuide(panel) {
    const pid = currentProjectId();
    if (!pid) { panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>'; return; }

    panel.innerHTML = `
      <div class="dt-guide-layout">
        <aside class="dt-guide-sidebar" id="dt-guide-sidebar"></aside>
        <section class="dt-guide-content" id="dt-guide-content">
          <div class="loading">正在加载写作引导…</div>
        </section>
      </div>`;

    const sidebar = panel.querySelector('#dt-guide-sidebar');
    const content = panel.querySelector('#dt-guide-content');

    // 渲染侧边栏
    sidebar.innerHTML = `
      <div class="dt-guide-group">
        <div class="dt-guide-group-title">📚 大纲怎么写</div>
        ${GUIDE_CONTENT.outline.map(x => `<div class="dt-guide-item" data-cat="outline" data-key="${esc(x.key)}"><span class="dt-guide-icon">${x.icon}</span><span>${esc(x.title)}</span></div>`).join('')}
      </div>
      <div class="dt-guide-group">
        <div class="dt-guide-group-title">✍️ 章纲怎么写</div>
        ${GUIDE_CONTENT.chapter.map(x => `<div class="dt-guide-item" data-cat="chapter" data-key="${esc(x.key)}"><span class="dt-guide-icon">${x.icon}</span><span>${esc(x.title)}</span></div>`).join('')}
      </div>`;

    // 点击切换
    sidebar.querySelectorAll('.dt-guide-item').forEach((it) => {
      it.addEventListener('click', () => {
        sidebar.querySelectorAll('.dt-guide-item').forEach(x => x.classList.remove('active'));
        it.classList.add('active');
        const cat = it.getAttribute('data-cat');
        const key = it.getAttribute('data-key');
        const meta = (GUIDE_CONTENT[cat] || []).find(m => m.key === key);
        if (meta) loadGuideContent(cat, key, meta);
      });
    });

    // 默认加载第一项
    const firstItem = sidebar.querySelector('.dt-guide-item');
    if (firstItem) firstItem.click();

    function loadGuideContent(cat, key, meta) {
      // 尝试从 storage (Vault) 读取对应 Markdown 文件，否则用内置摘要
      const file = `NovelForge_Vault/04_大纲与脉络/${meta.file}`;
      content.innerHTML = '<div class="loading">正在读取 ' + esc(meta.file) + '…</div>';

      // 1. 优先通过 file API 读取（若通过 fsaccess 后端）
      try {
        const backend = DT().storage && DT().storage.backend;
        if (backend && typeof backend.readFile === 'function') {
          backend.readFile(file).then(md => {
            renderMarkdown(md, meta);
          }).catch(() => renderFallback(cat, key, meta));
          return;
        }
      } catch (_) {}
      // 2. 降级：内置摘要
      renderFallback(cat, key, meta);
    }

    function renderMarkdown(md, meta) {
      let html = '';
      try {
        if (global.marked && typeof global.marked.parse === 'function') {
          html = global.marked.parse(md);
        } else if (global.marked) {
          html = global.marked(md);
        } else {
          html = `<pre style="white-space:pre-wrap;font-size:12.5px;">${esc(md)}</pre>`;
        }
      } catch (e) {
        html = `<pre style="white-space:pre-wrap;font-size:12.5px;">${esc(md)}</pre>`;
      }
      content.innerHTML = `
        <h2>${esc(meta.icon)} ${esc(meta.title)} <span style="font-size:12px;color:var(--ink-muted);font-weight:400;margin-left:8px;">来自 ${esc(meta.file)}</span></h2>
        ${html}
        <div class="dt-guide-applybar">
          <button class="dt-btn" data-act="apply-template">📋 一键套用：打开对应模板编辑器</button>
        </div>`;
      const applyBtn = content.querySelector('[data-act="apply-template"]');
      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          // 跳转到对应 Tab：大纲→分卷/章纲；章纲→章纲
          if (meta.file.startsWith('大纲')) {
            switchTabExternal('volumes');
            DT().notify('已切换到「分卷」Tab，请点击「+ 新建卷」或编辑现有卷', 'success');
          } else {
            switchTabExternal('chapters');
            DT().notify('已切换到「章纲」Tab，请填写章纲（爽点/钩子/起承转合选择器已内置）', 'success');
          }
        });
      }
    }

    function renderFallback(cat, key, meta) {
      // 用简要的引导文案作兜底
      const fallbackMap = {
        'outline:why': `## 为什么写大纲\n\n<blockquote class="dt-guide-callout">没有大纲的 100w 字 = 走钢丝。写大纲不是束缚灵感，而是提前埋好高速公路的路标。</blockquote>\n\n**有大纲的好处：** 伏笔不烂尾、节奏不崩坏、卷末有高潮、卡文能续上、主角不崩。\n\n**没大纲的后果：** 埋了忘、爽点水、卷尾塌、读者跑。\n\n→ 下一步：左侧「模板 1·黄金三章」开始，按模板填。`,
      };
      const k = cat + ':' + key;
      let txt = fallbackMap[k] || `## ${esc(meta.title)}\n\n<div class="dt-guide-callout warn">💾 当前未直接挂载 Vault 原始文件。请打开 <code>NovelForge_Vault/04_大纲与脉络/${esc(meta.file)}</code> 查看完整内容（含案例 + Checklist）。</div>\n\n**快速要点：** 选择左侧其他条目查看各模板/写法的详细说明。`;
      renderMarkdown(txt, meta);
    }

    function switchTabExternal(name) {
      // 触发外层 Tab 切换：通过兄弟 Tab 按钮点击
      const tabBar = panel.closest('.dt-tab-panel')
        ?.previousElementSibling
        ?.querySelector('.dt-tab-bar');
      if (!tabBar) return;
      const btn = tabBar.querySelector(`[data-tab="${name}"]`);
      if (btn) btn.click();
    }
  }

  // ==================== Tab 5：🌳 故事脉络树 ====================

  async function renderMindmap(panel) {
    const pid = currentProjectId();
    if (!pid) { panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>'; return; }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">故事脉络（书→卷→弧→章 · 四级树状图）</h3>
        <div class="dt-toolbar-actions">
          <button class="dt-btn" data-act="refresh">🔄 重新生成</button>
        </div>
      </div>
      <div id="dt-legend"></div>
      <div class="dt-mindmap-wrap" id="dt-mindmap">
        <div class="dt-tree-empty"><span class="emoji">🧱</span>正在从分卷/章纲生成脉络树…</div>
      </div>`;

    const legend = panel.querySelector('#dt-legend');
    legend.innerHTML = `
      <div class="dt-tree-legend">
        <div class="lg-item"><div class="lg-swatch" style="background: linear-gradient(135deg, var(--accent), #fff);"></div> 书（根节点）</div>
        <div class="lg-item"><div class="lg-swatch" class="level-vol"></div> 卷</div>
        <div class="lg-item"><div class="lg-swatch" style="border-style:dashed;"></div> 弧（剧情段）</div>
        <div class="lg-item"><div class="lg-swatch"></div> 章</div>
        <div class="lg-item"><div class="lg-bar bar-plant"></div> 埋设伏笔</div>
        <div class="lg-item"><div class="lg-bar bar-hint"></div> 提示伏笔</div>
        <div class="lg-item"><div class="lg-bar bar-resv"></div> 回收伏笔</div>
        <div class="lg-item"><span class="dt-node-badge dt-badge-sat">★4</span> 爽点等级</div>
        <div class="lg-item"><span class="dt-node-badge dt-badge-sup">●3</span> 压抑等级</div>
      </div>`;

    panel.querySelector('[data-act="refresh"]').addEventListener('click', () => buildMindmap());
    await buildMindmap();

    async function buildMindmap() {
      const wrap = panel.querySelector('#dt-mindmap');
      try {
        const [chapters, volumes, hooks] = await Promise.all([
          DT().storage.listChapters(pid),
          DT().storage.listVolumes(pid),
          DT().storage.listHooks(pid),
        ]);
        const vols = (volumes || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const chs = chapters || [];
        if (!vols.length && !chs.length) {
          wrap.innerHTML = `<div class="dt-tree-empty"><span class="emoji">🌱</span>暂无卷/章数据。先到「分卷」+「章纲」Tab 创建内容，再切换到这里。</div>`;
          return;
        }

        // 项目元信息
        const proj = DT().state.currentProject || {};
        const bookTitle = proj.title || '未命名作品';

        // 按卷聚合章
        const byVol = new Map();
        chs.forEach(c => {
          const list = byVol.get(c.vol_no) || [];
          list.push(c);
          byVol.set(c.vol_no, list);
        });
        byVol.forEach(arr => arr.sort((a, b) => String(a.ch_no).localeCompare(String(b.ch_no))));

        // 钩子映射：章号 → { plant:[ids], hint:[ids], resolve:[ids] }
        const hookByCh = {};
        (hooks || []).forEach(h => {
          if (h.planted_ch != null) pushHK(hookByCh, h.planted_ch, 'plant', h.hook_id);
          (h.reminder_chapters || []).forEach(n => pushHK(hookByCh, n, 'hint', h.hook_id));
          if (h.status === 'resolved' && h.target_resolve_ch != null) pushHK(hookByCh, h.target_resolve_ch, 'resolve', h.hook_id);
        });

        // 构建树：卷→弧（按起承转合分块）→章
        const volNodes = vols.map((v, vIdx) => {
          const arr = byVol.get(v.vol_no) || [];
          // 分块：起段前30% / 承段40% / 转合段30%
          const total = arr.length;
          const qCut = Math.max(1, Math.ceil(total * 0.3));
          const cCut = Math.max(1, Math.ceil(total * 0.7));
          const blocks = [
            { name: '起段', cls: 'arc-qi',    range: arr.slice(0, qCut) },
            { name: '承段', cls: 'arc-cheng', range: arr.slice(qCut, cCut) },
            { name: '转合', cls: 'arc-zhuanhe', range: arr.slice(cCut) },
          ].filter(b => b.range.length);
          return { vol: v, volIdx: vIdx, blocks };
        });

        // HTML 递归
        const arcsHTML = (block) => block.range.map(c => chapterNode(c, hookByCh)).join('');
        const blocksHTML = (blocks) => blocks.length ? `<ul>${blocks.map(b => `
          <li>
            <div class="dt-tree-node level-arc" data-type="arc">
              ${esc(b.name)}（${b.range.length}章）
            </div>
            <ul>${arcsHTML(b)}</ul>
          </li>
        `).join('')}</ul>` : '';
        const volsHTML = () => `<ul>${volNodes.map(({ vol, blocks }) => `
          <li>
            <div class="dt-tree-node level-vol" data-type="vol" data-vol="${esc(vol.vol_no)}">
              <div>第${esc(vol.vol_no)}卷</div>
              <div style="font-weight:500;font-size:12px;opacity:.85;margin-top:2px;">${esc(vol.vol_name || '未命名')}</div>
              <div style="font-size:10.5px;color:var(--ink-muted);margin-top:4px;">${esc(vol.vol_goal || '').slice(0, 36) || ''}</div>
            </div>
            ${blocksHTML(blocks)}
          </li>`).join('')}</ul>`;

        wrap.innerHTML = `
          <div class="dt-tree">
            <ul>
              <li>
                <div class="dt-tree-node level-book" data-type="book">📚 ${esc(bookTitle)}</div>
                ${vols.length ? volsHTML() : ''}
              </li>
            </ul>
          </div>`;

        // 节点点击：跳转到章纲编辑器
        wrap.querySelectorAll('.dt-tree-node').forEach(n => {
          n.addEventListener('click', (e) => {
            e.stopPropagation();
            const chNo = n.getAttribute('data-ch');
            const volNo = n.getAttribute('data-vol');
            const type = n.getAttribute('data-type');
            if (type === 'ch' && chNo && volNo) {
              // 切到章纲 Tab + 自动打开对应章
              const tabBar = panel.closest('.dt-tab-panel')?.previousElementSibling?.querySelector('.dt-tab-bar');
              const btn = tabBar && tabBar.querySelector('[data-tab="chapters"]');
              if (btn) {
                btn.click();
                setTimeout(() => {
                  const li = document.querySelector(`.dt-ch-outline-item [data-ch-key="${esc(volNo+':'+chNo)}"]`);
                  if (li) {
                    li.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    li.style.outline = '3px dashed var(--accent)';
                    setTimeout(() => li.style.outline = '', 2000);
                    const ed = li.querySelector('[data-act="edit"]');
                    if (ed) DT().notify('已定位到该章，点击「编辑」即可修改章纲', 'info');
                  }
                }, 450);
              }
            }
          });
        });
      } catch (err) {
        console.error('[mindmap] 生成失败:', err);
        wrap.innerHTML = `<div class="dt-tree-empty"><span class="emoji">⚠️</span>生成失败：${esc(err.message || err)}</div>`;
      }
    }

    function pushHK(map, ch, type, id) {
      ch = Number(ch) || ch;
      if (!map[ch]) map[ch] = { plant: [], hint: [], resolve: [] };
      if (!map[ch][type].includes(id)) map[ch][type].push(id);
    }

    function chapterNode(c, hookByCh) {
      const outline = parseOutlineFromSummary(c.summary);
      const chNum = Number(c.ch_no) || 0;
      const hk = hookByCh[chNum] || {};
      const plantCount = (hk.plant || []).length;
      const hintCount  = (hk.hint  || []).length;
      const resolveCount = (hk.resolve || []).length;
      let hookClass = '';
      if (resolveCount > 0) hookClass = 'hook-resolve';
      else if (plantCount > 0) hookClass = 'hook-plant';
      else if (hintCount > 0) hookClass = 'hook-hint';

      const sat = outline && outline.rhythm ? outline.rhythm.satisfaction : 0;
      const sup = outline && outline.rhythm ? outline.rhythm.suppression : 0;
      const title = outline && outline.title ? outline.title : (c.title || '未命名');
      const conflict = outline && outline.core_conflict ? outline.core_conflict : '（未填）';
      const qloc = outline && outline.qicige_loc ? outline.qicige_loc : '';

      const badges = [];
      if (sat) badges.push(`<span class="dt-node-badge dt-badge-sat">★${sat}</span>`);
      if (sup) badges.push(`<span class="dt-node-badge dt-badge-sup">●${sup}</span>`);
      if (qloc) badges.push(`<span class="dt-node-badge dt-badge-type">${esc(qloc)}</span>`);

      return `<li>
        <div class="dt-tree-node level-ch ${hookClass}" data-type="ch" data-vol="${esc(c.vol_no)}" data-ch="${esc(c.ch_no)}">
          <div>第${esc(c.ch_no)}章 ${esc(title)}</div>
          ${badges.length ? `<div class="node-badges">${badges.join('')}</div>` : ''}
          <div class="dt-tree-tooltip">
            <div class="tip-title">第${esc(c.vol_no)}卷 第${esc(c.ch_no)}章 · ${esc(title)}</div>
            <div class="tip-row"><span class="tip-k">核心冲突：</span><span class="tip-v">${esc(conflict)}</span></div>
            ${qloc ? `<div class="tip-row"><span class="tip-k">节奏定位：</span><span class="tip-v">${esc(qloc)}</span></div>` : ''}
            <div class="tip-row"><span class="tip-k">爽/压：</span><span class="tip-v">${sat ? '★'+sat : '—'} / ${sup ? '●'+sup : '—'}</span></div>
            ${plantCount ? `<div class="tip-row"><span class="tip-k">🟢埋设：</span><span class="tip-v">${esc((hk.plant||[]).join(', '))}</span></div>` : ''}
            ${hintCount ? `<div class="tip-row"><span class="tip-k">🟡提示：</span><span class="tip-v">${esc((hk.hint||[]).join(', '))}</span></div>` : ''}
            ${resolveCount ? `<div class="tip-row"><span class="tip-k">🔴回收：</span><span class="tip-v">${esc((hk.resolve||[]).join(', '))}</span></div>` : ''}
            <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #334;color:#8ca5d4;font-size:11px;">💡 点击节点 → 自动定位到章纲编辑器</div>
          </div>
        </div>
      </li>`;
    }
  }

  // ==================== Tab 6：📈 节奏曲线 ====================

  async function renderRhythm(panel) {
    const pid = currentProjectId();
    if (!pid) { panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>'; return; }

    panel.innerHTML = `
      <div class="dt-rhythm-page">
        <div class="dt-rhythm-chart-wrap">
          <h4>📈 爽点 / 压抑 双轴节奏曲线
            <span style="margin-left:14px;"><span class="dt-qici-seg seg-qi">起段 30%</span><span class="dt-qici-seg seg-cheng">承段 40%</span><span class="dt-qici-seg seg-zhuan">转段 20%</span><span class="dt-qici-seg seg-he">合段 10%</span></span>
          </h4>
          <div class="dt-chart-canvas" id="dt-rhythm-chart"><canvas id="dt-rhythm-canvas"></canvas></div>
          <div id="dt-rhythm-alerts" class="dt-chart-alerts"></div>
        </div>
        <div class="dt-growth-card">
          <h4 style="margin:0 0 10px;font-size:15px;">🏆 主角境界 / 金手指强度 副图</h4>
          <div class="dt-growth-canvas" id="dt-growth-chart"><canvas id="dt-growth-canvas"></canvas></div>
        </div>
      </div>`;

    try {
      const [chapters, hooks] = await Promise.all([
        DT().storage.listChapters(pid),
        DT().storage.listHooks(pid),
      ]);
      const chs = (chapters || []).sort((a, b) => {
        const volCmp = String(a.vol_no).localeCompare(String(b.vol_no));
        return volCmp || String(a.ch_no).localeCompare(String(b.ch_no));
      });
      // 解析每条章纲的 rhythm + 序号
      const labels = [];
      const satArr = [];
      const supArr = [];
      const densityArr = [];
      const powerArr = [];
      chs.forEach(c => {
        const o = parseOutlineFromSummary(c.summary);
        const label = `V${c.vol_no}·${c.ch_no}`;
        labels.push(label);
        satArr.push(o && o.rhythm ? (o.rhythm.satisfaction || 0) : 0);
        supArr.push(o && o.rhythm ? (o.rhythm.suppression || 0) : 0);
        densityArr.push(o && o.rhythm ? (o.rhythm.info_density_max || 50) : 50);
        powerArr.push(o && o.power_level ? o.power_level : (Number(c.power_level) || 0));
      });

      // 告警检测
      const alerts = [];
      const consecLow = findConsec(satArr, v => v > 0 && v <= 2);
      const consecHigh = findConsec(supArr, v => v >= 4);
      if (consecLow.length) alerts.push({ kind: 'severe', icon: '🚨', text: `连续 ${consecLow[0].len} 章爽点≤2（读者弃书线）：章 ${consecLow[0].start+1} ~ ${consecLow[0].end+1}` });
      if (consecHigh.length) alerts.push({ kind: 'severe', icon: '🚨', text: `连续 ${consecHigh[0].len} 章压抑≥4（读者抑郁线）：章 ${consecHigh[0].start+1} ~ ${consecHigh[0].end+1}` });
      // 卷末章是否够爆：末位爽点 <3 警告
      if (chs.length) {
        const lastSat = satArr[satArr.length - 1];
        if (lastSat && lastSat < 3) alerts.push({ kind: 'warn', icon: '⚠️', text: `最新章爽点 ${lastSat} 偏低，卷末高潮建议爽点≥4` });
      }
      if (!alerts.length) alerts.push({ kind: 'ok', icon: '✅', text: '节奏健康：无连续低爽/高压，继续保持。' });

      const alertEl = panel.querySelector('#dt-rhythm-alerts');
      alertEl.innerHTML = alerts.map(a => `<div class="dt-alert-item ${a.kind}"><span class="dt-alert-icon">${a.icon}</span><span>${esc(a.text)}</span></div>`).join('');

      const total = labels.length;
      // 起承转合分段：前30% / 中间40% / 后30%内再分 转 2/3 合 1/3
      const qEnd = Math.max(0, Math.ceil(total * 0.3) - 1);
      const cEnd = Math.max(qEnd, Math.ceil(total * 0.7) - 1);
      const zEnd = Math.max(cEnd, qEnd + Math.ceil((total - 1 - cEnd) * 2 / 3));
      const pluginsAfterDraw = [];

      // Chart.js 渲染（有 CDN 时）
      if (global.Chart && typeof global.Chart === 'function') {
        renderWithChart(total, labels, satArr, supArr, densityArr, powerArr, qEnd, cEnd, zEnd, hooks || []);
      } else {
        renderWithFallback(total, labels, satArr, supArr);
      }
    } catch (err) {
      console.error('[rhythm] 渲染失败:', err);
      panel.innerHTML = `<p class="dt-empty-hint dt-error">节奏数据加载失败：${esc(err.message || err)}</p>`;
    }

    function renderWithChart(total, labels, satArr, supArr, densityArr, powerArr, qEnd, cEnd, zEnd, hooks) {
      const theme = document.documentElement.getAttribute('data-theme');
      const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
      const labelColor = theme === 'dark' ? '#cbd5e1' : '#334155';

      // 伏笔回收/埋设点（竖线）
      const hookLines = [];
      const chs2 = (DT().state._cachedChapters || []);
      for (let i = 0; i < total; i++) {
        // 如果标签有 勾子 信息，可从 hooks 扫描
      }

      const ctx = panel.querySelector('#dt-rhythm-canvas').getContext('2d');
      const RhythmChart = new global.Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '爽点（★ 1-5）',
              data: satArr,
              borderColor: '#16a34a',
              backgroundColor: 'rgba(34,197,94,0.12)',
              fill: true,
              tension: 0.35,
              yAxisID: 'y_sat',
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: '压抑（● 1-5）',
              data: supArr,
              borderColor: '#dc2626',
              backgroundColor: 'rgba(239,68,68,0.08)',
              fill: false,
              tension: 0.35,
              yAxisID: 'y_sup',
              borderDash: [6, 4],
              pointRadius: 4,
              pointHoverRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: labelColor } },
            tooltip: { enabled: true },
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: labelColor, maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 40 },
            },
            y_sat: {
              type: 'linear',
              position: 'left',
              min: 0, max: 5,
              title: { display: true, text: '爽点值', color: '#16a34a' },
              grid: { color: gridColor },
              ticks: { color: '#16a34a', stepSize: 1 },
            },
            y_sup: {
              type: 'linear',
              position: 'right',
              min: 0, max: 5,
              title: { display: true, text: '压抑值', color: '#dc2626' },
              grid: { drawOnChartArea: false },
              ticks: { color: '#dc2626', stepSize: 1 },
            },
          },
        },
        plugins: [
          // 起承转合 底色分段：Plugin 自定义
          {
            id: 'segmentBg',
            beforeDraw(chart) {
              const { ctx, chartArea, scales: { x } } = chart;
              if (!chartArea) return;
              const segs = [
                { from: 0, to: qEnd,     color: 'rgba(59,130,246,0.06)' },
                { from: qEnd+1, to: cEnd, color: 'rgba(139,92,246,0.06)' },
                { from: cEnd+1, to: zEnd, color: 'rgba(249,115,22,0.08)' },
                { from: zEnd+1, to: total-1, color: 'rgba(16,185,129,0.06)' },
              ];
              ctx.save();
              segs.forEach(s => {
                if (s.from > total-1) return;
                const x0 = x.getPixelForValue(Math.min(s.from, total-1));
                const x1 = x.getPixelForValue(Math.min(s.to, total-1));
                ctx.fillStyle = s.color;
                ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
              });
              ctx.restore();
            }
          }
        ],
      });

      // 主角境界副图
      const growthCtx = panel.querySelector('#dt-growth-canvas').getContext('2d');
      new global.Chart(growthCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: '主角境界/能力强度（1-10）',
            data: powerArr,
            backgroundColor: 'rgba(245,158,11,0.45)',
            borderColor: '#f59e0b',
            borderWidth: 1.5,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: labelColor } } },
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: labelColor, maxRotation: 45, autoSkip: true, maxTicksLimit: 40 } },
            y: { grid: { color: gridColor }, ticks: { color: labelColor, stepSize: 1 }, min: 0, max: 10 },
          },
        },
      });
    }

    function renderWithFallback(total, labels, satArr) {
      // 纯 CSS 条形图降级：展示爽点值
      let bars = '';
      for (let i = 0; i < total; i++) {
        const s = satArr[i] || 0;
        const h = Math.max(2, (s / 5) * 100);
        bars += `<div class="dt-bar" style="height:${h}%;" title="${esc(labels[i])} 爽点 ${s}"><sup>${s || ''}</sup></div>`;
      }
      const labelHTML = labels.slice(0, Math.min(40, labels.length)).map(l => `<div class="dt-bar-label">${esc(l)}</div>`).join('');
      panel.querySelector('#dt-rhythm-chart').innerHTML = `
        <div style="padding:8px;background:rgba(227,160,0,0.08);border-radius:8px;margin-bottom:12px;font-size:12.5px;">💡 <strong>Chart.js 未加载（离线/CDN 故障）</strong>，降级为纯 CSS 爽点条形图。联网后刷新可查看双轴曲线 + 告警线 + 起承转合底色。</div>
        <div class="dt-barchart-fallback">${bars || '<div style="margin:auto;color:var(--ink-muted);">暂无章纲节奏数据</div>'}</div>
        ${labelHTML ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(40, labels.length)},1fr);gap:4px;margin-top:8px;">${labelHTML}</div>` : ''}`;
      panel.querySelector('#dt-growth-chart').innerHTML = `<div style="color:var(--ink-muted);font-size:13px;padding:30px;text-align:center;">🏆 主角境界数据需 Chart.js 展示（或先为章纲填写主角境界字段）</div>`;
    }

    function findConsec(arr, pred) {
      const res = [];
      let start = -1, len = 0;
      for (let i = 0; i < arr.length; i++) {
        if (pred(arr[i])) {
          if (start < 0) start = i;
          len++;
        } else {
          if (len >= 3) res.push({ start, end: i - 1, len });
          start = -1; len = 0;
        }
      }
      if (len >= 3) res.push({ start, end: arr.length - 1, len });
      return res;
    }
  }

  // ==================== Tab 7：🪝 伏笔时间线（泳道） ====================

  async function renderHookTimeline(panel) {
    const pid = currentProjectId();
    if (!pid) { panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>'; return; }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">伏笔时间线（生命周期泳道视图 · 超期自动高亮）</h3>
        <div class="dt-toolbar-actions">
          <button class="dt-btn" data-act="refresh">🔄 刷新</button>
        </div>
      </div>
      <div id="dt-hook-timeline" class="dt-hook-timeline"><div class="loading">正在加载伏笔数据…</div></div>`;

    panel.querySelector('[data-act="refresh"]').addEventListener('click', build);
    await build();

    async function build() {
      try {
        const [hooks, chapters] = await Promise.all([
          DT().storage.listHooks(pid),
          DT().storage.listChapters(pid),
        ]);
        const hs = hooks || [];
        if (!hs.length) {
          panel.querySelector('#dt-hook-timeline').innerHTML = `
            <div style="padding:40px 20px;text-align:center;color:var(--ink-muted);font-size:14px;">
              <div style="font-size:42px;">🪝</div>
              <div style="margin-top:10px;">暂无伏笔登记。到「章纲」Tab 写章纲时在「伏笔操作」区创建，或切换到「埋坑点」主功能页登记。</div>
            </div>`;
          return;
        }
        const totalCh = Math.max(...[...chapters.map(c => Number(c.ch_no) || 0), ...hs.map(h => Number(h.target_resolve_ch) || 0), ...hs.map(h => Number(h.planted_ch) || 0)], 1);

        // 当前章号估计：取最大已写过的 or 1
        const currentCh = (DT().state.currentFocusChapter) || 1;

        const html = hs.map(h => swimLane(h, totalCh, currentCh)).join('');
        panel.querySelector('#dt-hook-timeline').innerHTML = html + ticksHTML(totalCh);
      } catch (err) {
        console.error('[hookline] 失败:', err);
        panel.querySelector('#dt-hook-timeline').innerHTML = `<p class="dt-empty-hint dt-error">加载失败：${esc(err.message || err)}</p>`;
      }
    }

    function swimLane(h, totalCh, currentCh) {
      const planted = Number(h.planted_ch) || 1;
      const target  = Number(h.target_resolve_ch) || Math.max(totalCh, planted + 5);
      const leftPct  = Math.max(0, ((planted - 1) / Math.max(1, totalCh)) * 100);
      const widthPct = Math.max(4, ((target - planted + 1) / Math.max(1, totalCh)) * 100);
      // 状态判定
      let statusCls = 'status-' + (h.status || 'planted');
      let statusText = h.status || 'planted';
      const isOverdue = (h.status !== 'resolved' && h.status !== 'abandoned') && currentCh > target;
      const isSoon    = (h.status !== 'resolved' && h.status !== 'abandoned') && Math.abs(currentCh - target) <= 3;
      if (isOverdue) { statusCls = 'status-overdue'; statusText = '超期未收'; }
      else if (isSoon) { statusCls = 'status-soon'; statusText = '临近回收(±3章)'; }
      // 提示章节点
      const hintDots = (h.reminder_chapters || []).slice(0, 8).map(ch => {
        const pct = ((Number(ch) - 1) / Math.max(1, totalCh)) * 100;
        return `<div class="dt-hook-dot hint" style="left:${pct}%;" title="第${ch}章 提示"><span class="dt-hook-dot-label">ch${ch}</span></div>`;
      }).join('');
      // scope 标签
      const scopeMap = { core: 'scope-core', long: 'scope-long', short: 'scope-short' };
      const scopeCls = scopeMap[h.scope] || '';
      const scopeTxt = (h.scope || '').toUpperCase();
      const strengthTxt = (h.strength || '').toUpperCase();
      const relCh = (h.related_characters || []).slice(0, 3).join('/');

      return `
        <div class="dt-hook-swimlane">
          <div class="dt-hook-info">
            <div class="dt-hook-head">
              <span class="dt-hook-id">${esc(h.hook_id || '?')}</span>
              <span class="dt-hook-status ${statusCls}">${esc(statusText)}</span>
              <span class="${scopeCls}">${esc(scopeTxt)}</span>
              ${strengthTxt ? `<span>强度·${esc(strengthTxt)}</span>` : ''}
            </div>
            <div class="dt-hook-desc">${esc(h.description || '（无描述）')}</div>
            <div class="dt-hook-meta">
              <span>埋设 ch${planted} → 目标 ch${target}</span>
              <span>回收方式：${esc(h.payoff_type || '—')}</span>
              ${relCh ? `<span>关联：${esc(relCh)}</span>` : ''}
              ${h.priority ? `<span>优先级·${esc(h.priority)}</span>` : ''}
            </div>
          </div>
          <div class="dt-hook-track">
            <div class="dt-hook-axis">
              <div class="dt-hook-bar scope-${h.scope || 'short'}" style="left:${leftPct}%;width:${widthPct}%;"></div>
              <div class="dt-hook-dot plant" style="left:${leftPct}%;" title="第${planted}章 埋设"><span class="dt-hook-dot-label">埋 ch${planted}</span></div>
              ${hintDots}
              <div class="dt-hook-dot resv"  style="left:${Math.max(0, ((target-1)/Math.max(1,totalCh))*100)}%;" title="目标第${target}章 回收"><span class="dt-hook-dot-label">收 ch${target}</span></div>
            </div>
          </div>
        </div>`;
    }

    function ticksHTML(totalCh) {
      // 取 10 个刻度
      const count = Math.min(10, totalCh);
      const arr = [];
      for (let i = 0; i < count; i++) {
        const ch = Math.round(1 + (totalCh - 1) * (i / Math.max(1, count - 1)));
        arr.push(`<span>ch${ch}</span>`);
      }
      // 对齐泳道：左侧 260px grid 留出
      return `<div style="display:grid;grid-template-columns:260px 1fr;gap:14px;padding:4px 4px 0;">
          <div></div>
          <div class="dt-hook-axis-ticks">${arr.join('')}</div>
        </div>`;
    }
  }

  // ---------- 导出 ----------

  NS.renderOutline = renderOutline;
})(window);
