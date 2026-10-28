import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: new Map<number, { deps: unknown[]; cleanup?: () => void }>(), jobs: [] as (() => void)[], pending: false }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = hooks.index++, previous = hooks.effects.get(index); if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects.set(index, { deps, cleanup: previous?.cleanup }); hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects.get(index)!.cleanup = effect() || undefined; }); } },
  useTransition: () => [hooks.pending, (action: () => Promise<void>) => { hooks.pending = true; void action().finally(() => { hooks.pending = false; }); }],
}));
vi.mock('@/app/admin/goods-group-common-actions', () => ({ saveGoodsGroupCommonAction: mocks.save }));
vi.mock('@/app/admin/goods-group-actions', () => ({ readGoodsGroupOperationAction: mocks.read, readGoodsGroupSourceAction: vi.fn(), searchGoodsGroupProductsAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
import { GoodsGroupCommonEditor } from './GoodsGroupCommonEditor';
import { GoodsAttributeEditor } from './GoodsAttributeEditor';
import { GroupCompleted, GroupOperationStatus } from './GoodsGroupOperation';
import { AdminSectionCard } from './console/AdminKit';
import { TextArea } from './fields';
import { commonTestForm, commonTestSnapshot, commonTestReceipt } from '@/lib/admin/goods-group-common.test-fixtures';
import { groupTestIdentity as identity, groupTestId as id } from '@/lib/admin/goods-groups.test-fixtures';
import { goodsGroupRecoveryKey, type GoodsGroupRecovery } from '@/lib/admin/goods-groups';

type Element = ReactElement<Record<string, unknown>>;
const pure = new Set<unknown>([GroupCompleted, GroupOperationStatus, AdminSectionCard]);
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => {
  if (!isValidElement<Record<string, unknown>>(value)) return [];
  if (pure.has(value.type)) return [value, ...nodes((value.type as (props: Record<string, unknown>) => ReactNode)(value.props))];
  return [value, ...nodes(value.props.children as ReactNode)];
});
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const storage = new Map<string,string>(), originalFormData = FormData;
const storageApi = { get length() { return storage.size; }, key: (index: number) => [...storage.keys()][index] ?? null,
  getItem: vi.fn((key: string) => storage.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { storage.set(key,value); }), removeItem: vi.fn((key: string) => { storage.delete(key); }) };
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
function render(snapshot = commonTestSnapshot()) { hooks.index = 0; const result = GoodsGroupCommonEditor({ snapshot, ...identity, categories: [], ips: [] }); for (const job of hooks.jobs.splice(0)) job(); return nodes(result); }
function authenticate(sessionId = identity.sessionId) { mocks.auth?.('SIGNED_IN', { user: { id: identity.actorId }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.x` }); }
async function flush() { for (let i=0;i<10;i+=1) { await Promise.resolve(); render(); } }
function remount() { for (const effect of hooks.effects.values()) effect.cleanup?.(); hooks.values=[]; hooks.effects.clear(); hooks.jobs=[]; hooks.pending=false; render(); authenticate(); }
function submit() { const form = render().find(node => node.type==='form')!; (form.props.onSubmit as (event: unknown)=>void)({ preventDefault() {}, currentTarget: {} }); }
function click(label: string) { const button = render().find(node => node.type==='button' && text(node)===label)!; expect(button).toBeDefined(); expect(button.props.disabled).not.toBe(true); (button.props.onClick as ()=>void)(); }
function saved() { return JSON.parse([...storage.values()][0]) as GoodsGroupRecovery; }
beforeEach(async () => {
  hooks.values=[]; hooks.effects.clear(); hooks.jobs=[]; hooks.pending=false; storage.clear(); vi.clearAllMocks();
  const submitted = [...commonTestForm().entries()]; submitted.push(['description','PRIVATE COMMON CONTENT']);
  vi.stubGlobal('FormData', class extends originalFormData { constructor(form?: unknown) { super(); if (form) for (const [key,value] of submitted) this.set(key,value); } });
  storageApi.setItem.mockImplementation((key,value)=>{storage.set(key,value);});
  vi.stubGlobal('window',Object.assign(new EventTarget(),{localStorage:storageApi, location: new URL('https://admin.test/admin/catalog/goods?groupCommon=test'), confirm: vi.fn(() => false)}));
  vi.stubGlobal('document', new DocumentTarget()); vi.stubGlobal('Element', LinkTarget);
  mocks.save.mockResolvedValue({error:'응답 유실',uncertain:true}); mocks.read.mockResolvedValue({error:'조회 실패',uncertain:true});
  render(); authenticate(); await flush();
  const attributes = render().find(node=>node.type===GoodsAttributeEditor)!;
  (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')),'[]',true); await flush();
});
afterEach(()=>{for(const effect of hooks.effects.values())effect.cleanup?.();vi.unstubAllGlobals();});
describe('그룹 공통정보 편집 복구',()=>{
  it('미저장 공통정보를 두고 공통 사이드바로 이동할 때 취소하면 입력을 유지한다',()=>{
    const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
    (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')), '[]', false);
    render();
    expect(navigate().defaultPrevented).toBe(true); expect(window.confirm).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
    expect(render().find(node=>node.type==='fieldset')!.props.disabled).toBe(false);
  });
  it('일반 내부 링크 이동을 승인하면 자체 Link에서 중복 확인하지 않는다',()=>{
    const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
    (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')), '[]', false);
    vi.mocked(window.confirm).mockReturnValue(true);
    const cancel = render().find(node => node.props.onNavigate && text(node) === '취소')!;
    expect(navigate(String(cancel.props.href)).defaultPrevented).toBe(false);
    const preventDefault = vi.fn(); (cancel.props.onNavigate as (event: unknown)=>void)({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled(); expect(window.confirm).toHaveBeenCalledOnce();
  });
  it('새 탭·다운로드·수정키·중간 클릭·같은 문서 앵커는 보호창 없이 허용한다',()=>{
    const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
    (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')), '[]', false); render();
    for (const options of [{ target: '_blank' }, { download: true }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) expect(navigate('/admin', options).defaultPrevented).toBe(false);
    expect(navigate(`${window.location.href}#details`).defaultPrevented).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('저장 진행 중 내부 이동을 막고 저장 완료 후에는 이동 보호를 해제한다',async()=>{
    const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
    (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')), '[]', false);
    let resolve!: (value: unknown) => void;
    mocks.save.mockImplementation(() => new Promise(done => { resolve = done; })); submit(); render();
    expect(navigate().defaultPrevented).toBe(true); expect(window.confirm).not.toHaveBeenCalled();
    resolve({ value: { ...commonTestReceipt, operationId: saved().operationId } }); await flush();
    expect(navigate().defaultPrevented).toBe(false); expect(window.confirm).not.toHaveBeenCalled();
  });
  it('서버 재검증 뒤에도 완료 결과를 유지하고 다시 저장하지 않는다',async()=>{
    mocks.save.mockImplementation(async (metadata: GoodsGroupRecovery) => ({ value: { ...commonTestReceipt, operationId: metadata.operationId } }));
    submit(); await flush();
    const updated = commonTestSnapshot(); updated.group.revision += 1;
    const refreshed = render(updated);
    expect(refreshed.some(node => node.type === 'a' && text(node) === '최신 공통정보 다시 열기')).toBe(true);
    expect(refreshed.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
    submit(); await flush(); expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('다른 저장으로 서버 버전이 바뀌어도 미저장 입력의 기대 버전을 올리지 않는다',async()=>{
    const updated = commonTestSnapshot(); updated.group.revision += 1;
    const form = render(updated).find(node => node.type === 'form')!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {}, currentTarget: {} });
    await flush();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }), expect.any(FormData));
  });
  it('한 번의 원자적 action을 보내고 브라우저에는 payload를 보관하지 않는다',async()=>{
    submit(); await flush(); submit(); await flush(); expect(mocks.save).toHaveBeenCalledOnce();
    expect(saved()).toMatchObject({...identity,version:1,command:'common',groupId:commonTestSnapshot().group.id,expectedRevision:1});
    expect(Object.keys(saved()).sort()).toEqual(['actorId','sessionId','version','command','groupId','expectedRevision','operationId'].sort());
    expect([...storage.values()].join('')).not.toContain('PRIVATE COMMON CONTENT');
    expect(render().find(node=>node.type==='fieldset')!.props.disabled).toBe(true);
  });
  it('재접속은 자동 재전송 없이 같은 요청의 완료만 확인한다',async()=>{
    submit();await flush();const metadata=saved();remount();await flush();expect(mocks.save).toHaveBeenCalledOnce();expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue({value:{...commonTestReceipt,operationId:metadata.operationId}});click('진행 내역 확인');await flush();
    expect(mocks.read).toHaveBeenCalledWith(metadata,false);expect(storage.size).toBe(0);expect(render().find(node=>node.type==='fieldset')!.props.disabled).toBe(true);
    expect(render().some(node=>node.type==='a' && text(node)==='최신 공통정보 다시 열기')).toBe(true);
  });
  it('미확인 요청 종료는 seal만 호출하고 현재 입력을 자동으로 저장하지 않는다',async()=>{
    submit();await flush();const metadata=saved();mocks.read.mockResolvedValue({value:{state:'sealed',operationId:metadata.operationId}});click('이 요청 종료하고 다시 준비');await flush();
    expect(mocks.read).toHaveBeenCalledWith(metadata,true);expect(mocks.save).toHaveBeenCalledOnce();expect(render().find(node=>node.type==='fieldset')!.props.disabled).toBe(true);
  });
  it('세션 교체 후 도착한 완료로 다른 세션의 내역을 지우지 않는다',async()=>{
    let resolve!:(value:unknown)=>void;mocks.save.mockReturnValue(new Promise(done=>{resolve=done;}));submit();await flush();const metadata=saved();authenticate(id(999));
    resolve({value:{...commonTestReceipt,operationId:metadata.operationId}});await flush();expect(storage.size).toBe(1);expect(render().some(node=>node.props.role==='alert' && text(node).includes('로그인이 변경'))).toBe(true);
  });
  it('영속 메타데이터 저장 실패와 다른 탭 미결 요청은 mutation 전에 멈춘다',async()=>{
    storageApi.setItem.mockImplementationOnce(()=>{throw new Error('quota');});submit();await flush();expect(mocks.save).not.toHaveBeenCalled();
    const metadata={...identity,version:1 as const,command:'common' as const,groupId:commonTestSnapshot().group.id,expectedRevision:1,operationId:id(888)};
    storage.set(`${goodsGroupRecoveryKey(identity,`common:${metadata.groupId}`)}:${metadata.operationId}`,JSON.stringify(metadata));submit();await flush();expect(mocks.save).not.toHaveBeenCalled();expect(saved()).toEqual(metadata);
  });
});

