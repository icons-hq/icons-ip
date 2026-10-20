import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
import { parseReviewExportSnapshot, type ReviewExportFilters } from './review-export';

const AUTH_MESSAGE = '로그인 상태나 리뷰 관리 권한이 바뀌었습니다. 화면을 새로고침한 뒤 다시 내려받아 주세요.';
const CHANGED_MESSAGE = '리뷰 목록이나 도움수 등이 바뀌어 파일을 발급하지 않았습니다. 같은 조건으로 다시 내려받아 주세요.';
export class ReviewExportError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
type CallerClient = Awaited<ReturnType<typeof createClient>>;
type Identity = { actorId: string; sessionId: string };

/** Cookie-backed user and verified claims must identify the same live request. */
async function identity(client: CallerClient, expectedActorId: string, expectedSessionId?: string): Promise<Identity> {
  const user = await client.auth.getUser();
  if (user.error || !user.data.user || user.data.user.id !== expectedActorId || !isUuid(user.data.user.id)) {
    throw new ReviewExportError(AUTH_MESSAGE, 403);
  }
  const claims = await client.auth.getClaims();
  const sessionId = claims.data?.claims.session_id;
  if (claims.error || claims.data?.claims.sub !== user.data.user.id || !isUuid(sessionId)
    || expectedSessionId !== undefined && sessionId !== expectedSessionId) throw new ReviewExportError(AUTH_MESSAGE, 403);
  return { actorId: user.data.user.id, sessionId };
}

/** Read one caller-scoped DB snapshot. Service access begins only at file audit. */
export async function prepareReviewExport(expectedActorId: string, filters: ReviewExportFilters) {
  const client = await createClient(), caller = await identity(client, expectedActorId);
  const { data, error } = await client.rpc('admin_export_reviews_v2', { p_filters: filters });
  if (error?.code === '42501') throw new ReviewExportError(AUTH_MESSAGE, 403);
  if (error?.code === '54000') throw new ReviewExportError('최대 10,000건까지 내려받을 수 있습니다. 검색 조건을 좁혀 다시 시도해주세요.', 422);
  if (error?.code === '22023') throw new ReviewExportError('다운로드 조건을 확인해주세요.', 400);
  const snapshot = error ? null : parseReviewExportSnapshot(data, filters);
  if (!snapshot) throw new ReviewExportError('리뷰 목록을 확인하지 못해 파일을 만들지 않았습니다. 잠시 후 다시 시도해주세요.', 503);
  return {
    snapshot,
    async recordEncryptedFile(fileSha256: string): Promise<string> {
      if (!/^[a-f0-9]{64}$/.test(fileSha256)) throw new ReviewExportError('암호화 파일을 확인하지 못했습니다. 다시 시도해주세요.', 503);
      await identity(client, caller.actorId, caller.sessionId);
      const service = createServiceClient();
      const audit = await service.rpc('service_record_review_export_v2', {
        p_actor_id: caller.actorId, p_session_id: caller.sessionId, p_filters: filters,
        p_fingerprint: snapshot.fingerprint, p_row_count: snapshot.total, p_captured_at: snapshot.capturedAt, p_file_sha256: fileSha256,
      });
      if (audit.error?.code === '42501') throw new ReviewExportError(AUTH_MESSAGE, 403);
      if (audit.error?.code === 'PT409' || audit.error?.code === '54000') throw new ReviewExportError(CHANGED_MESSAGE, 409);
      if (audit.error || !isUuid(audit.data)) throw new ReviewExportError('발급 기록이나 현재 권한을 확인하지 못해 파일을 발급하지 않았습니다. 다시 시도해주세요.', 503);
      return audit.data;
    },
  };
}
