# 투신전생기 서바이벌 프로토타입 명세

> 상태: approved prototype specification
>
> 범위: 내부 개발·테스트용 first playable
>
> 제품 연결: 비활성(`physicalRewardsEnabled = false`)
>
> 기준일: 2026-08-14

## Problem Statement

온라인 팝업은 IP를 둘러보는 데서 끝나지 않고, 짧은 참여형 게임에서 획득한 점수·중간보스 처치·최종보스 클리어·스피드런 기록을 이후 굿즈 구매 경험과 연결할 수 있어야 한다. 첫 콘텐츠는 《투신전생기》지만 같은 게임 구조를 다른 IP에도 반복 적용해야 하므로, 엔진에 제피르·특전·장비·서사가 섞이면 안 된다.

현재 저장소의 참여형 게임은 서버가 보상을 먼저 결정하고 클라이언트가 결과를 재생하는 마블 룰렛 계약이다. 플레이 실력이 결과를 만드는 7~8분짜리 bullet-heaven 런, 점수 검증, 보스 split, 재생 검증, 차등 보상에는 이 one-shot 계약을 그대로 사용할 수 없다. 첫 playable은 공통 엔진과 《투신전생기》 콘텐츠 팩의 경계를 증명하면서도 실제 지급·재고·결제로 넘어가지 않는 안전한 내부 프로토타입이어야 한다.

## Solution

이 프로토타입은 이동 중심 자동공격, 시간 웨이브, 경험치 레벨업, 무기·패시브 조합, 상자 진화라는 공개 장르 문법을 새 코드·수치·표현으로 구현한다. 공통 엔진은 중립적인 데이터 계약과 제한된 행동 모듈만 제공하고, 《투신전생기》 팩은 캐릭터·무기·패시브·적·보스·웨이브·점수값·서사·신규 도트 에셋을 공급한다.

한 런은 6분 일반 구간 뒤 일반 웨이브와 스테이지 타이머를 멈추고 최종보스전으로 전환한다. 최종보스를 처치해야만 클리어이며, 보스전의 목표 길이는 60~90초다. 결과 화면은 검증 가능한 raw score, 중간보스 milestone, 최종보스 split, 전체 빌드와 mock 보상 티어를 보여준다.

first playable의 보상은 전부 모의 결과다. `physicalRewardsEnabled`는 코드와 콘텐츠 양쪽에서 `false`로 고정하고, 구매 권한·실물 굿즈·카드·재고·주문·결제 RPC를 호출하지 않는다. 실제 보상 전환은 별도 production ADR, 법무·등급·재고·부정행위·이의제기 설계를 승인한 후의 후속 범위다.

## User Stories

1. 내부 플레이어로서 키보드 또는 터치 스틱 하나로 캐릭터를 이동하고 자동공격에 집중하고 싶다. 그래야 복잡한 버튼 조작 없이 즉시 플레이할 수 있다.
2. 내부 플레이어로서 적을 처치해 경험치를 모으고 세 가지 성장 후보 중 하나를 고르고 싶다. 그래야 짧은 런에서도 빌드를 설계하는 재미가 생긴다.
3. 내부 플레이어로서 무기 6칸과 패시브 6칸을 채우고 대응 조합을 진화시키고 싶다. 그래야 첫 버전에서도 완성된 성장 문법을 검증할 수 있다.
4. 내부 플레이어로서 6분 동안 강해지는 웨이브와 중간보스를 상대하고 싶다. 그래야 생존·점수·보스 milestone이 한 런에서 연결된다.
5. 내부 플레이어로서 6:00 이후 별도 최종보스전을 치르고 직접 처치해야 클리어하고 싶다. 그래야 시간 도달과 실제 승리가 구분된다.
6. 기록 경쟁 참여자로서 raw score와 최종보스 split을 결과 화면에서 확인하고 싶다. 그래야 같은 빌드의 개선점을 비교할 수 있다.
7. 기록 경쟁 참여자로서 최근 로컬 leaderboard에서 내 기록의 순위를 보고 싶다. 그래야 배포 전에도 점수·스피드런 UX를 검증할 수 있다.
8. 모바일 플레이어로서 화면 어디서든 시작되는 floating touch stick을 사용하고 싶다. 그래야 손 크기와 화면 비율에 맞춰 이동할 수 있다.
9. 감각 민감 사용자로서 깜빡임·화면 흔들림·피 표현·피해 숫자·음량을 따로 조절하고 싶다. 그래야 12세 목표 표현 안에서 편안하게 플레이할 수 있다.
10. 콘텐츠 디자이너로서 공통 효과 블록과 제한된 확장 모듈을 조합해 다른 IP 팩을 만들고 싶다. 그래야 엔진을 복제하거나 IP별 분기를 늘리지 않아도 된다.
11. IP 감수자로서 모든 이름·설명·효과·에셋의 출처 등급을 확인하고 싶다. 그래야 캐논, 라이선스 콜라보, 미검증 2차 자료와 게임 오리지널 설정을 혼동하지 않는다.
12. 게임 밸런서로서 고정 seed, 무작위 seed, 무적, 배속, 보스 직행과 성능 계측을 사용하고 싶다. 그래야 7~8분 전체를 매번 반복하지 않고 재현 가능한 테스트를 할 수 있다.
13. 엔진 개발자로서 같은 seed와 입력 로그를 replay했을 때 동일한 점수·보스 상태·결과 digest를 얻고 싶다. 그래야 향후 서버 권위 검증으로 옮길 수 있다.
14. 제품 운영자로서 프로토타입 보상이 실제 구매 권한이나 실물 굿즈로 오인되지 않기를 원한다. 그래야 내부 테스트가 재고·주문·법적 약속을 만들지 않는다.
15. 제품 운영자로서 점수·중간보스·최종보스·스피드런 조건을 독립적인 보상 규칙으로 표현하고 싶다. 그래야 IP와 캠페인마다 보상 사다리를 교체할 수 있다.
16. QA 담당자로서 《투신전생기》 고유명사가 없는 도형 기반 테스트 팩으로 같은 런을 실행하고 싶다. 그래야 엔진과 콘텐츠 팩의 분리를 자동으로 검증할 수 있다.
17. 아트 담당자로서 승인된 IP 제안서를 시각 근거로 삼아 새 도트 에셋을 생성하고 싶다. 그래야 원본 디자인 정체성을 유지하면서 타 게임 에셋을 복제하지 않는다.
18. 다른 IP 담당자로서 캐릭터·맵·무기·패시브·보스·테마만 교체해 같은 게임을 만들고 싶다. 그래야 온라인 팝업마다 재사용 가능한 상품이 된다.

