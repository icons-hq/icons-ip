// @vitest-environment node
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/production-actions', () => ({ readOrderProductionAction: vi.fn(), changeOrderProductionAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./screens/SellerClaimIntakeForm', () => ({ SellerClaimIntakeButton: () => <span data-seller-claim-intake-button="">판매자 직접 취소 접수</span> }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: vi.fn() }));
/* 로그인 확인은 이 시험의 대상이 아니다 — 확인이 끝난 모습으로 바로 그린다. */
vi.mock('@/components/claim-contact/ClaimContactSession', () => ({
  ClaimContactSession: ({ children }: { children: (identity: { actorId: string; sessionId: string }, scope: unknown) => ReactNode }) => children({ actorId: 'a', sessionId: 's' }, { capture: () => ({}), canApply: () => true }),
}));
import { OrderProductionPanel } from './OrderProductionPanel';
import type { OrderProduction, ProductionJob } from '@/lib/order-production';

const terms = { version: 1 as const, goodId: 'good-a', revision: 1, leadDays: 5, dayBasis: 'calendar' as const, closedDates: [], publicNote: '' };
const job = (overrides: Partial<ProductionJob>): ProductionJob => ({ id: 'c3a00000-0000-4002-8000-000000000061', itemId: 'c3a00000-0000-4002-8000-000000000062', claimId: null, goodId: 'good-a', goodName: '각인 키링',
  quantity: 2, revision: 1, state: 'pending', terms, basisAt: '2026-11-26T01:00:00Z', dueAt: '2026-12-01T01:00:00Z', startedAt: null, completedAt: null, canStart: true, canComplete: false, history: [], ...overrides });
const document = (jobs: ProductionJob[], overrides: Partial<OrderProduction> = {}): OrderProduction => ({ orderId: 'c3a00000-0000-4002-8000-000000000063', cancelReviewRequired: false, canCancel: false, jobs, ...overrides });
const render = (initial: OrderProduction, canManage = true) => renderToStaticMarkup(<OrderProductionPanel initial={initial} actorId="c3a00000-0000-4002-8000-000000000064" canManage={canManage} />);
const RETIRED = ['작업 확인 근거', '실제 제작 시작을 확인했습니다', '실제 제작 완료를 확인했습니다', '같은 요청으로 결과 확인', '현재 제작 현황 다시 확인', '상품별 실제 제작 시작·완료를 기록합니다'];

describe('주문제작 처리', () => {
  it('기록할 상품이 하나뿐이면 처음부터 골라져 있고, 확인 체크 없이 [제작 시작으로 기록]이다', () => {
    const html = render(document([job({})]));
    expect(html).toContain('<option value="c3a00000-0000-4002-8000-000000000061" selected="">각인 키링 · 제작 대기</option>');
    expect(html).toContain('제작 확인 내용 (필수)');
    expect(html).toContain('placeholder="예: 공방에서 제작 시작을 확인함"');
    expect(html).toContain('제작 처리 이력에 남습니다.');
    expect(html).toContain('제작 시작으로 기록</button>');
    expect(html).not.toContain('type="checkbox"');
    for (const text of RETIRED) expect(html, text).not.toContain(text);
  });
  it('제작 중인 상품은 [제작 완료로 기록]이고 예시 글도 완료에 맞춘다', () => {
    const html = render(document([job({ state: 'started', canStart: false, canComplete: true })]));
    expect(html).toContain('제작 완료로 기록</button>');
    expect(html).toContain('placeholder="예: 공방에서 제작 완료를 확인함"');
  });
  it('기록할 상품이 여럿이면 고르게 하고 고를 때까지 이유 한 줄과 함께 잠근다', () => {
    const html = render(document([job({}), job({ id: 'c3a00000-0000-4002-8000-000000000065', itemId: 'c3a00000-0000-4002-8000-000000000066', goodName: '각인 머그컵' })]));
    expect(html).toContain('<option value="" selected="">선택해주세요</option>');
    expect(html).not.toMatch(/<option value="c3a[^"]+" selected/);
    expect(html).toContain('대상 상품을 고르면 누를 수 있습니다.');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>제작 기록<\/button>/);
  });
  it('지금 기록할 수 없는 상품은 그 줄에 이유를 보이고, 기록할 상품이 없으면 양식을 그리지 않는다', () => {
    const html = render(document([job({ canStart: false, basisAt: null, dueAt: null })]));
    expect(html).toContain('data-production-lock=""');
    expect(html).toContain('결제가 확인된 뒤에 시작할 수 있습니다.');
    expect(html).not.toContain('제작 상태 기록');
    const exchange = render(document([job({ canStart: false, claimId: 'c3a00000-0000-4002-8000-000000000067' })]));
    expect(exchange).toContain('교환 제작은 회수 확인(하자·오배송은 회수 생략 기록)을 마친 뒤에 할 수 있습니다.');
  });
  it('조회 권한만 있으면 이유도 양식도 그리지 않는다', () => {
    const html = render(document([job({ canStart: false, basisAt: null, dueAt: null })]), false);
    expect(html).not.toContain('data-production-lock');
    expect(html).not.toContain('제작 상태 기록');
  });
  it('취소 안내는 한 문단이고 판매자 직접 취소 접수 버튼이 따른다', () => {
    const html = render(document([job({})], { canCancel: true }));
    expect(html).toContain('취소는 접수한 뒤 검토합니다. 제작을 시작한 뒤에는 자동으로 환불하지 않습니다.');
    expect(html).toContain('data-seller-claim-intake-button');
  });
});
