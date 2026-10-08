import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import {
  fetchRemoteImage,
  fetchRemoteImages,
  isPublicImageAddress,
  normalizeRemoteImageUrl,
  sniffImageMime,
} from './remote-image-fetch.server';

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('rest')]);
type FakeRequest = EventEmitter & { end: () => void; destroy: () => void };
function respond(status: number, headers: Record<string, string>, bytes: Buffer = PNG) {
  mocks.request.mockImplementationOnce((_url, _options, receive) => {
    const req = new EventEmitter() as FakeRequest;
    req.destroy = () => req.emit('error', new Error('socket hang up'));
    req.end = () => {
      receive(Object.assign(Readable.from([bytes]), { statusCode: status, headers }));
    };
    return req;
  });
}
type FakeResponse = EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
  destroy: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
};
/** A response whose body the test drives by hand; it never ends unless the test says so. */
function openResponse(status: number, headers: Record<string, string>) {
  const response = Object.assign(new EventEmitter(), { statusCode: status, headers }) as FakeResponse;
  response.destroy = vi.fn();
  response.resume = vi.fn();
  const req = Object.assign(new EventEmitter(), { end: () => {}, destroy: vi.fn() });
  mocks.request.mockImplementationOnce((_url, _options, receive) => {
    req.end = () => receive(response);
    return req;
  });
  return { response, req };
}
/** Sends `count` chunks `every` ms apart (fake timers), then ends the body. */
function trickle(response: FakeResponse, chunk: Buffer, every: number, count: number) {
  let sent = 0;
  const next = () => {
    if (response.destroy.mock.calls.length) return;
    if (sent === count) return void response.emit('end');
    response.emit('data', sent === 0 ? Buffer.concat([PNG, chunk]) : chunk);
    sent += 1;
    setTimeout(next, every);
  };
  setTimeout(next, every);
}
function hang() {
  mocks.request.mockImplementationOnce(() => {
    const req = new EventEmitter() as FakeRequest;
    req.destroy = () => req.emit('error', new Error('socket hang up'));
    req.end = () => {};
    return req;
  });
}

