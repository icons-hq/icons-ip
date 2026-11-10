import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from './media';
import { getSupabaseConfig } from './supabase/config';
import {
  EMPTY_STOREFRONT_MEGA_MENUS,
  MENU_CAMPAIGN_QUERY_LIMIT,
  STOREFRONT_MEGA_MENU_CACHE_TAG,
  parseStorefrontCategoryMenu,
  toMenuCampaigns,
  toMenuIps,
  type StorefrontMegaMenus,
} from './storefront-mega-menu';

/*
 * 메가메뉴·카테고리 시트는 전역 셸의 일부라 루트 레이아웃이 한 번 읽는다. 셸 공지·메뉴 설정처럼
 * 쿠키 없는 anon 클라이언트로 읽고 unstable_cache 로 300초 재검증한다 — cookies() 를 쓰면 법적 문서의 SSG 가
 * dynamic 으로 무너진다(#325). 전시분류·구성·이미지 저장(category-display-actions)과 상품분류 액션(고객 카테고리 공개 전환 포함,
 * category-actions)은 태그를 즉시 만료한다. 상품 공개·캠페인·피처드 IP 변경은 TTL(300초) 안에 반영된다.
 * 세 원천은 따로 실패한다: 하나를 못 읽으면 그 부분만 비고(카테고리가 비면 기존 메뉴), 셸은 깨지지 않는다.
 *
 * 실패한 읽기는 캐시하지 않는다(QA l5-qa-3). 원천이 오류를 돌려주거나 메뉴 트리가 검증에 실패하면 캐시 함수가 던지고,
 * 바깥이 받아 읽은 부분으로 그린다 — 다음 요청이 바로 다시 읽는다. 예전에는 빈 카테고리를 정상 값처럼 300초 동안 남겨,
 * 배포·db reset 직후 PostgREST 스키마 캐시가 새 RPC 를 아직 모르는 순간(PGRST202) 한 번이 5분짜리 폴백 메뉴가 됐고 원인도 남지 않았다.
 * 스위치 OFF·공개 전시 없음처럼 RPC 가 정상으로 돌려준 빈 트리는 실패가 아니라 그대로 캐시한다.
 */

type MegaMenuSource = 'client' | 'menu' | 'campaigns' | 'featuredIps';

export interface StorefrontMegaMenuSourceFailure {
  source: MegaMenuSource;
  code: string | null;
  message: string;
}

export interface StorefrontMegaMenuRead {
  menus: StorefrontMegaMenus;
  failures: StorefrontMegaMenuSourceFailure[];
}

/** 캐시 함수가 실패한 읽기를 캐시에 남기지 않으려고 던지는 오류. 읽은 부분(menus)을 실어 바깥이 그대로 그린다. */
export class StorefrontMegaMenuReadError extends Error {
  declare readonly menus: StorefrontMegaMenus;
  readonly failures: StorefrontMegaMenuSourceFailure[];

  constructor(read: StorefrontMegaMenuRead) {
    super(`storefront mega menu read failed: ${read.failures.map((failure) => `${failure.source}(${failure.code ?? 'unknown'})`).join(', ')}`);
    this.name = 'StorefrontMegaMenuReadError';
    this.failures = read.failures;
    /* 재검증 실패를 Next 가 console.error 로 찍을 때 메뉴 전체가 로그에 쏟아지지 않게 열거하지 않는다. */
    Object.defineProperty(this, 'menus', { value: read.menus, enumerable: false });
  }
}

function sourceFailure(source: MegaMenuSource, error: unknown): StorefrontMegaMenuSourceFailure {
  const value = (error ?? {}) as { code?: unknown; message?: unknown };
  return {
    source,
    code: typeof value.code === 'string' && value.code ? value.code : null,
    message: (typeof value.message === 'string' && value.message ? value.message : String(error)).slice(0, 200),
  };
}

