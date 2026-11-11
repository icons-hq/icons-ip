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

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => {
  mocks.auth = callback; return { data: { subscription: { unsubscribe() {} } } };
} } }) }));
import { ClaimContactOperations, claimContactJournalKey } from './ClaimContactOperations';
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
let nodes: Element[], storage: Map<string, string>, canReship: boolean, contextOverrides: Partial<ContextResponse>;
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
  visit(<ClaimContactOperations actorId={identity.actorId} orderId={orderId} claimId={claimId} canReship={canReship} carriers={carriers} reshipItems={reshipItems} />, 'root');
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
async function load(label = '회수지 연락처 확인') { click(label); await flush(); }
function fillChange() {
  change('받는 분', ` ${changedName} `); change('연락처', '+(010) 1234-5678'); change('상세주소', '');
  change('고객 합의 근거', ` ${agreement} `); change('고객과 변경 내용을', true); change('택배사 수거가 시작되지', true);
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
  vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); vi.clearAllMocks(); hooks.frames.clear(); storage = new Map(); canReship = true; contextOverrides = {};
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
afterEach(() => { dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
    expect(button('회수지 연락처 확인')?.props.disabled).toBe(true); expect(button('재배송지 연락처 확인')?.props.disabled).toBe(true);
    expect(button('최종 주소 확인 후 재출고 등록')?.props.disabled).toBe(true);
    expect(nodes.find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
    change('받는 분', '수정 시도한 다른 이름'); change('고객 합의 근거', '변조 시도한 다른 합의');
    mocks.change.mockImplementationOnce(async input => claimContactError('claim_contact_changed', input.requestId));
    click('같은 내용으로 다시 요청'); await flush();
    expect(mocks.change.mock.calls[1][0]).toEqual(original); expect(journal()).toEqual(saved); expect(mocks.context).toHaveBeenCalledTimes(1);
  });
  it('requires successful journal persistence before sending any mutation', async () => {
    await load(); fillChange(); vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    submit(); await flush(); expect(mocks.change).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
    expect(screen()).toContain('요청번호를 보관할 수 없습니다');
  });
  it('sanitizes an unexpected context exception and releases the pending state', async () => {
    mocks.context.mockRejectedValueOnce(new Error('synthetic private contact detail')); await load();
    expect(screen()).toContain('현재 주소를 읽지 못했습니다'); expect(screen()).not.toContain('synthetic private contact detail');
    expect(button('회수지 연락처 확인')?.props.disabled).toBe(false); expect(storage.size).toBe(0);
  });
  it('keeps the fixed body and journal after an unexpected mutation exception', async () => {
    mocks.change.mockRejectedValueOnce(new Error('synthetic private contact detail')); await load(); fillChange(); submit(); await flush();
    const original = structuredClone(mocks.change.mock.calls[0][0]); expect(journal().operationId).toBe(original.operationId);
    expect(screen()).toContain(claimContactError('claim_contact_outcome_unknown').message); expect(screen()).not.toContain('synthetic private contact detail');
    click('같은 내용으로 다시 요청'); await flush(); expect(mocks.change.mock.calls[1][0]).toEqual(original);
  });
  it('keeps recovery locked and private after an unexpected result-query exception', async () => {
    await load(); fillChange(); submit(); await flush(); const original = journal(); await mount();
    mocks.read.mockRejectedValueOnce(new Error('synthetic private contact detail')); click('저장 결과 확인'); await flush();
    expect(journal()).toEqual(original); expect(button('회수지 연락처 확인')?.props.disabled).toBe(true);
    expect(screen()).not.toContain('synthetic private contact detail'); expect(memory()).not.toContain(agreement);
    expect(button('저장 결과 확인')?.props.disabled).toBe(false);
  });
  it('reload recovery has no raw input/token and a null lookup never unlocks a new write', async () => {
    await load(); fillChange(); submit(); await flush(); const saved = journal();
    await mount();
    for (const raw of [changedName, agreement, token, address.phone, address.address1]) expect(memory()).not.toContain(raw);
    expect(button('같은 내용으로 다시 요청')).toBeUndefined(); expect(nodes.some(node => node.type === 'form')).toBe(false);
    click('저장 결과 확인'); await flush();
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ operationId: saved.operationId, command: 'change', target: 'collection', expectedClaimRevision: 7, sealIfAbsent: false }), expect.objectContaining({ expectedIdentity: identity }));
    expect(Object.keys(mocks.read.mock.calls[0][0]).sort()).toEqual(['requestId', 'operationId', 'orderId', 'claimId', 'command', 'target', 'expectedClaimType', 'expectedClaimRevision', 'sealIfAbsent'].sort());
    expect(journal()).toEqual(saved); expect(button('회수지 연락처 확인')?.props.disabled).toBe(true); expect(mocks.change).toHaveBeenCalledTimes(1);
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => operationResult(input, 'sealed'));
    click('미처리 요청 종료'); await flush();
    expect(mocks.read.mock.calls[1][0].sealIfAbsent).toBe(true); expect(storage.size).toBe(0); expect(button('회수지 연락처 확인')?.props.disabled).toBe(false);
    expect(screen()).toContain('미처리 요청을 종료했습니다');
  });
  it.each(['saved', 'noop'] as const)('%s receipt clears all original PII and permits a fresh context after refresh', async state => {
    mocks.change.mockImplementationOnce(async (input: ChangeRequest) => operationResult(input, state));
    await load(); fillChange(); submit(); await flush();
    expect(storage.size).toBe(0); expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(button('같은 내용으로 다시 요청')).toBeUndefined();
    for (const raw of [changedName, address.phone, address.address1, agreement, token]) expect(memory()).not.toContain(raw);
    expect(screen()).toContain(state === 'noop' ? '변경할 내용이 없어' : '회수지 연락처를 수정했습니다');
    contextOverrides = { claimRevision: 9 }; await load(); fillChange(); submit(); await flush(); expect(journal().expectedClaimRevision).toBe(9);
  });
  it.each(['operationId', 'actorId', 'sessionId', 'orderId', 'claimId', 'command', 'target', 'expectedClaimType', 'expectedClaimRevision'] as const)('does not accept a receipt with different %s', async fieldName => {
    mocks.change.mockImplementationOnce(async (input: ChangeRequest) => {
      const result = operationResult(input), values = { command: 'reshipment', target: 'reshipment', expectedClaimType: 'return', expectedClaimRevision: 9 };
      return { ...result, receipt: { ...result.receipt, [fieldName]: fieldName in values ? values[fieldName as keyof typeof values] : other } };
    });
    await load(); fillChange(); submit(); await flush();
    expect(storage.size).toBe(1); expect(mocks.refresh).not.toHaveBeenCalled(); expect(screen()).toContain('현재 요청과 다른 결과');
  });
  it('a late original commit after null lookup can still resolve the fixed request exactly once', async () => {
    const waiting = deferred(); mocks.change.mockReturnValueOnce(waiting.promise);
    await load(); fillChange(); submit(); await flush(); const saved = journal();
    expect(button('저장 결과 확인')?.props.disabled).toBe(true);
    waiting.resolve(claimContactError('claim_contact_outcome_unknown')); await flush();
    click('저장 결과 확인'); await flush(); expect(journal()).toEqual(saved);
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => ({ requestId: input.requestId, ...identity, receipt: receipt(saved) }));
    click('저장 결과 확인'); await flush(); expect(storage.size).toBe(0); expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.change).toHaveBeenCalledTimes(1);
  });
});

