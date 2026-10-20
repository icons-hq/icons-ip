import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminGiftFilters, parseAdminGiftRows, giftExportRows, ADMIN_GIFT_STATE_LABELS } from '@/lib/admin/gifts';
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
  const auth = await requireAdminScreenAccess('/admin/sales/gifts', { capability: 'sales.read' });
  try {
    const password = await readExportPassword(request, ['state', 'query']);
    const filters = normalizeAdminGiftFilters(Object.fromEntries(new URL(request.url).searchParams)), client = await createClient();
    const { data, error } = await client.rpc('admin_prepare_gift_export', { p_expected_actor_id: auth.user.id, p_state: filters.state, p_search: filters.query });
    if (error?.code === '54000') throw new ExportRequestError('10,000건을 초과했습니다. 검색 조건을 좁혀주세요.', 400);
    const rows = error ? null : parseAdminGiftRows(data?.rows, 10000);
    if (!rows || !isUuid(data?.receiptId) || typeof data.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(data.fingerprint)
      || data.total !== rows.length || typeof data.asOf !== 'string' || !Number.isFinite(Date.parse(data.asOf))) throw new Error('gift_export_unavailable');
    const plain = await buildAdminListExportWorkbook({ screenLabel: '선물 수락 대기', title: '선물 수락 목록', recordCount: rows.length, rows: giftExportRows(rows),
      columns: ['선물번호', '상태', '보낸 사람', '받는 사람', '상품·옵션', '총 수량', '선물 생성일', '수락·주문 기한', '수락일', '연결 주문번호'].map((header, i) => ({ header,
        kind: i === 5 ? 'count' as const : 'text' as const, width: [0, 9].includes(i) ? 40 : i === 4 ? 50 : 22 })),
      conditions: [['상태', filters.state ? ADMIN_GIFT_STATE_LABELS[filters.state] : '전체'], ['검색어', filters.query || '전체']],
      notes: ['선물 한 건이 한 행입니다. 수락 전에는 주문·결제가 생성되지 않습니다. 수락 후에도 실제 결제완료를 확인해야 합니다.',
        '배송지·연락처·선물 메시지·직접입력 옵션 내용은 포함하지 않습니다. 날짜는 ISO 8601 시각입니다.'],
      filters: { state: filters.state, query: filters.query } }, new Date(data.asOf));
    let encrypted; try { encrypted = encryptAdminWorkbook(plain, password); } finally { plain.fill(0); }
    const service = createServiceClient(), audit = await service.rpc('service_record_gift_export', { p_actor_id: auth.user.id,
      p_receipt_id: data.receiptId, p_fingerprint: data.fingerprint, p_file_sha256: encrypted.sha256 });
    if (audit.error || !isUuid(audit.data)) throw new Error('gift_export_audit_unavailable');
    return new Response(new Uint8Array(encrypted.bytes), { headers: { ...HEADERS, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': adminListExportContentDisposition('선물수락목록.xlsx', 'icons-gifts.xlsx'), 'X-ICONS-Export-Audit': audit.data,
      'X-ICONS-Export-Rows': String(rows.length), 'X-ICONS-Export-Records': String(rows.length), 'X-ICONS-Export-Encryption': 'ECMA-376-Agile' } });
  } catch (error) {
    unstable_rethrow(error); return Response.json({ error: error instanceof ExportRequestError ? error.message : '목록 또는 감사 기록을 확인하지 못해 파일을 만들지 않았습니다. 다시 시도해주세요.' },
      { status: error instanceof ExportRequestError ? error.status : 500, headers: HEADERS });
  }
}
