import { NextResponse } from 'next/server';
import { getCurrentAuthState } from '@/lib/auth/server';
import { parseTossOrderId } from '@/lib/payments/toss';
import { getTossConfig } from '@/lib/payments/toss-api';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { getServiceRoleConfig } from '@/lib/supabase/service';

/*
 * Retired Toss checkout callback. New goods and ticket payments both enter
 * through their provider-neutral confirm routes. This endpoint intentionally
 * performs no target lookup, provider approval, or ledger mutation.
 */

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface ConfirmBody {
  paymentKey: string;
  orderId: string;
  amount: number;
  paymentType: unknown;
}

function parseConfirmBody(body: unknown): ConfirmBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const { paymentKey, orderId, amount, paymentType } = body as Record<string, unknown>;
  if (typeof paymentKey !== 'string' || !paymentKey || paymentKey.length > 200) return null;
  if (typeof orderId !== 'string' || !orderId) return null;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return null;
  return { paymentKey, orderId, amount, paymentType };
}

export async function POST(request: Request) {
  if (
    !getSupabaseConfig().isConfigured
    || !getServiceRoleConfig().isConfigured
    || !getTossConfig().isConfigured
  ) {
    return errorJson(503, 'not_configured', '결제 환경이 구성되지 않았습니다.');
  }

  const auth = await getCurrentAuthState();
  if (!auth.user) return errorJson(401, 'auth_required', '로그인이 필요합니다.');

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorJson(400, 'invalid_body', '요청 본문이 JSON이 아닙니다.');
  }

  const body = parseConfirmBody(rawBody);
  if (!body) return errorJson(400, 'invalid_body', 'paymentKey·orderId·amount가 필요합니다.');
  if (body.paymentType !== 'NORMAL') {
    return errorJson(400, 'invalid_payment_type', '지원하지 않는 결제 유형입니다.');
  }

  const ref = parseTossOrderId(body.orderId);
  if (!ref) return errorJson(400, 'invalid_order_id', '주문 식별자 형식이 올바르지 않습니다.');

  return errorJson(
    409,
    'legacy_checkout_closed',
    ref.purpose === 'ticket'
      ? '신규 티켓 결제는 현재 결제 경로에서 진행할 수 없습니다.'
      : '신규 굿즈 결제는 현재 결제 경로에서 진행할 수 없습니다.',
  );
}
