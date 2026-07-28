// Markdown / JSON 序列化与反序列化
// 1:1 对齐 NovelForge_Vault 的章节正文 md 与章纲十段模板。
// 零 DOM 依赖，纯字符串处理。

import { Chapter, Hook, Outline, Character, WorldSetting } from './models.js';
import { normalizeVol, normalizeCh } from './vault-schema.js';

// ---------- 工具：YAML frontmatter ----------

/** 把简单的扁平对象（值全为标量/数组）写成 YAML 行数组 */
function toYamlLines(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      lines.push(`${k}:`);
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - ${String(item)}`);
        }
      }
      continue;
    }
    if (typeof v === 'string') {
      // 转义双引号
      lines.push(`${k}: "${v.replace(/"/g, '\\"')}"`);
      continue;
    }
    lines.push(`${k}: ${String(v)}`);
  }
  return lines;
}

/** 解析单行 YAML（仅支持标量与 inline 数组 [a, b]） */
function parseYamlScalar(value) {
  const s = value.trim();
  if (s === '') return '';
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '[]') return [];
  // 整数
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  // 浮点
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // 双引号字符串
  const dq = s.match(/^"(.*)"$/s);
  if (dq) return dq[1].replace(/\\"/g, '"');
  // 单引号字符串
  const sq = s.match(/^'(.*)'$/s);
  if (sq) return sq[1];
  // inline 数组 [a, b, c]
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((x) => parseYamlScalar(x.trim()));
  }
  // 裸字符串
  return s;
}

/** 解析 frontmatter（返回 { frontmatter, body }) */
export function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: md };
  const yaml = m[1];
  const body = m[2] || '';
  const frontmatter = {};
  let lastKey = null;
  for (const line of yaml.split(/\r?\n/)) {
    if (line.startsWith('  - ') && lastKey) {
      // 数组项
      const item = parseYamlScalar(line.slice(4));
      if (!Array.isArray(frontmatter[lastKey])) frontmatter[lastKey] = [];
      frontmatter[lastKey].push(item);
      continue;
    }
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s?(.*)$/);
    if (kv) {
      const k = kv[1];
      const v = kv[2];
      if (v === '') {
        // 可能是多行数组的开头
        frontmatter[k] = [];
        lastKey = k;
      } else {
        frontmatter[k] = parseYamlScalar(v);
        lastKey = k;
      }
    }
  }
  return { frontmatter, body };
}

/** 生成 frontmatter 字符串 */
export function buildFrontmatter(obj) {
  const lines = ['---', ...toYamlLines(obj), '---', ''];
  return lines.join('\n');
}

// ---------- 章节 Markdown ----------

/**
 * 把 Chapter 序列化为 NovelForge 格式 md（含 frontmatter）。
 * frontmatter 字段：vol_no, ch_no, title, status, updated_at, words
 * 正文部分以 "# 第 N 章 · 标题" 开头，后接正文 content 与 highlights 摘录。
 */
export function chapterToMarkdown(chapter, project = null) {
  const c = chapter instanceof Chapter ? chapter : new Chapter(chapter);
  const frontmatter = {
    vol_no: c.vol_no,
    ch_no: c.ch_no,
    title: c.title || '',
    status: c.status,
    updated_at: c.updated_at,
    words: c.words,
  };
  if (project && project.name) frontmatter.project = project.name;
  const lines = [];
  lines.push(buildFrontmatter(frontmatter));
  const titleNum = Number(String(c.ch_no).replace(/^0+/, '')) || 0;
  lines.push(`# 第 ${titleNum} 章 · ${c.title || ''}`);
  lines.push('');
  if (c.summary) {
    lines.push('> 摘要：' + c.summary);
    lines.push('');
  }
  if (Array.isArray(c.highlights) && c.highlights.length > 0) {
    lines.push('## 金句');
    for (const h of c.highlights) {
      lines.push(`> ${h}`);
    }
    lines.push('');
  }
  if (c.content) {
    lines.push(c.content);
    lines.push('');
  }
  return lines.join('\n');
}

