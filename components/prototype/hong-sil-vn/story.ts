/* ═══════════════════════════════════════════════════════════════════════
 * PROTOTYPE — 홍실 퀘스트 온라인 팝업 · 서사형 행동 체험 게임
 * 버릴 코드다. 이 파일과 형제 파일들을 프로덕션으로 승격하지 말 것.
 *
 * 답하려는 질문
 *   "선택 → 축 누적 → 21개 엔딩 → 엔딩 카드(봉인) → 팝업 종료 후 공개"
 *   이 루프가 화면으로 성립하는가. 세 가지 구조를 나란히 놓고 고른다(?variant=A|B|C).
 *
 * 이 모듈은 순수하다 — DOM·네트워크·랜덤·시간에 의존하지 않는다.
 * variant 컴포넌트가 이걸 import 하고, 반대 방향으로는 흐르지 않는다.
 *
 * 원작 기반 (시즌 2 완결 직후에서 분기한다)
 *   본편: 법학과 신입생 이연과 선배 홍기훈이 홍실바위의 저주에 걸려 라운드마다
 *   퀘스트를 치르며 연인이 된다. 전생에서 이연은 이름 없던 아이에게 '홍기훈'이라는
 *   이름을 지어 줬고, 그 아이가 홍염인(홍실 없이 태어난 존재)인 줄 모른 채 억지로
 *   홍실을 묶었다. 그 어긋난 매듭이 불행의 근원이 됐다. 기훈은 이연을 지키려 전부
 *   희생했고, 이연은 "다음 생엔 만나지 않기를" 빌었으며 그 소원이 저주가 됐다.
 *   시즌 2에서 이연은 기훈에게 자신을 잊어달라 부탁하고, 7년 뒤 검사가 된 이연과
 *   기억을 잃은 채 월드클래스 축구선수가 된 기훈이 재회한다. 그리고 접촉할 때마다
 *   기억이 돌아오는 '홍기훈 퀘스트'가 예고되며 끝난다.
 *
 *   이 게임은 바로 그 지점에서 시작한다 — 플레이어는 이연으로서 홍기훈 퀘스트를
 *   치르며, 기억을 돌려줄지 / 놓아줄지 / 홍실 없이 처음부터 다시 할지를 고른다.
 *
 *   확정 = 위 줄거리, 인물, 관계, 홍실바위, 홍기훈 퀘스트 규칙(접촉→기억 회수),
 *          퀘스트 알림 포맷과 보너스 퀘스트 룰, 홍염인 설정.
 *   추정 = 개별 장면·대사·엔딩 문장. 본편 대사를 옮긴 게 아니라 결말 이후를 새로 쓴 것이다.
 *   축 가중치·플래그·판정 로직은 카피와 분리돼 있어 문장을 갈아도 살아남는다.
 *
 * 정전 기준서 = docs/ip/hong-sil-quest/story-bible.md
 * 대본 원본   = docs/ip/hong-sil-quest/game-scenario.md
 * ═══════════════════════════════════════════════════════════════════════ */

import type { RarityKey } from '@/lib/rarity';

/* ── 등장인물 ────────────────────────────────────────────────────────────
 * 시점은 이연 1인칭 — 플레이어가 이연을 연기한다.
 *
 * 화법 규칙(story-bible.md §1). 대사를 고칠 때 반드시 지킨다:
 *   기훈 — 3인칭 자칭("형이/형님이"), 호칭 "연아", 감탄사 과다, 전부 농담으로 회피.
 *          ⚠ 기억을 잃은 기훈은 차분해지지 않는다. 트라우마가 지워져 원래대로 더
 *          시끄럽다 — 원작 54화 이연의 표현으로 "박살 난 개 또라이 태양".
 *   이연 — 겉은 존댓말, 속은 반말 욕설. 그 분열이 캐릭터의 본체다.
 *          반말이 새는 순간이 곧 진심이다.
 *   바위 — 우주적 재앙을 명랑한 고객센터 말투로 통보한다. 악의는 없고 속죄 중이다. */

export type CastKey = 'yeon' | 'kihoon' | 'rock';

export const CAST: Record<CastKey, { name: string; color: string }> = {
  yeon: { name: '이연', color: '#FF7A9E' },
  kihoon: { name: '홍기훈', color: '#FFB23D' },
  rock: { name: '홍실바위', color: '#C6FF3D' },
};

/* ── 축(axis) ────────────────────────────────────────────────────────────
 * 선택마다 축 점수를 누적한다. 엔딩은 "가장 크게 기운 축 + 그 부호"로 판정하므로
 * 장면을 늘려도 엔딩 개수가 폭증하지 않고, 축·플래그를 더하면 엔딩이 늘어난다.
 * (= 실제 도입 시 "엔딩 개수 자유조정" 요구를 이 모델이 흡수한다) */

export type AxisKey = 'bond' | 'truth' | 'self';

/* 세 축은 원작이 이연에게 계속 묻는 것과 같다 —
 * 곁에 둘 것인가(緣), 기억과 진실을 돌려줄 것인가(眞), 누구를 먼저 둘 것인가(我). */
export const AXES: Record<AxisKey, { name: string; minus: string; plus: string; color: string }> = {
  bond: { name: '연(緣)', minus: '놓아준다', plus: '붙잡는다', color: '#FF2E63' },
  truth: { name: '진(眞)', minus: '덮는다', plus: '돌려준다', color: '#2DE2FF' },
  self: { name: '아(我)', minus: '그 사람을 위해', plus: '나를 위해', color: '#FFB23D' },
};

export const AXIS_ORDER: readonly AxisKey[] = ['bond', 'truth', 'self'];

export type Axes = Record<AxisKey, number>;

export const ZERO_AXES: Axes = { bond: 0, truth: 0, self: 0 };

/* ── 플래그 ──────────────────────────────────────────────────────────────
 * 종막 플래그 3종은 항상 정확히 하나가 켜진다(종막 선택지가 3개라서).
 * 나머지는 특수 엔딩 판정에만 쓰는 서사 플래그다. */

export type FlagKey =
  | 'remember'
  | 'release'
  | 'restart'
  | 'found_wish'
  | 'refused_memory'
  | 'broke_pattern'
  /* 퀘스트 실패 — 다음 라운드에 〈홍실로 돌돌 감겨〉 페널티 구간이 붙는다(원작 룰). */
  | 'fail_r1'
  | 'fail_r4'
  /* 전생에서 이름을 직접 지어 줬다 */
  | 'named_him'
  /* 해석(read) 정답 — 기훈이 말하지 못한 것을 이연이 알아차렸다 */
  | 'read_fear'
  | 'read_hurt'
  | 'read_alone';

/** 최종 라운드의 세 갈래 — 기억을 돌려준다 / 놓아준다 / 홍실 없이 다시 시작한다 */
export type FinaleFlag = 'remember' | 'release' | 'restart';

export const FINALE_LABEL: Record<FinaleFlag, string> = {
  remember: '회복',
  release: '해방',
  restart: '재회',
};

/* ── 장면 ────────────────────────────────────────────────────────────────
 * art는 일러스트 슬롯 키다. 이 순수 모듈은 파일 경로를 모르고, art.ts가 정적 원화와
 * 연결한다. 슬롯 개수는 그대로 제작 발주 규모가 된다(ART_SLOT_COUNT 참조). */

/** 원작의 퀘스트 알림 포맷. 필드 구조를 그대로 옮겼다 — 화면은 이걸 카드로 조판한다.
 *
 *   홍실 퀘스트 제N라운드 〈퀘스트명〉
 *   기한: ___
 *   퀘스트 실패 시: 〈홍실로 돌돌 감겨〉 페널티, ___!
 */
export interface QuestCard {
  /** '제1라운드' | '보너스 퀘스트' | '최종 라운드' */
  round: string;
  /** 〈꺾쇠〉 포함해서 쓴다 */
  label: string;
  deadline: string;
  penalty: string;
}

/** 소설 문법 — 지문/대사/속마음, 원작의 퀘스트 문자, 그리고 집필 슬롯. */
export type Beat =
  | { kind: 'narration'; text: string }
  | { kind: 'line'; who: CastKey; text: string }
  | { kind: 'inner'; text: string }
  | { kind: 'quest'; card: QuestCard }
  /** 장면 전환 — 성인 트랙에서 원작자 집필분이 들어갈 자리. 화면에 슬롯으로 드러낸다. */
  | { kind: 'gap'; note: string };

export interface Choice {
  id: string;
  /** 'say'는 연이 입 밖에 내는 말(따옴표), 'do'는 행동, 'read'는 기훈의 속을 읽는 추측 */
  kind: 'say' | 'do' | 'read';
  label: string;
  /** 분기 보드 카드에 들어가는 짧은 이름. 본문 label은 길어서 도판에 안 들어간다. */
  short: string;
  /** 선택 직후 이어지는 서술 — 선택지마다 별도 일러스트를 갖는다 */
  aside: string;
  art: string;
  axes: Partial<Axes>;
  flags?: FlagKey[];
  /** kind === 'read'에서만 의미. 원작 17화의 "나를 알아차려 줄래?" 계약을 메커닉으로 옮긴 것. */
  correct?: boolean;
}

