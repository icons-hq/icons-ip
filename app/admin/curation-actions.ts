'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  normalizeAdminCurationForm,
  type AdminCurationActionState,
} from '@/lib/admin/curations';
import { hasAdminCapability } from '@/lib/admin/access';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { NOTICE_STRIP_CACHE_TAG } from '@/lib/notice-strip.server';
import { createClient } from '@/lib/supabase/server';

const SAVE_ERROR = '홈 큐레이션을 저장하지 못했습니다. 다시 시도해주세요.';
const UNCERTAIN_ERROR = '저장 결과를 확인하지 못했습니다. 입력한 내용을 유지한 채 같은 요청 결과를 확인해주세요.';

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

export async function upsertAdminCurationAction(
  _state: AdminCurationActionState,
  formData: FormData,
): Promise<AdminCurationActionState> {
  const normalized = normalizeAdminCurationForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return { errors: { form: SAVE_ERROR } };
  }
  if (!auth.isConfigured) return { errors: { form: SAVE_ERROR } };
  if (!auth.user) redirect(loginPath());
  if (!auth.isStaff || !hasAdminCapability(auth, 'store.manage')) return { errors: { form: '관리자 권한이 필요합니다.' } };

  const value = normalized.value;
  let error: unknown;
  try {
    const supabase = await createClient();
    ({ error } = await supabase.rpc('admin_save_home_curation', {
      target_operation_id: value.operationId,
      target_curation_id: value.id,
      target_kind: value.kind,
      target_ip_id: value.ipId,
      target_title: value.title,
      target_image_path: value.imagePath,
      target_link_path: value.linkPath,
      target_display_order: value.displayOrder,
      target_active_from: value.activeFrom,
      target_active_to: value.activeTo,
      target_enabled: value.enabled,
      target_slot: value.slot,
      target_payload: value.payload,
      target_expected_updated_at: value.expectedUpdatedAt,
    }));
  } catch {
    return { errors: { form: UNCERTAIN_ERROR }, uncertain: true };
  }
  if (error) {
    const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
    if (message.includes('mosaic_image_too_large')) return { errors: { mosaic: '모자이크 원본과 저장 이미지는 각각 900KB 이하여야 합니다. 더 작은 이미지로 등록해주세요.' } };
    if (message.includes('home_mosaic_limit')) return { errors: { mosaic: '자유상품 모자이크는 최대 5개까지 등록할 수 있습니다. 기존 구성을 수정해주세요.' } };
    if (message.includes('home_free_product_limit')) return { errors: { form: '리스트·풀이미지·모자이크는 비노출과 종료를 포함해 합계 5개까지 등록할 수 있습니다. 기존 구성을 수정해주세요.' } };
    if (message.includes('curation_kind_change_not_allowed')) return { errors: { kind: '저장된 자유상품과 다른 종류의 구성은 서로 변환할 수 없습니다. 새 구성을 추가해주세요.' } };
    if (message.includes('home_hero_limit')) return { errors: { form: '프로모션 배너는 비노출을 포함해 최대 10개까지 등록할 수 있습니다. 기존 배너를 수정해주세요.' } };
    if (message.includes('curation_archived')) return { errors: { form: '삭제된 배너입니다. 입력은 유지합니다. 최신 목록을 불러오고 삭제한 배너에서 복구한 뒤 편집해주세요.' }, conflict: true };
    if (message.includes('curation_conflict') || message.includes('operation_conflict')) return { errors: { form: '다른 저장이 먼저 반영되었습니다. 입력은 유지합니다. 최신 저장본을 불러온 뒤 다시 편집해주세요.' }, conflict: true };
    if (message.includes('invalid_hero_title')) return { errors: { title: '변경한 제목은 40자 이하로 입력해주세요. 기존 제목은 그대로 유지할 수 있습니다.' } };
    if (message.includes('invalid_hero_subtitle')) return { errors: { subtitle: '변경한 내용은 150자 이하, 최대 3줄로 입력해주세요.' } };
    if (message.includes('invalid_hero_alt')) return { errors: { altTitle: '대체텍스트 제목 40자·내용 150자와 설정 여부를 확인해주세요.' } };
    if (message.includes('invalid_curation_notice')) return { errors: { form: '텍스트 공지 바·띠배너의 문구, 버튼 문구와 공지를 보일 화면을 확인해주세요.' } };
    if (message.includes('invalid_curation_collection_banner')) return { errors: { form: '컬렉션 배너의 문구(40자)·부제(80자)·이미지 대체텍스트(100자)와 딤·텍스트 색상을 확인해주세요.' } };
    if (message.includes('invalid_curation_search_terms')) return { errors: { searchTerms: '추천 검색어는 줄바꿈 없이 1~20자로, 겹치지 않게 1~10개 입력해주세요.' } };
    if (message.includes('invalid_curation_slot')) return { errors: { slot: '배너를 보일 컬렉션 또는 상품 모음 위치를 다시 선택해주세요.' } };
    if (/forbidden|auth_required|operator_/.test(message)) return { errors: { form: '현재 스토어 관리 권한을 확인해주세요.' } };
    if (/invalid_|unverified_artwork|curation_image_required|catalog_item_archived|curation_ip_not_found/.test(message)) return { errors: { form: SAVE_ERROR } };
    return { errors: { form: UNCERTAIN_ERROR }, uncertain: true };
  }

  revalidatePath('/');
  revalidatePath('/admin');
  /* 컬렉션 배너(굿즈샵·BEST·NEW)와 추천 검색어(셸)도 아래 태그로 읽는다(lib/collection-banners.server · lib/search-terms.server). */
  revalidatePath('/admin/display/curations');
  /*
   * 셸 공지(텍스트 공지 바·띠배너)는 전역 셸이 unstable_cache 로 읽는다 — 경로 재검증만으로는 늦는다.
   * Next 16 의 revalidateTag 는 cacheLife 프로필을 요구하고 'max' 는 stale-while-
   * revalidate 라 저장한 운영자가 옛 스트립을 한 번 더 본다. 서버 액션 전용
   * updateTag 가 즉시 만료(read-your-own-writes)라서 이쪽을 쓴다.
   */
  updateTag(NOTICE_STRIP_CACHE_TAG);
  return { message: '홈 큐레이션을 저장했습니다.' };
}
