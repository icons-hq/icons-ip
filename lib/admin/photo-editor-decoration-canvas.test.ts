import { describe, expect, it, vi } from 'vitest';
import { drawPhotoGeometry, drawPhotoSticker, drawPhotoText } from './photo-editor-decoration-canvas';
import { photoStickerGeometry, type PhotoSticker } from './photo-editor-decorations';
import type { PhotoText } from './photo-editor-layers';

function context() {
  const events: { op: string; args: unknown[]; alpha: number; font: string; color: string; baseline: string }[] = [];
  const stack: Record<string, unknown>[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, font: '', fillStyle: '', textBaseline: '' };
  const methods: Record<string, unknown> = {};
  for (const op of ['translate', 'rotate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke', 'setLineDash', 'fillText'])
    methods[op] = vi.fn((...args: unknown[]) => events.push({ op, args, alpha: state.globalAlpha as number, font: state.font as string, color: state.fillStyle as string, baseline: state.textBaseline as string }));
  methods.save = vi.fn(() => { stack.push({ ...state }); });
  methods.restore = vi.fn(() => { Object.assign(state, stack.pop()); });
  methods.measureText = vi.fn((line: string) => ({ width: line.length * 12, actualBoundingBoxLeft: 0, actualBoundingBoxRight: line.length * 12, actualBoundingBoxAscent: 15, actualBoundingBoxDescent: 4 }));
  const value = new Proxy(state, { get: (target, key) => methods[String(key)] ?? target[String(key)], set: (target, key, value) => { target[String(key)] = value; return true; } }) as unknown as CanvasRenderingContext2D;
  return { value, events, stack };
}
const sticker: PhotoSticker = { id: 'mark', asset: 'check', x: 20, y: 30, width: 40, turns: 1, color: '#de1234', opacity: 50 };
const plain: PhotoText = { id: 'words', x: 10, y: 20, text: '한글\n둘째 줄', fontSize: 20, color: '#123456' };

describe('shared geometry Canvas adapter', () => {
  it('uses the exact numeric commands and appearance from the inert preview geometry', () => {
    const ctx = context(), paths = photoStickerGeometry('heart'); drawPhotoGeometry(ctx.value, paths, '#aabbcc');
    expect(ctx.events.filter(e => e.op === 'bezierCurveTo').map(e => e.args)).toEqual(paths[0].commands.filter(command => command[0] === 'C').map(command => command.slice(1)));
    expect(ctx.events.filter(e => e.op === 'fill').map(e => e.color)).toEqual(['#aabbcc']);
  });
  it('applies source placement, quarter turn and opacity while restoring the prior context', () => {
    const ctx = context(); ctx.value.globalAlpha = .7;
    drawPhotoSticker(ctx.value, sticker);
    expect(ctx.events.filter(e => ['translate', 'rotate', 'scale'].includes(e.op)).map(e => [e.op, e.args])).toEqual([
      ['translate', [40, 50]], ['rotate', [Math.PI / 2]], ['scale', [.4, .4]], ['translate', [-50, -50]],
    ]);
    expect(ctx.events.find(e => e.op === 'stroke')?.alpha).toBe(.5); expect(ctx.value.globalAlpha).toBe(.7); expect(ctx.stack).toEqual([]);
    const inactive = context(); drawPhotoSticker(inactive.value, { ...sticker, opacity: 0 }); expect(inactive.events).toEqual([]);
  });
  it('keeps plain multiline drawing positions and baseline byte-for-byte compatible', () => {
    const ctx = context(); drawPhotoText(ctx.value, plain);
    expect(ctx.events.map(e => [e.op, e.args, e.font, e.baseline, e.color])).toEqual([
      ['fillText', ['한글', 10, 20], '400 20px "Pretendard"', 'top', '#123456'],
      ['fillText', ['둘째 줄', 10, 46], '400 20px "Pretendard"', 'top', '#123456'],
    ]);
    expect(ctx.value.measureText).not.toHaveBeenCalled();
  });
  it('measures the actual font before any decoration paint and renders Korean after its background', () => {
    const ctx = context();
    drawPhotoText(ctx.value, { ...plain, style: 'bubble-round', decorationWidth: 240, backgroundColor: '#ffeecc' });
    expect(ctx.value.measureText).toHaveBeenNthCalledWith(1, '한글'); expect(ctx.value.measureText).toHaveBeenNthCalledWith(2, '둘째 줄');
    const fill = ctx.events.findIndex(e => e.op === 'fill'), text = ctx.events.findIndex(e => e.op === 'fillText');
    expect(fill).toBeLessThan(text); expect(ctx.events[fill].color).toBe('#ffeecc');
    expect(ctx.events.filter(e => e.op === 'fillText').every(e => e.baseline === 'alphabetic' && e.font === '400 20px "Pretendard"')).toBe(true);
    expect(ctx.stack).toEqual([]);
  });
  it('rejects overflow before painting and skips the complete background for blank text', () => {
    const ctx = context(); expect(() => drawPhotoText(ctx.value, { ...plain, style: 'signature-seal', decorationWidth: 20, backgroundColor: '#ffffff' })).toThrow('맞지');
    expect(ctx.events.some(e => e.op === 'fill' || e.op === 'fillText')).toBe(false); expect(ctx.stack).toEqual([]);
    const blank = context(); drawPhotoText(blank.value, { ...plain, text: ' \n ', style: 'bubble-oval', decorationWidth: 100, backgroundColor: '#ffffff' });
    expect(blank.events).toEqual([]); expect(blank.value.measureText).not.toHaveBeenCalled();
  });
  it('restores state even when native geometry throws', () => {
    const ctx = context(); vi.mocked(ctx.value.lineTo).mockImplementationOnce(() => { throw new Error('native'); });
    expect(() => drawPhotoSticker(ctx.value, sticker)).toThrow('native'); expect(ctx.stack).toEqual([]);
  });
});
