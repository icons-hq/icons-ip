import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankGoodsAnnouncement, type GoodsAnnouncement } from '@/lib/admin/goods-announcements';
import { createCsEditorDraftStore } from '@/lib/admin/cs-editor-drafts';
import { createGoodsAnnouncementPendingSave, parseGoodsAnnouncementPendingSave, retainGoodsAnnouncementPendingSave, type GoodsAnnouncementPendingSave } from '@/lib/admin/goods-announcement-pending';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], si: 0, ri: 0,
  effects: [] as (() => void | (() => void))[], layoutKey: undefined as unknown, cleanup: undefined as undefined | (() => void) }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), resolve: vi.fn(), store: null as unknown }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [hooks.states[i], (next: unknown) => { hooks.states[i] = next; }]; },
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
import { GoodChoiceCard } from '../GoodEditorParts';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
/* kit 입력도 네이티브 input과 같은 입력 부품으로 찾는다(ADR-0028). */
const isInput = (node: ReactElement) => node.type === 'input' || node.type === Input;
const ACCOUNT = '00000000-0000-4000-8000-000000062210';
const ID = '00000000-0000-4000-8000-000000062211';
const OTHER = '00000000-0000-4000-8000-000000062212';
const SESSION = '00000000-0000-4000-8000-000000062213';
type EditorProps = { action: (form: FormData) => void; retry: () => void; resolve: () => void; uncertain: boolean; locked: boolean; canResolve: boolean; pending: boolean; checking: boolean;
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
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
/** 편집 칸(EditorFields)까지 그린 트리. 같은 시험 안에서 다시 부르면 앞서 바꾼 상태가 반영된다. */
function fields(announcement?: GoodsAnnouncement, override: Partial<EditorProps> = {}) {
  const view = render(announcement);
  return (view.child!.type as (props: EditorProps) => ReactElement)({ ...view.editor, ...override });
}
const named = (tree: ReactElement, name: string) => flatten(tree).find(node => isInput(node) && (node.props as { name?: string }).name === name);
const valueOf = (tree: ReactElement, name: string) => (named(tree, name)?.props as { value?: string } | undefined)?.value;
const cards = (tree: ReactElement, name: string) => flatten(tree).filter(node => node.type === GoodChoiceCard && (node.props as { name?: string }).name === name)
  .map(node => node.props as { value: string; checked: boolean; title: string; description?: string; onChange: () => void });
const buttonLabels = (tree: ReactElement) => flatten(tree).filter(node => node.type === Button).map(node => (node.props as { children?: ReactNode }).children);
/** 저장 막대의 버튼(저장·저장됐는지 확인·다시 저장·기다리는 중)만. */
const saveBarButtons = (tree: ReactElement) => buttonLabels(tree).filter(label => typeof label === 'string' && /저장|확인 중/.test(label));
/** 트리에 적힌 글자 전부(칸 이름·카드 제목·설명·버튼 글자). 하위 부품은 펼치지 않으므로 넘긴 props의 글자를 모은다. */
const strings = (tree: ReactNode) => flatten(tree).flatMap(node => Object.values(node.props as Record<string, unknown>)
  .flatMap(value => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === 'string'));
const textOf = (tree: ReactNode, tag: string, marker: string) => flatten(tree).filter(node => node.type === tag && (node.props as Record<string, unknown>)['data-announcement'] === marker)
  .map(node => (node.props as { children?: ReactNode }).children);
const POPUP_LABEL = '이 공지를 홈 팝업으로 띄우기';
function popupCheckbox(tree: ReactElement) {
  const label = flatten(tree).find(node => node.type === 'label' && Array.isArray((node.props as { children?: ReactNode }).children)
    && ((node.props as { children: ReactNode[] }).children).includes(POPUP_LABEL))!;
  return flatten(label).find(node => isInput(node))!.props as { checked: boolean; onChange: (event: { target: { checked: boolean } }) => void };
}
function setInput(tree: ReactElement, name: string, value: string) {
  (named(tree, name)!.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value } });
}
/** 폼 제출을 흉내 낸다. 화면은 new FormData(form)으로 값을 읽으므로, 시험이 준 값을 그대로 복사하는 FormData로 바꿔 둔다. */
async function submitForm(tree: ReactElement, values: FormData) {
  const NativeFormData = FormData;
  vi.stubGlobal('FormData', class extends NativeFormData {
    constructor(target?: FormData) { super(); if (target) for (const [key, value] of target) this.append(key, value); }
  });
  try {
    const preventDefault = vi.fn();
    (tree.props as { onSubmit: (event: { preventDefault: () => void; currentTarget: FormData }) => void }).onSubmit({ preventDefault, currentTarget: values });
    await settle();
    return preventDefault;
  } finally { vi.unstubAllGlobals(); }
}
let confirmStub: ReturnType<typeof stubAdminConfirm> | null = null;
beforeEach(() => { resetComponent(); rows = new Map(); failStorage = false; vi.clearAllMocks(); newStore(); });
afterEach(() => { confirmStub?.restore(); confirmStub = null; });

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

