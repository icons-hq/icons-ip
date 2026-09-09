import {
  tusinSurvivalAssetUrl,
  type TusinSurvivalAssetId,
} from '@/lib/prototypes/tusin-survival/assets';
import { baseWeaponPresentationId } from './weapon-presentation';

const CANVAS_SPRITE_ASSET_IDS = [
  'zephyr-action-atlas',
  'enemy-motion-atlas',
  'final-boss-motion-atlas',
  'combat-motion-atlas',
  'pickup-atlas',
  'dark-cathedral-floor',
] as const satisfies readonly TusinSurvivalAssetId[];

export type SpriteImages = Partial<Record<TusinSurvivalAssetId, HTMLImageElement>>;

export interface AtlasCell {
  assetId: TusinSurvivalAssetId;
  columns: number;
  rows: number;
  column: number;
  row: number;
}

const PLAYER_ACTION_ROWS = {
  front: 0,
  back: 1,
  left: 2,
  right: 3,
} as const;

const PLAYER_ACTION_COLUMNS = {
  idle: 0,
  runContact: 1,
  runPassing: 2,
  anticipation: 3,
  impact: 4,
  recovery: 5,
} as const;

const ENEMY_MOTION_ROWS = {
  'demon-scout': 0,
  'ruin-lancer': 1,
  'doom-wing': 2,
  'shadow-hexer': 3,
  'abyss-armored-captain': 4,
  'black-dragon-siege-mage': 5,
} as const;

const ENEMY_MOTION_COLUMNS = {
  idle: 0,
  advance: 1,
  hit: 2,
  death: 3,
} as const;

const COMBAT_MOTION_ROWS = {
  'basic-sword-strike': 0,
  'cloud-dragon-ascent': 1,
  'sword-of-light': 2,
  'gram-dragon-slayer': 3,
  'lightning-fall': 4,
  'black-dragon-chain': 5,
} as const;

const COMBAT_MOTION_COLUMNS = {
  startup: 0,
  active: 1,
  impact: 2,
  afterglow: 3,
} as const;

const FINAL_BOSS_MOTION_COLUMNS = {
  idle: 0,
  attack: 1,
  hit: 2,
  death: 3,
} as const;

const PICKUP_CELLS = {
  xp: [0, 0],
  heal: [1, 0],
  chest: [2, 0],
  evolution: [3, 0],
} as const;

export const ABILITY_ICON_IDS = [
  'basic-sword-strike',
  'cloud-dragon-ascent',
  'sword-of-light',
  'gram-dragon-slayer',
  'lightning-fall',
  'black-dragon-chain',
  'wall-of-iron',
  'hermes-secret-skill',
  'dragon-heart',
  'regressors-memory',
  'last-human',
  'purification-ring',
] as const;

function cell(
  assetId: TusinSurvivalAssetId,
  columns: number,
  rows: number,
  coordinates: readonly [number, number],
): AtlasCell {
  return {
    assetId,
    columns,
    rows,
    column: coordinates[0],
    row: coordinates[1],
  };
}

export function playerActionCell(
  direction: keyof typeof PLAYER_ACTION_ROWS,
  pose: keyof typeof PLAYER_ACTION_COLUMNS,
): AtlasCell {
  return cell('zephyr-action-atlas', 6, 4, [
    PLAYER_ACTION_COLUMNS[pose],
    PLAYER_ACTION_ROWS[direction],
  ]);
}

export function enemyMotionCell(
  kind: string,
  pose: keyof typeof ENEMY_MOTION_COLUMNS,
): AtlasCell | null {
  const row = ENEMY_MOTION_ROWS[kind as keyof typeof ENEMY_MOTION_ROWS];
  return row === undefined
    ? null
    : cell('enemy-motion-atlas', 4, 6, [ENEMY_MOTION_COLUMNS[pose], row]);
}

export function combatMotionCell(
  weaponId: string,
  phase: keyof typeof COMBAT_MOTION_COLUMNS,
): AtlasCell | null {
  const baseWeaponId = baseWeaponPresentationId(weaponId);
  if (!baseWeaponId) return null;
  const row = COMBAT_MOTION_ROWS[baseWeaponId as keyof typeof COMBAT_MOTION_ROWS];
  return row === undefined
    ? null
    : cell('combat-motion-atlas', 4, 6, [COMBAT_MOTION_COLUMNS[phase], row]);
}

export function finalBossMotionCell(
  pose: keyof typeof FINAL_BOSS_MOTION_COLUMNS,
): AtlasCell {
  return cell('final-boss-motion-atlas', 4, 1, [FINAL_BOSS_MOTION_COLUMNS[pose], 0]);
}

export function pickupCell(kind: string): AtlasCell {
  const coordinates = PICKUP_CELLS[kind as keyof typeof PICKUP_CELLS] ?? PICKUP_CELLS.xp;
  return cell('pickup-atlas', 4, 1, coordinates);
}

export function abilityIconCell(id: string): AtlasCell | null {
  const index = ABILITY_ICON_IDS.findIndex((candidate) => candidate === id);
  if (index < 0) return null;
  return cell('ability-icon-atlas', 4, 3, [index % 4, Math.floor(index / 4)]);
}

export function drawAtlasCell(
  context: CanvasRenderingContext2D,
  images: SpriteImages,
  definition: AtlasCell,
  destinationX: number,
  destinationY: number,
  destinationWidth: number,
  destinationHeight: number,
  alpha = 1,
) {
  const image = images[definition.assetId];
  if (!image) throw new Error(`Sprite image was not preloaded: ${definition.assetId}`);
  const sourceWidth = image.naturalWidth / definition.columns;
  const sourceHeight = image.naturalHeight / definition.rows;
  context.save();
  context.globalAlpha = alpha;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    image,
    sourceWidth * definition.column,
    sourceHeight * definition.row,
    sourceWidth,
    sourceHeight,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight,
  );
  context.restore();
}

let imageCache: Promise<SpriteImages> | null = null;

export function loadSpriteImages(): Promise<SpriteImages> {
  if (imageCache) return imageCache;

  imageCache = Promise.all(
    CANVAS_SPRITE_ASSET_IDS.map(async (assetId) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = tusinSurvivalAssetUrl(assetId);
      await image.decode();
      return [assetId, image] as const;
    }),
  ).then((entries) => Object.fromEntries(entries) as SpriteImages);

  return imageCache;
}
