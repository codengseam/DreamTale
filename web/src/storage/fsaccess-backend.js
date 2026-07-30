// File System Access API 存储后端
// 把数据写入 NovelForge_Vault 目录结构的文件。
// 单真相源：若启用 FSAccess，IndexedDB 仅作缓存（本类不维护缓存，由调用方决定）。
//
// 兼容性：showDirectoryPicker 是 chromium 系浏览器特性。
// 降级：构造时若未注入 rootDirHandle 且 showDirectoryPicker 不存在，抛 NotSupportedError。

import { IStorageBackend, NotSupportedError } from './interface.js';
import { Project, Volume, Chapter, Hook, Character, WorldSetting } from '../core/models.js';
import { normalizeVol, normalizeCh } from '../core/vault-schema.js';
import {
  chapterToMarkdown,
  chapterFromMarkdown,
  hookToRegistryJSON,
  hookFromRegistryJSON,
  registryToJSONString,
  buildCharacterMarkdown,
  parseCharacterMarkdown,
  buildWorldSettingMarkdown,
  parseWorldSettingMarkdown,
} from '../core/markdown.js';
import {
  chapterPath,
  hooksPath,
  characterPath,
  worldSettingPath,
} from '../core/vault-schema.js';

// ---------- 检测 ----------

/** 检测当前环境是否支持 File System Access API */
export function isFSAccessAvailable() {
  return typeof globalThis !== 'undefined' && typeof globalThis.showDirectoryPicker === 'function';
}

// ---------- 工具：递归获取目录句柄 ----------

/**
 * 沿 pathSegments 递归 getDirectoryHandle。
 * @param {FileSystemDirectoryHandle} root
 * @param {string[]} segments
 * @param {object} [opts] - { create: true }
 */
export async function ensureDir(root, segments, opts = {}) {
  let cur = root;
  for (const seg of segments) {
    cur = await cur.getDirectoryHandle(seg, opts);
  }
  return cur;
}

/** 拆分路径为段数组 */
function splitPath(p) {
  return String(p).replace(/\\/g, '/').split('/').filter(Boolean);
}

/** 写入文本文件（覆盖式） */
export async function writeTextFile(dirHandle, name, text) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
  return fileHandle;
}