/* 화면을 다시 열면 아무것도 보내지 않고 잠근다. 안내의 [저장됐는지 확인] 한 번으로 보관한 내용을 불러와 결과를 확인하고(읽기만),
   [다시 저장]은 불러온 내용이 화면에 보인 뒤에만 누를 수 있다. */
it('내부 이동이나 새로고침 뒤에는 잠그고, 저장됐는지 확인 한 번으로 불러와 확인한 뒤 같은 내용만 다시 저장한다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'unknown' });
  mocks.resolve.mockResolvedValue({ outcome: 'unknown', errors: { form: '아직 저장되지 않았습니다. [다시 저장]을 눌러 주세요.' } });
  mount().editor.action(form()); await settle();
  const original = [...(mocks.save.mock.calls[0][1] as FormData).entries()];
  unmount(); resetComponent(); newStore();
  const reopened = mount(); expect(reopened.editor.uncertain).toBe(true); expect(reopened.editor.canResolve).toBe(false);
  reopened.editor.action(form()); reopened.editor.retry(); reopened.editor.resolve();
  expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.resolve).not.toHaveBeenCalled();
  /* 잠긴 동안 저장 막대에는 누를 수 없는 버튼을 두지 않는다. 안내의 버튼 하나만 있다. */
  expect(saveBarButtons(fields())).toEqual([]);
  const checks = flatten(reopened.node).filter(node => node.type === Button && (node.props as { children?: string }).children === '저장됐는지 확인');
  expect(checks).toHaveLength(1);
  (checks[0].props as { onClick: () => void }).onClick(); await settle();
  expect(mocks.resolve).toHaveBeenCalledOnce();
  expect(mocks.resolve).toHaveBeenCalledWith(expect.any(Object), Object.fromEntries(original).operationId, ID, ACCOUNT);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  const restored = render(); expect(restored.editor.canResolve).toBe(true); expect(restored.editor.uncertain).toBe(true);
  expect(restored.editor.state.errors?.form).toBe('아직 저장되지 않았습니다. [다시 저장]을 눌러 주세요.');
  expect(flatten(restored.node).some(node => node.type === 'dd' && (node.props as { children?: string }).children === '최초 입력\n둘째 줄 ')).toBe(true);
  expect(saveBarButtons(fields())).toEqual(['저장됐는지 확인', '다시 저장']);
  restored.editor.retry(); await settle();
  expect([...(mocks.save.mock.calls[1][1] as FormData).entries()]).toEqual(original); expect(render().editor.uncertain).toBe(true);
});

