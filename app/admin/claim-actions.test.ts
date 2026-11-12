import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decideOrderClaimAction,
  recordOrderClaimCollectionAction,
  recordOrderClaimOriginCollectionAction,
  recordOrderClaimReshipmentDeliveryAction,
  waiveOrderClaimCollectionAction,
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
  mocks.getCurrentAdminAuthState.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(),
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

it.each(['hold', 'resume'])('예전 결정 액션의 %s는 무버전 RPC로 전달하지 않는다', async (decision) => {
  const form = new FormData();
  form.set('claimId', CLAIM_ID); form.set('claimType', 'return'); form.set('decision', decision);
  if (decision === 'hold') form.set('note', '합성 보류 사유를 전달합니다');
  expect(await decideOrderClaimAction({}, form)).toEqual({ error: '보류·해제 화면을 다시 열어 최신 요청의 유형과 상태를 확인해주세요.' });
  expect(mocks.rpc).not.toHaveBeenCalled();
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

/* 회수 묶음(배송 건 × 반품지, S36-040): 반품지가 갈린 배송 건은 묶음 키 RPC로, 아니면 배송 건 키 RPC로 확인한다. */
describe('recordOrderClaimOriginCollectionAction 회수 묶음', () => {
  const BUNDLE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  it('묶음 키가 있으면 묶음 RPC를 부르고 반품지 문구로 답한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'collecting', error: null });
    const form = receiptForm('return');
    form.set('bundleId', BUNDLE_ID.toUpperCase());
    const state = await recordOrderClaimOriginCollectionAction({}, form);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_collection_bundle', expect.objectContaining({ p_bundle_id: BUNDLE_ID, p_received_on: null }));
    expect(state).toEqual({ message: '이 반품지의 회수를 확인했습니다. 남은 반품지·출고지를 확인해주세요.' });
  });
  it('묶음 키 없이 반품지가 갈린 배송 건을 확인하면 묶음을 고르라고 한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'claim_collection_bundle_required' } });
    const form = receiptForm('return');
    const state = await recordOrderClaimOriginCollectionAction({ attempt: 3 }, form);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_origin_collection', expect.anything());
    expectPreservedFailure(state, form, '반품지가 둘 이상인 배송 건입니다. 반품지별 회수 확인에서 도착한 곳을 골라 확인해주세요.');
  });
});

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

    expectPreservedFailure(state, form, '회수 주소가 없는 상품이 있습니다. 상품의 반품/교환지를 고르거나 출고지 설정에 반품 주소를 등록한 뒤 다시 진행해주세요.');
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
    mocks.getCurrentAdminAuthState.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(),
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
    mocks.getCurrentAdminAuthState.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(),
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
    ['collected', '모든 출고지의 회수를 확인했습니다. 환급 기한은 가장 늦은 실제 입고일부터 셉니다. 다음 처리 단계를 확인해주세요.'],
  ])('%s 응답은 정규화한 인자와 해당 반품 화면만 재검증한다', async (data, message) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    const state = await recordOrderClaimOriginCollectionAction(
      { attempt: 3, values: { evidence: '이전 실패 입력' } },
      receiptForm('return'),
    );

    /* 입고일 칸이 없는 옛 양식은 null(=DB가 오늘)로 보낸다. */
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_record_order_claim_origin_collection', {
      p_claim_id: CLAIM_ID,
      p_shipment_id: SHIPMENT_ID,
      p_evidence: RAW_EVIDENCE.trim(),
      p_received_on: null,
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

  /* 1027T-033: 확인 버튼을 늦게 누른 시각이 아니라 운영자가 적은 실제 입고일을 함께 남긴다. */
  it('실제 입고일을 함께 보내고, 미래 날짜는 RPC 전에 거절한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'collecting', error: null });
    const form = receiptForm('return');
    form.set('receivedOn', '2026-01-02');
    await recordOrderClaimOriginCollectionAction({}, form);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_origin_collection', expect.objectContaining({ p_received_on: '2026-01-02' }));

    mocks.rpc.mockClear();
    const future = receiptForm('return');
    future.set('receivedOn', '2999-01-01');
    const state = await recordOrderClaimOriginCollectionAction({}, future);
    expect(state.error).toBe('실제 입고일은 오늘이나 그 이전 날짜로 입력해주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('레거시 회수 입고 확인은 실제 입고일과 선택 근거를 함께 보낸다(근거는 감사 기록에 남는다)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'collected', error: null });
    const form = new FormData();
    form.set('claimId', CLAIM_ID); form.set('claimType', 'return'); form.set('stage', 'collected');
    form.set('receivedOn', '2026-01-02'); form.set('evidence', ' 창고 회신 R-9 대조 ');
    const state = await recordOrderClaimCollectionAction({}, form);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_record_order_claim_collection', {
      p_claim_id: CLAIM_ID, p_stage: 'collected', p_received_on: '2026-01-02', p_evidence: '창고 회신 R-9 대조',
    });
    expect(state.message).toContain('실제 입고일(2026-01-02)');
  });

  it('DB가 주문일 이전 입고일을 거절하면 운영자 문구로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'invalid_collection_received_on' } });
    const form = receiptForm('return');
    form.set('receivedOn', '2020-01-01');
    const state = await recordOrderClaimOriginCollectionAction({}, form);
    expect(state.error).toBe('실제 입고일은 주문일부터 오늘 사이의 날짜로 입력해주세요.');
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

  it('출고지별 재출고는 송장마다 배송 건 RPC로 확인하고, 배송 건 없는 옛 주문 전체 행은 null로 보낸다(TKT-166)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'delivered', error: null });
    const form = receiptForm('exchange');
    form.set('reshipmentShipment', SHIPMENT_ID);
    expect(await recordOrderClaimReshipmentDeliveryAction({}, form)).toEqual({
      message: '이 송장의 교환품 배송완료를 확인했습니다. 모든 송장이 확인되면 이후 신청은 기존 신청 기한과 조건을 따릅니다.',
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_record_order_claim_shipment_reshipment_delivery', {
      p_claim_id: CLAIM_ID, p_shipment_id: SHIPMENT_ID, p_evidence: RAW_EVIDENCE.trim(),
    });
    form.set('reshipmentShipment', 'order');
    await recordOrderClaimReshipmentDeliveryAction({}, form);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_record_order_claim_shipment_reshipment_delivery', {
      p_claim_id: CLAIM_ID, p_shipment_id: null, p_evidence: RAW_EVIDENCE.trim(),
    });
    mocks.rpc.mockClear(); mocks.revalidatePath.mockClear();
    form.set('reshipmentShipment', 'not-a-shipment');
    expectPreservedFailure(await recordOrderClaimReshipmentDeliveryAction({ attempt: 3 }, form), form, '교환품 배송완료를 기록하지 못했습니다. 최신 상태를 확인해주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('출고지가 둘 이상인 교환을 옛 단일 확인으로 보내면 배송 건마다 확인하라고 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'reshipment_shipment_required' } });
    const form = receiptForm('exchange');
    expectPreservedFailure(await recordOrderClaimReshipmentDeliveryAction({ attempt: 3 }, form), form, '출고지가 둘 이상인 교환은 배송 건마다 재출고·배송완료를 확인해주세요.');
  });

  it('회수 완료 토큰을 교환품 배송완료로 잘못 인정하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'collected', error: null });
    const form = receiptForm('exchange');

    const state = await recordOrderClaimReshipmentDeliveryAction({ attempt: 3 }, form);

    expectPreservedFailure(state, form, '교환품 배송완료를 기록하지 못했습니다. 최신 상태를 확인해주세요.');
  });
});

