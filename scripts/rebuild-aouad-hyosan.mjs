import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import {
  HYOSAN_SOURCE_CAPSULE_SHA256, HYOSAN_SOURCE_COMMIT, HYOSAN_SOURCE_MANIFEST_SHA256,
  assertSafeRelativePath, readPinnedUpstream, sha256, verifyDescriptorBytes,
} from './package-aouad-hyosan.mjs';

const run = promisify(execFile);
const unzip = promisify(gunzip);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = join(repositoryRoot, 'components/online-popup/aouad/hyosan');

/** The pinned git archive only contains regular files, directories and its commit comment. */
export function readHyosanSourceTar(tar) {
  const files = new Map();
  let commit;
  let offset = 0;
  const string = (buffer) => buffer.toString('utf8').split('\0')[0];
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (Number.parseInt(string(header.subarray(148, 156)).trim(), 8) !== checksum) throw new Error('Hyosan capsule tar checksum differs');
    const size = Number.parseInt(string(header.subarray(124, 136)).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid Hyosan capsule tar size');
    const type = String.fromCharCode(header[156]);
    const prefix = string(header.subarray(345, 500));
    const name = string(header.subarray(0, 100));
    const path = prefix ? `${prefix}/${name}` : name;
    const bytes = tar.subarray(offset + 512, offset + 512 + size);
    if (type === 'g' && path === 'pax_global_header') {
      const match = /^\d+ comment=([a-f0-9]{40})\n$/.exec(bytes.toString('utf8'));
      if (!match || commit) throw new Error('Unsupported Hyosan git archive metadata');
      commit = match[1];
    } else if (type === '5') {
      assertSafeRelativePath(path.replace(/\/$/, ''));
      if (size !== 0) throw new Error('Hyosan capsule directory has a payload');
    } else if (type === '0' || type === '\0') {
      assertSafeRelativePath(path);
      if (files.has(path)) throw new Error(`Duplicate Hyosan capsule path: ${path}`);
      files.set(path, Buffer.from(bytes));
    } else {
      throw new Error(`Unsupported Hyosan capsule tar entry: ${path}`);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (commit !== HYOSAN_SOURCE_COMMIT) throw new Error('Hyosan git archive commit differs');
  return files;
}

/** Restore source plus exact original media from this repo, without another checkout or git remote. */
export async function restoreHyosanSource(workDirectory) {
  if (typeof workDirectory !== 'string' || !workDirectory) throw new Error('--work-directory is required');
  const target = resolve(workDirectory);
  if (target === repositoryRoot || target.startsWith(`${repositoryRoot}${sep}`)) throw new Error('Rebuild work directory must be outside this repository');
  const existing = await lstat(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(target)).length)) {
    throw new Error('Rebuild work directory must be an empty regular directory');
  }
  const capsule = JSON.parse(await readFile(join(sourceDirectory, 'upstream-source-manifest.json'), 'utf8'));
  if (capsule.commit !== HYOSAN_SOURCE_COMMIT || capsule.archive.path !== 'upstream-source.tar.gz'
    || capsule.archive.sha256 !== HYOSAN_SOURCE_CAPSULE_SHA256) throw new Error('Hyosan source capsule pin differs');
  const archive = await readFile(join(sourceDirectory, capsule.archive.path));
  verifyDescriptorBytes(archive, capsule.archive);
  const files = readHyosanSourceTar(await unzip(archive, { maxOutputLength: 8 * 1024 * 1024 }));
  const expectedPaths = capsule.files.map((file) => assertSafeRelativePath(file.path)).sort();
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(expectedPaths)) throw new Error('Hyosan source capsule file set differs');
  for (const descriptor of capsule.files) verifyDescriptorBytes(files.get(descriptor.path), descriptor);

  const upstreamBytes = await readFile(join(sourceDirectory, 'upstream-manifest.json'));
  if (sha256(upstreamBytes) !== HYOSAN_SOURCE_MANIFEST_SHA256) throw new Error('Hyosan original manifest pin differs');
  const upstream = JSON.parse(upstreamBytes.toString('utf8'));
  for (const asset of upstream.assets) {
    assertSafeRelativePath(asset.name);
    const assetPath = assertSafeRelativePath(asset.source);
    const bytes = await readFile(join(repositoryRoot, 'private/ip-popups/aouad-hyosan/media', asset.name));
    verifyDescriptorBytes(bytes, asset.original);
    if (files.has(assetPath)) throw new Error('Hyosan media duplicates source capsule contents');
    files.set(assetPath, bytes);
  }
  await mkdir(target, { recursive: true });
  const canonical = await realpath(target);
  const canonicalRepository = await realpath(repositoryRoot);
  if (canonical === canonicalRepository || canonical.startsWith(`${canonicalRepository}${sep}`)) throw new Error('Rebuild work directory resolves into this repository');
  for (const [path, bytes] of files) {
    await mkdir(dirname(join(canonical, path)), { recursive: true });
    await writeFile(join(canonical, path), bytes, { flag: 'wx' });
  }
  return canonical;
}

export async function rebuildAouadHyosan(workDirectory) {
  const cwd = await restoreHyosanSource(workDirectory);
  console.log(`Restored pinned Hyosan source ${HYOSAN_SOURCE_COMMIT}`);
  // No postinstall helper, Next build, Supabase preparation or DB mutation is run.
  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, maxBuffer: 8 * 1024 * 1024 });
  const build = await run('npm', ['run', 'build:hyosan-showcase'], { cwd, maxBuffer: 8 * 1024 * 1024 });
  console.log(build.stdout.trim());
  const site = join(cwd, 'output/hyosan-showcase/site');
  await readPinnedUpstream(site);
  console.log(`Pinned manifest and all 45 output files reproduced: ${site}`);
  return site;
}

export function parseRebuildArguments(args) {
  if (args.length !== 2 || args[0] !== '--work-directory' || !args[1]) {
    throw new Error('Usage: node scripts/rebuild-aouad-hyosan.mjs --work-directory <empty-directory-outside-repo>');
  }
  return args[1];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  rebuildAouadHyosan(parseRebuildArguments(process.argv.slice(2))).catch((error) => {
    console.error(error.stderr || error.message);
    process.exitCode = 1;
  });
}
