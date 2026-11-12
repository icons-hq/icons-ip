import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { GOOD_TYPES, type GoodType } from '@/lib/goods-taxonomy';
import { categoryGoodTypeSource, type AdminCategoryNode, type CategoryGoodTypeSource } from './category';
import type { GoodsOptionRow } from './goods-option-editor';
import { goodsReadinessAnchor, type AdminGoodsReadiness, type GoodsReadinessReasonCode } from './goods-readiness';

/**
 * 옵션별 구매 제한 표(D7②)의 입력은 옵션 행 JSON(`variants`)으로 제출돼 자기 이름이 없다. 브라우저 검증 오류를
 * 구매 제한 카드에 붙이기 위한 오류 칸 이름이다(입력의 data-error-field).
 */
export const GOOD_OPTION_LIMIT_ERROR_FIELD = 'optionLimits';

/**
 * Display grouping only. Validation and publish decisions remain with the server.
 * 화면 순서이자 오류 안내 순서다. `good-section-<key>`는 카드 안의 자리로도 남는다(판매 준비·목록·오류 링크가 이 id로 온다).
 */
export const GOOD_EDITOR_SECTIONS = [
  { key: 'category', label: '카테고리', fields: ['categoryId'] },
  { key: 'basic', label: '상품명', fields: ['name', 'ipId', 'type'] },
  { key: 'attributes', label: '상품속성', fields: ['productAttributes', 'productAttributeDraft'] },
  { key: 'price', label: '판매가', fields: ['price', 'compareAtPrice', 'regularPrice', 'discountEnabled', 'discountValue', 'discountUnit'] },
  { key: 'variants', label: '재고수량·옵션', fields: ['variants', 'variantBaseline', 'optionUsage', 'optionAxisName0', 'optionAxisValues0', 'optionAxisName1', 'optionAxisValues1', 'optionAxisName2', 'optionAxisValues2'] },
  { key: 'period', label: '판매기간', fields: ['salePeriodEnabled', 'saleStartsAt', 'saleEndsAt', 'salePeriodRevision'] },
  { key: 'limits', label: '구매 제한', fields: ['orderQuantityLimitEnabled', 'minOrderQty', 'maxOrderQty', 'memberPurchaseLimitEnabled', 'memberLifetimeQtyLimit', GOOD_OPTION_LIMIT_ERROR_FIELD] },
  { key: 'images', label: '상품이미지', fields: ['imagePath', 'galleryPath0', 'galleryPath1', 'galleryPath2', 'galleryPath3', 'galleryPath4', 'galleryPath5', 'galleryPath6', 'galleryPath7', 'galleryPath8'] },
  { key: 'description', label: '상세설명', fields: ['description', 'descriptionFormat', 'detailImagePath', 'descriptionUploadPath', 'descriptionImageAlt'] },
  { key: 'notice', label: '상품정보제공고시', fields: GOODS_NOTICE_FIELDS.map((field) => field.formName) },
  { key: 'shipping', label: '출고지·배송비', fields: ['originId', 'shippingFeeType', 'individualFee', 'shippingNoticeTemplate'] },
  { key: 'claims', label: '반품·교환', fields: [ 'claimReturnAllowed', 'claimExchangeAllowed', 'claimReturnFee', 'claimReturnFreeShippingFee', 'claimExchangeFee', 'claimRestrictionReason'] },
  { key: 'sale', label: '결제·판매 제한', fields: ['allowCardPayment', 'allowBankTransfer', 'saleRestriction'] },
  { key: 'information', label: '추가 설정', fields: ['additionalCategoryIds', 'customInputs', 'customInputsExpectedRevision', 'showDiscountRate', 'badge', 'stock', 'nameEn', 'displayOrder', 'searchKeywords', 'code', 'defaultVariantCode', 'id'] },
] as const;
export type GoodEditorSectionKey = typeof GOOD_EDITOR_SECTIONS[number]['key'];

/**
 * 상품 등록·수정 화면의 카드 7장(스마트스토어식 한 페이지). 위 섹션을 묶은 표시 단위이고 입력·이름·제출 값은 그대로다.
 * `field`가 있으면 섹션 이동 띠에서 그 칸으로 포커스를 옮기고, 없으면 카드 머리로 간다(접힌 줄을 띠에서 열지 않는다).
 */
