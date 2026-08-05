import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IndexedDBBackend, openDB, _resetDBCache } from '../../src/storage/indexeddb-backend.js';
import { Project, Volume, Chapter, Hook, Character, WorldSetting } from '../../src/core/models.js';

// 测试用项目 ID
const PID = 'test-project-1';

// 创建带样本数据的后端实例
async function seedBackend() {
  _resetDBCache();
  const backend = new IndexedDBBackend();
  const project = new Project({ id: PID, name: '梦说', author: '佚名' });
  await backend.saveProject(project);
  await backend.saveVolume(PID, new Volume({ vol_no: 1, vol_name: '启程', vol_goal: '入山门' }));
  await backend.saveChapter(
    PID,
    new Chapter({
      vol_no: 1,
      ch_no: 1,
      title: '初章',
      content: '主角入山门',
      summary: '主角初入',
      highlights: ['我命由我'],
      status: 'draft',
    })
  );
  await backend.saveChapter(
    PID,
    new Chapter({
      vol_no: 1,
      ch_no: 2,
      title: '风起',
      content: '风起云涌',
      status: 'published',
    })
  );
  await backend.saveHook(
    PID,
    new Hook({
      hook_id: 'H-001',
      description: '红痣',
      scope: 'core',
      priority: 'high',
      strength: 'strong',
      planted_ch: 1,
      target_resolve_ch: 10,
    })
  );
  await backend.saveCharacter(
    PID,
    new Character({ name: '主角', role: 'protagonist', identity: '孤儿', level: '凡人境' })
  );
  await backend.saveWorldSetting(
    PID,
    new WorldSetting({ category: 'core_rules', content: '力量体系', sort_order: 1 })
  );
  return backend;
}