## Implementation Decisions

### 1. 목적과 비목표

목적은 다음과 같다.

- 공통 bullet-heaven 엔진과 첫 《투신전생기》 콘텐츠 팩의 분리 증명
- 데스크톱과 모바일 브라우저에서 동작하는 7~8분 first playable
- 6 active, 6 passive, 6 evolution을 포함한 빌드 루프 검증
- 점수, 중간보스 milestone, 최종보스 clear, boss split과 raw leaderboard 검증
- 향후 서버 검증이 가능한 deterministic replay seam 확정
- 상품 연결 UX를 실제 지급 없이 mock reward ladder로 검증

다음은 이 프로토타입의 비목표다.

- Supabase 스키마, `play_game`, `game_plays`, `grant_cards`, 뽑기권, 굿즈 재고, 주문, 결제와의 연결
- 실제 구매 권한·할인·무료 실물 굿즈·배송 claim 발급
- production leaderboard와 부정행위 판정
- 계정 기반 영구 강화, 재화, 캐릭터 해금, 도감, Arcana, Limit Break, Endless, 협동
- 원작 전체 등장인물·장비·보스·스토리 구현
- 다른 상용 게임의 코드·에셋·수치·UI를 호환 수준으로 재현하는 것

### 2. Clean-room 경계

참조할 수 있는 것은 이동 중심 전투, 자동·주기 공격, 시간 기반 군집 웨이브, 경험치 픽업, 정지형 레벨업 선택, 제한 슬롯, 무기+패시브 진화, 보스 보상, 런 결과처럼 공개적으로 관찰되는 장르 문법이다.

다음은 금지한다.

- poncle 코드, 바이너리, 번들, 저장 파일, 네트워크, 내부 테이블의 디컴파일·추출·포팅
- 정확한 XP 곡선, 무기 수치, 진화표, 웨이브표, 적 budget, 드롭률, 상자 확률 복사
- 캐릭터·무기·적·보스의 이름, sprite, tile, 아이콘, 로고, 폰트, 음악, SFX, VFX, 문구 복사
- 공식 스크린샷의 픽셀 배치·색·비율·연출 타이밍을 그대로 모사
- 타 게임 스크린샷이나 추출 에셋을 image generation의 직접 입력으로 사용
- `Reaper`, `White Hand`, `Arcana` 같은 고유 표현을 공통 엔진 기능명으로 사용

《투신전생기》 에셋은 권리 승인된 제안서와 검증된 IP 자료를 시각 근거로 새로 만든다. 도트 캐릭터 기준은 3.5등신, 기본 frame box 64×80, 4방향 이동이며 무기와 VFX는 캐릭터 본체에서 분리한다. 생성 에셋은 image generation 결과와 필요 시 chroma-key 후처리를 사용하고 provenance를 남긴다.

### 3. 공통 엔진과 IP 팩의 경계

공통 엔진은 다음 중립 계약을 소유한다.

