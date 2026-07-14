import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TicketCameraController,
  classifyTicketCameraError,
  loadTicketCameraScanner,
  type TicketCameraScanner,
  type TicketCameraScannerLoader,
  type TicketCameraStreamLoader,
} from './ticket-camera';

const qrScannerMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  hasCamera: vi.fn(async () => true),
  options: null as Record<string, unknown> | null,
  scannerVideo: null as HTMLVideoElement | null,
  start: vi.fn(async () => undefined),
}));

vi.mock('qr-scanner', () => ({
  default: class MockQrScanner {
    static readonly NO_QR_CODE_FOUND = 'No QR code found';
    static hasCamera = qrScannerMocks.hasCamera;

    constructor(
      _video: HTMLVideoElement,
      _onDecode: (result: { data: string }) => void,
      options: Record<string, unknown>,
    ) {
      qrScannerMocks.options = options;
      qrScannerMocks.scannerVideo = _video;
    }

    destroy = qrScannerMocks.destroy;
    start = qrScannerMocks.start;
  },
}));

function cameraError(name: string) {
  return Object.assign(new Error(name), { name });
}

function scanner() {
  return {
    start: vi.fn(async () => undefined),
    destroy: vi.fn(),
  } satisfies TicketCameraScanner;
}

function videoWithTracks() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const video = {
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
    srcObject: { getTracks: () => tracks },
  } as unknown as HTMLVideoElement;
  return { tracks, video };
}

function attachReplacementStream(video: HTMLVideoElement) {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  video.srcObject = stream;
  return { stream, tracks };
}

const useExistingVideoStream: TicketCameraStreamLoader = async (video) => {
  if (!(video.srcObject instanceof Object)) throw new Error('missing test stream');
  return video.srcObject as MediaStream;
};

