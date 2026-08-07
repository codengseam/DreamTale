// IndexedDB 存储后端
// 纯原生 IndexedDB API，无第三方库。
// 数据库：dreamtale
// object stores: projects, chapters, hooks, volumes, characters, world_settings, encyclopedia, meta
// chapters 用 [project_id, vol_no, ch_no] 作为复合 key（keyPath）
// 所有非 projects store 都建 project_id 单字段索引，便于按项目查询与级联删除。

import { IStorageBackend, NotSupportedError } from './interface.js';
import { Project, Volume, Chapter, Hook, Character, WorldSetting, EncyclopediaEntry } from '../core/models.js';
import { normalizeVol, normalizeCh } from '../core/vault-schema.js';
import {
  characterToEncyclopediaEntry,
  encyclopediaEntryToCharacter,
  characterEncyclopediaId,
} from '../core/character-encyclopedia-sync.js';

const DB_NAME = 'dreamtale';
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_CHAPTERS = 'chapters';
const STORE_HOOKS = 'hooks';
const STORE_VOLUMES = 'volumes';
const STORE_CHARACTERS = 'characters';
const STORE_WORLD_SETTINGS = 'world_settings';
const STORE_ENCYCLOPEDIA = 'encyclopedia';
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
  STORE_ENCYCLOPEDIA,
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
      // encyclopedia store: 复合 key [project_id, id]，并建 type 索引加速分类筛选
      if (!db.objectStoreNames.contains(STORE_ENCYCLOPEDIA)) {
        const store = db.createObjectStore(STORE_ENCYCLOPEDIA, {
          keyPath: ['project_id', 'id'],
        });
        store.createIndex('project_id', 'project_id', { unique: false });
        store.createIndex('type', ['project_id', 'type'], { unique: false });
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
    // 过滤软删除（_deleted=true）
    return rows
      .filter(r => !r._deleted)
      .map((r) => Character.fromJSON(r));
  }

  async saveCharacter(projectId, character) {
    const db = await this._db();
    const c = character instanceof Character ? character : new Character(character);
    const rawCharacter = character && typeof character === 'object' ? character : {};
    const isSoftDeleted = Boolean(rawCharacter._deleted);
    const data = { ...c.toJSON(), project_id: projectId };
    if (isSoftDeleted) data._deleted = true;
    await reqToPromise(tx(db, STORE_CHARACTERS, 'readwrite').put(data));

    // 同步到设定百科（软删除就删百科词条，否则 upsert）
    const encyId = characterEncyclopediaId(c.name);
    if (isSoftDeleted) {
      try {
        await reqToPromise(
          tx(db, STORE_ENCYCLOPEDIA, 'readwrite').delete([projectId, encyId])
        );
      } catch (_) { /* 可能百科不存在，忽略 */ }
    } else {
      // 保留百科原 created_at，避免每次更新角色都重置创建时间
      const existing = await reqToPromise(
        tx(db, STORE_ENCYCLOPEDIA, 'readonly').get([projectId, encyId])
      ).catch(() => null);
      const entry = characterToEncyclopediaEntry(c, {
        id: encyId,
        created_at: existing?.created_at || undefined,
      });
      const encyData = { ...entry.toJSON(), project_id: projectId };
      await reqToPromise(tx(db, STORE_ENCYCLOPEDIA, 'readwrite').put(encyData));
    }
  }

  /** 批量保存角色（单事务原子写入）+ 批量同步到百科 */
  async saveCharacters(projectId, characters) {
    if (!characters || !characters.length) return;
    const db = await this._db();

    // 预查询现有百科词条，保留 created_at（单事务只读）
    const existingMap = new Map();
    try {
      const existing = await getAllByProject(db, STORE_ENCYCLOPEDIA, projectId);
      for (const e of existing) {
        if (e.type === 'character' && e.id) existingMap.set(e.id, e);
      }
    } catch (_) { /* 忽略 */ }

    const transaction = db.transaction([STORE_CHARACTERS, STORE_ENCYCLOPEDIA], 'readwrite');
    const charStore = transaction.objectStore(STORE_CHARACTERS);
    const encyStore = transaction.objectStore(STORE_ENCYCLOPEDIA);

    for (const character of characters) {
      const c = character instanceof Character ? character : new Character(character);
      const isSoftDeleted = Boolean(character && typeof character === 'object' && character._deleted);
      const charData = { ...c.toJSON(), project_id: projectId };
      if (isSoftDeleted) charData._deleted = true;
      charStore.put(charData);

      const encyId = characterEncyclopediaId(c.name);
      if (isSoftDeleted) {
        encyStore.delete([projectId, encyId]);
      } else {
        const existing = existingMap.get(encyId);
        const entry = characterToEncyclopediaEntry(c, {
          id: encyId,
          created_at: existing?.created_at || undefined,
        });
        encyStore.put({ ...entry.toJSON(), project_id: projectId });
      }
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

  // ---------- 设定百科 Encyclopedia ----------

  async listEncyclopediaEntries(projectId, filter = {}) {
    const db = await this._db();
    let rows;
    // 有 type 过滤时用 type 索引加速
    if (filter.type) {
      rows = await new Promise((resolve, reject) => {
        const store = tx(db, STORE_ENCYCLOPEDIA, 'readonly');
        const idx = store.index('type');
        const req = idx.getAll(IDBKeyRange.only([projectId, filter.type]));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } else {
      rows = await getAllByProject(db, STORE_ENCYCLOPEDIA, projectId);
    }
    let entries = rows.map(r => EncyclopediaEntry.fromJSON(r));
    // tag 过滤（内存过滤，标签通常规模可控）
    if (filter.tags && filter.tags.length) {
      const tagSet = new Set(filter.tags);
      entries = entries.filter(e => (e.tags || []).some(t => tagSet.has(t)));
    }
    // 排序：sort_order 升序 + updated_at 降序
    entries.sort((a, b) => {
      const s = (a.sort_order || 0) - (b.sort_order || 0);
      if (s !== 0) return s;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
    return entries;
  }

  async getEncyclopediaEntry(projectId, entryId) {
    const db = await this._db();
    const result = await reqToPromise(
      tx(db, STORE_ENCYCLOPEDIA, 'readonly').get([projectId, entryId])
    );
    return result ? EncyclopediaEntry.fromJSON(result) : null;
  }

  async saveEncyclopediaEntry(projectId, entry) {
    const db = await this._db();
    const e = entry instanceof EncyclopediaEntry ? entry : new EncyclopediaEntry(entry);
    const now = new Date().toISOString();
    const data = {
      ...e.toJSON(),
      project_id: projectId,
      updated_at: now,
    };
    await reqToPromise(tx(db, STORE_ENCYCLOPEDIA, 'readwrite').put(data));

    // 反向同步：type=character 的词条，同步到 characters 表
    if (e.type === 'character' && e.name) {
      const character = encyclopediaEntryToCharacter(e);
      // 检查是否被软删除（如果对应 character 已经软删除，这里恢复它）
      const cData = { ...character.toJSON(), project_id: projectId };
      await reqToPromise(tx(db, STORE_CHARACTERS, 'readwrite').put(cData));
    }
  }

  /** 批量保存设定百科（单事务原子写入）+ type=character 反向同步 */
  async saveEncyclopediaEntries(projectId, entries) {
    if (!entries || !entries.length) return;
    const db = await this._db();
    const now = new Date().toISOString();
    const transaction = db.transaction([STORE_ENCYCLOPEDIA, STORE_CHARACTERS], 'readwrite');
    const encyStore = transaction.objectStore(STORE_ENCYCLOPEDIA);
    const charStore = transaction.objectStore(STORE_CHARACTERS);

    for (const entry of entries) {
      const e = entry instanceof EncyclopediaEntry ? entry : new EncyclopediaEntry(entry);
      encyStore.put({
        ...e.toJSON(),
        project_id: projectId,
        updated_at: now,
      });
      if (e.type === 'character' && e.name) {
        const character = encyclopediaEntryToCharacter(e);
        charStore.put({ ...character.toJSON(), project_id: projectId });
      }
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('批量保存百科词条被中止'));
    });
  }

  async deleteEncyclopediaEntry(projectId, entryId) {
    const db = await this._db();

    // 删除前先读词条，如果是 character 类型，同步软删除 characters 表对应记录
    let toDelete = null;
    try {
      toDelete = await reqToPromise(
        tx(db, STORE_ENCYCLOPEDIA, 'readonly').get([projectId, entryId])
      );
    } catch (_) { /* ignore */ }

    await reqToPromise(
      tx(db, STORE_ENCYCLOPEDIA, 'readwrite').delete([projectId, entryId])
    );

    if (toDelete && toDelete.type === 'character' && toDelete.name) {
      // 软删除对应 character：读旧数据 → 标记 _deleted=true → 写回
      try {
        const oldChar = await reqToPromise(
          tx(db, STORE_CHARACTERS, 'readonly').get([projectId, toDelete.name])
        );
        if (oldChar) {
          oldChar._deleted = true;
          oldChar.role = '已删除·' + (oldChar.role || '');
          await reqToPromise(tx(db, STORE_CHARACTERS, 'readwrite').put(oldChar));
        }
      } catch (_) { /* ignore */ }
    }
  }

  async searchEncyclopedia(projectId, query, filter = {}) {
    const q = (query || '').trim();
    if (!q) return [];
    // 先拉全部（可加 type 预过滤），再内存做权重打分 + 文本匹配
    const all = await this.listEncyclopediaEntries(projectId, { type: filter.type });
    const qLower = q.toLowerCase();
    const qWords = qLower.split(/\s+/).filter(Boolean);
    const results = [];
    for (const entry of all) {
      // tag 预过滤
      if (filter.tags && filter.tags.length) {
        const tagSet = new Set(filter.tags);
        if (!(entry.tags || []).some(t => tagSet.has(t))) continue;
      }
      let score = 0;
      const hits = [];
      // name 命中（权重最高）
      const nameLower = String(entry.name || '').toLowerCase();
      if (nameLower.includes(qLower)) {
        score += 100;
        hits.push({ field: 'name', text: entry.name });
      } else {
        for (const w of qWords) { if (nameLower.includes(w)) { score += 50; hits.push({ field: 'name', text: entry.name }); break; } }
      }
      // aliases 命中
      const aliases = entry.aliases || [];
      for (const a of aliases) {
        const al = String(a).toLowerCase();
        if (al.includes(qLower)) { score += 70; hits.push({ field: 'aliases', text: a }); break; }
        let aliasMatch = false;
        for (const w of qWords) { if (al.includes(w)) { score += 35; hits.push({ field: 'aliases', text: a }); aliasMatch = true; break; } }
        if (aliasMatch) break;
      }
      // tags 命中
      const tags = entry.tags || [];
      for (const t of tags) {
        const tl = String(t).toLowerCase();
        if (tl.includes(qLower)) { score += 50; hits.push({ field: 'tags', text: t }); break; }
        let tagMatch = false;
        for (const w of qWords) { if (tl.includes(w)) { score += 25; hits.push({ field: 'tags', text: t }); tagMatch = true; break; } }
        if (tagMatch) break;
      }
      // summary 命中
      const summaryLower = String(entry.summary || '').toLowerCase();
      if (summaryLower.includes(qLower)) {
        score += 40;
        hits.push({ field: 'summary', text: entry.summary });
      } else {
        for (const w of qWords) { if (summaryLower.includes(w)) { score += 20; hits.push({ field: 'summary', text: entry.summary }); break; } }
      }
      // content 命中（权重最低，但内容长所以命中次数多）
      const contentLower = String(entry.content || '').toLowerCase();
      let contentHitCount = 0;
      if (contentLower.includes(qLower)) contentHitCount += 3;
      for (const w of qWords) {
        const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const m = contentLower.match(re);
        if (m) contentHitCount += m.length;
      }
      if (contentHitCount > 0) {
        score += Math.min(30, contentHitCount * 5);
        hits.push({ field: 'content', text: (entry.content || '').slice(0, 120) });
      }
      if (score > 0) results.push({ entry, score, hits });
    }
    // 按分数降序
    results.sort((a, b) => b.score - a.score);
    if (filter.limit && filter.limit > 0) results.length = Math.min(results.length, filter.limit);
    return results;
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
    const encyclopedia = await this.listEncyclopediaEntries(projectId);
    return { project, chapters, hooks, volumes, characters, worldSettings, encyclopedia };
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
    for (const e of data.encyclopedia || []) await this.saveEncyclopediaEntry(newId, e);
    return newId;
  }
}

// 仅用于消除 lint "未使用 NotSupportedError" 警告：保留以表明本文件继承自 IStorageBackend
export { NotSupportedError };
