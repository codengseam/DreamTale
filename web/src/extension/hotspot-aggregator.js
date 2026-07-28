// DreamTale 扩展层 · 热点聚合引擎
// ============================================================
// 多平台热点采集（知乎/微博/抖音/番茄/小红书等）
// 通过公开 RSSHub 实例抓取 JSON 格式热点数据。
//
// 设计要点：
// - 单个平台失败不阻断其他平台（错误隔离）
// - localStorage 缓存 10 分钟，避免频繁请求
// - fetch 超时 10s（用 AbortController）
// - RSSHub 支持 .json 后缀返回 JSON
//
// 数据结构：
//   Hotspot = {
//     title: string,         // 标题
//     heat: number,          // 热度（0-100 标准化或原始数值）
//     platform: string,      // 平台名（zhihu/weibo/douyin/...）
//     sourceUrl: string,     // 原文链接
//     summary: string,       // 摘要
//     genreTags: string[],   // 题材标签（由 genre-matcher 提取）
//     fetchedAt: string      // ISO 时间戳
//   }

/** 默认 RSSHub 实例（公开镜像） */
const DEFAULT_RSSHUB_BASE = 'https://rsshub.app';

/** 内置 RSS 源配置：平台名 → RSSHub 路径 */
export const RSS_SOURCES = {
  zhihu: '/zhihu/hotlist',           // 知乎热榜
  weibo: '/weibo/search/hot',        // 微博热搜
  douyin: '/douyin/trending',        // 抖音热点
  fanqie: '/fanqienovel/category',   // 番茄小说榜单
  xiaohongshu: '/xiaohongshu/explore', // 小红书热搜
};

/** 平台中文名映射 */
export const PLATFORM_LABELS = {
  zhihu: '知乎',
  weibo: '微博',
  douyin: '抖音',
  fanqie: '番茄',
  xiaohongshu: '小红书',
};

/** 缓存 key 前缀 */
const CACHE_KEY_PREFIX = 'dreamtale:hotspot:';
/** 缓存有效期 10 分钟（毫秒） */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** fetch 超时 10 秒 */
const FETCH_TIMEOUT_MS = 10 * 1000;

/**
 * 热点聚合引擎
 *
 * 用法：
 *   const agg = new HotspotAggregator('https://rsshub.app');
 *   const hotspots = await agg.fetchHotspots(['zhihu', 'weibo'], 20);
 */
export class HotspotAggregator {
  /**
   * @param {string} [rsshubBase='https://rsshub.app'] RSSHub 实例基址
   */
  constructor(rsshubBase = DEFAULT_RSSHUB_BASE) {
    this.rsshubBase = (rsshubBase || DEFAULT_RSSHUB_BASE).replace(/\/+$/, '');
    /** @type {Record<string, string>} 用户自定义源 */
    this._customSources = {};
    /** @type {function} fetch 注入点（测试用） */
    this._fetchImpl = null;
  }

  /**
   * 注入自定义 fetch 实现（用于测试 mock）。
   * @param {function} fn fetch 兼容函数
   */
  setFetchImpl(fn) {
    this._fetchImpl = fn;
  }

  /**
   * 获取底层 fetch（优先用注入的，否则全局 fetch）。
   * @private
   */
  _getFetch() {
    const fn = this._fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (typeof fn !== 'function') {
      throw new Error('HotspotAggregator: 当前环境无 fetch 实现，请用 setFetchImpl 注入');
    }
    return fn;
  }

  /**
   * 添加用户自定义 RSS 源。
   * @param {string} name 源名（作为 platform 标识）
   * @param {string} path RSSHub 路径，如 '/custom/foo'
   */
  setCustomRSSSource(name, path) {
    if (!name || typeof name !== 'string') {
      throw new Error('setCustomRSSSource: name 不能为空');
    }
    if (!path || typeof path !== 'string') {
      throw new Error('setCustomRSSSource: path 不能为空');
    }
    this._customSources[name] = path.startsWith('/') ? path : '/' + path;
  }

  /**
   * 列出当前可用的全部平台名（内置 + 自定义）。
   * @returns {string[]}
   */
  getAvailablePlatforms() {
    return Object.keys({ ...RSS_SOURCES, ...this._customSources });
  }

  /**
   * 取某平台的 RSSHub 路径。
   * @private
   */
  _getSourcePath(platform) {
    if (this._customSources[platform]) return this._customSources[platform];
    if (RSS_SOURCES[platform]) return RSS_SOURCES[platform];
    return null;
  }

  /**
   * 拉取多个平台的热点列表。
   * 单个平台失败不阻断其他平台。
   *
   * @param {string[]} [platforms] 平台名数组，缺省=全部
   * @param {number} [limit=20] 每平台返回数量上限
   * @returns {Promise<Hotspot[]>}
   */
  async fetchHotspots(platforms, limit = 20) {
    const all = this.getAvailablePlatforms();
    const targets = (platforms && platforms.length > 0) ? platforms : all;
    const results = await Promise.all(
      targets.map((p) => this._fetchOnePlatform(p, limit).catch((err) => {
        // 错误隔离：单平台失败记录日志，返回空数组
        console.warn('[hotspot] 拉取失败：' + p + ' →', err.message || err);
        return [];
      }))
    );
    // 合并并按热度降序
    const merged = results.flat();
    merged.sort((a, b) => (b.heat || 0) - (a.heat || 0));
    return merged;
  }

