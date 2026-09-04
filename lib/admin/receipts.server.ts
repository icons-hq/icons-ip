import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  AdminCashReceipt,
  AdminPendingCashReceipt,
  AdminReceiptsConsoleData,
  AdminTaxInvoiceRequest,
} from './receipts';

interface ReceiptRow {
  id: string;
  order_id: string;
  kind: string;
  status: string;
  amount: number;
  identity_masked: string | null;
  receipt_number: string | null;
  receipt_url: string | null;
  error_message: string | null;
  requested_at: string;
  issued_at: string | null;
  orders: { order_no: string }[] | null;
}

interface InvoiceRow {
  id: string;
  order_id: string;
  status: string;
  business_number: string;
  business_name: string;
  approval_number: string | null;
  issued_at: string | null;
  note: string | null;
  requested_at: string;
  orders: { order_no: string }[] | null;
}

interface PendingRow {
  order_id: string;
  order_no: string;
  total: number;
  mandatory: boolean;
  due_at: string;
  created_at: string;
}

const PAGE_SIZE = 50;

export async function getAdminReceiptsConsoleData(): Promise<AdminReceiptsConsoleData> {
  const supabase = await createClient();
  const [pending, receipts, invoices] = await Promise.all([
    supabase
      .from('cash_receipt_pending_view')
      .select('order_id,order_no,total,mandatory,due_at,created_at')
      /* 기한이 임박한 것부터. 이 화면을 여는 이유가 그것이다. */
      .order('due_at', { ascending: true })
      .limit(PAGE_SIZE),
    supabase
      .from('cash_receipts')
      .select('id,order_id,kind,status,amount,identity_masked,receipt_number,receipt_url,error_message,requested_at,issued_at,orders(order_no)')
      .order('requested_at', { ascending: false })
      .limit(PAGE_SIZE),
    supabase
      .from('tax_invoice_requests')
      .select('id,order_id,status,business_number,business_name,approval_number,issued_at,note,requested_at,orders(order_no)')
      .order('requested_at', { ascending: false })
      .limit(PAGE_SIZE),
  ]);

  if (pending.error) throw new Error(`Failed to load pending cash receipts: ${pending.error.message}`);
  if (receipts.error) throw new Error(`Failed to load cash receipts: ${receipts.error.message}`);
  if (invoices.error) throw new Error(`Failed to load tax invoices: ${invoices.error.message}`);

  return {
    now: new Date().toISOString(),
    pending: ((pending.data ?? []) as PendingRow[]).map((row): AdminPendingCashReceipt => ({
      orderId: row.order_id,
      orderNo: row.order_no,
      total: row.total,
      mandatory: row.mandatory,
      dueAt: row.due_at,
      createdAt: row.created_at,
    })),
    receipts: ((receipts.data ?? []) as ReceiptRow[]).map((row): AdminCashReceipt => ({
      id: row.id,
      orderId: row.order_id,
      orderNo: row.orders?.[0]?.order_no ?? null,
      kind: row.kind,
      status: row.status,
      amount: row.amount,
      identityMasked: row.identity_masked,
      receiptNumber: row.receipt_number,
      receiptUrl: row.receipt_url,
      errorMessage: row.error_message,
      requestedAt: row.requested_at,
      issuedAt: row.issued_at,
    })),
    invoices: ((invoices.data ?? []) as InvoiceRow[]).map((row): AdminTaxInvoiceRequest => ({
      id: row.id,
      orderId: row.order_id,
      orderNo: row.orders?.[0]?.order_no ?? null,
      status: row.status,
      businessNumber: row.business_number,
      businessName: row.business_name,
      approvalNumber: row.approval_number,
      issuedAt: row.issued_at,
      note: row.note,
      requestedAt: row.requested_at,
    })),
  };
}
