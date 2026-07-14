import { describe, expect, it } from 'vitest';
import {
  mapReserveTicketsError,
  normalizeReserveTicketsInput,
  normalizeTicketReference,
  ticketCheckoutState,
  ticketOrderName,
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
