import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 정기결제 카드 삭제: 브라우저 기본 confirm 대신 고객 공용 확인창으로 묻고, 확인했을 때만 삭제 요청을 보낸다. 렌더러 없이 버튼 핸들러만 본다. */
const mocks = vi.hoisted(() => ({ revoke: vi.fn(), refresh: vi.fn(), run: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
  useEffect: () => undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/my/subscriptions/actions', () => ({ revokeSubscriptionCardAction: mocks.revoke }));
vi.mock('./useSubscriptionRequest', () => ({ useSubscriptionRequest: () => ({ run: mocks.run, recover: vi.fn(), retry: vi.fn(), isCurrent: () => true,
  pending: false, blocked: false, ready: true, failure: null, locked: false }) }));
import { stubCustomerConfirm } from '@/lib/customer-confirm.test-support';
import type { SubscriptionCard } from '@/lib/subscriptions/customer';
import { SubscriptionCards } from './SubscriptionCards';

type Node = ReactElement<Record<string, unknown>>;
const actor = 'b1716000-0000-4000-8000-000000000010';
const card: SubscriptionCard = { id: 'b1716000-0000-4000-8000-000000000030', state: 'active', issuerCode: '41', number: '신한 ****1234', revision: 3, activePlanCount: 0 };
const all = (node: ReactNode): Node[] => Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map((child) => isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child)).join('');
function press(label: string, cards: readonly SubscriptionCard[] = [card]) {
  const button = all(SubscriptionCards({ actorId: actor, cards, canRegister: false })).find((node) => node.type === 'button' && text(node) === label);
  expect(button, label).toBeDefined();
  expect(button!.props.disabled).toBe(false);
  return (button!.props.onClick as () => Promise<void>)();
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
let confirm: ReturnType<typeof stubCustomerConfirm> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockImplementation((send: () => Promise<{ ok: boolean; value?: unknown }>, accept: (value: unknown) => void) => {
    void send().then((result) => { if (result.ok) accept(result.value); });
  });
  mocks.revoke.mockResolvedValue({ ok: true, value: { state: 'revoked' } });
  const native = vi.fn(() => { throw new Error('native confirm must not be used'); });
  vi.stubGlobal('window', { confirm: native }); vi.stubGlobal('confirm', native);
});
afterEach(() => { confirm?.restore(); confirm = null; vi.unstubAllGlobals(); });

describe('SubscriptionCards 카드 삭제 확인', () => {
  it('카드 삭제는 고객 확인창에 먼저 묻고, 돌아가기를 고르면 삭제 요청을 보내지 않는다', async () => {
    confirm = stubCustomerConfirm(false);
    await press('카드 삭제');
    expect(confirm).toHaveBeenCalledWith({ title: '이 카드를 정기결제에서 삭제할까요?', message: '이미 결제한 주문의 환불은 주문 내역에서 별도로 요청할 수 있어요.', confirmLabel: '카드 삭제' });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('카드 삭제를 확인하면 누른 때의 카드 판으로 삭제 요청을 한 번 보낸다', async () => {
    confirm = stubCustomerConfirm(true);
    await press('카드 삭제'); await flush();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.revoke).toHaveBeenCalledWith({ expectedActorId: actor, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), credentialId: card.id, expectedRevision: 3 });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it('확인이 필요한 카드의 삭제 다시 요청도 같은 확인창을 거친다', async () => {
    confirm = stubCustomerConfirm(false);
    await press('삭제 다시 요청', [{ ...card, state: 'needs_review' }]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].confirmLabel).toBe('카드 삭제');
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
