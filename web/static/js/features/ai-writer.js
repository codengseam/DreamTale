/**
 * DreamTale · AI 写作辅助面板
 *
 * 四个 Tab：
 * - 大纲生成：上下文预览 → 生成章纲（十段模板）→ 编辑 → 保存到大纲库
 * - 爽点挖掘：选章节 → 挖掘爽点 → 伏笔回收建议 → 情绪曲线
 * - 润色：文本输入 → 级别选择 → 润色 → 原文/润色对比 → 去 AI 味 → 一键替换
 * - 纠错：文本输入 → 检查 → 错误列表 → 逐条/全部采纳
 *
 * AI 不可用时所有 Tab 显示「请先在 AI 配置中启用 AI」提示。
 *
 * 通过 window.DreamTaleFeatures.renderAIWriter(container) 挂载。
 * 依赖：window.DreamTale.ai（AI 适配器实例，可能为 null）/ window.DreamTale.modules
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------

  function DT() {
    if (!global.DreamTale) throw new Error('[ai-writer] window.DreamTale 未初始化');
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

  function notify(msg, type) {
    try { DT().notify(msg, type || 'info'); } catch (_e) { /* ignore */ }
  }

  /** 懒加载 AI 写作模块（outline-generator / highlight-miner / text-polisher） */
  async function loadModules() {
    const ai = await import('../../src/ai/index.js');
    const mod = await import('../../src/modules/outline-generator.js');
    const hl = await import('../../src/modules/highlight-miner.js');
    const tp = await import('../../src/modules/text-polisher.js');
    return { ai: ai, OutlineGenerator: mod.OutlineGenerator, HighlightMiner: hl.HighlightMiner, TextPolisher: tp.TextPolisher };
  }

  /** 取当前项目上下文（用于大纲生成的上下文预览） */
  function getCurrentContext() {
    const dt = global.DreamTale;
    if (!dt) return null;
    const state = dt.state || {};
    return {
      project: state.currentProject,
      currentVol: state.currentVol,
      currentCh: state.currentCh,
      storage: dt.storage
    };
  }

  // ---------- 主渲染入口 ----------

  /**
   * 渲染 AI 写作辅助面板
   * @param {HTMLElement} container
   */
  async function renderAIWriter(container) {
    if (!container) throw new Error('[ai-writer] container 不能为空');

    // 检测 AI 是否可用
    let aiAdapter = null;
    try { aiAdapter = DT().ai; } catch (_e) { /* ignore */ }

    if (!aiAdapter) {
      renderAIUnavailable(container);
      return;
    }

    // 加载模块
    let Modules;
    try {
      Modules = await loadModules();
    } catch (err) {
      container.innerHTML =
        '<div class="error-page"><h2>⚠ AI 模块加载失败</h2>' +
        '<p class="error-detail">' + esc(err.message || String(err)) + '</p></div>';
      return;
    }

    // 构造三个模块实例
    const outlineGen = new Modules.OutlineGenerator(aiAdapter);
    const miner = new Modules.HighlightMiner(aiAdapter);
    const polisher = new Modules.TextPolisher(aiAdapter);

    renderShell(container, { outlineGen: outlineGen, miner: miner, polisher: polisher });
  }

  /** AI 不可用占位 */
  function renderAIUnavailable(container) {
    container.innerHTML =
      '<div class="ai-panel">' +
        '<div class="page-header"><h2>✍️ AI 写作辅助</h2></div>' +
        '<div class="ai-hint-card">' +
          '<p>🤖 请先在 <a href="#/ai-panel">AI 配置</a> 中启用 AI，再使用 AI 写作辅助功能。</p>' +
          '<p class="muted">AI 适配器未就绪（未配置或加载失败）。</p>' +
        '</div>' +
      '</div>';
  }

  /** 渲染面板外壳（Tab 切换） */
  function renderShell(container, tools) {
    container.innerHTML =
      '<div class="ai-writer">' +
        '<div class="page-header"><h2>✍️ AI 写作辅助</h2></div>' +
        '<div class="tab-bar" id="aiw-tabs">' +
          '<button class="tab-btn active" data-tab="outline">大纲生成</button>' +
          '<button class="tab-btn" data-tab="highlight">爽点挖掘</button>' +
          '<button class="tab-btn" data-tab="polish">润色</button>' +
          '<button class="tab-btn" data-tab="typo">纠错</button>' +
        '</div>' +
        '<div class="tab-body" id="aiw-tab-body"></div>' +
      '</div>';

    const tabBody = container.querySelector('#aiw-tab-body');
    const tabBtns = container.querySelectorAll('.tab-btn');

    function switchTab(name) {
      for (let i = 0; i < tabBtns.length; i++) {
        tabBtns[i].classList.toggle('active', tabBtns[i].getAttribute('data-tab') === name);
      }
      if (name === 'outline') renderOutlineTab(tabBody, tools.outlineGen);
      else if (name === 'highlight') renderHighlightTab(tabBody, tools.miner);
      else if (name === 'polish') renderPolishTab(tabBody, tools.polisher);
      else if (name === 'typo') renderTypoTab(tabBody, tools.polisher);
    }

    for (let i = 0; i < tabBtns.length; i++) {
      tabBtns[i].addEventListener('click', function () {
        switchTab(this.getAttribute('data-tab'));
      });
    }
    // 默认渲染第一个 Tab
    switchTab('outline');
  }

  // ==================== Tab 1：大纲生成 ====================

  function renderOutlineTab(container, gen) {
    const ctx = getCurrentContext();
    const project = ctx && ctx.project ? ctx.project.name + (ctx.project.subtitle ? ' · ' + ctx.project.subtitle : '') : '（未选择项目）';
    const vol = ctx && ctx.currentVol ? ctx.currentVol : '（未选择）';
    const ch = ctx && ctx.currentCh ? ctx.currentCh : '（未选择）';

    container.innerHTML =
      '<div class="aiw-section">' +
        '<h3>📋 章纲生成（十段模板）</h3>' +
        '<div class="aiw-context-preview">' +
          '<div><strong>当前项目：</strong>' + esc(project) + '</div>' +
          '<div><strong>当前卷：</strong>' + esc(vol) + '　<strong>当前章：</strong>' + esc(ch) + '</div>' +
          '<p class="muted small">将基于项目/卷/角色/世界设定/前情生成单章章纲。</p>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>额外要求（可选）</label>' +
          '<input type="text" class="input" id="aiw-outline-extra" placeholder="如：加打脸爽点、回收 H-017" />' +
        '</div>' +
        '<div class="ai-actions">' +
          '<button class="btn btn-primary" id="aiw-outline-gen">生成章纲</button>' +
          '<button class="btn btn-secondary" id="aiw-outline-save" disabled>💾 保存到大纲库</button>' +
        '</div>' +
        '<div id="aiw-outline-result"></div>' +
      '</div>';

    let lastOutline = null;

    container.querySelector('#aiw-outline-gen').addEventListener('click', async function () {
      const btn = this;
      const resultEl = container.querySelector('#aiw-outline-result');
      btn.disabled = true;
      btn.textContent = '生成中…';
      resultEl.innerHTML = '<span class="muted">正在生成章纲…</span>';
      try {
        const extra = container.querySelector('#aiw-outline-extra').value.trim();
        lastOutline = await gen.generateChapterOutline({
          project: ctx && ctx.project ? ctx.project : null,
          volume: vol,
          characters: '（按当前项目角色自动填充）',
          worldSetting: '（按当前项目世界设定自动填充）',
          previousChapters: '（按前情摘要自动填充）',
          hooks: '（按伏笔表自动填充）',
          extra_requirement: extra || '（无）'
        });
        renderOutlineResult(resultEl, lastOutline);
        container.querySelector('#aiw-outline-save').disabled = false;
        notify('章纲生成完成', 'success');
      } catch (err) {
        resultEl.innerHTML = '<div class="error-page"><p>❌ 生成失败：' + esc(err.message || String(err)) + '</p></div>';
        notify('章纲生成失败：' + (err.message || err), 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '生成章纲';
      }
    });

    container.querySelector('#aiw-outline-save').addEventListener('click', async function () {
      if (!lastOutline) { notify('请先生成章纲', 'warning'); return; }
      const dt = global.DreamTale;
      if (!dt || !dt.storage || !(ctx && ctx.project)) {
        notify('未选择项目或存储未就绪，无法保存', 'warning');
        return;
      }
      try {
        // 收集可能被编辑的字段
        const editable = collectEditedOutline(container, lastOutline);
        // 调用 storage.saveOutline（若存在）；否则降级提示
        if (typeof dt.storage.saveOutline === 'function') {
          await dt.storage.saveOutline(ctx.project.id, editable);
          notify('已保存到大纲库', 'success');
        } else {
          notify('当前存储后端不支持 saveOutline，请手动复制', 'warning');
        }
      } catch (err) {
        notify('保存失败：' + (err.message || err), 'error');
      }
    });
  }

  /** 渲染章纲结果为可编辑表单 */
  function renderOutlineResult(el, outline) {
    el.innerHTML =
      '<div class="aiw-outline-form">' +
        renderField('核心冲突', 'core_conflict', outline.core_conflict, 'textarea') +
        renderField('章节信息', 'chapter_info', JSON.stringify(outline.chapter_info, null, 2), 'textarea') +
        renderField('场景列表', 'scenes', outline.scenes.join('\n'), 'textarea') +
        renderField('出场角色', 'characters', JSON.stringify(outline.characters, null, 2), 'textarea') +
        renderField('伏笔操作', 'hook_ops', JSON.stringify(outline.hook_ops, null, 2), 'textarea') +
        renderField('爽点设计', 'highlights', JSON.stringify(outline.highlights, null, 2), 'textarea') +
        renderField('章末钩子', 'chapter_hook', outline.chapter_hook, 'textarea') +
        renderField('节奏标记', 'rhythm', JSON.stringify(outline.rhythm, null, 2), 'textarea') +
        renderField('上下文召回', 'context_recall', outline.context_recall.join('\n'), 'textarea') +
        renderField('必须遵守-必带', 'must_keep', outline.must_keep.join('\n'), 'textarea') +
        renderField('必须遵守-禁忌', 'must_avoid', outline.must_avoid.join('\n'), 'textarea') +
      '</div>';

    // 标记为可编辑字段，供 collectEditedOutline 收集
    const textareas = el.querySelectorAll('textarea[data-field]');
    for (let i = 0; i < textareas.length; i++) {
      textareas[i].addEventListener('input', function () { this.setAttribute('data-edited', '1'); });
    }
  }

  function renderField(label, field, value, type) {
    if (type === 'textarea') {
      return '<div class="form-group"><label>' + esc(label) + '</label>' +
        '<textarea class="input" data-field="' + esc(field) + '" rows="3" style="width:100%;min-height:60px;">' + esc(value) + '</textarea></div>';
    }
    return '<div class="form-group"><label>' + esc(label) + '</label>' +
      '<input class="input" data-field="' + esc(field) + '" value="' + esc(value) + '" /></div>';
  }

  /** 收集被编辑的字段，合并回 outline 对象 */
  function collectEditedOutline(container, base) {
    const out = JSON.parse(JSON.stringify(base));
    const fields = container.querySelectorAll('[data-field]');
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const key = f.getAttribute('data-field');
      const val = f.value;
      if (f.getAttribute('data-edited') !== '1') continue;
      // JSON 字段尝试解析，失败则保留字符串
      if (key === 'scenes' || key === 'context_recall' || key === 'must_keep' || key === 'must_avoid') {
        out[key] = val.split('\n').filter(function (s) { return s.trim(); });
      } else {
        try { out[key] = JSON.parse(val); } catch (_e) { out[key] = val; }
      }
    }
    return out;
  }

  // ==================== Tab 2：爽点挖掘 ====================

  function renderHighlightTab(container, miner) {
    container.innerHTML =
      '<div class="aiw-section">' +
        '<h3>🔥 爽点挖掘</h3>' +
        '<div class="form-group">' +
          '<label>章节描述/核心冲突</label>' +
          '<textarea class="input" id="aiw-hl-chapter" rows="3" placeholder="如：第1章，主角在拍卖会与反派竞拍玉简"></textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>题材/类型</label>' +
          '<input type="text" class="input" id="aiw-hl-genre" placeholder="玄幻/都市/科幻" value="玄幻" />' +
        '</div>' +
        '<div class="ai-actions">' +
          '<button class="btn btn-primary" id="aiw-hl-mine">挖掘爽点</button>' +
          '<button class="btn btn-secondary" id="aiw-hl-hooks">伏笔回收建议</button>' +
          '<button class="btn btn-secondary" id="aiw-hl-curve">情绪曲线</button>' +
        '</div>' +
        '<div id="aiw-hl-result"></div>' +
      '</div>';

    container.querySelector('#aiw-hl-mine').addEventListener('click', async function () {
      const chapter = container.querySelector('#aiw-hl-chapter').value.trim() || '（未填写）';
      const genre = container.querySelector('#aiw-hl-genre').value.trim() || '玄幻';
      const resultEl = container.querySelector('#aiw-hl-result');
      const btn = this;
      btn.disabled = true; btn.textContent = '挖掘中…';
      try {
        const highlights = await miner.mineHighlights({
          chapter: chapter,
          characters: '（按当前项目角色）',
          genre: genre,
          previousHighlights: '（无）'
        });
        renderHighlightList(resultEl, highlights);
        notify('挖掘到 ' + highlights.length + ' 个爽点', 'success');
      } catch (err) {
        resultEl.innerHTML = '<p>❌ ' + esc(err.message || err) + '</p>';
        notify('挖掘失败', 'error');
      } finally { btn.disabled = false; btn.textContent = '挖掘爽点'; }
    });

    container.querySelector('#aiw-hl-hooks').addEventListener('click', async function () {
      const chapter = container.querySelector('#aiw-hl-chapter').value.trim() || '（未填写）';
      const resultEl = container.querySelector('#aiw-hl-result');
      const btn = this;
      btn.disabled = true; btn.textContent = '分析中…';
      try {
        const suggestions = await miner.suggestHookRecycles({
          chapter: chapter,
          hooks: '（按伏笔表）',
          characters: '（按当前项目角色）'
        });
        resultEl.innerHTML = '<h4>🪝 伏笔回收/新增建议</h4>' + renderHookSuggestions(suggestions);
      } catch (err) {
        resultEl.innerHTML = '<p>❌ ' + esc(err.message || err) + '</p>';
      } finally { btn.disabled = false; btn.textContent = '伏笔回收建议'; }
    });

    container.querySelector('#aiw-hl-curve').addEventListener('click', async function () {
      const chapter = container.querySelector('#aiw-hl-chapter').value.trim() || '（未填写）';
      const resultEl = container.querySelector('#aiw-hl-result');
      const btn = this;
      btn.disabled = true; btn.textContent = '规划中…';
      try {
        const curve = await miner.planEmotionCurve(chapter);
        resultEl.innerHTML = '<h4>📈 情绪曲线</h4>' + renderEmotionCurve(curve);
      } catch (err) {
        resultEl.innerHTML = '<p>❌ ' + esc(err.message || err) + '</p>';
      } finally { btn.disabled = false; btn.textContent = '情绪曲线'; }
    });
  }

  function renderHighlightList(el, highlights) {
    if (!highlights.length) { el.innerHTML = '<p class="muted">未挖掘到爽点</p>'; return; }
    let html = '<h4>✨ 爽点列表</h4><div class="aiw-list">';
    for (let i = 0; i < highlights.length; i++) {
      const h = highlights[i];
      html +=
        '<div class="aiw-item">' +
          '<span class="badge">' + esc(h.type) + '</span> ' +
          '<span class="badge badge-' + (h.strength >= 4 ? 'high' : h.strength >= 3 ? 'mid' : 'low') + '">强度 ' + h.strength + '</span> ' +
          '<span class="badge">' + esc(h.chapter_position) + '</span>' +
          '<div class="muted small">' + esc(h.description) + '</div>' +
        '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  function renderHookSuggestions(suggestions) {
    if (!suggestions.length) return '<p class="muted">暂无建议</p>';
    let html = '<div class="aiw-list">';
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      html += '<div class="aiw-item">' + esc(JSON.stringify(s)) + '</div>';
    }
    return html + '</div>';
  }

  function renderEmotionCurve(curve) {
    let html =
      '<div><strong>高潮位：</strong>' + esc(curve.climax_position) + '　' +
      '<strong>铺垫位：</strong>' + esc(curve.buildup_position) + '　' +
      '<strong>反转位：</strong>' + esc(curve.twist_position || '无') + '</div>';
    if (curve.curve && curve.curve.length) {
      html += '<div class="aiw-list">';
      for (let i = 0; i < curve.curve.length; i++) {
        const p = curve.curve[i];
        html += '<div class="aiw-item"><strong>' + esc(p.position) + '</strong> ' + esc(p.emotion) + ' (强度 ' + p.intensity + ')</div>';
      }
      html += '</div>';
    }
    return html;
  }

  // ==================== Tab 3：润色 ====================

  function renderPolishTab(container, polisher) {
    container.innerHTML =
      '<div class="aiw-section">' +
        '<h3>✨ 文本润色</h3>' +
        '<div class="form-group">' +
          '<label>待润色文本（或从当前章节加载）</label>' +
          '<textarea class="input" id="aiw-polish-input" rows="8" style="width:100%;min-height:160px;" placeholder="粘贴或输入正文段落…"></textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>润色级别</label>' +
          '<select class="input" id="aiw-polish-level">' +
            '<option value="light">轻度（仅修语病，改动≤10%）</option>' +
            '<option value="medium" selected>中度（优化句式，改动≤30%）</option>' +
            '<option value="deep">深度（重写段落，改动≤50%）</option>' +
          '</select>' +
        '</div>' +
        '<div class="ai-actions">' +
          '<button class="btn btn-primary" id="aiw-polish-run">润色</button>' +
          '<button class="btn btn-secondary" id="aiw-polish-aitaste">去 AI 味</button>' +
          '<button class="btn btn-ghost" id="aiw-polish-replace" disabled>一键替换正文</button>' +
        '</div>' +
        '<div id="aiw-polish-result"></div>' +
      '</div>';

    let lastPolished = '';

    container.querySelector('#aiw-polish-run').addEventListener('click', async function () {
      const text = container.querySelector('#aiw-polish-input').value;
      const level = container.querySelector('#aiw-polish-level').value;
      const resultEl = container.querySelector('#aiw-polish-result');
      if (!text.trim()) { notify('请输入待润色文本', 'warning'); return; }
      const btn = this;
      btn.disabled = true; btn.textContent = '润色中…';
      try {
        lastPolished = await polisher.polish(text, level);
        renderPolishCompare(resultEl, text, lastPolished);
        container.querySelector('#aiw-polish-replace').disabled = false;
        notify('润色完成', 'success');
      } catch (err) {
        resultEl.innerHTML = '<p>❌ ' + esc(err.message || err) + '</p>';
      } finally { btn.disabled = false; btn.textContent = '润色'; }
    });

    container.querySelector('#aiw-polish-aitaste').addEventListener('click', async function () {
      const text = container.querySelector('#aiw-polish-input').value;
      const resultEl = container.querySelector('#aiw-polish-result');
      if (!text.trim()) { notify('请输入文本', 'warning'); return; }
      const btn = this;
      btn.disabled = true; btn.textContent = '优化中…';
      try {
        lastPolished = await polisher.removeAITaste(text);
        renderPolishCompare(resultEl, text, lastPolished);
        container.querySelector('#aiw-polish-replace').disabled = false;
        notify('去 AI 味完成', 'success');
      } catch (err) {
        resultEl.innerHTML = '<p>❌ ' + esc(err.message || err) + '</p>';
      } finally { btn.disabled = false; btn.textContent = '去 AI 味'; }
    });

    container.querySelector('#aiw-polish-replace').addEventListener('click', async function () {
      if (!lastPolished) { notify('请先润色', 'warning'); return; }
      const dt = global.DreamTale;
      if (!dt || !dt.state || !dt.state.editor) {
        // 降级：写回输入框
        container.querySelector('#aiw-polish-input').value = lastPolished;
        notify('已写回输入框（未检测到编辑器实例）', 'info');
        return;
      }
      try {
        if (typeof dt.state.editor.setContent === 'function') {
          dt.state.editor.setContent(lastPolished);
          notify('已替换编辑器正文', 'success');
        } else {
          container.querySelector('#aiw-polish-input').value = lastPolished;
          notify('编辑器不支持 setContent，已写回输入框', 'info');
        }
      } catch (err) {
        notify('替换失败：' + (err.message || err), 'error');
      }
    });
  }

  function renderPolishCompare(el, original, polished) {
    el.innerHTML =
      '<div class="aiw-compare">' +
        '<div class="aiw-compare-col"><h4>原文</h4><pre class="aiw-pre">' + esc(original) + '</pre></div>' +
        '<div class="aiw-compare-col"><h4>润色后</h4><pre class="aiw-pre">' + esc(polished) + '</pre></div>' +
      '</div>';
  }

  // ==================== Tab 4：纠错 ====================

  function renderTypoTab(container, polisher) {
    container.innerHTML =
      '<div class="aiw-section">' +
        '<h3>🔍 错别字检查</h3>' +
        '<div class="form-group">' +
          '<label>待检查文本</label>' +
          '<textarea class="input" id="aiw-typo-input" rows="8" style="width:100%;min-height:160px;" placeholder="粘贴或输入正文…"></textarea>' +
        '</div>' +
        '<div class="ai-actions">' +
          '<button class="btn btn-primary" id="aiw-typo-run">检查</button>' +
          '<button class="btn btn-secondary" id="aiw-typo-accept-all" disabled>全部采纳</button>' +
        '</div>' +
        '<div id="aiw-typo-result"></div>' +
      '</div>';

    let lastErrors = [];

    container.querySelector('#aiw-typo-run').addEventListener('click', async function () {
      const text = container.querySelector('#aiw-typo-input').value;
      const resultEl = container.querySelector('#aiw-typo-result');
      if (!text.trim()) { notify('请输入待检查文本', 'warning'); return; }
      const btn = this;
      btn.disabled = true; btn.textContent = '检查中…';
      try {
        lastErrors = await polisher.checkTypos(text);
        renderTypoList(resultEl, lastErrors, container.querySelector('#aiw-typo-input'));
        container.querySelector('#aiw-typo-accept-all').disabled = lastErrors.length === 0;
        notify('发现 ' + lastErrors.length + ' 处问题', lastErrors.length ? 'warning' : 'success');
      } catch (err) {
        resultEl.innerHTML = '<p>❌ ' + esc(err.message || err) + '</p>';
      } finally { btn.disabled = false; btn.textContent = '检查'; }
    });

    container.querySelector('#aiw-typo-accept-all').addEventListener('click', function () {
      if (!lastErrors.length) return;
      const input = container.querySelector('#aiw-typo-input');
      let text = input.value;
      for (let i = 0; i < lastErrors.length; i++) {
        const e = lastErrors[i];
        if (e.original && e.suggestion && e.suggestion !== '待人工确认') {
          text = text.split(e.original).join(e.suggestion);
        }
      }
      input.value = text;
      notify('已全部采纳', 'success');
      container.querySelector('#aiw-typo-result').innerHTML = '<p class="muted">已应用到输入框</p>';
    });
  }

  function renderTypoList(el, errors, inputEl) {
    if (!errors.length) { el.innerHTML = '<p class="muted">✅ 未发现问题</p>'; return; }
    let html = '<h4>发现 ' + errors.length + ' 处问题</h4><div class="aiw-list">';
    for (let i = 0; i < errors.length; i++) {
      const e = errors[i];
      const idx = i;
      html +=
        '<div class="aiw-item">' +
          '<span class="badge">' + esc(e.type) + '</span> ' +
          '<span class="muted small">行 ' + e.line + '</span> ' +
          '<span class="typo-orig">' + esc(e.original) + '</span> → ' +
          '<span class="typo-sug">' + esc(e.suggestion) + '</span> ' +
          '<button class="btn btn-ghost btn-sm" data-idx="' + idx + '">采纳</button>' +
        '</div>';
    }
    html += '</div>';
    el.innerHTML = html;

    const btns = el.querySelectorAll('button[data-idx]');
    for (let i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        const idx = Number(this.getAttribute('data-idx'));
        const e = errors[idx];
        if (e.original && e.suggestion && e.suggestion !== '待人工确认') {
          inputEl.value = inputEl.value.split(e.original).join(e.suggestion);
          notify('已采纳：' + e.original + ' → ' + e.suggestion, 'success');
          this.disabled = true;
          this.textContent = '已采纳';
        } else {
          notify('该条建议需人工确认', 'info');
        }
      });
    }
  }

  NS.renderAIWriter = renderAIWriter;
  // 路由器兼容别名：app.js 用 'render' + capitalize(viewName) 查找，
  // view='aiWriter' → 'renderAiWriter'，故补一个首字母小写 i 的别名
  NS.renderAiWriter = renderAIWriter;
})(window);
