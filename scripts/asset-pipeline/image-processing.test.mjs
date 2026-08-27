import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSpriteAtlas,
  inspectCandidate,
  normalizeAsset,
  restoreMagentaTransparency,
} from './image-processing.mjs';

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('technical image QA', () => {
  it('restores real alpha from a magenta matte while preserving white uniform sleeves', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-magenta-alpha-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'candidate.png');
    const externalFile = join(directory, 'external-user-data.png');
    const legacyTemporaryPath = `${path}.magenta-alpha.tmp.png`;
    await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 240, g: 20, b: 230 },
      },
    }).composite([
      {
        input: {
          create: {
            width: 1,
            height: 16,
            channels: 3,
            background: { r: 100, g: 20, b: 110 },
          },
        },
        left: 17,
        top: 2,
      },
      {
        input: {
          create: {
            width: 14,
            height: 16,
            channels: 3,
            background: { r: 20, g: 96, b: 58 },
          },
        },
        left: 3,
        top: 2,
      },
      {
        input: {
          create: {
            width: 4,
            height: 8,
            channels: 3,
            background: { r: 248, g: 248, b: 244 },
          },
        },
        left: 2,
        top: 4,
      },
    ]).png().toFile(path);
    await writeFile(externalFile, 'external-user-data', 'utf8');
    await symlink(externalFile, legacyTemporaryPath);

    const transform = await restoreMagentaTransparency(path);
    const report = await inspectCandidate(path, {
      id: 'sprite_fixture',
      kind: 'sprite',
      frames: 1,
      alpha: 'required',
      targetSize: { width: 16, height: 16 },
      qa: {
        minSourceSize: { width: 16, height: 16 },
        maxOpaqueEdgeRatio: 0,
        minBboxCoverage: 0.05,
        maxBboxCoverage: 0.8,
      },
    });

    expect(transform).toMatchObject({
      applied: true,
      width: 20,
      height: 20,
      colorDecontaminationPixels: 24,
      colorDecontaminationSearchPixels: 48,
      alphaFeatherPixels: 2,
    });
    expect(report.passed).toBe(true);
    expect(report.checks.alpha).toMatchObject({ hasAlpha: true, passed: true });
    const pixel = await sharp(path).extract({ left: 10, top: 10, width: 1, height: 1 })
      .raw().toBuffer();
    expect([...pixel]).toEqual([20, 96, 58, 255]);
    const whiteSleevePixel = await sharp(path).extract({ left: 3, top: 7, width: 1, height: 1 })
      .raw().toBuffer();
    expect([...whiteSleevePixel]).toEqual([248, 248, 244, 255]);
    const decontaminatedEdgePixel = await sharp(path)
      .extract({ left: 17, top: 10, width: 1, height: 1 }).raw().toBuffer();
    expect([...decontaminatedEdgePixel]).toEqual([20, 96, 58, 85]);
    const transparentPixel = await sharp(path).extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw().toBuffer();
    expect([...transparentPixel]).toEqual([0, 0, 0, 0]);
    expect(await readFile(externalFile, 'utf8')).toBe('external-user-data');
    expect((await lstat(path)).isSymbolicLink()).toBe(false);
  });

  it('reports alpha, size, trim, frame, bbox, and edge checks for a sprite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-technical-qa-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'candidate.png');
    await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: 6,
          height: 4,
          channels: 4,
          background: { r: 80, g: 120, b: 160, alpha: 1 },
        },
      },
      left: 7,
      top: 8,
    }]).png().toFile(path);

    const report = await inspectCandidate(path, {
      id: 'sprite_fixture',
      kind: 'sprite',
      frames: 1,
      alpha: 'required',
      targetSize: { width: 16, height: 16 },
      qa: {
        minSourceSize: { width: 16, height: 16 },
        maxOpaqueEdgeRatio: 0,
        minBboxCoverage: 0.05,
        maxBboxCoverage: 0.5,
      },
    });

    expect(report.passed).toBe(true);
    expect(Object.keys(report.checks)).toEqual([
      'alpha',
      'size',
      'trim',
      'frame',
      'bbox',
      'edges',
    ]);
    expect(report.checks.alpha).toMatchObject({ passed: true, hasAlpha: true });
    expect(report.checks.size).toMatchObject({ passed: true, width: 20, height: 20 });
    expect(report.checks.trim).toMatchObject({ passed: true, applicable: true });
    expect(report.checks.frame).toMatchObject({ passed: true, expected: 1, detected: 1 });
    expect(report.checks.bbox).toMatchObject({
      passed: true,
      left: 7,
      top: 8,
      width: 6,
      height: 4,
    });
    expect(report.checks.edges).toMatchObject({ passed: true, opaqueRatio: 0 });
  });

  it('normalizes selected concepts and packs only sprites into a deterministic atlas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-normalize-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const sourceA = join(directory, 'player.png');
    const sourceB = join(directory, 'zombie.png');
    const sourceBackground = join(directory, 'cafeteria.png');
    const outputDirectory = join(directory, 'selected');
    const atlasDirectory = join(directory, 'atlas');
    const sprite = (r, g, b) => sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: 8,
          height: 12,
          channels: 4,
          background: { r, g, b, alpha: 1 },
        },
      },
      left: 6,
      top: 4,
    }]).png();
    await sprite(60, 90, 120).toFile(sourceA);
    await sprite(120, 90, 60).toFile(sourceB);
    await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: { r: 20, g: 30, b: 40 },
      },
    }).png().toFile(sourceBackground);

    const normalized = await Promise.all([
      normalizeAsset(sourceA, outputDirectory, {
        id: 'player', kind: 'sprite', targetSize: { width: 16, height: 16 },
      }),
      normalizeAsset(sourceB, outputDirectory, {
        id: 'zombie', kind: 'sprite', targetSize: { width: 16, height: 16 },
      }),
      normalizeAsset(sourceBackground, outputDirectory, {
        id: 'cafeteria', kind: 'background', targetSize: { width: 32, height: 20 },
      }),
    ]);
    const atlas = await buildSpriteAtlas(normalized, atlasDirectory, {
      name: 'fixture-atlas',
      padding: 2,
    });

    await expect(sharp(normalized[0].path).metadata()).resolves.toMatchObject({
      width: 16,
      height: 16,
    });
    await expect(sharp(normalized[2].path).metadata()).resolves.toMatchObject({
      width: 32,
      height: 20,
    });
    expect(Object.keys(atlas.data.frames)).toEqual(['player', 'zombie']);
    expect(atlas.data.frames.player.frame).toEqual({ x: 2, y: 2, w: 16, h: 16 });
    expect(atlas.data.frames.zombie.frame).toEqual({ x: 20, y: 2, w: 16, h: 16 });
    expect(atlas.data.meta.size).toEqual({ w: 64, h: 32 });
  });

  it('does not follow normalized or atlas output-file symlinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-image-output-link-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, 'source.png');
    const normalizedDirectory = join(directory, 'normalized');
    const atlasDirectory = join(directory, 'atlas');
    const normalizedPath = join(normalizedDirectory, 'player.png');
    const atlasImagePath = join(atlasDirectory, 'fixture-atlas.png');
    const atlasDataPath = join(atlasDirectory, 'fixture-atlas.json');
    const normalizedVictim = join(directory, 'normalized-victim');
    const atlasImageVictim = join(directory, 'atlas-image-victim');
    const atlasDataVictim = join(directory, 'atlas-data-victim');
    await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: {
        create: {
          width: 8,
          height: 12,
          channels: 4,
          background: { r: 60, g: 90, b: 120, alpha: 1 },
        },
      },
      left: 6,
      top: 4,
    }]).png().toFile(source);
    await Promise.all([
      mkdir(normalizedDirectory, { recursive: true }),
      mkdir(atlasDirectory, { recursive: true }),
      writeFile(normalizedVictim, 'normalized-user-data', 'utf8'),
      writeFile(atlasImageVictim, 'atlas-image-user-data', 'utf8'),
      writeFile(atlasDataVictim, 'atlas-data-user-data', 'utf8'),
    ]);
    await Promise.all([
      symlink(normalizedVictim, normalizedPath),
      symlink(atlasImageVictim, atlasImagePath),
      symlink(atlasDataVictim, atlasDataPath),
    ]);

    const normalized = await normalizeAsset(source, normalizedDirectory, {
      id: 'player', kind: 'sprite', targetSize: { width: 16, height: 16 },
    });
    await buildSpriteAtlas([normalized], atlasDirectory, {
      name: 'fixture-atlas',
      padding: 2,
    });

    expect(await readFile(normalizedVictim, 'utf8')).toBe('normalized-user-data');
    expect(await readFile(atlasImageVictim, 'utf8')).toBe('atlas-image-user-data');
    expect(await readFile(atlasDataVictim, 'utf8')).toBe('atlas-data-user-data');
    expect((await lstat(normalizedPath)).isSymbolicLink()).toBe(false);
    expect((await lstat(atlasImagePath)).isSymbolicLink()).toBe(false);
    expect((await lstat(atlasDataPath)).isSymbolicLink()).toBe(false);
  });
});
