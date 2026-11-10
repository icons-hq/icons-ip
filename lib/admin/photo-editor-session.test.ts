import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialPhotoRecipe } from './photo-editor';
import { createPhotoEditSession } from './photo-editor-session';
import { loadPhotoSource, PHOTO_EDIT_MAX_BYTES } from './photo-editor-source';
import * as AutoLevels from './photo-editor-auto-levels';
import * as Decorations from './photo-editor-decoration-canvas';
import type { PhotoSticker } from './photo-editor-decorations';

vi.mock('./photo-editor-source', () => ({ loadPhotoSource: vi.fn(), PHOTO_EDIT_MAX_BYTES: 5 * 1024 * 1024 }));
const load = vi.mocked(loadPhotoSource);
const decode = vi.fn(), close = vi.fn(), encode = vi.fn(), putPixels = vi.fn(), fontLoad = vi.fn(), fillText = vi.fn(), drawImage = vi.fn(), getPixels = vi.fn();
const pathDraw = vi.fn(), resetTransform = vi.fn(), arc = vi.fn();
const rotate = vi.fn(), scale = vi.fn();
let canvases: { width: number; height: number }[];
const signal = () => new AbortController().signal;
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
beforeEach(() => {
  vi.clearAllMocks(); canvases = [];
  load.mockResolvedValue({ blob: new Blob(['source'], { type: 'image/png' }), metadata: { mimeType: 'image/png', width: 4, height: 2 } });
  decode.mockResolvedValue({ width: 4, height: 2, close });
  fontLoad.mockReset(); fontLoad.mockResolvedValue([{ status: 'loaded' }]);
  getPixels.mockReset(); getPixels.mockReturnValue({ data: new Uint8ClampedArray([100, 80, 60, 128, 7, 9, 11, 0]) });
  encode.mockImplementation((callback: BlobCallback, mime: string) => callback(new Blob(['encoded'], { type: mime })));
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('document', { fonts: { load: fontLoad }, createElement: () => {
    const canvas = { width: 0, height: 0, toBlob: encode, getContext: () => ({
      scale, translate: vi.fn(), rotate, drawImage, fillText,
      getImageData: getPixels, putImageData: putPixels,
      save: vi.fn(), restore: vi.fn(), resetTransform, beginPath: vi.fn(), moveTo: vi.fn(), arc, rect: vi.fn(), arcTo: vi.fn(), lineTo: vi.fn(), bezierCurveTo: vi.fn(), closePath: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(),
      globalCompositeOperation: 'source-over', fillStyle: '', font: '',
      measureText(line: string) { const size = Number.parseFloat(this.font.slice(4)) || 16; return { width: line.length * size, actualBoundingBoxLeft: 0, actualBoundingBoxRight: line.length * size, actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2 }; },
      fill(rule?: CanvasFillRule) { pathDraw({ rule, composite: this.globalCompositeOperation, color: this.fillStyle, width: canvas.width, height: canvas.height }); },
    }) };
    canvases.push(canvas); return canvas;
  } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('변경 없는 완료는 파일 생성·재압축 없이 null을 반환한다', async () => {
  const session = await createPhotoEditSession('source', signal());
  expect(await session.render(initialPhotoRecipe(), signal())).toBeNull(); expect(encode).not.toHaveBeenCalled();
  session.dispose(); session.dispose(); expect(close).toHaveBeenCalledOnce();
});
it('비활성 장식은 파일·폰트·추가 canvas를 만들지 않는다', async () => {
  const session = await createPhotoEditSession('source', signal());
  const recipe = { ...initialPhotoRecipe(), frameStyle: 'double' as const, stickers: [{ id: 'hidden', asset: 'star' as const, x: 0, y: 0, width: 1, turns: 0 as const, opacity: 0, color: '#ff0000' }],
    texts: [{ id: 'empty', text: ' ', x: 0, y: 0, fontSize: 8, color: '#000000', style: 'signature-rule' as const, decorationWidth: 1, backgroundColor: '#ffffff' }] };
  expect(await session.render(recipe, signal())).toBeNull(); expect(canvases).toHaveLength(0); expect(fontLoad).not.toHaveBeenCalled(); expect(encode).not.toHaveBeenCalled(); session.dispose();
});
it('한글 장식·스티커를 원본 해상도에서 합성한 뒤 회전·crop·최종 마스크 한 번을 적용한다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/jpeg', width: 400, height: 300 } });
  decode.mockResolvedValueOnce({ width: 400, height: 300, close });
  const session = await createPhotoEditSession('source', signal()), mark = vi.spyOn(Decorations, 'drawPhotoSticker'), words = vi.spyOn(Decorations, 'drawPhotoText');
  const recipe = { ...initialPhotoRecipe(), turns: 1 as const, crop: { x: 0, y: .25, width: 1, height: .5 }, frameStyle: 'double' as const, frameWidth: 9, mask: 'circle' as const,
    stickers: [{ id: 'mark', asset: 'heart' as const, x: 20, y: 30, width: 100, turns: 3 as const, color: '#ff0000', opacity: 70 }],
    texts: [{ id: 'bubble', text: '한글\n두 줄', x: 30, y: 40, fontSize: 16, color: '#000000', style: 'bubble-round' as const, decorationWidth: 200, backgroundColor: '#ffffff' }] };
  const file = await session.render(recipe, signal());
  expect(file?.type).toBe('image/png'); expect(fontLoad).toHaveBeenCalledWith('400 16px "Pretendard"', '한글\n두 줄');
  expect(mark).toHaveBeenCalledWith(expect.anything(), recipe.stickers[0]); expect(words).toHaveBeenCalledWith(expect.anything(), recipe.texts[0]);
  expect(mark.mock.invocationCallOrder[0]).toBeLessThan(words.mock.invocationCallOrder[0]);
  expect(words.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder[1]);
  const masks = pathDraw.mock.calls.map(([value]) => value).filter(value => value.composite === 'destination-in');
  expect(masks).toEqual([expect.objectContaining({ width: 300, height: 200 })]);
  expect(canvases).toHaveLength(2); expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true); session.dispose();
});
it('장식 문구 초과는 인코딩 전에 실패하고 너비를 고친 같은 세션에서 회복한다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 400, height: 300 } });
  decode.mockResolvedValueOnce({ width: 400, height: 300, close });
  const session = await createPhotoEditSession('source', signal());
  const text = { id: 'seal', text: '서명', x: 0, y: 0, fontSize: 20, color: '#000000', style: 'signature-seal' as const, decorationWidth: 20, backgroundColor: '#ffffff' };
  await expect(session.render({ ...initialPhotoRecipe(), texts: [text] }, signal())).rejects.toThrow('맞지');
  expect(encode).not.toHaveBeenCalled(); expect(canvases.every(canvas => !canvas.width && !canvas.height)).toBe(true);
  expect(await session.render({ ...initialPhotoRecipe(), texts: [{ ...text, decorationWidth: 200 }] }, signal())).toBeInstanceOf(File); session.dispose();
});
it('4MP 장식 레이어 사이 취소는 추가 bitmap 없이 중단하고 큐의 다음 요청을 보존한다', async () => {
  vi.useFakeTimers(); let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 10);
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 2000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 2000, close });
  const session = await createPhotoEditSession('source', signal()), controller = new AbortController(), draw = vi.spyOn(Decorations, 'drawPhotoSticker');
  const stickers: PhotoSticker[] = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, asset: 'heart', x: 0, y: 0, width: 1000, turns: 0, color: '#ff0000', opacity: 100 }));
  const rendering = session.render({ ...initialPhotoRecipe(), stickers }, controller.signal), rejected = expect(rendering).rejects.toMatchObject({ name: 'AbortError' });
  await settle(); expect(draw).toHaveBeenCalledOnce(); controller.abort(); await vi.runAllTimersAsync(); await rejected;
  expect(canvases).toHaveLength(1); expect(canvases[0]).toMatchObject({ width: 0, height: 0 }); expect(encode).not.toHaveBeenCalled(); expect(getPixels).not.toHaveBeenCalled();
  expect(await session.render(initialPhotoRecipe(), signal())).toBeNull(); session.dispose();
});
it('필터 강도 0은 재압축 없이 완료하고 50은 기존 수동 보정 전에 혼합한다', async () => {
  getPixels.mockImplementation(() => ({ data: new Uint8ClampedArray([100, 150, 200, 127, 7, 9, 11, 0]) }));
  const session = await createPhotoEditSession('source', signal());
  expect(await session.render({ ...initialPhotoRecipe(), filter: 'warm', filterStrength: 0 }, signal())).toBeNull();
  expect(encode).not.toHaveBeenCalled();
  await session.render({ ...initialPhotoRecipe(), filter: 'warm', filterStrength: 50, brightness: 10 }, signal());
  expect([...putPixels.mock.calls[0][0].data]).toEqual([131, 177, 218, 127, 7, 9, 11, 0]);
  await session.render({ ...initialPhotoRecipe(), filter: 'warm', filterStrength: 0, brightness: 10 }, signal());
  expect([...putPixels.mock.calls[1][0].data]).toEqual([126, 176, 226, 127, 7, 9, 11, 0]); session.dispose();
});

