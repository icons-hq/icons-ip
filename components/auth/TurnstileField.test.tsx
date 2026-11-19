import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnstileField } from './TurnstileField';

const ORIGINAL = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = ORIGINAL;
});

describe('TurnstileField', () => {
  it('사이트 키가 없으면 아무것도 그리지 않는다(꺼짐)', () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    expect(renderToStaticMarkup(<TurnstileField />)).toBe('');
  });

  it('사이트 키가 있으면 토큰 입력과 위젯 자리를 그린다', () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '0x4AAAAAAA-site';
    const html = renderToStaticMarkup(<TurnstileField />);
    expect(html).toContain('name="cf-turnstile-response"');
    expect(html).toContain('type="hidden"');
    expect(html).toContain('data-turnstile-host');
  });
});
