'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DATA, krw, type Card, type Game, type Good } from '@/lib/data';
import { ipAccent } from '@/lib/ip-display';
import { RARITY_META, type RarityKey } from '@/lib/rarity';
import { loadBox2D } from '@/lib/games/box2d-loader';
import type { PopupGameHost } from '@/lib/games/host';
import {
  COURSE,
  FIXED_STEP,
  MARBLE_RADIUS,
  RouletteSim,
  findWinner,
  type MarbleState,
  type RotorState,
} from '@/lib/games/roulette-sim';
import { seededRng, seededShuffle } from '@/lib/games/seed';

/* 마블 룰렛 렌더러 — PopupGameHost 인터페이스에만 의존한다(호스트 조립은 페이지 몫).
 * (c1) 사전 시뮬로 우승 구슬을 알아내 서버 보상 라벨을 그 구슬에 배치하고,
 * 같은 시드로 화면 재생한다. 물리는 조작 없음, 결과는 100% 서버(mock).
 * 카메라: 출발 팩 전체 fit → 선두(최하단) 구슬 줌인 추적, 선두 교체 시 부드럽게 이동.
 * variant: 'card'=등급 구슬→무상 카드, 'goods'=굿즈 구슬 1:1(래플 연출 데모). */

type Phase = 'ready' | 'loading' | 'racing' | 'reveal';

type Granted =
  | { kind: 'card'; card: Card; rarity: RarityKey; isNew: boolean }
  | { kind: 'goods'; good: Good };

/** 구슬 하나의 시각 정체 — 등급이든 굿즈든 렌더러는 스킨만 안다 */
interface MarbleSkin {
  color: string;
  label: string;
  image: HTMLImageElement | null;
}

interface CamView {
  x: number;
  y: number;
  zoom: number; // px per meter
}

const RARITY_ORDER: RarityKey[] = ['HOLO', 'SSR', 'SR', 'R', 'N'];
/** 팩(출발 무리) 모드 → 선두 추적 모드로 전환하는 선두 깊이 */
const PACK_UNTIL_Y = 7.5;
/** 선두 교체 히스테리시스(m) — 카메라 포커스가 미세 역전으로 떨리지 않게 */
const LEAD_HYSTERESIS = 0.35;
/** 피날레 시작 깊이 — 카메라를 와이드로 빼 골 라인·디나이얼 존을 함께 보여준다 */
const FINALE_FROM_Y = 62;
/** 피날레 슬로모 배속 — 결과는 동일하고 재생만 느려진다(결정론 무관) */
const FINALE_TIME_SCALE = 0.55;

/** 우승 구슬에 서버가 정한 라벨을 놓고, 나머지를 시드 셔플로 배치 */
function placeLabels<T>(lineup: readonly T[], granted: T, winnerIndex: number, seed: string): T[] {
  const rest = [...lineup];
  const at = rest.indexOf(granted);
  rest.splice(at >= 0 ? at : rest.length - 1, 1);
  const shuffled = seededShuffle(rest, seededRng(`${seed}:labels`));
  shuffled.splice(winnerIndex, 0, granted);
  return shuffled;
}

/** mock 데이터의 CSS background 문자열에서 이미지 URL 추출 */
function imageUrlOf(bg: string): string | null {
  return bg.match(/url\("([^"]+)"\)/)?.[1] ?? null;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
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

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));

/** 선두 = 골에 가장 가까운(최하단) 구슬. 히스테리시스로 미세 역전은 무시 */
function pickLeader(marbles: MarbleState[], prev: number): number {
  let top = 0;
  for (let i = 1; i < marbles.length; i++) {
    if (marbles[i].y > marbles[top].y) top = i;
  }
  if (prev >= 0 && prev < marbles.length && marbles[top].y - marbles[prev].y < LEAD_HYSTERESIS) {
    return prev;
  }
  return top;
}

