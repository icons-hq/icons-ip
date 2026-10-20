import { createCipheriv, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Address, ChangeRequest, ContextClaims, ReshipmentRequest } from './contracts';
import { ClaimContactCryptoError, loadClaimContactCodec, type ClaimContactRecordBinding } from './crypto.server';

// Synthetic local-only material. These values are never installed in a runtime.
const material = (seed: number) => ({ encryptionKey: Buffer.alloc(32, seed).toString('base64url'), addressHmacKey: Buffer.alloc(32, seed + 1).toString('base64url'),
  requestHmacKey: Buffer.alloc(32, seed + 2).toString('base64url'), contextSigningKey: Buffer.alloc(32, seed + 3).toString('base64url') });
const k1 = material(10), k2 = material(20);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = (active = 'one', enabled = true): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', ICONS_CLAIM_CONTACT_ENVIRONMENT: 'local',
  ICONS_CLAIM_CONTACT_ENABLED: enabled ? '1' : '0', ICONS_CLAIM_CONTACT_KEYRING_JSON: JSON.stringify({ v: 1, activeKeyVersion: active, environment: 'local', backendOrigin: 'http://127.0.0.1:54321', keys: { one: k1, two: k2 } }) });
const binding: ClaimContactRecordBinding = { orderId: id(1), claimId: id(2), target: 'collection', recordKind: 'plan', recordId: id(3), piiVersion: id(4) };
const address: Address = { recipientName: '합성😀고객', phone: '01012345678', postalCode: ' 12345 ', address1: ' 합성 주소 100 ', address2: '' };
const now = Date.parse('2026-10-14T00:00:00.000Z');
const scope = { actorId: id(5), sessionId: id(6), orderId: id(1), claimId: id(2), target: 'collection' as const, command: 'change' as const };
function context(codec = loadClaimContactCodec(env())): ContextClaims {
  return { v: 1, purpose: 'claim-contact/change-context', environment: 'local', backendOrigin: codec.backendOrigin, actorId: scope.actorId, sessionId: scope.sessionId,
    orderId: scope.orderId, claimId: scope.claimId, target: 'collection', expectedClaimType: 'return', expectedClaimRevision: 9,
    source: { sourceKind: 'order_delivery', sourceId: id(1), sourceRevision: '4', sourceFingerprint: 'a'.repeat(64), planRevision: 0, piiVersion: null },
    addressHmac: codec.addressHmac(address, binding), addressHmacKeyVersion: codec.activeKeyVersion,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), signingKeyVersion: codec.activeKeyVersion };
}
function change(claims: ContextClaims, codec = loadClaimContactCodec(env())): ChangeRequest {
  return { requestId: id(7), orderId: id(1), claimId: id(2), target: 'collection', operationId: id(8), signedContext: codec.signContext(claims),
    contact: { recipientName: '새 합성😀이름', phone: '01087654321', address2: '' }, agreement: '고객과 합성 정보 정정 합의', customerConfirmed: true, handoffNotStartedConfirmed: true };
}