/** 직전 라운드를 실패했을 때만 본문 앞에 붙는 페널티 구간(원작 보너스 퀘스트 룰). */
export interface PenaltyPrologue {
  when: FlagKey;
  beats: Beat[];
}

export interface Scene {
  id: string;
  act: string;
  place: string;
  art: string;
  beats: Beat[];
  prompt: string;
  choices: [Choice, Choice, Choice];
  penalty?: PenaltyPrologue;
}

/** 'say'는 따옴표, 'read'는 추측이므로 말줄임과 물음표로 조판한다. */
export const choiceText = (choice: Choice): string => {
  if (choice.kind === 'say') return `“${choice.label}”`;
  if (choice.kind === 'read') return `…${choice.label}`;
  return choice.label;
};

/* ── 트랙 ────────────────────────────────────────────────────────────────
 * 전연령이 본편이고, 성인 트랙은 일부 라운드의 비트만 확장판으로 갈아 끼운다.
 * 축·플래그·선택지·엔딩 판정은 두 트랙이 **공유한다** — 성인 트랙 전용 엔딩은 없다.
 * 그래서 트랙을 바꿔도 20종 그리드와 도달 가능성 열거가 그대로 성립한다.
 *
 * 성인 비트는 이 모듈에 없다. story-adult.ts가 별도 청크로 있고, 연령 게이트를
 * 통과한 세션만 그걸 동적 import 해서 아래 registerAdultTrack으로 등록한다.
 * 실서비스에서는 이 등록을 서버가 대신한다(세션에 바인딩된 청크만 내려보낸다) —
 * 클라이언트 분기만으로는 번들을 뜯으면 보이므로 부족하다. adult-track.md §4 참조. */

export type Track = 'all-ages' | 'adult';

export const TRACK_LABEL: Record<Track, string> = {
  'all-ages': '전연령',
  adult: '성인',
};

/** 씬 id → 그 씬을 대체할 성인판 비트. 게이트를 통과해야 채워진다. */
export type AdultBeats = Readonly<Record<string, readonly Beat[]>>;

/** 게이트 화면이 청크를 받기 전에 미리 보여 주는 규모. story-adult.ts와의 일치는 테스트가 지킨다. */
export const ADULT_TRACK_SUMMARY = { scenes: 3, gaps: 3 } as const;

/** 미성년자가 등장하는 라운드는 어떤 트랙에서도 확장하지 않는다. 등록 시점에 막는다. */
export const NEVER_ADULT: readonly string[] = ['r3', 'r4'];

let adultBeats: AdultBeats | null = null;

export function registerAdultTrack(beats: AdultBeats): void {
  for (const id of NEVER_ADULT) {
    if (id in beats) throw new Error(`성인 트랙이 확장할 수 없는 라운드다: ${id}`);
  }
  adultBeats = beats;
}

export const isAdultTrackLoaded = (): boolean => adultBeats !== null;

/** 테스트·되돌리기용 */
export function clearAdultTrack(): void {
  adultBeats = null;
}

/** 그 씬이 성인 트랙에서 확장본을 갖는가 (로드된 뒤에만 참) */
export const hasAdultBeats = (sceneId: string): boolean => adultBeats?.[sceneId] != null;

/**
 * 화면에 실제로 흐르는 비트.
 *   1) 성인 트랙이고 확장본이 있으면 그걸 쓴다
 *   2) 실패 플래그가 켜져 있으면 페널티 구간을 앞에 붙인다(원작 보너스 퀘스트 룰)
 */
export const sceneBeats = (scene: Scene, flags: Set<FlagKey>, track: Track = 'all-ages'): Beat[] => {
  const body = track === 'adult' && adultBeats?.[scene.id] ? [...adultBeats[scene.id]] : scene.beats;
  return scene.penalty && flags.has(scene.penalty.when) ? [...scene.penalty.beats, ...body] : body;
};

/* ── 대본 ────────────────────────────────────────────────────────────────
 * 8라운드. 원문과 연출 의도는 docs/ip/hong-sil-quest/game-scenario.md에 있다.
 * 무대: 검찰청(재회) → 조선 전생 3라운드 → 대학 회상 → 포장마차 → 홍실바위.
 *
 * 캐논 주의 — 기억 삭제 후 7년이 지난 시점이다. 이연은 검사, 기훈은 축구선수다.
 * 대학은 회상으로만 나온다(R6). 강의실 배경으로 되돌리지 말 것. */

