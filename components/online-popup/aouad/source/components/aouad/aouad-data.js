import { ZONE_HOOK, ZONE_CALL, OPENING_CALL } from "./aouad-copy";
// ── 지금 우리 학교는 1.5 — 팝업 시연 데이터 ──────────────────────────────
// 세계관 = 효산고 생존자 모임 / Season 1.5 Bridge
// 팝업 허브(Z1~Z6) · 수색 존 · 게임 보상(구매권) · 딜(래플·선착순·쿠지·사전예약) · 굿즈 마스터(MD 37종)

export const THEME = {
  ip: "aouad",
  title: "지금 우리 학교는 1.5",
  subtitle: "SURVIVE THE NIGHT — 살아 있다면, 옥상으로",
  period: "SEASON 1.5 BRIDGE",
  accent: "#ff8a3d",
  danger: "#e11d48",
  safe: "#22c55e",
};

// ticket = 유상 존의 참여권 1장 가격 — 카드가 「참여권 n원」으로 보여 준다(PM 2026-09-03). 없으면 무상.
/* hook(히어로 초대문 줄 배열) · call(허브 문 한 줄)은 `aouad-copy.js` 에서 붙는다 — 문안은 거기서만 고친다(SOP_popup-copy-voice) */
const ZONE_ROWS = [
  { id: "cafeteria", name: "급식실", code: "Z1", role: "유리문이 뚫리기 전에 탈출한다", icon: "🥫", grant: "점수별 구매권 4단 — 유리컵 · 생존 키트 · 구급 파우치 · 카라비너", img: "still-cafeteria-glass.jpg" },
  { id: "broadcast", name: "방송실", code: "Z2", role: "소화전 호스를 타고 창문 열 개를 지난다", icon: "📻", grant: "무전기 키링 「다방」 페어", img: "still-broadcast-room.jpg" },
  { id: "rooftop", name: "옥상", code: "Z6", role: "옥상 탐방 · 결말 · 시즌2로 가는 문", icon: "🔥", grant: "학생증 각인판 · 모닥불 오르골", img: "still-bonfire.jpg" },  /* 체험존 4번째 = 결말(PM 2026-09-02 A안) · 게임 동사는 P2 3안 비교 후 */
  { id: "library", name: "도서관", code: "Z3", role: "책장 사이로 도망친다", icon: "📚", grant: "생존자 포토카드 팩", img: "still-library.jpg" },
  { id: "reserve", name: "현장 예약", code: "Z11", role: "30분 단위 시간대", icon: "🎟️", grant: "생존자 인증으로 입장", img: "key-yearbook-blood.jpg" },
  { id: "raffle", name: "래플", code: "Z8", role: "무상 응모 · 정시 발표", icon: "🎫", grant: "회차별 응모 상품 — 정시 발표", img: "still-zombie-rush.jpg" },
  { id: "preorder", name: "사전예약", code: "Z9", role: "시즌2 연계", icon: "📦", grant: "예약 특전 — 각인·선배송", img: "still-armed-group-walk.jpg" },
  { id: "fcfs", name: "선착순", code: "Z10", role: "정시 오픈 · 수량 한정", icon: "⏱️", grant: "매대별 한정 수량", img: "still-infirmary.jpg" },
  { id: "kuji", name: "럭키드로우", code: "Z7", role: "확정 구성 뽑기", icon: "🎯", grant: "회차별 확정 구성 — 잔여 실측", img: "still-barricade.jpg" },
  { id: "store", name: "굿즈샵", code: "Z5", role: "한정판 공식 MD · 구매권 상품", icon: "🛍️", grant: "구매권 상품 8종 · 상시 판매 21종", img: "still-gym-group.jpg" },
];
export const ZONES = ZONE_ROWS.map((z) => ({ ...z, hook: ZONE_HOOK[z.id], call: ZONE_CALL[z.id] }));

export const TYPES = {
  vanguard: { name: "망설임 없는 돌격", desc: "가장 먼저 문을 여는 사람 — 위험을 먼저 마주해 길을 뚫는다" },
  strategist: { name: "침착한 전략가", desc: "길을 그리는 사람 — 모두의 다음 걸음이 당신에게서 나온다" },
  shield: { name: "든든한 방패", desc: "앞을 막아서는 사람 — 뒤에 선 친구들이 당신을 믿는다" },
  connector: { name: "연결하는 사람", desc: "신호를 잇는 사람 — 목소리가 닿는 한 아무도 혼자가 아니다" },
  recorder: { name: "기록하는 사람", desc: "남기는 사람 — 당신 덕에 그날이 잊히지 않는다" },
};

