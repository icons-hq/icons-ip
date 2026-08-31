'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCardRewardsEnabled } from '@/components/shell/CardRewardAvailability';

/*
 * 마이페이지 셸 (R-05 §4, S6 #328).
 *
 * 그룹 3개(쇼핑 정보/계정 설정/고객센터)는 레퍼런스의 문법이고 항목은 우리 도메인이다.
 * /my 허브는 이 메뉴 자체를 콘텐츠로 펼치고(aside 없음 — 같은 링크를 두 번 그리지 않는다),
 * 하위 표면은 좌 200px aside 로 같은 메뉴를 오간다. 모바일은 aside 를 숨기고
 * 콘텐츠를 우선한다 — 내비는 /my 허브와 하단 탭바가 맡는다.
 */

export interface MypageMenuItem {
  href: string;
  label: string;
  description: string;
  /** 카드 리워드 게이트(DB 소유)가 닫혀 있으면 숨긴다 — 현 /packs 노출 규칙과 동일. */
  gated?: 'card-rewards';
}

export interface MypageMenuGroup {
  title: string;
  items: MypageMenuItem[];
  /** S7(쿠폰·회원 등급)에서 열리는 자리 — 링크가 아니라 자리만 둔다. */
  placeholders?: { label: string; note: string }[];
}

const MYPAGE_MENU_GROUPS: MypageMenuGroup[] = [
  {
    title: '쇼핑 정보',
    items: [
      { href: '/orders', label: '주문 내역', description: '결제와 배송 상태, 주문 상세를 확인하세요.' },
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
      { href: '/notifications', label: '알림함', description: '주문, 카드팩, 팔로우한 IP의 새 소식을 확인하세요.' },
      { href: '/settings', label: '설정', description: '프로필과 정보 수신 동의를 관리하세요.' },
    ],
    placeholders: [{ label: '쿠폰함', note: '곧 열려요' }],
  },
  {
    title: '고객센터',
    items: [
      { href: '/my/inquiries', label: '1:1 문의', description: '주문·배송, 취소/반품/교환, 상품에 대해 운영자에게 문의하세요.' },
    ],
  },
];

export function useMypageMenuGroups(): MypageMenuGroup[] {
  const cardRewardsEnabled = useCardRewardsEnabled();
  if (cardRewardsEnabled) return MYPAGE_MENU_GROUPS;
  return MYPAGE_MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.gated !== 'card-rewards'),
  }));
}

export interface MypageProfileSummary {
  avatarInitial: string;
  avatarUrl: string | null;
  nickname: string;
}

/* S7에서 열리는 자리 — aside 와 /my 허브가 같은 모양을 그린다. */
export function MenuPlaceholder({ label, note }: { label: string; note: string }) {
  return (
    <span className="wc-mypage__soon">
      {label}
      <small>{note}</small>
    </span>
  );
}

function ProfileStrip({ profile }: { profile: MypageProfileSummary }) {
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
        <div>
          <p className="wc-mypage__greeting">{profile.nickname}</p>
          <p className="wc-mypage__greeting-sub">나의 ICONS 활동을 이어가세요.</p>
        </div>
      </div>
      <div className="wc-mypage__profile-cell wc-mypage__profile-cell--meta">
        {/* 등급 뱃지 슬롯 — 데이터는 S7(회원 등급)에서 연결한다. 유료 '멤버십'과
            섞지 않는 용어 규율(CONTEXT.md). 메뉴와 같은 목적지를 여기 또 두지
            않는다(한 화면 한 링크 규율). */}
        <span className="wc-mypage__tier">
          회원 등급
          <span className="wc-mypage__tier-badge">곧 열려요</span>
        </span>
      </div>
    </section>
  );
}

export function MypageShell({
  active,
  children,
  profile,
  withAside = true,
}: {
  /** 현재 표면의 메뉴 href — aside 의 aria-current 대상. */
  active?: string;
  children: ReactNode;
  profile?: MypageProfileSummary;
  withAside?: boolean;
}) {
  const groups = useMypageMenuGroups();

  return (
    <main className="wc-root wc-mypage">
      <div className="wc-container">
        {profile ? <ProfileStrip profile={profile} /> : null}
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
      </div>
    </main>
  );
}
