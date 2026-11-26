import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminClaimActionState } from '@/app/admin/claim-actions';
import { ADMIN_CANCELLATION_RECHECK_LABELS } from '@/lib/admin/orders';
import type { ClaimActionPanelProps } from './ClaimActionPanel';

/*
 * 처리 결과는 결과 뒤의 화면에 남아야 한다(2차 재검토 C2-1).
 *
 * 서버 액션이 revalidatePath를 부르면 같은 응답에 새 화면이 실려 온다. 승인으로
 * 단계가 processing·needs_review·completed로 바뀌면 그 결과를 돌려준 승인 양식은
 * 그 응답에서 사라지므로, 결과 문구를 양식 안에 그리면 운영자는 실패 코드도 다음
 * 할 일도 보지 못한다. 서버 렌더에서는 액션 결과를 재현할 수 없어 useActionState만
 * 대체한다 — 승인(결정) 액션이 돌려준 상태가 그 결과 뒤의 props로 그려진 패널에
 * 보이는지를 본다.
 */

const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const actions = vi.hoisted(() => ({
  decideOrderClaimAction: vi.fn(),
  readOrderClaimApprovalAmountAction: vi.fn(),
  recordOrderClaimCollectionAction: vi.fn(),
  recordOrderClaimOriginCollectionAction: vi.fn(),
  recordOrderClaimRefundAction: vi.fn(),
  planClaimDefectiveStockAction: vi.fn(),
  planExchangeDefectiveStockAction: vi.fn(),
  retryClaimDefectiveStockAction: vi.fn(),
}));

vi.mock('@/app/admin/claim-actions', () => actions);

function props(overrides: Partial<ClaimActionPanelProps> = {}): ClaimActionPanelProps {
  return {
    cancellationForm: null,
    claimId: CLAIM_ID,
    claimType: 'cancel',
    collectionComplete: true,
    collectionPolicy: 'legacy',
    collections: [],
    heldFrom: null,
    orderId: ORDER_ID,
    paymentProvider: null,
    recordedRefundMethod: null,
    refundCompleted: false,
    refundFiled: false,
    refundLedgerOpen: false,
    stage: 'processing',
    ...overrides,
  };
}

/** 결정(승인·검토·보류·거부) 액션이 `state`를 돌려준 직후의 패널을 그린다. */
async function renderAfterDecision(state: AdminClaimActionState, overrides: Partial<ClaimActionPanelProps> = {}) {
  vi.resetModules();
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    const otherActions = new Set<unknown>([
      actions.recordOrderClaimCollectionAction,
      actions.recordOrderClaimOriginCollectionAction,
      actions.recordOrderClaimRefundAction,
      actions.planClaimDefectiveStockAction,
      actions.planExchangeDefectiveStockAction,
      actions.retryClaimDefectiveStockAction,
    ]);
    return {
      ...actual,
      useActionState: (fn: unknown, initial: unknown) => [otherActions.has(fn) ? initial : state, () => {}, false],
    };
  });
  const { ClaimActionPanel } = await import('./ClaimActionPanel');
  return renderToStaticMarkup(<ClaimActionPanel {...props(overrides)} />);
}

function occurrences(html: string, text: string) {
  return html.split(text).length - 1;
}

afterEach(() => {
  vi.doUnmock('react');
  vi.resetModules();
});

