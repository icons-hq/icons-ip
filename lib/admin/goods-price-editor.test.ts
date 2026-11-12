import { describe, expect, it } from 'vitest';
import { NEW_GOOD_INSTANT_DISCOUNT, goodsDiscountRate, goodsDiscountResultText, goodsPriceDraftFromValues, instantDiscountPeriodRequest, parseGoodsInstantDiscountState,
  parseInstantDiscountPeriodRequest, planErpSalePrice, resolveGoodsPrice, type GoodsInstantDiscountState, type GoodsPriceDraft } from './goods-price-editor';

const draft = (changes: Partial<GoodsPriceDraft> = {}): GoodsPriceDraft => ({
  regularPrice: '10000', discountEnabled: false, discountValue: '', discountUnit: 'won', ...changes,
});

/* 10/27 회의 R18 — 원 단위 할인에도 할인율을 함께 보인다. 고객 화면(PriceBlock)과 같은 반올림이다. */
describe('할인 결과 문구', () => {
  it('할인가 X원 (Y원, Z% 할인), Z는 할인액÷판매가×100 반올림', () => {
    expect(goodsDiscountRate(26000, 22000)).toBe(15);
    expect(goodsDiscountRate(9900, 8415)).toBe(15);
    expect(goodsDiscountRate(10000, 9950)).toBe(1);
    expect(goodsDiscountRate(10000, 9960)).toBe(0);
    expect(goodsDiscountRate(10000, 8350)).toBe(17);
    expect(goodsDiscountRate(0, 0)).toBe(0);
    for (const [regular, sale] of [[3000, 2550], [19900, 14925], [7, 3], [12345, 6789]]) {
      expect(goodsDiscountRate(regular, sale)).toBe(Math.round((1 - sale / regular) * 100));
    }
    const result = resolveGoodsPrice(draft({ regularPrice: '26000', discountEnabled: true, discountValue: '4000' }));
    expect(goodsDiscountResultText(result)).toBe('할인가 22,000원 (4,000원, 15% 할인)');
    expect(goodsDiscountResultText(resolveGoodsPrice(draft({ discountEnabled: true, discountValue: '' })))).toBeNull();
  });
});

