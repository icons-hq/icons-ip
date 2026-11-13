import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import type { CouponIssueBatch } from '@/lib/admin/coupon-issuance';

/* 화면 함수를 직접 불러 [대상 다시 확인] 뒤 상태·포커스만 본다. 상태는 부른 순서대로 저장하고, ref는 그린 요소의 ref 속성으로 잡는다. */
const mocks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const refs: { current: unknown }[] = []; let refIndex = 0;
  return { ...actual,
    useState: (initial: unknown) => {
      const index = mocks.index++;
      if (index === 0) refIndex = 0;
      if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(mocks.states[index]) : next; }];
    },
    useRef: (initial: unknown) => { const index = refIndex++; return refs[index] ??= { current: initial }; },
    useTransition: () => [false, (fn: () => void) => fn()], useEffect: () => {},
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/app/admin/coupon-issuance-actions', () => ({ executeCouponIssueAction: vi.fn(), findCouponIssueCustomersAction: vi.fn(), previewCouponIssueAction: vi.fn(), readCouponIssueAction: vi.fn() }));
vi.mock('@/app/admin/marketing-message-actions', () => ({ searchMarketingSegmentsAction: vi.fn() }));
vi.mock('./GoodsGroupOperation', () => ({ useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: vi.fn() }) }));
import { CouponIssueWorkspace } from './CouponIssueWorkspace';
import { SegmentPicker } from './CustomerSegmentPicker';
import { Textarea } from '@/components/admin/kit/ui/textarea';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const coupon = { id: 'VIP-1000', code: 'VIP-1000', name: 'VIP 혜택' } as unknown as AdminCouponRecord;
const USERS = ['94000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000005'];
const batch = (overrides: Partial<CouponIssueBatch> = {}): CouponIssueBatch => ({
  id: '94000000-0000-4000-8000-000000000002', couponCode: 'VIP-1000', couponName: 'VIP 혜택', couponRevision: 1, targetKind: 'customers', segmentName: null,
  status: 'prepared', targetCount: 2, plannedCount: 2, existingCount: 0, invalidCount: 0, issuedCount: 0,
  createdAt: '2026-11-12T01:00:00.000Z', validUntil: '2026-11-12T01:15:00.000Z', finishedAt: null, error: null,
  rows: USERS.map(userId => ({ userId, userCouponId: null, nickname: '고객', reason: null })), canExecute: false, ...overrides,
});
let frames: (() => void)[] = [];
let initial: CouponIssueBatch;
const render = () => { mocks.index = 0; return nodes(CouponIssueWorkspace({ coupon, actorId: '94000000-0000-4000-8000-000000000001', sessionId: '94000000-0000-4000-8000-000000000004', initial })); };
const click = (label: string) => (render().find(node => typeof node.props.onClick === 'function' && text(node.props.children as ReactNode) === label)!.props.onClick as () => void)();
beforeEach(() => { mocks.states = []; frames = []; vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frames.push(callback); return frames.length; }); });
afterEach(() => { vi.unstubAllGlobals(); });

/* 1027T-026 ④ 리뷰: 다시 확인 뒤 결과 카드와 버튼이 사라져 포커스가 몸통으로 떨어졌다. 다시 고를 자리로 옮긴다. */
it('고객 지정 작업은 같은 고객을 다시 채우고 고객 ID 칸으로 포커스를 옮긴다', () => {
  initial = batch();
  click('대상 다시 확인');
  const tree = render();
  const ids = tree.find(node => node.type === Textarea)!;
  expect(ids.props.value).toBe(USERS.join('\n'));
  expect(tree.some(node => text(node.props.children as ReactNode) === '쿠폰 발급 확정')).toBe(false);
  const focus = vi.fn(); (ids.props.ref as { current: unknown }).current = { focus };
  frames.forEach(frame => frame());
  expect(focus).toHaveBeenCalledOnce();
});

it('세그먼트 작업은 세그먼트 선택으로 돌아가 이전 세그먼트 이름을 보이고 조회 칸으로 포커스를 옮긴다', () => {
  initial = batch({ targetKind: 'segment', segmentName: 'VIP 세그먼트' });
  click('대상 다시 확인');
  const tree = render();
  expect(tree.some(node => node.type === SegmentPicker)).toBe(true);
  expect(tree.some(node => node.type === Textarea)).toBe(false);
  const hint = tree.find(node => 'data-coupon-issue-segment-hint' in node.props)!;
  expect(text(hint.props.children as ReactNode)).toBe('이전 작업의 세그먼트는 VIP 세그먼트입니다. 아래에서 다시 조회해 골라 주세요.');
  const box = tree.find(node => node.type === 'div' && nodes(node.props.children as ReactNode).some(child => child.type === SegmentPicker))!;
  const focus = vi.fn(); (box.props.ref as { current: unknown }).current = { querySelector: () => ({ focus }) };
  frames.forEach(frame => frame());
  expect(focus).toHaveBeenCalledOnce();
  /* 세그먼트를 고르면 안내는 사라진다. */
  (render().find(node => node.type === SegmentPicker)!.props.onSelect as (value: unknown) => void)({ id: 'seg', revision: 1, name: 'VIP 세그먼트' });
  expect(render().some(node => 'data-coupon-issue-segment-hint' in node.props)).toBe(false);
});

it('입력 확인이 필요한 작업의 [대상 다시 확인]도 고객 ID 칸으로 포커스를 옮긴다', () => {
  initial = batch({ status: 'invalid', canExecute: false, error: 'coupon_issue_invalid_targets' });
  click('대상 다시 확인');
  const ids = render().find(node => node.type === Textarea)!;
  const focus = vi.fn(); (ids.props.ref as { current: unknown }).current = { focus };
  frames.forEach(frame => frame());
  expect(focus).toHaveBeenCalledOnce();
});