export const GOOD_EDITOR_CARDS = [
  { key: 'basic', label: '기본 정보', anchor: 'good-section-basic', sections: ['category', 'basic', 'attributes'], field: 'name' },
  { key: 'sales', label: '판매 정보', anchor: 'good-section-price', sections: ['price', 'variants', 'period', 'limits'], field: 'regularPrice' },
  { key: 'images', label: '상품이미지', anchor: 'good-section-images', sections: ['images'] },
  { key: 'description', label: '상세설명', anchor: 'good-section-description', sections: ['description'], field: 'descriptionFormat' },
  { key: 'notice', label: '고시·KC', anchor: 'good-section-notice', sections: ['notice'], field: 'noticeMaker' },
  { key: 'delivery', label: '배송·반품·결제', anchor: 'good-section-delivery', sections: ['shipping', 'claims', 'sale'] },
  { key: 'additional', label: '추가 설정', anchor: 'good-section-information', sections: ['information'] },
] as const;
export type GoodEditorCardKey = typeof GOOD_EDITOR_CARDS[number]['key'];

export function goodFieldSection(name: string) {
  return GOOD_EDITOR_SECTIONS.find((section) => (section.fields as readonly string[]).includes(name)) ?? GOOD_EDITOR_SECTIONS[0];
}

/* 등록 화면 원자 저장 섹션의 오류: KC는 고시 카드 안이라 고시 바로 뒤, 예약판매는 판매 정보 카드의 판매기간 바로 뒤(1027T-023)다. */
const errorOrder = (field: string) => {
  if (field === 'workspaceKc') return GOOD_EDITOR_SECTIONS.findIndex((section) => section.key === 'notice') + 0.5;
  if (field === 'workspacePreorders') return GOOD_EDITOR_SECTIONS.findIndex((section) => section.key === 'period') + 0.5;
  return GOOD_EDITOR_SECTIONS.indexOf(goodFieldSection(field));
};

export function orderedGoodErrors(errors: Record<string, string | undefined> = {}) {
  return Object.entries(errors).filter((entry): entry is [string, string] => Boolean(entry[1])).sort(([a], [b]) => errorOrder(a) - errorOrder(b));
}

export interface GoodPublishRequirement { key: string; label: string; card: GoodEditorCardKey; anchor: string; field?: string; done: boolean }

/**
 * 공개까지 채워야 할 칸의 안내용 목록이다. 판정은 서버(private.set_good_published)가 하고, 이 목록은 무엇이 남았는지 보여 주기만 한다.
 * 판매가·재고는 서버 공개 조건은 아니지만 없으면 팔 수 없어 함께 센다.
 */
export function goodPublishRequirements({ values, regularPrice, hasStock, kcDone, missingAttributes = [] }: {
  values: Record<string, string | undefined>; regularPrice: number | null; hasStock: boolean; kcDone: boolean;
  /** 고른 대표 카테고리에서 아직 안 채운 필수 상품속성 이름. 서버가 저장을 막는 칸이라 함께 센다. */
  missingAttributes?: readonly string[];
}): GoodPublishRequirement[] {
  const filled = (name: string) => Boolean(values[name]?.trim());
  return [
    { key: 'name', label: '상품명', card: 'basic', anchor: 'good-section-basic', field: 'name', done: filled('name') },
    { key: 'ipId', label: '연결 IP', card: 'basic', anchor: 'good-section-basic', field: 'ipId', done: filled('ipId') },
    /* SHEET-003: 상품 유형은 입력칸이 없고 대표 카테고리의 연결값이다(values.type에는 파생값을 싣는다). */
    { key: 'type', label: '카테고리 상품 유형', card: 'basic', anchor: 'good-section-category', field: 'categoryId', done: filled('type') },
    ...missingAttributes.map((name) => ({ key: `attribute:${name}`, label: name, card: 'basic' as const, anchor: 'good-section-attributes', field: 'productAttributes', done: false })),
    { key: 'regularPrice', label: '판매가', card: 'sales', anchor: 'good-section-price', field: 'regularPrice', done: Boolean(regularPrice && regularPrice > 0) },
    { key: 'stock', label: '재고수량', card: 'sales', anchor: 'good-section-variants', field: 'variants', done: hasStock },
    { key: 'imagePath', label: '대표 이미지', card: 'images', anchor: 'good-section-images', field: 'imagePath', done: filled('imagePath') },
    ...GOODS_NOTICE_FIELDS.map((field) => ({ key: field.formName, label: field.label, card: 'notice' as const, anchor: 'good-section-notice', field: field.formName, done: filled(field.formName) })),
    { key: 'kc', label: 'KC 검토', card: 'notice', anchor: 'good-operation-kc', done: kcDone },
    { key: 'originId', label: '출고지', card: 'delivery', anchor: 'good-section-shipping', field: 'originId', done: filled('originId') },
  ];
}

