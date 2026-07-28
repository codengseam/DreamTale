import { describe, it, expect } from 'vitest';
import {
  VAULT_DIRS,
  CHAPTER_STATUS_DIR,
  normalizeVol,
  normalizeCh,
  joinPath,
  chapterPath,
  outlinePath,
  volOutlinePath,
  hooksPath,
  characterPath,
  worldSettingPath,
  statePath,
  characterStatePath,
  scenePath,
  recapPath,
  shortformPath,
  isValidVolNo,
  isValidChNo,
  isValidChapterStatus,
  isSafeVaultPath,
} from '../../src/core/vault-schema.js';

describe('VAULT_DIRS 常量', () => {
  it('包含 11 个目录常量，对齐 NovelForge_Vault 实际结构', () => {
    expect(VAULT_DIRS.CONTROL).toBe('00_控制面');
    expect(VAULT_DIRS.WORLD).toBe('01_世界观');
    expect(VAULT_DIRS.CHARACTERS).toBe('02_角色');
    expect(VAULT_DIRS.MATERIALS).toBe('03_素材库');
    expect(VAULT_DIRS.OUTLINE).toBe('04_大纲与脉络');
    expect(VAULT_DIRS.TEXT).toBe('05_正文');
    expect(VAULT_DIRS.SHORTFORM).toBe('06_短文');
    expect(VAULT_DIRS.AUDIT).toBe('06_审计');
    expect(VAULT_DIRS.RECAPS).toBe('_recaps');
    expect(VAULT_DIRS.SCENES).toBe('_scenes');
    expect(VAULT_DIRS.STATE).toBe('.state');
  });

  it('是冻结对象，不能修改', () => {
    expect(() => {
      VAULT_DIRS.CONTROL = 'changed';
    }).toThrow();
  });
});

describe('CHAPTER_STATUS_DIR', () => {
  it('draft → drafts', () => {
    expect(CHAPTER_STATUS_DIR.draft).toBe('drafts');
  });
  it('published → published', () => {
    expect(CHAPTER_STATUS_DIR.published).toBe('published');
  });
});

describe('normalizeVol / normalizeCh', () => {
  it('数字补零', () => {
    expect(normalizeVol(1)).toBe('01');
    expect(normalizeCh(1)).toBe('001');
  });
  it('字符串数字补零', () => {
    expect(normalizeVol('3')).toBe('03');
    expect(normalizeCh('42')).toBe('042');
  });
  it('兼容 vol_NN 格式', () => {
    expect(normalizeVol('vol_01')).toBe('01');
    expect(normalizeVol('vol_12')).toBe('12');
  });
  it('兼容 ch_NNN 格式', () => {
    expect(normalizeCh('ch_001')).toBe('001');
    expect(normalizeCh('ch_042')).toBe('042');
  });
  it('非数字字符串原样返回（无法解析）', () => {
    expect(normalizeVol('abc')).toBe('abc');
    expect(normalizeCh('abc')).toBe('abc');
    expect(normalizeVol('卷一')).toBe('卷一');
    expect(normalizeCh('楔子')).toBe('楔子');
  });
  it('null/undefined 视为空字符串原样返回', () => {
    expect(normalizeVol(null)).toBe('');
    expect(normalizeCh(undefined)).toBe('');
  });
});

describe('joinPath', () => {
  it('拼接多段路径', () => {
    expect(joinPath('a', 'b', 'c')).toBe('a/b/c');
  });
  it('合并重复斜杠', () => {
    expect(joinPath('a/', '/b')).toBe('a/b');
  });
  it('反斜杠转正斜杠', () => {
    expect(joinPath('a\\b', 'c')).toBe('a/b/c');
  });
  it('去除末尾斜杠', () => {
    expect(joinPath('a', 'b/')).toBe('a/b');
  });
});

describe('chapterPath', () => {
  it('draft 状态路径', () => {
    expect(chapterPath(1, 1, 'draft')).toBe('05_正文/drafts/vol_01/ch_001.md');
  });
  it('published 状态路径', () => {
    expect(chapterPath(1, 1, 'published')).toBe('05_正文/published/vol_01/ch_001.md');
  });
  it('默认状态为 draft', () => {
    expect(chapterPath(2, 15)).toBe('05_正文/drafts/vol_02/ch_015.md');
  });
  it('接受字符串 vol_no/ch_no', () => {
    expect(chapterPath('vol_03', 'ch_042', 'published')).toBe(
      '05_正文/published/vol_03/ch_042.md'
    );
  });
  it('未知 status 降级到 drafts', () => {
    expect(chapterPath(1, 1, 'unknown')).toBe('05_正文/drafts/vol_01/ch_001.md');
  });
});

