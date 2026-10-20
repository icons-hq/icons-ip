import 'server-only';
import { exportPasswordError } from './export-password';

export const EXPORT_NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export class ExportRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function exportErrorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: EXPORT_NO_STORE });
}

/** Only same-origin JSON POST bodies can carry passwords; never return or log the body. */
export async function readExportPassword(request: Request, allowedQuery: readonly string[]): Promise<string> {
  const url = new URL(request.url);
  // Next's dev server normalizes Request.url to localhost. Host remains the
  // browser's destination and cannot be set by cross-origin browser scripts.
  // Do not trust x-forwarded-host, which an upstream must explicitly sanitize.
  const host = request.headers.get('host');
  let expectedOrigin = url.origin;
  try {
    if (host) {
      if (/[\\/@?#,\s]/.test(host)) throw new Error('invalid host');
      expectedOrigin = new URL(`${url.protocol}//${host}`).origin;
    }
  } catch { throw new ExportRequestError('현재 관리자 화면에서 다시 내려받아 주세요.', 403); }
  if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ExportRequestError('현재 관리자 화면에서 다시 내려받아 주세요.', 403);
  }
  if ([...url.searchParams.keys()].some(key => !allowedQuery.includes(key) || url.searchParams.getAll(key).length !== 1)) {
    throw new ExportRequestError('다운로드 조건을 확인해주세요.');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new ExportRequestError('다운로드 요청 형식을 확인해주세요.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ExportRequestError('비밀번호를 입력해주세요.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new ExportRequestError('다운로드 요청이 너무 큽니다.', 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ExportRequestError('다운로드 요청 형식을 확인해주세요.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['password', 'passwordConfirmation'].includes(key))) {
      throw new ExportRequestError('다운로드 요청 형식을 확인해주세요.');
    }
    const values = body as Record<string, unknown>;
    const error = exportPasswordError(values.password, values.passwordConfirmation);
    if (error) throw new ExportRequestError(error);
    return values.password as string;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    reader.releaseLock();
  }
}
