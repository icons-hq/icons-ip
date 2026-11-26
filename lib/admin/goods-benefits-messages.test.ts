import { describe, expect, it } from 'vitest';
import { parseGoodsBenefitValues } from '@/lib/goods-benefits';
import { goodsBenefitsProblem, otherGiftImagePaths, sameGoodsBenefits } from './goods-benefits-messages';

const path = (index: number) => `public-media/catalog/good/93800000-0000-4000-8000-00000000070${index}.webp`;
const values = { eventText: '연말 한정 증정', giftText: '아크릴 키링 1개', giftImagePaths: [path(1)] };

/*
 * G1(2026-11-25 리뷰): 저장 전 안내가 "사은품 사진에는 설명이 필요합니다. 설명 100자·이벤트 40자와 서로 다른 사진 3장까지 확인해주세요." 한 문장이라
 * 네 가지 원인 가운데 무엇이 문제인지 알 수 없었다. 원인 하나만 말한다. 판정은 저장 검사(parseGoodsBenefitValues)와 같아야 한다.
 */
describe('사은품 안내를 저장하기 전에 무엇이 왜 안 되는지', () => {
  it('문제가 없으면 null이고, 빈 사진 칸은 세지 않는다', () => {
    expect(goodsBenefitsProblem(values)).toBeNull();
    expect(goodsBenefitsProblem({ ...values, giftImagePaths: ['', path(1), ''] })).toBeNull();
    expect(goodsBenefitsProblem({ eventText: '', giftText: '', giftImagePaths: [] })).toBeNull();
  });

  it('같은 사진이 두 칸에 들어 있으면 그것만 말한다', () => {
    expect(goodsBenefitsProblem({ ...values, giftImagePaths: [path(1), path(2), path(1)] })).toBe('같은 사진이 두 칸에 들어 있습니다. 한 칸의 사진을 빼거나 다른 사진으로 바꿔 주세요.');
  });

  it('사진을 넣었는데 설명이 없으면 설명을 적으라고 말한다', () => {
    expect(goodsBenefitsProblem({ ...values, giftText: '  ' })).toBe('사은품 사진을 넣었으면 사은품 설명도 적어 주세요.');
  });

  it('넘친 글자 수와 장수는 어느 칸이 얼마나 넘었는지 말한다', () => {
    expect(goodsBenefitsProblem({ ...values, giftText: '가'.repeat(103) })).toBe('사은품 설명이 3자 넘었습니다. 100자까지 적을 수 있습니다.');
    expect(goodsBenefitsProblem({ ...values, eventText: '나'.repeat(41) })).toBe('이벤트 문구가 1자 넘었습니다. 40자까지 적을 수 있습니다.');
    expect(goodsBenefitsProblem({ ...values, giftImagePaths: [path(1), path(2), path(3), path(4)] })).toBe('사은품 사진은 3장까지 넣을 수 있습니다. 1장을 빼 주세요.');
  });

  it('그 밖에 저장할 수 없는 글자·사진은 고치는 방법을 말한다', () => {
    expect(goodsBenefitsProblem({ ...values, eventText: '줄\n바꿈' })).toContain('붙여 넣은 글이면 직접 다시 적고');
    expect(goodsBenefitsProblem({ ...values, giftImagePaths: ['https://example.com/a.png'] })).toContain('[사진 보관함에서 고르기]');
  });

  it('저장 검사가 거절하는 입력은 모두 까닭을 말하고, 통과하는 입력에는 말하지 않는다', () => {
    const cases = [values, { ...values, giftImagePaths: [] }, { ...values, giftText: '' }, { ...values, giftImagePaths: [path(1), path(1)] }, { ...values, giftText: '가'.repeat(101) },
      { ...values, eventText: '나'.repeat(41) }, { ...values, giftImagePaths: [path(1), path(2), path(3), path(4)] }, { ...values, giftImagePaths: [path(1).replace('/good/', '/ip/')] }];
    for (const input of cases) expect(goodsBenefitsProblem(input) === null, JSON.stringify(input)).toBe(parseGoodsBenefitValues(input) !== null);
  });
});

describe('사은품 사진 선택창에 넘기는 다른 칸의 사진', () => {
  it('지금 고르는 칸과 빈 칸을 빼고 돌려준다', () => {
    const three = { giftImagePaths: [path(1), '', path(3)] };
    expect(otherGiftImagePaths(three, 1)).toEqual([path(1), path(3)]);
    expect(otherGiftImagePaths(three, 0)).toEqual([path(3)]);
    expect(otherGiftImagePaths(three, null)).toEqual([path(1), path(3)]);
  });
});

describe('적은 내용이 저장된 것과 같은가', () => {
  it('빈 사진 칸은 무시하고 글과 사진 순서를 견준다', () => {
    expect(sameGoodsBenefits({ ...values, giftImagePaths: [path(1), ''] }, values)).toBe(true);
    expect(sameGoodsBenefits({ ...values, giftText: '다른 설명' }, values)).toBe(false);
    expect(sameGoodsBenefits({ ...values, giftImagePaths: [path(2)] }, values)).toBe(false);
  });
});
