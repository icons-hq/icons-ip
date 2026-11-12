import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseShoppingStoryGoods } from './shopping-stories.server';
import { GOOD_REFERENCE_LIMIT, GOOD_REFERENCE_MAX_LENGTH, type GoodReferenceMatch } from './good-references';
import { displayGoodVisibility, parseGoodVisibility, type GoodDisplayVisibilityRow } from './good-visibility';
import type { StoryGoodCandidate } from './shopping-story-picker';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && [...value].length <= max;

/** 관련상품 찾기 검색(searchShoppingStoryGoods)과 같은 행 검사다. 모양이 다르면 그 상품만 담을 수 없는 결과로 둔다. */
function parseCandidate(value: unknown): StoryGoodCandidate | null {
  if (!record(value)) return null;
  const [good] = parseShoppingStoryGoods([value]) ?? [];
  if (!good || !nonnegative(value.reviewCount) || !nonnegative(value.wishCount) || !nonnegative(value.salesQuantity)
    || !(value.ratingAverage === null || (typeof value.ratingAverage === 'number' && value.ratingAverage >= 1 && value.ratingAverage <= 5))
    || (value.reviewCount === 0) !== (value.ratingAverage === null) || typeof value.freeShipping !== 'boolean' || typeof value.discounted !== 'boolean'
    || !['stock', 'preorder'].includes(String(value.saleType))) return null;
  return { ...good, reviewCount: value.reviewCount, wishCount: value.wishCount, salesQuantity: value.salesQuantity, ratingAverage: value.ratingAverage as number | null,
    freeShipping: value.freeShipping, discounted: value.discounted, saleType: value.saleType as 'stock' | 'preorder' };
}

/** 입력 순서대로 한 값에 한 결과. 조회 실패는 오류로 던진다(선택은 그대로 둔다). */
export async function resolveGoodReferences(refs: string[]): Promise<GoodReferenceMatch[]> {
  if (!refs.length || refs.length > GOOD_REFERENCE_LIMIT || refs.some(ref => ref !== ref.trim() || !text(ref, GOOD_REFERENCE_MAX_LENGTH))) {
    throw new Error('조회할 값을 확인해주세요.');
  }
  const client = await createClient();
  const { data, error } = await client.rpc('admin_resolve_goods_references', { p_refs: refs });
  const failure = () => new Error('상품을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
  if (error || !Array.isArray(data) || data.length !== refs.length) throw failure();
  return data.map((row, index) => {
    if (!record(row) || row.ref !== refs[index] || !['found', 'not_found', 'ambiguous'].includes(String(row.status))
      || typeof row.archived !== 'boolean' || typeof row.published !== 'boolean') throw failure();
    if (row.status !== 'found') {
      if (row.id !== null || row.candidate !== null) throw failure();
      return { ref: refs[index], status: row.status as 'not_found' | 'ambiguous', matchedBy: null, id: null, name: null, code: null, archived: false, published: false, visibility: 'missing' as const, candidate: null };
    }
    if (!['id', 'code'].includes(String(row.matchedBy)) || !text(row.id, 64) || !text(row.name, 200) || !(row.code === null || text(row.code, 120))) throw failure();
    const parsed = row.archived ? null : parseCandidate(row.candidate), candidate = parsed && parsed.id === row.id ? parsed : null;
    /* 보이지 않는 이유는 후보 행(관련상품 찾기와 같은 모양)이 싣는다. 보관 상품은 후보가 없고 담을 수도 없다. */
    return { ref: refs[index], status: 'found' as const, matchedBy: row.matchedBy as 'id' | 'code', id: row.id, name: row.name, code: row.code as string | null,
      archived: row.archived, published: row.published, visibility: displayGoodVisibility({ archived: row.archived, published: row.published, visibility: candidate?.visibility }), candidate };
  });
}

/**
 * 저장된 전시 구성을 다시 열 때 상품번호로 이름·판매자상품코드·고객 화면에 보이지 않는 이유만 읽는다(admin_goods_display_visibility).
 * 담기용 후보(가격·재고·판매 지표)를 계산하지 않는 가벼운 읽기다. 없는 상품번호는 결과에 없다.
 */
export async function readGoodsDisplayVisibility(ids: string[]): Promise<GoodDisplayVisibilityRow[]> {
  if (!ids.length || ids.length > GOOD_REFERENCE_LIMIT || new Set(ids).size !== ids.length || ids.some(id => id !== id.trim() || !text(id, GOOD_REFERENCE_MAX_LENGTH))) {
    throw new Error('조회할 상품 URL을 확인해주세요.');
  }
  const client = await createClient();
  const { data, error } = await client.rpc('admin_goods_display_visibility', { p_ids: ids });
  const failure = () => new Error('상품을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
  if (error || !Array.isArray(data) || data.length > ids.length) throw failure();
  const asked = new Set(ids), seen = new Set<string>();
  return data.map(row => {
    const visibility = record(row) ? parseGoodVisibility(row.visibility) : null;
    if (!record(row) || !text(row.id, GOOD_REFERENCE_MAX_LENGTH) || !asked.has(row.id) || seen.has(row.id) || !text(row.name, 200)
      || !(row.code === null || text(row.code, 120)) || !visibility) throw failure();
    seen.add(row.id);
    return { id: row.id, name: row.name, code: row.code as string | null, visibility };
  });
}
