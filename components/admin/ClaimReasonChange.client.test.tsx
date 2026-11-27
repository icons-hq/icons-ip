import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), load: vi.fn(), refresh: vi.fn(), replace: vi.fn(), close: vi.fn() }));
/* useEffect는 실행하지 않고 모아 둔다. 진입 칸이 미리 읽는 시험에서만 직접 부른다. */
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock('@/app/admin/claim-reason-change-actions', () => ({ changeClaimReasonAction: mocks.save, readClaimReasonChangeAction: mocks.read, loadClaimReasonContextAction: mocks.load }));
const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/screens/ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
import { ClaimReasonChange, ClaimReasonChangePanel } from './ClaimReasonChange';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { claimReasonError } from '@/lib/orders/claim-reason-change';
import { reasonContext, reasonReceipt as receipt, reasonRequest, returnReasonContext, returnReasonReceipt } from '@/lib/orders/claim-reason-change.fixture';
let context = structuredClone(reasonContext);
let confirm = stubAdminConfirm(true);
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string; checked?: boolean; id?: string; htmlFor?: string; type?: string; maxLength?: number; minLength?: number; required?: boolean;
  onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return ClaimReasonChangePanel({ initial: context, onClose: mocks.close }); }
/* kit Label의 htmlFor로 같은 id의 칸을 찾는다. */
function input(label: string) {
  const elements = all(render()); const target = elements.find(element => element.type === Label && text(element).startsWith(label))?.props.htmlFor;
  const field = elements.find(element => target && element.props.id === target); if (!field) throw new Error(label); return field;
}
function change(label: string, value: string) { input(label).props.onChange?.({ target: { value } }); }
async function settle() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(element => element.type === Button && text(element) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
function fill() { change('사유 분류', reasonRequest.reasonType); change('고객용 설명', reasonRequest.reason); change('정정 사유', reasonRequest.agreement); }
beforeEach(() => { context = structuredClone(reasonContext); hooks.state = []; hooks.refs = []; hooks.effects = []; vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });

it('응답 소실 뒤 읽기 없음·권한 오류에도 같은 operation과 입력을 고정하고 재시도는 다시 묻지 않는다', async () => {
  mocks.save.mockResolvedValueOnce({ error: 'response lost', uncertain: true }).mockResolvedValueOnce({ error: '권한 변경', uncertain: false });
  fill(); await submit(); const original = structuredClone(mocks.save.mock.calls[0][0]);
  expect(confirm).toHaveBeenCalledOnce(); expect(original).toMatchObject({ confirmed: true, feeReviewed: false, reasonType: 'defect' });
  await click('저장됐는지 확인'); expect(text(render())).toContain('아직 저장된 내용이 없습니다'); change('고객용 설명', '다른 정정 내용'); await click('같은 내용으로 다시 저장');
  expect(mocks.save.mock.calls[1][0]).toEqual(original); expect(confirm).toHaveBeenCalledOnce();
  expect(all(render()).find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
  await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ receipt: { ...receipt, id: original.id } }); await click('저장됐는지 확인');
  expect(mocks.refresh).toHaveBeenCalledOnce(); expect(text(render())).toContain('현재 사유: 상품 하자·오배송 / ' + receipt.toReason); await click('닫기'); expect(mocks.close).toHaveBeenCalledOnce();
});
it('확인창에서 취소하면 저장하지 않고 입력을 그대로 둔다', async () => {
  confirm.restore(); confirm = stubAdminConfirm(false);
  fill(); await submit();
  expect(confirm).toHaveBeenCalledOnce(); expect(confirm.mock.calls[0][0]).toContain('단순 변심 → 상품 하자·오배송');
  expect(mocks.save).not.toHaveBeenCalled(); expect(input('고객용 설명').props.value).toBe(reasonRequest.reason);
  expect(all(render()).find(element => element.type === 'fieldset')?.props.disabled).toBe(false);
});
it('버전 충돌은 내용을 보존하고 최신 요청으로 저장할 때 다시 확인한다', async () => {
  mocks.save.mockResolvedValue({ error: '충돌', conflict: true }); fill(); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, revision: 3, reason: '다른 운영자의 정정 내용' } }); await click('최신 상태 불러오기');
  expect(input('고객용 설명').props.value).toBe(reasonRequest.reason); expect(input('정정 사유').props.value).toBe(reasonRequest.agreement);
  await submit();
  expect(confirm).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 3, reason: reasonRequest.reason });
});
it('계정이나 유형이 바뀌면 이전 계정의 내부 근거를 버린다', async () => {
  mocks.save.mockResolvedValue({ error: '충돌', conflict: true }); fill(); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, actorId: context.orderId, revision: 3 } }); await click('최신 상태 불러오기');
  expect(input('고객용 설명').props.value).toBe(context.reason); expect(input('정정 사유').props.value).toBe('');
});
it('연속 제출과 타 주문 결과를 막고 기존 비용은 확인창에서 함께 확인한다', async () => {
  context.fee = { kind: 'exchange_shipping', amount: 3000, note: '기존 합성 비용 기록', confirmedAt: context.requestedAt };
  fill();
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const form = all(render()).find(element => element.type === 'form')!; form.props.onSubmit?.({ preventDefault: () => {} }); form.props.onSubmit?.({ preventDefault: () => {} });
  await settle();
  expect(confirm).toHaveBeenCalledOnce(); expect(confirm.mock.calls[0][0]).toContain('기존 운영 확인액 3,000원(기존 합성 비용 기록)은 바뀌지 않습니다');
  expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ feeReviewed: true });
  finish({ receipt: { ...receipt, id: mocks.save.mock.calls[0][0].id, feeReviewed: true, orderId: context.claimId } }); await settle();
  expect(text(render())).toContain('맞지 않습니다'); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('무변경 저장은 알림 없이 완료되며 오래된 기한 분류는 선택할 수 없다', async () => {
  context.canUseChangeOfMind = false; context.reasonType = 'defect'; context.originalReasonType = 'defect';
  const option = all(render()).find(element => element.type === NativeSelectOption && element.props.value === 'change_of_mind'); expect(option?.props.disabled).toBe(true);
  change('정정 사유', reasonRequest.agreement);
  mocks.save.mockImplementation(async request => ({ receipt: { ...receipt, id: request.id, fromReasonType: context.reasonType, toReasonType: context.reasonType,
    fromReason: context.reason, toReason: context.reason, resultRevision: context.revision, changed: false } }));
  await submit(); expect(text(render())).toContain('고객 알림을 추가하지 않았습니다'); expect(mocks.refresh).not.toHaveBeenCalled();
});
/* CLM-029: 반품도 같은 패널이다. 지금 사유의 반품배송비 차감을 보이고, 저장 결과가 차감 전후를 말한다. */
it('반품 사유 정정은 반품배송비 차감을 보이고 저장 결과에 차감 전후를 남긴다', async () => {
  context = structuredClone(returnReasonContext);
  const before = text(render());
  expect(before).toContain('반품 사유 정정'); expect(before).toContain('지금 사유로는 환불 금액에서 반품배송비 3,000원을 뺍니다.');
  fill();
  mocks.save.mockImplementation(async request => ({ receipt: { ...returnReasonReceipt, id: request.id, toReason: request.reason, agreement: request.agreement } }));
  await submit();
  expect(confirm.mock.calls[0][0]).toContain('반품배송비를 빼지 않습니다(지금 차감 예정 3,000원 → 0원).');
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(text(render())).toContain('반품 사유를 정정하고 고객에게 앱 알림을 남겼습니다. 반품배송비 차감이 3,000원에서 0원으로 바뀌었습니다.');
});
it('환불 접수 뒤 막힌 반품은 반품배송비를 돌려주는 다음 할 일과 함께 정정 칸을 열지 않는다', () => {
  context = { ...structuredClone(returnReasonContext), stage: 'processing', allowed: false, blocker: 'claim_reason_stage_unavailable',
    returnFee: { ...returnReasonContext.returnFee!, deductionAmount: null } };
  const html = text(render());
  expect(html).toContain('[환불 접수] 때 정해져 바뀌지 않습니다'); expect(html).toContain('결제 담당에게 요청해주세요');
  expect(html).not.toContain('지금 사유로는');
  expect(all(render()).some(element => element.type === 'form')).toBe(false);
});
/* m27 G4-5: 목록 위 클레임 팝업(R8) 안에서 사유 정정을 기다리는 동안 팝업이 닫히지 않게 알린다. */
it('사유 정정 저장을 기다리는 동안 팝업에 처리 중을 알린다', async () => {
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(); expect(busy).toHaveBeenLastCalledWith(false);
  fill(); all(render()).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle();
  render(); expect(busy).toHaveBeenLastCalledWith(true);
  finish({ error: '충돌', conflict: true }); await settle();
  render(); expect(busy).toHaveBeenLastCalledWith(false);
});