/** 读取文本文件（不存在返回 null） */
export async function readTextFile(dirHandle, name) {
  try {
    const fileHandle = await dirHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (e) {
    // NotFoundError
    if (e && (e.name === 'NotFoundError' || e.code === 8)) return null;
    return null;
  }
}

/** 列出目录下的所有子项（FileHandle + DirHandle） */
export async function listDir(dirHandle) {
  const items = [];
  for await (const entry of dirHandle.values()) {
    items.push(entry);
  }
  return items;
}

/** 删除目录项（文件或目录，存在才删） */
export async function removeEntry(dirHandle, name) {
  try {
    await dirHandle.removeEntry(name, { recursive: true });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- FSAccessBackend ----------

const PROJECT_FILE = 'project.json';
const CONTROL_DIR = '00_控制面';
const OUTLINE_DIR = '04_大纲与脉络';
const TEXT_DIR = '05_正文';
const CHARACTERS_DIR = '02_角色';
const WORLD_DIR = '01_世界观';

export class FSAccessBackend extends IStorageBackend {
  /**
   * @param {FileSystemDirectoryHandle} [rootDirHandle] - 注入的根目录句柄（测试用）
   */
  constructor(rootDirHandle = null) {
    super();
    if (!rootDirHandle && !isFSAccessAvailable()) {
      throw new NotSupportedError('当前环境不支持 File System Access API');
    }
    this._root = rootDirHandle;
  }

  get name() {
    return 'fsaccess';
  }

  /** 让用户选择 Vault 根目录（仅在 showDirectoryPicker 可用时可用） */
  async pickRoot() {
    if (!isFSAccessAvailable()) {
      throw new NotSupportedError('当前环境不支持 showDirectoryPicker');
    }
    this._root = await globalThis.showDirectoryPicker({ mode: 'readwrite' });
    return this._root;
  }

  /** 获取根目录（若未注入且未选过则抛错） */
  async _getRoot() {
    if (!this._root) {
      if (isFSAccessAvailable()) {
        await this.pickRoot();
      } else {
        throw new NotSupportedError('未选择 Vault 根目录，且当前环境不支持 showDirectoryPicker');
      }
    }
    return this._root;
  }

  // ---------- 项目 ----------

  async listProjects() {
    const root = await this._getRoot();
    const controlDir = await ensureDir(root, [CONTROL_DIR], { create: false }).catch(() => null);
    if (!controlDir) return [];
    // project.json 文件存在即一个项目
    const text = await readTextFile(controlDir, PROJECT_FILE);
    if (!text) return [];
    return [Project.fromJSON(JSON.parse(text))];
  }

  async getProject(_id) {
    const root = await this._getRoot();
    const controlDir = await ensureDir(root, [CONTROL_DIR], { create: false }).catch(() => null);
    if (!controlDir) return null;
    const text = await readTextFile(controlDir, PROJECT_FILE);
    return text ? Project.fromJSON(JSON.parse(text)) : null;
  }

  async saveProject(project) {
    const root = await this._getRoot();
    const controlDir = await ensureDir(root, [CONTROL_DIR], { create: true });
    const p = project instanceof Project ? project : new Project(project);
    await writeTextFile(controlDir, PROJECT_FILE, JSON.stringify(p.toJSON(), null, 2));
  }

  async deleteProject(id) {
    // FSAccess 单项目模型：删除整个项目相关目录（保留根）。
    const root = await this._getRoot();
    for (const dir of [CONTROL_DIR, OUTLINE_DIR, TEXT_DIR, CHARACTERS_DIR, WORLD_DIR]) {
      await removeEntry(root, dir);
    }
  }

  // ---------- 章节 ----------

  async listChapters(projectId) {
    const root = await this._getRoot();
    const textDir = await ensureDir(root, [TEXT_DIR], { create: false }).catch(() => null);
    if (!textDir) return [];
    const chapters = [];
    for (const sub of ['drafts', 'published']) {
      const subDir = await ensureDir(textDir, [sub], { create: false }).catch(() => null);
      if (!subDir) continue;
      const volDirs = await listDir(subDir);
      for (const volDir of volDirs) {
        if (volDir.kind !== 'directory') continue;
        const files = await listDir(volDir);
        for (const f of files) {
          if (f.kind !== 'file' || !f.name.endsWith('.md')) continue;
          const file = await f.getFile();
          const text = await file.text();
          chapters.push(chapterFromMarkdown(text));
        }
      }
    }
    return chapters;
  }

  async getChapter(projectId, vol_no, ch_no) {
    // 同时尝试 drafts 与 published
    const v = normalizeVol(vol_no);
    const c = normalizeCh(ch_no);
    for (const status of ['draft', 'published']) {
      const path = chapterPath(v, c, status);
      const text = await this._readVaultFile(path);
      if (text !== null) return chapterFromMarkdown(text);
    }
    return null;
  }

  async saveChapter(projectId, chapter) {
    const c = chapter instanceof Chapter ? chapter : new Chapter(chapter);
    const path = chapterPath(c.vol_no, c.ch_no, c.status);
    const project = await this.getProject(projectId).catch(() => null);
    const text = chapterToMarkdown(c, project);
    await this._writeVaultFile(path, text);
  }

  async deleteChapter(projectId, vol_no, ch_no) {
    const v = normalizeVol(vol_no);
    const c = normalizeCh(ch_no);
    for (const status of ['draft', 'published']) {
      const path = chapterPath(v, c, status);
      await this._deleteVaultFile(path);
    }
  }

  // ---------- 伏笔 ----------

  async listHooks(projectId) {
    const text = await this._readVaultFile(hooksPath());
    if (!text) return [];
    try {
      const registry = JSON.parse(text);
      return hookFromRegistryJSON(registry);
    } catch (e) {
      return [];
    }
  }

  async saveHook(projectId, hook) {
    // 读取现有 hooks，替换或追加
    const existing = await this.listHooks(projectId);
    const h = hook instanceof Hook ? hook : new Hook(hook);
    const idx = existing.findIndex((x) => x.hook_id === h.hook_id);
    if (idx >= 0) existing[idx] = h;
    else existing.push(h);
    const registry = hookToRegistryJSON(existing);
    await this._writeVaultFile(hooksPath(), registryToJSONString(registry));
  }

  async deleteHook(projectId, hook_id) {
    const existing = await this.listHooks(projectId);
    const filtered = existing.filter((x) => x.hook_id !== hook_id);
    if (filtered.length === existing.length) return;
    const registry = hookToRegistryJSON(filtered);
    await this._writeVaultFile(hooksPath(), registryToJSONString(registry));
  }

  // ---------- 卷 ----------

  async listVolumes(projectId) {
    const root = await this._getRoot();
    const outlineDir = await ensureDir(root, [OUTLINE_DIR], { create: false }).catch(() => null);
    if (!outlineDir) return [];
    const volumes = [];
    const entries = await listDir(outlineDir);
    for (const entry of entries) {
      if (entry.kind !== 'directory') continue;
      const text = await readTextFile(entry, 'vol_meta.json');
      if (text) {
        try {
          volumes.push(Volume.fromJSON(JSON.parse(text)));
        } catch (e) {
          // 忽略损坏的卷元数据
        }
      }
    }
    return volumes;
  }

  async saveVolume(projectId, volume) {
    const v = volume instanceof Volume ? volume : new Volume(volume);
    const volNo = normalizeVol(v.vol_no);
    const root = await this._getRoot();
    const volDir = await ensureDir(root, [OUTLINE_DIR, `vol_${volNo}`], { create: true });
    await writeTextFile(volDir, 'vol_meta.json', JSON.stringify(v.toJSON(), null, 2));
  }

  // ---------- 角色 ----------

  async listCharacters(projectId) {
    const root = await this._getRoot();
    const charDir = await ensureDir(root, [CHARACTERS_DIR], { create: false }).catch(() => null);
    if (!charDir) return [];
    const entries = await listDir(charDir);
    const characters = [];
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;
      const file = await entry.getFile();
      const text = await file.text();
      characters.push(parseCharacterMarkdown(text));
    }
    return characters;
  }

  async saveCharacter(projectId, character) {
    const c = character instanceof Character ? character : new Character(character);
    const path = characterPath(c.name);
    const text = buildCharacterMarkdown(c);
    await this._writeVaultFile(path, text);
  }

  // ---------- 世界设定 ----------

  async listWorldSettings(projectId) {
    const root = await this._getRoot();
    const worldDir = await ensureDir(root, [WORLD_DIR], { create: false }).catch(() => null);
    if (!worldDir) return [];
    const entries = await listDir(worldDir);
    const settings = [];
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;
      const file = await entry.getFile();
      const text = await file.text();
      settings.push(parseWorldSettingMarkdown(text));
    }
    return settings;
  }

  async saveWorldSetting(projectId, setting) {
    const w = setting instanceof WorldSetting ? setting : new WorldSetting(setting);
    const path = worldSettingPath(w.category);
    const text = buildWorldSettingMarkdown(w);
    await this._writeVaultFile(path, text);
  }

  // ---------- 导入导出 ----------

  async exportVault(projectId) {
    const { exportVaultToZip } = await import('./zip-utils.js');
    const project = await this.getProject(projectId);
    if (!project) throw new Error(`项目不存在：${projectId}`);
    const chapters = await this.listChapters(projectId);
    const hooks = await this.listHooks(projectId);
    const volumes = await this.listVolumes(projectId);
    const characters = await this.listCharacters(projectId);
    const worldSettings = await this.listWorldSettings(projectId);
    return exportVaultToZip({
      project,
      chapters,
      hooks,
      volumes,
      characters,
      worldSettings,
    });
  }

  async importVault(zipBlob) {
    const { importVaultFromZip } = await import('./zip-utils.js');
    const data = await importVaultFromZip(zipBlob);
    if (data.project) await this.saveProject(data.project);
    const pid = data.project?.id;
    for (const c of data.chapters || []) await this.saveChapter(pid, c);
    for (const h of data.hooks || []) await this.saveHook(pid, h);
    for (const v of data.volumes || []) await this.saveVolume(pid, v);
    for (const c of data.characters || []) await this.saveCharacter(pid, c);
    for (const w of data.worldSettings || []) await this.saveWorldSetting(pid, w);
    return pid;
  }

  // ---------- Vault 文件读写工具 ----------

  /** 按 Vault 路径写文本文件（自动创建父目录） */
  async _writeVaultFile(path, text) {
    const root = await this._getRoot();
    const segs = splitPath(path);
    const fileName = segs.pop();
    const dir = await ensureDir(root, segs, { create: true });
    await writeTextFile(dir, fileName, text);
  }

  /** 按 Vault 路径读文本文件（不存在返回 null） */
  async _readVaultFile(path) {
    const root = await this._getRoot();
    const segs = splitPath(path);
    const fileName = segs.pop();
    let dir = root;
    for (const seg of segs) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false });
      } catch (e) {
        return null;
      }
    }
    return readTextFile(dir, fileName);
  }

  /** 按 Vault 路径删除文件 */
  async _deleteVaultFile(path) {
    const root = await this._getRoot();
    const segs = splitPath(path);
    const fileName = segs.pop();
    let dir = root;
    for (const seg of segs) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false });
      } catch (e) {
        return false;
      }
    }
    return removeEntry(dir, fileName);
  }
}
