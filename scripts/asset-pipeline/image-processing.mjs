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

  const interiorChromaReplaced = new Uint8Array(totalPixels);
  for (let index = 0; index < totalPixels; index += 1) {
    if (background[index] === 1 || distance[index] <= MAGENTA_DECONTAMINATION_PIXELS) continue;
    const targetOffset = index * info.channels;
    if (!isMagentaMattePixel(data, targetOffset)) continue;
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
            && !isMagentaContaminatedPixel(data, candidateOffset)) {
            sourceIndex = candidate;
            break;
          }
        }
      }
    }
    if (sourceIndex < 0) {
      throw new Error(`Magenta matte transform cannot restore isolated interior chroma in ${path}`);
    }
    const sourceOffset = sourceIndex * info.channels;
    cleaned[targetOffset] = data[sourceOffset];
    cleaned[targetOffset + 1] = data[sourceOffset + 1];
    cleaned[targetOffset + 2] = data[sourceOffset + 2];
    interiorChromaReplaced[index] = 1;
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
    interiorChromaReplacedPixels: interiorChromaReplaced.reduce(
      (total, value) => total + value,
      0,
    ),
    alphaFeatherPixels: MAGENTA_ALPHA_FEATHER_PIXELS,
  };
}

function findForegroundComponents(data, width, height, channels) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const components = [];
  for (let seed = 0; seed < totalPixels; seed += 1) {
    if (visited[seed] === 1 || data[(seed * channels) + 3] <= VISIBLE_ALPHA) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;
    visited[seed] = 1;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    let sumX = 0;
    let sumY = 0;
    const members = [];
    while (head < tail) {
      const index = queue[head];
      head += 1;
      members.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      sumX += x;
      sumY += y;
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        const neighborY = y + deltaY;
        if (neighborY < 0 || neighborY >= height) continue;
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const neighborX = x + deltaX;
          if (neighborX < 0 || neighborX >= width) continue;
          const neighbor = (neighborY * width) + neighborX;
          if (visited[neighbor] === 1
            || data[(neighbor * channels) + 3] <= VISIBLE_ALPHA) continue;
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }
    components.push({
      pixels: members.length,
      members,
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1,
      centerX: sumX / members.length,
      centerY: sumY / members.length,
    });
  }
  return components;
}

function componentBuffer(component, data, sourceWidth, channels) {
  const output = Buffer.alloc(component.width * component.height * 4);
  for (const index of component.members) {
    const sourceOffset = index * channels;
    const x = (index % sourceWidth) - component.left;
    const y = Math.floor(index / sourceWidth) - component.top;
    const targetOffset = ((y * component.width) + x) * 4;
    output[targetOffset] = data[sourceOffset];
    output[targetOffset + 1] = data[sourceOffset + 1];
    output[targetOffset + 2] = data[sourceOffset + 2];
    output[targetOffset + 3] = data[sourceOffset + 3];
  }
  return output;
}

