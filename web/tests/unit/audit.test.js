// 阶段5 审计与桥接层单测
// 覆盖：
// - ConsistencyChecker（fetch mock）
// - FileWatcher（EventSource mock）
// 覆盖率目标 ≥ 75%

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConsistencyChecker, DEFAULT_BRIDGE } from '../../src/audit/consistency-checker.js';
import { FileWatcher } from '../../src/audit/file-watcher.js';

// ============================================================
// 工具：构造 fake fetch response
// ============================================================

function makeFetchResponse(opts = {}) {
  const status = opts.status || 200;
  const ok = status >= 200 && status < 300;
  const body = opts.body != null ? opts.body : { ok: true };
  return {
    ok,
    status,
    statusText: opts.statusText || (ok ? 'OK' : 'ERROR'),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function installFetchMock(handler) {
  const original = global.fetch;
  const fn = (url, init) => {
    if (typeof handler === 'function') {
      return Promise.resolve(handler(url, init));
    }
    return Promise.resolve(makeFetchResponse(handler));
  };
  global.fetch = fn;
  return () => { global.fetch = original; };
}

// ============================================================
// 工具：构造 fake EventSource
// ============================================================

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // 0=CONNECTING, 1=OPEN, 2=CLOSED
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    this._listeners = new Map();
    // 异步触发 open
    setTimeout(() => {
      this.readyState = 1;
      if (this.onopen) this.onopen({ type: 'open' });
    }, 0);
    FakeEventSource._instances.push(this);
  }
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const arr = this._listeners.get(type);
    if (arr) {
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  close() {
    this.readyState = 2;
  }
  // 测试辅助：触发服务端推送事件
  _emit(type, data) {
    const evt = { type, data: typeof data === 'string' ? data : JSON.stringify(data) };
    if (type === 'message' && this.onmessage) this.onmessage(evt);
    const arr = this._listeners.get(type);
    if (arr) arr.forEach((h) => h(evt));
  }
  _emitError() {
    this.readyState = 2;
    if (this.onerror) this.onerror({ type: 'error' });
  }
}
FakeEventSource._instances = [];

function installEventSourceMock() {
  FakeEventSource._instances = [];
  global.EventSource = FakeEventSource;
  return () => {
    delete global.EventSource;
    FakeEventSource._instances = [];
  };
}

// ============================================================
// ConsistencyChecker
// ============================================================

describe('ConsistencyChecker', () => {
  let restoreFetch;

  beforeEach(() => {
    restoreFetch = installFetchMock(() => makeFetchResponse({ ok: true, body: { ok: true } }));
  });

  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = null;
  });

  it('默认桥接地址为 http://localhost:7861', () => {
    const c = new ConsistencyChecker();
    expect(c.bridgeUrl).toBe('http://localhost:7861');
    expect(DEFAULT_BRIDGE).toBe('http://localhost:7861');
  });

  it('尾部斜杠会被去掉', () => {
    const c = new ConsistencyChecker('http://localhost:7861/');
    expect(c.bridgeUrl).toBe('http://localhost:7861');
  });

  it('isBridgeAvailable 返回 true（健康检查通过）', async () => {
    restoreFetch();
    restoreFetch = installFetchMock((url) => {
      if (url.endsWith('/api/health')) {
        return makeFetchResponse({ body: { ok: true, service: 'dreamtale-bridge' } });
      }
      return makeFetchResponse({ status: 404, body: { ok: false } });
    });
    const c = new ConsistencyChecker();
    const ok = await c.isBridgeAvailable();
    expect(ok).toBe(true);
  });

  it('isBridgeAvailable 返回 false（fetch 抛错）', async () => {
    restoreFetch();
    restoreFetch = installFetchMock(() => {
      throw new Error('network');
    });
    const c = new ConsistencyChecker();
    const ok = await c.isBridgeAvailable();
    expect(ok).toBe(false);
  });

  it('isBridgeAvailable 返回 false（响应 ok=false）', async () => {
    restoreFetch();
    restoreFetch = installFetchMock(() => makeFetchResponse({ body: { ok: false } }));
    const c = new ConsistencyChecker();
    const ok = await c.isBridgeAvailable();
    expect(ok).toBe(false);
  });

  it('isBridgeAvailable 返回 false（HTTP 500）', async () => {
    restoreFetch();
    restoreFetch = installFetchMock(() => makeFetchResponse({ status: 500, body: {} }));
    const c = new ConsistencyChecker();
    const ok = await c.isBridgeAvailable();
    expect(ok).toBe(false);
  });

  it('checkConsistency 发送 POST /api/check/consistency', async () => {
    let captured = null;
    restoreFetch();
    restoreFetch = installFetchMock((url, init) => {
      captured = { url, init };
      return makeFetchResponse({
        body: { ok: true, report: { issues: [], stats: {} } },
      });
    });
    const c = new ConsistencyChecker();
    const result = await c.checkConsistency('/workspace/NovelForge_Vault', { chapter: 42, strict: true });
    expect(captured.url).toBe('http://localhost:7861/api/check/consistency');
    expect(captured.init.method).toBe('POST');
    const body = JSON.parse(captured.init.body);
    expect(body.vault).toBe('/workspace/NovelForge_Vault');
    expect(body.chapter).toBe(42);
    expect(body.strict).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.report).toBeDefined();
  });

  it('checkConsistency 不传 vault 时 body.vault 为 undefined', async () => {
    let captured = null;
    restoreFetch();
    restoreFetch = installFetchMock((url, init) => {
      captured = { init };
      return makeFetchResponse({ body: { ok: true } });
    });
    const c = new ConsistencyChecker();
    await c.checkConsistency();
    const body = JSON.parse(captured.init.body);
    expect(body.vault).toBeUndefined();
  });

  it('checkAINovel 调用 /api/check/ai-novel', async () => {
    let captured = null;
    restoreFetch();
    restoreFetch = installFetchMock((url, init) => {
      captured = { url, init };
      return makeFetchResponse({
        body: { ok: true, report: { issues: [{ severity: 'P1', dimension: 'info_dump' }] } },
      });
    });
    const c = new ConsistencyChecker();
    const result = await c.checkAINovel('/workspace/NovelForge_Vault');
    expect(captured.url).toBe('http://localhost:7861/api/check/ai-novel');
    expect(result.report.issues).toHaveLength(1);
  });

  it('auditHooks 调用 /api/audit/hooks，current_ch 默认为 1', async () => {
    let captured = null;
    restoreFetch();
    restoreFetch = installFetchMock((url, init) => {
      captured = { url, init };
      return makeFetchResponse({ body: { ok: true, report: { hooks: [] } } });
    });
    const c = new ConsistencyChecker();
    await c.auditHooks();
    const body = JSON.parse(captured.init.body);
    expect(captured.url).toBe('http://localhost:7861/api/audit/hooks');
    expect(body.current_ch).toBe(1);
  });

  it('auditHooks 透传 currentCh', async () => {
    let captured = null;
    restoreFetch();
    restoreFetch = installFetchMock((url, init) => {
      captured = { init };
      return makeFetchResponse({ body: { ok: true } });
    });
    const c = new ConsistencyChecker();
    await c.auditHooks('/vault', { currentCh: 42 });
    const body = JSON.parse(captured.init.body);
    expect(body.current_ch).toBe(42);
  });

  it('auditHooks 兼容 chapter 字段', async () => {
    let captured = null;
    restoreFetch();
    restoreFetch = installFetchMock((url, init) => {
      captured = { init };
      return makeFetchResponse({ body: { ok: true } });
    });
    const c = new ConsistencyChecker();
    await c.auditHooks('/vault', { chapter: 7 });
    const body = JSON.parse(captured.init.body);
    expect(body.current_ch).toBe(7);
  });

  it('triggerArchitectSkill 调用 /api/skill/architect', async () => {
    let captured = null;
    restoreFetch();
    restoreFetch = installFetchMock((url, init) => {
      captured = { url, init };
      return makeFetchResponse({ body: { ok: true, placeholder: true, skill: 'architect' } });
    });
    const c = new ConsistencyChecker();
    const result = await c.triggerArchitectSkill({ foo: 'bar' });
    expect(captured.url).toBe('http://localhost:7861/api/skill/architect');
    expect(result.placeholder).toBe(true);
    const body = JSON.parse(captured.init.body);
    expect(body.foo).toBe('bar');
  });

  it('triggerWriterPolisherSkill 调用 /api/skill/writer-polisher', async () => {
    let captured = null;
    restoreFetch();
    restoreFetch = installFetchMock((url) => {
      captured = { url };
      return makeFetchResponse({ body: { ok: true, placeholder: true } });
    });
    const c = new ConsistencyChecker();
    await c.triggerWriterPolisherSkill();
    expect(captured.url).toBe('http://localhost:7861/api/skill/writer-polisher');
  });

  it('HTTP 非 2xx 返回 ok:false + http_status', async () => {
    restoreFetch();
    restoreFetch = installFetchMock(() => makeFetchResponse({ status: 500, statusText: 'ISE', body: {} }));
    const c = new ConsistencyChecker();
    const result = await c.checkConsistency();
    expect(result.ok).toBe(false);
    expect(result.http_status).toBe(500);
    expect(result.error).toContain('500');
  });

  it('fetch 抛错时返回 ok:false + error 信息', async () => {
    restoreFetch();
    restoreFetch = installFetchMock(() => { throw new Error('boom'); });
    const c = new ConsistencyChecker();
    const result = await c.checkConsistency();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('setTimeout 可调整超时', () => {
    const c = new ConsistencyChecker();
    c.setTimeout(5000);
    expect(c._timeoutMs).toBe(5000);
  });

  it('AbortController 可用时 fetch 收到 signal', async () => {
    let signalSeen = null;
    restoreFetch();
    restoreFetch = installFetchMock((url, init) => {
      signalSeen = init && init.signal;
      return makeFetchResponse({ body: { ok: true } });
    });
    const c = new ConsistencyChecker();
    await c.checkConsistency();
    // AbortController 存在时应该传 signal
    if (typeof AbortController !== 'undefined') {
      expect(signalSeen).toBeTruthy();
    }
  });
});