// ── Z5 굿즈샵·딜 — MD 37종 기획 (기획 = 이 레포 · 품목·가격·수량 확정 = 개발 트랙 · 가격은 가안)
// 소재 근거 = G 굿즈 소재 카탈로그 & 원작 소품 카탈로그. 정식 MD 렌더 목업 적용(md-*.jpg)
// lanes: raffle 래플(무상 응모·정시 발표) · fcfs 선착순(한정 수량·1인 한도) · kuji 럭키드로우(등급·잔여 공시) · pre 사전예약(시즌2 연계 특전) · shop 상시 진열
export const LANE_LABEL = { right: "구매권", raffle: "래플", fcfs: "선착순", kuji: "럭키드로우", pre: "사전예약", shop: "상시" };
export const MD = [
  { id: "ribbon_keyring", name: "효산고 교복 리본 타이 참 키링", cat: "수집", price: 12000, lanes: ["shop", "fcfs", "kuji"], src: "md-ribbon-keyring.jpg", note: "효산고 여학생 교복 시그니처 사선 스트라이프 리본 원단 + 골드 엠블럼 메달 참 + 황동 카라비너 키링" },
  { id: "uniform_female", name: "효산고 공식 교복 세트 (여)", cat: "의류", price: 98000, lanes: ["pre", "raffle"], src: "md-uniform-female.jpg", note: "딥그린 V넥 단추 가디건 + 셔츠 + 사선 스트라이프 리본 + 타탄 체크 스커트 + 붉은 명찰" },
  { id: "uniform_male", name: "효산고 공식 교복 세트 (남)", cat: "의류", price: 95000, lanes: ["pre"], src: "md-uniform-male.jpg", note: "딥그린 V넥 니트 조끼 + 셔츠 + 사선 스트라이프 넥타이 + 타탄 체크 슬랙스 + 붉은 명찰" },
  { id: "archery_tracksuit", name: "효산고 양궁부 공식 트레이닝 세트", cat: "의류", price: 79000, lanes: ["pre", "fcfs"], src: "md-archery-tracksuit.jpg", note: "장하리 유니폼 화이트 집업 + 우측 어깨 네이비 사선 패널(REVOLUTION) + 골드 엠블럼 + 팬츠" },
  { id: "zipup_namra", name: "반장 최남라 '면벽' 오버핏 니트 집업", cat: "의류", price: 89000, lanes: ["shop", "pre"], src: "md-zipup-namra.jpg", note: "남라의 차분한 네이비 립조직 집업 니트 + 소매 끝 미세한 절비(반좀비) 심박수 자수 + 금속 명찰 태그" },
  { id: "windbreaker_cheongsan", name: "청산치킨(Cheongsan Chicken) 레트로 윈드브레이커", cat: "의류", price: 79000, lanes: ["pre", "fcfs"], src: "md-windbreaker-cheongsan.jpg", note: "90s 바시티/윈드브레이커 배색(아이보리+딥그린), 가슴 빈티지 치킨 엠블럼 패치, 안감 효산동 배달지도 인쇄" },
  { id: "sleeveless_gwinam", name: "귀남(Gwi-nam) 피트니스 슬리브리스 & 오버셔츠 세트", cat: "의류", price: 68000, lanes: ["shop", "fcfs"], src: "md-sleeveless-gwinam.jpg", note: "디스트로이드 워싱 오버사이즈 체크 셔츠 + 헤비코튼 블랙 머슬핏 나시 세트" },
  { id: "hoodie_broadcast", name: "효산고 방송부 헤비웨이트 후디 (On-Air Ver.)", cat: "의류", price: 65000, lanes: ["shop", "fcfs"], src: "md-hoodie-broadcast.jpg", note: "650g 헤비 쮸리 코튼, 후드 끈 3.5mm 오디오 잭 모티프 메탈 팁, HYOSAN BROADCASTING SYSTEM 자수" },
  { id: "zipup", name: "효산고 체육복 집업 — 시즌2 기다림 에디션", cat: "의류", price: 69000, lanes: ["shop", "pre"], src: "md-zipup.jpg", note: "사전예약 특전: 등번호·이름 각인" },
  { id: "virus_journal", name: "이병찬 실험노트 & 시약병 만년필", cat: "문구", price: 32000, lanes: ["fcfs", "kuji"], first: "libJournal", src: "md-virus-journal.jpg", note: "붉은 바이러스 잉크 시약병(30ml) + 만년필 + 바이러스 스케치 인쇄 양장 다이어리" },
  { id: "binder_attendance", name: "효산고 2-5반 출석부 & 분실물 보관 바인더", cat: "문구", price: 25000, lanes: ["shop", "fcfs"], src: "md-binder-attendance.jpg", note: "하드커버 6공 링바인더, 2-5반 전원 증명사진 프로필 시트 + 메모지 80매 리필" },
  { id: "deskmat_map", name: "생존 작전도 효산시 지도 데스크 장패드", cat: "문구", price: 22000, lanes: ["shop", "fcfs"], first: "libDeskmat", src: "md-deskmat-map-v2.webp", note: "800×300mm 방수 패브릭, 격리구역·폭격 지점·효산고 위치 표기 작전 브리핑 맵" },
  { id: "cabinet_penholder", name: "효산고 칠판 마그넷 & 2-5반 캐비닛 펜꽂이", cat: "문구", price: 19000, lanes: ["shop", "kuji"], src: "md-cabinet-penholder-v2.webp", note: "미니 철제 사물함 수납함(실제 문 열림) + 분필 SOS 메시지 마그넷 4종 세트" },
  { id: "maskingtape_set", name: "효산 바이러스 위험 경고 마스킹 테이프 3종 세트", cat: "문구", price: 9500, lanes: ["shop", "kuji"], src: "md-maskingtape-set-v2.webp", note: "30mm 와이드 마테 — 격리 경고 · 출입 제한 · 2-5반 생존 메모" },
  { id: "archery", name: "양궁부 화살 북마크 + 연필 세트", cat: "문구", price: 9000, lanes: ["shop", "fcfs"], first: "libBookmarkSet", src: "md-archery.jpg", note: "화살 모양 북마크 2 + 연필 3" },
  { id: "postcard", name: "엽서 세트 「아직 남아 있다면, 옥상으로」", cat: "문구", price: 7000, lanes: ["shop", "kuji", "fcfs"], src: "md-postcard.jpg", note: "깨어남의 말 3줄 + 생존 수칙 7 — 엽서 10장" },
  { id: "firstaid_pouch", name: "효산 응급의무실 구급 파우치 & 블랭킷 팩", cat: "생존 키트", price: 28000, lanes: ["right", "shop", "fcfs"], right: "cafeFirstaid", src: "md-firstaid-pouch.jpg", note: "코듀라 방수 원단, 십자가 적십자 벨크로 패치, 밴딩 오거나이저 + 비상 보온 은박 블랭킷 동봉" },
  { id: "tactical_flashlight", name: "효산고 야간 탈출 미니 고광량 텍티컬 플래시", cat: "생존 키트", price: 24000, lanes: ["shop", "kuji"], src: "md-tactical-flashlight-v2.webp", note: "아노다이징 알루미늄 바디, USB-C 충전식, 효산고 자산 번호 레이저 각인 + 적색 SOS 점멸 모드" },
  { id: "kit", name: "생존 키트 파우치", cat: "생존 키트", price: 22000, lanes: ["right", "shop", "fcfs"], right: "cafeKit", src: "md-kit.jpg", note: "테이프·붕대·호루라기 모티프 프린트, 실사용 파우치" },
  { id: "carabiner_multitool", name: "생존자 카라비너 멀티툴 & 휘슬 키홀더", cat: "생존 키트", price: 18000, lanes: ["right"], right: "cafeCarabiner", src: "md-carabiner-multitool.jpg", note: "티타늄 코팅 스테인리스 스틸, 120dB 고주파 생존 휘슬 + 바리케이드 해체용 육각 렌치/오프너 일체형" },
  { id: "radio", name: "무전기 키링 「다방」 페어", cat: "생존 키트", price: 16000, lanes: ["shop", "fcfs", "raffle"], right: "radioPair", src: "md-radio.jpg", note: "2개 1세트 — 채널 다이얼이 돌아간다. 하나는 내가, 하나는 친구가" },
  { id: "musicbox_bonfire", name: "옥상 모닥불 사운드 오르골 (The Campfire)", cat: "수집", price: 45000, lanes: ["right", "pre"], right: "bonfireOrgel", src: "md-musicbox-bonfire.jpg", note: "우드 베이스 + 모닥불 금속 다이캐스트 조각, 태엽 구동 메인 테마 멜로디 재생" },
  { id: "virus_paperweight", name: "이병찬 바이러스 결정(Jonas Virus) 아크릴 문진", cat: "수집", price: 42000, lanes: ["raffle", "shop"], src: "md-virus-paperweight.jpg", note: "70mm 구형 고투명 레진 문진, 내부 3D 레이저 바이러스 RNA 구조 입체 캡슐화" },
  { id: "earphone_namra", name: "최남라 유선 노이즈 캔슬링 이어폰 & 전용 틴케이스", cat: "수집", price: 39000, lanes: ["kuji", "fcfs"], src: "md-earphone-namra.jpg", note: "꼬임 방지 패브릭 케이블 유선 이어폰 + 남라 자필 낙서 문구 각인 메탈 틴케이스" },
  { id: "archery_cardwallet", name: "장하리 양궁부 핑거탭 & 가죽 카드지갑", cat: "수집", price: 34000, lanes: ["shop"], src: "md-archery-cardwallet.jpg", note: "양궁 선수용 핑거탭 구조의 카드 슬롯, 베지터블 천연 소가죽, 불스아이(10점) 불박 각인" },
  { id: "lenticular_block", name: "2-5반 단체사진 아크릴 블록 (Rain & Firelight)", cat: "수집", price: 32000, lanes: ["kuji", "fcfs"], src: "md-lenticular-block.jpg", note: "20mm 크리스탈 아크릴, 교실 일상 ↔ 옥상 모닥불 교차 렌티큘러 연출" },
  { id: "candle", name: "모닥불 캔들 — 옥상의 밤", cat: "수집", price: 24000, lanes: ["shop", "kuji", "fcfs", "raffle"], src: "md-candle.jpg", note: "장작·연기 노트, 틴 케이스. 시그니처 소품" },
  { id: "barricade_stand", name: "책상 바리케이드 디오라마 폰스탠드", cat: "수집", price: 21000, lanes: ["shop", "fcfs"], src: "md-barricade-stand.jpg", note: "2-5 교실 책상 바리케이드 입체 아크릴 디오라마 거치대 (스마트폰 거치)" },
  { id: "dogtag_survivor", name: "효산 격리수용소 생존자 인식표(Dog Tag) 목걸이", cat: "수집", price: 21000, lanes: ["shop", "fcfs"], src: "md-dogtag-survivor-v2.webp", note: "더블 인식표에 HYOSAN SURVIVOR 2-5와 옥상으로 돌아오라는 메시지를 담은 디자인" },
  { id: "idcard", name: "효산고 학생증 — DIY 나만의 생존자 커스텀 에디션", cat: "수집", price: 18000, lanes: ["right", "pre"], right: "idEngraved", src: "md-idcard-v2.webp", note: "내 사진과 이름으로 완성하는 학생증 시안 — 딥그린 랜야드·투명 케이스·효산고 스티커 세트" },
  { id: "strap_suhyeok", name: "이수혁(맨수) 복싱 핸드랩 스타일 스트랩 키링", cat: "수집", price: 16000, lanes: ["shop", "kuji"], src: "md-strap-suhyeok-v2.webp", note: "4cm 광폭 헤비 웨빙 스트랩에 HYOSAN BARE-KNUCKLE 자수 + 복싱 글러브 미니 메탈 참" },
  { id: "hamster_keyring", name: "과학실 '햄찌' 봉제 인형 키링", cat: "수집", price: 14000, lanes: ["shop", "kuji"], src: "md-hamster-keyring.jpg", note: "스릴러 IP 유일의 귀여움 소재, 푹신한 극세사 폼 햄스터 키링" },
  { id: "badge", name: "2학년 5반 명찰 뱃지 세트", cat: "수집", price: 8000, lanes: ["shop", "kuji"], src: "md-badge.jpg", note: "랜덤 2종 — 반 번호만, 이름 없음" },
  { id: "photo", name: "생존자 포토카드 팩", cat: "수집", price: 6000, lanes: ["shop", "fcfs", "kuji"], right: "libPhoto", src: "md-photo-v2.webp", note: "패키지·뒷면 디자인 시안 · 3매 구성" },
  { id: "blanket", name: "옥상 S.O.S 블랭킷", cat: "생활", price: 39000, lanes: ["shop", "kuji"], src: "md-blanket.jpg", note: "커튼에 쓴 S.O.S 문법의 담요 — 옥상 엔딩" },
  { id: "lighter_eunji", name: "은지 모티프 레트로 방풍 오일 라이터", cat: "생활", price: 35000, lanes: ["kuji", "fcfs"], src: "md-lighter-eunji.jpg", note: "빈티지 브러시드 브라스(황동) 바디, 효산고 교표 레이저 각인 + 그을음 웨더링 마감" },
  { id: "glass_canteen", name: "효산 매점 레트로 유리컵 & 코스터 세트", cat: "생활", price: 16000, lanes: ["right", "shop", "kuji"], right: "cafeCanteen", src: "md-glass-canteen-v2.webp", note: "효산고 문양을 담은 330ml 유리컵 + 빈티지 코르크 코스터" },
];

/* ── 상품 상세 입고 데이터 ──
   계약 = `ICONS-굿즈-상품상세-화면기획-v0-2026-08-27` §9 입고 계약.
   목록(MD)과 분리해 둔다 — 실제 시스템에서도 목록 응답과 상세 응답이 다르다.
   supply 는 비워둘 수 없다(정책 P13 — 재공급 표기는 판매 시점 의무).
   odds 는 구성이 랜덤인 상품에서만, 그 경우 필수(공시 = 추첨의 단일 소스).
   값은 전부 시연 설정이며 실제 발주 사양이 아니다. */
export const SUPPLY_NOTE = {
  "없음": "이 상품은 다시 만들지 않습니다",
  "재입고 가능": "품절 시 재입고될 수 있습니다",
  "재판 가능": "발매 1년 경과 후 재생산될 수 있습니다",
};
export const SHIPPING = "모아 배송 — 보관함에 모았다가 묶음 발송";
export const WITHDRAWAL_STATE = "확정 전";
export const WITHDRAWAL = "취소·반품 조건이 확정되면 이 자리에 실제 판매 조건과 같은 문안이 들어갑니다.";

