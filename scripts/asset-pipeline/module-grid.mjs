import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import sharp from 'sharp';

import { writeFileAtomically } from './safe-paths.mjs';

const SCHEMA_VERSION = 1;
const TILE_SIZE = 64;
const SHEET_WIDTH = 1024;
const SHEET_HEIGHT = 1024;
const SHEET_COLUMNS = SHEET_WIDTH / TILE_SIZE;
const SHEET_ROWS = SHEET_HEIGHT / TILE_SIZE;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const MODULE_KINDS = new Set(['tile', 'structure', 'fixture', 'object', 'overlay']);
const MODULE_ANCHORS = new Set(['top-left', 'bottom-center']);
const VISIBLE_ALPHA = 8;
const MAX_TILE_EDGE_COLOR_DIFFERENCE = 64;

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireNonEmptyText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new TypeError(`${label} must be a non-empty string without surrounding whitespace`);
  }
  return value;
}

function requireExactFields(value, expected, label) {
  const object = requireObject(value, label);
  const actual = Object.keys(object);
  const unsupported = actual.filter((field) => !expected.includes(field));
  const missing = expected.filter((field) => !Object.hasOwn(object, field));
  if (unsupported.length > 0) {
    throw new TypeError(`${label} has unsupported fields: ${unsupported.join(', ')}`);
  }
  if (missing.length > 0) {
    throw new TypeError(`${label} is missing fields: ${missing.join(', ')}`);
  }
  return object;
}

function validateCellRect(value, moduleId) {
  const cellRect = requireObject(value, `module ${moduleId} cellRect`);
  const fields = ['column', 'row', 'columns', 'rows'];

  for (const field of fields) {
    if (!Number.isInteger(cellRect[field])) {
      throw new TypeError(`module ${moduleId} cellRect fields must be integers`);
    }
  }
  if (cellRect.column < 0 || cellRect.row < 0) {
    throw new RangeError(`module ${moduleId} cellRect origin must be non-negative`);
  }
  if (cellRect.columns <= 0 || cellRect.rows <= 0) {
    throw new RangeError(`module ${moduleId} cellRect size must be positive`);
  }
  if (
    cellRect.column + cellRect.columns > SHEET_COLUMNS
    || cellRect.row + cellRect.rows > SHEET_ROWS
  ) {
    throw new RangeError(
      `module ${moduleId} cellRect falls outside the ${SHEET_COLUMNS}x${SHEET_ROWS} sheet`,
    );
  }

  return {
    column: cellRect.column,
    row: cellRect.row,
    columns: cellRect.columns,
    rows: cellRect.rows,
  };
}

function derivePixelRect(cellRect) {
  return {
    x: cellRect.column * TILE_SIZE,
    y: cellRect.row * TILE_SIZE,
    width: cellRect.columns * TILE_SIZE,
    height: cellRect.rows * TILE_SIZE,
  };
}

function validateSourceRect(value, moduleId) {
  const sourceRect = requireExactFields(
    value,
    ['x', 'y', 'width', 'height'],
    `module ${moduleId} sourceRect`,
  );
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!Number.isInteger(sourceRect[field])) {
      throw new TypeError(`module ${moduleId} sourceRect fields must be integers`);
    }
  }
  if (sourceRect.x < 0 || sourceRect.y < 0) {
    throw new RangeError(`module ${moduleId} sourceRect origin must be non-negative`);
  }
  if (sourceRect.width <= 0 || sourceRect.height <= 0) {
    throw new RangeError(`module ${moduleId} sourceRect size must be positive`);
  }
  if (sourceRect.x + sourceRect.width > SHEET_WIDTH
    || sourceRect.y + sourceRect.height > SHEET_HEIGHT) {
    throw new RangeError(`module ${moduleId} sourceRect falls outside the source sheet`);
  }
  return {
    x: sourceRect.x,
    y: sourceRect.y,
    width: sourceRect.width,
    height: sourceRect.height,
  };
}

