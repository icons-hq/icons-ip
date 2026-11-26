import { krwAmountWords } from '@/lib/format';
import type { AdminConfirmRequest } from './confirm';

export const FULFILLMENT_ORIGINS_PATH = '/admin/settings/origins';
export const DEFAULT_FULFILLMENT_ORIGIN_ID = '00000000-0000-4000-8000-000000042201';
export interface FulfillmentOrigin {
  id: string; code: string; name: string; defaultCarrier: string | null; baseFee: number;
  freeThreshold: number | null; returnAddress: string; cutoff: string | null;
  exportColumns?: import('./shipment-workbook').ShipmentExportColumn[];
  exportTemplate: 'standard' | 'wms_csv' | 'seowon_xlsx'; active: boolean; updatedAt: string;
}
/** Fields used to select an origin and preview customer shipping information. */
export type GoodsFulfillmentOrigin = Pick<FulfillmentOrigin, 'id' | 'name' | 'defaultCarrier' | 'baseFee' | 'freeThreshold' | 'returnAddress' | 'active'>;

/** 출고지 저장 폼의 칸 이름. 값은 모두 글자로 다룬다(폼이 제출하는 그대로). */
export type FulfillmentOriginFormField = 'code' | 'name' | 'defaultCarrier' | 'baseFee' | 'freeThreshold' | 'returnAddress' | 'cutoff' | 'exportTemplate' | 'active';
export type FulfillmentOriginFormValues = Record<FulfillmentOriginFormField, string>;

/** 폼 칸의 처음 값. 출고지가 없으면 새로 만드는 폼의 값이다. */
export function fulfillmentOriginFormValues(origin?: FulfillmentOrigin): FulfillmentOriginFormValues {
  return {
    code: origin?.code ?? '', name: origin?.name ?? '', defaultCarrier: origin?.defaultCarrier ?? '',
    baseFee: origin ? String(origin.baseFee) : '', freeThreshold: origin?.freeThreshold == null ? '' : String(origin.freeThreshold),
    returnAddress: origin?.returnAddress ?? '', cutoff: origin?.cutoff ?? '', exportTemplate: origin?.exportTemplate ?? 'standard', active: String(origin?.active ?? false),
  };
}

/** 칸 이름 — 화면의 칸 이름과 같은 말이다(바뀐 항목을 말할 때 쓴다). */
export const FULFILLMENT_ORIGIN_FIELD_LABELS: Record<FulfillmentOriginFormField, string> = {
  code: '출고지 코드', name: '출고지 이름', defaultCarrier: '기본 택배사', baseFee: '기본 배송비', freeThreshold: '무료 배송 기준',
  returnAddress: '반품 주소', cutoff: '출고 마감 시각', exportTemplate: '기존 창고 출고지시 양식', active: '사용 여부',
};

/** 두 값 사이에서 달라진 칸의 이름. 금액은 숫자로 같으면 같은 값이다(`03000`과 `3000`). */
export function changedFulfillmentOriginFields(before: FulfillmentOriginFormValues, after: FulfillmentOriginFormValues): string[] {
  const same = (field: FulfillmentOriginFormField) => field === 'baseFee' || field === 'freeThreshold'
    ? before[field].trim() === after[field].trim() || (wonOf(before[field]) === wonOf(after[field]) && wonOf(before[field]) !== null)
    : before[field] === after[field];
  return (Object.keys(FULFILLMENT_ORIGIN_FIELD_LABELS) as FulfillmentOriginFormField[]).filter(field => !same(field)).map(field => FULFILLMENT_ORIGIN_FIELD_LABELS[field]);
}

/**
 * 저장하려는 사이에 다른 사람이 먼저 바꿨을 때 그 사람이 저장한 지금 내용. 내 입력으로 덮어쓰려면 이 `updatedAt`으로 다시 저장한다.
 * 서버 액션이 돌려주고, 폼이 '내 입력으로 덮어쓰기'·'내 입력 버리기' 두 길로 쓴다.
 */
export interface FulfillmentOriginConflict { updatedAt: string; values: FulfillmentOriginFormValues }

/* ---- 저장 전에 알리는 영향(읽기 전용 조회 결과: lib/admin/shipping-impact.server.ts) ---- */