function stubScannerVideo() {
  const scannerVideo = {
    muted: false,
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
    playsInline: false,
    remove: vi.fn(),
    srcObject: null,
  } as unknown as HTMLVideoElement;
  vi.stubGlobal('document', { createElement: vi.fn(() => scannerVideo) });
  return scannerVideo;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ticket camera lifecycle', () => {
  it('uses the built-in reticle without qr-scanner overlay highlights', async () => {
    qrScannerMocks.options = null;
    const scannerVideo = stubScannerVideo();
    const { video } = videoWithTracks();

    await loadTicketCameraScanner(video, { onDecode: vi.fn(), onError: vi.fn() });

    expect(qrScannerMocks.options).toMatchObject({
      maxScansPerSecond: 10,
      preferredCamera: 'environment',
      returnDetailedScanResult: true,
    });
    expect(qrScannerMocks.scannerVideo).toBe(scannerVideo);
    expect(qrScannerMocks.scannerVideo).not.toBe(video);
    expect(qrScannerMocks.options).not.toHaveProperty('highlightCodeOutline');
    expect(qrScannerMocks.options).not.toHaveProperty('highlightScanRegion');
  });

  it.each([
    ['NotAllowedError', 'permission_denied'],
    ['NotFoundError', 'no_camera'],
    ['NotReadableError', 'camera_busy'],
  ] as const)('keeps native %s camera failures classifiable as %s', async (name, code) => {
    const failure = cameraError(name);
    const getUserMedia = vi.fn(async () => Promise.reject(failure));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const video = { srcObject: null } as unknown as HTMLVideoElement;
    const controller = new TicketCameraController();

    await expect(controller.start(video, { onDecode: vi.fn(), onError: vi.fn() })).rejects.toBe(failure);
    expect(classifyTicketCameraError(failure)).toBe(code);
    expect(qrScannerMocks.start).not.toHaveBeenCalled();
  });

  it('passes an environment-facing native stream to qr-scanner', async () => {
    const tracks = [{ stop: vi.fn() }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const scannerVideo = stubScannerVideo();
    const video = {
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
      srcObject: null,
    } as unknown as HTMLVideoElement;
    const controller = new TicketCameraController();

    await expect(controller.start(video, { onDecode: vi.fn(), onError: vi.fn() })).resolves.toBe(true);

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    expect(video.srcObject).toBe(stream);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(scannerVideo.srcObject).toBe(stream);
    expect(qrScannerMocks.start).toHaveBeenCalledTimes(1);
    controller.stop();
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(scannerVideo.srcObject).toBeNull();
    expect(scannerVideo.remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NotAllowedError', 'permission_denied'],
    ['SecurityError', 'permission_denied'],
    ['NotFoundError', 'no_camera'],
    ['OverconstrainedError', 'no_camera'],
    ['NotReadableError', 'camera_busy'],
    ['AbortError', 'camera_busy'],
    ['other', 'unsupported'],
  ])('classifies %s without exposing the original error', (name, expected) => {
    expect(classifyTicketCameraError(cameraError(name))).toBe(expected);
  });

  it.each([
    'Camera not found.',
    new Error('Camera not found.'),
  ])('classifies the qr-scanner startup error as no_camera: %p', (error) => {
    expect(classifyTicketCameraError(error)).toBe('no_camera');
  });

  it('starts one scanner and destroys it together with every media track', async () => {
    const instance = scanner();
    const loader: TicketCameraScannerLoader = vi.fn(async () => instance);
    const controller = new TicketCameraController(loader, useExistingVideoStream);
    const { tracks, video } = videoWithTracks();

    await expect(controller.start(video, { onDecode: vi.fn(), onError: vi.fn() })).resolves.toBe(true);
    expect(instance.start).toHaveBeenCalledTimes(1);

    controller.stop();

    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(video.srcObject).toBeNull();
  });

  it('destroys a scanner that resolves after the session was stopped without starting it', async () => {
    const instance = scanner();
    let resolveLoader: ((value: TicketCameraScanner) => void) | undefined;
    const loader: TicketCameraScannerLoader = vi.fn(() => new Promise((resolve) => {
      resolveLoader = resolve;
    }));
    const controller = new TicketCameraController(loader, useExistingVideoStream);
    const { video } = videoWithTracks();

    const starting = controller.start(video, { onDecode: vi.fn(), onError: vi.fn() });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    controller.stop();
    const replacement = attachReplacementStream(video);
    resolveLoader?.(instance);

    await expect(starting).resolves.toBe(false);
    expect(instance.start).not.toHaveBeenCalled();
    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(replacement.tracks.every((track) => track.stop.mock.calls.length === 0)).toBe(true);
    expect(video.srcObject).toBe(replacement.stream);
  });

  it('ignores a loader rejection from a session that was already stopped', async () => {
    const failure = new Error('stale loader failure');
    let rejectLoader: ((reason: unknown) => void) | undefined;
    const loader: TicketCameraScannerLoader = vi.fn(() => new Promise((_resolve, reject) => {
      rejectLoader = reject;
    }));
    const controller = new TicketCameraController(loader, useExistingVideoStream);
    const { video } = videoWithTracks();

    const starting = controller.start(video, { onDecode: vi.fn(), onError: vi.fn() });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    controller.stop();
    const replacement = attachReplacementStream(video);
    rejectLoader?.(failure);

    await expect(starting).resolves.toBe(false);
    expect(replacement.tracks.every((track) => track.stop.mock.calls.length === 0)).toBe(true);
    expect(video.srcObject).toBe(replacement.stream);
  });

  it('ignores a scanner startup rejection from a session that was replaced', async () => {
    const failure = new Error('stale scanner failure');
    const instance = scanner();
    let rejectStart: ((reason: unknown) => void) | undefined;
    instance.start.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectStart = reject;
    }));
    const controller = new TicketCameraController(async () => instance, useExistingVideoStream);
    const { video } = videoWithTracks();

    const starting = controller.start(video, { onDecode: vi.fn(), onError: vi.fn() });
    await vi.waitFor(() => expect(instance.start).toHaveBeenCalledTimes(1));
    controller.stop();
    const replacement = attachReplacementStream(video);
    rejectStart?.(failure);

    await expect(starting).resolves.toBe(false);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(replacement.tracks.every((track) => track.stop.mock.calls.length === 0)).toBe(true);
    expect(video.srcObject).toBe(replacement.stream);
  });

  it('does not stop a replacement stream when stale scanner startup resolves', async () => {
    const instance = scanner();
    let resolveStart: (() => void) | undefined;
    instance.start.mockImplementation(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));
    const controller = new TicketCameraController(async () => instance, useExistingVideoStream);
    const { video } = videoWithTracks();

    const starting = controller.start(video, { onDecode: vi.fn(), onError: vi.fn() });
    await vi.waitFor(() => expect(instance.start).toHaveBeenCalledTimes(1));
    controller.stop();
    const replacement = attachReplacementStream(video);
    resolveStart?.();

    await expect(starting).resolves.toBe(false);
    expect(replacement.tracks.every((track) => track.stop.mock.calls.length === 0)).toBe(true);
    expect(video.srcObject).toBe(replacement.stream);
  });

  it('accepts decode callbacks only from the active session', async () => {
    const instance = scanner();
    let decode: ((value: string) => void) | undefined;
    let decodeError: (() => void) | undefined;
    const loader: TicketCameraScannerLoader = vi.fn(async (_video, handlers) => {
      decode = handlers.onDecode;
      decodeError = handlers.onError;
      return instance;
    });
    const controller = new TicketCameraController(loader, useExistingVideoStream);
    const onDecode = vi.fn();
    const onError = vi.fn();
    const { video } = videoWithTracks();

    await controller.start(video, { onDecode, onError });
    decode?.('0123456789abcdef0123456789abcdef');
    decodeError?.();
    controller.stop();
    decode?.('secret-after-stop');
    decodeError?.();

    expect(onDecode).toHaveBeenCalledTimes(1);
    expect(onDecode).toHaveBeenCalledWith('0123456789abcdef0123456789abcdef');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('destroys the scanner and tracks when startup fails', async () => {
    const failure = cameraError('NotAllowedError');
    const instance = scanner();
    instance.start.mockRejectedValueOnce(failure);
    const controller = new TicketCameraController(async () => instance, useExistingVideoStream);
    const { tracks, video } = videoWithTracks();

    await expect(controller.start(video, { onDecode: vi.fn(), onError: vi.fn() })).rejects.toBe(failure);

    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(video.srcObject).toBeNull();
  });
});
