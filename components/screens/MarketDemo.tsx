'use client';

import { useState, type FormEvent } from 'react';
import { DemoDialog } from '@/components/secondary-market-demo/DemoDialog';
import { DemoNotice } from '@/components/secondary-market-demo/DemoNotice';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { Badge } from '@/components/wc/Badge';
import { EmptyState } from '@/components/wc/EmptyState';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { WcButton } from '@/components/wc/WcButton';
import { DATA, type Ip } from '@/lib/data';
import { krw } from '@/lib/format';
import { ipAccentInk } from '@/lib/ip-display';
import {
  ESCROW_STEPS,
  MARKET_FEE_RATE,
  MARKET_LISTINGS,
  sellerPayout,
  type ListingCondition,
  type MarketListing,
} from '@/lib/secondary-market-demo';

/* 굿즈 마켓(굿즈 C2C) 스태프 전용 시연 — lib/secondary-market-demo.ts 주석 참고.
 * White Catalog 카탈로그 문법(상품 그리드·배지·가격 블록) 위에 옛 프로토타입의 에스크로 흐름을
 * 되살렸다. 매물 목록·에스크로 보관·판매 등록은 전부 이 컴포넌트의 로컬 상태다 — 새로고침하면
 * mock 초기값으로 돌아오고, 서버·DB·PG 는 어떤 경로로도 호출되지 않는다. */

const CONDITIONS: ListingCondition[] = ['미개봉', '미사용', 'A급', 'B급', '개봉/전시'];
const MY_SELLER = 'me';

type Dialog = { type: 'buy'; listing: MarketListing } | { type: 'sell' } | null;

const sellerLabel = (seller: string) => (seller === MY_SELLER ? '내 매물' : `@${seller}`);