export const SCENES: readonly Scene[] = [
  {
    id: 'r1',
    act: 'ROUND 01',
    place: '현대 — 서울중앙지검 12층 복도',
    art: 'r1-bg',
    beats: [
      { kind: 'narration', text: '7년이었다. 그 사람의 기억에서 나를 지운 뒤로.' },
      { kind: 'narration', text: '나는 검사가 됐고, 그 사람은 세계에서 제일 시끄러운 공격수가 됐다. 계획대로였다.' },
      { kind: 'narration', text: '계획에 없던 건, 그 사람이 참고인 조사를 받으러 내 사무실 복도에 서 있는 것 하나뿐이었다.' },
      { kind: 'line', who: 'kihoon', text: '어! 어어?! 저기요, 검사님! 검사님 맞죠?!' },
      { kind: 'line', who: 'kihoon', text: '와 진짜 죄송한데— 형이 지금 길을 잃었거든요. 아니 형이 아니라, 제가. 아 씨 왜 형이래.' },
      { kind: 'inner', text: '7년 동안 하나도 안 변했네. 아니, 더 심해졌잖아.' },
      { kind: 'narration', text: '트라우마도, 전생도, 나도. 전부 지워진 홍기훈은 원래의 홍기훈으로 돌아가 있었다.' },
      { kind: 'inner', text: '박살 난 개 또라이 태양. 저게 원본이었구나.' },
      { kind: 'line', who: 'kihoon', text: '저 홍기훈이라고 하는데— 아 알죠? 알겠지. 하하! 자랑은 아니고요. 아니 조금 자랑인가?' },
      { kind: 'line', who: 'kihoon', text: '저기, 손 한 번만 잡아주시면 안 돼요? 팬서비스 말고, 그— 길 알려주는 의미로.' },
      { kind: 'narration', text: '손목이 따끔했다. 없어진 줄 알았던 실이 다시 감겨 있었다. 이번엔 나한테만 보이는 실이었다.' },
      {
        kind: 'quest',
        card: {
          round: '제1라운드',
          label: '〈손을 잡으세요〉',
          deadline: '오늘 자정',
          penalty: '〈홍실로 돌돌 감겨〉 페널티, 이틀!',
        },
      },
      { kind: 'line', who: 'rock', text: '오랜만이에요! 잘 지냈나요? 새 시즌 오픈 기념이라 쉬운 걸로 준비했어요. 그럼, 행운을 빌어요!' },
      { kind: 'inner', text: '이 돌덩어리가.' },
    ],
    prompt: '손을 뻗을 것인가.',
    choices: [
      {
        id: 'r1a',
        kind: 'say',
        short: '손을 잡는다',
        label: '…길은, 제가 안내해 드릴게요.',
        aside:
          '손끝이 닿는 순간 그 사람의 눈이 크게 흔들렸다. 조각 하나가 돌아온 것이다. 그리고 그 사람은 아무 일 없다는 듯 웃었다. “오, 손 진짜 차갑다. 검사님 혈액순환 안 되시는구나?”',
        art: 'r1-c1',
        axes: { bond: 2, self: -1 },
      },
      {
        id: 'r1b',
        kind: 'do',
        short: '자리를 뜬다',
        label: '못 들은 척 사무실로 들어간다',
        aside: '문을 닫고 서류를 폈지만 한 줄도 읽히지 않았다. 자정이 지나자 손목의 실이 조여들었다.',
        art: 'r1-c2',
        axes: { bond: -2, truth: -1 },
        flags: ['fail_r1'],
      },
      {
        id: 'r1c',
        kind: 'do',
        short: '근원을 캔다',
        label: '이 퀘스트가 왜 다시 시작됐는지부터 캔다',
        aside:
          '그날 밤 7년 만에 홍실바위에 올라갔다. 그리고 알았다. 이 저주를 만든 소원은 처음부터 내 것이었다. “다음 생엔 만나지 않게 해 주세요.”',
        art: 'r1-c3',
        axes: { truth: 2, self: 1 },
        flags: ['found_wish'],
      },
    ],
  },

  {
    id: 'r2',
    act: 'ROUND 02',
    place: '현대 — 검찰청 앞 카페',
    art: 'r2-bg',
    /* R1을 실패했을 때만 붙는 구간. 원작 보너스 퀘스트 룰 — 실패해야 열리고,
     * 성공하면 이전 페널티가 삭제되며, 실패해도 추가 페널티가 없다("밑져야 본전"). */
    penalty: {
      when: 'fail_r1',
      beats: [
        { kind: 'narration', text: '다음 날 아침, 나는 홍기훈의 조수석에 앉아 있었다.' },
        { kind: 'narration', text: '홍실은 두 사람의 팔을 한 번씩 감고 있었다. 3미터 이상 떨어지면 실이 조였다.' },
        { kind: 'line', who: 'kihoon', text: '아니 검사님, 이게 무슨 일이람. 어제 처음 봤는데 오늘 아침에 같이 출근을 하네?' },
        { kind: 'line', who: 'kihoon', text: '혹시 이거 운명 아닐까요? 형은 그런 거 잘 믿거든.' },
        { kind: 'inner', text: '운명 맞아. 내가 만든 거야.' },
        {
          kind: 'quest',
          card: {
            round: '보너스 퀘스트',
            label: '〈오늘 하루, 도망치지 마세요〉',
            deadline: '오늘 자정',
            penalty: '없음 — 성공 시 이전 페널티 삭제, 실패해도 추가 페널티 없음',
          },
        },
        { kind: 'line', who: 'rock', text: '이런, 타임 오버! ㅜㅜ 하지만 괜찮아요. 보너스 퀘스트는 밑져야 본전이거든요!' },
        { kind: 'narration', text: '하루 종일 도망치지 않는 것. 7년 동안 매일 한 일의 정반대였다.' },
        { kind: 'narration', text: '자정에 실이 풀렸다. 그 사람은 끝까지 아무것도 모른 채 잘 자라고 손을 흔들었다.' },
        { kind: 'inner', text: '한 번도 못 도망쳤다. 어이없게도, 그게 조금 편했다.' },
      ],
    },
    beats: [
      { kind: 'narration', text: '참고인 조사는 30분 만에 끝났다. 그 사람은 두 시간째 카페에 앉아 있었다.' },
      { kind: 'line', who: 'kihoon', text: '아, 저 기다린 거 아니에요. 여기 커피가 맛있어서.' },
      { kind: 'line', who: 'kihoon', text: '…아니다. 기다렸어요. 형은 거짓말을 잘 못 해.' },
      { kind: 'inner', text: '알아. 7년 전에도 못 했어.' },
      { kind: 'line', who: 'kihoon', text: '근데 이상하지. 검사님 보면 자꾸 뭘 하나 빠뜨린 기분이 들어요.' },
      { kind: 'line', who: 'kihoon', text: '지갑 두고 온 거 같은 그런 거 있잖아요. 근데 지갑은 여기 있고.' },
      { kind: 'narration', text: '어제 스친 손끝 하나로 조각이 돌아온 것이다. 이제 그 사람은 없는 기억의 모양을 더듬고 있다.' },
      { kind: 'narration', text: '그리고 처음으로, 그 사람이 웃지 않고 나를 봤다.' },
      {
        kind: 'quest',
        card: {
          round: '제2라운드',
          label: '〈저 사람이 지금 무슨 생각인지 맞혀 보세요〉',
          deadline: '이 대화가 끝나기 전',
          penalty: '없음 — 이번 라운드는 페널티가 없습니다!',
        },
      },
      { kind: 'line', who: 'rock', text: '어? 방금 표정 봤어요? 저건 뭘까요? 한번 맞혀 보세요~ 틀려도 안 혼나요. 다만…… 놓친 건 그대로 놓친 거랍니다. ^^' },
    ],
    prompt: '저 얼굴은 무슨 얼굴인가.',
    choices: [
      {
        id: 'r2a',
        kind: 'read',
        short: '떠올리려는 얼굴',
        label: '나를 어디서 봤는지 떠올리려는 얼굴?',
        aside: '“아, 아니에요. 그냥 눈에 뭐 들어가서.” 그 사람은 다시 웃었다. 나는 또 틀렸고, 또 그걸 몰랐다.',
        art: 'r2-c1',
        axes: { truth: -1, bond: -1 },
        correct: false,
      },
      {
        id: 'r2b',
        kind: 'read',
        short: '눈치 보는 얼굴',
        label: '내가 불편해할까 봐 눈치 보는 얼굴?',
        aside: '“에이, 제가 그렇게 소심해 보여요?” 웃음으로 덮였다. 덮은 게 뭔지는 끝내 못 봤다.',
        art: 'r2-c2',
        axes: { bond: -2, self: 1 },
        correct: false,
      },
      {
        id: 'r2c',
        kind: 'read',
        short: '무서워하는 얼굴',
        label: '무서워하는 얼굴?',
        aside:
          '그 사람이 눈을 크게 떴다. “어떻게 알았지.” 그리고 아주 작게 말했다. “…가끔 그런 꿈을 꿔요. 누굴 못 지킨 꿈.”',
        art: 'r2-c3',
        axes: { truth: 2, bond: 1 },
        correct: true,
        flags: ['read_fear'],
      },
    ],
  },

  {
    id: 'r3',
    act: 'ROUND 03',
    place: '전생 — 조선, 이 대감 댁 서재',
    art: 'r3-bg',
    beats: [
      { kind: 'narration', text: '그날 밤 꿈을 꿨다. 내가 살아 본 적 없는 계절이었다.' },
      { kind: 'narration', text: '다섯 살의 내가 산딸기를 따러 몰래 나갔다가 길을 잃었고, 이름 없는 아이가 나를 업어 데려다줬다.' },
      { kind: 'line', who: 'kihoon', text: '나? 나는 이름 없는데. 다들 똥개라고 불러.' },
      { kind: 'line', who: 'kihoon', text: '…근데 너 진짜 선녀 같다. 선녀야?' },
      { kind: 'inner', text: '선녀 아니야, 라고 말하려다 말았던 것 같다. 그 얼굴이 너무 진지해서.' },
      { kind: 'narration', text: '아버지는 그 아이를 가병으로 들이기로 하시고, 이름을 나에게 지으라 하셨다.' },
      { kind: 'narration', text: '나는 보름 동안 서재에서 나오지 않았다.' },
      { kind: 'narration', text: '혹여 나쁜 기운이 스며들까, 남의 뜻이 덧씌워질까. 누구에게도 보여주지 않고 혼자 지었다.' },
      { kind: 'narration', text: '붉을 홍(紅), 길할 기(祺), 공 훈(勳).' },
      { kind: 'line', who: 'yeon', text: '오늘부터 네 이름은 홍기훈이야.' },
      { kind: 'line', who: 'kihoon', text: '…홍, 기훈. 홍기훈! 홍기훈!! 야 나 이름 있다!!! 홍기훈이래!!!' },
      { kind: 'narration', text: '그 애는 그 이름을 부르며 마당을 세 바퀴 돌았다.' },
      { kind: 'inner', text: '그때 나는 세상에서 제일 잘한 일을 했다고 생각했다.' },
    ],
    prompt: '이름을 건네는 손을 어떻게 할 것인가.',
    choices: [
      {
        id: 'r3a',
        kind: 'say',
        short: '뜻을 말해준다',
        label: '…좋은 뜻으로만 지었어. 나쁜 건 하나도 안 넣었어.',
        aside: '그 애는 종이를 접어 품에 넣더니 다시는 꺼내 보이지 않았다. 나중에 알았다. 닳을까 봐 그랬다는 것을.',
        art: 'r3-c1',
        axes: { bond: 2, truth: 1 },
        flags: ['named_him'],
      },
      {
        id: 'r3b',
        kind: 'do',
        short: '말없이 돌아선다',
        label: '이름만 건네고 말없이 돌아선다',
        aside: '그 애는 내 뒷모습에 대고 고맙다고 세 번 외쳤다. 나는 대답하지 않았다. 그게 예의인 줄 알았다.',
        art: 'r3-c2',
        axes: { bond: -2, self: -1, truth: -1 },
      },
      {
        id: 'r3c',
        kind: 'do',
        short: '꿈을 깬다',
        label: '꿈에서 깨어나려 애쓴다',
        aside: '기억은 순순히 물러났다. 너무 순순해서, 오히려 그게 오래 남았다.',
        art: 'r3-c3',
        axes: { truth: -2, self: 2 },
        flags: ['refused_memory'],
      },
    ],
  },

  {
    id: 'r4',
    act: 'ROUND 04',
    place: '전생 — 조선, 홍실바위 아래',
    art: 'r4-bg',
    beats: [
      { kind: 'narration', text: '꿈은 이어졌다. 마을 여인들이 홍실바위 전설을 이야기하고 있었다.' },
      { kind: 'narration', text: '바다가 잠잠하고 바위가 깊은 잠에 든 날, 바위의 홍실을 풀어 정한 이의 약지에 묶으면—' },
      { kind: 'narration', text: '그이를 운명으로 만들 수 있다고.' },
      { kind: 'line', who: 'yeon', text: '…사내끼리는, 혼인을 못 한다고 하셨지요.' },
      { kind: 'narration', text: '다섯 살의 내가 밤에 몰래 산을 올랐다. 잠든 아이의 손가락에 붉은 실을 감았다.' },
      { kind: 'narration', text: '같은 시각, 마을 어귀에서 한 사내의 말발굽에 돌이 박혔다. 전명대군이 마을에 머물게 된 이유였다.' },
      { kind: 'narration', text: '애정만 품은 아이의 손끝에서 어긋난 첫 매듭이 태어났다. 모든 불행이 시작될 매듭이었다.' },
      { kind: 'inner', text: '묶은 직후에 실이 끊어졌다. 그때 나는 그게 무슨 뜻인지 몰랐다.' },
      {
        kind: 'quest',
        card: {
          round: '제3라운드',
          label: '〈그날 밤을 끝까지 보세요〉',
          deadline: '꿈에서 깨기 전',
          penalty: '〈홍실로 돌돌 감겨〉 페널티, 일주일!',
        },
      },
      { kind: 'line', who: 'rock', text: '…미안해요. 이건 제가 잠든 사이에 벌어진 일이에요.' },
      { kind: 'line', who: 'rock', text: '그날 제가 깨어 있었다면. 그 애가 제 위에서 낮잠만 안 잤어도. 정이 안 들었을 텐데.' },
      { kind: 'inner', text: '처음으로, 그 명랑한 목소리가 흔들렸다.' },
    ],
    prompt: '다섯 살의 나를 어떻게 할 것인가.',
    choices: [
      {
        id: 'r4a',
        kind: 'do',
        short: '앞을 막는다',
        label: '손을 뻗어 어린 나를 막는다',
        aside:
          '바뀌는 건 없었다. 다만 잠든 아이가 눈을 떴고, 처음으로 놀란 얼굴을 했다. 늘 자기가 앞에 서던 자리였으니까.',
        art: 'r4-c1',
        axes: { bond: 2, self: -2 },
        flags: ['broke_pattern'],
      },
      {
        id: 'r4b',
        kind: 'do',
        short: '끝까지 본다',
        label: '눈을 감지 않고 끝까지 지켜본다',
        aside: '마지막 장면에서 나는 빌고 있었다. 다음 생엔 만나지 않게 해 달라고. 그 소원이 우리를 묶은 홍실이 됐다.',
        art: 'r4-c2',
        axes: { truth: 2, bond: 1 },
        flags: ['found_wish'],
      },
      {
        id: 'r4c',
        kind: 'read',
        short: '겁먹은 걸까',
        label: '저 아이는 지금 겁먹은 걸까?',
        aside: '아니었다. 다섯 살의 나는 조금도 무서워하지 않았다. 확신에 차 있었다. 그게 더 무서운 일이었다.',
        art: 'r4-c3',
        axes: { truth: -2, self: 1 },
        correct: false,
        flags: ['fail_r4'],
      },
    ],
  },

  {
    id: 'r5',
    act: 'ROUND 05',
    place: '전생 — 조선, 혼례 사흘 전 밤',
    art: 'r5-bg',
    beats: [
      { kind: 'narration', text: '세월이 흘렀다. 그 애는 전장에 버려졌고, 괴물이 되어 돌아왔고, 장군이 되었다.' },
      { kind: 'narration', text: '그리고 내 앞에서는 늘 웃었다. 나는 그 웃음이 연습된 것인 줄 몰랐다.' },
      { kind: 'line', who: 'kihoon', text: '연아- 이제 나 키워줘...!' },
      { kind: 'narration', text: '혼례를 사흘 앞둔 밤, 합환주를 구하러 나갔다가 어릴 적 그림 한 장을 발견했다.' },
      { kind: 'narration', text: '홍실을 묶는 그림이었다. 그 아래에 어린 내 글씨가 있었다. "묶은 직후 끊어지고 말았지만."' },
      { kind: 'line', who: 'rock', text: '…이제야 깨어났구나. 늦어서 미안하다.' },
      { kind: 'line', who: 'rock', text: '그 아이는 홍염인이다. 누구와도 홍실이 닿지 않은 채 태어난 아이. 홍염인은 홀로 설 때 가장 온전하다.' },
      { kind: 'line', who: 'rock', text: '억지로 실을 이으면 없던 구멍이 뚫리고, 그 틈으로 불행이 스며들어, 완성되지 못한 홍실은 결국 저주가 된다.' },
      { kind: 'narration', text: '그날 밤 자객이 들었다. 그 사람은 나를 방에 넣고 밖에서 문을 잠갔다.' },
      { kind: 'line', who: 'kihoon', text: '반나절만 그곳에 있다가 집으로 돌아가, 선녀야.' },
      { kind: 'line', who: 'kihoon', text: '…결국, 이런 방법밖에 생각 못 해서 미안해.' },
    ],
    prompt: '문은 열리지 않는다. 무엇을 할 것인가.',
    choices: [
      {
        id: 'r5a',
        kind: 'do',
        short: '문을 두드린다',
        label: '문을 두드리며 그 사람의 이름을 부른다',
        aside:
          '열어. 열어, 홍기훈. 손이 부서지도록 두드렸지만 문은 열리지 않았다. 그리고 나는 빌었다. 부디 다음 생에는, 당신이 나를 만나지 않기를. 그 소원이 저주가 됐다.',
        art: 'r5-c1',
        axes: { bond: 2, self: -1 },
      },
      {
        id: 'r5b',
        kind: 'do',
        short: '날이 새기를 기다린다',
        label: '소리 없이 앉아 날이 새기를 기다린다',
        aside:
          '내가 당신의 발목을 잡은 것이 맞았구나. 혼례를 올리지 않아서 다행이다. 그 태양 같은 웃음에 다시는 나 같은 오점이 묻지 않기를. 저주와 소원은 같은 문장이었다.',
        art: 'r5-c2',
        axes: { self: -2, truth: 1 },
      },
      {
        id: 'r5c',
        kind: 'read',
        short: '아팠던 걸까',
        label: '저 사람은, 여태 한 번도 안 아팠던 게 아니었던 걸까?',
        aside:
          '문 너머에서 숨소리가 흔들렸다. 그 사람은 늘 아팠고, 늘 웃었고, 한 번도 말하지 않았다. 두 번 살고도 나는 그걸 그날 밤에야 알았다.',
        art: 'r5-c3',
        axes: { truth: 2, bond: 1 },
        correct: true,
        flags: ['read_hurt'],
      },
    ],
  },

  {
    id: 'r6',
    act: 'ROUND 06',
    place: '현대 — 대학 캠퍼스, 그리고 지금',
    art: 'r6-bg',
    /* R4에서 꿈을 끝까지 보지 못했을 때만 붙는 구간. */
    penalty: {
      when: 'fail_r4',
      beats: [
        { kind: 'narration', text: '꿈에서 도망쳤더니 현실이 나를 묶었다. 일주일짜리 페널티였다.' },
        { kind: 'line', who: 'kihoon', text: '검사님! 저 또 왔어요! 아니 왜 자꾸 오냐면요, 안 오면 손목이 아파서.' },
        { kind: 'line', who: 'kihoon', text: '…이거 좀 이상한데. 스토커 같잖아. 저 스토커 아니에요. 형이 원래 인기가 많아서 그렇지.' },
        { kind: 'inner', text: '일주일. 이 사람이랑 3미터 안에서 일주일.' },
        { kind: 'line', who: 'kihoon', text: '아 근데 검사님 집 진짜 깔끔하다. 아무것도 없네. 사람 사는 집 맞아요?' },
        { kind: 'inner', text: '7년 동안 아무것도 안 늘렸으니까. 언제든 없어질 수 있게.' },
        { kind: 'line', who: 'kihoon', text: '그럼 제가 하나 놓고 갈게요. 뭐 놓고 가면 또 와야 되잖아요? 아, 완벽한데 이거?' },
        { kind: 'inner', text: '…멍청이.' },
        { kind: 'narration', text: '일주일째 되는 날 실이 풀렸다. 그 사람이 놓고 간 컵은 그대로 남았다.' },
      ],
    },
    beats: [
      { kind: 'narration', text: '조각이 돌아올수록 그 사람은 자꾸 멈춰 섰다. 낯선 데서 익숙한 표정을 지었다.' },
      { kind: 'narration', text: '그리고 어느 날 캠퍼스로 나를 불러냈다. 우리가 처음으로 다시 만났던 곳이었다.' },
      { kind: 'line', who: 'kihoon', text: '여기 오면 뭐가 생각날 것 같았는데. 안 나네.' },
      { kind: 'line', who: 'kihoon', text: '…아니다. 하나 났다. 누가 여기서 나한테 되게 화냈던 것 같은데.' },
      { kind: 'inner', text: '나야. 매일 냈어.' },
      { kind: 'line', who: 'kihoon', text: '검사님. 아니 이연 씨. 저 부탁 하나만 해도 돼요?' },
      { kind: 'narration', text: '그리고 그 사람은, 기억도 없으면서 7년 전과 똑같은 말을 했다.' },
      { kind: 'line', who: 'kihoon', text: '제가 겁이 좀 많은 것 같아요. 뭔지 몰라도 자꾸 말이 안 나와요.' },
      { kind: 'line', who: 'kihoon', text: '그러니까 이연 씨가— 제 생각을, 마음대로 해석해 볼래요?' },
      { kind: 'line', who: 'kihoon', text: '이연 씨가 해석하고, 생각한 대로 저를 잡아당겨 주면. 모르는 척, 열심히 따라가 볼게요.' },
      { kind: 'line', who: 'kihoon', text: '…저를 알아차려 줄래요?' },
      {
        kind: 'quest',
        card: {
          round: '제4라운드',
          label: '〈이번엔, 알아차려 주세요〉',
          deadline: '없음',
          penalty: '없음',
        },
      },
      { kind: 'line', who: 'rock', text: '이번엔 페널티가 없어요. 대신 이건 두 번째 기회거든요. 지난 생에 놓친 걸, 이번엔 놓치지 마세요.' },
      { kind: 'inner', text: '두 번 살고도 이 사람은 똑같은 부탁을 한다. 그리고 나는 두 번 다 그걸 못 알아차렸다.' },
    ],
    prompt: '저 사람이 진짜로 하고 싶은 말은.',
    choices: [
      {
        id: 'r6a',
        kind: 'read',
        short: '좋아한다는 말',
        label: '나를 좋아한다고, 말하고 싶은 걸까?',
        aside:
          '“…그것도 맞는데.” 그 사람이 뒷머리를 긁었다. 맞긴 맞았다. 다만 그게 제일 중요한 건 아니었다. 나는 또 쉬운 답을 골랐다.',
        art: 'r6-c1',
        axes: { bond: 1, truth: -2 },
        correct: false,
      },
      {
        id: 'r6b',
        kind: 'read',
        short: '기억을 달라는 말',
        label: '기억을 돌려 달라고, 말하고 싶은 걸까?',
        aside:
          '“기억이요? 무슨—” 말해 놓고 나서야 알았다. 그 사람은 자기가 뭘 잃었는지도 모른다. 물어볼 수 있는 건 나뿐이었다.',
        art: 'r6-c2',
        axes: { truth: 1, self: 2 },
        correct: false,
      },
      {
        id: 'r6c',
        kind: 'read',
        short: '혼자 두지 말라는 말',
        label: '혼자 감당하게 두지 말아 달라고, 말하고 싶은 걸까?',
        aside:
          '그 사람이 오래 가만히 있었다. 그리고 웃지 않은 채로 말했다. “…어떻게 알았지.” / “나 그거, 아직 말도 안 했는데.”',
        art: 'r6-c3',
        axes: { truth: 2, bond: 2, self: -1 },
        correct: true,
        flags: ['read_alone'],
      },
    ],
  },

  {
    id: 'r7',
    act: 'ROUND 07',
    place: '현대 — 늦은 밤 포장마차',
    art: 'r7-bg',
    beats: [
      { kind: 'narration', text: '나에게 남은 질문은 하나였다. 무슨 생각으로 내 부탁을 들어줬을까.' },
      { kind: 'narration', text: '7년 전, 잊어달라고 했을 때 그 사람은 한 번도 되묻지 않았다.' },
      { kind: 'inner', text: '직접은 못 묻겠어서, 나는 그걸 남의 이야기로 위장했다.' },
      { kind: 'line', who: 'yeon', text: '저, 사건 하나만 여쭤볼게요. 검은 돌 하나가 있었어요.' },
      { kind: 'line', who: 'yeon', text: '선수님이 그 돌을 되게 아꼈는데, 그 돌이 신발 속에 콕 들어가서 걷지도, 뛰지도 못하게 계속 아프게 하는 거예요.' },
      { kind: 'line', who: 'yeon', text: '그래서 미안해진 검은 돌이 신발 밖으로 나오면서 부탁했어요.' },
      { kind: 'line', who: 'yeon', text: '선수님이 아무 짐 없이 자유롭게 뛰는 걸 보고 싶으니— 자기를 기억에서 지워 달라고.' },
      { kind: 'line', who: 'yeon', text: '…선수님은 뭐라고 답할 것 같아요?' },
      { kind: 'line', who: 'kihoon', text: '푸핫— 이거 뭐예요, 심리 추리? 드라마에서 봤는데.' },
      { kind: 'inner', text: '맞다고 해 뒀다. 그게 편했다.' },
      { kind: 'line', who: 'kihoon', text: '흠. 그럼— 알았다고 할래요.' },
      { kind: 'narration', text: '7년 전에도 같은 목소리였다. "알았어. 그렇게 할게. 네가 원하는 대로 할게, 연아."' },
      { kind: 'line', who: 'yeon', text: '…왜요.' },
      { kind: 'line', who: 'kihoon', text: '다시 만나서 또 좋아하면 되니까.' },
      { kind: 'line', who: 'kihoon', text: '검은 돌이 원하는 대로 실컷 뛰어다니다가, 예전보다 더 튼튼한 강철 발이 돼서,' },
      { kind: 'line', who: 'kihoon', text: '\'이제 안 아파! 다시 들어와!\' 하고 검은 돌을 다시 좋아하면 되잖아요!' },
      { kind: 'line', who: 'kihoon', text: '…근데 이거 무슨 사건이에요? 설마 살인사건?' },
      { kind: 'inner', text: '강철 발이라니. 초등학생도 아니고.' },
      { kind: 'inner', text: '아, 단순해. 사람이 어떻게 이렇게 단순하지. …정말, 그게 이유였어?' },
    ],
    prompt: '마지막으로 물을 것.',
    choices: [
      {
        id: 'r7a',
        kind: 'say',
        short: '자신감을 캔다',
        label: '무슨 자신감이에요. 다시 못 만나면 어쩌려고.',
        aside:
          '“내가 괜찮아진 거 알면, 검은 돌이 먼저 찾으러 와줄걸요?” 7년 전 그 사람의 마지막 말이 겹쳤다. “잘 있어, 선녀야.” 그리고 그 뒤에 붙어 있던 말도. “또 보자!”',
        art: 'r7-c1',
        axes: { truth: 2, bond: 1 },
      },
      {
        id: 'r7b',
        kind: 'say',
        short: '사과한다',
        label: '…늦어서 미안해요. 바보 같이 굴어서, 미안해.',
        aside: '존댓말과 반말이 뒤섞였다. 7년 만에 처음이었다. 그 사람은 왜 우냐고 묻지 않고, 그냥 잔을 내밀었다.',
        art: 'r7-c2',
        axes: { bond: 2, self: -2 },
      },
      {
        id: 'r7c',
        kind: 'do',
        short: '묻지 않는다',
        label: '아무것도 묻지 않고 계산을 하고 나온다',
        aside: '문을 나서는데 그 사람이 따라 나와 우산을 씌웠다. 비는 오지 않았다. “아, 그냥. 뭐 씌워주고 싶어서.”',
        art: 'r7-c3',
        axes: { self: 2, bond: -2 },
      },
    ],
  },

  {
    id: 'rf',
    act: 'FINAL ROUND',
    place: '현대 — 7년 만에 다시 오른 산',
    art: 'rf-bg',
    beats: [
      { kind: 'narration', text: '둘이서 그 마을에 갔다. 그 사람은 처음 오는 곳이라고 했다.' },
      { kind: 'line', who: 'kihoon', text: '와 여기 진짜 아무것도 없다! 이런 데를 왜 왔대요, 우리?' },
      { kind: 'inner', text: '우리라고 했다.' },
      { kind: 'narration', text: '홍실바위 앞에 서자 손목의 실이 마지막으로 뜨거워졌다.' },
      {
        kind: 'quest',
        card: {
          round: '최종 라운드',
          label: '〈마지막으로 한 번 더 닿으세요〉',
          deadline: '없음',
          penalty: '없음 — 어느 쪽을 골라도 저주는 끝납니다',
        },
      },
      { kind: 'line', who: 'rock', text: '고생 많았어요. 이제 정말 마지막이에요. 말해 두는데, 여기서 뭘 고르든 불행은 사라져요. 실패라는 건 없어요.' },
      { kind: 'line', who: 'rock', text: '이건 시험이 아니라 선물이었거든요. 처음으로, 스스로 삶을 고르라고.' },
      { kind: 'line', who: 'kihoon', text: '…뭔지 몰라도, 이연 씨가 정해요.' },
      { kind: 'inner', text: '또 그 말이다.' },
      { kind: 'line', who: 'kihoon', text: '아, 오해하지 마요. 아무래도 상관없다는 게 아니라—' },
      { kind: 'line', who: 'kihoon', text: '이연 씨가 고른 거면 형은 어느 쪽이든 좋아할 자신이 있다는 뜻이에요. 형이 좀 그런 거 잘하거든.' },
      { kind: 'inner', text: '…이 사람은 두 번 살고도 여전히 자기가 뭘 말하는지 모른다.' },
    ],
    prompt: '마지막 선택.',
    choices: [
      {
        id: 'rfa',
        kind: 'do',
        short: '기억을 돌려준다',
        label: '손을 잡고, 남은 기억을 전부 돌려준다',
        aside: '그 사람은 한참을 가만히 있었다. 그리고 내 이름을 불렀다. 전생의 발음으로. “…선녀야.”',
        art: 'rf-c1',
        axes: { bond: 2, truth: 1 },
        flags: ['remember'],
      },
      {
        id: 'rfb',
        kind: 'do',
        short: '실을 끊는다',
        label: '홍실을 끊고, 완전히 놓아준다',
        aside:
          '끊어진 자리에서 붉은빛이 천천히 식었다. 그리고 그 사람이 먼저 말했다. “근데 우리 다음 주에 밥 먹기로 한 건 유효한 거죠?” 놓아주는 것과 사라지는 것은 다른 일이었다.',
        art: 'rf-c2',
        axes: { bond: -2, self: 1 },
        flags: ['release'],
      },
      {
        id: 'rfc',
        kind: 'do',
        short: '처음부터 다시',
        label: '기억도 홍실도 없이, 지금의 이 사람에게 처음부터 다가간다',
        aside:
          '손을 뻗는 대신 이름을 물었다. “선수님, 성함이 어떻게 되세요?” 그 사람이 웃었다. 처음 보는 얼굴로, 똑같이.',
        art: 'rf-c3',
        axes: { self: -2, truth: 1 },
        flags: ['restart'],
      },
    ],
  },
];

