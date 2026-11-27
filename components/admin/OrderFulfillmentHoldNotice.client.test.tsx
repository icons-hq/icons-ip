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
const render = (holds: OrderFulfillmentHold[], canManage = true, orderNumber?: string) => { hooks.index = 0; return OrderFulfillmentHoldNotice({ orderId: ORDER_ID, orderNumber, holds, canManage }); };
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
  /* 막히는 일의 이름은 발주·발송 화면과 같다(출고지시 내려받기·발송처리). */
  expect(text(tree)).toContain('출고지시 내려받기');
  expect(text(tree)).toContain('발송처리');
  expect(text(tree)).not.toContain('출고지시 내보내기');
});

it('해제는 사유를 받는 확인창(adminPrompt)을 거쳐 같은 주문·사유로 서버 액션을 부르고 화면을 새로 읽는다', async () => {
  mocks.release.mockResolvedValue({ ok: true, message: '출고 보류를 해제했습니다.' });
  const button = all(render([testHold])).find(element => element.type !== undefined && text(element).includes('사유 적고 보류 해제') && element.props.onClick);
  button!.props.onClick!();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toMatchObject({ destructive: true, confirmLabel: '보류 해제', cancelLabel: '돌아가기', input: { label: '해제 사유 (필수)', minLength: 5, maxLength: 500 } });
  /* 사유는 필수이고, 어디에 남는지를 확인창이 한 줄로 말한다. 무엇을 적을지는 입력칸 예시 글이 보인다(안내 문장이 아니다). */
  expect(prompts[0].message).toContain('해제하면 주문 타임라인에 \'출고 보류 해제\'가 남고, 사유는 감사 기록에 남습니다.');
  expect(prompts[0].message).not.toContain('적어주세요');
  expect(prompts[0].input?.placeholder).toMatch(/^예: /);
  expect(mocks.release).toHaveBeenCalledWith({ orderId: ORDER_ID, reason: 'test_payment', note: '고객 결제를 따로 받음', operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it('해제 확인창 맨 위에 어느 주문인지 주문번호로 말한다(번호를 받았을 때만)', async () => {
  mocks.release.mockResolvedValue({ ok: true, message: '출고 보류를 해제했습니다.' });
  all(render([testHold], true, '2026111800000651')).find(element => element.props.onClick)!.props.onClick!();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(prompts[0].message.startsWith('주문 2026111800000651\n')).toBe(true);
  expect(prompts[0].message).not.toContain(ORDER_ID);
  prompts = [];
  all(render([testHold])).find(element => element.props.onClick)!.props.onClick!();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(prompts[0].message.startsWith('주문 ')).toBe(false);
});

it('확인창을 닫으면 아무것도 부르지 않고, 조회 권한만 있으면 누를 수 있는 해제 버튼이 없다', async () => {
  restore();
  restore = setAdminConfirmHandler(async () => false);
  all(render([testHold])).find(element => element.props.onClick)!.props.onClick!();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(mocks.release).not.toHaveBeenCalled();
  expect(all(render([testHold], false)).some(element => element.props.onClick)).toBe(false);
});

it('조회 권한만 있으면 해제 버튼을 지우지 않고 잠근 채 이유를 보인다', () => {
  const tree = render([testHold], false);
  const button = all(tree).find(element => text(element).includes('사유 적고 보류 해제') && (element.props as { disabled?: boolean }).disabled === true);
  expect(button).toBeTruthy();
  expect(text(tree)).toContain('보류 해제는 판매 관리 권한이 있는 운영자만 할 수 있습니다.');
  /* 권한이 있으면 이유 줄은 없다. */
  expect(text(render([testHold], true))).not.toContain('판매 관리 권한이 있는 운영자만');
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
  expect(text(list)).toContain('2026111800000001');
  /* 주문번호가 없는 옛 주문은 내부 번호(UUID) 대신 뜻을 말한다. */
  const noNumber = OrderFulfillmentHoldList({ list: { total: 1, items: [{ orderId: ORDER_ID, orderNumber: null, status: 'paid', holds: [testHold] }] }, hrefFor: id => id });
  expect(text(noNumber)).toContain('주문번호 없음');
  expect(text(noNumber)).not.toContain(ORDER_ID);
  expect(all(list).some(element => element.props.href === `/admin/sales/orders?orderId=${ORDER_ID}`)).toBe(true);
});

/* 토스 가상계좌(ADR-0049) 보류: 해제 확인창은 사유별로 적을 내용을 말하고, 같은 사유로 서버 액션을 부른다. */
it('입금 오류 되돌림·에스크로 취소 요청 보류의 해제 확인창은 사유별 안내를 보인다', async () => {
  mocks.release.mockResolvedValue({ ok: true, message: '출고 보류를 해제했습니다.' });
  for (const [reason, phrase] of [['deposit_reversed', '은행이 가상계좌 입금을 취소한 결제'], ['escrow_cancel_requested', '구매안전서비스(에스크로)에서 취소를 신청한 결제']] as const) {
    prompts = [];
    const hold: OrderFulfillmentHold = { ...testHold, reason };
    expect(text(render([hold]))).toContain(reason === 'deposit_reversed' ? '입금 오류 되돌림' : '에스크로 취소 요청');
    all(render([hold])).find(element => element.props.onClick)!.props.onClick!();
    for (let n = 0; n < 8; n++) await Promise.resolve();
    expect(prompts[0]?.message, reason).toContain(phrase);
    expect(prompts[0]?.message, reason).not.toContain('적어주세요');
    expect(prompts[0]?.input?.placeholder, reason).toMatch(/^예: /);
    expect(mocks.release).toHaveBeenLastCalledWith(expect.objectContaining({ orderId: ORDER_ID, reason }));
  }
});
