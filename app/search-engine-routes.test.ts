import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* /robots.txt·/sitemap.xml 라우트(1014-029)가 배포 환경·공개 카탈로그를 규칙 모듈에 그대로 넘기는지 본다.
   규칙 자체는 lib/seo/search-engines.test.ts 가 잠근다. */
const loader = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/seo/sitemap-catalog.server', () => ({ loadSitemapCatalog: loader.load }));

const ORIGINAL = { SITE_URL: process.env.SITE_URL, VERCEL_ENV: process.env.VERCEL_ENV };

beforeEach(() => {
  loader.load.mockReset();
  delete process.env.SITE_URL;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('/robots.txt', () => {
  it('운영 배포는 개인·거래 화면을 닫고 운영 사이트맵을 알린다', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.SITE_URL = 'https://iconsip.com';
    const { default: robots } = await import('./robots');

    const result = robots();
    expect(result.sitemap).toBe('https://iconsip.com/sitemap.xml');
    expect(result.rules).toMatchObject({ userAgent: '*', allow: '/' });
    expect((result.rules as { disallow: string[] }).disallow).toEqual(expect.arrayContaining(['/admin', '/my', '/checkout', '/cart']));
  });

  it('미리보기·스테이징 배포는 전부 닫는다', async () => {
    process.env.VERCEL_ENV = 'preview';
    const { default: robots } = await import('./robots');

    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });
});

describe('/sitemap.xml', () => {
  it('요청마다 공개 카탈로그를 읽어 고정 화면·IP관·굿즈 상세를 싣는다', async () => {
    loader.load.mockResolvedValue({ ips: [{ id: 'ip-maple', publicSlug: 'maplestory', updatedAt: null }], goods: [{ id: 'g4', updatedAt: null }] });
    const route = await import('./sitemap');

    expect(route.dynamic).toBe('force-dynamic');
    const urls = (await route.default()).map((entry) => entry.url);
    expect(urls).toEqual(expect.arrayContaining(['https://iconsip.com', 'https://iconsip.com/shop', 'https://iconsip.com/ip/maplestory', 'https://iconsip.com/shop/g4']));
    expect(loader.load).toHaveBeenCalledTimes(1);
  });
});