/** 카드별 남은 필수 입력 수. 필수 항목이 없는 카드는 키가 없다(표시하지 않는다). */
export function goodRemainingByCard(requirements: readonly GoodPublishRequirement[]): Partial<Record<GoodEditorCardKey, number>> {
  const remaining: Partial<Record<GoodEditorCardKey, number>> = {};
  for (const item of requirements) remaining[item.card] = (remaining[item.card] ?? 0) + (item.done ? 0 : 1);
  return remaining;
}

/**
 * 저장에 실패한 칸을 카드별로 센다. 섹션 이동 띠의 빨간 표시는 이 값에서만 나온다. 등록 화면 KC 입력은 고시 카드, 예약판매 입력은
 * 판매 정보 카드 안에 있어 그 카드로 센다.
 */
export function goodErrorsByCard(errors: Record<string, string | undefined>): Partial<Record<GoodEditorCardKey, number>> {
  const result: Partial<Record<GoodEditorCardKey, number>> = {};
  for (const card of GOOD_EDITOR_CARDS) {
    const fields = GOOD_EDITOR_SECTIONS.filter((section) => (card.sections as readonly string[]).includes(section.key)).flatMap((section) => section.fields as readonly string[]);
    const count = fields.filter((field) => errors[field]).length + (card.key === 'notice' && errors.workspaceKc ? 1 : 0)
      + (card.key === 'sales' && errors.workspacePreorders ? 1 : 0);
    if (count) result[card.key] = count;
  }
  return result;
}

/** 지금 보는 카드: 읽는 선을 지난 마지막 카드다. 첫 카드보다 위면 첫 카드이고, 마지막 카드를 다 지나면 없다. */
export function goodCurrentCard(boxes: readonly { key: GoodEditorCardKey; top: number; bottom: number }[], line: number): GoodEditorCardKey | null {
  const last = boxes.at(-1);
  if (!last || last.bottom < line) return null;
  return boxes.filter((box) => box.top <= line).at(-1)?.key ?? boxes[0].key;
}

/* 유형 이름을 그대로 쓰지 않는 흔한 카테고리 이름. 값 목록은 DB CHECK(GOOD_TYPES)이고 여기서는 제안만 한다. */
const GOOD_TYPE_ALIASES: Record<string, GoodType> = { 열쇠고리: '키링', 키홀더: '키링', 봉제: '인형', 스태츄: '피규어', 스티커: '문구', 엽서: '문구', 포스터: '문구', 노트: '문구', 다이어리: '문구', 베개: '쿠션' };

/**
 * 카테고리 경로(위→아래) 이름에서 연결할 상품 유형을 제안한다(카테고리 관리의 상품 유형 칸). 말단에 가까운 이름을 먼저 본다.
 * 맞는 유형이 없으면 null이다. 상품 유형은 카테고리의 연결값으로 정해지고(SHEET-003), 이 제안은 연결을 고를 때만 쓴다.
 */
export function goodTypeSuggestion(categoryPath: readonly string[]): GoodType | null {
  for (const name of [...categoryPath].reverse()) {
    const type = GOOD_TYPES.find((candidate) => candidate !== '기타' && name.includes(candidate));
    if (type) return type;
    const alias = Object.entries(GOOD_TYPE_ALIASES).find(([word]) => name.includes(word));
    if (alias) return alias[1];
  }
  return null;
}

/** SHEET-003(ADR-0037): 상품 유형은 대표 카테고리(없으면 가까운 상위)에 연결한 값이다. 서버가 이 규칙으로 거절한 이유의 안내다. */
export const GOOD_TYPE_CATEGORY_MESSAGES = {
  required: '대표 카테고리(또는 상위 카테고리)에 상품 유형이 연결되어 있어야 공개할 수 있습니다. 공개 중인 상품은 상품 유형이 같은 카테고리로만 옮길 수 있습니다. 카테고리 관리에서 상품 유형을 연결해주세요.',
  changed: '카테고리에 연결된 상품 유형이 저장된 유형과 다릅니다. 상품을 저장해 카테고리 유형을 반영하고 KC를 다시 검토한 뒤 공개해주세요.',
  locked: '공개 중인 상품은 상품 유형이 다른 카테고리로 옮길 수 없습니다. 초안으로 전환한 뒤 바꾸고 KC를 다시 검토해주세요.',
} as const;

