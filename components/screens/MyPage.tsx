'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { useCardRewardsEnabled } from '@/components/shell/CardRewardAvailability';

interface MyPageProps {
  avatarInitial: string;
  avatarUrl: string | null;
  nickname: string;
}

const DESTINATIONS = [
  {
    description: '결제와 배송 상태, 주문 상세를 확인하세요.',
    href: '/orders',
    icon: 'bag',
    label: '주문 내역',
    meta: 'SHOP',
  },
  {
    description: '예매 상태와 현장 입장용 티켓을 확인하세요.',
    href: '/tickets',
    icon: 'event',
    label: '내 티켓',
    meta: 'TICKETS',
  },
  {
    description: '내가 모은 디지털 카드 컬렉션을 펼쳐보세요.',
    href: '/binder',
    icon: 'grid',
    label: '바인더',
    meta: 'COLLECTION',
  },
  {
    description: '보유한 카드팩을 확인하고 새 카드를 만나보세요.',
    href: '/packs',
    icon: 'spark',
    label: '카드팩',
    meta: 'PACKS',
  },
  {
    description: '주문, 카드팩, 팔로우한 IP의 새 소식을 확인하세요.',
    href: '/notifications',
    icon: 'bell',
    label: '알림함',
    meta: 'INBOX',
  },
  {
    description: '프로필과 정보 수신 동의를 관리하세요.',
    href: '/settings',
    icon: 'user',
    label: '설정',
    meta: 'ACCOUNT',
  },
] as const;

export function MyPage({ avatarInitial, avatarUrl, nickname }: MyPageProps) {
  const cardRewardsEnabled = useCardRewardsEnabled();
  const destinations = DESTINATIONS.filter(
    (destination) => cardRewardsEnabled || destination.href !== '/packs',
  );

  return (
    <main className="screen my-page">
      <header className="my-header">
        <div className="wrap">
          <div className="eyebrow rise">MY ICONS</div>
          <h1 className="h-xl rise">마이</h1>
          <p className="rise">주문부터 티켓, 카드 컬렉션까지 한곳에서 관리하세요.</p>
        </div>
      </header>

      <section className="my-content" aria-labelledby="my-profile-heading">
        <div className="wrap">
          <div className="my-profile card rise">
            <div className="my-avatar">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" height={96} src={avatarUrl} width={96} />
              ) : (
                <span aria-hidden>{avatarInitial}</span>
              )}
            </div>
            <div className="my-profile-copy">
              <span aria-hidden className="mono">PROFILE</span>
              <h2 id="my-profile-heading">{nickname}</h2>
              <p>나의 ICONS 활동을 이어가세요.</p>
            </div>
          </div>

          <div className="my-section-heading">
            <div>
              <span aria-hidden className="mono">MY SPACE</span>
              <h2>내 활동</h2>
            </div>
            <p>필요한 곳으로 바로 이동할 수 있어요.</p>
          </div>

          <nav aria-label="마이페이지 메뉴">
            <ul className="my-destination-grid">
              {destinations.map((destination) => (
                <li key={destination.href}>
                  <Link className="my-destination card" href={destination.href}>
                    <span className="my-destination-icon" aria-hidden>
                      <Icon name={destination.icon} size={22} />
                    </span>
                    <span className="my-destination-copy">
                      <span aria-hidden className="mono">{destination.meta}</span>
                      <strong>{destination.label}</strong>
                      <span>{destination.description}</span>
                    </span>
                    <span className="my-destination-arrow" aria-hidden>
                      <Icon name="chevronRight" size={18} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>
    </main>
  );
}
