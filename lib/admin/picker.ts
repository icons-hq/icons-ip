/**
 * 공용 선택창(components/admin/console/AdminPickerDialog)의 조회 계약(docs/admin-screen-rules.md 규칙 1·2).
 *
 * 대상(상품·카테고리·템플릿·그룹)을 고르는 칸은 모두 같은 창을 쓴다: 검색 → 20개씩 페이지 목록 → [선택].
 * 고를 수 없는 항목은 조회 단계에서 빼고(`excludedNote`로 한 줄 알린다) 목록에 넣지 않는다.
 */
export const ADMIN_PICKER_PAGE_SIZE = 20;

export interface AdminPickerRequest {
  /** 검색어(앞뒤 공백 제거 전). */
  query: string;
  /** 검색 대상(`searchFields`의 value). 대상이 하나면 빈 문자열. */
  field: string;
  /** 추가 조건(`filterOptions`의 value). 없으면 빈 문자열. */
  filter: string;
  /** 1부터 시작하는 페이지. */
  page: number;
}

export interface AdminPickerPage<T> {
  rows: readonly T[];
  /** 조건에 맞는 전체 개수(고를 수 없어 뺀 항목은 세지 않는다). */
  total: number;
  page: number;
  pageSize: number;
}

export type AdminPickerResult<T> = AdminPickerPage<T> | { error: string };

export type AdminPickerLoader<T> = (request: AdminPickerRequest) => Promise<AdminPickerResult<T>>;

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ko-KR');

/** 검색어의 낱말이 모두 들어 있는가(순서 무관, 대소문자·전각 무시). 빈 검색어는 모두 통과. */
export function adminPickerMatches(text: string, query: string): boolean {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const target = normalize(text);
  return words.every((word) => target.includes(word));
}

/**
 * 이미 화면이 가진 목록(카테고리처럼 한 번에 읽어 둔 것)을 선택창 페이지로 자른다. 순서는 받은 그대로다.
 * 범위를 벗어난 페이지는 마지막 페이지로 보정한다.
 */
export function adminPickerLocalPage<T>(items: readonly T[], request: AdminPickerRequest, options: {
  /** 검색에 걸리는 글자(이름·코드·경로 등). */
  textOf: (item: T) => string;
  /** 추가 조건(`request.filter`)을 통과하는가. 조건이 비어 있을 때는 부르지 않는다. */
  matchesFilter?: (item: T, filter: string) => boolean;
  pageSize?: number;
}): AdminPickerPage<T> {
  const pageSize = Math.max(1, Math.trunc(options.pageSize ?? ADMIN_PICKER_PAGE_SIZE));
  const matched = items.filter((item) => (!request.filter || !options.matchesFilter || options.matchesFilter(item, request.filter))
    && adminPickerMatches(options.textOf(item), request.query));
  const lastPage = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(request.page) || 1), lastPage);
  return { rows: matched.slice((page - 1) * pageSize, page * pageSize), total: matched.length, page, pageSize };
}

/** `adminPickerLocalPage`를 선택창의 `load`로 감싼다. */
export function adminPickerLocalLoader<T>(items: readonly T[], options: Parameters<typeof adminPickerLocalPage<T>>[2]): AdminPickerLoader<T> {
  return async (request) => adminPickerLocalPage(items, request, options);
}
