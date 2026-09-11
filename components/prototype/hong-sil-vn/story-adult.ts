/* ═══════════════════════════════════════════════════════════════════════
 * PROTOTYPE — 홍실 퀘스트 · 성인 트랙 확장 비트
 * 버릴 코드다. 프로덕션으로 승격하지 말 것.
 *
 * 이 모듈은 **별도 청크**다. 연령 게이트를 통과한 세션만 동적 import 해서
 * registerAdultTrack()으로 등록한다. 전연령 플레이에는 로드되지 않는다.
 * 실서비스에서는 이 전달을 서버가 맡는다 — 클라이언트 분기만으로는 번들을
 * 뜯으면 보이므로 부족하다(docs/ip/hong-sil-quest/adult-track.md §4).
 *
 * 규율
 *   1) 축·플래그·선택지·엔딩 판정은 전연령 트랙과 **공유한다**. 여기서는
 *      씬의 beats만 갈아 끼운다. 성인 트랙 전용 엔딩은 없다.
 *   2) 각 확장본은 원래 씬과 **같은 지점에서 끝나야** 한다. 이어지는 prompt와
 *      선택지 3개가 그대로 성립해야 하기 때문이다.
 *   3) 미성년자가 등장하는 라운드(r3 이름 짓기 · r4 첫 매듭)는 **확장하지 않는다.**
 *      story.ts의 NEVER_ADULT가 등록 시점에 막는다.
 *   4) 모든 친밀 장면은 이연 쪽의 명시적 동의를 앞에 둔다. 원작 시즌1의
 *      "저주가 명령한다" 프레임은 이식하지 않는다(adult-track.md §3.3).
 *
 * ⚠ `gap` 비트 = 원작자 집필 슬롯. 이 파일에는 노골적 묘사가 들어 있지 않고,
 *   장면 경계와 전후 감정만 확정해 뒀다. 슬롯을 채우는 것은 숲이랑 작가
 *   검수·집필 몫이다(계약 범위 확인 완료). 화면에는 슬롯이 그대로 드러난다.
 * ═══════════════════════════════════════════════════════════════════════ */

import type { AdultBeats } from './story';

/* ── R5 · 전생 — 혼례 사흘 전 밤 ─────────────────────────────────────────
 * 원작 49화 대응. 전연령판은 그림 발견에서 시작하지만, 확장판은 그 앞의
 * 상호 고백과 첫 밤을 넣는다. 끝은 동일하다 — 잠긴 문. */