export const MD_DETAIL = {
  ribbon_keyring: {
    parts: ["리본 타이 참 1", "골드 엠블럼 메달 1", "황동 카라비너 키링 1"],
    spec: [["소재", "폴리 리본 · 아연합금 도금"], ["크기", "참 42mm · 전체 95mm"], ["중량", "28g"]],
    stock: 480, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 128,
    origin: { still: "still-schoolyard.jpg", line: "교복을 입은 두 학생의 모습에서 이어지는 효산고 리본 디자인." }
  },
  uniform_female: {
    parts: ["딥그린 V넥 단추 가디건", "셔츠", "사선 스트라이프 리본", "타탄 체크 스커트", "붉은 명찰"],
    spec: [["소재", "아크릴 혼방 · 면 100%"], ["구성", "5점"], ["명찰", "자수 · 반 번호만"]],
    options: { name: "사이즈", values: ["S", "M", "L", "XL"] },
    stock: 220, supply: "재입고 가능", card: true, proofs: 341,
    origin: { still: "still-armed-group-walk.jpg", line: "초록색 교복과 체크 패턴을 바탕으로 구상한 의상 디자인." }
  },
  uniform_male: {
    parts: ["딥그린 V넥 니트 조끼", "셔츠", "사선 스트라이프 넥타이", "타탄 체크 슬랙스", "붉은 명찰"],
    spec: [["소재", "아크릴 혼방 · 면 100%"], ["구성", "5점"], ["명찰", "자수 · 반 번호만"]],
    options: { name: "사이즈", values: ["S", "M", "L", "XL"] },
    stock: 180, supply: "재입고 가능", card: true, proofs: 205,
    origin: { still: "still-armed-group-walk.jpg", line: "초록색 조끼와 체크 패턴을 바탕으로 구상한 의상 디자인." }
  },
  archery_tracksuit: {
    parts: ["화이트 집업 재킷", "팬츠", "골드 엠블럼 와펜"],
    spec: [["소재", "폴리 트리코트"], ["디테일", "우측 어깨 네이비 사선 패널 · REVOLUTION 자수"], ["구성", "2점 + 와펜"]],
    options: { name: "사이즈", values: ["S", "M", "L", "XL"] },
    stock: 140, limit: "1인 1개", per: 1, supply: "재입고 가능", proofs: 96,
    origin: { still: "still-gym-group.jpg", line: "체육관에 모인 생존자들의 장면과 연결한 양궁부 의상 디자인." }
  },
  zipup_namra: {
    parts: ["네이비 립조직 집업 니트 1", "탈부착 금속 명찰 1"],
    spec: [["소재", "울 30% · 프리미엄 아크릴 70%"], ["디테일", "소매 끝 심박수 자수 · YKK 2-Way 지퍼"], ["핏", "오버핏 드롭숄더"]],
    options: { name: "사이즈", values: ["FREE (100~105)", "OVER (105~110)"] },
    stock: 150, limit: "1인 1개", per: 1, supply: "재입고 가능", card: true, proofs: 215,
    origin: { still: "still-jeolbi-closeup.jpg", line: "남라의 차분한 분위기에서 출발한 니트 디자인." },
  },
  windbreaker_cheongsan: {
    parts: ["레트로 윈드브레이커 1", "청산치킨 배달 스티커 3종"],
    spec: [["소재", "방수 립스탑 나일론 · 메시 안감"], ["디테일", "가슴 치킨 엠블럼 패치 · 안감 효산시 지도"]],
    options: { name: "사이즈", values: ["M", "L", "XL"] },
    stock: 120, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 184,
    origin: { still: "still-corridor-run.jpg", line: "복도를 달리는 청산의 장면에서 이어지는 윈드브레이커 디자인." }
  },
  sleeveless_gwinam: {
    parts: ["디스트로이드 체크 셔츠 1", "블랙 머슬핏 슬리브리스 1"],
    spec: [["소재", "코튼 플란넬 · 코튼 스판"], ["디테일", "데미지 워싱 · 체인 장식 고리"]],
    options: { name: "사이즈", values: ["M", "L", "XL"] },
    stock: 80, limit: "1인 1개", per: 1, supply: "없음", edition: "절비 한정 에디션", proofs: 310,
    origin: { still: "still-classroom-outbreak.jpg", line: "학교를 뒤덮은 감염 사태의 거친 분위기를 담은 의상 디자인." }
  },
  hoodie_broadcast: {
    parts: ["헤비웨이트 후디 1", "3.5mm 메탈 오디오 잭 팁 2"],
    spec: [["소재", "650g 헤비 프렌치 테리 코튼 100%"], ["자수", "HYOSAN BROADCASTING SYSTEM 은사 자수"]],
    options: { name: "사이즈", values: ["M", "L", "XL", "2XL"] },
    stock: 250, supply: "재입고 가능", proofs: 142,
    origin: { still: "still-broadcast-room.jpg", line: "방송 장비가 놓인 방에서 함께 버티는 장면을 모티프로 한 후디." }
  },
  virus_journal: {
    parts: ["양장 다이어리 1", "시약병 만년필 1", "붉은 잉크 30ml"],
    spec: [["소재", "양장 하드커버 · 유리 시약병"], ["규격", "A5 · 192p"], ["잉크", "수성 · 리필 가능"]],
    stock: 90, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 74,
    origin: { still: "still-zombie-rush.jpg", line: "감염 사태가 덮친 효산고의 이야기를 확장한 연구노트 디자인." },
  },
  binder_attendance: {
    parts: ["6공 하드커버 링바인더 1", "2-5반 프로필 시트 20매", "줄메모지 80매"],
    spec: [["소재", "친환경 싸바리 보드 · 스틸 링"], ["규격", "A5 규격 · 6공"], ["구성", "학생 증명사진 인덱스"]],
    stock: 350, supply: "재판 가능", proofs: 198,
    origin: { still: "still-armed-group-walk.jpg", line: "함께 움직이는 학생들의 기록을 남기는 출석부 디자인." }
  },
  deskmat_map: {
    parts: ["게이밍 장패드 1", "수납 파우치 1"],
    spec: [["소재", "고밀도 방수 패브릭 · 천연고무 바닥"], ["크기", "800 × 300 × 4mm"], ["인쇄", "초고해상도 오버로크 엣지"]],
    stock: 400, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 276,
    origin: { still: "still-zombie-rush.jpg", line: "학교를 빠져나가려는 생존 여정에서 출발한 지도 디자인." }
  },
  cabinet_penholder: {
    parts: ["철제 캐비닛 오거나이저 1", "SOS 분필 마그넷 4개"],
    spec: [["소재", "스틸 분체도장 · 네오디뮴 자석"], ["크기", "폭 75 × 깊이 75 × 높이 210mm"], ["기능", "여닫이 문 · 내부 2단 선반"]],
    stock: 300, supply: "재판 가능", proofs: 89,
    origin: { still: "still-barricade.jpg", line: "책상과 의자로 교실을 지키는 장면에서 이어지는 학교 소품 디자인." }
  },
  maskingtape_set: {
    parts: ["마스킹 테이프 3롤"],
    spec: [["소재", "일본산 화지(Washi)"], ["규격", "폭 30mm × 길이 10m"], ["도안", "격리 경고 / 출입 제한 / 생존 메모"]],
    stock: 800, supply: "재판 가능", proofs: 312,
    origin: { still: "still-corridor-run.jpg", line: "복도를 가로지르는 탈출 장면의 긴장감을 담은 경고 테이프 디자인." }
  },
  hamster_keyring: {
    parts: ["햄스터 봉제 키링 1"],
    spec: [["소재", "극세사 폼"], ["크기", "70mm"], ["중량", "22g"]],
    stock: 620, supply: "재판 가능", proofs: 512,
    origin: { still: "still-zombie-rush.jpg", line: "효산고의 감염 이야기에서 소재를 가져온 햄스터 키링 디자인." }
  },
  barricade_stand: {
    parts: ["아크릴 디오라마 5레이어", "받침 1"],
    spec: [["소재", "3mm 아크릴 UV 인쇄"], ["크기", "폭 120 × 높이 95mm"], ["거치", "스마트폰 가로 · 세로"]],
    stock: 260, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 158,
    origin: { still: "still-barricade.jpg", line: "학생들이 책상과 의자로 쌓은 바리케이드를 모티프로 한 거치대." },
  },
  idcard: {
    parts: ["개인화 학생증 카드 1", "딥그린 랜야드 1", "아크릴 케이스 1", "스티커 시트 3 · 이름 스티커 1"],
    spec: [["규격", "86 × 54mm · PVC"], ["개인화", "사진 3 × 4cm · 이름"], ["시안", "빈 성명란 · 증명사진 자리표시자"]],
    stock: 300, supply: "없음", edition: "시즌1 한정", card: true, proofs: 689,
    origin: { still: "still-schoolyard.jpg", line: "효산고 학생이 된 나를 상상하는 학생증 디자인. 빈 성명란과 증명사진 자리표시자는 내 사진과 이름을 넣을 공간이다." },
  },
  radio: {
    parts: ["무전기 키링 2 (1세트)"],
    spec: [["소재", "ABS · 금속 다이얼"], ["크기", "각 58mm"], ["작동", "채널 다이얼 회전 · 통신 기능 없음"]],
    stock: 340, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 421,
    origin: { still: "still-broadcast-room.jpg", line: "방송 장비가 보이는 방에서 소식을 기다리는 장면과 연결한 키링." }
  },
  firstaid_pouch: {
    parts: ["택티컬 구급 파우치 1", "비상 은박 보온 블랭킷 1", "벨크로 적십자 패치 1"],
    spec: [["소재", "1000D 코듀라 방수 나일론"], ["크기", "180 × 130 × 60mm"], ["수납", "내부 탄력 밴딩 8구"]],
    stock: 280, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 165,
    origin: { still: "still-corridor-run.jpg", line: "위험을 피해 함께 달리는 생존 장면에서 출발한 구급 파우치." }
  },
  tactical_flashlight: {
    parts: ["미니 택티컬 플래시 1", "레드 SOS 렌즈 필터 1", "USB-C 충전 케이블 1"],
    spec: [["밝기", "최대 800 루멘 · 3단계"], ["소재", "항공 알루미늄 아노다이징"], ["배터리", "1100mAh 내장 리튬이온"]],
    stock: 220, limit: "1인 1개", per: 1, supply: "재입고 가능", proofs: 204,
    origin: { still: "still-barricade.jpg", line: "교실을 지키며 출구를 찾는 생존 장면을 모티프로 한 손전등." }
  },
  kit: {
    parts: ["생존 파우치 1", "방수 밴드 10매", "알코올 스왑 6매", "비상 호루라기 1"],
    spec: [["소재", "타포린 방수 원단"], ["크기", "150 × 110mm"], ["중량", "110g"]],
    stock: 300, limit: "1인 1개", per: 1, supply: "재입고 가능", proofs: 240,
    origin: { still: "still-barricade.jpg", line: "주변의 물건을 모아 교실을 지키는 장면에서 출발한 생존 키트." },
  },
  carabiner_multitool: {
    parts: ["티타늄 멀티툴 카라비너 1", "스틸 키링 3"],
    spec: [["소재", "티타늄 코팅 420 스테인리스"], ["기능", "120dB 호루라기 · 육각렌치 4종 · 오프너"], ["중량", "45g"]],
    stock: 500, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 188,
    origin: { still: "still-barricade.jpg", line: "책상과 의자로 길을 막고 버티는 장면과 연결한 멀티툴 디자인." }
  },
  musicbox_bonfire: {
    parts: ["원목 오르골 본체 1", "모닥불 다이캐스트 조각 1", "전용 선물 패키지 1"],
    spec: [["소재", "북미산 월넛 원목 · 황동 무브먼트"], ["크기", "폭 110 × 깊이 90 × 높이 130mm"], ["음원", "18노트 핸드크랭크 '옥상의 불씨'"]],
    stock: 100, limit: "1인 1개", per: 1, supply: "없음", edition: "옥상 생존자 한정", proofs: 420,
    origin: { still: "still-bonfire.jpg", line: "옥상의 모닥불 앞에서 함께 머무는 순간을 담은 오르골 디자인." },
  },
  virus_paperweight: {
    parts: ["구형 크리스탈 문진 1", "블랙 슬레이트 받침 1"],
    spec: [["소재", "고투명 옵티컬 레진 · 천연 슬레이트"], ["크기", "지름 70mm"], ["중량", "420g"]],
    stock: 80, limit: "1인 1개", per: 1, supply: "없음", edition: "과학실 연구소 에디션", proofs: 512,
    origin: { still: "still-zombie-rush.jpg", line: "효산고를 뒤덮은 감염 사태를 모티프로 한 바이러스 문진 디자인." }
  },
  earphone_namra: {
    parts: ["패브릭 유선 이어폰 1", "각인 틴케이스 1", "실리콘 폼팁 3쌍"],
    spec: [["드라이버", "10mm 다이내믹 드라이버"], ["케이블", "1.2m 패브릭 꼬임 방지 (3.5mm 금도금)"], ["케이스", "알루미늄 틴"]],
    stock: 160, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 330,
    origin: { still: "still-jeolbi-closeup.jpg", line: "남라의 인물 분위기에서 출발한 이어폰과 틴케이스 디자인." }
  },
  archery_cardwallet: {
    parts: ["양궁 핑거탭 카드지갑 1", "황동 카라비너 스트랩 1"],
    spec: [["소재", "이태리 베지터블 천연 소가죽"], ["수납", "카드 포켓 3 · 지폐 포켓 1"], ["각인", "양궁부 10점 불스아이 불박"]],
    stock: 140, limit: "1인 1개", per: 1, supply: "재입고 가능", proofs: 175,
    origin: { still: "still-gym-group.jpg", line: "체육관 생존 장면과 양궁부를 모티프로 한 카드지갑 디자인." }
  },
  lenticular_block: {
    parts: ["렌티큘러 아크릴 블록 1"],
    spec: [["소재", "20mm 광학용 아크릴 블록"], ["크기", "150 × 100 × 20mm"], ["효과", "각도에 따른 교실/모닥불 2단 변환"]],
    stock: 180, supply: "재판 가능", proofs: 240,
    origin: { still: "still-bonfire.jpg", line: "모닥불 앞에 모인 인물들의 기억을 담는 아크릴 블록 디자인." }
  },
  candle: {
    parts: ["소이 캔들 1", "틴 케이스 1"],
    spec: [["향", "장작 · 연기 · 마른 잎"], ["용량", "180g · 연소 40시간"], ["케이스", "틴 · 각인"]],
    stock: 200, limit: "1인 1개", per: 1, supply: "없음", edition: "시즌1 한정", proofs: 377,
    origin: { still: "still-bonfire.jpg", line: "옥상에서 함께 지킨 모닥불을 모티프로 한 캔들 디자인." },
  },
  dogtag_survivor: {
    parts: ["더블 군번줄 인식표 1", "사일런서 실리콘 링 2", "스틸 볼체인 65cm 1"],
    spec: [["소재", "316L 써지컬 스틸"], ["크기", "50 × 28 × 1.5mm"], ["각인 시안", "HYOSAN SURVIVOR 2-5 · RETURN TO ROOFTOP"]],
    stock: 450, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 290,
    origin: { still: "still-armed-group-walk.jpg", line: "함께 움직이는 생존자들의 이야기를 담은 인식표 디자인." }
  },
  strap_suhyeok: {
    parts: ["헤비 웨빙 스트랩 키링 1", "복싱 글러브 메탈 참 1"],
    spec: [["소재", "나일론 헤비 웨빙 · 아연합금"], ["크기", "폭 38mm × 길이 160mm"], ["자수", "HYOSAN BARE-KNUCKLE 볼륨 자수"]],
    stock: 380, supply: "재판 가능", proofs: 165,
    origin: { still: "still-barricade.jpg", line: "힘을 합쳐 바리케이드를 세우는 장면과 연결한 손목 스트랩 디자인." }
  },
  blanket: {
    parts: ["블랭킷 1", "수납 밴드 1"],
    spec: [["소재", "극세사 플란넬"], ["크기", "1400 × 1000mm"], ["프린트", "커튼 S.O.S 필체 재현"]],
    stock: 150, supply: "재판 가능", proofs: 88,
    origin: { still: "still-bonfire.jpg", line: "옥상에 둘러앉은 생존자들의 밤을 모티프로 한 블랭킷 디자인." },
  },
  lighter_eunji: {
    parts: ["황동 방풍 라이터 1", "전용 틴케이스 1"],
    spec: [["소재", "황동(Solid Brass) 웨더링 마감"], ["규격", "57 × 38 × 13mm"], ["방식", "오일 충전식 플린트 라이터"]],
    stock: 110, limit: "1인 1개", per: 1, supply: "없음", edition: "효산고 불씨 에디션", proofs: 388,
    origin: { still: "still-bonfire.jpg", line: "작품 속 불의 이미지를 모티프로 한 라이터 디자인." }
  },
  glass_canteen: {
    parts: ["효산고 유리컵 1", "빈티지 코르크 코스터 1"],
    spec: [["용량", "330ml"], ["소재", "내열 강화유리 · 천연 코르크"], ["인쇄", "초산실크스크린 빈티지 인쇄"]],
    stock: 500, supply: "재판 가능", proofs: 145,
    origin: { still: "hero-cafeteria-poster.jpg", line: "급식실이라는 익숙한 학교 공간에서 출발한 유리컵 디자인." }
  },
  photo: {
    parts: ["포토카드 랜덤 3매"],
    spec: [["규격", "55 × 85mm"], ["인쇄", "펄 코팅"], ["라인업", "생존자 7종 + 히든 1종"]],
    stock: 1200, limit: "1인 1개", per: 1, supply: "없음", edition: "시즌1 한정", proofs: 934,
    odds: [
      ["생존자 7종", "각 13.5%", "잔여 공개"],
      ["히든 1종", "5.5%", "120"],
    ],
    origin: { still: "still-bonfire.jpg", line: "함께 살아남은 순간을 기록하는 포토카드 팩의 패키지·뒷면 시안." }
  },
  zipup: {
    parts: ["체육복 집업 1", "각인 특전 (사전예약분)"],
    spec: [["소재", "기모 트리코트"], ["각인", "등번호 · 이름 (사전예약 특전)"], ["구성", "1점"]],
    options: { name: "사이즈", values: ["S", "M", "L", "XL", "2XL"] },
    stock: 260, supply: "없음", edition: "시즌2 기다림 에디션", card: true, proofs: 267,
    origin: { still: "still-armed-group-walk.jpg", line: "함께 학교를 빠져나오는 인물들의 모습과 연결한 체육복 디자인." }
  },
  archery: {
    parts: ["화살 북마크 2", "연필 3"],
    spec: [["소재", "황동 도금 · 흑연 HB"], ["크기", "북마크 120mm · 연필 175mm"], ["구성", "5점"]],
    stock: 700, limit: "1인 1개", per: 1, supply: "재판 가능", proofs: 61,
    origin: { still: "still-gym-group.jpg", line: "체육관 장면과 양궁부를 모티프로 구상한 화살 북마크 디자인." }
  },
  badge: {
    parts: ["명찰 뱃지 랜덤 2종"],
    spec: [["소재", "에폭시 도금 핀"], ["크기", "45 × 18mm"], ["표기", "반 번호만 · 이름 없음"]],
    stock: 540, supply: "없음", edition: "시즌1 한정", proofs: 312,
    odds: [
      ["반 번호 1~20", "각 4.5%", "잔여 공개"],
      ["반장 번호", "10%", "60"],
    ],
    origin: { still: "still-schoolyard.jpg", line: "효산고 교복의 명찰에서 출발한 반 번호 뱃지 디자인." }
  },
  postcard: {
    parts: ["엽서 10장"],
    spec: [["규격", "100 × 148mm"], ["인쇄", "미색 모조지"], ["내용", "깨어남의 말 3 · 생존 수칙 7"]],
    stock: 480, limit: "1인 1개", per: 1, supply: "없음", edition: "시즌1 한정", proofs: 129,
  },
};

