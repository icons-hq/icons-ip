import type { Good } from './data';
import { goodsPurchaseConditionProblem, initialGoodOption } from './goods-options';
import { goodsSaleUnavailableLabel } from './goods-sale-period';
import type { CartSelectionItem } from './cart-additions';

/* 위시 카드의 수량 없는 '장바구니 담기' 판정 (LFS 패리티 2차 L6 · MY-06, 10/14 S14·S15).
 *
 * 목록 담기 버튼(AddToCartButton)과 같은 규칙을 따른다: 옵션·직접 입력·최소 수량이 필요한 굿즈는 여기서
 * 고를 수 없으니 상세로 보내고, 단일 옵션 굿즈만 한 개 담는다. 담을 수 없는 사정(품절·판매 기간 밖·판매
 * 준비 중·카트 준비 전·재고 한도)은 버튼 문구와 접근 이름으로 말한다. 담기 자체는 굿즈 상세와 같은 카트
 * 계약(addSelection — 기대 수량 + 1)이고, 결과 모달은 그 반영이 확정(true)된 뒤에만 연다. */

export type WishCartState =
  | { kind: 'choose'; href: string; label: '옵션 선택' | '수량 선택'; ariaLabel: string }
  | { kind: 'add'; variantId: string | null; stockQty: number; label: string; ariaLabel: string; unavailable: boolean };

/**
 * @param cart.working 이 카드의 담기가 진행 중인가('담는 중'은 누른 카드에만).
 * @param cart.pending 카트가 다른 반영을 처리하는 중인가 — 그동안은 어느 카드도 담지 못하므로 비활성으로만 둔다.
 */
export function wishCartState(good: Good, cart: { quantityInCart: number; ready: boolean; working: boolean; pending?: boolean }): WishCartState {
  const saleLabel = goodsSaleUnavailableLabel(good.salePeriod);
  const minQuantity = Boolean(good.orderQuantityLimitEnabled && (good.minOrderQty ?? 1) > 1);
  if (!saleLabel && (good.customInputs?.enabled || (good.options?.length ?? 0) > 1 || minQuantity)) {
    const label = minQuantity ? '수량 선택' : '옵션 선택';
    return { kind: 'choose', href: `/shop/${good.id}`, label, ariaLabel: `${good.name} ${label}` };
  }

  const option = initialGoodOption(good);
  const stockQty = option?.stockQty ?? 0;
  const soldOut = good.stock === 'soldout' || !option || stockQty <= 0;
  const conditionProblem = goodsPurchaseConditionProblem(good);
  const atLimit = Boolean(option) && cart.quantityInCart >= stockQty;
  const unavailable = soldOut || Boolean(saleLabel) || Boolean(conditionProblem) || atLimit || !cart.ready || cart.working || Boolean(cart.pending);

  const label = soldOut ? '품절'
    : saleLabel ?? (conditionProblem ? '판매 준비 중'
      : !cart.ready ? '준비 중'
        : atLimit ? `담김 · ${cart.quantityInCart}`
          : cart.working ? '담는 중'
            : '장바구니 담기');
  const ariaLabel = soldOut ? `${good.name} 품절`
    : saleLabel ? `${good.name} ${saleLabel}`
      : conditionProblem ? `${good.name} ${conditionProblem}`
        : atLimit ? `${good.name}, 장바구니 ${cart.quantityInCart}개, 재고 한도 ${stockQty}개`
          : `${good.name} 장바구니에 한 개 담기`;

  return { kind: 'add', variantId: option?.id ?? null, stockQty, label, ariaLabel, unavailable };
}

/**
 * 한 개를 담고, 카트가 반영을 확정했을 때만 결과를 알린다. 담을 수 없는 상태면 카트를 부르지 않는다.
 * @returns 카트가 반영을 확정했는가.
 */
export async function addWishGoodToCart(
  addSelection: (baseGoodId: string, selection: readonly CartSelectionItem[]) => Promise<boolean>,
  good: Pick<Good, 'id' | 'name'>,
  state: WishCartState,
  onAdded: (items: { name: string; option: null; quantity: number }[]) => void,
): Promise<boolean> {
  if (state.kind !== 'add' || state.unavailable || !state.variantId) return false;
  const ok = await addSelection(good.id, [{ goodId: good.id, variantId: state.variantId, qty: 1, stockQty: state.stockQty }]);
  if (ok) onAdded([{ name: good.name, option: null, quantity: 1 }]);
  return ok;
}
