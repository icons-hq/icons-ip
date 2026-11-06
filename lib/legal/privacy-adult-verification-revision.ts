import { kstToday } from './privacy-address-book-revision';

/*
 * 개인정보처리방침 성인 인증(NHN KCP 휴대폰 본인확인, ADR-0024) 개정의 시행일.
 *
 * 사전 공지 없이 2026-11-06에 바로 시행한다. 처리방침 제13조는 변경을 "시행 7일 전부터 공지"한다고 약속하지만,
 * 2026-08-22 가입 연령 개정(lib/legal/documents.ts)과 같은 근거로 유예를 두지 않았다 — 2026-11-06 Production 실측에서
 * 직원 외 회원 프로필 182개 중 172개가 운영 시뮬레이션 가상 계정(sim.invalid)이고 나머지는 내부 확인용 계정이며,
 * 운영 책임자가 실사용자가 없음을 확인했다. 보호할 기존 이용자가 없는 변경이라 유예가 보호하는 대상이 없다.
 * 실사용자가 생긴 뒤의 수집 항목 추가는 다시 7일 사전 공지 대상이다.
 *
 * 같은 날 시행되는 주소록 개정(PRIVACY_ADDRESS_BOOK_REVISION)과 한 개정(2026-11-06)으로 합쳐 보인다 — 직전 판은
 * 2026-10-19 본문이다(lib/legal/documents.ts). 성인 인증 공개 스위치(ADULT_VERIFICATION_ENABLED)는 이 시행일부터만
 * 효력이 있다(lib/identity/kcp-cert-config.ts 의 adultVerificationEnabledFor) — 방침이 고지하기 전에 일반 회원의
 * 본인확인 정보를 받지 않는다는 경계는 그대로 남긴다. 문구·시행일·고지 방식은 사람 검토 대상이다.
 */
export const PRIVACY_ADULT_VERIFICATION_REVISION = {
  effectiveDate: '2026-11-06',
} as const;

/** 성인 인증 개정이 시행 중인가(시행일 당일 0시 KST 부터). */
export function privacyAdultVerificationRevisionInEffect(today: string = kstToday()): boolean {
  return today >= PRIVACY_ADULT_VERIFICATION_REVISION.effectiveDate;
}
