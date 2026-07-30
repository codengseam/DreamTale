import { describe, it, expect } from 'vitest';
import {
  Project,
  Volume,
  Chapter,
  Hook,
  Character,
  WorldSetting,
  Outline,
  padVol,
  padCh,
  HOOK_STATUS,
  HOOK_SCOPE,
  HOOK_PAYOFF,
  HOOK_PRIORITY,
  HOOK_STRENGTH,
} from '../../src/core/models.js';

// ---------- 工具函数 ----------

describe('padVol / padCh', () => {
  it('padVol 把数字补零为 2 位', () => {
    expect(padVol(1)).toBe('01');
    expect(padVol(12)).toBe('12');
    expect(padVol(0)).toBe('00');
  });

  it('padCh 把数字补零为 3 位', () => {
    expect(padCh(1)).toBe('001');
    expect(padCh(42)).toBe('042');
    expect(padCh(100)).toBe('100');
    expect(padCh(0)).toBe('000');
  });
});

// ---------- Project ----------

describe('Project', () => {
  it('用最小字段构造实例，缺省值合理', () => {
    const p = new Project({ id: 'p1', name: '梦说' });
    expect(p.id).toBe('p1');
    expect(p.name).toBe('梦说');
    expect(p.status).toBe('draft');
    expect(p.target_words).toBe(0);
    expect(p.chapters_done).toBe(0);
  });

  it('toJSON / fromJSON 往返保持一致', () => {
    const p = new Project({
      id: 'p1',
      name: '梦说',
      subtitle: '一段旅程',
      genre: '玄幻',
      author: '佚名',
      target_words: 1000000,
      current_words: 100000,
      volumes_done: 1,
      volumes_total: 5,
      chapters_done: 30,
      chapters_total: 200,
      status: 'ongoing',
      updated: '2026-07-28',
      created_at: '2026-07-01',
    });
    const json = p.toJSON();
    const p2 = Project.fromJSON(json);
    expect(p2).toBeInstanceOf(Project);
    expect(p2.toJSON()).toEqual(json);
  });

  it('fromJSON 接受空对象不抛错', () => {
    const p = Project.fromJSON();
    expect(p.id).toBeUndefined();
    expect(p.status).toBe('draft');
  });
});

// ---------- Volume ----------

describe('Volume', () => {
  it('vol_no 数字自动补零为 2 位字符串', () => {
    const v = new Volume({ vol_no: 1, vol_name: '启程', vol_goal: '入山门', sort_order: 0 });
    expect(v.vol_no).toBe('01');
    expect(v.vol_name).toBe('启程');
  });

  it('vol_no 字符串数字也规范化', () => {
    const v = new Volume({ vol_no: '3' });
    expect(v.vol_no).toBe('03');
  });

  it('vol_no 非数字字符串回退为 00', () => {
    const v = new Volume({ vol_no: 'abc' });
    expect(v.vol_no).toBe('00');
  });

  it('toJSON / fromJSON 往返保持一致', () => {
    const v = new Volume({ vol_no: 7, vol_name: '终章', vol_goal: '终战', sort_order: 12 });
    const json = v.toJSON();
    expect(json.vol_no).toBe('07');
    const v2 = Volume.fromJSON(json);
    expect(v2.toJSON()).toEqual(json);
  });
});

// ---------- Chapter ----------

describe('Chapter', () => {
  it('ch_no 自动补零为 3 位，words 自动按 content 长度计算', () => {
    const content = '一二三四五六七八九十'; // 10 个字符
    const c = new Chapter({ vol_no: 1, ch_no: 1, title: '初章', content });
    expect(c.vol_no).toBe('01');
    expect(c.ch_no).toBe('001');
    expect(c.words).toBe(10);
    expect(c.status).toBe('draft');
    expect(c.highlights).toEqual([]);
  });

  it('显式 words 优先于自动计算', () => {
    const c = new Chapter({ vol_no: 1, ch_no: 1, content: '短', words: 999 });
    expect(c.words).toBe(999);
  });

  it('content 为空时 words 为 0', () => {
    const c = new Chapter({ vol_no: 1, ch_no: 1 });
    expect(c.words).toBe(0);
  });

  it('highlights 非数组被规范化为空数组', () => {
    const c = new Chapter({ vol_no: 1, ch_no: 1, highlights: '不是数组' });
    expect(c.highlights).toEqual([]);
  });

  it('vol_no / ch_no 字符串数字补零', () => {
    const c = new Chapter({ vol_no: '3', ch_no: '42', content: 'X' });
    expect(c.vol_no).toBe('03');
    expect(c.ch_no).toBe('042');
  });

  it('ch_no 非数字字符串原样保留（如楔子）', () => {
    const c = new Chapter({ vol_no: 1, ch_no: '楔子', content: 'X' });
    expect(c.ch_no).toBe('楔子');
  });

  it('vol_no 非数字字符串回退为 00', () => {
    const c = new Chapter({ vol_no: 'abc', ch_no: 1, content: 'X' });
    expect(c.vol_no).toBe('00');
  });

  it('toJSON / fromJSON 往返保持一致', () => {
    const c = new Chapter({
      vol_no: 2,
      ch_no: 15,
      title: '风起',
      content: '正文内容',
      summary: '一句话摘要',
      highlights: ['金句 1', '金句 2'],
      status: 'published',
      updated_at: '2026-07-28T10:00:00Z',
    });
    const json = c.toJSON();
    expect(json.vol_no).toBe('02');
    expect(json.ch_no).toBe('015');
    const c2 = Chapter.fromJSON(json);
    expect(c2.toJSON()).toEqual(json);
  });
});

