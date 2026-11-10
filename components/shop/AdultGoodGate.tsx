import Link from 'next/link';

import { adultVerificationHref } from '@/lib/identity/adult-verification-routes';

/*
 * 19금 굿즈 상세의 성인 인증 안내(ADR-0024). 인증 전 방문자는 상품 이름·이미지·가격을
 * 보지 못하고 이 안내만 본다. 로그인 전이면 로그인부터, 로그인했으면 성인 인증으로 보내고
 * 인증이 끝나면 같은 상세로 돌아온다.
 */
export function AdultGoodGate({ goodId, signedIn }: { goodId: string; signedIn: boolean }) {
  const detailPath = `/shop/${encodeURIComponent(goodId)}`;
  return (
    <main className="wc-root wc-adult-gate">
      <div className="wc-container">
        <section aria-labelledby="adult-gate-title" className="wc-adult-gate__panel">
          <span aria-hidden className="wc-product-card__adult-mark">19</span>
          <h1 className="wc-adult-gate__title" id="adult-gate-title">19세 이상만 볼 수 있는 굿즈예요</h1>
          <p className="wc-adult-gate__body">
            청소년 보호법에 따라 휴대폰 본인확인으로 성인 인증을 마친 회원만 굿즈 정보를 보고 구매할 수 있어요.
          </p>
          <div className="wc-adult-gate__actions">
            {signedIn ? (
              <Link className="wc-btn primary" href={adultVerificationHref(detailPath)}>성인 인증하기</Link>
            ) : (
              <Link className="wc-btn primary" href={`/login?next=${encodeURIComponent(detailPath)}`}>로그인하고 성인 인증하기</Link>
            )}
            <Link className="wc-btn" href="/shop">굿즈샵으로</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
