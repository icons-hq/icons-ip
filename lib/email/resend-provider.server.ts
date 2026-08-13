import 'server-only';

import type { EmailProvider } from './dispatcher';

const DEFAULT_ENDPOINT = 'https://api.resend.com/emails';
// Supabase HTTP Auth Hooks must finish within five seconds. Reserve half of that
// budget for signature verification and durable DB work around the provider call.
const DEFAULT_TIMEOUT_MS = 2_500;

export interface ResendEmailProviderConfig {
  apiKey: string;
  from: string;
  replyTo?: string;
  endpoint?: string;
  timeoutMs?: number;
}

function validProviderReference(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200;
}

export function createResendEmailProvider(config: ResendEmailProviderConfig): EmailProvider {
  const endpoint = config.endpoint || DEFAULT_ENDPOINT;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async send(input) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': input.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [input.recipient],
            ...(config.replyTo ? { reply_to: config.replyTo } : {}),
            subject: input.message.subject,
            text: input.message.text,
            html: input.message.html,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          if (response.status === 409) {
            const body: unknown = await response.json().catch(() => null);
            const name = body && typeof body === 'object' && 'name' in body
              ? (body as { name?: unknown }).name
              : null;
            return name === 'concurrent_idempotent_requests'
              ? { kind: 'retryable_failure' }
              : { kind: 'permanent_failure' };
          }
          return response.status === 408 || response.status === 429
            || response.status >= 500
            ? { kind: 'retryable_failure' }
            : { kind: 'permanent_failure' };
        }

        const body: unknown = await response.json().catch(() => null);
        const providerReference = body && typeof body === 'object' && 'id' in body
          ? (body as { id?: unknown }).id
          : null;
        return validProviderReference(providerReference)
          ? { kind: 'accepted', providerReference }
          : { kind: 'ambiguous_failure' };
      } catch {
        // A network timeout can happen after Resend accepted the request. The caller retries
        // only with the same durable idempotency key and never logs the raw exception/body.
        return { kind: 'ambiguous_failure' };
      }
    },
  };
}

export function resendEmailProviderFromEnvironment(): EmailProvider | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) return null;

  return createResendEmailProvider({
    apiKey,
    from,
    replyTo: process.env.RESEND_REPLY_TO?.trim() || undefined,
    endpoint: process.env.RESEND_API_ENDPOINT?.trim() || undefined,
  });
}
