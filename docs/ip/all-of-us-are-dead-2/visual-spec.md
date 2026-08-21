# 《지금 우리 학교는: 마지막 종》 수직 슬라이스 비주얼 스펙

> 상태: 구현 기준 v1 · 2026-08-21
>
> 범위: 약 30초 오프닝부터 `마지막 수업`의 종 세트피스와 Chapter 1 Complete까지. 장편 본편의 모든 공간을 정의하지 않는다.
>
> 런타임 전제: 실제 플레이 공간은 R3F/Three 기반 절차형 3D 1인칭 교실·복도다. 이 팩의 래스터 이미지는 시네마틱 플레이트, 챕터·실패 카드, 조명·물성 정본이며 2D 게임판을 뜻하지 않는다.

## 1. 크리에이티브 한 문장

**조금 낡았지만 따뜻한 평범한 교실이, 같은 구도와 같은 물성 안에서 냉색 형광등·비상 적색·소리의 방향만으로 생존 공간으로 변한다.**

공포의 중심은 고어가 아니라 `익숙한 학교가 아직 그대로인데 사람의 행동 규칙만 바뀌었다`는 감각이다. 첫 30초의 생활감이 충분해야 이후의 복도, 배전반, 종이 위협으로 작동한다.

## 2. 시각 정본과 우선순위

