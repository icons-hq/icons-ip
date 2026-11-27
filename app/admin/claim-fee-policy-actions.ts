'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { CLAIM_FEE_POLICY_PATH, parseClaimFeePolicy, type ClaimFeePolicy } from '@/lib/orders/claim-fees';
import { CLAIM_FEE_MAX_AMOUNT, CLAIM_FEE_POLICY_PERMISSION_MESSAGE, CLAIM_FEE_POLICY_READ_FAILED_MESSAGE, claimFeePolicyFailure, type ClaimFeePolicyFailure } from '@/lib/admin/claim-fees';
const access = () => requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });
/** 지금 저장된 설정을 읽는다. 저장됐는지 모를 때 [저장됐는지 확인]이 부른다. */
export async function readClaimFeePolicyAction(): Promise<{ policy: ClaimFeePolicy } | { error: string }> {
 if (!await access()) return { error: CLAIM_FEE_POLICY_PERMISSION_MESSAGE };
 try { const { data, error } = await (await createClient()).rpc('admin_get_claim_fee_policy'); const policy = error ? null : parseClaimFeePolicy(data);
  return policy ? { policy } : { error: error?.code === '42501' ? CLAIM_FEE_POLICY_PERMISSION_MESSAGE : CLAIM_FEE_POLICY_READ_FAILED_MESSAGE };
 } catch (error) { unstable_rethrow(error); return { error: CLAIM_FEE_POLICY_READ_FAILED_MESSAGE }; }
}
/** 사용 여부와 기본 청구 금액만 저장한다. 근거·확인 체크는 받지 않는다(20261127101000). 누가 언제 바꿨는지는 DB가 감사 기록에 남긴다. */
export async function saveClaimFeePolicyAction(values: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown): Promise<{ policy: ClaimFeePolicy } | ClaimFeePolicyFailure> {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!identity || !isUuid(operationId) || !transactionInteger(revision, 1) || !transactionRecord(values) || !transactionExactKeys(values, ['enabled', 'returnAmount', 'exchangeAmount'])
  || typeof values.enabled !== 'boolean' || [values.returnAmount, values.exchangeAmount].some(a => a !== null && !transactionInteger(a, 1, CLAIM_FEE_MAX_AMOUNT))) return claimFeePolicyFailure('22023');
 const auth = await access();
 if (!auth || auth.user.id !== identity.actorId) return claimFeePolicyFailure('42501');
 let failure: ClaimFeePolicyFailure;
 try { const { data, error } = await (await createClient()).rpc('admin_save_claim_fee_policy', { p_values: { enabled: values.enabled, returnAmount: values.returnAmount, exchangeAmount: values.exchangeAmount },
   p_revision: revision, p_operation: operationId, p_actor: identity.actorId, p_session: identity.sessionId });
  const policy = error ? null : parseClaimFeePolicy(data);
  if (policy) { revalidatePath(CLAIM_FEE_POLICY_PATH); return { policy }; }
  failure = claimFeePolicyFailure(error?.code, error?.message);
 } catch (error) { unstable_rethrow(error); return claimFeePolicyFailure(); }
 if (!failure.changed) return failure;
 /* 다른 사람이 먼저 바꿨다 — 지금 저장된 설정을 함께 돌려줘 화면이 무엇으로 바뀌었는지 바로 보여 준다. 못 읽으면 문구만 돌려준다. */
 const current = await readClaimFeePolicyAction();
 return 'policy' in current ? { ...failure, latest: current.policy } : failure;
}
