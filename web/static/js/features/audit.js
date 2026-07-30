/**
 * DreamTale · 审计面板（features/audit.js）
 *
 * 经典 `<script>` IIFE 模式，挂载到 window.DreamTaleFeatures.renderAudit。
 *
 * 功能：
 * - 桥接服务状态检测（在线 / 离线）
 * - 三大检测模块：
 *   1. 人物一致性检测（check_consistency.py，7 类一致性维度）
 *   2. 去 AI 味全量检测（check_ai_novel.py，10 类 AI 味模式）
 *   3. 伏笔全量审计（audit_hooks.py，超期提醒 + 分级）
 * - 检测结果按严重级别分类：P0 阻断 / P1 警告 / P2 提示
 * - 每条问题展示：位置 / 描述 / 建议
 * - 一键导出审计报告（Markdown）
 *
 * 依赖：
 *   - window.DreamTale.state / notify
 *   - 动态 import() 加载 ../../src/audit/consistency-checker.js
 *   - 动态 import() 加载 ../../src/audit/file-watcher.js（用于显示同步状态）
 *
 * 路由：#/audit
 */
(function (global) {
  'use strict';

  const NS = (global.DreamTaleFeatures = global.DreamTaleFeatures || {});

  // ---------- 工具 ----------
  function DT() {
    if (!global.DreamTale) throw new Error('[audit] window.DreamTale 未初始化');
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

  /** 默认 Vault 路径（与桥接服务一致） */
  const DEFAULT_VAULT = '/workspace/NovelForge_Vault';

  /** 严重级别元数据 */
  const SEVERITY_META = {
    P0: { label: 'P0 阻断', cls: 'sev-p0', icon: '🔴' },
    P1: { label: 'P1 警告', cls: 'sev-p1', icon: '🟡' },
    P2: { label: 'P2 提示', cls: 'sev-p2', icon: '🔵' },
    OK: { label: '通过', cls: 'sev-ok', icon: '🟢' },
  };

  function severityOf(level) {
    const key = String(level || '').toUpperCase();
    return SEVERITY_META[key] || { label: level || '未知', cls: 'sev-unknown', icon: '⚪' };
  }

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
  NS.renderAudit = function (container, params, dt) {
    const state = {
      bridgeOnline: false,
      running: false,        // 当前正在执行的检测 key
      results: {
        consistency: null,    // { raw, issues }
        aiNovel: null,
        hooks: null,
      },
      lastChecked: {
        consistency: null,
        aiNovel: null,
        hooks: null,
      },
      checker: null,
      fileWatcher: null,
      vaultPath: DEFAULT_VAULT,
      changeFeed: [], // 最近 N 条文件变更事件
    };

    /** 渲染骨架 */
    function renderSkeleton() {
      container.innerHTML =
        '<div class="audit-page">' +
          '<header class="page-header">' +
            '<h2>🛡️ 全量审计</h2>' +
            '<div class="page-subtitle">调用 NovelForge Python 脚本检测一致性 / 去 AI 味 / 伏笔回收</div>' +
          '</header>' +
          '<section class="audit-bridge-status" id="audit-bridge-status"></section>' +
          '<section class="audit-modules">' +
            '<div class="audit-module" id="audit-module-consistency"></div>' +
            '<div class="audit-module" id="audit-module-ai-novel"></div>' +
            '<div class="audit-module" id="audit-module-hooks"></div>' +
          '</section>' +
          '<section class="audit-actions">' +
            '<button class="btn btn-secondary" id="audit-export">⬇ 导出 Markdown 报告</button>' +
            '<button class="btn btn-ghost" id="audit-refresh">🔄 重新检测</button>' +
          '</section>' +
          '<section class="audit-recent-changes" id="audit-recent-changes"></section>' +
        '</div>';
      // 绑定事件
      document.getElementById('audit-export').addEventListener('click', exportReport);
      document.getElementById('audit-refresh').addEventListener('click', function () {
        runAll();
      });
    }

    /** 渲染桥接服务状态 */
    function renderBridgeStatus() {
      const el = document.getElementById('audit-bridge-status');
      if (!el) return;
      const online = state.bridgeOnline;
      el.innerHTML =
        '<div class="bridge-card ' + (online ? 'online' : 'offline') + '">' +
          '<span class="bridge-dot"></span>' +
          '<span class="bridge-label">桥接服务：' + (online ? '在线' : '离线') + '</span>' +
          '<span class="bridge-url">http://localhost:7861</span>' +
          (online ? '' :
            '<div class="bridge-hint">请启动桥接服务：<code>python scripts/dreamtale/bridge-server.py</code></div>') +
        '</div>';
    }

    /** 渲染单个检测模块 */
    function renderModule(key, title, icon, desc) {
      const el = document.getElementById('audit-module-' + key);
      if (!el) return;
      const result = state.results[key];
      const last = state.lastChecked[key];
      const running = state.running === key;
      const summary = result ? summarizeIssues(result.issues) : null;

      el.innerHTML =
        '<div class="audit-module-card">' +
          '<div class="audit-module-header">' +
            '<span class="audit-module-icon">' + icon + '</span>' +
            '<h3>' + esc(title) + '</h3>' +
            '<span class="audit-module-desc">' + esc(desc) + '</span>' +
            (last ? '<span class="audit-module-time">上次：' + esc(last) + '</span>' : '') +
          '</div>' +
          '<div class="audit-module-actions">' +
            '<button class="btn btn-primary btn-sm" data-action="run" data-key="' + key + '"' +
              (running || !state.bridgeOnline ? ' disabled' : '') + '>' +
              (running ? '检测中…' : '▶ 运行检测') +
            '</button>' +
            '<span class="audit-module-status">' + (summary ? summary.html : '<span class="muted">未运行</span>') + '</span>' +
          '</div>' +
          '<div class="audit-module-body">' + (result ? renderIssues(result.issues) : '<div class="muted">点击「运行检测」开始</div>') + '</div>' +
        '</div>';

      // 绑定按钮
      const btn = el.querySelector('[data-action="run"]');
      if (btn) {
        btn.addEventListener('click', function () {
          runSingle(key);
        });
      }
    }

    /** 总结问题数量 */
    function summarizeIssues(issues) {
      if (!issues || !issues.length) {
        return { html: '<span class="sev-ok">✅ 无问题</span>', count: 0 };
      }
      const counts = { P0: 0, P1: 0, P2: 0, OK: 0, OTHER: 0 };
      issues.forEach(function (it) {
        const lvl = String(it.severity || '').toUpperCase();
        if (counts[lvl] != null) counts[lvl]++;
        else counts.OTHER++;
      });
      const parts = [];
      if (counts.P0) parts.push('<span class="sev-p0">🔴 P0 ×' + counts.P0 + '</span>');
      if (counts.P1) parts.push('<span class="sev-p1">🟡 P1 ×' + counts.P1 + '</span>');
      if (counts.P2) parts.push('<span class="sev-p2">🔵 P2 ×' + counts.P2 + '</span>');
      if (counts.OTHER) parts.push('<span class="sev-unknown">⚪ 其他 ×' + counts.OTHER + '</span>');
      return { html: parts.join(' '), count: issues.length };
    }

    /** 渲染问题列表 */
    function renderIssues(issues) {
      if (!issues || !issues.length) {
        return '<div class="audit-empty">✅ 未发现问题</div>';
      }
      // 按 P0 → P1 → P2 → 其他 排序
      const order = { P0: 0, P1: 1, P2: 2 };
      const sorted = issues.slice().sort(function (a, b) {
        const sa = order[String(a.severity || '').toUpperCase()] || 9;
        const sb = order[String(b.severity || '').toUpperCase()] || 9;
        return sa - sb;
      });
      return '<ul class="audit-issue-list">' + sorted.map(renderIssueItem).join('') + '</ul>';
    }

    function renderIssueItem(it) {
      const meta = severityOf(it.severity);
      return (
        '<li class="audit-issue ' + meta.cls + '">' +
          '<div class="audit-issue-header">' +
            '<span class="audit-issue-sev">' + meta.icon + ' ' + meta.label + '</span>' +
            (it.category ? '<span class="audit-issue-cat">[' + esc(it.category) + ']</span>' : '') +
            (it.location ? '<span class="audit-issue-loc">' + esc(it.location) + '</span>' : '') +
          '</div>' +
          '<div class="audit-issue-desc">' + esc(it.description || it.message || '') + '</div>' +
          (it.suggestion ?
            '<div class="audit-issue-sugg">建议：' + esc(it.suggestion) + '</div>' : '') +
        '</li>'
      );
    }

    // ---------- 检测执行 ----------
    function runSingle(key) {
      if (!state.checker) {
        DT().notify('桥接服务未就绪', 'warning');
        return;
      }
      const vaultPath = state.vaultPath;
      state.running = key;
      renderModule(key, _MODULE_TITLES[key].title, _MODULE_TITLES[key].icon, _MODULE_TITLES[key].desc);
      let p;
      if (key === 'consistency') {
        p = state.checker.checkConsistency(vaultPath);
      } else if (key === 'aiNovel') {
        p = state.checker.checkAINovel(vaultPath);
      } else if (key === 'hooks') {
        p = state.checker.auditHooks(vaultPath, { currentCh: 1 });
      } else {
        return;
      }
      Promise.resolve(p).then(function (resp) {
        state.results[key] = normalizeResult(key, resp);
        state.lastChecked[key] = new Date().toLocaleTimeString();
        state.running = null;
        renderModule(key, _MODULE_TITLES[key].title, _MODULE_TITLES[key].icon, _MODULE_TITLES[key].desc);
      }).catch(function (err) {
        state.running = null;
        state.results[key] = {
          raw: { ok: false, error: String(err) },
          issues: [{
            severity: 'P0',
            category: '运行时',
            description: '检测执行失败：' + (err && err.message || String(err)),
          }],
        };
        state.lastChecked[key] = new Date().toLocaleTimeString();
        renderModule(key, _MODULE_TITLES[key].title, _MODULE_TITLES[key].icon, _MODULE_TITLES[key].desc);
        DT().notify('检测失败：' + (err && err.message || err), 'error');
      });
    }

    function runAll() {
      if (!state.bridgeOnline) {
        DT().notify('桥接服务离线，无法运行检测', 'warning');
        return;
      }
      ['consistency', 'aiNovel', 'hooks'].forEach(runSingle);
    }

    // ---------- 结果归一化 ----------
    /**
     * 把桥接服务返回的结果归一化为 { raw, issues[] }
     * 每个 issue: { severity, category, location, description, suggestion }
     */
    function normalizeResult(key, resp) {
      const result = { raw: resp, issues: [] };
      if (!resp) return result;
      if (resp.ok === false) {
        result.issues.push({
          severity: 'P0',
          category: '桥接',
          description: '脚本执行失败' + (resp.error ? '：' + resp.error : ''),
          location: resp.stderr ? 'stderr' : '',
          suggestion: resp.stderr ? '查看 stderr 详情' : '请检查桥接服务日志',
        });
        return result;
      }
      const report = resp.report;
      if (!report) {
        // 无结构化报告，但脚本执行成功
        result.issues.push({
          severity: 'P2',
          category: '解析',
          description: '脚本未返回 JSON 报告（可能为文本输出）',
          location: 'stdout',
          suggestion: '查看 stdout 原文',
        });
        result.rawText = resp.stdout || '';
        return result;
      }
      if (key === 'consistency') {
        result.issues = extractConsistencyIssues(report);
      } else if (key === 'aiNovel') {
        result.issues = extractAINovelIssues(report);
      } else if (key === 'hooks') {
        result.issues = extractHooksIssues(report);
      }
      return result;
    }

    /** check_consistency.py 报告 → issues[]
     *  7 类一致性维度：境界跳级/物品凭空/关系突变/位置穿越/伏笔遗忘/角色复生/金手指越界 */
    function extractConsistencyIssues(report) {
      const issues = [];
      // 兼容多种字段名：report.issues / report.problems / report.findings
      const raw = report.issues || report.problems || report.findings || [];
      raw.forEach(function (it) {
        issues.push({
          severity: mapSeverity(it.severity || it.level),
          category: it.dimension || it.category || it.type || '一致性',
          location: it.chapter ? '第 ' + it.chapter + ' 章' : (it.location || ''),
          description: it.description || it.message || it.detail || JSON.stringify(it),
          suggestion: it.suggestion || it.advice || '',
        });
      });
      // 若有统计字段，补一条 P2 提示
      if (report.stats && typeof report.stats === 'object') {
        issues.push({
          severity: 'P2',
          category: '统计',
          location: '全局',
          description: '检测统计：' + JSON.stringify(report.stats),
        });
      }
      return issues;
    }

    /** check_ai_novel.py 报告 → issues[]（10 类 AI 味模式） */
    function extractAINovelIssues(report) {
      const issues = [];
      const raw = report.issues || report.problems || report.findings || [];
      raw.forEach(function (it) {
        issues.push({
          severity: mapSeverity(it.severity || it.level),
          category: it.dimension || it.category || it.type || 'AI 味',
          location: it.paragraph != null ? '段 ' + it.paragraph : (it.location || ''),
          description: it.description || it.message || it.detail || JSON.stringify(it),
          suggestion: it.suggestion || it.advice || '',
        });
      });
      if (report.stats && typeof report.stats === 'object') {
        issues.push({
          severity: 'P2',
          category: '统计',
          location: '全局',
          description: 'AI 味检测统计：' + JSON.stringify(report.stats),
        });
      }
      return issues;
    }

    /** audit_hooks.py 报告 → issues[]（伏笔超期 / 待回收 / 健康） */
    function extractHooksIssues(report) {
      const issues = [];
      // report.alerts / report.reminders / report.hooks
      const alerts = report.alerts || report.reminders || [];
      alerts.forEach(function (it) {
        issues.push({
          severity: mapHookSeverity(it.severity),
          category: '伏笔',
          location: it.hook_id ? it.hook_id : (it.location || ''),
          description: it.message || it.description ||
            (it.hook_id + '：' + (it.status || 'unknown') + (it.overdue ? '（超期 ' + it.overdue + ' 章）' : '')),
          suggestion: it.suggestion || '建议尽快回收或更新状态',
        });
      });
      // 兼容 hooks 字段（每条 hook 单独检查是否超期）
      const hooks = report.hooks || [];
      hooks.forEach(function (h) {
        if (h.overdue || h.severity === 'critical' || h.severity === 'warning') {
          issues.push({
            severity: mapHookSeverity(h.severity),
            category: '伏笔',
            location: h.hook_id || '',
            description: h.description || h.message ||
              (h.hook_id + ' 状态：' + (h.status || 'unknown') +
                (h.target_resolve_ch ? '，目标回收章 ' + h.target_resolve_ch : '')),
            suggestion: h.suggestion || '',
          });
        }
      });
      if (report.stats && typeof report.stats === 'object') {
        issues.push({
          severity: 'P2',
          category: '统计',
          location: '全局',
          description: '伏笔审计统计：' + JSON.stringify(report.stats),
        });
      }
      return issues;
    }

    function mapSeverity(raw) {
      const s = String(raw || '').toUpperCase();
      if (s === 'P0' || s === 'CRITICAL' || s === 'ERROR' || s === 'BLOCK') return 'P0';
      if (s === 'P1' || s === 'WARNING' || s === 'WARN') return 'P1';
      if (s === 'P2' || s === 'INFO' || s === 'TIP' || s === 'NOTE') return 'P2';
      if (s === 'OK' || s === 'PASS' || s === 'HEALTHY') return 'OK';
      return 'P2';
    }

    function mapHookSeverity(raw) {
      const s = String(raw || '').toLowerCase();
      if (s === 'critical') return 'P0';
      if (s === 'warning') return 'P1';
      if (s === 'healthy' || s === 'done') return 'OK';
      return 'P2';
    }

    // ---------- 导出 Markdown 报告 ----------
    function exportReport() {
      const md = buildMarkdownReport();
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dreamtale-audit-' + Date.now() + '.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      DT().notify('审计报告已导出', 'success');
    }

    function buildMarkdownReport() {
      const lines = [];
      lines.push('# DreamTale 全量审计报告');
      lines.push('');
      lines.push('- 生成时间：' + new Date().toLocaleString());
      lines.push('- 桥接服务：' + (state.bridgeOnline ? '在线' : '离线'));
      lines.push('- Vault：' + state.vaultPath);
      lines.push('');
      ['consistency', 'aiNovel', 'hooks'].forEach(function (key) {
        const meta = _MODULE_TITLES[key];
        lines.push('## ' + meta.icon + ' ' + meta.title);
        lines.push('');
        const result = state.results[key];
        if (!result) {
          lines.push('> 未运行检测');
          lines.push('');
          return;
        }
        if (result.issues && result.issues.length) {
          lines.push('| 严重级别 | 分类 | 位置 | 描述 | 建议 |');
          lines.push('|---|---|---|---|---|');
          result.issues.forEach(function (it) {
            lines.push(
              '| ' + (it.severity || '') +
              ' | ' + (it.category || '') +
              ' | ' + (it.location || '') +
              ' | ' + mdEscape(it.description || '') +
              ' | ' + mdEscape(it.suggestion || '') + ' |'
            );
          });
        } else {
          lines.push('✅ 未发现问题');
        }
        lines.push('');
      });
      return lines.join('\n');
    }

    function mdEscape(s) {
      return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    }

    // ---------- 文件变更 feed ----------
    function renderRecentChanges() {
      const el = document.getElementById('audit-recent-changes');
      if (!el) return;
      const feed = state.changeFeed.slice(-5).reverse();
      if (!feed.length) {
        el.innerHTML =
          '<div class="recent-changes-card">' +
            '<h3>📂 Vault 文件变更</h3>' +
            '<div class="muted">暂无变更事件（桥接服务在线时会自动推送）</div>' +
          '</div>';
        return;
      }
      const items = feed.map(function (ev) {
        const d = ev.data || {};
        const t = d.type || ev.event;
        const path = d.path || '';
        const ts = d.mtime ? new Date(d.mtime * 1000).toLocaleTimeString() : '';
        return '<li class="change-item"><span class="change-type change-' + esc(t) + '">' +
          esc(t) + '</span><span class="change-path">' + esc(path) + '</span>' +
          '<span class="change-time">' + esc(ts) + '</span></li>';
      }).join('');
      el.innerHTML =
        '<div class="recent-changes-card">' +
          '<h3>📂 Vault 文件变更（最近 5 条）</h3>' +
          '<ul class="change-list">' + items + '</ul>' +
        '</div>';
    }

    // 模块元数据
    const _MODULE_TITLES = {
      consistency: { title: '人物一致性检测', icon: '🧬', desc: '7 类一致性维度（境界/物品/位置/关系/伏笔/角色/金手指）' },
      aiNovel: { title: '去 AI 味全量检测', icon: '🤖', desc: '10 类 AI 味模式（信息倾倒/金手指滥用/爽点套路化等）' },
      hooks: { title: '伏笔全量审计', icon: '🪝', desc: '超期提醒 + 分级（critical/warning/healthy）' },
    };

    // ---------- 启动 ----------
    function start() {
      renderSkeleton();
      renderModule('consistency', _MODULE_TITLES.consistency.title, _MODULE_TITLES.consistency.icon, _MODULE_TITLES.consistency.desc);
      renderModule('aiNovel', _MODULE_TITLES.aiNovel.title, _MODULE_TITLES.aiNovel.icon, _MODULE_TITLES.aiNovel.desc);
      renderModule('hooks', _MODULE_TITLES.hooks.title, _MODULE_TITLES.hooks.icon, _MODULE_TITLES.hooks.desc);
      renderRecentChanges();
      renderBridgeStatus();

      // 加载 audit ES Module + 探测桥接服务
      loadAuditModules()
        .then(function (mods) {
          state.checker = new mods.ConsistencyChecker('http://localhost:7861');
          state.fileWatcher = new mods.FileWatcher('http://localhost:7861');
          // 启动文件监听
          state.fileWatcher.start(function (event) {
            if (event.event === 'vault:change') {
              state.changeFeed.push(event);
              if (state.changeFeed.length > 20) state.changeFeed.shift();
              renderRecentChanges();
            }
          });
          // 探测桥接服务
          return state.checker.isBridgeAvailable();
        })
        .then(function (online) {
          state.bridgeOnline = !!online;
          renderBridgeStatus();
          // 在线则刷新三个模块的按钮可用状态
          renderModule('consistency', _MODULE_TITLES.consistency.title, _MODULE_TITLES.consistency.icon, _MODULE_TITLES.consistency.desc);
          renderModule('aiNovel', _MODULE_TITLES.aiNovel.title, _MODULE_TITLES.aiNovel.icon, _MODULE_TITLES.aiNovel.desc);
          renderModule('hooks', _MODULE_TITLES.hooks.title, _MODULE_TITLES.hooks.icon, _MODULE_TITLES.hooks.desc);
        })
        .catch(function (err) {
          console.error('[audit] 加载失败：', err);
          DT().notify('审计模块加载失败：' + (err && err.message || err), 'error');
        });
    }

    start();

    // 返回清理函数（app.js 在视图切换时可调用）
    return function cleanup() {
      if (state.fileWatcher) {
        try { state.fileWatcher.stop(); } catch (e) { /* noop */ }
      }
    };
  };
})(typeof window !== 'undefined' ? window : this);
