// 阶段3 AI 创作辅助模块单测
// 覆盖：manifest-loader / outline-generator / highlight-miner / text-polisher
// 覆盖率目标 ≥ 80%
//
// 策略：
// - 用 MockAdapter（自定义 fixture）驱动各模块全流程
// - manifest-loader：mock fetch + 自定义 localStorage 验证缓存
// - 显式覆盖 fallback 分支（manifest 加载失败时走内置兜底 prompt）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAdapter } from '../../src/ai/mock-adapter.js';
import {
  loadSkillManifest,
  getSkillPrompt,
  fillPromptTemplate,
  clearManifestCache
} from '../../src/modules/manifest-loader.js';
import { OutlineGenerator } from '../../src/modules/outline-generator.js';
import { HighlightMiner } from '../../src/modules/highlight-miner.js';
import { TextPolisher } from '../../src/modules/text-polisher.js';

// ---------- 测试用 fixture ----------

const FAKE_MANIFEST = {
  version: '1.0',
  skills: {
    outline_generator: {
      name: '章纲生成',
      system_prompt: 'SYS_OUTLINE',
      user_prompt_template: '项目={{project}} 卷={{volume}} 世界观={{worldSetting}} 角色={{characters}} 前情={{previousChapters}} 伏笔={{hooks}} 额外={{extra_requirement}}',
      output_format: 'json',
      schema: { sections: ['章节信息'] }
    },
    highlight_miner: {
      name: '爽点挖掘',
      system_prompt: 'SYS_HIGHLIGHT',
      user_prompt_template: '章节={{chapter}} 角色={{characters}} 题材={{genre}} 已有={{previousHighlights}}',
      output_format: 'json',
      schema: { highlights: [] }
    },
    text_polisher: {
      name: '文本润色',
      system_prompt: 'SYS_POLISHER',
      user_prompt_template: '级别={{level}} 文本={{text}}',
      output_format: 'text',
      levels: ['light', 'medium', 'deep']
    },
    typo_checker: {
      name: '错别字检查',
      system_prompt: 'SYS_TYPO',
      user_prompt_template: '文本={{text}}',
      output_format: 'json',
      schema: { errors: [] }
    },
    ai_taste_remover: {
      name: '去AI味优化',
      system_prompt: 'SYS_AITASTE',
      user_prompt_template: '文本={{text}}',
      output_format: 'text'
    }
  }
};

const OUTLINE_FIXTURE = {
  chapter_info: { vol_no: 'vol_01', ch_no: 'ch_001', word_target: 2800, chapter_type: 'regular' },
  core_conflict: '主角与反派争夺玉简',
  scenes: ['场景一：拍卖会·主角·竞拍'],
  characters: [{ name: '主角', role_in_chapter: '竞拍者' }],
  hook_ops: { planted: ['H-001'], resolved: [], reminded: [] },
  highlights: [{ type: '打脸', presentation: '反派被打脸' }],
  chapter_hook: '玉简突然共鸣',
  rhythm: { climax: 3, depression: 2, emotion_trend: '上扬' },
  context_recall: ['ch_001_主角.md'],
  must_keep: ['玉简'],
  must_avoid: ['现代用语']
};

const HIGHLIGHT_FIXTURE = {
  highlights: [
    { type: '打脸', description: '反派当众出丑', strength: 4, chapter_position: '后段' },
    { type: '逆袭', description: '主角反超', strength: 5, chapter_position: '章末钩子' }
  ]
};

const TYPO_FIXTURE = {
  errors: [
    { line: 2, original: '那里', suggestion: '哪里', type: 'typo' },
    { line: 5, original: '因为所以', suggestion: '因为……所以', type: 'grammar' }
  ]
};

// ---------- 简易 localStorage mock ----------

function makeFakeStorage() {
  const store = new Map();
  return {
    getItem: function (k) { return store.has(k) ? store.get(k) : null; },
    setItem: function (k, v) { store.set(k, String(v)); },
    removeItem: function (k) { store.delete(k); },
    clear: function () { store.clear(); },
    _store: store
  };
}

// ---------- manifest-loader ----------

