import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStorage, canUseFSAccess, createFSAccessWithPicker } from '../../src/storage/factory.js';
import { IndexedDBBackend } from '../../src/storage/indexeddb-backend.js';
import { FSAccessBackend } from '../../src/storage/fsaccess-backend.js';
import { IStorageBackend } from '../../src/storage/interface.js';

describe('canUseFSAccess', () => {
  it('在 jsdom 中默认返回 false', () => {
    expect(canUseFSAccess()).toBe(false);
  });

  it('注入 showDirectoryPicker 后返回 true', () => {
    globalThis.showDirectoryPicker = async () => ({});
    expect(canUseFSAccess()).toBe(true);
    delete globalThis.showDirectoryPicker;
  });
});

describe('createStorage', () => {
  it('默认返回 IndexedDBBackend', async () => {
    const backend = await createStorage();
    expect(backend).toBeInstanceOf(IndexedDBBackend);
    expect(backend.name).toBe('indexeddb');
  });

  it('prefer=indexeddb 返回 IndexedDBBackend', async () => {
    const backend = await createStorage({ prefer: 'indexeddb' });
    expect(backend).toBeInstanceOf(IndexedDBBackend);
  });

  it('prefer=fsaccess 且注入 rootDirHandle 时返回 FSAccessBackend', async () => {
    const fakeRoot = { kind: 'directory', name: '', _children: new Map() };
    const backend = await createStorage({
      prefer: 'fsaccess',
      rootDirHandle: fakeRoot,
    });
    expect(backend).toBeInstanceOf(FSAccessBackend);
  });

  it('返回的对象实现 IStorageBackend 接口', async () => {
    const backend = await createStorage();
    expect(backend).toBeInstanceOf(IStorageBackend);
  });
});

describe('createFSAccessWithPicker', () => {
  beforeEach(() => {
    delete globalThis.showDirectoryPicker;
  });
  afterEach(() => {
    delete globalThis.showDirectoryPicker;
  });

  it('不支持时抛 NotSupportedError', async () => {
    await expect(createFSAccessWithPicker()).rejects.toThrow(/不支持/);
  });

  it('支持时返回已 pickRoot 的 FSAccessBackend', async () => {
    const fakeRoot = { kind: 'directory' };
    globalThis.showDirectoryPicker = async () => fakeRoot;
    const backend = await createFSAccessWithPicker();
    expect(backend).toBeInstanceOf(FSAccessBackend);
  });
});
