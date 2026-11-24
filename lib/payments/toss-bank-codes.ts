/**
 * 토스페이먼츠 은행 코드(2자리, 기관 코드 문서 /codes/org-codes — 2026-11-23 실조회). 가상계좌 발급 은행(`virtualAccount.bankCode`)과
 * 구매자 환불 계좌(`refundReceiveAccount.bankCode`) 표시에 쓴다. 응답은 2·3자리 코드가 올 수 있어 3자리(금융결제원 코드)도 받는다.
 * 목록에 없는 코드는 코드를 그대로 보인다(은행 이름을 추측하지 않는다).
 */
const TOSS_BANKS: readonly (readonly [twoDigit: string, threeDigit: string, name: string])[] = [
  ['39', '039', '경남은행'],
  ['34', '034', '광주은행'],
  ['12', '012', '단위농협'],
  ['32', '032', '부산은행'],
  ['45', '045', '새마을금고'],
  ['64', '064', '산림조합'],
  ['88', '088', '신한은행'],
  ['48', '048', '신협'],
  ['27', '027', '씨티은행'],
  ['20', '020', '우리은행'],
  ['71', '071', '우체국'],
  ['50', '050', '저축은행'],
  ['37', '037', '전북은행'],
  ['35', '035', '제주은행'],
  ['90', '090', '카카오뱅크'],
  ['89', '089', '케이뱅크'],
  ['92', '092', '토스뱅크'],
  ['81', '081', '하나은행'],
  ['54', '054', 'HSBC'],
  ['60', '060', 'Bank of America'],
  ['03', '003', 'IBK기업은행'],
  ['06', '004', 'KB국민은행'],
  ['31', '031', 'iM뱅크(대구)'],
  ['02', '002', 'KDB산업은행'],
  ['11', '011', 'NH농협은행'],
  ['23', '023', 'SC제일은행'],
  ['07', '007', 'Sh수협은행'],
  ['30', '030', '수협중앙회'],
];

const BANK_NAMES = new Map<string, string>();
for (const [twoDigit, threeDigit, name] of TOSS_BANKS) {
  BANK_NAMES.set(twoDigit, name);
  BANK_NAMES.set(threeDigit, name);
}

/** 토스 은행 코드의 은행 이름. 모르는 코드는 null. */
export function tossBankName(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null;
  return BANK_NAMES.get(code) ?? null;
}

/** 화면 표기 — 이름을 알면 이름, 모르면 '은행 코드 {code}'. */
export function tossBankLabel(code: string): string {
  return tossBankName(code) ?? `은행 코드 ${code}`;
}

/**
 * 구매자가 반품·취소 신청 화면·주문 상세에서 고르는 환급 은행(가상계좌 환불 — ADR-0049 결정 5 보강). 이름은 위 표 그대로이고 토스 취소 API의
 * `refundReceiveAccount.bank`에는 2자리 코드를 싣는다. 화면은 이 목록에서 고르게 해 이름 → 코드 변환이 추측이 되지 않게 한다.
 */
export const TOSS_REFUND_BANKS: readonly { readonly code: string; readonly name: string }[] = Object.freeze(
  TOSS_BANKS
    .map(([twoDigit, , name]) => Object.freeze({ code: twoDigit, name }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko')),
);

const BANK_CODES_BY_NAME = new Map<string, string>(TOSS_REFUND_BANKS.map((bank) => [bank.name, bank.code]));

/**
 * 환급 은행 이름(위 목록의 이름 그대로)의 토스 은행 코드(2자리). 목록 밖 이름·별칭은 null — 코드를 추측하지 않는다.
 * DB(private.toss_refund_bank_name_known·virtual_account_refund_account_usable)도 같은 이름만 받는다(시험이 두 목록을 대조한다).
 */
export function tossBankCodeForName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  return BANK_CODES_BY_NAME.get(name) ?? null;
}
