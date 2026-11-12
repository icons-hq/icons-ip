import { kstToday } from './privacy-address-book-revision';

/*
 * 이용약관·배송·반품 정책의 '출고지' 표기 개정(10/27 회의 1027T-010 — "출고지 표기를 빼달라", 결정 "전부 제거").
 *
 * 고객 화면(굿즈 상세·장바구니·주문서·주문 상세)은 이미 출고지 이름 대신 '배송 묶음'으로 말한다(CONTEXT.md 배송 묶음).
 * 법정 문서에 남은 '출고지별'도 같은 표기로 바꾸되, 서비스 공개 뒤의 첫 개정이라 약관 제3조·방침 제13조대로
 * 시행 7일 전부터 사전 공지하고 시행일부터 직전 본문을 이전 판으로 보존한다(lib/legal/documents.ts).
 *   · 공지일부터 시행일 전: 지금 효력이 있는 본문을 현행으로 두고 개정 사전 공지(공지일·시행 예정일·바뀌는 내용)를 붙인다.
 *   · 시행일부터: 바뀐 본문이 현행이 되고 직전 본문은 이전 판(details)으로, 바뀐 내용은 개정 안내로 남는다.
 * 날짜는 KST로 읽으므로 시행일에 배포 없이 바뀐다(/legal/* 은 300초 ISR — 시행일 0시 직후 한 번 열어 재생성).
 *
 * 공지일은 이 개정이 실제로 운영에 나간 날이어야 하고, 시행일은 그 날부터 7일 이상 뒤여야 한다(테스트가 7일을 지킨다).
 * 아래 두 날짜는 자리 값이다 — 병합·배포 때 실제 운영 배포일로 공지일을, 그 7일 이상 뒤로 시행일을 함께 고친다.
 * 이용자에게 불리한 변경이 아니므로(표기만 바뀌고 배송비·절차는 그대로) 약관 제3조의 30일 공지 대상이 아니다.
 */
export const SHIPPING_BUNDLE_WORDING_REVISION = {
  announcedDate: '2026-11-12',
  effectiveDate: '2026-11-19',
} as const;

/** '출고지' 표기 개정을 사전 공지하는 중인가(공지일 0시 KST 부터 시행일 전날까지). */
export function shippingBundleWordingRevisionAnnounced(today: string = kstToday()): boolean {
  return today >= SHIPPING_BUNDLE_WORDING_REVISION.announcedDate
    && today < SHIPPING_BUNDLE_WORDING_REVISION.effectiveDate;
}

/** '출고지' 표기 개정이 시행 중인가(시행일 당일 0시 KST 부터). */
export function shippingBundleWordingRevisionInEffect(today: string = kstToday()): boolean {
  return today >= SHIPPING_BUNDLE_WORDING_REVISION.effectiveDate;
}
