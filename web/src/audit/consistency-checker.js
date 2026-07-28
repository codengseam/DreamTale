/**
 * DreamTale · 一致性检测客户端（ES Module）
 *
 * 职责：
 * - 调用本地桥接服务（scripts/dreamtale/bridge-server.py，端口 7861）
 * - 转发三个核心 NovelForge Python 脚本调用：
 *   * checkConsistency(vaultPath) → POST /api/check/consistency
 *   * checkAINovel(vaultPath)     → POST /api/check/ai-novel
 *   * auditHooks(vaultPath)       → POST /api/audit/hooks
 * - 提供桥接服务在线探测（isBridgeAvailable）
 *
 * 与 file-watcher.js 同属 web/src/audit/ ES Module 层。
 * UI 层（web/static/js/features/audit.js）通过 dynamic import() 加载本模块。
 *
 * 依赖：仅 fetch（浏览器原生 / vitest mock）
 */

/** 默认桥接服务地址 */
const DEFAULT_BRIDGE_URL = 'http://localhost:7861';

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 一致性检测客户端
 *
 * 用法：
 *   import { ConsistencyChecker } from '../../src/audit/consistency-checker.js';
 *   const checker = new ConsistencyChecker('http://localhost:7861');
 *   if (await checker.isBridgeAvailable()) {
 *     const result = await checker.checkConsistency('/workspace/NovelForge_Vault');
 *   }
 */
export class ConsistencyChecker {
  /**
   * @param {string} [bridgeUrl='http://localhost:7861'] 桥接服务地址
   */
  constructor(bridgeUrl = DEFAULT_BRIDGE_URL) {
    this.bridgeUrl = bridgeUrl.replace(/\/+$/, '');
    this._timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  /**
   * 设置请求超时
   * @param {number} ms 毫秒
   */
  setTimeout(ms) {
    this._timeoutMs = ms;
  }

  /**
   * 检测桥接服务是否在线
   * @returns {Promise<boolean>}
   */
  async isBridgeAvailable() {
    try {
      const resp = await this._fetchWithTimeout(
        `${this.bridgeUrl}/api/health`,
        { method: 'GET' },
        3000
      );
      if (!resp.ok) return false;
      const data = await resp.json();
      return !!(data && data.ok === true);
    } catch (err) {
      return false;
    }
  }

  /**
   * 调用 check_consistency.py（一致性检测：境界/物品/位置/关系/伏笔/角色状态/金手指 7 类）
   * @param {string} [vaultPath] Vault 路径，缺省由桥接服务决定
   * @param {object} [opts] { chapter?: number, strict?: boolean }
   * @returns {Promise<object>} 桥接服务返回的结构化结果
   */
  async checkConsistency(vaultPath, opts = {}) {
    return this._postJson('/api/check/consistency', {
      vault: vaultPath || undefined,
      chapter: opts.chapter,
      strict: opts.strict || false,
    });
  }

  /**
   * 调用 check_ai_novel.py（去 AI 味检测：10 类 AI 味模式）
   * @param {string} [vaultPath] Vault 路径
   * @param {object} [opts] { chapter?: number, strict?: boolean }
   * @returns {Promise<object>}
   */
  async checkAINovel(vaultPath, opts = {}) {
    return this._postJson('/api/check/ai-novel', {
      vault: vaultPath || undefined,
      chapter: opts.chapter,
      strict: opts.strict || false,
    });
  }

  /**
   * 调用 audit_hooks.py（伏笔全量审计）
   * @param {string} [vaultPath] Vault 路径
   * @param {object} [opts] { currentCh?: number }
   * @returns {Promise<object>}
   */
  async auditHooks(vaultPath, opts = {}) {
    return this._postJson('/api/audit/hooks', {
      vault: vaultPath || undefined,
      current_ch: opts.currentCh || opts.chapter || 1,
    });
  }

  /**
   * 触发 Trae Skill：架构师（占位端点）
   * @param {object} [payload] 透传给桥接服务的负载
   * @returns {Promise<object>}
   */
  async triggerArchitectSkill(payload = {}) {
    return this._postJson('/api/skill/architect', payload);
  }

  /**
   * 触发 Trae Skill：执笔与精修（占位端点）
   * @param {object} [payload] 透传给桥接服务的负载
   * @returns {Promise<object>}
   */
  async triggerWriterPolisherSkill(payload = {}) {
    return this._postJson('/api/skill/writer-polisher', payload);
  }

  // ---------- 内部工具 ----------

  /**
   * 带 timeout 的 fetch 包装
   * @param {string} url
   * @param {RequestInit} init
   * @param {number} [timeout] 毫秒，缺省用 this._timeoutMs
   * @returns {Promise<Response>}
   */
  async _fetchWithTimeout(url, init, timeout) {
    const ms = timeout || this._timeoutMs;
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }
    // 兜底：无 AbortController（jsdom 老版本），直接 fetch
    return fetch(url, init);
  }

  /**
   * POST JSON 请求
   * @param {string} path 必须以 / 开头
   * @param {object} body
   * @returns {Promise<object>}
   */
  async _postJson(path, body) {
    const url = `${this.bridgeUrl}${path}`;
    try {
      const resp = await this._fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
        },
        this._timeoutMs
      );
      if (!resp.ok) {
        return {
          ok: false,
          http_status: resp.status,
          error: `HTTP ${resp.status} ${resp.statusText}`,
        };
      }
      const data = await resp.json();
      return data;
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : String(err),
        error_name: err && err.name ? err.name : undefined,
      };
    }
  }
}

/** 默认桥接地址常量（便于 UI 层引用） */
export const DEFAULT_BRIDGE = DEFAULT_BRIDGE_URL;

export default ConsistencyChecker;
