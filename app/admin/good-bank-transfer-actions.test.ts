import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setGoodBankTransferAction } from './good-bank-transfer-actions';

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

function bankTransferForm(id: string | null = GOOD_ID, allowed = 'true') {
  const formData = new FormData();
  if (id !== null) formData.set('id', id);
  formData.set('allowed', allowed);
  return formData;
}

describe('setGoodBankTransferAction', () => {
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

  /* 무통장을 여는 것은 재고를 최대 24시간 묶겠다는 판단이다. 그 판단이 굿즈 폼이
     아니라 이 액션 하나로 끝나야 한다는 것이 #256의 결정이므로, 정확히 어떤
     감사 RPC가 어떤 인자로 불리는지를 못 박는다. */
  it.each([
    ['true', true, '이 굿즈로 무통장 입금 주문을 받습니다.'],
    ['false', false, '이 굿즈는 무통장 입금을 받지 않습니다. 카드 결제만 열립니다.'],
  ] as const)('allowed=%s를 감사 RPC로 그대로 넘기고 판매 표면을 갱신한다', async (
    allowedField,
    targetAllowed,
    message,
  ) => {
    await expect(setGoodBankTransferAction({}, bankTransferForm(GOOD_ID, allowedField)))
      .resolves.toEqual({ message });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_good_bank_transfer', {
      target_id: GOOD_ID,
      target_allowed: targetAllowed,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([['/admin'], ['/shop']]);
  });

  /* 'true' 이외의 값은 전부 닫는 쪽으로 읽는다. 폼이 깨졌을 때 재고가 묶이는
     방향으로 기울면 안 된다. */
  it.each(['', 'TRUE', '1', 'yes'])('allowed=%o는 무통장을 닫는 것으로 읽는다', async (allowedField) => {
    await expect(setGoodBankTransferAction({}, bankTransferForm(GOOD_ID, allowedField)))
      .resolves.toEqual({ message: '이 굿즈는 무통장 입금을 받지 않습니다. 카드 결제만 열립니다.' });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_good_bank_transfer', {
      target_id: GOOD_ID,
      target_allowed: false,
    });
  });

  it.each([
    ['미설정', { isConfigured: false, user: null, role: null, isStaff: false }],
    ['미인증', { isConfigured: true, user: null, role: null, isStaff: false }],
  ] as const)('%s 요청은 어드민 로그인 경로로 정확히 보낸다', async (_label, state) => {
    mocks.adminState = state;

    await expect(setGoodBankTransferAction({}, bankTransferForm())).rejects.toThrow(
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

    await expect(setGoodBankTransferAction({}, bankTransferForm())).resolves.toEqual({
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
    await expect(setGoodBankTransferAction({}, bankTransferForm(id))).resolves.toEqual({
      error: '굿즈를 찾을 수 없습니다.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['catalog_record_missing: private detail', '굿즈를 찾을 수 없습니다.'],
    ['private permission detail', '무통장 설정을 바꾸지 못했습니다.'],
  ])('RPC 오류 %o를 DB 원문 없이 운영자 문구로 옮긴다', async (dbMessage, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: dbMessage } });

    const result = await setGoodBankTransferAction({}, bankTransferForm());

    expect(result).toEqual({ error: message });
    expect(JSON.stringify(result)).not.toContain('private');
    /* 실패한 토글로 화면을 갱신하면 운영자가 바뀐 줄 안다. */
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
