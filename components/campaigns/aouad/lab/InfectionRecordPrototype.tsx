'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useReducer } from 'react';
import { AOUAD_IMAGES, AOUAD_POPUP_PATH } from '@/lib/campaigns/aouad/content';
import {
  createAouadComparisonResult,
  saveAouadComparisonResult,
  type AouadComparisonResult,
} from '@/lib/campaigns/aouad/lab/comparison';
import {
  advanceInfectionRecord,
  initialInfectionRecordState,
  type InfectionRecordChoice,
  type InfectionRecordState,
} from '@/lib/campaigns/aouad/lab/infection-record';
import { ComparisonResultActions } from './ComparisonResultActions';
import styles from './aouad-lab.module.css';

type InfectionRun = { runId: string; startedAt: string; startedPerformance: number };
type InfectionViewState = {
  story: InfectionRecordState;
  run: InfectionRun | null;
  retryCount: number;
  result: AouadComparisonResult | null;
};

type InfectionViewAction =
  | { type: 'start'; run: InfectionRun }
  | { type: 'choose'; choice: InfectionRecordChoice; completedAt: string; activeDurationMs: number }
  | { type: 'retry' };

const initialViewState: InfectionViewState = {
  story: initialInfectionRecordState,
  run: null,
  retryCount: 0,
  result: null,
};

