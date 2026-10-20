import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], memos: [] as { value: unknown; deps: unknown[] }[], effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), save: vi.fn(), archive: vi.fn(), portal: vi.fn((child: unknown) => child), unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => {
  const effect = (callback: () => void | (() => void), deps: unknown[] = []) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects[index] = { deps, effect: callback, cleanup: previous?.cleanup }; hooks.changed.push(index); }
  };
  return { ...await vi.importActual<typeof import('react')>('react'),
    useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
    useMemo: (fn: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, n) => dep !== hooks.memos[i].deps[n])) hooks.memos[i] = { value: fn(), deps }; return hooks.memos[i].value; },
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(), useEffect: effect, useLayoutEffect: effect,
  };
});
vi.mock('react-dom', () => ({ createPortal: mocks.portal }));
vi.mock('@/app/admin/body-template-actions', () => ({ listBodyTemplatesAction: mocks.list, readBodyTemplateAction: mocks.read, saveBodyTemplateAction: mocks.save, archiveBodyTemplateAction: mocks.archive }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { BodyTemplateTools } from './BodyTemplateTools';
import type { BodyTemplateEditorTarget } from '@/lib/admin/body-templates';
type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const id = '94000000-0000-4000-8000-000000000001';
const row = { id, name: '배송 안내', revision: 1, archivedAt: null, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', characterCount: 12, bodyHtml: '<p>배송 안내</p>', warnings: [] };
let props: Parameters<typeof BodyTemplateTools>[0], body: string, apply: ReturnType<typeof vi.fn<BodyTemplateEditorTarget['apply']>>;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
function render() { hooks.stateIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return BodyTemplateTools(props); }
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
function button(label: string) { return all(render()).find(item => item.type === 'button' && text(item) === label)!; }
function click(label: string) { const item = button(label); expect(item).toBeDefined(); expect(item.props.disabled).not.toBe(true); (item.props.onClick as () => void)(); }
function change(label: string, value: string) { const item = all(render()).find(node => node.type === 'label' && text(node).startsWith(label))!; const field = all(item).find(node => node.type === 'input' || node.type === 'textarea')!; (field.props.onChange as (event: unknown) => void)({ target: { value } }); }
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); render(); effects(); }
function auth(actor = 'actor', session = '99000000-0000-4000-8000-000000000010') { mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` }); }
beforeEach(() => {
  hooks.states = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; vi.clearAllMocks();
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', { body: {} });
  mocks.list.mockResolvedValue({ ok: true, value: { rows: [row], total: 1, archivedCount: 0, limit: 50 } }); mocks.read.mockResolvedValue({ ok: true, value: row }); mocks.save.mockResolvedValue({ ok: true, value: { ...row, revision: 2 } });
  body = '<p>현재 본문</p><img src="https://example.com/image.png">';
  apply = vi.fn<BodyTemplateEditorTarget['apply']>((html, mode) => { body = mode === 'insert' ? body + html : html; return { ok: true, bodyHtml: body }; });
  props = { accountId: 'actor', surface: 'goods', disabled: false, captureEditor: () => ({ bodyHtml: body, apply }) };
  render(); effects(); auth();
});
afterEach(() => { for (const item of hooks.effects) item.cleanup?.(); vi.unstubAllGlobals(); });
async function selected() { click('개인 본문 템플릿'); await flush(); click('배송 안내12자 · 버전 1'); await flush(); }
it('선택·미리보기는 본문을 바꾸지 않으며 전체 교체 확인과 직전 이미지 복구를 분리한다', async () => {
  const original = body; await selected(); expect(apply).not.toHaveBeenCalled();
  click('본문 전체 바꾸기'); expect(apply).not.toHaveBeenCalled(); click('확인하고 본문 전체 바꾸기'); expect(body).toBe(row.bodyHtml);
  click('직전 템플릿 적용 되돌리기'); expect(body).toBe(original); expect(apply).toHaveBeenLastCalledWith(original, 'replace');
});
it('적용 후 새 본문 편집은 되돌리기가 덮어쓰지 않는다', async () => {
  await selected(); click('선택 위치에 넣기'); body += '<p>새 입력</p>'; click('직전 템플릿 적용 되돌리기');
  expect(body).toContain('새 입력'); expect(apply).toHaveBeenCalledTimes(1); expect(text(render())).toContain('자동 복구하지 않았습니다');
});
it('새 템플릿은 이미지를 제외하고 미저장 편집·불명확 요청을 reload로부터 보호한다', async () => {
  click('개인 본문 템플릿'); await flush(); click('현재 본문으로 새 템플릿'); change('템플릿 이름', '개인 안내'); render(); effects();
  expect(text(render())).not.toContain('https://example.com/image.png'); const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  mocks.save.mockResolvedValue({ ok: false, uncertain: true, error: '불명확' }); click('템플릿 등록'); await flush();
  const first = mocks.save.mock.calls[0][0]; expect(first.bodyHtml).toBe('<p>현재 본문</p>'); click('같은 요청으로 결과 확인'); await flush(); expect(mocks.save.mock.calls[1][0]).toBe(first);
});
it('저장 후 늦은 목록까지 단일 요청을 유지해 두 번째 저장·조회가 시작되지 않는다', async () => {
  await selected(); const list = deferred<unknown>(); mocks.list.mockReturnValueOnce(list.promise);
  click('템플릿 저장'); await flush(); expect(button('템플릿 저장').props.disabled).toBe(true); expect(button('최신 저장본 확인').props.disabled).toBe(true);
  expect(mocks.save).toHaveBeenCalledTimes(1); list.resolve({ ok: true, value: { rows: [{ ...row, revision: 2 }], total: 1, archivedCount: 0, limit: 50 } }); await flush(); expect(button('템플릿 저장').props.disabled).toBe(false);
});
it('오래된 버튼 callback도 진행 중인 두 번째 요청을 시작하지 않는다', async () => {
  await selected(); const stale = button('템플릿 저장'), pending = deferred<unknown>(); mocks.save.mockReturnValueOnce(pending.promise);
  (stale.props.onClick as () => void)(); (stale.props.onClick as () => void)(); expect(mocks.save).toHaveBeenCalledTimes(1);
  pending.resolve({ ok: false, uncertain: true, error: '불명확' }); await flush(); expect(button('같은 요청으로 결과 확인').props.disabled).toBe(false);
});
it.each(['account', 'session', 'signout', 'unmount'])('%s 뒤의 늦은 읽기 결과를 노출하지 않는다', async change => {
  const pending = deferred<unknown>(); mocks.read.mockReturnValueOnce(pending.promise); click('개인 본문 템플릿'); await flush(); click('배송 안내12자 · 버전 1');
  if (change === 'account') auth('other'); if (change === 'session') auth('actor', '99000000-0000-4000-8000-000000000011'); if (change === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  if (change === 'unmount') for (const item of hooks.effects) { item.cleanup?.(); item.cleanup = undefined; }
  pending.resolve({ ok: true, value: { ...row, name: '늦은 개인정보' } }); await flush(); expect(text(render())).not.toContain('늦은 개인정보'); expect(apply).not.toHaveBeenCalled();
});
it('모달을 닫았다가 다시 열어도 개인 편집은 보존하고 원문 대상은 새로 캡처한다', async () => {
  await selected(); change('템플릿 이름', '미저장 이름'); const dialog = all(render()).find(item => typeof item.props.onClose === 'function')!; (dialog.props.onClose as () => void)(); body = '<p>새 원문</p>';
  click('개인 본문 템플릿'); await flush(); const name = all(render()).find(item => item.type === 'input')!; expect(name.props.value).toBe('미저장 이름'); click('선택 위치에 넣기'); expect(body).toBe('<p>새 원문</p>' + row.bodyHtml);
});
