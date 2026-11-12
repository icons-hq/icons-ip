import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTrackingAdapter, trackingAdapterFromEnvironment } from './adapter.server';
import { runDeliveryTrackingTick, type DeliveryTrackingRepository } from './run';
import { normalizeTrackingEvents, trackingErrorCode, type TrackingAdapter } from './types';

describe('추적 이벤트 정규화', () => {
  it('DB가 받는 상태·시각 형식만 남기고 같은 열쇠는 한 번만 싣는다', () => {
    expect(normalizeTrackingEvents([
      { eventKey: 'a', status: 'delivered', occurredAt: '2026-11-12T15:00:00+09:00', description: '  배달 완료  ', location: ' 서울 ', raw: { code: 'D' } },
      { eventKey: 'a', status: 'in_transit', occurredAt: '2026-11-12T10:00:00+09:00', raw: {} },
      { eventKey: 'b', status: 'teleported', occurredAt: '2026-11-12T10:00:00+09:00', raw: {} },
      { eventKey: 'c', status: 'in_transit', occurredAt: '어제', raw: {} },
      { eventKey: '', status: 'in_transit', occurredAt: '2026-11-12T10:00:00Z', raw: {} },
      { eventKey: 'd', status: 'accepted', occurredAt: '2026-11-11T09:00Z' },
    ])).toEqual([
      { eventKey: 'a', status: 'delivered', occurredAt: '2026-11-12T15:00:00+09:00', description: '배달 완료', location: '서울', raw: { code: 'D' } },
      { eventKey: 'd', status: 'accepted', occurredAt: '2026-11-11T09:00Z', raw: {} },
    ]);
    expect(normalizeTrackingEvents('nope')).toEqual([]);
  });
  it('원본이 8KB를 넘으면 원본 대신 잘렸다는 표시만 남긴다', () => {
    const [event] = normalizeTrackingEvents([{ eventKey: 'big', status: 'in_transit', occurredAt: '2026-11-12T10:00:00Z', raw: { note: 'x'.repeat(9000) } }]);
    expect(event.raw).toEqual({ truncated: true });
  });
  it('조회 실패 코드는 DB 형식만 쓴다', () => {
    expect(trackingErrorCode('rate_limited')).toBe('rate_limited');
    expect(trackingErrorCode('Rate Limited!')).toBe('upstream_error');
  });
});

describe('추적 어댑터 선택', () => {
  it('DB가 고른 서비스와 env가 같을 때만 만든다', () => {
    expect(trackingAdapterFromEnvironment('fake', {})).toEqual({ configured: false, reason: 'provider_missing' });
    expect(trackingAdapterFromEnvironment('fake', { DELIVERY_TRACKING_PROVIDER: 'other' })).toEqual({ configured: false, reason: 'provider_mismatch' });
    expect(trackingAdapterFromEnvironment('other', { DELIVERY_TRACKING_PROVIDER: 'other' })).toEqual({ configured: false, reason: 'provider_unsupported' });
    expect(trackingAdapterFromEnvironment('fake', { DELIVERY_TRACKING_PROVIDER: 'fake' })).toEqual({ configured: false, reason: 'fake_file_missing' });
    expect(trackingAdapterFromEnvironment('fake', { DELIVERY_TRACKING_PROVIDER: 'fake', DELIVERY_TRACKING_FAKE_EVENTS_FILE: '/tmp/x.json', VERCEL_ENV: 'production' }))
      .toEqual({ configured: false, reason: 'fake_in_production' });
    const chosen = trackingAdapterFromEnvironment('fake', { DELIVERY_TRACKING_PROVIDER: 'fake', DELIVERY_TRACKING_FAKE_EVENTS_FILE: '/tmp/x.json', VERCEL_ENV: 'preview' });
    expect(chosen.configured && chosen.adapter.provider).toBe('fake');
  });
  it('객체 원형 이름으로 어댑터를 고르지 않는다', () => {
    expect(trackingAdapterFromEnvironment('toString', { DELIVERY_TRACKING_PROVIDER: 'toString' })).toEqual({ configured: false, reason: 'provider_unsupported' });
  });
});

describe('가짜 추적 어댑터', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'icons-tracking-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('조회할 때마다 파일을 다시 읽어 운송장별 이벤트를 돌려준다', async () => {
    const file = path.join(directory, 'events.json');
    const adapter = fakeTrackingAdapter(file);
    const signal = new AbortController().signal;
    expect(await adapter.lookup({ carrier: 'hanjin', trackingNumber: '123456789012' }, signal)).toEqual({ outcome: 'error', errorCode: 'fake_events_unreadable' });
    await writeFile(file, JSON.stringify({ 'hanjin:123456789012': [{ eventKey: 'd1', status: 'delivered', occurredAt: '2026-11-12T15:00:00+09:00' }] }));
    expect(await adapter.lookup({ carrier: 'hanjin', trackingNumber: '123456789012' }, signal)).toEqual({ outcome: 'ok',
      events: [{ eventKey: 'd1', status: 'delivered', occurredAt: '2026-11-12T15:00:00+09:00', raw: { fake: true } }] });
    expect(await adapter.lookup({ carrier: 'epost', trackingNumber: '123456789012' }, signal)).toEqual({ outcome: 'not_found' });
    await writeFile(file, '[]');
    expect(await adapter.lookup({ carrier: 'hanjin', trackingNumber: '123456789012' }, signal)).toEqual({ outcome: 'error', errorCode: 'fake_events_invalid' });
  });
});