/* ── 엔딩 ────────────────────────────────────────────────────────────────
 * 18개 = 우세축 6(3축 × 부호 2) × 종막 3.
 * + 특수 3개 = 좁은 플래그·축 조건으로만 열리는 엔딩. 합 21.
 * 축이나 종막 선택지를 늘리면 그리드가 그대로 늘어난다. */

export interface Ending {
  id: string;
  no: string;
  title: string;
  lead: string;
  rarity: RarityKey;
  art: string;
  /** 카드 앞면 일러스트 슬롯 — 엔딩 컷과 별개 에셋 */
  cardArt: string;
  accent: string;
}

interface GridEnding extends Ending {
  kind: 'grid';
  axis: AxisKey;
  sign: '+' | '-';
  finale: FinaleFlag;
}

interface SpecialEnding extends Ending {
  kind: 'special';
  match: (r: Resolved) => boolean;
}

export type AnyEnding = GridEnding | SpecialEnding;

const HONG = '#FF2E63';
const DEEP = '#9C001D';

/* 특수 엔딩은 그리드보다 먼저 판정된다. 이 배열의 순서 = 판정 우선순위이므로
 * 조건이 좁은 것부터 온다. 화면 표시는 번호순이어야 하므로 ENDINGS에서 다시 정렬한다. */
