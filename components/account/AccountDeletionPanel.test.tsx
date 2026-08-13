import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountDeletionPanel,
  focusAccountDeletionConfirmation,
} from './AccountDeletionPanel';

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  focus: vi.fn(),
  state: {} as { error?: string; message?: string },
  submit: vi.fn(),
}));

vi.mock('@/app/settings/actions', () => ({
  requestAccountDeletionAction: mocks.action,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [mocks.state, mocks.submit, false],
    useEffect: (effect: () => void) => effect(),
    useRef: () => ({ current: { focus: mocks.focus } }),
  };
});

function render() {
  return renderToStaticMarkup(
    <AccountDeletionPanel
      presentation={{
        preview: { available: true, eligible: true, blockers: [] },
        status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
      }}
      requestKey="123e4567-e89b-42d3-a456-426614174000"
    />,
  );
}

function renderBlocked() {
  return renderToStaticMarkup(
    <AccountDeletionPanel
      presentation={{
        preview: {
          available: true,
          eligible: false,
          blockers: [
            { code: 'active_order_payment', count: 1, path: '/orders' },
            { code: 'active_ticket_payment', count: 2, path: '/tickets' },
          ],
        },
        status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
      }}
      requestKey="123e4567-e89b-42d3-a456-426614174000"
    />,
  );
}

describe('AccountDeletionPanel accessibility', () => {
  beforeEach(() => {
    mocks.focus.mockReset();
    mocks.state = {};
  });

  it('associates a request error with the confirmation and marks it invalid', () => {
    mocks.state = { error: '확인 문구를 정확히 입력해주세요.' };

    const html = render();
    const input = html.match(/<input[^>]*id="account-deletion-confirmation"[^>]*>/)?.[0];

    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain(
      'aria-describedby="account-deletion-confirmation-hint account-deletion-confirmation-error"',
    );
    expect(html).toContain('id="account-deletion-confirmation-error"');
    expect(mocks.focus).toHaveBeenCalledOnce();
  });

  it('uses semantic account-surface classes without legacy dark tokens', () => {
    const html = render();

    expect(html).toContain('account-deletion-panel');
    expect(html).toContain('account-deletion-confirmation');
    expect(html).toContain('account-deletion-submit');
    expect(html).not.toContain('rgba(21,17,42');
    expect(html).not.toContain('#FFD08A');
    expect(html).not.toContain('var(--pink)');
  });

  it('states the separate irreversible hard-delete point before request submission', () => {
    const html = render();

    expect(html).toContain('현재 신청 단계에서는 계정이 삭제되지 않습니다');
    expect(html).toContain('hard delete와 복원 방지 원장 기록이 시작되면 되돌릴 수 없습니다');
    expect(html).toContain('별도 확인');
    expect(html).toContain('href="/login?next=%2Fsettings%2Fdelete-account&amp;reauth=1"');
    expect(html).toContain('다시 로그인');
  });

  it('names the blocked obligation and links to its actual resolution surface', () => {
    const html = renderBlocked();

    expect(html).toContain('href="/orders"');
    expect(html).toContain('굿즈 결제 확인 1건');
    expect(html).toContain('href="/tickets"');
    expect(html).toContain('티켓 결제 확인 2건');
  });

  it('focuses the first invalid confirmation control through the exported seam', () => {
    const focus = vi.fn();

    focusAccountDeletionConfirmation({ focus });

    expect(focus).toHaveBeenCalledOnce();
  });
});
