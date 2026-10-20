'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { SELLER_CLAIM_PATH, parseSellerClaimContext, parseSellerClaimInput, parseSellerClaimReceipt, sellerClaimBlockMessage,
  sellerClaimReceiptMatchesInput,
  type SellerClaimContext, type SellerClaimReceipt } from '@/lib/admin/seller-claim-intake';

export type SellerClaimSubmitResult = { receipt: SellerClaimReceipt } | { error: string; uncertain?: boolean };
function inputError(message: string): string {
  if (['not_claimable','not_cancelable','deadline_expired','already_requested','reconciliation_in_progress','already_canceled','order_not_found'].includes(message)) return sellerClaimBlockMessage(message)!;
  if (message.includes('inquiry_mismatch') || message.includes('invalid_seller_claim_inquiry')) return '주문 고객과 주문번호가 일치하는 문의를 선택해주세요.';
  if (message.includes('customer_time')) return '고객 요청 시각은 주문 이후부터 현재까지로 입력해주세요. 접수 기한을 소급하지 않습니다.';
  if (message.includes('collections_changed')) return '주문의 출고지 구성이 변경되었습니다. 최신 주문에서 전체 수거 계획을 다시 확인해주세요.';
  if (message.includes('request_conflict')) return '같은 접수 요청의 저장 내용이 다릅니다. 해당 요청의 결과를 먼저 확인해주세요.';
  if (message.includes('unknown_shipping_carrier')) return '현재 사용할 수 있는 택배사를 선택해주세요.';
  if (message.includes('staff_required') || message.includes('operator_capability_required')) return '주문 관리 권한을 확인해주세요.';
  if (message.includes('refund_account')) return '은행·계좌번호·예금주를 확인해주세요. 교환에는 계좌를 저장하지 않습니다.';
  if (message.includes('collection_address')) return '수거지 이름·연락처·우편번호·주소를 확인해주세요.';
  return '접수 입력과 최신 주문 상태를 확인해주세요.';
}
export async function loadSellerClaimContextAction(orderId: string): Promise<{ context: SellerClaimContext } | { error: string }> {
  if (!await requireAdminActionAccess(SELLER_CLAIM_PATH, { capability: 'sales.manage' })) return { error: '관리자 권한이 필요합니다.' };
  if (!isUuid(orderId)) return { error: '주문번호를 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_seller_claim_intake_context', { p_order_id: orderId });
    if (error) return { error: inputError(error.message) };
    const context = parseSellerClaimContext(data);
    if (!context || context.orderId !== orderId) return { error: '주문의 접수 가능 여부를 확인하지 못했습니다. 다시 열어주세요.' };
    return { context };
  } catch (error) { unstable_rethrow(error); return { error: '주문을 불러오지 못했습니다. 다시 시도해주세요.' }; }
}
export async function readSellerClaimIntakeAction(input: unknown): Promise<{ receipt: SellerClaimReceipt | null } | { error: string }> {
  if (!await requireAdminActionAccess(SELLER_CLAIM_PATH, { capability: 'sales.manage' })) return { error: '관리자 권한이 필요합니다.' };
  const parsed = parseSellerClaimInput(input); if (!parsed.ok) return { error: parsed.error };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_seller_claim_intake', {
      p_request_id: parsed.requestId, p_payload: parsed.payload, p_refund_account: parsed.refundAccount,
    });
    if (error) return { error: '접수 결과를 확인하지 못했습니다. 같은 요청을 다시 조회해주세요.' };
    if (data === null) return { receipt: null };
    const receipt = parseSellerClaimReceipt(data);
    return receipt && sellerClaimReceiptMatchesInput(receipt, input) ? { receipt } : { error: '접수 결과와 처음 전송한 내용이 일치하지 않습니다. 담당자에게 확인해주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '접수 결과를 확인하지 못했습니다. 같은 요청을 다시 조회해주세요.' }; }
}
export async function submitSellerClaimIntakeAction(input: unknown): Promise<SellerClaimSubmitResult> {
  if (!await requireAdminActionAccess(SELLER_CLAIM_PATH, { capability: 'sales.manage' })) return { error: '관리자 권한이 필요합니다.' };
  const parsed = parseSellerClaimInput(input); if (!parsed.ok) return { error: parsed.error };
  try {
    const client = await createClient();
    const { error } = await client.rpc('admin_submit_seller_claim_intake', {
      p_request_id: parsed.requestId, p_payload: parsed.payload, p_refund_account: parsed.refundAccount,
    });
    if (error) return { error: inputError(error.message), uncertain: !error.code || !['22023','22007','22008','23514','PT409','42501','P0002'].includes(error.code) || error.message.includes('request_conflict') };
    const { data, error: readError } = await client.rpc('admin_read_seller_claim_intake', {
      p_request_id: parsed.requestId, p_payload: parsed.payload, p_refund_account: parsed.refundAccount,
    });
    const receipt = parseSellerClaimReceipt(data);
    if (readError || !receipt || !sellerClaimReceiptMatchesInput(receipt, input)) {
      return { error: '접수 결과가 불확실합니다. 같은 요청의 저장 결과부터 확인해주세요.', uncertain: true };
    }
    revalidatePath(SELLER_CLAIM_PATH);
    revalidatePath(`/admin/sales/claims/${receipt.claimType === 'cancel' ? 'cancels' : receipt.claimType === 'return' ? 'returns' : 'exchanges'}`);
    revalidatePath(`/orders/${receipt.orderId}`);
    revalidatePath('/orders');
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '접수 결과가 불확실합니다. 같은 요청의 저장 결과부터 확인해주세요.', uncertain: true }; }
}
