/**
 * DreamTale · 应用主框架（app.js）
 *
 * 设计要点：
 * - 经典 `<script>` 加载（非 ES Module），IIFE + window.DreamTale 命名空间
 * - 内部用动态 import() 加载 core/storage/editor/reader 等 ES Module 依赖
 *   · http://localhost 下完全正常
 *   · file:// 下 import 会失败（CORS），捕获后显示「请通过 server.py 启动」提示
 * - 离线可用：无 CDN 依赖，所有资源本地
 *
 * 职责：
 * - 初始化存储后端（createStorage）
 * - 全局状态管理：state = { currentProject, currentVol, currentCh, theme, storageMode }
 * - 路由：hash 路由（#/projects, #/settings, #/outline, #/chapters, #/hooks, #/reader）
 * - 渲染分发：动态 import features/*.js，失败显示「正在加载中」占位
 * - 主题切换：setTheme(theme) 同步到 editor + reader + 全局
 * - 自动保存调度：监听编辑器 onChange，防抖 1500ms 调 storage.saveChapter
 * - 项目切换：切换 currentProject 后刷新所有视图
 * - 导入导出：调 storage.exportVault/importVault
 * - 启动流程：检测是否有项目 → 有则加载最近项目 → 无则显示欢迎页
 *
 * 暴露 API（window.DreamTale）：
 *   - state           全局状态
 *   - storage         IStorageBackend 实例
 *   - router          { navigate(route), current() }
 *   - theme           { set(theme), get(), toggle() }
 *   - notify(msg, type)  toast 通知
 *   - renderView(viewName, params)  渲染指定视图
 *   - modules         已加载的 ES Module 依赖（models/vaultSchema/markdown/storage/editor/reader）
 *   - switchProject(projectId)  切换项目
 *   - exportVault() / importVault(file)  导入导出
 *   - scheduleAutoSave(chapter)  调度自动保存
 */
