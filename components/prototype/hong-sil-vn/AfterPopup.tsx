'use client';

/* PROTOTYPE — 팝업 종료 전/후 표면. 버릴 코드다.
 *
 * 세 변형이 답하는 질문은 "플레이가 어떻게 보여야 하는가"이고,
 * 이 패널이 답하는 질문은 그 다음이다:
 *   "봉인 → 공개 전환이 화면에서 납득되는가, 공개 후 무엇을 보여줘야 자랑이 되는가."
 * 그래서 이 패널만은 세 변형이 공유한다 — 별개 질문이므로 변형을 나눌 이유가 없다.
 *
 * 분포 수치는 지어낸 게 아니라 81개 경로 완전열거에서 계산한 값이다(균등 선택 가정).
 * 실제 유저 분포가 아니므로 그대로 지표로 읽으면 안 된다.
 */

import { useMemo, useState } from 'react';
import { RARITY_META, rarityTag, type RarityKey } from '@/lib/rarity';
import { EndingCard } from './pieces';
import { GoodsDetailSheet } from './GoodsDetail';
import { krw } from '@/lib/format';
import {
  CARD_NO,
  ENDING_GOODS,
  ENDINGS,
  goodsForEnding,
  PRINT_PRICE_KRW,
  enumerateAll,
  type AnyEnding,
  type EndingGoods,
  type PopupPhase,
} from './story';

const INK = '#F4F1FF';
const DIM = '#A9A2CC';
const FAINT = '#6F688F';

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: INK, letterSpacing: '-.01em' }}>{title}</span>
        {note && (
          <span style={{ fontSize: 11, fontWeight: 600, color: FAINT }}>
            {note}
          </span>
        )}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