- run state machine, fixed stage clock, pause와 modal 전환
- 키보드·방향키·floating touch stick을 통합한 `MoveIntent`
- wave budget, spawn schedule, 일반 적·중간보스·최종보스 encounter
- 충돌, 피해, 상태이상, 경험치, pickup magnet, level curve
- 자동 무기 scheduler, target policy, projectile pooling, hit resolution
- 무기·패시브 슬롯, offer resolver, chest, recipe graph
- raw score, boss milestones, speedrun split, result digest
- replay command log, debug controls, telemetry, accessibility 설정
- mock reward evaluator와 fail-closed reward port

first playable의 필드 렌더링은 Canvas2D를 사용하고, 게임 판정은 spatial hash/AABB 기반의 결정론 simulation으로 둔다. 기존 마블 연출의 Box2D 물리는 이 게임 판정에 사용하지 않는다. 프로토타입은 `ICONS_PROTOTYPE=1`에서만 노출하고 일반 게임 카탈로그에는 등록하지 않는다.

콘텐츠 팩은 다음 데이터를 공급한다.

- 캐릭터 기본 스탯, 시작 무기, sprite와 portrait
- active·passive·evolution 정의와 각 레벨 데이터
- 적 archetype, 중간보스, 최종보스, AI 파라미터, score value
- 맵 테마, 웨이브 timeline, drop table, XP curve, 상자 규칙
- UI theme token, 신규 SFX·BGM·VFX·컷인과 결과 문구
- mock reward threshold와 provenance metadata

공통 행동은 `projectile`, `orbit`, `aura`, `chain`, `pierce`, `status`, `summon` 같은 선언형 블록으로 조합한다. 선언형 블록으로 표현할 수 없는 IP 패턴은 엔진이 노출한 제한된 behavior module interface로만 추가한다. 엔진 내부에는 `Zephyr`, `WallOfIron`, `DragonHeart` 같은 IP 분기를 두지 않는다.

별도의 도형 테스트 팩이 동일 public engine seam을 사용한다. 이 팩이 제거되거나 《투신전생기》 타입을 import해야 동작한다면 분리 실패로 간주한다.

제피르의 마나, Debt, Dragon Output, 수동 액티브 스킬 같은 대표 고유 게이지는 넣지 않는다. 제피르의 차별성은 시작 무기, 스탯 modifier, 무기 패턴, 진화, 테마와 서사로 표현한다.

### 4. 첫 콘텐츠 팩

첫 playable은 제피르 1명, 최후의 전장을 표현한 맵 1개, 일반 적 archetype 4개, 2:00·4:00의 시간표 기반 중간보스 encounter 2개, 게임 오리지널 최종보스 `마신군 선봉장` 1개로 구성한다. 승리는 타르타로스 처치나 원작 결말 변경을 의미하지 않는다. 이는 회귀 전 마지막 전투의 한 구간을 게임용으로 재구성한 것이다.

밸런스 목표는 첫 플레이 클리어율 30~40%, 시스템을 이해한 플레이어의 클리어율 60~70%다. 이는 내부 playtest 표본으로 조정하는 목표이며 개인별 보상 확률을 뜻하지 않는다.

`tusin-survival-pack-v2`는 첫 레벨업 전의 학습 여백을 유지하고, 플레이어 레벨 2부터 wave cadence를 `0.6배`, budget을 `1.5배`로 적용한다. 따라서 opening pressure는 2마리/5초에서 3마리/3초로 바뀌며 이후 구간도 약 2.2~2.8배 밀도로 상승한다. 이 규칙은 IP 분기가 아니라 pack의 선택적 `spawnLevelScaling` 데이터로 선언한다.

높아진 밀도에 맞춰 6개 active와 6개 evolution은 피해·재사용 주기뿐 아니라 범위·관통·연쇄·지속시간을 함께 상향한다. 기본 검격의 `area`는 1레벨 560에서 5레벨 680으로 증가하고 철벽검로는 1,200이다. 모바일에서 검기 발사를 읽을 수 있도록 운룡등천과 그람의 이동 속도는 각각 180·200 world unit/tick, 대응 evolution은 240·260으로 낮추며 TTL을 늘려 유효 사거리를 유지한다. authoritative 수치가 바뀌므로 이전 replay와 구분되는 content version과 pack digest를 사용한다.

active weapon은 최대 5레벨, passive는 최대 3레벨이다. 한 런의 슬롯 상한은 active 6칸, passive 6칸이며 시작 무기도 active 슬롯을 차지한다. 모든 아이템은 프로토타입에서 처음부터 offer pool에 들어간다. 평균적인 성공 런에서 2~3개 evolution을 완성하도록 XP·상자·offer를 튜닝하며, 6개 진화가 항상 완성되도록 보장하지 않는다.

