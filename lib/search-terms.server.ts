import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { NOTICE_STRIP_CACHE_TAG } from './notice-strip.server';
import { liveSuggestedSearchTerms, parseSuggestedSearchTerms, type SuggestedSearchTermList } from './search-terms';
import { getSupabaseConfig } from './supabase/config';

/*
 * 운영 추천 검색어(11 CH-10). 셸 전역 데이터라 루트 레이아웃이 한 번 읽는다(/search 의 빈 검색·0건 칩도 같은 캐시를 읽는다) — 셸 메뉴(lib/storefront-mega-menu.server.ts)·
 * 셸 공지와 같은 쿠키 없는 anon 읽기 + unstable_cache 300초다(cookies() 를 쓰면 법적 문서 SSG 가 dynamic 으로 무너진다, #325).
 * 홈 큐레이션 저장이 같은 태그('home-curations')를 즉시 만료한다(app/admin/curation-actions.ts의 updateTag).
 *
 * 지금 노출 중인 목록 중 노출 시작이 가장 늦은 하나를 쓴다 — 다음 달 목록을 미리 예약해 두면 시작 시각에 이어받는다
 * (공개 읽기 RLS 가 노출 중인 행만 주므로 예약 시작은 최대 5분 늦을 수 있다). 캐시에는 후보 목록을 끝나는 시각과 함께 담고
 * 요청마다 끝난 목록을 다시 거른다 — 캐시가 끝난 목록을 붙들지 않고 앞선 목록(없으면 코드 상수)이 바로 이어받는다(컬렉션 배너와 같다).
 * 목록이 없거나 깨졌으면 null — 셸은 코드 상수로 돌아간다.
 * 실패한 읽기는 캐시하지 않는다(던져서 캐시 밖으로 보내고 로그만 남긴다).
 */

interface SearchTermRow {
  payload: Record<string, unknown> | null;
  active_to: string | null;
}

async function loadOperatorSearchTermLists(): Promise<SuggestedSearchTermList[]> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return [];
  const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from('home_curations')
    .select('payload,active_to')
    .eq('kind', 'search_terms')
    .eq('enabled', true)
    .lte('active_from', nowIso)
    .or(`active_to.is.null,active_to.gt.${nowIso}`)
    .order('active_from', { ascending: false })
    .order('display_order', { ascending: true })
    .order('id', { ascending: true })
    .limit(20);
  if (error || !Array.isArray(data)) {
    throw new Error(`suggested search terms read failed: ${error?.code ?? 'invalid response'}`);
  }
  return (data as SearchTermRow[]).flatMap((row) => {
    const terms = parseSuggestedSearchTerms(row.payload?.terms);
    if (!terms) return [];
    const endsAt = row.active_to ? Date.parse(row.active_to) : null;
    return [{ terms, endsAt: endsAt !== null && Number.isFinite(endsAt) ? endsAt : null }];
  });
}

const getCachedOperatorSearchTermLists = unstable_cache(
  loadOperatorSearchTermLists,
  ['suggested-search-terms'],
  { revalidate: 300, tags: [NOTICE_STRIP_CACHE_TAG] },
);

/** 셸이 부르는 읽기. 던지지 않는다 — 실패하면 null(코드 상수 폴백)이다. */
export async function getOperatorSearchTerms(): Promise<string[] | null> {
  try {
    return liveSuggestedSearchTerms(await getCachedOperatorSearchTermLists(), Date.now());
  } catch (error) {
    console.error('[storefront/search-terms] read failed', error instanceof Error ? error.message : String(error));
    return null;
  }
}
