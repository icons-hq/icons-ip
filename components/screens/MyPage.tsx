'use client';

import Link from 'next/link';
import { signOutAction } from '@/app/login/actions';
import { MypageRecentGoods } from '@/components/mypage/MypageRecentGoods';
import { MypageSectionHead } from '@/components/mypage/MypageSectionHead';
import { useCart } from '@/components/shell/CartProvider';
import { Icon } from '@/components/ui/Icon';
import { MypageShell, type MypageLoyaltySummary } from '@/components/wc/MypageShell';
import { ProductCard } from '@/components/wc/ProductCard';
import { krw } from '@/lib/format';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { ipEn } from '@/lib/ip-display';
import { DASHBOARD_ORDER_STEPS, type MypageDashboard } from '@/lib/mypage-dashboard';
import { formatOrderDate, orderStatusMeta } from '@/lib/orders';
import { hrefFor } from '@/lib/routes';

interface MyPageProps {
  avatarInitial: string;
  avatarUrl: string | null;
  nickname: string;
  loyalty: MypageLoyaltySummary | null;
  /** 서버가 판정한 로그인 회원 ID — 최근 본 굿즈 기록(계정별 저장소)을 고르는 열쇠다. */
  viewerId: string;
  dashboard: MypageDashboard;
  /** 상세 경험 `interests` 스위치(LD-16). 꺼져 있으면 최근 본 굿즈 블록을 그리지 않는다. */
  recentGoodsEnabled: boolean;
}

/*
 * /my 대시보드 (LFS 패리티 2차 L6 · MY-02·MY-03·MY-04·MY-12, 10/14 S16).
 *
 * 데스크톱: 프로필 스트립 → [좌 메뉴 200 | 블록 920]. 블록 순서는 최근 주문(상태별 건수) → 쿠폰·적립금 →
 * 위시리스트 → 팔로우한 IP → 최근 본 굿즈(11 §5.2 ①~④ + S16 의 쿠폰·적립금 요약).
 * 모바일(LD-1a): 웰컴 행 → 바로가기 4칸(카운트 배지) → 세로 메뉴(그룹 사이 10px 밴드) → 같은 블록 → 로그아웃.
 * 같은 데이터, 다른 배치다 — 배치는 CSS 가 가르고 마크업 순서는 모바일 읽기 순서를 따른다.
 * 이메일·전화 같은 계정 식별 정보는 새로 싣지 않는다(프로필 스트립 범위 그대로).
 */

const COUNT_BADGE_MAX = 99;

function countBadge(count: number) {
  return count > COUNT_BADGE_MAX ? `${COUNT_BADGE_MAX}+` : String(count);
}

