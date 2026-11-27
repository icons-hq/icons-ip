import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/* 이 파일은 컴포넌트 함수를 직접 불러 요소 트리를 걷는다(렌더러 없음). 상태·ref는 호출 순서로 보관한다. */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
  useTransition: () => [false, (work: () => unknown) => { void work(); }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/virtual-account-refund-actions', () => ({ saveVirtualAccountRefundAccountAction: mocks.save }));
vi.mock('@/components/admin/useAdminLeaveGuard', () => ({ useAdminLeaveGuard: () => ({}) }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: () => {} }));
import { VirtualAccountRefundAccountEntry } from './VirtualAccountRefundAccountEntry';
import { Button } from '@/components/admin/kit/ui/button';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

const CLAIM_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
/* 계좌는 한눈에 가짜인 값만 쓴다. */
const account = { bankName: '신한은행', accountNumber: '000-000-123456', accountHolder: '김엑스', reason: '11/26 고객 전화로 계좌 확인' };
type Element = ReactElement<{ children?: ReactNode; id?: string; disabled?: boolean; value?: string; role?: string; title?: ReactNode; hint?: string; label?: string;
  onClick?: () => void; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void }>;
let props: { claimId: string; claimType: string; lastErrorCode: string | null; orderId: string; refundAmount?: number | null };
let confirm = stubAdminConfirm(true);

function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render(): Element[] {
  hooks.index = 0; hooks.refIndex = 0;
  const outer = VirtualAccountRefundAccountEntry(props) as ReactElement<Record<string, unknown>> | null;
  if (!outer) return [];
  return all((outer.type as (input: unknown) => ReactNode)(outer.props));
}
const input = (suffix: string) => { const field = render().find(element => element.props.id === `va-refund-account-${CLAIM_ID}-${suffix}`); if (!field) throw new Error(suffix); return field; };
function fill(values: Partial<typeof account> = {}) {
  const next = { ...account, ...values };
  input('bank').props.onChange?.({ target: { value: next.bankName } }); input('number').props.onChange?.({ target: { value: next.accountNumber } });
  input('holder').props.onChange?.({ target: { value: next.accountHolder } }); input('reason').props.onChange?.({ target: { value: next.reason } });
}
async function settle() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
async function submit() { render().find(element => element.type === 'form')!.props.onSubmit?.({ preventDefault: () => {} }); await settle(); }
const buttons = () => render().filter(element => element.type === Button).map(element => text(element));
const shown = (role: string) => text(render().filter(element => element.type === 'p' && element.props.role === role));

beforeEach(() => {
  hooks.state = []; hooks.refs = []; vi.clearAllMocks();
  props = { claimId: CLAIM_ID, claimType: 'cancel', lastErrorCode: 'provider_refund_account_required', orderId: ORDER_ID };
  mocks.save.mockResolvedValue({ ok: true, message: '저장 결과 안내' });
  confirm = stubAdminConfirm(true);
});
afterEach(() => { confirm.restore(); });

it('계좌 때문에 멈춘 취소·반품에만 보이고, 멈춘 이유에 맞춰 다음에 할 일을 말한다', () => {
  expect(text(render())).toContain('고객이 전화나 문의로 계좌를 알려 주면 아래에 대신 적습니다.');
  expect(render()[0].props.title).toBe('환불 계좌가 없어 환불이 멈춰 있습니다');
  props.lastErrorCode = 'provider_refund_account_invalid';
  expect(render()[0].props.title).toBe('결제사가 환불 계좌를 받지 않았습니다');
  expect(text(render())).toContain('은행·계좌번호·예금주가 통장과 같은지 확인해 아래에 대신 적습니다.');
  expect(text(render())).not.toContain('클레임');
  props.lastErrorCode = 'provider_unavailable'; expect(render()).toEqual([]);
  props.lastErrorCode = 'provider_refund_account_required'; props.claimType = 'exchange'; expect(render()).toEqual([]);
});

