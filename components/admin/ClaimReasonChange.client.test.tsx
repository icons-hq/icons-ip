import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), load: vi.fn(), refresh: vi.fn(), replace: vi.fn(), close: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {},
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock('@/app/admin/claim-reason-change-actions', () => ({ changeClaimReasonAction: mocks.save, readClaimReasonChangeAction: mocks.read, loadClaimReasonContextAction: mocks.load }));
const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/screens/ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
import { ClaimReasonChangePanel } from './ClaimReasonChange';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { reasonContext, reasonReceipt as receipt, reasonRequest, returnReasonContext, returnReasonReceipt } from '@/lib/orders/claim-reason-change.fixture';
let context = structuredClone(reasonContext);
let confirm = stubAdminConfirm(true);
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string; checked?: boolean; id?: string; htmlFor?: string;
  onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; return ClaimReasonChangePanel({ initial: context, onClose: mocks.close }); }
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
beforeEach(() => { context = structuredClone(reasonContext); hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); confirm = stubAdminConfirm(true); });
afterEach(() => { confirm.restore(); });

it('응답 소실 뒤 읽기 없음·권한 오류에도 같은 operation과 입력을 고정하고 재시도는 다시 묻지 않는다', async () => {
  mocks.save.mockResolvedValueOnce({ error: 'response lost', uncertain: true }).mockResolvedValueOnce({ error: '권한 변경', uncertain: false });
  fill(); await submit(); const original = structuredClone(mocks.save.mock.calls[0][0]);
  expect(confirm).toHaveBeenCalledOnce(); expect(original).toMatchObject({ confirmed: true, feeReviewed: false, reasonType: 'defect' });
  await click('같은 요청 결과 확인'); change('고객용 설명', '다른 정정 내용'); await click('같은 내용으로 재시도');
  expect(mocks.save.mock.calls[1][0]).toEqual(original); expect(confirm).toHaveBeenCalledOnce();
  expect(all(render()).find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
  await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ receipt: { ...receipt, id: original.id } }); await click('같은 요청 결과 확인');
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
  mocks.load.mockResolvedValue({ context: { ...context, revision: 3, reason: '다른 운영자의 정정 내용' } }); await click('최신 요청 상태 확인');
  expect(input('고객용 설명').props.value).toBe(reasonRequest.reason); expect(input('정정 사유').props.value).toBe(reasonRequest.agreement);
  await submit();
  expect(confirm).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 3, reason: reasonRequest.reason });
});
it('계정이나 유형이 바뀌면 이전 계정의 내부 근거를 버린다', async () => {
  mocks.save.mockResolvedValue({ error: '충돌', conflict: true }); fill(); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, actorId: context.orderId, revision: 3 } }); await click('최신 요청 상태 확인');
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
  expect(text(render())).toContain('이 요청과 맞지 않습니다'); expect(mocks.refresh).not.toHaveBeenCalled();
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
