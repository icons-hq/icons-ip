'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { nextFormAttempt, type AdminFormValuesState } from '@/lib/admin/form-state';
import {
  hasDisallowedShippingNoticeControl,
  isShippingNoticeTemplateId,
  parseShippingNoticeTemplateInput,
  SHIPPING_NOTICE_TEMPLATE_EVIDENCE_MAX,
  SHIPPING_NOTICE_TEMPLATES_PATH,
} from '@/lib/admin/shipping-notice-templates';

export interface ShippingNoticeTemplateActionState extends AdminFormValuesState {
  errors?: Record<string, string>;
  message?: string;
  updatedAt?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAVE_FAILED = '배송정보 템플릿을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.';
const ACTIVATE_FAILED = '배송정보 템플릿을 활성화하지 못했습니다. 입력값과 확인 근거를 다시 확인해주세요.';
const APPLY_FAILED = '상품에 배송정보 템플릿을 적용하지 못했습니다. 최신 상품을 다시 확인해주세요.';

function stringValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

async function staffError(): Promise<string | null> {
  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return '권한을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(SHIPPING_NOTICE_TEMPLATES_PATH)}`);
  return auth.isStaff ? null : '관리자 권한이 필요합니다.';
}

function rpcErrors(error: { code?: string; message: string }, fallback: string): Record<string, string> {
  if (error.code === '23505') return { code: '같은 코드와 버전의 템플릿이 이미 있습니다.' };
  if (error.message.includes('shipping_notice_template_conflict') || error.message.includes('good_shipping_notice_conflict')) {
    return { form: '다른 운영자가 변경했습니다. 입력값을 복사한 뒤 최신 내용을 다시 열어주세요.' };
  }
  if (error.message.includes('shipping_notice_template_not_found')) return { form: '템플릿을 찾을 수 없습니다. 삭제되었거나 접근이 바뀌었습니다.' };
  if (error.message.includes('shipping_notice_template_active_immutable')) return { form: '활성 템플릿은 수정할 수 없습니다. 새 버전으로 등록해주세요.' };
  if (error.message.includes('shipping_notice_template_required')) return { form: '배송·교환/반품 안내와 고객센터 정보, 확인 근거를 모두 입력해주세요.' };
  if (error.message.includes('shipping_notice_template_not_active')) return { form: '활성화된 템플릿만 상품에 적용할 수 있습니다.' };
  if (error.message.includes('good_archived')) return { form: '보관된 상품에는 배송정보 템플릿을 적용할 수 없습니다.' };
  if (error.message.includes('good_not_found')) return { goodId: '상품을 찾을 수 없습니다. 상품 ID를 확인해주세요.' };
  if (error.message.includes('staff_required')) return { form: '관리자 권한이 필요합니다.' };
  return { form: fallback };
}

function saveValues(data: FormData): Record<string, string> {
  return Object.fromEntries([
    'id', 'code', 'version', 'name', 'shippingNotice', 'returnExchangeNotice',
    'csName', 'csPhone', 'csEmail', 'updatedAt',
  ].map((key) => [key, stringValue(data, key)]));
}

export async function saveShippingNoticeTemplateAction(
  previous: ShippingNoticeTemplateActionState,
  data: FormData,
): Promise<ShippingNoticeTemplateActionState> {
  const values = saveValues(data);
  const attempt = nextFormAttempt(previous);
  const fail = (errors: Record<string, string>): ShippingNoticeTemplateActionState => ({ errors, values, attempt });
  const accessError = await staffError();
  if (accessError) return fail({ form: accessError });
  if (values.id && (!UUID.test(values.id) || !values.updatedAt || Number.isNaN(Date.parse(values.updatedAt)))) {
    return fail({ form: '최신 배송정보 템플릿을 다시 열어주세요.' });
  }
  const parsed = parseShippingNoticeTemplateInput(values);
  if (!parsed.ok) return fail(parsed.errors);
  try {
    const supabase = await createClient();
    const { data: saved, error } = await supabase.rpc('admin_save_shipping_notice_template', {
      target_id: values.id || null,
      target_code: parsed.value.code,
      target_version: parsed.value.version,
      target_name: parsed.value.name,
      target_shipping_notice: parsed.value.shipping_notice,
      target_return_exchange_notice: parsed.value.return_exchange_notice,
      target_cs_name: parsed.value.cs_name,
      target_cs_phone: parsed.value.cs_phone,
      target_cs_email: parsed.value.cs_email,
      expected_updated_at: values.updatedAt || null,
    });
    if (error) return fail(rpcErrors(error, SAVE_FAILED));
    revalidatePath(SHIPPING_NOTICE_TEMPLATES_PATH);
    revalidatePath('/admin/catalog/goods');
    return {
      attempt,
      message: '배송정보 템플릿을 저장했습니다. 필수 안내와 확인 근거를 확인한 뒤 활성화해주세요.',
      updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : undefined,
    };
  } catch {
    return fail({ form: SAVE_FAILED });
  }
}

export async function activateShippingNoticeTemplateAction(
  previous: ShippingNoticeTemplateActionState,
  data: FormData,
): Promise<ShippingNoticeTemplateActionState> {
  const attempt = nextFormAttempt(previous);
  const id = stringValue(data, 'id');
  const updatedAt = stringValue(data, 'updatedAt');
  const evidence = stringValue(data, 'confirmationEvidence').trim();
  const fail = (errors: Record<string, string>): ShippingNoticeTemplateActionState => ({ errors, attempt });
  const accessError = await staffError();
  if (accessError) return fail({ form: accessError });
  if (!isShippingNoticeTemplateId(id) || !updatedAt || Number.isNaN(Date.parse(updatedAt))) {
    return fail({ form: '최신 배송정보 템플릿을 다시 열어주세요.' });
  }
  if (!evidence || evidence.length > SHIPPING_NOTICE_TEMPLATE_EVIDENCE_MAX || hasDisallowedShippingNoticeControl(evidence)) {
    return fail({ confirmationEvidence: `확인 근거는 1~${SHIPPING_NOTICE_TEMPLATE_EVIDENCE_MAX}자로 입력해주세요.` });
  }
  try {
    const supabase = await createClient();
    const { data: saved, error } = await supabase.rpc('admin_activate_shipping_notice_template', {
      target_id: id,
      expected_updated_at: updatedAt,
      evidence,
    });
    if (error) return fail(rpcErrors(error, ACTIVATE_FAILED));
    revalidatePath(SHIPPING_NOTICE_TEMPLATES_PATH);
    revalidatePath('/admin/catalog/goods');
    return {
      attempt,
      message: '배송정보 템플릿을 활성화했습니다. 상품에 적용해야 공개 안내에 반영됩니다.',
      updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : undefined,
    };
  } catch {
    return fail({ form: ACTIVATE_FAILED });
  }
}

export async function applyShippingNoticeTemplateAction(
  previous: ShippingNoticeTemplateActionState,
  data: FormData,
): Promise<ShippingNoticeTemplateActionState> {
  const attempt = nextFormAttempt(previous);
  const templateId = stringValue(data, 'templateId');
  const goodId = stringValue(data, 'goodId').trim();
  const goodUpdatedAt = stringValue(data, 'goodUpdatedAt');
  const clear = stringValue(data, 'clear') === 'true';
  const fail = (errors: Record<string, string>): ShippingNoticeTemplateActionState => ({ errors, attempt });
  const accessError = await staffError();
  if (accessError) return fail({ form: accessError });
  if (!clear && !isShippingNoticeTemplateId(templateId)) return fail({ form: '적용할 템플릿을 확인해주세요.' });
  if (!goodId || goodId.length > 120) return fail({ goodId: '상품 ID를 입력해주세요.' });
  if (!goodUpdatedAt || Number.isNaN(Date.parse(goodUpdatedAt))) return fail({ form: '상품 목록에서 최신 상품을 선택해주세요.' });
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_apply_shipping_notice_template', {
      target_good_id: goodId,
      target_template_id: clear ? null : templateId,
      expected_good_updated_at: goodUpdatedAt,
    });
    if (error) return fail(rpcErrors(error, APPLY_FAILED));
    revalidatePath(SHIPPING_NOTICE_TEMPLATES_PATH);
    revalidatePath('/admin/catalog/goods');
    revalidatePath(`/shop/${encodeURIComponent(goodId)}`);
    return { attempt, message: '상품에 배송정보 템플릿을 적용했습니다.' };
  } catch {
    return fail({ form: APPLY_FAILED });
  }
}

/** 상품 폼·엑셀의 명시적 해제 경로도 같은 잠금·감사 RPC를 사용한다. */
export async function clearShippingNoticeTemplateAction(
  previous: ShippingNoticeTemplateActionState,
  data: FormData,
): Promise<ShippingNoticeTemplateActionState> {
  const clearData = new FormData();
  for (const [key, value] of data.entries()) clearData.set(key, typeof value === 'string' ? value : '');
  clearData.set('templateId', '');
  clearData.set('clear', 'true');
  return applyShippingNoticeTemplateAction(previous, clearData);
}
