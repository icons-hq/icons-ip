import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompress, constants, gzip, gunzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const unbrotli = promisify(brotliDecompress);
const zip = promisify(gzip);
const unzip = promisify(gunzip);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = 'components/online-popup/aouad/hyosan';
const outputDirectory = join(repositoryRoot, 'private/ip-popups/aouad-hyosan');
const upstreamFilename = 'hyosan-showcase-manifest.json';
const developmentAssetRoot = '/api/dev/hyosan-3d/';

export const HYOSAN_SOURCE_COMMIT = '88b9937a118120f60ef5166b66e5c370fc292b3a';
export const HYOSAN_SOURCE_MANIFEST_SHA256 = '421bb226cce51d3eaa9f90d2e416ac75de0f02d98a00bc9ef45082c7125dadc8';
export const HYOSAN_SOURCE_CAPSULE_SHA256 = '80c742a03d33a29da8f80e253fc74141d426f4753bfbecdcdd683138ca680dce';
export const HYOSAN_POPUP_BASE = '/ip-popups/aouad/hyosan/';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function assertSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value)
    || !value.split('/').every((part) => /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(part))
    || value.split('/').some((part) => ['qa', 'reference', 'references', 'unused', 'old', 'oldunusedassets'].includes(part.toLowerCase()))) {
    throw new Error(`Unsafe or protected Hyosan package path: ${String(value)}`);
  }
  return value;
}

