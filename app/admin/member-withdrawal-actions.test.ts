const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processMemberWithdrawalAction, retryMemberWithdrawalSigninBlockAction } from './member-withdrawal-actions';

const MEMBER = '00000000-0000-4000-8000-000000000301';
const PROCESSED_AT = '2026-11-18T10:00:00+00:00';
const STATUS = { processed: true, processedAt: PROCESSED_AT, inquiryReference: 1234, signinBlocked: false, signinBlockedAt: null };
const ERASED = { addressBookEntries: 2, phoneNumbers: 1, marketingConsents: 1, demographicConsents: 0, activityEvents: 0,
  activityConsents: 0, emailChangeRequests: 0, restockAlerts: 0 };

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  rpc: vi.fn(),
  ban: vi.fn(),
  status: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/member-withdrawal.server', () => ({ banWithdrawnMemberSignin: mocks.ban, getMemberWithdrawalStatus: mocks.status }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

function form(entries: Record<string, string> = {}) {
  const data = new FormData();
  data.set('profileId', MEMBER);
  data.set('inquiryReference', '#1234');
  data.set('note', '  1:1 문의 탈퇴 요청 확인  ');
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function rpcResults(results: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  mocks.rpc.mockImplementation(async (name: string) => results[name] ?? { data: null, error: { message: `unexpected ${name}` } });
}

describe('탈퇴 요청 처리 액션', () => {
  beforeEach(() => {
    mocks.auth = { isConfigured: true, user: { id: 'staff-1', email: 'staff@icons.gg' }, role: 'admin', isStaff: true,
      operatorAccess: legacyOperatorAccessFixture() };
    mocks.rpc.mockReset();
    mocks.ban.mockReset();
    mocks.status.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.ban.mockResolvedValue(true);
  });

  it('platform.manage가 없으면 아무것도 부르지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: { id: 'staff-1', email: null }, role: 'staff', isStaff: true,
      operatorAccess: configuredOperatorAccessFixture('deputy') };
    await expect(processMemberWithdrawalAction({}, form())).resolves.toEqual({ errors: { form: '관리자 권한이 필요합니다.' } });
    await expect(retryMemberWithdrawalSigninBlockAction({}, form())).resolves.toEqual({ errors: { form: '관리자 권한이 필요합니다.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ban).not.toHaveBeenCalled();
  });

  it('입력이 틀리면 RPC 전에 필드 오류를 돌려준다', async () => {
    const state = await processMemberWithdrawalAction({}, form({ inquiryReference: '문의', note: '가' }));
    expect(state.errors).toMatchObject({ inquiryReference: expect.any(String), note: expect.any(String) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('남은 의무가 있으면 목록을 돌려주고 재로그인 차단을 걸지 않는다', async () => {
    rpcResults({ admin_process_member_withdrawal: { data: { status: 'blocked', blockers: [{ code: 'active_order', count: 2, path: '/orders' }] }, error: null } });
    const state = await processMemberWithdrawalAction({}, form());
    expect(state.blockers).toEqual([{ code: 'active_order', count: 2, path: '/orders' }]);
    expect(state.errors?.form).toContain('처리하지 않았습니다');
    expect(mocks.ban).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('처리한 뒤에만 재로그인을 막고 DB 확인까지 마친다', async () => {
    rpcResults({
      admin_process_member_withdrawal: { data: { ...STATUS, status: 'processed', suspended: true, erased: ERASED, revokedSessions: 2 }, error: null },
      admin_confirm_member_withdrawal_signin_block: { data: { ...STATUS, signinBlocked: true, signinBlockedAt: PROCESSED_AT, replayed: false, revokedSessions: 0 }, error: null },
    });
    const state = await processMemberWithdrawalAction({}, form());
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_process_member_withdrawal', {
      target_profile_id: MEMBER, target_inquiry_reference: 1234, target_note: '1:1 문의 탈퇴 요청 확인',
    });
    expect(mocks.ban).toHaveBeenCalledWith(MEMBER);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_confirm_member_withdrawal_signin_block', { target_profile_id: MEMBER });
    expect(state).toEqual({ message: '탈퇴 요청(문의 #1234)을 처리했습니다 — 배송지 2건 · 휴대폰 번호 1건 · 마케팅 수신 동의 철회 1건 · 로그인 세션 2개 종료.' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/customers/${MEMBER}`);
  });

  it('재로그인 차단이 실패하면 처리 결과와 함께 다시 적용하라고 알린다', async () => {
    mocks.ban.mockResolvedValue(false);
    rpcResults({ admin_process_member_withdrawal: { data: { ...STATUS, status: 'processed', suspended: true, erased: ERASED, revokedSessions: 0 }, error: null } });
    const state = await processMemberWithdrawalAction({}, form());
    expect(state.message).toContain('처리했습니다');
    expect(state.errors?.form).toContain('재로그인 차단을 적용하지 못했습니다');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/customers/${MEMBER}`);
  });

  it('이미 처리했고 차단까지 끝난 회원은 다시 차단하지 않는다', async () => {
    rpcResults({ admin_process_member_withdrawal: { data: { ...STATUS, signinBlocked: true, signinBlockedAt: PROCESSED_AT, status: 'already_processed', revokedSessions: 0 }, error: null } });
    await expect(processMemberWithdrawalAction({}, form())).resolves.toEqual({ message: '이미 탈퇴 처리한 회원입니다(문의 #1234).' });
    expect(mocks.ban).not.toHaveBeenCalled();
  });

  it('RPC 거절은 운영자 문구로, 모르는 응답은 새로고침 안내로 접는다', async () => {
    rpcResults({ admin_process_member_withdrawal: { data: null, error: { message: 'member_withdrawal_inquiry_not_found' } } });
    expect((await processMemberWithdrawalAction({}, form())).errors?.form).toContain('1:1 문의 번호가 아닙니다');
    rpcResults({ admin_process_member_withdrawal: { data: { status: 'processed' }, error: null } });
    expect((await processMemberWithdrawalAction({}, form())).errors?.form).toContain('새로고침');
    expect(mocks.ban).not.toHaveBeenCalled();
  });

  it('다시 적용은 처리 기록이 있고 차단이 빠진 회원에게만 건다', async () => {
    mocks.status.mockResolvedValue({ processed: false, processedAt: null, inquiryReference: null, signinBlocked: false, signinBlockedAt: null });
    expect((await retryMemberWithdrawalSigninBlockAction({}, form())).errors?.form).toBe('탈퇴 요청을 처리한 회원이 아닙니다.');
    expect(mocks.ban).not.toHaveBeenCalled();

    mocks.status.mockResolvedValue(STATUS);
    rpcResults({ admin_confirm_member_withdrawal_signin_block: { data: {}, error: null } });
    await expect(retryMemberWithdrawalSigninBlockAction({}, form())).resolves.toEqual({ message: '재로그인 차단을 적용했습니다.' });
    expect(mocks.ban).toHaveBeenCalledWith(MEMBER);

    rpcResults({ admin_confirm_member_withdrawal_signin_block: { data: null, error: { message: 'member_withdrawal_signin_not_blocked' } } });
    expect((await retryMemberWithdrawalSigninBlockAction({}, form())).errors?.form).toContain('적용하지 못했습니다');
  });
});
