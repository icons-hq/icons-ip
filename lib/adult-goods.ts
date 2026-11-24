/*
 * 19금 굿즈(성인 상품) 노출 모드. ADR-0024.
 *
 *   hidden — 성인 인증이 닫혀 있다(공개 스위치·canary 밖). 지금처럼 어디에도 없다.
 *   masked — 성인 인증은 열려 있지만 이 방문자는 인증 전이다. 목록에는 존재만 보이는
 *            가림 카드로, 상세에는 인증 안내만 보인다.
 *   full   — 유효한 성인 인증을 마친 회원이다. 일반 굿즈처럼 보이고 산다.
 *
 * 이 값은 화면을 고르는 데만 쓴다. 담기·주문·상세 데이터의 경계는 DB가 성인 인증
 * 증거로 다시 판정한다.
 */

export type AdultGoodsAccess = 'hidden' | 'masked' | 'full';

/** 성인(19금) 상품 공개 설정이 있는 어드민 화면(판매자 정보 → 기능 공개 관리, 관리자 전용). */
export const ADULT_GOODS_VISIBILITY_PATH = '/admin/settings/features';

export interface AdultGoodsVisibility {
  enabled: boolean;
  revision: number;
}

export function parseAdultGoodsVisibility(value: unknown): AdultGoodsVisibility | null {
  if (!value || typeof value !== 'object' || !('enabled' in value) || !('revision' in value)) return null;
  const { enabled, revision } = value;
  if (typeof enabled !== 'boolean' || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return null;
  return { enabled, revision };
}

/** 가림 카드와 인증 안내에 쓰는 고객 표기(CONTEXT.md "성인 상품"). */
export const ADULT_GOOD_LABEL = '19금 상품';

/** 이 모드에서 카탈로그가 읽을 판매 제한 유형. */
export function adultGoodsRestrictions(access: AdultGoodsAccess): ('none' | 'adult')[] {
  return access === 'hidden' ? ['none'] : ['none', 'adult'];
}
