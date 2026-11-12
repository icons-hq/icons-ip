import { describe, expect, it } from 'vitest';
import {
  DISPLAY_GOOD_VISIBILITY_LABELS, DISPLAY_GOOD_VISIBILITY_NOTES, GOOD_REFERENCE_LIMIT, displayGoodInfoOf, displayGoodVisibility, hiddenDisplayGoodsNotice,
  isGoodReferenceHeader, parseGoodReferenceLines, type GoodReferenceMatch,
} from './good-references';

describe('전시 상품 여러 줄 붙여넣기(1014-112)', () => {
  it('URL은 상품번호로, 코드·상품번호는 그대로 입력 순서대로 읽는다', () => {
    const parsed = parseGoodReferenceLines(['https://iconsip.com/shop/maple-keyring', 'GC-0001', '/shop/hongsil-card?x=1', 'plain-good-id'].join('\n'));
    expect(parsed.refs).toEqual(['maple-keyring', 'GC-0001', 'hongsil-card', 'plain-good-id']);
    expect(parsed.invalid).toEqual([]);
  });
  it('엑셀 여러 열 복사는 각 줄의 첫 칸만, 쉼표로 이어 붙인 값은 각각 읽는다', () => {
    const parsed = parseGoodReferenceLines('GC-0001\t메이플 키링\t9,000\r\n\tGC-0002\nGC-0003, GC-0004;GC-0005\n\n');
    expect(parsed.refs).toEqual(['GC-0001', 'GC-0002', 'GC-0003', 'GC-0004', 'GC-0005']);
  });
  it('첫 줄 머리글은 건너뛰고, 같은 값은 한 번만, 틀린 주소는 줄 번호와 이유로 남긴다', () => {
    const parsed = parseGoodReferenceLines('판매자상품코드\nGC-0001\nGC-0001\nhttps://example.com/shop/a\n/shop/best', 'localhost:3000');
    expect(parsed.headerSkipped).toBe(true);
    expect(parsed.refs).toEqual(['GC-0001']);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.invalid.map(line => line.line)).toEqual([4, 5]);
    expect(parsed.invalid[0].reason).toContain('ICONS 상품 주소');
  });
  it('지금 어드민을 연 호스트(스테이징·로컬)의 상품 주소도 받는다', () => {
    expect(parseGoodReferenceLines('http://localhost:3000/shop/local-good', 'localhost:3000').refs).toEqual(['local-good']);
  });
  it(`한 번에 ${GOOD_REFERENCE_LIMIT}개까지만 조회하고 나머지는 센다`, () => {
    const parsed = parseGoodReferenceLines(Array.from({ length: GOOD_REFERENCE_LIMIT + 5 }, (_, index) => `GC-${index}`).join('\n'));
    expect(parsed.refs).toHaveLength(GOOD_REFERENCE_LIMIT);
    expect(parsed.overflow).toBe(5);
  });
  it('머리글은 흔한 열 이름만 알아본다', () => {
    for (const header of ['상품코드', '판매자 상품코드', '상품번호', '상품 URL', 'URL', 'code', 'good_id']) expect(isGoodReferenceHeader(header), header).toBe(true);
    for (const value of ['GC-0001', 'maple-keyring', '상품']) expect(isGoodReferenceHeader(value), value).toBe(false);
  });
});

const match = (ref: string, extra: Partial<GoodReferenceMatch> = {}): GoodReferenceMatch => ({
  ref, status: 'found', matchedBy: 'id', id: ref, name: `상품 ${ref}`, code: `GC-${ref}`, archived: false, published: true, candidate: null, ...extra,
});

/* QA1 MD major: 공개 전 상품은 전시 목록에 담을 수 있지만 결과 줄·담은 목록·미리보기에서 늘 같은 말로 '비공개 — 공개 전까지 고객 화면에 보이지 않음'을 알린다. */
describe('전시 상품의 고객 화면 공개 표시', () => {
  it('공개·비공개·보관·없음을 나누고, 배지와 이유 문장은 한 곳에서 정한다', () => {
    expect(displayGoodVisibility({ archived: false, published: true })).toBe('public');
    expect(displayGoodVisibility({ archived: false, published: false })).toBe('unpublished');
    expect(displayGoodVisibility({ archived: true, published: false })).toBe('archived');
    expect(displayGoodVisibility(undefined)).toBe('missing');
    expect(DISPLAY_GOOD_VISIBILITY_LABELS.unpublished).toBe('비공개');
    expect(DISPLAY_GOOD_VISIBILITY_NOTES.unpublished).toBe('공개 전까지 고객 화면에 보이지 않습니다.');
  });
  it('저장된 상품번호 조회는 상품번호가 그대로 맞은 결과만 이름으로 쓴다', () => {
    expect(displayGoodInfoOf(match('qa-pr9', { published: false }))).toEqual({ name: '상품 qa-pr9', code: 'GC-qa-pr9', visibility: 'unpublished' });
    expect(displayGoodInfoOf(match('qa-pr1'))).toEqual({ name: '상품 qa-pr1', code: 'GC-qa-pr1', visibility: 'public' });
    expect(displayGoodInfoOf(match('gone', { status: 'not_found', id: null, name: null, code: null }))).toEqual({ name: null, code: null, visibility: 'missing' });
    /* 지워진 상품번호가 다른 상품의 판매자상품코드와 우연히 같으면 그 상품 이름을 빌려 쓰지 않는다. */
    expect(displayGoodInfoOf(match('old-id', { matchedBy: 'code', id: 'other-good' }))?.visibility).toBe('missing');
    expect(displayGoodInfoOf(match('both', { status: 'ambiguous', id: null, name: null }))).toBeNull();
  });
  it('보이지 않는 상품을 이름과 이유로 한 문단에 모으고, 모두 보이면 알리지 않는다', () => {
    expect(hiddenDisplayGoodsNotice([])).toBeNull();
    expect(hiddenDisplayGoodsNotice([{ name: 'QA 비공개 상품', visibility: 'unpublished' }]))
      .toBe('비공개 상품 1개(QA 비공개 상품)는 공개 전까지 고객 화면에 보이지 않습니다.');
    const many = hiddenDisplayGoodsNotice([
      ...['가', '나', '다', '라', '마'].map(name => ({ name, visibility: 'unpublished' as const })),
      { name: '보관 상품', visibility: 'archived' }, { name: 'gone-id', visibility: 'missing' },
    ]);
    expect(many).toBe('비공개 상품 5개(가, 나, 다 외 2개)는 공개 전까지 고객 화면에 보이지 않습니다. 보관된 상품 1개(보관 상품)는 고객 화면에 보이지 않습니다. 찾을 수 없는 상품 1개(gone-id)는 고객 화면에 보이지 않습니다.');
  });
});
