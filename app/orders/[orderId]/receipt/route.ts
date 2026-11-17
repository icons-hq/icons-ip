import type { NextRequest } from 'next/server';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeOrderReference } from '@/lib/checkout';
import {
  ORDER_RECEIPT_NOTICE_PARAM,
  ORDER_RECEIPT_NOTICE_UNAVAILABLE,
  ORDER_RECEIPT_SECTION_ID,
  orderReceiptHref,
} from '@/lib/orders/receipt';
import { resolveOrderReceipt } from '@/lib/orders/receipt.server';

/* 결제 영수증(MD-0038): 고객 세션으로 소유를 확인한 뒤 결제사 매출전표 주소로 303 이동한다. GET이지만 돈을 움직이지 않는다.
   이동 주소(영수증 URL)와 결제 키는 응답 본문·로그에 남기지 않고, 캐시도 하지 않는다. */
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

function redirectTo(location: string) {
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: location } });
}

export async function GET(_request: NextRequest, context: RouteContext<'/orders/[orderId]/receipt'>) {
  const { orderId: rawOrderId } = await context.params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) return new Response('Not Found', { status: 404, headers: HEADERS });

  const auth = await getCurrentAuthState();
  if (!auth.user) return redirectTo(`/login?next=${encodeURIComponent(orderReceiptHref(orderId))}`);

  const receipt = await resolveOrderReceipt(auth.user.id, orderId);
  if (receipt.kind === 'redirect') return redirectTo(receipt.url);
  return redirectTo(`/orders/${orderId}?${ORDER_RECEIPT_NOTICE_PARAM}=${ORDER_RECEIPT_NOTICE_UNAVAILABLE}#${ORDER_RECEIPT_SECTION_ID}`);
}