it('다시 연 화면에서 저장됐는지 확인했더니 이미 저장돼 있으면 잠금을 풀고 저장된 공지를 보인다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'unknown' });
  mocks.resolve.mockResolvedValue({ outcome: 'saved', savedId: ID, message: '공지를 저장했습니다.', saved: { ...blankGoodsAnnouncement(ID), revision: 1, title: '최초 제목' } });
  mount().editor.action(form()); await settle();
  unmount(); resetComponent(); newStore();
  const reopened = mount();
  const check = flatten(reopened.node).find(node => node.type === Button && (node.props as { children?: string }).children === '저장됐는지 확인')!;
  (check.props as { onClick: () => void }).onClick(); await settle();
  const after = render();
  expect(after.editor.uncertain).toBe(false); expect(after.editor.announcement.title).toBe('최초 제목'); expect(rows.size).toBe(0);
  expect(saveBarButtons(fields())).toEqual(['저장']);
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

/* 결정 D3: 브라우저에 보관하지 못해도 저장을 막지 않는다. 한 줄 안내만 보인다. */
it('브라우저에 보관하지 못해도 저장을 보내고 한 줄 안내만 보인다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'saved', saved: { ...blankGoodsAnnouncement(ID), revision: 1 } });
  failStorage = true; render().editor.action(form()); await settle();
  expect(mocks.save).toHaveBeenCalledOnce(); expect(rows.size).toBe(0);
  const view = render(); expect(view.editor.uncertain).toBe(false); expect(view.editor.state.errors).toBeUndefined();
  expect(textOf(view.node, 'p', 'storage-unavailable')).toEqual(['이 브라우저에서는 화면을 떠났다 돌아오면 저장됐는지 다시 확인할 수 없습니다. 저장 결과가 나올 때까지 이 화면에 있어 주세요.']);
});

it('보관하지 못한 저장도 결과를 모르면 이 화면에서 바로 확인하거나 다시 저장할 수 있다', async () => {
  mocks.save.mockResolvedValueOnce({ outcome: 'unknown' }).mockResolvedValueOnce({ outcome: 'saved', saved: { ...blankGoodsAnnouncement(ID), revision: 1 } });
  mocks.resolve.mockResolvedValue({ outcome: 'unknown', errors: { form: '아직 저장되지 않았습니다.' } });
  failStorage = true; render().editor.action(form()); await settle();
  const fixed = mocks.save.mock.calls[0][1] as FormData;
  const pendingView = render(); expect(pendingView.editor.uncertain).toBe(true); expect(pendingView.editor.canResolve).toBe(true);
  pendingView.editor.resolve(); await settle();
  expect(mocks.resolve).toHaveBeenCalledWith(expect.any(Object), fixed.get('operationId'), ID, ACCOUNT);
  render().editor.retry(); await settle();
  expect(mocks.save.mock.calls[1][1]).toBe(fixed); expect(render().editor.uncertain).toBe(false);
});

it('보관에 실패해 한 줄 안내가 떠 있어도 편집을 잠그지 않는다', () => {
  const view = render();
  expect(textOf(view.node, 'p', 'storage-unavailable')).toEqual([]); expect(view.editor.locked).toBe(false);
  failStorage = true; expect(store.change(createGoodsAnnouncementPendingSave(form(), ACCOUNT, ID, OTHER)!)).toBe(true); store.discard();
  expect(store.getSnapshot().unavailable).toBe(true);
  const after = render();
  expect(textOf(after.node, 'p', 'storage-unavailable')).toHaveLength(1); expect(after.editor.locked).toBe(false); expect(after.editor.uncertain).toBe(false);
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
  mocks.save.mockResolvedValue({ outcome: 'rejected', errors: { form: '다른 사람이 홈 팝업을 먼저 바꿨습니다.' } });
  confirmStub = stubAdminConfirm(true);
  popupCheckbox(fields()).onChange({ target: { checked: true } });
  setInput(fields(), 'popupStartsAt', '2026-10-14T09:00'); setInput(fields(), 'popupEndsAt', '2026-10-15T09:00');
  const renderedForm = fields();
  const submit = renderedForm.props as { action?: unknown; onSubmit: unknown };
  expect(submit.action).toBeUndefined(); expect(submit.onSubmit).toBeTypeOf('function');
  const values = form(); values.set('popupIntent', 'set'); values.set('popupStartsAt', '2026-10-14T09:00'); values.set('popupEndsAt', '2026-10-15T09:00');
  const preventDefault = await submitForm(renderedForm, values);
  expect(preventDefault).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save.mock.calls[0][1].get('popupIntent')).toBe('set');
  const after = fields();
  expect(popupCheckbox(after).checked).toBe(true);
  expect(valueOf(after, 'popupStartsAt')).toBe('2026-10-14T09:00');
  expect(valueOf(after, 'popupIntent')).toBe('set');
});