describe('claim contact field encryption', () => {
  it('roundtrips Unicode and explicit empty detail with independent random IVs while preserving source strings', () => {
    const codec = loadClaimContactCodec(env());
    const sealed = codec.sealAddress(address, binding), again = codec.sealAddress(address, binding);
    expect(codec.openAddress(sealed, binding, 'one')).toEqual(address);
    expect(sealed.address2.ct).toBe('');
    expect(new Set(Object.values(sealed).map(field => field.iv)).size).toBe(5);
    expect(again.recipientName.iv).not.toBe(sealed.recipientName.iv);
  });
  it('supports codepoint bounds beyond the old vault ASCII/300-byte limit', () => {
    const codec = loadClaimContactCodec(env()), long = { ...address, recipientName: '😀'.repeat(50), address1: '한'.repeat(200), address2: '😀'.repeat(200) };
    const sealed = codec.sealAddress(long, binding);
    expect(codec.openAddress(sealed, binding, 'one')).toEqual(long);
    expect(() => codec.sealAddress({ ...long, recipientName: '😀'.repeat(51) }, binding)).toThrow('claim_contact_crypto_unavailable');
  });
  it.each(['\ud800', '\udc00', 'bad\ud800x', 'bad\u0000', 'bad\u0085'])('rejects malformed Unicode/control before UTF-8 conversion: %#', value => {
    expect(() => loadClaimContactCodec(env()).sealAddress({ ...address, recipientName: value }, binding)).toThrow('claim_contact_crypto_unavailable');
  });
  it.each(['orderId', 'claimId', 'recordId', 'piiVersion'] as const)('binds ciphertext to %s', field => {
    const codec = loadClaimContactCodec(env()), sealed = codec.sealAddress(address, binding);
    expect(() => codec.openAddress(sealed, { ...binding, [field]: id(99) }, 'one')).toThrow('claim_contact_crypto_unavailable');
  });
  it('binds target, record kind, field, environment, actual backend and key version', () => {
    const codec = loadClaimContactCodec(env()), sealed = codec.sealAddress(address, binding);
    for (const changed of [{ ...binding, target: 'reshipment' as const }, { ...binding, recordKind: 'operation_before' as const }]) {
      expect(() => codec.openAddress(sealed, changed, 'one')).toThrow('claim_contact_crypto_unavailable');
    }
    expect(() => codec.openField(sealed.recipientName, binding, 'address1', 'one')).toThrow('claim_contact_crypto_unavailable');
    expect(() => codec.openAddress(sealed, binding, 'two')).toThrow('claim_contact_crypto_unavailable');
    for (const change of [{ environment: 'preview', backendOrigin: 'http://127.0.0.1:54321' }, { environment: 'local', backendOrigin: 'http://127.0.0.1:54322' }]) {
      const config = env(), keyring = JSON.parse(config.ICONS_CLAIM_CONTACT_KEYRING_JSON!);
      config.NEXT_PUBLIC_SUPABASE_URL = change.backendOrigin; config.ICONS_CLAIM_CONTACT_ENVIRONMENT = change.environment;
      config.ICONS_CLAIM_CONTACT_KEYRING_JSON = JSON.stringify({ ...keyring, ...change });
      expect(() => loadClaimContactCodec(config).openAddress(sealed, binding, 'one')).toThrow('claim_contact_crypto_unavailable');
    }
  });
  it.each(['iv', 'tag', 'ct'] as const)('rejects authenticated envelope %s tampering', field => {
    const codec = loadClaimContactCodec(env()), sealed = codec.sealAddress(address, binding);
    const text = sealed.recipientName[field]; sealed.recipientName[field] = `${text[0] === 'A' ? 'B' : 'A'}${text.slice(1)}`;
    expect(() => codec.openAddress(sealed, binding, 'one')).toThrow('claim_contact_crypto_unavailable');
  });
  it('rejects unknown fields, padded encodings and authenticated invalid UTF-8 or oversize plaintext', () => {
    const codec = loadClaimContactCodec(env()), sealed = codec.sealAddress(address, binding);
    expect(() => codec.openField({ ...sealed.phone, extra: 'x' } as typeof sealed.phone, binding, 'phone', 'one')).toThrow('claim_contact_crypto_unavailable');
    expect(() => codec.openField({ ...sealed.phone, tag: `${sealed.phone.tag}==` }, binding, 'phone', 'one')).toThrow('claim_contact_crypto_unavailable');
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('😀'.repeat(51))]) {
      const iv = Buffer.alloc(12, 7), cipher = createCipheriv('aes-256-gcm', Buffer.from(k1.encryptionKey, 'base64url'), iv);
      cipher.setAAD(Buffer.from(JSON.stringify(['icons-ip', 'claim-contact-field', 'v1', 'local', codec.backendOrigin, 'one', binding.orderId, binding.claimId, binding.target, binding.recordKind, binding.recordId, binding.piiVersion, 'recipientName'])));
      const ct = Buffer.concat([cipher.update(bytes), cipher.final()]);
      expect(() => codec.openField({ v: 1, kid: 'one', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ct: ct.toString('base64url') }, binding, 'recipientName', 'one')).toThrow('claim_contact_crypto_unavailable');
    }
  });
  it('retains old decoding after active-key rotation and seals new material with the new key', () => {
    const old = loadClaimContactCodec(env()), next = loadClaimContactCodec(env('two'));
    expect(next.openAddress(old.sealAddress(address, binding), binding, 'one')).toEqual(address);
    expect(next.sealAddress(address, binding).phone.kid).toBe('two');
    expect(next.addressHmac(address, binding, 'one')).toBe(old.addressHmac(address, binding));
    expect(next.addressHmac(address, binding)).not.toBe(old.addressHmac(address, binding));
  });
});