describe('manifest-loader', () => {
  let fakeStorage;
  let originalFetch;

  beforeEach(() => {
    fakeStorage = makeFakeStorage();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loadSkillManifest: 通过 fetch 加载并写入缓存', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FAKE_MANIFEST
    }));
    const m = await loadSkillManifest({ storage: fakeStorage });
    expect(m.version).toBe('1.0');
    expect(m.skills.outline_generator).toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // 缓存已写入
    expect(fakeStorage._store.size).toBe(1);
  });

  it('loadSkillManifest: 命中未过期缓存时不发 fetch', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FAKE_MANIFEST
    }));
    await loadSkillManifest({ storage: fakeStorage });
    const fetchCountAfterFirst = global.fetch.mock.calls.length;
    // 第二次应命中缓存
    const m2 = await loadSkillManifest({ storage: fakeStorage });
    expect(m2.version).toBe('1.0');
    expect(global.fetch.mock.calls.length).toBe(fetchCountAfterFirst);
  });

  it('loadSkillManifest: force=true 强制刷新', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FAKE_MANIFEST
    }));
    await loadSkillManifest({ storage: fakeStorage });
    await loadSkillManifest({ storage: fakeStorage, force: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('loadSkillManifest: fetch 返回非 200 抛错', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    await expect(loadSkillManifest({ storage: fakeStorage, force: true }))
      .rejects.toThrow(/HTTP 404/);
  });

  it('loadSkillManifest: manifest 格式非法（缺 skills）抛错', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.0' })
    }));
    await expect(loadSkillManifest({ storage: fakeStorage, force: true }))
      .rejects.toThrow(/格式非法/);
  });

  it('loadSkillManifest: 无 fetch 且无缓存抛错', async () => {
    delete global.fetch;
    await expect(loadSkillManifest({ storage: fakeStorage, force: true }))
      .rejects.toThrow(/无 fetch/);
  });

  it('loadSkillManifest: 缓存过期后重新 fetch', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FAKE_MANIFEST
    }));
    // 写入过期缓存
    fakeStorage.setItem('dreamtale:skills-manifest', JSON.stringify({
      __ts: Date.now() - 11 * 60 * 1000, // 11 分钟前，已过期
      manifest: FAKE_MANIFEST
    }));
    await loadSkillManifest({ storage: fakeStorage });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('clearManifestCache: 清除缓存', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FAKE_MANIFEST
    }));
    await loadSkillManifest({ storage: fakeStorage });
    expect(fakeStorage._store.size).toBe(1);
    clearManifestCache({ storage: fakeStorage });
    expect(fakeStorage._store.size).toBe(0);
  });

  it('getSkillPrompt: 返回指定 skill 的 system + user_template', () => {
    const p = getSkillPrompt(FAKE_MANIFEST, 'outline_generator');
    expect(p.system).toBe('SYS_OUTLINE');
    expect(p.user_template).toContain('项目={{project}}');
  });

  it('getSkillPrompt: skill 不存在抛错', () => {
    expect(() => getSkillPrompt(FAKE_MANIFEST, 'nope')).toThrow(/未找到 skill/);
  });

  it('getSkillPrompt: manifest 非法抛错', () => {
    expect(() => getSkillPrompt(null, 'x')).toThrow(/manifest 非法/);
    expect(() => getSkillPrompt({}, 'x')).toThrow(/manifest 非法/);
  });

  it('fillPromptTemplate: 替换变量', () => {
    const out = fillPromptTemplate('a={{x}} b={{y}} c={{x}}', { x: '1', y: '2' });
    expect(out).toBe('a=1 b=2 c=1');
  });

  it('fillPromptTemplate: 未提供变量替换为空串', () => {
    const out = fillPromptTemplate('a={{x}} b={{y}}', { x: '1' });
    expect(out).toBe('a=1 b=');
  });

  it('fillPromptTemplate: 对象变量 JSON 序列化', () => {
    const out = fillPromptTemplate('{{obj}}', { obj: { a: 1 } });
    expect(out).toBe('{"a":1}');
  });

  it('fillPromptTemplate: 非字符串模板返回空串', () => {
    expect(fillPromptTemplate(null, {})).toBe('');
    expect(fillPromptTemplate(undefined, {})).toBe('');
  });

  it('fillPromptTemplate: 支持带空格的占位符 {{ x }}', () => {
    const out = fillPromptTemplate('{{ x }}', { x: 'ok' });
    expect(out).toBe('ok');
  });

  it('loadSkillManifest: 缓存 JSON 损坏时回退到 fetch', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FAKE_MANIFEST
    }));
    // 写入损坏缓存
    fakeStorage.setItem('dreamtale:skills-manifest', '{not valid json');
    const m = await loadSkillManifest({ storage: fakeStorage });
    expect(m.version).toBe('1.0');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('loadSkillManifest: 缓存对象结构非法（缺 __ts）时回退到 fetch', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FAKE_MANIFEST
    }));
    fakeStorage.setItem('dreamtale:skills-manifest', JSON.stringify({ manifest: FAKE_MANIFEST }));
    const m = await loadSkillManifest({ storage: fakeStorage });
    expect(m.version).toBe('1.0');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('loadSkillManifest: storage.setItem 抛错时静默降级（不阻断加载）', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FAKE_MANIFEST
    }));
    const faultyStorage = {
      getItem: function () { return null; },
      setItem: function () { throw new Error('quota exceeded'); },
      removeItem: function () { },
      _store: new Map()
    };
    const m = await loadSkillManifest({ storage: faultyStorage });
    expect(m.version).toBe('1.0'); // 仍能加载，写缓存失败被吞掉
  });

  it('clearManifestCache: storage 缺失时静默不报错', () => {
    expect(() => clearManifestCache({})).not.toThrow();
  });
});

