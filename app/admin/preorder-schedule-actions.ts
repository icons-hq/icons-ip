'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  PREORDER_SCHEDULE_BODY_MAX, PREORDER_SCHEDULE_LIMIT, PREORDER_SCHEDULE_REASON_MAX, PREORDER_SCHEDULE_TITLE_MAX,
  parsePreorderScheduleChange, parsePreorderScheduleChangeSummaries, parsePreorderSchedulePreview, preorderScheduleError,
  type PreorderScheduleChange, type PreorderScheduleChangeSummary, type PreorderSchedulePreview,
} from '@/lib/admin/preorder-schedule-change';
import { emailDispatcherFromEnvironment } from '@/lib/email/dispatcher.server';
import { isGoodsShipDate } from '@/lib/goods-preorders';
import { smsNotificationConfig } from '@/lib/sms/notifications.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/*
 * 상품 단위 예약 일정 일괄 변경·안내(QNA-040). 주문 배송 건의 약속일과 고객 안내를 바꾸므로 sales.manage다
 * (배송 건마다 바꾸는 admin_change_shipment_preorder_date·지연 안내와 같은 권한). 화면은 상품 편집의 예약판매 영역에 있다.
 * 미리보기·확정·결과의 판정은 전부 DB RPC가 하고, 이 액션은 입력 모양과 채널 준비 상태만 확인한다.
 */
const SCREEN = '/admin/catalog/goods';
const STAFF_REQUIRED = '예약 주문 일정 변경은 주문 관리 권한이 있는 운영자 계정에서 할 수 있습니다.';
const EMAIL_NOT_CONFIGURED = '이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다. 두 채널이 준비되어야 일정 변경과 안내를 진행할 수 있습니다.';

type Failure = { ok: false; error: string };
export type PreorderSchedulePreviewResult = { ok: true; preview: PreorderSchedulePreview; emailConfigured: boolean; smsAvailable: boolean } | Failure;
/** uncertain: 확정 요청이 서버에 닿았는지 모른다 — 같은 요청 UUID로 결과를 먼저 읽는다. */
export type PreorderScheduleChangeResult = { ok: true; change: PreorderScheduleChange } | (Failure & { uncertain?: boolean; stale?: boolean });

export interface PreorderSchedulePreviewInput { goodId: string; variantId: string | null; expectedShipDate: string }
export interface PreorderScheduleApplyInput extends PreorderSchedulePreviewInput {
  requestId: string;
  reason: string;
  title: string;
  body: string;
  fingerprint: string;
  excludedShipmentIds: string[];
}

function goodId(value: unknown) { const key = typeof value === 'string' ? value.trim() : ''; return key && key.length <= 200 ? key : null; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function previewInput(input: unknown): PreorderSchedulePreviewInput | null {
  if (!record(input)) return null;
  const id = goodId(input.goodId);
  if (!id || (input.variantId !== null && !isUuid(input.variantId)) || !isGoodsShipDate(input.expectedShipDate)) return null;
  return { goodId: id, variantId: input.variantId as string | null, expectedShipDate: input.expectedShipDate };
}

export async function previewPreorderScheduleChangeAction(input: unknown): Promise<PreorderSchedulePreviewResult> {
  if (!await requireAdminActionAccess(SCREEN, { capability: 'sales.manage' })) return { ok: false, error: STAFF_REQUIRED };
  const request = previewInput(input);
  if (!request) return { ok: false, error: preorderScheduleError('invalid_preorder_schedule_change') };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_preview_goods_preorder_schedule_change', {
      p_good_id: request.goodId, p_variant_id: request.variantId, p_expected_ship_date: request.expectedShipDate,
    });
    if (error) return { ok: false, error: preorderScheduleError(error.message) };
    const preview = parsePreorderSchedulePreview(data);
    if (!preview || preview.goodId !== request.goodId || preview.expectedShipDate !== request.expectedShipDate) {
      return { ok: false, error: '예약 주문 미리보기를 확인하지 못했습니다. 다시 미리 봐주세요.' };
    }
    return { ok: true, preview, emailConfigured: Boolean(emailDispatcherFromEnvironment()), smsAvailable: Boolean(smsNotificationConfig()) };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '예약 주문 미리보기를 불러오지 못했습니다.' }; }
}

function applyInput(input: unknown): PreorderScheduleApplyInput | null {
  const base = previewInput(input);
  if (!base || !record(input) || !isUuid(input.requestId) || typeof input.reason !== 'string' || typeof input.title !== 'string'
    || typeof input.body !== 'string' || typeof input.fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(input.fingerprint)
    || !Array.isArray(input.excludedShipmentIds) || input.excludedShipmentIds.length > PREORDER_SCHEDULE_LIMIT
    || !input.excludedShipmentIds.every(isUuid)) return null;
  const reason = input.reason.trim(), title = input.title.trim(), body = input.body.trim();
  if (!reason || reason.length > PREORDER_SCHEDULE_REASON_MAX || !title || title.length > PREORDER_SCHEDULE_TITLE_MAX || /[\r\n]/.test(title)
    || /\p{Cc}/u.test(title) || !body || body.length > PREORDER_SCHEDULE_BODY_MAX) return null;
  return {
    ...base, requestId: input.requestId.toLowerCase(), reason, title, body, fingerprint: input.fingerprint,
    excludedShipmentIds: [...new Set(input.excludedShipmentIds.map((id) => id.toLowerCase()))].sort(),
  };
}

