import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerInquiryAction,
  closeInquiryAction,
  saveInquiryReplyTemplateAction,
} from './inquiry-actions';

const INQUIRY_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  rpc: vi.fn(),
  upload: vi.fn(),
  revalidatePath: vi.fn(),
  sendInquiryEmail: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.adminState }));
vi.mock('@/lib/email/transactional.server', () => ({
  sendInquiryAnsweredEmail: mocks.sendInquiryEmail,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload }) },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function answerForm(body = '오늘 발송 예정입니다.') {
  const formData = new FormData();
  formData.set('inquiryId', INQUIRY_ID);
  formData.set('category', 'order');
  formData.set('body', body);
  return formData;
}

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  };
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({
    data: [{
      message_id: MESSAGE_ID,
      recipient_id: 'buyer-1',
      recipient_email: 'buyer@example.com',
      inquiry_reference: 12,
      inquiry_title: '배송이 아직 안 왔어요',
    }],
    error: null,
  });
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.revalidatePath.mockReset();
  mocks.sendInquiryEmail.mockReset();
  mocks.sendInquiryEmail.mockResolvedValue({ status: 'sent' });
});

describe('answerInquiryAction', () => {
  it('staff가 아니면 답변을 등록하지 않는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'u1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    const state = await answerInquiryAction({}, answerForm());

    expect(state.errors?.form).toBe('관리자 권한이 필요합니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('빈 본문은 RPC를 부르기 전에 막는다', async () => {
    const state = await answerInquiryAction({}, answerForm('   '));

    expect(state.errors?.body).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 메일은 RPC가 돌려준 답변 메시지 id로 dedupe한다 — 문의 id면 두 번째 답변이 막힌다. */
  it('답변 등록 후 그 메시지 id로 메일을 보낸다', async () => {
    const state = await answerInquiryAction({}, answerForm());

    expect(mocks.rpc).toHaveBeenCalledWith('admin_answer_inquiry', {
      target_body: '오늘 발송 예정입니다.',
      target_image_paths: [],
      target_inquiry_id: INQUIRY_ID,
    });
    expect(mocks.sendInquiryEmail).toHaveBeenCalledWith(expect.objectContaining({
      categoryLabel: '주문/배송',
      inquiryId: INQUIRY_ID,
      messageId: MESSAGE_ID,
      recipient: 'buyer@example.com',
      reference: 12,
    }));
    expect(state.message).toContain('발송');
    /* 발송마다 새 키가 나와야 작성창이 비워진다 — 문구만 보면 두 번째 발송에서 안 비워진다. */
    expect(state.resultKey).toBeTruthy();
  });

  it('발송마다 다른 결과 키를 돌려준다', async () => {
    const first = await answerInquiryAction({}, answerForm());
    const second = await answerInquiryAction({}, answerForm());

    expect(first.resultKey).not.toBe(second.resultKey);
  });

  /* "실패했습니다"로 뭉치면 운영자가 답변을 다시 등록해 같은 답이 두 번 간다. */
  it('메일만 실패하면 답변은 등록됐다고 정확히 말한다', async () => {
    mocks.sendInquiryEmail.mockResolvedValue({ status: 'failed', error: 'provider_failure' });

    const state = await answerInquiryAction({}, answerForm());

    expect(state.errors).toBeUndefined();
    expect(state.message).toContain('답변을 등록했고');
    expect(state.message).toContain('메일 발송은 완료되지 않았습니다');
  });

  it('종결된 문의는 이유를 밝혀 거절한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'inquiry_closed' } });

    const state = await answerInquiryAction({}, answerForm());

    expect(state.errors?.form).toContain('종결된 문의');
    expect(mocks.sendInquiryEmail).not.toHaveBeenCalled();
  });
});

describe('closeInquiryAction', () => {
  it('staff가 종결하면 목록과 상세를 다시 그린다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const formData = new FormData();
    formData.set('inquiryId', INQUIRY_ID);
    const state = await closeInquiryAction({}, formData);

    expect(mocks.rpc).toHaveBeenCalledWith('admin_close_inquiry', {
      target_inquiry_id: INQUIRY_ID,
    });
    expect(state.message).toBe('문의를 종결했습니다.');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/cs/inquiries');
  });
});

describe('saveInquiryReplyTemplateAction', () => {
  it('이름이나 본문이 비면 저장하지 않는다', async () => {
    const formData = new FormData();
    formData.set('templateTitle', '');
    formData.set('templateBody', '내용');

    const state = await saveInquiryReplyTemplateAction({}, formData);

    expect(state.errors?.form).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('새 템플릿은 id 없이 저장한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const formData = new FormData();
    formData.set('templateTitle', '배송 지연 안내');
    formData.set('templateBody', '배송이 지연되어 죄송합니다.');
    const state = await saveInquiryReplyTemplateAction({}, formData);

    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_inquiry_reply_template', {
      target_body: '배송이 지연되어 죄송합니다.',
      target_template_id: null,
      target_title: '배송 지연 안내',
    });
    expect(state.message).toBe('답변 템플릿을 저장했습니다.');
  });
});
