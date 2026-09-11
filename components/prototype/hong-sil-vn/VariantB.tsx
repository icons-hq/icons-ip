'use client';

/* 변형 B — 홍실(Thread). 선택 = 갈라진 실 중 한 가닥을 당기는 행위.
 * 정보위계: 실/선택 > 축 게이지 > 대사.  주 어포던스: 실 가닥을 당긴다.
 * A와 정반대로 축을 실시간 공개한다 — "내가 어떤 사람으로 굳어지는지 보면서 고르게" 하는 게 B의 논지다.
 * 대사는 전문을 한 번에 보여주고 짧게 유지한다(읽기가 아니라 고르기가 주 행위라서).
 * 리빌은 고정 오버레이 — 실이 매듭으로 수렴하는 순간을 화면 전체가 받는다. */

import { useEffect, useRef, useState } from 'react';
import { AxisGauge, BeatText, EndingCard, EndingIllustration, type VariantProps } from './pieces';
import { EndingOffer } from './EndingOffer';
import {
  AXES,
  ENDINGS,
  FINALE_LABEL,
  SCENES,
  choiceText,
  currentScene,
  finaleOf,
  sceneBeats,
  type Beat,
  type Scene,
} from './story';

const INK = '#F4F1FF';
const DIM = '#A9A2CC';
const HONG = '#FF2E63';

export const NAME = '홍실 — 실을 당겨 고른다';

/** 실 가닥 3개. 좌측 매듭에서 우측 선택지 행 중심으로 이어진다. */
const ROW_PITCH = 78;
const FAN_W = 86;

