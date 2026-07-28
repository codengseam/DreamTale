import { describe, it, expect } from 'vitest';
import {
  buildZip,
  parseZip,
  exportVaultToZip,
  importVaultFromZip,
} from '../../src/storage/zip-utils.js';
import {
  buildCharacterMarkdown,
  parseCharacterMarkdown,
  buildWorldSettingMarkdown,
  parseWorldSettingMarkdown,
} from '../../src/core/markdown.js';
import { Project, Volume, Chapter, Hook, Character, WorldSetting } from '../../src/core/models.js';

// ---------- buildZip / parseZip ----------

describe('buildZip / parseZip 往返', () => {
  it('单文件往返一致', async () => {
    const files = [{ path: 'hello.txt', data: new TextEncoder().encode('hello world') }];
    const zip = buildZip(files);
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(zip.length).toBeGreaterThan(0);
    const parsed = parseZip(zip);
    expect(parsed.length).toBe(1);
    expect(parsed[0].path).toBe('hello.txt');
    expect(new TextDecoder().decode(parsed[0].data)).toBe('hello world');
  });

  it('多文件往返一致', async () => {
    const files = [
      { path: 'a.txt', data: new TextEncoder().encode('AAA') },
      { path: 'b/c.txt', data: new TextEncoder().encode('BBB') },
      { path: '中文/文件名.md', data: new TextEncoder().encode('内容') },
    ];
    const zip = buildZip(files);
    const parsed = parseZip(zip);
    expect(parsed.length).toBe(3);
    const paths = parsed.map((f) => f.path).sort();
    expect(paths).toEqual(['a.txt', 'b/c.txt', '中文/文件名.md'].sort());
  });

  it('二进制内容往返一致', async () => {
    const bin = new Uint8Array([0, 1, 2, 3, 255, 254, 0, 128]);
    const files = [{ path: 'bin.dat', data: bin }];
    const zip = buildZip(files);
    const parsed = parseZip(zip);
    expect(Array.from(parsed[0].data)).toEqual(Array.from(bin));
  });

  it('空文件往返', async () => {
    const files = [{ path: 'empty.txt', data: new Uint8Array(0) }];
    const zip = buildZip(files);
    const parsed = parseZip(zip);
    expect(parsed.length).toBe(1);
    expect(parsed[0].data.length).toBe(0);
  });

  it('parseZip 拒绝非 ZIP 数据', async () => {
    expect(() => parseZip(new TextEncoder().encode('not a zip'))).toThrow();
  });

  it('parseZip 拒绝非 STORE 压缩方法', () => {
    // 构造一个合法的 STORE zip，然后篡改 central record 的 method 字段为 DEFLATE(8)
    const files = [{ path: 'a.txt', data: new TextEncoder().encode('hello') }];
    const zip = buildZip(files);
    // 找到 central directory record 起始位置（EOCD 中记录）
    const dv = new DataView(zip.buffer);
    // 从尾部找 EOCD
    let eocdOff = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        eocdOff = i;
        break;
      }
    }
    const centralOff = dv.getUint32(eocdOff + 16, true);
    // central record 的 method 字段在 offset 10（u16，小端）
    // 把 method 从 0 改为 8 (DEFLATE)
    dv.setUint16(centralOff + 10, 8, true);
    expect(() => parseZip(zip)).toThrow(/STORE/);
  });

  it('parseZip 数据长度不匹配时抛错', () => {
    // 构造合法 STORE zip，然后篡改 central record 的 uncompressedSize 为超大值
    const files = [{ path: 'a.txt', data: new TextEncoder().encode('hello') }];
    const zip = buildZip(files);
    const dv = new DataView(zip.buffer);
    let eocdOff = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        eocdOff = i;
        break;
      }
    }
    const centralOff = dv.getUint32(eocdOff + 16, true);
    // central record 的 uncompressedSize 在 offset 24（u32，小端），篡改为超大值
    dv.setUint32(centralOff + 24, 9999, true);
    expect(() => parseZip(zip)).toThrow(/数据长度不匹配/);
  });
});

// ---------- exportVaultToZip / importVaultFromZip ----------

