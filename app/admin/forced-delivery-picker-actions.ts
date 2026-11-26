'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { AUTO_ORDER_CONFIRMATION_PATH } from '@/lib/admin/auto-order-confirmation';
import { normalizeForcedDeliveryPickRequest, parseForcedDeliveryOrderRows, type ForcedDeliveryOrderRow } from '@/lib/admin/forced-delivery-picker';
import { ADMIN_PICKER_PAGE_SIZE, type AdminPickerPage } from '@/lib/admin/picker';
import { piiSearchRecord } from '@/lib/admin/pii-access-log';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';
import { createClient } from '@/lib/supabase/server';

/*
 * 강제 배송완료의 [주문 고르기] 조회. 주문 통합검색과 같은 DB 조회(admin_search_orders_console)를 상태 하나(발주확인 또는 배송중)로 불러
 * 20개씩 돌려준다. 강제 배송완료와 같은 권한(sales.manage)이고, DB 조회가 주문 조회 권한을 다시 확인한다.
 * 구매자 이름으로 찾은 결과는 주문 통합검색과 같이 개인정보 접속기록(검색)에 남긴다 — 검색어 원문 없이 이 쪽에 보인 주문 ID만.
 */
const DENIED = '주문을 찾으려면 주문 관리 권한이 필요합니다.';
const FAILED = '주문 목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';

export type ForcedDeliveryPickerResult = { ok: true; data: AdminPickerPage<ForcedDeliveryOrderRow> } | { ok: false; error: string };

export async function searchForcedDeliveryOrdersAction(input: unknown): Promise<ForcedDeliveryPickerResult> {
  try {
    const auth = await requireAdminActionAccess(AUTO_ORDER_CONFIRMATION_PATH, { capability: 'sales.manage' });
    if (!auth) return { ok: false, error: DENIED };
    const request = normalizeForcedDeliveryPickRequest(input);
    const supabase = await createClient();
    const read = async (page: number) => {
      const { data, error } = await supabase.rpc('admin_search_orders_console', {
        p_status: request.status, p_query: request.query || null, p_field: request.field, p_date_field: 'ordered', p_sort: 'newest',
        p_limit: ADMIN_PICKER_PAGE_SIZE, p_offset: (page - 1) * ADMIN_PICKER_PAGE_SIZE,
      });
      if (error) {
        const message = typeof error.message === 'string' ? error.message : '';
        return error.code === '42501' || error.code === '28000' || /staff required|operator_capability_required/.test(message) ? 'denied' as const : null;
      }
      const parsed = parseForcedDeliveryOrderRows(data);
      return parsed && { page, ...parsed };
    };
    let list = await read(request.page);
    /* 그사이 주문이 줄어 이 쪽이 비었으면 첫 쪽부터 다시 읽는다(선택창은 돌려준 쪽 번호를 따른다). */
    if (list && list !== 'denied' && !list.rows.length && request.page > 1) list = await read(1);
    if (list === 'denied') return { ok: false, error: DENIED };
    if (!list) return { ok: false, error: FAILED };
    const record = piiSearchRecord({ actorId: auth.user.id, surface: 'order.search', path: AUTO_ORDER_CONFIRMATION_PATH, subjectKind: 'order',
      subjectIds: list.rows.map(row => row.orderId), total: list.total, field: request.field, query: request.query, page: list.page, view: 'forced_delivery' });
    if (record) await notePiiAccess(record);
    return { ok: true, data: { rows: list.rows, total: list.total, page: list.page, pageSize: ADMIN_PICKER_PAGE_SIZE } };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: FAILED };
  }
}