describe('keyring isolation and unavailable behavior', () => {
  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'ICONS_CLAIM_CONTACT_ENVIRONMENT', 'ICONS_CLAIM_CONTACT_KEYRING_JSON'])('requires explicit %s without fallback', key => {
    const config = env(); delete config[key]; expect(() => loadClaimContactCodec(config)).toThrow('claim_contact_crypto_unavailable');
  });
  it.each(['http://u:p@127.0.0.1:54321', 'http://127.0.0.1:54321/path', 'http://127.0.0.1:54321?x=y', 'http://127.0.0.1:54321#x'])('rejects non-origin configuration %#', url => {
    expect(() => loadClaimContactCodec({ ...env(), NEXT_PUBLIC_SUPABASE_URL: url })).toThrow('claim_contact_crypto_unavailable');
  });
  it('rejects duplicate JSON keys, purpose-key reuse, unknown active versions and oversized keyrings', () => {
    const config = env(), raw = config.ICONS_CLAIM_CONTACT_KEYRING_JSON!;
    const ring = JSON.parse(raw);
    const invalid = [raw.replace('"v":1', '"v":1,"v":1'), JSON.stringify({ ...ring, activeKeyVersion: 'missing' }),
      JSON.stringify({ ...ring, keys: { one: { ...k1, requestHmacKey: k1.encryptionKey } } }), ' '.repeat(16_384) + raw];
    for (const keyring of invalid) expect(() => loadClaimContactCodec({ ...config, ICONS_CLAIM_CONTACT_KEYRING_JSON: keyring })).toThrow('claim_contact_crypto_unavailable');
  });
  it('disabled codec prohibits any PII read/seal but can verify the original request binding for metadata-based replay', () => {
    const enabled = loadClaimContactCodec(env()), disabled = loadClaimContactCodec(env('one', false));
    const claims = context(enabled), input = change(claims, enabled), encrypted = enabled.sealAddress(address, binding);
    expect(disabled.verifyContext(input.signedContext, scope, { now, allowExpired: true })).toEqual(claims);
    expect(disabled.requestHmac(claims, input)).toBe(enabled.requestHmac(claims, input));
    expect(() => disabled.openAddress(encrypted, binding, 'one')).toThrow('feature_disabled');
    expect(() => disabled.sealAddress(address, binding)).toThrow('feature_disabled');
    expect(() => disabled.addressHmac(address, binding)).toThrow('feature_disabled');
  });
});

