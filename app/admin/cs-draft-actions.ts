'use server';

import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { isCsReplySurface } from '@/lib/admin/cs-reply-tools';
import type { CsReplySource } from '@/lib/admin/cs-reply-sources';
import { csReplyRpcArguments, isCsReplyRevision, parseCsReplyOperation, parseCsReplyReceipt, type CsReplyReceipt } from '@/lib/admin/cs-reply-mutations';

const CS_PATH = '/admin/cs/inquiries';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is string | null => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));

/** The revision comes from the same row snapshot as the content being reviewed. */
export async function readCsReplySourceAction(input: unknown): Promise<{ ok: true; accountId: string; source: CsReplySource } | { ok: false; error: string }> {
  const auth = await requireAdminActionAccess(CS_PATH, { capability: 'cs.manage', onUnauthenticated: 'error' });
  if (!auth) return { ok: false, error: '관리자 권한이 필요합니다. 작성 중인 답변은 보내지 않았습니다.' };
  if (!record(input) || !isUuid(input.id) || !isCsReplySurface(input.surface)) return { ok: false, error: '답변할 문의나 리뷰를 찾지 못했습니다. 화면을 새로고침해주세요.' };
  const id = input.id.toLowerCase(), surface = input.surface;
  try {
    const client = await createClient();
    const result = await client.rpc('admin_cs_reply_context', { p_surface: surface, p_target_id: id });
    if (result.error) return { ok: false, error: '현재 저장된 내용을 확인하지 못했습니다. 작성 중인 문구는 그대로 있고, 확인될 때까지 답변을 저장하지 않습니다. [최신 저장본 다시 확인]을 눌러주세요.' };
    const row: unknown = result.data;
    if (!record(row) || row.id !== id || row.surface !== surface || typeof row.body !== 'string' || !['visible', 'hidden'].includes(String(row.status))) return { ok: false, error: '현재 원문을 찾거나 확인할 수 없습니다. 작성 문구는 그대로 있습니다. [최신 저장본 다시 확인]을 눌러주세요.' };
    const { reply, replyAt, revision } = row;
    if (!(reply === null || typeof reply === 'string') || !timestamp(replyAt) || !isCsReplyRevision(revision)) return { ok: false, error: '현재 답변의 저장 상태를 확인하지 못했습니다. 작성 문구는 그대로 있습니다. [최신 저장본 다시 확인]을 눌러주세요.' };
    let reviewFields: Pick<CsReplySource, 'rating' | 'imageUrls' | 'imageCount'> = {};
    if (surface === 'review') {
      if (!Number.isInteger(row.rating) || Number(row.rating) < 1 || Number(row.rating) > 5
        || !Array.isArray(row.imagePaths) || !row.imagePaths.every(path => typeof path === 'string')) return { ok: false, error: '현재 리뷰의 평점·사진을 확인하지 못했습니다. [최신 저장본 다시 확인]을 눌러주세요.' };
      const paths = row.imagePaths as string[];
      const images = await Promise.all(paths.map(async path => {
        const result = await client.storage.from('user-uploads').createSignedUrl(path, 3600);
        return result.error ? null : result.data?.signedUrl ?? null;
      }));
      reviewFields = { rating: Number(row.rating), imageCount: paths.length, imageUrls: images.filter((url): url is string => typeof url === 'string') };
    }
    return { ok: true, accountId: auth.user.id, source: { id, surface, body: row.body, reply, replyAt, status: row.status as 'visible' | 'hidden',
      revision, sourceVersion: `reply:${revision}`, ...reviewFields } };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '현재 저장된 내용을 불러오지 못했습니다. 작성 중인 문구는 그대로 있습니다. [최신 저장본 다시 확인]을 눌러주세요.' }; }
}

/** Missing receipt is only a snapshot; the original request may still commit. */
export async function readCsReplyOperationAction(input: unknown): Promise<{ ok: true; accountId: string; receipt: CsReplyReceipt | null } | { ok: false; error: string }> {
  const auth = await requireAdminActionAccess(CS_PATH, { capability: 'cs.manage', onUnauthenticated: 'error' });
  const operation = parseCsReplyOperation(input);
  if (!auth || !operation || auth.user.id !== operation.accountId) {
    return { ok: false, error: '로그인한 계정이 바뀌었거나 권한이 없어 저장 결과를 확인할 수 없습니다. 화면을 새로고침해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_cs_reply_operation', csReplyRpcArguments(operation));
    if (error) return { ok: false, error: '저장됐는지 확인하지 못했습니다. [같은 요청으로 결과 확인]을 다시 눌러주세요. 다시 눌러도 두 번 저장되지 않습니다.' };
    if (data === null) return { ok: true, accountId: auth.user.id, receipt: null };
    const receipt = parseCsReplyReceipt(data, operation);
    if (!receipt) return { ok: false, error: '저장 결과가 보낸 문구와 맞지 않습니다. 작성 문구는 그대로 있습니다.' };
    // The original write may have committed before its response reached the
    // action's cache invalidation. Receipt recovery completes that last step.
    revalidatePath(operation.surface === 'review' ? '/admin/cs/reviews' : '/admin/cs/qna');
    revalidatePath('/shop/[goodId]', 'page');
    return { ok: true, accountId: auth.user.id, receipt };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '저장됐는지 확인하지 못했습니다. 작성 문구는 그대로 있으니 [같은 요청으로 결과 확인]을 다시 눌러주세요.' }; }
}
