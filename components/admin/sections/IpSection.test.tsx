import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import { IpSection } from './IpSection';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../app/admin/archive-actions', () => ({
  archiveAdminCatalogRecordAction: vi.fn(),
  unarchiveAdminCatalogRecordAction: vi.fn(),
}));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

const ip: AdminIpRecord = {
  id: 'hwasan',
  archivedAt: null,
  title: '화산강림',
  sub: null,
  verticalKey: 'webtoon',
  tagline: null,
  synopsis: null,
  glyph: null,
  bg: null,
  imagePath: null,
  featured: false,
  fansCount: 0,
};

describe('IpSection', () => {
  it('uses the shared artwork field and states the horizontal key-art rule', () => {
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[]}
        selected={null}
        state={{}}
        verticals={[{ key: 'global', label: '글로벌 IP', color: '#2DE2FF' }]}
      />,
    );

    expect(html).toContain('data-artwork-kind="ip"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('가로형');
    expect(html).toContain('name="featured"');
    expect(html).toContain('type="hidden"');
    expect(html).toContain('value=""');
    expect(html).not.toContain('type="checkbox" name="featured"');
  });

  it('기존 IP의 featured 값을 보이지 않는 입력으로 보존한다', () => {
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[{ ...ip, featured: true }]}
        selected={{ ...ip, featured: true }}
        state={{}}
        verticals={[]}
      />,
    );

    expect(html).toContain('type="hidden" name="featured" value="on"');
    expect(html).not.toContain('type="checkbox" name="featured"');
  });

  it('shows the archive filter and archive control only for an existing IP', () => {
    const existing = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[ip]}
        selected={ip}
        state={{}}
        verticals={[]}
      />,
    );
    const creating = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[ip]}
        selected={null}
        state={{}}
        verticals={[]}
      />,
    );

    expect(existing).toContain('aria-label="보관 상태"');
    expect(existing).toContain('카탈로그 보관');
    expect(existing).toContain('name="kind"');
    expect(existing).toContain('value="ip"');
    expect(creating).not.toContain('카탈로그 보관');
  });

  it('labels an archived IP and offers restoration', () => {
    const archived = { ...ip, archivedAt: '2026-07-17T12:00:00.000Z' };
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[archived]}
        selected={archived}
        state={{}}
        verticals={[]}
      />,
    );

    expect(html).toContain('[보관] hwasan · 화산강림');
    expect(html).toContain('보관 복원');
    expect(html).toContain('>복원</button>');
  });

  /*
   * #183 — 운영자에게 CSS 를 물어보지 않는다. 기존 레코드의 배경 값은
   * 그대로 보존해야 아트워크 없는 레거시 화면이 깨지지 않는다.
   */
  it('hides the background CSS input while preserving the stored value', () => {
    const legacy = { ...ip, bg: 'url("/generated/ip/hwasan.png") center / cover no-repeat' };
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[legacy]}
        selected={legacy}
        state={{}}
        verticals={[]}
      />,
    );

    expect(html).not.toContain('배경 CSS');
    expect(html).toContain('name="bg"');
    expect(html).toContain('url(&quot;/generated/ip/hwasan.png&quot;) center / cover no-repeat');
  });

  it('takes the glyph as multi-line text instead of a typed escape sequence', () => {
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[]}
        selected={null}
        state={{}}
        verticals={[]}
      />,
    );

    expect(html).toMatch(/<textarea[^>]*name="glyph"/);
    expect(html).toContain('글리프 (줄바꿈 가능)');
  });
});
