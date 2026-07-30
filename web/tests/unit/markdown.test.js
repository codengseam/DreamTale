import { describe, it, expect } from 'vitest';
import {
  chapterToMarkdown,
  chapterFromMarkdown,
  outlineToMarkdown,
  outlineFromMarkdown,
  hookToRegistryJSON,
  hookFromRegistryJSON,
  registryToJSONString,
  registryFromJSONString,
  parseFrontmatter,
  buildFrontmatter,
  buildCharacterMarkdown,
  parseCharacterMarkdown,
  buildWorldSettingMarkdown,
  parseWorldSettingMarkdown,
} from '../../src/core/markdown.js';
import { Chapter, Hook, Outline } from '../../src/core/models.js';

// ---------- frontmatter ----------

describe('parseFrontmatter / buildFrontmatter', () => {
  it('往返保持一致', () => {
    const obj = {
      vol_no: '01',
      ch_no: '001',
      title: '初章',
      status: 'draft',
      words: 100,
    };
    const md = buildFrontmatter(obj);
    expect(md.startsWith('---')).toBe(true);
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter).toEqual(obj);
    expect(body).toBe('');
  });

  it('无 frontmatter 时返回空对象 + 原文 body', () => {
    const md = 'hello world';
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter).toEqual({});
    expect(body).toBe('hello world');
  });

  it('支持数组字段', () => {
    const obj = { highlights: ['金句 1', '金句 2'] };
    const md = buildFrontmatter(obj);
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.highlights).toEqual(['金句 1', '金句 2']);
  });

  it('null / undefined 值序列化为空 key', () => {
    const obj = { a: null, b: undefined, c: 'x' };
    const md = buildFrontmatter(obj);
    expect(md).toContain('a:');
    expect(md).toContain('c: "x"');
  });

  it('空数组序列化为 []', () => {
    const obj = { empty: [], nonempty: ['x'] };
    const md = buildFrontmatter(obj);
    expect(md).toContain('empty: []');
  });

  it('标量类型往返（整数 / 浮点）', () => {
    const obj = { int_val: 42, float_val: 3.14 };
    const md = buildFrontmatter(obj);
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.int_val).toBe(42);
    expect(frontmatter.float_val).toBe(3.14);
  });

  it('裸值标量解析（null / true / false / 空数组）', () => {
    // buildFrontmatter 会给字符串加引号，所以裸值需要手写 frontmatter
    const md = `---\nnull_val: null\ntilde: ~\nbool_true: true\nbool_false: false\nempty_arr: []\n---\n`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.null_val).toBe(null);
    expect(frontmatter.tilde).toBe(null);
    expect(frontmatter.bool_true).toBe(true);
    expect(frontmatter.bool_false).toBe(false);
    expect(frontmatter.empty_arr).toEqual([]);
  });

  it('单引号字符串解析', () => {
    const md = `---\nname: 'hello'\n---\n`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.name).toBe('hello');
  });

  it('inline 数组 [a, b, c] 解析', () => {
    const md = `---\ntags: [a, b, c]\n---\n`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.tags).toEqual(['a', 'b', 'c']);
  });
});

// ---------- 章节 Markdown ----------