describe('판매가·할인 입력 변환', () => {
  it('할인 설정안함은 판매가를 price로, compareAtPrice는 빈 값으로 저장한다', () => {
    expect(resolveGoodsPrice(draft())).toMatchObject({ price: '10000', compareAtPrice: '', salePrice: 10000, discountAmount: 0 });
    expect(resolveGoodsPrice(draft({ discountValue: '3000' }))).toMatchObject({ price: '10000', compareAtPrice: '' });
    expect(resolveGoodsPrice(draft({ regularPrice: '' }))).toMatchObject({ price: '', compareAtPrice: '', salePrice: 0 });
  });

  it('할인 설정함은 판매가를 compareAtPrice로, 할인가를 price로 저장한다', () => {
    expect(resolveGoodsPrice(draft({ discountEnabled: true, discountValue: '3000' })))
      .toEqual({ price: '7000', compareAtPrice: '10000', regularPrice: 10000, discountAmount: 3000, salePrice: 7000, basePrice: 7000, period: null });
  });

  it('% 할인은 원 단위로 내리고 소수 둘째 자리까지 받는다', () => {
    expect(resolveGoodsPrice(draft({ regularPrice: '9900', discountEnabled: true, discountValue: '15', discountUnit: 'percent' })))
      .toMatchObject({ price: '8415', compareAtPrice: '9900', discountAmount: 1485 });
    expect(resolveGoodsPrice(draft({ regularPrice: '9999', discountEnabled: true, discountValue: '33.33', discountUnit: 'percent' })))
      .toMatchObject({ discountAmount: 3332, price: '6667' });
    expect(resolveGoodsPrice(draft({ regularPrice: '1000', discountEnabled: true, discountValue: '0.29', discountUnit: 'percent' })))
      .toMatchObject({ discountAmount: 2, price: '998' });
  });

  it('0 이하·판매가 이상의 할인은 오류로 막고 저장 값에 할인을 싣지 않는다', () => {
    for (const changes of [
      { discountValue: '0' }, { discountValue: '' }, { discountValue: '10000' }, { discountValue: '12000' }, { discountValue: '-1' },
      { discountValue: '1.5' }, { discountUnit: 'percent' as const, discountValue: '100' }, { discountUnit: 'percent' as const, discountValue: '0' },
      { discountUnit: 'percent' as const, discountValue: '12.345' },
    ]) {
      const result = resolveGoodsPrice(draft({ discountEnabled: true, ...changes }));
      expect(result.discountError, JSON.stringify(changes)).toBeTruthy();
      expect(result).toMatchObject({ price: '10000', compareAtPrice: '', discountAmount: 0 });
    }
    expect(resolveGoodsPrice(draft({ regularPrice: '50', discountEnabled: true, discountValue: '1', discountUnit: 'percent' })).discountError)
      .toContain('1원보다 작습니다');
    expect(resolveGoodsPrice(draft({ regularPrice: '', discountEnabled: true, discountValue: '100' })).discountError).toContain('판매가를 먼저');
  });

  it('잘못된 판매가는 원문을 price로 넘기고 오류를 표시한다', () => {
    expect(resolveGoodsPrice(draft({ regularPrice: '1.5' }))).toMatchObject({ price: '1.5', regularPrice: null, salePrice: null, regularPriceError: expect.any(String) });
    expect(resolveGoodsPrice(draft({ regularPrice: '2147483648' })).regularPriceError).toBeTruthy();
  });

  it('기존 상품은 compareAtPrice > price일 때 할인 설정함(차액 원)으로 연다', () => {
    expect(goodsPriceDraftFromValues({ price: '22000', compareAtPrice: '26000' }))
      .toEqual({ regularPrice: '26000', discountEnabled: true, discountValue: '4000', discountUnit: 'won', periodEnabled: false, periodStartsAt: '', periodEndsAt: '' });
    expect(goodsPriceDraftFromValues({ price: '22000', compareAtPrice: '' }))
      .toEqual({ regularPrice: '22000', discountEnabled: false, discountValue: '', discountUnit: 'won', periodEnabled: false, periodStartsAt: '', periodEndsAt: '' });
    expect(goodsPriceDraftFromValues({ price: '22000', compareAtPrice: '22000' })).toMatchObject({ regularPrice: '22000', discountEnabled: false });
    expect(goodsPriceDraftFromValues({ price: '0', compareAtPrice: '' })).toMatchObject({ regularPrice: '' });
  });

  /*
   * 2026-10-07 QA 결정: 서버는 판매가·할인가만 저장하고 할인 단위를 저장하지 않는다. 10%와 1,200원 할인(판매가 12,000원)은
   * 저장 값이 같아 구분할 수 없고, 정수 %로 나누어떨어진다고 %로 되짚으면 원으로 입력한 흔한 할인(1,000원 등)까지 %로 바뀌어
   * 판매가를 바꿀 때 입력하지 않은 방식으로 할인이 따라간다. 그래서 저장 값 그대로 원으로 열고, 할인 칸 도움말로 알린다.
   */
  it('저장된 % 할인은 결과 금액이 같은 원 할인으로 다시 연다', () => {
    const reopened = goodsPriceDraftFromValues({ price: '10800', compareAtPrice: '12000' });
    expect(reopened).toMatchObject({ regularPrice: '12000', discountEnabled: true, discountValue: '1200', discountUnit: 'won', periodEnabled: false });
    expect(resolveGoodsPrice(reopened)).toMatchObject({ price: '10800', compareAtPrice: '12000', discountAmount: 1200 });
    expect(goodsPriceDraftFromValues({ price: '9000', compareAtPrice: '10000' })).toMatchObject({ discountValue: '1000', discountUnit: 'won' });
  });

  it('실패·브라우저 복구의 화면 입력을 저장 값보다 먼저 되살린다', () => {
    const recovered = { price: '10000', compareAtPrice: '', regularPrice: '10000', discountEnabled: 'true', discountValue: '15', discountUnit: 'percent' };
    expect(goodsPriceDraftFromValues(recovered)).toEqual({ regularPrice: '10000', discountEnabled: true, discountValue: '15', discountUnit: 'percent',
      periodEnabled: false, periodStartsAt: '', periodEndsAt: '' });
    /* 복구된 화면 입력은 서버의 기간 할인 상태보다 먼저다(실패한 저장의 기간 입력을 그대로 되살린다). */
    expect(goodsPriceDraftFromValues({ ...recovered, discountPeriodEnabled: 'true', discountStartsAt: '2026-12-01T00:00', discountEndsAt: '2026-12-08T00:00' }, editable))
      .toMatchObject({ discountValue: '15', periodEnabled: true, periodStartsAt: '2026-12-01T00:00', periodEndsAt: '2026-12-08T00:00' });
    const opened = goodsPriceDraftFromValues({ price: '7000', compareAtPrice: '10000' });
    expect(resolveGoodsPrice(opened)).toMatchObject({ price: '7000', compareAtPrice: '10000' });
  });
});

