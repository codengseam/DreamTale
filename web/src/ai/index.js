// AI 适配层统一入口
// 阶段2 铁律：所有 AI 调用必须通过本入口，禁止业务代码直接调 AI SDK。

export { BaseAIAdapter } from './base-adapter.js';
export { OpenAIAdapter } from './openai-adapter.js';
export { IDEAdapter } from './ide-adapter.js';
export { MockAdapter } from './mock-adapter.js';
export { createAIAdapter, detectAvailableAdapter } from './factory.js';
export { ConfigManager } from './config-manager.js';
