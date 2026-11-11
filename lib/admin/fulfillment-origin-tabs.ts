import { FULFILLMENT_ORIGINS_PATH, type FulfillmentOrigin } from './fulfillment-origins';

/**
 * 배송정보 관리의 출고지 탭(R22). URL `?origin=<출고지 코드>`, 출고지 추가는 `?origin=_new`.
 * 출고지 코드는 영문 소문자로 시작하므로(`parseFulfillmentOriginInput`) 밑줄로 시작하는 값과 겹치지 않는다.
 */
export const NEW_FULFILLMENT_ORIGIN_TAB = '_new';
export function fulfillmentOriginTabHref(tab: string): string {
  return `${FULFILLMENT_ORIGINS_PATH}?${new URLSearchParams({ origin: tab })}`;
}
/** 모르는 값·반복 값·권한 없는 '출고지 추가'는 첫 출고지로 돌린다. 출고지가 없으면 편집 권한이 있을 때만 '출고지 추가'다. */
export function selectedFulfillmentOriginTab(origins: readonly Pick<FulfillmentOrigin, 'code'>[], value: string | string[] | undefined, canEdit: boolean): string | null {
  const requested = typeof value === 'string' ? value : '';
  if (requested === NEW_FULFILLMENT_ORIGIN_TAB && canEdit) return NEW_FULFILLMENT_ORIGIN_TAB;
  if (origins.some(origin => origin.code === requested)) return requested;
  return origins[0]?.code ?? (canEdit ? NEW_FULFILLMENT_ORIGIN_TAB : null);
}