describe('ClaimActionPanel 처리 결과', () => {
  it('결제 전 주문 취소를 승인해 처리중이 되면 결과 문구와 주문 패널 재확인 안내가 함께 보인다', async () => {
    const message = `취소를 승인했습니다. 결제 결과가 정해지기 전이라 [${ADMIN_CANCELLATION_RECHECK_LABELS.processing}]으로 다시 확인해주세요.`;
    const html = await renderAfterDecision({ message });

    expect(html).toContain(message);
    expect(occurrences(html, message)).toBe(1);
    expect(html).toMatch(/처리 상태 <span[^>]*data-tone="info"[^>]*>처리중</);
    // 이 건을 닫는 유일한 버튼(주문 패널 재확인)을 항상 보이는 문구가 가리킨다.
    expect(html).toContain(`[${ADMIN_CANCELLATION_RECHECK_LABELS.processing}]으로 닫습니다`);
    /* 주문 통합검색에서 그 주문을 찾고 처리 패널까지 연다(재확인 버튼은 그 패널에만 있다). */
    expect(html).toContain(`href="/admin/sales/orders?query=${ORDER_ID}&amp;order=${ORDER_ID}"`);
    expect(html).not.toContain('결제 내역을 먼저 확인해주세요');
  });

  it('승인 뒤 결제확인필요로 떨어진 실패 문구가 보인다', async () => {
    const error = '취소는 승인했지만 주문 취소를 확정하지 못했습니다(provider_rejected). 주문과 재고는 그대로 유지됩니다.';
    const html = await renderAfterDecision({ error }, { stage: 'needs_review' });

    expect(html).toMatch(/처리 상태 <span[^>]*data-tone="danger"[^>]*>결제확인필요</);
    expect(html).toContain(`role="alert"`);
    expect(html).toContain('provider_rejected');
    expect(occurrences(html, 'provider_rejected')).toBe(1);
    expect(html).toContain(`[${ADMIN_CANCELLATION_RECHECK_LABELS.needsReview}]으로 닫습니다`);
    /* 결제사 이름은 이름표의 '코페이' 하나이고, 주문 패널의 버튼은 화면에 적힌 이름 그대로 가리킨다. */
    expect(html).toContain(`코페이 결제창 주문은 그 자리의 [${ADMIN_CANCELLATION_RECHECK_LABELS.preparedKorpay}] 버튼으로 처리합니다.`);
  });

  /* L-12: 결제사 확인 코드는 문장 끝 괄호가 아니라 알림 아래 작은 글로 한 번만 보인다. */
  it('실패 문구의 코드는 문장에서 떼어 작은 글로 한 번만 보인다', async () => {
    const error = '결제 취소를 확정하지 못했습니다 — 결제사 응답을 받지 못했습니다. 잠시 뒤 [환불 완료 확정]을 다시 눌러주세요. 문의할 때 알려 줄 코드: provider_unavailable';
    const html = await renderAfterDecision({ error }, { stage: 'needs_review', paymentProvider: 'toss', refundLedgerOpen: true });

    expect(html).toContain('잠시 뒤 [환불 완료 확정]을 다시 눌러주세요.<span');
    expect(html).toMatch(/data-claim-support-code=""[^>]*>문의할 때 알려 줄 코드 <code[^>]*>provider_unavailable<\/code>/);
    expect(occurrences(html, 'provider_unavailable')).toBe(1);
    expect(html).not.toContain('(provider_unavailable)');
  });

  it('토스 승인으로 바로 종결돼 처리 버튼이 사라져도 결과 문구가 남는다', async () => {
    const message = '취소를 승인하고 토스 전액 취소까지 확인했습니다.';
    const html = await renderAfterDecision({ message }, {
      stage: 'completed',
      paymentProvider: 'toss',
      recordedRefundMethod: 'pg_cancel',
      refundLedgerOpen: true,
      refundFiled: true,
      refundCompleted: true,
    });

    expect(html).toContain(message);
    // 결과를 돌려준 승인 버튼은 이 응답에서 이미 사라졌다.
    expect(html).not.toContain('value="approve"');
  });

  it('보류·거부 결과도 같은 자리에 한 번만 그린다', async () => {
    const error = '보류 사유를 10~200자로 입력해주세요.';
    const html = await renderAfterDecision({ error }, { stage: 'requested', claimType: 'return', paymentProvider: 'toss' });

    expect(html).toContain('보류 사유');
    expect(occurrences(html, error)).toBe(1);
  });

  it('반품처럼 취소가 아닌 유형의 원장 부재 안내는 결제 내역 확인을 그대로 안내한다', async () => {
    const html = await renderAfterDecision({}, { claimType: 'return', stage: 'processing' });

    expect(html).toContain('환불 기록이 없어 완료를 기록할 수 없습니다');
    expect(html).not.toContain('href="/admin/sales/orders?query=');
  });
});

