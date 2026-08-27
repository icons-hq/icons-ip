import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import sharp from 'sharp';

const VISIBLE_ALPHA = 8;
const CHECKERBOARD_MIN_CHANNEL = 210;
const CHECKERBOARD_MAX_SPREAD = 20;
const CHECKERBOARD_EDGE_EROSION_PIXELS = 2;
const CHECKERBOARD_DECONTAMINATION_PIXELS = 6;
const CHECKERBOARD_ALPHA_FEATHER_PIXELS = 3;

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function isNeutralCheckerboardPixel(data, offset) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return Math.min(red, green, blue) >= CHECKERBOARD_MIN_CHANNEL
    && Math.max(red, green, blue) - Math.min(red, green, blue) <= CHECKERBOARD_MAX_SPREAD;
}

export async function restoreCheckerboardTransparency(path) {
  const input = await readFile(path);
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const totalPixels = info.width * info.height;
  const background = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let head = 0;
  let tail = 0;
  const enqueue = (index) => {
    if (background[index] === 1) return;
    if (!isNeutralCheckerboardPixel(data, index * info.channels)) return;
    background[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < info.width; x += 1) {
    enqueue(x);
    enqueue(((info.height - 1) * info.width) + x);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(y * info.width);
    enqueue((y * info.width) + info.width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < info.width) enqueue(index + 1);
    if (y > 0) enqueue(index - info.width);
    if (y + 1 < info.height) enqueue(index + info.width);
  }
  if (tail === 0) {
    throw new Error(`Checkerboard matte transform found no connected neutral background in ${path}`);
  }

  for (let pass = 0; pass < CHECKERBOARD_EDGE_EROSION_PIXELS; pass += 1) {
    const expanded = background.slice();
    for (let index = 0; index < totalPixels; index += 1) {
      if (background[index] === 1) continue;
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      if ((x > 0 && background[index - 1] === 1)
        || (x + 1 < info.width && background[index + 1] === 1)
        || (y > 0 && background[index - info.width] === 1)
        || (y + 1 < info.height && background[index + info.width] === 1)) {
        expanded[index] = 1;
      }
    }
    background.set(expanded);
  }

  const distance = new Uint16Array(totalPixels);
  distance.fill(65535);
  head = 0;
  tail = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    if (background[index] === 1) {
      distance[index] = 0;
      queue[tail] = index;
      tail += 1;
    }
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const nextDistance = distance[index] + 1;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    const visit = (neighbor) => {
      if (distance[neighbor] <= nextDistance) return;
      distance[neighbor] = nextDistance;
      queue[tail] = neighbor;
      tail += 1;
    };
    if (x > 0) visit(index - 1);
    if (x + 1 < info.width) visit(index + 1);
    if (y > 0) visit(index - info.width);
    if (y + 1 < info.height) visit(index + info.width);
  }

  const cleaned = Buffer.from(data);
  const neighbors = [-info.width, -1, 1, info.width];
  for (let layer = CHECKERBOARD_DECONTAMINATION_PIXELS; layer >= 1; layer -= 1) {
    for (let index = 0; index < totalPixels; index += 1) {
      if (distance[index] !== layer) continue;
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      let sourceIndex = -1;
      let sourceDistance = layer;
      for (const offset of neighbors) {
        const candidate = index + offset;
        if ((offset === -1 && x === 0)
          || (offset === 1 && x + 1 === info.width)
          || (offset === -info.width && y === 0)
          || (offset === info.width && y + 1 === info.height)) continue;
        if (distance[candidate] > sourceDistance) {
          sourceDistance = distance[candidate];
          sourceIndex = candidate;
        }
      }
      if (sourceIndex < 0) continue;
      const sourceOffset = sourceIndex * info.channels;
      const targetOffset = index * info.channels;
      cleaned[targetOffset] = cleaned[sourceOffset];
      cleaned[targetOffset + 1] = cleaned[sourceOffset + 1];
      cleaned[targetOffset + 2] = cleaned[sourceOffset + 2];
    }
  }

  const rgba = Buffer.alloc(totalPixels * 4);
  let transparentPixels = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    const sourceOffset = index * info.channels;
    const targetOffset = index * 4;
    rgba[targetOffset] = cleaned[sourceOffset];
    rgba[targetOffset + 1] = cleaned[sourceOffset + 1];
    rgba[targetOffset + 2] = cleaned[sourceOffset + 2];
    const transparent = background[index] === 1;
    const featherAlpha = distance[index] <= CHECKERBOARD_ALPHA_FEATHER_PIXELS
      ? Math.round((255 * distance[index]) / (CHECKERBOARD_ALPHA_FEATHER_PIXELS + 1))
      : 255;
    rgba[targetOffset + 3] = transparent ? 0 : featherAlpha;
    if (transparent) transparentPixels += 1;
  }
  const temporaryPath = `${path}.checkerboard-alpha.tmp.png`;
  await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toFile(temporaryPath);
  await rename(temporaryPath, path);
  return {
    applied: true,
    transform: 'checkerboard-matte-to-alpha',
    width: info.width,
    height: info.height,
    transparentPixels,
    transparentRatio: round(transparentPixels / totalPixels),
    edgeErosionPixels: CHECKERBOARD_EDGE_EROSION_PIXELS,
    colorDecontaminationPixels: CHECKERBOARD_DECONTAMINATION_PIXELS,
    alphaFeatherPixels: CHECKERBOARD_ALPHA_FEATHER_PIXELS,
  };
}

