'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { krw, krwAmountWords } from '@/lib/format';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { STOCK_LABEL } from '@/lib/goods-display';
import { newInquiryHref } from '@/lib/inquiries';
import { goodsNoticeRows } from '@/lib/goods-notice';
import { ipAccent, ipAccentInk } from '@/lib/ip-display';
import { LEGAL_DOCUMENT_LABELS, legalDocumentHref } from '@/lib/legal/links';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from '@/lib/shipping';
import { AddToCartButton } from '@/components/shop/AddToCartButton';

const STOCK_TONE: Record<string, string> = {
  품절: 'var(--pink)',
  품절임박: 'var(--amber)',
  '판매 중': 'var(--mint)',
};

function StockBadge({ label }: { label: string }) {
  return (
    <span
      className="mono"
      style={{
        border: `1px solid ${STOCK_TONE[label] ?? 'var(--line-2)'}`,
        borderRadius: 999,
        color: STOCK_TONE[label] ?? 'var(--dim)',
        fontSize: 11,
        letterSpacing: '.08em',
        padding: '4px 10px',
      }}
    >
      {label}
    </span>
  );
}

function NoticeTable({ detail }: { detail: GoodDetailContent }) {
  const rows = goodsNoticeRows(detail.notice);

  return (
    <section aria-labelledby="goods-notice-heading" className="goods-detail-section">
      {/* 제목은 용어집(CONTEXT.md '고시정보')을 따른다. 어드민 폼·lib/goods-notice.ts 와 같은 말이어야
          운영자와 이용자가 같은 표를 다른 이름으로 부르지 않는다. */}
      <h2 className="mono" id="goods-notice-heading" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.16em', margin: 0 }}>
        고시정보
      </h2>
      {rows.length ? (
        <table className="goods-notice-table">
          {/* 법정 고시 제도의 이름은 제목이 아니라 표 캡션에서 각주처럼 밝힌다. */}
          <caption style={{ captionSide: 'top', color: 'var(--dim)', fontSize: 12, lineHeight: 1.7, paddingBottom: 10, textAlign: 'left' }}>
            전자상거래법에 따라 표시하는 상품정보제공고시 항목입니다.
          </caption>
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
        <p style={{ color: 'var(--dim)', fontSize: 13.5, margin: 0 }}>
          아직 등록된 고시정보가 없습니다. 판매 시작 전에 등록됩니다.
        </p>
      )}
    </section>
  );
}

