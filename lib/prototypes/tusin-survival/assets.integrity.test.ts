import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TUSIN_SURVIVAL_ASSET_IDS,
  type TusinSurvivalAssetId,
} from './assets';

interface ManifestAsset {
  assetId: string;
  colorModel: 'RGB' | 'RGBA';
  fileName: string;
  height: number;
  sha256: string;
  width: number;
}

const MANIFEST_URL = new URL(
  '../../../docs/prototypes/tusin-survival-art-generation.md',
  import.meta.url,
);
const ASSET_ROOT_URL = new URL('../../../private-assets/tusin-survival/', import.meta.url);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MANIFEST_ROW =
  /^\|\s*`([^`]+)`\s*\|\s*`([^`]+\.png)`\s*\|\s*(\d+)×(\d+)\s+(RGB|RGBA)\s*\|\s*`([a-f\d]{64})`\s*\|/gm;

const EXPECTED_COLOR_MODELS = {
  'ability-icon-atlas': { label: 'RGB', pngColorType: 2 },
  'combat-vfx-atlas': { label: 'RGBA', pngColorType: 6 },
  'dark-cathedral-floor': { label: 'RGB', pngColorType: 2 },
  'enemy-atlas': { label: 'RGBA', pngColorType: 6 },
  'final-boss': { label: 'RGBA', pngColorType: 6 },
  'pickup-atlas': { label: 'RGBA', pngColorType: 6 },
  'zephyr-directions': { label: 'RGBA', pngColorType: 6 },
} as const satisfies Record<
  TusinSurvivalAssetId,
  { label: ManifestAsset['colorModel']; pngColorType: 2 | 6 }
>;

function readManifestAssets(): ManifestAsset[] {
  const markdown = readFileSync(MANIFEST_URL, 'utf8');

  return [...markdown.matchAll(MANIFEST_ROW)].map((match) => ({
    assetId: match[1],
    fileName: match[2],
    width: Number(match[3]),
    height: Number(match[4]),
    colorModel: match[5] as ManifestAsset['colorModel'],
    sha256: match[6],
  }));
}

const manifestAssets = readManifestAssets();
const manifestById = new Map(manifestAssets.map((asset) => [asset.assetId, asset]));

function manifestAsset(assetId: TusinSurvivalAssetId): ManifestAsset {
  const asset = manifestById.get(assetId);
  if (!asset) throw new Error(`Missing runtime asset manifest row: ${assetId}`);
  return asset;
}

describe('투신전생기 서바이벌 runtime PNG manifest', () => {
  it('allowlist의 모든 ID를 중복 없는 동일 이름 PNG로 고정한다', () => {
    const allowlist = [...TUSIN_SURVIVAL_ASSET_IDS].sort();
    const documentedIds = manifestAssets.map((asset) => asset.assetId).sort();

    expect(documentedIds).toEqual(allowlist);
    expect(new Set(manifestAssets.map((asset) => asset.fileName)).size).toBe(allowlist.length);

    for (const assetId of TUSIN_SURVIVAL_ASSET_IDS) {
      const asset = manifestAsset(assetId);
      expect(asset.fileName).toBe(`${assetId}.png`);
      expect(asset.colorModel).toBe(EXPECTED_COLOR_MODELS[assetId].label);
    }
  });

  it.each(TUSIN_SURVIVAL_ASSET_IDS)(
    '%s 파일의 PNG 헤더·치수·색상·SHA-256가 manifest와 일치한다',
    (assetId) => {
      const manifest = manifestAsset(assetId);
      const assetUrl = new URL(manifest.fileName, ASSET_ROOT_URL);

      expect(existsSync(assetUrl), `${assetId}: runtime file`).toBe(true);

      const bytes = readFileSync(assetUrl);
      expect(bytes.length, `${assetId}: complete PNG header`).toBeGreaterThanOrEqual(29);
      expect(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), `${assetId}: signature`).toBe(
        true,
      );
      expect(bytes.readUInt32BE(8), `${assetId}: IHDR length`).toBe(13);
      expect(bytes.toString('ascii', 12, 16), `${assetId}: first chunk`).toBe('IHDR');
      expect(bytes.readUInt32BE(16), `${assetId}: width`).toBe(manifest.width);
      expect(bytes.readUInt32BE(20), `${assetId}: height`).toBe(manifest.height);
      expect(bytes.readUInt8(24), `${assetId}: bit depth`).toBe(8);
      expect(bytes.readUInt8(25), `${assetId}: PNG color type`).toBe(
        EXPECTED_COLOR_MODELS[assetId].pngColorType,
      );
      expect(createHash('sha256').update(bytes).digest('hex'), `${assetId}: SHA-256`).toBe(
        manifest.sha256,
      );
    },
  );
});