// ---------- OutlineGenerator ----------

describe('OutlineGenerator', () => {
  it('构造：aiAdapter 为空抛错', () => {
    expect(() => new OutlineGenerator(null)).toThrow(/aiAdapter 不能为空/);
  });

  it('generateChapterOutline: 走 manifest + AI 返回章纲（含规范化）', async () => {
    const ai = new MockAdapter({ jsonFixture: OUTLINE_FIXTURE });
    const gen = new OutlineGenerator(ai, { manifest: FAKE_MANIFEST });
    const result = await gen.generateChapterOutline({
      project: { name: '测试书' },
      volume: { vol_no: 'vol_01', vol_name: '第一卷' },
      worldSetting: { category: 'core_rules', content: '力量体系' },
      characters: [{ name: '主角', role: '主角' }],
      previousChapters: '前情提要',
      hooks: [{ hook_id: 'H-001', description: '玉简' }],
      extra_requirement: '加冲突'
    });
    expect(result.core_conflict).toBe('主角与反派争夺玉简');
    expect(result.chapter_info.ch_no).toBe('ch_001');
    expect(result.scenes.length).toBe(1);
    expect(result.rhythm.climax).toBe(3);
    expect(result.must_keep).toEqual(['玉简']);
  });

  it('generateChapterOutline: manifest 加载失败走 fallback prompt 仍可生成', async () => {
    const ai = new MockAdapter({ jsonFixture: OUTLINE_FIXTURE });
    // 不传 manifest，且让 loadSkillManifest 抛错（无 fetch）
    delete global.fetch;
    const gen = new OutlineGenerator(ai, { manifestOptions: { storage: makeFakeStorage() } });
    const result = await gen.generateChapterOutline({});
    // 仍能拿到 fixture（fallback prompt 也会被传给 MockAdapter）
    expect(result.core_conflict).toBe('主角与反派争夺玉简');
    global.fetch = undefined;
  });

  it('generateChapterOutline: 上下文缺省时用空串兜底不报错', async () => {
    const ai = new MockAdapter({ jsonFixture: {} });
    const gen = new OutlineGenerator(ai, { manifest: FAKE_MANIFEST });
    const result = await gen.generateChapterOutline();
    // 规范化保证关键字段存在
    expect(result.core_conflict).toBe('');
    expect(Array.isArray(result.scenes)).toBe(true);
    expect(result.rhythm.climax).toBe(3);
  });

  it('expandOutline: 返回 AI 文本', async () => {
    const ai = new MockAdapter({ textFixture: '扩写后的段落' });
    const gen = new OutlineGenerator(ai, { manifest: FAKE_MANIFEST });
    const out = await gen.expandOutline('原段落', '补充细节');
    expect(out).toBe('扩写后的段落');
  });

  it('adjustRhythm: 合并目标节奏并返回完整章纲', async () => {
    const ai = new MockAdapter({
      jsonFixture: { rhythm: { climax: 5, depression: 1, emotion_trend: '下沉' } }
    });
    const gen = new OutlineGenerator(ai, { manifest: FAKE_MANIFEST });
    const out = await gen.adjustRhythm(OUTLINE_FIXTURE, { climax: 5, depression: 1, emotion_trend: '下沉' });
    expect(out.rhythm.climax).toBe(5);
    expect(out.core_conflict).toBe('主角与反派争夺玉简'); // 原字段保留
  });

  it('generateChapterOutline: manifest 存在但缺 outline_generator skill 时走 fallback', async () => {
    const ai = new MockAdapter({ jsonFixture: OUTLINE_FIXTURE });
    // manifest 缺 outline_generator
    const partialManifest = { version: '1.0', skills: {} };
    const gen = new OutlineGenerator(ai, { manifest: partialManifest });
    const result = await gen.generateChapterOutline({ project: '书' });
    expect(result.core_conflict).toBe('主角与反派争夺玉简');
  });

  it('generateChapterOutline: 角色/场景为对象（非数组）时 stringify 走 JSON 序列化分支', async () => {
    const ai = new MockAdapter({ jsonFixture: OUTLINE_FIXTURE });
    const gen = new OutlineGenerator(ai, { manifest: FAKE_MANIFEST });
    const result = await gen.generateChapterOutline({
      project: '书',
      characters: { name: '主角' }, // 对象而非数组
      worldSetting: '力量体系', // 字符串
      hooks: 42 // 数字
    });
    expect(result.core_conflict).toBe('主角与反派争夺玉简');
  });
});

