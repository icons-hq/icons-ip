'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DATA, type Card, type Game } from '@/lib/data';
import { RARITY_META, type RarityKey } from '@/lib/rarity';
import { loadBox2D } from '@/lib/games/box2d-loader';
import type { GrantedReward, PopupGameHost } from '@/lib/games/host';
import {
  COURSE,
  FIXED_STEP,
  MARBLE_RADIUS,
  RouletteSim,
  findWinner,
  type MarbleState,
} from '@/lib/games/roulette-sim';
import { seededRng, seededShuffle } from '@/lib/games/seed';

/* 마블 룰렛 렌더러 — PopupGameHost 인터페이스에만 의존한다(호스트 조립은 페이지 몫).
 * (c1) 사전 시뮬로 우승 구슬을 알아내 서버 보상 등급을 그 구슬에 배치하고,
 * 같은 시드로 화면 재생한다. 물리는 조작 없음, 결과는 100% 서버(mock). */

type Phase = 'ready' | 'loading' | 'racing' | 'reveal';

interface Granted {
  card: Card;
  reward: GrantedReward;
}

const RARITY_ORDER: RarityKey[] = ['HOLO', 'SSR', 'SR', 'R', 'N'];

/** 우승 구슬에 서버 보상 등급을 놓고, 나머지 확률 극장 라벨을 시드 셔플로 배치 */
function placeLabels(
  lineup: RarityKey[],
  granted: RarityKey,
  winnerIndex: number,
  seed: string,
): RarityKey[] {
  const rest = [...lineup];
  const at = rest.indexOf(granted);
  rest.splice(at >= 0 ? at : rest.length - 1, 1);
  const shuffled = seededShuffle(rest, seededRng(`${seed}:labels`));
  shuffled.splice(winnerIndex, 0, granted);
  return shuffled;
}

function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

