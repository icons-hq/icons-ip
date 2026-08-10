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
});