export const GOOD_PUBLISHED_LOCKS = {
  name: '상품명', type: '유형', ipId: '연결 IP', noticeMaker: '제조자',
  noticeOrigin: '제조국', noticeMaterial: '소재', noticeSize: '크기',
} as const;

export function changedGoodLockedFields(initial: Record<string, string>, current: Record<string, string>) {
  return Object.entries(GOOD_PUBLISHED_LOCKS).filter(([key]) => (initial[key] ?? '').trim() !== (current[key] ?? '').trim())
    .map(([key, label]) => [key, `${label} 항목은 공개 중에 잠겨 있습니다. 초안으로 전환 후 수정해주세요.`] as const);
}

export interface GoodTypeFromCategory {
  /** 지금 고른 대표 카테고리에서 파생한 상품 유형과 그 출처. */
  category: CategoryGoodTypeSource;
  /**
   * 폼이 싣는 유형(name="type"). 초안은 카테고리 연결값이고, 연결이 없으면 저장된 값을 그대로 둔다(그 초안은 공개할 수 없다 —
   * 지우면 카테고리를 고르기 전에 KC 검토만 되돌아간다). 공개 중이면 저장된 유형이다. DB 트리거가 같은 규칙으로 다시 정한다.
   */
  submitted: string;
  /** 공개 중 상품의 대표 카테고리를 상품 유형이 다른(연결 없음 포함) 카테고리로 바꾸려 할 때의 안내. 저장을 막는다. */
  categoryChangeProblem: string | null;
  /** 공개 중 상품이 지금 카테고리의 유형과 다를 때(연결 없음 포함). 저장은 막지 않고 경고만 한다. */
  publishedMismatch: 'missing' | 'no-category' | 'different' | null;
}

/** SHEET-003(ADR-0037): 상품 유형 = 대표 카테고리(없으면 가까운 상위)의 연결값. 화면 판정이고 저장·공개 판정은 서버가 한다. */
export function goodTypeFromCategory({ categories, categoryId, initialCategoryId, storedType, published }: {
  categories: readonly Pick<AdminCategoryNode, 'id' | 'parentId' | 'goodType'>[]; categoryId: string; initialCategoryId: string;
  storedType: string; published: boolean;
}): GoodTypeFromCategory {
  const category = categoryGoodTypeSource(categories, categoryId || null);
  if (!published) return { category, submitted: category.type || storedType, categoryChangeProblem: null, publishedMismatch: null };
  const differs = category.type !== storedType;
  const moved = (categoryId || '') !== (initialCategoryId || '');
  return {
    category,
    submitted: storedType,
    categoryChangeProblem: moved && differs ? (category.type ? GOOD_TYPE_CATEGORY_MESSAGES.locked : GOOD_TYPE_CATEGORY_MESSAGES.required) : null,
    publishedMismatch: !moved && differs ? (category.type ? 'different' : categoryId ? 'missing' : 'no-category') : null,
  };
}

type GoodKcOptionRow = Pick<GoodsOptionRow, 'id' | 'name' | 'attributes'>;
const goodKcOptionIdentity = (row: GoodKcOptionRow) => JSON.stringify([row.name.trim(), Object.entries(row.attributes).sort(([a], [b]) => a.localeCompare(b))]);

/**
 * 이 입력을 저장하면 완료된 KC 검토가 미검토로 돌아가는가. DB 가드(private.guard_goods_kc·guard_goods_variant_kc)와 같은 기준의 안내용 판정이다.
 * 저장 후 공개가 초안으로만 저장될 경우를 미리 가려 버튼 이름과 결과를 맞춘다. 사용 중지는 검토를 무효화하지 않아 세지 않는다.
 */
export function goodKcContextChanged(savedValues: Record<string, string>, currentValues: Record<string, string>, savedRows: readonly GoodKcOptionRow[], currentRows: readonly GoodKcOptionRow[]): boolean {
  if (changedGoodLockedFields(savedValues, currentValues).length) return true;
  const saved = new Map(savedRows.filter((row) => row.id).map((row) => [row.id, goodKcOptionIdentity(row)]));
  const current = new Set(currentRows.map((row) => row.id));
  return currentRows.some((row) => !row.id || saved.get(row.id) !== goodKcOptionIdentity(row)) || [...saved.keys()].some((id) => !current.has(id));
}

type GoodReadinessReason = AdminGoodsReadiness['reasons'][number];

