import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ReorderAction,
  ReorderOutcomeNotice,
  reorderCanceledOrder,
  reorderNavigatesToCheckout,
  runReorder,
  type ReorderDependencies,
} from './ReorderAction';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/app/checkout/reorder-actions', () => ({
  restoreCanceledOrderToCartAction: vi.fn(),
}));

const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';

function deps(overrides: Partial<ReorderDependencies> = {}): ReorderDependencies {
  return {
    cancel: vi.fn().mockResolvedValue('canceled'),
    restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 2, skipped: [], coupon: 'none', storeCreditUsed: 0 }),
    ...overrides,
  };
}

describe('runReorder', () => {
  it('기존 고객 취소 경로로 취소한 뒤 품목을 다시 담는다', async () => {
    const dependencies = deps();

    await expect(runReorder(orderId, 'cancel_then_reorder', dependencies)).resolves.toEqual({ kind: 'restored', reapply: null });
    expect(dependencies.cancel).toHaveBeenCalledWith(orderId);
    expect(dependencies.restore).toHaveBeenCalledWith(orderId);
  });

  it('이미 취소된 주문(sweep이 먼저 닫음)도 다시 담는다', async () => {
    const dependencies = deps({ cancel: vi.fn().mockResolvedValue('already_canceled') });

    await expect(runReorder(orderId, 'cancel_then_reorder', dependencies)).resolves.toEqual({ kind: 'restored', reapply: null });
  });

  it('취소된 주문의 다시 담기는 취소를 부르지 않는다', async () => {
    const dependencies = deps();

    await expect(runReorder(orderId, 'reorder', dependencies)).resolves.toEqual({ kind: 'restored', reapply: null });
    expect(dependencies.cancel).not.toHaveBeenCalled();
  });

  /* 즉시 취소가 아니라 요청으로 접수됐다면 주문은 아직 살아 있다 — 같은 굿즈를 장바구니에
     다시 담으면 재고·한도가 두 번 잡힌 채 새 주문이 막힌다. */
  it('취소가 요청으로 접수되거나 막히면 장바구니를 건드리지 않는다', async () => {
    for (const [result, kind] of [
      ['requested', 'cancel_requested'],
      ['not_cancelable', 'cancel_blocked'],
      ['deadline_expired', 'cancel_blocked'],
      [false, 'cancel_failed'],
    ] as const) {
      const dependencies = deps({ cancel: vi.fn().mockResolvedValue(result) });
      await expect(runReorder(orderId, 'cancel_then_reorder', dependencies)).resolves.toEqual({ kind });
      expect(dependencies.restore).not.toHaveBeenCalled();
    }

    const throwing = deps({ cancel: vi.fn().mockRejectedValue(new Error('network')) });
    await expect(runReorder(orderId, 'cancel_then_reorder', throwing)).resolves.toEqual({ kind: 'cancel_failed' });
  });

  it('품절·판매 중지로 일부만 담기면 담지 못한 굿즈를 돌려준다', async () => {
    const skipped = [{ name: '홍실 키링 (파랑)', reason: 'out_of_stock' as const }];
    await expect(runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 1, skipped, coupon: 'restored', storeCreditUsed: 0 }),
    }))).resolves.toEqual({ kind: 'partial', skipped, reapply: null });
    await expect(runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 0, skipped, coupon: 'none', storeCreditUsed: 0 }),
    }))).resolves.toEqual({ kind: 'nothing_restored', skipped });
  });

  /* 쿠폰이 빠진 채 주문서로 넘기면 고객은 정가로 결제하고, 첫구매 쿠폰은 그 결제로 영영
     쓸 수 없게 된다(E-1). */
  it('쿠폰을 다시 고르지 못했거나 적립금을 쓴 주문은 다시 챙길 혜택을 돌려준다', async () => {
    const couponLost = await runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 2, skipped: [], coupon: 'not_restored', storeCreditUsed: 0 }),
    }));
    expect(couponLost).toEqual({ kind: 'restored', reapply: { coupon: 'reselect', storeCredit: 0 } });
    expect(reorderNavigatesToCheckout(couponLost)).toBe(false);

    const creditUsed = await runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 2, skipped: [], coupon: 'restored', storeCreditUsed: 2500 }),
    }));
    expect(creditUsed).toEqual({ kind: 'restored', reapply: { coupon: null, storeCredit: 2500 } });
    expect(reorderNavigatesToCheckout(creditUsed)).toBe(false);

    const couponBack = await runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 2, skipped: [], coupon: 'restored', storeCreditUsed: 0 }),
    }));
    expect(couponBack).toEqual({ kind: 'restored', reapply: null });
    expect(reorderNavigatesToCheckout(couponBack)).toBe(true);
  });

  /* 일부만 담긴 주문에서 쿠폰이 조건에 못 미치면, 주문서로 넘기는 순간 제출이 막힌다(E2-1).
     다시 고를 수 없는 쿠폰은 안내만 하고 주문서로 자동 이동하지 않는다(E2-2). */
  it('쿠폰이 조건 미달이거나 다시 고를 수 없으면 그 이유를 돌려주고 주문서로 자동 이동하지 않는다', async () => {
    const skipped = [{ name: '홍실 키링 (파랑)', reason: 'sold_out' as const }];
    const conditionsUnmet = await runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 1, skipped, coupon: 'conditions_unmet', storeCreditUsed: 0 }),
    }));
    expect(conditionsUnmet).toEqual({ kind: 'partial', skipped, reapply: { coupon: 'conditions_unmet', storeCredit: 0 } });

    const fullButUnmet = await runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 2, skipped: [], coupon: 'conditions_unmet', storeCreditUsed: 0 }),
    }));
    expect(fullButUnmet).toEqual({ kind: 'restored', reapply: { coupon: 'conditions_unmet', storeCredit: 0 } });
    expect(reorderNavigatesToCheckout(fullButUnmet)).toBe(false);

    const unavailable = await runReorder(orderId, 'reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 2, skipped: [], coupon: 'unavailable', storeCreditUsed: 0 }),
    }));
    expect(unavailable).toEqual({ kind: 'restored', reapply: { coupon: 'unavailable', storeCredit: 0 } });
    expect(reorderNavigatesToCheckout(unavailable)).toBe(false);
  });

  /* QA-3: 취소까지 마친 결과에서만 화면 위쪽 안내를 취소 사실로 바꾼다. */
  it('취소 단계를 마친 결과만 주문 취소로 본다', () => {
    const skipped = [{ name: '리바이 아크릴 스탠드', reason: 'unavailable' as const }];
    for (const outcome of [
      { kind: 'restored', reapply: null },
      { kind: 'partial', skipped, reapply: null },
      { kind: 'nothing_restored', skipped },
      { kind: 'restore_failed' },
    ] as const) {
      expect(reorderCanceledOrder('cancel_then_reorder', outcome)).toBe(true);
      expect(reorderCanceledOrder('reorder', outcome)).toBe(false);
    }
    for (const kind of ['cancel_requested', 'cancel_blocked', 'cancel_failed'] as const) {
      expect(reorderCanceledOrder('cancel_then_reorder', { kind })).toBe(false);
    }
  });

  it('취소 뒤 담기가 실패하면 그 사실을 따로 알린다', async () => {
    await expect(runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: false, error: 'failed' }),
    }))).resolves.toEqual({ kind: 'restore_failed' });
    await expect(runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockRejectedValue(new Error('network')),
    }))).resolves.toEqual({ kind: 'restore_failed' });
  });
});