1. `icons-hq/icons`의 AOUAD 공식 스틸·포스터·로고와 [AOUAD 기획 페이지](https://icons-plan.vercel.app/ip-popups/aouad)
2. Netflix Tudum·About Netflix의 공식 AOUAD 영상·스틸·제작 자료
3. 한국 학교 교실·복도 건축 레퍼런스
4. 이 문서와 `public/generated/last-bell/`의 생성 환경 에셋

공식 배우 얼굴을 새로 합성하지 않는다. 수직 슬라이스의 플레이어는 이름 없는 다른 반 학생이며, 생성 에셋 속 인물은 실루엣·후면·반투명 유리 너머로만 표현한다.

## 3. 공간 문법

### 건축

- 교실은 `창문 벽 / 학생 책상열 / 칠판·교탁 / 베이지 사물함 / 반투명 미닫이문`의 다섯 층으로 읽힌다.
- 복도는 반복되는 아이보리 기둥과 교실 베이, 회녹색 하부 벽, 반투명 망입유리, 회색 리놀륨의 긴 일점 투시를 유지한다.
- 문은 위협과 상호작용을 동시에 설명한다. 잠금쇠·손잡이·문틀이 조준 없이도 구분되어야 한다.
- 설비실은 학교 안에 실제로 덧붙여진 좁은 유지보수 틈처럼 보인다. SF 패널이나 군사 시설처럼 만들지 않는다.

### 물성

| 역할 | 재질 |
| --- | --- |
| 생활감 | 닳은 목재 상판, 분필 가루, 크림색 커튼, 오래된 책가방 |
| 학교 정체성 | 짙은 초록 교복, 회녹색 도장, 베이지 철제 사물함 |
| 공포 전환 | 망입유리, 긁힌 알루미늄 문틀, 젖은 듯 반사하는 낡은 리놀륨 |
| 상호작용 | 아연도금 강판, 베이클라이트 손잡이, 큰 기계식 스위치 |

### 고정 팔레트

```yaml
last_bell_palette:
  aged_ivory: "#C7BEAA"
  classroom_shadow: "#171D1A"
  institutional_sage: "#465B4A"
  uniform_forest: "#17271F"
  worn_wood: "#72563B"
  fluorescent_cyan: "#B9DBD9"
  emergency_red: "#C3292E"
  sunset_amber: "#E5A45C"
  hud_ink: "#F1F0E8"
```

`emergency_red`는 경고등, 반사, 즉시 행동 신호에만 쓴다. 화면 전체에 붉은 필터를 덮지 않는다. 기본 암부는 검정이 아니라 초록기가 도는 `classroom_shadow`다.

## 4. 조명 상태

| 상태 | 키라이트 | 보조광 | 의미 |
| --- | --- | --- | --- |
| 평범한 수업 | 창문에서 들어오는 낮은 황금빛 | 녹백색 형광등 | 생활감과 안전 |
| 발병 전환 | 창문 빛 급감 | 깜박이는 형광등 + 복도 적색 | 규칙이 깨짐 |
| 청취·은신 | 꺼진 복도 | 먼 냉색광 + 한 점의 적색 | 소리로 거리 판단 |
| 비상전원 | 손전등 원형 광원 | 머리 위 청색 형광등 | 조작 대상과 퇴로 동시 제시 |
| 마지막 종 | 순차 재점등 | 적색 웅덩이 + 먼 계단의 황금빛 | 위험 폭발과 탈출 방향 |

색상 오버레이로 상태를 흉내 내지 말고, 배경 에셋 교체·국소 광원·미세한 노출 변화로 전환한다.

## 5. 화면 구성

### 데스크톱 16:9

- 기본 원본: `1672×941`, 약 16:9.
- 중심 40%는 조준·위협·상호작용 대상의 가독 영역이다.
- 좌상단은 현재 목표, 우상단은 소리 방향 정보, 하단은 상황 행동·도움말을 위한 여백으로 남긴다.
- `object-fit: cover` 사용 시 인물·문·배전반 focal point가 잘리지 않도록 각 에셋별 `object-position`을 고정한다.

### 모바일 가로

- 세로 모드는 진입 안내 후 가로 회전을 유도하되, 강제 전체화면을 전제로 하지 않는다.
- 좌하단 18% 폭은 이동 스틱, 우하단 20% 폭은 상황 행동, 좌상단 30% 폭은 목표 텍스트의 터치 안전 영역이다.
- 플레이 핵심 대상은 화면 중앙 45% 안에 둔다. 손·문틀 같은 전경은 하단 컨트롤과 겹치지 않게 마스크하거나 낮은 대비로 처리한다.
- 모바일 참고 정본은 `concepts/mobile-corridor-stealth.png`다. 이미지에 표시된 조작기는 없으며 실제 UI는 전부 코드 네이티브다.

## 6. 3D 런타임 계약과 교체 경계

현재 공식 효산고 3D 원본은 이 저장소에 없다. 최초 수직 슬라이스는 절차형 저폴리 구조로 아래 공간 앵커와 상호작용 계약을 먼저 고정하고, 공식 GLB가 도착하면 공간 모듈만 교체한다.

| 안정 앵커 ID | 의미 | 교체 후에도 지킬 계약 |
| --- | --- | --- |
| `classroom_spawn` | 오프닝 마지막 카메라와 플레이 시작점 | 시야가 교실 문과 복도 축을 함께 잡음 |
| `classroom_door` | 첫 잠금·문 압박 | 잠금쇠, 문 충격, 파괴 전환 이벤트 |
| `desk_hide` | 첫 숨기 튜토리얼 | 진입·이탈 볼륨과 시야 차폐 |
| `corridor_listen` | 첫 청취 판단점 | 좌우 소리 emitter와 안전 대기 영역 |
| `utility_panel` | 비상전원 조작 | 상호작용 높이, 진행 이벤트, 퇴로 시야 |
| `fire_door_lock` | 종 전 문 잠그기 | 잠금 상태와 적 동선 차단 |
| `bell_trigger` | 마지막 종 세트피스 | 전원 복구 뒤 한 번만 발생 |
| `chapter_exit` | Chapter 1 완료 경계 | 플레이어 진입 시 결과 상태 전환 |

3D 환경 모듈은 `environmentId → officialGltfUrl | proceduralFallback | visualAnchor` 형태의 교체 seam을 가진다. 공식 GLB 교체 시 입력, 플레이어 캡슐, 충돌 레이어, 앵커 ID, 이벤트 이름은 유지하고 메시·재질·라이트맵만 바꾼다. 외부 Korean classroom GLB 후보는 자동 반입하지 않으며 최종 라이선스·축척·토폴로지 검수 뒤에만 별도 연결한다.

### 절차형 3D fallback 재질

`/generated/last-bell/materials/`의 개별 WebP는 현재 절차형 교실·복도의 base-color map이다. `school-material-atlas.webp`는 색·물성 정본과 provenance용이며, 런타임에서는 UV 복잡도와 bleed를 피하기 위해 개별 맵을 우선한다.

| 표면·파일 | 권장 실제 스케일·repeat | Three material 시작값 | 적용 주의 |
| --- | --- | --- | --- |
| `aged-ivory-plaster.webp` | 약 2m/타일, 8×3m 벽에 `repeat(4, 1.5)` | `roughness: 0.82`, `metalness: 0` | 상부 벽·기둥. 큰 균열이 같은 높이에서 반복되지 않도록 베이별 U offset을 바꾼다. |
| `institutional-sage-paint.webp` | 약 2m/타일, 하부 벽에 `repeat(4, 1)` | `roughness: 0.78`, `metalness: 0` | 바닥에서 1.1~1.25m 높이까지만. 긁힘 방향은 수평으로 유지한다. |
| `dark-gray-linoleum.webp` | 약 1.5m/타일, 복도 폭×길이에 `repeat(2, 12~24)` | `roughness: 0.54`, `metalness: 0`, `envMapIntensity: 0.2` | 젖은 느낌은 스칼라 roughness와 국소 광원으로 만든다. base-color에 반사를 더 굽지 않는다. |
| `wired-frosted-glass.webp` | 교실 문 한 pane에 `repeat(1.2, 1.6)`부터 조정 | `MeshPhysicalMaterial`, `roughness: 0.68`, `metalness: 0`, `transmission: 0.2`, `opacity: 0.62`, `transparent: true` | 망입 패턴 base-color다. 뒤 실루엣과 실제 투과·불투명도는 셰이더가 담당한다. |
| `beige-locker-metal.webp` | 사물함 한 베이에 `repeat(1, 2)` | `roughness: 0.58`, `metalness: 0.08` | 도장 철판의 전체 metalness는 낮게 유지한다. 문짝 틈·손잡이는 메시로 분리한다. |
| `worn-desk-wood.webp` | 책상 상판 하나에 `repeat(1, 1)` 또는 긴 교탁에 `repeat(2.5, 1)` | `roughness: 0.62`, `metalness: 0` | 나뭇결이 상판의 긴 축을 따르도록 UV를 회전한다. |

모든 base-color map은 `SRGBColorSpace`, `RepeatWrapping`, desktop anisotropy 4~8, mobile 2~4를 사용한다. 이 pass에는 normal·roughness map을 포함하지 않았으므로 base-color의 얼룩을 height나 roughness로 재해석하지 않는다. 동일 표면은 texture와 material 인스턴스를 공유하고, 각 학교 베이는 offset만 달리해 반복 패턴을 줄인다. 이 팩은 tileable-ish fallback이며 수학적 무봉합 스캔이 아니므로 카메라 1m 이내의 hero 표면에는 공식 GLB 재질 도착 후 교체 seam을 유지한다.

## 7. 수직 슬라이스 상태와 에셋 매핑

| 비트 | 래스터 역할·에셋 | 기본 크롭 | 3D 연결 |
| --- | --- | --- | --- |
| `00:00~00:22` 평범한 수업 | 시네마틱 플레이트 `/generated/last-bell/environments/opening-classroom-calm.webp` | `50% 50%` | `classroom_spawn` 카메라 축과 일치, 3D 선로딩 |
| `00:22~00:30` 문 밖 이상 행동 | 시네마틱 플레이트 `/generated/last-bell/environments/outbreak-classroom-door.webp` | `56% 50%` | `classroom_door`를 같은 화면 좌표에 맞추고 3D로 crossfade |
| 교실 이탈·청취 | 조명·물성 앵커 `/generated/last-bell/environments/corridor-stealth.webp` | `55% 50%` | 실제 플레이는 `corridor_listen` 절차형 3D |
| 비상전원 복구 | 조명·상호작용 앵커 `/generated/last-bell/environments/emergency-power-panel.webp` | `58% 50%` | 실제 플레이는 `utility_panel` 절차형 3D |
| 종 세트피스 | 조명·구도 앵커 `/generated/last-bell/environments/last-bell-corridor.webp` | `50% 45%` | 실제 플레이는 `bell_trigger`→`chapter_exit` 3D 이벤트 |
| IP 확인 컷·챕터 카드 | `/generated/last-bell/official/aouad-title-logo.png` | `contain` | 코드 네이티브 제목·Chapter 상태와 분리 합성 |

공식 스틸은 생성 배경을 대체하는 상시 게임판보다 오프닝의 짧은 플래시, 실패·챕터 전환, 공식 IP 확인 컷에 우선 사용한다. 배우 얼굴이 있는 스틸 위에 상호작용 HUD를 얹어 플레이 가능한 공간처럼 오해시키지 않는다.

## 8. HUD·타이포·아이콘

- HUD 텍스트, 목표, 자막, 버튼, 소리 방향, 조준점, 모바일 스틱은 모두 HTML/CSS 또는 기존 아이콘 컴포넌트로 구현한다.
- 이미지에 UI 문구를 굽지 않는다. 로고는 예외이며 확보된 공식 투명 PNG를 사용한다.
- 기본 HUD는 `hud_ink` 90%, hairline 28%, 비상 상태만 `emergency_red`를 사용한다.
- 본문은 Pretendard, 시간·출석번호·생존자 번호는 Space Mono를 사용한다.
- 패널보다 열린 오버레이를 우선한다. 게임 화면을 카드형 컨테이너 안에 반복해서 가두지 않는다.
- 소리 방향 표시는 정확한 적 위치가 아니라 `좌/우/뒤` 방향과 세기만 알려준다. 색만으로 강도를 표현하지 않는다.

## 9. 모션과 접근성

- 오프닝의 카메라와 게임 시작 카메라 축을 유지한다. 버튼이 나타날 때 배경이 별도 화면으로 컷되지 않는다.
- 시네마틱 플레이트 구간에서는 1.00~1.035 범위의 느린 스케일·2~6px 시차만 사용한다. 플레이 전환 뒤에는 3D 카메라가 같은 소실점과 높이를 이어받는다. 큰 흔들림과 과한 블러는 금지한다.
- `prefers-reduced-motion`에서는 푸시인, 시차, 흔들림을 끄고 150ms 이하 불투명도 전환만 남긴다.
- 적색 점멸은 초당 3회 미만, 단일 지속 500ms 미만으로 제한한다.
- 방향 자막과 소리 강도 표시가 켜져도 중앙 조준 영역을 가리지 않는다.

## 10. 콘셉트 정본

- 데스크톱: `docs/ip/all-of-us-are-dead-2/concepts/desktop-opening-calm.png`
- 모바일 가로: `docs/ip/all-of-us-are-dead-2/concepts/mobile-corridor-stealth.png`

두 콘셉트는 HUD가 없는 환경·구도 정본이다. 구현 화면 검수에서는 배경축, 팔레트, 밝기 대비, 중앙 focal point, 모바일 안전 영역을 비교하고 UI 자체는 코드 스펙으로 별도 검수한다.

## 11. 비주얼 수용 기준

- 평온한 교실과 발병 후 교실이 같은 학교·같은 제작 세계로 보인다.
- 플레이트 마지막 프레임과 3D 첫 프레임의 문 위치·소실점·노출 차이가 눈에 띄는 점프를 만들지 않는다.
- 중앙 상호작용 대상과 퇴로가 1초 안에 구분된다.
- 적색은 신호로 남고 화면 전체를 지배하지 않는다.
- 공식 스틸과 생성 환경 사이에 `아이보리 / 초록 / 냉색 형광등 / 낡은 학교 물성`이 이어진다.
- 모바일 가로 812×375에서도 좌우 조작 안전 영역과 중앙 위협이 겹치지 않는다.
- 이미지 안에 가짜 HUD, 읽을 수 있는 생성 문구, 워터마크가 없다.
- 고어 없이도 문·유리·빛·실루엣과 소리 연출만으로 위협이 읽힌다.
