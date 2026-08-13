import 'server-only';

export const EMAIL_MESSAGE_KINDS = [
  'auth_signup',
  'auth_recovery',
  'auth_email_change_current',
  'auth_email_change_new',
  'auth_reauthentication',
  'account_deletion_notice',
] as const;

export type EmailMessageKind = (typeof EMAIL_MESSAGE_KINDS)[number];
export type EmailIntentSource = 'auth_hook' | 'account_deletion';
export type EmailDeliveryState =
  | 'queued'
  | 'dispatching'
  | 'accepted'
  | 'unknown'
  | 'needs_review'
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'suppressed'
  | 'failed';

export interface EnqueueEmailInput {
  source: EmailIntentSource;
  /** Transient source material. Adapters must persist only a keyed digest. */
  sourceReference: string;
  /** Transient recipient. Adapters must persist only a keyed digest. */
  recipient: string;
  messageKind: EmailMessageKind;
  contentRevision: string;
}

export type EnqueueEmailOutcome = {
  kind: 'enqueued' | 'existing';
  intentId: string;
  idempotencyKey: string;
  state: EmailDeliveryState;
};

export interface DispatchEmailInput {
  intentId: string;
  recipient: string;
  message: {
    subject: string;
    text: string;
    html: string;
  };
}

export type DispatchClaim =
  | { kind: 'claimed'; intentId: string; idempotencyKey: string }
  | { kind: 'disabled' | 'already_dispatched' | 'in_progress' | 'needs_review'; state: EmailDeliveryState };

export type DispatchOutcome =
  | { kind: 'accepted'; state: ProviderAcceptedState }
  | { kind: 'retry'; state: 'queued' | 'unknown' }
  | { kind: 'skipped'; reason: Exclude<DispatchClaim['kind'], 'claimed'>; state: EmailDeliveryState }
  | { kind: 'needs_review'; state: 'needs_review' }
  | { kind: 'failed'; state: 'failed' };

export type EmailProviderEventType =
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'suppressed'
  | 'failed';

export type ProviderAcceptedState = 'accepted' | EmailProviderEventType;

export interface ReduceProviderEventInput {
  svixId: string;
  providerReference: string;
  type: EmailProviderEventType;
  occurredAt: string;
}

export type ReduceProviderEventOutcome =
  | { kind: 'reduced'; intentId: string; state: EmailDeliveryState }
  | { kind: 'duplicate'; state: EmailDeliveryState }
  | { kind: 'unmatched'; state: 'unknown' };

export interface EmailDispatcherRepository {
  /** Atomically inserts/reuses both the durable intent and its dispatch fence. */
  enqueue(input: EnqueueEmailInput): Promise<EnqueueEmailOutcome>;
  /** Atomically inserts/reuses every intent/fence in one logical auth event. */
  enqueueAll(inputs: readonly EnqueueEmailInput[]): Promise<EnqueueEmailOutcome[]>;
  claimDispatch(input: { intentId: string; recipient: string }): Promise<DispatchClaim>;
  recordAccepted(input: {
    intentId: string;
    providerReference: string;
  }): Promise<{ state: ProviderAcceptedState | 'needs_review' }>;
  recordDispatchFailure(input: {
    intentId: string;
    failure: 'retryable' | 'ambiguous' | 'permanent';
  }): Promise<{ state: 'queued' | 'unknown' | 'needs_review' | 'failed'; retryable: boolean }>;
  reduceProviderEvent(input: ReduceProviderEventInput): Promise<ReduceProviderEventOutcome>;
}

export type EmailProviderSendOutcome =
  | { kind: 'accepted'; providerReference: string }
  | { kind: 'retryable_failure' }
  | { kind: 'ambiguous_failure' }
  | { kind: 'permanent_failure' };

export interface EmailProvider {
  send(input: DispatchEmailInput & { idempotencyKey: string }): Promise<EmailProviderSendOutcome>;
}

export interface EmailDispatcher {
  enqueue(input: EnqueueEmailInput): Promise<EnqueueEmailOutcome>;
  enqueueAll(inputs: readonly EnqueueEmailInput[]): Promise<EnqueueEmailOutcome[]>;
  dispatch(input: DispatchEmailInput): Promise<DispatchOutcome>;
  reduceProviderEvent(input: ReduceProviderEventInput): Promise<ReduceProviderEventOutcome>;
}

export function createEmailDispatcher(dependencies: {
  repository: EmailDispatcherRepository;
  provider: EmailProvider;
}): EmailDispatcher {
  return {
    enqueue(input) {
      return dependencies.repository.enqueue(input);
    },
    enqueueAll(inputs) {
      return dependencies.repository.enqueueAll(inputs);
    },
    async dispatch(input) {
      const claim = await dependencies.repository.claimDispatch({
        intentId: input.intentId,
        recipient: input.recipient,
      });
      if (claim.kind !== 'claimed') {
        if (claim.kind === 'needs_review') return { kind: 'needs_review', state: 'needs_review' };
        return { kind: 'skipped', reason: claim.kind, state: claim.state };
      }

      const providerOutcome = await dependencies.provider.send({
        ...input,
        idempotencyKey: claim.idempotencyKey,
      });
      if (providerOutcome.kind === 'accepted') {
        try {
          const recorded = await dependencies.repository.recordAccepted({
            intentId: input.intentId,
            providerReference: providerOutcome.providerReference,
          });
          if (recorded.state === 'needs_review') {
            return { kind: 'needs_review', state: 'needs_review' };
          }
          return { kind: 'accepted', state: recorded.state };
        } catch {
          // The provider may already have accepted the request. Returning retry makes the
          // upstream Hook replay the same durable intent and Resend idempotency key.
          return { kind: 'retry', state: 'unknown' };
        }
      }

      const failure = providerOutcome.kind === 'retryable_failure'
        ? 'retryable'
        : providerOutcome.kind === 'ambiguous_failure'
          ? 'ambiguous'
          : 'permanent';
      const recorded = await dependencies.repository.recordDispatchFailure({
        intentId: input.intentId,
        failure,
      });
      if (recorded.state === 'failed') return { kind: 'failed', state: 'failed' };
      if (recorded.state === 'needs_review' || !recorded.retryable) {
        return { kind: 'needs_review', state: 'needs_review' };
      }
      return {
        kind: 'retry',
        state: recorded.state as 'queued' | 'unknown',
      };
    },
    reduceProviderEvent(input) {
      return dependencies.repository.reduceProviderEvent(input);
    },
  };
}
