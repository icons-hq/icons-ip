# 투신전생기 서바이벌 아트 생성 기록

> 상태: internal prototype asset ledger
>
> 생성일: 2026-08-14
>
> 사용 모드: Codex built-in ImageGen

## 사용 범위와 입력

권리 승인된 제안서에서 추출한 아래 이미지를 캐릭터의 의상, 색, 무기, 실루엣을 이해하기 위한 내부 시각 근거로 사용했다.

- `tmp/pdfs/tusin-proposal/imagegen-reference/zephyr-normal.png`
- `tmp/pdfs/tusin-proposal/imagegen-reference/zephyr-transformed.png`
- `tmp/pdfs/tusin-proposal/imagegen-reference/main-keyart.png`
- `tmp/pdfs/tusin-proposal/imagegen-reference/item-motifs.png`

다른 상용 게임의 sprite, tile, UI, icon, VFX 또는 screenshot은 생성 입력으로 사용하지 않았다. 장르 참고작에서는 공개적으로 관찰되는 가독성 원리만 연구했고, palette·실루엣·레이아웃·동작 표현은 새로 설계했다.

생성 원본은 재현과 비교를 위해 ignored 경로 `outputs/tusin-survival/source/`에 보존한다. 런타임 파일은 `private-assets/tusin-survival/`에 두고 서버 allowlist를 통과한 ID로만 제공한다.

## Prompt set 요약

모든 prompt에는 공통으로 `original Korean dark fantasy`, `16-bit hard pixel clusters`, `crisp nearest-neighbor edges`, `no text`, `no logo`, `no copied commercial-game expression`을 명시했다.

| 산출물 | 생성 지시 요약 | 후처리 |
|---|---|---|
| gameplay concept | 중앙 제피르, 저채도 석재 전장, 악마 군집, cyan 경험 파편, crimson·bronze·ivory HUD 위계 | 없음 |
| level-up concept | 전투 정지, 3개 선택 카드, 좌측 active/passive 빌드, 필드 문맥 유지 | 없음 |
| Zephyr 4-direction atlas | 2×2 정면·후면·좌·우, 3.5등신, 청록 마력·청동 갑주·적색 포인트 | green chroma 제거, soft matte, despill |
| Zephyr action atlas | 6×4, 방향별 idle·run 2프레임·공격 예비·접촉·회수, 동일 기준점과 검 동세 | green chroma 제거, soft matte, despill |
| enemy atlas | 3×2 일반 적 4종과 중간보스 2종, silhouette·크기·무기 구분 | green chroma 제거, soft matte, despill |
| enemy motion atlas | 4×6, 적별 idle·전진·피격·붕괴, silhouette와 지면 기준점 고정 | green chroma 제거, soft matte, despill |
| final boss | 왕관형 가면, 6개 날개, 장창을 든 게임 오리지널 마신군 선봉장 | green chroma 제거, soft matte, despill |
| final boss motion atlas | 4×1, 대기·돌진·강피격·붕괴. 셀별 alpha trim 뒤 512px 정규화 | green chroma 제거, soft matte, despill, nearest-neighbor 재배치 |
| ability icon atlas | 4×3, 검격·운룡·빛의 검·그람·낙뢰·사슬·방패·포션·용심·회귀·최후의 인간·정화 | 없음 |
| combat VFX atlas | 3×2, 검격 초승달·운룡·빛의 검·그람 충격파·낙뢰·용쇄 | green chroma 제거, soft matte, despill |
| combat motion atlas | 4×6, 무기별 발동·비행/전개·충돌·잔광을 분리한 실제 전투 effect strip | green chroma 제거, soft matte, despill |
| pickup atlas | 1×4, 전투 기억 파편·회복 물약·상자·진화 룬 | green chroma 제거, soft matte, despill |
| floor tile | 정사영 저채도 성당 석재, cyan 광맥·bronze 먼지·crimson 균열 | 없음 |

chroma 제거는 imagegen skill의 `remove_chroma_key.py`를 `--auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill`로 실행했다. 기본 후처리는 배경 제거만 수행했다. Final boss motion은 생성 결과가 4:1이 아니어서 각 셀의 alpha bounds만 잘라 512×512 투명 셀에 nearest-neighbor로 재배치했으며 캐릭터 픽셀 자체는 재도색하지 않았다.

## Runtime asset manifest