describe('remote image SSRF boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  });

  it('accepts only public unicast addresses, including IPv4 hidden in IPv6 forms', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.2', '169.254.169.254', '100.64.0.1',
      '0.0.0.0', '255.255.255.255', '224.0.0.1', '240.0.0.1', '192.0.2.1', '198.18.0.1',
      '::', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '2001:db8::1',
      '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', 'not-an-ip',
    ])
      expect(isPublicImageAddress(ip), ip).toBe(false);
    expect(isPublicImageAddress('8.8.8.8')).toBe(true);
    expect(isPublicImageAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('upgrades http to https and refuses credentials, odd ports and other schemes', () => {
    expect(normalizeRemoteImageUrl('http://img.example.com/a.jpg')?.toString()).toBe('https://img.example.com/a.jpg');
    expect(normalizeRemoteImageUrl('//img.example.com/a.jpg')?.toString()).toBe('https://img.example.com/a.jpg');
    expect(normalizeRemoteImageUrl('https://img.example.com:443/a.jpg')?.toString()).toBe('https://img.example.com/a.jpg');
    // 파일명에 공백·한글이 든 호스팅 주소는 퍼센트 인코딩해 그대로 받는다.
    expect(normalizeRemoteImageUrl('https://img.example.com/상세 01.jpg')?.toString())
      .toBe('https://img.example.com/%EC%83%81%EC%84%B8%2001.jpg');
    expect(normalizeRemoteImageUrl(' http://img.example.com/a b.jpg ')?.toString()).toBe('https://img.example.com/a%20b.jpg');
    for (const bad of [
      'https://user:pass@img.example.com/a.jpg', 'https://img.example.com:8443/a.jpg', 'http://img.example.com:8080/a.jpg',
      'ftp://img.example.com/a.jpg', 'file:///etc/passwd', 'javascript:alert(1)', 'a.jpg', '',
      'https://img.example.com/a\tb.jpg', 'https://img.example.com/a\u0000b.jpg', 'https://img.example.com/a\u007fb.jpg',
      'https://img.example.com\\a.jpg', 'https://img ex.com/a.jpg',
    ])
      expect(normalizeRemoteImageUrl(bad), bad).toBeNull();
  });

  it('rejects private DNS answers before opening any socket', async () => {
    mocks.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(fetchRemoteImage('https://intranet.example.com/a.png')).rejects.toThrow('내부');
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '::ffff:127.0.0.1', family: 6 }]);
    await expect(fetchRemoteImage('https://mixed.example.com/a.png')).rejects.toThrow('내부');
    await expect(fetchRemoteImage('ftp://example.com/a.png')).rejects.toThrow('HTTPS');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('requests the https form of an http URL and pins the socket to the checked address', async () => {
    respond(200, { 'content-type': 'image/png' });
    const image = await fetchRemoteImage('http://img.example.com/a.png');
    expect(image).toMatchObject({ mimeType: 'image/png', url: 'https://img.example.com/a.png' });
    expect(String(mocks.request.mock.calls[0][0])).toBe('https://img.example.com/a.png');
    const options = mocks.request.mock.calls[0][1];
    expect(options.agent).toBe(false);
    const single = vi.fn();
    options.lookup('img.example.com', {}, single);
    expect(single).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    const all = vi.fn();
    options.lookup('img.example.com', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  });

  it('rechecks every redirect hop and stops after three hops', async () => {
    respond(302, { location: 'https://private.example.com/a.png' });
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '192.168.0.10', family: 4 }]);
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('내부');
    expect(mocks.request).toHaveBeenCalledTimes(1);

    mocks.request.mockReset();
    respond(301, { location: 'http://cdn.example.com/b.png' });
    respond(200, { 'content-type': 'image/png' });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).resolves.toMatchObject({ url: 'https://cdn.example.com/b.png' });

    mocks.request.mockReset();
    for (let hop = 0; hop < 4; hop++) respond(302, { location: `/hop-${hop}.png` });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('여러 번');
    expect(mocks.request).toHaveBeenCalledTimes(4);

    mocks.request.mockReset();
    respond(302, { location: 'https://user:pw@img.example.com/a.png' });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('HTTPS');
  });

  it('requires an image content type and matching file signature', async () => {
    respond(200, { 'content-type': 'text/html' });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('JPEG·PNG·WebP');
    respond(200, { 'content-type': 'image/png' }, Buffer.from('<svg></svg>'));
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('JPEG·PNG·WebP');
    respond(200, { 'content-type': 'IMAGE/JPEG; charset=binary' }, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await expect(fetchRemoteImage('https://img.example.com/a.jpg')).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    respond(404, { 'content-type': 'image/png' });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('내려받지 못했습니다');
    expect(sniffImageMime(Buffer.from('RIFF0000WEBP'))).toBe('image/webp');
  });

  it('accepts octet-stream or missing content types only when the file signature is JPEG·PNG·WebP', async () => {
    respond(200, { 'content-type': 'application/octet-stream' });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).resolves.toMatchObject({ mimeType: 'image/png' });
    respond(200, { 'content-type': 'Binary/Octet-Stream; charset=binary' }, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]));
    await expect(fetchRemoteImage('https://s3.example.com/a')).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    respond(200, {}, Buffer.from('RIFF0000WEBPVP8 '));
    await expect(fetchRemoteImage('https://img.example.com/a.webp')).resolves.toMatchObject({ mimeType: 'image/webp' });
    respond(200, { 'content-type': 'application/octet-stream' }, Buffer.from('<html></html>'));
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('JPEG·PNG·WebP');
    respond(200, { 'content-type': 'application/pdf' });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('JPEG·PNG·WebP');
  });

  it('stops at the size limit from the header or while streaming', async () => {
    respond(200, { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('5MB');
    respond(200, { 'content-type': 'image/png' }, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]));
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('5MB');
    respond(200, { 'content-type': 'image/png' }, Buffer.concat([PNG, Buffer.alloc(200)]));
    await expect(fetchRemoteImage('https://img.example.com/a.png', { maxBytes: 100 })).rejects.toThrow('5MB');
  });

  it('gives up on a silent server within the time budget', async () => {
    hang();
    await expect(fetchRemoteImage('https://slow.example.com/a.png', { timeoutMs: 30 })).rejects.toThrow('시간');
  });

  it('closes the socket at once on redirects and non-200 responses instead of draining an open body', async () => {
    const redirect = openResponse(302, { location: '/img.png' });
    respond(200, { 'content-type': 'image/png' });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).resolves.toMatchObject({ url: 'https://img.example.com/img.png' });
    expect(redirect.response.destroy).toHaveBeenCalled();
    expect(redirect.req.destroy).toHaveBeenCalled();
    expect(redirect.response.resume).not.toHaveBeenCalled();

    const missing = openResponse(404, { 'content-type': 'text/html' });
    await expect(fetchRemoteImage('https://img.example.com/a.png')).rejects.toThrow('내려받지 못했습니다');
    expect(missing.response.destroy).toHaveBeenCalled();
    expect(missing.req.destroy).toHaveBeenCalled();
  });

  describe('time limits (fake timers)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const chunk = Buffer.alloc(64 * 1024);

    it('keeps the 10-second total limit by default (Sabangnet preview) even while bytes keep coming', async () => {
      const { response, req } = openResponse(200, { 'content-type': 'image/png' });
      trickle(response, chunk, 250, 48); // 약 12초에 걸쳐 3MB
      const result = fetchRemoteImage('https://img.example.com/a.png').catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(10_500);
      expect(await result).toMatchObject({ message: expect.stringContaining('시간') });
      expect(req.destroy).toHaveBeenCalled();
    });

    it('with an idle limit, a slow but steady stream finishes within the total and a stall is cut', async () => {
      const steady = openResponse(200, { 'content-type': 'image/png' });
      trickle(steady.response, chunk, 250, 48);
      const done = fetchRemoteImage('https://img.example.com/a.png', { timeoutMs: 30_000, idleTimeoutMs: 10_000 });
      await vi.advanceTimersByTimeAsync(12_500);
      await expect(done).resolves.toMatchObject({ mimeType: 'image/png' });

      const stalled = openResponse(200, { 'content-type': 'image/png' });
      trickle(stalled.response, chunk, 11_000, 3);
      const cut = fetchRemoteImage('https://img.example.com/a.png', { timeoutMs: 30_000, idleTimeoutMs: 10_000 }).catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(10_500);
      expect(await cut).toMatchObject({ message: expect.stringContaining('시간') });
      expect(stalled.req.destroy).toHaveBeenCalled();

      const endless = openResponse(200, { 'content-type': 'image/png' });
      trickle(endless.response, Buffer.alloc(1024), 500, 1_000);
      const capped = fetchRemoteImage('https://img.example.com/a.png', { timeoutMs: 30_000, idleTimeoutMs: 10_000 }).catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(30_500);
      expect(await capped).toMatchObject({ message: expect.stringContaining('시간') });
    });
  });

  it('fetches distinct sources with at most four in flight, a count limit and a deadline', async () => {
    let active = 0;
    let peak = 0;
    const fetchImage = vi.fn(async (source: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (source.endsWith('bad.png')) throw new Error('이미지 URL에서 파일을 내려받지 못했습니다.');
      return { bytes: PNG, mimeType: 'image/png' as const, url: source };
    });
    const sources = Array.from({ length: 10 }, (_, index) => `https://img.example.com/${index}.png`);
    const store = vi.fn(async (_image: unknown, source: string) => `stored:${source}`);
    const results = await fetchRemoteImages(['https://img.example.com/bad.png', ...sources, sources[0]], store, {
      fetchImage, limit: 8,
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(fetchImage).toHaveBeenCalledTimes(8);
    expect(results.get(sources[0])).toEqual({ ok: true, value: `stored:${sources[0]}` });
    expect(results.get(sources[9])).toMatchObject({ ok: false, error: expect.stringContaining('8장') });
    expect(results.get('https://img.example.com/bad.png')).toEqual({ ok: false, error: '이미지 URL에서 파일을 내려받지 못했습니다.' });
    expect(store).toHaveBeenCalledTimes(7);

    const late = await fetchRemoteImages(['https://img.example.com/x.png'], store, { fetchImage, deadline: Date.now() - 1 });
    expect(late.get('https://img.example.com/x.png')).toMatchObject({ ok: false, error: expect.stringContaining('시간') });
  });
});
