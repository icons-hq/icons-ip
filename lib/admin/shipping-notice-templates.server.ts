import 'server-only';

import type { ShippingNoticeSnapshot } from '@/lib/fulfillment';
import { createClient } from '@/lib/supabase/server';
import {
  SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE,
  type ShippingNoticeTemplate,
  type ShippingNoticeTemplateFilters,
  type ShippingNoticeTemplateImpactGood,
  type ShippingNoticeTemplatePageData,
} from './shipping-notice-templates';

interface ShippingNoticeTemplateRow {
  id: string;
  code: string;
  version: number;
  name: string;
  shipping_notice: string;
  return_exchange_notice: string;
  cs_name: string;
  cs_phone: string;
  cs_email: string;
  confirmation_evidence: string;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ImpactGoodRow {
  id: string;
  name: string;
  template_id: string | null;
  template_version: number | null;
  published_at: string | null;
  updated_at: string;
}

export type ShippingNoticeTemplateOption = Omit<ShippingNoticeSnapshot, 'templateId'> & { id: string };

function mapTemplate(row: ShippingNoticeTemplateRow): ShippingNoticeTemplate {
  return {
    id: row.id,
    code: row.code,
    version: Number(row.version),
    name: row.name,
    shippingNotice: row.shipping_notice,
    returnExchangeNotice: row.return_exchange_notice,
    csName: row.cs_name,
    csPhone: row.cs_phone,
    csEmail: row.cs_email,
    confirmationEvidence: row.confirmation_evidence,
    status: row.status === 'active' ? 'active' : 'draft',
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadShippingNoticeTemplates(
  filters: ShippingNoticeTemplateFilters,
): Promise<ShippingNoticeTemplatePageData> {
  const supabase = await createClient();
  let query = supabase
    .from('shipping_notice_templates')
    .select('id,code,version,name,shipping_notice,return_exchange_notice,cs_name,cs_phone,cs_email,confirmation_evidence,status,confirmed_by,confirmed_at,created_at,updated_at', { count: 'exact' });
  if (filters.query) {
    const escaped = filters.query.replace(/[\\%_]/g, '\\$&');
    query = query.ilike('name', `%${escaped}%`);
  }
  const [templatesResult, impactResult] = await Promise.all([
    query.order('code').order('version', { ascending: false }).order('id')
      .range((filters.page - 1) * SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE, filters.page * SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE - 1),
    supabase.rpc('admin_find_goods_for_shipping_notice_template', {
      target_template_id: null,
      search_query: filters.goodQuery,
    }),
  ]);
  if (templatesResult.error) throw new Error('배송정보 템플릿을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  if (impactResult.error) throw new Error('상품 적용 대상을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const total = templatesResult.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE));
  if (filters.page > lastPage) return loadShippingNoticeTemplates({ ...filters, page: lastPage });
  return {
    templates: ((templatesResult.data ?? []) as ShippingNoticeTemplateRow[]).map(mapTemplate),
    impactGoods: ((impactResult.data ?? []) as ImpactGoodRow[]).map((row): ShippingNoticeTemplateImpactGood => ({
      id: row.id,
      name: row.name,
      templateId: row.template_id,
      templateVersion: row.template_version === null ? null : Number(row.template_version),
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
    })),
    total,
    filters,
  };
}

/** 상품 폼·미리보기 선택지. 내부 확인 근거와 감사 필드는 반환하지 않는다. */
export async function loadActiveShippingNoticeTemplateOptions(): Promise<ShippingNoticeTemplateOption[]> {
  const supabase = await createClient();
  const pageSize = 1000;
  const rows: ShippingNoticeTemplateRow[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from('shipping_notice_templates')
      .select('id,code,version,name,shipping_notice,return_exchange_notice,cs_name,cs_phone,cs_email,status,confirmed_by,confirmed_at,confirmation_evidence,created_at,updated_at')
      .eq('status', 'active')
      .order('code')
      .order('version', { ascending: false })
      .order('id')
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error('활성 배송정보 템플릿을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    const batch = (data ?? []) as ShippingNoticeTemplateRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    version: Number(row.version),
    name: row.name,
    shippingNotice: row.shipping_notice,
    returnExchangeNotice: row.return_exchange_notice,
    csName: row.cs_name,
    csPhone: row.cs_phone,
    csEmail: row.cs_email,
  }));
}