| Active weapon | Paired passive | Evolution | 출처 처리 |
|---|---|---|---|
| 기본 검격 | Wall of Iron | 철벽검로 | 무기·진화 동작과 명칭은 `original-game-design`; passive 모티프는 `ip-official-episode` |
| 운룡등천 | Hermes's Secret Skill | 신속운룡 | active 명칭은 감수 전 `licensed-collab-only`; 진화는 `original-game-design`; passive 모티프는 `ip-official-episode` |
| 빛의 검 | 정화의 반지 | 정화광검 | active 명칭은 감수 전 `licensed-collab-only`; passive·진화 효과는 `original-game-design` |
| 용살검 그람 | Dragon Heart | 레퀴엠 | 명칭 존재는 `licensed-collab-only`; 공격 동작·수치·recipe는 `original-game-design` |
| 낙뢰 | 회귀자의 기억 | 회귀천뢰 | 감수 전 명칭·효과 모두 `original-game-design` 또는 `secondary-unverified`로 분리 |
| 블랙 드래곤 체인 | 최후의 인간 | 최후의 용쇄 | 감수 전 명칭·효과 모두 `original-game-design` 또는 `secondary-unverified`로 분리 |

evolution의 기본 조건은 대응 active가 최대 레벨이고 paired passive를 1레벨 이상 보유한 상태에서 evolution 허용 상자를 여는 것이다. 중간보스 상자는 조건을 만족한 recipe를 우선하고, 조건이 없으면 보유 장비를 강화한다. 모든 동작·수치·recipe는 타 게임 수치를 복사하지 않고 이 6분 성장곡선에 맞춰 새로 튜닝한다.

### 5. 런 상태기계

```text
PRELOAD
  -> READY
  -> RUNNING_0_TO_6M
       <-> LEVEL_UP_MODAL
       <-> CHEST_MODAL
       -> PLAYER_DEAD -> RESULTS_LOSS
       -- stageTick == 06:00 --> FINAL_BOSS_TRANSITION
  -> FINAL_BOSS_FIGHT
       -> PLAYER_DEAD -> RESULTS_LOSS
       -> FINAL_BOSS_DEAD -> RESULTS_CLEAR
  -> RESULTS
```

- `RUNNING_0_TO_6M`에서는 stage clock과 웨이브 timeline이 fixed tick으로 진행된다.
- level-up과 chest modal 동안 simulation과 stage clock은 멈추고, 선택 command가 기록된 뒤 재개한다.
- 중간보스는 pack timeline에 선언하며 처치 여부와 kill tick을 milestone으로 기록한다.
- 6:00에 일반 spawn을 중단하고 일반 적을 무득점·무드롭으로 정리한다. 이미 획득한 XP와 대기 중인 level-up/chest 선택은 결정적으로 정산한 뒤 보스전으로 넘어간다.
- final transition 후 stage clock은 6:00에 고정하고 별도 `bossFightTicks`를 센다.
- 최종보스전의 밸런스 목표는 60~90초이며 일반 웨이브는 재개하지 않는다.
- 6:00 도달은 최종보스전 진입 조건일 뿐 성공이 아니다. 최종보스 HP가 0이 되어야 `RESULTS_CLEAR`다.
- 최종보스 처치 전에 플레이어 HP가 0이 되면 6:00을 넘겼더라도 실패다.

이 결정은 조사 문서의 이전 `6:00 생존 성공 후 termination event` 결론을 supersede한다. 조사 문서는 장르 연구 근거로 유지하지만, first playable 종료 계약의 진실원은 이 명세다.

### 6. 점수, 보스, 스피드런

엔진은 클라이언트가 임의로 보낸 요약값이 아니라 simulation event에서 raw score를 누적한다.

```text
rawScore = sum(defeatedEnemy.scoreValue)
         + sum(defeatedMidBoss.killBonus)
         + finalBossKillBonus
         + clearBonus
         + noHitBonus
         + max(0, speedBonusBase - bossFightTicks * speedBonusPerTick)
```

first playable의 원본 튜닝값은 `clearBonus = 4,000`, `noHitBonus = 2,000`, `speedBonusBase = 5,400`, `speedBonusPerTick = 1`이다. 이 값은 mock 보상 threshold를 검증하기 위한 게임 내부 점수이며 상품 가격·경품 가치·당첨 확률을 나타내지 않는다.

- 일반 적 transition despawn, debug kill, 무적 debug 중 발생한 결과에는 점수를 주지 않는다.
- 중간보스별 `spawnTick`, `killTick`, `killBonus`를 기록한다.
- 최종보스 speedrun 기록은 `bossSplitTicks = finalBossKillTick - finalBossSpawnTick`이다.
- `completionTicks`는 일반 6분 tick과 boss split을 합친 값이다.
- 결과에는 raw score, 생존/클리어, 중간보스별 split, 최종보스 split, 처치 수, 레벨, 빌드, 무기별 피해를 포함한다.

