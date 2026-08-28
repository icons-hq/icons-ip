import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  createModuleGridCatalog,
  repackModuleGrid,
  validateModuleGridSpec,
} from './module-grid.mjs';

const SHA_256 = 'a'.repeat(64);

function moduleFixture(overrides = {}) {
  return {
    id: 'cafeteria_floor_clean',
    kind: 'tile',
    cellRect: { column: 0, row: 0, columns: 1, rows: 1 },
    anchor: 'bottom-center',
    ...overrides,
  };
}

function catalogFixture(overrides = {}) {
  return {
    sheetSha256: SHA_256,
    requiredIds: ['cafeteria_floor_clean'],
    modules: [moduleFixture()],
    ...overrides,
  };
}

describe('module grid catalog', () => {
  it('builds the fixed 1024px sheet contract and derives pixel rects from 64px cells', () => {
    const result = createModuleGridCatalog(catalogFixture());

    expect(result.catalog).toEqual({
      schemaVersion: 1,
      tileSize: 64,
      sheet: {
        width: 1024,
        height: 1024,
        columns: 16,
        rows: 16,
        sha256: SHA_256,
      },
      requiredIds: ['cafeteria_floor_clean'],
      modules: [{
        id: 'cafeteria_floor_clean',
        kind: 'tile',
        cellRect: { column: 0, row: 0, columns: 1, rows: 1 },
        pixelRect: { x: 0, y: 0, width: 64, height: 64 },
        anchor: 'bottom-center',
      }],
    });
    expect(result.canonicalJson).toBe(`${JSON.stringify(result.catalog, null, 2)}\n`);
    expect(result.catalogSha256).toBe(
      createHash('sha256').update(result.canonicalJson).digest('hex'),
    );
  });

  it('supports a named multi-cell module without exposing source packing coordinates', () => {
    const result = createModuleGridCatalog(catalogFixture({
      requiredIds: ['cafeteria_double_door'],
      modules: [moduleFixture({
        id: 'cafeteria_double_door',
        kind: 'object',
        cellRect: { column: 2, row: 3, columns: 3, rows: 2 },
      })],
    }));

    expect(result.catalog.modules[0]).toMatchObject({
      id: 'cafeteria_double_door',
      pixelRect: { x: 128, y: 192, width: 192, height: 128 },
    });
    expect(result.canonicalJson).not.toContain('sourceRect');
  });

  it('rejects overlapping module cell rectangles', () => {
    expect(() => createModuleGridCatalog(catalogFixture({
      requiredIds: ['left', 'right'],
      modules: [
        moduleFixture({
          id: 'left',
          cellRect: { column: 0, row: 0, columns: 2, rows: 2 },
        }),
        moduleFixture({
          id: 'right',
          cellRect: { column: 1, row: 1, columns: 2, rows: 2 },
        }),
      ],
    }))).toThrow('overlaps');
  });

  it.each([
    [{ column: -1, row: 0, columns: 1, rows: 1 }, 'non-negative'],
    [{ column: 15, row: 0, columns: 2, rows: 1 }, 'outside the 16x16 sheet'],
    [{ column: 0, row: 15, columns: 1, rows: 2 }, 'outside the 16x16 sheet'],
    [{ column: 0.5, row: 0, columns: 1, rows: 1 }, 'integers'],
    [{ column: 0, row: 0, columns: 0, rows: 1 }, 'positive'],
  ])('rejects an invalid or out-of-bounds cell rect %#', (cellRect, message) => {
    expect(() => createModuleGridCatalog(catalogFixture({
      modules: [moduleFixture({ cellRect })],
    }))).toThrow(message);
  });

  it('rejects duplicate module IDs', () => {
    expect(() => createModuleGridCatalog(catalogFixture({
      modules: [moduleFixture(), moduleFixture()],
    }))).toThrow('duplicate module id');
  });

  it('rejects a required ID that is absent from the module catalog', () => {
    expect(() => createModuleGridCatalog(catalogFixture({
      requiredIds: ['cafeteria_floor_clean', 'cafeteria_serving_counter'],
    }))).toThrow('missing required module id');
  });

  it('canonicalizes required IDs and modules independently of input order', () => {
    const floor = moduleFixture({ id: 'floor' });
    const door = moduleFixture({
      id: 'door',
      kind: 'object',
      cellRect: { column: 1, row: 0, columns: 2, rows: 2 },
    });

    const first = createModuleGridCatalog(catalogFixture({
      requiredIds: ['floor', 'door'],
      modules: [floor, door],
    }));
    const second = createModuleGridCatalog(catalogFixture({
      requiredIds: ['door', 'floor'],
      modules: [door, floor],
    }));

    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.catalogSha256).toBe(second.catalogSha256);
    expect(first.catalog.requiredIds).toEqual(['door', 'floor']);
    expect(first.catalog.modules.map(({ id }) => id)).toEqual(['door', 'floor']);
  });

  it.each([
    [{ sheetSha256: 'A'.repeat(64) }, 'lowercase SHA-256'],
    [{ requiredIds: ['cafeteria_floor_clean', 'cafeteria_floor_clean'] }, 'duplicate required id'],
    [{ modules: [moduleFixture({ id: '' })] }, 'id must be a non-empty'],
    [{ modules: [moduleFixture({ kind: '' })] }, 'kind must be a non-empty'],
    [{ modules: [moduleFixture({ anchor: '' })] }, 'anchor must be a non-empty'],
    [{ modules: [{ ...moduleFixture(), sourceRect: { x: 0, y: 0, width: 1, height: 1 } }] }, 'unsupported fields'],
  ])('fails closed on malformed catalog input %#', (overrides, message) => {
    expect(() => createModuleGridCatalog(catalogFixture(overrides))).toThrow(message);
  });

  it('validates source packing coordinates without exposing them in the public catalog', () => {
    const moduleGrid = validateModuleGridSpec({
      tileSize: 64,
      columns: 16,
      rows: 16,
      requiredIds: ['door'],
      modules: [{
        id: 'door',
        kind: 'structure',
        sourceRect: { x: 20, y: 30, width: 80, height: 90 },
        cellRect: { column: 2, row: 3, columns: 2, rows: 2 },
        anchor: 'bottom-center',
      }],
    }, { width: 1024, height: 1024 });

    expect(moduleGrid.modules[0]).toMatchObject({
      id: 'door',
      sourceRect: { x: 20, y: 30, width: 80, height: 90 },
      pixelRect: { x: 128, y: 192, width: 128, height: 128 },
    });
    expect(createModuleGridCatalog({
      sheetSha256: SHA_256,
      requiredIds: moduleGrid.requiredIds,
      modules: moduleGrid.modules.map(({ id, kind, cellRect, anchor }) => ({
        id,
        kind,
        cellRect,
        anchor,
      })),
    }).canonicalJson).not.toContain('sourceRect');
  });

  it.each([
    [{ width: 512, height: 1024 }, 'requires a 1024x1024 target'],
    [{ width: 1024, height: 1024 }, 'sourceRect falls outside'],
  ])('fails closed on an invalid source grid %#', (targetSize, message) => {
    const sourceRect = message.includes('outside')
      ? { x: 1000, y: 0, width: 25, height: 10 }
      : { x: 0, y: 0, width: 10, height: 10 };
    expect(() => validateModuleGridSpec({
      tileSize: 64,
      columns: 16,
      rows: 16,
      requiredIds: ['tile'],
      modules: [{
        id: 'tile',
        kind: 'tile',
        sourceRect,
        cellRect: { column: 1, row: 1, columns: 1, rows: 1 },
        anchor: 'top-left',
      }],
    }, targetSize)).toThrow(message);
  });

  it('re-packs tile and multi-cell object modules onto the validated 64px grid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-module-grid-'));
    const path = join(directory, 'sheet.png');
    try {
      await sharp({
        create: {
          width: 1024,
          height: 1024,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite([{
        input: {
          create: {
            width: 32,
            height: 32,
            channels: 4,
            background: { r: 30, g: 100, b: 60, alpha: 1 },
          },
        },
        left: 10,
        top: 10,
      }, {
        input: {
          create: {
            width: 80,
            height: 90,
            channels: 4,
            background: { r: 160, g: 90, b: 30, alpha: 1 },
          },
        },
        left: 100,
        top: 100,
      }]).png().toFile(path);

      const result = await repackModuleGrid(path, {
        targetSize: { width: 1024, height: 1024 },
        moduleGrid: {
          tileSize: 64,
          columns: 16,
          rows: 16,
          requiredIds: ['floor', 'door'],
          modules: [{
            id: 'floor',
            kind: 'tile',
            sourceRect: { x: 10, y: 10, width: 32, height: 32 },
            cellRect: { column: 1, row: 1, columns: 1, rows: 1 },
            anchor: 'top-left',
          }, {
            id: 'door',
            kind: 'structure',
            sourceRect: { x: 100, y: 100, width: 80, height: 90 },
            cellRect: { column: 3, row: 2, columns: 2, rows: 2 },
            anchor: 'bottom-center',
          }],
        },
      });
      const metadata = await sharp(path).metadata();
      const floor = await sharp(path).extract({ left: 64, top: 64, width: 64, height: 64 })
        .ensureAlpha().raw().toBuffer();
      const outside = await sharp(path).extract({ left: 0, top: 0, width: 1, height: 1 })
        .ensureAlpha().raw().toBuffer();

      expect(metadata).toMatchObject({ width: 1024, height: 1024, hasAlpha: true });
      expect(result.modules.map(({ id }) => id)).toEqual(['door', 'floor']);
      expect(result.modules.find(({ id }) => id === 'floor')?.transparentPixels).toBe(0);
      expect([...floor.subarray(0, 4)]).toEqual([30, 100, 60, 255]);
      expect(outside[3]).toBe(0);
      expect(createHash('sha256').update(await readFile(path)).digest('hex')).toMatch(
        /^[0-9a-f]{64}$/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when a repeatable tile has discontinuous opposite edges', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-module-grid-seam-'));
    const path = join(directory, 'sheet.png');
    try {
      const red = await sharp({
        create: {
          width: 16,
          height: 32,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
      }).png().toBuffer();
      const blue = await sharp({
        create: {
          width: 16,
          height: 32,
          channels: 4,
          background: { r: 0, g: 0, b: 255, alpha: 1 },
        },
      }).png().toBuffer();
      await sharp({
        create: {
          width: 1024,
          height: 1024,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite([
        { input: red, left: 10, top: 10 },
        { input: blue, left: 26, top: 10 },
      ]).png().toFile(path);

      await expect(repackModuleGrid(path, {
        targetSize: { width: 1024, height: 1024 },
        moduleGrid: {
          tileSize: 64,
          columns: 16,
          rows: 16,
          requiredIds: ['floor'],
          modules: [{
            id: 'floor',
            kind: 'tile',
            sourceRect: { x: 10, y: 10, width: 32, height: 32 },
            cellRect: { column: 1, row: 1, columns: 1, rows: 1 },
            anchor: 'top-left',
          }],
        },
      })).rejects.toThrow('failed edge continuity');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
