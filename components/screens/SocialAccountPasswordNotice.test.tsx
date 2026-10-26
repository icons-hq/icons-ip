import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SocialAccountPasswordNotice } from './SocialAccountPasswordNotice';

describe('SocialAccountPasswordNotice', () => {
  it('points a social-only account to SNS sign-in without any password or reset form', () => {
    const html = renderToStaticMarkup(<SocialAccountPasswordNotice next="/community?sort=hot" />);

    expect(html).toContain('SNS로 가입한 계정은 비밀번호를 설정할 수 없어요');
    expect(html).toContain('Google·카카오·Apple');
    expect(html).toContain('href="/community?sort=hot"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="password"');
  });
});