describe('runClaimPanelAction', () => {
  it('양식이 고른 서버 액션 하나만 부르고 그 결과를 그대로 돌려준다', async () => {
    vi.clearAllMocks();
    const { runClaimPanelAction } = await import('./ClaimActionPanel');
    actions.recordOrderClaimRefundAction.mockResolvedValue({ message: '환불 완료를 기록했습니다.' });
    const form = new FormData();
    form.set('panelAction', 'refund');
    form.set('claimId', CLAIM_ID);

    await expect(runClaimPanelAction({ error: '이전 결과' }, form)).resolves.toEqual({ message: '환불 완료를 기록했습니다.' });
    expect(actions.recordOrderClaimRefundAction).toHaveBeenCalledWith({}, form);
    expect(actions.decideOrderClaimAction).not.toHaveBeenCalled();
  });

  it.each(['', 'toString', '__proto__', 'originCollection'])('모르는 작업(%s)은 서버 액션을 부르지 않는다', async (kind) => {
    vi.clearAllMocks();
    const { runClaimPanelAction } = await import('./ClaimActionPanel');
    const form = new FormData();
    form.set('panelAction', kind);

    const state = await runClaimPanelAction({}, form);
    expect(state.error).toContain('처리할 작업을 확인하지 못했습니다');
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });
});

/*
 * 되돌릴 수 없는 금전 처리는 확인을 거친다(2026-10-12 브라우저 QA QA-6). 회수가 없는
 * 취소에는 회수 안내를 그리지 않는다(QA-9).
 */
