import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { blankGoodsAnnouncement, type GoodsAnnouncement } from '@/lib/admin/goods-announcements';
import { createCsEditorDraftStore } from '@/lib/admin/cs-editor-drafts';
import { parseGoodsAnnouncementPendingSave, retainGoodsAnnouncementPendingSave, type GoodsAnnouncementPendingSave } from '@/lib/admin/goods-announcement-pending';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], si: 0, ri: 0,
  effects: [] as (() => void | (() => void))[], layoutKey: undefined as unknown, cleanup: undefined as undefined | (() => void) }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), resolve: vi.fn(), store: null as unknown }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (next: unknown) => { hooks.states[i] = next; }]; },
  useRef: (initial: unknown) => hooks.refs[hooks.ri++] ?? (hooks.refs[hooks.ri - 1] = { current: initial }),
  useEffect: (fn: () => void | (() => void)) => { hooks.effects.push(fn); },
  useLayoutEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    if (hooks.layoutKey !== deps[0]) { hooks.cleanup?.(); hooks.cleanup = fn() || undefined; hooks.layoutKey = deps[0]; }
  },
  useTransition: () => [false, (work: () => Promise<void>) => { void work(); }],
}));
vi.mock('@/app/admin/goods-announcement-actions', () => ({ saveGoodsAnnouncementAction: mocks.save, resolveGoodsAnnouncementSaveAction: mocks.resolve }));
vi.mock('@/components/admin/useCsEditorDraft', () => ({ useCsEditorDraft: () => {
  const store = mocks.store as ReturnType<typeof createCsEditorDraftStore<GoodsAnnouncementPendingSave>>;
  return { ...store.getSnapshot(), ...store, getCurrentSnapshot: store.getSnapshot };
} }));
import { GoodsAnnouncementEditor } from './GoodsAnnouncementEditor';
const ACCOUNT = '00000000-0000-4000-8000-000000062210';
const ID = '00000000-0000-4000-8000-000000062211';
const OTHER = '00000000-0000-4000-8000-000000062212';
const SESSION = '00000000-0000-4000-8000-000000062213';
type EditorProps = { action: (form: FormData) => void; retry: () => void; resolve: () => void; uncertain: boolean; locked: boolean; canResolve: boolean;
  state: { outcome?: string; message?: string; errors?: Record<string, string>; reloadRequired?: boolean }; announcement: GoodsAnnouncement };
