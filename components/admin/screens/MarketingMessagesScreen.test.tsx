import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/admin/marketing-message-actions', () => ({ changeMarketingMessageAction: vi.fn(), exportMarketingMessagesAction: vi.fn() }));
import { normalizeMarketingFilters } from '@/lib/admin/marketing-messages';
import { MarketingMessagesScreen } from './MarketingMessagesScreen';

/* kit Button은 type을 주지 않으면 type="button"이라 폼을 제출하지 않는다 — 이력 조회(GET 폼)의 조회 버튼이 제출 버튼인지,
   조회 키(state·q·start·end)가 그대로인지 지킨다. */
it('메시지 이력 조회는 같은 조회 키로 GET 폼을 제출한다', () => {
  const html = renderToStaticMarkup(<MarketingMessagesScreen data={{ rows: [], total: 0, page: 1, pageSize: 20, filters: normalizeMarketingFilters({ q: '가을', state: 'draft' }) }} />);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>검색<\/button>/);
  for (const name of ['state', 'q', 'start', 'end']) expect(html).toContain(`name="${name}"`);
  expect(html).toContain('value="가을"');
  expect(html).toMatch(/<button[^>]*type="button"[^>]*disabled=""[^>]*>엑셀 다운로드<\/button>/);
  expect(html).toContain('조건에 맞는 메시지가 없습니다.');
});

/* 관리 열은 눌리는 버튼 모양이고 예약 취소는 위험 표시다. 상태 "확인 필요"는 무엇을 볼지 함께 말한다. */
it('관리 열 버튼과 확인 필요 상태의 도움말을 보인다', () => {
  const run = (state: string, reason: string | null) => ({ id: state, scheduledAt: '2026-11-10T00:00:00Z', state, reason, startedAt: null, completedAt: null, candidateCount: 1, sentCount: 0, excludedCount: 0, readCount: 0 });
  const row = (id: string, runs: unknown[]) => ({ id, name: '가을 소식', reference: 1, state: 'published', revision: 1, segmentName: '전체', createdAt: '2026-11-01T00:00:00Z', runs });
  const html = renderToStaticMarkup(<MarketingMessagesScreen data={{ rows: [row('msg-1', [run('queued', null)]), row('msg-2', [run('blocked', 'segment_changed')])] as never, total: 2, page: 1, pageSize: 20, filters: normalizeMarketingFilters({}) }} />);
  expect(html).toMatch(/<button[^>]*text-destructive[^>]*>예약 취소<\/button>/);
  expect(html).toMatch(/<a[^>]*data-slot="button"[^>]*href="[^"]*copy=msg-1"[^>]*>복사<\/a>/);
  expect(html).toContain('>확인 필요</span>');
  expect(html).toContain('세그먼트 변경·삭제');
});
