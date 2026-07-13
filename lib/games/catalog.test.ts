import { describe, expect, it, vi } from 'vitest';
import { toEventGameLinks, toGameConfig, toGameFromRow, type GameRow } from './catalog';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: false }),
}));
vi.mock('../supabase/server', () => ({
  createClient: () => null,
}));

const cardRow = (overrides: Partial<GameRow> = {}): GameRow => ({
  id: 'marble-maple',
  type: 'marble_roulette',
  title: '메이플 마블 룰렛',
  event_id: 'e2',
  config: {
    marbleCount: 3,
    variant: { kind: 'card', rarityLineup: ['R', 'SSR', 'HOLO'] },
  },
  reward_pool_id: 'a0000000-0000-4000-8000-000000000001',
  active_from: '2026-07-01T00:00:00+09:00',
  active_to: null,
  card_pools: { ip_id: 'maplestory' },
  ...overrides,
});

describe('toGameConfig', () => {
  it('구슬 수와 라벨 수가 일치하는 card variant를 통과시킨다', () => {
    expect(
      toGameConfig({ marbleCount: 3, variant: { kind: 'card', rarityLineup: ['R', 'SSR', 'HOLO'] } }),
    ).toEqual({ marbleCount: 3, variant: { kind: 'card', rarityLineup: ['R', 'SSR', 'HOLO'] } });
  });

  it('구슬 수와 라벨 수가 어긋나면 거른다', () => {
    expect(toGameConfig({ marbleCount: 10, variant: { kind: 'card', rarityLineup: ['R'] } })).toBeNull();
    expect(toGameConfig({ marbleCount: 2, variant: { kind: 'goods', goodsIds: ['g1'] } })).toBeNull();
  });

  it('알 수 없는 등급·variant·형식 불량을 거른다', () => {
    expect(toGameConfig({ marbleCount: 2, variant: { kind: 'card', rarityLineup: ['R', 'XX'] } })).toBeNull();
    expect(toGameConfig({ marbleCount: 2, variant: { kind: 'raffle' } })).toBeNull();
    expect(toGameConfig(null)).toBeNull();
    expect(toGameConfig('{}')).toBeNull();
    expect(toGameConfig({ marbleCount: 1.5, variant: { kind: 'goods', goodsIds: [] } })).toBeNull();
  });

  it('goods variant는 goodsIds를 그대로 보존한다', () => {
    expect(
      toGameConfig({ marbleCount: 2, variant: { kind: 'goods', goodsIds: ['g1', 'g2'] } }),
    ).toEqual({ marbleCount: 2, variant: { kind: 'goods', goodsIds: ['g1', 'g2'] } });
  });
});

describe('toGameFromRow', () => {
  const now = new Date('2026-07-07T12:00:00+09:00');

  it('card variant는 보상 풀 IP를 Game.ip로 파생한다', () => {
    const game = toGameFromRow(cardRow(), now);
    expect(game).not.toBeNull();
    expect(game?.ip).toBe('maplestory');
    expect(game?.event).toBe('e2');
    expect(game?.config.variant.kind).toBe('card');
  });

  it('goods variant는 ip가 null이다', () => {
    const game = toGameFromRow(
      cardRow({
        id: 'goods-marble',
        event_id: null,
        reward_pool_id: null,
        card_pools: null,
        config: { marbleCount: 2, variant: { kind: 'goods', goodsIds: ['g1', 'g2'] } },
      }),
      now,
    );
    expect(game).not.toBeNull();
    expect(game?.ip).toBeNull();
  });

  it('활성 창 밖이면 null — 시작 전과 종료 후 모두', () => {
    expect(toGameFromRow(cardRow({ active_from: '2026-08-01T00:00:00+09:00' }), now)).toBeNull();
    expect(toGameFromRow(cardRow({ active_to: '2026-07-01T00:00:00+09:00' }), now)).toBeNull();
  });

  it('config 형식 불량 행은 통째로 거른다', () => {
    expect(toGameFromRow(cardRow({ config: { marbleCount: 10 } }), now)).toBeNull();
    expect(toGameFromRow(cardRow({ type: 'slot_machine' }), now)).toBeNull();
  });
});

describe('toEventGameLinks', () => {
  const now = new Date('2026-07-07T12:00:00+09:00');

  it('이벤트에 묶인 게임만 CTA 링크로 만들고, 이벤트 없는 게임과 걸러진 행은 제외한다', () => {
    const links = toEventGameLinks([
      toGameFromRow(cardRow(), now),
      toGameFromRow(
        cardRow({
          id: 'goods-marble',
          event_id: null,
          reward_pool_id: null,
          card_pools: null,
          config: { marbleCount: 2, variant: { kind: 'goods', goodsIds: ['g1', 'g2'] } },
        }),
        now,
      ),
      toGameFromRow(cardRow({ active_to: '2026-07-01T00:00:00+09:00' }), now),
    ]);

    expect(links).toEqual([{ gameId: 'marble-maple', eventId: 'e2', title: '메이플 마블 룰렛' }]);
  });
});