export async function regridFrameSheet(path, asset, options = {}) {
  const frameLayout = resolveFrameLayout(asset);
  if (!Number.isInteger(asset.frames) || asset.frames <= 1) {
    throw new Error(`Cannot regrid ${asset.id}: frames must be greater than one`);
  }
  const input = await readFile(path);
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width % frameLayout.columns !== 0 || info.height % frameLayout.rows !== 0) {
    throw new Error(`Cannot regrid ${asset.id}: source does not match frameLayout grid`);
  }
  const frameWidth = info.width / frameLayout.columns;
  const frameHeight = info.height / frameLayout.rows;
  const minimumComponentPixels = Math.max(
    4,
    Math.floor((frameWidth * frameHeight) / 4_000),
  );
  const detected = findForegroundComponents(data, info.width, info.height, info.channels)
    .filter(({ pixels }) => pixels >= minimumComponentPixels)
    .sort((left, right) => right.pixels - left.pixels);
  if (detected.length < asset.frames) {
    throw new Error(`Cannot regrid ${asset.id}: detected ${detected.length}/${asset.frames} frame silhouettes`);
  }
  const selected = detected.slice(0, asset.frames);
  const largestPixels = selected[0].pixels;
  const smallestPixels = selected.at(-1).pixels;
  if (smallestPixels < largestPixels * 0.08) {
    throw new Error(`Cannot regrid ${asset.id}: frame silhouette sizes are ambiguous`);
  }
  const largestDiscardedPixels = detected[asset.frames]?.pixels ?? 0;
  if (largestDiscardedPixels >= smallestPixels * 0.5) {
    throw new Error(`Cannot regrid ${asset.id}: extra frame silhouettes are ambiguous`);
  }
  if (selected.some(({ width, height }) => (
    width > frameWidth * 1.5 || height > frameHeight * 1.5
  ))) {
    throw new Error(`Cannot regrid ${asset.id}: a frame silhouette exceeds the recoverable cell size`);
  }
  const rowMajor = [...selected]
    .sort((left, right) => left.centerY - right.centerY)
    .reduce((ordered, _component, index, sorted) => {
      if (index % frameLayout.columns !== 0) return ordered;
      return ordered.concat(
        sorted.slice(index, index + frameLayout.columns)
          .sort((left, right) => left.centerX - right.centerX),
      );
    }, []);
  const padding = options.padding ?? Math.max(2, Math.ceil(Math.min(frameWidth, frameHeight) * 0.04));
  if (!Number.isInteger(padding) || padding < 0
    || padding * 2 >= frameWidth || padding * 2 >= frameHeight) {
    throw new Error(`Cannot regrid ${asset.id}: padding is invalid`);
  }
  const maximumWidth = Math.max(...rowMajor.map(({ width }) => width));
  const maximumHeight = Math.max(...rowMajor.map(({ height }) => height));
  const sharedScale = Math.min(
    1,
    (frameWidth - (padding * 2)) / maximumWidth,
    (frameHeight - (padding * 2)) / maximumHeight,
  );
  const composites = [];
  for (const [index, component] of rowMajor.entries()) {
    const width = Math.max(1, Math.round(component.width * sharedScale));
    const height = Math.max(1, Math.round(component.height * sharedScale));
    const source = componentBuffer(component, data, info.width, info.channels);
    const image = await sharp(source, {
      raw: { width: component.width, height: component.height, channels: 4 },
    }).resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const column = index % frameLayout.columns;
    const row = Math.floor(index / frameLayout.columns);
    composites.push({
      input: image,
      left: (column * frameWidth) + Math.floor((frameWidth - width) / 2),
      top: (row * frameHeight) + frameHeight - padding - height,
    });
  }
  const output = await sharp({
    create: {
      width: info.width,
      height: info.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  await writeFileAtomically(path, output);
  return {
    applied: true,
    transform: 'frame-component-regrid',
    detectedComponents: detected.length,
    selectedComponents: selected.length,
    discardedComponents: detected.length - selected.length,
    selectedPixelRange: {
      smallest: smallestPixels,
      largest: largestPixels,
    },
    largestDiscardedPixels,
    padding,
    sharedScale: round(sharedScale),
    layout: {
      columns: frameLayout.columns,
      rows: frameLayout.rows,
      order: frameLayout.order,
    },
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

function detectFrames(asset, image, data) {
  const expected = asset.frames;
  const columns = asset.frameLayout?.columns ?? expected;
  const rows = asset.frameLayout?.rows ?? 1;
  const gridFits = columns * rows === expected
    && image.width % columns === 0
    && image.height % rows === 0;
  if (!gridFits) return { detected: 0, passed: false, empty: [], pixels: [] };
  const frameWidth = image.width / columns;
  const frameHeight = image.height / rows;
  const empty = [];
  const framePixels = [];
  for (let index = 0; index < expected; index += 1) {
    const frameLeft = (index % columns) * frameWidth;
    const frameTop = Math.floor(index / columns) * frameHeight;
    let left = frameWidth;
    let top = frameHeight;
    let right = -1;
    let bottom = -1;
    let visiblePixels = 0;
    let transparentPixels = 0;
    let opaqueEdgePixels = 0;
    const edgePixels = frameWidth === 1 || frameHeight === 1
      ? frameWidth * frameHeight
      : (frameWidth * 2) + ((frameHeight - 2) * 2);
    for (let y = frameTop; y < frameTop + frameHeight; y += 1) {
      for (let x = frameLeft; x < frameLeft + frameWidth; x += 1) {
        const alpha = data[((y * image.width) + x) * image.channels + 3];
        if (alpha < 255) transparentPixels += 1;
        if (alpha <= VISIBLE_ALPHA) continue;
        visiblePixels += 1;
        const localX = x - frameLeft;
        const localY = y - frameTop;
        left = Math.min(left, localX);
        top = Math.min(top, localY);
        right = Math.max(right, localX);
        bottom = Math.max(bottom, localY);
        if (localX === 0 || localX === frameWidth - 1
          || localY === 0 || localY === frameHeight - 1) {
          opaqueEdgePixels += 1;
        }
      }
    }
    if (visiblePixels === 0) empty.push(index);
    const bbox = visiblePixels === 0
      ? { left: 0, top: 0, width: 0, height: 0 }
      : { left, top, width: right - left + 1, height: bottom - top + 1 };
    framePixels.push({
      bbox,
      visiblePixels,
      transparentPixels,
      opaqueEdgeRatio: edgePixels === 0 ? 0 : opaqueEdgePixels / edgePixels,
      totalPixels: frameWidth * frameHeight,
    });
  }
  return {
    detected: expected - empty.length,
    passed: empty.length === 0,
    empty,
    pixels: framePixels,
  };
}

export async function inspectCandidate(path, asset) {
  const input = await readFile(path);
  const image = sharp(input, { failOn: 'error' }).rotate().ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const metadata = await sharp(input, { failOn: 'error' }).metadata();
  const pixels = locateVisiblePixels(data, info.width, info.height, info.channels);
  const totalPixels = info.width * info.height;
  const overallBboxCoverage = pixels.bbox.width * pixels.bbox.height / totalPixels;
  const hasTransparency = pixels.transparentPixels > 0;
  const alphaPassed = asset.alpha === 'required'
    ? metadata.hasAlpha === true && hasTransparency && pixels.visiblePixels > 0
    : asset.alpha === 'forbidden'
      ? !hasTransparency
      : pixels.visiblePixels > 0;
  const sizePassed = info.width >= asset.qa.minSourceSize.width
    && info.height >= asset.qa.minSourceSize.height;
  const frame = detectFrames(asset, info, data);
  const qaPixels = asset.frames > 1 && frame.pixels.length === asset.frames
    ? frame.pixels
    : [{ ...pixels, totalPixels }];
  const frameBboxes = qaPixels.map((framePixel, index) => ({
    index,
    ...framePixel.bbox,
    coverage: round(
      (framePixel.bbox.width * framePixel.bbox.height) / framePixel.totalPixels,
    ),
  }));
  const frameEdges = qaPixels.map((framePixel, index) => ({
    index,
    opaqueRatio: round(framePixel.opaqueEdgeRatio),
  }));
  const trimApplicable = asset.alpha !== 'forbidden' && assetKindSupports(asset.kind, 'trim');
  const trimPassed = !trimApplicable
    || frameBboxes.every(({ coverage }, index) => (
      qaPixels[index].visiblePixels > 0
      && coverage < 1
      && qaPixels[index].opaqueEdgeRatio === 0
    ));
  const bboxPassed = frameBboxes.every(({ coverage }, index) => (
    qaPixels[index].visiblePixels > 0
    && coverage >= asset.qa.minBboxCoverage
    && coverage <= asset.qa.maxBboxCoverage
  ));
  const edgesPassed = frameEdges.every(
    ({ opaqueRatio }) => opaqueRatio <= asset.qa.maxOpaqueEdgeRatio,
  );
  const removablePixelRatio = frameBboxes.reduce(
    (total, { coverage }) => total + (1 - coverage),
    0,
  ) / frameBboxes.length;
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
      removablePixelRatio: round(removablePixelRatio),
      ...(asset.frames > 1 ? {
        frames: frameBboxes.map(({ index, coverage }) => ({
          index,
          removablePixelRatio: round(1 - coverage),
        })),
      } : {}),
    },
    frame: {
      passed: frame.passed,
      expected: asset.frames,
      detected: frame.detected,
      empty: frame.empty,
    },
    bbox: {
      passed: bboxPassed,
      ...pixels.bbox,
      coverage: round(overallBboxCoverage),
      minimumCoverage: asset.qa.minBboxCoverage,
      maximumCoverage: asset.qa.maxBboxCoverage,
      ...(asset.frames > 1 ? { frames: frameBboxes } : {}),
    },
    edges: {
      passed: edgesPassed,
      opaqueRatio: round(pixels.opaqueEdgeRatio),
      maximumOpaqueRatio: asset.qa.maxOpaqueEdgeRatio,
      ...(asset.frames > 1 ? { frames: frameEdges } : {}),
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

function resolveFrameLayout(asset) {
  const frames = asset.frames ?? 1;
  return asset.frameLayout ?? {
    columns: frames,
    rows: 1,
    order: 'row-major',
    anchor: 'bottom-center',
    trim: 'shared-scale',
  };
}

function shouldPreserveAlpha(asset) {
  if (asset.alpha === 'forbidden') return false;
  if (asset.alpha === 'required' || asset.alpha === 'optional') return true;
  return assetKindSupports(asset.kind, 'atlas');
}

async function normalizeFrameGrid(sourcePath, asset, frameLayout) {
  const rotated = await sharp(sourcePath, { failOn: 'error' })
    .rotate()
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  if (rotated.info.width % frameLayout.columns !== 0
    || rotated.info.height % frameLayout.rows !== 0) {
    throw new Error(`Cannot normalize ${asset.id}: source does not match frameLayout grid`);
  }
  const sourceFrameWidth = rotated.info.width / frameLayout.columns;
  const sourceFrameHeight = rotated.info.height / frameLayout.rows;
  const frames = [];
  for (let index = 0; index < asset.frames; index += 1) {
    const column = index % frameLayout.columns;
    const row = Math.floor(index / frameLayout.columns);
    const input = await sharp(rotated.data, { failOn: 'error' })
      .extract({
        left: column * sourceFrameWidth,
        top: row * sourceFrameHeight,
        width: sourceFrameWidth,
        height: sourceFrameHeight,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const raw = await sharp(input, { failOn: 'error' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = locateVisiblePixels(
      raw.data,
      raw.info.width,
      raw.info.height,
      raw.info.channels,
    );
    if (pixels.visiblePixels === 0) {
      throw new Error(`Cannot normalize ${asset.id}: frame ${index} has no visible pixels`);
    }
    frames.push({ input, bbox: pixels.bbox });
  }

  const maximumWidth = Math.max(...frames.map(({ bbox }) => bbox.width));
  const maximumHeight = Math.max(...frames.map(({ bbox }) => bbox.height));
  const sharedScale = Math.min(
    asset.targetSize.width / maximumWidth,
    asset.targetSize.height / maximumHeight,
  );
  const normalizedFrames = [];
  for (const frame of frames) {
    const width = Math.max(1, Math.round(frame.bbox.width * sharedScale));
    const height = Math.max(1, Math.round(frame.bbox.height * sharedScale));
    const content = await sharp(frame.input, { failOn: 'error' })
      .extract(frame.bbox)
      .resize(width, height, { fit: 'fill' })
      .ensureAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer();
    normalizedFrames.push(await sharp({
      create: {
        width: asset.targetSize.width,
        height: asset.targetSize.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: content,
      left: Math.floor((asset.targetSize.width - width) / 2),
      top: asset.targetSize.height - height,
    }]).png({ compressionLevel: 9 }).toBuffer());
  }

  const sheetWidth = asset.targetSize.width * frameLayout.columns;
  const sheetHeight = asset.targetSize.height * frameLayout.rows;
  let sheet = sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(normalizedFrames.map((input, index) => ({
    input,
    left: (index % frameLayout.columns) * asset.targetSize.width,
    top: Math.floor(index / frameLayout.columns) * asset.targetSize.height,
  })));
  if (!shouldPreserveAlpha(asset)) {
    sheet = sheet.flatten({ background: { r: 0, g: 0, b: 0 } });
  }
  return sheet.png({ compressionLevel: 9 }).toBuffer();
}

async function inspectNormalizedOutput(path, asset, frameLayout) {
  const input = await readFile(path);
  const metadata = await sharp(input, { failOn: 'error' }).metadata();
  const raw = await sharp(input, { failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = locateVisiblePixels(raw.data, raw.info.width, raw.info.height, raw.info.channels);
  const expectedWidth = asset.targetSize.width * frameLayout.columns;
  const expectedHeight = asset.targetSize.height * frameLayout.rows;
  const hasTransparency = pixels.transparentPixels > 0;
  const alphaPassed = asset.alpha === 'required'
    ? metadata.hasAlpha === true && hasTransparency && pixels.visiblePixels > 0
    : asset.alpha === 'forbidden'
      ? !hasTransparency
      : pixels.visiblePixels > 0;
  const dimensionsPassed = raw.info.width === expectedWidth && raw.info.height === expectedHeight;
  return {
    schemaVersion: 1,
    assetId: asset.id,
    sha256: createHash('sha256').update(input).digest('hex'),
    passed: alphaPassed && dimensionsPassed,
    alpha: {
      passed: alphaPassed,
      policy: asset.alpha ?? 'inferred',
      hasAlpha: metadata.hasAlpha === true,
      transparentRatio: round(pixels.transparentPixels / (raw.info.width * raw.info.height)),
    },
    dimensions: {
      passed: dimensionsPassed,
      width: raw.info.width,
      height: raw.info.height,
      expectedWidth,
      expectedHeight,
    },
  };
}

export async function normalizeAsset(sourcePath, outputDirectory, asset) {
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${asset.id}.png`);
  const input = sharp(sourcePath, { failOn: 'error' }).rotate();
  const frames = asset.frames ?? 1;
  const frameLayout = resolveFrameLayout(asset);
  let output;
  if (frames > 1) {
    output = await normalizeFrameGrid(sourcePath, { ...asset, frames }, frameLayout);
  } else if (shouldPreserveAlpha(asset)) {
    let pipeline = input.ensureAlpha();
    if (assetKindSupports(asset.kind, 'trim')) {
      pipeline = pipeline.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }
    output = await pipeline
      .resize(asset.targetSize.width, asset.targetSize.height, {
        fit: assetKindSupports(asset.kind, 'trim') ? 'contain' : 'fill',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } else {
    output = await input
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .resize(asset.targetSize.width, asset.targetSize.height, {
        fit: 'cover',
        position: 'centre',
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  await writeFileAtomically(outputPath, output);

  const metadata = await sharp(outputPath, { failOn: 'error' }).metadata();
  const technicalQa = await inspectNormalizedOutput(outputPath, asset, frameLayout);
  if (!technicalQa.passed) {
    const reason = asset.alpha === 'required' && !technicalQa.alpha.passed
      ? 'required alpha policy'
      : 'normalized dimensions';
    throw new Error(`Normalized output for ${asset.id} failed ${reason}`);
  }
  return {
    assetId: asset.id,
    kind: asset.kind,
    frames,
    frameLayout,
    frameSize: { ...asset.targetSize },
    path: outputPath,
    file: basename(outputPath),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    sha256: await sha256File(outputPath),
    technicalQa,
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
  const extrusion = options.extrusion ?? 0;
  const maxSize = options.maxSize ?? 4096;
  if (!Number.isInteger(padding) || padding < 0) {
    throw new Error('Atlas padding must be a non-negative integer');
  }
  if (!Number.isInteger(extrusion) || extrusion < 0 || extrusion * 2 > padding) {
    throw new Error('Atlas extrusion on both frame edges must not exceed padding');
  }
  if (!Number.isInteger(maxSize) || maxSize < 1 || (maxSize & (maxSize - 1)) !== 0) {
    throw new Error('Atlas maxSize must be a positive power-of-two integer');
  }
  const entries = [];
  for (const sprite of sprites) {
    const count = sprite.frames ?? 1;
    if (count === 1) {
      entries.push({
        key: sprite.assetId,
        input: sprite.path,
        width: sprite.width,
        height: sprite.height,
      });
      continue;
    }
    const frameLayout = resolveFrameLayout(sprite);
    const frameWidth = sprite.frameSize?.width ?? sprite.width / frameLayout.columns;
    const frameHeight = sprite.frameSize?.height ?? sprite.height / frameLayout.rows;
    const digits = Math.max(2, String(count - 1).length);
    for (let index = 0; index < count; index += 1) {
      const input = await sharp(sprite.path, { failOn: 'error' })
        .extract({
          left: (index % frameLayout.columns) * frameWidth,
          top: Math.floor(index / frameLayout.columns) * frameHeight,
          width: frameWidth,
          height: frameHeight,
        })
        .png({ compressionLevel: 9 })
        .toBuffer();
      entries.push({
        key: `${sprite.assetId}_${String(index).padStart(digits, '0')}`,
        input,
        width: frameWidth,
        height: frameHeight,
      });
    }
  }
  const frameKeys = new Set();
  for (const entry of entries) {
    if (frameKeys.has(entry.key)) throw new Error(`Atlas has duplicate frame key ${entry.key}`);
    if (entry.width + (padding * 2) > maxSize || entry.height + (padding * 2) > maxSize) {
      throw new Error(`Atlas frame ${entry.key} exceeds maxSize ${maxSize}`);
    }
    frameKeys.add(entry.key);
  }
  let x = padding;
  let y = padding;
  let rowHeight = 0;
  let contentRight = padding;
  let contentBottom = padding;
  for (const entry of entries) {
    if (x !== padding && x + entry.width + padding > maxSize) {
      x = padding;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    if (y + entry.height + padding > maxSize) {
      throw new Error(`Atlas entries exceed maxSize ${maxSize}`);
    }
    entry.x = x;
    entry.y = y;
    contentRight = Math.max(contentRight, x + entry.width + padding);
    contentBottom = Math.max(contentBottom, y + entry.height + padding);
    rowHeight = Math.max(rowHeight, entry.height);
    x += entry.width + padding;
  }
  const atlasWidth = nextPowerOfTwo(contentRight);
  const atlasHeight = nextPowerOfTwo(contentBottom);
  const frames = {};
  const composites = [];
  for (const entry of entries) {
    const frame = { x: entry.x, y: entry.y, w: entry.width, h: entry.height };
    frames[entry.key] = {
      frame,
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: entry.width, h: entry.height },
      sourceSize: { w: entry.width, h: entry.height },
    };
    const input = extrusion === 0
      ? entry.input
      : await sharp(entry.input, { failOn: 'error' }).extend({
        top: extrusion,
        bottom: extrusion,
        left: extrusion,
        right: extrusion,
        extendWith: 'copy',
      }).png({ compressionLevel: 9 }).toBuffer();
    composites.push({
      input,
      left: entry.x - extrusion,
      top: entry.y - extrusion,
    });
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
