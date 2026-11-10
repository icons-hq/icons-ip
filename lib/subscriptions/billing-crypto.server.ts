import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isUuid } from '../uuid';
import { billingOpaque, billingProfileValid, billingRecord, billingVersion, type BillingProfileIdentity } from './billing-types.server';

export interface BillingSecretContext extends BillingProfileIdentity {
  readonly purpose: 'billing_key' | 'registration_auth' | 'registration_nonce';
  readonly id: string;
  readonly ownerId: string;
}

export interface BillingSecretEnvelope {
  readonly v: 1;
  readonly keyVersion: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface BillingVault {
  seal(plaintext: string, context: BillingSecretContext): BillingSecretEnvelope;
  open(envelope: BillingSecretEnvelope, context: BillingSecretContext): string;
  rotate(envelope: BillingSecretEnvelope, context: BillingSecretContext): BillingSecretEnvelope;
}

function failed(): never { throw new Error('billing_secret_unavailable'); }

function encoded(value: unknown, length?: number): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1024) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value && (length === undefined || bytes.length === length) ? bytes : null;
}

export function parseBillingSecretEnvelope(value: unknown): BillingSecretEnvelope | null {
  if (!billingRecord(value) || Object.keys(value).sort().join(',') !== 'ciphertext,iv,keyVersion,tag,v'
    || value.v !== 1 || !billingVersion(value.keyVersion) || !encoded(value.iv, 12) || !encoded(value.tag, 16)) return null;
  const ciphertext = encoded(value.ciphertext);
  if (!ciphertext || ciphertext.length < 1 || ciphertext.length > 300) return null;
  return { v: 1, keyVersion: value.keyVersion, iv: value.iv as string, ciphertext: value.ciphertext as string, tag: value.tag as string };
}

function associatedData(context: BillingSecretContext, keyVersion: string): Buffer {
  if (!billingProfileValid(context) || !isUuid(context.id) || !isUuid(context.ownerId)
    || !['billing_key', 'registration_auth', 'registration_nonce'].includes(context.purpose)) return failed();
  return Buffer.from(JSON.stringify(['icons:billing-secret', 1, context.purpose, context.id, context.ownerId,
    context.profileId, context.merchantId, context.environment, keyVersion]), 'utf8');
}

/** AES-256-GCM 키는 서버 secret store에서만 전달한다. DB에는 이 envelope만 저장한다. */
export function createBillingVault(options: {
  readonly activeVersion: string;
  readonly keys: Readonly<Record<string, Uint8Array>>;
}): BillingVault {
  if (!billingVersion(options.activeVersion) || !Object.hasOwn(options.keys, options.activeVersion)
    || Object.keys(options.keys).length < 1 || Object.keys(options.keys).length > 4) return failed();
  const keys = new Map<string, Buffer>();
  for (const [version, material] of Object.entries(options.keys)) {
    if (!billingVersion(version) || !(material instanceof Uint8Array) || material.byteLength !== 32) return failed();
    keys.set(version, Buffer.from(material));
  }

  const vault: BillingVault = {
    seal(plaintext, context) {
      if (!billingOpaque(plaintext, context.purpose === 'billing_key' ? 200 : 300)) return failed();
      const key = keys.get(options.activeVersion); if (!key) return failed();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      cipher.setAAD(associatedData(context, options.activeVersion));
      const buffer = Buffer.from(plaintext, 'utf8');
      try {
        const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
        return { v: 1, keyVersion: options.activeVersion, iv: iv.toString('base64url'),
          ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
      } finally { buffer.fill(0); }
    },
    open(envelope, context) {
      try {
        const checked = parseBillingSecretEnvelope(envelope); if (!checked) return failed();
        const key = keys.get(checked.keyVersion); if (!key) return failed();
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(checked.iv, 'base64url'), { authTagLength: 16 });
        decipher.setAAD(associatedData(context, checked.keyVersion));
        decipher.setAuthTag(Buffer.from(checked.tag, 'base64url'));
        const clear = Buffer.concat([decipher.update(Buffer.from(checked.ciphertext, 'base64url')), decipher.final()]);
        try {
          const plaintext = new TextDecoder('utf-8', { fatal: true }).decode(clear);
          if (!billingOpaque(plaintext, context.purpose === 'billing_key' ? 200 : 300)) return failed();
          return plaintext;
        } finally { clear.fill(0); }
      } catch { return failed(); }
    },
    rotate(envelope, context) { return vault.seal(vault.open(envelope, context), context); },
  };
  return vault;
}

/** 공개 접두어 없이 서버 환경에서만 호출한다. 실제 키 값은 예외에 포함하지 않는다. */
export function billingVaultFromEnvironment(environment: Readonly<Record<string, string | undefined>> = process.env): BillingVault | null {
  const serialized = environment.BILLING_ENCRYPTION_KEYS;
  const activeVersion = environment.BILLING_ENCRYPTION_ACTIVE_VERSION;
  if (!serialized || !activeVersion || serialized.length > 2048) return null;
  try {
    const value: unknown = JSON.parse(serialized); if (!billingRecord(value)) return null;
    const keys: Record<string, Uint8Array> = Object.create(null);
    for (const [version, material] of Object.entries(value)) {
      const bytes = encoded(material, 32); if (!bytes) return null;
      keys[version] = bytes;
    }
    return createBillingVault({ activeVersion, keys });
  } catch { return null; }
}
