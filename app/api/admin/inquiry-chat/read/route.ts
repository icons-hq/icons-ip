import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { hasAdminCapability } from '@/lib/admin/access';
import { isSameOriginRequest } from '@/lib/http/same-origin.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403, headers });
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401, headers });
    if (!auth.isStaff || !hasAdminCapability(auth, 'cs.manage')) return Response.json({ error: '상담 권한이 필요합니다.' }, { status: 403, headers });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !isUuid(body.inquiryId) || !isUuid(body.accountId)
      || !Array.isArray(body.messageIds) || body.messageIds.length < 1 || body.messageIds.length > 500
      || body.messageIds.some((id: unknown) => !isUuid(id)) || Object.keys(body).some(key => !['accountId', 'inquiryId', 'messageIds'].includes(key))) {
      return Response.json({ error: '읽은 메시지를 다시 확인해주세요.' }, { status: 400, headers });
    }
    if (body.accountId !== auth.user.id) return Response.json({ error: '로그인 계정이 바뀌었습니다. 화면을 새로고침해주세요.' }, { status: 409, headers });
    const client = await createClient();
    const { data, error } = await client.rpc('admin_mark_inquiry_chat_read', {
      p_inquiry_id: body.inquiryId, p_message_ids: [...new Set(body.messageIds)],
    });
    if (error || typeof data !== 'number' || !Number.isSafeInteger(data) || data < 0) {
      return Response.json({ error: '읽음 상태를 저장하지 못했습니다.' }, { status: 503, headers });
    }
    return Response.json({ userId: auth.user.id, marked: data }, { headers });
  } catch { return Response.json({ error: '읽음 상태를 저장하지 못했습니다.' }, { status: 503, headers }); }
}
