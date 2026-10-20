import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { listInquiryReplyTemplatesAction, mutateInquiryReplyTemplateAction, readInquiryTemplateOperationAction } from './inquiry-reply-template-actions';
const id = '10000000-0000-4000-8000-000000000001', operationId = '20000000-0000-4000-8000-000000000001';
const input = { operationId, templateId: id, revision: 0, action: 'save', values: { category: 'shipping', title: '배송 안내', body: '고객문의 전용 내용' } };
const row = { id, category: 'shipping', title: '배송 안내', body: '고객문의 전용 내용', revision: 1, archived_at: null, updated_at: '2026-10-13T00:00:00Z' };
const receipt = { operationId, templateId: id, action: 'save', template: row };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: 'staff' } }); });
describe('고객문의 템플릿 액션', () => {
  it('권한 거부와 입력 오류는 DB를 호출하지 않는다', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect(await mutateInquiryReplyTemplateAction(input)).toHaveProperty('error');
    expect(await mutateInquiryReplyTemplateAction({ ...input, revision: -1 })).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('쓰기 응답 이후 같은 operation의 확정 결과를 따로 읽는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: receipt, error: null });
    expect(await mutateInquiryReplyTemplateAction(input)).toMatchObject({ receipt: { operationId, templateId: id, template: { revision: 1 } } });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['admin_mutate_inquiry_reply_template', 'admin_get_inquiry_reply_template_operation']);
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/cs/inquiries');
  });
  it('정상 버전 충돌은 재전송 불확실성과 구분한다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'inquiry_template_changed', code: 'PT409' } });
    expect(await mutateInquiryReplyTemplateAction(input)).toMatchObject({ error: expect.stringContaining('입력을 유지'), uncertain: false });
  });
  it.each([null, { ...receipt, templateId: operationId }])('읽기 결과 누락/식별자 불일치는 불확실하다', async data => {
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data, error: null });
    expect(await mutateInquiryReplyTemplateAction(input)).toMatchObject({ uncertain: true });
  });
  it('transport 예외도 저장 여부를 단정하지 않는다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('transport lost'));
    expect(await mutateInquiryReplyTemplateAction(input)).toMatchObject({ uncertain: true });
  });
  it('미저장 operation 조회는 null을 명시한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await readInquiryTemplateOperationAction(operationId)).toEqual({ receipt: null });
  });
  it('유형·제목·복구 목록과 서버 페이지를 읽는다', async () => {
    const chain = { select: vi.fn(), not: vi.fn(), is: vi.fn(), eq: vi.fn(), ilike: vi.fn(), order: vi.fn(), range: vi.fn() };
    for (const [name, mock] of Object.entries(chain)) if (name !== 'range') mock.mockReturnValue(chain);
    chain.range.mockResolvedValue({ data: [row], error: null, count: 21 }); mocks.from.mockReturnValue(chain);
    expect(await listInquiryReplyTemplatesAction({ query: '배송_100%', category: 'shipping', archived: true, page: 2 })).toMatchObject({ data: { total: 21, page: 2 } });
    expect(mocks.from).toHaveBeenCalledWith('inquiry_reply_templates'); expect(chain.eq).toHaveBeenCalledWith('category', 'shipping');
    expect(chain.not).toHaveBeenCalledWith('archived_at', 'is', null); expect(chain.range).toHaveBeenCalledWith(20, 39);
    expect(chain.ilike).toHaveBeenCalledWith('title', '%배송\\_100\\%%');
  });
});
