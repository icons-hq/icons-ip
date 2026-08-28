'use client';

/* 온라인 팝업 디렉토리(/ip) — R-03 §3 브랜드 디렉토리 재현.
 * 피처드 타일(최대 5) + A–Z 인덱스 바(ALL+A–Z+ETC 28항목, 클라이언트 필터) + IP 리스트.
 * 분류·정렬 규칙은 lib/ip-directory 가 정본이고, 표시명은 ipEn(영문 우선)을 쓴다. */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/wc/EmptyState';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { WcButton } from '@/components/wc/WcButton';
import type { Ip } from '@/lib/data';
import { DIRECTORY_LETTERS, filterIpsByLetter, sortIpsForDirectory } from '@/lib/ip-directory';
import { ipEn } from '@/lib/ip-display';
import { hrefFor } from '@/lib/routes';

/** R-03 §3.1 — 피처드 타일은 최대 5개(데스크톱 5열 한 줄)만 노출한다. */
const FEATURED_LIMIT = 5;

export function IpDirectory({
  ips,
  initialLetter = 'ALL',
}: {
  ips: Ip[];
  /** 시작 레터(테스트·딥링크용). 기본은 전체(ALL)다. */
  initialLetter?: string;
}) {
  const [letter, setLetter] = useState(initialLetter);
  const sorted = useMemo(() => sortIpsForDirectory(ips), [ips]);
  const filtered = useMemo(() => filterIpsByLetter(sorted, letter), [sorted, letter]);
  /* 피처드는 큐레이션(카탈로그 순서)을 그대로 따르고 A–Z 정렬을 섞지 않는다. */
  const featured = ips.filter((ip) => ip.featured).slice(0, FEATURED_LIMIT);

  return (
    <div className="wc-root wc-ipdir">
      <div className="wc-container">
        <SectionHeading
          as="h1"
          subcopy="IP별 전시관을 A–Z로 훑고, 관심 있는 세계로 들어가 보세요."
          title="온라인 팝업"
        />

        {ips.length === 0 ? (
          <EmptyState description="곧 새로운 IP가 공개될 예정이에요." title="등록된 IP가 아직 없습니다" />
        ) : (
          <>
            {featured.length > 0 ? (
              <section aria-label="피처드 IP" className="wc-ipdir__featured">
                {featured.map((ip) => (
                  <Link
                    key={ip.id}
                    className="wc-ipdir__tile"
                    href={hrefFor('ip', ip.id)}
                    style={{ background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center' }}
                  >
                    <span>{ipEn(ip)}</span>
                  </Link>
                ))}
              </section>
            ) : null}

            {/* 카운트는 바 밖 형제다 — 모바일은 바 아래 우측(R-03 §3.2, 스크롤 영역에 가두면
                화면에서 사라진다), 데스크톱은 밴드 flex 로 같은 보더 행 우측 끝에 선다. */}
            <div className="wc-alpha-index-band">
              <div aria-label="IP 이니셜 필터" className="wc-alpha-index" role="group">
                {DIRECTORY_LETTERS.map((item) => (
                  <button
                    key={item}
                    aria-pressed={letter === item}
                    className={`wc-alpha-index__letter${letter === item ? ' is-active' : ''}`}
                    onClick={() => setLetter(item)}
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </div>
              <p aria-live="polite" className="wc-alpha-index__count">
                총 <strong>{filtered.length}</strong> 개
              </p>
            </div>

            {filtered.length === 0 ? (
              <div className="wc-ipdir__empty">
                <EmptyState
                  action={<WcButton onClick={() => setLetter('ALL')}>전체 보기</WcButton>}
                  title="이 이니셜의 IP가 아직 없어요"
                />
              </div>
            ) : (
              <div className="wc-ipdir__list">
                {filtered.map((ip) => (
                  <Link key={ip.id} className="wc-ipdir__row" href={hrefFor('ip', ip.id)}>
                    <span
                      aria-hidden
                      className="wc-ipdir__thumb"
                      style={{ background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    />
                    <span>{ipEn(ip)}</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