describe('chapterToMarkdown / chapterFromMarkdown 往返', () => {
  it('完整往返保持一致（含 frontmatter、标题、摘要、金句、正文）', () => {
    const c = new Chapter({
      vol_no: 1,
      ch_no: 1,
      title: '初章',
      content: '主角走入山门，一阵清风拂过。',
      summary: '主角初入山门',
      highlights: ['我命由我'],
      status: 'draft',
      updated_at: '2026-07-28T10:00:00Z',
    });
    const md = chapterToMarkdown(c);
    expect(md).toContain('---');
    expect(md).toContain('vol_no: "01"');
    expect(md).toContain('ch_no: "001"');
    expect(md).toContain('# 第 1 章 · 初章');
    expect(md).toContain('> 摘要：主角初入山门');
    expect(md).toContain('## 金句');
    expect(md).toContain('> 我命由我');
    expect(md).toContain('主角走入山门');

    const c2 = chapterFromMarkdown(md);
    expect(c2).toBeInstanceOf(Chapter);
    expect(c2.vol_no).toBe('01');
    expect(c2.ch_no).toBe('001');
    expect(c2.title).toBe('初章');
    expect(c2.summary).toBe('主角初入山门');
    expect(c2.highlights).toEqual(['我命由我']);
    expect(c2.content).toContain('主角走入山门');
    expect(c2.status).toBe('draft');
  });

  it('无 highlights 也能往返', () => {
    const c = new Chapter({ vol_no: 2, ch_no: 15, title: '风起', content: '正文内容' });
    const md = chapterToMarkdown(c);
    const c2 = chapterFromMarkdown(md);
    expect(c2.title).toBe('风起');
    expect(c2.content).toBe('正文内容');
    expect(c2.highlights).toEqual([]);
  });

  it('从空内容章节往返不抛错', () => {
    const c = new Chapter({ vol_no: 1, ch_no: 1, title: '空章' });
    const md = chapterToMarkdown(c);
    const c2 = chapterFromMarkdown(md);
    expect(c2.title).toBe('空章');
  });
});

// ---------- 章纲 Markdown ----------

