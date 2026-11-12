import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeReturnPickupAdapter, returnPickupAdapterFromEnvironment } from './adapter.server';
import { runReturnPickupTick, type ReturnPickupRepository } from './run';
import { normalizePickupTrackingNumber, parseReturnPickupWorkItem, pickupErrorCode, type ReturnPickupAdapter, type ReturnPickupResult } from './types';

const PICKUP = '11111111-1111-4111-8111-111111111111';
const LEASE = '22222222-2222-4222-8222-222222222222';
const SENDER = { recipientName: '합성 고객', phone: '01055550001', postalCode: '12345', address1: '합성시 회수로 1', address2: '101호' };
const requestItem = (overrides: Record<string, unknown> = {}) => ({
  kind: 'request', pickupId: PICKUP, leaseToken: LEASE, provider: 'fake', idempotencyKey: 'icons-return-0123456789abcdef', carrier: 'hanjin',
  outboundTrackingNumber: 'RPSALE000001', sender: { source: 'plain', address: SENDER },
  receiver: { name: 'TEST 김포', phone: '', address: 'TEST 김포 반송지' }, items: [{ name: 'TEST 굿즈', qty: 1 }], ...overrides,
});
const cancelItem = (overrides: Record<string, unknown> = {}) => ({
  kind: 'cancel', pickupId: PICKUP, leaseToken: LEASE, provider: 'fake', idempotencyKey: 'icons-return-0123456789abcdef', carrier: 'hanjin',
  trackingNumber: 'FAKE0123456789', externalId: 'fake-abc', ...overrides,
});

function repository(items: unknown[] | null): ReturnPickupRepository & { recorded: ReturnPickupResult[][] } {
  const recorded: ReturnPickupResult[][] = [];
  return {
    recorded,
    async work() { return items === null ? { enabled: false } : { enabled: true, items }; },
    async record(results) {
      recorded.push(results);
      return { recorded: results.length, requested: results.filter(r => r.outcome === 'requested').length, failed: results.filter(r => r.kind === 'request' && r.outcome === 'error').length,
        canceled: results.filter(r => r.kind === 'cancel' && r.outcome !== 'error').length, cancelFailed: results.filter(r => r.kind === 'cancel' && r.outcome === 'error').length, stale: 0, invalid: 0 };
    },
  };
}
const adapter = (overrides: Partial<ReturnPickupAdapter> = {}): ReturnPickupAdapter => ({
  provider: 'fake',
  request: vi.fn(async () => ({ outcome: 'requested' as const, trackingNumber: 'fake-0123-4567', externalId: 'reservation-1' })),
  cancel: vi.fn(async () => ({ outcome: 'canceled' as const })),
  ...overrides,
});
const opened = vi.fn(() => SENDER);

describe('회수 접수 할 일 읽기', () => {
  it('열쇠를 읽을 수 없으면 null, 열쇠는 맞는데 나머지가 틀리면 실패로 남길 invalid', () => {
    expect(parseReturnPickupWorkItem({ kind: 'request', pickupId: 'x', leaseToken: LEASE })).toBeNull();
    expect(parseReturnPickupWorkItem(requestItem({ items: [] }))).toEqual({ invalid: { pickupId: PICKUP, leaseToken: LEASE, kind: 'request' } });
    expect(parseReturnPickupWorkItem(requestItem({ receiver: { name: 'x', phone: '', address: '' } }))).toHaveProperty('invalid');
    expect(parseReturnPickupWorkItem(cancelItem({ provider: 'Fake!' }))).toHaveProperty('invalid');
  });
  it('회수지는 평문 다섯 칸 또는 암호문이고, 없거나 틀리면 sender가 null이다', () => {
    const plain = parseReturnPickupWorkItem(requestItem());
    expect(plain).toEqual({ item: expect.objectContaining({ kind: 'request', sender: { source: 'plain', address: SENDER } }) });
    const missing = parseReturnPickupWorkItem(requestItem({ sender: { source: 'plain', address: { ...SENDER, address1: '' } } }));
    expect(missing).toEqual({ item: expect.objectContaining({ sender: null }) });
    const sealed = parseReturnPickupWorkItem(requestItem({ sender: { source: 'sealed', orderId: PICKUP, claimId: LEASE, plan: {
      planId: PICKUP, piiVersion: LEASE, keyVersion: 'k1', addressHmac: 'a'.repeat(64), addressHmacKeyVersion: 'k1', address: { recipientName: {} } } } }));
    expect(sealed).toEqual({ item: expect.objectContaining({ sender: expect.objectContaining({ source: 'sealed', orderId: PICKUP }) }) });
  });
  it('회수 송장·오류 코드는 DB 형식으로만 남긴다', () => {
    expect(normalizePickupTrackingNumber(' fake-0123 4567 ')).toBe('FAKE01234567');
    expect(normalizePickupTrackingNumber('12')).toBeNull();
    expect(pickupErrorCode('carrier_closed')).toBe('carrier_closed');
    expect(pickupErrorCode('Bad: 010-1234-5678')).toBe('upstream_error');
  });
});

