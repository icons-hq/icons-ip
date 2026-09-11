import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { OperationsContact, OperationsContactHistory, OperationsContactScope } from './operations-contacts';

type ContactRow = {
  scope: OperationsContactScope; origin_id: string | null; origin_name: string | null; origin_active: boolean | null;
  owner_name: string; contact: string; source_reference: string; handoff_reference: string;
  updated_at: string | null; updated_by_name: string | null;
};
type HistoryRow = {
  id: string; actor_name: string | null; scope: OperationsContactScope; origin_name: string | null;
  changed_fields: string[]; created_at: string;
};

export async function loadAdminOperationsContacts(): Promise<{ contacts: OperationsContact[]; history: OperationsContactHistory[] }> {
  const client = await createClient();
  const [contacts, history] = await Promise.all([
    client.rpc('admin_operations_contacts'),
    client.rpc('admin_operations_contact_history', { row_limit: 30 }),
  ]);
  if (contacts.error || history.error) throw new Error('운영 담당자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return {
    contacts: (contacts.data ?? []).map((row: ContactRow) => ({
      scope: row.scope, originId: row.origin_id, originName: row.origin_name, originActive: row.origin_active,
      ownerName: row.owner_name, contact: row.contact, sourceReference: row.source_reference, handoffReference: row.handoff_reference,
      updatedAt: row.updated_at, updatedByName: row.updated_by_name,
    })),
    history: (history.data ?? []).map((row: HistoryRow) => ({
      id: row.id, actorName: row.actor_name ?? '삭제된 운영자', scope: row.scope, originName: row.origin_name,
      changedFields: row.changed_fields, createdAt: row.created_at,
    })),
  };
}
