import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { RarityKey } from '@/lib/rarity';
import type { Stock } from '@/lib/data';
import type { GoodsNoticeInfo } from '@/lib/goods-notice';
import { imageUrlFromBg, normalizePublicMediaPath } from '@/lib/media';

export interface AdminIpRecord {
  id: string;
  archivedAt: string | null;
  title: string;
  sub: string | null;
  verticalKey: string;
  tagline: string | null;
  synopsis: string | null;
  glyph: string | null;
  bg: string | null;
  imagePath: string | null;
  imageUrl?: string | null;
  featured: boolean;
  fansCount: number;
}

/**
 * 굿즈 판매 제한 유형 (#392). DB enum `public.goods_sale_restriction` 과 같은 목록이다.
 * 'adult' 는 성인인증 도입 전까지 스토어에서 숨기고 결제를 전용 PG로 분기한다.
 */
export type AdminGoodSaleRestriction = 'none' | 'adult';

export interface AdminGoodRecord {
  id: string;
  archivedAt: string | null;
  ipId: string;
  name: string;
  type: string;
  price: number;
  /** 취소선으로 표기할 정가 (#326). 할인 중일 때만 값이 있다. */
  compareAtPrice: number | null;
  badge: string | null;
  stock: Stock;
  stockQty: number;
  /** 무통장 입금 허용 여부 (#256). 한정 드롭은 꺼서 24시간 재고 잠김을 막는다. */
  allowBankTransfer: boolean;
  /** 판매 제한 유형 (#392). 'adult' 는 노출·구매를 막고 결제 PG를 코페이로 분기한다. */
  saleRestriction: AdminGoodSaleRestriction;
  bg: string | null;
  imagePath: string | null;
  imageUrl?: string | null;
  notice: GoodsNoticeInfo;
  description: string | null;
  galleryPaths: string[];
  galleryUrls: string[];
  detailImagePath: string | null;
  detailImageUrl: string | null;
}

export interface AdminCardRecord {
  id: string;
  archivedAt: string | null;
  ipId: string;
  poolId: string | null;
  name: string;
  no: string | null;
  rarity: RarityKey;
  bg: string | null;
  imagePath: string | null;
  imageUrl?: string | null;
}

export interface AdminCardPoolRecord {
  id: string;
  ipId: string;
  name: string;
  activeFrom: string;
  activeTo: string | null;
  updatedAt: string;
  status: AdminCardPoolStatus;
  oddsConfigured: boolean;
  rewardReady: boolean;
  odds: Record<RarityKey, number>;
}

export type AdminCardPoolStatus = 'scheduled' | 'active' | 'ended';

export function getAdminCardPoolStatus(
  activeFrom: string,
  activeTo: string | null,
  now = Date.now(),
): AdminCardPoolStatus {
  if (now < Date.parse(activeFrom)) return 'scheduled';
  if (activeTo && now >= Date.parse(activeTo)) return 'ended';
  return 'active';
}

export type AdminRewardPolicyStatus = 'inactive' | 'scheduled' | 'active' | 'ended' | 'pool-unavailable';

interface AdminRewardPolicyPoolState {
  activeFrom: string;
  activeTo: string | null;
  ready: boolean;
}

export function getAdminRewardPolicyStatus(
  policy: { active: boolean; activeFrom: string; activeTo: string | null },
  pool: AdminRewardPolicyPoolState | null,
  now = Date.now(),
): AdminRewardPolicyStatus {
  if (!policy.active) return 'inactive';
  if (now < Date.parse(policy.activeFrom)) return 'scheduled';
  if (policy.activeTo && now >= Date.parse(policy.activeTo)) return 'ended';
  if (!pool || !pool.ready || getAdminCardPoolStatus(pool.activeFrom, pool.activeTo, now) !== 'active') {
    return 'pool-unavailable';
  }
  return 'active';
}

export interface AdminRewardPolicyRecord {
  id: string;
  poolId: string;
  trigger: 'order_paid';
  targetIpId: string;
  targetGoodId: string | null;
  minAmount: number;
  ticketsPerGrant: number;
  active: boolean;
  activeFrom: string;
  activeTo: string | null;
  createdAt: string;
  updatedAt: string;
  issuedCount: number;
  availableCount: number;
  openedCount: number;
  revokedCount: number;
  orderCount: number;
  lastIssuedAt: string | null;
  status: AdminRewardPolicyStatus;
}

