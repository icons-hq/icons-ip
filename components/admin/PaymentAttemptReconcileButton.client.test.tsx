import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, pending: [] as Promise<unknown>[] }));
const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }]; },
  useTransition: () => [false, (run: () => Promise<unknown>) => { hooks.pending.push(run()); }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/system-health-actions', () => ({ reconcilePaymentAttemptAction: mocks.reconcile }));
import { PaymentAttemptReconcileButton } from './PaymentAttemptReconcileButton';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; role?: string; 'aria-label'?: string }>;
function all(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...all(element.props.children)];
}
const ATTEMPT = 'a7000000-0000-4003-8000-000000000001';
const render = () => { hooks.index = 0; return PaymentAttemptReconcileButton({ attemptId: ATTEMPT, targetLabel: '2026111800000000001' }); };
const button = (node: ReactNode) => all(node).find(element => element.props['aria-label']?.endsWith('결제 상태 다시 확인'))!;
async function click(node: ReactNode) { button(node).props.onClick?.(); await Promise.all(hooks.pending.splice(0)); }

beforeEach(() => { hooks.state = []; hooks.pending = []; vi.clearAllMocks(); });

it('누르면 새 요청번호로 서버 액션을 부르고 확정되면 목록을 새로 읽는다', async () => {
  mocks.reconcile.mockResolvedValue({ ok: true, outcome: 'approved', message: '결제사에서 승인이 확인되어 결제를 확정했습니다.' });
  await click(render());
  expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith({ attemptId: ATTEMPT, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  const status = all(render()).find(element => element.props.role === 'status');
  expect(status?.props.children).toContain('승인이 확인되어');
});

it('실패는 경고로 보이고 목록을 새로 읽지 않는다', async () => {
  mocks.reconcile.mockResolvedValue({ ok: false, error: '방금 확인한 결제입니다. 1분 뒤 다시 시도해주세요.' });
  await click(render());
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(all(render()).find(element => element.props.role === 'alert')?.props.children).toContain('1분 뒤');
});
