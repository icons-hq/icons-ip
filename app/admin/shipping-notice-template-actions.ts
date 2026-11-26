'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { nextFormAttempt, type AdminFormValuesState } from '@/lib/admin/form-state';
import {
  CATALOG_PERMISSION_MESSAGE, CHANGED_BY_OTHER, SAVE_FAILED_MESSAGE, SAVE_MISMATCH_MESSAGE, SAVE_UNKNOWN_MESSAGE,
} from '@/lib/admin/goods-template-save';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import {
  isShippingNoticeTemplateId,
  parseShippingNoticeTemplateInput,
  SHIPPING_NOTICE_TEMPLATE_APPLY_MAX,
  SHIPPING_NOTICE_TEMPLATE_VALUE_KEYS,
  SHIPPING_NOTICE_TEMPLATES_PATH,
  type ShippingNoticeTemplate,
  type ShippingNoticeTemplateApplyResult,
} from '@/lib/admin/shipping-notice-templates';
import {
  loadShippingNoticeTemplate, loadShippingNoticeTemplatePickerData, type ShippingNoticeTemplateOption,
} from '@/lib/admin/shipping-notice-templates.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export interface ShippingNoticeTemplateActionState extends AdminFormValuesState {
  errors?: Record<string, string>;
  /** 저장이 끝났다. 목록 위 결과 한 줄에 쓴다(`appliedGoods`는 이 저장이 안내를 바꾼 상품 수). */
  saved?: { id: string; name: string; created: boolean; appliedGoods: number };
  /** 다른 사람이 먼저 바꿨다. 입력은 그대로 두고 두 길(덮어쓰기·버리기)을 고르게 한다. */
  conflict?: boolean;
  /** 저장됐는지 모른다. 같은 작업 번호로 다시 보내면 두 번 저장되지 않는다. */
  uncertain?: boolean;
}

export type ShippingNoticeTemplateReadResult =
  | { ok: true; template: ShippingNoticeTemplate | null }
  | { ok: false; error: string };
export type ShippingNoticeTemplateOptionsResult =
  | { ok: true; options: ShippingNoticeTemplateOption[]; pendingCount: number }
  | { ok: false; error: string };
export type ShippingNoticeTemplateApplyActionResult =
  | { ok: true; result: ShippingNoticeTemplateApplyResult }
  | { ok: false; error: string };

const REQUIRED_MESSAGE = '배송 안내, 교환·반품 안내, 고객센터 이름, 고객센터 전화나 이메일을 모두 적은 뒤 다시 저장해 주세요.';
const NOT_FOUND_MESSAGE = '템플릿을 찾을 수 없습니다. 창을 닫고 목록을 새로고침해 주세요.';
const REOPEN_MESSAGE = '템플릿을 다시 열어 주세요. 창을 닫고 목록의 [수정]을 다시 누르면 됩니다.';
const READ_FAILED = '지금 저장된 템플릿을 읽지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
const OPTIONS_FAILED = '템플릿 목록을 새로 읽지 못했습니다.';
const APPLY_FAILED = '상품에 적용하지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
/* [상품에 적용] 창을 연 뒤 다른 사람이 그 템플릿을 고쳤다. 고치기 전 내용은 상품에 넣지 않는다. */
const TEMPLATE_CHANGED_MESSAGE = `${CHANGED_BY_OTHER} 창을 닫고 목록을 새로고침한 뒤 다시 적용해 주세요.`;
/* 템플릿 코드의 모양(DB 검사와 같다). 화면이 목록에서 받은 값을 그대로 돌려보낸다. */
const TEMPLATE_CODE = /^[a-z][a-z0-9-]{1,39}$/;
/*
 * 저장하지 않은 것이 분명한 오류(되돌려진 저장). 이 밖의 오류와 연결 실패는 저장됐는지 알 수 없다.
 * 40P01(교착)은 상품 여러 개를 한 번에 저장하는 작업(엑셀 일괄 등록 등)과 같은 템플릿의 저장이 겹쳤을 때 한쪽이 받는다 — 통째로 되돌려졌으니 다시 저장하면 된다.
 */
const DEFINITE_FAILURE_CODES = ['PT409', '23505', '23514', '22023', '42501', 'P0002', '28000', '40P01'];

function stringValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

