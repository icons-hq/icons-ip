/* 전자상거래법상 필수인 판매자 정보의 단일 주입 지점.
 *
 * 상호·대표자·사업자등록번호·통신판매업 신고번호·주소·연락처는 #87이 확정해야
 * 값을 채울 수 있다. 그때 이 상수 하나만 고치면 모든 공개 화면 푸터가 따라온다.
 *
 * 값이 비어 있으면 businessInfoRows가 그 행을 만들지 않는다 — 신고 전 배포에서
 * "사업자등록번호"라는 라벨만 덩그러니 노출되면 오히려 표시 위반처럼 보인다.
 */

export interface BusinessInfo {
  companyName: string;
  representative: string;
  registrationNumber: string;
  mailOrderNumber: string;
  address: string;
  phone: string;
  email: string;
  hostingProvider: string;
}

export const BUSINESS_INFO_LABELS: Record<keyof BusinessInfo, string> = {
  companyName: '상호',
  representative: '대표자',
  registrationNumber: '사업자등록번호',
  mailOrderNumber: '통신판매업 신고번호',
  address: '사업장 주소',
  phone: '전화',
  email: '이메일',
  hostingProvider: '호스팅 제공자',
};

export const BUSINESS_INFO: BusinessInfo = {
  companyName: '',
  representative: '',
  registrationNumber: '',
  /* 통신판매업 신고 전이다. 번호를 임의로 채우지 않는다(#87). */
  mailOrderNumber: '',
  address: '',
  phone: '',
  email: '',
  /* 호스팅 제공자는 #87과 무관하게 확정돼 있다 — 개인정보처리방침의 처리위탁과 같은 사실이다. */
  hostingProvider: 'Vercel, Inc.',
};

export interface BusinessInfoRow {
  key: keyof BusinessInfo;
  label: string;
  value: string;
}

export function businessInfoRows(info: BusinessInfo = BUSINESS_INFO): BusinessInfoRow[] {
  return (Object.keys(BUSINESS_INFO_LABELS) as (keyof BusinessInfo)[])
    .map((key) => ({ key, label: BUSINESS_INFO_LABELS[key], value: info[key].trim() }))
    .filter((row) => row.value.length > 0);
}

/** 이용자가 실제로 연락을 닿게 할 수 있는 항목. 호스팅 제공자나 신고번호는 창구가 아니다. */
const CONTACT_KEYS: (keyof BusinessInfo)[] = ['representative', 'phone', 'email'];

/** 문의 창구로 쓸 수 있는 행만. 비어 있으면 창구가 아직 없다는 뜻이다. */
export function businessContactRows(info: BusinessInfo = BUSINESS_INFO): BusinessInfoRow[] {
  return businessInfoRows(info).filter((row) => CONTACT_KEYS.includes(row.key));
}

/** "대표자 홍길동 · 전화 02-0000-0000" 형태의 문장 조각.
 *  법정 문서 본문이 이 값에서 문의처 문장을 파생시킨다 — 값이 비면 문서가 창구를 가리키지 않는다(#87). */
export function businessContactWords(info: BusinessInfo = BUSINESS_INFO): string {
  return businessContactRows(info).map((row) => `${row.label} ${row.value}`).join(' · ');
}
