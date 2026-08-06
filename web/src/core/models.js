// DreamTale Core 层数据模型
// 纯 JS class + 静态工厂方法，零 DOM 依赖。
// 数据格式 1:1 对齐 NovelForge_Vault 目录规范。

// ---------- 工具：补零 ----------

/** 把数字补零为 2 位字符串（卷号）：1 → "01" */
export function padVol(n) {
  return String(n).padStart(2, '0');
}

/** 把数字补零为 3 位字符串（章号）：1 → "001" */
export function padCh(n) {
  return String(n).padStart(3, '0');
}

// ---------- Project ----------

/** 项目（一本书） */
export class Project {
  constructor({
    id,
    name,
    subtitle = '',
    genre = '',
    author = '',
    target_words = 0,
    current_words = 0,
    volumes_done = 0,
    volumes_total = 0,
    chapters_done = 0,
    chapters_total = 0,
    status = 'draft',
    updated = '',
    created_at = '',
  } = {}) {
    this.id = id;
    this.name = name;
    this.subtitle = subtitle;
    this.genre = genre;
    this.author = author;
    this.target_words = target_words;
    this.current_words = current_words;
    this.volumes_done = volumes_done;
    this.volumes_total = volumes_total;
    this.chapters_done = chapters_done;
    this.chapters_total = chapters_total;
    this.status = status;
    this.updated = updated;
    this.created_at = created_at;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      subtitle: this.subtitle,
      genre: this.genre,
      author: this.author,
      target_words: this.target_words,
      current_words: this.current_words,
      volumes_done: this.volumes_done,
      volumes_total: this.volumes_total,
      chapters_done: this.chapters_done,
      chapters_total: this.chapters_total,
      status: this.status,
      updated: this.updated,
      created_at: this.created_at,
    };
  }

  static fromJSON(json = {}) {
    return new Project(json);
  }
}

// ---------- Volume ----------

/** 卷 */
export class Volume {
  constructor({
    vol_no,
    vol_name = '',
    vol_goal = '',
    sort_order = 0,
  } = {}) {
    // vol_no 兼容数字与字符串：1 或 "01" 都规范化为 "01"
    this.vol_no = typeof vol_no === 'number' ? padVol(vol_no) : padVol(Number(vol_no) || 0);
    this.vol_name = vol_name;
    this.vol_goal = vol_goal;
    this.sort_order = sort_order;
  }

  toJSON() {
    return {
      vol_no: this.vol_no,
      vol_name: this.vol_name,
      vol_goal: this.vol_goal,
      sort_order: this.sort_order,
    };
  }

  static fromJSON(json = {}) {
    return new Volume(json);
  }
}

// ---------- Chapter ----------

/** 章节（正文） */
export class Chapter {
  constructor({
    vol_no,
    ch_no,
    title = '',
    content = '',
    summary = '',
    highlights = [],
    words = 0,
    status = 'draft',
    updated_at = '',
  } = {}) {
    // vol_no 规范化为 2 位字符串
    this.vol_no = typeof vol_no === 'number' ? padVol(vol_no) : padVol(Number(vol_no) || 0);
    // ch_no 规范化为 3 位字符串
    this.ch_no =
      typeof ch_no === 'number'
        ? padCh(ch_no)
        : /^\d+$/.test(String(ch_no))
          ? padCh(Number(ch_no))
          : String(ch_no);
    this.title = title;
    this.content = content;
    this.summary = summary;
    this.highlights = Array.isArray(highlights) ? highlights : [];
    // words 自动按 content 长度计算（仅当未显式传入时）
    this.words = words > 0 ? words : (content ? content.length : 0);
    this.status = status;
    this.updated_at = updated_at;
  }

  toJSON() {
    return {
      vol_no: this.vol_no,
      ch_no: this.ch_no,
      title: this.title,
      content: this.content,
      summary: this.summary,
      highlights: this.highlights,
      words: this.words,
      status: this.status,
      updated_at: this.updated_at,
    };
  }

  static fromJSON(json = {}) {
    return new Chapter(json);
  }
}

// ---------- Hook（伏笔） ----------

/** 伏笔状态枚举 */
export const HOOK_STATUS = ['planted', 'hinted', 'resolved', 'abandoned'];

/** 伏笔 scope 枚举 */
export const HOOK_SCOPE = ['short', 'long', 'core'];

/** 伏笔 payoff_type 枚举 */
export const HOOK_PAYOFF = ['reveal', 'twist', 'powerup', 'emotional', 'callback'];

/** 伏笔 priority 枚举 */
export const HOOK_PRIORITY = ['high', 'medium', 'low'];

/** 伏笔 strength 枚举 */
export const HOOK_STRENGTH = ['strong', 'medium', 'weak'];

