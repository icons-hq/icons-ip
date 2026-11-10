import { BANK_ACCOUNT_LABELS, mergeBusinessInfo, type EditableCarrier } from '@/lib/admin/store-settings';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { ShippingRegionPolicy } from '@/lib/admin/shipping-regions';
import { BUSINESS_INFO_LABELS, type BusinessInfo } from '@/lib/legal/business-info';

/** 운영 준비 카드 하나의 입력 상태. `detail`은 무엇이 남았는지 말하는 짧은 글자다. */
export interface OperationsCardReadiness { done: boolean; detail: string }
export type OperationsCardKey = 'business' | 'bankTransfer' | 'origins' | 'regions' | 'carriers' | 'notices' | 'storeCredits';
export type OperationsReadiness = Partial<Record<OperationsCardKey, OperationsCardReadiness>>;

/** 각 입력 화면이 이미 읽는 저장값. `undefined`는 권한이 없거나 읽지 못해 상태를 말할 수 없다는 뜻이다(미입력과 다르다). */
export interface OperationsReadinessSources {
  business?: Record<string, unknown>;
  bankTransfer?: Record<string, string> | null;
  origins?: Pick<GoodsFulfillmentOrigin, 'active' | 'returnAddress'>[];
  regions?: Pick<ShippingRegionPolicy, 'status'>[];
  carriers?: Pick<EditableCarrier, 'active'>[];
  activeNoticeTemplates?: number;
  storeCreditsEnabled?: boolean;
}

/** 저장값만으로 말할 수 있는 카드의 입력 상태. 상품·카테고리·쿠폰은 건별로 달라 여기서 판단하지 않는다. */
export function operationsReadiness(source: OperationsReadinessSources): OperationsReadiness {
  const readiness: OperationsReadiness = {};
  if (source.business !== undefined) {
    const info: BusinessInfo = mergeBusinessInfo(source.business);
    const missing = (Object.keys(BUSINESS_INFO_LABELS) as (keyof BusinessInfo)[]).filter(key => !info[key].trim()).length;
    readiness.business = missing ? { done: false, detail: `${missing}개 항목 미입력` } : { done: true, detail: '사업자 정보 입력됨' };
  }
  if (source.bankTransfer !== undefined) {
    const account = source.bankTransfer;
    const done = account !== null && Object.keys(BANK_ACCOUNT_LABELS).every(key => Boolean(account[key]?.trim()));
    readiness.bankTransfer = done ? { done, detail: '계좌 입력됨' } : { done, detail: '계좌 미입력' };
  }
  if (source.origins !== undefined) {
    const active = source.origins.filter(origin => origin.active);
    const withoutReturn = active.filter(origin => !origin.returnAddress?.trim()).length;
    readiness.origins = !active.length ? { done: false, detail: '사용 중인 출고지 없음' }
      : withoutReturn ? { done: false, detail: `반품 주소 ${withoutReturn}곳 미입력` }
        : { done: true, detail: `출고지 ${active.length}곳 사용 중` };
  }
  if (source.regions !== undefined) {
    const active = source.regions.filter(policy => policy.status === 'active').length;
    readiness.regions = active ? { done: true, detail: `활성 정책 ${active}개` } : { done: false, detail: '활성 정책 없음' };
  }
  if (source.carriers !== undefined) {
    const active = source.carriers.filter(carrier => carrier.active).length;
    readiness.carriers = active ? { done: true, detail: `${active}곳 사용 중` } : { done: false, detail: '사용 중인 택배사 없음' };
  }
  if (source.activeNoticeTemplates !== undefined) {
    readiness.notices = source.activeNoticeTemplates ? { done: true, detail: `활성 템플릿 ${source.activeNoticeTemplates}개` } : { done: false, detail: '활성 템플릿 없음' };
  }
  if (source.storeCreditsEnabled !== undefined) {
    readiness.storeCredits = source.storeCreditsEnabled ? { done: true, detail: '정책 사용 중' } : { done: false, detail: '정책 비활성' };
  }
  return readiness;
}
