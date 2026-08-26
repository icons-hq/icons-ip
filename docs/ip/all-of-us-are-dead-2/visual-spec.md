# Last Bell visual spec — `hyosan-post-strike-night`

> 상태: 현재 frame-zero visual truth · 2026-08-24

## 정본과 source rule

사용자가 제공한 드라마 attachment가 design truth다. attachment number로만 참조하며, 임시 경로·source pixel·screenshot은 저장소나 production bundle에 복사/ship하지 않는다. generated concept과 과거 generated plate는 canonical reference가 아니다.

| attachment | 관찰한 공간 | 현재 적용 규칙 |
| --- | --- | --- |
| #7–9 | 파괴된 긴 복도 | 한쪽 cyan 창, 반대편 black wall, 매달린/부서진 형광등, 전도 가구와 debris lane |
| #10, #13–14 | 파괴된 교실/남라 | stripped ceiling, exposed frame/brick, blackboard, missing window, off-axis debris |
| #15–16, #18 | 효산고 entrance | cracked/missing glass, dark brick reveal, smoked aluminium, 손잡이 높이에서 glazing을 가로지르는 yellow school strip. 상단 간판이나 classroom slider reference로 전용하지 않음 |
| #11, #17, #19–21 | 파괴된 옥상/재회 | gravel, brick utility core, blue door, local warm fire. Chapter 2의 차가운 청록 공간과 유일한 warm focal point로 구현 |

자세한 matrix는 `hyosan-visual-reference.md`를 따른다.

## 팔레트와 빛

```yaml
background: '#05090C'
fog: '#071216'
negative_fill: '#020405'
cyan_window_light: '#176D78'
charred_concrete: '#263336'
exposed_brick: '#493D38'
smoked_aluminium: '#3B4F50'
shattered_glass: '#145E68'
warm_orange: rooftop fire only, not entry/classroom/corridor
```

Frame zero는 거의 검은 navy와 teal/cyan side-light다. 표시용 sRGB reference의 mean Y는 entrance 8.20, classroom 10.99, corridor 6.79이고 Y<16 암부는 각각 85.10%, 78.49%, 89.12%다. 플레이 시작 뒤 narrow player flashlight가 중심 노출을 만든다. 다만 이동과 상호작용을 읽을 수 있도록 손전등 바깥 5–8m에는 그림자를 만들지 않는 저강도 cyan 근거리 fill과 최소 환경광을 허용한다. 이 fill은 장면 전체를 평평하게 밝히는 광역 key가 아니며, 고정 QA 장면에서 외곽 근거리 휘도 18–45/255, 중앙 빔은 그보다 최소 2.5배, 12m 이후 배경은 12/255 미만을 목표로 한다. dust/ash는 shaft에서만 보인다. warm fire는 이후 rooftop seam 외에는 쓰지 않는다.

## damage grammar

손상은 랜덤 돌이 아니라 구조 언어다: 찢긴 ceiling panel, 두께가 보이는 비정형 plaster → brick/core → rebar 단면, 빠진/깨진 glass, soot, 전도된 학생 가구, 벽 가장자리 rubble lane. 파편은 2–12cm 미세층, 15–60cm frame/trim/furniture 부품, 1–3m hero pile의 세 크기대로 구성하고, 0.9–1.1m 폭의 불규칙 이동 lane만 남긴다. 완전히 정리된 책상·locker grid, `AGED_IVORY`/`SAGE` 학교 색면, 중앙 대칭 구도는 금지한다.

교실 camera는 낮고 off-axis다. 가까운 전도 책상/파편이 하단 또는 측면을 가리고, 뒤쪽 blackboard와 첫 문이 완벽한 중앙 정렬이 아닌 상태로 읽혀야 한다. aperture와 skip은 같은 world, same playable transform으로 연결한다.

## asset taxonomy

| class | ship rule | current use |
| --- | --- | --- |
| attachment reference | reference-only | composition, damage, palette observation; source pixels do not ship |
| official cleared asset | rights/provenance required | logo/approved presentation only |
| authored local 3D pack | current golden path | Blender GLB + PBR/KTX2/Meshopt + UV1 contact AO; semantic anchor를 유지한 채 공식 geometry로 교체 가능 |
| procedural fallback | explicit load/decode failure only | authored pack과 동시에 보이지 않으며 기능 복구용으로만 사용 |
| generated legacy plate/material | not canonical for this profile | no active runtime fallback; preserve only if another legacy route needs it |
| VFX | code-native | ash points, shaft planes; no expensive volume fog |

Every future asset maps to semantic IDs rather than direct gameplay mesh names: entry/classroom/corridor/rooftop environment, debris kit, charred concrete/exposed brick/smoked aluminium/shattered glass, ash/shaft/fire/smoke, and `character.namra.rooftop`. Character, animation, dialogue/blocking and reunion cue stay separate records.

## performance

Use instanced/shared geometry for rubble, shared materials, KTX2 textures, Meshopt geometry and no shadows on repeated props. Keep hero shadows to the first door/flashlight and preserve mobile 30fps. Do not add a material or geometry instance per debris stone; do not add an expensive volumetric pass. 정적 AO는 emitted light가 아니라 non-color UV1 `aoMap`으로 적용한다.

## 2챕터 visual checklist

- 첫 프레임부터 post-strike night로 읽히는가.
- 교실이 blackboard, stripped ceiling, exposed structure, broken frames, asymmetrical damage를 보이는가.
- first door를 통해 #7–9 계열의 cyan corridor axis가 보이는가.
- 문은 damaged classroom slider fallback으로 읽히며 DoorSystem contract를 방해하지 않는가.
- warm fire는 옥상에서만 보이고, 남라·모닥불·문·상품이 각각 교체 seam을 유지하는가.
- 옥상 문 뒤에는 pickup highlight와 zombie readability lighting이 사라지고 바람·불·발소리에 집중하는가.
