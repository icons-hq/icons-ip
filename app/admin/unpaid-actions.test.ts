import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmBankDepositAction,
  confirmBankTransferDepositAction,
} from './unpaid-actions';

/* 무통장 입금 확정의 확인 메일 배선(#239·D8).
 * 확정 자체는 DB finalizer의 몫이므로, 여기서는 "approved가 돌아왔을 때만
 * 메일 훅이 주문 id로 불리는가"와 "메일 결과가 확정 보고를 바꾸지 않는가"를 본다. */

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const DEPOSIT_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' } as { id: string; email: string | null } | null,
    role: 'staff' as 'user' | 'staff' | 'admin' | null,
    isStaff: true,
  },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  sendConfirmationEmail: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/email/transactional.server', () => ({
  sendOrderConfirmationEmail: mocks.sendConfirmationEmail,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function transferForm(memo = '국민은행 830 박입금 31,000원 입금 확인') {
  const formData = new FormData();
  formData.set('orderId', ORDER_ID);
  formData.set('memo', memo);
  return formData;
}

function depositForm() {
  const formData = new FormData();
  formData.set('depositId', DEPOSIT_ID);
  formData.set('orderId', ORDER_ID);
  formData.set('memo', '뱅크다 830 제안 그대로 확정');
  return formData;
}

describe('admin unpaid actions', () => {
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: 'approved', error: null });
    mocks.revalidatePath.mockReset();
    mocks.sendConfirmationEmail.mockReset();
    mocks.sendConfirmationEmail.mockResolvedValue({ status: 'sent' });
  });

  it('입금 직접 확정이 approved면 주문 확인 메일 훅을 주문 id로 부른다', async () => {
    const result = await confirmBankTransferDepositAction({}, transferForm());

    expect(result).toEqual({ message: '입금을 확인해 주문을 결제완료로 확정했습니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_confirm_bank_transfer_deposit', {
      p_order_id: ORDER_ID,
      p_memo: expect.any(String),
    });
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('입금 내역 연결 확정이 approved면 같은 메일 훅을 부른다', async () => {
    const result = await confirmBankDepositAction({}, depositForm());

    expect(result).toEqual({ message: '입금 내역을 주문에 연결하고 결제완료로 확정했습니다.' });
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('finalizer가 approved가 아니면 메일을 보내지 않고 결과를 그대로 보고한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'needs_review', error: null });

    const result = await confirmBankTransferDepositAction({}, transferForm());

    expect(result.error).toContain('needs_review');
    expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('이미 처리된 주문 재시도는 유실됐을 수 있는 확인 메일을 복구한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'order_not_unpaid' } });

    const result = await confirmBankTransferDepositAction({}, transferForm());

    // 확정 커밋 후·발송 전에 죽은 요청의 재시도 창구다 — 훅 멱등이 중복을 막는다.
    expect(result.error).toContain('이미 처리된 주문');
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('이미 처리된 입금 재시도도 같은 복구 훅을 부른다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'deposit_already_decided' } });

    const result = await confirmBankDepositAction({}, depositForm());

    expect(result.error).toContain('이미 처리된 입금');
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('RPC 실패는 메일 훅에 닿지 않는다', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'bank_transfer_attempt_not_confirmable' },
    });

    const result = await confirmBankTransferDepositAction({}, transferForm());

    expect(result.error).toBeTruthy();
    expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('메일 발송이 실패로 끝나도 확정 보고는 그대로다 — 훅은 부수효과다', async () => {
    mocks.sendConfirmationEmail.mockResolvedValue({
      status: 'failed',
      error: 'provider_network_error',
    });

    const result = await confirmBankTransferDepositAction({}, transferForm());

    expect(result).toEqual({ message: '입금을 확인해 주문을 결제완료로 확정했습니다.' });
  });

  it('폼 검증 실패는 RPC와 메일 훅 앞에서 멈춘다', async () => {
    const result = await confirmBankTransferDepositAction({}, transferForm('짧다'));

    expect(result.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
  });
});
