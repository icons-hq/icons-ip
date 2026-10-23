import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RestockCta, restockLoginPath, restockRequestKey } from './RestockCta';

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/g11',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/shop/actions', () => ({
  requestRestockAlertAction: vi.fn(),
  requestVariantRestockAlertAction: vi.fn(),
}));

const VARIANT = '00000000-0000-4000-8000-000000056711';

describe('RestockCta (PD-11)', () => {
  it('굿즈 단위 신청은 벨 아이콘과 풀폭 잉크 버튼 하나다', () => {
    const html = renderToStaticMarkup(<RestockCta goodId="g11" initialRequested={false} />);

    expect(html).toMatch(/^<div class="wc-restock-cta"><button class="wc-btn primary" type="button"><svg aria-hidden="true"/);
    expect(html).toContain('재입고 알림 받기</button>');
    expect(html).not.toContain('wc-sr-only');
  });

  /* 보이는 글자는 같고, 보조기기는 어느 옵션의 알림인지 버튼 이름으로 함께 읽는다(보이는 글자를 포함한 이름). */
  it('옵션 단위 신청은 버튼 이름에 옵션을 담는다', () => {
    const html = renderToStaticMarkup(<RestockCta goodId="g11" initialRequested={false} optionName="빨강" variantId={VARIANT} />);

    expect(html).toContain('<span class="wc-sr-only">빨강 옵션 </span>재입고 알림 받기</button>');
  });

  it('대기 중인 신청은 신청됨으로 잠긴다 — 되돌리는 토글이 아니다', () => {
    const html = renderToStaticMarkup(<RestockCta goodId="g11" initialRequested optionName="빨강" variantId={VARIANT} />);

    expect(html).toContain('<button class="wc-btn primary" disabled="" type="button">');
    expect(html).toContain('재입고 알림 신청됨</button>');
  });

  it('미리보기에서는 누를 수 없다', () => {
    expect(renderToStaticMarkup(<RestockCta disabled goodId="g11" initialRequested={false} />)).toContain('disabled=""');
  });

  /* 같은 버튼 인스턴스가 옵션을 바꿔 가며 쓰인다 — 한 옵션의 낙관 신청 표시가 다른 옵션으로 새지 않는다. */
  it('낙관 표시 키는 옵션마다 다르고 굿즈 단위 신청과도 다르다', () => {
    expect(restockRequestKey(VARIANT)).not.toBe(restockRequestKey('00000000-0000-4000-8000-000000056712'));
    expect(restockRequestKey(VARIANT)).not.toBe(restockRequestKey(null));
    expect(restockRequestKey(undefined)).toBe(restockRequestKey(null));
  });

  it('비로그인 옵션 신청은 그 옵션을 고른 상세로 돌아오는 로그인 주소다', () => {
    expect(restockLoginPath('/shop/g11', VARIANT)).toBe(`/login?next=${encodeURIComponent(`/shop/g11?variant=${VARIANT}`)}`);
    expect(restockLoginPath('/shop/g11', null)).toBe('/login?next=%2Fshop%2Fg11');
  });
});
