'use client';

/* 변형 A — 극장(Theater). 정통 미연시 문법.
 * 정보위계: 일러스트 > 대사 > 선택지.  주 어포던스: 화면을 눌러 한 줄씩 넘긴다.
 * 축은 플레이 중 절대 노출하지 않는다 — "내가 뭘 쌓고 있는지 모른 채 고르는 것"이 A의 논지다.
 * 리빌은 흐름 안의 전체 높이 섹션(고정 오버레이 아님)이라 스크롤로 되돌아볼 수 있다. */

import { useState } from 'react';
import { ArtPlate, BeatText, EndingCard, EndingIllustration, type VariantProps } from './pieces';
import { EndingOffer } from './EndingOffer';
import { SCENES, choiceText, currentScene, type Beat, type Scene } from './story';

const INK = '#F4F1FF';
const DIM = '#A9A2CC';

export const NAME = '극장 — 정통 미연시';

export function VariantA({ state, ending, isNew, onChoose, onRestart }: VariantProps) {
  const scene = currentScene(state);

  if (ending) {
    return (
      <div style={{ background: '#050309', minHeight: '100svh' }}>
        <div
          style={{
            minHeight: '100svh',
            display: 'grid',
            placeItems: 'center',
            padding: '40px 20px 120px',
            animation: 'popIn .7s cubic-bezier(.2,.6,.2,1) both',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 460 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.24em', color: ending.accent }}>
              ENDING {ending.no} / 20
            </div>
            <div
              style={{
                marginTop: 14,
                fontSize: 'clamp(30px, 8vw, 46px)',
                fontWeight: 850,
                lineHeight: 1.12,
                letterSpacing: '-.03em',
                color: INK,
              }}
            >
              {ending.title}
            </div>
            <p style={{ marginTop: 16, fontSize: 14, lineHeight: 1.8, color: DIM }}>{ending.lead}</p>
            <div style={{ marginTop: 24 }}>
              <EndingIllustration ending={ending} />
            </div>
            <div style={{ display: 'grid', placeItems: 'center', marginTop: 26 }}>
              <EndingCard ending={ending} width={248} sealed />
            </div>
            <div className="mono" style={{ marginTop: 14, fontSize: 10.5, letterSpacing: '.1em', color: '#6F688F' }}>
              {isNew ? '새 카드 · 바인더에 저장됨' : '이미 가진 카드'}
            </div>
            <div style={{ marginTop: 26 }}>
              <EndingOffer ending={ending} />
            </div>
            <button
              type="button"
              onClick={onRestart}
              style={{
                marginTop: 24,
                height: 46,
                padding: '0 28px',
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 13.5,
                cursor: 'pointer',
                color: '#0A0813',
                background: INK,
                border: 'none',
              }}
            >
              다른 결말 보러 가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!scene) return null;

  const last = state.history.at(-1);
  const aside = last
    ? SCENES.find((s) => s.id === last.sceneId)?.choices.find((c) => c.id === last.choiceId)?.aside
    : undefined;

  /* key로 장면이 바뀔 때 대사 커서가 리셋된다 — effect에서 setState 하지 않기 위한 구조. */
  return <Stage key={scene.id} scene={scene} aside={aside} step={state.step} onChoose={onChoose} />;
}

function Stage({
  scene,
  aside,
  step,
  onChoose,
}: {
  scene: Scene;
  aside?: string;
  step: number;
  onChoose: (choiceId: string) => void;
}) {
  // 이전 선택의 여운을 이 장면의 첫 지문으로 흘려보낸다 — 장면 사이가 끊기지 않게
  const flow: Beat[] = aside ? [{ kind: 'narration', text: aside }, ...scene.beats] : scene.beats;
  const [at, setAt] = useState(0);
  const showChoices = at >= flow.length;
  // 정통 미연시 문법 — 한 번에 한 문단만. 쌓지 않고 갈아 끼운다.
  const beat = flow[Math.min(at, flow.length - 1)];
  const advance = () => {
    if (!showChoices) setAt((n) => n + 1);
  };

  return (
    <div style={{ background: '#050309', minHeight: '100svh' }}>
      {/* 무대 — 화면 대부분을 일러스트가 먹는다 */}
      <div
        onClick={advance}
        style={{
          position: 'relative',
          height: 'min(52svh, 460px)',
          cursor: showChoices ? 'default' : 'pointer',
          overflow: 'hidden',
        }}
      >
        <ArtPlate slot={scene.art} label={scene.place} />
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(5,3,9,.72) 0%, transparent 26%, transparent 52%, #050309 100%)',
          }}
        />
        <div style={{ position: 'absolute', top: 18, left: 20, right: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: '#FF2E63' }}>
            {scene.act} · {scene.place}
          </div>
        </div>
      </div>

      {/* 대사창 — 무대 아래에 붙는 고전적 텍스트 박스 */}
      <div style={{ padding: '0 18px 110px', maxWidth: 620, margin: '0 auto' }}>
        <div
          onClick={advance}
          style={{
            marginTop: -34,
            position: 'relative',
            padding: '20px 20px 22px',
            borderRadius: 16,
            minHeight: 148,
            background: 'rgba(12,8,22,.92)',
            border: '1px solid rgba(255,255,255,.13)',
            boxShadow: '0 30px 70px -30px rgba(0,0,0,.9)',
            cursor: showChoices ? 'default' : 'pointer',
          }}
        >
          {!showChoices && (
            <span
              style={{
                position: 'absolute',
                right: 18,
                bottom: 14,
                fontSize: 11,
                color: 'rgba(255,255,255,.45)',
              }}
            >
              눌러서 계속 ▾
            </span>
          )}
          <div style={{ opacity: showChoices ? 0.5 : 1, transition: 'opacity .3s ease' }}>
            <BeatText beat={beat} size={15} />
          </div>

          {showChoices && (
            <div style={{ marginTop: 18, display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 11.5, letterSpacing: '.02em', color: '#6F688F' }}>{scene.prompt}</div>
              {scene.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => onChoose(choice.id)}
                  style={{
                    width: '100%',
                    minHeight: 48,
                    padding: '12px 16px',
                    borderRadius: 11,
                    textAlign: 'left',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: INK,
                    background: 'rgba(255,255,255,.05)',
                    border: '1px solid rgba(255,255,255,.18)',
                    transition: 'background .2s ease, border-color .2s ease, transform .2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,46,99,.16)';
                    e.currentTarget.style.borderColor = 'rgba(255,46,99,.6)';
                    e.currentTarget.style.transform = 'translateX(4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,.05)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,.18)';
                    e.currentTarget.style.transform = 'none';
                  }}
                >
                  {choiceText(choice)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className="mono"
          style={{ marginTop: 14, textAlign: 'center', fontSize: 10, letterSpacing: '.16em', color: '#6F688F' }}
        >
          {step + 1} / {SCENES.length}
        </div>
      </div>
    </div>
  );
}
