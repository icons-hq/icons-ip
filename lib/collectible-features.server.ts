import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { connection } from 'next/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import {
  COLLECTIBLE_FEATURES_CACHE_TAG,
  COLLECTIBLE_FEATURES_OFF,
  parseCollectibleFeatures,
  type CollectibleFeature,
  type CollectibleFeatures,
} from './collectible-features';

/** 쿠키 없는 공개 읽기. 설정 누락·전송 실패·RPC 오류·예상 밖 모양은 전부 꺼짐이다. */
export async function loadCollectibleFeatures(): Promise<CollectibleFeatures> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return COLLECTIBLE_FEATURES_OFF;
  try {
    const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
    const { data, error } = await client.rpc('get_collectible_features');
    return (error ? null : parseCollectibleFeatures(data)) ?? COLLECTIBLE_FEATURES_OFF;
  } catch {
    return COLLECTIBLE_FEATURES_OFF;
  }
}

/* 셸(루트 레이아웃) 진입점용 캐시 읽기 — 쿠키를 만지지 않아 정적 라우트가 dynamic 으로 무너지지 않는다
   (lib/store-navigation.server.ts 와 같은 형식). 관리자 저장이 태그를 즉시 만료시키므로 300초는 안전망이다.
   노출만 정한다: 권한 경계는 아래 신선 읽기를 쓰는 라우트·서버 동작이다. */
export const getCollectibleFeatures = unstable_cache(loadCollectibleFeatures, ['collectible-features'], {
  revalidate: 300,
  tags: [COLLECTIBLE_FEATURES_CACHE_TAG],
});

/** 라우트·서버 동작의 판정용 신선 읽기. 빌드 산출물에 값이 얼지 않도록 요청 시점으로 미룬다(Next 16 connection). */
export async function readCollectibleFeatures(): Promise<CollectibleFeatures> {
  await connection();
  return loadCollectibleFeatures();
}

export async function isCollectibleFeatureEnabled(feature: CollectibleFeature): Promise<boolean> {
  return (await readCollectibleFeatures())[feature];
}
