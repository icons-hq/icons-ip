import 'server-only';

import type { DeletionLedger } from './contract';
import { createDisabledDeletionLedger } from './disabled';

const runtimeDeletionLedger = createDisabledDeletionLedger();

export function getDeletionLedger(): DeletionLedger {
  return runtimeDeletionLedger;
}
