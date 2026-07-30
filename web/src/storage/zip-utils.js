// ZIP 导入导出工具
// 极简内联 ZIP 实现（STORE 方式，不压缩）：
//   - 不依赖任何第三方库
//   - 用 TextEncoder/TextDecoder 处理 UTF-8
//   - 目录结构 1:1 镜像 NovelForge_Vault 规范
//
// ZIP 文件格式参考：PKWARE APPNOTE 6.3.10
// 仅实现 STORE（method=0）+ UTF-8 文件名（flag bit 11）。

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
  outlinePath,
  volOutlinePath,
  hooksPath,
  characterPath,
  worldSettingPath,
  normalizeVol,
  normalizeCh,
} from '../core/vault-schema.js';
import { Project, Volume, Chapter, Hook, Character, WorldSetting } from '../core/models.js';

// ---------- CRC32 ----------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------- 小端序写入工具 ----------

function u16(n) {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

function u32(n) {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function concatBytes(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ---------- DOS 时间戳 ----------

/** 把 Date 转为 DOS 时间（HH:MM:SS）+ DOS 日期（YYYY-MM-DD）组合 */
function dosTime(date) {
  const d = date instanceof Date ? date : new Date();
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const day = ((d.getFullYear() - 1980) & 0x7f) << 9 | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date: day };
}

// ---------- TextEncoder / TextDecoder 单例 ----------

const _encoder = new TextEncoder();
const _decoder = new TextDecoder('utf-8');

function utf8Encode(str) {
  return _encoder.encode(String(str));
}

function utf8Decode(bytes) {
  return _decoder.decode(bytes);
}

// ---------- ZIP 写入 ----------

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_UTF8 = 0x0800; // bit 11：文件名/注释用 UTF-8
const METHOD_STORE = 0;

/**
 * 构建 ZIP 字节序列。
 * @param {Array<{path: string, data: Uint8Array}>} files
 * @returns {Uint8Array}
 */
export function buildZip(files) {
  const localParts = [];
  const centralRecords = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());

  for (const file of files) {
    const nameBytes = utf8Encode(file.path);
    const data = file.data;
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const local = concatBytes(
      u32(SIG_LOCAL),
      u16(20), // version needed
      u16(FLAG_UTF8),
      u16(METHOD_STORE),
      u16(time),
      u16(date),
      u32(crc),
      u32(size), // compressed size
      u32(size), // uncompressed size
      u16(nameBytes.length),
      u16(0), // extra field length
      nameBytes,
      data
    );
    localParts.push(local);

    // Central directory record
    const central = concatBytes(
      u32(SIG_CENTRAL),
      u16(0x0314), // version made by (Unix + 20)
      u16(20), // version needed
      u16(FLAG_UTF8),
      u16(METHOD_STORE),
      u16(time),
      u16(date),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra field length
      u16(0), // comment length
      u16(0), // disk number start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset), // local header offset
      nameBytes
    );
    centralRecords.push(central);

    offset += local.length;
  }

  const centralBytes = concatBytes(...centralRecords);
  const end = concatBytes(
    u32(SIG_END),
    u16(0), // disk number
    u16(0), // disk with central dir
    u16(files.length), // entries on this disk
    u16(files.length), // total entries
    u32(centralBytes.length),
    u32(offset), // central dir offset
    u16(0) // comment length
  );

  return concatBytes(...localParts, centralBytes, end);
}

// ---------- ZIP 读取 ----------

/**
 * 解析 ZIP 字节序列，返回 [{path, data}]。
 * 仅支持 STORE（method=0），其它 method 跳过并抛错。
 * @param {Uint8Array} bytes
 * @returns {Array<{path: string, data: Uint8Array}>}
 */
export function parseZip(bytes) {
  // 找到 End of Central Directory（从尾部往前找）
  let eocdOff = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocdOff = i;
      break;
    }
  }
  if (eocdOff < 0) throw new Error('ZIP 解析失败：找不到 EOCD');

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalEntries = dv.getUint16(eocdOff + 10, true);
  const centralSize = dv.getUint32(eocdOff + 12, true);
  const centralOff = dv.getUint32(eocdOff + 16, true);

  const files = [];
  let p = centralOff;
  for (let i = 0; i < totalEntries; i++) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) throw new Error(`ZIP 解析失败：central record ${i} 签名错误`);
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const path = utf8Decode(nameBytes);

    if (method !== METHOD_STORE) {
      throw new Error(`ZIP 解析失败：仅支持 STORE 方式，但 ${path} 使用 method=${method}`);
    }

    // 跳到 local header 读 data
    const localNameLen = dv.getUint16(localOff + 26, true);
    const localExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + uncompressedSize);
    if (data.length !== uncompressedSize) {
      throw new Error(`ZIP 解析失败：${path} 数据长度不匹配`);
    }
    files.push({ path, data, compressedSize, uncompressedSize });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

// ---------- Vault 数据 ↔ ZIP ----------

