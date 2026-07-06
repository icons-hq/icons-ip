import { describe, expect, it } from 'vitest';
import { DATA } from '../data';

/* 게임 카탈로그 일관성 — 공시=추첨 일치 규율(Gacha poolRates와 동일).
 * 라인업에 보이는 등급은 모두 해당 풀에서 실제로 획득 가능해야 한다(0% 미끼 등급 금지). */
describe('GAMES 카탈로그 일관성', () => {
  it('라인업 등급은 전부 보상 풀에 실존한다', () => {
    for (const game of DATA.GAMES) {
      const poolRarities = new Set(
        DATA.CARDS.filter((c) => c.ip === game.ip).map((c) => c.rarity),
      );
      for (const rarity of game.config.rarityLineup) {
        expect(poolRarities, `${game.id}: ${rarity}는 풀에 없는 등급`).toContain(rarity);
      }
    }
  });

  it('라인업 길이가 구슬 수와 일치한다', () => {
    for (const game of DATA.GAMES) {
      expect(game.config.rarityLineup).toHaveLength(game.config.marbleCount);
    }
  });
});
