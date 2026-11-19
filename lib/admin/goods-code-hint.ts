/**
 * 상품 자동코드·옵션 자동코드 칸에 바코드 형식 값이 들어 있으면 바코드 칸으로 안내하는 판정과 문구(2026-11-19 MD가 바코드를 이 칸에 넣은 사고, ADR-0048).
 * 두 칸은 창고 품번으로 덮어쓸 수 있어 막지 않고 경고만 한다. 잠긴 칸에 이미 잘못 들어간 값도 열어 보지 않고 알아보게 한다.
 * 숫자만 8·12·13·14자리이고 GTIN 검증 숫자가 맞을 때만 바코드로 본다 — 숫자 창고 품번을 바코드로 오인하지 않도록.
 */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export function looksLikeBarcode(value: string | null | undefined): boolean {
  const digits = value?.trim() ?? '';
  if (!/^[0-9]+$/.test(digits) || !GTIN_LENGTHS.has(digits.length)) return false;
  let sum = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = 4 - weight) sum += Number(digits[index]) * weight;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** 상품 등록·수정의 자동코드 칸 경고. 잠겨 있으면 고칠 버튼('직접 바꾸기')까지 말한다. */
export function autoCodeBarcodeWarning(kind: 'goods' | 'option', open: boolean): string {
  const shown = kind === 'goods' ? "상품 목록과 출고지시 엑셀의 '상품코드' 열" : "출고지시 엑셀의 '옵션코드' 열";
  return `바코드 형식의 값이 들어 있습니다. 이 값은 ${shown}에 찍힙니다. 바코드는 옵션 상세 정보의 바코드 칸에 넣${open ? '습니다.' : "고, 이 칸은 '직접 바꾸기'를 눌러 고칩니다."}`;
}

/** 옵션 상세 정보 표의 좁은 옵션 자동코드 칸 경고. */
export const OPTION_AUTO_CODE_BARCODE_WARNING = '바코드 형식입니다 · 바코드는 바코드 칸에 넣습니다';
