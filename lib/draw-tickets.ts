import 'server-only';

import { DATA } from './data';
import { RARITY_META, type RarityKey } from './rarity';
import { getSupabaseConfig } from './supabase/config';
import { createClient } from './supabase/server';
import { resolveCatalogSource, type CatalogSource } from './catalog-source';

/* 뽑기권(UI "카드팩") 인벤토리 — 본인 미개봉 티켓을 풀별로 묶어 내린다(#71).
 * 발급·개봉의 진실원은 DB(#62 draw_tickets · open_draw_ticket). */

export interface PackPoolGroup {
  poolId: string;
  poolName: string;
  ipId: string;
  /** 미개봉 티켓 id — 발급 순(오래된 것부터 개봉) */
  ticketIds: string[];
  /** 풀 라인업 카드 id — 카탈로그 cards와 조인해 미리보기 */
  lineupCardIds: string[];
}

export interface DrawTicketInventory {
  source: CatalogSource;
  signedIn: boolean;
  groups: PackPoolGroup[];
}

export interface TicketRow {
  id: string;
  pool_id: string;
  created_at: string;
  card_pools: { id: string; name: string; ip_id: string } | null;
}

export interface OpenedCard {
  cardId: string;
  rarity: RarityKey;
  isNew: boolean;
}

const isRarityKey = (value: unknown): value is RarityKey =>
  typeof value === 'string' && value in RARITY_META;

/** open_draw_ticket 반환 jsonb 방어적 파싱 — 형식이 어긋난 항목은 버린다. */
export function normalizeGrantedCards(data: unknown): OpenedCard[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const { cardId, rarity, isNew } = item as { cardId?: unknown; rarity?: unknown; isNew?: unknown };
    if (typeof cardId !== 'string' || !cardId || !isRarityKey(rarity)) return [];
    return [{ cardId, rarity, isNew: isNew === true }];
  });
}

export type OpenPackErrorCode = 'not_found' | 'already_opened' | 'pool_empty' | 'unknown';

/** RPC 예외 메시지 → 사용자 에러 코드. 타인·회수 티켓은 존재를 노출하지 않는다. */
export function mapOpenTicketError(message: string): OpenPackErrorCode {
  if (
    message.includes('ticket not found')
    || message.includes('ticket_revoked')
    || message.includes('forbidden')
  ) return 'not_found';
  if (message.includes('ticket already consumed')) return 'already_opened';
  if (message.includes('pool has no card')) return 'pool_empty';
  return 'unknown';
}

/** 순수 그룹핑 — 티켓 행 + 풀 라인업으로 풀별 그룹 구성(풀 이름순). */
export function buildPackPoolGroups(
  tickets: TicketRow[],
  lineup: { id: string; pool_id: string }[],
): PackPoolGroup[] {
  const lineupByPool = new Map<string, string[]>();
  for (const card of lineup) {
    const ids = lineupByPool.get(card.pool_id) ?? [];
    ids.push(card.id);
    lineupByPool.set(card.pool_id, ids);
  }

  const groups = new Map<string, PackPoolGroup>();
  for (const ticket of [...tickets].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!ticket.card_pools) continue;
    const group = groups.get(ticket.pool_id) ?? {
      poolId: ticket.pool_id,
      poolName: ticket.card_pools.name,
      ipId: ticket.card_pools.ip_id,
      ticketIds: [],
      lineupCardIds: lineupByPool.get(ticket.pool_id) ?? [],
    };
    group.ticketIds.push(ticket.id);
    groups.set(ticket.pool_id, group);
  }

  return [...groups.values()].sort((a, b) => a.poolName.localeCompare(b.poolName, 'ko'));
}

export const MOCK_TICKET_PREFIX = 'mock-ticket:';

/** mock 데모 팩 — 카드가 있는 상위 2개 IP × 2장. 개봉은 서버 액션의 결정론 분기가 처리. */
function mockInventory(): DrawTicketInventory {
  const pools = DATA.IPS.filter((ip) => DATA.CARDS.some((c) => c.ip === ip.id)).slice(0, 2);
  return {
    source: 'mock',
    signedIn: true,
    groups: pools.map((ip) => ({
      poolId: `mock-pool-${ip.id}`,
      poolName: `${ip.title} 컬렉션`,
      ipId: ip.id,
      ticketIds: [1, 2].map((n) => `${MOCK_TICKET_PREFIX}${ip.id}:${n}`),
      lineupCardIds: DATA.CARDS.filter((c) => c.ip === ip.id).map((c) => c.id),
    })),
  };
}

export async function getDrawTicketInventory(): Promise<DrawTicketInventory> {
  const source = resolveCatalogSource({ isSupabaseConfigured: getSupabaseConfig().isConfigured });
  if (source === 'mock') return mockInventory();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { source, signedIn: false, groups: [] };

  const ticketsResult = await supabase
    .from('draw_tickets')
    .select('id,pool_id,created_at,card_pools(id,name,ip_id)')
    .is('consumed_at', null)
    .is('revoked_at', null)
    .order('created_at');

  if (ticketsResult.error) {
    throw new Error(`Failed to load draw tickets: ${ticketsResult.error.message}`);
  }

  const tickets = (ticketsResult.data ?? []) as unknown as TicketRow[];
  if (!tickets.length) return { source, signedIn: true, groups: [] };

  const poolIds = [...new Set(tickets.map((t) => t.pool_id))];
  const lineupResult = await supabase
    .from('cards')
    .select('id,pool_id')
    .in('pool_id', poolIds)
    .order('id');

  if (lineupResult.error) {
    throw new Error(`Failed to load pack lineup: ${lineupResult.error.message}`);
  }

  return {
    source,
    signedIn: true,
    groups: buildPackPoolGroups(tickets, (lineupResult.data ?? []) as { id: string; pool_id: string }[]),
  };
}

/** 바인더 보유 배선 — null = 미설정/미로그인(공개 도감 모드). */
export async function getOwnedCardIds(): Promise<string[] | null> {
  if (!getSupabaseConfig().isConfigured) return null;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data, error } = await supabase.from('user_cards').select('card_id');
  if (error) {
    throw new Error(`Failed to load owned cards: ${error.message}`);
  }
  return ((data ?? []) as { card_id: string }[]).map((row) => row.card_id);
}
