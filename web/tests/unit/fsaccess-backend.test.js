import { describe, it, expect, beforeEach } from 'vitest';
import {
  FSAccessBackend,
  isFSAccessAvailable,
  ensureDir,
  writeTextFile,
  readTextFile,
  listDir,
  removeEntry,
} from '../../src/storage/fsaccess-backend.js';
import { Project, Volume, Chapter, Hook, Character, WorldSetting } from '../../src/core/models.js';

// ---------- 内存 FileSystemDirectoryHandle mock ----------

class MockFileHandle {
  constructor(name) {
    this.name = name;
    this.kind = 'file';
    this._content = '';
  }
  async createWritable() {
    const self = this;
    let chunks = [];
    return {
      write(data) {
        if (typeof data === 'string') chunks.push(data);
        else chunks.push(new TextDecoder().decode(data));
      },
      async close() {
        self._content = chunks.join('');
      },
    };
  }
  async getFile() {
    const self = this;
    return {
      async text() {
        return self._content;
      },
      async arrayBuffer() {
        return new TextEncoder().encode(self._content).buffer;
      },
    };
  }
}

class MockDirHandle {
  constructor(name = '') {
    this.name = name;
    this.kind = 'directory';
    this._children = new Map();
  }
  async getDirectoryHandle(name, opts = {}) {
    const cur = this._children.get(name);
    if (cur && cur.kind !== 'directory') {
      throw new Error(`已存在同名文件：${name}`);
    }
    if (!cur) {
      if (!opts.create) {
        const e = new Error(`not found: ${name}`);
        e.name = 'NotFoundError';
        e.code = 8;
        throw e;
      }
      const dir = new MockDirHandle(name);
      this._children.set(name, dir);
      return dir;
    }
    return cur;
  }
  async getFileHandle(name, opts = {}) {
    const cur = this._children.get(name);
    if (cur && cur.kind !== 'file') {
      throw new Error(`已存在同名目录：${name}`);
    }
    if (!cur) {
      if (!opts.create) {
        const e = new Error(`not found: ${name}`);
        e.name = 'NotFoundError';
        e.code = 8;
        throw e;
      }
      const file = new MockFileHandle(name);
      this._children.set(name, file);
      return file;
    }
    return cur;
  }
  async *values() {
    for (const v of this._children.values()) {
      yield v;
    }
  }
  async removeEntry(name) {
    if (!this._children.has(name)) {
      const e = new Error(`not found: ${name}`);
      e.name = 'NotFoundError';
      throw e;
    }
    this._children.delete(name);
  }
}

// ---------- 检测 ----------

describe('isFSAccessAvailable', () => {
  it('在 jsdom 中默认返回 false（无 showDirectoryPicker）', () => {
    expect(isFSAccessAvailable()).toBe(false);
  });

  it('注入 showDirectoryPicker 后返回 true', () => {
    globalThis.showDirectoryPicker = async () => new MockDirHandle('root');
    expect(isFSAccessAvailable()).toBe(true);
    delete globalThis.showDirectoryPicker;
  });
});

// ---------- 工具函数 ----------

describe('ensureDir', () => {
  it('递归创建多级目录', async () => {
    const root = new MockDirHandle('root');
    const dir = await ensureDir(root, ['a', 'b', 'c'], { create: true });
    expect(dir).toBeInstanceOf(MockDirHandle);
    // 验证已创建
    const a = await root.getDirectoryHandle('a');
    const b = await a.getDirectoryHandle('b');
    const c = await b.getDirectoryHandle('c');
    expect(c).toBe(dir);
  });

  it('create=false 时不存在抛 NotFoundError', async () => {
    const root = new MockDirHandle('root');
    await expect(ensureDir(root, ['nope'], { create: false })).rejects.toThrow();
  });
});

describe('writeTextFile / readTextFile', () => {
  it('写入后读取一致', async () => {
    const dir = new MockDirHandle('root');
    await writeTextFile(dir, 'a.txt', 'hello');
    const text = await readTextFile(dir, 'a.txt');
    expect(text).toBe('hello');
  });

  it('readTextFile 不存在返回 null', async () => {
    const dir = new MockDirHandle('root');
    const text = await readTextFile(dir, 'nope.txt');
    expect(text).toBeNull();
  });
});

