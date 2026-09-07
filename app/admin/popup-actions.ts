'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { POPUPS_CACHE_TAG, popupCacheTag } from '@/lib/popups';
import { createClient } from '@/lib/supabase/server';

/* 팝업 편성 액션 (설계서 v2 §1-8). */

const POPUPS_PATH = '/admin/popups';

export interface AdminPopupActionState {
  error?: string;
  message?: string;
}

async function requireStaff(): Promise<AdminPopupActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isStaff) return { error: '권한이 없습니다.' };
  return null;
}

function popupErrorMessage(raw: string) {
  if (raw.includes('invalid_popup_id')) return '주소로 쓸 수 있는 값이 아닙니다 (소문자·숫자·하이픈).';
  if (raw.includes('invalid_popup_period')) return '종료가 시작보다 뒤여야 합니다.';
  if (raw.includes('invalid_popup_status')) return '상태 값을 확인해주세요.';
  if (raw.includes('published_without_phases')) return '페이즈를 하나 이상 만든 뒤에 게시할 수 있습니다.';
  if (raw.includes('catalog_id_taken')) return '이미 기획전·이벤트가 쓰는 주소입니다.';
  if (raw.includes('catalog_id_immutable')) return '주소는 바꿀 수 없습니다. 이미 나간 링크가 있을 수 있습니다.';
  if (raw.includes('catalog_record_missing')) return '팝업을 찾을 수 없습니다.';
  if (raw.includes('popup_ip_missing')) return 'IP를 찾을 수 없습니다.';
  if (raw.includes('phases_overlap') || raw.includes('exclusion')) return '페이즈 시간이 겹칩니다. 한 시각에 페이즈는 하나여야 합니다.';
  if (raw.includes('phase_outside_popup')) return '페이즈가 팝업 기간을 벗어납니다.';
  if (raw.includes('stale_write')) return '다른 사람이 먼저 저장했습니다. 새로고침한 뒤 다시 시도해주세요.';
  if (raw.includes('invalid_phases')) return '페이즈 입력을 확인해주세요.';
  if (raw.includes('unknown_target')) return '연결할 대상을 찾을 수 없습니다 (보관·삭제된 원본은 걸 수 없습니다).';
  if (raw.includes('unknown_zone')) return '존 코드를 찾을 수 없습니다.';
  if (raw.includes('unknown_phase_key')) return '페이즈 키를 찾을 수 없습니다.';
  if (raw.includes('too_many_links')) return '연결은 200개까지입니다.';
  if (raw.includes('staff required') || raw.includes('forbidden')) return '권한이 없습니다.';
  return '저장하지 못했습니다. 최신 상태를 확인해주세요.';
}

/** 저장 뒤에는 목록과 그 팝업의 캐시를 즉시 버린다 — 저장한 사람이 옛 화면을 보면 안 된다. */
function invalidate(popupId: string) {
  updateTag(POPUPS_CACHE_TAG);
  updateTag(popupCacheTag(popupId));
  revalidatePath(POPUPS_PATH);
  revalidatePath(`${POPUPS_PATH}/${popupId}`);
}

/** 폼의 KST 입력(`YYYY-MM-DDTHH:mm`)을 고정 오프셋으로 못 박는다 — 서버 타임존에 기대지 않는다. */
function kstInstant(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return null;
  return `${trimmed}:00+09:00`;
}

export async function upsertPopupAction(
  _state: AdminPopupActionState,
  formData: FormData,
): Promise<AdminPopupActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const id = String(formData.get('id') ?? '').trim();
  const startsAt = kstInstant(String(formData.get('startsAt') ?? ''));
  const endsAt = kstInstant(String(formData.get('endsAt') ?? ''));
  if (!id) return { error: '주소(슬러그)를 적어주세요.' };
  if (!startsAt || !endsAt) return { error: '시작·종료 시각을 적어주세요.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_popup', {
    target_card_image_path: String(formData.get('cardImagePath') ?? '').trim() || null,
    target_ends_at: endsAt,
    target_hero_image_path: String(formData.get('heroImagePath') ?? '').trim() || null,
    target_id: id,
    target_ip_id: String(formData.get('ipId') ?? '').trim(),
    target_previous_id: String(formData.get('previousId') ?? '').trim() || null,
    target_starts_at: startsAt,
    target_status: String(formData.get('status') ?? 'draft').trim(),
    target_subtitle: String(formData.get('subtitle') ?? '').trim() || null,
    target_title: String(formData.get('title') ?? '').trim(),
  });
  if (error) return { error: popupErrorMessage(error.message) };

  invalidate(id);
  return { message: '팝업을 저장했습니다.' };
}

