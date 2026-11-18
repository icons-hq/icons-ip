import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({ release: vi.fn(), refresh: vi.fn(), busy: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }]; },
  useTransition: () => [false, (run: () => unknown) => { void run(); }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/fulfillment-hold-actions', () => ({ releaseOrderFulfillmentHoldAction: mocks.release }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: mocks.busy }));
import { OrderFulfillmentHoldBadges, OrderFulfillmentHoldList, OrderFulfillmentHoldNotice } from './OrderFulfillmentHoldNotice';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import type { OrderFulfillmentHold } from '@/lib/admin/fulfillment-holds';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; href?: string }>;
function all(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  /* 함수 컴포넌트(AdminNotice·배지 등)는 펼쳐서 안쪽 버튼·글자까지 본다. */
  if (typeof element.type === 'function') {
    const rendered = (element.type as (props: unknown) => ReactNode)(element.props);
    return [element, ...all(rendered)];
  }
  return [element, ...all(element.props.children)];
}
function text(node: ReactNode): string {
  return all(node).map(element => {
    const children = element.props.children;
    return typeof children === 'string' ? children : Array.isArray(children) ? children.filter(child => typeof child === 'string').join('') : '';
  }).join(' ');
}
const ORDER_ID = '20000000-0000-4000-8000-000000000651';
const testHold: OrderFulfillmentHold = { reason: 'test_payment', placedAt: '2026-11-18T01:00:00Z', providerStatus: null, providerCanceledAmount: null, unexplainedAmount: null, paymentAmount: 31000, outboundBlocked: true };
const render = (holds: OrderFulfillmentHold[], canManage = true) => { hooks.index = 0; return OrderFulfillmentHoldNotice({ orderId: ORDER_ID, holds, canManage }); };
let prompts: AdminConfirmRequest[] = [];
let restore: () => void = () => {};
beforeEach(() => {
  hooks.state = []; prompts = []; vi.clearAllMocks();
  restore = setAdminConfirmHandler(async (request) => { prompts.push(request); request.receive?.('고객 결제를 따로 받음'); return true; });
});
afterEach(() => restore());

it('보류가 없으면 그리지 않고, 있으면 사유별 다음 행동을 보인다', () => {
  expect(render([])).toBeNull();
  const tree = render([testHold]);
  expect(text(tree)).toContain('출고 보류 중인 주문입니다');
  expect(text(tree)).toContain('운영자 전액 취소');
});

it('해제는 사유를 받는 확인창(adminPrompt)을 거쳐 같은 주문·사유로 서버 액션을 부르고 화면을 새로 읽는다', async () => {
  mocks.release.mockResolvedValue({ ok: true, message: '출고 보류를 해제했습니다.' });
  const button = all(render([testHold])).find(element => element.type !== undefined && text(element).includes('사유 적고 보류 해제') && element.props.onClick);
  button!.props.onClick!();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toMatchObject({ destructive: true, confirmLabel: '보류 해제', input: { minLength: 5, maxLength: 500 } });
  expect(mocks.release).toHaveBeenCalledWith({ orderId: ORDER_ID, reason: 'test_payment', note: '고객 결제를 따로 받음', operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it('확인창을 닫으면 아무것도 부르지 않고, 조회 권한만 있으면 해제 버튼이 없다', async () => {
  restore();
  restore = setAdminConfirmHandler(async () => false);
  all(render([testHold])).find(element => element.props.onClick)!.props.onClick!();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(mocks.release).not.toHaveBeenCalled();
  expect(all(render([testHold], false)).some(element => element.props.onClick)).toBe(false);
});

it('이미 발송된 주문의 보류는 경고 안내와 경고 배지다', () => {
  const shipped: OrderFulfillmentHold = { ...testHold, reason: 'provider_canceled', providerStatus: 'CANCELED', providerCanceledAmount: 31000, unexplainedAmount: 31000, outboundBlocked: false };
  const tree = render([shipped]);
  expect(text(tree)).toContain('발송 뒤 결제 확인이 필요한 주문입니다');
  expect(text(tree)).toContain('배송완료 처리는 막지 않습니다');
  expect(text(OrderFulfillmentHoldBadges({ holds: [shipped] }))).toContain('발송 후 결제사 취소 확인');
});

it('배지와 목록 묶음', () => {
  expect(text(OrderFulfillmentHoldBadges({ holds: [testHold] }))).toContain('출고 보류 · 테스트 결제');
  expect(OrderFulfillmentHoldList({ list: { total: 0, items: [] }, hrefFor: id => id })).toBeNull();
  const list = OrderFulfillmentHoldList({ list: { total: 2, items: [{ orderId: ORDER_ID, orderNumber: '2026111800000001', status: 'paid', holds: [testHold] }] }, hrefFor: id => `/admin/sales/orders?orderId=${id}` });
  expect(text(list)).toContain('출고 보류 주문 2건');
  expect(all(list).some(element => element.props.href === `/admin/sales/orders?orderId=${ORDER_ID}`)).toBe(true);
});
