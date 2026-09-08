'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { DemoDialog } from '@/components/secondary-market-demo/DemoDialog';
import { DemoNotice } from '@/components/secondary-market-demo/DemoNotice';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { Badge } from '@/components/wc/Badge';
import { EmptyState } from '@/components/wc/EmptyState';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { WcButton } from '@/components/wc/WcButton';
import { DATA, type Card, type Ip } from '@/lib/data';
import { krw } from '@/lib/format';
import { ipAccentInk } from '@/lib/ip-display';
import { rarityTag } from '@/lib/rarity';
import {
  BID_STEP,
  TRADE_LISTINGS,
  formatCountdown,
  minNextBid,
  type AuctionTrade,
  type DirectTrade,
  type TradeKind,
  type TradeListing,
} from '@/lib/secondary-market-demo';

/* 카드 트레이드(카드 C2C) 스태프 전용 시연 — lib/secondary-market-demo.ts 주석 참고.
 * 직거래(카드↔카드 제안)와 경매(원화 입찰) 두 유형을 옛 프로토타입에서 되살렸다. 입찰·제안·등록은
 * 전부 로컬 상태고, 경매 마감 카운트다운도 화면 안 1초 타이머다. 서버·DB·PG 는 호출되지 않는다.
 * 카드 소유권 이전·수수료는 정식 오픈 시 확정되므로 화면 문구는 "시연"을 유지한다. */

type Filter = '전체' | TradeKind;
type Dialog =
  | { type: 'bid'; trade: AuctionTrade }
  | { type: 'offer'; trade: DirectTrade }
  | { type: 'list' }
  | null;

const FILTERS: Filter[] = ['전체', '직거래', '경매'];
const MY_USER = 'me';
const NEW_AUCTION_SEC = 24 * 3600;

const userLabel = (user: string) => (user === MY_USER ? '내 등록' : `@${user}`);

/* 마감 카운트다운 — 마운트 후 1초마다 흐른 초를 센다. 서버 렌더와 첫 클라이언트 렌더는 0 으로 같다. */
function useElapsedSeconds() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return elapsed;
}

export function ExchangeDemo() {
  const [filter, setFilter] = useState<Filter>('전체');
  const [trades, setTrades] = useState<TradeListing[]>(TRADE_LISTINGS);
  const [mine, setMine] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const elapsed = useElapsedSeconds();

  const ipsById = new Map(DATA.IPS.map((ip) => [ip.id, ip]));
  const myCards = DATA.CARDS.filter((card) => card.owned);
  const counts: Record<Filter, number> = {
    전체: trades.length,
    직거래: trades.filter((trade) => trade.kind === '직거래').length,
    경매: trades.filter((trade) => trade.kind === '경매').length,
  };
  const list = trades.filter((trade) => filter === '전체' || trade.kind === filter);

  const closeDialog = () => setDialog(null);
  const markMine = (id: string) => setMine((prev) => new Set(prev).add(id));
  const placeBid = (id: string, amount: number) => {
    setTrades((prev) => prev.map((trade) => (
      trade.id === id && trade.kind === '경매' ? { ...trade, bid: amount, bids: trade.bids + 1 } : trade
    )));
    markMine(id);
  };
  const addTrade = (trade: TradeListing) => {
    setTrades((prev) => [trade, ...prev]);
    setFilter('전체');
    closeDialog();
  };

  return (
    <div className="wc-root">
      <div className="wc-container wc-c2c">
        <DemoNotice />

        <header className="wc-c2c__head">
          <SectionHeading as="h1" subcopy="팬들끼리 직거래·경매로 한정 카드를 트레이드하세요." title="카드 트레이드" />
          <div className="wc-c2c__head-cta">
            <WcButton onClick={() => setDialog({ type: 'list' })} variant="primary">트레이드 등록</WcButton>
            <p className="wc-c2c__caption">등록 수수료는 정식 오픈 시 안내됩니다</p>
          </div>
        </header>

        <div aria-label="거래 유형 필터" className="wc-c2c__filters" role="group">
          {FILTERS.map((candidate) => (
            <button
              key={candidate}
              aria-pressed={filter === candidate}
              className="wc-c2c__chip"
              onClick={() => setFilter(candidate)}
              type="button"
            >
              {candidate} <span className="wc-c2c__chip-count">{counts[candidate]}</span>
            </button>
          ))}
        </div>

        {list.length > 0 ? (
          <ul className="wc-c2c__trades">
            {list.map((trade) => (
              <TradeCard
                key={trade.id}
                elapsed={elapsed}
                ip={ipsById.get(trade.ip)}
                mine={mine.has(trade.id)}
                onBid={() => trade.kind === '경매' && setDialog({ type: 'bid', trade })}
                onOffer={() => trade.kind === '직거래' && setDialog({ type: 'offer', trade })}
                trade={trade}
              />
            ))}
          </ul>
        ) : (
          <EmptyState description="다른 유형을 보거나 첫 트레이드를 등록해 보세요" title="이 유형의 트레이드가 아직 없어요" />
        )}

        <p className="wc-c2c__footnote">
          <span aria-hidden className="wc-c2c__footnote-mark">✓</span>
          트레이드 체결 방식(소유권 동시 이전)과 수수료는 정식 오픈 시 확정·공지됩니다. 이 화면의 체결은 시연입니다.
        </p>
      </div>

      {dialog?.type === 'bid' && (
        <OverlayPortal>
          <BidDialog
            elapsed={elapsed}
            onClose={closeDialog}
            onSubmit={(amount) => placeBid(dialog.trade.id, amount)}
            trade={dialog.trade}
          />
        </OverlayPortal>
      )}
      {dialog?.type === 'offer' && (
        <OverlayPortal>
          <OfferDialog
            ipsById={ipsById}
            myCards={myCards}
            onClose={closeDialog}
            onSubmit={() => markMine(dialog.trade.id)}
            trade={dialog.trade}
          />
        </OverlayPortal>
      )}
      {dialog?.type === 'list' && (
        <OverlayPortal>
          <ListTradeDialog elapsed={elapsed} myCards={myCards} onClose={closeDialog} onSubmit={addTrade} />
        </OverlayPortal>
      )}
    </div>
  );
}

