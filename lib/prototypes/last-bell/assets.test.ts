import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAST_BELL_ASSETS } from './assets';

const root = resolve(process.cwd());
const publicRoot = resolve(root, 'public');
const manifestPath = resolve(root, 'docs/ip/all-of-us-are-dead-2/asset-manifest.json');

type ManifestAsset = {
  path: string;
  byte_size: number;
  sha256: string;
};

type AssetManifest = { assets: ManifestAsset[] };

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

  it('keeps all 27 manifest files present with the recorded size and SHA-256', () => {
    const manifest = readManifest();
    expect(manifest.assets).toHaveLength(27);
    for (const asset of manifest.assets) {
      const filePath = resolveManifestAssetPath(asset.path);
      const bytes = readFileSync(filePath);
      expect(statSync(filePath).isFile(), asset.path).toBe(true);
      expect(bytes.byteLength, asset.path).toBe(asset.byte_size);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.path).toBe(asset.sha256);
    }
  });

  it('rejects manifest paths that escape the repo or public generated root', () => {
    expect(() => resolveManifestAssetPath('../package.json')).toThrow(/escapes/);
    expect(() => resolveManifestAssetPath('/generated/../../package.json')).toThrow(/escapes/);
  });
});
