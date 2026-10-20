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
vi.mock('@/app/admin/claim-hold-actions', () => ({ changeClaimHoldAction: mocks.save, readClaimHoldAction: mocks.read, loadClaimHoldContextAction: mocks.load }));
import { ClaimHoldPanel } from './ClaimHoldControl';
import { holdContext as context, holdReceipt as receipt } from '@/lib/orders/claim-hold.fixture';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string; checked?: boolean;
  onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render() { hooks.index = 0; hooks.refIndex = 0; return ClaimHoldPanel({ initial: context, onClose: mocks.close }); }
function input(label: string) { const parent = all(render()).find(element => element.type === 'label' && text(element).startsWith(label)); const field = all(parent).find(element => element.type === 'input'); if (!field) throw new Error(label); return field; }
function change(label: string, value: string | boolean) { input(label).props.onChange?.({ target: { value, checked: value } }); }
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }
async function click(label: string) { const button = all(render()).find(element => element.type === 'button' && text(element) === label); if (!button) throw new Error(label); button.props.onClick?.(); await settle(); }
async function submit() { all(render()).find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
beforeEach(() => { hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.read.mockResolvedValue({ receipt: null }); });

it('응답 소실 뒤 읽기 없음·권한 오류에도 최초 operation과 본문을 고정한다', async () => {
  mocks.save.mockResolvedValueOnce({ error: 'response lost', uncertain: true }).mockResolvedValueOnce({ error: '권한 변경', uncertain: false });
  change('보류 사유', receipt.note!); change('현재 반품 요청', true); await submit();
  const original = structuredClone(mocks.save.mock.calls[0][0]);
  await click('같은 요청 결과 확인'); change('보류 사유', '늦게 도착한 다른 입력을 전달합니다');
  await click('같은 내용으로 재시도'); expect(mocks.save.mock.calls[1][0]).toEqual(original);
  expect(all(render()).find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
  await click('닫기'); expect(mocks.close).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({ receipt: { ...receipt, id: original.id } }); await click('같은 요청 결과 확인');
  expect(mocks.refresh).toHaveBeenCalledOnce(); await click('닫기'); expect(mocks.close).toHaveBeenCalledOnce();
});
it('유형 전환 충돌을 읽으면 이전 보류 입력과 확인을 버리고 새 유형으로 안내한다', async () => {
  mocks.save.mockResolvedValue({ error: '다른 처리', conflict: true });
  change('보류 사유', receipt.note!); change('현재 반품 요청', true); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, claimType: 'exchange', revision: 3 } });
  await click('최신 요청 상태 확인');
  expect(input('보류 사유').props.value).toBe(''); expect(input('현재 교환 요청').props.checked).toBe(false);
  expect(mocks.replace).toHaveBeenCalledWith(`/admin/sales/claims/exchanges/${context.claimId}`);
  expect(all(render()).find(element => element.type === 'button' && text(element) === '보류 설정 확정')?.props.disabled).toBe(true);
});
it('같은 유형의 상태 충돌은 본문을 보존하고 새 확인을 요구한다', async () => {
  mocks.save.mockResolvedValue({ error: '다른 처리', conflict: true });
  change('보류 사유', receipt.note!); change('현재 반품 요청', true); await submit();
  mocks.load.mockResolvedValue({ context: { ...context, stage: 'collected', revision: 4 } }); await click('최신 요청 상태 확인');
  expect(input('보류 사유').props.value).toBe(receipt.note); expect(input('현재 반품 요청').props.checked).toBe(false);
  change('현재 반품 요청', true); await submit(); expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 4, note: receipt.note });
});
it('연속 제출을 막고 다른 주문의 receipt를 성공으로 표시하지 않는다', async () => {
  let finish!: (value: unknown) => void; mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  change('보류 사유', receipt.note!); change('현재 반품 요청', true);
  const form = all(render()).find(element => element.type === 'form')!;
  form.props.onSubmit?.({ preventDefault: () => {} }); form.props.onSubmit?.({ preventDefault: () => {} }); expect(mocks.save).toHaveBeenCalledOnce();
  finish({ receipt: { ...receipt, id: mocks.save.mock.calls[0][0].id, orderId: receipt.claimId } }); await settle();
  expect(text(render())).toContain('현재 요청과 다른 저장 결과'); expect(mocks.refresh).not.toHaveBeenCalled();
});