/* 주문제작 출고지의 회수 생략 결정(리뷰 #2, ADR-0041): 사유·사진·확인을 앱이 먼저 좁히고 DB가 다시 검사한다. */
describe('waiveOrderClaimCollectionAction', () => {
  const EVIDENCE_ID = 'abcdef03-1234-4123-8123-123456789abc';
  function waiverForm() {
    const form = new FormData();
    form.set('claimId', CLAIM_ID); form.set('shipmentId', SHIPMENT_ID);
    form.set('reason', '고객 사진으로\n인쇄 불량을 확인했습니다'); form.append('evidenceFileId', EVIDENCE_ID); form.set('confirmed', 'on');
    return form;
  }
  it('결정을 RPC로 보내고 제작 대기면 주문제작 처리로 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { claimId: CLAIM_ID, shipmentId: SHIPMENT_ID, productionPending: true, replayed: false }, error: null });
    expect(await waiveOrderClaimCollectionAction({}, waiverForm())).toEqual({
      message: '회수 생략을 기록했습니다. 주문 상세의 주문제작 처리에서 교환품 제작을 마치면 회수 없이 재출고합니다.',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_waive_order_claim_collection', {
      p_claim_id: CLAIM_ID, p_shipment_id: SHIPMENT_ID, p_waiver: { reason: '고객 사진으로 인쇄 불량을 확인했습니다', evidenceFileIds: [EVIDENCE_ID] },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/sales/claims/exchanges/${CLAIM_ID}`);
  });
  it('확인·사유·사진이 모자라면 RPC를 부르지 않는다', async () => {
    const unconfirmed = waiverForm(); unconfirmed.delete('confirmed');
    expect((await waiveOrderClaimCollectionAction({}, unconfirmed)).error).toBe('회수 없이 교환품 제작을 시작한다는 확인에 체크해주세요.');
    const short = waiverForm(); short.set('reason', '짧음');
    expect((await waiveOrderClaimCollectionAction({}, short)).error).toBe('회수 생략 사유를 10~500자로 적어주세요.');
    const noPhoto = waiverForm(); noPhoto.delete('evidenceFileId');
    expect((await waiveOrderClaimCollectionAction({}, noPhoto)).error).toBe('회수 생략 근거 사진을 1~5장 올려주세요.');
    const duplicated = waiverForm(); duplicated.append('evidenceFileId', EVIDENCE_ID);
    expect((await waiveOrderClaimCollectionAction({}, duplicated)).error).toBe('회수 생략 근거 사진을 1~5장 올려주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('DB 거절을 운영자 문구로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'collection_waiver_conflict' } });
    expect((await waiveOrderClaimCollectionAction({}, waiverForm())).error).toBe('이 출고지는 이미 다른 사유·사진으로 회수 생략을 기록했습니다. 처리 이력을 확인해주세요.');
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'collection_waiver_not_needed' } });
    expect((await waiveOrderClaimCollectionAction({}, waiverForm())).error).toBe('이미 회수를 확인한 출고지입니다. 회수 생략 없이 진행해주세요.');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
