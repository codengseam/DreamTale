// AI 适配器工厂
// 根据 config.mode 选择具体适配器，未指定时按环境自动检测。

import { OpenAIAdapter } from './openai-adapter.js';
import { IDEAdapter } from './ide-adapter.js';
import { MockAdapter } from './mock-adapter.js';

/**
 * 根据 config.mode 创建适配器实例
 * @param {{mode?: 'api-key'|'ide'|'mock', apiKey?: string, baseUrl?: string, model?: string, ideType?: string}} [config]
 * @returns {import('./base-adapter.js').BaseAIAdapter}
 */
export function createAIAdapter(config) {
  config = config || {};
  const mode = config.mode || detectAvailableAdapter() || 'mock';
  switch (mode) {
    case 'api-key':
      return new OpenAIAdapter(config);
    case 'ide':
      return new IDEAdapter(config);
    case 'mock':
      return new MockAdapter(config);
    default:
      throw new Error('createAIAdapter: 未知 mode=' + mode);
  }
}

/**
 * 检测可用适配器类型（不构造实例，仅返回类型字符串）
 * 优先检测 IDE 环境（无配置成本）；其次检测全局变量中的 API Key。
 * @returns {'api-key' | 'ide' | null}
 */
export function detectAvailableAdapter() {
  // 优先检测 IDE 环境（无配置成本）
  if (IDEAdapter.detectIDEType()) return 'ide';
  // 其次检测全局变量中的 API Key（用于无显式配置时的兜底）
  if (typeof globalThis !== 'undefined' && globalThis.DREAMTALE_AI_API_KEY) return 'api-key';
  return null;
}
