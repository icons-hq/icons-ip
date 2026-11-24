/**
 * 쇼핑 화면 공개 조회의 짧은 서버 캐시(동접 대비).
 *
 * 상품 상세 한 번에 Supabase 요청이 35~40건 나가고, 대부분은 방문자와 무관한 같은 결과다. 이 fetch 는
 * 허용 목록에 있는 공개 조회만 익명 요청으로 바꿔 함수 인스턴스 메모리에 잠깐(기본 10초) 담고, 같은 키의
 * 동시 요청은 하나의 DB 호출을 함께 기다린다. 허용 목록 밖의 요청(본인 데이터·쓰기·관리자 조회)은 그대로 보낸다.
 *
 * 등급은 DB 함수(내부 helper 포함)·RLS 정의에서 정했다(2026-11-23 운영 정의 대조):
 * - public: 호출자를 보지 않는다 → 누구의 요청이든 익명으로 바꿔 공유한다.
 * - adult: 호출자를 성인 상품 노출 판정(`good_sale_restriction_visible`·`goods_group_public_good`)에만 쓴다 →
 *   성인 인증으로 19금이 열린 방문자(full)만 자기 요청을 그대로 보내고, 나머지는 익명 결과와 같으므로 공유한다.
 * - anonymous: 본인 표시(내 리뷰·내 문의)나 운영자 열람 범위가 섞인다 → 로그인하지 않은 요청만 공유한다.
 * 회원별 계산(구매 한도·쿠폰)이 섞이는 함수(예: get_product_shipping_savings)는 넣지 않는다.
 *
 * 화면이 이 캐시를 쓰려면 `createClient({ storefrontReadCache: true })`로 명시해야 한다 — 결제·관리자 경로는
 * 같은 RPC를 불러도 캐시하지 않는다. 금액·재고·주문 확정은 언제나 주문 RPC가 DB에서 다시 판정한다.
 */

export type StorefrontReadClass = 'public' | 'adult' | 'anonymous';

export const STOREFRONT_READ_CACHE_TTL_MS = 10_000;
/* 목록·홈의 공개 굿즈 전체 조회(옵션 포함)도 한 항목에 담기도록 넉넉히 둔다. */
const MAX_ENTRY_CHARS = 4 * 1024 * 1024;
/* 본문·키·헤더·항목 고정 비용을 합친 상한(문자 수, 인스턴스당 약 100MB)과 항목 수 상한. 봇이 임의 상품 주소를
   훑어 빈 응답 항목이 쌓여도 이 안에서 오래된 것부터 비운다. */
const MAX_TOTAL_CHARS = 48 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const ENTRY_OVERHEAD_CHARS = 512;
/* DB(statement_timestamp)와 함수 인스턴스의 시계 차이 여유. */
const CLOCK_SKEW_MS = 1_000;

const RPC_CLASSES: Readonly<Record<string, StorefrontReadClass>> = {
  // 호출자를 보지 않는 공개 함수(내부 helper까지 auth.* 참조 없음)
  get_good_return_pickup: 'public',
  get_good_selected_reviews_v2: 'public',
  get_goods_review_events: 'public',
  get_home_layout_order: 'public',
  get_home_product_collections: 'public',
  get_masked_adult_goods: 'public',
  get_product_detail_experience_config: 'public',
  get_return_fee_deduction_policy: 'public',
  /* 상세 주소 끝 값 → 공개 상품의 id·상품 자동코드(ADR-0050). 19금 판매 표면 스위치만 보고 호출자는 보지 않는다. */
  resolve_public_goods_address: 'public',
  // 성인 상품 노출 판정에만 호출자를 쓰는 함수
  get_good_after_sales_content: 'adult',
  get_good_announcements: 'adult',
  get_good_attribute_rows: 'adult',
  get_good_benefit_content: 'adult',
  get_good_group: 'adult',
  get_good_media: 'adult',
  get_good_other_compositions: 'adult',
  get_good_relation_compositions: 'adult',
  get_good_shipping_policy: 'adult',
  get_good_shipping_region_fees: 'adult',
  get_good_size_chart: 'adult',
  get_goods_listing_appearance: 'adult',
  get_goods_review_summaries: 'adult',
  get_goods_transaction_offers_v3: 'adult',
  get_product_detail_experience: 'adult',
  get_product_detail_presentation: 'adult',
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

/*
 * 판매 기간·옵션 가격·예약 공급·공지·추천처럼 시각에 따라 바뀌는 응답은 DB가 현재 시각으로 계산하고 다음 전환
 * 시각을 함께 싣는다. 화면은 그 시각에 한 번 새로고침하므로, 전환을 걸친 옛 응답을 내주면 새로고침이 옛 응답을 받고
 * 타이머도 다시 걸리지 않는다. 응답 안의 전환·시작·종료 시각을 모두 경계로 본다.
 */
const BOUNDARY_KEY_PATTERN = /"(nextChangeAt|next_change_at|startsAt|starts_at|endsAt|ends_at|activeFrom|active_from|activeTo|active_to)"\s*:\s*"([^"]{10,40})"/g;

