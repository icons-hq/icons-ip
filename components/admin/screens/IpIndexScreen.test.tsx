import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IpIndexScreen } from './IpIndexScreen';

describe('IP index', () => {
  it('uses the console table, name/ID search, vertical filter and workspace links', () => {
    const html = renderToStaticMarkup(<IpIndexScreen data={{
      filters: { query: '화산', vertical: 'webtoon', page: 1, status: 'active' }, total: 1,
      verticals: [{ key: 'webtoon', label: '웹툰' }],
      ips: [{ id: 'hwasan', title: '화산강림', verticalKey: 'webtoon', publishedAt: null, archivedAt: null, featured: false, sortOrder: 1 }],
    }} />);
    expect(html).toContain('data-slot="table"');
    expect(html).toContain('IP 이름·ID');
    expect(html).toContain('name="vertical"');
    expect(html).toContain('href="/admin/catalog/ips/hwasan"');
    expect(html).toContain('href="/admin/catalog/ips?create=1"');
    expect(html).not.toContain('IP를 삭제했습니다');
  });

  /* S36-004 — 미사용 초안을 지운 뒤 돌아온 목록은 지운 내부 ID가 다시 발급되지 않음을 알린다. */
  it('confirms a deleted draft once after returning from the delete action', () => {
    const html = renderToStaticMarkup(<IpIndexScreen deletedId="test-ip" data={{
      filters: { query: '', vertical: '', page: 1, status: 'active' }, total: 0, verticals: [], ips: [],
    }} />);
    expect(html).toContain('data-admin-notice="success"');
    expect(html).toContain('IP를 삭제했습니다');
    expect(html).toContain('내부 ID test-ip는 다시 발급하지 않습니다.');
  });
});
