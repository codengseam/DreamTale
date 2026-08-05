// IndexedDB 存储后端
// 纯原生 IndexedDB API，无第三方库。
// 数据库：dreamtale
// object stores: projects, chapters, hooks, volumes, characters, world_settings, meta
// chapters 用 [project_id, vol_no, ch_no] 作为复合 key（keyPath）
// 所有非 projects store 都建 project_id 单字段索引，便于按项目查询与级联删除。

import { IStorageBackend, NotSupportedError } from './interface.js';
import { Project, Volume, Chapter, Hook, Character, WorldSetting } from '../core/models.js';
import { normalizeVol, normalizeCh } from '../core/vault-schema.js';

const DB_NAME = 'dreamtale';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_CHAPTERS = 'chapters';
const STORE_HOOKS = 'hooks';
const STORE_VOLUMES = 'volumes';
const STORE_CHARACTERS = 'characters';
const STORE_WORLD_SETTINGS = 'world_settings';
const STORE_META = 'meta';

/** 章节复合 key 字段名 */
const CHAPTER_KEY = ['project_id', 'vol_no', 'ch_no'];

/** 需要建 project_id 索引的 store 列表 */
const PROJECT_SCOPED_STORES = [
  STORE_CHAPTERS,
  STORE_HOOKS,
  STORE_VOLUMES,
  STORE_CHARACTERS,
  STORE_WORLD_SETTINGS,
];

// ---------- 打开/升级数据库 ----------

let _dbPromise = null;

/** 打开数据库 */
export function openDB(dbName = DB_NAME, version = DB_VERSION) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // projects store: keyPath = 'id'
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      // chapters store: 复合 key [project_id, vol_no, ch_no]
      if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
        const store = db.createObjectStore(STORE_CHAPTERS, { keyPath: CHAPTER_KEY });
        store.createIndex('project_id', 'project_id', { unique: false });
      }
      // hooks store: 复合 key [project_id, hook_id]
      if (!db.objectStoreNames.contains(STORE_HOOKS)) {
        const store = db.createObjectStore(STORE_HOOKS, { keyPath: ['project_id', 'hook_id'] });
        store.createIndex('project_id', 'project_id', { unique: false });
      }
      // volumes store: 复合 key [project_id, vol_no]
      if (!db.objectStoreNames.contains(STORE_VOLUMES)) {
        const store = db.createObjectStore(STORE_VOLUMES, { keyPath: ['project_id', 'vol_no'] });
        store.createIndex('project_id', 'project_id', { unique: false });
      }
      // characters store: 复合 key [project_id, name]
      if (!db.objectStoreNames.contains(STORE_CHARACTERS)) {
        const store = db.createObjectStore(STORE_CHARACTERS, { keyPath: ['project_id', 'name'] });
        store.createIndex('project_id', 'project_id', { unique: false });
      }
      // world_settings store: 复合 key [project_id, category]
      if (!db.objectStoreNames.contains(STORE_WORLD_SETTINGS)) {
        const store = db.createObjectStore(STORE_WORLD_SETTINGS, {
          keyPath: ['project_id', 'category'],
        });
        store.createIndex('project_id', 'project_id', { unique: false });
      }
      // meta store: KV 元数据
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB 打开被阻塞'));
  });
}

/** 测试钩子：重置数据库单例 */
export function _resetDBCache() {
  _dbPromise = null;
}