first playable의 기본 런은 매번 host가 생성한 무작위 seed를 사용한다. debug mode에서만 seed를 직접 고정할 수 있다. 로컬 score leaderboard는 seed 난이도를 보정하지 않은 `rawScore DESC`, `clear DESC`, `bossSplitTicks ASC`, `completionTicks ASC`, `recordedAt ASC` 순으로 정렬한다. speedrun view는 최종보스를 처치한 기록만 대상으로 `bossSplitTicks ASC`, `rawScore DESC`, `completionTicks ASC`, `recordedAt ASC` 순으로 정렬한다.

무작위 seed 간 raw score 비교는 완전한 경쟁 공정성을 제공하지 않는다. 따라서 이 leaderboard는 내부 밸런싱·UX용이며 실제 구매권이나 실물 보상의 근거가 될 수 없다. production 순위 보상을 도입할 때는 캠페인 공통 seed, seed cohort 또는 검증된 난이도 정규화 중 하나를 새 ADR에서 결정해야 한다.

### 7. Deterministic replay 계약

runtime, replay, 자동 테스트는 하나의 가장 높은 public seam을 공유한다.

```text
runRecordedCommands(versionedPack, seed, recordedRun) -> ReplayStatus + RunResult + stateDigest
```

replay header는 replay schema version, engine version, content pack version/hash, seed, simulation rate를 가진다. `recordedRun`은 마지막으로 기록한 simulation tick 경계와 command log를 함께 가지며, command log는 tick과 함께 이동 벡터 변경, level-up 선택, chest 선택, pause/resume 같은 사용자 의도만 기록한다. 적 처치·점수·보스 HP처럼 simulation에서 다시 계산할 수 있는 사건은 권위 입력으로 저장하지 않는다.

- simulation은 60Hz fixed tick을 사용하고 rendering cadence와 분리한다.
- simulation 안에서 `Math.random`, wall clock, frame delta, device pixel ratio를 사용하지 않는다.
- PRNG algorithm과 random stream namespace를 versioning한다. spawn, offer, drop, weapon 같은 stream을 분리해 호출 순서 변경의 파급을 제한한다.
- 입력 벡터는 정해진 정밀도로 양자화하고 command sequence를 안정적으로 직렬화한다.
- 같은 version/hash, seed, command log는 플랫폼과 rendering FPS에 관계없이 같은 state digest와 RunResult를 내야 한다.
- 결과 화면의 score와 mock tier는 RunResult에서만 파생한다.

프로토타입 replay는 로컬 검증과 테스트에 사용한다. production 보상에서는 브라우저 로그를 신뢰하지 않고 서버가 start/checkpoint/finish 세션, 서버 seed, append-only input chunks와 receipt chain을 받은 뒤 동일 headless engine으로 전수 replay해야 한다. 이 production 세션·저장소·validator queue는 현재 구현 범위 밖이다.

### 8. Mock reward ladder와 물리 보상 게이트

mock reward는 하나의 최고 티어로 합쳐지지 않는다. 점수, 각 중간보스, 최종보스, 스피드런은 서로 다른 규칙이며 충족한 규칙을 누적 표시한다. 같은 규칙은 사용자·캠페인당 한 번만 발급되는 production 계약을 가정하되, first playable에서는 로컬 mock award로만 시뮬레이션한다. 아래 threshold와 수량은 튜닝용 seed data이며 상품 약속이 아니다.

| Rule | 검증 조건 | 화면에 보이는 mock 결과 |
|---|---|---|
| SCORE_BRONZE | raw score 10,000 이상 | 테스트 디지털 카드 + 프로필 배지 |
| SCORE_SILVER | raw score 25,000 이상 | 테스트 디지털 카드 + 프로필 배지 |
| MIDBOSS_ONE | 첫 중간보스 처치 | 테스트 한정 굿즈 구매 접근권 |
| MIDBOSS_TWO | 두 번째 중간보스 처치 | 테스트 한정 굿즈 구매 접근권 |
| FINAL_BOSS | 최종보스 클리어 | 테스트 재고보장 정가 구매권(24시간) |
| SPEEDRUN_TOP_N | 클리어 기록의 provisional Top-N | 테스트 무료 실물 굿즈 후보 |

스피드런 mock은 캠페인 종료와 72시간 검수·이의 기간 전까지 `잠정`으로 표시하고, 수령 7일·미수령 차순위 승계·운영자 배송비 부담이라는 합의된 운영 상태를 UI에서만 시뮬레이션한다. random seed raw 비교를 그대로 쓰므로 luck 차이가 있으며, production 실물 지급 근거로 승격할 수 없다.

모든 mock 결과에는 `테스트 보상 · 실제 지급되지 않음`을 표시한다. threshold와 문구는 pack data지만, 실제 fulfillment 동작은 pack이 정의할 수 없다.

`physicalRewardsEnabled`는 first playable에서 항상 `false`다.

