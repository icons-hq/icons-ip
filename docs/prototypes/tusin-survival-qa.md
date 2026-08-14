# 투신전생기 서바이벌 프로토타입 QA 기록

> 상태: 내부 first playable 검증 완료
>
> 검증일: 2026-08-14
>
> 제품 연결: 비활성(`PHYSICAL_REWARDS_ENABLED = false`)

## 검증 환경

- Next.js 16.2.9 개발 서버, `ICONS_PROTOTYPE=1`
- Chromium, 360×800·720×900·1199×900·1440×900 반응형 경계
- 60Hz 고정 simulation과 Canvas2D renderer
- 생성 도트 에셋은 private asset route로만 로드

`ICONS_PROTOTYPE`은 라우트 노출 플래그이지 사용자 인증이 아니다. 현재 asset route의 `private`는 캐시 정책과 서버 파일 격리를 뜻하며, 플래그가 켜진 배포의 URL 접근자를 인증하지 않는다. 공유 preview로 올릴 때는 Vercel Deployment Protection 또는 페이지·asset route 양쪽의 staff 인증을 먼저 추가한다.

브라우저 캡처는 Git에 포함하지 않는 Codex visualization 출력에 보존한다. game-feel pass의 최종 확인 캡처는 1440×900 일반 검격, 360×800 floating stick 이동·검격, 최종보스 대기·붕괴·결과 reveal 순서다.

## 실제 플레이 흐름

| 흐름 | 확인 결과 |
|---|---|
| 시작 화면과 seed | 무작위 seed 생성, 동일 seed 재도전, 실제 보상 비활성 안내 확인 |
| 키보드 이동·자동공격 | 캐릭터 이동과 60Hz 자동공격 진행 확인 |
| 모바일 이동 | 화면 임의 지점에서 floating stick 생성, 드래그 방향 이동, 손을 떼면 해제 확인 |
| 액션 sprite | 4방향별 idle·run 2프레임과 검격 anticipation·impact·recovery가 실제 이동·공격 상태에 맞춰 바뀜을 확인 |
| 투사체 표현 | 6종 무기를 cleave·비행체·orbit·heavy projectile·chain·aura로 분리하고 startup·active·impact·afterglow를 확인 |
| 타격 피드백 | 실제 HP delta 피해 숫자, 피격 pose·recoil, 충돌 잔광, 카메라 impulse, 화면 flash, 무기별 WebAudio cue 연결 확인 |
| 사망 피드백 | 일반 적과 최종보스의 별도 붕괴 frame을 확인하고, 결과·점수 compact banner와 접근성 알림은 즉시 노출한 채 상세 패널만 780ms 뒤 확장함을 확인 |
| 레벨업 | simulation 정지, 3개 선택지, 현재 active/passive와 점수 표시, 선택 후 재개 확인 |
| 상자 | 상자 모달, 보유 장비 강화와 진화 판정 경로 확인 |
| 일시정지 | 음량과 플래시·흔들림·피해 숫자·붉은 파편·움직임 줄이기 설정 확인 |
| 중간·최종보스 | 2:00·4:00 encounter 계약과 6:00 웨이브 종료 후 최종보스 전환 자동 테스트 확인 |
| 결과 | raw score, 처치, 중간·최종보스 split, 전체 시간, 무기별 피해, 빌드, 로컬 순위 표시 확인 |
| 결정론 replay | 같은 공용 엔진으로 입력 로그를 재실행해 실제 브라우저 LOSS 결과와 digest가 일치하고 `RUN VERIFIED LOCALLY`로 확정되는 경로 확인 |
| 디버그 격리 | debug 사용 런이 로컬 순위와 모든 mock 보상에서 제외됨을 결과 화면에서 확인 |
| 보상 안전장치 | 구매권·실물·재고·결제·배송 호출이 없고 모든 결과가 mock으로 표시됨을 확인 |
| 키보드 접근성 | 시작·레벨업 상태의 주 동작 초점, 일시정지 모달 초점 진입·순환·ESC 복귀, 차단 상태의 HUD `inert` 확인 |

## 성능·반응형

