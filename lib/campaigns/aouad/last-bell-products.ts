export const LAST_BELL_COLLECTIBLE_KEYS = [
  'idcard',
  'badge',
  'photo',
  'radio',
  'kit',
  'zipup',
  'archery',
  'postcard',
  'candle',
  'blanket',
] as const;

export type LastBellCollectibleKey = (typeof LAST_BELL_COLLECTIBLE_KEYS)[number];
export type LastBellCollectibleChapter = 'chapter-01' | 'chapter-02';
export type LastBellCollectibleZone =
  | 'classroom'
  | 'corridor'
  | 'infirmary'
  | 'broadcast'
  | 'utility'
  | 'stairwell';

export type LastBellProductCatalogItem = {
  key: LastBellCollectibleKey;
  name: string;
  category: string;
  previewPriceWon: number;
  previewPriceStatus: 'draft';
  purchaseAccess: 'story_entitlement';
  chapterId: LastBellCollectibleChapter;
  zoneId: LastBellCollectibleZone;
  placement: string;
  discovery: 'main' | 'detour';
  assetPath: string;
  thumbnailPath: string;
  ipReviewStatus: 'pending';
};

const productAssetPath = (key: LastBellCollectibleKey) => `/generated/last-bell/products/${key}/model.glb`;
const productThumbnailPath = (key: LastBellCollectibleKey) => `/generated/last-bell/products/${key}/thumbnail.webp`;

/**
 * Campaign catalog only. The gameplay runtime records stable keys and never
 * treats these preview prices as an authority for checkout or inventory.
 */
export const LAST_BELL_PRODUCT_CATALOG = [
  {
    key: 'idcard',
    name: '효산고 학생증 — 생존자 에디션',
    category: '신분',
    previewPriceWon: 18_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-01',
    zoneId: 'classroom',
    placement: '첫 교실 교탁',
    discovery: 'main',
    assetPath: productAssetPath('idcard'),
    thumbnailPath: productThumbnailPath('idcard'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'badge',
    name: '2학년 5반 명찰 뱃지 세트',
    category: '수집',
    previewPriceWon: 8_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-01',
    zoneId: 'corridor',
    placement: '교실 사물함',
    discovery: 'main',
    assetPath: productAssetPath('badge'),
    thumbnailPath: productThumbnailPath('badge'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'photo',
    name: '생존자 포토카드 팩',
    category: '수집',
    previewPriceWon: 6_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-01',
    zoneId: 'corridor',
    placement: '뒤집힌 책상 아래',
    discovery: 'main',
    assetPath: productAssetPath('photo'),
    thumbnailPath: productThumbnailPath('photo'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'radio',
    name: '무전기 키링 「다방」 페어',
    category: '생존 키트',
    previewPriceWon: 16_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-01',
    zoneId: 'broadcast',
    placement: '방송실 책상',
    discovery: 'main',
    assetPath: productAssetPath('radio'),
    thumbnailPath: productThumbnailPath('radio'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'kit',
    name: '생존 키트 파우치',
    category: '생존 키트',
    previewPriceWon: 22_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-01',
    zoneId: 'infirmary',
    placement: '보건실 샛길',
    discovery: 'detour',
    assetPath: productAssetPath('kit'),
    thumbnailPath: productThumbnailPath('kit'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'zipup',
    name: '효산고 체육복 집업 — 시즌2 기다림 에디션',
    category: '의류',
    previewPriceWon: 69_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-01',
    zoneId: 'infirmary',
    placement: '체육부 사물함 샛길',
    discovery: 'detour',
    assetPath: productAssetPath('zipup'),
    thumbnailPath: productThumbnailPath('zipup'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'archery',
    name: '양궁부 화살 북마크 + 연필 세트',
    category: '문구',
    previewPriceWon: 9_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-01',
    zoneId: 'broadcast',
    placement: '동아리 게시대 샛길',
    discovery: 'detour',
    assetPath: productAssetPath('archery'),
    thumbnailPath: productThumbnailPath('archery'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'postcard',
    name: '무전 엽서 세트 「살아 있으면, 옥상으로」',
    category: '문구',
    previewPriceWon: 7_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-01',
    zoneId: 'corridor',
    placement: '복도 게시판',
    discovery: 'main',
    assetPath: productAssetPath('postcard'),
    thumbnailPath: productThumbnailPath('postcard'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'candle',
    name: '모닥불 캔들 — 옥상의 밤',
    category: '수집',
    previewPriceWon: 24_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-02',
    zoneId: 'stairwell',
    placement: '옥상 계단 정비 선반',
    discovery: 'main',
    assetPath: productAssetPath('candle'),
    thumbnailPath: productThumbnailPath('candle'),
    ipReviewStatus: 'pending',
  },
  {
    key: 'blanket',
    name: '옥상 S.O.S 블랭킷',
    category: '생활',
    previewPriceWon: 39_000,
    previewPriceStatus: 'draft',
    purchaseAccess: 'story_entitlement',
    chapterId: 'chapter-02',
    zoneId: 'stairwell',
    placement: '옥상 출입구 비상함',
    discovery: 'main',
    assetPath: productAssetPath('blanket'),
    thumbnailPath: productThumbnailPath('blanket'),
    ipReviewStatus: 'pending',
  },
] as const satisfies readonly LastBellProductCatalogItem[];

export const LAST_BELL_PRODUCT_BY_KEY = Object.fromEntries(
  LAST_BELL_PRODUCT_CATALOG.map((item) => [item.key, item]),
) as Record<LastBellCollectibleKey, (typeof LAST_BELL_PRODUCT_CATALOG)[number]>;

export function isLastBellCollectibleKey(value: string): value is LastBellCollectibleKey {
  return (LAST_BELL_COLLECTIBLE_KEYS as readonly string[]).includes(value);
}
