import 'server-only';

import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  isTusinSurvivalAssetId,
  type TusinSurvivalAssetId,
} from './assets';

interface AssetFile {
  contentType: 'image/png';
  relativePath: string;
}

export interface TusinSurvivalAsset {
  bytes: Uint8Array;
  contentType: AssetFile['contentType'];
}

const ASSET_ROOT = resolve(process.cwd(), 'private-assets', 'tusin-survival');

/** 새 자산은 shared ID와 이 서버 파일 매핑을 함께 추가한다. */
const ASSET_FILES = {
  'zephyr-directions': {
    contentType: 'image/png',
    relativePath: 'zephyr-directions.png',
  },
  'enemy-atlas': {
    contentType: 'image/png',
    relativePath: 'enemy-atlas.png',
  },
  'final-boss': {
    contentType: 'image/png',
    relativePath: 'final-boss.png',
  },
  'ability-icon-atlas': {
    contentType: 'image/png',
    relativePath: 'ability-icon-atlas.png',
  },
  'combat-vfx-atlas': {
    contentType: 'image/png',
    relativePath: 'combat-vfx-atlas.png',
  },
  'pickup-atlas': {
    contentType: 'image/png',
    relativePath: 'pickup-atlas.png',
  },
  'dark-cathedral-floor': {
    contentType: 'image/png',
    relativePath: 'dark-cathedral-floor.png',
  },
} satisfies Record<TusinSurvivalAssetId, AssetFile>;

function assetPath(relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error('Prototype asset path must be relative');

  const resolved = resolve(ASSET_ROOT, relativePath);
  const fromRoot = relative(ASSET_ROOT, resolved);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Prototype asset path escaped its root');
  }

  return resolved;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

export async function readTusinSurvivalAsset(
  assetId: string,
): Promise<TusinSurvivalAsset | null> {
  if (!isTusinSurvivalAssetId(assetId)) return null;

  const file = ASSET_FILES[assetId];
  try {
    return {
      bytes: await readFile(assetPath(file.relativePath)),
      contentType: file.contentType,
    };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}
