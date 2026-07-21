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
});