const editable: GoodsInstantDiscountState = {
  state: 'editable', reason: null, fingerprint: 'f'.repeat(32), period: { amount: 1200, startsAt: '2026-11-30T15:00:00+00:00', endsAt: '2026-12-07T15:00:00+00:00' },
  summary: { count: 2, minPrice: 10800, maxPrice: 12800, startsAt: '2026-11-30T15:00:00+00:00', endsAt: '2026-12-07T15:00:00+00:00' }, promotions: [],
};
const BEFORE_DECEMBER = Date.parse('2026-11-12T00:00:00Z');

/* TKT-033(ADR-0040): 즉시할인 블록의 '특정기간만 할인'. 진실원은 옵션별 기간 할인 원장이고 저장 값(판매가)은 할인 전 그대로다. */
describe('즉시할인 기간', () => {
  it('즉시할인 10%·기간 12/1~12/7(한국 시간)은 판매가를 그대로 저장하고 금액·기간을 서버 지시로 보낸다', () => {
    const result = resolveGoodsPrice(draft({ regularPrice: '12000', discountEnabled: true, discountValue: '10', discountUnit: 'percent',
      periodEnabled: true, periodStartsAt: '2026-12-01T00:00', periodEndsAt: '2026-12-08T00:00' }), BEFORE_DECEMBER);
    expect(result).toEqual({ price: '12000', compareAtPrice: '', regularPrice: 12000, discountAmount: 1200, salePrice: 10800, basePrice: 12000,
      period: { amount: 1200, startsAt: '2026-11-30T15:00:00.000Z', endsAt: '2026-12-07T15:00:00.000Z' } });
    expect(JSON.parse(instantDiscountPeriodRequest(result, NEW_GOOD_INSTANT_DISCOUNT)))
      .toEqual({ mode: 'period', amount: 1200, startsAt: '2026-11-30T15:00:00.000Z', endsAt: '2026-12-07T15:00:00.000Z', expectedFingerprint: 'none' });
  });

  it('기간 입력이 비었거나 뒤집혔거나 이미 끝났으면 기간 오류이고 서버 지시에 기간을 싣지 않는다', () => {
    for (const [startsAt, endsAt, message] of [['', '2026-12-08T00:00', '모두 입력'], ['2026-12-08T00:00', '2026-12-01T00:00', '모두 입력'],
      ['2026-10-01T00:00', '2026-10-08T00:00', '이미 지났습니다'], ['2026-02-30T00:00', '2026-03-08T00:00', '모두 입력']] as const) {
      const result = resolveGoodsPrice(draft({ discountEnabled: true, discountValue: '1000', periodEnabled: true, periodStartsAt: startsAt, periodEndsAt: endsAt }), BEFORE_DECEMBER);
      expect(result.periodError, startsAt).toContain(message);
      expect(result).toMatchObject({ price: '10000', compareAtPrice: '', period: null });
    }
    /* 할인 금액 오류와 기간 오류는 함께 보인다. */
    expect(resolveGoodsPrice(draft({ discountEnabled: true, discountValue: '', periodEnabled: true }), BEFORE_DECEMBER)).toMatchObject({ discountError: expect.any(String), periodError: expect.any(String) });
  });

  it('기간을 끄면 지금 계약 그대로(정가 표시)이고 서버 지시는 none(이 상품 편집이 다루던 기간 할인을 멈춤)이다', () => {
    const result = resolveGoodsPrice(draft({ discountEnabled: true, discountValue: '1000', periodEnabled: false, periodStartsAt: '2026-12-01T00:00', periodEndsAt: '2026-12-08T00:00' }));
    expect(result).toMatchObject({ price: '9000', compareAtPrice: '10000', period: null });
    expect(JSON.parse(instantDiscountPeriodRequest(result, editable))).toEqual({ mode: 'none', expectedFingerprint: editable.fingerprint });
    /* 다른 곳에서 관리하는 할인(managed)·상태를 모름이면 지시를 보내지 않는다(지시 없는 저장). */
    expect(instantDiscountPeriodRequest(result, { ...editable, state: 'managed', reason: 'promotion', period: null })).toBe('');
    expect(instantDiscountPeriodRequest(result, null)).toBe('');
  });

  it('상품 편집이 다루는 기간 즉시할인은 판매가·원 할인·한국 시간 기간으로 다시 연다', () => {
    const reopened = goodsPriceDraftFromValues({ price: '12000', compareAtPrice: '' }, editable);
    expect(reopened).toEqual({ regularPrice: '12000', discountEnabled: true, discountValue: '1200', discountUnit: 'won', periodEnabled: true,
      periodStartsAt: '2026-12-01T00:00', periodEndsAt: '2026-12-08T00:00' });
    expect(resolveGoodsPrice(reopened, BEFORE_DECEMBER).period).toEqual({ amount: 1200, startsAt: '2026-11-30T15:00:00.000Z', endsAt: '2026-12-07T15:00:00.000Z' });
    /* 다른 곳에서 관리하는 할인은 기간으로 열지 않는다. */
    expect(goodsPriceDraftFromValues({ price: '12000', compareAtPrice: '' }, { ...editable, state: 'managed', reason: 'mixed', period: null })).toMatchObject({ discountEnabled: false, periodEnabled: false });
  });

  it('서버 상태 응답은 모양이 맞을 때만 쓴다', () => {
    expect(parseGoodsInstantDiscountState(editable)).toEqual(editable);
    expect(parseGoodsInstantDiscountState({ ...NEW_GOOD_INSTANT_DISCOUNT })).toEqual(NEW_GOOD_INSTANT_DISCOUNT);
    expect(parseGoodsInstantDiscountState({ ...editable, state: 'managed', reason: 'promotion', period: null, promotions: [{ id: 'p', name: '오픈 기획전' }] }))
      .toMatchObject({ state: 'managed', promotions: [{ id: 'p', name: '오픈 기획전' }] });
    for (const broken of [{ ...editable, period: null }, { ...editable, state: 'none' }, { ...editable, fingerprint: '' }, { ...editable, reason: 'other' }, null, []]) {
      expect(parseGoodsInstantDiscountState(broken)).toBeNull();
    }
  });

  it('서버 액션은 지시가 없으면 지시 없는 저장이고, 모양이 다르면 거절한다', () => {
    expect(parseInstantDiscountPeriodRequest(null)).toBe('absent');
    expect(parseInstantDiscountPeriodRequest('')).toBe('absent');
    expect(parseInstantDiscountPeriodRequest('{"mode":"none","expectedFingerprint":"none"}')).toEqual({ mode: 'none', expectedFingerprint: 'none' });
    expect(parseInstantDiscountPeriodRequest(JSON.stringify({ mode: 'period', amount: 1200, startsAt: '2026-11-30T15:00:00.000Z', endsAt: '2026-12-07T15:00:00.000Z', expectedFingerprint: 'none' })))
      .toMatchObject({ mode: 'period', amount: 1200 });
    for (const broken of ['{', '{"mode":"none"}', '{"mode":"none","expectedFingerprint":"none","amount":1}',
      JSON.stringify({ mode: 'period', amount: 0, startsAt: '2026-11-30T15:00:00Z', endsAt: '2026-12-07T15:00:00Z', expectedFingerprint: 'none' }),
      JSON.stringify({ mode: 'period', amount: 1, startsAt: '2026-11-30T15:00:00', endsAt: '2026-12-07T15:00:00Z', expectedFingerprint: 'none' }),
      JSON.stringify({ mode: 'period', amount: 1, startsAt: '2026-12-07T15:00:00Z', endsAt: '2026-11-30T15:00:00Z', expectedFingerprint: 'none' })]) {
      expect(parseInstantDiscountPeriodRequest(broken), broken).toBeNull();
    }
  });
});

