import 'server-only';

import {
  normalizeAccountDeletionPreview,
  normalizeAccountDeletionStatus,
  type AccountDeletionPresentation,
} from './account-deletion';
import { createClient } from './supabase/server';

export async function getAccountDeletionPresentation(): Promise<AccountDeletionPresentation> {
  const supabase = await createClient();
  const [previewResult, statusResult] = await Promise.all([
    supabase.rpc('preview_my_account_deletion'),
    supabase.rpc('get_my_account_deletion_status'),
  ]);

  return {
    preview: normalizeAccountDeletionPreview(
      previewResult.error ? null : previewResult.data,
    ),
    status: normalizeAccountDeletionStatus(
      statusResult.error ? null : statusResult.data,
    ),
  };
}
