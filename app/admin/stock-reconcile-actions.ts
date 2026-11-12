'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { ERP_ITEM_FILE_BYTES_LIMIT } from '@/lib/admin/erp-item-import';
import {
  STOCK_RECONCILE_LABEL_LIMIT,
  STOCK_RECONCILE_PATH,
  STOCK_RECONCILE_REASON_LIMIT,
  STOCK_RECONCILE_ROW_LIMIT,
  normalizeStockRowInput,
  parseStockReconcileApplyOutcome,
  parseStockReconcileDocument,
  stockAsOfError,
  stockReconcileErrorMessage,
  stockReconcileRowPayload,
  type StockReconcileApplyOutcome,
  type StockReconcileDocument,
  type StockReconcileRow,
} from '@/lib/admin/stock-reconcile';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/* 화면은 메뉴 권한(catalog.manage)으로 열고, DB RPC가 같은 능력을 다시 확인한다. */
const ACCESS = { capability: 'catalog.manage' } as const;
const STAFF_ONLY = '재고를 대조할 권한이 없습니다.';
const FILE_KB = ERP_ITEM_FILE_BYTES_LIMIT / 1024;

export type StockReconcileFileResult =
  | { ok: true; fileName: string; sheetName: string | null; table: string[][]; numericColumns: number[]; warnings: string[] }
  | { ok: false; error: string };

/** 업로드 파일을 문자열 표로 읽어 돌려준다. 열 짝짓기·행 검사는 화면에서 하고, 매칭·계산은 미리보기 RPC가 한다. */
export async function readStockReconcileFileAction(formData: FormData): Promise<StockReconcileFileResult> {
  try {
    if (!await requireAdminActionAccess(STOCK_RECONCILE_PATH, ACCESS)) return { ok: false, error: STAFF_ONLY };
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: '대조할 재고 파일을 선택해주세요.' };
    if (/\.xls$/i.test(file.name)) return { ok: false, error: 'XLS 파일은 엑셀에서 XLSX로 다시 저장하거나, 표를 복사해 붙여넣어 주세요.' };
    if (!/\.(xlsx|csv|tsv|txt)$/i.test(file.name)) return { ok: false, error: 'XLSX 또는 CSV 파일을 올려주세요.' };
    if (file.size > ERP_ITEM_FILE_BYTES_LIMIT) {
      return { ok: false, error: `파일은 ${FILE_KB}KB 이하로 올려주세요. 크면 코드·수량 열만 남겨 저장하거나 표를 복사해 붙여넣어 주세요.` };
    }
    const { readErpItemFile } = await import('@/lib/admin/erp-item-file.server');
    const read = await readErpItemFile(file.name, Buffer.from(await file.arrayBuffer()));
    return { ok: true, fileName: file.name.slice(0, 200), ...read };
  } catch (error) {
    unstable_rethrow(error);
    /* 파일 읽기 오류 중 한국어 안내(행 수 상한 등)는 그대로 보이고, 그 밖은 일반 안내로 바꾼다. */
    const message = error instanceof Error && /[가-힣]/.test(error.message) ? error.message.replace('반입', '대조') : '';
    return { ok: false, error: message || '파일을 읽지 못했습니다. 형식을 확인한 뒤 다시 올려주세요.' };
  }
}

export type StockReconcilePreviewResult = { ok: true; snapshot: StockReconcileDocument } | { ok: false; error: string };

export interface StockReconcilePreviewInput {
  originId: string | null;
  /** 파일의 재고 기준 시각(ISO). */
  asOf: string;
  sourceLabel: string;
  rows: unknown[];
}

/**
 * 미리보기를 만든다. 재고는 바꾸지 않고, 그 시점의 재고수량·출고 대기를 기록한 미리보기를 돌려준다.
 * 행은 화면에서 이미 검사했지만 브라우저 값을 믿지 않고 다시 검사한다 — 하나라도 틀리면 전체를 거절한다.
 */
