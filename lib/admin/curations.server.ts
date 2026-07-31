import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { normalizePublicMediaPath } from '@/lib/media';
import type { AdminCurationKind } from './curations';

export type AdminCurationStatus = 'inactive' | 'scheduled' | 'active' | 'ended';

export interface AdminCurationRecord {
  id: string;
  kind: AdminCurationKind;
  ipId: string | null;
  title: string;
  imagePath: string | null;
  imageUrl: string | null;
  linkPath: string;
  displayOrder: number;
  activeFrom: string;
  activeTo: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  status: AdminCurationStatus;
}

interface AdminCurationRow {
  id: string;
  kind: AdminCurationKind;
  ip_id: string | null;
  title: string;
  image_path: string | null;
  link_path: string;
  display_order: number;
  active_from: string;
  active_to: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

async function requireStaffLoader() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(loginPath());
  if (!auth.isStaff) notFound();
}

export function getAdminCurationStatus(
  enabled: boolean,
  activeFrom: string,
  activeTo: string | null,
  now = Date.now(),
): AdminCurationStatus {
  if (!enabled) return 'inactive';
  if (now < Date.parse(activeFrom)) return 'scheduled';
  if (activeTo && now >= Date.parse(activeTo)) return 'ended';
  return 'active';
}

export async function getAdminCurations(now = Date.now()): Promise<AdminCurationRecord[]> {
  await requireStaffLoader();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('home_curations')
    .select(
      'id,kind,ip_id,title,image_path,link_path,display_order,active_from,active_to,enabled,created_at,updated_at',
    )
    .order('kind', { ascending: true })
    .order('display_order', { ascending: true })
    .order('active_from', { ascending: true })
    .order('id', { ascending: true });

  if (error || !Array.isArray(data)) throw new Error('Failed to load admin curations');

  return (data as AdminCurationRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    ipId: row.ip_id,
    title: row.title,
    imagePath: row.image_path,
    imageUrl: row.image_path
      ? supabase.storage
        .from('public-media')
        .getPublicUrl(normalizePublicMediaPath(row.image_path)).data.publicUrl
      : null,
    linkPath: row.link_path,
    displayOrder: row.display_order,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: getAdminCurationStatus(row.enabled, row.active_from, row.active_to, now),
  }));
}
