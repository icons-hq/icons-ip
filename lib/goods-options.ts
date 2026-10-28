import { goodsSaleUnavailableLabel } from './goods-sale-period';
import { goodsOptionLimitNotices, RANDOM_OPTION_LABEL, RANDOM_OPTION_NOTICE } from './goods-option-sale-mode';
import type { Good, GoodOption } from './data';
import type { GoodsSalesQuoteLine, GoodsVariantPricing } from './goods-sales';

export function optionPriceRange(options: readonly GoodOption[]) {
  const prices = options.map(option => option.price);
  return { price: Math.min(...prices), priceMax: Math.max(...prices) };
}

/**
 * 랜덤 판매 굿즈(D5②)의 고객 옵션: 판매 중인 옵션들을 장바구니 키(기본 옵션) 하나로 접는다.
 *
 * 이름은 '랜덤', 수량은 판매 중인 옵션 가용 수량의 합(풀)이다 — DB 장바구니 담기·견적·주문이 같은 풀로 판정한다.
 * 가격은 기본 옵션 가격이다(랜덤 판매는 모든 판매 중 옵션의 판매가·기간 할인이 같아야 켜진다). 개별 옵션의 이름·코드·
 * 속성은 싣지 않는다. 옵션별 구매 제한은 랜덤 판매에서 금지라 없다. 기본 옵션을 못 찾으면(정렬상) 첫 옵션을 키로 쓴다 —
 * DB는 같은 굿즈의 어떤 옵션 id가 와도 기본 옵션 줄로 모은다.
 */
export function collapseRandomGoodOptions(options: readonly GoodOption[]): GoodOption[] {
  const key = options.find(option => option.isDefault) ?? options[0];
  if (!key) return [];
  const pool = options.reduce((total, option) => total + Math.max(0, option.stockQty), 0);
  const nextChangeAt = options.map(option => option.supply?.nextChangeAt ?? null)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
  return [{
    id: key.id, name: RANDOM_OPTION_LABEL, code: '', price: key.price, stockQty: pool, isDefault: true, attributes: {},
    ...(key.pricing ? { pricing: key.pricing } : {}),
    ...(key.supply ? { supply: { ...key.supply, availableQty: pool, nextChangeAt } } : {}),
    orderMaxQty: null, memberMaxQty: null,
  }];
}

/** 굿즈 행에 저장된 기준 판매가(`goods.price`)와 소비자가(`goods.compare_at_price`). */
export interface GoodsCatalogPricing {
  price: number;
  compareAtPrice: number | null;
}

type OptionPricing = Pick<GoodsVariantPricing, 'regularPrice' | 'pricePeriodId'>;
type PricedOption = Pick<GoodOption, 'price' | 'pricing'>;

/**
 * 옵션 가격 옆에 취소선으로 보일 정가. 표시 규칙일 뿐 결제 금액은 서버 견적·주문 RPC가 정한다.
 * 기간 할인 중이면 그 옵션의 정상가와 비교한다. 아니면 상품 할인 금액(소비자가 − 기준 판매가)을
 * 옵션 정상가에 더한다 — 옵션 추가금액은 할인하지 않으므로 옵션 정가는 소비자가 + 추가금액이다.
 */
export function optionCompareAtPrice(catalog: GoodsCatalogPricing, pricing: OptionPricing): number | null {
  if (pricing.pricePeriodId) return pricing.regularPrice;
  if (catalog.compareAtPrice === null || catalog.compareAtPrice <= catalog.price) return null;
  return pricing.regularPrice + catalog.compareAtPrice - catalog.price;
}

function optionPricing(option: PricedOption): OptionPricing {
  return option.pricing ?? { regularPrice: option.price, pricePeriodId: null };
}

