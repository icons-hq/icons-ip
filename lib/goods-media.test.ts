import { describe, expect, it } from 'vitest';
import { GOODS_MEDIA_MAX_BYTES, goodsMediaPath, normalizeGoodsMediaTitle, parseGoodsMediaPath, parseGoodsMediaSettings, validGoodsMediaUpload } from './goods-media';
describe('goods media contracts', () => {
  it('accepts only bounded declared MP4 uploads and exact owned path shapes', () => {
    expect(validGoodsMediaUpload({ kind: 'video', mimeType: 'video/mp4', size: GOODS_MEDIA_MAX_BYTES })).toBe(true);
    for (const invalid of [{ kind: 'gif', mimeType: 'video/mp4', size: 1 }, { kind: 'shortclip', mimeType: 'image/png', size: 1 }, { kind: 'video', mimeType: 'video/mp4', size: GOODS_MEDIA_MAX_BYTES + 1 }]) expect(validGoodsMediaUpload(invalid)).toBe(false);
    const path = goodsMediaPath('shortclip', '92400000-0000-4000-8000-000000000001'); expect(parseGoodsMediaPath(path)?.kind).toBe('shortclip');
    expect(parseGoodsMediaPath(`../${path}`)).toBeNull(); expect(parseGoodsMediaPath(`https://example.test/${path}`)).toBeNull();
  });
  it('normalizes titles and rejects unknown settings fields', () => {
    expect(normalizeGoodsMediaTitle('  상품 영상  ')).toBe('상품 영상'); expect(normalizeGoodsMediaTitle('가'.repeat(21))).toBeNull();
    expect(parseGoodsMediaSettings({ priority: 'shortclip', shortclips: true })).toEqual({ priority: 'shortclip', shortclips: true });
    expect(parseGoodsMediaSettings({ priority: 'image', shortclips: false, foreign: true })).toBeNull();
  });
});
