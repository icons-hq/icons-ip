import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSpriteAtlas,
  inspectCandidate,
  normalizeAsset,
  regridFrameSheet,
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

  it('replaces isolated interior matte pixels instead of leaking chroma into the asset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-magenta-interior-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'candidate.png');
    await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: { r: 240, g: 20, b: 230 },
      },
    }).composite([
      {
        input: {
          create: {
            width: 70,
            height: 70,
            channels: 3,
            background: { r: 30, g: 110, b: 70 },
          },
        },
        left: 5,
        top: 5,
      },
      {
        input: {
          create: {
            width: 3,
            height: 3,
            channels: 3,
            background: { r: 240, g: 20, b: 230 },
          },
        },
        left: 38,
        top: 38,
      },
    ]).png().toFile(path);

    const transform = await restoreMagentaTransparency(path);
    const centerPixel = await sharp(path)
      .extract({ left: 39, top: 39, width: 1, height: 1 }).raw().toBuffer();

    expect([...centerPixel]).toEqual([30, 110, 70, 255]);
    expect(transform.interiorChromaReplacedPixels).toBe(9);
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

  it('regrids connected frame silhouettes row-major with shared scale and safe anchors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-frame-regrid-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'candidate.png');
    const colors = [
      { r: 210, g: 40, b: 30 },
      { r: 30, g: 180, b: 60 },
      { r: 40, g: 80, b: 210 },
      { r: 220, g: 170, b: 30 },
    ];
    await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 240, g: 20, b: 230 },
      },
    }).composite(colors.map((color, index) => ({
      input: {
        create: {
          width: index === 1 ? 4 : 3,
          height: index === 0 ? 4 : index === 2 ? 6 : 3,
          channels: 3,
          background: color,
        },
      },
      left: (index % 2) * 10 + 3,
      top: Math.floor(index / 2) * 10 + (index < 2 ? 7 : 3),
    }))).png().toFile(path);
    await restoreMagentaTransparency(path);

    const transform = await regridFrameSheet(path, {
      id: 'four_frame_sprite',
      frames: 4,
      frameLayout: {
        columns: 2,
        rows: 2,
        order: 'row-major',
        anchor: 'bottom-center',
        trim: 'shared-scale',
      },
    }, { padding: 1 });
    const report = await inspectCandidate(path, {
      id: 'four_frame_sprite',
      kind: 'sprite',
      frames: 4,
      frameLayout: {
        columns: 2,
        rows: 2,
        order: 'row-major',
        anchor: 'bottom-center',
        trim: 'shared-scale',
      },
      alpha: 'required',
      qa: {
        minSourceSize: { width: 20, height: 20 },
        maxOpaqueEdgeRatio: 0,
        minBboxCoverage: 0.05,
        maxBboxCoverage: 0.8,
      },
    });

    expect(transform).toMatchObject({
      applied: true,
      detectedComponents: 4,
      selectedComponents: 4,
      padding: 1,
      layout: { columns: 2, rows: 2, order: 'row-major' },
    });
    expect(report.passed).toBe(true);
    expect(report.checks.edges.frames.every(({ opaqueRatio }) => opaqueRatio === 0)).toBe(true);
    for (const [index, color] of colors.entries()) {
      const pixel = await sharp(path).extract({
        left: (index % 2) * 10 + 5,
        top: Math.floor(index / 2) * 10 + 7,
        width: 1,
        height: 1,
      }).raw().toBuffer();
      expect([...pixel].slice(0, 3)).toEqual([color.r, color.g, color.b]);
    }
  });

  it('rejects regridding when an extra silhouette is too large to discard safely', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-frame-regrid-ambiguous-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'candidate.png');
    await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([
      { left: 1, top: 1 },
      { left: 6, top: 1 },
      { left: 11, top: 1 },
      { left: 1, top: 11 },
      { left: 11, top: 11 },
    ].map(({ left, top }, index) => ({
      input: {
        create: {
          width: 3,
          height: 3,
          channels: 4,
          background: { r: 40 + index * 30, g: 100, b: 160, alpha: 1 },
        },
      },
      left,
      top,
    }))).png().toFile(path);

    await expect(regridFrameSheet(path, {
      id: 'ambiguous_four_frame_sprite',
      frames: 4,
      frameLayout: {
        columns: 2,
        rows: 2,
        order: 'row-major',
        anchor: 'bottom-center',
        trim: 'shared-scale',
      },
    }, { padding: 1 })).rejects.toThrow(
      'Cannot regrid ambiguous_four_frame_sprite: extra frame silhouettes are ambiguous',
    );
  });

  it('fails frame QA when a declared grid cell has no visible sprite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-empty-frame-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'candidate.png');
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([0, 1, 2].map((index) => ({
      input: {
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 60 + index * 40, g: 100, b: 120, alpha: 1 },
        },
      },
      left: (index % 2) * 4 + 1,
      top: Math.floor(index / 2) * 4 + 1,
    }))).png().toFile(path);

    const report = await inspectCandidate(path, {
      id: 'four_frame_sprite',
      kind: 'sprite',
      frames: 4,
      frameLayout: {
        columns: 2,
        rows: 2,
        order: 'row-major',
        anchor: 'bottom-center',
        trim: 'shared-scale',
      },
      alpha: 'required',
      targetSize: { width: 4, height: 4 },
      qa: {
        minSourceSize: { width: 8, height: 8 },
        maxOpaqueEdgeRatio: 0,
        minBboxCoverage: 0.05,
        maxBboxCoverage: 0.9,
      },
    });

    expect(report.passed).toBe(false);
    expect(report.checks.frame).toMatchObject({
      passed: false,
      expected: 4,
      detected: 3,
      empty: [3],
    });
  });

  it('evaluates trim, bbox, and edges per frame instead of across the whole sheet', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-frame-qa-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'candidate.png');
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([0, 1, 2, 3].map((index) => ({
      input: {
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 60 + index * 40, g: 100, b: 120, alpha: 1 },
        },
      },
      left: (index % 2) * 4 + 1,
      top: Math.floor(index / 2) * 4 + 1,
    }))).png().toFile(path);
    const report = await inspectCandidate(path, {
      id: 'four_frame_sprite',
      kind: 'sprite',
      frames: 4,
      frameLayout: {
        columns: 2,
        rows: 2,
        order: 'row-major',
        anchor: 'bottom-center',
        trim: 'shared-scale',
      },
      alpha: 'required',
      targetSize: { width: 4, height: 4 },
      qa: {
        minSourceSize: { width: 8, height: 8 },
        maxOpaqueEdgeRatio: 0,
        minBboxCoverage: 0.2,
        maxBboxCoverage: 0.3,
      },
    });

    expect(report.passed).toBe(true);
    expect(report.checks.bbox.frames.map(({ coverage }) => coverage))
      .toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(report.checks.edges.frames.map(({ opaqueRatio }) => opaqueRatio))
      .toEqual([0, 0, 0, 0]);
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
    expect(createHash('sha256').update(await readFile(normalized[0].path)).digest('hex'))
      .toBe('14921e6044735e41ba01cec4d781ae591f24aeae2be210fb29d1331ce277ebb1');
  });

  it('normalizes a 2x2 color fixture with shared scale and emits row-major extruded frames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-frame-grid-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, 'walk.png');
    const outputDirectory = join(directory, 'selected');
    const atlasDirectory = join(directory, 'atlas');
    const colors = [
      { r: 220, g: 40, b: 40 },
      { r: 40, g: 180, b: 70 },
      { r: 50, g: 90, b: 220 },
      { r: 230, g: 190, b: 30 },
    ];
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(colors.map((color, index) => ({
      input: {
        create: {
          width: index === 1 ? 1 : 2,
          height: 1,
          channels: 4,
          background: { ...color, alpha: 1 },
        },
      },
      left: (index % 2) * 4 + 1,
      top: Math.floor(index / 2) * 4 + 3,
    }))).png().toFile(source);

    const normalized = await normalizeAsset(source, outputDirectory, {
      id: 'player_walk',
      kind: 'sprite',
      frames: 4,
      alpha: 'required',
      targetSize: { width: 4, height: 4 },
      frameLayout: {
        columns: 2,
        rows: 2,
        order: 'row-major',
        anchor: 'bottom-center',
        trim: 'shared-scale',
      },
    });
    const atlas = await buildSpriteAtlas([normalized], atlasDirectory, {
      name: 'fixture-atlas',
      padding: 2,
      extrusion: 1,
    });

    await expect(sharp(normalized.path).metadata()).resolves.toMatchObject({
      width: 8,
      height: 8,
      hasAlpha: true,
    });
    expect(Object.keys(atlas.data.frames)).toEqual([
      'player_walk_00',
      'player_walk_01',
      'player_walk_02',
      'player_walk_03',
    ]);
    expect(Object.values(atlas.data.frames).map(({ frame }) => frame)).toEqual([
      { x: 2, y: 2, w: 4, h: 4 },
      { x: 8, y: 2, w: 4, h: 4 },
      { x: 14, y: 2, w: 4, h: 4 },
      { x: 20, y: 2, w: 4, h: 4 },
    ]);
    expect(atlas.data.meta.size).toEqual({ w: 32, h: 8 });

    for (const [index, color] of colors.entries()) {
      const frame = atlas.data.frames[`player_walk_0${index}`].frame;
      const center = await sharp(atlas.imagePath)
        .extract({ left: frame.x + 1, top: frame.y + 2, width: 1, height: 1 })
        .raw().toBuffer();
      expect([...center]).toEqual([color.r, color.g, color.b, 255]);
      const bottomExtrusion = await sharp(atlas.imagePath)
        .extract({ left: frame.x + 1, top: frame.y + frame.h, width: 1, height: 1 })
        .raw().toBuffer();
      expect([...bottomExtrusion]).toEqual([color.r, color.g, color.b, 255]);
    }
    const smallerFrame = atlas.data.frames.player_walk_01.frame;
    const smallerFrameTop = await sharp(atlas.imagePath)
      .extract({ left: smallerFrame.x + 1, top: smallerFrame.y, width: 1, height: 1 })
      .raw().toBuffer();
    expect(smallerFrameTop[3]).toBe(0);
  });

  it('preserves required alpha for non-atlas assets and rejects opaque normalized output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-non-atlas-alpha-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const transparentSource = join(directory, 'cutin-transparent.png');
    const opaqueSource = join(directory, 'cutin-opaque.png');
    const outputDirectory = join(directory, 'selected');
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
          background: { r: 40, g: 110, b: 80, alpha: 1 },
        },
      },
      left: 6,
      top: 4,
    }]).png().toFile(transparentSource);
    await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 40, g: 110, b: 80 },
      },
    }).png().toFile(opaqueSource);
    const asset = {
      id: 'character_cutin',
      kind: 'cutin',
      frames: 1,
      alpha: 'required',
      targetSize: { width: 16, height: 16 },
    };

    const normalized = await normalizeAsset(transparentSource, outputDirectory, asset);
    const corner = await sharp(normalized.path)
      .extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();

    await expect(sharp(normalized.path).metadata()).resolves.toMatchObject({ hasAlpha: true });
    expect(corner[3]).toBe(0);
    await expect(normalizeAsset(opaqueSource, outputDirectory, {
      ...asset,
      id: 'opaque_cutin',
    })).rejects.toThrow('required alpha');
  });

  it('wraps atlas entries deterministically before the configured texture-size limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-atlas-wrap-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const spritePath = join(directory, 'sprite.png');
    const atlasDirectory = join(directory, 'atlas');
    await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 70, g: 120, b: 80, alpha: 1 },
      },
    }).png().toFile(spritePath);

    const atlas = await buildSpriteAtlas([
      { assetId: 'one', kind: 'sprite', path: spritePath, width: 4, height: 4, frames: 1 },
      { assetId: 'two', kind: 'sprite', path: spritePath, width: 4, height: 4, frames: 1 },
      { assetId: 'three', kind: 'sprite', path: spritePath, width: 4, height: 4, frames: 1 },
    ], atlasDirectory, {
      name: 'wrapped-atlas',
      padding: 2,
      maxSize: 16,
    });

    expect(Object.values(atlas.data.frames).map(({ frame }) => frame)).toEqual([
      { x: 2, y: 2, w: 4, h: 4 },
      { x: 8, y: 2, w: 4, h: 4 },
      { x: 2, y: 8, w: 4, h: 4 },
    ]);
    expect(atlas.data.meta.size).toEqual({ w: 16, h: 16 });

    await expect(buildSpriteAtlas([
      { assetId: 'too_tall', kind: 'sprite', path: spritePath, width: 4, height: 20, frames: 1 },
    ], atlasDirectory, {
      name: 'oversized-atlas',
      padding: 2,
      maxSize: 16,
    })).rejects.toThrow('maxSize');
  });

  it('preserves the approved M0 single-frame atlas keys and bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-m0-atlas-contract-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const player = fileURLToPath(new URL(
      '../../docs/games/hyosan-memories-m0-concepts/selected/player_halfbie_concept.png',
      import.meta.url,
    ));
    const zombie = fileURLToPath(new URL(
      '../../docs/games/hyosan-memories-m0-concepts/selected/student_zombie_concept.png',
      import.meta.url,
    ));
    const atlas = await buildSpriteAtlas([
      {
        assetId: 'player_halfbie_concept',
        kind: 'sprite',
        path: player,
        width: 512,
        height: 512,
      },
      {
        assetId: 'student_zombie_concept',
        kind: 'sprite',
        path: zombie,
        width: 512,
        height: 512,
      },
    ], directory, { name: 'hyosan-memories-m0-sprites', padding: 2 });

    expect(Object.keys(atlas.data.frames)).toEqual([
      'player_halfbie_concept',
      'student_zombie_concept',
    ]);
    expect(createHash('sha256').update(await readFile(atlas.imagePath)).digest('hex'))
      .toBe('1a5f1d5680b1f5e2d3377f876f8301ed5cd5b167821797a0582186a67d64944a');
    expect(createHash('sha256').update(await readFile(atlas.dataPath)).digest('hex'))
      .toBe('8fdfa33809821e5ca91ba46a333bc778833b346416fd8e20ab7730a978f8a045');
  });

  it('rejects generated multi-frame keys that collide with another asset id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-atlas-key-collision-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const sheet = join(directory, 'walk.png');
    const single = join(directory, 'walk-00.png');
    await sharp({
      create: {
        width: 8,
        height: 4,
        channels: 4,
        background: { r: 40, g: 80, b: 120, alpha: 1 },
      },
    }).png().toFile(sheet);
    await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 120, g: 80, b: 40, alpha: 1 },
      },
    }).png().toFile(single);

    await expect(buildSpriteAtlas([
      {
        assetId: 'walk',
        kind: 'sprite',
        path: sheet,
        width: 8,
        height: 4,
        frames: 2,
        frameSize: { width: 4, height: 4 },
        frameLayout: {
          columns: 2,
          rows: 1,
          order: 'row-major',
          anchor: 'bottom-center',
          trim: 'shared-scale',
        },
      },
      {
        assetId: 'walk_00',
        kind: 'sprite',
        path: single,
        width: 4,
        height: 4,
        frames: 1,
      },
    ], directory, { name: 'collision', padding: 2 }))
      .rejects.toThrow('duplicate frame key walk_00');
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