// ⚠ 기록 키는 전부 **클수록 좋다**(폐기한 cafeSec 만 작을수록 좋았다). 급식실 = 무료 참여 · 점수별 차등 구매권 4단 + 옥상 완주권(cafePass).
export const RIGHT_GOALS = { cafePass: 2200, hoseSaved: 6 };   // cafePass = 급식실 점수(최고 3회차 합) 하한 → 옥상 완주권(PM 2026-09-03) · 급식실 구매권 4단 문턱은 RIGHTS[].score · hoseSaved = 방송실 한 판(8명)에 들여보낸 사람 수 하한(PM 2026-09-04 「6명 이상으로 하자」 · 보통 실력 61% 도달) · 도서관은 점수가 아니라 **미션 넷의 달성 여부**라 문턱이 없다(서가 탈출 P2 §11)
// 급식실 = 4단 차등 구매권(RIGHTS game:"cafeteria", score) — 문에는 최상위를 건다
export const ZONE_RIGHT = { cafeteria: "cafeCarabiner", broadcast: "radioPair", library: "libPhoto", rooftop: "idEngraved" };
export const RIGHTS = [
  { id: "radioPair", game: "broadcast", short: "6명 이상", name: "「다방」 무전기 키링 구매권", goal: "방송실 — 창문 열 개를 지나 8명 중 6명 이상 들여보내기", mdId: "radio", items: ["radio"], edition: "송출자 에디션 · 한정 500 · 1인 1세트", line: "창문을 지나 방송실에 닿은 사람에게 무전기가 간다" },
  /* 도서관 서가 탈출 — 탈출 하나 + 미션 셋(2026-09-04 재미 판정 통과 · 규칙 동결).
     **한 존에 두 문법이 함께 있다 — 의도한 것이다.**
     · **탈출 = 잠금**(`libPhoto` · MD 쪽 `right`) — 존을 통과해야 얻는 대표 보상이라 무게를 준다(PM 판정 ⓑ 2026-09-04).
       이름도 「구매권」이다. 「선구매권」이라 부르면서 잠그면 말과 동작이 어긋난다(그 상태를 2026-09-04 에 바로잡았다).
     · **미션 셋 = 선구매·에디션**(MD 쪽 `first`) — 매대를 막지 않는다(PM 판정 C). 셋 다 이미 상시 판매 상품이라 잠그면 매대가 줄어든다(P2 §3-3). */
  { id: "libPhoto", game: "library", short: "탈출", name: "생존자 포토카드 팩 구매권", goal: "도서관 — 서가를 빠져나오기", mdId: "photo", items: ["photo"], edition: "도서관 탈출자 한정 · 1인 1팩", line: "책장 사이를 빠져나온 사람만 이 팩을 가진다" },
  { id: "libBookmarkSet", game: "library", short: "책갈피 5", name: "양궁부 화살 북마크 선구매권", goal: "도서관 — 책갈피 5개를 다 줍고 탈출", mdId: "archery", items: ["archery"], edition: "책갈피 각인 에디션 · 일반 판매 전 선구매 · 1인 1세트", line: "책갈피를 다 주운 사람이 북마크를 먼저 고른다" },
  { id: "libDeskmat", game: "library", short: "무피격", name: "효산시 지도 데스크 장패드 선구매권", goal: "도서관 — 한 번도 안 잡히고 탈출", mdId: "deskmat_map", items: ["deskmat_map"], edition: "무피격 각인 에디션 · 일반 판매 전 선구매 · 1인 1장", line: "한 번도 안 잡힌 사람이 작전도를 먼저 편다" },
  { id: "libJournal", game: "library", short: "비밀 서고", name: "이병찬 실험노트 선구매권", goal: "도서관 — 비밀 서고를 지나 탈출", mdId: "virus_journal", items: ["virus_journal"], edition: "비밀 서고 에디션 · 일반 판매 전 선구매 · 1인 1권", line: "서가 밑을 지나 본 사람만 그 노트를 먼저 편다" },
  /* 옥상 2종 — 옥상 게임 달성이 직접 연다(PM 2026-09-02 「구매권은 체험존에서」). 스탬프·인장 게이트 폐지.
     게임 동사 확정 전까지 「모닥불 앞에 앉기」가 임시 완주(도서관 모의고사 임시와 같은 패턴) */
  /* 급식실 4단 — 점수(5회차 최고 3회 합 · 최대 4,800)별 차등 구매권. 무료 참여 전용(PM 2026-09-03). 높은 단은 아래 단을 전부 연다(누적) */
  { id: "cafeCanteen", game: "cafeteria", score: 1400, name: "효산 매점 유리컵 & 코스터 구매권", goal: "급식실 — 1,400p 이상", mdId: "glass_canteen", items: ["glass_canteen"], edition: "급식실 통과자 · 1인 1세트", line: "급식실을 빠져나온 사람이 매점 컵을 가진다" },
  { id: "cafeKit", game: "cafeteria", score: 2200, name: "생존 키트 파우치 구매권", goal: "급식실 — 2,200p 이상", mdId: "kit", items: ["kit"], edition: "급식실 통과자 · 1인 1개", line: "챙겨 나온 사람의 파우치" },
  { id: "cafeFirstaid", game: "cafeteria", score: 3000, name: "응급의무실 구급 파우치 & 블랭킷 구매권", goal: "급식실 — 3,000p 이상", mdId: "firstaid_pouch", items: ["firstaid_pouch"], edition: "급식실 3,000p · 1인 1팩", line: "끝까지 버틴 사람에게 구급 파우치가 간다" },
  { id: "cafeCarabiner", game: "cafeteria", score: 3600, name: "생존자 카라비너 멀티툴 & 휘슬 구매권", goal: "급식실 — 3,600p 이상", mdId: "carabiner_multitool", items: ["carabiner_multitool"], edition: "급식실 최상위 · 한정 300 · 1인 1개", line: "세 번을 상한 근처까지 버틴 사람만 카라비너를 건다" },
  { id: "idEngraved", game: "rooftop", short: "완주", name: "학생증 생존자 에디션 이름 각인판 구매권", goal: "옥상 완주", mdId: "idcard", items: ["idcard"], edition: "옥상 완주자 한정 · 한정 500", line: "살아서 옥상에 온 사람만 자기 학생증을 실물로 가진다" },
  { id: "bonfireOrgel", game: "rooftop", short: "완주", name: "모닥불 오르골 구매권", goal: "옥상 완주", mdId: "musicbox_bonfire", items: ["musicbox_bonfire"], edition: "옥상 완주자 한정 · 한정 100 · 1인 1개", line: "옥상의 밤을 지킨 사람만 그 소리를 가져간다" },
];

