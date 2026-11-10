'use client';

import { adjustPhotoPixelBlock, orientedPhotoSize, photoCropPixels, photoRecipeUnchanged, validatePhotoRecipe, type PhotoRecipe, type PhotoSize } from './photo-editor';
import { loadPhotoSource, PHOTO_EDIT_MAX_BYTES } from './photo-editor-source';
import { mosaicPhotoPixels, validatePhotoLayers, type PhotoText } from './photo-editor-layers';
import { applyPhotoEffects } from './photo-editor-effects';
import { applyPhotoAutoLevelBlock, calculatePhotoAutoLevels, type PhotoAutoLevels } from './photo-editor-auto-levels';
import { drawPhotoPresentation } from './photo-editor-presentation';
import { applyPhotoFilterBlock } from './photo-editor-filters';
import { estimatePhotoStraighten, photoStraightenScale, PHOTO_STRAIGHTEN_SAMPLE_SIDE, type PhotoStraightenEstimate } from './photo-editor-straighten';
import { decodePhotoLogo, drawPhotoLogo, validatePhotoLogo, type PhotoLogoDescriptor } from './photo-editor-logo';
import { drawPhotoSticker, drawPhotoText } from './photo-editor-decoration-canvas';

export type PhotoPreview = { blob: Blob; width: number; height: number };
export type PhotoEditSession = {
  readonly size: PhotoSize;
  preview: (recipe: PhotoRecipe, signal: AbortSignal) => Promise<PhotoPreview>;
  render: (recipe: PhotoRecipe, signal: AbortSignal) => Promise<File | null>;
  estimateStraighten: (signal: AbortSignal) => Promise<PhotoStraightenEstimate>;
  replaceLogo: (file: File, signal: AbortSignal) => Promise<PhotoLogoDescriptor>;
  clearLogo: () => void;
  dispose: () => void;
};

function abortError() { return new DOMException('사진 편집을 취소했습니다.', 'AbortError'); }
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw abortError(); }
const yieldRender = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Require the site's actual font faces, including its Korean subsets. Never encode a silent fallback. */
async function loadTextFont(texts: readonly PhotoText[], signal: AbortSignal): Promise<void> {
  const sample = texts.map(layer => layer.text.trim()).filter(Boolean).join('');
  if (!sample) return;
  if (!document.fonts?.load) throw new Error('텍스트 글꼴을 사용할 수 없습니다. 텍스트를 삭제하거나 다시 열어주세요.');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error('텍스트 글꼴을 불러오는 시간이 초과되었습니다. 네트워크를 확인하거나 텍스트를 삭제해주세요.')), 8000);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    void Promise.resolve().then(() => { checkAbort(signal); return document.fonts.load('400 16px "Pretendard"', sample); }).then(faces => {
      if (signal.aborted) { onAbort(); return; }
      if (!Array.isArray(faces) || !faces.length || faces.some(face => face.status !== 'loaded')) finish(new Error('텍스트 글꼴을 불러오지 못했습니다. 네트워크를 확인하거나 텍스트를 삭제해주세요.'));
      else finish();
    }).catch(() => finish(signal.aborted ? abortError() : new Error('텍스트 글꼴을 불러오지 못했습니다. 네트워크를 확인하거나 텍스트를 삭제해주세요.')));
  });
}

/** The browser may finish encoding after cancellation. Its late Blob never leaves this promise. */
function encodeCanvas(canvas: HTMLCanvasElement, mime: 'image/png' | 'image/jpeg', signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      canvas.toBlob(blob => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) { reject(abortError()); return; }
        if (!blob || blob.type !== mime) { reject(new Error('편집 이미지를 만들지 못했습니다. 원래 사진은 유지됩니다.')); return; }
        resolve(blob);
      }, mime, mime === 'image/jpeg' ? 0.92 : undefined);
    } catch {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('이 사진을 편집 파일로 만들 수 없습니다. 원래 사진은 유지됩니다.'));
    }
  });
}

function joinSignals(left: AbortSignal, right: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  left.addEventListener('abort', abort, { once: true }); right.addEventListener('abort', abort, { once: true });
  if (left.aborted || right.aborted) abort();
  return { signal: controller.signal, release: () => { left.removeEventListener('abort', abort); right.removeEventListener('abort', abort); } };
}

