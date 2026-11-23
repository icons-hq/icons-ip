import revisionDates from './virtual-account-terms-revision.json';
import { kstToday } from './privacy-address-book-revision';

/*
 * 이용약관·개인정보처리방침·배송·반품 정책의 토스 계좌이체·가상계좌(무통장입금)·구매안전서비스(에스크로) 개정(ADR-0049 결정 9).
 *
 *  · 이용약관 제11조(지급방법): 토스페이먼츠 지급 방법에 계좌이체와 가상계좌(무통장입금)를 더하고(굿즈 주문만), 입금 기한·결제 확정
 *    시점(결제대행사의 입금 확인)·기한 경과 시 자동 취소, 구매안전서비스(결제대금예치) 선택, 가상계좌 입금 뒤 환급은 이용자가 알려준
 *    환급 계좌로, 계좌이체 환급은 출금 계좌로 한다는 것을 밝힌다. 회사 계좌로 직접 받는 무통장 입금(제11조의2)은 그대로다.
 *  · 개인정보처리방침: 제1조에 가상계좌 결제 화면에서 받은 환급 계좌(180일 뒤 파기)를, 제5조 토스페이먼츠 위탁 업무에 계좌이체·가상계좌·
 *    에스크로·현금영수증·환급 계좌 확인을 더한다.
 *  · 배송·반품 정책: 가상계좌 입금 기한 행과 결제 확정일(입금 확인일), 환급 계좌 안내를 더한다.
 *
 * 동작은 '출고지' 표기 개정(shipping-bundle-wording-revision.ts)과 같다 — 공지일부터 시행일 전까지 사전 공지, 시행일부터 이전 판 보존.
 * 약관 제3조·방침 제13조는 7일 사전 공지를 정하지만, 2026-11-23 운영 책임자가 실사용 회원이 없다는 이유로 즉시 시행을 결정했다 —
 * JSON의 `noticeWaiver`가 그 결정 기록이고, production 빌드 가드(scripts/check-vercel-build-env.mjs)는 이 기록이 있을 때만 7일보다
 * 짧은 공지(공지일 = 시행일 포함)를 받는다. 같은 문서의 다른 예약 개정(부분 반품 — 약관·배송 정책, 알림톡 — 개인정보처리방침)과의
 * 선후는 documents.ts가 시행일 순서로 정한다(늦게 시행되는 개정이 앞선 개정의 본문 위에서 돈다).
 * 가상계좌·계좌이체 운영 스위치(TOSS_VIRTUAL_ACCOUNT_ENABLED)는 이 개정이 시행된 뒤에만 켠다(ADR-0049 결정 2).
 *
 * 날짜는 JSON 한 곳(virtual-account-terms-revision.json)에 둔다 — 앱과 production 빌드 가드가 같은 값을 읽는다.
 * 확정값(2026-11-23 운영 책임자 결정): 공지일 = 시행일 = 2026-11-23(즉시 시행).
 */
export interface VirtualAccountTermsRevision {
  /** 사전 공지를 시작하는 날(KST `YYYY-MM-DD`) — 실제 운영 배포일. */
  announcedDate: string;
  /** 바뀐 본문이 현행이 되는 날(KST `YYYY-MM-DD`) — 공지일 + 7일 이상. */
  effectiveDate: string;
}

export const VIRTUAL_ACCOUNT_TERMS_REVISION: VirtualAccountTermsRevision | null =
  typeof revisionDates.announcedDate === 'string' && typeof revisionDates.effectiveDate === 'string'
    ? { announcedDate: revisionDates.announcedDate, effectiveDate: revisionDates.effectiveDate }
    : null;

/** 가상계좌 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). 예약이 없으면 늘 false. */
export function virtualAccountTermsRevisionAnnounced(
  today: string = kstToday(),
  revision: VirtualAccountTermsRevision | null = VIRTUAL_ACCOUNT_TERMS_REVISION,
): boolean {
  return revision !== null && today >= revision.announcedDate && today < revision.effectiveDate;
}

/** 가상계좌 개정이 시행 중인가(시행일 당일 0시 KST 부터). 예약이 없으면 늘 false. 사이트 하단 구매안전서비스 표시도 이 값을 따른다. */
export function virtualAccountTermsRevisionInEffect(
  today: string = kstToday(),
  revision: VirtualAccountTermsRevision | null = VIRTUAL_ACCOUNT_TERMS_REVISION,
): boolean {
  return revision !== null && today >= revision.effectiveDate;
}
