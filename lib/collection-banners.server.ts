import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import {
  liveCollectionBanners,
  parseCollectionBannerRow,
  type CollectionBanner,
  type CollectionBannerRow,
  type CollectionBannerSlot,
} from './collection-banners';
import { normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from './media';
import { NOTICE_STRIP_CACHE_TAG } from './notice-strip.server';
import { getSupabaseConfig } from './supabase/config';

/*
 * 컬렉션 배너 읽기(CL-09). 셸 메뉴(lib/storefront-mega-menu.server.ts)와 같은 쿠키 없는 anon 읽기 + unstable_cache 300초다.
 * 세 컬렉션(굿즈샵·BEST·NEW)이 같은 목록 하나를 나눠 쓰고, 홈 큐레이션 저장이 같은 태그('home-curations')를 즉시 만료한다
 * (app/admin/curation-actions.ts의 updateTag). 공개 읽기 RLS 가 '지금 노출 중'인 행만 주므로 예약한 시작은 최대 5분 늦을 수 있고,
 * 종료 시각은 요청마다 다시 걸러 캐시가 끝난 배너를 붙들지 않는다.
 *
 * 실패한 읽기는 캐시하지 않는다(QA l5-qa-3과 같은 이유) — 캐시 함수가 던지고 바깥이 배너 없음(지금 화면 그대로)으로 그린다.
 * 정상으로 돌아온 빈 목록은 그대로 캐시한다.
 */

class CollectionBannerReadError extends Error {
  readonly code: string | null;

  constructor(code: string | null, detail: string) {
    super(`collection banner read failed: ${code ?? 'unknown'} ${detail.slice(0, 200)}`);
    this.name = 'CollectionBannerReadError';
    this.code = code;
  }
}

async function loadCollectionBanners(): Promise<CollectionBanner[]> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return [];
  const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('home_curations')
    .select('id,title,image_path,link_path,slot,active_to,payload')
    .eq('kind', 'collection_banner')
    .eq('enabled', true)
    .lte('active_from', now)
    .or(`active_to.is.null,active_to.gt.${now}`)
    .order('display_order', { ascending: true })
    .order('active_from', { ascending: true })
    .order('id', { ascending: true })
    .limit(90);
  if (error || !Array.isArray(data)) {
    throw new CollectionBannerReadError(error?.code ?? null, error?.message ?? 'invalid response');
  }
  const publicUrlFor = (path: string) => client.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;
  return (data as CollectionBannerRow[]).flatMap((row) => {
    const banner = parseCollectionBannerRow(row, publicUrlFor);
    return banner ? [banner] : [];
  });
}

const getCachedCollectionBanners = unstable_cache(
  loadCollectionBanners,
  ['collection-banners'],
  { revalidate: 300, tags: [NOTICE_STRIP_CACHE_TAG] },
);

/** 컬렉션 페이지가 부르는 읽기. 실패해도 던지지 않는다 — 배너 없이(지금의 텍스트 머리말 그대로) 그린다. */
export async function getCollectionBanners(slot: CollectionBannerSlot, now: number = Date.now()): Promise<CollectionBanner[]> {
  try {
    return liveCollectionBanners(await getCachedCollectionBanners(), slot, now);
  } catch (error) {
    console.error('[storefront/collection-banners] read failed', {
      code: error instanceof CollectionBannerReadError ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