/** 판매 준비 링크의 도착지. 사유 표의 대상은 공용 판정(goods-readiness)이고, 입력이 옮겨 간 두 항목만 새 자리로 보낸다. */
export function goodReadinessReasonAnchor(reason: Pick<GoodReadinessReason, 'code' | 'target'>): string {
  if (reason.code === 'type_missing' || reason.code === 'type_category_mismatch' || reason.code === 'type_no_category') return 'good-section-category';
  return reason.code === 'stopped' ? 'good-section-information' : reason.code === 'image_missing' ? 'good-section-images' : goodsReadinessAnchor(reason.target);
}

const GOOD_READINESS_ACTIONS: Partial<Record<GoodsReadinessReasonCode, string>> = {
  kc_required: 'KC 검토하기', kc_legacy_unrecorded: 'KC 정보 확인하기', type_missing: '카테고리 상품 유형 확인하기', type_category_mismatch: '카테고리 상품 유형 확인하기', type_no_category: '대표 카테고리 고르기', image_missing: '대표 이미지 등록하기', notice_missing: '고시정보 입력하기',
  no_active_options: '옵션 확인하기', stock_unavailable: '재고 확인하기', shipping_unavailable: '출고지 확인하기', payment_disabled: '결제수단 확인하기', restricted_sale: '판매 제한 확인하기',
  ip_unpublished: '연결 IP 확인하기', ip_archived: '연결 IP 확인하기', stopped: '판매상태 확인하기',
};
/** 판매 준비 다음 할 일 버튼의 이름. */
export function goodReadinessAction(code: GoodsReadinessReasonCode): string { return GOOD_READINESS_ACTIONS[code] ?? '확인하기'; }

/** 서버가 공개를 거절하는 사유(private.set_good_published·KC 가드). 나머지 사유는 공개는 되지만 고객이 보지 못하거나 사지 못한다. */
const GOOD_PUBLISH_GATES: ReadonlySet<GoodsReadinessReasonCode> = new Set<GoodsReadinessReasonCode>(['type_missing', 'type_category_mismatch', 'image_missing', 'notice_missing', 'no_active_options', 'kc_required']);
/* 게시 상태 자체를 말하는 사유. 위쪽 게시 배지가 말하므로 할 일로 세지 않는다. 판정을 못 읽은 경우는 추정하지 않고 공개를 보조 버튼으로 둔다. */
const GOOD_READINESS_STATUS_ONLY: ReadonlySet<GoodsReadinessReasonCode> = new Set<GoodsReadinessReasonCode>(['draft', 'archived', 'readiness_unknown']);

export interface GoodReadinessPlan {
  /** 먼저 처리할 항목(공개를 막는 항목 우선). 없으면 null이다. */
  next: GoodReadinessReason | null;
  /** next 다음에 확인할 항목. */
  others: GoodReadinessReason[];
  /** 공개 버튼. primary면 주 행동, secondary면 보조, null이면 서버가 거절하므로 그리지 않는다. */
  publish: 'primary' | 'secondary' | null;
}

/** 초안의 판매 준비 카드가 보일 주 행동. 공개 판정은 서버가 하고, 이 계획은 무엇을 먼저 할지 보여 주기만 한다. */
export function goodReadinessPlan(readiness: AdminGoodsReadiness | null | undefined): GoodReadinessPlan {
  if (!readiness) return { next: null, others: [], publish: 'secondary' };
  const items = readiness.reasons.filter((reason) => !GOOD_READINESS_STATUS_ONLY.has(reason.code));
  const gates = items.filter((reason) => GOOD_PUBLISH_GATES.has(reason.code));
  const [next = null, ...others] = [...gates, ...items.filter((reason) => !GOOD_PUBLISH_GATES.has(reason.code))];
  const unknown = readiness.reasons.some((reason) => reason.code === 'readiness_unknown');
  return { next, others, publish: gates.length ? null : next || unknown ? 'secondary' : 'primary' };
}

/**
 * 판매 설정 배지의 상태. 서버는 초안·보관도 판매 불가('blocked')로 세지만 그건 게시 배지가 말하는 내용이다.
 * 설정을 실제로 막는 사유가 있을 때만 확인 필요로 보여, 뭘 먼저 할지 흐리지 않는다.
 */
export function goodSaleSettingsState(readiness: AdminGoodsReadiness): AdminGoodsReadiness['saleSettings'] {
  if (readiness.saleSettings !== 'blocked') return readiness.saleSettings;
  return readiness.reasons.some((reason) => reason.kind === 'blocking' && !GOOD_READINESS_STATUS_ONLY.has(reason.code)) ? 'blocked' : 'ready';
}
