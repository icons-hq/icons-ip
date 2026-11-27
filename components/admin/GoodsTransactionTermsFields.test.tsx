import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { goodsTermsDraft, type GoodsTermsDraft } from '@/lib/admin/goods-transaction-terms';
import type { GoodsTransactionAdminTerms } from '@/lib/goods-transaction';
import { GoodsDeliveryRuleFields, GoodsVolumeDiscountFields } from './GoodsTransactionTermsPanel';

/* 패널의 서버 읽기·저장 액션은 이 화면 시험에서 쓰지 않는다(입력 부품만 그린다). */
vi.mock('@/app/admin/goods-transaction-terms-actions', () => ({ readGoodsTransactionTermsAction: vi.fn(), saveGoodsTransactionTermsAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

const base: GoodsTransactionAdminTerms = { goodId: 'terms-good', revision: 0, goodUpdatedAt: '2026-10-14T01:00:00.123456Z', volume: null, delivery: null };
const empty = goodsTermsDraft(base);
const volume = (patch: Partial<GoodsTermsDraft['volume']['fields']> & { status?: GoodsTermsDraft['volume']['status'] }): GoodsTermsDraft['volume'] =>
  ({ status: patch.status ?? 'active', fields: { ...empty.volume.fields, ...patch } });
const delivery = (patch: Partial<GoodsTermsDraft['delivery']['fields']> & { status?: GoodsTermsDraft['delivery']['status'] }): GoodsTermsDraft['delivery'] =>
  ({ status: patch.status ?? 'active', fields: { ...empty.delivery.fields, ...patch } });
const renderVolume = (value: GoodsTermsDraft['volume']) => renderToStaticMarkup(<GoodsVolumeDiscountFields value={value} onChange={() => {}} />);
const renderDelivery = (value: GoodsTermsDraft['delivery']) => renderToStaticMarkup(<GoodsDeliveryRuleFields value={value} onChange={() => {}} />);

describe('복수구매 할인 입력', () => {
  it('사용 안 함이면 입력을 닫고, 사용을 고르면 입력과 한 줄 요약이 열린다', () => {
    const off = renderVolume(volume({ status: 'disabled', threshold: '3', discountValue: '500' }));
    expect(off).toContain('복수구매 할인 사용');
    expect(off).not.toContain('type="number"');
    expect(off).not.toContain('data-good-readback');
    const on = renderVolume(volume({ threshold: '3', discountValue: '500' }));
    expect(on.match(/type="number"/g)).toHaveLength(2);
    expect(on).toContain('같은 상품을 3개 이상 사면 개당 500원씩 깎아 줍니다. 기간 제한 없이 항상 적용됩니다.');
    expect(on).toContain('저장하면 바로 결제에 적용됩니다.');
    /* 예전에 남은 초안(draft)은 적용되지 않으므로 사용 안 함으로 보인다. */
    expect(renderVolume(volume({ status: 'draft' }))).not.toContain('type="number"');
  });

  it('긴 설명 문단 대신 "?"로 개념을 풀고, 입력이 모자라면 요약을 그리지 않는다', () => {
    const on = renderVolume(volume({}));
    expect(on).toContain('data-admin-help=""');
    expect(on).not.toContain('data-good-readback');
    expect(on).not.toContain('옵션별 수량을 합산합니다');
  });
});

describe('이 상품만의 배송비 규칙 입력', () => {
  it('이름은 사실대로 풀어 쓰고 확장 배송비·상품 설정 같은 옛 이름이 없다', () => {
    const html = renderDelivery(delivery({ status: 'disabled' }));
    expect(html).toContain('이 상품만의 배송비 규칙');
    expect(html).toContain('배송·반품·결제 카드에서 정한 배송비를 그대로 받습니다.');
    for (const old of ['확장 배송비', '기본 상품의 배송비 설정 사용', '확장']) expect(html).not.toContain(old);
  });

  it('사용 안 함이면 아래 입력을 닫는다', () => {
    const off = renderDelivery(delivery({ status: 'disabled', kind: 'repeat', baseFee: '3000', interval: '2' }));
    expect(off).not.toContain('data-good-readback');
    expect(off).not.toContain('type="number"');
    expect(off).not.toContain('수량별 배송비');
    expect(off.match(/type="radio"/g)).toHaveLength(2);
  });

  it('수량마다 반복·구간 입력을 고르면 계산 결과를 예시로 되읽어 준다', () => {
    const repeat = renderDelivery(delivery({ kind: 'repeat', baseFee: '3000', interval: '2' }));
    expect(repeat).toContain('수량별 배송비 · 1~2개 3,000원 · 3~4개 6,000원 · 5~6개 9,000원 · …');
    expect(repeat).toContain('몇 개마다 (개)');
    const tier3 = renderDelivery(delivery({ kind: 'tier3', baseFee: '3000', firstLimit: '3', secondLimit: '5', extra1: '1000', extra2: '2500' }));
    expect(tier3).toContain('수량별 배송비 · 1~3개 3,000원 · 4~5개 4,000원 · 6개부터 5,500원');
    expect(tier3).toContain('둘째 구간을 넘으면 더하는 금액 (원)');
    /* 규칙에 맞지 않는 입력은 틀린 예시를 말하지 않는다. */
    expect(renderDelivery(delivery({ kind: 'tier3', baseFee: '3000', firstLimit: '5', secondLimit: '5', extra1: '1000', extra2: '2000' }))).not.toContain('수량별 배송비 ·');
  });

  it('선택 카드마다 같은 계산으로 만든 예시를 보인다', () => {
    const html = renderDelivery(delivery({}));
    expect(html).toContain('예) 1~2개 3,000원 · 3~4개 6,000원 · 5~6개 9,000원 · …');
    expect(html).toContain('예) 1~3개 3,000원 · 4개부터 4,000원');
    expect(html).toContain('예) 1~3개 3,000원 · 4~5개 4,000원 · 6개부터 5,500원');
  });

  it('배송비 결제 방법은 고객 화면과 같은 말로 되읽고, 착불·구매자 선택은 준비 안내와 이동 링크를 보인다', () => {
    const prepaid = renderDelivery(delivery({ paymentMode: 'prepaid' }));
    expect(prepaid).toContain('상품 상세에는 ‘배송비는 주문 시 선결제’로 보입니다.');
    expect(prepaid).not.toContain('data-good-collect-note');
    const collect = renderDelivery(delivery({ paymentMode: 'collect' }));
    expect(collect).toContain('배송비는 배송 시 결제(착불)');
    expect(collect).toMatch(/data-good-collect-note=""[^>]*>착불은 출고지에서 착불을 받을 준비가 돼 있어야 저장할 수 있습니다\./);
    expect(collect).toMatch(/<a[^>]*href="\/admin\/settings\/origins"[^>]*>배송정보 관리<\/a>/);
    expect(collect).toContain('착불 배송비는 온라인 환불에 포함되지 않습니다.');
    const choice = renderDelivery(delivery({ paymentMode: 'buyer_choice' }));
    expect(choice).toContain('주문서에서 배송비 선결제 또는 착불 선택');
    expect(choice).toContain('data-good-collect-note');
  });

  it('긴 설명 문단 대신 "?"를 달고, 지역별 추가배송비는 한 줄로만 말한다', () => {
    const html = renderDelivery(delivery({ kind: 'repeat', baseFee: '3000', interval: '2' }));
    expect(html.match(/data-admin-help=""/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('지역별 추가배송비는 따로 더해집니다.');
    expect(html).not.toContain('구간 방식은 기본 배송비에');
  });
});

/* W-1: 상품 수정 화면은 배송 설정 화면과 같은 낱말을 쓴다 — 지역에 따라 더 받는 배송비는 '지역별 추가배송비'다(옛말 '지역 추가 배송비'·'추가료'가 아니다). */
describe('수량별 배송비 한 줄 요약의 낱말', () => {
  it('지역에 따라 더 받는 배송비를 지역별 추가배송비라 부른다', () => {
    const html = renderDelivery(delivery({ kind: 'repeat', interval: '2', baseFee: '3000' }));
    expect(html).toContain('지역별 추가배송비는 따로 더해집니다.');
    expect(html).not.toMatch(/지역 추가 배송비|지역 추가료|추가료/);
  });
});
