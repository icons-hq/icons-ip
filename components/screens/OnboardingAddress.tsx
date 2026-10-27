'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AddressBookForm } from '@/components/address-book/AddressBookForm';

/*
 * 온보딩 직후 배송지 등록 안내(LFS 패리티 2차 L7 · 10/14 S3). 인증 화면과 같은 1칼럼(flat-auth-form) 위에
 * 주소록 폼을 그대로 쓴다. 첫 배송지라 기본 배송지가 된다. 저장하거나 '나중에 할게요'를 누르면 원래 가려던
 * 곳(next)으로 간다 — 건너뛰어도 가입은 끝났고 주문서에서 배송지를 입력할 수 있다.
 */
export function OnboardingAddress({ next }: { next: string }) {
  const router = useRouter();

  return (
    <main className="wc-root wc-auth">
      <div className="wc-auth__panel wc-address-onboarding">
        <p className="wc-auth__step-note">선택 단계</p>
        <h1 className="wc-auth__title">배송지를 등록해 둘까요?</h1>
        <p className="wc-address-onboarding__lede">
          등록한 배송지는 주문서에 기본 배송지로 바로 불러와요. 지금 건너뛰어도 가입은 끝났고, 주문할 때 입력하거나
          마이페이지의 배송지 관리에서 언제든 추가할 수 있어요.
        </p>
        <AddressBookForm
          firstEntry
          idPrefix="onboarding-address"
          onSaved={() => router.replace(next)}
          submitLabel="배송지 등록하고 계속"
        />
        <Link className="wc-btn wc-address-onboarding__skip" href={next} replace>
          나중에 할게요
        </Link>
      </div>
    </main>
  );
}
