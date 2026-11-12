import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

/* 등록 편집기를 함수로 불러 버튼 연결만 본다 — 상태는 초깃값, ref는 빈 상자, 이탈 경고는 빈 연결이다. */
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
    useRef: (value: unknown) => ({ current: value }), useCallback: (fn: unknown) => fn };
});
vi.mock('../useAdminLeaveGuard', () => ({ useAdminLeaveGuard: () => ({ formRef: () => undefined }) }));
vi.mock('@/app/admin/coupon-actions', () => ({ setAdminCouponStatusAction: vi.fn() }));
vi.mock('@/app/admin/coupon-target-actions', () => ({ searchCouponTargetGoodsAction: vi.fn() }));
import { CouponSection } from './CouponSection';
import { normalizeAdminCouponFilters } from '@/lib/admin/coupons';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const props = (draft: Record<string, string> | null) => ({ action: () => {}, draft, filters: normalizeAdminCouponFilters({}), onSelect: () => {}, pageSize: 20, pending: false, records: [], selected: null, state: {}, total: 0, mode: 'create' as const });
function editor(draft: Record<string, string> | null) {
  const element = nodes(CouponSection(props(draft))).find(node => typeof node.type === 'function' && node.type.name === 'CouponEditor')!;
  return nodes((element.type as (p: unknown) => ReactNode)(element.props));
}
const onClick = (tree: Element[], label: string) => tree.find(node => typeof node.props.onClick === 'function' && text(node.props.children as ReactNode) === label)?.props.onClick;

/* 1027T-027: 등록 단계 표시를 눌러도 아무 일이 없어 '할인·발급 조건'이 펼쳐지지 않았다. 단계 표시가 [다음]·[대상 설정으로]와 같은 동작을 한다. */
it('단계 표시는 버튼이고, 지금 단계를 aria-current로 알린다', () => {
  const html = renderToStaticMarkup(<CouponSection {...props(null)} />);
  const steps = html.match(/<ol aria-label="혜택 등록 단계".*?<\/ol>/s)?.[0] ?? '';
  expect(steps.match(/<button[^>]*type="button"/g)).toHaveLength(2);
  expect(steps).toMatch(/<li aria-current="step"[^>]*><button[^>]*>.*?대상 설정<\/button><\/li>/s);
  expect(steps).toMatch(/<li class="group\/step flex"><button[^>]*>.*?할인·발급 조건<\/button><\/li>/s);
});

it("'할인·발급 조건'은 [다음]과 같은 확인을 거쳐 펼치고, '대상 설정'은 [대상 설정으로]와 같다", () => {
  const first = editor(null);
  expect(onClick(first, '2할인·발급 조건')).toBeTypeOf('function');
  expect(onClick(first, '2할인·발급 조건')).toBe(onClick(first, '다음: 할인·발급 조건'));
  const second = editor({ name: '가을 혜택' });
  expect(onClick(second, '1대상 설정')).toBeTypeOf('function');
  expect(onClick(second, '1대상 설정')).toBe(onClick(second, '대상 설정으로'));
});
