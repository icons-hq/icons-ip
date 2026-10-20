import { isSameOriginRequest } from '@/lib/http/same-origin.server';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { claimWithdrawalError, claimWithdrawalReceiptMatches, normalizeClaimWithdrawalRequest, parseClaimWithdrawalContext, parseClaimWithdrawalReceipt } from '@/lib/orders/claim-withdrawal';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function session(claimId: string) {
  if (!isUuid(claimId)) return { error: json({ error: '요청을 찾을 수 없습니다.' }, 404) };
  const client = await createClient(); const { data } = await client.auth.getUser();
  if (!data.user) return { error: json({ error: '로그인한 뒤 다시 확인해주세요.' }, 401) };
  return { client };
}
export async function GET(request: Request, route: RouteContext<'/api/orders/claims/[claimId]/withdrawal'>) {
  const { claimId } = await route.params;
  try {
    const auth = await session(claimId); if (auth.error) return auth.error;
    const operation = new URL(request.url).searchParams.get('operation');
    if (operation !== null && !isUuid(operation)) return json({ error: '변경 요청번호를 확인해주세요.' }, 400);
    const { data, error } = await auth.client.rpc(operation ? 'read_my_order_claim_withdrawal' : 'get_my_order_claim_withdrawal_context', operation ? { p_operation_id: operation } : { p_claim_id: claimId });
    if (error) return json({ error: claimWithdrawalError(error.code, error.message) }, error.code === 'P0002' ? 404 : error.code === '42501' ? 403 : 502);
    if (operation) {
      if (data === null) return json({ receipt: null });
      const receipt = parseClaimWithdrawalReceipt(data);
      if (!receipt || receipt.id !== operation || receipt.claimId !== claimId || receipt.actorKind !== 'customer') return json({ error: '해당 요청의 저장 결과를 확인하지 못했습니다.' }, 404);
      return json({ receipt });
    }
    const context = parseClaimWithdrawalContext(data);
    return context?.claimId === claimId ? json({ context }) : json({ error: '현재 요청 상태를 읽지 못했습니다.' }, 502);
  } catch { return json({ error: '요청 상태를 읽지 못했습니다.' }, 502); }
}
export async function POST(request: Request, route: RouteContext<'/api/orders/claims/[claimId]/withdrawal'>) {
  if (!isSameOriginRequest(request)) return json({ error: '허용되지 않은 요청입니다.' }, 403);
  const { claimId } = await route.params;
  const input = normalizeClaimWithdrawalRequest(await request.json().catch(() => null));
  if (!input || input.claimId !== claimId) return json({ error: claimWithdrawalError(undefined, 'invalid_claim_withdrawal') }, 400);
  try {
    const auth = await session(claimId); if (auth.error) return auth.error;
    const { data, error } = await auth.client.rpc('withdraw_my_order_claim', { p_claim_id: claimId, p_operation_id: input.id, p_expected_revision: input.revision, p_reason: input.reason, p_confirmed: true });
    if (error) return json({ error: claimWithdrawalError(error.code, error.message), conflict: error.code === 'PT409', uncertain: !['PT409','42501','22023','23514','P0002'].includes(error.code ?? '') }, error.code === '42501' ? 403 : 409);
    const receipt = parseClaimWithdrawalReceipt(data);
    if (!receipt || !claimWithdrawalReceiptMatches(receipt, input, false)) return json({ error: '저장 결과가 불확실합니다. 같은 요청을 확인해주세요.', uncertain: true }, 502);
    revalidatePath(`/orders/${receipt.orderId}`); return json({ receipt });
  } catch { return json({ error: '저장 결과가 불확실합니다. 같은 요청을 확인해주세요.', uncertain: true }, 502); }
}