describe('outlinePath', () => {
  it('生成章纲路径', () => {
    expect(outlinePath(1, 1)).toBe('04_大纲与脉络/vol_01/ch_001_outline.md');
  });
  it('多卷多章', () => {
    expect(outlinePath(3, 42)).toBe('04_大纲与脉络/vol_03/ch_042_outline.md');
  });
});

describe('volOutlinePath', () => {
  it('生成卷大纲路径', () => {
    expect(volOutlinePath(1)).toBe('04_大纲与脉络/vol_01/vol_outline.md');
  });
});

describe('hooksPath', () => {
  it('生成伏笔注册表路径', () => {
    expect(hooksPath()).toBe('04_大纲与脉络/hooks_registry.json');
  });
});

describe('characterPath', () => {
  it('生成角色路径', () => {
    expect(characterPath('主角')).toBe('02_角色/主角.md');
  });
  it('英文名也支持', () => {
    expect(characterPath('protagonist')).toBe('02_角色/protagonist.md');
  });
});

describe('worldSettingPath', () => {
  it('生成世界设定路径', () => {
    expect(worldSettingPath('core_rules')).toBe('01_世界观/core_rules.md');
  });
});

describe('statePath / characterStatePath', () => {
  it('statePath 拼接 .state', () => {
    expect(statePath('pipeline.json')).toBe('.state/pipeline.json');
  });
  it('characterStatePath 生成角色状态机路径', () => {
    expect(characterStatePath('protagonist')).toBe('.state/characters/protagonist.json');
  });
});

describe('scenePath', () => {
  it('生成关键场景路径', () => {
    expect(scenePath(1, '主角', '觉醒')).toBe('_scenes/ch_001_主角_觉醒.md');
  });
});

describe('recapPath', () => {
  it('生成前情提要路径', () => {
    expect(recapPath(10)).toBe('_recaps/recap_ch_010.md');
  });
});

describe('shortformPath', () => {
  it('生成短文 draft 路径（带日期）', () => {
    expect(shortformPath('my-post', 'draft', '2026-07-28')).toBe(
      '06_短文/drafts/2026-07-28-my-post.md'
    );
  });
  it('生成短文 published 路径（不带日期）', () => {
    expect(shortformPath('my-post', 'published')).toBe('06_短文/published/my-post.md');
  });
  it('无效 status 回退为 drafts', () => {
    expect(shortformPath('my-post', 'unknown-status')).toBe('06_短文/drafts/my-post.md');
  });
});

describe('校验函数', () => {
  it('isValidVolNo: 1-99 合法', () => {
    expect(isValidVolNo(1)).toBe(true);
    expect(isValidVolNo(99)).toBe(true);
    expect(isValidVolNo(0)).toBe(false);
    expect(isValidVolNo(100)).toBe(false);
    expect(isValidVolNo('5')).toBe(true);
    expect(isValidVolNo('abc')).toBe(false);
  });

  it('isValidChNo: 1-9999 合法', () => {
    expect(isValidChNo(1)).toBe(true);
    expect(isValidChNo(9999)).toBe(true);
    expect(isValidChNo(0)).toBe(false);
    expect(isValidChNo(10000)).toBe(false);
  });

  it('isValidChNo: 接受字符串数字', () => {
    expect(isValidChNo('5')).toBe(true);
    expect(isValidChNo('42')).toBe(true);
    expect(isValidChNo('abc')).toBe(false);
    expect(isValidChNo('0')).toBe(false);
  });

  it('isValidChapterStatus', () => {
    expect(isValidChapterStatus('draft')).toBe(true);
    expect(isValidChapterStatus('published')).toBe(true);
    expect(isValidChapterStatus('archived')).toBe(false);
  });

  it('isSafeVaultPath: 拒绝绝对路径', () => {
    expect(isSafeVaultPath('/etc/passwd')).toBe(false);
    expect(isSafeVaultPath('\\windows\\sys')).toBe(false);
  });

  it('isSafeVaultPath: 拒绝 .. 路径穿越', () => {
    expect(isSafeVaultPath('../etc/passwd')).toBe(false);
    expect(isSafeVaultPath('a/../../../etc')).toBe(false);
    expect(isSafeVaultPath('a/../b')).toBe(false); // 包含 .. 段
  });

  it('isSafeVaultPath: 接受合法相对路径', () => {
    expect(isSafeVaultPath('05_正文/drafts/vol_01/ch_001.md')).toBe(true);
    expect(isSafeVaultPath('.state/characters/protagonist.json')).toBe(true);
  });

  it('isSafeVaultPath: 拒绝空字符串与非字符串', () => {
    expect(isSafeVaultPath('')).toBe(false);
    expect(isSafeVaultPath(null)).toBe(false);
    expect(isSafeVaultPath(undefined)).toBe(false);
  });

  it('isSafeVaultPath: 包含 ab..cd 不算 .. 段（避免误判）', () => {
    expect(isSafeVaultPath('a/ab..cd/b.md')).toBe(true);
  });
});
