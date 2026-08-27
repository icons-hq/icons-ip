import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDirectSessionRunner } from './direct-session.mjs';
import { runAssetPipeline } from './pipeline.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, '../..');
export async function runDirectAssetPipeline({
  repositoryRoot = defaultRepositoryRoot,
  specPath = resolve(scriptDirectory, 'asset-spec.yaml'),
  inputDirectory = resolve(repositoryRoot, 'outputs/hyosan-memories-m0/direct-input'),
  sessionPath = resolve(repositoryRoot, 'outputs/hyosan-memories-m0/direct-session.json'),
} = {}) {
  return runAssetPipeline({
    specPath,
    repositoryRoot,
    runnerFactory: () => createDirectSessionRunner({
      repositoryRoot,
      inputDirectory,
      sessionPath,
    }),
  });
}

function usage() {
  return [
    'Usage: node scripts/asset-pipeline/index.mjs [options]',
    '',
    'Options:',
    '  --spec <path>             asset-spec.yaml path',
    '  --input <directory>       direct Codex app imagegen candidates',
    '  --session <path>          direct-session.json with prompts and vision QA',
    '  --repository-root <path>  repository root',
    '  --help                    show this help',
  ].join('\n');
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      spec: { type: 'string' },
      input: { type: 'string' },
      session: { type: 'string' },
      'repository-root': { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help) {
    console.log(usage());
    return;
  }
  const repositoryRoot = resolve(values['repository-root'] ?? defaultRepositoryRoot);
  const result = await runDirectAssetPipeline({
    repositoryRoot,
    specPath: resolve(values.spec ?? resolve(scriptDirectory, 'asset-spec.yaml')),
    inputDirectory: resolve(values.input ?? resolve(repositoryRoot, 'outputs/hyosan-memories-m0/direct-input')),
    sessionPath: resolve(values.session ?? resolve(repositoryRoot, 'outputs/hyosan-memories-m0/direct-session.json')),
  });
  console.log(JSON.stringify({
    status: result.manifest.status,
    assets: result.manifest.assets.map(({ id, selectedAttempt, status }) => ({
      id,
      selectedAttempt,
      status,
    })),
    manifest: resolve(result.outputDirectory, 'asset-manifest.json'),
    qaReport: resolve(result.outputDirectory, 'qa-report.json'),
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
