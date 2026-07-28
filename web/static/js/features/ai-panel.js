/**
 * DreamTale · AI 配置面板
 *
 * 提供 AI 适配器的配置 UI：
 * - 接入方式选择（API Key / IDE / Mock 测试）
 * - API Key 模式：apiKey / baseUrl / model 输入框
 * - IDE 模式：显示检测到的 IDE 类型
 * - 连接测试按钮（调 isAvailable）
 * - 清除配置按钮
 * - AI 不可用时显示提示
 *
 * 通过 window.DreamTaleFeatures.renderAIPanel(container) 挂载。
 *
 * 依赖（由 app.js 全局注入）：
 *   - window.DreamTale.notify / modules
 *   - window.DreamTale.modules.ai（首次访问时动态 import 注入）
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------

  function DT() {
    if (!global.DreamTale) throw new Error('[ai-panel] window.DreamTale 未初始化');
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

  /** 检测当前 IDE 环境类型，无 IDE 返回 null */
  function detectIDEType() {
    if (typeof window === 'undefined') return null;
    if (window.__TRAE_IDE__) return 'trae';
    if (window.__WORKBUDDY__) return 'workbuddy';
    return null;
  }

  /** 懒加载 AI 适配层 ES Module，并缓存到 DreamTale.modules.ai */
  async function loadAI() {
    if (global.DreamTale && global.DreamTale.modules && global.DreamTale.modules.ai) {
      return global.DreamTale.modules.ai;
    }
    const ai = await import('../../src/ai/index.js');
    if (global.DreamTale) {
      if (!global.DreamTale.modules) global.DreamTale.modules = {};
      global.DreamTale.modules.ai = ai;
    }
    return ai;
  }

  function renderStatusBadge(enabled) {
    return enabled
      ? '<span class="ai-badge ai-badge-on">● AI 已启用</span>'
      : '<span class="ai-badge ai-badge-off">○ AI 未启用</span>';
  }

  // ---------- 主渲染入口 ----------

  /**
   * 渲染 AI 配置面板
   * @param {HTMLElement} container
   */
  async function renderAIPanel(container) {
    if (!container) throw new Error('[ai-panel] container 不能为空');
    container.innerHTML = '<div class="loading">正在加载 AI 配置面板…</div>';

    let ai;
    try {
      ai = await loadAI();
    } catch (err) {
      container.innerHTML =
        '<div class="error-page">' +
          '<h2>⚠ AI 模块加载失败</h2>' +
          '<p>DreamTale 需要通过本地 HTTP 服务器访问以加载 AI 模块。</p>' +
          '<p class="error-detail">' + esc(err.message || String(err)) + '</p>' +
        '</div>';
      return;
    }

    const ConfigManager = ai.ConfigManager;
    // 优先复用 app.js 已初始化的 ConfigManager（保证与顶栏状态同步）；否则自建
    let configMgr = null;
    try {
      configMgr = DT().aiConfig;
    } catch (_e) { /* DreamTale 未初始化，下面兜底 */ }
    if (!configMgr) configMgr = new ConfigManager();

    // 渲染初始表单
    renderForm(container, configMgr, ai);

    // 订阅配置变更：同步顶栏 AI 状态指示器
    configMgr.onConfigChange(function (newConfig) {
      updateTopbarAIStatus(newConfig);
    });
  }

  /** 根据配置更新顶栏 AI 状态指示器 */
  function updateTopbarAIStatus(config) {
    const el = document.getElementById('ai-status');
    if (!el) return;
    const enabled = !!(config && (config.apiKey || config.mode === 'ide' || config.mode === 'mock'));
    el.classList.toggle('offline', !enabled);
    el.classList.toggle('online', enabled);
    const text = el.querySelector('.text');
    if (text) text.textContent = enabled ? 'AI 在线' : 'AI 离线';
  }

  function renderForm(container, configMgr, ai) {
    const config = configMgr.getConfig();
    const enabled = configMgr.isAIEnabled();
    const ideType = detectIDEType();

    container.innerHTML =
      '<div class="ai-panel">' +
        '<div class="page-header">' +
          '<h2>🤖 AI 配置</h2>' +
          '<div class="page-header-actions">' + renderStatusBadge(enabled) + '</div>' +
        '</div>' +
        (enabled ? '' :
          '<div class="ai-hint-card">' +
            '<p>AI 功能未启用，配置后可解锁 AI 辅助能力。</p>' +
            '<p class="muted">配置仅保存在本地浏览器（localStorage），不会上传到服务器。</p>' +
          '</div>'
        ) +
        '<div class="ai-form">' +
          '<div class="form-group">' +
            '<label>接入方式</label>' +
            '<select id="ai-mode" class="input">' +
              '<option value="">— 未选择 —</option>' +
              '<option value="api-key"' + (config.mode === 'api-key' ? ' selected' : '') + '>API Key（OpenAI 协议兼容）</option>' +
              '<option value="ide"' + (config.mode === 'ide' ? ' selected' : '') + '>IDE 内置 AI' + (ideType ? '（检测到：' + esc(ideType) + '）' : '（未检测到 IDE）') + '</option>' +
              '<option value="mock"' + (config.mode === 'mock' ? ' selected' : '') + '>Mock 测试（不触网）</option>' +
            '</select>' +
          '</div>' +
          '<div id="ai-apikey-fields" style="display: ' + (config.mode === 'api-key' ? 'block' : 'none') + ';">' +
            '<div class="form-group">' +
              '<label>API Key</label>' +
              '<input type="password" id="ai-apikey" class="input" placeholder="sk-..." value="' + esc(config.apiKey || '') + '" autocomplete="off" />' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Base URL（可选，用于智谱/DeepSeek/通义/豆包等）</label>' +
              '<input type="text" id="ai-baseurl" class="input" placeholder="https://api.openai.com/v1" value="' + esc(config.baseUrl || '') + '" />' +
            '</div>' +
            '<div class="form-group">' +
              '<label>模型名称</label>' +
              '<input type="text" id="ai-model" class="input" placeholder="gpt-3.5-turbo" value="' + esc(config.model || '') + '" />' +
            '</div>' +
          '</div>' +
          '<div id="ai-ide-fields" style="display: ' + (config.mode === 'ide' ? 'block' : 'none') + ';">' +
            '<div class="form-group">' +
              '<label>检测到的 IDE</label>' +
              '<input type="text" class="input" value="' + esc(ideType || '未检测到') + '" readonly />' +
              '<p class="muted small">阶段2 为占位实现，阶段5 将深度对接 IDE Skills。</p>' +
            '</div>' +
          '</div>' +
          '<div id="ai-mock-fields" style="display: ' + (config.mode === 'mock' ? 'block' : 'none') + ';">' +
            '<p class="muted small">Mock 适配器：返回固定 fixture，不触网，用于测试与演示。</p>' +
          '</div>' +
          '<div class="ai-actions">' +
            '<button class="btn btn-primary" id="ai-save">💾 保存配置</button>' +
            '<button class="btn btn-secondary" id="ai-test">🔌 连接测试</button>' +
            '<button class="btn btn-ghost" id="ai-clear">🗑 清除配置</button>' +
          '</div>' +
          '<div id="ai-test-result" class="ai-test-result"></div>' +
        '</div>' +
      '</div>';

    bindEvents(container, configMgr, ai);
  }

  function bindEvents(container, configMgr, ai) {
    const modeSel = container.querySelector('#ai-mode');
    const apikeyFields = container.querySelector('#ai-apikey-fields');
    const ideFields = container.querySelector('#ai-ide-fields');
    const mockFields = container.querySelector('#ai-mock-fields');

    modeSel.addEventListener('change', function (e) {
      const v = e.target.value;
      apikeyFields.style.display = v === 'api-key' ? 'block' : 'none';
      ideFields.style.display = v === 'ide' ? 'block' : 'none';
      mockFields.style.display = v === 'mock' ? 'block' : 'none';
    });

    container.querySelector('#ai-save').addEventListener('click', function () {
      const mode = modeSel.value;
      const partial = { mode: mode };
      if (mode === 'api-key') {
        partial.apiKey = (container.querySelector('#ai-apikey').value || '').trim();
        partial.baseUrl = (container.querySelector('#ai-baseurl').value || '').trim();
        partial.model = (container.querySelector('#ai-model').value || '').trim();
        if (!partial.apiKey) {
          DT().notify('请填写 API Key', 'warning');
          return;
        }
      } else if (mode === 'ide') {
        partial.ideType = detectIDEType() || '';
      }
      try {
        configMgr.setConfig(partial);
        DT().notify('AI 配置已保存', 'success');
        // 重新渲染表单以同步状态徽章
        renderForm(container, configMgr, ai);
      } catch (err) {
        DT().notify('保存失败：' + (err.message || err), 'error');
      }
    });

    container.querySelector('#ai-test').addEventListener('click', async function () {
      const btn = this;
      const resultEl = container.querySelector('#ai-test-result');
      btn.disabled = true;
      btn.textContent = '测试中…';
      resultEl.innerHTML = '<span class="muted">正在测试连接…</span>';
      try {
        const cfg = configMgr.getConfig();
        if (!cfg.mode) throw new Error('请先选择接入方式并保存');
        const adapter = ai.createAIAdapter(cfg);
        const ok = await adapter.isAvailable();
        if (ok) {
          resultEl.innerHTML = '<span class="ai-test-ok">✓ 连接成功（' + esc(adapter.getName()) + '）</span>';
        } else {
          resultEl.innerHTML = '<span class="ai-test-fail">✗ 连接失败：适配器报告不可用</span>';
        }
      } catch (err) {
        resultEl.innerHTML = '<span class="ai-test-fail">✗ 测试失败：' + esc(err.message || String(err)) + '</span>';
      } finally {
        btn.disabled = false;
        btn.textContent = '🔌 连接测试';
      }
    });

    container.querySelector('#ai-clear').addEventListener('click', function () {
      if (!confirm('确定清除全部 AI 配置吗？')) return;
      configMgr.clearConfig();
      DT().notify('AI 配置已清除', 'info');
      renderForm(container, configMgr, ai);
    });
  }

  NS.renderAIPanel = renderAIPanel;
})(window);
