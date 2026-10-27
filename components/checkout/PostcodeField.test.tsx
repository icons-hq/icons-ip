import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { POSTCODE_SCRIPT_SRC } from '@/lib/postcode';
import { PostcodeField } from './PostcodeField';

function render(props: Partial<Parameters<typeof PostcodeField>[0]> = {}) {
  return renderToStaticMarkup(
    <PostcodeField
      onChange={vi.fn()}
      onSelect={vi.fn()}
      value=""
      {...props}
    />,
  );
}

describe('PostcodeField', () => {
  it('주소 검색 버튼과 수기 입력란을 함께 제공한다', () => {
    const html = render({ value: '04799' });

    expect(html).toContain('id="checkout-postalCode"');
    expect(html).toContain('value="04799"');
    expect(html).toContain('maxLength="5"');
    expect(html).toContain('주소 검색');
    expect(html).toContain('직접 입력해주세요');
    expect(html).not.toContain('readonly');
    expect(html).not.toContain('disabled');
  });

  it('첫 렌더에 외부 스크립트를 끼워 넣지 않는다', () => {
    const html = render();

    expect(html).not.toContain(POSTCODE_SCRIPT_SRC);
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('기존 우편번호 검증 오류를 그대로 표시하고 연결한다', () => {
    const html = render({ error: '우편번호 5자리를 입력해주세요.' });

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="checkout-postalCode-error"');
    expect(html).toContain('id="checkout-postalCode-error"');
    expect(html).toContain('우편번호 5자리를 입력해주세요.');
  });

  /* 주소록 폼(L7)이 같은 부품을 쓸 때 — 주문서의 id 와 겹치지 않게 접두 id 를 받는다. 기본값은 그대로다. */
  it('다른 화면은 자기 id 를 넘겨 라벨·오류·검색 레이어 연결을 함께 옮긴다', () => {
    const html = render({ id: 'address-book-postalCode', error: '우편번호 5자리를 입력해주세요.' });

    expect(html).toContain('for="address-book-postalCode"');
    expect(html).toContain('id="address-book-postalCode"');
    expect(html).toContain('aria-describedby="address-book-postalCode-error"');
    expect(html).toContain('id="address-book-postalCode-error"');
    expect(html).toContain('aria-controls="address-book-postalCode-search-layer"');
    expect(html).not.toContain('checkout-postalCode');
    expect(render()).toContain('aria-controls="postcode-search-layer"');
  });
});