/** 출고지 하나가 새 주문을 받지 못하게 될 때 영향받는 상품. 게시 상태가 '공개'인 상품만 센다. */
export interface OriginGoodsImpact {
  publicGoods: number;
  /** 그 가운데 배송비 유형이 '출고지 정책 따름'인 상품. 출고지의 기본 배송비·무료 배송 기준이 그대로 적용된다. */
  policyFeeGoods: number;
}
/**
 * 출고지의 지역별 추가배송비 사용 여부. 쓰기 시작한 출고지는 기본 택배사와 같은 택배사로 정한 지역별 추가배송비가 적용 중이어야 새 주문을 받는다
 * (`private.apply_shipping_region_quote`: 기본 택배사로 적용 중인 설정이 없으면 새 주문이 막힌다).
 */
export interface OriginRegionalFeeUse {
  /** 지역별 추가배송비를 쓰기 시작했다(도입 시각이 지났다). 쓰지 않는 출고지는 택배사를 바꿔도 주문이 막히지 않는다. */
  managed: boolean;
  /** 지금 새 주문에 적용 중인 택배사 코드(활성·적용 기간 안). */
  inEffectCarrierCodes: string[];
  /** 활성으로 정했지만 적용 시작 전인 택배사 코드. */
  scheduledCarrierCodes: string[];
}
/**
 * 이 출고지에서 '이 묶음그룹의 지역표로 정하기'를 쓰는 '사용' 묶음그룹 가운데 지금 적용 기간 안인 것을 지역표의 택배사별로 센 값.
 * 주문 견적(`private.calculate_shipping_charge_group_shipping`)은 이런 묶음그룹의 지역표 택배사가 출고지의 기본 택배사와 다르면
 * 그 묶음그룹 상품의 새 주문을 막는다.
 */
export interface OriginChargeGroupUse {
  /** 묶음그룹 지역표의 택배사 코드. */
  carrierCode: string;
  /** 그 택배사로 지역표를 정한 묶음그룹 수. */
  groups: number;
  /** 그 묶음그룹들에 넣은 상품 수(묶음그룹마다 넣은 상품의 합). */
  goods: number;
}
/**
 * 저장 전에 알릴 영향. 읽지 못한 것은 null이다(화면은 모른다고 말하고 안전하다고 하지 않는다).
 * `chargeGroups`는 읽지 않은 화면에서는 없다(그때는 묶음그룹에 대해 말하지 않는다).
 */
export interface OriginSaveImpact { goods: OriginGoodsImpact | null; regionalFee: OriginRegionalFeeUse | null; chargeGroups?: OriginChargeGroupUse[] | null }

/** 금액 칸의 글을 숫자로. 비었으면 null, 0 이상의 정수가 아니면 NaN. */
function wonOf(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) && Number.isSafeInteger(Number(trimmed)) ? Number(trimmed) : Number.NaN;
}

/**
 * 기본 배송비·무료 배송 기준을 한 줄로 되읽는다('글보다 화면' 3). 계산식은 `private.calculate_goods_shipping`과 같다:
 * 기준이 비면 늘 받고, 0이면 늘 무료이며, 기준 이상이면 무료다. 기준 금액은 '출고지 정책 따름' 상품만 더한 값(쿠폰·적립금 전)이다.
 * 금액이 비었거나 숫자가 아니면 말하지 않는다.
 */
export function originFeeReadback(input: { baseFee: string; freeThreshold: string }): string | null {
  const base = wonOf(input.baseFee), threshold = wonOf(input.freeThreshold);
  if (base === null || Number.isNaN(base) || Number.isNaN(threshold)) return null;
  const subject = "'출고지 정책 따름' 상품은";
  if (base === 0 || threshold === 0) return `${subject} 배송비를 받지 않습니다.`;
  if (threshold === null) return `${subject} 금액과 관계없이 주문마다 배송비 ${krwAmountWords(base)}을 받습니다.`;
  return `${subject} 주문마다 배송비 ${krwAmountWords(base)}을 받고, 상품 금액이 ${krwAmountWords(threshold)} 이상이면 무료입니다(쿠폰·적립금을 쓰기 전 금액).`;
}