let monoFamily: string | null = null;
function canvasMono(): string {
  if (monoFamily === null) {
    // next/font가 생성한 실제 패밀리명 — canvas font 문자열은 CSS var를 못 쓴다
    const v = getComputedStyle(document.documentElement).getPropertyValue('--font-space-mono');
    monoFamily = v.trim() || 'monospace';
  }
  return monoFamily;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  marbles: MarbleState[],
  labels: RarityKey[],
  highlight: number | null,
) {
  const scale = Math.min(w / COURSE.width, h / COURSE.height);
  const ox = (w - COURSE.width * scale) / 2;
  const oy = (h - COURSE.height * scale) / 2;
  const px = (mx: number) => ox + mx * scale;
  const py = (my: number) => oy + my * scale;

  ctx.clearRect(0, 0, w, h);

  // 코스 패널 — 토큰: surface 위 hairline(line)
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px(0), py(0), COURSE.width * scale, COURSE.height * scale, 12);
  ctx.fill();
  ctx.stroke();

  // 벽·깔때기·선반 — 토큰: line-2
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = Math.max(1.5, 0.07 * scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const seg of COURSE.walls) {
    ctx.moveTo(px(seg.x1), py(seg.y1));
    ctx.lineTo(px(seg.x2), py(seg.y2));
  }
  ctx.stroke();

  // 못 — 토큰: dim
  ctx.fillStyle = 'rgba(169,162,204,0.45)';
  for (const peg of COURSE.pegs) {
    ctx.beginPath();
    ctx.arc(px(peg.x), py(peg.y), Math.max(1.5, peg.r * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  // 골 라인 — 홀로 스펙트럼 점선
  const gy = py(COURSE.goalY);
  const grd = ctx.createLinearGradient(px(0.3), 0, px(9.7), 0);
  grd.addColorStop(0, '#2DE2FF');
  grd.addColorStop(0.34, '#8B5CFF');
  grd.addColorStop(0.66, '#FF4D9D');
  grd.addColorStop(1, '#FFB23D');
  ctx.strokeStyle = grd;
  ctx.lineWidth = Math.max(2, 0.09 * scale);
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(px(0.3), gy);
  ctx.lineTo(px(9.7), gy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(244,241,255,0.4)';
  ctx.font = `700 ${Math.max(9, 0.32 * scale)}px ${canvasMono()}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('GOAL', px(9.5), gy - 0.14 * scale);

  // 구슬
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < marbles.length; i++) {
    const m = marbles[i];
    const meta = RARITY_META[labels[i]];
    const x = px(m.x);
    const y = py(m.y);
    const r = MARBLE_RADIUS * scale;

    if (highlight === i) {
      ctx.save();
      ctx.shadowColor = meta.color;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1C1638'; // 토큰: surface-2
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.strokeStyle = meta.color;
    ctx.stroke();

    // 회전 노치 — 물리 스핀 가시화
    ctx.beginPath();
    ctx.arc(x + Math.cos(m.angle) * r * 0.62, y + Math.sin(m.angle) * r * 0.62, r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = `${meta.color}99`;
    ctx.fill();

    const label = meta.label;
    ctx.fillStyle = meta.color;
    ctx.font = `700 ${label.length <= 2 ? r * 0.78 : r * 0.42}px ${canvasMono()}`;
    ctx.fillText(label, x, y + 0.5);
  }
}

export function MarbleRoulette({ game, host }: { game: Game; host: PopupGameHost }) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [granted, setGranted] = useState<Granted | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<RouletteSim | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const simConfig = useMemo(() => ({ marbleCount: game.config.marbleCount }), [game]);

  const lineupCounts = useMemo(() => {
    const counts = new Map<RarityKey, number>();
    for (const r of game.config.rarityLineup) counts.set(r, (counts.get(r) ?? 0) + 1);
    return RARITY_ORDER.filter((r) => counts.has(r)).map((r) => ({ rarity: r, count: counts.get(r) as number }));
  }, [game]);

  useEffect(() => {
    host.track('game_view', { gameId: game.id });
  }, [host, game.id]);

  // 대기 상태 — 빈 코스를 그려 두고 리사이즈에 따라 다시 그린다
  useEffect(() => {
    if (phase !== 'ready' && phase !== 'loading') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const { ctx, w, h } = fitCanvas(canvas);
      drawFrame(ctx, w, h, [], [], null);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [phase]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      simRef.current?.destroy();
      simRef.current = null;
    },
    [],
  );

  const runRace = useCallback(
    (sim: RouletteSim, labels: RarityKey[], expectedWinner: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const stepMs = FIXED_STEP * 1000;
      let last = performance.now();
      let acc = 0;
      const loop = (now: number) => {
        // 탭 전환 복귀 시 누적 시간 폭주 방지
        acc = Math.min(acc + (now - last), 250);
        last = now;
        while (acc >= stepMs && sim.winner === null) {
          sim.step();
          acc -= stepMs;
        }
        const { ctx, w, h } = fitCanvas(canvas);
        drawFrame(ctx, w, h, sim.getMarbles(), labels, sim.winner);
        if (sim.winner === null) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        if (process.env.NODE_ENV !== 'production' && sim.winner !== expectedWinner) {
          console.error('[marble] 결정론 위반 — 사전 시뮬', expectedWinner, '재생', sim.winner);
        }
        host.haptics('success');
        host.track('game_result_view', { gameId: game.id });
        timeoutRef.current = setTimeout(() => setPhase('reveal'), 950);
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [host, game.id],
  );

  const play = useCallback(async () => {
    setPhase('loading');
    setGranted(null);
    host.track('game_play', { gameId: game.id });
    try {
      const [b2, result] = await Promise.all([loadBox2D(), host.playGame(game.id)]);
      const reward = result.rewards[0];
      const card = DATA.CARDS.find((c) => c.id === reward.cardId);
      if (!card) throw new Error(`unknown card: ${reward.cardId}`);
      // (c1) 헤드리스 사전 시뮬 → 우승 구슬에 서버 보상 라벨 배치 → 같은 시드로 재생
      const pre = findWinner(b2, result.animationSeed, simConfig);
      const labels = placeLabels(game.config.rarityLineup, reward.rarity, pre.winner, result.animationSeed);
      simRef.current?.destroy();
      const sim = new RouletteSim(b2, result.animationSeed, simConfig);
      simRef.current = sim;
      setGranted({ card, reward });
      setPhase('racing');
      runRace(sim, labels, pre.winner);
    } catch (error) {
      console.error('[marble] 플레이 실패', error);
      setPhase('ready');
    }
  }, [host, game, simConfig, runRace]);

  const share = useCallback(() => {
    if (!granted) return;
    void host.share({
      title: `${game.title} — ${granted.card.name} 획득!`,
      url: window.location.href,
    });
  }, [host, game.title, granted]);

  const meta = granted ? RARITY_META[granted.reward.rarity] : null;

  return (
    <div
      style={{
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 620,
        margin: '0 auto',
        padding: '18px 18px calc(16px + env(safe-area-inset-bottom))',
        position: 'relative',
        zIndex: 2,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--mint)' }}>온라인 팝업 · 참여형 게임</div>
          <h1 className="h-lg" style={{ margin: '10px 0 0', fontFamily: 'var(--ff-display)' }}>{game.title}</h1>
          <span className="mono" style={{ display: 'inline-block', marginTop: 8, fontSize: 10.5, letterSpacing: '.14em', color: 'var(--faint)', border: '1px solid var(--line-2)', borderRadius: 999, padding: '3px 10px' }}>
            PoC · MOCK RESULT
          </span>
        </div>
        <button type="button" className="icon-btn" aria-label="게임 닫기" onClick={() => host.close()}>✕</button>
      </header>

      <div style={{ flex: 1, minHeight: 340, position: 'relative', marginTop: 14 }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      </div>

      <div style={{ marginTop: 14 }}>
        {phase === 'racing' ? (
          <div className="mono" style={{ textAlign: 'center', fontSize: 12, color: 'var(--dim)', padding: '14px 0' }}>
            가장 먼저 골인하는 구슬이 보상을 공개합니다
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center' }}>
              {lineupCounts.map(({ rarity, count }) => (
                <span key={rarity} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', borderRadius: 999, fontSize: 11, border: `1px solid ${RARITY_META[rarity].color}55`, color: RARITY_META[rarity].color, background: 'rgba(255,255,255,.02)' }}>
                  <strong>{rarity}</strong> ×{count}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-holo"
                onClick={play}
                disabled={phase === 'loading'}
                style={{ height: 52, padding: '0 34px', fontSize: 15, opacity: phase === 'loading' ? 0.6 : 1 }}
              >
                {phase === 'loading' ? '결과 준비 중…' : phase === 'reveal' ? '다시 플레이' : '플레이'}
              </button>
            </div>
            <div className="money-caption" style={{ textAlign: 'center', marginTop: 12 }}>
              무상 리워드 · 결과는 서버가 결정하며 물리 연출은 장식입니다
            </div>
          </>
        )}
      </div>

      {phase === 'reveal' && granted && meta && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            background: 'rgba(8,6,15,.8)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ textAlign: 'center', animation: 'popIn .55s cubic-bezier(.2,.6,.2,1) both' }}>
            <div className="eyebrow">우승 구슬 · 카드 획득</div>
            <div
              style={{
                width: 'clamp(210px, 56vw, 264px)',
                aspectRatio: '5 / 7',
                margin: '18px auto 0',
                borderRadius: 18,
                position: 'relative',
                overflow: 'hidden',
                background: granted.card.bg,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                boxShadow: `0 0 0 1px ${meta.color}80, 0 34px 80px -26px rgba(0,0,0,.9), 0 0 60px -16px ${meta.color}66`,
              }}
            >
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
                  color: '#0A0813',
                  background: meta.foil ? 'var(--holo)' : meta.color,
                }}
              >
                {granted.reward.rarity}
              </span>
              {granted.reward.isNew && (
                <span
                  className="mono"
                  style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, letterSpacing: '.12em', padding: '4px 8px', borderRadius: 6, fontWeight: 700, color: 'var(--text)', background: 'rgba(8,6,15,.72)', border: '1px solid rgba(255,255,255,.25)' }}
                >
                  NEW
                </span>
              )}
              <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 58%, rgba(8,6,15,.9) 100%)' }} />
              <span style={{ position: 'absolute', left: 14, right: 14, bottom: 12, fontWeight: 700, fontSize: 15, textAlign: 'left' }}>
                {granted.card.name}
              </span>
            </div>
            <div className="mono" style={{ marginTop: 12, fontSize: 11.5, color: 'var(--dim)' }}>No. {granted.card.no}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 20 }}>
              <button type="button" className="btn btn-holo" onClick={play} style={{ height: 46, padding: '0 24px' }}>다시 플레이</button>
              <button type="button" className="btn btn-ghost" onClick={share} style={{ height: 46, padding: '0 20px' }}>공유</button>
              <button type="button" className="btn btn-ghost" onClick={() => host.close()} style={{ height: 46, padding: '0 20px' }}>닫기</button>
            </div>
            <div className="money-caption" style={{ marginTop: 14 }}>게임 보상 카드는 무상으로 발급됩니다 · PoC mock 결과</div>
          </div>
        </div>
      )}
    </div>
  );
}
