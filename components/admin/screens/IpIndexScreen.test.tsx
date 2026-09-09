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
    expect(html).toContain('admin-console-grid-table');
    expect(html).toContain('IP 이름·ID');
    expect(html).toContain('name="vertical"');
    expect(html).toContain('href="/admin/catalog/ips/hwasan"');
    expect(html).toContain('href="/admin/catalog/ips?create=1"');
  });
});
