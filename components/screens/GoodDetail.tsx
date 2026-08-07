'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { krw, krwAmountWords } from '@/lib/format';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { STOCK_LABEL } from '@/lib/goods-display';
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
      <h2 className="mono" id="goods-notice-heading" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.16em', margin: 0 }}>
        상품정보제공고시
      </h2>
      {rows.length ? (
        <table className="goods-notice-table">
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
        <li>결제 확인 후 영업일 기준 2~5일 이내 출고됩니다. 주말·공휴일은 제외됩니다.</li>
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
  showBackLink = true,
}: {
  cartAction: ReactNode;
  detail: GoodDetailContent;
  /** 어드민 미리보기처럼 다른 화면 안에 놓일 때. #root 캔버스를 건드리지 않는다. */
  embedded?: boolean;
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

        <NoticeTable detail={detail} />
        <ShippingGuide />
        <ReturnGuide />
      </div>
    </Root>
  );
}

/** 공개 라우트용. 목록 카드와 같은 재고·수량 제약을 그대로 쓴다. */
export function GoodDetail({ detail }: { detail: GoodDetailContent }) {
  return (
    <GoodDetailView
      cartAction={<AddToCartButton good={detail.good} variant="detail" />}
      detail={detail}
    />
  );
}
