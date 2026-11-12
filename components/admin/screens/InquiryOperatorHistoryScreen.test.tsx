import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { InquiryOperatorHistoryData } from '@/lib/admin/inquiry-operator-history';
import { normalizeInquiryOperatorHistoryFilters } from '@/lib/admin/inquiry-operator-history';
import { InquiryOperatorHistoryScreen } from './InquiryOperatorHistoryScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/admin/cs/operator-history', useSearchParams: () => new URLSearchParams() }));

const NOW = new Date('2026-11-12T03:00:00Z');
const A = 'a1050000-0000-4000-8000-000000000004';
const B = 'a1050000-0000-4000-8000-000000000005';
const data: InquiryOperatorHistoryData = { from: '2026-10-12', to: '2026-11-12', detail: null, operators: [
  { operatorId: A, name: '상담원 가', managerRole: 'deputy', answers: 12, closes: 3, reassignments: 0, inquiries: 9, lastAt: '2026-11-12T02:00:00Z' },
  { operatorId: B, name: '대행 나', managerRole: null, answers: 0, closes: 0, reassignments: 2, inquiries: 2, lastAt: '2026-11-11T02:00:00Z' },
] };
const render = (props: Partial<Parameters<typeof InquiryOperatorHistoryScreen>[0]> = {}) => renderToStaticMarkup(
  <InquiryOperatorHistoryScreen data={data} filters={normalizeInquiryOperatorHistoryFilters({}, NOW)} {...props} />);

describe('운영자별 처리 이력 화면(1014-105)', () => {
  it('운영자마다 답변·완료·담당 변경·처리 문의·마지막 처리를 보이고 처리 목록으로 연결한다', () => {
    const html = render();
    for (const label of ['운영자', '역할', '답변', '완료', '담당 변경', '처리 문의', '마지막 처리', '처리 목록']) expect(html).toContain(label);
    expect(html).toContain('상담원 가'); expect(html).toContain('계정 부매니저'); expect(html).toContain('역할 미지정');
    expect(html).toContain(`href="/admin/cs/operator-history?from=2026-10-12&amp;to=2026-11-12&amp;operator=${A}"`);
    /* 열람이 기록된다는 사실과 집계 규칙을 화면이 먼저 말한다. */
    expect(html).toContain('이 화면을 조회할 때마다 열람 기록이 남습니다');
    expect(html).toContain('자동으로 종결된 문의는 운영자 완료에 넣지 않습니다');
    expect(html).not.toContain('처리 목록 페이지');
  });

  it('고른 운영자의 처리 목록에 문의 번호·제목·처리 종류·현재 상태를 최신순으로 보이고 문의 상세로 연결한다', () => {
    const html = render({ filters: normalizeInquiryOperatorHistoryFilters({ operator: B }, NOW), data: { ...data, detail: { operatorId: B, name: '대행 나', page: 1, pageSize: 50, total: 2, items: [
      { id: 'e1', at: '2026-11-11T02:00:00Z', kind: 'reassigned', inquiryId: 'a1050000-0000-4000-8000-000000000101', reference: 41, title: '배송 문의', status: 'closed', fromName: '상담원 가', toName: null },
      { id: 'e2', at: '2026-11-10T02:00:00Z', kind: 'reassigned', inquiryId: null, reference: null, title: null, status: null, fromName: null, toName: '상담원 가' },
    ] } } });
    expect(html).toContain('대행 나의 처리 목록'); expect(html).toContain('담당 변경 · 상담원 가 → 미배정'); expect(html).toContain('담당 변경 · 미배정 → 상담원 가');
    expect(html).toContain('href="/admin/cs/inquiries/a1050000-0000-4000-8000-000000000101"'); expect(html).toContain('#41 배송 문의');
    expect(html).toContain('삭제된 문의'); expect(html).toContain('보는 중'); expect(html).toContain('목록 닫기');
    expect(html).toMatch(/<nav aria-label="처리 목록 페이지"/);
  });

  /* 320 폭 가로 넘침(리뷰 지적): 조회 조건은 '검색 조건'으로 접어 두고, 펼쳐도 날짜 입력 줄이 접힌다(공유 조회 조건 부품은 그대로). */
  it('조회 조건은 기본 기간이면 접어 두고, 기간을 고르거나 바꿔 조회했으면 펼쳐 둔다', () => {
    const closed = render();
    expect(closed).toMatch(/<details class="group\/search min-w-0" data-cs-search="">/);
    expect(closed).toContain('검색 조건'); expect(closed).toContain('name="from"');
    expect(closed).toContain('[&amp;_[data-console-filter=period]&gt;div&gt;div:last-child]:flex-wrap');
    expect(render({ filters: normalizeInquiryOperatorHistoryFilters({ from: '2026-11-01', to: '2026-11-10' }, NOW) })).toMatch(/<details class="group\/search min-w-0" data-cs-search="" open="">/);
    expect(render({ filters: normalizeInquiryOperatorHistoryFilters({ from: 'x', to: 'y' }, NOW) })).toMatch(/<details class="group\/search min-w-0" data-cs-search="" open="">/);
    expect(render({ filters: normalizeInquiryOperatorHistoryFilters({ from: '2026-10-12', to: '2026-11-12', operator: A }, NOW) })).not.toMatch(/data-cs-search="" open=""/);
  });

  it('빈 기간과 바뀐 조회 기간을 구분해 알린다', () => {
    const empty = render({ data: { ...data, operators: [] } });
    expect(empty).toContain('이 기간에 문의를 처리한 운영자가 없습니다.');
    expect(empty).not.toContain('조회 기간을 최근 1개월로 바꿔 조회했습니다.');
    expect(render({ filters: normalizeInquiryOperatorHistoryFilters({ from: '2026-12-01', to: '2026-01-01' }, NOW) })).toContain('조회 기간을 최근 1개월로 바꿔 조회했습니다.');
  });
});
