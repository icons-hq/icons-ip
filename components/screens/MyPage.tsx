'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { MypageShell, useMypageMenuGroups } from '@/components/wc/MypageShell';

interface MyPageProps {
  avatarInitial: string;
  avatarUrl: string | null;
  nickname: string;
}

/*
 * /my 허브 — 마이페이지 셸의 메뉴 그 자체를 콘텐츠로 펼친다(aside 없음).
 * 데스크톱 하위 표면은 aside 로 오가고, 모바일은 이 허브가 유일한 계정 내비다.
 */
export function MyPage({ avatarInitial, avatarUrl, nickname }: MyPageProps) {
  const groups = useMypageMenuGroups();

  return (
    <MypageShell profile={{ avatarInitial, avatarUrl, nickname }} withAside={false}>
      <h1 className="wc-mypage__heading">마이</h1>
      <nav aria-label="마이페이지 메뉴">
        {groups.map((group) => (
          <section aria-label={group.title} className="wc-mypage__dest-group" key={group.title}>
            <h2 className="wc-mypage__dest-title">{group.title}</h2>
            <ul className="wc-mypage__dest-list">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>
                    <span>
                      <strong>{item.label}</strong>
                      <span className="wc-mypage__dest-desc">{item.description}</span>
                    </span>
                    <span aria-hidden className="wc-mypage__dest-arrow">
                      <Icon name="chevronRight" size={18} />
                    </span>
                  </Link>
                </li>
              ))}
              {group.placeholders?.map((placeholder) => (
                <li key={placeholder.label}>
                  <span className="wc-mypage__aside-soon">
                    {placeholder.label}
                    <small>{placeholder.note}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </MypageShell>
  );
}