let rows: Map<string, string>;
let store: ReturnType<typeof createCsEditorDraftStore<GoodsAnnouncementPendingSave>>;
let failStorage: boolean;
function newStore(accountId = ACCOUNT, id = ID, sessionId = SESSION) {
  const storage = { get length() { return rows.size; }, key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { if (failStorage) throw new Error('quota'); rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
  store = createCsEditorDraftStore({ accountId, scope: 'goods-announcement-save', recordId: id, storage, parse: parseGoodsAnnouncementPendingSave, retainUntilResolved: retainGoodsAnnouncementPendingSave });
  store.authenticate(accountId, sessionId); mocks.store = store;
}
function form() {
  const value = new FormData();
  for (const [key, text] of Object.entries({ id: ID, revision: '0', popupRevision: '9', title: ' 최초 제목 ', body: '최초 입력\n둘째 줄 ', format: 'plain', category: 'general', device: 'all', enabled: 'true', important: 'false',
    allGoods: 'true', goodIds: '[]', usePeriod: 'false', useImportantPeriod: 'false', popupIntent: 'preserve' })) value.set(key, text);
  return value;
}
function flatten(node: ReactNode): ReactElement[] { return Array.isArray(node) ? node.flatMap(flatten) : isValidElement(node) ? [node, ...flatten((node.props as { children?: ReactNode }).children)] : []; }
function render(announcement = blankGoodsAnnouncement(ID), accountId = ACCOUNT) {
  hooks.si = 0; hooks.ri = 0; hooks.effects = [];
  const node = GoodsAnnouncementEditor({ announcement, accountId, backHref: '/admin/catalog/announcements' });
  const child = flatten(node).find(n => typeof (n.props as Partial<EditorProps>).retry === 'function');
  return { node, child, editor: child?.props as EditorProps };
}
function mount() {
  return render();
}
function unmount() { hooks.cleanup?.(); hooks.cleanup = undefined; hooks.layoutKey = undefined; }
function resetComponent() { hooks.states = []; hooks.refs = []; hooks.cleanup = undefined; hooks.layoutKey = undefined; }
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
beforeEach(() => { resetComponent(); rows = new Map(); failStorage = false; vi.clearAllMocks(); newStore(); });

it('네트워크 전에 원문을 보관하고 응답 유실 뒤 권한거절·결과 없음에도 최초 UUID와 입력을 유지한다', async () => {
  mocks.save.mockImplementationOnce(async (_state, outgoing: FormData) => {
    expect(store.getSnapshot().saved).toBe(true);
    expect(store.getSnapshot().value?.entries).toEqual([...outgoing.entries()]);
    return { outcome: 'unknown' };
  }).mockResolvedValueOnce({ outcome: 'rejected', errors: { form: '권한 거절' } }).mockResolvedValueOnce({ outcome: 'saved', saved: { ...blankGoodsAnnouncement(ID), revision: 1 } });
  mocks.resolve.mockResolvedValue({ outcome: 'unknown', errors: { form: '현재 결과 없음' } });
  const input = form(); render().editor.action(input); await settle();
  const fixed = mocks.save.mock.calls[0][1] as FormData; const entries = [...fixed.entries()];
  expect(fixed.get('operationId')).toMatch(/^[0-9a-f-]{36}$/); expect(fixed.get('accountId')).toBe(ACCOUNT); expect(render().editor.uncertain).toBe(true);
  input.set('body', '변경한 입력'); render().editor.retry(); await settle();
  expect(render().editor.uncertain).toBe(true); expect(mocks.save.mock.calls[1][1]).toBe(fixed);
  render().editor.resolve(); await settle(); expect(render().editor.uncertain).toBe(true);
  expect(mocks.resolve).toHaveBeenCalledWith(expect.any(Object), fixed.get('operationId'), ID, ACCOUNT);
  render().editor.retry(); await settle();
  expect([...fixed.entries()]).toEqual(entries); expect(render().editor.uncertain).toBe(false); expect(rows.size).toBe(0);
});

it('내부 이동이나 새로고침 뒤 명시 복구 전에는 편집/전송을 잠그고 같은 요청만 재시도한다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'unknown' });
  mount().editor.action(form()); await settle();
  const original = [...(mocks.save.mock.calls[0][1] as FormData).entries()];
  unmount(); resetComponent(); newStore();
  const reopened = mount(); expect(reopened.editor.uncertain).toBe(true); expect(reopened.editor.canResolve).toBe(false);
  reopened.editor.action(form()); reopened.editor.retry(); expect(mocks.save).toHaveBeenCalledTimes(1);
  const restore = flatten(reopened.node).find(node => node.type === 'button' && (node.props as { children?: string }).children === '고정된 저장 요청 복구')!;
  (restore.props as { onClick: () => void }).onClick();
  const restored = render(); expect(restored.editor.canResolve).toBe(true);
  expect(flatten(restored.node).some(node => node.type === 'dd' && (node.props as { children?: string }).children === '최초 입력\n둘째 줄 ')).toBe(true);
  restored.editor.retry(); await settle();
  expect([...(mocks.save.mock.calls[1][1] as FormData).entries()]).toEqual(original); expect(render().editor.uncertain).toBe(true);
});

it('첫 요청의 확인된 검증 거절만 고정을 풀고 다음 편집에 새 UUID를 사용한다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'rejected', errors: { title: '필수' } });
  render().editor.action(form()); await settle(); expect(render().editor.uncertain).toBe(false); expect(rows.size).toBe(0);
  const first = mocks.save.mock.calls[0][1].get('operationId');
  render().editor.action(form()); await settle(); expect(mocks.save.mock.calls[1][1].get('operationId')).not.toBe(first);
});

it('이전 저장 성공 뒤 새 요청의 통신이 실패하면 성공 문구를 지우고 미확인 상태만 표시한다', async () => {
  mocks.save.mockResolvedValueOnce({ outcome: 'saved', message: '이전 저장 성공', saved: { ...blankGoodsAnnouncement(ID), revision: 1 } })
    .mockRejectedValueOnce(new Error('offline'));
  render().editor.action(form()); await settle();
  expect(render().editor.state.message).toBe('이전 저장 성공');
  render().editor.action(form()); await settle();
  const pending = render().editor;
  expect(pending.state.message).toBeUndefined(); expect(pending.state.outcome).toBe('unknown');
  expect(pending.uncertain).toBe(true); expect(pending.announcement.revision).toBe(1);
  expect(store.getSnapshot().value).not.toBeNull();
});

it('요청 보관 실패 시 RPC를 보내지 않고 입력을 유지한다', async () => {
  failStorage = true; render().editor.action(form()); await settle();
  expect(mocks.save).not.toHaveBeenCalled(); expect(render().editor.state.errors?.form).toContain('서버에 보내지 않았습니다');
  expect(render().editor.uncertain).toBe(false); expect(store.getSnapshot().value).toBeNull();
});

it.each(['account', 'session'] as const)('늦은 응답은 %s 변경 뒤 상태와 저장소에 반영하지 않는다', async change => {
  let complete!: (value: unknown) => void; mocks.save.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  mount().editor.action(form()); const old = store;
  old.authenticate(change === 'account' ? OTHER : ACCOUNT, change === 'session' ? OTHER : SESSION);
  complete({ outcome: 'saved', saved: { ...blankGoodsAnnouncement(ID), revision: 1 } }); await settle();
  expect(hooks.states[0]).toEqual({}); expect(old.isActive()).toBe(false); expect(render().child).toBeUndefined();
});

