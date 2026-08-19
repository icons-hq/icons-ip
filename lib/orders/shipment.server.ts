import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { createServiceClient } from '@/lib/supabase/service';
import type { ShippingCarrier, ShippingCarrierRegistry } from './shipment';

/**
 * 택배사 레지스트리 로더 (#251).
 *
 * `public.shipping_carriers`가 유일한 진실원이다. 앱에 상수 목록을 두지 않으므로
 * 운송장을 그리는 모든 표면이 이 로더를 지난다 — 고객 주문 상세, 어드민 콘솔,
 * 발송 메일까지.
 *
 * 실패를 조용히 삼키지 않는다. 빈 목록으로 넘어가면 등록된 운송장이 화면에서
 * 통째로 사라지고(`orderShipment`가 미등록 코드에 null을 준다) 운영자는 저장이
 * 안 된 것으로 읽는다. 읽지 못했으면 읽지 못했다고 말한다.
 */

interface CarrierRow {
  code: string;
  label: string;
  is_active: boolean;
  tracking_url_template: string;
}

/**
 * 레지스트리를 읽을 수 있는 클라이언트.
 *
 * 공개 읽기 테이블이라 쿠키 클라이언트로 충분하지만, 발송 메일 경로는 웹훅에서
 * 불려 쿠키가 없다. 그쪽은 이미 들고 있는 service 클라이언트를 그대로 넘긴다.
 */
type ShipmentRegistryClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createServiceClient>;

export async function loadShippingCarrierRegistry(
  client: ShipmentRegistryClient,
): Promise<ShippingCarrierRegistry> {
  const { data, error } = await client
    .from('shipping_carriers')
    .select('code,label,is_active,tracking_url_template')
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });

  if (error) {
    throw new Error(`Failed to load shipping carriers: ${error.message}`);
  }

  return ((data ?? []) as CarrierRow[]).map((row): ShippingCarrier => ({
    code: row.code,
    label: row.label,
    active: row.is_active,
    trackingUrlTemplate: row.tracking_url_template,
  }));
}

/**
 * 요청 안에서 한 번만 읽는다.
 *
 * 목록 화면 하나가 주문 20건을 그리며 20번 조회하면 안 된다. React `cache`는
 * 요청 단위 메모이제이션이라 운영자가 레지스트리를 고친 직후에도 다음 요청부터
 * 즉시 반영된다 — 배포 캐시가 아니다.
 */
export const getShippingCarrierRegistry = cache(
  async (): Promise<ShippingCarrierRegistry> => {
    const supabase = await createClient();
    return loadShippingCarrierRegistry(supabase);
  },
);
