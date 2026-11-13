import { hasAdminCapability } from '@/lib/admin/access';
import { CLAIM_EVIDENCE_BUCKET, isClaimEvidenceMimeType } from '@/lib/admin/claim-evidence';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';

/* 회수 생략 근거 사진 보기(ADR-0041). 교환 처리 권한(sales.manage)을 매 요청 다시 확인하고, 비공개
   버킷의 사진을 직접 보낸다 — 서명 URL을 화면에 남기지 않는다. 고객 화면에는 이 경로가 없다. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Cookie' };
const failure = (status: number) => Response.json({ error: '근거 사진을 열 수 없습니다. 로그인과 교환 처리 권한을 확인해주세요.' }, { status, headers });

export async function GET(_request: Request, route: RouteContext<'/api/admin/claim-evidence/[fileId]'>) {
  const { fileId } = await route.params;
  if (!isUuid(fileId)) return failure(400);
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user) return failure(401);
    if (!auth.isStaff || !hasAdminCapability(auth, 'sales.manage')) return failure(403);
    const { data, error } = await (await createClient()).rpc('admin_claim_evidence_file', { p_file_id: fileId.toLowerCase() });
    const record = typeof data === 'object' && data !== null ? data as { path?: unknown; mimeType?: unknown } : null;
    if (error || !record || typeof record.path !== 'string' || !isClaimEvidenceMimeType(record.mimeType)) return failure(error?.code === '42501' ? 403 : 404);
    const downloaded = await createServiceClient().storage.from(CLAIM_EVIDENCE_BUCKET).download(record.path);
    if (downloaded.error || !downloaded.data) return failure(404);
    return new Response(downloaded.data.stream(), { headers: { ...headers, 'Content-Type': record.mimeType, 'Content-Disposition': 'inline' } });
  } catch { return failure(503); }
}