const SPECIAL: SpecialEnding[] = [
  {
    kind: 'special',
    id: 'read_him',
    no: '21',
    title: '알아차린 사람',
    lead: '세 번을 다 맞혔다. 무서워하는 얼굴도, 한 번도 안 아팠던 게 아니라는 것도, 혼자 감당하게 두지 말라는 말도. 전생에 이름을 지어 준 사람이 이번 생엔 마음을 읽어 줬다. 이 사람은 두 번 다 나한테서 뭔가를 받은 셈이다. 이번엔 놓치지 않았다. 그거 하나만 다르게 했다.',
    rarity: 'HOLO',
    art: 'end-21',
    cardArt: 'card-21',
    accent: '#2DE2FF',
    /* 원작 17화 "나를 알아차려 줄래?" 계약의 종착점. read 3문제를 전부 맞히고,
     * 전생에서 이름의 뜻까지 말해 주고, 마지막에 기억까지 돌려준 경로에서만 열린다.
     * 종막 플래그를 조건에 넣는 이유 — 넣지 않으면 이 엔딩이 최종 선택을 통째로
     * 덮어써서 게임의 중심 결정이 무의미해진다. */
    match: (r) =>
      r.flags.has('read_fear') &&
      r.flags.has('read_hurt') &&
      r.flags.has('read_alone') &&
      r.flags.has('named_him') &&
      r.flags.has('remember'),
  },
  {
    kind: 'special',
    id: 'unwish',
    no: '19',
    title: '소원을 무르다',
    lead: '홍실을 만든 건 운명이 아니라 내 소원이었다. 다음 생엔 만나지 않게 해 달라던 그 한 줄. 나는 홍실바위에 다시 올라가 그걸 취소했다. 저주는 풀렸고, 기억은 남았다. 이번 생엔 아무도 아무것도 빼앗기지 않는다.',
    rarity: 'HOLO',
    art: 'end-19',
    cardArt: 'card-19',
    accent: '#C6FF3D',
    match: (r) => r.flags.has('found_wish') && r.flags.has('remember') && r.axes.truth >= 5,
  },
  {
    kind: 'special',
    id: 'swap',
    no: '20',
    title: '몫을 바꾸다',
    lead: '전생 내내 앞에 선 건 그 사람이었다. 이번엔 내가 선다. 그 사람은 홍실도 전생도 모른 채 웃고, 나만 전부 기억한 채로 그 옆에 앉는다. 무거운 쪽을 드는 게 이번 생 내 몫이다.',
    rarity: 'SSR',
    art: 'end-20',
    cardArt: 'card-20',
    accent: '#FF4D9D',
    match: (r) => r.flags.has('broke_pattern') && r.flags.has('restart') && r.axes.self <= -4,
  },
];

