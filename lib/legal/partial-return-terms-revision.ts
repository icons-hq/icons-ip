import revisionDates from './partial-return-terms-revision.json';
import { kstToday } from './privacy-address-book-revision';

/*
 * 이용약관 제16조·제16조의2와 배송·반품 정책의 부분 반품·반품배송비 차감 개정(원장 #17 CLM-025·CLM-083·CLM-085, ADR-0047).
 *
 * 지금 본문은 "한 주문에 담긴 굿즈 중 일부만 환급하는 처리는 제공하지 않습니다"라고 고지한다. 분리 가능한 굿즈의 일부 청약철회를
 * 약관으로 막는 것은 전자상거래법 제35조 다툼 소지가 있어, 부분 반품(굿즈·수량 단위 반품)과 단순 변심 반품배송비 차감(편도 3,000원,
 * 최초 배송비가 무료였던 주문은 처음 반품할 때 한 번 왕복 6,000원, 하자·오배송은 회사 부담)을 고지하는 본문으로 바꾼다.
 * 동작은 '출고지' 표기 개정(shipping-bundle-wording-revision.ts)과 같다 — 공지일부터 시행일 전까지 사전 공지, 시행일부터 이전 판 보존.
 *
 * 날짜는 JSON에 둔다(앱과 production 빌드 가드가 같은 값을 읽는다). 지금 값은 자리표시다 — 공지일은 이 개정이 실제로 운영에 나간 날(KST),
 * 시행일은 그 날부터 7일 이상 뒤여야 하고, 반품배송비 차감을 '이용자에게 불리한 변경'으로 보면 약관 제3조대로 30일 이상 뒤여야 한다
 * (사람이 정한다 — docs/runbooks/order-claim-intake.md '부분 반품 약관 개정'). 부분 반품·반품배송비 차감 스위치는 시행일 이후에 켠다.
 */
export interface PartialReturnTermsRevision {
  /** 사전 공지를 시작하는 날(KST `YYYY-MM-DD`) — 실제 운영 배포일. */
  announcedDate: string;
  /** 바뀐 본문이 현행이 되는 날(KST `YYYY-MM-DD`) — 공지일 + 7일 이상(불리한 변경이면 30일 이상). */
  effectiveDate: string;
}

export const PARTIAL_RETURN_TERMS_REVISION: PartialReturnTermsRevision | null =
  typeof revisionDates.announcedDate === 'string' && typeof revisionDates.effectiveDate === 'string'
    ? { announcedDate: revisionDates.announcedDate, effectiveDate: revisionDates.effectiveDate }
    : null;

/** 부분 반품 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). 예약이 없으면 늘 false. */
export function partialReturnTermsRevisionAnnounced(
  today: string = kstToday(),
  revision: PartialReturnTermsRevision | null = PARTIAL_RETURN_TERMS_REVISION,
): boolean {
  return revision !== null && today >= revision.announcedDate && today < revision.effectiveDate;
}

/** 부분 반품 개정이 시행 중인가(시행일 당일 0시 KST 부터). 예약이 없으면 늘 false. */
export function partialReturnTermsRevisionInEffect(
  today: string = kstToday(),
  revision: PartialReturnTermsRevision | null = PARTIAL_RETURN_TERMS_REVISION,
): boolean {
  return revision !== null && today >= revision.effectiveDate;
}
