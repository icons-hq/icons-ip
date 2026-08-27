import { pathToFileURL } from 'node:url';

const ISOLATED_PREVIEW_PATHS = [
  /^supabase\/migrations\//,
  /^supabase\/functions\//,
  /^supabase\/templates\//,
  /^supabase\/(?:roles\.sql|seed\.sql)$/,
  /^scripts\/sync-supabase-auth\.mjs$/,
  /^scripts\/reconcile-supabase-functions\.mjs$/,
  /^scripts\/preview-supabase-mode\.mjs$/,
  /^\.github\/workflows\/(?:pipeline|supabase-preview-cleanup)\.yml$/,
];

function normalizePath(filePath) {
  return filePath.trim().replace(/^\.\//, '');
}

export function requiresIsolatedPreviewDatabase(filePath) {
  const normalizedPath = normalizePath(filePath);
  return normalizedPath.length > 0
    && ISOLATED_PREVIEW_PATHS.some((pattern) => pattern.test(normalizedPath));
}

export function determinePreviewDatabaseMode(filePaths) {
  return filePaths.some(requiresIsolatedPreviewDatabase) ? 'isolated' : 'shared';
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);

  const input = Buffer.concat(chunks).toString('utf8');
  const separator = input.includes('\0') ? '\0' : '\n';
  const filePaths = input.split(separator).filter(Boolean);
  process.stdout.write(`${determinePreviewDatabaseMode(filePaths)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
