// Mock 适配器（测试用，返回固定 fixture，不触网）
// 用于阶段3 AI Modules 的单测，以及无配置时演示用。

import { BaseAIAdapter } from './base-adapter.js';

const DEFAULT_TEXT_FIXTURE = '[MockAI] 这是一段 Mock 文本输出。';
const DEFAULT_JSON_FIXTURE = { ok: true, source: 'mock', data: {} };

export class MockAdapter extends BaseAIAdapter {
  /**
   * @param {{textFixture?: string, jsonFixture?: object, streamFixture?: string, delay?: number}} [config]
   */
  constructor(config) {
    super(config);
    this.config = config || {};
    this.textFixture = this.config.textFixture || DEFAULT_TEXT_FIXTURE;
    this.jsonFixture = this.config.jsonFixture || DEFAULT_JSON_FIXTURE;
    this.streamFixture = this.config.streamFixture || this.textFixture;
    this.delay = typeof this.config.delay === 'number' ? this.config.delay : 0;
  }

  getName() { return 'mock'; }
  getType() { return 'mock'; }

  async isAvailable() { return true; }

  async _sleep() {
    if (this.delay > 0) {
      const ms = this.delay;
      return new Promise(function (r) { setTimeout(r, ms); });
    }
  }

  async generateText(_prompt, _options) {
    await this._sleep();
    return this.textFixture;
  }

  async generateStructured(_prompt, _schema, _options) {
    await this._sleep();
    return Object.assign({}, this.jsonFixture);
  }

  async *streamGenerate(_prompt, _options) {
    // 逐字 yield 预设文本
    const text = this.streamFixture;
    for (let i = 0; i < text.length; i++) {
      if (this.delay > 0) await this._sleep();
      yield text[i];
    }
  }
}