export function VariantB({ state, track, ending, isNew, onChoose, onRestart }: VariantProps) {
  const scene = currentScene(state);

  // key로 새 엔딩마다 오버레이가 다시 열린다 — effect에서 setState 하지 않기 위한 구조
  if (ending) {
    return (
      <EndingOverlay
        key={ending.id}
        ending={ending}
        axes={state.axes}
        finale={finaleOf(state.flags)}
        isNew={isNew}
        onRestart={onRestart}
      />
    );
  }

  if (!scene) return null;

  // 이전 선택의 여운을 이 장면의 첫 지문으로 흘려보낸다 — 장면 사이가 끊기지 않게
  const last = state.history.at(-1);
  const aside = last
    ? SCENES.find((s) => s.id === last.sceneId)?.choices.find((c) => c.id === last.choiceId)?.aside
    : undefined;
  const beats = sceneBeats(scene, state.flags, track);
  const flow: Beat[] = aside ? [{ kind: 'narration', text: aside }, ...beats] : beats;

  return (
    <div
      style={{
        minHeight: '100svh',
        background: 'radial-gradient(110% 70% at 50% -10%, #2A0009 0%, #0A0308 58%, #050308 100%)',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '26px 18px 120px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: HONG }}>
            {scene.act} · {scene.place}
          </div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.16em', color: '#6F688F' }}>
            {state.step + 1} / {SCENES.length}
          </div>
        </div>

        {/* 축을 늘 보여준다 — B의 핵심 주장 */}
        <div
          style={{
            marginTop: 14,
            padding: 13,
            borderRadius: 13,
            background: 'rgba(255,255,255,.035)',
            border: '1px solid rgba(255,255,255,.09)',
          }}
        >
          <AxisGauge axes={state.axes} />
        </div>

        {/* B는 읽기가 아니라 고르기가 주 행위라 전문을 한 번에 펼쳐 두고 조판만 작게 간다 */}
        <div style={{ marginTop: 20, display: 'grid', gap: 10 }}>
          {flow.map((b, i) => (
            <BeatText key={`${b.kind}-${i}`} beat={b} size={13.5} muted={b.kind === 'narration'} />
          ))}
          <p style={{ margin: '6px 0 0', fontSize: 15, fontWeight: 700, color: INK }}>{scene.prompt}</p>
        </div>

        {/* key로 장면이 바뀔 때 당김 상태가 리셋된다 — effect에서 setState 하지 않기 위한 구조 */}
        <Fan key={scene.id} scene={scene} onChoose={onChoose} />

        <p style={{ marginTop: 18, fontSize: 11, lineHeight: 1.7, color: '#6F688F' }}>
          축 변화를 선택지에 미리 적어 둔 건 B의 실험이다 — 가릴지 말지는 이 화면을 보고 정한다
        </p>
      </div>
    </div>
  );
}

/** 결말 오버레이. 닫으면 아래 바인더·통계 표면으로 내려갈 수 있다(다시 열기 가능). */
function EndingOverlay({
  ending,
  axes,
  finale,
  isNew,
  onRestart,
}: {
  ending: NonNullable<VariantProps['ending']>;
  axes: VariantProps['state']['axes'];
  finale: ReturnType<typeof finaleOf>;
  isNew: boolean;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <div style={{ background: '#0A0308', padding: '20px 18px' }}>
        <div
          style={{
            maxWidth: 560,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'rgba(255,255,255,.04)',
            border: `1px solid ${ending.accent}55`,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>
            <span className="mono" style={{ fontSize: 10.5, color: ending.accent, marginRight: 8 }}>
              {ending.no}
            </span>
            {ending.title}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              color: INK,
              background: 'rgba(255,255,255,.07)',
              border: '1px solid rgba(255,255,255,.2)',
              flex: '0 0 auto',
            }}
          >
            결말 다시 보기
          </button>
        </div>
      </div>
    );
  }

  return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          overflowY: 'auto',
          background: 'radial-gradient(120% 80% at 50% 0%, #3A0010 0%, #0A0308 62%, #050308 100%)',
        }}
      >
        <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: '76px 20px 120px' }}>
          <div style={{ textAlign: 'center', maxWidth: 430 }}>
            <svg viewBox="0 0 200 90" style={{ width: 190, height: 86 }} aria-hidden>
              {[0, 1, 2].map((i) => (
                <path
                  key={i}
                  d={`M ${16 + i * 84} 4 Q ${100} ${30 + i * 8} 100 78`}
                  fill="none"
                  stroke={HONG}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  opacity={0.55}
                />
              ))}
              <circle cx="100" cy="80" r="6" fill={HONG} />
              <circle cx="100" cy="80" r="11" fill="none" stroke={HONG} strokeWidth="1" opacity=".45" />
            </svg>
            <div className="mono" style={{ marginTop: 10, fontSize: 10, letterSpacing: '.24em', color: ending.accent }}>
              {FINALE_LABEL[finale]} · ENDING {ending.no} / {ENDINGS.length}
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 'clamp(28px, 7.4vw, 42px)',
                fontWeight: 850,
                lineHeight: 1.14,
                letterSpacing: '-.03em',
                color: INK,
              }}
            >
              {ending.title}
            </div>
            <p style={{ marginTop: 14, fontSize: 13.5, lineHeight: 1.8, color: DIM }}>{ending.lead}</p>
            <div style={{ marginTop: 22 }}>
              <EndingIllustration ending={ending} />
            </div>
            <div style={{ display: 'grid', placeItems: 'center', marginTop: 24 }}>
              <EndingCard ending={ending} width={236} sealed />
            </div>

            <div
              style={{
                marginTop: 22,
                padding: 14,
                borderRadius: 13,
                background: 'rgba(255,255,255,.04)',
                border: '1px solid rgba(255,255,255,.1)',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6F688F', marginBottom: 10 }}>이 결말로 데려온 축</div>
              <AxisGauge axes={axes} />
            </div>

            <div className="mono" style={{ marginTop: 14, fontSize: 10.5, letterSpacing: '.1em', color: '#6F688F' }}>
              {isNew ? '새 카드 · 바인더에 저장됨' : '이미 가진 카드'}
            </div>
            <div style={{ marginTop: 20 }}>
              <EndingOffer ending={ending} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 20 }}>
              <button
                type="button"
                onClick={onRestart}
                style={{
                  height: 46,
                  padding: '0 24px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  color: '#0A0813',
                  background: INK,
                  border: 'none',
                }}
              >
                실을 다시 잡는다
              </button>
              {/* 고정 오버레이라 닫지 않으면 아래 바인더·통계 표면에 닿을 수 없다 */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  height: 46,
                  padding: '0 20px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  color: INK,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,.3)',
                }}
              >
                바인더 보기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

