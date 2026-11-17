import 'server-only';

import { loadCampaignHub } from '@/lib/campaigns.server';
import { getCatalogSnapshot } from '@/lib/catalog';
import {
  mergePopupItems,
  popupItemsFromCampaigns,
  popupItemsFromEvents,
  type PopupEventTimes,
  type PopupItem,
} from '@/lib/popups';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/* POP-UP 목록 로더 (스펙 C §2.6) — 두 원천을 읽어 `lib/popups.ts`의 순수 함수로 합친다.
 *
 *  1. 오프라인 팝업 = 카탈로그 스냅샷의 `events`(모드·상태·날짜 표기·이미지 배경을 이미 갖는다). 스냅샷은 날짜를 표기 문자열로만
 *     들고 있어 끝 시각 비교와 시작 순서에 필요한 `starts_at`·`ends_at`은 `events`를 한 번 더 읽어 보완한다(카탈로그 읽기는 건드리지 않는다).
 *  2. POP-UP 캠페인 = 캠페인 허브 로더가 이미 노출 설정(`campaign_presentations`)을 함께 읽는다.
 *
 * 절대 던지지 않는다. POP-UP 은 공개 브라우징 표면이라 한쪽 원천을 못 읽었다고 500 이 되면 사이트가 고장 난 것으로 보인다 —
 * 읽지 못한 원천은 비어 있는 것으로 접고, 둘 다 비면 화면이 빈 상태를 그린다. */

async function loadEventTimes(): Promise<Map<string, PopupEventTimes>> {
  if (!getSupabaseConfig().isConfigured) return new Map();

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('events')
      .select('id,starts_at,ends_at')
      .is('archived_at', null);
    if (error) return new Map();

    return new Map(
      ((data ?? []) as { id: string; starts_at: string | null; ends_at: string | null }[]).map((row) => [
        row.id,
        { startsAt: row.starts_at, endsAt: row.ends_at },
      ]),
    );
  } catch {
    return new Map();
  }
}

async function loadOfflineEventItems(now: number): Promise<PopupItem[]> {
  try {
    const catalog = await getCatalogSnapshot();
    /* 목업 카탈로그의 이벤트는 DB 행이 아니라 시각을 보완할 수 없다 — 상태만 믿는다. */
    const times = catalog.source === 'supabase' ? await loadEventTimes() : new Map<string, PopupEventTimes>();
    return popupItemsFromEvents(catalog.events, times, now);
  } catch {
    return [];
  }
}

/** POP-UP 목록 한 벌 — 진행 중 → 오픈 예정, 최대 60개. */
export async function loadPopupItems(now: number = Date.now()): Promise<PopupItem[]> {
  const [hub, eventItems] = await Promise.all([loadCampaignHub(), loadOfflineEventItems(now)]);
  return mergePopupItems(eventItems, popupItemsFromCampaigns(hub.campaigns));
}
