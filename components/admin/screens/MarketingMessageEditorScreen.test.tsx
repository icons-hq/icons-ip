import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/admin/marketing-message-actions', () => ({ changeMarketingMessageAction: vi.fn(), saveMarketingMessageAction: vi.fn(), searchMarketingProductsAction: vi.fn() }));
vi.mock('@/app/admin/customer-segment-actions', () => ({ estimateCustomerSegmentAction: vi.fn() }));
vi.mock('@/app/admin/marketing-attachment-actions', () => ({ sendMarketingTestAction: vi.fn() }));
import { MarketingMessageEditorScreen } from './MarketingMessageEditorScreen';

const run = (state: string) => ({ id: state, scheduledAt: '2026-11-19T04:29:00Z', state, reason: null, startedAt: null, completedAt: null, candidateCount: 0, sentCount: 0, excludedCount: 0, readCount: 0 });
const detail = (runs: unknown[]) => ({ id: 'msg-1', reference: 10, name: '골드 등급 전용 혜택', revision: 2, state: 'published', segmentName: '재구매 고객', exclusion: 'received', schedule: { kind: 'once', at: '2026-11-20T01:00:00Z' }, estimate: { consentedCount: 391 }, selectedProducts: [], coupon: null, content: { template: 'text', title: '소식', body: '본문', imagePath: null, goodIds: [], buttons: [] }, runs }) as never;

/* 예약 대기 중에 할 수 있는 일은 예약 취소뿐이다 — 상세에서 바로 멈출 수 있고, 복사는 제일 진한 버튼이 아니다. 언제 나가는지는 실제 회차 시각으로 말한다. */
it('예약 대기 상세는 예약 취소를 보이고 복사를 보조로 내리며 등록 시각을 먼저 말한다', () => {
  const html = renderToStaticMarkup(<MarketingMessageEditorScreen detail={detail([run('queued')])} />);
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>예약 취소<\/button>/);
  expect(html).not.toMatch(/<a[^>]*bg-primary[^>]*>복사해서 만들기<\/a>/);
  expect(html).toContain('2026. 11. 19. 13:29에 등록됩니다');
  expect(html).toContain('시작 전');
});

it('끝난 메시지에는 예약 취소가 없고 복사가 주 행동이다', () => {
  const html = renderToStaticMarkup(<MarketingMessageEditorScreen detail={detail([run('completed')])} />);
  expect(html).not.toContain('예약 취소');
  expect(html).toMatch(/<a[^>]*bg-primary[^>]*>복사해서 만들기<\/a>/);
});
