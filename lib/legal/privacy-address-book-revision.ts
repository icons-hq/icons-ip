import { kstDay } from '../admin/kst';

/*
 * 개인정보처리방침 주소록 개정(LFS 패리티 2차 L7 · MY-11, #572)의 공지일·시행일.
 *
 * 처리방침 제13조는 변경을 "시행 7일 전부터 서비스 화면에 공지"한다고 약속한다. 그래서 두 상태를 날짜 하나로 맞춘다.
 *   · 시행일 전: /legal/privacy 는 지금 효력이 있는 본문(2026-10-19)을 현행으로 두고 개정 사전 공지(공지일·시행 예정일)를
 *     붙인다(lib/legal/documents.ts). 주소록 저장도 열지 않는다(lib/address-book.ts 의 addressBookOpenFor) — 방침이 아직
 *     고지하지 않은 항목을 먼저 수집하지 않기 위해서다. staff/admin 은 미리보기로 쓸 수 있다.
 *   · 시행일부터: 개정 본문이 현행이 되고(직전 본문은 이전 판으로 보존) 주소록이 모든 회원에게 열린다.
 * 둘 다 이 날짜를 KST 로 읽으므로 시행일에 배포 없이 함께 바뀐다(/legal/* 은 300초 ISR, 주소록 화면·주문서는 요청마다).
 *
 * 공지일은 이 개정이 실제로 운영에 나간 날이어야 하고, 시행일은 그 날부터 7일 이상 뒤여야 한다(테스트가 7일을 지킨다).
 * 배포일이 바뀌면 두 날짜를 함께 고친다. 문구·시행일·고지 방식은 사람 검토 대상이다.
 */
export const PRIVACY_ADDRESS_BOOK_REVISION = {
  announcedDate: '2026-10-28',
  effectiveDate: '2026-11-06',
} as const;

/** 오늘(KST, `YYYY-MM-DD`). 법정 고지의 시행일은 이용자 달력(한국 시간)으로 센다. */
export function kstToday(now: Date = new Date()): string {
  return kstDay(now);
}

/** 주소록 개정이 시행 중인가(시행일 당일 0시 KST 부터). */
export function privacyAddressBookRevisionInEffect(today: string = kstToday()): boolean {
  return today >= PRIVACY_ADDRESS_BOOK_REVISION.effectiveDate;
}

/** '2026-11-06' → '2026년 11월 6일' — 화면 안내 문구용. */
export function koreanLegalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
