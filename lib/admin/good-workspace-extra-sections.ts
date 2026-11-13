import { isUuid } from '@/lib/uuid';
import { parseGoodsAfterSalesValues, type GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { goodsAfterSalesError } from '@/lib/admin/goods-after-sales-messages';
import { parseGoodsBenefitValues, type GoodsBenefitValues } from '@/lib/goods-benefits';
import { goodsBenefitsError } from '@/lib/admin/goods-benefits-messages';
import { emptyGoodsSizeChartValues, parseGoodsSizeChartValues, type GoodsSizeChartValues } from '@/lib/goods-size-chart';
import { goodsSizeChartError } from '@/lib/admin/goods-size-chart-messages';
import { parseGoodsColorChips, type GoodsColorChip } from '@/lib/store-presentation';
import { type DigitalFile, type FulfillmentMethod, type FulfillmentMode } from '@/lib/goods-fulfillment';
import { fulfillmentError } from '@/lib/admin/goods-fulfillment-messages';
import { productionError } from '@/lib/order-production';
import { RANDOM_OPTION_PROBLEMS, type GoodsOptionSaleMode } from '@/lib/goods-option-sale-mode';
import { goodsOptionSaleModeErrorMessage } from '@/lib/admin/goods-option-sale-mode-messages';
import { parseGoodsPricePeriodInput, type GoodsPricePeriodInput } from './goods-price-periods';
import { parsePurchaseCostInput, type PurchaseTaxBasis } from './goods-purchase-costs';
import { MAX_ADDITIONAL_GOODS, parseAdditionalGoodIds, type AdminAdditionalGood } from './goods-additional';
import { goodsTermsDraft, parseGoodsDeliveryTermsInput, prepareGoodsTermsInput, sameGoodsTerms, type DeliveryTermsInput, type GoodsTermsDraft, type VolumeTermsInput } from './goods-transaction-terms';
import { goodsSubscriptionPolicyError, parseGoodsSubscriptionDraft, type GoodsSubscriptionDraft } from './goods-subscription-policy';
import { goodsOptionRowKey, type GoodsOptionRow } from './goods-option-editor';
import { adminGoodsCopy } from './vocabulary';
import type { GoodsTransactionAdminTerms } from '@/lib/goods-transaction';

/*
 * 상품 등록 화면의 '나머지 설정'(11/11 묶음 10 1027T-024 "저장 전 전부 입력").
 *
 * 상태를 바꾸는 항목(재고 조정·옵션 사용·복사·보관)만 저장 뒤에 두고, 나머지 13개는 첫 저장 때 기본 입력·KC·예약판매와 함께
 * public.admin_save_good_workspace 한 트랜잭션으로 저장한다. 화면 입력은 GoodWorkspaceProvider(폼 키 밖)에 있고, 저장된 상품은
 * 지금처럼 같은 자리의 독립 패널이 자기 버전으로 따로 저장한다. 서버는 각 섹션의 기존 저장 RPC를 그대로 불러 권한·검증을 다시 한다.
 * 입력이 기본값 그대로인 섹션은 보내지 않아 기존 저장과 같은 결과를 낸다.
 */

export interface GoodWorkspacePricePeriodDraft { key: string; optionKey: string; state: 'draft' | 'active'; discountPrice: string; startsAt: string; endsAt: string }
export interface GoodWorkspacePurchaseCostDraft { optionKey: string; unitCostKrw: string; taxBasis: '' | PurchaseTaxBasis }
export const GOOD_WORKSPACE_SHIPPING_METHODS = ['parcel', 'quick', 'pickup', 'direct', 'freight'] as const;
export interface GoodWorkspaceFulfillmentDraft {
  mode: FulfillmentMode;
  methods: { method: typeof GOOD_WORKSPACE_SHIPPING_METHODS[number]; enabled: boolean; amount: string; basis: 'per_order' | 'per_item'; installation: string }[];
  files: DigitalFile[]; publicNote: string; evidence: string; confirmed: boolean;
}
export interface GoodWorkspaceProductionDraft { enabled: boolean; leadDays: string; dayBasis: 'calendar' | 'business'; closedDates: string; publicNote: string; evidence: string; confirmed: boolean }
/** 고른 묶음그룹과 고를 때 본 버전. `display`는 화면 요약 표시용(ShippingChargeGroupField의 그룹 값)이다. */
export interface GoodWorkspaceShippingChargeGroupDraft { id: string; revision: number; originId: string; display?: unknown }

/** 등록 화면 나머지 설정의 화면 상태. 키가 없으면 기본값(입력 안 함)이다. */
export interface GoodWorkspaceExtraDraft {
  optionSaleMode: GoodsOptionSaleMode;
  purchaseCosts: GoodWorkspacePurchaseCostDraft[];
  pricePeriods: GoodWorkspacePricePeriodDraft[];
  additional: AdminAdditionalGood[];
  benefits: GoodsBenefitValues;
  afterSales: GoodsAfterSalesValues;
  sizeChart: GoodsSizeChartValues;
  listingColors: GoodsColorChip[];
  transactionTerms: GoodsTermsDraft;
  shippingChargeGroup: GoodWorkspaceShippingChargeGroupDraft | null;
  subscriptionPolicy: GoodsSubscriptionDraft;
  fulfillment: GoodWorkspaceFulfillmentDraft;
  production: GoodWorkspaceProductionDraft;
}
export type GoodWorkspaceExtraKey = keyof GoodWorkspaceExtraDraft;

export const EMPTY_GOOD_WORKSPACE_BENEFITS: GoodsBenefitValues = { eventText: '', giftText: '', giftImagePaths: [] };
export const EMPTY_GOOD_WORKSPACE_AFTER_SALES: GoodsAfterSalesValues = { phone: '', guide: '', sellerSpecialNotes: '' };
export const EMPTY_GOOD_WORKSPACE_SUBSCRIPTION: GoodsSubscriptionDraft = { enabled: false, intervals: [], message: '' };
/** 새 상품의 할인·확장 배송비 기본 입력(저장된 설정이 없는 상품과 같다). */
export function emptyGoodWorkspaceTerms(): GoodsTermsDraft {
  return goodsTermsDraft({ volume: null, delivery: null } as unknown as GoodsTransactionAdminTerms);
}
/** 새 상품의 수령 방식 기본값: 택배만(기존 배송비 정책). */
export function emptyGoodWorkspaceFulfillment(): GoodWorkspaceFulfillmentDraft {
  return { mode: 'shipping', methods: GOOD_WORKSPACE_SHIPPING_METHODS.map((method) => ({ method, enabled: method === 'parcel', amount: '0', basis: 'per_order', installation: '0' })),
    files: [], publicNote: '', evidence: '', confirmed: false };
}
export function emptyGoodWorkspaceProduction(): GoodWorkspaceProductionDraft {
  return { enabled: false, leadDays: '', dayBasis: 'calendar', closedDates: '', publicNote: '', evidence: '', confirmed: false };
}
export function goodWorkspaceExtraDefault<K extends GoodWorkspaceExtraKey>(key: K): GoodWorkspaceExtraDraft[K] {
  const defaults: { [P in GoodWorkspaceExtraKey]: () => GoodWorkspaceExtraDraft[P] } = {
    optionSaleMode: () => 'select', purchaseCosts: () => [], pricePeriods: () => [], additional: () => [],
    benefits: () => ({ ...EMPTY_GOOD_WORKSPACE_BENEFITS, giftImagePaths: [] }), afterSales: () => ({ ...EMPTY_GOOD_WORKSPACE_AFTER_SALES }),
    sizeChart: emptyGoodsSizeChartValues, listingColors: () => [], transactionTerms: emptyGoodWorkspaceTerms, shippingChargeGroup: () => null,
    subscriptionPolicy: () => ({ ...EMPTY_GOOD_WORKSPACE_SUBSCRIPTION, intervals: [] }), fulfillment: emptyGoodWorkspaceFulfillment, production: emptyGoodWorkspaceProduction,
  };
  return defaults[key]();
}

/** 오류 필드 → 같은 자리의 운영 섹션 id(`good-operation-<id>`). */
export const GOOD_WORKSPACE_EXTRA_ERROR_SECTIONS = {
  workspaceOptionSaleMode: 'option-sale-mode', workspaceCosts: 'costs', workspacePrices: 'prices', workspaceAdditional: 'additional',
  workspaceBenefits: 'benefits', workspaceAfterSales: 'after-sales', workspaceSizeChart: 'size-chart', workspaceListingColors: 'listing-colors',
  workspaceTransactionTerms: 'transaction-terms', workspaceShippingChargeGroup: 'shipping-charge-group', workspaceSubscriptionPolicy: 'subscription-policy',
  workspaceFulfillment: 'fulfillment', workspaceProduction: 'production',
} as const;
export type GoodWorkspaceExtraErrorField = keyof typeof GOOD_WORKSPACE_EXTRA_ERROR_SECTIONS;
const SECTION_FIELD: Record<GoodWorkspaceExtraKey, GoodWorkspaceExtraErrorField> = {
  optionSaleMode: 'workspaceOptionSaleMode', purchaseCosts: 'workspaceCosts', pricePeriods: 'workspacePrices', additional: 'workspaceAdditional',
  benefits: 'workspaceBenefits', afterSales: 'workspaceAfterSales', sizeChart: 'workspaceSizeChart', listingColors: 'workspaceListingColors',
  transactionTerms: 'workspaceTransactionTerms', shippingChargeGroup: 'workspaceShippingChargeGroup', subscriptionPolicy: 'workspaceSubscriptionPolicy',
  fulfillment: 'workspaceFulfillment', production: 'workspaceProduction',
};
export function goodWorkspaceExtraErrorField(key: GoodWorkspaceExtraKey): GoodWorkspaceExtraErrorField { return SECTION_FIELD[key]; }

/**
 * 옵션 행이 바뀌었을 때 지금 행에 없는 옵션 키의 매입단가 입력을 정리한다. 매입단가 섹션은 지금 행만 그려서 사용자가 지울 수 없는 입력이 남기 때문이다.
 * 정리할 것이 없으면 같은 객체를 돌려준다.
 */
export function pruneGoodWorkspaceExtras<T extends Partial<GoodWorkspaceExtraDraft>>(extras: T | undefined, rows: readonly GoodsOptionRow[]): T | undefined {
  if (!extras?.purchaseCosts?.length) return extras;
  const keys = new Set(rows.map(goodsOptionRowKey));
  const kept = extras.purchaseCosts.filter((entry) => keys.has(entry.optionKey));
  return kept.length === extras.purchaseCosts.length ? extras : { ...extras, purchaseCosts: kept };
}

type VariantRef = { id: string } | { attributes: Record<string, string> };
function variantRef(row: GoodsOptionRow): VariantRef {
  return row.id && isUuid(row.id) ? { id: row.id.toLowerCase() } : { attributes: { ...row.attributes } };
}
type FulfillmentValues = { mode: FulfillmentMode; methods: { method: FulfillmentMethod; feeAmount: number | null; feeBasis: 'per_order' | 'per_item'; installationFee: number }[];
  assetIds: string[]; publicNote: string; evidence: string; confirmed: true };
type ProductionValues = { enabled: boolean; leadDays: number | null; dayBasis: 'calendar' | 'business'; closedDates: string[]; publicNote: string; evidence: string; confirmed: true };

/** admin_save_good_workspace sections의 나머지 설정 부분(서버가 다시 검증한다). */
export interface GoodWorkspaceExtraSubmission {
  optionSaleMode?: 'random';
  purchaseCosts?: { variant: VariantRef; unitCostKrw: number | null; taxBasis: PurchaseTaxBasis | null }[];
  pricePeriods?: { variant: VariantRef; period: GoodsPricePeriodInput }[];
  additional?: string[];
  benefits?: GoodsBenefitValues;
  afterSales?: GoodsAfterSalesValues;
  sizeChart?: GoodsSizeChartValues;
  listingColors?: GoodsColorChip[];
  transactionTerms?: { volume?: VolumeTermsInput; delivery?: DeliveryTermsInput };
  shippingChargeGroup?: { groupId: string; expectedRevision: number };
  subscriptionPolicy?: GoodsSubscriptionDraft;
  fulfillment?: FulfillmentValues;
  production?: ProductionValues;
}
export const GOOD_WORKSPACE_EXTRA_KEYS: readonly GoodWorkspaceExtraKey[] = ['optionSaleMode', 'purchaseCosts', 'pricePeriods', 'additional', 'benefits', 'afterSales',
  'sizeChart', 'listingColors', 'transactionTerms', 'shippingChargeGroup', 'subscriptionPolicy', 'fulfillment', 'production'];

export type GoodWorkspaceExtraResult =
  | { ok: true; value: GoodWorkspaceExtraSubmission }
  | { ok: false; field: GoodWorkspaceExtraErrorField; error: string };
const fail = (key: GoodWorkspaceExtraKey, error: string): GoodWorkspaceExtraResult => ({ ok: false, field: SECTION_FIELD[key], error });

function fulfillmentValues(draft: GoodWorkspaceFulfillmentDraft): FulfillmentValues | string {
  const selected = draft.methods.filter((method) => method.enabled);
  if (draft.mode === 'shipping' && (!selected.length || selected.some((method) => !/^\d+$/.test(method.amount) || !/^\d+$/.test(method.installation)))) {
    return '받을 방식과 0 이상의 원 단위 비용을 입력해주세요.';
  }
  if (draft.mode === 'digital' && !draft.files.length) return '디지털 파일 제공은 확인을 마친 파일을 하나 이상 올려주세요.';
  if (Array.from(draft.evidence.trim()).length < 2) return '수령 방식 설정 근거를 2자 이상 입력해주세요.';
  if (!draft.confirmed) return '수령 방식·금액·파일 제공 조건을 확인했다고 체크해주세요.';
  const methods = draft.mode === 'shipping'
    ? selected.map((method) => ({ method: method.method, feeAmount: method.method === 'parcel' ? null : method.method === 'pickup' ? 0 : Number(method.amount),
      feeBasis: method.method === 'parcel' ? 'per_order' as const : method.basis, installationFee: method.method === 'pickup' ? 0 : Number(method.installation) }))
    : [{ method: draft.mode === 'digital' ? 'digital' as const : 'none' as const, feeAmount: 0, feeBasis: 'per_order' as const, installationFee: 0 }];
  return { mode: draft.mode, methods, assetIds: draft.mode === 'digital' ? draft.files.map((file) => file.id) : [], publicNote: draft.publicNote,
    evidence: draft.evidence, confirmed: true };
}
function productionValues(draft: GoodWorkspaceProductionDraft): ProductionValues | string {
  if (draft.leadDays && !/^[1-9][0-9]*$/.test(draft.leadDays)) return '발송 예정 기간은 1~365일의 정수로 입력해주세요.';
  if (draft.enabled && !draft.leadDays) return '주문제작을 쓰려면 결제 확인 후 발송 예정 기간을 입력해주세요.';
  if (Array.from(draft.evidence.trim()).length < 2) return '주문제작 설정 근거를 2자 이상 입력해주세요.';
  if (!draft.confirmed) return '발송 예정 기간·계산 기준·취소 검토 절차를 확인했다고 체크해주세요.';
  return { enabled: draft.enabled, leadDays: draft.leadDays ? Number(draft.leadDays) : null, dayBasis: draft.dayBasis,
    closedDates: draft.dayBasis === 'calendar' ? [] : draft.closedDates.split(/[\s,]+/).map((date) => date.trim()).filter(Boolean),
    publicNote: draft.publicNote, evidence: draft.evidence, confirmed: true };
}
function sameFulfillment(left: GoodWorkspaceFulfillmentDraft, right: GoodWorkspaceFulfillmentDraft) {
  const shape = (draft: GoodWorkspaceFulfillmentDraft) => JSON.stringify([draft.mode, draft.methods, draft.files.map((file) => file.id), draft.publicNote]);
  return shape(left) === shape(right);
}

/**
 * 화면 상태 → 나머지 설정 제출 JSON. 기본값 그대로인 섹션은 빼고, 채운 섹션은 기존 패널의 저장 전 검사와 같은 규칙으로 확인한다.
 * `canManageCosts`: 매입단가 입력 권한(platform.manage+admin). 없으면 화면이 입력을 그리지 않고, 서버·DB가 다시 막는다.
 */
export function prepareGoodWorkspaceExtraSections(extras: Partial<GoodWorkspaceExtraDraft> | undefined, rows: readonly GoodsOptionRow[],
  { canManageCosts = false }: { canManageCosts?: boolean } = {}): GoodWorkspaceExtraResult {
  const value: GoodWorkspaceExtraSubmission = {};
  if (!extras) return { ok: true, value };
  const rowFor = (optionKey: string) => rows.find((row) => goodsOptionRowKey(row) === optionKey);
  if (extras.optionSaleMode === 'random') value.optionSaleMode = 'random';
  /* 지금 옵션 행에 없는 키는 화면에 칸이 없어 지울 수 없으므로 무시한다(옵션값·구성이 바뀐 뒤 남은 입력). */
  const costs = (extras.purchaseCosts ?? []).filter((entry) => (entry.unitCostKrw.trim() || entry.taxBasis) && rowFor(entry.optionKey));
  if (costs.length) {
    if (!canManageCosts) return fail('purchaseCosts', '공급가(매입단가)는 관리자 계정에서 입력합니다.');
    const entries: NonNullable<GoodWorkspaceExtraSubmission['purchaseCosts']> = [];
    for (const entry of costs) {
      const row = rowFor(entry.optionKey);
      if (!row) return fail('purchaseCosts', '공급가(매입단가)를 입력한 옵션이 옵션목록에 없습니다. 옵션을 확인해주세요.');
      const parsed = parsePurchaseCostInput({ unitCostKrw: entry.unitCostKrw, taxBasis: entry.taxBasis });
      if (!parsed || parsed.unitCostKrw === null) return fail('purchaseCosts', `${row.name.trim() || '옵션'}: 공급가(매입단가) 금액(0원 이상)과 세금 구분을 함께 입력해주세요.`);
      entries.push({ variant: variantRef(row), unitCostKrw: parsed.unitCostKrw, taxBasis: parsed.taxBasis });
    }
    value.purchaseCosts = entries;
  }
  if (extras.pricePeriods?.length) {
    const entries: NonNullable<GoodWorkspaceExtraSubmission['pricePeriods']> = [];
    for (const [index, entry] of extras.pricePeriods.entries()) {
      const label = `기간 할인 ${index + 1}`;
      const row = rowFor(entry.optionKey);
      if (!row) return fail('pricePeriods', `${label}: 대상 옵션을 다시 선택해주세요.`);
      const period = parseGoodsPricePeriodInput({ state: entry.state, discountPrice: entry.discountPrice.trim(), startsAt: entry.startsAt, endsAt: entry.endsAt });
      if (!period) return fail('pricePeriods', `${label}: 할인가(1원 이상)와 KST 기준 시작·종료를 확인해주세요. 활성에는 모든 값이 필요합니다.`);
      entries.push({ variant: variantRef(row), period });
    }
    value.pricePeriods = entries;
  }
  if (extras.additional?.length) {
    const ids = parseAdditionalGoodIds(extras.additional.map((item) => item.goodId));
    if (!ids) return fail('additional', adminGoodsCopy(`추가 구성 상품은 서로 다른 상품 ${MAX_ADDITIONAL_GOODS}개까지 연결할 수 있습니다.`));
    value.additional = ids;
  }
  const benefits = extras.benefits;
  if (benefits && (benefits.eventText.trim() || benefits.giftText.trim() || benefits.giftImagePaths.some(Boolean))) {
    const parsed = parseGoodsBenefitValues({ ...benefits, giftImagePaths: benefits.giftImagePaths.filter(Boolean) });
    if (!parsed) return fail('benefits', '사은품 사진에는 설명이 필요합니다. 설명 100자·이벤트 40자와 서로 다른 사진 3장까지 확인해주세요.');
    value.benefits = parsed;
  }
  const afterSales = extras.afterSales;
  if (afterSales && (afterSales.phone.trim() || afterSales.guide.trim() || afterSales.sellerSpecialNotes.trim())) {
    const parsed = parseGoodsAfterSalesValues(afterSales, false);
    if (!parsed) return fail('afterSales', 'A/S 전화번호와 A/S 안내를 입력하고 글자 수를 확인해주세요. 입력하지 않으려면 세 칸을 모두 비워주세요.');
    value.afterSales = parsed;
  }
  const sizeChart = extras.sizeChart;
  if (sizeChart && (sizeChart.enabled || sizeChart.chart.sizes.length || sizeChart.chart.measurements.length)) {
    const parsed = parseGoodsSizeChartValues(sizeChart);
    if (!parsed) return fail('sizeChart', goodsSizeChartError());
    value.sizeChart = parsed;
  }
  if (extras.listingColors?.length) {
    const parsed = parseGoodsColorChips(extras.listingColors.map((chip) => ({ label: chip.label.trim(), hex: chip.hex.toLowerCase() })));
    if (!parsed) return fail('listingColors', '서로 다른 색상 이름(1~30자)과 6자리 색상값을 최대 20개까지 입력해주세요.');
    value.listingColors = parsed;
  }
  if (extras.transactionTerms) {
    const empty = emptyGoodWorkspaceTerms(), terms: NonNullable<GoodWorkspaceExtraSubmission['transactionTerms']> = {};
    for (const kind of ['volume', 'delivery'] as const) {
      const changed = !sameGoodsTerms({ ...empty, [kind]: extras.transactionTerms[kind] }, empty);
      if (!changed) continue;
      const prepared = prepareGoodsTermsInput(kind, extras.transactionTerms);
      if (!prepared.ok) return fail('transactionTerms', prepared.error);
      if (kind === 'volume') terms.volume = prepared.value as VolumeTermsInput; else terms.delivery = prepared.value as DeliveryTermsInput;
    }
    if (terms.volume || terms.delivery) value.transactionTerms = terms;
  }
  if (extras.shippingChargeGroup) value.shippingChargeGroup = { groupId: extras.shippingChargeGroup.id, expectedRevision: extras.shippingChargeGroup.revision };
  const subscription = extras.subscriptionPolicy;
  if (subscription && (subscription.enabled || subscription.intervals.length || subscription.message.trim())) {
    if (!subscription.intervals.length) return fail('subscriptionPolicy', '정기배송 주기를 하나 이상 선택해주세요.');
    const parsed = parseGoodsSubscriptionDraft({ ...subscription, message: subscription.message.trim() });
    if (!parsed) return fail('subscriptionPolicy', goodsSubscriptionPolicyError());
    value.subscriptionPolicy = parsed;
  }
  if (extras.fulfillment && !sameFulfillment(extras.fulfillment, emptyGoodWorkspaceFulfillment())) {
    const values = fulfillmentValues(extras.fulfillment);
    if (typeof values === 'string') return fail('fulfillment', values);
    value.fulfillment = values;
  }
  const production = extras.production;
  /* 사용을 끈 주문제작은 새 상품에 아무 설정도 만들지 않는다. 켰다 끄며 남은 기간·안내·확인 체크는 저장 대상이 아니다. */
  if (production && production.enabled) {
    const values = productionValues(production);
    if (typeof values === 'string') return fail('production', values);
    value.production = values;
  }
  return { ok: true, value };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseRef(value: unknown): VariantRef | null {
  if (!record(value) || Object.keys(value).length !== 1) return null;
  if (Object.hasOwn(value, 'id')) return isUuid(value.id) ? { id: (value.id as string).toLowerCase() } : null;
  const attributes = value.attributes;
  if (!record(attributes) || Object.keys(attributes).length > 3
    || Object.entries(attributes).some(([key, text]) => !key.trim() || key.length > 40 || typeof text !== 'string' || !text.trim() || text.length > 80)) return null;
  return { attributes: attributes as Record<string, string> };
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/**
 * 서버 액션: 제출 JSON의 나머지 설정을 RPC sections로 다시 확인한다. 형식이 틀린 섹션은 그 섹션 오류로 돌려준다.
 * 매입단가는 관리자(platform.manage+admin)만 실을 수 있다(DB가 다시 막는다).
 */
export function parseGoodWorkspaceExtraSections(raw: Record<string, unknown>, { canManageCosts = false }: { canManageCosts?: boolean } = {}): GoodWorkspaceExtraResult {
  const value: GoodWorkspaceExtraSubmission = {};
  const invalid = (key: GoodWorkspaceExtraKey) => fail(key, '입력 형식을 확인하지 못했습니다. 새로고침한 뒤 다시 입력해주세요.');
  if (raw.optionSaleMode !== undefined) {
    if (raw.optionSaleMode !== 'random') return invalid('optionSaleMode');
    value.optionSaleMode = 'random';
  }
  if (raw.purchaseCosts !== undefined) {
    if (!Array.isArray(raw.purchaseCosts) || raw.purchaseCosts.length > 100) return invalid('purchaseCosts');
    if (raw.purchaseCosts.length && !canManageCosts) return fail('purchaseCosts', '공급가(매입단가)는 관리자 계정에서 입력합니다.');
    const entries: NonNullable<GoodWorkspaceExtraSubmission['purchaseCosts']> = [];
    for (const entry of raw.purchaseCosts) {
      const variant = record(entry) && exactKeys(entry, ['variant', 'unitCostKrw', 'taxBasis']) ? parseRef(entry.variant) : null;
      const cost = record(entry) ? parsePurchaseCostInput({ unitCostKrw: entry.unitCostKrw, taxBasis: entry.taxBasis }) : null;
      if (!variant || !cost || cost.unitCostKrw === null) return invalid('purchaseCosts');
      entries.push({ variant, unitCostKrw: cost.unitCostKrw, taxBasis: cost.taxBasis });
    }
    if (entries.length) value.purchaseCosts = entries;
  }
  if (raw.pricePeriods !== undefined) {
    if (!Array.isArray(raw.pricePeriods) || raw.pricePeriods.length > 100) return invalid('pricePeriods');
    const entries: NonNullable<GoodWorkspaceExtraSubmission['pricePeriods']> = [];
    for (const entry of raw.pricePeriods) {
      const variant = record(entry) && exactKeys(entry, ['variant', 'period']) ? parseRef(entry.variant) : null;
      const period = record(entry) ? parseGoodsPricePeriodInput(entry.period) : null;
      if (!variant || !period || period.state === 'disabled') return invalid('pricePeriods');
      entries.push({ variant, period });
    }
    if (entries.length) value.pricePeriods = entries;
  }
  if (raw.additional !== undefined) {
    const ids = parseAdditionalGoodIds(raw.additional);
    if (!ids) return invalid('additional');
    if (ids.length) value.additional = ids;
  }
  if (raw.benefits !== undefined) {
    const parsed = parseGoodsBenefitValues(raw.benefits);
    if (!parsed) return invalid('benefits');
    value.benefits = parsed;
  }
  if (raw.afterSales !== undefined) {
    const parsed = parseGoodsAfterSalesValues(raw.afterSales, false);
    if (!parsed) return invalid('afterSales');
    value.afterSales = parsed;
  }
  if (raw.sizeChart !== undefined) {
    const parsed = parseGoodsSizeChartValues(raw.sizeChart);
    if (!parsed) return invalid('sizeChart');
    value.sizeChart = parsed;
  }
  if (raw.listingColors !== undefined) {
    const parsed = parseGoodsColorChips(raw.listingColors);
    if (!parsed) return invalid('listingColors');
    if (parsed.length) value.listingColors = parsed;
  }
  if (raw.transactionTerms !== undefined) {
    const terms = raw.transactionTerms;
    if (!record(terms) || Object.keys(terms).some((key) => key !== 'volume' && key !== 'delivery')) return invalid('transactionTerms');
    const prepared: NonNullable<GoodWorkspaceExtraSubmission['transactionTerms']> = {};
    if (terms.volume !== undefined) {
      /* 할인 입력은 기존 요청 파서(parseGoodsTermsRequest)의 볼륨 검사와 같은 모양이다. 상세 규칙은 DB가 다시 본다. */
      const volume = terms.volume;
      if (!record(volume) || !exactKeys(volume, ['status', 'terms', 'draftValues']) || !['draft', 'active', 'disabled'].includes(String(volume.status))
        || (volume.status === 'active' && volume.terms === null) || !record(volume.draftValues)) return invalid('transactionTerms');
      prepared.volume = volume as unknown as VolumeTermsInput;
    }
    if (terms.delivery !== undefined) {
      const delivery = parseGoodsDeliveryTermsInput(terms.delivery);
      if (!delivery) return invalid('transactionTerms');
      prepared.delivery = delivery;
    }
    if (prepared.volume || prepared.delivery) value.transactionTerms = prepared;
  }
  if (raw.shippingChargeGroup !== undefined) {
    const group = raw.shippingChargeGroup;
    if (!record(group) || !exactKeys(group, ['groupId', 'expectedRevision']) || !isUuid(group.groupId)
      || typeof group.expectedRevision !== 'number' || !Number.isSafeInteger(group.expectedRevision) || group.expectedRevision < 1 || group.expectedRevision > 2147483647) {
      return invalid('shippingChargeGroup');
    }
    value.shippingChargeGroup = { groupId: (group.groupId as string).toLowerCase(), expectedRevision: group.expectedRevision };
  }
  if (raw.subscriptionPolicy !== undefined) {
    const parsed = parseGoodsSubscriptionDraft(raw.subscriptionPolicy);
    if (!parsed || !parsed.intervals.length || parsed.message !== parsed.message.trim()) return invalid('subscriptionPolicy');
    value.subscriptionPolicy = parsed;
  }
  if (raw.fulfillment !== undefined) {
    const values = raw.fulfillment;
    if (!record(values) || !exactKeys(values, ['mode', 'methods', 'assetIds', 'publicNote', 'evidence', 'confirmed']) || values.confirmed !== true
      || !['shipping', 'no_delivery', 'digital'].includes(String(values.mode)) || !Array.isArray(values.methods) || values.methods.length < 1 || values.methods.length > 5
      || !Array.isArray(values.assetIds) || values.assetIds.length > 10 || values.assetIds.some((id) => !isUuid(id))
      || typeof values.publicNote !== 'string' || typeof values.evidence !== 'string') return invalid('fulfillment');
    value.fulfillment = values as unknown as FulfillmentValues;
  }
  if (raw.production !== undefined) {
    const values = raw.production;
    if (!record(values) || !exactKeys(values, ['enabled', 'leadDays', 'dayBasis', 'closedDates', 'publicNote', 'evidence', 'confirmed']) || values.confirmed !== true
      || typeof values.enabled !== 'boolean' || !['calendar', 'business'].includes(String(values.dayBasis)) || !Array.isArray(values.closedDates)
      || typeof values.publicNote !== 'string' || typeof values.evidence !== 'string') return invalid('production');
    value.production = values as unknown as ProductionValues;
  }
  return { ok: true, value };
}

const SECTION_FAILURE = /goods_workspace_section_failed:([A-Za-z]+):([\s\S]*)$/;
function pricePeriodError(message: string) {
  if (message.includes('variant_unresolved') || message.includes('invalid_goods_workspace_price_period_variant')) return '할인 대상 옵션을 저장된 옵션목록에서 찾지 못했습니다. 대상 옵션을 다시 선택해주세요.';
  if (RANDOM_OPTION_PROBLEMS.some((code) => message.includes(code))) return goodsOptionSaleModeErrorMessage(message);
  const messages: Record<string, string> = {
    price_period_overlap: '같은 옵션에 시간이 겹치는 활성 기간 할인이 있습니다.',
    price_period_not_configured: '할인가와 시작·종료 시각을 모두 입력한 뒤 활성화해주세요.',
    instant_discount_period_conflict: '기간 없는 즉시할인을 건 상품에는 기간 할인을 함께 걸 수 없습니다. 판매가의 즉시할인을 \'특정기간만 할인\'으로 바꾸거나 설정안함으로 바꿔주세요.',
    price_period_variant_inactive: '사용 중지한 옵션에는 기간 할인을 활성화할 수 없습니다.',
  };
  return Object.entries(messages).find(([code]) => message.includes(code))?.[1] ?? '기간 할인을 저장하지 못했습니다. 할인가가 옵션 판매가보다 낮은지 확인해주세요.';
}
function shippingChargeGroupError(message: string) {
  if (message.includes('shipping_charge_group_changed')) return '고른 묶음그룹이 그 사이 바뀌었습니다. 묶음그룹을 다시 골라주세요.';
  if (message.includes('origin')) return '묶음그룹의 출고지와 이 상품의 출고지가 같아야 합니다. 출고지 또는 묶음그룹을 다시 확인해주세요.';
  if (message.includes('checkout_contract') || message.includes('runtime')) return '현재 상품 거래 경로에서 묶음배송을 적용할 수 없습니다. 운영 설정을 확인해주세요.';
  if (message.includes('insufficient_privilege') || message.includes('operator_capability')) return '현재 계정과 로그인 상태로 묶음그룹을 배정할 수 없습니다. 화면을 다시 열어주세요.';
  return '묶음그룹을 배정하지 못했습니다. 묶음그룹과 출고지를 다시 확인해주세요.';
}
function additionalError(message: string) {
  if (message.includes('additional_good_unavailable')) return '판매 중이 아닌 상품은 추가 구성으로 연결할 수 없습니다. 연결할 상품을 다시 확인해주세요.';
  if (message.includes('cycle')) return '서로를 추가 구성으로 연결할 수 없습니다. 연결할 상품을 다시 확인해주세요.';
  return adminGoodsCopy('추가 구성 상품을 저장하지 못했습니다. 연결할 상품을 다시 확인해주세요.');
}

/** admin_save_good_workspace의 섹션 실패('goods_workspace_section_failed:<섹션>:<원래 오류>') → 그 섹션 칸 안내. 아니면 null. */
export function goodWorkspaceExtraSectionFailure(message: string, code?: string): Partial<Record<GoodWorkspaceExtraErrorField, string>> | null {
  const matched = SECTION_FAILURE.exec(message);
  if (!matched || !(GOOD_WORKSPACE_EXTRA_KEYS as readonly string[]).includes(matched[1])) return null;
  const key = matched[1] as GoodWorkspaceExtraKey, inner = matched[2].trim();
  const permission = /operator_capability_required|purchase_cost_admin_required|insufficient_privilege|42501/.test(inner) || code === '42501';
  const reason: Record<GoodWorkspaceExtraKey, () => string> = {
    optionSaleMode: () => goodsOptionSaleModeErrorMessage(inner),
    purchaseCosts: () => permission ? '공급가(매입단가)는 관리자 계정에서 입력합니다.' : inner.includes('variant_unresolved')
      ? '공급가(매입단가)를 입력한 옵션을 저장된 옵션목록에서 찾지 못했습니다. 옵션을 확인해주세요.' : '공급가(매입단가) 금액과 세금 구분을 함께 입력해주세요.',
    pricePeriods: () => pricePeriodError(inner),
    additional: () => additionalError(inner),
    benefits: () => goodsBenefitsError(inner),
    afterSales: () => goodsAfterSalesError(inner),
    sizeChart: () => goodsSizeChartError(inner),
    listingColors: () => '서로 다른 색상 이름(1~30자)과 6자리 색상값을 최대 20개까지 입력해주세요.',
    transactionTerms: () => permission ? '현재 계정과 상품관리 권한을 확인해주세요.' : inner.includes('runtime')
      ? '현재 상품 거래 경로에서 복수구매 할인·확장 배송비를 적용할 수 없습니다. 운영 설정을 확인해주세요.'
      : inner.includes('collect') ? '착불은 출고지의 수납 주체·방법·증빙·분쟁 연락처가 준비되어야 사용할 수 있습니다.'
      : '복수구매 할인·착불·수량별 배송비 입력을 확인해주세요.',
    shippingChargeGroup: () => shippingChargeGroupError(inner),
    subscriptionPolicy: () => goodsSubscriptionPolicyError(inner),
    fulfillment: () => fulfillmentError(code, inner.replace(/^ERROR:\s*/, '')),
    production: () => productionError(code, inner.replace(/^ERROR:\s*/, '')),
  };
  return { [SECTION_FIELD[key]]: `${reason[key]()} 상품은 저장되지 않았고 입력은 유지됩니다.` };
}
