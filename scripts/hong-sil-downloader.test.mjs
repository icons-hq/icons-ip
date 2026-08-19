import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl3sAAAAASUVORK5CYII=',
  'base64',
);

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startFixtureServer({ initialEpisodes, imageFixtures = new Map() } = {}) {
  let origin;
  const episodeHits = new Map();
  const imageHits = new Map();
  const episodes = initialEpisodes ?? [
    { id: 'episode-1', title: '1화' },
    { id: 'episode-2', title: '2화' },
  ];
  const server = createServer((request, response) => {
    const url = new URL(request.url, origin);

    if (url.pathname === '/webtoon/17586') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`
        <main>
          ${episodes.map(({ id, title }) => (
    `<a href="/webtoon/17586/${id}"><strong>${title}</strong></a>`
  )).join('\n')}
        </main>
      `);
      return;
    }

    const episode = episodes.find(({ id }) => url.pathname === `/webtoon/17586/${id}`);
    if (episode) {
      episodeHits.set(episode.id, (episodeHits.get(episode.id) ?? 0) + 1);
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (episode.apiPages) {
        response.end(`
          <main id="viewer"></main>
          <script>
            fetch('/api/webtoon-images?episode=${episode.id}')
              .then((response) => response.json())
              .then(({ images }) => {
                for (const image of images) {
                  const element = document.createElement('img');
                  element.alt = 'page ' + image.page;
                  element.src = image.src;
                  document.querySelector('#viewer').append(element);
                }
              });
          </script>
        `);
        return;
      }
      response.end(`<main><img alt="page 1" src="${origin}/cdn/${episode.id}-p1.bin"></main>`);
      return;
    }

    if (url.pathname === '/api/webtoon-images') {
      const requestedEpisode = episodes.find(({ id }) => id === url.searchParams.get('episode'));
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        images: requestedEpisode.apiPages.map(({ page, srcPath, candidatePaths = [] }) => ({
          page,
          src: `${origin}${srcPath}`,
          srcCandidates: candidatePaths.map((candidate) => `${origin}${candidate}`),
        })),
      }));
      return;
    }

    if (url.pathname.startsWith('/cdn/')) {
      imageHits.set(url.pathname, (imageHits.get(url.pathname) ?? 0) + 1);
      if (url.pathname.includes('broken')) {
        response.statusCode = 502;
        response.setHeader('content-type', 'text/html');
        response.end('<h1>bad gateway</h1>');
        return;
      }
      response.setHeader('content-type', 'application/octet-stream');
      response.end(imageFixtures.get(url.pathname) ?? PNG_1X1);
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return {
    origin,
    addEpisode(episode) { episodes.push(episode); },
    episodeHits,
    imageHits,
  };
}