describe('listDir / removeEntry', () => {
  it('listDir 返回所有子项', async () => {
    const dir = new MockDirHandle('root');
    await writeTextFile(dir, 'a.txt', 'A');
    await writeTextFile(dir, 'b.txt', 'B');
    await dir.getDirectoryHandle('sub', { create: true });
    const items = await listDir(dir);
    expect(items.length).toBe(3);
  });

  it('removeEntry 删除文件', async () => {
    const dir = new MockDirHandle('root');
    await writeTextFile(dir, 'a.txt', 'A');
    const ok = await removeEntry(dir, 'a.txt');
    expect(ok).toBe(true);
    const text = await readTextFile(dir, 'a.txt');
    expect(text).toBeNull();
  });

  it('removeEntry 不存在返回 false', async () => {
    const dir = new MockDirHandle('root');
    const ok = await removeEntry(dir, 'nope.txt');
    expect(ok).toBe(false);
  });
});

// ---------- FSAccessBackend CRUD ----------

describe('FSAccessBackend 基础', () => {
  it('name 返回 fsaccess', () => {
    const b = new FSAccessBackend(new MockDirHandle('root'));
    expect(b.name).toBe('fsaccess');
  });

  it('无 rootDirHandle 且无 showDirectoryPicker 时抛 NotSupportedError', () => {
    // jsdom 默认无 showDirectoryPicker
    expect(() => new FSAccessBackend()).toThrow(/不支持/);
  });
});

describe('FSAccessBackend Project CRUD', () => {
  let root;
  let backend;
  beforeEach(() => {
    root = new MockDirHandle('root');
    backend = new FSAccessBackend(root);
  });

  it('saveProject + getProject 往返一致', async () => {
    const p = new Project({ id: 'p1', name: '梦说', author: '佚名' });
    await backend.saveProject(p);
    const got = await backend.getProject('p1');
    expect(got).toBeInstanceOf(Project);
    expect(got.name).toBe('梦说');
  });

  it('getProject 不存在返回 null', async () => {
    const got = await backend.getProject('nope');
    expect(got).toBeNull();
  });

  it('listProjects 返回项目', async () => {
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
    const list = await backend.listProjects();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('梦说');
  });

  it('listProjects 无 project.json 返回空', async () => {
    const list = await backend.listProjects();
    expect(list).toEqual([]);
  });

  it('deleteProject 删除所有项目相关目录', async () => {
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
    await backend.saveChapter('p1', new Chapter({ vol_no: 1, ch_no: 1, title: '初章', content: 'X' }));
    await backend.saveHook('p1', new Hook({ hook_id: 'H-001' }));
    await backend.saveVolume('p1', new Volume({ vol_no: 1, vol_name: '启程' }));
    await backend.saveCharacter('p1', new Character({ name: '主角' }));
    await backend.saveWorldSetting('p1', new WorldSetting({ category: 'core_rules', content: 'X' }));
    await backend.deleteProject('p1');
    // 所有目录应被删除
    const root = backend._root;
    expect(root._children.has('00_控制面')).toBe(false);
    expect(root._children.has('04_大纲与脉络')).toBe(false);
    expect(root._children.has('05_正文')).toBe(false);
    expect(root._children.has('02_角色')).toBe(false);
    expect(root._children.has('01_世界观')).toBe(false);
  });

  it('_getRoot 未注入 root 且环境不支持时抛 NotSupportedError', async () => {
    // 构造一个没有 root 且没有 showDirectoryPicker 的环境
    const originalPicker = globalThis.showDirectoryPicker;
    delete globalThis.showDirectoryPicker;
    try {
      const b = new FSAccessBackend.__proto__.constructor(); // 不调用构造函数的检查
      // 直接用 IStorageBackend 子类绕过构造检查
      const bare = Object.create(FSAccessBackend.prototype);
      bare._root = null;
      await expect(bare._getRoot()).rejects.toThrow(/不支持/);
    } finally {
      if (originalPicker) globalThis.showDirectoryPicker = originalPicker;
    }
  });
});

