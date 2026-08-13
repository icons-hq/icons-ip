import { emailProviderEventReducerFromEnvironment } from '@/lib/email/dispatcher.server';
import type { EmailProviderEventType } from '@/lib/email/dispatcher';
import { verifyResendWebhook } from '@/lib/email/signatures.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
};

const EVENT_TYPES: Readonly<Record<string, EmailProviderEventType>> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.suppressed': 'suppressed',
  'email.failed': 'failed',
};

function response(ok: boolean, status: number) {
  return Response.json({ ok }, { status, headers: NO_STORE_HEADERS });
}

function eventProjection(payload: unknown, svixId: string | null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid_resend_event');
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.type !== 'string') throw new Error('invalid_resend_event');
  const type = EVENT_TYPES[row.type];
  if (!type) return null;
  if (!svixId || svixId.length > 200) throw new Error('invalid_resend_event');
  if (typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) {
    throw new Error('invalid_resend_event');
  }
  if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
    throw new Error('invalid_resend_event');
  }
  const providerReference = (row.data as Record<string, unknown>).email_id;
  if (typeof providerReference !== 'string'
    || providerReference.length < 1
    || providerReference.length > 200) {
    throw new Error('invalid_resend_event');
  }
  return {
    svixId,
    providerReference,
    type,
    occurredAt: new Date(row.created_at).toISOString(),
  };
}

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) return response(false, 503);

  let payload: unknown;
  try {
    const rawBody = await request.text();
    payload = verifyResendWebhook(rawBody, request.headers, webhookSecret);
  } catch {
    return response(false, 401);
  }

  let event: ReturnType<typeof eventProjection>;
  try {
    event = eventProjection(payload, request.headers.get('svix-id'));
  } catch {
    return response(false, 400);
  }
  if (!event) return response(true, 200);

  const reducer = emailProviderEventReducerFromEnvironment();
  if (!reducer) return response(false, 503);
  try {
    await reducer.reduceProviderEvent(event);
    return response(true, 200);
  } catch {
    return response(false, 503);
  }
}
