import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordOrderClaimOriginCollectionAction,
  recordOrderClaimReshipmentDeliveryAction,
  type AdminClaimActionState,
} from './claim-actions';

const CLAIM_ID = 'abcdef01-1234-4123-8123-123456789abc';
const SHIPMENT_ID = 'abcdef02-1234-4123-8123-123456789abc';
const RAW_EVIDENCE = '  창고 확인\n상품 2개\t수령\r\n  ';

const mocks = vi.hoisted(() => ({
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  loadAdminClaimDetail: vi.fn(),
  reconcileOrderCancellation: vi.fn(),
  recoverGoodsPaymentManually: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: mocks.getCurrentAdminAuthState,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/claims.server', () => ({
  loadAdminClaimDetail: mocks.loadAdminClaimDetail,
}));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({
  reconcileOrderCancellation: mocks.reconcileOrderCancellation,
}));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({
  recoverGoodsPaymentManually: mocks.recoverGoodsPaymentManually,
}));

function receiptForm(claimType: 'return' | 'exchange', evidence = RAW_EVIDENCE) {
  const form = new FormData();
  form.set('claimId', ` ${CLAIM_ID.toUpperCase()} `);
  form.set('shipmentId', ` ${SHIPMENT_ID.toUpperCase()} `);
  form.set('claimType', claimType);
  form.set('evidence', evidence);
  return form;
}