/* 홈 팝업은 쇼핑몰에 하나뿐이다. 이 공지가 아직 팝업이 아닌데 켜서 저장하면 다른 공지의 팝업이 내려가므로 먼저 묻는다(화면 규칙 7). */
it('아직 홈 팝업이 아닌 공지를 팝업으로 켜서 저장하면 먼저 묻고, 취소하면 저장하지 않는다', async () => {
  confirmStub = stubAdminConfirm(false);
  popupCheckbox(fields()).onChange({ target: { checked: true } });
  setInput(fields(), 'popupStartsAt', '2026-10-14T09:00'); setInput(fields(), 'popupEndsAt', '2026-10-15T09:00');
  const values = form(); values.set('popupIntent', 'set'); values.set('popupStartsAt', '2026-10-14T09:00'); values.set('popupEndsAt', '2026-10-15T09:00');
  const preventDefault = await submitForm(fields(), values);
  expect(preventDefault).toHaveBeenCalledOnce(); expect(confirmStub).toHaveBeenCalledOnce();
  expect(confirmStub.mock.calls[0][0]).toContain('지금 홈 팝업으로 걸린 다른 공지가 있으면 내려갑니다');
  expect(mocks.save).not.toHaveBeenCalled(); expect(store.getSnapshot().value).toBeNull();
  expect(popupCheckbox(fields()).checked).toBe(true);
});

it('이미 홈 팝업인 공지의 기간만 바꾸거나 팝업을 켜지 않은 저장은 묻지 않는다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'rejected', errors: { title: '필수' } });
  confirmStub = stubAdminConfirm(false);
  const selected = { ...blankGoodsAnnouncement(ID), revision: 1, reference: 3, popup: { selected: true, revision: 4, startsAt: '2026-10-14T00:00:00.000Z', endsAt: '2026-10-15T00:00:00.000Z' } };
  setInput(fields(selected), 'popupEndsAt', '2026-10-16T09:00');
  const changed = fields(selected); expect(valueOf(changed, 'popupIntent')).toBe('set');
  await submitForm(changed, form());
  resetComponent(); newStore();
  await submitForm(fields(), form());
  expect(confirmStub).not.toHaveBeenCalled(); expect(mocks.save).toHaveBeenCalledTimes(2);
});

