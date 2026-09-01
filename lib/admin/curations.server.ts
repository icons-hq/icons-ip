import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { imageUrlFromBg, normalizePublicMediaPath } from '@/lib/media';
import type { AdminCurationKind } from './curations';

export type AdminCurationStatus = 'inactive' | 'scheduled' | 'active' | 'ended';

export interface AdminCurationRecord {
  id: string;
  kind: AdminCurationKind;
  ipId: string | null;
  title: string;
  imagePath: string | null;
  imageUrl: string | null;
  /* payload 로 나르는 모바일 아트웍의 공개 URL — 없으면 null. 운영자가 저장된
     모바일 스트립·히어로 아트웍을 폼에서 확인할 수 있어야 한다(로드리뷰 #358). */
  mobileImageUrl: string | null;
  linkPath: string;
  displayOrder: number;
  activeFrom: string;
  activeTo: string | null;
  enabled: boolean;
  /* best_tab 전용 슬롯과 kind별 payload — 폼 초기값이 여기서 나온다 (#325). */
  slot: string | null;
  payload: Record<string, unknown> | null;
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
  slot: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  /*
   * 특집 IP가 가리키는 IP의 아트워크. 큐레이션이 자기 이미지를 갖지 않았을 때만 쓴다.
   * `home_curations.ip_id → ips.id`는 many-to-one이라 PostgREST가 배열이 아니라
   * 객체 하나를 돌려준다(로컬 REST로 실측). 타입 없는 client는 embed 카디널리티를
   * 추론하지 못해 배열로 보므로 `lib/draw-tickets.ts`와 같은 방식으로 단정한다.
   */
  ips: { bg: string | null; image_path: string | null } | null;
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
      'id,kind,ip_id,title,image_path,link_path,display_order,active_from,active_to,enabled,created_at,updated_at,slot,payload,ips(bg,image_path)',
    )
    .order('kind', { ascending: true })
    .order('display_order', { ascending: true })
    .order('active_from', { ascending: true })
    .order('id', { ascending: true });

  if (error || !Array.isArray(data)) throw new Error('Failed to load admin curations');

  const imageUrlForPath = (path: string | null | undefined) => (
    path
      ? supabase.storage
        .from('public-media')
        .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl
      : null
  );

  /*
   * 홈에 실제로 나가는 그림을 그대로 보여준다. 특집 IP 큐레이션이 자기 아트워크를
   * 갖지 않으면 홈은 IP 자신의 이미지를 쓴다(`lib/catalog.ts`의 `imageBgByIpId`는
   * 큐레이션 이미지가 있을 때만 IP의 bg를 덮어쓴다). 어드민이 빈 칸을 보여주면
   * 운영자는 홈에 뭐가 나가는지 확인할 수 없다.
   */
  const previewUrlFor = (row: AdminCurationRow) => (
    imageUrlForPath(row.image_path)
    ?? imageUrlForPath(row.ips?.image_path)
    ?? imageUrlFromBg(row.ips?.bg)
  );

  return (data as unknown as AdminCurationRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    ipId: row.ip_id,
    title: row.title,
    imagePath: row.image_path,
    imageUrl: previewUrlFor(row),
    mobileImageUrl: imageUrlForPath(
      typeof row.payload?.mobile_image_path === 'string' ? row.payload.mobile_image_path : null,
    ),
    linkPath: row.link_path,
    displayOrder: row.display_order,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    enabled: row.enabled,
    slot: row.slot ?? null,
    payload: row.payload ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: getAdminCurationStatus(row.enabled, row.active_from, row.active_to, now),
  }));
}
