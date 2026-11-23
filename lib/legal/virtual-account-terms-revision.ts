import revisionDates from './virtual-account-terms-revision.json';
import { kstToday } from './privacy-address-book-revision';

/*
 * 이용약관·개인정보처리방침·배송·반품 정책의 토스 가상계좌(무통장입금)·구매안전서비스(에스크로) 개정(ADR-0049 결정 9).
 *
 *  · 이용약관 제11조(지급방법): 토스페이먼츠 지급 방법에 가상계좌(무통장입금)를 더하고(굿즈 주문만), 입금 기한·결제 확정 시점(결제대행사의
 *    입금 확인)·기한 경과 시 자동 취소, 구매안전서비스(결제대금예치) 선택, 입금 뒤 환급은 이용자가 알려준 환급 계좌로 한다는 것을 밝힌다.
 *    회사 계좌로 직접 받는 무통장 입금(제11조의2)은 그대로다.
 *  · 개인정보처리방침: 제1조에 가상계좌 결제 화면에서 받은 환급 계좌(180일 뒤 파기)를, 제5조 토스페이먼츠 위탁 업무에 가상계좌·에스크로·
 *    현금영수증·환급 계좌 확인을 더한다.
 *  · 배송·반품 정책: 가상계좌 입금 기한 행과 결제 확정일(입금 확인일), 환급 계좌 안내를 더한다.
 *
 * 동작은 '출고지' 표기 개정(shipping-bundle-wording-revision.ts)과 같다 — 공지일부터 시행일 전까지 사전 공지, 시행일부터 이전 판 보존.
 * 이용자에게 불리한 변경이 아니므로(지급 방법이 하나 늘 뿐 기존 수단·절차는 그대로) 약관 제3조·방침 제13조의 7일 사전 공지 대상이다.
 * 가상계좌 운영 스위치(TOSS_VIRTUAL_ACCOUNT_ENABLED)는 이 개정이 시행된 뒤에만 켠다(ADR-0049 결정 2).
 *
 * 날짜는 JSON 한 곳(virtual-account-terms-revision.json)에 둔다 — 앱과 production 빌드 가드(scripts/check-vercel-build-env.mjs)가 같은 값을 읽는다.
 * 확정값(2026-11-23 운영 책임자 확정): 공지일 2026-11-24 → 시행일 2026-12-01. 공지 화면은 요청마다 오늘(KST)로 고르므로 11-24 전에
 * 배포되면 11-24 0시부터 공지가 보인다. 운영 배포가 11-24(KST)를 넘기면 실제 공지 기간이 7일보다 짧아지므로 두 날짜를 함께 뒤로
 * 미룬다(빌드 가드는 '공지일 = 배포일'을 볼 수 없다). 공지 기간이 같은 문서의 다른 예약 개정(부분 반품 개정 — 약관·배송 정책, 알림톡 개정 — 개인정보처리방침)의
 * 공지와 겹쳐도 두 공지를 함께 보인다(documents.ts addPendingRevision). 시행일만은 그 개정들의 시행일 이후로 잡는다 — 이전 판이
 * 앞선 개정을 담고, 앞선 개정의 본문 변환이 가상계좌 본문 위에서 다시 돌지 않게.
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
