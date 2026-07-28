// AI 配置中心
// 配置仅保存在 localStorage（不上传服务端），支持配置变更订阅。
// 优雅降级：clearConfig 后 isAIEnabled() 返回 false。

const STORAGE_KEY = 'dreamtale:ai-config';

const DEFAULT_CONFIG = {
  mode: null,        // 'api-key' | 'ide' | 'mock' | null
  apiKey: '',
  baseUrl: '',
  model: '',
  ideType: ''
};

export class ConfigManager {
  /**
   * @param {{storage?: Storage, key?: string}} [options]
   */
  constructor(options) {
    options = options || {};
    this._storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this._key = options.key || STORAGE_KEY;
    this._listeners = [];
    this._cache = this._load();
  }

  /** 从存储加载配置（失败回退到默认） */
  _load() {
    if (!this._storage) return Object.assign({}, DEFAULT_CONFIG);
    try {
      const raw = this._storage.getItem(this._key);
      if (!raw) return Object.assign({}, DEFAULT_CONFIG);
      const obj = JSON.parse(raw);
      return Object.assign({}, DEFAULT_CONFIG, obj);
    } catch (_e) {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  /** 持久化配置到存储 */
  _save(config) {
    if (!this._storage) return;
    try {
      this._storage.setItem(this._key, JSON.stringify(config));
    } catch (e) {
      console.warn('[ConfigManager] 写入 localStorage 失败:', e);
    }
  }

  /** 获取当前配置副本 */
  getConfig() {
    return Object.assign({}, this._cache);
  }

  /** 设置配置（合并），并通知订阅者 */
  setConfig(partial) {
    if (!partial || typeof partial !== 'object') {
      throw new Error('ConfigManager.setConfig: 参数必须是对象');
    }
    const newConfig = Object.assign({}, this._cache, partial);
    this._cache = newConfig;
    this._save(newConfig);
    this._notify(newConfig);
  }

  /** 清除全部 AI 配置 */
  clearConfig() {
    this._cache = Object.assign({}, DEFAULT_CONFIG);
    if (this._storage) {
      try { this._storage.removeItem(this._key); } catch (_e) { /* ignore */ }
    }
    this._notify(this._cache);
  }

  /**
   * 是否启用 AI：配置了 apiKey 或检测到 IDE 环境
   * @returns {boolean}
   */
  isAIEnabled() {
    const c = this._cache;
    if (c.mode === 'api-key' && c.apiKey) return true;
    if (c.mode === 'ide') {
      // 进一步检测 IDE 环境是否真实存在
      if (typeof window !== 'undefined' && (window.__TRAE_IDE__ || window.__WORKBUDDY__)) return true;
      // 配置了 ide 模式但无环境，仍认为已配置（用户可在 IDE 内启动后激活）
      return true;
    }
    if (c.mode === 'mock') return true; // mock 始终可用
    return false;
  }

  /**
   * 订阅配置变更
   * @param {(config: object) => void} callback
   * @returns {() => void} 取消订阅
   */
  onConfigChange(callback) {
    if (typeof callback !== 'function') {
      throw new Error('ConfigManager.onConfigChange: callback 必须是函数');
    }
    this._listeners.push(callback);
    const self = this;
    return function () {
      const idx = self._listeners.indexOf(callback);
      if (idx !== -1) self._listeners.splice(idx, 1);
    };
  }

  /** 内部：通知所有订阅者 */
  _notify(config) {
    const snapshot = Object.assign({}, config);
    for (let i = 0; i < this._listeners.length; i++) {
      try { this._listeners[i](snapshot); } catch (e) {
        console.warn('[ConfigManager] 订阅者回调异常:', e);
      }
    }
  }
}
