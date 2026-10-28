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
  stale.props.onApply?.(file()); await settle(); expect(mocks.upload).not.toHaveBeenCalled(); expect(path()).toBe(original); expect(text(render())).toContain('로그인 계정 또는 세션이 변경');
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
   업로드 진행마다 다시 렌더됐다(시작 1회 + 완료 10회 = 11회 × 10자리 = 110회). 바뀐 자리만 알리면 시작 때 10회뿐이다. */
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
  expect(Math.max(...mocks.preview.mock.invocationCallOrder)).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
});
