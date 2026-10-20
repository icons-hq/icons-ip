export const SHOPPING_STORIES_PATH = '/stories';
export const SHOPPING_STORY_TITLE_MAX = 50;
export const SHOPPING_STORY_BODY_MAX = 30_000;
export const SHOPPING_STORY_IMAGE_MAX = 20;
export const SHOPPING_STORY_SECTION_MAX = 10;
export const SHOPPING_STORY_SECTION_TITLE_MAX = 13;
export const SHOPPING_STORY_SECTION_GOODS_MAX = 200;
export const SHOPPING_STORY_GOODS_MAX = 300;
export const SHOPPING_STORY_DESCRIPTION_MAX = 160;
export const SHOPPING_STORY_IMAGE_PATTERN = /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export type ShoppingStoryState = 'scheduled' | 'active' | 'ended';
export type ShoppingStoryImageShape = 'square' | 'portrait';
export interface ShoppingStorySectionInput {
  id: string;
  title: string;
  imageShape: ShoppingStoryImageShape;
  goodIds: string[];
}
export interface ShoppingStoryInput {
  title: string;
  bodyHtml: string;
  imagePaths: string[];
  startsAt: string | null;
  endsAt: string | null;
  sections: ShoppingStorySectionInput[];
}
export interface PublicShoppingStorySummary {
  id: string;
  reference: number;
  title: string;
  description: string;
  imageUrl: string | null;
  createdAt: string;
  startsAt: string | null;
  endsAt: string | null;
}
export interface PublicShoppingStoryGood {
  salePeriod?: import('./goods-sale-period').GoodsSalePeriod;
  listingAppearance?: import('./store-presentation').GoodsListingAppearance;
  id: string;
  name: string;
  price: number;
  priceMax: number;
  compareAtPrice: number | null;
  showDiscountRate: boolean;
  imageBackground: string;
  badge: string | null;
  soldOut: boolean;
}
export interface PublicShoppingStorySection {
  id: string;
  title: string;
  imageShape: ShoppingStoryImageShape;
  goods: PublicShoppingStoryGood[];
}
export interface PublicShoppingStory extends PublicShoppingStorySummary {
  bodyHtml: string;
  imagePaths: string[];
  sections: PublicShoppingStorySection[];
  nextChangeAt: string | null;
  goodsUnavailable: boolean;
}
export interface PublicShoppingStoryList {
  stories: PublicShoppingStorySummary[];
  total: number;
  page: number;
  pageSize: number;
  nextChangeAt: string | null;
  unavailable?: boolean;
}

export function shoppingStoryHref(id: string) {
  return `${SHOPPING_STORIES_PATH}/${encodeURIComponent(id)}`;
}
/** KST is an input/display convention; stored instants use an inclusive start and exclusive end. */
export function shoppingStoryState(startsAt: string | null, endsAt: string | null, now = Date.now()): ShoppingStoryState {
  if (endsAt !== null && Date.parse(endsAt) <= now) return 'ended';
  if (startsAt !== null && Date.parse(startsAt) > now) return 'scheduled';
  return 'active';
}
export function storyCharacterLength(value: string) { return Array.from(value).length; }