const R5: AdultBeats[string] = [
  { kind: 'narration', text: '세월이 흘렀다. 그 애는 전장에 버려졌고, 괴물이 되어 돌아왔고, 장군이 되었다.' },
  { kind: 'narration', text: '그리고 내 앞에서는 늘 웃었다. 나는 그 웃음이 연습된 것인 줄 몰랐다.' },
  { kind: 'narration', text: '혼례를 사흘 앞둔 밤이었다. 그 사람이 술을 핑계 삼아 내 방에 왔다.' },
  { kind: 'line', who: 'kihoon', text: '연아- 이제 나 키워줘...!' },
  { kind: 'inner', text: '키워 달라는 말을 저렇게 하는 사람이 세상에 또 있나.' },
  { kind: 'line', who: 'kihoon', text: '…아니다. 그거 말고.' },
  { kind: 'narration', text: '그 사람이 웃음을 거뒀다. 그런 얼굴은 십 년에 한 번 볼까 말까였다.' },
  { kind: 'line', who: 'kihoon', text: '선녀야. 나 사흘 뒤면 네 사람이 되는데.' },
  { kind: 'line', who: 'kihoon', text: '…오늘 밤은, 그냥 홍기훈으로 있어도 돼?' },
  { kind: 'inner', text: '장군도, 홍혈장아도, 대군의 개도 아닌 채로.' },
  { kind: 'narration', text: '나는 대답 대신 일어나 문고리를 걸었다.' },
  { kind: 'line', who: 'yeon', text: '제게 연모의 말은, 가벼운 정이 아닙니다.' },
  { kind: 'line', who: 'yeon', text: '어떤 시련이 닥쳐도 당신 편에 서겠다는 각오입니다.' },
  { kind: 'line', who: 'yeon', text: '혹 다시 떨어지는 날이 오더라도 늘 제 마음을 당신 곁에 두겠다는 다짐입니다.' },
  { kind: 'line', who: 'yeon', text: '앞으로 우리가 다툴 날마저 소중하고, 애틋할 만큼 당신 하나만을 바라보겠다는 고백입니다.' },
  { kind: 'line', who: 'yeon', text: '그러니… 오늘 밤부터 제 삶을 당신 곁에 두도록 허락해 주십시오.' },
  { kind: 'line', who: 'kihoon', text: '…응.' },
  { kind: 'narration', text: '그 사람의 손이 내 옷고름 위에서 멈췄다. 전장에서 열 해를 굴린 손인데 떨고 있었다.' },
  { kind: 'line', who: 'kihoon', text: '…무서우면 말해. 나 진짜 바로 멈출 수 있어. 형이 그런 건 또 잘하거든.' },
  { kind: 'inner', text: '무서운 쪽은 당신이면서.' },
  { kind: 'line', who: 'yeon', text: '…홍기훈.' },
  { kind: 'line', who: 'yeon', text: '멈추지 마.' },
  { kind: 'narration', text: '등불이 한 번 흔들렸고, 그 사람이 내 이름을 불렀다. 도련님도 선녀도 아닌, 이연이라고.' },
  {
    kind: 'gap',
    note: '혼례 사흘 전 밤 — 두 사람의 첫 밤. 이연이 먼저 청했고 기훈은 끝까지 확인을 구한다. 정사 묘사 구간.',
  },
  { kind: 'narration', text: '깨어 보니 그 사람은 내 머리카락을 만지고 있었다. 자는 줄 알았던 모양이다.' },
  { kind: 'line', who: 'kihoon', text: '…형이 좀, 오래 보고 싶어서.' },
  { kind: 'inner', text: '또 형이래. 이 와중에도.' },
  { kind: 'narration', text: '합환주를 구하러 나갔다가 어릴 적 그림 한 장을 발견했다.' },
  { kind: 'narration', text: '홍실을 묶는 그림이었다. 그 아래에 어린 내 글씨가 있었다. "묶은 직후 끊어지고 말았지만."' },
  { kind: 'line', who: 'rock', text: '…이제야 깨어났구나. 늦어서 미안하다.' },
  {
    kind: 'line',
    who: 'rock',
    text: '그 아이는 홍염인이다. 누구와도 홍실이 닿지 않은 채 태어난 아이. 홍염인은 홀로 설 때 가장 온전하다.',
  },
  {
    kind: 'line',
    who: 'rock',
    text: '억지로 실을 이으면 없던 구멍이 뚫리고, 그 틈으로 불행이 스며들어, 완성되지 못한 홍실은 결국 저주가 된다.',
  },
  { kind: 'inner', text: '사흘 뒤에 혼례를 올리기로 한 사람이었다. 그리고 나는 방금, 그 사람을 죽이고 있었다는 말을 들었다.' },
  { kind: 'narration', text: '그날 밤 자객이 들었다. 그 사람은 나를 방에 넣고 밖에서 문을 잠갔다.' },
  { kind: 'line', who: 'kihoon', text: '반나절만 그곳에 있다가 집으로 돌아가, 선녀야.' },
  { kind: 'line', who: 'kihoon', text: '…결국, 이런 방법밖에 생각 못 해서 미안해.' },
];

/* ── R6 · 현대 — 접촉이 기억을 돌려준다 ─────────────────────────────────
 * 〈홍기훈 퀘스트〉의 규칙이 곧 이 라운드의 재료다. 확장판은 그 접촉을
 * 끝까지 밀어 본다. 끝은 동일하다 — 17화의 해석 계약. */
const R6: AdultBeats[string] = [
  { kind: 'narration', text: '조각이 돌아올수록 그 사람은 자꾸 멈춰 섰다. 낯선 데서 익숙한 표정을 지었다.' },
  { kind: 'narration', text: '그날은 캠퍼스에서 만나기로 했다가 비가 와서, 결국 내 집으로 왔다.' },
  { kind: 'line', who: 'kihoon', text: '와 검사님 집 진짜— 아 이거 두 번째네. 저 지난번에도 왔었죠? 아닌가?' },
  { kind: 'inner', text: '왔었지. 손목이 묶인 채로.' },
  { kind: 'line', who: 'kihoon', text: '…이연 씨. 저 이상한 부탁 하나 해도 돼요?' },
  { kind: 'line', who: 'kihoon', text: '손 좀 잡아 봐도 돼요? 아니 그— 이연 씨 손 잡으면 자꾸 뭐가 떠올라서.' },
  { kind: 'line', who: 'yeon', text: '…잡아요.' },
  { kind: 'narration', text: '손목에서 팔로, 팔에서 어깨로. 닿는 자리마다 조각이 하나씩 돌아왔다.' },
  { kind: 'narration', text: '그 사람의 숨이 점점 짧아졌다. 기억이 밀려드는 건지, 다른 이유인지 나는 알 수 없었다.' },
  { kind: 'line', who: 'kihoon', text: '…이거 왜 이래요. 왜 자꾸 아는 것 같지.' },
  { kind: 'line', who: 'kihoon', text: '이연 씨 얼굴을, 내가 어디서— 아, 씨.' },
  { kind: 'narration', text: '그 사람이 내 손을 붙든 채로 이마를 내 어깨에 묻었다. 7년 만에 처음 닿는 무게였다.' },
  { kind: 'line', who: 'yeon', text: '…계속해도 돼요?' },
  { kind: 'line', who: 'kihoon', text: '…네. 계속해요.' },
  { kind: 'inner', text: '이 사람은 자기가 뭘 허락하는지도 모르면서 늘 이렇게 대답한다. 두 번의 생 내내.' },
  {
    kind: 'gap',
    note: '현대 — 접촉이 기억을 부르는 밤. 닿을수록 기훈이 무너지고, 이연은 매번 확인을 구한다. 정사 묘사 구간.',
  },
  { kind: 'narration', text: '끝나고 나서 그 사람은 천장을 오래 보고 있었다. 돌아온 조각을 세는 얼굴이었다.' },
  { kind: 'line', who: 'kihoon', text: '검사님. 아니 이연 씨. 저 부탁 하나만 더 해도 돼요?' },
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
  {
    kind: 'line',
    who: 'rock',
    text: '이번엔 페널티가 없어요. 대신 이건 두 번째 기회거든요. 지난 생에 놓친 걸, 이번엔 놓치지 마세요.',
  },
  { kind: 'inner', text: '두 번 살고도 이 사람은 똑같은 부탁을 한다. 그리고 나는 두 번 다 그걸 못 알아차렸다.' },
];

