'use client';

/* PROTOTYPE — 분기 노드 보드. 버릴 코드다.
 *
 * 라운드를 컬럼으로 세우고, 선택지를 썸네일 카드로 놓고, 곡선 엣지로 잇는다.
 * 밝은 보고서 페이지 안에 박히는 어두운 도판이다(DESIGN.md의 역상 미디어 면).
 *
 * 좌표는 아래 상수에서 전부 계산한다 — DOM 측정도, effect도, ResizeObserver도 없다.
 * viewBox 하나로 컨테이너 폭에 맞춰 정확히 스케일된다.
 *
 * 엣지는 손으로 적지 않고 enumeratePaths()의 81경로에서 인접쌍을 뽑아 만든다.
 * 그래서 시나리오를 고치면 그림이 저절로 따라온다. */

import { useMemo, useState } from 'react';
import { RARITY_META, type RarityKey } from '@/lib/rarity';
import { artAssetUrl } from './art';
import {
  AXES,
  AXIS_ORDER,
  CARD_NO,
  ENDINGS,
  FINALE_LABEL,
  SCENES,
  endingsReachableFrom,
  enumerateAll,
  enumeratePaths,
  type FinaleFlag,
} from './story';

/* ── 레이아웃 상수 ─────────────────────────────────────────────────────── */
const CARD_W = 156;
const CARD_H = 130;
const INSET = 6;
const IMG_H = 80;
const ROW_GAP = 22;
const COL_GAP = 96;
const SUB_GAP = 24;
const PAD = 28;
const HEAD_H = 58;

/* ── 도판 색 ───────────────────────────────────────────────────────────── */
const BOARD_BG = '#1B1815';
const CARD_BG = '#221E1A';
const INK = '#F3F0EA';
const DIM = '#A29A8E';
const FAINT = '#6E675E';
const EDGE = '#9C9284';
const HONG = '#FF2E63';

const FINALE_ORDER: readonly FinaleFlag[] = ['remember', 'release', 'restart'];
const FINALE_COLOR: Record<FinaleFlag, string> = {
  remember: '#FF7A9E',
  release: '#7FC7E8',
  restart: '#C9B06B',
};

interface CardNode {
  id: string;
  x: number;
  y: number;
  title: string;
  meta: string;
  art: string;
  color: string;
  /** 결말 카드만 — 등급 배지 */
  rarity?: RarityKey;
}