  /**
   * 关键词检索热点（在所有平台结果中过滤）。
   *
   * @param {string} keyword 关键词
   * @param {string[]} [platforms] 限定平台
   * @returns {Promise<Hotspot[]>}
   */
  async fetchByKeyword(keyword, platforms) {
    if (!keyword) return [];
    const all = await this.fetchHotspots(platforms);
    const kw = String(keyword).toLowerCase();
    return all.filter((h) => {
      const title = (h.title || '').toLowerCase();
      const summary = (h.summary || '').toLowerCase();
      return title.includes(kw) || summary.includes(kw);
    });
  }

  /**
   * 拉取单个平台的热点（带缓存与超时）。
   * @private
   */
  async _fetchOnePlatform(platform, limit) {
    const path = this._getSourcePath(platform);
    if (!path) {
      throw new Error('未知平台：' + platform);
    }
    // 1. 先查缓存
    const cached = this._readCache(platform);
    if (cached) return cached.slice(0, limit);

    // 2. 构造 RSSHub JSON URL
    const url = this.rsshubBase + path + '.json';
    // 3. fetch + 超时
    const json = await this._fetchJSONWithTimeout(url, FETCH_TIMEOUT_MS);
    // 4. 解析为 Hotspot[]
    const items = this._parseRSSHubJSON(json, platform);
    // 5. 写缓存
    this._writeCache(platform, items);
    return items.slice(0, limit);
  }

  /**
   * fetch JSON 并支持超时（AbortController）。
   * @private
   */
  async _fetchJSONWithTimeout(url, timeoutMs) {
    const fetchFn = this._getFetch();
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const resp = await fetchFn(url, controller ? { signal: controller.signal } : undefined);
      if (!resp || !resp.ok) {
        throw new Error('HTTP ' + (resp ? resp.status : 'unknown') + ' @ ' + url);
      }
      return await resp.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 解析 RSSHub JSON 响应为 Hotspot[]。
   * RSSHub JSON 格式：{ item: [{ title, link, description, pubDate, ... }] }
   * @private
   */
  _parseRSSHubJSON(json, platform) {
    if (!json) return [];
    // RSSHub JSON 通常挂在 .item 数组上
    const items = Array.isArray(json.item) ? json.item
      : Array.isArray(json.items) ? json.items
      : Array.isArray(json) ? json
      : [];
    const fetchedAt = new Date().toISOString();
    return items.map((it) => {
      const title = it.title || '';
      const summary = it.description || it.summary || it.content || '';
      const sourceUrl = it.link || it.url || '';
      // 热度解析：RSSHub 可能挂在 _extra 或 heat/dash 字段
      let heat = 0;
      if (typeof it.heat === 'number') heat = it.heat;
      else if (it._extra && typeof it._extra.score === 'number') heat = it._extra.score;
      else if (typeof it.dash === 'number') heat = it.dash;
      else if (title) heat = 50; // 无明确热度时给中位数
      return {
        title,
        heat,
        platform,
        sourceUrl,
        summary: String(summary).replace(/<[^>]+>/g, '').slice(0, 300),
        genreTags: [],
        fetchedAt,
      };
    });
  }

  /**
   * 读缓存。
   * @private
   */
  _readCache(platform) {
    try {
      const store = this._getStorage();
      if (!store) return null;
      const raw = store.getItem(CACHE_KEY_PREFIX + platform);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      // 过期检查
      if (!obj || !obj.cachedAt || Date.now() - obj.cachedAt > CACHE_TTL_MS) {
        store.removeItem(CACHE_KEY_PREFIX + platform);
        return null;
      }
      return Array.isArray(obj.items) ? obj.items : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 写缓存。
   * @private
   */
  _writeCache(platform, items) {
    try {
      const store = this._getStorage();
      if (!store) return;
      store.setItem(CACHE_KEY_PREFIX + platform, JSON.stringify({
        cachedAt: Date.now(),
        items,
      }));
    } catch (e) {
      // 存储失败（如 QuotaExceeded）不影响主流程
    }
  }

  /**
   * 清空所有平台缓存（供 UI 刷新按钮使用）。
   */
  clearCache() {
    try {
      const store = this._getStorage();
      if (!store) return;
      const platforms = this.getAvailablePlatforms();
      for (const p of platforms) {
        store.removeItem(CACHE_KEY_PREFIX + p);
      }
    } catch (e) {
      // 忽略
    }
  }

  /**
   * 取缓存时间（用于 UI 显示"上次更新：XX:XX"）。
   * @param {string} platform
   * @returns {string|null} ISO 时间戳
   */
  getCacheTime(platform) {
    try {
      const store = this._getStorage();
      if (!store) return null;
      const raw = store.getItem(CACHE_KEY_PREFIX + platform);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && obj.cachedAt ? new Date(obj.cachedAt).toISOString() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取 localStorage（运行时与测试均可用；无则返回 null）。
   * @private
   */
  _getStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
      if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
    } catch (e) {}
    return null;
  }
}

/** 工具：标准化热度到 0-100 区间（用于跨平台对比） */
export function normalizeHeat(value, max) {
  const v = Number(value) || 0;
  // 容错：非数值或缺省 max 时按 100 处理；明确传 0 也按 0 处理（避免除以 0）
  const maxNum = (typeof max === 'number') ? max : Number(max);
  const m = (!isNaN(maxNum) && maxNum !== null) ? maxNum : 100;
  if (m <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((v / m) * 100)));
}