- query parameter, localStorage, replay payload, content pack, debug menu로 true로 바꿀 수 없다.
- `purchase_access`, `physical_goods`, `inventory_reservation`, `checkout`, `shipping_claim` 요청은 fail closed한다.
- Supabase, 기존 `play_game`, 카드 발급, 굿즈 할당 재고, 주문·결제 경로를 호출하지 않는다.
- mock receipt는 서버 권리나 재고 예약을 나타내지 않고 로컬 테스트 기록으로만 존재한다.
- 설정 누락·파싱 실패·알 수 없는 reward kind는 보상 없음으로 닫는다.

### 9. 입력, 접근성, 표현

- 데스크톱은 WASD와 방향키를 지원한다.
- 모바일은 터치 시작 위치를 중심으로 생성되는 floating stick을 사용한다.
- 가로 화면을 우선하되 세로 화면에서도 이동·선택·결과 확인이 가능해야 한다.
- 일반 공격 버튼과 연타 입력은 없다. 플레이어의 주 입력은 이동과 modal 선택이다.
- 게임은 일시정지할 수 있고 키보드만으로 모든 필수 선택을 완료할 수 있어야 한다.
- 음악, SFX, 피해 숫자, 깜빡임, 화면 흔들림, 피 표현을 독립적으로 끌 수 있어야 한다.
- reduced-motion에서는 shake, 강한 flash, 급격한 zoom을 제거하거나 축소한다.
- 기본 표현은 검은 파편, 마력색, 실루엣 hit flash 중심이며 고어·절단을 사용하지 않는다.
- 한국 12세 목표는 표현 가이드일 뿐 등급을 보장하지 않는다.
- SFX와 적응형 전투 루프는 외부 음원 복제 없이 Web Audio와 신규 제작 자산을 사용한다.

### 10. 성능과 디버그

- desktop 목표: 적 1,000개와 투사체 1,500개가 활성인 stress scene에서 60fps 목표
- mobile 목표: 적 500개와 투사체 800개가 활성인 stress scene에서 60fps 목표
- 모바일이 frame budget을 넘기면 hit logic·spawn 결과는 유지하고 파티클, 그림자, 잔상, 피해 숫자 빈도 같은 코스메틱 VFX만 단계적으로 줄인다.
- entity, projectile, pickup, damage number는 pool을 사용하며 공간 질의는 전체 쌍 비교를 피한다.
- simulation 부하와 rendering 부하를 별도 계측한다.
- debug surface는 seed 표시/고정, 무적, 시간 배속, 6:00/최종보스 직행, XP 주입, FPS, entity/projectile/pickup 수, frame time, 최근 RunResult를 제공한다.
- debug가 활성인 런은 leaderboard와 mock reward ladder에서 제외한다.

### 11. 출처 provenance

모든 사용자-facing 이름·설명·효과와 모든 에셋 manifest는 다음 metadata를 가진다.

```text
class, sourceId, sourceUrl, sourceNote, reviewedAt, reviewer, originalDesignNotes
```

| Class | 의미 | 프로토타입 사용 규칙 |
|---|---|---|
| `vs-official-reference` | 공식 제품·공식 지원 문서에서 확인한 장르 구조 | 엔진 연구 근거로만 사용; 콘텐츠·수치·표현 복사 금지 |
| `ip-official-canon` | 한국 원작 공식 소개·권리자 설정 자료 | 캐릭터·관계·서사의 1차 근거 |
| `ip-official-episode` | 원작 공식 회차에서 직접 확인한 명칭·효과 | 확인 범위만 캐논으로 표시; 게임 수치는 새 설계 |
| `ip-official-localized` | 공식 번역판 명칭·설명 | 한국 원문 감수와 함께 사용 |
| `rights-approved-proposal` | 사용 승인을 받은 내부 제안서의 디자인·에셋 | 새 도트 에셋의 시각 근거; 원본 파일 출처와 변환 이력 보존 |
| `licensed-collab-only` | 공식 라이선스 콜라보 게임에서만 확인한 명칭·효과 | 존재의 보조 근거; 콜라보 수치·효과를 원작 캐논으로 승격 금지 |
| `secondary-unverified` | 팬 정리·2차 자료에만 있는 세부 | 내부 placeholder만 허용; 출시 전 감수 필요 |
| `design-proposal` | 첨부 리서치 문서가 제안한 규칙·수치 | 캐논이 아니라 기획 입력으로 취급 |
| `original-game-design` | 이 게임을 위해 새로 만든 명칭·효과·수치·recipe | 캐논과 분리 표시하고 IP 감수 대상에 포함 |
| `generated-original` | image generation과 후처리로 새로 만든 에셋 | 입력 근거, 생성 기록, 후처리와 최종 파일 hash 보존 |

한 레코드가 여러 근거를 가지면 각각을 배열로 기록한다. `secondary-unverified`만 있는 명칭을 출시용 캐논으로 표시하지 않는다. provenance가 없거나 출처가 충돌하면 internal placeholder로 fail closed한다.

### 12. 기존 제품 문서와의 관계

