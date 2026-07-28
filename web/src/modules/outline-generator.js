// 大纲智能生成模块
// 阶段3：基于 AI 适配层 + Skill manifest 生成单章章纲（十段模板），并支持段落扩写与节奏调整。
//
// 设计要点：
// - 所有 AI 调用通过 BaseAIAdapter（generateText / generateStructured），禁止直接 fetch AI API
// - manifest 加载失败时降级到内置 fallback prompt，保证基本可用
// - 上下文字段缺省时用空串兜底，不阻断调用

import { loadSkillManifest, getSkillPrompt, fillPromptTemplate } from './manifest-loader.js';

const SKILL_NAME = 'outline_generator';

// manifest 加载失败时的兜底 prompt（精简版，保证基本可用）
const FALLBACK_SYSTEM = '你是 DreamTale 章纲生成助手，按十段模板（章节信息/核心冲突/场景列表/出场角色/伏笔操作/爽点设计/章末钩子/节奏标记/上下文召回/必须遵守）输出 JSON 章纲。';
const FALLBACK_USER_TEMPLATE =
  '项目：{{project}}\n卷：{{volume}}\n世界观：{{worldSetting}}\n角色：{{characters}}\n前情：{{previousChapters}}\n伏笔：{{hooks}}\n额外要求：{{extra_requirement}}\n请输出十段模板 JSON 章纲。';

export class OutlineGenerator {
  /**
   * @param {import('../ai/base-adapter.js').BaseAIAdapter} aiAdapter BaseAIAdapter 实例
   * @param {{manifest?: object, manifestOptions?: object}} [options] 预加载 manifest 或加载选项
   */
  constructor(aiAdapter, options) {
    if (!aiAdapter) throw new Error('OutlineGenerator: aiAdapter 不能为空');
    this.ai = aiAdapter;
    this._manifest = (options && options.manifest) || null;
    this._manifestOptions = (options && options.manifestOptions) || {};
  }

  /** 懒加载 manifest（失败回退到 fallback） */
  async _getPrompt() {
    if (!this._manifest) {
      try {
        this._manifest = await loadSkillManifest(this._manifestOptions);
      } catch (_e) {
        this._manifest = null; // 用 fallback
      }
    }
    if (this._manifest) {
      try {
        return getSkillPrompt(this._manifest, SKILL_NAME);
      } catch (_e) {
        return { system: FALLBACK_SYSTEM, user_template: FALLBACK_USER_TEMPLATE };
      }
    }
    return { system: FALLBACK_SYSTEM, user_template: FALLBACK_USER_TEMPLATE };
  }

  /**
   * 生成单章章纲（十段模板）。
   * @param {object} context { project, volume, characters, worldSetting, previousChapters, hooks, extra_requirement }
   * @returns {Promise<object>} 十段模板对象
   */
  async generateChapterOutline(context) {
    context = context || {};
    const { system, user_template } = await this._getPrompt();

    const vars = {
      project: stringify(context.project) || '（未指定）',
      volume: stringify(context.volume) || '（未指定）',
      worldSetting: stringify(context.worldSetting) || '（未提供）',
      characters: stringify(context.characters) || '（未提供）',
      previousChapters: stringify(context.previousChapters) || '（无前情）',
      hooks: stringify(context.hooks) || '（无待处理伏笔）',
      extra_requirement: context.extra_requirement || '（无）'
    };
    const userPrompt = fillPromptTemplate(user_template, vars);

    const schema = {
      type: 'object',
      required: ['chapter_info', 'core_conflict', 'scenes', 'rhythm'],
      properties: {
        chapter_info: { type: 'object' },
        core_conflict: { type: 'string' },
        scenes: { type: 'array' },
        characters: { type: 'array' },
        hook_ops: { type: 'object' },
        highlights: { type: 'array' },
        chapter_hook: { type: 'string' },
        rhythm: { type: 'object' },
        context_recall: { type: 'array' },
        must_keep: { type: 'array' },
        must_avoid: { type: 'array' }
      }
    };

    const result = await this.ai.generateStructured(
      buildFullPrompt(system, userPrompt),
      schema
    );
    return normalizeOutline(result || {});
  }

  /**
   * 扩写选中段落。
   * @param {string} outlineSection 选中段落的当前内容
   * @param {string} instruction 扩写指令（如「补充场景二的冲突细节」）
   * @returns {Promise<string>} 扩写后的段落文本
   */
  async expandOutline(outlineSection, instruction) {
    const system = '你是 DreamTale 章纲扩写助手。根据指令扩写指定段落，保持与原章纲风格一致，输出纯文本段落（不要前后缀、不要解释）。';
    const user =
      '【原段落】\n' + (outlineSection || '（空）') + '\n\n' +
      '【扩写指令】\n' + (instruction || '（请补充细节）') + '\n\n' +
      '请输出扩写后的段落全文。';
    return await this.ai.generateText(buildFullPrompt(system, user));
  }

  /**
   * 调整节奏（爽点值/压抑值/情绪走向）。
   * @param {object} outline 现有章纲对象
   * @param {object} targetRhythm { climax, depression, emotion_trend }
   * @returns {Promise<object>} 调整后的章纲对象
   */
  async adjustRhythm(outline, targetRhythm) {
    outline = outline || {};
    targetRhythm = targetRhythm || {};
    const system = '你是 DreamTale 节奏调整助手。根据目标节奏标记微调章纲的场景/爽点/章末钩子，使节奏对齐目标，输出完整 JSON 章纲（不改变核心冲突与角色）。';
    const user =
      '【原章纲 JSON】\n' + JSON.stringify(outline, null, 2) + '\n\n' +
      '【目标节奏】爽点值=' + (targetRhythm.climax || 3) + '，压抑值=' + (targetRhythm.depression || 2) + '，情绪走向=' + (targetRhythm.emotion_trend || '上扬') + '\n\n' +
      '请输出调整后的完整 JSON 章纲。';
    const result = await this.ai.generateStructured(
      buildFullPrompt(system, user),
      { type: 'object' }
    );
    return normalizeOutline(Object.assign({}, outline, result || {}));
  }
}

// ---------- 内部工具 ----------

/** 把对象/字符串格式化为 prompt 友好的文本 */
function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.map(function (x) {
      if (x && typeof x === 'object') {
        // 角色/场景等对象：取 name/role_in_chapter/type/description 等字段
        return [x.name, x.role_in_chapter, x.type, x.description, x.presentation]
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

/** 拼接 system + user 为完整 prompt */
function buildFullPrompt(system, user) {
  return system + '\n\n---\n\n' + user;
}

/** 规范化 AI 返回的章纲对象（保证关键字段存在） */
function normalizeOutline(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    chapter_info: o.chapter_info || { vol_no: '', ch_no: '', word_target: 2800, chapter_type: 'regular' },
    core_conflict: o.core_conflict || '',
    scenes: Array.isArray(o.scenes) ? o.scenes : [],
    characters: Array.isArray(o.characters) ? o.characters : [],
    hook_ops: o.hook_ops || { planted: [], resolved: [], reminded: [] },
    highlights: Array.isArray(o.highlights) ? o.highlights : [],
    chapter_hook: o.chapter_hook || '',
    rhythm: o.rhythm || { climax: 3, depression: 2, emotion_trend: '上扬' },
    context_recall: Array.isArray(o.context_recall) ? o.context_recall : [],
    must_keep: Array.isArray(o.must_keep) ? o.must_keep : [],
    must_avoid: Array.isArray(o.must_avoid) ? o.must_avoid : []
  };
}
