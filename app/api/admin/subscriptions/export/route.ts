import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminSubscriptionFilters, parseAdminSubscriptionRows, subscriptionExportRows } from '@/lib/admin/subscriptions';
import { SUBSCRIPTION_PLAN_LABELS } from '@/lib/subscriptions/model';
import { buildAdminListExportWorkbook } from '@/lib/admin/list-export.server';
import { encryptAdminWorkbook } from '@/lib/admin/encrypted-workbook.server';
import { adminListExportContentDisposition } from '@/lib/admin/list-export';
import { readExportPassword, ExportRequestError } from '@/lib/admin/export-request.server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
export const runtime = 'nodejs';
export const maxDuration = 60;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET() { return Response.json({ error: '관리자 화면에서 비밀번호를 입력해 내려받아 주세요.' }, { status: 405, headers: { ...HEADERS, Allow: 'POST' } }); }
export async function POST(request: Request) {
  const auth = await requireAdminScreenAccess('/admin/sales/subscriptions', { capability: 'sales.read' });
  try {
    const password = await readExportPassword(request, ['state', 'query']);
    const filters = normalizeAdminSubscriptionFilters(Object.fromEntries(new URL(request.url).searchParams)), client = await createClient();
    const { data, error } = await client.rpc('admin_prepare_goods_subscription_export', { p_expected_actor_id: auth.user.id, p_state: filters.state, p_search: filters.query });
    if (error?.code === '54000') throw new ExportRequestError('10,000건을 초과했습니다. 검색 조건을 좁혀주세요.', 400);
    const rows = error ? null : parseAdminSubscriptionRows(data?.rows, 10000);
    if (!rows || !isUuid(data?.receiptId) || typeof data.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(data.fingerprint)
      || data.total !== rows.length || typeof data.asOf !== 'string' || !Number.isFinite(Date.parse(data.asOf))) throw new Error('subscription_export_unavailable');
    const generatedAt = new Date(data.asOf);
    const plain = await buildAdminListExportWorkbook({ screenLabel: '정기구매 관리', title: '정기구매', recordCount: rows.length, rows: subscriptionExportRows(rows),
      columns: ['신청번호', '구매자 ID', '구매자', '상품', '신청 상태', '주기', '다음 결제일', '이후 온라인 금액', '별도 착불 배송비', '전체 회차', '결제완료 회차', '결제완료 누계', '신청일', '최근 변경'].map((header, i) => ({ header,
        kind: [7, 8, 11].includes(i) ? 'amount' as const : [9, 10].includes(i) ? 'count' as const : 'text' as const, width: [0, 1].includes(i) ? 40 : i === 3 ? 50 : 22 })),
      conditions: [['상태', filters.state ? SUBSCRIPTION_PLAN_LABELS[filters.state] : '전체'], ['검색어', filters.query || '전체']],
      notes: ['신청 한 건이 한 행입니다. 온라인 결제금액과 수령 시 별도 착불 배송비를 분리했습니다.', '결제완료 누계는 취소된 주문을 제외하며 PG 정산 완료액과 다릅니다. 날짜는 ISO 8601 시각입니다.'],
      filters: { state: filters.state, query: filters.query } }, generatedAt);
    let encrypted; try { encrypted = encryptAdminWorkbook(plain, password); } finally { plain.fill(0); }
    const service = createServiceClient(), audit = await service.rpc('service_record_goods_subscription_export', { p_actor_id: auth.user.id,
      p_receipt_id: data.receiptId, p_fingerprint: data.fingerprint, p_file_sha256: encrypted.sha256 });
    if (audit.error || !isUuid(audit.data)) throw new Error('subscription_export_audit_unavailable');
    return new Response(new Uint8Array(encrypted.bytes), { headers: { ...HEADERS, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': adminListExportContentDisposition('정기구매.xlsx', 'icons-subscriptions.xlsx'), 'X-ICONS-Export-Audit': audit.data,
      'X-ICONS-Export-Rows': String(rows.length), 'X-ICONS-Export-Records': String(rows.length), 'X-ICONS-Export-Encryption': 'ECMA-376-Agile' } });
  } catch (error) {
    unstable_rethrow(error); return Response.json({ error: error instanceof ExportRequestError ? error.message : '목록 또는 감사 기록을 확인하지 못해 파일을 만들지 않았습니다. 다시 시도해주세요.' },
      { status: error instanceof ExportRequestError ? error.status : 500, headers: HEADERS });
  }
}
