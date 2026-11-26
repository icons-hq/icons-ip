import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), inspect: vi.fn() }));
const request = vi.hoisted(() => ({ blocked: false, locked: false, pending: false, failure: null, retry: vi.fn(), run: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }), usePathname: () => '/admin/sales/subscriptions' }));
vi.mock('@/app/admin/subscription-actions', () => ({ inspectGoodsSubscriptionPaymentAction: mocks.inspect }));
vi.mock('@/components/subscriptions/useSubscriptionRequest', () => ({ useSubscriptionRequest: () => request }));
import { AdminSubscriptionDetailScreen } from './AdminSubscriptionDetailScreen';
import { Button } from '@/components/admin/kit/ui/button';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
const PLAN = 'c00000a3-0000-4000-8000-00000000a301', CYCLE = 'c00000a3-0000-4000-8000-00000000a3c1', ORDER = 'c0000010-0000-4000-8000-000000000042';
const cycle = { id: CYCLE, number: 3, state: 'unknown', scheduledAt: '2026-11-14T04:00:00Z', orderId: ORDER, orderStatus: 'pending', amount: 19000, settledAt: null };
const plan = { id: PLAN, ownerId: 'owner', buyerName: '춘식이집사', state: 'active', revision: 1, createdAt: '2026-10-25T04:29:00Z', updatedAt: '2026-11-14T04:00:00Z', nextRunAt: null,
  schedule: { unit: 'month', count: 1 }, goodsLabel: '스타포스 강화 스티커 1개', renewalOnlineTotal: 19000, renewalCollectTotal: 0, paidCycleCount: 2, paidOnlineTotal: 38000, reason: 'payment_review',
  latestCycle: { id: CYCLE, number: 3, state: 'unknown', orderId: ORDER, dispatchedAt: '2026-11-14T04:00:01Z', nextCheckAt: null, reason: null } };
const dataOf = (overrides: { plan?: Record<string, unknown>; rows?: unknown[] } = {}) => ({ subscription: { ...plan, ...overrides.plan },
  cycles: { rows: overrides.rows ?? [cycle], total: 3, hasMore: false, nextBeforeNumber: null } }) as never;
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function render(data = dataOf(), canManage = true) { hooks.index = 0; return AdminSubscriptionDetailScreen({ actorId: 'actor', data, canManage, older: false }); }
const button = (label: string, data = dataOf()) => all(render(data)).find(element => element.type === Button && text(element) === label);
async function settle() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
async function click(label: string, data = dataOf()) { const target = button(label, data); if (!target) throw new Error(label); target.props.onClick?.(); await settle(); }
let asked: AdminConfirmRequest[] = [], answer = true, restore = () => {};
beforeEach(() => { hooks.state = []; vi.clearAllMocks(); request.blocked = false; request.locked = false; asked = []; answer = true;
  restore = setAdminConfirmHandler(async next => { asked.push(next); return answer; }); });
afterEach(() => { restore(); });

/* [현재 회차 결제 결과 조회]는 이름과 달리 결과를 회차에 반영하고, 결제가 이미 됐으면 구매자에게 주문 확인 메일·알림톡이 나간다. 누르면 먼저 대상과 결과를 말하고 묻는다. */
it('결제 결과 조회는 대상·금액과 결과를 말하는 확인창 뒤에 요청한다', async () => {
  await click('현재 회차 결제 결과 조회');
  expect(asked).toHaveLength(1);
  const [ask] = asked;
  expect(ask).toMatchObject({ title: '현재 회차 결제 결과를 조회할까요?', confirmLabel: '결제 결과 조회', cancelLabel: '돌아가기' });
  expect(ask.message).toContain('춘식이집사님 · 스타포스 강화 스티커 1개 · 3회차 · ₩19,000');
  expect(ask.message).toContain('결제사에서 이 회차의 결제 결과를 조회하고, 그 결과대로 회차 상태를 바꿉니다');
  expect(ask.message).toContain('구매자에게 주문 확인 메일·알림톡이 나갈 수 있습니다'); expect(ask.message).toContain('새로 결제하지는 않습니다.');
  expect(request.run).toHaveBeenCalledOnce(); expect(mocks.inspect).not.toHaveBeenCalled();
  /* 확인한 뒤에야 서버 액션으로 넘기고, 같은 회차에 새 작업 번호를 붙인다. */
  const [send, accept] = request.run.mock.calls[0] as [() => Promise<unknown>, (value: string) => void];
  mocks.inspect.mockResolvedValueOnce({ ok: true, value: '결제 조회 결과를 반영했습니다.' }); await send();
  expect(mocks.inspect).toHaveBeenCalledWith({ expectedActorId: 'actor', cycleId: CYCLE, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  accept('결제 조회 결과를 반영했습니다.'); expect(mocks.refresh).toHaveBeenCalledOnce();
});
it('돌아가기를 누르면 아무것도 요청하지 않는다', async () => {
  answer = false; await click('현재 회차 결제 결과 조회');
  expect(asked).toHaveLength(1); expect(request.run).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('긴 상품 이름은 줄이고, 그 회차가 이 쪽에 없어 금액을 모르면 금액을 적지 않는다', async () => {
  await click('현재 회차 결제 결과 조회', dataOf({ rows: [], plan: { goodsLabel: `${'아주 긴 상품 이름 '.repeat(12)}1개` } }));
  const [ask] = asked, first = ask.message.split('\n')[0];
  expect(first).toContain('…'); expect(first).not.toContain('₩'); expect(first).toContain('3회차'); expect(first.length).toBeLessThan(90);
});
it('권한이 없거나 조회할 회차가 아니면 버튼을 그리지 않는다', () => {
  expect(button('현재 회차 결제 결과 조회', dataOf())).toBeDefined();
  expect(button('현재 회차 결제 결과 조회', dataOf({ plan: { latestCycle: { ...plan.latestCycle, state: 'approved' } } }))).toBeUndefined();
  expect(all(render(dataOf(), false)).some(element => element.type === Button && text(element) === '현재 회차 결제 결과 조회')).toBe(false);
});
