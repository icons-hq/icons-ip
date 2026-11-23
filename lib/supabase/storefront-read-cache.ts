/**
 * 쇼핑 화면 공개 조회의 짧은 서버 캐시(동접 대비).
 *
 * 상품 상세 한 번에 Supabase 요청이 35~40건 나가고, 대부분은 방문자와 무관한 같은 결과다. 이 fetch 는
 * 허용 목록에 있는 공개 조회만 익명 요청으로 바꿔 함수 인스턴스 메모리에 잠깐(기본 10초) 담고, 같은 키의
 * 동시 요청은 하나의 DB 호출을 함께 기다린다. 허용 목록 밖의 요청(본인 데이터·쓰기·관리자 조회)은 그대로 보낸다.
 *
 * 등급은 DB 함수·RLS 정의에서 정했다(2026-11-23 운영 정의 대조):
 * - public: 호출자를 보지 않는다 → 누구의 요청이든 익명으로 바꿔 공유한다.
 * - adult: 호출자를 성인 상품 노출 판정(`good_sale_restriction_visible`)에만 쓴다 → 성인 인증으로 19금이
 *   열린 방문자(full)만 자기 요청을 그대로 보내고, 나머지는 익명 결과와 같으므로 공유한다.
 * - anonymous: 본인 표시(내 리뷰·내 문의)나 운영자 열람 범위가 섞인다 → 로그인하지 않은 요청만 공유한다.
 *
 * 화면이 이 캐시를 쓰려면 `createClient({ storefrontReadCache: true })`로 명시해야 한다 — 결제·관리자 경로는
 * 같은 RPC를 불러도 캐시하지 않는다. 금액·재고·주문 확정은 언제나 주문 RPC가 DB에서 다시 판정한다.
 */

export type StorefrontReadClass = 'public' | 'adult' | 'anonymous';

export const STOREFRONT_READ_CACHE_TTL_MS = 10_000;
/* 목록·홈의 공개 굿즈 전체 조회(옵션 포함)도 한 항목에 담기도록 넉넉히 둔다. 인스턴스당 최대 약 100MB. */
const MAX_ENTRY_CHARS = 4 * 1024 * 1024;
const MAX_TOTAL_CHARS = 48 * 1024 * 1024;

const RPC_CLASSES: Readonly<Record<string, StorefrontReadClass>> = {
  // 호출자를 보지 않는 공개 함수
  get_good_group: 'public',
  get_good_return_pickup: 'public',
  get_good_selected_reviews_v2: 'public',
  get_goods_review_events: 'public',
  get_goods_review_summaries: 'public',
  get_goods_transaction_offers_v3: 'public',
  get_home_layout_order: 'public',
  get_home_product_collections: 'public',
  get_masked_adult_goods: 'public',
  get_product_detail_experience_config: 'public',
  get_return_fee_deduction_policy: 'public',
  // 성인 상품 노출 판정에만 호출자를 쓰는 함수
  get_good_after_sales_content: 'adult',
  get_good_announcements: 'adult',
  get_good_attribute_rows: 'adult',
  get_good_benefit_content: 'adult',
  get_good_media: 'adult',
  get_good_other_compositions: 'adult',
  get_good_relation_compositions: 'adult',
  get_good_shipping_policy: 'adult',
  get_good_shipping_region_fees: 'adult',
  get_good_size_chart: 'adult',
  get_goods_listing_appearance: 'adult',
  get_product_detail_experience: 'adult',
  get_product_detail_presentation: 'adult',
  get_product_shipping_savings: 'adult',
  // 본인 표시가 섞이는 함수(helpfulByMe·isMine, 내 비공개 문의)
  get_good_group_reviews_v3: 'anonymous',
  good_product_questions: 'anonymous',
};

/** RLS가 모두에게 같은 행을 여는 표(`using (true)`). */
const PUBLIC_TABLES = new Set(['ips', 'verticals', 'cards', 'events']);
/** 운영자·본인이 더 많이 보는 표 — 로그인하지 않은 요청만 공유한다. */
const ANONYMOUS_TABLES = new Set(['home_curations', 'campaigns', 'campaign_presentations']);

/** 캐시해도 되는 공개 조회면 등급을, 아니면 null 을 돌려준다. */
export function classifyStorefrontRead(method: string, rawUrl: string): StorefrontReadClass | null {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  const path = url.pathname;
  const upper = method.toUpperCase();
  const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path);
  if (rpc) return (upper === 'POST' || upper === 'GET') ? RPC_CLASSES[rpc[1]] ?? null : null;
  if (upper !== 'GET') return null;
  const table = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(path)?.[1];
  if (!table) return null;
  if (PUBLIC_TABLES.has(table)) return 'public';
  if (ANONYMOUS_TABLES.has(table)) return 'anonymous';
  /* goods 는 운영자 읽기 정책이 따로 있다. 공개·비보관 필터를 건 조회만 공개 RLS와 같은 행이 된다. */
  if (table === 'goods'
    && url.searchParams.getAll('published_at').includes('not.is.null')
    && url.searchParams.getAll('archived_at').includes('is.null')) return 'adult';
  return null;
}

