import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), load: vi.fn(), refresh: vi.fn(), close: vi.fn(), replace: vi.fn() }));
/* useEffect는 실행하지 않고 모아 둔다. 진입 칸이 미리 읽는 시험에서만 직접 부른다. */
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
const navigationStart = vi.hoisted(() => vi.fn());
vi.mock('@/lib/admin/navigation-pending', () => ({ startAdminNavigation: navigationStart }));
vi.mock('@/app/admin/claim-type-conversion-actions', () => ({ convertClaimTypeAction: mocks.save, readClaimTypeChangeAction: mocks.read, loadClaimTypeContextAction: mocks.load }));
const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/screens/ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
import { ClaimTypeConversion, ClaimTypeConversionPanel } from './ClaimTypeConversion';
import { ClaimTransferBankField } from './ClaimTransferBankField';
import { conversionContext, conversionReceipt as receipt } from '@/lib/orders/claim-type-conversion.fixture';
import { CLAIM_TYPE_AGREEMENT_ERROR, claimTypeError } from '@/lib/orders/claim-type-conversion';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; type?: string; id?: string; htmlFor?: string; value?: string; busy?: boolean; maxLength?: number; minLength?: number; required?: boolean;
  onClose?: () => void; onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
let embedded = false; let context = structuredClone(conversionContext);
function render() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return ClaimTypeConversionPanel({ initial: context, onClose: mocks.close, embedded }); }
/* 합의 근거 칸: 이름표(label htmlFor)가 가리키는 같은 id의 칸. 계좌 칸은 이름표가 칸을 감싼다. */
function agreementField() {
  const elements = all(render()); const target = elements.find(e => e.type === 'label' && text(e).startsWith('고객 합의 근거'))?.props.htmlFor;
  const found = elements.find(e => target && e.props.id === target); if (!found) throw new Error('고객 합의 근거'); return found;
}
function wrapped(label: string) { const parent = all(render()).find(e => e.type === 'label' && text(e).startsWith(label)); const input = all(parent).find(e => e.type === 'input'); if (!input) throw new Error(label); return input; }
/* 은행 칸은 새 작은 부품(ClaimTransferBankField)이라 이 시험은 펼치지 않고 부품에 넘긴 값·콜백을 본다. 부품 자체는 ClaimTransferBankField 시험이 본다. */
function bankField() {
  const found = all(render()).find(e => e.type === ClaimTransferBankField); if (!found) throw new Error('은행');
  return found as unknown as ReactElement<{ value: string; required?: boolean; id: string; onChange: (value: string) => void }>;
}
function change(label: string, value: string) { if (label === '은행') { bankField().props.onChange(value); return; } (label === '고객 합의 근거' ? agreementField() : wrapped(label)).props.onChange?.({ target: { value } }); }
async function settle() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(e => e.type === 'button' && text(e) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
const fieldsetDisabled = () => all(render()).find(e => e.type === 'fieldset')?.props.disabled;
const submitButton = () => all(render()).find(e => e.type === 'button' && e.props.type === 'submit');
function captureConfirm(answer: boolean) {
  const requests: AdminConfirmRequest[] = []; const restore = setAdminConfirmHandler(async request => { requests.push(request); return answer; });
  return { requests, restore };
}
let confirm = captureConfirm(true);
beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.effects = []; embedded = false; context = structuredClone(conversionContext); vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); confirm = captureConfirm(true); });
afterEach(() => { confirm.restore(); });
it('저장 응답 소실 후 재조회 없음과 확정 오류에도 첫 본문을 고정하고, 다시 저장할 때는 묻지 않는다', async () => {
 mocks.save.mockResolvedValueOnce({ error: 'response lost', uncertain: true }).mockResolvedValueOnce({ error: '권한 변경', uncertain: false });
 change('고객 합의 근거', receipt.agreement); await submit();
 const original = structuredClone(mocks.save.mock.calls[0][0]); expect(confirm.requests).toHaveLength(1); expect(original).toMatchObject({ toType: 'exchange', confirmed: true });
 await click('저장됐는지 확인'); expect(text(render())).toContain('아직 저장된 내용이 없습니다');
 change('고객 합의 근거', '늦게 도착한 변경'); await click('같은 내용으로 다시 저장'); expect(mocks.save.mock.calls[1][0]).toEqual(original); expect(confirm.requests).toHaveLength(1);
 expect(fieldsetDisabled()).toBe(true); await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
 mocks.read.mockResolvedValue({ receipt: { ...receipt, id: original.id } }); await click('저장됐는지 확인');
 expect(mocks.replace).toHaveBeenCalledWith(`/admin/sales/claims/exchanges/${receipt.claimId}`); await click('닫기'); expect(mocks.close).toHaveBeenCalledOnce();
});
it('충돌 후 문맥을 갱신하며 합의문을 보존하고, 다시 누르면 확인창을 새로 묻는다', async () => {
 mocks.save.mockResolvedValue({ error: '다른 사람이 먼저 바꿨습니다.', conflict: true }); change('고객 합의 근거', receipt.agreement); await submit();
 expect(all(render()).some(e => e.type === 'button' && text(e) === '최신 상태 불러오기')).toBe(true);
 mocks.load.mockResolvedValue({ context: { ...context, revision: 4 } }); await click('최신 상태 불러오기');
 expect(agreementField().props.value).toBe(receipt.agreement); expect(text(render())).toContain('[교환으로 바꾸기]를 다시 눌러 주세요');
 await submit(); expect(confirm.requests).toHaveLength(2); expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 4, agreement: receipt.agreement });
});
it('같은 렌더의 연속 제출을 한 번으로 제한하고 다른 주문 결과를 거절한다', async () => {
 let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 change('고객 합의 근거', receipt.agreement); const form = all(render()).find(e => e.type === 'form')!;
 form.props.onSubmit?.({ preventDefault: () => {} }); form.props.onSubmit?.({ preventDefault: () => {} }); await settle();
 expect(confirm.requests).toHaveLength(1); expect(mocks.save).toHaveBeenCalledOnce();
 finish({ receipt: { ...receipt, id: mocks.save.mock.calls[0][0].id, orderId: receipt.claimId } }); await settle();
 expect(text(render())).toContain('맞지 않습니다'); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('목록 위 팝업(R8)에서 전환하면 전환된 유형의 목록 위 팝업으로 다시 연다', async () => {
 embedded = true; mocks.save.mockImplementationOnce(async (request: { id: string }) => ({ receipt: { ...receipt, id: request.id } }));
 change('고객 합의 근거', receipt.agreement); await submit();
 expect(mocks.replace).toHaveBeenCalledWith(`/admin/sales/claims/exchanges?claimId=${receipt.claimId}`, { scroll: false });
 expect(mocks.refresh).toHaveBeenCalled();
});
it('목록 위 팝업(R8)에서 전환을 기다리는 동안 팝업을 닫지 못하게 알린다', async () => {
 let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 render(); expect(busy).toHaveBeenLastCalledWith(false);
 change('고객 합의 근거', receipt.agreement); all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle();
 render(); expect(busy).toHaveBeenLastCalledWith(true);
 finish({ error: '권한 변경', uncertain: false }); await settle(); render(); expect(busy).toHaveBeenLastCalledWith(false);
});
it('저장 뒤 화면 전환에도 메뉴 이동과 같은 대기 표시를 건다', async () => {
 mocks.save.mockResolvedValue({ receipt: { ...receipt, id: '' } });
 mocks.save.mockImplementationOnce(async (request: { id: string }) => ({ receipt: { ...receipt, id: request.id } }));
 change('고객 합의 근거', receipt.agreement); await submit();
 expect(navigationStart).toHaveBeenCalledExactlyOnceWith(`/admin/sales/claims/exchanges/${receipt.claimId}`);
 expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(`/admin/sales/claims/exchanges/${receipt.claimId}`);
});

/* 합의 확인 체크 칸이 없다. 합의 근거를 필수로 적게 하고, 누르면 확인창이 한 번 뜬다. */
it('전환 칸에는 확인 체크가 없고 합의 근거가 필수이며 어디에 보이는지와 글자 수를 말한다', () => {
 const tree = all(render()); const html = text(render());
 expect(tree.some(e => e.type === 'input' && e.props.type === 'checkbox')).toBe(false);
 expect(html).not.toContain('합의했습니다'); expect(html).not.toContain('전환 확정'); expect(html).not.toContain('주문 전체의 요청 유형을 변경합니다');
 expect(html).toContain('반품 → 교환 전환'); expect(html).toContain('접수일과 회수 기록은 그대로 두고 요청 유형을 바꿉니다.');
 expect(html).toContain('고객 합의 근거 (필수)'); expect(html).toContain('2~500자 · 지금 0자');
 expect(html).toContain('운영자만 보는 전환 이력에 남고, 고객 주문 상세에는 ‘고객 합의 확인’으로만 보입니다.');
 expect(agreementField().props).toMatchObject({ minLength: 2, maxLength: 500, required: true });
 expect(text(submitButton())).toBe('교환으로 바꾸기'); expect(submitButton()?.props.disabled).toBe(false);
 change('고객 합의 근거', receipt.agreement); expect(text(render())).toContain(`2~500자 · 지금 ${receipt.agreement.length}자`);
});
it('교환으로 바꾸기를 누르면 그대로인 것·달라지는 것·고객 알림을 확인창으로 한 번 묻는다', async () => {
 mocks.save.mockImplementation(async (request: { id: string }) => ({ receipt: { ...receipt, id: request.id } }));
 change('고객 합의 근거', receipt.agreement); await submit();
 expect(confirm.requests).toHaveLength(1);
 const [request] = confirm.requests;
 expect(request).toMatchObject({ title: '반품 → 교환 전환', confirmLabel: '교환으로 바꾸기', cancelLabel: '돌아가기' });
 expect(request.message).toContain(`고객과 합의한 대로 반품 요청을 교환 요청으로 바꿉니다. (지금 단계: ${adminClaimStageLabel('return', 'collecting')})`);
 expect(request.message).toContain('접수일과 회수 기록은 그대로입니다'); expect(request.message).toContain('배송비 청구가 있으면 취소됩니다'); expect(request.message).toContain('고객에게 앱 알림이 갑니다');
 expect(mocks.save).toHaveBeenCalledOnce();
});
it('확인창에서 돌아가면 저장하지 않고 적은 합의 근거를 그대로 둔다', async () => {
 confirm.restore(); confirm = captureConfirm(false);
 change('고객 합의 근거', receipt.agreement); await submit();
 expect(confirm.requests).toHaveLength(1); expect(mocks.save).not.toHaveBeenCalled();
 expect(agreementField().props.value).toBe(receipt.agreement); expect(fieldsetDisabled()).toBe(false);
});
it('입력이 규칙에 맞지 않으면 확인창 없이 어느 칸이 왜 안 되는지 말한다', async () => {
 change('고객 합의 근거', '합'); await submit();
 expect(confirm.requests).toHaveLength(0); expect(text(render())).toContain(CLAIM_TYPE_AGREEMENT_ERROR);
 context = { ...structuredClone(conversionContext), claimType: 'exchange' }; hooks.state = [];
 change('고객 합의 근거', receipt.agreement); change('은행', '합성은행'); await submit();
 expect(confirm.requests).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled(); expect(text(render())).toContain('은행, 계좌번호, 예금주를 모두 입력해주세요.');
});
it('교환→반품에서 무통장 주문은 환불계좌가 필수이고, 적으면 확인창이 계좌 저장을 말한다', async () => {
 context = { ...structuredClone(conversionContext), claimType: 'exchange', bankRequired: true, savedAccount: null };
 const html = text(render());
 expect(html).toContain('교환 → 반품 전환'); expect(html).toContain('무통장 주문이라 환불계좌가 필요합니다. 은행·계좌번호·예금주를 모두 적어 주세요.');
 expect(bankField().props.required).toBe(true); for (const label of ['계좌번호', '예금주']) expect(wrapped(label).props.required).toBe(true);
 change('고객 합의 근거', receipt.agreement); await submit();
 expect(text(render())).toContain(claimTypeError(undefined, 'claim_conversion_account_required')); expect(confirm.requests).toHaveLength(0);
 mocks.save.mockImplementation(async (request: { id: string }) => ({ receipt: { ...receipt, id: request.id, fromType: 'exchange', toType: 'return', accountSupplied: true } }));
 change('은행', '합성은행'); change('계좌번호', '1234567890'); change('예금주', '합성고객'); await submit();
 expect(confirm.requests[0]).toMatchObject({ title: '교환 → 반품 전환', confirmLabel: '반품으로 바꾸기' });
 expect(confirm.requests[0].message).toContain('환불계좌는 방금 적은 계좌로 저장됩니다.');
 expect(mocks.save.mock.calls[0][0]).toMatchObject({ toType: 'return', refundAccount: { bankName: '합성은행', accountNumber: '1234567890', accountHolder: '합성고객' } });
});
it('저장된 환불계좌가 있으면 바꿀 때만 적게 하고, 못 바꾸는 단계는 입력 칸 없이 이유만 보인다', () => {
 context = { ...structuredClone(conversionContext), claimType: 'exchange', bankRequired: true, savedAccount: { account: '신한 ***1234', holder: '홍*동' } };
 const html = text(render());
 expect(html).toContain('저장된 환불계좌: 신한 ***1234 · 홍*동. 바꿀 때만 아래 세 칸을 모두 적어 주세요.'); expect(bankField().props.required).toBe(false);
 hooks.state = []; context = { ...structuredClone(conversionContext), allowed: false, blocker: 'claim_conversion_reshipped' };
 const blocked = text(render());
 expect(blocked).toContain(claimTypeError(undefined, 'claim_conversion_reshipped')); expect(all(render()).some(e => e.type === 'form')).toBe(false);
 expect(blocked).not.toContain('요청 유형을 바꿉니다');
});

/* D-09: 못 바꾸는 단계는 눌러 보기 전에 알린다. 진입 칸이 미리 읽어 버튼 이름과 이유를 정한다. */
function entry() { hooks.index = 0; hooks.refIndex = 0; hooks.effects = []; return ClaimTypeConversion({ claimId: context.claimId, embedded }); }
async function peek() { entry(); const cleanup = hooks.effects.at(-1)?.(); await settle(); return cleanup; }
const buttonText = () => text(all(entry()).find(e => e.type === 'button'));
it('진입 칸은 읽기 전에도 옛 이름 그대로이고, 바꿀 수 있는 단계면 이름이 그대로다', async () => {
 expect(buttonText()).toBe('반품·교환 전환 및 이력');
 mocks.load.mockResolvedValue({ context: structuredClone(conversionContext) }); await peek();
 expect(mocks.load).toHaveBeenCalledWith(context.claimId); expect(buttonText()).toBe('반품·교환 전환 및 이력'); expect(text(entry())).not.toContain('바꿀 수 없습니다');
});
it('진입 칸은 못 바꾸는 단계면 이력 버튼으로 바꾸고 이유를 보인다', async () => {
 mocks.load.mockResolvedValue({ context: { ...structuredClone(conversionContext), allowed: false, blocker: 'claim_conversion_finance_started' } }); await peek();
 expect(buttonText()).toBe('반품·교환 전환 이력');
 const line = all(entry()).find(e => (e.props as { role?: string }).role === 'status');
 expect(text(line)).toBe(claimTypeError(undefined, 'claim_conversion_finance_started')); expect(text(line)).toContain('환불 처리가 이미 시작돼서');
});
it('진입 칸은 미리 읽지 못하면 그대로 두고, 눌렀을 때 읽어 창을 연다', async () => {
 mocks.load.mockRejectedValue(new Error('network')); await peek(); expect(buttonText()).toBe('반품·교환 전환 및 이력');
 mocks.load.mockResolvedValue({ error: '요청을 읽지 못했습니다.' }); await peek(); expect(buttonText()).toBe('반품·교환 전환 및 이력');
 mocks.load.mockResolvedValue({ context: structuredClone(conversionContext) });
 all(entry()).find(e => e.type === 'button')!.props.onClick?.(); await settle();
 const opened = entry(); expect(isValidElement(opened) && opened.type === ClaimTypeConversionPanel).toBe(true);
});
it('창을 연 동안에는 미리 읽지 않는다', async () => {
 mocks.load.mockResolvedValue({ context: structuredClone(conversionContext) });
 all(entry()).find(e => e.type === 'button')!.props.onClick?.(); await settle(); mocks.load.mockClear();
 entry(); hooks.effects.at(-1)?.(); await settle(); expect(mocks.load).not.toHaveBeenCalled();
});
