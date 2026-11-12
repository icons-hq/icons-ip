import { describe, expect, it } from 'vitest';
import { loadClaimContactCodec, type ClaimContactRecordBinding } from '@/lib/claim-contact/crypto.server';
import { openSealedPickupAddress } from './address.server';
import type { PickupSender } from './types';

/*
 * 회수 주소 정정(암호문) 열기 왕복. 실제 codec으로 봉인한 주소를 openSealedPickupAddress가 같은 키·바인딩·HMAC 대조로 여는지 본다
 * (run 시험은 이 함수를 mock한다). 키는 로컬 합성 값이다.
 */
const material = (seed: number) => ({ encryptionKey: Buffer.alloc(32, seed).toString('base64url'), addressHmacKey: Buffer.alloc(32, seed + 1).toString('base64url'),
  requestHmacKey: Buffer.alloc(32, seed + 2).toString('base64url'), contextSigningKey: Buffer.alloc(32, seed + 3).toString('base64url') });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = (enabled = '1'): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', ICONS_CLAIM_CONTACT_ENVIRONMENT: 'local',
  ICONS_CLAIM_CONTACT_ENABLED: enabled, ICONS_CLAIM_CONTACT_KEYRING_JSON: JSON.stringify({ v: 1, activeKeyVersion: 'one', environment: 'local',
    backendOrigin: 'http://127.0.0.1:54321', keys: { one: material(10) } }) });
const address = { recipientName: '합성 고객', phone: '01055550001', postalCode: '12345', address1: '합성시 회수로 1', address2: '101호' };
const binding: ClaimContactRecordBinding = { orderId: id(1), claimId: id(2), target: 'collection', recordKind: 'plan', recordId: id(3), piiVersion: id(4) };

function sealed(overrides: { claimId?: string; addressHmac?: string } = {}): Extract<PickupSender, { source: 'sealed' }> {
  const codec = loadClaimContactCodec(env());
  return { source: 'sealed', orderId: binding.orderId, claimId: overrides.claimId ?? binding.claimId, plan: {
    planId: binding.recordId, piiVersion: binding.piiVersion, keyVersion: codec.activeKeyVersion,
    address: codec.sealAddress(address, binding) as unknown as Record<string, unknown>,
    addressHmac: overrides.addressHmac ?? codec.addressHmac(address, { orderId: binding.orderId, claimId: binding.claimId, target: 'collection' }),
    addressHmacKeyVersion: codec.activeKeyVersion } } as Extract<PickupSender, { source: 'sealed' }>;
}

describe('회수 주소 정정 암호문 열기', () => {
  it('실제 codec으로 봉인한 주소를 같은 바인딩·HMAC으로 연다', () => {
    expect(openSealedPickupAddress(sealed(), env())).toEqual(address);
  });
  it('주소 HMAC이 바뀌었으면 거절한다', () => {
    const good = sealed();
    const flipped = `${good.plan.addressHmac[0] === 'a' ? 'b' : 'a'}${good.plan.addressHmac.slice(1)}`;
    expect(() => openSealedPickupAddress(sealed({ addressHmac: flipped }), env())).toThrow('pickup_address_unavailable');
  });
  it('다른 클레임으로 바꿔 부르면 바인딩이 달라 거절한다', () => {
    expect(() => openSealedPickupAddress(sealed({ claimId: id(99) }), env())).toThrow();
  });
  it('클레임 연락처 기능이 꺼져 있거나 키가 없으면 거절한다', () => {
    expect(() => openSealedPickupAddress(sealed(), env('0'))).toThrow('pickup_address_unavailable');
    expect(() => openSealedPickupAddress(sealed(), { ...env(), ICONS_CLAIM_CONTACT_KEYRING_JSON: '' })).toThrow('pickup_address_unavailable');
  });
});
