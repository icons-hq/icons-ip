import 'server-only';

import { constants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { Readable } from 'node:stream';

type Encoding = 'br' | 'gzip' | 'identity';
type Representation = { path: string; bytes: number; sha256: string };
export type PopupAsset = Representation & {
  contentType: string;
  encodings?: Partial<Record<Exclude<Encoding, 'identity'>, Representation>>;
};
type PopupAssetSource = {
  root: string;
  files: Readonly<Record<string, PopupAsset>>;
  canView: () => Promise<boolean>;
};

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

function assetFile(parts: string[], files: PopupAssetSource['files']): PopupAsset | undefined {
  if (!Array.isArray(parts) || !parts.length
    || parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))) return;
  const name = parts.join('/');
  return Object.hasOwn(files, name) ? files[name] : undefined;
}

/** Prefer a requested compressed representation; identity remains the HTTP fallback. */
export function selectAssetEncoding(header: string | null, file: PopupAsset): Encoding | null {
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

type ByteRange = { start: number; end: number };
function byteRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (!value) return null;
  // Other units and multiple ranges may be ignored. This endpoint supports one byte range.
  if (!value.startsWith('bytes=') || value.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return 'invalid';
  if (!match[1]) {
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || length <= 0) return 'invalid';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start >= size || start > end) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

/** Access, allowlist and realpath checks precede every cache validator, including HEAD. */
export async function createPopupAssetResponse(request: Request, parts: string[], source: PopupAssetSource): Promise<Response> {
  const headers = responseHeaders();
  let file: FileHandle | undefined;
  try {
    if (!(await source.canView())) return new Response(null, { status: 404, headers });
    const original = assetFile(parts, source.files);
    if (!original) return new Response(null, { status: 404, headers });
    const encoding = selectAssetEncoding(request.headers.get('accept-encoding'), original);
    if (!encoding) return new Response(null, { status: 406, headers });
    const selected = encoding === 'identity' ? original : original.encodings![encoding]!;
    const pathname = join(source.root, selected.path);
    const root = await realpath(source.root);
    const resolved = await realpath(pathname);
    if (resolved !== `${root}${sep}${selected.path}`) return new Response(null, { status: 404, headers });
    file = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) return new Response(null, { status: 404, headers });
    if (stat.size !== selected.bytes) return new Response(null, { status: 503, headers });

    const etag = `"${selected.sha256}"`;
    headers.set('Content-Type', original.contentType);
    headers.set('Accept-Ranges', 'bytes');
    if (encoding !== 'identity') headers.set('Content-Encoding', encoding);
    const matches = request.headers.get('if-none-match')?.split(',').some(value => {
      const tag = value.trim();
      return tag === '*' || tag.replace(/^W\//, '') === etag;
    });
    if (matches) {
      headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
      headers.set('ETag', etag);
      return new Response(null, { status: 304, headers });
    }
    const ifRange = request.headers.get('if-range');
    const range = request.method === 'HEAD' || (ifRange !== null && ifRange !== etag)
      ? null : byteRange(request.headers.get('range'), selected.bytes);
    if (range === 'invalid') {
      headers.set('Content-Range', `bytes */${selected.bytes}`);
      return new Response(null, { status: 416, headers });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? selected.bytes - 1;
    headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    headers.set('ETag', etag);
    headers.set('Content-Length', String(range ? end - start + 1 : selected.bytes));
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${selected.bytes}`);
    if (request.method === 'HEAD' || selected.bytes === 0) return new Response(null, { status: 200, headers });

    const stream = file.createReadStream({ start, end, autoClose: true });
    file = undefined; // The stream closes the descriptor, including on cancellation.
    const abort = () => stream.destroy();
    request.signal.addEventListener('abort', abort, { once: true });
    stream.once('close', () => request.signal.removeEventListener('abort', abort));
    if (request.signal.aborted) abort();
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return new Response(null, { status: code === 'ENOENT' || code === 'ELOOP' ? 404 : 503, headers: responseHeaders() });
  } finally {
    await file?.close();
  }
}
