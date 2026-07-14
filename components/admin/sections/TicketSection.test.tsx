import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminTicketTypeRecord } from '@/lib/admin/catalog.server';
import { TicketSection } from './TicketSection';

vi.mock('@/components/ui/Icon', () => ({
  Icon: () => null,
}));
vi.mock('@/app/admin/actions', () => ({
  upsertAdminTicketTypeAction: vi.fn(),
}));

const ticketType: AdminTicketTypeRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  eventId: 'e100',
  eventTitle: '화산강림 팝업',
  name: '7월 25일 1회차',
  price: 25000,
  capacity: 80,
  sold: 12,
  hasTicketHistory: true,
  updatedAt: '2026-07-14T12:00:00.000Z',
};

function renderTicketSection(
  selected: AdminTicketTypeRecord | null,
  eventOptions = [{ id: 'e100', title: '화산강림 팝업' }],
  records: AdminTicketTypeRecord[] = [ticketType],
) {
  return renderToStaticMarkup(
    <TicketSection
      draftId="33333333-3333-4333-8333-333333333333"
      eventOptions={eventOptions}
      onSelect={vi.fn()}
      operationId="11111111-1111-4111-8111-111111111111"
      records={records}
      selected={selected}
    />,
  );
}

describe('TicketSection', () => {
  it('links to the standalone field check-in screen', () => {
    const html = renderTicketSection(ticketType);

    expect(html).toContain('href="/admin/check-in"');
    expect(html).toContain('현장 검표 화면 열기');
  });

  it('shows allocation status and locks historical metadata while keeping capacity editable', () => {
    const html = renderTicketSection(ticketType);

    expect(html).toContain('할당 12 / 80');
    expect(html).toContain('잔여 68');
    expect(html).toContain('잔여 있음');
    expect(html).toContain('결제 대기 포함');
    expect(html).toContain('name="operationId"');
    expect(html).toContain('name="id"');
    expect(html).toContain('name="eventId"');
    expect(html).toContain('name="capacity"');
    expect(html).toContain('min="12"');
    expect(html).not.toContain('name="sold"');
    expect(html).not.toContain('name="perUserLimit"');
    expect(html).not.toContain('name="salesOpenAt"');
    expect(html.match(/readOnly=""/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('role="textbox"');
    expect(html).toContain('aria-readonly="true"');
  });

  it('renders a deterministic create form and a sold-out state', () => {
    const createHtml = renderTicketSection(null);
    const soldOutHtml = renderTicketSection({ ...ticketType, capacity: 12 });

    expect(createHtml).toContain('value="33333333-3333-4333-8333-333333333333"');
    expect(createHtml).toContain('<select');
    expect(createHtml).toContain('required=""');
    expect(soldOutHtml).toContain('정원 마감');
  });

  it('disables creation when no event exists', () => {
    const html = renderTicketSection(null, []);

    expect(html).toContain('먼저 이벤트를 등록해주세요.');
    expect(html).toContain('<button');
    expect(html).toContain('disabled=""');
  });

  it('labels the session list and explains its empty state', () => {
    const html = renderTicketSection(null, [{ id: 'e100', title: '화산강림 팝업' }], []);

    expect(html).toContain('aria-label="티켓 회차 목록"');
    expect(html).toContain('등록된 티켓 회차가 없습니다.');
  });
});
