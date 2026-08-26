# 《지금 우리 학교는: 마지막 종》 게임 콘셉트

> 상태: 2챕터 구현 truth · 2026-08-25

## 프레임 제로와 시간

플레이는 **폭격 이후 밤, 시즌 1 마지막 옥상 재회 직전**의 파괴된 효산고에서 시작하고 끝난다. 과거 발병일이나 수개월 경과를 다시 연출하지 않는다. 플레이어는 드라마 화면 밖에 있던 이름 없는 제3의 학생이며 자신을 인간이라고 믿지만, 세 개의 제한된 복선과 남라의 최종 인지로 그 믿음이 뒤집힌다.

## 10분 구조

| 챕터 | 목표 시간 | 핵심 경험 |
| --- | ---: | --- |
| Chapter 1 `죽은 학교` | 7분 05초 | 파괴된 교실·복도·샛길, 문 열기/통과/닫기/잠금, 전원·소음 장치·종, 최대 2체의 잠입형 좀비, 상품 8개 |
| Chapter 2 `옥상의 불빛` | 2분 55초 | 죽은 계단실, 상품 2개, 옥상 문 체크포인트, 모닥불과 남라, BLACK 뒤 여러 사람의 발소리 |

첫 성공 플레이의 목표 중앙값은 인트로·엔딩 포함 9분 30초~10분 30초다. 좀비는 `patrol → investigate → search → chase → capture`를 사용하며 처치·전투·HP·무기·플레이어 손은 없다. 한 개의 주 경로와 5~10초짜리 탐색 샛길만 둔다.

옥상 문을 열면 좀비·수집품·구매 UI가 사라진다. 남라는 플레이어의 위험한 변화가 먼저 드러난 뒤 제압하므로 악역으로 표현하지 않는다. 대사 `너…`, `인간이 아니네.`는 컴포넌트가 아니라 교체 가능한 한국어 primary narrative data에 있다. 시체·큰 혈흔 없이 BLACK으로 끝내고, 원작 주인공 일행은 모습·실제 대사 없이 계단 발소리와 문 인기척으로만 암시한다.

## 수집과 권위

10개 상품은 stable collectible key로만 시뮬레이션에 노출한다. 8개는 Chapter 1, 2개는 옥상 문 전 계단실에 있고, 손전등 반사·실루엣·근거리 prompt로 발견한다. 가격·재고·`good_id`는 런타임에 없다.

- `/games/prototype-last-bell`: `LocalRunHost`, QA 전용, 구매권 없음.
- `/experiences/all-of-us-are-dead/last-bell`: `VerifiedRunHost`, gate된 서버 검증 후보.
- 첫 플레이는 엔딩, 재플레이는 해당 챕터 출구에서 실제 수집품만 vest한다.
- 스토리 구매권은 할인·재고 예약·카드 보상·경품이 아니다. 판매 기간과 기존 커머스 규칙을 그대로 따른다.

## 자산 원칙

사용자가 제공한 실제 효산고 드라마 프레임은 공간·손상·조명·동선의 design truth이지만 source pixel은 delivery asset에 복사하지 않는다. 환경·상품은 Blender authored GLB, PBR 재질, Meshopt와 필요한 KTX2를 사용한다. 10개 상품의 ImageGen lookdev에는 배우 얼굴·드라마 스틸·문자를 넣지 않고, 실제 thumbnail은 delivery GLB를 같은 카메라에서 렌더한다.

좀비 공용 rig/3개 외형과 `character.namra.rooftop`은 교체 seam을 유지한다. 현재 character delivery는 기술적으로 mount 가능한 non-likeness 자산이며 최종 라이선스 캐릭터 art·animation 검수 전 production character로 간주하지 않는다.
