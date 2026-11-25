import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], memos: [] as { value: unknown; deps: unknown[] }[], effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ upload: vi.fn(), preview: vi.fn(), unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => {
  const effect = (callback: () => void | (() => void), deps: unknown[] = []) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects[index] = { deps, effect: callback, cleanup: previous?.cleanup }; hooks.changed.push(index); }
  };
  return { ...await vi.importActual<typeof import('react')>('react'),
    useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
    useRef: (value: unknown) => { const i = hooks.refIndex++; return hooks.refs[i] ??= { current: value }; },
    useMemo: (fn: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, n) => dep !== hooks.memos[i].deps[n])) hooks.memos[i] = { value: fn(), deps }; return hooks.memos[i].value; },
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(), useEffect: effect, useLayoutEffect: effect,
  };
});
vi.mock('@/lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: mocks.upload }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { GoodsImageGrid } from './GoodsImageGrid';
import { GoodsPhotoEditor } from './GoodsPhotoEditor';
import { GoodsPhotoPicker } from './screens/GoodsPhotoLibraryScreen';
const actor = '99000000-0000-4000-8000-000000000001';
const original = 'public-media/catalog/good/99000000-0000-4000-8000-000000000003.png';
const replacement = 'public-media/catalog/good/99000000-0000-4000-8000-000000000004.png';
const props = { accountId: actor, recordId: 'good-a', initialPaths: [original], initialUrls: ['https://example.test/original.png'], onPreviewChange: mocks.preview };
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onApply?: (file: File | null) => void; onCancel?: () => void; name?: string; value?: string; disabled?: boolean; 'aria-label'?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return GoodsImageGrid(props); }
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
function button(label: string) { const found = all(render()).find(item => item.type === 'button' && (item.props['aria-label'] === label || text(item) === label)); if (!found) throw new Error(label); return found; }
function editor() { return all(render()).find(item => item.type === GoodsPhotoEditor)!; }
function path() { return all(render()).find(item => item.type === 'input' && item.props.name === 'imagePath')?.props.value; }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function auth(id = actor, session = '99000000-0000-4000-8000-000000000010') { mocks.auth?.('SIGNED_IN', { user: { id }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
const file = () => new File(['edited'], 'edited.png', { type: 'image/png' });
beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; vi.clearAllMocks(); mocks.upload.mockReset();
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:edited'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  render(); effects(); auth();
});
afterEach(() => { for (const item of hooks.effects) item.cleanup?.(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('명시 적용은 같은 actor로 업로드하고 verify 전에는 저장 경로를 바꾸지 않는다', async () => {
  let finish!: (value: unknown) => void; mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  button('대표 이미지 사진 편집').props.onClick?.(); const edited = file(); editor().props.onApply?.(edited); await settle();
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith({ kind: 'good', file: edited, expectedActorId: actor }); expect(path()).toBe(original);
  finish({ ok: true, imagePath: replacement }); await settle(); expect(path()).toBe(replacement); expect(text(render())).toContain('편집 이미지 업로드 완료 · 상품 저장 전');
});
it('편집 업로드가 실패하면 원래 경로와 미리보기를 복구한다', async () => {
  mocks.upload.mockResolvedValue({ ok: false, error: '검증 실패' }); button('대표 이미지 사진 편집').props.onClick?.(); editor().props.onApply?.(file()); await settle();
  expect(path()).toBe(original); expect(text(render())).toContain('원래 이미지를 유지합니다');
  expect(mocks.preview).toHaveBeenCalledWith('imagePath', 'https://example.test/original.png');
});
it('취소 뒤 늦게 성공한 업로드는 원래 타일을 교체하지 않는다', async () => {
  let finish!: (value: unknown) => void; mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  button('대표 이미지 사진 편집').props.onClick?.(); editor().props.onApply?.(file()); await settle();
  button('편집 업로드 취소').props.onClick?.(); expect(path()).toBe(original);
  finish({ ok: true, imagePath: replacement }); await settle(); expect(path()).toBe(original); expect(text(render())).not.toContain('업로드 완료');
});
it('열어둔 편집의 계정이 바뀌면 옛 callback으로 새 업로드를 시작하지 않는다', async () => {
  button('대표 이미지 사진 편집').props.onClick?.(); const stale = editor(); auth('99000000-0000-4000-8000-000000000099');
  stale.props.onApply?.(file()); await settle(); expect(mocks.upload).not.toHaveBeenCalled(); expect(path()).toBe(original); expect(text(render())).toContain('로그인한 계정이 바뀌었거나 다시 로그인해서 사진 편집을 중단');
});
it('폼을 떠난 뒤 업로드 성공은 미리보기와 새 폼에 적용하지 않는다', async () => {
  let finish!: (value: unknown) => void; mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  button('대표 이미지 사진 편집').props.onClick?.(); editor().props.onApply?.(file()); await settle();
  for (const item of hooks.effects) { item.cleanup?.(); item.cleanup = undefined; }
  mocks.preview.mockClear(); finish({ ok: true, imagePath: replacement }); await settle(); expect(mocks.preview).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:edited');
});
it('변경 없음과 편집 취소는 파일과 상품 경로를 바꾸지 않는다', async () => {
  button('대표 이미지 사진 편집').props.onClick?.(); editor().props.onApply?.(null); button('대표 이미지 사진 편집').props.onClick?.(); editor().props.onCancel?.(); await settle();
  expect(path()).toBe(original); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
});
/* R19(MD-0030) 측정: 10장을 한 번에 올리면 커밋마다 10개 자리 전부를 상품 편집기 미리보기로 다시 알려 편집기 전체가
   업로드 진행마다 다시 렌더됐다(시작 1회 + 완료 10회 = 11회 × 10자리 = 110회). 바뀐 자리만 알리면 축소 미리보기가
   준비될 때 자리마다 1회뿐이다(업로드 시작·완료는 미리보기 주소를 바꾸지 않는다). */
it('10장 업로드는 미리보기가 실제로 바뀐 자리만 한 번씩 알리고 업로드 완료는 편집기를 다시 그리지 않는다', async () => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
  const empty = { ...props, initialPaths: [], initialUrls: [] };
  const renderEmpty = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return GoodsImageGrid(empty); };
  renderEmpty(); effects(); auth(); mocks.preview.mockClear();
  let blob = 0; vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:${++blob}`);
  let uploaded = 0; mocks.upload.mockImplementation(async () => ({ ok: true, imagePath: `public-media/catalog/good/99000000-0000-4000-8000-0000000001${String(++uploaded).padStart(2, '0')}.png` }));
  const files = Array.from({ length: 10 }, (_, index) => new File([`f${index}`], `f${index}.png`, { type: 'image/png' }));
  const input = all(renderEmpty()).find(item => item.type === 'input' && item.props['aria-label'] === '대표 이미지 추가')!;
  (input.props as unknown as { onChange: (event: unknown) => void }).onChange({ currentTarget: { files, value: 'x' } });
  for (let i = 0; i < 400; i++) await Promise.resolve();
  expect(mocks.upload).toHaveBeenCalledTimes(10);
  const paths = all(renderEmpty()).filter(item => item.type === 'input' && typeof item.props.name === 'string' && /^(imagePath|galleryPath\d)$/.test(item.props.name)).map(item => item.props.value);
  expect(paths.filter(Boolean)).toHaveLength(10);
  expect(mocks.preview).toHaveBeenCalledTimes(10);
  expect(mocks.preview.mock.calls.map(([, url]) => url)).toEqual(Array.from({ length: 10 }, (_, index) => `blob:${index + 1}`));
  /* R20: 직접 고른 파일은 NFC 이름으로 사진 보관함 등록을 함께 요청한다. */
  expect(mocks.upload.mock.calls.map(([input]) => input.library)).toEqual(files.map(file => ({ name: file.name })));
});

it('macOS NFD 파일 이름은 NFC로 등록을 요청하고, 보관함 등록 실패는 업로드를 실패로 만들지 않는다', async () => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
  const empty = { ...props, initialPaths: [], initialUrls: [] };
  const renderEmpty = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return GoodsImageGrid(empty); };
  renderEmpty(); effects(); auth();
  mocks.upload.mockResolvedValue({ ok: true, imagePath: replacement, library: { ok: false, error: 'x' } });
  const nfd = '메이플 키링.png'.normalize('NFD');
  const input = all(renderEmpty()).find(item => item.type === 'input' && item.props['aria-label'] === '대표 이미지 추가')!;
  (input.props as unknown as { onChange: (event: unknown) => void }).onChange({ currentTarget: { files: [new File(['a'], nfd, { type: 'image/png' })], value: 'x' } });
  for (let i = 0; i < 60; i++) await Promise.resolve();
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ library: { name: '메이플 키링.png'.normalize('NFC') } }));
  expect(all(renderEmpty()).find(item => item.type === 'input' && item.props.name === 'imagePath')?.props.value).toBe(replacement);
  expect(text(renderEmpty())).toContain('사진 보관함에 등록하지 못한 사진이 있습니다.');
  expect(text(renderEmpty())).toContain('업로드 완료 · 사진 보관함 등록 실패 · 상품 저장 전입니다.');
});

it('미리보기가 준비되기 전에 지운 타일에는 늦게 온 미리보기를 붙이지 않고 해제한다', async () => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
  const withMain = { ...props, initialPaths: [original], initialUrls: ['https://example.test/original.png'] };
  const renderMain = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return GoodsImageGrid(withMain); };
  renderMain(); effects(); auth();
  mocks.upload.mockImplementation(() => new Promise(() => {}));
  vi.mocked(URL.createObjectURL).mockImplementation(() => 'blob:late');
  const add = all(renderMain()).find(item => item.type === 'input' && item.props['aria-label'] === '이미지 추가 (추가 이미지, 여러 장 선택 가능)')!;
  (add.props as unknown as { onChange: (event: unknown) => void }).onChange({ currentTarget: { files: [new File(['b'], 'b.png', { type: 'image/png' })], value: 'x' } });
  expect(text(renderMain())).toContain('미리보기 준비 중…');
  all(renderMain()).find(item => item.type === 'button' && item.props['aria-label'] === '추가 이미지 1 삭제')?.props.onClick?.();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');
  expect(all(renderMain()).filter(item => item.type === 'img').map(item => (item.props as { src?: string }).src)).toEqual(['https://example.test/original.png']);
});

/*
 * 화면 규칙 2·6: 사진 보관함에서 고르기. 예전에는 한 장 고를 때마다 창이 닫혔고(추가 이미지 9장에 9번 열었다),
 * 이미 넣은 사진이나 자리가 없을 때는 고른 뒤 창을 닫고 나서 거절했다.
 */
type LibraryPhoto = { id: string; name: string; imagePath: string; revision: number; archived: boolean; createdAt: string; references: never[] };
type Picker = ReactElement<{ multiple?: boolean; pickedPaths?: readonly string[]; remaining?: number; nextIsMain?: boolean; onClose: () => void; onSelect: (photo: LibraryPhoto) => void;
  placeOf: (photo: LibraryPhoto) => string | null; deselectBlocked: (photo: LibraryPhoto) => string | null; onDeselect: (photo: LibraryPhoto) => void }>;
const picker = () => all(render()).find(item => item.type === GoodsPhotoPicker) as Picker | undefined;
const libraryPath = (index: number) => `public-media/catalog/good/99000000-0000-4000-8000-0000000003${String(index).padStart(2, '0')}.png`;
const libraryPhoto = (index: number): LibraryPhoto => ({ id: `99000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`, name: `보관함 사진 ${index}`, imagePath: libraryPath(index), revision: 1, archived: false, createdAt: '2026-11-25T00:00:00Z', references: [] });
const submitted = () => all(render()).filter(item => item.type === 'input' && typeof item.props.name === 'string' && /^(imagePath|galleryPath\d)$/.test(item.props.name)).map(item => item.props.value).filter(Boolean);

it('사진 보관함에서 여러 장을 이어서 고르고, 이미 넣은 사진과 남은 자리를 창에 넘긴다', () => {
  expect(picker()).toBeUndefined();
  button('사진 보관함에서 고르기').props.onClick?.();
  expect(picker()?.props).toMatchObject({ multiple: true, pickedPaths: [original], remaining: 9 });
  picker()!.props.onSelect(libraryPhoto(1));
  picker()!.props.onSelect(libraryPhoto(2));
  /* 고른 뒤에도 창은 열려 있고, 고른 사진은 빈 자리에 차례로 들어간다. */
  expect(picker()?.props).toMatchObject({ pickedPaths: [original, libraryPath(1), libraryPath(2)], remaining: 7 });
  expect(submitted()).toEqual([original, libraryPath(1), libraryPath(2)]);
  expect(text(render())).toContain('추가 이미지 2에 보관함 사진을 넣었습니다. 상품 저장 전입니다.');
  /* 빠르게 두 번 누른 같은 사진은 한 번만 넣는다. 창을 닫거나 거절 안내를 띄우지 않는다. */
  picker()!.props.onSelect(libraryPhoto(2));
  expect(submitted()).toEqual([original, libraryPath(1), libraryPath(2)]);
  expect(picker()?.props.remaining).toBe(7);
  expect(text(render())).not.toContain('이미 선택한 사진입니다');
  /* [완료]를 눌러야 닫힌다. */
  picker()!.props.onClose();
  expect(picker()).toBeUndefined();
});

it('10장을 채우면 창에 남은 자리 0장을 넘기고, 닫은 뒤에는 고르기 버튼이 잠긴다', () => {
  button('사진 보관함에서 고르기').props.onClick?.();
  for (let index = 1; index <= 9; index++) picker()!.props.onSelect(libraryPhoto(index));
  expect(picker()?.props.remaining).toBe(0);
  expect(submitted()).toHaveLength(10);
  /* 창이 [선택]을 잠그므로 더 오지 않지만, 와도 넣지 않는다. */
  picker()!.props.onSelect(libraryPhoto(10));
  expect(submitted()).toEqual([original, ...Array.from({ length: 9 }, (_, index) => libraryPath(index + 1))]);
  expect(text(render())).not.toContain('상품 이미지는 최대 10장입니다');
  picker()!.props.onClose();
  expect(button('사진 보관함에서 고르기').props.disabled).toBe(true);
});

/*
 * G8(2026-11-25 리뷰): 사진은 첫 빈 칸에 들어가는데 창 안에서는 어느 칸인지 알 수 없었고, 잘못 고르면 창을 닫고 이미지 칸의 ×로 빼야 했다.
 * 넣은 자리 이름을 창에 보이고, 창에서 넣은 사진은 창 안에서 [빼기]로 다시 뺀다. 원래 있던 이미지는 창에서 빼지 않는다.
 */
it('사진 보관함 창: 넣은 자리 이름을 보이고, 창에서 넣은 사진만 창 안에서 다시 뺀다', () => {
  button('사진 보관함에서 고르기').props.onClick?.();
  /* 대표 이미지가 이미 있으면 다음 사진이 대표 이미지가 된다고 말하지 않는다. */
  expect(picker()?.props.nextIsMain).toBe(false);
  picker()!.props.onSelect(libraryPhoto(1));
  picker()!.props.onSelect(libraryPhoto(2));
  const existing = { ...libraryPhoto(9), imagePath: original };
  expect(picker()!.props.placeOf(existing)).toBe('대표 이미지');
  expect([picker()!.props.placeOf(libraryPhoto(1)), picker()!.props.placeOf(libraryPhoto(2)), picker()!.props.placeOf(libraryPhoto(3))]).toEqual(['추가 이미지 1', '추가 이미지 2', null]);
  /* 창을 열기 전부터 있던 이미지는 [빼기]가 없다(까닭 글 없이 버튼만 없다). 창에서 넣은 사진은 뺄 수 있다. */
  expect(picker()!.props.deselectBlocked(existing)).toBe('');
  expect(picker()!.props.deselectBlocked(libraryPhoto(1))).toBeNull();
  picker()!.props.onDeselect(existing);
  expect(submitted()).toEqual([original, libraryPath(1), libraryPath(2)]);
  /* 첫 사진을 빼면 뒤의 사진이 앞으로 당겨지고, 창의 남은 자리와 자리 이름도 따라 바뀐다. */
  picker()!.props.onDeselect(libraryPhoto(1));
  expect(submitted()).toEqual([original, libraryPath(2)]);
  expect(picker()?.props).toMatchObject({ pickedPaths: [original, libraryPath(2)], remaining: 8 });
  expect(picker()!.props.placeOf(libraryPhoto(2))).toBe('추가 이미지 1');
  expect(text(render())).toContain('추가 이미지 1에 넣은 보관함 사진을 뺐습니다.');
  /* 뺀 사진은 다시 고를 수 있다. */
  picker()!.props.onSelect(libraryPhoto(1));
  expect(submitted()).toEqual([original, libraryPath(2), libraryPath(1)]);
});

it('사진 보관함 창: 대표 이미지 칸이 비어 있으면 미리 알리고, 공개 중인 상품의 대표 이미지는 창에서도 빼지 않고 까닭을 적는다', () => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.changed = [];
  const view = (publication: 'draft' | 'published') => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return all(GoodsImageGrid({ ...props, initialPaths: [], initialUrls: [], publication })); };
  const opened = (publication: 'draft' | 'published') => view(publication).find(item => item.type === GoodsPhotoPicker) as Picker;
  view('published').find(item => item.type === 'button' && text(item) === '사진 보관함에서 고르기')!.props.onClick?.();
  expect(opened('published').props).toMatchObject({ nextIsMain: true, remaining: 10 });
  opened('published').props.onSelect(libraryPhoto(1));
  expect(opened('published').props.nextIsMain).toBe(false);
  expect(opened('published').props.placeOf(libraryPhoto(1))).toBe('대표 이미지');
  /* 공개 중인 상품의 대표 이미지는 교체만 한다(이미지 칸에도 ×가 없다). 창에서 넣었어도 빼지 않는다. */
  expect(opened('published').props.deselectBlocked(libraryPhoto(1))).toBe('공개 중이라 뺄 수 없음');
  opened('published').props.onDeselect(libraryPhoto(1));
  expect(opened('published').props.placeOf(libraryPhoto(1))).toBe('대표 이미지');
  /* 초안 상품은 대표 이미지도 뺄 수 있다. */
  expect(opened('draft').props.deselectBlocked(libraryPhoto(1))).toBeNull();
  opened('draft').props.onDeselect(libraryPhoto(1));
  expect(opened('draft').props).toMatchObject({ nextIsMain: true, remaining: 10 });
});