이 명세는 현재 accepted 문서를 조용히 변경하지 않는다. 다음 충돌·차이를 의도적으로 격리한다.

- `CONTEXT.md`는 참여형 게임을 “서버가 결과를 정하고 화면이 재생하며 보상은 무상 카드뿐”이라고 정의한다. 이 프로토타입은 플레이 입력으로 결과가 만들어지는 skill game이므로 production 도메인 용어 변경 또는 별도 용어가 필요하다.
- ADR-0002는 참여형 게임을 코스메틱 renderer로 두고 실물 굿즈는 래플 당첨자의 정가 구매권만 허용한다. first playable은 이를 침범하지 않도록 모든 상품 결과를 mock으로 유지한다.
- ADR-0003·0004는 카드의 무상 발급과 뽑기권 경계를 정한다. 프로토타입은 카드나 뽑기권을 발급하지 않는다.
- ADR-0005는 `goods.stock_qty`를 ICONS 할당 재고로 정한다. 프로토타입은 재고를 읽거나 선점하지 않는다.
- 현재 `play_game`/`game_plays`는 one-shot 서버 결과와 멱등 재생 원장이고 게임 type도 마블 룰렛에 잠겨 있다. skill-run 세션과 replay 검증을 이 계약에 억지로 추가하지 않는다.
- 장르 조사 문서의 `6:00 생존 성공 후 termination event` 결론은 후속 grilling에서 폐기됐다. 이 명세의 `6:00 최종보스 진입, 처치해야 clear`가 최신 결정이다.

production 연결 전에는 위 문서들의 변경 또는 superseding ADR이 승인되어야 한다. 이 프로토타입 명세 자체는 제품 정책을 변경하지 않는다.

### 13. 향후 production gate

다음 조건을 모두 충족하기 전에는 `physicalRewardsEnabled`를 true로 만들 수 없다.

1. skill-derived score와 실물/구매권의 관계를 정하는 새 ADR 승인
2. 무료 실물 경품, 정가 구매권, 할인, 순위 보상의 법무·약관·세무·청약철회·등급 검토
3. production 등급분류와 연령·지역 게이트 결정
4. server-issued seed와 start/checkpoint/finish 세션, append-only input log, headless deterministic replay validator 구현
5. 재전송·seed reroll·bot·clock manipulation·disconnect·다중 세션 위협 모델과 rate limit 구현
6. reward rule versioning, per-user/campaign cap, idempotent entitlement 원장 구현
7. ICONS 할당 재고 안에서 구매권·경품 수량을 원자적으로 선점·만료·복원하는 reservation 구현
8. checkout 또는 prize claim의 소유자 검증, 배송·만료·회수 상태기계 구현
9. 고가·희소 결과의 pending review, provisional leaderboard, 캠페인 종료 확정, 이의제기·수동 판정·감사 구현
10. production 공통 seed 또는 seed 공정성 정책과 leaderboard tie-break ADR 승인
11. 개인정보 최소수집·로그 보존·삭제 정책과 운영 runbook 승인
12. preview에서 fake inventory와 test entitlement를 사용한 end-to-end 공격·경합 검증 완료

## Testing Decisions

### 주 테스트 seam

가장 높은 public seam인 `createInteractiveRuntime(versionedPack, seed)`와 그 runtime이 만든 `recordedRun`을 받는 `runRecordedCommands(versionedPack, seed, recordedRun)`가 동일한 canonical simulation을 공유한다. 개별 private class나 frame별 내부 구현을 직접 단정하지 않고, 같은 입력이 만드는 replay status·RunResult·state digest와 사용자-visible 상태를 검증한다.

### 필수 자동 검증

- 같은 engine/content version, seed, command log를 반복 실행하면 RunResult와 state digest가 byte-for-byte 동일하다.
- 30/60/120fps rendering schedule이 달라도 simulation 결과가 같다.
- keyboard와 touch adapter가 같은 이동 의도를 만들면 같은 command log가 생성된다.
- 6:00 전에는 final boss가 나오지 않고, 6:00에 일반 웨이브·stage clock이 멈춘다.
- 6:00 도달만으로 clear가 되지 않으며 final boss kill에서만 clear가 된다.
- 보스전 중 플레이어 사망은 loss다.
- 일반 적 transition despawn과 debug action은 점수를 만들지 않는다.
- 두 중간보스 milestone, 최종보스 bonus, speed bonus가 raw score 식대로 합산된다.
- 무기 6칸·패시브 6칸 상한, active 5레벨·passive 3레벨 상한이 지켜진다.
- 6개 recipe 각각이 대응 active 최대 레벨+paired passive+허용 상자 조건에서만 발동한다.
- full slot, max level, eligible recipe 없음, 중복 offer 같은 경계에서 offer resolver가 유효한 후보 또는 명시된 fallback을 반환한다.
- 같은 점수의 leaderboard tie-break가 항상 같은 순서를 만든다.
- debug run은 leaderboard와 mock reward에서 제외된다.
- `physicalRewardsEnabled=false`에서 모든 외부 reward kind가 fail closed하고 네트워크·재고·주문 호출이 0회다.
- 도형 테스트 팩이 《투신전생기》 import 없이 같은 engine seam과 state machine을 통과한다.
- provenance 누락·미검증 단독 출처가 출시 가능 상태로 승격되지 않는다.
- flash/shake/blood/damage-number/audio 설정이 해당 표현만 바꾸고 simulation digest는 바꾸지 않는다.