(function () {
  'use strict';

  // ============ 常量 ============
  var STORAGE_KEY_THEME = 'dreamtale:theme';
  var STORAGE_KEY_LAST_PROJECT = 'dreamtale:lastProject';
  var AUTO_SAVE_DEBOUNCE_MS = 1500;

  /** 路由表：hash → { view, label } */
  var ROUTES = {
    '#/projects': { view: 'projects', label: '作品' },
    '#/settings': { view: 'settings', label: '设定' },
    '#/encyclopedia': { view: 'encyclopedia', label: '设定百科' },
    '#/outline':  { view: 'outline',  label: '大纲' },
    '#/chapters': { view: 'chapters', label: '章节' },
    '#/hooks':    { view: 'hooks',    label: '伏笔' },
    '#/reader':   { view: 'reader',   label: '阅读' },
    '#/ai-panel':  { view: 'aiPanel',  label: 'AI 配置' },
    '#/ai-writer': { view: 'aiWriter', label: 'AI 写作' },
    '#/hotspots':     { view: 'hotspots',     label: '热点' },
    '#/inspirations': { view: 'inspirations', label: '灵感库' },
    '#/audit': { view: 'audit', label: '审计' },
    '#/trae':  { view: 'traeIntegration', label: 'Trae 集成' }
  };

  /** 合法主题 */
  var VALID_THEMES = ['dark', 'light', 'sepia'];
  /** 默认主题：护眼米黄 */
  var DEFAULT_THEME = 'sepia';
  /** 主题切换顺序 */
  var THEME_ORDER = ['sepia', 'light', 'dark'];
  /** 主题图标 */
  var THEME_ICON = { sepia: '🎨', light: '☀️', dark: '🌙' };

  // ============ 全局状态 ============
  var state = {
    currentProject: null,    // 当前 Project 实例
    currentVol: null,        // 当前卷号
    currentCh: null,         // 当前章号
    theme: DEFAULT_THEME,    // 当前主题
    storageMode: 'auto',     // 'auto' | 'indexeddb' | 'fsaccess'
    storage: null,           // IStorageBackend 实例
    editor: null,            // 当前编辑器实例（章节视图时）
    reader: null,            // 当前阅读器实例（阅读视图时）
    modulesLoaded: false,    // ES Module 依赖是否加载成功
    projects: []             // 项目列表缓存（顶栏切换器用）
  };

  // ============ 已加载的 ES Module 依赖 ============
  var _modules = null;

  /** AI 适配器实例（可能为 null，未配置/未启用时） */
  var _ai = null;
  /** AI 配置管理器实例（可能为 null，AI 模块未加载时） */
  var _aiConfigMgr = null;

  /**
   * 动态加载 ES Module 依赖（core/storage/editor/reader/ai）。
   * file:// 下会失败（CORS），http://localhost 下正常。
   * AI 适配层加载失败不阻断主流程（core/storage 是核心，AI 是增强）。
   * @returns {Promise<Object>}
   */
  function loadModules() {
    if (_modules) return Promise.resolve(_modules);
    // 用相对路径（相对于 app.js 所在的 static/js/ 目录）
    return Promise.all([
      import('../../src/core/models.js'),
      import('../../src/core/vault-schema.js'),
      import('../../src/core/markdown.js'),
      import('../../src/storage/factory.js'),
      import('./editor.js'),
      import('./reader.js'),
      // AI 适配层：失败不阻断主流程
      import('../../src/ai/index.js').catch(function (err) {
        console.warn('[DreamTale] AI 适配层加载失败（AI 功能将不可用）:', err);
        return null;
      })
    ]).then(function (results) {
      _modules = {
        models: results[0],
        vaultSchema: results[1],
        markdown: results[2],
        storage: results[3],
        editor: results[4],
        reader: results[5],
        ai: results[6]
      };
      state.modulesLoaded = true;
      return _modules;
    }).catch(function (err) {
      console.error('[DreamTale] 模块加载失败：', err);
      throw err;
    });
  }

  // ============ 主题管理 ============
  var theme = {
    /** 获取当前主题 */
    get: function () { return state.theme; },

    /** 设置主题，同步到 html/body/editor/reader，并持久化到 localStorage */
    set: function (t) {
      if (VALID_THEMES.indexOf(t) === -1) return;
      state.theme = t;
      document.documentElement.setAttribute('data-theme', t);
      document.body.setAttribute('data-theme', t);
      try { localStorage.setItem(STORAGE_KEY_THEME, t); } catch (e) {}
      // 同步到 editor + reader 实例
      if (state.editor && typeof state.editor.setTheme === 'function') {
        try { state.editor.setTheme(t); } catch (e) {}
      }
      if (state.reader && typeof state.reader.setTheme === 'function') {
        try { state.reader.setTheme(t); } catch (e) {}
      }
      // 更新主题按钮图标
      var themeBtn = document.getElementById('btn-theme');
      if (themeBtn) themeBtn.textContent = THEME_ICON[t] || '🎨';
    },

    /** 循环切换主题：sepia → light → dark → sepia */
    toggle: function () {
      var idx = THEME_ORDER.indexOf(state.theme);
      var next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      this.set(next);
      notify('已切换主题：' + next, 'info', 1500);
    }
  };

  // ============ 通知 toast ============
  /**
   * 显示 toast 通知
   * @param {string} msg 消息内容
   * @param {'info'|'success'|'warning'|'error'} [type='info'] 类型
   * @param {number} [duration=3000] 自动消失时长（ms）
   */
  function notify(msg, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = msg;
    container.appendChild(toast);
    // 触发出现动画
    requestAnimationFrame(function () { toast.classList.add('show'); });
    // 自动消失
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, duration);
  }

  // ============ 路由 ============
  var router = {
    /** 获取当前路由 hash */
    current: function () {
      return location.hash || '#/projects';
    },

    /** 跳转到指定路由 */
    navigate: function (route) {
      if (!ROUTES[route]) route = '#/projects';
      if (location.hash !== route) {
        location.hash = route;
      } else {
        // 已在当前路由，手动触发渲染
        handleRoute();
      }
    }
  };

  /** 处理 hash 变化，渲染对应视图 */
  function handleRoute() {
    var hash = router.current();
    var routeInfo = ROUTES[hash] || ROUTES['#/projects'];

    // 高亮侧边栏当前项
    var navItems = document.querySelectorAll('.nav-item');
    for (var i = 0; i < navItems.length; i++) {
      var el = navItems[i];
      if (el.getAttribute('data-route') === hash) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }

    // 移动端：路由变化后自动收起抽屉
    closeSidebarDrawer();

    // 渲染对应视图
    renderView(routeInfo.view);
  }

  // ============ 渲染分发 ============
  /**
   * 渲染指定视图
   * @param {string} viewName 视图名（projects/settings/outline/chapters/hooks/reader）
   * @param {object} [params] 额外参数
   */
  function renderView(viewName, params) {
    var view = document.getElementById('app-view');
    if (!view) return;

    // 销毁上一个编辑器/阅读器实例
    cleanupInstances();

    // 显示加载中
    view.innerHTML = '<div class="loading">加载中…</div>';

    // 确保模块已加载
    if (!state.modulesLoaded) {
      loadModules().then(function () {
        _renderViewInternal(view, viewName, params);
      }).catch(function (err) {
        renderModuleLoadError(view, err);
      });
    } else {
      _renderViewInternal(view, viewName, params);
    }
  }

  function _renderViewInternal(view, viewName, params) {
    // features/*.js 用经典 script IIFE 模式，挂载到 window.DreamTaleFeatures
    // 在 index.html 中通过 <script defer> 预加载，此处直接调用
    var features = window.DreamTaleFeatures;
    var renderFnName = 'render' + capitalize(viewName);
    var renderFn = features && features[renderFnName];

    if (typeof renderFn !== 'function') {
      console.warn('[DreamTale] 功能模块未就绪：', viewName, 'expected', renderFnName);
      renderFeatureLoading(view, viewName, new Error('功能模块 ' + renderFnName + ' 未加载'));
      return;
    }

    try {
      // 调用渲染函数，传入容器、参数、全局 API
      renderFn(view, params, window.DreamTale);
    } catch (err) {
      console.error('[DreamTale] 功能模块渲染异常：', viewName, err);
      renderFeatureLoading(view, viewName, err);
    }
  }

  /** 首字母大写 */
  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** 渲染模块加载失败提示（file:// 双击打开时会看到这个） */
  function renderModuleLoadError(view, err) {
    view.innerHTML =
      '<div class="error-page">' +
        '<h2>⚠ 模块加载失败</h2>' +
        '<p>DreamTale 需要通过本地 HTTP 服务器访问以加载 ES Module 依赖。</p>' +
        '<p>原因：file:// 协议下浏览器会拒绝 ES Module 的 import（CORS 限制）。</p>' +
        '<p class="error-detail">' + escapeHtml(err.message || String(err)) + '</p>' +
        '<h3 style="margin-top:20px;">启动方式：</h3>' +
        '<pre>cd /workspace/web\npython3 -m http.server 8000\n\n# 然后浏览器访问：\n# http://localhost:8000/</pre>' +
        '<p class="hint">提示：所有依赖均为本地文件，无 CDN 依赖，离线可用。</p>' +
      '</div>';
  }

  /** 渲染功能模块正在加载占位（features/*.js 尚未由另一个 Agent 创建时） */
  function renderFeatureLoading(view, name, err) {
    view.innerHTML =
      '<div class="feature-loading">' +
        '<h2>「' + name + '」功能正在加载中</h2>' +
        '<p>该功能模块尚未实现或加载失败。</p>' +
        '<p>另一个 Agent 可能正在并行创建此模块，请稍后刷新。</p>' +
        '<p class="error-detail">' + escapeHtml(err.message || String(err)) + '</p>' +
        '<button class="btn btn-secondary mt-16" onclick="location.reload()">刷新重试</button>' +
      '</div>';
  }

  /** HTML 转义 */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /** 销毁当前编辑器/阅读器实例 */
  function cleanupInstances() {
    if (state.editor) {
      try { state.editor.destroy(); } catch (e) {}
      state.editor = null;
    }
    if (state.reader) {
      try { state.reader.destroy(); } catch (e) {}
      state.reader = null;
    }
  }

  // ============ 自动保存调度 ============
  var _autoSaveTimer = null;

  /**
   * 调度自动保存章节（防抖 1500ms）
   * 功能模块的编辑器 onChange 回调应调用此函数
   * @param {object} chapter Chapter 实例
   */
  function scheduleAutoSave(chapter) {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(function () {
      if (!state.storage || !state.currentProject || !chapter) return;
      Promise.resolve(state.storage.saveChapter(state.currentProject.id, chapter))
        .then(function () {
          notify('已自动保存', 'success', 1500);
        })
        .catch(function (err) {
          console.error('[DreamTale] 自动保存失败：', err);
          notify('自动保存失败：' + (err.message || err), 'error', 4000);
        });
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  // ============ 项目切换 ============
  /**
   * 切换当前项目
   * @param {string} projectId 项目 ID
   */
  function switchProject(projectId) {
    if (!state.storage) {
      notify('存储后端尚未就绪', 'warning');
      return;
    }
    if (!projectId) return;
    return Promise.resolve(state.storage.getProject(projectId)).then(function (project) {
      state.currentProject = project;
      state.currentVol = null;
      state.currentCh = null;
      try { localStorage.setItem(STORAGE_KEY_LAST_PROJECT, projectId); } catch (e) {}
      // 更新顶栏项目选择器
      var select = document.getElementById('project-select');
      if (select) select.value = projectId;
      // 刷新当前视图
      handleRoute();
      if (project) notify('已切换到「' + project.name + '」', 'success');
    }).catch(function (err) {
      console.error('[DreamTale] 切换项目失败：', err);
      notify('切换项目失败：' + (err.message || err), 'error');
    });
  }

  /** 刷新顶栏项目选择器列表 */
  function refreshProjectSelector() {
    var select = document.getElementById('project-select');
    if (!select) return;
    // 清空现有选项
    select.innerHTML = '<option value="">— 未选择 —</option>';
    for (var i = 0; i < state.projects.length; i++) {
      var p = state.projects[i];
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.subtitle ? ' · ' + p.subtitle : '');
      select.appendChild(opt);
    }
    if (state.currentProject) select.value = state.currentProject.id;
  }

  // ============ 导入导出 ============
  /** 导出当前项目 Vault 为 ZIP */
  function exportVault() {
    if (!state.storage) { notify('存储后端尚未就绪', 'warning'); return; }
    if (!state.currentProject) { notify('请先选择一个项目', 'warning'); return; }
    notify('正在导出…', 'info');
    // 确保拿到的是 Project 实例（不是 ID）
    var proj = state.currentProject;
    var projId = typeof proj === 'object' && proj ? proj.id : proj;
    Promise.resolve(state.storage.exportVault(projId)).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var safeName = (proj && proj.name ? proj.name.replace(/[\\/:*?"<>|]/g, '_') : (projId || 'dreamtale'));
      a.download = safeName + '-vault.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify('导出成功', 'success');
    }).catch(function (err) {
      console.error('[DreamTale] 导出失败：', err);
      notify('导出失败：' + (err.message || err), 'error');
    });
  }

  /**
   * 从 ZIP 或 MD 文件导入 Vault
   * @param {File|FileList} files 单个或多个文件（ZIP/MD 混合）
   */
  function importVault(files) {
    if (!state.storage) { notify('存储后端尚未就绪', 'warning'); return; }
    if (!files) return;
    // 兼容单个 File 或 FileList/数组
    var fileArr = [];
    if (files instanceof FileList) {
      for (var i = 0; i < files.length; i++) fileArr.push(files[i]);
    } else if (Array.isArray(files)) {
      fileArr = files;
    } else if (files instanceof File) {
      fileArr = [files];
    }
    if (!fileArr.length) return;

    notify('正在导入 ' + fileArr.length + ' 个文件…', 'info');

    // 分类：ZIP 走 importVault；MD 作为章节导入到当前项目（无当前项目则新建）
    var zipFiles = fileArr.filter(function (f) { return /\.zip$/i.test(f.name); });
    var mdFiles = fileArr.filter(function (f) { return /\.(md|markdown)$/i.test(f.name); });

    var chain = Promise.resolve();
    var lastImportedId = null;

    // 1. 先处理 ZIP（每个 ZIP 独立成项目）
    zipFiles.forEach(function (zip) {
      chain = chain.then(function () {
        return Promise.resolve(state.storage.importVault(zip)).then(function (newId) {
          lastImportedId = newId;
          notify('已导入 ZIP：' + zip.name, 'success');
        });
      });
    });

    // 2. 再处理 MD：把所有 md 文件作为章节导入到同一个目标项目
    if (mdFiles.length > 0) {
      chain = chain.then(function () {
        return importMarkdownFiles(mdFiles).then(function (projId) {
          lastImportedId = projId;
          notify('已导入 ' + mdFiles.length + ' 个 Markdown 章节', 'success');
        });
      });
    }

    chain.then(function () {
      if (lastImportedId) {
        return refreshProjects().then(function () {
          return switchProject(lastImportedId);
        });
      } else {
        return refreshProjects();
      }
    }).then(function () {
      notify('全部导入完成', 'success');
    }).catch(function (err) {
      console.error('[DreamTale] 导入失败：', err);
      notify('导入失败：' + (err.message || err), 'error');
    });
  }

  /**
   * 把一组 MD 文件作为章节导入到项目（复用当前项目，无则新建）
   * @param {File[]} mdFiles
   * @returns {Promise<string>} 项目 id
   */
  function importMarkdownFiles(mdFiles) {
    // 目标项目：有当前项目用当前项目，否则新建
    var targetProjId = state.currentProject && typeof state.currentProject === 'object'
      ? state.currentProject.id
      : (typeof state.currentProject === 'string' ? state.currentProject : null);

    var prepareProj;
    if (targetProjId) {
      prepareProj = Promise.resolve(state.storage.getProject(targetProjId));
    } else {
      var name = mdFiles[0] && mdFiles[0].name
        ? mdFiles[0].name.replace(/\.(md|markdown)$/i, '')
        : '导入的作品';
      if (!_modules) return Promise.reject(new Error('模块尚未加载'));
      var Project = _modules.models.Project;
      var Chapter = _modules.models.Chapter;
      var now = new Date().toISOString();
      var proj = new Project({
        id: 'proj-md-' + Date.now(),
        name: name,
        status: 'draft',
        created_at: now,
        updated: now
      });
      prepareProj = state.storage.saveProject(proj).then(function () { return proj; });
    }

    return prepareProj.then(function (proj) {
      // 顺序读取 MD 文件，每一个作为一章（卷 01，章从 1 开始递增）
      var volNo = '01';
      var chNo = 1;
      var chain = Promise.resolve();
      mdFiles.forEach(function (file) {
        chain = chain.then(function () {
          return readFileAsText(file).then(function (text) {
            if (!_modules) throw new Error('模块尚未加载');
            var Chapter = _modules.models.Chapter;
            // 用 chapterFromMarkdown 解析 frontmatter，解析失败就兜底
            var chapter;
            try {
              chapter = _modules.markdown.chapterFromMarkdown(text);
              // 如解析结果没有 vol_no/ch_no，就按顺序分配
              if (!chapter.vol_no) chapter.vol_no = volNo;
              if (!chapter.ch_no) chapter.ch_no = _modules.models.padCh(chNo);
              // 标题兜底：取文件名
              if (!chapter.title) chapter.title = file.name.replace(/\.(md|markdown)$/i, '');
            } catch (e) {
              chapter = new Chapter({
                vol_no: volNo,
                ch_no: _modules.models.padCh(chNo),
                title: file.name.replace(/\.(md|markdown)$/i, ''),
                content: text,
                status: 'draft'
              });
            }
            chapter.vol_no = typeof chapter.vol_no === 'number'
              ? _modules.models.padVol(chapter.vol_no)
              : (chapter.vol_no || volNo);
            chapter.ch_no = typeof chapter.ch_no === 'number'
              ? _modules.models.padCh(chapter.ch_no)
              : (chapter.ch_no || _modules.models.padCh(chNo));
            if (!chapter.status) chapter.status = 'draft';
            chapter.updated = new Date().toISOString();
            chNo++;
            return state.storage.saveChapter(proj.id, chapter);
          });
        });
      });
      return chain.then(function () { return proj.id; });
    });
  }

  /** File → text，小工具 */
  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  /** 刷新项目列表缓存 + 顶栏选择器 */
  function refreshProjects() {
    if (!state.storage) return Promise.resolve();
    return Promise.resolve(state.storage.listProjects()).then(function (projects) {
      state.projects = projects || [];
      refreshProjectSelector();
      return state.projects;
    });
  }

  // ============ 欢迎页 ============
  function renderWelcome(view) {
    view.innerHTML =
      '<div class="welcome">' +
        '<div class="welcome-card">' +
          '<h1>📖 DreamTale</h1>' +
          '<p class="subtitle">极简 AI 小说创作系统 · 离线优先 · 双模式</p>' +
          '<div class="welcome-actions">' +
            '<button class="btn btn-primary btn-lg" id="btn-open-demo">打开 Demo 项目</button>' +
            '<button class="btn btn-secondary btn-lg" id="btn-new-project">新建空白项目</button>' +
          '</div>' +
          '<div class="welcome-extra">' +
            '<button class="btn btn-ghost btn-sm" id="btn-welcome-import">📂 导入 ZIP / MD</button>' +
            '<input type="file" id="welcome-import-input" accept=".zip,.md,.markdown,application/zip,text/markdown" multiple hidden>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-open-demo').addEventListener('click', openDemo);
    document.getElementById('btn-new-project').addEventListener('click', newBlankProject);
    document.getElementById('btn-welcome-import').addEventListener('click', function () {
      document.getElementById('welcome-import-input').click();
    });
    document.getElementById('welcome-import-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files.length > 0) importVault(e.target.files);
      e.target.value = '';
    });
  }

  /** 创建并打开示例项目 */
  function openDemo() {
    if (!state.storage || !_modules) { notify('存储/模块未就绪', 'warning'); return; }
    var Project = _modules.models.Project;
    var now = new Date().toISOString();
    var demo = new Project({
      id: 'demo-' + Date.now(),
      name: '示例项目：星河序曲',
      subtitle: 'DreamTale 演示',
      genre: '科幻',
      author: 'DreamTale',
      target_words: 100000,
      status: 'draft',
      created_at: now,
      updated: now
    });
    state.storage.saveProject(demo).then(function () {
      return refreshProjects();
    }).then(function () {
      return switchProject(demo.id);
    }).then(function () {
      router.navigate('#/chapters');
    }).catch(function (err) {
      notify('创建 Demo 失败：' + (err.message || err), 'error');
    });
  }

  /** 新建空白项目 */
  function newBlankProject() {
    if (!state.storage || !_modules) { notify('存储/模块未就绪', 'warning'); return; }
    var name = prompt('请输入项目名称：', '我的小说');
    if (!name) return;
    var Project = _modules.models.Project;
    var now = new Date().toISOString();
    var proj = new Project({
      id: 'proj-' + Date.now(),
      name: name,
      status: 'draft',
      created_at: now,
      updated: now
    });
    state.storage.saveProject(proj).then(function () {
      return refreshProjects();
    }).then(function () {
      return switchProject(proj.id);
    }).then(function () {
      router.navigate('#/outline');
    }).catch(function (err) {
      notify('创建项目失败：' + (err.message || err), 'error');
    });
  }

  // ============ 启动流程 ============
  function boot() {
    // 1. 恢复主题
    var savedTheme = DEFAULT_THEME;
    try { savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || DEFAULT_THEME; } catch (e) {}
    theme.set(savedTheme);

    // 2. 绑定顶栏/侧边栏事件
    bindTopbarEvents();
    bindSidebarEvents();
    bindSidebarDrawerEvents();

    // 3. 路由监听
    window.addEventListener('hashchange', handleRoute);

    // 4. 加载 ES Module 依赖
    loadModules().then(function () {
      // 4.5 初始化 AI 适配层（不阻断主流程）
      initAI();
      // 5. 初始化存储后端
      return _modules.storage.createStorage({ prefer: state.storageMode });
    }).then(function (storage) {
      state.storage = storage;
      // 更新存储模式标签
      var label = document.getElementById('storage-mode-label');
      if (label) label.textContent = '存储：' + (storage.name || state.storageMode);

      // 6. 加载项目列表
      return refreshProjects();
    }).then(function () {
      // 7. 检测是否有项目，决定显示欢迎页还是最近项目
      if (state.projects.length > 0) {
        var lastId = null;
        try { lastId = localStorage.getItem(STORAGE_KEY_LAST_PROJECT); } catch (e) {}
        var target = null;
        if (lastId) {
          for (var i = 0; i < state.projects.length; i++) {
            if (state.projects[i].id === lastId) { target = state.projects[i]; break; }
          }
        }
        if (!target) target = state.projects[0];
        return switchProject(target.id).then(function () {
          // 如果没有 hash，默认去 chapters；否则按 hash 渲染
          if (!location.hash) router.navigate('#/chapters');
          else handleRoute();
        });
      } else {
        // 无项目：显示欢迎页
        renderWelcome(document.getElementById('app-view'));
      }
    }).catch(function (err) {
      console.error('[DreamTale] 启动失败：', err);
      renderModuleLoadError(document.getElementById('app-view'), err);
    });
  }

  // ============ AI 适配层初始化 ============
  /**
   * 初始化 AI 适配层：
   * - 构造 ConfigManager 读取本地配置
   * - 根据配置创建适配器实例（_ai）
   * - 订阅配置变更：自动重建适配器 + 更新顶栏 AI 状态
   * - 更新顶栏 AI 状态指示器
   * AI 模块未加载时静默降级（_ai 保持 null）。
   */
  function initAI() {
    if (!_modules || !_modules.ai) {
      updateAIStatusIndicator(false);
      return;
    }
    try {
      var ConfigManager = _modules.ai.ConfigManager;
      _aiConfigMgr = new ConfigManager();
      // 根据当前配置构造适配器（未配置 mode 时为 mock 兜底，但 isAIEnabled 仍为 false）
      rebuildAIAdapter();
      // 订阅配置变更
      _aiConfigMgr.onConfigChange(function () {
        rebuildAIAdapter();
        updateAIStatusIndicator(_aiConfigMgr && _aiConfigMgr.isAIEnabled());
      });
      // 初始化顶栏状态
      updateAIStatusIndicator(_aiConfigMgr.isAIEnabled());
    } catch (err) {
      console.warn('[DreamTale] AI 适配层初始化失败（AI 功能将不可用）:', err);
      _ai = null;
      _aiConfigMgr = null;
      updateAIStatusIndicator(false);
    }
  }

  /** 根据当前配置重建 AI 适配器实例 */
  function rebuildAIAdapter() {
    if (!_aiConfigMgr || !_modules || !_modules.ai) {
      _ai = null;
      return;
    }
    var cfg = _aiConfigMgr.getConfig();
    // 未配置 mode → 不创建实例（_ai 保持 null，业务层据此隐藏 AI 入口）
    if (!cfg.mode) {
      _ai = null;
      return;
    }
    try {
      _ai = _modules.ai.createAIAdapter(cfg);
    } catch (err) {
      console.warn('[DreamTale] AI 适配器创建失败:', err);
      _ai = null;
    }
  }

  /**
   * 更新顶栏 AI 状态指示器
   * @param {boolean} enabled 是否启用
   */
  function updateAIStatusIndicator(enabled) {
    var el = document.getElementById('ai-status');
    if (!el) return;
    el.classList.toggle('offline', !enabled);
    el.classList.toggle('online', !!enabled);
    var text = el.querySelector('.text');
    if (text) text.textContent = enabled ? 'AI 在线' : 'AI 离线';
  }

  /** 绑定顶栏事件 */
  function bindTopbarEvents() {
    // 主题切换
    var themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', function () { theme.toggle(); });

    // 项目切换
    var projectSelect = document.getElementById('project-select');
    if (projectSelect) {
      projectSelect.addEventListener('change', function (e) {
        if (e.target.value) switchProject(e.target.value);
      });
    }

    // 导出
    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', exportVault);

    // 导入
    var importBtn = document.getElementById('btn-import');
    var importInput = document.getElementById('import-input');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', function () { importInput.click(); });
      importInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files.length > 0) importVault(e.target.files);
        e.target.value = ''; // 允许重复选择同一文件
      });
    }
  }

  /** 绑定侧边栏导航事件 */
  function bindSidebarEvents() {
    var navItems = document.querySelectorAll('.nav-item');
    for (var i = 0; i < navItems.length; i++) {
      (function (el) {
        el.addEventListener('click', function (e) {
          e.preventDefault();
          var route = el.getAttribute('data-route');
          if (route) router.navigate(route);
        });
      })(navItems[i]);
    }
  }

  /** 绑定移动端抽屉开关事件 */
  function bindSidebarDrawerEvents() {
    var toggle = document.getElementById('sidebar-toggle');
    var backdrop = document.getElementById('sidebar-backdrop');
    if (toggle) {
      toggle.addEventListener('click', function () { openSidebarDrawer(); });
    }
    if (backdrop) {
      backdrop.addEventListener('click', function () { closeSidebarDrawer(); });
    }
  }

  function openSidebarDrawer() {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('show');
  }

  function closeSidebarDrawer() {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
  }

  // ============ 暴露到 window.DreamTale ============
  window.DreamTale = {
    /** 全局状态对象 */
    state: state,

    /** IStorageBackend 实例（getter，确保拿到最新值） */
    get storage() { return state.storage; },

    /** 路由 API */
    router: router,

    /** 主题 API */
    theme: theme,

    /** toast 通知 */
    notify: notify,

    /** 渲染指定视图 */
    renderView: renderView,

    /** 切换项目 */
    switchProject: switchProject,

    /** 刷新项目列表 */
    refreshProjects: refreshProjects,

    /** 导出当前项目 Vault */
    exportVault: exportVault,

    /** 从 ZIP 导入 Vault */
    importVault: importVault,

    /** 调度自动保存（功能模块编辑器 onChange 调用） */
    scheduleAutoSave: scheduleAutoSave,

    /** 销毁当前编辑器/阅读器实例 */
    cleanupInstances: cleanupInstances,

    /** 渲染欢迎页（功能模块可调用回欢迎页） */
    renderWelcome: renderWelcome,

    /** 已加载的 ES Module 依赖（models/vaultSchema/markdown/storage/editor/reader/ai） */
    get modules() { return _modules; },

    /** AI 适配器实例（可能为 null，未配置/未启用时；业务层据此隐藏 AI 入口） */
    get ai() { return _ai; },

    /** AI 配置管理器实例（可能为 null，AI 模块未加载时） */
    get aiConfig() { return _aiConfigMgr; }
  };

  // ============ 自动启动 ============
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