describe('회수 접수 크론 한 회차', () => {
  it('스위치가 꺼져 있으면 어댑터를 만들지도 기록하지도 않는다', async () => {
    const repo = repository(null);
    const adapterFor = vi.fn();
    expect(await runReturnPickupTick({ repository: repo, adapterFor, openSealedAddress: opened })).toEqual({
      enabled: false, leased: 0, requested: 0, failed: 0, canceled: 0, cancelFailed: 0, stale: 0, invalid: 0, deferred: 0 });
    expect(adapterFor).not.toHaveBeenCalled();
    expect(repo.recorded).toEqual([]);
  });
  it('접수 성공은 정규화한 회수 송장만 기록하고, 택배사에는 최소 필드만 보낸다', async () => {
    const repo = repository([requestItem()]);
    const fake = adapter();
    const result = await runReturnPickupTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: fake }), openSealedAddress: opened });
    expect(result).toMatchObject({ enabled: true, leased: 1, requested: 1, failed: 0, invalid: 0 });
    expect(repo.recorded[0]).toEqual([{ pickupId: PICKUP, leaseToken: LEASE, kind: 'request', outcome: 'requested', trackingNumber: 'FAKE01234567', externalId: 'reservation-1' }]);
    expect(fake.request).toHaveBeenCalledWith({ idempotencyKey: 'icons-return-0123456789abcdef', carrier: 'hanjin', outboundTrackingNumber: 'RPSALE000001',
      sender: SENDER, receiver: { name: 'TEST 김포', phone: '', address: 'TEST 김포 반송지' }, items: [{ name: 'TEST 굿즈', qty: 1 }] }, expect.any(AbortSignal));
    expect(JSON.stringify(repo.recorded)).not.toContain('합성');
  });
  it('택배사 거절·형식이 틀린 송장·시간 초과는 실패로 남긴다(개인정보 없는 오류 코드)', async () => {
    vi.useFakeTimers();
    try {
      const items = [requestItem(), requestItem({ pickupId: '33333333-3333-4333-8333-333333333333' }), requestItem({ pickupId: '44444444-4444-4444-8444-444444444444' })];
      let call = 0;
      const fake = adapter({ request: vi.fn(async (_input, signal: AbortSignal) => {
        call += 1;
        if (call === 1) return { outcome: 'error' as const, errorCode: '수거 불가 010-1234-5678' };
        if (call === 2) return { outcome: 'requested' as const, trackingNumber: '12' };
        return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }) });
      const repo = repository(items);
      const running = runReturnPickupTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: fake }), openSealedAddress: opened, concurrency: 1, timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1500);
      expect(await running).toMatchObject({ failed: 3, requested: 0 });
      expect(repo.recorded[0].map(r => 'errorCode' in r ? r.errorCode : null)).toEqual(['upstream_error', 'invalid_tracking', 'pickup_timeout']);
    } finally {
      vi.useRealTimers();
    }
  });
  it('회수지가 없거나 암호문을 열지 못하면 택배사를 부르지 않고 실패로 남긴다', async () => {
    const fake = adapter();
    const repo = repository([requestItem({ sender: null }), requestItem({ pickupId: '33333333-3333-4333-8333-333333333333', sender: { source: 'sealed', orderId: PICKUP, claimId: LEASE,
      plan: { planId: PICKUP, piiVersion: LEASE, keyVersion: 'k1', addressHmac: 'a'.repeat(64), addressHmacKeyVersion: 'k1', address: {} } } })]);
    await runReturnPickupTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: fake }), openSealedAddress: () => { throw new Error('locked'); } });
    expect(fake.request).not.toHaveBeenCalled();
    expect(repo.recorded[0].map(r => 'errorCode' in r ? r.errorCode : null)).toEqual(['pickup_address_unavailable', 'pickup_address_unavailable']);
  });
  it('암호문 회수지는 연 주소로 접수한다', async () => {
    const fake = adapter();
    const open = vi.fn(() => ({ ...SENDER, address1: '바뀐 회수 주소' }));
    const repo = repository([requestItem({ sender: { source: 'sealed', orderId: PICKUP, claimId: LEASE,
      plan: { planId: PICKUP, piiVersion: LEASE, keyVersion: 'k1', addressHmac: 'a'.repeat(64), addressHmacKeyVersion: 'k1', address: {} } } })]);
    await runReturnPickupTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: fake }), openSealedAddress: open });
    expect(open).toHaveBeenCalledOnce();
    expect(vi.mocked(fake.request).mock.calls[0][0].sender.address1).toBe('바뀐 회수 주소');
  });
  it('취소는 멱등 키·회수 송장으로 보내고 결과를 그대로 남긴다', async () => {
    const fake = adapter({ cancel: vi.fn(async () => ({ outcome: 'not_found' as const })) });
    const repo = repository([cancelItem()]);
    expect(await runReturnPickupTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: fake }), openSealedAddress: opened })).toMatchObject({ canceled: 1 });
    expect(fake.cancel).toHaveBeenCalledWith({ idempotencyKey: 'icons-return-0123456789abcdef', carrier: 'hanjin', trackingNumber: 'FAKE0123456789', externalId: 'fake-abc' }, expect.any(AbortSignal));
    expect(repo.recorded[0]).toEqual([{ pickupId: PICKUP, leaseToken: LEASE, kind: 'cancel', outcome: 'not_found' }]);
  });
  it('이 서버에 어댑터가 없으면 그 일을 실패로 남기고 이유를 알린다', async () => {
    const repo = repository([requestItem(), cancelItem({ pickupId: '33333333-3333-4333-8333-333333333333' })]);
    const result = await runReturnPickupTick({ repository: repo, adapterFor: () => ({ configured: false, reason: 'provider_missing' }), openSealedAddress: opened });
    expect(result).toMatchObject({ unavailable: 'provider_missing', failed: 1, cancelFailed: 1 });
    expect(repo.recorded[0].every(r => 'errorCode' in r && r.errorCode === 'adapter_unavailable')).toBe(true);
  });
  it('열쇠조차 읽지 못한 일은 세기만 하고, 형식이 틀린 일은 실패로 남긴다', async () => {
    const repo = repository([{ nope: true }, requestItem({ items: [] })]);
    const result = await runReturnPickupTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: adapter() }), openSealedAddress: opened });
    expect(result.invalid).toBe(2);
    expect(repo.recorded[0]).toEqual([{ pickupId: PICKUP, leaseToken: LEASE, kind: 'request', outcome: 'error', errorCode: 'invalid_work_item' }]);
  });
  it('할 일 읽기·기록 실패는 단계 이름만 남긴다', async () => {
    const failing: ReturnPickupRepository = { async work() { throw new Error('db 010-1234-5678'); }, async record() { throw new Error('x'); } };
    expect(await runReturnPickupTick({ repository: failing, adapterFor: () => ({ configured: true, adapter: adapter() }), openSealedAddress: opened }))
      .toMatchObject({ enabled: null, failedStages: ['work'] });
    const recordFails: ReturnPickupRepository = { async work() { return { enabled: true, items: [requestItem()] }; }, async record() { throw new Error('x'); } };
    expect(await runReturnPickupTick({ repository: recordFails, adapterFor: () => ({ configured: true, adapter: adapter() }), openSealedAddress: opened }))
      .toMatchObject({ enabled: true, failedStages: ['record'], requested: 0 });
  });
  it('시간 예산이 끝나면 남은 일은 보내지 않는다(임대가 끝나면 DB가 다시 넘긴다)', async () => {
    let clock = 0;
    const fake = adapter({ request: vi.fn(async () => { clock += 40_000; return { outcome: 'requested' as const, trackingNumber: 'FAKE01234567' }; }) });
    const repo = repository([requestItem(), requestItem({ pickupId: '33333333-3333-4333-8333-333333333333' })]);
    const result = await runReturnPickupTick({ repository: repo, adapterFor: () => ({ configured: true, adapter: fake }), openSealedAddress: opened, concurrency: 1, now: () => clock });
    expect(result).toMatchObject({ requested: 1, deferred: 1 });
  });
});