export type AdminGameStatus = 'scheduled' | 'active' | 'ended' | 'pool-unavailable';
export type AdminGameVariantKind = 'card' | 'goods' | 'unknown';

interface AdminGamePoolState {
  activeFrom: string;
  activeTo: string | null;
  ready: boolean;
}

export function getAdminGameStatus(
  game: {
    activeFrom: string;
    activeTo: string | null;
    variantKind: AdminGameVariantKind;
  },
  pool: AdminGamePoolState | null,
  now = Date.now(),
): AdminGameStatus {
  if (now < Date.parse(game.activeFrom)) return 'scheduled';
  if (game.activeTo && now >= Date.parse(game.activeTo)) return 'ended';

  if (game.variantKind === 'card') {
    const poolCoversGame = Boolean(
      pool
      && pool.ready
      && Date.parse(pool.activeFrom) <= Date.parse(game.activeFrom)
      && (
        game.activeTo
          ? (!pool.activeTo || Date.parse(pool.activeTo) >= Date.parse(game.activeTo))
          : !pool.activeTo
      ),
    );
    if (!poolCoversGame) return 'pool-unavailable';
  }

  return 'active';
}

export interface AdminGameRecord {
  id: string;
  type: string;
  title: string;
  variantKind: AdminGameVariantKind;
  marbleCount: number | null;
  rewardPoolId: string | null;
  rewardPoolName: string | null;
  ipId: string | null;
  ipTitle: string | null;
  eventId: string | null;
  eventTitle: string | null;
  perUserDailyLimit: number;
  activeFrom: string;
  activeTo: string | null;
  createdAt: string;
  updatedAt: string;
  playCount: number;
  lastPlayedAt: string | null;
  hasPlays: boolean;
  status: AdminGameStatus;
}

export interface AdminEventRecord {
  id: string;
  archivedAt: string | null;
  ipId: string | null;
  title: string;
  mode: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  accent: string | null;
  bg: string | null;
  imagePath: string | null;
  imageUrl?: string | null;
}

export interface AdminTicketTypeRecord {
  id: string;
  eventId: string;
  eventTitle: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  hasTicketHistory: boolean;
  updatedAt: string;
}

export interface AdminCatalogRecords {
  ips: AdminIpRecord[];
  goods: AdminGoodRecord[];
  cards: AdminCardRecord[];
  cardPools: AdminCardPoolRecord[];
  rewardPolicies: AdminRewardPolicyRecord[];
  games: AdminGameRecord[];
  events: AdminEventRecord[];
  ticketTypes: AdminTicketTypeRecord[];
}

/** 로더가 실제로 조회할 레코드 종류. 화면 하나가 8종을 전부 끌어오지 않게 고르는 단위다. */
export type AdminCatalogRecordKind = keyof AdminCatalogRecords;

const ADMIN_CATALOG_RECORD_KINDS: readonly AdminCatalogRecordKind[] = [
  'ips',
  'goods',
  'cards',
  'cardPools',
  'rewardPolicies',
  'games',
  'events',
  'ticketTypes',
];

/*
 * 파생값이 다른 종류의 행을 필요로 하는 지점.
 *
 * 카드풀의 `rewardReady`는 풀에 묶인 카드가 등급별로 있는지 봐야 계산되고,
 * 발급 정책의 status는 카드풀 상태를, 티켓 회차의 `eventTitle`은 이벤트 제목을 본다.
 * 요청한 종류만 쿼리하면 이 파생값이 조용히 틀린 답(전부 `pool-unavailable`, 제목 대신 id)이
 * 되므로, 의존하는 종류는 반환하지 않더라도 조회는 한다.
 */
const ADMIN_CATALOG_RECORD_DEPENDENCIES: Record<AdminCatalogRecordKind, readonly AdminCatalogRecordKind[]> = {
  ips: [],
  goods: [],
  cards: [],
  cardPools: ['cards'],
  rewardPolicies: ['cardPools'],
  games: [],
  events: [],
  ticketTypes: ['events'],
};

