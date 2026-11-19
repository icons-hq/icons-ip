/* 공개 사업자 정보의 초기 fallback. 운영 설정 미입력 상태와 일시 조회 실패에 사용한다.
 * 실제 서버 읽기는 business-info.server.ts의 getBusinessInfo()가 맡고,
 * 관리자가 저장한 빈 값은 아래 행 생성 함수에서 생략된다. */

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
  companyName: '(주)아이콘스',
  representative: '정승준',
  registrationNumber: '109-86-27576',
  mailOrderNumber: '2025-서울마포-1494',
  address: '서울특별시 마포구 월드컵로8길 69, 1,2,3,4,5층(서교동, 마루)',
  phone: '010-9822-8724',
  email: 'yskim@mariannekate.com',
  /* 호스팅 제공자는 #239의 나머지 공개값과 무관하게 확정돼 있다 — 개인정보처리방침의 처리위탁과 같은 사실이다. */
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

/*
 * 공정거래위원회 통신판매사업자 정보 공개 조회(사업자등록번호 10자리로 조회, 원장 CUS-092·CAT-066).
 * 이 형식은 공정위 사이트(www.ftc.go.kr/bizCommPop.do?wrkr_no=)가 사업자등록번호를 받는 조회 팝업 주소이고,
 * 2026-11-19 해당 주소가 '통신판매 사업자정보 조회' 화면으로 열리는 것을 확인했다. 저장소·공식 문서에는 이 주소 형식의 근거가 없어
 * 공정위 제공 코드의 공개 사용 예를 따른 것이므로, 공정위가 주소를 바꾸면 이 한 곳만 고친다.
 * 번호가 숫자 10자리가 아니면 null이다 — 링크를 숨긴다(잘못된 번호로 남의 사업자를 조회시키지 않는다).
 */
const FTC_BUSINESS_VERIFY_URL = 'https://www.ftc.go.kr/bizCommPop.do';

export function businessRegistrationVerifyHref(info: BusinessInfo = BUSINESS_INFO): string | null {
  const digits = info.registrationNumber.replace(/[\s-]/g, '');
  return /^\d{10}$/.test(digits) ? `${FTC_BUSINESS_VERIFY_URL}?wrkr_no=${digits}` : null;
}

/*
 * 이용자가 실제로 연락을 **닿게** 할 수 있는 항목만이다.
 * 대표자명은 창구가 아니라 창구의 이름표다 — 사업자등록증에 먼저 확정되므로
 * 여기 넣으면 전화·이메일이 비어 있는 중간 상태에서 "창구가 있다"로 잘못 뒤집힌다.
 * 호스팅 제공자와 신고번호도 창구가 아니다.
 */
const CONTACT_KEYS: (keyof BusinessInfo)[] = ['phone', 'email'];

/** 문의 창구로 쓸 수 있는 행만. 비어 있으면 창구가 아직 없다는 뜻이다. */
export function businessContactRows(info: BusinessInfo = BUSINESS_INFO): BusinessInfoRow[] {
  return businessInfoRows(info).filter((row) => CONTACT_KEYS.includes(row.key));
}

/** "대표자 홍길동 · 전화 02-0000-0000" 형태의 문장 조각.
 *  법정 문서 본문이 이 값에서 문의처 문장을 파생시킨다 — 값이 비면 문서가 창구를 가리키지 않는다(#239). */
export function businessContactWords(info: BusinessInfo = BUSINESS_INFO): string {
  return businessContactRows(info).map((row) => `${row.label} ${row.value}`).join(' · ');
}
