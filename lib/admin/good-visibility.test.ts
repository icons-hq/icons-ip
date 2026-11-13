import { describe, expect, it } from 'vitest';
import {
  DISPLAY_GOOD_VISIBILITY_LABELS, DISPLAY_GOOD_VISIBILITY_NOTES, displayGoodVisibility, hiddenDisplayGoodsBreakdown, hiddenDisplayGoodsNotice, parseGoodVisibility,
} from './good-visibility';

/*
 * QA1 MD 후속: 전시에 담은 상품이 고객 화면에 보이지 않는 이유를 CONTEXT.md '게시 상태'(초안·공개·보관) 말로 나눈다.
 * '비공개'·'숨김'은 피하라는 말이라 쓰지 않고, 판매 제한은 판매 설정의 '성인(19금)'과 같은 말이다.
 */
describe('전시 상품의 고객 화면 노출 이유', () => {
  it('이유마다 배지와 이유 문장을 한 곳에서 정하고 피해야 할 말을 쓰지 않는다', () => {
    expect(DISPLAY_GOOD_VISIBILITY_LABELS).toEqual({
      draft: '초안', ip_draft: 'IP 초안', restricted: '성인(19금)', archived: '보관됨', ip_archived: 'IP 보관됨', missing: '찾을 수 없음', hidden: '고객 화면 미노출',
    });
    expect(DISPLAY_GOOD_VISIBILITY_NOTES.draft).toBe('공개 전까지 고객 화면에 보이지 않습니다.');
    expect(DISPLAY_GOOD_VISIBILITY_NOTES.ip_draft).toBe('IP 공개 전까지 고객 화면에 보이지 않습니다.');
    expect(DISPLAY_GOOD_VISIBILITY_NOTES.restricted).toBe('홈 전시·캠페인·쇼핑스토리에는 나오지 않고, 카테고리 전시에서는 성인 인증을 마친 회원에게만 보입니다.');
    for (const text of [...Object.values(DISPLAY_GOOD_VISIBILITY_LABELS), ...Object.values(DISPLAY_GOOD_VISIBILITY_NOTES)]) expect(text).not.toMatch(/비공개|숨김/);
  });
  it('DB가 준 이유만 믿고, 이유가 없으면 보관·공개 여부로만 나눈다', () => {
    for (const value of ['public', 'draft', 'ip_draft', 'restricted', 'archived', 'ip_archived']) expect(parseGoodVisibility(value), value).toBe(value);
    for (const value of ['hidden', 'missing', 'unpublished', '', null, undefined, 1]) expect(parseGoodVisibility(value), String(value)).toBeNull();
    expect(displayGoodVisibility({ archived: false, published: false, visibility: 'ip_draft' })).toBe('ip_draft');
    expect(displayGoodVisibility({ archived: false, published: true })).toBe('public');
    expect(displayGoodVisibility({ archived: true, published: false })).toBe('archived');
    /* 이유를 싣지 않은 옛 응답의 미노출은 지어내지 않고 '고객 화면 미노출'로 둔다. */
    expect(displayGoodVisibility({ archived: false, published: false })).toBe('hidden');
    expect(displayGoodVisibility(undefined)).toBe('missing');
  });
  it('보이지 않는 상품을 이유별로 이름과 함께 한 문단에 모으고, 모두 보이면 알리지 않는다', () => {
    expect(hiddenDisplayGoodsNotice([{ name: '공개 상품', visibility: 'public' }])).toBeNull();
    expect(hiddenDisplayGoodsNotice([
      ...['가', '나', '다', '라'].map(name => ({ name, visibility: 'draft' as const })),
      { name: 'IP 준비 상품', visibility: 'ip_draft' }, { name: '19금 상품', visibility: 'restricted' }, { name: '보관 상품', visibility: 'archived' },
      { name: 'IP 보관 상품', visibility: 'ip_archived' }, { name: 'gone-id', visibility: 'missing' }, { name: '모름', visibility: 'hidden' },
    ])).toBe([
      '초안 상품 4개(가, 나, 다 외 1개)는 공개 전까지 고객 화면에 보이지 않습니다.',
      'IP가 공개 전인 상품 1개(IP 준비 상품)는 IP 공개 전까지 고객 화면에 보이지 않습니다.',
      '성인(19금) 상품 1개(19금 상품)는 홈 전시·캠페인·쇼핑스토리에 나오지 않고, 카테고리 전시에서는 성인 인증을 마친 회원에게만 보입니다.',
      '보관된 상품 1개(보관 상품)는 고객 화면에 보이지 않습니다.',
      'IP가 보관된 상품 1개(IP 보관 상품)는 고객 화면에 보이지 않습니다.',
      '찾을 수 없는 상품 1개(gone-id)는 고객 화면에 보이지 않습니다.',
      '고객 화면에 보이지 않는 상품 1개(모름)가 있습니다.',
    ].join(' '));
    expect(hiddenDisplayGoodsBreakdown(['restricted', 'draft', 'draft', 'public'])).toBe('초안 2개, 성인(19금) 1개');
  });
});
