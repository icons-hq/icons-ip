export type TicketCheckInStatus = 'checked_in' | 'already_used' | 'refunded';

export interface TicketCheckInResponse {
  result: TicketCheckInStatus;
  checkedAt: string | null;
  event: {
    id: string;
    title: string;
  };
  ticketType: {
    id: string;
    name: string;
  };
}

export type ParsedTicketCheckInRpcResult =
  | TicketCheckInResponse
  | { result: 'not_found' };

const QR_TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const SCANNER_EDGE_WHITESPACE = /^[ \r\n\t]+|[ \r\n\t]+$/g;
const RESULT_STATUSES = new Set<TicketCheckInStatus>([
  'checked_in',
  'already_used',
  'refunded',
]);

function isDatabaseText(value: unknown): value is string {
  return typeof value === 'string';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function normalizeTicketQrToken(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(SCANNER_EDGE_WHITESPACE, '');
  return QR_TOKEN_PATTERN.test(normalized) ? normalized : null;
}

export function parseTicketCheckInRpcResult(
  data: unknown,
): ParsedTicketCheckInRpcResult | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const {
    result,
    checked_at: checkedAt,
    event_id: eventId,
    event_title: eventTitle,
    ticket_type_id: ticketTypeId,
    ticket_type_name: ticketTypeName,
  } = row as Record<string, unknown>;

  if (result === 'not_found') {
    return checkedAt === null
      && eventId === null
      && eventTitle === null
      && ticketTypeId === null
      && ticketTypeName === null
      ? { result: 'not_found' }
      : null;
  }

  if (
    typeof result !== 'string'
    || !RESULT_STATUSES.has(result as TicketCheckInStatus)
    || !isDatabaseText(eventId)
    || !isDatabaseText(eventTitle)
    || !isDatabaseText(ticketTypeId)
    || !isDatabaseText(ticketTypeName)
  ) {
    return null;
  }

  const parsedResult = result as TicketCheckInStatus;
  if (parsedResult === 'refunded' ? checkedAt !== null : !isTimestamp(checkedAt)) {
    return null;
  }

  return {
    result: parsedResult,
    checkedAt: parsedResult === 'refunded' ? null : checkedAt as string,
    event: { id: eventId as string, title: eventTitle as string },
    ticketType: { id: ticketTypeId as string, name: ticketTypeName as string },
  };
}
