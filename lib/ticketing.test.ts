import { describe, expect, it } from 'vitest';
import {
  cancellationEligibility,
  groupTicketOrders,
  mapReserveTicketsError,
  normalizeReserveTicketsInput,
  normalizeTicketReference,
  ticketCanShowQr,
  ticketCheckoutState,
  ticketOrderDisplayMeta,
  ticketOrderName,
  type TicketOrderListItem,
} from './ticketing';

const ticketTypeId = '7AD4C967-3D48-44DA-A665-64731AC33F62';
const reservationKey = '5CBCBFED-202D-4676-821A-7706398E57C0';

describe('ticketing reservation contract', () => {
  it('normalizes only a ticket type, positive quantity, and reservation key', () => {
    expect(normalizeReserveTicketsInput({
      ticketTypeId: ` ${ticketTypeId} `,
      qty: 2,
      reservationKey: ` ${reservationKey} `,
    })).toEqual({
      ticketTypeId: ticketTypeId.toLowerCase(),
      qty: 2,
      reservationKey: reservationKey.toLowerCase(),
    });
  });

  it.each([
    [{ ticketTypeId, qty: 0, reservationKey }],
    [{ ticketTypeId, qty: 1.5, reservationKey }],
    [{ ticketTypeId, qty: '2', reservationKey }],
    [{ ticketTypeId: 'not-a-uuid', qty: 2, reservationKey }],
    [{ ticketTypeId, qty: 2, reservationKey: 'not-a-uuid' }],
    [{ ticketTypeId, qty: 2, reservationKey, amount: 100 }],
    [null],
  ])('rejects malformed or browser-priced reservation input %#', (input) => {
    expect(normalizeReserveTicketsInput(input)).toBeNull();
  });

  it('normalizes UUID references and rejects non-UUID values', () => {
    expect(normalizeTicketReference(` ${ticketTypeId} `)).toBe(ticketTypeId.toLowerCase());
    expect(normalizeTicketReference('ticket-1')).toBeNull();
    expect(normalizeTicketReference(null)).toBeNull();
  });

  it.each([
    ['auth required', 'auth_required'],
    ['onboarding required', 'onboarding_required'],
    ['quantity must be positive', 'invalid_request'],
    ['reservation key required', 'invalid_request'],
    ['ticket type not found', 'not_bookable'],
    ['event not bookable', 'not_bookable'],
    ['paid ticket required', 'not_bookable'],
    ['sales not open', 'sales_not_open'],
    ['sold out', 'sold_out'],
    ['per-user limit exceeded', 'per_user_limit'],
    ['reservation conflict', 'conflict'],
    ['private database detail', 'unavailable'],
    [null, 'unavailable'],
  ] as const)('maps database error %s to safe code %s', (message, code) => {
    expect(mapReserveTicketsError(message)).toBe(code);
  });
});

describe('ticket checkout state', () => {
  const now = Date.parse('2026-07-14T12:00:00.000Z');
  const future = '2026-07-14T12:10:00.000Z';
  const past = '2026-07-14T11:59:59.000Z';

  it.each([
    ['pending', null, future, 'payable'],
    ['pending', 'failed', future, 'payable'],
    ['pending', 'pending', future, 'checking'],
    ['pending', 'paid', future, 'checking'],
    ['paid', null, past, 'complete'],
    ['canceled', null, future, 'closed'],
    ['pending', null, past, 'closed'],
    ['pending', null, null, 'closed'],
    ['pending', null, 'invalid-date', 'closed'],
  ] as const)(
    'maps order=%s payment=%s expiry=%s to %s',
    (orderStatus, paymentStatus, expiresAt, expected) => {
      expect(ticketCheckoutState(orderStatus, paymentStatus, expiresAt, now)).toBe(expected);
    },
  );

  it('builds a provider-safe order name without dropping the ticket type suffix', () => {
    expect(ticketOrderName('메이플 팝업', '7월 25일 오후 회차')).toBe('메이플 팝업 · 7월 25일 오후 회차');
    expect(ticketOrderName('메이플 팝업', '7월 25일 오후 회차', 2))
      .toBe('메이플 팝업 · 7월 25일 오후 회차 · 2매');

    const bounded = ticketOrderName('가'.repeat(100), '오후 회차');
    expect(bounded).toHaveLength(100);
    expect(bounded.endsWith(' · 오후 회차')).toBe(true);
    expect(ticketOrderName(' ', ' ')).toBe('ICONS 티켓');
  });
});

const now = Date.parse('2026-07-15T03:00:00.000Z');

function ticketOrder(overrides: Partial<TicketOrderListItem> = {}): TicketOrderListItem {
  return {
    id: '5cbcbfed-202d-4676-821a-7706398e57c0',
    eventId: 'maple-popup',
    eventTitle: '메이플 팝업',
    ticketTypeId,
    ticketTypeName: '7월 25일 오후 회차',
    qty: 2,
    total: 44000,
    status: 'paid',
    paymentStatus: 'paid',
    createdAt: '2026-07-14T02:00:00.000Z',
    startsAt: '2026-07-25T05:00:00.000Z',
    endsAt: '2026-07-25T08:00:00.000Z',
    location: '성수 ICONS 팝업',
    ticketStatuses: ['valid', 'valid'],
    cancellationRequest: null,
    refund: null,
    ...overrides,
  };
}

