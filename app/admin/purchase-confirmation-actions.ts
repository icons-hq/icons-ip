'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { CHANGED_BY_OTHER, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { PURCHASE_CONFIRMATION_RELOAD_LABEL, parsePurchaseConfirmationAutoPreview, type PurchaseConfirmationAutoPreviewRead } from '@/lib/admin/purchase-confirmation-preview';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { PURCHASE_CONFIRMATION_POLICY_PATH, parsePurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';

const FORBIDDEN = '거래확정 정책을 바꿀 권한이 없거나 로그인이 끝났습니다. 다시 로그인한 뒤 이 화면을 다시 열어주세요.';
const READ_FAILED = '거래확정 정책을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.';
const forbidden = (code?: string) => ['42501', '28000'].includes(code ?? '');

export async function readPurchaseConfirmationPolicyAction() {
  if (!await requireAdminActionAccess(PURCHASE_CONFIRMATION_POLICY_PATH, { capability: 'sales.manage' })) return { error: FORBIDDEN };
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_purchase_confirmation_policy');
    const policy = error ? null : parsePurchaseConfirmationPolicy(data);
    return policy ? { policy } : { error: forbidden(error?.code) ? FORBIDDEN : READ_FAILED };
  } catch (error) { unstable_rethrow(error); return { error: READ_FAILED }; }
}

/**
 * 자동 거래확정을 켜기 전 확인창에 보일 값: 지금 `autoAfterDays`일로 켜면 다음 자동 처리 한 번에서 거래확정될 주문 수와 지급될 적립금 합계,
 * 그 뒤로 넘어가는 주문 수. 읽기만 한다. 수치는 조회 시점 값이라 화면은 '지금 기준'이라고 말한다.
 *
 * 읽지 못하면(시간 초과·연결 실패 등) `unread`다. 화면은 건수를 읽지 못했다고 말하고 그래도 저장할지 묻는다 — 읽지 못한다고 저장을 막으면,
 * 대상이 쌓여 조회가 느려진 가게는 자동 거래확정을 켤 길이 없어진다. 권한·로그인 문제는 저장도 되지 않으므로 `error`다.
 */
export async function previewPurchaseConfirmationAutoAction(autoAfterDays: unknown): Promise<PurchaseConfirmationAutoPreviewRead> {
  if (!transactionInteger(autoAfterDays, 1, 36500)) return { error: "'배송완료 뒤 자동 확정까지 (일)'에 1~36,500 사이 숫자를 적어주세요." };
  if (!await requireAdminActionAccess(PURCHASE_CONFIRMATION_POLICY_PATH, { capability: 'sales.manage' })) return { error: FORBIDDEN };
  try {
    const { data, error } = await (await createClient()).rpc('admin_preview_purchase_confirmation_auto', { p_auto_after_days: autoAfterDays });
    const preview = error ? null : parsePurchaseConfirmationAutoPreview(data);
    if (preview) return { preview };
    return forbidden(error?.code) ? { error: FORBIDDEN } : { unread: true };
  } catch (error) { unstable_rethrow(error); return { unread: true }; }
}

/**
 * 거래확정 정책 저장. 근거 글·확인 체크는 받지 않는다 — 켤 때의 영향(확정 건수·적립금)은 화면이 저장 전에 확인창으로 보인다.
 * `uncertain`은 저장됐는지 모르는 경우다(같은 작업 번호로 다시 보내면 두 번 저장되지 않고 결과만 받는다).
 * `conflict`는 다른 사람이 먼저 바꾼 경우다(저장된 정책을 다시 읽어야 한다).
 */
export async function savePurchaseConfirmationPolicyAction(values: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown) {
  const identity = parseGoodsGroupIdentity(rawIdentity);
  if (!identity || !transactionInteger(revision, 1) || !isUuid(operationId) || !transactionRecord(values)
    || !transactionExactKeys(values, ['autoEnabled', 'autoAfterDays', 'buyerExtensionDays']) || typeof values.autoEnabled !== 'boolean') {
    return { error: '저장하지 못했습니다. 화면을 새로고침한 뒤 다시 저장해주세요.' };
  }
  if ([values.autoAfterDays, values.buyerExtensionDays].some(v => v !== null && !transactionInteger(v, 1, 36500))) return { error: '기간은 1~36,500 사이 숫자로 적어주세요.' };
  if (values.autoEnabled && values.autoAfterDays === null) return { error: "자동 거래확정을 켜려면 '배송완료 뒤 자동 확정까지 (일)'을 적어주세요." };
  const auth = await requireAdminActionAccess(PURCHASE_CONFIRMATION_POLICY_PATH, { capability: 'sales.manage' });
  if (!auth || auth.user.id !== identity.actorId) return { error: FORBIDDEN };
  const unknown = { error: SAVE_UNKNOWN_MESSAGE, uncertain: true as const };
  try {
    const { data, error } = await (await createClient()).rpc('admin_save_purchase_confirmation_policy', { p_values: values, p_revision: revision, p_operation_id: operationId, p_actor: identity.actorId, p_session: identity.sessionId });
    const policy = error ? null : parsePurchaseConfirmationPolicy(data);
    if (policy) { revalidatePath(PURCHASE_CONFIRMATION_POLICY_PATH); revalidatePath('/admin/sales/settled'); return { policy }; }
    if (forbidden(error?.code)) return { error: FORBIDDEN };
    if (error?.code === 'PT409') return { error: `${CHANGED_BY_OTHER} [${PURCHASE_CONFIRMATION_RELOAD_LABEL}]로 지금 정책을 확인한 뒤 다시 저장해주세요.`, conflict: true as const };
    if (error?.code === '22023') return { error: '저장하지 못했습니다. 기간을 확인한 뒤 다시 저장해주세요.' };
    return unknown;
  } catch (error) { unstable_rethrow(error); return unknown; }
}
