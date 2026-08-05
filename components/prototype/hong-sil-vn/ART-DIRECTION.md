# 홍실 퀘스트 일러스트 제작 기록

이 문서는 `story.ts`의 현재 서사와 선택지 문구를 기준으로 다시 만든 프로토타입 원화 56컷의 제작 기준이다. 원작의 확정 설정과 프로토타입에서 확장한 결말 문장은 `story.ts`를 단일 진실원으로 삼는다.

## 산출물

| 구분 | 수량 | 규격 | 경로 |
| --- | ---: | --- | --- |
| 라운드 배경 | 4 | 1600×1000 WebP | `public/generated/hong-sil-vn/scenes/` |
| 선택지 컷 | 12 | 1600×700 WebP | `public/generated/hong-sil-vn/choices/` |
| 엔딩 서사 컷 | 20 | 1600×1000 WebP | `public/generated/hong-sil-vn/endings/` |
| 엔딩 카드 원화 | 20 | 1000×1400 WebP | `public/generated/hong-sil-vn/cards/` |

## 캐릭터와 공통 미술 기준

- 이연: 마른 체형의 검은 머리 법학과 후배. 흰 셔츠와 어두운 재킷, 절제된 표정.
- 홍기훈: 이연보다 키가 크고 운동한 체형의 금발 선배. 흰 셔츠와 느슨한 짙은 타이, 개방적인 표정.
- 스타일: 프리미엄 한국 로맨스 판타지 웹툰, 깨끗한 선, 성인 체형, 절제된 셀 셰이딩과 영화적 조명.
- 팔레트: near-black, deep oxblood, dusty ivory를 기본으로 하고 홍실은 crimson 발광으로 제한한다.
- 금지: 이미지 안의 글자·숫자·로고·프레임·UI·말풍선·워터마크, 상처나 고어, 불필요한 중심 인물.
- 참조: `public/generated/ip/hong-sil-quest.webp`, `public/generated/goods/g14.webp`, 같은 세트에서 먼저 완성한 장면·엔딩·카드 원화.

## 공통 프롬프트

> Create one premium Korean romance-fantasy webtoon illustration. Match the two male leads in the supplied canonical Hong Sil Quest reference. Lee Yeon is the slim, elegant black-haired law student junior in a dark blazer and white shirt. Hong Kihoon is the taller athletic blond senior in a white shirt with a loosened dark tie. Use refined adult anatomy, clean expressive linework, restrained cel shading, cinematic lighting, and a near-black/deep oxblood/dusty ivory house palette. The red thread is restrained magical light. No typography, letters, numbers, logos, borders, UI, captions, speech bubbles, watermark, gore, injury, or extra prominent characters. Do not copy text from references.

장면과 엔딩 컷은 16:10, 선택지 컷은 16:7, 카드 원화는 5:7 구도로 요청했다. 카드 프롬프트에는 앱의 제목·메타데이터 영역을 위해 하단 24%를 어둡고 저밀도로 남기도록 추가했다. 생성 결과는 원본 PNG를 보존한 채 WebP로 변환하고, 각 용도 규격에 맞춰 attention crop으로 정규화했다.

## 라운드와 선택지 컷

| 슬롯 | 시각적 사건 |
| --- | --- |
| `act1-bg` | 개강 강의실, 자신을 잊은 기훈이 연을 보고 멈추는 순간 |
| `act1-c1` | 연이 손을 청하고 접촉과 함께 첫 기억 조각이 돌아옴 |
| `act1-c2` | 연이 퀘스트를 지우고 기훈을 피함 |
| `act1-c3` | 연이 혼자 홍실의 근원과 최초 소원을 추적함 |
| `act2-bg` | 달빛 아래 전생의 두 사람이 홍실로 연결된 기억 |
| `act2-c1` | 연이 전생의 기억을 끝까지 받아들임 |
| `act2-c2` | 연이 기억의 유입을 거부하고 손을 거둠 |
| `act2-c3` | 연이 반복을 깨고 기훈보다 먼저 앞으로 나섬 |
| `act3-bg` | 현대 캠퍼스, 기훈의 의심과 연의 침묵이 가까이 맞섬 |
| `act3-c1` | 연이 홍실과 전생, 자신의 소원을 전부 고백함 |
| `act3-c2` | 연이 혼자 감당하며 밤새 자료 앞에 남음 |
| `act3-c3` | 두 사람이 평범한 학기를 다시 이어 감 |
| `act4-bg` | 홍실바위에서 마지막 선택을 앞둔 두 사람 |
| `act4-c1` | 손을 맞잡고 기훈의 기억을 전부 돌려줌 |
| `act4-c2` | 홍실을 풀어 기훈을 완전히 놓아줌 |
| `act4-c3` | 기억과 홍실 없이 서로를 다시 마주 봄 |

