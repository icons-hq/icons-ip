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
  recordOrderClaimCollectionAction: vi.fn(),
  recordOrderClaimOriginCollectionAction: vi.fn(),
  recordOrderClaimRefundAction: vi.fn(),
  recordOrderClaimReshipmentAction: vi.fn(),
}));

vi.mock('@/app/admin/claim-actions', () => actions);

function props(overrides: Partial<ClaimActionPanelProps> = {}): ClaimActionPanelProps {
  return {
    cancellationForm: null,
    carriers: [],
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
      actions.recordOrderClaimReshipmentAction,
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
    expect(html).toContain('현재 단계: 처리중');
    // 이 건을 닫는 유일한 버튼(주문 패널 재확인)을 항상 보이는 문구가 가리킨다.
    expect(html).toContain(`[${ADMIN_CANCELLATION_RECHECK_LABELS.processing}]으로 닫습니다`);
    expect(html).toContain(`href="/admin/sales/orders?query=${ORDER_ID}"`);
    expect(html).not.toContain('결제 내역을 먼저 확인해주세요');
  });

  it('승인 뒤 결제확인필요로 떨어진 실패 문구가 보인다', async () => {
    const error = '취소는 승인했지만 주문 취소를 확정하지 못했습니다(provider_rejected). 주문과 재고는 그대로 유지됩니다.';
    const html = await renderAfterDecision({ error }, { stage: 'needs_review' });

    expect(html).toContain('현재 단계: 결제확인필요');
    expect(html).toContain(`role="alert"`);
    expect(html).toContain('provider_rejected');
    expect(occurrences(html, 'provider_rejected')).toBe(1);
    expect(html).toContain(`[${ADMIN_CANCELLATION_RECHECK_LABELS.needsReview}]으로 닫습니다`);
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

    expect(html).toContain('환불 원장이 없어 완료를 기록할 수 없습니다');
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
