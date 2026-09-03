import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildAdminIpList, normalizeAdminIpListFilters, type AdminIpListFilters } from '@/lib/admin/catalog-list';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import { IpConsole } from './IpConsole';

function ip(overrides: Partial<AdminIpRecord> & Pick<AdminIpRecord, 'id' | 'title'>): AdminIpRecord {
  return {
    archivedAt: null,
    sub: null,
    verticalKey: 'webtoon',
    tagline: null,
    synopsis: null,
    glyph: null,
    bg: null,
    imagePath: null,
    imageUrl: null,
    featured: false,
    fansCount: 0,
    ...overrides,
  };
}

const verticals = [{ key: 'webtoon', label: '웹툰' }, { key: 'character', label: '캐릭터' }];
const ips = [
  ip({ id: 'hwasan', title: '화산강림', featured: true, fansCount: 1200, imageUrl: 'https://cdn.example/hwasan.webp' }),
  ip({ id: 'old', title: '지난 IP', archivedAt: '2026-07-01T00:00:00.000Z' }),
];
const goods = [
  { ipId: 'hwasan', archivedAt: null },
  { ipId: 'hwasan', archivedAt: '2026-07-01T00:00:00.000Z' },
];

function render(filters: AdminIpListFilters) {
  return renderToStaticMarkup(
    <IpConsole
      filters={filters}
      list={buildAdminIpList(ips, goods, verticals, filters)}
      verticals={verticals}
    />,
  );
}

describe('IpConsole', () => {
  it('renders status chips, goods counts that lead to the goods list, and editor links', () => {
    const html = render(normalizeAdminIpListFilters({}));

    expect(html).toContain('aria-label="전체 2건"');
    expect(html).toContain('aria-label="운영 중 1건"');
    expect(html).toContain('aria-label="보관 1건"');
    expect(html).toContain('href="/admin/catalog/ips?selected=hwasan"');
    expect(html).toContain('href="/admin/catalog/goods?ip=hwasan"');
    expect(html).toContain('1<span class="muted"> / 2</span>');
    expect(html).toContain('1,200');
    expect(html).toContain('>대표<');
    expect(html).toContain('data-ip-status="archived"');
    expect(html).toContain('src="https://cdn.example/hwasan.webp"');
    expect(html).toContain('name="vertical"');
    expect(html).toContain('href="/admin/catalog/ips?sort=goods&amp;dir=desc"');
    expect(html).toContain('href="/admin/catalog/ips?selected=new"');
  });

  it('applies the tab and search from the URL', () => {
    const html = render(normalizeAdminIpListFilters({ tab: 'archived', query: '지난' }));

    expect(html).toContain('<input type="hidden" name="tab" value="archived"/>');
    expect(html).toContain('value="지난"');
    expect(html).toContain('href="/admin/catalog/ips?tab=archived&amp;query=%EC%A7%80%EB%82%9C&amp;selected=old"');
    expect(html).not.toContain('selected=hwasan');
    expect(html).toContain('1–1 / 전체 1건');
  });
});
