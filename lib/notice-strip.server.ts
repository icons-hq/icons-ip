import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { HOME_CURATION_IMAGE_PATTERN, isSafeInternalLink, type NoticeStrip } from './home-catalog';
import { normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from './media';
import { getSupabaseConfig } from './supabase/config';

export type { NoticeStrip } from './home-catalog';

interface NoticeStripRow {
  id: string;
  title: string;
  image_path: string | null;
  link_path: string;
}

export const NOTICE_STRIP_CACHE_TAG = 'home-curations';

/*
 * 전역 셸의 공지 스트립은 루트 레이아웃에서 내려간다. 여기서 cookies() 기반
 * 서버 클라이언트를 쓰면 legal 라우트의 SSG 가 전부 dynamic 으로 무너지는 것이
 * 실측돼 있어(#325), 쿠키 없는 anon 클라이언트로 읽고 unstable_cache 로
 * 빌드·시간 재검증한다. 어드민 큐레이션 저장이 updateTag 로 즉시 갱신한다.
 * 실패는 스트립 없음(null)으로 조용히 수렴한다 — 셸이 데이터 문제로 깨지면 안 된다.
 */
async function loadActiveNoticeStrip(): Promise<NoticeStrip | null> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return null;

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // 익명 읽기 전용 — 세션 쿠키를 다루지 않는다.
        },
      },
    });
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('home_curations')
      .select('id,title,image_path,link_path')
      .eq('kind', 'notice_strip')
      .eq('enabled', true)
      .lte('active_from', now)
      .or(`active_to.is.null,active_to.gt.${now}`)
      .order('display_order', { ascending: true })
      .order('active_from', { ascending: true })
      .order('id', { ascending: true })
      .limit(1);

    if (error) return null;
    const row = (data?.[0] ?? null) as NoticeStripRow | null;
    if (!row) return null;

    const title = row.title.trim();
    const href = row.link_path.trim();
    if (!title || Array.from(title).length > 120 || !isSafeInternalLink(href)) return null;
    if (!row.image_path || !HOME_CURATION_IMAGE_PATTERN.test(row.image_path)) return null;

    return {
      id: row.id,
      title,
      imageUrl: supabase.storage
        .from(PUBLIC_MEDIA_BUCKET)
        .getPublicUrl(normalizePublicMediaPath(row.image_path)).data.publicUrl,
      href,
    };
  } catch {
    return null;
  }
}

export const getActiveNoticeStrip = unstable_cache(
  loadActiveNoticeStrip,
  ['home-notice-strip'],
  { revalidate: 300, tags: [NOTICE_STRIP_CACHE_TAG] },
);