export const RAFFLES = [
  { id: "rf-uniform-sign", mdId: "uniform_female", edition: "교복 풀세트 & 친필 사인 명찰 5세트", closeIn: (3 * 24 + 18) * 3600 * 1000, entrants: 5820 },
  { id: "rf-radio", mdId: "radio", edition: "작동 워키토키 레플리카 10세트", closeIn: (26 * 60 + 14) * 60 * 1000, entrants: 4312 },
  { id: "rf-candle", mdId: "candle", edition: "대형 1L 넘버링 30개", closeIn: (2 * 24 + 3) * 3600 * 1000, entrants: 2871 },
];

export const FCFS = [
  { mdId: "ribbon_keyring", state: "open", stock: 86, total: 200, per: 2, at: (6 * 3600 + 30 * 60) * 1000 },
  { mdId: "archery_tracksuit", state: "open", stock: 48, total: 150, per: 1, at: (8 * 3600 + 15 * 60) * 1000 },
  { mdId: "virus_journal", state: "open", stock: 92, total: 300, per: 1, at: (4 * 3600 + 40 * 60) * 1000 },
  { mdId: "barricade_stand", state: "open", stock: 145, total: 400, per: 2, at: 6 * 3600 * 1000 },
  { mdId: "radio", state: "open", stock: 112, total: 300, per: 2, at: 5 * 3600 * 1000 },
  { mdId: "photo", state: "open", stock: 37, total: 500, per: 3, at: (3 * 60 + 20) * 60 * 1000 },
  { mdId: "candle", state: "soon", stock: 200, total: 200, per: 1, at: (1 * 60 + 42) * 60 * 1000 },
  { mdId: "archery", state: "soon", stock: 400, total: 400, per: 2, at: (26 * 60 + 5) * 60 * 1000 },
];

/* ── 상자 전용 소품 36종 ──
   **MD 에 넣지 않는다.** MD 는 굿즈샵 진열 대상이라 넣는 순간 판매 진열에 나오고,
   그러면 「돈 주고 뽑았는데 그냥 살 수 있는 게 나왔다」가 되어 상자의 값어치가 무너진다.
   기획 = `ICONS-지우학-상자전용-CDE-소품라인-36종-2026-08-27`. 실물 에셋은 별도 제작 — 여기엔 이미지가 없다. */
export const BOX_ITEMS = {
  lock_dial: { name: "사물함 다이얼 자물쇠 키링", price: 12000, tier: "C", src: "box-lock-dial.jpg" },
  key_25: { name: "2-5반 교실 열쇠 & 태그 세트", price: 11000, tier: "C", src: "box-key-25.jpg" },
  slipper_charm: { name: "효산고 실내화 미니 참", price: 10000, tier: "C", src: "box-slipper-charm.jpg" },
  locker_magnet: { name: "사물함 번호 아크릴 마그넷", price: 7000, tier: "D", src: "box-locker-magnet.jpg" },
  notice_replica: { name: "가정통신문·성적표 리플리카 세트", price: 6000, tier: "D", src: "box-notice-replica.jpg" },
  meal_ticket: { name: "급식 식권 리플리카", price: 5500, tier: "D", src: "box-meal-ticket.jpg" },
  logo_sticker: { name: "효산고 로고 스티커 시트", price: 3000, tier: "E", src: "box-logo-sticker.jpg" },
  paper_nametag: { name: "종이 명찰 리플리카", price: 3000, tier: "E", src: "box-paper-nametag.jpg" },
  locker_label: { name: "사물함 라벨 스티커", price: 2500, tier: "E", src: "box-locker-label.jpg" },
  carabiner_box: { name: "보급 카라비너 & 태그", price: 12000, tier: "C", src: "box-carabiner-box.jpg" },
  mini_pouch: { name: "미니 구급 파우치", price: 11000, tier: "C", src: "box-mini-pouch.jpg" },
  whistle_cord: { name: "휘슬 & 파라코드 키홀더", price: 10000, tier: "C", src: "box-whistle-cord.jpg" },
  radio_single: { name: "무전기 키링 단품 「다방」", price: 7000, tier: "D", src: "box-radio-single.jpg" },
  reflect_strap: { name: "야간 반사 스트랩", price: 6000, tier: "D", src: "box-reflect-strap-v2.webp" },
  bandage_tin: { name: "응급 밴드 틴케이스", price: 5500, tier: "D", src: "box-bandage-tin-v2.webp" },
  ration_slip: { name: "배급표 리플리카", price: 3000, tier: "E", src: "box-ration-slip.jpg" },
  emergency_sticker: { name: "응급 표식 스티커팩", price: 3000, tier: "E", src: "box-emergency-sticker.jpg" },
  rule_card: { name: "생존 수칙 카드", price: 2500, tier: "E", src: "box-rule-card.jpg" },
  freq_dial: { name: "주파수 다이얼 참", price: 12000, tier: "C", src: "box-freq-dial-v2.webp" },
  mic_mini: { name: "방송부 마이크 미니어처 키링", price: 11500, tier: "C", src: "box-mic-mini-v2.webp" },
  onair_magnet: { name: "ON AIR 아크릴 마그넷 스탠드", price: 10000, tier: "C", src: "box-onair-magnet-v2.webp" },
  broadcast_badge: { name: "방송부 배지", price: 7000, tier: "D", src: "box-broadcast-badge-v2.webp" },
  cassette_case: { name: "카세트테이프 리플리카 케이스", price: 6500, tier: "D", src: "box-cassette-case-v2.webp" },
  cable_tie: { name: "전선 정리 케이블 타이 세트", price: 5500, tier: "D", src: "box-cable-tie-v2.webp" },
  freq_sticker: { name: "주파수 스티커 시트", price: 3000, tier: "E", src: "box-freq-sticker.jpg" },
  script_replica: { name: "방송 대본 리플리카", price: 2500, tier: "E", src: "box-script-replica.jpg" },
  still_postcard: { name: "방송실 스틸 미니엽서", price: 2500, tier: "E", src: "box-still-postcard.jpg" },
  flashlight_charm: { name: "손전등 미니 참", price: 12000, tier: "C", src: "box-flashlight-charm-v2.webp" },
  ember_charm: { name: "모닥불 불씨 아크릴 참", price: 11000, tier: "C", src: "box-ember-charm-v2.webp" },
  sos_magnet: { name: "옥상 S.O.S 아크릴 마그넷", price: 10000, tier: "C", src: "box-sos-magnet-v2.webp" },
  mini_candle: { name: "미니 캔들", price: 7000, tier: "D", src: "box-mini-candle-v2.webp" },
  glow_sticker: { name: "야광 스티커팩", price: 6000, tier: "D", src: "box-glow-sticker.jpg" },
  emergency_light: { name: "비상등 키링", price: 5500, tier: "D", src: "box-emergency-light-v2.webp" },
  glow_charm: { name: "야광 참", price: 3500, tier: "E", src: "box-glow-charm-v2.webp" },
  ember_sticker: { name: "불씨 스티커", price: 2500, tier: "E", src: "box-ember-sticker.jpg" },
  lightsout_card: { name: "소등 카드", price: 2500, tier: "E", src: "box-lightsout-card.jpg" },
};