/** 옵션을 고르기 전에는 최저 판매가 옵션을 보이므로 그 옵션의 정가를 쓴다. */
export function goodCompareAtPrice(catalog: GoodsCatalogPricing, options: readonly PricedOption[] | undefined): number | null {
  const cheapest = options?.reduce<PricedOption | undefined>((lowest, option) => !lowest || option.price < lowest.price ? option : lowest, undefined);
  return optionCompareAtPrice(catalog, cheapest ? optionPricing(cheapest) : { regularPrice: catalog.price, pricePeriodId: null });
}

/** 카탈로그를 거치지 않은 굿즈(목업·테스트)는 표시 가격을 저장값으로 본다. */
function catalogPricing(good: Good): GoodsCatalogPricing {
  return { price: good.catalogPrice ?? good.price,
    compareAtPrice: (good.catalogCompareAtPrice !== undefined ? good.catalogCompareAtPrice : good.compareAtPrice) ?? null };
}

/**
 * 목록 카드 담기·추가 구성의 자동 선택: 하나뿐인 옵션을 지금 살 수 있을 때만 고른다. 다옵션은 명시 선택이다.
 * 굿즈 상세 본품의 첫 선택은 defaultGoodOption 이다(LD-5).
 */
export function initialGoodOption(good: Good): GoodOption | undefined {
  return good.options?.length === 1 && good.options[0].stockQty > 0 ? good.options[0] : undefined;
}

type OptionAvailability = Pick<GoodOption, 'stockQty' | 'supply'>;

/**
 * 재입고 알림을 받을 수 있는 품절 옵션인가 (PD-10·PD-11 · LD-5).
 * 재고만 떨어진 옵션이다. 예약판매 옵션은 재고가 아니라 예약 기간·물량으로 열리고 닫혀 재입고 알림 대상이
 * 아니므로 살 수 없으면 고르지 않는다(DB request_variant_restock_alert 도 거절한다).
 */
export function isRestockableGoodOption(option: OptionAvailability): boolean {
  return option.stockQty <= 0 && option.supply?.mode !== 'preorder';
}

/** 굿즈 상세 옵션 셀렉트에서 고를 수 있는가 — 지금 살 수 있거나, 재입고 알림을 받을 수 있는 품절 옵션이다(LD-5). */
export function isSelectableGoodOption(option: OptionAvailability): boolean {
  return option.stockQty > 0 || isRestockableGoodOption(option);
}

/**
 * 굿즈 상세 본품의 첫 선택 (LD-5 · 11 §6 B9 · R-04 §3.5): 정렬 순서상 첫 구매 가능 옵션.
 * 살 수 있는 옵션이 없으면(모든 옵션 품절) 고를 수 있는 첫 옵션(재입고 알림을 받을 품절 옵션)을 고른 채
 * 연다 — 레퍼런스처럼 빈 옵션(placeholder) 없이 셀렉트·제목 가격·합계가 같은 옵션을 가리킨다(PD-08·PD-10).
 * 그때도 CTA 는 굿즈 단위 재입고 알림이다(굿즈가 품절이면 purchaseCtaState 가 고른 옵션보다 먼저 본다).
 * 고를 수 있는 옵션이 하나도 없으면(닫힌 예약판매뿐) 고르지 않는다.
 */
export function defaultGoodOption(good: Pick<Good, 'options'>): GoodOption | undefined {
  return good.options?.find(option => option.stockQty > 0) ?? good.options?.find(isSelectableGoodOption);
}

/**
 * 주소의 `?variant=`로 들어온 옵션 중 지금 고를 수 있는 것 (PD-14).
 * 고를 수 있다는 기준은 구매 컨트롤러의 선택 규칙과 같다 — 이 굿즈의 옵션이고, 살 수 있거나 재입고 알림을
 * 받을 수 있는 품절 옵션이다(PD-10 — 품절 옵션을 가리키는 공유·알림 링크는 그 옵션의 재입고 알림으로 연다).
 * 맞지 않으면(다른 굿즈 옵션·닫힌 예약판매 옵션·오타) undefined 라 기본 선택 규칙으로 돌아간다.
 */
