# Last Bell 2챕터 구현 계획

> 상태: implemented candidate · 2026-08-25
>
> 고품질 3D scene·asset·interaction 작업은 [`high-fidelity-3d-game-workflow.md`](../../agents/high-fidelity-3d-game-workflow.md)의 공용 제작·검수 루프를 따른다.

## 구현 단위

1. React state 밖 `LastBellSimulation`이 30Hz fixed step으로 이동, 문, AI, 빛·소음 인지, 수집, 체크포인트, 2챕터 pacing과 엔딩 sequence를 소유한다.
2. R3F는 snapshot만 그린다. 기존 authored entry/start-room/first-bay와 확장 route, 10개 상품 delivery GLB, 공용 좀비 rig, rooftop/Namra seam을 semantic anchor로 mount한다.
3. 입력은 `E/F/Q/C/Shift/Tab`, 터치 동등 조작을 사용한다. 인벤토리·pause·WebGL context loss 때 시뮬레이션, 카메라, gameplay audio를 함께 멈춘다.
4. `DoorSystem` snapshot 하나를 player collision, zombie nav, LOS, visual door가 공유한다. 세 체크포인트는 `ch1_first_bay`, `ch1_power`, `ch2_stairwell`이다.
5. local QA와 verified candidate를 `LastBellRunHost`로 분리한다. 검증 후보 API는 run start/resume, ordered event, complete, guest claim, inventory 조회만 제공한다.
6. DB는 catalog version과 collectible→good 매핑을 pin하고, cart DML·merge·order에서 `story_entitlement`를 재검증한다. payment/reconcile/finalizer는 기존 Korpay seam을 변경하지 않는다.
7. 목표 재생 시간은 경로 길이·상호작용·조우·cinematic으로 조정한다. `activeSeconds`는 QA telemetry일 뿐 objective unlock 조건이 아니며, 서버 시간은 event burst 방지용 물리적 하한으로만 사용한다.

## 자산·전송 계약

- 오프닝 critical pack: 목표 18MiB, hard cap 25MiB.
- 첫 플레이 unique transfer: 목표 55MiB, hard cap 75MiB.
- 10개 상품 shelf pack: 목표 4MiB.
- portal 진입 전 다음 zone을 prefetch하고 두 zone 뒤 GPU 자산은 해제한다.
- 상품은 lookdev → Blender → GLB/Meshopt/KTX2 검증 → delivery GLB thumbnail render → hash/provenance manifest 순서다.
- 대사, 캐릭터, animation, sound cue, 상품 그래픽은 scene mesh와 분리한다.

## Skull Hotel에서 채택한 패턴과 경계

[Skull Hotel](https://github.com/JamesHall38/skullhotel.io)은 구현 아이디어의 비교 기준으로만 사용한다. 소스·모델·음원은 복사하지 않고 아래 패턴을 Last Bell 계약에 맞춰 독립 구현했다.

- [`Movement.jsx`](https://github.com/JamesHall38/skullhotel.io/blob/master/src/components/Player/Movement.jsx)의 카메라 상대 입력 통합 아이디어 → 모든 입력 장치가 `movementBasisFromFacing()` 한 함수를 사용한다.
- [`useDoor.js`](https://github.com/JamesHall38/skullhotel.io/blob/master/src/hooks/useDoor.js)의 명시적 문 상태 아이디어 → `DoorSnapshot` 하나를 player collision, zombie nav, LOS, visual animation이 공유하고 점유 중 닫힘을 중단한다.
- [`useMonsterLogic.js`](https://github.com/JamesHall38/skullhotel.io/blob/master/src/hooks/useMonsterLogic.js)의 waypoint·은신처 연계 아이디어 → renderer 밖 `EncounterDefinition`이 trigger, actor, spawn, waypoint, positional audio cue, 실제 hiding spot, success exit를 소유한다.
- [`useProgressiveLoad.js`](https://github.com/JamesHall38/skullhotel.io/blob/master/src/hooks/useProgressiveLoad.js)의 단계적 로딩 아이디어 → 현재 zone과 다음 portal만 prefetch하고 두 zone 뒤 GPU lease를 해제한다.
- [`VolumeAwarePositionalAudio.jsx`](https://github.com/JamesHall38/skullhotel.io/blob/master/src/components/VolumeAwarePositionalAudio.jsx)의 위치 기반 음향 아이디어 → zombie root positional source와 동일 door/collider 차폐 snapshot으로 감쇠·low-pass를 계산한다.

랜덤 방 생성, React/Zustand gameplay authority, Electron·Firebase 구성은 가져오지 않는다. Last Bell의 authoritative simulation은 30Hz `LastBellSimulation`, commerce authority는 service-only Supabase RPC로 유지한다.

## 완료 검증

- 5/15/30/60/120Hz와 200ms stall 결정론.
- 좀비 벽/잠긴 문 통과 금지와 빛·소리·은신 상태 전이.
- 문 open→cross→close→lock, 세 checkpoint retry, Chapter 2 독립 재시작.
- 10개 상품 anchor/asset/hash와 서버 catalog key 일치.
- 로그인·게스트 claim·중복·다중 탭·만료 및 cart/merge/order 우회 차단.
- 1280×720, 844×390, 390×844의 HUD/포인터/터치/인벤토리.
- 실제 첫 성공 플레이 5회 중앙값 `9:30~10:30`; 핵심 상호작용을 막는 timer gate 없음.
- `npm test`, typecheck, lint, build, Supabase local reset/SQL suite, asset validator, `git diff --check`.

## 배포 경계

이 구현 범위는 로컬과 Preview 검증 후보까지다. commit, push, PR, production DB 적용, 실결제, 배포, production 상품 gate 활성화는 별도 승인 없이는 수행하지 않는다.
