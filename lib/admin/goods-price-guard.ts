/*
 * 판매가 오입력 확인(CAT-007·CAT-008). 0원, 1,000원 미만, 이전 금액의 절반 이하·두 배 이상으로 바뀌는 판매가는
 * 저장 전에 어드민 확인창(adminConfirm)으로 한 번 더 확인받는다. 막지는 않는다 — 사은품 0원·특가처럼 의도한 금액이 있다.
 *
 * 기준 근거: 자릿수 오타(29,000 → 2,900 / 290,000)는 10배 차이라 절반·두 배 경계로 넉넉히 잡히고, 흔한 인상·인하(10~30%)와
 * 정상 할인은 걸리지 않는다. 1,000원 미만은 우리 굿즈에 정상 판매가가 거의 없는 구간이라 빈 칸·자릿수 누락을 잡는다.
 * 같은 기준을 상품 편집 저장·[실제 등록]·목록 일괄 판매가 변경·목록 판매가 바로 수정·ERP 판매가 반영이 함께 쓴다.
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
 * 상품 편집 저장 전 확인([실제 등록] 포함). 판매가(할인 전)와, 할인이 걸리면 고객이 내는 할인가를 따로 본다.
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
  const action = publish ? '실제 등록' : '저장';
  return {
    title: GOODS_PRICE_GUARD_TITLE,
    message: `${GOODS_PRICE_GUARD_INTRO}\n\n${lines.map(formatGoodsPriceGuardLine).join('\n')}\n\n맞으면 ${action}을 계속합니다.`,
    confirmLabel: publish ? '이대로 실제 등록' : '이대로 저장',
  };
}

/** 목록 판매가 바로 수정·할인 중지 후 변경: 이미 띄우는 변경 확인 문구 뒤에 붙일 경고 한 문장. 없으면 빈 문자열. */
export function goodsPriceGuardNotice(before: number, after: number): string {
  const reasons = goodsPriceGuardReasons(before, after);
  return reasons.length ? `\n\n새 판매가가 ${goodsPriceGuardReasonText(reasons)}입니다. 금액을 잘못 입력하지 않았는지 확인해주세요.` : '';
}

/**
 * 상품 엑셀 반입(CAT-108). 행마다 저장된 판매가·할인가와 파일이 정한 새 값을 계획에 싣는다(검증 결과와 함께 24시간 보관).
 * 판매가 = 할인 전 금액, 할인가 = 고객이 내는 금액. 미리보기가 이전 → 새 금액을 보이고, 적용 순간 기준에 걸린 상품을 한 번에 확인받는다.
 */
export interface GoodsImportPriceChange {
  saved: { regularPrice: number; salePrice: number } | null;
  next: { regularPrice: number; salePrice: number };
  /** 이 반입으로 초안이 공개로 바뀐다. 낮은 금액을 바꾸지 않아도 공개 순간에는 다시 본다. */
  publishing: boolean;
}

export interface GoodsImportPriceRow { name: string; priceChange?: GoodsImportPriceChange | null }

/** 확인할 줄. 판매가는 항상, 할인가는 할인이 걸리는(또는 걸려 있던) 상품만 본다. */
export function goodsImportPriceGuardLines(change: GoodsImportPriceChange | null | undefined, prefix = ''): GoodsPriceGuardLine[] {
  if (!change) return [];
  const { saved, next, publishing } = change;
  const checkLow = (before: number | null, after: number) => publishing || before === null || before !== after;
  const lines: GoodsPriceGuardLine[] = [];
  const regular = goodsPriceGuardLine(`${prefix}판매가`, saved?.regularPrice ?? null, next.regularPrice, { checkLow: checkLow(saved?.regularPrice ?? null, next.regularPrice) });
  if (regular) lines.push(regular);
  if (next.salePrice !== next.regularPrice || (saved !== null && saved.salePrice !== saved.regularPrice)) {
    const sale = goodsPriceGuardLine(`${prefix}할인가`, saved?.salePrice ?? null, next.salePrice, { checkLow: checkLow(saved?.salePrice ?? null, next.salePrice) });
    if (sale) lines.push(sale);
  }
  return lines;
}

/** 미리보기 한 줄: 바뀌는 금액만 "판매가 29,000원 → 2,900원 · 할인가 ...". 새 상품은 새 금액만. 바뀌는 것이 없으면 null. */
export function goodsImportPriceChangeText(change: GoodsImportPriceChange | null | undefined): string | null {
  if (!change) return null;
  const { saved, next } = change;
  const parts: string[] = [];
  const part = (label: string, before: number | null, after: number) => {
    if (before === null) parts.push(`${label} ${won(after)}`);
    else if (before !== after) parts.push(`${label} ${won(before)} → ${won(after)}`);
  };
  part('판매가', saved?.regularPrice ?? null, next.regularPrice);
  if (next.salePrice !== next.regularPrice || (saved !== null && saved.salePrice !== saved.regularPrice))
    part('할인가', saved?.salePrice ?? null, next.salePrice);
  return parts.length ? parts.join(' · ') : null;
}

/** 이 상품의 금액에 확인할 이유가 있는지(미리보기 강조용). */
export function goodsImportPriceNeedsCheck(change: GoodsImportPriceChange | null | undefined): boolean {
  return goodsImportPriceGuardLines(change).length > 0;
}

/** 적용 직전 한 번의 확인창. 적용할 상품 중 기준에 걸린 것만 모아 보인다. 없으면 null. */
export function goodsImportPriceConfirmation(rows: readonly GoodsImportPriceRow[]): { title: string; message: string; confirmLabel: string } | null {
  const lines = rows.flatMap((row) => goodsImportPriceGuardLines(row.priceChange, `${row.name || '이름 없음'} `));
  if (!lines.length) return null;
  return {
    title: GOODS_PRICE_GUARD_TITLE,
    message: `${GOODS_PRICE_GUARD_INTRO}\n\n${formatGoodsPriceGuardList(lines)}\n\n맞으면 검증한 상품 ${rows.length.toLocaleString('ko-KR')}개를 적용합니다.`,
    confirmLabel: '이대로 적용',
  };
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
