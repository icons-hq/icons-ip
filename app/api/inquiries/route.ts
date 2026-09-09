import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyInquiries, loadMyInquiryThread } from '@/lib/inquiries.server';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export async function GET(request: NextRequest) {
  try {
    const auth = await getCurrentAuthState();
    if (!auth.user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401, headers });
    const inquiryId = request.nextUrl.searchParams.get('inquiryId');
    if (inquiryId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inquiryId)) {
        return NextResponse.json({ error: '문의를 찾을 수 없습니다.' }, { status: 404, headers });
      }
      const inquiry = await loadMyInquiryThread(auth.user.id, inquiryId);
      return inquiry ? NextResponse.json({ userId: auth.user.id, inquiry }, { headers })
        : NextResponse.json({ error: '문의를 찾을 수 없습니다.' }, { status: 404, headers });
    }
    return NextResponse.json({ userId: auth.user.id, inquiries: await loadMyInquiries(auth.user.id) }, { headers });
  } catch {
    return NextResponse.json({ error: '문의를 불러오지 못했습니다. 다시 시도해주세요.' }, { status: 503, headers });
  }
}
