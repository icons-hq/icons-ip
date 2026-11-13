import { isUuid } from '@/lib/uuid';

/*
 * 주문 관련 목록 위 주문 상세 팝업(S36-075, 2026-11-11 결정 묶음 5 "목록 위 상세 팝업"). 클레임 목록의
 * `?claimId=` 팝업(R8)과 같은 방식이다 — 목록 주소에 `?orderId=`를 더해 같은 화면 위에 상세를 열고, 닫으면
 * 같은 조건의 목록 주소로 돌아간다. 목록 조건(필터·페이지)은 화면마다 자기 href 함수가 만들고 이 값은 모르므로,
 * 닫을 때는 그 함수가 만든 주소를 그대로 쓴다.
 */
export const ORDER_PREVIEW_PARAM = 'orderId';

/** 주소의 `?orderId=` 값. UUID가 아니거나 여러 개면 팝업을 열지 않는다. */
export function adminOrderPreviewId(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

/** 목록 주소에 팝업으로 열 주문을 더한다. 목록의 다른 조건은 그대로 둔다. */
export function adminOrderPreviewHref(listHref: string, orderId: string): string {
  const [path, query = ''] = listHref.split('?');
  const params = new URLSearchParams(query);
  params.set(ORDER_PREVIEW_PARAM, orderId);
  return `${path}?${params.toString()}`;
}