/** 권한이 없으면 그 이유(문장), 있으면 null. 미로그인은 로그인으로 이동한다. */
async function accessError(pathname: string, capability?: 'catalog.read'): Promise<string | null> {
  try {
    return await requireAdminActionAccess(pathname, capability ? { capability } : {}) ? null : CATALOG_PERMISSION_MESSAGE;
  } catch (error) {
    unstable_rethrow(error);
    return '권한을 확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
  }
}

const definiteFailure = (error: { code?: string }) => DEFINITE_FAILURE_CODES.includes(error.code ?? '') || (error.code ?? '').startsWith('PGRST');

function saveValues(data: FormData): Record<string, string> {
  return Object.fromEntries(['id', 'updatedAt', 'operationId', ...SHIPPING_NOTICE_TEMPLATE_VALUE_KEYS].map((key) => [key, stringValue(data, key)]));
}

/**
 * 템플릿을 저장한다. 저장하면 바로 상품에서 고를 수 있고, 이 템플릿을 쓰는 상품의 안내도 같은 저장에서 새 내용으로 바뀐다
 * (admin_save_and_apply_shipping_notice_template — 하나라도 실패하면 아무것도 바뀌지 않는다).
 * 코드와 버전은 받지 않는다. `id`가 비어 있으면 새 템플릿이고, 있으면 화면이 연 줄(`updatedAt`은 그때의 시각)이다.
 */
export async function saveShippingNoticeTemplateAction(
  previous: ShippingNoticeTemplateActionState,
  data: FormData,
): Promise<ShippingNoticeTemplateActionState> {
  const values = saveValues(data);
  const attempt = nextFormAttempt(previous);
  const fail = (errors: Record<string, string>, more: Pick<ShippingNoticeTemplateActionState, 'conflict' | 'uncertain'> = {}): ShippingNoticeTemplateActionState => ({ errors, values, attempt, ...more });
  const denied = await accessError(SHIPPING_NOTICE_TEMPLATES_PATH);
  if (denied) return fail({ form: denied });
  if (values.id && (!isShippingNoticeTemplateId(values.id) || !values.updatedAt || Number.isNaN(Date.parse(values.updatedAt)))) return fail({ form: REOPEN_MESSAGE });
  if (!values.id && values.updatedAt) return fail({ form: REOPEN_MESSAGE });
  if (!isUuid(values.operationId)) return fail({ form: '화면을 새로고침한 뒤 다시 저장해 주세요.' });
  const parsed = parseShippingNoticeTemplateInput(values);
  if (!parsed.ok) return fail(parsed.errors);
  try {
    const supabase = await createClient();
    const { data: result, error } = await supabase.rpc('admin_save_and_apply_shipping_notice_template', {
      p_operation: values.operationId,
      p_template_id: values.id || null,
      p_expected_updated_at: values.updatedAt || null,
      p_name: parsed.value.name,
      p_shipping_notice: parsed.value.shipping_notice,
      p_return_exchange_notice: parsed.value.return_exchange_notice,
      p_remote_area_notice: parsed.value.remote_area_notice,
      p_cs_name: parsed.value.cs_name,
      p_cs_phone: parsed.value.cs_phone,
      p_cs_email: parsed.value.cs_email,
    });
    if (error) {
      if (!definiteFailure(error)) return fail({ form: SAVE_UNKNOWN_MESSAGE }, { uncertain: true });
      const message = error.message ?? '';
      if (message.includes('shipping_notice_template_operation_mismatch')) return fail({ form: SAVE_MISMATCH_MESSAGE });
      /* 고치는 중에 같은 버전이 먼저 생겼어도(23505) 다른 사람이 먼저 바꾼 것이다. */
      if (message.includes('shipping_notice_template_conflict') || (error.code === '23505' && values.id)) return fail({ form: CHANGED_BY_OTHER }, { conflict: true });
      if (message.includes('shipping_notice_template_not_found')) return fail({ form: NOT_FOUND_MESSAGE });
      if (message.includes('shipping_notice_template_required')) return fail({ form: REQUIRED_MESSAGE });
      if (message.includes('shipping_notice_template_version_exhausted')) return fail({ form: '이 템플릿은 더 고칠 수 없습니다. 같은 내용으로 새 템플릿을 등록해 주세요.' });
      if (message.includes('invalid_shipping_notice_template')) return fail({ form: '적은 내용을 저장할 수 없습니다. 칸마다 글자 수를 확인한 뒤 다시 저장해 주세요.' });
      if (error.code === '42501' || error.code === '28000') return fail({ form: CATALOG_PERMISSION_MESSAGE });
      return fail({ form: SAVE_FAILED_MESSAGE });
    }
    const saved = result as { id?: unknown; name?: unknown; created?: unknown; appliedGoods?: unknown } | null;
    const appliedGoods = Number(saved?.appliedGoods);
    if (!saved || typeof saved.id !== 'string' || !isUuid(saved.id) || typeof saved.name !== 'string'
      || typeof saved.created !== 'boolean' || !Number.isSafeInteger(appliedGoods) || appliedGoods < 0) {
      return fail({ form: SAVE_UNKNOWN_MESSAGE }, { uncertain: true });
    }
    revalidatePath(SHIPPING_NOTICE_TEMPLATES_PATH);
    revalidatePath('/admin/catalog/goods');
    /* 상품의 안내가 바뀌었으면 고객 화면(상품 상세)도 다시 그린다. */
    if (appliedGoods > 0) revalidateGoodsSurfaces();
    return { attempt, saved: { id: saved.id, name: saved.name, created: saved.created, appliedGoods } };
  } catch {
    return fail({ form: SAVE_UNKNOWN_MESSAGE }, { uncertain: true });
  }
}