export async function previewStockReconcileAction(input: StockReconcilePreviewInput): Promise<StockReconcilePreviewResult> {
  try {
    if (!await requireAdminActionAccess(STOCK_RECONCILE_PATH, ACCESS)) return { ok: false, error: STAFF_ONLY };
    if (!input || typeof input !== 'object') return { ok: false, error: '대조할 행을 확인한 뒤 다시 시도해주세요.' };
    const originId = input.originId === null || input.originId === '' ? null : input.originId;
    if (originId !== null && !isUuid(originId)) return { ok: false, error: '출고지를 다시 골라주세요.' };
    const asOf = typeof input.asOf === 'string' && Number.isFinite(Date.parse(input.asOf)) ? new Date(input.asOf).toISOString() : null;
    const asOfError = stockAsOfError(asOf);
    if (asOfError) return { ok: false, error: asOfError };
    const sourceLabel = typeof input.sourceLabel === 'string' ? input.sourceLabel.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, STOCK_RECONCILE_LABEL_LIMIT) : '';
    if (!sourceLabel) return { ok: false, error: '파일 이름이 비어 있습니다. 다시 올려주세요.' };
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > STOCK_RECONCILE_ROW_LIMIT) {
      return { ok: false, error: `한 번에 1~${STOCK_RECONCILE_ROW_LIMIT.toLocaleString('ko-KR')}행을 대조할 수 있습니다.` };
    }
    const rows: StockReconcileRow[] = [];
    for (const value of input.rows) {
      const row = normalizeStockRowInput(value);
      if (!row) return { ok: false, error: '대조할 행을 확인한 뒤 다시 시도해주세요.' };
      rows.push(row);
    }
    if (new Set(rows.map((row) => row.row)).size !== rows.length) return { ok: false, error: '같은 행 번호가 두 번 들어왔습니다. 파일을 다시 올려주세요.' };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_preview_stock_reconcile', {
      p_origin_id: originId,
      p_as_of: asOf,
      p_source_label: sourceLabel,
      p_rows: rows.map(stockReconcileRowPayload),
    });
    if (error) return { ok: false, error: stockReconcileErrorMessage(error) };
    const snapshot = parseStockReconcileDocument(data);
    if (!snapshot) return { ok: false, error: '미리보기 결과를 확인하지 못했습니다. 다시 미리보기 해주세요.' };
    revalidatePath(STOCK_RECONCILE_PATH);
    return { ok: true, snapshot };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '미리보기를 만들지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

export type StockReconcileApplyResult = { ok: true; outcome: StockReconcileApplyOutcome } | { ok: false; error: string };

/**
 * 미리보기에서 바뀌는 옵션을 한 번에 반영한다. DB가 잠금 뒤 다시 잰 맞춘 뒤 재고수량이 미리보기와 다르거나(미리보기 뒤 주문·출고 등)
 * 재고 조정이 끼어 차이가 달라졌으면 아무것도 바꾸지 않고 바뀐 옵션(미리보기 값·지금 값·이유)을 돌려준다(QA1 S-T07-01).
 * 응답이 끊겨 다시 눌러도 같은 사유면 처음 결과가 돌아온다.
 */
export async function applyStockReconcileAction(input: { snapshotId: string; expectedChanges: number; reason: string }): Promise<StockReconcileApplyResult> {
  try {
    if (!await requireAdminActionAccess(STOCK_RECONCILE_PATH, ACCESS)) return { ok: false, error: STAFF_ONLY };
    if (!input || !isUuid(input.snapshotId) || !Number.isSafeInteger(input.expectedChanges) || input.expectedChanges < 0) {
      return { ok: false, error: '반영할 미리보기를 다시 열어주세요.' };
    }
    const reason = typeof input.reason === 'string' ? input.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
    if (!reason || reason.length > STOCK_RECONCILE_REASON_LIMIT) return { ok: false, error: '반영 사유를 200자 이내로 입력해주세요.' };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_apply_stock_reconcile', {
      p_snapshot_id: input.snapshotId,
      p_expected_changes: input.expectedChanges,
      p_reason: reason,
    });
    if (error) return { ok: false, error: stockReconcileErrorMessage(error) };
    const outcome = parseStockReconcileApplyOutcome(data);
    if (!outcome) return { ok: false, error: '반영 결과를 확인하지 못했습니다. 대조 기록에서 결과를 확인해주세요.' };
    revalidatePath(STOCK_RECONCILE_PATH);
    if (outcome.status === 'applied') revalidatePath('/admin/catalog/goods');
    return { ok: true, outcome };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '재고를 반영하지 못했습니다. 대조 기록에서 반영 여부를 확인한 뒤 다시 시도해주세요.' };
  }
}
