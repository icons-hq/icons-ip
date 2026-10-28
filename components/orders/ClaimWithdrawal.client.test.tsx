import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), load: vi.fn(), refresh: vi.fn(), close: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/claim-withdrawal-actions', () => ({ submitAdminClaimWithdrawalAction: mocks.save, readAdminClaimWithdrawalAction: mocks.read, loadAdminClaimWithdrawalAction: mocks.load }));
const busy = vi.hoisted(() => vi.fn());
vi.mock('@/components/admin/screens/ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
import { ClaimWithdrawal, ClaimWithdrawalPanel } from './ClaimWithdrawal';
import { withdrawalContextFixture as context, withdrawalReceiptFixture as receipt } from '@/lib/orders/claim-withdrawal.fixture';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; type?: string; busy?: boolean; onClose?: () => void; onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; return ClaimWithdrawalPanel({ initial: context, operator: true, onClose: mocks.close }); }
function change(label: string, value: string | boolean) { const parent = all(render()).find(e => e.type === 'label' && text(e).startsWith(label)); const input = all(parent).find(e => e.type === 'input'); if (!input) throw new Error(label); input.props.onChange?.({ target: { value, checked: value } }); }
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(e => e.type === 'button' && text(e) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
beforeEach(() => { hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); });
it('미확정 전송·readback 없음·후속 확정오류에도 첫 요청을 고정한다', async () => {
 mocks.save.mockResolvedValueOnce({ error: 'response lost', uncertain: true }).mockResolvedValueOnce({ error: '권한 변경', uncertain: false });
 change('철회 사유', receipt.reason); change('고객과 철회', true); await submit();
 const original = structuredClone(mocks.save.mock.calls[0][0]); await click('같은 요청 결과 확인');
 change('철회 사유', '늦게 들어온 본문'); await click('같은 내용으로 재시도'); expect(mocks.save.mock.calls[1][0]).toEqual(original);
 expect(all(render()).find(e => e.type === 'fieldset')?.props.disabled).toBe(true); await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
 mocks.read.mockResolvedValue({ receipt: { ...receipt, id: original.id } }); await click('같은 요청 결과 확인'); expect(text(render())).toContain('반품 요청이 철회됐습니다.'); expect(mocks.refresh).toHaveBeenCalledOnce(); await click('닫기'); expect(mocks.close).toHaveBeenCalledOnce();
});
it('동시 처리 충돌은 사유를 보존하고 최신 문맥과 새 동의를 요구한다', async () => {
 mocks.save.mockResolvedValue({ error: '다른 처리', conflict: true }); change('철회 사유', '보존할 사유'); change('고객과 철회', true); await submit();
 mocks.load.mockResolvedValue({ context: { ...context, revision: 4 } }); await click('최신 요청 상태 확인');
 expect(all(render()).find(e => e.type === 'button' && text(e) === '반품 요청 철회 확정')?.props.disabled).toBe(true);
 change('고객과 철회', true); await submit(); expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 4, reason: '보존할 사유' });
});
it('같은 렌더의 연속 제출을 한 번으로 제한하고 다른 주문 receipt를 거절한다', async () => {
 let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 change('철회 사유', receipt.reason); change('고객과 철회', true); const form = all(render()).find(e => e.type === 'form')!;
 form.props.onSubmit?.({ preventDefault: () => {} }); form.props.onSubmit?.({ preventDefault: () => {} }); expect(mocks.save).toHaveBeenCalledOnce();
 finish({ receipt: { ...receipt, id: mocks.save.mock.calls[0][0].id, orderId: receipt.claimId } }); await settle();
 expect(text(render())).toContain('현재 요청과 다른 결과'); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('운영자 화면에는 철회 버튼 없이 철회된 요청의 이력만 열고, 구매자는 직접 철회한다(R7)', () => {
 hooks.index = 0; hooks.refIndex = 0;
 expect(ClaimWithdrawal({ claimId: receipt.claimId, stage: 'requested', operator: true })).toBeNull();
 hooks.index = 0; hooks.refIndex = 0;
 expect(text(ClaimWithdrawal({ claimId: receipt.claimId, stage: 'withdrawn', operator: true }))).toContain('요청 철회 이력');
 hooks.index = 0; hooks.refIndex = 0;
 expect(text(ClaimWithdrawal({ claimId: receipt.claimId, stage: 'requested' }))).toContain('요청 철회하기');
});
/* m27 G4-5: 목록 위 클레임 팝업(R8) 안에서 철회 처리·이력 확인을 기다리는 동안 팝업이 닫히지 않게 알린다.
   구매자 화면처럼 팝업 밖에서는 훅이 아무 일도 하지 않는다(ClaimPreviewDialog 테스트). */
it('철회 저장과 이력 확인을 기다리는 동안 팝업에 처리 중을 알린다', async () => {
 let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 render(); expect(busy).toHaveBeenLastCalledWith(false);
 change('철회 사유', receipt.reason); change('고객과 철회', true);
 all(render()).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} });
 render(); expect(busy).toHaveBeenLastCalledWith(true);
 finish({ error: '다른 처리', conflict: true }); await settle();
 render(); expect(busy).toHaveBeenLastCalledWith(false);

 hooks.state = []; hooks.refs = []; busy.mockClear();
 let loaded!: (value: unknown) => void; mocks.load.mockImplementationOnce(() => new Promise(resolve => { loaded = resolve; }));
 const entry = () => { hooks.index = 0; hooks.refIndex = 0; return ClaimWithdrawal({ claimId: receipt.claimId, stage: 'withdrawn', operator: true }); };
 all(entry()).find(e => e.type === 'button')!.props.onClick?.();
 entry(); expect(busy).toHaveBeenLastCalledWith(true);
 loaded({ error: '읽기 실패' }); await settle();
 entry(); expect(busy).toHaveBeenLastCalledWith(false);
});