interface GridSpec {
  axis: AxisKey;
  sign: '+' | '-';
  title: string;
  lead: string;
  rarity: RarityKey;
}

const GRID: Record<FinaleFlag, GridSpec[]> = {
  remember: [
    { axis: 'bond', sign: '+', title: '두 번째 첫사랑', lead: '그 사람은 전부 기억해 냈다. 전생도, 내가 잊어달라고 부탁한 것도. 다 알고 나서 또 나를 골랐다. 두 번째 첫사랑이라니. 세상에서 제일 비효율적인 방법으로 같은 답에 도착하는 인간이다.', rarity: 'R' },
    { axis: 'bond', sign: '-', title: '돌려주고 물러서다', lead: '기억은 돌려줬지만 곁에 남지는 않았다. 나를 고를 자유까지 돌려주고 싶었으니까. 그 사람은 다음 시즌에도 골을 넣었고 나는 그걸 전부 봤다. 멀리서 보는 건 이제 내 특기다.', rarity: 'R' },
    { axis: 'truth', sign: '+', title: '전부 말한 다음에', lead: '홍실도, 전생도, 내가 빈 소원까지 하나도 빠뜨리지 않고 말한 뒤에 손을 잡았다. 그 사람은 오래 듣고 나서 딱 한마디 했다. “왜 혼자 정했어.” 7년 만에 처음으로 혼나 봤다.', rarity: 'SR' },
    { axis: 'truth', sign: '-', title: '이름만 돌려주다', lead: '전생 얘기는 끝내 하지 않았다. 그 사람이 되찾은 건 나를 좋아했다는 사실 하나뿐이다. 나머지는 내가 안고 간다. 원래 내가 지어 준 이름이니까, 무게도 내 몫이 맞다.', rarity: 'R' },
    { axis: 'self', sign: '+', title: '내가 견딜 수 없어서', lead: '그 사람을 위해서라고는 도저히 못 말하겠다. 잊힌 채로 옆에 있는 걸 내가 못 견뎠다. 그래서 돌려줬다. 7년을 버텨 놓고 마지막 3초를 못 버틴 셈이다.', rarity: 'SR' },
    { axis: 'self', sign: '-', title: '네가 고르게 하려고', lead: '내가 대신 정하는 건 전생으로 충분했다. 전부 돌려주고 이번엔 그 사람이 직접 고르게 뒀다. 고르는 데 4초 걸렸다. 4초. 나는 7년이 걸렸는데.', rarity: 'SSR' },
  ],
  release: [
    { axis: 'bond', sign: '+', title: '끊고도 남은 자국', lead: '실은 끊었는데 손목의 붉은 자국은 남았다. 계절이 다 가도록 지워지지 않았다. 그것까지 자를 방법은 없었고, 사실 자르고 싶지도 않았다.', rarity: 'SR' },
    { axis: 'bond', sign: '-', title: '깨끗한 단면', lead: '미련도 자국도 없었다. 그 사람은 시즌 내내 골을 넣었고 나는 그걸 전부 봤다. 이렇게 끝나는 이야기도 있다. 끝났다고 안 보는 건 아니고.', rarity: 'R' },
    { axis: 'truth', sign: '+', title: '끊기 전에 다 말했다', lead: '마지막 문장까지 전한 다음에 잘랐다. 그 사람은 끝까지 들어 줬다. 후회할 말은 하나도 안 남겼다. 후회는 남았지만 말은 안 남았다.', rarity: 'R' },
    { axis: 'truth', sign: '-', title: '말하지 않고 끊다', lead: '이유는 끝내 말하지 않았다. 모르는 편이 나은 것도 있다. 그게 내가 줄 수 있는 마지막 배려였는데, 그 사람은 끝까지 이유를 안 물었다. 그게 이 인간 방식이다.', rarity: 'SR' },
    { axis: 'self', sign: '+', title: '나를 위해 끊다', lead: '처음으로 나를 먼저 골랐다. 죄책감은 생각보다 짧았고, 그 사실이 조금 무서웠다. 이래도 되는 거였구나. 두 번 살고 나서야 배웠다.', rarity: 'R' },
    { axis: 'self', sign: '-', title: '네 인생을 돌려주다', lead: '두 번 다 나 때문에 잃었다. 세 번은 없다. 홍실을 끊는 순간 그 사람은 아무것도 빚지지 않은 사람이 됐다. 홍염인은 홀로 설 때 가장 온전하다고 했으니까.', rarity: 'SSR' },
  ],
  restart: [
    { axis: 'bond', sign: '+', title: '홍실 없이도', lead: '실도 기억도 없이 다시 만났는데 또 나를 좋아했다. 처음부터 홍실이 시킨 게 아니었던 것이다. 조건을 아무리 지워도 같은 답을 내는 인간이다.', rarity: 'R' },
    { axis: 'bond', sign: '-', title: '천천히, 처음부터', lead: '서두르지 않았다. 이번 생은 시간이 아주 많다. 그 사람이 나를 알아 가는 속도에 맞춰 걸었다. 3주째 되는 날 내 커피 취향을 외웠다고 온 세상에 자랑했다.', rarity: 'N' },
    { axis: 'truth', sign: '+', title: '고백부터 다시', lead: '퀘스트도 미션도 없이, 그냥 내가 먼저 좋아한다고 했다. 두 번의 생 전부라는 말은 다음에 하기로 했다. 한 번에 다 주면 이 사람은 또 혼자 짊어질 테니까.', rarity: 'SR' },
    { axis: 'truth', sign: '-', title: '모르는 사람으로 다시', lead: '나는 그냥 어제 처음 본 검사가 됐다. 그 사람은 나를 처음 보는 얼굴로 웃었고, 나는 그 얼굴을 세 번째로 봤다. 세 번째인데도 매번 처음 같다.', rarity: 'R' },
    { axis: 'self', sign: '+', title: '먼저 다가간 쪽', lead: '전생에도 이번에도 늘 그 사람이 먼저 왔다. 이번엔 내가 먼저 갔다. 그게 내가 바꾼 유일한 것이고, 바꿔 보니 별것도 아니었다. 진작 할걸.', rarity: 'N' },
    { axis: 'self', sign: '-', title: '혼자만 아는 재회', lead: '그 사람은 아무것도 모른다. 두 번의 생에서 우리가 어땠는지 아는 사람은 나 하나다. 그래도 옆자리는 비어 있지 않다. 그거면 됐다.', rarity: 'SSR' },
  ],
};

