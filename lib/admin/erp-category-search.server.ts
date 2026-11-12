import 'server-only';

import { createClient } from '@/lib/supabase/server';

const PAGE_SIZE = 1_000;
const PAGE_LIMIT = 10;

interface PagedQuery<Row> {
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: unknown }>;
}

async function readAll<Row>(query: PagedQuery<Row>): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let index = 0; index < PAGE_LIMIT; index += 1) {
    const from = index * PAGE_SIZE;
    const page = await query.range(from, from + PAGE_SIZE - 1);
    if (page.error) return null;
    const values = page.data ?? [];
    rows.push(...values);
    if (values.length < PAGE_SIZE) return rows;
  }
  return rows;
}

function add(names: Map<string, string[]>, categoryId: unknown, ...values: unknown[]) {
  if (typeof categoryId !== 'string' || !categoryId) return;
  const current = names.get(categoryId) ?? [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text && !current.includes(text)) current.push(text);
  }
  if (current.length) names.set(categoryId, current);
}

/**
 * SHEET-042(사용자 결정 2026-11-11 묶음 13): 상품 등록의 카테고리 찾기에서 ERP 분류명으로도 찾게,
 * 카테고리마다 연결된 ERP 분류 이름을 모은다. ERP 품목 화면의 연결(ERP 분류 원문 → 카테고리)과
 * 카테고리 관리의 ERP 분류 매핑(카테고리 → ERP 코드·품명)을 함께 본다.
 * 두 표는 상품 관리 권한(catalog.manage)으로만 읽히고(RLS), 권한이 없거나 읽지 못하면 빈 표를 돌려
 * 카테고리 찾기는 지금처럼 카테고리명·코드로만 동작한다.
 */
export async function loadCategoryErpSearchNames(): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  try {
    const client = await createClient();
    const [links, mappings] = await Promise.all([
      readAll<{ erp_category: string; category_id: string }>(client.from('erp_category_mappings').select('erp_category,category_id').order('erp_category')),
      readAll<{ category_id: string; erp_name: string; erp_code: string }>(client.from('catalog_category_erp_mappings').select('category_id,erp_name,erp_code').order('category_id')),
    ]);
    for (const row of links ?? []) add(names, row.category_id, row.erp_category);
    for (const row of mappings ?? []) add(names, row.category_id, row.erp_name, row.erp_code);
  } catch {
    names.clear();
  }
  return names;
}