/* 중요 공지 기간은 중요 공지일 때만 열린다. 꺼 둔 채 넣은 기간이 저장만 되고 아무 일도 하지 않는 상태가 없다(화면 규칙 5). */
it('중요 공지 기간 칸은 기간 동안만을 골랐을 때만 열리고, 끄면 기간 없이 저장한다', () => {
  const initial = fields();
  expect(cards(initial, 'importantMode').map(card => [card.value, card.checked])).toEqual([['off', true], ['always', false], ['period', false]]);
  expect(valueOf(initial, 'important')).toBe('false'); expect(valueOf(initial, 'useImportantPeriod')).toBe('false');
  expect(named(initial, 'importantStartsAt')).toBeUndefined();
  cards(initial, 'importantMode').find(card => card.value === 'always')!.onChange();
  const always = fields();
  expect(valueOf(always, 'important')).toBe('true'); expect(valueOf(always, 'useImportantPeriod')).toBe('false'); expect(named(always, 'importantStartsAt')).toBeUndefined();
  cards(always, 'importantMode').find(card => card.value === 'period')!.onChange();
  const period = fields();
  expect(valueOf(period, 'important')).toBe('true'); expect(valueOf(period, 'useImportantPeriod')).toBe('true');
  expect((named(period, 'importantStartsAt')!.props as { required?: boolean }).required).toBe(true);
  expect((named(period, 'importantEndsAt')!.props as { required?: boolean }).required).toBe(true);
  expect(strings(period)).toEqual(expect.arrayContaining(['시작 (KST)', '종료 (KST)']));
  setInput(period, 'importantStartsAt', '2026-10-14T09:00');
  cards(fields(), 'importantMode').find(card => card.value === 'off')!.onChange();
  const off = fields();
  expect(valueOf(off, 'important')).toBe('false'); expect(valueOf(off, 'useImportantPeriod')).toBe('false'); expect(named(off, 'importantStartsAt')).toBeUndefined();
});

it('중요 공지를 끈 채 기간만 남아 있던 공지는 안 함으로 열리고, 화면 전용 선택값은 저장에 싣지 않는다', async () => {
  mocks.save.mockResolvedValue({ outcome: 'rejected', errors: { title: '필수' } });
  const stale = { ...blankGoodsAnnouncement(ID), revision: 1, reference: 3, important: false, importantStartsAt: '2026-10-14T00:00:00.000Z', importantEndsAt: '2026-10-15T00:00:00.000Z' };
  const opened = fields(stale);
  expect(cards(opened, 'importantMode').find(card => card.checked)?.value).toBe('off');
  expect(valueOf(opened, 'useImportantPeriod')).toBe('false'); expect(named(opened, 'importantStartsAt')).toBeUndefined();
  const kept = { ...stale, important: true };
  resetComponent(); newStore();
  expect(cards(fields(kept), 'importantMode').find(card => card.checked)?.value).toBe('period');
  const values = form(); values.set('importantMode', 'period');
  await submitForm(fields(kept), values);
  expect(mocks.save).toHaveBeenCalledOnce(); expect((mocks.save.mock.calls[0][1] as FormData).has('importantMode')).toBe(false);
});

/* 설명 문단 대신 선택 카드와 결과 한 줄이 말한다(글보다 화면). */
it('보이는 기기·보이는 자리·적용 상품은 선택 카드이고 저장 막대가 결과를 한 줄로 되읽는다', () => {
  const initial = fields();
  expect(cards(initial, 'device').map(card => card.title)).toEqual(['PC·모바일', 'PC', '모바일']);
  expect(cards(initial, 'placement').map(card => [card.title, card.checked])).toEqual([['상세 상단', true], ['상세 하단', false]]);
  expect(cards(initial, 'allGoods').map(card => [card.title, card.checked])).toEqual([['전체 상품', true], ['선택 상품', false]]);
  /* 이름만으로 알 수 있는 선택지(PC·모바일, 중요 공지 안 함)에는 설명을 달지 않는다. 나머지는 고르면 어떻게 보이는지 한 줄이다. */
  expect(cards(initial, 'device').map(card => card.description)).toEqual([undefined, 'PC처럼 넓은 화면에서만 보입니다.', '휴대폰처럼 좁은 화면에서만 보입니다.']);
  expect(cards(initial, 'importantMode').map(card => Boolean(card.description))).toEqual([false, true, true]);
  for (const card of [...cards(initial, 'placement'), ...cards(initial, 'allGoods')]) expect(card.description).toMatch(/보입니다\./);
  expect(textOf(initial, 'p', 'outcome')).toEqual(['전시중지라 저장해도 고객에게 보이지 않습니다.']);
  cards(initial, 'placement').find(card => card.value === 'bottom')!.onChange();
  cards(initial, 'device').find(card => card.value === 'pc')!.onChange();
  const shown = fields({ ...blankGoodsAnnouncement(ID) });
  expect(cards(shown, 'placement').find(card => card.checked)?.value).toBe('bottom');
  const text = strings(shown).join('\n');
  for (const label of ['보이는 기기', '보이는 자리', '중요 공지', '전시 여부', '전시 기간', '홈 팝업', '적용 상품']) expect(text).toContain(label);
  for (const old of ['노출', '상품찾기', '번째 저장', '저장 결과 확인', '같은 요청', '일시']) expect(text).not.toContain(old);
});

