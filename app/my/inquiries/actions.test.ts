import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInquiryAction, createWidgetInquiryAction, replyToInquiryAction } from './actions';

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
  threadCategory: 'account' as string | null,
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
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.threadCategory ? { category: mocks.threadCategory } : null, error: null }) }) }) }),
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
  mocks.threadCategory = 'account';
});

describe('createInquiryAction', () => {
  it('위젯 통신 실패는 작성 화면을 유지할 수 있는 오류 상태로 반환한다', async () => {
    mocks.rpc.mockRejectedValue(new Error('private transport details'));
    const result = await createWidgetInquiryAction({}, createForm());
    expect(result.errors?.form).toContain('접수하지 못했습니다');
    expect(result.inquiryId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private transport');
  });
  it('위젯은 같은 보호 액션으로 접수하고 페이지 이동 없이 새 문의를 연다', async () => {
    const state = await createWidgetInquiryAction({}, createForm());
    expect(state.inquiryId).toBe(INQUIRY_ID);
    expect(state.resultKey).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith('create_inquiry', expect.objectContaining({ target_title: '배송 문의' }));
    mocks.authState = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(createWidgetInquiryAction({}, createForm())).rejects.toThrow('NEXT_REDIRECT:/login');
  });
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

/* 정지 회원·온보딩 미완료 회원도 계정 문의(탈퇴 요청 등)는 쓴다(원장 CUS-035). 다른 유형은 지금처럼 막는다. */
describe('정지·온보딩 미완료 회원의 계정 문의', () => {
  function replyForm(extra?: (formData: FormData) => void) {
    const formData = new FormData();
    formData.set('inquiryId', INQUIRY_ID);
    formData.set('body', '탈퇴 처리 부탁드립니다');
    extra?.(formData);
    return formData;
  }

  it('정지 회원은 계정 문의를 접수하고 새 스레드로 간다', async () => {
    mocks.suspended = true;
    await expect(createInquiryAction({}, createForm({ category: 'account', title: '회원 탈퇴 요청' }))).rejects.toThrow(
      `NEXT_REDIRECT:/my/inquiries/${INQUIRY_ID}`,
    );
    expect(mocks.rpc).toHaveBeenCalledWith('create_inquiry', expect.objectContaining({ target_category: 'account', target_title: '회원 탈퇴 요청' }));
  });

  it('온보딩 미완료 회원은 계정 문의만 접수하고 다른 유형은 온보딩으로 보낸다', async () => {
    mocks.onboarded = false;
    const state = await createWidgetInquiryAction({}, createForm({ category: 'account' }));
    expect(state.inquiryId).toBe(INQUIRY_ID);
    await expect(createInquiryAction({}, createForm())).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fmy%2Finquiries%2Fnew',
    );
  });

  it('계정 문의라도 이미지 첨부와 주문 연결은 받지 않는다', async () => {
    mocks.suspended = true;
    const withImage = createForm({ category: 'account' });
    withImage.append('images', new File([new Uint8Array(64)], 'a.png', { type: 'image/png' }));
    expect((await createInquiryAction({}, withImage)).errors?.images).toContain('이미지를 첨부할 수 없습니다');
    expect((await createInquiryAction({}, createForm({ category: 'account', orderId: ORDER_ID }))).errors?.form).toContain('이미지·주문·굿즈를 함께 보낼 수 없습니다');
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DB가 정지 회원의 첨부·연결을 거절하면 같은 안내로 옮긴다', async () => {
    mocks.suspended = true;
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'account_suspended_inquiry_limited' } });
    expect((await createInquiryAction({}, createForm({ category: 'account' }))).errors?.form).toContain('이미지·주문·굿즈를 함께 보낼 수 없습니다');
  });

  it('정지 회원은 자기 계정 문의에만 이어 쓰고 다른 문의는 정지 화면으로 간다', async () => {
    mocks.suspended = true;
    mocks.rpc.mockResolvedValue({ data: 'msg-1', error: null });
    expect((await replyToInquiryAction({}, replyForm())).message).toContain('추가 문의를 등록했습니다');
    expect(mocks.rpc).toHaveBeenCalledWith('append_inquiry_message', expect.objectContaining({ target_inquiry_id: INQUIRY_ID }));

    mocks.rpc.mockClear();
    mocks.threadCategory = 'order';
    await expect(replyToInquiryAction({}, replyForm())).rejects.toThrow('NEXT_REDIRECT:/account-suspended');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('온보딩 미완료 회원의 이어 쓰기는 이미지 없이 계정 문의에만 받는다', async () => {
    mocks.onboarded = false;
    const state = await replyToInquiryAction({}, replyForm((formData) => {
      formData.append('images', new File([new Uint8Array(64)], 'a.png', { type: 'image/png' }));
    }));
    expect(state.errors?.images).toContain('이미지를 첨부할 수 없습니다');
    expect(mocks.upload).not.toHaveBeenCalled();
    mocks.threadCategory = null;
    await expect(replyToInquiryAction({}, replyForm())).rejects.toThrow(
      `NEXT_REDIRECT:/onboarding?next=${encodeURIComponent(`/my/inquiries/${INQUIRY_ID}`)}`,
    );
  });
});
