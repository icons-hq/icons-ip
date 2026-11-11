'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import { toggleIpFollowAction } from '@/app/ip/actions';
import { WishlistCartButton } from '@/components/mypage/WishlistCartButton';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { useStorePresentation } from '@/components/shell/StorePresentationProvider';
import { AddToCartResultDialog, type AddToCartResultItem } from '@/components/shop/AddToCartResultDialog';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { ListingWishHeart } from '@/components/shop/ListingWishHeart';
import { confirmedWish, subscribeWishConfirmations } from '@/components/shop/wishlist-heart-store';
import { EmptyState } from '@/components/wc/EmptyState';
import { MypageShell } from '@/components/wc/MypageShell';
import { ProductCard } from '@/components/wc/ProductCard';
import { WcButton } from '@/components/wc/WcButton';
import type { Ip } from '@/lib/data';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { ipEn } from '@/lib/ip-display';
import { hrefFor } from '@/lib/routes';
import { wishlistTabHref, type WishlistLine, type WishlistTab } from '@/lib/wishlist-lines';

/*
 * 위시리스트 (#326 S4 → LFS 패리티 2차 L6 · MY-06·MY-07, 10/14 S14·S15 — 11 §5.6).
 *
 * 탭 2개: 굿즈(위시리스트는 굿즈만 — CONTEXT.md) / 팔로우한 IP(레퍼런스 BRAND 탭의 우리 대응, IP 는 위시가 아니라 팔로우).
 * 탭은 URL(?tab=ip)이 정한다 — 대시보드의 '더보기'가 바로 IP 탭으로 들어오고 새로고침해도 그 탭이다.
 *
 * 굿즈 탭은 상품 카드 5열 그리드다. 이미지 우상단의 목록 하트(L4 공용 부품)가 해제 버튼이고, 카드 아래
 * 수량 없는 '장바구니 담기'가 `listing.showCart` 와 무관하게 선다(S14). 담기가 확정되면 L1 의 담기 결과 모달이 뜬다.
 * 하트를 풀어도 카드는 이 화면에 남는다(새로고침 전까지) — 실수로 푼 하트를 바로 되돌릴 수 있고, 총 개수는
 * 서버가 확인한 해제만큼 줄어든다. 카탈로그에서 사라진 굿즈는 '판매 종료' 카드로 남겨 해제 수단을 둔다.
 */

export interface WishlistProps {
  viewerId: string;
  tab: WishlistTab;
  lines: WishlistLine[];
  /** 공개 중인 팔로우한 IP(최근 팔로우 먼저). 못 읽었으면 null. */
  followedIps: Ip[] | null;
  /** 팔로우 해제 저장 실패로 돌아왔는지(?follow_error=1, IP 관 폼 계약). IP 탭에서만 안내한다. */
  followError?: boolean;
}

function shopCta() {
  return (
    <WcButton href="/shop" variant="primary">
      굿즈샵 둘러보기
    </WcButton>
  );
}

/* 이 세션에서 서버가 해제를 확인한 줄만 뺀 개수. 서버 렌더와 첫 페인트는 서버 값 그대로다. */
function useLiveWishCount(viewerId: string, lines: readonly WishlistLine[]): number {
  return useSyncExternalStore(
    subscribeWishConfirmations,
    () => lines.filter((line) => confirmedWish(viewerId, line.goodId) !== false).length,
    () => lines.length,
  );
}

function WishCard({ line, onAdded, viewerId }: { line: WishlistLine; onAdded: (items: AddToCartResultItem[]) => void; viewerId: string }) {
  const { brand, good, goodId } = line;
  const { listing } = useStorePresentation();

  if (!good) {
    /* 같은 줄의 ProductCard(listSurface="standard")처럼 스토어 목록 이미지 비율을 따른다 — portrait 설정에서
       판매 종료 카드만 1:1 로 남아 이름 줄이 어긋나지 않게(DESIGN '상품 카드 anatomy 통일'). */
    return (
      <article className="wc-product-card wc-wish__ended" data-list-shape={listing.imageShape}>
        <div className="wc-product-card__media">
          <span aria-hidden className="wc-product-card__image" />
          <div className="wc-product-card__action">
            <ListingWishHeart goodId={goodId} initialWished label="판매 종료 굿즈" viewerId={viewerId} />
          </div>
        </div>
        <div className="wc-product-card__info">
          <h3 className="wc-product-card__name">판매 종료</h3>
          <p className="wc-wish__state">더 이상 판매하지 않는 굿즈예요.</p>
        </div>
      </article>
    );
  }

  /* 성인 인증 전 19금 굿즈는 가림 카드로만 보인다(ADR-0024). 찜 해제는 되지만 담기는 두지 않는다 —
     DB도 인증 전 담기를 거절한다. */
  if (good.masked) {
    return (
      <ProductCard
        action={<ListingWishHeart goodId={good.id} initialWished label={good.name} viewerId={viewerId} />}
        brand={brand}
        href={`/shop/${good.id}`}
        listSurface="standard"
        masked
        name={good.name}
        price={good.price}
      />
    );
  }

  return (
    <>
      <ProductCard
        action={<ListingWishHeart goodId={good.id} initialWished label={good.name} viewerId={viewerId} />}
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
      <WishlistCartButton good={good} onAdded={onAdded} />
    </>
  );
}

