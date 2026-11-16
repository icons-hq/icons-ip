import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 정기구매 일시정지·해지: 브라우저 기본 confirm 대신 고객 공용 확인창으로 묻고, 확인했을 때만 상태 변경 요청을 보낸다. 렌더러 없이 버튼 핸들러만 본다. */
const mocks = vi.hoisted(() => ({ change: vi.fn(), run: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
  useEffect: () => undefined, useCallback: (callback: unknown) => callback }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/my/subscriptions/actions', () => ({ changeGoodsSubscriptionStateAction: mocks.change, confirmGoodsSubscriptionAction: vi.fn(),
  confirmGoodsSubscriptionChangeAction: vi.fn(), prepareGoodsSubscriptionAction: vi.fn(), prepareGoodsSubscriptionChangeAction: vi.fn(),
  readGoodsSubscriptionAction: vi.fn(), revokeSubscriptionCardAction: vi.fn() }));
vi.mock('@/components/subscriptions/useSubscriptionRequest', () => ({ useSubscriptionUnsaved: () => undefined,
  useSubscriptionRequest: () => ({ run: mocks.run, recover: vi.fn(), retry: vi.fn(), isCurrent: () => true, pending: false, blocked: false, ready: true, failure: null, locked: false }) }));
import { stubCustomerConfirm } from '@/lib/customer-confirm.test-support';
import type { GoodsSubscription } from '@/lib/subscriptions/customer';
import { SubscriptionDetail } from './SubscriptionDetail';

type Node = ReactElement<Record<string, unknown>>;
const actor = 'b1716000-0000-4000-8000-000000000010';
const plan = {
  id: 'b1716000-0000-4000-8000-000000000040', state: 'active', revision: 7, termsId: 'b1716000-0000-4000-8000-000000000050', pauseReason: null,
  nextRunAt: '2026-12-01T01:00:00.000Z', consentedAt: '2026-11-01T01:00:00.000Z', canceledAt: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T01:00:00.000Z',
  draftExpiresAt: '2026-11-01T00:30:00.000Z', firstCycleId: 'b1716000-0000-4000-8000-000000000060', firstQuoteId: null, policyTermsVersion: 'v1',
  schedule: { interval: 1, unit: 'month', anchorDate: '2026-12-01', time: '10:00', monthEnd: false }, selection: [], firstDisplay: {}, renewalDisplay: {}, card: null,
  address: { recipientName: '합성 고객', phone: '01000000000', postalCode: '06000', address1: '서울시 합성구', address2: '' }, deliveryChoices: {}, cycles: [],
} as unknown as GoodsSubscription;
const all = (node: ReactNode): Node[] => Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map((child) => isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child)).join('');
function press(label: string, initialPlan: GoodsSubscription = plan) {
  const tree = SubscriptionDetail({ actorId: actor, initialPlan, cards: [], canRegister: false, history: { rows: [], total: 0, hasMore: false, nextBeforeNumber: null }, older: false });
  const button = all(tree).find((node) => node.type === 'button' && text(node) === label);
  expect(button, label).toBeDefined();
  expect(button!.props.disabled).toBe(false);
  return (button!.props.onClick as () => Promise<void>)();
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
let confirm: ReturnType<typeof stubCustomerConfirm> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockImplementation((send: () => Promise<unknown>) => { void send(); });
  mocks.change.mockResolvedValue({ ok: true, value: plan });
  const native = vi.fn(() => { throw new Error('native confirm must not be used'); });
  vi.stubGlobal('window', { confirm: native }); vi.stubGlobal('confirm', native);
});
afterEach(() => { confirm?.restore(); confirm = null; vi.unstubAllGlobals(); });

describe('SubscriptionDetail 일시정지·해지 확인', () => {
  it('정기구매 해지는 고객 확인창에 먼저 묻고, 돌아가기를 고르면 해지 요청을 보내지 않는다', async () => {
    confirm = stubCustomerConfirm(false);
    await press('정기구매 해지');
    expect(confirm).toHaveBeenCalledWith({ title: '정기구매를 해지할까요?', message: '이미 생성된 주문은 주문 내역에서 따로 확인해주세요.', confirmLabel: '정기구매 해지' });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it('해지를 확인하면 누른 때의 신청 판으로 해지 요청을 한 번 보낸다', async () => {
    confirm = stubCustomerConfirm(true);
    await press('정기구매 해지'); await flush();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.change).toHaveBeenCalledWith({ expectedActorId: actor, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), planId: plan.id, expectedRevision: 7, command: 'cancel' });
  });
  it('일시정지도 고객 확인창을 거치고, 확인했을 때만 일시정지 요청을 보낸다', async () => {
    confirm = stubCustomerConfirm(false);
    await press('일시정지');
    expect(confirm).toHaveBeenCalledWith({ title: '정기구매를 일시정지할까요?', confirmLabel: '일시정지' });
    expect(mocks.change).not.toHaveBeenCalled();
    confirm.restore(); confirm = stubCustomerConfirm(true);
    await press('일시정지'); await flush();
    expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ planId: plan.id, expectedRevision: 7, command: 'pause' }));
  });
  it('일시정지한 신청에는 해지만 남고, 해지도 같은 확인창을 거친다', async () => {
    confirm = stubCustomerConfirm(false);
    const paused = { ...plan, state: 'paused' } as GoodsSubscription;
    const labels = all(SubscriptionDetail({ actorId: actor, initialPlan: paused, cards: [], canRegister: false, history: { rows: [], total: 0, hasMore: false, nextBeforeNumber: null }, older: false }))
      .filter((node) => node.type === 'button').map((node) => text(node));
    expect(labels).not.toContain('일시정지');
    await press('정기구매 해지', paused);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.change).not.toHaveBeenCalled();
  });
});