describe('FSAccessBackend Chapter CRUD', () => {
  let root;
  let backend;
  beforeEach(async () => {
    root = new MockDirHandle('root');
    backend = new FSAccessBackend(root);
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
  });

  it('saveChapter + getChapter 往返一致（draft）', async () => {
    const c = new Chapter({
      vol_no: 1,
      ch_no: 1,
      title: '初章',
      content: '主角入山门',
      summary: '主角初入',
      highlights: ['我命由我'],
      status: 'draft',
    });
    await backend.saveChapter('p1', c);
    const got = await backend.getChapter('p1', 1, 1);
    expect(got).toBeInstanceOf(Chapter);
    expect(got.title).toBe('初章');
    expect(got.content).toContain('主角入山门');
    expect(got.highlights).toEqual(['我命由我']);
  });

  it('getChapter 不存在返回 null', async () => {
    const got = await backend.getChapter('p1', 9, 9);
    expect(got).toBeNull();
  });

  it('saveChapter 覆盖同 key 章节', async () => {
    await backend.saveChapter('p1', new Chapter({ vol_no: 1, ch_no: 1, title: '旧', content: 'X' }));
    await backend.saveChapter('p1', new Chapter({ vol_no: 1, ch_no: 1, title: '新', content: 'Y' }));
    const got = await backend.getChapter('p1', 1, 1);
    expect(got.title).toBe('新');
    const list = await backend.listChapters('p1');
    expect(list.length).toBe(1);
  });

  it('listChapters 跨 drafts/published 收集', async () => {
    await backend.saveChapter('p1', new Chapter({ vol_no: 1, ch_no: 1, title: 'A', status: 'draft' }));
    await backend.saveChapter('p1', new Chapter({ vol_no: 1, ch_no: 2, title: 'B', status: 'published' }));
    const list = await backend.listChapters('p1');
    expect(list.length).toBe(2);
  });

  it('deleteChapter 删除章节', async () => {
    await backend.saveChapter('p1', new Chapter({ vol_no: 1, ch_no: 1, title: 'A' }));
    await backend.deleteChapter('p1', 1, 1);
    const got = await backend.getChapter('p1', 1, 1);
    expect(got).toBeNull();
  });
});

describe('FSAccessBackend Hook CRUD', () => {
  let backend;
  beforeEach(async () => {
    const root = new MockDirHandle('root');
    backend = new FSAccessBackend(root);
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
  });

  it('saveHook + listHooks 往返一致', async () => {
    await backend.saveHook('p1', new Hook({ hook_id: 'H-001', description: '红痣', scope: 'core' }));
    const list = await backend.listHooks('p1');
    expect(list.length).toBe(1);
    expect(list[0].hook_id).toBe('H-001');
    expect(list[0].scope).toBe('core');
  });

  it('saveHook 用 hook_id 覆盖更新', async () => {
    await backend.saveHook('p1', new Hook({ hook_id: 'H-001', description: '旧' }));
    await backend.saveHook('p1', new Hook({ hook_id: 'H-001', description: '新' }));
    const list = await backend.listHooks('p1');
    expect(list.length).toBe(1);
    expect(list[0].description).toBe('新');
  });

  it('deleteHook 删除', async () => {
    await backend.saveHook('p1', new Hook({ hook_id: 'H-001' }));
    await backend.deleteHook('p1', 'H-001');
    const list = await backend.listHooks('p1');
    expect(list).toEqual([]);
  });

  it('listHooks 无 hooks 文件返回空', async () => {
    const list = await backend.listHooks('p1');
    expect(list).toEqual([]);
  });

  it('listHooks JSON 损坏时返回空数组（容错）', async () => {
    // 直接写入损坏的 hooks_registry.json
    await backend._writeVaultFile('04_大纲与脉络/hooks_registry.json', '{invalid json');
    const list = await backend.listHooks('p1');
    expect(list).toEqual([]);
  });
});

describe('FSAccessBackend Volume CRUD', () => {
  let backend;
  beforeEach(async () => {
    const root = new MockDirHandle('root');
    backend = new FSAccessBackend(root);
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
  });

  it('saveVolume + listVolumes 往返一致', async () => {
    await backend.saveVolume('p1', new Volume({ vol_no: 1, vol_name: '启程', vol_goal: '入山门' }));
    const list = await backend.listVolumes('p1');
    expect(list.length).toBe(1);
    expect(list[0].vol_name).toBe('启程');
  });

  it('listVolumes vol_meta.json 损坏时跳过该卷（容错）', async () => {
    // 写入一个合法卷
    await backend.saveVolume('p1', new Volume({ vol_no: 1, vol_name: '启程' }));
    // 再写入一个损坏的 vol_02/vol_meta.json
    const { ensureDir, writeTextFile } = await import('../../src/storage/fsaccess-backend.js');
    const root = backend._root;
    const vol2Dir = await ensureDir(root, ['04_大纲与脉络', 'vol_02'], { create: true });
    await writeTextFile(vol2Dir, 'vol_meta.json', '{broken json');
    // listVolumes 应跳过损坏的卷，只返回合法的
    const list = await backend.listVolumes('p1');
    expect(list.length).toBe(1);
    expect(list[0].vol_name).toBe('启程');
  });
});

