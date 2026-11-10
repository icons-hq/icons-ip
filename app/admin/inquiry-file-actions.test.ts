import { beforeEach, describe, expect, it, vi } from 'vitest';

const INQUIRY_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rpc: vi.fn(),
  sendInquiryEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/inquiry-files.server', () => ({
  cleanupInquiryFiles: vi.fn(), inquiryFileSession: vi.fn(), prepareInquiryFile: vi.fn(), verifyInquiryFile: vi.fn(),
}));
vi.mock('@/lib/email/transactional.server', () => ({ sendInquiryAnsweredEmail: mocks.sendInquiryEmail }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

import { sendInquiryChatMessageAction } from './inquiry-file-actions';

function chatForm(body: string) {
  const form = new FormData();
  form.set('inquiryId', INQUIRY_ID);
  form.set('operationId', OPERATION_ID);
  form.set('category', 'order');
  form.set('fileIds', '[]');
  form.set('body', body);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: 'staff-1' } });
  mocks.rpc.mockResolvedValue({
    data: { messageId: MESSAGE_ID, operationId: OPERATION_ID, recipientEmail: 'buyer@example.com', reference: 12, title: '배송 문의' },
    error: null,
  });
  mocks.sendInquiryEmail.mockResolvedValue({ status: 'sent' });
});

/* 상담하기 입력창(textarea maxLength 2,000)은 줄바꿈을 1자로 세지만 폼 본문은 CRLF(2자)로 도착한다.
   서버가 LF로 맞춘 뒤 세고 저장하지 않으면, 줄이 많은 2,000자 메시지가 서버에서만 거절된다(m27 G4-1). */
describe('sendInquiryChatMessageAction 줄바꿈', () => {
  it('줄이 많은 2,000자 이내 메시지는 CRLF로 와도 거절하지 않고 LF로 저장·발송한다', async () => {
    const lines = Array.from({ length: 200 }, () => '상담 안내 문장임');
    const lf = lines.join('\n');
    expect(lf.length).toBeLessThanOrEqual(2000);
    expect(lines.join('\r\n').length).toBeGreaterThan(2000);

    const state = await sendInquiryChatMessageAction({}, chatForm(`${lines.join('\r\n')}\r\n`));

    expect(state.errors).toBeUndefined();
    expect(state.resultKey).toBe(OPERATION_ID);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_send_inquiry_chat_message', {
      p_inquiry: INQUIRY_ID, p_body: lf, p_files: [], p_operation: OPERATION_ID,
    });
    expect(mocks.sendInquiryEmail).toHaveBeenCalledWith(expect.objectContaining({ answerBody: lf }));
  });

  it('외따로 온 CR도 LF로 바꾸고, LF 기준 2,000자를 넘으면 그대로 거절한다', async () => {
    await sendInquiryChatMessageAction({}, chatForm('첫 줄\r둘째 줄'));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_send_inquiry_chat_message', expect.objectContaining({ p_body: '첫 줄\n둘째 줄' }));

    mocks.rpc.mockClear();
    const state = await sendInquiryChatMessageAction({}, chatForm(`${'가'.repeat(1000)}\r\n${'나'.repeat(1000)}`));
    expect(state.errors?.body).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
