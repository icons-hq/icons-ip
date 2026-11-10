import { describe, expect, it, vi } from 'vitest';
import { drawPhotoPresentation, photoFrameMaximum, photoFrameWidth, photoOutline, validatePhotoPresentation, type PhotoPresentation } from './photo-editor-presentation';

const none: PhotoPresentation = { mask: 'none', frameWidth: 0, frameColor: '#ffffff' };
function context() {
  const events: { op: string; args: unknown[]; composite: string; color: string }[] = [];
  const target: Record<string, unknown> = { globalCompositeOperation: 'source-over', fillStyle: 'old', globalAlpha: .3 };
  for (const op of ['save', 'restore', 'resetTransform', 'beginPath', 'moveTo', 'arc', 'rect', 'arcTo', 'lineTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke', 'setLineDash'])
    target[op] = vi.fn((...args: unknown[]) => { events.push({ op, args, composite: target.globalCompositeOperation as string, color: target.fillStyle as string }); });
  return { value: target as unknown as CanvasRenderingContext2D, events };
}
describe('final crop presentation', () => {
  it('uses a centered true circle in a non-square crop, with a concentric inside edge', () => {
    expect(photoOutline({ width: 300, height: 100 }, 'circle')).toEqual({ kind: 'circle', x: 150, y: 50, radius: 50 });
    expect(photoOutline({ width: 100, height: 300 }, 'circle', 8)).toEqual({ kind: 'circle', x: 50, y: 150, radius: 42 });
    expect(photoOutline({ width: 2, height: 100 }, 'circle', 1)).toBeNull();
  });
  it('keeps a 10% outer rounded radius and subtracts the inside inset without negative arcs', () => {
    expect(photoOutline({ width: 300, height: 100 }, 'rounded')).toEqual({ kind: 'rectangle', x: 0, y: 0, width: 300, height: 100, radius: 10 });
    expect(photoOutline({ width: 300, height: 100 }, 'rounded', 8)).toEqual({ kind: 'rectangle', x: 8, y: 8, width: 284, height: 84, radius: 2 });
    expect(photoOutline({ width: 300, height: 100 }, 'rounded', 20)).toMatchObject({ radius: 0 });
    expect(photoOutline({ width: 1, height: 1 }, 'rounded')).toMatchObject({ radius: .1 });
  });
  it.each([[1, 4096, 0], [2, 4096, 1], [127, 500, 63], [128, 128, 64], [2000, 2000, 64]])('clamps border for %s×%s to %s', (width, height, maximum) => {
    expect(photoFrameMaximum({ width, height })).toBe(maximum);
    expect(photoFrameWidth({ width, height }, 64)).toBe(maximum);
  });
  it('none/zero does not touch the context even when the inactive color changes', () => {
    const ctx = context(); drawPhotoPresentation(ctx.value, { width: 400, height: 300 }, { ...none, frameColor: '#abcd12' });
    expect(ctx.events).toEqual([]);
  });
  it('draws an inside evenodd circle ring before one destination-in outer mask, with source matrix reset', () => {
    const ctx = context(); drawPhotoPresentation(ctx.value, { width: 300, height: 100 }, { mask: 'circle', frameWidth: 8, frameColor: '#123456' });
    expect(ctx.events.filter(event => event.op === 'arc').map(event => event.args)).toEqual([[150, 50, 50, 0, Math.PI * 2], [150, 50, 42, 0, Math.PI * 2], [150, 50, 50, 0, Math.PI * 2]]);
    expect(ctx.events.filter(event => event.op === 'fill')).toEqual([
      { op: 'fill', args: ['evenodd'], composite: 'source-over', color: '#123456' },
      { op: 'fill', args: [], composite: 'destination-in', color: '#000000' },
    ]);
    expect(ctx.events.slice(0, 2).map(event => event.op)).toEqual(['save', 'resetTransform']); expect(ctx.events.at(-1)?.op).toBe('restore');
  });
  it('draws rectangular borders without masking and applies rounded masks without painting a background', () => {
    const border = context(); drawPhotoPresentation(border.value, { width: 4, height: 2 }, { ...none, frameWidth: 64 });
    expect(border.events.filter(event => event.op === 'rect').map(event => event.args)).toEqual([[0, 0, 4, 2]]);
    expect(border.events.filter(event => event.op === 'fill').map(event => event.composite)).toEqual(['source-over']);
    const mask = context(); drawPhotoPresentation(mask.value, { width: 40, height: 20 }, { ...none, mask: 'rounded' });
    expect(mask.events.filter(event => event.op === 'fill').map(event => event.composite)).toEqual(['destination-in']);
    expect(mask.events.filter(event => event.op === 'arcTo')).toHaveLength(4);
  });
  it('restores canvas state when native path drawing fails', () => {
    const ctx = context(); vi.mocked(ctx.value.arc).mockImplementationOnce(() => { throw new Error('native path failure'); });
    expect(() => drawPhotoPresentation(ctx.value, { width: 40, height: 20 }, { ...none, mask: 'circle' })).toThrow('native');
    expect(ctx.events.at(-1)?.op).toBe('restore');
  });
  it.each([{ mask: 'unknown' }, { frameWidth: -1 }, { frameWidth: 65 }, { frameWidth: .5 }, { frameWidth: NaN }, { frameColor: 'red' }, { frameColor: '#fff' }, { frameColor: '#12345600' }])('rejects an invalid external recipe %j', patch => {
    expect(() => validatePhotoPresentation({ ...none, ...patch } as PhotoPresentation)).toThrow('테두리');
  });
  it.each([['triangle', 3], ['pentagon', 5], ['hexagon', 6], ['star', 10]] as const)('%s is regular in a non-square final crop and starts at the top', (mask, count) => {
    const outline = photoOutline({ width: 300, height: 100 }, mask);
    expect(outline?.kind).toBe('polygon'); if (outline?.kind !== 'polygon') throw new Error('polygon expected');
    expect(outline.points).toHaveLength(count); expect(outline.points[0].x).toBeCloseTo(150); expect(outline.points[0].y).toBeCloseTo(0);
    outline.points.forEach((point, index) => {
      expect(Math.hypot(point.x - 150, point.y - 50)).toBeCloseTo(mask === 'star' && index % 2 ? 22.5 : 50);
      expect(point.x).toBeGreaterThanOrEqual(100); expect(point.x).toBeLessThanOrEqual(200);
      expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(100);
    });
    if (mask !== 'star') {
      const lengths = outline.points.map((point, index) => Math.hypot(point.x - outline.points[(index + 1) % count].x, point.y - outline.points[(index + 1) % count].y));
      lengths.forEach(length => expect(length).toBeCloseTo(lengths[0]));
    }
  });
  it.each(['triangle', 'pentagon', 'hexagon', 'star'] as const)('%s uses a round distance border before exactly one outer mask', mask => {
    const ctx = context(); drawPhotoPresentation(ctx.value, { width: 300, height: 100 }, { ...none, mask, frameWidth: 8, frameColor: '#abcdef' });
    expect(ctx.value.lineWidth).toBe(16); expect(ctx.value.lineJoin).toBe('round'); expect(ctx.value.strokeStyle).toBe('#abcdef');
    expect(ctx.events.filter(event => ['stroke', 'fill'].includes(event.op)).map(event => [event.op, event.composite])).toEqual([['stroke', 'source-over'], ['fill', 'destination-in']]);
    expect(ctx.events.at(-1)?.op).toBe('restore');
    expect(() => photoOutline({ width: 300, height: 100 }, mask, 8)).toThrow('안쪽 선');
  });
  it('a one-pixel polygon uses only the mask and rejects unknown masks through presentation validation', () => {
    const ctx = context(); drawPhotoPresentation(ctx.value, { width: 1, height: 4096 }, { ...none, mask: 'star', frameWidth: 64 });
    expect(ctx.events.some(event => event.op === 'stroke')).toBe(false);
    expect(ctx.events.filter(event => event.op === 'fill')).toHaveLength(1);
  });
  it.each(['circle', 'rounded', 'triangle', 'pentagon', 'hexagon', 'star'] as const)('%s retains one final mask after double and dashed contours', mask => {
    for (const frameStyle of ['double', 'dashed'] as const) {
      const ctx = context(); drawPhotoPresentation(ctx.value, { width: 300, height: 100 }, { ...none, mask, frameWidth: 9, frameStyle });
      const paints = ctx.events.filter(event => event.op === 'stroke' || event.op === 'fill');
      expect(paints.filter(event => event.op === 'stroke')).toHaveLength(frameStyle === 'double' ? 2 : 1);
      expect(paints.filter(event => event.composite === 'destination-in')).toHaveLength(1);
      expect(paints.at(-1)).toMatchObject({ op: 'fill', composite: 'destination-in' });
      expect(ctx.events.at(-1)?.op).toBe('restore');
    }
  });
  it('double widths below three use one stroke and inactive decorated frames leave the context untouched', () => {
    const narrow = context(); drawPhotoPresentation(narrow.value, { width: 100, height: 60 }, { ...none, frameWidth: 2, frameStyle: 'double' });
    expect(narrow.events.filter(event => event.op === 'stroke')).toHaveLength(1);
    const inactive = context(); drawPhotoPresentation(inactive.value, { width: 400, height: 300 }, { ...none, frameStyle: 'dashed' }); expect(inactive.events).toEqual([]);
    expect(() => validatePhotoPresentation({ ...none, frameStyle: 'external' } as never)).toThrow();
  });
});