/* ── 상자 회차 4종 ──
   계약 = `ICONS-지우학-상자-4회차-구성-P5000-2026-08-27`. 1회 5,000원 · 80칸 · A1·B3·C12·D24·E40 + LAST.
   40칸은 성립하지 않는다 — 매출 20만원에 의류 A상 하나가 49%를 먹는다(80칸이면 24.5%).
   하위 등급은 전부 상자 전용(BOX_ITEMS) — 판매 SKU 를 쓰지 않는다. */
export const KUJI = [
  {
    id: "k1", name: "사물함 회차", state: "open", price: 5000, total: 80,
    endIn: (2 * 24 + 6) * 3600 * 1000,
    drawn: [2, 3, 4, 6, 7, 8, 11, 12, 14, 16, 17, 19, 20, 21, 24, 27, 28, 29, 31, 35, 36, 37, 40, 41, 43, 44, 46, 47, 48, 49, 50, 51, 52, 53, 55, 56, 59, 60, 61, 63, 64, 67, 68, 73, 74, 79, 80],
    prizes: [
      { grade: "A상", mdId: "uniform_female", count: 1, left: 1 },
      { grade: "B상", mdId: "binder_attendance", count: 1, left: 1 },
      { grade: "B상", mdId: "deskmat_map", count: 1, left: 0 },
      { grade: "B상", mdId: "cabinet_penholder", count: 1, left: 0 },
      { grade: "C상", boxId: "lock_dial", count: 4, left: 2 },
      { grade: "C상", boxId: "key_25", count: 4, left: 2 },
      { grade: "C상", boxId: "slipper_charm", count: 4, left: 2 },
      { grade: "D상", boxId: "locker_magnet", count: 8, left: 3 },
      { grade: "D상", boxId: "notice_replica", count: 8, left: 3 },
      { grade: "D상", boxId: "meal_ticket", count: 8, left: 3 },
      { grade: "E상", boxId: "logo_sticker", count: 14, left: 6 },
      { grade: "E상", boxId: "paper_nametag", count: 13, left: 5 },
      { grade: "E상", boxId: "locker_label", count: 13, left: 5 },
      { grade: "LAST", name: "효산고 공식 교복 세트 — 넘버링 각인판", src: "md-uniform-female-last.jpg", count: 1, left: 1 },
    ],
  },
  {
    id: "k2", name: "보급 낙하 회차", state: "open", price: 5000, total: 80,
    endIn: (2 * 24 + 6) * 3600 * 1000,
    drawn: [8, 14, 18, 40, 42, 47, 57, 59, 60, 69, 71, 74],
    prizes: [
      { grade: "A상", mdId: "archery_tracksuit", count: 1, left: 1 },
      { grade: "B상", mdId: "firstaid_pouch", count: 1, left: 1 },
      { grade: "B상", mdId: "tactical_flashlight", count: 1, left: 1 },
      { grade: "B상", mdId: "kit", count: 1, left: 1 },
      { grade: "C상", boxId: "carabiner_box", count: 4, left: 3 },
      { grade: "C상", boxId: "mini_pouch", count: 4, left: 3 },
      { grade: "C상", boxId: "whistle_cord", count: 4, left: 3 },
      { grade: "D상", boxId: "radio_single", count: 8, left: 7 },
      { grade: "D상", boxId: "reflect_strap", count: 8, left: 7 },
      { grade: "D상", boxId: "bandage_tin", count: 8, left: 7 },
      { grade: "E상", boxId: "ration_slip", count: 14, left: 12 },
      { grade: "E상", boxId: "emergency_sticker", count: 13, left: 11 },
      { grade: "E상", boxId: "rule_card", count: 13, left: 11 },
      { grade: "LAST", name: "양궁부 트레이닝 세트 — 넘버링 각인판", src: "md-archery-tracksuit.jpg", count: 1, left: 1 },
    ],
  },
  {
    id: "k3", name: "배선도 회차", state: "soon", price: 5000, total: 80,
    endIn: (4 * 24 + 6) * 3600 * 1000,
    drawn: [],
    prizes: [
      { grade: "A상", mdId: "hoodie_broadcast", count: 1, left: 1 },
      { grade: "B상", mdId: "earphone_namra", count: 1, left: 1 },
      { grade: "B상", mdId: "virus_journal", count: 1, left: 1 },
      { grade: "B상", mdId: "lenticular_block", count: 1, left: 1 },
      { grade: "C상", boxId: "freq_dial", count: 4, left: 4 },
      { grade: "C상", boxId: "mic_mini", count: 4, left: 4 },
      { grade: "C상", boxId: "onair_magnet", count: 4, left: 4 },
      { grade: "D상", boxId: "broadcast_badge", count: 8, left: 8 },
      { grade: "D상", boxId: "cassette_case", count: 8, left: 8 },
      { grade: "D상", boxId: "cable_tie", count: 8, left: 8 },
      { grade: "E상", boxId: "freq_sticker", count: 14, left: 14 },
      { grade: "E상", boxId: "script_replica", count: 13, left: 13 },
      { grade: "E상", boxId: "still_postcard", count: 13, left: 13 },
      { grade: "LAST", name: "방송부 헤비웨이트 후디 — 넘버링 각인판", src: "md-hoodie-broadcast-last.jpg", count: 1, left: 1 },
    ],
  },
  {
    id: "k4", name: "소등 후 회차", state: "soon", price: 5000, total: 80,
    endIn: (4 * 24 + 6) * 3600 * 1000,
    drawn: [],
    prizes: [
      { grade: "A상", mdId: "zipup_namra", count: 1, left: 1 },
      { grade: "B상", mdId: "blanket", count: 1, left: 1 },
      { grade: "B상", mdId: "lighter_eunji", count: 1, left: 1 },
      { grade: "B상", mdId: "candle", count: 1, left: 1 },
      { grade: "C상", boxId: "flashlight_charm", count: 4, left: 4 },
      { grade: "C상", boxId: "ember_charm", count: 4, left: 4 },
      { grade: "C상", boxId: "sos_magnet", count: 4, left: 4 },
      { grade: "D상", boxId: "mini_candle", count: 8, left: 8 },
      { grade: "D상", boxId: "glow_sticker", count: 8, left: 8 },
      { grade: "D상", boxId: "emergency_light", count: 8, left: 8 },
      { grade: "E상", boxId: "glow_charm", count: 14, left: 14 },
      { grade: "E상", boxId: "ember_sticker", count: 13, left: 13 },
      { grade: "E상", boxId: "lightsout_card", count: 13, left: 13 },
      { grade: "LAST", name: "남라 '면벽' 오버핏 니트 집업 — 넘버링 각인판", src: "md-knit-namra-last.jpg", count: 1, left: 1 },
    ],
  },
];

/* ── 온라인 팝업 일정 (2026-09-04 · PM 위임 「알아서 기획해서 만들어, 어차피 샘플이야」) ──
   설계서 §5-2 는 편성을 페이즈까지만 정해 뒀다(「래플은 본편 1」). 화면이 「무엇이 언제」를 답해야 하므로
   그 페이즈 안에서 실제 날짜를 배치했다. 실물 회차·상품 이름을 그대로 쓴다(KUJI 4회차 · RAFFLES 3건).
   배치 원칙 — ① 본편 1 은 문을 여는 구간이라 개장일에 럭키드로우 첫 회차를 건다
   ② 래플은 겹치지 않게 띄우고 마지막 하나만 본편 2 로 넘겨 후반에도 볼 것을 남긴다
   ③ 사전예약은 본편 1 마지막 날 닫아 본편 2 의 시작과 겹치지 않게 한다
   ④ 라스트원 회차는 결산 직전에 두어 마지막 주에 이유가 생기게 한다.
   경계는 POPUP_PERIOD(8.18~9.28) 안. 오프라인 팝업(11.06~11.22)은 기간 밖이라 트랙에 얹지 않고
   끝에 「다음」 표지로만 붙는다. from 만 있으면 하루짜리 점, to 가 있으면 구간. go = 그 이벤트가 사는 존.
   note = 목록 한 줄에 붙는 사실(짧게) · about = 무대에서 그 일정을 골랐을 때 컨텍스트 패널에 서는 소개(두 문장) —
   PM 2026-09-07 「버튼을 클릭하면 컨텍스트 패널에서 해당 기간에 대한 소개와 바로가기 버튼이 나오면 돼」. */
