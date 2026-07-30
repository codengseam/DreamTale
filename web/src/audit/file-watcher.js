/**
 * DreamTale · 文件变更监听客户端（ES Module）
 *
 * 职责：
 * - 连接桥接服务 SSE 端点 GET /api/events
 * - Vault 目录文件变更时回调通知 UI 层
 * - 自动重连（指数退避，最长 30s）
 *
 * 与 consistency-checker.js 同属 web/src/audit/ ES Module 层。
 * UI 层（web/static/js/features/audit.js / trae-integration.js）
 * 通过 dynamic import() 加载本模块。
 *
 * 依赖：浏览器原生 EventSource（jsdom 不支持，单元测试用 mock）
 */

/** 默认桥接服务地址 */
const DEFAULT_BRIDGE_URL = 'http://localhost:7861';

/** 重连相关常量 */
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * 文件变更监听客户端
 *
 * 用法：
 *   import { FileWatcher } from '../../src/audit/file-watcher.js';
 *   const fw = new FileWatcher('http://localhost:7861');
 *   fw.start((event) => console.log('变更：', event));
 *   // ...
 *   fw.stop();
 *
 * 事件结构（来自桥接服务 SSE）：
 *   {
 *     event: 'vault:change' | 'hello' | 'ping',
 *     data: { type?: 'created'|'modified'|'deleted', path?: string, mtime?: number, ts?: number }
 *   }
 */
export class FileWatcher {
  /**
   * @param {string} [bridgeUrl='http://localhost:7861'] 桥接服务地址
   */
  constructor(bridgeUrl = DEFAULT_BRIDGE_URL) {
    this.bridgeUrl = bridgeUrl.replace(/\/+$/, '');
    /** @type {function|null} 当前 onChange 回调 */
    this._onChange = null;
    /** @type {EventSource|null} 当前 EventSource 连接 */
    this._source = null;
    /** @type {boolean} 是否正在监听（含重连中） */
    this._watching = false;
    /** @type {number} 当前重连 timer id */
    this._reconnectTimer = null;
    /** @type {number} 当前退避时长（毫秒） */
    this._backoffMs = RECONNECT_INITIAL_MS;
    /** @type {function} EventSource 工厂（可注入便于测试） */
    this._EventSourceCtor = typeof EventSource !== 'undefined' ? EventSource : null;
  }

  /**
   * 注入 EventSource 构造器（测试用）
   * @param {function} Ctor EventSource 构造器
   */
  setEventSourceCtor(Ctor) {
    this._EventSourceCtor = Ctor;
  }

  /**
   * 启动监听
   * @param {function} onChange 变更回调，签名 (event) => void
   */
  start(onChange) {
    if (this._watching) {
      // 已在监听，仅更新回调
      this._onChange = onChange || this._onChange;
      return;
    }
    if (typeof onChange !== 'function') {
      throw new Error('FileWatcher.start 需要一个回调函数');
    }
    this._onChange = onChange;
    this._watching = true;
    this._backoffMs = RECONNECT_INITIAL_MS;
    this._open();
  }

  /**
   * 停止监听
   */
  stop() {
    this._watching = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._source) {
      try {
        this._source.close();
      } catch (e) { /* noop */ }
      this._source = null;
    }
    this._onChange = null;
  }

  /**
   * 是否正在监听
   * @returns {boolean}
   */
  isWatching() {
    return this._watching;
  }

  /**
   * 当前是否有活跃的 EventSource 连接
   * @returns {boolean}
   */
  isConnected() {
    return !!(this._source && this._source.readyState === 1); // 1 = OPEN
  }

  // ---------- 内部 ----------

  _open() {
    if (!this._watching) return;
    if (!this._EventSourceCtor) {
      // 浏览器/环境不支持 EventSource：静默降级
      // 调度一次定时重连探测，环境变化后能恢复
      this._scheduleReconnect();
      return;
    }
    let source;
    try {
      source = new this._EventSourceCtor(`${this.bridgeUrl}/api/events`);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    this._source = source;

    // 通用事件分发
    const dispatch = (event) => {
      if (!this._watching || !this._onChange) return;
      try {
        this._onChange(event);
      } catch (e) { /* 回调异常不中断监听 */ }
    };

    source.onopen = () => {
      // 连接成功，重置退避
      this._backoffMs = RECONNECT_INITIAL_MS;
    };

    source.onerror = () => {
      // 出错后关闭并重连
      try { source.close(); } catch (e) { /* noop */ }
      if (this._source === source) this._source = null;
      this._scheduleReconnect();
    };

    // hello 事件：连接确认
    source.addEventListener('hello', (e) => {
      dispatch({ event: 'hello', data: _safeParse(e && e.data) });
    });
    // ping 事件：心跳
    source.addEventListener('ping', (e) => {
      dispatch({ event: 'ping', data: _safeParse(e && e.data) });
    });
    // vault:change 事件：文件变更
    source.addEventListener('vault:change', (e) => {
      dispatch({ event: 'vault:change', data: _safeParse(e && e.data) });
    });
    // 默认 message 事件（兜底）
    source.onmessage = (e) => {
      dispatch({ event: 'message', data: _safeParse(e && e.data) });
    };
  }

  _scheduleReconnect() {
    if (!this._watching) return;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    const delay = this._backoffMs;
    this._backoffMs = Math.min(this._backoffMs * 2, RECONNECT_MAX_MS);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._open();
    }, delay);
  }
}

/**
 * 安全解析 SSE data 字段（JSON 字符串 → 对象）
 * @param {string} raw
 * @returns {any} 解析失败返回原字符串
 */
function _safeParse(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

/** 默认桥接地址常量 */
export const DEFAULT_BRIDGE = DEFAULT_BRIDGE_URL;

export default FileWatcher;