/** 从 md 解析回 Chapter 对象 */
export function chapterFromMarkdown(md) {
  const { frontmatter, body } = parseFrontmatter(md);
  // 提取标题（# 第 N 章 · 标题）
  let title = frontmatter.title || '';
  const titleMatch = body.match(/^#\s+第\s*\d+\s*章\s*[·•]?\s*(.*)$/m);
  if (titleMatch && !title) title = titleMatch[1].trim();

  // 提取摘要
  let summary = '';
  const summaryMatch = body.match(/^>\s*摘要：(.*)$/m);
  if (summaryMatch) summary = summaryMatch[1].trim();

  // 提取金句段（## 金句 到下一个 ## 或字符串尾）
  const highlights = [];
  const hSectionMatch = body.match(/^##\s+金句\s*\n([\s\S]*?)(?=^##\s|\s*$)/m);
  if (hSectionMatch) {
    const block = hSectionMatch[1];
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^>\s+(.*)$/);
      if (m) highlights.push(m[1]);
    }
  }

  // 提取正文：去掉标题行、摘要行、金句段
  let content = body;
  // 去掉标题行
  content = content.replace(/^#\s+第\s*\d+\s*章[^\n]*\r?\n?/m, '');
  // 去掉摘要行
  content = content.replace(/^>\s*摘要：[^\n]*\r?\n?/m, '');
  // 去掉金句段（含段标题与引用）
  content = content.replace(/^##\s+金句\s*\n(?:>[^\n]*\n)*/m, '');
  // 去掉前后空白
  content = content.trim();

  return new Chapter({
    vol_no: frontmatter.vol_no,
    ch_no: frontmatter.ch_no,
    title,
    content,
    summary,
    highlights,
    words: frontmatter.words !== undefined ? frontmatter.words : content.length,
    status: frontmatter.status || 'draft',
    updated_at: frontmatter.updated_at || '',
  });
}

// ---------- 章纲 Markdown（11 段模板） ----------

const SECTION_HEADERS = {
  info: '## 一、章基本信息',
  scenes: '## 二、场景列表',
  conflict: '## 三、核心冲突',
  characters: '## 四、出场角色',
  hookPlanted: '## 五、伏笔埋设',
  hookResolved: '## 六、伏笔回收',
  chapterHook: '## 七、章末钩子',
  mustKeepAvoid: '## 八、must-keep / must-avoid',
  pacing: '## 九、节奏预算',
  contextRecall: '## 十、上下文召回',
  revision: '## 十一、修订历史',
};

/**
 * 把 Outline 对象序列化为 NovelForge 章纲 md（11 段模板）。
 */
export function outlineToMarkdown(outline) {
  const o = outline instanceof Outline ? outline : new Outline(outline);
  const lines = [];
  // 头部
  lines.push(`# 章纲：ch_${o.ch_no} · ${o.title || '____'}`);
  lines.push('');
  lines.push('> 本文件是单章的「细纲」，writer 按此扩写正文，polisher 按此校验。');
  lines.push('');
  lines.push('---');
  lines.push('');

  // 一、章基本信息
  lines.push(SECTION_HEADERS.info);
  lines.push('');
  lines.push(`- **章号**：ch_${o.ch_no}`);
  lines.push(`- **卷号**：vol_${o.vol_no}`);
  lines.push(`- **章标题**：${o.title || '____'}`);
  lines.push(`- **章节类型**：${o.chapter_type || '____'}`);
  lines.push(`- **字数目标**：${o.word_target || '____'} 字`);
  lines.push(`- **POV**：${o.pov || '____'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 二、场景列表
  lines.push(SECTION_HEADERS.scenes);
  lines.push('');
  if (Array.isArray(o.scenes) && o.scenes.length > 0) {
    o.scenes.forEach((scene, i) => {
      lines.push(`### 场景 ${i + 1}`);
      lines.push('');
      lines.push(`- **地点**：${scene.location || '____'}`);
      lines.push(`- **时间**：${scene.time || '____'}`);
      lines.push(`- **出场角色**：${(scene.characters || []).join('、') || '____'}`);
      lines.push(`- **核心动作**：${scene.action || '____'}`);
      lines.push(`- **场景目的**：${scene.purpose || '____'}`);
      lines.push('');
    });
  } else {
    lines.push('> 暂无场景');
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  // 三、核心冲突
  lines.push(SECTION_HEADERS.conflict);
  lines.push('');
  lines.push(`> ${o.core_conflict || '____'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 四、出场角色
  lines.push(SECTION_HEADERS.characters);
  lines.push('');
  lines.push('| 角色 | 身份 | 本章作用 | 状态锚点文件 |');
  lines.push('|---|---|---|---|');
  if (Array.isArray(o.characters) && o.characters.length > 0) {
    for (const c of o.characters) {
      lines.push(
        `| ${c.name || '____'} | ${c.identity || '____'} | ${c.role || '____'} | ${
          c.state_file || ''
        } |`
      );
    }
  } else {
    lines.push('| （空） | | | |');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // 五、伏笔埋设
  lines.push(SECTION_HEADERS.hookPlanted);
  lines.push('');
  lines.push('| 伏笔 ID | 一句话描述 | scope | 目标回收章 |');
  lines.push('|---|---|---|---|');
  if (Array.isArray(o.hook_planted) && o.hook_planted.length > 0) {
    for (const h of o.hook_planted) {
      lines.push(
        `| ${h.hook_id || ''} | ${h.description || ''} | ${h.scope || ''} | ${h.target || ''} |`
      );
    }
  } else {
    lines.push('| （空） | | | |');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // 六、伏笔回收
  lines.push(SECTION_HEADERS.hookResolved);
  lines.push('');
  lines.push('| 伏笔 ID | 来自章 | 回收方式 | 是否符合预期 |');
  lines.push('|---|---|---|---|');
  if (Array.isArray(o.hook_resolved) && o.hook_resolved.length > 0) {
    for (const h of o.hook_resolved) {
      lines.push(
        `| ${h.hook_id || ''} | ${h.from_ch || ''} | ${h.method || ''} | ${h.match ? '是' : '否'} |`
      );
    }
  } else {
    lines.push('| （空） | | | |');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // 七、章末钩子
  lines.push(SECTION_HEADERS.chapterHook);
  lines.push('');
  lines.push(`- **钩子类型**：${o.chapter_hook?.type || '____'}`);
  lines.push(`- **钩子内容**：${o.chapter_hook?.content || '____'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 八、must-keep / must-avoid
  lines.push(SECTION_HEADERS.mustKeepAvoid);
  lines.push('');
  lines.push('### 8.1 must-keep');
  lines.push('');
  for (const k of o.must_keep || []) {
    lines.push(`- [ ] ${k}`);
  }
  if ((o.must_keep || []).length === 0) lines.push('- [ ] ____');
  lines.push('');
  lines.push('### 8.2 must-avoid');
  lines.push('');
  for (const k of o.must_avoid || []) {
    lines.push(`- [ ] ${k}`);
  }
  if ((o.must_avoid || []).length === 0) lines.push('- [ ] ____');
  lines.push('');
  lines.push('---');
  lines.push('');

  // 九、节奏预算
  lines.push(SECTION_HEADERS.pacing);
  lines.push('');
  lines.push(`- **爽点等级**：1-5（本章 ${o.pacing?.climax || '____'}）`);
  lines.push(`- **压抑等级**：1-5（本章 ${o.pacing?.depression || '____'}）`);
  lines.push(`- **金句预留**：${o.pacing?.golden_quote || '____'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 十、上下文召回
  lines.push(SECTION_HEADERS.contextRecall);
  lines.push('');
  for (const p of o.context_recall || []) {
    lines.push(`- \`${p}\``);
  }
  if ((o.context_recall || []).length === 0) lines.push('- （暂无）');
  lines.push('');
  lines.push('---');
  lines.push('');

  // 十一、修订历史
  lines.push(SECTION_HEADERS.revision);
  lines.push('');
  lines.push('| 日期 | 修订内容 |');
  lines.push('|---|---|');
  if (Array.isArray(o.revision_history) && o.revision_history.length > 0) {
    for (const r of o.revision_history) {
      lines.push(`| ${r.date || ''} | ${r.note || ''} |`);
    }
  } else {
    lines.push('| YYYY-MM-DD | 初版 |');
  }
  lines.push('');

  return lines.join('\n');
}

/** 从 md 解析回 Outline 对象 */
export function outlineFromMarkdown(md) {
  // 提取顶部 # 章纲：ch_NNN · 标题
  const headerMatch = md.match(/^#\s+章纲：ch_(\d+)\s*[·•]\s*(.*)$/m);
  let ch_no = '';
  let title = '';
  if (headerMatch) {
    ch_no = headerMatch[1];
    title = headerMatch[2].trim();
  }

  // 按段切分
  const sections = splitSections(md);

  // 一、章基本信息
  const info = sections['一'] || sections.info || '';
  const chapterType = extractField(info, '章节类型');
  const wordTarget = parseInt(extractField(info, '字数目标') || '0', 10) || 0;
  const pov = extractField(info, 'POV') || extractField(info, 'POV');
  const volNo = extractField(info, '卷号')?.replace(/^vol_/, '') || '';

  // 二、场景列表
  const scenesText = sections['二'] || sections.scenes || '';
  const scenes = parseScenes(scenesText);

  // 三、核心冲突
  const conflictText = sections['三'] || sections.conflict || '';
  const coreConflict = extractQuote(conflictText);

  // 四、出场角色
  const charactersText = sections['四'] || sections.characters || '';
  const characters = parseCharacterTable(charactersText);

  // 五、伏笔埋设
  const hookPlantedText = sections['五'] || sections.hookPlanted || '';
  const hookPlanted = parseHookPlantedTable(hookPlantedText);

  // 六、伏笔回收
  const hookResolvedText = sections['六'] || sections.hookResolved || '';
  const hookResolved = parseHookResolvedTable(hookResolvedText);

  // 七、章末钩子
  const chapterHookText = sections['七'] || sections.chapterHook || '';
  const chapterHook = {
    type: extractField(chapterHookText, '钩子类型') || '',
    content: extractField(chapterHookText, '钩子内容') || '',
  };

  // 八、must-keep / must-avoid
  const mustKeepAvoidText = sections['八'] || sections.mustKeepAvoid || '';
  const { mustKeep, mustAvoid } = parseMustKeepAvoid(mustKeepAvoidText);

  // 九、节奏预算
  const pacingText = sections['九'] || sections.pacing || '';
  const climaxMatch = pacingText.match(/爽点等级.*本章\s*(\d+)/);
  const depressionMatch = pacingText.match(/压抑等级.*本章\s*(\d+)/);
  const goldenQuoteMatch = pacingText.match(/金句预留.*?：(.*)$/m);
  const pacing = {
    climax: climaxMatch ? parseInt(climaxMatch[1], 10) : 0,
    depression: depressionMatch ? parseInt(depressionMatch[1], 10) : 0,
    golden_quote: goldenQuoteMatch ? goldenQuoteMatch[1].trim() : '',
  };

  // 十、上下文召回
  const contextRecallText = sections['十'] || sections.contextRecall || '';
  const contextRecall = parseListItems(contextRecallText);

  // 十一、修订历史
  const revisionText = sections['十一'] || sections.revision || '';
  const revisionHistory = parseRevisionTable(revisionText);

  return new Outline({
    vol_no: volNo,
    ch_no,
    title,
    chapter_type: chapterType,
    word_target: wordTarget,
    pov,
    scenes,
    core_conflict: coreConflict,
    characters,
    hook_planted: hookPlanted,
    hook_resolved: hookResolved,
    chapter_hook: chapterHook,
    must_keep: mustKeep,
    must_avoid: mustAvoid,
    pacing,
    context_recall: contextRecall,
    revision_history: revisionHistory,
  });
}

// ---------- 章纲解析辅助函数 ----------

/** 按 ## 标题切段，返回 { '一': text, '二': text, ... } */
function splitSections(md) {
  const sections = {};
  // 匹配 ## 一、 或 ## 1. 等
  const re = /^##\s+([一二三四五六七八九十]+)[、.]\s*(.*)$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(md)) !== null) {
    matches.push({ index: m.index, cn: m[1], header: m[0] });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i].header.length;
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
    sections[matches[i].cn] = md.slice(start, end).trim();
  }
  return sections;
}

/** 从段落中提取 - **字段名**：值 格式的字段 */
function extractField(text, fieldName) {
  const re = new RegExp(`-\\s*\\*\\*${fieldName}\\*\\*\\s*：\\s*(.*)$`, 'm');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

/** 从段落中提取引用内容 > 内容 */
function extractQuote(text) {
  const m = text.match(/^>\s*(.*)$/m);
  return m ? m[1].trim() : '';
}

/** 解析场景列表 */
function parseScenes(text) {
  const scenes = [];
  const parts = text.split(/^###\s+/m).filter((s) => s.trim());
  for (const part of parts) {
    if (!part.includes('场景')) continue;
    const location = extractField(part, '地点') || '';
    const time = extractField(part, '时间') || '';
    const charactersStr = extractField(part, '出场角色') || '';
    const action = extractField(part, '核心动作') || '';
    const purpose = extractField(part, '场景目的') || '';
    if (!location && !time && !action) continue;
    scenes.push({
      location,
      time,
      characters: charactersStr ? charactersStr.split(/[、,]/).map((s) => s.trim()).filter(Boolean) : [],
      action,
      purpose,
    });
  }
  return scenes;
}

/** 解析角色表格 */
function parseCharacterTable(text) {
  const characters = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!m) continue;
    const name = m[1].trim();
    if (name === '角色' || name === '（空）' || name === '---') continue;
    characters.push({
      name,
      identity: m[2].trim(),
      role: m[3].trim(),
      state_file: m[4].trim(),
    });
  }
  return characters;
}

/** 解析伏笔埋设表格 */
function parseHookPlantedTable(text) {
  const hooks = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!m) continue;
    const hookId = m[1].trim();
    if (hookId === '伏笔 ID' || hookId === '（空）' || hookId === '---') continue;
    hooks.push({
      hook_id: hookId,
      description: m[2].trim(),
      scope: m[3].trim(),
      target: m[4].trim(),
    });
  }
  return hooks;
}