// ---------- HighlightMiner ----------

describe('HighlightMiner', () => {
  it('构造：aiAdapter 为空抛错', () => {
    expect(() => new HighlightMiner(null)).toThrow(/aiAdapter 不能为空/);
  });

  it('mineHighlights: 走 manifest + AI 返回爽点列表（含规范化）', async () => {
    const ai = new MockAdapter({ jsonFixture: HIGHLIGHT_FIXTURE });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.mineHighlights({
      chapter: { title: '第1章' },
      characters: [{ name: '主角' }],
      genre: '玄幻',
      previousHighlights: [{ type: '打脸' }]
    });
    expect(out.length).toBe(2);
    expect(out[0].type).toBe('打脸');
    expect(out[0].strength).toBe(4);
    expect(out[1].chapter_position).toBe('章末钩子');
  });

  it('mineHighlights: strength 越界被 clamp 到 1-5', async () => {
    const ai = new MockAdapter({
      jsonFixture: { highlights: [{ type: 'x', description: '', strength: 99, chapter_position: 'p' }] }
    });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.mineHighlights({});
    expect(out[0].strength).toBe(5);
  });

  it('mineHighlights: manifest 失败走 fallback 仍返回结果', async () => {
    const ai = new MockAdapter({ jsonFixture: HIGHLIGHT_FIXTURE });
    delete global.fetch;
    const miner = new HighlightMiner(ai, { manifestOptions: { storage: makeFakeStorage() } });
    const out = await miner.mineHighlights({});
    expect(out.length).toBe(2);
    global.fetch = undefined;
  });

  it('mineHighlights: AI 返回非数组时返回空数组', async () => {
    const ai = new MockAdapter({ jsonFixture: { not_highlights: 1 } });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.mineHighlights({});
    expect(out).toEqual([]);
  });

  it('suggestHookRecycles: 返回 recycles + plant_suggestions 合并列表', async () => {
    const ai = new MockAdapter({
      jsonFixture: {
        recycles: [{ hook_id: 'H-001', payoff_type: 'reveal', suggestion: '揭秘玉简来历' }],
        plant_suggestions: [{ description: '主角手腕印记', scope: 'short', target_resolve_ch: 10 }]
      }
    });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.suggestHookRecycles({
      chapter: { title: '第1章' },
      hooks: [{ hook_id: 'H-001', status: 'planted' }],
      characters: [{ name: '主角' }]
    });
    expect(out.length).toBe(2);
    expect(out[0].hook_id).toBe('H-001');
    expect(out[1].description).toBe('主角手腕印记');
  });

  it('suggestHookRecycles: AI 返回缺字段时返回空数组', async () => {
    const ai = new MockAdapter({ jsonFixture: { foo: 1 } });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.suggestHookRecycles({});
    expect(out).toEqual([]);
  });

  it('planEmotionCurve: 返回规范化情绪曲线', async () => {
    const ai = new MockAdapter({
      jsonFixture: {
        climax_position: '后段',
        buildup_position: '前段',
        twist_position: '中段',
        curve: [{ position: '0%', emotion: '压抑', intensity: 2 }, { position: '80%', emotion: '爆发', intensity: 5 }]
      }
    });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.planEmotionCurve({ title: '第1章', core_conflict: 'x' });
    expect(out.climax_position).toBe('后段');
    expect(out.twist_position).toBe('中段');
    expect(out.curve.length).toBe(2);
    expect(out.curve[1].intensity).toBe(5);
  });

  it('planEmotionCurve: AI 返回空对象时给默认值', async () => {
    const ai = new MockAdapter({ jsonFixture: {} });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.planEmotionCurve({});
    expect(out.climax_position).toBe('后段');
    expect(out.buildup_position).toBe('前段');
    expect(out.twist_position).toBe('');
    expect(Array.isArray(out.curve)).toBe(true);
  });

  it('mineHighlights: characters 为字符串数组（非对象）时 stringify 走 String(x) 分支', async () => {
    const ai = new MockAdapter({ jsonFixture: HIGHLIGHT_FIXTURE });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.mineHighlights({
      chapter: '第1章',
      characters: ['主角', '反派'], // 字符串数组，非对象数组
      genre: '玄幻',
      previousHighlights: '打脸' // 字符串
    });
    expect(out.length).toBe(2);
  });

  it('mineHighlights: 入参为数字/对象混合时 stringify 不报错', async () => {
    const ai = new MockAdapter({ jsonFixture: { highlights: [] } });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.mineHighlights({
      chapter: { title: '第1章' },
      characters: 42, // 数字
      genre: '玄幻'
    });
    expect(out).toEqual([]);
  });

  it('suggestHookRecycles: hooks 为字符串数组时 stringify 走 String(x) 分支', async () => {
    const ai = new MockAdapter({ jsonFixture: { recycles: [], plant_suggestions: [] } });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.suggestHookRecycles({
      chapter: '第1章',
      hooks: ['H-001', 'H-002'], // 字符串数组
      characters: '主角'
    });
    expect(out).toEqual([]);
  });

  it('planEmotionCurve: chapter 为字符串时 stringify 走字符串分支', async () => {
    const ai = new MockAdapter({ jsonFixture: {} });
    const miner = new HighlightMiner(ai, { manifest: FAKE_MANIFEST });
    const out = await miner.planEmotionCurve('第1章 核心冲突');
    expect(out.climax_position).toBe('后段');
  });

  it('mineHighlights: manifest 存在但缺 highlight_miner skill 时走 fallback', async () => {
    const ai = new MockAdapter({ jsonFixture: HIGHLIGHT_FIXTURE });
    const partialManifest = { version: '1.0', skills: {} };
    const miner = new HighlightMiner(ai, { manifest: partialManifest });
    const out = await miner.mineHighlights({});
    expect(out.length).toBe(2);
  });
});

