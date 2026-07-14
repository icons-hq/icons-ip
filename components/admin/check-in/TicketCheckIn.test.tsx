import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TicketCheckInResponse } from '../../../lib/ticket-check-in';
import {
  TicketCheckIn,
  formatTicketCheckInTime,
  submitTicketCheckIn,
  ticketCheckInPresentation,
} from './TicketCheckIn';

const QR_TOKEN = '0123456789abcdef0123456789abcdef';
const CHECKED_AT = '2026-07-15T03:45:00.000Z';

function response(result: TicketCheckInResponse['result'] = 'checked_in'): TicketCheckInResponse {
  return {
    result,
    checkedAt: result === 'refunded' ? null : CHECKED_AT,
    event: { id: 'event-1', title: '화산강림 팝업' },
    ticketType: {
      id: '22222222-2222-4222-8222-222222222222',
      name: '7월 25일 1회차',
    },
  };
}

describe('submitTicketCheckIn', () => {
  it('scanner whitespace를 제거하고 same-origin API에 token을 한 번만 보낸다', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => response(),
    }));

    await expect(submitTicketCheckIn(`\r\n${QR_TOKEN}\t`, fetcher)).resolves.toEqual({
      ok: true,
      value: response(),
    });
    expect(fetcher).toHaveBeenCalledWith('/api/admin/check-in', {
      body: JSON.stringify({ qrToken: QR_TOKEN }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  });

  it.each([
    [404, 'not_found'],
    [409, 'cancellation_in_progress'],
    [401, 'auth_required'],
    [502, 'check_in_failed'],
  ] as const)('HTTP %s를 안전한 UI 코드 %s로 변환한다', async (status, code) => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status,
      json: async () => ({ error: { code, privateDetail: QR_TOKEN } }),
    }));

    const result = await submitTicketCheckIn(QR_TOKEN, fetcher);

    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(QR_TOKEN);
  });

  it('잘못된 token은 network 요청 없이 존재하지 않는 티켓처럼 처리한다', async () => {
    const fetcher = vi.fn();

    await expect(submitTicketCheckIn('INVALID-TOKEN', fetcher)).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('모순되거나 불완전한 성공 payload는 fail closed한다', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: 'checked_in', checkedAt: null, raw: QR_TOKEN }),
    }));

    await expect(submitTicketCheckIn(QR_TOKEN, fetcher)).resolves.toEqual({
      ok: false,
      code: 'check_in_failed',
    });
  });
});

describe('TicketCheckIn presentation', () => {
  it.each([
    ['checked_in', '검표 완료', 'success'],
    ['already_used', '이미 사용된 티켓', 'warning'],
    ['refunded', '환불된 티켓', 'danger'],
  ] as const)('%s 결과를 구분한다', (result, title, tone) => {
    expect(ticketCheckInPresentation(response(result))).toEqual(expect.objectContaining({
      title,
      tone,
    }));
  });

  it('KST 시각을 명시적으로 표시한다', () => {
    expect(formatTicketCheckInTime(CHECKED_AT)).toContain('2026. 7. 15.');
    expect(formatTicketCheckInTime(CHECKED_AT)).toContain('오후 12:45');
  });

  it('raw token을 렌더링하지 않고 camera와 HID/manual fallback을 함께 제공한다', () => {
    const html = renderToStaticMarkup(<TicketCheckIn />);

    expect(html).toContain('현장 티켓 검표');
    expect(html).toContain('카메라 시작');
    expect(html).toContain('<video');
    expect(html).toContain('playsInline=""');
    expect(html).toContain('USB·Bluetooth 스캐너');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('autofocus=""');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain(QR_TOKEN);
    expect(html).not.toMatch(/qrToken|paymentKey|attendee|email/i);
  });
});
