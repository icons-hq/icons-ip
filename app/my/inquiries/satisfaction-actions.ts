'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { parseInquirySatisfactionOperation, parseInquirySatisfactionRequest, type InquirySatisfactionActionResult } from '@/lib/inquiry-satisfaction';

const UNKNOWN: InquirySatisfactionActionResult = { ok: false, kind: 'unknown', error: '평가 저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 확인해주세요.' };
async function execute(input: unknown, recover: boolean): Promise<InquirySatisfactionActionResult> {
  const request = parseInquirySatisfactionRequest(input);
  if (!request) return { ok: false, kind: 'invalid', error: '평가 정보를 다시 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc(recover ? 'read_my_inquiry_satisfaction_operation' : 'set_my_inquiry_satisfaction', {
      p_operation_id: request.operationId, p_inquiry_id: request.inquiryId, p_expected_actor_id: request.expectedActorId,
      p_expected_session_id: request.expectedSessionId, p_expected_answer_id: request.expectedAnswerId,
      p_expected_revision: request.expectedRevision, p_desired_value: request.desiredValue,
    });
    if (error) {
      if (/inquiry_satisfaction_(answer_changed|revision_conflict)/.test(error.message))
        return { ok: false, kind: 'conflict', error: '답변 또는 평가가 변경됐습니다. 최신 상태를 확인한 뒤 다시 선택해주세요.' };
      if (/inquiry_satisfaction_(auth_required|account_unavailable|inquiry_unavailable)/.test(error.message))
        return { ok: false, kind: 'unavailable', error: '현재 계정과 로그인 상태로 평가할 수 없습니다. 화면을 새로고침해주세요.' };
      if (/inquiry_satisfaction_(operation_conflict|invalid_request)/.test(error.message))
        return { ok: false, kind: 'invalid', error: '요청 정보가 일치하지 않습니다. 화면을 새로고침해주세요.' };
      return UNKNOWN;
    }
    const parsed = parseInquirySatisfactionOperation(data, request);
    if (!parsed) return UNKNOWN;
    if (parsed.operation === 'completed' && !recover) {
      revalidatePath(`/my/inquiries/${request.inquiryId}`);
      revalidatePath('/admin/cs/inquiries');
    }
    return { ok: true, value: parsed };
  } catch { return UNKNOWN; }
}
export async function setInquirySatisfactionAction(input: unknown) { return execute(input, false); }
export async function readInquirySatisfactionOperationAction(input: unknown) { return execute(input, true); }
