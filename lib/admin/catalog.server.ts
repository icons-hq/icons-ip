import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { RarityKey } from '@/lib/rarity';
import type { Stock } from '@/lib/data';
import { normalizePublicMediaObjectPath } from './artwork';

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

export interface AdminGoodRecord {
  id: string;
  archivedAt: string | null;
  ipId: string;
  name: string;
  type: string;
  price: number;
  badge: string | null;
  stock: Stock;
  stockQty: number;
  bg: string | null;
  imagePath: string | null;
  imageUrl?: string | null;
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
  badge: string | null;
  stock: Stock;
  stock_qty: number | null;
  bg: string | null;
  image_path: string | null;
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

export async function getAdminCatalogRecords(): Promise<AdminCatalogRecords> {
  const supabase = await createClient();
  const imageUrlForPath = (path: string | null) => {
    if (!path) return null;
    return supabase.storage
      .from('public-media')
      .getPublicUrl(normalizePublicMediaObjectPath(path)).data.publicUrl;
  };
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
    supabase
      .from('ips')
      .select('id,archived_at,title,sub,vertical_key,tagline,synopsis,glyph,bg,image_path,featured,fans_count')
      .order('id'),
    supabase
      .from('goods')
      .select('id,archived_at,ip_id,name,type,price,badge,stock,stock_qty,bg,image_path')
      .order('id'),
    supabase
      .from('cards')
      .select('id,archived_at,ip_id,pool_id,name,no,rarity,bg,image_path')
      .order('id'),
    supabase
      .from('card_pools')
      .select('id,ip_id,name,active_from,active_to,updated_at,pool_odds(rarity,probability)')
      .order('active_from', { ascending: false })
      .order('name'),
    supabase
      .from('events')
      .select('id,archived_at,ip_id,title,mode,status,starts_at,ends_at,location,accent,bg,image_path')
      .order('id'),
    supabase
      .from('ticket_types')
      .select('id,event_id,name,price,capacity,sold,updated_at,tickets(id)')
      .order('event_id')
      .order('name')
      .limit(1, { referencedTable: 'tickets' }),
    supabase.rpc('admin_list_reward_policies'),
    supabase.rpc('admin_list_games'),
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
    imageUrl: imageUrlForPath(row.image_path),
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
    imageUrl: imageUrlForPath(row.image_path),
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

  return {
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
      imageUrl: imageUrlForPath(row.image_path),
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
      badge: row.badge,
      stock: row.stock,
      stockQty: row.stock_qty ?? 0,
      bg: row.bg,
      imagePath: row.image_path,
      imageUrl: imageUrlForPath(row.image_path),
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
}
