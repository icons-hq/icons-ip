import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NEW_GOOD_INSTANT_DISCOUNT, resolveGoodsPrice, type GoodsInstantDiscountState, type GoodsPriceDraft } from '@/lib/admin/goods-price-editor';
import { GoodsDiscountRateField, GoodsPriceFields } from './GoodsPriceFields';

const render = (changes: Partial<GoodsPriceDraft> = {}, instant?: GoodsInstantDiscountState | null) => {
  const draft: GoodsPriceDraft = { regularPrice: '10000', discountEnabled: false, discountValue: '', discountUnit: 'won', ...changes };
  return renderToStaticMarkup(<GoodsPriceFields draft={draft} onDraftChange={() => {}} result={resolveGoodsPrice(draft, Date.parse('2026-11-12T00:00:00Z'))} errors={{}}
    {...(instant === undefined ? {} : { instant })} showDiscountRate="false" />);
};

/** 할인 입력 묶음(설정안함이면 hidden) 안의 마크업 */
const discountBlock = (html: string) => {
  const start = html.indexOf('data-good-price-discount=""');
  return html.slice(start, html.indexOf('data-good-price-result=""', start));
};

describe('판매가·할인 입력', () => {
  /* 리뷰 T3a-10 — R18 할인 결과 문구('할인가 X원 (Y원, Z% 할인)')를 어드민 비주얼 픽스처 QA가 찾는 문구와 맞춘다(판매가 2,000원·할인 1,000원). */
  it('비주얼 픽스처 QA가 기다리는 할인 결과 문구가 실제 화면 문구와 같다', () => {
    const qa = readFileSync(new URL('../../scripts/admin-visual-fixture/good-editor-qa.mjs', import.meta.url), 'utf8');
    const expected = qa.match(/getByText\('(\([^']*할인\))'\)/)?.[1];
    expect(expected).toBe('(1,000원, 50% 할인)');
    const text = render({ regularPrice: '2000', discountEnabled: true, discountValue: '1000' }).replace(/<[^>]+>/g, '');
    expect(text).toContain(`할인가 1,000원 ${expected}`);
  });

  /*
   * 2026-10-07 리뷰: 할인율 표시는 기간 할인에도 쓰여 할인 설정안함 상품에서도 바꿀 수 있어야 한다(숨긴 할인 입력 묶음 밖).
   * TKT-033: 원래 요청 '할인율 노출 여부·할인 기간'을 한 자리에 — 즉시할인 블록 안, 기간 입력 바로 아래로 옮겼다(추가 설정 카드에서 이동).
   */
  it('고객 화면에 할인율 표시는 즉시할인 블록 안에 늘 보이고 기간 할인·프로모션에도 적용된다고 안내한다', () => {
    for (const discountEnabled of [false, true]) {
      const html = render({ discountEnabled, discountValue: '1000' }, NEW_GOOD_INSTANT_DISCOUNT);
      expect(discountBlock(html), String(discountEnabled)).not.toContain('showDiscountRate');
      const block = html.slice(html.indexOf('data-good-instant-discount=""'));
      expect(block.indexOf('name="showDiscountRate"'), String(discountEnabled)).toBeGreaterThan(block.indexOf('name="discountPeriodEnabled"'));
    }
    const html = renderToStaticMarkup(<GoodsDiscountRateField value="false" />);
    const rate = html.indexOf('name="showDiscountRate"');
    expect(rate).toBeGreaterThan(-1);
    expect(html.slice(html.lastIndexOf('<label', rate), rate)).toContain('고객 화면에 할인율 표시');
    expect(html).toContain('기간 할인·할인 프로모션에 모두 적용됩니다');
    expect(html).toMatch(/<option value="false" selected="">숨김 · 할인가만 표시<\/option>/);
    expect(render()).toContain('data-good-price-discount="" hidden=""');
  });

  /* TKT-033(ADR-0040): 판매가 아래 즉시할인 블록에 기간 입력(스마트스토어식 '특정기간만 할인'). */
  it('특정기간만 할인을 켜면 한국 시간 기간을 받고 판매가는 그대로 저장하며 서버 지시를 hidden으로 보낸다', () => {
    const on = render({ discountEnabled: true, discountValue: '10', discountUnit: 'percent', periodEnabled: true, periodStartsAt: '2026-12-01T00:00', periodEndsAt: '2026-12-08T00:00' }, NEW_GOOD_INSTANT_DISCOUNT);
    expect(on).toMatch(/<input[^>]*type="checkbox"[^>]*name="discountPeriodEnabled"[^>]*checked=""/);
    expect(on).toMatch(/<input[^>]*type="datetime-local"[^>]*name="discountStartsAt" value="2026-12-01T00:00"/);
    expect(on).not.toContain('data-good-price-period="" hidden=""');
    expect(on).toContain('<input type="hidden" name="price" value="10000"/>');
    expect(on).toContain('<input type="hidden" name="compareAtPrice" value=""/>');
    const instruction = /name="instantDiscountPeriod" value="([^"]+)"/.exec(on)?.[1].replaceAll('&quot;', '"');
    expect(JSON.parse(instruction!)).toEqual({ mode: 'period', amount: 1000, startsAt: '2026-11-30T15:00:00.000Z', endsAt: '2026-12-07T15:00:00.000Z', expectedFingerprint: 'none' });
    expect(on.replace(/<[^>]+>/g, '')).toContain('기간 중 할인가 9,000원');
    /* 기간을 끄면 기간 입력은 검증·제출에서 빠지고 복구용 값만 남는다. 지시는 none이다. */
    const off = render({ discountEnabled: true, discountValue: '1000', periodEnabled: false, periodStartsAt: '2026-12-01T00:00' }, NEW_GOOD_INSTANT_DISCOUNT);
    expect(off).toContain('data-good-price-period="" hidden=""');
    expect(off).toContain('<input type="hidden" name="discountStartsAt" value="2026-12-01T00:00"/>');
    expect(off).toContain('&quot;mode&quot;:&quot;none&quot;');
    /* 상태를 넘기지 않는 화면에는 특정기간만 할인이 없고 지시도 없다. */
    expect(render({ discountEnabled: true, discountValue: '1000' })).not.toContain('discountPeriodEnabled');
    expect(render({ discountEnabled: true, discountValue: '1000' })).not.toContain('instantDiscountPeriod');
  });

  it('할인 프로모션 등 다른 곳에서 관리하는 할인이 있으면 즉시할인을 잠그고 이유·관리할 곳을 보이며 지시를 보내지 않는다', () => {
    const managed: GoodsInstantDiscountState = { state: 'managed', reason: 'promotion', fingerprint: 'abc', period: null,
      summary: { count: 2, minPrice: 9000, maxPrice: 9000, startsAt: '2026-12-01T00:00:00+00:00', endsAt: '2026-12-03T00:00:00+00:00' }, promotions: [{ id: 'p1', name: '오픈 기획전' }] };
    const html = render({ discountEnabled: false }, managed);
    expect(html).toMatch(/<fieldset[^>]*data-good-choice=""[^>]*disabled=""|<fieldset[^>]*disabled=""[^>]*data-good-choice=""/);
    expect(html).toContain('data-good-instant-discount-managed="promotion"');
    expect(html.replace(/<[^>]+>/g, '')).toContain('할인 프로모션 ‘오픈 기획전’이 건 할인입니다');
    expect(html).toContain('<input type="hidden" name="discountEnabled" value="false"/>');
    expect(html).not.toContain('instantDiscountPeriod');
    /* 할인 상태를 불러오지 못하면 잠그고 새로고침을 안내한다. */
    expect(render({}, null)).toContain('data-good-instant-discount-managed="unknown"');
  });

  it('할인 행이 없는 판매 중 옵션이 있으면 잠금 안내가 그 사실을 말한다', () => {
    const mixed: GoodsInstantDiscountState = { state: 'managed', reason: 'mixed', fingerprint: 'abc', period: null, uncovered: 1,
      summary: { count: 1, minPrice: 9000, maxPrice: 9000, startsAt: '2026-12-01T00:00:00+00:00', endsAt: '2026-12-03T00:00:00+00:00' }, promotions: [] };
    expect(render({ discountEnabled: false }, mixed).replace(/<[^>]+>/g, '')).toContain('할인이 걸리지 않은 옵션이 있습니다(1개)');
    expect(render({ discountEnabled: false }, { ...mixed, uncovered: undefined }).replace(/<[^>]+>/g, '')).not.toContain('할인이 걸리지 않은 옵션');
  });

  /* 2026-10-07 QA: 10%로 저장한 할인을 다시 열면 1,200원으로 보여, 판매가를 바꿔도 할인율이 따라가지 않는 것을 몰랐다. */
  it('할인 칸 도움말은 저장 후 다시 열면 원 단위로 표시되고 판매가를 바꾸면 할인을 다시 확인하라고 안내한다', () => {
    const html = render({ discountEnabled: true, discountValue: '10', discountUnit: 'percent' });
    const hint = html.slice(html.indexOf('id="goods-discount-value-hint"'));
    /* ADM-004 #74: 도움말은 두 문장이다. */
    expect(hint.slice(0, hint.indexOf('</'))).toContain('판매가에서 뺄 금액(원) 또는 비율(%)이며, 저장 후 다시 열면 원 단위로 표시됩니다. 판매가를 바꿀 때는 할인도 다시 확인해주세요.');
    expect(hint.slice(hint.indexOf('>') + 1, hint.indexOf('</')).split('. ').length).toBe(2);
  });

  /* 2026-10-07 리뷰: 숨긴 할인 입력에 남은 음수 값(rangeUnderflow)이 설정안함 상태의 저장을 막았다. */
  it('할인 설정안함이면 할인 입력을 검증·제출에서 빼고, 입력값은 복구용 hidden 값으로 보존한다', () => {
    const off = render({ discountEnabled: false, discountValue: '-10', discountUnit: 'percent' });
    expect(off).toMatch(/<input[^>]*id="goods-discount-value"[^>]*disabled=""/);
    expect(off).toMatch(/<select[^>]*name="discountUnit"[^>]*disabled=""/);
    expect(off).toContain('<input type="hidden" name="discountValue" value="-10"/>');
    expect(off).toContain('<input type="hidden" name="discountUnit" value="percent"/>');
    expect(off).toContain('<input type="hidden" name="price" value="10000"/>');
    expect(off).toContain('<input type="hidden" name="compareAtPrice" value=""/>');

    const on = render({ discountEnabled: true, discountValue: '1000' });
    expect(on).not.toMatch(/<input[^>]*id="goods-discount-value"[^>]*disabled=""/);
    expect(on).not.toContain('type="hidden" name="discountValue"');
    expect(on).not.toContain('type="hidden" name="discountUnit"');
    expect(on).toMatch(/<input[^>]*name="discountValue"[^>]*value="1000"/);
  });
});
