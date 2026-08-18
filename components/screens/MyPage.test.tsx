import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyPage } from './MyPage';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => <span aria-hidden /> }));
const cardRewardGate = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/components/shell/CardRewardAvailability', () => ({
  useCardRewardsEnabled: () => cardRewardGate.enabled,
}));

afterEach(() => {
  cardRewardGate.enabled = true;
});

function render(overrides: Partial<React.ComponentProps<typeof MyPage>> = {}) {
  return renderToStaticMarkup(
    <MyPage
      avatarInitial="아"
      avatarUrl="https://signed.example/avatar.png"
      nickname="아이콘즈 팬"
      {...overrides}
    />,
  );
}

describe('MyPage', () => {
  it('hides the card-pack destination while card rewards are disabled', () => {
    cardRewardGate.enabled = false;
    const html = render();

    expect(html).not.toContain('href="/packs"');
    expect(html).not.toContain('>카드팩</');
    expect(html.match(/class="my-destination card"/g)).toHaveLength(6);
  });

  it('renders the private profile summary without account identifiers', () => {
    const html = render();

    expect(html).toContain('<main');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('>마이</h1>');
    expect(html).toContain('아이콘즈 팬');
    expect(html).toContain('src="https://signed.example/avatar.png"');
    expect(html).toContain('alt=""');
    expect(html).not.toContain('@');
  });

  it('uses the server-computed initial when no avatar URL is available', () => {
    const html = render({ avatarInitial: '👩‍🎤', avatarUrl: null });

    expect(html).toContain('>👩‍🎤</span>');
    expect(html).not.toContain('<img');
  });

  it('provides one semantic menu link for every implemented destination', () => {
    const html = render();

    expect(html).toContain('aria-label="마이페이지 메뉴"');
    expect(html).toContain('<ul');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>SHOP<\/span>/);

    for (const [href, label] of [
      ['/orders', '주문 내역'],
      ['/tickets', '내 티켓'],
      ['/binder', '바인더'],
      ['/packs', '카드팩'],
      ['/notifications', '알림함'],
      ['/my/inquiries', '1:1 문의'],
      ['/settings', '설정'],
    ]) {
      expect(html.match(new RegExp(`href="${href}"`, 'g'))).toHaveLength(1);
      expect(html).toContain(label);
    }

    expect(html).not.toContain('준비중');
    expect(html).not.toContain('<button');
    expect(html.match(/class="my-destination card"/g)).toHaveLength(7);
  });
});
