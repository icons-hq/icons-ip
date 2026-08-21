# 지우학 온라인 팝업 캠페인 에셋 provenance

> 기준일: 2026-08-21
>
> 기계 판독 진실원: [`asset-manifest.json`](./asset-manifest.json)

## 1. 권리·소스 잠금

- 권리 상태: **LOCKED**. 사용자가 시즌 1·2 IP, 제공 이미지, 인터랙티브 제작, 상품 제작·판매 권리를 확보했다고 확인했다.
- 소스 저장소: `icons-hq/icons`
- 고정 commit: `d63c7f0c4c5851c9722afdd895c87b72a7217c2d`
- 고정 디렉터리: `50_apps/plan-viewer/public/ip-popups/aouad`
- UX 기준: <https://icons-plan.vercel.app/sample/aouad>
- 이식 방식: iframe과 외부 런타임 의존 없이 파일을 현재 저장소에 포함한다.
- 편집 상태, SHA-256, byte size, dimensions, 사용 위치는 통합 manifest의 각 record가 진실원이다.

이 잠금은 외부 음원·3D 모델·폰트의 라이선스를 자동으로 포괄하지 않는다. 이번 캠페인 팩에는 위 commit의 공식 이미지, built-in ImageGen 생성물, 외부 샘플 없는 자체 합성 음향만 포함했다.

## 2. 공식 이미지 24개

원본 24개를 byte-for-byte로 `public/generated/aouad-campaign/official/`에 복사했다. 픽셀 편집, 재압축, 파일명 변경 외 가공은 없다. 파일명은 원본과 동일하다.

```text
key-armed-group.jpg
key-title-art.jpg
key-yearbook-blood.jpg
logo-title.png
poster-action-group.jpg
poster-archery.jpg
poster-duo-dark.jpg
poster-main-kr.jpg
poster-school-aerial.jpg
poster-villain.jpg
promo-cast-profile.jpg
still-armed-group-walk.jpg
still-barricade.jpg
still-bonfire.jpg
still-classroom-outbreak.jpg
still-corridor-run.jpg
still-gym-group.jpg
still-infirmary.jpg
still-jeolbi-closeup.jpg
still-library.jpg
still-music-room.jpg
still-schoolyard.jpg
still-window-pair.jpg
still-zombie-rush.jpg
```

각 파일의 원본 URL은 다음 규칙으로 고정한다.

```text
https://github.com/icons-hq/icons/blob/d63c7f0c4c5851c9722afdd895c87b72a7217c2d/
50_apps/plan-viewer/public/ip-popups/aouad/<filename>
```

## 3. 팝업 디자인 콘셉트와 런타임 이미지

### 채택한 콘셉트

| 역할 | PNG master | 런타임 파생본 |
| --- | --- | --- |
| 데스크톱 허브 | `concepts/popup-hub-desktop.png` | 구현 자체가 소비하는 시각 기준 |
| 모바일 허브 | `concepts/popup-hub-mobile.png` | 구현 자체가 소비하는 시각 기준 |
| 야간 학교 히어로 | `concepts/popup-hero-school-night-source.png` | `/generated/aouad-campaign/generated/hero-school-night.webp` |
| 방송실 | `concepts/popup-broadcast-source.png` | `/generated/aouad-campaign/generated/sol/reunion-radio-room-opening.webp` |
| 옥상·생존 기록 | `concepts/popup-rooftop-source.png` | `/generated/aouad-campaign/generated/sol/rooftop-survival-record.webp` |

런타임은 PNG master를 import하지 않는다. WebP만 내려받고, 공식 이미지도 사용하는 카드·존에서만 `next/image`가 요청한다.

### 방송실 source

- ImageGen session: `01a022fa-db4b-7f01-8221-5f7ced2642d5`
- exec: `4366aceb-da38-4dde-ab19-7f2dc18ec32b`
- 변환: `cwebp 1.6.0 -q 86 -m 6 -sharp_yuv`
- WebP SSIM All: `0.989129`

```text
Use case: stylized-concept
Asset type: wide cinematic raster background for an online horror popup campaign opening
Primary request: create an original, production-ready empty Korean high-school broadcasting room at night, moments after an emergency evacuation, centered on an old tabletop radio/intercom receiver waiting for a response
Input images: use the provided popup hub desktop concept and existing night school hero only as references for the campaign's restrained visual language, material realism, and dark blue-green / ember-orange palette; do not copy layouts or embedded text
Scene/backdrop: compact 1990s-era school broadcasting room with analog mixing desk, microphone silhouette, coiled cable, dusty interior window looking into a pitch-dark corridor, subtle rain streaks on distant glass
Subject: the unbranded radio receiver and microphone, no people
Style/medium: cinematic photoreal environment key art, grounded Korean survival thriller, physically plausible worn surfaces, premium streaming-series production design
Composition/framing: 16:9 landscape, radio in lower-right third, generous clean negative space across left half and upper-left for responsive UI overlays, layered foreground and corridor depth, safe crop for mobile center
Lighting/mood: cold fluorescent spill, dim red indicator glow without letters, faint warm emergency lamp, tense but not graphic
Color palette: charcoal black, oxidized sage green, cold cyan-gray, restrained burnt orange and deep red accents
Materials/textures: scratched painted metal, aged laminate, dusty glass, braided cable, soft film grain
Constraints: no people, no silhouettes resembling actors, no faces, no zombies, no blood, no gore, no text, no letters, no numbers, no logo, no watermark, no recognizable copyrighted insignia, no UI elements; keep important details away from extreme edges
Avoid: glossy sci-fi controls, cyberpunk neon, fantasy, weapons, excessive clutter, legible labels
```

