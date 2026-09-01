'use client';

/*
 * Throwaway prototype question:
 * captured commerce-detail modules를 ICONS의 실제 굿즈 데이터와 장바구니 계약에만
 * 연결했을 때, 어떤 정보 구조가 메인 프로토타입과 가장 자연스럽게 이어지는가?
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useCart } from '@/components/shell/CartProvider';
import type { CatalogGoodDetail } from '@/lib/catalog';
import { krw, krwAmountWords } from '@/lib/format';
import { STOCK_LABEL } from '@/lib/goods-display';
import { goodsNoticeRows } from '@/lib/goods-notice';
import { LEGAL_DOCUMENT_LABELS, legalDocumentHref } from '@/lib/legal/links';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from '@/lib/shipping';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import { StorefrontChrome } from './StorefrontChrome';
import type { PrototypeVariant } from './variants';

interface PurchaseState {
  addSelected: (destination?: 'stay' | 'cart') => Promise<void>;
  blocked: boolean;
  cartQuantity: number;
  error: string | null;
  pending: boolean;
  quantity: number;
  ready: boolean;
  remaining: number;
  setQuantity: Dispatch<SetStateAction<number>>;
  soldOut: boolean;
  status: string;
}

interface ProductHeadingProps {
  detail: CatalogGoodDetail;
  onShare: () => Promise<void>;
  onToggleWish: () => void;
  variant: PrototypeVariant;
  wished: boolean;
}

interface PurchasePanelProps {
  detail: CatalogGoodDetail;
  idPrefix: string;
  model: PurchaseState;
  showCartLink?: boolean;
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function variantHref(pathname: string, variant: PrototypeVariant) {
  return `${pathname}?variant=${variant}`;
}

function ProductHeading({ detail, onShare, onToggleWish, variant, wished }: ProductHeadingProps) {
  const { good, ip } = detail;
  const stockLabel = STOCK_LABEL[good.stock] ?? '판매 중';

  return (
    <div className="lfp-detail__heading">
      <div className="lfp-detail__eyebrow-row">
        {ip ? (
          <Link className="lfp-detail__ip-link" href={variantHref(`/ip/${ip.id}`, variant)}>
            {ip.title}
          </Link>
        ) : (
          <span className="lfp-detail__ip-link">ICONS</span>
        )}
        {good.badge ? <span className="lfp-detail__badge">{good.badge}</span> : null}
        <span className={`lfp-detail__stock lfp-detail__stock--${good.stock}`}>{stockLabel}</span>
      </div>

      <h1>{good.name}</h1>
      <p className="lfp-detail__type">{good.type}</p>

      <div className="lfp-detail__price-row">
        <strong>{krw(good.price)}</strong>
        <div className="lfp-detail__utility-actions" aria-label="굿즈 보조 기능">
          <button
            aria-label={wished ? `${good.name} 찜 해제` : `${good.name} 찜하기`}
            aria-pressed={wished}
            className="lfp-detail__icon-button"
            onClick={onToggleWish}
            type="button"
          >
            <span aria-hidden>{wished ? '♥' : '♡'}</span>
          </button>
          <button
            aria-label={`${good.name} 공유`}
            className="lfp-detail__icon-button"
            onClick={() => void onShare()}
            type="button"
          >
            <span aria-hidden>↗</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function QuantityControl({ idPrefix, model }: { idPrefix: string; model: PurchaseState }) {
  const maxSelectable = Math.max(1, model.remaining);

  return (
    <div className="lfp-detail__quantity-row">
      <span id={`${idPrefix}-quantity-label`}>수량</span>
      <div
        aria-labelledby={`${idPrefix}-quantity-label`}
        className="lfp-detail__stepper"
        role="group"
      >
        <button
          aria-label="수량 줄이기"
          disabled={model.blocked || model.quantity <= 1}
          onClick={() => model.setQuantity((current) => Math.max(1, current - 1))}
          type="button"
        >
          −
        </button>
        <output aria-live="polite">{model.quantity}</output>
        <button
          aria-label="수량 늘리기"
          disabled={model.blocked || model.quantity >= maxSelectable}
          onClick={() => model.setQuantity((current) => Math.min(maxSelectable, current + 1))}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}

function PurchasePanel({ detail, idPrefix, model, showCartLink = false }: PurchasePanelProps) {
  const { good } = detail;

  return (
    <div className="lfp-detail__purchase-panel">
      <label className="lfp-detail__composition" htmlFor={`${idPrefix}-composition`}>
        <span>구성</span>
        <select id={`${idPrefix}-composition`} value={good.id} onChange={() => undefined}>
          <option value={good.id}>{good.name} · 1개</option>
        </select>
      </label>

      <QuantityControl idPrefix={idPrefix} model={model} />

      {model.cartQuantity > 0 ? (
        <p className="lfp-detail__cart-count">장바구니에 {model.cartQuantity}개 담겨 있습니다.</p>
      ) : null}

      <div className="lfp-detail__total">
        <span>총 금액</span>
        <strong>{krw(good.price * model.quantity)}</strong>
      </div>

      <div className="lfp-detail__purchase-actions">
        <button
          className="lfp-detail__button lfp-detail__button--outline"
          disabled={model.blocked}
          onClick={() => void model.addSelected('stay')}
          type="button"
        >
          {model.soldOut ? '품절' : model.pending ? '저장 중' : !model.ready ? '준비 중' : '장바구니에 담기'}
        </button>
        <button
          className="lfp-detail__button lfp-detail__button--solid"
          disabled={model.blocked}
          onClick={() => void model.addSelected('cart')}
          type="button"
        >
          {model.soldOut ? '품절' : '구매하기'}
        </button>
      </div>

      {showCartLink && model.cartQuantity > 0 ? (
        <Link className="lfp-detail__cart-link" href="/cart">
          장바구니 보기
        </Link>
      ) : null}

      <p className="lfp-detail__shipping-summary">
        배송비 {krwAmountWords(SHIPPING_FEE)} · {krwAmountWords(FREE_SHIPPING_THRESHOLD)} 이상 무료
      </p>
      <p aria-live="polite" className="lfp-detail__status" role="status">{model.status}</p>
      {model.error ? <p className="lfp-detail__error" role="alert">{model.error}</p> : null}
    </div>
  );
}

function MediaGallery({
  detail,
  frames,
  mode,
  onSelect,
  stageIndex,
}: {
  detail: CatalogGoodDetail;
  frames: string[];
  mode: 'square' | 'editorial' | 'compact';
  onSelect: (index: number) => void;
  stageIndex: number;
}) {
  const selectedFrame = frames[stageIndex] ?? detail.good.img;

  return (
    <div className={`lfp-detail__media lfp-detail__media--${mode}`}>
      <div
        aria-label={`${detail.good.name} 이미지 ${stageIndex + 1}`}
        className="lfp-detail__stage"
        role="img"
        style={{ background: selectedFrame, backgroundPosition: 'center', backgroundSize: 'cover' }}
      />

      {frames.length > 1 ? (
        <div className="lfp-detail__thumbs" role="group" aria-label="굿즈 이미지 선택">
          {frames.map((frame, index) => (
            <button
              aria-current={index === stageIndex ? 'true' : undefined}
              aria-label={index === 0 ? '대표 이미지 보기' : `갤러리 이미지 ${index} 보기`}
              className="lfp-detail__thumb"
              key={`${detail.good.id}-${index}`}
              onClick={() => onSelect(index)}
              style={{ background: frame, backgroundPosition: 'center', backgroundSize: 'cover' }}
              type="button"
            />
          ))}
        </div>
      ) : null}

      {frames.length > 1 ? (
        <div className="lfp-detail__dots" role="group" aria-label="모바일 굿즈 이미지 선택">
          {frames.map((_, index) => (
            <button
              aria-current={index === stageIndex ? 'true' : undefined}
              aria-label={index === 0 ? '대표 이미지 보기' : `갤러리 이미지 ${index} 보기`}
              className={index === stageIndex ? 'is-active' : ''}
              key={index}
              onClick={() => onSelect(index)}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BrandCard({ detail, variant }: { detail: CatalogGoodDetail; variant: PrototypeVariant }) {
  const { ip } = detail;

  if (!ip) {
    return (
      <section className="lfp-detail__brand-card lfp-detail__brand-card--empty" aria-label="IP 안내">
        <div>
          <span>ICONS CURATION</span>
          <strong>연결된 IP 정보가 없습니다.</strong>
        </div>
      </section>
    );
  }

  return (
    <Link
      className="lfp-detail__brand-card"
      href={variantHref(`/ip/${ip.id}`, variant)}
      style={{ background: ip.bg, backgroundPosition: 'center', backgroundSize: 'cover' }}
    >
      <span className="lfp-detail__brand-shade" aria-hidden />
      <div>
        <span>{ip.sub}</span>
        <strong>{ip.title}</strong>
        <p>{ip.tagline}</p>
      </div>
      <b aria-hidden>→</b>
    </Link>
  );
}

function DetailTabs() {
  return (
    <nav className="lfp-detail__tabs" aria-label="굿즈 상세 정보">
      <a href="#lfp-detail-description">상세설명</a>
      <a href="#lfp-detail-reviews">리뷰</a>
      <a href="#lfp-detail-qna">Q&amp;A</a>
      <a href="#lfp-detail-extra">추가정보</a>
    </nav>
  );
}

function DescriptionContent({ detail }: { detail: CatalogGoodDetail }) {
  return (
    <section className="lfp-detail__content-section" id="lfp-detail-description">
      <span className="lfp-detail__section-kicker">DETAIL</span>
      <h2>상세설명</h2>
      {detail.description ? (
        <p className="lfp-detail__description">{detail.description}</p>
      ) : (
        <p className="lfp-detail__empty-copy">아직 등록된 상세 설명이 없습니다.</p>
      )}
      {detail.detailImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${detail.good.name} 상세 이미지`}
          className="lfp-detail__long-image"
          src={detail.detailImageUrl}
        />
      ) : null}
    </section>
  );
}

function EmptyCommunitySections() {
  return (
    <>
      <section className="lfp-detail__content-section lfp-detail__empty-section" id="lfp-detail-reviews">
        <span className="lfp-detail__section-kicker">REVIEW</span>
        <h2>리뷰</h2>
        <p>아직 작성된 리뷰가 없습니다.</p>
      </section>
      <section className="lfp-detail__content-section lfp-detail__empty-section" id="lfp-detail-qna">
        <span className="lfp-detail__section-kicker">Q&amp;A</span>
        <h2>Q&amp;A</h2>
        <p>아직 등록된 문의가 없습니다.</p>
      </section>
    </>
  );
}

function NoticeTable({ detail }: { detail: CatalogGoodDetail }) {
  const rows = goodsNoticeRows(detail.notice);

  return (
    <div className="lfp-detail__notice-block">
      <h3>고시정보</h3>
      {rows.length ? (
        <table>
          <caption>전자상거래법에 따라 표시하는 상품정보제공고시 항목입니다.</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="lfp-detail__empty-copy">아직 등록된 고시정보가 없습니다. 판매 시작 전에 등록됩니다.</p>
      )}
    </div>
  );
}

function ShippingAndReturns({ detail }: { detail: CatalogGoodDetail }) {
  return (
    <section className="lfp-detail__content-section" id="lfp-detail-extra">
      <span className="lfp-detail__section-kicker">INFORMATION</span>
      <h2>추가정보</h2>
      <NoticeTable detail={detail} />
      <div className="lfp-detail__policy-grid">
        <article>
          <h3>배송 안내</h3>
          <ul>
            <li>배송비 {krwAmountWords(SHIPPING_FEE)} · {krwAmountWords(FREE_SHIPPING_THRESHOLD)} 이상 구매 시 무료</li>
            <li>결제가 확정된 날부터 3영업일 이내에 배송에 필요한 조치를 취합니다.</li>
            <li>도서산간 지역은 추가 배송비와 배송 일정이 별도 안내됩니다.</li>
          </ul>
        </article>
        <article>
          <h3>교환 · 반품 안내</h3>
          <ul>
            <li>굿즈를 받은 날부터 7일 이내에 청약철회를 신청할 수 있습니다.</li>
            <li>단순 변심 반품의 반송비는 구매자가 부담합니다.</li>
            <li>파손·오배송된 굿즈의 반송비는 ICONS가 부담합니다.</li>
          </ul>
          <Link href={legalDocumentHref('shipping')}>{LEGAL_DOCUMENT_LABELS.shipping} 전문 보기 →</Link>
        </article>
      </div>
    </section>
  );
}

function RelatedEmptyState({ detail, variant }: { detail: CatalogGoodDetail; variant: PrototypeVariant }) {
  return (
    <section className="lfp-detail__related-empty" aria-labelledby="lfp-detail-related-title">
      <div>
        <span className="lfp-detail__section-kicker">RELATED GOODS</span>
        <h2 id="lfp-detail-related-title">함께 볼 굿즈</h2>
        <p>현재 상세 데이터에는 연결된 다른 굿즈가 없습니다.</p>
      </div>
      {detail.ip ? (
        <Link href={variantHref(`/ip/${detail.ip.id}`, variant)}>{detail.ip.title} 더 보기 →</Link>
      ) : (
        <Link href={variantHref('/', variant)}>메인으로 돌아가기 →</Link>
      )}
    </section>
  );
}

function LongDetail({ detail, variant }: { detail: CatalogGoodDetail; variant: PrototypeVariant }) {
  return (
    <>
      <DescriptionContent detail={detail} />
      <EmptyCommunitySections />
      <ShippingAndReturns detail={detail} />
      <RelatedEmptyState detail={detail} variant={variant} />
    </>
  );
}

function StickyBuyDock({ detail, model }: { detail: CatalogGoodDetail; model: PurchaseState }) {
  return (
    <aside className="lfp-detail__buy-dock" aria-label="구매 요약">
      <p>{detail.good.name}</p>
      <QuantityControl idPrefix="lfp-dock" model={model} />
      <div className="lfp-detail__total">
        <span>총 금액</span>
        <strong>{krw(detail.good.price * model.quantity)}</strong>
      </div>
      <div className="lfp-detail__purchase-actions">
        <button
          aria-label={`${detail.good.name} 장바구니에 담기`}
          className="lfp-detail__button lfp-detail__button--outline lfp-detail__button--icon"
          disabled={model.blocked}
          onClick={() => void model.addSelected('stay')}
          type="button"
        >
          <span aria-hidden>＋</span>
        </button>
        <button
          className="lfp-detail__button lfp-detail__button--solid"
          disabled={model.blocked}
          onClick={() => void model.addSelected('cart')}
          type="button"
        >
          {model.soldOut ? '품절' : '구매하기'}
        </button>
      </div>
    </aside>
  );
}

function MobilePurchase({
  detail,
  model,
  onClose,
  onOpen,
  open,
}: {
  detail: CatalogGoodDetail;
  model: PurchaseState;
  onClose: () => void;
  onOpen: () => void;
  open: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trigger = triggerRef.current;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
      const first = focusables[0];
      const last = focusables.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      (previousFocus ?? trigger)?.focus();
    };
  }, [onClose, open]);

  return (
    <>
      <div className="lfp-detail__mobile-bar">
        <button aria-label="장바구니로 이동" onClick={() => router.push('/cart')} type="button">
          <span aria-hidden>▢</span>
          {model.cartQuantity > 0 ? <b>{model.cartQuantity}</b> : null}
        </button>
        <button
          className="lfp-detail__mobile-buy"
          disabled={model.soldOut}
          onClick={onOpen}
          ref={triggerRef}
          type="button"
        >
          {model.soldOut ? '품절' : '구매하기'}
        </button>
      </div>

      {open ? (
        <div
          className="lfp-detail__sheet-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) onClose();
          }}
        >
          <div
            aria-labelledby="lfp-mobile-sheet-title"
            aria-modal="true"
            className="lfp-detail__sheet"
            ref={dialogRef}
            role="dialog"
          >
            <div className="lfp-detail__sheet-heading">
              <h2 id="lfp-mobile-sheet-title">{detail.good.name}</h2>
              <button aria-label="구매 창 닫기" onClick={onClose} ref={closeRef} type="button">×</button>
            </div>
            <PurchasePanel detail={detail} idPrefix="lfp-mobile" model={model} showCartLink />
          </div>
        </div>
      ) : null}
    </>
  );
}

function SquareVariant({
  detail,
  frames,
  model,
  onSelectFrame,
  onShare,
  onToggleWish,
  stageIndex,
  variant,
  wished,
}: VariantLayoutProps) {
  return (
    <div className="lfp-detail lfp-detail--a">
      <div className="lfp-detail__wrap">
        <Link className="lfp-detail__return" href={variantHref('/', variant)}>← 메인으로</Link>
        <div className="lfp-detail__hero lfp-detail__hero--square">
          <MediaGallery detail={detail} frames={frames} mode="square" onSelect={onSelectFrame} stageIndex={stageIndex} />
          <section className="lfp-detail__summary">
            <ProductHeading detail={detail} onShare={onShare} onToggleWish={onToggleWish} variant={variant} wished={wished} />
            <div className="lfp-detail__desktop-purchase">
              <PurchasePanel detail={detail} idPrefix="lfp-a" model={model} />
            </div>
            <BrandCard detail={detail} variant={variant} />
          </section>
        </div>
      </div>

      <DetailTabs />
      <div className="lfp-detail__content-layout lfp-detail__wrap">
        <article className="lfp-detail__longform">
          <LongDetail detail={detail} variant={variant} />
        </article>
        <StickyBuyDock detail={detail} model={model} />
      </div>
    </div>
  );
}

function GalleryVariant({
  detail,
  frames,
  model,
  onSelectFrame,
  onShare,
  onToggleWish,
  stageIndex,
  variant,
  wished,
}: VariantLayoutProps) {
  return (
    <div className="lfp-detail lfp-detail--b">
      <div className="lfp-detail__wrap lfp-detail__gallery-return">
        <Link className="lfp-detail__return" href={variantHref('/', variant)}>← 메인으로</Link>
      </div>

      <section className="lfp-detail__gallery-lead">
        <MediaGallery detail={detail} frames={frames} mode="editorial" onSelect={onSelectFrame} stageIndex={stageIndex} />
      </section>

      <div className="lfp-detail__gallery-summary lfp-detail__wrap">
        <ProductHeading detail={detail} onShare={onShare} onToggleWish={onToggleWish} variant={variant} wished={wished} />
        <div className="lfp-detail__desktop-purchase">
          <PurchasePanel detail={detail} idPrefix="lfp-b" model={model} />
        </div>
      </div>

      <DetailTabs />
      <div className="lfp-detail__content-layout lfp-detail__content-layout--gallery lfp-detail__wrap">
        <article className="lfp-detail__longform">
          <DescriptionContent detail={detail} />
          <BrandCard detail={detail} variant={variant} />
          <EmptyCommunitySections />
          <ShippingAndReturns detail={detail} />
          <RelatedEmptyState detail={detail} variant={variant} />
        </article>
        <StickyBuyDock detail={detail} model={model} />
      </div>
    </div>
  );
}

function CompactAccordions({ detail, variant }: { detail: CatalogGoodDetail; variant: PrototypeVariant }) {
  return (
    <div className="lfp-detail__accordions">
      <details id="lfp-detail-description" open>
        <summary>상세설명 <span aria-hidden>＋</span></summary>
        <div className="lfp-detail__accordion-body">
          {detail.description ? <p className="lfp-detail__description">{detail.description}</p> : <p>아직 등록된 상세 설명이 없습니다.</p>}
          {detail.detailImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={`${detail.good.name} 상세 이미지`} className="lfp-detail__long-image" src={detail.detailImageUrl} />
          ) : null}
        </div>
      </details>
      <details id="lfp-detail-reviews">
        <summary>리뷰 <span aria-hidden>＋</span></summary>
        <div className="lfp-detail__accordion-body"><p>아직 작성된 리뷰가 없습니다.</p></div>
      </details>
      <details id="lfp-detail-qna">
        <summary>Q&amp;A <span aria-hidden>＋</span></summary>
        <div className="lfp-detail__accordion-body"><p>아직 등록된 문의가 없습니다.</p></div>
      </details>
      <details id="lfp-detail-extra">
        <summary>추가정보 <span aria-hidden>＋</span></summary>
        <div className="lfp-detail__accordion-body">
          <NoticeTable detail={detail} />
          <div className="lfp-detail__policy-grid">
            <article>
              <h3>배송 안내</h3>
              <p>배송비 {krwAmountWords(SHIPPING_FEE)} · {krwAmountWords(FREE_SHIPPING_THRESHOLD)} 이상 구매 시 무료</p>
            </article>
            <article>
              <h3>교환 · 반품 안내</h3>
              <p>굿즈를 받은 날부터 7일 이내에 청약철회를 신청할 수 있습니다.</p>
              <Link href={legalDocumentHref('shipping')}>{LEGAL_DOCUMENT_LABELS.shipping} 전문 보기 →</Link>
            </article>
          </div>
        </div>
      </details>
      <BrandCard detail={detail} variant={variant} />
      <RelatedEmptyState detail={detail} variant={variant} />
    </div>
  );
}

function CompactVariant({
  detail,
  frames,
  model,
  onSelectFrame,
  onShare,
  onToggleWish,
  stageIndex,
  variant,
  wished,
}: VariantLayoutProps) {
  return (
    <div className="lfp-detail lfp-detail--c">
      <div className="lfp-detail__wrap">
        <Link className="lfp-detail__return" href={variantHref('/', variant)}>← 메인으로</Link>
        <div className="lfp-detail__hero lfp-detail__hero--compact">
          <section className="lfp-detail__summary">
            <ProductHeading detail={detail} onShare={onShare} onToggleWish={onToggleWish} variant={variant} wished={wished} />
            <div className="lfp-detail__desktop-purchase">
              <PurchasePanel detail={detail} idPrefix="lfp-c" model={model} />
            </div>
          </section>
          <MediaGallery detail={detail} frames={frames} mode="compact" onSelect={onSelectFrame} stageIndex={stageIndex} />
        </div>
      </div>
      <DetailTabs />
      <div className="lfp-detail__compact-content lfp-detail__wrap">
        <CompactAccordions detail={detail} variant={variant} />
      </div>
    </div>
  );
}

interface VariantLayoutProps {
  detail: CatalogGoodDetail;
  frames: string[];
  model: PurchaseState;
  onSelectFrame: (index: number) => void;
  onShare: () => Promise<void>;
  onToggleWish: () => void;
  stageIndex: number;
  variant: PrototypeVariant;
  wished: boolean;
}

const VARIANT_LAYOUTS: Record<PrototypeVariant, (props: VariantLayoutProps) => ReactNode> = {
  A: SquareVariant,
  B: GalleryVariant,
  C: CompactVariant,
};

export function LineFriendsGoodDetailPrototype({
  detail,
  variant,
}: {
  detail: CatalogGoodDetail;
  variant: PrototypeVariant;
}) {
  const router = useRouter();
  const { error, getQuantity, pending, ready, setQuantity: setCartQuantity } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [stageIndex, setStageIndex] = useState(0);
  const [wished, setWished] = useState(false);
  const [status, setStatus] = useState('');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const closeMobileSheet = useCallback(() => setMobileSheetOpen(false), []);
  const openMobileSheet = useCallback(() => setMobileSheetOpen(true), []);
  const frames = useMemo(() => [detail.good.img, ...detail.gallery], [detail.gallery, detail.good.img]);
  const cartQuantity = getQuantity(detail.good.id);
  const soldOut = detail.good.stock === 'soldout' || detail.good.stockQty <= 0;
  const remaining = Math.max(0, detail.good.stockQty - cartQuantity);
  const selectedQuantity = remaining > 0 ? Math.min(Math.max(1, quantity), remaining) : 1;
  const selectedStageIndex = Math.min(stageIndex, Math.max(0, frames.length - 1));
  const blocked = soldOut || remaining <= 0 || !ready || pending;
  const setSelectedQuantity: Dispatch<SetStateAction<number>> = (next) => {
    setQuantity((current) => {
      const safeCurrent = remaining > 0 ? Math.min(Math.max(1, current), remaining) : 1;
      const candidate = typeof next === 'function' ? next(safeCurrent) : next;
      return remaining > 0 ? Math.min(Math.max(1, candidate), remaining) : 1;
    });
  };

  const addSelected = async (destination: 'stay' | 'cart' = 'stay') => {
    if (blocked) return;
    const saved = await setCartQuantity(
      detail.good.id,
      cartQuantity + selectedQuantity,
      detail.good.stockQty,
    );
    if (!saved) {
      setStatus('장바구니에 반영하지 못했습니다. 다시 시도해주세요.');
      return;
    }
    setStatus(`${detail.good.name} ${selectedQuantity}개를 장바구니에 반영했습니다.`);
    if (destination === 'cart') router.push('/cart');
  };

  const onShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: detail.good.name, url: window.location.href });
        setStatus('공유 메뉴를 열었습니다.');
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
      setStatus('현재 주소를 복사했습니다.');
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setStatus('주소를 복사하지 못했습니다. 브라우저 주소창에서 복사해주세요.');
    }
  };

  const onToggleWish = () => {
    setWished((current) => {
      setStatus(current ? '찜 표시를 해제했습니다.' : '이 화면에서만 찜 표시했습니다.');
      return !current;
    });
  };

  const model: PurchaseState = {
    addSelected,
    blocked,
    cartQuantity,
    error,
    pending,
    quantity: selectedQuantity,
    ready,
    remaining,
    setQuantity: setSelectedQuantity,
    soldOut,
    status,
  };
  const VariantLayout = VARIANT_LAYOUTS[variant];

  return (
    <StorefrontChrome currentPage="detail" variant={variant}>
      <VariantLayout
        detail={detail}
        frames={frames}
        model={model}
        onSelectFrame={setStageIndex}
        onShare={onShare}
        onToggleWish={onToggleWish}
        stageIndex={selectedStageIndex}
        variant={variant}
        wished={wished}
      />
      <MobilePurchase
        detail={detail}
        model={model}
        onClose={closeMobileSheet}
        onOpen={openMobileSheet}
        open={mobileSheetOpen}
      />
      <PrototypeSwitcher variant={variant} />
    </StorefrontChrome>
  );
}
