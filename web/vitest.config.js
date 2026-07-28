import { defineConfig } from 'vitest/config';

// Vitest 配置：
// - core 层测试用 node 环境（无 DOM 依赖）
// - storage 层测试用 jsdom 环境（fake-indexeddb + jsdom 提供所需全局）
// - 覆盖率门槛：Core/Storage/Extension 维持 ≥ 90%；AI 适配层（含网络/IDE 占位）目标 ≥ 85%，
//   合并后整体门槛降至 85% 以兼容 AI 适配层
export default defineConfig({
  test: {
    globals: true,
    // 统一用 node 环境：node 24 原生提供 Blob / TextEncoder / TextDecoder / File，
    // fake-indexeddb 通过 setup.js 注入到 globalThis.indexedDB。
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/core/**/*.js',
        'src/storage/**/*.js',
        'src/extension/**/*.js',
        'src/ai/**/*.js',
        'src/modules/**/*.js',
        'src/audit/**/*.js',
      ],
      // 阶段3 modules / 阶段5 audit 为并行新增模块，整体门槛维持 85%
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
    setupFiles: ['tests/setup.js'],
  },
});
