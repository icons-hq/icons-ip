/**
 * 상품 엑셀 v8 머리글의 옛 이름(ADR-0048). 2026-11-19 상품·옵션 코드 열을 '상품 자동코드'·'옵션 자동코드'로 바꿨지만
 * 열의 순서·뜻은 같아 양식 버전을 올리지 않았다. 그 전에 내려받은 v8 파일(판매자상품코드·관리코드)도 같은 열로 읽는다.
 * 상품 시트·KC 검토·직접입력형 옵션·A/S·사이즈 시트의 머리글 검사가 함께 쓴다. 구형(v3~v7) 머리글은 각 시트의 옛 표가 맡는다.
 */
const PREVIOUS_V8_HEADERS: Readonly<Record<string, readonly string[]>> = {
  '상품 자동코드': ['판매자상품코드'],
  '옵션 자동코드': ['관리코드'],
  '적용 옵션 자동코드': ['적용 관리코드'],
};

/** 올린 파일의 머리글이 지금 이름이거나 같은 열의 옛 v8 이름이면 맞다. */
export function goodsWorkbookHeaderMatches(actual: string, expected: string): boolean {
  return actual === expected || (PREVIOUS_V8_HEADERS[expected]?.includes(actual) ?? false);
}
