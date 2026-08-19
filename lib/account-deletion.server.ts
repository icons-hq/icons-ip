import 'server-only';

import {
  normalizeAccountDeletionPreview,
  normalizeAccountDeletionStatus,
  UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION,
  type AccountDeletionPresentation,
} from './account-deletion';
import { createClient } from './supabase/server';

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
