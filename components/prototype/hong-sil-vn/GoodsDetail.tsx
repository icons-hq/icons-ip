'use client';

/* PROTOTYPE — 한정 굿즈 상세. 버릴 코드다.
 *
 * ⚠ 이 앱에는 굿즈 상세 라우트가 아직 없다. /shop은 목록 하나뿐이고
 *   app/shop/[goodId]도, Shop.tsx의 상세 모달도 없다.
 *   그래서 "상세페이지로 이동"을 죽은 링크로 만드는 대신, 상세 화면이 담아야 할 것을
 *   그대로 세운 시트로 만든다. 실제 상세 라우트를 만들 때 이게 명세가 된다.
 *
 * 서사 굿즈의 상세는 일반 굿즈와 다르다 — 소재·사이즈보다 "왜 이 결말에 이 물건인가"가
 * 먼저 와야 하고, 각인처럼 사용자가 채우는 값이 구매 전에 노출돼야 한다. */

import { useState } from 'react';
import { krw } from '@/lib/format';
import { ArtPlate } from './pieces';
import { GOODS_FULFILLMENT, type EndingGoods } from './story';

const INK = '#F4F1FF';
const DIM = '#A9A2CC';
const FAINT = '#6F688F';

export function GoodsDetailSheet({
  goods,
  artSlot,
  endingLabel,
  onAdd,
  onClose,
}: {
  goods: EndingGoods;
  /** 굿즈 실물 사진이 없으므로 그 결말의 원화를 자리표시로 쓴다 */
  artSlot?: string;
  endingLabel?: string;
  onAdd?: () => void;
  onClose: () => void;
}) {
  const [engrave, setEngrave] = useState('');
  const [added, setAdded] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${goods.name} 상세`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        overflowY: 'auto',
        background: 'rgba(6,4,10,.88)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: '28px 18px 110px' }}>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(520px, 100%)',
            borderRadius: 18,
            overflow: 'hidden',
            background: '#15112A',
            border: '1px solid rgba(255,255,255,.14)',
            textAlign: 'left',
          }}
        >
          {/* 대표 이미지 — 실물 촬영 전까지 결말 원화로 대체한다 */}
          <div style={{ position: 'relative', aspectRatio: '16 / 10' }}>
            {artSlot ? <ArtPlate slot={artSlot} /> : <div style={{ position: 'absolute', inset: 0, background: '#241C33' }} />}
            <span
              aria-hidden
              style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(8,6,15,.5) 0%, transparent 40%, rgba(21,17,42,.95) 100%)' }}
            />
            <span
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                fontSize: 10.5,
                fontWeight: 800,
                padding: '5px 9px',
                borderRadius: 6,
                color: '#0A0813',
                background: goods.accent,
              }}
            >
              이 결말에서만
            </span>
            <span
              style={{
                position: 'absolute',
                left: 16,
                right: 16,
                bottom: 12,
                fontSize: 11,
                color: DIM,
              }}
            >
              실물 촬영 전 · 결말 원화로 대체된 이미지
            </span>
          </div>

          <div style={{ padding: 18 }}>
            {endingLabel && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: goods.accent }}>{endingLabel}에서 열린 상품</div>
            )}
            <div style={{ marginTop: 8, fontSize: 19, fontWeight: 850, lineHeight: 1.35, letterSpacing: '-.02em', color: INK }}>
              {goods.name}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: FAINT }}>{goods.type}</div>
            <div className="mono" style={{ marginTop: 12, fontSize: 20, fontWeight: 700, color: INK }}>
              {krw(goods.priceKrw)}
            </div>

            <Block title="이 물건이 이 결말에 걸린 이유">
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.85, color: DIM }}>{goods.why}</p>
            </Block>

            <Block title="구성과 소재">
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.8, color: DIM }}>{goods.madeOf}</p>
            </Block>

            {goods.option && (
              <Block title={goods.option.label}>
                <input
                  value={engrave}
                  onChange={(e) => setEngrave(e.target.value)}
                  placeholder={goods.option.placeholder}
                  maxLength={8}
                  style={{
                    width: '100%',
                    height: 44,
                    padding: '0 13px',
                    borderRadius: 10,
                    fontSize: 14,
                    color: INK,
                    background: 'rgba(255,255,255,.05)',
                    border: '1px solid rgba(255,255,255,.2)',
                  }}
                />
                <p style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.7, color: FAINT }}>{goods.option.note}</p>
              </Block>
            )}

            <Block title="제작과 배송">
              <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12, lineHeight: 1.85, color: DIM }}>
                {GOODS_FULFILLMENT.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Block>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => {
                  setAdded(true);
                  onAdd?.();
                }}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: 999,
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: 'pointer',
                  border: 'none',
                  color: '#0A0813',
                  background: added ? FAINT : INK,
                }}
              >
                {added ? '담김 ✓' : '장바구니에 담기'}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  height: 48,
                  padding: '0 20px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  color: INK,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,.28)',
                }}
              >
                닫기
              </button>
            </div>

            <p style={{ margin: '13px 0 0', fontSize: 10.5, lineHeight: 1.7, color: '#FFB23D' }}>
              PROTOTYPE · 이 앱에는 아직 굿즈 상세 라우트가 없다(/shop은 목록뿐). 이 시트가 그 화면의 명세다.
              결제·재고 미배선이고 가격·제작 일정은 제안값이다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.1)' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: INK, marginBottom: 9 }}>{title}</div>
      {children}
    </section>
  );
}
