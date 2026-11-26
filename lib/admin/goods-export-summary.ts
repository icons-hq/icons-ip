import { GOODS_LIST_DATE_FIELDS, GOODS_LIST_SEARCH_FIELDS, GOODS_LIST_STOCK_OPTIONS, type GoodsListFilters, type GoodsListStatus } from './goods-list';
import { GOODS_READINESS_REASONS } from './goods-readiness';

/** 조건을 되읽을 때 쓰는 이름. 못 읽은 이름은 비워 두면 '지정'이라고만 말한다. */
export interface GoodsExportFilterNames { ip?: string | null; category?: string | null; origin?: string | null }

/** 전시상태 조건. 기본 조건(보관 제외)도 늘 보여서 보관 상품이 빠졌다는 것이 눈에 띈다. */
const STATUS_LABELS: Record<GoodsListStatus, string> = { active: '보관 제외', all: '보관 포함 전체', draft: '초안', published: '공개', archived: '보관' };
const PAYMENT_LABELS = { card: '카드 결제 가능', bank: '무통장입금 가능', none: '결제수단 없음' } as const;
const SALE_TYPE_LABELS = { stock: '일반 재고 상품', preorder: '예약판매 옵션 포함' } as const;
const IMAGE_LABELS = { with: '대표 이미지 있음', without: '대표 이미지 없음' } as const;
const RESTRICTION_LABELS = { none: '판매 제한 없음', adult: '성인 상품' } as const;
const SALE_PERIOD_LABELS = { scheduled: '판매 예정', ended: '판매 종료' } as const;

function readinessLabel(readiness: GoodsListFilters['readiness']): string | null {
  if (readiness === 'all') return null;
  if (readiness === 'ready') return '설정 준비 완료';
  if (readiness === 'review_required') return '확인할 상품 전체';
  return GOODS_READINESS_REASONS[readiness]?.label ?? null;
}

/**
 * 엑셀 내보내기가 목록의 어떤 조건으로 걸렀는지를 낱말로 되읽는다. 목록과 같은 조건(normalizeGoodsListFilters)이 내보내기의 범위를 정하므로
 * 걸린 조건은 하나도 빼지 않는다 — 안 보이는 조건이 파일을 거르면 안 된다. 쪽(page)·정렬·쪽 크기는 내보내기 범위가 아니라 말하지 않는다.
 */
export function goodsExportFilterParts(filters: GoodsListFilters, names: GoodsExportFilterNames = {}): string[] {
  const parts: string[] = [STATUS_LABELS[filters.status]];
  if (filters.ipId) parts.push(`IP ${names.ip || '지정'}`);
  if (filters.categoryId) parts.push(`카테고리 ${names.category || '지정'}`);
  if (filters.originId) parts.push(`출고지 ${names.origin || '지정'}`);
  const stock = GOODS_LIST_STOCK_OPTIONS.find((option) => option.value === filters.stock);
  if (stock && stock.value !== 'all') parts.push(stock.label);
  const readiness = readinessLabel(filters.readiness);
  if (readiness) parts.push(readiness);
  if (filters.query) {
    const field = GOODS_LIST_SEARCH_FIELDS.find((option) => option.value === filters.field && option.value !== 'all');
    parts.push(`${field?.label ?? '검색어'} “${filters.query}”`);
  }
  if (filters.from || filters.to) {
    const date = GOODS_LIST_DATE_FIELDS.find((option) => option.value === (filters.dateField ?? 'created'))?.label ?? '기간';
    parts.push(filters.from && filters.to ? `${date} ${filters.from} ~ ${filters.to}` : filters.from ? `${date} ${filters.from}부터` : `${date} ${filters.to}까지`);
  }
  if (filters.payment && filters.payment !== 'all') parts.push(PAYMENT_LABELS[filters.payment]);
  if (filters.saleType && filters.saleType !== 'all') parts.push(SALE_TYPE_LABELS[filters.saleType]);
  if (filters.image && filters.image !== 'all') parts.push(IMAGE_LABELS[filters.image]);
  if (filters.restriction && filters.restriction !== 'all') parts.push(RESTRICTION_LABELS[filters.restriction]);
  if (filters.salePeriod && filters.salePeriod !== 'all') parts.push(SALE_PERIOD_LABELS[filters.salePeriod]);
  return parts;
}

/** `보관 제외 · IP 메이플스토리 · 품절`처럼 한 줄로 잇는다. */
export function goodsExportFilterText(filters: GoodsListFilters, names?: GoodsExportFilterNames): string {
  return goodsExportFilterParts(filters, names).join(' · ');
}
