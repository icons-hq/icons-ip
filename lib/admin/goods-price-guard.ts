/*
 * 판매가 오입력 확인(CAT-007·CAT-008). 0원, 1,000원 미만, 이전 금액의 절반 이하·두 배 이상으로 바뀌는 판매가는
 * 저장 전에 어드민 확인창(adminConfirm)으로 한 번 더 확인받는다. 막지는 않는다 — 사은품 0원·특가처럼 의도한 금액이 있다.
 *
 * 기준 근거: 자릿수 오타(29,000 → 2,900 / 290,000)는 10배 차이라 절반·두 배 경계로 넉넉히 잡히고, 흔한 인상·인하(10~30%)와
 * 정상 할인은 걸리지 않는다. 1,000원 미만은 우리 굿즈에 정상 판매가가 거의 없는 구간이라 빈 칸·자릿수 누락을 잡는다.
 * 같은 기준을 상품 편집 저장·등록의 저장 후 공개·목록 일괄 판매가 변경·목록 판매가 바로 수정·ERP 판매가 반영이 함께 쓴다.
 */

export const GOODS_PRICE_GUARD_LOW = 1_000;

export type GoodsPriceGuardReason = 'zero' | 'low' | 'half' | 'double';

const REASON_LABELS: Record<GoodsPriceGuardReason, string> = {
  zero: '0원',
  low: '1,000원 미만',
  half: '이전 금액의 절반 이하',
  double: '이전 금액의 두 배 이상',
};

export interface GoodsPriceGuardLine {
  label: string;
  before: number | null;
  after: number;
  reasons: GoodsPriceGuardReason[];
}

/**
 * 확인할 이유. `before`가 없으면 새 금액(새 상품)이다. `checkLow`가 false면 0원·1,000원 미만은 보지 않는다 —
 * 이미 저장된 낮은 금액을 바꾸지 않은 저장이 매번 확인창을 띄우지 않게 호출부가 정한다.
 */
export function goodsPriceGuardReasons(before: number | null, after: number, { checkLow = true }: { checkLow?: boolean } = {}): GoodsPriceGuardReason[] {
  if (!Number.isFinite(after) || after < 0) return [];
  const reasons: GoodsPriceGuardReason[] = [];
  if (checkLow && after === 0) reasons.push('zero');
  else if (checkLow && after < GOODS_PRICE_GUARD_LOW) reasons.push('low');
  if (before !== null && Number.isFinite(before) && before > 0 && after > 0 && after !== before) {
    if (after * 2 <= before) reasons.push('half');
    else if (after >= before * 2) reasons.push('double');
  }
  return reasons;
}

/** 확인할 이유가 있는 줄. 없으면 null. */
export function goodsPriceGuardLine(label: string, before: number | null, after: number, options?: { checkLow?: boolean }): GoodsPriceGuardLine | null {
  const reasons = goodsPriceGuardReasons(before, after, options);
  return reasons.length ? { label, before, after, reasons } : null;
}

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

export function goodsPriceGuardReasonText(reasons: readonly GoodsPriceGuardReason[]): string {
  return reasons.map((reason) => REASON_LABELS[reason]).join(', ');
}

/** "판매가: 29,000원 → 2,900원 (이전 금액의 절반 이하)". 새 금액이면 바뀌는 값 대신 새 금액만 적는다. */
export function formatGoodsPriceGuardLine(line: GoodsPriceGuardLine): string {
  const values = line.before === null || line.before === line.after ? won(line.after) : `${won(line.before)} → ${won(line.after)}`;
  return `${line.label}: ${values} (${goodsPriceGuardReasonText(line.reasons)})`;
}

/** 확인창 목록이 길어지지 않게 앞의 몇 줄만 적고 나머지는 개수로 말한다. */
export function formatGoodsPriceGuardList(lines: readonly GoodsPriceGuardLine[], limit = 10): string {
  const shown = lines.slice(0, limit).map((line) => `· ${formatGoodsPriceGuardLine(line)}`);
  const rest = lines.length - shown.length;
  return [...shown, ...(rest > 0 ? [`· 외 ${rest.toLocaleString('ko-KR')}개`] : [])].join('\n');
}

export const GOODS_PRICE_GUARD_TITLE = '판매가 확인';
export const GOODS_PRICE_GUARD_INTRO = '판매가가 0원·1,000원 미만이거나 이전 금액의 절반 이하·두 배 이상입니다. 금액을 잘못 입력하지 않았는지 확인해주세요.';

/**
 * 상품 편집 저장 전 확인(등록 화면의 저장 후 공개 포함). 판매가(할인 전)와, 할인이 걸리면 고객이 내는 할인가를 따로 본다.
 * 저장된 값과 같고 공개하지도 않으면 0원·1,000원 미만을 다시 묻지 않는다. 확인할 것이 없으면 null.
 */
export function goodEditorPriceConfirmation({ saved, next, publish }: {
  /** 저장된 판매가(할인 전)와 할인가. 새 상품이면 null. */
  saved: { regularPrice: number; salePrice: number } | null;
  next: { regularPrice: number; salePrice: number };
  publish: boolean;
}): { title: string; message: string; confirmLabel: string } | null {
  const checkLow = (before: number | null, after: number) => publish || before === null || before !== after;
  const lines: GoodsPriceGuardLine[] = [];
  const regular = goodsPriceGuardLine('판매가', saved?.regularPrice ?? null, next.regularPrice,
    { checkLow: checkLow(saved?.regularPrice ?? null, next.regularPrice) });
  if (regular) lines.push(regular);
  const discounted = next.salePrice !== next.regularPrice || (saved !== null && saved.salePrice !== saved.regularPrice);
  if (discounted) {
    const sale = goodsPriceGuardLine('할인가', saved?.salePrice ?? null, next.salePrice, { checkLow: checkLow(saved?.salePrice ?? null, next.salePrice) });
    if (sale) lines.push(sale);
  }
  if (!lines.length) return null;
  const action = publish ? '저장 후 공개' : '저장';
  return {
    title: GOODS_PRICE_GUARD_TITLE,
    message: `${GOODS_PRICE_GUARD_INTRO}\n\n${lines.map(formatGoodsPriceGuardLine).join('\n')}\n\n맞으면 ${action}${action === '저장' ? '을' : '를'} 계속합니다.`,
    confirmLabel: publish ? '이대로 저장 후 공개' : '이대로 저장',
  };
}

/** 목록 판매가 바로 수정·할인 중지 후 변경: 이미 띄우는 변경 확인 문구 뒤에 붙일 경고 한 문장. 없으면 빈 문자열. */
export function goodsPriceGuardNotice(before: number, after: number): string {
  const reasons = goodsPriceGuardReasons(before, after);
  return reasons.length ? `\n\n새 판매가가 ${goodsPriceGuardReasonText(reasons)}입니다. 금액을 잘못 입력하지 않았는지 확인해주세요.` : '';
}

/** 여러 상품의 판매가 변경(목록 일괄 변경·ERP 판매가 반영) 중 확인할 줄. 이름은 상품명(옵션명)이다. */
export function goodsPriceGuardRows<T>(rows: readonly T[], pick: (row: T) => { label: string; before: number | null; after: number } | null): GoodsPriceGuardLine[] {
  const lines: GoodsPriceGuardLine[] = [];
  for (const row of rows) {
    const value = pick(row);
    if (!value || value.before === value.after) continue;
    const line = goodsPriceGuardLine(value.label, value.before, value.after);
    if (line) lines.push(line);
  }
  return lines;
}
