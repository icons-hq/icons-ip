import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

/* 상태 훅은 그린 순서대로 값을 미리 넣는다(검색 결과·고른 목록). 대상 고르기 → 카테고리 → IP 순서로 그린다. */
const hooks = vi.hoisted(() => ({ preset: new Map<number, unknown>(), index: 0 }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => {
    const index = hooks.index++;
    return [hooks.preset.has(index) ? hooks.preset.get(index) : typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()];
  } };
});
vi.mock('@/app/admin/coupon-target-actions', () => ({ searchCouponTargetGoodsAction: vi.fn(), searchCouponCategoriesAction: vi.fn(), searchCouponIpsAction: vi.fn() }));
import { CouponTargetingFields } from './CouponTargetingFields';
import { CouponCategoryPicker } from './CouponCategoryPicker';
import { CouponIpPicker } from './CouponIpPicker';

const good = (id: string) => ({ id, code: id.toUpperCase(), name: `${id} 상품` });
beforeEach(() => { hooks.preset = new Map(); hooks.index = 0; });
const fields = (props: Partial<Parameters<typeof CouponTargetingFields>[0]> = {}) => { hooks.index = 0;
  return renderToStaticMarkup(<CouponTargetingFields recipientSegment="all" goodsScope="all" targetIds="[]" targetGoods={[]} {...props} />); };
const buttonFor = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`, 'g')) ?? [];

/* 1027T-026: 발급한 혜택은 발급 방식을 바꿀 수 없다 — 잠긴 고객지정 카드 옆에 그 이유를 적는다. */
it('발급한 혜택의 잠긴 타겟팅 카드에 이유를 잇는다', () => {
  const html = fields({ modeLocked: true, issuanceMode: 'code' });
  expect(html).toContain('이미 발급한 혜택이라 고객지정으로 바꿀 수 없습니다. 고객지정 혜택은 새로 등록해주세요.');
  const targeted = html.match(/<input[^>]*value="targeted"[^>]*>/)?.[0] ?? '';
  expect(targeted).toContain('aria-describedby="coupon-target-locked"');
  expect(targeted).toContain('disabled=""');
  expect(fields({ modeLocked: true, issuanceMode: 'targeted' })).toContain('이미 발급한 고객지정 혜택이라 다른 타겟팅 대상으로 바꿀 수 없습니다.');
  expect(fields()).not.toContain('coupon-target-locked');
});

it('검색 결과에서 이미 고른 상품은 "선택됨"으로 잠기고, 상한에 닿으면 이유를 알린다', () => {
  hooks.preset.set(1, 'selected_goods');
  hooks.preset.set(2, [good('g1')]);
  hooks.preset.set(4, { ok: true, items: [good('g1'), good('g2')], total: 2, page: 1, pageSize: 20 });
  const html = fields({ goodsScope: 'selected_goods' });
  expect(buttonFor(html, '선택됨')).toHaveLength(1);
  expect(buttonFor(html, '선택됨')[0]).toContain('disabled=""');
  expect(buttonFor(html, '선택')[0]).not.toContain('disabled=""');

  hooks.preset.set(2, Array.from({ length: 1000 }, (_, index) => good(`p${index}`)));
  expect(fields({ goodsScope: 'selected_goods' })).toContain('상품은 1,000개까지 고를 수 있습니다.');
});

it('카테고리·IP 검색 결과도 고른 항목은 "선택됨", 100개 상한에서는 이유를 보인다', () => {
  hooks.preset.set(0, [{ id: '93000000-0000-4000-8000-000000000001', name: '키링', path: '굿즈 > 키링', blocked: false }]);
  hooks.preset.set(2, { ok: true, items: [{ id: '93000000-0000-4000-8000-000000000001', name: '키링', path: '굿즈 > 키링', blocked: false }], total: 1, page: 1, pageSize: 20 });
  hooks.index = 0;
  const category = renderToStaticMarkup(<CouponCategoryPicker active targetIds="[]" categories={[]} />);
  const picked = category.match(/<button[^>]*>선택됨<\/button>/)?.[0] ?? '';
  expect(picked).toContain('aria-label="굿즈 &gt; 키링 선택됨"');
  expect(picked).toContain('disabled=""');

  hooks.preset = new Map<number, unknown>([[0, Array.from({ length: 100 }, (_, index) => ({ id: `ip-${index}`, title: `IP ${index}`, blocked: false }))], [2, { ok: true, items: [{ id: 'ip-new', title: '새 IP', blocked: false }], total: 1, page: 1, pageSize: 20 }]]);
  hooks.index = 0;
  const ip = renderToStaticMarkup(<CouponIpPicker active targetIds="[]" ips={[]} />);
  expect(ip).toContain('IP는 100개까지 고를 수 있습니다.');
  const blocked = ip.match(/<button[^>]*aria-label="새 IP 선택"[^>]*>/)?.[0] ?? '';
  expect(blocked).toContain('disabled=""');
});
