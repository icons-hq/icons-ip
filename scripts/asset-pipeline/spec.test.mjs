import { describe, expect, it } from 'vitest';

import { loadAssetSpec } from './spec.mjs';

describe('asset pipeline spec', () => {
  it('defines only the three M0 concepts and enforces official season-one fidelity', async () => {
    const spec = await loadAssetSpec(new URL('./asset-spec.yaml', import.meta.url));

    expect(spec.assets.map(({ id }) => id)).toEqual([
      'player_halfbie_concept',
      'student_zombie_concept',
      'cafeteria_background_concept',
    ]);
    expect(spec.meta.forbidden).toEqual(expect.arrayContaining([
      'gore',
      'webtoon-elements',
      'wrong-season-elements',
    ]));
    expect(spec.meta.forbidden).not.toContain('actor-likeness');
    expect(spec.meta.fidelityTargets).toEqual(expect.arrayContaining([
      'season-1-production-design',
      'canonical-actor-likeness',
      'uniform-costume-continuity',
    ]));
    expect(spec.assets.every(({ qa }) => qa.minSourceFidelity >= 0.85)).toBe(true);
    expect(spec.pipeline.maxAttempts).toBe(3);
  });
});
