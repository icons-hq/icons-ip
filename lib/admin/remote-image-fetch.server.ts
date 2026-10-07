import 'server-only';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import { ADMIN_ARTWORK_MAX_BYTES, type AdminArtworkMimeType } from './artwork';

/*
 * 운영자가 엑셀에 적은 외부 이미지 주소를 서버가 직접 내려받는 유일한 경로다.
 * 주소는 사람이 입력한 값이므로 SSRF 경계로 다룬다.
 * - https만 연결한다. http는 같은 주소의 https로 바꿔 시도하고, 사용자 정보·비표준 포트는 거부한다.
 * - DNS 결과가 하나라도 공인 유니캐스트가 아니면 거부하고(사설·루프백·링크로컬·CGNAT·멀티캐스트·
 *   예약·IPv4-mapped IPv6 포함), 검증한 그 주소로만 소켓을 연다. 리다이렉트는 직접 따라가며
 *   홉마다 같은 검사를 반복한다.
 * - 응답은 JPEG·PNG·WebP Content-Type과 파일 서명이 모두 맞아야 하고, 용량 상한을 넘으면
 *   스트림을 즉시 끊는다. 한 장의 전체 시간은 10초를 넘지 않는다.
 */
export const REMOTE_IMAGE_TIMEOUT_MS = 10_000;
export const REMOTE_IMAGE_MAX_REDIRECTS = 3;
export const REMOTE_IMAGE_CONCURRENCY = 4;

const CONTENT_TYPES: Record<string, AdminArtworkMimeType> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
};
const MESSAGES = {
  url: '공개 HTTPS 이미지 URL만 사용할 수 있습니다.',
  private: '내부 네트워크 이미지 URL은 사용할 수 없습니다.',
  dns: '이미지 주소의 서버를 찾지 못했습니다.',
  redirect: '이미지 주소가 너무 여러 번 다른 주소로 넘어갑니다.',
  status: '이미지 URL에서 파일을 내려받지 못했습니다.',
  type: '이미지 URL의 응답이 JPEG·PNG·WebP 이미지가 아닙니다.',
  size: '이미지는 5MB 이하여야 합니다.',
  timeout: '이미지 URL 응답 시간이 초과됐습니다.',
} as const;

export type RemoteImage = {
  bytes: Buffer;
  mimeType: AdminArtworkMimeType;
  /** The final https URL after upgrades and redirects. */
  url: string;
};
export type RemoteImageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function isPublicImageAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export function sniffImageMime(bytes: Uint8Array): AdminArtworkMimeType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return 'image/png';
  if (
    Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Returns the https URL that will be requested, or null when the reference cannot be fetched safely. */
export function normalizeRemoteImageUrl(source: string): URL | null {
  const text = source.trim();
  if (!text || /[\u0000- \u007f\\]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text.startsWith('//') ? `https:${text}` : text);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') {
    if (url.port && url.port !== '80') return null;
    url.protocol = 'https:';
    url.port = '';
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    return null;
  return url;
}

function remaining(deadline: number) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error(MESSAGES.timeout);
  return left;
}

async function resolvePublicAddress(hostname: string, deadline: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: { address: string; family: number }[];
  try {
    addresses = await Promise.race([
      lookup(hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(MESSAGES.timeout)),
          Math.min(5000, remaining(deadline)),
        );
      }),
    ]);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message === MESSAGES.timeout
        ? MESSAGES.timeout
        : MESSAGES.dns,
    );
  } finally {
    clearTimeout(timer);
  }
  if (
    !addresses.length ||
    addresses.some((result) => !isPublicImageAddress(result.address))
  )
    throw new Error(MESSAGES.private);
  return addresses[0];
}

type Hop =
  | { kind: 'redirect'; location: string }
  | { kind: 'image'; bytes: Buffer; contentType: AdminArtworkMimeType };