it('수평 분석은 원본을 비율 유지 640px로 샘플링하고 완성된 결과만 분리해 캐시한다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 1000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 1000, close });
  const pixels = new Uint8ClampedArray(640 * 320 * 4).fill(127); getPixels.mockReturnValueOnce({ data: pixels });
  const session = await createPhotoEditSession('source', signal());
  const first = await session.estimateStraighten(signal());
  expect(first).toMatchObject({ degrees: null, reason: 'insufficient-lines' });
  expect(drawImage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ width: 2000, height: 1000 }), 0, 0, 640, 320);
  expect(getPixels).toHaveBeenCalledExactlyOnceWith(0, 0, 640, 320);
  first.degrees = 14;
  expect(await session.estimateStraighten(signal())).toMatchObject({ degrees: null });
  expect(getPixels).toHaveBeenCalledOnce(); expect(pixels.every(value => value === 127)).toBe(true);
  expect(encode).not.toHaveBeenCalled(); expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  session.dispose(); await expect(session.estimateStraighten(signal())).rejects.toMatchObject({ name: 'AbortError' });
});
it('수평 분석을 중도 취소하면 결과를 캐시하지 않으며 세션 큐를 다시 사용할 수 있다', async () => {
  vi.useFakeTimers(); let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 10);
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 64, height: 32 } });
  decode.mockResolvedValueOnce({ width: 64, height: 32, close });
  getPixels.mockReturnValue({ data: new Uint8ClampedArray(64 * 32 * 4).fill(255) });
  const session = await createPhotoEditSession('source', signal()), controller = new AbortController();
  const pending = session.estimateStraighten(controller.signal), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await settle(); controller.abort(); await vi.runAllTimersAsync(); await rejected;
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  const retry = session.estimateStraighten(signal()); await vi.runAllTimersAsync();
  expect(await retry).toMatchObject({ degrees: null }); expect(getPixels).toHaveBeenCalledTimes(2); session.dispose();
});
it('수평 분석은 진행 중인 렌더 뒤에 실행되며 수평 변환은 전체 합성 사진 위에 적용된다', async () => {
  const session = await createPhotoEditSession('source', signal()); let finish!: BlobCallback;
  encode.mockImplementationOnce((callback: BlobCallback) => { finish = callback; });
  const rendering = session.render({ ...initialPhotoRecipe(), straightenDegrees: 10, flipX: true }, signal()); await settle();
  const analysis = session.estimateStraighten(signal()); await settle(); expect(getPixels).not.toHaveBeenCalled();
  const radians = 10 * Math.PI / 180;
  expect(rotate.mock.calls).toEqual([[radians], [0]]);
  expect(scale.mock.calls[0][0]).toBeCloseTo(Math.cos(radians) + 2 * Math.sin(radians));
  expect(scale.mock.calls[0][0]).toBe(scale.mock.calls[0][1]); expect(scale.mock.calls[1]).toEqual([-1, 1]);
  getPixels.mockReturnValueOnce({ data: new Uint8ClampedArray(4 * 2 * 4) });
  finish(new Blob(['encoded'], { type: 'image/png' })); await rendering;
  expect(await analysis).toMatchObject({ degrees: null }); expect(getPixels).toHaveBeenCalledOnce(); session.dispose();
});
it('출력은 원래 치수의 새 PNG File이고 보정은 부분 alpha를 보존한다', async () => {
  const session = await createPhotoEditSession('source', signal());
  const file = await session.render({ ...initialPhotoRecipe(), brightness: 20 }, signal());
  expect(file).toBeInstanceOf(File); expect(file?.type).toBe('image/png'); expect(file?.name).toBe('edited-photo.png');
  expect([...putPixels.mock.calls[0][0].data]).toEqual([151, 131, 111, 128, 7, 9, 11, 0]);
  expect(canvases[0]).toMatchObject({ width: 0, height: 0 }); session.dispose();
});
it('JPEG는 명시한 품질 한 번으로 만들며 PNG·WebP는 PNG로 내보낸다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/jpeg', width: 4, height: 2 } });
  const jpeg = await createPhotoEditSession('jpeg', signal());
  expect((await jpeg.render({ ...initialPhotoRecipe(), flipX: true }, signal()))?.type).toBe('image/jpeg');
  expect(encode.mock.calls[0].slice(1)).toEqual(['image/jpeg', 0.92]); jpeg.dispose();
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/webp', width: 4, height: 2 } });
  const webp = await createPhotoEditSession('webp', signal());
  expect((await webp.render({ ...initialPhotoRecipe(), flipX: true }, signal()))?.type).toBe('image/png'); webp.dispose();
});
it('preview만 1280px 안으로 줄이며 최종 출력은 자른 원래 픽셀 치수를 유지한다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 1000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 1000, close });
  const session = await createPhotoEditSession('source', signal()), recipe = { ...initialPhotoRecipe(), flipX: true };
  expect(await session.preview(recipe, signal())).toMatchObject({ width: 1280, height: 640 });
  await session.render(recipe, signal());
  // The render's canvas is released only after encoding; capture its allocation at that seam.
  encode.mockImplementationOnce((callback: BlobCallback, mime: string) => {
    expect(canvases.at(-1)).toMatchObject({ width: 1000, height: 2000 }); callback(new Blob(['encoded'], { type: mime }));
  });
  await session.render({ ...recipe, turns: 1 }, signal()); session.dispose();
});
it('EXIF 표시 방향의 크기를 확인하고 모순된 decoder 결과를 버린다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/jpeg', width: 4, height: 2, orientation: 6 } });
  decode.mockResolvedValueOnce({ width: 2, height: 4, close });
  const session = await createPhotoEditSession('source', signal()); expect(session.size).toEqual({ width: 2, height: 4 }); session.dispose();
  decode.mockResolvedValueOnce({ width: 3, height: 2, close });
  await expect(createPhotoEditSession('source', signal())).rejects.toThrow('방향 또는 크기'); expect(close).toHaveBeenCalledTimes(2);
});
it('소스를 읽는 사이 취소되면 decoder를 실행하지 않는다', async () => {
  const controller = new AbortController();
  load.mockImplementationOnce(async () => { controller.abort(); return { blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 4, height: 2 } }; });
  await expect(createPhotoEditSession('source', controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(decode).not.toHaveBeenCalled();
});
it('decoder의 늦은 결과는 즉시 닫아 반환하지 않는다', async () => {
  const controller = new AbortController(); let finish!: (bitmap: unknown) => void;
  decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const opening = createPhotoEditSession('source', controller.signal); await settle(); controller.abort(); finish({ width: 4, height: 2, close });
  await expect(opening).rejects.toMatchObject({ name: 'AbortError' }); expect(close).toHaveBeenCalledOnce();
});
it('인코딩 중 취소·세션 종료는 늦은 File과 큐의 다음 작업을 전달하지 않는다', async () => {
  const session = await createPhotoEditSession('source', signal()), controller = new AbortController(); let finish!: BlobCallback;
  encode.mockImplementationOnce((callback: BlobCallback) => { finish = callback; });
  const pending = session.render({ ...initialPhotoRecipe(), flipX: true }, controller.signal); await settle();
  const queued = session.preview(initialPhotoRecipe(), signal());
  session.dispose(); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  finish(new Blob(['late'], { type: 'image/png' })); await settle();
  expect(encode).toHaveBeenCalledOnce(); expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
});
it.each(['empty', 'wrong-mime', 'oversize', 'null'] as const)('지원되지 않는 인코딩 결과 %s는 재시도나 자동 축소 없이 거절한다', async kind => {
  encode.mockImplementationOnce((callback: BlobCallback) => callback(kind === 'null' ? null : kind === 'oversize'
    ? new Blob([new Uint8Array(PHOTO_EDIT_MAX_BYTES + 1)], { type: 'image/png' })
    : new Blob(kind === 'empty' ? [] : ['x'], { type: kind === 'wrong-mime' ? 'image/webp' : 'image/png' })));
  const session = await createPhotoEditSession('source', signal());
  await expect(session.render({ ...initialPhotoRecipe(), flipX: true }, signal())).rejects.toThrow();
  expect(encode).toHaveBeenCalledOnce(); expect(canvases[0]).toMatchObject({ width: 0, height: 0 }); session.dispose();
});

const textLayer = { id: 'text-1', text: '한글\nHello', x: 1, y: 1, fontSize: 20, color: '#ff0000' };
it('한글 폰트가 실제로 로드된 뒤 색상 보정 위에 여러 텍스트와 줄바꿈을 그린다', async () => {
  const session = await createPhotoEditSession('source', signal());
  await session.render({ ...initialPhotoRecipe(), temperature: 20, texts: [textLayer, { ...textLayer, id: 'text-2', text: '두 번째', x: 2 }] }, signal());
  expect(fontLoad).toHaveBeenCalledWith('400 16px "Pretendard"', '한글\nHello두 번째');
  expect(fillText.mock.calls).toEqual([['한글', 1, 1], ['Hello', 1, 27], ['두 번째', 2, 1]]);
  expect(putPixels.mock.invocationCallOrder[0]).toBeLessThan(fillText.mock.invocationCallOrder[0]);
  expect(fillText.mock.invocationCallOrder[2]).toBeLessThan(encode.mock.invocationCallOrder[0]); session.dispose();
});
it.each([{ faces: [] }, { faces: [{ status: 'unloaded' }] }])('실제 폰트 face가 없거나 미완료면 대체 글꼴로 저장하지 않는다: %j', async ({ faces }) => {
  fontLoad.mockResolvedValueOnce(faces);
  const session = await createPhotoEditSession('source', signal());
  await expect(session.render({ ...initialPhotoRecipe(), texts: [textLayer] }, signal())).rejects.toThrow('글꼴');
  expect(fillText).not.toHaveBeenCalled(); expect(encode).not.toHaveBeenCalled(); session.dispose();
});
it('폰트 네트워크 실패를 보고하고 오류 뒤에도 같은 세션에서 텍스트를 지워 복구할 수 있다', async () => {
  fontLoad.mockRejectedValueOnce(new Error('offline'));
  const session = await createPhotoEditSession('source', signal());
  await expect(session.render({ ...initialPhotoRecipe(), texts: [textLayer] }, signal())).rejects.toThrow('글꼴');
  expect(await session.render(initialPhotoRecipe(), signal())).toBeNull(); session.dispose();
});
it('폰트 대기 중 취소는 즉시 완료되고 늦은 폰트 응답은 그리거나 저장하지 않는다', async () => {
  let finish!: (faces: unknown[]) => void;
  fontLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const session = await createPhotoEditSession('source', signal()), controller = new AbortController();
  const pending = session.render({ ...initialPhotoRecipe(), texts: [textLayer] }, controller.signal); await settle();
  expect(fontLoad).toHaveBeenCalledOnce(); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); finish([{ status: 'loaded' }]); await settle();
  expect(fillText).not.toHaveBeenCalled(); expect(encode).not.toHaveBeenCalled(); session.dispose();
});
it('8초 동안 끝나지 않는 폰트 요청은 큐를 계속 막지 않는다', async () => {
  vi.useFakeTimers(); fontLoad.mockImplementationOnce(() => new Promise(() => {}));
  const session = await createPhotoEditSession('source', signal());
  const pending = session.render({ ...initialPhotoRecipe(), texts: [textLayer] }, signal());
  const rejected = expect(pending).rejects.toThrow('시간이 초과'); await vi.advanceTimersByTimeAsync(8000); await rejected;
  expect(await session.render(initialPhotoRecipe(), signal())).toBeNull(); session.dispose();
});
it('미리보기도 2000px 원본에서 효과를 처리한 다음 완성된 canvas를 1280px로 줄인다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 1000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 1000, close });
  const session = await createPhotoEditSession('source', signal());
  const preview = await session.preview({ ...initialPhotoRecipe(), temperature: 30, texts: [textLayer] }, signal());
  expect(getPixels).toHaveBeenCalledWith(0, 0, 2000, 1000); expect(preview).toMatchObject({ width: 1280, height: 640 });
  expect(drawImage.mock.calls.at(-1)).toEqual([canvases[0], 0, 0, 1280, 640]);
  expect(fillText.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder.at(-1)!);
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true); session.dispose();
});
it('4MP 보정 중 이벤트 루프에서 취소하면 부분 결과나 큐의 늦은 인코딩을 반환하지 않는다', async () => {
  const controller = new AbortController();
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 2000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 2000, close });
  getPixels.mockReturnValueOnce({ data: new Uint8ClampedArray(2000 * 2000 * 4).fill(255) });
  const session = await createPhotoEditSession('source', signal());
  setTimeout(() => controller.abort(), 0);
  await expect(session.render({ ...initialPhotoRecipe(), temperature: 30 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(encode).not.toHaveBeenCalled(); expect(canvases.every(canvas => canvas.width === 0)).toBe(true); session.dispose();
});

it('추가 보정의 preview와 final은 원본 해상도에서 같은 픽셀을 합성한 뒤 텍스트를 그린다', async () => {
  const source = new Uint8ClampedArray(Array.from({ length: 8 }, (_, index) => [index * 30, 200 - index * 20, 90 + index * 10, index === 0 ? 0 : index === 1 ? 128 : 255]).flat());
  getPixels.mockImplementation(() => ({ data: new Uint8ClampedArray(source) }));
  const session = await createPhotoEditSession('source', signal());
  const recipe = { ...initialPhotoRecipe(), sharpness: 60, circularBlur: 70, linearBlur: 40, vignette: 35, texts: [textLayer] };
  await session.preview(recipe, signal()); await session.render(recipe, signal());
  const preview = putPixels.mock.calls[0][0].data as Uint8ClampedArray, final = putPixels.mock.calls[1][0].data as Uint8ClampedArray;
  expect(preview).toEqual(final); expect(preview).not.toEqual(source);
  expect(Array.from(preview).filter((_, index) => index % 4 === 3)).toEqual(Array.from(source).filter((_, index) => index % 4 === 3));
  expect([...preview.slice(0, 4)]).toEqual([...source.slice(0, 4)]);
  expect(putPixels.mock.invocationCallOrder[0]).toBeLessThan(fillText.mock.invocationCallOrder[0]); session.dispose();
});
it('4MP 추가 blur 계산 중 취소하면 부분 canvas·늦은 파일을 반환하지 않고 다음 요청을 처리한다', async () => {
  const controller = new AbortController();
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 2000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 2000, close });
  getPixels.mockReturnValueOnce({ data: new Uint8ClampedArray(2000 * 2000 * 4).fill(255) });
  const session = await createPhotoEditSession('source', signal());
  setTimeout(() => controller.abort(), 0);
  await expect(session.render({ ...initialPhotoRecipe(), circularBlur: 80 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(encode).not.toHaveBeenCalled(); expect(putPixels).not.toHaveBeenCalled();
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  expect(await session.render(initialPhotoRecipe(), signal())).toBeNull(); session.dispose();
});

it('자동 명암은 원본에서 한 번 구하고 자르기·수동 밝기가 바뀌어도 같은 한계를 사용한다', async () => {
  const calculation = vi.spyOn(AutoLevels, 'calculatePhotoAutoLevels');
  const source = new Uint8ClampedArray([50, 75, 100, 125, 150, 175, 200, 225].flatMap(value => [value, value, value, 255]));
  getPixels.mockImplementation(() => ({ data: new Uint8ClampedArray(source) }));
  const session = await createPhotoEditSession('source', signal());
  try {
    await session.preview({ ...initialPhotoRecipe(), automaticLevels: true }, signal());
    expect([...putPixels.mock.calls[0][0].data].filter((_, index) => index % 4 === 0)).toEqual([0, 36, 73, 109, 146, 182, 219, 255]);
    await session.render({ ...initialPhotoRecipe(), automaticLevels: true, brightness: 10, crop: { x: .5, y: 0, width: .5, height: 1 } }, signal());
    expect([...putPixels.mock.calls[1][0].data].filter((_, index) => index % 4 === 0)).toEqual([26, 62, 99, 135, 172, 208, 245, 255]);
    expect(calculation).toHaveBeenCalledTimes(1);
    await session.preview(initialPhotoRecipe(), signal()); expect(putPixels).toHaveBeenCalledTimes(2);
  } finally { calculation.mockRestore(); session.dispose(); }
});
it('최종 회전·자르기 크기로 테두리와 도형을 그리고 JPEG의 투명 마스크만 PNG로 바꾼다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/jpeg', width: 4, height: 2 } });
  const session = await createPhotoEditSession('source', signal());
  const recipe = { ...initialPhotoRecipe(), turns: 1 as const, crop: { x: 0, y: .25, width: 1, height: .5 }, frameWidth: 8, mask: 'circle' as const };
  const result = await session.render(recipe, signal());
  expect(result).toMatchObject({ type: 'image/png', name: 'edited-photo.png' });
  expect(pathDraw.mock.calls.map(call => call[0])).toEqual([
    { rule: 'evenodd', composite: 'source-over', color: '#ffffff', width: 2, height: 2 },
    { rule: undefined, composite: 'destination-in', color: '#000000', width: 2, height: 2 },
  ]);
  expect(arc.mock.calls.every(call => call[0] === 1 && call[1] === 1 && call[2] === 1)).toBe(true);
  expect(resetTransform.mock.invocationCallOrder[0]).toBeLessThan(pathDraw.mock.invocationCallOrder[0]);
  expect((await session.render({ ...initialPhotoRecipe(), frameWidth: 1 }, signal()))?.type).toBe('image/jpeg');
  expect((await session.render({ ...initialPhotoRecipe(), mask: 'rounded' }, signal()))?.type).toBe('image/png'); session.dispose();
});
it('도형은 텍스트 뒤 원본 픽셀 크기에서 적용하고 완성된 미리보기만 줄인다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 1000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 1000, close });
  const session = await createPhotoEditSession('source', signal());
  await session.preview({ ...initialPhotoRecipe(), mask: 'circle', texts: [textLayer] }, signal());
  expect(pathDraw.mock.calls[0][0]).toMatchObject({ width: 2000, height: 1000 });
  expect(fillText.mock.invocationCallOrder[0]).toBeLessThan(pathDraw.mock.invocationCallOrder[0]);
  expect(pathDraw.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder.at(-1)!);
  expect(drawImage.mock.calls.at(-1)?.slice(1)).toEqual([0, 0, 1280, 640]); session.dispose();
});
it('4MP 히스토그램 계산 중 취소한 값은 캐시에 남지 않고 늦은 인코딩도 실행하지 않는다', async () => {
  const controller = new AbortController(), calculation = vi.spyOn(AutoLevels, 'calculatePhotoAutoLevels');
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 2000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 2000, close });
  getPixels.mockReturnValueOnce({ data: new Uint8ClampedArray(2000 * 2000 * 4).fill(255) });
  const session = await createPhotoEditSession('source', signal());
  try {
    setTimeout(() => controller.abort(), 0);
    await expect(session.render({ ...initialPhotoRecipe(), automaticLevels: true }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(encode).not.toHaveBeenCalled(); expect(putPixels).not.toHaveBeenCalled();
    expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
    await session.preview({ ...initialPhotoRecipe(), automaticLevels: true }, signal()); expect(calculation).toHaveBeenCalledTimes(2);
  } finally { calculation.mockRestore(); session.dispose(); }
});
it('JPEG의 도형 결과가 PNG 한도를 넘으면 최종 파일을 반환하지 않는다', async () => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/jpeg', width: 4, height: 2 } });
  encode.mockImplementationOnce((callback: BlobCallback, mime: string) => callback(new Blob([new Uint8Array(PHOTO_EDIT_MAX_BYTES + 1)], { type: mime })));
  const session = await createPhotoEditSession('source', signal());
  await expect(session.render({ ...initialPhotoRecipe(), mask: 'circle' }, signal())).rejects.toThrow('5MB');
  expect(encode.mock.calls[0].slice(1)).toEqual(['image/png', undefined]); expect(canvases.every(canvas => canvas.width === 0)).toBe(true); session.dispose();
});