const FINALE_ORDER: readonly FinaleFlag[] = ['remember', 'release', 'restart'];

function buildGrid(): GridEnding[] {
  const out: GridEnding[] = [];
  let n = 0;
  for (const finale of FINALE_ORDER) {
    for (const spec of GRID[finale]) {
      n += 1;
      const id = `${finale}-${spec.axis}-${spec.sign === '+' ? 'plus' : 'minus'}`;
      out.push({
        kind: 'grid',
        id,
        no: String(n).padStart(2, '0'),
        title: spec.title,
        lead: spec.lead,
        rarity: spec.rarity,
        art: `end-${String(n).padStart(2, '0')}`,
        cardArt: `card-${String(n).padStart(2, '0')}`,
        accent: AXES[spec.axis].color,
        axis: spec.axis,
        sign: spec.sign,
        finale,
      });
    }
  }
  return out;
}

/** 21개 엔딩 정본. 판정은 SPECIAL 먼저, 그다음 그리드.
 * SPECIAL 배열은 판정 우선순위 순이라 번호가 뒤섞여 있으므로 표시용으로 다시 정렬한다. */
export const ENDINGS: readonly AnyEnding[] = [
  ...buildGrid(),
  ...[...SPECIAL].sort((a, b) => Number(a.no) - Number(b.no)),
];

export const endingById = (id: string): AnyEnding | undefined => ENDINGS.find((e) => e.id === id);

/* ── 판정 ────────────────────────────────────────────────────────────── */

export interface Resolved {
  axes: Axes;
  flags: Set<FlagKey>;
}

/** 우세축 = |값|이 가장 큰 축. 동점이면 bond > truth > self 고정 순서로 끊는다. */
export function dominantAxis(axes: Axes): { axis: AxisKey; sign: '+' | '-' } {
  let best: AxisKey = AXIS_ORDER[0];
  for (const key of AXIS_ORDER) {
    if (Math.abs(axes[key]) > Math.abs(axes[best])) best = key;
  }
  return { axis: best, sign: axes[best] >= 0 ? '+' : '-' };
}

export function finaleOf(flags: Set<FlagKey>): FinaleFlag {
  if (flags.has('remember')) return 'remember';
  if (flags.has('release')) return 'release';
  return 'restart';
}

export function resolveEnding(resolved: Resolved): AnyEnding {
  for (const ending of SPECIAL) {
    if (ending.match(resolved)) return ending;
  }
  const { axis, sign } = dominantAxis(resolved.axes);
  const finale = finaleOf(resolved.flags);
  const hit = ENDINGS.find(
    (e): e is GridEnding => e.kind === 'grid' && e.finale === finale && e.axis === axis && e.sign === sign,
  );
  // 그리드는 6×3 전수라 여기 도달하면 모델이 깨진 것이다.
  if (!hit) throw new Error(`unreachable grid cell: ${finale}/${axis}/${sign}`);
  return hit;
}

/* ── 플레이 상태 ─────────────────────────────────────────────────────── */

export interface PlayStep {
  sceneId: string;
  choiceId: string;
}

export interface PlayState {
  step: number;
  axes: Axes;
  flags: Set<FlagKey>;
  history: PlayStep[];
}

export const initialPlay = (): PlayState => ({
  step: 0,
  axes: { ...ZERO_AXES },
  flags: new Set(),
  history: [],
});

export const currentScene = (state: PlayState): Scene | null => SCENES[state.step] ?? null;

export const isFinished = (state: PlayState): boolean => state.step >= SCENES.length;

export function choose(state: PlayState, choiceId: string): PlayState {
  const scene = currentScene(state);
  if (!scene) return state;
  const choice = scene.choices.find((c) => c.id === choiceId);
  if (!choice) return state;

  const axes = { ...state.axes };
  for (const key of AXIS_ORDER) axes[key] += choice.axes[key] ?? 0;

  const flags = new Set(state.flags);
  for (const flag of choice.flags ?? []) flags.add(flag);

  return {
    step: state.step + 1,
    axes,
    flags,
    history: [...state.history, { sceneId: scene.id, choiceId: choice.id }],
  };
}

/** 되돌리기 — variant C(기록형)가 이전 장면으로 돌아가는 데 쓴다. */
export function rewindTo(state: PlayState, step: number): PlayState {
  let next = initialPlay();
  for (const entry of state.history.slice(0, step)) next = choose(next, entry.choiceId);
  return next;
}

/* ── 도달 가능성 완전열거 ─────────────────────────────────────────────────
 * 3^(라운드 수) 경로를 전부 돌려 어떤 엔딩이 몇 경로로 열리는지 센다(현재 3^8 = 6561).
 * 축 누적 모델의 유일한 진짜 리스크가 "도달 불가능한 엔딩"이라, 프로토타입이
 * 이 표를 직접 보여준다. 아래 통계 패널의 분포도 여기서 나온다(가짜 수치 아님).
 * 주의: 균등 선택 가정이다 — 실제 유저 분포는 다르다.
 *
 * ⚠ 라운드를 늘리면 3^n으로 폭증한다. 상한을 넘기면 던져서 조용히 느려지는 걸 막는다. */

/** 열거 상한. 넘기면 지도·통계 UI가 프레임을 먹기 시작한다. */
export const MAX_ENUMERATED_PATHS = 20000;

export interface EndingStat {
  ending: AnyEnding;
  paths: number;
  share: number;
}

export interface Enumeration {
  totalPaths: number;
  stats: EndingStat[];
  unreachable: AnyEnding[];
}

/** 경로 하나 = 라운드별 선택 id 시퀀스 + 그 끝에 나온 엔딩. */
export interface EnumeratedPath {
  choiceIds: string[];
  endingId: string;
}

/* 결과가 상수라 한 번만 돈다. endingsReachableFrom이 노드마다 부르기 때문에
 * 메모가 없으면 라운드가 늘어난 지금 지도 렌더가 그대로 느려진다. */
let pathCache: EnumeratedPath[] | null = null;

/** 모든 경로를 펼친다. 집계(enumerateAll)와 지도 하이라이트가 같은 원본을 쓴다. */
export function enumeratePaths(): EnumeratedPath[] {
  if (pathCache) return pathCache;

  const expected = 3 ** SCENES.length;
  if (expected > MAX_ENUMERATED_PATHS) {
    throw new Error(
      `enumeratePaths: ${SCENES.length}라운드 = ${expected}경로로 상한 ${MAX_ENUMERATED_PATHS}을 넘는다. ` +
        '분기 라운드를 줄이거나 열거를 샘플링으로 바꿔야 한다.',
    );
  }

  const paths: EnumeratedPath[] = [];

  const walk = (state: PlayState) => {
    const scene = currentScene(state);
    if (!scene) {
      paths.push({
        choiceIds: state.history.map((entry) => entry.choiceId),
        endingId: resolveEnding({ axes: state.axes, flags: state.flags }).id,
      });
      return;
    }
    for (const choice of scene.choices) walk(choose(state, choice.id));
  };
  walk(initialPlay());

  pathCache = paths;

  return paths;
}

export function enumerateAll(): Enumeration {
  const paths = enumeratePaths();
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(path.endingId, (counts.get(path.endingId) ?? 0) + 1);

  const total = paths.length;
  const stats = ENDINGS.map((ending) => {
    const paths_ = counts.get(ending.id) ?? 0;
    return { ending, paths: paths_, share: total === 0 ? 0 : paths_ / total };
  }).sort((a, b) => b.paths - a.paths);

  return { totalPaths: total, stats, unreachable: stats.filter((s) => s.paths === 0).map((s) => s.ending) };
}

/** 그 라운드에서 그 선택을 했을 때 아직 닿을 수 있는 엔딩들 — 지도의 "열고 닫힘"을 보여준다. */
export function endingsReachableFrom(sceneIndex: number, choiceId: string): Set<string> {
  const hit = new Set<string>();
  for (const path of enumeratePaths()) {
    if (path.choiceIds[sceneIndex] === choiceId) hit.add(path.endingId);
  }
  return hit;
}

