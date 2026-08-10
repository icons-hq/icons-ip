import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, request as playwrightRequest } from 'playwright-core';
import sharp from 'sharp';

const DEFAULT_URL = 'https://sbxh9.com/webtoon/17586';
const DEFAULT_OUTPUT = 'outputs/hong-sil-quest-webtoon-source';
const IMAGE_EXTENSIONS = ['.jpg', '.png', '.webp', '.gif', '.avif'];

function imageExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return '.png';
  }
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a'
    || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return '.gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp'
    && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'))) return '.avif';
  throw new Error(`Unsupported image response: ${bytes.subarray(0, 16).toString('hex')}`);
}

function folderName(order, title) {
  const safeTitle = title
    .replace(/[\\/:*?"<>|()]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${String(order).padStart(3, '0')}_${safeTitle}`;
}

function workIdFromUrl(listUrl) {
  const match = new URL(listUrl).pathname.match(/^\/webtoon\/([^/]+)\/?$/);
  if (!match) throw new Error(`Expected a /webtoon/<work-id> URL: ${listUrl}`);
  return match[1];
}

async function episodeIsComplete(episode, outputDirectory) {
  if (!Array.isArray(episode.pages) || episode.pages.length === 0) return false;
  const files = await Promise.all(episode.pages.map(({ page }) => existingImage(
    join(outputDirectory, episode.folder, `page-${String(page).padStart(3, '0')}`),
  )));
  return files.every(Boolean);
}

async function discoverEpisodes(browser, listUrl, existingEpisodes, outputDirectory) {
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'image') return route.abort();
    return route.continue();
  });
  const workId = workIdFromUrl(listUrl);
  const chronologicalUrl = new URL(listUrl);
  chronologicalUrl.searchParams.set('sort', 'asc');
  await page.goto(chronologicalUrl.href, { waitUntil: 'domcontentloaded' });

  const episodeLinks = await page.locator(`main a[href^="/webtoon/${workId}/"]`).evaluateAll(
    (links) => links.map((link) => ({
      href: link.getAttribute('href'),
      title: link.querySelector('strong')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })),
  );
  const uniqueEpisodes = [...new Map(
    episodeLinks.filter(({ href, title }) => href && title).map((episode) => [episode.href, episode]),
  ).values()];
  if (uniqueEpisodes.length === 0) throw new Error(`No episodes found at ${listUrl}`);

  const existingByUrl = new Map(existingEpisodes.map((episode) => [episode.episodeUrl, episode]));
  const episodes = [];
  for (const [index, episode] of uniqueEpisodes.entries()) {
    const episodeUrl = new URL(episode.href, listUrl).href;
    const existing = existingByUrl.get(episodeUrl);
    if (existing && await episodeIsComplete(existing, outputDirectory)) {
      episodes.push(existing);
      continue;
    }
    const imageApiResponses = [];
    const captureImageApi = (response) => {
      if (new URL(response.url()).pathname === '/api/webtoon-images') {
        imageApiResponses.push(response.json().catch(() => null));
      }
    };
    page.on('response', captureImageApi);
    await page.goto(episodeUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('img[alt^="page "]').first().waitFor({ state: 'attached', timeout: 30_000 });
    const domPages = await page.locator('img[alt^="page "]').evaluateAll((images) => images.map(
      (image, pageIndex) => ({ page: pageIndex + 1, sourceUrl: image.getAttribute('src') }),
    ));
    const apiPayloads = await Promise.all(imageApiResponses);
    page.off('response', captureImageApi);
    const apiPages = apiPayloads
      .flatMap((payload) => (Array.isArray(payload?.images) ? payload.images : []))
      .filter(({ page, src }) => Number.isInteger(page) && typeof src === 'string')
      .map(({ page: pageNumber, src, srcCandidates = [] }) => ({
        page: pageNumber,
        sourceUrl: src,
        sourceCandidates: [...new Set(srcCandidates.filter((candidate) => candidate !== src))],
      }));
    const pages = apiPages.length > 0 ? apiPages : domPages;
    const order = existing?.order ?? index + 1;
    const title = episode.title || existing?.title;
    episodes.push({
      order,
      title,
      folder: existing?.folder ?? folderName(order, title),
      episodeUrl,
      pageCount: pages.length,
      pages,
    });
  }

  await page.close();
  return episodes;
}

