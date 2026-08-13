export class DeletionLedgerConflictError extends Error {
  readonly code = 'event_digest_conflict';

  constructor(readonly eventKey: string) {
    super(`Deletion ledger event conflict: ${eventKey}`);
    this.name = 'DeletionLedgerConflictError';
  }
}

export type DeletionLedgerPageTokenErrorCode =
  | 'invalid_page_token'
  | 'cursor_mismatch'
  | 'generation_mismatch';

export class DeletionLedgerPageTokenError extends Error {
  constructor(readonly code: DeletionLedgerPageTokenErrorCode) {
    super(`Deletion ledger page token rejected: ${code}`);
    this.name = 'DeletionLedgerPageTokenError';
  }
}

export class DeletionLedgerUnavailableError extends Error {
  readonly code = 'deletion_ledger_unavailable';

  constructor() {
    super('Secondary deletion ledger is disabled');
    this.name = 'DeletionLedgerUnavailableError';
  }
}