/**
 * 템플릿 하나의 지금 저장된 내용과 쓰는 상품 수(읽기 전용). 편집 창이 저장 직전 확인창에 넣을 상품 수와,
 * 다른 사람이 먼저 바꿨을 때 보여 줄 지금 내용을 읽는다. `code`는 화면이 목록에서 받은 값이다.
 */
export async function readShippingNoticeTemplateAction(code: string): Promise<ShippingNoticeTemplateReadResult> {
  const denied = await accessError(SHIPPING_NOTICE_TEMPLATES_PATH);
  if (denied) return { ok: false, error: denied };
  if (typeof code !== 'string' || !TEMPLATE_CODE.test(code)) return { ok: false, error: READ_FAILED };
  try {
    return { ok: true, template: await loadShippingNoticeTemplate(code) };
  } catch {
    return { ok: false, error: READ_FAILED };
  }
}

/**
 * 상품등록의 [템플릿 고르기]가 창을 열 때 부르는 조회(읽기 전용). 다른 탭에서 방금 만든 템플릿도 새로고침 없이 보인다.
 * 권한은 상품 화면과 같다(상품 조회).
 */
export async function listShippingNoticeTemplateOptionsAction(): Promise<ShippingNoticeTemplateOptionsResult> {
  const denied = await accessError('/admin/catalog/goods', 'catalog.read');
  if (denied) return { ok: false, error: denied };
  try {
    return { ok: true, ...await loadShippingNoticeTemplatePickerData() };
  } catch {
    return { ok: false, error: OPTIONS_FAILED };
  }
}

interface ApplyGoodRow { id: string; name: string; updated_at: string; archived_at: string | null; shipping_notice_template_id: string | null }

/**
 * 고른 상품들에 이 템플릿을 적용한다. 상품마다 지금의 적용 함수(admin_apply_shipping_notice_template)를 부르고
 * 된 것·이미 쓰던 것·안 된 것을 나눠 돌려준다. 보관한 상품과 그사이 다른 사람이 고친 상품은 건너뛴다.
 * `template`은 화면이 연 줄이다. 그 줄이 지금도 이 템플릿의 최신 내용일 때만 적용한다 — 판정은 적용 함수가 상품마다 한다
 * (템플릿 저장과 줄을 선 뒤 다시 읽어, 아니면 shipping_notice_template_conflict로 거절). 여기서 먼저 읽는 것은 빨리 알리기 위해서다.
 * `goods`의 이름은 결과 문장에만 쓴다(찾지 못한 상품을 번호 대신 이름으로 말한다).
 */