export interface OriginCarrierChangeWarning {
  title: string; body: string;
  /** true면 새 주문이 막히는 것이 확실하다. false는 지역별 추가배송비를 읽지 못해 확인하지 못한 경우다. */
  certain: boolean;
}
/**
 * 기본 택배사를 바꾸면 이 출고지의 새 주문이 막히는가. 지역별 추가배송비를 쓰는 출고지는 새 택배사로 정한 설정이 적용 중이어야 주문을 받는다.
 * 다음 경우에는 알릴 것이 없어 null이다: 출고지가 새 주문을 받지 않을 때, 택배사가 그대로일 때, 지역별 추가배송비를 쓰지 않을 때,
 * 새 택배사로 정한 설정이 이미 적용 중일 때, 지금도 현재 택배사로 정한 설정이 적용 중이지 않아 이미 막혀 있을 때(바꿔도 달라지는 것이 없다).
 * 지역별 추가배송비를 읽지 못했으면(`regionalFee: null`) 막히는지 모른다고 말한다.
 */
export function originCarrierChangeWarning(input: {
  from: string; to: string; active: boolean; regionalFee: OriginRegionalFeeUse | null; label: (carrierCode: string) => string;
}): OriginCarrierChangeWarning | null {
  const { from, to, active, regionalFee, label } = input;
  if (!active || !to || from === to) return null;
  if (!regionalFee) {
    return { certain: false, title: '새 주문이 막히는지 확인하지 못했습니다',
      body: '지역별 추가배송비를 읽지 못했습니다. 이 출고지가 지역별 추가배송비를 쓰면 택배사를 바꾼 뒤 새 주문이 막힐 수 있으니, 저장하기 전에 지역별 추가배송비 화면에서 확인해 주세요.' };
  }
  if (!regionalFee.managed || regionalFee.inEffectCarrierCodes.includes(to) || !from || !regionalFee.inEffectCarrierCodes.includes(from)) return null;
  return { certain: true, title: '바꾸면 이 출고지의 새 주문이 막힙니다',
    body: regionalFee.scheduledCarrierCodes.includes(to)
      ? `${label(to)} 기준 지역별 추가배송비는 아직 적용 시작 전이라, 시작할 때까지 이 출고지의 새 주문이 막힙니다.`
      : `지역별 추가배송비가 ${label(from)} 기준으로 정해져 있어 ${label(to)}에는 적용되지 않습니다. 바꾼 뒤 지역별 추가배송비에서 ${label(to)} 기준으로 만들어 적용하면 새 주문을 다시 받습니다.` };
}

/**
 * 기본 택배사를 바꾸면 자체 지역표를 쓰는 묶음그룹 상품의 새 주문이 막히는가. 그런 '사용' 묶음그룹은 지역표의 택배사가 출고지의 기본 택배사와 같아야 주문을 받는다.
 * 지금 기본 택배사(`from`)로 지역표를 정한 묶음그룹이 있으면 바꾸는 순간 그 묶음그룹 상품의 새 주문이 막힌다 — 묶음그룹의 [수정]에서 지역표의 택배사를 맞출 때까지다.
 * 다음 경우에는 알릴 것이 없어 null이다: 출고지가 새 주문을 받지 않을 때, 택배사가 그대로일 때, 묶음그룹을 읽지 않은 화면(`undefined`),
 * 지금 기본 택배사로 지역표를 정한 묶음그룹이 없을 때(이미 막혀 있거나 영향받는 묶음그룹이 없다).
 * 묶음그룹을 읽지 못했으면(`null`) 막히는지 모른다고 말한다.
 */
export function originCarrierChangeGroupWarning(input: {
  from: string; to: string; active: boolean; chargeGroups: OriginChargeGroupUse[] | null | undefined; label: (carrierCode: string) => string;
}): OriginCarrierChangeWarning | null {
  const { from, to, active, chargeGroups, label } = input;
  if (!active || !to || from === to || chargeGroups === undefined) return null;
  if (chargeGroups === null) {
    return { certain: false, title: '묶음그룹 상품의 새 주문이 막히는지 확인하지 못했습니다',
      body: '배송비 묶음그룹을 읽지 못했습니다. 이 출고지에 자체 지역표를 쓰는 묶음그룹이 있으면 택배사를 바꾼 뒤 그 묶음그룹 상품의 새 주문이 막힐 수 있으니, 저장하기 전에 배송비 묶음그룹 목록에서 확인해 주세요.' };
  }
  const affected = from ? chargeGroups.find(use => use.carrierCode === from && use.groups > 0) : undefined;
  if (!affected) return null;
  return { certain: true, title: '바꾸면 묶음그룹 상품의 새 주문이 막힙니다',
    body: `자체 지역표를 쓰는 묶음그룹 ${affected.groups.toLocaleString('ko-KR')}개(넣은 상품 ${affected.goods.toLocaleString('ko-KR')}개)는 지역표가 ${label(from)} 기준이라 ${label(to)}에는 맞지 않습니다. `
      + `배송비 묶음그룹 목록의 [수정]에서 지역표의 택배사를 ${label(to)} 기준으로 맞출 때까지 그 묶음그룹 상품의 새 주문이 막힙니다.` };
}

