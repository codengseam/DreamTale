// AI 适配层单测
// 覆盖：BaseAIAdapter / MockAdapter / OpenAIAdapter (fetch mock) / IDEAdapter / ConfigManager / Factory
// 覆盖率目标 ≥ 85%

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseAIAdapter } from '../../src/ai/base-adapter.js';
import { MockAdapter } from '../../src/ai/mock-adapter.js';
import { OpenAIAdapter } from '../../src/ai/openai-adapter.js';
import { IDEAdapter } from '../../src/ai/ide-adapter.js';
import { createAIAdapter, detectAvailableAdapter } from '../../src/ai/factory.js';
import { ConfigManager } from '../../src/ai/config-manager.js';

// ---------- BaseAIAdapter ----------

describe('index.js 统一入口', () => {
  it('导出所有适配器与工厂/配置管理器', async () => {
    const ai = await import('../../src/ai/index.js');
    expect(typeof ai.BaseAIAdapter).toBe('function');
    expect(typeof ai.OpenAIAdapter).toBe('function');
    expect(typeof ai.IDEAdapter).toBe('function');
    expect(typeof ai.MockAdapter).toBe('function');
    expect(typeof ai.createAIAdapter).toBe('function');
    expect(typeof ai.detectAvailableAdapter).toBe('function');
    expect(typeof ai.ConfigManager).toBe('function');
  });
});

describe('BaseAIAdapter', () => {
  it('禁止直接实例化', () => {
    expect(() => new BaseAIAdapter({})).toThrow(/抽象/);
  });

  it('子类未 override 的方法抛错，且错误信息含子类 name', async () => {
    class Partial extends BaseAIAdapter {
      getName() { return 'partial'; }
      getType() { return 'mock'; }
    }
    const p = new Partial({});
    await expect(p.generateText('p')).rejects.toThrow(/partial/);
    await expect(p.generateStructured('p', {})).rejects.toThrow(/partial/);
    await expect((async () => {
      const gen = p.streamGenerate('p');
      await gen.next();
    })()).rejects.toThrow(/partial/);
    expect(await p.isAvailable()).toBe(false);
  });
});

// ---------- MockAdapter ----------

describe('MockAdapter', () => {
  it('getName / getType / isAvailable', async () => {
    const m = new MockAdapter();
    expect(m.getName()).toBe('mock');
    expect(m.getType()).toBe('mock');
    expect(await m.isAvailable()).toBe(true);
  });

  it('generateText 返回默认 fixture', async () => {
    const m = new MockAdapter();
    const text = await m.generateText('hello');
    expect(text).toBe('[MockAI] 这是一段 Mock 文本输出。');
  });

  it('generateText 返回自定义 fixture', async () => {
    const m = new MockAdapter({ textFixture: '自定义文本' });
    expect(await m.generateText('hi')).toBe('自定义文本');
  });

  it('generateStructured 返回默认 JSON', async () => {
    const m = new MockAdapter();
    const obj = await m.generateStructured('prompt', { type: 'object' });
    expect(obj).toEqual({ ok: true, source: 'mock', data: {} });
  });

  it('generateStructured 返回自定义 JSON 副本（不污染原 fixture）', async () => {
    const fixture = { ok: true, count: 42 };
    const m = new MockAdapter({ jsonFixture: fixture });
    const result = await m.generateStructured('p', {});
    expect(result).toEqual(fixture);
    result.count = 0;
    expect(fixture.count).toBe(42);
  });

  it('streamGenerate 逐字 yield', async () => {
    const m = new MockAdapter({ streamFixture: 'abc', delay: 0 });
    const chunks = [];
    for await (const c of m.streamGenerate('p')) chunks.push(c);
    expect(chunks.join('')).toBe('abc');
    expect(chunks.length).toBe(3);
  });

  it('streamFixture 默认回退到 textFixture', async () => {
    const m = new MockAdapter({ textFixture: 'XYZ' });
    const chunks = [];
    for await (const c of m.streamGenerate('p')) chunks.push(c);
    expect(chunks.join('')).toBe('XYZ');
  });

  it('delay 生效时不影响最终输出', async () => {
    const m = new MockAdapter({ textFixture: 'X', delay: 5 });
    const start = Date.now();
    await m.generateText('p');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(3);
  });

  it('无参数构造也能工作', async () => {
    const m = new MockAdapter();
    expect(typeof await m.generateText('p')).toBe('string');
  });
});