export function AfterPopup({
  collected,
  unlockedGoods,
  phase,
  onPhaseChange,
}: {
  collected: Set<string>;
  /** 도달해서 열린 한정 굿즈 SKU. 팝업이 끝날 때까지 여기서 계속 살 수 있다. */
  unlockedGoods: Set<string>;
  phase: PopupPhase;
  onPhaseChange: (phase: PopupPhase) => void;
}) {
  const enumeration = useMemo(() => enumerateAll(), []);
  const [printing, setPrinting] = useState<AnyEnding | null>(null);
  const [detail, setDetail] = useState<EndingGoods | null>(null);

  const sealed = phase === 'sealed';
  const owned = ENDINGS.filter((e) => collected.has(e.id));
  const unlocked = Object.values(ENDING_GOODS).filter((g) => unlockedGoods.has(g.id));
  /** 상세 시트의 대표 이미지 — 이 상품을 열어 준 내 결말의 원화를 쓴다 */
  const openedBy = (goodsId: string) =>
    owned.find((e) => goodsForEnding(e).id === goodsId) ?? ENDINGS.find((e) => goodsForEnding(e).id === goodsId);

  // 위쪽 패딩이 0이면 자식 margin이 밖으로 빠져나가 body 캔버스(밝은색)가 새어 보인다
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '26px 18px 90px' }}>
      {/* 페이즈 스위치 — 프로토타입 전용 장치다. 실제로는 팝업 종료 시각이 결정한다. */}
      <div
        style={{
          padding: 14,
          borderRadius: 14,
          border: '1px dashed rgba(255,255,255,.24)',
          background: 'rgba(255,255,255,.03)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB23D' }}>
          PROTOTYPE ONLY · 팝업 시계 대신 손으로 넘긴다
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {(['sealed', 'revealed'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onPhaseChange(value)}
              style={{
                flex: 1,
                height: 40,
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 12.5,
                cursor: 'pointer',
                color: phase === value ? '#0A0813' : INK,
                background: phase === value ? INK : 'rgba(255,255,255,.05)',
                border: `1px solid ${phase === value ? INK : 'rgba(255,255,255,.16)'}`,
              }}
            >
              {value === 'sealed' ? '팝업 진행 중 · 봉인' : '팝업 종료 · 공개'}
            </button>
          ))}
        </div>
      </div>

      <Section title="내 바인더" note={`${owned.length} / ${ENDINGS.length}`}>
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: 'rgba(255,255,255,.1)',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${(owned.length / ENDINGS.length) * 100}%`,
              background: 'linear-gradient(90deg, #9C001D, #FF2E63)',
              transition: 'width .4s cubic-bezier(.2,.7,.2,1)',
            }}
          />
        </div>
        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
            gap: 9,
          }}
        >
          {ENDINGS.map((ending) => {
            const has = collected.has(ending.id);
            const meta = RARITY_META[ending.rarity as RarityKey];
            return (
              <div
                key={ending.id}
                title={has ? ending.title : '미획득'}
                style={{
                  aspectRatio: '5 / 7',
                  borderRadius: 9,
                  position: 'relative',
                  overflow: 'hidden',
                  border: `1px solid ${has ? `${meta.color}66` : 'rgba(255,255,255,.09)'}`,
                  background: has ? '#150F22' : 'rgba(255,255,255,.03)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {has ? (
                  <>
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: `linear-gradient(160deg, #300008, ${meta.color}55)`,
                      }}
                    />
                    <span
                      className="mono"
                      style={{ position: 'relative', fontSize: 9.5, letterSpacing: '.1em', color: INK }}
                    >
                      {ending.no}
                    </span>
                  </>
                ) : (
                  <span className="mono" style={{ fontSize: 12, color: 'rgba(255,255,255,.18)' }}>
                    ?
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p style={{ marginTop: 12, fontSize: 12, lineHeight: 1.65, color: DIM }}>
          {sealed
            ? '팝업이 진행되는 동안 이 바인더는 나에게만 보인다. 자랑·교환·인쇄는 종료 후 열린다.'
            : '팝업이 끝났다. 이제 바인더를 공개하고, 남는 카드를 교환하고, 실물로 인쇄할 수 있다.'}
        </p>
      </Section>

      {/* 잠금 규칙의 실제 구현체 — 결말 화면을 떠나도 여기 남는다(도달 이력 + 팝업 기간). */}
      <Section title="내가 연 한정 굿즈" note={`${unlocked.length} / ${Object.keys(ENDING_GOODS).length}`}>
        {unlocked.length === 0 ? (
          <div
            style={{
              padding: '22px 18px',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,.1)',
              background: 'rgba(255,255,255,.02)',
              fontSize: 12.5,
              lineHeight: 1.7,
              color: DIM,
              textAlign: 'center',
            }}
          >
            아직 없다. 결말에 닿으면 그 결말의 물건이 여기에 열린다.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            {unlocked.map((goods) => (
              <div
                key={goods.id}
                style={{
                  padding: 13,
                  borderRadius: 12,
                  background: 'rgba(255,255,255,.03)',
                  border: '1px solid rgba(255,255,255,.1)',
                  borderLeft: `3px solid ${goods.accent}`,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.4, color: INK }}>{goods.name}</div>
                <p style={{ margin: '7px 0 0', fontSize: 11.5, lineHeight: 1.7, color: DIM }}>{goods.why}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: INK }}>
                    {krw(goods.priceKrw)}
                  </span>
                  <span style={{ fontSize: 10.5, color: FAINT }}>{goods.type}</span>
                  <button
                    type="button"
                    onClick={() => setDetail(goods)}
                    style={{
                      marginLeft: 'auto',
                      height: 32,
                      padding: '0 13px',
                      borderRadius: 999,
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      color: INK,
                      background: 'rgba(255,255,255,.06)',
                      border: '1px solid rgba(255,255,255,.2)',
                    }}
                  >
                    상품 상세 보기 →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.65, color: FAINT }}>
          한 번 도달하면 팝업이 끝날 때까지 계속 살 수 있다. 결말 화면을 벗어난다고 닫히지 않는다.
          다만 <b style={{ color: DIM }}>팝업이 끝나면 같이 닫힌다</b>. 그래야 &ldquo;한정&rdquo;이 실제로 한정이다.
        </p>
      </Section>

      <Section
        title="전체 엔딩 분포"
        note={sealed ? '봉인 중' : `${enumeration.totalPaths} 경로 완전열거`}
      >
        {sealed ? (
          <div
            style={{
              padding: '26px 18px',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,.1)',
              background: 'rgba(255,255,255,.02)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 22 }}>🔒</div>
            <div style={{ marginTop: 8, fontSize: 13, color: DIM, lineHeight: 1.6 }}>
              누가 어떤 결말에 닿았는지는 팝업이 끝나야 공개된다.
              <br />
              지금 아는 건 <b style={{ color: INK }}>내 결말뿐</b>이다.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 6 }}>
              {enumeration.stats.map(({ ending, paths, share }) => {
                const meta = RARITY_META[ending.rarity as RarityKey];
                const tag = rarityTag(ending.rarity as RarityKey);
                const mine = collected.has(ending.id);
                return (
                  <div
                    key={ending.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '30px 1fr auto',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 10px',
                      borderRadius: 9,
                      background: mine ? 'rgba(255,46,99,.1)' : 'transparent',
                      border: `1px solid ${mine ? 'rgba(255,46,99,.3)' : 'transparent'}`,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 9,
                        letterSpacing: '.06em',
                        padding: '3px 0',
                        borderRadius: 5,
                        textAlign: 'center',
                        fontWeight: 700,
                        color: tag.color,
                        background: tag.bg,
                      }}
                    >
                      {ending.rarity}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: mine ? 800 : 500,
                          color: paths === 0 ? '#B8324A' : INK,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {ending.no}. {ending.title}
                        {paths === 0 && ' — 도달 불가'}
                      </div>
                      <div style={{ marginTop: 4, height: 3, borderRadius: 999, background: 'rgba(255,255,255,.07)' }}>
                        <span
                          style={{
                            display: 'block',
                            height: '100%',
                            borderRadius: 999,
                            width: `${share * 100 * 4}%`,
                            maxWidth: '100%',
                            background: meta.color,
                          }}
                        />
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 10.5, color: DIM }}>
                      {(share * 100).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
            <p style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.65, color: FAINT }}>
              위 비율은 모든 선택을 균등하게 골랐을 때의 <b style={{ color: DIM }}>경로 점유율</b>이지 유저 분포가 아니다.
              등급과 비율이 어긋나는 줄이 있다면 그건 등급표를 다시 짜야 한다는 뜻이다.
            </p>
          </>
        )}
      </Section>

      <Section title="공개 후에 열리는 것" note={sealed ? '잠김' : '열림'}>
        <div style={{ display: 'grid', gap: 9 }}>
          {[
            {
              key: 'brag',
              icon: '📣',
              title: '바인더 자랑',
              body: '내 20종 진행률과 대표 카드를 공개 링크로 공유한다.',
              blocked: false,
            },
            {
              key: 'trade',
              icon: '🔁',
              title: '카드 교환',
              body: '중복 카드를 다른 유저와 맞바꾼다.',
              blocked: true,
              warn: 'CONTEXT.md 기준 교환(Exchange)은 v2 범위다. 이 팝업에 넣으려면 v1 스코프를 먼저 바꿔야 한다.',
            },
            {
              key: 'print',
              icon: '📦',
              title: '실물 인쇄 주문',
              body: `이미 가진 카드를 고급 패키징 실물로 인쇄해 배송받는다 · ${PRINT_PRICE_KRW.toLocaleString('ko-KR')}원`,
              blocked: false,
              warn: '카드 자체는 계속 무상이고, 결제 대상은 인쇄·패키징·배송이다. 이 경계가 무너지면 ADR-0003(카드에 닿는 유상 경로 없음)을 깬다.',
            },
          ].map((row) => (
            <div
              key={row.key}
              style={{
                padding: 13,
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,.1)',
                background: 'rgba(255,255,255,.02)',
                opacity: sealed ? 0.42 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 15 }}>{row.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: INK }}>{row.title}</span>
                {row.blocked && (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: '3px 7px',
                      borderRadius: 5,
                      color: '#FFB23D',
                      border: '1px solid rgba(255,178,61,.4)',
                    }}
                  >
                    V2 범위
                  </span>
                )}
              </div>
              <p style={{ marginTop: 7, fontSize: 12, lineHeight: 1.6, color: DIM }}>{row.body}</p>
              {row.warn && (
                <p style={{ marginTop: 7, fontSize: 11, lineHeight: 1.6, color: '#FFB23D' }}>⚠ {row.warn}</p>
              )}
              {row.key === 'print' && !sealed && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
                  {owned.length === 0 ? (
                    <span style={{ fontSize: 11.5, color: FAINT }}>인쇄할 카드가 아직 없다.</span>
                  ) : (
                    owned.map((ending) => (
                      <button
                        key={ending.id}
                        type="button"
                        onClick={() => setPrinting(ending)}
                        style={{
                          height: 32,
                          padding: '0 12px',
                          borderRadius: 8,
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: INK,
                          background: 'rgba(255,255,255,.06)',
                          border: '1px solid rgba(255,255,255,.18)',
                        }}
                      >
                        {CARD_NO(ending)} 인쇄
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {detail && (
        <GoodsDetailSheet
          goods={detail}
          artSlot={openedBy(detail.id)?.art}
          endingLabel={(() => {
            const e = openedBy(detail.id);
            return e ? `${e.no}. ${e.title}` : undefined;
          })()}
          onClose={() => setDetail(null)}
        />
      )}

      {printing && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            display: 'grid',
            placeItems: 'center',
            padding: 22,
            background: 'rgba(8,6,15,.85)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div
            style={{
              width: 'min(360px, 100%)',
              padding: 20,
              borderRadius: 18,
              background: '#15112A',
              border: '1px solid rgba(255,255,255,.14)',
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'grid', placeItems: 'center' }}>
              <EndingCard ending={printing} width={150} />
            </div>
            <div style={{ marginTop: 14, fontWeight: 800, fontSize: 15, color: INK }}>{printing.title}</div>
            <div className="mono" style={{ marginTop: 5, fontSize: 11, letterSpacing: '.1em', color: DIM }}>
              {CARD_NO(printing)} · {PRINT_PRICE_KRW.toLocaleString('ko-KR')}원
            </div>
            <p style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.65, color: DIM }}>
              고급 패키징 실물 인쇄 + 배송. 결제는 <b style={{ color: INK }}>인쇄·패키징·배송</b>에 대한 것이고,
              카드 소유는 이미 무상으로 끝나 있다.
            </p>
            <p style={{ marginTop: 10, fontSize: 10.5, fontWeight: 700, color: '#FFB23D' }}>
              PROTOTYPE · 결제 미배선
            </p>
            <button
              type="button"
              onClick={() => setPrinting(null)}
              style={{
                marginTop: 14,
                width: '100%',
                height: 42,
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                color: '#0A0813',
                background: INK,
                border: 'none',
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
