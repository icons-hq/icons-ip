import {
  TUSIN_SURVIVAL_ASSET_IDS,
  tusinSurvivalAssetUrl,
  type TusinSurvivalAssetId,
} from '@/lib/prototypes/tusin-survival/assets';

export type SpriteImages = Record<TusinSurvivalAssetId, HTMLImageElement>;

export interface AtlasCell {
  assetId: TusinSurvivalAssetId;
  columns: number;
  rows: number;
  column: number;
  row: number;
}

const PLAYER_CELLS = {
  front: [0, 0],
  back: [1, 0],
  left: [0, 1],
  right: [1, 1],
} as const;

const ENEMY_CELLS = {
  'demon-scout': [0, 0],
  'ruin-lancer': [1, 0],
  'doom-wing': [2, 0],
  'shadow-hexer': [0, 1],
  'abyss-armored-captain': [1, 1],
  'black-dragon-siege-mage': [2, 1],
} as const;

const VFX_CELLS = {
  'basic-sword-strike': [0, 0],
  'cloud-dragon-ascent': [1, 0],
  'sword-of-light': [2, 0],
  'gram-dragon-slayer': [0, 1],
  'lightning-fall': [1, 1],
  'black-dragon-chain': [2, 1],
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

export function playerCell(direction: keyof typeof PLAYER_CELLS): AtlasCell {
  return cell('zephyr-directions', 2, 2, PLAYER_CELLS[direction]);
}

export function enemyCell(kind: string): AtlasCell | null {
  const coordinates = ENEMY_CELLS[kind as keyof typeof ENEMY_CELLS];
  return coordinates ? cell('enemy-atlas', 3, 2, coordinates) : null;
}

export function vfxCell(kind: string): AtlasCell | null {
  const coordinates = VFX_CELLS[kind as keyof typeof VFX_CELLS];
  return coordinates ? cell('combat-vfx-atlas', 3, 2, coordinates) : null;
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

export function drawFullImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  destinationX: number,
  destinationY: number,
  destinationWidth: number,
  destinationHeight: number,
  alpha = 1,
) {
  context.save();
  context.globalAlpha = alpha;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    image,
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
    TUSIN_SURVIVAL_ASSET_IDS.map(async (assetId) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = tusinSurvivalAssetUrl(assetId);
      await image.decode();
      return [assetId, image] as const;
    }),
  ).then((entries) => Object.fromEntries(entries) as SpriteImages);

  return imageCache;
}
