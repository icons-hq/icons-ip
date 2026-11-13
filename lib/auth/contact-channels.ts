import { kstDay } from '@/lib/admin/kst';

/*
 * 연락 수단 확장(10/14 회의 1014-005·006·010·014)의 공통 법적 게이트.
 *
 * 휴대폰 번호 인증·SMS 알림·카카오톡 채널은 개인정보처리방침이 새 수집 항목(휴대폰 번호, 카카오톡 채널 추가 상태)과
 * 처리위탁(SMS 발송사·카카오)을 고지한 뒤에만 운영에서 열 수 있다. 오픈 뒤의 방침 변경은 시행 7일 전 사전 공지가
 * 필요하므로(방침 제13조), 각 기능의 env 스위치만으로 운영에서 열리지 않게 이 시행일을 함께 요구한다.
 *
 * 켜는 순서(docs/runbooks/signup-contact-channels.md): 발송사·채널 계약 → 방침 개정 사전 공지 PR에서 이 날짜를
 * 개정 시행일로 채움 → 시행일 이후 env 스위치. Preview·로컬 시험은 env 스위치만으로 연다.
 */
export const CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE: string | null = null;

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
