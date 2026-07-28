// 爽点/坑点挖掘模块
// 阶段3：基于 AI 适配层 + Skill manifest 推荐爽点、伏笔回收建议与情绪曲线。
//
// 设计要点：
// - mineHighlights: 推荐当前章节爽点/情绪转折
// - suggestHookRecycles: 扫描已有伏笔与内容，提示可回收/可新增的伏笔
// - planEmotionCurve: 规划本章情绪起伏（高潮位/铺垫位/反转位）
// - 所有 AI 调用通过 BaseAIAdapter，manifest 加载失败时降级到内置 fallback prompt

import { loadSkillManifest, getSkillPrompt, fillPromptTemplate } from './manifest-loader.js';

const SKILL_NAME = 'highlight_miner';

const FALLBACK_SYSTEM = '你是 DreamTale 爽点挖掘助手，推荐 3-5 个爽点（type/description/strength 1-5/chapter_position），输出 JSON。';
const FALLBACK_USER_TEMPLATE =
  '章节：{{chapter}}\n角色：{{characters}}\n题材：{{genre}}\n已有爽点：{{previousHighlights}}\n请输出 JSON：{ "highlights": [{ "type":"", "description":"", "strength":3, "chapter_position":"" }] }';

export class HighlightMiner {
  /**
   * @param {import('../ai/base-adapter.js').BaseAIAdapter} aiAdapter
   * @param {{manifest?: object, manifestOptions?: object}} [options]
   */
  constructor(aiAdapter, options) {
    if (!aiAdapter) throw new Error('HighlightMiner: aiAdapter 不能为空');
    this.ai = aiAdapter;
    this._manifest = (options && options.manifest) || null;
    this._manifestOptions = (options && options.manifestOptions) || {};
  }

  async _getPrompt() {
    if (!this._manifest) {
      try { this._manifest = await loadSkillManifest(this._manifestOptions); }
      catch (_e) { this._manifest = null; }
    }
    if (this._manifest) {
      try { return getSkillPrompt(this._manifest, SKILL_NAME); }
      catch (_e) { return { system: FALLBACK_SYSTEM, user_template: FALLBACK_USER_TEMPLATE }; }
    }
    return { system: FALLBACK_SYSTEM, user_template: FALLBACK_USER_TEMPLATE };
  }

  /**
   * 挖掘当前章节的爽点/情绪转折。
   * @param {object} context { chapter, characters, genre, previousHighlights }
   * @returns {Promise<object[]>} [{ type, description, strength, chapter_position }]
   */
  async mineHighlights(context) {
    context = context || {};
    const { system, user_template } = await this._getPrompt();
    const vars = {
      chapter: stringify(context.chapter) || '（未指定）',
      characters: stringify(context.characters) || '（未提供）',
      genre: context.genre || '（未指定）',
      previousHighlights: stringify(context.previousHighlights) || '（无）'
    };
    const userPrompt = fillPromptTemplate(user_template, vars);

    const schema = {
      type: 'object',
      properties: {
        highlights: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              description: { type: 'string' },
              strength: { type: 'number' },
              chapter_position: { type: 'string' }
            }
          }
        }
      }
    };

    const result = await this.ai.generateStructured(buildFullPrompt(system, userPrompt), schema);
    const obj = result && Array.isArray(result.highlights) ? result : { highlights: [] };
    return obj.highlights.map(normalizeHighlight);
  }

  /**
   * 扫描已有内容，提示哪些伏笔可回收，哪里适合新增伏笔。
   * @param {object} context { chapter, hooks, characters }
   * @returns {Promise<object[]>} 回收/新增建议列表
   */
  async suggestHookRecycles(context) {
    context = context || {};
    const system =
      '你是 DreamTale 伏笔回收建议助手。基于当前章节上下文与已有伏笔表，输出两类建议：\n' +
      '1. recycles: 当前可回收的伏笔（含 hook_id/payoff_type/suggestion）\n' +
      '2. plant_suggestions: 适合本章新增的伏笔（含 description/scope/target_resolve_ch）\n' +
      '输出 JSON：{ "recycles": [...], "plant_suggestions": [...] }';
    const user =
      '【当前章节】\n' + stringify(context.chapter) + '\n\n' +
      '【已有伏笔（含 status/scope/payoff_type）】\n' + stringify(context.hooks) + '\n\n' +
      '【出场角色】\n' + stringify(context.characters) + '\n\n' +
      '请输出 JSON。';

    const result = await this.ai.generateStructured(buildFullPrompt(system, user), { type: 'object' });
    const obj = result && typeof result === 'object' ? result : {};
    const recycles = Array.isArray(obj.recycles) ? obj.recycles : [];
    const plants = Array.isArray(obj.plant_suggestions) ? obj.plant_suggestions : [];
    return recycles.concat(plants);
  }

  /**
   * 规划本章情绪起伏。
   * @param {object} chapter 当前章节信息（含核心冲突/场景/章末钩子）
   * @returns {Promise<object>} { climax_position, buildup_position, twist_position, curve: [{position, emotion, intensity}] }
   */
  async planEmotionCurve(chapter) {
    const system =
      '你是 DreamTale 情绪曲线规划助手。基于章节核心冲突与场景，规划本章情绪起伏：\n' +
      '- climax_position: 高潮位（章节百分比位置）\n' +
      '- buildup_position: 铺垫位\n' +
      '- twist_position: 反转位（可空）\n' +
      '- curve: 情绪曲线采样点 [{position, emotion, intensity}]\n' +
      '输出 JSON。';
    const user =
      '【章节信息】\n' + stringify(chapter) + '\n\n' +
      '请规划本章情绪曲线，输出 JSON。';

    const result = await this.ai.generateStructured(buildFullPrompt(system, user), { type: 'object' });
    return normalizeEmotionCurve(result || {});
  }
}

// ---------- 内部工具 ----------

function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.map(function (x) {
      if (x && typeof x === 'object') {
        return [x.hook_id, x.name, x.type, x.description, x.role_in_chapter, x.status, x.scope, x.payoff_type]
          .filter(Boolean).join(' · ');
      }
      return String(x);
    }).join('\n');
  }
  if (typeof v === 'object') {
    try { return JSON.stringify(v, null, 2); } catch (_e) { return String(v); }
  }
  return String(v);
}

function buildFullPrompt(system, user) {
  return system + '\n\n---\n\n' + user;
}

function normalizeHighlight(h) {
  h = h && typeof h === 'object' ? h : {};
  const strength = Number(h.strength);
  return {
    type: h.type || '常规',
    description: h.description || '',
    strength: isNaN(strength) ? 3 : Math.max(1, Math.min(5, strength)),
    chapter_position: h.chapter_position || '中段'
  };
}

function normalizeEmotionCurve(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    climax_position: o.climax_position || '后段',
    buildup_position: o.buildup_position || '前段',
    twist_position: o.twist_position || '',
    curve: Array.isArray(o.curve) ? o.curve.map(function (p) {
      p = p && typeof p === 'object' ? p : {};
      return {
        position: p.position || '',
        emotion: p.emotion || '',
        intensity: Number(p.intensity) || 0
      };
    }) : []
  };
}
