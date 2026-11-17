import type { HomeGoodsCard } from '@/lib/home-catalog';
import type { ProductCardChip } from '@/lib/product-card-chips';

/*
 * 홈 상품 카드가 그릴 칩. 서버(`resolveHomeGoodsCards`)가 `productCardChips`로 채운 칩에는 운영 배지('tag')가 항상 들어 있으므로,
 * 스토어 표시 설정(`listing.showTags`)이 꺼져 있으면 여기서 그 칩을 걸러 낸다 — 목록 화면이 `productCardChips(good, { showTags })`로
 * 서버 쪽에서 거르는 것과 같은 결과다. 칩이 없는 옛 투영(어드민 미리보기·목업)은 저장 배지 하나를 tag 칩으로 대신한다.
 */
export function homeCardChips(good: Pick<HomeGoodsCard, 'chips' | 'badge'>, showTags: boolean): ProductCardChip[] {
  const chips: ProductCardChip[] = good.chips ? [...good.chips] : good.badge ? [{ kind: 'tag', label: good.badge }] : [];
  return showTags ? chips : chips.filter((chip) => chip.kind !== 'tag');
}
