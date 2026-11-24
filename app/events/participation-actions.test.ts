import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { attendanceCheckInAction } from './participation-actions';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  revalidate: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const CAMPAIGN_PATH = '/events/summer';

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
    },
    isStaff: false,
  };
}

function attendanceForm(next: string = CAMPAIGN_PATH) {
  const form = new FormData();
  form.set('next', next);
  return form;
}

beforeEach(() => {
  mocks.auth = onboardedAuth();
  mocks.revalidate.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: { status: 'checked', balance: 4 }, error: null });
});

describe('참여 액션 게이트', () => {
  /* 보호 액션 3단 게이트 — 로그인 → 정지 → 온보딩. 순서가 갈리면 정지된 계정이
     온보딩 화면으로 샌다. */
  it('비로그인은 복귀 경로를 붙여 로그인으로 보낸다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(attendanceCheckInAction({}, attendanceForm()))
      .rejects.toThrow(`NEXT_REDIRECT:/login?next=${encodeURIComponent(CAMPAIGN_PATH)}`);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('정지된 계정은 안내 화면으로 보낸다', async () => {
    mocks.auth = {
      ...onboardedAuth(),
      profile: { ...onboardedAuth().profile, suspended_at: '2026-07-17T00:00:00.000Z' },
    };

    await expect(attendanceCheckInAction({}, attendanceForm()))
      .rejects.toThrow('NEXT_REDIRECT:/account-suspended');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('온보딩 미완료는 온보딩으로 보낸다', async () => {
    mocks.auth = { ...onboardedAuth(), profile: { ...onboardedAuth().profile, nickname: null } };

    await expect(attendanceCheckInAction({}, attendanceForm()))
      .rejects.toThrow(`NEXT_REDIRECT:/onboarding?next=${encodeURIComponent(CAMPAIGN_PATH)}`);
  });

  /* next 는 폼에서 오는 값이다 — 외부 주소를 그대로 쓰면 로그인 후 오픈 리다이렉트가 된다. */
  it('외부 주소로 온 next는 루트로 접는다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(attendanceCheckInAction({}, attendanceForm('https://evil.test/steal')))
      .rejects.toThrow(`NEXT_REDIRECT:/login?next=${encodeURIComponent('/')}`);
  });
});

describe('attendanceCheckInAction', () => {
  it('적립 결과와 잔액을 함께 알리고 그 페이지를 다시 그린다', async () => {
    const state = await attendanceCheckInAction({}, attendanceForm());

    expect(mocks.rpc).toHaveBeenCalledWith('attendance_check_in');
    expect(state.status).toBe('success');
    expect(state.message).toContain('출석 완료');
    expect(state.message).toContain('4');
    expect(mocks.revalidate).toHaveBeenCalledWith(CAMPAIGN_PATH);
  });

  it('같은 날 두 번째 호출은 이미 출석했다고 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'already_checked', balance: 7 }, error: null });

    const state = await attendanceCheckInAction({}, attendanceForm());

    expect(state).toEqual({ status: 'success', message: '오늘은 이미 출석했어요. 지금 코인 7개예요.' });
  });

  it('정지 경합은 계정 안내로 번역한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'account_suspended' } });

    const state = await attendanceCheckInAction({}, attendanceForm());

    expect(state).toEqual({ status: 'error', message: '정지된 계정은 이벤트에 참여할 수 없어요.' });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  /* 탈퇴 신청으로 쓰기가 봉인된 계정. "잠시 후 다시"로 접으면 될 때까지 다시 누른다. */
  it('탈퇴 봉인은 되풀이하지 말라고 말한다', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'account_deletion_write_fenced' },
    });

    const state = await attendanceCheckInAction({}, attendanceForm());

    expect(state).toEqual({
      status: 'error',
      message: '탈퇴 처리 중인 계정에서는 이용할 수 없어요.',
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
