import { describe, expect, it, vi } from 'vitest';
import type { SmsNotificationConfig } from '@/lib/sms/notifications.server';
import { orderDelaySmsOutcome, orderDelaySmsText, processOrderDelaySms, type OrderDelaySmsJob, type OrderDelaySmsRepository } from './order-delay-sms.server';

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('service client must be injected in tests'); } }));

const config = { sender: { provider: 'console', send: vi.fn() }, advertisingOptOut: null } as unknown as SmsNotificationConfig;
const job = (overrides: Partial<OrderDelaySmsJob> = {}): OrderDelaySmsJob => ({
  id: '60000000-0000-4000-8000-000000000001', claimToken: '61000000-0000-4000-8000-000000000001', userId: '62000000-0000-4000-8000-000000000001',
  orderId: '63000000-0000-4000-8000-000000000001', orderNumber: '2026111210000001', audience: 'payer', title: '예약 주문 발송 일정 변경 안내',
  body: '발송 예정일이 바뀌었습니다.\n\n발송 예정일: 2026-12-02 → 2026-12-09', ...overrides,
});
function repository(jobs: OrderDelaySmsJob[], finish: OrderDelaySmsRepository['finish'] = vi.fn(async () => true)): OrderDelaySmsRepository {
  return { claim: vi.fn(async () => jobs), finish };
}

describe('예약 일정 변경 안내 SMS 생산자', () => {
  it('앱 SMS 스위치가 꺼져 있으면 대기열을 꺼내지도 보내지도 않는다', async () => {
    const repo = repository([job()]);
    const send = vi.fn();
    expect(await processOrderDelaySms({ config: null, repository: repo, send, siteUrl: 'https://iconsip.test' }))
      .toEqual({ enabled: false, claimed: 0, sent: 0, failed: 0, skipped: 0, stale: 0 });
    expect(repo.claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('거래 안내로 한 번 보내고 결과를 대상마다 남긴다', async () => {
    const finish = vi.fn(async () => true);
    const repo = repository([job(), job({ id: '60000000-0000-4000-8000-000000000002', audience: 'recipient' }), job({ id: '60000000-0000-4000-8000-000000000003' })], finish);
    const send = vi.fn()
      .mockResolvedValueOnce({ sent: true, providerMessageId: null })
      .mockResolvedValueOnce({ sent: false, reason: 'no_verified_phone' })
      .mockRejectedValueOnce(new Error('provider timeout'));
    const result = await processOrderDelaySms({ config, repository: repo, send, siteUrl: 'https://iconsip.test' });
    expect(result).toEqual({ enabled: true, claimed: 3, sent: 1, failed: 1, skipped: 1, stale: 0 });
    expect(send).toHaveBeenNthCalledWith(1, { userId: job().userId, kind: 'transactional', body: expect.stringContaining('https://iconsip.test/orders/63000000-0000-4000-8000-000000000001') }, { config });
    expect(send.mock.calls[1][0].body).toContain('https://iconsip.test/gifts');
    expect(finish).toHaveBeenCalledWith(job().id, job().claimToken, { status: 'sent', reason: null });
    expect(finish).toHaveBeenCalledWith('60000000-0000-4000-8000-000000000002', job().claimToken, { status: 'skipped', reason: 'no_verified_phone' });
    expect(finish).toHaveBeenCalledWith('60000000-0000-4000-8000-000000000003', job().claimToken, { status: 'failed', reason: 'provider_unavailable' });
  });

  it('다른 작업자가 가져간 결과는 덮어쓰지 않고 stale로 센다', async () => {
    const repo = repository([job()], vi.fn(async () => false));
    const send = vi.fn().mockResolvedValue({ sent: true, providerMessageId: 'm-1' });
    expect(await processOrderDelaySms({ config, repository: repo, send, siteUrl: 'https://iconsip.test' })).toMatchObject({ sent: 0, stale: 1 });
  });

  it('본문은 안내 제목·주문번호·고객 문구·주문 링크이고 연락처는 담지 않는다', () => {
    const text = orderDelaySmsText(job(), 'https://iconsip.test');
    expect(text).toBe('예약 주문 발송 일정 변경 안내\n주문 2026111210000001\n발송 예정일이 바뀌었습니다.\n\n발송 예정일: 2026-12-02 → 2026-12-09\nhttps://iconsip.test/orders/63000000-0000-4000-8000-000000000001');
    expect(text.length).toBeLessThanOrEqual(1000);
  });

  it('seam 거절 사유를 대기열 결과로 바꾼다 — 거래 안내는 광고 전용 거절도 다시 보내지 않는다', () => {
    expect(orderDelaySmsOutcome({ sent: false, reason: 'disabled' })).toEqual({ status: 'skipped', reason: 'sms_disabled' });
    expect(orderDelaySmsOutcome({ sent: false, reason: 'consent_required' })).toEqual({ status: 'skipped', reason: 'consent_required' });
    expect(orderDelaySmsOutcome({ sent: false, reason: 'account_unavailable' })).toEqual({ status: 'skipped', reason: 'account_unavailable' });
    expect(orderDelaySmsOutcome({ sent: false, reason: 'invalid_body' })).toEqual({ status: 'failed', reason: 'invalid_body' });
    expect(orderDelaySmsOutcome({ sent: false, reason: 'quiet_hours' })).toEqual({ status: 'failed', reason: 'provider_unavailable' });
    expect(orderDelaySmsOutcome({ sent: false, reason: 'unavailable' })).toEqual({ status: 'failed', reason: 'provider_unavailable' });
  });
});