// ============================================================
// FileWatcher
// ============================================================

describe('FileWatcher', () => {
  let restoreES;

  beforeEach(() => {
    restoreES = installEventSourceMock();
  });

  afterEach(() => {
    if (restoreES) restoreES();
    restoreES = null;
  });

  it('初始状态：未监听', () => {
    const fw = new FileWatcher();
    expect(fw.isWatching()).toBe(false);
    expect(fw.isConnected()).toBe(false);
  });

  it('start 后进入监听状态', () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    fw.start(() => {});
    expect(fw.isWatching()).toBe(true);
    // FakeEventSource 异步 onopen，readyState 异步变 1
    expect(fw._source).toBeTruthy();
  });

  it('start 缺回调抛错', () => {
    const fw = new FileWatcher();
    expect(() => fw.start()).toThrow(/回调/);
  });

  it('重复 start 不重新创建 EventSource（仅更新回调）', () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    fw.start(() => {});
    const src1 = fw._source;
    fw.start(() => {});
    expect(fw._source).toBe(src1);
  });

  it('stop 后状态归零', () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    fw.start(() => {});
    fw.stop();
    expect(fw.isWatching()).toBe(false);
    expect(fw._source).toBeNull();
  });

  it('vault:change 事件触发回调', async () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    const events = [];
    fw.start((ev) => events.push(ev));
    // 等待 onopen
    await new Promise((r) => setTimeout(r, 5));
    const source = FakeEventSource._instances[FakeEventSource._instances.length - 1];
    source._emit('vault:change', { type: 'modified', path: '05_正文/published/vol_01/ch_001.md', mtime: 1234567890 });
    expect(events.length).toBe(1);
    expect(events[0].event).toBe('vault:change');
    expect(events[0].data.path).toContain('ch_001.md');
    expect(events[0].data.type).toBe('modified');
  });

  it('hello 事件触发回调', async () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    const events = [];
    fw.start((ev) => events.push(ev));
    await new Promise((r) => setTimeout(r, 5));
    const source = FakeEventSource._instances[FakeEventSource._instances.length - 1];
    source._emit('hello', { ts: 123 });
    expect(events.some((e) => e.event === 'hello')).toBe(true);
  });

  it('ping 心跳事件触发回调', async () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    const events = [];
    fw.start((ev) => events.push(ev));
    await new Promise((r) => setTimeout(r, 5));
    const source = FakeEventSource._instances[FakeEventSource._instances.length - 1];
    source._emit('ping', { ts: 456 });
    expect(events.some((e) => e.event === 'ping')).toBe(true);
  });

  it('非 JSON data 字段原样返回', async () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    const events = [];
    fw.start((ev) => events.push(ev));
    await new Promise((r) => setTimeout(r, 5));
    const source = FakeEventSource._instances[FakeEventSource._instances.length - 1];
    source._emit('vault:change', 'not-json');
    expect(events[0].data).toBe('not-json');
  });

  it('回调抛错不中断监听', async () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    fw.start(() => { throw new Error('cb error'); });
    await new Promise((r) => setTimeout(r, 5));
    const source = FakeEventSource._instances[FakeEventSource._instances.length - 1];
    expect(() => source._emit('vault:change', { type: 'modified', path: 'x' })).not.toThrow();
    expect(fw.isWatching()).toBe(true);
  });

  it('onerror 触发后清理 source 并调度重连', async () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    fw.start(() => {});
    await new Promise((r) => setTimeout(r, 5));
    const source = fw._source;
    source._emitError();
    expect(fw._source).toBeNull();
    // 仍处于监听（重连中）
    expect(fw.isWatching()).toBe(true);
    // 清理定时器
    fw.stop();
  });

  it('stop 取消挂起的重连定时器', async () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    fw.start(() => {});
    await new Promise((r) => setTimeout(r, 5));
    fw._source._emitError();
    // 此时已调度重连
    expect(fw._reconnectTimer).toBeTruthy();
    fw.stop();
    expect(fw._reconnectTimer).toBeNull();
  });

  it('无 EventSource 时降级调度重连', () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(null);
    fw.start(() => {});
    expect(fw.isWatching()).toBe(true);
    // 没有创建 source，但调度了重连
    expect(fw._reconnectTimer).toBeTruthy();
    fw.stop();
  });

  it('EventSource 构造抛错时调度重连', () => {
    function ThrowingCtor() { throw new Error('ctor fail'); }
    const fw = new FileWatcher();
    fw.setEventSourceCtor(ThrowingCtor);
    fw.start(() => {});
    expect(fw._source).toBeNull();
    expect(fw._reconnectTimer).toBeTruthy();
    fw.stop();
  });

  it('isConnected 在 readyState=1 时返回 true', async () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(FakeEventSource);
    fw.start(() => {});
    await new Promise((r) => setTimeout(r, 5));
    expect(fw.isConnected()).toBe(true);
    fw.stop();
  });

  it('指数退避：首次 1s，后续翻倍至上限 30s', () => {
    const fw = new FileWatcher();
    fw.setEventSourceCtor(null); // 触发降级重连
    fw.start(() => {});
    // 第一次降级时 backoff = 1s，调度后翻倍到 2s
    expect(fw._backoffMs).toBeGreaterThanOrEqual(1000);
    // 模拟多次退避
    fw._backoffMs = 1000;
    fw._scheduleReconnect();
    expect(fw._backoffMs).toBe(2000);
    fw._scheduleReconnect();
    expect(fw._backoffMs).toBe(4000);
    fw._backoffMs = 16000;
    fw._scheduleReconnect();
    expect(fw._backoffMs).toBe(30000);
    fw._scheduleReconnect();
    expect(fw._backoffMs).toBe(30000); // 封顶
    fw.stop();
  });
});

// ============================================================
// 集成场景：ConsistencyChecker + 桥接服务返回结构化报告
// ============================================================

describe('ConsistencyChecker 集成场景', () => {
  let restoreFetch;

  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = null;
  });

  it('接收带 report 字段的完整响应', async () => {
    restoreFetch = installFetchMock(() => makeFetchResponse({
      body: {
        ok: true,
        exit_code: 0,
        stdout: '{"issues":[],"stats":{"total":0}}',
        stderr: '',
        report: { issues: [], stats: { total: 0 } },
        duration_ms: 123,
      },
    }));
    const c = new ConsistencyChecker();
    const r = await c.checkConsistency('/vault');
    expect(r.ok).toBe(true);
    expect(r.report).toBeDefined();
    expect(r.report.stats.total).toBe(0);
    expect(r.duration_ms).toBe(123);
  });

  it('接收脚本失败响应', async () => {
    restoreFetch = installFetchMock(() => makeFetchResponse({
      body: {
        ok: false,
        exit_code: 2,
        stderr: 'Vault not found',
        report: null,
      },
    }));
    const c = new ConsistencyChecker();
    const r = await c.checkConsistency('/bad/path');
    expect(r.ok).toBe(false);
    expect(r.exit_code).toBe(2);
  });
});
