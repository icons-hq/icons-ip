/**
 * 전시 상품 선택기의 "URL로 추가"(10/14 회의 A11). 운영자가 붙여 넣은 상품 상세 주소에서 주소 끝 값만 꺼낸다.
 * 주소 끝 값은 상품 자동코드의 소문자형(`/shop/hsq-0059`, ADR-0050)이거나 예전 주소의 상품 URL(goods.id)이다 — 어느 쪽인지는
 * 조회(GoodUrlAddField·admin_resolve_goods_references)가 가린다.
 * 받는 값: `/shop/{값}`, 운영 도메인(lib/site-domains.mjs — iconsip.com·xsquare.kr, www·하위 도메인 포함)의 `https://…/shop/{값}`와 스킴 없는 주소,
 * 지금 어드민을 연 호스트(스테이징·로컬)의 같은 경로. 목록(`/shop`·`/shop/new`·`/shop/best`)과 다른 사이트 주소는 거절한다.
 */
import { CANONICAL_SITE_ORIGIN, isProductionSiteHostname } from '@/lib/site-domains.mjs';

const CANONICAL_HOST = new URL(CANONICAL_SITE_ORIGIN).host;

export const GOOD_URL_ERRORS = {
  empty: '상품 상세 주소를 붙여 넣어주세요.',
  invalid: `상품 상세 주소가 아닙니다. 상품 페이지 주소(예: ${CANONICAL_SITE_ORIGIN}/shop/hsq-0059 또는 /shop/hsq-0059)를 붙여 넣어주세요.`,
  host: `ICONS 상품 주소만 추가할 수 있습니다. ${CANONICAL_HOST}의 상품 페이지 주소를 붙여 넣어주세요.`,
  notFound: '이 주소의 상품을 찾지 못했습니다. 보관됐거나 이 목록에서 고를 수 없는 상품인지 확인해주세요.',
  exists: '이미 추가된 상품입니다.',
} as const;

/* 상품 URL(영문 소문자·숫자·하이픈)과 주소로 쓰는 상품 자동코드(영문·숫자·`._-`, 100자 이하 — lib/goods-display)를 함께 받는다. */
const GOOD_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
const COLLECTIONS = new Set(['new', 'best']);

export type GoodUrlResult = { ok: true; id: string } | { ok: false; error: string };

export function parseGoodUrl(input: string, currentHost?: string | null): GoodUrlResult {
  const value = input.trim();
  if (!value) return { ok: false, error: GOOD_URL_ERRORS.empty };
  let url: URL;
  try {
    url = value.startsWith('/') ? new URL(value, CANONICAL_SITE_ORIGIN)
      : new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch { return { ok: false, error: GOOD_URL_ERRORS.invalid }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: GOOD_URL_ERRORS.invalid };
  const host = url.host.toLowerCase();
  if (!value.startsWith('/') && !isProductionSiteHostname(url.hostname) && host !== currentHost?.toLowerCase()) return { ok: false, error: GOOD_URL_ERRORS.host };
  const match = /^\/shop\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return { ok: false, error: GOOD_URL_ERRORS.invalid };
  let id: string;
  try { id = decodeURIComponent(match[1]); } catch { return { ok: false, error: GOOD_URL_ERRORS.invalid }; }
  if (COLLECTIONS.has(id) || !GOOD_ID.test(id)) return { ok: false, error: GOOD_URL_ERRORS.invalid };
  return { ok: true, id };
}

/**
 * 서버 검색은 부분 일치라 짧은 ID는 여러 쪽에 걸칠 수 있다. 정확히 같은 ID가 나올 때까지 몇 쪽만 넘겨 본다.
 * 주소 끝 값이 상품 자동코드(소문자, ADR-0050)면 같은 코드의 행도 받는다 — 상품 URL이 같은 행을 먼저 고른다.
 */
export async function findGoodById<T extends { id: string; code?: string | null }>(id: string, searchPage: (page: number) => Promise<{ rows: T[]; total: number; pageSize?: number } | null>, maxPages = 5): Promise<T | null> {
  const code = id.toUpperCase();
  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPage(page);
    if (!result) return null;
    const found = result.rows.find(row => row.id === id) ?? result.rows.find(row => typeof row.code === 'string' && row.code === code);
    if (found) return found;
    if (page * (result.pageSize ?? 20) >= result.total) return null;
  }
  return null;
}
