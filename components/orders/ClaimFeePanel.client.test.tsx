import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 배송비 청구 칸은 고객 주문 화면과 운영자의 요청 상세가 함께 쓴다.
 * 고객 쪽은 글자와 동작이 그대로이고(확인 체크 포함), 운영자 쪽은 확인 체크 없이 저장 전 확인창 한 번으로 묻는다.
 */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), change: vi.fn(), read: vi.fn(), readOrder: vi.fn(), confirm: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }]; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: () => {} }));
vi.mock('@/components/claim-contact/ClaimContactSession', () => ({ ClaimContactSession: ({ actorId, children }: { actorId: string; children: (identity: unknown, scope: unknown) => ReactNode }) => children({ actorId, sessionId: 'session-1' }, { capture: () => ({}), canApply: () => true }) }));
vi.mock('@/app/orders/claim-fee-actions', () => ({ changeClaimFeeAction: mocks.change, readClaimFeesAction: mocks.read, readOrderClaimFeesAction: mocks.readOrder }));
vi.mock('@/lib/admin/confirm', () => ({ adminConfirm: mocks.confirm }));

import { ClaimFeePanel, OrderClaimFees } from './ClaimFeePanel';
import { claimFeeError } from '@/lib/orders/claim-fees';

type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] };
/* 함수 부품은 불러서 펼친다(훅 순번은 한 번의 렌더 안에서 이어진다). */
function build(node: ReactNode): (Host | string)[] {
  if (Array.isArray(node)) return node.flatMap(build);
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function') return build((element.type as (props: unknown) => ReactNode)(element.props));
  if (typeof element.type !== 'string') return build(element.props.children as ReactNode);
  const { children, ...props } = element.props;
  return [{ type: element.type, props, children: build(children as ReactNode) }];
}
const text = (node: Host | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const flat = (nodes: (Host | string)[]): Host[] => nodes.flatMap(node => typeof node === 'string' ? [] : [node, ...flat(node.children)]);
let root: () => ReactNode = () => null;
function render() { hooks.index = 0; hooks.refIndex = 0; return flat(build(root())); }
const screen = () => { hooks.index = 0; hooks.refIndex = 0; return build(root()).map(text).join('\n'); };
async function settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); }
async function click(label: string) { const button = render().find(e => e.type === 'button' && text(e) === label); if (!button) throw new Error(`button ${label}`); (button.props.onClick as () => void)(); await settle(); }
async function submit() { const form = render().find(e => e.type === 'form'); if (!form) throw new Error('form'); (form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} }); await settle(); }
function field(label: string) { const parent = render().find(e => e.type === 'label' && text(e).startsWith(label)); const input = parent ? flat([parent]).find(e => ['input', 'textarea', 'select'].includes(e.type)) : undefined; if (!input) throw new Error(`label ${label}`); return input; }
function change(label: string, value: string | boolean) { (field(label).props.onChange as (event: unknown) => void)({ target: { value, checked: value } }); }
const labels = () => render().filter(e => e.type === 'label').map(e => text(e));
const buttons = () => render().filter(e => e.type === 'button').map(e => text(e));

