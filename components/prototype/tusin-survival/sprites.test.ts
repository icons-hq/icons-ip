import { describe, expect, it } from 'vitest';
import {
  combatMotionCell,
  enemyMotionCell,
  finalBossMotionCell,
  playerActionCell,
} from './sprites';

describe('game-feel sprite atlas contracts', () => {
  it('제피르 4방향 × 6동작 셀을 고정한다', () => {
    expect(playerActionCell('front', 'idle')).toEqual({
      assetId: 'zephyr-action-atlas',
      columns: 6,
      rows: 4,
      column: 0,
      row: 0,
    });
    expect(playerActionCell('right', 'recovery')).toEqual({
      assetId: 'zephyr-action-atlas',
      columns: 6,
      rows: 4,
      column: 5,
      row: 3,
    });
  });

  it('적별 전진·피격·붕괴 프레임을 동일 행에서 찾는다', () => {
    expect(enemyMotionCell('shadow-hexer', 'hit')).toEqual({
      assetId: 'enemy-motion-atlas',
      columns: 4,
      rows: 6,
      column: 2,
      row: 3,
    });
    expect(enemyMotionCell('missing-enemy', 'death')).toBeNull();
  });

  it('진화 무기는 대응 기본 무기와 같은 motion 행을 공유한다', () => {
    expect(combatMotionCell('gram-dragon-slayer', 'impact')).toEqual(
      combatMotionCell('requiem', 'impact'),
    );
    expect(combatMotionCell('cloud-dragon-ascent', 'afterglow')).toEqual(
      combatMotionCell('swift-cloud-dragon', 'afterglow'),
    );
    expect(combatMotionCell('unknown-weapon', 'active')).toBeNull();
  });

  it('최종보스 4단계 strip을 고정한다', () => {
    expect(finalBossMotionCell('death')).toEqual({
      assetId: 'final-boss-motion-atlas',
      columns: 4,
      rows: 1,
      column: 3,
      row: 0,
    });
  });
});
