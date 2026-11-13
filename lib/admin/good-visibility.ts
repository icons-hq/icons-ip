/*
 * 전시 구성(홈 전시·카테고리 전시·쇼핑스토리·캠페인 상품 묶음)에 담았거나 담을 상품이 고객 화면에 보이는지와 보이지 않는 이유(QA1 MD).
 * 이유는 CONTEXT.md '게시 상태'(초안·공개·보관) 말로 부른다 — '비공개'·'숨김'은 쓰지 않는다. 판정은 DB private.goods_display_visibility와
 * 같다(상품 보관 > IP 보관 > 상품 초안 > IP 초안 > 판매 제한 > 공개). 공개 전 상품을 미리 담는 것은 막지 않고, 결과 줄·담은 목록·미리보기에
 * 늘 같은 배지와 문장으로 알린다.
 */
export const GOOD_VISIBILITY_REASONS = ['archived', 'ip_archived', 'draft', 'ip_draft', 'restricted'] as const;
export type GoodVisibilityReason = typeof GOOD_VISIBILITY_REASONS[number];
/**
 * public은 고객 화면에 보인다. missing은 그 상품 URL의 상품이 없다(지워짐). hidden은 보이지 않지만 이유를 나눌 수 없을 때다
 * (이유를 싣지 않은 응답·조회 실패, 또는 공개 상품인데 그 전시 목록에서 빠진 경우).
 */
export type DisplayGoodVisibility = 'public' | GoodVisibilityReason | 'missing' | 'hidden';
export type HiddenDisplayGoodVisibility = Exclude<DisplayGoodVisibility, 'public'>;

/** 판매 제한 이름은 판매 설정(GoodSaleRestrictionControl·GoodsSalePolicyFields)의 '성인(19금)'과 같다. */
export const DISPLAY_GOOD_VISIBILITY_LABELS: Record<HiddenDisplayGoodVisibility, string> = {
  draft: '초안', ip_draft: 'IP 초안', restricted: '성인(19금)', archived: '보관됨', ip_archived: 'IP 보관됨', missing: '찾을 수 없음', hidden: '고객 화면 미노출',
};
export const DISPLAY_GOOD_VISIBILITY_NOTES: Record<HiddenDisplayGoodVisibility, string> = {
  draft: '공개 전까지 고객 화면에 보이지 않습니다.',
  ip_draft: 'IP 공개 전까지 고객 화면에 보이지 않습니다.',
  restricted: '홈 전시·캠페인·쇼핑스토리에는 나오지 않고, 카테고리 전시에서는 성인 인증을 마친 회원에게만 보입니다.',
  archived: '보관된 상품이라 고객 화면에 보이지 않습니다.',
  ip_archived: 'IP가 보관되어 고객 화면에 보이지 않습니다.',
  missing: '찾을 수 없는 상품이라 고객 화면에 보이지 않습니다.',
  hidden: '고객 화면에 보이지 않습니다.',
};

/** DB가 돌려준 이유(공개 포함). 모르는 값이면 null — 화면은 이유를 지어내지 않는다. */
export function parseGoodVisibility(value: unknown): 'public' | GoodVisibilityReason | null {
  return value === 'public' || GOOD_VISIBILITY_REASONS.includes(value as GoodVisibilityReason) ? value as 'public' | GoodVisibilityReason : null;
}
/** 이유를 실은 행은 그 이유를, 싣지 않은 행은 보관·공개 여부로만 나눈다(나머지는 이유를 알 수 없는 미노출). 행이 없으면 찾을 수 없음이다. */
export function displayGoodVisibility(good: { archived: boolean; published: boolean; visibility?: DisplayGoodVisibility } | null | undefined): DisplayGoodVisibility {
  if (!good) return 'missing';
  if (good.visibility) return good.visibility;
  return good.archived ? 'archived' : good.published ? 'public' : 'hidden';
}
/** admin_goods_display_visibility 한 줄(없는 상품 URL은 결과에 없다). */
export interface GoodDisplayVisibilityRow { id: string; name: string; code: string | null; visibility: 'public' | GoodVisibilityReason }
/** 저장된 전시 구성의 상품 한 개(이름은 조회 전이면 null). */
export interface DisplayGoodInfo { name: string | null; code: string | null; visibility: DisplayGoodVisibility }

const count = (value: number) => value.toLocaleString('ko-KR');
function namesOf(goods: readonly { name: string }[]) {
  const shown = goods.slice(0, 3).map(good => good.name).join(', ');
  return goods.length > 3 ? `${shown} 외 ${count(goods.length - 3)}개` : shown;
}
const NOTICE_ORDER: HiddenDisplayGoodVisibility[] = ['draft', 'ip_draft', 'restricted', 'archived', 'ip_archived', 'missing', 'hidden'];
const NOTICE: Record<HiddenDisplayGoodVisibility, (size: string, names: string) => string> = {
  draft: (size, names) => `초안 상품 ${size}개(${names})는 공개 전까지 고객 화면에 보이지 않습니다.`,
  ip_draft: (size, names) => `IP가 공개 전인 상품 ${size}개(${names})는 IP 공개 전까지 고객 화면에 보이지 않습니다.`,
  restricted: (size, names) => `성인(19금) 상품 ${size}개(${names})는 홈 전시·캠페인·쇼핑스토리에 나오지 않고, 카테고리 전시에서는 성인 인증을 마친 회원에게만 보입니다.`,
  archived: (size, names) => `보관된 상품 ${size}개(${names})는 고객 화면에 보이지 않습니다.`,
  ip_archived: (size, names) => `IP가 보관된 상품 ${size}개(${names})는 고객 화면에 보이지 않습니다.`,
  missing: (size, names) => `찾을 수 없는 상품 ${size}개(${names})는 고객 화면에 보이지 않습니다.`,
  hidden: (size, names) => `고객 화면에 보이지 않는 상품 ${size}개(${names})가 있습니다.`,
};
/** 담은 상품 중 고객 화면에 보이지 않는 상품을 이유별로 이름과 함께 한 문단으로 알린다(미리보기·목록 위). 모두 보이면 null. */
export function hiddenDisplayGoodsNotice(goods: readonly { name: string; visibility: DisplayGoodVisibility }[]): string | null {
  const parts = NOTICE_ORDER.flatMap(visibility => {
    const group = goods.filter(good => good.visibility === visibility);
    return group.length ? [NOTICE[visibility](count(group.length), namesOf(group))] : [];
  });
  return parts.length ? parts.join(' ') : null;
}
/** 담은 안내의 이유별 수: "초안 1개, 성인(19금) 1개". */
export function hiddenDisplayGoodsBreakdown(visibilities: readonly DisplayGoodVisibility[]) {
  return NOTICE_ORDER.flatMap(visibility => {
    const size = visibilities.filter(item => item === visibility).length;
    return size ? [`${DISPLAY_GOOD_VISIBILITY_LABELS[visibility]} ${count(size)}개`] : [];
  }).join(', ');
}