it('취소 건은 저장 전에 적은 계좌를 가리지 않고 되읽고, 확인해야 저장한다', async () => {
  props.refundAmount = 31000;
  expect(buttons()).toEqual(['저장하고 환불 다시 요청']);
  fill(); await submit();
  expect(confirm).toHaveBeenCalledOnce();
  const asked = confirm.mock.calls[0][0];
  for (const part of ['은행: 신한은행', '계좌번호: 000-000-123456', '예금주: 김엑스', '환불 금액: 31,000원', '저장하면 이 계좌로 환불을 바로 다시 요청합니다.']) expect(asked, part).toContain(part);
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ claimId: CLAIM_ID, orderId: ORDER_ID, claimType: 'cancel', ...account });
  expect(mocks.save.mock.calls[0][0].operationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(shown('status')).toBe('저장 결과 안내'); expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(input('number').props.value).toBe('');
});

it('확인창에서 돌아가면 저장하지 않고 적은 내용을 그대로 둔다', async () => {
  confirm.restore(); confirm = stubAdminConfirm(false);
  fill(); await submit();
  expect(confirm).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  expect(input('number').props.value).toBe(account.accountNumber); expect(mocks.refresh).not.toHaveBeenCalled();
});

it('반품 건은 저장만 한다고 말한다 — 버튼 이름과 확인창이 다르다', async () => {
  props.claimType = 'return';
  expect(buttons()).toEqual(['환불 계좌 저장']);
  fill(); await submit();
  expect(confirm.mock.calls[0][0]).toContain('저장만 하고 환불은 아직 하지 않습니다.');
  expect(confirm.mock.calls[0][0]).not.toContain('바로 다시 요청');
  expect(confirm.mock.calls[0][0]).not.toContain('환불 금액');
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ claimType: 'return' });
});

it('형식이 맞지 않으면 확인창을 띄우지 않고 어느 칸을 고칠지 말한다', async () => {
  fill({ accountNumber: '0000000' }); await submit();
  expect(confirm).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  expect(shown('alert')).toBe('계좌번호를 다시 확인해주세요. 숫자 8~20자리. 하이픈(-)은 넣어도 됩니다.');
  expect(render().find(element => element.props.label === '계좌번호')?.props.hint).toBe('숫자 8~20자리. 하이픈(-)은 넣어도 됩니다.');
});

it('저장됐는지 모르면 입력을 잠그고 같은 내용으로 [저장됐는지 확인]만 받는다 — 다시 묻지 않는다', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, error: '저장됐는지 확인하지 못했습니다.', uncertain: true });
  fill(); await submit();
  expect(buttons()).toEqual(['저장됐는지 확인', '그만두고 다시 하기']);
  expect(render().find(element => element.type === 'fieldset')?.props.disabled).toBe(true);
  await submit();
  expect(confirm).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0]);
  expect(buttons()).toEqual(['저장하고 환불 다시 요청']); expect(shown('status')).toBe('저장 결과 안내');
});

it('저장 호출이 끊겨도 저장됐는지 모르는 상태로 남기고, [그만두고 다시 하기]는 입력을 다시 연다', async () => {
  mocks.save.mockRejectedValueOnce(new Error('TEST network'));
  fill(); await submit();
  expect(shown('alert')).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
  const first = mocks.save.mock.calls[0][0].operationId;
  render().find(element => element.type === Button && text(element) === '그만두고 다시 하기')!.props.onClick?.();
  expect(render().find(element => element.type === 'fieldset')?.props.disabled).toBe(false);
  expect(input('number').props.value).toBe(account.accountNumber);
  /* 다시 열어 누르면 새 저장이라 확인창을 다시 띄우고 작업 번호도 새로 만든다. */
  await submit();
  expect(confirm).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls[1][0].operationId).not.toBe(first);
});

it('고칠 수 있는 거절은 입력을 잠그지 않는다', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, error: '이 계좌로는 결제사가 환불할 수 없습니다.' });
  fill(); await submit();
  expect(buttons()).toEqual(['저장하고 환불 다시 요청']);
  expect(render().find(element => element.type === 'fieldset')?.props.disabled).toBe(false);
  expect(shown('alert')).toBe('이 계좌로는 결제사가 환불할 수 없습니다.');
});