export function BranchBoard() {
  const enumeration = useMemo(() => enumerateAll(), []);
  const [picked, setPicked] = useState<{ sceneIndex: number; choiceId: string } | null>(null);

  const graph = useMemo(() => {
    const paths = enumeratePaths();
    const last = SCENES.length - 1;

    // 라운드 간 인접쌍 + 최종 선택→결말 쌍. 중복 제거만 하면 그대로 엣지다.
    const between = new Set<string>();
    const toEnding = new Set<string>();
    for (const path of paths) {
      for (let i = 0; i < last; i += 1) between.add(`${path.choiceIds[i]}>${path.choiceIds[i + 1]}`);
      toEnding.add(`${path.choiceIds[last]}>${path.endingId}`);
    }

    // 결말이 어느 종막에 붙는지도 위 쌍에서 나온다(특수 결말 포함) — 별도 데이터가 필요 없다.
    const finaleOfChoice = new Map<string, FinaleFlag>();
    for (const choice of SCENES[last].choices) {
      const flag = choice.flags?.find((f) => (FINALE_ORDER as readonly string[]).includes(f));
      if (flag) finaleOfChoice.set(choice.id, flag as FinaleFlag);
    }
    const finaleOfEnding = new Map<string, FinaleFlag>();
    for (const pair of toEnding) {
      const [choiceId, endingId] = pair.split('>');
      const finale = finaleOfChoice.get(choiceId);
      if (finale) finaleOfEnding.set(endingId, finale);
    }

    return {
      edges: [...between, ...toEnding].map((p) => p.split('>') as [string, string]),
      finaleOfChoice,
      finaleOfEnding,
    };
  }, []);

  /* ── 노드 배치 ───────────────────────────────────────────────────────── */
  const layout = useMemo(() => {
    const groups = FINALE_ORDER.map((finale) => ({
      finale,
      endings: ENDINGS.filter((e) => graph.finaleOfEnding.get(e.id) === finale),
    }));
    const maxEndingRows = Math.max(...groups.map((g) => g.endings.length));
    const blockH = maxEndingRows * CARD_H + (maxEndingRows - 1) * ROW_GAP;
    const top = PAD + HEAD_H;

    const colX = (i: number) => PAD + i * (CARD_W + COL_GAP);
    const endX = (i: number) => colX(SCENES.length) + i * (CARD_W + SUB_GAP);
    // 결말 열은 촘촘히 쌓고(세로 중앙), 선택지 열은 블록 높이 전체로 펼친다.
    // 펼쳐야 엣지가 부채꼴로 갈라져 "여기서 갈린다"가 그림으로 읽힌다.
    const stackY = (n: number, row: number) =>
      top + (blockH - (n * CARD_H + (n - 1) * ROW_GAP)) / 2 + row * (CARD_H + ROW_GAP);
    const spreadY = (n: number, row: number) =>
      n < 2 ? top + (blockH - CARD_H) / 2 : top + (row * (blockH - CARD_H)) / (n - 1);

    const nodes = new Map<string, CardNode>();

    SCENES.forEach((scene, sceneIndex) => {
      scene.choices.forEach((choice, row) => {
        const finale = graph.finaleOfChoice.get(choice.id);
        nodes.set(choice.id, {
          id: choice.id,
          x: colX(sceneIndex),
          y: spreadY(scene.choices.length, row),
          title: choice.short,
          meta: AXIS_ORDER.filter((k) => choice.axes[k])
            .map((k) => `${AXES[k].name.slice(0, 1)}${(choice.axes[k] as number) > 0 ? '+' : ''}${choice.axes[k]}`)
            .join('  '),
          art: choice.art,
          color: finale ? FINALE_COLOR[finale] : '#8C8378',
        });
      });
    });

    groups.forEach((group, gi) => {
      group.endings.forEach((ending, row) => {
        const share = enumeration.stats.find((s) => s.ending.id === ending.id)?.share ?? 0;
        nodes.set(ending.id, {
          id: ending.id,
          x: endX(gi),
          y: stackY(group.endings.length, row),
          title: ending.title,
          meta: `${CARD_NO(ending)}  ${(share * 100).toFixed(1)}%`,
          art: ending.art,
          color: FINALE_COLOR[group.finale],
          rarity: ending.rarity as RarityKey,
        });
      });
    });

    return {
      nodes,
      groups,
      colX,
      endX,
      top,
      width: endX(FINALE_ORDER.length - 1) + CARD_W + PAD,
      height: top + blockH + PAD,
    };
  }, [graph, enumeration]);

  /* ── 하이라이트 ─────────────────────────────────────────────────────── */
  const reachable = useMemo(
    () => (picked ? endingsReachableFrom(picked.sceneIndex, picked.choiceId) : null),
    [picked],
  );

  const isLit = (id: string): boolean => {
    if (!picked || !reachable) return true;
    const scene = SCENES[picked.sceneIndex];
    if (scene.choices.some((c) => c.id === id)) return id === picked.choiceId;
    if (ENDINGS.some((e) => e.id === id)) return reachable.has(id);
    return true;
  };

  const pickedChoice = picked ? SCENES[picked.sceneIndex].choices.find((c) => c.id === picked.choiceId) : null;

  return (
    <div>
      {/* 도판은 자기 안에서만 가로 스크롤한다 — 페이지 본문은 밀리지 않는다 */}
      <div style={{ overflowX: 'auto', borderRadius: 16, background: BOARD_BG, WebkitOverflowScrolling: 'touch' }}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ display: 'block', width: '100%', minWidth: 1100, height: 'auto' }}
          role="img"
          aria-label={`홍실 퀘스트 분기 지도 — 라운드 ${SCENES.length}개와 결말 ${ENDINGS.length}개`}
        >
          <defs>
            {[...layout.nodes.values()].map((node) => (
              <clipPath key={node.id} id={`hsq-clip-${node.id}`}>
                <rect x={node.x + INSET} y={node.y + INSET} width={CARD_W - INSET * 2} height={IMG_H} rx={7} />
              </clipPath>
            ))}
          </defs>

          {/* 컬럼 머리 */}
          {SCENES.map((scene, i) => (
            <g key={scene.id}>
              <text x={layout.colX(i)} y={PAD + 16} fontSize={15} fontWeight={800} fill={INK}>
                {scene.act}
              </text>
              <text x={layout.colX(i)} y={PAD + 36} fontSize={12} fill={FAINT}>
                {['①', '②', '③', '④'][i]} {scene.place.split(' — ')[0]}
              </text>
            </g>
          ))}
          <text x={layout.endX(0)} y={PAD + 16} fontSize={15} fontWeight={800} fill={INK}>
            결말 {ENDINGS.length}
          </text>
          <text x={layout.endX(0)} y={PAD + 36} fontSize={12} fill={FAINT}>
            ⑤ 종막 갈래별 · 카드 + 한정 굿즈 연결
          </text>
          {layout.groups.map((group, gi) => (
            <text
              key={group.finale}
              x={layout.endX(gi)}
              y={layout.top - 10}
              fontSize={12}
              fontWeight={700}
              fill={FINALE_COLOR[group.finale]}
            >
              {FINALE_LABEL[group.finale]} · {group.endings.length}
            </text>
          ))}

          {/* 엣지 — 카드보다 먼저 그려 뒤로 깐다 */}
          <g fill="none">
            {graph.edges.map(([from, to]) => {
              const a = layout.nodes.get(from);
              const b = layout.nodes.get(to);
              if (!a || !b) return null;
              const lit = isLit(from) && isLit(to);
              const x1 = a.x + CARD_W;
              const y1 = a.y + CARD_H / 2;
              const x2 = b.x;
              const y2 = b.y + CARD_H / 2;
              const dx = (x2 - x1) * 0.45;
              return (
                <path
                  key={`${from}>${to}`}
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  stroke={picked && lit ? HONG : EDGE}
                  strokeWidth={picked && lit ? 1.8 : 1.1}
                  opacity={lit ? (picked ? 0.9 : 0.42) : 0.05}
                />
              );
            })}
          </g>

          {/* 카드 */}
          {[...layout.nodes.values()].map((node) => {
            const lit = isLit(node.id);
            const sceneIndex = SCENES.findIndex((s) => s.choices.some((c) => c.id === node.id));
            const clickable = sceneIndex >= 0;
            const on = picked?.choiceId === node.id;
            const url = artAssetUrl(node.art);
            return (
              <g
                key={node.id}
                opacity={lit ? 1 : 0.16}
                style={{ cursor: clickable ? 'pointer' : 'default', transition: 'opacity .25s ease' }}
                onClick={
                  clickable
                    ? () => setPicked(on ? null : { sceneIndex, choiceId: node.id })
                    : undefined
                }
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={CARD_W}
                  height={CARD_H}
                  rx={11}
                  fill={CARD_BG}
                  stroke={on ? HONG : node.color}
                  strokeWidth={on ? 2 : 1}
                  opacity={on ? 1 : 0.85}
                />
                {url ? (
                  <image
                    href={url}
                    x={node.x + INSET}
                    y={node.y + INSET}
                    width={CARD_W - INSET * 2}
                    height={IMG_H}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#hsq-clip-${node.id})`}
                  />
                ) : (
                  <rect
                    x={node.x + INSET}
                    y={node.y + INSET}
                    width={CARD_W - INSET * 2}
                    height={IMG_H}
                    rx={7}
                    fill="#332B24"
                  />
                )}
                {node.rarity && (
                  <>
                    <rect
                      x={node.x + CARD_W - INSET - 34}
                      y={node.y + INSET + 6}
                      width={28}
                      height={15}
                      rx={4}
                      fill={RARITY_META[node.rarity].color}
                    />
                    <text
                      x={node.x + CARD_W - INSET - 20}
                      y={node.y + INSET + 17}
                      fontSize={10}
                      fontWeight={700}
                      textAnchor="middle"
                      fill="#17140F"
                      style={{ fontFamily: 'var(--ff-mono)' }}
                    >
                      {node.rarity}
                    </text>
                  </>
                )}
                <text x={node.x + INSET + 5} y={node.y + INSET + IMG_H + 22} fontSize={13.5} fontWeight={700} fill={INK}>
                  {node.title}
                </text>
                <text
                  x={node.x + INSET + 5}
                  y={node.y + INSET + IMG_H + 37}
                  fontSize={11}
                  fill={DIM}
                  style={{ fontFamily: 'var(--ff-mono)' }}
                >
                  {node.meta}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: '13px 15px',
          borderRadius: 12,
          background: pickedChoice ? '#FFF6F7' : 'rgba(17,17,15,.04)',
          border: `1px solid ${pickedChoice ? '#9C001D' : 'rgba(17,17,15,.08)'}`,
        }}
      >
        {pickedChoice && reachable ? (
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: '#11110F' }}>
            <b>{pickedChoice.label}</b> — 이 선택을 하면 결말{' '}
            <b style={{ color: '#9C001D' }}>{reachable.size}개</b>가 남고{' '}
            <b>{ENDINGS.length - reachable.size}개</b>가 닫힌다. 한 번 더 누르면 전체로 돌아간다.
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: '#686862' }}>
            카드를 눌러 보세요. 그 선택이 어떤 결말을 열고 닫는지 도판에서 바로 보입니다. 좌우로 스크롤하면 전체가 보입니다.
          </p>
        )}
      </div>
    </div>
  );
}
