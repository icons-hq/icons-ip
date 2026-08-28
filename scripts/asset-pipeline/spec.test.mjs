import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { loadAssetSpec, loadAssetSpecDocument, validateAssetSpec } from './spec.mjs';

describe('asset pipeline spec', () => {
  it('defines the G2 cafeteria production batch and enforces official season-one fidelity', async () => {
    const spec = await loadAssetSpec(new URL('./asset-spec.yaml', import.meta.url));

    expect(spec.meta.milestone).toBe('G2');
    expect(spec.assets.map(({ id }) => id)).toEqual([
      'player_halfbie_walk',
      'player_halfbie_attack_combo',
      'student_zombie_run',
      'student_zombie_attack',
      'nurse_kim_kyungmi_run',
      'nurse_kim_kyungmi_attack',
      'cafeteria_tileset',
      'cafeteria_room_reference',
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
      'original', 'original', 'original', 'original',
      'canonical', 'canonical', 'not-applicable', 'not-applicable',
    ]);
    expect(spec.assets.slice(0, 4).map(({ targetSize }) => targetSize))
      .toEqual(Array.from({ length: 4 }, () => ({ width: 128, height: 128 })));
    expect(spec.assets.slice(4, 6).map(({ targetSize }) => targetSize))
      .toEqual(Array.from({ length: 2 }, () => ({ width: 192, height: 192 })));
    expect(spec.assets.slice(0, 6).map(({ frameLayout }) => frameLayout.rows))
      .toEqual([4, 4, 4, 4, 4, 4]);
    expect(spec.assets.slice(0, 6).map(({ frameLayout }) => frameLayout.columns))
      .toEqual([6, 6, 6, 4, 6, 6]);
    expect(spec.assets.slice(4, 6).every(({ identity, qa }) => (
      identity.character === '김경미'
      && identity.performer === '안시하'
      && qa.minCharacterIdentity === 0.85
    ))).toBe(true);
    expect(spec.pipeline.maxAttempts).toBe(3);
    expect(spec.pipeline.approvalBlocks).toEqual(['G3']);
    expect(spec.pipeline.atlas).toMatchObject({ padding: 4, extrusion: 1, maxSize: 4096 });
    expect(spec.meta.referenceSources).toContainEqual({
      id: 'netflix-korea-cafeteria-clip',
      authority: 'official',
      url: 'https://www.youtube.com/watch?v=mh3a3Bj-IPY',
    });
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

  it('does not allow a spec to lower the season-one source-fidelity floor', async () => {
    const source = yaml.load(await readFile(new URL('./asset-spec.yaml', import.meta.url), 'utf8'));
    source.assets[0].qa.minSourceFidelity = 0.84;

    expect(() => validateAssetSpec(source)).toThrow('minSourceFidelity must be at least 0.85');
  });

  it('requires every manifest provenance field', async () => {
    const source = yaml.load(await readFile(new URL('./asset-spec.yaml', import.meta.url), 'utf8'));
    const cases = [
      ['meta.project', (spec) => delete spec.meta.project],
      ['meta.milestone', (spec) => delete spec.meta.milestone],
      ['meta.rightsScope', (spec) => delete spec.meta.rightsScope],
      ['meta.referenceSources', (spec) => delete spec.meta.referenceSources],
      ['pipeline.planner', (spec) => delete spec.pipeline.planner],
      ['pipeline.generator', (spec) => delete spec.pipeline.generator],
      ['pipeline.visionQa', (spec) => delete spec.pipeline.visionQa],
      ['assets[0].label', (spec) => delete spec.assets[0].label],
      ['assets[0].referenceIds', (spec) => delete spec.assets[0].referenceIds],
    ];

    for (const [field, mutate] of cases) {
      const invalid = structuredClone(source);
      mutate(invalid);
      expect(() => validateAssetSpec(invalid), field).toThrow(field);
    }
  });

  it('requires exact, unique official references and binds every asset to them', async () => {
    const source = yaml.load(await readFile(new URL('./asset-spec.yaml', import.meta.url), 'utf8'));
    const unofficial = structuredClone(source);
    unofficial.meta.referenceSources[0].authority = 'fan-wiki';
    const spoofedOrigin = structuredClone(source);
    spoofedOrigin.meta.referenceSources[0].url = 'https://netflix.com.evil.example/fake';
    const extraField = structuredClone(source);
    extraField.meta.referenceSources[0].title = 'unsupported';
    const duplicateSource = structuredClone(source);
    duplicateSource.meta.referenceSources.push({ ...duplicateSource.meta.referenceSources[0] });
    const duplicateUrl = structuredClone(source);
    duplicateUrl.meta.referenceSources[1].url = duplicateUrl.meta.referenceSources[0].url;
    const unknownReference = structuredClone(source);
    unknownReference.assets[0].referenceIds = ['unknown-reference'];
    const duplicateAssetReference = structuredClone(source);
    duplicateAssetReference.assets[0].referenceIds.push(
      duplicateAssetReference.assets[0].referenceIds[0],
    );

    expect(() => validateAssetSpec(unofficial)).toThrow('authority must be official');
    expect(() => validateAssetSpec(spoofedOrigin)).toThrow('registered official source');
    expect(() => validateAssetSpec(extraField)).toThrow('unsupported fields');
    expect(() => validateAssetSpec(duplicateSource)).toThrow('duplicates');
    expect(() => validateAssetSpec(duplicateUrl)).toThrow('url duplicates');
    expect(() => validateAssetSpec(unknownReference)).toThrow('unknown official source');
    expect(() => validateAssetSpec(duplicateAssetReference)).toThrow('duplicates');
  });

  it('returns the parsed spec and hash source from one immutable read', async () => {
    const document = await loadAssetSpecDocument(
      new URL('./asset-spec.yaml', import.meta.url),
    );

    expect(document.spec.meta.project).toBe('hyosan-memories');
    expect(Object.isFrozen(document.spec)).toBe(true);
    expect(Object.isFrozen(document.spec.meta.referenceSources[0])).toBe(true);
    expect(Object.isFrozen(document.spec.assets[0].qa)).toBe(true);
    expect(Buffer.isBuffer(document.source)).toBe(true);
    expect(document.source).toEqual(
      await readFile(new URL('./asset-spec.yaml', import.meta.url)),
    );
  });

  it('fails closed on invalid UTF-8 instead of hashing replacement text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-invalid-utf8-'));
    const path = join(directory, 'asset-spec.yaml');
    const valid = await readFile(new URL('./asset-spec.yaml', import.meta.url));
    await writeFile(path, Buffer.concat([Buffer.from('# invalid: '), Buffer.from([0xff]), Buffer.from('\n'), valid]));

    try {
      await expect(loadAssetSpecDocument(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires character identity applicability for sprite, boss, and cutin assets', async () => {
    const source = yaml.load(
      await readFile(new URL('./asset-spec.yaml', import.meta.url), 'utf8'),
    );
    for (const kind of ['sprite', 'boss', 'cutin']) {
      const invalid = structuredClone(source);
      invalid.assets[0].kind = kind;
      invalid.assets[0].identity = { mode: 'not-applicable' };
      expect(() => validateAssetSpec(invalid))
        .toThrow(`identity.mode cannot be not-applicable for ${kind}`);
    }
  });

  it('defaults multi-frame assets to a horizontal row-major shared-anchor layout', async () => {
    const source = yaml.load(
      await readFile(new URL('./asset-spec.yaml', import.meta.url), 'utf8'),
    );
    source.assets[0].frames = 4;
    delete source.assets[0].frameLayout;
    delete source.pipeline.atlas.extrusion;
    delete source.pipeline.atlas.maxSize;
    delete source.pipeline.approvalBlocks;

    const validated = validateAssetSpec(source);

    expect(validated.assets[0].frameLayout).toEqual({
      columns: 4,
      rows: 1,
      order: 'row-major',
      anchor: 'bottom-center',
      trim: 'shared-scale',
    });
    expect(validated.pipeline.atlas.extrusion).toBe(0);
    expect(validated.pipeline.atlas.maxSize).toBe(4096);
    expect(validated.pipeline.approvalBlocks).toEqual([
      'M1',
      'mass-production',
      'phaser-integration',
    ]);
  });

  it('validates an explicit frame grid and atlas extrusion without silent fallback', async () => {
    const source = yaml.load(
      await readFile(new URL('./asset-spec.yaml', import.meta.url), 'utf8'),
    );
    source.assets[0].frames = 4;
    source.assets[0].frameLayout = {
      columns: 2,
      rows: 2,
      order: 'row-major',
      anchor: 'bottom-center',
      trim: 'shared-scale',
    };
    source.pipeline.atlas.extrusion = 1;
    source.pipeline.atlas.maxSize = 2048;

    expect(validateAssetSpec(source).assets[0].frameLayout).toEqual(source.assets[0].frameLayout);

    const wrongCellCount = structuredClone(source);
    wrongCellCount.assets[0].frameLayout.columns = 3;
    expect(() => validateAssetSpec(wrongCellCount)).toThrow('frameLayout must contain exactly 4 cells');

    const unsupportedOrder = structuredClone(source);
    unsupportedOrder.assets[0].frameLayout.order = 'column-major';
    expect(() => validateAssetSpec(unsupportedOrder)).toThrow('frameLayout.order');

    const unsupportedField = structuredClone(source);
    unsupportedField.assets[0].frameLayout.gap = 2;
    expect(() => validateAssetSpec(unsupportedField)).toThrow('unsupported fields');

    const invalidLayouts = [
      ['columns', 0, 'positive integer'],
      ['rows', 1.5, 'positive integer'],
      ['anchor', 'center', 'bottom-center'],
      ['trim', 'per-frame-scale', 'shared-scale'],
    ];
    for (const [field, value, message] of invalidLayouts) {
      const invalid = structuredClone(source);
      invalid.assets[0].frameLayout[field] = value;
      expect(() => validateAssetSpec(invalid), field).toThrow(message);
    }

    for (const value of [-1, 1.5, 3]) {
      const unsafeExtrusion = structuredClone(source);
      unsafeExtrusion.pipeline.atlas.extrusion = value;
      expect(() => validateAssetSpec(unsafeExtrusion), `extrusion=${value}`).toThrow();
    }

    for (const value of [63, 1000, 16384]) {
      const unsafeMaxSize = structuredClone(source);
      unsafeMaxSize.pipeline.atlas.maxSize = value;
      expect(() => validateAssetSpec(unsafeMaxSize), `maxSize=${value}`).toThrow('maxSize');
    }

    for (const value of [[], ['G3', 'G3'], ['../G3'], 'G3']) {
      const unsafeApprovalBlocks = structuredClone(source);
      unsafeApprovalBlocks.pipeline.approvalBlocks = value;
      expect(() => validateAssetSpec(unsafeApprovalBlocks)).toThrow('approvalBlocks');
    }
  });
});
