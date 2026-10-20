import { describe, expect, it } from 'vitest';
import { validGoodsPhotoInput, parseGoodsPhotoPage, goodsPhotoError } from './goods-photo-library';
const photo = { id: '00000000-0000-4000-8000-000000071301', name: '검수 사진', imagePath: 'public-media/catalog/good/00000000-0000-4000-8000-000000071302.webp', revision: 1, archived: false, createdAt: '2026-10-13T00:00:00Z', references: [] };
describe('공용 사진 계약', () => {
  it('상품 업로드 경로만 받고 외부 URL·다른 종류·불완전 입력은 차단한다', () => {
    expect(validGoodsPhotoInput(photo)).toBe(true);
    for (const value of [{...photo,imagePath:'https://example.com/a.png'},{...photo,imagePath:photo.imagePath.replace('/good/','/curation/')},{...photo,name:' '},{...photo,name:'가'.repeat(101)},{...photo,revision:-1},{...photo,archived:'false'}]) expect(validGoodsPhotoInput(value as typeof photo)).toBe(false);
  });
  it('불완전한 목록 응답을 성공으로 처리하지 않는다', () => {
    const page = { rows: [photo], total: 1, page: 1, pageSize: 20 };
    expect(parseGoodsPhotoPage(page)).toEqual(page);
    expect(parseGoodsPhotoPage({...page,rows:[{...photo,references:[{id:'story',name:'스토리',kind:'story'},{id:'draft',name:'초안',kind:'draft'}]}]})).not.toBeNull();
    expect(parseGoodsPhotoPage({...page, rows:[{...photo,references:[{id:'a',name:'상품',kind:'unknown'}]}]})).toBeNull();
    expect(parseGoodsPhotoPage({...page,rows:[{...photo,createdAt:'wrong'}]})).toBeNull();
    expect(parseGoodsPhotoPage({...page,total:-1})).toBeNull();
  });
  it('사용 중·변경 충돌을 복구 가능한 메시지로 구분한다', () => {
    expect(goodsPhotoError('goods_photo_in_use')).toContain('먼저');
    expect(goodsPhotoError('goods_photo_changed')).toContain('입력은 유지');
  });
});