export function selectableGoodOptionId(good: Pick<Good, 'options'>, variantId: string | null | undefined): string | undefined {
  if (!variantId) return undefined;
  return good.options?.find(option => option.id === variantId && isSelectableGoodOption(option))?.id;
}

/**
 * 옵션 선택을 주소에 남길 검색 문자열(`?variant=`, PD-14 · 11 §6 B9). 바꿀 것이 없으면 null.
 * 다른 검색 조건(리뷰·Q&A 페이지)은 그대로 둔다. 첫 화면의 자동 기본 선택(`defaultId`)은 주소에 쓰지
 * 않는다 — 들어오기만 해도 주소가 바뀌면 공유·북마크 주소가 사용자가 고르지 않은 옵션을 가리킨다.
 */
export function variantSearchForSelection(search: string, selectedId: string | undefined, defaultId: string | undefined): string | null {
  if (!selectedId) return null;
  const params = new URLSearchParams(search);
  const current = params.get('variant');
  if (current === selectedId || (current === null && selectedId === defaultId)) return null;
  params.set('variant', selectedId);
  return `?${params.toString()}`;
}

/**
 * 주소 동기화가 "쓰지 않을 기본 선택"으로 볼 첫 선택. 첫 선택이 주소의 `?variant=`에서 왔으면 사용자가
 * 고른 선택이라 기본 선택이 아니다(undefined) — 같은 상세 안 이동(리뷰·Q&A 페이지 링크)이 주소에서
 * variant 를 지워도 다시 써 넣어야 공유·새로고침에서 선택을 잃지 않는다.
 */
export function variantSyncDefault(urlVariantId: string | null, initialSelectedId: string | undefined): string | undefined {
  return urlVariantId !== null && urlVariantId === initialSelectedId ? undefined : initialSelectedId;
}

/**
 * 품절 굿즈의 합계 미리보기 단가 (PD-08).
 *
 * 고른 옵션이 없는 품절 굿즈의 합계 자리에 "옵션 선택 후 표시"가 남지 않게 가격으로 합계를 보인다:
 * 옵션이 있으면 첫 옵션 가격(레퍼런스는 첫 옵션이 선택된 채 합계를 보인다), 없으면 굿즈 가격.
 * 모든 옵션이 품절인 다옵션 굿즈는 첫 옵션을 고른 채 열리므로(defaultGoodOption) 합계는 고른 옵션
 * 가격이고(purchaseTotalDisplay), 이 값은 고를 수 있는 옵션이 없는 굿즈(옵션 없음·닫힌 예약판매뿐)의 몫이다.
 * 표시 전용 값이다 — 품절 굿즈는 담기·구매가 막혀 있고 금액은 서버 견적·주문 RPC 가 정한다.
 */
export function soldOutPreviewPrice(good: Pick<Good, 'price' | 'options'>): number {
  return good.options?.[0]?.price ?? good.price;
}

export function optionLabel(option: GoodOption | undefined, count: number): string | null {
  if (!option) return null;
  return count === 1 && option.isDefault && option.name === '기본 옵션' && Object.keys(option.attributes).length === 0
    ? null : option.name;
}

/**
 * 장바구니 줄의 옵션. 랜덤 판매 굿즈(D5②)는 어느 옵션 키로 담겼든(랜덤 전환 전에 담은 줄 포함) 접힌 '랜덤' 옵션이다 —
 * DB 장바구니 RPC는 같은 굿즈의 어떤 옵션 id가 와도 기본 옵션 줄로 모으고, 견적·주문은 풀로 판정한다.
 */
export function cartLineOption(good: Pick<Good, 'options' | 'optionSaleMode'> | undefined, variantId: string): GoodOption | undefined {
  if (!good) return undefined;
  if (good.optionSaleMode === 'random') return good.options?.[0];
  return good.options?.find(option => option.id === variantId);
}

