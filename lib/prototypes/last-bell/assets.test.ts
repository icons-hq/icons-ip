import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAST_BELL_ASSETS } from './assets';

const root = resolve(process.cwd());
const publicRoot = resolve(root, 'public');
const manifestPath = resolve(root, 'docs/ip/all-of-us-are-dead-2/asset-manifest.json');

type ManifestAsset = {
  id: string;
  path: string;
  usage: string;
  source_type: string;
  source_url: string;
  source_commit?: string;
  editing: string;
  license_status: string;
  byte_size: number;
  sha256: string;
};

type AssetManifest = {
  rights_confirmation: { status: string };
  source_lock: {
    repository: string;
    commit: string;
    sample_url: string;
    source_directory: string;
    external_runtime_dependency: boolean;
  };
  assets: ManifestAsset[];
};

const AOUAD_SOURCE_COMMIT = 'd63c7f0c4c5851c9722afdd895c87b72a7217c2d';

function readManifest(): AssetManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetManifest;
}

function isWithin(base: string, candidate: string) {
  const pathFromBase = relative(base, candidate);
  return pathFromBase === '' || (!pathFromBase.startsWith('..') && !isAbsolute(pathFromBase));
}

function resolveManifestAssetPath(assetPath: string) {
  const isGeneratedUrl = assetPath.startsWith('/generated/');
  if (assetPath.startsWith('/') && !isGeneratedUrl) throw new Error(`Unsupported absolute asset path: ${assetPath}`);

  const base = realpathSync(isGeneratedUrl ? publicRoot : root);
  const candidate = resolve(base, isGeneratedUrl ? assetPath.slice(1) : assetPath);
  if (!isWithin(base, candidate)) throw new Error(`Asset path escapes its allowed root: ${assetPath}`);

  const canonicalCandidate = realpathSync(candidate);
  if (!isWithin(base, canonicalCandidate)) throw new Error(`Asset symlink escapes its allowed root: ${assetPath}`);
  return canonicalCandidate;
}

function runtimeAssetPaths() {
  return [
    LAST_BELL_ASSETS.openingPlate,
    LAST_BELL_ASSETS.outbreakPlate,
    LAST_BELL_ASSETS.corridorPlate,
    LAST_BELL_ASSETS.powerPlate,
    LAST_BELL_ASSETS.bellPlate,
    LAST_BELL_ASSETS.logo,
    ...Object.values(LAST_BELL_ASSETS.materials),
    ...Object.values(LAST_BELL_ASSETS.audio),
  ];
}

describe('last bell asset contract', () => {
  it('keeps every runtime asset in the generated pack', () => {
    for (const assetPath of runtimeAssetPaths()) expect(existsSync(resolveManifestAssetPath(assetPath))).toBe(true);
  });

  it('keeps every runtime asset represented in the manifest', () => {
    const manifest = readManifest();
    const paths = new Set(manifest.assets.map((asset) => asset.path));
    for (const assetPath of runtimeAssetPaths()) expect(paths.has(assetPath)).toBe(true);
  });

  it('keeps all 64 unified game and campaign files present with recorded integrity', () => {
    const manifest = readManifest();
    expect(manifest.assets).toHaveLength(64);
    for (const asset of manifest.assets) {
      const filePath = resolveManifestAssetPath(asset.path);
      const bytes = readFileSync(filePath);
      expect(asset.id.length, asset.path).toBeGreaterThan(0);
      expect(asset.usage.length, asset.path).toBeGreaterThan(0);
      expect(asset.source_type.length, asset.path).toBeGreaterThan(0);
      expect(asset.source_url.length, asset.path).toBeGreaterThan(0);
      expect(asset.editing.length, asset.path).toBeGreaterThan(0);
      expect(asset.license_status.length, asset.path).toBeGreaterThan(0);
      expect(statSync(filePath).isFile(), asset.path).toBe(true);
      expect(bytes.byteLength, asset.path).toBe(asset.byte_size);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.path).toBe(asset.sha256);
    }
  });

  it('locks the campaign source and all 24 official images to the approved commit', () => {
    const manifest = readManifest();
    expect(manifest.rights_confirmation.status).toBe('LOCKED');
    expect(manifest.source_lock).toEqual({
      repository: 'icons-hq/icons',
      commit: AOUAD_SOURCE_COMMIT,
      sample_url: 'https://icons-plan.vercel.app/sample/aouad',
      source_directory: '50_apps/plan-viewer/public/ip-popups/aouad',
      external_runtime_dependency: false,
    });

    const officialAssets = manifest.assets.filter((asset) => asset.id.startsWith('campaign-official-'));
    expect(officialAssets).toHaveLength(24);
    expect(officialAssets.every((asset) => asset.source_commit === AOUAD_SOURCE_COMMIT)).toBe(true);
    expect(officialAssets.every((asset) => asset.source_url.includes(`/blob/${AOUAD_SOURCE_COMMIT}/`))).toBe(true);

    const officialDirectory = resolve(publicRoot, 'generated/aouad-campaign/official');
    expect(officialAssets.map((asset) => asset.path.split('/').at(-1)).sort()).toEqual(readdirSync(officialDirectory).sort());
  });

  it('resolves every manifest source reference to an existing asset id', () => {
    const manifest = readManifest();
    const ids = new Set(manifest.assets.map((asset) => asset.id));
    const references = manifest.assets
      .filter((asset) => asset.source_url.startsWith('manifest://'))
      .map((asset) => ({ assetId: asset.id, sourceId: asset.source_url.slice('manifest://'.length) }));

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(ids.has(reference.sourceId), `${reference.assetId} -> ${reference.sourceId}`).toBe(true);
    }
  });

  it('rejects manifest paths that escape the repo or public generated root', () => {
    expect(() => resolveManifestAssetPath('../package.json')).toThrow(/escapes/);
    expect(() => resolveManifestAssetPath('/generated/../../package.json')).toThrow(/escapes/);
  });
});
