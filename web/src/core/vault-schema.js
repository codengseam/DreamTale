// NovelForge Vault 目录与路径规范
// 1:1 对齐 NovelForge_Vault 目录结构。
// 路径统一使用 POSIX 风格（/），跨平台用 pathNormalize 规整。

import { padVol, padCh } from './models.js';

// ---------- 目录常量 ----------

/** NovelForge Vault 顶层目录 */
export const VAULT_DIRS = Object.freeze({
  CONTROL: '00_控制面',
  WORLD: '01_世界观',
  CHARACTERS: '02_角色',
  MATERIALS: '03_素材库',
  OUTLINE: '04_大纲与脉络',
  TEXT: '05_正文',
  SHORTFORM: '06_短文',
  AUDIT: '06_审计',
  RECAPS: '_recaps',
  SCENES: '_scenes',
  STATE: '.state',
});

/** 章节状态对应的子目录名 */
export const CHAPTER_STATUS_DIR = Object.freeze({
  draft: 'drafts',
  published: 'published',
});

// ---------- 工具：把 vol_no / ch_no 规整为字符串 ----------

/** 把 vol_no（数字或字符串）规整为 2 位补零字符串 */
export function normalizeVol(vol_no) {
  if (typeof vol_no === 'number') return padVol(vol_no);
  const s = String(vol_no ?? '');
  // 兼容 "vol_01" / "01" / "1"
  const m = s.match(/^vol_(\d+)$/i);
  if (m) return padVol(Number(m[1]));
  if (/^\d+$/.test(s)) return padVol(Number(s));
  // 无法解析时原样返回
  return s;
}

/** 把 ch_no（数字或字符串）规整为 3 位补零字符串 */
export function normalizeCh(ch_no) {
  if (typeof ch_no === 'number') return padCh(ch_no);
  const s = String(ch_no ?? '');
  const m = s.match(/^ch_(\d+)$/i);
  if (m) return padCh(Number(m[1]));
  if (/^\d+$/.test(s)) return padCh(Number(s));
  return s;
}

/** 拼接路径段（仅用 /，避免 Windows \\） */
export function joinPath(...parts) {
  return parts
    .map((p) => String(p).replace(/\\/g, '/'))
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

// ---------- 路径生成函数 ----------

/**
 * 章节正文路径：
 *   status=draft     → 05_正文/drafts/vol_NN/ch_NNN.md
 *   status=published → 05_正文/published/vol_NN/ch_NNN.md
 */
export function chapterPath(vol_no, ch_no, status = 'draft') {
  const v = normalizeVol(vol_no);
  const c = normalizeCh(ch_no);
  const sub = CHAPTER_STATUS_DIR[status] || 'drafts';
  return joinPath(VAULT_DIRS.TEXT, sub, `vol_${v}`, `ch_${c}.md`);
}

/** 章纲路径：04_大纲与脉络/vol_NN/ch_NNN_outline.md */
export function outlinePath(vol_no, ch_no) {
  const v = normalizeVol(vol_no);
  const c = normalizeCh(ch_no);
  return joinPath(VAULT_DIRS.OUTLINE, `vol_${v}`, `ch_${c}_outline.md`);
}

/** 卷大纲路径：04_大纲与脉络/vol_NN/vol_outline.md */
export function volOutlinePath(vol_no) {
  const v = normalizeVol(vol_no);
  return joinPath(VAULT_DIRS.OUTLINE, `vol_${v}`, 'vol_outline.md');
}

/** 伏笔注册表路径：04_大纲与脉络/hooks_registry.json */
export function hooksPath() {
  return joinPath(VAULT_DIRS.OUTLINE, 'hooks_registry.json');
}

/** 角色路径：02_角色/{name}.md */
export function characterPath(name) {
  return joinPath(VAULT_DIRS.CHARACTERS, `${name}.md`);
}

/** 世界设定路径：01_世界观/{category}.md */
export function worldSettingPath(category) {
  return joinPath(VAULT_DIRS.WORLD, `${category}.md`);
}

/** 状态机路径：.state/{subpath} */
export function statePath(subpath) {
  return joinPath(VAULT_DIRS.STATE, subpath);
}

/** 角色状态机路径：.state/characters/{character_id}.json */
export function characterStatePath(characterId) {
  return joinPath(VAULT_DIRS.STATE, 'characters', `${characterId}.json`);
}

/** 关键场景路径：_scenes/ch_NNN_角色_关键词.md */
export function scenePath(ch_no, character, keyword) {
  const c = normalizeCh(ch_no);
  return joinPath(VAULT_DIRS.SCENES, `ch_${c}_${character}_${keyword}.md`);
}

/** 前情提要路径：_recaps/recap_ch_NNN.md */
export function recapPath(ch_no) {
  const c = normalizeCh(ch_no);
  return joinPath(VAULT_DIRS.RECAPS, `recap_ch_${c}.md`);
}

/** 短文路径：06_短文/{drafts|published}/YYYY-MM-DD-slug.md */
export function shortformPath(slug, status = 'draft', date = '') {
  const sub = CHAPTER_STATUS_DIR[status] || 'drafts';
  const prefix = date ? `${date}-` : '';
  return joinPath(VAULT_DIRS.SHORTFORM, sub, `${prefix}${slug}.md`);
}

// ---------- 校验函数 ----------

/** 校验 vol_no 是否合法（1-99） */
export function isValidVolNo(vol_no) {
  const v = typeof vol_no === 'number' ? vol_no : parseInt(String(vol_no), 10);
  return Number.isInteger(v) && v >= 1 && v <= 99;
}

/** 校验 ch_no 是否合法（1-9999） */
export function isValidChNo(ch_no) {
  const c = typeof ch_no === 'number' ? ch_no : parseInt(String(ch_no), 10);
  return Number.isInteger(c) && c >= 1 && c <= 9999;
}

/** 校验 chapter status 是否合法 */
export function isValidChapterStatus(status) {
  return Object.prototype.hasOwnProperty.call(CHAPTER_STATUS_DIR, status);
}

/** 校验路径是否在 Vault 内（不以 .. 或绝对路径开头） */
export function isSafeVaultPath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.startsWith('/')) return false;
  if (p.startsWith('\\')) return false;
  // 包含 .. 段（精确匹配，避免误判 "ab..cd"）
  const segments = p.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) return false;
  return true;
}
