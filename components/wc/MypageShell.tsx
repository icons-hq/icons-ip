'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCardRewardsEnabled } from '@/components/shell/CardRewardAvailability';
import { useSubscriptionMenuAvailable } from '@/components/subscriptions/SubscriptionMenuAvailability';
import { useGiftMenuAvailable } from '@/components/gifts/GiftMenuAvailability';
import { useAdultVerificationMenuAvailable } from '@/components/identity/AdultVerificationMenuAvailability';
import type { LoyaltyGrade } from '@/lib/loyalty';

/*
 * 마이페이지 셸 (R-05 §4, S6 #328 → LFS 패리티 2차 L6 · MY-01~04, 10/14 S16).
 *
 * 그룹 3개(쇼핑 정보/계정 설정/고객센터)는 레퍼런스의 문법이고 항목은 우리 도메인이다.
 * 데스크톱은 주문·티켓 목록·상세를 포함한 모든 하위 화면이 좌 200px aside 로 같은 메뉴를 오간다(11 §5.1 —
 * aside 200 + 거터 60 + 콘텐츠 920). 모바일 하위 화면은 aside 를 숨기고 콘텐츠를 우선하며, /my 대시보드만
 * 같은 메뉴를 세로 메뉴(그룹 사이 10px 밴드)로 펼친다(LD-1a). 그래서 메뉴 목록은 이 파일 한 곳에만 있다.
 */

export interface MypageMenuItem {
  href: string;
  label: string;
  /** 목적지 한 줄 설명 — 구 /my 메뉴 허브의 문구다. 대시보드 전환(L6) 뒤로 셸은 그리지 않는다. */
  description: string;
  /** 카드 리워드 게이트(DB 소유)가 닫혀 있으면 숨긴다 — 현 /packs 노출 규칙과 동일.
      성인 인증은 시작할 수 있거나 이미 인증 기록이 있는 회원에게만 보인다. */
  gated?: 'card-rewards' | 'gifts' | 'subscriptions' | 'adult-verification';
}

export interface MypageMenuGroup {
  title: string;
  items: MypageMenuItem[];
  /** 아직 열리지 않은 표면의 자리 — 링크가 아니라 자리만 둔다. */
  placeholders?: { label: string; note: string }[];
}

const MYPAGE_MENU_GROUPS: MypageMenuGroup[] = [
  {
    title: '쇼핑 정보',
    items: [
      { href: '/orders', label: '주문 내역', description: '결제와 배송 상태, 주문 상세를 확인하세요.' },
      { href: '/my/subscriptions', label: '정기구매', description: '정기구매 일정과 결제카드를 관리하세요.', gated: 'subscriptions' },
      { href: '/gifts', label: '선물함', description: '보낸 선물과 받은 선물을 확인하세요.', gated: 'gifts' },
      { href: '/tickets', label: '내 티켓', description: '예매 상태와 현장 입장용 티켓을 확인하세요.' },
      { href: '/my/wishlist', label: '위시리스트', description: '하트로 담아둔 굿즈를 다시 확인하세요.' },
      { href: '/binder', label: '바인더', description: '내가 모은 디지털 카드 컬렉션을 펼쳐보세요.' },
      { href: '/packs', label: '카드팩', description: '보유한 카드팩을 확인하고 새 카드를 만나보세요.', gated: 'card-rewards' },
      { href: '/my/reviews', label: '내 리뷰', description: '배송이 완료된 굿즈에 별점과 후기를 남기고 관리하세요.' },
    ],
  },
  {
    title: '계정 설정',
    items: [
      /* 배송지 관리는 등급 안내 앞 — 레퍼런스의 '배송지 관리 → 등급 안내' 순서다(L7 · MY-11). */
      { href: '/my/addresses', label: '배송지 관리', description: '주문서에서 불러올 배송지를 등록하고 기본 배송지를 정하세요.' },
      /* 등급 안내는 쿠폰함 앞에 선다 — 레퍼런스의 '등급 안내 → 쿠폰' 순서이고, 등급 혜택 쿠폰이 쿠폰함으로 이어진다(L6 · MY-05). */
      { href: '/my/grade-benefits', label: '회원 등급 혜택', description: '회원 등급별 기준과 혜택을 확인하세요.' },
      { href: '/my/coupons', label: '쿠폰함', description: '보유한 쿠폰과 사용·만료 내역을 확인하세요.' },
      /* 코인은 쿠폰 옆에 서지만 돈에 개입하지 않는다 — 설명에서 '할인'을 말하지 않아야
         두 재화가 여기서부터 갈라진다(CONTEXT.md 코인 vs 쿠폰 vs 뽑기권). */
      { href: '/my/store-credits', label: '적립금', description: '주문 할인용 적립금 잔액과 사용·복원 이력을 확인하세요.' },
      { href: '/my/coins', label: '코인', description: '출석·이벤트 참여로 모은 코인을 확인하세요.' },
      { href: '/my/adult-verification', label: '성인 인증', description: '19금 굿즈 구매를 위한 휴대폰 본인확인 상태를 확인하세요.', gated: 'adult-verification' },
      { href: '/notifications', label: '알림함', description: '주문, 카드팩, 팔로우한 IP의 새 소식을 확인하세요.' },
      { href: '/settings', label: '설정', description: '프로필과 정보 수신 동의를 관리하세요.' },
    ],
  },
  {
    title: '고객센터',
    items: [
      { href: '/my/inquiries', label: '1:1 문의', description: '주문·배송, 취소/반품/교환, 굿즈에 대해 운영자에게 문의하세요.' },
      /* 공개 Q&A 와 비공개 1:1 은 같은 그룹에 나란히 서지만 이름이 겹치면 안 된다 —
         사용자가 자기 글이 공개인지 비공개인지 여기서 이미 갈라 읽어야 한다. */
      { href: '/my/questions', label: '굿즈 Q&A', description: '굿즈 상세에 공개로 남긴 질문과 답변을 확인하세요.' },
    ],
  },
];

