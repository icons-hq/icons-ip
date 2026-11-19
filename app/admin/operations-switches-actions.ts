'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import {
  DELAY_NOTICE_EVIDENCE_MAX, EMAIL_NOT_CONFIGURED_MESSAGE, OPERATIONS_SWITCHES_PATH, RETURN_FEE_AMOUNT_MAX, SWITCH_EVIDENCE_MAX,
  operationsSwitchEvidenceProblem, operationsSwitchesError, parseOperationsSwitches, type OperationsSwitchesState,
} from '@/lib/admin/operations-switches';
import { emailDispatcherFromEnvironment } from '@/lib/email/dispatcher.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type OperationsSwitchResult = { state: OperationsSwitchesState } | { error: string; uncertain?: boolean };

const FORBIDDEN = { error: operationsSwitchesError('42501') } as const;
const INVALID = { error: operationsSwitchesError('22023') } as const;

const validRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
/** 근거는 켤 때 필수, 끌 때는 비워 둘 수 있다(비우면 DB가 직전 근거를 그대로 둔다). */
function evidenceOf(enabled: boolean, value: unknown, max: number): { evidence: string | null } | { error: string } {
  if (value === null || value === undefined || value === '') return enabled ? { error: '켜려면 근거를 적어주세요.' } : { evidence: null };
  if (typeof value !== 'string') return INVALID;
  const problem = operationsSwitchEvidenceProblem(value, max);
  return problem ? { error: problem } : { evidence: value };
}

async function call(rpc: string, args: Record<string, unknown>, matches: (state: OperationsSwitchesState) => boolean): Promise<OperationsSwitchResult> {
  try {
    const { data, error } = await (await createClient()).rpc(rpc, args);
    if (error) {
      const known = error.code === 'PT409' || ['42501', '28000', '22023'].includes(error.code ?? '');
      return known ? { error: operationsSwitchesError(error.code, error.message) } : { error: operationsSwitchesError(), uncertain: true };
    }
    const state = parseOperationsSwitches(data);
    if (!state || !matches(state)) return { error: operationsSwitchesError(), uncertain: true };
    revalidatePath(OPERATIONS_SWITCHES_PATH);
    /* 상품 상세 '고객 귀책 반품비'가 차감 정책 금액을 따르므로 반품배송비 스위치를 바꾸면 상세를 다시 그린다. */
    if (rpc === 'admin_save_return_fee_deduction_switch') revalidateGoodsSurfaces();
    return { state };
  } catch (error) { unstable_rethrow(error); return { error: operationsSwitchesError(), uncertain: true }; }
}

const GUARD = { capability: 'platform.manage', adminOnly: true } as const;

/** 주문 지연 안내 이메일 스위치. 켜기 전에 이메일 공급자·서명 설정이 운영 환경에 준비돼 있어야 한다. */
export async function saveOrderDelayNoticeSwitchAction(enabled: unknown, evidence: unknown, expectedRevision: unknown,
  operationId: unknown): Promise<OperationsSwitchResult> {
  if (!await requireAdminActionAccess(OPERATIONS_SWITCHES_PATH, GUARD)) return FORBIDDEN;
  if (typeof enabled !== 'boolean' || !validRevision(expectedRevision) || !isUuid(operationId)) return INVALID;
  const text = evidenceOf(enabled, evidence, DELAY_NOTICE_EVIDENCE_MAX);
  if ('error' in text) return text;
  if (enabled && !emailDispatcherFromEnvironment()) return { error: EMAIL_NOT_CONFIGURED_MESSAGE };
  return call('admin_save_order_delay_notice_switch', {
    p_enabled: enabled, p_evidence: text.evidence, p_expected_revision: expectedRevision, p_operation_id: operationId,
  }, (state) => state.delayNotice.enabled === enabled);
}

/** 반품배송비 차감 스위치. 켤 때는 편도 금액과 근거가 필요하다. */
export async function saveReturnFeeDeductionSwitchAction(enabled: unknown, oneWayAmount: unknown, evidence: unknown, expectedRevision: unknown,
  operationId: unknown): Promise<OperationsSwitchResult> {
  if (!await requireAdminActionAccess(OPERATIONS_SWITCHES_PATH, GUARD)) return FORBIDDEN;
  if (typeof enabled !== 'boolean' || !validRevision(expectedRevision) || !isUuid(operationId)) return INVALID;
  const amountGiven = oneWayAmount !== null && oneWayAmount !== undefined;
  if (amountGiven && (typeof oneWayAmount !== 'number' || !Number.isSafeInteger(oneWayAmount) || oneWayAmount < 1 || oneWayAmount > RETURN_FEE_AMOUNT_MAX)) {
    return { error: `반품배송비 편도 금액은 1원 이상 ${RETURN_FEE_AMOUNT_MAX.toLocaleString('ko-KR')}원 이하 정수로 입력해주세요.` };
  }
  if (enabled && !amountGiven) return { error: '켜려면 반품배송비 편도 금액을 입력해주세요.' };
  const text = evidenceOf(enabled, evidence, SWITCH_EVIDENCE_MAX);
  if ('error' in text) return text;
  return call('admin_save_return_fee_deduction_switch', {
    p_enabled: enabled, p_one_way_amount: amountGiven ? oneWayAmount : null, p_evidence: text.evidence,
    p_expected_revision: expectedRevision, p_operation_id: operationId,
  }, (state) => state.returnFee.enabled === enabled && (!enabled || state.returnFee.oneWayAmount === oneWayAmount));
}

/** 부분 반품 스위치(ADR-0047). 꺼져 있으면 반품은 지금처럼 주문 전체만 받는다. */
export async function savePartialReturnSwitchAction(enabled: unknown, evidence: unknown, expectedRevision: unknown,
  operationId: unknown): Promise<OperationsSwitchResult> {
  if (!await requireAdminActionAccess(OPERATIONS_SWITCHES_PATH, GUARD)) return FORBIDDEN;
  if (typeof enabled !== 'boolean' || !validRevision(expectedRevision) || !isUuid(operationId)) return INVALID;
  const text = evidenceOf(enabled, evidence, SWITCH_EVIDENCE_MAX);
  if ('error' in text) return text;
  return call('admin_save_partial_return_switch', {
    p_enabled: enabled, p_evidence: text.evidence, p_expected_revision: expectedRevision, p_operation_id: operationId,
  }, (state) => state.partialReturn.enabled === enabled);
}

/** 재고 부족 부분 취소 스위치(반품배송비 차감과 독립). */
export async function savePartialCancelSwitchAction(enabled: unknown, evidence: unknown, expectedRevision: unknown,
  operationId: unknown): Promise<OperationsSwitchResult> {
  if (!await requireAdminActionAccess(OPERATIONS_SWITCHES_PATH, GUARD)) return FORBIDDEN;
  if (typeof enabled !== 'boolean' || !validRevision(expectedRevision) || !isUuid(operationId)) return INVALID;
  const text = evidenceOf(enabled, evidence, SWITCH_EVIDENCE_MAX);
  if ('error' in text) return text;
  return call('admin_save_partial_cancel_switch', {
    p_enabled: enabled, p_evidence: text.evidence, p_expected_revision: expectedRevision, p_operation_id: operationId,
  }, (state) => state.partialCancel.enabled === enabled);
}
