import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { attendanceCheckInAction, exchangeCoinsAction } from './participation-actions';

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
const OFFER_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';

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

function exchangeForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set('next', CAMPAIGN_PATH);
  form.set('offerId', OFFER_ID);
  form.set('operationId', OPERATION_ID);
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
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

    await expect(exchangeCoinsAction({}, exchangeForm()))
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

describe('exchangeCoinsAction', () => {
  beforeEach(() => {
    mocks.rpc.mockResolvedValue({
      data: { status: 'exchanged', balance: 2, issued_count: 1 },
      error: null,
    });
  });

  it('멱등 키와 상품 id를 RPC에 그대로 넘긴다', async () => {
    const state = await exchangeCoinsAction({}, exchangeForm());

    expect(mocks.rpc).toHaveBeenCalledWith('exchange_coins_for_draw_tickets', {
      p_offer_id: OFFER_ID,
      p_operation_id: OPERATION_ID,
    });
    expect(state.status).toBe('success');
    expect(state.message).toContain('카드팩 교환이 완료됐어요');
  });

  /* 카드팩이 늘었으니 보관함도 다시 그려야 한다. */
  it('성공하면 캠페인과 카드팩 지면을 함께 다시 그린다', async () => {
    await exchangeCoinsAction({}, exchangeForm());

    expect(mocks.revalidate).toHaveBeenCalledWith(CAMPAIGN_PATH);
    expect(mocks.revalidate).toHaveBeenCalledWith('/packs');
  });

  /* 응답이 유실된 재시도다 — 카드팩은 이미 발급돼 있으므로 실패로 그리면 안 된다. */
  it('already_exchanged는 성공으로 안내한다', async () => {
    mocks.rpc.mockResolvedValue({
      data: { status: 'already_exchanged', balance: 2, issued_count: 1 },
      error: null,
    });

    const state = await exchangeCoinsAction({}, exchangeForm());

    expect(state.status).toBe('success');
    expect(state.message).toContain('이미 교환이 완료된 요청이에요');
  });

  it('uuid가 아닌 값은 RPC까지 가지 않는다', async () => {
    const state = await exchangeCoinsAction({}, exchangeForm({ offerId: 'not-a-uuid' }));

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(state.status).toBe('error');
  });

  it.each([
    ['insufficient_coins', '코인이 부족해요.'],
    ['offer_unavailable', '지금은 교환할 수 없는 상품이에요.'],
    ['reward_pool_not_ready', '지금은 교환할 수 없는 상품이에요.'],
    ['card_rewards_disabled', '카드팩 교환을 준비하고 있어요. 잠시 후 다시 시도해 주세요.'],
    ['exchange_operation_conflict', '카드팩 교환을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.'],
    ['account_deletion_write_fenced', '탈퇴 처리 중인 계정에서는 이용할 수 없어요.'],
  ])('%s 를 참여자 문구로 옮긴다', async (raised, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: raised } });

    await expect(exchangeCoinsAction({}, exchangeForm())).resolves.toEqual({
      status: 'error',
      message,
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  /* 사용자-facing 표면에서 '가챠·뽑기·충전' 금지(CONTEXT.md · DESIGN §12). */
  it('성공·실패 문구에 금지 어휘가 없다', async () => {
    const success = await exchangeCoinsAction({}, exchangeForm());
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'insufficient_coins' } });
    const failure = await exchangeCoinsAction({}, exchangeForm());

    for (const message of [success.message ?? '', failure.message ?? '']) {
      expect(message).not.toContain('가챠');
      expect(message).not.toContain('뽑기');
      expect(message).not.toContain('충전');
    }
  });
});
