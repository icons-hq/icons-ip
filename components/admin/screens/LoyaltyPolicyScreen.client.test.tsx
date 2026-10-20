import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { LoyaltyPolicyData } from '@/lib/loyalty-policy';
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), states: [] as unknown[], index: 0 }));
vi.mock('@/app/admin/loyalty-policy-actions', () => ({ saveLoyaltyPolicyAction: mocks.save, readLoyaltyPolicyAction: mocks.read }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  } };
});
import { LoyaltyPolicyScreen } from './LoyaltyPolicyScreen';
type Element = ReactElement<Record<string, unknown>>;
const data: LoyaltyPolicyData = { policy: { revision: 1, updatedAt: '2026-10-13T00:00:00Z', tiers: [
  { grade: 'silver', enabled: true, amount: 100000, itemCount: 2 },
  { grade: 'gold', enabled: true, amount: 300000, itemCount: 5 },
  { grade: 'platinum', enabled: true, amount: 1000000, itemCount: 10 },
] }, coupons: [] };
function render(props = data) { mocks.index = 0; return LoyaltyPolicyScreen({ data: props }) as Element; }
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }
function text(node: ReactNode): string { return Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join(''); }
function button(label: string) { const found = nodes(render()).find(node => node.type === 'button' && (text(node.props.children as ReactNode) === label || node.props['aria-label'] === label)); if (!found) throw new Error(`Missing button ${label}`); return found; }
function click(label: string) { (button(label).props.onClick as () => void)(); }
function field(id: string) { return nodes(render()).find(node => (node.type === 'input' || node.type === 'select') && node.props.id === id)!; }
function change(id: string, value: string) { (field(id).props.onChange as (event: unknown) => void)({ target: { value } }); }
function submit() { return (nodes(render()).find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }); }
function applyCondition() { (nodes(render()).find(node => node.type === 'form' && node.props.className === 'admin-loyalty-policy__editor')!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); }
function customAmount(grade: string, value: string) { click(`${grade.toUpperCase()} 조건 수정`); change(`loyalty-${grade}-amount-preset`, 'custom'); change(`loyalty-${grade}-amount`, value); applyCondition(); }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.index = 0; });
it('충돌 후 최신 정책을 별도로 비교하며 초안과 편집 기준 버전을 보존한다', async () => {
  customAmount('silver', '110000');
  mocks.save.mockResolvedValueOnce({ error: '다른 관리자가 변경했습니다.', conflict: true }); await submit();
  const latest = { ...data, policy: { ...data.policy, revision: 2, tiers: data.policy.tiers.map(tier => tier.grade === 'silver' ? { ...tier, amount: 120000 } : tier) } };
  expect(text(render(latest))).toContain('110,000원 이상');
  mocks.read.mockResolvedValueOnce({ data: latest }); click('최신 정책과 비교'); await settle();
  expect(text(render())).toContain('110,000원 이상'); expect(text(render())).toContain('120,000원 이상');
  click('내 입력 유지하고 최신 버전으로 저장 준비');
  mocks.save.mockResolvedValueOnce({ receipt: { revision: 3, updatedAt: '2026-10-13T03:00:00Z' } }); await submit();
  expect(mocks.save.mock.calls[1][0][0].amount).toBe(110000); expect(mocks.save.mock.calls[1][1]).toBe(2);
  expect(mocks.save.mock.calls[1][2]).not.toBe(mocks.save.mock.calls[0][2]);
});
it('전송이 불명확하면 입력을 잠그고 동일 UUID·입력·버전으로만 재확인한다', async () => {
  customAmount('silver', '110000'); mocks.save.mockRejectedValueOnce(new Error('transport'));
  await submit(); expect(button('등급 조건 저장').props.disabled).toBe(true);
  expect(button('SILVER 조건 수정').props.disabled).toBe(true); click('SILVER 조건 수정');
  expect(field('loyalty-silver-amount')).toBeUndefined(); expect(text(render())).toContain('110,000원 이상');
  mocks.save.mockResolvedValueOnce({ receipt: { revision: 2, updatedAt: '2026-10-13T03:00:00Z' } });
  click('같은 요청으로 저장 결과 확인'); await settle();
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]); expect(button('등급 조건 저장').props.disabled).toBe(false);
  expect(text(render())).toContain('다음 결제 확정·취소 또는 수동 재산정');
});
it('잘못된 등급 순서를 저장하지 않으며 예시의 금액 OR 항목 수가 상위 등급을 찾는다', async () => {
  const toggle = nodes(render()).find(node => node.type === 'input' && node.props['aria-label'] === 'SILVER 등급 사용')!;
  (toggle.props.onChange as (event: unknown) => void)({ target: { checked: false } }); await submit(); expect(mocks.save).not.toHaveBeenCalled();
  (toggle.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  change('loyalty-sample-amount', '0'); change('loyalty-sample-count', '10');
  expect(text(render())).toContain('예상 등급 PLATINUM');
  change('loyalty-sample-count', '0'); change('loyalty-sample-amount', '300000'); expect(text(render())).toContain('예상 등급 GOLD');
});
it('프리셋과 직접 입력을 왕복해도 작성값을 보존하고 취소는 원래 조건으로 돌아간다', () => {
  click('SILVER 조건 수정');
  change('loyalty-silver-amount-preset', 'custom'); change('loyalty-silver-amount', '135000');
  change('loyalty-silver-amount-preset', '50000'); change('loyalty-silver-amount-preset', 'custom');
  expect(field('loyalty-silver-amount').props.value).toBe('135000');
  change('loyalty-silver-count-preset', 'custom'); change('loyalty-silver-count', '4');
  change('loyalty-silver-count-preset', '5'); change('loyalty-silver-count-preset', 'custom');
  expect(field('loyalty-silver-count').props.value).toBe('4');
  click('취소'); expect(text(render())).toContain('100,000원 이상'); expect(text(render())).not.toContain('135,000원 이상');
});
it('직접 입력을 처음 선택하면 방금 고른 프리셋 값을 이어받는다', () => {
  click('SILVER 조건 수정'); change('loyalty-silver-amount-preset', '50000'); change('loyalty-silver-amount-preset', 'custom');
  expect(field('loyalty-silver-amount').props.value).toBe('50000');
  change('loyalty-silver-count-preset', '3'); change('loyalty-silver-count-preset', 'custom');
  expect(field('loyalty-silver-count').props.value).toBe('3');
});
it('조건 수정 창에서 상하위 금액 충돌을 설명하고 수정한 조건을 전체 저장 초안에 적용한다', () => {
  click('GOLD 조건 수정'); change('loyalty-gold-amount-preset', '50000'); applyCondition();
  expect(text(render())).toContain('상위 등급의 금액·항목 수가 하위 등급보다 큰지');
  change('loyalty-gold-amount-preset', '500000'); applyCondition();
  expect(text(render())).toContain('500,000원 이상'); expect(mocks.save).not.toHaveBeenCalled();
});
it('혜택 등록 링크에 해당 등급을 전달한다', () => {
  const hrefs = nodes(render()).map(node => node.props.href).filter(Boolean);
  expect(hrefs).toContain('/admin/sales/coupons/new?grade=silver');
  expect(hrefs).toContain('/admin/sales/coupons/new?grade=gold');
  expect(hrefs).toContain('/admin/sales/coupons/new?grade=platinum');
});