| Asset ID | 파일 | 크기 | SHA-256 | 상태 |
|---|---|---:|---|---|
| `ability-icon-atlas` | `ability-icon-atlas.png` | 1448×1086 RGB | `c776ef626d0b7be8619508dc34e05367c3d42b0b46085d03a86d402d53fc75f3` | reviewed prototype |
| `combat-motion-atlas` | `combat-motion-atlas.png` | 1024×1536 RGBA | `8895a0f78a036f98486c6d429b3be3364f6dad3a494c19996e486b7e5c98f85c` | reviewed game-feel pass |
| `combat-vfx-atlas` | `combat-vfx-atlas.png` | 1536×1024 RGBA | `f08b9241e7bd192cd8ef68495f0ee4dc9681dc6afd4dee2f837c6c88abf83729` | reviewed prototype |
| `dark-cathedral-floor` | `dark-cathedral-floor.png` | 1254×1254 RGB | `5073f713a68146832aef93d0e7de89b3ee1b1ebc13e383c7668a1dccc8ff14c4` | reviewed prototype |
| `enemy-atlas` | `enemy-atlas.png` | 1536×1024 RGBA | `6bd4f64ed29a7c2ae18af980a5a4e3761f003d197bbb7f4107f2e07f869f4f81` | reviewed prototype |
| `enemy-motion-atlas` | `enemy-motion-atlas.png` | 1254×1254 RGBA | `422faaefe0750aab8ed739c0e3c0abf12089b585cf0baae0ec18ac15b6f6da15` | reviewed game-feel pass |
| `final-boss` | `final-boss.png` | 1122×1402 RGBA | `880e14bb834dca41fe60e5253c298f4b0debc855a504f4a10c458127789f4c9e` | reviewed prototype |
| `final-boss-motion-atlas` | `final-boss-motion-atlas.png` | 2048×512 RGBA | `c4a7e8b26e965a8facd0b38f8138ca388735308304e35563341cb62164e8f657` | reviewed game-feel pass |
| `pickup-atlas` | `pickup-atlas.png` | 1881×836 RGBA | `993e5f70c6e6b6b6e495771c8cae76c6dbfd8ffde628f60c3826d3255a7a36dc` | reviewed prototype |
| `zephyr-action-atlas` | `zephyr-action-atlas.png` | 1536×1024 RGBA | `fb737db54e2df087cc5f6da2647ec84f4c7b131492754566a0204d047440259b` | reviewed game-feel pass |
| `zephyr-directions` | `zephyr-directions.png` | 1254×1254 RGBA | `4e71d4ed39a469f722aa09fbefe78cd7d55d18e0fdd3f429c727397c497bd41a` | reviewed prototype |

## Atlas 계약

- Zephyr: 2×2, `front`, `back`, `left`, `right` 순서다.
- Zephyr action: 6열은 `idle`, `run contact`, `run passing`, `attack anticipation`, `impact`, `recovery`; 4행은 `front`, `back`, `left`, `right` 순서다.
- Enemy: 3×2, `demon-scout`, `ruin-lancer`, `doom-wing`, `shadow-hexer`, `abyss-armored-captain`, `black-dragon-siege-mage` 순서다.
- Enemy motion: 4열은 `idle`, `advance`, `hit`, `death`; 6행은 Enemy 순서와 같다.
- Final boss motion: 4×1, `idle`, `attack`, `hit`, `death` 순서다.
- Ability icons: 4×3이며 prompt 표의 항목 순서와 같다.
- Combat VFX: 3×2이며 prompt 표의 항목 순서와 같다.
- Combat motion: 4열은 `startup`, `active`, `impact`, `afterglow`; 6행은 `기본 검격`, `운룡등천`, `빛의 검`, `용살검 그람`, `낙뢰`, `블랙 드래곤 체인` 순서다. 진화 무기는 대응 기본 무기 행을 공유한다.
- Pickup: 1×4, `battle-memory`, `heal-vial`, `treasure-chest`, `evolution-rune` 순서다.
- Final boss와 floor는 단일 이미지다.

셀 경계는 원본 이미지 크기를 열·행 수로 나눈 정규화 좌표로 계산한다. 생성기가 요청 해상도와 다른 크기를 반환할 수 있으므로 런타임에서 고정 pixel offset을 가정하지 않는다.

## 검토 결과

- 검은색·bronze·crimson·ivory·cyan palette가 두 concept과 runtime atlas에서 일관된다.
- 일반 적 4종, 중간보스 2종, 최종보스는 silhouette와 크기로 구분된다.
- 공격 6종은 색과 외곽 형태가 달라 혼잡한 전투에서도 구분 가능하다.
- 석재 바닥은 캐릭터와 경험치 파편보다 명도·채도가 낮다.
- 모든 runtime atlas에 텍스트, 로고, 타 게임 고유 UI가 없다.
- game-feel pass는 정지 방향 일러스트와 공격 아이콘을 provenance 비교용으로 보존하되, 실제 전투 렌더링은 action/motion atlas를 소비한다.
- 현재 결과는 내부 first playable용이다. 출시 승격 전 IP 감수, 색약 대비와 축소 해상도 검수를 다시 수행한다.
