import 'server-only';

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Address, ChangeRequest, ContextClaims, EncryptedAddress, EncryptedField, ReshipmentRequest, SourceBinding, Target } from './contracts';

const FIELD_NAMES = ['recipientName', 'phone', 'postalCode', 'address1', 'address2'] as const;
const SOURCE_KEYS = ['sourceKind', 'sourceId', 'sourceRevision', 'sourceFingerprint', 'planRevision', 'piiVersion'] as const;
const CONTEXT_KEYS = ['v', 'purpose', 'environment', 'backendOrigin', 'actorId', 'sessionId', 'orderId', 'claimId', 'target', 'expectedClaimType', 'expectedClaimRevision', 'source', 'addressHmac', 'addressHmacKeyVersion', 'issuedAt', 'expiresAt', 'signingKeyVersion'] as const;
const KEY_PURPOSES = ['encryptionKey', 'addressHmacKey', 'requestHmacKey', 'contextSigningKey'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_VERSION = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const CONTEXT_TTL_MS = 600_000;
const CONTEXT_PURPOSE = 'claim-contact/context-signature/v1';

type Environment = 'local' | 'preview' | 'production';
type Field = typeof FIELD_NAMES[number] | 'agreement';
type KeySet = Record<typeof KEY_PURPOSES[number], Buffer>;
type RecordKind = 'plan' | 'operation_before' | 'operation_after' | 'operation_agreement' | 'reshipment_destination';
export type ClaimContactRecordBinding = { orderId: string; claimId: string; target: Target; recordKind: RecordKind; recordId: string; piiVersion: string };
export type ClaimContactScope = { actorId: string; sessionId: string; orderId: string; claimId: string; target: Target; command: 'change' | 'reshipment' };

/** Error text is deliberately independent of keys, envelopes and plaintext. */
export class ClaimContactCryptoError extends Error {
  constructor(readonly code: 'claim_contact_crypto_unavailable' | 'claim_contact_context_expired' | 'feature_disabled' | 'auth_changed' = 'claim_contact_crypto_unavailable') {
    super(code);
    this.name = 'ClaimContactCryptoError';
  }
}
const fail = (): never => { throw new ClaimContactCryptoError(); };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function canonicalBase64(value: unknown, length?: number, max = 6144): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]*$/.test(value)) return fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || bytes.length > max || (length !== undefined && bytes.length !== length)) return fail();
  return bytes;
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function version(value: unknown): value is string { return typeof value === 'string' && KEY_VERSION.test(value); }
function digest(value: unknown): value is string { return typeof value === 'string' && DIGEST.test(value); }
function revision(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max; }

/** Reject invalid UTF-16 before Buffer can silently replace it with U+FFFD. */
function validText(value: unknown): value is string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function fieldText(field: Field, value: unknown): value is string {
  if (!validText(value)) return false;
  const length = Array.from(value).length;
  if (field === 'phone') return /^[0-9]{8,15}$/.test(value);
  if (field === 'postalCode' || field === 'address1') return length >= 1 && length <= (field === 'postalCode' ? 20 : 200) && value.trim().length > 0;
  const bounds = field === 'recipientName' ? [1, 50] : field === 'agreement' ? [2, 500] : [0, 200];
  return length >= bounds[0] && length <= bounds[1] && value === value.trim();
}
function validAddress(value: unknown): value is Address { return exact(value, FIELD_NAMES) && FIELD_NAMES.every(field => fieldText(field, value[field])); }
function validSource(value: unknown): value is SourceBinding {
  if (!exact(value, SOURCE_KEYS) || !uuid(value.sourceId) || !revision(value.planRevision)) return false;
  if (value.sourceKind === 'contact_plan') return value.sourceRevision === null && value.sourceFingerprint === null && value.planRevision >= 1 && uuid(value.piiVersion);
  return value.planRevision === 0 && value.piiVersion === null && digest(value.sourceFingerprint)
    && (value.sourceKind === 'seller_intake' ? value.sourceRevision === null : value.sourceKind === 'order_delivery' && typeof value.sourceRevision === 'string' && /^(0|[1-9][0-9]*)$/.test(value.sourceRevision) && value.sourceRevision.length <= 200);
}
function canonicalSource(source: SourceBinding): SourceBinding {
  return { sourceKind: source.sourceKind, sourceId: source.sourceId, sourceRevision: source.sourceRevision, sourceFingerprint: source.sourceFingerprint, planRevision: source.planRevision, piiVersion: source.piiVersion };
}
function validContext(value: unknown): value is ContextClaims {
  if (!exact(value, CONTEXT_KEYS) || value.v !== 1 || !['claim-contact/change-context', 'claim-contact/reshipment-context'].includes(String(value.purpose))
    || !['local', 'preview', 'production'].includes(String(value.environment)) || typeof value.backendOrigin !== 'string'
    || !['actorId', 'sessionId', 'orderId', 'claimId'].every(key => uuid(value[key]))
    || !['collection', 'reshipment'].includes(String(value.target)) || !['return', 'exchange'].includes(String(value.expectedClaimType))
    || !revision(value.expectedClaimRevision, 2_147_483_647) || !validSource(value.source) || !digest(value.addressHmac)
    || !version(value.addressHmacKeyVersion) || !version(value.signingKeyVersion)
    || typeof value.issuedAt !== 'string' || typeof value.expiresAt !== 'string') return false;
  const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt);
  return Number.isFinite(issued) && Number.isFinite(expires) && new Date(issued).toISOString() === value.issuedAt && new Date(expires).toISOString() === value.expiresAt
    && expires - issued === CONTEXT_TTL_MS
    && (value.source.sourceKind !== 'order_delivery' || value.source.sourceId === value.orderId)
    && (value.source.sourceKind !== 'seller_intake' || value.source.sourceId === value.claimId)
    && (value.purpose !== 'claim-contact/reshipment-context' || (value.target === 'reshipment' && value.expectedClaimType === 'exchange'));
}
function canonicalContext(value: ContextClaims): string {
  return JSON.stringify({ v: value.v, purpose: value.purpose, environment: value.environment, backendOrigin: value.backendOrigin,
    actorId: value.actorId, sessionId: value.sessionId, orderId: value.orderId, claimId: value.claimId, target: value.target,
    expectedClaimType: value.expectedClaimType, expectedClaimRevision: value.expectedClaimRevision, source: canonicalSource(value.source),
    addressHmac: value.addressHmac, addressHmacKeyVersion: value.addressHmacKeyVersion, issuedAt: value.issuedAt, expiresAt: value.expiresAt, signingKeyVersion: value.signingKeyVersion });
}
function sourceArray(source: SourceBinding) { return SOURCE_KEYS.map(key => source[key]); }