function UnfollowSubmit({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button aria-label={`${name} 팔로우 해제`} className="wc-wish__unfollow" disabled={pending} type="submit">
      {pending ? '해제 중' : '팔로우 해제'}
    </button>
  );
}

/* 팔로우 해제는 IP 관과 같은 폼 계약(app/ip/actions.ts — hidden ipId·intent·next)을 쓴다. 저장 뒤 이 탭으로 돌아온다. */
function FollowedIpTile({ ip }: { ip: Ip }) {
  const name = ipEn(ip);
  return (
    <>
      <Link className="wc-wish__ip" href={hrefFor('ip', ip)}>
        <span aria-hidden className="wc-wish__ip-art" style={{ background: ip.bg, backgroundPosition: 'center', backgroundSize: 'cover' }} />
        <span className="wc-wish__ip-name">{name}</span>
        {name !== ip.title ? <span className="wc-wish__ip-sub">{ip.title}</span> : null}
      </Link>
      <form action={toggleIpFollowAction}>
        <input name="ipId" type="hidden" value={ip.id} />
        <input name="intent" type="hidden" value="unfollow" />
        <input name="next" type="hidden" value={wishlistTabHref('ip')} />
        <UnfollowSubmit name={name} />
      </form>
    </>
  );
}

export function Wishlist({ followError = false, followedIps, lines, tab, viewerId }: WishlistProps) {
  const [resultItems, setResultItems] = useState<AddToCartResultItem[] | null>(null);
  const wishCount = useLiveWishCount(viewerId, lines);
  const goods = lines.flatMap((line) => (line.good ? [line.good] : []));

  return (
    <MypageShell active="/my/wishlist">
      <GoodsSalePeriodRefresh goods={goods} />
      <section aria-labelledby="wishlist-heading" className="wc-wish">
        <div className="wc-mypage__headbar">
          <h1 className="wc-mypage__headbar-title" id="wishlist-heading">위시리스트</h1>
        </div>
        <nav aria-label="위시리스트 종류" className="wc-wish__tabs">
          <Link aria-current={tab === 'goods' ? 'page' : undefined} href={wishlistTabHref('goods')}>
            굿즈 ({wishCount.toLocaleString('ko-KR')})
          </Link>
          <Link aria-current={tab === 'ip' ? 'page' : undefined} href={wishlistTabHref('ip')}>
            팔로우한 IP{followedIps ? ` (${followedIps.length.toLocaleString('ko-KR')})` : ''}
          </Link>
        </nav>

        {tab === 'ip' && followError ? (
          <p className="wc-wish__alert" role="alert">팔로우 해제를 저장하지 못했어요. 잠시 후 다시 시도해주세요.</p>
        ) : null}

        {tab === 'goods' ? (
          lines.length ? (
            <>
              <p className="wc-wish__total" aria-live="polite">총 <strong>{wishCount.toLocaleString('ko-KR')}</strong>개</p>
              <ul className="wc-wish__grid">
                {lines.map((line) => (
                  <li key={line.goodId}>
                    <WishCard line={line} onAdded={setResultItems} viewerId={viewerId} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              action={shopCta()}
              description="마음에 드는 굿즈를 하트로 담아 두면 여기에 모여요."
              title="아직 찜한 굿즈가 없어요"
            />
          )
        ) : followedIps === null ? (
          <p className="wc-wish__unavailable" role="status">팔로우한 IP를 확인하지 못했어요. 잠시 후 다시 열어주세요.</p>
        ) : followedIps.length ? (
          <>
            <p className="wc-wish__total">총 <strong>{followedIps.length.toLocaleString('ko-KR')}</strong>개</p>
            <ul className="wc-wish__ips">
              {followedIps.map((ip) => (
                <li key={ip.id}>
                  <FollowedIpTile ip={ip} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            action={<WcButton href={hrefFor('iphub')} variant="primary">온라인 팝업 둘러보기</WcButton>}
            description="좋아하는 IP를 팔로우하면 새 굿즈와 소식을 여기서 모아 볼 수 있어요."
            title="아직 팔로우한 IP가 없어요"
          />
        )}
      </section>
      {resultItems ? (
        <OverlayPortal>
          <AddToCartResultDialog items={resultItems} onClose={() => setResultItems(null)} open />
        </OverlayPortal>
      ) : null}
    </MypageShell>
  );
}
