import { describe, expect, it } from 'vitest';
import { billingVaultFromEnvironment, createBillingVault, parseBillingSecretEnvelope, type BillingSecretContext } from './billing-crypto.server';
import { BILLING_TEST_PROFILE, billingChargeFixture } from '../../test/fixtures/recurring-billing';

const context: BillingSecretContext = { ...BILLING_TEST_PROFILE, purpose: 'billing_key',
  id: billingChargeFixture().binding.credentialId, ownerId: billingChargeFixture().binding.ownerId };
const first = new Uint8Array(32).fill(17); const second = new Uint8Array(32).fill(29);
const secret = 'fake-billing-key/only-fixture=';

describe('billing credential AEAD', () => {
  it('암호문은 무작위 nonce를 사용하고 정확한 owner/profile/context로만 열린다', () => {
    const vault = createBillingVault({ activeVersion: 'v1', keys: { v1: first } });
    const one = vault.seal(secret, context); const two = vault.seal(secret, context);
    expect(one.iv).not.toBe(two.iv); expect(JSON.stringify(one)).not.toContain(secret);
    expect(vault.open(one, context)).toBe(secret);
    expect(parseBillingSecretEnvelope(one)).toEqual(one);
  });

  it.each([
    { ownerId: 'b1711000-0000-4000-8000-000000000099' }, { id: 'b1711000-0000-4000-8000-000000000099' },
    { profileId: 'b1711000-0000-4000-8000-000000000099' }, { merchantId: 'anothermid' },
    { environment: 'live' as const }, { purpose: 'registration_auth' as const },
  ])('다른 문맥의 암호문 대입을 거절한다: %j', change => {
    const vault = createBillingVault({ activeVersion: 'v1', keys: { v1: first } });
    expect(() => vault.open(vault.seal(secret, context), { ...context, ...change })).toThrow('billing_secret_unavailable');
  });

  it.each(['iv', 'ciphertext', 'tag', 'keyVersion'] as const)('%s 변조는 provider에 전달되기 전에 거절한다', field => {
    const vault = createBillingVault({ activeVersion: 'v1', keys: { v1: first, v2: second } });
    const envelope = vault.seal(secret, context);
    const value = field === 'keyVersion' ? 'v2' : `${envelope[field][0] === 'A' ? 'B' : 'A'}${envelope[field].slice(1)}`;
    expect(() => vault.open({ ...envelope, [field]: value }, context)).toThrow('billing_secret_unavailable');
  });

  it('키 회전은 같은 비밀을 새 버전으로 다시 봉인하고 폐기한 버전은 열지 않는다', () => {
    const old = createBillingVault({ activeVersion: 'v1', keys: { v1: first } });
    const next = createBillingVault({ activeVersion: 'v2', keys: { v1: first, v2: second } });
    const envelope = old.seal(secret, context); const rotated = next.rotate(envelope, context);
    const onlyNew = createBillingVault({ activeVersion: 'v2', keys: { v2: second } });
    expect(rotated.keyVersion).toBe('v2'); expect(onlyNew.open(rotated, context)).toBe(secret);
    expect(() => onlyNew.open(envelope, context)).toThrow('billing_secret_unavailable');
  });

  it('잘못된 envelope·키 형식과 공개 환경 키는 사용할 수 없다', () => {
    const vault = createBillingVault({ activeVersion: 'v1', keys: { v1: first } });
    const envelope = vault.seal(secret, context);
    expect(parseBillingSecretEnvelope({ ...envelope, plaintext: secret })).toBeNull();
    expect(parseBillingSecretEnvelope({ ...envelope, ciphertext: `${envelope.ciphertext}=` })).toBeNull();
    expect(() => createBillingVault({ activeVersion: 'v1', keys: { v1: new Uint8Array(31) } })).toThrow('billing_secret_unavailable');
    expect(billingVaultFromEnvironment({ NEXT_PUBLIC_BILLING_ENCRYPTION_KEYS: JSON.stringify({ v1: Buffer.from(first).toString('base64url') }) })).toBeNull();
    const loaded = billingVaultFromEnvironment({ BILLING_ENCRYPTION_ACTIVE_VERSION: 'v1',
      BILLING_ENCRYPTION_KEYS: JSON.stringify({ v1: Buffer.from(first).toString('base64url') }) });
    expect(loaded?.open(envelope, context)).toBe(secret);
  });
});
