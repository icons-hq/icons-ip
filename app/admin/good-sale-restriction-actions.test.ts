import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setGoodSaleRestrictionAction } from './good-sale-restriction-actions';

const GOOD_ID = 'hongsil-acrylic-stand';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  createClient: vi.fn(),
  getCurrentAdminAuthState: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: mocks.getCurrentAdminAuthState,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function saleRestrictionForm(id: string | null = GOOD_ID, restriction: string | null = 'adult') {
  const formData = new FormData();
  if (id !== null) formData.set('id', id);
  if (restriction !== null) formData.set('restriction', restriction);
  return formData;
}

describe('setGoodSaleRestrictionAction', () => {
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.test' },
      role: 'staff',
      isStaff: true,
    };
    mocks.getCurrentAdminAuthState.mockReset();
    mocks.getCurrentAdminAuthState.mockImplementation(async () => mocks.adminState);
    mocks.createClient.mockReset();
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.revalidatePath.mockReset();
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  /* 성인 전환은 스토어 노출과 결제 PG 분기를 동시에 바꾼다. 그 판단이 굿즈 폼이
     아니라 이 액션 하나로 끝나야 하므로, 어떤 감사 RPC가 어떤 인자로 불리는지와
     판매 표면 갱신 순서를 못 박는다. */
  it.each([
    ['none', '이 굿즈는 판매 제한 없이 스토어에 노출됩니다.'],
    ['adult', '이 굿즈는 성인(19금) 상품입니다. 성인인증 도입 전까지 스토어에서 숨기고 구매를 막습니다.'],
  ] as const)('restriction=%s를 감사 RPC로 그대로 넘기고 판매 표면을 갱신한다', async (
    restriction,
    message,
  ) => {
    await expect(setGoodSaleRestrictionAction({}, saleRestrictionForm(GOOD_ID, restriction)))
      .resolves.toEqual({ message });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_good_sale_restriction', {
      target_id: GOOD_ID,
      target_restriction: restriction,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([['/admin'], ['/shop']]);
  });

  /* enum 이라 이상값을 닫는 쪽으로 읽지 않는다. 운영자가 고른 줄 아는 값과 저장된
     값이 다르면 성인 상품에서는 그대로 노출 사고다 — DB 에러가 되기 전에 거부한다. */
  it.each([
    ['빈 문자열', ''],
    ['대문자', 'ADULT'],
    ['미도입 값', 'random_box'],
    ['공백 섞임', ' adult'],
    ['필드 없음', null],
  ] as const)('판매 제한 값이 %s이면 RPC에 닿기 전에 거부한다', async (_label, restriction) => {
    await expect(setGoodSaleRestrictionAction({}, saleRestrictionForm(GOOD_ID, restriction)))
      .resolves.toEqual({ error: '지원하지 않는 판매 제한 유형입니다.' });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['미설정', { isConfigured: false, user: null, role: null, isStaff: false }],
    ['미인증', { isConfigured: true, user: null, role: null, isStaff: false }],
  ] as const)('%s 요청은 어드민 로그인 경로로 정확히 보낸다', async (_label, state) => {
    mocks.adminState = state;

    await expect(setGoodSaleRestrictionAction({}, saleRestrictionForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('로그인한 비스태프는 RPC에 닿기 전에 막는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.test' },
      role: 'user',
      isStaff: false,
    };

    await expect(setGoodSaleRestrictionAction({}, saleRestrictionForm())).resolves.toEqual({
      error: '관리자 권한이 필요합니다.',
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['빈 문자열', ''],
    ['공백만', '   '],
    ['필드 없음', null],
  ] as const)('굿즈 id가 %s이면 RPC에 닿기 전에 막는다', async (_label, id) => {
    await expect(setGoodSaleRestrictionAction({}, saleRestrictionForm(id))).resolves.toEqual({
      error: '굿즈를 찾을 수 없습니다.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['catalog_record_missing: private detail', '굿즈를 찾을 수 없습니다.'],
    ['private permission detail', '판매 제한 설정을 바꾸지 못했습니다.'],
  ])('RPC 오류 %o를 DB 원문 없이 운영자 문구로 옮긴다', async (dbMessage, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: dbMessage } });

    const result = await setGoodSaleRestrictionAction({}, saleRestrictionForm());

    expect(result).toEqual({ error: message });
    expect(JSON.stringify(result)).not.toContain('private');
    /* 실패한 전환으로 화면을 갱신하면 운영자가 바뀐 줄 안다. */
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
