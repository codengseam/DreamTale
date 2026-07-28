// DreamTale 扩展层 · 灵感库管理
// ============================================================
// 对齐 NovelForge idea-forge 的 8 大类分类：
//   1. 灵感（idea）      2. 语音转录（voice）   3. 片段（snippet）
//   4. 人物（character）  5. 世界观（worldview） 6. 金手指（golden_finger）
//   7. 爽点（highlight）  8. 素材（material）
//
// 数据结构：
//   Inspiration = {
//     id: string,             // INS_<时间戳base36>_<随机>
//     type: string,           // INSPIRATION_TYPES 之一
//     title: string,
//     content: string,        // Markdown
//     tags: string[],
//     sourceUrl?: string,
//     relatedChapter?: string,// 形如 "vol_01/ch_001"
//     createdAt: string,      // ISO
//     updatedAt: string       // ISO
//   }
//
// 存储：独立 IndexedDB（dreamtale-ext），与核心 dreamtale 库解耦。
//   object store: inspirations (keyPath='id', 索引: type, createdAt)

/** 8 大类枚举（与 NovelForge idea-forge 对齐） */
export const INSPIRATION_TYPES = [
  'idea',           // 灵感
  'voice',          // 语音转录
  'snippet',        // 片段
  'character',      // 人物
  'worldview',      // 世界观
  'golden_finger',  // 金手指
  'highlight',      // 爽点
  'material',       // 素材
];

/** 类型中文名映射 */
export const TYPE_LABELS = {
  idea: '灵感',
  voice: '语音转录',
  snippet: '片段',
  character: '人物',
  worldview: '世界观',
  golden_finger: '金手指',
  highlight: '爽点',
  material: '素材',
};

/** 灵感库数据库名 */
const DB_NAME = 'dreamtale-ext';
const DB_VERSION = 1;
const STORE_INSPIRATIONS = 'inspirations';

// ---------- IndexedDB 工具 ----------

let _dbPromise = null;

/** 打开灵感库数据库 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_INSPIRATIONS)) {
        const store = db.createObjectStore(STORE_INSPIRATIONS, { keyPath: 'id' });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB 打开被阻塞'));
  });
}

/** 测试钩子：重置 db 单例缓存 */
export function _resetDBCache() {
  _dbPromise = null;
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE_INSPIRATIONS, mode).objectStore(STORE_INSPIRATIONS);
}

// ---------- 工具函数 ----------

