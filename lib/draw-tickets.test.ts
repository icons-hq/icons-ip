import { describe, expect, it, vi } from 'vitest';
import {
  buildPackPoolGroups,
  mapOpenTicketError,
  normalizeGrantedCards,
  type TicketRow,
} from './draw-tickets';

vi.mock('server-only', () => ({}));
vi.mock('./supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: false }),
}));
vi.mock('./supabase/server', () => ({
  createClient: () => null,
}));

const ticket = (id: string, poolId: string, createdAt: string, poolName = '풀'): TicketRow => ({
  id,
  pool_id: poolId,
  created_at: createdAt,
  card_pools: { id: poolId, name: poolName, ip_id: 'maplestory' },
});

describe('buildPackPoolGroups', () => {
  it('풀별로 묶고 티켓은 발급 순으로 정렬한다', () => {
    const groups = buildPackPoolGroups(
      [
        ticket('t2', 'p1', '2026-07-02T00:00:00Z'),
        ticket('t1', 'p1', '2026-07-01T00:00:00Z'),
        ticket('t3', 'p2', '2026-07-03T00:00:00Z', '가 풀'),
      ],
      [
        { id: 'c3', pool_id: 'p1' },
        { id: 'c4', pool_id: 'p1' },
      ],
    );
    expect(groups.map((g) => g.poolId)).toEqual(['p2', 'p1']); // 풀 이름순(가 < 풀)
    const p1 = groups.find((g) => g.poolId === 'p1');
    expect(p1?.ticketIds).toEqual(['t1', 't2']); // 오래된 것부터 개봉
    expect(p1?.lineupCardIds).toEqual(['c3', 'c4']);
    expect(p1?.ipId).toBe('maplestory');
  });

  it('풀 조인이 빠진 티켓은 버린다', () => {
    const orphan: TicketRow = { id: 't', pool_id: 'p', created_at: '2026-07-01T00:00:00Z', card_pools: null };
    expect(buildPackPoolGroups([orphan], [])).toEqual([]);
  });
});

describe('normalizeGrantedCards', () => {
  it('정상 jsonb 배열을 파싱한다', () => {
    expect(normalizeGrantedCards([{ cardId: 'c4', rarity: 'R', isNew: true }])).toEqual([
      { cardId: 'c4', rarity: 'R', isNew: true },
    ]);
  });

  it('형식이 어긋난 항목은 버린다', () => {
    expect(
      normalizeGrantedCards([
        { cardId: 'c1', rarity: 'XX', isNew: true },
        { cardId: '', rarity: 'R', isNew: true },
        { rarity: 'R' },
        'junk',
        { cardId: 'c2', rarity: 'SSR' },
      ]),
    ).toEqual([{ cardId: 'c2', rarity: 'SSR', isNew: false }]);
    expect(normalizeGrantedCards(null)).toEqual([]);
    expect(normalizeGrantedCards('[]')).toEqual([]);
  });
});

describe('mapOpenTicketError', () => {
  it('타인 티켓(forbidden)은 not_found로 뭉갠다', () => {
    expect(mapOpenTicketError('forbidden')).toBe('not_found');
    expect(mapOpenTicketError('ticket not found')).toBe('not_found');
  });

  it('소비·빈 풀·기타를 구분한다', () => {
    expect(mapOpenTicketError('ticket already consumed')).toBe('already_opened');
    expect(mapOpenTicketError('pool has no card of rarity HOLO')).toBe('pool_empty');
    expect(mapOpenTicketError('connection reset')).toBe('unknown');
  });
});
