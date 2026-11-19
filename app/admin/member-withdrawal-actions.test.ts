const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewMemberWithdrawalInquiryAction, processKakaoUnlinkWithdrawalAction, processMemberWithdrawalAction, retryMemberWithdrawalSigninBlockAction } from './member-withdrawal-actions';

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
  data.set('confirmedInquiryReference', '1234');
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

  it('확인창에서 대조한 문의 번호와 제출한 번호가 다르면 RPC를 부르지 않는다', async () => {
    const state = await processMemberWithdrawalAction({}, form({ confirmedInquiryReference: '1233' }));
    expect(state.errors?.inquiryReference).toContain('대조한 문의 번호와 입력한 번호가 다릅니다');
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

  it('처리 전 대조는 그 회원의 문의 요약만 돌려주고 권한·입력·소유를 먼저 확인한다', async () => {
    rpcResults({ admin_member_withdrawal_inquiry: { data: { reference: 1234, category: 'account', title: '회원 탈퇴 요청', status: 'open', createdAt: PROCESSED_AT }, error: null } });
    await expect(previewMemberWithdrawalInquiryAction(MEMBER, '#1234')).resolves.toEqual({
      ok: true, inquiry: { reference: 1234, category: 'account', title: '회원 탈퇴 요청', createdAt: PROCESSED_AT },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_member_withdrawal_inquiry', { target_profile_id: MEMBER, target_inquiry_reference: 1234 });

    rpcResults({ admin_member_withdrawal_inquiry: { data: null, error: null } });
    expect(await previewMemberWithdrawalInquiryAction(MEMBER, '99')).toMatchObject({ ok: false, error: expect.stringContaining('1:1 문의 번호가 아닙니다') });

    mocks.rpc.mockClear();
    expect(await previewMemberWithdrawalInquiryAction(MEMBER, '문의')).toMatchObject({ ok: false });
    expect(await previewMemberWithdrawalInquiryAction('nope', '12')).toMatchObject({ ok: false });
    mocks.auth = { isConfigured: true, user: { id: 'staff-1', email: null }, role: 'staff', isStaff: true,
      operatorAccess: configuredOperatorAccessFixture('deputy') };
    expect(await previewMemberWithdrawalInquiryAction(MEMBER, '12')).toEqual({ ok: false, error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('카카오 알림으로 탈퇴 처리 액션', () => {
  const UNLINK = { reason: 'ACCOUNT_DELETE', eventAt: '2026-11-19T01:00:00+00:00', accountClosed: true };
  const KAKAO_STATUS = { ...STATUS, inquiryReference: null, basis: 'kakao_unlink', kakaoUnlink: UNLINK };
  const kakaoForm = (note = '  카카오계정 탈퇴 알림 확인  ') => { const data = new FormData(); data.set('profileId', MEMBER); data.set('note', note); return data; };

  beforeEach(() => {
    mocks.auth = { isConfigured: true, user: { id: 'staff-1', email: 'staff@icons.gg' }, role: 'admin', isStaff: true,
      operatorAccess: legacyOperatorAccessFixture() };
    mocks.rpc.mockReset();
    mocks.ban.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.ban.mockResolvedValue(true);
  });

  it('권한·메모를 먼저 확인하고 RPC를 부르지 않는다', async () => {
    expect((await processKakaoUnlinkWithdrawalAction({}, kakaoForm('가'))).errors?.note).toContain('2자 이상');
    mocks.auth = { isConfigured: true, user: { id: 'staff-1', email: null }, role: 'staff', isStaff: true,
      operatorAccess: configuredOperatorAccessFixture('deputy') };
    await expect(processKakaoUnlinkWithdrawalAction({}, kakaoForm())).resolves.toEqual({ errors: { form: '관리자 권한이 필요합니다.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('처리한 뒤 재로그인을 막고 근거·카카오 연결 삭제를 결과에 보이며 대기 목록도 다시 그린다', async () => {
    rpcResults({
      admin_process_kakao_unlink_withdrawal: { data: { ...KAKAO_STATUS, status: 'processed', suspended: true,
        erased: { ...ERASED, kakaoIdentities: 1 }, revokedSessions: 1 }, error: null },
      admin_confirm_member_withdrawal_signin_block: { data: {}, error: null },
    });
    const state = await processKakaoUnlinkWithdrawalAction({}, kakaoForm());
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_process_kakao_unlink_withdrawal', { target_profile_id: MEMBER, target_note: '카카오계정 탈퇴 알림 확인' });
    expect(mocks.ban).toHaveBeenCalledWith(MEMBER);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_confirm_member_withdrawal_signin_block', { target_profile_id: MEMBER });
    expect(state).toEqual({ message: '탈퇴 요청(카카오 알림 · 카카오계정 탈퇴)을 처리했습니다 — 배송지 2건 · 휴대폰 번호 1건 · 마케팅 수신 동의 철회 1건 · 카카오 로그인 연결 1건 · 로그인 세션 1개 종료.' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/community/members/kakao-unlinks');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/customers/${MEMBER}`);
  });

  it('남은 의무·연결만 끊은 회원·대기 목록에 없는 회원은 처리하지 않고 이유를 알린다', async () => {
    rpcResults({ admin_process_kakao_unlink_withdrawal: { data: { status: 'blocked', blockers: [{ code: 'active_order', count: 1, path: '/orders' }] }, error: null } });
    expect(await processKakaoUnlinkWithdrawalAction({}, kakaoForm())).toMatchObject({ blockers: [{ code: 'active_order', count: 1, path: '/orders' }] });
    rpcResults({ admin_process_kakao_unlink_withdrawal: { data: null, error: { message: 'kakao_unlink_member_request_required' } } });
    expect((await processKakaoUnlinkWithdrawalAction({}, kakaoForm())).errors?.form).toContain('회원이 쓴 1:1 문의 번호로 처리');
    rpcResults({ admin_process_kakao_unlink_withdrawal: { data: null, error: { message: 'kakao_unlink_withdrawal_not_queued' } } });
    expect((await processKakaoUnlinkWithdrawalAction({}, kakaoForm())).errors?.form).toContain('탈퇴 검토 대기 회원이 아닙니다');
    rpcResults({ admin_process_kakao_unlink_withdrawal: { data: null, error: { message: 'invalid_member_withdrawal' } } });
    expect((await processKakaoUnlinkWithdrawalAction({}, kakaoForm())).errors?.form).toBe('처리 메모를 다시 확인해주세요.');
    expect(mocks.ban).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('이미 처리한 회원은 처음 근거로 알린다(문의 경로로 다시 눌러도 같다)', async () => {
    const replay = { ...KAKAO_STATUS, signinBlocked: true, signinBlockedAt: PROCESSED_AT, status: 'already_processed', revokedSessions: 0 };
    rpcResults({ admin_process_kakao_unlink_withdrawal: { data: replay, error: null }, admin_process_member_withdrawal: { data: replay, error: null } });
    await expect(processKakaoUnlinkWithdrawalAction({}, kakaoForm())).resolves.toEqual({ message: '이미 탈퇴 처리한 회원입니다(카카오 알림 · 카카오계정 탈퇴).' });
    await expect(processMemberWithdrawalAction({}, form())).resolves.toEqual({ message: '이미 탈퇴 처리한 회원입니다(카카오 알림 · 카카오계정 탈퇴).' });
    expect(mocks.ban).not.toHaveBeenCalled();
  });
});
