'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/wc/EmptyState';
import { WcButton } from '@/components/wc/WcButton';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { FandomEvent, Ip } from '@/lib/data';
import type { EventGameLink } from '@/lib/games/catalog';
import { ALL_IPS, ALL_MODES, ALL_STATUSES, eventModeOptions, eventStatusOptions, selectFandomEvents } from '@/lib/events-catalog';

/* 오프라인 팝업 목록 (DESIGN §8 오프라인 팝업 · 11 §8 EV-04).
 *
 * 레퍼런스에 대응 표면이 없어 이벤트 허브의 카드 문법(R-06 §1.4)을 빌린다:
 * 2열 580px 그리드, 3:2 썸네일, 좌상단 유형 뱃지(검정 면 텍스트), 제목 18/700.
 * 허브와 같은 보완 규칙으로 기간 라벨과 상태 뱃지를 함께 단다(DESIGN §6 campaign-hub —
 * 레퍼런스는 진행·종료를 리스트 순서로만 구분했다). 머리는 레퍼런스 목록 페이지
 * (R-06 §5)처럼 왼쪽 정렬 h1 이다.
 *
 * 필터·정렬(selectFandomEvents)·딥링크(initialIpId)·참여형 게임 진입은 그대로다 —
 * 이 화면이 바꾸는 것은 마크업과 스타일뿐이고, 회차·잔여·예매는 상세가 맡는다. */

const eventHref = (id: string) => `/offline-popups/${encodeURIComponent(id)}`;

const GUIDE = [
  { n: '01', t: '예매', d: '회차와 인원을 고르고 결제해요. 결제사 승인 확인 후 티켓이 발급돼요.' },
  { n: '02', t: 'QR 전자티켓', d: '마이 티켓에 QR이 발급돼요. 종이 티켓은 없어요.' },
  { n: '03', t: '스캔 입장', d: '현장에서 QR을 스캔하면 줄 없이 바로 입장해요.' },
];

/* ------------------------------------------------------------------
   상태 뱃지 — 목록 카드와 상세 머리가 같은 규칙을 쓴다
   ------------------------------------------------------------------
   예매중은 행동할 수 있는 상태라 잉크 솔리드, 진행중은 잉크 아웃라인, 예정은 컨트롤 선
   아웃라인, 종료는 뮤트. 색만으로 구분하지 않고 상태 글자를 항상 함께 싣는다. */

export type OfflinePopupStateVariant = 'open' | 'live' | 'upcoming' | 'ended' | 'other';

const STATE_VARIANTS: Record<string, OfflinePopupStateVariant> = {
  예매중: 'open',
  진행중: 'live',
  예정: 'upcoming',
  종료: 'ended',
};

export function offlinePopupStateVariant(status: string): OfflinePopupStateVariant {
  return STATE_VARIANTS[status] ?? 'other';
}

export function OfflinePopupStateBadge({ status }: { status: string }) {
  return (
    <span className={`wc-offline-state wc-offline-state--${offlinePopupStateVariant(status)}`}>{status}</span>
  );
}

