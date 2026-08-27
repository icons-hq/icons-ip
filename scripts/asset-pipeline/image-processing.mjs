import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import sharp from 'sharp';

import { assetKindSupports } from './asset-kinds.mjs';
import { writeFileAtomically } from './safe-paths.mjs';

const VISIBLE_ALPHA = 8;
const MAGENTA_MIN_RED = 205;
const MAGENTA_MIN_BLUE = 195;
const MAGENTA_MAX_GREEN = 90;
const MAGENTA_MIN_RED_GREEN_GAP = 130;
const MAGENTA_MIN_BLUE_GREEN_GAP = 120;
const MAGENTA_MAX_RED_BLUE_SPREAD = 60;
const MAGENTA_MIN_EDGE_RATIO = 0.85;
const MAGENTA_MIN_BACKGROUND_RATIO = 0.05;
const MAGENTA_MAX_BACKGROUND_RATIO = 0.98;
const MAGENTA_DECONTAMINATION_PIXELS = 24;
const MAGENTA_DECONTAMINATION_SEARCH_PIXELS = 48;
const MAGENTA_ALPHA_FEATHER_PIXELS = 2;

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function isMagentaMattePixel(data, offset) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return red >= MAGENTA_MIN_RED
    && blue >= MAGENTA_MIN_BLUE
    && green <= MAGENTA_MAX_GREEN
    && red - green >= MAGENTA_MIN_RED_GREEN_GAP
    && blue - green >= MAGENTA_MIN_BLUE_GREEN_GAP
    && Math.abs(red - blue) <= MAGENTA_MAX_RED_BLUE_SPREAD;
}

function isMagentaContaminatedPixel(data, offset) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return red >= 30
    && blue >= 30
    && ((red + blue) / 2) - green >= 20
    && Math.abs(red - blue) <= 120;
}