const id = (n: number) => `a1010000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OPERATION = '33333333-3333-4333-8333-333333333333';
const invoice = (n: number, state: string) => ({ id: id(n), amount: 3000, state, payerRole: 'buyer', bankAccount: ['unpaid', 'reported'].includes(state) ? { bank: 'TEST 은행', accountNumber: '000-0000', holder: 'TEST 예금주' } : null,
  customerNote: '왕복 배송비 안내', agreementEvidence: '', issuedAt: '2026-10-16T06:00:00Z', receivedAt: ['paid', 'refund_due'].includes(state) ? '2026-10-16T07:00:00Z' : null, refundedAt: null as string | null });
const policy = { revision: 2, enabled: true, returnAmount: 3000, exchangeAmount: 6000, evidence: '', updatedAt: '2026-10-16T00:00:00Z', accountReady: true };
const customerDoc = { claimId: id(100), orderId: id(200), claimRevision: 1, revision: 5, claimType: 'return', policy: null, canIssue: false, invoices: [invoice(1, 'unpaid')], history: [{ id: id(300), invoiceId: id(1), kind: 'issue', at: '2026-10-16T06:00:00Z', evidence: '' }] };
const operatorDoc = (invoices: ReturnType<typeof invoice>[] = [], extra: Record<string, unknown> = {}) => ({ claimId: id(100), orderId: id(200), claimRevision: 1, revision: 5, claimType: 'return', policy, canIssue: !invoices.length, invoices: invoices.map(row => ({ ...row, agreementEvidence: '11/26 전화로 합의' })), history: [], ...extra });
async function openOperator(doc: unknown, deductionNote: string | null = null) {
  root = () => <ClaimFeePanel actorId={id(900)} claimId={id(100)} operator deductionNote={deductionNote} />;
  mocks.read.mockResolvedValueOnce({ document: doc }); await click('배송비 청구 내역 확인');
}
beforeEach(() => { hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true); vi.spyOn(crypto, 'randomUUID').mockReturnValue(OPERATION); });

describe('고객 화면', () => {
  it('글자와 동작은 그대로다: 입금 알림은 체크한 뒤 저장하고, 어드민 확인창은 뜨지 않는다', async () => {
    root = () => <OrderClaimFees actorId={id(900)} orderId={id(200)} />;
    expect(screen()).toBe('반품·교환 배송비 청구 이력종료된 요청을 포함해 본인에게 청구된 내역과 배송비 반환 상태를 확인합니다.주문 전체 배송비 청구 조회');
    mocks.readOrder.mockResolvedValueOnce({ documents: [customerDoc] }); await click('주문 전체 배송비 청구 조회');
    for (const shown of ['합의된 배송비 청구 내역입니다. 입금 알림 후 판매자가 실제 입금을 확인합니다. 주문 환불과 배송비 반환은 각각 확인해주세요.', '₩3,000 · 입금 대기', '왕복 배송비 안내', '입금 계좌: TEST 은행 000-0000 · TEST 예금주', '배송비 처리 이력 1건']) expect(screen()).toContain(shown);
    /* 운영자에게만 보이는 것은 없다. */
    expect(render().filter(e => e.type === 'a')).toEqual([]);
    for (const hidden of ['배송비 청구 설정', '입금할 사람', '합의한 내용', '새 배송비 청구', '실제 입금 확인', '청구 면제', '청구 취소', '실제 반환 완료']) expect(screen()).not.toContain(hidden);
    expect(buttons()).toEqual(['주문 전체 배송비 청구 조회', '배송비 청구 내역 확인', '입금했어요']);
    await click('입금했어요');
    expect(labels()).toEqual(['안내된 계좌로 표시된 금액을 입금했습니다.']);
    expect(buttons()).toContain('입금했어요 저장');
    await submit(); expect(screen()).toContain('금액·근거·처리시각·확인 항목을 입력해주세요.'); expect(mocks.change).not.toHaveBeenCalled();
    change('안내된 계좌로', true); mocks.change.mockRejectedValueOnce(new Error('network')); await submit();
    expect(mocks.change).toHaveBeenLastCalledWith(id(100), id(1), 'report_payment', { confirmed: true }, 5, 1, OPERATION, { actorId: id(900), sessionId: 'session-1' });
    expect(screen()).toContain('저장 결과가 불확실합니다. 같은 요청으로 결과를 확인해주세요.'); expect(buttons()).toContain('같은 요청으로 저장 결과 확인');
    mocks.change.mockResolvedValueOnce({ error: claimFeeError(), uncertain: true }); await submit();
    expect(screen()).toContain('처리 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.'); expect(buttons()).not.toContain('저장됐는지 확인');
    mocks.change.mockResolvedValueOnce({ document: { ...customerDoc, revision: 6, invoices: [invoice(1, 'reported')] } }); await submit();
    expect(screen()).toContain('입금했어요 내용을 저장했습니다.'); expect(screen()).toContain('고객 입금 알림 · 확인 전');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});

describe('운영자 화면(요청 상세)', () => {
  it('두 화면의 이름은 배송비 청구 설정·배송비 청구 내역이고, 설정이 꺼져 있으면 어디서 바꾸는지 말한다', async () => {
    await openOperator(operatorDoc([invoice(1, 'unpaid')], { policy: { ...policy, enabled: false } }));
    const links = render().filter(e => e.type === 'a').map(e => [text(e), e.props.href]);
    expect(links).toEqual([['배송비 청구 설정', '/admin/sales/claims/returns/fee-policy'], ['배송비 청구 내역', '/admin/sales/claims/returns/fees']]);
    expect(screen()).toContain('[배송비 청구 설정]이 ‘쓰지 않음’이라 새로 청구할 수 없습니다. 이미 청구한 건의 입금 확인·취소·반환은 계속 할 수 있습니다.');
    expect(screen()).toContain('고객과 합의한 배송비를 주문 환불과 따로 입금받습니다. 주문 환불 금액에서는 빼지 않습니다.');
    expect(screen()).toContain('입금할 사람: 원 주문 구매자 · 합의한 내용: 11/26 전화로 합의');
    for (const old of ['배송비 청구 정책', '입금·반환 목록', '납부 대상', '합의 근거']) expect(screen()).not.toContain(old);
  });

  it('반품배송비를 환불 금액에서 빼는 요청은 그 안내를 그대로 보인다', async () => {
    await openOperator(operatorDoc(), '이 반품은 반품배송비 3,000원(편도 3,000원)을 환불할 때 환불액에서 뺍니다. 같은 반품배송비를 여기서 다시 청구하지 마세요.');
    expect(screen()).toContain('고객과 합의한 배송비를 주문 환불과 따로 입금받습니다. 이 반품은 반품배송비 3,000원(편도 3,000원)을 환불할 때 환불액에서 뺍니다. 같은 반품배송비를 여기서 다시 청구하지 마세요.');
    expect(screen()).not.toContain('주문 환불 금액에서는 빼지 않습니다.');
  });

  it('새 청구: 확인 체크 없이 적고, 저장 전에 누구에게 얼마를 청구하는지 확인창으로 한 번 묻는다', async () => {
    await openOperator(operatorDoc()); await click('새 배송비 청구');
    /* 설정의 기본 청구 금액이 미리 채워진다. 확인 체크는 없다. */
    expect(field('배송비 금액').props.value).toBe('3000');
    expect(labels()).toEqual(['배송비 금액 (원)', '입금할 사람원 주문 구매자반품·교환 요청자', '고객 안내 (필수)고객 화면의 배송비 청구 내역에 그대로 보입니다.', '고객과 합의한 내용 (필수)운영자에게만 보입니다. 고객의 계좌번호·연락처는 적지 마세요.']);
    expect(render().some(e => e.type === 'input' && e.props.type === 'checkbox')).toBe(false);
    /* 필수 칸이 비면 확인창 없이 알린다. */
    await submit(); expect(screen()).toContain('금액, 실제 입금·반환한 시각, 근거를 확인해 주세요. 근거는 2자 이상 적습니다.'); expect(mocks.confirm).not.toHaveBeenCalled();
    change('고객 안내', '왕복 배송비 6,000원입니다.'); change('고객과 합의한 내용', '11/26 전화로 합의'); change('배송비 금액', '6000'); change('입금할 사람', 'requester');
    /* 확인창에서 돌아가면 저장하지 않는다. 적은 내용은 그대로다. */
    mocks.confirm.mockResolvedValueOnce(false); await submit();
    expect(mocks.change).not.toHaveBeenCalled(); expect(field('고객 안내').props.value).toBe('왕복 배송비 6,000원입니다.');
    mocks.change.mockResolvedValueOnce({ document: operatorDoc([invoice(1, 'unpaid')]) }); await submit();
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.confirm.mock.calls[1][0]).toMatchObject({ title: '배송비 청구', confirmLabel: '청구하기', cancelLabel: '돌아가기' });
    expect(mocks.confirm.mock.calls[1][0].message).toContain('반품·교환 요청자에게 배송비 6,000원을 청구합니다.');
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith(id(100), null, 'issue', { amount: 6000, payerRole: 'requester', customerNote: '왕복 배송비 6,000원입니다.', evidence: '11/26 전화로 합의', confirmed: true }, 5, 1, OPERATION, { actorId: id(900), sessionId: 'session-1' });
    expect(screen()).toContain('배송비 청구 내용을 저장했습니다.'); expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('입금 확인: 금액을 말하는 확인창 뒤 기록하고, 저장됐는지 모르면 같은 내용을 다시 묻지 않고 다시 보낸다', async () => {
    await openOperator(operatorDoc([invoice(1, 'unpaid')])); await click('실제 입금 확인');
    expect(labels().map(label => label.split(')')[0])).toEqual(['배송비 금액 (원', '실제 입금된 시각 (KST', '입금 확인 근거 (필수']);
    expect(field('배송비 금액').props.readOnly).toBe(true);
    change('실제 입금된 시각', '2026-10-16T16:00'); change('입금 확인 근거', '거래 일련번호 0123');
    mocks.change.mockResolvedValueOnce({ error: claimFeeError(), uncertain: true }); await submit();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({ title: '실제 입금 확인', confirmLabel: '입금 확인 기록' });
    expect(mocks.confirm.mock.calls[0][0].message).toContain('통장에서 3,000원 전액이 들어온 것을 확인했을 때만 기록해 주세요.');
    const sent = mocks.change.mock.calls[0];
    expect(sent.slice(0, 3)).toEqual([id(100), id(1), 'confirm_payment']);
    expect(sent[3]).toEqual({ amount: 3000, occurredAt: new Date('2026-10-16T16:00').toISOString(), evidence: '거래 일련번호 0123', confirmed: true });
    /* 결과를 모를 때의 말과 버튼은 어드민 공통이다. */
    expect(screen()).toContain('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
    expect(buttons()).toContain('저장됐는지 확인'); expect(buttons()).not.toContain('같은 요청으로 저장 결과 확인');
    mocks.change.mockResolvedValueOnce({ document: operatorDoc([invoice(1, 'paid')]) }); await submit();
    expect(mocks.confirm).toHaveBeenCalledOnce(); expect(mocks.change).toHaveBeenCalledTimes(2); expect(mocks.change.mock.calls[1]).toEqual(sent);
    expect(screen()).toContain('실제 입금 확인 내용을 저장했습니다.');
  });

  it('면제·취소·반환도 확인 체크 없이 사유를 적고 확인창으로 묻는다', async () => {
    await openOperator(operatorDoc([invoice(1, 'unpaid')])); await click('청구 면제');
    expect(labels()).toEqual(['면제 사유 (필수)운영자에게만 보입니다. 고객의 계좌번호·연락처는 적지 마세요.']);
    change('면제 사유', '고객과 다시 합의'); mocks.change.mockResolvedValueOnce({ document: operatorDoc([invoice(1, 'waived')]) }); await submit();
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({ title: '청구 면제', confirmLabel: '면제하기', destructive: true });
    expect(mocks.change.mock.calls[0][3]).toEqual({ evidence: '고객과 다시 합의', confirmed: true });

    hooks.state = []; hooks.refs = []; vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true);
    await openOperator(operatorDoc([invoice(1, 'paid')])); await click('청구 취소 · 반환 대기');
    expect(labels().map(label => label.split(')')[0])).toEqual(['취소 사유 (필수']);
    change('취소 사유', '금액을 잘못 청구함'); mocks.change.mockResolvedValueOnce({ document: operatorDoc([invoice(1, 'refund_due')]) }); await submit();
    expect(mocks.confirm.mock.calls[0][0].message).toContain("'배송비 반환 대기'로 바뀝니다. 고객에게 3,000원을 돌려준 뒤 [실제 반환 완료]를 기록해 주세요.");

    await click('실제 반환 완료');
    expect(labels().map(label => label.split(')')[0])).toEqual(['배송비 금액 (원', '실제 반환한 시각 (KST', '반환 근거 (필수']);
    change('실제 반환한 시각', '2026-10-17T10:15'); change('반환 근거', '이체 확인증 번호 0456'); mocks.change.mockResolvedValueOnce({ document: operatorDoc([{ ...invoice(1, 'refunded'), refundedAt: '2026-10-17T01:15:00Z' }]) }); await submit();
    expect(mocks.confirm.mock.calls[1][0]).toMatchObject({ title: '실제 반환 완료', confirmLabel: '반환 완료 기록' });
    expect(mocks.change.mock.calls[1][2]).toBe('refund');
  });

  it('서버가 돌려준 오류는 이 화면의 버튼 이름과 고칠 방법으로 바꿔 보인다', async () => {
    await openOperator(operatorDoc([invoice(1, 'unpaid')])); await click('청구 취소'); change('취소 사유', '다시 청구');
    mocks.change.mockResolvedValueOnce({ error: claimFeeError('PT409'), uncertain: false }); await submit();
    expect(screen()).toContain('다른 사람이 먼저 바꿨습니다. [배송비 청구 내역 확인]을 눌러 지금 상태를 본 뒤 다시 해 주세요.');
    expect(buttons()).not.toContain('저장됐는지 확인');
    mocks.read.mockResolvedValueOnce({ error: claimFeeError('P0002') }); await click('배송비 청구 내역 확인');
    expect(screen()).toContain('이 배송비 청구를 찾지 못했습니다. [배송비 청구 내역 확인]을 눌러 지금 상태를 다시 불러와 주세요.');
  });
});