function OfflinePopupCard({ e, ip, games }: { e: FandomEvent; ip: Ip | null; games: EventGameLink[] }) {
  return (
    <li className="wc-offline-card">
      {/* 카드 본체는 상세로 가는 링크 하나다(R-06 §1.4). 참여형 게임 진입은 다른 목적지라
          링크 안에 넣지 않고 카드 아래 따로 둔다 — 링크 안의 링크는 만들 수 없다. */}
      <Link className="wc-offline-card__link" href={eventHref(e.id)}>
        {/* 썸네일 아트는 장식이지만 유형 뱃지 텍스트는 정보다 — 미디어 통째로 aria-hidden 하지 않는다. */}
        <div
          className="wc-offline-card__media"
          style={{ background: e.img, backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          <span className="wc-offline-card__kind">{e.mode}</span>
        </div>
        <div className="wc-offline-card__info">
          {ip ? <p className="wc-offline-card__ip">{ip.title}</p> : null}
          <h2 className="wc-offline-card__title">{e.title}</h2>
          <p className="wc-offline-card__place">{e.loc || '장소 공개 예정'}</p>
          <p className="wc-offline-card__meta">
            <span className="wc-offline-card__period">{e.date || '일정 공개 예정'}</span>
            <OfflinePopupStateBadge status={e.status} />
          </p>
        </div>
      </Link>
      {games.length > 0 ? (
        <ul aria-label={`${e.title} 참여형 게임`} className="wc-offline-card__games">
          {games.map((game) => (
            <li key={game.gameId}>
              <Link className="wc-offline-card__game" href={`/games/${game.gameId}`}>{game.title} 플레이</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface FilterOption {
  value: string;
  label: string;
}

function FilterGroup({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  value: string;
}) {
  return (
    <div aria-label={label} className="wc-offline-filters__group" role="group">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className="wc-offline-chip"
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Events({
  catalog,
  initialIpId,
  gameLinks = [],
}: {
  catalog: Pick<CatalogSnapshot, 'ips' | 'events'>;
  initialIpId?: string;
  gameLinks?: EventGameLink[];
}) {
  const [ipF, setIpF] = useState(initialIpId ?? ALL_IPS);
  const [modeF, setModeF] = useState(ALL_MODES);
  const [statusF, setStatusF] = useState(ALL_STATUSES);
  const filtersRef = useRef<HTMLDivElement>(null);
  /* '전체 보기'는 누르는 순간 빈 상태째 사라진다 — 포커스가 문서 맨 앞으로 빠지지 않게 되돌린 필터(첫 묶음의
     선택된 칩)로 옮긴다. 렌더가 끝난 뒤에만 그 칩이 "전체"로 바뀌어 있으므로 커밋 뒤 effect 에서 옮긴다. */
  const focusFiltersAfterReset = useRef(false);
  useEffect(() => {
    if (!focusFiltersAfterReset.current) return;
    focusFiltersAfterReset.current = false;
    filtersRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  });

  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
  /* 스키마는 이벤트당 게임 수를 제약하지 않으므로 전부 모아 진입 링크로 노출한다 */
  const gamesByEventId = new Map<string, EventGameLink[]>();
  for (const link of gameLinks) {
    const list = gamesByEventId.get(link.eventId);
    if (list) list.push(link);
    else gamesByEventId.set(link.eventId, [link]);
  }
  const ipsWithEvents = catalog.ips.filter((ip) => catalog.events.some((e) => e.ip === ip.id));
  const modes = eventModeOptions(catalog.events);
  const statuses = eventStatusOptions(catalog.events);

  const list = selectFandomEvents(catalog.events, { ipId: ipF, mode: modeF, status: statusF });
  const filtered = ipF !== ALL_IPS || modeF !== ALL_MODES || statusF !== ALL_STATUSES;
  const resetFilters = () => {
    focusFiltersAfterReset.current = true;
    setIpF(ALL_IPS);
    setModeF(ALL_MODES);
    setStatusF(ALL_STATUSES);
  };

  return (
    <div className="wc-root wc-offline">
      <div className="wc-container">
        <header className="wc-offline__head">
          <h1 className="wc-offline__title">오프라인 팝업</h1>
          {/* 이 표면은 오프라인만 싣는다(selectOfflinePopupEvents) — 리드도 그렇게 읽혀야
              한다. "온·오프라인"이라고 적어 두면 목록에 없는 온라인 팝업을 찾는 사람이
              여기서 필터만 만지다 돌아간다. */}
          <p className="wc-offline__lead">공식 오프라인 팝업스토어를 발견하고, 예매부터 QR 입장까지 한 번에.</p>
        </header>

        {/* 고를 것이 하나뿐인 축(모든 팝업이 같은 상태·모드)은 필터로 내놓지 않는다 —
            "전체 / 그 하나"는 눌러도 목록이 바뀌지 않는 버튼이다. */}
        {ipsWithEvents.length > 0 || statuses.length > 1 || modes.length > 1 ? (
          <div className="wc-offline-filters" ref={filtersRef}>
            {ipsWithEvents.length > 0 ? (
              <FilterGroup
                label="IP 필터"
                onChange={setIpF}
                options={[
                  { value: ALL_IPS, label: '전체 IP' },
                  ...ipsWithEvents.map((ip) => ({ value: ip.id, label: ip.title })),
                ]}
                value={ipF}
              />
            ) : null}
            {statuses.length > 1 ? (
              <FilterGroup
                label="상태 필터"
                onChange={setStatusF}
                options={[
                  { value: ALL_STATUSES, label: '전체 상태' },
                  ...statuses.map((status) => ({ value: status, label: status })),
                ]}
                value={statusF}
              />
            ) : null}
            {modes.length > 1 ? (
              <FilterGroup
                label="모드 필터"
                onChange={setModeF}
                options={[
                  { value: ALL_MODES, label: '전체 모드' },
                  ...modes.map((mode) => ({ value: mode, label: mode })),
                ]}
                value={modeF}
              />
            ) : null}
          </div>
        ) : null}

        {list.length > 0 ? (
          <ul className="wc-offline-grid">
            {list.map((e) => (
              <OfflinePopupCard
                e={e}
                games={gamesByEventId.get(e.id) ?? []}
                ip={e.ip ? ipsById.get(e.ip) ?? null : null}
                key={e.id}
              />
            ))}
          </ul>
        ) : catalog.events.length && filtered ? (
          <EmptyState
            action={<WcButton onClick={resetFilters}>전체 보기</WcButton>}
            className="wc-offline__empty"
            description="필터를 바꾸거나 전체 목록으로 돌아가 보세요."
            title="조건에 맞는 오프라인 팝업이 없어요"
            titleAs="h2"
          />
        ) : (
          <EmptyState
            action={<WcButton href="/">홈으로 가기</WcButton>}
            className="wc-offline__empty"
            description="새 오프라인 팝업이 열리면 이 자리에서 알려 드릴게요."
            title="등록된 오프라인 팝업이 아직 없어요"
            titleAs="h2"
          />
        )}
      </div>

      {/* QR 안내 — 예매 전에 입장 방식을 먼저 알 수 있게 목록 아래 둔다. */}
      <section aria-labelledby="offline-guide-heading" className="wc-offline-guide">
        <div className="wc-container">
          <h2 className="wc-offline-guide__title" id="offline-guide-heading">전자티켓 · QR 입장</h2>
          <ol className="wc-offline-guide__steps">
            {GUIDE.map((g) => (
              <li className="wc-offline-guide__step" key={g.n}>
                <span aria-hidden className="wc-offline-guide__num">{g.n}</span>
                <strong className="wc-offline-guide__name">{g.t}</strong>
                <span className="wc-offline-guide__desc">{g.d}</span>
              </li>
            ))}
          </ol>
          <p className="wc-offline-guide__caption">취소·환불 규정은 예매 화면에서 안내됩니다</p>
        </div>
      </section>
    </div>
  );
}
