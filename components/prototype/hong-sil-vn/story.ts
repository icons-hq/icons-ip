/* ═══════════════════════════════════════════════════════════════════════
 * PROTOTYPE — 홍실 퀘스트 온라인 팝업 · 서사형 행동 체험 게임
 * 버릴 코드다. 이 파일과 형제 파일들을 프로덕션으로 승격하지 말 것.
 *
 * 답하려는 질문
 *   "선택 → 축 누적 → 20개 엔딩 → 엔딩 카드(봉인) → 팝업 종료 후 공개"
 *   이 루프가 화면으로 성립하는가. 세 가지 구조를 나란히 놓고 고른다(?variant=A|B|C).
 *
 * 이 모듈은 순수하다 — DOM·네트워크·랜덤·시간에 의존하지 않는다.
 * variant 컴포넌트가 이걸 import 하고, 반대 방향으로는 흐르지 않는다.
 *
 * 원작 기반 (시즌 2 완결 직후에서 분기한다)
 *   본편: 법학과 신입생 이연은 중학생 때부터 선배 홍기훈을 짝사랑했다. 홍실바위에서
 *   빈 소원이 스킨십을 강요하는 홍실 퀘스트가 되고, 미션을 수행하며 연인이 된다.
 *   전생에서 이연은 이름 없던 아이에게 '기훈'이라는 이름을 지어 줬고, 기훈은 이연을
 *   지키려 전부 희생했다. 죄책감에 이연이 "다음 생엔 만나지 않게" 빌었고 그 소원이
 *   두 사람을 묶는 홍실의 저주가 됐다. 시즌 2 결말에서 이연은 기훈에게 자신을
 *   잊어달라 부탁하고, 기억을 잃은 기훈은 이연을 다시 만나자마자 또 사랑에 빠진다.
 *   그리고 접촉할 때마다 기억이 돌아오는 '홍기훈 퀘스트'가 예고되며 끝난다.
 *
 *   이 게임은 바로 그 지점에서 시작한다 — 플레이어는 이연으로서 홍기훈 퀘스트를
 *   치르며, 기억을 돌려줄지 / 놓아줄지 / 홍실 없이 처음부터 다시 할지를 고른다.
 *   작품이 던진 질문("기억도 운명도 사라져도 같은 사람을 다시 사랑할까")에 대한
 *   20가지 대답이 엔딩이다.
 *
 *   확정 = 위 줄거리, 인물, 관계, 홍실바위, 홍기훈 퀘스트 규칙(접촉→기억 회수).
 *   추정 = 개별 장면·대사·엔딩 문장. 본편 대사를 옮긴 게 아니라 결말 이후를 새로 쓴 것이다.
 *   축 가중치·플래그·판정 로직은 카피와 분리돼 있어 문장을 갈아도 살아남는다.
 * ═══════════════════════════════════════════════════════════════════════ */

import type { RarityKey } from '@/lib/rarity';

/* ── 등장인물 ────────────────────────────────────────────────────────────
 * 시점은 이연 1인칭 — 플레이어가 이연을 연기한다. 기훈은 선배라 호칭이 "선배"다. */

export type CastKey = 'yeon' | 'kihoon';