/** 출고지를 사용 안 함으로 바꿀 때 영향받는 상품 한 줄. 상품은 고객에게 계속 보이고 새 주문만 막힌다(`goods_public_read`는 출고지를 보지 않는다). */
export function originDeactivateGoodsLine(goods: OriginGoodsImpact | null | undefined): string {
  if (!goods) return '이 출고지의 공개 상품은 고객에게 계속 보이지만 새 주문은 받을 수 없습니다.';
  if (goods.publicGoods === 0) return '이 출고지의 공개 상품이 없어 지금 막히는 주문은 없습니다.';
  return `공개 상품 ${goods.publicGoods.toLocaleString('ko-KR')}개는 고객에게 계속 보이지만 새 주문은 받을 수 없습니다.`;
}

/**
 * 사용 안 함으로 바꾼 뒤에도 이미 들어온 주문에 남는 제한. 배송비는 주문에 저장돼 그대로다. 기존 창고 양식(김포 WMS·서원)의 운송장 회신 올리기와
 * 택배가 아닌 방식으로 바꾸기·발송처리는 사용 중인 출고지만 받는다(`admin_import_*_tracking_batch`, `admin_select_shipment_delivery_method`,
 * `admin_dispatch_apply_delivery`). 표준 양식의 운송장 회신은 출고지 사용 여부를 보지 않는다.
 */
export function originDeactivateRestrictionLine(exportTemplate: string): string {
  const rest = exportTemplate === 'standard'
    ? '택배가 아닌 배송 방식으로 바꿀 수 없습니다'
    : '기존 창고 양식으로 운송장 회신을 올릴 수 없고, 택배가 아닌 배송 방식으로도 바꿀 수 없습니다';
  return `이미 들어온 주문의 배송비는 그대로입니다. 다만 다시 '사용'으로 바꾸기 전까지 이 출고지 주문은 ${rest}.`;
}

type SaveConfirmValues = Pick<FulfillmentOriginFormValues, 'active' | 'defaultCarrier' | 'baseFee' | 'freeThreshold'>;
/**
 * 저장 전에 한 번 묻는 확인창. 새 주문을 막거나 돈이 바뀌는 저장에만 둔다 — 출고지를 사용 안 함으로 바꿀 때(영향받는 공개 상품 수),
 * 사용 중인 출고지의 기본 택배사를 바꿔 새 주문이 막힐 때(지역별 추가배송비 또는 자체 지역표를 쓰는 묶음그룹 상품), 사용 중인 출고지의 기본 배송비·무료 배송 기준을 바꿀 때.
 * `before`는 지금 저장돼 있는 값(다른 사람이 먼저 바꿨다면 그 사람이 저장한 값), `after`는 저장하려는 값이다. 묻지 않을 저장이면 null.
 */
