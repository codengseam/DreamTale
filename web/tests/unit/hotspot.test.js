// 阶段4 扩展层测试：
// - HotspotAggregator 用 fetch mock 测试
// - genre-matcher 纯函数测试
// - InspirationLibrary CRUD 测试
// 覆盖率目标 ≥ 75%（实际目标 ≥ 90% 以满足全局门禁）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  HotspotAggregator,
  RSS_SOURCES,
  PLATFORM_LABELS,
  normalizeHeat,
} from '../../src/extension/hotspot-aggregator.js';
import {
  GENRE_KEYWORDS,
  extractGenreTags,
  scoreHotspot,
  matchByGenre,
  registerGenreKeywords,
  listGenres,
  tagHotspots,
} from '../../src/extension/genre-matcher.js';
import {
  InspirationLibrary,
  INSPIRATION_TYPES,
  TYPE_LABELS,
  _resetDBCache as _resetInspDBCache,
} from '../../src/extension/inspiration-library.js';

// ============================================================
// 工具：内存版 localStorage mock
// ============================================================

function createMemStorage() {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] || null,
  };
  return ls;
}

// ============================================================
// 工具：构造 fake fetch response
// ============================================================

function makeResp(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function makeFailResp(status = 500) {
  return { ok: false, status };
}

/** 构造 RSSHub 风格的 JSON 响应 */
function makeRSSHubJSON(items) {
  return { item: items };
}

// ============================================================
// HotspotAggregator 测试
// ============================================================

describe('HotspotAggregator 基础', () => {
  it('默认 RSSHub base', () => {
    const agg = new HotspotAggregator();
    expect(agg.rsshubBase).toBe('https://rsshub.app');
  });

  it('自定义 base 去除尾部斜杠', () => {
    const agg = new HotspotAggregator('https://example.com/rsshub/');
    expect(agg.rsshubBase).toBe('https://example.com/rsshub');
  });

  it('空 base 回退默认', () => {
    const agg = new HotspotAggregator('');
    expect(agg.rsshubBase).toBe('https://rsshub.app');
  });

  it('getAvailablePlatforms 返回 5 个内置平台', () => {
    const agg = new HotspotAggregator();
    const platforms = agg.getAvailablePlatforms();
    expect(platforms).toContain('zhihu');
    expect(platforms).toContain('weibo');
    expect(platforms).toContain('douyin');
    expect(platforms).toContain('fanqie');
    expect(platforms).toContain('xiaohongshu');
    expect(platforms.length).toBe(5);
  });

  it('RSS_SOURCES 与 PLATFORM_LABELS 导出常量', () => {
    expect(RSS_SOURCES.zhihu).toBe('/zhihu/hotlist');
    expect(PLATFORM_LABELS.zhihu).toBe('知乎');
  });
});

describe('HotspotAggregator 自定义源', () => {
  it('setCustomRSSSource 添加新平台并自动补 /', () => {
    const agg = new HotspotAggregator();
    agg.setCustomRSSSource('custom', 'custom/foo');
    expect(agg.getAvailablePlatforms()).toContain('custom');
    expect(agg._getSourcePath('custom')).toBe('/custom/foo');
  });

  it('setCustomRSSSource 接受已是 / 开头的路径', () => {
    const agg = new HotspotAggregator();
    agg.setCustomRSSSource('foo', '/bar/baz');
    expect(agg._getSourcePath('foo')).toBe('/bar/baz');
  });

  it('setCustomRSSSource 拒绝空 name', () => {
    const agg = new HotspotAggregator();
    expect(() => agg.setCustomRSSSource('', '/x')).toThrow();
  });

  it('setCustomRSSSource 拒绝空 path', () => {
    const agg = new HotspotAggregator();
    expect(() => agg.setCustomRSSSource('x', '')).toThrow();
  });

  it('_getSourcePath 对未知平台返回 null', () => {
    const agg = new HotspotAggregator();
    expect(agg._getSourcePath('nonexistent')).toBeNull();
  });
});

describe('HotspotAggregator fetchHotspots', () => {
  let agg;
  let localStorageBackup;

  beforeEach(() => {
    agg = new HotspotAggregator('https://rsshub.test');
    // 注入内存 localStorage
    localStorageBackup = globalThis.localStorage;
    globalThis.localStorage = createMemStorage();
  });

  afterEach(() => {
    globalThis.localStorage = localStorageBackup;
  });

  it('成功拉取多平台热点并按热度降序合并', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url.includes('/zhihu/')) {
        return makeResp(makeRSSHubJSON([
          { title: '知乎热点 A', link: 'https://zhihu.com/a', heat: 100, description: '修仙' },
          { title: '知乎热点 B', link: 'https://zhihu.com/b', heat: 50, description: '现代都市' },
        ]));
      }
      if (url.includes('/weibo/')) {
        return makeResp(makeRSSHubJSON([
          { title: '微博热点 X', link: 'https://weibo.com/x', heat: 200 },
        ]));
      }
      return makeFailResp(404);
    });
    agg.setFetchImpl(fetchFn);

    const result = await agg.fetchHotspots(['zhihu', 'weibo'], 20);
    expect(result.length).toBe(3);
    expect(result[0].title).toBe('微博热点 X'); // 热度 200 排第一
    expect(result[1].title).toBe('知乎热点 A');
    expect(result[2].title).toBe('知乎热点 B');
    expect(result[0].platform).toBe('weibo');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('错误隔离：单平台失败不阻断其他平台', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url.includes('/zhihu/')) {
        return makeFailResp(500);
      }
      return makeResp(makeRSSHubJSON([
        { title: '微博热点 X', link: 'https://weibo.com/x', heat: 200 },
      ]));
    });
    agg.setFetchImpl(fetchFn);

    const result = await agg.fetchHotspots(['zhihu', 'weibo'], 20);
    expect(result.length).toBe(1);
    expect(result[0].platform).toBe('weibo');
  });

  it('未指定 platforms 时拉取全部内置平台', async () => {
    const fetchFn = vi.fn(async () => makeResp(makeRSSHubJSON([])));
    agg.setFetchImpl(fetchFn);
    const result = await agg.fetchHotspots();
    expect(result.length).toBe(0);
    // 5 个内置平台
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it('limit 限制每平台返回数量', async () => {
    const fetchFn = vi.fn(async () => makeResp(makeRSSHubJSON([
      { title: 'A', heat: 10 },
      { title: 'B', heat: 20 },
      { title: 'C', heat: 30 },
    ])));
    agg.setFetchImpl(fetchFn);
    const result = await agg.fetchHotspots(['zhihu'], 2);
    expect(result.length).toBe(2);
  });

  it('未注入 fetch 且全局无 fetch 时静默返回空数组（错误隔离）', async () => {
    // 临时移除 globalThis.fetch
    const origFetch = globalThis.fetch;
    delete globalThis.fetch;
    try {
      const agg2 = new HotspotAggregator();
      // 错误隔离：fetch 缺失不抛错，单平台失败返回 []
      const r = await agg2.fetchHotspots(['zhihu']);
      expect(r).toEqual([]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('未注入 fetch 直接调用 _getFetch 抛错', () => {
    const origFetch = globalThis.fetch;
    delete globalThis.fetch;
    try {
      const agg2 = new HotspotAggregator();
      expect(() => agg2._getFetch()).toThrow();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('HotspotAggregator 缓存', () => {
  let agg;
  let localStorageBackup;

  beforeEach(() => {
    agg = new HotspotAggregator('https://rsshub.test');
    localStorageBackup = globalThis.localStorage;
    globalThis.localStorage = createMemStorage();
  });

  afterEach(() => {
    globalThis.localStorage = localStorageBackup;
  });

  it('缓存命中后不再触发 fetch', async () => {
    const fetchFn = vi.fn(async () => makeResp(makeRSSHubJSON([
      { title: '缓存测试', heat: 80 },
    ])));
    agg.setFetchImpl(fetchFn);

    // 第一次：触发 fetch + 写缓存
    const r1 = await agg.fetchHotspots(['zhihu'], 10);
    expect(r1.length).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // 第二次：应命中缓存
    const r2 = await agg.fetchHotspots(['zhihu'], 10);
    expect(r2.length).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1); // 仍是 1
  });

  it('getCacheTime 返回缓存时间', async () => {
    const fetchFn = vi.fn(async () => makeResp(makeRSSHubJSON([
      { title: '缓存测试', heat: 80 },
    ])));
    agg.setFetchImpl(fetchFn);
    expect(agg.getCacheTime('zhihu')).toBeNull();
    await agg.fetchHotspots(['zhihu'], 10);
    const t = agg.getCacheTime('zhihu');
    expect(t).toBeTruthy();
    expect(new Date(t).getTime()).toBeGreaterThan(0);
  });

  it('clearCache 清除所有平台缓存', async () => {
    const fetchFn = vi.fn(async () => makeResp(makeRSSHubJSON([
      { title: '缓存测试', heat: 80 },
    ])));
    agg.setFetchImpl(fetchFn);
    await agg.fetchHotspots(['zhihu'], 10);
    expect(agg.getCacheTime('zhihu')).toBeTruthy();
    agg.clearCache();
    expect(agg.getCacheTime('zhihu')).toBeNull();
  });

  it('缓存过期后重新 fetch', async () => {
    const fetchFn = vi.fn(async () => makeResp(makeRSSHubJSON([
      { title: '过期测试', heat: 80 },
    ])));
    agg.setFetchImpl(fetchFn);
    await agg.fetchHotspots(['zhihu'], 10);

    // 模拟缓存过期：手动改 cachedAt 为 1 小时前
    const raw = globalThis.localStorage.getItem('dreamtale:hotspot:zhihu');
    const obj = JSON.parse(raw);
    obj.cachedAt = Date.now() - 60 * 60 * 1000; // 1 小时前
    globalThis.localStorage.setItem('dreamtale:hotspot:zhihu', JSON.stringify(obj));

    await agg.fetchHotspots(['zhihu'], 10);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('无 localStorage 时缓存读写静默失效', async () => {
    delete globalThis.localStorage;
    const fetchFn = vi.fn(async () => makeResp(makeRSSHubJSON([
      { title: '无存储测试', heat: 80 },
    ])));
    agg.setFetchImpl(fetchFn);
    const r = await agg.fetchHotspots(['zhihu'], 10);
    expect(r.length).toBe(1);
    expect(agg.getCacheTime('zhihu')).toBeNull();
  });

  it('缓存 JSON 解析失败时返回 null', async () => {
    globalThis.localStorage.setItem('dreamtale:hotspot:zhihu', '{not valid json');
    const fetchFn = vi.fn(async () => makeResp(makeRSSHubJSON([
      { title: '解析测试', heat: 80 },
    ])));
    agg.setFetchImpl(fetchFn);
    const r = await agg.fetchHotspots(['zhihu'], 10);
    expect(r.length).toBe(1); // 缓存无效，走 fetch
  });
});

describe('HotspotAggregator fetchByKeyword', () => {
  let agg;
  let localStorageBackup;

  beforeEach(() => {
    agg = new HotspotAggregator('https://rsshub.test');
    localStorageBackup = globalThis.localStorage;
    globalThis.localStorage = createMemStorage();
  });

  afterEach(() => {
    globalThis.localStorage = localStorageBackup;
  });

  it('关键词命中标题', async () => {
    agg.setFetchImpl(async (url) => {
      // 单平台返回 2 条
      if (url.includes('/zhihu/')) {
        return makeResp(makeRSSHubJSON([
          { title: '修仙法宝全解', heat: 100 },
          { title: '都市职场日常', heat: 50 },
        ]));
      }
      // 其他平台无数据
      return makeResp(makeRSSHubJSON([]));
    });
    const r = await agg.fetchByKeyword('修仙', ['zhihu']);
    expect(r.length).toBe(1);
    expect(r[0].title).toContain('修仙');
  });

  it('关键词命中摘要', async () => {
    agg.setFetchImpl(async (url) => {
      if (url.includes('/zhihu/')) {
        return makeResp(makeRSSHubJSON([
          { title: '热搜 A', description: '今天聊聊修仙体系', heat: 100 },
          { title: '热搜 B', description: '都市话题', heat: 50 },
        ]));
      }
      return makeResp(makeRSSHubJSON([]));
    });
    const r = await agg.fetchByKeyword('修仙', ['zhihu']);
    expect(r.length).toBe(1);
  });

  it('空关键词返回空数组', async () => {
    agg.setFetchImpl(async () => makeResp(makeRSSHubJSON([
      { title: 'A', heat: 100 },
    ])));
    const r = await agg.fetchByKeyword('');
    expect(r).toEqual([]);
  });

  it('限定平台', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url.includes('/zhihu/')) return makeResp(makeRSSHubJSON([{ title: '知乎A', heat: 100 }]));
      if (url.includes('/weibo/')) return makeResp(makeRSSHubJSON([{ title: '微博A', heat: 100 }]));
      return makeFailResp();
    });
    agg.setFetchImpl(fetchFn);
    const r = await agg.fetchByKeyword('A', ['zhihu']);
    expect(r.length).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('HotspotAggregator _parseRSSHubJSON', () => {
  let agg;
  beforeEach(() => {
    agg = new HotspotAggregator();
  });

  it('处理 json.item 数组', () => {
    const items = agg._parseRSSHubJSON({ item: [{ title: 'A', heat: 10 }] }, 'zhihu');
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('A');
    expect(items[0].platform).toBe('zhihu');
  });

  it('处理 json.items 数组（备选字段）', () => {
    const items = agg._parseRSSHubJSON({ items: [{ title: 'B' }] }, 'weibo');
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('B');
  });

  it('处理裸数组', () => {
    const items = agg._parseRSSHubJSON([{ title: 'C' }], 'douyin');
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('C');
  });

  it('空 JSON 返回 []', () => {
    expect(agg._parseRSSHubJSON(null, 'zhihu')).toEqual([]);
    expect(agg._parseRSSHubJSON({}, 'zhihu')).toEqual([]);
  });

  it('热度解析：heat 字段优先', () => {
    const items = agg._parseRSSHubJSON({ item: [{ title: 'A', heat: 999 }] }, 'zhihu');
    expect(items[0].heat).toBe(999);
  });

  it('热度解析：_extra.score 备选', () => {
    const items = agg._parseRSSHubJSON({ item: [{ title: 'A', _extra: { score: 80 } }] }, 'zhihu');
    expect(items[0].heat).toBe(80);
  });

  it('热度解析：dash 字段备选', () => {
    const items = agg._parseRSSHubJSON({ item: [{ title: 'A', dash: 42 }] }, 'zhihu');
    expect(items[0].heat).toBe(42);
  });

  it('无明确热度且有标题时给 50', () => {
    const items = agg._parseRSSHubJSON({ item: [{ title: 'A' }] }, 'zhihu');
    expect(items[0].heat).toBe(50);
  });

  it('strip HTML 标签并截断长摘要', () => {
    const longSummary = '<p>' + 'A'.repeat(500) + '</p>';
    const items = agg._parseRSSHubJSON({ item: [{ title: 'A', description: longSummary }] }, 'zhihu');
    expect(items[0].summary).not.toMatch(/<[^>]+>/);
    expect(items[0].summary.length).toBe(300);
  });

  it('链接解析：link 优先，url 备选', () => {
    const a = agg._parseRSSHubJSON({ item: [{ title: 'A', link: 'https://a' }] }, 'zhihu');
    expect(a[0].sourceUrl).toBe('https://a');
    const b = agg._parseRSSHubJSON({ item: [{ title: 'B', url: 'https://b' }] }, 'zhihu');
    expect(b[0].sourceUrl).toBe('https://b');
  });

  it('fetchedAt 字段是 ISO 时间戳', () => {
    const items = agg._parseRSSHubJSON({ item: [{ title: 'A' }] }, 'zhihu');
    expect(items[0].fetchedAt).toBeTruthy();
    expect(new Date(items[0].fetchedAt).getTime()).toBeGreaterThan(0);
  });

  it('genreTags 默认空数组', () => {
    const items = agg._parseRSSHubJSON({ item: [{ title: 'A' }] }, 'zhihu');
    expect(items[0].genreTags).toEqual([]);
  });
});

describe('normalizeHeat 工具', () => {
  it('基础归一化', () => {
    expect(normalizeHeat(50, 100)).toBe(50);
    expect(normalizeHeat(0, 100)).toBe(0);
    expect(normalizeHeat(100, 100)).toBe(100);
  });

  it('超限裁剪到 100', () => {
    expect(normalizeHeat(150, 100)).toBe(100);
  });

  it('max 为 0 时返回 0', () => {
    expect(normalizeHeat(50, 0)).toBe(0);
  });

  it('非数值参数容错', () => {
    expect(normalizeHeat('abc', 'xyz')).toBe(0);
  });
});

// ============================================================
// genre-matcher 测试
// ============================================================

describe('genre-matcher 基础', () => {
  it('listGenres 返回 6 大题材', () => {
    const g = listGenres();
    expect(g).toContain('玄幻');
    expect(g).toContain('都市');
    expect(g).toContain('历史');
    expect(g).toContain('言情');
    expect(g).toContain('科幻');
    expect(g).toContain('悬疑');
    expect(g.length).toBe(6);
  });

  it('GENRE_KEYWORDS 导出可读', () => {
    expect(GENRE_KEYWORDS['玄幻']).toContain('修仙');
  });
});

describe('extractGenreTags', () => {
  it('匹配中文关键词', () => {
    const tags = extractGenreTags('主角入山门修仙，炼丹法门');
    expect(tags).toContain('玄幻');
  });

  it('匹配多个题材', () => {
    const tags = extractGenreTags('修仙者在都市里重生，开宗立派');
    expect(tags).toContain('玄幻');
    expect(tags).toContain('都市');
  });

  it('英文关键词大小写不敏感', () => {
    const tags = extractGenreTags('AI takes over the world');
    expect(tags).toContain('科幻');
  });

  it('空文本返回 []', () => {
    expect(extractGenreTags('')).toEqual([]);
    expect(extractGenreTags(null)).toEqual([]);
    expect(extractGenreTags(undefined)).toEqual([]);
  });

  it('无匹配返回 []', () => {
    const tags = extractGenreTags('今天天气真好');
    expect(tags).toEqual([]);
  });
});

describe('registerGenreKeywords', () => {
  it('扩展已有题材的关键词', () => {
    const origLen = GENRE_KEYWORDS['玄幻'].length;
    registerGenreKeywords('玄幻', ['新词1', '修仙']); // 修仙 已存在，应去重
    expect(GENRE_KEYWORDS['玄幻']).toContain('新词1');
    expect(GENRE_KEYWORDS['玄幻'].length).toBe(origLen + 1);
  });

  it('新增题材', () => {
    registerGenreKeywords('新题材', ['关键词A']);
    expect(GENRE_KEYWORDS['新题材']).toContain('关键词A');
    expect(listGenres()).toContain('新题材');
  });

  it('非法入参静默忽略', () => {
    registerGenreKeywords('', ['x']);
    registerGenreKeywords('x', null);
    // 不抛错即通过
    expect(true).toBe(true);
  });
});

describe('scoreHotspot', () => {
  it('未知题材返回 0', () => {
    const s = scoreHotspot({ title: '修仙', heat: 100 }, '不存在题材');
    expect(s).toBe(0);
  });

  it('空 hotspot 返回 0', () => {
    expect(scoreHotspot(null, '玄幻')).toBe(0);
    expect(scoreHotspot({}, '')).toBe(0);
  });

  it('匹配关键词越多分越高', () => {
    const less = scoreHotspot({ title: '修仙', heat: 0 }, '玄幻');
    const more = scoreHotspot({ title: '修仙 剑 法宝 阵法 元婴 渡劫', heat: 0 }, '玄幻');
    expect(more).toBeGreaterThan(less);
  });

  it('热度加分', () => {
    const low = scoreHotspot({ title: '修仙', heat: 0 }, '玄幻');
    const high = scoreHotspot({ title: '修仙', heat: 10000 }, '玄幻');
    expect(high).toBeGreaterThan(low);
  });

  it('返回值在 0-1 范围', () => {
    const s = scoreHotspot({ title: '修仙 剑 法宝 阵法 元婴 渡劫 飞升 灵气 丹药 神兽', heat: 99999 }, '玄幻');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('无匹配关键词但有热度时仍返回非零分（热度加权）', () => {
    const s = scoreHotspot({ title: '今天天气真好', heat: 5000 }, '玄幻');
    expect(s).toBeGreaterThan(0);
  });
});

describe('matchByGenre', () => {
  it('按阈值过滤', () => {
    const hots = [
      { title: '修仙法宝元婴渡劫', summary: '剑 阵法 灵气', heat: 100 },
      { title: '今天天气真好', summary: '无关联', heat: 0 },
    ];
    const r = matchByGenre(hots, '玄幻', { threshold: 0.1 });
    expect(r.length).toBe(1);
    expect(r[0].title).toContain('修仙');
  });

  it('按 score 降序', () => {
    const hots = [
      { title: '修仙', heat: 0 },
      { title: '修仙 剑 法宝 阵法 元婴', heat: 100 },
    ];
    const r = matchByGenre(hots, '玄幻', { threshold: 0 });
    expect(r.length).toBe(2);
    expect(r[0]._score).toBeGreaterThanOrEqual(r[1]._score);
  });

  it('附加 genreTags', () => {
    const hots = [{ title: '修仙', summary: '', heat: 0 }];
    const r = matchByGenre(hots, '玄幻', { threshold: 0 });
    expect(r[0].genreTags).toContain('玄幻');
  });

  it('withTags=false 保留原 genreTags', () => {
    const hots = [{ title: '修仙', summary: '', heat: 0, genreTags: ['已有'] }];
    const r = matchByGenre(hots, '玄幻', { threshold: 0, withTags: false });
    expect(r[0].genreTags).toEqual(['已有']);
  });

  it('空数组返回空', () => {
    expect(matchByGenre([], '玄幻')).toEqual([]);
    expect(matchByGenre(null, '玄幻')).toEqual([]);
    expect(matchByGenre([{ title: 'A' }], '')).toEqual([]);
  });
});

describe('tagHotspots', () => {
  it('原地给热点打题材标签', () => {
    const hots = [
      { title: '修仙', summary: '', genreTags: [] },
      { title: '今天天气', summary: '', genreTags: [] },
    ];
    tagHotspots(hots);
    expect(hots[0].genreTags).toContain('玄幻');
    expect(hots[1].genreTags).toEqual([]);
  });

  it('非数组入参返回空数组', () => {
    expect(tagHotspots(null)).toEqual([]);
  });
});

// ============================================================
// InspirationLibrary 测试
// ============================================================

describe('InspirationLibrary 常量', () => {
  it('INSPIRATION_TYPES 含 8 大类', () => {
    expect(INSPIRATION_TYPES.length).toBe(8);
    expect(INSPIRATION_TYPES).toContain('idea');
    expect(INSPIRATION_TYPES).toContain('voice');
    expect(INSPIRATION_TYPES).toContain('snippet');
    expect(INSPIRATION_TYPES).toContain('character');
    expect(INSPIRATION_TYPES).toContain('worldview');
    expect(INSPIRATION_TYPES).toContain('golden_finger');
    expect(INSPIRATION_TYPES).toContain('highlight');
    expect(INSPIRATION_TYPES).toContain('material');
  });

  it('TYPE_LABELS 中文映射完整', () => {
    for (const t of INSPIRATION_TYPES) {
      expect(TYPE_LABELS[t]).toBeTruthy();
    }
  });
});

describe('InspirationLibrary CRUD', () => {
  let lib;

  beforeEach(async () => {
    _resetInspDBCache();
    lib = new InspirationLibrary();
    await lib.clearAll();
  });

  afterEach(async () => {
    if (lib) await lib.clearAll();
    _resetInspDBCache();
  });

  it('addInspiration 自动生成 id 与时间戳', async () => {
    const ins = await lib.addInspiration({
      type: 'idea',
      title: '测试灵感',
      content: '内容',
      tags: ['修仙', '剑'],
    });
    expect(ins.id).toBeTruthy();
    expect(ins.id.startsWith('INS_')).toBe(true);
    expect(ins.title).toBe('测试灵感');
    expect(ins.tags).toEqual(['修仙', '剑']);
    expect(ins.createdAt).toBeTruthy();
    expect(ins.updatedAt).toBeTruthy();
  });

  it('addInspiration 默认 type=idea', async () => {
    const ins = await lib.addInspiration({ title: 'X' });
    expect(ins.type).toBe('idea');
  });

  it('addInspiration 拒绝非法 type', async () => {
    await expect(lib.addInspiration({ type: '非法', title: 'X' })).rejects.toThrow();
  });

  it('addInspiration 拒绝非对象入参', async () => {
    await expect(lib.addInspiration(null)).rejects.toThrow();
    await expect(lib.addInspiration('xxx')).rejects.toThrow();
  });

  it('listInspirations 返回全部并按 createdAt 降序', async () => {
    await lib.addInspiration({ type: 'idea', title: 'A', createdAt: '2026-01-01T00:00:00.000Z' });
    await lib.addInspiration({ type: 'idea', title: 'B', createdAt: '2026-02-01T00:00:00.000Z' });
    await lib.addInspiration({ type: 'idea', title: 'C', createdAt: '2026-03-01T00:00:00.000Z' });
    const list = await lib.listInspirations();
    expect(list.length).toBe(3);
    expect(list[0].title).toBe('C');
    expect(list[2].title).toBe('A');
  });

  it('listInspirations 按类型筛选', async () => {
    await lib.addInspiration({ type: 'idea', title: 'A' });
    await lib.addInspiration({ type: 'snippet', title: 'B' });
    const list = await lib.listInspirations('snippet');
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('B');
  });

  it('listInspirations 按标签筛选（任一命中）', async () => {
    await lib.addInspiration({ type: 'idea', title: 'A', tags: ['修仙', '剑'] });
    await lib.addInspiration({ type: 'idea', title: 'B', tags: ['都市'] });
    await lib.addInspiration({ type: 'idea', title: 'C', tags: ['剑', '法宝'] });
    const list = await lib.listInspirations(null, ['剑']);
    expect(list.length).toBe(2);
    const titles = list.map((x) => x.title).sort();
    expect(titles).toEqual(['A', 'C']);
  });

  it('listInspirations 拒绝非法 type', async () => {
    await expect(lib.listInspirations('非法')).rejects.toThrow();
  });

  it('getInspiration 取单条', async () => {
    const ins = await lib.addInspiration({ type: 'idea', title: 'X' });
    const got = await lib.getInspiration(ins.id);
    expect(got).toBeTruthy();
    expect(got.title).toBe('X');
  });

  it('getInspiration 不存在返回 null', async () => {
    expect(await lib.getInspiration('nonexistent')).toBeNull();
  });

  it('getInspiration 空 id 返回 null', async () => {
    expect(await lib.getInspiration('')).toBeNull();
    expect(await lib.getInspiration(null)).toBeNull();
  });

  it('updateInspiration 合并字段并更新 updatedAt', async () => {
    const ins = await lib.addInspiration({ type: 'idea', title: '原标题', content: '原内容' });
    const before = ins.updatedAt;
    // 等待时间推进
    await new Promise((r) => setTimeout(r, 10));
    const updated = await lib.updateInspiration(ins.id, { title: '新标题', tags: ['新标签'] });
    expect(updated.title).toBe('新标题');
    expect(updated.tags).toEqual(['新标签']);
    expect(updated.content).toBe('原内容'); // 未传字段保留
    expect(updated.id).toBe(ins.id); // id 不可改
    expect(updated.createdAt).toBe(ins.createdAt); // createdAt 不可改
    expect(updated.updatedAt).not.toBe(before);
  });

  it('updateInspiration 拒绝未知 id', async () => {
    await expect(lib.updateInspiration('nonexistent', { title: 'X' })).rejects.toThrow();
  });

  it('updateInspiration 拒绝非法 type', async () => {
    const ins = await lib.addInspiration({ type: 'idea', title: 'X' });
    await expect(lib.updateInspiration(ins.id, { type: '非法' })).rejects.toThrow();
  });

  it('updateInspiration 拒绝空 id 或非对象 patch', async () => {
    await expect(lib.updateInspiration('', { x: 1 })).rejects.toThrow();
    await expect(lib.updateInspiration('x', null)).rejects.toThrow();
  });

  it('deleteInspiration 删除后不可查', async () => {
    const ins = await lib.addInspiration({ type: 'idea', title: 'X' });
    await lib.deleteInspiration(ins.id);
    expect(await lib.getInspiration(ins.id)).toBeNull();
  });

  it('deleteInspiration 空 id 抛错', async () => {
    await expect(lib.deleteInspiration('')).rejects.toThrow();
  });
});

describe('InspirationLibrary 搜索', () => {
  let lib;

  beforeEach(async () => {
    _resetInspDBCache();
    lib = new InspirationLibrary();
    await lib.clearAll();
  });

  afterEach(async () => {
    if (lib) await lib.clearAll();
    _resetInspDBCache();
  });

  it('按标题匹配', async () => {
    await lib.addInspiration({ type: 'idea', title: '修仙体系', content: '' });
    await lib.addInspiration({ type: 'idea', title: '都市职场', content: '' });
    const r = await lib.searchInspirations('修仙');
    expect(r.length).toBe(1);
    expect(r[0].title).toBe('修仙体系');
  });

  it('按内容匹配', async () => {
    await lib.addInspiration({ type: 'idea', title: 'A', content: '内容包含修仙关键词' });
    await lib.addInspiration({ type: 'idea', title: 'B', content: '无关内容' });
    const r = await lib.searchInspirations('修仙');
    expect(r.length).toBe(1);
    expect(r[0].title).toBe('A');
  });

  it('按标签匹配', async () => {
    await lib.addInspiration({ type: 'idea', title: 'A', content: '', tags: ['修仙', '剑'] });
    await lib.addInspiration({ type: 'idea', title: 'B', content: '', tags: ['都市'] });
    const r = await lib.searchInspirations('修仙');
    expect(r.length).toBe(1);
    expect(r[0].title).toBe('A');
  });

  it('空关键词返回空数组', async () => {
    await lib.addInspiration({ type: 'idea', title: 'X' });
    expect(await lib.searchInspirations('')).toEqual([]);
  });
});

describe('InspirationLibrary 导入导出', () => {
  let lib;

  beforeEach(async () => {
    _resetInspDBCache();
    lib = new InspirationLibrary();
    await lib.clearAll();
  });

  afterEach(async () => {
    if (lib) await lib.clearAll();
    _resetInspDBCache();
  });

  it('exportToMarkdown 空库返回占位', async () => {
    const md = await lib.exportToMarkdown();
    expect(md).toContain('# 灵感库');
    expect(md).toContain('暂无灵感');
  });

  it('exportToMarkdown 按类型分组并包含字段', async () => {
    await lib.addInspiration({
      type: 'idea',
      title: '灵感A',
      content: '内容A',
      tags: ['修仙'],
      sourceUrl: 'https://example.com',
      relatedChapter: 'vol_01/ch_001',
    });
    await lib.addInspiration({
      type: 'snippet',
      title: '片段B',
      content: '内容B',
    });
    const md = await lib.exportToMarkdown();
    expect(md).toContain('## 灵感');
    expect(md).toContain('## 片段');
    expect(md).toContain('### 灵感A');
    expect(md).toContain('### 片段B');
    expect(md).toContain('**标签**：修仙');
    expect(md).toContain('**来源**：https://example.com');
    expect(md).toContain('**关联章节**：vol_01/ch_001');
  });

  it('importFromMarkdown 往返：导出→导入数据等价', async () => {
    await lib.addInspiration({
      type: 'idea',
      title: '原始灵感',
      content: '原始内容',
      tags: ['修仙', '剑'],
    });
    const md = await lib.exportToMarkdown();
    await lib.clearAll();
    const inserted = await lib.importFromMarkdown(md);
    expect(inserted.length).toBe(1);
    expect(inserted[0].title).toBe('原始灵感');
    expect(inserted[0].content).toBe('原始内容');
    expect(inserted[0].tags).toEqual(['修仙', '剑']);
    expect(inserted[0].type).toBe('idea');
  });

  it('importFromMarkdown 空入参返回空', async () => {
    expect(await lib.importFromMarkdown('')).toEqual([]);
    expect(await lib.importFromMarkdown(null)).toEqual([]);
  });

  it('importFromMarkdown 解析多段落', async () => {
    const md = `# 灵感库

## 灵感（idea）

### 灵感一

- **类型**：idea
- **标签**：修仙, 剑
- **创建时间**：2026-01-01T00:00:00.000Z

内容一

---

### 灵感二

- **类型**：idea

内容二

---
`;
    const inserted = await lib.importFromMarkdown(md);
    expect(inserted.length).toBe(2);
    expect(inserted[0].title).toBe('灵感一');
    expect(inserted[0].content).toBe('内容一');
    expect(inserted[0].tags).toEqual(['修仙', '剑']);
    expect(inserted[1].title).toBe('灵感二');
    expect(inserted[1].content).toBe('内容二');
  });

  it('importFromMarkdown 非法类型回退为 idea', async () => {
    const md = `# 灵感库

## 灵感（idea）

### 测试

- **类型**：非法类型

内容
`;
    const inserted = await lib.importFromMarkdown(md);
    expect(inserted.length).toBe(1);
    expect(inserted[0].type).toBe('idea');
  });

  it('clearAll 清空全部', async () => {
    await lib.addInspiration({ type: 'idea', title: 'X' });
    await lib.addInspiration({ type: 'snippet', title: 'Y' });
    expect((await lib.listInspirations()).length).toBe(2);
    await lib.clearAll();
    expect((await lib.listInspirations()).length).toBe(0);
  });
});
