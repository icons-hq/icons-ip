import type { ChapterId, LastBellRooftopPhase } from './runtime/types';
import { LAST_BELL_RELEASE_BUILD_ID } from './release';

export const LAST_BELL_NARRATIVE_BUILD_ID = 'last-bell-narrative-ko-v1';

export const LAST_BELL_CHAPTER_COPY: Record<ChapterId, { number: string; title: string }> = {
  'chapter-01': { number: 'CHAPTER 01', title: '죽은 학교' },
  'chapter-02': { number: 'CHAPTER 02', title: '옥상의 불빛' },
};

export const LAST_BELL_OBJECTIVE_COPY: Record<string, string> = {
  'ch1.open-classroom-door': '교실 미닫이문을 열어라',
  'ch1.cross-and-lock-classroom-door': '문을 통과한 뒤 닫고 잠가라',
  'ch1.steady-after-encounter': '첫 감염자를 피해 다음 동선을 확보하라',
  'ch1.restore-emergency-power': '비상전원을 복구하라',
  'ch1.deploy-noise-device': '고정 소음 장치로 감염자를 유인하라',
  'ch1.open-fire-door': '방화문을 열어라',
  'ch1.cross-and-lock-fire-door': '방화문을 통과해 바리케이드를 잠가라',
  'ch1.survive-two-zombie-passage': '두 좀비의 동선을 살피며 종까지 갈 틈을 만들어라',
  'ch1.ring-last-bell': '마지막 종을 울려 길을 만들어라',
  'ch1.reach-rooftop-stairwell': '옥상 계단까지 도망쳐라',
  'ch2.enter-stairwell': '계단실의 불빛과 발소리를 확인하라',
  'ch2.search-stairwell': '옥상의 불빛을 확인하라',
  'ch2.approach-namra': '모닥불 앞의 생존자에게 다가가라',
  'ch2.namra-recognizes-danger': '움직이지 마라',
  'ch2.cut-to-black': '',
};

/** Dialogue stays outside components so IP review can replace it without a code rewrite. */
export const LAST_BELL_ROOFTOP_ENDING_KO = {
  releaseBuildId: LAST_BELL_RELEASE_BUILD_ID,
  locale: 'ko-KR',
  reviewStatus: 'pending' as const,
  characterAssetKey: 'character.namra.rooftop',
  lines: {
    namraLine01: '너…',
    namraLine02: '인간이 아니네.',
  },
  timingMs: {
    // Recognition lasts 30s: the reveal is deliberately held until its final
    // third, then line 2 and the involuntary step land just before subdue.
    line01: 21_500,
    pulseFixation: 24_500,
    line02: 26_000,
    involuntaryStep: 28_300,
    blackFootsteps: 1_600,
    blackDoorPresence: 5_900,
    resultReveal: 8_000,
  },
  audio: {
    heartbeat: '/generated/last-bell/audio/breath-heartbeat-loop.ogg',
    groupFootsteps: '/generated/last-bell/audio/corridor-footsteps.wav',
  },
} as const;

/**
 * Derives every ending cue from the fixed-step simulation phase clock. The
 * runtime pauses that clock before this state is recomputed; `suspended`
 * separately tears down audio immediately for pause, inventory, or WebGL loss.
 */
export function rooftopEndingState(
  phase: LastBellRooftopPhase,
  phaseElapsedSeconds: number,
  suspended: boolean,
) {
  const phaseElapsedMs = Math.max(0, phaseElapsedSeconds * 1_000);
  const isSubdue = phase === 'subdue';
  const isRecognition = phase === 'recognition';
  const isBlack = phase === 'black';
  return {
    phaseElapsedMs,
    line01Visible: isSubdue || (isRecognition && phaseElapsedMs >= LAST_BELL_ROOFTOP_ENDING_KO.timingMs.line01),
    line02Visible: isSubdue || (isRecognition && phaseElapsedMs >= LAST_BELL_ROOFTOP_ENDING_KO.timingMs.line02),
    pulseVisible: isSubdue || (isRecognition && phaseElapsedMs >= LAST_BELL_ROOFTOP_ENDING_KO.timingMs.pulseFixation),
    involuntaryStepVisible: isRecognition && phaseElapsedMs >= LAST_BELL_ROOFTOP_ENDING_KO.timingMs.involuntaryStep,
    blackFootstepsDue: isBlack && phaseElapsedMs >= LAST_BELL_ROOFTOP_ENDING_KO.timingMs.blackFootsteps,
    playHeartbeat: !suspended && (isRecognition || isSubdue),
    playBlackFootsteps: !suspended && isBlack && phaseElapsedMs >= LAST_BELL_ROOFTOP_ENDING_KO.timingMs.blackFootsteps,
  } as const;
}

export function objectiveCopyForLastBell(objectiveId: string): string {
  return LAST_BELL_OBJECTIVE_COPY[objectiveId] ?? '옥상의 불빛을 확인하라';
}

export function hidesGameplayHudAtRooftop(phase: LastBellRooftopPhase): boolean {
  // Opening the rooftop door crosses the campaign's no-commerce/no-pickup
  // seam. The approach is already cinematic, not ordinary exploration.
  return phase !== 'sealed';
}