function TruckGlyph() {
  return (
    <svg aria-hidden fill="none" height="30" viewBox="0 0 34 30" width="34">
      <path d="M3 7h17v13H3zM20 11h6l4 5v4h-10z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <circle cx="9" cy="22" fill="var(--wc-surface)" r="2.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="25" cy="22" fill="var(--wc-surface)" r="2.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function TicketGlyph() {
  return (
    <svg aria-hidden fill="none" height="30" viewBox="0 0 34 30" width="34">
      <path d="M4 8h26v4.5a2.5 2.5 0 0 0 0 5V22H4v-4.5a2.5 2.5 0 0 0 0-5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M21 8v14" stroke="currentColor" strokeDasharray="2 2" strokeWidth="1.5" />
    </svg>
  );
}

/* 모바일 바로가기 4칸(11 §5.2 모바일) — 장바구니·위시는 카운트 배지(카트 수량 뱃지와 같은 비텍스트 액센트, 숫자는 접근 이름에). */
function MypageShortcuts({ wishCount }: { wishCount: number | null }) {
  const cart = useCart();
  const cartCount = cart.ready ? cart.count : 0;
  return (
    <nav aria-label="마이페이지 바로가기" className="wc-mydash__shortcuts">
      <ul>
        <li>
          <Link href={hrefFor('cart')}>
            <span className="wc-mydash__shortcut-icon">
              <Icon name="bag" size={30} stroke={1.5} />
              {cartCount > 0 ? <span aria-hidden className="wc-mydash__badge">{countBadge(cartCount)}</span> : null}
            </span>
            장바구니
            {cartCount > 0 ? <span className="wc-sr-only"> {cartCount}개</span> : null}
          </Link>
        </li>
        <li>
          <Link href={hrefFor('orders')}>
            <span className="wc-mydash__shortcut-icon"><TruckGlyph /></span>
            주문/배송
          </Link>
        </li>
        <li>
          <Link href="/my/coupons">
            <span className="wc-mydash__shortcut-icon"><TicketGlyph /></span>
            쿠폰
          </Link>
        </li>
        <li>
          <Link href={hrefFor('wish')}>
            <span className="wc-mydash__shortcut-icon">
              <Icon name="heart" size={30} stroke={1.5} />
              {wishCount ? <span aria-hidden className="wc-mydash__badge">{countBadge(wishCount)}</span> : null}
            </span>
            위시
            {wishCount ? <span className="wc-sr-only"> {wishCount}개</span> : null}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/* 모바일 로그아웃(343×50) — 데스크톱은 유틸바의 로그아웃이 같은 일을 한다. 셸의 로그아웃 폼과 같은 계약(카트·하트 정리 후 서버 로그아웃). */
function MypageSignOut() {
  const { resetForSignOut } = useCart();
  return (
    <form action={signOutAction} className="wc-mydash__signout" onSubmit={resetForSignOut}>
      <button className="wc-mydash__signout-button" type="submit">로그아웃</button>
    </form>
  );
}

function Unavailable({ message }: { message: string }) {
  return <p className="wc-mydash__empty" role="status">{message} 잠시 후 다시 열어주세요.</p>;
}

function OrdersBlock({ orders }: { orders: MypageDashboard['orders'] }) {
  return (
    <section aria-labelledby="mydash-orders" className="wc-mydash__section">
      <MypageSectionHead href={hrefFor('orders')} id="mydash-orders" title="최근 주문" />
      {orders === null ? (
        <Unavailable message="주문 내역을 확인하지 못했어요." />
      ) : (
        <>
          <ol aria-label="주문 상태별 건수" className="wc-mydash__steps">
            {DASHBOARD_ORDER_STEPS.map((step) => (
              <li key={step}>
                <span className="wc-mydash__step-label">{orderStatusMeta(step).label}</span>
                <strong className="wc-mydash__step-count">
                  {orders.counts[step].toLocaleString('ko-KR')}
                  <span className="wc-sr-only">건</span>
                </strong>
              </li>
            ))}
          </ol>
          {orders.recent.length ? (
            <ul className="wc-mydash__orders">
              {orders.recent.map((order) => (
                <li key={order.id}>
                  <Link className="wc-mydash__order" href={`/orders/${order.id}`}>
                    <time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time>
                    <span className="wc-mydash__order-name">{order.itemLabel}</span>
                    <span className="wc-mydash__order-status">{orderStatusMeta(order.status).label}</span>
                    <strong className="wc-mydash__order-total">{krw(order.total)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wc-mydash__empty">최근 주문이 없어요.</p>
          )}
        </>
      )}
    </section>
  );
}

function BenefitsBlock({ coupons, storeCredit }: Pick<MypageDashboard, 'coupons' | 'storeCredit'>) {
  return (
    <section aria-labelledby="mydash-benefits" className="wc-mydash__section">
      <MypageSectionHead id="mydash-benefits" title="쿠폰·적립금" />
      <ul className="wc-mydash__benefits">
        <li>
          <Link className="wc-mydash__benefit" href="/my/coupons">
            <span className="wc-mydash__benefit-label">사용 가능한 쿠폰</span>
            <strong className="wc-mydash__benefit-value">{coupons ? `${coupons.usable.toLocaleString('ko-KR')}장` : '확인하지 못했어요'}</strong>
            <span aria-hidden className="wc-mydash__benefit-arrow"><Icon name="chevronRight" size={18} /></span>
          </Link>
        </li>
        <li>
          <Link className="wc-mydash__benefit" href="/my/store-credits">
            <span className="wc-mydash__benefit-label">적립금</span>
            <strong className="wc-mydash__benefit-value">{storeCredit ? krw(storeCredit.available) : '확인하지 못했어요'}</strong>
            <span aria-hidden className="wc-mydash__benefit-arrow"><Icon name="chevronRight" size={18} /></span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

function WishBlock({ wishlist }: { wishlist: MypageDashboard['wishlist'] }) {
  return (
    <section aria-labelledby="mydash-wish" className="wc-mydash__section">
      <MypageSectionHead count={wishlist?.count} href={hrefFor('wish')} id="mydash-wish" title="위시리스트" />
      {wishlist === null ? (
        <Unavailable message="위시리스트를 확인하지 못했어요." />
      ) : wishlist.goods.length ? (
        <ul className="wc-mydash__shelf">
          {wishlist.goods.map(({ brand, good }) => (
            <li key={good.id}>
              <ProductCard
                badges={goodDisplayBadges(good)}
                brand={brand}
                compareAtPrice={good.compareAtPrice}
                href={`/shop/${good.id}`}
                imageBackground={good.img}
                listSurface="standard"
                listingAppearance={good.listingAppearance}
                name={good.name}
                price={good.price}
                priceMax={good.priceMax}
                salePeriod={good.salePeriod}
                showDiscountRate={good.showDiscountRate}
                soldOut={good.stock === 'soldout' || good.stockQty <= 0}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="wc-mydash__empty">
          {wishlist.count ? '판매를 마친 굿즈만 남아 있어요. 위시리스트에서 정리할 수 있어요.' : '아직 찜한 굿즈가 없어요.'}
        </p>
      )}
    </section>
  );
}

function FollowsBlock({ follows }: { follows: MypageDashboard['follows'] }) {
  return (
    <section aria-labelledby="mydash-follows" className="wc-mydash__section">
      <MypageSectionHead count={follows?.count} href={`${hrefFor('wish')}?tab=ip`} id="mydash-follows" title="팔로우한 IP" />
      {follows === null ? (
        <Unavailable message="팔로우한 IP를 확인하지 못했어요." />
      ) : follows.ips.length ? (
        <ul className="wc-mydash__ips">
          {follows.ips.map((ip) => (
            <li key={ip.id}>
              <Link className="wc-mydash__ip" href={hrefFor('ip', ip)}>
                <span aria-hidden className="wc-mydash__ip-art" style={{ background: ip.bg, backgroundPosition: 'center', backgroundSize: 'cover' }} />
                <span className="wc-mydash__ip-name">{ipEn(ip)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wc-mydash__empty">아직 팔로우한 IP가 없어요.</p>
      )}
    </section>
  );
}

export function MyPage({ avatarInitial, avatarUrl, dashboard, loyalty, nickname, recentGoodsEnabled, viewerId }: MyPageProps) {
  const wishCount = dashboard.wishlist?.count ?? null;

  return (
    <MypageShell
      active={hrefFor('my')}
      dashboard
      heading="마이페이지"
      lead={<MypageShortcuts wishCount={wishCount} />}
      profile={{ avatarInitial, avatarUrl, loyalty, nickname, wishCount }}
      tail={<MypageSignOut />}
    >
      <div className="wc-mydash">
        <OrdersBlock orders={dashboard.orders} />
        <BenefitsBlock coupons={dashboard.coupons} storeCredit={dashboard.storeCredit} />
        <WishBlock wishlist={dashboard.wishlist} />
        <FollowsBlock follows={dashboard.follows} />
        <MypageRecentGoods enabled={recentGoodsEnabled} viewerId={viewerId} />
      </div>
    </MypageShell>
  );
}
