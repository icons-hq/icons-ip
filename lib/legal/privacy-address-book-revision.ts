import { kstDay } from '../admin/kst';

/*
 * 주소록(배송지 관리, LFS 패리티 2차 L7 · MY-11, #572)을 모든 회원에게 여는 날.
 *
 * 처리방침이 주소록 수집을 고지하기 전에는 주소록 저장을 열지 않는다(lib/address-book.ts 의 addressBookOpenFor,
 * staff/admin 은 미리보기). 처리방침은 2026-11-06 오픈 전 최초 판부터 주소록을 본문에 담고 있으므로
 * (lib/legal/documents.ts) 이 날짜는 그 시행일과 같다. 날짜는 KST 로 읽는다.
 */
export const PRIVACY_ADDRESS_BOOK_REVISION = {
  effectiveDate: '2026-11-06',
} as const;

/** 오늘(KST, `YYYY-MM-DD`). 법정 고지의 시행일은 이용자 달력(한국 시간)으로 센다. */
export function kstToday(now: Date = new Date()): string {
  return kstDay(now);
}

/** '2026-11-06' → '2026년 11월 6일' — 화면 안내 문구용. */
export function koreanLegalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
