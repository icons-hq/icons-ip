import revisionDates from './brand-name-revision.json';
import { kstToday } from './privacy-address-book-revision';

/*
 * 이용약관의 서비스 이름 개정(2026-11-24 사용자 요청 — 고객에게 보이는 'ICONS'를 '엑스스퀘어'로 통일).
 *
 *  · 제1조(목적): 회사 표기를 법인 상호(주식회사 아이콘스)로, 서비스 이름을 ICONS에서 엑스스퀘어로 고쳐 쓴다.
 *
 * 서비스 내용·이용조건은 그대로지만 약관 문장이 바뀌므로 약관 제3조대로 시행 7일 전에 사전 공지한다(실사용 회원이 있어 공지를
 * 줄이지 않는다). 문서 이름('엑스스퀘어 이용약관'·'엑스스퀘어 개인정보처리방침')과 방침 요약은 조문이 아니어서 개정 절차 없이 바로
 * 고쳤다 — 개인정보처리방침 본문에는 서비스 이름이 없다.
 * 동작은 다른 예약 개정과 같다 — 공지일부터 시행일 전까지 사전 공지, 시행일부터 이전 판 보존(documents.ts).
 *
 * 날짜는 JSON 한 곳(brand-name-revision.json)에 둔다 — 앱과 production 빌드 가드(scripts/check-vercel-build-env.mjs)가 같은 값을
 * 읽는다. 공지일은 실제 운영 배포일이어야 하므로 배포가 공지일을 넘기면 두 날짜를 함께 뒤로 옮긴다(시행일 = 공지일 + 7일 이상).
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
