import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { loadAssetSpec, validateAssetSpec } from './spec.mjs';

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
    expect(spec.assets.map(({ identity }) => identity.mode)).toEqual([
      'original',
      'original',
      'not-applicable',
    ]);
    expect(spec.pipeline.maxAttempts).toBe(3);
  });

  it('rejects output paths and atlas names that can escape the repository', async () => {
    const source = yaml.load(await readFile(new URL('./asset-spec.yaml', import.meta.url), 'utf8'));
    const traversal = structuredClone(source);
    traversal.pipeline.outputDirectory = '../outside';
    const absolute = structuredClone(source);
    absolute.pipeline.workDirectory = '/tmp/outside';
    const unsafeAtlas = structuredClone(source);
    unsafeAtlas.pipeline.atlas.name = '../../escaped';

    expect(() => validateAssetSpec(traversal)).toThrow('pipeline.outputDirectory');
    expect(() => validateAssetSpec(absolute)).toThrow('pipeline.workDirectory');
    expect(() => validateAssetSpec(unsafeAtlas)).toThrow('pipeline.atlas.name');
  });

  it('requires an explicit performer threshold for canonical cast assets', async () => {
    const source = yaml.load(await readFile(new URL('./asset-spec.yaml', import.meta.url), 'utf8'));
    source.assets[0].identity = {
      mode: 'canonical',
      character: '남라',
      performer: '조이현',
    };

    expect(() => validateAssetSpec(source)).toThrow('minCharacterIdentity');
  });
});
