import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 어드민 계약 테스트(action-guard·uuid-revalidation)가 소스를 전수 스캔할 때 쓰는 도구. 런타임 코드에서 import하지 않는다. */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface ScannedSource { path: string; text: string }

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return name === 'node_modules' ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** 테스트가 아닌 .ts·.tsx 소스 전부. 경로는 저장소 루트 기준이다. */
export function scanSources(dirs: readonly string[]): ScannedSource[] {
  return dirs.flatMap(walk).map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));
}

/** 파일 맨 앞(주석 제외)에 'use server' 지시문이 있는 파일. */
export function isServerActionSource(text: string): boolean {
  return /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*(['"])use server\1/.test(text);
}