- 1440×900 headless Chromium의 내부 `STRESS` 시나리오에서 적 1,000체와 투사체 1,500개를 주입한 상태로 표시 78 FPS·12.8ms frame, 평균 simulation 8.37ms, presentation/audio 0.41ms, render 1.48ms를 확인했다.
- 360·720·1199·1440px 폭에서 document 가로 overflow가 없었다. 360×800 시작 패널의 긴 내용은 패널 내부만 스크롤하며, 주 동작 버튼은 자동 초점 후 viewport 안에 완전히 표시된다.
- 데스크톱과 모바일 브라우저 콘솔의 warning/error는 0건이었다.
- `prefers-reduced-motion: reduce`에서 XP bar와 버튼의 animation이 제거되고 transition이 사실상 0으로 축소됨을 확인했다.
- 스트레스 수치는 synthetic renderer 부하 확인값이며 production 최소 기기 성능 보증이 아니다.

## 자동 검증

- 관련 Vitest 10파일 98개 테스트 통과
- prototype·asset route·engine·pack·reward 범위 ESLint 통과
- `ICONS_PROTOTYPE=1 npm run build` 통과(Next.js compile, TypeScript, route generation 포함)
- 결정론 테스트는 live runtime과 replay가 같은 `ContentPackRuntime`을 사용하며 이동·레벨업·상자·일시정지·최종전환 입력과 6+6+진화 결과가 일치하는지 검증한다.

## 콘셉트 대비 fidelity ledger

| 비교점 | 결과 | 판단 |
|---|---|---|
| 검정·bronze·crimson·ivory·cyan palette | 생성 콘셉트와 런타임 HUD·바닥·VFX에 동일 위계 적용 | 일치 |
| 중앙 추적 카메라와 전투 가독성 | 플레이어를 중앙에 유지하고 저채도 바닥 위 적·투사체·픽업을 분리 | 일치 |
| 상단 XP·시간·점수 정보 계층 | 전체폭 XP, 중앙 시간, 우측 raw score와 kill을 유지 | 일치 |
| active/passive 슬롯 | 좌상단 6+6 슬롯과 레벨 배지를 유지 | 일치 |
| 최종보스 구분 | 별도 전환, 고유 sprite, 전체 HP rail과 boss split을 사용 | 일치 |
| 레벨업 선택 | 전투 배경을 유지한 정지형 3선택과 현재 빌드 패널을 사용 | 일치 |
| 캐릭터 동작 | 정지 일러스트 대신 방향별 이동·공격 예비·접촉·회수 action atlas를 사용 | 개선 완료 |
| 무기 동작 | 동일한 회전 사각형 대신 무기별 궤적·크기·잔광·충돌 lifecycle을 사용 | 개선 완료 |
| 피격·사망 | 실제 피해량, hit pose, recoil, death linger, 최종보스 결과 reveal 지연을 사용 | 개선 완료 |
| 사운드 | 무기 발동·일반/강한 충돌·처치·플레이어 피격을 서로 다른 합성 cue로 분리하고 밀집 tick은 피격·처치를 우선 | 개선 완료 |
| 일반 전투 밀도 | 첫 30초는 학습 여백을 위해 콘셉트보다 의도적으로 낮고 시간에 따라 증가 | 의도된 차이 |
| 디버그 패널 | 내부 QA 전용이며 공개 승격 시 제거하거나 staff 도구로 격리 | 의도된 차이 |

## 출시 승격 전 남은 게이트

1. 고정 최소 기기군에서 7~8분 전체 런 성능·열·메모리 측정
2. IP 감수와 12세 목표 표현·색약 대비·축소 해상도 검수
3. 현재 로컬 결정론 replay seam을 서버 권위 run session·검증 worker로 승격하고 seed 정책과 부정행위 이의 절차 확정
4. 구매 접근권·재고·만료·취소·미수령·차순위 승계 상태기계
5. 보상형 공개 운영의 등급·법무·세무 검토와 별도 ADR 승인
6. 공유 preview라면 Deployment Protection 또는 페이지·asset route 공통 staff 인증

이 게이트가 끝나기 전에는 현재 로컬 mock 결과를 실제 구매 권한이나 실물 보상으로 승격하지 않는다.
