import { planAuthHookEmails } from '@/lib/email/auth-hook';
import { emailDispatcherFromEnvironment } from '@/lib/email/dispatcher.server';
import { verifySupabaseEmailHook } from '@/lib/email/signatures.server';
import { RawBodyTooLargeError, readBoundedRawBody } from '@/lib/http/bounded-raw-body.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
};

function failure(status: number, message: string) {
  return Response.json(
    { error: { http_code: status, message } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  const hookSecret = process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!hookSecret || !supabaseUrl) return failure(503, 'email_dispatch_unavailable');

  let rawBody: string;
  let payload: unknown;
  try {
    rawBody = await readBoundedRawBody(request);
    payload = verifySupabaseEmailHook(rawBody, request.headers, hookSecret);
  } catch (error) {
    if (error instanceof RawBodyTooLargeError) {
      return failure(413, 'hook_request_too_large');
    }
    return failure(401, 'invalid_hook_request');
  }

  let plans: ReturnType<typeof planAuthHookEmails>;
  try {
    plans = planAuthHookEmails(payload, { supabaseUrl });
  } catch {
    return failure(400, 'invalid_hook_request');
  }

  const dispatcher = emailDispatcherFromEnvironment();
  if (!dispatcher) return failure(503, 'email_dispatch_unavailable');

  try {
    const intents = await dispatcher.enqueueAll(plans.map((email) => ({
        source: email.source,
        sourceReference: email.sourceReference,
        recipient: email.recipient,
        messageKind: email.messageKind,
        contentRevision: email.contentRevision,
    })));
    const outcomes = await Promise.all(plans.map(async (email, index) => {
      const intent = intents[index];
      if (!intent) throw new Error('email_dispatch_intent_missing');
      return dispatcher.dispatch({
        intentId: intent.intentId,
        recipient: email.recipient,
        message: email.message,
      });
    }));
    for (const outcome of outcomes) {
      const completed = outcome.kind === 'accepted'
        || (outcome.kind === 'skipped' && outcome.reason === 'already_dispatched');
      if (!completed) return failure(503, 'email_dispatch_unavailable');
    }
  } catch {
    return failure(503, 'email_dispatch_unavailable');
  }

  return new Response(null, {
    status: 200,
    headers: { 'Cache-Control': NO_STORE_HEADERS['Cache-Control'] },
  });
}
