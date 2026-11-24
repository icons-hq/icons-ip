import revisionDates from './brand-name-revision.json';
import { kstToday } from './privacy-address-book-revision';

/*
 * 이용약관의 서비스 이름 개정(2026-11-24 사용자 요청 — 고객에게 보이는 'ICONS'를 '엑스스퀘어'로 통일).
 *
 *  · 제1조(목적): 회사 표기를 법인 상호(주식회사 아이콘스)로, 서비스 이름을 ICONS에서 엑스스퀘어로 고쳐 쓴다.
 *
 * 약관 제3조는 시행 7일 전 사전 공지를 정하지만, 2026-11-24 운영 책임자(사용자)가 정식 오픈 전이라 실사용 회원이 없다는 이유로
 * 즉시 시행을 결정했다 — JSON의 `noticeWaiver`가 그 결정 기록이고, production 빌드 가드(scripts/check-vercel-build-env.mjs)는 이
 * 기록이 있을 때만 7일보다 짧은 공지(공지일 = 시행일 포함)를 받는다. 문서 이름('엑스스퀘어 이용약관'·'엑스스퀘어 개인정보처리방침')과
 * 방침 요약은 조문이 아니어서 개정 절차 없이 바로 고쳤다 — 개인정보처리방침 본문에는 서비스 이름이 없다.
 * 동작은 다른 예약 개정과 같다 — 공지일부터 시행일 전까지 사전 공지, 시행일부터 이전 판 보존(documents.ts).
 *
 * 날짜는 JSON 한 곳(brand-name-revision.json)에 둔다 — 앱과 production 빌드 가드(scripts/check-vercel-build-env.mjs)가 같은 값을
 * 읽는다. 확정값(2026-11-24 운영 책임자 결정): 공지일 = 시행일 = 2026-11-24(즉시 시행).
 */
export interface BrandNameRevision {
  /** 사전 공지를 시작하는 날(KST `YYYY-MM-DD`) — 실제 운영 배포일. */
  announcedDate: string;
  /** 바뀐 본문이 현행이 되는 날(KST `YYYY-MM-DD`) — 공지일 + 7일 이상. */
  effectiveDate: string;
}

export const BRAND_NAME_REVISION: BrandNameRevision | null =
  typeof revisionDates.announcedDate === 'string' && typeof revisionDates.effectiveDate === 'string'
    ? { announcedDate: revisionDates.announcedDate, effectiveDate: revisionDates.effectiveDate }
    : null;

/** 서비스 이름 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). 예약이 없으면 늘 false. */
export function brandNameRevisionAnnounced(
  today: string = kstToday(),
  revision: BrandNameRevision | null = BRAND_NAME_REVISION,
): boolean {
  return revision !== null && today >= revision.announcedDate && today < revision.effectiveDate;
}

/** 서비스 이름 개정이 시행 중인가(시행일 당일 0시 KST 부터). 예약이 없으면 늘 false. */
export function brandNameRevisionInEffect(
  today: string = kstToday(),
  revision: BrandNameRevision | null = BRAND_NAME_REVISION,
): boolean {
  return revision !== null && today >= revision.effectiveDate;
}
