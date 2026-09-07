import 'server-only';

import { unstable_cache } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { POPUPS_CACHE_TAG, popupCacheTag, type PopupSnapshot } from '@/lib/popups';

/*
 * 팝업 로더 (설계서 v2 §1-8).
 *
 * 스냅샷은 캐시하되 **수명을 짧게** 둔다. 경계에서 크론이 태그를 버리므로 보통은 즉시
 * 갱신되고, 크론이 못 돌아도 이 수명만큼만 늦는다 — 캐시가 안전망을 겸한다.
 */

const SNAPSHOT_MAX_AGE_SECONDS = 60;

export interface AdminPopupRow {
  id: string;
  ipId: string;
  ipTitle: string | null;
  title: string;
  status: string;
  displayState: string;
  startsAt: string;
  endsAt: string;
  phaseCount: number;
  linkCount: number;
  currentPhase: string | null;
}

interface PopupListRow {
  id: string;
  ip_id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
  display_state: string;
  phase_count: number;
  link_count: number;
  current_phase: string | null;
  ip_title: string | null;
}

export async function getAdminPopups(): Promise<AdminPopupRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_popups');
  if (error) throw new Error(`Failed to load popups: ${error.message}`);
  return ((data ?? []) as PopupListRow[]).map((row) => ({
    id: row.id,
    ipId: row.ip_id,
    ipTitle: row.ip_title,
    title: row.title,
    status: row.status,
    displayState: row.display_state,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    phaseCount: row.phase_count,
    linkCount: row.link_count,
    currentPhase: row.current_phase,
  }));
}

export interface AdminPopupDetail {
  popup: Record<string, unknown>;
  displayState: string;
  updatedAt: string;
  phases: {
    id: string; key: string; label: string; startsAt: string; endsAt: string;
    sort: number; defaultSaleMode: string;
  }[];
  zones: { id: string; code: string; kind: string; name: string; door: string | null; sort: number }[];
  links: {
    id: string; targetType: string; targetId: string; zoneCode: string | null; sort: number;
    defaultSaleMode: string | null; currentMode: string;
    phaseRules: { phaseKey: string; saleMode: string }[];
  }[];
}

export async function getAdminPopupDetail(popupId: string): Promise<AdminPopupDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_popup_detail', { target_popup_id: popupId });
  if (error) {
    if (error.message.includes('catalog_record_missing')) return null;
    throw new Error(`Failed to load popup ${popupId}: ${error.message}`);
  }
  return (data ?? null) as AdminPopupDetail | null;
}

/**
 * 미리보기 — 임의 시각의 스냅샷. **소비자 화면과 같은 함수**를 부른다.
 * 미리보기를 따로 만들면 「미리보기에서는 됐는데 실제로는 안 열린」 팝업이 생긴다.
 */
export async function getPopupPreview(popupId: string, asOf: string | null): Promise<PopupSnapshot | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('popup_snapshot', {
    p_as_of: asOf,
    p_popup_id: popupId,
  });
  if (error) {
    if (error.message.includes('popup_unavailable')) return null;
    throw new Error(`Failed to load popup snapshot: ${error.message}`);
  }
  return (data ?? null) as PopupSnapshot | null;
}

/** 소비자 화면이 읽는 스냅샷. 캐시 태그는 경계 tick 이 버린다. */
export function getCachedPopupSnapshot(popupId: string) {
  return unstable_cache(
    async () => {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc('popup_snapshot', { p_popup_id: popupId });
      if (error) return null;
      return (data ?? null) as PopupSnapshot | null;
    },
    ['popup-snapshot', popupId],
    { revalidate: SNAPSHOT_MAX_AGE_SECONDS, tags: [POPUPS_CACHE_TAG, popupCacheTag(popupId)] },
  )();
}