/* ── R7 · 현대 — 검은 돌, 그리고 그 뒤 ──────────────────────────────────
 * 54화의 문답은 그대로 두고, 포장마차를 나온 뒤를 잇는다.
 * 끝은 동일하다 — "정말, 그게 이유였어?" */
const R7: AdultBeats[string] = [
  { kind: 'narration', text: '나에게 남은 질문은 하나였다. 무슨 생각으로 내 부탁을 들어줬을까.' },
  { kind: 'narration', text: '7년 전, 잊어달라고 했을 때 그 사람은 한 번도 되묻지 않았다.' },
  { kind: 'inner', text: '직접은 못 묻겠어서, 나는 그걸 남의 이야기로 위장했다.' },
  { kind: 'line', who: 'yeon', text: '저, 사건 하나만 여쭤볼게요. 검은 돌 하나가 있었어요.' },
  {
    kind: 'line',
    who: 'yeon',
    text: '선수님이 그 돌을 되게 아꼈는데, 그 돌이 신발 속에 콕 들어가서 걷지도, 뛰지도 못하게 계속 아프게 하는 거예요.',
  },
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
  { kind: 'line', who: 'kihoon', text: "'이제 안 아파! 다시 들어와!' 하고 검은 돌을 다시 좋아하면 되잖아요!" },
  { kind: 'narration', text: '나는 잔을 내려놓고 자리에서 일어났다. 그 사람이 따라 나왔다.' },
  { kind: 'line', who: 'kihoon', text: '어? 어디 가요? 계산은 형이— 아 또 형이래.' },
  { kind: 'line', who: 'yeon', text: '…우리 집이요.' },
  { kind: 'narration', text: '그 사람이 세 걸음쯤 뒤에서 멈춰 섰다. 그리고 아주 조용히 물었다.' },
  { kind: 'line', who: 'kihoon', text: '…그거, 제가 생각하는 그 뜻 맞아요?' },
  { kind: 'line', who: 'yeon', text: '맞아요. 싫으면 지금 말해요.' },
  { kind: 'line', who: 'kihoon', text: '싫을 리가 없잖아요.' },
  { kind: 'narration', text: '현관에서 신발도 못 벗고 붙들렸다. 7년을 멀리서만 본 사람의 손이 내 뒷목에 닿았다.' },
  { kind: 'inner', text: '강철 발이라니. 초등학생도 아니고. 그런 소리를 해 놓고 이런 얼굴을 한다.' },
  {
    kind: 'gap',
    note: '현대 — 재회 후 첫 밤. 이연이 먼저 청했고 기훈은 뜻을 되묻는다. 정사 묘사 구간.',
  },
  { kind: 'narration', text: '새벽에 그 사람은 내 손목의 실 자국을 한참 들여다봤다. 자기 눈에는 보이지도 않는 자리였다.' },
  { kind: 'line', who: 'kihoon', text: '여기 뭐 있어요? 아까부터 자꾸 만지길래.' },
  { kind: 'inner', text: '아, 단순해. 사람이 어떻게 이렇게 단순하지. …정말, 그게 이유였어?' },
];

export const ADULT_BEATS: AdultBeats = { r5: R5, r6: R6, r7: R7 };

/** 확장본이 있는 라운드 — 게이트 화면이 미리 알려 주는 데 쓴다. */
export const ADULT_SCENE_IDS = Object.keys(ADULT_BEATS);

/** 원작자 집필 슬롯 수. 검토 화면에 그대로 노출한다. */
export const ADULT_GAP_COUNT = Object.values(ADULT_BEATS)
  .flat()
  .filter((beat) => beat.kind === 'gap').length;