function rectanglesOverlap(left, right) {
  return left.column < right.column + right.columns
    && right.column < left.column + left.columns
    && left.row < right.row + right.rows
    && right.row < left.row + left.rows;
}

function validateModules(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('modules must be a non-empty array');
  }

  const ids = new Set();
  const modules = value.map((candidate, index) => {
    const moduleDefinition = requireExactFields(
      candidate,
      ['id', 'kind', 'cellRect', 'anchor'],
      `modules[${index}]`,
    );
    const id = requireNonEmptyText(moduleDefinition.id, `modules[${index}] id`);
    if (ids.has(id)) {
      throw new Error(`duplicate module id: ${id}`);
    }
    ids.add(id);

    const cellRect = validateCellRect(moduleDefinition.cellRect, id);
    const kind = requireNonEmptyText(moduleDefinition.kind, `module ${id} kind`);
    const anchor = requireNonEmptyText(moduleDefinition.anchor, `module ${id} anchor`);
    if (!MODULE_KINDS.has(kind)) throw new TypeError(`module ${id} kind is unsupported`);
    if (!MODULE_ANCHORS.has(anchor)) throw new TypeError(`module ${id} anchor is unsupported`);
    return {
      id,
      kind,
      cellRect,
      pixelRect: derivePixelRect(cellRect),
      anchor,
    };
  });

  for (let leftIndex = 0; leftIndex < modules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < modules.length; rightIndex += 1) {
      const left = modules[leftIndex];
      const right = modules[rightIndex];
      if (rectanglesOverlap(left.cellRect, right.cellRect)) {
        throw new Error(`module ${left.id} overlaps module ${right.id}`);
      }
    }
  }

  return modules.sort((left, right) => compareText(left.id, right.id));
}

export function validateModuleGridSpec(input, targetSize) {
  const moduleGrid = requireExactFields(
    input,
    ['tileSize', 'columns', 'rows', 'requiredIds', 'modules'],
    'moduleGrid',
  );
  if (targetSize?.width !== SHEET_WIDTH || targetSize?.height !== SHEET_HEIGHT) {
    throw new RangeError(`moduleGrid requires a ${SHEET_WIDTH}x${SHEET_HEIGHT} target`);
  }
  if (moduleGrid.tileSize !== TILE_SIZE
    || moduleGrid.columns !== SHEET_COLUMNS
    || moduleGrid.rows !== SHEET_ROWS) {
    throw new RangeError(
      `moduleGrid must define ${SHEET_COLUMNS}x${SHEET_ROWS} cells at ${TILE_SIZE}px`,
    );
  }
  if (!Array.isArray(moduleGrid.modules)) {
    throw new TypeError('moduleGrid.modules must be an array');
  }
  const modules = moduleGrid.modules.map((candidate, index) => {
    const moduleDefinition = requireExactFields(
      candidate,
      ['id', 'kind', 'sourceRect', 'cellRect', 'anchor'],
      `moduleGrid.modules[${index}]`,
    );
    const id = requireNonEmptyText(moduleDefinition.id, `moduleGrid.modules[${index}] id`);
    return {
      id,
      kind: moduleDefinition.kind,
      sourceRect: validateSourceRect(moduleDefinition.sourceRect, id),
      cellRect: moduleDefinition.cellRect,
      anchor: moduleDefinition.anchor,
    };
  });
  const catalogInput = {
    sheetSha256: '0'.repeat(64),
    requiredIds: moduleGrid.requiredIds,
    modules: modules.map(({ id, kind, cellRect, anchor }) => ({
      id,
      kind,
      cellRect,
      anchor,
    })),
  };
  const { catalog } = createModuleGridCatalog(catalogInput);
  const sourceById = new Map(modules.map((moduleDefinition) => [
    moduleDefinition.id,
    moduleDefinition.sourceRect,
  ]));
  return {
    tileSize: TILE_SIZE,
    columns: SHEET_COLUMNS,
    rows: SHEET_ROWS,
    requiredIds: catalog.requiredIds,
    modules: catalog.modules.map((moduleDefinition) => ({
      ...moduleDefinition,
      sourceRect: sourceById.get(moduleDefinition.id),
    })),
  };
}