function resolveQueriedKinds(
  include: readonly AdminCatalogRecordKind[] | undefined,
): Set<AdminCatalogRecordKind> {
  if (!include) return new Set(ADMIN_CATALOG_RECORD_KINDS);

  const queried = new Set<AdminCatalogRecordKind>();
  const visit = (kind: AdminCatalogRecordKind) => {
    if (queried.has(kind)) return;
    queried.add(kind);
    for (const dependency of ADMIN_CATALOG_RECORD_DEPENDENCIES[kind]) visit(dependency);
  };
  for (const kind of include) visit(kind);
  return queried;
}

/* 조회하지 않은 종류 자리에 넣는 빈 결과. 아래 error 검사·매핑 코드를 그대로 태우기 위해서다. */
const skippedResult = Promise.resolve({ data: [] as never[], error: null as { message: string } | null });

interface IpRow {
  id: string;
  archived_at: string | null;
  title: string;
  sub: string | null;
  vertical_key: string;
  tagline: string | null;
  synopsis: string | null;
  glyph: string | null;
  bg: string | null;
  image_path: string | null;
  featured: boolean;
  fans_count: number;
}

interface GoodRow {
  id: string;
  archived_at: string | null;
  ip_id: string;
  name: string;
  type: string;
  price: number;
  compare_at_price: number | null;
  badge: string | null;
  stock: Stock;
  stock_qty: number | null;
  allow_bank_transfer: boolean | null;
  sale_restriction: AdminGoodSaleRestriction | null;
  bg: string | null;
  image_path: string | null;
  notice_maker: string | null;
  notice_origin: string | null;
  notice_material: string | null;
  notice_size: string | null;
  notice_made_on: string | null;
  notice_as_manager: string | null;
  notice_as_contact: string | null;
  description: string | null;
  gallery_paths: string[] | null;
  detail_image_path: string | null;
}

interface CardRow {
  id: string;
  archived_at: string | null;
  ip_id: string;
  pool_id: string | null;
  name: string;
  no: string | null;
  rarity: RarityKey;
  bg: string | null;
  image_path: string | null;
}

interface CardPoolRow {
  id: string;
  ip_id: string;
  name: string;
  active_from: string;
  active_to: string | null;
  updated_at: string;
  pool_odds: Array<{ rarity: RarityKey; probability: number | string }> | null;
}

interface EventRow {
  id: string;
  archived_at: string | null;
  ip_id: string | null;
  title: string;
  mode: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  accent: string | null;
  bg: string | null;
  image_path: string | null;
}

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  tickets: { id: string }[] | null;
  updated_at: string;
}

interface RewardPolicyRow {
  id: string;
  pool_id: string;
  trigger: string;
  target_ip_id: string;
  target_good_id: string | null;
  min_amount: number | string;
  tickets_per_grant: number;
  active: boolean;
  active_from: string;
  active_to: string | null;
  created_at: string;
  updated_at: string;
  issued_count: number | string;
  available_count: number | string;
  opened_count: number | string;
  revoked_count: number | string;
  order_count: number | string;
  last_issued_at: string | null;
}

interface GameRow {
  id: string;
  type: string;
  title: string;
  event_id: string | null;
  event_title: string | null;
  config: unknown;
  variant_kind: string | null;
  marble_count: number | string | null;
  reward_pool_id: string | null;
  reward_pool_name: string | null;
  reward_pool_active_from: string | null;
  reward_pool_active_to: string | null;
  reward_pool_ready: boolean | null;
  ip_id: string | null;
  ip_title: string | null;
  per_user_daily_limit: number;
  active_from: string;
  active_to: string | null;
  created_at: string;
  updated_at: string;
  play_count: number | string;
  last_played_at: string | null;
}

function hasReadyPoolOdds(pool: CardPoolRow, cards: CardRow[]) {
  const odds = pool.pool_odds ?? [];
  const rarities = new Set(odds.map((odd) => odd.rarity));
  const probabilities = odds.map((odd) => Number(odd.probability));
  if (
    odds.length !== 5
    || rarities.size !== 5
    || probabilities.some((probability) => !Number.isFinite(probability) || probability < 0 || probability > 1)
    || Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-9
  ) {
    return false;
  }

  return odds.every((odd) => (
    Number(odd.probability) === 0
    || cards.some((card) => (
      card.archived_at === null
      && card.pool_id === pool.id
      && card.rarity === odd.rarity
    ))
  ));
}

