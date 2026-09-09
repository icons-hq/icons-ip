export const FULFILLMENT_ORIGINS_PATH = '/admin/settings/origins';
export const DEFAULT_FULFILLMENT_ORIGIN_ID = '00000000-0000-4000-8000-000000042201';
export interface FulfillmentOrigin {
  id: string; code: string; name: string; defaultCarrier: string | null; baseFee: number;
  freeThreshold: number | null; returnAddress: string; cutoff: string | null;
  exportColumns?: import('./shipment-workbook').ShipmentExportColumn[];
  exportTemplate: 'standard' | 'wms_csv' | 'seowon_xlsx'; active: boolean; updatedAt: string;
}
export function parseFulfillmentOriginInput(input: Record<string, string>) {
  const value = {
    code: (input.code ?? '').trim(), name: (input.name ?? '').trim(), default_carrier: input.defaultCarrier || null,
    base_fee: Number(input.baseFee), free_threshold: input.freeThreshold?.trim() ? Number(input.freeThreshold) : null,
    return_address: (input.returnAddress ?? '').trim(), cutoff: input.cutoff || null,
    export_template: input.exportTemplate, is_active: input.active === 'true',
  };
  const errors: Record<string, string> = {};
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(value.code)) errors.code = '코드는 영문 소문자로 시작하는 영문·숫자·하이픈 2~40자입니다.';
  if (!value.name || value.name.length > 80) errors.name = '출고지 이름을 80자 이내로 입력해주세요.';
  if (!input.baseFee?.trim() || !Number.isSafeInteger(value.base_fee) || value.base_fee < 0 || value.base_fee > 1000000) errors.baseFee = '기본 배송비는 0~1,000,000원 사이의 정수입니다.';
  if (value.free_threshold !== null && (!Number.isSafeInteger(value.free_threshold) || value.free_threshold < 0 || value.free_threshold > 100000000)) errors.freeThreshold = '무료 기준은 0~100,000,000원 사이로 입력하거나 비워주세요.';
  if (value.return_address.length > 500 || /[\u0000-\u001f\u007f]/.test(value.return_address)) errors.returnAddress = '반품 주소는 500자 이내의 한 줄입니다.';
  if (value.cutoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.cutoff)) errors.cutoff = '출고 마감 시각을 확인해주세요.';
  if (!['standard', 'wms_csv', 'seowon_xlsx'].includes(value.export_template)) errors.exportTemplate = '내보내기 양식을 선택해주세요.';
  if (value.is_active && !value.default_carrier) errors.defaultCarrier = '활성 출고지의 기본 택배사를 선택해주세요.';
  return Object.keys(errors).length ? { ok: false as const, errors } : { ok: true as const, value };
}
