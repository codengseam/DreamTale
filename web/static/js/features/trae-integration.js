/**
 * DreamTale · Trae IDE 集成面板（features/trae-integration.js）
 *
 * 经典 `<script>` IIFE 模式，挂载到 window.DreamTaleFeatures.renderTraeIntegration。
 *
 * 功能：
 * - 显示 IDE 连接状态（桥接服务在线即视为 IDE 可达）
 * - 触发原项目全链路创作流程：
 *   * 「写下一章」按钮 → 调 /api/skill/architect（占位）
 *   * 「写公众号」按钮 → 调 /api/skill/writer-polisher（占位）
 * - 文件同步状态（基于 FileWatcher SSE 实时推送）
 * - 防漂移三铁律提示：
 *   1. 不注入历史正文（用前情提要替代）
 *   2. 不依赖 LLM 记忆（状态机强制上下文）
 *   3. 不跳过校验直接保存（一致性 + AI 味双校验）
 *
 * 依赖：
 *   - window.DreamTale.state / notify
 *   - 动态 import() 加载 ../../src/audit/consistency-checker.js
 *   - 动态 import() 加载 ../../src/audit/file-watcher.js
 *
 * 路由：#/trae
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------
  function DT() {
    if (!global.DreamTale) throw new Error('[trae] window.DreamTale 未初始化');
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

  /** 防漂移三铁律 */
  const ANTI_DRIFT_RULES = [
    {
      icon: '📜',
      title: '不注入历史正文',
      detail: '用前情提要（recap）替代直接读历史正文，避免上下文窗口爆炸与版本漂移。',
    },
    {
      icon: '🧠',
      title: '不依赖 LLM 记忆',
      detail: '状态机字段（境界/位置/关系/物品）必须作为强制上下文注入，不能靠 LLM 自行记忆。',
    },
    {
      icon: '🛡️',
      title: '不跳过校验直接保存',
      detail: '每章执笔后必须跑 check_consistency.py + check_ai_novel.py 双校验，P0 阻断保存。',
    },
  ];

  /** 缓存已加载的 audit ES Module 依赖 */
  let _auditModules = null;
  function loadAuditModules() {
    if (_auditModules) return Promise.resolve(_auditModules);
    return Promise.all([
      import('../../src/audit/consistency-checker.js'),
      import('../../src/audit/file-watcher.js'),
    ]).then(function (results) {
      _auditModules = {
        ConsistencyChecker: results[0].ConsistencyChecker,
        FileWatcher: results[1].FileWatcher,
      };
      return _auditModules;
    });
  }

  // ---------- 渲染入口 ----------
  NS.renderTraeIntegration = function (container, params, dt) {
    const state = {
      bridgeOnline: false,
      checker: null,
      fileWatcher: null,
      changeFeed: [],
      lastSkillCall: null,
      skillCalling: null, // 'architect' | 'writer-polisher' | null
    };

    /** 渲染骨架 */
    function renderSkeleton() {
      container.innerHTML =
        '<div class="trae-page">' +
          '<header class="page-header">' +
            '<h2>🔌 Trae IDE 集成</h2>' +
            '<div class="page-subtitle">触发 NovelForge 原项目全链路创作流程 · 文件同步 · 防漂移守护</div>' +
          '</header>' +
          '<section class="trae-ide-status" id="trae-ide-status"></section>' +
          '<section class="trae-skills">' +
            '<div class="trae-skill-card">' +
              '<h3>✍️ 写下一章（长篇）</h3>' +
              '<p>触发 NovelForge architect Skill：核心脑洞 → 世界观 → story_arc → master_outline → 卷纲 → 章纲 → 执笔 → 精修。</p>' +
              '<button class="btn btn-primary" id="trae-btn-architect" disabled>写下一章</button>' +
              '<span class="trae-skill-status" id="trae-status-architect"></span>' +
            '</div>' +
            '<div class="trae-skill-card">' +
              '<h3>📝 写公众号（短篇）</h3>' +
              '<p>触发 NovelForge writer-polisher Skill（shortform 模式）：选题 → 执笔 → 去 AI 味 → 标题工程师 → 传播性审计。</p>' +
              '<button class="btn btn-primary" id="trae-btn-writer-polisher" disabled>写公众号</button>' +
              '<span class="trae-skill-status" id="trae-status-writer-polisher"></span>' +
            '</div>' +
          '</section>' +
          '<section class="trae-sync">' +
            '<h3>📂 文件同步状态</h3>' +
            '<div class="trae-sync-info" id="trae-sync-info"></div>' +
            '<ul class="trae-change-list" id="trae-change-list"></ul>' +
          '</section>' +
          '<section class="trae-rules">' +
            '<h3>🛡️ 防漂移三铁律</h3>' +
            '<ul class="rules-list">' +
              ANTI_DRIFT_RULES.map(function (r) {
                return '<li class="rule-item">' +
                  '<span class="rule-icon">' + r.icon + '</span>' +
                  '<div class="rule-body">' +
                    '<div class="rule-title">' + esc(r.title) + '</div>' +
                    '<div class="rule-detail">' + esc(r.detail) + '</div>' +
                  '</div>' +
                '</li>';
              }).join('') +
            '</ul>' +
          '</section>' +
        '</div>';

      // 绑定按钮
      document.getElementById('trae-btn-architect').addEventListener('click', function () {
        callSkill('architect');
      });
      document.getElementById('trae-btn-writer-polisher').addEventListener('click', function () {
        callSkill('writer-polisher');
      });
    }

    /** 渲染 IDE 连接状态 */
    function renderIdeStatus() {
      const el = document.getElementById('trae-ide-status');
      if (!el) return;
      const online = state.bridgeOnline;
      el.innerHTML =
        '<div class="ide-card ' + (online ? 'online' : 'offline') + '">' +
          '<span class="ide-dot"></span>' +
          '<div class="ide-info">' +
            '<div class="ide-label">IDE 连接：' + (online ? '已连接' : '未连接') + '</div>' +
            '<div class="ide-sub">桥接服务 http://localhost:7861 ' +
              (online ? '在线' : '离线') + '</div>' +
            (online ? '' :
              '<div class="ide-hint">请启动桥接服务：<code>python scripts/dreamtale/bridge-server.py</code></div>') +
          '</div>' +
        '</div>';
      // 按钮启用状态
      const btn1 = document.getElementById('trae-btn-architect');
      const btn2 = document.getElementById('trae-btn-writer-polisher');
      if (btn1) btn1.disabled = !online || state.skillCalling === 'architect';
      if (btn2) btn2.disabled = !online || state.skillCalling === 'writer-polisher';
    }

    /** 渲染文件同步信息 */
    function renderSyncInfo() {
      const el = document.getElementById('trae-sync-info');
      if (!el) return;
      const watching = state.fileWatcher && state.fileWatcher.isWatching();
      const connected = state.fileWatcher && state.fileWatcher.isConnected();
      el.innerHTML =
        '<span class="sync-state ' + (connected ? 'on' : 'off') + '">' +
          (connected ? '🟢 实时同步中' : (watching ? '🟡 等待事件' : '⚪ 未启动')) +
        '</span>' +
        '<span class="sync-count">已收到 ' + state.changeFeed.length + ' 条事件</span>';
      renderChangeList();
    }

    function renderChangeList() {
      const el = document.getElementById('trae-change-list');
      if (!el) return;
      const feed = state.changeFeed.slice(-10).reverse();
      if (!feed.length) {
        el.innerHTML = '<li class="muted">暂无文件变更事件</li>';
        return;
      }
      el.innerHTML = feed.map(function (ev) {
        const d = ev.data || {};
        const t = d.type || ev.event;
        const path = d.path || '';
        const ts = d.mtime ? new Date(d.mtime * 1000).toLocaleTimeString() : '';
        return '<li class="change-item"><span class="change-type change-' + esc(t) + '">' +
          esc(t) + '</span><span class="change-path">' + esc(path) + '</span>' +
          '<span class="change-time">' + esc(ts) + '</span></li>';
      }).join('');
    }

    /** 渲染 skill 调用状态 */
    function renderSkillStatus(key, status, msg) {
      const el = document.getElementById('trae-status-' + key);
      if (!el) return;
      if (!status) {
        el.innerHTML = '';
        return;
      }
      const cls = status === 'success' ? 'skill-success' :
                  (status === 'error' ? 'skill-error' : 'skill-running');
      el.innerHTML = '<span class="' + cls + '">' + esc(msg || '') + '</span>';
    }

    // ---------- Skill 调用 ----------
    function callSkill(key) {
      if (!state.checker) {
        DT().notify('桥接服务未就绪', 'warning');
        return;
      }
      if (state.skillCalling) {
        DT().notify('已有 Skill 调用进行中：' + state.skillCalling, 'info');
        return;
      }
      state.skillCalling = key;
      renderIdeStatus();
      renderSkillStatus(key, 'running', '调用中…');

      let p;
      const payload = {
        source: 'dreamtale-web',
        timestamp: Date.now(),
      };
      if (key === 'architect') {
        p = state.checker.triggerArchitectSkill(payload);
      } else if (key === 'writer-polisher') {
        p = state.checker.triggerWriterPolisherSkill(payload);
      } else {
        state.skillCalling = null;
        return;
      }

      Promise.resolve(p).then(function (resp) {
        state.skillCalling = null;
        state.lastSkillCall = { key: key, resp: resp, time: new Date().toLocaleTimeString() };
        renderIdeStatus();
        if (resp && resp.ok) {
          if (resp.placeholder) {
            renderSkillStatus(key, 'success', '占位端点已响应：' + (resp.message || '请通过 Trae IDE 调用'));
            DT().notify('Skill 触发端点（占位）：请通过 Trae IDE 界面手动调用', 'info', 5000);
          } else {
            renderSkillStatus(key, 'success', '调用成功');
            DT().notify('Skill 调用成功', 'success');
          }
        } else {
          renderSkillStatus(key, 'error', '失败：' + (resp && resp.error ? resp.error : '未知'));
          DT().notify('Skill 调用失败：' + (resp && resp.error || ''), 'error');
        }
      }).catch(function (err) {
        state.skillCalling = null;
        renderIdeStatus();
        renderSkillStatus(key, 'error', '异常：' + (err && err.message || err));
        DT().notify('Skill 调用异常：' + (err && err.message || err), 'error');
      });
    }

    // ---------- 启动 ----------
    function start() {
      renderSkeleton();
      renderIdeStatus();
      renderSyncInfo();

      loadAuditModules()
        .then(function (mods) {
          state.checker = new mods.ConsistencyChecker('http://localhost:7861');
          state.fileWatcher = new mods.FileWatcher('http://localhost:7861');
          // 启动文件监听
          state.fileWatcher.start(function (event) {
            if (event.event === 'vault:change') {
              state.changeFeed.push(event);
              if (state.changeFeed.length > 50) state.changeFeed.shift();
              renderSyncInfo();
            } else if (event.event === 'hello') {
              renderSyncInfo();
            }
          });
          return state.checker.isBridgeAvailable();
        })
        .then(function (online) {
          state.bridgeOnline = !!online;
          renderIdeStatus();
          renderSyncInfo();
        })
        .catch(function (err) {
          console.error('[trae] 加载失败：', err);
          DT().notify('Trae 集成模块加载失败：' + (err && err.message || err), 'error');
        });
    }

    start();

    // 返回清理函数
    return function cleanup() {
      if (state.fileWatcher) {
        try { state.fileWatcher.stop(); } catch (e) { /* noop */ }
      }
    };
  };
})(typeof window !== 'undefined' ? window : this);