export async function restoreMagentaTransparency(path) {
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
    if (!isMagentaMattePixel(data, index * info.channels)) return;
    background[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  let edgeSamples = 0;
  let edgeChromaSamples = 0;
  const sampleEdge = (index) => {
    edgeSamples += 1;
    if (isMagentaMattePixel(data, index * info.channels)) edgeChromaSamples += 1;
    enqueue(index);
  };
  for (let x = 0; x < info.width; x += 1) {
    sampleEdge(x);
    if (info.height > 1) sampleEdge(((info.height - 1) * info.width) + x);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    sampleEdge(y * info.width);
    if (info.width > 1) sampleEdge((y * info.width) + info.width - 1);
  }
  const edgeChromaRatio = edgeSamples === 0 ? 0 : edgeChromaSamples / edgeSamples;
  if (edgeChromaRatio < MAGENTA_MIN_EDGE_RATIO) {
    throw new Error(`Magenta matte transform requires at least ${MAGENTA_MIN_EDGE_RATIO} chroma coverage on the image edge in ${path}`);
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
    throw new Error(`Magenta matte transform found no connected chroma background in ${path}`);
  }
  const backgroundRatio = tail / totalPixels;
  if (backgroundRatio < MAGENTA_MIN_BACKGROUND_RATIO
    || backgroundRatio > MAGENTA_MAX_BACKGROUND_RATIO) {
    throw new Error(`Magenta matte transform found an unsafe connected background ratio in ${path}`);
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
  const discardedChroma = new Uint8Array(totalPixels);
  for (let index = 0; index < totalPixels; index += 1) {
    if (distance[index] < 1 || distance[index] > MAGENTA_DECONTAMINATION_PIXELS) continue;
    const targetOffset = index * info.channels;
    if (!isMagentaContaminatedPixel(data, targetOffset)) continue;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    let sourceIndex = -1;
    for (let radius = 1;
      radius <= MAGENTA_DECONTAMINATION_SEARCH_PIXELS && sourceIndex < 0;
      radius += 1) {
      for (let deltaY = -radius; deltaY <= radius && sourceIndex < 0; deltaY += 1) {
        const deltaX = radius - Math.abs(deltaY);
        const candidates = deltaX === 0
          ? [[x, y + deltaY]]
          : [[x - deltaX, y + deltaY], [x + deltaX, y + deltaY]];
        for (const [candidateX, candidateY] of candidates) {
          if (candidateX < 0 || candidateX >= info.width
            || candidateY < 0 || candidateY >= info.height) continue;
          const candidate = (candidateY * info.width) + candidateX;
          const candidateOffset = candidate * info.channels;
          if (background[candidate] === 0
            && distance[candidate] > distance[index]
            && !isMagentaContaminatedPixel(data, candidateOffset)) {
            sourceIndex = candidate;
            break;
          }
        }
      }
    }
    if (sourceIndex < 0) {
      discardedChroma[index] = 1;
      continue;
    }
    const sourceOffset = sourceIndex * info.channels;
    cleaned[targetOffset] = data[sourceOffset];
    cleaned[targetOffset + 1] = data[sourceOffset + 1];
    cleaned[targetOffset + 2] = data[sourceOffset + 2];
  }

  const rgba = Buffer.alloc(totalPixels * 4);
  let transparentPixels = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    const sourceOffset = index * info.channels;
    const targetOffset = index * 4;
    const transparent = background[index] === 1 || discardedChroma[index] === 1;
    rgba[targetOffset] = transparent ? 0 : cleaned[sourceOffset];
    rgba[targetOffset + 1] = transparent ? 0 : cleaned[sourceOffset + 1];
    rgba[targetOffset + 2] = transparent ? 0 : cleaned[sourceOffset + 2];
    const chromaContaminated = isMagentaContaminatedPixel(data, sourceOffset);
    const featherAlpha = chromaContaminated && distance[index] <= MAGENTA_ALPHA_FEATHER_PIXELS
      ? Math.round((255 * distance[index]) / (MAGENTA_ALPHA_FEATHER_PIXELS + 1))
      : 255;
    rgba[targetOffset + 3] = transparent ? 0 : featherAlpha;
    if (transparent) transparentPixels += 1;
  }
  const output = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toBuffer();
  await writeFileAtomically(path, output);
  return {
    applied: true,
    transform: 'magenta-matte-to-alpha',
    width: info.width,
    height: info.height,
    transparentPixels,
    transparentRatio: round(transparentPixels / totalPixels),
    edgeChromaRatio: round(edgeChromaRatio),
    colorDecontaminationPixels: MAGENTA_DECONTAMINATION_PIXELS,
    colorDecontaminationSearchPixels: MAGENTA_DECONTAMINATION_SEARCH_PIXELS,
    discardedChromaPixels: discardedChroma.reduce((total, value) => total + value, 0),
    alphaFeatherPixels: MAGENTA_ALPHA_FEATHER_PIXELS,
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
  const trimApplicable = asset.alpha !== 'forbidden' && assetKindSupports(asset.kind, 'trim');
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
  const isAtlasSprite = assetKindSupports(asset.kind, 'atlas');

  const output = isAtlasSprite
    ? await input
      .ensureAlpha()
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(asset.targetSize.width, asset.targetSize.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png({ compressionLevel: 9 })
      .toBuffer()
    : await input
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .resize(asset.targetSize.width, asset.targetSize.height, {
        fit: 'cover',
        position: 'centre',
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  await writeFileAtomically(outputPath, output);

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
  const sprites = normalizedAssets.filter(({ kind }) => assetKindSupports(kind, 'atlas'));
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
  const atlasImage = await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  await writeFileAtomically(imagePath, atlasImage);
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
  await writeFileAtomically(dataPath, `${JSON.stringify(data, null, 2)}\n`);

  return {
    imagePath,
    dataPath,
    imageSha256: await sha256File(imagePath),
    dataSha256: await sha256File(dataPath),
    data,
  };
}
