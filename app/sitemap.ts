import type { MetadataRoute } from 'next';
import { buildSitemap, publicSiteOrigin } from '@/lib/seo/search-engines';
import { loadSitemapCatalog } from '@/lib/seo/sitemap-catalog.server';

/* /sitemap.xml (1014-029) — 공개 목록 화면·공개 IP관·공개 굿즈 상세. 판매 제한(19금)·비공개·보관 굿즈는 싣지 않는다.
   요청마다 읽는다: 빌드가 DB에 기대지 않고, 새로 공개한 굿즈가 다음 수집 때 바로 실린다(수집 빈도는 낮다). */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(publicSiteOrigin(), await loadSitemapCatalog());
}