async function runDownloader(args) {
  const child = spawn(process.execPath, ['scripts/hong-sil-downloader.mjs', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

describe('hong-sil downloader CLI', () => {
  it('downloads every discovered episode in chronological folders', async () => {
    const { origin } = await startFixtureServer();
    const output = await mkdtemp(join(tmpdir(), 'hong-sil-downloader-'));
    cleanups.push(() => rm(output, { recursive: true, force: true }));

    const result = await runDownloader([
      '--url', `${origin}/webtoon/17586`,
      '--output', output,
      '--concurrency', '2',
    ]);

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(existsSync(join(output, '001_1화', 'page-001.png'))).toBe(true);
    expect(existsSync(join(output, '002_2화', 'page-001.png'))).toBe(true);

    const manifest = JSON.parse(await readFile(join(output, 'source-manifest.json'), 'utf8'));
    expect(manifest.episodes.map(({ order, title, pageCount }) => ({ order, title, pageCount })))
      .toEqual([
        { order: 1, title: '1화', pageCount: 1 },
        { order: 2, title: '2화', pageCount: 1 },
      ]);
  }, 60_000);

  it('adds a new episode without revisiting or downloading existing episodes', async () => {
    const fixture = await startFixtureServer();
    const output = await mkdtemp(join(tmpdir(), 'hong-sil-downloader-resume-'));
    cleanups.push(() => rm(output, { recursive: true, force: true }));
    const args = [
      '--url', `${fixture.origin}/webtoon/17586`,
      '--output', output,
      '--concurrency', '2',
    ];

    expect((await runDownloader(args)).code).toBe(0);
    fixture.addEpisode({ id: 'episode-3', title: '특별편 1화' });
    expect((await runDownloader(args)).code).toBe(0);

    expect(Object.fromEntries(fixture.episodeHits)).toEqual({
      'episode-1': 1,
      'episode-2': 1,
      'episode-3': 1,
    });
    expect(Object.fromEntries(fixture.imageHits)).toEqual({
      '/cdn/episode-1-p1.bin': 1,
      '/cdn/episode-2-p1.bin': 1,
      '/cdn/episode-3-p1.bin': 1,
    });
    expect(existsSync(join(output, '003_특별편_1화', 'page-001.png'))).toBe(true);
  }, 60_000);

  it('uses image API fallback URLs and records a successful report', async () => {
    const fixture = await startFixtureServer({
      initialEpisodes: [{
        id: 'episode-fallback',
        title: '보너스 1화',
        apiPages: [{
          page: 1,
          srcPath: '/cdn/broken-primary.bin',
          candidatePaths: ['/cdn/fallback.bin'],
        }],
      }],
    });
    const output = await mkdtemp(join(tmpdir(), 'hong-sil-downloader-fallback-'));
    cleanups.push(() => rm(output, { recursive: true, force: true }));

    const result = await runDownloader([
      '--url', `${fixture.origin}/webtoon/17586`,
      '--output', output,
    ]);

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(Object.fromEntries(fixture.imageHits)).toEqual({
      '/cdn/broken-primary.bin': 1,
      '/cdn/fallback.bin': 1,
    });
    expect(existsSync(join(output, '001_보너스_1화', 'page-001.png'))).toBe(true);
    const report = JSON.parse(await readFile(join(output, 'download-report.json'), 'utf8'));
    expect(report.summary).toMatchObject({ requested: 1, downloaded: 1, failed: 0 });
    expect(report.failures).toEqual([]);
  }, 60_000);

  it('refreshes an existing episode when one of its image files is missing', async () => {
    const episode = {
      id: 'episode-refresh',
      title: '새 주소 1화',
      apiPages: [{ page: 1, srcPath: '/cdn/initial.bin' }],
    };
    const fixture = await startFixtureServer({ initialEpisodes: [episode] });
    const output = await mkdtemp(join(tmpdir(), 'hong-sil-downloader-refresh-'));
    cleanups.push(() => rm(output, { recursive: true, force: true }));
    const args = ['--url', `${fixture.origin}/webtoon/17586`, '--output', output];

    expect((await runDownloader(args)).code).toBe(0);
    await rm(join(output, '001_새_주소_1화', 'page-001.png'));
    episode.apiPages = [{ page: 1, srcPath: '/cdn/refreshed.bin' }];
    expect((await runDownloader(args)).code).toBe(0);

    expect(Object.fromEntries(fixture.episodeHits)).toEqual({ 'episode-refresh': 2 });
    expect(Object.fromEntries(fixture.imageHits)).toEqual({
      '/cdn/initial.bin': 1,
      '/cdn/refreshed.bin': 1,
    });
  }, 60_000);

  it('repairs corrupt files and writes a verified SHA-256 asset index', async () => {
    const fixture = await startFixtureServer({
      initialEpisodes: [{ id: 'episode-verify', title: '검증 1화' }],
    });
    const output = await mkdtemp(join(tmpdir(), 'hong-sil-downloader-verify-'));
    cleanups.push(() => rm(output, { recursive: true, force: true }));
    const args = ['--url', `${fixture.origin}/webtoon/17586`, '--output', output];
    const imagePath = join(output, '001_검증_1화', 'page-001.png');

    expect((await runDownloader(args)).code).toBe(0);
    await writeFile(imagePath, Buffer.concat([PNG_1X1.subarray(0, 8), Buffer.from('broken')]));
    expect((await runDownloader(args)).code).toBe(0);

    expect(Object.fromEntries(fixture.episodeHits)).toEqual({ 'episode-verify': 2 });
    expect(Object.fromEntries(fixture.imageHits)).toEqual({ '/cdn/episode-verify-p1.bin': 2 });
    const index = JSON.parse(await readFile(join(output, 'asset-index.json'), 'utf8'));
    expect(index.summary).toEqual({
      episodeCount: 1,
      expectedImageCount: 1,
      imageCount: 1,
      missingImageCount: 0,
      totalSizeBytes: PNG_1X1.length,
      verificationFailures: 0,
    });
    expect(index.episodes[0].pages[0]).toMatchObject({
      page: 1,
      width: 1,
      height: 1,
      format: 'png',
      sha256: createHash('sha256').update(PNG_1X1).digest('hex'),
    });
  }, 60_000);

  it('preserves GIF and AVIF extensions and records Sharp metadata for both formats', async () => {
    const gif = await sharp({
      create: {
        background: { alpha: 1, b: 70, g: 50, r: 30 },
        channels: 4,
        height: 2,
        width: 3,
      },
    }).gif().toBuffer();
    const avif = await sharp({
      create: {
        background: { alpha: 0.5, b: 30, g: 50, r: 70 },
        channels: 4,
        height: 4,
        width: 5,
      },
    }).avif().toBuffer();
    const fixture = await startFixtureServer({
      initialEpisodes: [{
        id: 'episode-modern-formats',
        title: '포맷 검증 1화',
        apiPages: [
          { page: 1, srcPath: '/cdn/page-one.bin' },
          { page: 2, srcPath: '/cdn/page-two.bin' },
        ],
      }],
      imageFixtures: new Map([
        ['/cdn/page-one.bin', gif],
        ['/cdn/page-two.bin', avif],
      ]),
    });
    const output = await mkdtemp(join(tmpdir(), 'hong-sil-downloader-formats-'));
    cleanups.push(() => rm(output, { recursive: true, force: true }));

    const result = await runDownloader([
      '--url', `${fixture.origin}/webtoon/17586`,
      '--output', output,
    ]);

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(existsSync(join(output, '001_포맷_검증_1화', 'page-001.gif'))).toBe(true);
    expect(existsSync(join(output, '001_포맷_검증_1화', 'page-002.avif'))).toBe(true);
    const index = JSON.parse(await readFile(join(output, 'asset-index.json'), 'utf8'));
    expect(index.episodes[0].pages).toEqual([
      expect.objectContaining({ page: 1, width: 3, height: 2, format: 'gif' }),
      expect.objectContaining({ page: 2, width: 5, height: 4, format: 'heif' }),
    ]);
  }, 60_000);

  it('keeps successful files and exits with a precise report when a page fails', async () => {
    const fixture = await startFixtureServer({
      initialEpisodes: [{
        id: 'episode-partial',
        title: '부분 실패 1화',
        apiPages: [
          { page: 1, srcPath: '/cdn/good.bin' },
          { page: 2, srcPath: '/cdn/broken-only.bin' },
        ],
      }],
    });
    const output = await mkdtemp(join(tmpdir(), 'hong-sil-downloader-partial-'));
    cleanups.push(() => rm(output, { recursive: true, force: true }));

    const result = await runDownloader([
      '--url', `${fixture.origin}/webtoon/17586`,
      '--output', output,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(join(output, 'download-report.json'));
    expect(existsSync(join(output, '001_부분_실패_1화', 'page-001.png'))).toBe(true);
    const report = JSON.parse(await readFile(join(output, 'download-report.json'), 'utf8'));
    expect(report.summary).toMatchObject({ requested: 2, downloaded: 1, failed: 1 });
    expect(report.failures[0]).toMatchObject({ order: 1, page: 2, status: 'failed' });
    expect(report.failures[0].error).toContain('/cdn/broken-only.bin: HTTP 502');
    const index = JSON.parse(await readFile(join(output, 'asset-index.json'), 'utf8'));
    expect(index.summary).toMatchObject({
      expectedImageCount: 2,
      imageCount: 1,
      missingImageCount: 1,
      verificationFailures: 1,
    });
  }, 60_000);
});