## 엔딩 컷과 카드 변주

| 번호 | 제목 | 주된 카드 이미지 |
| ---: | --- | --- |
| 01 | 두 번째 첫사랑 | 되찾은 기억 속에서 다시 맞잡은 손과 선명한 홍실 |
| 02 | 돌려주고 물러서다 | 기억의 빛을 돌려준 뒤 혼자 물러나는 연 |
| 03 | 전부 말한 다음에 | 진실을 상징하는 cyan과 홍실이 함께 놓인 대면 |
| 04 | 이름만 돌려주다 | 일부 기억만 돌아온 채 나란히 걷는 두 사람 |
| 05 | 내가 견딜 수 없어서 | 연의 절박한 포옹과 감정을 감싸는 홍실 |
| 06 | 네가 고르게 하려고 | 열린 손으로 기다리고 기훈이 스스로 다가오는 순간 |
| 07 | 끊고도 남은 자국 | 도서관의 연에게만 남은 붉은 잔광 |
| 08 | 깨끗한 단면 | 졸업 계절, 서로 반대 방향을 보는 두 사람과 무마법 화면 |
| 09 | 끊기 전에 다 말했다 | 홍실바위에서 진실의 cyan 리본이 사라지는 대화 |
| 10 | 말하지 않고 끊다 | 버스에 오르는 기훈과 뒤에서 빛을 숨긴 연 |
| 11 | 나를 위해 끊다 | 어두운 복도에서 밝은 아침으로 혼자 걸어 나가는 연 |
| 12 | 네 인생을 돌려주다 | 그늘의 연과 빛을 향해 걷는 기훈, 손 위의 마지막 잔광 |
| 13 | 홍실 없이도 | 마법 없이 카페에서 다시 서로에게 끌리는 두 사람 |
| 14 | 천천히, 처음부터 | 간격을 남기고 은행나무 길을 함께 걷는 첫 산책 |
| 15 | 고백부터 다시 | 마법 없이 먼저 고백하는 연과 기뻐하는 기훈 |
| 16 | 모르는 사람으로 다시 | 학과 오리엔테이션에서 평범하게 나누는 첫 악수 |
| 17 | 먼저 다가간 쪽 | 캠퍼스를 가로질러 먼저 손을 드는 연 |
| 18 | 혼자만 아는 재회 | 도서관 옆자리, 혼자만 익숙한 연과 새로 궁금해진 기훈 |
| 19 | 소원을 무르다 | 홍실바위에서 매듭을 풀고 기억을 남기는 HOLO 분광 |
| 20 | 몫을 바꾸다 | 비 오는 벤치, 기억의 빛을 품은 연과 자유롭게 웃는 기훈 |

13~18번은 기억과 홍실 없이 다시 시작하는 갈래이므로 의도적으로 붉은 실과 초자연 효과를 넣지 않았다. 19번은 lime/cyan/magenta 분광, 20번은 magenta/silver 반사광으로 일반 카드와 희귀도를 구분했다.

## 연결과 검증

- `art.ts`: 스토리의 56개 슬롯과 정적 파일 경로를 명시적으로 연결한다.
- `art.test.ts`: 슬롯 중복·누락, WebP 경로, 실제 파일 존재와 비어 있지 않은 크기를 검사한다.
- `pieces.tsx`: 슬롯 원화를 공통 렌더링하고, 엔딩 서사 컷과 카드 원화를 서로 다른 표면으로 표시한다.
