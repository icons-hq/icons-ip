'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  normalizeAdminCampaignForm,
  normalizeAdminCoinExchangeOfferForm,
} from '@/lib/admin/campaigns';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/* 캠페인·카드팩 교환처 저장 액션 (S8 #330).
 *
 * 검증·감사·슬러그 계약은 admin_upsert_campaign / admin_upsert_coin_exchange_offer
 * (security definer)가 진실원이고, 여기서는 폼 정규화와 에러 번역만 한다.
 * 권한 판정도 RPC 안에 한 번 더 있다 — 여기서만 막으면 액션을 새로 만드는 사람이
 * 게이트를 빠뜨린다. */

export interface AdminCampaignActionState {
  errors?: Record<string, string> & { form?: string };
  message?: string;
}

const CAMPAIGNS_PATH = '/admin/display/campaigns';
const CAMPAIGN_SAVE_FAILED = '캠페인을 저장하지 못했습니다. 다시 시도해주세요.';
const OFFER_SAVE_FAILED = '교환처를 저장하지 못했습니다. 다시 시도해주세요.';

async function requireStaffAction(): Promise<AdminCampaignActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(CAMPAIGNS_PATH)}`);
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

/**
 * 공개 캠페인 표면을 다시 그린다.
 *
 * 상세는 동적 세그먼트라 경로 하나로는 닿지 않는다 — 방금 고친 캠페인만 지우면
 * 종료 처리한 다른 캠페인의 캐시가 남으므로 라우트 단위로 만료시킨다.
 */
function revalidateCampaignSurfaces() {
  revalidatePath('/events');
  revalidatePath('/events/[eventId]', 'page');
  revalidatePath(CAMPAIGNS_PATH);
}

/* 신규 등록이 기존 레코드를 덮어쓰지 못하게 막은 RPC의 응답을 운영자 언어로 옮긴다.
   invalid_sections 의 DETAIL(어느 블록의 어느 키인지)은 supabase-js 가 details 로
   따로 실어 주므로, 사유 문구 뒤에 그대로 붙여 준다 — 20블록짜리 JSON에서 "스키마에
   맞지 않아요"만 받으면 어디를 고쳐야 하는지 알 수 없다. */
function campaignWriteFailure(
  message: string,
  details: string | null | undefined,
): AdminCampaignActionState | null {
  if (message.includes('catalog_id_taken')) {
    return { errors: { id: '이미 사용 중인 ID예요(오프라인 팝업 ID와도 겹칠 수 없어요).' } };
  }
  if (message.includes('catalog_record_missing')) {
    return { errors: { form: '수정할 캠페인을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.' } };
  }
  if (message.includes('catalog_id_immutable')) {
    return { errors: { id: '등록된 캠페인 ID는 변경할 수 없습니다.' } };
  }
  if (message.includes('invalid_sections')) {
    const hint = details?.trim();
    return {
      errors: {
        sections: hint
          ? `랜딩 구성 JSON이 스키마에 맞지 않아요 (${hint}).`
          : '랜딩 구성 JSON이 스키마에 맞지 않아요.',
      },
    };
  }
  /* 쿠폰 코드는 jsonb 안이라 FK 로 묶이지 않는다 — RPC 가 저장 시점에 실재를
     확인하고, 여기서는 "코드를 먼저 등록하라"는 다음 행동으로 옮긴다. */
  if (message.includes('unknown_coupon_code')) {
    return { errors: { sections: '쿠폰 섹션의 코드가 쿠폰 관리에 등록되어 있지 않아요.' } };
  }
  if (message.includes('invalid_campaign_id')) {
    return { errors: { id: 'ID는 소문자·숫자·하이픈 2~64자로 입력해주세요.' } };
  }
  if (message.includes('invalid_campaign_kind')) {
    return { errors: { kind: '캠페인 종류를 선택해주세요.' } };
  }
  if (message.includes('invalid_campaign_title')) {
    return { errors: { title: '제목은 1~120자로 입력해주세요.' } };
  }
  if (message.includes('invalid_campaign_status')) {
    return { errors: { status: '상태를 선택해주세요.' } };
  }
  if (message.includes('invalid_campaign_period')) {
    return { errors: { endsAt: '종료 시각은 시작 시각보다 뒤여야 합니다.' } };
  }
  if (message.includes('invalid_campaign_featured_order')) {
    return { errors: { featuredOrder: '배너 순서는 1 이상의 정수여야 합니다.' } };
  }
  if (message.includes('forbidden') || message.includes('auth_required')) {
    return { errors: { form: '관리자 권한이 필요합니다.' } };
  }
  return null;
}

export async function upsertAdminCampaignAction(
  _state: AdminCampaignActionState,
  formData: FormData,
): Promise<AdminCampaignActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const result = normalizeAdminCampaignForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_campaign', {
    target_banner_image_path: result.value.bannerImagePath,
    target_card_image_path: result.value.cardImagePath,
    target_ends_at: result.value.endsAt,
    target_featured_order: result.value.featuredOrder,
    target_hero_image_path: result.value.heroImagePath,
    target_id: result.value.id,
    target_kind: result.value.kind,
    target_previous_id: result.value.previousId,
    target_sections: result.value.sections,
    target_starts_at: result.value.startsAt,
    target_status: result.value.status,
    target_subtitle: result.value.subtitle,
    target_title: result.value.title,
  });

  if (error) {
    return campaignWriteFailure(error.message, error.details)
      ?? { errors: { form: CAMPAIGN_SAVE_FAILED } };
  }

  revalidateCampaignSurfaces();
  return { message: `${result.value.title} 캠페인을 저장했습니다.` };
}

function offerWriteFailure(message: string): AdminCampaignActionState | null {
  if (message.includes('pool_not_found')) {
    return { errors: { poolId: '카드풀을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해주세요.' } };
  }
  if (message.includes('catalog_record_missing')) {
    return { errors: { form: '수정할 교환처를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.' } };
  }
  if (message.includes('invalid_offer_label')) {
    return { errors: { label: '이름은 1~80자로 입력해주세요.' } };
  }
  if (message.includes('invalid_offer_coin_cost')) {
    return { errors: { coinCost: '코인 비용은 1~100,000 사이의 정수여야 합니다.' } };
  }
  if (message.includes('invalid_offer_ticket_count')) {
    return { errors: { ticketCount: '카드팩 수량은 1~10장이어야 합니다.' } };
  }
  if (message.includes('invalid_offer_status')) {
    return { errors: { status: '노출 상태를 선택해주세요.' } };
  }
  if (message.includes('forbidden') || message.includes('auth_required')) {
    return { errors: { form: '관리자 권한이 필요합니다.' } };
  }
  return null;
}

export async function upsertAdminCoinExchangeOfferAction(
  _state: AdminCampaignActionState,
  formData: FormData,
): Promise<AdminCampaignActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const result = normalizeAdminCoinExchangeOfferForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_coin_exchange_offer', {
    target_coin_cost: result.value.coinCost,
    target_id: result.value.id,
    target_label: result.value.label,
    target_pool_id: result.value.poolId,
    target_status: result.value.status,
    target_ticket_count: result.value.ticketCount,
  });

  if (error) {
    return offerWriteFailure(error.message) ?? { errors: { form: OFFER_SAVE_FAILED } };
  }

  /* 교환처는 캠페인 상세의 exchange 블록이 읽는다 — 코인 비용을 고쳤는데 상세가
     옛 값을 보여 주면 운영자는 저장이 안 된 줄 안다. */
  revalidateCampaignSurfaces();
  return { message: `${result.value.label} 교환처를 저장했습니다.` };
}