describe('ERP 판매가 적용 계산', () => {
  it('옵션 미사용이면 판매가 칸에 넣고, 할인이 있으면 결과 할인가를 알린다', () => {
    expect(planErpSalePrice({ salePrice: 12000, mode: 'single', price: draft({ regularPrice: '' }) }))
      .toEqual({ ok: true, target: 'regularPrice', value: 12000, attention: false, message: '판매가에 ERP 판매가 12,000원을 넣었습니다.' });
    expect(planErpSalePrice({ salePrice: 12000, mode: 'single', price: draft({ discountEnabled: true, discountValue: '1000' }) }))
      .toMatchObject({ ok: true, target: 'regularPrice', value: 12000, attention: false, message: expect.stringContaining('할인가는 11,000원') });
  });

  /* 2026-10-07 리뷰: % 할인은 새 판매가로 다시 계산되므로 이전 할인 금액을 그대로 빼면 안내가 틀린다. */
  it('% 할인은 새 판매가로 다시 계산한 할인가를 알린다', () => {
    const plan = planErpSalePrice({ salePrice: 20000, mode: 'single', price: draft({ discountEnabled: true, discountValue: '10', discountUnit: 'percent' }) });
    expect(plan).toMatchObject({ ok: true, value: 20000, attention: false });
    if (!plan.ok) throw new Error();
    expect(plan.message).toContain('10%(2,000원)');
    expect(plan.message).toContain('할인가는 18,000원');
    expect(plan.message).not.toContain('19,000원');
  });

  it('새 판매가에 맞지 않는 할인과 남아 있는 기본 옵션 옵션가는 확인이 필요하다고 알린다', () => {
    const tooLarge = planErpSalePrice({ salePrice: 12000, mode: 'single', price: draft({ regularPrice: '20000', discountEnabled: true, discountValue: '15000' }) });
    expect(tooLarge).toMatchObject({ ok: true, value: 12000, attention: true, message: expect.stringContaining('할인 칸을 확인해주세요') });
    const extra = planErpSalePrice({ salePrice: 20000, mode: 'single', extraPrice: 1500, price: draft({ discountEnabled: true, discountValue: '10', discountUnit: 'percent' }) });
    expect(extra).toMatchObject({ ok: true, value: 20000, attention: true });
    if (!extra.ok) throw new Error();
    expect(extra.message).toContain('기본 옵션 옵션가 1,500원');
    expect(extra.message).toContain('19,500원');
  });

  it('옵션 사용 중이면 옵션가 = ERP 판매가 − 판매가(할인 전)이고 음수는 적용하지 않는다', () => {
    expect(planErpSalePrice({ salePrice: 13000, mode: 'multiple', price: draft() }))
      .toEqual({ ok: true, target: 'extraPrice', value: 3000, attention: false, message: '옵션가를 3,000원으로 맞춰 판매 13,000원이 되었습니다.' });
    expect(planErpSalePrice({ salePrice: 13000, mode: 'multiple', price: draft({ discountEnabled: true, discountValue: '10', discountUnit: 'percent' }) }))
      .toMatchObject({ ok: true, target: 'extraPrice', value: 3000 });
    expect(planErpSalePrice({ salePrice: 10000, mode: 'multiple', price: draft() })).toMatchObject({ ok: true, value: 0 });
    expect(planErpSalePrice({ salePrice: 9000, mode: 'multiple', price: draft() })).toMatchObject({ ok: false, error: expect.stringContaining('낮아') });
    /* 할인가(9,000원)보다는 높아도 판매가(할인 전)보다 낮으면 옵션가가 음수가 되어 적용하지 않는다. */
    expect(planErpSalePrice({ salePrice: 9500, mode: 'multiple', price: draft({ discountEnabled: true, discountValue: '1000' }) }))
      .toEqual({ ok: false, error: expect.stringContaining('판매가(할인 전) 10,000원보다 낮아') });
    expect(planErpSalePrice({ salePrice: 9000, mode: 'multiple', price: draft({ regularPrice: '1.5' }) })).toMatchObject({ ok: false });
    expect(planErpSalePrice({ salePrice: 9000, mode: 'multiple', price: draft({ discountEnabled: true, discountValue: '0' }) })).toMatchObject({ ok: false });
    expect(planErpSalePrice({ salePrice: -1, mode: 'single', price: draft() })).toMatchObject({ ok: false });
  });

  /* 2026-10-07 QA: 할인 중 옵션가를 할인가 기준으로 맞춰 그 옵션만 할인이 상쇄됐다(빨강 12,000원 · 파랑 10,800원). 옵션 미사용과 같은 의미로 맞춘다. */
  it('옵션 사용 중에도 ERP 판매가는 그 옵션의 할인 전 금액이고, 상품 할인은 그대로 적용해 할인 전·후 금액을 알린다', () => {
    const percent = draft({ regularPrice: '12000', discountEnabled: true, discountValue: '10', discountUnit: 'percent' });
    const same = planErpSalePrice({ salePrice: 12000, mode: 'multiple', price: percent });
    expect(same).toMatchObject({ ok: true, target: 'extraPrice', value: 0, attention: false });
    if (!same.ok) throw new Error();
    expect(same.message).toBe('옵션가를 0원으로 맞춰 할인 전 판매 12,000원(ERP 판매가)이 되었습니다. 상품 할인 10%(1,200원)이 그대로 적용되어 할인가는 10,800원입니다.');
    const higher = planErpSalePrice({ salePrice: 15000, mode: 'multiple', price: percent });
    expect(higher).toMatchObject({ ok: true, value: 3000 });
    if (!higher.ok) throw new Error();
    expect(higher.message).toContain('할인 전 판매 15,000원');
    expect(higher.message).toContain('할인가는 13,800원');
    const won = planErpSalePrice({ salePrice: 13000, mode: 'multiple', price: draft({ discountEnabled: true, discountValue: '2000' }) });
    expect(won).toMatchObject({ ok: true, value: 3000 });
    if (!won.ok) throw new Error();
    expect(won.message).toContain('상품 할인 2,000원이 그대로 적용되어 할인가는 11,000원입니다.');
    /* 옵션 미사용의 ERP 판매가도 할인 전 판매가다 — 두 모드의 결과 금액이 같다. */
    const single = planErpSalePrice({ salePrice: 12000, mode: 'single', price: percent });
    expect(single.ok && single.message).toContain('할인가는 10,800원');
  });

  /* 2026-10-07 리뷰: 판매가가 비어 있으면 ERP 판매가 전액이 옵션가가 되어, 나중에 판매가를 넣으면 이중으로 더해진다. */
  it('옵션 사용 중 판매가가 비었거나 0원이면 옵션가로 적용하지 않고 판매가를 먼저 입력하게 한다', () => {
    for (const regularPrice of ['', '0']) {
      expect(planErpSalePrice({ salePrice: 15000, mode: 'multiple', price: draft({ regularPrice }) }))
        .toEqual({ ok: false, error: expect.stringContaining('판매가를 먼저 입력해주세요') });
    }
  });
});
