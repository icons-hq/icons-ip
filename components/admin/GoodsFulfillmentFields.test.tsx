import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { GoodsFulfillmentFields, goodShippingFeeReadback } from './GoodsFulfillmentFields';

const origin = { id: '11111111-1111-4111-8111-111111111111', name: '김포', defaultCarrier: null, baseFee: 3000, freeThreshold: 50000, returnAddress: '김포 반품지', active: true } as GoodsFulfillmentOrigin;
const render = (value: Parameters<typeof GoodsFulfillmentFields>[0]['value'], extra: Partial<Parameters<typeof GoodsFulfillmentFields>[0]> = {}) =>
  renderToStaticMarkup(<GoodsFulfillmentFields origins={[origin]} value={value} {...extra} />);
/** 배송비 유형 카드의 라디오(값·선택 여부) */
const radios = (html: string) => [...html.matchAll(/<input[^>]*type="radio"[^>]*name="shippingFeeType"[^>]*>/g)].map(([tag]) => ({ value: tag.match(/value="([^"]*)"/)?.[1], checked: /\bchecked=""/.test(tag) }));
const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('출고지·배송비', () => {
  /* 2026-11-25 '글보다 화면': 고르기 전에 세 선택지의 차이가 카드에 보이고, 고른 값으로 계산한 배송비를 한 줄로 되읽어 준다. */
  it('배송비 유형은 세 장의 선택 카드이고 이름은 가이드와 같다', () => {
    const html = render({ originId: origin.id, shippingFeeType: 'free', individualFee: 0 });
    expect(html).toMatch(/<legend[^>]*>배송비 유형<\/legend>/);
    expect(html).not.toMatch(/<select[^>]*name="shippingFeeType"/);
    expect(radios(html)).toEqual([{ value: 'policy', checked: false }, { value: 'free', checked: true }, { value: 'individual', checked: false }]);
    for (const title of ['출고지 정책 따름', '무료배송', '개별 배송비']) expect(html).toContain(title);
  });

  it('출고지 정책을 따르면 고른 출고지의 기본 배송비와 무료 기준을 되읽는다', () => {
    const html = render({ originId: origin.id, shippingFeeType: 'policy', individualFee: 0 });
    expect(text(html.slice(html.indexOf('data-good-shipping-policy')))).toContain('배송비 3,000원 · 50,000원 이상 무료');
    expect(html).toContain('/admin/settings/origins');
  });

  it('무료배송과 개별 배송비도 지금 값으로 되읽고, 개별은 수량·옵션과 관계없이 한 번이라고 말한다', () => {
    const free = text(render({ originId: origin.id, shippingFeeType: 'free', individualFee: 2500 }));
    expect(free).toContain('배송비 무료');
    expect(free).not.toContain('한 번만 받습니다');
    const individual = text(render({ originId: origin.id, shippingFeeType: 'individual', individualFee: 2500 }));
    expect(individual).toContain('배송비 2,500원');
    expect(individual).toContain('수량·옵션이 여러 개여도 한 번만 받습니다.');
  });

  it('출고지를 고르지 않았으면 0원으로 쓰지 않고 고르라고 한다', () => {
    const html = render({ originId: null, shippingFeeType: 'policy', individualFee: 0 });
    expect(html).toContain('<option value="" selected="">고르지 않음');
    expect(text(html)).toContain('출고지를 고르면 배송비가 정해집니다');
    expect(text(html)).not.toContain('배송비 0원');
  });

  it('개별 배송비 칸은 다른 유형에서도 값을 지우지 않고 보관해 같은 값으로 제출한다', () => {
    const html = render({ originId: origin.id, shippingFeeType: 'policy', individualFee: 3700 });
    expect(html).toMatch(/<div hidden=""><div[^>]*data-admin-kit="form-grid"><div[^>]*>[\s\S]*name="individualFee"[^>]*value="3700"/);
    const open = render({ originId: origin.id, shippingFeeType: 'individual', individualFee: 3700 });
    expect(open).not.toMatch(/<div hidden=""><div[^>]*data-admin-kit="form-grid"><div[^>]*>[\s\S]*name="individualFee"/);
  });

  it('지역 추가료 요약은 출고지 설정에서 가져오고 없으면 확인하라고 한다', () => {
    const summary = { originId: origin.id, label: '지역 추가료 정책 없음 · 기본 배송비만 적용', detail: '', checkedAt: '2026-11-25T00:00:00Z' };
    expect(text(render({ originId: origin.id }, { regionSummaries: [summary] }))).toContain('지역 추가료 정책 없음 · 기본 배송비만 적용 ·');
    expect(text(render({ originId: origin.id }))).toContain('지역별 추가배송비 확인 필요 · 지역별 추가배송비 화면에서 적용 중인지 확인해주세요.');
    expect(text(render({ originId: origin.id }))).toContain('이미 받은 주문의 배송비와 반품 주소는 바뀌지 않습니다.');
  });

  it('저장 오류는 카드 아래와 개별 배송비 칸에 붙인다', () => {
    const html = render({ originId: origin.id, shippingFeeType: 'individual', individualFee: 0 }, { errors: { shippingFeeType: '배송비 유형을 확인해주세요.', individualFee: '0원 이상으로 입력해주세요.' } });
    expect(html).toContain('id="good-shipping-type-error" role="alert">배송비 유형을 확인해주세요.');
    expect(html).toContain('id="good-individual-fee-error" role="alert">0원 이상으로 입력해주세요.');
    expect(html.match(/aria-describedby="good-shipping-type-error"/g)).toHaveLength(3);
  });

  it('사용 안 함인 출고지는 배송비 옆에 확인이 필요하다고 알린다', () => {
    expect(goodShippingFeeReadback({ feeType: 'policy', origin: { ...origin, active: false }, individualFee: 0 })).toContain('사용 안 함인 출고지 (확인 필요)');
    expect(goodShippingFeeReadback({ feeType: 'policy', origin: { ...origin, freeThreshold: null }, individualFee: 0 })).toBe('배송비 3,000원 · 무료 기준 없음');
  });
});
