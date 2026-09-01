'use client';

/* PROTOTYPE 연령 게이트 — 버릴 코드다.
 *
 * 이 화면은 **실제 연령 확인이 아니다.** 프로토타입이라 자가 확인 버튼 하나로
 * 통과시킨다. 실서비스에서 이 자리에 들어가야 하는 것은 아래 §미배선에 적었고,
 * 화면에도 그대로 노출한다 — 검토자가 "이걸로 출시 가능하다"고 오해하면 안 된다.
 *
 * 통과하면 PrototypeRoot가 story-adult.ts를 동적 import 한다. 전연령 플레이는
 * 그 청크를 아예 받지 않는다. 실서비스에서는 이 전달을 서버가 맡는다
 * (docs/ip/hong-sil-quest/adult-track.md §4). */

import { TRACK_LABEL, type Track } from './story';

const INK = '#F4F1FF';
const DIM = '#A9A2CC';
const FAINT = '#6F688F';
const HONG = '#FF2E63';

/** 실서비스 전환 시 이 자리를 채워야 하는 것들. 화면에 그대로 띄운다. */
const UNWIRED = [
  '본인인증(PASS 등) — 지금은 자가 확인 버튼뿐이다. 도입 예정',
  '게임물 등급분류 — 청소년이용불가 신청 여부·결과 미확정',
  '서버 게이팅 — 지금은 클라이언트가 청크를 부른다. 실서비스는 서버가 세션에 바인딩해 내려보내야 한다',
  '계정 단위 동의 저장 — 지금은 새로고침하면 지워지는 메모리 상태다',
];

export function AgeGate({
  sceneCount,
  gapCount,
  onAccept,
  onDecline,
}: {
  /** 확장본이 있는 라운드 수 */
  sceneCount: number;
  /** 원작자 집필 슬롯 수 */
  gapCount: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="성인 트랙 연령 확인"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        overflowY: 'auto',
        background: 'radial-gradient(120% 80% at 50% 0%, #2A0009 0%, #08060F 62%, #050308 100%)',
      }}
    >
      <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: '56px 20px 80px' }}>
        <div style={{ maxWidth: 460, width: '100%' }}>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.22em', color: HONG }}>
            ADULT TRACK · 연령 확인
          </div>
          <h2
            style={{
              margin: '12px 0 0',
              fontSize: 'clamp(24px, 6vw, 32px)',
              fontWeight: 850,
              lineHeight: 1.16,
              letterSpacing: '-.03em',
              color: INK,
            }}
          >
            성인 트랙으로 들어갑니다
          </h2>

          <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.85, color: DIM }}>
            원작 수위에 맞춘 확장 트랙입니다. {sceneCount}개 라운드의 본문이 성인판으로 바뀝니다.
            축·선택지·결말 판정은 전연령 트랙과 같아서, 어떤 결말에 닿는지는 달라지지 않습니다.
          </p>

          <div
            style={{
              marginTop: 16,
              padding: '13px 15px',
              borderRadius: 12,
              background: 'rgba(255,46,99,.08)',
              border: '1px solid rgba(255,46,99,.4)',
            }}
          >
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.16em', color: '#FF7A9E' }}>
              집필 슬롯 {gapCount}곳
            </div>
            <p style={{ margin: '7px 0 0', fontSize: 12.5, lineHeight: 1.8, color: DIM }}>
              정사 장면 본문은 이 프로토타입에 들어 있지 않습니다. 장면 경계와 전후 감정만 확정해 두고,
              해당 구간은 화면에 <b style={{ color: INK }}>집필 슬롯</b>으로 표시됩니다. 원작자 검수·집필분이
              들어갈 자리입니다.
            </p>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: '13px 15px',
              borderRadius: 12,
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.14)',
            }}
          >
            <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.16em', color: '#FFB23D' }}>
              미배선 — 이 화면은 실제 연령 확인이 아니다
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 16, display: 'grid', gap: 5 }}>
              {UNWIRED.map((item) => (
                <li key={item} style={{ fontSize: 12, lineHeight: 1.7, color: FAINT }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <p style={{ margin: '16px 0 0', fontSize: 12, lineHeight: 1.75, color: FAINT }}>
            미성년 시절이 등장하는 라운드(전생 · 이름을 지은 보름 / 첫 매듭)는 어떤 트랙에서도 확장하지 않습니다.
          </p>

          <div style={{ display: 'flex', gap: 9, marginTop: 22, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onAccept}
              style={{
                flex: '1 1 190px',
                height: 48,
                borderRadius: 999,
                fontWeight: 800,
                fontSize: 13.5,
                cursor: 'pointer',
                color: '#0A0813',
                background: INK,
                border: 'none',
              }}
            >
              만 19세 이상입니다 · 들어가기
            </button>
            <button
              type="button"
              onClick={onDecline}
              style={{
                flex: '0 1 140px',
                height: 48,
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 13.5,
                cursor: 'pointer',
                color: INK,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,.3)',
              }}
            >
              전연령으로 볼게요
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 트랙 전환 알약. 변형 스위처 바로 위에 붙어서, 검토자가 두 트랙을 나란히 본다. */
export function TrackPill({
  track,
  adultLoaded,
  onRequestAdult,
  onBackToAllAges,
}: {
  track: Track;
  /** 성인 청크를 이미 받았는가 — 두 번째부터는 게이트를 다시 띄우지 않는다 */
  adultLoaded: boolean;
  onRequestAdult: () => void;
  onBackToAllAges: () => void;
}) {
  const adult = track === 'adult';
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(64px + env(safe-area-inset-bottom))',
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 6px',
        borderRadius: 999,
        background: 'rgba(8,6,15,.92)',
        border: `1px solid ${adult ? 'rgba(255,46,99,.6)' : 'rgba(255,255,255,.22)'}`,
        boxShadow: '0 18px 44px -20px rgba(0,0,0,.9)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <span className="mono" style={{ fontSize: 9, letterSpacing: '.18em', color: FAINT, padding: '0 6px' }}>
        TRACK
      </span>
      {(['all-ages', 'adult'] as const).map((key) => {
        const active = track === key;
        return (
          <button
            key={key}
            type="button"
            onClick={key === 'adult' ? onRequestAdult : onBackToAllAges}
            aria-pressed={active}
            style={{
              height: 28,
              padding: '0 13px',
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              color: active ? '#0A0813' : INK,
              background: active ? (key === 'adult' ? HONG : INK) : 'transparent',
              border: 'none',
            }}
          >
            {TRACK_LABEL[key]}
            {key === 'adult' && !adultLoaded ? ' 🔒' : ''}
          </button>
        );
      })}
    </div>
  );
}
