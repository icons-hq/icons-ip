import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingAddress } from './OnboardingAddress';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/my/addresses/actions', () => ({ saveAddressBookEntryAction: vi.fn() }));

describe('OnboardingAddress', () => {
  it('인증 1칼럼 위 주소록 폼(첫 배송지 = 기본)과 건너뛰기 링크를 둔다', () => {
    const html = renderToStaticMarkup(<OnboardingAddress next="/checkout" />);

    expect(html).toContain('<main class="wc-root wc-auth">');
    expect(html).toContain('<h1 class="wc-auth__title">배송지를 등록해 둘까요?</h1>');
    expect(html).toContain('지금 건너뛰어도 가입은 끝났고');
    expect(html).toContain('id="onboarding-address-recipientName"');
    expect(html).toContain('id="onboarding-address-postalCode"');
    expect(html).toContain('첫 배송지는 기본 배송지가 돼요.');
    expect(html).toContain('배송지 등록하고 계속');
    expect(html).toMatch(/<a class="wc-btn wc-address-onboarding__skip" href="\/checkout">나중에 할게요<\/a>/);
    /* 건너뛰기 외에 닫기·취소 버튼을 따로 두지 않는다. */
    expect(html).not.toContain('>취소</button>');
  });
});