/** One decoded source, one render at a time. No upload or product mutation is possible here. */
export async function createPhotoEditSession(sourcePath: string, signal: AbortSignal): Promise<PhotoEditSession> {
  const { blob, metadata } = await loadPhotoSource(sourcePath, signal);
  checkAbort(signal);
  if (typeof createImageBitmap !== 'function') throw new Error('이 브라우저에서는 사진 편집을 사용할 수 없습니다. 최신 브라우저에서 다시 열어주세요.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch { checkAbort(signal); throw new Error('이미지를 해석하지 못했습니다. 원래 사진은 유지됩니다.'); }
  if (signal.aborted) { bitmap.close(); throw abortError(); }
  const swaps = (metadata.orientation ?? 1) >= 5;
  const expected = swaps ? { width: metadata.height, height: metadata.width } : metadata;
  if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
    bitmap.close(); throw new Error('사진의 방향 또는 크기를 확인하지 못했습니다. 원래 사진은 유지됩니다.');
  }
  const size = { width: bitmap.width, height: bitmap.height };
  const lifetime = new AbortController();
  let disposed = false, queue: Promise<unknown> = Promise.resolve();
  let sourceLevels: PhotoAutoLevels | null = null;
  let sourceStraighten: PhotoStraightenEstimate | null = null;
  let logo: Awaited<ReturnType<typeof decodePhotoLogo>> | null = null;
  let logoGeneration = 0, logoLoading = false;
  const logoBitmaps = new Set<ImageBitmap>();
  const closeLogo = (image: ImageBitmap) => { if (logoBitmaps.delete(image)) image.close(); };
  const canvases = new Set<HTMLCanvasElement>();
  function dispose() {
    if (disposed) return;
    disposed = true; lifetime.abort(); bitmap.close(); sourceLevels = null; sourceStraighten = null;
    logoGeneration++; logo = null;
    for (const image of logoBitmaps) closeLogo(image);
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
    canvases.clear();
  }
  const onSourceAbort = () => dispose();
  signal.addEventListener('abort', onSourceAbort, { once: true });
  function shutdown() { signal.removeEventListener('abort', onSourceAbort); dispose(); }

  async function draw(recipe: PhotoRecipe, preview: boolean, requestedSignal: AbortSignal): Promise<PhotoPreview> {
    validatePhotoRecipe(recipe);
    validatePhotoLayers(recipe, size);
    const joined = joinSignals(requestedSignal, lifetime.signal), active = joined.signal;
    const allocated: HTMLCanvasElement[] = [];
    const allocate = (width: number, height: number) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvases.add(canvas); allocated.push(canvas); return canvas;
    };
    try {
      checkAbort(active);
      const drawnLogo = logo;
      if (recipe.logo) {
        if (!drawnLogo) throw new Error('로고를 다시 선택해주세요.');
        validatePhotoLogo(recipe.logo, size, drawnLogo.descriptor);
      }
      await loadTextFont(recipe.texts, active);
      checkAbort(active);
      const crop = photoCropPixels(size, recipe), oriented = orientedPhotoSize(size, recipe);
      // Composite at source resolution so crop, rotation and preview cannot change mosaic averages,
      // block phase, text size or clipped tone values. Geometry transforms the whole composition.
      let canvas = allocate(size.width, size.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('이 브라우저에서는 사진 미리보기를 만들 수 없습니다.');
      context.drawImage(bitmap, 0, 0);
      if (recipe.automaticLevels || recipe.filter !== 'none' && recipe.filterStrength > 0 || recipe.brightness || recipe.contrast || recipe.saturation || recipe.temperature || recipe.sharpness || recipe.circularBlur || recipe.linearBlur || recipe.vignette || recipe.mosaics.length) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        let lastYield = performance.now();
        if (recipe.automaticLevels && !sourceLevels) {
          const calculation = calculatePhotoAutoLevels(pixels.data);
          let step = calculation.next();
          while (!step.done) {
            checkAbort(active);
            if (performance.now() - lastYield >= 8) { await yieldRender(); lastYield = performance.now(); }
            step = calculation.next();
          }
          checkAbort(active); sourceLevels = step.value;
        }
        // A bounded block keeps cancellation and controls responsive at the 4MP input limit.
        for (let start = 0; start < pixels.data.length; start += 262144) {
          checkAbort(active);
          if (recipe.automaticLevels && sourceLevels) applyPhotoAutoLevelBlock(pixels.data, sourceLevels, start, Math.min(start + 262144, pixels.data.length));
          applyPhotoFilterBlock(pixels.data, recipe.filter, start, Math.min(start + 262144, pixels.data.length), recipe.filterStrength);
          adjustPhotoPixelBlock(pixels.data, recipe, start, Math.min(start + 262144, pixels.data.length));
          if (performance.now() - lastYield >= 8) { await yieldRender(); lastYield = performance.now(); }
        }
        for (const _ of applyPhotoEffects(pixels.data, size, recipe)) {
          void _; checkAbort(active);
          if (performance.now() - lastYield >= 8) { await yieldRender(); lastYield = performance.now(); }
        }
        for (const _ of mosaicPhotoPixels(pixels.data, size, recipe.mosaics)) {
          void _; checkAbort(active);
          if (performance.now() - lastYield >= 8) { await yieldRender(); lastYield = performance.now(); }
        }
        checkAbort(active); context.putImageData(pixels, 0, 0);
      }
      checkAbort(active);
      if (recipe.logo && drawnLogo) drawPhotoLogo(context, drawnLogo.bitmap, recipe.logo);
      let decorationYield = performance.now();
      for (const sticker of recipe.stickers ?? []) {
        checkAbort(active); drawPhotoSticker(context, sticker);
        if (performance.now() - decorationYield >= 8) { await yieldRender(); decorationYield = performance.now(); }
      }
      for (const layer of recipe.texts) {
        checkAbort(active); drawPhotoText(context, layer);
        if (performance.now() - decorationYield >= 8) { await yieldRender(); decorationYield = performance.now(); }
      }
      checkAbort(active);
      if (recipe.turns || recipe.flipX || recipe.flipY || recipe.straightenDegrees || crop.x || crop.y || crop.width !== size.width || crop.height !== size.height) {
        const source = canvas;
        canvas = allocate(crop.width, crop.height);
        const transformed = canvas.getContext('2d');
        if (!transformed) throw new Error('사진의 방향과 자르기 결과를 만들지 못했습니다.');
        transformed.translate(-crop.x, -crop.y); transformed.translate(oriented.width / 2, oriented.height / 2);
        if (recipe.straightenDegrees) {
          const zoom = photoStraightenScale(oriented, recipe.straightenDegrees);
          transformed.rotate(recipe.straightenDegrees * Math.PI / 180); transformed.scale(zoom, zoom);
        }
        transformed.scale(recipe.flipX ? -1 : 1, recipe.flipY ? -1 : 1); transformed.rotate(recipe.turns * Math.PI / 2);
        transformed.drawImage(source, -size.width / 2, -size.height / 2);
        source.width = 0; source.height = 0;
      }
      if (recipe.frameWidth || recipe.mask !== 'none') {
        checkAbort(active);
        const presentation = canvas.getContext('2d');
        if (!presentation) throw new Error('사진 테두리·도형 결과를 만들지 못했습니다.');
        drawPhotoPresentation(presentation, crop, recipe);
      }
      if (preview && Math.max(crop.width, crop.height) > 1280) {
        checkAbort(active); await yieldRender(); checkAbort(active);
        const scale = 1280 / Math.max(crop.width, crop.height), source = canvas;
        canvas = allocate(Math.max(1, Math.round(crop.width * scale)), Math.max(1, Math.round(crop.height * scale)));
        const reduced = canvas.getContext('2d');
        if (!reduced) throw new Error('사진 미리보기를 줄이지 못했습니다.');
        reduced.drawImage(source, 0, 0, canvas.width, canvas.height);
        source.width = 0; source.height = 0;
      }
      checkAbort(active);
      const mime = !preview && metadata.mimeType === 'image/jpeg' && recipe.mask === 'none' ? 'image/jpeg' : 'image/png';
      const result = await encodeCanvas(canvas, mime, active);
      checkAbort(active);
      if (!preview && (result.size < 1 || result.size > PHOTO_EDIT_MAX_BYTES)) {
        throw new Error('편집 결과가 5MB를 넘거나 비어 있습니다. 자를 범위를 줄여주세요. 원래 사진은 유지됩니다.');
      }
      return { blob: result, width: canvas.width, height: canvas.height };
    } catch (error) {
      if (active.aborted) throw abortError();
      if (error instanceof Error && error.name === 'SecurityError') throw new Error('이 사진은 브라우저에서 편집할 수 없습니다. 원본 파일을 다시 선택해주세요.');
      throw error;
    } finally {
      joined.release();
      for (const canvas of allocated) { canvas.width = 0; canvas.height = 0; canvases.delete(canvas); }
    }
  }
  function schedule<T>(action: () => Promise<T>, active: AbortSignal): Promise<T> {
    const job = queue.catch(() => undefined).then(() => { if (disposed) throw abortError(); checkAbort(active); return action(); });
    queue = job.catch(() => undefined);
    return job;
  }
  async function estimateStraighten(requestedSignal: AbortSignal): Promise<PhotoStraightenEstimate> {
    const joined = joinSignals(requestedSignal, lifetime.signal), active = joined.signal;
    let canvas: HTMLCanvasElement | null = null;
    try {
      checkAbort(active);
      if (sourceStraighten) return { ...sourceStraighten };
      const scale = Math.min(1, PHOTO_STRAIGHTEN_SAMPLE_SIDE / Math.max(size.width, size.height));
      const sample = { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
      canvas = document.createElement('canvas'); canvas.width = sample.width; canvas.height = sample.height; canvases.add(canvas);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('사진의 수평을 분석하지 못했습니다. 각도를 직접 조절해주세요.');
      context.drawImage(bitmap, 0, 0, sample.width, sample.height);
      const calculation = estimatePhotoStraighten(context.getImageData(0, 0, sample.width, sample.height).data, sample);
      let step = calculation.next(), lastYield = performance.now();
      while (!step.done) {
        checkAbort(active);
        if (performance.now() - lastYield >= 8) { await yieldRender(); lastYield = performance.now(); }
        step = calculation.next();
      }
      checkAbort(active); sourceStraighten = step.value;
      return { ...sourceStraighten };
    } finally {
      joined.release();
      if (canvas) { canvas.width = 0; canvas.height = 0; canvases.delete(canvas); }
    }
  }
  function clearLogo() {
    logoGeneration++;
    const previous = logo; logo = null;
    // A running render holds its image until it leaves the shared queue.
    if (previous) queue = queue.catch(() => undefined).then(() => closeLogo(previous.bitmap));
  }
  async function replaceLogo(file: File, requestedSignal: AbortSignal): Promise<PhotoLogoDescriptor> {
    if (disposed) throw abortError();
    if (logoLoading) throw new Error('로고를 불러오는 중입니다. 완료 후 다시 선택해주세요.');
    logoLoading = true;
    const generation = ++logoGeneration, joined = joinSignals(requestedSignal, lifetime.signal);
    let candidate: Awaited<ReturnType<typeof decodePhotoLogo>> | null = null;
    try {
      candidate = await decodePhotoLogo(file, joined.signal);
      logoBitmaps.add(candidate.bitmap);
      const loaded = candidate;
      return await schedule(async () => {
        checkAbort(joined.signal);
        if (generation !== logoGeneration) throw abortError();
        const previous = logo; logo = loaded; candidate = null;
        if (previous) closeLogo(previous.bitmap);
        return loaded.descriptor;
      }, joined.signal);
    } finally {
      if (candidate) closeLogo(candidate.bitmap);
      joined.release(); logoLoading = false;
    }
  }
  function checkLogoIdle() {
    if (logoLoading) throw new Error('로고 불러오기가 끝난 뒤 편집 결과를 확인해주세요.');
  }
  return {
    size,
    preview: (recipe, active) => schedule(() => { checkLogoIdle(); return draw(recipe, true, active); }, active),
    render: (recipe, active) => schedule(async () => {
      checkLogoIdle();
      if (photoRecipeUnchanged(recipe)) return null;
      const { blob: result } = await draw(recipe, false, active);
      checkAbort(active);
      return new File([result], `edited-photo.${result.type === 'image/jpeg' ? 'jpg' : 'png'}`, { type: result.type });
    }, active),
    replaceLogo,
    estimateStraighten: active => schedule(() => estimateStraighten(active), active),
    clearLogo,
    dispose: shutdown,
  };
}
