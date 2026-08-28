'use client';

/* 온라인 팝업 개별 관(/ip/[id]) — R-03 §1.9 브랜드관 재현.
 * 풀블리드 배너(IP명·팔로우 하트+팬 수·설명·해시태그) + 굿즈 섹션(타입 칩 단일 축 필터) + 연결 밴드 3종.
 * 팔로우·알림 폼은 app/ip/actions.ts 계약(hidden ipId·intent·next·setBoth·autoFollow…)을 그대로 승계한다. */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { setIpNotificationPreferencesAction, toggleIpFollowAction } from '@/app/ip/actions';
import { EmptyState } from '@/components/wc/EmptyState';
import { ProductCard } from '@/components/wc/ProductCard';
import { SectionHeading } from '@/components/wc/SectionHeading';
import type { CatalogIpDetail } from '@/lib/catalog';
import { compactNumber } from '@/lib/format';
import { goodDetailHref } from '@/lib/goods-display';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import type { IpFollowState } from '@/lib/ip-follow';
import { ipEn } from '@/lib/ip-display';
import { hrefFor } from '@/lib/routes';

/** 타입 칩 단일 축의 리셋 값 — 굿즈 타입과 충돌하지 않는 표기. */
const ALL_TYPES = '전체';

/* 하트 원형 40×40 은 아이콘 단독 버튼이라(R-03 §1.9) 팔로우 상태 카피는 스크린리더 이름으로 승계한다. */
function FollowSubmit({ isFollowed }: { isFollowed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`wc-iphall__follow-heart${isFollowed ? ' is-followed' : ''}`}
      disabled={pending}
      type="submit"
    >
      <svg aria-hidden fill={isFollowed ? 'currentColor' : 'none'} height="21" viewBox="0 0 22 21" width="22">
        <path
          d="M11 19.2 2.8 11a5.7 5.7 0 0 1 0-8 5.6 5.6 0 0 1 7.9 0l.3.3.3-.3a5.6 5.6 0 0 1 7.9 0 5.7 5.7 0 0 1 0 8Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
      <span className="wc-sr-only">
        {pending ? '저장 중' : isFollowed ? '팬덤 가입됨 ✓' : '팬덤 가입 — 무료'}
      </span>
    </button>
  );
}

/* 팔로우 폼 계약(불변): hidden ipId·intent(follow|unfollow)·next.
 * 비로그인은 액션이 /login?next= 로 보내므로 클라이언트 게이트를 두지 않는다. */
function FollowForm({ followState, ipId }: { followState: IpFollowState; ipId: string }) {
  return (
    <form action={toggleIpFollowAction}>
      <input name="ipId" type="hidden" value={ipId} />
      <input name="intent" type="hidden" value={followState.isFollowed ? 'unfollow' : 'follow'} />
      <input name="next" type="hidden" value={`/ip/${ipId}`} />
      <FollowSubmit isFollowed={followState.isFollowed} />
    </form>
  );
}

function NotificationSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="wc-btn" disabled={pending} type="submit">
      {pending ? '저장 중' : label}
    </button>
  );
}

/* 미팔로우 상태의 원클릭 폼(불변): autoFollow·setBoth·notifyDrops·notifyEvents 전부 1로 고정 전송. */
function AutoFollowNotificationForm({ ipId }: { ipId: string }) {
  return (
    <form action={setIpNotificationPreferencesAction}>
      <input name="ipId" type="hidden" value={ipId} />
      <input name="next" type="hidden" value={`/ip/${ipId}`} />
      <input name="autoFollow" type="hidden" value="1" />
      <input name="setBoth" type="hidden" value="1" />
      <input name="notifyDrops" type="hidden" value="1" />
      <input name="notifyEvents" type="hidden" value="1" />
      <NotificationSubmit label="팔로우하고 알림 받기" />
    </form>
  );
}

function NotificationPreferenceFields({ followState }: { followState: IpFollowState }) {
  const { pending } = useFormStatus();
  return (
    <>
      <fieldset
        disabled={pending}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 12px', padding: 0, border: 0 }}
      >
        <legend className="wc-sr-only">IP 알림 종류</legend>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <input
            defaultChecked={followState.notifyDrops}
            name="notifyDrops"
            role="switch"
            type="checkbox"
            value="1"
          />
          <span>새 굿즈·드롭</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <input
            defaultChecked={followState.notifyEvents}
            name="notifyEvents"
            role="switch"
            type="checkbox"
            value="1"
          />
          <span>팝업·이벤트</span>
        </label>
      </fieldset>
      <NotificationSubmit label="알림 설정 저장" />
    </>
  );
}

