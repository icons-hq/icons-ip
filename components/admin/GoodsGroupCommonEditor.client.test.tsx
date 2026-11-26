import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
let leaveConfirm: ReturnType<typeof stubAdminConfirm>;
/** [공통정보 적용]을 누르면 뜨는 확인창. 이동 확인(leaveConfirm)과 따로 센다. */
let applyConfirm: ReturnType<typeof vi.fn<(request: AdminConfirmRequest) => boolean>>;
let lastLink: { click: ReturnType<typeof vi.fn> } | null = null;
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
import { GoodsAfterSalesFields } from './GoodsAfterSalesFields';
import { GoodsAfterSalesTemplatePicker } from './GoodsAfterSalesTemplatePicker';
import { GoodsSizeTemplatePicker } from './GoodsSizeTemplatePicker';
import { AdminSectionCard } from './console/AdminKit';
import { Button } from './kit/ui/button';
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
  click = vi.fn();
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
  const link = new LinkTarget(new URL(href, window.location.href).href, target, download); lastLink = link;
  Object.defineProperty(event, 'target', { value: link });
  document.dispatchEvent(event); return event;
}
function render(snapshot = commonTestSnapshot()) { hooks.index = 0; const result = GoodsGroupCommonEditor({ snapshot, ...identity, categories: [], ips: [] }); for (const job of hooks.jobs.splice(0)) job(); return nodes(result); }
function authenticate(sessionId = identity.sessionId) { mocks.auth?.('SIGNED_IN', { user: { id: identity.actorId }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.x` }); }
async function flush() { for (let i=0;i<10;i+=1) { await Promise.resolve(); render(); } }
function remount() { for (const effect of hooks.effects.values()) effect.cleanup?.(); hooks.values=[]; hooks.effects.clear(); hooks.jobs=[]; hooks.pending=false; render(); authenticate(); }
function submit() { const form = render().find(node => node.type==='form')!; (form.props.onSubmit as (event: unknown)=>void)({ preventDefault() {}, currentTarget: {} }); }
function click(label: string) { const button = render().find(node => (node.type==='button' || node.type===Button) && text(node)===label)!; expect(button).toBeDefined(); expect(button.props.disabled).not.toBe(true); (button.props.onClick as ()=>void)(); }
function saved() { return JSON.parse([...storage.values()][0]) as GoodsGroupRecovery; }
beforeEach(async () => {
  leaveConfirm = stubAdminConfirm(false); lastLink = null;
  applyConfirm = vi.fn<(request: AdminConfirmRequest) => boolean>(() => true);
  setAdminConfirmHandler(async request => request.confirmLabel === '적용' ? applyConfirm(request) : leaveConfirm(request.message));
  hooks.values=[]; hooks.effects.clear(); hooks.jobs=[]; hooks.pending=false; storage.clear(); vi.clearAllMocks();
  const submitted = [...commonTestForm().entries()]; submitted.push(['description','PRIVATE COMMON CONTENT']);
  vi.stubGlobal('FormData', class extends originalFormData { constructor(form?: unknown) { super(); if (form) for (const [key,value] of submitted) this.set(key,value); } });
  storageApi.setItem.mockImplementation((key,value)=>{storage.set(key,value);});
  vi.stubGlobal('window',Object.assign(new EventTarget(),{localStorage:storageApi, location: new URL('https://admin.test/admin/catalog/goods?groupCommon=test')}));
  vi.stubGlobal('document', new DocumentTarget()); vi.stubGlobal('Element', LinkTarget);
  mocks.save.mockResolvedValue({error:'응답 유실',uncertain:true}); mocks.read.mockResolvedValue({error:'조회 실패',uncertain:true});
  render(); authenticate(); await flush();
  const attributes = render().find(node=>node.type===GoodsAttributeEditor)!;
  (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')),'[]',true); await flush();
});
afterEach(()=>{for(const effect of hooks.effects.values())effect.cleanup?.();setAdminConfirmHandler(null);vi.unstubAllGlobals();});
describe('그룹 공통정보 편집 복구',()=>{
  it('미저장 공통정보를 두고 공통 사이드바로 이동할 때 취소하면 입력을 유지한다',()=>{
    const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
    (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')), '[]', false);
    render();
    expect(navigate().defaultPrevented).toBe(true); expect(leaveConfirm).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
    expect(render().find(node=>node.type==='fieldset')!.props.disabled).toBe(false);
  });
  it('일반 내부 링크 이동을 승인하면 자체 Link에서 중복 확인하지 않는다',async()=>{
    const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
    (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')), '[]', false);
    leaveConfirm.mockReturnValue(true);
    const cancel = render().find(node => node.props.onNavigate && text(node) === '취소')!;
    /* 확인창은 클릭을 먼저 멈춘 뒤 한 번만 묻고, 승인하면 같은 링크를 다시 눌러 이동을 잇는다. */
    expect(navigate(String(cancel.props.href)).defaultPrevented).toBe(true); await flush();
    expect(lastLink!.click).toHaveBeenCalledOnce();
    const preventDefault = vi.fn(); (cancel.props.onNavigate as (event: unknown)=>void)({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled(); expect(leaveConfirm).toHaveBeenCalledOnce();
  });
  it('새 탭·다운로드·수정키·중간 클릭·같은 문서 앵커는 보호창 없이 허용한다',()=>{
    const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
    (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')), '[]', false); render();
    for (const options of [{ target: '_blank' }, { download: true }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) expect(navigate('/admin', options).defaultPrevented).toBe(false);
    expect(navigate(`${window.location.href}#details`).defaultPrevented).toBe(false);
    expect(leaveConfirm).not.toHaveBeenCalled();
  });
  it('저장 진행 중 내부 이동을 막고 저장 완료 후에는 이동 보호를 해제한다',async()=>{
    const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
    (attributes.props.onChange as (submission:string,draft:string,initialize:boolean)=>void)(String(commonTestForm().get('productAttributes')), '[]', false);
    let resolve!: (value: unknown) => void;
    mocks.save.mockImplementation(() => new Promise(done => { resolve = done; })); submit(); await flush();
    expect(navigate().defaultPrevented).toBe(true); expect(leaveConfirm).not.toHaveBeenCalled();
    resolve({ value: { ...commonTestReceipt, operationId: saved().operationId } }); await flush();
    expect(navigate().defaultPrevented).toBe(false); expect(leaveConfirm).not.toHaveBeenCalled();
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
  it('공통정보 적용 버튼은 폼 제출이다(kit 버튼의 기본 type은 button)',()=>{
    const apply = render().find(node=>node.type===Button && text(node).startsWith('연결된 '))!;
    expect(apply.props.type).toBe('submit');
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

/* G-12: 연결된 모든 상품에 같은 값이 들어가고, 공개 중인 상품은 초안으로 바뀐다. 저장 전에 수와 결과를 보여 주고 확인받는다. */
async function mount(snapshot = commonTestSnapshot()) {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  hooks.values = []; hooks.effects.clear(); hooks.jobs = []; hooks.pending = false; storage.clear(); vi.clearAllMocks();
  render(snapshot); authenticate(); await flush();
  const attributes = render().find(node => node.type === GoodsAttributeEditor)!;
  (attributes.props.onChange as (submission: string, draft: string, initialize: boolean) => void)(String(commonTestForm().get('productAttributes')), '[]', true); await flush();
}
const withAfterSales = () => { const snapshot = commonTestSnapshot();
  snapshot.afterSales = { ...snapshot.afterSales, phone: '1588-0000', guide: '평일 10시부터 17시까지 받습니다.', revision: 1, updatedAt: '2026-11-01T00:00:00Z' }; return snapshot; };
describe('공통정보 적용 확인', () => {
  it('바뀌는 상품 수와 결과를 보여 주고, 취소하면 저장하지 않는다', async () => {
    const snapshot = commonTestSnapshot(); snapshot.group.members[0].publishedAt = '2026-11-20T00:00:00Z';
    await mount(snapshot); applyConfirm.mockReturnValue(false);
    submit(); await flush();
    expect(applyConfirm).toHaveBeenCalledOnce();
    const request = applyConfirm.mock.calls[0][0];
    expect(request.title).toBe('연결된 2개 상품에 공통정보를 적용할까요?'); expect(request.confirmLabel).toBe('적용');
    expect(request.message.split('\n')).toEqual([
      '공개 중인 상품 1개가 초안으로 바뀌어 고객 화면에서 내려갑니다.',
      '상품 2개 모두 KC 검토를 다시 마쳐야 공개할 수 있습니다.',
      'A/S 안내와 판매자 특이사항은 상품 2개 모두에서 비워집니다.',
    ]);
    expect(mocks.save).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
    expect(render().find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
    expect(leaveConfirm).not.toHaveBeenCalled();
  });
  it('확인하면 한 번만 저장한다. 같은 확인이 떠 있는 동안 다시 눌러도 확인창은 하나다', async () => {
    await mount(); let answer!: (value: boolean) => void;
    applyConfirm.mockImplementation(() => new Promise<boolean>(done => { answer = done; }) as unknown as boolean);
    submit(); submit(); await flush();
    expect(applyConfirm).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
    answer(true); await flush();
    expect(mocks.save).toHaveBeenCalledOnce(); expect(saved()).toMatchObject({ command: 'common', expectedRevision: 1 });
  });
  it('이미 모두 초안이면 초안 전환 줄을 빼고, A/S 안내를 적어 뒀으면 비운다는 줄도 뺀다', async () => {
    await mount(withAfterSales());
    submit(); await flush();
    expect(applyConfirm.mock.calls[0][0].message).toBe('상품 2개 모두 KC 검토를 다시 마쳐야 공개할 수 있습니다.');
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('A/S 안내 사용을 끄고 저장하면 모든 상품의 A/S 안내를 비운다고 알린다', async () => {
    await mount(withAfterSales());
    const checkbox = render().flatMap(node => node.type === 'label' ? nodes(node) : []).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
    submit(); await flush();
    expect(applyConfirm.mock.calls[0][0].message).toContain('A/S 안내와 판매자 특이사항은 상품 2개 모두에서 비워집니다.');
  });
  it('A/S 안내를 켜 둔 채 세 칸을 모두 비워도 서버가 비우므로 같은 안내를 보인다', async () => {
    await mount(withAfterSales());
    (render().find(node => node.type === GoodsAfterSalesFields)!.props.onChange as (values: unknown) => void)({ phone: ' ', guide: '', sellerSpecialNotes: '\n' });
    submit(); await flush();
    expect(applyConfirm.mock.calls[0][0].message).toContain('A/S 안내와 판매자 특이사항은 상품 2개 모두에서 비워집니다.');
  });
  it('입력이 맞지 않으면 묻지 않고 칸 오류부터 알린다', async () => {
    await mount(); vi.stubGlobal('FormData', class extends originalFormData { constructor(form?: unknown) { super(); if (form) this.set('productAttributes', 'invalid'); } });
    submit(); await flush();
    expect(applyConfirm).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('템플릿 선택창에는 지금 적어 둔 A/S 안내와 사이즈표를 넘겨, 바꾸기 전에 묻게 한다', async () => {
    const snapshot = withAfterSales(); await mount(snapshot);
    click('A/S 템플릿 고르기'); click('사이즈 템플릿 고르기');
    const tree = render();
    expect(tree.find(node => node.type === GoodsAfterSalesTemplatePicker)!.props.current).toMatchObject({ phone: '1588-0000', guide: '평일 10시부터 17시까지 받습니다.', sellerSpecialNotes: '' });
    expect(tree.find(node => node.type === GoodsSizeTemplatePicker)!.props.current).toEqual(snapshot.sizeChart.values.chart);
  });
  it('A/S 안내를 끄면 템플릿 선택창은 비어 있는 것으로 본다', async () => {
    await mount(withAfterSales());
    const checkbox = render().flatMap(node => node.type === 'label' ? nodes(node) : []).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
    click('A/S 템플릿 고르기');
    expect(render().find(node => node.type === GoodsAfterSalesTemplatePicker)!.props.current).toEqual({ phone: '', guide: '', sellerSpecialNotes: '' });
  });
  it('안내 문단에 브라우저 보관 설명을 두지 않고, 상태를 초안으로 말한다', async () => {
    await mount();
    const notes = render().filter(node => node.type === 'p').map(node => text(node)).join('\n');
    expect(notes).not.toContain('브라우저'); expect(notes).not.toContain('요청 번호');
    expect(notes).toContain('저장하면 모두 초안으로 바뀌고 KC를 다시 검토해야 합니다.'); expect(notes).not.toContain('미공개');
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