function requestHop(
  url: URL,
  pinned: { address: string; family: number },
  deadline: number,
  maxBytes: number,
): Promise<Hop> {
  const wait = remaining(deadline);
  return new Promise((resolve, reject) => {
    const state: { settled: boolean; timer?: ReturnType<typeof setTimeout> } = { settled: false };
    const finish = (error: Error | null, hop?: Hop) => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(state.timer);
      if (error) reject(error);
      else resolve(hop!);
    };
    const req = request(
      url,
      {
        method: 'GET',
        agent: false,
        family: pinned.family,
        // The socket may only reach the address that passed the public-range check.
        lookup: (_host, options, callback) => {
          if (options?.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
        headers: {
          Accept: 'image/jpeg,image/png,image/webp',
          'User-Agent': 'ICONS-goods-import/1',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          finish(null, { kind: 'redirect', location: response.headers.location });
          return;
        }
        if (status !== 200) {
          response.resume();
          finish(new Error(MESSAGES.status));
          return;
        }
        const contentType =
          CONTENT_TYPES[
            String(response.headers['content-type'] ?? '')
              .split(';')[0]
              .trim()
              .toLowerCase()
          ];
        if (!contentType) {
          response.destroy();
          finish(new Error(MESSAGES.type));
          return;
        }
        if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
          response.destroy();
          finish(new Error(MESSAGES.size));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            finish(new Error(MESSAGES.size));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', () => finish(new Error(MESSAGES.status)));
        response.on('end', () =>
          finish(null, { kind: 'image', bytes: Buffer.concat(chunks), contentType }),
        );
      },
    );
    state.timer = setTimeout(() => {
      finish(new Error(MESSAGES.timeout));
      req.destroy();
    }, wait);
    req.on('error', (error) =>
      finish(error.message === MESSAGES.timeout ? error : new Error(MESSAGES.status)),
    );
    req.end();
  });
}

export async function fetchRemoteImage(
  source: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<RemoteImage> {
  const deadline = Date.now() + (options.timeoutMs ?? REMOTE_IMAGE_TIMEOUT_MS);
  const maxBytes = options.maxBytes ?? ADMIN_ARTWORK_MAX_BYTES;
  let current = normalizeRemoteImageUrl(source);
  for (let hops = 0; ; hops++) {
    if (!current) throw new Error(MESSAGES.url);
    const pinned = await resolvePublicAddress(current.hostname, deadline);
    const hop = await requestHop(current, pinned, deadline, maxBytes);
    if (hop.kind === 'image') {
      const sniffed = sniffImageMime(hop.bytes);
      if (!sniffed) throw new Error(MESSAGES.type);
      return { bytes: hop.bytes, mimeType: sniffed, url: current.toString() };
    }
    if (hops >= REMOTE_IMAGE_MAX_REDIRECTS) throw new Error(MESSAGES.redirect);
    let next: string;
    try {
      next = new URL(hop.location, current).toString();
    } catch {
      throw new Error(MESSAGES.url);
    }
    current = normalizeRemoteImageUrl(next);
  }
}

/**
 * Fetches distinct sources with bounded concurrency and hands each image to `store`
 * before the next fetch, so at most `concurrency` images are held in memory.
 * Sources past `limit` or started after `deadline` are reported, never fetched.
 */
export async function fetchRemoteImages<T>(
  sources: readonly string[],
  store: (image: RemoteImage, source: string) => Promise<T>,
  options: {
    concurrency?: number;
    limit?: number;
    deadline?: number;
    fetchImage?: (source: string) => Promise<RemoteImage>;
  } = {},
): Promise<Map<string, RemoteImageResult<T>>> {
  const unique = [...new Set(sources)];
  const results = new Map<string, RemoteImageResult<T>>();
  const limit = options.limit ?? unique.length;
  const fetchImage = options.fetchImage ?? ((source: string) => fetchRemoteImage(source));
  for (const source of unique.slice(limit))
    results.set(source, {
      ok: false,
      error: `한 번에 가져올 수 있는 이미지 ${limit}장을 넘었습니다.`,
    });
  const queue = unique.slice(0, limit);
  const worker = async () => {
    for (let source = queue.shift(); source !== undefined; source = queue.shift()) {
      if (options.deadline && Date.now() >= options.deadline) {
        results.set(source, { ok: false, error: '처리 시간 안에 가져오지 못했습니다.' });
        continue;
      }
      try {
        const image = await fetchImage(source);
        results.set(source, { ok: true, value: await store(image, source) });
      } catch (error) {
        results.set(source, {
          ok: false,
          error:
            error instanceof Error && /[가-힣]/.test(error.message)
              ? error.message
              : MESSAGES.status,
        });
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(options.concurrency ?? REMOTE_IMAGE_CONCURRENCY, queue.length)) },
      worker,
    ),
  );
  return results;
}