describe('my tickets presentation contract', () => {
  it.each([
    [ticketOrder({ status: 'pending', paymentStatus: null }), 'payment_pending', '결제 대기'],
    [ticketOrder(), 'usable', '사용 가능'],
    [ticketOrder({ ticketStatuses: ['used', 'used'] }), 'used', '사용 완료'],
    [ticketOrder({ cancellationRequest: { status: 'requested', requestedAt: '2026-07-15T02:00:00.000Z', completedAt: null, grossAmount: 44000, feeAmount: 0, refundAmount: 44000 } }), 'refund_pending', '환불 확인 중'],
    [ticketOrder({ status: 'canceled', ticketStatuses: ['refunded', 'refunded'], refund: { status: 'failed', amount: 44000, createdAt: '2026-07-15T02:30:00.000Z' } }), 'refund_pending', '환불 확인 중'],
    [ticketOrder({ status: 'canceled', ticketStatuses: ['refunded', 'refunded'], refund: { status: 'done', amount: 44000, createdAt: '2026-07-15T02:30:00.000Z' } }), 'refunded', '환불 완료'],
  ] as const)('maps a safe order summary to %s', (order, state, label) => {
    expect(ticketOrderDisplayMeta(order, now)).toMatchObject({ state, label });
  });

  it('groups usable, in-progress, and past tickets without changing newest-first order', () => {
    const orders = [
      ticketOrder({ id: 'used', ticketStatuses: ['used', 'used'], createdAt: '2026-07-14T00:00:00.000Z' }),
      ticketOrder({ id: 'pending', status: 'pending', paymentStatus: null, createdAt: '2026-07-15T01:00:00.000Z' }),
      ticketOrder({ id: 'usable', createdAt: '2026-07-15T02:00:00.000Z' }),
      ticketOrder({ id: 'refunded', status: 'canceled', ticketStatuses: ['refunded', 'refunded'], createdAt: '2026-07-13T00:00:00.000Z' }),
    ];

    expect(groupTicketOrders(orders, now)).toEqual({
      usable: [expect.objectContaining({ id: 'usable' })],
      current: [expect.objectContaining({ id: 'pending' })],
      past: [expect.objectContaining({ id: 'used' }), expect.objectContaining({ id: 'refunded' })],
    });
  });

  it('does not call an unpaid cancellation a refund or an expired unused ticket used', () => {
    expect(ticketOrderDisplayMeta(ticketOrder({
      status: 'canceled',
      paymentStatus: null,
      ticketStatuses: ['refunded', 'refunded'],
      refund: null,
    }), now)).toMatchObject({ state: 'refunded', label: '취소 완료' });

    expect(ticketOrderDisplayMeta(ticketOrder({
      endsAt: '2026-07-15T02:59:59.000Z',
      ticketStatuses: ['valid', 'valid'],
    }), now)).toMatchObject({ state: 'used', label: '이벤트 종료' });
  });

  it('allows only a future, wholly-unused pending or paid booking to request full cancellation', () => {
    expect(cancellationEligibility(ticketOrder(), now)).toEqual({ canCancel: true, reason: null });
    expect(cancellationEligibility(ticketOrder({ status: 'pending', paymentStatus: null }), now)).toEqual({ canCancel: true, reason: null });

    expect(cancellationEligibility(ticketOrder({ startsAt: null }), now)).toMatchObject({ canCancel: false, reason: 'schedule_unknown' });
    expect(cancellationEligibility(ticketOrder({ startsAt: '2026-07-15T02:59:59.000Z' }), now)).toMatchObject({ canCancel: false, reason: 'started' });
    expect(cancellationEligibility(ticketOrder({ ticketStatuses: ['valid', 'used'] }), now)).toMatchObject({ canCancel: false, reason: 'used' });
    expect(cancellationEligibility(ticketOrder({ cancellationRequest: { status: 'processing', requestedAt: '2026-07-15T02:00:00.000Z', completedAt: null, grossAmount: 44000, feeAmount: 0, refundAmount: 44000 } }), now)).toMatchObject({ canCancel: false, reason: 'active_request' });
  });

  it('shows QR only for paid valid tickets without an active cancellation request', () => {
    expect(ticketCanShowQr('paid', 'valid', null)).toBe(true);
    expect(ticketCanShowQr('pending', 'valid', null)).toBe(false);
    expect(ticketCanShowQr('paid', 'used', null)).toBe(false);
    expect(ticketCanShowQr('paid', 'refunded', null)).toBe(false);
    expect(ticketCanShowQr('paid', 'valid', 'needs_review')).toBe(false);
    expect(ticketCanShowQr('paid', 'valid', 'completed')).toBe(true);
  });
});