/* 팔로우 상태의 알림 설정 폼(불변): hidden ipId·next·setBoth + notifyDrops·notifyEvents 체크박스. */
function NotificationPreferencesForm({ followState, ipId }: { followState: IpFollowState; ipId: string }) {
  return (
    <form action={setIpNotificationPreferencesAction} aria-label="IP 알림 설정">
      <input name="ipId" type="hidden" value={ipId} />
      <input name="next" type="hidden" value={`/ip/${ipId}`} />
      <input name="setBoth" type="hidden" value="1" />
      <NotificationPreferenceFields followState={followState} />
    </form>
  );
}

export function IpDetail({
  detail,
  followState,
  followError,
  notificationError,
  notificationSaved,
}: {
  detail: CatalogIpDetail;
  followState: IpFollowState;
  followError: boolean;
  notificationError: boolean;
  notificationSaved: boolean;
}) {
  const { ip, goods, cards } = detail;
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const types = useMemo(() => [...new Set(goods.map((good) => good.type))], [goods]);
  /* 타입 칩은 실존 타입에서만 파생되는 단일 축이라, 필터 결과가 0이 되는 경우는 없다. */
  const visibleGoods = typeFilter === ALL_TYPES
    ? goods
    : goods.filter((good) => good.type === typeFilter);
  const description = [ip.tagline, ip.synopsis].filter(Boolean).join(' ');

  return (
    <div className="wc-root wc-iphall">
      <section
        className="wc-iphall__banner"
        style={{ background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        <div className="wc-container">
          <h1 className="wc-iphall__name">{ip.title}</h1>
          <div className="wc-iphall__follow">
            <FollowForm followState={followState} ipId={ip.id} />
            <span className="wc-iphall__follow-count">
              <span className="wc-sr-only">팬 </span>
              {compactNumber(ip.fans)}
            </span>
          </div>
          {description ? <p className="wc-iphall__desc">{description}</p> : null}
          <ul className="wc-iphall__hashtags">
            <li>{`#${ipEn(ip)}`}</li>
            <li>{`#${ip.v.label}`}</li>
          </ul>
        </div>
      </section>

      {/* 알림 폼·저장 결과는 배너의 흰 글자 영역이 아니라 흰 지면에서 다룬다(체크박스 가독성). */}
      <div className="wc-container">
        <section
          aria-label="IP 알림"
          style={{ display: 'grid', gap: 12, maxWidth: 448, margin: '32px 0 0' }}
        >
          {followError ? (
            <p className="wc-iphall__notice is-error" role="alert">
              팔로우 상태를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
            </p>
          ) : null}
          {notificationError ? (
            <p className="wc-iphall__notice is-error" role="alert">
              알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
            </p>
          ) : null}
          {notificationSaved && !notificationError ? (
            <p aria-live="polite" className="wc-iphall__notice is-success" role="status">
              알림 설정을 저장했습니다.
            </p>
          ) : null}
          {followState.isFollowed
            ? <NotificationPreferencesForm followState={followState} ipId={ip.id} />
            : <AutoFollowNotificationForm ipId={ip.id} />}
        </section>
      </div>

      <section className="wc-iphall__goods">
        <div className="wc-container">
          <SectionHeading title={`${ip.title}의 굿즈`} />
          <div className="wc-collection__toolbar">
            <p aria-live="polite" className="wc-collection__count">
              전체 <strong>{visibleGoods.length}</strong>개 굿즈
            </p>
            <Link href={`${hrefFor('shop')}?ip=${ip.id}`}>굿즈샵에서 전체 보기</Link>
          </div>
          {types.length > 1 ? (
            <div
              aria-label="굿즈 타입 필터"
              role="group"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 20px' }}
            >
              {[ALL_TYPES, ...types].map((type) => (
                <button
                  key={type}
                  aria-pressed={typeFilter === type}
                  className={`wc-iphall__filter-chip${typeFilter === type ? ' is-active' : ''}`}
                  onClick={() => setTypeFilter(type)}
                  type="button"
                >
                  {type}
                </button>
              ))}
            </div>
          ) : null}
          {goods.length === 0 ? (
            <EmptyState description="새 굿즈가 입점하면 이 자리에 소개돼요." title="등록된 굿즈가 아직 없습니다" />
          ) : (
            <div className="wc-product-grid">
              {visibleGoods.map((good) => (
                <ProductCard
                  key={good.id}
                  badges={goodDisplayBadges(good)}
                  brand={ip.title}
                  compareAtPrice={good.compareAtPrice}
                  href={goodDetailHref(good.id)}
                  imageBackground={good.img}
                  name={good.name}
                  price={good.price}
                  soldOut={good.stock === 'soldout'}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="wc-container">
        <nav aria-label="이 IP의 다른 공간" className="wc-iphall__links">
          <Link href={hrefFor('binder')}>{`카드 도감 ${cards.length}종`}</Link>
          <Link href={hrefFor('events')}>오프라인 팝업·이벤트</Link>
          <Link href={`${hrefFor('community')}?ip=${ip.id}`}>팬덤 채널</Link>
        </nav>
      </div>
    </div>
  );
}
