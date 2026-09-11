import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HYOSAN_POPUP_BASE, HYOSAN_SOURCE_COMMIT, HYOSAN_SOURCE_MANIFEST_SHA256,
  assertNoDevelopmentDriver, assertSafeRelativePath, listRegularFiles, parsePackageArguments,
  readPinnedUpstream, relocateHyosanBuild, sha256, verifyDescriptorBytes, verifyUpstreamFileSet,
} from './package-aouad-hyosan.mjs';
import { parseRebuildArguments, readHyosanSourceTar, restoreHyosanSource } from './rebuild-aouad-hyosan.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, 'components/online-popup/aouad/hyosan');
const temporary = [];
async function emptyDirectory() {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'aouad-hyosan-test-'));
  temporary.push(path);
  return path;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const descriptor = (path, bytes) => ({ path, bytes: bytes.length, sha256: sha256(bytes) });

async function sourceFixture({ driver = false, corruptEncoding = false } = {}) {
  const directory = await emptyDirectory();
  const original = Buffer.from('canonical GLB fixture');
  const encoded = gzipSync(corruptEncoding ? Buffer.from('different GLB') : original);
  const js = Buffer.from(driver ? '__HYOSAN_3D_QA__' : 'const assets=[' + Array.from({ length: 6 }, (_, index) => `"/api/dev/hyosan-3d/${index}.glb"`).join(',') + ']');
  const css = Buffer.from('body{margin:0}');
  const html = Buffer.from('<script src="/assets/original.js"></script><link href="/assets/original.css">');
  const bytes = new Map([
    ['assets/original.js', js], ['assets/original.css', css], ['index.html', html],
    ['api/dev/hyosan-3d/student.glb', original], ['__encoded/gzip/student.glb', encoded],
  ]);
  const manifest = {
    version: 1,
    outputFiles: [...bytes.entries()].slice(0, 3).map(([path, value]) => descriptor(path, value)),
    assets: [{ name: 'student.glb', source: 'docs/assets/student.glb', original: descriptor('api/dev/hyosan-3d/student.glb', original), encodings: { gzip: descriptor('__encoded/gzip/student.glb', encoded) } }],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  bytes.set('hyosan-showcase-manifest.json', manifestBytes);
  for (const [path, value] of bytes) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), value);
  }
  return { directory, manifest, manifestBytes, bytes };
}

