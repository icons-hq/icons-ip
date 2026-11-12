import type { Metadata, MetadataRoute } from 'next';
import { goodDetailHref } from '../goods-display';
import { publicIpHref } from '../ip-identity';
import { LEGAL_DOCUMENT_SLUGS, legalDocumentHref } from '../legal/links';

/*
 * 검색 엔진 노출(10/14 회의 1014-029 "네이버에서 무엇을 쳐야 나오나", 결정 "서치어드바이저 등록").
 *
 * robots.txt — 공개 화면은 열고, 개인·거래·인증 화면(어드민·마이·장바구니·주문서·주문·선물·API·인증 집중 화면 등)은 닫는다.
 *   미리보기·스테이징(VERCEL_ENV=preview)은 운영과 같은 내용이 다른 주소에 있으므로 전부 닫는다.
 * sitemap.xml — 공개 목록 화면, 공개 IP관, 공개 굿즈 상세. 판매 제한(19금)·비공개(초안)·보관 굿즈와 비공개·보관 IP는 넣지 않는다
 *   (상세가 404 이거나 noindex 인 주소 — app/shop/[goodId]/page.tsx).
 * 소유확인 — 네이버 서치어드바이저가 주는 값(`NAVER_SITE_VERIFICATION`)이 있을 때만 `<meta name="naver-site-verification">`를 낸다.
 *
 * 등록·소유확인·사이트맵 제출은 회사 네이버 ID로 사람이 한다(서치어드바이저). 이 모듈은 순수 함수라 DB·env 는 호출부가 넘긴다.
 */

/** 개인·거래·인증 화면 — 검색 결과에 낼 이유가 없고 로그인 뒤에만 의미가 있다. 접두 일치라 하위 경로도 함께 닫힌다. */
export const ROBOTS_DISALLOWED_PATHS = [
  '/admin',
  '/my',
  '/checkout',
  '/cart',
  '/orders',
  '/gifts',
  '/api',
  '/auth',
  '/onboarding',
  '/settings',
  '/notifications',
  '/tickets',
  '/ticket-checkout',
  '/update-password',
  '/account-suspended',
  '/manager-invitation',
] as const;

/** 사이트맵에 싣는 공개 목록·안내 화면. 카드팩(카드 리워드 스위치)·커뮤니티(비공개)·검색 결과·v2 자리 화면은 넣지 않는다. */
export const SITEMAP_STATIC_PATHS = [
  '/',
  '/shop',
  '/shop/new',
  '/shop/best',
  '/ip',
  '/events',
  '/offline-popups',
  '/stories',
  '/review-events',
  '/help',
  '/about',
  ...LEGAL_DOCUMENT_SLUGS.map((slug) => legalDocumentHref(slug)),
] as const;

export interface SitemapGood {
  id: string;
  updatedAt: string | null;
}

export interface SitemapIp {
  id: string;
  publicSlug: string | null;
  updatedAt: string | null;
}

export interface SitemapCatalog {
  goods: readonly SitemapGood[];
  ips: readonly SitemapIp[];
}

/** 절대 주소 기준. 운영 SITE_URL 을 따르고 없으면 운영 도메인이다(app/shop/[goodId]/structured-data.ts siteOrigin 과 같은 규칙). */
export function publicSiteOrigin(siteUrl: string | undefined = process.env.SITE_URL): string {
  return (siteUrl?.trim() || 'https://iconsip.com').replace(/\/+$/, '');
}

/** 루트 metadataBase — SITE_URL 이 주소 모양이 아니어도 레이아웃이 깨지지 않게 운영 도메인으로 물러선다. */
export function metadataBaseUrl(siteUrl: string | undefined = process.env.SITE_URL): URL {
  try {
    const url = new URL(publicSiteOrigin(siteUrl));
    if (url.protocol === 'https:' || url.protocol === 'http:') return url;
  } catch {
    // 아래 운영 도메인으로 물러선다.
  }
  return new URL('https://iconsip.com');
}

/** 운영과 같은 내용을 다른 주소로 내는 배포(미리보기·스테이징)인가. 로컬 실행(VERCEL_ENV 없음)은 운영 규칙으로 확인한다. */
function isPreviewDeployment(vercelEnv: string | undefined): boolean {
  return vercelEnv === 'preview';
}

export function buildRobots({ origin, vercelEnv }: { origin: string; vercelEnv: string | undefined }): MetadataRoute.Robots {
  if (isPreviewDeployment(vercelEnv)) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOWED_PATHS] },
    sitemap: `${origin}/sitemap.xml`,
  };
}

function lastModified(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function buildSitemap(origin: string, catalog: SitemapCatalog): MetadataRoute.Sitemap {
  const staticEntries = SITEMAP_STATIC_PATHS.map((path) => ({ url: `${origin}${path === '/' ? '' : path}` }));
  const ipEntries = catalog.ips.map((ip) => {
    const modified = lastModified(ip.updatedAt);
    return { url: `${origin}${publicIpHref({ id: ip.id, publicSlug: ip.publicSlug })}`, ...(modified ? { lastModified: modified } : {}) };
  });
  const goodEntries = catalog.goods.map((good) => {
    const modified = lastModified(good.updatedAt);
    return { url: `${origin}${goodDetailHref(good.id)}`, ...(modified ? { lastModified: modified } : {}) };
  });
  return [...staticEntries, ...ipEntries, ...goodEntries];
}

/* 서치어드바이저가 주는 소유확인 값은 영문·숫자 토큰이다. 화면에서 복사한 메타 태그 통째(<meta … content="…">)를 넣어도
   content 값만 쓴다. 모양이 다르면 메타를 내지 않는다(잘못된 값으로 소유확인이 조용히 실패하는 대신 없음으로 드러난다). */
const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

export function naverSiteVerification(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const token = raw.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ?? raw;
  return VERIFICATION_TOKEN.test(token) ? token : null;
}

/** 루트 레이아웃 metadata 의 verification — 값이 없으면 키 자체를 내지 않는다. */
export function siteVerificationMetadata(naverValue: string | undefined): Pick<Metadata, 'verification'> {
  const naver = naverSiteVerification(naverValue);
  return naver ? { verification: { other: { 'naver-site-verification': naver } } } : {};
}
