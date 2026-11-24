import { describe, expect, it, vi } from 'vitest';
import { findGoodById, GOOD_URL_ERRORS, parseGoodUrl } from './good-url';

describe('전시 상품 URL 붙여넣기(10/14 회의 A11)', () => {
  it('상품 상세 경로·운영 도메인·스킴 없는 주소에서 상품 ID를 꺼낸다', () => {
    expect([
      '/shop/maple-keyring', ' https://iconsip.com/shop/maple-keyring ', 'https://www.iconsip.com/shop/maple-keyring?from=home#reviews',
      'iconsip.com/shop/maple-keyring/', 'http://staging.iconsip.com/shop/maple_keyring2',
    ].map(value => parseGoodUrl(value))).toEqual([
      { ok: true, id: 'maple-keyring' }, { ok: true, id: 'maple-keyring' }, { ok: true, id: 'maple-keyring' },
      { ok: true, id: 'maple-keyring' }, { ok: true, id: 'maple_keyring2' },
    ]);
  });

  /* ADR-0050 — 고객 화면 주소는 상품 자동코드의 소문자형이다. 주소 끝 값만 꺼내고 상품 URL로 바꾸는 일은 조회가 한다. */
  it('상품 자동코드 주소(대소문자·점 포함 코드)도 주소 끝 값으로 꺼낸다', () => {
    expect(['https://iconsip.com/shop/hsq-0059', '/shop/HSQ-0059?reviewPage=2#reviews', 'iconsip.com/shop/wh.1234_a', `/shop/${'a'.repeat(100)}`]
      .map(value => parseGoodUrl(value))).toEqual([
      { ok: true, id: 'hsq-0059' }, { ok: true, id: 'HSQ-0059' }, { ok: true, id: 'wh.1234_a' }, { ok: true, id: 'a'.repeat(100) },
    ]);
  });

  it('도메인 전환 기간에는 새 운영 도메인(xsquare.kr)의 상품 주소도 받는다', () => {
    expect(['https://xsquare.kr/shop/maple-keyring', 'www.xsquare.kr/shop/maple-keyring/', 'HTTPS://XSQUARE.KR/shop/maple-keyring']
      .map(value => parseGoodUrl(value))).toEqual(Array(3).fill({ ok: true, id: 'maple-keyring' }));
    for (const value of ['https://xsquare.kr.evil.test/shop/abc', 'https://fakexsquare.kr/shop/abc', 'https://x-square.kr/shop/abc'])
      expect(parseGoodUrl(value)).toEqual({ ok: false, error: GOOD_URL_ERRORS.host });
  });

  it('지금 어드민을 연 호스트(스테이징·로컬)의 상품 주소도 받는다', () => {
    expect(parseGoodUrl('http://localhost:3000/shop/abc', 'localhost:3000')).toEqual({ ok: true, id: 'abc' });
    expect(parseGoodUrl('http://localhost:3000/shop/abc', 'localhost:3100')).toEqual({ ok: false, error: GOOD_URL_ERRORS.host });
  });

  it('빈 값·목록 주소·다른 사이트·잘못된 ID는 이유와 함께 거절한다', () => {
    expect(parseGoodUrl('  ')).toEqual({ ok: false, error: GOOD_URL_ERRORS.empty });
    for (const value of ['/shop', '/shop/new', '/shop/best', '/shop/a/b', '/goods/abc', 'https://iconsip.com/shop/%E0%A4%A', `/shop/${'a'.repeat(101)}`, '/shop/한글', '/shop/%2Ehidden', 'javascript:alert(1)'])
      expect(parseGoodUrl(value)).toEqual({ ok: false, error: GOOD_URL_ERRORS.invalid });
    for (const value of ['https://example.com/shop/abc', 'https://iconsip.com.evil.test/shop/abc', 'https://fakeiconsip.com/shop/abc'])
      expect(parseGoodUrl(value)).toEqual({ ok: false, error: GOOD_URL_ERRORS.host });
  });

  it('주소 끝 값이 상품 자동코드면 같은 코드의 행을 고르고, 상품 URL이 같은 행을 먼저 고른다', async () => {
    const page = vi.fn(async () => ({ rows: [{ id: 'hongsil-keyring', code: 'HSQ-0059' }, { id: 'other', code: 'HSQ-00591' }], total: 2 }));
    await expect(findGoodById('hsq-0059', page)).resolves.toEqual({ id: 'hongsil-keyring', code: 'HSQ-0059' });
    const both = vi.fn(async () => ({ rows: [{ id: 'x', code: 'G13' }, { id: 'g13', code: 'HSQ-0013' }], total: 2 }));
    await expect(findGoodById('g13', both)).resolves.toEqual({ id: 'g13', code: 'HSQ-0013' });
  });

  it('부분 일치 검색 결과에서 정확히 같은 ID만 고르고 몇 쪽까지만 넘겨 본다', async () => {
    const searchPage = vi.fn(async (page: number) => ({ rows: page === 2 ? [{ id: 'abc-1' }, { id: 'abc' }] : [{ id: `abc-${page}0` }], total: 60, pageSize: 20 }));
    await expect(findGoodById('abc', searchPage)).resolves.toEqual({ id: 'abc' });
    expect(searchPage).toHaveBeenCalledTimes(2);
    const missing = vi.fn(async () => ({ rows: [{ id: 'abcd' }], total: 1 }));
    await expect(findGoodById('abc', missing)).resolves.toBeNull();
    expect(missing).toHaveBeenCalledTimes(1);
    const endless = vi.fn(async () => ({ rows: [{ id: 'abcd' }], total: 10_000, pageSize: 20 }));
    await expect(findGoodById('abc', endless, 3)).resolves.toBeNull();
    expect(endless).toHaveBeenCalledTimes(3);
  });
});