function CardTile({ bg, rarity, className }: { bg: string; rarity: Card['rarity']; className: string }) {
  const tag = rarityTag(rarity);
  return (
    <span className={className} style={{ background: bg, boxShadow: `0 0 0 1px ${tag.ring}` }}>
      <span className="wc-c2c__rarity" style={{ color: tag.color, background: tag.bg }}>{rarity}</span>
    </span>
  );
}

function TradeCard({
  elapsed,
  ip,
  mine,
  onBid,
  onOffer,
  trade,
}: {
  elapsed: number;
  ip: Ip | undefined;
  mine: boolean;
  onBid: () => void;
  onOffer: () => void;
  trade: TradeListing;
}) {
  const auction = trade.kind === '경매';

  return (
    <li className="wc-c2c__trade">
      <CardTile bg={trade.bg} className="wc-c2c__trade-tile" rarity={trade.rarity} />
      <div className="wc-c2c__trade-body">
        <div className="wc-c2c__trade-top">
          <Badge variant={auction ? 'tint' : 'outline'}>{trade.kind}</Badge>
          <span>{userLabel(trade.user)}</span>
          {ip ? <span style={{ color: ipAccentInk(ip) }}>{ip.title}</span> : null}
        </div>
        <h3 className="wc-c2c__trade-name">{trade.card}</h3>
        {trade.kind === '경매' ? (
          <>
            <div className="wc-c2c__trade-row">
              <span>현재가 · {trade.bids}입찰</span>
              <span className="wc-c2c__trade-timer">마감 {formatCountdown(trade.endsInSec - elapsed)}</span>
            </div>
            <div className="wc-c2c__trade-row">
              <strong className="wc-c2c__trade-price">{krw(trade.bid)}</strong>
              {mine ? <Badge>최고 입찰 중</Badge> : null}
            </div>
            <div className="wc-c2c__trade-action">
              <WcButton onClick={onBid} variant="primary">입찰</WcButton>
            </div>
          </>
        ) : (
          <>
            <p className="wc-c2c__trade-want"><span>원함 · </span>{trade.want}</p>
            <div className="wc-c2c__trade-action">
              {mine ? <WcButton disabled>제안 보냄</WcButton> : <WcButton onClick={onOffer}>트레이드 제안하기</WcButton>}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/* 입찰 — 현재가 + 입찰 단위가 하한이다. 제출하면 목록의 현재가·입찰 수가 바로 바뀐다. */
export function BidDialog({
  elapsed,
  onClose,
  onSubmit,
  trade,
}: {
  elapsed: number;
  onClose: () => void;
  onSubmit: (amount: number) => void;
  trade: AuctionTrade;
}) {
  const min = minNextBid(trade.bid);
  const [amount, setAmount] = useState(String(min));
  const [done, setDone] = useState<number | null>(null);
  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= min;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit(value);
    setDone(value);
  };

  return (
    <DemoDialog onClose={onClose} title={done === null ? '입찰' : '입찰 완료'}>
      <div className="wc-c2c__summary">
        <CardTile bg={trade.bg} className="wc-c2c__summary-card" rarity={trade.rarity} />
        <div className="wc-c2c__summary-body">
          <p className="wc-c2c__summary-name">{trade.card}</p>
          <p className="wc-c2c__summary-meta">경매 · {userLabel(trade.user)} · 마감 {formatCountdown(trade.endsInSec - elapsed)}</p>
        </div>
      </div>

      {done !== null ? (
        <div className="wc-c2c__done">
          <span aria-hidden className="wc-c2c__done-mark">✓</span>
          <p className="wc-c2c__done-title">{krw(done)} 입찰 완료 — 현재 최고 입찰자예요</p>
          <p className="wc-c2c__done-desc">마감 시 최고가면 대금은 에스크로에서 판매자에게 정산되고 카드 소유권이 동시에 이전돼요.</p>
          <div className="wc-c2c__dialog-actions">
            <WcButton onClick={onClose} variant="primary">확인</WcButton>
          </div>
        </div>
      ) : (
        <form className="wc-c2c__form" onSubmit={submit}>
          <dl className="wc-c2c__rows">
            <div className="wc-c2c__row"><dt>현재가</dt><dd>{krw(trade.bid)}</dd></div>
            <div className="wc-c2c__row"><dt>입찰 단위</dt><dd>{krw(BID_STEP)}</dd></div>
            <div className="wc-c2c__row is-total"><dt>최소 입찰가</dt><dd>{krw(min)}</dd></div>
          </dl>
          <label className="wc-c2c__field">
            <span>입찰가 (원)</span>
            <input inputMode="numeric" min={min} onChange={(event) => setAmount(event.target.value)} required step={BID_STEP} type="number" value={amount} />
          </label>
          {!valid ? <p className="wc-c2c__field-error" role="alert">최소 입찰가 {krw(min)} 이상이어야 해요.</p> : null}
          <p className="wc-c2c__caption">시연 입찰이에요. 대금 보관·체결은 화면 상태로만 표현됩니다.</p>
          <div className="wc-c2c__dialog-actions">
            <WcButton onClick={onClose}>취소</WcButton>
            <WcButton disabled={!valid} type="submit" variant="primary">입찰하기</WcButton>
          </div>
        </form>
      )}
    </DemoDialog>
  );
}

function MyCardPicker({
  ipsById,
  myCards,
  onSelect,
  selected,
}: {
  ipsById: Map<string, Ip>;
  myCards: Card[];
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  return (
    <div aria-label="내 카드" className="wc-c2c__my-cards" role="group">
      {myCards.map((card) => {
        const ip = ipsById.get(card.ip);
        return (
          <button
            key={card.id}
            aria-pressed={selected === card.id}
            className="wc-c2c__my-card"
            onClick={() => onSelect(card.id)}
            type="button"
          >
            <CardTile bg={card.bg} className="wc-c2c__my-card-tile" rarity={card.rarity} />
            <span className="wc-c2c__my-card-name">{card.name}</span>
            <span className="wc-c2c__my-card-meta" style={{ color: ip ? ipAccentInk(ip) : undefined }}>{ip?.title ?? ''}</span>
          </button>
        );
      })}
    </div>
  );
}

/* 트레이드 제안 — 내 바인더의 보유 카드 하나를 골라 보낸다. */
export function OfferDialog({
  ipsById,
  myCards,
  onClose,
  onSubmit,
  trade,
}: {
  ipsById: Map<string, Ip>;
  myCards: Card[];
  onClose: () => void;
  onSubmit: () => void;
  trade: DirectTrade;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const offered = myCards.find((card) => card.id === selected);

  return (
    <DemoDialog onClose={onClose} title={done ? '제안 전송 완료' : '트레이드 제안'}>
      <div className="wc-c2c__summary">
        <CardTile bg={trade.bg} className="wc-c2c__summary-card" rarity={trade.rarity} />
        <div className="wc-c2c__summary-body">
          <p className="wc-c2c__summary-name">{trade.card}</p>
          <p className="wc-c2c__summary-meta">{userLabel(trade.user)} · 원함 · {trade.want}</p>
        </div>
      </div>

      {done && offered ? (
        <div className="wc-c2c__done">
          <span aria-hidden className="wc-c2c__done-mark">✓</span>
          <p className="wc-c2c__done-title">{offered.name} 카드로 제안을 보냈어요</p>
          <p className="wc-c2c__done-desc">{userLabel(trade.user)}가 수락하면 두 카드의 소유권이 동시에 바뀌어요. 응답은 알림함으로 받아요.</p>
          <div className="wc-c2c__dialog-actions">
            <WcButton onClick={onClose} variant="primary">확인</WcButton>
          </div>
        </div>
      ) : (
        <>
          <p className="wc-c2c__field-label">제안할 내 카드를 고르세요</p>
          <MyCardPicker ipsById={ipsById} myCards={myCards} onSelect={setSelected} selected={selected} />
          <p className="wc-c2c__caption">시연 제안이에요. 실제 소유권 이전은 일어나지 않습니다.</p>
          <div className="wc-c2c__dialog-actions">
            <WcButton onClick={onClose}>취소</WcButton>
            <WcButton
              disabled={!offered}
              onClick={() => {
                onSubmit();
                setDone(true);
              }}
              variant="primary"
            >
              제안 보내기
            </WcButton>
          </div>
        </>
      )}
    </DemoDialog>
  );
}

/* 트레이드 등록 — 내 카드 하나를 직거래(원하는 조건) 또는 경매(시작가)로 올린다. */
export function ListTradeDialog({
  elapsed,
  myCards,
  onClose,
  onSubmit,
}: {
  elapsed: number;
  myCards: Card[];
  onClose: () => void;
  onSubmit: (trade: TradeListing) => void;
}) {
  const [cardId, setCardId] = useState(myCards[0]?.id ?? '');
  const [kind, setKind] = useState<TradeKind>('직거래');
  const [want, setWant] = useState('');
  const [start, setStart] = useState('');
  const card = myCards.find((candidate) => candidate.id === cardId);
  const startAmount = Number(start);
  const valid = card !== undefined && (kind === '직거래' ? want.trim().length > 0 : Number.isFinite(startAmount) && startAmount > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !card) return;
    const base = { id: `demo-${Date.now()}`, card: card.name, ip: card.ip, rarity: card.rarity, user: MY_USER, bg: card.bg };
    onSubmit(kind === '직거래'
      ? { ...base, kind, want: want.trim() }
      : { ...base, kind, bid: startAmount, bids: 0, endsInSec: NEW_AUCTION_SEC + elapsed });
  };

  return (
    <DemoDialog onClose={onClose} title="트레이드 등록">
      <form className="wc-c2c__form" onSubmit={submit}>
        <label className="wc-c2c__field">
          <span>내 카드</span>
          <select onChange={(event) => setCardId(event.target.value)} value={cardId}>
            {myCards.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.rarity}</option>)}
          </select>
        </label>
        <fieldset className="wc-c2c__fieldset">
          <legend>유형</legend>
          {(['직거래', '경매'] as const).map((candidate) => (
            <label key={candidate} className="wc-c2c__radio">
              <input checked={kind === candidate} name="trade-kind" onChange={() => setKind(candidate)} type="radio" value={candidate} />
              <span>{candidate}</span>
            </label>
          ))}
        </fieldset>
        {kind === '직거래' ? (
          <label className="wc-c2c__field">
            <span>원하는 카드·조건</span>
            <input onChange={(event) => setWant(event.target.value)} placeholder="예: 주황버섯 SSR 또는 제안" required value={want} />
          </label>
        ) : (
          <label className="wc-c2c__field">
            <span>시작가 (원)</span>
            <input inputMode="numeric" min={BID_STEP} onChange={(event) => setStart(event.target.value)} placeholder="5000" required step={BID_STEP} type="number" value={start} />
          </label>
        )}
        <p className="wc-c2c__caption">{kind === '경매' ? '경매는 등록 시점부터 24시간 뒤 마감돼요(시연).' : '제안이 오면 알림함에서 수락·거절해요(시연).'}</p>
        <div className="wc-c2c__dialog-actions">
          <WcButton onClick={onClose}>취소</WcButton>
          <WcButton disabled={!valid} type="submit" variant="primary">등록</WcButton>
        </div>
      </form>
    </DemoDialog>
  );
}