/* D-18·D-19·D-20: 칸 이름이 말한 글자 수와 입력 제한이 같고, 필수 칸은 어디에 보이는지 말하며, 버튼은 하는 일을 말한다. */
it('고객용 설명 200자·정정 사유 500자로 입력을 막고 글자 수와 보이는 곳을 말한다', () => {
  const html = text(render());
  expect(html).toContain('고객용 설명 (필수)'); expect(html).toContain('정정 사유 (필수)');
  expect(html).not.toContain('내부 고객 협의 근거'); expect(html).not.toContain('(1~200자)'); expect(html).not.toContain('(2~500자)');
  expect(input('고객용 설명').props).toMatchObject({ minLength: 1, maxLength: 200, required: true });
  expect(input('정정 사유').props).toMatchObject({ minLength: 2, maxLength: 500, required: true });
  expect(html).toContain(`1~200자 · 지금 ${context.reason.length}자 · 고객 주문 상세와 앱 알림에 그대로 보입니다.`);
  expect(html).toContain('2~500자 · 지금 0자 · 고객과 협의한 내용입니다. 운영자만 보는 정정 이력에 남고 고객에게는 보이지 않습니다.');
  change('정정 사유', reasonRequest.agreement); expect(text(render())).toContain(`2~500자 · 지금 ${[...reasonRequest.agreement].length}자`);
  expect(html).not.toContain('고객과 확인한 실제 사유를 기록합니다');
  expect(html).toContain('접수일과 보류는 그대로이고, 새 사유의 신청 기한도 원래 접수일로 따집니다.');
});
it('저장 버튼은 [사유 고치기]이고 확인창이 고객 협의·영향을 묻는다', async () => {
  const requests: AdminConfirmRequest[] = []; confirm.restore();
  const restore = setAdminConfirmHandler(async request => { requests.push(request); return true; });
  try {
    expect(text(all(render()).find(element => element.type === Button && element.props.type === 'submit'))).toBe('사유 고치기');
    expect(text(render())).not.toContain('확정');
    mocks.save.mockImplementation(async request => ({ receipt: { ...receipt, id: request.id } }));
    fill(); await submit();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ title: '교환 사유 정정', confirmLabel: '사유 고치기', cancelLabel: '돌아가기' });
    expect(requests[0].message).toContain('단순 변심 → 상품 하자·오배송'); expect(requests[0].message).toContain('고객과 확인한 내용으로 저장하고 고객에게 앱 알림을 보냅니다.');
  } finally { restore(); }
});
it('입력이 규칙에 맞지 않으면 확인창 없이 칸마다 글자 수를 말한다', async () => {
  fill(); change('정정 사유', '가'); await submit();
  expect(confirm).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(text(render())).toContain('고객용 설명은 1~200자, 정정 사유는 2~500자로 적어 주세요.');
});
it('충돌 안내는 다른 사람이 먼저 바꿨다고 말하고, 불러온 뒤 눌러야 할 버튼 이름을 말한다', async () => {
  mocks.save.mockResolvedValue({ error: claimReasonError('PT409'), conflict: true }); fill(); await submit();
  expect(text(render())).toContain('다른 사람이 먼저 바꿨습니다. [최신 상태 불러오기]를 누르면 적은 내용은 그대로 두고 지금 상태를 다시 불러옵니다.');
  mocks.load.mockResolvedValue({ context: { ...context, revision: 3 } }); await click('최신 상태 불러오기');
  expect(text(render())).toContain('[사유 고치기]를 다시 눌러 주세요');
});

