// 存储后端工厂
// 运行时检测：showDirectoryPicker 可用 → 返回 FSAccessBackend（用户随后需 pickRoot 选择目录）
// 默认返回 IndexedDBBackend（无需用户交互）

import { IndexedDBBackend } from './indexeddb-backend.js';
import { FSAccessBackend, isFSAccessAvailable } from './fsaccess-backend.js';
import { IStorageBackend } from './interface.js';

/**
 * 创建存储后端。
 * @param {object} [opts]
 * @param {'auto'|'indexeddb'|'fsaccess'} [opts.prefer] - 偏好；auto 时优先用 FSAccess（若可用）
 * @param {FileSystemDirectoryHandle} [opts.rootDirHandle] - 注入根目录句柄（测试用）
 * @returns {Promise<IStorageBackend>}
 */
export async function createStorage(opts = {}) {
  const prefer = opts.prefer || 'auto';

  if (prefer === 'indexeddb') {
    return new IndexedDBBackend();
  }

  if (prefer === 'fsaccess') {
    // 即使可用，也允许注入 rootDirHandle（用于测试）
    return new FSAccessBackend(opts.rootDirHandle);
  }

  // auto：默认 IndexedDB（FSAccess 需要 picker 交互，延迟到用户主动操作时再用）
  return new IndexedDBBackend();
}

/**
 * 检测当前环境是否支持 FSAccess 后端。
 * UI 层可用此判断是否展示「打开本地 Vault 文件夹」按钮。
 */
export function canUseFSAccess() {
  return isFSAccessAvailable();
}

/**
 * 创建 FSAccess 后端并让用户选择 Vault 根目录。
 * 调用前应已用 canUseFSAccess() 判断。
 * @returns {Promise<FSAccessBackend>}
 */
export async function createFSAccessWithPicker() {
  const backend = new FSAccessBackend();
  await backend.pickRoot();
  return backend;
}

export { IStorageBackend };
