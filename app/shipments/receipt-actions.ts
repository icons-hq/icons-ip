'use server';

import { unstable_rethrow } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';
import { deliveryObject, deliveryTimestamp, deliveryUuid } from '@/lib/shipment-delivery';

/** The clear value is returned to its authenticated owner once, never persisted by the app. */
export async function issueShipmentReceiptConfirmationAction(shipmentId: unknown): Promise<
  { ok: true; code: string; expiresAt: string; maxAttempts: number } | { ok: false; error: string }
> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user || !deliveryUuid(shipmentId)) return { ok: false, error: '주문한 계정으로 로그인한 뒤 수령 확인을 진행해주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('issue_shipment_receipt_confirmation', { p_shipment_id: shipmentId });
    if (error || !deliveryObject(data) || typeof data.code !== 'string' || !/^[0-9A-F]{12}$/.test(data.code)
      || !deliveryTimestamp(data.expiresAt) || data.maxAttempts !== 5) {
      return { ok: false, error: '현재 수령 확인값을 발급할 수 없습니다. 배송 상태와 진행 중인 요청을 확인해주세요.' };
    }
    return { ok: true, code: data.code, expiresAt: data.expiresAt, maxAttempts: 5 };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '수령 확인값을 발급하지 못했습니다. 다시 발급하면 이전 값은 사용할 수 없습니다.' }; }
}