describe('outlineToMarkdown / outlineFromMarkdown 往返', () => {
  const sampleOutline = new Outline({
    vol_no: 1,
    ch_no: 1,
    title: '初章',
    chapter_type: 'vol_start',
    word_target: 3000,
    pov: '主角（第三人称限知）',
    scenes: [
      {
        location: '山门',
        time: '清晨',
        characters: ['主角'],
        action: '入山门',
        purpose: '建立主角处境',
      },
    ],
    core_conflict: '主角初入山门被刁难',
    characters: [
      {
        name: '主角',
        identity: 'protagonist',
        role: '本章视角',
        state_file: '.state/characters/protagonist.json',
      },
    ],
    hook_planted: [{ hook_id: 'H-001', description: '红痣发烫', scope: 'core', target: 'vol_04' }],
    hook_resolved: [],
    chapter_hook: { type: '悬念', content: '主角刚入山门，听见脚步声' },
    must_keep: ['保留红痣描写'],
    must_avoid: ['不要透露身世'],
    pacing: { climax: 3, depression: 2, golden_quote: '我命由我' },
    context_recall: ['00_控制面/author_intent.md', '02_角色/protagonist.md'],
    revision_history: [{ date: '2026-07-28', note: '初版' }],
  });

  it('序列化包含 11 段标题', () => {
    const md = outlineToMarkdown(sampleOutline);
    expect(md).toContain('# 章纲：ch_001 · 初章');
    expect(md).toContain('## 一、章基本信息');
    expect(md).toContain('## 二、场景列表');
    expect(md).toContain('## 三、核心冲突');
    expect(md).toContain('## 四、出场角色');
    expect(md).toContain('## 五、伏笔埋设');
    expect(md).toContain('## 六、伏笔回收');
    expect(md).toContain('## 七、章末钩子');
    expect(md).toContain('## 八、must-keep / must-avoid');
    expect(md).toContain('## 九、节奏预算');
    expect(md).toContain('## 十、上下文召回');
    expect(md).toContain('## 十一、修订历史');
  });

  it('往返保持核心字段一致', () => {
    const md = outlineToMarkdown(sampleOutline);
    const o = outlineFromMarkdown(md);
    expect(o.vol_no).toBe('01');
    expect(o.ch_no).toBe('001');
    expect(o.title).toBe('初章');
    expect(o.chapter_type).toBe('vol_start');
    expect(o.word_target).toBe(3000);
    expect(o.pov).toBe('主角（第三人称限知）');
    expect(o.scenes.length).toBe(1);
    expect(o.scenes[0].location).toBe('山门');
    expect(o.scenes[0].characters).toEqual(['主角']);
    expect(o.core_conflict).toBe('主角初入山门被刁难');
    expect(o.characters.length).toBe(1);
    expect(o.characters[0].name).toBe('主角');
    expect(o.characters[0].identity).toBe('protagonist');
    expect(o.hook_planted.length).toBe(1);
    expect(o.hook_planted[0].hook_id).toBe('H-001');
    expect(o.hook_planted[0].description).toBe('红痣发烫');
    expect(o.hook_resolved).toEqual([]);
    expect(o.chapter_hook.type).toBe('悬念');
    expect(o.chapter_hook.content).toBe('主角刚入山门，听见脚步声');
    expect(o.must_keep).toEqual(['保留红痣描写']);
    expect(o.must_avoid).toEqual(['不要透露身世']);
    expect(o.pacing.climax).toBe(3);
    expect(o.pacing.depression).toBe(2);
    expect(o.pacing.golden_quote).toBe('我命由我');
    expect(o.context_recall).toEqual(['00_控制面/author_intent.md', '02_角色/protagonist.md']);
    expect(o.revision_history.length).toBe(1);
    expect(o.revision_history[0].date).toBe('2026-07-28');
    expect(o.revision_history[0].note).toBe('初版');
  });

  it('空大纲也能序列化不抛错', () => {
    const o = new Outline({ vol_no: 1, ch_no: 1 });
    const md = outlineToMarkdown(o);
    expect(md).toContain('## 一、章基本信息');
    const o2 = outlineFromMarkdown(md);
    expect(o2.vol_no).toBe('01');
    expect(o2.ch_no).toBe('001');
  });

  it('解析 NovelForge_Vault 实际章纲模板（容错）', () => {
    // 简化的真实模板片段
    const md = `# 章纲：ch_001 · 测试章

> 本文件是单章的「细纲」。

---

## 一、章基本信息

- **章号**：ch_001
- **卷号**：vol_01
- **章标题**：测试章
- **章节类型**：vol_start
- **字数目标**：3000 字
- **POV**：主角（第三人称限知）

---

## 三、核心冲突

> 主角初入山门被刁难

---

## 七、章末钩子

- **钩子类型**：悬念
- **钩子内容**：主角刚入山门，听见脚步声
`;
    const o = outlineFromMarkdown(md);
    expect(o.ch_no).toBe('001');
    expect(o.vol_no).toBe('01');
    expect(o.title).toBe('测试章');
    expect(o.chapter_type).toBe('vol_start');
    expect(o.word_target).toBe(3000);
    expect(o.core_conflict).toBe('主角初入山门被刁难');
    expect(o.chapter_hook.type).toBe('悬念');
    expect(o.chapter_hook.content).toBe('主角刚入山门，听见脚步声');
  });

  it('hook_resolved 有数据时往返一致', () => {
    const o = new Outline({
      vol_no: 1,
      ch_no: 5,
      title: '回收章',
      hook_resolved: [
        { hook_id: 'H-001', from_ch: 1, method: '揭示红痣真相', match: true },
        { hook_id: 'H-002', from_ch: 3, method: '模糊回应', match: false },
      ],
    });
    const md = outlineToMarkdown(o);
    const o2 = outlineFromMarkdown(md);
    expect(o2.hook_resolved.length).toBe(2);
    expect(o2.hook_resolved[0].hook_id).toBe('H-001');
    expect(o2.hook_resolved[0].from_ch).toBe('1');
    expect(o2.hook_resolved[0].method).toBe('揭示红痣真相');
    expect(o2.hook_resolved[0].match).toBe(true);
    expect(o2.hook_resolved[1].match).toBe(false);
  });

  it('解析含（空）占位行与 ____ 占位的模板不误入数据', () => {
    const md = `# 章纲：ch_002 · 边界测试

---

## 一、章基本信息

- **章号**：ch_002
- **卷号**：vol_01
- **章标题**：边界测试
- **章节类型**：____
- **字数目标**：____ 字
- **POV**：____

---

## 二、场景列表

> 暂无场景

---

## 四、出场角色

| 角色 | 身份 | 本章作用 | 状态锚点文件 |
|---|---|---|---|
| （空） | | | |

---

## 五、伏笔埋设

| 伏笔 ID | 一句话描述 | scope | 目标回收章 |
|---|---|---|---|
| （空） | | | |

---

## 六、伏笔回收

| 伏笔 ID | 来自章 | 回收方式 | 是否符合预期 |
|---|---|---|---|
| （空） | | | |

---

## 八、must-keep / must-avoid

### 8.1 must-keep

- [ ] ____

### 8.2 must-avoid

- [ ] ____

---

## 十、上下文召回

- （暂无）
`;
    const o = outlineFromMarkdown(md);
    expect(o.ch_no).toBe('002');
    // ____ 占位符原样保留为字符串（不误入为数组项）
    expect(o.chapter_type).toBe('____');
    expect(o.word_target).toBe(0);
    // （空）占位行被过滤，数组为空
    expect(o.scenes).toEqual([]);
    expect(o.characters).toEqual([]);
    expect(o.hook_planted).toEqual([]);
    expect(o.hook_resolved).toEqual([]);
    // ____ 占位被过滤，不进入 must-keep / must-avoid
    expect(o.must_keep).toEqual([]);
    expect(o.must_avoid).toEqual([]);
    // （暂无）不匹配列表项格式，context_recall 为空
    expect(o.context_recall).toEqual([]);
  });
});