/* R17(MD-0002): 그룹 공통 상세 HTML도 붙여넣기를 자르지 않고, 200,000자 상한을 넘으면 저장 전에 알린다. */
it('HTML 상세설명은 maxLength로 자르지 않고 상한 초과를 경고한다', () => {
  hooks.values = []; hooks.effects.clear(); hooks.jobs = [];
  const snapshot = commonTestSnapshot();
  const long = { ...snapshot, fields: { ...snapshot.fields, descriptionFormat: 'html', description: '가'.repeat(200001) } };
  const tree = render(long);
  const area = tree.find(node => node.type === TextArea && node.props.name === 'description')!;
  expect(area.props.maxLength).toBeUndefined();
  expect(area.props.label).toBe('상세설명 (정리된 코드 포함 최대 200,000자)');
  expect(tree.filter(node => node.type === 'li').map(node => text(node))).toContain('상세페이지 HTML이 200,001자로 최대 200,000자를 넘어 저장할 수 없습니다. 내용을 줄여주세요.');
  hooks.values = []; hooks.effects.clear(); hooks.jobs = [];
  const plain = render({ ...snapshot, fields: { ...snapshot.fields, descriptionFormat: 'plain', description: '설명' } }).find(node => node.type === TextArea && node.props.name === 'description')!;
  expect(plain.props.maxLength).toBe(2000);
});
