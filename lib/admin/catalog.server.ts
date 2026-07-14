import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { RarityKey } from '@/lib/rarity';
import type { Stock } from '@/lib/data';

export interface AdminIpRecord {
  id: string;
  title: string;
  sub: string | null;
  verticalKey: string;
  tagline: string | null;
  synopsis: string | null;
  glyph: string | null;
  bg: string | null;
  imagePath: string | null;
  featured: boolean;
  fansCount: number;
}

export interface AdminGoodRecord {
  id: string;
  ipId: string;
  name: string;
  type: string;
  price: number;
  badge: string | null;
  stock: Stock;
  stockQty: number;
  bg: string | null;
  imagePath: string | null;
}

export interface AdminCardRecord {
  id: string;
  ipId: string;
  poolId: string | null;
  name: string;
  no: string | null;
  rarity: RarityKey;
  bg: string | null;
  imagePath: string | null;
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

export interface AdminEventRecord {
  id: string;
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
  events: AdminEventRecord[];
  ticketTypes: AdminTicketTypeRecord[];
}

interface IpRow {
  id: string;
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
    || cards.some((card) => card.pool_id === pool.id && card.rarity === odd.rarity)
  ));
}

export async function getAdminCatalogRecords(): Promise<AdminCatalogRecords> {
  const supabase = await createClient();
  const [
    ipsResult,
    goodsResult,
    cardsResult,
    cardPoolsResult,
    eventsResult,
    ticketTypesResult,
    rewardPoliciesResult,
  ] = await Promise.all([
    supabase
      .from('ips')
      .select('id,title,sub,vertical_key,tagline,synopsis,glyph,bg,image_path,featured,fans_count')
      .order('id'),
    supabase
      .from('goods')
      .select('id,ip_id,name,type,price,badge,stock,stock_qty,bg,image_path')
      .order('id'),
    supabase
      .from('cards')
      .select('id,ip_id,pool_id,name,no,rarity,bg,image_path')
      .order('id'),
    supabase
      .from('card_pools')
      .select('id,ip_id,name,active_from,active_to,updated_at,pool_odds(rarity,probability)')
      .order('active_from', { ascending: false })
      .order('name'),
    supabase
      .from('events')
      .select('id,ip_id,title,mode,status,starts_at,ends_at,location,accent,bg,image_path')
      .order('id'),
    supabase
      .from('ticket_types')
      .select('id,event_id,name,price,capacity,sold,updated_at,tickets(id)')
      .order('event_id')
      .order('name')
      .limit(1, { referencedTable: 'tickets' }),
    supabase.rpc('admin_list_reward_policies'),
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

  const cardRows = (cardsResult.data ?? []) as CardRow[];
  const cardPoolRows = (cardPoolsResult.data ?? []) as CardPoolRow[];

  const events = ((eventsResult.data ?? []) as EventRow[]).map((row) => ({
    id: row.id,
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
  }));
  const eventTitles = new Map(events.map((event) => [event.id, event.title]));
  const cards = cardRows.map((row) => ({
    id: row.id,
    ipId: row.ip_id,
    poolId: row.pool_id,
    name: row.name,
    no: row.no,
    rarity: row.rarity,
    bg: row.bg,
    imagePath: row.image_path,
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
      odds,
    } satisfies AdminCardPoolRecord;
  });
  const policyPoolStates = new Map(cardPoolRows.map((row) => [row.id, {
    activeFrom: row.active_from,
    activeTo: row.active_to,
    ready: hasReadyPoolOdds(row, cardRows),
  }]));

  return {
    ips: ((ipsResult.data ?? []) as IpRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      sub: row.sub,
      verticalKey: row.vertical_key,
      tagline: row.tagline,
      synopsis: row.synopsis,
      glyph: row.glyph,
      bg: row.bg,
      imagePath: row.image_path,
      featured: row.featured,
      fansCount: row.fans_count ?? 0,
    })),
    goods: ((goodsResult.data ?? []) as GoodRow[]).map((row) => ({
      id: row.id,
      ipId: row.ip_id,
      name: row.name,
      type: row.type,
      price: row.price,
      badge: row.badge,
      stock: row.stock,
      stockQty: row.stock_qty ?? 0,
      bg: row.bg,
      imagePath: row.image_path,
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
