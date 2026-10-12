import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReorderAction, runReorder, type ReorderDependencies } from './ReorderAction';

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
    restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 2, skipped: [] }),
    ...overrides,
  };
}

describe('runReorder', () => {
  it('기존 고객 취소 경로로 취소한 뒤 품목을 다시 담는다', async () => {
    const dependencies = deps();

    await expect(runReorder(orderId, 'cancel_then_reorder', dependencies)).resolves.toEqual({ kind: 'restored' });
    expect(dependencies.cancel).toHaveBeenCalledWith(orderId);
    expect(dependencies.restore).toHaveBeenCalledWith(orderId);
  });

  it('이미 취소된 주문(sweep이 먼저 닫음)도 다시 담는다', async () => {
    const dependencies = deps({ cancel: vi.fn().mockResolvedValue('already_canceled') });

    await expect(runReorder(orderId, 'cancel_then_reorder', dependencies)).resolves.toEqual({ kind: 'restored' });
  });

  it('취소된 주문의 다시 담기는 취소를 부르지 않는다', async () => {
    const dependencies = deps();

    await expect(runReorder(orderId, 'reorder', dependencies)).resolves.toEqual({ kind: 'restored' });
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
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 1, skipped }),
    }))).resolves.toEqual({ kind: 'partial', skipped });
    await expect(runReorder(orderId, 'cancel_then_reorder', deps({
      restore: vi.fn().mockResolvedValue({ ok: true, restoredLines: 0, skipped }),
    }))).resolves.toEqual({ kind: 'nothing_restored', skipped });
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

describe('ReorderAction', () => {
  it('모드에 맞는 버튼 문구를 보인다', () => {
    expect(renderToStaticMarkup(<ReorderAction mode="cancel_then_reorder" orderId={orderId} />))
      .toContain('이 주문 취소하고 다시 주문하기');
    expect(renderToStaticMarkup(<ReorderAction mode="reorder" orderId={orderId} />))
      .toContain('같은 굿즈 다시 담기');
  });
});
