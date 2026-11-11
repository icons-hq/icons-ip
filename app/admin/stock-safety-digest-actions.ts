'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { FULFILLMENT_ORIGINS_PATH } from '@/lib/admin/fulfillment-origins';
import { STOCK_RECONCILE_PATH } from '@/lib/admin/stock-reconcile';
import {
  STOCK_DIGEST_OPERATOR_RECIPIENT_LIMIT,
  STOCK_DIGEST_ORIGIN_RECIPIENT_LIMIT,
  isDigestSendTime,
  parseRecipientList,
  parseStockDigestOrigin,
  parseStockSafetyDigestSettings,
  stockDigestErrorMessage,
  type StockDigestOrigin,
  type StockSafetyDigestSettings,
} from '@/lib/admin/stock-safety-digest';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/* 재고 정보를 외부(창고 담당자)로 보내는 설정이라 계정 주매니저 이상(platform.manage)만 바꾼다. DB RPC가 다시 확인한다. */
const ACCESS = { capability: 'platform.manage' } as const;
const FORBIDDEN = '요약 메일 설정은 계정 주매니저 이상만 바꿀 수 있습니다.';

export type StockDigestSettingsResult = { ok: true; settings: StockSafetyDigestSettings } | { ok: false; error: string };

/**
 * 사용 여부·발송 시각·운영자 수신 주소를 저장한다. operationId는 화면이 한 번 만든 값을 재시도에 그대로 쓴다
 * (응답이 끊겨 다시 눌러도 같은 저장으로 처리된다).
 */
export async function saveStockSafetyDigestAction(input: {
  enabled: boolean; sendTime: string; recipients: string; expectedRevision: number; operationId?: string;
}): Promise<StockDigestSettingsResult> {
  try {
    if (!await requireAdminActionAccess(STOCK_RECONCILE_PATH, ACCESS)) return { ok: false, error: FORBIDDEN };
    if (!input || typeof input.enabled !== 'boolean' || !isDigestSendTime(input.sendTime)
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.recipients !== 'string') {
      return { ok: false, error: '발송 시각과 받는 주소를 확인해주세요.' };
    }
    const recipients = parseRecipientList(input.recipients, STOCK_DIGEST_OPERATOR_RECIPIENT_LIMIT);
    if (!recipients.ok) return { ok: false, error: recipients.error };
    const operationId = input.operationId && isUuid(input.operationId) ? input.operationId : randomUUID();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_save_stock_safety_digest', {
      p_enabled: input.enabled,
      p_send_time: input.sendTime,
      p_operator_recipients: recipients.recipients,
      p_expected_revision: input.expectedRevision,
      p_operation_id: operationId,
    });
    if (error) return { ok: false, error: stockDigestErrorMessage(error) };
    const settings = parseStockSafetyDigestSettings(data);
    if (!settings) return { ok: false, error: '저장 결과를 확인하지 못했습니다. 새로고침해 확인해주세요.' };
    revalidatePath(STOCK_RECONCILE_PATH);
    return { ok: true, settings };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '요약 메일 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

export type StockDigestOriginResult = { ok: true; origin: StockDigestOrigin } | { ok: false; error: string };

/** 배송정보 관리의 출고지 탭이 열릴 때 그 출고지의 담당자 주소를 읽는다. */
export async function readStockDigestOriginAction(originId: string): Promise<StockDigestOriginResult> {
  try {
    if (!await requireAdminActionAccess(FULFILLMENT_ORIGINS_PATH, ACCESS)) return { ok: false, error: FORBIDDEN };
    if (!isUuid(originId)) return { ok: false, error: '출고지를 다시 골라주세요.' };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_get_stock_safety_digest');
    if (error) return { ok: false, error: stockDigestErrorMessage(error) };
    const settings = parseStockSafetyDigestSettings(data);
    const origin = settings?.origins.find((entry) => entry.originId === originId);
    if (!origin) return { ok: false, error: '출고지 담당자 주소를 불러오지 못했습니다. 새로고침해주세요.' };
    return { ok: true, origin };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '출고지 담당자 주소를 불러오지 못했습니다. 새로고침해주세요.' };
  }
}

/** 출고지 담당자(창고) 수신 주소를 저장한다. 처음 저장할 때 기대 버전은 0이다. */
export async function saveStockDigestOriginAction(input: {
  originId: string; recipients: string; expectedRevision: number; operationId?: string;
}): Promise<StockDigestOriginResult> {
  try {
    if (!await requireAdminActionAccess(FULFILLMENT_ORIGINS_PATH, ACCESS)) return { ok: false, error: FORBIDDEN };
    if (!input || !isUuid(input.originId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || typeof input.recipients !== 'string') return { ok: false, error: '받는 주소를 확인해주세요.' };
    const recipients = parseRecipientList(input.recipients, STOCK_DIGEST_ORIGIN_RECIPIENT_LIMIT);
    if (!recipients.ok) return { ok: false, error: recipients.error };
    const operationId = input.operationId && isUuid(input.operationId) ? input.operationId : randomUUID();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_save_stock_safety_digest_origin', {
      p_origin_id: input.originId,
      p_recipients: recipients.recipients,
      p_expected_revision: input.expectedRevision,
      p_operation_id: operationId,
    });
    if (error) return { ok: false, error: stockDigestErrorMessage(error) };
    const origin = parseStockDigestOrigin(data);
    if (!origin) return { ok: false, error: '저장 결과를 확인하지 못했습니다. 새로고침해 확인해주세요.' };
    revalidatePath(STOCK_RECONCILE_PATH);
    return { ok: true, origin };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '출고지 담당자 주소를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
