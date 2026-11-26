import { describe, expect, it } from 'vitest';
import { EMPTY_GOODS_AFTER_SALES } from '@/lib/goods-after-sales';
import { GOODS_GROUP_SOURCE_CONFIRM, goodsGroupAfterSalesBlank, goodsGroupAxisConfirm, goodsGroupCommonConfirm, goodsGroupMemberConfirm, goodsGroupSelectionConfirm } from './goods-group-confirm';

const member = (publishedAt: string | null, archivedAt: string | null = null) => ({ publishedAt, archivedAt }) as never;
const filled = { phone: '1588-0000', guide: '평일 10시부터 17시까지', sellerSpecialNotes: '' };

describe('옵션명 개수 줄이기 확인', () => {
  const rows = [{ values: ['빨강', 'S', ''] }, { values: ['파랑', 'M', 'A'] }];
  it('줄어드는 쪽에 적은 옵션명이나 옵션값이 없으면 묻지 않는다', () => {
    expect(goodsGroupAxisConfirm(['색상', '', ''], [{ values: ['빨강', '', ''] }], 1)).toBeNull();
    expect(goodsGroupAxisConfirm(['색상', ' ', ' '], [{ values: ['빨강', ' ', ''] }], 1)).toBeNull();
    expect(goodsGroupAxisConfirm(['색상', '크기'], rows, 3)).toBeNull();
  });
  it('옵션명과 옵션값이 함께 사라지면 둘을 모두 말하고 이름은 줄어드는 것만 보인다', () => {
    expect(goodsGroupAxisConfirm(['색상', '크기', '용량'], rows, 1)).toEqual({ title: '옵션명을 1개로 줄일까요?', message: '‘크기’·‘용량’ 옵션명과 적어 둔 옵션값 3개가 사라집니다.', confirmLabel: '줄이기' });
    expect(goodsGroupAxisConfirm(['색상', '크기', '용량'], rows, 2)?.message).toBe('‘용량’ 옵션명과 적어 둔 옵션값 1개가 사라집니다.');
  });
  it('옵션명만 또는 옵션값만 있을 때도 그것만 말한다', () => {
    expect(goodsGroupAxisConfirm(['색상', '크기'], [{ values: ['빨강', ''] }], 1)?.message).toBe('‘크기’ 옵션명이 사라집니다.');
    expect(goodsGroupAxisConfirm(['색상', ''], [{ values: ['빨강', 'S'] }, { values: ['파랑', ' '] }], 1)?.message).toBe('적어 둔 옵션값 1개가 사라집니다.');
  });
});

describe('상품 제외·옵션 빼기 확인', () => {
  it('상품 제외는 적어 둔 옵션값이 있을 때만 상품 이름과 개수를 보여 준다', () => {
    expect(goodsGroupMemberConfirm('머그컵 빨강', ['', ' '])).toBeNull();
    expect(goodsGroupMemberConfirm('머그컵 빨강', ['빨강', 'S', ''])).toEqual({ title: '이 상품을 그룹에서 제외할까요?', message: '‘머그컵 빨강’ 상품에 적어 둔 옵션값 2개가 사라집니다.', confirmLabel: '제외' });
  });
  it('전환에서 옵션을 뺄 때는 고쳐 적은 값이 있을 때만 묻는다', () => {
    expect(goodsGroupSelectionConfirm('빨강', 0)).toBeNull();
    expect(goodsGroupSelectionConfirm('빨강', 2)).toEqual({ title: '전환할 옵션에서 뺄까요?', message: '‘빨강’ 옵션에 고쳐 적은 옵션값 2개가 사라집니다.', confirmLabel: '빼기' });
  });
  it('상품을 바꾸는 확인은 입력이 새 상품의 값으로 다시 채워진다고 말한다', () => {
    expect(GOODS_GROUP_SOURCE_CONFIRM).toMatchObject({ title: '다른 상품으로 바꿀까요?', confirmLabel: '상품 바꾸기' });
    expect(GOODS_GROUP_SOURCE_CONFIRM.message).toContain('다시 채워집니다');
  });
});

describe('그룹 공통정보 적용 확인', () => {
  it('공개 중인 수만 초안으로 바뀐다고 말하고, 보관된 상품과 이미 초안인 상품은 세지 않는다', () => {
    const request = goodsGroupCommonConfirm({ members: [member('2026-11-01T00:00:00Z'), member('2026-11-02T00:00:00Z'), member(null), member('2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z')] }, filled);
    expect(request.title).toBe('연결된 4개 상품에 공통정보를 적용할까요?');
    expect(request.message.split('\n')).toEqual(['공개 중인 상품 2개가 초안으로 바뀌어 고객 화면에서 내려갑니다.', '상품 4개 모두 KC 검토를 다시 마쳐야 공개할 수 있습니다.']);
    expect(request.confirmLabel).toBe('적용');
  });
  it('모두 초안이면 초안 전환 줄이 없다', () => {
    expect(goodsGroupCommonConfirm({ members: [member(null), member(null)] }, filled).message).toBe('상품 2개 모두 KC 검토를 다시 마쳐야 공개할 수 있습니다.');
  });
  it('A/S 안내가 비어 있으면 모든 상품에서 비워진다는 줄을 더한다', () => {
    expect(goodsGroupCommonConfirm({ members: [member(null)] }, EMPTY_GOODS_AFTER_SALES).message.split('\n')).toEqual([
      '상품 1개 모두 KC 검토를 다시 마쳐야 공개할 수 있습니다.', 'A/S 안내와 판매자 특이사항은 상품 1개 모두에서 비워집니다.']);
  });
  it('A/S 안내가 비었는지는 서버와 같이 공백·줄바꿈·탭만 남은 것을 빈 것으로 본다', () => {
    expect(goodsGroupAfterSalesBlank({ phone: ' ', guide: '\n\t', sellerSpecialNotes: '\r\n' })).toBe(true);
    expect(goodsGroupAfterSalesBlank({ phone: '', guide: '', sellerSpecialNotes: '특이사항' })).toBe(false);
    expect(goodsGroupAfterSalesBlank(filled)).toBe(false);
  });
});