describe('어댑터 선택과 가짜 어댑터', () => {
  let dir = '';
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'return-pickup-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('env 서비스 이름이 DB와 같을 때만 만든다. 운영 배포에서는 가짜를 만들지 않는다', () => {
    expect(returnPickupAdapterFromEnvironment('fake', {})).toEqual({ configured: false, reason: 'provider_missing' });
    expect(returnPickupAdapterFromEnvironment('fake', { RETURN_PICKUP_PROVIDER: 'epost' })).toEqual({ configured: false, reason: 'provider_mismatch' });
    expect(returnPickupAdapterFromEnvironment('epost', { RETURN_PICKUP_PROVIDER: 'epost' })).toEqual({ configured: false, reason: 'provider_unsupported' });
    expect(returnPickupAdapterFromEnvironment('fake', { RETURN_PICKUP_PROVIDER: 'fake', VERCEL_ENV: 'production' })).toEqual({ configured: false, reason: 'fake_in_production' });
    expect(returnPickupAdapterFromEnvironment('fake', { RETURN_PICKUP_PROVIDER: 'fake', VERCEL_ENV: 'preview' })).toMatchObject({ configured: true });
  });
  it('가짜 어댑터는 멱등 키마다 같은 회수 송장을 주고, 동작 파일로 실패를 흉내 낸다', async () => {
    const signal = new AbortController().signal;
    const input = { idempotencyKey: 'icons-return-abc', carrier: 'hanjin', outboundTrackingNumber: null, sender: SENDER, receiver: { name: 'x', phone: '', address: 'y' }, items: [{ name: 'g', qty: 1 }] };
    const first = await fakeReturnPickupAdapter().request(input, signal);
    expect(first).toEqual(await fakeReturnPickupAdapter().request(input, signal));
    expect(first.outcome === 'requested' && normalizePickupTrackingNumber(first.trackingNumber)).toMatch(/^FAKE[0-9]{10}$/);
    const file = path.join(dir, 'behavior.json');
    await writeFile(file, JSON.stringify({ request: 'error', cancel: 'not_found', errorCode: 'fake_carrier_closed' }));
    expect(await fakeReturnPickupAdapter(file).request(input, signal)).toEqual({ outcome: 'error', errorCode: 'fake_carrier_closed' });
    expect(await fakeReturnPickupAdapter(file).cancel({ idempotencyKey: 'icons-return-abc', carrier: 'hanjin', trackingNumber: null, externalId: null }, signal)).toEqual({ outcome: 'not_found' });
    expect(await fakeReturnPickupAdapter(path.join(dir, 'missing.json')).request(input, signal)).toEqual({ outcome: 'error', errorCode: 'fake_behavior_unreadable' });
  });
});
