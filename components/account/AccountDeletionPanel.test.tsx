import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INQUIRY_WITHDRAWAL_SCOPE } from '@/lib/account-deletion';
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

function renderUnavailable() {
  return renderToStaticMarkup(
    <AccountDeletionPanel
      presentation={{
        preview: { available: false, eligible: false, blockers: [{ code: 'not_available', count: 1, path: '/settings' }] },
        status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
      }}
      requestKey="123e4567-e89b-42d3-a456-426614174000"
    />,
  );
}

describe('AccountDeletionPanel · 탈퇴 신청 기능이 꺼져 있을 때(원장 CUS-035)', () => {
  beforeEach(() => {
    mocks.focus.mockReset();
    mocks.state = {};
  });

  it('1:1 문의로 탈퇴를 접수한다고 안내하고 계정 유형 문의 작성으로 잇는다', () => {
    const html = renderUnavailable();

    expect(html).toContain('지금은 1:1 문의로 탈퇴 요청을 받고 있어요');
    expect(html).toContain('href="/my/inquiries/new?category=account"');
    expect(html).toContain('1:1 문의로 탈퇴 요청하기');
    expect(html).toContain('배송지·인증한 휴대폰 번호·마케팅 정보 수신 동의·성별·활동 기록·재입고 알림 신청·생년월일·프로필 사진은 바로 지워지고, 닉네임은 ‘탈퇴한 회원’으로 바뀌어요');
    expect(html).toContain('거래 기록은 관련 법에 따라 정해진 기간(최대 5년) 보관한 뒤 파기해요');
    expect(html).toContain('진행 중인 주문·배송·취소·환불, 이용 전 티켓, 정기배송이 있으면 그 일이 끝난 뒤 처리돼요');
  });

  /* 처리는 완전 삭제가 아니다 — 남는 정보와 재가입 불가를 어드민 처리 화면과 같은 목록으로 알린다(리뷰 2). */
  it('처리 뒤에도 남는 정보와 같은 이메일 재가입 불가를 알린다', () => {
    const html = renderUnavailable();

    for (const item of INQUIRY_WITHDRAWAL_SCOPE.retained) expect(html).toContain(item);
    expect(html).toContain('완전 삭제 절차가 준비될 때까지 이용할 수 없는 상태로 남아요');
    expect(html).toContain('같은 이메일로는 다시 가입할 수 없어요');
  });

  it('화면 신청 폼과 Phase 1 신청 설명·차단 목록은 그리지 않는다', () => {
    const html = renderUnavailable();

    expect(html).not.toContain('account-deletion-confirmation');
    expect(html).not.toContain('회원 탈퇴 신청');
    expect(html).not.toContain('hard delete');
    expect(html).not.toContain('신청 전 탈퇴 신청 준비');
    expect(html).not.toContain('아직 탈퇴 신청을 받지 않습니다');
  });
});

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