/** JSON.parse alone accepts duplicate key names, which a keyring must reject. */
function uniqueJsonKeys(raw: string) {
  const stack: (Set<string> | null)[] = [];
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '{') stack.push(new Set());
    else if (raw[index] === '[') stack.push(null);
    else if (raw[index] === '}' || raw[index] === ']') stack.pop();
    else if (raw[index] === '"') {
      const start = index++;
      for (; index < raw.length; index++) {
        if (raw[index] === '\\') index++;
        else if (raw[index] === '"') break;
      }
      let after = index + 1;
      while (/\s/.test(raw[after] ?? '') && after < raw.length) after++;
      if (raw[after] === ':') {
        const keys = stack.at(-1), key = JSON.parse(raw.slice(start, index + 1)) as string;
        if (!keys || keys.has(key)) return false;
        keys.add(key);
      }
    }
  }
  return true;
}
function configuredOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || raw !== raw.trim()) return fail();
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (raw !== url.origin && raw !== `${url.origin}/`)) return fail();
  return url.origin;
}

export function loadClaimContactCodec(env: NodeJS.ProcessEnv = process.env) {
  try {
    const environment = env.ICONS_CLAIM_CONTACT_ENVIRONMENT;
    if (environment !== 'local' && environment !== 'preview' && environment !== 'production') return fail();
    const backendOrigin = configuredOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
    const raw = env.ICONS_CLAIM_CONTACT_KEYRING_JSON;
    if (!raw || Buffer.byteLength(raw, 'utf8') > 16_384 || !uniqueJsonKeys(raw)) return fail();
    const input: unknown = JSON.parse(raw);
    if (!exact(input, ['v', 'activeKeyVersion', 'environment', 'backendOrigin', 'keys']) || input.v !== 1 || input.environment !== environment
      || input.backendOrigin !== backendOrigin || !version(input.activeKeyVersion) || !record(input.keys)) return fail();
    const entries = Object.entries(input.keys);
    if (entries.length < 1 || entries.length > 4 || !Object.hasOwn(input.keys, input.activeKeyVersion)) return fail();
    const keys = new Map<string, KeySet>();
    const usedPurposes = new Map<string, string>();
    for (const [keyVersion, set] of entries) {
      if (!version(keyVersion) || !exact(set, KEY_PURPOSES)) return fail();
      const decoded = {} as KeySet;
      for (const purpose of KEY_PURPOSES) {
        const bytes = canonicalBase64(set[purpose], 32, 32), fingerprint = bytes.toString('base64url');
        if (usedPurposes.has(fingerprint) && usedPurposes.get(fingerprint) !== purpose) return fail();
        usedPurposes.set(fingerprint, purpose);
        decoded[purpose] = bytes;
      }
      keys.set(keyVersion, decoded);
    }
    return createCodec(environment, backendOrigin, input.activeKeyVersion, keys, env.ICONS_CLAIM_CONTACT_ENABLED === '1');
  } catch { return fail(); }
}