// ---------- Hook ----------

describe('Hook', () => {
  it('使用最小字段构造，缺省值对齐 hooks_registry.json schema', () => {
    const h = new Hook({ hook_id: 'H-001', description: '主角眉心红痣' });
    expect(h.hook_id).toBe('H-001');
    expect(h.status).toBe('planted');
    expect(h.scope).toBe('short');
    expect(h.payoff_type).toBe('reveal');
    expect(h.priority).toBe('medium');
    expect(h.strength).toBe('medium');
    expect(h.related_characters).toEqual([]);
    expect(h.dependencies).toEqual([]);
    expect(h.reminder_chapters).toEqual([]);
    expect(h.last_reminder_ch).toBeNull();
  });

  it('related_characters / dependencies / reminder_chapters 非数组时规范化为空数组', () => {
    const h = new Hook({
      hook_id: 'H-002',
      description: 'test',
      related_characters: 'not-an-array',
      dependencies: null,
      reminder_chapters: 123,
    });
    expect(h.related_characters).toEqual([]);
    expect(h.dependencies).toEqual([]);
    expect(h.reminder_chapters).toEqual([]);
  });

  it('toJSON / fromJSON 往返保持一致（含运行时字段）', () => {
    const h = new Hook({
      hook_id: 'H-001',
      description: '主角眉心红痣',
      status: 'planted',
      planted_ch: 1,
      target_resolve_ch: 10,
      scope: 'core',
      payoff_type: 'reveal',
      priority: 'high',
      strength: 'strong',
      expected_resolve_vol: 1,
      related_characters: ['主角'],
      emotional_valence: 'positive',
      dependencies: [],
      resolution_note: '',
      reminder_chapters: [],
      last_reminder_ch: null,
      next_reminder_due_ch: 8,
    });
    const json = h.toJSON();
    expect(json.next_reminder_due_ch).toBe(8);
    expect(json.scope).toBe('core');
    const h2 = Hook.fromJSON(json);
    expect(h2.toJSON()).toEqual(json);
  });

  it('从 hooks_registry.json 实际样本解析', () => {
    const sample = {
      hook_id: 'H-001',
      description: '示例伏笔：主角眉心的红痣',
      planted_ch: 1,
      scope: 'core',
      status: 'planted',
      target_resolve_ch: 10,
      expected_resolve_vol: 1,
      related_characters: ['主角'],
      priority: 'high',
      strength: 'strong',
      payoff_type: 'reveal',
      emotional_valence: 'positive',
      reminder_chapters: [],
      last_reminder_ch: null,
      next_reminder_due_ch: 8,
      dependencies: [],
      resolution_note: '',
    };
    const h = Hook.fromJSON(sample);
    expect(h).toBeInstanceOf(Hook);
    expect(h.hook_id).toBe('H-001');
    expect(h.scope).toBe('core');
    expect(h.related_characters).toEqual(['主角']);
  });
});

describe('Hook 枚举常量', () => {
  it('HOOK_STATUS 包含 4 个状态', () => {
    expect(HOOK_STATUS).toEqual(['planted', 'hinted', 'resolved', 'abandoned']);
  });
  it('HOOK_SCOPE 包含 short/long/core', () => {
    expect(HOOK_SCOPE).toEqual(['short', 'long', 'core']);
  });
  it('HOOK_PAYOFF 包含 5 类', () => {
    expect(HOOK_PAYOFF).toEqual(['reveal', 'twist', 'powerup', 'emotional', 'callback']);
  });
  it('HOOK_PRIORITY 包含 high/medium/low', () => {
    expect(HOOK_PRIORITY).toEqual(['high', 'medium', 'low']);
  });
  it('HOOK_STRENGTH 包含 strong/medium/weak', () => {
    expect(HOOK_STRENGTH).toEqual(['strong', 'medium', 'weak']);
  });
});

