import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAdminArtworkPreviewUrl } from './artwork-preview.client';

const state = vi.hoisted(() => ({
  bitmaps: [] as { width: number; height: number; close: ReturnType<typeof vi.fn> }[],
  canvases: [] as { width: number; height: number; drawImage: ReturnType<typeof vi.fn>; convertToBlob: ReturnType<typeof vi.fn> }[],
  decode: vi.fn(),
  urls: 0,
}));

beforeEach(() => {
  state.bitmaps = []; state.canvases = []; state.urls = 0;
  state.decode.mockReset();
  state.decode.mockImplementation(async () => {
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    state.bitmaps.push(bitmap);
    return bitmap;
  });
  vi.stubGlobal('createImageBitmap', (...args: unknown[]) => state.decode(...args));
  vi.stubGlobal('OffscreenCanvas', class {
    width: number; height: number; drawImage = vi.fn();
    convertToBlob = vi.fn(async ({ type }: { type: string }) => new Blob(['small'], { type }));
    constructor(width: number, height: number) {
      this.width = width; this.height = height;
      state.canvases.push(this as never);
    }
    getContext() { return { drawImage: this.drawImage, imageSmoothingQuality: 'low' }; }
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => `blob:${++state.urls}:${(blob as Blob).size}`);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('큰 사진은 긴 변 800px 사본으로 미리 보고 원본 디코딩을 바로 놓는다', async () => {
  const file = new File(['x'.repeat(1000)], 'big.jpg', { type: 'image/jpeg' });
  const url = await createAdminArtworkPreviewUrl(file);

  expect(state.decode).toHaveBeenCalledExactlyOnceWith(file, { imageOrientation: 'from-image' });
  expect(state.canvases[0]).toMatchObject({ width: 800, height: 600 });
  expect(state.canvases[0].convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.86 });
  expect(state.bitmaps[0].close).toHaveBeenCalledOnce();
  expect(url).toBe('blob:1:5');
});

it('투명도가 있을 수 있는 PNG·WebP는 WebP 사본으로 만든다', async () => {
  state.decode.mockResolvedValueOnce({ width: 1200, height: 2400, close: vi.fn() });
  await createAdminArtworkPreviewUrl(new File(['png'], 'a.png', { type: 'image/png' }));
  expect(state.canvases[0]).toMatchObject({ width: 400, height: 800 });
  expect(state.canvases[0].convertToBlob).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.86 });
});

it.each([
  ['작은 이미지', () => state.decode.mockResolvedValueOnce({ width: 600, height: 600, close: vi.fn() })],
  ['디코딩 실패', () => state.decode.mockRejectedValueOnce(new Error('broken'))],
  ['createImageBitmap 미지원', () => vi.stubGlobal('createImageBitmap', undefined)],
])('%s는 원본 object URL로 돌아간다', async (_label, arrange) => {
  arrange();
  const file = new File(['original'], 'a.png', { type: 'image/png' });
  await expect(createAdminArtworkPreviewUrl(file)).resolves.toBe(`blob:1:${file.size}`);
  expect(state.canvases).toHaveLength(0);
});

it('여러 장을 골라도 한 번에 한 장씩 디코딩한다', async () => {
  let active = 0, maxActive = 0;
  state.decode.mockImplementation(async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return { width: 4000, height: 4000, close: vi.fn() };
  });
  const files = Array.from({ length: 4 }, (_, index) => new File([`f${index}`], `f${index}.jpg`, { type: 'image/jpeg' }));
  const urls = await Promise.all(files.map(file => createAdminArtworkPreviewUrl(file)));
  expect(urls).toHaveLength(4);
  expect(maxActive).toBe(1);
});
