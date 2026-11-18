import { kstToday } from './privacy-address-book-revision';

/*
 * 개인정보처리방침 예약 개정 — 휴대폰 번호 인증(Twilio Verify)과 소셜 로그인 회원의 선택 이메일 변경 도입(2026-11-17 확정).
 *
 * 공지 기간·시행일의 동작은 '출고지' 표기 개정(lib/legal/shipping-bundle-wording-revision.ts)과 같다.
 *   · 공지일부터 시행일 전: 현행 본문을 두고 개정 사전 공지를 붙인다.
 *   · 시행일부터: 바뀐 본문이 현행이 되고 직전 본문은 이전 판으로, 바뀐 내용은 개정 안내로 남는다.
 * 날짜는 KST. 연락 수단 법적 게이트(lib/auth/contact-channels.ts)가 운영에서 열리는 날도 이 시행일이다.
 *
 * 방침 제13조는 시행 7일 전 공지를 정하지만, 서비스에 실제 이용자가 아직 없어(운영 책임자 확인, 2026-11-17)
 * 공지 1일 뒤 시행으로 둔다. 이용자가 생긴 뒤의 개정에는 이 예외를 쓰지 않는다 — 그래서 날짜를 JSON이 아닌
 * 상수로 두고 production 빌드 가드(7일 간격 검사)의 대상에서 뺀다.
 */
export interface ContactChannelsPrivacyRevision {
  /** 사전 공지를 시작하는 날(KST `YYYY-MM-DD`). */
  announcedDate: string;
  /** 바뀐 본문이 현행이 되는 날(KST `YYYY-MM-DD`). */
  effectiveDate: string;
}

export const CONTACT_CHANNELS_PRIVACY_REVISION: ContactChannelsPrivacyRevision = {
  announcedDate: '2026-11-17',
  effectiveDate: '2026-11-18',
};

/** 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). */
export function contactChannelsPrivacyRevisionAnnounced(
  today: string = kstToday(),
  revision: ContactChannelsPrivacyRevision | null = CONTACT_CHANNELS_PRIVACY_REVISION,
): boolean {
  return revision !== null && today >= revision.announcedDate && today < revision.effectiveDate;
}

/** 개정이 시행 중인가(시행일 당일 0시 KST 부터). */
export function contactChannelsPrivacyRevisionInEffect(
  today: string = kstToday(),
  revision: ContactChannelsPrivacyRevision | null = CONTACT_CHANNELS_PRIVACY_REVISION,
): boolean {
  return revision !== null && today >= revision.effectiveDate;
}
