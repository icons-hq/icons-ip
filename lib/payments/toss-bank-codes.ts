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

function normalizeBankName(value: string): string {
  const compact = value.normalize('NFC').toLowerCase().replace(/[\s()·.\-]/g, '');
  return compact.length > 2 && compact.endsWith('은행') ? compact.slice(0, -2) : compact;
}

/* 목록 이름 밖에서 흔히 쓰는 표기(예전 자유 입력 칸·직접 호출). 확실히 한 은행을 가리키는 것만 둔다 — 애매하면 코드를 주지 않는다. */
const BANK_NAME_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  국민: '06', kb: '06', 기업: '03', ibk: '03', nh: '11', 지역농협: '12', 산업: '02', kdb: '02',
  대구: '31', dgb대구: '31', im뱅크: '31', 제일: '23', sc: '23', 한국씨티: '27', 씨티: '27', citi: '27',
  keb하나: '81', 하나: '81', 카카오: '90', 케이: '89', k뱅크: '89', 토스: '92', 새마을: '45', 산림: '64',
  신용협동조합: '48', 상호저축: '50', 저축: '50',
});

const BANK_CODES_BY_NAME = new Map<string, string>();
for (const [twoDigit, , name] of TOSS_BANKS) BANK_CODES_BY_NAME.set(normalizeBankName(name), twoDigit);
for (const [alias, code] of Object.entries(BANK_NAME_ALIASES)) {
  if (!BANK_CODES_BY_NAME.has(alias)) BANK_CODES_BY_NAME.set(alias, code);
}

/** 은행 이름의 토스 은행 코드(2자리). 목록 이름·확실한 별칭만 받고, 모르면 null(코드를 추측하지 않는다). */
export function tossBankCodeForName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const normalized = normalizeBankName(name);
  return normalized ? BANK_CODES_BY_NAME.get(normalized) ?? null : null;
}