describe('exportVaultToZip / importVaultFromZip 往返', () => {
  const sampleData = () => ({
    project: new Project({
      id: 'p1',
      name: '梦说',
      subtitle: '一段旅程',
      genre: '玄幻',
      author: '佚名',
      target_words: 1000000,
      current_words: 100000,
    }),
    volumes: [
      new Volume({ vol_no: 1, vol_name: '启程', vol_goal: '入山门' }),
      new Volume({ vol_no: 2, vol_name: '觉醒', vol_goal: '觉醒金手指' }),
    ],
    chapters: [
      new Chapter({
        vol_no: 1,
        ch_no: 1,
        title: '初章',
        content: '主角入山门，清风拂过。',
        summary: '主角初入山门',
        highlights: ['我命由我'],
        status: 'draft',
      }),
      new Chapter({
        vol_no: 1,
        ch_no: 2,
        title: '风起',
        content: '风起云涌',
        status: 'published',
      }),
    ],
    hooks: [
      new Hook({
        hook_id: 'H-001',
        description: '红痣',
        scope: 'core',
        status: 'planted',
        planted_ch: 1,
        target_resolve_ch: 10,
      }),
    ],
    characters: [
      new Character({
        name: '主角',
        role: 'protagonist',
        identity: '孤儿',
        level: '凡人境',
        personality: '隐忍',
        arc: '1.蒙昧 → 2.觉醒',
        relation: '与师弟为宿敌',
        goal: '复仇',
      }),
    ],
    worldSettings: [
      new WorldSetting({ category: 'core_rules', content: '力量体系', sort_order: 1 }),
      new WorldSetting({ category: 'factions', content: '势力分布', sort_order: 2 }),
    ],
  });

  it('导出为 Blob（含 manifest.json）', async () => {
    const blob = exportVaultToZip(sampleData());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('导出后导入，数据往返一致', async () => {
    const data = sampleData();
    const blob = exportVaultToZip(data);
    const imported = await importVaultFromZip(blob);

    // project
    expect(imported.project).not.toBeNull();
    expect(imported.project.id).toBe('p1');
    expect(imported.project.name).toBe('梦说');
    expect(imported.project.target_words).toBe(1000000);

    // volumes
    expect(imported.volumes.length).toBe(2);
    expect(imported.volumes.map((v) => v.vol_name).sort()).toEqual(['启程', '觉醒']);

    // chapters
    expect(imported.chapters.length).toBe(2);
    const ch1 = imported.chapters.find((c) => c.ch_no === '001');
    expect(ch1.title).toBe('初章');
    expect(ch1.content).toContain('主角入山门');
    expect(ch1.summary).toBe('主角初入山门');
    expect(ch1.highlights).toEqual(['我命由我']);

    // hooks
    expect(imported.hooks.length).toBe(1);
    expect(imported.hooks[0].hook_id).toBe('H-001');
    expect(imported.hooks[0].scope).toBe('core');

    // characters
    expect(imported.characters.length).toBe(1);
    expect(imported.characters[0].name).toBe('主角');
    expect(imported.characters[0].role).toBe('protagonist');

    // world settings
    expect(imported.worldSettings.length).toBe(2);
    expect(imported.worldSettings.map((w) => w.category).sort()).toEqual([
      'core_rules',
      'factions',
    ]);
  });

  it('导出的 zip 内目录结构镜像 NovelForge_Vault', async () => {
    const blob = exportVaultToZip(sampleData());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const files = parseZip(bytes);
    const paths = files.map((f) => f.path);

    // 项目元数据
    expect(paths).toContain('00_控制面/project.json');
    // 卷元数据
    expect(paths).toContain('04_大纲与脉络/vol_01/vol_meta.json');
    expect(paths).toContain('04_大纲与脉络/vol_02/vol_meta.json');
    // 章节
    expect(paths).toContain('05_正文/drafts/vol_01/ch_001.md');
    expect(paths).toContain('05_正文/published/vol_01/ch_002.md');
    // 伏笔
    expect(paths).toContain('04_大纲与脉络/hooks_registry.json');
    // 角色
    expect(paths).toContain('02_角色/主角.md');
    // 世界设定
    expect(paths).toContain('01_世界观/core_rules.md');
    expect(paths).toContain('01_世界观/factions.md');
    // manifest
    expect(paths).toContain('manifest.json');
  });

  it('空项目也能导出导入不抛错', async () => {
    const data = {
      project: new Project({ id: 'empty', name: '空' }),
      chapters: [],
      hooks: [],
      volumes: [],
      characters: [],
      worldSettings: [],
    };
    const blob = exportVaultToZip(data);
    const imported = await importVaultFromZip(blob);
    expect(imported.project.id).toBe('empty');
    expect(imported.chapters).toEqual([]);
    expect(imported.hooks).toEqual([]);
  });

  it('导入无 manifest.json 抛错', async () => {
    const files = [{ path: 'a.txt', data: new TextEncoder().encode('A') }];
    const zip = buildZip(files);
    const blob = new Blob([zip], { type: 'application/zip' });
    await expect(importVaultFromZip(blob)).rejects.toThrow();
  });

  it('manifest 缺失 project 标记时从 project.json 兜底恢复', async () => {
    // 构造一个 manifest 没有 project 类型条目、但 00_控制面/project.json 存在的 zip
    const projectJson = JSON.stringify({ id: 'p-fallback', name: '兜底项目' });
    const manifest = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      project_id: 'p-fallback',
      files: [], // 故意不标记 project
    };
    const files = [
      { path: '00_控制面/project.json', data: new TextEncoder().encode(projectJson) },
      { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ];
    const zip = buildZip(files);
    const blob = new Blob([zip], { type: 'application/zip' });
    const imported = await importVaultFromZip(blob);
    expect(imported.project).not.toBeNull();
    expect(imported.project.id).toBe('p-fallback');
    expect(imported.project.name).toBe('兜底项目');
  });
});

// ---------- 角色 / 世界设定 Markdown ----------

describe('buildCharacterMarkdown / parseCharacterMarkdown 往返', () => {
  it('往返保持一致', () => {
    const c = new Character({
      name: '主角',
      role: 'protagonist',
      identity: '孤儿',
      level: '凡人境',
      personality: '隐忍、果决',
      arc: '1.蒙昧 → 2.觉醒',
      relation: '与师弟为宿敌',
      goal: '复仇',
      color: '#FF0000',
    });
    const md = buildCharacterMarkdown(c);
    expect(md).toContain('---');
    expect(md).toContain('name: "主角"');
    expect(md).toContain('# 主角');
    expect(md).toContain('## 性格');
    expect(md).toContain('隐忍、果决');

    const c2 = parseCharacterMarkdown(md);
    expect(c2.name).toBe('主角');
    expect(c2.role).toBe('protagonist');
    expect(c2.identity).toBe('孤儿');
    expect(c2.level).toBe('凡人境');
    expect(c2.color).toBe('#FF0000');
    expect(c2.personality).toBe('隐忍、果决');
    expect(c2.arc).toBe('1.蒙昧 → 2.觉醒');
    expect(c2.relation).toBe('与师弟为宿敌');
    expect(c2.goal).toBe('复仇');
  });
});

describe('buildWorldSettingMarkdown / parseWorldSettingMarkdown 往返', () => {
  it('往返保持一致', () => {
    const w = new WorldSetting({
      category: 'core_rules',
      content: '力量体系：凡人境 → 感应境',
      sort_order: 1,
    });
    const md = buildWorldSettingMarkdown(w);
    expect(md).toContain('category: "core_rules"');
    expect(md).toContain('sort_order: 1');
    expect(md).toContain('# core_rules');
    expect(md).toContain('力量体系');

    const w2 = parseWorldSettingMarkdown(md);
    expect(w2.category).toBe('core_rules');
    expect(w2.sort_order).toBe(1);
    expect(w2.content).toContain('力量体系');
  });
});

describe('角色 / 世界设定 Markdown 边界情况', () => {
  it('Character 空字段使用（暂无）占位', () => {
    const c = new Character({ name: '空角色', role: '', identity: '', level: '', color: '' });
    const md = buildCharacterMarkdown(c);
    expect(md).toContain('（暂无）');
    // 解析回来仍能拿到 name
    const c2 = parseCharacterMarkdown(md);
    expect(c2.name).toBe('空角色');
    expect(c2.personality).toBe('（暂无）'); // 占位文本被解析为 personality
  });

  it('WorldSetting 空内容仍可序列化', () => {
    const w = new WorldSetting({ category: 'empty', content: '', sort_order: 0 });
    const md = buildWorldSettingMarkdown(w);
    expect(md).toContain('category: "empty"');
    const w2 = parseWorldSettingMarkdown(md);
    expect(w2.category).toBe('empty');
    expect(w2.sort_order).toBe(0);
  });

  it('parseCharacterMarkdown 无 frontmatter 时返回空字段', () => {
    // 无 frontmatter 的裸文本
    const md = '# 某人\n\n## 性格\n豪爽\n';
    const c = parseCharacterMarkdown(md);
    expect(c.name).toBeUndefined(); // frontmatter 无 name
    expect(c.personality).toBe('豪爽');
  });

  it('parseWorldSettingMarkdown 无 # 标题时 body 作为 content', () => {
    // 无 # 标题的 markdown（只有 frontmatter + 正文）
    const md = '---\ncategory: "no_h1"\nsort_order: 2\n---\n\n直接是正文内容\n';
    const w = parseWorldSettingMarkdown(md);
    expect(w.category).toBe('no_h1');
    expect(w.sort_order).toBe(2);
    expect(w.content).toContain('直接是正文内容');
  });

  it('parseCharacterMarkdown ## 段落只有标题无内容时返回空字符串', () => {
    // ## 段后面紧跟下一个 ## 段（无内容）
    const md = '---\nname: "无内容"\n---\n\n# 无内容\n\n## 性格\n\n## 弧光\n\n## 目标\n有目标\n';
    const c = parseCharacterMarkdown(md);
    expect(c.name).toBe('无内容');
    expect(c.personality).toBe(''); // 空内容
    expect(c.arc).toBe(''); // 空内容
    expect(c.goal).toBe('有目标');
  });

  it('parseCharacterMarkdown ## 段为最后一行无换行', () => {
    // 最后一个 ## 段后无内容也无换行符（nlIdx < 0 分支，跳过该段）
    const md = '---\nname: "末段"\n---\n\n# 末段\n\n## 性格';
    const c = parseCharacterMarkdown(md);
    expect(c.name).toBe('末段');
    // 性格段标题后无换行，nlIdx < 0，跳过该段
    expect(c.personality).toBe('');
  });

  it('parseWorldSettingMarkdown # 标题后无 ## 段时 content 取全部 body', () => {
    // # 标题后只有正文，没有 ## 段（__body__ fallback 分支）
    const md = '---\ncategory: "only_h1"\nsort_order: 0\n---\n\n# only_h1\n\n这是纯正文内容，没有 ## 段。\n';
    const w = parseWorldSettingMarkdown(md);
    expect(w.category).toBe('only_h1');
    expect(w.sort_order).toBe(0);
    expect(w.content).toContain('纯正文内容');
  });
});

// ---------- 补充分支覆盖 ----------

describe('exportVaultToZip 稀疏数据（|| [] fallback）', () => {
  it('仅传 project，其余字段 undefined 时不抛错', async () => {
    const blob = exportVaultToZip({
      project: new Project({ id: 'sparse', name: '稀疏' }),
      // chapters / hooks / volumes / characters / worldSettings 全 undefined
    });
    expect(blob).toBeInstanceOf(Blob);
    const imported = await importVaultFromZip(blob);
    expect(imported.project.id).toBe('sparse');
    expect(imported.chapters).toEqual([]);
    expect(imported.hooks).toEqual([]);
    expect(imported.volumes).toEqual([]);
    expect(imported.characters).toEqual([]);
    expect(imported.worldSettings).toEqual([]);
  });
});

describe('importVaultFromZip manifest 边界', () => {
  it('manifest.files 为 undefined 时不抛错', async () => {
    // manifest 没有 files 字段
    const manifest = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      project_id: 'p-no-files',
      // files 字段故意缺失
    };
    const files = [
      { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ];
    const zip = buildZip(files);
    const blob = new Blob([zip], { type: 'application/zip' });
    const imported = await importVaultFromZip(blob);
    expect(imported.project).toBeNull();
    expect(imported.chapters).toEqual([]);
  });

  it('manifest 条目指向不存在的文件时跳过（if (!f) continue）', async () => {
    const manifest = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      project_id: 'p-missing',
      files: [
        { path: '00_控制面/project.json', type: 'project' },
        { path: '不存在.md', type: 'chapter' }, // 该文件不在 zip 中
      ],
    };
    const projectJson = JSON.stringify({ id: 'p-missing', name: '缺失测试' });
    const files = [
      { path: '00_控制面/project.json', data: new TextEncoder().encode(projectJson) },
      { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ];
    const zip = buildZip(files);
    const blob = new Blob([zip], { type: 'application/zip' });
    const imported = await importVaultFromZip(blob);
    // project 正常加载（manifest 标记 + 文件存在）
    expect(imported.project).not.toBeNull();
    expect(imported.project.id).toBe('p-missing');
    // 不存在的 chapter 被跳过
    expect(imported.chapters).toEqual([]);
  });
});

describe('parseZip 签名错误容错', () => {
  it('central record 签名错误时抛错', () => {
    const files = [{ path: 'a.txt', data: new TextEncoder().encode('A') }];
    const zip = buildZip(files);
    // 找到 central directory 起始位置并篡改签名
    const dv = new DataView(zip.buffer);
    let eocdOff = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        eocdOff = i;
        break;
      }
    }
    const centralOff = dv.getUint32(eocdOff + 16, true);
    // 篡改 central record 签名的第一个字节
    zip[centralOff] = 0x00;
    expect(() => parseZip(zip)).toThrow(/签名错误/);
  });
});
