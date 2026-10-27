/**
 * 전시 상품 선택기의 "URL로 추가"(10/14 회의 A11). 운영자가 붙여 넣은 상품 상세 주소에서 상품 ID만 꺼낸다.
 * 받는 값: `/shop/{id}`, `https://iconsip.com/shop/{id}`(www·하위 도메인 포함), 스킴 없는 `iconsip.com/shop/{id}`,
 * 지금 어드민을 연 호스트(스테이징·로컬)의 같은 경로. 목록(`/shop`·`/shop/new`·`/shop/best`)과 다른 사이트 주소는 거절한다.
 */
export const GOOD_URL_ERRORS = {
  empty: '상품 상세 주소를 붙여 넣어주세요.',
  invalid: '상품 상세 주소가 아닙니다. 상품 페이지 주소(예: https://iconsip.com/shop/상품ID 또는 /shop/상품ID)를 붙여 넣어주세요.',
  host: 'ICONS 상품 주소만 추가할 수 있습니다. iconsip.com의 상품 페이지 주소를 붙여 넣어주세요.',
  notFound: '이 주소의 상품을 찾지 못했습니다. 보관됐거나 이 목록에서 고를 수 없는 상품인지 확인해주세요.',
  exists: '이미 추가된 상품입니다.',
} as const;

const GOOD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLLECTIONS = new Set(['new', 'best']);
const ICONS_HOST = /^(?:[a-z0-9-]+\.)*iconsip\.com$/i;

export type GoodUrlResult = { ok: true; id: string } | { ok: false; error: string };

export function parseGoodUrl(input: string, currentHost?: string | null): GoodUrlResult {
  const value = input.trim();
  if (!value) return { ok: false, error: GOOD_URL_ERRORS.empty };
  let url: URL;
  try {
    url = value.startsWith('/') ? new URL(value, 'https://iconsip.com')
      : new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch { return { ok: false, error: GOOD_URL_ERRORS.invalid }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: GOOD_URL_ERRORS.invalid };
  const host = url.host.toLowerCase();
  if (!value.startsWith('/') && !ICONS_HOST.test(url.hostname) && host !== currentHost?.toLowerCase()) return { ok: false, error: GOOD_URL_ERRORS.host };
  const match = /^\/shop\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return { ok: false, error: GOOD_URL_ERRORS.invalid };
  let id: string;
  try { id = decodeURIComponent(match[1]); } catch { return { ok: false, error: GOOD_URL_ERRORS.invalid }; }
  if (COLLECTIONS.has(id) || !GOOD_ID.test(id)) return { ok: false, error: GOOD_URL_ERRORS.invalid };
  return { ok: true, id };
}

/**
 * 서버 검색은 부분 일치라 짧은 ID는 여러 쪽에 걸칠 수 있다. 정확히 같은 ID가 나올 때까지 몇 쪽만 넘겨 본다.
 */
export async function findGoodById<T extends { id: string }>(id: string, searchPage: (page: number) => Promise<{ rows: T[]; total: number; pageSize?: number } | null>, maxPages = 5): Promise<T | null> {
  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPage(page);
    if (!result) return null;
    const found = result.rows.find(row => row.id === id);
    if (found) return found;
    if (page * (result.pageSize ?? 20) >= result.total) return null;
  }
  return null;
}
