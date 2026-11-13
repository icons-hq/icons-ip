import type { MetadataRoute } from 'next';
import { buildRobots, publicSiteOrigin } from '@/lib/seo/search-engines';

/* /robots.txt (1014-029) — 공개 화면은 열고 개인·거래·인증 화면은 닫는다. 미리보기·스테이징은 전부 닫는다(lib/seo/search-engines.ts). */
export default function robots(): MetadataRoute.Robots {
  return buildRobots({ origin: publicSiteOrigin(), vercelEnv: process.env.VERCEL_ENV });
}
