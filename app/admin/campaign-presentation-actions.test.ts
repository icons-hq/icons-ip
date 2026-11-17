const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAdminCampaignPresentationAction } from './campaign-presentation-actions';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.adminState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function form(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  for (const [key, value] of Object.entries({
    campaignId: 'autumn-attendance',
    popupMode: 'offline',
    popupLocation: '서울 마포구 월드컵로8길 69 1층',
    cardLinkPath: '/ip/hong-sil-quest',
    ...overrides,
  })) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  };
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.revalidatePath.mockReset();
});

describe('saveAdminCampaignPresentationAction', () => {
  it('정리한 값을 RPC 한 번으로 저장하고 성공 문구를 돌려준다', async () => {
    const state = await saveAdminCampaignPresentationAction({}, form({ popupLocation: '  서울 마포구  ', cardLinkPath: ' /shop/new ' }));

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_campaign_presentation', {
      target_campaign_id: 'autumn-attendance',
      target_popup_mode: 'offline',
      target_popup_location: '서울 마포구',
      target_card_link_path: '/shop/new',
    });
    expect(state).toEqual({ message: '노출 설정을 저장했습니다.' });
  });

  /* POP-UP 에 싣지 않으면(칸이 비활성이라 값이 제출되지 않거나 남아 있어도) 장소는 비워 보낸다. 모두 비면 DB 가 행을 지운다. */
  it('POP-UP 에 싣지 않으면 장소를 비우고, 모두 비우면 비운 값 그대로 보낸다', async () => {
    await saveAdminCampaignPresentationAction({}, form({ popupMode: '', popupLocation: '남아 있던 장소', cardLinkPath: '' }));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_campaign_presentation', {
      target_campaign_id: 'autumn-attendance',
      target_popup_mode: null,
      target_popup_location: null,
      target_card_link_path: null,
    });
  });

  it('비활성 칸처럼 장소 값이 아예 오지 않아도 저장한다', async () => {
    const data = form({ popupMode: '' });
    data.delete('popupLocation');

    const state = await saveAdminCampaignPresentationAction({}, data);

    expect(state.message).toBe('노출 설정을 저장했습니다.');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_campaign_presentation', expect.objectContaining({ target_popup_location: null }));
  });

  it.each([
    ['//evil.com', '사이트 안 주소(/로 시작)만 넣을 수 있습니다.'],
    ['https://example.com/x', '사이트 안 주소(/로 시작)만 넣을 수 있습니다.'],
    ['/a\\b', '사이트 안 주소(/로 시작)만 넣을 수 있습니다.'],
  ])('바로가기 %s 는 RPC 왕복 없이 형식 문구로 막는다', async (cardLinkPath, message) => {
    const state = await saveAdminCampaignPresentationAction({}, form({ cardLinkPath }));

    expect(state.errors?.cardLinkPath).toBe(message);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('모르는 POP-UP 방식·긴 장소·긴 주소도 칸마다 문구로 막는다', async () => {
    const mode = await saveAdminCampaignPresentationAction({}, form({ popupMode: 'tv' }));
    expect(mode.errors?.popupMode).toBeTruthy();
    const location = await saveAdminCampaignPresentationAction({}, form({ popupLocation: '가'.repeat(121) }));
    expect(location.errors?.popupLocation).toBeTruthy();
    const link = await saveAdminCampaignPresentationAction({}, form({ cardLinkPath: `/${'a'.repeat(300)}` }));
    expect(link.errors?.cardLinkPath).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('캠페인 id 가 없으면 먼저 캠페인을 저장하라고 안내한다', async () => {
    const state = await saveAdminCampaignPresentationAction({}, form({ campaignId: '  ' }));

    expect(state.errors?.form).toBe('먼저 캠페인을 저장해주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('비스태프는 RPC 에 닿지 않는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    const state = await saveAdminCampaignPresentationAction({}, form());

    expect(state.errors?.form).toBe('이 작업을 할 권한이 없습니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  /* 스태프여도 promotion.manage 가 없는 매니저(물류)는 이 화면의 쓰기 권한이 없다. RPC 에도 같은 판정이 한 번 더 있다. */
  it('promotion.manage 가 없는 매니저는 RPC 에 닿지 않는다', async () => {
    mocks.adminState = { ...mocks.adminState, operatorAccess: configuredOperatorAccessFixture('logistics') };

    const state = await saveAdminCampaignPresentationAction({}, form());

    expect(state.errors?.form).toBe('이 작업을 할 권한이 없습니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('프로모션 담당 매니저는 저장한다', async () => {
    mocks.adminState = { ...mocks.adminState, operatorAccess: configuredOperatorAccessFixture('deputy') };

    const state = await saveAdminCampaignPresentationAction({}, form());

    expect(state.message).toBe('노출 설정을 저장했습니다.');
  });

  it('로그인이 없으면 로그인으로 보낸다', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(saveAdminCampaignPresentationAction({}, form())).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fdisplay%2Fcampaigns');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  describe('RPC 오류를 운영자 문구로 옮긴다', () => {
    it.each([
      [{ code: '42501', message: 'forbidden' }, 'form', '이 작업을 할 권한이 없습니다.'],
      [{ code: '28000', message: 'auth_required' }, 'form', '이 작업을 할 권한이 없습니다.'],
      [{ code: 'P0002', message: 'campaign_not_found' }, 'form', '먼저 캠페인을 저장해주세요.'],
      [{ code: '22023', message: 'invalid_campaign_presentation' }, 'cardLinkPath', '사이트 안 주소(/로 시작)만 넣을 수 있습니다.'],
      [{ code: 'XX000', message: 'boom' }, 'form', '노출 설정을 저장하지 못했습니다. 다시 시도해주세요.'],
      [{ message: 'forbidden' }, 'form', '이 작업을 할 권한이 없습니다.'],
      [{ message: 'campaign_not_found' }, 'form', '먼저 캠페인을 저장해주세요.'],
    ])('%j → %s 칸 %s', async (error, field, message) => {
      mocks.rpc.mockResolvedValue({ data: null, error });

      const state = await saveAdminCampaignPresentationAction({}, form());

      expect(state.errors?.[field as 'form' | 'cardLinkPath']).toBe(message);
      expect(state.message).toBeUndefined();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  /* 노출 설정은 EVENT·POP-UP 목록, 두 상세, 홈에 보인다. 상세는 방금 고친 캠페인 경로를 지정해 만료시키고, 어드민 목록은 패널의 새 기본값을 위해 다시 읽는다. */
  it('저장하면 공개 표면과 어드민 캠페인 화면을 다시 그린다', async () => {
    await saveAdminCampaignPresentationAction({}, form());

    expect(mocks.revalidatePath.mock.calls.map(([path]) => path).sort()).toEqual([
      '/',
      '/admin/display/campaigns',
      '/events',
      '/events/autumn-attendance',
      '/popups',
      '/popups/autumn-attendance',
    ]);
  });
});
