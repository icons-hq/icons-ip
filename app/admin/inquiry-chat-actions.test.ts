import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { updateInquiryChatTagAction } from './inquiry-chat-actions';

const ACCOUNT = 'a20c0000-0000-4000-8000-000000000002';
const ID = 'a20c0000-0000-4000-8000-000000000201';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
const input = { accountId: ACCOUNT, inquiryId: ID, label: ' 배송대기 ', present: true };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: ACCOUNT }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') });
  mocks.rpc.mockResolvedValue({ data: { inquiryId: ID, tags: ['배송대기'], previous: [], previousCount: 0 }, error: null });
});
describe('상담 태그 변경', () => {
  it('정규화한 태그를 현재 운영자로 저장하고 결과를 검증한다', async () => {
    expect(await updateInquiryChatTagAction(input)).toEqual({});
    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_inquiry_chat_tag', { p_expected_actor_id: ACCOUNT, p_inquiry_id: ID, p_label: '배송대기', p_present: true });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/cs/chat');
  });
  it('로그인 계정 전환을 차단한다', async () => {
    expect((await updateInquiryChatTagAction({ ...input, accountId: ID })).error).toContain('계정'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('CS 권한 없이 태그를 변경하지 못한다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: ACCOUNT }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') });
    expect((await updateInquiryChatTagAction(input)).error).toContain('권한'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['', '가'.repeat(21), '줄\n바꿈'])('잘못된 태그는 저장 전에 거절한다: %s', async label => {
    expect((await updateInquiryChatTagAction({ ...input, label })).error).toContain('1~20자'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('태그 제한과 예상과 다른 readback을 성공으로 표시하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'inquiry_chat_tag_limit' } });
    expect((await updateInquiryChatTagAction(input)).error).toContain('최대 10개');
    mocks.rpc.mockResolvedValueOnce({ data: { inquiryId: ID, tags: [], previous: [], previousCount: 0 }, error: null });
    expect((await updateInquiryChatTagAction(input)).error).toContain('최신 상태'); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('인증 조회가 실패해도 복구 가능한 오류로 돌려준다', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('auth network unavailable'));
    expect((await updateInquiryChatTagAction(input)).error).toContain('다시 시도');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