// ---------- TextPolisher ----------

describe('TextPolisher', () => {
  it('构造：aiAdapter 为空抛错', () => {
    expect(() => new TextPolisher(null)).toThrow(/aiAdapter 不能为空/);
  });

  it('polish: 返回 AI 润色文本', async () => {
    const ai = new MockAdapter({ textFixture: '润色后的文本' });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.polish('原文', 'medium');
    expect(out).toBe('润色后的文本');
  });

  it('polish: 非法 level 抛错', async () => {
    const ai = new MockAdapter();
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    await expect(p.polish('x', 'super')).rejects.toThrow(/level 必须/);
  });

  it('polish: 空文本返回空串', async () => {
    const ai = new MockAdapter({ textFixture: 'should-not-return' });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    expect(await p.polish('', 'light')).toBe('');
    expect(await p.polish(null, 'light')).toBe('');
  });

  it('polish: manifest 加载失败走 fallback 仍返回文本', async () => {
    const ai = new MockAdapter({ textFixture: 'fallback 润色' });
    delete global.fetch;
    const p = new TextPolisher(ai, { manifestOptions: { storage: makeFakeStorage() } });
    const out = await p.polish('原文', 'deep');
    expect(out).toBe('fallback 润色');
    global.fetch = undefined;
  });

  it('checkTypos: 返回错误列表（含规范化）', async () => {
    const ai = new MockAdapter({ jsonFixture: TYPO_FIXTURE });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.checkTypos('那里\n因为所以');
    expect(out.length).toBe(2);
    expect(out[0].line).toBe(2);
    expect(out[0].original).toBe('那里');
    expect(out[0].suggestion).toBe('哪里');
    expect(out[0].type).toBe('typo');
    expect(out[1].type).toBe('grammar');
  });

  it('checkTypos: 空文本返回空数组', async () => {
    const ai = new MockAdapter({ jsonFixture: TYPO_FIXTURE });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    expect(await p.checkTypos('')).toEqual([]);
    expect(await p.checkTypos(null)).toEqual([]);
  });

  it('checkTypos: AI 返回非数组时返回空数组', async () => {
    const ai = new MockAdapter({ jsonFixture: { not_errors: 1 } });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.checkTypos('text');
    expect(out).toEqual([]);
  });

  it('checkTypos: line 字段非法时回退为 1', async () => {
    const ai = new MockAdapter({
      jsonFixture: { errors: [{ line: 'abc', original: 'x', suggestion: 'y', type: 'typo' }] }
    });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.checkTypos('text');
    expect(out[0].line).toBe(1);
  });

  it('removeAITaste: 返回去 AI 味文本', async () => {
    const ai = new MockAdapter({ textFixture: '去 AI 味后的文本' });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.removeAITaste('原文');
    expect(out).toBe('去 AI 味后的文本');
  });

  it('removeAITaste: 空文本返回空串', async () => {
    const ai = new MockAdapter({ textFixture: 'x' });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    expect(await p.removeAITaste('')).toBe('');
  });

  it('batchPolish: 串行润色多段文本', async () => {
    let count = 0;
    const ai = new MockAdapter({
      textFixture: '润色',
      delay: 0
    });
    // 用 spy 计数
    const spy = vi.spyOn(ai, 'generateText').mockImplementation(async () => {
      count++;
      return '润色' + count;
    });
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.batchPolish(['a', 'b', 'c'], 'light');
    expect(out).toEqual(['润色1', '润色2', '润色3']);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('batchPolish: 非数组抛错', async () => {
    const ai = new MockAdapter();
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    await expect(p.batchPolish('not-array', 'light')).rejects.toThrow(/必须是数组/);
  });

  it('batchPolish: 非法 level 抛错', async () => {
    const ai = new MockAdapter();
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    await expect(p.batchPolish(['a'], 'super')).rejects.toThrow(/level 必须/);
  });

  it('batchPolish: 空数组返回空数组', async () => {
    const ai = new MockAdapter();
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.batchPolish([], 'light');
    expect(out).toEqual([]);
  });

  it('polish: manifest 存在但缺 text_polisher skill 时走 fallback', async () => {
    const ai = new MockAdapter({ textFixture: 'fallback 润色' });
    const partialManifest = { version: '1.0', skills: {} };
    const p = new TextPolisher(ai, { manifest: partialManifest });
    const out = await p.polish('原文', 'light');
    expect(out).toBe('fallback 润色');
  });

  it('checkTypos: manifest 存在但缺 typo_checker skill 时走 fallback', async () => {
    const ai = new MockAdapter({ jsonFixture: TYPO_FIXTURE });
    const partialManifest = { version: '1.0', skills: {} };
    const p = new TextPolisher(ai, { manifest: partialManifest });
    const out = await p.checkTypos('那里');
    expect(out.length).toBe(2);
  });

  it('removeAITaste: manifest 存在但缺 ai_taste_remover skill 时走 fallback', async () => {
    const ai = new MockAdapter({ textFixture: '去 AI 味' });
    const partialManifest = { version: '1.0', skills: {} };
    const p = new TextPolisher(ai, { manifest: partialManifest });
    const out = await p.removeAITaste('原文');
    expect(out).toBe('去 AI 味');
  });

  it('polish: AI 返回非字符串时返回空串', async () => {
    const ai = new MockAdapter({ textFixture: 123 }); // 非字符串 fixture
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.polish('原文', 'light');
    expect(out).toBe('');
  });

  it('removeAITaste: AI 返回非字符串时返回空串', async () => {
    const ai = new MockAdapter({ textFixture: 456 }); // truthy 非字符串
    const p = new TextPolisher(ai, { manifest: FAKE_MANIFEST });
    const out = await p.removeAITaste('原文');
    expect(out).toBe('');
  });
});
