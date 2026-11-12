import { describe, expect, it } from 'vitest';
import { GOOD_REFERENCE_LIMIT, isGoodReferenceHeader, parseGoodReferenceLines } from './good-references';

describe('전시 상품 여러 줄 붙여넣기(1014-112)', () => {
  it('주소는 상품 URL 값(주소 끝)으로, 판매자상품코드·상품 URL 값은 그대로 입력 순서대로 읽는다', () => {
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