export function useMypageMenuGroups(): MypageMenuGroup[] {
  const cardRewardsEnabled = useCardRewardsEnabled();
  const giftsEnabled = useGiftMenuAvailable();
  const subscriptionsEnabled = useSubscriptionMenuAvailable();
  const adultVerificationVisible = useAdultVerificationMenuAvailable();
  return MYPAGE_MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => (!item.gated || item.gated === 'card-rewards' && cardRewardsEnabled || item.gated === 'gifts' && giftsEnabled || item.gated === 'subscriptions' && subscriptionsEnabled || item.gated === 'adult-verification' && adultVerificationVisible)),
  }));
}

export interface MypageLoyaltySummary {
  /** 뱃지 색 변종 클래스에 쓰는 소문자 등급 키. */
  grade: LoyaltyGrade;
  /** 뱃지 표기(WELCOME 등 대문자 일반명사 — 멤버십·VIP·티어 어휘 금지). */
  label: string;
  /** "다음 등급까지" 안내 한 줄. 최상위 등급이면 null. */
  nextNote: string | null;
}

export interface MypageProfileSummary {
  avatarInitial: string;
  avatarUrl: string | null;
  nickname: string;
  /** 회원 등급 — 로드에 실패하면 뱃지를 그리지 않는다(잘못된 등급을 보여주지 않는다). */
  loyalty?: MypageLoyaltySummary | null;
  /** 위시리스트에 담은 굿즈 수(MY-03). 텍스트로만 보인다 — 못 읽었으면 null 이라 숫자를 지어내지 않는다. */
  wishCount?: number | null;
}

/* 아직 열리지 않은 표면의 자리 — aside 와 세로 메뉴가 같은 모양을 그린다. */
export function MenuPlaceholder({ label, note }: { label: string; note: string }) {
  return (
    <span className="wc-mypage__soon">
      {label}
      <small>{note}</small>
    </span>
  );
}

