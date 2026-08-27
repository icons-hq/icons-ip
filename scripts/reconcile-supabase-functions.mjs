/*
 * Version-controlled Supabase Edge Functions를 대상 project ref와 일치시킨다.
 *
 * 로컬 함수가 있으면 전체를 deploy+prune한다. 마지막 함수가 삭제돼 로컬 디렉터리가
 * 비면 CLI의 prune 대상 자체가 없으므로, 원격 목록을 읽어 안전한 이름만 명시 삭제한다.
 */

import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function parseRemoteFunctionNames(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Supabase function list did not return an array');
  }

  return parsed
    .map((entry) => entry?.name)
    .filter((name) => typeof name === 'string' && name.length > 0)
    .map((name) => {
      if (!FUNCTION_NAME_PATTERN.test(name)) {
        throw new Error(`unsafe Edge Function name: ${name}`);
      }
      return name;
    });
}

export async function listLocalFunctionNames(functionsRoot = 'supabase/functions') {
  let entries;
  try {
    entries = await readdir(functionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
    .map((entry) => entry.name)
    .sort();
}

function invokeSupabase(args, { capture = false } = {}) {
  const result = spawnSync('supabase', args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`supabase ${args.join(' ')} exited with ${result.status}`);
  }
  return capture ? result.stdout : '';
}

export async function reconcileSupabaseFunctions({
  projectRef = process.env.PROJECT_REF,
  functionsRoot = 'supabase/functions',
  invoke = invokeSupabase,
  log = console.log,
} = {}) {
  if (!PROJECT_REF_PATTERN.test(projectRef ?? '')) {
    throw new Error('PROJECT_REF must be a 20-character lowercase Supabase project ref');
  }

  const localFunctionNames = await listLocalFunctionNames(functionsRoot);
  if (localFunctionNames.length > 0) {
    invoke([
      'functions',
      'deploy',
      '--project-ref',
      projectRef,
      '--use-api',
      '--prune',
      '--yes',
    ]);
    log(`Reconciled ${localFunctionNames.length} Edge Function(s) for ${projectRef}.`);
    return { action: 'deploy', localFunctionNames };
  }

  const remoteFunctionNames = parseRemoteFunctionNames(invoke([
    'functions',
    'list',
    '--project-ref',
    projectRef,
    '--output',
    'json',
  ], { capture: true }));
  for (const functionName of remoteFunctionNames) {
    invoke([
      'functions',
      'delete',
      functionName,
      '--project-ref',
      projectRef,
      '--yes',
    ]);
  }
  log(`Reconciled empty Edge Function set for ${projectRef}.`);
  return { action: 'delete', remoteFunctionNames };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reconcileSupabaseFunctions().catch((error) => {
    console.error(`::error title=Supabase Edge Function sync failed::${error.message}`);
    process.exit(1);
  });
}