function expectPreservedFailure(
  state: AdminClaimActionState,
  form: FormData,
  error: string,
  attempt = 4,
) {
  expect(state).toEqual({
    error,
    values: Object.fromEntries(form.entries()),
    attempt,
  });
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentAdminAuthState.mockResolvedValue({
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@example.test' },
    role: 'staff',
    isStaff: true,
  });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

afterEach(() => {
  expect(mocks.loadAdminClaimDetail).not.toHaveBeenCalled();
  expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  expect(mocks.recoverGoodsPaymentManually).not.toHaveBeenCalled();
});

const receiptActions = [
  {
    name: 'recordOrderClaimOriginCollectionAction',
    action: recordOrderClaimOriginCollectionAction,
    claimType: 'return' as const,
    rpcName: 'admin_record_order_claim_origin_collection',
    fallback: '수거 상태를 기록하지 못했습니다. 최신 상태를 확인해주세요.',
    rejectedState: 'claim_not_collectable',
    rejectedMessage: '수거 단계가 아닙니다. 최신 상태를 확인해주세요.',
  },
  {
    name: 'recordOrderClaimReshipmentDeliveryAction',
    action: recordOrderClaimReshipmentDeliveryAction,
    claimType: 'exchange' as const,
    rpcName: 'admin_record_order_claim_reshipment_delivery',
    fallback: '교환품 배송완료를 기록하지 못했습니다. 최신 상태를 확인해주세요.',
    rejectedState: 'claim_reshipment_not_dispatched',
    rejectedMessage: '재출고 운송장이 기록된 교환만 배송완료를 확인할 수 있습니다.',
  },
];

describe.each(receiptActions)('$name', (contract) => {
  it('동시에 처리 상태가 바뀌어 거절되어도 입력 원문과 식별자를 보존한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: contract.rejectedState } });
    const form = receiptForm(contract.claimType);

    const state = await contract.action({ attempt: 3 }, form);

    expectPreservedFailure(state, form, contract.rejectedMessage);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('반송 주소 오류도 근거의 공백·개행·탭을 보존한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'claim_return_address_required' } });
    const form = receiptForm(contract.claimType);

    const state = await contract.action({ attempt: 3 }, form);

    expectPreservedFailure(state, form, '출고지 설정에 반송 주소를 등록한 뒤 다시 진행해주세요.');
  });

  it('알 수 없는 RPC 오류의 결제사 상세 정보는 반환하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'provider private-token-canary payment_key=qa-private-key',
        details: 'private-provider-payload',
        hint: 'private-provider-hint',
      },
    });
    const form = receiptForm(contract.claimType);

    const state = await contract.action({ attempt: 3 }, form);

    expectPreservedFailure(state, form, contract.fallback);
    expect(JSON.stringify(state)).not.toContain('private-');
  });

  it.each([
    ['공백뿐인 근거', '  \n\t  ', '확인 근거를 500자 이내로 입력해주세요.'],
    ['500자를 초과한 근거', `  ${'가'.repeat(501)}\n`, '확인 근거를 500자 이내로 입력해주세요.'],
    ['금지된 제어문자', '  확인\u0001근거\n ', '확인 근거에 표시할 수 없는 문자가 있습니다. 내용을 확인해주세요.'],
  ])('%s는 RPC 전에 거절하고 원문을 보존한다', async (_name, evidence, error) => {
    const form = receiptForm(contract.claimType, evidence);

    const state = await contract.action({ attempt: 3 }, form);

    expectPreservedFailure(state, form, error);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('유효하지 않은 클레임 식별자도 원문 그대로 복구할 수 있다', async () => {
    const form = receiptForm(contract.claimType);
    form.set('claimId', '  invalid-claim  ');

    const state = await contract.action({ attempt: 3 }, form);

    expectPreservedFailure(state, form, '클레임을 찾을 수 없습니다.');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('staff 권한이 없으면 RPC 없이 입력을 보존한다', async () => {
    mocks.getCurrentAdminAuthState.mockResolvedValue({
      isConfigured: true,
      user: { id: 'customer-1', email: 'customer@example.test' },
      role: 'user',
      isStaff: false,
    });
    const form = receiptForm(contract.claimType);

    const state = await contract.action({ attempt: 3 }, form);

    expectPreservedFailure(state, form, '관리자 권한이 필요합니다.');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('미로그인 사용자의 로그인 redirect 제어 흐름을 유지한다', async () => {
    mocks.getCurrentAdminAuthState.mockResolvedValue({
      isConfigured: true,
      user: null,
      role: null,
      isStaff: false,
    });

    await expect(contract.action({}, receiptForm(contract.claimType)))
      .rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Fclaims%2Fcancels');

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('연속 실패마다 attempt를 늘리고 가장 최근 입력을 보존한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: contract.rejectedState } });
    const firstForm = receiptForm(contract.claimType);
    const first = await contract.action({}, firstForm);
    expectPreservedFailure(first, firstForm, contract.rejectedMessage, 1);
    const secondForm = receiptForm(contract.claimType, '  새 확인\n두 번째 입력  ');
    secondForm.set('shipmentId', 'abcdef03-1234-4123-8123-123456789abc');

    const second = await contract.action(first, secondForm);

    expectPreservedFailure(second, secondForm, contract.rejectedMessage, 2);
  });

  it.each([null, true, {}, ['collected'], 'processing', 'completed'])(
    '성공 토큰이 아닌 응답 %j는 실패로 취급하고 입력을 보존한다',
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      const form = receiptForm(contract.claimType);

      const state = await contract.action({ attempt: 3 }, form);

      expectPreservedFailure(state, form, contract.fallback);
    },
  );
});

describe('회수 확인 성공', () => {
  it.each([
    ['collecting', '이 출고지의 회수를 확인했습니다. 남은 출고지를 확인해주세요.'],
    ['collected', '모든 출고지의 회수를 확인했습니다. 다음 처리 단계와 환급 기한을 확인해주세요.'],
  ])('%s 응답은 정규화한 인자와 해당 반품 화면만 재검증한다', async (data, message) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    const state = await recordOrderClaimOriginCollectionAction(
      { attempt: 3, values: { evidence: '이전 실패 입력' } },
      receiptForm('return'),
    );

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_record_order_claim_origin_collection', {
      p_claim_id: CLAIM_ID,
      p_shipment_id: SHIPMENT_ID,
      p_evidence: RAW_EVIDENCE.trim(),
    });
    expect(state).toEqual({ message });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin/sales/claims/returns'],
      [`/admin/sales/claims/returns/${CLAIM_ID}`],
      ['/admin/sales/orders'],
      ['/admin/sales/dispatch'],
      ['/orders'],
    ]);
  });

  it('유효하지 않은 배송 건이면 RPC 전에 원문 식별자와 근거를 보존한다', async () => {
    const form = receiptForm('return');
    form.set('shipmentId', '  invalid-shipment  ');

    const state = await recordOrderClaimOriginCollectionAction({ attempt: 3 }, form);

    expectPreservedFailure(state, form, '회수 확인할 배송 건을 선택해주세요.');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe('교환품 배송완료 확인 성공', () => {
  it('배송완료 RPC에 근거만 전달하고 교환 상세·목록을 재검증한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'delivered', error: null });

    const state = await recordOrderClaimReshipmentDeliveryAction(
      { attempt: 3, values: { evidence: '이전 실패 입력' } },
      receiptForm('exchange'),
    );

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_record_order_claim_reshipment_delivery', {
      p_claim_id: CLAIM_ID,
      p_evidence: RAW_EVIDENCE.trim(),
    });
    expect(state).toEqual({
      message: '교환품의 실제 배송완료를 확인했습니다. 이후 신청은 기존 신청 기한과 조건을 따릅니다.',
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin/sales/claims/exchanges'],
      [`/admin/sales/claims/exchanges/${CLAIM_ID}`],
      ['/admin/sales/orders'],
      ['/admin/sales/dispatch'],
      ['/orders'],
    ]);
  });

  it('회수 완료 토큰을 교환품 배송완료로 잘못 인정하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'collected', error: null });
    const form = receiptForm('exchange');

    const state = await recordOrderClaimReshipmentDeliveryAction({ attempt: 3 }, form);

    expectPreservedFailure(state, form, '교환품 배송완료를 기록하지 못했습니다. 최신 상태를 확인해주세요.');
  });
});
