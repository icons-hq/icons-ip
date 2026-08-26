import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WcButton } from './WcButton';

describe('WcButton', () => {
  /* variant 는 CSS 쪽 `.wc-btn.primary` / `.wc-btn.accent` 와 맞물리는 결합 지점이다.
     기본값 outline 은 추가 클래스 없이 기본 규칙만 탄다. */
  it('maps each variant onto the agreed class names', () => {
    expect(renderToStaticMarkup(<WcButton>담기</WcButton>)).toContain('class="wc-btn"');
    expect(renderToStaticMarkup(<WcButton variant="primary">담기</WcButton>)).toContain('class="wc-btn primary"');
    expect(renderToStaticMarkup(<WcButton variant="accent">담기</WcButton>)).toContain('class="wc-btn accent"');
  });

  it('renders an anchor when a href is given', () => {
    const html = renderToStaticMarkup(<WcButton href="/shop">굿즈샵</WcButton>);

    expect(html).toContain('<a ');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('<button');
  });

  /* 링크에는 disabled 속성이 없다. <a>로 두면 회색으로 보여도 키보드·스크린리더는 그대로
     따라갈 수 있어, 비활성 링크는 아예 링크가 아니어야 한다. */
  it('degrades a disabled link to a non-navigable span', () => {
    const html = renderToStaticMarkup(<WcButton disabled href="/shop">굿즈샵</WcButton>);

    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('<span');
    expect(html).toContain('disabled"');
  });

  /* form 안에 놓였을 때 의도치 않은 submit 을 막는다 — 브라우저 기본은 submit 이다. */
  it('defaults the button type to button', () => {
    expect(renderToStaticMarkup(<WcButton>담기</WcButton>)).toContain('type="button"');
    expect(renderToStaticMarkup(<WcButton type="submit">결제</WcButton>)).toContain('type="submit"');
  });

  it('marks a disabled button with the native attribute', () => {
    const html = renderToStaticMarkup(<WcButton disabled>담기</WcButton>);

    expect(html).toContain('<button');
    expect(html).toContain('disabled');
  });
});
