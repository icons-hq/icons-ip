import { describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock('../supabase/service', () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    limit: async () => ({ data: rows.data, error: null }),
  };
  return { createServiceClient: () => ({ from: () => builder }) };
});

import {
  RESTRICTED_GOODS_CARD_PROVIDER,
  deriveGoodsCartProvider,
  deriveGoodsOrderProvider,
  deriveUserCartProvider,
} from './goods-sale-restriction.server';

describe('판매 제한(19금) 주문의 카드 결제사 파생 — ADR-0053', () => {
  it('19금 상품이 담긴 주문도 토스로 파생한다(2026-11-25 사용자 결정)', () => {
    expect(RESTRICTED_GOODS_CARD_PROVIDER).toBe('toss');
  });

  it('19금 상품이 섞인 주문·카트·서버 카트 모두 토스다', async () => {
    rows.data = [{ id: 'adult-good' }];
    await expect(deriveGoodsOrderProvider('00000000-0000-4000-8000-000000000001')).resolves.toBe('toss');
    await expect(deriveGoodsCartProvider(['adult-good'])).resolves.toBe('toss');
    await expect(deriveUserCartProvider('00000000-0000-4000-8000-000000000002')).resolves.toBe('toss');
  });

  it('일반 상품만 담긴 주문은 지금처럼 토스다', async () => {
    rows.data = [];
    await expect(deriveGoodsOrderProvider('00000000-0000-4000-8000-000000000001')).resolves.toBe('toss');
    await expect(deriveGoodsCartProvider(['plain-good'])).resolves.toBe('toss');
  });
});
