// 存储后端抽象接口
// 所有具体后端（IndexedDB / File System Access / Remote）必须实现此接口。
// 默认实现：所有方法抛 NotSupportedError，子类必须 override。

/**
 * @abstract
 * Vault 数据存储抽象接口。
 * 所有方法返回 Promise，所有实体为 Core 层模型实例（Project/Chapter/...）。
 */
export class IStorageBackend {
  /** 后端名称（如 'indexeddb' / 'fsaccess'），用于诊断 */
  get name() {
    return 'abstract';
  }

  // ---------- 项目 ----------

  /** 列出所有项目 */
  async listProjects() {
    throw new NotSupportedError(`${this.name}: listProjects 未实现`);
  }

  /** 获取单个项目 */
  async getProject(_id) {
    throw new NotSupportedError(`${this.name}: getProject 未实现`);
  }

  /** 保存（创建或更新）项目 */
  async saveProject(_project) {
    throw new NotSupportedError(`${this.name}: saveProject 未实现`);
  }

  /** 删除项目（连带删除其下所有章节/伏笔等） */
  async deleteProject(_id) {
    throw new NotSupportedError(`${this.name}: deleteProject 未实现`);
  }

  // ---------- 章节 ----------

  /** 列出某项目下所有章节 */
  async listChapters(_projectId) {
    throw new NotSupportedError(`${this.name}: listChapters 未实现`);
  }

  /** 获取单章 */
  async getChapter(_projectId, _vol_no, _ch_no) {
    throw new NotSupportedError(`${this.name}: getChapter 未实现`);
  }

  /** 保存章节 */
  async saveChapter(_projectId, _chapter) {
    throw new NotSupportedError(`${this.name}: saveChapter 未实现`);
  }

  /** 删除章节 */
  async deleteChapter(_projectId, _vol_no, _ch_no) {
    throw new NotSupportedError(`${this.name}: deleteChapter 未实现`);
  }

  // ---------- 伏笔 ----------

  /** 列出某项目的所有伏笔 */
  async listHooks(_projectId) {
    throw new NotSupportedError(`${this.name}: listHooks 未实现`);
  }

  /** 保存伏笔 */
  async saveHook(_projectId, _hook) {
    throw new NotSupportedError(`${this.name}: saveHook 未实现`);
  }

  /** 删除伏笔 */
  async deleteHook(_projectId, _hook_id) {
    throw new NotSupportedError(`${this.name}: deleteHook 未实现`);
  }

  // ---------- 卷 ----------

  /** 列出某项目所有卷 */
  async listVolumes(_projectId) {
    throw new NotSupportedError(`${this.name}: listVolumes 未实现`);
  }

  /** 保存卷 */
  async saveVolume(_projectId, _volume) {
    throw new NotSupportedError(`${this.name}: saveVolume 未实现`);
  }

  // ---------- 角色 ----------

  /** 列出某项目所有角色 */
  async listCharacters(_projectId) {
    throw new NotSupportedError(`${this.name}: listCharacters 未实现`);
  }

  /** 保存角色 */
  async saveCharacter(_projectId, _character) {
    throw new NotSupportedError(`${this.name}: saveCharacter 未实现`);
  }

  /** 批量保存角色（原子事务） */
  async saveCharacters(_projectId, _characters) {
    // 默认降级：逐个调用单条 save；子类可 override 为原子事务
    if (!_characters || !_characters.length) return;
    for (const c of _characters) {
      await this.saveCharacter(_projectId, c);
    }
  }

  // ---------- 世界设定 ----------

  /** 列出某项目所有世界设定 */
  async listWorldSettings(_projectId) {
    throw new NotSupportedError(`${this.name}: listWorldSettings 未实现`);
  }

  /** 保存世界设定 */
  async saveWorldSetting(_projectId, _setting) {
    throw new NotSupportedError(`${this.name}: saveWorldSetting 未实现`);
  }

  /** 批量保存世界设定（原子事务；同 category 覆盖，不同 category 新增） */
  async saveWorldSettings(_projectId, _settings) {
    // 默认降级：逐个调用单条 save；子类可 override 为原子事务
    if (!_settings || !_settings.length) return;
    for (const s of _settings) {
      await this.saveWorldSetting(_projectId, s);
    }
  }

  // ---------- 设定百科 Encyclopedia ----------

  /** 列出某项目下所有设定百科词条（可按 type / tag 过滤，可选） */
  async listEncyclopediaEntries(_projectId, _filter = {}) {
    throw new NotSupportedError(`${this.name}: listEncyclopediaEntries 未实现`);
  }

  /** 获取单个设定百科词条 */
  async getEncyclopediaEntry(_projectId, _entryId) {
    throw new NotSupportedError(`${this.name}: getEncyclopediaEntry 未实现`);
  }

  /** 保存（创建或更新）设定百科词条 */
  async saveEncyclopediaEntry(_projectId, _entry) {
    throw new NotSupportedError(`${this.name}: saveEncyclopediaEntry 未实现`);
  }

  /** 批量保存设定百科词条（原子事务） */
  async saveEncyclopediaEntries(_projectId, _entries) {
    // 默认降级：逐个调用单条 save；子类可 override 为原子事务
    if (!_entries || !_entries.length) return;
    for (const e of _entries) {
      await this.saveEncyclopediaEntry(_projectId, e);
    }
  }

  /** 删除设定百科词条 */
  async deleteEncyclopediaEntry(_projectId, _entryId) {
    throw new NotSupportedError(`${this.name}: deleteEncyclopediaEntry 未实现`);
  }

  /**
   * 全文搜索设定百科：匹配 name / aliases / summary / content / tags，
   * 按命中权重排序（name 命中 > aliases 命中 > summary 命中 > content 命中）。
   * @param {string} projectId
   * @param {string} query  搜索关键词（可为空字符串时返回空数组）
   * @param {object} [filter]  可选 { type, tags:[], limit }
   * @returns {Promise<Array<{entry, score, hits:Array<{field,text}>}>>}
   */
  async searchEncyclopedia(_projectId, _query, _filter = {}) {
    throw new NotSupportedError(`${this.name}: searchEncyclopedia 未实现`);
  }

  // ---------- 导入导出 ----------

  /** 导出整个 Vault 为 ZIP Blob */
  async exportVault(_projectId) {
    throw new NotSupportedError(`${this.name}: exportVault 未实现`);
  }

  /** 从 ZIP Blob 导入 Vault，返回新项目 id */
  async importVault(_zipBlob) {
    throw new NotSupportedError(`${this.name}: importVault 未实现`);
  }
}

/** 不支持的操作错误（用于降级/未实现场景） */
export class NotSupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotSupportedError';
  }
}