/** 生成灵感 id */
function genId() {
  return 'INS_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

/** 校验类型合法性 */
function validateType(type) {
  if (!INSPIRATION_TYPES.includes(type)) {
    throw new Error('非法灵感类型：' + type + '，合法值：' + INSPIRATION_TYPES.join(', '));
  }
}

/** 规范化输入项，补全字段 */
function normalizeItem(item) {
  const now = new Date().toISOString();
  const out = {
    id: item.id || genId(),
    type: item.type || 'idea',
    title: String(item.title || '').trim(),
    content: String(item.content || ''),
    tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
    sourceUrl: item.sourceUrl || '',
    relatedChapter: item.relatedChapter || '',
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
  };
  validateType(out.type);
  return out;
}

// ---------- InspirationLibrary ----------

/**
 * 灵感库管理类
 *
 * 用法：
 *   const lib = new InspirationLibrary();
 *   const ins = await lib.addInspiration({ type: 'idea', title: '...', content: '...' });
 *   const list = await lib.listInspirations('idea');
 */
export class InspirationLibrary {
  constructor() {
    // 单例 db 句柄，懒加载
  }

  /** 获取 db 句柄（带缓存） */
  async _db() {
    if (!_dbPromise) _dbPromise = openDB();
    return _dbPromise;
  }

  /**
   * 新增灵感。
   * @param {object} item 见 normalizeItem 字段
   * @returns {Promise<Inspiration>}
   */
  async addInspiration(item) {
    if (!item || typeof item !== 'object') {
      throw new Error('addInspiration: item 必须为对象');
    }
    const data = normalizeItem(item);
    const db = await this._db();
    await reqToPromise(tx(db, 'readwrite').put(data));
    return data;
  }

  /**
   * 列出灵感（可按类型/标签筛选）。
   * @param {string} [type] 类型筛选（缺省=全部）
   * @param {string[]} [tags] 标签筛选（任一命中即返回）
   * @returns {Promise<Inspiration[]>} 按 createdAt 降序
   */
  async listInspirations(type, tags) {
    const db = await this._db();
    let list;
    if (type) {
      validateType(type);
      list = await new Promise((resolve, reject) => {
        const index = tx(db, 'readonly').index('type');
        const req = index.getAll(IDBKeyRange.only(type));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } else {
      list = await reqToPromise(tx(db, 'readonly').getAll());
    }
    let result = list || [];
    if (Array.isArray(tags) && tags.length > 0) {
      const tagSet = new Set(tags);
      result = result.filter((it) => (it.tags || []).some((t) => tagSet.has(t)));
    }
    // 按 createdAt 降序
    result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return result;
  }

  /**
   * 更新灵感。
   * @param {string} id
   * @param {object} patch 待合并的字段
   * @returns {Promise<Inspiration>} 更新后的灵感
   */
  async updateInspiration(id, patch) {
    if (!id) throw new Error('updateInspiration: id 不能为空');
    if (!patch || typeof patch !== 'object') throw new Error('updateInspiration: patch 必须为对象');
    const db = await this._db();
    const existing = await reqToPromise(tx(db, 'readonly').get(id));
    if (!existing) throw new Error('灵感不存在：' + id);
    if (patch.type) validateType(patch.type);
    const merged = {
      ...existing,
      ...patch,
      id: existing.id, // 不允许改 id
      createdAt: existing.createdAt, // 不允许改 createdAt
      updatedAt: new Date().toISOString(),
    };
    await reqToPromise(tx(db, 'readwrite').put(merged));
    return merged;
  }

  /**
   * 删除灵感。
   * @param {string} id
   */
  async deleteInspiration(id) {
    if (!id) throw new Error('deleteInspiration: id 不能为空');
    const db = await this._db();
    await reqToPromise(tx(db, 'readwrite').delete(id));
  }

  /**
   * 取单条灵感。
   * @param {string} id
   * @returns {Promise<Inspiration|null>}
   */
  async getInspiration(id) {
    if (!id) return null;
    const db = await this._db();
    const result = await reqToPromise(tx(db, 'readonly').get(id));
    return result || null;
  }

  /**
   * 关键词搜索（在 title/content/tags 中匹配）。
   * @param {string} keyword
   * @returns {Promise<Inspiration[]>} 按 createdAt 降序
   */
  async searchInspirations(keyword) {
    if (!keyword) return [];
    const all = await this.listInspirations();
    const kw = String(keyword).toLowerCase();
    const result = all.filter((it) => {
      const title = (it.title || '').toLowerCase();
      const content = (it.content || '').toLowerCase();
      const tags = (it.tags || []).join(' ').toLowerCase();
      return title.includes(kw) || content.includes(kw) || tags.includes(kw);
    });
    return result;
  }

  /**
   * 导出为 Markdown（对齐 NovelForge_Vault/03_素材库/inspirations.md 格式）。
   * @returns {Promise<string>}
   */
  async exportToMarkdown() {
    const all = await this.listInspirations();
    const lines = [];
    lines.push('# 灵感库');
    lines.push('');
    lines.push('> 由 DreamTale 灵感库管理导出 · ' + new Date().toISOString());
    lines.push('');
    if (all.length === 0) {
      lines.push('（暂无灵感条目）');
      return lines.join('\n');
    }
    // 按类型分组
    const byType = {};
    for (const it of all) {
      const t = it.type || 'idea';
      if (!byType[t]) byType[t] = [];
      byType[t].push(it);
    }
    for (const type of INSPIRATION_TYPES) {
      const items = byType[type];
      if (!items || items.length === 0) continue;
      lines.push('## ' + (TYPE_LABELS[type] || type) + '（' + type + '）');
      lines.push('');
      for (const it of items) {
        lines.push('### ' + (it.title || '无标题'));
        lines.push('');
        lines.push('- **ID**：' + it.id);
        lines.push('- **类型**：' + type);
        if (it.tags && it.tags.length) lines.push('- **标签**：' + it.tags.join(', '));
        if (it.sourceUrl) lines.push('- **来源**：' + it.sourceUrl);
        if (it.relatedChapter) lines.push('- **关联章节**：' + it.relatedChapter);
        lines.push('- **创建时间**：' + it.createdAt);
        lines.push('- **更新时间**：' + it.updatedAt);
        lines.push('');
        if (it.content) {
          lines.push(it.content);
          lines.push('');
        }
        lines.push('---');
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  /**
   * 从 Markdown 导入（与 exportToMarkdown 互逆）。
   * 仅识别上述导出格式；解析失败的段落会被跳过。
   * @param {string} md
   * @returns {Promise<Inspiration[]>} 导入成功的灵感数组
   */
  async importFromMarkdown(md) {
    if (!md || typeof md !== 'string') return [];
    const lines = md.split(/\r?\n/);
    const items = [];
    let current = null;
    let inContent = false;
    let contentBuf = [];

    function flush() {
      if (current) {
        if (inContent) {
          current.content = contentBuf.join('\n').replace(/\n+$/, '');
        }
        items.push(current);
      }
      current = null;
      inContent = false;
      contentBuf = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // ### 标题 → 新条目开始
      const titleMatch = /^###\s+(.+)$/.exec(line);
      if (titleMatch) {
        flush();
        current = {
          id: '',
          type: 'idea',
          title: titleMatch[1].trim(),
          content: '',
          tags: [],
          sourceUrl: '',
          relatedChapter: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        inContent = false;
        continue;
      }
      // --- 分隔符 → 结束当前条目
      if (/^---\s*$/.test(line)) {
        flush();
        continue;
      }
      // 字段行：- **字段**：值
      if (current && /^\s*-\s*\*\*(.+?)\*\*[：:]\s*(.*)$/.test(line)) {
        const m = line.match(/^\s*-\s*\*\*(.+?)\*\*[：:]\s*(.*)$/);
        const field = m[1].trim();
        const val = m[2].trim();
        if (field === 'ID') current.id = val;
        else if (field === '类型') current.type = val;
        else if (field === '标签') current.tags = val ? val.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
        else if (field === '来源') current.sourceUrl = val;
        else if (field === '关联章节') current.relatedChapter = val;
        else if (field === '创建时间') current.createdAt = val || current.createdAt;
        else if (field === '更新时间') current.updatedAt = val || current.updatedAt;
        inContent = false;
        continue;
      }
      // 空行
      if (line.trim() === '') {
        if (current && inContent) contentBuf.push('');
        continue;
      }
      // 其他内容 → content
      if (current) {
        inContent = true;
        contentBuf.push(line);
      }
    }
    flush();

    // 入库
    const inserted = [];
    for (const it of items) {
      // 校验 type
      try { validateType(it.type); } catch (e) { it.type = 'idea'; }
      // 重新生成 id（避免与已有冲突）
      const item = { ...it, id: genId() };
      try {
        const saved = await this.addInspiration(item);
        inserted.push(saved);
      } catch (e) {
        console.warn('[inspiration] 导入失败：' + (it.title || '') + ' →', e.message || e);
      }
    }
    return inserted;
  }

  /**
   * 清空灵感库（测试用，慎用）。
   */
  async clearAll() {
    const db = await this._db();
    await reqToPromise(tx(db, 'readwrite').clear());
  }
}
