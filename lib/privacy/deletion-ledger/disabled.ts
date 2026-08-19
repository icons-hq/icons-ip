import 'server-only';

import type { DeletionLedger } from './contract';
import { DeletionLedgerUnavailableError } from './errors';

export function createDisabledDeletionLedger(): DeletionLedger {
  return Object.freeze({
    async append() {
      throw new DeletionLedgerUnavailableError();
    },

    async scanAfter() {
      throw new DeletionLedgerUnavailableError();
    },
  });
}
