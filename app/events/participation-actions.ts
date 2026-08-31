'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ACCOUNT_SUSPENDED_PATH,
  isAccountSuspended,
  isOnboarded,
  onboardingPath,
  safeNextPath,
} from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';

/* 캠페인 참여 액션 — 출석 체크 · 카드팩 교환 (S8 #330).
 *
 * 신규 파일이다. 기존 events 계열 액션 계약을 건드리지 않는다.
 *
 * 적립·차감·발급은 전부 RPC(security definer) 안에서 일어난다. 여기서는 세 가지만
 * 한다: 보호 액션 게이트(로그인·정지·온보딩), 멱등 키 전달, 에러 문구 번역.
 * 잔액 비교나 "오늘 출석했는지" 판정을 여기로 옮기면, 화면이 통과시킨 요청을 DB가
 * 거절하는 순간 두 판정이 갈라진 채로 남는다.
 *
 * 어휘 규율: 사용자-facing 문구에 '가챠·뽑기·충전' 을 쓰지 않는다(CONTEXT.md).
 * 뽑기권의 UI 표기는 "카드팩"이다. */

const PACKS_PATH = '/packs';

const ATTENDANCE_FALLBACK = '출석 체크를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';
const EXCHANGE_FALLBACK = '카드팩 교환을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParticipationActionState {
  status?: 'success' | 'error';
  message?: string;
}

interface ParticipationRpcResult {
  status?: string;
  balance?: number;
  issued_count?: number;
}

function loginPath(next: string) {
  return `/login?next=${encodeURIComponent(safeNextPath(next))}`;
}

/* app/my/reviews/actions.ts 의 3단 게이트와 같은 순서·같은 목적지다. 그 함수는
   /my 전용 모듈의 비공개 헬퍼라 임포트할 수 없어 여기서 같은 규칙을 다시 쓴다 —
   순서가 갈리면 정지된 계정이 온보딩 화면으로 새는 식으로 어긋난다. */
async function requireActiveUser(next: string) {
  const auth = await getCurrentAuthState();

  if (!auth.isConfigured || !auth.user) redirect(loginPath(next));
  if (isAccountSuspended(auth.profile)) redirect(ACCOUNT_SUSPENDED_PATH);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  return auth.user;
}

function readUuid(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function readNext(formData: FormData): string {
  return safeNextPath(formData.get('next'));
}

/* RPC 예외 메시지 → 참여자 언어. lib/draw-tickets.ts 의 includes 관례를 따른다 —
   PostgREST 는 raise 문구를 그대로 message 에 실어 보낸다. */
function mapParticipationError(message: string | null | undefined, fallback: string): string {
  const value = (message ?? '').toLowerCase();

  if (value.includes('insufficient_coins')) return '코인이 부족해요.';
  if (value.includes('offer_unavailable')) return '지금은 교환할 수 없는 상품이에요.';
  /* 전역 카드 리워드 게이트가 내려간 상태다. RPC 가 코인 차감까지 되돌린 뒤
     던지므로 "다시 시도"는 안전한 안내다. */
  if (value.includes('card_rewards_disabled')) {
    return '카드팩 교환을 준비하고 있어요. 잠시 후 다시 시도해 주세요.';
  }
  if (value.includes('reward_pool_not_ready') || value.includes('pool_not_found')) {
    return '지금은 교환할 수 없는 상품이에요.';
  }
  if (value.includes('account_suspended')) return '정지된 계정은 이벤트에 참여할 수 없어요.';
  if (value.includes('exchange_operation_conflict') || value.includes('invalid_operation')) {
    return fallback;
  }
  return fallback;
}

/** 출석 체크 — 하루 1회, 코인 1개. 하루 경계는 RPC가 Asia/Seoul 로 판정한다. */
export async function attendanceCheckInAction(
  _state: ParticipationActionState,
  formData: FormData,
): Promise<ParticipationActionState> {
  const next = readNext(formData);
  await requireActiveUser(next);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_check_in');

  if (error) {
    return { status: 'error', message: mapParticipationError(error.message, ATTENDANCE_FALLBACK) };
  }

  const result = (data ?? {}) as ParticipationRpcResult;
  const balance = typeof result.balance === 'number' ? result.balance : 0;

  /* 잔액이 바뀌었으니 같은 페이지의 코인 박스·출석 패널을 다시 그린다. 이미 출석한
     경우에도 revalidate 한다 — 다른 탭에서 적립한 결과가 이 페이지에는 아직 반영되지
     않았을 수 있고, 그 상태로 두면 "이미 출석했어요"와 옛 잔액이 함께 남는다. */
  revalidatePath(next);

  if (result.status === 'already_checked') {
    return { status: 'success', message: `오늘은 이미 출석했어요. 지금 코인 ${balance}개예요.` };
  }

  return { status: 'success', message: `출석 완료! 코인 1개를 적립했어요. 지금 코인 ${balance}개예요.` };
}

/** 코인 → 카드팩 교환. operationId 는 서버 렌더가 심은 멱등 키다(폼 재제출 방어). */
export async function exchangeCoinsAction(
  _state: ParticipationActionState,
  formData: FormData,
): Promise<ParticipationActionState> {
  const next = readNext(formData);
  await requireActiveUser(next);

  const offerId = readUuid(formData.get('offerId'));
  const operationId = readUuid(formData.get('operationId'));
  if (!offerId || !operationId) {
    return { status: 'error', message: EXCHANGE_FALLBACK };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('exchange_coins_for_draw_tickets', {
    p_offer_id: offerId,
    p_operation_id: operationId,
  });

  if (error) {
    return { status: 'error', message: mapParticipationError(error.message, EXCHANGE_FALLBACK) };
  }

  revalidatePath(next);
  revalidatePath(PACKS_PATH);

  const result = (data ?? {}) as ParticipationRpcResult;

  /* already_exchanged 는 실패가 아니다 — 응답이 유실된 첫 요청이 이미 성립했다는
     뜻이고, 카드팩은 발급돼 있다. 실패로 그리면 사용자가 한 번 더 교환하려 든다. */
  if (result.status === 'already_exchanged') {
    return {
      status: 'success',
      message: '이미 교환이 완료된 요청이에요. 카드팩 보관함에서 확인해 주세요.',
    };
  }

  return {
    status: 'success',
    message: '카드팩 교환이 완료됐어요. 카드팩 보관함에서 확인해 주세요.',
  };
}
