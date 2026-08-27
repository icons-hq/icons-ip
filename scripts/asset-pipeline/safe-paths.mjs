import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function isInside(parent, child, allowSame = true) {
  const path = relative(parent, child);
  if (path === '') return allowSame;
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

export async function assertContainedPath(repositoryRoot, target, field, { allowRoot = false } = {}) {
  const lexicalRoot = resolve(repositoryRoot);
  const lexicalTarget = resolve(target);
  if (!isInside(lexicalRoot, lexicalTarget, allowRoot)) {
    throw new Error(`${field} must resolve inside the repository root`);
  }
  const realRoot = await realpath(lexicalRoot);
  const segments = relative(lexicalRoot, lexicalTarget).split(sep).filter(Boolean);
  let lexicalCurrent = lexicalRoot;
  let realCurrent = realRoot;
  for (let index = 0; index < segments.length; index += 1) {
    lexicalCurrent = join(lexicalCurrent, segments[index]);
    try {
      realCurrent = await realpath(lexicalCurrent);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const projected = resolve(realCurrent, ...segments.slice(index));
      if (!isInside(realRoot, projected, false)) {
        throw new Error(`${field} resolves outside the repository root`);
      }
      return lexicalTarget;
    }
    if (!isInside(realRoot, realCurrent, true)) {
      throw new Error(`${field} resolves outside the repository root`);
    }
  }
  if (!allowRoot && realCurrent === realRoot) {
    throw new Error(`${field} resolves to the repository root`);
  }
  return lexicalTarget;
}

export async function assertExistingPathContained(parent, target, field) {
  const realParent = await realpath(resolve(parent));
  const realTarget = await realpath(resolve(target));
  if (!isInside(realParent, realTarget, true)) {
    throw new Error(`${field} escapes the real input directory`);
  }
  return realTarget;
}

export async function writeFileAtomically(target, data) {
  await mkdir(dirname(target), { recursive: true });
  const temporaryPath = join(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, data, { flag: 'wx' });
    await rename(temporaryPath, target);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function copyFileAtomically(source, target) {
  await writeFileAtomically(target, await readFile(source));
}
