import { describe, expect, it } from 'vitest';
import {
  EMPTY_GOODS_NOTICE,
  GOODS_NOTICE_FIELDS,
  goodsNoticeRows,
  missingGoodsNoticeKeys,
  type GoodsNoticeInfo,
} from './goods-notice';

const filled: GoodsNoticeInfo = {
  maker: '주식회사 아이콘스',
  origin: '대한민국',
  material: '아크릴',
  size: '80 x 60 x 20mm · 90g',
  madeOn: '2026-07',
  asManager: '아이콘스 고객센터',
  asContact: '02-000-0000',
};

describe('굿즈 고시정보', () => {
  it('폼 이름과 라벨을 한 곳에서 정의한다', () => {
    expect(GOODS_NOTICE_FIELDS.map((field) => field.key)).toEqual([
      'maker',
      'origin',
      'material',
      'size',
      'madeOn',
      'asManager',
      'asContact',
    ]);
    expect(GOODS_NOTICE_FIELDS.every((field) => field.formName && field.label)).toBe(true);
    expect(new Set(GOODS_NOTICE_FIELDS.map((field) => field.formName)).size)
      .toBe(GOODS_NOTICE_FIELDS.length);
  });

  it('빈 항목을 전부 집어낸다', () => {
    expect(missingGoodsNoticeKeys(filled)).toEqual([]);
    expect(missingGoodsNoticeKeys(EMPTY_GOODS_NOTICE))
      .toEqual(GOODS_NOTICE_FIELDS.map((field) => field.key));
    expect(missingGoodsNoticeKeys({ ...filled, origin: '   ' })).toEqual(['origin']);
  });

  it('표시용 행은 채워진 항목만 필드 순서대로 낸다', () => {
    expect(goodsNoticeRows(filled)).toHaveLength(GOODS_NOTICE_FIELDS.length);
    expect(goodsNoticeRows(filled)[0]).toEqual({
      key: 'maker',
      label: '제조사 / 수입사',
      value: '주식회사 아이콘스',
    });
    expect(goodsNoticeRows({ ...EMPTY_GOODS_NOTICE, origin: '대한민국' })).toEqual([
      { key: 'origin', label: '원산지', value: '대한민국' },
    ]);
  });
});
