import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareAouadResult, type AouadShareNavigator, type AouadSharePayload } from './share';

const payload = {
  title: 'LAST BELL',
  text: '효산고에서 생존 기록을 남겼습니다.',
  url: 'https://example.test/games/prototype-last-bell/popup',
};

type CardHarness = {
  fillText: ReturnType<typeof vi.fn>;
  anchorClick: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

function installCardHarness({ downloadFails = false } = {}): CardHarness {
  const fillText = vi.fn();
  const drawImage = vi.fn();
  const anchorClick = downloadFails ? vi.fn(() => { throw new Error('download blocked'); }) : vi.fn();
  const toBlob = vi.fn((callback: (blob: Blob | null) => void) => callback(new Blob(['record'], { type: 'image/png' })));
  const context = {
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillStyle: '',
    fillRect: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    strokeRect: vi.fn(),
    font: '',
    fillText,
    save: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage,
    restore: vi.fn(),
  };
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob };
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'canvas' ? canvas : { click: anchorClick } });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:record'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('File', class TestFile extends Blob {
    readonly name: string;

    constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
      super(parts, options);
      this.name = name;
    }
  });
  return { fillText, anchorClick, toBlob, drawImage };
}

afterEach(() => vi.unstubAllGlobals());

describe('AOUAD result sharing', () => {
  it('uses text Web Share when a generated image card is unavailable', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const result = await shareAouadResult(payload, { share, clipboard: { writeText: vi.fn() } } satisfies AouadShareNavigator);
    expect(result).toBe('web-share');
    expect(share).toHaveBeenCalledWith(payload);
  });

  it('shares the generated image File before text when Web Share supports files', async () => {
    const harness = installCardHarness();
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn((data: ShareData) => data.files?.length === 1);
    const unsafePayload = { ...payload, name: '학생 25번', avatar: 'preset-1' } as unknown as AouadSharePayload;

    const result = await shareAouadResult(unsafePayload, { share, canShare } satisfies AouadShareNavigator);

    expect(result).toBe('web-share');
    expect(harness.toBlob).toHaveBeenCalledOnce();
    expect(canShare).toHaveBeenCalledOnce();
    const shared = share.mock.calls[0]?.[0] as ShareData;
    expect(shared.files?.[0]).toBeInstanceOf(File);
    expect(shared.files?.[0]?.name).toBe('last-bell-survival-record.png');
    expect(shared).not.toHaveProperty('name');
    expect(shared).not.toHaveProperty('avatar');
    expect(harness.fillText.mock.calls.flat()).not.toContain('학생 25번');
    expect(harness.fillText.mock.calls.flat()).not.toContain('preset-1');
  });

  it('falls back from unsupported image sharing to text Web Share before local fallbacks', async () => {
    const harness = installCardHarness();
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);

    const result = await shareAouadResult(payload, {
      share,
      canShare: vi.fn(() => false),
      clipboard: { writeText },
    } satisfies AouadShareNavigator);

    expect(result).toBe('web-share');
    expect(share).toHaveBeenCalledOnce();
    expect(share).toHaveBeenCalledWith(payload);
    expect(harness.anchorClick).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('downloads the image card when Web Share is unavailable before copying text', async () => {
    const harness = installCardHarness();
    const writeText = vi.fn().mockResolvedValue(undefined);

    const result = await shareAouadResult(payload, { clipboard: { writeText } } satisfies AouadShareNavigator);

    expect(result).toBe('download');
    expect(harness.anchorClick).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('center-crops an explicitly opted-in local photo without stretching it', async () => {
    const harness = installCardHarness();
    const source = { width: 492, height: 246 } as unknown as CanvasImageSource;

    const result = await shareAouadResult({ ...payload, photo: { source } }, {
      share: vi.fn().mockResolvedValue(undefined),
      canShare: vi.fn(() => false),
    } satisfies AouadShareNavigator);

    expect(result).toBe('web-share');
    expect(harness.drawImage).toHaveBeenCalledWith(source, 123, 0, 246, 246, 836, 174, 246, 246);
  });

  it('skips a photo with invalid intrinsic dimensions without failing to share', async () => {
    const harness = installCardHarness();
    const source = { width: 0, height: 246 } as unknown as CanvasImageSource;

    const result = await shareAouadResult({ ...payload, photo: { source } }, {
      share: vi.fn().mockResolvedValue(undefined),
      canShare: vi.fn(() => false),
    } satisfies AouadShareNavigator);

    expect(result).toBe('web-share');
    expect(harness.drawImage).not.toHaveBeenCalled();
  });

  it('downloads the image before attempting clipboard fallback', async () => {
    const harness = installCardHarness();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const result = await shareAouadResult(payload, {
      share: vi.fn().mockRejectedValue(new Error('cancelled')),
      canShare: vi.fn(() => false),
      clipboard: { writeText },
    } satisfies AouadShareNavigator);

    expect(result).toBe('download');
    expect(harness.anchorClick).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('stops after a cancelled file share without reopening share or using local fallbacks', async () => {
    const harness = installCardHarness();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'));

    const result = await shareAouadResult(payload, {
      share,
      canShare: vi.fn(() => true),
      clipboard: { writeText },
    } satisfies AouadShareNavigator);

    expect(result).toBe('cancelled');
    expect(share).toHaveBeenCalledOnce();
    expect(harness.anchorClick).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('stops after a cancelled text share without downloading or copying', async () => {
    const harness = installCardHarness();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'));

    const result = await shareAouadResult(payload, {
      share,
      canShare: vi.fn(() => false),
      clipboard: { writeText },
    } satisfies AouadShareNavigator);

    expect(result).toBe('cancelled');
    expect(share).toHaveBeenCalledOnce();
    expect(harness.anchorClick).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to clipboard after text sharing and image download both fail', async () => {
    installCardHarness({ downloadFails: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    const result = await shareAouadResult(payload, {
      share: vi.fn().mockRejectedValue(new Error('cancelled')),
      canShare: vi.fn(() => false),
      clipboard: { writeText },
    } satisfies AouadShareNavigator);
    expect(result).toBe('clipboard');
    expect(writeText).toHaveBeenCalledWith(`${payload.text}\n${payload.url}`);
  });
});
