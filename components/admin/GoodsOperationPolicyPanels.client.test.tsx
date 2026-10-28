import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

/* 로그인 세션 확인을 건너뛰고 패널 본문을 바로 그린다. 여기서 보는 것은 잠금 이유 문장의 표시 여부다. */
vi.mock('@/components/claim-contact/ClaimContactSession', () => ({
  ClaimContactSession: ({ children }: { children: (identity: unknown, scope: unknown) => ReactNode }) => children(
    { expectedActorId: 'operator-1', expectedSessionId: 'session-1' }, { capture: () => null, canApply: () => false }),
}));
vi.mock('@/app/admin/production-actions', () => ({ readGoodsProductionAction: vi.fn(), saveGoodsProductionAction: vi.fn() }));
vi.mock('@/app/admin/goods-fulfillment-actions', () => ({ readGoodsFulfillmentAction: vi.fn(), saveGoodsFulfillmentAction: vi.fn(), prepareDigitalAssetAction: vi.fn(), verifyDigitalAssetAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
import { GoodsFulfillmentPanel } from './GoodsFulfillmentPanel';
import { GoodsProductionPanel } from './GoodsProductionPanel';

const REASON = '기본 상품의 입력 상태를 확인하고 있습니다.';

/* T3a-7 근본 정리: 상품 편집기가 패널 위에 공통 잠금 안내를 보이면 패널은 같은 이유를 다시 그리지 않는다. */
describe.each([['수령 방식', GoodsFulfillmentPanel], ['주문 후 제작', GoodsProductionPanel]] as const)('%s 패널', (_name, Panel) => {
  it('잠금 이유 문장은 기본으로 보이고, 표시를 끄면 그리지 않는다', () => {
    expect(renderToStaticMarkup(<Panel goodId="good-1" accountId="operator-1" disabledReason={REASON} />)).toContain(`<p role="status">${REASON}</p>`);
    expect(renderToStaticMarkup(<Panel goodId="good-1" accountId="operator-1" disabledReason={REASON} showDisabledReason={false} />)).not.toContain(REASON);
  });
});