describe('PII lifetime and current auth generation', () => {
  it.each(['close', 'visibility', 'timer', 'unmount'])('%s removes plaintext context and edit draft from component state', async mode => {
    await load(); fillChange(); expect(memory()).toContain(agreement);
    if (mode === 'close') click('연락처 닫기');
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
    expect(journal()).toEqual(saved); expect(button('같은 내용으로 다시 요청')).toBeUndefined(); expect(button('저장 결과 확인')).toBeDefined();
  });
  it('never restores a delayed context after the tab becomes hidden', async () => {
    const waiting = deferred(); mocks.context.mockReturnValueOnce(waiting.promise); click('회수지 연락처 확인'); await flush();
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
    expect(journal()).toEqual(saved); expect(mocks.refresh).not.toHaveBeenCalled(); expect(memory()).not.toContain(agreement); expect(button('같은 내용으로 다시 요청')).toBeUndefined();
    Object.assign(document, { visibilityState: 'visible' });
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => ({ requestId: input.requestId, ...identity, receipt: receipt(saved) }));
    click('저장 결과 확인'); await flush(); expect(storage.size).toBe(0); expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it('expiration blocks a fresh submit even when an old form callback survives the timer render', async () => {
    await load(); fillChange(); render(); const stale = nodes.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void;
    vi.advanceTimersByTime(600_000); stale({ preventDefault() {} }); await flush();
    expect(mocks.change).not.toHaveBeenCalled(); expect(storage.size).toBe(0); expect(screen()).toContain('주소 확인 시간이 지났습니다');
  });
  it('an unresolved original request retains its identical context for retry after TTL without reading a new address', async () => {
    await load(); fillChange(); submit(); await flush(); const original = structuredClone(mocks.change.mock.calls[0][0]);
    vi.advanceTimersByTime(700_000); await flush(); click('같은 내용으로 다시 요청'); await flush();
    expect(mocks.change.mock.calls[1][0]).toEqual(original); expect(mocks.context).toHaveBeenCalledTimes(1); expect(storage.size).toBe(1);
  });
  it.each(['claim_contact_purged', 'claim_contact_retention_due', 'claim_contact_operation_sealed', 'claim_contact_crypto_unavailable',
    'feature_disabled', 'claim_contact_operation_conflict', 'claim_contact_context_expired'] as const)('%s discards original PII and resend controls while retaining metadata recovery', async code => {
    mocks.change.mockImplementationOnce(async (input: ChangeRequest) => claimContactError(code, input.requestId));
    await load(); fillChange(); submit(); await flush(); const saved = journal();
    expect(saved.operationId).toBe(mocks.change.mock.calls[0][0].operationId);
    for (const raw of [changedName, agreement, token, address.phone, address.address1]) expect(memory()).not.toContain(raw);
    expect(button('같은 내용으로 다시 요청')).toBeUndefined(); expect(button('저장 결과 확인')).toBeDefined();
    expect(button('회수지 연락처 확인')?.props.disabled).toBe(true); expect(nodes.some(node => node.props['data-private'])).toBe(false);
    click('저장 결과 확인'); await flush(); expect(journal()).toEqual(saved); expect(mocks.change).toHaveBeenCalledTimes(1);
    expect(mocks.read.mock.calls[0][0].operationId).toBe(saved.operationId);
  });
  it('a terminal recovery-only error from result lookup also discards a previously retryable original body', async () => {
    await load(); fillChange(); submit(); await flush(); const saved = journal(); expect(button('같은 내용으로 다시 요청')).toBeDefined();
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => claimContactError('claim_contact_purged', input.requestId));
    click('저장 결과 확인'); await flush();
    expect(journal()).toEqual(saved); expect(button('같은 내용으로 다시 요청')).toBeUndefined();
    expect(memory()).not.toContain(agreement); expect(memory()).not.toContain(token); expect(mocks.change).toHaveBeenCalledTimes(1);
  });
  it.each(['actor', 'session', 'logout'])('drops delayed context and stored PII across %s changes', async mode => {
    const waiting = deferred(); mocks.context.mockReturnValueOnce(waiting.promise); click('회수지 연락처 확인'); await flush();
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
    expect(storage.size).toBe(0); expect(memory()).not.toContain(agreement); expect(button('같은 내용으로 다시 요청')).toBeUndefined();
    expect(screen()).toContain('로그인 계정 또는 세션이 바뀌었습니다');
  });
  it('warns before unloading private/pending data and removes that warning after a terminal receipt', async () => {
    await load(); const opened = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(opened); expect(opened.defaultPrevented).toBe(true);
    fillChange(); submit(); await flush(); const pending = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(pending); expect(pending.defaultPrevented).toBe(true);
    mocks.read.mockImplementationOnce(async (input: OperationRequest) => operationResult(input, 'sealed')); click('미처리 요청 종료'); await flush();
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
    canReship = false; await mount(); expect(button('최종 주소 확인 후 재출고 등록')).toBeUndefined();
    await load('재배송지 연락처 확인'); expect(mocks.context.mock.calls[0][0]).toMatchObject({ target: 'reshipment', command: 'change' });
    expect(screen()).toContain('재배송지 연락처 수정'); expect(mocks.reship).not.toHaveBeenCalled();
  });
  it('requires separate dispatch confirmation and posts existing item selections to v2 only', async () => {
    await load('최종 주소 확인 후 재출고 등록');
    expect(mocks.context.mock.calls[0][0]).toMatchObject({ target: 'reshipment', command: 'reshipment' });
    expect(nodes.some(node => node.type === 'textarea')).toBe(false); expect(screen()).toContain('재출고 최종 주소 확인');
    change('재출고 운송장번호', 'ab12345678'); change('합성 교환 상품', id(12));
    submit(); await flush(); expect(mocks.reship).not.toHaveBeenCalled();
    change('표시된 최종 주소', true); change('전체 수량과 실제 발송', true);
    mocks.reship.mockImplementationOnce(async (input: ReshipmentRequest) => operationResult(input)); submit(); await flush();
    expect(mocks.reship).toHaveBeenCalledTimes(1); expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.reship.mock.calls[0][0]).toMatchObject({ orderId, claimId, signedContext: token, carrier: 'hanjin', trackingNumber: 'AB12345678', items: [{ orderItemId: id(10), variantId: id(12) }], destinationConfirmed: true, dispatchConfirmed: true });
    expect(screen()).toContain('확인한 재배송지와 실제 재출고를 기록했습니다'); expect(storage.size).toBe(0);
  });
  it('a denied/due context shows metadata and cannot be submitted as either operation', async () => {
    contextOverrides = { allowed: false, blocker: 'claim_contact_retention_due', piiState: 'unavailable', unavailableReason: 'retention_due', sourceKind: null, referenceOnly: false, address: null, signedContext: null, expiresAt: null };
    await load(); expect(nodes.some(node => node.type === 'form')).toBe(false); expect(screen()).toContain('주소 보관기간이 지나');
    expect(mocks.change).not.toHaveBeenCalled(); expect(mocks.reship).not.toHaveBeenCalled();
  });
  it.each(['claim_stage', 'collection_started', 'financial_state', 'not_applicable'])('does not describe a blocked %s context as an unknown mutation outcome', async blocker => {
    contextOverrides = { allowed: false, blocker, signedContext: null, expiresAt: null };
    await load(); expect(nodes.some(node => node.type === 'form')).toBe(false);
    expect(screen()).not.toContain(claimContactError('claim_contact_outcome_unknown').message);
    expect(storage.size).toBe(0); expect(mocks.change).not.toHaveBeenCalled();
  });
});
