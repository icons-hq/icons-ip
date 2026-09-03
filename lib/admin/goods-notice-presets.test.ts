import { describe, expect, it } from 'vitest';
import {
  goodsNoticeValuesFromForm,
  isGoodsNoticeComplete,
  parseGoodsNoticePresets,
  removeGoodsNoticePreset,
  serializeGoodsNoticePresets,
  upsertGoodsNoticePreset,
} from './goods-notice-presets';

const values = {
  noticeMaker: '주식회사 아이콘스',
  noticeOrigin: '대한민국',
  noticeMaterial: '아크릴',
  noticeSize: '80 x 60 x 20mm · 90g',
  noticeMadeOn: '2026-07',
  noticeAsManager: '아이콘스 고객센터',
  noticeAsContact: '02-000-0000',
};

describe('goods notice presets', () => {
  it('parses only well-formed presets, dedupes names, trims, and drops unknown keys', () => {
    const raw = JSON.stringify([
      { name: '  아이콘스 기본  ', values: { ...values, extra: 'x', noticeMaker: ' 주식회사 아이콘스 ' } },
      { name: '아이콘스 기본', values },
      { name: '', values },
      { name: '값 없음' },
      'garbage',
      { name: '부분', values: { noticeMaker: '수입사', noticeOrigin: 42 } },
    ]);

    const presets = parseGoodsNoticePresets(raw);

    expect(presets.map((preset) => preset.name)).toEqual(['아이콘스 기본', '부분']);
    expect(presets[0].values).toEqual(values);
    expect(presets[1].values).toEqual({ ...Object.fromEntries(Object.keys(values).map((key) => [key, ''])), noticeMaker: '수입사' });
    expect(parseGoodsNoticePresets('')).toEqual([]);
    expect(parseGoodsNoticePresets('{not json')).toEqual([]);
    expect(parseGoodsNoticePresets('{"name":"obj"}')).toEqual([]);
  });

  it('upserts by name, keeps the newest at the end, removes by name, and round-trips through JSON', () => {
    const one = upsertGoodsNoticePreset([], ' 아이콘스 기본 ', values);
    const two = upsertGoodsNoticePreset(one, '수입 굿즈', { ...values, noticeOrigin: '일본' });
    const replaced = upsertGoodsNoticePreset(two, '아이콘스 기본', { ...values, noticeAsContact: '02-111-1111' });

    expect(two.map((preset) => preset.name)).toEqual(['아이콘스 기본', '수입 굿즈']);
    expect(replaced.map((preset) => preset.name)).toEqual(['수입 굿즈', '아이콘스 기본']);
    expect(replaced[1].values.noticeAsContact).toBe('02-111-1111');
    expect(upsertGoodsNoticePreset(two, '   ', values)).toEqual(two);
    expect(removeGoodsNoticePreset(replaced, '수입 굿즈').map((preset) => preset.name)).toEqual(['아이콘스 기본']);
    expect(parseGoodsNoticePresets(serializeGoodsNoticePresets(replaced))).toEqual(replaced);
  });

  it('caps the list at twenty presets by dropping the oldest', () => {
    let presets = [] as ReturnType<typeof upsertGoodsNoticePreset>;
    for (let index = 0; index < 22; index += 1) {
      presets = upsertGoodsNoticePreset(presets, `프리셋 ${index}`, values);
    }

    expect(presets).toHaveLength(20);
    expect(presets[0].name).toBe('프리셋 2');
    expect(presets[19].name).toBe('프리셋 21');
  });

  it('reads the seven notice values from a form and reports completeness', () => {
    const formData = new FormData();
    formData.set('id', 'g100');
    for (const [key, value] of Object.entries(values)) formData.set(key, ` ${value} `);
    formData.set('noticeAsContact', '  ');

    const read = goodsNoticeValuesFromForm(formData);

    expect(read).toEqual({ ...values, noticeAsContact: '' });
    expect(read).not.toHaveProperty('id');
    expect(isGoodsNoticeComplete(read)).toBe(false);
    expect(isGoodsNoticeComplete(values)).toBe(true);
  });
});
