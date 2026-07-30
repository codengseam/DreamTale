// DreamTale 扩展层 · 题材定向匹配
// ============================================================
// 基于小说题材标签（玄幻/都市/历史/言情/科幻/悬疑）筛选热点，
// 并为热点打题材标签，辅助作者判断哪些热点可借鉴。
//
// 设计要点：
// - 纯函数模块，无副作用，易测试
// - 关键词字典可在运行时扩展（registerGenreKeywords）
// - 评分模型：匹配关键词数 × 权重 + 热度归一化

/**
 * 题材 → 关键词字典
 * 关键词以中文字符为主，匹配时大小写不敏感。
 */
export const GENRE_KEYWORDS = {
  '玄幻': ['修仙', '剑', '境界', '宗门', '丹药', '灵气', '神兽', '法宝', '阵法', '元婴', '渡劫', '飞升', '仙', '魔', '妖', '灵'],
  '都市': ['都市', '职场', '商业', '豪门', '重生', '系统', '异能', '富二代', '总裁', '创业', '商战', '律师', '医生', '警察'],
  '历史': ['历史', '朝代', '帝王', '战争', '古人', '典故', '宫斗', '权谋', '将相', '王朝', '古风', '穿越古代'],
  '言情': ['爱情', '甜宠', '虐恋', '霸总', '校园', '青梅', '婚姻', '恋爱', '暗恋', '前任', '相亲', '高甜', '虐文'],
  '科幻': ['未来', '星际', 'AI', '机械', '末日', '变异', '宇宙', '机器人', '赛博', '人工智能', '外星', '虫族', '基因'],
  '悬疑': ['推理', '案件', '侦探', '悬疑', '犯罪', '密室', '凶杀', '诡案', '刑侦', '法医', '谜题', '诡计'],
};

/** 关键词权重：单关键词命中权重（默认 1） */
const DEFAULT_KEYWORD_WEIGHT = 1;
/** 热度归一化上限：高于此值不再加分 */
const HEAT_NORM_CAP = 10000;
/** 热度在最终评分中的权重（0-1） */
const HEAT_WEIGHT = 0.2;
/** 关键词匹配权重（0-1，与 HEAT_WEIGHT 互补） */
const KEYWORD_WEIGHT = 0.8;

/**
 * 注册/扩展某题材的关键词。
 * @param {string} genre 题材名
 * @param {string[]} keywords 关键词数组
 */
export function registerGenreKeywords(genre, keywords) {
  if (!genre || !Array.isArray(keywords)) return;
  const existing = GENRE_KEYWORDS[genre] || [];
  // 合并去重
  GENRE_KEYWORDS[genre] = Array.from(new Set([...existing, ...keywords]));
}

/**
 * 列出所有已注册题材。
 * @returns {string[]}
 */
export function listGenres() {
  return Object.keys(GENRE_KEYWORDS);
}

/**
 * 从文本中提取题材标签。
 * 命中关键词数 ≥ 1 即打上对应题材标签。
 *
 * @param {string} text 文本（标题+摘要拼接）
 * @returns {string[]} 题材标签数组（如 ['玄幻', '都市']）
 */
export function extractGenreTags(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();
  const tags = [];
  for (const [genre, words] of Object.entries(GENRE_KEYWORDS)) {
    let hit = false;
    for (const w of words) {
      if (!w) continue;
      // 中文关键词直接 indexOf；英文关键词小写比较
      if (/[a-zA-Z]/.test(w)) {
        if (lower.includes(w.toLowerCase())) { hit = true; break; }
      } else {
        if (text.includes(w)) { hit = true; break; }
      }
    }
    if (hit) tags.push(genre);
  }
  return tags;
}

/**
 * 计算热点相对于某题材的匹配度评分（0-1）。
 *
 * 评分公式：
 *   score = KEYWORD_WEIGHT × (命中词数 / 该题材总词数)
 *         + HEAT_WEIGHT × min(1, heat / HEAT_NORM_CAP)
 *
 * @param {object} hotspot { title, summary, heat, ... }
 * @param {string} genre 题材名
 * @returns {number} 0-1 之间
 */
export function scoreHotspot(hotspot, genre) {
  if (!hotspot || !genre) return 0;
  const words = GENRE_KEYWORDS[genre];
  if (!words || words.length === 0) return 0;
  const text = ((hotspot.title || '') + ' ' + (hotspot.summary || '')).toLowerCase();
  const originalText = (hotspot.title || '') + ' ' + (hotspot.summary || '');
  // 命中关键词数
  let hits = 0;
  for (const w of words) {
    if (!w) continue;
    if (/[a-zA-Z]/.test(w)) {
      if (text.includes(w.toLowerCase())) hits++;
    } else {
      if (originalText.includes(w)) hits++;
    }
  }
  const keywordScore = words.length > 0 ? hits / words.length : 0;
  const heat = Number(hotspot.heat) || 0;
  const heatScore = Math.min(1, heat / HEAT_NORM_CAP);
  const score = KEYWORD_WEIGHT * keywordScore + HEAT_WEIGHT * heatScore;
  // 裁剪到 0-1
  return Math.max(0, Math.min(1, score));
}

/**
 * 按题材筛选热点，并按匹配度降序返回。
 * 默认阈值 0.05（保留有微弱关联的热点）。
 *
 * @param {Array<Hotspot>} hotspots
 * @param {string} genre 题材名
 * @param {object} [opts] { threshold?: number, withTags?: boolean }
 * @returns {Array<Hotspot>} 筛选后的热点（附 _score 字段）
 */
export function matchByGenre(hotspots, genre, opts = {}) {
  if (!Array.isArray(hotspots) || !genre) return [];
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.05;
  const withTags = opts.withTags !== false; // 默认 true
  const scored = hotspots.map((h) => {
    const score = scoreHotspot(h, genre);
    const tags = withTags ? extractGenreTags((h.title || '') + ' ' + (h.summary || '')) : (h.genreTags || []);
    return { ...h, _score: score, genreTags: tags };
  });
  return scored
    .filter((h) => h._score >= threshold)
    .sort((a, b) => (b._score || 0) - (a._score || 0));
}

/**
 * 给热点批量打题材标签（原地修改 genreTags 字段）。
 * @param {Array<Hotspot>} hotspots
 * @returns {Array<Hotspot>} 同一数组（已原地修改）
 */
export function tagHotspots(hotspots) {
  if (!Array.isArray(hotspots)) return [];
  for (const h of hotspots) {
    const text = (h.title || '') + ' ' + (h.summary || '');
    h.genreTags = extractGenreTags(text);
  }
  return hotspots;
}