function validateRequiredIds(value, moduleIds) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('requiredIds must be a non-empty array');
  }

  const requiredIds = new Set();
  for (const [index, candidate] of value.entries()) {
    const id = requireNonEmptyText(candidate, `requiredIds[${index}]`);
    if (requiredIds.has(id)) {
      throw new Error(`duplicate required id: ${id}`);
    }
    if (!moduleIds.has(id)) {
      throw new Error(`missing required module id: ${id}`);
    }
    requiredIds.add(id);
  }

  return [...requiredIds].sort(compareText);
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

/**
 * Validate and serialize a named module catalog for the fixed G2 cafeteria sheet.
 * The returned catalog is immutable so its canonical JSON and SHA-256 cannot drift.
 */
export function createModuleGridCatalog(input) {
  const candidate = requireExactFields(
    input,
    ['sheetSha256', 'requiredIds', 'modules'],
    'module grid input',
  );
  if (typeof candidate.sheetSha256 !== 'string' || !SHA_256_PATTERN.test(candidate.sheetSha256)) {
    throw new TypeError('sheetSha256 must be a lowercase SHA-256 hex digest');
  }

  const modules = validateModules(candidate.modules);
  const requiredIds = validateRequiredIds(
    candidate.requiredIds,
    new Set(modules.map(({ id }) => id)),
  );
  const catalog = deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    tileSize: TILE_SIZE,
    sheet: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      columns: SHEET_COLUMNS,
      rows: SHEET_ROWS,
      sha256: candidate.sheetSha256,
    },
    requiredIds,
    modules,
  });
  const canonicalJson = `${JSON.stringify(catalog, null, 2)}\n`;
  const catalogSha256 = createHash('sha256').update(canonicalJson).digest('hex');

  return deepFreeze({ catalog, canonicalJson, catalogSha256 });
}

function inspectModulePixels(data, sheetWidth, pixelRect) {
  let visiblePixels = 0;
  let transparentPixels = 0;
  let left = pixelRect.width;
  let top = pixelRect.height;
  let right = -1;
  let bottom = -1;
  for (let localY = 0; localY < pixelRect.height; localY += 1) {
    for (let localX = 0; localX < pixelRect.width; localX += 1) {
      const offset = (
        ((pixelRect.y + localY) * sheetWidth) + pixelRect.x + localX
      ) * 4;
      const alpha = data[offset + 3];
      if (alpha < 255) transparentPixels += 1;
      if (alpha <= VISIBLE_ALPHA) continue;
      visiblePixels += 1;
      left = Math.min(left, localX);
      top = Math.min(top, localY);
      right = Math.max(right, localX);
      bottom = Math.max(bottom, localY);
    }
  }
  return {
    visiblePixels,
    transparentPixels,
    bbox: visiblePixels === 0
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left, top, width: right - left + 1, height: bottom - top + 1 },
  };
}

function edgeColorDifference(data, sheetWidth, pixelRect) {
  let horizontalTotal = 0;
  let verticalTotal = 0;
  for (let offset = 0; offset < pixelRect.height; offset += 1) {
    const leftIndex = (((pixelRect.y + offset) * sheetWidth) + pixelRect.x) * 4;
    const rightIndex = leftIndex + ((pixelRect.width - 1) * 4);
    for (let channel = 0; channel < 3; channel += 1) {
      horizontalTotal += Math.abs(data[leftIndex + channel] - data[rightIndex + channel]);
    }
  }
  for (let offset = 0; offset < pixelRect.width; offset += 1) {
    const topIndex = ((pixelRect.y * sheetWidth) + pixelRect.x + offset) * 4;
    const bottomIndex = topIndex + ((pixelRect.height - 1) * sheetWidth * 4);
    for (let channel = 0; channel < 3; channel += 1) {
      verticalTotal += Math.abs(data[topIndex + channel] - data[bottomIndex + channel]);
    }
  }
  return {
    horizontalMean: Number((horizontalTotal / (pixelRect.height * 3)).toFixed(3)),
    verticalMean: Number((verticalTotal / (pixelRect.width * 3)).toFixed(3)),
  };
}

