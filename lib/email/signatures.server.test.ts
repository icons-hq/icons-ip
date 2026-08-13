import { Webhook as StandardWebhook } from 'standardwebhooks';
import { Webhook as SvixWebhook } from 'svix';
import { describe, expect, it } from 'vitest';
import {
  verifyResendWebhook,
  verifySupabaseEmailHook,
} from './signatures.server';

const secretMaterial = Buffer.alloc(32, 7).toString('base64');

function signedHeaders(prefix: 'webhook' | 'svix', id: string, signature: string, now: Date) {
  return new Headers({
    [`${prefix}-id`]: id,
    [`${prefix}-timestamp`]: String(Math.floor(now.getTime() / 1000)),
    [`${prefix}-signature`]: signature,
  });
}

describe('Supabase Send Email Hook signature verification', () => {
  it('verifies the exact raw body and accepts the dashboard secret prefix', () => {
    const rawBody = '{"user":{"id":"user-1"},"email_data":{"email_action_type":"signup"}}';
    const now = new Date();
    const signer = new StandardWebhook(`whsec_${secretMaterial}`);
    const signature = signer.sign('hook-message-1', now, rawBody);

    expect(verifySupabaseEmailHook(
      rawBody,
      signedHeaders('webhook', 'hook-message-1', signature, now),
      `v1,whsec_${secretMaterial}`,
    )).toEqual(JSON.parse(rawBody));
  });

  it('rejects a parsed-and-reserialized body even when the semantic JSON is unchanged', () => {
    const signedBody = '{"a":1,"b":2}';
    const changedBody = '{"b":2,"a":1}';
    const now = new Date();
    const signer = new StandardWebhook(`whsec_${secretMaterial}`);
    const signature = signer.sign('hook-message-2', now, signedBody);

    expect(() => verifySupabaseEmailHook(
      changedBody,
      signedHeaders('webhook', 'hook-message-2', signature, now),
      `v1,whsec_${secretMaterial}`,
    )).toThrow('invalid_webhook_signature');
  });
});

describe('Resend webhook signature verification', () => {
  it('verifies the Svix headers against the exact raw body', () => {
    const rawBody = '{"type":"email.delivered","data":{"email_id":"email-1"}}';
    const now = new Date();
    const signer = new SvixWebhook(`whsec_${secretMaterial}`);
    const signature = signer.sign('resend-event-1', now, rawBody);

    expect(verifyResendWebhook(
      rawBody,
      signedHeaders('svix', 'resend-event-1', signature, now),
      `whsec_${secretMaterial}`,
    )).toEqual(JSON.parse(rawBody));
  });
});