/**
 * 조회를 `startedAt`에 시작한 응답에서 그 뒤에 오는 가장 이른 경계 시각.
 * 다음 전환 시각(nextChangeAt)은 DB가 계산 시점의 미래로만 싣는다 — DB 시계가 조금 늦어 전환 전 상태를 계산했어도
 * 잡히도록 시계 차이만큼 앞까지 본다. 시작·종료 시각은 이미 지난 값(예: 열린 판매의 시작 시각)도 실리므로 그대로 본다.
 */
export function earliestFutureBoundary(body: string, startedAt: number): number | null {
  let earliest: number | null = null;
  for (const match of body.matchAll(BOUNDARY_KEY_PATTERN)) {
    const at = Date.parse(match[2]);
    const after = match[1] === 'nextChangeAt' || match[1] === 'next_change_at' ? startedAt - CLOCK_SKEW_MS : startedAt;
    if (Number.isFinite(at) && at > after && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest;
}

type CachedResponse = { status: number; statusText: string; headers: [string, string][]; body: string };
type Entry = CachedResponse & { expiresAt: number; cost: number };
/* boundary: 조회를 시작한 뒤 처음 오는 경계 시각. 그 시각 이후에 들어온 요청은 이 응답을 쓰지 않는다. */
type Loaded = { value: CachedResponse; boundary: number | null };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<Loaded>>();
let totalCost = 0;

function removeEntry(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  totalCost -= entry.cost;
  entries.delete(key);
}

function entryCost(key: string, value: CachedResponse) {
  return value.body.length + key.length + ENTRY_OVERHEAD_CHARS
    + value.headers.reduce((sum, [name, headerValue]) => sum + name.length + headerValue.length, 0);
}

function storeEntry(key: string, value: CachedResponse, expiresAt: number, now: number) {
  if (value.status !== 200 || value.body.length > MAX_ENTRY_CHARS || expiresAt <= now) return;
  removeEntry(key);
  const cost = entryCost(key, value);
  entries.set(key, { ...value, expiresAt, cost });
  totalCost += cost;
  /* Map 은 넣은 순서를 지킨다 — 만료된 항목과 가장 오래 안 쓴 항목부터 비운다. */
  for (const [oldestKey, oldest] of entries) {
    if (oldest.expiresAt > now && totalCost <= MAX_TOTAL_CHARS && entries.size <= MAX_ENTRIES) break;
    removeEntry(oldestKey);
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

  /* 같은 키의 조회 하나를 시작하거나 진행 중인 조회에 합류한다. */
  function load(key: string, url: string, init: RequestInit): Promise<Loaded> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const startedAt = now();
    const pending = baseFetch(url, init)
      .then(readResponse)
      .then((value) => {
        const storedAt = now();
        /* DB는 시작~완료 사이 어느 시각으로 계산했다. 시작 뒤의 첫 경계가 이미 지났거나 곧 오면 담지 않는다. */
        const boundary = earliestFutureBoundary(value.body, startedAt);
        if (boundary === null) storeEntry(key, value, storedAt + ttlMs, storedAt);
        else if (boundary > storedAt + CLOCK_SKEW_MS) storeEntry(key, value, Math.min(storedAt + ttlMs, boundary), storedAt);
        return { value, boundary };
      })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, pending);
    return pending;
  }

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
    const joinedAt = now();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > joinedAt) {
      /* 최근에 쓴 항목을 뒤로 옮겨 오래 안 쓴 항목부터 비운다. */
      entries.delete(key); entries.set(key, hit);
      return toResponse(hit);
    }
    if (hit) removeEntry(key);

    /* 호출자 한 명의 중단 신호가 함께 기다리는 요청을 끊지 않도록 signal 은 넘기지 않는다. */
    const { signal: _signal, ...rest } = init ?? {};
    void _signal;
    const sharedInit: RequestInit = { ...rest, method, headers };
    let loaded = await load(key, url, sharedInit);
    /* 경계(예: 판매 오픈) 전에 시작한 조회에 경계 무렵 합류했다면 그 응답을 쓰지 않고 경계 뒤 조회를 함께 기다린다. */
    if (loaded.boundary !== null && loaded.boundary <= joinedAt + CLOCK_SKEW_MS) loaded = await load(key, url, sharedInit);
    return toResponse(loaded.value);
  };
}

/** 시험 전용 — 모듈 전역 캐시를 비운다. */
export function resetStorefrontReadCacheForTests() {
  entries.clear();
  inflight.clear();
  totalCost = 0;
}
