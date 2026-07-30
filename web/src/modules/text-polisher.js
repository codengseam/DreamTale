// 文本优化工具箱
// 阶段3：分级润色 / 错别字检查 / 去 AI 味改写 / 批量润色。
//
// 设计要点：
// - polish(level): 三级润色（light/medium/deep），调 text_polisher skill
// - checkTypos: 错别字/语病检查，调 typo_checker skill，返回错误列表
// - removeAITaste: 去 AI 味改写，调 ai_taste_remover skill
// - batchPolish: 批量润色（串行调用 polish，避免并发触发限流）
// - manifest 加载失败时降级到内置 fallback prompt

import { loadSkillManifest, getSkillPrompt, fillPromptTemplate } from './manifest-loader.js';

const POLISHER_SKILL = 'text_polisher';
const TYPO_SKILL = 'typo_checker';
const AITASTE_SKILL = 'ai_taste_remover';

const VALID_LEVELS = ['light', 'medium', 'deep'];

// fallback prompts
const FALLBACK = {
  text_polisher: {
    system: '你是 DreamTale 文本润色助手，按 ' + '{{level}}' + ' 级别润色文本，保留原意，输出纯文本。',
    user_template: '级别：{{level}}\n\n{{text}}\n\n请输出润色后全文（纯文本，无解释）。'
  },
  typo_checker: {
    system: '你是 DreamTale 错别字检查助手，输出 JSON：{ "errors": [{ "line":1, "original":"", "suggestion":"", "type":"typo" }] }',
    user_template: '{{text}}\n\n请输出 JSON 错误列表。'
  },
  ai_taste_remover: {
    system: '你是 DreamTale 去 AI 味优化助手，改写套路句式与强行升华句，输出纯文本。',
    user_template: '{{text}}\n\n请输出去 AI 味后的全文（纯文本，无解释）。'
  }
};

export class TextPolisher {
  /**
   * @param {import('../ai/base-adapter.js').BaseAIAdapter} aiAdapter
   * @param {{manifest?: object, manifestOptions?: object}} [options]
   */
  constructor(aiAdapter, options) {
    if (!aiAdapter) throw new Error('TextPolisher: aiAdapter 不能为空');
    this.ai = aiAdapter;
    this._manifest = (options && options.manifest) || null;
    this._manifestOptions = (options && options.manifestOptions) || {};
  }

  async _ensureManifest() {
    if (!this._manifest) {
      try { this._manifest = await loadSkillManifest(this._manifestOptions); }
      catch (_e) { this._manifest = null; }
    }
    return this._manifest;
  }

  async _getPrompt(skillName) {
    const manifest = await this._ensureManifest();
    if (manifest) {
      try { return getSkillPrompt(manifest, skillName); }
      catch (_e) { /* fallthrough */ }
    }
    const fb = FALLBACK[skillName] || { system: '', user_template: '' };
    return { system: fb.system, user_template: fb.user_template };
  }

  /**
   * 分级润色。
   * @param {string} text 原文
   * @param {'light'|'medium'|'deep'} level 润色级别
   * @returns {Promise<string>} 润色后文本
   */
  async polish(text, level) {
    if (typeof text !== 'string' || !text) return '';
    if (VALID_LEVELS.indexOf(level) === -1) {
      throw new Error('TextPolisher.polish: level 必须是 ' + VALID_LEVELS.join('/') + ' 之一');
    }
    const { system, user_template } = await this._getPrompt(POLISHER_SKILL);
    const userPrompt = fillPromptTemplate(user_template, { level: level, text: text });
    const result = await this.ai.generateText(buildFullPrompt(system, userPrompt));
    return typeof result === 'string' ? result : '';
  }

  /**
   * 检查错别字/语病。
   * @param {string} text 原文
   * @returns {Promise<object[]>} [{ line, original, suggestion, type }]
   */
  async checkTypos(text) {
    if (typeof text !== 'string' || !text) return [];
    const { system, user_template } = await this._getPrompt(TYPO_SKILL);
    const userPrompt = fillPromptTemplate(user_template, { text: text });
    const schema = {
      type: 'object',
      properties: {
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              line: { type: 'number' },
              original: { type: 'string' },
              suggestion: { type: 'string' },
              type: { type: 'string' }
            }
          }
        }
      }
    };
    const result = await this.ai.generateStructured(buildFullPrompt(system, userPrompt), schema);
    const obj = result && Array.isArray(result.errors) ? result : { errors: [] };
    return obj.errors.map(normalizeError);
  }

  /**
   * 去 AI 味改写。
   * @param {string} text 原文
   * @returns {Promise<string>} 改写后文本
   */
  async removeAITaste(text) {
    if (typeof text !== 'string' || !text) return '';
    const { system, user_template } = await this._getPrompt(AITASTE_SKILL);
    const userPrompt = fillPromptTemplate(user_template, { text: text });
    const result = await this.ai.generateText(buildFullPrompt(system, userPrompt));
    return typeof result === 'string' ? result : '';
  }

  /**
   * 批量润色（串行，避免并发限流）。
   * @param {string[]} texts 原文数组
   * @param {'light'|'medium'|'deep'} level 润色级别
   * @returns {Promise<string[]>} 润色后文本数组（与入参顺序一致）
   */
  async batchPolish(texts, level) {
    if (!Array.isArray(texts)) {
      throw new Error('TextPolisher.batchPolish: texts 必须是数组');
    }
    if (VALID_LEVELS.indexOf(level) === -1) {
      throw new Error('TextPolisher.batchPolish: level 必须是 ' + VALID_LEVELS.join('/') + ' 之一');
    }
    const out = [];
    for (let i = 0; i < texts.length; i++) {
      // 串行调用，避免触发 AI 服务限流
      const polished = await this.polish(texts[i], level);
      out.push(polished);
    }
    return out;
  }
}

// ---------- 内部工具 ----------

function buildFullPrompt(system, user) {
  return system + '\n\n---\n\n' + user;
}

function normalizeError(e) {
  e = e && typeof e === 'object' ? e : {};
  const line = Number(e.line);
  return {
    line: isNaN(line) || line < 1 ? 1 : Math.floor(line),
    original: e.original || '',
    suggestion: e.suggestion || '',
    type: e.type || 'typo'
  };
}
