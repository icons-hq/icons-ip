import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RestockCta, restockLoginPath, restockRequestKey, restockResultNotice } from './RestockCta';

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
    expect(html).toContain('</svg>재입고 알림 받기</button>');
    /* 굿즈 단위 신청의 버튼 이름에는 옵션이 없다. */
    expect(html).not.toContain(' 옵션 </span>');
  });

  /* 결과는 버튼 옆 상태 줄이 알린다. 처음에는 비어 있고 보조기기 전용이라 자리를 차지하지 않는다. */
  it('결과를 알릴 상태 줄(live region)을 버튼 옆에 비워 둔다', () => {
    const html = renderToStaticMarkup(<RestockCta goodId="g11" initialRequested={false} />);

    expect(html).toContain('</button><p aria-atomic="true" aria-live="polite" class="wc-sr-only" role="status"></p></div>');
  });

  /* 보이는 글자는 같고, 보조기기는 어느 옵션의 알림인지 버튼 이름으로 함께 읽는다(보이는 글자를 포함한 이름). */
  it('옵션 단위 신청은 버튼 이름에 옵션을 담는다', () => {
    const html = renderToStaticMarkup(<RestockCta goodId="g11" initialRequested={false} optionName="빨강" variantId={VARIANT} />);

    expect(html).toContain('<span class="wc-sr-only">빨강 옵션 </span>재입고 알림 받기</button>');
  });

  /* 잠금은 disabled 가 아니라 aria-disabled 다 — disabled 로 바꾸면 포커스를 가진 버튼이 포커스를 잃는다
     (구매 시트 안이면 다이얼로그 밖 body 로 빠진다). 모양은 비활성 버튼(.wc-btn.disabled)과 같다. */
  it('대기 중인 신청은 신청됨으로 잠기되 포커스를 잃지 않는다 — 되돌리는 토글이 아니다', () => {
    const html = renderToStaticMarkup(<RestockCta goodId="g11" initialRequested optionName="빨강" variantId={VARIANT} />);

    expect(html).toContain('<button aria-disabled="true" class="wc-btn primary disabled" type="button">');
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
    expect(html).toContain('재입고 알림 신청됨</button>');
  });

  it('미리보기에서는 누를 수 없다', () => {
    const html = renderToStaticMarkup(<RestockCta disabled goodId="g11" initialRequested={false} />);
    expect(html).toContain('<button class="wc-btn primary" disabled="" type="button">');
  });

  it('신청 결과를 상태 줄 문장으로 바꾸고, 좁은 표면은 실패를 짧은 버튼 글자로 보인다', () => {
    expect(restockResultNotice({ ok: true, status: 'pending' })).toEqual({ tone: 'success', text: '재입고 알림을 신청했어요.' });
    expect(restockResultNotice({ ok: false, error: 'auth_required' })).toBeNull();
    expect(restockResultNotice({ ok: false, error: 'invalid_request' })).toEqual({
      tone: 'error', text: '판매 상태가 바뀌었어요. 지금 상태를 확인해주세요.', label: '판매 상태가 바뀌었어요',
    });
    expect(restockResultNotice({ ok: false, error: 'account_suspended' })).toEqual({
      tone: 'error', text: '정지된 계정은 재입고 알림을 신청할 수 없어요.', label: '신청할 수 없는 계정이에요',
    });
    expect(restockResultNotice({ ok: false, error: 'unavailable' })).toEqual({
      tone: 'error', text: '재입고 알림을 신청하지 못했어요. 잠시 후 다시 시도해주세요.', label: '신청하지 못했어요 · 다시 시도',
    });
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
