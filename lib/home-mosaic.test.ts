import { describe, expect, it } from 'vitest';
import { buildHomeMosaicBand, emptyHomeMosaicSlots, parseHomeMosaicPayload } from './home-mosaic';
import type { HomeGoodsCard } from './home-catalog';
const path = 'public-media/catalog/curation/11111111-1111-4111-8111-111111111111.png';
const payload = () => ({ mosaic_title: '함께 보세요', mosaic_subtitle: '좋아하는 상품들', slots: emptyHomeMosaicSlots() });
const good: HomeGoodsCard = { id: 'g1', name: '상품1', href: '/shop/product-one', brand: null, price: 1000, badge: null, imageBg: '', soldOut: true };
describe('product mosaic contract', () => {
  it('keeps exactly eight independent positions and permits image-only drafts', () => {
    const data = payload(); data.slots[7] = { good_id: null, image_path: path };
    expect(parseHomeMosaicPayload(data)).toEqual(data);
    expect(parseHomeMosaicPayload({ ...data, slots: data.slots.slice(1) })).toBeNull();
    expect(parseHomeMosaicPayload({ ...data, slots: [...data.slots, data.slots[0]] })).toBeNull();
  });
  it('rejects foreign keys, invalid references, controls, and overlong captions', () => {
    for (const invalid of [null, { ...payload(), unknown: true }, { ...payload(), mosaic_title: '가'.repeat(11) },
      { ...payload(), mosaic_subtitle: '가'.repeat(21) }, { ...payload(), mosaic_title: '\n제목' },
      { ...payload(), mosaic_title: '\u00a0제목' }]) expect(parseHomeMosaicPayload(invalid)).toBeNull();
    for (const slot of [{ good_id: 'bad/id', image_path: path }, { good_id: 'g1', image_path: 'https://other.test/a.png' },
      { good_id: 'g1', image_path: path, extra: true }, { good_id: 'g1' }]) {
      const data = payload(); data.slots[0] = slot as typeof data.slots[0]; expect(parseHomeMosaicPayload(data)).toBeNull();
    }
  });
  it('removes private/missing product links without shifting later slots and retains sold-out products', () => {
    const data = payload(); data.slots[0] = { good_id: 'hidden', image_path: path }; data.slots[5] = { good_id: 'g1', image_path: path };
    const band = buildHomeMosaicBand('id', '기획 모음', data, [good], image => `cdn:${image}`);
    expect(band.tiles).toHaveLength(8); expect(band.tiles[0]).toBeNull();
    expect(band.tiles[5]).toEqual({ good, imageUrl: `cdn:${path}` });
    expect(band.tiles.filter(Boolean)).toHaveLength(1);
  });
});