/** 세 원천을 읽어 읽은 값과 실패 목록을 돌려준다. 던지지 않는다 — 실패는 서버 로그로 남긴다. */
export async function readStorefrontMegaMenus(now: Date = new Date()): Promise<StorefrontMegaMenuRead> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return { menus: EMPTY_STOREFRONT_MEGA_MENUS, failures: [] };
  const failures: StorefrontMegaMenuSourceFailure[] = [];
  let menus = EMPTY_STOREFRONT_MEGA_MENUS;
  try {
    const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
    const publicUrlFor = (path: string) => client.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;
    const at = now.toISOString();
    const [menu, campaigns, ips] = await Promise.all([
      client.rpc('get_storefront_category_menu'),
      /* 진행 중 기획전 — 허브 배너 순서(featured_order)를 먼저, 그다음 최근 시작 순. 초안은 RLS 가 가린다.
         상한(8)보다 넉넉히 읽는다 — 자르기는 검증 뒤 toMenuCampaigns 가 한다(검증에서 빠진 자리를 다음 캠페인이 채운다). */
      client.from('campaigns')
        .select('id,title,card_image_path')
        .eq('status', 'published')
        .lte('starts_at', at)
        .gt('ends_at', at)
        .order('featured_order', { ascending: true, nullsFirst: false })
        .order('starts_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(MENU_CAMPAIGN_QUERY_LIMIT),
      client.from('ips')
        .select('id,public_slug,title,bg,image_path,sort_order')
        .eq('featured', true)
        .is('archived_at', null)
        .not('published_at', 'is', null)
        .limit(100),
    ]);
    let categories = menu.error ? null : parseStorefrontCategoryMenu(menu.data, publicUrlFor);
    if (menu.error) failures.push(sourceFailure('menu', menu.error));
    else if (!categories) failures.push({ source: 'menu', code: 'invalid_menu_payload', message: 'menu tree failed validation' });
    categories ??= [];
    if (campaigns.error) failures.push(sourceFailure('campaigns', campaigns.error));
    if (ips.error) failures.push(sourceFailure('featuredIps', ips.error));
    menus = {
      categories,
      campaigns: campaigns.error ? [] : toMenuCampaigns(campaigns.data, publicUrlFor),
      featuredIps: ips.error ? [] : toMenuIps(ips.data, publicUrlFor),
    };
  } catch (error) {
    failures.push(sourceFailure('client', error));
    menus = EMPTY_STOREFRONT_MEGA_MENUS;
  }
  for (const failure of failures) console.error('[storefront/mega-menu] source read failed', failure);
  return { menus, failures };
}

/** 캐시 안에서만 부른다 — 실패가 하나라도 있으면 던져서 그 결과가 캐시에 남지 않게 한다. */
async function loadCacheableStorefrontMegaMenus(): Promise<StorefrontMegaMenus> {
  const read = await readStorefrontMegaMenus();
  if (read.failures.length) throw new StorefrontMegaMenuReadError(read);
  return read.menus;
}

const getCachedStorefrontMegaMenus = unstable_cache(
  loadCacheableStorefrontMegaMenus,
  ['storefront-mega-menus'],
  { revalidate: 300, tags: [STOREFRONT_MEGA_MENU_CACHE_TAG] },
);

/*
 * 셸이 부르는 읽기. 캐시 값이 있으면 그것을, 없거나 만료된 뒤 다시 읽다 실패하면 이번에 읽은 부분을 캐시 없이 돌려준다.
 * (만료된 값이 있는 상태에서 백그라운드 재검증이 실패하면 Next 가 그 오류를 삼키고 만료 전 값을 계속 준다 — 실패가 좋은 값을 덮지 않는다.)
 * 페이지 재검증 주기(300초)와 태그는 Next 가 콜백 전에 기록하므로, 빌드 중 실패해도 정적 페이지는 5분 뒤 다시 그려진다.
 */
export async function getStorefrontMegaMenus(): Promise<StorefrontMegaMenus> {
  try {
    return await getCachedStorefrontMegaMenus();
  } catch (error) {
    if (error instanceof StorefrontMegaMenuReadError) return error.menus;
    throw error;
  }
}
