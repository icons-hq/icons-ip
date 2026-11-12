import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseConfig } from '@/lib/supabase/config';
import type { SitemapCatalog, SitemapGood, SitemapIp } from './search-engines';

/* 사이트맵용 공개 카탈로그 — 쿠키 없는 공개 키 읽기다(방문자 세션과 무관하게 같은 결과). 노출 규칙은 공개 상세와 같다:
   보관·초안 제외, 판매 제한(19금) 제외, 굿즈는 공개 IP 소속만(lib/catalog getCatalogGoodDetail 의 ips!inner 조건).
   PostgREST max_rows(1000)가 넘는 행을 오류 없이 자르므로 id 순 페이지로 끝까지 읽는다. */
const PAGE_SIZE = 1000;

type SitemapClient = ReturnType<typeof createServerClient>;

async function readAll<Row>(fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`sitemap_catalog_failed:${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function readPublicIps(client: SitemapClient): Promise<SitemapIp[]> {
  const rows = await readAll<{ id: string; public_slug: string | null; updated_at: string | null }>((from, to) => client
    .from('ips')
    .select('id,public_slug,updated_at')
    .is('archived_at', null)
    .not('published_at', 'is', null)
    .order('id')
    .range(from, to));
  return rows.map((row) => ({ id: row.id, publicSlug: row.public_slug, updatedAt: row.updated_at }));
}

async function readPublicGoods(client: SitemapClient): Promise<SitemapGood[]> {
  const rows = await readAll<{ id: string; updated_at: string | null }>((from, to) => client
    .from('goods')
    .select('id,updated_at,ips!inner(id)')
    .is('archived_at', null)
    .not('published_at', 'is', null)
    .eq('sale_restriction', 'none')
    .is('ips.archived_at', null)
    .not('ips.published_at', 'is', null)
    .order('id')
    .range(from, to));
  return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at }));
}

/** 사이트맵에 실을 공개 IP·굿즈. Supabase 가 없으면(목 데이터 실행) 빈 목록 — 고정 화면만 싣는다. */
export async function loadSitemapCatalog(): Promise<SitemapCatalog> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return { goods: [], ips: [] };
  const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
  const [ips, goods] = await Promise.all([readPublicIps(client), readPublicGoods(client)]);
  return { ips, goods };
}