export function fulfillmentOriginSaveConfirm(input: {
  name: string; before: SaveConfirmValues; after: SaveConfirmValues & { exportTemplate: string };
  impact?: OriginSaveImpact; label: (carrierCode: string) => string;
}): AdminConfirmRequest | null {
  const { name, before, after, impact, label } = input;
  const wasActive = before.active === 'true', willBeActive = after.active === 'true';
  const sections: { kind: 'deactivate' | 'carrier' | 'fee'; text: string }[] = [];
  if (wasActive && !willBeActive) {
    sections.push({ kind: 'deactivate', text: ['사용 여부: 사용 → 사용 안 함', originDeactivateGoodsLine(impact?.goods), originDeactivateRestrictionLine(after.exportTemplate)].join('\n') });
  }
  if (willBeActive) {
    /* 영향을 읽어 오지 않은 화면(새 출고지·읽기 전용)은 알릴 것이 없다. */
    const warning = impact ? originCarrierChangeWarning({ from: before.defaultCarrier, to: after.defaultCarrier, active: true, regionalFee: impact.regionalFee, label }) : null;
    const groupWarning = impact ? originCarrierChangeGroupWarning({ from: before.defaultCarrier, to: after.defaultCarrier, active: true, chargeGroups: impact.chargeGroups, label }) : null;
    if (warning || groupWarning) {
      sections.push({ kind: 'carrier', text: [`기본 택배사: ${label(before.defaultCarrier)} → ${label(after.defaultCarrier)}`, warning?.body, groupWarning?.body].filter(Boolean).join('\n') });
    }
    if (wasActive) {
      const oldBase = wonOf(before.baseFee), newBase = wonOf(after.baseFee), oldThreshold = wonOf(before.freeThreshold), newThreshold = wonOf(after.freeThreshold);
      const valid = oldBase !== null && newBase !== null && !Number.isNaN(oldBase) && !Number.isNaN(newBase) && !Number.isNaN(oldThreshold) && !Number.isNaN(newThreshold);
      if (valid && (oldBase !== newBase || oldThreshold !== newThreshold)) {
        const threshold = (value: number | null) => value === null ? '없음' : krwAmountWords(value);
        const lines = [
          ...(oldBase !== newBase ? [`기본 배송비 ${krwAmountWords(oldBase)} → ${krwAmountWords(newBase)}`] : []),
          ...(oldThreshold !== newThreshold ? [`무료 배송 기준 ${threshold(oldThreshold)} → ${threshold(newThreshold)}`] : []),
          ...(impact?.goods ? [`'출고지 정책 따름' 공개 상품 ${impact.goods.policyFeeGoods.toLocaleString('ko-KR')}개`] : []),
        ];
        sections.push({ kind: 'fee', text: `${lines.join('\n')}\n\n지금부터 새 주문에 적용됩니다. 이미 들어온 주문의 배송비는 그대로입니다.` });
      }
    }
  }
  if (!sections.length) return null;
  const only = sections.length === 1 ? sections[0].kind : null;
  const title = only === 'deactivate' ? `${name} 출고지를 사용 안 함으로 바꿀까요?`
    : only === 'carrier' ? `${name} 기본 택배사를 바꿀까요?` : only === 'fee' ? `${name} 배송비를 바꿀까요?` : `${name} 출고지 설정을 바꿀까요?`;
  const confirmLabel = only === 'deactivate' ? '사용 안 함으로 바꾸기' : only === 'carrier' ? '택배사 바꾸기' : only === 'fee' ? '배송비 바꾸기' : '이대로 저장';
  return { title, confirmLabel, cancelLabel: '돌아가기', message: sections.map(section => section.text).join('\n\n') };
}

export function parseFulfillmentOriginInput(input: Record<string, string>) {
  const value = {
    code: (input.code ?? '').trim(), name: (input.name ?? '').trim(), default_carrier: input.defaultCarrier || null,
    base_fee: Number(input.baseFee), free_threshold: input.freeThreshold?.trim() ? Number(input.freeThreshold) : null,
    return_address: (input.returnAddress ?? '').trim(), cutoff: input.cutoff || null,
    export_template: input.exportTemplate, is_active: input.active === 'true',
  };
  const errors: Record<string, string> = {};
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(value.code)) errors.code = '출고지 코드는 영문 소문자로 시작하는 영문·숫자·하이픈 2~40자로 적어 주세요. 예: gimpo';
  if (!value.name || value.name.length > 80) errors.name = '출고지 이름을 80자 이내로 입력해주세요.';
  if (!input.baseFee?.trim() || !Number.isSafeInteger(value.base_fee) || value.base_fee < 0 || value.base_fee > 1000000) errors.baseFee = '기본 배송비는 0~1,000,000원 사이의 정수입니다.';
  if (value.free_threshold !== null && (!Number.isSafeInteger(value.free_threshold) || value.free_threshold < 0 || value.free_threshold > 100000000)) errors.freeThreshold = '무료 배송 기준은 0~100,000,000원 사이로 입력하거나 비워 주세요.';
  if (value.return_address.length > 500 || /[\u0000-\u001f\u007f]/.test(value.return_address)) errors.returnAddress = '반품 주소는 500자 이내의 한 줄입니다.';
  if (value.cutoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.cutoff)) errors.cutoff = '출고 마감 시각을 확인해주세요.';
  if (!['standard', 'wms_csv', 'seowon_xlsx'].includes(value.export_template)) errors.exportTemplate = '내보내기 양식을 선택해주세요.';
  if (value.is_active && !value.default_carrier) errors.defaultCarrier = '사용으로 저장하려면 기본 택배사를 골라 주세요.';
  return Object.keys(errors).length ? { ok: false as const, errors } : { ok: true as const, value };
}
