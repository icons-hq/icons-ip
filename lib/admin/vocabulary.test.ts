import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_VOCABULARY, adminGoodsCopy, adminGoodsNotice } from './vocabulary';
import { ADMIN_SCREENS } from './navigation';

describe('운영 콘솔 어휘', () => {
  it('실물 라벨과 확정 상태를 한 표에서 정의한다', () => {
    expect(ADMIN_VOCABULARY).toMatchObject({ goods: '상품', goodsCode: '상품코드',
      noticeInfo: '상품정보제공고시', claims: '취소·반품·교환 관리',
      confirmed: '발주확인', settled: '거래확정' });
    expect(ADMIN_SCREENS.find((screen) => screen.id === 'goods')?.label).toBe(ADMIN_VOCABULARY.goods);
    expect(ADMIN_SCREENS.find((screen) => screen.id === 'notice-presets')?.label).toBe(`${ADMIN_VOCABULARY.noticeInfo} 프리셋`);
  });
  it('기존 정적 안내의 조사와 공개 화면 고유 이름을 보존한다', () => {
    expect(adminGoodsCopy('굿즈가 없으면 굿즈를 등록합니다. 굿즈 코드를 확인하고 고시정보를 입력합니다.'))
      .toBe('상품이 없으면 상품을 등록합니다. 상품코드를 확인하고 상품정보제공고시를 입력합니다.');
    expect(adminGoodsCopy('굿즈샵과 굿즈 마켓에서 굿즈를 확인합니다.'))
      .toBe('굿즈샵과 굿즈 마켓에서 상품을 확인합니다.');
    expect(adminGoodsCopy('카드·카드팩·티켓을 등록합니다.')).toBe('카드·카드팩·티켓을 등록합니다.');
  });
  it('카드·카드팩·티켓 화면을 상품이라고 부르지 않는다', () => {
    for (const screen of ADMIN_SCREENS.filter((entry) => ['cards','pools','grants','policies','ticket-types','check-in'].includes(entry.id))) {
      expect(screen.label).not.toContain(ADMIN_VOCABULARY.goods);
    }
    for (const file of [
      'components/admin/sections/CardSection.tsx', 'components/admin/sections/CardPoolSection.tsx',
      'components/admin/sections/RewardPolicySection.tsx',
      'components/admin/screens/TicketTypeScreen.tsx',
      'lib/admin/guide/topics/cards-games.ts', 'lib/admin/guide/topics/events-tickets.ts',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/상품|adminGoodsCopy|ADMIN_VOCABULARY\.goods/);
    }
  });
  it('오류 안내만 바꾸고 복구할 운영자 입력은 수정하지 않는다', () => {
    const state = { message: '굿즈를 저장했습니다.', errors: { noticeMaker: '고시정보 필수 항목입니다.' }, values: { name: '나의 굿즈' } };
    const result = adminGoodsNotice(state);
    expect(result.message).toBe('상품을 저장했습니다.');
    expect(result.errors.noticeMaker).toBe('상품정보제공고시 필수 항목입니다.');
    expect(result.values).toBe(state.values);
    expect(result.values.name).toBe('나의 굿즈');
  });
});
