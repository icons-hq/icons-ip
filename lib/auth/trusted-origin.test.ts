import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_AUTH_ORIGIN, trustedAuthOrigin } from './trusted-origin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('로그인·메일 링크 허용 출처', () => {
  it('정규 출처는 xsquare.kr이다(도메인 전환 3단계)', () => {
    expect(CANONICAL_AUTH_ORIGIN).toBe('https://xsquare.kr');
  });

  it('두 운영 도메인의 루트·www를 받고 경로는 origin으로 줄인다', () => {
    for (const origin of ['https://iconsip.com', 'https://www.iconsip.com', 'https://xsquare.kr', 'https://www.xsquare.kr'])
      expect(trustedAuthOrigin(origin)).toBe(origin);
    expect(trustedAuthOrigin('https://xsquare.kr/auth/callback?next=/my')).toBe('https://xsquare.kr');
  });

  it('비슷한 이름·http·하위 호스트·잘못된 값은 거절한다', () => {
    for (const value of [
      'http://xsquare.kr', 'https://xsquare.kr.evil.example', 'https://fakexsquare.kr', 'https://x-square.kr',
      'https://staging.xsquare.kr', 'not a url', null,
    ])
      expect(trustedAuthOrigin(value)).toBeUndefined();
  });

  it('지금 배포의 vercel.app 주소는 받는다', () => {
    vi.stubEnv('VERCEL_URL', 'icons-abc123-team.vercel.app');
    expect(trustedAuthOrigin('https://icons-abc123-team.vercel.app')).toBe('https://icons-abc123-team.vercel.app');
    expect(trustedAuthOrigin('https://icons-other-team.vercel.app')).toBeUndefined();
  });
});