/** 清空所有 object store 数据（保留 schema），实现测试隔离 */
async function clearAllStores() {
  const db = await openDB();
  const storeNames = Array.from(db.objectStoreNames);
  if (storeNames.length > 0) {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeNames, 'readwrite');
      for (const name of storeNames) {
        transaction.objectStore(name).clear();
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  db.close();
}

beforeEach(async () => {
  // 重置 db 单例缓存，并清空所有 store 数据（不删除数据库，避免 fake-indexeddb 在有连接时 deleteDatabase 卡住）
  // 数据隔离通过清空 store 实现，确保每个测试用例从干净状态开始。
  _resetDBCache();
  await clearAllStores();
  _resetDBCache();
});

afterEach(async () => {
  _resetDBCache();
});

describe('IndexedDBBackend 基础', () => {
  it('name 返回 indexeddb', () => {
    const b = new IndexedDBBackend();
    expect(b.name).toBe('indexeddb');
  });

  it('继承 IStorageBackend', async () => {
    const { IStorageBackend } = await import('../../src/storage/interface.js');
    const b = new IndexedDBBackend();
    expect(b).toBeInstanceOf(IStorageBackend);
  });
});

describe('openDB schema', () => {
  it('创建 7 个 object stores', async () => {
    _resetDBCache();
    const db = await openDB();
    const storeNames = Array.from(db.objectStoreNames);
    expect(storeNames).toContain('projects');
    expect(storeNames).toContain('chapters');
    expect(storeNames).toContain('hooks');
    expect(storeNames).toContain('volumes');
    expect(storeNames).toContain('characters');
    expect(storeNames).toContain('world_settings');
    expect(storeNames).toContain('meta');
    db.close();
  });

  it('chapters store 有 project_id 索引', async () => {
    _resetDBCache();
    const db = await openDB();
    const tx = db.transaction('chapters', 'readonly');
    const store = tx.objectStore('chapters');
    expect(store.indexNames.contains('project_id')).toBe(true);
    db.close();
  });
});

describe('Project CRUD', () => {
  it('save + get 往返一致', async () => {
    const b = new IndexedDBBackend();
    const p = new Project({ id: 'p1', name: '梦说', author: '佚名', target_words: 1000000 });
    await b.saveProject(p);
    const got = await b.getProject('p1');
    expect(got).toBeInstanceOf(Project);
    expect(got.name).toBe('梦说');
    expect(got.author).toBe('佚名');
    expect(got.target_words).toBe(1000000);
  });

  it('saveProject 接受普通对象（非 Project 实例）', async () => {
    const b = new IndexedDBBackend();
    await b.saveProject({ id: 'p-obj', name: '裸对象项目' });
    const got = await b.getProject('p-obj');
    expect(got).toBeInstanceOf(Project);
    expect(got.name).toBe('裸对象项目');
  });

  it('getProject 不存在返回 null', async () => {
    const b = new IndexedDBBackend();
    const got = await b.getProject('nope');
    expect(got).toBeNull();
  });

  it('listProjects 返回所有项目', async () => {
    const b = new IndexedDBBackend();
    await b.saveProject(new Project({ id: 'p1', name: 'A' }));
    await b.saveProject(new Project({ id: 'p2', name: 'B' }));
    const list = await b.listProjects();
    expect(list.length).toBe(2);
    const names = list.map((p) => p.name).sort();
    expect(names).toEqual(['A', 'B']);
  });

  it('deleteProject 删除项目', async () => {
    const b = new IndexedDBBackend();
    await b.saveProject(new Project({ id: 'p1', name: 'A' }));
    await b.deleteProject('p1');
    const got = await b.getProject('p1');
    expect(got).toBeNull();
  });

  it('deleteProject 级联删除章节', async () => {
    const b = await seedBackend();
    await b.deleteProject(PID);
    const chapters = await b.listChapters(PID);
    expect(chapters).toEqual([]);
  });

  it('deleteProject 级联删除伏笔', async () => {
    const b = await seedBackend();
    await b.deleteProject(PID);
    const hooks = await b.listHooks(PID);
    expect(hooks).toEqual([]);
  });
});

describe('Chapter CRUD', () => {
  it('save + get 往返一致', async () => {
    const b = await seedBackend();
    const got = await b.getChapter(PID, 1, 1);
    expect(got).toBeInstanceOf(Chapter);
    expect(got.title).toBe('初章');
    expect(got.content).toBe('主角入山门');
    expect(got.highlights).toEqual(['我命由我']);
    expect(got.vol_no).toBe('01');
    expect(got.ch_no).toBe('001');
  });

  it('getChapter 不存在返回 null', async () => {
    const b = await seedBackend();
    const got = await b.getChapter(PID, 9, 9);
    expect(got).toBeNull();
  });

  it('saveChapter 接受普通对象（非 Chapter 实例）', async () => {
    const b = new IndexedDBBackend();
    await b.saveChapter('p2', { vol_no: 1, ch_no: 5, title: '裸对象章节', content: 'XYZ' });
    const got = await b.getChapter('p2', 1, 5);
    expect(got).toBeInstanceOf(Chapter);
    expect(got.title).toBe('裸对象章节');
    expect(got.content).toBe('XYZ');
  });

  it('listChapters 返回所有章节', async () => {
    const b = await seedBackend();
    const list = await b.listChapters(PID);
    expect(list.length).toBe(2);
  });

  it('listChapters 隔离不同项目', async () => {
    const b = await seedBackend();
    await b.saveProject(new Project({ id: 'p2', name: '其他' }));
    await b.saveChapter('p2', new Chapter({ vol_no: 1, ch_no: 1, title: '其他章' }));
    const listP1 = await b.listChapters(PID);
    const listP2 = await b.listChapters('p2');
    expect(listP1.length).toBe(2);
    expect(listP2.length).toBe(1);
    expect(listP2[0].title).toBe('其他章');
  });

  it('saveChapter 用复合 key 覆盖更新', async () => {
    const b = await seedBackend();
    await b.saveChapter(PID, new Chapter({ vol_no: 1, ch_no: 1, title: '改名后' }));
    const got = await b.getChapter(PID, 1, 1);
    expect(got.title).toBe('改名后');
    const list = await b.listChapters(PID);
    expect(list.length).toBe(2); // 仍是 2，未新增
  });

  it('deleteChapter 删除章节', async () => {
    const b = await seedBackend();
    await b.deleteChapter(PID, 1, 1);
    const got = await b.getChapter(PID, 1, 1);
    expect(got).toBeNull();
  });

  it('接受字符串 vol_no/ch_no', async () => {
    const b = await seedBackend();
    const got = await b.getChapter(PID, 'vol_01', 'ch_001');
    expect(got).not.toBeNull();
    expect(got.title).toBe('初章');
  });
});

describe('Hook CRUD', () => {
  it('save + list 往返一致', async () => {
    const b = await seedBackend();
    const list = await b.listHooks(PID);
    expect(list.length).toBe(1);
    expect(list[0]).toBeInstanceOf(Hook);
    expect(list[0].hook_id).toBe('H-001');
    expect(list[0].scope).toBe('core');
  });

  it('saveHook 用 hook_id 覆盖更新', async () => {
    const b = await seedBackend();
    await b.saveHook(
      PID,
      new Hook({ hook_id: 'H-001', description: '改后', status: 'hinted' })
    );
    const list = await b.listHooks(PID);
    expect(list.length).toBe(1);
    expect(list[0].description).toBe('改后');
    expect(list[0].status).toBe('hinted');
  });

  it('deleteHook 删除', async () => {
    const b = await seedBackend();
    await b.deleteHook(PID, 'H-001');
    const list = await b.listHooks(PID);
    expect(list).toEqual([]);
  });

  it('saveHook 接受普通对象（非 Hook 实例）', async () => {
    const b = new IndexedDBBackend();
    await b.saveHook('p2', { hook_id: 'H-999', description: '裸对象伏笔', scope: 'core' });
    const list = await b.listHooks('p2');
    expect(list.length).toBe(1);
    expect(list[0].hook_id).toBe('H-999');
    expect(list[0].scope).toBe('core');
  });
});

describe('Volume CRUD', () => {
  it('save + list 往返一致', async () => {
    const b = await seedBackend();
    const list = await b.listVolumes(PID);
    expect(list.length).toBe(1);
    expect(list[0]).toBeInstanceOf(Volume);
    expect(list[0].vol_name).toBe('启程');
    expect(list[0].vol_no).toBe('01');
  });

  it('saveVolume 接受普通对象（非 Volume 实例）', async () => {
    const b = new IndexedDBBackend();
    await b.saveVolume('p2', { vol_no: 3, vol_name: '第三卷' });
    const list = await b.listVolumes('p2');
    expect(list.length).toBe(1);
    expect(list[0].vol_name).toBe('第三卷');
    expect(list[0].vol_no).toBe('03');
  });
});

describe('Character CRUD', () => {
  it('save + list 往返一致', async () => {
    const b = await seedBackend();
    const list = await b.listCharacters(PID);
    expect(list.length).toBe(1);
    expect(list[0]).toBeInstanceOf(Character);
    expect(list[0].name).toBe('主角');
  });

  it('saveCharacter 接受普通对象（非 Character 实例）', async () => {
    const b = new IndexedDBBackend();
    await b.saveCharacter('p2', { name: '路人甲', role: 'supporting' });
    const list = await b.listCharacters('p2');
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('路人甲');
    expect(list[0].role).toBe('supporting');
  });
});

describe('WorldSetting CRUD', () => {
  it('save + list 往返一致', async () => {
    const b = await seedBackend();
    const list = await b.listWorldSettings(PID);
    expect(list.length).toBe(1);
    expect(list[0]).toBeInstanceOf(WorldSetting);
    expect(list[0].category).toBe('core_rules');
  });

  it('saveWorldSetting 接受普通对象（非 WorldSetting 实例）', async () => {
    const b = new IndexedDBBackend();
    await b.saveWorldSetting('p2', { category: 'magic_system', content: '灵气体系' });
    const list = await b.listWorldSettings('p2');
    expect(list.length).toBe(1);
    expect(list[0].category).toBe('magic_system');
  });
});

describe('exportVault / importVault 往返', () => {
  it('导出为 Blob', async () => {
    const b = await seedBackend();
    const blob = await b.exportVault(PID);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/zip');
  });

  it('导出后导入为新项目，数据往返一致', async () => {
    const b = await seedBackend();
    const blob = await b.exportVault(PID);

    // 用新 backend 实例导入（避免与原 db 冲突）
    const b2 = new IndexedDBBackend();
    const newId = await b2.importVault(blob);
    expect(newId).toBeTruthy();

    const project = await b2.getProject(newId);
    expect(project).not.toBeNull();
    expect(project.name).toBe('梦说');

    const chapters = await b2.listChapters(newId);
    expect(chapters.length).toBe(2);
    expect(chapters.map((c) => c.title).sort()).toEqual(['初章', '风起']);

    const hooks = await b2.listHooks(newId);
    expect(hooks.length).toBe(1);
    expect(hooks[0].hook_id).toBe('H-001');

    const volumes = await b2.listVolumes(newId);
    expect(volumes.length).toBe(1);
    expect(volumes[0].vol_name).toBe('启程');

    const characters = await b2.listCharacters(newId);
    expect(characters.length).toBe(1);
    expect(characters[0].name).toBe('主角');

    const worldSettings = await b2.listWorldSettings(newId);
    expect(worldSettings.length).toBe(1);
    expect(worldSettings[0].category).toBe('core_rules');
  });

  it('导入已存在的 id 时生成新 id', async () => {
    const b = await seedBackend();
    const blob = await b.exportVault(PID);
    // 再次导入到同一 backend：id 已存在，应生成后缀
    const newId = await b.importVault(blob);
    expect(newId).not.toBe(PID);
    expect(newId.startsWith(PID)).toBe(true);
  });

  it('exportVault 项目不存在抛错', async () => {
    const b = new IndexedDBBackend();
    await expect(b.exportVault('nope')).rejects.toThrow();
  });

  it('_importProjectData 接受缺失数组字段（undefined 容错）', async () => {
    const b = new IndexedDBBackend();
    // 直接调用 _importProjectData，传入只有 project、其余字段为 undefined 的数据
    const newId = await b._importProjectData({
      project: new Project({ id: 'p-sparse', name: '稀疏数据' }),
      // chapters / hooks / volumes / characters / worldSettings 全部 undefined
    });
    expect(newId).toBe('p-sparse');
    const project = await b.getProject(newId);
    expect(project.name).toBe('稀疏数据');
    // 空数组 fallback 不抛错
    expect(await b.listChapters(newId)).toEqual([]);
    expect(await b.listHooks(newId)).toEqual([]);
    expect(await b.listVolumes(newId)).toEqual([]);
    expect(await b.listCharacters(newId)).toEqual([]);
    expect(await b.listWorldSettings(newId)).toEqual([]);
  });
});

// ============================================================================
// 回归测试：projectId 必须是字符串，传 Project 对象必须抛错
//
// 背景 bug：features 层 currentProjectId() 误返回整个 Project 对象而非其 id 字符串，
// 导致复合 key [project_id, vol_no, ch_no] 实际变成 [Project{...}, '01', '001']，
// 浏览器抛出 "Failed to execute 'put' on 'IDBObjectStore': Evaluating the
// object store's key path yielded a value that is not a valid key."
//
// 此测试锁定存储层契约：即使上层误传对象，存储层也应明确抛错而非静默失败，
// 让问题在测试阶段就被发现。
// ============================================================================
describe('回归：projectId 类型契约（必须为字符串）', () => {
  it('saveChapter 传 Project 对象作为 projectId 应抛错', async () => {
    const b = new IndexedDBBackend();
    const project = new Project({ id: 'p-obj', name: '对象型项目' });
    await b.saveProject(project);

    const chapter = new Chapter({ vol_no: 1, ch_no: 1, title: '应失败', content: 'X' });
    // 错误用法：直接传 Project 对象（即原 bug 的复现路径）
    await expect(b.saveChapter(project, chapter)).rejects.toThrow();
  });

  it('saveChapter 传普通对象 {id:"x"} 作为 projectId 应抛错', async () => {
    const b = new IndexedDBBackend();
    await b.saveProject(new Project({ id: 'p-obj2', name: 'X' }));

    const chapter = new Chapter({ vol_no: 1, ch_no: 1, title: '应失败', content: 'Y' });
    // 错误用法：传 { id: 'p-obj2' } 而非 'p-obj2'
    await expect(b.saveChapter({ id: 'p-obj2' }, chapter)).rejects.toThrow();
  });

  it('saveChapter 传字符串 id 正常工作（正向用例，对比验证）', async () => {
    const b = new IndexedDBBackend();
    await b.saveProject(new Project({ id: 'p-str', name: '字符串项目' }));

    const chapter = new Chapter({ vol_no: 1, ch_no: 1, title: '正常', content: 'OK' });
    await expect(b.saveChapter('p-str', chapter)).resolves.toBeUndefined();
    const got = await b.getChapter('p-str', 1, 1);
    expect(got).not.toBeNull();
    expect(got.title).toBe('正常');
  });

  it('saveHook 传 Project 对象作为 projectId 应抛错', async () => {
    const b = new IndexedDBBackend();
    const project = new Project({ id: 'p-hook', name: 'Hook 项目' });
    await b.saveProject(project);

    const hook = new Hook({ hook_id: 'H-1', description: 'x', scope: 'core' });
    await expect(b.saveHook(project, hook)).rejects.toThrow();
  });

  it('saveVolume 传 Project 对象作为 projectId 应抛错', async () => {
    const b = new IndexedDBBackend();
    const project = new Project({ id: 'p-vol', name: '卷项目' });
    await b.saveProject(project);

    const volume = new Volume({ vol_no: 1, vol_name: '第一卷' });
    await expect(b.saveVolume(project, volume)).rejects.toThrow();
  });

  it('saveCharacter 传 Project 对象作为 projectId 应抛错', async () => {
    const b = new IndexedDBBackend();
    const project = new Project({ id: 'p-char', name: '角色项目' });
    await b.saveProject(project);

    const character = new Character({ name: '主角', role: 'protagonist' });
    await expect(b.saveCharacter(project, character)).rejects.toThrow();
  });

  it('saveWorldSetting 传 Project 对象作为 projectId 应抛错', async () => {
    const b = new IndexedDBBackend();
    const project = new Project({ id: 'p-ws', name: '世界设定项目' });
    await b.saveProject(project);

    const ws = new WorldSetting({ category: 'core_rules', content: 'x' });
    await expect(b.saveWorldSetting(project, ws)).rejects.toThrow();
  });
});
