import { describe, expect, it } from 'vitest';
import { canonicalGoodLinks, goodCodeSegment, goodDetailHref, goodPublicSegment, parseGoodDetailLink } from './goods-display';

/* MD-0051 · ADR-0050 — 공개 상품 주소는 상품 자동코드의 소문자형이다. 내부 id(goods.id)는 바뀌지 않고 옛 주소로만 남는다. */
describe('공개 상품 주소', () => {
  it('상품 자동코드가 있으면 소문자 코드 주소, 없으면 내부 id 주소를 만든다', () => {
    expect(goodDetailHref({ id: 'hongsilkweseuteu-akeuril-hyudaepon-kiring', code: 'HSQ-0059' })).toBe('/shop/hsq-0059');
    expect(goodDetailHref({ id: 'g13' })).toBe('/shop/g13');
    expect(goodDetailHref({ id: 'g13', code: null })).toBe('/shop/g13');
    /* 내부 id 문자열만 아는 호출부(알림·메일·저장 링크)는 옛 주소다 — 상세가 코드 주소로 옮긴다. */
    expect(goodDetailHref('g13')).toBe('/shop/g13');
  });

  it('저장 규칙(upper·btrim)과 같게 정규화하고 창고 품번·바코드 꼴 코드도 주소로 쓴다', () => {
    expect(goodPublicSegment({ id: 'x', code: ' hsq-0059 ' })).toBe('hsq-0059');
    expect(goodPublicSegment({ id: 'x', code: '8800353088562' })).toBe('8800353088562');
    expect(goodPublicSegment({ id: 'x', code: 'WH.12_A-3' })).toBe('wh.12_a-3');
  });

  it('주소로 쓸 수 없는 코드(공백·한글·기호·정적 경로와 같은 값)는 내부 id 주소에 머문다', () => {
    for (const code of ['창고 A-1', 'A B', 'A/B', 'A?B', '-A', 'NEW', 'best', '', '   ']) {
      expect(goodPublicSegment({ id: 'keyring', code }), code).toBe('keyring');
    }
    expect(goodPublicSegment({ id: 'keyring', code: 'A'.repeat(101) })).toBe('keyring');
    expect(goodPublicSegment({ id: 'keyring', code: 'A'.repeat(100) })).toBe('a'.repeat(100));
    expect(goodCodeSegment('창고 A-1')).toBeNull();
    expect(goodCodeSegment(null)).toBeNull();
    expect(goodCodeSegment('G13')).toBe('g13');
  });

  it('저장된 상세 링크의 끝 값과 뒤쪽을 나누고 목록 경로는 상세로 읽지 않는다', () => {
    expect(parseGoodDetailLink('/shop/g13')).toEqual({ segment: 'g13', suffix: '' });
    expect(parseGoodDetailLink('/shop/g13?reviewPage=2#reviews')).toEqual({ segment: 'g13', suffix: '?reviewPage=2#reviews' });
    expect(parseGoodDetailLink('/shop/hsq-0059#qna')).toEqual({ segment: 'hsq-0059', suffix: '#qna' });
    for (const href of ['/shop', '/shop/new', '/shop/best?sort=new', '/shop/a/b', '/ip/hong-sil-quest', 'https://iconsip.com/shop/g13', '/shop/%E0%A4%A']) {
      expect(parseGoodDetailLink(href), href).toBeNull();
    }
  });

  it('운영자가 저장한 내부 id 링크를 읽어 둔 굿즈의 코드 주소로 바꾸고 모르는 값은 남겨 둔다', () => {
    const goods = [{ id: 'hongsil-keyring', code: 'HSQ-0059' }, { id: 'plain', code: '창고 A' }];
    const links = canonicalGoodLinks(['/shop/hongsil-keyring?utm_source=home', '/shop/plain', '/shop/hsq-0059', '/shop/unknown', '/shop/new', '/ip/x'], goods);
    expect(Object.fromEntries(links)).toEqual({
      '/shop/hongsil-keyring?utm_source=home': '/shop/hsq-0059?utm_source=home',
      '/shop/plain': '/shop/plain',
    });
  });
});
