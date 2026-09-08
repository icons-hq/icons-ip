import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminEventRecord } from '@/lib/admin/catalog.server';
import { EventSection } from './EventSection';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../app/admin/archive-actions', () => ({
  archiveAdminCatalogRecordAction: vi.fn(),
  unarchiveAdminCatalogRecordAction: vi.fn(),
}));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

const event: AdminEventRecord = {
  id: 'e100',
  archivedAt: null,
  ipId: null,
  title: '아이콘즈 페스티벌',
  mode: '오프라인',
  status: '종료',
  startsAt: null,
  endsAt: null,
  location: null,
  accent: null,
  bg: null,
  imagePath: null,
};

describe('EventSection', () => {
  it('restores failed input, raw KST times and uploaded artwork only for the submitted event', () => {
    const state = {
      attempt: 2,
      errors: { form: '다시 시도해주세요.' },
      values: {
        previousId: '', id: 'e200', ipId: 'lumen', title: '작성 중 이벤트',
        mode: '온라인', status: '예매중', startsAt: '2026-09-09T10:30', endsAt: '',
        location: '작성 중 장소', accent: '#123456', imagePath: 'artworks/event/kept.webp',
      },
    };
    const render = (selected: AdminEventRecord | null) => renderToStaticMarkup(
      <EventSection action={vi.fn()} ipOptions={[{ id: 'lumen', title: '루멘', archivedAt: null }]}
        onSelect={vi.fn()} pending={false} records={[event]} selected={selected} state={state} />,
    );
    const failed = render(null);
    expect(failed).toContain('value="e200"');
    expect(failed).toContain('value="작성 중 이벤트"');
    expect(failed).toContain('value="lumen" selected=""');
    expect(failed).toContain('value="온라인" selected=""');
    expect(failed).toContain('value="예매중" selected=""');
    expect(failed).toContain('value="2026-09-09T10:30"');
    expect(failed).toMatch(/name="endsAt"[^>]*value=""/);
    expect(failed).toContain('value="작성 중 장소"');
    expect(failed).toContain('value="#123456"');
    expect(failed).toContain('value="artworks/event/kept.webp"');
    const other = render(event);
    expect(other).toContain('value="아이콘즈 페스티벌"');
    expect(other).not.toContain('작성 중 이벤트');
    expect(other).not.toContain('artworks/event/kept.webp');
  });

  it('uses the shared artwork upload field', () => {
    const html = renderToStaticMarkup(
      <EventSection
        action={vi.fn()}
        ipOptions={[]}
        onSelect={vi.fn()}
        pending={false}
        records={[]}
        selected={null}
        state={{}}
      />,
    );

    expect(html).toContain('data-artwork-kind="event"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });

  it('shows archive status and restoration for an archived event', () => {
    const archived = { ...event, archivedAt: '2026-07-17T12:00:00.000Z' };
    const html = renderToStaticMarkup(
      <EventSection
        action={vi.fn()}
        ipOptions={[]}
        onSelect={vi.fn()}
        pending={false}
        records={[archived]}
        selected={archived}
        state={{}}
      />,
    );

    expect(html).toContain('aria-label="보관 상태"');
    expect(html).toContain('[보관] e100 · 아이콘즈 페스티벌');
    expect(html).toContain('보관 복원');
    expect(html).toContain('value="event"');
  });

  /* #183 — 액센트는 hex 타이핑이 아니라 색상 선택으로 받는다. */
  it('picks the accent as a colour and falls back to the platform accent', () => {
    const blank = renderToStaticMarkup(
      <EventSection
        action={vi.fn()}
        ipOptions={[]}
        onSelect={vi.fn()}
        pending={false}
        records={[]}
        selected={null}
        state={{}}
      />,
    );
    const stored = renderToStaticMarkup(
      <EventSection
        action={vi.fn()}
        ipOptions={[]}
        onSelect={vi.fn()}
        pending={false}
        records={[{ ...event, accent: '#FFD84D' }]}
        selected={{ ...event, accent: '#FFD84D' }}
        state={{}}
      />,
    );

    expect(blank).toContain('type="color"');
    expect(blank).toContain('value="#8B5CFF"');
    expect(blank).not.toContain('placeholder="#8B5CFF"');
    expect(stored).toContain('value="#FFD84D"');
  });
});
