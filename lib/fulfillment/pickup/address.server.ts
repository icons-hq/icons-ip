import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { loadClaimContactCodec } from '@/lib/claim-contact/crypto.server';
import type { EncryptedAddress } from '@/lib/claim-contact/contracts';
import type { PickupAddress, PickupSender } from './types';

/**
 * 고객이 바꾼 회수 주소(클레임 연락처 정정 — 암호문)를 회수 접수 때만 연다. 클레임 연락처 화면과 같은 키·바인딩·주소 HMAC 대조를 쓴다
 * (`lib/claim-contact/service.server.ts`의 readTargetAddress와 같은 규칙). 연 주소는 택배사 요청에만 쓰고 저장·기록하지 않는다.
 * 키가 없거나(클레임 연락처 기능 꺼짐) 대조가 틀리면 던진다 — 회차는 그 접수를 '회수 주소 확인 필요' 실패로 남긴다.
 */
export function openSealedPickupAddress(sender: Extract<PickupSender, { source: 'sealed' }>, env: NodeJS.ProcessEnv = process.env): PickupAddress {
  if (env.ICONS_CLAIM_CONTACT_ENABLED !== '1' || !env.ICONS_CLAIM_CONTACT_KEYRING_JSON) throw new Error('pickup_address_unavailable');
  const codec = loadClaimContactCodec(env);
  codec.requireEnabled();
  const { orderId, claimId, plan } = sender;
  const address = codec.openAddress(plan.address as unknown as EncryptedAddress,
    { orderId, claimId, target: 'collection', recordKind: 'plan', recordId: plan.planId, piiVersion: plan.piiVersion }, plan.keyVersion);
  const digest = codec.addressHmac(address, { orderId, claimId, target: 'collection' }, plan.addressHmacKeyVersion);
  if (!/^[0-9a-f]{64}$/u.test(digest) || !timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(plan.addressHmac, 'hex'))) {
    throw new Error('pickup_address_unavailable');
  }
  return address;
}
