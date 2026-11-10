import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
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
import { reasonContext, reasonReceipt as receipt, reasonRequest } from '@/lib/orders/claim-reason-change.fixture';
let context = structuredClone(reasonContext);
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string; checked?: boolean;
  onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; return ClaimReasonChangePanel({ initial: context, onClose: mocks.close }); }
function input(label: string) { const parent = all(render()).find(element => element.type === 'label' && text(element).startsWith(label)); const field = all(parent).find(element => element.type === 'input' || element.type === 'select'); if (!field) throw new Error(label); return field; }
function change(label: string, value: string | boolean) { input(label).props.onChange?.({ target: { value, checked: value } }); }
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(element => element.type === 'button' && text(element) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
function fill() { change('사유 분류', reasonRequest.reasonType); change('고객용 설명', reasonRequest.reason); change('내부 고객 협의 근거', reasonRequest.agreement); change('고객과 사유 정정', true); }
beforeEach(() => { context = structuredClone(reasonContext); hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); });

it('응답 소실 뒤 읽기 없음·권한 오류에도 같은 operation과 입력을 고정한다', async () => {
  mocks.save.mockResolvedValueOnce({ error: 'response lost', uncertain: true }).mockResolvedValueOnce({ error: '권한 변경', uncertain: false });
  fill(); await submit(); const original = structuredClone(mocks.save.mock.calls[0][0]);
  await click('같은 요청 결과 확인'); change('고객용 설명', '다른 정정 내용'); await click('같은 내용으로 재시도');
  expect(mocks.save.mock.calls[1][0]).toEqual(original); expect(all(render()).find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
  await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ receipt: { ...receipt, id: original.id } }); await click('같은 요청 결과 확인');
  expect(mocks.refresh).toHaveBeenCalledOnce(); expect(text(render())).toContain('현재 사유: 상품 하자·오배송 / ' + receipt.toReason); await click('닫기'); expect(mocks.close).toHaveBeenCalledOnce();
});
it('버전 충돌은 내용을 보존하고 현재 사유·비용에 대한 새 확인을 요구한다', async () => {
  mocks.save.mockResolvedValue({ error: '충돌', conflict: true }); fill(); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, revision: 3, reason: '다른 운영자의 정정 내용' } }); await click('최신 요청 상태 확인');
  expect(input('고객용 설명').props.value).toBe(reasonRequest.reason); expect(input('내부 고객 협의 근거').props.value).toBe(reasonRequest.agreement);
  expect(input('고객과 사유 정정').props.checked).toBe(false); change('고객과 사유 정정', true); await submit();
  expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 3, reason: reasonRequest.reason });
});
it('계정이나 유형이 바뀌면 이전 계정의 내부 근거와 확인을 버린다', async () => {
  mocks.save.mockResolvedValue({ error: '충돌', conflict: true }); fill(); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, actorId: context.orderId, revision: 3 } }); await click('최신 요청 상태 확인');
  expect(input('고객용 설명').props.value).toBe(context.reason); expect(input('내부 고객 협의 근거').props.value).toBe('');
  expect(input('고객과 사유 정정').props.checked).toBe(false);
});
it('연속 제출과 타 주문 결과를 막고 기존 비용 확인 없이 보내지 않는다', async () => {
  context.fee = { kind: 'exchange_shipping', amount: 3000, note: '기존 합성 비용 기록', confirmedAt: context.requestedAt };
  fill(); await submit(); expect(mocks.save).not.toHaveBeenCalled(); expect(text(render())).toContain('기존 비용 기록과 정정할 사유');
  change('기존 비용 기록과', true);
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const form = all(render()).find(element => element.type === 'form')!; form.props.onSubmit?.({ preventDefault: () => {} }); form.props.onSubmit?.({ preventDefault: () => {} });
  expect(mocks.save).toHaveBeenCalledOnce();
  finish({ receipt: { ...receipt, id: mocks.save.mock.calls[0][0].id, feeReviewed: true, orderId: context.claimId } }); await settle();
  expect(text(render())).toContain('현재 요청과 다른 저장 결과'); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('무변경 저장은 알림 없이 완료되며 오래된 기한 분류는 선택할 수 없다', async () => {
  context.canUseChangeOfMind = false; context.reasonType = 'defect'; context.originalReasonType = 'defect';
  const option = all(render()).find(element => element.type === 'option' && element.props.value === 'change_of_mind'); expect(option?.props.disabled).toBe(true);
  change('내부 고객 협의 근거', reasonRequest.agreement); change('고객과 사유 정정', true);
  mocks.save.mockImplementation(async request => ({ receipt: { ...receipt, id: request.id, fromReasonType: context.reasonType, toReasonType: context.reasonType,
    fromReason: context.reason, toReason: context.reason, resultRevision: context.revision, changed: false } }));
  await submit(); expect(text(render())).toContain('고객 알림을 추가하지 않았습니다'); expect(mocks.refresh).not.toHaveBeenCalled();
});
/* m27 G4-5: 목록 위 클레임 팝업(R8) 안에서 사유 정정을 기다리는 동안 팝업이 닫히지 않게 알린다. */
it('사유 정정 저장을 기다리는 동안 팝업에 처리 중을 알린다', async () => {
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(); expect(busy).toHaveBeenLastCalledWith(false);
  fill(); all(render()).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
  render(); expect(busy).toHaveBeenLastCalledWith(true);
  finish({ error: '충돌', conflict: true }); await settle();
  render(); expect(busy).toHaveBeenLastCalledWith(false);
});