function locateVisiblePixels(data, width, height, channels) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let visiblePixels = 0;
  let transparentPixels = 0;
  let opaqueEdgePixels = 0;
  const edgePixels = width === 1 || height === 1
    ? width * height
    : (width * 2) + ((height - 2) * 2);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[((y * width) + x) * channels + 3];
      if (alpha < 255) transparentPixels += 1;
      if (alpha <= VISIBLE_ALPHA) continue;
      visiblePixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        opaqueEdgePixels += 1;
      }
    }
  }

  const bbox = visiblePixels === 0
    ? { left: 0, top: 0, width: 0, height: 0 }
    : { left, top, width: right - left + 1, height: bottom - top + 1 };
  return {
    bbox,
    visiblePixels,
    transparentPixels,
    opaqueEdgeRatio: edgePixels === 0 ? 0 : opaqueEdgePixels / edgePixels,
  };
}

function detectFrames(asset, image) {
  const expected = asset.frames;
  if (expected === 1) return { detected: 1, passed: true };
  const columns = asset.frameLayout?.columns ?? expected;
  const rows = asset.frameLayout?.rows ?? 1;
  const gridFits = columns * rows === expected
    && image.width % columns === 0
    && image.height % rows === 0;
  return { detected: gridFits ? expected : 0, passed: gridFits };
}

