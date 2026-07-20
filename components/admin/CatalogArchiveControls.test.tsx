import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CatalogArchiveControl, CatalogArchiveFilter } from './CatalogArchiveControls';

vi.mock('../../app/admin/archive-actions', () => ({
  archiveAdminCatalogRecordAction: vi.fn(),
  unarchiveAdminCatalogRecordAction: vi.fn(),
}));

describe('CatalogArchiveFilter', () => {
  it('shows active, archived, and all counts through an accessible filter', () => {
    const html = renderToStaticMarkup(
      <CatalogArchiveFilter
        counts={{ active: 3, archived: 2, all: 5 }}
        filter="active"
        onChange={() => {}}
      />,
    );

    expect(html).toContain('aria-label="보관 상태"');
    expect(html).toContain('value="active" selected=""');
    expect(html).toContain('운영 중 3');
    expect(html).toContain('보관됨 2');
    expect(html).toContain('전체 5');
  });
});

describe('CatalogArchiveControl', () => {
  it('renders an explicit guard warning and archive action for active records', () => {
    const html = renderToStaticMarkup(
      <CatalogArchiveControl archivedAt={null} id="g1" kind="good" />,
    );

    expect(html).toContain('name="kind"');
    expect(html).toContain('value="good"');
    expect(html).toContain('name="id"');
    expect(html).toContain('value="g1"');
    expect(html).toContain('판매 재고나 활성 발급 정책이 남아 있으면 보관할 수 없습니다.');
    expect(html).toMatch(/<button[^>]*>[^<]*보관[^<]*<\/button>/);
  });

  it('renders restore copy for archived records', () => {
    const html = renderToStaticMarkup(
      <CatalogArchiveControl
        archivedAt="2026-07-17T00:00:00.000Z"
        id="c1"
        kind="card"
      />,
    );

    expect(html).toContain('보관된 항목을 공개 카탈로그로 복원합니다.');
    expect(html).toMatch(/<button[^>]*>[^<]*복원[^<]*<\/button>/);
  });
});
