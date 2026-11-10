import { createClient } from '@/lib/supabase/server';
import { MARKETING_LINK_TOKEN } from '@/lib/admin/marketing-links';
import { marketingDestination } from '@/lib/marketing-link-routing';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!MARKETING_LINK_TOKEN.test(token)) return new Response('링크를 찾을 수 없습니다.', { status: 404, headers });
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('resolve_marketing_link', { p_token: token });
    if (error) return new Response('잠시 후 다시 시도해주세요.', { status: 503, headers });
    const destination = marketingDestination(data, new URL(request.url).searchParams, token);
    if (!destination) return new Response('현재 사용할 수 없는 링크입니다.', { status: 404, headers });
    return new Response(null, { status: 307, headers: { ...headers, Location: destination } });
  } catch { return new Response('잠시 후 다시 시도해주세요.', { status: 503, headers }); }
}
