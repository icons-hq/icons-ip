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
 */
export async function loadStorefrontMegaMenus(now: Date = new Date()): Promise<StorefrontMegaMenus> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return EMPTY_STOREFRONT_MEGA_MENUS;
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
    return {
      categories: menu.error ? [] : parseStorefrontCategoryMenu(menu.data, publicUrlFor) ?? [],
      campaigns: campaigns.error ? [] : toMenuCampaigns(campaigns.data, publicUrlFor),
      featuredIps: ips.error ? [] : toMenuIps(ips.data, publicUrlFor),
    };
  } catch {
    return EMPTY_STOREFRONT_MEGA_MENUS;
  }
}

export const getStorefrontMegaMenus = unstable_cache(
  () => loadStorefrontMegaMenus(),
  ['storefront-mega-menus'],
  { revalidate: 300, tags: [STOREFRONT_MEGA_MENU_CACHE_TAG] },
);
