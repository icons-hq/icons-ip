import 'server-only';

import {
  normalizeAccountDeletionPreview,
  normalizeAccountDeletionStatus,
  UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION,
  type AccountDeletionPresentation,
} from './account-deletion';
import { createClient } from './supabase/server';

export type AccountDeletionWriteFenceState = 'clear' | 'fenced' | 'unavailable';

function isClearAccountDeletionStatus(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return status.status === 'not_requested'
    && status.phase === 'none'
    && status.nextAction === '/settings'
    && Array.isArray(status.blockers)
    && status.blockers.length === 0;
}

/**
 * Uses the account owner's public, self-scoped RPC rather than private fence
 * tables. Any deletion request is a write fence; a failed or malformed read
 * is deliberately distinct so mutation callers can fail closed.
 */
export async function getCurrentAccountDeletionWriteFenceState(): Promise<AccountDeletionWriteFenceState> {
  try {
    const supabase = await createClient();
    const result = await supabase.rpc('get_my_account_deletion_status');
    if (result.error) return 'unavailable';
    return isClearAccountDeletionStatus(result.data) ? 'clear' : 'fenced';
  } catch {
    return 'unavailable';
  }
}

export async function getAccountDeletionPresentation(): Promise<AccountDeletionPresentation> {
  const supabase = await createClient();
  const [previewResult, statusResult] = await Promise.all([
    supabase.rpc('preview_my_account_deletion'),
    supabase.rpc('get_my_account_deletion_status'),
  ]);

  if (previewResult.error || statusResult.error) {
    return UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION;
  }

  return {
    preview: normalizeAccountDeletionPreview(previewResult.data),
    status: normalizeAccountDeletionStatus(statusResult.data),
  };
}
