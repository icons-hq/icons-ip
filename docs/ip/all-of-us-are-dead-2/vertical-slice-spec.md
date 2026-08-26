# Last Bell 2챕터 vertical-slice spec

> 상태: full local/Preview candidate · 2026-08-25

## 플레이 계약

- 정확히 두 챕터이며 목표 pacing은 Chapter 1 425초, Chapter 2 175초다.
- 목표 시간은 이동 거리·탐색·좀비 조우·연출로 만든다. 월드 준비 뒤 문과 핵심 상호작용을 막는 wall-clock 타이머는 두지 않으며, 실제 첫 성공 플레이 5회 중앙값 `9:30~10:30`을 release gate로 사용한다.
- `main` 주 경로와 상품 3개가 있는 짧은 `detour`만 사용한다.
- 좀비는 공용 rig와 3개 외형 변형, 최대 동시 활성 2체다. 전투 없이 숨기·소리 유인·문 잠금·도주로 통과한다.
- 감염 복선은 비정상적인 힘, 좀비의 냄새 머뭇거림, 포획 충격 뒤 빠른 회복 세 번만 기록한다.
- Chapter 2 옥상 문 이후에는 좀비·수집 interaction·commerce-facing UI가 없어야 한다.

## semantic contract

- Chapter: `chapter-01 | chapter-02`
- Zone: `classroom | corridor | infirmary | broadcast | utility | stairwell | rooftop`
- Collectible: `idcard | badge | photo | radio | kit | zipup | archery | postcard | candle | blanket`
- Checkpoint: `ch1_first_bay | ch1_power | ch2_stairwell`
- Runtime event: `objective | pickup | checkpoint | capture | chapter_complete | game_complete`

모든 문·전원·소음 장치·사물함·상품·체크포인트는 같은 semantic interaction snapshot을 사용한다. 시각 mesh 이름이나 가격/상품 ID는 이 계약에 들어오지 않는다.

## 엔딩 순서

`옥상 문 → 모닥불/남라 접근 → 남라가 위험 변화 인지 → "너…" → "인간이 아니네." → 즉각 제압 → BLACK → 심장 정지 → 여러 사람의 계단 발소리/문 인기척` 순서를 바꾸지 않는다. 남라의 공격 전 플레이어의 맥박 고정·비자발적 전진을 먼저 보여준다. 옥상에 시체나 큰 혈흔을 남기지 않는다.

## 자산·성능

환경과 상품은 semantic anchor 뒤에서 교체 가능하다. GLB decode 실패 때만 기능적 fallback을 허용하고 정상 경로에서 authored와 fallback을 겹치지 않는다. 반복 rubble/가구는 instancing·공유 material을 사용하고, hero shadow는 flashlight·문·character로 제한한다. 목표는 desktop 60FPS, mobile 30FPS이며 전송 hard cap은 critical 25MiB, unique 75MiB, products 4MiB다.

## 서버 권위

`LocalRunHost` 완료는 구매권을 만들지 않는다. `VerifiedRunHost`는 server-canonical resume stage와 pending key만 복원하며, 모든 event를 sequence/operation id로 직렬화한다. verified gate가 꺼지면 page뿐 아니라 run·event·complete·claim·inventory API도 404로 닫힌다. 계정 기반 mutation과 guest claim은 정지·탈퇴 write fence·온보딩을 DB와 API에서 다시 검사한다. 서버는 전체·직전 milestone의 server-observed 물리적 최소 전이 시간을 검사해 불가능한 event burst를 거절한다. 이 하한은 10분을 강제하는 페이싱 장치가 아니고 좌표나 입력의 암호학적 이동 증명도 아니다. 서버가 엔딩 또는 replay chapter exit를 확정하기 전 인벤토리와 매점에 구매권 완료 상태를 표시하지 않는다. 클라이언트는 `good_id`를 전송하지 않는다.
