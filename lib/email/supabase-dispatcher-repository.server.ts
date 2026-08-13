import 'server-only';

import { createHmac } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import type {
  DispatchClaim,
  EmailDeliveryState,
  EmailDispatcherRepository,
  EnqueueEmailOutcome,
  ProviderAcceptedState,
  ReduceProviderEventOutcome,
} from './dispatcher';

type ServiceClient = ReturnType<typeof createServiceClient>;
type JsonRecord = Record<string, unknown>;

const HMAC_ENV = 'EMAIL_DISPATCH_HMAC_SECRET';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELIVERY_STATES: readonly EmailDeliveryState[] = [
  'queued', 'dispatching', 'accepted', 'unknown', 'needs_review', 'sent', 'delivered',
  'delayed', 'bounced', 'complained', 'suppressed', 'failed',
];

function invalid(): never {
  throw new Error('invalid_email_dispatcher_repository_response');
}

function object(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as JsonRecord;
}

function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) invalid();
  return value;
}

function state(value: unknown): EmailDeliveryState {
  const candidate = text(value, 32) as EmailDeliveryState;
  if (!DELIVERY_STATES.includes(candidate)) invalid();
  return candidate;
}

function uuid(value: unknown): string {
  const candidate = text(value, 64);
  if (!UUID_PATTERN.test(candidate)) invalid();
  return candidate.toLowerCase();
}

export function getEmailDispatchHmacConfig() {
  const secret = process.env[HMAC_ENV];
  return { secret, isConfigured: typeof secret === 'string' && secret.length >= 32 };
}

type DigestPurpose = 'source' | 'recipient' | 'provider';

