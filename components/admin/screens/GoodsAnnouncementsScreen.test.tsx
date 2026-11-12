import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeGoodsAnnouncementFilters, type GoodsAnnouncementListRow } from '@/lib/admin/goods-announcements';
import { GoodsAnnouncementsScreen } from './GoodsAnnouncementsScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/admin/catalog/announcements', useSearchParams: () => new URLSearchParams() }));

const row = (fields: Partial<GoodsAnnouncementListRow>): GoodsAnnouncementListRow => ({ id: '00000000-0000-4000-8000-000000062211', reference: 1, title: '휴무 안내',
  category: 'general', device: 'all', placement: 'top', enabled: true, important: false, allGoods: true, startsAt: null, endsAt: null,
  revision: 1, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', state: 'shown', goodCount: 0, ...fields });

describe('상품공지사항 목록', () => {
  /* 1440 화면에서 수정일까지 들어오는 1084px 표를 지킨다 — 노출 위치는 열을 늘리지 않고 상세 하단 공지에만 제목 앞 표시로 둔다. */
  it('상세 하단 공지에만 제목 앞 표시를 붙이고 표 최소 폭을 늘리지 않는다', () => {
    const html = renderToStaticMarkup(<GoodsAnnouncementsScreen data={{ total: 2, filters: normalizeGoodsAnnouncementFilters({}), rows: [
      row({}), row({ id: '00000000-0000-4000-8000-000000062212', reference: 2, title: '교환·반품·배송 안내', placement: 'bottom', important: true }),
    ] }} />);
    expect(html).toContain('[&amp;_table]:min-w-[1084px]');
    expect(html).not.toContain('노출 위치');
    expect(html.match(/>상세 하단</g)).toHaveLength(1);
    const bodyRows = html.slice(html.indexOf('<tbody')).split('<tr ').slice(1);
    const bottomRow = bodyRows.find(markup => markup.includes('교환·반품·배송 안내'))!;
    const topRow = bodyRows.find(markup => markup.includes('휴무 안내'))!;
    expect(bottomRow).toMatch(/>중요<\/span><span[^>]*>상세 하단<\/span><span class="min-w-0 truncate">교환·반품·배송 안내</);
    expect(topRow).not.toContain('상세 하단');
  });
});
