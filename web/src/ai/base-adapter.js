// AI 适配层抽象基类
// 所有具体适配器（OpenAI / IDE / Mock）必须继承此类并实现其方法。
// 阶段2 铁律：所有 AI 调用必须通过 Adapter 层，禁止业务代码直接调 AI SDK。

/**
 * @abstract
 * AI 适配器抽象基类。
 * 子类必须实现：generateText / generateStructured / streamGenerate / isAvailable / getName / getType
 */
export class BaseAIAdapter {
  /**
   * @param {{apiKey?: string, baseUrl?: string, model?: string, mode?: string}} _config
   */
  constructor(_config) {
    if (new.target === BaseAIAdapter) {
      throw new Error('BaseAIAdapter 是抽象类，禁止直接实例化');
    }
  }

  /** 通用文本生成，返回完整文本 */
  async generateText(_prompt, _options) {
    throw new Error(this.getName() + ': generateText 未实现');
  }

  /** 结构化 JSON 生成，返回解析后的对象 */
  async generateStructured(_prompt, _schema, _options) {
    throw new Error(this.getName() + ': generateStructured 未实现');
  }

  /** 流式输出，逐字 yield 文本片段 */
  async *streamGenerate(_prompt, _options) {
    throw new Error(this.getName() + ': streamGenerate 未实现');
  }

  /** 检测可用性（不抛错，返回 boolean） */
  async isAvailable() {
    return false;
  }

  /** 适配器名称，用于诊断 */
  getName() {
    return 'base';
  }

  /** 适配器类型：'api-key' | 'ide' | 'mock' */
  getType() {
    return 'mock';
  }
}
