import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Exchange } from './Exchange';

const cardRewardGate = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/components/shell/CardRewardAvailability', () => ({
  useCardRewardsEnabled: () => cardRewardGate.enabled,
}));

afterEach(() => {
  cardRewardGate.enabled = true;
});

function render() {
  return renderToStaticMarkup(<Exchange />);
}

describe('Exchange 화면 용어', () => {
  /* 카드 C2C는 트레이드다. 구 명칭은 굿즈 클레임 유형(회수 후 재출고) 전용이라
   * 이 화면에 남으면 구매자가 굿즈 클레임 신청 화면으로 오해한다. */
  it('카드 C2C를 트레이드로 부른다', () => {
    const html = render();

    expect(html).toContain('카드 트레이드');
    expect(html).toContain('트레이드는 v2에서 열려요');
  });

  it('카드 C2C 의미의 "교환" 표기를 남기지 않는다', () => {
    expect(render()).not.toContain('교환');
  });

  it('v2 플레이스홀더임을 밝히고 미구현 기능을 단정하지 않는다', () => {
    const html = render();

    expect(html).toContain('V2 예정');
    expect(html).not.toContain('입찰');
    expect(html).not.toContain('경매');
    expect(html).not.toContain('수수료');
    expect(html).not.toContain('에스크로');
  });
});

describe('Exchange 카드 리워드 게이트', () => {
  it('카드 리워드가 열려 있으면 카드팩·바인더 동선을 함께 안내한다', () => {
    const html = render();

    expect(html).toContain('href="/packs"');
    expect(html).toContain('카드팩 열기');
    expect(html).toContain('href="/binder"');
    expect(html).toContain('내 바인더');
  });

  it('카드 리워드가 닫혀 있으면 카드팩 동선을 감춘다', () => {
    cardRewardGate.enabled = false;
    const html = render();

    expect(html).not.toContain('href="/packs"');
    expect(html).not.toContain('카드팩 열기');
    expect(html).toContain('href="/binder"');
  });
});
