// 文本格式化工具集：ES Module，纯函数，零 DOM 依赖
// 用于小说排版优化、关键词匹配、字数统计、@ 建议、语法渲染

const CN_RE = /[\u4e00-\u9fa5]/;
const CN_GLOBAL_RE = /[\u4e00-\u9fa5]/g;
const EN_WORD_RE = /[a-zA-Z]+/g;
const DIGIT_BLOCK_RE = /\d+/g;

const HALF_TO_FULL = {
  ',': '，',
  '!': '！',
  '?': '？',
  ';': '；',
  ':': '：',
  '(': '（',
  ')': '）',
  '"': '「',
  "'": '」',
};

function isSpecialLine(line) {
  if (!line) return true;
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^[-*+]\s+/.test(trimmed)) return true;
  if (/^\d+\.\s+/.test(trimmed)) return true;
  if (/^>\s?/.test(trimmed)) return true;
  if (/^```/.test(trimmed)) return true;
  if (/^\|/.test(trimmed)) return true;
  return false;
}

function convertPunctuation(text) {
  const chars = text.split('');
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (HALF_TO_FULL[ch] !== undefined) {
      const prev = i > 0 ? chars[i - 1] : '';
      const next = i < chars.length - 1 ? chars[i + 1] : '';
      const prevCn = CN_RE.test(prev);
      const nextCn = CN_RE.test(next);
      if (prevCn || nextCn) {
        if (ch === '"') {
          chars[i] = prevCn && !nextCn ? '」' : '「';
        } else if (ch === "'") {
          chars[i] = prevCn && !nextCn ? '’' : '‘';
        } else {
          chars[i] = HALF_TO_FULL[ch];
        }
      }
    }
  }
  return chars.join('');
}

export function optimizeNovelFormat(text) {
  if (typeof text !== 'string' || text === '') return '';
  const lines = text.split(/\r?\n/);

  const merged = [];
  let emptyCount = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      emptyCount++;
      if (emptyCount <= 2) merged.push('');
    } else {
      emptyCount = 0;
      merged.push(line);
    }
  }

  const withIndents = merged.map((line) => {
    if (!line || isSpecialLine(line)) return line;
    if (line.startsWith('　　')) return line;
    return '　　' + line;
  });

  const dialogueSeparated = [];
  for (let i = 0; i < withIndents.length; i++) {
    const line = withIndents[i];
    const trimmed = line.trim();
    const isDialogue =
      trimmed.startsWith('「') ||
      trimmed.startsWith('“') ||
      trimmed.startsWith('"') && CN_RE.test(trimmed.slice(1, 2)) ||
      trimmed.startsWith('　　「') ||
      trimmed.startsWith('　　“');
    if (isDialogue && i > 0 && dialogueSeparated[dialogueSeparated.length - 1] !== '') {
      dialogueSeparated.push('');
    }
    dialogueSeparated.push(line);
  }

  const punctuated = convertPunctuation(dialogueSeparated.join('\n'));

  return punctuated;
}

export function matchKeywords(text, vocab) {
  const result = {
    roles: [],
    places: [],
    items: [],
    arts: [],
  };
  if (!text || !vocab) return result;
  const seen = {
    roles: new Set(),
    places: new Set(),
    items: new Set(),
    arts: new Set(),
  };
  const keys = ['roles', 'places', 'items', 'arts'];
  const positions = [];
  for (const key of keys) {
    const list = vocab[key] || [];
    for (const word of list) {
      if (!word) continue;
      let idx = text.indexOf(word);
      while (idx !== -1) {
        positions.push({ idx, key, word });
        idx = text.indexOf(word, idx + 1);
      }
    }
  }
  positions.sort((a, b) => a.idx - b.idx);
  for (const p of positions) {
    if (!seen[p.key].has(p.word)) {
      seen[p.key].add(p.word);
      result[p.key].push(p.word);
    }
  }
  return result;
}

export function countWords(text) {
  const result = { total: 0, cn: 0, en: 0, digits: 0 };
  if (!text) return result;
  const cnMatches = text.match(CN_GLOBAL_RE);
  result.cn = cnMatches ? cnMatches.length : 0;
  const enMatches = text.match(EN_WORD_RE);
  result.en = enMatches ? enMatches.length : 0;
  const digitMatches = text.match(DIGIT_BLOCK_RE);
  result.digits = digitMatches ? digitMatches.length : 0;
  result.total = result.cn + result.en + result.digits;
  return result;
}

const TYPE_MAP = {
  roles: '角色',
  places: '地点',
  items: '物品',
  arts: '功法',
};

export function atSuggest(query, vocab) {
  const result = [];
  if (!query || !vocab) return result;
  const q = query.toLowerCase();
  const keys = ['roles', 'places', 'items', 'arts'];
  for (const key of keys) {
    const list = vocab[key] || [];
    const type = TYPE_MAP[key] || key;
    for (const item of list) {
      if (!item) continue;
      const name = (item.name || '').toLowerCase();
      const brief = (item.brief || '').toLowerCase();
      if (name.includes(q) || brief.includes(q)) {
        result.push({
          type,
          id: item.id || item.name || '',
          name: item.name || '',
          brief: item.brief || '',
        });
        if (result.length >= 10) return result;
      }
    }
  }
  return result;
}

const AT_SYNTAX_RE = /\[\[(角色|地点|功法|物品):([^\]]+)\]\]/g;

const CLASS_MAP = {
  角色: 'ws-at-role',
  地点: 'ws-at-place',
  功法: 'ws-at-art',
  物品: 'ws-at-item',
};

export function renderAtSyntax(text) {
  if (typeof text !== 'string' || text === '') return '';
  return text.replace(AT_SYNTAX_RE, (match, type, content) => {
    const cls = CLASS_MAP[type] || 'ws-at-unknown';
    return `<span class="ws-at ${cls}" data-type="${type}" data-id="${content}">${content}</span>`;
  });
}