### 수동·브라우저 검증

- 데스크톱 WASD/방향키와 모바일 floating touch stick으로 전체 런을 완료한다.
- 가로 우선과 세로 fallback에서 HUD, 세 가지 level-up 후보, pause, chest, results가 가려지지 않는다.
- 일반 구간, 중간보스, 6:00 transition, 60~90초 목표 최종보스전, clear/loss 결과를 각각 확인한다.
- stress scene에서 desktop 1,000/1,500과 mobile 500/800 entity/projectile 목표를 계측하고 VFX 단계 축소가 게임 판정을 바꾸지 않는지 확인한다.
- reduced motion, flash off, shake off, blood off, damage number off, music/SFX volume을 실제 화면과 소리로 확인한다.
- mock reward마다 테스트 표식이 보이며 구매·배송·재고 화면으로 이동하지 않는지 확인한다.

## First Playable Acceptance

다음을 모두 만족해야 first playable 완료로 본다.

1. 내부 prototype flag에서만 진입할 수 있고 일반 제품 카탈로그·보상 RPC에 영향을 주지 않는다.
2. 제피르 1명, 맵 1개, 일반 적 4 archetype, 중간보스 encounter 2개, 최종보스 1개가 신규 에셋으로 렌더링된다.
3. 키보드와 모바일 floating stick으로 이동하고 모든 무기가 자동 실행된다.
4. XP pickup, 3개 level-up offer, active 6칸, passive 6칸, chest와 6개 evolution recipe가 동작한다.
5. 평균 성공 런에서 2~3개 진화를 완성할 수 있다.
6. 6:00에 일반 웨이브와 stage clock이 멈추고 최종보스전으로 전환한다.
7. 최종보스를 처치해야만 clear이며 보스전 튜닝 목표가 60~90초 범위다.
8. 결과 화면에 raw score, 중간보스 milestone, final boss split, kill/level/build/weapon damage, mock reward tier가 표시된다.
9. 무작위 seed 기본 런과 debug 고정 seed 런이 모두 재생 가능하고 deterministic test가 통과한다.
10. 로컬 raw leaderboard가 결정적 tie-break를 사용하고 debug run을 제외한다.
11. 모든 mock reward에 실제 지급이 아니라는 표식이 있으며 `physicalRewardsEnabled=false`를 우회할 수 없다.
12. 접근성 토글과 desktop/mobile 성능 stress 목표를 검증한다.
13. 도형 테스트 팩이 동일 엔진으로 실행되어 multi-IP 재사용 경계를 증명한다.
14. 모든 콘텐츠와 에셋에 provenance metadata가 있고 clean-room 금지 항목이 포함되지 않는다.

## Out of Scope

- 실제 보상 세션·DB migration·RLS·RPC·validator worker
- 상품 구매 권한, 실물 굿즈 claim, 할당 재고 reservation, 주문·결제·배송
- production leaderboard, 공개 랭킹, 시즌, tournament seed, fraud scoring
- 멀티플레이·협동·PvP·서버 실시간 시뮬레이션
- 영구 재화·PowerUp·캐릭터 구매·계정 해금·Golden Egg 성격의 성장
- Arcana, Limit Break, Union, Gift, Morph, Endless, Hurry
- 앱스토어 제출·게임물 등급분류 신청·production 배포
- 제피르 외 플레이어블 캐릭터와 원작 전체 스토리 재현

## Further Notes

- 이 명세는 `docs/research/vampire-survivors-system-reference-2026-08-14.md`의 공개 장르 조사와 후속 grilling 결정을 함께 반영한다. 충돌 시 이 명세의 후속 결정이 우선한다.
- 첫 playable의 score value, mock threshold, boss HP는 제품 가격이나 경품 가치와 연결되지 않는 튜닝값이다.
- production에서는 모든 경제적 보상 런을 deterministic replay로 검증해야 한다. signed seed나 hash chain만으로 정상 플레이가 증명되지는 않는다.
- 실물 보상을 도입하면 mock tier 이름을 그대로 상품 약속으로 승격하지 않고, 승인된 캠페인 정책과 재고 snapshot에서 별도 entitlement를 생성한다.
- to-spec workflow의 issue 생성·`ready-for-agent` 라벨 적용은 이번 작업의 “새 명세 파일 하나만” 범위를 벗어나므로 수행하지 않는다.
