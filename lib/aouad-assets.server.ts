import 'server-only';

import { constants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import assetIndex from '@/components/online-popup/aouad/asset-index.json';
import { canViewAouadPopup } from '@/lib/aouad-popup.server';

const ASSET_ROOT = join(process.cwd(), 'private/ip-popups/aouad');
const ASSETS = new Set(Object.keys(assetIndex));
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.json': 'application/json',
};

function privateHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'Vary': 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  });
}

/** Only checked-in media can be requested; decoded/encoded separators never form a filename. */
function assetName(parts: string[]): string | null {
  if (!Array.isArray(parts) || !parts.length
    || parts.some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))) return null;
  const name = parts.join('/');
  return ASSETS.has(name) ? name : null;
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

/** GET and HEAD share the same staff/kill-switch boundary before any file is opened. */
export async function createAouadAssetResponse(request: Request, parts: string[]): Promise<Response> {
  const headers = privateHeaders();
  let file: FileHandle | undefined;
  try {
    if (!(await canViewAouadPopup())) return new Response(null, { status: 404, headers });
    const name = assetName(parts);
    if (!name) return new Response(null, { status: 404, headers });

    // Keep filesystem operations anchored to the private directory for Next's file tracer.
    const pathname = join(ASSET_ROOT, name);
    const root = await realpath(ASSET_ROOT);
    const resolved = await realpath(pathname);
    if (!resolved.startsWith(`${root}${sep}`) || resolved !== `${root}${sep}${name}`) {
      return new Response(null, { status: 404, headers });
    }
    file = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) return new Response(null, { status: 404, headers });

    headers.set('Content-Type', CONTENT_TYPES[extname(name)] ?? 'application/octet-stream');
    headers.set('Accept-Ranges', 'bytes');
    // No validator is advertised for private, no-store media. An If-Range request gets the full body.
    const range = request.method === 'HEAD' || request.headers.has('if-range')
      ? null : byteRange(request.headers.get('range'), stat.size);
    if (range === 'invalid') {
      headers.set('Content-Range', `bytes */${stat.size}`);
      return new Response(null, { status: 416, headers });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? stat.size - 1;
    headers.set('Content-Length', String(range ? end - start + 1 : stat.size));
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status: 200, headers });

    const stream = file.createReadStream({ start, end, autoClose: true });
    file = undefined; // The stream owns and closes the descriptor, including cancellation.
    const abort = () => stream.destroy();
    request.signal.addEventListener('abort', abort, { once: true });
    stream.once('close', () => request.signal.removeEventListener('abort', abort));
    if (request.signal.aborted) abort();
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return new Response(null, { status: code === 'ENOENT' || code === 'ELOOP' ? 404 : 503, headers });
  } finally {
    await file?.close();
  }
}
