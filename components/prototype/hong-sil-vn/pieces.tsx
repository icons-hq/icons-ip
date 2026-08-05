'use client';

/* PROTOTYPE 공통 조각 — 버릴 코드다.
 * 변형끼리 공유해도 되는 건 "같은 물건"뿐이다: 카드 앞면, 일러스트 자리, 축 게이지.
 * 레이아웃·정보위계·주 어포던스는 각 변형이 스스로 정한다(공유 금지). */

import { RARITY_META, rarityTag, type RarityKey } from '@/lib/rarity';
import { artAssetUrl } from './art';
import {
  AXES,
  AXIS_ORDER,
  CARD_NO,
  CAST,
  artPlaceholder,
  type AnyEnding,
  type Axes,
  type Beat,
  type PlayState,
} from './story';

/** 지문·대사·속마음 조판. 문법은 셋이 같고, 크기와 명암만 변형이 정한다. */
export function BeatText({
  beat,
  dark = true,
  size = 14.5,
  muted = false,
}: {
  beat: Beat;
  dark?: boolean;
  size?: number;
  muted?: boolean;
}) {
  const ink = dark ? '#F4F1FF' : '#11110F';
  const soft = dark ? '#A9A2CC' : '#686862';
  const body = muted ? soft : ink;

  if (beat.kind === 'narration') {
    return <p style={{ margin: 0, fontSize: size, lineHeight: 1.9, color: body }}>{beat.text}</p>;
  }

  if (beat.kind === 'inner') {
    return (
      <p
        style={{
          margin: 0,
          fontSize: size,
          lineHeight: 1.9,
          fontStyle: 'italic',
          color: soft,
          paddingLeft: 14,
          borderLeft: `2px solid ${dark ? 'rgba(255,255,255,.14)' : 'rgba(17,17,15,.14)'}`,
        }}
      >
        ‘{beat.text}’
      </p>
    );
  }

  /* 퀘스트 문자 — 원작에서 미션은 문자로 온다. 지문과 섞이면 안 되므로 카드로 뗀다. */
  if (beat.kind === 'quest') {
    return (
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 10,
          border: `1px solid ${dark ? 'rgba(255,46,99,.55)' : 'rgba(156,0,29,.4)'}`,
          background: dark ? 'rgba(255,46,99,.1)' : 'rgba(156,0,29,.06)',
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 9.5, letterSpacing: '.2em', color: dark ? '#FF7A9E' : '#9C001D' }}
        >
          QUEST
        </div>
        <p style={{ margin: '6px 0 0', fontSize: size - 0.5, lineHeight: 1.7, fontWeight: 600, color: ink }}>
          {beat.text}
        </p>
      </div>
    );
  }

  const who = CAST[beat.who];
  return (
    <p style={{ margin: 0, fontSize: size, lineHeight: 1.9, color: ink }}>
      <span style={{ fontWeight: 700, color: who.color, marginRight: 7 }}>{who.name}</span>
      “{beat.text}”
    </p>
  );
}

/** 세 변형이 받는 동일한 계약. 상태는 PrototypeRoot가 들고 있고 변형은 그리기만 한다. */
export interface VariantProps {
  state: PlayState;
  ending: AnyEnding | null;
  /** 이번 플레이로 처음 얻은 카드인가 */
  isNew: boolean;
  onChoose: (choiceId: string) => void;
  onRewind: (step: number) => void;
  onRestart: () => void;
}

/** 정적 원화를 슬롯에 끼운다. 누락 슬롯은 발주 규모를 확인할 수 있게 기존 플레이스홀더로 남긴다. */
export function ArtPlate({
  slot,
  label,
  radius = 0,
  style,
}: {
  slot: string;
  label?: string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  const assetUrl = artAssetUrl(slot);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radius,
        background: artPlaceholder(slot),
        overflow: 'hidden',
        ...style,
      }}
    >
      {assetUrl ? (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
            backgroundImage: `url("${assetUrl}")`,
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'cover',
          }}
        />
      ) : (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.5,
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 2px, transparent 2px 9px)',
            }}
          />
          <span
            className="mono"
            style={{
              position: 'absolute',
              left: 10,
              bottom: 8,
              fontSize: 9.5,
              letterSpacing: '.14em',
              color: 'rgba(255,255,255,.5)',
              textTransform: 'uppercase',
            }}
          >
            ART {slot}
            {label ? ` · ${label}` : ''}
          </span>
        </>
      )}
    </div>
  );
}

