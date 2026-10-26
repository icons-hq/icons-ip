import Link from 'next/link';

/*
 * 이메일 로그인 수단(email identity)이 없는 소셜 전용 계정이 /update-password에 왔을 때 폼 대신 보이는 안내.
 * 재설정 링크로 들어왔어도 이미 로그인된 상태라, 비밀번호를 만들지 않고 원래 가던 곳으로 보낸다.
 */
export function SocialAccountPasswordNotice({ next }: { next: string }) {
  return (
    <main className="wc-root wc-auth">
      <div className="wc-auth__panel">
        <p className="wc-auth__step-note">
          <Link href="/">ICONS</Link>
        </p>
        <h1 className="wc-auth__title wc-auth__title--sub">새 비밀번호 설정</h1>
        <p className="wc-auth__lede">
          SNS로 가입한 계정은 비밀번호를 설정할 수 없어요. 로그인할 때는 가입한 SNS 계정(Google·카카오·Apple)을 사용해주세요.
        </p>
        <p className="wc-auth__legal">
          <Link href={next}>계속하기</Link>
        </p>
      </div>
    </main>
  );
}
