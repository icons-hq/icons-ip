import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AddToCartResultDialog } from './AddToCartResultDialog';

const items = [
  { name: '아크릴 블록', option: null, quantity: 2 },
  { name: '추가 스티커', option: '파랑', quantity: 1 },
];

describe('AddToCartResultDialog', () => {
  it('담은 굿즈 요약과 계속 쇼핑·장바구니 보기를 모달 다이얼로그로 그린다', () => {
    const html = renderToStaticMarkup(<AddToCartResultDialog items={items} onClose={vi.fn()} open />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    /* 다이얼로그 이름은 제목이 준다 — aria-labelledby 가 제목 id 를 가리켜야 한다. */
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}">장바구니에 담았어요</h2>`);
    expect(html).toContain('<strong>아크릴 블록</strong><span>수량 2개</span>');
    expect(html).toContain('<strong>추가 스티커</strong><span>파랑 · 수량 1개</span>');
    /* 계속 쇼핑은 닫기 버튼(페이지 유지), 장바구니 보기는 /cart 링크다. */
    expect(html).toMatch(/<button class="wc-btn" type="button">계속 쇼핑<\/button>/);
    expect(html).toMatch(/<a class="wc-btn primary" href="\/cart">장바구니 보기<\/a>/);
  });

  it('공용 부품 계약대로 문구와 목적지를 바꿀 수 있다', () => {
    const html = renderToStaticMarkup(
      <AddToCartResultDialog cartHref="/cart?from=wish" continueLabel="위시 계속 보기" items={[]} onClose={vi.fn()} open />,
    );

    expect(html).toContain('위시 계속 보기');
    expect(html).toContain('href="/cart?from=wish"');
    expect(html).not.toContain('wc-cart-result__items');
  });

  it('닫혀 있으면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<AddToCartResultDialog items={items} onClose={vi.fn()} open={false} />)).toBe('');
  });
});