// ---------- Character ----------

describe('Character', () => {
  it('toJSON / fromJSON 往返保持一致', () => {
    const c = new Character({
      name: '主角',
      role: 'protagonist',
      identity: '孤儿',
      level: '凡人境',
      personality: '隐忍、果决、重情',
      arc: '1.蒙昧 → 2.觉醒',
      relation: '与师弟为宿敌',
      goal: '复仇',
      color: '#FF0000',
    });
    const json = c.toJSON();
    const c2 = Character.fromJSON(json);
    expect(c2).toBeInstanceOf(Character);
    expect(c2.toJSON()).toEqual(json);
  });
});

// ---------- WorldSetting ----------

describe('WorldSetting', () => {
  it('toJSON / fromJSON 往返保持一致', () => {
    const w = new WorldSetting({
      category: 'core_rules',
      content: '力量体系：凡人境 → 感应境 → 通脉境',
      sort_order: 1,
    });
    const json = w.toJSON();
    const w2 = WorldSetting.fromJSON(json);
    expect(w2).toBeInstanceOf(WorldSetting);
    expect(w2.toJSON()).toEqual(json);
  });
});

// ---------- Outline ----------

describe('Outline', () => {
  it('vol_no/ch_no 自动补零', () => {
    const o = new Outline({ vol_no: 1, ch_no: 1 });
    expect(o.vol_no).toBe('01');
    expect(o.ch_no).toBe('001');
  });

  it('ch_no 字符串数字补零', () => {
    const o = new Outline({ vol_no: '2', ch_no: '42' });
    expect(o.vol_no).toBe('02');
    expect(o.ch_no).toBe('042');
  });

  it('ch_no 非数字字符串原样保留（如楔子/番外）', () => {
    const o = new Outline({ vol_no: 1, ch_no: '楔子' });
    expect(o.ch_no).toBe('楔子');
  });

  it('vol_no 字符串数字补零', () => {
    const o = new Outline({ vol_no: '3', ch_no: 1 });
    expect(o.vol_no).toBe('03');
  });

  it('非数组字段自动初始化为空数组', () => {
    const o = new Outline({
      vol_no: 1,
      ch_no: 1,
      scenes: null,
      characters: 'not-an-array',
      hook_planted: null,
      hook_resolved: null,
      must_keep: null,
      must_avoid: null,
      context_recall: null,
      revision_history: null,
    });
    expect(o.scenes).toEqual([]);
    expect(o.characters).toEqual([]);
    expect(o.hook_planted).toEqual([]);
    expect(o.hook_resolved).toEqual([]);
    expect(o.must_keep).toEqual([]);
    expect(o.must_avoid).toEqual([]);
    expect(o.context_recall).toEqual([]);
    expect(o.revision_history).toEqual([]);
  });

  it('chapter_hook / pacing 为 null 时回退到默认对象', () => {
    const o = new Outline({ vol_no: 1, ch_no: 1, chapter_hook: null, pacing: null });
    expect(o.chapter_hook).toEqual({ type: '', content: '' });
    expect(o.pacing).toEqual({ climax: 0, depression: 0, golden_quote: '' });
  });

  it('无参数时仍可构造，数组字段为空', () => {
    const o = new Outline();
    expect(o.vol_no).toBe('00');
    expect(o.scenes).toEqual([]);
    expect(o.chapter_hook).toEqual({ type: '', content: '' });
    expect(o.pacing).toEqual({ climax: 0, depression: 0, golden_quote: '' });
  });

  it('toJSON / fromJSON 往返保持一致', () => {
    const o = new Outline({
      vol_no: 1,
      ch_no: 1,
      title: '初章',
      chapter_type: 'vol_start',
      word_target: 3000,
      pov: '主角（第三人称限知）',
      scenes: [
        { location: '山门', time: '清晨', characters: ['主角'], action: '入山门', purpose: '建立处境' },
      ],
      core_conflict: '主角初入山门被刁难',
      characters: [
        { name: '主角', identity: 'protagonist', role: '本章视角', state_file: '.state/characters/protagonist.json' },
      ],
      hook_planted: [{ hook_id: 'H-001', description: '红痣', scope: 'core', target: 'vol_04' }],
      hook_resolved: [],
      chapter_hook: { type: '悬念', content: '主角刚入山门，听见脚步声' },
      must_keep: ['保留红痣描写'],
      must_avoid: ['不要透露身世'],
      pacing: { climax: 3, depression: 2, golden_quote: '我命由我' },
      context_recall: ['00_控制面/author_intent.md'],
      revision_history: [{ date: '2026-07-28', note: '初版' }],
    });
    const json = o.toJSON();
    const o2 = Outline.fromJSON(json);
    expect(o2.toJSON()).toEqual(json);
  });
});
