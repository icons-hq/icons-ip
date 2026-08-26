# Hyosan visual reference matrix

> reference-only · do not ship/copy source pixels

이 문서는 사용자가 제공한 drama attachment를 관찰해 `hyosan-post-strike-night` authored GLB의 공간·손상·광원 기준을 고정한다. attachment는 lookdev와 camera matching을 위한 reference-only 입력이며, source pixel을 `.blend` 재질·GLB·KTX2·저장소·production bundle에 복사하거나 투영하지 않는다. 절차형 장면은 authored pack의 load/decode 실패 때만 나타나는 기능 복구 경로다.

| attachment ID | 공간 | 관찰 | 구현상 규칙 |
| --- | --- | --- | --- |
| #7–9 | corridor | one-side cyan windows, deep black opposite wall, hanging/broken fluorescent, overturned furniture | first bay의 one-point axis·side light·debris lane |
| #10 | classroom/Nam-ra | stripped ceiling/wall/window frames, blackboard, asymmetric debris | blackboard와 exposed structure를 room anchor로 유지 |
| #13–14 | classroom | broken/missing glazing, exposed brick, low light through rubble | frame-zero cold-open, central traversable lane |
| #15–16, #18 | entrance | cracked/missing glass, dark brick reveal, aluminium mullion, glazing 중앙을 가로지르는 노란 학교명 띠 | exterior entry의 geometry·camera truth; 상단 간판형 facade나 classroom slider로 대체 금지 |
| #11, #17, #19–21 | rooftop/reunion | gravel, brick utility core, blue metal door, local warm fire, reunion blocking | same-night downstream seam only; current implementation/review outside |

공통 규칙: near-black navy, cyan/teal side light, neutral concrete/ash, strong negative fill. 먼지는 shaft에서만 보이고, warm orange는 rooftop fire에만 허용한다. 손상은 plaster → brick/core → rebar의 깊이를 가진 authored structural language이며 random stone scatter가 아니다.

## Display-luma reference

1280×720 review PNG의 표시용 sRGB를 직접 측정한 기준이다. Blender 내부 linear buffer를 다시 감마 변환해 수치를 부풀리지 않는다.

| reference | mean Y (0–100) | Y < 16% | 역할 |
| --- | ---: | ---: | --- |
| entrance #15 | 8.20 | 85.10% | 유리·벽돌 윤곽만 cyan edge로 읽히는 깊은 암부 |
| classroom #13 | 10.99 | 78.49% | 잔해·칠판·벽 손상에 제한된 국소광 |
| corridor #8 | 6.79 | 89.12% | 창가 cyan 축과 반대편 near-black 대비 |

게임플레이는 전체를 밝히지 않고 좁은 손전등 중심부만 이 범위를 벗어날 수 있다. 수치 통과는 시각 승인 대신이 아니며, 깨끗한 학교·빈 벽·검은 종단 cap·반복 무늬·색 번짐이 보이면 실패다.
