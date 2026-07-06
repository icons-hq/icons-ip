import type Box2DFactory from 'box2d-wasm';

export type Box2DModule = Awaited<ReturnType<typeof Box2DFactory>>;

let cached: Promise<Box2DModule> | null = null;

/** 브라우저 전용 로더 — .wasm은 postinstall이 public/box2d/로 복사한 정적 자산에서 가져온다. */
export function loadBox2D(): Promise<Box2DModule> {
  if (!cached) {
    cached = import('box2d-wasm').then(({ default: factory }) =>
      factory({ locateFile: (url: string) => `/box2d/${url}` }),
    );
  }
  return cached;
}