describe('FSAccessBackend Character CRUD', () => {
  let backend;
  beforeEach(async () => {
    const root = new MockDirHandle('root');
    backend = new FSAccessBackend(root);
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
  });

  it('saveCharacter + listCharacters 往返一致', async () => {
    await backend.saveCharacter('p1', new Character({ name: '主角', role: 'protagonist' }));
    const list = await backend.listCharacters('p1');
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('主角');
  });
});

describe('FSAccessBackend WorldSetting CRUD', () => {
  let backend;
  beforeEach(async () => {
    const root = new MockDirHandle('root');
    backend = new FSAccessBackend(root);
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
  });

  it('saveWorldSetting + listWorldSettings 往返一致', async () => {
    await backend.saveWorldSetting('p1', new WorldSetting({ category: 'core_rules', content: '力量体系' }));
    const list = await backend.listWorldSettings('p1');
    expect(list.length).toBe(1);
    expect(list[0].category).toBe('core_rules');
  });
});

describe('FSAccessBackend exportVault / importVault', () => {
  it('导出后导入数据一致', async () => {
    const root = new MockDirHandle('root');
    const backend = new FSAccessBackend(root);
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
    await backend.saveChapter('p1', new Chapter({ vol_no: 1, ch_no: 1, title: '初章', content: 'A' }));
    await backend.saveHook('p1', new Hook({ hook_id: 'H-001', description: '红痣' }));
    await backend.saveVolume('p1', new Volume({ vol_no: 1, vol_name: '启程' }));
    await backend.saveCharacter('p1', new Character({ name: '主角' }));
    await backend.saveWorldSetting('p1', new WorldSetting({ category: 'core_rules', content: 'X' }));

    const blob = await backend.exportVault('p1');
    expect(blob.size).toBeGreaterThan(0);

    // 导入到新 root
    const root2 = new MockDirHandle('root2');
    const backend2 = new FSAccessBackend(root2);
    const newId = await backend2.importVault(blob);
    expect(newId).toBe('p1');

    const project = await backend2.getProject(newId);
    expect(project.name).toBe('梦说');
    const chapters = await backend2.listChapters(newId);
    expect(chapters.length).toBe(1);
    const hooks = await backend2.listHooks(newId);
    expect(hooks.length).toBe(1);
  });
});

describe('FSAccessBackend pickRoot', () => {
  it('不支持时抛 NotSupportedError', async () => {
    // jsdom 默认无 showDirectoryPicker
    const backend = new FSAccessBackend(new MockDirHandle('root'));
    // backend 已有 root，pickRoot 仍要求 showDirectoryPicker
    await expect(backend.pickRoot()).rejects.toThrow(/不支持/);
  });

  it('支持时调用 showDirectoryPicker', async () => {
    globalThis.showDirectoryPicker = async () => new MockDirHandle('picked');
    const backend = new FSAccessBackend();
    const root = await backend.pickRoot();
    expect(root).toBeInstanceOf(MockDirHandle);
    delete globalThis.showDirectoryPicker;
  });
});

describe('FSAccessBackend _getRoot 延迟 pick', () => {
  it('无 root 时自动调用 showDirectoryPicker', async () => {
    globalThis.showDirectoryPicker = async () => new MockDirHandle('auto-picked');
    const backend = new FSAccessBackend();
    await backend.saveProject(new Project({ id: 'p1', name: '梦说' }));
    const got = await backend.getProject('p1');
    expect(got.name).toBe('梦说');
    delete globalThis.showDirectoryPicker;
  });
});

// ---------- 边界与容错分支 ----------

describe('readTextFile 非 NotFoundError 也返回 null', () => {
  it('getFileHandle 抛非 NotFoundError 时返回 null', async () => {
    const throwingDir = {
      async getFileHandle() {
        const e = new Error('Permission denied');
        e.name = 'NotAllowedError';
        throw e;
      },
    };
    const text = await readTextFile(throwingDir, 'file.txt');
    expect(text).toBeNull();
  });
});

