'use client';

/* PROTOTYPE — 결말에 걸린 한정 굿즈. 버릴 코드다.
 *
 * EndingCard와 같은 급의 공유 프리미티브다: "같은 물건"이라 셋이 공유하고,
 * 어디에 어떻게 놓을지는 각 변형이 정한다.
 *
 * 잠금 규칙은 "도달 이력 + 팝업 기간"이다 — 이 결말에 한 번이라도 닿은 사람만,
 * 팝업이 끝나기 전까지. 화면을 벗어나면 사라지는 함정이 아니다(장바구니도 안 날아간다).
 * 다시 살 수 있는 자리는 AfterPopup의 "내가 연 한정 굿즈"다.
 *
 * ⚠ 담기는 스텁이다. 실제 홍실 퀘스트 굿즈(g13~g15)는 stockQty 0이라 판매 불가 상태고,
 *   이 5종은 아직 카탈로그에 없는 기획 제안이다. */

import { useState } from 'react';
import { krw } from '@/lib/format';
import { GoodsDetailSheet } from './GoodsDetail';
import { goodsForEnding, type AnyEnding } from './story';

export function EndingOffer({ ending, dark = true }: { ending: AnyEnding; dark?: boolean }) {
  const goods = goodsForEnding(ending);
  const [added, setAdded] = useState(false);
  const [detail, setDetail] = useState(false);

  const ink = dark ? '#F4F1FF' : '#11110F';
  const dim = dark ? '#A9A2CC' : '#686862';
  const faint = dark ? '#6F688F' : '#858580';
  const surface = dark ? 'rgba(255,255,255,.04)' : '#FFFFFF';
  const line = dark ? 'rgba(255,255,255,.13)' : 'rgba(17,17,15,.18)';

  return (
    <div
      style={{
        textAlign: 'left',
        padding: 16,
        borderRadius: 14,
        background: surface,
        border: `1px solid ${line}`,
        borderTop: `2px solid ${goods.accent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '.02em',
            padding: '4px 8px',
            borderRadius: 5,
            color: '#0A0813',
            background: goods.accent,
          }}
        >
          이 결말에서만
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: faint }}>팝업 종료까지 · 도달한 사람만</span>
      </div>

      <div style={{ marginTop: 11, fontWeight: 800, fontSize: 15, lineHeight: 1.35, color: ink }}>
        {goods.name}
      </div>
      <div style={{ marginTop: 5, fontSize: 11.5, color: faint }}>{goods.type}</div>

      <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.75, color: dim }}>{goods.why}</p>

      <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: ink, marginTop: 14 }}>
        {krw(goods.priceKrw)}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setAdded(true)}
          style={{
            flex: '1 1 150px',
            height: 44,
            padding: '0 18px',
            borderRadius: 999,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            border: 'none',
            color: dark ? '#0A0813' : '#FFFFFF',
            background: added ? faint : dark ? ink : '#11110F',
          }}
        >
          {added ? '담김 ✓' : '장바구니에 담기'}
        </button>
        <button
          type="button"
          onClick={() => setDetail(true)}
          style={{
            flex: '1 1 130px',
            height: 44,
            padding: '0 18px',
            borderRadius: 999,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            color: ink,
            background: 'transparent',
            border: `1px solid ${dark ? 'rgba(255,255,255,.3)' : 'rgba(17,17,15,.4)'}`,
          }}
        >
          상품 상세 보기 →
        </button>
      </div>

      {detail && (
        <GoodsDetailSheet
          goods={goods}
          artSlot={ending.art}
          endingLabel={`${ending.no}. ${ending.title}`}
          onAdd={() => setAdded(true)}
          onClose={() => setDetail(false)}
        />
      )}

      <p style={{ margin: '11px 0 0', fontSize: 10.5, lineHeight: 1.65, color: '#FFB23D' }}>
        PROTOTYPE · 결제 미배선 · 가격은 제안값입니다. 결말은 무작위가 아니라 선택의 결과이고
        다시 플레이하는 건 무료라, 돈으로 결과를 뽑는 구조가 아닙니다.
      </p>
    </div>
  );
}