describe('추적 cron 한 회차', () => {
  const repository = (overrides: Partial<DeliveryTrackingRepository> = {}): DeliveryTrackingRepository & { [K in keyof DeliveryTrackingRepository]: ReturnType<typeof vi.fn> } => ({
    targets: vi.fn(async () => ({ enabled: true as const, provider: 'fake', targets: [{ carrier: 'hanjin', trackingNumber: 'A0000001' }, { carrier: 'hanjin', trackingNumber: 'B0000002' }] })),
    record: vi.fn(async () => ({ recorded: 1, duplicates: 0, ignored: 0 })),
    complete: vi.fn(async () => ({ enabled: true, completed: 1, held: 0 })),
    ...overrides,
  }) as never;
  const adapter = (lookup: TrackingAdapter['lookup']): TrackingAdapter => ({ provider: 'fake', lookup });

  it('스위치가 꺼져 있으면 어댑터를 만들지도 외부를 부르지도 않고 아무것도 기록하지 않는다', async () => {
    const repo = repository({ targets: vi.fn(async () => ({ enabled: false as const })) });
    const adapterFor = vi.fn();
    expect(await runDeliveryTrackingTick({ repository: repo, adapterFor })).toEqual({ enabled: false, polled: 0, failed: 0, recorded: 0, duplicates: 0, ignored: 0, completed: 0, held: 0 });
    expect(adapterFor).not.toHaveBeenCalled();
    expect(repo.record).not.toHaveBeenCalled();
    expect(repo.complete).not.toHaveBeenCalled();
  });
  it('조회 결과를 운송장별로 기록한 뒤 DB 판정을 부른다', async () => {
    const repo = repository();
    const lookup = vi.fn(async (target: { trackingNumber: string }) => target.trackingNumber === 'A0000001'
      ? { outcome: 'ok' as const, events: [{ eventKey: 'd', status: 'delivered' as const, occurredAt: '2026-11-12T15:00:00+09:00', raw: {} }] }
      : { outcome: 'error' as const, errorCode: 'Bad Code' });
    const result = await runDeliveryTrackingTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: adapter(lookup) }) });
    expect(repo.record).toHaveBeenCalledWith('fake', expect.arrayContaining([
      { carrier: 'hanjin', trackingNumber: 'A0000001', outcome: 'ok', events: [{ eventKey: 'd', status: 'delivered', occurredAt: '2026-11-12T15:00:00+09:00', raw: {} }] },
      { carrier: 'hanjin', trackingNumber: 'B0000002', outcome: 'error', errorCode: 'upstream_error' },
    ]));
    expect(repo.complete).toHaveBeenCalledWith(100);
    expect(result).toEqual({ enabled: true, polled: 2, failed: 1, recorded: 1, duplicates: 0, ignored: 0, completed: 1, held: 0 });
  });
  it('켜져 있는데 어댑터가 없으면 조회 없이 이미 받은 이벤트의 판정만 하고 이유를 남긴다', async () => {
    const repo = repository();
    const result = await runDeliveryTrackingTick({ repository: repo, adapterFor: () => ({ configured: false, reason: 'provider_missing' }) });
    expect(repo.record).not.toHaveBeenCalled();
    expect(repo.complete).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ enabled: true, unavailable: 'provider_missing', polled: 0, completed: 1 });
  });
  it('느린 조회는 시간 안에 끊고, 예산을 넘기면 새 조회를 시작하지 않는다', async () => {
    const hang = adapter((_target, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const timed = await runDeliveryTrackingTick({ repository: repository(), adapterFor: () => ({ configured: true, adapter: hang }), lookupTimeoutMs: 5, concurrency: 2 });
    expect(timed).toMatchObject({ polled: 2, failed: 2 });
    let clock = 0;
    const repo = repository();
    const lookup = vi.fn(async () => { clock += 50_000; return { outcome: 'not_found' as const }; });
    const budget = await runDeliveryTrackingTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: adapter(lookup) }), concurrency: 1, now: () => clock });
    expect(lookup).toHaveBeenCalledOnce();
    expect(budget).toMatchObject({ polled: 1, failed: 0 });
  });
});
