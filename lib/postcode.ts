/* 우편번호·기본 주소 검색(#175)의 순수 파생.
   선택 결과는 iframe 안의 JS 콜백으로만 들어오고, 우리는 그 값을 URL이나
   서버로 흘리지 않는다 — 상태로만 받아 폼에 채운다.

   여기서 만든 값은 반드시 lib/checkout.ts의 checkoutAddressErrors를 통과해야
   한다. 통과하지 못하는 결과는 채우지 않고 null을 돌려 수기 입력에 맡긴다. */

/** 다음 우편번호 서비스 임베드 스크립트. 쿼리 없는 정적 주소다.
    CSP를 도입하는 시점에 script-src·frame-src·img-src에
    `https://*.daumcdn.net`과 `https://postcode.map.daum.net`을 허용해야 한다. */
export const POSTCODE_SCRIPT_SRC =
  'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

/** 검색 레이어가 콜백으로 넘겨주는 값 중 우리가 쓰는 필드만 좁힌 형태다. */
export interface PostcodeSelection {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  userSelectedType: 'R' | 'J';
  bname: string;
  buildingName: string;
}

export interface ComposedPostcodeAddress {
  postalCode: string;
  address1: string;
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

  return address1.length > ADDRESS1_MAX_LENGTH ? null : { postalCode, address1 };
}
