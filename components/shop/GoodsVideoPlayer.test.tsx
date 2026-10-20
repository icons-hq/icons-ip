import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => (() => void) | void)[], stateIndex: 0, refIndex: 0 }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (next: unknown) => { hooks.states[i] = next; }]; },
  useRef: (initial: unknown) => { const i = hooks.refIndex++; hooks.refs[i] ??= { current: initial }; return hooks.refs[i]; },
  useEffect: (effect: () => () => void) => { hooks.effects.push(effect); },
}));
import { GOODS_VIDEO_LOAD_TIMEOUT_MS, GoodsVideoPlayer } from './GoodsVideoPlayer';
import type { GoodsMediaAsset } from '@/lib/goods-media';
const asset: GoodsMediaAsset = { id: '92800000-0000-4000-8001-000000000001', kind: 'video', path: 'video/92800000-0000-4000-8001-000000000001.mp4', title: '영상 검증', url: 'http://localhost/video.mp4', width: 160, height: 120, durationMs: 2000, byteSize: 4001, sha256: 'a'.repeat(64), videoCodec: 'avc1.64000a', audioCodec: null };
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] { return Array.isArray(node) ? node.flatMap(elements) : isValidElement(node) ? [node as ReactElement<Record<string, unknown>>, ...elements((node.props as { children?: ReactNode }).children)] : []; }
function render(active = true) { hooks.stateIndex = 0; hooks.refIndex = 0; return elements(GoodsVideoPlayer({ asset, active, fallbackBackground: 'url("/poster.png") center/contain' })); }
beforeEach(() => { hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.stateIndex = 0; hooks.refIndex = 0; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
describe('video playback fallback', () => {
  it('pauses playback and shows the representative image after a load error', () => {
    const tree = render(), pause = vi.fn(); hooks.refs[0].current = { pause, readyState: 0 };
    (tree.find(item => item.type === 'video')!.props.onError as () => void)();
    expect(pause).toHaveBeenCalled(); expect(render().some(item => item.props.role === 'status')).toBe(true); expect(render().some(item => item.type === 'video')).toBe(false);
  });
  it('falls back after the bounded initial loading time, but metadata success stops the timer', () => {
    render(); hooks.refs[0].current = { pause: vi.fn(), readyState: 0 }; hooks.effects[0](); vi.advanceTimersByTime(GOODS_VIDEO_LOAD_TIMEOUT_MS);
    expect(render().some(item => item.props.role === 'status')).toBe(true);
    hooks.states = []; hooks.effects = []; const tree = render(); hooks.effects[0]();
    (tree.find(item => item.type === 'video')!.props.onLoadedMetadata as () => void)(); vi.advanceTimersByTime(GOODS_VIDEO_LOAD_TIMEOUT_MS * 2);
    expect(render().some(item => item.type === 'video')).toBe(true);
  });
  it('pauses when the gallery moves away without starting an inactive load timeout', () => {
    render(false); const pause = vi.fn(); hooks.refs[0].current = { pause, readyState: 0 }; hooks.effects[0]();
    expect(pause).toHaveBeenCalledOnce(); vi.advanceTimersByTime(GOODS_VIDEO_LOAD_TIMEOUT_MS * 2); expect(render(false).some(item => item.type === 'video')).toBe(true);
  });
});
