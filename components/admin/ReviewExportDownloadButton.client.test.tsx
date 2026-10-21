import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), jobs: [] as (() => void)[] }));
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), click: vi.fn(), reset: vi.fn(), append: vi.fn(), remove: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn(),
  auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => {
  const effect = (run: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.index++, previous = hooks.effects.get(index);
    if (!previous || deps.length !== previous.deps.length || deps.some((dep, position) => dep !== previous.deps[position])) {
      hooks.effects.set(index, { deps, cleanup: previous?.cleanup });
      hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects.get(index)!.cleanup = run() || undefined; });
    }
  };
  return { ...await vi.importActual<typeof import('react')>('react'), useId: () => 'review-export-hint',
    useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
    useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
    useMemo: (create: () => unknown, deps: unknown[]) => { const index = hooks.index++, previous = hooks.values[index] as { value: unknown; deps: unknown[] } | undefined;
      if (!previous || deps.length !== previous.deps.length || deps.some((dep, position) => dep !== previous.deps[position])) hooks.values[index] = { value: create(), deps };
      return (hooks.values[index] as { value: unknown }).value; },
    useEffect: effect, useLayoutEffect: effect, useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => {
  mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } };
} } }) }));
import { EncryptedWorkbookDownloadButton, type EncryptedWorkbookRequestScope } from './EncryptedWorkbookDownloadButton';
import { ReviewExportDownloadButton } from './ReviewExportDownloadButton';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { reviewExportId as id } from '@/test/fixtures/review-export';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value)
  ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const runEffects = () => { for (const job of hooks.jobs.splice(0)) job(); };
const unmount = () => { for (const effect of hooks.effects.values()) effect.cleanup?.(); hooks.effects.clear(); };
const originalFormData = FormData;
let valid = true, passwords = { password: 'SyntheticQA-26!', passwordConfirmation: 'SyntheticQA-26!' };
const scope: EncryptedWorkbookRequestScope = { capture: () => valid ? () => valid : null };
function renderShared(requestScope: EncryptedWorkbookRequestScope | undefined = scope) {
  hooks.index = 0; const result = nodes(EncryptedWorkbookDownloadButton({ href: '/api/admin/reviews/export?sort=helpful_desc', label: '엑셀 다운로드', requestScope }));
  runEffects(); return result;
}
function open(requestScope: EncryptedWorkbookRequestScope | undefined = scope) {
  const button = renderShared(requestScope).find(node => node.type === 'button' && text(node) === '엑셀 다운로드')!;
  (button.props.onClick as () => void)(); return renderShared(requestScope);
}
function submit(requestScope: EncryptedWorkbookRequestScope | undefined = scope) {
  const form = renderShared(requestScope).find(node => node.type === 'form')!;
  return (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: { reset: mocks.reset } });
}
function response() {
  return new Response('encrypted', { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'x-icons-export-encryption': 'ECMA-376-Agile', 'x-icons-export-rows': '101', 'content-disposition': 'attachment; filename="icons-reviews.xlsx"' } });
}
beforeEach(() => {
  hooks.values = []; hooks.effects.clear(); hooks.jobs = []; hooks.index = 0; valid = true;
  vi.clearAllMocks(); vi.useFakeTimers(); passwords = { password: 'SyntheticQA-26!', passwordConfirmation: 'SyntheticQA-26!' };
  mocks.fetch.mockResolvedValue(response()); mocks.createUrl.mockReturnValue('blob:review-export');
  vi.stubGlobal('fetch', mocks.fetch); vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { body: { append: mocks.append }, createElement: () => ({ href: '', download: '', click: mocks.click, remove: mocks.remove }) });
  vi.stubGlobal('FormData', class extends originalFormData { constructor(form?: unknown) { super(); if (form) for (const [key, value] of Object.entries(passwords)) this.set(key, value); } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(mocks.createUrl); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mocks.revokeUrl);
});
afterEach(() => { unmount(); vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('리뷰에만 적용한 암호화 다운로드 lifetime', () => {
  it.each(['1234', 'A'.repeat(16)])('허용 길이의 암호 %s를 제출 즉시 비우고 검증된 파일 한 건만 다운로드한다', async password => {
    passwords = { password, passwordConfirmation: password };
    const inputs = open().filter(node => node.type === 'input' && node.props.type === 'password');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input.props).toMatchObject({ minLength: 4, maxLength: 16 });
    await submit();
    expect(mocks.reset.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetch.mock.invocationCallOrder[0]);
    expect(mocks.fetch).toHaveBeenCalledOnce(); expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: expect.any(AbortSignal) });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual(passwords);
    expect(mocks.click).toHaveBeenCalledOnce(); expect(mocks.createUrl).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000); expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:review-export');
  });
  it('암호 불일치도 먼저 비우며 네트워크 요청을 하지 않는다', async () => {
    passwords.passwordConfirmation = 'DifferentQA-2026!'; open(); await submit();
    expect(mocks.reset).toHaveBeenCalledOnce(); expect(mocks.fetch).not.toHaveBeenCalled(); expect(renderShared().some(node => node.props.role === 'alert' && text(node).includes('일치'))).toBe(true);
  });
  it('React 재렌더 전에 연속 submit되어도 요청은 한 번이다', async () => {
    let finish!: (value: Response) => void; mocks.fetch.mockReturnValue(new Promise(done => { finish = done; }));
    open(); const form = renderShared().find(node => node.type === 'form')!, send = form.props.onSubmit as (event: unknown) => Promise<void>;
    const event = { preventDefault() {}, currentTarget: { reset: mocks.reset } }, first = send(event), second = send(event);
    expect(mocks.fetch).toHaveBeenCalledOnce(); finish(response()); await Promise.all([first, second]); expect(mocks.click).toHaveBeenCalledOnce();
  });
  it('계정/세션/조건 범위가 바뀐 뒤 도착한 fetch 결과는 폐기한다', async () => {
    let finish!: (value: Response) => void; mocks.fetch.mockReturnValue(new Promise(done => { finish = done; }));
    open(); const task = submit(); valid = false; finish(response()); await task;
    expect(mocks.createUrl).not.toHaveBeenCalled(); expect(mocks.click).not.toHaveBeenCalled();
  });
  it('blob 읽기 도중 범위가 바뀌어도 다운로드를 만들지 않는다', async () => {
    let finish!: (value: Blob) => void; const result = response(); vi.spyOn(result, 'blob').mockReturnValue(new Promise(done => { finish = done; })); mocks.fetch.mockResolvedValue(result);
    open(); const task = submit(); await Promise.resolve(); valid = false; finish(new Blob(['encrypted'])); await task;
    expect(mocks.createUrl).not.toHaveBeenCalled(); expect(mocks.click).not.toHaveBeenCalled();
  });
  it('언마운트는 현재 AbortController를 중단하고 늦은 응답을 폐기한다', async () => {
    let finish!: (value: Response) => void; mocks.fetch.mockReturnValue(new Promise(done => { finish = done; }));
    open(); const task = submit(), signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal; unmount();
    expect(signal.aborted).toBe(true); finish(response()); await task; expect(mocks.click).not.toHaveBeenCalled();
  });
  it('scope를 사용하지 않는 기존 버튼은 기존 POST 계약을 유지한다', async () => {
    // Explicitly pass no scope; the review wrapper is the only opt-in caller.
    hooks.index = 0; const first = nodes(EncryptedWorkbookDownloadButton({ href: '/api/admin/gifts/export', label: '엑셀 다운로드' })); runEffects();
    (first.find(node => node.type === 'button')!.props.onClick as () => void)();
    hooks.index = 0; const next = nodes(EncryptedWorkbookDownloadButton({ href: '/api/admin/gifts/export', label: '엑셀 다운로드' })); runEffects();
    await (next.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: { reset: mocks.reset } });
    expect(mocks.fetch.mock.calls[0][0]).toBe('/api/admin/gifts/export'); expect(mocks.fetch.mock.calls[0][1].signal).toBeUndefined(); expect(mocks.click).toHaveBeenCalledOnce();
  });
});