export async function applyShippingNoticeTemplateToGoodsAction(
  template: { id: string; code: string },
  goods: readonly { id: string; name: string }[],
): Promise<ShippingNoticeTemplateApplyActionResult> {
  const denied = await accessError(SHIPPING_NOTICE_TEMPLATES_PATH);
  if (denied) return { ok: false, error: denied };
  const picked = Array.isArray(goods) ? goods.filter((good) => good && typeof good.id === 'string' && good.id.length > 0 && good.id.length <= 200) : [];
  const ids = [...new Set(picked.map((good) => good.id))];
  const templateId = typeof template?.id === 'string' ? template.id : '', code = typeof template?.code === 'string' ? template.code : '';
  if (!isShippingNoticeTemplateId(templateId) || !TEMPLATE_CODE.test(code)) return { ok: false, error: REOPEN_MESSAGE };
  if (!ids.length) return { ok: false, error: '적용할 상품을 먼저 골라 주세요.' };
  if (ids.length > SHIPPING_NOTICE_TEMPLATE_APPLY_MAX) return { ok: false, error: `한 번에 ${SHIPPING_NOTICE_TEMPLATE_APPLY_MAX}개까지 적용할 수 있습니다. 나눠서 적용해 주세요.` };
  const typedName = new Map(picked.map((good) => [good.id, typeof good.name === 'string' && good.name.trim() ? good.name.trim().slice(0, 80) : '이름 없는 상품']));
  const result: ShippingNoticeTemplateApplyResult = { applied: 0, unchanged: 0, failed: [] };
  try {
    /* 화면이 연 줄이 지금도 이 템플릿의 최신 내용인지 먼저 본다(빠른 안내). 이 확인 뒤에 고쳐진 경우는 아래 적용 함수가 거절한다. */
    const latest = await loadShippingNoticeTemplate(code);
    if (!latest) return { ok: false, error: NOT_FOUND_MESSAGE };
    if (latest.id !== templateId) return { ok: false, error: TEMPLATE_CHANGED_MESSAGE };
    const supabase = await createClient();
    const { data, error } = await supabase.from('goods')
      .select('id,name,updated_at,archived_at,shipping_notice_template_id').in('id', ids);
    if (error) return { ok: false, error: APPLY_FAILED };
    const rows = new Map(((data ?? []) as ApplyGoodRow[]).map((row) => [row.id, row]));
    for (const id of ids) {
      const row = rows.get(id);
      if (!row) { result.failed.push({ name: typedName.get(id) ?? '이름 없는 상품', reason: '찾을 수 없는 상품' }); continue; }
      if (row.archived_at) { result.failed.push({ name: row.name, reason: '보관한 상품' }); continue; }
      if (row.shipping_notice_template_id === templateId) { result.unchanged += 1; continue; }
      const { error: applyError } = await supabase.rpc('admin_apply_shipping_notice_template', {
        target_good_id: id,
        target_template_id: templateId,
        expected_good_updated_at: row.updated_at,
      });
      if (!applyError) { result.applied += 1; continue; }
      const message = applyError.message ?? '';
      /* 템플릿 자체의 문제는 어느 상품이든 같으므로 여기서 멈춘다. 적용하는 사이 다른 사람이 템플릿을 고쳤으면(conflict) 남은 상품에도 넣지 않는다 —
         먼저 적용한 상품은 그 저장이 새 내용으로 함께 바꿨다. */
      if (message.includes('shipping_notice_template_conflict')) return finishApply(result, TEMPLATE_CHANGED_MESSAGE);
      if (message.includes('shipping_notice_template_not_active')) return finishApply(result, '준비 중인 템플릿은 상품에 적용할 수 없습니다. 먼저 [수정]을 눌러 저장해 주세요.');
      if (message.includes('shipping_notice_template_not_found')) return finishApply(result, NOT_FOUND_MESSAGE);
      if (applyError.code === '42501' || applyError.code === '28000') return finishApply(result, CATALOG_PERMISSION_MESSAGE);
      result.failed.push({
        name: row.name,
        reason: message.includes('good_shipping_notice_conflict') ? '다른 사람이 방금 고친 상품'
          : message.includes('good_archived') ? '보관한 상품'
            : message.includes('good_not_found') ? '찾을 수 없는 상품' : '적용하지 못함',
      });
    }
    return finishApply(result);
  } catch {
    return finishApply(result, APPLY_FAILED);
  }
}

/**
 * 적용한 상품이 있으면 화면을 다시 그리게 한 뒤 결과를 돌려준다.
 * `stopped`는 중간에 멈춘 이유다. 하나도 적용하지 못했으면 그 이유를 오류로, 일부를 적용했으면 멈췄다는 표시를 결과에 실어 돌려준다(이미 적용한 상품은 남는다).
 */
function finishApply(result: ShippingNoticeTemplateApplyResult, stopped?: string): ShippingNoticeTemplateApplyActionResult {
  if (result.applied > 0) {
    revalidatePath(SHIPPING_NOTICE_TEMPLATES_PATH);
    revalidateGoodsSurfaces();
  }
  if (stopped && result.applied === 0) return { ok: false, error: stopped };
  return { ok: true, result: stopped ? { ...result, stopped: true } : result };
}