export const SCHEDULE = [
  { id: "open", from: "2026-08-18",                    name: "개장 · 럭키드로우 ①", go: "kuji",     note: "사물함 회차 — 80칸 확정 구성 뽑기 시작", about: "온라인 팝업이 문을 여는 날입니다. 사물함 회차 럭키드로우가 같은 날 함께 열리고, 80칸 구성이 모두 공개된 채로 시작합니다." },
  { id: "rf1",  from: "2026-08-22", to: "2026-09-01", name: "래플 ①",             go: "raffle",   note: "교복 풀세트 & 친필 사인 명찰 5세트 · 마감 후 정시 발표", about: "교복 풀세트와 친필 사인 명찰 5세트를 겁니다. 응모에는 돈이 들지 않고, 마감한 뒤 정해진 시각에 발표합니다." },
  { id: "kj2",  from: "2026-08-29",                    name: "럭키드로우 ②",       go: "kuji",     note: "보급 낙하 회차 개시", about: "보급 낙하 회차가 시작됩니다. 앞 회차의 남은 칸을 정리하고 새 구성으로 넘어갑니다." },
  { id: "rf2",  from: "2026-09-02", to: "2026-09-09", name: "래플 ②",             go: "raffle",   note: "작동 워키토키 레플리카 10세트", about: "작동하는 워키토키 레플리카 10세트를 겁니다. 응모에는 돈이 들지 않고, 마감한 뒤 정해진 시각에 발표합니다." },
  { id: "fc1",  from: "2026-09-11",                    name: "선착순 드랍",         go: "fcfs",     note: "정시 오픈 · 수량 한정 · 1인 한도", about: "정해진 시각에 열리고 수량이 끝나면 닫힙니다. 한 사람이 살 수 있는 수량이 정해져 있습니다." },
  { id: "pre",  from: "2026-09-14",                    name: "사전예약 마감",       go: "preorder", note: "시즌2 기다림 에디션 — 등번호·이름 각인", about: "시즌2 기다림 에디션의 예약이 이날 닫힙니다. 예약한 사람에게는 등번호와 이름 각인이 붙습니다." },
  { id: "kj3",  from: "2026-09-15",                    name: "럭키드로우 ③",       go: "kuji",     note: "배선도 회차 — 본편 2 개시", about: "배선도 회차가 열립니다. 남은 구성이 여기서 한 번 더 채워집니다." },
  { id: "rf3",  from: "2026-09-16", to: "2026-09-23", name: "래플 ③",             go: "raffle",   note: "대형 1L 넘버링 30개", about: "대형 1L 넘버링 30개를 겁니다. 이 팝업의 마지막 래플입니다." },
  { id: "fl1",  from: "2026-09-20",                    name: "게릴라 드랍",         go: "fcfs",     note: "예고 없이 특정 시각에만 열린다 · 수량 한정", about: "예고 없이 특정 시각에만 열립니다. 수량이 적고 열려 있는 시간도 짧습니다." },
  { id: "kj4",  from: "2026-09-22",                    name: "럭키드로우 ④",       go: "kuji",     note: "소등 후 회차 — 라스트원", about: "소등 후 회차입니다. 라스트원 상품이 이 회차에 걸립니다." },
  { id: "fin",  from: "2026-09-26", to: "2026-09-28", name: "결산 · 최종 발표",     go: "rooftop",  note: "남은 회차 소진 · 옥상 결말", about: "남은 회차를 소진하고 결과를 발표합니다. 옥상에서 이야기가 끝나고 시즌2로 가는 문이 열립니다." },
];

export const PREORDER = { mdId: "zipup", perk: "등번호·이름 각인 · 시즌2 공개 전 배송", closeIn: (6 * 24 + 4) * 3600 * 1000, count: 1268 };

// 온라인 팝업 기간 — 표지 시즌 게이지의 근거(PM 2026-08-28). 데모 현재일이 기간 안에 오도록 잡는다.
/* 페이즈 경계(설계서 §2-2 준용): 예고(오픈 전) → 본편 1(1~2주차) → 본편 2(3주차~) → 결산(마지막 3일) */
export const POPUP_PERIOD = {
  open: "2026-08-18", close: "2026-09-28", label: "8.18 — 9.28",
  main2From: "2026-09-15",   // 본편 2 시작 — 시연 갱신 2026-09-01(부칙 6: 시연일이 기간 안에 오도록)
  finaleFrom: "2026-09-26",  // 결산 시작(종료 -3일)
};

export const OFFLINE = {
  // 계약 = 통합 인계서 §3.0-1 오프라인 안내 모듈(전 팝업 공통). 유형 = 정보성.
  // 제목은 전 팝업 공통 「오프라인 팝업」으로 고정한다(PM 2026-08-27) — 세계관 명칭을 쓰지 않는다.
  status: "open",                       // soon | open | live | closed (개막일 기준 자동 전환)
  reserveOpen: true,                    // 예약 열림 — 상태와 별개 축(시연: 예약 플로우 공개, PM 2026-08-31)
  poster: "poster-main-kr.jpg",         // 필드1 — 세로형 키비주얼
  // 필드3 — 행사 소개글(PM 2026-08-28, 팝업 안내 포스팅 문법): 타이틀 라인 → 훅+무엇을 하는 팝업인지 → 할 수 있는 것 → 경험 클로징.
  introTitle: "지금 우리 학교는 1.5 OFFLINE POP-UP",
  introSub: "지금 우리 학교는 × 효산고 세트 · 성수",
  intro: [
    "그날의 학교가 성수에 다시 지어집니다. 효산고를 그대로 올린 세트에서 11월, 생존 팝업이 문을 엽니다.",
    "낮에는 그날의 교실을 걷고, 보급소에서 이 팝업 한정 굿즈를 손에 넣고, 소등 후에는 생존자가 되어 소리를 죽인 채 옥상까지 오릅니다.",
    "온라인 팝업의 기록은 현장으로 이어집니다 — 생존자 인증으로 입장하고, 살아 돌아온 사람은 모닥불 옆 청산치킨 테이블에서 만나요.",
  ],
  city: "서울",
  area: "성동구 성수동",
  venue: "효산고 세트",
  openAt: "2026-11-06",
  closeAt: "2026-11-22",
  period: "2026.11.06(금) ~ 11.22(일)",
  hours: "11:00 ~ 20:00 · 월요일 휴관",
  lastEntry: "마지막 입장 19:00",
  entry: "무료 · 30분 단위 시간대 예약 + 현장 대기",
  // 소요·정원 — 이머시브 체험 소개의 표준 항목(레퍼런스 §형식 비교: 30명 · 80~90분)
  run: "회차제 · 6~30명 · 30~50분",
  // 필드8 유의사항 — 제한 고지는 업계 표준 항목이다(경주 EX-HORROR). 값은 시연 설정이며 게이트 G8에서 확정된다
  caution: "밤 체험은 15세 이상 · 미취학 아동은 보호자 동반 · 임산부와 심장질환자는 참여할 수 없습니다.",
  // 필드5 지도 — 일러스트 약도(OfflineMap)에 넘기는 값. 실제 축척 아님·읽기 위한 배치.
  station: "성수역",
  line: "2",
  lineColor: "#00a84d",
  exit: "3번 출구",
  streets: ["연무장길", "아차산로"],
  walk: "도보 6분",
  daytime: "그날의 교실 전시 · 보급소",
  programs: [
    { id: "chase", name: "소등 후", kind: "체이스", desc: "뛰면 잡힌다. 천천히 움직이는 사람이 산다", meta: "20~30명 · 40~50분" },
    { id: "escape", name: "봉쇄 교실", kind: "탈출", desc: "소리를 내지 않고 2학년 5반을 빠져나온다", meta: "6명 · 30분" },
    { id: "chimac", name: "한밤의 치맥파티", kind: "청산치킨", desc: "살아남은 사람끼리 옥상 모닥불 옆에서", meta: "체험 완주자 우선 · 무알콜 병행" },
  ],
  bridge: "온라인 학생증으로 현장에 들어갑니다",
};

export const ACHIEVEMENTS = [
  { id: "enroll", name: "등교", path: "첫방문", cond: "효산고에 처음 들어선다", line: "다시 이 문을 지났다", companion: null },
  { id: "signal", name: "전파", path: "공유(공시형)", cond: "내 기록을 지정 해시태그와 함께 밖으로 내보낸다", line: "밖으로 신호를 보냈다", companion: null },
  { id: "wall", name: "벽에 남긴 말", path: "미션", cond: "커뮤니티에 이 팝업 태그로 글을 남긴다", line: "누군가 읽을 자리에 적어두었다", companion: null },
  { id: "supply", name: "보급 개시", path: "구매 리워드", cond: "보급소에서 처음으로 무언가를 산다", line: "빈손으로 버티지 않기로 했다", companion: "상품이 본체 — 카드는 무상 동봉" },
  { id: "stock", name: "비축", path: "구매 리워드", cond: "누적 구매 12만원 지점에 닿는다", line: "오래 버틸 준비를 했다", companion: "전 매대 10분 선오픈(R3)에 얹힌다" },
  { id: "drill", name: "실전 통과", path: "게임", cond: "급식실·방송실 미니게임을 모두 클리어한다", line: "둘 다 몸으로 겪었다", companion: "각 게임의 구매권이 이미 본체 — 전수 상태의 증표" },
];

// rightLabel = 표시 라벨(구매권/우선구매권) — RIGHTS 의 id 참조가 아니다. 게임 구매권과 별개인 구매 마일스톤 축(PM #435).
export const PURCHASE_TIERS = [
  { at: 50000, mdId: "archery", rightLabel: "구매권", name: "양궁부 화살 북마크 + 연필 세트", line: "오래 앉아 있던 사람에게 남는 것" },
  { at: 120000, mdId: null, rightLabel: "우선구매권", name: "전 매대 10분 선오픈", line: "먼저 볼 수 있게 열어둔다" },
  { at: 200000, mdId: "zipup", rightLabel: "구매권", name: "체육복 집업 — 생존자 각인판", line: "등번호 자리에 이름을 새긴다", note: "일반 집업은 사전예약으로 계속 열려 있다. 이 구간은 각인판 한정." },
];
export const PURCHASE_SPENT = 138000;

