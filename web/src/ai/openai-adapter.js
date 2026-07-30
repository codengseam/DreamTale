// OpenAI 协议兼容适配器
// 兼容 OpenAI / 智谱 / DeepSeek / 通义 / 豆包等遵循 /v1/chat/completions 协议的服务。
// 使用浏览器原生 fetch + ReadableStream 解析 SSE 流式响应。
// 阶段2 铁律：所有 AI 调用必须通过 Adapter 层，禁止业务代码直接调 AI SDK。

import { BaseAIAdapter } from './base-adapter.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-3.5-turbo';
const CHAT_COMPLETIONS_PATH = '/chat/completions';

export class OpenAIAdapter extends BaseAIAdapter {
  /**
   * @param {{apiKey: string, baseUrl?: string, model?: string}} config
   */
  constructor(config) {
    super(config);
    if (!config || !config.apiKey) {
      throw new Error('OpenAIAdapter: apiKey 不能为空');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = config.model || DEFAULT_MODEL;
  }

  getName() { return 'openai'; }
  getType() { return 'api-key'; }

  async isAvailable() {
    if (!this.apiKey) return false;
    // 通过 GET /models 探测可达性；4xx 也认为配置就绪（apiKey 错误由实际调用暴露）
    try {
      const init = { method: 'GET', headers: this._headers() };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        init.signal = AbortSignal.timeout(5000);
      }
      const res = await fetch(this.baseUrl + '/models', init);
      // 2xx 视为可达；4xx（鉴权失败）视为配置就绪但 key 待校验
      return res.ok || (res.status >= 400 && res.status < 500);
    } catch (_e) {
      return false;
    }
  }

  /** 构造请求头 */
  _headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + this.apiKey
    };
  }

  /** 构造 chat completions 请求体 */
  _buildBody(prompt, options) {
    options = options || {};
    const body = {
      model: options.model || this.model,
      messages: options.messages || [{ role: 'user', content: prompt }]
    };
    if (options.temperature != null) body.temperature = options.temperature;
    if (options.max_tokens != null) body.max_tokens = options.max_tokens;
    if (options.system) {
      body.messages = [{ role: 'system', content: options.system }].concat(body.messages);
    }
    return body;
  }

  async generateText(prompt, options) {
    const body = this._buildBody(prompt, options);
    body.stream = false;
    const res = await fetch(this.baseUrl + CHAT_COMPLETIONS_PATH, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(function () { return ''; });
      throw new Error('OpenAIAdapter 请求失败 [' + res.status + ']: ' + errText);
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string') {
      throw new Error('OpenAIAdapter: 返回内容格式异常');
    }
    return content;
  }

  async generateStructured(prompt, schema, options) {
    options = options || {};
    const systemPrompt = (options.system ? options.system + '\n' : '') +
      '请仅输出符合给定 JSON Schema 的 JSON 对象，禁止任何额外说明文字。';
    const structuredOptions = Object.assign({}, options, { system: systemPrompt });
    const schemaHint = schema ? '\n\nJSON Schema:\n' + JSON.stringify(schema) : '';
    const text = await this.generateText(prompt + schemaHint, structuredOptions);
    return this._parseJSON(text);
  }

  /** 从可能含 ```json 围栏的文本中提取 JSON */
  _parseJSON(text) {
    let s = String(text).trim();
    // 去除 ```json ... ``` 围栏
    const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) s = fenceMatch[1].trim();
    // 取第一个 { 到最后一个 } 之间的内容
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      s = s.slice(first, last + 1);
    }
    try {
      return JSON.parse(s);
    } catch (e) {
      throw new Error('OpenAIAdapter: 无法解析为 JSON — ' + e.message + '; 原文: ' + s.slice(0, 200));
    }
  }

  async *streamGenerate(prompt, options) {
    const body = this._buildBody(prompt, options);
    body.stream = true;
    const res = await fetch(this.baseUrl + CHAT_COMPLETIONS_PATH, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(function () { return ''; });
      throw new Error('OpenAIAdapter 流式请求失败 [' + res.status + ']: ' + errText);
    }
    yield* this._parseSSE(res.body);
  }

  /**
   * 解析 SSE 流，逐字 yield delta 内容
   * @param {ReadableStream<Uint8Array>} stream
   */
  async *_parseSSE(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 事件以 \n\n 分隔
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const delta = this._parseSSEChunk(chunk);
          if (delta) yield delta;
        }
      }
      // flush 末尾残留
      if (buffer.trim()) {
        const delta = this._parseSSEChunk(buffer);
        if (delta) yield delta;
      }
    } finally {
      try { reader.releaseLock(); } catch (_e) { /* ignore */ }
    }
  }

  /** 解析单个 SSE 事件块，返回 delta 文本（无则返回空字符串） */
  _parseSSEChunk(chunk) {
    const lines = chunk.split('\n');
    let data = '';
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // 注释或空行
      if (trimmed.startsWith('data:')) {
        data += trimmed.slice(5).trim();
      }
    }
    if (!data) return '';
    if (data === '[DONE]') return '';
    try {
      const obj = JSON.parse(data);
      const delta = obj && obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
      return typeof delta === 'string' ? delta : '';
    } catch (_e) {
      return '';
    }
  }
}
