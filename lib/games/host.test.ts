import { describe, expect, it, vi } from 'vitest';
import { DATA } from '../data';
import { createWebGameHost, GamePlayError } from './host';

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: false }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

/* 게임 카탈로그 일관성 — 공시=추첨 일치 규율(Gacha poolRates와 동일).
 * 구슬에 보이는 라벨은 모두 실제로 당첨 가능해야 한다(0% 미끼 금지). */
describe('GAMES 카탈로그 일관성', () => {
  it('card variant: 라인업 등급은 전부 보상 풀에 실존한다', () => {
    for (const game of DATA.GAMES) {
      const variant = game.config.variant;
      if (variant.kind !== 'card') continue;
      const poolRarities = new Set(
        DATA.CARDS.filter((c) => c.ip === game.ip).map((c) => c.rarity),
      );
      for (const rarity of variant.rarityLineup) {
        expect(poolRarities, `${game.id}: ${rarity}는 풀에 없는 등급`).toContain(rarity);
      }
    }
  });

  it('goods variant: 구슬 굿즈는 전부 실존하고 서로 다르다', () => {
    for (const game of DATA.GAMES) {
      const variant = game.config.variant;
      if (variant.kind !== 'goods') continue;
      for (const id of variant.goodsIds) {
        expect(
          DATA.GOODS.some((g) => g.id === id),
          `${game.id}: ${id}는 없는 굿즈`,
        ).toBe(true);
      }
      expect(new Set(variant.goodsIds).size).toBe(variant.goodsIds.length);
    }
  });

  it('라벨 수가 구슬 수와 일치한다', () => {
    for (const game of DATA.GAMES) {
      const variant = game.config.variant;
      const labels = variant.kind === 'card' ? variant.rarityLineup : variant.goodsIds;
      expect(labels).toHaveLength(game.config.marbleCount);
    }
  });
});

describe('remote game play errors', () => {
  it('keeps the global reward gate code for fail-closed game guidance', async () => {
    const host = createWebGameHost({
      remotePlay: async () => ({ ok: false, error: 'rewards_disabled' }),
    });

    await expect(host.playGame('game-1')).rejects.toEqual(
      expect.objectContaining<GamePlayError>({ code: 'rewards_disabled' }),
    );
  });

  it('keeps the account suspension code for generic game guidance', async () => {
    const host = createWebGameHost({
      remotePlay: async () => ({ ok: false, error: 'account_suspended' }),
    });

    await expect(host.playGame('game-1')).rejects.toEqual(
      expect.objectContaining<GamePlayError>({ code: 'account_suspended' }),
    );
  });

  it('retired raffle and prize-checkout capabilities are absent from the web host', () => {
    const host = createWebGameHost();

    expect('getRaffleResult' in host).toBe(false);
    expect('startPrizeCheckout' in host).toBe(false);
  });
});
