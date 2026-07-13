import 'server-only';

import { DATA, type Card, type Game } from '../data';
import { RARITY_META, type RarityKey } from '../rarity';
import { getSupabaseConfig } from '../supabase/config';
import { createClient } from '../supabase/server';
import { resolveCatalogSource, type CatalogSource } from '../catalog-source';

/* 게임 카탈로그 fetch — 소비 표면이 /games/[gameId] 하나라 CatalogSnapshot에
 * 넣지 않고 도메인 전용으로 둔다(mock을 시드로 도메인별 점진 이전). */

export interface GameCatalogEntry {
  source: CatalogSource;
  game: Game;
  /** 리빌 패널 카드 조회용 — 보상 풀 카드(card variant) 또는 전체 mock 카드 */
  cards: Card[];
}

export interface GameRow {
  id: string;
  type: string;
  title: string;
  event_id: string | null;
  config: unknown;
  reward_pool_id: string | null;
  active_from: string | null;
  active_to: string | null;
  card_pools: { ip_id: string } | null;
}

interface GameCardRow {
  id: string;
  ip_id: string;
  name: string;
  no: string | null;
  rarity: string;
  bg: string | null;
}

const isRarityKey = (value: unknown): value is RarityKey =>
  typeof value === 'string' && value in RARITY_META;

/** config jsonb 검증 — 구슬 수와 라벨 수가 어긋난 행은 렌더러가 깨지므로 통째로 거른다. */
export function toGameConfig(value: unknown): Game['config'] | null {
  if (typeof value !== 'object' || value === null) return null;
  const config = value as { marbleCount?: unknown; variant?: unknown };
  const marbleCount = config.marbleCount;
  if (typeof marbleCount !== 'number' || !Number.isInteger(marbleCount) || marbleCount < 2) return null;

  const variant = config.variant as { kind?: unknown; rarityLineup?: unknown; goodsIds?: unknown } | null;
  if (typeof variant !== 'object' || variant === null) return null;

  if (variant.kind === 'card') {
    const lineup = variant.rarityLineup;
    if (!Array.isArray(lineup) || lineup.length !== marbleCount || !lineup.every(isRarityKey)) return null;
    return { marbleCount, variant: { kind: 'card', rarityLineup: lineup } };
  }

  if (variant.kind === 'goods') {
    const goodsIds = variant.goodsIds;
    if (
      !Array.isArray(goodsIds) ||
      goodsIds.length !== marbleCount ||
      !goodsIds.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return null;
    }
    return { marbleCount, variant: { kind: 'goods', goodsIds } };
  }

  return null;
}

/** row → Game. 활성 창 밖·config 형식 불량이면 null(라우트에서 404). */
export function toGameFromRow(row: GameRow, now: Date = new Date()): Game | null {
  if (row.type !== 'marble_roulette') return null;

  const activeFrom = row.active_from ? new Date(row.active_from) : null;
  const activeTo = row.active_to ? new Date(row.active_to) : null;
  if (activeFrom && now < activeFrom) return null;
  if (activeTo && now >= activeTo) return null;

  const config = toGameConfig(row.config);
  if (!config) return null;

  return {
    id: row.id,
    type: 'marble_roulette',
    title: row.title,
    ip: config.variant.kind === 'card' ? (row.card_pools?.ip_id ?? null) : null,
    event: row.event_id,
    config,
  };
}

function toRewardCard(row: GameCardRow): Card {
  return {
    id: row.id,
    ip: row.ip_id,
    name: row.name,
    no: row.no ?? '',
    rarity: isRarityKey(row.rarity) ? row.rarity : 'N',
    owned: false,
    bg: row.bg ?? DATA.CARDS[0]?.bg ?? '',
  };
}

/** 공개 화면 CTA용 이벤트↔게임 연결 — 이벤트에 묶인 활성 게임만 노출한다(#81). */
export interface EventGameLink {
  gameId: string;
  eventId: string;
  title: string;
}

export function toEventGameLinks(games: Array<Game | null>): EventGameLink[] {
  return games
    .filter((game): game is Game => game !== null && game.event !== null)
    .map((game) => ({ gameId: game.id, eventId: game.event as string, title: game.title }));
}

export async function listEventGameLinks(): Promise<EventGameLink[]> {
  const source = resolveCatalogSource({ isSupabaseConfigured: getSupabaseConfig().isConfigured });
  if (source === 'mock') return toEventGameLinks(DATA.GAMES);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('id,type,title,event_id,config,reward_pool_id,active_from,active_to,card_pools:reward_pool_id(ip_id)')
    .not('event_id', 'is', null);

  if (error) {
    throw new Error(`Failed to load event game links: ${error.message}`);
  }

  return toEventGameLinks(((data ?? []) as unknown as GameRow[]).map((row) => toGameFromRow(row)));
}

export async function getGameCatalogEntry(gameId: string): Promise<GameCatalogEntry | null> {
  const source = resolveCatalogSource({ isSupabaseConfigured: getSupabaseConfig().isConfigured });
  if (source === 'mock') {
    const game = DATA.GAMES.find((g) => g.id === gameId) ?? null;
    return game ? { source, game, cards: DATA.CARDS } : null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('id,type,title,event_id,config,reward_pool_id,active_from,active_to,card_pools:reward_pool_id(ip_id)')
    .eq('id', gameId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load game catalog: ${error.message}`);
  }
  if (!data) return null;

  const row = data as unknown as GameRow;
  const game = toGameFromRow(row);
  if (!game) return null;

  if (!row.reward_pool_id) return { source, game, cards: [] };

  const cardsResult = await supabase
    .from('cards')
    .select('id,ip_id,name,no,rarity,bg')
    .eq('pool_id', row.reward_pool_id)
    .order('id');

  if (cardsResult.error) {
    throw new Error(`Failed to load game reward cards: ${cardsResult.error.message}`);
  }

  return { source, game, cards: ((cardsResult.data ?? []) as GameCardRow[]).map(toRewardCard) };
}
