import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialPhotoRecipe } from './photo-editor';
import { createPhotoEditSession } from './photo-editor-session';
import { decodePhotoLogo, type PhotoLogoDescriptor } from './photo-editor-logo';
import { loadPhotoSource } from './photo-editor-source';

vi.mock('./photo-editor-source', async () => ({ ...await vi.importActual('./photo-editor-source'), loadPhotoSource: vi.fn() }));
vi.mock('./photo-editor-logo', async () => ({ ...await vi.importActual('./photo-editor-logo'), decodePhotoLogo: vi.fn() }));
const decode = vi.mocked(decodePhotoLogo), encode = vi.fn(), draw = vi.fn(), put = vi.fn(), text = vi.fn();
const sourceClose = vi.fn(), source = { width: 400, height: 300, close: sourceClose };
const signal = () => new AbortController().signal, input = () => new File(['local'], 'same.png');
async function settle() { for (let index = 0; index < 16; index++) await Promise.resolve(); }
function candidate(id: string) {
  const descriptor: PhotoLogoDescriptor = { assetId: id, sha256: 'a'.repeat(64), filename: 'same.png', width: 100, height: 50, mimeType: 'image/png' };
  return { descriptor, bitmap: { width: 100, height: 50, close: vi.fn() } as unknown as ImageBitmap };
}
function recipe(asset: PhotoLogoDescriptor) { return { ...initialPhotoRecipe(), logo: { assetId: asset.assetId, x: 3, y: 4, width: 100, opacity: 60 } }; }
beforeEach(() => {
  vi.clearAllMocks(); decode.mockReset();
  vi.mocked(loadPhotoSource).mockResolvedValue({ blob: new Blob(['base']), metadata: { width: 400, height: 300, mimeType: 'image/png' } });
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(source));
  encode.mockImplementation((callback: BlobCallback, mime: string) => callback(new Blob(['result'], { type: mime })));
  vi.stubGlobal('document', { fonts: { load: vi.fn().mockResolvedValue([{ status: 'loaded' }]) }, createElement: () => ({ width: 0, height: 0, toBlob: encode,
    getContext: () => ({ save: vi.fn(), restore: vi.fn(), drawImage: draw, fillText: text, getImageData: () => ({ data: new Uint8ClampedArray([40, 80, 120, 255]) }), putImageData: put,
      translate: vi.fn(), scale: vi.fn(), rotate: vi.fn() }) }) });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('로고는 보정·모자이크 뒤, 텍스트·회전 전에 합성되며 preview와 final이 같은 치수를 쓴다', async () => {
  const value = candidate('A'); decode.mockResolvedValueOnce(value);
  const session = await createPhotoEditSession('source', signal()), asset = await session.replaceLogo(input(), signal());
  const edited = { ...recipe(asset), brightness: 10, turns: 1 as const, texts: [{ id: 't', x: 1, y: 2, text: '서명', fontSize: 20, color: '#ffffff' }] };
  await session.preview(edited, signal()); await session.render(edited, signal());
  const logoCalls = draw.mock.calls.map((args, index) => ({ args, order: draw.mock.invocationCallOrder[index] })).filter(call => call.args[0] === value.bitmap);
  expect(logoCalls).toHaveLength(2); expect(logoCalls.map(call => call.args.slice(1))).toEqual([[3, 4, 100, 50], [3, 4, 100, 50]]);
  expect(put.mock.invocationCallOrder[0]).toBeLessThan(logoCalls[0].order); expect(logoCalls[0].order).toBeLessThan(text.mock.invocationCallOrder[0]);
  session.dispose(); expect(value.bitmap.close).toHaveBeenCalledOnce(); expect(sourceClose).toHaveBeenCalledOnce();
});
it('파일명이 같은 새 선택은 asset ID로 구분하고 교체 실패는 기존 bitmap·배치를 보존한다', async () => {
  const a = candidate('A'), b = candidate('B'); decode.mockResolvedValueOnce(a).mockRejectedValueOnce(new Error('invalid')).mockResolvedValueOnce(b);
  const session = await createPhotoEditSession('source', signal()), asset = await session.replaceLogo(input(), signal());
  await expect(session.replaceLogo(input(), signal())).rejects.toThrow('invalid'); expect(a.bitmap.close).not.toHaveBeenCalled();
  await session.render(recipe(asset), signal()); expect(draw).toHaveBeenCalledWith(a.bitmap, 3, 4, 100, 50);
  const replacement = await session.replaceLogo(input(), signal()); expect(replacement.assetId).toBe('B'); expect(a.bitmap.close).toHaveBeenCalledOnce();
  await expect(session.render(recipe(asset), signal())).rejects.toThrow('현재 로고'); await session.render(recipe(replacement), signal());
  session.dispose(); expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(b.bitmap.close).toHaveBeenCalledOnce();
});
it('기존 렌더가 끝난 뒤에만 후보를 교체하고 이전 bitmap을 닫는다', async () => {
  const a = candidate('A'), b = candidate('B'); decode.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
  const session = await createPhotoEditSession('source', signal()), asset = await session.replaceLogo(input(), signal());
  let finish!: BlobCallback; encode.mockImplementationOnce((callback: BlobCallback) => { finish = callback; });
  const rendering = session.render(recipe(asset), signal()); await settle();
  let replaced = false; const replacing = session.replaceLogo(input(), signal()).then(value => { replaced = true; return value; }); await settle();
  expect(replaced).toBe(false); expect(a.bitmap.close).not.toHaveBeenCalled(); expect(b.bitmap.close).not.toHaveBeenCalled();
  finish(new Blob(['done'], { type: 'image/png' })); await rendering; await replacing;
  expect(a.bitmap.close).toHaveBeenCalledOnce(); session.dispose(); expect(b.bitmap.close).toHaveBeenCalledOnce();
});
it('단일 후보만 허용하고 로드 중 새 preview·render를 막아 활성 1개 + 후보 1개 한도를 유지한다', async () => {
  const a = candidate('A'), b = candidate('B'); decode.mockResolvedValueOnce(a);
  const session = await createPhotoEditSession('source', signal()); await session.replaceLogo(input(), signal());
  let finish!: (value: typeof b) => void; decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = session.replaceLogo(input(), signal()); await settle();
  await expect(session.replaceLogo(input(), signal())).rejects.toThrow('불러오는 중');
  await expect(session.preview(initialPhotoRecipe(), signal())).rejects.toThrow('불러오기가 끝난');
  await expect(session.render(initialPhotoRecipe(), signal())).rejects.toThrow('불러오기가 끝난');
  expect(decode).toHaveBeenCalledTimes(2); expect(a.bitmap.close).not.toHaveBeenCalled(); finish(b); await pending;
  expect(a.bitmap.close).toHaveBeenCalledOnce(); session.dispose();
});
it.each(['clear', 'dispose', 'source-abort', 'request-abort'] as const)('%s 뒤 늦은 후보는 채택하지 않고 한 번만 닫는다', async action => {
  const a = candidate('A'), b = candidate('B'), sourceController = new AbortController(), controller = new AbortController(); decode.mockResolvedValueOnce(a);
  const session = await createPhotoEditSession('source', sourceController.signal); await session.replaceLogo(input(), signal());
  let finish!: (value: typeof b) => void; decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = session.replaceLogo(input(), controller.signal); const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await settle();
  if (action === 'clear') session.clearLogo(); else if (action === 'dispose') session.dispose(); else if (action === 'source-abort') sourceController.abort(); else controller.abort();
  await expect(session.replaceLogo(input(), signal())).rejects.toThrow(); expect(decode).toHaveBeenCalledTimes(2);
  finish(b); await rejected; expect(b.bitmap.close).toHaveBeenCalledOnce();
  if (action === 'request-abort') { expect(a.bitmap.close).not.toHaveBeenCalled(); await session.render(recipe(a.descriptor), signal()); }
  else expect(a.bitmap.close).toHaveBeenCalledOnce();
  session.dispose(); expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(b.bitmap.close).toHaveBeenCalledOnce();
});
it('clear는 이미 시작된 렌더의 로고를 닫지 않으며 이후 recipe는 다시 선택해야 한다', async () => {
  const a = candidate('A'); decode.mockResolvedValueOnce(a);
  const session = await createPhotoEditSession('source', signal()), asset = await session.replaceLogo(input(), signal());
  let finish!: BlobCallback; encode.mockImplementationOnce((callback: BlobCallback) => { finish = callback; });
  const rendering = session.render(recipe(asset), signal()); await settle(); session.clearLogo();
  expect(a.bitmap.close).not.toHaveBeenCalled(); finish(new Blob(['done'], { type: 'image/png' })); await rendering; await settle();
  expect(a.bitmap.close).toHaveBeenCalledOnce(); await expect(session.preview(recipe(asset), signal())).rejects.toThrow('다시 선택');
  expect(await session.render(initialPhotoRecipe(), signal())).toBeNull(); session.dispose(); expect(a.bitmap.close).toHaveBeenCalledOnce();
});
it('JPEG 위 로고는 JPEG를 유지하며 투명도 0만 적용한 완료는 새 파일을 만들지 않는다', async () => {
  vi.mocked(loadPhotoSource).mockResolvedValueOnce({ blob: new Blob(['base']), metadata: { width: 400, height: 300, mimeType: 'image/jpeg' } });
  const a = candidate('A'); decode.mockResolvedValueOnce(a);
  const session = await createPhotoEditSession('source', signal()), asset = await session.replaceLogo(input(), signal());
  expect((await session.render(recipe(asset), signal()))?.type).toBe('image/jpeg'); encode.mockClear();
  const edited = recipe(asset); edited.logo.opacity = 0; expect(await session.render(edited, signal())).toBeNull(); expect(encode).not.toHaveBeenCalled(); session.dispose();
});
