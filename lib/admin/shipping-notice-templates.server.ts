import 'server-only';

import type { ShippingNoticeSnapshot } from '@/lib/fulfillment';
import { createClient } from '@/lib/supabase/server';
import {
  SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE,
  type ShippingNoticeTemplate,
  type ShippingNoticeTemplateFilters,
  type ShippingNoticeTemplatePageData,
} from './shipping-notice-templates';

interface ShippingNoticeTemplateOptionRow {
  id: string;
  code: string;
  version: number;
  name: string;
  shipping_notice: string;
  return_exchange_notice: string;
  /** 배포 전 DB(칸 이전)에서는 없을 수 있다. */
  remote_area_notice?: string | null;
  cs_name: string;
  cs_phone: string;
  cs_email: string;
  status: string;
}

export type ShippingNoticeTemplateOption = Omit<ShippingNoticeSnapshot, 'templateId'> & { id: string };

const text = (value: unknown): string => typeof value === 'string' ? value : '';

/** 목록 조회(admin_list_shipping_notice_templates)의 한 줄. 모양이 다르면 null. */
function parseTemplate(value: unknown): ShippingNoticeTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const version = Number(row.version), goodsCount = Number(row.goodsCount);
  if (typeof row.id !== 'string' || typeof row.code !== 'string' || typeof row.name !== 'string' || typeof row.updatedAt !== 'string'
    || !Number.isSafeInteger(version) || !Number.isSafeInteger(goodsCount) || goodsCount < 0) return null;
  return {
    id: row.id, code: row.code, version, name: row.name,
    shippingNotice: text(row.shippingNotice), returnExchangeNotice: text(row.returnExchangeNotice), remoteAreaNotice: text(row.remoteAreaNotice),
    csName: text(row.csName), csPhone: text(row.csPhone), csEmail: text(row.csEmail),
    status: row.status === 'active' ? 'active' : 'draft',
    updatedAt: row.updatedAt, goodsCount,
  };
}

function parsePage(value: unknown): { total: number; rows: ShippingNoticeTemplate[] } | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as { total?: unknown; rows?: unknown };
  const total = Number(page.total);
  if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(page.rows)) return null;
  const rows = page.rows.map(parseTemplate);
  return rows.every((row): row is ShippingNoticeTemplate => row !== null) ? { total, rows } : null;
}

/** 목록: 템플릿마다 한 줄(가장 최근에 저장한 내용)과 그 템플릿을 쓰는 상품 수. 최근에 고친 순서다. */
export async function loadShippingNoticeTemplates(
  filters: ShippingNoticeTemplateFilters,
): Promise<ShippingNoticeTemplatePageData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_shipping_notice_templates', {
    p_query: filters.query,
    p_limit: SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE,
    p_offset: (filters.page - 1) * SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE,
  });
  const page = error ? null : parsePage(data);
  if (!page) throw new Error('배송 안내 템플릿을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.');
  const lastPage = Math.max(1, Math.ceil(page.total / SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE));
  if (filters.page > lastPage) return loadShippingNoticeTemplates({ ...filters, page: lastPage });
  return { templates: page.rows, total: page.total, filters };
}

/**
 * 템플릿 하나의 지금 저장된 내용과 쓰는 상품 수. 편집 창이 저장 직전(확인창에 넣을 상품 수)과
 * 다른 사람이 먼저 바꿨을 때(지금 내용 보이기) 다시 읽는다. 없으면 null.
 */
export async function loadShippingNoticeTemplate(code: string): Promise<ShippingNoticeTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_shipping_notice_templates', { p_query: '', p_limit: 1, p_offset: 0, p_code: code });
  const page = error ? null : parsePage(data);
  if (!page) throw new Error('배송 안내 템플릿을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  return page.rows[0] ?? null;
}

/**
 * 상품등록의 [템플릿 고르기]에 나오는 템플릿과, 아직 고를 수 없는 템플릿 수.
 * 템플릿마다 지금 내용(상품에서 고를 수 있는 가장 큰 버전) 하나만 싣는다 — 고치기 전 내용은 목록에 따로 나오지 않는다(화면 규칙 2).
 * `pendingCount`는 예전 방식으로 만들어 두고 한 번도 켜지 않은 템플릿('준비 중') 수다. 내부 확인 근거와 감사 필드는 읽지 않는다.
 */
export async function loadShippingNoticeTemplatePickerData(): Promise<{ options: ShippingNoticeTemplateOption[]; pendingCount: number }> {
  const supabase = await createClient();
  const pageSize = 1000;
  const rows: ShippingNoticeTemplateOptionRow[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from('shipping_notice_templates')
      .select('id,code,version,name,shipping_notice,return_exchange_notice,remote_area_notice,cs_name,cs_phone,cs_email,status')
      .order('code')
      .order('version', { ascending: false })
      .order('id')
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error('배송 안내 템플릿을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    const batch = (data ?? []) as ShippingNoticeTemplateOptionRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  /* 코드별로 버전이 큰 순서다. 코드마다 처음 만나는 'active' 줄이 지금 고를 수 있는 내용이다. */
  const codes = new Set<string>(), usable = new Map<string, ShippingNoticeTemplateOptionRow>();
  for (const row of rows) {
    codes.add(row.code);
    if (row.status === 'active' && !usable.has(row.code)) usable.set(row.code, row);
  }
  const options = [...usable.values()].map((row): ShippingNoticeTemplateOption => ({
    id: row.id,
    code: row.code,
    version: Number(row.version),
    name: row.name,
    shippingNotice: row.shipping_notice,
    returnExchangeNotice: row.return_exchange_notice,
    remoteAreaNotice: row.remote_area_notice ?? '',
    csName: row.cs_name,
    csPhone: row.cs_phone,
    csEmail: row.cs_email,
  })).sort((left, right) => left.name.localeCompare(right.name, 'ko-KR') || left.code.localeCompare(right.code));
  return { options, pendingCount: codes.size - usable.size };
}

/** 상품 폼·미리보기·운영 준비 화면이 쓰는 선택지(템플릿마다 지금 내용 하나). */
export async function loadActiveShippingNoticeTemplateOptions(): Promise<ShippingNoticeTemplateOption[]> {
  return (await loadShippingNoticeTemplatePickerData()).options;
}
