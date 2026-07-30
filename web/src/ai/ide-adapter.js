// IDE 集成适配器（阶段2 占位实现，阶段5 深度对接）
// 适配 Trae / WorkBuddy 等 IDE 内置 AI 能力。
// 通过 postMessage 或 WebSocket 与 IDE 通信。
// 当前阶段为占位实现：仅检测 IDE 环境，generateText 等方法返回错误。
// 阶段2 占位 AI 适配器，阶段5 深度对接 IDE Skills

import { BaseAIAdapter } from './base-adapter.js';

export class IDEAdapter extends BaseAIAdapter {
  /**
   * @param {{ideType?: string}} [config]
   */
  constructor(config) {
    super(config);
    const detected = IDEAdapter.detectIDEType();
    this.ideType = detected || (config && config.ideType) || 'unknown';
  }

  getName() { return 'ide'; }
  getType() { return 'ide'; }

  /** 检测当前 IDE 环境类型，无 IDE 返回 null */
  static detectIDEType() {
    if (typeof window === 'undefined') return null;
    if (window.__TRAE_IDE__) return 'trae';
    if (window.__WORKBUDDY__) return 'workbuddy';
    return null;
  }

  async isAvailable() {
    return IDEAdapter.detectIDEType() !== null;
  }

  async generateText(_prompt, _options) {
    if (!(await this.isAvailable())) {
      throw new Error('IDEAdapter: 未检测到 IDE 环境，无法调用 AI');
    }
    // 阶段2 占位：不实际调用 IDE Skills，等待阶段5 实现
    throw new Error('IDEAdapter: 阶段2 占位实现，generateText 待阶段5 接入 IDE Skills');
  }

  async generateStructured(_prompt, _schema, _options) {
    if (!(await this.isAvailable())) {
      throw new Error('IDEAdapter: 未检测到 IDE 环境，无法调用 AI');
    }
    throw new Error('IDEAdapter: 阶段2 占位实现，generateStructured 待阶段5 接入 IDE Skills');
  }

  async *streamGenerate(_prompt, _options) {
    if (!(await this.isAvailable())) {
      throw new Error('IDEAdapter: 未检测到 IDE 环境，无法调用 AI');
    }
    throw new Error('IDEAdapter: 阶段2 占位实现，streamGenerate 待阶段5 接入 IDE Skills');
  }
}