/** 결말의 서사 컷 — 카드 앞면과 별도인 16:10 원화다. */
export function EndingIllustration({ ending }: { ending: AnyEnding }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 10',
        overflow: 'hidden',
        borderRadius: 14,
        background: '#0A0813',
        boxShadow: `0 22px 54px -30px ${ending.accent}88`,
      }}
    >
      <ArtPlate slot={ending.art} />
    </div>
  );
}

/** 엔딩 카드 앞면 — 세 변형이 같은 카드를 서로 다른 연출로 꺼낸다. */
export function EndingCard({
  ending,
  width = 260,
  sealed = false,
}: {
  ending: AnyEnding;
  width?: number;
  sealed?: boolean;
}) {
  const meta = RARITY_META[ending.rarity as RarityKey];
  const tag = rarityTag(ending.rarity as RarityKey);
  return (
    <div
      style={{
        width,
        aspectRatio: '5 / 7',
        position: 'relative',
        borderRadius: 18,
        overflow: 'hidden',
        background: '#0A0813',
        boxShadow: `0 0 0 1px ${meta.color}80, 0 34px 80px -26px rgba(0,0,0,.9), 0 0 60px -18px ${meta.color}66`,
      }}
    >
      <ArtPlate slot={ending.cardArt} />
      {meta.foil && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            mixBlendMode: 'color-dodge',
            opacity: 0.5,
            background:
              'linear-gradient(115deg, transparent 18%, rgba(45,226,255,.5), rgba(139,92,255,.4), rgba(255,77,157,.5), transparent 82%)',
          }}
        />
      )}
      <span
        className="mono"
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          fontSize: 11,
          letterSpacing: '.08em',
          padding: '4px 9px',
          borderRadius: 6,
          fontWeight: 700,
          color: tag.color,
          background: tag.bg,
          boxShadow: `0 0 0 1px ${tag.ring}`,
        }}
      >
        {ending.rarity}
      </span>
      {sealed && (
        <span
          className="mono"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            fontSize: 9.5,
            letterSpacing: '.12em',
            padding: '4px 8px',
            borderRadius: 6,
            fontWeight: 700,
            color: '#F4F1FF',
            background: 'rgba(8,6,15,.78)',
            border: '1px solid rgba(255,255,255,.24)',
          }}
        >
          나만 보임
        </span>
      )}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, transparent 52%, rgba(8,6,15,.94) 100%)',
        }}
      />
      <span
        className="mono"
        style={{ position: 'absolute', left: 14, bottom: 46, fontSize: 10.5, letterSpacing: '.14em', color: '#A9A2CC' }}
      >
        {CARD_NO(ending)}
      </span>
      <span
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: 16,
          fontWeight: 800,
          fontSize: 17,
          lineHeight: 1.25,
          color: '#F4F1FF',
          letterSpacing: '-.02em',
        }}
      >
        {ending.title}
      </span>
    </div>
  );
}

/** 축 게이지 — 변형 B만 플레이 중에 노출한다(자기 성향을 실시간으로 보여주는 게 B의 논지). */
export function AxisGauge({ axes, max = 7, dark = true }: { axes: Axes; max?: number; dark?: boolean }) {
  const ink = dark ? '#F4F1FF' : '#11110F';
  const track = dark ? 'rgba(255,255,255,.12)' : 'rgba(17,17,15,.12)';
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {AXIS_ORDER.map((key) => {
        const meta = AXES[key];
        const value = axes[key];
        const pct = Math.max(-1, Math.min(1, value / max));
        return (
          <div key={key} style={{ display: 'grid', gridTemplateColumns: '54px 1fr', alignItems: 'center', gap: 10 }}>
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', color: meta.color }}>
              {meta.name}
            </span>
            <div style={{ position: 'relative', height: 6, borderRadius: 999, background: track }}>
              <span
                aria-hidden
                style={{ position: 'absolute', left: '50%', top: -3, width: 1, height: 12, background: track }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  height: 6,
                  borderRadius: 999,
                  background: meta.color,
                  transition: 'left .35s cubic-bezier(.2,.7,.2,1), width .35s cubic-bezier(.2,.7,.2,1)',
                  left: pct >= 0 ? '50%' : `${50 + pct * 50}%`,
                  width: `${Math.abs(pct) * 50}%`,
                }}
              />
            </div>
            <span />
            <span style={{ fontSize: 10.5, color: dark ? '#6F688F' : '#858580', letterSpacing: '.02em' }}>
              {value === 0 ? '아직 기울지 않음' : value > 0 ? meta.plus : meta.minus}
              <span className="mono" style={{ marginLeft: 6, color: ink, opacity: 0.55 }}>
                {value > 0 ? `+${value}` : value}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
