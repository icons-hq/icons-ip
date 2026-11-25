import revisionDates from './privacy-officer-revision.json';
import { kstToday } from './privacy-address-book-revision';

/*
 * 개인정보처리방침 개정 — 개인정보 보호책임자의 성명·직책을 밝힌다(제11조).
 *
 * 「개인정보 보호법」 제30조 제1항은 처리방침에 제31조에 따른 보호책임자의 성명(또는 고충 처리 부서의 명칭)과 연락처를 적게 한다.
 * 지금까지 제11조는 연락처(사이트 하단 사업자 정보의 전화·이메일)만 적고 보호책임자가 누구인지는 밝히지 않았다.
 * 2026-11-25 운영 책임자(사용자)가 보호책임자를 대표이사 정승준으로 정했다 — 연락 창구는 그대로다.
 *
 * 방침 제13조는 시행 7일 전 공지를 정하지만, 같은 날 운영 책임자가 정식 오픈 전이라 실사용 회원이 없고 빠진 법정 기재 사항을
 * 채우는 개정이라는 이유로 즉시 시행을 결정했다 — JSON의 `noticeWaiver`가 그 결정 기록이고, production 빌드 가드
 * (scripts/check-vercel-build-env.mjs)는 이 기록이 있을 때만 7일보다 짧은 공지(공지일 = 시행일 포함)를 받는다.
 * 동작은 다른 예약 개정과 같다 — 공지일부터 시행일 전까지 사전 공지, 시행일부터 이전 판 보존(documents.ts).
 *
 * 날짜는 JSON 한 곳(privacy-officer-revision.json)에 둔다 — 앱과 production 빌드 가드가 같은 값을 읽는다.
 * 공지일·시행일은 이 개정이 실제로 운영에 나간 날(KST)이다. 머지가 그날을 넘기면 두 날짜를 실제 배포일로 옮긴다.
 */
export interface PrivacyOfficerRevision {
  /** 사전 공지를 시작하는 날(KST `YYYY-MM-DD`) — 실제 운영 배포일. */
  announcedDate: string;
  /** 바뀐 본문이 현행이 되는 날(KST `YYYY-MM-DD`) — 공지일 + 7일 이상, 또는 noticeWaiver 기록이 있으면 공지일 이후. */
  effectiveDate: string;
}

export const PRIVACY_OFFICER_REVISION: PrivacyOfficerRevision | null =
  typeof revisionDates.announcedDate === 'string' && typeof revisionDates.effectiveDate === 'string'
    ? { announcedDate: revisionDates.announcedDate, effectiveDate: revisionDates.effectiveDate }
    : null;

/** 보호책임자 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). 예약이 없으면 늘 false. */
export function privacyOfficerRevisionAnnounced(
  today: string = kstToday(),
  revision: PrivacyOfficerRevision | null = PRIVACY_OFFICER_REVISION,
): boolean {
  return revision !== null && today >= revision.announcedDate && today < revision.effectiveDate;
}

/** 보호책임자 개정이 시행 중인가(시행일 당일 0시 KST 부터). 예약이 없으면 늘 false. */
export function privacyOfficerRevisionInEffect(
  today: string = kstToday(),
  revision: PrivacyOfficerRevision | null = PRIVACY_OFFICER_REVISION,
): boolean {
  return revision !== null && today >= revision.effectiveDate;
}