describe('AOUAD Hyosan immutable packaging boundary', () => {
  it('requires an explicit source directory and isolated rebuild directory', () => {
    expect(() => parsePackageArguments([])).toThrow('--source-directory');
    expect(() => parsePackageArguments(['--source-directory', '/x', '--commit', 'other'])).toThrow('Usage');
    expect(parsePackageArguments(['--source-directory', '/x'])).toBe('/x');
    expect(() => parseRebuildArguments([])).toThrow('--work-directory');
  });

  it('rejects traversal, separator encoding, protected references, and absolute paths', () => {
    for (const path of ['../private', 'a/../b', '/tmp/a', 'a\\b', 'a/%2fsecret', 'a//b', 'references/still.png', 'qa/result.json', '.env']) {
      expect(() => assertSafeRelativePath(path)).toThrow();
    }
    expect(assertSafeRelativePath('__encoded/br/media/student.glb')).toBe('__encoded/br/media/student.glb');
  });

  it('checks the entire source file set and compression round-trip', async () => {
    const { directory, manifest, manifestBytes } = await sourceFixture();
    expect((await verifyUpstreamFileSet(directory, manifest, manifestBytes)).size).toBe(6);
    await writeFile(join(directory, 'unexpected.txt'), 'not in manifest');
    await expect(verifyUpstreamFileSet(directory, manifest, manifestBytes)).rejects.toThrow('file set');
  });

  it('rejects changed bytes even when filenames and lengths still match', async () => {
    const { directory, manifest, manifestBytes } = await sourceFixture();
    await writeFile(join(directory, 'api/dev/hyosan-3d/student.glb'), 'Canonical GLB fixture');
    await expect(verifyUpstreamFileSet(directory, manifest, manifestBytes)).rejects.toThrow('SHA/bytes');
  });

  it('rejects compressed bytes that have a valid hash but restore another asset', async () => {
    const { directory, manifest, manifestBytes } = await sourceFixture({ corruptEncoding: true });
    await expect(verifyUpstreamFileSet(directory, manifest, manifestBytes)).rejects.toThrow('round-trip');
  });

  it('rejects source-file and source-root symlinks', async () => {
    const { directory } = await sourceFixture();
    const source = join(directory, 'api/dev/hyosan-3d/student.glb');
    await rm(source);
    await symlink(join(directory, 'index.html'), source);
    await expect(listRegularFiles(directory)).rejects.toThrow('symlink');
    const holder = await emptyDirectory();
    await symlink(directory, join(holder, 'site'));
    await expect(listRegularFiles(join(holder, 'site'))).rejects.toThrow('symlink');
  });

  it('does not accept a different build manifest as the pinned commit', async () => {
    const { directory } = await sourceFixture();
    await expect(readPinnedUpstream(directory)).rejects.toThrow('pinned commit');
  });

  it('rejects development drivers before publication', async () => {
    const { directory, manifest, manifestBytes } = await sourceFixture({ driver: true });
    await expect(verifyUpstreamFileSet(directory, manifest, manifestBytes)).rejects.toThrow('development driver');
    expect(() => assertNoDevelopmentDriver(Buffer.from('NEXT_PUBLIC_HYOSAN_TEST_DRIVER'), 'script')).toThrow();
  });

  it('rewrites only pinned roots and renames bundles after their bytes change', async () => {
    const { manifest, bytes } = await sourceFixture();
    const result = relocateHyosanBuild(manifest.outputFiles, bytes);
    expect(result.mediaReplacements).toBe(6);
    expect(result.bundleReplacements).toBe(2);
    const js = [...result.files.entries()].find(([path]) => path.endsWith('.js'));
    expect(js[0]).toBe(`assets/index-${sha256(js[1]).slice(0, 16)}.js`);
    expect(js[1].toString().split(`${HYOSAN_POPUP_BASE}media/`)).toHaveLength(7);
    const html = result.files.get('index.html').toString();
    expect(html).toContain(`${HYOSAN_POPUP_BASE}${js[0]}`);
    expect(html).not.toContain('"/assets/');
    expect(js[1].toString()).not.toContain('/api/dev/hyosan-3d/');
    bytes.set('assets/original.js', Buffer.from('const unrelated=1'));
    expect(() => relocateHyosanBuild(manifest.outputFiles, bytes)).toThrow('replacement count');
  });

  it('preserves the exact upstream manifest and a git archive bound to the full commit', async () => {
    const original = await readFile(join(packageRoot, 'upstream-manifest.json'));
    expect(sha256(original)).toBe(HYOSAN_SOURCE_MANIFEST_SHA256);
    const source = JSON.parse(await readFile(join(packageRoot, 'upstream-source-manifest.json'), 'utf8'));
    expect(source.commit).toBe(HYOSAN_SOURCE_COMMIT);
    const archive = await readFile(join(packageRoot, source.archive.path));
    verifyDescriptorBytes(archive, source.archive);
    const tar = gunzipSync(archive);
    const files = readHyosanSourceTar(tar);
    expect(files.size).toBe(source.files.length);
    for (const file of source.files) verifyDescriptorBytes(files.get(file.path), file);
    const changed = Buffer.from(tar);
    changed[0] ^= 1;
    expect(() => readHyosanSourceTar(changed)).toThrow('checksum');
  });

  it('restores source and exact media without another game checkout', async () => {
    const target = await emptyDirectory();
    const restored = await restoreHyosanSource(target);
    const packageJson = JSON.parse(await readFile(join(restored, 'package.json'), 'utf8'));
    expect(packageJson.scripts['build:hyosan-showcase']).toBe('node scripts/build-hyosan-showcase.mjs');
    const upstream = JSON.parse(await readFile(join(packageRoot, 'upstream-manifest.json'), 'utf8'));
    for (const asset of upstream.assets) verifyDescriptorBytes(await readFile(join(restored, asset.source)), asset.original);
    await expect(restoreHyosanSource(target)).rejects.toThrow('empty regular directory');
    await expect(restoreHyosanSource(join(root, 'output/disallowed-rebuild'))).rejects.toThrow('outside this repository');
  });
});
