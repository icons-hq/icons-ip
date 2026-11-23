import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { COLLECTIBLE_FEATURE_IDS, type CollectibleFeature, type CollectibleFeatures } from '@/lib/collectible-features';

/** 카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치 화면(관리자 전용). */
export const COLLECTIBLE_FEATURES_PATH = '/admin/settings/features';

export interface AdminCollectibleFeaturesState extends CollectibleFeatures {
  revision: number;
  updatedAt: string;
  /** 마지막으로 바꾼 운영자 닉네임. 아직 아무도 바꾸지 않았거나 계정이 지워졌으면 null. */
  updatedBy: string | null;
}

/** 고객 화면에서 각 기능이 차지하는 자리 — 끄면 이 자리가 전부 닫힌다는 것을 화면이 그대로 말한다. */
export const COLLECTIBLE_FEATURE_SURFACES: Record<CollectibleFeature, string> = {
  binder: '보유 카드 모음 화면(/binder)과 메뉴·마이페이지·카드팩·IP 상세·검색의 바인더 링크',
  market: '굿즈 마켓 화면(/market)과 메뉴 링크, 스태프 전용 시연',
  exchange: '카드 트레이드 화면(/exchange)과 메뉴·바인더의 트레이드 링크, 스태프 전용 시연',
};

/** DB 문서를 그대로 믿지 않고 화면이 쓰는 모양만 통과시킨다. */
export function parseAdminCollectibleFeatures(value: unknown): AdminCollectibleFeaturesState | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['revision', 'binder', 'market', 'exchange', 'updatedAt', 'updatedBy'])
    || !transactionInteger(value.revision, 1) || !COLLECTIBLE_FEATURE_IDS.every((id) => typeof value[id] === 'boolean')
    || !transactionInstant(value.updatedAt) || !(value.updatedBy === null || typeof value.updatedBy === 'string')) return null;
  return {
    revision: value.revision as number,
    binder: value.binder as boolean,
    market: value.market as boolean,
    exchange: value.exchange as boolean,
    updatedAt: value.updatedAt as string,
    updatedBy: value.updatedBy as string | null,
  };
}

export function collectibleFeaturesError(code?: string, message?: string): string {
  if (code === 'PT409' || message?.includes('collectible_features_changed')) return '다른 관리자가 먼저 설정을 바꿨습니다. 새로고침해 현재 설정을 확인해주세요.';
  if (['42501', '28000'].includes(code ?? '') || message?.includes('operator_capability_required') || message?.includes('auth_required')) {
    return '현재 로그인 계정과 관리자 권한을 확인해주세요.';
  }
  if (code === '22023' || message?.includes('invalid_collectible_features')) return '저장할 값이 올바르지 않습니다. 새로고침 후 다시 시도해주세요.';
  return '저장 결과를 확인하지 못했습니다. 이미 저장됐을 수 있으니 결과 확인 버튼을 눌러주세요. 여러 번 눌러도 한 번만 저장됩니다.';
}