export const NOTICES = [
  { id: "rooftop-open", tag: "운영", title: "옥상을 엽니다 — 결말", body: "체험 3곳에 참여한 사람에게 옥상 문이 열립니다. 옥상 완주자에게 학생증 각인판·모닥불 오르골 구매권이 열립니다.", at: "오늘 09:20", img: "still-bonfire.jpg" },
  { id: "library-open", tag: "개장", title: "도서관 — 서가 탈출 오픈", body: "저절로 달린다. 탭은 뛰고 연속 두 번은 멀리 뛴다. 뒤에서 무리가 밀려오니 멈추면 잡힌다. 비상계단 끝 창까지.", at: "어제 18:40", img: "still-library.jpg" },
  { id: "raffle-announce", tag: "발표", title: "래플 1차 발표 — 교복 풀세트 & 사인 명찰", body: "응모 5,820명 · 당첨 5명. 당첨자에게 개별 알림이 갑니다.", at: "오늘 12:00", img: "still-schoolyard.jpg" },
  { id: "fcfs-r2", tag: "판매", title: "선착순 2차 매대 오픈", body: "무전기 키링 「다방」 페어 외 3종 · 잔여는 매대에 실시간 공시.", at: "내일 20:00", img: "still-infirmary.jpg" },
];

/* 커뮤니티 태그 — 「생존자의 벽」 개념은 폐기됐다(PM 2026-09-04 「그냥 커뮤니티존으로 통일해」).
   WALL_* 는 이름만 남은 내부 식별자다 — 화면 어디에도 「벽」은 없다. */
export const WALL_TAG = "#효산고생존자";
export const WALL_POSTS = [
  {
    id: "p1",
    handle: "@survivor_0412",
    user: "survivor_0412",
    initial: "S",
    avatar: "linear-gradient(135deg, #ff8a3d, #e11d48)",
    photo: "onjo",
    from: "지금 우리 학교는 1.5",
    at: "12분 전",
    img: "still-bonfire.jpg",
    text: "옥상 올라오니까 진짜 불 피워놨네. 다들 무사했구나. 모닥불 앞은 처음인데 이상하게 안심된다.",
    like: 214,
    reply: 18,
    tag: "효산고생존자",
  },
  {
    id: "p2",
    handle: "@5ban_forever",
    user: "5ban_forever",
    initial: "5",
    avatar: "linear-gradient(135deg, #22c55e, #0ea5e9)",
    photo: "cheongsan",
    from: "지금 우리 학교는 1.5",
    at: "1시간 전",
    img: "still-classroom-outbreak.jpg",
    text: "교실 책상 여덟 개 다 열어봤어요. 아홉 번째 책상에서 한참 서 있었습니다… 다들 꼭 확인해보세요.",
    like: 460,
    reply: 52,
    tag: "효산고생존자",
  },
  {
    id: "p3",
    handle: "@night_archery",
    user: "night_archery",
    initial: "N",
    avatar: "linear-gradient(135deg, #a855f7, #6366f1)",
    photo: "namra",
    from: "지금 우리 학교는 1.5",
    at: "3시간 전",
    img: "still-schoolyard.jpg",
    text: "운동장 가로질러 갈 때 소리 안 나게 하는 거 세 번 만에 성공함! 양궁부 유니폼 실물 대박입니다.",
    like: 132,
    reply: 9,
    tag: "효산고생존자",
  },
];


export const DAILY_RULES = [
  "수칙 1 — 두 사람 이상이면 반드시 역할을 나눈다.",
  "수칙 2 — 출구는 항상 두 개를 확인해 둔다.",
  "수칙 3 — 소리는 낮게, 신호는 분명하게.",
  "수칙 4 — 물과 배터리는 절반이 남았을 때 채운다.",
  "수칙 5 — 무리하지 않는다. 버티는 것도 용기다.",
  "수칙 6 — 이름을 부른다. 이름은 사람을 지킨다.",
  "수칙 7 — 모닥불 앞에서는 오늘 있었던 일을 나눈다.",
];

/* 기억·회상 기획 폐기 (PM 2026-09-02) — 체험은 「명장면을 배경으로 게임을 한다」가 전부다.
   ADR-0028 절비 리빌도 함께 접었다: 리빌의 전달 수단이 기억 조각이었다. */


export const ASSET = (path) => (path?.startsWith("/") ? path : `/ip-popups/aouad/${path}`);

export const OPENING = {
  noticeTitle: "효산고등학교 옥상",
  noticeBody: OPENING_CALL.noticeBody,   /* 문안은 aouad-copy.js */
  revivalCaption: "그날의 학교로, 다시",
};

/* 장면 굿즈 큐레이션(PM 2026-08-28 「각 명장면에 어울리는 굿즈 배치」): 존마다 3종 — 체험과 구매의 유기 연결.
   보상 구매권 상품과 별개 축(보상 계약 카드는 그대로) — 단 방송실 무전기처럼 장면 대표가 보상 상품이면 포함(잠금 오버레이가 문). */
/* 존 「보는 것」 — 히어로 이미지 섹션이 쓴다(존 3요소 ① · ADR-0033). 무상·무조건 열림.
   `stills` 만 화면에 나간다 — 5초마다 페이드로 바뀐다. `scene`·`line` 은 **화면에 안 쓴다**(PM 2026-09-07
   「이런 쓸데없는 이야기는 없애」) — 어느 명장면인지 기록해 두는 내부 메모다.
   장면 번호는 명장면 정본 10(체험존 명장면 재설계 §1) 기준. */
export const ZONE_WATCH = {
  /* 영상이 있으면 스틸 페이드 대신 영상이 히어로를 채운다(PM 2026-09-08). 원작 급식실 장면 화면 기록 2~43s · 2배속 · 제목·NETFLIX·N 워터마크 크롭 · 소리 없음.
     시연 샘플 범위(PM 2026-09-04 승인) 안의 원작 매체 — 실서비스·인쇄·광고는 별도. */
  cafeteria: { scene: "3 급식실 잠입", line: "점심시간의 급식실이 순식간에 뒤덮인다", stills: ["hero-cafeteria-poster.jpg", "still-cafeteria-horde.jpg"],
               video: { src: "hero-cafeteria.mp4", poster: "hero-cafeteria-poster.jpg" } },
  /* 방송실 히어로 = 영상(PM 2026-09-08 「0.5초부터 8초까지 클립으로 히어로에 쓰면 돼」) — 창문 밖으로 매달려 내려가는 장면. 1배속 7.5s · 제목 워터마크 크롭 · 소리 없음 */
  broadcast: { scene: "4′ 창문에서 줄을 타고 내려간다 (개정 2026-09-08 · 농성 방송 → 하강)", line: "창틀을 넘어 벽을 타고 내려간다", stills: ["hero-broadcast-poster.jpg"],
               video: { src: "hero-broadcast.mp4", poster: "hero-broadcast-poster.jpg" } },
  library: { scene: "6 도서관 추격전", line: "책장 사이로 쫓기고, 책장 위로 달아난다", stills: ["still-library.jpg", "still-library-shelftop.jpg", "still-library-stacks.jpg"] },
  rooftop: { scene: "8 옥상 모닥불 · 10 4개월 후 재회", line: "불 앞에 앉아 살아 있다는 것을 확인한다", stills: ["still-bonfire.jpg", "still-rooftop-fire.jpg"] },
};

/* 존 매대에 걸 상품 — **상시 판매만 건다**(PM 2026-09-08). 존 굿즈는 두 갈래다:
   ① **체험 기반** = 게임으로 구매권을 따야 살 수 있다(`right` 가 있는 상품) — 그 진열은 게임 안 구매권 선반이 맡는다
   ② **상시 판매** = 체험을 하지 않아도 살 수 있다 — 「이 장면의 굿즈」는 **이쪽만** 건다
   체험을 안 한 사람 앞에 잠긴 상품을 세우면 매대가 아니라 광고판이 된다.
   화면(`ZoneGoodsStrip`)이 `right` 있는 상품을 한 번 더 걸러 내므로, 실수로 넣어도 새지 않는다.
   **개수는 여기서 정한다** — 칸 수는 폭이 맞춘다(PM 2026-09-08). 다만 화면이 **앞 6종까지만** 건다(PM 2026-09-08
   「최대 6개 정도가 보이면 좋을 것 같아」) — 더 넣어도 진열되지 않고, 나머지는 「굿즈샵으로 가기」가 받는다. */
/* 체험(게임) 섹션의 이름 — 화면 머리에 선다(PM 2026-09-08 「체험 섹션은 급식실 탈출게임이라는 이름으로」).
   급식실만 PM 이 준 이름이고 나머지는 각 게임의 문서 이름을 그대로 — 트랙이 정하면 바꾼다. */
export const ZONE_GAME_NAME = { cafeteria: "급식실 탈출게임", broadcast: "방송실 호스 하강", library: "도서관 서가 탈출", rooftop: "옥상의 모닥불" };

export const ZONE_GOODS = {
  /* 급식실 — 유리문 너머 무리 · 책상 바리케이드 · 매점. `kit`·`firstaid_pouch` 는 구매권 상품이라 뺐다(게임 선반에 있다) */
  cafeteria: ["windbreaker_cheongsan", "barricade_stand", "maskingtape_set", "tactical_flashlight", "badge", "ribbon_keyring"],
  /* 방송실 — 방송부 · 최남라 · 2-5반이 함께 버틴 자리. `radio`(무전기 키링)는 구매권 상품이라 뺐다 */
  broadcast: ["hoodie_broadcast", "earphone_namra", "zipup_namra", "strap_suhyeok", "lenticular_block", "binder_attendance"],
  /* 도서관 — 서가 · 양궁부 장하리 · 이병찬 실험노트 (quiz→library #707 — 키가 안 맞아 존에 매대가 안 나오던 것) */
  library: ["archery", "deskmat_map", "virus_journal", "archery_cardwallet", "archery_tracksuit", "virus_paperweight"],
  /* 옥상 — 모닥불 · S.O.S · 시즌2로 가는 문. `musicbox_bonfire`(오르골)는 구매권 상품이라 뺐다 */
  rooftop: ["candle", "blanket", "dogtag_survivor", "postcard", "lighter_eunji", "zipup"],
};

// 체험 존 셋 = 스탬프 셋 (PM 2026-09-02: 교실·IF 극장 폐기 · 옥상은 체험존 아님)



// 생존 모의고사(QUIZ·QUIZ_TYPES)는 도서관 P5 이관으로 제거(PM 2026-09-03) — 장면이 아니라 프로필이었다(판정 4)
