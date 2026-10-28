import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { GOOD_EDITOR_SECTIONS, GOOD_OPTION_LIMIT_ERROR_FIELD, goodFieldSection } from '@/lib/admin/good-workspace';
import { GoodsPurchaseLimitFields } from './GoodsSalePolicyFields';

const rows: GoodsOptionRow[] = [
  { name: '빨강', code: '', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 3 },
  { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 1 },
];
const summary = (html: string) => html.match(/<span class="admin-good-section__summary">(.*?)<\/span>/)?.[1] ?? '';

describe('구매 제한 카드', () => {
  /* 리뷰 T3a-5 — 수량 입력은 비제어라 마운트 때 값으로 요약하면 편집 중 입력이 '?'로 남는다. 편집기의 현재 입력값으로 요약한다. */
  it('섹션 요약은 마운트 때 값이 아니라 편집 중인 현재 입력값으로 수량을 보인다', () => {
    const initial = { orderQuantityLimitEnabled: 'true', minOrderQty: '', maxOrderQty: '', memberPurchaseLimitEnabled: 'true', memberLifetimeQtyLimit: '' };
    const current = { ...initial, minOrderQty: '2', maxOrderQty: '5', memberLifetimeQtyLimit: '7' };
    const html = renderToStaticMarkup(<GoodsPurchaseLimitFields values={initial} current={current} rows={rows} onRowsChange={() => {}} />);
    expect(summary(html)).toBe('최소 2·최대 5개 · 1인 최대 7개');
    /* 입력칸 기본값은 마운트 때 값 그대로다(비제어 입력, 저장 계약 유지). */
    expect(html).toMatch(/<input[^>]*name="minOrderQty"[^>]*value=""/);
    expect(summary(renderToStaticMarkup(<GoodsPurchaseLimitFields values={initial} rows={rows} onRowsChange={() => {}} />))).toBe('최소 ?·최대 ?개 · 1인 최대 ?개');
  });

  /* 리뷰 T3a-6 — 옵션별 제한 표의 입력은 이름이 없어 브라우저 검증 오류가 'form'으로 묶이고 카테고리로 연결됐다. 구매 제한 카드로 보낸다. */
  it('옵션별 제한 입력은 오류 칸 이름과 보이는 이름을 갖고, 그 이름은 구매 제한 카드에 속한다', () => {
    const html = renderToStaticMarkup(<GoodsPurchaseLimitFields values={{}} rows={rows} onRowsChange={() => {}} />);
    const inputs = html.match(/<input[^>]*aria-label="[^"]*(최대 구매수량\(주문당\)|1인 최대 구매수량)"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(4);
    for (const input of inputs) expect(input).toContain(`data-error-field="${GOOD_OPTION_LIMIT_ERROR_FIELD}"`);
    expect(inputs.every((input) => !/\sname=/.test(input))).toBe(true);
    expect(goodFieldSection(GOOD_OPTION_LIMIT_ERROR_FIELD).key).toBe('limits');
    expect(GOOD_EDITOR_SECTIONS.find((section) => section.key === 'limits')?.fields).toContain(GOOD_OPTION_LIMIT_ERROR_FIELD);
    /* 오류가 있으면 구매 제한 섹션을 열고 개수를 센다. */
    const errored = renderToStaticMarkup(<GoodsPurchaseLimitFields values={{}} errors={{ [GOOD_OPTION_LIMIT_ERROR_FIELD]: '빨강 최대 구매수량(주문당) 입력값을 확인해주세요.' }} rows={rows} onRowsChange={() => {}} />);
    expect(errored).toContain('1개 확인 필요');
    expect(errored).toContain('빨강 최대 구매수량(주문당) 입력값을 확인해주세요.');
  });
});
