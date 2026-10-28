import { describe, expect, it } from 'vitest';
import { validGoodsPhotoInput, parseGoodsPhotoPage, goodsPhotoError, goodsPhotoReferenceLabel } from './goods-photo-library';
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
    expect(parseGoodsPhotoPage({...page, rows:[{...photo,references:[{id:'a',name:'상품',kind:7}]}]})).toBeNull();
    expect(parseGoodsPhotoPage({...page, rows:[{...photo,references:[{id:'a',name:null,kind:'good'}]}]})).toBeNull();
    expect(parseGoodsPhotoPage({...page,rows:[{...photo,createdAt:'wrong'}]})).toBeNull();
    expect(parseGoodsPhotoPage({...page,total:-1})).toBeNull();
  });
  /* MD-0025: DB가 새 참조 종류(marketing_test 등)를 돌려줘도 보관함 전체가 '불러오지 못했습니다'가 되면 안 된다. */
  it('모르는 참조 종류가 섞여도 목록을 버리지 않고 기타 참조로 표시한다', () => {
    const page = { rows: [{...photo,references:[{id:'t1',name:'운영자 테스트 메시지',kind:'marketing_test'},{id:'x',name:'새 화면',kind:'future_surface'}]}], total: 1, page: 1, pageSize: 20 };
    expect(parseGoodsPhotoPage(page)).toEqual(page);
    expect(goodsPhotoReferenceLabel('marketing_test')).toBe('고객 안내 메시지 테스트 발송');
    expect(goodsPhotoReferenceLabel('marketing')).toBe('고객 안내 메시지');
    expect(goodsPhotoReferenceLabel('good')).toBe('상품');
    expect(goodsPhotoReferenceLabel('future_surface')).toBe('기타 참조');
    expect(goodsPhotoReferenceLabel('toString')).toBe('기타 참조');
  });
  it('사용 중·변경 충돌을 복구 가능한 메시지로 구분한다', () => {
    expect(goodsPhotoError('goods_photo_in_use')).toContain('먼저');
    expect(goodsPhotoError('goods_photo_changed')).toContain('입력은 유지');
  });
});
