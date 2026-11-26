import { describe, expect, it } from 'vitest';
import { validGoodsPhotoInput, parseGoodsPhotoPage, goodsPhotoError, goodsPhotoNameFromFileName, goodsPhotoReferenceLabel, normalizeGoodsPhotoQuery } from './goods-photo-library';
describe('사진 이름 정규화 (R20)', () => {
  it('macOS NFD 파일 이름을 NFC로 바꾸고 앞뒤 공백을 지운다', () => {
    expect(goodsPhotoNameFromFileName(' 메이플 키링.png '.normalize('NFD'))).toBe('메이플 키링.png'.normalize('NFC'));
    expect(normalizeGoodsPhotoQuery(' 키링 '.normalize('NFD'))).toBe('키링'.normalize('NFC'));
  });
  it('NFC로 바꾼 뒤 100자로 자르고, 이모지를 반으로 자르지 않는다', () => {
    expect(goodsPhotoNameFromFileName('가'.repeat(120).normalize('NFD'))).toBe('가'.repeat(100));
    const emoji = goodsPhotoNameFromFileName('😀'.repeat(60));
    expect(emoji).toBe('😀'.repeat(50));
    expect(validGoodsPhotoInput({ ...photo, name: emoji })).toBe(true);
  });
  it('빈 이름은 기본 이름으로 등록한다', () => {
    expect(goodsPhotoNameFromFileName('   ')).toBe('상품 이미지');
  });
});
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
    expect(goodsPhotoError('goods_photo_in_use')).toBe('사용 중인 사진은 보관할 수 없습니다. 이 사진을 쓰는 상품·전시에서 먼저 다른 사진으로 바꿔 주세요.');
    /* 저장 전 화면은 옛 내용이라 그대로 다시 저장하면 또 막힌다. 목록을 다시 불러오라고 알린다. */
    expect(goodsPhotoError('goods_photo_changed')).toBe('다른 사람이 이 사진을 먼저 바꿨습니다. [검색]을 눌러 목록을 다시 불러온 뒤 다시 해 주세요.');
  });
  /* 올릴 때·이름을 바꿀 때·보관할 때 모두 같은 문구가 나온다. 어느 쪽에서 읽어도 맞고, 다음에 할 일을 말한다. */
  it('이유를 모르는 저장 실패는 목록부터 보라고 안내하고 개발 용어를 쓰지 않는다', () => {
    for (const message of [undefined, 'unexpected', 'permission denied']) {
      expect(goodsPhotoError(message)).toBe('사진을 저장하지 못했습니다. 목록에 반영됐는지 먼저 보고, 안 됐으면 다시 해 주세요.');
    }
    expect(goodsPhotoError(undefined)).not.toMatch(/입력을 유지|저장 여부/);
  });
});