it('색조는 자동 명암 뒤 수동 보정 앞에 적용하고 해제하면 원본으로부터 수동 보정만 다시 계산한다', async () => {
  const source = new Uint8ClampedArray([50, 75, 100, 125, 150, 175, 200, 225].flatMap(value => [value, value, value, 255]));
  getPixels.mockImplementation(() => ({ data: source.slice() }));
  const session = await createPhotoEditSession('source', signal());
  const recipe = { ...initialPhotoRecipe(), automaticLevels: true, filter: 'warm' as const, brightness: -10 };
  await session.preview(recipe, signal()); await session.render(recipe, signal());
  const preview = putPixels.mock.calls[0][0].data as Uint8ClampedArray;
  expect([...preview.slice(0, 12)]).toEqual([0, 0, 0, 255, 18, 12, 5, 255, 57, 49, 40, 255]);
  expect([...preview.slice(-4)]).toEqual([230, 230, 211, 255]);
  expect(putPixels.mock.calls[1][0].data).toEqual(preview);
  await session.render({ ...recipe, filter: 'none', automaticLevels: false }, signal());
  expect([...putPixels.mock.calls[2][0].data.slice(0, 12)]).toEqual([25, 25, 25, 255, 50, 50, 50, 255, 75, 75, 75, 255]);
  expect(await session.render(initialPhotoRecipe(), signal())).toBeNull(); session.dispose();
});
it.each(['triangle', 'pentagon', 'hexagon', 'star'] as const)('JPEG의 %s 마스크와 필터는 PNG로 저장하며 크기를 늘리지 않는다', async mask => {
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/jpeg', width: 4, height: 2 } });
  const session = await createPhotoEditSession('source', signal());
  const file = await session.render({ ...initialPhotoRecipe(), mask, frameWidth: 1, filter: 'faded' }, signal());
  expect(file?.type).toBe('image/png'); expect(encode.mock.calls[0][1]).toBe('image/png');
  expect(pathDraw.mock.calls.at(-1)?.[0]).toMatchObject({ composite: 'destination-in', width: 4, height: 2 });
  session.dispose();
});
it('4MP 필터 중 취소는 부분 결과를 반환하지 않으며 다음 변경 없는 요청은 정상 완료한다', async () => {
  const controller = new AbortController();
  load.mockResolvedValueOnce({ blob: new Blob(['source']), metadata: { mimeType: 'image/png', width: 2000, height: 2000 } });
  decode.mockResolvedValueOnce({ width: 2000, height: 2000, close });
  getPixels.mockReturnValueOnce({ data: new Uint8ClampedArray(2000 * 2000 * 4).fill(255) });
  const session = await createPhotoEditSession('source', signal());
  setTimeout(() => controller.abort(), 0);
  await expect(session.render({ ...initialPhotoRecipe(), filter: 'sepia' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(encode).not.toHaveBeenCalled(); expect(putPixels).not.toHaveBeenCalled(); expect(canvases.every(canvas => canvas.width === 0)).toBe(true);
  expect(await session.render(initialPhotoRecipe(), signal())).toBeNull(); session.dispose();
});