describe('ReorderOutcomeNotice', () => {
  it('쿠폰이 빠졌으면 장바구니에서 다시 고르라고 안내하고 장바구니를 먼저 권한다', () => {
    const html = renderToStaticMarkup(
      <ReorderOutcomeNotice
        mode="cancel_then_reorder"
        orderId={orderId}
        outcome={{ kind: 'restored', reapply: { coupon: 'reselect', storeCredit: 2500 } }}
      />,
    );

    expect(html).toContain('주문은 취소됐어요. 굿즈를 장바구니에 다시 담았어요.');
    expect(html).toContain('장바구니에서 쿠폰을 다시 골라주세요');
    expect(html).toContain('적립금 2,500원은 주문서에서 다시 입력해주세요');
    expect(html.indexOf('href="/cart"')).toBeLessThan(html.indexOf('href="/checkout"'));
  });

  it('적립금만 다시 입력하면 되면 주문서를 먼저 권한다', () => {
    const html = renderToStaticMarkup(
      <ReorderOutcomeNotice
        mode="reorder"
        orderId={orderId}
        outcome={{ kind: 'restored', reapply: { coupon: null, storeCredit: 1000 } }}
      />,
    );

    expect(html).not.toContain('주문은 취소됐어요');
    expect(html).not.toContain('쿠폰');
    expect(html).toContain('적립금 1,000원은 주문서에서 다시 입력해주세요');
    expect(html.indexOf('href="/checkout"')).toBeLessThan(html.indexOf('href="/cart"'));
  });

  it('일부만 담겨 쿠폰 조건에 못 미치면 사실대로 알리고 장바구니를 먼저 권한다', () => {
    const html = renderToStaticMarkup(
      <ReorderOutcomeNotice
        mode="cancel_then_reorder"
        orderId={orderId}
        outcome={{
          kind: 'partial',
          skipped: [{ name: '홍실 키링 (파랑)', reason: 'sold_out' }],
          reapply: { coupon: 'conditions_unmet', storeCredit: 0 },
        }}
      />,
    );

    expect(html).toContain('담지 못한 굿즈: 홍실 키링 (파랑)(품절)');
    expect(html).toContain('지금 담긴 굿즈로는 사용 조건(최소 주문 금액 등)에 맞지 않아 할인되지 않아요');
    expect(html).toContain('장바구니에서 쿠폰 확인하기');
    expect(html).not.toContain('다시 골라주세요');
    expect(html.indexOf('href="/cart"')).toBeLessThan(html.indexOf('href="/checkout"'));
  });

  /* QA-3: 일부만 담긴 결과도 주문이 취소됐다는 사실을 먼저 말한다. */
  it('취소하고 다시 주문하기에서 일부만 담겨도 주문 취소 사실을 먼저 말한다', () => {
    const outcome = {
      kind: 'partial' as const,
      skipped: [{ name: '리바이 아크릴 스탠드', reason: 'unavailable' as const }],
      reapply: { coupon: 'conditions_unmet' as const, storeCredit: 0 },
    };
    const canceled = renderToStaticMarkup(
      <ReorderOutcomeNotice mode="cancel_then_reorder" orderId={orderId} outcome={outcome} />,
    );
    expect(canceled).toContain('주문은 취소됐어요. 일부 굿즈만 장바구니에 다시 담았어요. 담지 못한 굿즈: 리바이 아크릴 스탠드(지금 담을 수 없음)');

    const reorderOnly = renderToStaticMarkup(
      <ReorderOutcomeNotice mode="reorder" orderId={orderId} outcome={outcome} />,
    );
    expect(reorderOnly).not.toContain('주문은 취소됐어요');
    expect(reorderOnly).toContain('일부 굿즈만 장바구니에 다시 담았어요');
  });

  it('다시 고를 수 없는 쿠폰은 장바구니에서 고르라고 하지 않고 주문서를 먼저 권한다', () => {
    const html = renderToStaticMarkup(
      <ReorderOutcomeNotice
        mode="reorder"
        orderId={orderId}
        outcome={{ kind: 'restored', reapply: { coupon: 'unavailable', storeCredit: 0 } }}
      />,
    );

    expect(html).toContain('만료·사용 완료·사용 중단 등으로 지금 쓸 수 없어 이번 주문에는 적용되지 않아요');
    expect(html).not.toContain('다시 골라주세요');
    expect(html).not.toContain('장바구니에서 쿠폰');
    expect(html.indexOf('href="/checkout"')).toBeLessThan(html.indexOf('href="/cart"'));
  });

  it('담지 못한 굿즈 사유를 사실 범위대로 적는다', () => {
    const html = renderToStaticMarkup(
      <ReorderOutcomeNotice
        mode="cancel_then_reorder"
        orderId={orderId}
        outcome={{
          kind: 'nothing_restored',
          skipped: [
            { name: '홍실 키링', reason: 'sold_out' },
            { name: '홍실 쿠션', reason: 'unavailable' },
          ],
        }}
      />,
    );

    expect(html).toContain('홍실 키링(품절)');
    expect(html).toContain('홍실 쿠션(지금 담을 수 없음)');
    expect(html).not.toContain('판매 중지');
  });
});

describe('ReorderAction', () => {
  it('모드에 맞는 버튼 문구를 보인다', () => {
    expect(renderToStaticMarkup(<ReorderAction mode="cancel_then_reorder" orderId={orderId} />))
      .toContain('이 주문 취소하고 다시 주문하기');
    expect(renderToStaticMarkup(<ReorderAction mode="reorder" orderId={orderId} />))
      .toContain('같은 굿즈 다시 담기');
  });
});