function createCodec(environment: Environment, backendOrigin: string, activeKeyVersion: string, keys: Map<string, KeySet>, enabled: boolean) {
  function requireEnabled() { if (!enabled) throw new ClaimContactCryptoError('feature_disabled'); }
  function key(version: string) { return keys.get(version) ?? fail(); }
  function aad(binding: ClaimContactRecordBinding, field: Field, keyVersion: string) {
    if (!uuid(binding.orderId) || !uuid(binding.claimId) || !uuid(binding.recordId) || !uuid(binding.piiVersion)
      || !['collection', 'reshipment'].includes(binding.target) || !version(keyVersion)
      || !['plan', 'operation_before', 'operation_after', 'operation_agreement', 'reshipment_destination'].includes(binding.recordKind)
      || ((field === 'agreement') !== (binding.recordKind === 'operation_agreement')) || ![...FIELD_NAMES, 'agreement'].includes(field)
      || (binding.recordKind === 'reshipment_destination' && binding.target !== 'reshipment')) return fail();
    return Buffer.from(JSON.stringify(['icons-ip', 'claim-contact-field', 'v1', environment, backendOrigin, keyVersion,
      binding.orderId, binding.claimId, binding.target, binding.recordKind, binding.recordId, binding.piiVersion, field]), 'utf8');
  }
  function sealField(value: string, binding: ClaimContactRecordBinding, field: Field): EncryptedField {
    requireEnabled();
    try {
      if (!fieldText(field, value)) return fail();
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(activeKeyVersion).encryptionKey, iv, { authTagLength: 16 });
      cipher.setAAD(aad(binding, field, activeKeyVersion));
      const ct = Buffer.concat([cipher.update(Buffer.from(value, 'utf8')), cipher.final()]);
      return { v: 1, kid: activeKeyVersion, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ct: ct.toString('base64url') };
    } catch { return fail(); }
  }
  function openField(value: EncryptedField, binding: ClaimContactRecordBinding, field: Field, keyVersion: string): string {
    requireEnabled();
    try {
      if (!exact(value, ['v', 'kid', 'iv', 'tag', 'ct']) || value.v !== 1 || value.kid !== keyVersion) return fail();
      const decipher = createDecipheriv('aes-256-gcm', key(keyVersion).encryptionKey, canonicalBase64(value.iv, 12, 12), { authTagLength: 16 });
      decipher.setAAD(aad(binding, field, keyVersion));
      decipher.setAuthTag(canonicalBase64(value.tag, 16, 16));
      const bytes = Buffer.concat([decipher.update(canonicalBase64(value.ct)), decipher.final()]);
      const plaintext = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (!fieldText(field, plaintext)) return fail();
      return plaintext;
    } catch { return fail(); }
  }
  function sealAddress(value: Address, binding: ClaimContactRecordBinding): EncryptedAddress {
    if (!validAddress(value)) return fail();
    return Object.fromEntries(FIELD_NAMES.map(field => [field, sealField(value[field], binding, field)])) as EncryptedAddress;
  }
  function openAddress(value: EncryptedAddress, binding: ClaimContactRecordBinding, keyVersion: string): Address {
    if (!exact(value, FIELD_NAMES)) return fail();
    return Object.fromEntries(FIELD_NAMES.map(field => [field, openField(value[field], binding, field, keyVersion)])) as Address;
  }
  function addressHmac(value: Address, scope: Pick<ClaimContactRecordBinding, 'orderId' | 'claimId' | 'target'>, keyVersion = activeKeyVersion): string {
    requireEnabled();
    if (!validAddress(value) || !uuid(scope.orderId) || !uuid(scope.claimId) || !['collection', 'reshipment'].includes(scope.target)) return fail();
    return createHmac('sha256', key(keyVersion).addressHmacKey).update(JSON.stringify(['claim-contact/address/v1', environment, backendOrigin,
      scope.orderId, scope.claimId, scope.target, ...FIELD_NAMES.map(field => value[field])]), 'utf8').digest('hex');
  }
  function signContext(value: ContextClaims): string {
    requireEnabled();
    if (!validContext(value) || value.environment !== environment || value.backendOrigin !== backendOrigin || value.signingKeyVersion !== activeKeyVersion) return fail();
    const payload = Buffer.from(canonicalContext(value), 'utf8').toString('base64url');
    return `cc1.${payload}.${createHmac('sha256', key(value.signingKeyVersion).contextSigningKey).update(JSON.stringify([CONTEXT_PURPOSE, payload]), 'utf8').digest('base64url')}`;
  }
  function verifyContext(token: string, scope: ClaimContactScope, options: { now?: number; allowExpired?: boolean } = {}): ContextClaims {
    try {
      if (typeof token !== 'string' || token.length > 12000) return fail();
      const parts = token.split('.');
      if (parts.length !== 3 || parts[0] !== 'cc1') return fail();
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(canonicalBase64(parts[1]));
      const value: unknown = JSON.parse(raw);
      if (!validContext(value) || canonicalContext(value) !== raw || value.environment !== environment || value.backendOrigin !== backendOrigin) return fail();
      const expected = createHmac('sha256', key(value.signingKeyVersion).contextSigningKey).update(JSON.stringify([CONTEXT_PURPOSE, parts[1]]), 'utf8').digest();
      if (!timingSafeEqual(expected, canonicalBase64(parts[2], 32, 32))) return fail();
      if (value.actorId !== scope.actorId || value.sessionId !== scope.sessionId) throw new ClaimContactCryptoError('auth_changed');
      if (value.orderId !== scope.orderId || value.claimId !== scope.claimId
        || value.target !== scope.target || value.purpose !== `claim-contact/${scope.command}-context`) return fail();
      const now = options.now ?? Date.now();
      if (Date.parse(value.issuedAt) > now) return fail();
      if (!options.allowExpired && Date.parse(value.expiresAt) <= now) throw new ClaimContactCryptoError('claim_contact_context_expired');
      return value;
    } catch (error) {
      if (error instanceof ClaimContactCryptoError && (error.code === 'claim_contact_context_expired' || error.code === 'auth_changed')) throw error;
      return fail();
    }
  }
  function requestHmac(claims: ContextClaims, input: ChangeRequest | ReshipmentRequest, keyVersion = activeKeyVersion): string {
    if (!validContext(claims) || claims.environment !== environment || claims.backendOrigin !== backendOrigin || !uuid(input.operationId)
      || input.orderId !== claims.orderId || input.claimId !== claims.claimId) return fail();
    const command = claims.purpose === 'claim-contact/change-context' ? 'change' : 'reshipment';
    let tail: unknown[];
    if (command === 'change') {
      if (!('contact' in input) || input.target !== claims.target || !(exact(input.contact, ['recipientName', 'phone', 'address2']) || exact(input.contact, FIELD_NAMES))
        || !fieldText('recipientName', input.contact.recipientName) || !fieldText('phone', input.contact.phone) || !fieldText('address2', input.contact.address2)
        || !fieldText('agreement', input.agreement) || input.customerConfirmed !== true || input.handoffNotStartedConfirmed !== true) return fail();
      tail = [input.contact.recipientName, input.contact.phone, input.contact.address2, input.agreement, true, true];
      if (input.contact.postalCode !== undefined) {
        if (!/^[0-9]{5}$/.test(input.contact.postalCode) || !fieldText('address1', input.contact.address1) || input.contact.address1 !== input.contact.address1.trim()) return fail();
        tail.push(['full-address/v1', input.contact.postalCode, input.contact.address1]);
      }
    } else {
      if (!('items' in input) || !validText(input.carrier) || input.carrier.trim() !== input.carrier || Array.from(input.carrier).length < 1 || Array.from(input.carrier).length > 40
        || !/^[A-Z0-9]{8,30}$/.test(input.trackingNumber) || !Array.isArray(input.items) || input.items.length > 1000
        || input.destinationConfirmed !== true || input.dispatchConfirmed !== true) return fail();
      const ids = new Set<string>();
      for (const item of input.items) {
        if (!exact(item, ['orderItemId', 'variantId']) || !uuid(item.orderItemId) || !uuid(item.variantId) || ids.has(item.orderItemId)) return fail();
        ids.add(item.orderItemId);
      }
      const items = [...input.items].sort((a, b) => a.orderItemId < b.orderItemId ? -1 : a.orderItemId > b.orderItemId ? 1 : 0);
      tail = [input.carrier, input.trackingNumber, items.map(item => [item.orderItemId, item.variantId]), true, true];
    }
    const preimage = [`claim-contact/${command}-request/v1`, environment, backendOrigin, claims.actorId, claims.sessionId, input.operationId,
      claims.orderId, claims.claimId, claims.target, claims.expectedClaimType, claims.expectedClaimRevision, sourceArray(claims.source),
      [claims.addressHmacKeyVersion, claims.addressHmac], tail];
    return createHmac('sha256', key(keyVersion).requestHmacKey).update(JSON.stringify(preimage), 'utf8').digest('hex');
  }
  return { environment, backendOrigin, activeKeyVersion, enabled, requireEnabled, sealField, openField, sealAddress, openAddress, addressHmac, signContext, verifyContext, requestHmac };
}

export type ClaimContactCodec = ReturnType<typeof loadClaimContactCodec>;
