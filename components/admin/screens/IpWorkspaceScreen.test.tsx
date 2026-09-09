import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminIpWorkspaceData } from '@/lib/admin/ip-workspace';
import { IpWorkspaceScreen } from './IpWorkspaceScreen';
vi.mock('@/app/admin/ip-directory-actions', () => ({ saveIpDirectoryAction: vi.fn() }));
const data: AdminIpWorkspaceData = {
  ip: { id: 'hwasan', title: '화산강림', verticalKey: 'webtoon', publishedAt: null, archivedAt: null,
    sub: null, tagline: null, synopsis: null, glyph: null, bg: null, imagePath: null, featured: false, fansCount: 0 },
  tab: 'goods', verticals: [], directory: [], related: [{ id: 'g1', title: '연결 상품', detail: '10,000원' }], relatedTotal: 1,
};
describe('IP workspace screen', () => {
  it('exposes five tabs and starts a new goods form with the workspace IP', () => {
    const html = renderToStaticMarkup(<IpWorkspaceScreen data={data} />);
    for (const label of ['기본정보', '상품', '카드풀', '이벤트', '노출']) expect(html).toContain(label);
    expect(html).toContain('href="/admin/catalog/goods?ipId=hwasan&amp;create=1"');
    expect(html).toContain('상품 등록');
    expect(html).toContain('연결 상품');
    expect(html).toContain('aria-current="page"');
  });
});