describe('FSAccessBackend 空目录早期返回', () => {
  it('listChapters 无正文目录时返回空', async () => {
    const backend = new FSAccessBackend(new MockDirHandle('root'));
    const list = await backend.listChapters('p1');
    expect(list).toEqual([]);
  });

  it('listCharacters 无角色目录时返回空', async () => {
    const backend = new FSAccessBackend(new MockDirHandle('root'));
    const list = await backend.listCharacters('p1');
    expect(list).toEqual([]);
  });

  it('listWorldSettings 无世界观目录时返回空', async () => {
    const backend = new FSAccessBackend(new MockDirHandle('root'));
    const list = await backend.listWorldSettings('p1');
    expect(list).toEqual([]);
  });

  it('listVolumes 无大纲目录时返回空', async () => {
    const backend = new FSAccessBackend(new MockDirHandle('root'));
    const list = await backend.listVolumes('p1');
    expect(list).toEqual([]);
  });

  it('listProjects 控制面存在但无 project.json 返回空', async () => {
    const root = new MockDirHandle('root');
    await ensureDir(root, ['00_控制面'], { create: true });
    const backend = new FSAccessBackend(root);
    const list = await backend.listProjects();
    expect(list).toEqual([]);
  });
});

describe('FSAccessBackend listChapters 过滤非目录与非 md 文件', () => {
  it('跳过 drafts 下的非目录项与非 .md 文件', async () => {
    const root = new MockDirHandle('root');
    const backend = new FSAccessBackend(root);
    // 创建合法章节
    await backend.saveChapter('p1', new Chapter({ vol_no: 1, ch_no: 1, title: 'A', status: 'draft' }));
    // 在 drafts/ 下放一个杂散文件（非目录）
    const textDir = await ensureDir(root, ['05_正文', 'drafts'], { create: false });
    await writeTextFile(textDir, 'junk.txt', 'junk');
    // 在 vol_01/ 下放一个非 .md 文件
    const volDir = await ensureDir(textDir, ['vol_01'], { create: false });
    await writeTextFile(volDir, 'notes.txt', 'notes');
    const list = await backend.listChapters('p1');
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('A');
  });
});

describe('FSAccessBackend deleteHook 无匹配时 no-op', () => {
  it('删除不存在的 hook 不写文件', async () => {
    const root = new MockDirHandle('root');
    const backend = new FSAccessBackend(root);
    await backend.saveHook('p1', new Hook({ hook_id: 'H-001', description: '红痣' }));
    // 删除不存在的 hook
    await backend.deleteHook('p1', 'H-999');
    // H-001 仍在
    const list = await backend.listHooks('p1');
    expect(list.length).toBe(1);
    expect(list[0].hook_id).toBe('H-001');
  });
});

describe('FSAccessBackend _readVaultFile / _deleteVaultFile 缺失目录', () => {
  it('_readVaultFile 父目录不存在返回 null', async () => {
    const backend = new FSAccessBackend(new MockDirHandle('root'));
    const text = await backend._readVaultFile('04_大纲与脉络/vol_99/ch_099.md');
    expect(text).toBeNull();
  });

  it('_deleteVaultFile 父目录不存在返回 false', async () => {
    const backend = new FSAccessBackend(new MockDirHandle('root'));
    const ok = await backend._deleteVaultFile('04_大纲与脉络/vol_99/ch_099.md');
    expect(ok).toBe(false);
  });
});

// ---------- 补充分支覆盖 ----------

describe('FSAccessBackend saveWorldSetting / saveCharacter 接受普通对象', () => {
  it('saveWorldSetting 接受普通对象（非 WorldSetting 实例）', async () => {
    const root = new MockDirHandle('root');
    const backend = new FSAccessBackend(root);
    // 传入普通对象而非 new WorldSetting(...)
    await backend.saveWorldSetting('p1', { category: 'magic', content: '灵气', sort_order: 1 });
    const list = await backend.listWorldSettings('p1');
    expect(list.length).toBe(1);
    expect(list[0].category).toBe('magic');
    expect(list[0].content).toContain('灵气');
  });

  it('saveCharacter 接受普通对象（非 Character 实例）', async () => {
    const root = new MockDirHandle('root');
    const backend = new FSAccessBackend(root);
    // 传入普通对象而非 new Character(...)
    await backend.saveCharacter('p1', { name: '裸对象角色', role: 'supporting' });
    const list = await backend.listCharacters('p1');
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('裸对象角色');
  });
});

describe('FSAccessBackend exportVault 项目不存在抛错', () => {
  it('exportVault 不存在的 projectId 抛错', async () => {
    const root = new MockDirHandle('root');
    const backend = new FSAccessBackend(root);
    await expect(backend.exportVault('nonexistent')).rejects.toThrow(/项目不存在/);
  });
});
