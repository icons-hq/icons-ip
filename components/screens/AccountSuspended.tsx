import { signOutAction } from '@/app/login/actions';

export function AccountSuspended() {
  return (
    <main
      style={{
        alignItems: 'center',
        display: 'flex',
        justifyContent: 'center',
        minHeight: '100svh',
        padding: 24,
      }}
    >
      <section
        aria-labelledby="account-suspended-title"
        className="card"
        style={{ maxWidth: 520, padding: 'clamp(28px, 5vw, 44px)', textAlign: 'center', width: '100%' }}
      >
        <span className="eyebrow">ACCOUNT NOTICE</span>
        <h1 id="account-suspended-title" className="h-lg" style={{ marginTop: 14 }}>
          계정 이용이 제한되어 있어요
        </h1>
        <p style={{ color: 'var(--dim)', lineHeight: 1.7, margin: '16px auto 0', maxWidth: 400 }}>
          현재 이 계정으로 새 콘텐츠 작성, 주문, 예매, 카드팩 개봉과 게임 플레이를 이용할 수 없습니다.
          도움이 필요하면 고객지원 채널로 문의해주세요.
        </p>
        <form action={signOutAction} style={{ marginTop: 28 }}>
          <button className="btn btn-ghost" style={{ minHeight: 44 }} type="submit">로그아웃</button>
        </form>
      </section>
    </main>
  );
}