function TierGlyph() {
  return (
    <svg aria-hidden className="wc-mypage__stat-icon" fill="none" height="21" viewBox="0 0 24 24" width="21">
      <path d="M12 3.5 14.4 8.4 19.8 9.2 15.9 13 16.8 18.4 12 15.9 7.2 18.4 8.1 13 4.2 9.2 9.6 8.4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function HeartGlyph() {
  return (
    <svg aria-hidden className="wc-mypage__stat-icon" fill="none" height="21" viewBox="0 0 24 24" width="21">
      <path d="M12 20.5 4.2 13a4.9 4.9 0 0 1 0-6.9 4.9 4.9 0 0 1 6.9 0l.9.9.9-.9a4.9 4.9 0 0 1 6.9 0 4.9 4.9 0 0 1 0 6.9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function TierBadge({ loyalty, className }: { loyalty: MypageLoyaltySummary; className?: string }) {
  return (
    <span className={`wc-mypage__tier-badge wc-mypage__tier-badge--${loyalty.grade}${className ? ` ${className}` : ''}`}>
      {loyalty.label}
    </span>
  );
}

/*
 * 프로필 스트립 — 데스크톱 1180: 인사 셀 620 + 스탯 타일 276 ×2(회원 등급 · 위시리스트, 11 §5.1).
 * 모바일은 웰컴 행(아바타 72 + 등급 뱃지 → 이름 → 인사)만 남기고 타일을 걷는다(LD-1a) — 위시 수는 바로가기 배지가 든다.
 * 링크를 두지 않는다: 메뉴와 같은 목적지를 여기 또 두지 않는다(한 화면 한 링크 규율 — 11 MY-03 INTENTIONAL).
 * 등급 뱃지와 위시 수는 텍스트다.
 */
function ProfileStrip({ profile }: { profile: MypageProfileSummary }) {
  const wishCount = profile.wishCount;
  return (
    <section aria-label="프로필 요약" className="wc-mypage__profile">
      <div className="wc-mypage__profile-cell wc-mypage__profile-cell--greeting">
        <span className="wc-mypage__avatar">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" height={72} src={profile.avatarUrl} width={72} />
          ) : (
            <span aria-hidden>{profile.avatarInitial}</span>
          )}
        </span>
        <div className="wc-mypage__greeting-copy">
          {/* 모바일 웰컴 행의 등급 뱃지 — 데스크톱은 같은 뱃지를 등급 타일이 든다(한쪽만 화면에 남는다). */}
          {profile.loyalty ? <TierBadge className="wc-mypage__greeting-badge" loyalty={profile.loyalty} /> : null}
          <p className="wc-mypage__greeting">{profile.nickname}</p>
          <p className="wc-mypage__greeting-sub">나의 ICONS 활동을 이어가세요.</p>
        </div>
      </div>
      <div className="wc-mypage__stat">
        <TierGlyph />
        <p className="wc-mypage__stat-label">회원 등급</p>
        {profile.loyalty ? (
          <p className="wc-mypage__stat-value">
            <TierBadge loyalty={profile.loyalty} />
            {profile.loyalty.nextNote ? <small className="wc-mypage__tier-note">{profile.loyalty.nextNote}</small> : null}
          </p>
        ) : (
          <p className="wc-mypage__stat-value wc-mypage__stat-value--muted">확인하지 못했어요</p>
        )}
      </div>
      <div className="wc-mypage__stat">
        <HeartGlyph />
        <p className="wc-mypage__stat-label">위시리스트</p>
        {typeof wishCount === 'number' ? (
          <p className="wc-mypage__stat-value wc-mypage__stat-count">
            {wishCount.toLocaleString('ko-KR')}
            <span className="wc-sr-only">개</span>
          </p>
        ) : (
          <p className="wc-mypage__stat-value wc-mypage__stat-value--muted">확인하지 못했어요</p>
        )}
      </div>
    </section>
  );
}

export function MypageShell({
  active,
  children,
  dashboard = false,
  heading,
  lead,
  profile,
  tail,
  withAside = true,
}: {
  /** 현재 표면의 메뉴 href — aside 의 aria-current 대상. */
  active?: string;
  children: ReactNode;
  /** /my 대시보드 — 모바일에서도 메뉴를 세로 메뉴로 펼친다(LD-1a). 하위 화면의 모바일은 메뉴를 숨긴다. */
  dashboard?: boolean;
  /** 보이는 제목이 없는 표면(대시보드)의 h1 — 프로필 스트립보다 앞에 시각 숨김으로 둔다. */
  heading?: string;
  /** 프로필 스트립과 본체 사이에 서는 줄(대시보드의 모바일 바로가기 4칸). */
  lead?: ReactNode;
  profile?: MypageProfileSummary;
  /** 본체 뒤에 서는 줄(대시보드의 모바일 로그아웃). */
  tail?: ReactNode;
  withAside?: boolean;
}) {
  const groups = useMypageMenuGroups();

  return (
    <main className={`wc-root wc-mypage${dashboard ? ' wc-mypage--dashboard' : ''}`}>
      <div className="wc-container">
        {heading ? <h1 className="wc-sr-only">{heading}</h1> : null}
        {profile ? <ProfileStrip profile={profile} /> : null}
        {lead}
        <div className={withAside ? 'wc-mypage__body' : undefined}>
          {withAside ? (
            <nav aria-label="마이페이지 메뉴" className="wc-mypage__aside">
              {groups.map((group) => (
                <div className="wc-mypage__aside-group" key={group.title}>
                  <p className="wc-mypage__aside-title">{group.title}</p>
                  <ul className="wc-mypage__aside-list">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <Link aria-current={active === item.href ? 'page' : undefined} href={item.href}>
                          {item.label}
                        </Link>
                      </li>
                    ))}
                    {group.placeholders?.map((placeholder) => (
                      <li key={placeholder.label}>
                        <MenuPlaceholder label={placeholder.label} note={placeholder.note} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          ) : null}
          <div className="wc-mypage__content">{children}</div>
        </div>
        {tail}
      </div>
    </main>
  );
}