describe('signed context and stable request HMAC', () => {
  it('verifies exact canonical scope and enforces the ten minute boundary for new operations', () => {
    const codec = loadClaimContactCodec(env()), claims = context(codec), token = codec.signContext(claims);
    expect(codec.verifyContext(token, scope, { now: now + 599_999 })).toEqual(claims);
    expect(() => codec.verifyContext(token, scope, { now: now + 600_000 })).toThrow('claim_contact_context_expired');
    expect(codec.verifyContext(token, scope, { now: now + 900_000, allowExpired: true })).toEqual(claims);
    expect(() => codec.verifyContext(token, scope, { now: now - 1, allowExpired: true })).toThrow('claim_contact_crypto_unavailable');
    for (const key of ['actorId', 'sessionId'] as const) expect(() => codec.verifyContext(token, { ...scope, [key]: id(99) }, { now })).toThrow('auth_changed');
    for (const key of ['orderId', 'claimId'] as const) expect(() => codec.verifyContext(token, { ...scope, [key]: id(99) }, { now })).toThrow('claim_contact_crypto_unavailable');
    expect(() => codec.verifyContext(token, { ...scope, target: 'reshipment', command: 'reshipment' }, { now })).toThrow('claim_contact_crypto_unavailable');
  });
  it('rejects noncanonical signed JSON, duplicate keys and altered context even with valid transport encoding', () => {
    const codec = loadClaimContactCodec(env()), claims = context(codec), token = codec.signContext(claims), parts = token.split('.');
    const raw = Buffer.from(parts[1], 'base64url').toString();
    for (const changed of [raw.replace('"v":1', '"v":1,"v":1'), JSON.stringify(claims, null, 2)]) {
      const payload = Buffer.from(changed).toString('base64url');
      const signature = createHmac('sha256', Buffer.from(k1.contextSigningKey, 'base64url')).update(JSON.stringify(['claim-contact/context-signature/v1', payload])).digest('base64url');
      expect(() => codec.verifyContext(`cc1.${payload}.${signature}`, scope, { now })).toThrow('claim_contact_crypto_unavailable');
    }
    expect(() => codec.verifyContext(`cc1.${parts[1]}.${'A'.repeat(43)}`, scope, { now })).toThrow('claim_contact_crypto_unavailable');
  });
  it('keeps request identity stable across new ciphertext/transport IDs and rotates using the stored HMAC version', () => {
    const codec = loadClaimContactCodec(env()), claims = context(codec), input = change(claims, codec), rotated = loadClaimContactCodec(env('two'));
    const first = codec.requestHmac(claims, input);
    expect(codec.requestHmac(claims, { ...input, requestId: id(99) })).toBe(first);
    expect(rotated.requestHmac(claims, input, 'one')).toBe(first);
    expect(rotated.requestHmac(claims, input)).not.toBe(first);
    expect(codec.requestHmac(claims, { ...input, contact: { ...input.contact, address2: '새 상세' } })).not.toBe(first);
    expect(codec.requestHmac({ ...claims, source: { ...claims.source, sourceFingerprint: 'b'.repeat(64) } }, input)).not.toBe(first);
    expect(codec.requestHmac({ ...claims, addressHmac: 'c'.repeat(64) }, input)).not.toBe(first);
    const newContext = { ...claims, issuedAt: new Date(now + 1000).toISOString(), expiresAt: new Date(now + 601_000).toISOString() };
    expect(codec.requestHmac(newContext, { ...input, signedContext: codec.signContext(newContext) })).toBe(first);
  });
  it('sorts reshipment item identity without mutating input, rejects duplicates, and accepts legacy empty selections', () => {
    const codec = loadClaimContactCodec(env()), claims: ContextClaims = { ...context(codec), purpose: 'claim-contact/reshipment-context', target: 'reshipment', expectedClaimType: 'exchange' };
    const input: ReshipmentRequest = { requestId: id(7), orderId: id(1), claimId: id(2), operationId: id(8), signedContext: codec.signContext(claims),
      carrier: '합성택배', trackingNumber: '12345678', items: [{ orderItemId: id(11), variantId: id(21) }, { orderItemId: id(10), variantId: id(20) }], destinationConfirmed: true, dispatchConfirmed: true };
    expect(codec.requestHmac(claims, input)).toBe(codec.requestHmac(claims, { ...input, items: [...input.items].reverse() }));
    expect(input.items[0].orderItemId).toBe(id(11));
    expect(codec.requestHmac(claims, { ...input, items: [] })).toMatch(/^[0-9a-f]{64}$/);
    expect(() => codec.requestHmac(claims, { ...input, items: [input.items[0], input.items[0]] })).toThrow('claim_contact_crypto_unavailable');
  });
  it('errors contain only a stable code', () => {
    try { loadClaimContactCodec({ ...env(), ICONS_CLAIM_CONTACT_KEYRING_JSON: `secret ${k1.encryptionKey}` }); }
    catch (error) { expect(error).toBeInstanceOf(ClaimContactCryptoError); expect((error as Error).message).toBe('claim_contact_crypto_unavailable'); expect(JSON.stringify(error)).not.toContain(k1.encryptionKey); }
  });
});
