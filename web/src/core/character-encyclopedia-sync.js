// Character ↔ EncyclopediaEntry 双向同步工具
// 解决「在角色人设新增了角色，在设定百科看不到」的问题
//
// 设计约束：
//   - Character 使用 [project_id, name] 作为键；
//   - EncyclopediaEntry 使用 [project_id, id] 作为键，type=character 时为角色词条；
//   - 约定：encyclopedia.id 对 character 词条使用稳定 id "char_" + name（作为双向关联锚点），
//     这样 name 变更时我们知道要删旧词条；
//   - 本文件不做任何数据持久化，纯粹提供对象转换 + 集合级同步辅助函数。

import { Character } from './models.js';
import { EncyclopediaEntry } from './models.js';

/** Character 名字 → EncyclopediaEntry.id 的稳定映射（用于双向关联锚点） */
export function characterEncyclopediaId(name) {
  const safe = String(name || '').replace(/\s+/g, '_');
  return `char_${safe}`;
}

/** Character → EncyclopediaEntry（type=character） */
export function characterToEncyclopediaEntry(character, options = {}) {
  const c = character instanceof Character ? character : new Character(character);
  const now = new Date().toISOString();
  const id = options.id || characterEncyclopediaId(c.name);

  // Markdown 形式的 content：完整角色档案，方便百科查阅
  const lines = [];
  if (c.role) lines.push(`**定位**：${c.role}`);
  if (c.identity) lines.push(`**身份**：${c.identity}`);
  if (c.level) lines.push(`**境界/等级**：${c.level}`);
  if (c.personality) lines.push(`**性格**：${c.personality}`);
  if (c.arc) lines.push(`**人物弧光**：${c.arc}`);
  if (c.relation) lines.push(`**关系**：${c.relation}`);
  if (c.goal) lines.push(`**目标**：${c.goal}`);

  // summary：取最关键的 1-2 行做简介
  const summaryParts = [];
  if (c.role) summaryParts.push(c.role);
  if (c.identity) summaryParts.push(c.identity);
  const summary = summaryParts.join(' · ') || (c.name ? `${c.name} 角色档案` : '');

  // tags：从 role / identity 中抽关键词
  const tags = [];
  if (c.role) tags.push(c.role);
  if (c.level) tags.push(c.level);

  return new EncyclopediaEntry({
    id,
    name: c.name,
    type: 'character',
    summary,
    content: lines.join('\n\n'),
    tags,
    aliases: [],
    related_entries: [],
    first_appear_ch: '',
    image: '',
    sort_order: 0,
    created_at: options.created_at || now,
    updated_at: now,
  });
}

/**
 * EncyclopediaEntry（type=character） → Character（反向转换，用于：在设定百科里改了角色词条，同步回人设）
 * 注意：EncyclopediaEntry 的 Markdown content 字段不如 Character 结构化，反向转换是「尽力而为」——
 *       取 name、从 summary/tags 里回填 role / level，content 原样当作备注丢到 personality 里（避免丢信息）。
 */
export function encyclopediaEntryToCharacter(entry) {
  const e = entry instanceof EncyclopediaEntry ? entry : new EncyclopediaEntry(entry);
  const role = (e.tags || []).find(t => t && /主角|配角|反派|女主|男主|路人|金手指|挚友|朋友|师傅|徒弟|导师|家人|父亲|母亲|兄弟|姐妹|情人|敌对|宿敌/.test(t))
    || e.summary?.split(/[·|｜]/)[0]?.trim()
    || '';
  const level = (e.tags || []).find(t => t && /期|境|阶|段|级|品/.test(t)) || '';

  // 从 summary 里拆：如果包含「定位」「身份」前缀，剥离前缀拿后面
  let identity = '';
  const parts = (e.summary || '').split(/[·|｜]/);
  if (parts.length >= 2) identity = parts.slice(1).join('·').trim();

  return new Character({
    name: e.name,
    role,
    identity,
    level,
    personality: e.content || '',
    arc: '',
    relation: '',
    goal: '',
    color: '',
  });
}