/** 伏笔 emotional_valence 枚举 */
export const HOOK_VALENCE = ['positive', 'negative', 'bittersweet'];

/** 伏笔：对齐 hooks_registry.json schema */
export class Hook {
  constructor({
    hook_id,
    description = '',
    status = 'planted',
    planted_ch = 0,
    target_resolve_ch = 0,
    scope = 'short',
    payoff_type = 'reveal',
    priority = 'medium',
    strength = 'medium',
    expected_resolve_vol = 0,
    related_characters = [],
    emotional_valence = 'neutral',
    dependencies = [],
    resolution_note = '',
    // 运行时维护字段（可选，对齐 hooks_registry.json）
    reminder_chapters = [],
    last_reminder_ch = null,
    next_reminder_due_ch = null,
  } = {}) {
    this.hook_id = hook_id;
    this.description = description;
    this.status = status;
    this.planted_ch = planted_ch;
    this.target_resolve_ch = target_resolve_ch;
    this.scope = scope;
    this.payoff_type = payoff_type;
    this.priority = priority;
    this.strength = strength;
    this.expected_resolve_vol = expected_resolve_vol;
    this.related_characters = Array.isArray(related_characters) ? related_characters : [];
    this.emotional_valence = emotional_valence;
    this.dependencies = Array.isArray(dependencies) ? dependencies : [];
    this.resolution_note = resolution_note;
    this.reminder_chapters = Array.isArray(reminder_chapters) ? reminder_chapters : [];
    this.last_reminder_ch = last_reminder_ch;
    this.next_reminder_due_ch = next_reminder_due_ch;
  }

  toJSON() {
    return {
      hook_id: this.hook_id,
      description: this.description,
      status: this.status,
      planted_ch: this.planted_ch,
      target_resolve_ch: this.target_resolve_ch,
      scope: this.scope,
      payoff_type: this.payoff_type,
      priority: this.priority,
      strength: this.strength,
      expected_resolve_vol: this.expected_resolve_vol,
      related_characters: this.related_characters,
      emotional_valence: this.emotional_valence,
      dependencies: this.dependencies,
      resolution_note: this.resolution_note,
      reminder_chapters: this.reminder_chapters,
      last_reminder_ch: this.last_reminder_ch,
      next_reminder_due_ch: this.next_reminder_due_ch,
    };
  }

  static fromJSON(json = {}) {
    return new Hook(json);
  }
}

// ---------- Character ----------

/** 角色（对齐 02_角色/*.md 与 .state/characters/*.json 的核心字段） */
export class Character {
  constructor({
    name,
    role = '',
    identity = '',
    level = '',
    personality = '',
    arc = '',
    relation = '',
    goal = '',
    color = '',
  } = {}) {
    this.name = name;
    this.role = role;
    this.identity = identity;
    this.level = level;
    this.personality = personality;
    this.arc = arc;
    this.relation = relation;
    this.goal = goal;
    this.color = color;
  }

  toJSON() {
    return {
      name: this.name,
      role: this.role,
      identity: this.identity,
      level: this.level,
      personality: this.personality,
      arc: this.arc,
      relation: this.relation,
      goal: this.goal,
      color: this.color,
    };
  }

  static fromJSON(json = {}) {
    return new Character(json);
  }
}

// ---------- WorldSetting ----------

/** 世界设定（对齐 01_世界观/{category}.md） */
export class WorldSetting {
  constructor({
    category,
    content = '',
    sort_order = 0,
  } = {}) {
    this.category = category;
    this.content = content;
    this.sort_order = sort_order;
  }

  toJSON() {
    return {
      category: this.category,
      content: this.content,
      sort_order: this.sort_order,
    };
  }

  static fromJSON(json = {}) {
    return new WorldSetting(json);
  }
}

// ---------- Outline（章纲十段） ----------

/**
 * 章纲对象（对齐 04_大纲与脉络/vol_NN/ch_NNN_outline.md 的十段模板）
 * 这是 markdown.outlineToMarkdown / outlineFromMarkdown 的运行时载体。
 */
