import 'server-only';

import { createClient } from '../supabase/server';
import {
  isEmailDeliveryStatus,
  isEmailTemplateName,
  parseOrderEmailDedupeKey,
  type EmailDeliveryStatus,
  type EmailTemplateName,
} from './dedupe';

/* 발송 이력 조회(#180 범위 5).
 *
 * email_deliveries 테이블 자체는 모든 롤에서 revoke되어 있다. 조회는 staff 게이트가 붙은
 * admin_search_email_deliveries RPC로만 한다 — service role 세션에서 테이블을 직접
 * select하는 경로는 존재하지 않는다.
 *
 * 어드민 화면은 사용자 세션(authenticated)으로 부른다. staff 판정은 DB가 다시 한다. */

const DEFAULT_LIMIT = 20;

export interface EmailDeliveryRecord {
  dedupeKey: string;
  template: EmailTemplateName;
  templateLabel: string;
  /** 주문 메일이면 대상 주문 id. 형식을 벗어난 키는 null이다. */
  orderId: string | null;
  recipient: string;
  subject: string;
  status: EmailDeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  claimedAt: string;
  completedAt: string | null;
  createdAt: string;
}

interface DeliveryRow {
  dedupe_key: string;
  template: string;
  recipient: string;
  subject: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  claimed_at: string;
  completed_at: string | null;
  created_at: string;
}

const TEMPLATE_LABELS: Record<EmailTemplateName, string> = {
  order_confirmation: '주문 확인',
  order_shipped: '배송 시작',
};

export function emailTemplateLabel(template: EmailTemplateName): string {
  return TEMPLATE_LABELS[template];
}

function toRecord(row: DeliveryRow): EmailDeliveryRecord | null {
  // 앱이 모르는 템플릿·상태는 목록에서 뺀다. 재발송 버튼이 정체 모를 행에 붙는 것보다
  // 보이지 않는 편이 안전하다.
  if (!isEmailTemplateName(row.template) || !isEmailDeliveryStatus(row.status)) return null;

  return {
    dedupeKey: row.dedupe_key,
    template: row.template,
    templateLabel: emailTemplateLabel(row.template),
    orderId: parseOrderEmailDedupeKey(row.dedupe_key)?.orderId ?? null,
    recipient: row.recipient,
    subject: row.subject,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

async function searchDeliveries(
  status: EmailDeliveryStatus | null,
  limit: number,
): Promise<EmailDeliveryRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_search_email_deliveries', {
    p_status: status,
    p_limit: limit,
    p_offset: 0,
  });
  if (error) throw new Error(`Failed to load email deliveries: ${error.message}`);

  return ((data ?? []) as DeliveryRow[])
    .map(toRecord)
    .filter((record): record is EmailDeliveryRecord => record !== null);
}

/*
 * 재발송이 필요한 건을 최신순으로 읽는다.
 *
 * `failed`만 읽으면 안 된다. 발송 훅이 claim_email_delivery로 행을 잡은 뒤
 * 함수 타임아웃이나 complete_email_delivery 실패로 죽으면 그 행은 `pending`으로
 * 영구히 남는다 — 메일은 안 갔는데 목록에는 안 보이는 상태가 된다.
 * DB 게이트(admin_request_email_resend)도 pending을 통과시키도록 만들어져 있다.
 */
export async function loadEmailDeliveries(limit = DEFAULT_LIMIT): Promise<EmailDeliveryRecord[]> {
  const [failed, pending] = await Promise.all([
    searchDeliveries('failed', limit),
    searchDeliveries('pending', limit),
  ]);

  return [...failed, ...pending]
    .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt))
    .slice(0, limit);
}