// ---------- 工具：事务封装 ----------

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 用 project_id 索引按项目查询全部记录 */
async function getAllByProject(db, storeName, projectId) {
  return new Promise((resolve, reject) => {
    const store = tx(db, storeName, 'readonly');
    const index = store.index('project_id');
    const request = index.getAll(IDBKeyRange.only(projectId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/** 用 cursor 遍历删除某项目下某 store 的全部记录 */
async function deleteAllByProject(db, storeName, projectId) {
  return new Promise((resolve, reject) => {
    const store = tx(db, storeName, 'readwrite');
    const index = store.index('project_id');
    const request = index.openCursor(IDBKeyRange.only(projectId));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// ---------- IndexedDBBackend ----------

export class IndexedDBBackend extends IStorageBackend {
  constructor() {
    super();
    this._dbName = DB_NAME;
  }

  get name() {
    return 'indexeddb';
  }

  async _db() {
    if (!_dbPromise) _dbPromise = openDB(this._dbName);
    return _dbPromise;
  }

  // ---------- 项目 ----------

  async listProjects() {
    const db = await this._db();
    const result = await reqToPromise(tx(db, STORE_PROJECTS, 'readonly').getAll());
    return (result || []).map((r) => Project.fromJSON(r));
  }

  async getProject(id) {
    const db = await this._db();
    const result = await reqToPromise(tx(db, STORE_PROJECTS, 'readonly').get(id));
    return result ? Project.fromJSON(result) : null;
  }

  async saveProject(project) {
    const db = await this._db();
    const p = project instanceof Project ? project : new Project(project);
    const data = { ...p.toJSON(), id: p.id };
    await reqToPromise(tx(db, STORE_PROJECTS, 'readwrite').put(data));
  }

  async deleteProject(id) {
    const db = await this._db();
    // 删除项目本身
    await reqToPromise(tx(db, STORE_PROJECTS, 'readwrite').delete(id));
    // 级联删除其他 store 中该项目的所有数据
    for (const store of PROJECT_SCOPED_STORES) {
      await deleteAllByProject(db, store, id);
    }
  }

  // ---------- 章节 ----------

  async listChapters(projectId) {
    const db = await this._db();
    const rows = await getAllByProject(db, STORE_CHAPTERS, projectId);
    return rows.map((r) => Chapter.fromJSON(r));
  }

  async getChapter(projectId, vol_no, ch_no) {
    const db = await this._db();
    const v = normalizeVol(vol_no);
    const c = normalizeCh(ch_no);
    const result = await reqToPromise(
      tx(db, STORE_CHAPTERS, 'readonly').get([projectId, v, c])
    );
    return result ? Chapter.fromJSON(result) : null;
  }

  async saveChapter(projectId, chapter) {
    const db = await this._db();
    const c = chapter instanceof Chapter ? chapter : new Chapter(chapter);
    const data = {
      ...c.toJSON(),
      project_id: projectId,
      vol_no: normalizeVol(c.vol_no),
      ch_no: normalizeCh(c.ch_no),
    };
    await reqToPromise(tx(db, STORE_CHAPTERS, 'readwrite').put(data));
  }

  async deleteChapter(projectId, vol_no, ch_no) {
    const db = await this._db();
    const v = normalizeVol(vol_no);
    const c = normalizeCh(ch_no);
    await reqToPromise(tx(db, STORE_CHAPTERS, 'readwrite').delete([projectId, v, c]));
  }

  // ---------- 伏笔 ----------

  async listHooks(projectId) {
    const db = await this._db();
    const rows = await getAllByProject(db, STORE_HOOKS, projectId);
    return rows.map((r) => Hook.fromJSON(r));
  }

  async saveHook(projectId, hook) {
    const db = await this._db();
    const h = hook instanceof Hook ? hook : new Hook(hook);
    const data = { ...h.toJSON(), project_id: projectId };
    await reqToPromise(tx(db, STORE_HOOKS, 'readwrite').put(data));
  }

  async deleteHook(projectId, hook_id) {
    const db = await this._db();
    await reqToPromise(tx(db, STORE_HOOKS, 'readwrite').delete([projectId, hook_id]));
  }

  // ---------- 卷 ----------

  async listVolumes(projectId) {
    const db = await this._db();
    const rows = await getAllByProject(db, STORE_VOLUMES, projectId);
    return rows.map((r) => Volume.fromJSON(r));
  }

  async saveVolume(projectId, volume) {
    const db = await this._db();
    const v = volume instanceof Volume ? volume : new Volume(volume);
    const data = { ...v.toJSON(), project_id: projectId, vol_no: normalizeVol(v.vol_no) };
    await reqToPromise(tx(db, STORE_VOLUMES, 'readwrite').put(data));
  }

  // ---------- 角色 ----------

  async listCharacters(projectId) {
    const db = await this._db();
    const rows = await getAllByProject(db, STORE_CHARACTERS, projectId);
    return rows.map((r) => Character.fromJSON(r));
  }

  async saveCharacter(projectId, character) {
    const db = await this._db();
    const c = character instanceof Character ? character : new Character(character);
    const data = { ...c.toJSON(), project_id: projectId };
    await reqToPromise(tx(db, STORE_CHARACTERS, 'readwrite').put(data));
  }

  /** 批量保存角色（单事务原子写入） */
  async saveCharacters(projectId, characters) {
    if (!characters || !characters.length) return;
    const db = await this._db();
    const transaction = db.transaction(STORE_CHARACTERS, 'readwrite');
    const store = transaction.objectStore(STORE_CHARACTERS);
    for (const character of characters) {
      const c = character instanceof Character ? character : new Character(character);
      const data = { ...c.toJSON(), project_id: projectId };
      store.put(data);
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('批量保存角色被中止'));
    });
  }

  // ---------- 世界设定 ----------

  async listWorldSettings(projectId) {
    const db = await this._db();
    const rows = await getAllByProject(db, STORE_WORLD_SETTINGS, projectId);
    return rows.map((r) => WorldSetting.fromJSON(r));
  }

  async saveWorldSetting(projectId, setting) {
    const db = await this._db();
    const w = setting instanceof WorldSetting ? setting : new WorldSetting(setting);
    const data = { ...w.toJSON(), project_id: projectId };
    await reqToPromise(tx(db, STORE_WORLD_SETTINGS, 'readwrite').put(data));
  }

  /** 批量保存世界设定（单事务原子写入） */
  async saveWorldSettings(projectId, settings) {
    if (!settings || !settings.length) return;
    const db = await this._db();
    const transaction = db.transaction(STORE_WORLD_SETTINGS, 'readwrite');
    const store = transaction.objectStore(STORE_WORLD_SETTINGS);
    for (const setting of settings) {
      const w = setting instanceof WorldSetting ? setting : new WorldSetting(setting);
      const data = { ...w.toJSON(), project_id: projectId };
      store.put(data);
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('批量保存设定被中止'));
    });
  }

  // ---------- 导入导出 ----------

  async exportVault(projectId) {
    // 延迟加载 zip-utils，避免循环依赖
    const { exportVaultToZip } = await import('./zip-utils.js');
    const data = await this._collectProjectData(projectId);
    return exportVaultToZip(data);
  }

  async importVault(zipBlob) {
    const { importVaultFromZip } = await import('./zip-utils.js');
    const data = await importVaultFromZip(zipBlob);
    return this._importProjectData(data);
  }

  /** 收集某项目的全部数据为内存对象 */
  async _collectProjectData(projectId) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error(`项目不存在：${projectId}`);
    const chapters = await this.listChapters(projectId);
    const hooks = await this.listHooks(projectId);
    const volumes = await this.listVolumes(projectId);
    const characters = await this.listCharacters(projectId);
    const worldSettings = await this.listWorldSettings(projectId);
    return { project, chapters, hooks, volumes, characters, worldSettings };
  }

  /** 把内存数据导入为新项目（避免 id 冲突） */
  async _importProjectData(data) {
    const existing = await this.getProject(data.project.id);
    const newId = existing ? `${data.project.id}-${Date.now()}` : data.project.id;
    const project = Project.fromJSON({ ...data.project.toJSON(), id: newId });
    await this.saveProject(project);
    for (const c of data.chapters || []) await this.saveChapter(newId, c);
    for (const h of data.hooks || []) await this.saveHook(newId, h);
    for (const v of data.volumes || []) await this.saveVolume(newId, v);
    for (const c of data.characters || []) await this.saveCharacter(newId, c);
    for (const w of data.worldSettings || []) await this.saveWorldSetting(newId, w);
    return newId;
  }
}

// 仅用于消除 lint "未使用 NotSupportedError" 警告：保留以表明本文件继承自 IStorageBackend
export { NotSupportedError };