/** 解析伏笔回收表格 */
function parseHookResolvedTable(text) {
  const hooks = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!m) continue;
    const hookId = m[1].trim();
    if (hookId === '伏笔 ID' || hookId === '（空）' || hookId === '---') continue;
    hooks.push({
      hook_id: hookId,
      from_ch: m[2].trim(),
      method: m[3].trim(),
      match: m[4].trim() === '是',
    });
  }
  return hooks;
}

/** 解析 must-keep / must-avoid */
function parseMustKeepAvoid(text) {
  const parts = text.split(/^###\s+/m);
  const mustKeep = [];
  const mustAvoid = [];
  for (const part of parts) {
    if (part.startsWith('8.1') || part.includes('must-keep')) {
      for (const line of part.split(/\r?\n/)) {
        const m = line.match(/^-\s*\[[\sxX]\]\s*(.+)$/);
        if (m && m[1].trim() !== '____') mustKeep.push(m[1].trim());
      }
    } else if (part.startsWith('8.2') || part.includes('must-avoid')) {
      for (const line of part.split(/\r?\n/)) {
        const m = line.match(/^-\s*\[[\sxX]\]\s*(.+)$/);
        if (m && m[1].trim() !== '____') mustAvoid.push(m[1].trim());
      }
    }
  }
  return { mustKeep, mustAvoid };
}

/** 解析无序列表项 */
function parseListItems(text) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^-\s+`([^`]+)`/);
    if (m) items.push(m[1]);
  }
  return items;
}

/** 解析修订历史表格 */
function parseRevisionTable(text) {
  const items = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!m) continue;
    const date = m[1].trim();
    if (date === '日期' || date === '---' || date === 'YYYY-MM-DD') continue;
    items.push({ date, note: m[2].trim() });
  }
  return items;
}

// ---------- 伏笔 registry JSON ----------

const HOOK_REGISTRY_COMMENTS = `NovelForge 伏笔追踪表。每条伏笔记录埋设/提示/回收的全生命周期。`;

/**
 * 把 Hook 数组转为 hooks_registry.json 格式（含 _comment 头与 version）。
 * @param {Hook[]} hooks
 * @param {object} [opts] - { version: '1.0.0' }
 */
export function hookToRegistryJSON(hooks, opts = {}) {
  const arr = (hooks || []).map((h) => (h instanceof Hook ? h : new Hook(h)));
  return {
    _comment: HOOK_REGISTRY_COMMENTS,
    _comment_scope: 'scope 枚举：short=卷内回收 / long=跨卷回收 / core=全书级',
    _comment_status: 'status 枚举：planted=已埋设 → hinted=已提示 → resolved=已回收 / abandoned=已放弃',
    _comment_strength: 'strength 枚举：strong=强伏笔（必回收）/ medium=中等 / weak=弱伏笔（可放弃，但需登记）',
    _comment_payoff_type: 'payoff_type 枚举：reveal=揭示 / twist=反转 / powerup=能力解锁 / emotional=情感冲击 / callback=回扣前文',
    _comment_emotional_valence: 'emotional_valence 枚举：positive=正向爽感 / negative=负面冲击 / bittersweet=苦甜交织',
    _comment_priority: 'priority 枚举：high=高优先级（必回收且不能延期）/ medium / low',
    _comment_reminder: 'reminder_chapters 记录所有提示过的章号；next_reminder_due_ch 由 hook_auditor 计算下次该提示的章号',
    _comment_dependencies: 'dependencies 记录依赖的其他 hook_id，必须先回收依赖才能回收本条',
    version: opts.version || '1.0.0',
    hooks: arr.map((h) => h.toJSON()),
  };
}

/** 把 hooks_registry.json 解析回 Hook 数组 */
export function hookFromRegistryJSON(json) {
  if (!json || !Array.isArray(json.hooks)) return [];
  return json.hooks.map((h) => Hook.fromJSON(h));
}

/** 把 registry 对象序列化为 JSON 字符串（带缩进，UTF-8 不转义） */
export function registryToJSONString(registry) {
  return JSON.stringify(registry, null, 2);
}

/** 从 JSON 字符串解析为 registry 对象 */
export function registryFromJSONString(str) {
  return JSON.parse(str);
}

// ---------- 角色 / 世界设定 Markdown ----------

/**
 * 角色序列化为 md：含 frontmatter（元数据）+ 正文段（性格/弧光/关系/目标）。
 * 与 NovelForge_Vault/02_角色/{name}.md 风格一致。
 */
export function buildCharacterMarkdown(character) {
  const c = character instanceof Character ? character : new Character(character);
  const lines = [
    '---',
    `name: "${c.name}"`,
    `role: "${c.role}"`,
    `identity: "${c.identity}"`,
    `level: "${c.level}"`,
    `color: "${c.color}"`,
    '---',
    '',
    `# ${c.name}`,
    '',
    '## 性格',
    c.personality || '（暂无）',
    '',
    '## 弧光',
    c.arc || '（暂无）',
    '',
    '## 关系',
    c.relation || '（暂无）',
    '',
    '## 目标',
    c.goal || '（暂无）',
    '',
  ];
  return lines.join('\n');
}