/** Cart identities are canonical before this display projection runs. */
export function cartOptionGood(good: Good | undefined, variantId: string): Good | undefined {
  if (!good) return undefined;
  const option = cartLineOption(good, variantId);
  if (!option) return undefined;
  const catalog = catalogPricing(good);
  return { ...good, price: option.price, priceMax: option.price, stockQty: option.stockQty,
    catalogPrice: catalog.price, catalogCompareAtPrice: catalog.compareAtPrice,
    compareAtPrice: optionCompareAtPrice(catalog, optionPricing(option)),
    stock: option.stockQty <= 0 || good.stock === 'soldout' ? 'soldout' : good.stock };
}

export function goodsPurchaseConditionProblem(good: Pick<Good,
  'allowCardPayment' | 'allowBankTransfer' | 'saleRestriction' | 'orderQuantityLimitEnabled' |
  'minOrderQty' | 'maxOrderQty' | 'memberPurchaseLimitEnabled' | 'memberLifetimeQtyLimit' | 'salePeriod' | 'transactionOffer'>): string | null {
  if (good.transactionOffer?.aggregation?.runtimeEnabled === false) return '구매 준비 중인 굿즈입니다.';
  const periodLabel = goodsSaleUnavailableLabel(good.salePeriod);
  if (periodLabel) return `${periodLabel} 굿즈입니다.`;
  if (good.saleRestriction === 'adult') return '현재 판매 준비 중인 굿즈입니다.';
  if (good.allowCardPayment === false && good.allowBankTransfer === false) return '현재 주문을 받지 않는 굿즈입니다.';
  if ((good.orderQuantityLimitEnabled && (!good.minOrderQty || !good.maxOrderQty || good.minOrderQty > good.maxOrderQty))
    || (good.memberPurchaseLimitEnabled && !good.memberLifetimeQtyLimit)) return '구매 조건을 확인 중인 굿즈입니다.';
  return null;
}

export function goodAtQuotedPrice(good: Good | undefined, line: GoodsSalesQuoteLine | undefined): Good | undefined {
  if (!good || !line) return good;
  return { ...good, price: line.effectivePrice, priceMax: line.effectivePrice,
    ...(line.supply ? { stockQty: line.supply.availableQty,
      stock: line.supply.availableQty > 0 && (line.available || line.qty > line.supply.availableQty) ? 'ok' : 'soldout' } as const : {}),
    compareAtPrice: optionCompareAtPrice(catalogPricing(good), line) };
}

/**
 * 한 번에 고를 수 있는 최대 수량(D7②): 재고와 옵션별 주문당 최대 수량 중 작은 값. 표시·스테퍼용이고, 주문당·1인 누적
 * 한도의 최종 판정은 주문 생성 트리거다(1인 누적은 결제 대기 주문을 포함하므로 여기서 계산하지 않는다).
 */
export function purchasableOptionQty(option: Pick<GoodOption, 'stockQty' | 'orderMaxQty'>): number {
  const stock = Math.max(0, option.stockQty);
  return option.orderMaxQty ? Math.min(stock, option.orderMaxQty) : stock;
}

/**
 * 굿즈 상세 구매 블록의 판매 방식·옵션 제한 안내(확정 카피). 랜덤 판매는 무작위 배정 안내, 옵션별 제한은 고른 옵션의
 * 정적 안내다(남은 수량은 보이지 않는다). 하나뿐인 '기본 옵션'은 이름을 숨기므로 굿즈 이름으로 말한다.
 */
export function goodOptionPurchaseNotices(good: Pick<Good, 'name' | 'options' | 'optionSaleMode'>, option: GoodOption | undefined): string[] {
  if (good.optionSaleMode === 'random') return [RANDOM_OPTION_NOTICE];
  if (!option) return [];
  return goodsOptionLimitNotices(optionLabel(option, good.options?.length ?? 0) ?? good.name,
    { orderMaxQty: option.orderMaxQty ?? null, memberMaxQty: option.memberMaxQty ?? null });
}
