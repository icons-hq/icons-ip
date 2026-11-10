import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { decodePhotoLogo, drawPhotoLogo, fitPhotoLogo, photoLogoMaximum, positionPhotoLogo, validatePhotoLogo, type PhotoLogoDescriptor } from './photo-editor-logo';
import { initialPhotoRecipe, photoRecipeUnchanged } from './photo-editor';

const signal = () => new AbortController().signal;
const asset: PhotoLogoDescriptor = { assetId: 'asset', sha256: 'a'.repeat(64), mimeType: 'image/png', width: 100, height: 200, filename: 'logo.png' };
async function file(width = 100, height = 200, format: 'png' | 'jpeg' | 'webp' = 'png', orientation = 1) {
  let image = sharp({ create: { width, height, channels: 4, background: '#ff000080' } });
  if (orientation !== 1) image = image.withMetadata({ orientation });
  const bytes = await image[format]().toBuffer();
  return new File([new Uint8Array(bytes)], 'same-name', { type: `image/${format}` });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['png', 'jpeg', 'webp'] as const)('로컬 %s 헤더 검증, 실제 바이트 SHA, EXIF 크기와 새 선택 식별자를 반환한다', async format => {
  const input = await file(100, 200, format), close = vi.fn();
  const decode = vi.fn().mockResolvedValue({ width: 100, height: 200, close }); vi.stubGlobal('createImageBitmap', decode);
  const first = await decodePhotoLogo(input, signal()), second = await decodePhotoLogo(input, signal());
  expect(first.descriptor).toMatchObject({ width: 100, height: 200, mimeType: `image/${format}`, filename: 'same-name', sha256: createHash('sha256').update(new Uint8Array(await input.arrayBuffer())).digest('hex') });
  expect(first.descriptor.assetId).not.toBe(second.descriptor.assetId); expect(Object.isFrozen(first.descriptor)).toBe(true);
  expect(decode.mock.calls[0][0]).toBeInstanceOf(Blob); expect(decode.mock.calls[0][1]).toEqual({ imageOrientation: 'from-image' }); expect(close).not.toHaveBeenCalled();
});
it('빈 MIME은 실제 헤더로 판정하고 모순된 MIME은 decoder 전에 거절한다', async () => {
  const input = await file(), decode = vi.fn().mockResolvedValue({ width: 100, height: 200, close: vi.fn() }); vi.stubGlobal('createImageBitmap', decode);
  expect((await decodePhotoLogo(new File([input], 'no-type'), signal())).descriptor.mimeType).toBe('image/png');
  await expect(decodePhotoLogo(new File([input], 'wrong', { type: 'image/jpeg' }), signal())).rejects.toThrow('실제 파일'); expect(decode).toHaveBeenCalledOnce();
});
it.each([[1001, 1000], [2049, 1]])('로고 한도 %ix%i 초과는 decoder 이전에 막는다', async (width, height) => {
  const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  await expect(decodePhotoLogo(await file(width, height), signal())).rejects.toThrow('100만'); expect(decode).not.toHaveBeenCalled();
});
it('정확히 1MP와 2048px 경계는 허용하고 파일 크기·SVG·손상 파일은 거절한다', async () => {
  const decode = vi.fn().mockResolvedValueOnce({ width: 1000, height: 1000, close: vi.fn() }).mockResolvedValueOnce({ width: 2048, height: 1, close: vi.fn() }); vi.stubGlobal('createImageBitmap', decode);
  await decodePhotoLogo(await file(1000, 1000), signal()); await decodePhotoLogo(await file(2048, 1), signal());
  for (const bad of [new File([], 'empty'), new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large'), new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }), new File(['broken'], 'image.png', { type: 'image/png' })])
    await expect(decodePhotoLogo(bad, signal())).rejects.toThrow();
  expect(decode).toHaveBeenCalledTimes(2);
});
it('EXIF 6의 회전된 크기를 사용하고 decoder 모순·취소 후 늦은 bitmap은 닫는다', async () => {
  const input = await file(100, 200, 'jpeg', 6), close = vi.fn(), decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  decode.mockResolvedValueOnce({ width: 200, height: 100, close }); expect((await decodePhotoLogo(input, signal())).descriptor).toMatchObject({ width: 200, height: 100 });
  decode.mockResolvedValueOnce({ width: 100, height: 200, close }); await expect(decodePhotoLogo(input, signal())).rejects.toThrow('방향 또는 크기'); expect(close).toHaveBeenCalledOnce();
  const controller = new AbortController(); decode.mockImplementationOnce(async () => { controller.abort(); return { width: 200, height: 100, close }; });
  await expect(decodePhotoLogo(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(close).toHaveBeenCalledTimes(2);
});
it('읽기·해시 이전 취소는 decoder를 시작하지 않는다', async () => {
  const controller = new AbortController(), input = await file(), decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  vi.spyOn(input, 'arrayBuffer').mockImplementation(async () => { controller.abort(); return new ArrayBuffer(1); });
  await expect(decodePhotoLogo(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(decode).not.toHaveBeenCalled();
});
it('세로형 로고의 비율·1~100% 크기·사진 내부 이동·투명도를 함께 제한한다', () => {
  const size = { width: 400, height: 300 }; expect(photoLogoMaximum(size, asset)).toBe(150);
  const fitted = fitPhotoLogo(size, asset, null, { width: 999, x: 999, y: 999, opacity: 20.8 });
  expect(fitted).toEqual({ assetId: 'asset', width: 150, x: 250, y: 0, opacity: 21 }); validatePhotoLogo(fitted, size, asset);
  expect(fitPhotoLogo(size, asset, fitted, { width: -1, opacity: -10 })).toMatchObject({ width: 1.5, opacity: 0 });
  const tiny = fitPhotoLogo({ width: 1, height: 1 }, asset); expect(tiny.width).toBe(.125); validatePhotoLogo(tiny, { width: 1, height: 1 }, asset);
});
it.each(['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'] as const)('5가지 배치 %s는 원본 내부이며 중심·가장자리 여백을 지킨다', preset => {
  const size = { width: 400, height: 300 }, logo = fitPhotoLogo(size, asset, null, { width: 100 });
  const placed = positionPhotoLogo(size, asset, logo, preset); validatePhotoLogo(placed, size, asset);
  expect(placed.x).toBe(preset === 'center' ? 150 : preset.endsWith('right') ? 294 : 6);
  expect(placed.y).toBe(preset === 'center' ? 50 : preset.startsWith('bottom') ? 94 : 6);
});
it.each([{ width: 0 }, { opacity: 1.2 }, { opacity: 101 }, { x: NaN }, { y: -1 }, { assetId: '' }])('잘못된 로고 recipe %j를 거절한다', patch => {
  expect(() => validatePhotoLogo({ ...fitPhotoLogo({ width: 400, height: 300 }, asset), ...patch })).toThrow();
});
it('불투명도 0은 원래 무변경 완료를 유지하고 다른 asset 식별자·영역 초과는 거절한다', () => {
  const size = { width: 400, height: 300 }, logo = fitPhotoLogo(size, asset);
  expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), logo: { ...logo, opacity: 0 } })).toBe(true);
  expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), logo })).toBe(false);
  expect(() => validatePhotoLogo({ ...logo, assetId: 'wrong' }, size, asset)).toThrow();
  expect(() => validatePhotoLogo({ ...logo, x: 400 }, size, asset)).toThrow();
});
it('source-over와 불투명도를 지정하고 실패 시에도 Canvas 상태를 복원한다', () => {
  const bitmap = { width: 100, height: 200 } as ImageBitmap, restore = vi.fn();
  const context = { save: vi.fn(), restore, globalAlpha: 1, globalCompositeOperation: 'multiply', drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  const logo = { assetId: 'asset', x: 2, y: 3, width: 20, opacity: 40 }; drawPhotoLogo(context, bitmap, logo);
  expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 2, 3, 20, 40); expect(context.globalAlpha).toBe(.4); expect(context.globalCompositeOperation).toBe('source-over'); expect(restore).toHaveBeenCalledOnce();
  vi.mocked(context.drawImage).mockImplementationOnce(() => { throw new Error('fail'); }); expect(() => drawPhotoLogo(context, bitmap, logo)).toThrow('fail'); expect(restore).toHaveBeenCalledTimes(2);
  drawPhotoLogo(context, bitmap, { ...logo, opacity: 0 }); expect(context.save).toHaveBeenCalledTimes(2);
});
