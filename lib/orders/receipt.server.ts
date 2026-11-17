import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getPaymentGateway } from '@/lib/payments/runtime-gateway';
import { ORDER_RECEIPT_PROVIDERS, isAllowedTossReceiptUrl, orderReceiptAvailable, type OrderReceiptProvider } from './receipt';

/** 영수증 경로의 결과. 실패 사유는 고객에게 구분해 말하지 않는다(어느 쪽이든 '지금 불러오지 못했어요'). */
export type OrderReceiptResolution = { kind: 'redirect'; url: string } | { kind: 'unavailable' };

const UNAVAILABLE: OrderReceiptResolution = { kind: 'unavailable' };
/** 영수증이 남는 결제 상태. receipt.ts의 가용성 판정과 같은 집합이다(결제 뒤 취소·환불된 결제의 매출전표도 남는다). */
const RECEIPT_PAYMENT_STATUSES = ['paid', 'canceled', 'refunded'];
const PAYMENT_KEY_MAX_LENGTH = 200;

function isReceiptProvider(provider: string): provider is OrderReceiptProvider {
  return (ORDER_RECEIPT_PROVIDERS as readonly string[]).includes(provider);
}

function failed(reason: string): OrderReceiptResolution {
  /* 사유 코드만 남긴다 — 결제 키·주문 id·응답 본문은 로그에 싣지 않는다. */
  console.error('[orders] receipt unavailable', reason);
  return UNAVAILABLE;
}

/**
 * 본인 주문의 결제 영수증(결제사 매출전표) 이동 주소를 구한다(MD-0038). 영수증 URL은 저장하지 않고 요청마다 결제사에 조회한다.
 *
 * 1. 고객 세션(RLS)으로 본인 `payment_summaries`의 최신 결제 한 건을 읽는다 — 이 읽기가 소유 확인이다(선물 주문도 결제자 = 보낸 사람).
 * 2. 영수증을 지원하는 provider·결제 상태가 아니면 끝낸다.
 * 3. service role로 **그 결제 id 한 행의 `payment_key`만** 읽는다. 키는 이 함수 밖으로 나가지 않는다.
 * 4. 결제사 어댑터의 `receiptUrl`에 키를 넘겨 영수증 URL을 받고, 이동 허용 호스트인지 한 번 더 확인한다.
 *
 * 어느 단계든 실패하면 `unavailable`이다(throw 하지 않는다). 돈을 움직이지 않는 조회다.
 */
export async function resolveOrderReceipt(userId: string, orderId: string): Promise<OrderReceiptResolution> {
  try {
    const customer = await createClient();
    const { data: rows, error } = await customer
      .from('payment_summaries')
      .select('id,provider,status')
      .eq('user_id', userId)
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .in('status', RECEIPT_PAYMENT_STATUSES)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);
    if (error) return failed('payment_read');
    const row = (rows ?? [])[0] as { id?: unknown; provider?: unknown; status?: unknown } | undefined;
    if (!row) return failed('payment_missing');
    const { id: paymentId, provider, status } = row;
    if (typeof paymentId !== 'string' || typeof provider !== 'string' || typeof status !== 'string') return failed('payment_shape');
    if (!orderReceiptAvailable({ paymentMethod: 'card', payment: { provider, status } }) || !isReceiptProvider(provider)) return failed('provider_unsupported');

    const service = createServiceClient();
    const { data: keyRow, error: keyError } = await service
      .from('payments')
      .select('payment_key')
      .eq('id', paymentId)
      .eq('user_id', userId)
      .maybeSingle();
    if (keyError) return failed('key_read');
    const paymentKey = (keyRow as { payment_key?: unknown } | null)?.payment_key;
    if (typeof paymentKey !== 'string' || !paymentKey || paymentKey.length > PAYMENT_KEY_MAX_LENGTH) return failed('key_missing');

    const lookup = await getPaymentGateway(provider).receiptUrl?.(paymentKey);
    /* 결제사 조회 실패는 사유 코드만 남긴다(`gateway_<kind>[:<reason>]`). 키 오류·결제사 장애로 기능 전체가 막혀도 운영자가 알 수 있게. */
    if (!lookup || lookup.kind !== 'ok') return failed(`gateway_${lookup?.kind ?? 'missing'}${lookup && 'reason' in lookup && lookup.reason ? `:${lookup.reason}` : ''}`);
    /* 어댑터가 이미 확인했지만, 이동 대상은 여기서도 한 번 더 막는다(열린 리디렉션 방지). 영수증 provider가 토스 하나라
       호스트 규칙도 토스 하나다 — provider를 더할 때 provider별 규칙으로 바꾼다. */
    if (!isAllowedTossReceiptUrl(lookup.url)) return failed('url_rejected');
    return { kind: 'redirect', url: lookup.url };
  } catch {
    return failed('exception');
  }
}
