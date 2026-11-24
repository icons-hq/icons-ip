import { createClient } from '@/lib/supabase/server';
import { MARKETING_LINK_TOKEN } from '@/lib/admin/marketing-links';
import { marketingDestination } from '@/lib/marketing-link-routing';
import { resolvePublicGoodAddress } from '@/lib/goods-address.server';
export const dynamic = 'force-dynamic';
/* 굿즈 링크는 공개 상세의 정식 주소(상품 자동코드, ADR-0050)로 바로 보낸다. 확인하지 못하면 옛 주소 — 상세가 다시 옮긴다. */
async function goodSegmentFor(data: unknown): Promise<string | null> {
  const target = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  if (target?.source !== 'good' || typeof target.targetId !== 'string') return null;
  return (await resolvePublicGoodAddress(target.targetId).catch(() => null))?.segment ?? null;
}
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!MARKETING_LINK_TOKEN.test(token)) return new Response('링크를 찾을 수 없습니다.', { status: 404, headers });
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('resolve_marketing_link', { p_token: token });
    if (error) return new Response('잠시 후 다시 시도해주세요.', { status: 503, headers });
    const destination = marketingDestination(data, new URL(request.url).searchParams, token, await goodSegmentFor(data));
    if (!destination) return new Response('현재 사용할 수 없는 링크입니다.', { status: 404, headers });
    return new Response(null, { status: 307, headers: { ...headers, Location: destination } });
  } catch { return new Response('잠시 후 다시 시도해주세요.', { status: 503, headers }); }
}
