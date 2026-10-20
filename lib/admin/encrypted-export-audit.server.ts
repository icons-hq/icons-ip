import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import type { AdminListExportSheet } from './list-export';
import { AdminListExportAuditError } from './list-export-data.server';

export async function recordEncryptedListExport(actorId: string, sheet: AdminListExportSheet, sha256: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('service_record_encrypted_list_export', {
    p_actor_id: actorId, p_screen: sheet.screen, p_filters: sheet.filters, p_row_count: sheet.rows.length,
    p_record_count: sheet.recordCount, p_file_sha256: sha256,
  });
  if (error || typeof data !== 'string') throw new AdminListExportAuditError();
  return data;
}

export async function recordEncryptedSettledExport(actorId: string, receiptId: string, sha256: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('service_record_encrypted_settled_export', { p_actor_id: actorId, p_export_id: receiptId, p_file_sha256: sha256 });
  if (error || typeof data !== 'string') throw new AdminListExportAuditError();
  return data;
}