export class Outline {
  constructor({
    vol_no,
    ch_no,
    title = '',
    chapter_type = '',
    word_target = 0,
    pov = '',
    scenes = [],
    core_conflict = '',
    characters = [],
    hook_planted = [],
    hook_resolved = [],
    chapter_hook = { type: '', content: '' },
    must_keep = [],
    must_avoid = [],
    pacing = { climax: 0, depression: 0, golden_quote: '' },
    context_recall = [],
    revision_history = [],
  } = {}) {
    this.vol_no = typeof vol_no === 'number' ? padVol(vol_no) : padVol(Number(vol_no) || 0);
    this.ch_no =
      typeof ch_no === 'number'
        ? padCh(ch_no)
        : /^\d+$/.test(String(ch_no))
          ? padCh(Number(ch_no))
          : String(ch_no);
    this.title = title;
    this.chapter_type = chapter_type;
    this.word_target = word_target;
    this.pov = pov;
    this.scenes = Array.isArray(scenes) ? scenes : [];
    this.core_conflict = core_conflict;
    this.characters = Array.isArray(characters) ? characters : [];
    this.hook_planted = Array.isArray(hook_planted) ? hook_planted : [];
    this.hook_resolved = Array.isArray(hook_resolved) ? hook_resolved : [];
    this.chapter_hook = chapter_hook || { type: '', content: '' };
    this.must_keep = Array.isArray(must_keep) ? must_keep : [];
    this.must_avoid = Array.isArray(must_avoid) ? must_avoid : [];
    this.pacing = pacing || { climax: 0, depression: 0, golden_quote: '' };
    this.context_recall = Array.isArray(context_recall) ? context_recall : [];
    this.revision_history = Array.isArray(revision_history) ? revision_history : [];
  }

  toJSON() {
    return {
      vol_no: this.vol_no,
      ch_no: this.ch_no,
      title: this.title,
      chapter_type: this.chapter_type,
      word_target: this.word_target,
      pov: this.pov,
      scenes: this.scenes,
      core_conflict: this.core_conflict,
      characters: this.characters,
      hook_planted: this.hook_planted,
      hook_resolved: this.hook_resolved,
      chapter_hook: this.chapter_hook,
      must_keep: this.must_keep,
      must_avoid: this.must_avoid,
      pacing: this.pacing,
      context_recall: this.context_recall,
      revision_history: this.revision_history,
    };
  }

  static fromJSON(json = {}) {
    return new Outline(json);
  }
}

// ---------- Encyclopedia（设定百科）----------

/** 设定百科词条类型枚举（对齐番茄/起点分类逻辑） */
export const ENCYCLOPEDIA_TYPES = [
  { key: 'character', label: '角色', icon: '👤', color: '#e74c3c' },
  { key: 'place',     label: '地点', icon: '📍', color: '#3498db' },
  { key: 'skill',     label: '功法', icon: '⚔️', color: '#2ecc71' },
  { key: 'faction',   label: '势力', icon: '🏛️', color: '#9b59b6' },
  { key: 'event',     label: '事件', icon: '📅', color: '#f39c12' },
  { key: 'item',      label: '物品', icon: '💎', color: '#1abc9c' },
  { key: 'concept',   label: '概念', icon: '💡', color: '#e67e22' },
  { key: 'other',     label: '其他', icon: '📁', color: '#7f8c8d' },
];

/** 通过 key 拿类型元信息（兜底 other） */
export function getEncyclopediaTypeMeta(typeKey) {
  return ENCYCLOPEDIA_TYPES.find(t => t.key === typeKey)
      || ENCYCLOPEDIA_TYPES[ENCYCLOPEDIA_TYPES.length - 1];
}

/** 设定百科词条 */
export class EncyclopediaEntry {
  constructor({
    id,
    name,
    type = 'other',
    summary = '',
    content = '',
    tags = [],
    aliases = [],
    related_entries = [],
    first_appear_ch = '',
    image = '',
    sort_order = 0,
    created_at = '',
    updated_at = '',
  } = {}) {
    this.id = id || ('ency_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    this.name = name;
    // 校验 type 是否在合法枚举内，兜底 other
    this.type = ENCYCLOPEDIA_TYPES.some(t => t.key === type) ? type : 'other';
    this.summary = summary;
    this.content = content;
    this.tags = Array.isArray(tags) ? tags : [];
    this.aliases = Array.isArray(aliases) ? aliases : [];
    this.related_entries = Array.isArray(related_entries) ? related_entries : [];
    this.first_appear_ch = first_appear_ch;
    this.image = image;
    this.sort_order = Number(sort_order) || 0;
    this.created_at = created_at || new Date().toISOString();
    this.updated_at = updated_at || new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      summary: this.summary,
      content: this.content,
      tags: this.tags,
      aliases: this.aliases,
      related_entries: this.related_entries,
      first_appear_ch: this.first_appear_ch,
      image: this.image,
      sort_order: this.sort_order,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }

  static fromJSON(json = {}) {
    return new EncyclopediaEntry(json);
  }
}

/** 设定百科标签（运行时聚合视图，不单独存表；从所有 entry.tags 聚合 count） */
export class EncyclopediaTag {
  constructor({ name, color = '', count = 0 } = {}) {
    this.name = name;
    this.color = color;
    this.count = Number(count) || 0;
  }
}