it('화면을 떠난 뒤 도착한 성공 응답은 새 편집기나 보관 요청을 지우지 않는다', async () => {
  let complete!: (value: unknown) => void; mocks.save.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  mount().editor.action(form()); const pendingRequest = store.getSnapshot().value;
  unmount(); complete({ outcome: 'saved', saved: { ...blankGoodsAnnouncement(ID), revision: 1 } }); await settle();
  expect(store.getSnapshot().value).toEqual(pendingRequest); expect(hooks.states[0]).toEqual({});
  resetComponent(); newStore(); expect(mount().editor.uncertain).toBe(true);
});

it('다른 공지로 전환된 화면에 이전 대상의 늦은 저장 결과를 반영하지 않는다', async () => {
  let complete!: (value: unknown) => void; mocks.save.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  mount().editor.action(form()); const old = store; newStore(ACCOUNT, OTHER);
  render(blankGoodsAnnouncement(OTHER));
  complete({ outcome: 'saved', saved: { ...blankGoodsAnnouncement(ID), revision: 1 } }); await settle();
  expect(hooks.states[0]).toEqual({}); expect(old.getSnapshot().value).not.toBeNull(); expect(store.getSnapshot().value).toBeNull();
});

it('확정 저장 후 readback 실패의 재오픈은 상태가 남지 않는 일반 링크이고 새 화면은 편집 가능하다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'saved', savedId: ID, reloadRequired: true });
  render().editor.action(form()); await settle();
  const locked = render(); expect(locked.editor.state.reloadRequired).toBe(true); expect(rows.size).toBe(0);
  const fields = (locked.child!.type as (props: EditorProps) => ReactElement)(locked.editor);
  const link = flatten(fields).find(node => node.type === 'a' && (node.props as { children?: string }).children === '저장된 공지 다시 열기');
  expect((link?.props as { href?: string }).href).toBe(`/admin/catalog/announcements?edit=${ID}`);
  resetComponent(); newStore(); const fresh = render({ ...blankGoodsAnnouncement(ID), revision: 1 });
  expect(fresh.editor.state.reloadRequired).toBeUndefined(); expect(fresh.editor.locked).toBe(false); expect(fresh.editor.announcement.revision).toBe(1);
});

it('팝업 CAS 거절 후에도 submit 기본동작을 막아 선택과 기간·고정 intent를 함께 유지한다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'rejected', errors: { form: '다른 홈 팝업 설정이 먼저 저장됐습니다.' } });
  const fields = () => {
    const view = render();
    return (view.child!.type as (props: EditorProps) => ReactElement)(view.editor);
  };
  const initial = fields();
  const popupLabel = flatten(initial).find(node => node.type === 'label' && Array.isArray((node.props as { children?: ReactNode }).children)
    && ((node.props as { children: ReactNode[] }).children).includes('이 공지를 홈 팝업으로 표시'))!;
  const checkbox = flatten(popupLabel).find(node => node.type === 'input')!;
  (checkbox.props as { onChange: (event: { target: { checked: boolean } }) => void }).onChange({ target: { checked: true } });
  for (const [name, value] of [['popupStartsAt', '2026-10-14T09:00'], ['popupEndsAt', '2026-10-15T09:00']]) {
    const field = flatten(fields()).find(node => node.type === 'input' && (node.props as { name?: string }).name === name)!;
    (field.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value } });
  }
  const renderedForm = fields();
  type SubmitProps = { action?: unknown; onSubmit: (event: { preventDefault: () => void; currentTarget: FormData }) => void };
  const submit = renderedForm.props as SubmitProps;
  expect(submit.action).toBeUndefined(); expect(submit.onSubmit).toBeTypeOf('function');
  const values = form(); values.set('popupIntent', 'set'); values.set('popupStartsAt', '2026-10-14T09:00'); values.set('popupEndsAt', '2026-10-15T09:00');
  const NativeFormData = FormData;
  vi.stubGlobal('FormData', class extends NativeFormData {
    constructor(target?: FormData) { super(); if (target) for (const [key, value] of target) this.append(key, value); }
  });
  try {
    const preventDefault = vi.fn(); submit.onSubmit({ preventDefault, currentTarget: values }); await settle();
    expect(preventDefault).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][1].get('popupIntent')).toBe('set');
    const after = flatten(fields());
    const afterLabel = after.find(node => node.type === 'label' && Array.isArray((node.props as { children?: ReactNode }).children)
      && ((node.props as { children: ReactNode[] }).children).includes('이 공지를 홈 팝업으로 표시'))!;
    expect((flatten(afterLabel).find(node => node.type === 'input')!.props as { checked: boolean }).checked).toBe(true);
    expect((after.find(node => node.type === 'input' && (node.props as { name?: string }).name === 'popupStartsAt')!.props as { value: string }).value).toBe('2026-10-14T09:00');
    expect((after.find(node => node.type === 'input' && (node.props as { name?: string }).name === 'popupIntent')!.props as { value: string }).value).toBe('set');
  } finally { vi.unstubAllGlobals(); }
});
