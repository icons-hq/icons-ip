import 'server-only';

import { Webhook as StandardWebhook } from 'standardwebhooks';
import { Webhook as SvixWebhook } from 'svix';

function headerRecord(headers: Headers, prefix: 'webhook' | 'svix'): Record<string, string> {
  return {
    [`${prefix}-id`]: headers.get(`${prefix}-id`) ?? '',
    [`${prefix}-timestamp`]: headers.get(`${prefix}-timestamp`) ?? '',
    [`${prefix}-signature`]: headers.get(`${prefix}-signature`) ?? '',
  };
}

function verified(
  verify: () => unknown,
): unknown {
  try {
    return verify();
  } catch {
    // Provider errors can include signature material. Expose one stable code only.
    throw new Error('invalid_webhook_signature');
  }
}

export function verifySupabaseEmailHook(
  rawBody: string,
  headers: Headers,
  configuredSecret: string,
): unknown {
  const secret = configuredSecret.startsWith('v1,')
    ? configuredSecret.slice('v1,'.length)
    : configuredSecret;
  return verified(() => new StandardWebhook(secret).verify(
    rawBody,
    headerRecord(headers, 'webhook'),
  ));
}

export function verifyResendWebhook(
  rawBody: string,
  headers: Headers,
  configuredSecret: string,
): unknown {
  return verified(() => new SvixWebhook(configuredSecret).verify(
    rawBody,
    headerRecord(headers, 'svix'),
  ));
}