/** 从 md 解析回 Character（frontmatter + 正文段） */
export function parseCharacterMarkdown(text) {
  const fm = parseSimpleFrontmatter(text);
  const sections = parseBodySections(text);
  return new Character({
    name: fm.name,
    role: fm.role || '',
    identity: fm.identity || '',
    level: fm.level || '',
    color: fm.color || '',
    personality: sections['性格'] || '',
    arc: sections['弧光'] || '',
    relation: sections['关系'] || '',
    goal: sections['目标'] || '',
  });
}

/** 世界设定序列化为 md */
export function buildWorldSettingMarkdown(setting) {
  const w = setting instanceof WorldSetting ? setting : new WorldSetting(setting);
  const lines = [
    '---',
    `category: "${w.category}"`,
    `sort_order: ${w.sort_order}`,
    '---',
    '',
    `# ${w.category}`,
    '',
    w.content || '',
    '',
  ];
  return lines.join('\n');
}

/** 从 md 解析回 WorldSetting */
export function parseWorldSettingMarkdown(text) {
  const fm = parseSimpleFrontmatter(text);
  const sections = parseBodySections(text);
  // 内容：H1 标题之后到第一个 ## 之前
  const content = sections['__body__'] || '';
  return new WorldSetting({
    category: fm.category,
    sort_order: parseInt(fm.sort_order, 10) || 0,
    content,
  });
}