### 옥상·생존 기록 source

- ImageGen session: `01a022fa-db4b-7f01-8221-5f7ced2642d5`
- exec: `ef577d51-0aaf-4c42-84c3-f8ed31b47ce2`
- 변환: `cwebp 1.6.0 -q 86 -m 6 -sharp_yuv`
- WebP SSIM All: `0.976399`

```text
Use case: stylized-concept
Asset type: cinematic raster background for a personal survival-record card and rooftop campaign zone
Primary request: create an original, production-ready empty Korean high-school rooftop at blue-hour dawn after a night of rain, suggesting a hard-won moment of safety without showing any character
Input images: use the provided popup hub concepts and existing night school hero only as references for premium grounded survival-thriller atmosphere, restrained darkness, and weathered school architecture; do not copy layout or embedded text
Scene/backdrop: broad concrete school rooftop with low parapet, small rooftop utility door and water tank in the distance, wet pavement catching the first cold light, a few abandoned folding chairs and a neatly coiled emergency rope, hazy Korean city hills beyond
Subject: empty rooftop environment, subtle evidence of recent evacuation but no violence
Style/medium: cinematic photoreal environment key art, realistic production design, subdued Korean thriller cinematography
Composition/framing: 3:2 landscape adaptable to a wide record tile, low eye-level perspective, center and lower-center kept visually quiet for overlaid result data, clear horizon in upper third, important architecture away from extreme edges
Lighting/mood: pre-sunrise cobalt blue with one weak amber utility light, faint mist, reflective rain sheen, sober relief rather than triumph
Color palette: deep navy, charcoal, cold blue-gray, oxidized sage, one restrained amber accent
Materials/textures: rain-darkened concrete, rusted steel, scuffed painted door, subtle film grain
Constraints: no people, no actor likenesses, no faces, no zombies, no bodies, no blood, no gore, no text, no letters, no numbers, no logo, no watermark, no recognizable copyrighted insignia, no UI elements
Avoid: apocalyptic city destruction, fire, dramatic explosions, fantasy, cyberpunk neon, weapons, excessive debris, legible signage
```

### 이미지 QA

- PNG와 WebP를 직접 시각 검수했다.
- 인물, 배우 닮은꼴, 얼굴, 좀비, 고어, 혈흔, 생성 문자, 로고, 워터마크가 없다.
- 방송실은 좌측·상단 UI 여백과 모바일 중앙 crop을, 옥상은 중앙 기록 데이터 여백과 상단 1/3 수평선을 확보했다.
- WebP는 PNG보다 각각 96.07%, 94.11% 작고 눈에 띄는 block·banding이 없다.

## 4. 자체 합성 음향

모든 파일은 FFmpeg `lavfi`의 sine/noise source와 filter graph로 직접 만들었다. 외부 샘플, 원작 OST, 배우 대사, 출처 불명 음원은 없다. 출력은 PCM s16le, 48kHz, mono이며 전 구간 decode와 무클리핑을 확인했다.

| 파일 | 길이 | source·seed | 핵심 filter | 최종 보정 | peak |
| --- | ---: | --- | --- | --- | ---: |
| `radio-static-bed.wav` | 2.400s | pink `4041`, white `7319`, sine 58Hz | HP/LP, tremolo, mix, fade | `volume=13dB`, limiter `.82` | −13.9dBFS |
| `rooftop-wind-bed.wav` | 4.200s | pink `1984`, brown `6027`, sine 196Hz | HP/LP, 3 tremolo layers, fade | `volume=15dB`, limiter `.78` | −13.2dBFS |
| `radio-response-confirm.wav` | 0.820s | unseeded pink, sine 690/920Hz | band-limit, two delayed tones, mix | `volume=14dB`, limiter `.85` | −13.4dBFS |
| `survivor-record-stamp.wav` | 0.340s | unseeded brown/white, sine 84Hz | body, thump, paper layer, mix | `volume=8dB`, limiter `.85` | −10.5dBFS |
| `campaign-zone-unlock.wav` | 0.985s | sine 392/523.25/659.25Hz, unseeded pink | delayed triad, noise, echo | `volume=33dB`, limiter `.85` | −11.5dBFS |

두 bed는 seed와 FFmpeg 구현이 같을 때 재현 가능하다. UI SFX 3개는 noise seed를 지정하지 않았으므로 정확한 재실행을 보장하지 않으며, 통합 manifest의 현재 SHA-256을 canonical binary truth로 삼는다.

## 5. 사용 경계

- 오디오는 사용자 제스처 뒤에만 재생하고 autoplay 실패가 진행을 막지 않게 한다.
- 학생 이름과 로컬 avatar는 이미지·분석 이벤트·서버에 기본 포함하지 않는다.
- 공식 이미지와 생성 이미지는 manifest의 `source_type`으로 구분한다.
- 매점은 미리보기·위시만 제공한다. 가격, SKU, 재고, 판매 일정, 가짜 희소성은 상품 그릴링 전까지 넣지 않는다.
- 공동 수치와 방명록은 서버·moderation 경계가 생길 때까지 표시하지 않는다.