/* ── 일러스트 슬롯 ───────────────────────────────────────────────────────
 * 키와 파일 경로의 연결은 art.ts가 맡는다. 슬롯 총계는 그대로 제작 발주 규모다. */

export const ART_SLOTS = {
  sceneBackgrounds: SCENES.length,
  choiceCuts: SCENES.reduce((n, s) => n + s.choices.length, 0),
  endingCuts: ENDINGS.length,
  cardFronts: ENDINGS.length,
};

export const ART_SLOT_COUNT =
  ART_SLOTS.sceneBackgrounds + ART_SLOTS.choiceCuts + ART_SLOTS.endingCuts + ART_SLOTS.cardFronts;

/** 누락 슬롯 키 → 안정적인 플레이스홀더 그라디언트. IP 팔레트(#300008/#9C001D/#FF2E63) 기반. */
export function artPlaceholder(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const angle = 120 + (h % 110);
  const hue = h % 40;
  return `linear-gradient(${angle}deg, ${DEEP}22 0%, #300008 18%, ${DEEP} 52%, ${HONG} 88%, hsl(${330 + hue} 100% 72%) 100%)`;
}

/* ── 카드 & 팝업 페이즈 ──────────────────────────────────────────────────
 * 봉인(sealed): 팝업 진행 중 — 내가 얻은 카드만 나에게 보인다. 통계·교환 잠김.
 * 공개(revealed): 팝업 종료 후 — 전체 통계 공개, 바인더 자랑·교환·실물 인쇄 주문 개방.
 *
 * ⚠ 도메인 충돌 두 건을 이 프로토타입이 일부러 드러낸다:
 *   1) 교환(Exchange)은 CONTEXT.md 기준 v2 플레이스홀더다.
 *   2) 실물 인쇄는 "이미 무상으로 얻은 카드"의 굿즈 주문(POD)으로만 성립한다.
 *      카드를 돈으로 얻는 경로가 되면 ADR-0003 불변식을 깬다. */

export type PopupPhase = 'sealed' | 'revealed';

export const CARD_NO = (ending: AnyEnding): string => `HSQ-${ending.no}`;

/** 프로토타입 인쇄 주문 견적 — 실제 가격 정책 아님. 결제 배선 없음. */
export const PRINT_PRICE_KRW = 18000;

/* ── 엔딩 연동 한정 굿즈 ─────────────────────────────────────────────────
 * 결말마다 그 결말에서만 나올 수 있는 물건을 건다. 팬이 사는 건 아크릴이 아니라
 * "내가 고른 결말"이라, 상품 자체가 서사에서 직접 나와야 한다.
 *
 * 계층형 5 SKU: 종막 3갈래에 대표 1종씩 + 특수 엔딩 2개 전용.
 * 20명이 각자 다른 걸 받는 느낌은 카드 20종이 만들고, 실재고 부담은 5종으로 막힌다.
 * 1:1로 늘리고 싶으면 goodsForEnding의 매핑만 바꾸면 된다.
 *
 * ⚠ 확률형 아이템이 아니다. 엔딩은 RNG가 아니라 플레이어의 결정론적 선택 결과이고
 *   재플레이는 무료다. 돈을 내고 결과를 뽑는 경로는 이 설계 어디에도 없다.
 * ⚠ "한정"은 실제로 한정이어야 한다. 팝업 종료 시각과 수량이 실제로 집행되지 않으면
 *   표시·광고 문제가 된다. 가격은 전부 프로토타입 제안값이고 원가·마진 미검토다. */

export interface EndingGoods {
  id: string;
  name: string;
  type: string;
  priceKrw: number;
  /** 왜 이 결말에 이 물건인가 — 판매 화면에 그대로 노출한다 */
  why: string;
  accent: string;
  /** 상세 화면용 — 구성과 소재 */
  madeOf: string;
  /** 주문 시 사용자가 채워야 하는 값이 있으면 여기 둔다(각인 문구 등) */
  option?: { label: string; placeholder: string; note: string };
}

/** 한정 굿즈 공통 제작·배송 조건. 팝업이 끝나야 수량이 확정되므로 일괄 제작이다. */
export const GOODS_FULFILLMENT = [
  '팝업 종료 시점에 주문 수량을 확정하고 일괄 제작에 들어간다.',
  '제작 4주 + 배송 1주. 종료일 기준 약 5주 뒤 순차 발송된다.',
  '한정 수량이며 팝업 종료와 함께 판매도 닫힌다. 이후 재판매하지 않는다.',
];

export const ENDING_GOODS: Record<string, EndingGoods> = {
  'goods-name': {
    id: 'goods-name',
    name: '「이름을 지어 준 날」 각인 홍실 팔찌',
    type: '팔찌 · 각인',
    priceKrw: 38000,
    why: '전생에서 이연이 이름 없던 아이에게 이름을 지어 준 날의 물건. 안쪽에 원하는 이름을 새겨 준다. 기억을 돌려준 결말은 결국 이름을 되찾아 준 이야기다.',
    accent: '#FF2E63',
    madeOf: '92.5 실버 체인 + 홍실 인레이. 안쪽 면에 레이저 각인.',
    option: {
      label: '각인할 이름',
      placeholder: '예: 기훈',
      note: '전생에서 이연이 이름을 지어 준 장면에서 나온 옵션이다. 최대 8자, 한글·영문 모두 가능.',
    },
  },
  'goods-cut': {
    id: 'goods-cut',
    name: '「끊어진 실」 페어 참 세트',
    type: '참 2점 세트',
    priceKrw: 26000,
    why: '두 동강 난 홍실의 양쪽 끝이 함께 온다. 하나는 남에게 줘도 되고 둘 다 가져도 된다. 끊었다고 없어지지는 않는다.',
    accent: '#2DE2FF',
    madeOf: '황동 참 2점 + 홍실 매듭 2점. 단면이 서로 맞물리게 잘려 있다.',
  },
  'goods-blank': {
    id: 'goods-blank',
    name: '「이름 없는 명찰」 빈 각인 키링',
    type: '키링 · 셀프 각인',
    priceKrw: 16000,
    why: '아무것도 새겨지지 않은 채로 온다. 사는 사람이 직접 쓴다. 홍실도 기억도 없이 처음부터 시작하는 결말에는 아직 이름이 없다.',
    accent: '#FFB23D',
    madeOf: '스테인리스 명찰 키링 1점 + 각인용 스타일러스. 아무것도 새겨지지 않은 채로 배송된다.',
  },
  'goods-wish': {
    id: 'goods-wish',
    name: '「홍실바위 소원지」 봉인 세트',
    type: '한지 소원지 + 홍실 매듭',
    priceKrw: 45000,
    why: '소원을 적어 봉인하고, 원하면 도로 풀 수 있게 묶는다. 저주의 근원이던 소원을 직접 무른 단 하나의 결말에만 붙는다.',
    accent: '#C6FF3D',
    madeOf: '한지 소원지 5매 + 봉인용 홍실 매듭 + 오동나무 보관함.',
    option: {
      label: '소원지에 인쇄할 문구',
      placeholder: '비워 두면 무지로 갑니다',
      note: '무지로 받아 직접 쓰는 쪽을 권한다. 무를 수 있어야 소원이다.',
    },
  },
  'goods-read': {
    id: 'goods-read',
    name: '「알아차려 줄래?」 봉함 카드 3통',
    type: '봉함 카드 3점 세트',
    priceKrw: 29000,
    why: '그 사람이 끝내 입 밖에 내지 못한 세 마디가 각각 봉해져 있다. 뜯지 않아도 되고, 뜯어도 된다. 세 번을 다 알아차린 결말에만 붙는다.',
    accent: '#2DE2FF',
    madeOf: '레터프레스 카드 3매 + 홍실 봉인. 각 봉투는 한 번 뜯으면 다시 봉해지지 않는다.',
  },
  'goods-uneven': {
    id: 'goods-uneven',
    name: '「비대칭 페어」 팔찌 2종 세트',
    type: '팔찌 2점 세트',
    priceKrw: 32000,
    why: '한쪽 실만 유독 길다. 짊어진 몫이 서로 다르다는 뜻이다. 이번 생엔 이연이 무거운 쪽을 든 결말에만 붙는다.',
    accent: '#FF4D9D',
    madeOf: '92.5 실버 팔찌 2점 세트. 한쪽 실 길이가 의도적으로 더 길다.',
  },
};

/** 종막 갈래별 대표 굿즈. 특수 엔딩은 아래 goodsForEnding에서 전용 SKU가 먼저 잡힌다. */
const GOODS_BY_FINALE: Record<FinaleFlag, string> = {
  remember: 'goods-name',
  release: 'goods-cut',
  restart: 'goods-blank',
};

const GOODS_BY_SPECIAL: Record<string, string> = {
  unwish: 'goods-wish',
  swap: 'goods-uneven',
  read_him: 'goods-read',
};

export function goodsForEnding(ending: AnyEnding): EndingGoods {
  const special = GOODS_BY_SPECIAL[ending.id];
  if (special) return ENDING_GOODS[special];
  const finale = ending.kind === 'grid' ? ending.finale : 'remember';
  return ENDING_GOODS[GOODS_BY_FINALE[finale]];
}

export const GOODS_SKU_COUNT = Object.keys(ENDING_GOODS).length;