type CachedResponse = { status: number; statusText: string; headers: [string, string][]; body: string };
type Entry = CachedResponse & { expiresAt: number };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<CachedResponse>>();
let totalChars = 0;

function removeEntry(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  totalChars -= entry.body.length;
  entries.delete(key);
}

function storeEntry(key: string, value: CachedResponse, expiresAt: number) {
  if (value.status !== 200 || value.body.length > MAX_ENTRY_CHARS) return;
  removeEntry(key);
  entries.set(key, { ...value, expiresAt });
  totalChars += value.body.length;
  /* Map 은 넣은 순서를 지킨다 — 가장 오래 안 쓴 항목부터 비운다. */
  for (const oldest of entries.keys()) {
    if (totalChars <= MAX_TOTAL_CHARS) break;
    removeEntry(oldest);
  }
}

const SKIPPED_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

function toResponse(value: CachedResponse): Response {
  return new Response(value.body, { status: value.status, statusText: value.statusText, headers: value.headers });
}

async function readResponse(response: Response): Promise<CachedResponse> {
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => { if (!SKIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) headers.push([name, value]); });
  return { status: response.status, statusText: response.statusText, headers, body: await response.text() };
}

export interface StorefrontReadCacheOptions {
  /** 익명 요청의 Authorization 값(`Bearer <공개 키>`)을 만드는 공개 키. */
  anonKey: string;
  /** 이 요청의 방문자에게 성인 인증으로 19금 상품이 열려 있는지(full). 성인 등급 조회에서만 묻는다. */
  viewerSeesAdultGoods: () => Promise<boolean>;
  baseFetch?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return init?.method ?? (input instanceof Request ? input.method : 'GET');
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

export function createStorefrontReadCacheFetch(options: StorefrontReadCacheOptions): typeof fetch {
  const baseFetch = options.baseFetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const ttlMs = options.ttlMs ?? STOREFRONT_READ_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const anonAuthorization = `Bearer ${options.anonKey}`;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = requestMethod(input, init).toUpperCase();
    const url = requestUrl(input);
    const readClass = classifyStorefrontRead(method, url);
    /* Request 객체 본문은 다시 읽을 수 없어 키를 만들지 않는다 — supabase-js 는 (url, init)으로 부른다. */
    if (!readClass || input instanceof Request) return baseFetch(input, init);
    const body = init?.body == null ? '' : typeof init.body === 'string' ? init.body : null;
    if (body === null) return baseFetch(input, init);

    const headers = new Headers(init?.headers);
    const anonymous = headers.get('authorization') === anonAuthorization;
    if (readClass === 'anonymous' && !anonymous) return baseFetch(input, init);
    if (readClass === 'adult' && !anonymous) {
      /* 판정하지 못하면 공유하지 않고 자기 세션으로 읽는다 — 캐시는 빨라지는 길일 뿐 결과를 바꾸지 않는다. */
      const seesAdultGoods = await options.viewerSeesAdultGoods().catch(() => true);
      if (seesAdultGoods) return baseFetch(input, init);
    }
    headers.set('authorization', anonAuthorization);

    const key = JSON.stringify([method, url, body, ['accept', 'prefer', 'range', 'accept-profile', 'content-profile'].map(name => headers.get(name) ?? '')]);
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now()) {
      /* 최근에 쓴 항목을 뒤로 옮겨 오래 안 쓴 항목부터 비운다. */
      entries.delete(key); entries.set(key, hit);
      return toResponse(hit);
    }
    if (hit) removeEntry(key);

    let pending = inflight.get(key);
    if (!pending) {
      /* 호출자 한 명의 중단 신호가 함께 기다리는 요청을 끊지 않도록 signal 은 넘기지 않는다. */
      const { signal: _signal, ...rest } = init ?? {};
      void _signal;
      pending = baseFetch(url, { ...rest, method, headers })
        .then(readResponse)
        .then((value) => { storeEntry(key, value, now() + ttlMs); return value; })
        .finally(() => { inflight.delete(key); });
      inflight.set(key, pending);
    }
    return toResponse(await pending);
  };
}

/** 시험 전용 — 모듈 전역 캐시를 비운다. */
export function resetStorefrontReadCacheForTests() {
  entries.clear();
  inflight.clear();
  totalChars = 0;
}
