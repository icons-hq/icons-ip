export type TicketCameraErrorCode =
  | 'permission_denied'
  | 'no_camera'
  | 'camera_busy'
  | 'unsupported';

export interface TicketCameraScanner {
  start(): Promise<void>;
  destroy(): void;
}

export interface TicketCameraHandlers {
  onDecode(value: string): void;
  onError(): void;
}

export type TicketCameraScannerLoader = (
  video: HTMLVideoElement,
  handlers: TicketCameraHandlers,
) => Promise<TicketCameraScanner>;

export type TicketCameraStreamLoader = (video: HTMLVideoElement) => Promise<MediaStream>;

export function classifyTicketCameraError(error: unknown): TicketCameraErrorCode {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_camera';
  if (name === 'NotReadableError' || name === 'AbortError') return 'camera_busy';
  if (message === 'Camera not found.') return 'no_camera';
  return 'unsupported';
}

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function destroyScanner(
  scanner: TicketCameraScanner | null,
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
) {
  scanner?.destroy();
  stopStream(stream);
  if (video?.srcObject === stream) {
    video.pause();
    video.srcObject = null;
  }
}

export const loadTicketCameraStream: TicketCameraStreamLoader = async () =>
  navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } },
  });

export async function loadTicketCameraScanner(
  video: HTMLVideoElement,
  handlers: TicketCameraHandlers,
): Promise<TicketCameraScanner> {
  const { default: QrScanner } = await import('qr-scanner');
  const scannerVideo = document.createElement('video');
  scannerVideo.muted = true;
  scannerVideo.playsInline = true;

  const scanner = new QrScanner(
    scannerVideo,
    (result) => handlers.onDecode(result.data),
    {
      maxScansPerSecond: 10,
      onDecodeError: (error) => {
        const message = error instanceof Error ? error.message : error;
        if (message !== QrScanner.NO_QR_CODE_FOUND) handlers.onError();
      },
      preferredCamera: 'environment',
      returnDetailedScanResult: true,
    },
  );

  return {
    destroy: () => {
      scanner.destroy();
      scannerVideo.srcObject = null;
      scannerVideo.remove();
    },
    start: async () => {
      scannerVideo.srcObject = video.srcObject;
      await Promise.all([video.play(), scanner.start()]);
    },
  };
}

export class TicketCameraController {
  private generation = 0;
  private scanner: TicketCameraScanner | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  constructor(
    private readonly loader: TicketCameraScannerLoader = loadTicketCameraScanner,
    private readonly streamLoader: TicketCameraStreamLoader = loadTicketCameraStream,
  ) {}

  async start(video: HTMLVideoElement, handlers: TicketCameraHandlers): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    this.video = video;

    let stream: MediaStream;
    try {
      stream = await this.streamLoader(video);
    } catch (error) {
      if (this.generation !== generation) return false;
      this.video = null;
      throw error;
    }

    if (this.generation !== generation) {
      stopStream(stream);
      return false;
    }

    video.srcObject = stream;
    this.stream = stream;

    let scanner: TicketCameraScanner;
    try {
      scanner = await this.loader(video, {
        onDecode: (value) => {
          if (this.generation === generation) handlers.onDecode(value);
        },
        onError: () => {
          if (this.generation === generation) handlers.onError();
        },
      });
    } catch (error) {
      if (this.generation !== generation) return false;
      this.video = null;
      this.stream = null;
      destroyScanner(null, video, stream);
      throw error;
    }

    if (this.generation !== generation) {
      scanner.destroy();
      return false;
    }

    this.scanner = scanner;
    try {
      await scanner.start();
    } catch (error) {
      if (this.generation !== generation) return false;
      this.scanner = null;
      this.stream = null;
      this.video = null;
      destroyScanner(scanner, video, stream);
      throw error;
    }

    if (this.generation !== generation) return false;
    return true;
  }

  stop() {
    this.generation += 1;
    const scanner = this.scanner;
    const stream = this.stream;
    const video = this.video;
    this.scanner = null;
    this.stream = null;
    this.video = null;
    destroyScanner(scanner, video, stream);
  }
}
