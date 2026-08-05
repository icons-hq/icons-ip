'use client';

/* 변형 C — 기록(Log). 웹툰 세로 스크롤 문법.
 * 정보위계: 누적된 기록 전체 > 현재 선택.  주 어포던스: 스크롤 + 하단 시트.
 * A·B와 달리 지나온 장면이 사라지지 않는다. 지난 선택을 눌러 그 지점부터 다시 갈 수 있다
 * (= 20종 수집을 전제하면 "처음부터 다시"보다 "갈림길로 되돌아가기"가 맞는가를 묻는 변형).
 * 유일하게 밝은 에디토리얼 캔버스다 — 원작이 웹툰이라는 사실을 화면 문법으로 가져온다. */

import { useEffect, useRef } from 'react';
import { ArtPlate, BeatText, EndingCard, EndingIllustration, type VariantProps } from './pieces';
import { EndingOffer } from './EndingOffer';
import { SCENES, choiceText, currentScene } from './story';

const INK = '#11110F';
const INK_MUTED = '#686862';
const INK_FAINT = '#858580';
const HONG = '#9C001D';

export const NAME = '기록 — 세로 스크롤 웹툰';

export function VariantC({ state, ending, isNew, onChoose, onRewind, onRestart }: VariantProps) {
  const scene = currentScene(state);
  // 새로 열린 블록의 '시작'으로 이동한다 — 웹툰처럼 위에서 아래로 읽어 내려가게.
  // (바닥으로 붙이면 하단 시트가 방금 나온 대사를 덮는다)
  const focus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    focus.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [state.step, ending]);

  const played = state.history.map((entry, i) => {
    const s = SCENES.find((x) => x.id === entry.sceneId);
    const c = s?.choices.find((x) => x.id === entry.choiceId);
    return { step: i, scene: s, choice: c };
  });

  return (
    <div style={{ background: '#F4F4F1', minHeight: '100svh' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: `22px 18px ${scene ? 274 : 120}px` }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: HONG }}>
          홍실 퀘스트 · 나의 기록
        </div>

        {/* 지나온 장면 — 사라지지 않는다 */}
        {played.map(({ step, scene: s, choice }) =>
          s && choice ? (
            <article key={`${s.id}-${step}`} style={{ marginTop: 26 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.02em', color: INK_FAINT }}>
                {s.act} · {s.place}
              </div>
              <div
                style={{
                  position: 'relative',
                  marginTop: 10,
                  aspectRatio: '16 / 10',
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <ArtPlate slot={s.art} />
              </div>
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                {s.beats.map((b, i) => (
                  <BeatText key={`${b.kind}-${i}`} beat={b} dark={false} size={14} muted />
                ))}
              </div>
              <div
                style={{
                  position: 'relative',
                  marginTop: 14,
                  aspectRatio: '16 / 7',
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <ArtPlate slot={choice.art} />
              </div>
              <button
                type="button"
                onClick={() => onRewind(step)}
                title="이 갈림길로 되돌아간다"
                style={{
                  marginTop: 12,
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 11,
                  cursor: 'pointer',
                  background: '#FFFFFF',
                  border: `1px solid rgba(17,17,15,.18)`,
                  borderLeft: `3px solid ${HONG}`,
                }}
              >
                <span style={{ fontSize: 10.5, fontWeight: 600, color: INK_FAINT }}>
                  내 선택 · 눌러서 되돌아가기
                </span>
                <span style={{ display: 'block', marginTop: 5, fontSize: 14, fontWeight: 700, color: INK, lineHeight: 1.5 }}>
                  {choiceText(choice)}
                </span>
                <span style={{ display: 'block', marginTop: 5, fontSize: 12.5, lineHeight: 1.7, color: INK_MUTED }}>
                  {choice.aside}
                </span>
              </button>
            </article>
          ) : null,
        )}

        {/* 현재 장면 */}
        {scene && (
          <article ref={focus} style={{ marginTop: 26, scrollMarginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.02em', color: HONG }}>
              {scene.act} · {scene.place}
            </div>
            <div
              style={{
                position: 'relative',
                marginTop: 10,
                aspectRatio: '16 / 10',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <ArtPlate slot={scene.art} />
            </div>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              {scene.beats.map((b, i) => (
                <BeatText key={`${b.kind}-${i}`} beat={b} dark={false} size={14} />
              ))}
            </div>
          </article>
        )}

        {/* 엔딩 — 기록의 마지막 항목으로 안착한다 */}
        {ending && (
          <article
            ref={focus}
            style={{
              marginTop: 30,
              scrollMarginTop: 16,
              padding: '24px 20px 26px',
              borderRadius: 16,
              background: '#11110F',
              textAlign: 'center',
            }}
          >
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.24em', color: ending.accent }}>
              ENDING {ending.no} / 20
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 'clamp(26px, 6.6vw, 36px)',
                fontWeight: 850,
                lineHeight: 1.16,
                letterSpacing: '-.03em',
                color: '#FFFFFF',
              }}
            >
              {ending.title}
            </div>
            <p style={{ marginTop: 13, fontSize: 13.5, lineHeight: 1.8, color: '#A9A2CC' }}>{ending.lead}</p>
            <div style={{ marginTop: 20 }}>
              <EndingIllustration ending={ending} />
            </div>
            <div style={{ display: 'grid', placeItems: 'center', marginTop: 24 }}>
              <EndingCard ending={ending} width={222} sealed />
            </div>
            <div style={{ marginTop: 13, fontSize: 11.5, color: '#6F688F' }}>
              {isNew ? '새 카드 · 바인더에 저장됨' : '이미 가진 카드'}
            </div>
            <div style={{ marginTop: 22 }}>
              <EndingOffer ending={ending} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 20 }}>
              <button
                type="button"
                onClick={() => onRewind(SCENES.length - 1)}
                style={{
                  height: 44,
                  padding: '0 20px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  color: '#FFFFFF',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,.32)',
                }}
              >
                종막만 다시 고르기
              </button>
              <button
                type="button"
                onClick={onRestart}
                style={{
                  height: 44,
                  padding: '0 24px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  color: '#11110F',
                  background: '#FFFFFF',
                  border: 'none',
                }}
              >
                처음부터
              </button>
            </div>
          </article>
        )}

      </div>

      {/* 하단 시트 — 스크롤과 무관하게 항상 선택 가능 */}
      {scene && (
        <div style={{ position: 'sticky', bottom: 0, marginTop: -254 }}>
          {/* 고정 폭 페이드 — 프롬프트가 반투명 위에 얹혀 읽히지 않는 걸 막는다 */}
          <div
            aria-hidden
            style={{ height: 44, background: 'linear-gradient(180deg, rgba(244,244,241,0), #F4F4F1)' }}
          />
          {/* 페이드 바로 아래에 프롬프트가 붙으면 반투명하게 비치는 본문과 겹쳐 읽힌다 */}
          <div style={{ background: '#F4F4F1', padding: '10px 18px calc(92px + env(safe-area-inset-bottom))' }}>
            <div style={{ maxWidth: 524, margin: '0 auto' }}>
              <div style={{ fontSize: 11.5, color: INK_FAINT }}>{scene.prompt}</div>
              <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>
                {scene.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => onChoose(choice.id)}
                    style={{
                      minHeight: 46,
                      padding: '11px 15px',
                      borderRadius: 11,
                      textAlign: 'left',
                      fontSize: 14,
                      lineHeight: 1.5,
                      fontWeight: 650,
                      cursor: 'pointer',
                      color: INK,
                      background: '#FFFFFF',
                      border: '1px solid rgba(17,17,15,.4)',
                    }}
                  >
                    {choiceText(choice)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