/* D-09: 못 고치는 단계는 눌러 보기 전에 알린다. 진입 칸이 미리 읽어 버튼 이름과 이유를 정한다. */
let entryType: 'exchange' | 'return' = 'exchange';
function entry() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return ClaimReasonChange({ claimId: context.claimId, claimType: entryType }); }
async function peek() { entry(); const cleanup = hooks.effects.at(-1)?.(); await settle(); return cleanup; }
const entryButton = () => text(all(entry()).find(element => element.type === Button));
it('진입 칸은 읽기 전에도 바꿀 수 있는 단계에서도 옛 이름 그대로다', async () => {
  entryType = 'exchange'; expect(entryButton()).toBe('교환 사유 정정 및 이력');
  mocks.load.mockResolvedValue({ context: structuredClone(reasonContext) }); await peek();
  expect(mocks.load).toHaveBeenCalledWith(context.claimId); expect(entryButton()).toBe('교환 사유 정정 및 이력'); expect(text(entry())).not.toContain('정정할 수 없습니다');
  entryType = 'return'; hooks.state = []; expect(entryButton()).toBe('반품 사유 정정 및 이력');
});
it('진입 칸은 못 고치는 단계면 이력 버튼으로 바꾸고 짧은 이유를 보인다', async () => {
  entryType = 'return';
  mocks.load.mockResolvedValue({ context: { ...structuredClone(returnReasonContext), stage: 'processing', allowed: false, blocker: 'claim_reason_stage_unavailable' } }); await peek();
  expect(entryButton()).toBe('반품 사유 정정 이력');
  const line = all(entry()).find(element => (element.props as { role?: string }).role === 'status');
  expect(text(line)).toBe(claimReasonError(undefined, 'claim_reason_stage_unavailable')); expect(text(line)).toContain('[환불 접수] 전까지');
  /* 긴 안내(결제 담당 요청)는 눌러서 연 창에 있다. */
  mocks.load.mockResolvedValue({ context: { ...structuredClone(returnReasonContext), stage: 'processing', allowed: false, blocker: 'claim_reason_stage_unavailable' } });
  all(entry()).find(element => element.type === Button)!.props.onClick?.(); await settle();
  const opened = entry(); expect(isValidElement(opened) && opened.type === ClaimReasonChangePanel).toBe(true);
});
it('진입 칸은 미리 읽지 못하면 그대로 두고, 창을 연 동안에는 미리 읽지 않는다', async () => {
  entryType = 'exchange'; mocks.load.mockRejectedValue(new Error('network')); await peek(); expect(entryButton()).toBe('교환 사유 정정 및 이력');
  mocks.load.mockResolvedValue({ error: '요청을 읽지 못했습니다.' }); await peek(); expect(entryButton()).toBe('교환 사유 정정 및 이력');
  mocks.load.mockResolvedValue({ context: structuredClone(reasonContext) });
  all(entry()).find(element => element.type === Button)!.props.onClick?.(); await settle(); mocks.load.mockClear();
  entry(); hooks.effects.at(-1)?.(); await settle(); expect(mocks.load).not.toHaveBeenCalled();
});
