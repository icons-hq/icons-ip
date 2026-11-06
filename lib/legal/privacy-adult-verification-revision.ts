import { kstToday } from './privacy-address-book-revision';

/*
 * 개인정보처리방침 성인 인증(NHN KCP 휴대폰 본인확인, ADR-0024) 개정의 공지일·시행일.
 *
 * 처리방침 제13조는 변경을 "시행 7일 전부터 서비스 화면에 공지"한다고 약속한다. 주소록 개정과 같은 구조로 두 상태를 날짜 하나로 맞춘다.
 *   · 공지일부터 시행일 전: /legal/privacy 는 지금 효력이 있는 본문을 현행으로 두고 개정 사전 공지(공지일·시행 예정일)를
 *     붙인다(lib/legal/documents.ts). 성인 인증 공개 스위치(ADULT_VERIFICATION_ENABLED)가 켜져 있어도 일반 회원에게는
 *     열지 않는다(lib/identity/kcp-cert-config.ts 의 adultVerificationEnabledFor) — 방침이 아직 고지하지 않은 항목을
 *     먼저 수집하지 않기 위해서다. 단일 canary 계정(내부 확인용)만 쓸 수 있다.
 *   · 시행일부터: 개정 본문이 현행이 되고(직전 본문은 이전 판으로 보존) 공개 스위치가 켜져 있으면 모든 회원에게 열린다.
 * 둘 다 이 날짜를 KST 로 읽으므로 시행일에 배포 없이 함께 바뀐다(/legal/* 은 300초 ISR, 성인 인증 화면·메뉴는 요청마다).
 *
 * 공지일은 이 개정이 실제로 운영에 나간 날이어야 하고, 시행일은 그 날부터 7일 이상 뒤여야 한다(테스트가 7일을 지킨다).
 * 배포일이 바뀌면 두 날짜를 함께 고친다. 문구·시행일·고지 방식은 사람 검토 대상이다.
 */
export const PRIVACY_ADULT_VERIFICATION_REVISION = {
  announcedDate: '2026-11-06',
  effectiveDate: '2026-11-13',
} as const;

/** 성인 인증 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). */
export function privacyAdultVerificationRevisionAnnounced(today: string = kstToday()): boolean {
  return today >= PRIVACY_ADULT_VERIFICATION_REVISION.announcedDate
    && today < PRIVACY_ADULT_VERIFICATION_REVISION.effectiveDate;
}

/** 성인 인증 개정이 시행 중인가(시행일 당일 0시 KST 부터). */
export function privacyAdultVerificationRevisionInEffect(today: string = kstToday()): boolean {
  return today >= PRIVACY_ADULT_VERIFICATION_REVISION.effectiveDate;
}
