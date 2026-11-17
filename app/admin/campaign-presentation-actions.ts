'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { CAMPAIGN_PRESENTATION_MESSAGES, normalizeCampaignPresentationInput } from '@/lib/campaign-presentation';
import { createClient } from '@/lib/supabase/server';

/* 캠페인 노출 설정 저장 액션(스펙 C §2.8). 캠페인 본문 저장(campaign-actions)과 별개로 저장한다 —
 * 서로 다른 설정이라 한쪽이 실패해도 다른 쪽은 그대로다.
 *
 * 검증·권한·감사의 진실원은 admin_save_campaign_presentation(security definer, promotion.manage)이고,
 * 여기서는 폼 정규화(lib/campaign-presentation)와 오류 번역·재검증만 한다. 권한은 RPC 안에도 한 번 더 있다. */

export interface AdminCampaignPresentationActionState {
  errors?: Partial<Record<'popupMode' | 'popupLocation' | 'cardLinkPath' | 'form', string>>;
  message?: string;
}

const CAMPAIGNS_PATH = '/admin/display/campaigns';

/* 'use server' 파일은 비동기 함수 외의 값을 내보낼 수 없다 — 문구는 이 파일 안에서만 쓴다. */
const CAMPAIGN_PRESENTATION_RESULT_MESSAGES = {
  saved: '노출 설정을 저장했습니다.',
  forbidden: '이 작업을 할 권한이 없습니다.',
  campaignMissing: '먼저 캠페인을 저장해주세요.',
  failed: '노출 설정을 저장하지 못했습니다. 다시 시도해주세요.',
} as const;

async function requireStaffAction(): Promise<AdminCampaignPresentationActionState | null> {
  if (!await requireAdminActionAccess(CAMPAIGNS_PATH, { capability: 'promotion.manage' })) {
    return { errors: { form: CAMPAIGN_PRESENTATION_RESULT_MESSAGES.forbidden } };
  }
  return null;
}

function formText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** RPC 오류를 운영자 언어로 옮긴다. SQLSTATE 가 우선이고, 없으면 오류 이름(message)으로 본다. */
function presentationWriteFailure(error: { code?: string | null; message?: string | null }): AdminCampaignPresentationActionState {
  const code = error.code ?? '';
  const message = error.message ?? '';
  if (code === '42501' || code === '28000' || message.includes('forbidden') || message.includes('auth_required')) {
    return { errors: { form: CAMPAIGN_PRESENTATION_RESULT_MESSAGES.forbidden } };
  }
  if (code === 'P0002' || message.includes('campaign_not_found')) {
    return { errors: { form: CAMPAIGN_PRESENTATION_RESULT_MESSAGES.campaignMissing } };
  }
  /* 화면 검증을 지나 DB 형식 제약에 걸린 값. 칸이 셋이라 어느 칸인지 알 수 없지만 가장 흔한 원인은 바로가기 주소다. */
  if (code === '22023' || message.includes('invalid_campaign_presentation')) {
    return { errors: { cardLinkPath: CAMPAIGN_PRESENTATION_MESSAGES.cardLinkFormat } };
  }
  return { errors: { form: CAMPAIGN_PRESENTATION_RESULT_MESSAGES.failed } };
}

/** 노출 설정은 EVENT·POP-UP 목록, 두 상세, 홈 큐레이션에 보인다. 상세는 동적 세그먼트라 방금 고친 캠페인 경로를 지정해 만료시킨다. */
function revalidatePresentationSurfaces(campaignId: string) {
  revalidatePath('/events');
  revalidatePath('/popups');
  revalidatePath(`/events/${campaignId}`);
  revalidatePath(`/popups/${campaignId}`);
  revalidatePath('/');
  revalidatePath(CAMPAIGNS_PATH);
}

export async function saveAdminCampaignPresentationAction(
  _state: AdminCampaignPresentationActionState,
  formData: FormData,
): Promise<AdminCampaignPresentationActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const campaignId = formText(formData, 'campaignId').trim();
  if (!campaignId) return { errors: { form: CAMPAIGN_PRESENTATION_RESULT_MESSAGES.campaignMissing } };

  const result = normalizeCampaignPresentationInput({
    popupMode: formText(formData, 'popupMode'),
    popupLocation: formText(formData, 'popupLocation'),
    cardLinkPath: formText(formData, 'cardLinkPath'),
  });
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_save_campaign_presentation', {
    target_campaign_id: campaignId,
    target_popup_mode: result.value.popupMode,
    target_popup_location: result.value.popupLocation,
    target_card_link_path: result.value.cardLinkPath,
  });
  if (error) return presentationWriteFailure(error);

  revalidatePresentationSurfaces(campaignId);
  return { message: CAMPAIGN_PRESENTATION_RESULT_MESSAGES.saved };
}