/*
 * 어드민 카탈로그 레코드 로더.
 *
 * `include`를 주면 그 종류(와 파생에 필요한 종류)만 조회하고, 요청하지 않은 키는 빈 배열로
 * 돌려준다. 반환 타입이 그대로라 호출부는 안 깨진다. 화면별 라우트로 쪼개기 전에는 어떤
 * 화면을 열어도 8종 쿼리가 전부 나갔다. `include`를 생략하면 예전처럼 전부 조회한다.
 *
 * 권한 가드는 여기 없다 — 각 page가 로더보다 먼저 `requireAdminScreenAccess`를 await 한다.
 */
export async function getAdminCatalogRecords(
  options: { include?: readonly AdminCatalogRecordKind[] } = {},
): Promise<AdminCatalogRecords> {
  const queried = resolveQueriedKinds(options.include);
  const requested = options.include
    ? new Set<AdminCatalogRecordKind>(options.include)
    : new Set(ADMIN_CATALOG_RECORD_KINDS);
  const supabase = await createClient();
  const imageUrlForPath = (path: string | null) => {
    if (!path) return null;
    return supabase.storage
      .from('public-media')
      .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;
  };
  /*
   * 카탈로그 이미지는 두 갈래로 저장돼 있다 — 업로드된 아트워크는 `image_path`,
   * 그 이전 레코드는 `bg` 안의 CSS `url()`. 공개 화면이 쓰는 우선순위와 같게 맞춘다
   * (`lib/catalog.ts`의 `backgroundFor`). 어드민만 다른 순서를 보면 운영자가
   * 화면에 나가고 있는 이미지를 확인할 수 없다.
   *
   * `imagePath`는 일부러 그대로 null로 남긴다. 그 덕에 업로드 칸의 "이미지 제거"가
   * 잠긴 상태를 유지하고, hidden `imagePath`가 빈 값으로 왕복해 저장이 `bg`를 건드리지 않는다.
   */
  const previewUrlFor = (row: { bg: string | null; image_path: string | null }) => (
    imageUrlForPath(row.image_path) ?? imageUrlFromBg(row.bg)
  );
  const [
    ipsResult,
    goodsResult,
    cardsResult,
    cardPoolsResult,
    eventsResult,
    ticketTypesResult,
    rewardPoliciesResult,
    gamesResult,
  ] = await Promise.all([
    queried.has('ips')
      ? supabase
        .from('ips')
        .select('id,archived_at,title,sub,vertical_key,tagline,synopsis,glyph,bg,image_path,featured,fans_count')
        .order('id')
      : skippedResult,
    queried.has('goods')
      ? supabase
        .from('goods')
        /* supabase-js 는 select 를 문자열 리터럴로 받아야 행 타입을 추론한다 — 쪼개면 안 된다. */
        .select('id,archived_at,ip_id,name,type,price,compare_at_price,badge,stock,stock_qty,allow_bank_transfer,sale_restriction,bg,image_path,notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact,description,gallery_paths,detail_image_path')
        .order('id')
      : skippedResult,
    queried.has('cards')
      ? supabase
        .from('cards')
        .select('id,archived_at,ip_id,pool_id,name,no,rarity,bg,image_path')
        .order('id')
      : skippedResult,
    queried.has('cardPools')
      ? supabase
        .from('card_pools')
        .select('id,ip_id,name,active_from,active_to,updated_at,pool_odds(rarity,probability)')
        .order('active_from', { ascending: false })
        .order('name')
      : skippedResult,
    queried.has('events')
      ? supabase
        .from('events')
        .select('id,archived_at,ip_id,title,mode,status,starts_at,ends_at,location,accent,bg,image_path')
        .order('id')
      : skippedResult,
    queried.has('ticketTypes')
      ? supabase
        .from('ticket_types')
        .select('id,event_id,name,price,capacity,sold,updated_at,tickets(id)')
        .order('event_id')
        .order('name')
        .limit(1, { referencedTable: 'tickets' })
      : skippedResult,
    queried.has('rewardPolicies') ? supabase.rpc('admin_list_reward_policies') : skippedResult,
    queried.has('games') ? supabase.rpc('admin_list_games') : skippedResult,
  ]);

  if (ipsResult.error) throw new Error(`Failed to load admin IPs: ${ipsResult.error.message}`);
  if (goodsResult.error) throw new Error(`Failed to load admin goods: ${goodsResult.error.message}`);
  if (cardsResult.error) throw new Error(`Failed to load admin cards: ${cardsResult.error.message}`);
  if (cardPoolsResult.error) throw new Error(`Failed to load admin card pools: ${cardPoolsResult.error.message}`);
  if (eventsResult.error) throw new Error(`Failed to load admin events: ${eventsResult.error.message}`);
  if (ticketTypesResult.error) throw new Error(`Failed to load admin ticket types: ${ticketTypesResult.error.message}`);
  if (rewardPoliciesResult.error) {
    throw new Error(`Failed to load admin reward policies: ${rewardPoliciesResult.error.message}`);
  }
  if (gamesResult.error) {
    throw new Error(`Failed to load admin games: ${gamesResult.error.message}`);
  }

  const cardRows = (cardsResult.data ?? []) as CardRow[];
  const cardPoolRows = (cardPoolsResult.data ?? []) as CardPoolRow[];

  const events = ((eventsResult.data ?? []) as EventRow[]).map((row) => ({
    id: row.id,
    archivedAt: row.archived_at,
    ipId: row.ip_id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    accent: row.accent,
    bg: row.bg,
    imagePath: row.image_path,
    imageUrl: previewUrlFor(row),
  }));
  const eventTitles = new Map(events.map((event) => [event.id, event.title]));
  const cards = cardRows.map((row) => ({
    id: row.id,
    archivedAt: row.archived_at,
    ipId: row.ip_id,
    poolId: row.pool_id,
    name: row.name,
    no: row.no,
    rarity: row.rarity,
    bg: row.bg,
    imagePath: row.image_path,
    imageUrl: previewUrlFor(row),
  }));
  const cardPools = cardPoolRows.map((row) => {
    const odds: Record<RarityKey, number> = { N: 0, R: 0, SR: 0, SSR: 0, HOLO: 0 };
    for (const entry of row.pool_odds ?? []) odds[entry.rarity] = Number(entry.probability);
    return {
      id: row.id,
      ipId: row.ip_id,
      name: row.name,
      activeFrom: row.active_from,
      activeTo: row.active_to,
      updatedAt: row.updated_at,
      status: getAdminCardPoolStatus(row.active_from, row.active_to),
      oddsConfigured: (row.pool_odds?.length ?? 0) > 0,
      rewardReady: hasReadyPoolOdds(row, cardRows),
      odds,
    } satisfies AdminCardPoolRecord;
  });
  const policyPoolStates = new Map(cardPools.map((pool) => [pool.id, {
    activeFrom: pool.activeFrom,
    activeTo: pool.activeTo,
    ready: pool.rewardReady,
  }]));

  const loaded: AdminCatalogRecords = {
    ips: ((ipsResult.data ?? []) as IpRow[]).map((row) => ({
      id: row.id,
      archivedAt: row.archived_at,
      title: row.title,
      sub: row.sub,
      verticalKey: row.vertical_key,
      tagline: row.tagline,
      synopsis: row.synopsis,
      glyph: row.glyph,
      bg: row.bg,
      imagePath: row.image_path,
      imageUrl: previewUrlFor(row),
      featured: row.featured,
      fansCount: row.fans_count ?? 0,
    })),
    goods: ((goodsResult.data ?? []) as GoodRow[]).map((row) => ({
      id: row.id,
      archivedAt: row.archived_at,
      ipId: row.ip_id,
      name: row.name,
      type: row.type,
      price: row.price,
      compareAtPrice: row.compare_at_price,
      badge: row.badge,
      stock: row.stock,
      stockQty: row.stock_qty ?? 0,
      allowBankTransfer: row.allow_bank_transfer ?? true,
      saleRestriction: row.sale_restriction ?? 'none',
      bg: row.bg,
      imagePath: row.image_path,
      imageUrl: previewUrlFor(row),
      notice: {
        maker: row.notice_maker,
        origin: row.notice_origin,
        material: row.notice_material,
        size: row.notice_size,
        madeOn: row.notice_made_on,
        asManager: row.notice_as_manager,
        asContact: row.notice_as_contact,
      },
      description: row.description,
      galleryPaths: row.gallery_paths ?? [],
      galleryUrls: (row.gallery_paths ?? [])
        .map((path) => imageUrlForPath(path))
        .filter((url): url is string => Boolean(url)),
      detailImagePath: row.detail_image_path,
      detailImageUrl: imageUrlForPath(row.detail_image_path),
    })),
    cards,
    cardPools,
    rewardPolicies: ((rewardPoliciesResult.data ?? []) as RewardPolicyRow[]).map((row) => {
      const policy = {
        active: row.active,
        activeFrom: row.active_from,
        activeTo: row.active_to,
      };
      return {
        id: row.id,
        poolId: row.pool_id,
        trigger: row.trigger as 'order_paid',
        targetIpId: row.target_ip_id,
        targetGoodId: row.target_good_id,
        minAmount: Number(row.min_amount),
        ticketsPerGrant: row.tickets_per_grant,
        active: row.active,
        activeFrom: row.active_from,
        activeTo: row.active_to,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        issuedCount: Number(row.issued_count),
        availableCount: Number(row.available_count),
        openedCount: Number(row.opened_count),
        revokedCount: Number(row.revoked_count),
        orderCount: Number(row.order_count),
        lastIssuedAt: row.last_issued_at,
        status: getAdminRewardPolicyStatus(policy, policyPoolStates.get(row.pool_id) ?? null),
      };
    }),
    games: ((gamesResult.data ?? []) as GameRow[]).map((row) => {
      const variantKind: AdminGameVariantKind = row.variant_kind === 'card' || row.variant_kind === 'goods'
        ? row.variant_kind
        : 'unknown';
      const marbleCount = row.marble_count === null ? null : Number(row.marble_count);
      const playCount = Number(row.play_count);
      const game = {
        activeFrom: row.active_from,
        activeTo: row.active_to,
        variantKind,
      };
      const pool = row.reward_pool_active_from
        ? {
            activeFrom: row.reward_pool_active_from,
            activeTo: row.reward_pool_active_to,
            ready: row.reward_pool_ready === true,
          }
        : null;

      return {
        id: row.id,
        type: row.type,
        title: row.title,
        variantKind,
        marbleCount: marbleCount !== null && Number.isInteger(marbleCount) ? marbleCount : null,
        rewardPoolId: row.reward_pool_id,
        rewardPoolName: row.reward_pool_name,
        ipId: row.ip_id,
        ipTitle: row.ip_title,
        eventId: row.event_id,
        eventTitle: row.event_title,
        perUserDailyLimit: row.per_user_daily_limit,
        activeFrom: row.active_from,
        activeTo: row.active_to,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        playCount: Number.isFinite(playCount) ? playCount : 0,
        lastPlayedAt: row.last_played_at,
        hasPlays: Number.isFinite(playCount) && playCount > 0,
        status: getAdminGameStatus(game, pool),
      };
    }),
    events,
    ticketTypes: ((ticketTypesResult.data ?? []) as unknown as TicketTypeRow[]).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: eventTitles.get(row.event_id) ?? row.event_id,
      name: row.name,
      price: row.price,
      capacity: row.capacity,
      sold: row.sold,
      hasTicketHistory: (row.tickets?.length ?? 0) > 0,
      updatedAt: row.updated_at,
    })),
  };

  /*
   * 요청하지 않은 종류는 빈 배열로 돌려준다.
   *
   * 파생값 때문에 조회한 종류(카드풀의 카드, 티켓 회차의 이벤트 등)가 화면까지 새 나가면
   * 화면이 "왜 여기 있는지 모르는 데이터"에 의존하기 시작한다. include가 곧 계약이다.
   */
  return {
    ips: requested.has('ips') ? loaded.ips : [],
    goods: requested.has('goods') ? loaded.goods : [],
    cards: requested.has('cards') ? loaded.cards : [],
    cardPools: requested.has('cardPools') ? loaded.cardPools : [],
    rewardPolicies: requested.has('rewardPolicies') ? loaded.rewardPolicies : [],
    games: requested.has('games') ? loaded.games : [],
    events: requested.has('events') ? loaded.events : [],
    ticketTypes: requested.has('ticketTypes') ? loaded.ticketTypes : [],
  };
}
