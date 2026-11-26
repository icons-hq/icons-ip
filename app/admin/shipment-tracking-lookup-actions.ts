'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { ADMIN_PICKER_PAGE_SIZE, type AdminPickerPage } from '@/lib/admin/picker';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { findShippingCarrier, isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/*
 * 운송장 맞바꾸기(SHP-031)에서 상대 배송 건을 고르는 읽기 전용 조회. 상대 배송건번호(16자리)와 그 배송 건의 운송장번호를 글자로 적게 하지 않고,
 * 운송장번호로 찾은 배송 건을 공용 선택창에서 고르게 한다(화면 규칙 1). 새 조회 함수를 만들지 않고 배송현황 목록이 쓰는
 * `admin_search_shipments_console`(출고 권한, 운송장번호 검색)을 그대로 부른다 — 맞바꿀 수 있는 배송 건(발송됨·배송완료, 택배)만 받는다.
 * 쓰기는 하지 않고, 맞바꾸기 자체의 권한·판정은 `swapShipmentTrackingAction`과 DB가 그대로 한다.
 */

/** 맞바꿀 상대로 고를 수 있는 배송 건. 값은 모두 목록이 이미 보이는 것이다. */
export interface TrackingSwapCandidate {
  /** 맞바꾸기 요청이 가리키는 값. 화면에 보이지 않고 숨은 값으로만 쓴다. */
  id: string;
  /** 화면에 보이는 배송건번호. */
  reference: string;
  /** 화면에 보이는 주문번호. */
  orderReference: string;
  recipientName: string | null;
  originName: string;
  carrierLabel: string;
  /** 이 배송 건에 지금 등록된 대표 운송장번호. */
  trackingNumber: string;
}

export type TrackingSwapCandidatesResult = { ok: true; data: AdminPickerPage<TrackingSwapCandidate> } | { ok: false; error: string };

const SHIPPING_PATH = '/admin/sales/shipping';
/** 검색어가 이보다 짧으면 운송장번호 하나를 가리키지 못해 엉뚱한 배송 건이 잔뜩 나온다(등록되는 운송장은 8자 이상이다). */
const MIN_QUERY_LENGTH = 8;
/** 탭마다 읽는 최대 줄. 8자 이상 운송장번호는 거의 한 건이라 넘칠 일이 없지만, 넘치면 앞쪽만 보이고 검색어를 늘리라고 안내한다. */
const READ_LIMIT = 100;
const TABS = ['transit', 'delivered'] as const;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value ? value : null;

function emptyPage(): AdminPickerPage<TrackingSwapCandidate> {
  return { rows: [], total: 0, page: 1, pageSize: ADMIN_PICKER_PAGE_SIZE };
}

/** 운송장번호로 맞바꿀 수 있는 상대 배송 건을 찾는다. 이 배송 건 자신은 뺀다. */
export async function searchTrackingSwapCandidatesAction(
  shipmentId: string,
  request: { query: string; page: number },
): Promise<TrackingSwapCandidatesResult> {
  if (!await requireAdminActionAccess(SHIPPING_PATH, { capability: 'sales.dispatch' })) {
    return { ok: false, error: '출고 권한이 없거나 로그인이 끝났습니다. 로그인한 계정을 확인하고, 권한이 없으면 계정 주매니저에게 요청해주세요.' };
  }
  if (!isUuid(shipmentId)) return { ok: false, error: '배송 건을 다시 선택해주세요.' };
  const query = normalizeTrackingNumber(request.query);
  /* 검색어를 아직 적지 않은 처음 화면은 오류가 아니라 빈 목록이다. */
  if (!query) return { ok: true, data: emptyPage() };
  if (query.length < MIN_QUERY_LENGTH || !isTrackingNumber(query)) return { ok: false, error: `운송장번호를 ${MIN_QUERY_LENGTH}자 이상, 하이픈 없이 영문·숫자로 적어주세요.` };
  const page = Number.isSafeInteger(request.page) && request.page > 0 ? request.page : 1;

  try {
    const client = await createClient();
    const registry = await getShippingCarrierRegistry();
    const results = await Promise.all(TABS.map(tab => client.rpc('admin_search_shipments_console', {
      p_tab: tab, p_origin_id: null, p_query: query, p_from: null, p_to: null, p_limit: READ_LIMIT, p_offset: 0,
      p_field: 'tracking', p_date_field: 'ordered', p_method: 'parcel', p_payment_method: null, p_sort: 'oldest',
    })));
    const found: TrackingSwapCandidate[] = [];
    for (const result of results) {
      if (result.error || !record(result.data) || !Array.isArray(result.data.rows)) return { ok: false, error: '배송 건을 찾지 못했습니다. 잠시 뒤 다시 검색해주세요.' };
      for (const row of result.data.rows) {
        if (!record(row)) continue;
        const id = text(row.id), trackingNumber = text(row.trackingNumber);
        /* 이 배송 건 자신과 운송장이 없는 배송 건은 맞바꿀 수 없다. 추가 운송장으로만 걸린 배송 건도 뺀다 — 맞바꾸는 것은 대표 운송장이다. */
        if (!id || !trackingNumber || id === shipmentId || !trackingNumber.toLowerCase().includes(query.toLowerCase())) continue;
        const carrier = text(row.carrier), orderId = text(row.orderId);
        found.push({
          id,
          reference: commerceReferenceLabel(id, text(row.shipmentNumber)),
          orderReference: orderId ? commerceReferenceLabel(orderId, text(row.orderNumber)) : '번호 없음',
          recipientName: text(row.recipientName),
          originName: text(row.originName) ?? '출고지 없음',
          carrierLabel: (carrier && findShippingCarrier(registry, carrier)?.label) || carrier || '택배사 없음',
          trackingNumber,
        });
      }
    }
    const lastPage = Math.max(1, Math.ceil(found.length / ADMIN_PICKER_PAGE_SIZE));
    const current = Math.min(page, lastPage);
    return { ok: true, data: { rows: found.slice((current - 1) * ADMIN_PICKER_PAGE_SIZE, current * ADMIN_PICKER_PAGE_SIZE), total: found.length, page: current, pageSize: ADMIN_PICKER_PAGE_SIZE } };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '배송 건을 찾지 못했습니다. 잠시 뒤 다시 검색해주세요.' };
  }
}
