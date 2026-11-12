import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import type { CouponIssueBatch } from '@/lib/admin/coupon-issuance';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/app/admin/coupon-issuance-actions', () => ({ executeCouponIssueAction: vi.fn(), findCouponIssueCustomersAction: vi.fn(), previewCouponIssueAction: vi.fn(), readCouponIssueAction: vi.fn() }));
vi.mock('@/app/admin/marketing-message-actions', () => ({ searchMarketingSegmentsAction: vi.fn() }));
/* 같은 로그인 세션으로 연 화면이다(세션 잠금은 이 테스트의 관심이 아니다). */
vi.mock('./GoodsGroupOperation', () => ({ useGoodsGroupSession: () => ({ blocked: false, current: () => true, deny: vi.fn() }) }));
import { CouponIssueWorkspace } from './CouponIssueWorkspace';

const coupon = { id: 'VIP-1000', code: 'VIP-1000', name: 'VIP 혜택' } as unknown as AdminCouponRecord;
const ACTOR = '94000000-0000-4000-8000-000000000001';
/* 시간 주입: 15분 유효 시간이 이미 지난 준비 작업. 서버가 canExecute=false로 읽어 준 상태를 그대로 넣는다. */
const batch = (overrides: Partial<CouponIssueBatch> = {}): CouponIssueBatch => ({
  id: '94000000-0000-4000-8000-000000000002', couponCode: 'VIP-1000', couponName: 'VIP 혜택', couponRevision: 1, targetKind: 'customers', segmentName: null,
  status: 'prepared', targetCount: 1, plannedCount: 1, existingCount: 0, invalidCount: 0, issuedCount: 0,
  createdAt: '2026-11-12T01:00:00.000Z', validUntil: '2026-11-12T01:15:00.000Z', finishedAt: null, error: null,
  rows: [{ userId: '94000000-0000-4000-8000-000000000003', userCouponId: null, nickname: '고객', reason: null }], canExecute: false, ...overrides,
});
const render = (props: Partial<Parameters<typeof CouponIssueWorkspace>[0]> = {}) =>
  renderToStaticMarkup(<CouponIssueWorkspace coupon={coupon} actorId={ACTOR} sessionId="94000000-0000-4000-8000-000000000004" {...props} />);
const executeButton = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*쿠폰 발급 확정<\/button>/s)?.[0] ?? '';

/* 1027T-026 ④: 만료됐거나 다른 세션이 만든 준비 작업은 [쿠폰 발급 확정]이 잠긴다. 이유와 다시 준비하는 방법을 버튼 옆에 적는다. */
it('확정할 수 없는 준비 작업이면 잠긴 이유와 [대상 다시 확인]을 보인다', () => {
  const html = render({ initial: batch() });
  expect(executeButton(html)).toContain('disabled=""');
  expect(executeButton(html)).toContain('aria-describedby="coupon-issue-execute-reason"');
  expect(html).toContain('이 확인 결과는 유효 시간(2026. 11. 12. 오전 10:15:00까지)이 지났거나 다른 로그인 세션·다른 운영자가 만든 작업이라 확정할 수 없습니다. [대상 다시 확인]을 누른 뒤 [발급 대상 확인]으로 새로 확인해주세요.');
  expect(html).toMatch(/<button[^>]*>대상 다시 확인<\/button>/);
});

it('확정할 수 있는 작업은 확인란이 남은 이유만 말하고, 다시 확인 버튼은 두지 않는다', () => {
  const html = render({ initial: batch({ canExecute: true, validUntil: '2099-01-01T00:00:00.000Z' }) });
  expect(executeButton(html)).toContain('disabled=""');
  expect(html).toContain('대상과 새 발급 수를 확인했다는 확인란에 체크하면 확정할 수 있습니다.');
  expect(html).not.toContain('대상 다시 확인');
  expect(render({ initial: batch({ status: 'completed', canExecute: false, issuedCount: 1, finishedAt: '2026-11-12T01:05:00.000Z' }) })).not.toContain('coupon-issue-execute-reason');
});

/* ②: 고객지정 혜택을 처음 저장하고 옮겨 오면 저장 결과와 남은 일을 맨 위에 보인다. */
it('저장하고 옮겨 왔으면 저장 결과를 맨 위에 보인다', () => {
  const html = render({ justSaved: true });
  expect(html).toContain('VIP-1000 쿠폰을 저장했습니다. 고객지정 혜택은 아래에서 대상을 확인하고 발급을 확정해야 쿠폰함에 들어갑니다.');
  expect(html.indexOf('쿠폰을 저장했습니다')).toBeLessThan(html.indexOf('발급 대상 선택'));
  expect(render()).not.toContain('쿠폰을 저장했습니다');
});
