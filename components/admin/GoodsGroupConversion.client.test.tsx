import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), jobs: [] as (() => void)[], pending: false }));
const mocks = vi.hoisted(() => ({ preview: vi.fn(), confirm: vi.fn(), read: vi.fn(), save: vi.fn(), archive: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = hooks.index++, previous = hooks.effects.get(index); if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects.set(index, { deps, cleanup: previous?.cleanup }); hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects.get(index)!.cleanup = effect() || undefined; }); } },
  useTransition: () => [hooks.pending, (action: () => Promise<void>) => { hooks.pending = true; void action().finally(() => { hooks.pending = false; }); }],
}));
vi.mock('@/app/admin/goods-group-actions', () => ({ previewGoodsGroupConversionAction: mocks.preview, confirmGoodsGroupConversionAction: mocks.confirm,
  readGoodsGroupOperationAction: mocks.read, saveGoodsGroupAction: mocks.save, archiveGoodsGroupAction: mocks.archive, readGoodsGroupAction: vi.fn(), readGoodsGroupSourceAction: vi.fn(), searchGoodsGroupProductsAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { GoodsGroupConversion } from './GoodsGroupConversion';
import { GoodsGroupEditor } from './GoodsGroupEditor';
import { GoodsGroupsScreen } from './screens/GoodsGroupsScreen';
import { GroupCompleted, GroupOperationStatus, GroupTable } from './GoodsGroupOperation';
import { AdminField, AdminFormGrid, AdminSectionCard, AdminStatusBadge } from './console/AdminKit';
import { goodsGroupRecoveryKey, type GoodsGroupRecovery } from '@/lib/admin/goods-groups';
import { groupTestGroup as group, groupTestId as id, groupTestIdentity as identity, groupTestPreview as preview, groupTestReceipt as receipt, groupTestSource as source } from '@/lib/admin/goods-groups.test-fixtures';

type Element = ReactElement<Record<string, unknown>>;
const pure = new Set<unknown>([GroupCompleted, GroupOperationStatus, GroupTable, AdminField, AdminFormGrid, AdminSectionCard, AdminStatusBadge]);
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => {
  if (!isValidElement<Record<string, unknown>>(value)) return [];
  if (pure.has(value.type)) return [value, ...nodes((value.type as (props: Record<string, unknown>) => ReactNode)(value.props))];
  return [value, ...nodes(value.props.children as ReactNode)];
});
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
let mode: 'convert' | 'editor' | 'list' = 'convert'; const storage = new Map<string, string>();
const storageApi = { get length() { return storage.size; }, key: (index: number) => [...storage.keys()][index] ?? null,
  getItem: vi.fn((key: string) => storage.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }), removeItem: vi.fn((key: string) => { storage.delete(key); }) };
class LinkTarget {
  constructor(readonly href: string, readonly target = '', readonly download = false) {}
  closest() { return this; }
  hasAttribute(name: string) { return name === 'download' && this.download; }
}
class DocumentTarget extends EventTarget {
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    // Node requires object-form capture to remove the browser-style listener.
    super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }
}
function navigate(href = '/admin', options: { target?: string; download?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) {
  const event = new Event('click', { cancelable: true });
  const { target, download, ...mouse } = options;
  Object.assign(event, { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, mouse);
  Object.defineProperty(event, 'target', { value: new LinkTarget(new URL(href, window.location.href).href, target, download) });
  document.dispatchEvent(event); return event;
}
function render() {
  hooks.index = 0;
  const result = mode === 'convert' ? GoodsGroupConversion({ initialSource: source, ...identity, actorId: identity.actorId })
    : mode === 'list' ? GoodsGroupsScreen({ initialGroup: null, initialPage: { rows: [group], page: 1, pageSize: 20, total: 1 }, ...identity })
      : GoodsGroupEditor({ initial: group, newGroupId: group.id, ...identity, actorId: identity.actorId });
  for (const job of hooks.jobs.splice(0)) job(); return nodes(result);
}
function remount() { for (const effect of hooks.effects.values()) effect.cleanup?.(); hooks.values = []; hooks.effects.clear(); hooks.jobs = []; hooks.pending = false; render(); authenticate(); }
async function flush() { for (let index = 0; index < 12; index += 1) { await Promise.resolve(); render(); } }
function click(label: string) { const button = render().find(node => node.type === 'button' && text(node) === label); expect(button, label).toBeDefined(); expect(button!.props.disabled, label).not.toBe(true); (button!.props.onClick as () => void)(); }
function submit() { const form = render().find(node => node.type === 'form')!; (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); }
function check(labelPart: string) { const label = render().find(node => node.type === 'label' && text(node).includes(labelPart))!; const checkbox = nodes(label).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } }); }
function authenticate(actorId = identity.actorId, sessionId = identity.sessionId) { mocks.auth?.('SIGNED_IN', { user: { id: actorId }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.x` }); }
function saved() { return JSON.parse([...storage.values()][0]) as GoodsGroupRecovery; }
async function ready() { submit(); await flush(); check('비교 내용과 미공개'); render(); }
beforeEach(async () => {
  mode = 'convert'; hooks.values = []; hooks.effects.clear(); hooks.jobs = []; hooks.pending = false; storage.clear(); vi.clearAllMocks();
  storageApi.getItem.mockImplementation(key => storage.get(key) ?? null); storageApi.setItem.mockImplementation((key, value) => { storage.set(key, value); });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storageApi, location: new URL('https://admin.test/admin/catalog/groups?id=test'), confirm: vi.fn(() => true) }));
  vi.stubGlobal('document', new DocumentTarget()); vi.stubGlobal('Element', LinkTarget);
  mocks.preview.mockResolvedValue({ value: preview }); mocks.confirm.mockResolvedValue({ error: '응답 유실', uncertain: true }); mocks.read.mockResolvedValue({ error: '조회 실패', uncertain: true });
  render(); authenticate(); await flush();
});
afterEach(() => { for (const effect of hooks.effects.values()) effect.cleanup?.(); vi.unstubAllGlobals(); });

describe('그룹 전환 화면 복구', () => {
  it('첫 상품번호 유지와 변경사항 비교 후 확인해야 한 번만 확정한다', async () => {
    expect(render().some(node => text(node).includes('기존 상품번호 유지'))).toBe(true); await ready(); click('이 내용으로 그룹 전환'); await flush();
    expect(mocks.confirm).toHaveBeenCalledOnce(); const metadata = saved(); expect(metadata).toMatchObject({ ...identity, version: 1, command: 'convert', previewId: preview.previewId, sourceGoodId: source.goodId });
    expect(Object.keys(metadata).sort()).toEqual(['version', 'actorId', 'sessionId', 'operationId', 'command', 'sourceGoodId', 'previewId'].sort());
    expect(render().find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
    expect(render().find(node => node.type === 'button' && text(node) === '이 내용으로 그룹 전환')!.props.disabled).toBe(true);
    expect(render().some(node => node.type === 'input' && node.props.value === source.name)).toBe(true);
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  });
  it('응답 유실 뒤 새로고침은 자동 재전송 없이 동일 내역만 조회한다', async () => {
    await ready(); click('이 내용으로 그룹 전환'); await flush(); const metadata = saved(); remount(); await flush();
    expect(mocks.confirm).toHaveBeenCalledOnce(); expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue({ value: { ...receipt, operationId: metadata.operationId } }); click('진행 내역 확인'); await flush();
    expect(mocks.read).toHaveBeenCalledWith(metadata, false); expect(mocks.confirm).toHaveBeenCalledOnce(); expect(storage.size).toBe(0);
    expect(render().some(node => text(node).includes('그룹상품 저장을 확인했습니다'))).toBe(true);
  });
  it('미확인 요청 종료도 전용 read/seal만 호출하고 다시 비교하기 전 확정하지 않는다', async () => {
    await ready(); click('이 내용으로 그룹 전환'); await flush(); const metadata = saved();
    mocks.read.mockResolvedValue({ value: { state: 'unresolved', operationId: metadata.operationId } }); click('진행 내역 확인'); await flush(); expect(storage.size).toBe(1);
    mocks.read.mockResolvedValue({ value: { state: 'sealed', operationId: metadata.operationId } }); click('이 요청 종료하고 다시 준비'); await flush();
    expect(mocks.read).toHaveBeenLastCalledWith(metadata, true); expect(mocks.confirm).toHaveBeenCalledOnce(); expect(storage.size).toBe(0);
    click('입력으로 돌아가 다시 비교'); await flush(); expect(render().some(node => node.type === 'button' && text(node) === '이 내용으로 그룹 전환')).toBe(false);
  });
  it.each(['actor', 'session'])('%s 교체 뒤 늦게 도착한 완료는 적용하거나 기록을 지우지 않는다', async kind => {
    let complete!: (value: unknown) => void; mocks.confirm.mockReturnValue(new Promise(resolve => { complete = resolve; })); await ready(); click('이 내용으로 그룹 전환'); await flush(); const metadata = saved();
    authenticate(kind === 'actor' ? id(99) : identity.actorId, kind === 'session' ? id(99) : identity.sessionId);
    complete({ value: { ...receipt, operationId: metadata.operationId } }); await flush(); expect(storage.size).toBe(1);
    expect(render().some(node => node.props.role === 'alert' && text(node).includes('로그인 상태'))).toBe(true); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('진행 내역 저장이 실패하면 서버 변환을 보내지 않는다', async () => {
    await ready(); storageApi.setItem.mockImplementation(() => { throw new Error('quota'); }); click('이 내용으로 그룹 전환'); await flush();
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(storage.size).toBe(0); expect(render().some(node => text(node).includes('실행하지 않았습니다'))).toBe(true);
  });
  it('다른 창의 진행 내역을 새 요청으로 덮어쓰지 않는다', async () => {
    await ready(); const metadata = { ...identity, version: 1, command: 'convert', sourceGoodId: source.goodId, previewId: preview.previewId, operationId: id(88) };
    storage.set(`${goodsGroupRecoveryKey(identity, 'convert')}:${metadata.operationId}`, JSON.stringify(metadata)); click('이 내용으로 그룹 전환'); await flush();
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(saved()).toEqual(metadata);
  });
});
describe('그룹 구성 화면', () => {
  it('그룹상품명 수정 후 공통 사이드바 이동을 취소하면 현재 입력을 유지한다', async () => {
    mode = 'editor'; remount(); await flush(); vi.mocked(window.confirm).mockReturnValue(false);
    const input = render().find(node => node.props.id === 'group-name')!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: '미저장 그룹상품명' } }); render();
    expect(navigate().defaultPrevented).toBe(true); expect(window.confirm).toHaveBeenCalledOnce();
    expect(render().find(node => node.props.id === 'group-name')!.props.value).toBe('미저장 그룹상품명'); expect(mocks.save).not.toHaveBeenCalled();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  });
  it('자체 취소 링크를 승인할 때 한 번만 확인하고 원래 값으로 복구하면 보호를 해제한다', async () => {
    mode = 'editor'; remount(); await flush();
    const input = render().find(node => node.props.id === 'group-name')!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: '미저장 그룹상품명' } });
    const cancel = render().find(node => node.props.onNavigate && text(node) === '취소')!;
    expect(navigate(String(cancel.props.href)).defaultPrevented).toBe(false);
    const preventDefault = vi.fn(); (cancel.props.onNavigate as (event: unknown) => void)({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled(); expect(window.confirm).toHaveBeenCalledOnce();
    (input.props.onChange as (event: unknown) => void)({ target: { value: group.name } }); render(); vi.mocked(window.confirm).mockClear();
    expect(navigate().defaultPrevented).toBe(false); expect(window.confirm).not.toHaveBeenCalled();
  });
  it('미저장 그룹에서도 새 탭·다운로드·수정키·중간 클릭·같은 문서 앵커를 허용한다', async () => {
    mode = 'editor'; remount(); await flush(); click('TEST 그룹 파랑 제외'); render();
    for (const options of [{ target: '_blank' }, { download: true }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) expect(navigate('/admin', options).defaultPrevented).toBe(false);
    expect(navigate(`${window.location.href}#details`).defaultPrevented).toBe(false); expect(window.confirm).not.toHaveBeenCalled();
  });
  it('목록에서 개별 상품을 펼치고 계정 변경 시 상세 링크를 감춘다', async () => {
    mode = 'list'; remount(); await flush();
    const toggle = render().find(node => node.type === 'button' && node.props['aria-label'] === `${group.name} 판매옵션 펼치기`)!;
    expect(toggle.props['aria-expanded']).toBe(false); (toggle.props.onClick as () => void)(); await flush();
    for (const member of group.members) expect(render().some(node => node.props.href === `/admin/catalog/goods?goodId=${encodeURIComponent(member.goodId)}` && text(node) === member.name)).toBe(true);
    authenticate(id(99)); await flush();
    expect(render().some(node => typeof node.props.href === 'string' && node.props.href.startsWith('/admin/catalog/goods?goodId='))).toBe(false);
  });
  it('제외만으로 상품을 합치지 않으며 승인된 구성 metadata와 입력을 분리한다', async () => {
    mode = 'editor'; remount(); await flush(); click('TEST 그룹 파랑 제외'); submit(); await flush(); check('변경 내용과 미공개'); render();
    mocks.save.mockResolvedValue({ error: '응답 유실', uncertain: true }); click('이 구성으로 저장'); await flush();
    expect(mocks.save).toHaveBeenCalledOnce(); const metadata = saved(); expect(metadata).toMatchObject({ command: 'update', groupId: group.id, expectedRevision: 1 });
    expect(metadata).not.toHaveProperty('members'); expect(mocks.save.mock.calls[0][1].members).toEqual([{ goodId: 'group-source', values: ['빨강'] }]);
  });
  it('전체 연결 해제는 별도 확인 후 archive 명령으로 처리한다', async () => {
    mode = 'editor'; remount(); await flush(); check('그룹 연결만 해제'); render(); mocks.archive.mockResolvedValue({ error: '응답 유실', uncertain: true }); click('그룹 연결 해제'); await flush();
    expect(mocks.archive).toHaveBeenCalledOnce(); expect(saved()).toMatchObject({ command: 'archive', groupId: group.id, expectedRevision: 1 }); expect(mocks.save).not.toHaveBeenCalled();
    const metadata = saved();
    mocks.read.mockResolvedValue({ value: { ...receipt, operationId: metadata.operationId, group: { ...group, revision: 2, archivedAt: '2026-10-14T09:00:00Z', members: [] } } });
    click('진행 내역 확인'); await flush();
    expect(render().some(node => text(node.props.children as ReactNode) === '공통정보 편집')).toBe(false);
  });
});
