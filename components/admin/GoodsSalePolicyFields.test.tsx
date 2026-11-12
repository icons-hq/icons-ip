import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { GOOD_EDITOR_SECTIONS, GOOD_OPTION_LIMIT_ERROR_FIELD, goodFieldSection } from '@/lib/admin/good-workspace';
import { GoodsPurchaseLimitFields } from './GoodsSalePolicyFields';

const rows: GoodsOptionRow[] = [
  { name: '빨강', code: '', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 3 },
  { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 1 },
];
const summary = (html: string) => html.match(/data-good-section-summary="">(.*?)<\/span>/)?.[1] ?? '';

describe('구매 제한 카드', () => {
  /* ADM-011·1027T-021(11/11 결정 "펼친 채로" — 10/27 R12 원안): 접힌 줄이 아니라 입력칸이 바로 보이는 소항목이다. */
  it('접지 않고 제목·현재 값 한 줄과 입력칸을 바로 보인다', () => {
    const html = renderToStaticMarkup(<GoodsPurchaseLimitFields values={{ orderQuantityLimitEnabled: 'false', memberPurchaseLimitEnabled: 'false' }} rows={rows} onRowsChange={() => {}} />);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
    expect(html).toMatch(/^<section aria-labelledby="good-section-limits-title"[^>]*id="good-section-limits"/);
    expect(html).toContain('<h4 class="text-sm font-medium text-foreground" data-good-section-title="" id="good-section-limits-title">구매 제한</h4>');
    expect(summary(html)).toBe('최소/최대 구매수량 설정안함 · 1인 최대 구매수량 설정안함');
    for (const name of ['orderQuantityLimitEnabled', 'memberPurchaseLimitEnabled']) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('aria-label="빨강 최대 구매수량(주문당)"');
  });

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