const MANIFEST_PATH = 'manifest.json';
const EXPORT_VERSION = '1.0.0';

/**
 * 把 {project, chapters, hooks, volumes, characters, worldSettings} 打包为 ZIP Blob。
 * 目录结构 1:1 镜像 NovelForge_Vault 规范。
 */
export function exportVaultToZip(data) {
  const files = [];
  const manifest = {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    project_id: data.project?.id,
    files: [],
  };

  // 1. 项目元数据 → 00_控制面/project.json
  if (data.project) {
    const path = '00_控制面/project.json';
    const content = JSON.stringify(data.project.toJSON(), null, 2);
    files.push({ path, data: utf8Encode(content) });
    manifest.files.push({ path, type: 'project' });
  }

  // 2. 卷元数据 → 04_大纲与脉络/vol_NN/vol_meta.json
  for (const v of data.volumes || []) {
    const path = `04_大纲与脉络/vol_${normalizeVol(v.vol_no)}/vol_meta.json`;
    const content = JSON.stringify(v.toJSON(), null, 2);
    files.push({ path, data: utf8Encode(content) });
    manifest.files.push({ path, type: 'volume' });
  }

  // 3. 章节 → 05_正文/{drafts|published}/vol_NN/ch_NNN.md
  for (const c of data.chapters || []) {
    const path = chapterPath(c.vol_no, c.ch_no, c.status);
    const content = chapterToMarkdown(c, data.project);
    files.push({ path, data: utf8Encode(content) });
    manifest.files.push({ path, type: 'chapter', status: c.status });
  }

  // 4. 伏笔 → 04_大纲与脉络/hooks_registry.json
  if (data.hooks && data.hooks.length > 0) {
    const path = hooksPath();
    const registry = hookToRegistryJSON(data.hooks);
    const content = registryToJSONString(registry);
    files.push({ path, data: utf8Encode(content) });
    manifest.files.push({ path, type: 'hooks' });
  }

  // 5. 角色 → 02_角色/{name}.md
  for (const c of data.characters || []) {
    const path = characterPath(c.name);
    files.push({ path, data: utf8Encode(buildCharacterMarkdown(c)) });
    manifest.files.push({ path, type: 'character' });
  }

  // 6. 世界设定 → 01_世界观/{category}.md
  for (const w of data.worldSettings || []) {
    const path = worldSettingPath(w.category);
    files.push({ path, data: utf8Encode(buildWorldSettingMarkdown(w)) });
    manifest.files.push({ path, type: 'world_setting' });
  }

  // manifest.json 放最后
  files.push({ path: MANIFEST_PATH, data: utf8Encode(JSON.stringify(manifest, null, 2)) });

  const zipBytes = buildZip(files);
  return new Blob([zipBytes], { type: 'application/zip' });
}

/**
 * 从 ZIP Blob 解出 {project, chapters, hooks, volumes, characters, worldSettings}。
 */
export async function importVaultFromZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const files = parseZip(bytes);
  const fileMap = new Map();
  for (const f of files) fileMap.set(f.path, f);

  // 读 manifest
  const manifestFile = fileMap.get(MANIFEST_PATH);
  if (!manifestFile) throw new Error('ZIP 中缺少 manifest.json');
  const manifest = JSON.parse(utf8Decode(manifestFile.data));

  let project = null;
  const chapters = [];
  const hooks = [];
  const volumes = [];
  const characters = [];
  const worldSettings = [];

  for (const entry of manifest.files || []) {
    const f = fileMap.get(entry.path);
    if (!f) continue;
    const text = utf8Decode(f.data);
    switch (entry.type) {
      case 'project':
        project = Project.fromJSON(JSON.parse(text));
        break;
      case 'volume':
        volumes.push(Volume.fromJSON(JSON.parse(text)));
        break;
      case 'chapter':
        chapters.push(chapterFromMarkdown(text));
        break;
      case 'hooks': {
        const registry = JSON.parse(text);
        const list = hookFromRegistryJSON(registry);
        for (const h of list) hooks.push(h);
        break;
      }
      case 'character':
        characters.push(parseCharacterMarkdown(text));
        break;
      case 'world_setting':
        worldSettings.push(parseWorldSettingMarkdown(text));
        break;
    }
  }

  if (!project) {
    // 兜底：若 manifest 没有标记 project，但 00_控制面/project.json 存在，则读它
    const fallback = fileMap.get('00_控制面/project.json');
    if (fallback) project = Project.fromJSON(JSON.parse(utf8Decode(fallback.data)));
  }

  return { project, chapters, hooks, volumes, characters, worldSettings };
}

// 角色 / 世界设定 Markdown 序列化函数已迁移至 core/markdown.js：
//   buildCharacterMarkdown / parseCharacterMarkdown
//   buildWorldSettingMarkdown / parseWorldSettingMarkdown
// 本文件从 core/markdown.js 直接 import 使用。