function ShippingGuide() {
  return (
    <section aria-labelledby="goods-shipping-heading" className="goods-detail-section">
      <h2 className="mono" id="goods-shipping-heading" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.16em', margin: 0 }}>
        배송 안내
      </h2>
      <ul style={{ color: 'var(--dim)', display: 'grid', fontSize: 13.5, gap: 8, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
        <li>배송비 {krwAmountWords(SHIPPING_FEE)} · {krwAmountWords(FREE_SHIPPING_THRESHOLD)} 이상 구매 시 무료</li>
        {/*
         * 출고 기한의 진실원은 배송·반품 정책(/legal/shipping 1. 배송 안내)이다. 여기서 더 짧은
         * 영업일 수를 따로 적으면 약관 제13조 3항이 손해배상 기준으로 삼는 "약정 배송기간"이
         * 두 개가 되어, 어느 쪽이 약정인지 정할 수 없다. 그래서 정책 문장을 그대로 싣는다.
         * 창고 출고 마감·휴무일이 확정되면(계획 H4) 정책 문서와 함께 좁힌다.
         */}
        <li>대금을 먼저 지급하는 선지급 주문이므로, 결제가 확정된 날부터 3영업일 이내에 배송에 필요한 조치를 취합니다. 공급 절차가 늦어지면 그 진행 상황을 알립니다.</li>
        <li>도서산간 지역은 지역별 추가 배송비와 배송 일정이 별도 안내됩니다.</li>
      </ul>
    </section>
  );
}

function ReturnGuide() {
  return (
    <section aria-labelledby="goods-return-heading" className="goods-detail-section">
      <h2 className="mono" id="goods-return-heading" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.16em', margin: 0 }}>
        교환 · 반품 안내
      </h2>
      <ul style={{ color: 'var(--dim)', display: 'grid', fontSize: 13.5, gap: 8, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
        <li>굿즈를 받은 날부터 7일 이내에 청약철회를 신청할 수 있습니다.</li>
        <li>단순 변심으로 반품하는 경우 반송비는 구매자가 부담하며 착불로 보내주세요.</li>
        <li>굿즈가 파손·오배송된 경우에는 반송비를 ICONS가 부담합니다.</li>
        <li>사용·훼손해 재판매가 어려워진 굿즈는 청약철회가 제한될 수 있습니다.</li>
      </ul>
      {/* 요약만 두면 반송비 부담·반품 절차·환급 기한을 확인할 곳이 없다. 전문은 정책 문서가 진실원이다. */}
      <Link
        className="mono"
        href={legalDocumentHref('shipping')}
        style={{ alignSelf: 'flex-start', color: 'var(--dim)', fontSize: 12, letterSpacing: '.06em', textDecoration: 'underline' }}
      >
        {LEGAL_DOCUMENT_LABELS.shipping} 전문 보기
      </Link>
    </section>
  );
}

/*
 * 상품 문의 진입점(#253).
 *
 * 공개 브라우징을 깨지 않는다 — 링크는 비로그인에게도 보이고, 로그인은 문의 화면이
 * 요구한다. 여기서 감추면 "물어볼 데가 없는 상품"으로 보인다.
 */
function InquiryEntry({ goodId }: { goodId: string }) {
  return (
    <section aria-labelledby="goods-inquiry-heading" className="goods-detail-section">
      <h2 className="mono" id="goods-inquiry-heading" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.16em', margin: 0 }}>
        상품 문의
      </h2>
      <p style={{ color: 'var(--dim)', fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
        구성, 재고, 배송 일정처럼 이 굿즈에 대해 궁금한 점을 운영자에게 비공개로 물어볼 수 있습니다.
        영업일 기준 24시간 안에 첫 답변을 드립니다.
      </p>
      <Link className="btn btn-ghost" href={newInquiryHref({ category: 'good', goodId })} style={{ alignSelf: 'flex-start' }}>
        상품 문의하기
      </Link>
    </section>
  );
}

/*
 * 굿즈 상세 화면 (#173).
 *
 * 장바구니에 손대지 않는 순수 표시 컴포넌트다. 담기 버튼은 slot 으로 받는다 —
 * 어드민 미리보기(#184)가 같은 화면을 저장 전 입력값으로 그리면서 실제 장바구니는
 * 건드리지 않아야 하기 때문이다.
 */
export function GoodDetailView({
  cartAction,
  detail,
  embedded = false,
  reviews,
  showBackLink = true,
}: {
  cartAction: ReactNode;
  detail: GoodDetailContent;
  /** 어드민 미리보기처럼 다른 화면 안에 놓일 때. #root 캔버스를 건드리지 않는다. */
  embedded?: boolean;
  /**
   * 리뷰 블록(#254). 담기 버튼과 같은 이유로 slot이다 — 이 화면은 `'use client'`인데
   * 리뷰는 서버에서 읽어 서버에서 그린다. 어드민 미리보기는 저장 전 입력값으로
   * 화면을 그리므로 아무것도 넘기지 않는다(아직 존재하지 않는 굿즈에는 리뷰가 없다).
   */
  reviews?: ReactNode;
  showBackLink?: boolean;
}) {
  const { good, ip } = detail;
  const [stageIndex, setStageIndex] = useState(0);
  const frames = [good.img, ...detail.gallery];
  const stage = frames[Math.min(stageIndex, frames.length - 1)] ?? good.img;
  const stockLabel = STOCK_LABEL[good.stock] ?? '판매 중';
  const Root = embedded ? 'div' : 'main';

  return (
    <Root className={embedded ? 'goods-detail-scope' : 'goods-detail-page'}>
      <div className="wrap">
        {showBackLink && (
          <Link className="mono" href="/shop" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.1em', textDecoration: 'none' }}>
            ← 굿즈샵
          </Link>
        )}

        <div className="goods-detail-hero" style={{ marginTop: 18 }}>
          <div className="goods-detail-media">
            <div className="goods-detail-stage" style={{ background: stage, backgroundPosition: 'center', backgroundSize: 'cover' }}>
              <span aria-hidden className="sheen" style={{ opacity: 0.25 }} />
            </div>
            {frames.length > 1 && (
              <div className="goods-detail-thumbs" role="group" aria-label="굿즈 이미지">
                {frames.map((frame, index) => (
                  <button
                    aria-current={index === stageIndex ? 'true' : undefined}
                    aria-label={index === 0 ? '대표 이미지' : `갤러리 이미지 ${index}`}
                    className="goods-detail-thumb"
                    key={index}
                    onClick={() => setStageIndex(index)}
                    style={{ background: frame, backgroundPosition: 'center', backgroundSize: 'cover' }}
                    type="button"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="goods-detail-info">
            <div className="row" style={{ alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}>
              {ip && (
                <Link
                  className="mono"
                  href={`/ip/${ip.id}`}
                  style={{ color: ipAccentInk(ip), fontSize: 11, letterSpacing: '.14em', textDecoration: 'none', textTransform: 'uppercase' }}
                >
                  {ip.title}
                </Link>
              )}
              <StockBadge label={stockLabel} />
              {good.badge && (
                <span className="mono" style={{ border: `1px solid ${ip ? ipAccent(ip) : 'var(--line-2)'}`, borderRadius: 999, fontSize: 11, letterSpacing: '.08em', padding: '4px 10px' }}>
                  {good.badge}
                </span>
              )}
            </div>
            <h1 style={{ fontFamily: 'var(--ff-display)', fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-0.03em', lineHeight: 1.1, margin: 0 }}>
              {good.name}
            </h1>
            <span style={{ color: 'var(--dim)', fontSize: 13.5 }}>{good.type}</span>
            <strong className="mono" style={{ fontSize: 26 }}>{krw(good.price)}</strong>
            <div className="goods-detail-purchase">
              {cartAction}
              <span style={{ color: 'var(--dim)', fontSize: 12.5 }}>
                배송비 {krwAmountWords(SHIPPING_FEE)} · {krwAmountWords(FREE_SHIPPING_THRESHOLD)} 이상 무료
              </span>
            </div>

            {detail.description && (
              <p style={{ color: 'var(--dim)', fontSize: 14.5, lineHeight: 1.8, margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>
                {detail.description}
              </p>
            )}
          </div>
        </div>

        {detail.detailImageUrl && (
          <section aria-labelledby="goods-detail-image-heading" className="goods-detail-section">
            <h2 className="mono" id="goods-detail-image-heading" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.16em', margin: 0 }}>
              상세 이미지
            </h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={`${good.name} 상세 이미지`} className="goods-detail-long-image" src={detail.detailImageUrl} />
          </section>
        )}

        {/* 리뷰가 고시정보보다 위에 온다. 살지 말지를 정하는 사람이 먼저 읽는 것은
            법정 표기가 아니라 먼저 산 사람의 말이다. */}
        {reviews}
        <NoticeTable detail={detail} />
        <ShippingGuide />
        <ReturnGuide />
        <InquiryEntry goodId={good.id} />
      </div>
    </Root>
  );
}

/** 공개 라우트용. 목록 카드와 같은 재고·수량 제약을 그대로 쓴다. */
export function GoodDetail({
  detail,
  reviews,
}: {
  detail: GoodDetailContent;
  reviews?: ReactNode;
}) {
  return (
    <GoodDetailView
      cartAction={<AddToCartButton good={detail.good} variant="detail" />}
      detail={detail}
      reviews={reviews}
    />
  );
}
