import { describe, it, expect } from 'vitest';
import {
  optimizeNovelFormat,
  matchKeywords,
  countWords,
  atSuggest,
  renderAtSyntax,
} from '../../src/core/format-utils.js';

describe('optimizeNovelFormat', () => {
  it('普通段落添加全角两空格缩进', () => {
    const input = '沈砚站在山门前，望着青云宗的方向。\n他深吸一口气，踏上了石阶。';
    const output = optimizeNovelFormat(input);
    expect(output).toContain('　　沈砚站在山门前');
    expect(output).toContain('　　他深吸一口气');
  });

  it('合并连续3个以上空行为2个', () => {
    const input = '第一段\n\n\n\n\n第二段';
    const output = optimizeNovelFormat(input);
    const emptyLines = output.split('\n').filter((l) => l.trim() === '').length;
    expect(emptyLines).toBe(2);
  });

  it('中文标点半角转全角', () => {
    const input = '你好,世界!这是测试?是的;没错:好的(哈哈)';
    const output = optimizeNovelFormat(input);
    expect(output).toContain('，');
    expect(output).toContain('！');
    expect(output).toContain('？');
    expect(output).toContain('；');
    expect(output).toContain('：');
    expect(output).toContain('（');
    expect(output).toContain('）');
  });

  it('标题、列表、引用、代码块不添加缩进', () => {
    const input = '# 第一章\n- 列表项\n> 引用内容\n```\ncode\n```';
    const output = optimizeNovelFormat(input);
    expect(output).toContain('# 第一章');
    expect(output).toContain('- 列表项');
    expect(output).toContain('> 引用内容');
    expect(output).toContain('```');
    expect(output).not.toContain('　　#');
  });

  it('对话段落独立成段（前插入空行）', () => {
    const input = '沈砚走了过来。\n「你终于来了。」老者说道。';
    const output = optimizeNovelFormat(input);
    expect(output).toContain('\n\n　　「你终于来了');
  });

  it('空字符串和非字符串输入返回空', () => {
    expect(optimizeNovelFormat('')).toBe('');
    expect(optimizeNovelFormat(null)).toBe('');
    expect(optimizeNovelFormat(undefined)).toBe('');
  });
});

describe('matchKeywords', () => {
  it('匹配出现的关键词并按出现顺序返回', () => {
    const text = '沈砚来到青云宗，手持残剑问渊，施展问渊九式。';
    const vocab = {
      roles: ['沈砚', '老者'],
      places: ['青云宗', '天魔殿'],
      items: ['残剑问渊', '丹药'],
      arts: ['问渊九式', '基础剑法'],
    };
    const result = matchKeywords(text, vocab);
    expect(result.roles).toEqual(['沈砚']);
    expect(result.places).toEqual(['青云宗']);
    expect(result.items).toEqual(['残剑问渊']);
    expect(result.arts).toEqual(['问渊九式']);
  });

  it('未出现的关键词不返回，出现顺序正确', () => {
    const text = '在青云宗，沈砚遇到了老者，老者给了他丹药。';
    const vocab = {
      roles: ['老者', '沈砚'],
      places: ['青云宗'],
      items: ['丹药'],
      arts: [],
    };
    const result = matchKeywords(text, vocab);
    expect(result.places).toEqual(['青云宗']);
    expect(result.roles).toEqual(['沈砚', '老者']);
    expect(result.items).toEqual(['丹药']);
    expect(result.arts).toEqual([]);
  });

  it('空文本或空词库返回空数组', () => {
    expect(matchKeywords('', { roles: ['a'] })).toEqual({
      roles: [],
      places: [],
      items: [],
      arts: [],
    });
    expect(matchKeywords('test', null)).toEqual({
      roles: [],
      places: [],
      items: [],
      arts: [],
    });
  });

  it('重复关键词只返回一次（去重）', () => {
    const text = '沈砚沈砚，沈砚又来了。';
    const vocab = { roles: ['沈砚'], places: [], items: [], arts: [] };
    const result = matchKeywords(text, vocab);
    expect(result.roles).toEqual(['沈砚']);
  });
});

