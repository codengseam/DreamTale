// Skill manifest 加载器
// 阶段3：从 /scripts/novelforge/skills_manifest.json 加载 Skill prompt 清单，
// 缓存到 localStorage（10 分钟过期），并提供 prompt 模板填充工具。
//
// 设计要点：
// - 所有 AI 模块（outline-generator / highlight-miner / text-polisher）共用本加载器
// - fetch 失败时回退到 localStorage 缓存（若存在），再失败则抛错
// - 测试环境（node）无 localStorage / fetch 时，允许通过 options 注入

const MANIFEST_URL = '/scripts/novelforge/skills_manifest.json';
const CACHE_KEY = 'dreamtale:skills-manifest';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟

/**
 * 加载 Skill manifest。
 * 优先用缓存（未过期），否则 fetch 远端并写入缓存。
 *
 * @param {{url?: string, storage?: Storage, force?: boolean}} [options]
 * @returns {Promise<object>} manifest 对象
 */
export async function loadSkillManifest(options) {
  options = options || {};
  const url = options.url || MANIFEST_URL;
  const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const force = !!options.force;

  // 1. 命中未过期缓存则直接返回
  if (!force && storage) {
    const cached = readCache(storage);
    if (cached) return cached;
  }

  // 2. fetch 远端
  if (typeof fetch !== 'function') {
    // 无 fetch（且无缓存）——抛错让上层处理
    throw new Error('manifest-loader: 当前环境无 fetch，且无可用缓存');
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error('manifest-loader: 加载 manifest 失败，HTTP ' + resp.status);
  }
  const manifest = await resp.json();
  if (!manifest || typeof manifest !== 'object' || !manifest.skills) {
    throw new Error('manifest-loader: manifest 格式非法（缺少 skills 字段）');
  }

  // 3. 写缓存
  if (storage) writeCache(storage, manifest);

  return manifest;
}

/**
 * 从 manifest 取指定 skill 的 system + user_template。
 * @param {object} manifest loadSkillManifest 返回值
 * @param {string} skillName skill 键名（如 'outline_generator'）
 * @returns {{system: string, user_template: string}}
 */
export function getSkillPrompt(manifest, skillName) {
  if (!manifest || !manifest.skills) {
    throw new Error('manifest-loader: manifest 非法');
  }
  const skill = manifest.skills[skillName];
  if (!skill) {
    throw new Error('manifest-loader: 未找到 skill「' + skillName + '」');
  }
  return {
    system: skill.system_prompt || '',
    user_template: skill.user_prompt_template || ''
  };
}

/**
 * 用 vars 填充 prompt 模板（{{var}} → value）。
 * 未提供值的占位符替换为空字符串。
 * @param {string} template 含 {{var}} 占位符的模板
 * @param {object} [vars] 变量键值对
 * @returns {string}
 */
export function fillPromptTemplate(template, vars) {
  if (typeof template !== 'string') return '';
  vars = vars || {};
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (_m, key) {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });
}

// ---------- 内部：缓存读写 ----------

function readCache(storage) {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.__ts || !obj.manifest) return null;
    if (Date.now() - obj.__ts > CACHE_TTL_MS) return null; // 过期
    return obj.manifest;
  } catch (_e) {
    return null;
  }
}

function writeCache(storage, manifest) {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ __ts: Date.now(), manifest: manifest }));
  } catch (_e) {
    // 容量满或被禁用——静默降级，不阻断主流程
  }
}

/** 清除 manifest 缓存（用于配置变更或手动刷新） */
export function clearManifestCache(options) {
  options = options || {};
  const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return;
  try { storage.removeItem(CACHE_KEY); } catch (_e) { /* ignore */ }
}
