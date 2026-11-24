/* 우편번호·기본 주소 검색(#175)의 순수 파생.
   선택 결과는 iframe 안의 JS 콜백으로만 들어오고, 우리는 그 값을 URL이나
   서버로 흘리지 않는다 — 상태로만 받아 폼에 채운다.

   여기서 만든 값은 반드시 lib/checkout.ts의 checkoutAddressErrors를 통과해야
   한다. 통과하지 못하는 결과는 채우지 않고 null을 돌려 수기 입력에 맡긴다.

   주소는 검색으로 확정한다(국내 커머스 관행 — 검색 → 선택 → 상세 주소). 검색으로 채운
   우편번호·기본 주소는 화면이 잠그고, 손 입력은 검색을 열지 못했을 때만 연다(PostcodeField).
   공동주택(apartment)인데 상세 주소가 비면 제출 전에 한 번 확인받는다 — 동·호수 누락은
   배송 주소 오류의 주된 원인이다. 확인일 뿐 막지는 않는다. */

import type { CustomerConfirmRequest } from './customer-confirm';

/** 카카오 우편번호 서비스(옛 다음 우편번호) 임베드 스크립트. 쿼리 없는 정적 주소다.
    옛 `t1.daumcdn.net` 주소는 2026-11-30에 닫힌다(서비스 공지) — 공식 가이드의 `t1.kakaocdn.net`을 쓴다.
    CSP를 도입하는 시점에 script-src에 `https://t1.kakaocdn.net`, 검색 화면 iframe이 뜨는
    frame-src에 `https://postcode.map.kakao.com`을 허용해야 한다. */
export const POSTCODE_SCRIPT_SRC =
  'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

/** 검색 레이어가 콜백으로 넘겨주는 값 중 우리가 쓰는 필드만 좁힌 형태다. */
export interface PostcodeSelection {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  userSelectedType: 'R' | 'J';
  bname: string;
  buildingName: string;
  /** 공동주택(아파트) 여부. 다음 우편번호는 'Y' / 'N' 으로 준다. */
  apartment: 'Y' | 'N';
}

export interface ComposedPostcodeAddress {
  postalCode: string;
  address1: string;
  /** 검색 결과가 공동주택(아파트)이다 — 상세 주소(동·호수)가 비면 제출 전에 확인받는다. */
  apartment: boolean;
}

const POSTAL_CODE_PATTERN = /^\d{5}$/;
/** 법정동명이 동·로·가로 끝날 때만 괄호 참고 정보로 의미가 있다. */
const REFERENCE_BNAME_PATTERN = /[동로가]$/;
const ADDRESS1_MAX_LENGTH = 200;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function composePostcodeAddress(
  selection: Partial<PostcodeSelection> | null | undefined,
): ComposedPostcodeAddress | null {
  if (!selection) return null;

  const postalCode = text(selection.zonecode);
  if (!POSTAL_CODE_PATTERN.test(postalCode)) return null;

  const roadAddress = text(selection.roadAddress);
  const jibunAddress = text(selection.jibunAddress);
  const useRoad = selection.userSelectedType !== 'J' && Boolean(roadAddress);
  const baseAddress = useRoad ? roadAddress : jibunAddress || roadAddress;
  if (!baseAddress) return null;

  const references: string[] = [];
  if (useRoad) {
    const bname = text(selection.bname);
    const buildingName = text(selection.buildingName);
    if (bname && REFERENCE_BNAME_PATTERN.test(bname)) references.push(bname);
    if (buildingName) references.push(buildingName);
  }

  const address1 = references.length
    ? `${baseAddress} (${references.join(', ')})`
    : baseAddress;

  if (address1.length > ADDRESS1_MAX_LENGTH) return null;
  return { postalCode, address1, apartment: selection.apartment === 'Y' };
}

/** 검색한 주소가 공동주택인데 상세 주소가 비었는가 — 제출 전에 한 번 확인받을 때다. */
export function apartmentDetailMissing(apartment: boolean, address2: string | null | undefined): boolean {
  return apartment && !(address2 ?? '').trim();
}

/**
 * 공동주택 상세 주소 확인창 문구(lib/customer-confirm.ts 요청). action 은 확인 버튼의 동작 이름이다('주문'·'저장'·'진행').
 * 취소(기본 버튼)를 누르면 화면은 상세 주소 칸으로 포커스를 옮긴다.
 */
export function apartmentDetailConfirmRequest(action: string): CustomerConfirmRequest {
  return {
    title: '상세 주소 없이 진행할까요?',
    message: '아파트 주소는 동·호수가 없으면 배송이 늦어지거나 돌아올 수 있어요.',
    confirmLabel: `이대로 ${action}`,
    cancelLabel: '상세 주소 입력',
  };
}