export async function listRegularFiles(directory) {
  const files = [];
  async function visit(current, prefix) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Hyosan source directory must not be a symlink: ${prefix || '.'}`);
    for (const item of await readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      assertSafeRelativePath(relative);
      if (item.isSymbolicLink()) throw new Error(`Hyosan package contains a symlink: ${relative}`);
      if (item.isDirectory()) await visit(join(current, item.name), relative);
      else if (item.isFile()) files.push(relative);
      else throw new Error(`Hyosan package contains an unsupported file: ${relative}`);
    }
  }
  await visit(directory, '');
  return files.sort();
}

export function verifyDescriptorBytes(bytes, descriptor) {
  assertSafeRelativePath(descriptor.path);
  if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 0
    || !/^[a-f0-9]{64}$/.test(descriptor.sha256)
    || descriptor.bytes !== bytes.byteLength || descriptor.sha256 !== sha256(bytes)) {
    throw new Error(`Hyosan SHA/bytes mismatch: ${descriptor.path}`);
  }
}

export function assertNoDevelopmentDriver(bytes, label) {
  for (const token of ['__HYOSAN_3D_QA__', 'NEXT_PUBLIC_HYOSAN_TEST_DRIVER']) {
    if (bytes.includes(Buffer.from(token))) throw new Error(`Hyosan development driver found in ${label}`);
  }
}

/** Verify the complete pinned file set before copying or transforming any bytes. */
export async function verifyUpstreamFileSet(sourceDirectory, manifest, manifestBytes) {
  const descriptors = [
    ...manifest.outputFiles,
    ...manifest.assets.flatMap((asset) => [asset.original, ...Object.values(asset.encodings)]),
  ];
  const expected = [...descriptors.map((entry) => assertSafeRelativePath(entry.path)), upstreamFilename].sort();
  if (new Set(expected).size !== expected.length) throw new Error('Hyosan manifest contains duplicate output paths');
  const actual = await listRegularFiles(sourceDirectory);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Hyosan source file set differs from its manifest');
  const bytesByPath = new Map([[upstreamFilename, manifestBytes]]);
  for (const descriptor of descriptors) {
    const bytes = await readFile(join(sourceDirectory, descriptor.path));
    verifyDescriptorBytes(bytes, descriptor);
    bytesByPath.set(descriptor.path, bytes);
  }
  for (const asset of manifest.assets) {
    const original = bytesByPath.get(asset.original.path);
    for (const [encoding, descriptor] of Object.entries(asset.encodings)) {
      const bytes = bytesByPath.get(descriptor.path);
      if (encoding !== 'br' && encoding !== 'gzip') throw new Error(`Unsupported Hyosan encoding: ${encoding}`);
      const restored = encoding === 'br' ? await unbrotli(bytes) : await unzip(bytes);
      if (!original.equals(restored)) throw new Error(`Hyosan compression round-trip differs: ${descriptor.path}`);
    }
  }
  for (const descriptor of manifest.outputFiles) assertNoDevelopmentDriver(bytesByPath.get(descriptor.path), descriptor.path);
  return bytesByPath;
}

export async function readPinnedUpstream(sourceDirectory) {
  if (typeof sourceDirectory !== 'string' || !sourceDirectory) throw new Error('--source-directory is required');
  const root = resolve(sourceDirectory);
  // Traversal also rejects a symlink at the root before the manifest is opened.
  await listRegularFiles(root);
  const bytes = await readFile(join(root, upstreamFilename));
  const preserved = await readFile(join(repositoryRoot, packageDirectory, 'upstream-manifest.json'));
  if (sha256(bytes) !== HYOSAN_SOURCE_MANIFEST_SHA256 || !bytes.equals(preserved)) {
    throw new Error(`Hyosan upstream manifest does not match pinned commit ${HYOSAN_SOURCE_COMMIT}`);
  }
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.version !== 1 || manifest.outputFiles.length !== 3 || manifest.assets.length !== 15) {
    throw new Error('Unsupported Hyosan upstream manifest shape');
  }
  return { manifest, bytesByPath: await verifyUpstreamFileSet(root, manifest, bytes) };
}

const contentType = (path) => {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.glb')) return 'model/gltf-binary';
  if (path.endsWith('.webp')) return 'image/webp';
  throw new Error(`Unsupported Hyosan content type: ${path}`);
};

/** This pinned bundle has six media roots and two HTML bundle references. */
export function relocateHyosanBuild(outputFiles, bytesByPath) {
  const files = new Map();
  const renamed = new Map();
  let mediaReplacements = 0;
  let bundleReplacements = 0;
  for (const descriptor of outputFiles.filter((entry) => entry.path !== 'index.html')) {
    const original = bytesByPath.get(descriptor.path);
    let text = original.toString('utf8');
    if (!Buffer.from(text).equals(original)) throw new Error(`Hyosan build output is not UTF-8: ${descriptor.path}`);
    mediaReplacements += text.split(developmentAssetRoot).length - 1;
    text = text.replaceAll(developmentAssetRoot, `${HYOSAN_POPUP_BASE}media/`);
    const bytes = Buffer.from(text);
    const extension = descriptor.path.endsWith('.js') ? 'js' : descriptor.path.endsWith('.css') ? 'css' : null;
    if (!extension || !/^assets\/[^/]+\.(js|css)$/.test(descriptor.path)) throw new Error('Unsupported Hyosan built output path');
    const name = `assets/index-${sha256(bytes).slice(0, 16)}.${extension}`;
    renamed.set(descriptor.path, name);
    files.set(name, bytes);
  }
  let html = bytesByPath.get('index.html').toString('utf8');
  for (const [before, after] of renamed) {
    const from = `"/${before}"`;
    const count = html.split(from).length - 1;
    if (count !== 1) throw new Error(`Hyosan HTML must refer to each bundle once: ${before}`);
    bundleReplacements += count;
    html = html.replaceAll(from, `"${HYOSAN_POPUP_BASE}${after}"`);
  }
  files.set('index.html', Buffer.from(html));
  if (mediaReplacements !== 6 || bundleReplacements !== 2) throw new Error('Hyosan pinned URL replacement count changed');
  for (const [path, bytes] of files) {
    assertNoDevelopmentDriver(bytes, path);
    if (bytes.includes(Buffer.from(developmentAssetRoot)) || bytes.includes(Buffer.from('"/assets/'))) {
      throw new Error(`Hyosan build contains an unrelocated root URL: ${path}`);
    }
  }
  return { files, mediaReplacements, bundleReplacements };
}

const descriptorFor = (path, bytes) => ({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });

export async function packageAouadHyosan(sourceDirectory) {
  const { manifest: upstream, bytesByPath } = await readPinnedUpstream(sourceDirectory);
  const relocated = relocateHyosanBuild(upstream.outputFiles, bytesByPath);
  const payloads = new Map(relocated.files);
  for (const asset of upstream.assets) payloads.set(`media/${asset.name}`, bytesByPath.get(asset.original.path));
  const files = {};
  const encodedFiles = new Map();
  for (const [path, bytes] of [...payloads].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const encodings = {};
    const originalAsset = upstream.assets.find((asset) => `media/${asset.name}` === path);
    const variants = originalAsset?.encodings.br ? {
      br: bytesByPath.get(originalAsset.encodings.br.path),
      gzip: bytesByPath.get(originalAsset.encodings.gzip.path),
    } : /\.(html|js|css)$/.test(path) ? {
      br: await brotli(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }),
      gzip: await zip(bytes),
    } : {};
    for (const [encoding, encoded] of Object.entries(variants)) {
      const encodedPath = `__encoded/${encoding}/${path}`;
      const decoded = encoding === 'br' ? await unbrotli(encoded) : await unzip(encoded);
      if (!decoded.equals(bytes)) throw new Error(`Hyosan final compression drifted: ${encodedPath}`);
      encodings[encoding] = descriptorFor(encodedPath, encoded);
      encodedFiles.set(encodedPath, encoded);
    }
    files[path] = { ...descriptorFor(path, bytes), contentType: contentType(path), encodings };
  }
  const capsule = JSON.parse(await readFile(join(repositoryRoot, packageDirectory, 'upstream-source-manifest.json'), 'utf8'));
  if (capsule.commit !== HYOSAN_SOURCE_COMMIT || capsule.archive.path !== 'upstream-source.tar.gz'
    || capsule.archive.sha256 !== HYOSAN_SOURCE_CAPSULE_SHA256) throw new Error('Hyosan source capsule pin differs');
  const capsuleBytes = await readFile(join(repositoryRoot, packageDirectory, capsule.archive.path));
  verifyDescriptorBytes(capsuleBytes, capsule.archive);
  const manifest = {
    version: 1,
    basePath: HYOSAN_POPUP_BASE,
    source: {
      commit: HYOSAN_SOURCE_COMMIT,
      manifestSha256: HYOSAN_SOURCE_MANIFEST_SHA256,
      manifestPath: `${packageDirectory}/upstream-manifest.json`,
      capsulePath: `${packageDirectory}/${capsule.archive.path}`,
      capsuleSha256: capsule.archive.sha256,
      upstreamFiles: 45,
      productionQaDriverAbsent: true,
      relocation: { mediaRoots: relocated.mediaReplacements, bundleReferences: relocated.bundleReplacements },
    },
    files,
  };
  await mkdir(dirname(outputDirectory), { recursive: true });
  const staged = await mkdtemp(join(dirname(outputDirectory), '.aouad-hyosan-'));
  try {
    for (const [path, bytes] of [...payloads, ...encodedFiles]) {
      assertSafeRelativePath(path);
      await mkdir(dirname(join(staged, path)), { recursive: true });
      await writeFile(join(staged, path), bytes);
    }
    const existing = await lstat(outputDirectory).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Hyosan output root is not a regular directory');
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(staged, outputDirectory);
    await writeFile(join(repositoryRoot, packageDirectory, 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
  return manifest;
}

export function parsePackageArguments(args) {
  if (args.length !== 2 || args[0] !== '--source-directory' || !args[1]) {
    throw new Error('Usage: node scripts/package-aouad-hyosan.mjs --source-directory <pinned-showcase-site>');
  }
  return args[1];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  packageAouadHyosan(parsePackageArguments(process.argv.slice(2))).then((manifest) => {
    console.log(`AOUAD Hyosan package verified: ${Object.keys(manifest.files).length} request files, source ${manifest.source.commit}`);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