/** 실 부채 + 선택지 행. 한 가닥을 당기면 나머지가 흐려지고 짧은 텀 뒤 장면이 넘어간다. */
function Fan({ scene, onChoose }: { scene: Scene; onChoose: (choiceId: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const pull = (choiceId: string) => {
    if (picked) return;
    setPicked(choiceId);
    timer.current = setTimeout(() => onChoose(choiceId), 430);
  };

  const fanH = scene.choices.length * ROW_PITCH - 14;

  return (
        <div style={{ position: 'relative', marginTop: 18, paddingLeft: FAN_W }}>
          <svg
            viewBox={`0 0 ${FAN_W} ${fanH}`}
            preserveAspectRatio="none"
            aria-hidden
            style={{ position: 'absolute', left: 0, top: 0, width: FAN_W, height: fanH }}
          >
            {scene.choices.map((choice, i) => {
              const y = i * ROW_PITCH + 32;
              const on = picked === choice.id;
              const off = picked !== null && !on;
              return (
                <path
                  key={choice.id}
                  d={`M 8 ${fanH / 2} C ${FAN_W * 0.55} ${fanH / 2}, ${FAN_W * 0.45} ${y}, ${FAN_W} ${y}`}
                  fill="none"
                  stroke={on ? '#FF7A9E' : HONG}
                  strokeWidth={on ? 3.2 : 1.5}
                  strokeLinecap="round"
                  opacity={off ? 0.13 : on ? 1 : 0.6}
                  style={{ transition: 'stroke-width .35s ease, opacity .35s ease, stroke .35s ease' }}
                />
              );
            })}
            <circle cx="8" cy={fanH / 2} r="5" fill={HONG} />
          </svg>

          <div style={{ display: 'grid', gap: 14 }}>
            {scene.choices.map((choice) => {
              const on = picked === choice.id;
              const off = picked !== null && !on;
              return (
                <button
                  key={choice.id}
                  type="button"
                  disabled={picked !== null}
                  onClick={() => pull(choice.id)}
                  style={{
                    minHeight: 64,
                    padding: '12px 16px',
                    borderRadius: 12,
                    textAlign: 'left',
                    fontSize: 14.5,
                    lineHeight: 1.45,
                    fontWeight: 700,
                    cursor: picked ? 'default' : 'pointer',
                    color: INK,
                    background: on ? 'rgba(255,46,99,.2)' : 'rgba(255,255,255,.045)',
                    border: `1px solid ${on ? HONG : 'rgba(255,255,255,.15)'}`,
                    opacity: off ? 0.25 : 1,
                    transform: on ? 'translateX(6px)' : 'none',
                    transition: 'all .35s cubic-bezier(.2,.7,.2,1)',
                  }}
                >
                  {choiceText(choice)}
                  <span
                    style={{
                      display: 'block',
                      marginTop: 4,
                      fontSize: 10.5,
                      fontWeight: 500,
                      letterSpacing: '.02em',
                      color: '#6F688F',
                    }}
                  >
                    {Object.entries(choice.axes)
                      .map(([key, value]) => {
                        const meta = AXES[key as keyof typeof AXES];
                        return `${meta.name} ${(value as number) > 0 ? '+' : ''}${value}`;
                      })
                      .join('  ')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
  );
}
