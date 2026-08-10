import 'server-only';

import { notFound, redirect } from 'next/navigation';
import {
  parseAdminDrawTicketGrantRecord,
  type AdminDrawTicketGrantRecord,
} from './draw-ticket-grants';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

async function requireStaffLoader() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!auth.isStaff) notFound();
}

export async function getAdminDrawTicketGrants(): Promise<AdminDrawTicketGrantRecord[]> {
  await requireStaffLoader();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_draw_ticket_grants', {
    target_limit: 20,
  });

  if (error || !Array.isArray(data)) throw new Error('Failed to load admin draw ticket grants');
  const records = data.map(parseAdminDrawTicketGrantRecord);
  if (records.some((record) => record === null)) {
    throw new Error('Failed to load admin draw ticket grants');
  }
  return records as AdminDrawTicketGrantRecord[];
}