export const CAST: Record<CastKey, { name: string; color: string }> = {
  yeon: { name: '이연', color: '#FF7A9E' },
  kihoon: { name: '홍기훈', color: '#FFB23D' },
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
  self: { name: '아(我)', minus: '선배를 위해', plus: '나를 위해', color: '#FFB23D' },
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
  | 'broke_pattern';

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

/** 소설 문법 — 지문/대사/속마음, 그리고 원작의 퀘스트 문자. 화면은 넷을 다르게 조판한다. */
export type Beat =
  | { kind: 'narration'; text: string }
  | { kind: 'line'; who: CastKey; text: string }
  | { kind: 'inner'; text: string }
  | { kind: 'quest'; text: string };

export interface Choice {
  id: string;
  /** 'say'는 연이 입 밖에 내는 말(따옴표로 조판), 'do'는 행동 */
  kind: 'say' | 'do';
  label: string;
  /** 분기 보드 카드에 들어가는 짧은 이름. 본문 label은 길어서 도판에 안 들어간다. */
  short: string;
  /** 선택 직후 이어지는 서술 — 선택지마다 별도 일러스트를 갖는다 */
  aside: string;
  art: string;
  axes: Partial<Axes>;
  flags?: FlagKey[];
}

export interface Scene {
  id: string;
  act: string;
  place: string;
  art: string;
  beats: Beat[];
  prompt: string;
  choices: [Choice, Choice, Choice];
}

/** 'say' 선택지는 대사이므로 따옴표를 붙여 조판한다. */
export const choiceText = (choice: Choice): string =>
  choice.kind === 'say' ? `“${choice.label}”` : choice.label;

export const SCENES: readonly Scene[] = [
  {
    id: 'act1',
    act: 'ROUND 01',
    place: '현대 — 선배가 나를 잊은 다음',
    art: 'act1-bg',
    beats: [
      { kind: 'narration', text: '홍실 퀘스트는 끝났다. 내가 부탁했고, 선배는 나를 잊었다.' },
      { kind: 'narration', text: '그러면 됐다고 생각했다. 홍기훈은 아무것도 잃지 않은 채로 새 학기를 시작할 테니까.' },
      { kind: 'narration', text: '그런데 개강 첫날, 강의실 문을 열고 들어온 선배가 나를 보고 멈춰 섰다.' },
      { kind: 'line', who: 'kihoon', text: '…우리 어디서 봤나? 아니다. 그냥, 아는 얼굴 같아서.' },
      { kind: 'inner', text: '기억은 다 지웠으면서, 왜 또 그런 얼굴을 하는데.' },
      { kind: 'narration', text: '그날 밤 손목이 따끔했다. 없어진 줄 알았던 홍실이 다시 감겨 있었다. 이번엔 나한테만 보이는 실이었다.' },
      { kind: 'quest', text: '홍기훈 퀘스트 제1라운드 — 손을 잡으세요. 닿을 때마다 잃어버린 기억이 돌아옵니다.' },
      { kind: 'inner', text: '돌려주면 선배는 또 전부 짊어질 거다. 지난번처럼, 전생처럼.' },
    ],
    prompt: '손을 뻗을 것인가.',
    choices: [
      {
        id: 'a1',
        kind: 'say',
        short: '손을 잡는다',
        label: '선배. 손 좀… 잡아도 돼요?',
        aside: '선배는 잠깐 웃더니 순순히 손을 내밀었다. 손끝이 닿는 순간 선배의 눈이 크게 흔들렸다. 조각 하나가 돌아온 것이다.',
        art: 'act1-c1',
        axes: { bond: 2, self: -1 },
      },
      {
        id: 'a2',
        kind: 'do',
        short: '문자를 지운다',
        label: '문자를 지우고, 선배를 피해 강의실을 나선다',
        aside: '복도 끝까지 걸어 나오는 동안 실이 계속 당겨졌다. 나는 소매를 끌어내려 손목을 덮었다.',
        art: 'act1-c2',
        axes: { bond: -2, truth: -1 },
      },
      {
        id: 'a3',
        kind: 'do',
        short: '근원을 캔다',
        label: '이 퀘스트가 왜 다시 시작됐는지부터 캔다',
        aside: '홍실바위에 다시 올라가 보고 알았다. 이 저주를 만든 소원은 처음부터 내 것이었다. \u201c다음 생엔 만나지 않게 해 주세요.\u201d',
        art: 'act1-c3',
        axes: { truth: 2, self: 1 },
        flags: ['found_wish'],
      },
    ],
  },
  {
    id: 'act2',
    act: 'ROUND 02',
    place: '전생 — 이름을 지어 준 날',
    art: 'act2-bg',
    beats: [
      { kind: 'narration', text: '접촉으로 돌아온 건 선배의 기억만이 아니었다. 내 것도 같이 딸려 왔다.' },
      { kind: 'narration', text: '달빛, 정자, 낯선 옷자락. 내가 살아 본 적 없는 계절이 거기 있었다.' },
      { kind: 'narration', text: '그 계절 속에서 나는 이름도 없던 아이의 손목에 붉은 실을 묶어 주고 있었다.' },
      { kind: 'line', who: 'yeon', text: '오늘부터 네 이름은 기훈이야.' },
      { kind: 'line', who: 'kihoon', text: '…기훈. 그럼 저 이제 도련님이랑 혼인해도 돼요?' },
      { kind: 'narration', text: '그 애는 웃었고, 나는 그게 농담인 줄 알았다. 그 애는 평생 그 말을 지켰다.' },
      { kind: 'narration', text: '기억은 거기서 멈추지 않았다. 그 애가 나를 지키느라 하나씩 잃어 가는 장면까지, 전부.' },
      { kind: 'inner', text: '내 사랑이 당신 인생을 망쳤다. 그때도, 지금도.' },
    ],
    prompt: '기억이 밀려온다.',
    choices: [
      {
        id: 'b1',
        kind: 'do',
        short: '끝까지 본다',
        label: '눈을 감고, 전생의 끝까지 전부 본다',
        aside: '마지막 장면에서 나는 빌고 있었다. 다음 생엔 만나지 않게 해 달라고. 그 소원이 우리를 묶은 홍실이 됐다.',
        art: 'act2-c1',
        axes: { truth: 2, bond: 1 },
      },
      {
        id: 'b2',
        kind: 'say',
        short: '기억을 밀어낸다',
        label: '그만. 이건 내가 볼 기억이 아니야.',
        aside: '기억은 순순히 물러났다. 너무 순순해서, 오히려 그게 오래 남았다.',
        art: 'act2-c2',
        axes: { truth: -2, self: 1 },
        flags: ['refused_memory'],
      },
      {
        id: 'b3',
        kind: 'do',
        short: '앞을 막는다',
        label: '기억 속으로 손을 뻗어, 이번엔 내가 그 애 앞을 막는다',
        aside: '바뀌는 건 없었다. 다만 전생의 그 애가 처음으로 놀란 얼굴을 했다. 늘 자기가 앞에 서던 자리였으니까.',
        art: 'act2-c3',
        axes: { bond: 2, self: -2 },
        flags: ['broke_pattern'],
      },
    ],
  },
  {
    id: 'act3',
    act: 'ROUND 03',
    place: '현대 — 선배가 눈치챈다',
    art: 'act3-bg',
    beats: [
      { kind: 'narration', text: '조각이 돌아올수록 선배는 자꾸 멈춰 섰다. 낯선 데서 익숙한 표정을 지었다.' },
      { kind: 'line', who: 'kihoon', text: '이상하지. 너랑 있으면 자꾸 뭘 하나 빠뜨린 기분이 들어.' },
      { kind: 'line', who: 'kihoon', text: '…나 뭐 잊어버렸냐?' },
      { kind: 'inner', text: '응. 나를 잊었어. 내가 그렇게 해 달라고 했어.' },
      { kind: 'narration', text: '말하는 순간 선배는 다시 전부 짊어질 것이다. 전생에서 그랬듯이.' },
    ],
    prompt: '알게 된 것을 어떻게 할 것인가.',
    choices: [
      {
        id: 'c1',
        kind: 'say',
        short: '털어놓는다',
        label: '선배. 나 선배한테 되게 큰 거 하나 숨기고 있어요.',
        aside: '말이 끝날 때까지 선배는 한 번도 웃지 않았다. 다 듣고 나서 딱 한마디 했다. \u201c왜 혼자 정했어.\u201d',
        art: 'act3-c1',
        axes: { truth: 2, bond: -1 },
      },
      {
        id: 'c2',
        kind: 'do',
        short: '혼자 감당한다',
        label: '아무 말도 하지 않고, 혼자 감당하기로 한다',
        aside: '그날부터 잠을 잃었다. 대신 선배는 아무것도 잃지 않았다. 계산은 맞았다.',
        art: 'act3-c2',
        axes: { self: -2, truth: -1 },
      },
      {
        id: 'c3',
        kind: 'do',
        short: '내 삶을 택한다',
        label: '실을 소매 안에 감춘 채, 원래의 학기로 돌아간다',
        aside: '강의를 듣고, 과제를 내고, 선배랑 밥을 먹었다. 손목은 계속 따끔했지만 하루는 멀쩡히 굴러갔다.',
        art: 'act3-c3',
        axes: { self: 2, bond: -1 },
      },
    ],
  },
  {
    id: 'act4',
    act: 'FINAL ROUND',
    place: '홍기훈 퀘스트 — 마지막 접촉',
    art: 'act4-bg',
    beats: [
      { kind: 'quest', text: '홍기훈 퀘스트 최종 라운드 — 마지막으로 한 번 더 닿으세요. 이 접촉으로 남은 기억이 전부 돌아옵니다.' },
      { kind: 'narration', text: '손끝 하나면 된다. 여기서 닿으면 선배는 전부 기억해 낸다. 전생까지, 내가 잊어달라고 부탁한 것까지 전부.' },
      { kind: 'line', who: 'kihoon', text: '…뭔지 몰라도, 네가 정해. 나는 어느 쪽이든 괜찮아.' },
      { kind: 'inner', text: '괜찮다는 말이 제일 아프다는 걸, 이 사람은 두 번 살고도 모른다.' },
    ],
    prompt: '마지막 선택.',
    choices: [
      {
        id: 'd1',
        kind: 'do',
        short: '기억을 돌려준다',
        label: '선배의 손을 잡고, 남은 기억을 전부 돌려준다',
        aside: '선배는 한참을 가만히 있었다. 그리고 내 이름을 불렀다. 전생의 발음으로.',
        art: 'act4-c1',
        axes: { bond: 2, truth: 1 },
        flags: ['remember'],
      },
      {
        id: 'd2',
        kind: 'do',
        short: '실을 끊는다',
        label: '홍실을 끊고, 선배를 완전히 놓아준다',
        aside: '끊어진 자리에서 붉은빛이 천천히 식었다. 선배는 왜 우느냐고 물었고, 나는 대답하지 못했다.',
        art: 'act4-c2',
        axes: { bond: -2, self: 1 },
        flags: ['release'],
      },
      {
        id: 'd3',
        kind: 'do',
        short: '처음부터 다시',
        label: '기억도 홍실도 없이, 지금의 선배에게 처음부터 다가간다',
        aside: '손을 뻗는 대신 이름을 물었다. \u201c선배, 이름이 뭐예요?\u201d 선배가 웃었다. 처음 보는 얼굴로, 똑같이.',
        art: 'act4-c3',
        axes: { self: -2, truth: 1 },
        flags: ['restart'],
      },
    ],
  },
];

/* ── 엔딩 ────────────────────────────────────────────────────────────────
 * 18개 = 우세축 6(3축 × 부호 2) × 종막 3.
 * + 특수 2개 = 좁은 플래그·축 조건으로만 열리는 엔딩. 합 20.
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

/* 특수 엔딩은 그리드보다 먼저 판정된다(우선순위 순서). */
const SPECIAL: SpecialEnding[] = [
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
    lead: '전생 내내 앞에 선 건 선배였다. 이번엔 내가 선다. 선배는 홍실도 전생도 모른 채 웃고, 나만 전부 기억한 채로 그 옆에 앉는다. 무거운 쪽을 드는 게 이번 생 내 몫이다.',
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
    { axis: 'bond', sign: '+', title: '두 번째 첫사랑', lead: '선배는 전부 기억해 냈다. 전생도, 내가 잊어달라고 부탁한 것도. 그리고 다 알고 나서 또 나를 골랐다.', rarity: 'R' },
    { axis: 'bond', sign: '-', title: '돌려주고 물러서다', lead: '기억은 돌려줬지만 곁에 남지는 않았다. 선배가 나를 고를 자유까지 돌려주고 싶었다.', rarity: 'N' },
    { axis: 'truth', sign: '+', title: '전부 말한 다음에', lead: '홍실도, 전생도, 내가 빈 소원까지 하나도 빠뜨리지 않고 말한 뒤에 손을 잡았다. 선배는 오래 듣고 나서 “왜 혼자 정했어”라고만 했다.', rarity: 'SR' },
    { axis: 'truth', sign: '-', title: '이름만 돌려주다', lead: '전생 얘기는 끝내 하지 않았다. 선배가 되찾은 건 나를 좋아했다는 사실뿐이다. 나머지는 내가 안고 간다.', rarity: 'R' },
    { axis: 'self', sign: '+', title: '내가 견딜 수 없어서', lead: '선배를 위해서라고 말할 수 없다. 잊힌 채로 옆에 있는 걸 내가 못 견뎠다. 그래서 돌려줬다.', rarity: 'SR' },
    { axis: 'self', sign: '-', title: '네가 고르게 하려고', lead: '내가 대신 정하는 건 전생으로 충분했다. 전부 돌려주고, 이번엔 선배가 직접 고르게 뒀다.', rarity: 'SSR' },
  ],
  release: [
    { axis: 'bond', sign: '+', title: '끊고도 남은 자국', lead: '실은 끊었는데 손목의 붉은 자국은 남았다. 학기가 다 가도록 지워지지 않았다. 그것까지 자를 방법은 없었다.', rarity: 'SR' },
    { axis: 'bond', sign: '-', title: '깨끗한 단면', lead: '미련도 자국도 없었다. 다음 학기에 선배는 졸업했고, 우리는 학관에서 가볍게 인사했다. 이렇게 끝나는 이야기도 있다.', rarity: 'N' },
    { axis: 'truth', sign: '+', title: '끊기 전에 다 말했다', lead: '마지막 문장까지 전한 다음에 잘랐다. 선배는 끝까지 들어 줬다. 후회할 말은 하나도 남기지 않았다.', rarity: 'R' },
    { axis: 'truth', sign: '-', title: '말하지 않고 끊다', lead: '이유는 끝내 말하지 않았다. 모르는 편이 나은 것도 있다. 그게 내가 줄 수 있는 마지막 배려였다.', rarity: 'SR' },
    { axis: 'self', sign: '+', title: '나를 위해 끊다', lead: '처음으로 나를 먼저 골랐다. 죄책감은 생각보다 짧았고, 그 사실이 조금 무서웠다.', rarity: 'R' },
    { axis: 'self', sign: '-', title: '네 인생을 돌려주다', lead: '두 번 다 선배가 나 때문에 잃었다. 세 번은 없다. 홍실을 끊는 순간 선배는 아무것도 빚지지 않은 사람이 됐다.', rarity: 'SSR' },
  ],
  restart: [
    { axis: 'bond', sign: '+', title: '홍실 없이도', lead: '실도 기억도 없이 다시 만났는데 선배는 또 나를 좋아했다. 처음부터 홍실이 시킨 게 아니었던 것이다.', rarity: 'R' },
    { axis: 'bond', sign: '-', title: '천천히, 처음부터', lead: '서두르지 않았다. 이번 생은 시간이 아주 많다. 선배가 나를 알아 가는 속도에 맞춰 걸었다.', rarity: 'N' },
    { axis: 'truth', sign: '+', title: '고백부터 다시', lead: '퀘스트도 미션도 없이, 그냥 내가 먼저 좋아한다고 했다. 중학교 때부터라는 말은 다음에 하기로 했다.', rarity: 'SR' },
    { axis: 'truth', sign: '-', title: '모르는 사람으로 다시', lead: '나는 그냥 같은 과 후배가 됐다. 선배는 나를 처음 보는 얼굴로 웃었고, 나는 그 얼굴을 두 번째로 봤다.', rarity: 'R' },
    { axis: 'self', sign: '+', title: '먼저 다가간 쪽', lead: '전생에도 이번에도 늘 선배가 먼저 왔다. 이번엔 내가 먼저 갔다. 그게 내가 바꾼 유일한 것이다.', rarity: 'N' },
    { axis: 'self', sign: '-', title: '혼자만 아는 재회', lead: '선배는 아무것도 모른다. 두 번의 생에서 우리가 어땠는지 아는 사람은 나 하나다. 그래도 옆자리는 비어 있지 않다.', rarity: 'SSR' },
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

/** 20개 엔딩 정본. 판정은 SPECIAL 먼저, 그다음 그리드. */
export const ENDINGS: readonly AnyEnding[] = [...buildGrid(), ...SPECIAL];

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
 * 3^4 = 81 경로를 전부 돌려 어떤 엔딩이 몇 경로로 열리는지 센다.
 * 축 누적 모델의 유일한 진짜 리스크가 "도달 불가능한 엔딩"이라, 프로토타입이
 * 이 표를 직접 보여준다. 아래 통계 패널의 분포도 여기서 나온다(가짜 수치 아님).
 * 주의: 균등 선택 가정이다 — 실제 유저 분포는 다르다. */

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

/** 81경로를 전부 펼친다. 집계(enumerateAll)와 지도 하이라이트가 같은 원본을 쓴다. */
export function enumeratePaths(): EnumeratedPath[] {
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
};

export function goodsForEnding(ending: AnyEnding): EndingGoods {
  const special = GOODS_BY_SPECIAL[ending.id];
  if (special) return ENDING_GOODS[special];
  const finale = ending.kind === 'grid' ? ending.finale : 'remember';
  return ENDING_GOODS[GOODS_BY_FINALE[finale]];
}

export const GOODS_SKU_COUNT = Object.keys(ENDING_GOODS).length;
