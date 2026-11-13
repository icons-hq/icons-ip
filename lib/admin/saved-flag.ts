/**
 * 처음 저장하고 다른 화면(수정·상세·발급)으로 옮겨 갈 때 붙이는 한 번용 표시(1027T-026). 목록 조회 키가 아니라
 * 필터·화면 key에 들지 않고, 받은 화면이 '저장했습니다'를 보인 뒤 window.history.replaceState로 주소에서 지운다
 * (새로고침·뒤로 가기에 다시 뜨지 않게). 혜택 등록과 리뷰이벤트 등록이 같은 표시를 쓴다.
 */
export const ADMIN_SAVED_PARAM = 'saved';
const BASE = 'https://admin.invalid';

export function withAdminSavedFlag(href: string) {
  const url = new URL(href, BASE);
  url.searchParams.set(ADMIN_SAVED_PARAM, '1');
  return `${url.pathname}?${url.searchParams}`;
}

export function withoutAdminSavedFlag(href: string) {
  const url = new URL(href, BASE);
  url.searchParams.delete(ADMIN_SAVED_PARAM);
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

/** 서버 페이지의 searchParams에서 한 번용 표시를 읽는다. */
export function adminSavedFlag(params: Record<string, string | string[] | undefined>) {
  return params[ADMIN_SAVED_PARAM] === '1';
}
