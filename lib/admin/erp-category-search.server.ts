import 'server-only';

import { createClient } from '@/lib/supabase/server';

const PAGE_SIZE = 1_000;
const PAGE_LIMIT = 10;

type Page<Row> = PromiseLike<{ data: Row[] | null; error: unknown }>;

/* PostgREST max_rows(1000) 아래로 나눠 읽는다. 쪽마다 새 요청을 만든다. 읽지 못하면 null. */
async function readAll<Row>(page: (from: number, to: number) => Page<Row>): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let index = 0; index < PAGE_LIMIT; index += 1) {
    const from = index * PAGE_SIZE;
    const result = await page(from, from + PAGE_SIZE - 1);
    if (result.error) return null;
    const values = result.data ?? [];
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
 * 카테고리마다 이어진 ERP 분류 이름을 모은다. ERP 품목 화면의 연결 표가 보여 주는 것과 같다:
 * - 직접 연결(erp_category_mappings)이 있으면 그 카테고리, 없으면 자동 연결(admin_list_erp_categories의
 *   fallback_category_id — 카테고리 ERP 분류 매핑의 이름·코드 일치 또는 `대>중>소` 전체 경로 일치)
 * - 카테고리 관리의 ERP 분류 매핑(catalog_category_erp_mappings)에 적은 ERP 분류명·코드
 * 둘 다 상품 관리 권한(catalog.manage)으로만 읽힌다. 권한이 없거나 읽지 못하면 빈 표를 돌려
 * 카테고리 찾기는 지금처럼 카테고리명·코드로만 동작한다.
 */
export async function loadCategoryErpSearchNames(): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  try {
    const client = await createClient();
    const [links, mappings] = await Promise.all([
      readAll<{ erp_category: string; category_id: string | null; fallback_category_id: string | null }>((from, to) =>
        client.rpc('admin_list_erp_categories').range(from, to)),
      readAll<{ category_id: string; erp_name: string; erp_code: string }>((from, to) =>
        client.from('catalog_category_erp_mappings').select('category_id,erp_name,erp_code').order('category_id').range(from, to)),
    ]);
    for (const row of links ?? []) add(names, row.category_id ?? row.fallback_category_id, row.erp_category);
    for (const row of mappings ?? []) add(names, row.category_id, row.erp_name, row.erp_code);
  } catch {
    names.clear();
  }
  return names;
}