/* G3(2026-11-25 리뷰): 지난달 끝난 공지를 '전시'로 저장하려 할 때 날짜만 읽어 주면 '저장하면 보인다'로 읽힌다. 목록은 그 공지를 전시중지로 보인다. */
it('전시 기간이 이미 지난 공지는 결과 한 줄이 저장해도 보이지 않는다고 말하고, 종료를 늦추면 다시 날짜를 읽는다', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T03:00:00Z'));
  try {
    const ended = { ...blankGoodsAnnouncement(ID), revision: 3, enabled: true, startsAt: '2026-11-01T01:00:00Z', endsAt: '2026-11-20T14:59:00Z' };
    expect(textOf(fields(ended), 'p', 'outcome')).toEqual(['전시 기간이 끝나 저장해도 고객에게 보이지 않습니다. 다시 보이려면 종료를 늦춰 주세요.']);
    setInput(fields(ended), 'endsAt', '2026-12-20T23:59');
    expect(textOf(fields(ended), 'p', 'outcome')).toEqual(['저장하면 2026년 11월 1일 10:00부터 12월 20일 23:59까지 공개된 모든 상품의 상세 상단에 보입니다.']);
  } finally { vi.useRealTimers(); }
});

it('결과를 모를 때는 저장됐는지 확인·다시 저장만 보이고 결과 한 줄은 숨긴다', async () => {
  mocks.save.mockRejectedValue(new Error('offline'));
  render().editor.action(form()); await settle();
  const view = render(); expect(view.editor.state.errors?.form).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]으로 먼저 확인하고, 저장되지 않았으면 [다시 저장]을 누릅니다. 같은 내용이 두 번 저장되지 않습니다.');
  const tree = fields();
  expect(saveBarButtons(tree)).toEqual(['저장됐는지 확인', '다시 저장']);
  expect(textOf(tree, 'p', 'outcome')).toEqual([]);
  expect(flatten(view.node).some(node => node.type === 'summary' && (node.props as { children?: string }).children === '앞서 저장하려던 내용')).toBe(true);
  expect(saveBarButtons(fields(undefined, { pending: true, checking: true }))).toEqual(['확인 중…']);
  expect(saveBarButtons(fields(undefined, { pending: true, checking: false }))).toEqual(['저장 중…']);
});

it('저장 버튼은 폼 제출이고 결과 확인·재저장은 제출하지 않는다(kit 버튼의 기본 type은 button)', () => {
  const view = render();
  const fields = (view.child!.type as (props: EditorProps) => ReactElement)(view.editor);
  const save = flatten(fields).find(node => node.type === Button && (node.props as { children?: ReactNode }).children === '저장');
  expect((save?.props as { type?: string } | undefined)?.type).toBe('submit');
  const pending = (view.child!.type as (props: EditorProps) => ReactElement)({ ...view.editor, uncertain: true, canResolve: true });
  expect(saveBarButtons(pending)).toEqual(['저장됐는지 확인', '다시 저장']);
  const types = flatten(pending).filter(node => node.type === Button).map(node => (node.props as { type?: string }).type);
  expect(types).not.toContain('submit');
});