// ---------- 简化 frontmatter / body 解析（仅支持标量） ----------

function parseSimpleFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return {};
  const yaml = m[1];
  const out = {};
  for (const line of yaml.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s?(.*)$/);
    if (!kv) continue;
    const v = kv[2];
    const dq = v.match(/^"(.*)"$/s);
    out[kv[1]] = dq ? dq[1] : v;
  }
  return out;
}

function parseBodySections(text) {
  // 去掉 frontmatter
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  const body = m ? m[1] : text;
  const sections = {};
  // 第一个 # 标题前的内容放到 __body__
  const firstHash = body.match(/^#\s+/m);
  if (firstHash) {
    const idx = body.indexOf(firstHash[0]);
    sections['__body__'] = body.slice(0, idx).trim();
  } else {
    sections['__body__'] = body.trim();
    return sections;
  }
  // 切分 ## 段
  const parts = body.split(/^##\s+/m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nlIdx = part.indexOf('\n');
    if (nlIdx < 0) continue;
    const title = part.slice(0, nlIdx).trim();
    const content = part.slice(nlIdx + 1).trim();
    sections[title] = content;
  }
  // 若 __body__ 为空，取 H1 之后到第一个 ## 之间的内容作为 body
  if (!sections['__body__']) {
    const afterH1 = body.split(/^#\s+.*$/m)[1] || '';
    const firstH2 = afterH1.match(/^##\s/m);
    sections['__body__'] = firstH2 ? afterH1.slice(0, afterH1.indexOf(firstH2[0])).trim() : afterH1.trim();
  }
  return sections;
}
