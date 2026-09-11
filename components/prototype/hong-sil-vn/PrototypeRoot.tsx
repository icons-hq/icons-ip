'use client';

/* PROTOTYPE 조립 지점 — 버릴 코드다.
 * 상태는 전부 여기서 들고(메모리만, 저장 없음), 변형은 그리기만 한다.
 * 엔딩 확정·카드 적립은 선택 핸들러 안에서 끝낸다 — effect에서 setState 하지 않는다. */

import { useCallback, useMemo, useState } from 'react';
import { AfterPopup } from './AfterPopup';
import { AgeGate, TrackPill } from './AgeGate';
import { Switcher, type VariantEntry } from './Switcher';
import { VariantA, NAME as NAME_A } from './VariantA';
import { VariantB, NAME as NAME_B } from './VariantB';
import { VariantC, NAME as NAME_C } from './VariantC';
import {
  ADULT_TRACK_SUMMARY,
  ART_SLOTS,
  ART_SLOT_COUNT,
  ENDINGS,
  SCENES,
  choose,
  initialPlay,
  isFinished,
  goodsForEnding,
  registerAdultTrack,
  resolveEnding,
  rewindTo,
  type PopupPhase,
  type Track,
} from './story';
import type { VariantProps } from './pieces';

const VARIANTS: VariantEntry[] = [
  { key: 'A', name: NAME_A },
  { key: 'B', name: NAME_B },
  { key: 'C', name: NAME_C },
];

const RENDERERS: Record<string, React.ComponentType<VariantProps>> = {
  A: VariantA,
  B: VariantB,
  C: VariantC,
};

export function PrototypeRoot({
  initialVariant,
  requestAdult = false,
}: {
  initialVariant: string;
  /** ?track=adult 로 들어왔는가. 요청일 뿐이고 진입은 게이트가 정한다. */
  requestAdult?: boolean;
}) {
  const [variant, setVariant] = useState(RENDERERS[initialVariant] ? initialVariant : 'A');
  const [play, setPlay] = useState(initialPlay);

  /* ── 트랙 ──────────────────────────────────────────────────────────────
   * 성인 비트는 별도 청크(story-adult)라 게이트를 통과해야 받는다.
   * 전연령 플레이는 그 청크를 아예 요청하지 않는다. */
  const [track, setTrack] = useState<Track>('all-ages');
  const [adultLoaded, setAdultLoaded] = useState(false);
  const [gateOpen, setGateOpen] = useState(requestAdult);

  const requestAdultTrack = useCallback(() => {
    // 이미 받아 둔 청크면 게이트를 다시 띄우지 않는다 — 동의는 세션당 한 번이다.
    if (adultLoaded) {
      setTrack('adult');
      return;
    }
    setGateOpen(true);
  }, [adultLoaded]);

  const acceptGate = useCallback(async () => {
    const mod = await import('./story-adult');
    registerAdultTrack(mod.ADULT_BEATS);
    setAdultLoaded(true);
    setTrack('adult');
    setGateOpen(false);
  }, []);

  const declineGate = useCallback(() => {
    setGateOpen(false);
    setTrack('all-ages');
  }, []);
  const [collected, setCollected] = useState<Set<string>>(() => new Set());
  const [isNew, setIsNew] = useState(false);
  const [phase, setPhase] = useState<PopupPhase>('sealed');
  // 잠금 규칙 = 도달 이력 + 팝업 기간. 한 번 닿으면 팝업이 끝날 때까지 계속 살 수 있다.
  const [unlockedGoods, setUnlockedGoods] = useState<Set<string>>(() => new Set());

  const ending = useMemo(
    () => (isFinished(play) ? resolveEnding({ axes: play.axes, flags: play.flags }) : null),
    [play],
  );

  // 갱신 함수 안에서 다른 setState를 부르면 StrictMode에서 두 번 돌아 적립이 어긋난다.
  // 현재 값으로 바깥에서 계산하고, 갱신 함수는 순수하게 둔다.
  const onChoose = useCallback(
    (choiceId: string) => {
      const next = choose(play, choiceId);
      setPlay(next);
      if (!isFinished(next)) return;
      const reached = resolveEnding({ axes: next.axes, flags: next.flags });
      setIsNew(!collected.has(reached.id));
      setCollected((owned) => (owned.has(reached.id) ? owned : new Set(owned).add(reached.id)));
      const goodsId = goodsForEnding(reached).id;
      setUnlockedGoods((open) => (open.has(goodsId) ? open : new Set(open).add(goodsId)));
    },
    [play, collected],
  );

  const onRewind = useCallback((step: number) => setPlay((prev) => rewindTo(prev, step)), []);
  const onRestart = useCallback(() => setPlay(initialPlay()), []);

  const Render = RENDERERS[variant] ?? VariantA;

  return (
    <>
      <Render
        state={play}
        track={track}
        ending={ending}
        isNew={isNew}
        onChoose={onChoose}
        onRewind={onRewind}
        onRestart={onRestart}
      />

      {/* 봉인/공개 표면은 변형과 무관한 별개 질문이라 셋이 공유한다 */}
      <div style={{ background: '#0A0813' }}>
        <AfterPopup collected={collected} unlockedGoods={unlockedGoods} phase={phase} onPhaseChange={setPhase} />

        <div
          style={{
            maxWidth: 680,
            margin: '0 auto',
            padding: '0 18px 120px',
            fontSize: 11.5,
            lineHeight: 1.75,
            color: '#6F688F',
          }}
        >
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.2em', color: '#FFB23D', marginBottom: 10 }}>
            PROTOTYPE 메모
          </div>
          <p style={{ margin: 0 }}>
            장면 {SCENES.length}개 × 선택지 3개 = 경로 {3 ** SCENES.length}개 → 엔딩 {ENDINGS.length}개.
            엔딩은 <b style={{ color: '#A9A2CC' }}>우세축 6 × 종막 3 = 18</b> + 특수 2로 나온다.
            축이나 종막 선택지를 늘리면 엔딩 수가 따라 늘어난다(= 개수 자유조정).
          </p>
          <p style={{ margin: '10px 0 0' }}>
            일러스트 {ART_SLOT_COUNT}컷 연결 완료 — 장면 배경 {ART_SLOTS.sceneBackgrounds},
            선택지 컷 {ART_SLOTS.choiceCuts}, 엔딩 컷 {ART_SLOTS.endingCuts}, 카드 앞면 {ART_SLOTS.cardFronts}.
            누락 슬롯만 절차적 그라디언트 자리표시자로 표시된다.
          </p>
          <p style={{ margin: '10px 0 0' }}>
            저장 없음(새로고침하면 바인더가 비워진다) · 서버 없음 · 결제 미배선.
            실제 배선에서는 엔딩 판정과 카드 발급이 서버 RPC 몫이다(ADR-0002).
          </p>
        </div>
      </div>

      <TrackPill
        track={track}
        adultLoaded={adultLoaded}
        onRequestAdult={requestAdultTrack}
        onBackToAllAges={() => setTrack('all-ages')}
      />
      <Switcher variants={VARIANTS} current={variant} onChange={setVariant} />

      {gateOpen && (
        <AgeGate
          sceneCount={ADULT_TRACK_SUMMARY.scenes}
          gapCount={ADULT_TRACK_SUMMARY.gaps}
          onAccept={acceptGate}
          onDecline={declineGate}
        />
      )}
    </>
  );
}
