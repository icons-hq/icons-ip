/**
 * 운영 도메인의 단일 출처. iconsip.com → xsquare.kr 전환 절차는 docs/runbooks/domain-migration-xsquare.md 가 정본이다.
 *
 * 전환 1단계(병행)에서는 정규 주소를 그대로 두고 새 도메인을 함께 받는다. 3단계(전환)에서
 * CANONICAL_SITE_ORIGIN 과 운영 env SITE_URL 을 같이 바꾼다. 앱 코드와 node 스크립트
 * (scripts/check-vercel-build-env.mjs)가 함께 읽으므로 .mjs 로 둔다.
 */

/** 정규 운영 주소. SITE_URL 이 없을 때의 절대 주소(OG·사이트맵·메일 링크)와 로그인 기본 출처다. */
export const CANONICAL_SITE_ORIGIN = 'https://iconsip.com';

/** 운영 등록 도메인(루트). 각 도메인의 www 도 운영 호스트다. */
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