export function MarketDemo() {
  const [ipFilter, setIpFilter] = useState('all');
  const [listings, setListings] = useState<MarketListing[]>(MARKET_LISTINGS);
  const [inEscrow, setInEscrow] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog>(null);

  const ipsById = new Map(DATA.IPS.map((ip) => [ip.id, ip]));
  const ipsWithItems = DATA.IPS.filter((ip) => listings.some((listing) => listing.ip === ip.id));
  const list = listings.filter((listing) => ipFilter === 'all' || listing.ip === ipFilter);

  const closeDialog = () => setDialog(null);
  const holdInEscrow = (id: string) => setInEscrow((prev) => new Set(prev).add(id));
  const addListing = (listing: MarketListing) => {
    setListings((prev) => [listing, ...prev]);
    setIpFilter('all');
    closeDialog();
  };

  return (
    <div className="wc-root">
      <div className="wc-container wc-c2c">
        <DemoNotice />

        <header className="wc-c2c__head">
          <SectionHeading
            as="h1"
            subcopy="검수센터를 거친 정품 굿즈만 올라와요. 결제는 에스크로로, 정산은 검수 통과 후에."
            title="중고 마켓"
          />
          <div className="wc-c2c__head-cta">
            <WcButton onClick={() => setDialog({ type: 'sell' })} variant="primary">판매 등록</WcButton>
            <p className="wc-c2c__caption">판매 대금은 구매자 수령 확정 후 정산</p>
          </div>
        </header>

        <div aria-label="IP 필터" className="wc-c2c__filters" role="group">
          <button aria-pressed={ipFilter === 'all'} className="wc-c2c__chip" onClick={() => setIpFilter('all')} type="button">
            전체 IP
          </button>
          {ipsWithItems.map((ip) => (
            <button
              key={ip.id}
              aria-pressed={ipFilter === ip.id}
              className="wc-c2c__chip"
              onClick={() => setIpFilter(ip.id)}
              type="button"
            >
              {ip.title}
            </button>
          ))}
        </div>
        <p className="wc-c2c__count">매물 <strong>{list.length}</strong>개</p>

        {list.length > 0 ? (
          <ul className="wc-product-grid">
            {list.map((listing) => (
              <li key={listing.id}>
                <ListingCard
                  escrow={inEscrow.has(listing.id)}
                  ip={ipsById.get(listing.ip)}
                  listing={listing}
                  onBuy={() => setDialog({ type: 'buy', listing })}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState description="다른 IP를 보거나 첫 매물을 등록해 보세요" title="이 IP의 매물이 아직 없어요" />
        )}

        <section aria-labelledby="c2c-trust" className="wc-c2c__trust">
          <SectionHeading id="c2c-trust" title="안전 거래 프로세스" />
          <ol className="wc-c2c__steps">
            {ESCROW_STEPS.map((step) => (
              <li key={step.no} className="wc-c2c__step">
                <span className="wc-c2c__step-no">{step.no}</span>
                <strong className="wc-c2c__step-title">{step.title}</strong>
                <p className="wc-c2c__step-desc">{step.desc}</p>
              </li>
            ))}
          </ol>
          <p className="wc-c2c__caption">
            검수·정산·분쟁 처리 정책과 수수료는 마켓 정식 오픈 시 확정·공지됩니다. 화면의 수수료는 시연용 예시입니다.
          </p>
        </section>
      </div>

      {dialog?.type === 'buy' && (
        <OverlayPortal>
          <PurchaseDialog
            ip={ipsById.get(dialog.listing.ip)}
            listing={dialog.listing}
            onClose={closeDialog}
            onComplete={() => holdInEscrow(dialog.listing.id)}
          />
        </OverlayPortal>
      )}
      {dialog?.type === 'sell' && (
        <OverlayPortal>
          <SellDialog onClose={closeDialog} onSubmit={addListing} />
        </OverlayPortal>
      )}
    </div>
  );
}

function ListingCard({
  escrow,
  ip,
  listing,
  onBuy,
}: {
  escrow: boolean;
  ip: Ip | undefined;
  listing: MarketListing;
  onBuy: () => void;
}) {
  return (
    <article className="wc-product-card wc-c2c__item">
      <div className="wc-product-card__media">
        <div className="wc-product-card__image" style={{ background: listing.bg }} />
        <div className="wc-c2c__item-badges">
          <Badge variant="outline">{listing.cond}</Badge>
          {listing.verified ? <Badge>검수완료</Badge> : <Badge variant="outline">검수 대기</Badge>}
        </div>
        {escrow ? <div className="wc-product-card__soldout"><span>거래 중</span></div> : null}
      </div>
      <div className="wc-product-card__info">
        {ip ? <p className="wc-product-card__brand" style={{ color: ipAccentInk(ip) }}>{ip.title}</p> : null}
        <h3 className="wc-product-card__name">{listing.name}</h3>
        <div className="wc-c2c__item-meta">
          <span>{listing.type}</span>
          <span>{sellerLabel(listing.seller)}</span>
        </div>
        <PriceBlock price={listing.price} />
        <div className="wc-c2c__item-action">
          {escrow ? (
            <WcButton disabled>에스크로 보관 중</WcButton>
          ) : (
            <WcButton onClick={onBuy} variant="primary">에스크로 구매</WcButton>
          )}
        </div>
      </div>
    </article>
  );
}

/* 에스크로 구매 — 검토 → 결제(시연) → 보관 완료. 금액은 화면에만 존재한다. */
export function PurchaseDialog({
  ip,
  listing,
  onClose,
  onComplete,
}: {
  ip: Ip | undefined;
  listing: MarketListing;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [done, setDone] = useState(false);
  const feePercent = Math.round(MARKET_FEE_RATE * 100);

  return (
    <DemoDialog onClose={onClose} title={done ? '에스크로 보관 완료' : '에스크로 구매'}>
      <div className="wc-c2c__summary">
        <div aria-hidden className="wc-c2c__summary-thumb" style={{ background: listing.bg }} />
        <div className="wc-c2c__summary-body">
          {ip ? <p className="wc-c2c__summary-brand" style={{ color: ipAccentInk(ip) }}>{ip.title}</p> : null}
          <p className="wc-c2c__summary-name">{listing.name}</p>
          <p className="wc-c2c__summary-meta">{listing.cond} · {sellerLabel(listing.seller)}</p>
        </div>
      </div>

      {done ? (
        <div className="wc-c2c__done">
          <span aria-hidden className="wc-c2c__done-mark">✓</span>
          <p className="wc-c2c__done-title">{krw(listing.price)}이 에스크로에 보관됐어요</p>
          <p className="wc-c2c__done-desc">검수센터 검수를 통과하면 배송이 시작되고, 수령을 확정하면 판매자에게 정산돼요.</p>
          <ol className="wc-c2c__timeline">
            <li className="is-done">결제 완료 · 에스크로 보관</li>
            <li className="is-active">검수센터 검수 중</li>
            <li>배송 · 수령 확정</li>
            <li>판매자 정산</li>
          </ol>
          <div className="wc-c2c__dialog-actions">
            <WcButton onClick={onClose} variant="primary">확인</WcButton>
          </div>
        </div>
      ) : (
        <>
          <dl className="wc-c2c__rows">
            <div className="wc-c2c__row"><dt>상품 금액</dt><dd>{krw(listing.price)}</dd></div>
            <div className="wc-c2c__row is-total"><dt>에스크로 결제 금액</dt><dd>{krw(listing.price)}</dd></div>
            <div className="wc-c2c__row is-muted">
              <dt>판매자 정산 예정액 · 예시 수수료 {feePercent}% 차감</dt>
              <dd>{krw(sellerPayout(listing.price))}</dd>
            </div>
          </dl>
          <ol className="wc-c2c__timeline">
            {ESCROW_STEPS.map((step, index) => (
              <li key={step.no} className={index === 1 ? 'is-active' : undefined}>{step.title}</li>
            ))}
          </ol>
          <p className="wc-c2c__caption">시연 결제예요. 실제 PG 호출·대금 이동 없이 화면 상태만 바뀝니다.</p>
          <div className="wc-c2c__dialog-actions">
            <WcButton onClick={onClose}>취소</WcButton>
            <WcButton
              onClick={() => {
                onComplete();
                setDone(true);
              }}
              variant="primary"
            >
              에스크로로 결제
            </WcButton>
          </div>
        </>
      )}
    </DemoDialog>
  );
}

/* 판매 등록 — 제출하면 목록 맨 앞에 "검수 대기" 매물로 얹힌다. */
export function SellDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (listing: MarketListing) => void;
}) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState(DATA.IPS[0]?.id ?? '');
  const [type, setType] = useState<string>(DATA.GOODS_TYPES[0] ?? '');
  const [cond, setCond] = useState<ListingCondition>('미개봉');
  const [price, setPrice] = useState('');
  const amount = Number(price);
  const valid = name.trim().length > 0 && Number.isFinite(amount) && amount > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const source = DATA.IPS.find((candidate) => candidate.id === ip);
    onSubmit({
      id: `demo-${Date.now()}`,
      name: name.trim(),
      ip,
      type,
      price: amount,
      cond,
      seller: MY_SELLER,
      verified: false,
      bg: source?.bg ?? 'var(--wc-surface-grey-2)',
    });
  };

  return (
    <DemoDialog onClose={onClose} title="판매 등록">
      <form className="wc-c2c__form" onSubmit={submit}>
        <label className="wc-c2c__field">
          <span>상품명</span>
          <input onChange={(event) => setName(event.target.value)} placeholder="예: 리락쿠마 낮잠 쿠션 (미개봉)" required value={name} />
        </label>
        <label className="wc-c2c__field">
          <span>IP</span>
          <select onChange={(event) => setIp(event.target.value)} value={ip}>
            {DATA.IPS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
          </select>
        </label>
        <div className="wc-c2c__field-row">
          <label className="wc-c2c__field">
            <span>종류</span>
            <select onChange={(event) => setType(event.target.value)} value={type}>
              {DATA.GOODS_TYPES.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
            </select>
          </label>
          <label className="wc-c2c__field">
            <span>상태</span>
            <select onChange={(event) => setCond(event.target.value as ListingCondition)} value={cond}>
              {CONDITIONS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
            </select>
          </label>
        </div>
        <label className="wc-c2c__field">
          <span>희망가 (원)</span>
          <input inputMode="numeric" min={1000} onChange={(event) => setPrice(event.target.value)} placeholder="30000" required step={1000} type="number" value={price} />
        </label>
        <p className="wc-c2c__caption">등록 후 검수센터 입고 안내를 받아요. 검수 통과 전에는 &quot;검수 대기&quot;로 노출됩니다.</p>
        <div className="wc-c2c__dialog-actions">
          <WcButton onClick={onClose}>취소</WcButton>
          <WcButton disabled={!valid} type="submit" variant="primary">등록</WcButton>
        </div>
      </form>
    </DemoDialog>
  );
}