function renderWrapper(accountId = id(10), href = '/api/admin/reviews/export?sort=recent') {
  hooks.index = 0; const result = nodes(ReviewExportDownloadButton({ accountId, href, total: 101 })); runEffects(); return result;
}
function authenticate(actor = id(10), session = id(20)) {
  mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` });
}
function downloadNode() { return renderWrapper().find(node => node.type === EncryptedWorkbookDownloadButton)!; }
describe('리뷰 화면·세션 범위', () => {
  it('세션 확인 전 비활성화하고 전체101건/상한 안내를 보여준다', () => {
    const first = renderWrapper(); expect(first.find(node => node.type === EncryptedWorkbookDownloadButton)!.props.disabled).toBe(true);
    expect(first.some(node => text(node).includes('전체 101건 · 최대 10,000건'))).toBe(true);
    authenticate(); expect(downloadNode().props.disabled).toBe(false);
  });
  it.each(['account', 'session', 'signout'])('%s 변경은 캡처한 응답을 무효화하고 버튼을 막는다', kind => {
    renderWrapper(); authenticate(); const old = downloadNode(), check = (old.props.requestScope as EncryptedWorkbookRequestScope).capture()!; expect(check()).toBe(true);
    if (kind === 'account') authenticate(id(11)); else if (kind === 'session') authenticate(id(10), id(21)); else window.dispatchEvent(new Event(INQUIRY_DRAFT_SIGN_OUT_EVENT));
    expect(check()).toBe(false); expect(downloadNode().props.disabled).toBe(true);
  });
  it('새 필터 렌더는 이전 응답 범위를 무효화하고 새 버튼으로 암호를 다시 받는다', () => {
    renderWrapper(); authenticate(); const old = downloadNode(), check = (old.props.requestScope as EncryptedWorkbookRequestScope).capture()!;
    const next = renderWrapper(id(10), '/api/admin/reviews/export?sort=helpful_desc').find(node => node.type === EncryptedWorkbookDownloadButton)!;
    expect(check()).toBe(false); expect(next.key).not.toBe(old.key); expect(next.props.disabled).toBe(false);
  });
});