describe('ClaimActionPanel 확인과 취소 안내', () => {
  async function render(overrides: Partial<ClaimActionPanelProps>) {
    const { ClaimActionPanel } = await import('./ClaimActionPanel');
    return renderToStaticMarkup(<ClaimActionPanel {...props(overrides)} />);
  }

  /*
   * A-3: 승인 전에는 환불 기록이 없어 화면이 가진 금액이 주문 금액뿐이다. 앞서 부분 취소한 주문은 그보다 적게 취소되므로,
   * 결제사 취소가 바로 나가는 승인의 확인창은 속성에 미리 적지 않고 누르는 시점에 서버가 읽은 금액으로 만든다.
   */
  it('토스 취소 승인은 확인 문구를 속성에 미리 적지 않고, 버튼 옆에는 결제 금액을 적는다', async () => {
    const html = await render({ stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin', refundAmount: 40000, paidAmount: 40000 });

    expect(html).not.toMatch(/data-confirm="[^"]*"[^>]*value="approve"/);
    expect(html).not.toMatch(/data-confirm="[^"]*"[^>]*value="review"/);
    expect(html).toMatch(/data-claim-money-at-stake=""[^>]*>(?:(?!<button)[\s\S])*결제 금액(?:(?!<button)[\s\S])*₩40,000/);
    expect(html).not.toContain('취소 금액</span>');
    expect(html).toContain('취소 금액은 버튼을 누르면 확인창에 나옵니다.');
    expect(html).not.toContain('결제 전액을 취소하고 결제사에 결과를 확인합니다');
  });

  it('토스 취소 승인의 확인창은 누르는 시점에 읽은 금액·대상을 말하고, 읽지 못하면 확인창을 만들지 않는다', async () => {
    const { claimCancelApprovalMoneyConfirm, resolveCancelApprovalConfirm } = await import('./ClaimActionPanel');
    const target = { claimReference: 'C00012', orderReference: '20261126-000123', buyerName: '홍길동' };

    /* 앞서 9,500원을 부분 취소한 주문: 주문 금액(40,000원)이 아니라 남은 30,500원을 말한다. */
    const read = vi.fn(async () => ({ ok: true as const, amount: 30500, paymentProvider: 'toss' }));
    const remainder = await resolveCancelApprovalConfirm({ claimId: CLAIM_ID, paidAmount: 40000, target }, read);
    expect(read).toHaveBeenCalledWith(CLAIM_ID);
    expect(remainder.confirm).toEqual({
      title: 'C00012 취소 승인',
      confirmLabel: '30,500원 취소',
      destructive: true,
      message: [
        '주문 20261126-000123 · 구매자 홍길동',
        '토스 결제에서 이미 취소한 금액을 뺀 남은 결제 금액 30,500원을 취소합니다(결제 금액 40,000원).',
        '승인하면 바로 결제사에 취소를 요청합니다. 되돌릴 수 없고, 취소가 확인되면 주문 취소·재고 복원까지 함께 끝납니다.',
      ].join('\n'),
    });

    const full = claimCancelApprovalMoneyConfirm({ autoCancelLabel: '나이스페이', amount: 40000, paidAmount: 40000 });
    expect(full.title).toBe('취소 승인');
    expect(full.confirmLabel).toBe('40,000원 취소');
    expect(full.message).toContain('나이스페이 결제 전액 40,000원을 취소합니다.');
    expect(full.message).not.toContain('토스');

    /* 앞선 부분 취소가 결제 금액을 모두 돌려준 주문은 결제사를 부르지 않는다. */
    const nothingLeft = claimCancelApprovalMoneyConfirm({ autoCancelLabel: '토스', amount: 0, paidAmount: 40000 });
    expect(nothingLeft.message).toContain('더 취소할 금액이 없습니다');
    expect(nothingLeft.confirmLabel).toBe('승인하고 주문 취소');

    const failed = await resolveCancelApprovalConfirm({ claimId: CLAIM_ID, paidAmount: 40000 }, async () => ({ ok: false as const, error: '지금 단계에서는 처리할 수 없습니다.' }));
    expect(failed).toEqual({ error: '지금 단계에서는 처리할 수 없습니다.' });
    const thrown = await resolveCancelApprovalConfirm({ claimId: CLAIM_ID, paidAmount: 40000 }, async () => { throw new Error('network'); });
    expect(thrown.error).toContain('취소할 금액을 다시 읽지 못해 승인하지 않았습니다');
    const changed = await resolveCancelApprovalConfirm({ claimId: CLAIM_ID, paidAmount: 40000 }, async () => ({ ok: true as const, amount: 40000, paymentProvider: 'korpay' }));
    expect(changed.error).toContain('결제 정보가 그사이 바뀌어 승인하지 않았습니다');
    expect(changed.confirm).toBeUndefined();

    /* 금액을 읽지 못하면 확인창을 띄우지 않고 보내지도 않는다. 운영자가 돌아가도 보내지 않는다. */
    const { confirmCancelApproval } = await import('./ClaimActionPanel');
    const confirm = vi.fn(() => true);
    expect(await confirmCancelApproval({ claimId: CLAIM_ID, paidAmount: 40000 }, async () => ({ ok: false as const, error: '읽지 못했습니다.' }), confirm))
      .toEqual({ confirmed: false, error: '읽지 못했습니다.' });
    expect(confirm).not.toHaveBeenCalled();
    expect(await confirmCancelApproval({ claimId: CLAIM_ID, paidAmount: 40000, target }, read, () => false)).toEqual({ confirmed: false, error: null });
    expect(await confirmCancelApproval({ claimId: CLAIM_ID, paidAmount: 40000, target }, read, confirm)).toEqual({ confirmed: true, error: null });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'C00012 취소 승인', confirmLabel: '30,500원 취소', cancelLabel: '돌아가기', destructive: true }));
  });

  it('결제사 취소가 바로 나가지 않는 취소 승인은 대상과 다음 절차를 확인창에 적는다', async () => {
    const { claimCancelApprovalConfirm } = await import('./ClaimActionPanel');
    const target = { claimReference: 'C00012', orderReference: '20261126-000123', buyerName: '홍길동' };

    expect(claimCancelApprovalConfirm('korpay', target)).toEqual({
      title: 'C00012 취소 승인',
      confirmLabel: '승인하고 환불 처리 시작',
      message: '주문 20261126-000123 · 구매자 홍길동\n취소를 승인할까요? 승인 뒤 코페이 취소 접수와 환불 완료 확정으로 진행합니다.',
    });
    expect(claimCancelApprovalConfirm('bank_transfer').message).toBe('취소를 승인할까요? 승인 뒤 환불계좌 송금 절차로 진행합니다.');
    const unpaid = claimCancelApprovalConfirm(null);
    expect(unpaid.message).toBe('취소를 승인할까요? 결제 전 주문은 바로 주문이 취소되고 되돌릴 수 없습니다.');
    expect(unpaid.destructive).toBe(true);

    const html = await render({ stage: 'requested', paymentProvider: 'korpay', collectionPolicy: 'origin', claimReference: 'C00012' });
    expect(html).toMatch(/data-confirm="취소를 승인할까요\? 승인 뒤 코페이 취소 접수와 환불 완료 확정으로 진행합니다\."[^>]*data-confirm-title="C00012 취소 승인"[^>]*value="approve"/);
    expect(html).toContain('코페이 결제는 승인 뒤 결제사 취소 접수 양식으로 접수하고 환불 완료를 확정합니다.');
    expect(html).not.toContain('Korpay');
    /* 결제 전 주문은 환불할 돈이 없다 — 버튼도 주문 취소라고 말한다. */
    expect(await render({ stage: 'requested', paymentProvider: null, collectionPolicy: 'origin' })).toContain('승인하고 주문 취소');
  });

  /* MD 판정: 돈이 나가는 승인이 옆의 일반 버튼과 같은 크기·색이면 안 된다. 승인 전에 읽도록 경고 상자가 버튼 위에 온다. */
  it('결제사 전액 취소가 바로 나가는 승인만 위험 버튼과 경고 상자로 구분한다', async () => {
    const tag = (html: string, value: string) => html.match(new RegExp(`<button[^>]*value="${value}"[^>]*>`))?.[0] ?? '';
    const toss = await render({ stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin' });
    expect(tag(toss, 'approve')).toContain('bg-destructive');
    expect(tag(toss, 'approve')).not.toBe(tag(toss, 'review'));
    expect(toss.indexOf('data-admin-notice="warning"')).toBeLessThan(toss.indexOf('value="approve"'));
    /* 수거부터 시작하는 반품 승인은 돈이 나가지 않는다 — 일반 승인(주 색)이고 경고 상자가 없다. */
    const refundReturn = await render({ claimType: 'return', stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin' });
    expect(tag(refundReturn, 'approve')).not.toContain('bg-destructive');
    expect(refundReturn).not.toContain('data-admin-notice');
  });

  it('처리 패널은 목록·머리와 같은 단계 이름을 쓴다', async () => {
    const html = await render({ stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin' });
    expect(html).toMatch(/처리 상태 <span[^>]*data-tone="warning"[^>]*>취소요청</);
    expect(html).not.toContain('현재 단계');
  });

  /* A-2·D-04: 확인창이 요청번호·주문번호·구매자와 금액을 말하고, 확인 버튼은 하는 일을 말한다. 금액은 버튼 옆 환불 금액과 같은 값이다. */
  it('환불 완료 확정 확인창은 대상과 금액을 말하고 확인 버튼이 금액을 적는다', async () => {
    const html = await render({
      stage: 'needs_review', paymentProvider: 'toss', collectionPolicy: 'origin', refundLedgerOpen: true, refundAmount: 43000, paidAmount: 43000,
      claimReference: 'C00012', orderReference: '20261126-000123', buyerName: '홍길동',
    });

    const form = html.match(/<form[^>]*data-confirm="[^"]*"[^>]*>/)?.[0] ?? '';
    expect(form).toContain('data-confirm="주문 20261126-000123 · 구매자 홍길동\n토스 결제 전액 43,000원을 취소하고 주문 취소·재고 복원을 확정합니다.\n되돌릴 수 없습니다."');
    expect(form).toContain('data-confirm-title="C00012 환불 완료 확정"');
    expect(form).toContain('data-confirm-label="43,000원 취소"');
    expect(form).toContain('data-confirm-tone="danger"');
    expect(html).toContain('환불 완료 확정 (토스 전액 취소)');
    expect(html).toMatch(/환불 금액(?:(?!<button)[\s\S])*₩43,000/);
    /* 대상을 받지 못해도 금액은 말한다. */
    const bare = await render({ stage: 'needs_review', paymentProvider: 'nicepay', collectionPolicy: 'origin', refundLedgerOpen: true, refundAmount: 43000 });
    expect(bare).toContain('data-confirm="나이스페이 결제 전액 43,000원을 취소하고 주문 취소·재고 복원을 확정합니다.\n되돌릴 수 없습니다."');
    expect(bare).toContain('data-confirm-title="환불 완료 확정"');
    expect(bare).not.toContain('토스');
  });

  it('반품 승인은 금전 처리가 아니라 확인을 붙이지 않고, 자동 회수가 켜져 있을 때만 택배사 접수를 묻는다', async () => {
    const html = await render({ claimType: 'return', stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin' });

    expect(html).toContain('승인하고 수거 시작');
    expect(html).not.toContain('data-confirm');

    const auto = await render({ claimType: 'return', stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin', autoPickupOnApproval: true, claimReference: 'C00012' });
    expect(auto).toMatch(/data-confirm="승인하면 회수 계약 출고지는 몇 분 안에 택배사에 회수를 접수합니다\."[^>]*data-confirm-title="C00012 반품 승인"[^>]*value="approve"/);
    expect(auto).not.toMatch(/data-confirm="[^"]*"[^>]*value="review"/);
  });

  /* D-01: 거부는 되돌릴 수 없고 사유가 구매자에게 그대로 간다. 양식이 바로 서버로 가지 않고 사유를 보여 주는 확인창을 거친다. */
  it('거부는 사유를 그대로 보여 주는 확인창을 거치고, 사유 칸은 필수와 보이는 곳을 말한다', async () => {
    const { claimRejectionConfirm } = await import('./ClaimActionPanel');
    expect(claimRejectionConfirm({
      claimType: 'return', reason: '반품 가능 기간이 지났습니다.',
      target: { claimReference: 'C00012', orderReference: '20261126-000123', buyerName: '홍길동' },
    })).toEqual({
      title: 'C00012 반품 거부',
      confirmLabel: '거부',
      destructive: true,
      message: '주문 20261126-000123 · 구매자 홍길동\n구매자에게 아래 사유가 그대로 전달됩니다.\n“반품 가능 기간이 지났습니다.”\n거부하면 되돌릴 수 없습니다.',
    });

    /* 길이가 맞지 않으면 묻지도 보내지도 않고, 운영자가 돌아가면 보내지 않는다. 사유는 앞뒤 공백을 떼고 센다(서버와 같다). */
    const { confirmClaimRejection } = await import('./ClaimActionPanel');
    const never = vi.fn(() => true);
    for (const note of ['짧은 사유', '   아홉 글자인 사유   ', 'ㄱ'.repeat(201), null]) {
      expect(await confirmClaimRejection({ claimType: 'return', note }, never)).toEqual({ confirmed: false, error: '거부 사유를 10자 이상 200자 이하로 입력해주세요.' });
    }
    expect(never).not.toHaveBeenCalled();
    const declined = vi.fn(() => false);
    expect(await confirmClaimRejection({ claimType: 'cancel', note: ' 이미 발송되어 취소할 수 없습니다. ' }, declined)).toEqual({ confirmed: false, error: null });
    expect(declined).toHaveBeenCalledWith(expect.objectContaining({
      title: '취소 거부', confirmLabel: '거부', cancelLabel: '돌아가기', destructive: true,
      message: '구매자에게 아래 사유가 그대로 전달됩니다.\n“이미 발송되어 취소할 수 없습니다.”\n거부하면 되돌릴 수 없습니다.',
    }));
    expect(await confirmClaimRejection({ claimType: 'cancel', note: '이미 발송되어 취소할 수 없습니다.' }, () => true)).toEqual({ confirmed: true, error: null });

    const html = await render({ stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin' });
    expect(html).toContain('거부 사유 (필수)');
    expect(html).toContain('구매자에게 그대로 보입니다. 10~200자로 적어주세요.');
    expect(html).not.toContain('거부 사유 (10~200자, 구매자에게 전달됩니다)');
  });

  it('회수가 없는 취소에는 출고지별 회수 안내를 그리지 않는다', async () => {
    const html = await render({ stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin', collections: [] });

    expect(html).not.toContain('출고지별 회수 확인');
    expect(html).not.toContain('수거를 승인하면');
    expect(html).toContain('승인하고 토스 전액 취소');
  });

  it('반품에는 출고지별 회수 안내가 그대로 있다', async () => {
    const html = await render({ claimType: 'return', stage: 'requested', collectionPolicy: 'origin', collectionComplete: false, collections: [] });

    expect(html).toContain('출고지별 회수 확인');
    expect(html).toContain('수거를 승인하면 출고지별 반품지 주소와 상품이 표시됩니다.');
  });

  /* 코드 리뷰: 보류 뒤 canHold→canResume으로 렌더 자리가 바뀌어 부품이 다시 마운트되면서 완료 문구와 포커스가 사라졌다. */
  it('교환의 보류 설정과 해제는 같은 묶음에 그리고, 보류 중에만 화면 위치를 올린다', async () => {
    const base = { claimType: 'exchange', collectionPolicy: 'origin', collectionComplete: false } as const;
    const group = (html: string) => html.slice(html.indexOf('data-claim-secondary-actions'));
    const collecting = await render({ ...base, stage: 'collecting' });
    expect(group(collecting)).toContain('교환 보류 설정');
    expect(collecting.indexOf('교환 보류 설정')).toBeGreaterThan(collecting.indexOf('data-claim-secondary-actions'));
    const held = await render({ ...base, stage: 'on_hold', heldFrom: 'collecting' });
    expect(group(held)).toContain('교환 보류 해제');
    expect(held.indexOf('교환 보류 해제')).toBeGreaterThan(held.indexOf('data-claim-secondary-actions'));
    expect(held.match(/<section[^>]*data-claim-secondary-actions=""/)?.[0]).toContain('order-1');
    expect(collecting.match(/<section[^>]*data-claim-secondary-actions=""/)?.[0]).toContain('order-2');
  });

  /* 출고지별 재출고(TKT-166): 한 출고지라도 재출고한 교환은 거부 양식을 그리지 않는다 — DB가 claim_not_rejectable로 막는다. */
  it('재출고가 시작된 교환에는 거부하기가 없다', async () => {
    const open = await render({ claimType: 'exchange', stage: 'collecting', collectionPolicy: 'origin', collectionComplete: false });
    expect(open).toContain('data-claim-reject-fold=""');
    const started = await render({ claimType: 'exchange', stage: 'collecting', collectionPolicy: 'origin', collectionComplete: false, reshipmentStarted: true });
    expect(started).not.toContain('data-claim-reject-fold=""');
    expect(started).not.toContain('>거부<');
    const held = await render({ claimType: 'exchange', stage: 'on_hold', heldFrom: 'collecting', collectionPolicy: 'origin', collectionComplete: false, reshipmentStarted: true });
    expect(held).not.toContain('data-claim-reject-fold=""');
  });

  /* 사람 눈 판정(3라운드): 승인은 진한 빨강, 거부는 연한 빨강이라 둘 다 위험 표시처럼 보였다. */
  it('거부는 승인보다 낮은 테두리 버튼이다', async () => {
    const html = await render({ stage: 'requested', paymentProvider: 'toss', collectionPolicy: 'origin', collections: [] });
    expect(html).toMatch(/<button[^>]*bg-destructive[^>]*>승인하고/);
    const reject = html.match(/<button[^>]*>거부<\/button>/)?.[0] ?? '';
    expect(reject).toContain('border-border-strong');
    expect(reject).not.toContain('bg-danger-soft');
  });

  /* kit 버튼은 type을 주지 않으면 type="button"이 된다(Base UI). 양식의 처리 버튼은 모두 제출이어야 한다. */
  it('처리 양식의 kit 버튼은 제출 버튼이고, 양식 복사만 제출하지 않는다', async () => {
    const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label.replace(/[()]/g, '\\$&')}</button>`))?.[0] ?? '';
    const decision = await render({ claimType: 'return', stage: 'requested', collectionPolicy: 'origin' });
    for (const [label, value] of [['승인하고 수거 시작', 'approve'], ['검토중으로 표시', 'review']] as const) {
      expect(button(decision, label)).toContain('type="submit"');
      expect(button(decision, label)).toContain('name="decision"');
      expect(button(decision, label)).toContain(`value="${value}"`);
    }
    expect(button(decision, '거부')).toContain('type="submit"');

    const filing = await render({ claimType: 'return', stage: 'collected', collectionPolicy: 'legacy', collectionComplete: true, paymentProvider: 'korpay' });
    expect(button(filing, '환불 접수 완료로 기록')).toContain('type="submit"');
    const completion = await render({ stage: 'needs_review', paymentProvider: 'korpay', collectionPolicy: 'origin', refundLedgerOpen: true, cancellationForm: '[결제 취소 요청]' });
    expect(button(completion, '환불 완료 확정 (재고 복원 포함)')).toContain('type="submit"');
    expect(button(completion, '양식 복사')).toContain('type="button"');
    const legacy = await render({ claimType: 'return', stage: 'collecting', collectionPolicy: 'legacy', collectionComplete: false });
    expect(button(legacy, '반송 상품 입고 확인')).toContain('type="submit"');
  });

  it('누른 버튼의 확인을 취소하면 보내지 않고, 확인 문구가 없으면 묻지 않고 보낸다', async () => {
    const { confirmClaimPanelSubmit } = await import('./ClaimActionPanel');
    const submitter = { getAttribute: (name: string) => (name === 'data-confirm' ? '승인할까요?' : null) };
    const form = { getAttribute: () => null };
    const declined = { nativeEvent: { submitter }, currentTarget: form, preventDefault: vi.fn() };
    const confirm = vi.fn(() => false);

    expect(await confirmClaimPanelSubmit(declined as unknown as React.FormEvent<HTMLFormElement>, confirm)).toBe(false);
    /* 확인창을 닫는 버튼은 '취소'가 아니라 '돌아가기'다(처리 이름인 주문 취소·결제 취소와 겹치지 않게). */
    expect(confirm).toHaveBeenCalledWith({ message: '승인할까요?', cancelLabel: '돌아가기' });
    // 양식의 기본 제출(양식 action)은 늘 막는다. 보내는 쪽이 직접 보낸다.
    expect(declined.preventDefault).toHaveBeenCalledOnce();

    const plain = {
      nativeEvent: { submitter: { getAttribute: () => null } }, currentTarget: form, preventDefault: vi.fn(),
    };
    const unused = vi.fn(() => false);
    expect(await confirmClaimPanelSubmit(plain as unknown as React.FormEvent<HTMLFormElement>, unused)).toBe(true);
    expect(unused).not.toHaveBeenCalled();

    /* 누른 버튼에 확인이 없으면 양식의 확인을 쓰고, 제목·버튼 이름·위험색을 함께 싣는다. */
    const attributes: Record<string, string> = {
      'data-confirm': '토스 결제 전액 43,000원을 취소합니다.', 'data-confirm-title': 'C00012 환불 완료 확정',
      'data-confirm-label': '43,000원 취소', 'data-confirm-tone': 'danger',
    };
    const fromForm = {
      nativeEvent: { submitter: { getAttribute: () => null } }, currentTarget: { getAttribute: (name: string) => attributes[name] ?? null }, preventDefault: vi.fn(),
    };
    const accepted = vi.fn(() => true);
    expect(await confirmClaimPanelSubmit(fromForm as unknown as React.FormEvent<HTMLFormElement>, accepted)).toBe(true);
    expect(accepted).toHaveBeenCalledWith({
      message: '토스 결제 전액 43,000원을 취소합니다.', title: 'C00012 환불 완료 확정', confirmLabel: '43,000원 취소', cancelLabel: '돌아가기', destructive: true,
    });
  });
});

/* R8: 목록 위 팝업에서 처리 패널이 서버 액션(토스 승인·환불 완료 확정)을 기다리는 동안 팝업을 닫지 못하게 알린다. */
describe('ClaimActionPanel 팝업 대기 알림', () => {
  it.each([true, false])('처리 중(pending=%s)을 팝업에 그대로 알린다', async (pending) => {
    vi.resetModules();
    const busy = vi.fn();
    vi.doMock('./ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return { ...actual, useActionState: (_fn: unknown, initial: unknown) => [initial, () => {}, pending] };
    });
    const { ClaimActionPanel } = await import('./ClaimActionPanel');
    renderToStaticMarkup(<ClaimActionPanel {...props({ stage: 'requested', paymentProvider: 'toss' })} />);
    expect(busy).toHaveBeenCalledWith(pending);
    vi.doUnmock('./ClaimPreviewDialog');
  });
});