// ---------- hook registry JSON ----------

describe('hookToRegistryJSON / hookFromRegistryJSON', () => {
  it('生成 registry 含 _comment 头与 version', () => {
    const hooks = [new Hook({ hook_id: 'H-001', description: '红痣', scope: 'core' })];
    const reg = hookToRegistryJSON(hooks);
    expect(reg.version).toBe('1.0.0');
    expect(reg._comment).toBeTruthy();
    expect(reg._comment_scope).toContain('scope');
    expect(Array.isArray(reg.hooks)).toBe(true);
    expect(reg.hooks[0].hook_id).toBe('H-001');
    expect(reg.hooks[0].scope).toBe('core');
  });

  it('往返保持一致', () => {
    const hooks = [
      new Hook({
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
        next_reminder_due_ch: 8,
      }),
    ];
    const reg = hookToRegistryJSON(hooks);
    const hooks2 = hookFromRegistryJSON(reg);
    expect(hooks2.length).toBe(1);
    expect(hooks2[0]).toBeInstanceOf(Hook);
    expect(hooks2[0].hook_id).toBe('H-001');
    expect(hooks2[0].scope).toBe('core');
    expect(hooks2[0].related_characters).toEqual(['主角']);
  });

  it('解析 NovelForge_Vault 实际 hooks_registry.json 格式', () => {
    const sample = {
      _comment: 'NovelForge 伏笔追踪表。',
      version: '1.0.0',
      hooks: [
        {
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
        },
      ],
    };
    const hooks = hookFromRegistryJSON(sample);
    expect(hooks.length).toBe(1);
    expect(hooks[0].hook_id).toBe('H-001');
    expect(hooks[0].scope).toBe('core');
  });

  it('空数组与非数组都安全处理', () => {
    expect(hookFromRegistryJSON(null)).toEqual([]);
    expect(hookFromRegistryJSON({})).toEqual([]);
    expect(hookFromRegistryJSON({ hooks: [] })).toEqual([]);
  });
});

describe('registryToJSONString / registryFromJSONString', () => {
  it('往返保持一致', () => {
    const reg = hookToRegistryJSON([new Hook({ hook_id: 'H-001' })]);
    const str = registryToJSONString(reg);
    expect(str).toContain('"hook_id": "H-001"');
    const reg2 = registryFromJSONString(str);
    expect(reg2.hooks[0].hook_id).toBe('H-001');
  });
});

// ---------- 角色 / 世界设定 Markdown 边界 ----------