async function readExistingEpisodes(outputDirectory) {
  try {
    const manifest = JSON.parse(await readFile(join(outputDirectory, 'source-manifest.json'), 'utf8'));
    return Array.isArray(manifest.episodes) ? manifest.episodes : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function existingImage(stem) {
  for (const extension of IMAGE_EXTENSIONS) {
    const candidate = `${stem}${extension}`;
    try {
      const file = await open(candidate, 'r');
      const header = Buffer.alloc(16);
      try {
        await file.read(header, 0, header.length, 0);
      } finally {
        await file.close();
      }
      if (imageExtension(header) !== extension) continue;
      const metadata = await sharp(candidate, { failOn: 'error' }).metadata();
      if (!metadata.width || !metadata.height) continue;
      return candidate;
    } catch {
      // Try the next supported extension.
    }
  }
  return null;
}

async function mapConcurrent(items, concurrency, operation) {
  let cursor = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
}

async function downloadImages(episodes, outputDirectory, concurrency) {
  const tasks = episodes.flatMap((episode) => episode.pages.map((page) => ({ episode, page })));
  const requestContext = await playwrightRequest.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    },
  });
  try {
    return await mapConcurrent(tasks, concurrency, async ({ episode, page }) => {
      const episodeDirectory = join(outputDirectory, episode.folder);
      await mkdir(episodeDirectory, { recursive: true });
      const stem = join(episodeDirectory, `page-${String(page.page).padStart(3, '0')}`);
      const existing = await existingImage(stem);
      const details = {
        order: episode.order,
        title: episode.title,
        folder: episode.folder,
        episodeUrl: episode.episodeUrl,
        page: page.page,
        sourceUrl: page.sourceUrl,
      };
      if (existing) return { ...details, status: 'skipped', path: existing, bytes: 0 };

      const errors = [];
      const candidates = [...new Set([page.sourceUrl, ...(page.sourceCandidates ?? [])])];
      for (const candidate of candidates) {
        try {
          const response = await requestContext.get(candidate, {
            headers: { referer: episode.episodeUrl },
            timeout: 45_000,
          });
          if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
          const bytes = await response.body();
          const extension = imageExtension(bytes);
          const finalPath = `${stem}${extension}`;
          const temporaryPath = `${finalPath}.${process.pid}.part`;
          await writeFile(temporaryPath, bytes);
          await rename(temporaryPath, finalPath);
          return { ...details, status: 'downloaded', path: finalPath, bytes: bytes.length };
        } catch (error) {
          errors.push(`${candidate}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      return { ...details, status: 'failed', error: errors.join(' | '), bytes: 0 };
    });
  } finally {
    await requestContext.dispose();
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolvePromise);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function verifyAssets(episodes, outputDirectory, concurrency) {
  const tasks = episodes.flatMap((episode) => episode.pages.map((page) => ({ episode, page })));
  const results = await mapConcurrent(tasks, concurrency, async ({ episode, page }) => {
    try {
      const stem = join(
        outputDirectory,
        episode.folder,
        `page-${String(page.page).padStart(3, '0')}`,
      );
      const path = await existingImage(stem);
      if (!path) throw new Error('image file is missing or corrupt');
      const [metadata, fileStat, sha256] = await Promise.all([
        sharp(path, { failOn: 'error' }).metadata(),
        stat(path),
        sha256File(path),
      ]);
      return {
        status: 'verified',
        order: episode.order,
        page: page.page,
        path: relative(outputDirectory, path),
        sizeBytes: fileStat.size,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        sha256,
      };
    } catch (error) {
      return {
        status: 'failed',
        order: episode.order,
        page: page.page,
        error: error instanceof Error ? error.message : 'unknown verification error',
      };
    }
  });
  const verified = results.filter(({ status }) => status === 'verified');
  const failures = results.filter(({ status }) => status === 'failed');
  const byPage = new Map(verified.map((page) => [`${page.order}:${page.page}`, page]));
  const indexedEpisodes = episodes.map((episode) => {
    const pages = episode.pages
      .map(({ page }) => byPage.get(`${episode.order}:${page}`))
      .filter(Boolean);
    return {
      order: episode.order,
      title: episode.title,
      folder: episode.folder,
      pageCount: pages.length,
      pages,
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceManifest: 'source-manifest.json',
    summary: {
      episodeCount: episodes.length,
      expectedImageCount: tasks.length,
      imageCount: verified.length,
      missingImageCount: tasks.length - verified.length,
      totalSizeBytes: verified.reduce((total, page) => total + page.sizeBytes, 0),
      verificationFailures: failures.length,
    },
    verificationFailures: failures.map(({ status: _status, ...failure }) => failure),
    episodes: indexedEpisodes,
  };
}

export async function runHongSilDownloader({
  listUrl = DEFAULT_URL,
  output = DEFAULT_OUTPUT,
  concurrency = 10,
} = {}) {
  const outputDirectory = resolve(output);
  await mkdir(outputDirectory, { recursive: true });
  const existingEpisodes = await readExistingEpisodes(outputDirectory);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let episodes;
  try {
    episodes = await discoverEpisodes(browser, listUrl, existingEpisodes, outputDirectory);
  } finally {
    await browser.close();
  }
  const manifest = {
    schemaVersion: 1,
    source: {
      title: '홍실퀘스트',
      listUrl,
      episodeCount: episodes.length,
    },
    extractedAt: new Date().toISOString(),
    episodes,
  };
  await writeFile(
    join(outputDirectory, 'source-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  const startedAt = performance.now();
  const results = await downloadImages(episodes, outputDirectory, concurrency);
  const failures = results.filter(({ status }) => status === 'failed');
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      requested: results.length,
      downloaded: results.filter(({ status }) => status === 'downloaded').length,
      skipped: results.filter(({ status }) => status === 'skipped').length,
      failed: failures.length,
      bytesDownloaded: results.reduce((total, result) => total + result.bytes, 0),
      elapsedSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(3)),
    },
    failures,
  };
  await writeFile(
    join(outputDirectory, 'download-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  const assetIndex = await verifyAssets(episodes, outputDirectory, concurrency);
  await writeFile(
    join(outputDirectory, 'asset-index.json'),
    `${JSON.stringify(assetIndex, null, 2)}\n`,
    'utf8',
  );
  return {
    episodes: episodes.length,
    images: results.length,
    downloaded: results.filter(({ status }) => status === 'downloaded').length,
    skipped: results.filter(({ status }) => status === 'skipped').length,
    failed: failures.length,
    verificationFailed: assetIndex.summary.verificationFailures,
    outputDirectory,
  };
}

function cliOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string', default: DEFAULT_URL },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      concurrency: { type: 'string', default: '10' },
    },
    strict: true,
  });
  const concurrency = Number.parseInt(values.concurrency, 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new Error('--concurrency must be an integer from 1 to 50');
  }
  return { listUrl: values.url, output: values.output, concurrency };
}

async function main() {
  try {
    const result = await runHongSilDownloader(cliOptions(process.argv.slice(2)));
    console.log(
      `홍실퀘스트 다운로드 완료: ${result.episodes}개 회차, `
      + `${result.images}개 이미지 (신규 ${result.downloaded}, 기존 ${result.skipped}, 실패 ${result.failed})`,
    );
    console.log(`저장 위치: ${result.outputDirectory}`);
    if (result.failed > 0 || result.verificationFailed > 0) {
      console.error(
        `일부 이미지 처리에 실패했습니다. 상세 내용: ${join(result.outputDirectory, 'download-report.json')}`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : '홍실퀘스트 다운로드 실패');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
