const ASSET_ROUTE = '/api/prototypes/tusin-survival/assets';

/**
 * 브라우저에 노출해도 되는 안정 ID만 공유한다.
 * 실제 파일명과 filesystem 경로는 assets.server.ts의 서버 allowlist가 소유한다.
 */
export const TUSIN_SURVIVAL_ASSET_IDS = [
  'zephyr-directions',
  'enemy-atlas',
  'final-boss',
  'ability-icon-atlas',
  'combat-vfx-atlas',
  'pickup-atlas',
  'dark-cathedral-floor',
] as const;

export type TusinSurvivalAssetId = (typeof TUSIN_SURVIVAL_ASSET_IDS)[number];

const ASSET_IDS: ReadonlySet<string> = new Set(TUSIN_SURVIVAL_ASSET_IDS);

export function isTusinSurvivalAssetId(value: string): value is TusinSurvivalAssetId {
  return ASSET_IDS.has(value);
}

export function tusinSurvivalAssetUrl(assetId: TusinSurvivalAssetId): string {
  return `${ASSET_ROUTE}/${encodeURIComponent(assetId)}`;
}
