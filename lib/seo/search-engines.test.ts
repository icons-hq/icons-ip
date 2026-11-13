import { describe, expect, it } from 'vitest';
import { hidesSiteFooter, isAuthShellPath } from '../routes';
import {
  ROBOTS_DISALLOWED_PATHS,
  SITEMAP_STATIC_PATHS,
  buildRobots,
  buildSitemap,
  metadataBaseUrl,
  naverSiteVerification,
  publicSiteOrigin,
  siteVerificationMetadata,
} from './search-engines';

const ORIGIN = 'https://iconsip.com';
const blocked = (path: string) => ROBOTS_DISALLOWED_PATHS.some((prefix) => path === prefix || path.startsWith(prefix));

describe('robots.txt (1014-029)', () => {
  it('운영은 공개 화면을 열고 개인·거래·인증 화면을 닫으며 사이트맵 주소를 알린다', () => {
    const robots = buildRobots({ origin: ORIGIN, vercelEnv: 'production' });
    expect(robots.sitemap).toBe('https://iconsip.com/sitemap.xml');
    expect(robots.rules).toEqual({ userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOWED_PATHS] });
    /* 오케스트레이터 판단의 제외 목록 — 어드민·마이·주문서·장바구니·API·선물·주문과 인증 집중 화면. */
    for (const path of ['/admin', '/my', '/checkout', '/cart', '/api', '/gifts', '/orders', '/update-password', '/account-suspended', '/manager-invitation']) {
      expect(ROBOTS_DISALLOWED_PATHS, path).toContain(path);
    }
  });

  it('인증 집중 화면(푸터도 없는 화면)은 모두 닫는다', () => {
    for (const path of ['/update-password', '/account-suspended', '/manager-invitation']) {
      expect(isAuthShellPath(path) && hidesSiteFooter(path), path).toBe(true);
      expect(blocked(path), path).toBe(true);
    }
  });

  it('사이트맵에 싣는 공개 화면·IP관·굿즈 상세를 닫지 않는다', () => {
    for (const path of [...SITEMAP_STATIC_PATHS, '/shop/g4', '/ip/maplestory', '/login', '/search']) {
      expect(blocked(path), path).toBe(false);
    }
  });

  it('미리보기·스테이징은 운영과 같은 내용이라 전부 닫고 사이트맵을 알리지 않는다', () => {
    expect(buildRobots({ origin: 'https://icons-ip-git-x.vercel.app', vercelEnv: 'preview' })).toEqual({
      rules: { userAgent: '*', disallow: '/' },
    });
    /* 로컬 실행(VERCEL_ENV 없음)은 운영 규칙으로 확인한다. */
    expect(buildRobots({ origin: 'http://localhost:3000', vercelEnv: undefined }).sitemap).toBe('http://localhost:3000/sitemap.xml');
  });
});

describe('sitemap.xml (1014-029)', () => {
  it('공개 목록 화면·공개 IP관·공개 굿즈 상세를 절대 주소로 싣는다', () => {
    const sitemap = buildSitemap(ORIGIN, {
      ips: [
        { id: 'ip-maple', publicSlug: 'maplestory', updatedAt: '2026-11-01T00:00:00Z' },
        { id: 'ip-no-slug', publicSlug: null, updatedAt: null },
      ],
      goods: [
        { id: 'g4', updatedAt: '2026-11-10T09:30:00Z' },
        { id: 'g-new', updatedAt: 'not-a-date' },
      ],
    });
    const urls = sitemap.map((entry) => entry.url);
    expect(urls).toContain('https://iconsip.com');
    for (const path of ['/shop', '/shop/new', '/shop/best', '/ip', '/legal/terms', '/legal/privacy', '/legal/shipping']) {
      expect(urls, path).toContain(`${ORIGIN}${path}`);
    }
    expect(sitemap).toContainEqual({ url: 'https://iconsip.com/ip/maplestory', lastModified: new Date('2026-11-01T00:00:00Z') });
    expect(sitemap).toContainEqual({ url: 'https://iconsip.com/ip/ip-no-slug' });
    expect(sitemap).toContainEqual({ url: 'https://iconsip.com/shop/g4', lastModified: new Date('2026-11-10T09:30:00Z') });
    expect(sitemap).toContainEqual({ url: 'https://iconsip.com/shop/g-new' });
    /* 비공개·noindex·스위치 화면은 싣지 않는다. */
    for (const path of ['/packs', '/community', '/ip/aouad', '/search', '/cart', '/my']) {
      expect(urls, path).not.toContain(`${ORIGIN}${path}`);
    }
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('네이버 소유확인 메타', () => {
  it('서치어드바이저 값(env)이 있을 때만 naver-site-verification 을 낸다', () => {
    expect(siteVerificationMetadata('a1b2c3d4e5f6a7b8c9d0')).toEqual({
      verification: { other: { 'naver-site-verification': 'a1b2c3d4e5f6a7b8c9d0' } },
    });
    expect(siteVerificationMetadata(undefined)).toEqual({});
    expect(siteVerificationMetadata('   ')).toEqual({});
  });

  it('화면에서 복사한 메타 태그를 통째로 넣어도 content 값만 쓰고, 모양이 다르면 내지 않는다', () => {
    expect(naverSiteVerification('<meta name="naver-site-verification" content="0123456789abcdef0123" />')).toBe('0123456789abcdef0123');
    expect(naverSiteVerification(" 0123456789abcdef0123 \n")).toBe('0123456789abcdef0123');
    expect(naverSiteVerification('short')).toBeNull();
    expect(naverSiteVerification('"><script>alert(1)</script>')).toBeNull();
  });
});

describe('사이트 주소', () => {
  it('운영 SITE_URL 을 따르고 없으면 운영 도메인이다', () => {
    expect(publicSiteOrigin('https://iconsip.com/')).toBe('https://iconsip.com');
    expect(publicSiteOrigin('')).toBe('https://iconsip.com');
    expect(publicSiteOrigin(undefined)).toBe('https://iconsip.com');
    expect(publicSiteOrigin('https://staging.example.test')).toBe('https://staging.example.test');
  });

  it('metadataBase 는 주소 모양이 아닌 SITE_URL 에도 레이아웃을 깨지 않는다', () => {
    expect(metadataBaseUrl('https://iconsip.com').href).toBe('https://iconsip.com/');
    expect(metadataBaseUrl('iconsip.com').href).toBe('https://iconsip.com/');
    expect(metadataBaseUrl('javascript:alert(1)').href).toBe('https://iconsip.com/');
  });
});