function revalidateOrderSurfaces() {
  for (const path of ['/admin/sales/orders', '/admin/sales/dispatch', '/admin/sales/shipping', '/orders', '/notifications', '/gifts']) revalidatePath(path);
  revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
}

export async function applyPreorderScheduleChangeAction(input: unknown): Promise<PreorderScheduleChangeResult> {
  if (!await requireAdminActionAccess(SCREEN, { capability: 'sales.manage' })) return { ok: false, error: STAFF_REQUIRED };
  const request = applyInput(input);
  if (!request) return { ok: false, error: preorderScheduleError('invalid_preorder_schedule_change') };
  /* 지연 안내처럼 이메일 채널이 준비되지 않으면 두 채널 최초 요청을 막는다. 이미 처리된 같은 요청이면 결과를 읽어 보인다. */
  if (!emailDispatcherFromEnvironment()) {
    const existing = await readChange(request.requestId);
    return existing.ok ? existing : { ok: false, error: EMAIL_NOT_CONFIGURED };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_apply_goods_preorder_schedule_change', {
      p_request_id: request.requestId, p_good_id: request.goodId, p_variant_id: request.variantId, p_expected_ship_date: request.expectedShipDate,
      p_reason: request.reason, p_customer_title: request.title, p_customer_body: request.body, p_preview_fingerprint: request.fingerprint,
      p_excluded_shipments: request.excludedShipmentIds, p_sms_requested: Boolean(smsNotificationConfig()),
    });
    if (error) return { ok: false, error: preorderScheduleError(error.message), stale: error.message === 'preorder_schedule_stale' };
    const change = parsePreorderScheduleChange(data);
    if (!change || change.id !== request.requestId) return { ok: false, error: '일정 변경 결과를 확인하지 못했습니다. 같은 요청의 결과를 확인해주세요.', uncertain: true };
    revalidateOrderSurfaces();
    return { ok: true, change };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '연결이 끊겨 일정 변경이 반영됐는지 모릅니다. 같은 요청의 결과를 먼저 확인해주세요.', uncertain: true };
  }
}

async function readChange(id: string): Promise<PreorderScheduleChangeResult> {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_goods_preorder_schedule_change', { p_change_id: id });
    if (error) return { ok: false, error: preorderScheduleError(error.message) };
    const change = parsePreorderScheduleChange(data);
    return change && change.id === id ? { ok: true, change } : { ok: false, error: '일정 변경 결과를 확인하지 못했습니다.', uncertain: true };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '일정 변경 결과를 불러오지 못했습니다.', uncertain: true }; }
}

export async function readPreorderScheduleChangeAction(id: unknown): Promise<PreorderScheduleChangeResult> {
  if (!await requireAdminActionAccess(SCREEN, { capability: 'sales.manage' })) return { ok: false, error: STAFF_REQUIRED };
  if (!isUuid(id)) return { ok: false, error: preorderScheduleError('preorder_schedule_change_not_found') };
  return readChange(id.toLowerCase());
}

export async function listPreorderScheduleChangesAction(goodIdValue: unknown): Promise<{ ok: true; changes: PreorderScheduleChangeSummary[] } | Failure> {
  if (!await requireAdminActionAccess(SCREEN, { capability: 'sales.manage' })) return { ok: false, error: STAFF_REQUIRED };
  const id = goodId(goodIdValue);
  if (!id) return { ok: false, error: '상품을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_goods_preorder_schedule_changes', { p_good_id: id });
    const changes = error ? null : parsePreorderScheduleChangeSummaries(data);
    return changes ? { ok: true, changes } : { ok: false, error: '최근 일정 변경 기록을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '최근 일정 변경 기록을 불러오지 못했습니다.' }; }
}

/** 실패한 이메일만 같은 공급자 키로 다시 처리한다(지연 안내 재시도 RPC 그대로). 앱 알림과 접수된 이메일은 다시 보내지 않는다. */
export async function retryPreorderScheduleEmailsAction(id: unknown): Promise<PreorderScheduleChangeResult> {
  if (!await requireAdminActionAccess(SCREEN, { capability: 'sales.manage' })) return { ok: false, error: STAFF_REQUIRED };
  if (!isUuid(id)) return { ok: false, error: preorderScheduleError('preorder_schedule_change_not_found') };
  const current = await readChange(id.toLowerCase());
  if (!current.ok) return current;
  if (!emailDispatcherFromEnvironment()) return { ok: false, error: EMAIL_NOT_CONFIGURED };
  try {
    const client = await createClient();
    const { error } = await client.rpc('admin_retry_order_delay_notice', { target_notice: current.change.noticeId });
    if (error) return { ok: false, error: preorderScheduleError(error.message) };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '재시도 결과를 확인하지 못했습니다. 결과를 새로고침해주세요.', uncertain: true }; }
  revalidatePath('/admin/sales/dispatch');
  return readChange(current.change.id);
}
