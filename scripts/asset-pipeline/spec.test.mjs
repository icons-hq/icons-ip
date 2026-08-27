import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { loadAssetSpec, loadAssetSpecDocument, validateAssetSpec } from './spec.mjs';

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
});