describe('countWords', () => {
  it('统计纯中文文本', () => {
    const result = countWords('沈砚站在山门前');
    expect(result.cn).toBe(7);
    expect(result.en).toBe(0);
    expect(result.digits).toBe(0);
    expect(result.total).toBe(7);
  });

  it('统计混合文本（中文+英文+数字）', () => {
    const result = countWords('沈砚修炼了AskDao剑法3次，耗时123天。');
    expect(result.cn).toBeGreaterThan(0);
    expect(result.en).toBe(1);
    expect(result.digits).toBe(2);
    expect(result.total).toBe(result.cn + result.en + result.digits);
  });

  it('空文本返回全零', () => {
    const result = countWords('');
    expect(result).toEqual({ total: 0, cn: 0, en: 0, digits: 0 });
  });

  it('多个英文单词和数字块分别计数', () => {
    const result = countWords('hello world test 123 456 789');
    expect(result.en).toBe(3);
    expect(result.digits).toBe(3);
    expect(result.total).toBe(6);
  });
});

describe('atSuggest', () => {
  const vocab = {
    roles: [
      { id: 'shenyan', name: '沈砚', brief: '本书主角，剑修' },
      { id: 'laozhe', name: '老者', brief: '宗门执法长老' },
    ],
    places: [
      { id: 'qingyun', name: '青云宗', brief: '正道七大宗门之一' },
      { id: 'tianmo', name: '天魔殿', brief: '魔道宗门' },
    ],
    items: [
      { id: 'canjian', name: '残剑问渊', brief: '沈砚的佩剑' },
    ],
    arts: [
      { id: 'wenyuan', name: '问渊九式', brief: '沈砚的核心功法' },
    ],
  };

  it('按名字模糊匹配', () => {
    const result = atSuggest('沈', vocab);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('沈砚');
    expect(result[0].type).toBe('角色');
  });

  it('按简介模糊匹配，前10条', () => {
    const result = atSuggest('剑', vocab);
    expect(result.some((r) => r.name === '沈砚')).toBe(true);
    expect(result.some((r) => r.name === '残剑问渊')).toBe(true);
  });

  it('空查询或无匹配返回空数组', () => {
    expect(atSuggest('', vocab)).toEqual([]);
    expect(atSuggest('不存在的词', vocab)).toEqual([]);
    expect(atSuggest('沈', null)).toEqual([]);
  });

  it('返回结构包含 type, id, name, brief', () => {
    const result = atSuggest('青云宗', vocab);
    expect(result.length).toBe(1);
    expect(result[0]).toHaveProperty('type', '地点');
    expect(result[0]).toHaveProperty('id', 'qingyun');
    expect(result[0]).toHaveProperty('name', '青云宗');
    expect(result[0]).toHaveProperty('brief');
  });
});

describe('renderAtSyntax', () => {
  it('渲染角色、地点、功法、物品四种语法', () => {
    const input = '[[角色:沈砚]]来到[[地点:青云宗]]，施展[[功法:问渊九式]]，手持[[物品:残剑问渊]]。';
    const output = renderAtSyntax(input);
    expect(output).toContain('<span class="ws-at ws-at-role" data-type="角色" data-id="沈砚">沈砚</span>');
    expect(output).toContain('<span class="ws-at ws-at-place" data-type="地点" data-id="青云宗">青云宗</span>');
    expect(output).toContain('<span class="ws-at ws-at-art" data-type="功法" data-id="问渊九式">问渊九式</span>');
    expect(output).toContain('<span class="ws-at ws-at-item" data-type="物品" data-id="残剑问渊">残剑问渊</span>');
  });

  it('无语法时不改变原文', () => {
    const input = '沈砚来到青云宗。';
    expect(renderAtSyntax(input)).toBe(input);
  });

  it('空字符串和非字符串输入返回空', () => {
    expect(renderAtSyntax('')).toBe('');
    expect(renderAtSyntax(null)).toBe('');
    expect(renderAtSyntax(undefined)).toBe('');
  });

  it('多个相同语法渲染不冲突', () => {
    const input = '[[角色:沈砚]]和[[角色:老者]]在[[地点:青云宗]]见面。';
    const output = renderAtSyntax(input);
    const matches = output.match(/ws-at-role/g) || [];
    expect(matches.length).toBe(2);
  });
});
