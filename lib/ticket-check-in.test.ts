import { describe, expect, it } from 'vitest';
import {
  normalizeTicketQrToken,
  parseTicketCheckInRpcResult,
} from './ticket-check-in';

const QR_TOKEN = '0123456789abcdef0123456789abcdef';
const CHECKED_AT = '2026-07-15T03:45:00.000Z';

function rpcRow(overrides: Record<string, unknown> = {}) {
  return {
    result: 'checked_in',
    checked_at: CHECKED_AT,
    event_id: 'event-1',
    event_title: '화산강림 팝업',
    ticket_type_id: '22222222-2222-4222-8222-222222222222',
    ticket_type_name: '7월 25일 1회차',
    ...overrides,
  };
}

describe('normalizeTicketQrToken', () => {
  it('scanner transport whitespace만 앞뒤에서 제거한다', () => {
    expect(normalizeTicketQrToken(` \r\n\t${QR_TOKEN}\t \n`)).toBe(QR_TOKEN);
  });

  it.each([
    null,
    undefined,
    123,
    '',
    QR_TOKEN.toUpperCase(),
    `${QR_TOKEN.slice(0, 31)}g`,
    QR_TOKEN.slice(0, 31),
    `${QR_TOKEN}0`,
    `${QR_TOKEN.slice(0, 16)} ${QR_TOKEN.slice(16)}`,
    `\u00a0${QR_TOKEN}\u00a0`,
  ])('32자 lowercase hex가 아니면 거절한다: %p', (value) => {
    expect(normalizeTicketQrToken(value)).toBeNull();
  });
});

describe('parseTicketCheckInRpcResult', () => {
  it.each([
    ['checked_in', CHECKED_AT],
    ['already_used', CHECKED_AT],
    ['refunded', null],
  ] as const)('%s 단일 행을 browser-safe DTO로 변환한다', (status, checkedAt) => {
    expect(parseTicketCheckInRpcResult([rpcRow({
      result: status,
      checked_at: checkedAt,
    })])).toEqual({
      result: status,
      checkedAt,
      event: { id: 'event-1', title: '화산강림 팝업' },
      ticketType: {
        id: '22222222-2222-4222-8222-222222222222',
        name: '7월 25일 1회차',
      },
    });
  });

  it('존재하지 않는 티켓 결과는 metadata를 노출하지 않는 판별값으로 변환한다', () => {
    expect(parseTicketCheckInRpcResult([rpcRow({
      result: 'not_found',
      checked_at: null,
      event_id: null,
      event_title: null,
      ticket_type_id: null,
      ticket_type_name: null,
    })])).toEqual({ result: 'not_found' });
  });

  it('DB가 허용하는 길이의 metadata를 검표 완료 뒤 임의로 거절하지 않는다', () => {
    const longEventId = `event-${'a'.repeat(240)}`;
    const longTitle = `현장 이벤트 ${'가'.repeat(240)}`;

    expect(parseTicketCheckInRpcResult([rpcRow({
      event_id: longEventId,
      event_title: longTitle,
    })])).toEqual(expect.objectContaining({
      event: { id: longEventId, title: longTitle },
    }));
  });

  it.each([
    null,
    {},
    [],
    [rpcRow(), rpcRow()],
    [rpcRow({ result: 'unknown' })],
    [rpcRow({ checked_at: null })],
    [rpcRow({ result: 'refunded', checked_at: CHECKED_AT })],
    [rpcRow({ checked_at: 'not-a-date' })],
    [rpcRow({ event_id: null })],
    [rpcRow({ event_title: 123 })],
    [rpcRow({ ticket_type_id: null })],
    [rpcRow({ result: 'not_found', checked_at: null })],
  ])('불완전하거나 모순된 RPC payload는 거절한다: %p', (value) => {
    expect(parseTicketCheckInRpcResult(value)).toBeNull();
  });
});
