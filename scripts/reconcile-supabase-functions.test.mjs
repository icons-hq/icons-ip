import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseRemoteFunctionNames,
  reconcileSupabaseFunctions,
} from './reconcile-supabase-functions.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    force: true,
    recursive: true,
  })));
});

async function makeFunctionsRoot(names = []) {
  const root = await mkdtemp(join(tmpdir(), 'icons-ip-functions-'));
  temporaryDirectories.push(root);
  await Promise.all(names.map((name) => mkdir(join(root, name))));
  return root;
}

describe('Supabase Edge Function reconciliation', () => {
  it('deploys and prunes the version-controlled function set', async () => {
    const functionsRoot = await makeFunctionsRoot(['_shared', 'send-mail', 'webhook']);
    const calls = [];

    await expect(reconcileSupabaseFunctions({
      projectRef: 'abcdefghijklmnopqrst',
      functionsRoot,
      invoke: (args, options) => {
        calls.push({ args, options });
        return '';
      },
      log: () => {},
    })).resolves.toEqual({
      action: 'deploy',
      localFunctionNames: ['send-mail', 'webhook'],
    });
    expect(calls).toEqual([{
      args: [
        'functions',
        'deploy',
        '--project-ref',
        'abcdefghijklmnopqrst',
        '--use-api',
        '--prune',
        '--yes',
      ],
      options: undefined,
    }]);
  });

  it('deletes safe remote names when the declared set is empty', async () => {
    const functionsRoot = await makeFunctionsRoot();
    const calls = [];

    await expect(reconcileSupabaseFunctions({
      projectRef: 'abcdefghijklmnopqrst',
      functionsRoot,
      invoke: (args, options) => {
        calls.push({ args, options });
        return options?.capture
          ? JSON.stringify([{ name: 'send-mail' }, { name: 'webhook_v2' }])
          : '';
      },
      log: () => {},
    })).resolves.toEqual({
      action: 'delete',
      remoteFunctionNames: ['send-mail', 'webhook_v2'],
    });
    expect(calls.map(({ args }) => args)).toEqual([
      ['functions', 'list', '--project-ref', 'abcdefghijklmnopqrst', '--output', 'json'],
      ['functions', 'delete', 'send-mail', '--project-ref', 'abcdefghijklmnopqrst', '--yes'],
      ['functions', 'delete', 'webhook_v2', '--project-ref', 'abcdefghijklmnopqrst', '--yes'],
    ]);
  });

  it('rejects unsafe project refs and remote names before deletion', async () => {
    const functionsRoot = await makeFunctionsRoot();
    await expect(reconcileSupabaseFunctions({
      projectRef: 'production',
      functionsRoot,
      invoke: () => '[]',
    })).rejects.toThrow('PROJECT_REF');
    expect(() => parseRemoteFunctionNames('[{"name":"../../unsafe"}]'))
      .toThrow('unsafe Edge Function name');
  });
});
