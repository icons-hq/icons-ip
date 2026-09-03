import { describe, expect, it } from 'vitest';
import {
  describeGoodsDraft,
  formatGoodsDraftSavedAt,
  goodsDraftValues,
  isGoodsDraftBlank,
  parseGoodsDraft,
  serializeGoodsDraft,
} from './goods-draft';

const formValues = {
  previousId: '',
  previousIpId: '',
  id: 'g200',
  ipId: 'hwasan',
  name: '화산강림 엽서',
  type: '문구',
  price: '3000',
  compareAtPrice: '',
  badge: 'NEW',
  stock: 'ok',
  initialStockQty: '30',
  initialStockAdjustmentId: '11111111-1111-4111-8111-111111111111',
  bg: '',
  imagePath: 'public-media/catalog/good/x.webp',
  galleryPath0: 'public-media/catalog/good/y.webp',
  detailImagePath: '',
  description: '설명',
  noticeMaker: '주식회사 아이콘스',
  noticeOrigin: '대한민국',
  noticeMaterial: '종이',
  noticeSize: 'A6',
  noticeMadeOn: '2026-07',
  noticeAsManager: '아이콘스 고객센터',
  noticeAsContact: '02-000-0000',
};

describe('goods draft', () => {
  it('keeps only the draftable string fields — no hidden control fields or image paths', () => {
    const values = goodsDraftValues(formValues);

    expect(values).toMatchObject({ id: 'g200', name: '화산강림 엽서', initialStockQty: '30', noticeMaker: '주식회사 아이콘스' });
    for (const name of ['previousId', 'imagePath', 'galleryPath0', 'detailImagePath', 'initialStockAdjustmentId', 'bg']) {
      expect(values).not.toHaveProperty(name);
    }
  });

  it('treats a form that still has only its defaults as blank', () => {
    expect(isGoodsDraftBlank({ price: '0', stock: 'ok' })).toBe(true);
    expect(isGoodsDraftBlank({})).toBe(true);
    expect(isGoodsDraftBlank({ price: '0', stock: 'ok', name: ' ' })).toBe(true);
    expect(isGoodsDraftBlank({ price: '0', stock: 'ok', name: '엽서' })).toBe(false);
    expect(isGoodsDraftBlank({ price: '1200', stock: 'ok' })).toBe(false);
  });

  it('round-trips through JSON with a saved-at stamp and rejects malformed or blank drafts', () => {
    const now = new Date('2026-09-03T03:10:00.000Z');
    const raw = serializeGoodsDraft(formValues, now);
    const draft = parseGoodsDraft(raw);

    expect(draft?.savedAt).toBe('2026-09-03T03:10:00.000Z');
    expect(draft?.values).toEqual(goodsDraftValues(formValues));
    expect(parseGoodsDraft('')).toBeNull();
    expect(parseGoodsDraft('{oops')).toBeNull();
    expect(parseGoodsDraft(JSON.stringify({ savedAt: 'yesterday', values: { name: 'x' } }))).toBeNull();
    expect(parseGoodsDraft(JSON.stringify({ savedAt: now.toISOString(), values: { price: '0', stock: 'ok' } }))).toBeNull();
    expect(parseGoodsDraft(JSON.stringify({ savedAt: now.toISOString(), values: { name: 42, id: 'g1' } }))?.values.id).toBe('g1');
  });

  it('describes the draft by id and name and formats the stamp in KST', () => {
    const draft = parseGoodsDraft(serializeGoodsDraft(formValues, new Date('2026-09-03T03:10:00.000Z')));

    expect(draft && describeGoodsDraft(draft)).toBe('g200 · 화산강림 엽서');
    expect(describeGoodsDraft({ savedAt: '2026-09-03T03:10:00.000Z', values: { id: '', name: '  ' } })).toBe('(ID·이름 미입력)');
    expect(formatGoodsDraftSavedAt('2026-09-03T03:10:00.000Z')).toMatch(/9\. 3\. 12:10/);
  });
});
