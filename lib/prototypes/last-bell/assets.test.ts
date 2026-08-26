import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAST_BELL_ASSETS } from './assets';
import { LAST_BELL_3D_DELIVERY_FILE_PATHS } from './environment3d';

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

const REJECTED_CHAPTER_ONE_CONCEPTS = [
  {
    id: 'concept-ch1-entry-brand-v1',
    path: 'docs/ip/all-of-us-are-dead-2/concepts/ch1-entry-brand-v1.png',
    sha256: '4bfb507e65f4896eddee6d2ede1a51d6257748d6e726920f11a8875e57f4d91c',
  },
  {
    id: 'concept-ch1-cold-open-seated-v1',
    path: 'docs/ip/all-of-us-are-dead-2/concepts/ch1-cold-open-seated-v1.png',
    sha256: '4ff1dba0a542fe2a0f8d40dcce302c01c5e60702c386902866a08f4fdd3ff003',
  },
  {
    id: 'concept-ch1-start-room-first-door-v1',
    path: 'docs/ip/all-of-us-are-dead-2/concepts/ch1-start-room-first-door-v1.png',
    sha256: '4ecf039505f397e1848c4bddb9079f2848171fa79318a1798b76cd45e940f47d',
  },
  {
    id: 'concept-ch1-mobile-hud-844x390-v1',
    path: 'docs/ip/all-of-us-are-dead-2/concepts/ch1-mobile-hud-844x390-v1.png',
    sha256: '8d5c24b167d8d98138c8d04eb342c725fde0dc2723e98485e3614d1eae826048',
  },
] as const;

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
    LAST_BELL_ASSETS.logo,
    ...Object.values(LAST_BELL_ASSETS.audio),
    ...LAST_BELL_3D_DELIVERY_FILE_PATHS,
  ];
}

function exportedAssetPaths(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportedAssetPaths);
  return [];
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

  it('keeps all 74 active game and campaign files present with recorded integrity', () => {
    const manifest = readManifest();
    expect(manifest.assets).toHaveLength(74);
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

  it('rejects the four replaced Chapter 1 concepts from the manifest and runtime', () => {
    const manifest = readManifest();
    const manifestIds = new Set(manifest.assets.map((asset) => asset.id));
    const exportedPaths = exportedAssetPaths(LAST_BELL_ASSETS);

    for (const rejected of REJECTED_CHAPTER_ONE_CONCEPTS) {
      expect(manifestIds, rejected.id).not.toContain(rejected.id);
      expect(existsSync(resolve(root, rejected.path)), rejected.id).toBe(false);
      expect(exportedPaths, rejected.id).not.toContain(rejected.path);
      expect(rejected.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('keeps generated legacy material maps out of the active post-strike runtime', () => {
    expect('materials' in LAST_BELL_ASSETS).toBe(false);
    expect(existsSync(resolve(root, 'components/prototype/last-bell/scene/SchoolMaterials.tsx'))).toBe(false);
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