/** 페이즈 표를 통째로 저장한다. 폼은 `phase:<n>:<칸>` 으로 줄을 보낸다. */
export async function savePopupPhasesAction(
  _state: AdminPopupActionState,
  formData: FormData,
): Promise<AdminPopupActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const popupId = String(formData.get('popupId') ?? '').trim();
  if (!popupId) return { error: '팝업을 찾을 수 없습니다.' };

  const rows = new Map<string, Record<string, string>>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('phase:') || typeof value !== 'string') continue;
    const [, index, field] = key.split(':');
    const row = rows.get(index) ?? {};
    row[field] = value.trim();
    rows.set(index, row);
  }

  const phases: Record<string, unknown>[] = [];
  for (const [index, row] of [...rows.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (!row.key) continue;
    const startsAt = kstInstant(row.startsAt ?? '');
    const endsAt = kstInstant(row.endsAt ?? '');
    if (!startsAt || !endsAt) return { error: `페이즈 「${row.key}」의 시각을 확인해주세요.` };
    phases.push({
      default_sale_mode: row.defaultSaleMode || 'on_sale',
      ends_at: endsAt,
      key: row.key,
      label: row.label || row.key,
      sort: Number(index),
      starts_at: startsAt,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_popup_phases', {
    target_expected_updated_at: String(formData.get('expectedUpdatedAt') ?? '').trim() || null,
    target_phases: phases,
    target_popup_id: popupId,
  });
  if (error) return { error: popupErrorMessage(error.message) };

  invalidate(popupId);
  return { message: `페이즈 ${phases.length}개를 저장했습니다.` };
}

export async function linkPopupTargetAction(
  _state: AdminPopupActionState,
  formData: FormData,
): Promise<AdminPopupActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const popupId = String(formData.get('popupId') ?? '').trim();
  const targetType = String(formData.get('targetType') ?? '').trim();
  const targetId = String(formData.get('targetId') ?? '').trim();
  if (!popupId || !targetType || !targetId) return { error: '연결할 대상을 적어주세요.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_link_popup_targets', {
    target_links: [{
      default_sale_mode: String(formData.get('defaultSaleMode') ?? '').trim() || null,
      target_id: targetId,
      target_type: targetType,
      zone_code: String(formData.get('zoneCode') ?? '').trim() || null,
    }],
    target_popup_id: popupId,
    /* 한 줄만 더하는 폼이라 나머지를 지우지 않는다. */
    target_replace: false,
  });
  if (error) return { error: popupErrorMessage(error.message) };

  invalidate(popupId);
  return { message: '연결했습니다.' };
}

export async function setPopupLinkRuleAction(
  _state: AdminPopupActionState,
  formData: FormData,
): Promise<AdminPopupActionState> {
  const denied = await requireStaff();
  if (denied) return denied;

  const popupId = String(formData.get('popupId') ?? '').trim();
  const targetType = String(formData.get('targetType') ?? '').trim();
  const targetId = String(formData.get('targetId') ?? '').trim();
  const zoneCode = String(formData.get('zoneCode') ?? '').trim() || null;
  const defaultSaleMode = String(formData.get('defaultSaleMode') ?? '').trim() || null;
  if (!popupId || !targetType || !targetId) return { error: '연결을 찾을 수 없습니다.' };

  /* 규칙은 이 연결의 것을 통째로 다시 보낸다 — 부분 수정은 「지운 규칙이 남는」 길이다. */
  const rules: { phase_key: string; sale_mode: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('rule:') || typeof value !== 'string' || !value) continue;
    rules.push({ phase_key: key.slice(5), sale_mode: value });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_link_popup_targets', {
    target_links: [{
      default_sale_mode: defaultSaleMode,
      phase_rules: rules,
      target_id: targetId,
      target_type: targetType,
      zone_code: zoneCode,
    }],
    target_popup_id: popupId,
    target_replace: false,
  });
  if (error) return { error: popupErrorMessage(error.message) };

  invalidate(popupId);
  return { message: '판매 규칙을 저장했습니다.' };
}
