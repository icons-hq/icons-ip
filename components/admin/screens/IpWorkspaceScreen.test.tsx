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
  it('어느 IP인지와 게시 상태를 머리에 모으고, 게시 상태를 바꾸는 곳으로 가는 길을 둔다', () => {
    const html = renderToStaticMarkup(<IpWorkspaceScreen data={data} />);
    expect(html).toMatch(/<h2 class="[^"]*text-xl[^"]*">화산강림<\/h2><span[^>]*data-tone="neutral"[^>]*>초안<\/span>/);
    expect(html).toContain('href="/admin/catalog/ips/hwasan#ip-publish"');
    expect(html).toContain('게시 상태 변경');
    expect(html).toContain('내부 ID(변경 불가) hwasan');
    expect(html).not.toContain('IP를 등록했습니다');
  });
  /* S36-003 — 등록 직후(?created=1)에는 시스템이 발급한 내부 ID를 알린다. */
  it('announces the system-issued internal ID right after registration', () => {
    const html = renderToStaticMarkup(<IpWorkspaceScreen created data={{ ...data, tab: 'basic', related: [], relatedTotal: 0 }} />);
    expect(html).toContain('data-admin-notice="success"');
    expect(html).toContain('IP를 등록했습니다');
    expect(html).toMatch(/내부 ID <code[^>]*>hwasan<\/code>는 시스템이 발급했고 바꿀 수 없습니다./);
  });
});
