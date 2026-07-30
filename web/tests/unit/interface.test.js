// IStorageBackend 抽象接口默认实现测试
// 验证所有未 override 的方法默认抛 NotSupportedError，
// 且错误信息包含后端名称与方法名，便于诊断。

import { describe, it, expect } from 'vitest';
import { IStorageBackend, NotSupportedError } from '../../src/storage/interface.js';

// ---------- NotSupportedError ----------

describe('NotSupportedError', () => {
  it('是 Error 子类', () => {
    const e = new NotSupportedError('xxx');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(NotSupportedError);
  });

  it('name 属性为 NotSupportedError', () => {
    const e = new NotSupportedError('不支持的操作');
    expect(e.name).toBe('NotSupportedError');
    expect(e.message).toBe('不支持的操作');
  });
});

// ---------- IStorageBackend 默认实现 ----------

describe('IStorageBackend 默认实现', () => {
  it('name getter 返回 abstract', () => {
    const backend = new IStorageBackend();
    expect(backend.name).toBe('abstract');
  });

  // 列出所有应抛 NotSupportedError 的方法及其调用参数（最小合法参数）
  const cases = [
    { name: 'listProjects', args: [], method: 'listProjects' },
    { name: 'getProject', args: ['p1'], method: 'getProject' },
    { name: 'saveProject', args: [{}], method: 'saveProject' },
    { name: 'deleteProject', args: ['p1'], method: 'deleteProject' },
    { name: 'listChapters', args: ['p1'], method: 'listChapters' },
    { name: 'getChapter', args: ['p1', 1, 1], method: 'getChapter' },
    { name: 'saveChapter', args: ['p1', {}], method: 'saveChapter' },
    { name: 'deleteChapter', args: ['p1', 1, 1], method: 'deleteChapter' },
    { name: 'listHooks', args: ['p1'], method: 'listHooks' },
    { name: 'saveHook', args: ['p1', {}], method: 'saveHook' },
    { name: 'deleteHook', args: ['p1', 'H-001'], method: 'deleteHook' },
    { name: 'listVolumes', args: ['p1'], method: 'listVolumes' },
    { name: 'saveVolume', args: ['p1', {}], method: 'saveVolume' },
    { name: 'listCharacters', args: ['p1'], method: 'listCharacters' },
    { name: 'saveCharacter', args: ['p1', {}], method: 'saveCharacter' },
    { name: 'listWorldSettings', args: ['p1'], method: 'listWorldSettings' },
    { name: 'saveWorldSetting', args: ['p1', {}], method: 'saveWorldSetting' },
    { name: 'exportVault', args: ['p1'], method: 'exportVault' },
    { name: 'importVault', args: [new Blob(['x'])], method: 'importVault' },
  ];

  for (const c of cases) {
    it(`${c.name} 默认抛 NotSupportedError，含方法名`, async () => {
      const backend = new IStorageBackend();
      await expect(backend[c.name](...c.args)).rejects.toBeInstanceOf(NotSupportedError);
      try {
        await backend[c.name](...c.args);
        throw new Error('should not reach');
      } catch (e) {
        expect(e.message).toContain(c.method);
        expect(e.message).toContain('abstract');
      }
    });
  }

  it('共 19 个抽象方法（防止漏测新增方法）', () => {
    // 统计 IStorageBackend 原型上的 async 方法数量
    const proto = IStorageBackend.prototype;
    const methods = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== 'constructor' && typeof proto[n] === 'function'
    );
    // name 是 getter（在实例上），不计入原型方法
    expect(methods.length).toBe(19);
  });
});

// ---------- 子类继承：未 override 的方法仍抛错 ----------

describe('IStorageBackend 子类部分 override', () => {
  it('未 override 的方法继承默认抛错行为', async () => {
    class PartialBackend extends IStorageBackend {
      get name() {
        return 'partial';
      }
      async listProjects() {
        return [];
      }
    }
    const b = new PartialBackend();
    expect(await b.listProjects()).toEqual([]);
    // 未 override 的方法仍应抛错，且错误信息用子类的 name
    await expect(b.getProject('p1')).rejects.toBeInstanceOf(NotSupportedError);
    try {
      await b.getProject('p1');
    } catch (e) {
      expect(e.message).toContain('partial');
      expect(e.message).toContain('getProject');
    }
  });
});
