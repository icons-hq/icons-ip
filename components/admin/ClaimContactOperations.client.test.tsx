import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Frame = { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }>; jobs: (() => void)[] };
const hooks = vi.hoisted(() => ({ current: '', index: 0, frames: new Map<string, Frame>() }));
const mocks = vi.hoisted(() => ({ context: vi.fn(), change: vi.fn(), read: vi.fn(), reship: vi.fn(), refresh: vi.fn(),
  auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const frame = hooks.frames.get(hooks.current)!, i = hooks.index++; if (!(i in frame.values)) frame.values[i] = typeof initial === 'function' ? initial() : initial;
    return [frame.values[i], (next: unknown) => { frame.values[i] = typeof next === 'function' ? next(frame.values[i]) : next; }]; },
  useRef: (initial: unknown) => { const frame = hooks.frames.get(hooks.current)!, i = hooks.index++; return frame.values[i] ??= { current: initial }; },
  useMemo: (work: () => unknown, deps: unknown[]) => { const frame = hooks.frames.get(hooks.current)!, i = hooks.index++, old = frame.values[i] as { value: unknown; deps: unknown[] } | undefined;
    if (!old || old.deps.length !== deps.length || deps.some((dep, n) => dep !== old.deps[n])) frame.values[i] = { value: work(), deps }; return (frame.values[i] as { value: unknown }).value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (work: () => void | (() => void), deps: unknown[] = []) => { const frame = hooks.frames.get(hooks.current)!, i = hooks.index++, old = frame.effects.get(i);
    if (!old || old.deps.length !== deps.length || deps.some((dep, n) => dep !== old.deps[n])) { frame.effects.set(i, { deps, cleanup: old?.cleanup }); frame.jobs.push(() => { old?.cleanup?.(); frame.effects.get(i)!.cleanup = work() || undefined; }); } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/lib/claim-contact/client', () => ({ fetchClaimContactContext: mocks.context, changeClaimContact: mocks.change,
  readOrSealClaimContactOperation: mocks.read, recordClaimReshipmentV2: mocks.reship }));const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/screens/ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
const evidence = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/lib/admin/claim-evidence.client', () => ({ uploadClaimEvidence: evidence.upload }));
/* 재출고 상품 선택창(공용 선택창)은 훅을 여럿 쓴다 — 넘겨받은 props만 잡아 [선택]을 대신 누른다. */
type PickerProps = { title: string; excludedNote?: string; selectedKeys?: readonly string[]; onSelect: (row: { id: string }) => void; onClose: () => void;
  load: (request: { query: string; field: string; filter: string; page: number }) => Promise<{ rows: readonly { id: string }[]; total: number }>;
  rowView: (row: never) => { title: string; meta?: string } };
const picker = vi.hoisted(() => ({ props: null as unknown }));
vi.mock('@/components/admin/console/AdminPickerDialog', () => ({ AdminPickerDialog: (props: unknown) => { picker.props = props; return null; } }));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => {
  mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } };
} } }) }));
import { ClaimContactOperations, claimContactJournalKey, claimReshipmentConfirmRequest, type ClaimContactReshipTarget } from './ClaimContactOperations';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { CLAIM_CONTACT_JOURNAL_PREFIX } from '@/components/claim-contact/ClaimContactSession';
import { claimContactError, parseClaimContactJournal, type ChangeRequest, type ClaimContactJournal, type ContextRequest, type ContextResponse, type OperationReceipt, type OperationRequest, type ReshipmentRequest } from '@/lib/claim-contact/contracts';
import type { AdminClaimReshipItem } from '@/lib/admin/claims.server';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { actorId: id(1), sessionId: id(2) }, orderId = id(3), claimId = id(4), other = id(99);
const NOW = '2026-10-14T06:00:00.000Z';
const address = { recipientName: '합성 원래 고객', phone: '01012345678', postalCode: ' 12345 ', address1: ' 합성 기본주소 100 ', address2: '합성 기존 상세' };
const changedName = '새 합성 고객😀', agreement = '합성 고객과 연락처 변경을 확인했습니다.';
const token = 'cc1.c3ludGhldGljY29udGV4dA.c3ludGhldGljc2lnbmF0dXJl';
const carriers: ShippingCarrierRegistry = [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://synthetic.test/{trackingNumber}' }];
const reshipItems: AdminClaimReshipItem[] = [{ id: id(10), goodId: 'synthetic-good', name: '합성 교환 상품', qty: 2, unitPrice: 1000,
  variantId: id(11), variantName: '기존 옵션', currentVariantId: id(11), options: [{ id: id(11), name: '기존 옵션', code: 'OLD', stockQty: 10 }, { id: id(12), name: '다른 옵션', code: 'NEW', stockQty: 20 }] }];
const key = () => claimContactJournalKey(identity, orderId, claimId);
type Element = ReactElement<Record<string, unknown>>;
const singleTarget: ClaimContactReshipTarget = { shipmentId: id(30), originName: null, collected: true, waivable: false, orderItemIds: [id(10)] };
let nodes: Element[], storage: Map<string, string>, reshipTargets: ClaimContactReshipTarget[], remainingTargets: number | undefined, contextOverrides: Partial<ContextResponse>;
let claimType: 'return' | 'exchange' | undefined, confirm: ReturnType<typeof stubAdminConfirm> | null = null;
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const memory = () => JSON.stringify([...hooks.frames.values()].map(frame => frame.values));
const screen = () => nodes.filter(node => ['p', 'h3', 'h4', 'legend', 'button'].includes(String(node.type))).map(node => text(node)).join('\n');
function render() {
  nodes = []; const seen = new Set<string>();
  function visit(node: ReactNode, path: string) {
    Children.toArray(node).forEach(value => {
      if (!isValidElement<Record<string, unknown>>(value)) return;
      const pathKey = `${path}/${String(value.key ?? '')}`;
      if (typeof value.type === 'function') {
        seen.add(pathKey); if (!hooks.frames.has(pathKey)) hooks.frames.set(pathKey, { values: [], effects: new Map(), jobs: [] });
        hooks.current = pathKey; hooks.index = 0; visit((value.type as (props: unknown) => ReactNode)(value.props), pathKey);
      } else { nodes.push(value); visit(value.props.children as ReactNode, pathKey); }
    });
  }
  picker.props = null;
  visit(<ClaimContactOperations actorId={identity.actorId} orderId={orderId} claimId={claimId} reshipTargets={reshipTargets} remainingTargets={remainingTargets} carriers={carriers} reshipItems={reshipItems} claimType={claimType} />, 'root');
  for (const [pathKey, frame] of hooks.frames) if (!seen.has(pathKey)) { for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.delete(pathKey); }
}
function effects() { for (const frame of hooks.frames.values()) for (const effect of frame.jobs.splice(0)) effect(); }
async function flush() { for (let i = 0; i < 10; i++) { await Promise.resolve(); render(); effects(); } }
function authenticate(actor = identity.actorId, session = identity.sessionId) {
  mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` });
}
function button(label: string) { render(); return nodes.find(node => node.type === 'button' && text(node) === label); }
function click(label: string) {
  const found = button(label); expect(found, label).toBeDefined(); expect(found!.props.disabled, label).not.toBe(true);
  (found!.props.onClick as () => void)();
}
function field(label: string) {
  render(); const parent = nodes.find(node => node.type === 'label' && text(node).startsWith(label)); expect(parent, label).toBeDefined();
  const found = Children.toArray(parent!.props.children as ReactNode).find(value => isValidElement(value) && ['input', 'select', 'textarea'].includes(String(value.type))) as Element | undefined;
  expect(found, label).toBeDefined(); return found!;
}
function change(label: string, value: string | boolean) { (field(label).props.onChange as (event: unknown) => void)({ target: { value, checked: value } }); }
function submit() { render(); const form = nodes.find(node => node.type === 'form'); expect(form).toBeDefined();
  const callback = form!.props.onSubmit as (event: unknown) => void; callback({ preventDefault() {} }); return callback; }
function dispose() { for (const frame of hooks.frames.values()) for (const effect of frame.effects.values()) effect.cleanup?.(); hooks.frames.clear(); nodes = []; }
async function mount() { dispose(); render(); effects(); authenticate(); await flush(); }
async function load(label = '회수지 보기·고치기') { click(label); await flush(); }
/* 확인 체크는 없다 — 받는 분·연락처·주소와 고객 합의 근거만 채우면 저장된다. */
function fillChange() {
  change('받는 분', ` ${changedName} `); change('연락처', '+(010) 1234-5678'); change('상세주소', '');
  change('고객 합의 근거', ` ${agreement} `);
}
/** 재출고 상품 선택창을 열어 그 옵션의 [선택]을 누른다. */
function pick(variantId: string) {
  click('재출고 상품 고르기'); render();
  const props = picker.props as PickerProps | null; expect(props, '재출고 상품 선택창').not.toBeNull();
  props!.onSelect({ id: variantId }); props!.onClose(); return props!;
}
function journal(): ClaimContactJournal {
  const value = parseClaimContactJournal(JSON.parse(storage.get(key()) ?? 'null')); expect(value).not.toBeNull(); return value!;
}
function receipt(original: ClaimContactJournal, state: OperationReceipt['state'] = 'saved'): OperationReceipt {
  return { operationId: original.operationId, command: original.command, orderId: original.orderId, claimId: original.claimId, target: original.target,
    actorId: original.actorId, sessionId: original.sessionId, expectedClaimType: original.expectedClaimType, expectedClaimRevision: original.expectedClaimRevision,
    resultClaimRevision: state === 'sealed' ? null : original.expectedClaimRevision + (state === 'saved' ? 1 : 0), state,
    changedFields: state === 'saved' && original.command === 'change' ? ['recipientName', 'address2'] : [], recordedAt: NOW,
    piiState: state === 'saved' ? 'retained' : 'not_stored' };
}
function operationResult(input: ChangeRequest | ReshipmentRequest | OperationRequest, state: OperationReceipt['state'] = 'saved') {
  return { requestId: input.requestId, actorId: identity.actorId, sessionId: identity.sessionId, receipt: receipt(journal(), state) };
}
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function context(input: ContextRequest): ContextResponse {
  return { ...input, actorId: identity.actorId, sessionId: identity.sessionId, claimType: 'exchange', claimRevision: 7, allowed: true, blocker: null,
    sourceKind: 'order_delivery', referenceOnly: true, piiState: 'available', unavailableReason: null, address, signedContext: token,
    expiresAt: new Date(Date.parse(NOW) + 600_000).toISOString(), ...contextOverrides };
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); vi.clearAllMocks(); hooks.frames.clear(); storage = new Map(); reshipTargets = [singleTarget]; remainingTargets = undefined; contextOverrides = {};
  claimType = undefined; confirm = stubAdminConfirm(true);
  vi.stubGlobal('sessionStorage', { getItem: (name: string) => storage.get(name) ?? null, setItem: (name: string, value: string) => storage.set(name, value),
    removeItem: (name: string) => storage.delete(name), key: (index: number) => [...storage.keys()][index] ?? null, get length() { return storage.size; } });
  vi.stubGlobal('localStorage', { setItem: vi.fn(() => { throw new Error('Raw contact must not use localStorage'); }) });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: vi.fn(() => false), setTimeout, clearTimeout }));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  mocks.context.mockImplementation(async (input: ContextRequest) => context(input));
  mocks.change.mockImplementation(async (input: ChangeRequest) => claimContactError('claim_contact_outcome_unknown', input.requestId));
  mocks.reship.mockImplementation(async (input: ReshipmentRequest) => claimContactError('claim_contact_outcome_unknown', input.requestId));
  mocks.read.mockImplementation(async (input: OperationRequest) => ({ requestId: input.requestId, actorId: identity.actorId, sessionId: identity.sessionId, receipt: null }));
  await mount();
});
afterEach(() => { dispose(); confirm?.restore(); confirm = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('contact edit and immutable recovery', () => {
  it('loads a fresh target/command-bound context and leaves postal/basic address read-only', async () => {
    await load();
    expect(mocks.context).toHaveBeenCalledWith(expect.objectContaining({ orderId, claimId, target: 'collection', command: 'change' }), expect.objectContaining({ expectedIdentity: identity }));
    expect(screen()).toContain(address.recipientName); expect(screen()).toContain(address.address1);
    expect(nodes.filter(node => node.type === 'input').map(node => node.props.value)).not.toContain(address.postalCode);
    expect(nodes.filter(node => node.type === 'input').map(node => node.props.value)).not.toContain(address.address1);
    expect(storage.size).toBe(0); expect(localStorage.setItem).not.toHaveBeenCalled();
  });
  it('blocks invalid confirmation/input before persistence or dispatch', async () => {
    await load(); change('받는 분', changedName); submit(); await flush();
    expect(mocks.change).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
    fillChange(); change('고객 합의 근거', '\ud800'); submit(); await flush();
    expect(mocks.change).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
  });
  it('stores only exact metadata before dispatch, prevents double submit, and retries the original normalized body after errors', async () => {
    await load(); fillChange(); const submitAgain = submit(); submitAgain({ preventDefault() {} }); await flush();
    expect(mocks.change).toHaveBeenCalledTimes(1);
    const original = structuredClone(mocks.change.mock.calls[0][0]) as ChangeRequest, saved = journal();
    expect(original.contact).toEqual({ recipientName: changedName, phone: address.phone, address2: '' }); expect(original.agreement).toBe(agreement);
    expect(Object.keys(saved).sort()).toEqual(['operationId', 'orderId', 'claimId', 'command', 'target', 'expectedClaimType', 'expectedClaimRevision', 'actorId', 'sessionId', 'startedAt'].sort());
    const persisted = JSON.stringify([...storage.entries()]);
    for (const raw of [address.recipientName, changedName, address.phone, address.address1, agreement, token]) expect(persisted).not.toContain(raw);
    expect(button('회수지 보기·고치기')?.props.disabled).toBe(true); expect(button('교환품 받을 곳 보기·고치기')?.props.disabled).toBe(true);
    expect(button('최종 주소 확인 후 재출고 등록')?.props.disabled).toBe(true);
    expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
    change('받는 분', '수정 시도한 다른 이름'); change('고객 합의 근거', '변조 시도한 다른 합의');
    mocks.change.mockImplementationOnce(async input => claimContactError('claim_contact_changed', input.requestId));
    click('같은 내용으로 다시 저장'); await flush();
    expect(mocks.change.mock.calls[1][0]).toEqual(original); expect(journal()).toEqual(saved); expect(mocks.context).toHaveBeenCalledTimes(1);
  });
  it('requires successful journal persistence before sending any mutation', async () => {
    await load(); fillChange(); vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    submit(); await flush(); expect(mocks.change).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
    expect(screen()).toContain('브라우저가 저장을 막아 보내지 않았습니다. 시크릿 창이면 일반 창에서 다시 열어 주세요.');
  });
  it('sanitizes an unexpected context exception and releases the pending state', async () => {
    mocks.context.mockRejectedValueOnce(new Error('synthetic private contact detail')); await load();
    expect(screen()).toContain('현재 주소를 불러오지 못했습니다'); expect(screen()).not.toContain('synthetic private contact detail');
    expect(button('회수지 보기·고치기')?.props.disabled).toBe(false); expect(storage.size).toBe(0);
  });
  it('keeps the fixed body and journal after an unexpected mutation exception', async () => {
    mocks.change.mockRejectedValueOnce(new Error('synthetic private contact detail')); await load(); fillChange(); submit(); await flush();
    const original = structuredClone(mocks.change.mock.calls[0][0]); expect(journal().operationId).toBe(original.operationId);
    expect(screen()).toContain(SAVE_UNKNOWN_MESSAGE); expect(screen()).not.toContain(claimContactError('claim_contact_outcome_unknown').message);
    expect(screen()).not.toContain('synthetic private contact detail');
    click('같은 내용으로 다시 저장'); await flush(); expect(mocks.change.mock.calls[1][0]).toEqual(original);
  });
  it('keeps recovery locked and private after an unexpected result-query exception', async () => {
    await load(); fillChange(); submit(); await flush(); const original = journal(); await mount();
    mocks.read.mockRejectedValueOnce(new Error('synthetic private contact detail')); click('저장됐는지 확인'); await flush();
    expect(journal()).toEqual(original); expect(button('회수지 보기·고치기')?.props.disabled).toBe(true);
    expect(screen()).not.toContain('synthetic private contact detail'); expect(memory()).not.toContain(agreement);
    expect(button('저장됐는지 확인')?.props.disabled).toBe(false);
  });
  it('reload recovery has no raw input/token and a null lookup never unlocks a new write', async () => {
    await load(); fillChange(); submit(); await flush(); const saved = journal();
    await mount();
    for (const raw of [changedName, agreement, token, address.phone, address.address1]) expect(memory()).not.toContain(raw);
    expect(button('같은 내용으로 다시 저장')).toBeUndefined(); expect(nodes.some(node => node.type === 'form')).toBe(false);
    click('저장됐는지 확인'); await flush();
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ operationId: saved.operationId, command: 'change', target: 'collection', expectedClaimRevision: 7, sealIfAbsent: false }), expect.objectContaining({ expectedIdentity: identity }));
    expect(Object.keys(mocks.read.mock.calls[0][0]).sort()).toEqual(['requestId', 'operationId', 'orderId', 'claimId', 'command', 'target', 'expectedClaimType', 'expectedClaimRevision', 'sealIfAbsent'].sort());
    expect(journal()).toEqual(saved); expect(button('회수지 보기·고치기')?.props.disabled).toBe(true); expect(mocks.change).toHaveBeenCalledTimes(1);
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => operationResult(input, 'sealed'));
    click('그만두고 다시 하기'); await flush();
    expect(mocks.read.mock.calls[1][0].sealIfAbsent).toBe(true); expect(storage.size).toBe(0); expect(button('회수지 보기·고치기')?.props.disabled).toBe(false);
    expect(screen()).toContain('그만뒀습니다. 저장된 것은 없습니다.');
  });
  it.each(['saved', 'noop'] as const)('%s receipt clears all original PII and permits a fresh context after refresh', async state => {
    mocks.change.mockImplementationOnce(async (input: ChangeRequest) => operationResult(input, state));
    await load(); fillChange(); submit(); await flush();
    expect(storage.size).toBe(0); expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(button('같은 내용으로 다시 저장')).toBeUndefined();
    for (const raw of [changedName, address.phone, address.address1, agreement, token]) expect(memory()).not.toContain(raw);
    expect(screen()).toContain(state === 'noop' ? '변경할 내용이 없어' : '회수지를 고쳤습니다.');
    contextOverrides = { claimRevision: 9 }; await load(); fillChange(); submit(); await flush(); expect(journal().expectedClaimRevision).toBe(9);
  });
  it.each(['operationId', 'actorId', 'sessionId', 'orderId', 'claimId', 'command', 'target', 'expectedClaimType', 'expectedClaimRevision'] as const)('does not accept a receipt with different %s', async fieldName => {
    mocks.change.mockImplementationOnce(async (input: ChangeRequest) => {
      const result = operationResult(input), values = { command: 'reshipment', target: 'reshipment', expectedClaimType: 'return', expectedClaimRevision: 9 };
      return { ...result, receipt: { ...result.receipt, [fieldName]: fieldName in values ? values[fieldName as keyof typeof values] : other } };
    });
    await load(); fillChange(); submit(); await flush();
    expect(storage.size).toBe(1); expect(mocks.refresh).not.toHaveBeenCalled(); expect(screen()).toContain('이 처리와 맞지 않습니다');
  });
  it('a late original commit after null lookup can still resolve the fixed request exactly once', async () => {
    const waiting = deferred(); mocks.change.mockReturnValueOnce(waiting.promise);
    await load(); fillChange(); submit(); await flush(); const saved = journal();
    expect(button('저장됐는지 확인')?.props.disabled).toBe(true);
    waiting.resolve(claimContactError('claim_contact_outcome_unknown')); await flush();
    click('저장됐는지 확인'); await flush(); expect(journal()).toEqual(saved);
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => ({ requestId: input.requestId, ...identity, receipt: receipt(saved) }));
    click('저장됐는지 확인'); await flush(); expect(storage.size).toBe(0); expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.change).toHaveBeenCalledTimes(1);
  });
});

describe('PII lifetime and current auth generation', () => {
  it.each(['close', 'visibility', 'timer', 'unmount'])('%s removes plaintext context and edit draft from component state', async mode => {
    await load(); fillChange(); expect(memory()).toContain(agreement);
    if (mode === 'close') click('닫기');
    else if (mode === 'visibility') { Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
    else if (mode === 'timer') vi.advanceTimersByTime(600_000);
    else dispose();
    if (mode !== 'unmount') await flush();
    for (const raw of [address.recipientName, address.phone, address.address1, changedName, agreement, token]) expect(memory()).not.toContain(raw);
    expect(nodes.some(node => node.props['data-private'])).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('visibility removes an unresolved request body but keeps only its metadata for read/seal recovery', async () => {
    await load(); fillChange(); submit(); await flush(); const saved = journal();
    Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); await flush();
    for (const raw of [changedName, agreement, token, address.phone, address.address1]) expect(memory()).not.toContain(raw);
    expect(journal()).toEqual(saved); expect(button('같은 내용으로 다시 저장')).toBeUndefined(); expect(button('저장됐는지 확인')).toBeDefined();
  });
  it('never restores a delayed context after the tab becomes hidden', async () => {
    const waiting = deferred(); mocks.context.mockReturnValueOnce(waiting.promise); click('회수지 보기·고치기'); await flush();
    const original = mocks.context.mock.calls[0][0] as ContextRequest;
    Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); await flush();
    waiting.resolve(context(original)); await flush();
    expect(nodes.some(node => node.props['data-private'])).toBe(false); expect(memory()).not.toContain(address.phone); expect(storage.size).toBe(0);
  });
  it('keeps metadata-only recovery after a hidden tab receives a late successful write', async () => {
    const waiting = deferred(); mocks.change.mockReturnValueOnce(waiting.promise); await load(); fillChange(); submit(); await flush();
    const original = mocks.change.mock.calls[0][0] as ChangeRequest, saved = journal();
    Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); await flush();
    waiting.resolve({ requestId: original.requestId, ...identity, receipt: receipt(saved) }); await flush();
    expect(journal()).toEqual(saved); expect(mocks.refresh).not.toHaveBeenCalled(); expect(memory()).not.toContain(agreement); expect(button('같은 내용으로 다시 저장')).toBeUndefined();
    Object.assign(document, { visibilityState: 'visible' });
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => ({ requestId: input.requestId, ...identity, receipt: receipt(saved) }));
    click('저장됐는지 확인'); await flush(); expect(storage.size).toBe(0); expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it('expiration blocks a fresh submit even when an old form callback survives the timer render', async () => {
    await load(); fillChange(); render(); const stale = nodes.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void;
    vi.advanceTimersByTime(600_000); stale({ preventDefault() {} }); await flush();
    expect(mocks.change).not.toHaveBeenCalled(); expect(storage.size).toBe(0); expect(screen()).toContain('주소 확인 시간이 지났습니다');
  });
  it('an unresolved original request retains its identical context for retry after TTL without reading a new address', async () => {
    await load(); fillChange(); submit(); await flush(); const original = structuredClone(mocks.change.mock.calls[0][0]);
    vi.advanceTimersByTime(700_000); await flush(); click('같은 내용으로 다시 저장'); await flush();
    expect(mocks.change.mock.calls[1][0]).toEqual(original); expect(mocks.context).toHaveBeenCalledTimes(1); expect(storage.size).toBe(1);
  });
  it.each(['claim_contact_purged', 'claim_contact_retention_due', 'claim_contact_operation_sealed', 'claim_contact_crypto_unavailable',
    'feature_disabled', 'claim_contact_operation_conflict', 'claim_contact_context_expired'] as const)('%s discards original PII and resend controls while retaining metadata recovery', async code => {
    mocks.change.mockImplementationOnce(async (input: ChangeRequest) => claimContactError(code, input.requestId));
    await load(); fillChange(); submit(); await flush(); const saved = journal();
    expect(saved.operationId).toBe(mocks.change.mock.calls[0][0].operationId);
    for (const raw of [changedName, agreement, token, address.phone, address.address1]) expect(memory()).not.toContain(raw);
    expect(button('같은 내용으로 다시 저장')).toBeUndefined(); expect(button('저장됐는지 확인')).toBeDefined();
    expect(button('회수지 보기·고치기')?.props.disabled).toBe(true); expect(nodes.some(node => node.props['data-private'])).toBe(false);
    click('저장됐는지 확인'); await flush(); expect(journal()).toEqual(saved); expect(mocks.change).toHaveBeenCalledTimes(1);
    expect(mocks.read.mock.calls[0][0].operationId).toBe(saved.operationId);
  });
  it('a terminal recovery-only error from result lookup also discards a previously retryable original body', async () => {
    await load(); fillChange(); submit(); await flush(); const saved = journal(); expect(button('같은 내용으로 다시 저장')).toBeDefined();
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => claimContactError('claim_contact_purged', input.requestId));
    click('저장됐는지 확인'); await flush();
    expect(journal()).toEqual(saved); expect(button('같은 내용으로 다시 저장')).toBeUndefined();
    expect(memory()).not.toContain(agreement); expect(memory()).not.toContain(token); expect(mocks.change).toHaveBeenCalledTimes(1);
  });
  it.each(['actor', 'session', 'logout'])('drops delayed context and stored PII across %s changes', async mode => {
    const waiting = deferred(); mocks.context.mockReturnValueOnce(waiting.promise); click('회수지 보기·고치기'); await flush();
    const original = mocks.context.mock.calls[0][0] as ContextRequest;
    if (mode === 'actor') authenticate(other); else if (mode === 'session') authenticate(identity.actorId, other); else window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
    waiting.resolve(context(original)); await flush();
    expect(nodes.some(node => node.props['data-private'])).toBe(false); expect(memory()).not.toContain(address.recipientName); expect(storage.size).toBe(0);
    expect(screen()).toContain('로그인 계정 또는 세션이 바뀌었습니다');
  });
  it.each(['actor', 'session', 'logout'])('never accepts a late successful mutation after %s changes', async mode => {
    const waiting = deferred(); mocks.change.mockReturnValueOnce(waiting.promise); await load(); fillChange(); submit(); await flush();
    const original = mocks.change.mock.calls[0][0] as ChangeRequest, saved = journal();
    if (mode === 'actor') authenticate(other); else if (mode === 'session') authenticate(identity.actorId, other); else window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
    waiting.resolve({ requestId: original.requestId, ...identity, receipt: receipt(saved) }); await flush();
    expect(storage.size).toBe(0); expect(mocks.refresh).not.toHaveBeenCalled(); expect(memory()).not.toContain(changedName); expect(memory()).not.toContain(agreement);
  });
  it('current auth denial clears PII and journals and leaves a blocked session', async () => {
    mocks.change.mockImplementationOnce(async input => claimContactError('auth_changed', input.requestId)); await load(); fillChange(); submit(); await flush();
    expect(storage.size).toBe(0); expect(memory()).not.toContain(agreement); expect(button('같은 내용으로 다시 저장')).toBeUndefined();
    expect(screen()).toContain('로그인 계정 또는 세션이 바뀌었습니다');
  });
  it('warns before unloading private/pending data and removes that warning after a terminal receipt', async () => {
    await load(); const opened = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(opened); expect(opened.defaultPrevented).toBe(true);
    fillChange(); submit(); await flush(); const pending = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(pending); expect(pending.defaultPrevented).toBe(true);
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => operationResult(input, 'sealed')); click('그만두고 다시 하기'); await flush();
    const cleared = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(cleared); expect(cleared.defaultPrevented).toBe(false);
  });
  it('discards invalid and other-session recovery entries without touching unrelated session storage', async () => {
    storage.set(`${CLAIM_CONTACT_JOURNAL_PREFIX}invalid`, JSON.stringify({ contact: address }));
    storage.set(`${CLAIM_CONTACT_JOURNAL_PREFIX}other`, JSON.stringify({ operationId: id(20), orderId, claimId, command: 'change', target: 'collection', expectedClaimType: 'exchange', expectedClaimRevision: 7, actorId: identity.actorId, sessionId: other, startedAt: NOW }));
    storage.set('unrelated', 'preserved'); await mount(); expect([...storage.entries()]).toEqual([['unrelated', 'preserved']]);
  });
});

describe('separate contact correction and actual reshipment', () => {
  it('does not expose actual dispatch when the current claim cannot reship', async () => {
    reshipTargets = []; await mount(); expect(button('최종 주소 확인 후 재출고 등록')).toBeUndefined();
    await load('교환품 받을 곳 보기·고치기'); expect(mocks.context.mock.calls[0][0]).toMatchObject({ target: 'reshipment', command: 'change' });
    expect(screen()).toContain('교환품 받을 곳 고치기'); expect(mocks.reship).not.toHaveBeenCalled();
  });
  it('asks once with what was sent and what happens, then posts the chosen item selections to v2 only', async () => {
    await load('최종 주소 확인 후 재출고 등록');
    expect(mocks.context.mock.calls[0][0]).toMatchObject({ target: 'reshipment', command: 'reshipment' });
    expect(nodes.some(node => node.type === 'textarea')).toBe(false); expect(screen()).toContain('재출고 등록');
    expect(screen()).toContain('운송장의 받는 분·주소와 같은지 확인하세요.');
    /* 확인 체크는 없다. 화면이 확인 값을 채우고, 확인창이 보낸 내용과 결과를 묻는다. */
    expect(nodes.some(node => node.type === 'input' && node.props.type === 'checkbox')).toBe(false);
    expect(screen()).toContain('기존 옵션 · OLD · 재고 10개');
    change('재출고 운송장번호', 'ab12345678');
    const opened = pick(id(12)); expect(opened.title).toBe('합성 교환 상품 재출고 상품 고르기'); expect(opened.selectedKeys).toEqual([id(11)]);
    render(); expect(screen()).toContain('다른 옵션 · NEW · 재고 20개');
    confirm!.mockReturnValueOnce(false); submit(); await flush();
    expect(confirm).toHaveBeenCalledTimes(1); expect(mocks.reship).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
    expect(confirm!.mock.calls[0][0]).toBe(claimReshipmentConfirmRequest({ originName: '주문 전체', carrierLabel: '한진택배', trackingNumber: 'AB12345678',
      items: [{ name: '합성 교환 상품', option: '다른 옵션', qty: 2 }], stock: 'restore', closes: true }).message);
    for (const raw of [address.recipientName, address.phone, address.address1, address.address2]) expect(confirm!.mock.calls[0][0]).not.toContain(raw);
    mocks.reship.mockImplementationOnce(async (input: ReshipmentRequest) => operationResult(input)); submit(); await flush();
    expect(confirm).toHaveBeenCalledTimes(2); expect(mocks.reship).toHaveBeenCalledTimes(1); expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.reship.mock.calls[0][0]).toMatchObject({ orderId, claimId, signedContext: token, shipmentId: id(30), carrier: 'hanjin', trackingNumber: 'AB12345678',
      items: [{ orderItemId: id(10), variantId: id(12) }], collectionWaiver: null, destinationConfirmed: true, dispatchConfirmed: true });
    expect(screen()).toContain('재출고를 등록했습니다. 교환품을 받을 곳도 함께 기록했습니다.'); expect(storage.size).toBe(0);
  });
  it('says which box is wrong before asking, and never asks for an invalid tracking number', async () => {
    await load('최종 주소 확인 후 재출고 등록'); change('재출고 운송장번호', 'ab-123'); submit(); await flush();
    expect(confirm).not.toHaveBeenCalled(); expect(mocks.reship).not.toHaveBeenCalled();
    expect(screen()).toContain('재출고 운송장번호는 영문과 숫자 8~30자로 적어 주세요.');
  });
  it('does not send when the tab was hidden or the address check expired while the confirm was open', async () => {
    const waiting = deferred(); confirm!.mockReturnValueOnce(waiting.promise as Promise<boolean>);
    await load('최종 주소 확인 후 재출고 등록'); change('재출고 운송장번호', 'ab12345678'); submit(); await flush();
    Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); await flush();
    waiting.resolve(true); await flush();
    expect(mocks.reship).not.toHaveBeenCalled(); expect(storage.size).toBe(0); expect(nodes.some(node => node.props['data-private'])).toBe(false);
    Object.assign(document, { visibilityState: 'visible' });
    const late = deferred(); confirm!.mockReturnValueOnce(late.promise as Promise<boolean>);
    await load('최종 주소 확인 후 재출고 등록'); change('재출고 운송장번호', 'ab12345678'); render();
    const stale = nodes.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void; stale({ preventDefault() {} }); await flush();
    vi.advanceTimersByTime(600_000); late.resolve(true); await flush();
    expect(mocks.reship).not.toHaveBeenCalled(); expect(storage.size).toBe(0); expect(screen()).toContain('주소 확인 시간이 지났습니다');
  });
  it('lists pickable options with stock and tells what was left out', async () => {
    reshipItems[0].options.push({ id: id(14), name: '품절 옵션', code: 'OUT', stockQty: 0 });
    try {
      await mount(); await load('최종 주소 확인 후 재출고 등록');
      click('재출고 상품 고르기'); render(); const props = picker.props as PickerProps;
      expect(props.excludedNote).toBe('재고가 없는 옵션은 목록에서 뺐습니다.');
      const page = await props.load({ query: '', field: '', filter: '', page: 1 });
      expect(page.total).toBe(2); expect(page.rows.map(row => row.id)).toEqual([id(11), id(12)]);
      expect(props.rowView(page.rows[0] as never)).toEqual({ title: '기존 옵션', meta: '옵션 자동코드 OLD · 재고 10개 · 지금 주문한 옵션' });
      expect((await props.load({ query: 'new', field: '', filter: '', page: 1 })).rows.map(row => row.id)).toEqual([id(12)]);
    } finally { reshipItems[0].options.pop(); }
  });
  it('the confirm request names the origin, the parcel, the stock result and whether the exchange ends', () => {
    const request = claimReshipmentConfirmRequest({ originName: '합성 김포', carrierLabel: '한진택배', trackingNumber: 'GP12345678',
      items: [{ name: '합성 교환 상품', option: '기존 옵션', qty: 2 }], stock: 'waived', closes: false });
    expect(request).toMatchObject({ title: '합성 김포 재출고를 등록할까요?', confirmLabel: '재출고 등록', cancelLabel: '돌아가기', destructive: true });
    expect(request.message).toContain('한진택배 GP12345678'); expect(request.message).toContain('합성 교환 상품 → 기존 옵션 2개');
    expect(request.message).toContain('재고를 되돌리지 않고, 보내는 상품의 재고만 줄입니다.'); expect(request.message).toContain('남은 출고지를 모두 재출고하면 교환이 끝납니다.');
    expect(request.message).toContain('등록한 뒤에는 되돌릴 수 없습니다.');
    const defective = claimReshipmentConfirmRequest({ originName: '합성 김포', carrierLabel: '한진택배', trackingNumber: 'GP12345678',
      items: [{ name: '합성 교환 상품', option: '기존 옵션', qty: 2 }], stock: 'defective', defectiveNames: ['합성 교환 상품'], closes: true });
    expect(defective.confirmLabel).toBe('재출고 등록하고 교환 종결'); expect(defective.message).toContain('불량으로 고른 회수 상품(합성 교환 상품)은 불량 재고에 적고');
    expect(defective.message).toContain('남은 출고지가 없어 교환이 끝납니다.');
  });
  it('reships one origin at a time and sends only that origin\'s items', async () => {
    const item2 = { ...reshipItems[0], id: id(13), name: '합성 남양주 상품', qty: 1 };
    reshipItems.push(item2);
    try {
      reshipTargets = [{ shipmentId: id(30), originName: '합성 김포', collected: true, waivable: false, orderItemIds: [id(10)] },
        { shipmentId: id(31), originName: '합성 남양주', collected: true, waivable: false, orderItemIds: [id(13)] }];
      await mount();
      expect(button('합성 김포 재출고 등록')).toBeDefined(); expect(button('합성 남양주 재출고 등록')).toBeDefined();
      expect(screen()).toContain('출고지마다 따로 재출고합니다');
      await load('합성 남양주 재출고 등록'); expect(nodes.filter(node => node.type === 'h4').map(node => text(node))).toEqual(['합성 남양주 재출고 등록']);
      expect(nodes.some(node => node.props['data-claim-reship-item'] === id(10))).toBe(false); expect(nodes.some(node => node.props['data-claim-reship-item'] === id(13))).toBe(true);
      change('재출고 운송장번호', 'NY12345678');
      expect(button('이 배송 건 재출고 등록')).toBeDefined();
      mocks.reship.mockImplementationOnce(async (input: ReshipmentRequest) => operationResult(input)); submit(); await flush();
      expect(mocks.reship.mock.calls[0][0]).toMatchObject({ shipmentId: id(31), items: [{ orderItemId: id(13), variantId: id(11) }], collectionWaiver: null });
      expect(confirm!.mock.calls[0][0]).toContain('남은 출고지를 모두 재출고하면 교환이 끝납니다.'); expect(confirm!.mock.calls[0][0]).toContain('합성 남양주 상품 → 기존 옵션 1개');
    } finally { reshipItems.pop(); }
  });
  it('requires a reason and an evidence photo before reshipping an uncollected defect origin without collection', async () => {
    reshipTargets = [{ shipmentId: id(32), originName: '합성 김포', collected: false, waivable: true, orderItemIds: [id(10)] }];
    await mount(); await load('합성 김포 재출고 등록 (회수 없이)');
    expect(screen()).toContain('이 배송 건은 아직 회수를 확인하지 않았습니다.');
    /* 회수 확인 전 배송 건은 회수 없이 보내는 길뿐이라 따로 체크받지 않는다(버튼에 '(회수 없이)'가 붙어 있다). */
    expect(nodes.some(node => node.type === 'input' && node.props.type === 'checkbox')).toBe(false);
    change('재출고 운송장번호', 'GP12345678');
    mocks.reship.mockImplementation(async (input: ReshipmentRequest) => operationResult(input));
    submit(); await flush(); expect(mocks.reship).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
    expect(screen()).toContain('회수 생략 사유(10~500자)와 근거 사진 1장 이상을 남겨주세요.');
    change('회수 생략 사유', '고객 사진으로\n인쇄 불량을 확인했습니다');
    evidence.upload.mockResolvedValueOnce({ ok: true, file: { id: id(40), mimeType: 'image/jpeg', size: 1024 } });
    (field('근거 사진').props.onChange as (event: unknown) => void)({ target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })], value: 'photo.jpg' } });
    await flush(); expect(evidence.upload).toHaveBeenCalledWith(claimId, expect.any(File));
    submit(); await flush();
    expect(mocks.reship).toHaveBeenCalledTimes(1);
    expect(mocks.reship.mock.calls[0][0]).toMatchObject({ shipmentId: id(32), collectionWaiver: { reason: '고객 사진으로 인쇄 불량을 확인했습니다', evidenceFileIds: [id(40)] } });
    expect(confirm!.mock.calls[0][0]).toContain('회수한 상품이 없어 재고를 되돌리지 않고, 보내는 상품의 재고만 줄입니다. 고객에게는 회수 없이 다시 보낸다고 알립니다.');
  });
  it('ends the exchange only when no other origin is still waiting, even if it cannot be registered yet', async () => {
    /* 단순 변심 두 출고지에서 김포만 입고: 등록할 수 있는 곳은 김포 하나지만 남양주가 남아 교환을 종결하지 않는다(리뷰 #5). */
    reshipTargets = [{ shipmentId: id(30), originName: '합성 김포', collected: true, waivable: false, orderItemIds: [id(10)] }]; remainingTargets = 2;
    await mount(); await load('합성 김포 재출고 등록');
    expect(button('이 배송 건 재출고 등록')).toBeDefined(); expect(button('재출고 등록하고 교환 종결')).toBeUndefined();
    remainingTargets = 1; await mount(); await load('합성 김포 재출고 등록');
    expect(button('재출고 등록하고 교환 종결')).toBeDefined();
  });
  it('reships a made-to-order origin whose waiver was decided earlier without asking for the waiver again', async () => {
    reshipTargets = [{ shipmentId: id(33), originName: '합성 김포', collected: false, waivable: false, waived: true, orderItemIds: [id(10)] }];
    await mount(); await load('합성 김포 재출고 등록 (회수 없이)');
    expect(screen()).toContain('이 배송 건은 회수 생략을 결정했습니다.');
    expect(nodes.some(node => node.type === 'label' && text(node).startsWith('회수 생략 사유'))).toBe(false);
    expect(screen()).toContain('회수 상품 재고는 복원하지 않고');
    change('재출고 운송장번호', 'MT12345678');
    mocks.reship.mockImplementationOnce(async (input: ReshipmentRequest) => operationResult(input)); submit(); await flush();
    expect(mocks.reship).toHaveBeenCalledTimes(1);
    expect(mocks.reship.mock.calls[0][0]).toMatchObject({ shipmentId: id(33), collectionWaiver: null });
  });
  it('does not offer an uncollected origin that cannot be waived', async () => {
    reshipTargets = [];
    await mount(); expect(nodes.some(node => node.type === 'button' && text(node).includes('재출고 등록'))).toBe(false);
  });
  it('a denied/due context shows metadata and cannot be submitted as either operation', async () => {
    contextOverrides = { allowed: false, blocker: 'claim_contact_retention_due', piiState: 'unavailable', unavailableReason: 'retention_due', sourceKind: null, referenceOnly: false, address: null, signedContext: null, expiresAt: null };
    await load(); expect(nodes.some(node => node.type === 'form')).toBe(false); expect(screen()).toContain('주소 보관기간이 지나');
    expect(mocks.change).not.toHaveBeenCalled(); expect(mocks.reship).not.toHaveBeenCalled();
  });
  it.each([
    ['claim_stage', '주소를 고칠 수 있는 단계가 지났습니다.'],
    ['collection_started', '승인해 회수를 시작한 뒤에는 회수지를 고칠 수 없습니다.'],
    ['financial_state', '이미 취소나 환불을 진행한 주문이라 고칠 수 없습니다.'],
    ['not_applicable', '교환 요청에서만 쓰는 주소입니다.'],
    ['reshipment_started', '교환품을 보내기 시작한 뒤에는 받을 곳을 고칠 수 없습니다.'],
    ['synthetic_unknown', claimContactError('claim_contact_blocked').message],
  ])('says why a blocked %s context cannot be edited, not that the outcome is unknown', async (blocker, reason) => {
    contextOverrides = { allowed: false, blocker, signedContext: null, expiresAt: null };
    await load(); expect(nodes.some(node => node.type === 'form')).toBe(false);
    expect(screen()).toContain(reason);
    expect(screen()).not.toContain(claimContactError('claim_contact_outcome_unknown').message); expect(screen()).not.toContain(SAVE_UNKNOWN_MESSAGE);
    expect(storage.size).toBe(0); expect(mocks.change).not.toHaveBeenCalled();
  });
  it('a return has no exchange address to edit, so only the collection address button is drawn', async () => {
    expect(button('교환품 받을 곳 보기·고치기')).toBeDefined(); expect(screen()).toContain('회수지·교환품 받을 곳');
    claimType = 'return'; reshipTargets = []; await mount();
    expect(button('회수지 보기·고치기')).toBeDefined(); expect(button('교환품 받을 곳 보기·고치기')).toBeUndefined();
    expect(screen()).not.toContain('교환품'); expect(nodes.some(node => node.props['data-claim-reship-entry'] !== undefined)).toBe(false);
  });
  it('a failed address read asks to press again, not to check whether something was saved', async () => {
    mocks.context.mockImplementationOnce(async (input: ContextRequest) => claimContactError('claim_contact_outcome_unknown', input.requestId));
    await load(); expect(screen()).toContain('현재 주소를 불러오지 못했습니다'); expect(screen()).not.toContain(SAVE_UNKNOWN_MESSAGE);
    expect(button('저장됐는지 확인')).toBeUndefined(); expect(button('회수지 보기·고치기')?.props.disabled).toBe(false);
  });
});