describe('buildCharacterMarkdown / parseCharacterMarkdown 边界', () => {
  it('buildCharacterMarkdown 接受普通对象（非 Character 实例）', () => {
    const md = buildCharacterMarkdown({ name: '裸对象', role: 'supporting', personality: '冷静' });
    expect(md).toContain('name: "裸对象"');
    expect(md).toContain('# 裸对象');
    expect(md).toContain('冷静');
    const c = parseCharacterMarkdown(md);
    expect(c.name).toBe('裸对象');
    expect(c.personality).toBe('冷静');
  });

  it('parseCharacterMarkdown frontmatter 含非 kv 行时跳过', () => {
    // frontmatter 中有一行不匹配 key:value 格式（触发 !kv continue 分支）
    const md = '---\nname: "test"\n这是一行注释不是kv\n---\n\n# test\n\n## 性格\n冷静\n';
    const c = parseCharacterMarkdown(md);
    expect(c.name).toBe('test');
    expect(c.personality).toBe('冷静');
  });

  it('parseCharacterMarkdown 末尾空 ## 段被跳过', () => {
    // 末尾 ## 段后无内容，split 产生空 part（!part.trim() 分支）
    const md = '---\nname: "test"\n---\n\n# test\n\n## 性格\n冷静\n\n## \n';
    const c = parseCharacterMarkdown(md);
    expect(c.name).toBe('test');
    expect(c.personality).toBe('冷静');
  });
});

describe('buildWorldSettingMarkdown / parseWorldSettingMarkdown 边界', () => {
  it('buildWorldSettingMarkdown 接受普通对象（非 WorldSetting 实例）', () => {
    const md = buildWorldSettingMarkdown({ category: 'magic_system', content: '灵气体系', sort_order: 2 });
    expect(md).toContain('category: "magic_system"');
    expect(md).toContain('# magic_system');
    expect(md).toContain('灵气体系');
    const w = parseWorldSettingMarkdown(md);
    expect(w.category).toBe('magic_system');
    expect(w.content).toContain('灵气体系');
    expect(w.sort_order).toBe(2);
  });
});

// ---------- 补充分支覆盖 ----------

describe('toYamlLines 空数组分支', () => {
  it('buildFrontmatter 空数组字段输出 key: []', () => {
    const md = buildFrontmatter({ tags: [] });
    expect(md).toContain('tags: []');
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.tags).toEqual([]);
  });
});

describe('hookToRegistryJSON null/undefined 容错', () => {
  it('hookToRegistryJSON(null) 返回空 hooks 数组', () => {
    const reg = hookToRegistryJSON(null);
    expect(reg.hooks).toEqual([]);
    expect(reg.version).toBe('1.0.0');
  });

  it('hookToRegistryJSON(undefined) 返回空 hooks 数组', () => {
    const reg = hookToRegistryJSON(undefined);
    expect(reg.hooks).toEqual([]);
  });

  it('hookToRegistryJSON 接受普通对象数组（非 Hook 实例）', () => {
    const reg = hookToRegistryJSON([{ hook_id: 'H-PLAIN', description: '裸对象伏笔' }]);
    expect(reg.hooks.length).toBe(1);
    expect(reg.hooks[0].hook_id).toBe('H-PLAIN');
    expect(reg.hooks[0].description).toBe('裸对象伏笔');
  });
});

describe('parseScenes 场景无出场角色字段', () => {
  it('场景缺少出场角色时 characters 为空数组', () => {
    // 手动构造一个含场景但无出场角色字段的章纲 md
    const md = `# 章纲：ch_001 · 测试

---

## 一、章基本信息

- **章号**：ch_001
- **卷号**：vol_01
- **章标题**：测试
- **章节类型**：____
- **字数目标**：____ 字
- **POV**：____

---

## 二、场景列表

### 场景 1

- **地点**：山门
- **时间**：清晨
- **核心动作**：入山门
- **场景目的**：建立处境

---

## 三、核心冲突

> ____

---
`;
    const o = outlineFromMarkdown(md);
    expect(o.scenes.length).toBe(1);
    expect(o.scenes[0].location).toBe('山门');
    expect(o.scenes[0].characters).toEqual([]);
  });
});

describe('parseSections 仅含 H1 无 ## 段', () => {
  it('character md body 只有 H1 标题时 __body__ fallback 走 || "" 分支', () => {
    // body = "# 仅H1" 无 ## 段，触发 parseSections 的 || '' fallback
    const md = '---\nname: "仅H1"\n---\n\n# 仅H1';
    const c = parseCharacterMarkdown(md);
    expect(c.name).toBe('仅H1');
    // 无 ## 段，所有字段为默认空值
    expect(c.personality).toBe('');
  });
});