export async function repackModuleGrid(path, asset) {
  const moduleGrid = validateModuleGridSpec({
    ...asset.moduleGrid,
    modules: asset.moduleGrid.modules.map(({
      id,
      kind,
      sourceRect,
      cellRect,
      anchor,
    }) => ({ id, kind, sourceRect, cellRect, anchor })),
  }, asset.targetSize);
  const input = await readFile(path);
  const source = await sharp(input, { failOn: 'error' })
    .rotate()
    .ensureAlpha()
    .resize(SHEET_WIDTH, SHEET_HEIGHT, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const composites = [];
  for (const moduleDefinition of moduleGrid.modules) {
    const { sourceRect, pixelRect, kind, anchor } = moduleDefinition;
    let pipeline = sharp(source, { failOn: 'error' }).extract({
      left: sourceRect.x,
      top: sourceRect.y,
      width: sourceRect.width,
      height: sourceRect.height,
    }).ensureAlpha();
    let content;
    let contentWidth;
    let contentHeight;
    if (kind === 'tile') {
      const resized = await pipeline.resize(pixelRect.width, pixelRect.height, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      }).removeAlpha().ensureAlpha(1).png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      content = resized.data;
      contentWidth = resized.info.width;
      contentHeight = resized.info.height;
    } else {
      const gutter = 2;
      const resized = await pipeline.resize({
        width: pixelRect.width - (gutter * 2),
        height: pixelRect.height - (gutter * 2),
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
      content = resized.data;
      contentWidth = resized.info.width;
      contentHeight = resized.info.height;
    }
    const left = pixelRect.x + (anchor === 'top-left'
      ? 0
      : Math.floor((pixelRect.width - contentWidth) / 2));
    const top = pixelRect.y + (anchor === 'top-left'
      ? 0
      : pixelRect.height - 2 - contentHeight);
    composites.push({ input: content, left, top });
  }
  const output = await sharp({
    create: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  await writeFileAtomically(path, output);

  const raw = await sharp(output, { failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const modules = moduleGrid.modules.map((moduleDefinition) => {
    const pixels = inspectModulePixels(raw.data, raw.info.width, moduleDefinition.pixelRect);
    if (pixels.visiblePixels === 0) {
      throw new Error(`module ${moduleDefinition.id} has no visible pixels after packing`);
    }
    const touchesEdge = pixels.bbox.left === 0
      || pixels.bbox.top === 0
      || pixels.bbox.left + pixels.bbox.width === moduleDefinition.pixelRect.width
      || pixels.bbox.top + pixels.bbox.height === moduleDefinition.pixelRect.height;
    if (moduleDefinition.kind !== 'tile' && touchesEdge) {
      throw new Error(`module ${moduleDefinition.id} was clipped during packing`);
    }
    const edgeContinuity = moduleDefinition.kind === 'tile'
      ? edgeColorDifference(raw.data, raw.info.width, moduleDefinition.pixelRect)
      : null;
    if (edgeContinuity
      && (edgeContinuity.horizontalMean > MAX_TILE_EDGE_COLOR_DIFFERENCE
        || edgeContinuity.verticalMean > MAX_TILE_EDGE_COLOR_DIFFERENCE)) {
      throw new Error(`tile module ${moduleDefinition.id} failed edge continuity`);
    }
    return {
      id: moduleDefinition.id,
      visiblePixels: pixels.visiblePixels,
      transparentPixels: pixels.transparentPixels,
      bbox: pixels.bbox,
      ...(edgeContinuity ? {
        edgeContinuity: {
          passed: true,
          maximumMeanDifference: MAX_TILE_EDGE_COLOR_DIFFERENCE,
          ...edgeContinuity,
        },
      } : {}),
    };
  });
  return {
    applied: true,
    transform: 'module-grid-repack',
    tileSize: TILE_SIZE,
    columns: SHEET_COLUMNS,
    rows: SHEET_ROWS,
    modules,
  };
}
