import 'server-only';
import { randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { AdminListExportChangedError, AdminListExportLoadError } from './list-export-errors';
import { ExportRequestError } from './export-request.server';
import type { RefundTransferRow } from './refund-transfers';
import type { RefundTransferAccountStatus, RefundTransferExportAccount } from './list-export-sheets';

/*
 * 환불 송금 대기 엑셀의 계좌 열람(1007-047·048, 2026-11-11 "계좌 포함 + 비밀번호 엑셀").
 *
 * 목록 엑셀 라우트(`app/api/admin/list-export`)가 비밀번호를 확인한 뒤에만 이 경로로 들어온다. 계좌 일괄 열람 RPC는
 * service_role 전용이라 브라우저 세션이 직접 부르지 못한다 — 서버가 검증한 운영자·세션을 증명하고, DB가 요청마다
 * 요청 상세 열람과 같은 판정·잠금·기록을 다시 한다. 계좌 원문은 이 요청의 메모리에만 있고 로그·감사 기록에 남기지 않는다.
 */

const AUTH_MESSAGE = '로그인 상태나 환불 송금 권한이 바뀌었습니다. 화면을 새로고침한 뒤 다시 내려받아 주세요.';
const STATUSES: readonly RefundTransferAccountStatus[] = ['revealed', 'not_filed', 'unavailable'];

export interface RefundTransferExportCaller { actorId: string; sessionId: string }
type CallerClient = { auth: {
  getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  getClaims: () => Promise<{ data: { claims: { sub?: unknown; session_id?: unknown } } | null; error: unknown }>;
} };

/** 쿠키 세션의 사용자와 검증된 access token claims가 같은 요청이고, 라우트 권한 게이트를 통과한 운영자와 같아야 한다. */
export async function refundTransferExportCaller(client: CallerClient, expectedActorId: string | undefined): Promise<RefundTransferExportCaller> {
  const user = await client.auth.getUser();
  const actorId = user.data.user?.id;
  if (user.error || !actorId || !isUuid(actorId) || !expectedActorId || actorId !== expectedActorId) throw new ExportRequestError(AUTH_MESSAGE, 403);
  const claims = await client.auth.getClaims();
  const sessionId = claims.data?.claims.session_id;
  if (claims.error || claims.data?.claims.sub !== actorId || typeof sessionId !== 'string' || !isUuid(sessionId)) throw new ExportRequestError(AUTH_MESSAGE, 403);
  return { actorId, sessionId };
}

const accountText = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);

/** 요청 순서·개수·상태가 그대로이고, 계좌를 내준 요청만 세 값이 모두 있는 응답만 받는다. */
export function parseRefundTransferAccounts(value: unknown, exportId: string, rows: readonly Pick<RefundTransferRow, 'claimId'>[]): Map<string, RefundTransferExportAccount> | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['exportId', 'rows']) || value.exportId !== exportId
    || !Array.isArray(value.rows) || value.rows.length !== rows.length) return null;
  const accounts = new Map<string, RefundTransferExportAccount>();
  for (const [index, entry] of value.rows.entries()) {
    const claimId = rows[index].claimId;
    if (!transactionRecord(entry) || !transactionExactKeys(entry, ['claimId', 'status', 'bankName', 'accountNumber', 'accountHolder'])
      || entry.claimId !== claimId || accounts.has(claimId) || !STATUSES.includes(entry.status as RefundTransferAccountStatus)) return null;
    const fields = [entry.bankName, entry.accountNumber, entry.accountHolder];
    if (entry.status === 'revealed' ? !fields.every(accountText) : fields.some(field => field !== null)) return null;
    accounts.set(claimId, {
      status: entry.status as RefundTransferAccountStatus,
      bankName: entry.bankName as string | null, accountNumber: entry.accountNumber as string | null, accountHolder: entry.accountHolder as string | null,
    });
  }
  return accounts;
}

/**
 * 목록에서 읽은 요청(리비전 포함)의 계좌를 한 번에 연다. DB가 요청마다 열람 기록과 주문 감사 기록을, 한 번의 내려받기에
 * 요약 기록(id=exportId)을 남긴다. 목록을 읽은 뒤 요청이 바뀌었으면 파일을 만들지 않고 다시 받게 한다.
 */
export async function revealRefundTransferAccounts(caller: RefundTransferExportCaller, rows: readonly RefundTransferRow[]) {
  const exportId = randomUUID();
  const { data, error } = await createServiceClient().rpc('service_export_bank_transfer_refund_accounts', {
    p_actor_id: caller.actorId, p_session_id: caller.sessionId, p_export_id: exportId,
    p_claims: rows.map(row => ({ claimId: row.claimId, orderId: row.orderId, revision: row.revision })),
  });
  if (error?.code === '42501') throw new ExportRequestError(AUTH_MESSAGE, 403);
  if (error?.code === 'PT409') throw new AdminListExportChangedError();
  const accounts = error ? null : parseRefundTransferAccounts(data, exportId, rows);
  if (!accounts) throw new AdminListExportLoadError();
  return { exportId, accounts };
}
