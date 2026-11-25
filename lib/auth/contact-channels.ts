import { kstDay } from '@/lib/admin/kst';

/*
 * 연락 수단 확장(10/14 회의 1014-005·006·010·014)의 공통 법적 게이트.
 *
 * 휴대폰 번호 인증·SMS 알림·카카오톡 채널은 개인정보처리방침이 새 수집 항목(휴대폰 번호, 카카오톡 채널 추가 상태)과
 * 처리위탁(SMS 발송사·카카오)을 고지한 뒤에만 운영에서 열 수 있다. 오픈 뒤의 방침 변경은 시행 7일 전 사전 공지가
 * 필요하므로(방침 제13조), 각 기능의 env 스위치만으로 운영에서 열리지 않게 이 시행일을 함께 요구한다.
 *
 * 이 날짜는 휴대폰 번호 인증·이메일 변경을 고지하는 개인정보처리방침 최초 판의 시행일(2026-11-25 KST)이다
 * (lib/legal/documents.ts LEGAL_EFFECTIVE_DATES.privacy — 시험이 두 값이 같은지 대조한다). 오픈 전이라 그동안의 방침 변경을
 * 개정 이력 없이 이 날짜의 최초 판으로 접었다. 시행일 전에는 운영에서 env 스위치가 켜져 있어도 닫힌다. SMS 알림·카카오톡
 * 채널은 아직 고지가 없어 아래 SMS_NOTIFICATIONS_AND_KAKAO_PRIVACY_EFFECTIVE_DATE(null)로 따로 닫아 둔다.
 * 켜는 순서(docs/runbooks/signup-contact-channels.md): 발송사·채널 계약 → 방침 고지 시행 → env 스위치.
 * Preview·로컬 시험은 env 스위치만으로 연다.
 */
export const CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE: string | null = '2026-11-25';

/**
 * SMS 알림(1014-010)·카카오톡 채널(1014-014)의 방침 시행일. 위 개정은 휴대폰 번호 인증(Twilio)과 이메일 변경만 고지한다 —
 * 080 수신거부·광고 문자 발송사와 카카오 채널 관계 정보는 아직 방침에 없으므로 운영에서는 닫혀 있다. 그 고지를 담는 개정의
 * 시행일을 여기에 채운다.
 */
export const SMS_NOTIFICATIONS_AND_KAKAO_PRIVACY_EFFECTIVE_DATE: string | null = null;

/**
 * 카카오 알림톡 주문 안내(lib/kakao/alimtalk)의 방침 시행일. 인증한 휴대폰 번호를 주문 접수·발송 안내에 쓰는 목적과 알림톡
 * 처리위탁(엔에이치엔클라우드·카카오)은 개인정보처리방침 최초 판(2026-11-25)이 고지한다 — 위 날짜와 같다.
 * 날짜를 비우면(null) 운영에서는 env를 다 넣어도 닫혀 있다.
 */
export const KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE: string | null = CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function contactChannelsLegalGateOpen(
  env: RuntimeEnvironment = process.env,
  now: Date = new Date(),
  effectiveDate: string | null = CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE,
): boolean {
  if (env.VERCEL_ENV !== 'production') return true;
  return effectiveDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && kstDay(now) >= effectiveDate;
}

/** env 스위치는 정확히 'true'일 때만 켜진다(결제 gate와 같은 문법). */
export function envSwitchOn(env: RuntimeEnvironment, name: string): boolean {
  return env[name] === 'true';
}