export async function inspectCandidate(path, asset) {
  const input = await readFile(path);
  const image = sharp(input, { failOn: 'error' }).rotate().ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const metadata = await sharp(input, { failOn: 'error' }).metadata();
  const pixels = locateVisiblePixels(data, info.width, info.height, info.channels);
  const totalPixels = info.width * info.height;
  const bboxCoverage = pixels.bbox.width * pixels.bbox.height / totalPixels;
  const hasTransparency = pixels.transparentPixels > 0;
  const alphaPassed = asset.alpha === 'required'
    ? metadata.hasAlpha === true && hasTransparency && pixels.visiblePixels > 0
    : asset.alpha === 'forbidden'
      ? !hasTransparency
      : pixels.visiblePixels > 0;
  const sizePassed = info.width >= asset.qa.minSourceSize.width
    && info.height >= asset.qa.minSourceSize.height;
  const trimApplicable = asset.alpha !== 'forbidden'
    && !['background', 'tileset'].includes(asset.kind);
  const trimPassed = !trimApplicable
    || (pixels.visiblePixels > 0 && bboxCoverage < 1 && pixels.opaqueEdgeRatio === 0);
  const frame = detectFrames(asset, info);
  const bboxPassed = pixels.visiblePixels > 0
    && bboxCoverage >= asset.qa.minBboxCoverage
    && bboxCoverage <= asset.qa.maxBboxCoverage;
  const edgesPassed = pixels.opaqueEdgeRatio <= asset.qa.maxOpaqueEdgeRatio;
  const checks = {
    alpha: {
      passed: alphaPassed,
      policy: asset.alpha,
      hasAlpha: metadata.hasAlpha === true,
      transparentRatio: round(pixels.transparentPixels / totalPixels),
    },
    size: {
      passed: sizePassed,
      width: info.width,
      height: info.height,
      minimumWidth: asset.qa.minSourceSize.width,
      minimumHeight: asset.qa.minSourceSize.height,
    },
    trim: {
      passed: trimPassed,
      applicable: trimApplicable,
      removablePixelRatio: round(1 - bboxCoverage),
    },
    frame: {
      passed: frame.passed,
      expected: asset.frames,
      detected: frame.detected,
    },
    bbox: {
      passed: bboxPassed,
      ...pixels.bbox,
      coverage: round(bboxCoverage),
      minimumCoverage: asset.qa.minBboxCoverage,
      maximumCoverage: asset.qa.maxBboxCoverage,
    },
    edges: {
      passed: edgesPassed,
      opaqueRatio: round(pixels.opaqueEdgeRatio),
      maximumOpaqueRatio: asset.qa.maxOpaqueEdgeRatio,
    },
  };

  return {
    schemaVersion: 1,
    assetId: asset.id,
    path,
    sha256: createHash('sha256').update(input).digest('hex'),
    format: metadata.format,
    passed: Object.values(checks).every(({ passed }) => passed),
    checks,
  };
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function normalizeAsset(sourcePath, outputDirectory, asset) {
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${asset.id}.png`);
  const input = sharp(sourcePath, { failOn: 'error' }).rotate();
  const isAtlasSprite = ['sprite', 'boss', 'ui'].includes(asset.kind);

  if (isAtlasSprite) {
    await input
      .ensureAlpha()
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(asset.targetSize.width, asset.targetSize.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
  } else {
    await input
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .resize(asset.targetSize.width, asset.targetSize.height, {
        fit: 'cover',
        position: 'centre',
      })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
  }

  const metadata = await sharp(outputPath, { failOn: 'error' }).metadata();
  return {
    assetId: asset.id,
    kind: asset.kind,
    path: outputPath,
    file: basename(outputPath),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    sha256: await sha256File(outputPath),
  };
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export async function buildSpriteAtlas(normalizedAssets, outputDirectory, options) {
  const sprites = normalizedAssets.filter(({ kind }) => ['sprite', 'boss', 'ui'].includes(kind));
  if (sprites.length === 0) throw new Error('Cannot build an empty sprite atlas');
  await mkdir(outputDirectory, { recursive: true });
  const padding = options.padding ?? 0;
  const atlasWidth = nextPowerOfTwo(
    sprites.reduce((total, sprite) => total + sprite.width, 0)
      + (padding * (sprites.length + 1)),
  );
  const atlasHeight = nextPowerOfTwo(
    Math.max(...sprites.map(({ height }) => height)) + (padding * 2),
  );
  let x = padding;
  const frames = {};
  const composites = [];
  for (const sprite of sprites) {
    const frame = { x, y: padding, w: sprite.width, h: sprite.height };
    frames[sprite.assetId] = {
      frame,
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: sprite.width, h: sprite.height },
      sourceSize: { w: sprite.width, h: sprite.height },
    };
    composites.push({ input: sprite.path, left: x, top: padding });
    x += sprite.width + padding;
  }

  const imageFile = `${options.name}.png`;
  const dataFile = `${options.name}.json`;
  const imagePath = join(outputDirectory, imageFile);
  const dataPath = join(outputDirectory, dataFile);
  await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9 }).toFile(imagePath);
  const data = {
    frames,
    meta: {
      app: 'icons-ip asset pipeline',
      version: '1',
      image: imageFile,
      format: 'RGBA8888',
      size: { w: atlasWidth, h: atlasHeight },
      scale: '1',
    },
  };
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  return {
    imagePath,
    dataPath,
    imageSha256: await sha256File(imagePath),
    data,
  };
}