// ---------- OpenAIAdapter (fetch mock) ----------

/** 构造一个 SSE 流，将字符串编码为 Uint8Array */
function makeSSEStream(sseString) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseString));
      controller.close();
    }
  });
}

describe('OpenAIAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('构造：缺 apiKey 抛错', () => {
    expect(() => new OpenAIAdapter({})).toThrow(/apiKey/);
    expect(() => new OpenAIAdapter()).toThrow(/apiKey/);
  });

  it('getName / getType', () => {
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    expect(a.getName()).toBe('openai');
    expect(a.getType()).toBe('api-key');
  });

  it('默认 baseUrl / model', () => {
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    expect(a.baseUrl).toBe('https://api.openai.com/v1');
    expect(a.model).toBe('gpt-3.5-turbo');
  });

  it('baseUrl 去除末尾斜杠', () => {
    const a = new OpenAIAdapter({ apiKey: 'sk-x', baseUrl: 'https://api.deepseek.com/v1/' });
    expect(a.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('generateText 正常返回 content', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'hello world' } }]
      }),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    const text = await a.generateText('hi');
    expect(text).toBe('hello world');
    // 检查 fetch 入参
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer sk-x');
    const body = JSON.parse(init.body);
    expect(body.messages[0].content).toBe('hi');
    expect(body.stream).toBe(false);
  });

  it('generateText HTTP 错误抛错含状态码', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    });
    const a = new OpenAIAdapter({ apiKey: 'bad' });
    await expect(a.generateText('hi')).rejects.toThrow(/401/);
  });

  it('generateText 返回格式异常抛错', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    await expect(a.generateText('hi')).rejects.toThrow(/格式异常/);
  });

  it('generateStructured 返回解析后 JSON', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"name":"Tom","age":18}' } }]
      }),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    const obj = await a.generateStructured('p', { type: 'object' });
    expect(obj).toEqual({ name: 'Tom', age: 18 });
  });

  it('generateStructured 解析含 ```json 围栏的内容', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"k":"v"}\n```' } }]
      }),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    const obj = await a.generateStructured('p', {});
    expect(obj).toEqual({ k: 'v' });
  });

  it('generateStructured 解析失败抛错', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'not a json' } }]
      }),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    await expect(a.generateStructured('p', {})).rejects.toThrow(/无法解析/);
  });

  it('streamGenerate 逐字 yield SSE delta', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n'
    ].join('');
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeSSEStream(sseData),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    const chunks = [];
    for await (const c of a.streamGenerate('hi')) chunks.push(c);
    expect(chunks.join('')).toBe('Hello');
  });

  it('streamGenerate HTTP 错误抛错', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      body: null,
      text: async () => 'Server Error'
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    await expect((async () => {
      for await (const _ of a.streamGenerate('hi')) { /* drain */ }
    })()).rejects.toThrow(/500/);
  });

  it('streamGenerate 多个事件合并到一个 chunk 也能正确解析', async () => {
    const sseData = 'data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\n';
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeSSEStream(sseData),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    const chunks = [];
    for await (const c of a.streamGenerate('hi')) chunks.push(c);
    expect(chunks.join('')).toBe('AB');
  });

  it('streamGenerate: SSE 注释行与无 delta 的 data 行被忽略', async () => {
    const sseData = [
      ': this is a comment\n\n',
      'data: {"choices":[{"delta":{}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"X"}}]}\n\n'
    ].join('');
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeSSEStream(sseData),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    const chunks = [];
    for await (const c of a.streamGenerate('hi')) chunks.push(c);
    expect(chunks.join('')).toBe('X');
  });

  it('streamGenerate: 损坏的 JSON data 被静默忽略', async () => {
    const sseData = 'data: {broken\n\ndata: {"choices":[{"delta":{"content":"Y"}}]}\n\n';
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeSSEStream(sseData),
      text: async () => ''
    });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    const chunks = [];
    for await (const c of a.streamGenerate('hi')) chunks.push(c);
    expect(chunks.join('')).toBe('Y');
  });

  it('isAvailable: apiKey 为空返回 false', async () => {
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    a.apiKey = '';
    expect(await a.isAvailable()).toBe(false);
  });

  it('isAvailable: 探测 2xx 成功返回 true', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200 });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    expect(await a.isAvailable()).toBe(true);
  });

  it('isAvailable: 4xx 视为配置就绪返回 true', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    expect(await a.isAvailable()).toBe(true);
  });

  it('isAvailable: 5xx 视为不可达返回 false', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 502 });
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    expect(await a.isAvailable()).toBe(false);
  });

  it('isAvailable: 网络异常返回 false', async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error('network'));
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    expect(await a.isAvailable()).toBe(false);
  });

  it('_buildBody 支持 system / temperature / max_tokens / 自定义 messages', () => {
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    const body = a._buildBody('hi', {
      system: 'You are bot',
      temperature: 0.5,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'override' }]
    });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe('You are bot');
    expect(body.messages[1].content).toBe('override');
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
  });

  it('_parseJSON 直接 JSON 字符串', () => {
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    expect(a._parseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('_parseJSON 提取带前后噪声的 JSON', () => {
    const a = new OpenAIAdapter({ apiKey: 'sk-x' });
    expect(a._parseJSON('result: {"a":2} done')).toEqual({ a: 2 });
  });
});

// ---------- IDEAdapter ----------

describe('IDEAdapter', () => {
  it('无 IDE 环境时 isAvailable=false', async () => {
    const a = new IDEAdapter({});
    expect(await a.isAvailable()).toBe(false);
  });

  it('generateText 在无 IDE 环境时抛错', async () => {
    const a = new IDEAdapter({});
    await expect(a.generateText('p')).rejects.toThrow(/未检测到 IDE/);
  });

  it('generateStructured 在无 IDE 环境时抛错', async () => {
    const a = new IDEAdapter({});
    await expect(a.generateStructured('p', {})).rejects.toThrow(/未检测到 IDE/);
  });

  it('streamGenerate 在无 IDE 环境时抛错', async () => {
    const a = new IDEAdapter({});
    await expect((async () => {
      for await (const _ of a.streamGenerate('p')) { /* drain */ }
    })()).rejects.toThrow(/未检测到 IDE/);
  });

  it('getName / getType', () => {
    const a = new IDEAdapter({});
    expect(a.getName()).toBe('ide');
    expect(a.getType()).toBe('ide');
  });

  it('detectIDEType 在无 window 环境返回 null', () => {
    expect(IDEAdapter.detectIDEType()).toBe(null);
  });

  it('构造：未检测到 IDE 时 ideType 回退到 config 或 unknown', () => {
    const a = new IDEAdapter({ ideType: 'custom' });
    expect(a.ideType).toBe('custom');
    const b = new IDEAdapter({});
    expect(b.ideType).toBe('unknown');
  });

  it('在模拟 IDE 环境下：generateText 抛占位错', async () => {
    const original = globalThis.window;
    globalThis.window = { __TRAE_IDE__: true };
    try {
      const a = new IDEAdapter({});
      expect(await a.isAvailable()).toBe(true);
      await expect(a.generateText('p')).rejects.toThrow(/占位/);
      await expect(a.generateStructured('p', {})).rejects.toThrow(/占位/);
      await expect((async () => {
        for await (const _ of a.streamGenerate('p')) { /* drain */ }
      })()).rejects.toThrow(/占位/);
    } finally {
      globalThis.window = original;
    }
  });
});

// ---------- Factory ----------

describe('createAIAdapter / detectAvailableAdapter', () => {
  it('mode=mock 返回 MockAdapter', () => {
    const a = createAIAdapter({ mode: 'mock' });
    expect(a).toBeInstanceOf(MockAdapter);
  });

  it('mode=api-key 返回 OpenAIAdapter', () => {
    const a = createAIAdapter({ mode: 'api-key', apiKey: 'sk-x' });
    expect(a).toBeInstanceOf(OpenAIAdapter);
  });

  it('mode=ide 返回 IDEAdapter', () => {
    const a = createAIAdapter({ mode: 'ide' });
    expect(a).toBeInstanceOf(IDEAdapter);
  });

  it('mode 未知抛错', () => {
    expect(() => createAIAdapter({ mode: 'unknown' })).toThrow(/未知 mode/);
  });

  it('未指定 mode 且无可用适配器 → 默认 mock', () => {
    const a = createAIAdapter();
    expect(a).toBeInstanceOf(MockAdapter);
  });

  it('detectAvailableAdapter 在无环境时返回 null', () => {
    expect(detectAvailableAdapter()).toBe(null);
  });

  it('detectAvailableAdapter: 全局 API Key 存在时返回 api-key', () => {
    const orig = globalThis.DREAMTALE_AI_API_KEY;
    globalThis.DREAMTALE_AI_API_KEY = 'sk-global';
    try {
      expect(detectAvailableAdapter()).toBe('api-key');
    } finally {
      if (orig === undefined) delete globalThis.DREAMTALE_AI_API_KEY;
      else globalThis.DREAMTALE_AI_API_KEY = orig;
    }
  });

  it('detectAvailableAdapter: IDE 环境优先于 api-key', () => {
    const origWin = globalThis.window;
    const origKey = globalThis.DREAMTALE_AI_API_KEY;
    globalThis.window = { __TRAE_IDE__: true };
    globalThis.DREAMTALE_AI_API_KEY = 'sk-x';
    try {
      expect(detectAvailableAdapter()).toBe('ide');
    } finally {
      globalThis.window = origWin;
      if (origKey === undefined) delete globalThis.DREAMTALE_AI_API_KEY;
      else globalThis.DREAMTALE_AI_API_KEY = origKey;
    }
  });
});

// ---------- ConfigManager ----------

class MemoryStorage {
  constructor() { this._data = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; }
  setItem(k, v) { this._data[k] = String(v); }
  removeItem(k) { delete this._data[k]; }
}

describe('ConfigManager', () => {
  let storage;
  let mgr;

  beforeEach(() => {
    storage = new MemoryStorage();
    mgr = new ConfigManager({ storage });
  });

  it('初始配置为默认值', () => {
    const cfg = mgr.getConfig();
    expect(cfg.mode).toBe(null);
    expect(cfg.apiKey).toBe('');
    expect(cfg.baseUrl).toBe('');
    expect(cfg.model).toBe('');
    expect(cfg.ideType).toBe('');
  });

  it('setConfig 合并写入 + getConfig 读取副本', () => {
    mgr.setConfig({ mode: 'api-key', apiKey: 'sk-1' });
    const cfg = mgr.getConfig();
    expect(cfg.mode).toBe('api-key');
    expect(cfg.apiKey).toBe('sk-1');
    // 返回副本，修改不影响内部
    cfg.apiKey = 'changed';
    expect(mgr.getConfig().apiKey).toBe('sk-1');
  });

  it('setConfig 触发订阅回调', () => {
    let calls = 0;
    let lastCfg = null;
    const unsub = mgr.onConfigChange((c) => { calls++; lastCfg = c; });
    mgr.setConfig({ mode: 'mock' });
    expect(calls).toBe(1);
    expect(lastCfg.mode).toBe('mock');
    unsub();
    mgr.setConfig({ mode: 'api-key' });
    expect(calls).toBe(1); // 取消后不再回调
  });

  it('clearConfig 重置为默认 + 触发回调', () => {
    let calls = 0;
    mgr.onConfigChange(() => { calls++; });
    mgr.setConfig({ mode: 'mock' });
    mgr.clearConfig();
    expect(calls).toBe(2);
    const cfg = mgr.getConfig();
    expect(cfg.mode).toBe(null);
    expect(cfg.apiKey).toBe('');
  });

  it('clearConfig 后 isAIEnabled 返回 false（优雅降级）', () => {
    mgr.setConfig({ mode: 'api-key', apiKey: 'sk-1' });
    expect(mgr.isAIEnabled()).toBe(true);
    mgr.clearConfig();
    expect(mgr.isAIEnabled()).toBe(false);
  });

  it('isAIEnabled: api-key 模式需 apiKey', () => {
    mgr.setConfig({ mode: 'api-key' });
    expect(mgr.isAIEnabled()).toBe(false);
    mgr.setConfig({ mode: 'api-key', apiKey: 'sk-1' });
    expect(mgr.isAIEnabled()).toBe(true);
  });

  it('isAIEnabled: ide 模式始终返回 true', () => {
    mgr.setConfig({ mode: 'ide' });
    expect(mgr.isAIEnabled()).toBe(true);
  });

  it('isAIEnabled: mock 模式始终返回 true', () => {
    mgr.setConfig({ mode: 'mock' });
    expect(mgr.isAIEnabled()).toBe(true);
  });

  it('isAIEnabled: 无 mode 返回 false', () => {
    expect(mgr.isAIEnabled()).toBe(false);
  });

  it('持久化：新实例读取已保存配置', () => {
    mgr.setConfig({ mode: 'api-key', apiKey: 'sk-persist', baseUrl: 'https://x.com', model: 'm1' });
    const mgr2 = new ConfigManager({ storage });
    const cfg = mgr2.getConfig();
    expect(cfg.apiKey).toBe('sk-persist');
    expect(cfg.baseUrl).toBe('https://x.com');
    expect(cfg.model).toBe('m1');
  });

  it('持久化：损坏 JSON 回退到默认', () => {
    storage.setItem('dreamtale:ai-config', '{invalid json');
    const m = new ConfigManager({ storage });
    expect(m.getConfig().mode).toBe(null);
  });

  it('持久化：合并默认字段（缺失字段补默认）', () => {
    storage.setItem('dreamtale:ai-config', JSON.stringify({ mode: 'mock' }));
    const m = new ConfigManager({ storage });
    const cfg = m.getConfig();
    expect(cfg.mode).toBe('mock');
    expect(cfg.apiKey).toBe(''); // 缺失字段补默认
  });

  it('setConfig 非对象参数抛错', () => {
    expect(() => mgr.setConfig(null)).toThrow();
    expect(() => mgr.setConfig('x')).toThrow();
  });

  it('onConfigChange 非函数参数抛错', () => {
    expect(() => mgr.onConfigChange(null)).toThrow();
  });

  it('订阅者回调异常不影响其他订阅者', () => {
    mgr.onConfigChange(() => { throw new Error('boom'); });
    let ok = 0;
    mgr.onConfigChange(() => { ok++; });
    mgr.setConfig({ mode: 'mock' });
    expect(ok).toBe(1);
  });

  it('自定义 storage key', () => {
    const m1 = new ConfigManager({ storage, key: 'custom-key' });
    m1.setConfig({ mode: 'mock' });
    expect(storage.getItem('custom-key')).toBeTruthy();
    const m2 = new ConfigManager({ storage, key: 'custom-key' });
    expect(m2.getConfig().mode).toBe('mock');
  });

  it('无 storage 时不报错（优雅降级）', () => {
    const m = new ConfigManager({});
    m.setConfig({ mode: 'mock' });
    expect(m.getConfig().mode).toBe('mock');
    m.clearConfig();
    expect(m.getConfig().mode).toBe(null);
  });
});
