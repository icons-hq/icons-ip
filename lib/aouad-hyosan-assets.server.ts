import 'server-only';

import { constants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';
import manifest from '@/components/online-popup/aouad/hyosan/package-manifest.json';
import { canViewAouadPopup } from '@/lib/aouad-popup.server';

const ASSET_ROOT = join(process.cwd(), 'private/ip-popups/aouad-hyosan');

type Encoding = 'br' | 'gzip' | 'identity';
type Representation = { path: string; bytes: number; sha256: string };
type PackageFile = Representation & {
  contentType: string;
  encodings?: Partial<Record<Exclude<Encoding, 'identity'>, Representation>>;
};
const FILES: Readonly<Record<string, PackageFile>> = manifest.files;

function responseHeaders() {
  return new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'Vary': 'Cookie, Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'none'; object-src 'none'",
  });
}

function packageFile(parts: string[]): PackageFile | undefined {
  if (!Array.isArray(parts) || !parts.length
    || parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))) return;
  const name = parts.join('/');
  return Object.hasOwn(FILES, name) ? FILES[name] : undefined;
}

/** Prefer a requested compressed representation; identity remains the HTTP fallback. */
export function selectHyosanEncoding(header: string | null, file: PackageFile): Encoding | null {
  if (!header?.trim()) return 'identity';
  const weights = new Map<string, number>();
  for (const entry of header.split(',')) {
    const [name, ...parameters] = entry.toLowerCase().trim().split(/\s*;\s*/);
    const raw = parameters.find(parameter => parameter.startsWith('q='))?.slice(2) ?? '1';
    const quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? Number(raw) : 0;
    weights.set(name, Math.max(weights.get(name) ?? 0, quality));
  }
  const available: Encoding[] = ['identity'];
  if (file.encodings?.gzip) available.unshift('gzip');
  if (file.encodings?.br) available.unshift('br');
  const quality = (encoding: Encoding) => weights.get(encoding)
    ?? (encoding === 'identity' ? 0 : weights.get('*') ?? 0);
  available.sort((a, b) => quality(b) - quality(a));
  if (quality(available[0]) > 0) return available[0];
  return (weights.get('identity') ?? (weights.get('*') === 0 ? 0 : 1)) > 0 ? 'identity' : null;
}

/** Only this presentation's packaged files are exposed; the Next development API stays closed. */
export async function createAouadHyosanAssetResponse(request: Request, parts: string[]): Promise<Response> {
  const headers = responseHeaders();
  let file: FileHandle | undefined;
  try {
    if (!(await canViewAouadPopup())) return new Response(null, { status: 404, headers });
    const original = packageFile(parts);
    if (!original) return new Response(null, { status: 404, headers });
    const encoding = selectHyosanEncoding(request.headers.get('accept-encoding'), original);
    if (!encoding) return new Response(null, { status: 406, headers });
    const selected = encoding === 'identity' ? original : original.encodings![encoding]!;
    const pathname = join(ASSET_ROOT, selected.path);
    const root = await realpath(ASSET_ROOT);
    const resolved = await realpath(pathname);
    if (resolved !== `${root}${sep}${selected.path}`) {
      return new Response(null, { status: 404, headers });
    }
    file = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) return new Response(null, { status: 404, headers });
    if (stat.size !== selected.bytes) return new Response(null, { status: 503, headers });

    headers.set('Content-Type', original.contentType);
    headers.set('Content-Length', String(selected.bytes));
    if (encoding !== 'identity') headers.set('Content-Encoding', encoding);
    if (request.method === 'HEAD' || selected.bytes === 0) return new Response(null, { status: 200, headers });

    // GLB and engine bundles exceed buffered response limits. Stream precompressed bytes.
    const stream = file.createReadStream({ autoClose: true });
    file = undefined;
    const abort = () => stream.destroy();
    request.signal.addEventListener('abort', abort, { once: true });
    stream.once('close', () => request.signal.removeEventListener('abort', abort));
    if (request.signal.aborted) abort();
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return new Response(null, { status: code === 'ENOENT' || code === 'ELOOP' ? 404 : 503, headers });
  } finally {
    await file?.close();
  }
}
