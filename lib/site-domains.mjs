/**
 * 운영 도메인의 단일 출처. iconsip.com → xsquare.kr 전환 절차는 docs/runbooks/domain-migration-xsquare.md 가 정본이다.
 *
 * 3단계(전환, 2026-11-25)에서 정규 주소를 xsquare.kr 로 바꿨다. 옛 도메인 iconsip.com 은 Vercel 도메인 설정이
 * 경로를 유지한 채 xsquare.kr 로 308 리디렉션한다. 그래도 운영 도메인 목록에는 남긴다 — 드레인 중인 코페이 콜백과
 * env 만으로 되돌리는 경로(runbook '되돌리기')가 옛 origin 을 받아야 한다. 앱 코드와 node 스크립트
 * (scripts/check-vercel-build-env.mjs·scripts/post-deploy-smoke.mjs)가 함께 읽으므로 .mjs 로 둔다.
 */

/** 정규 운영 주소. SITE_URL 이 없을 때의 절대 주소(OG·사이트맵·메일 링크)와 로그인 기본 출처다. */
export const CANONICAL_SITE_ORIGIN = 'https://xsquare.kr';

/** 운영 등록 도메인(루트). 각 도메인의 www 도 운영 호스트다. iconsip.com 은 리디렉션만 하는 옛 도메인이다. */
export const PRODUCTION_SITE_DOMAINS = Object.freeze(['iconsip.com', 'xsquare.kr']);

/**
 * 운영 SITE_URL 로 받는 origin — 결제 returnUrl·KCP Ret_URL·빌드 env 검사가 쓴다.
 * PG·KCP 에 등록하는 주소가 루트라서 www 는 받지 않는다.
 */
export const PRODUCTION_SITE_ORIGINS = Object.freeze(PRODUCTION_SITE_DOMAINS.map((domain) => `https://${domain}`));

/** 운영 호스트(루트·www). 로그인 출처 허용이 쓴다. */
export const PRODUCTION_SITE_HOSTS = Object.freeze(PRODUCTION_SITE_DOMAINS.flatMap((domain) => [domain, `www.${domain}`]));

/** @param {string} origin */
export function isProductionSiteOrigin(origin) {
  return PRODUCTION_SITE_ORIGINS.includes(origin);
}

/**
 * 운영 도메인 자신이나 그 하위 호스트인가(어드민 상품 주소 붙여넣기). 대소문자는 가리지 않는다.
 * @param {string} hostname
 */
export function isProductionSiteHostname(hostname) {
  const host = String(hostname).toLowerCase();
  return PRODUCTION_SITE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