function digest(purpose: DigestPurpose, value: string): string {
  const { secret, isConfigured } = getEmailDispatchHmacConfig();
  if (!isConfigured || !secret) throw new Error('email_dispatch_hmac_not_configured');
  return createHmac('sha256', secret)
    .update(`email:v1:${purpose}\0`, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function parseEnqueue(value: unknown): EnqueueEmailOutcome {
  const row = object(value);
  const kind = text(row.kind, 16);
  if (kind !== 'enqueued' && kind !== 'existing') invalid();
  return {
    kind,
    intentId: uuid(row.intentId),
    idempotencyKey: text(row.idempotencyKey),
    state: state(row.state),
  };
}

function parseEnqueueBatch(value: unknown, expectedLength: number): EnqueueEmailOutcome[] {
  if (!Array.isArray(value) || value.length !== expectedLength) invalid();
  return value.map(parseEnqueue);
}

function durableInput(input: import('./dispatcher').EnqueueEmailInput) {
  return {
    source: input.source,
    sourceReferenceDigest: digest('source', input.sourceReference),
    recipientDigest: digest('recipient', input.recipient.trim().toLowerCase()),
    messageKind: input.messageKind,
    contentRevision: input.contentRevision,
  };
}

function parseClaim(value: unknown): DispatchClaim {
  const row = object(value);
  const kind = text(row.kind, 32);
  if (kind === 'claimed') {
    return {
      kind,
      intentId: uuid(row.intentId),
      claimId: uuid(row.claimId),
      idempotencyKey: text(row.idempotencyKey),
    };
  }
  if (!['disabled', 'already_dispatched', 'in_progress', 'needs_review'].includes(kind)) invalid();
  return { kind: kind as Exclude<DispatchClaim['kind'], 'claimed'>, state: state(row.state) };
}

const PROVIDER_ACCEPTED_STATES: readonly ProviderAcceptedState[] = [
  'accepted', 'sent', 'delivered', 'delayed', 'bounced', 'complained', 'suppressed', 'failed',
];

function parseAccepted(value: unknown): { state: ProviderAcceptedState | 'needs_review' } {
  const row = object(value);
  const acceptedState = state(row.state);
  if (acceptedState === 'needs_review') return { state: 'needs_review' };
  if (!PROVIDER_ACCEPTED_STATES.includes(acceptedState as ProviderAcceptedState)) invalid();
  return { state: acceptedState as ProviderAcceptedState };
}

function parseFailure(value: unknown): {
  state: 'queued' | 'unknown' | 'needs_review' | 'failed';
  retryable: boolean;
} {
  const row = object(value);
  const nextState = state(row.state);
  if (!['queued', 'unknown', 'needs_review', 'failed'].includes(nextState)) invalid();
  if (typeof row.retryable !== 'boolean') invalid();
  return {
    state: nextState as 'queued' | 'unknown' | 'needs_review' | 'failed',
    retryable: row.retryable,
  };
}

function parseAcceptanceRecovery(value: unknown):
  | { kind: 'released'; state: 'unknown' }
  | { kind: 'preserved'; state: EmailDeliveryState } {
  const row = object(value);
  const kind = text(row.kind, 16);
  const recoveredState = state(row.state);
  if (kind === 'released' && recoveredState === 'unknown') {
    return { kind, state: recoveredState };
  }
  if (kind === 'preserved') return { kind, state: recoveredState };
  return invalid();
}

function parseReduced(value: unknown): ReduceProviderEventOutcome {
  const row = object(value);
  const kind = text(row.kind, 16);
  if (kind === 'reduced') {
    return { kind, intentId: uuid(row.intentId), state: state(row.state) };
  }
  if (kind === 'duplicate') return { kind, state: state(row.state) };
  if (kind === 'unmatched' && row.state === 'unknown') return { kind, state: 'unknown' };
  return invalid();
}

async function rpc(service: ServiceClient, name: string, args: JsonRecord): Promise<unknown> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(`email_dispatcher_repository_error:${name}`);
  return data;
}

export function createSupabaseEmailDispatcherRepository(
  service: ServiceClient = createServiceClient(),
): EmailDispatcherRepository {
  return {
    async enqueue(input) {
      return parseEnqueue(await rpc(service, 'enqueue_email_intent', {
        target_source: input.source,
        target_source_reference_digest: digest('source', input.sourceReference),
        target_recipient_digest: digest('recipient', input.recipient.trim().toLowerCase()),
        target_message_kind: input.messageKind,
        target_content_revision: input.contentRevision,
      }));
    },
    async enqueueAll(inputs) {
      if (inputs.length < 1 || inputs.length > 10) {
        throw new Error('invalid_email_dispatch_batch_size');
      }
      return parseEnqueueBatch(await rpc(service, 'enqueue_email_intent_batch', {
        target_intents: inputs.map(durableInput),
      }), inputs.length);
    },
    async claimDispatch(input): Promise<DispatchClaim> {
      return parseClaim(await rpc(service, 'claim_email_intent_dispatch', {
        target_intent_id: input.intentId,
        target_recipient_digest: digest('recipient', input.recipient.trim().toLowerCase()),
      }));
    },
    async recordAccepted(input): Promise<{ state: ProviderAcceptedState | 'needs_review' }> {
      return parseAccepted(await rpc(service, 'record_email_intent_accepted', {
        target_intent_id: input.intentId,
        target_provider_reference_digest: digest('provider', input.providerReference),
      }));
    },
    async recoverAcceptedPersistence(input) {
      return parseAcceptanceRecovery(await rpc(
        service,
        'recover_email_acceptance_persistence_failure',
        {
          target_intent_id: input.intentId,
          target_claim_id: input.claimId,
        },
      ));
    },
    async recordDispatchFailure(input): Promise<{
      state: 'queued' | 'unknown' | 'needs_review' | 'failed';
      retryable: boolean;
    }> {
      return parseFailure(await rpc(service, 'record_email_intent_dispatch_failure', {
        target_intent_id: input.intentId,
        target_failure: input.failure,
      }));
    },
    async reduceProviderEvent(input): Promise<ReduceProviderEventOutcome> {
      return parseReduced(await rpc(service, 'reduce_email_provider_event', {
        target_svix_id: input.svixId,
        target_provider_reference_digest: digest('provider', input.providerReference),
        target_event_type: input.type,
        target_occurred_at: input.occurredAt,
      }));
    },
  };
}