function updateCamera(
  cam: CamView,
  marbles: MarbleState[],
  leader: number,
  winner: number | null,
  w: number,
  h: number,
  dt: number,
) {
  let tx: number;
  let ty: number;
  let tzoom: number;
  const lead = marbles[leader];
  if (winner !== null) {
    // 우승 — 골인 구슬로 줌 펀치
    tzoom = w / 5.2;
    tx = lead.x;
    ty = lead.y;
  } else if (lead.y < PACK_UNTIL_Y) {
    // 출발 팩 — 모든 구슬이 보이게 확대 fit
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const m of marbles) {
      if (m.x < minX) minX = m.x;
      if (m.x > maxX) maxX = m.x;
      if (m.y < minY) minY = m.y;
      if (m.y > maxY) maxY = m.y;
    }
    const bw = maxX - minX + 2.6;
    const bh = maxY - minY + 2.6;
    tzoom = clamp(Math.min(w / bw, h / bh), w / 11, w / 6.5);
    tx = (minX + maxX) / 2;
    ty = (minY + maxY) / 2;
  } else if (lead.y > FINALE_FROM_Y) {
    // 피날레 — 와이드로 빼서 디나이얼 존과 골 라인이 함께 보이게
    tzoom = w / 8.5;
    tx = lead.x;
    ty = Math.min(lead.y + 1.2, COURSE.goalY - 2.0);
  } else {
    // 선두 추적
    tzoom = w / 7;
    tx = lead.x;
    ty = lead.y + 1.4;
  }
  const k = 1 - Math.exp(-dt * 4);
  cam.zoom += (tzoom - cam.zoom) * k;
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  const halfW = w / (2 * cam.zoom);
  const halfH = h / (2 * cam.zoom);
  cam.x = clamp(cam.x, halfW - 0.9, COURSE.width - halfW + 0.9);
  cam.y = clamp(cam.y, halfH - 1.2, COURSE.height - halfH + 1.5);
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: CamView,
  marbles: MarbleState[],
  rotors: RotorState[],
  skins: MarbleSkin[],
  highlight: number | null,
) {
  const { zoom } = view;
  const px = (mx: number) => (mx - view.x) * zoom + w / 2;
  const py = (my: number) => (my - view.y) * zoom + h / 2;
  const topY = view.y - h / (2 * zoom) - 3;
  const bottomY = view.y + h / (2 * zoom) + 3;

  ctx.clearRect(0, 0, w, h);

  // 코스 패널 — 토큰: surface 위 hairline(line)
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(px(0), py(Math.max(0, topY)), COURSE.width * zoom, (Math.min(COURSE.height, bottomY) - Math.max(0, topY)) * zoom);
  ctx.fill();
  ctx.stroke();

  // 벽·깔때기·선반 — 토큰: line-2
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(1.5, 0.08 * zoom);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const seg of COURSE.walls) {
    if (Math.max(seg.y1, seg.y2) < topY || Math.min(seg.y1, seg.y2) > bottomY) continue;
    ctx.moveTo(px(seg.x1), py(seg.y1));
    ctx.lineTo(px(seg.x2), py(seg.y2));
  }
  ctx.stroke();

  // 못 — 토큰: dim
  ctx.fillStyle = 'rgba(169,162,204,0.45)';
  for (const peg of COURSE.pegs) {
    if (peg.y < topY || peg.y > bottomY) continue;
    ctx.beginPath();
    ctx.arc(px(peg.x), py(peg.y), Math.max(1.5, peg.r * zoom), 0, Math.PI * 2);
    ctx.fill();
  }

  // 범퍼 — 고반발 경고색(cyan) 글로우
  for (const b of COURSE.bumpers) {
    if (b.y < topY || b.y > bottomY) continue;
    const bx = px(b.x);
    const by = py(b.y);
    const br = b.r * zoom;
    ctx.save();
    ctx.shadowColor = '#2DE2FF';
    ctx.shadowBlur = Math.min(16, br * 0.8);
    ctx.fillStyle = 'rgba(45,226,255,0.14)';
    ctx.strokeStyle = 'rgba(45,226,255,0.85)';
    ctx.lineWidth = Math.max(1.5, 0.06 * zoom);
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(45,226,255,0.9)';
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(1.5, br * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }

  // 회전 막대 — 방해요소(violet)
  for (const r of rotors) {
    if (r.y < topY || r.y > bottomY) continue;
    ctx.save();
    ctx.translate(px(r.x), py(r.y));
    ctx.rotate(r.angle);
    const len = r.halfLength * 2 * zoom;
    const th = Math.max(3, r.thickness * zoom);
    ctx.fillStyle = 'rgba(139,92,255,0.22)';
    ctx.strokeStyle = 'rgba(169,129,255,0.9)';
    ctx.lineWidth = Math.max(1.5, 0.05 * zoom);
    ctx.beginPath();
    ctx.roundRect(-len / 2, -th / 2, len, th, th / 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // 회전축
    ctx.fillStyle = 'rgba(169,129,255,0.9)';
    ctx.beginPath();
    ctx.arc(px(r.x), py(r.y), Math.max(2, 0.08 * zoom), 0, Math.PI * 2);
    ctx.fill();
  }

  // 골 라인 — 홀로 스펙트럼 점선
  if (COURSE.goalY > topY && COURSE.goalY < bottomY) {
    const gy = py(COURSE.goalY);
    const grd = ctx.createLinearGradient(px(0.3), 0, px(9.7), 0);
    grd.addColorStop(0, '#2DE2FF');
    grd.addColorStop(0.34, '#8B5CFF');
    grd.addColorStop(0.66, '#FF4D9D');
    grd.addColorStop(1, '#FFB23D');
    ctx.strokeStyle = grd;
    ctx.lineWidth = Math.max(2, 0.1 * zoom);
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(px(0.3), gy);
    ctx.lineTo(px(9.7), gy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(244,241,255,0.4)';
    ctx.font = `700 ${Math.max(9, 0.34 * zoom)}px ${canvasMono()}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('GOAL', px(9.5), gy - 0.14 * zoom);
  }

  // 구슬
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < marbles.length; i++) {
    const m = marbles[i];
    if (m.y < topY - 1 || m.y > bottomY + 1) continue;
    const skin = skins[i];
    const x = px(m.x);
    const y = py(m.y);
    const r = MARBLE_RADIUS * zoom;

    if (highlight === i) {
      ctx.save();
      ctx.shadowColor = skin.color;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = skin.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (skin.image) {
      // 굿즈 썸네일 구슬 — 이미지를 원으로 클립하고 회전에 맞춰 돌린다
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(x, y);
      ctx.rotate(m.angle);
      ctx.drawImage(skin.image, -r, -r, r * 2, r * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, r * 0.14);
      ctx.strokeStyle = skin.color;
      ctx.stroke();
      continue;
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1C1638'; // 토큰: surface-2
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.strokeStyle = skin.color;
    ctx.stroke();

    // 회전 노치 — 물리 스핀 가시화
    ctx.beginPath();
    ctx.arc(x + Math.cos(m.angle) * r * 0.62, y + Math.sin(m.angle) * r * 0.62, r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = `${skin.color}99`;
    ctx.fill();

    ctx.fillStyle = skin.color;
    ctx.font = `700 ${skin.label.length <= 2 ? r * 0.78 : r * 0.42}px ${canvasMono()}`;
    ctx.fillText(skin.label, x, y + 0.5);
  }
}

const goodById = (id: string): Good | undefined => DATA.GOODS.find((g) => g.id === id);

function goodAccent(good: Good): string {
  const ip = DATA.ipById(good.ip);
  return ip ? ipAccent(ip) : '#8B5CFF';
}

/** 등급 스킨(card variant) */
function raritySkins(labels: RarityKey[]): MarbleSkin[] {
  return labels.map((r) => ({ color: RARITY_META[r].color, label: RARITY_META[r].label, image: null }));
}

/** 굿즈 스킨(goods variant) — 썸네일 프리로드, 실패 시 라벨 폴백 */
async function goodsSkins(goodsIds: string[]): Promise<MarbleSkin[]> {
  return Promise.all(
    goodsIds.map(async (id) => {
      const good = goodById(id);
      if (!good) throw new Error(`unknown goods: ${id}`);
      const url = imageUrlOf(good.img);
      return {
        color: goodAccent(good),
        label: good.name.slice(0, 2),
        image: url ? await loadImage(url) : null,
      };
    }),
  );
}

export function MarbleRoulette({ game, host }: { game: Game; host: PopupGameHost }) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [granted, setGranted] = useState<Granted | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<RouletteSim | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const simConfig = useMemo(() => ({ marbleCount: game.config.marbleCount }), [game]);
  const variant = game.config.variant;

  const legend = useMemo(() => {
    if (variant.kind === 'card') {
      const counts = new Map<RarityKey, number>();
      for (const r of variant.rarityLineup) counts.set(r, (counts.get(r) ?? 0) + 1);
      return RARITY_ORDER.filter((r) => counts.has(r)).map((r) => ({
        key: r as string,
        color: RARITY_META[r].color,
        text: `${r} ×${counts.get(r)}`,
      }));
    }
    return variant.goodsIds.map((id) => {
      const good = goodById(id);
      return {
        key: id,
        color: good ? goodAccent(good) : '#8B5CFF',
        text: good ? (good.name.length > 9 ? `${good.name.slice(0, 9)}…` : good.name) : id,
      };
    });
  }, [variant]);

  useEffect(() => {
    host.track('game_view', { gameId: game.id });
  }, [host, game.id]);

  // 대기 상태 — 출발 구간 프리뷰를 그려 두고 리사이즈에 따라 다시 그린다
  useEffect(() => {
    if (phase !== 'ready' && phase !== 'loading') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const { ctx, w, h } = fitCanvas(canvas);
      drawFrame(ctx, w, h, { x: COURSE.width / 2, y: 5.6, zoom: w / 10.6 }, [], [], [], null);
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
    (sim: RouletteSim, skins: MarbleSkin[], expectedWinner: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const stepMs = FIXED_STEP * 1000;
      let last = performance.now();
      let acc = 0;
      let leader = -1;
      let finale = false;
      // 시작 카메라 — 출발 팩 위에서 시작해 첫 프레임부터 자연스럽게 fit
      const cam: CamView = { x: COURSE.width / 2, y: 3, zoom: canvas.clientWidth / 10.6 || 60 };
      const loop = (now: number) => {
        // 탭 전환 복귀 시 누적 시간 폭주 방지. 피날레에선 슬로모(재생만 감속)
        const frameMs = Math.min(now - last, 250);
        acc = Math.min(acc + frameMs * (finale ? FINALE_TIME_SCALE : 1), 250);
        last = now;
        while (acc >= stepMs && sim.winner === null) {
          sim.step();
          acc -= stepMs;
        }
        const { ctx, w, h } = fitCanvas(canvas);
        const marbles = sim.getMarbles();
        leader = sim.winner ?? pickLeader(marbles, leader);
        finale = sim.winner === null && marbles[leader].y > FINALE_FROM_Y;
        updateCamera(cam, marbles, leader, sim.winner, w, h, frameMs / 1000);
        drawFrame(ctx, w, h, cam, marbles, sim.getRotors(), skins, sim.winner);
        if (sim.winner === null) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        if (process.env.NODE_ENV !== 'production' && sim.winner !== expectedWinner) {
          console.error('[marble] 결정론 위반 — 사전 시뮬', expectedWinner, '재생', sim.winner);
        }
        host.haptics('success');
        host.track('game_result_view', { gameId: game.id });
        timeoutRef.current = setTimeout(() => setPhase('reveal'), 1200);
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
      // (c1) 헤드리스 사전 시뮬 → 우승 구슬에 서버 보상 라벨 배치 → 같은 시드로 재생
      const pre = findWinner(b2, result.animationSeed, simConfig);

      let skins: MarbleSkin[];
      let nextGranted: Granted;
      if (variant.kind === 'goods') {
        if (reward.kind !== 'goods') throw new Error('variant/reward mismatch');
        const good = goodById(reward.goodsId);
        if (!good) throw new Error(`unknown goods: ${reward.goodsId}`);
        const order = placeLabels(variant.goodsIds, reward.goodsId, pre.winner, result.animationSeed);
        skins = await goodsSkins(order);
        nextGranted = { kind: 'goods', good };
      } else {
        if (reward.kind !== 'card') throw new Error('variant/reward mismatch');
        const card = DATA.CARDS.find((c) => c.id === reward.cardId);
        if (!card) throw new Error(`unknown card: ${reward.cardId}`);
        const labels = placeLabels(variant.rarityLineup, reward.rarity, pre.winner, result.animationSeed);
        skins = raritySkins(labels);
        nextGranted = { kind: 'card', card, rarity: reward.rarity, isNew: reward.isNew };
      }

      simRef.current?.destroy();
      const sim = new RouletteSim(b2, result.animationSeed, simConfig);
      simRef.current = sim;
      setGranted(nextGranted);
      setPhase('racing');
      runRace(sim, skins, pre.winner);
    } catch (error) {
      console.error('[marble] 플레이 실패', error);
      setPhase('ready');
    }
  }, [host, game.id, variant, simConfig, runRace]);

  const share = useCallback(() => {
    if (!granted) return;
    const name = granted.kind === 'card' ? granted.card.name : granted.good.name;
    void host.share({
      title: `${game.title} — ${name} 획득!`,
      url: window.location.href,
    });
  }, [host, game.title, granted]);

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
            가장 먼저 골인하는 구슬이 {variant.kind === 'goods' ? '굿즈를' : '보상을'} 공개합니다
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center' }}>
              {legend.map((item) => (
                <span key={item.key} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', borderRadius: 999, fontSize: 11, border: `1px solid ${item.color}55`, color: item.color, background: 'rgba(255,255,255,.02)' }}>
                  {item.text}
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
              {variant.kind === 'goods'
                ? '래플 연출 데모 — 결과는 서버가 결정하며 물리 연출은 장식입니다'
                : '무상 리워드 · 결과는 서버가 결정하며 물리 연출은 장식입니다'}
            </div>
          </>
        )}
      </div>

      {phase === 'reveal' && granted && (
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
            {granted.kind === 'card' ? (
              <>
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
                    boxShadow: `0 0 0 1px ${RARITY_META[granted.rarity].color}80, 0 34px 80px -26px rgba(0,0,0,.9), 0 0 60px -16px ${RARITY_META[granted.rarity].color}66`,
                  }}
                >
                  {RARITY_META[granted.rarity].foil && (
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
                      background: RARITY_META[granted.rarity].foil ? 'var(--holo)' : RARITY_META[granted.rarity].color,
                    }}
                  >
                    {granted.rarity}
                  </span>
                  {granted.isNew && (
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
              </>
            ) : (
              <>
                <div className="eyebrow">우승 구슬 · 굿즈 추첨</div>
                <div
                  style={{
                    width: 'clamp(210px, 56vw, 264px)',
                    aspectRatio: '4 / 5',
                    margin: '18px auto 0',
                    borderRadius: 18,
                    position: 'relative',
                    overflow: 'hidden',
                    background: granted.good.img,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    boxShadow: `0 0 0 1px ${goodAccent(granted.good)}80, 0 34px 80px -26px rgba(0,0,0,.9), 0 0 60px -16px ${goodAccent(granted.good)}66`,
                  }}
                >
                  {granted.good.badge && (
                    <span
                      className="mono"
                      style={{ position: 'absolute', top: 10, left: 10, fontSize: 10.5, letterSpacing: '.08em', padding: '4px 9px', borderRadius: 6, fontWeight: 700, color: '#0A0813', background: goodAccent(granted.good) }}
                    >
                      {granted.good.badge}
                    </span>
                  )}
                  <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, rgba(8,6,15,.92) 100%)' }} />
                  <span style={{ position: 'absolute', left: 14, right: 14, bottom: 34, fontWeight: 700, fontSize: 15, textAlign: 'left' }}>
                    {granted.good.name}
                  </span>
                  <span className="mono" style={{ position: 'absolute', left: 14, bottom: 12, fontSize: 12.5, color: 'var(--dim)' }}>
                    {krw(granted.good.price)}
                  </span>
                </div>
              </>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 20 }}>
              <button type="button" className="btn btn-holo" onClick={play} style={{ height: 46, padding: '0 24px' }}>다시 플레이</button>
              <button type="button" className="btn btn-ghost" onClick={share} style={{ height: 46, padding: '0 20px' }}>공유</button>
              <button type="button" className="btn btn-ghost" onClick={() => host.close()} style={{ height: 46, padding: '0 20px' }}>닫기</button>
            </div>
            <div className="money-caption" style={{ marginTop: 14 }}>
              {granted.kind === 'goods'
                ? '래플 연출 데모 — 실물 굿즈 경품은 래플 당첨 후 정가 결제로 구매합니다 · PoC mock'
                : '게임 보상 카드는 무상으로 발급됩니다 · PoC mock 결과'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
