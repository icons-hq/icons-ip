import { inquiryFileSession, downloadInquiryFile } from '@/lib/inquiry-files.server';
import { INQUIRY_FILE_MIME_EXTENSIONS } from '@/lib/inquiry-files';
import { isUuid } from '@/lib/uuid';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Cookie' };
const failure = (status: number) => Response.json({ error: '파일을 받을 수 없습니다. 로그인과 상담 접근 권한을 확인해주세요.' }, { status, headers });
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const fileId = params.get('fileId'), messageId = params.get('messageId');
  if (!isUuid(fileId) || messageId !== null && !isUuid(messageId)) return failure(400);
  try {
    const session = await inquiryFileSession(); if (!session) return failure(401);
    const result = await downloadInquiryFile(session.actor, session.sessionId, fileId, messageId);
    if (!result) return failure(403);
    const { file, bytes } = result;
    const encoded = encodeURIComponent(file.name).replace(/[!'()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
    const disposition = params.get('preview') === '1' && file.mimeType.startsWith('image/') ? 'inline' : 'attachment';
    return new Response(new Blob([bytes], { type: file.mimeType }).stream(), { headers: { ...headers, 'Content-Type': file.mimeType,
      'Content-Disposition': `${disposition}; filename="download.${INQUIRY_FILE_MIME_EXTENSIONS[file.mimeType]}"; filename*=UTF-8''${encoded}` } });
  } catch { return failure(503); }
}
