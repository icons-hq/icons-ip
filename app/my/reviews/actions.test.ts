import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReviewAction, updateReviewAction } from './actions';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  authState: {} as Record<string, unknown>,
  onboarded: true,
  suspended: false,
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.authState }));
/* 프로필 판정 두 개만 갈아끼운다 — 경로 헬퍼(safeNextPath·onboardingPath)까지 흉내내면
   공유 게이트(lib/participation-gate.server.ts)가 실제로 만드는 리다이렉트를 검증하지
   못한다. */
vi.mock('@/lib/auth/onboarding', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/onboarding')>(),
  isAccountSuspended: () => mocks.suspended,
  isOnboarded: () => mocks.onboarded,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function imageFile(name: string) {
  const file = new File(['x'], name, { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: 2048 });
  return file;
}

function createForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('orderId', ORDER_ID);
  formData.set('goodId', 'g13');
  formData.set('rating', '5');
  formData.set('body', '마감이 깔끔하고 배송도 빨랐습니다');
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
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockReset();
  mocks.remove.mockResolvedValue({ error: null });
  mocks.revalidatePath.mockReset();
});

describe('createReviewAction', () => {
  it('자격 판정을 RPC에 맡기고 값만 넘긴다', async () => {
    await expect(createReviewAction({}, createForm())).rejects.toThrow('NEXT_REDIRECT:/my/reviews');

    expect(mocks.rpc).toHaveBeenCalledWith('create_good_review', {
      target_body: '마감이 깔끔하고 배송도 빨랐습니다',
      target_good_id: 'g13',
      target_image_paths: [],
      target_order_id: ORDER_ID,
      target_rating: 5,
    });
  });

  it('로그인하지 않았으면 내 리뷰 경로를 next로 실어 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(createReviewAction({}, createForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fmy%2Freviews',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('정지 계정은 정지 안내로 보낸다', async () => {
    mocks.suspended = true;

    await expect(createReviewAction({}, createForm())).rejects.toThrow(
      'NEXT_REDIRECT:/account-suspended',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 배송 전 주문은 DB가 막는다. 그 오류를 일반 실패로 접으면 사용자는 무엇을
     기다려야 하는지 알 수 없다. */
  it('배송 전 주문 오류를 그대로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'review_order_not_delivered' } });

    const state = await createReviewAction({}, createForm());
    expect(state.errors?.form).toContain('배송이 완료된 주문');
  });

  it('중복 작성 오류는 기존 리뷰 수정을 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'review_already_exists' } });

    const state = await createReviewAction({}, createForm());
    expect(state.errors?.form).toContain('기존 리뷰를 수정');
  });

  /* 저장이 실패했으면 방금 올린 사진은 어디에도 붙지 않는다. 남겨 두면 사용자
     폴더에 아무 리뷰와도 연결되지 않은 파일만 쌓인다. */
  it('저장 실패 시 방금 올린 사진을 되돌린다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'review_window_closed' } });
    const formData = createForm();
    formData.append('images', imageFile('a.jpg'));

    await createReviewAction({}, formData);

    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove.mock.calls[0][0]).toHaveLength(1);
  });

  it('업로드가 실패하면 RPC를 부르지 않는다', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'storage down' } });
    const formData = createForm();
    formData.append('images', imageFile('a.jpg'));

    const state = await createReviewAction({}, formData);

    expect(state.errors?.images).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('updateReviewAction', () => {
  function updateForm() {
    const formData = new FormData();
    formData.set('reviewId', REVIEW_ID);
    formData.set('rating', '3');
    formData.set('body', '색이 사진과 조금 다릅니다');
    return formData;
  }

  /* 유지한 사진과 새로 올린 사진을 합쳐 한 번에 넘긴다 — 새 사진만 보내면
     기존 사진이 통째로 사라진다. */
  it('유지한 사진과 새 사진을 합쳐 넘긴다', async () => {
    const kept = `${USER_ID}/review/44444444-4444-4444-8444-444444444444.jpg`;
    const formData = updateForm();
    formData.append('keepImagePaths', kept);
    formData.append('images', imageFile('new.jpg'));

    await updateReviewAction({}, formData);

    const [, args] = mocks.rpc.mock.calls[0];
    expect(args.target_image_paths[0]).toBe(kept);
    expect(args.target_image_paths).toHaveLength(2);
    expect(args.target_review_id).toBe(REVIEW_ID);
  });

  /* 체크를 푼 기존 사진은 리뷰에서 빠질 뿐 아니라 스토리지에서도 사라져야 한다. */
  it('유지하지 않은 기존 사진을 정리한다', async () => {
    const dropped = `${USER_ID}/review/55555555-5555-4555-8555-555555555555.jpg`;
    const formData = updateForm();
    formData.append('originalImagePaths', dropped);

    await updateReviewAction({}, formData);

    expect(mocks.remove).toHaveBeenCalledWith([dropped]);
  });

  it('블라인드된 리뷰 수정 거절을 그대로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'review_hidden' } });

    const state = await updateReviewAction({}, updateForm());
    expect(state.errors?.form).toContain('비공개 처리된 리뷰는 수정할 수 없습니다');
  });
});
