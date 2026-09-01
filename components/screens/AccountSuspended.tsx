import { signOutAction } from '@/app/login/actions';
import { WcButton } from '@/components/wc/WcButton';

export function AccountSuspended() {
  return (
    <main className="wc-root wc-auth">
      <section aria-labelledby="account-suspended-title" className="wc-auth__panel">
        <h1 className="wc-auth__title wc-auth__title--sub" id="account-suspended-title">
          계정 이용이 제한되어 있어요
        </h1>
        <p className="wc-auth__lede">
          현재 이 계정으로 새 콘텐츠 작성, 주문, 예매, 카드팩 개봉과 게임 플레이를 이용할 수 없습니다.
          도움이 필요하면 고객지원 채널로 문의해주세요.
        </p>
        <form action={signOutAction} className="wc-auth__form">
          <WcButton type="submit">로그아웃</WcButton>
        </form>
      </section>
    </main>
  );
}
