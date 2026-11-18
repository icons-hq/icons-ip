import { describe, expect, it } from 'vitest';
import {
  CANONICAL_SITE_ORIGIN,
  isProductionSiteHostname,
  isProductionSiteOrigin,
  PRODUCTION_SITE_HOSTS,
  PRODUCTION_SITE_ORIGINS,
} from './site-domains.mjs';

describe('운영 도메인 단일 출처(도메인 전환 1단계)', () => {
  it('정규 주소는 아직 iconsip.com이고 운영 도메인 목록 안에 있다', () => {
    expect(CANONICAL_SITE_ORIGIN).toBe('https://iconsip.com');
    expect(PRODUCTION_SITE_ORIGINS).toContain(CANONICAL_SITE_ORIGIN);
  });

  it('운영 SITE_URL origin은 두 도메인의 루트만 받는다', () => {
    expect(PRODUCTION_SITE_ORIGINS).toEqual(['https://iconsip.com', 'https://xsquare.kr']);
    expect(isProductionSiteOrigin('https://xsquare.kr')).toBe(true);
    for (const origin of ['https://www.xsquare.kr', 'http://xsquare.kr', 'https://xsquare.kr.evil.example', 'https://x-square.kr'])
      expect(isProductionSiteOrigin(origin)).toBe(false);
  });

  it('운영 호스트는 루트와 www다', () => {
    expect(PRODUCTION_SITE_HOSTS).toEqual(['iconsip.com', 'www.iconsip.com', 'xsquare.kr', 'www.xsquare.kr']);
  });

  it('하위 호스트는 받고 비슷한 이름은 거절한다', () => {
    for (const host of ['xsquare.kr', 'WWW.XSQUARE.KR', 'staging.iconsip.com'])
      expect(isProductionSiteHostname(host)).toBe(true);
    for (const host of ['fakexsquare.kr', 'xsquare.kr.evil.test', 'iconsip.com.evil.test', 'x-square.kr'])
      expect(isProductionSiteHostname(host)).toBe(false);
  });
});
