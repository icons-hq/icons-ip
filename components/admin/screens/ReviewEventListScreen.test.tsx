import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewEventList } from '@/lib/review-events';
import { ReviewEventListScreen } from './ReviewEventListScreen';

vi.mock('../ReviewEventExportButton', () => ({ ReviewEventExportButton: () => null }));

const NOW = new Date('2026-11-09T03:00:00.000Z');
const event = {
  id: '11111111-1111-4111-8111-111111111111', number: 7, title: '가을 포토리뷰', description: '포토리뷰 작성 시 적립금 지급',
  state: 'closed', startsOn: '2026-10-20', endsOn: '2026-11-07', announcesOn: '2026-11-12', creditAmount: 3000, plannedWinners: 30,
  entryCount: 0, selectedCount: 0, awardedCount: 0, revokedCount: 0,
};
const render = (rows: Partial<typeof event>[]) => renderToStaticMarkup(<ReviewEventListScreen now={NOW}
  data={{ rows: rows.map(row => ({ ...event, ...row })), total: rows.length, filters: { query: '', state: 'all', dateField: 'created', from: '', to: '', page: 1, pageSize: 20 } } as unknown as ReviewEventList} />);

describe('ReviewEventListScreen', () => {
  /* 줄의 버튼이 왜 강조되는지 말한다 — 처리할 단계와 발표일까지 남은 날을 그 줄에 보인다. */
  it('응모마감 줄에 다음 할 일과 발표 D-day를 보인다', () => {
    const html = render([{}]);
    expect(html).toContain('당첨자 선정 필요');
    expect(html).toMatch(/data-tone="warning"[^>]*>D-3</);
  });

  it('발표일이 멀면 조용히 두고, 지난 발표대기는 위험색으로 보인다', () => {
    expect(render([{ announcesOn: '2026-11-20' }])).toMatch(/data-tone="neutral"[^>]*>D-11</);
    const late = render([{ state: 'ready', announcesOn: '2026-11-07' }]);
    expect(late).toContain('발표·지급 필요');
    expect(late).toMatch(/data-tone="danger"[^>]*>발표일 2일 지남</);
  });

  it('진행 중인 이벤트에는 할 일 표시를 달지 않는다', () => {
    const html = render([{ state: 'active' }]);
    expect(html).not.toContain('필요');
    expect(html).not.toMatch(/>D-\d+</);
  });
});
