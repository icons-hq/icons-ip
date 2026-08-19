import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInquiryAction, replyToInquiryAction } from './actions';

const INQUIRY_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '33333333-3333-4333-8333-333333333333', email: 'fan@icons.gg' },
    profile: { onboarded_at: '2026-01-01T00:00:00.000Z', suspended_at: null },
    isStaff: false,
  } as Record<string, unknown>,
  onboarded: true,
  suspended: false,
  rpc: vi.fn(),
  upload: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.authState }));
vi.mock('@/lib/auth/onboarding', () => ({
  ACCOUNT_SUSPENDED_PATH: '/account-suspended',
  isAccountSuspended: () => mocks.suspended,
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload }) },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function createForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('category', 'order');
  formData.set('title', '배송 문의');
  formData.set('body', '언제 발송되나요?');
  for (const [key, value] of Object.entries(overrides)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  mocks.authState = {
    isConfigured: true,
    user: { id: USER_ID, email: 'fan@icons.gg' },
    profile: {},
    isStaff: false,
  };
  mocks.onboarded = true;
  mocks.suspended = false;
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: INQUIRY_ID, error: null });
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.revalidatePath.mockReset();
});

describe('createInquiryAction', () => {
  /* 문의는 개인 기록이라 공개 브라우징 대상이 아니다. */
  it('로그인 전에는 작성 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(createInquiryAction({}, createForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fmy%2Finquiries%2Fnew',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('정지된 계정은 접수 화면으로 들어가지 못한다', async () => {
    mocks.suspended = true;

    await expect(createInquiryAction({}, createForm())).rejects.toThrow(
      'NEXT_REDIRECT:/account-suspended',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('접수에 성공하면 새 스레드로 보낸다', async () => {
    await expect(createInquiryAction({}, createForm({ orderId: ORDER_ID }))).rejects.toThrow(
      `NEXT_REDIRECT:/my/inquiries/${INQUIRY_ID}`,
    );

    expect(mocks.rpc).toHaveBeenCalledWith('create_inquiry', {
      target_body: '언제 발송되나요?',
      target_category: 'order',
      target_good_id: null,
      target_image_paths: [],
      target_order_id: ORDER_ID,
      target_title: '배송 문의',
    });
  });

  /* 남의 주문번호를 실은 문의가 어드민 컨텍스트 패널을 열면 타인 주문을 들여다보는 창이 된다.
     그 판단은 DB가 하고, 앱은 이유를 사용자에게 옮긴다. */
  it('본인 주문이 아니면 연결을 풀라고 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'inquiry_order_not_found' } });

    const state = await createInquiryAction({}, createForm({ orderId: ORDER_ID }));

    expect(state.errors?.form).toContain('연결할 주문을 찾을 수 없습니다');
  });

  it('하루 접수 상한을 넘기면 기존 문의로 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'inquiry_rate_limited' } });

    const state = await createInquiryAction({}, createForm());

    expect(state.errors?.form).toContain('기존 문의에 이어서');
  });

  /* 일부만 올라간 채 본문이 저장되면 사용자는 증거 사진이 빠진 사실을 알 수 없다. */
  it('첨부 업로드가 실패하면 본문도 저장하지 않는다', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'nope' } });

    const formData = createForm();
    formData.append('images', new File([new Uint8Array(64)], 'a.png', { type: 'image/png' }));
    const state = await createInquiryAction({}, formData);

    expect(state.errors?.images).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('replyToInquiryAction', () => {
  it('추가 메시지를 append RPC로만 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'msg-1', error: null });

    const formData = new FormData();
    formData.set('inquiryId', INQUIRY_ID);
    formData.set('body', '아직도 배송이 안 왔어요');
    const state = await replyToInquiryAction({}, formData);

    expect(mocks.rpc).toHaveBeenCalledWith('append_inquiry_message', {
      target_body: '아직도 배송이 안 왔어요',
      target_image_paths: [],
      target_inquiry_id: INQUIRY_ID,
    });
    expect(state.message).toContain('추가 문의를 등록했습니다');
  });

  /* 종결 후 재문의는 새 스레드다. 닫힌 대화를 되살리지 않는다. */
  it('종결된 문의에는 새 문의로 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'inquiry_closed' } });

    const formData = new FormData();
    formData.set('inquiryId', INQUIRY_ID);
    formData.set('body', '추가 질문');
    const state = await replyToInquiryAction({}, formData);

    expect(state.errors?.form).toContain('새 문의로 접수해주세요');
  });
});