function infectionRunId(now: number): string {
  return `infection-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function infectionReducer(state: InfectionViewState, action: InfectionViewAction): InfectionViewState {
  if (action.type === 'start') return { ...state, story: advanceInfectionRecord(initialInfectionRecordState, 'start'), run: action.run, result: null };
  if (action.type === 'retry') return { ...initialViewState, retryCount: state.retryCount + 1 };
  if (!state.run || state.story.stage === 'briefing' || state.story.stage === 'result') return state;
  const story = advanceInfectionRecord(state.story, action.choice);
  if (!story.resultType) return { ...state, story };
  return {
    ...state,
    story,
    result: createAouadComparisonResult({
      candidateId: 'infection-record',
      runId: state.run.runId,
      startedAt: state.run.startedAt,
      completedAt: action.completedAt,
      activeDurationMs: action.activeDurationMs,
      retryCount: state.retryCount,
      resultType: story.resultType,
    }),
  };
}

const sceneCopy = {
  hallway: {
    eyebrow: '교실 밖 · 복도',
    title: '발소리가 두 방향에서 겹친다.',
    text: '문을 열기 전에, 당신은 가장 가까운 신호 하나를 선택해야 한다.',
    image: AOUAD_IMAGES.classroom,
    choices: [
      ['listen', '문틈에서 소리를 먼저 읽는다'],
      ['rush', '복도 끝까지 단숨에 달린다'],
    ],
  },
  broadcast: {
    eyebrow: '방송실 앞 · 끊긴 신호',
    title: '무전기에서 누군가의 숨소리가 난다.',
    text: '응답은 길을 열 수 있지만, 당신의 위치도 알려줄 수 있다.',
    image: AOUAD_IMAGES.broadcast,
    choices: [
      ['relay', '짧게 응답하고 방송실로 신호를 잇는다'],
      ['hide', '응답하지 않고 사물함 그림자에 숨는다'],
    ],
  },
  exit: {
    eyebrow: '마지막 선택 · 계단',
    title: '옥상 계단의 문이 반쯤 열려 있다.',
    text: '발병의 흔적을 남기지 않고 빠져나갈 수 있는 마지막 순간이다.',
    image: AOUAD_IMAGES.rooftop,
    choices: [
      ['stairs', '계단으로 올라가 옥상 문을 통과한다'],
      ['window', '창문 쪽 난간으로 우회한다'],
    ],
  },
} as const;

const choiceLabel: Record<InfectionRecordChoice, string> = {
  listen: '소리를 읽음',
  rush: '복도를 질주함',
  relay: '신호를 연결함',
  hide: '그림자에 숨음',
  stairs: '계단을 선택함',
  window: '창문을 선택함',
};

const resultCopy = {
  escaped: { eyebrow: 'ESCAPED · LOCAL RECORD', title: '감염 기록을 남기고 빠져나왔다.', text: '당신은 흔적을 줄이고 옥상 계단을 통과했습니다.' },
  quarantined: { eyebrow: 'QUARANTINED · LOCAL RECORD', title: '당신은 격리 지점에 도착했다.', text: '빠져나오지는 못했지만, 감염 경로를 끊고 다음 신호를 기다립니다.' },
  infected: { eyebrow: 'INFECTED · LOCAL RECORD', title: '너무 많은 신호가 당신을 향했다.', text: '실패 이유가 기록되었습니다. 다른 선택으로 다시 시도할 수 있습니다.' },
} as const;

export function InfectionRecordPrototype() {
  const [view, dispatch] = useReducer(infectionReducer, initialViewState);

  useEffect(() => {
    if (view.result) saveAouadComparisonResult(window.localStorage, view.result);
  }, [view.result]);

  const start = useCallback(() => {
    const now = Date.now();
    dispatch({ type: 'start', run: { runId: infectionRunId(now), startedAt: new Date(now).toISOString(), startedPerformance: performance.now() } });
  }, []);

  const choose = useCallback((choice: InfectionRecordChoice) => {
    dispatch({
      type: 'choose',
      choice,
      completedAt: new Date().toISOString(),
      activeDurationMs: Math.max(0, performance.now() - (view.run?.startedPerformance ?? performance.now())),
    });
  }, [view.run?.startedPerformance]);

  if (view.story.stage === 'briefing') {
    return (
      <main className={styles.page}>
        <div className={styles.prototype}>
          <header className={styles.prototypeHeader}><Link href={`${AOUAD_POPUP_PATH}/lab`}>← 비교 허브</Link><span>02 · INFECTION RECORD</span></header>
          <section className={styles.storyPanel}>
            <div className={styles.storyImage}><Image src={AOUAD_IMAGES.classroom} alt="감염 징후가 시작된 효산고 교실" fill loading="eager" sizes="(max-width: 680px) calc(100vw - 1.25rem), 42rem" /><div className={styles.storyShade} /></div>
            <div className={styles.storyContent}>
              <p className={styles.eyebrow}>2D BRANCHING EXPERIENCE</p>
              <h1>세 번의 선택으로<br />당신의 감염 기록을 남긴다.</h1>
              <p>목표는 옥상 계단까지 도착하는 것입니다. 설명 없이 선택하고, 성공과 실패의 이유를 결과에서 확인하세요.</p>
              <button type="button" className={styles.primaryButton} onClick={start}>감염 기록 시작</button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (view.story.stage === 'result' && view.result && view.story.resultType) {
    const copy = resultCopy[view.story.resultType];
    return (
      <main className={styles.page}>
        <div className={styles.prototype}>
          <header className={styles.prototypeHeader}><Link href={`${AOUAD_POPUP_PATH}/lab`}>← 비교 허브</Link><span>02 · RESULT</span></header>
          <section className={styles.resultPanel} data-result={view.result.resultType}>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
            <p>{copy.text}</p>
            <dl className={styles.resultMeta}>
              <div><dt>감염 노출</dt><dd>{view.story.exposure}회</dd></div>
              <div><dt>활동 시간</dt><dd>{Math.max(0, Math.round(view.result.activeDurationMs / 1000))}초</dd></div>
            </dl>
            <ul className={styles.decisionLog} aria-label="선택 기록">{view.story.choices.map((choice, index) => <li key={`${choice}-${index}`}>{choiceLabel[choice]}</li>)}</ul>
            <div className={styles.introActions}><ComparisonResultActions result={view.result} candidateName="감염 기록" onRetry={() => dispatch({ type: 'retry' })} /></div>
          </section>
        </div>
      </main>
    );
  }

  const scene = sceneCopy[view.story.stage as 'hallway' | 'broadcast' | 'exit'];
  return (
    <main className={styles.page}>
      <div className={styles.prototype}>
        <header className={styles.prototypeHeader}><Link href={`${AOUAD_POPUP_PATH}/lab`}>← 비교 허브</Link><span>02 · CHOICE {view.story.choices.length + 1}/3</span></header>
        <section className={styles.storyPanel}>
          <div className={styles.storyImage}><Image src={scene.image} alt="" fill loading="eager" sizes="(max-width: 680px) calc(100vw - 1.25rem), 42rem" /><div className={styles.storyShade} /></div>
          <div className={styles.storyContent}>
            <p className={styles.eyebrow}>{scene.eyebrow}</p>
            <h1>{scene.title}</h1>
            <p>{scene.text}</p>
            <div className={styles.choiceGrid}>
              {scene.choices.map(([choice, label]) => <button key={choice} type="button" className={styles.choiceButton} onClick={() => choose(choice)}>{label}</button>)}
            </div>
            <ul className={styles.decisionLog} aria-label="지금까지의 선택">{view.story.choices.map((choice, index) => <li key={`${choice}-${index}`}>{choiceLabel[choice]}</li>)}</ul>
          </div>
        </section>
      </div>
    </main>
  );
}
