// 验证 scripts/dreamtale/seed_to_vault.py 生成的 seed-vault.zip / blank-vault.zip
// 能被 web/src/storage/zip-utils.js 的 importVaultFromZip 成功解析。
//
// 这些 ZIP 由 Python 端用 zipfile.ZIP_STORED 写入，必须与 JS 端 buildZip/parseZip
// 字节级兼容。本测试是「跨语言契约」的回归保障。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importVaultFromZip, parseZip } from '../../src/storage/zip-utils.js';

const ASSETS_DIR = resolve(process.cwd(), 'static', 'assets');

function readZipAsBlob(filename) {
  const buf = readFileSync(resolve(ASSETS_DIR, filename));
  // 注意：必须用 Uint8Array 视图，避免 shared ArrayBuffer 的 detach 问题。
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Blob([bytes], { type: 'application/zip' });
}

// ---------- seed-vault.zip（问剑长歌 Demo） ----------

describe('seed-vault.zip（Python 生成的 Demo ZIP）', () => {
  it('ZIP 内条目数与 manifest 一致', () => {
    const blob = readZipAsBlob('seed-vault.zip');
    // Blob.arrayBuffer() 在 node 24 可用
    return blob.arrayBuffer().then((ab) => {
      const bytes = new Uint8Array(ab);
      const files = parseZip(bytes);
      expect(files.length).toBeGreaterThan(0);
      const paths = files.map((f) => f.path);
      // manifest.json 必须存在
      expect(paths).toContain('manifest.json');
      // 项目元数据
      expect(paths).toContain('00_控制面/project.json');
      // 伏笔登记表
      expect(paths).toContain('04_大纲与脉络/hooks_registry.json');
      // 至少 1 个角色
      expect(paths.some((p) => p.startsWith('02_角色/'))).toBe(true);
      // 至少 1 个世界设定
      expect(paths.some((p) => p.startsWith('01_世界观/'))).toBe(true);
      // 至少 1 个已发布章节
      expect(paths.some((p) => p.startsWith('05_正文/published/'))).toBe(true);
    });
  });

  it('能被 importVaultFromZip 解析并还原项目元信息', async () => {
    const blob = readZipAsBlob('seed-vault.zip');
    const imported = await importVaultFromZip(blob);

    expect(imported.project).not.toBeNull();
    expect(imported.project.id).toBe('wenjian-changge');
    expect(imported.project.name).toBe('问剑长歌');
    expect(imported.project.genre).toContain('玄幻');
    // 字数应被解析为整数（脚本中做了 re.sub("[^d]", "") 处理）
    expect(typeof imported.project.target_words).toBe('number');
    expect(imported.project.target_words).toBe(1200000);
    expect(imported.project.current_words).toBe(268400);
    expect(imported.project.chapters_total).toBe(220);
    expect(imported.project.volumes_total).toBe(5);
  });

  it('还原的伏笔数量与 schema 一致（7 条）', async () => {
    const blob = readZipAsBlob('seed-vault.zip');
    const imported = await importVaultFromZip(blob);
    expect(imported.hooks.length).toBe(7);

    // 抽样校验第一条伏笔的关键字段
    const h1 = imported.hooks.find((h) => h.hook_id === 'H-001');
    expect(h1).toBeDefined();
    expect(h1.description).toContain('问渊');
    // 状态从 "已回收" 映射为 "resolved"
    expect(h1.status).toBe('resolved');
    // scope 从 P0 映射为 core
    expect(h1.scope).toBe('core');
    expect(h1.priority).toBe('high');
    expect(h1.strength).toBe('strong');
  });

  it('还原的角色包含沈砚等 6 个角色', async () => {
    const blob = readZipAsBlob('seed-vault.zip');
    const imported = await importVaultFromZip(blob);
    expect(imported.characters.length).toBe(6);

    const names = imported.characters.map((c) => c.name).sort();
    expect(names).toEqual(
      ['剑尊·问渊', '沈砚', '海族·赤蛟王', '裴矩', '阿箩', '云栖'].sort()
    );

    // 抽样校验主角
    const protagonist = imported.characters.find((c) => c.name === '沈砚');
    expect(protagonist.role).toBe('主角');
    expect(protagonist.identity).toContain('青云宗');
    expect(protagonist.level).toBe('筑基后期');
  });

  it('还原的卷数据为 3 卷', async () => {
    const blob = readZipAsBlob('seed-vault.zip');
    const imported = await importVaultFromZip(blob);
    expect(imported.volumes.length).toBe(3);
    // vol_no 应分别为 "01"、"02"、"03"
    const volNos = imported.volumes.map((v) => v.vol_no).sort();
    expect(volNos).toEqual(['01', '02', '03']);
  });

  it('还原的世界设定为 4 类', async () => {
    const blob = readZipAsBlob('seed-vault.zip');
    const imported = await importVaultFromZip(blob);
    expect(imported.worldSettings.length).toBe(4);
    const categories = imported.worldSettings.map((w) => w.category).sort();
    expect(categories).toEqual(
      ['core_rules', 'factions', 'geography', 'items_and_concepts'].sort()
    );
  });

  it('还原的章节含已发布章节', async () => {
    const blob = readZipAsBlob('seed-vault.zip');
    const imported = await importVaultFromZip(blob);
    expect(imported.chapters.length).toBe(6);
    // 第 40 章应存在
    const ch40 = imported.chapters.find((c) => c.ch_no === '040');
    expect(ch40).toBeDefined();
    expect(ch40.title).toBe('寒江尽头');
    expect(ch40.summary).toContain('残剑');
  });
});

// ---------- blank-vault.zip（空白项目模板） ----------

describe('blank-vault.zip（空白项目模板）', () => {
  it('能被 importVaultFromZip 解析', async () => {
    const blob = readZipAsBlob('blank-vault.zip');
    const imported = await importVaultFromZip(blob);
    expect(imported.project).not.toBeNull();
    expect(imported.project.id).toBe('blank-project');
    expect(imported.project.name).toBe('新建项目');
    expect(imported.project.target_words).toBe(0);
  });

  it('空白模板的伏笔/章节/卷均为空数组', async () => {
    const blob = readZipAsBlob('blank-vault.zip');
    const imported = await importVaultFromZip(blob);
    expect(imported.hooks).toEqual([]);
    expect(imported.chapters).toEqual([]);
    expect(imported.volumes).toEqual([]);
  });

  it('空白模板仍含 1 个主角占位 + 4 类世界设定空模板', async () => {
    const blob = readZipAsBlob('blank-vault.zip');
    const imported = await importVaultFromZip(blob);
    expect(imported.characters.length).toBe(1);
    expect(imported.characters[0].name).toBe('主角');
    expect(imported.worldSettings.length).toBe(4);
  });
});
