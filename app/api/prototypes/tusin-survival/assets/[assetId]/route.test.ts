import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUSIN_SURVIVAL_ASSET_IDS } from '@/lib/prototypes/tusin-survival/assets';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
}));

import { GET } from './route';

const EXPECTED_ASSET_IDS = [
  'zephyr-directions',
  'enemy-atlas',
  'final-boss',
  'ability-icon-atlas',
  'combat-vfx-atlas',
  'pickup-atlas',
  'dark-cathedral-floor',
] as const;

function request(assetId: string) {
  return GET(
    new Request(`https://icons.local/api/prototypes/tusin-survival/assets/${encodeURIComponent(assetId)}`),
    { params: Promise.resolve({ assetId }) },
  );
}

describe('GET /api/prototypes/tusin-survival/assets/[assetId]', () => {
  beforeEach(() => {
    vi.stubEnv('ICONS_PROTOTYPE', '1');
    mocks.readFile.mockReset();
    mocks.readFile.mockResolvedValue(Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('런타임이 소비하는 stable asset ID를 모두 고정한다', () => {
    expect(TUSIN_SURVIVAL_ASSET_IDS).toEqual(EXPECTED_ASSET_IDS);
  });

  it('비활성 환경에서는 allowlist 자산도 읽기 전에 404로 닫는다', async () => {
    vi.stubEnv('ICONS_PROTOTYPE', '0');

    const response = await request('zephyr-directions');

    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it.each([
    '../zephyr-directions',
    '..%2Fzephyr-directions',
    '/etc/passwd',
    'unknown-asset',
  ])('allowlist 밖 ID %s는 filesystem에 전달하지 않는다', async (assetId) => {
    const response = await request(assetId);

    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('allowlist PNG를 private no-store 응답으로 전달한다', async () => {
    const response = await request('zephyr-directions');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );
    expect(mocks.readFile).toHaveBeenCalledOnce();
    expect(String(mocks.readFile.mock.calls[0][0])).toMatch(
      /private-assets\/tusin-survival\/zephyr-directions\.png$/,
    );
  });

  it.each(EXPECTED_ASSET_IDS)('%s ID를 대응 PNG 파일에만 매핑한다', async (assetId) => {
    const response = await request(assetId);

    expect(response.status).toBe(200);
    expect(mocks.readFile).toHaveBeenCalledOnce();
    expect(String(mocks.readFile.mock.calls[0][0])).toMatch(
      new RegExp(`/private-assets/tusin-survival/${assetId}\\.png$`),
    );
  });

  it('누락된 allowlist 파일은 내부 경로를 노출하지 않고 404로 닫는다', async () => {
    mocks.readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    const response = await request('enemy-atlas');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } });
  });

  it('예상하지 못한 filesystem 오류도 세부정보 없이 no-store로 닫는다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.readFile.mockRejectedValueOnce(Object.assign(new Error('/private/secret/path'), { code: 'EACCES' }));

    const response = await request('enemy-atlas');

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toEqual({ error: { code: 'asset_unavailable' } });
    expect(consoleError).toHaveBeenCalledWith(
      '[tusin-survival/assets] failed to read prototype asset',
    );
  });
});
