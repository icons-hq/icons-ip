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

  it('focuses the first invalid confirmation control through the exported seam', () => {
    const focus = vi.fn();

    focusAccountDeletionConfirmation({ focus });

    expect(focus).toHaveBeenCalledOnce();
  });
});
