/**
 * DreamTale · 大纲体系功能模块
 *
 * 三级树：总纲（master_outline.md）→ 分卷（Volume）→ 章纲（Chapter outline）
 * - 总纲：MarkdownEditor 编辑，存储于 localStorage（按项目隔离）
 * - 分卷：列表 + 新建/编辑/删除 + HTML5 原生拖拽排序
 * - 章纲：按卷分组列表，点击打开「十段模板」填空编辑器
 * - 章纲持久化：JSON 序列化后存入 Chapter.summary 字段（带标记前缀）
 *
 * 通过 window.DreamTaleFeatures.renderOutline(container) 挂载。
 *
 * 依赖：
 *   - window.DreamTale.state / storage / notify
 *   - window.DreamTaleEditor.create(container, options)
 *
 * 章纲十段模板对应 core/models.js 的 Outline 类字段。
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
    // state.currentProject 是 Project 实例对象，存储层需要的是 id 字符串
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

  /** 空章纲模板 */
  function emptyOutline(volNo, chNo) {
    return {
      vol_no: volNo,
      ch_no: chNo,
      title: '',
      chapter_type: '',
      word_target: 0,
      pov: '',
      core_conflict: '',
      scenes: [],            // [{location, characters, event}]
      characters: [],        // [{name, role}]
      hook_planted: [],      // [hook_id]
      hook_hinted: [],       // [hook_id]
      hook_resolved: [],     // [hook_id]
      climax: { type: '', strength: 5 },  // 爽点设计
      chapter_hook: '',      // 章末钩子（一句话）
      rhythm: '',            // 节奏标记
      context_recall: [],    // [场景文件名]
      must_keep: [],         // [必须保留的要点]
      must_avoid: [],        // [必须避免的要点]
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

  // ---------- 主渲染入口 ----------

  async function renderOutline(container) {
    if (!container) throw new Error('[outline] container 不能为空');
    container.innerHTML = '';

    // 顶部 Tab：总纲 / 分卷 / 章纲
    const tabs = document.createElement('div');
    tabs.className = 'dt-tabs';
    tabs.innerHTML = `
      <div class="dt-tab-bar">
        <button class="dt-tab active" data-tab="master">总纲</button>
        <button class="dt-tab" data-tab="volumes">分卷</button>
        <button class="dt-tab" data-tab="chapters">章纲</button>
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
      if (name === 'master') await renderMaster(panel);
      else if (name === 'volumes') await renderVolumes(panel);
      else if (name === 'chapters') await renderChapterOutlines(panel);
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
      <p class="dt-hint">总纲存储于浏览器 localStorage（按项目隔离），用于全局设定与故事主线。</p>`;

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
      <p class="dt-hint">提示：拖动卷卡片可调整顺序。</p>
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

      // 绑定编辑/删除
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
      li.addEventListener('dragleave', () => {
        li.classList.remove('dt-dragover');
      });
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
      // 移动数组元素
      const moved = volumes.splice(fromIdx, 1)[0];
      volumes.splice(toIdx, 0, moved);
      // 重新分配 sort_order 并逐个保存
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
          // IStorageBackend 未提供 deleteVolume，软处理：重命名为已删除标记不可行。
          // 这里给出提示，建议通过编辑卷名加 [已废弃] 前缀实现软删除。
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

  // ==================== Tab 3：章纲（十段模板） ====================

  async function renderChapterOutlines(panel) {
    const pid = currentProjectId();
    if (!pid) {
      panel.innerHTML = '<p class="dt-empty-hint">请先选择作品</p>';
      return;
    }

    panel.innerHTML = `
      <div class="dt-toolbar">
        <h3 class="dt-section-title">章纲（十段模板）</h3>
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
        list.innerHTML = `
          <div class="dt-empty-state">
            <p>暂无章节，点击「新建章纲」开始</p>
          </div>`;
        return;
      }
      // 按卷分组
      const byVol = new Map();
      chapters.forEach((c) => {
        const arr = byVol.get(c.vol_no) || [];
        arr.push(c);
        byVol.set(c.vol_no, arr);
      });
      // 每卷内按章号排序
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
      // 处理卷不存在的孤儿章节
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
      return `
        <li class="dt-ch-outline-item" data-ch-key="${esc(chapterKey(c))}">
          <span class="dt-ch-no">第${esc(c.ch_no)}章</span>
          <div class="dt-ch-outline-main">
            <div class="dt-ch-outline-title">${esc(title)} ${hasOutline ? '<span class="dt-badge dt-badge-ok">已设</span>' : '<span class="dt-badge dt-badge-warn">空</span>'}</div>
            <div class="dt-ch-outline-conflict">${esc(conflict)}</div>
          </div>
          <div class="dt-ch-outline-actions">
            <button class="dt-btn dt-btn-sm" data-act="edit">${hasOutline ? '编辑' : '填写'}</button>
            <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del">清空</button>
          </div>
        </li>`;
    }

    function chapterKey(c) {
      return c.vol_no + ':' + c.ch_no;
    }

    // ---------- 新建/编辑章纲（十段模板） ----------
    function openOutlineEditor(ch) {
      let outline = parseOutlineFromSummary(ch.summary);
      if (!outline) {
        outline = emptyOutline(ch.vol_no, ch.ch_no);
        outline.title = ch.title || '';
      }

      const overlay = createModal({
        title: `章纲编辑 · 第${esc(ch.vol_no)}卷 第${esc(ch.ch_no)}章`,
        size: 'xlarge',
        bodyHTML: outlineFormHTML(outline),
        submitText: '保存章纲',
        onSubmit: async (formEl) => {
          const updated = collectOutlineFromForm(formEl, outline);
          // 同步标题到 chapter
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

    function outlineFormHTML(o) {
      return `
        <div class="dt-outline-form">
          ${section(1, '章节信息', `
            <div class="dt-form-row dt-form-row-3col">
              <div><label>卷号</label><input type="text" data-f="vol_no" value="${esc(o.vol_no)}" readonly /></div>
              <div><label>章号</label><input type="text" data-f="ch_no" value="${esc(o.ch_no)}" readonly /></div>
              <div><label>章节类型</label>
                <select data-f="chapter_type">
                  ${['', '开篇', '推进', '高潮', '转折', '收尾', '过渡', '日常'].map((t) =>
                    `<option value="${t}" ${o.chapter_type === t ? 'selected' : ''}>${t || '—'}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="dt-form-row dt-form-row-2col">
              <div><label>章节标题 <span class="dt-req">*</span></label><input type="text" data-f="title" value="${esc(o.title)}" placeholder="本章标题" /></div>
              <div><label>目标字数</label><input type="number" data-f="word_target" value="${o.word_target || 0}" min="0" step="100" /></div>
            </div>
            <div class="dt-form-row"><label>视点人物（POV）</label><input type="text" data-f="pov" value="${esc(o.pov)}" placeholder="如：主角" /></div>
          `)}

          ${section(2, '核心冲突', `
            <div class="dt-form-row"><label>一句话核心冲突</label><input type="text" data-f="core_conflict" value="${esc(o.core_conflict)}" placeholder="如：主角被冤枉杀人，需在三日内自证清白" /></div>
          `)}

          ${section(3, '场景列表', `
            <div class="dt-repeatable" data-repeat="scenes">
              ${(o.scenes || []).map((s, i) => sceneItemHTML(s, i)).join('') || '<p class="dt-empty-hint">暂无场景，点击下方添加</p>'}
            </div>
            <button class="dt-btn dt-btn-sm" data-act="add-scene">+ 添加场景</button>
          `)}

          ${section(4, '出场角色', `
            <div class="dt-repeatable" data-repeat="characters">
              ${(o.characters || []).map((c, i) => charItemHTML(c, i)).join('') || '<p class="dt-empty-hint">暂无角色，点击下方添加</p>'}
            </div>
            <button class="dt-btn dt-btn-sm" data-act="add-char">+ 添加角色</button>
          `)}

          ${section(5, '伏笔操作', `
            <div class="dt-form-row dt-form-row-3col">
              <div>
                <label>埋设伏笔（hook_id）</label>
                <div class="dt-tag-input" data-repeat="hook_planted">
                  ${(o.hook_planted || []).map((h, i) => tagItemHTML(h, i, 'planted')).join('')}
                </div>
                <input type="text" data-f="hook_planted_input" placeholder="输入 hook_id 回车添加" />
              </div>
              <div>
                <label>提示伏笔（hook_id）</label>
                <div class="dt-tag-input" data-repeat="hook_hinted">
                  ${(o.hook_hinted || []).map((h, i) => tagItemHTML(h, i, 'hinted')).join('')}
                </div>
                <input type="text" data-f="hook_hinted_input" placeholder="输入 hook_id 回车添加" />
              </div>
              <div>
                <label>回收伏笔（hook_id）</label>
                <div class="dt-tag-input" data-repeat="hook_resolved">
                  ${(o.hook_resolved || []).map((h, i) => tagItemHTML(h, i, 'resolved')).join('')}
                </div>
                <input type="text" data-f="hook_resolved_input" placeholder="输入 hook_id 回车添加" />
              </div>
            </div>
            <p class="dt-hint">已存在的伏笔：${hooks.length ? hooks.map((h) => `<code>${esc(h.hook_id)}</code>`).join(' ') : '（暂无）'}</p>
          `)}

          ${section(6, '爽点设计', `
            <div class="dt-form-row dt-form-row-2col">
              <div>
                <label>爽点类型</label>
                <select data-f="climax_type">
                  ${['', '打脸', '升级', '获宝', '认主', '复仇', '揭秘', '逆袭', '救美', '其他'].map((t) =>
                    `<option value="${t}" ${(o.climax || {}).type === t ? 'selected' : ''}>${t || '—'}</option>`).join('')}
                </select>
              </div>
              <div>
                <label>爽点强度（1-10）</label>
                <input type="range" data-f="climax_strength" min="1" max="10" value="${(o.climax || {}).strength || 5}" />
                <span data-f="climax_strength_val">${(o.climax || {}).strength || 5}</span>
              </div>
            </div>
          `)}

          ${section(7, '章末钩子', `
            <div class="dt-form-row"><label>章末钩子（一句话）</label><input type="text" data-f="chapter_hook" value="${esc(o.chapter_hook || '')}" placeholder="如：就在此时，门被一脚踢开——" /></div>
          `)}

          ${section(8, '节奏标记', `
            <div class="dt-form-row">
              <label>节奏类型</label>
              <select data-f="rhythm">
                ${['', '前抑后爽', '平推', '蓄势', '爆发', '舒缓', '悬疑', '反转', '群像'].map((t) =>
                  `<option value="${t}" ${o.rhythm === t ? 'selected' : ''}>${t || '—'}</option>`).join('')}
              </select>
            </div>
          `)}

          ${section(9, '上下文召回', `
            <div class="dt-repeatable" data-repeat="context_recall">
              ${(o.context_recall || []).map((f, i) => recallItemHTML(f, i)).join('') || '<p class="dt-empty-hint">暂无召回，点击下方添加</p>'}
            </div>
            <button class="dt-btn dt-btn-sm" data-act="add-recall">+ 添加召回场景</button>
            <p class="dt-hint">填写 _scenes/ 下的场景文件名，用于执笔时召回关键场景。</p>
          `)}

          ${section(10, '必须遵守', `
            <div class="dt-form-row">
              <label>必须保留（must-keep）</label>
              <textarea data-f="must_keep" rows="3" placeholder="每行一条，本章必须出现的设定/情节">${esc((o.must_keep || []).join('\n'))}</textarea>
            </div>
            <div class="dt-form-row">
              <label>必须避免（must-avoid）</label>
              <textarea data-f="must_avoid" rows="3" placeholder="每行一条，本章必须避免的设定/情节">${esc((o.must_avoid || []).join('\n'))}</textarea>
            </div>
          `)}
        </div>`;
    }

    function section(num, title, inner) {
      return `<fieldset class="dt-outline-section"><legend><span class="dt-section-num">${num}</span>${esc(title)}</legend>${inner}</fieldset>`;
    }

    function sceneItemHTML(s, i) {
      return `
        <div class="dt-repeat-item" data-item-idx="${i}">
          <div class="dt-form-row dt-form-row-3col">
            <div><label>地点</label><input type="text" data-f="scene_location" value="${esc(s.location || '')}" placeholder="场景地点" /></div>
            <div><label>人物</label><input type="text" data-f="scene_characters" value="${esc(s.characters || '')}" placeholder="出场人物，逗号分隔" /></div>
            <div><label>事件</label><input type="text" data-f="scene_event" value="${esc(s.event || '')}" placeholder="本场景发生的事" /></div>
          </div>
          <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del-item">删除场景</button>
        </div>`;
    }

    function charItemHTML(c, i) {
      return `
        <div class="dt-repeat-item" data-item-idx="${i}">
          <div class="dt-form-row dt-form-row-2col">
            <div><label>角色名</label><input type="text" data-f="char_name" value="${esc(c.name || '')}" placeholder="角色名" /></div>
            <div><label>作用</label><input type="text" data-f="char_role" value="${esc(c.role || '')}" placeholder="在本章的作用" /></div>
          </div>
          <button class="dt-btn dt-btn-sm dt-btn-danger" data-act="del-item">删除角色</button>
        </div>`;
    }

    function tagItemHTML(tag, i, group) {
      return `<span class="dt-tag dt-tag-removable" data-tag-group="${group}" data-item-idx="${i}">${esc(tag)} <button data-act="del-tag" aria-label="删除">×</button></span>`;
    }

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

    // ---------- 表单行为绑定（添加/删除可重复项、tag 输入） ----------
    function bindOutlineFormBehaviors(overlay, outline) {
      const body = overlay.querySelector('.dt-modal-body');

      // 添加场景
      body.querySelector('[data-act="add-scene"]').addEventListener('click', () => {
        const wrap = body.querySelector('[data-repeat="scenes"]');
        const div = document.createElement('div');
        const idx = wrap.querySelectorAll('.dt-repeat-item').length;
        div.innerHTML = sceneItemHTML({}, idx);
        const item = div.firstElementChild;
        wrap.appendChild(item);
        bindDelItem(item);
        if (wrap.querySelector('.dt-empty-hint')) wrap.querySelector('.dt-empty-hint').remove();
      });

      // 添加角色
      body.querySelector('[data-act="add-char"]').addEventListener('click', () => {
        const wrap = body.querySelector('[data-repeat="characters"]');
        const div = document.createElement('div');
        const idx = wrap.querySelectorAll('.dt-repeat-item').length;
        div.innerHTML = charItemHTML({}, idx);
        const item = div.firstElementChild;
        wrap.appendChild(item);
        bindDelItem(item);
        if (wrap.querySelector('.dt-empty-hint')) wrap.querySelector('.dt-empty-hint').remove();
      });

      // 添加召回
      body.querySelector('[data-act="add-recall"]').addEventListener('click', () => {
        const wrap = body.querySelector('[data-repeat="context_recall"]');
        const div = document.createElement('div');
        const idx = wrap.querySelectorAll('.dt-repeat-item').length;
        div.innerHTML = recallItemHTML('', idx);
        const item = div.firstElementChild;
        wrap.appendChild(item);
        bindDelItem(item);
        if (wrap.querySelector('.dt-empty-hint')) wrap.querySelector('.dt-empty-hint').remove();
      });

      // 已存在的删除按钮
      body.querySelectorAll('.dt-repeat-item').forEach((item) => bindDelItem(item));
      function bindDelItem(item) {
        const btn = item.querySelector('[data-act="del-item"]');
        if (btn) btn.addEventListener('click', () => {
          const wrap = item.parentElement;
          item.remove();
          // 重新编号
          wrap.querySelectorAll('.dt-repeat-item').forEach((it, i) => {
            it.setAttribute('data-item-idx', String(i));
          });
        });
      }

      // tag 删除
      body.querySelectorAll('.dt-tag-removable').forEach((tag) => {
        tag.querySelector('[data-act="del-tag"]').addEventListener('click', () => tag.remove());
      });

      // hook tag 输入
      ['planted', 'hinted', 'resolved'].forEach((group) => {
        const input = body.querySelector(`[data-f="hook_${group}_input"]`);
        if (!input) return;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const val = input.value.trim();
            if (!val) return;
            const container = body.querySelector(`[data-repeat="hook_${group}"]`);
            const idx = container.querySelectorAll('.dt-tag-removable').length;
            const div = document.createElement('div');
            div.innerHTML = tagItemHTML(val, idx, group);
            const tagEl = div.firstElementChild;
            tagEl.querySelector('[data-act="del-tag"]').addEventListener('click', () => tagEl.remove());
            container.appendChild(tagEl);
            input.value = '';
          }
        });
      });

      // 爽点强度滑块实时显示
      const strengthInput = body.querySelector('[data-f="climax_strength"]');
      const strengthVal = body.querySelector('[data-f="climax_strength_val"]');
      if (strengthInput && strengthVal) {
        strengthInput.addEventListener('input', () => {
          strengthVal.textContent = strengthInput.value;
        });
      }
    }

    /** 从表单收集章纲数据 */
    function collectOutlineFromForm(formEl, base) {
      const get = (name) => {
        const el = formEl.querySelector(`[data-f="${name}"]`);
        return el ? el.value : '';
      };
      const outline = {
        ...base,
        vol_no: get('vol_no'),
        ch_no: get('ch_no'),
        title: get('title').trim(),
        chapter_type: get('chapter_type'),
        word_target: Number(get('word_target')) || 0,
        pov: get('pov').trim(),
        core_conflict: get('core_conflict').trim(),
        scenes: [],
        characters: [],
        hook_planted: [],
        hook_hinted: [],
        hook_resolved: [],
        climax: { type: get('climax_type'), strength: Number(get('climax_strength')) || 5 },
        chapter_hook: get('chapter_hook').trim(),
        rhythm: get('rhythm'),
        context_recall: [],
        must_keep: get('must_keep').split('\n').map((s) => s.trim()).filter(Boolean),
        must_avoid: get('must_avoid').split('\n').map((s) => s.trim()).filter(Boolean),
      };

      // 收集场景
      formEl.querySelectorAll('[data-repeat="scenes"] .dt-repeat-item').forEach((item) => {
        outline.scenes.push({
          location: item.querySelector('[data-f="scene_location"]').value.trim(),
          characters: item.querySelector('[data-f="scene_characters"]').value.trim(),
          event: item.querySelector('[data-f="scene_event"]').value.trim(),
        });
      });

      // 收集角色
      formEl.querySelectorAll('[data-repeat="characters"] .dt-repeat-item').forEach((item) => {
        outline.characters.push({
          name: item.querySelector('[data-f="char_name"]').value.trim(),
          role: item.querySelector('[data-f="char_role"]').value.trim(),
        });
      });

      // 收集 hook tags
      ['planted', 'hinted', 'resolved'].forEach((group) => {
        const key = 'hook_' + group;
        formEl.querySelectorAll(`[data-repeat="${key}"] .dt-tag-removable`).forEach((tag) => {
          const text = tag.textContent.replace(/\s*×\s*$/, '').trim();
          if (text) outline[key].push(text);
        });
      });

      // 收集召回
      formEl.querySelectorAll('[data-repeat="context_recall"] .dt-repeat-item').forEach((item) => {
        const v = item.querySelector('[data-f="recall_file"]').value.trim();
        if (v) outline.context_recall.push(v);
      });

      return outline;
    }

    // ---------- 新建章纲 ----------
    function newOutline() {
      if (!volumes.length) {
        DT().notify('请先在「分卷」中创建至少一卷', 'warning');
        return;
      }
      // 选择卷号 + 自动分配章号
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
          // 计算下一个章号
          const volChs = chapters.filter((c) => c.vol_no === volNo);
          let maxCh = 0;
          volChs.forEach((c) => {
            const n = Number(c.ch_no) || 0;
            if (n > maxCh) maxCh = n;
          });
          const chNo = padCh(maxCh + 1);
          // 创建空章节并保存
          const newChapter = {
            vol_no: volNo,
            ch_no: chNo,
            title: '新章节 ' + chNo,
            content: '',
            summary: serializeOutlineToSummary(emptyOutline(volNo, chNo)),
            highlights: [],
            words: 0,
            status: 'draft',
            updated_at: new Date().toISOString(),
          };
          try {
            await DT().storage.saveChapter(pid, newChapter);
            DT().notify(`已创建第 ${volNo} 卷 第 ${chNo} 章`, 'success');
            closeFn();
            await reload();
            // 直接打开编辑器
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

  // ---------- 导出 ----------

  NS.renderOutline = renderOutline;
})(window);
