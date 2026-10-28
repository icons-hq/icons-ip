import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), load: vi.fn(), refresh: vi.fn(), close: vi.fn(), replace: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock('@/app/admin/claim-type-conversion-actions', () => ({ convertClaimTypeAction: mocks.save, readClaimTypeChangeAction: mocks.read, loadClaimTypeContextAction: mocks.load }));
import { ClaimTypeConversionPanel } from './ClaimTypeConversion';
import { conversionContext as context, conversionReceipt as receipt } from '@/lib/orders/claim-type-conversion.fixture';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; type?: string; busy?: boolean; onClose?: () => void; onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
let embedded = false;
function render() { hooks.index = 0; hooks.refIndex = 0; return ClaimTypeConversionPanel({ initial: context, onClose: mocks.close, embedded }); }
function change(label: string, value: string | boolean) { const parent = all(render()).find(e => e.type === 'label' && text(e).startsWith(label)); const input = all(parent).find(e => e.type === 'input'); if (!input) throw new Error(label); input.props.onChange?.({ target: { value, checked: value } }); }
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(e => e.type === 'button' && text(e) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
beforeEach(() => { hooks.state = []; hooks.refs = []; embedded = false; vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); });
it('저장 응답 소실 후 재조회 없음과 확정 오류에도 첫 본문을 고정한다', async () => {
 mocks.save.mockResolvedValueOnce({ error: 'response lost', uncertain: true }).mockResolvedValueOnce({ error: '권한 변경', uncertain: false });
 change('고객 합의 근거', receipt.agreement); change('고객과 교환', true); await submit();
 const original = structuredClone(mocks.save.mock.calls[0][0]); await click('같은 요청 결과 확인');
 change('고객 합의 근거', '늦게 도착한 변경'); await click('같은 내용으로 재시도'); expect(mocks.save.mock.calls[1][0]).toEqual(original);
 expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(true); await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
 mocks.read.mockResolvedValue({ receipt: { ...receipt, id: original.id } }); await click('같은 요청 결과 확인');
 expect(mocks.replace).toHaveBeenCalledWith(`/admin/sales/claims/exchanges/${receipt.claimId}`); await click('닫기'); expect(mocks.close).toHaveBeenCalledOnce();
});
it('충돌 후 문맥을 갱신하며 합의문을 보존하고 동의는 다시 받는다', async () => {
 mocks.save.mockResolvedValue({ error: '다른 처리', conflict: true }); change('고객 합의 근거', receipt.agreement); change('고객과 교환', true); await submit();
 mocks.load.mockResolvedValue({ context: { ...context, revision: 4 } }); await click('최신 요청 상태 확인');
 expect(all(render()).find(e => e.type === 'button' && text(e) === '교환 전환 확정')?.props.disabled).toBe(true);
 change('고객과 교환', true); await submit(); expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 4, agreement: receipt.agreement });
});
it('같은 렌더의 연속 제출을 한 번으로 제한하고 다른 주문 결과를 거절한다', async () => {
 let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 change('고객 합의 근거', receipt.agreement); change('고객과 교환', true); const form = all(render()).find(e => e.type === 'form')!;
 form.props.onSubmit?.({ preventDefault: () => {} }); form.props.onSubmit?.({ preventDefault: () => {} }); expect(mocks.save).toHaveBeenCalledOnce();
 finish({ receipt: { ...receipt, id: mocks.save.mock.calls[0][0].id, orderId: receipt.claimId } }); await settle();
 expect(text(render())).toContain('현재 요청과 다른 저장 결과'); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('목록 위 팝업(R8)에서 전환하면 전환된 유형의 목록 위 팝업으로 다시 연다', async () => {
 embedded = true; mocks.save.mockImplementationOnce(async (request: { id: string }) => ({ receipt: { ...receipt, id: request.id } }));
 change('고객 합의 근거', receipt.agreement); change('고객과 교환', true); await submit();
 expect(mocks.replace).toHaveBeenCalledWith(`/admin/sales/claims/exchanges?claimId=${receipt.claimId}`, { scroll: false });
 expect(mocks.refresh).toHaveBeenCalled();
});
