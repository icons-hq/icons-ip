import 'server-only';

import {
  digestDeletionLedgerEvent,
  isDeletionLedgerGeneration,
  snapshotDeletionLedgerEvent,
  type DeletionLedger,
  type DeletionLedgerAcknowledgement,
  type DeletionLedgerRecord,
} from './contract';
import {
  DeletionLedgerConflictError,
  DeletionLedgerPageTokenError,
} from './errors';
import { createDeletionLedgerPageTokenCodec } from './page-token';
import { isCanonicalUtcMillisecondTimestamp } from './internal';

interface InMemoryDeletionLedgerOptions {
  readonly generation: string;
  readonly pageSize: number;
  readonly pageTokenKey: Uint8Array;
  readonly now: () => string;
}

interface StoredEvent {
  readonly canonicalDigest: string;
  readonly acknowledgement: DeletionLedgerAcknowledgement;
  readonly record: DeletionLedgerRecord;
}

export function createInMemoryDeletionLedger(
  options: InMemoryDeletionLedgerOptions,
): DeletionLedger {
  if (
    !isDeletionLedgerGeneration(options.generation)
    || !Number.isSafeInteger(options.pageSize)
    || options.pageSize < 1
    || options.pageSize > 1_000
    || typeof options.now !== 'function'
  ) {
    throw new TypeError('Invalid in-memory deletion ledger options');
  }
  const generation = options.generation;
  const pageSize = options.pageSize;
  const now = options.now;
  const byEventKey = new Map<string, StoredEvent>();
  const records: DeletionLedgerRecord[] = [];
  const pageTokens = createDeletionLedgerPageTokenCodec(options.pageTokenKey);

  const ledger: DeletionLedger = {
    async append(event) {
      const storedEvent = snapshotDeletionLedgerEvent(event);
      const canonicalDigest = digestDeletionLedgerEvent(storedEvent);
      const existing = byEventKey.get(storedEvent.eventKey);
      if (existing) {
        if (existing.canonicalDigest !== canonicalDigest) {
          throw new DeletionLedgerConflictError(storedEvent.eventKey);
        }
        return existing.acknowledgement;
      }

      const ackedAt = now();
      if (!isCanonicalUtcMillisecondTimestamp(ackedAt)) {
        throw new TypeError('Invalid in-memory deletion ledger clock');
      }
      const acknowledgement = Object.freeze({
        eventKey: storedEvent.eventKey,
        canonicalDigest,
        sequence: records.length + 1,
        generation,
        ackedAt,
      } satisfies DeletionLedgerAcknowledgement);
      const record = Object.freeze({
        event: storedEvent,
        ...acknowledgement,
      } satisfies DeletionLedgerRecord);

      records.push(record);
      byEventKey.set(storedEvent.eventKey, { canonicalDigest, acknowledgement, record });
      return acknowledgement;
    },

    async scanAfter(sequence, pageToken) {
      if (
        !Number.isSafeInteger(sequence)
        || sequence < 0
        || (pageToken !== null && (
          typeof pageToken !== 'string'
          || pageToken.length === 0
          || pageToken.length > 4_096
        ))
      ) {
        throw new TypeError('Invalid deletion ledger scan input');
      }
      const tokenState = pageToken === null
        ? {
            cursor: sequence,
            after: sequence,
            upperBound: records.at(-1)?.sequence ?? 0,
            generation,
          }
        : pageTokens.decode(pageToken);
      if (tokenState.generation !== generation) {
        throw new DeletionLedgerPageTokenError('generation_mismatch');
      }
      if (tokenState.cursor !== sequence) {
        throw new DeletionLedgerPageTokenError('cursor_mismatch');
      }

      const events = Object.freeze(records
        .filter((record) => (
          record.sequence > tokenState.after
          && record.sequence <= tokenState.upperBound
        ))
        .slice(0, pageSize));
      const lastSequence = events.at(-1)?.sequence ?? tokenState.after;
      const hasMore = records.some((record) => (
        record.sequence > lastSequence
        && record.sequence <= tokenState.upperBound
      ));

      return Object.freeze({
        events,
        nextPageToken: hasMore
          ? pageTokens.encode({ ...tokenState, after: lastSequence })
          : null,
      });
    },
  };
  return Object.freeze(ledger);
}
