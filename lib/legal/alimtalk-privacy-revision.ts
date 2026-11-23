import revisionDates from './alimtalk-privacy-revision.json';
import { kstToday } from './privacy-address-book-revision';

/*
 * 개인정보처리방침 예약 개정 — 카카오톡 알림톡 주문 안내(lib/kakao/alimtalk) 도입.
 *
 * 2026-11-18 시행본 제2조는 "휴대폰 번호 인증으로 확인한 번호는 … 거래 안내 … 발송에는 이용하지 않습니다"라고 고지한다.
 * 알림톡은 그 번호로 주문 접수·굿즈 발송을 알리고 번호를 발송 대행사(엔에이치엔클라우드)·카카오에 넘기므로, 이 개정이 시행된
 * 뒤에만 운영에서 켤 수 있다(lib/auth/contact-channels.ts KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE가 이 시행일을 읽는다).
 *
 * 공지 기간·시행일 동작은 '출고지' 표기 개정(shipping-bundle-wording-revision.ts)과 같다.
 *   · 공지일부터 시행일 전: 현행 본문에 개정 사전 공지를 붙인다.
 *   · 시행일부터: 바뀐 본문이 현행이 되고 직전 본문은 이전 판으로, 바뀐 내용은 개정 안내로 남는다.
 * 공지일은 이 개정이 실제로 운영에 나간 날(KST)이어야 하고, 시행일은 그 날부터 7일 이상 뒤여야 한다(방침 제13조).
 * 기본값은 '예약 없음'(null)이다. 날짜는 운영 배포 직전에 한 커밋으로 넣는다(docs/runbooks/kakao-alimtalk.md §6).
 * production 빌드는 형식·간격만 검사한다(scripts/check-vercel-build-env.mjs).
 */
export interface AlimtalkPrivacyRevision {
  /** 사전 공지를 시작하는 날(KST `YYYY-MM-DD`) — 실제 운영 배포일. */
  announcedDate: string;
  /** 바뀐 본문이 현행이 되는 날(KST `YYYY-MM-DD`) — 공지일 + 7일 이상. */
  effectiveDate: string;
}

export const ALIMTALK_PRIVACY_REVISION: AlimtalkPrivacyRevision | null =
  typeof revisionDates.announcedDate === 'string' && typeof revisionDates.effectiveDate === 'string'
    ? { announcedDate: revisionDates.announcedDate, effectiveDate: revisionDates.effectiveDate }
    : null;

/** 알림톡 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). 예약이 없으면 늘 false. */
export function alimtalkPrivacyRevisionAnnounced(
  today: string = kstToday(),
  revision: AlimtalkPrivacyRevision | null = ALIMTALK_PRIVACY_REVISION,
): boolean {
  return revision !== null && today >= revision.announcedDate && today < revision.effectiveDate;
}

/** 알림톡 개정이 시행 중인가(시행일 당일 0시 KST 부터). 예약이 없으면 늘 false. */
export function alimtalkPrivacyRevisionInEffect(
  today: string = kstToday(),
  revision: AlimtalkPrivacyRevision | null = ALIMTALK_PRIVACY_REVISION,
): boolean {
  return revision !== null && today >= revision.effectiveDate;
}
