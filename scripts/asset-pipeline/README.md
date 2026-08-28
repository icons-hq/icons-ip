# 효산의 기억 에셋 파이프라인

G2 급식실 버티컬 슬라이스의 플레이어·학생 좀비·김경미 보스 애니메이션과 급식실 세트를 검토 가능한 산출물로 만드는 파이프라인이다. `asset-spec.yaml`이 현재 생성 사양의 단일 정본이다. G2 산출물은 `docs/games/hyosan-memories-g2-assets/`에 게시되며 정확한 스펙·PNG·atlas·module catalog 해시에 대한 사용자 승인 전에는 G3 Phaser 통합에 사용할 수 없다. 2026-08-28 최초 승인본은 최종 리뷰에서 프레임 여백·타일 모듈 계약·상단 출구 결함이 확인되어 `approval-history/2026-08-28T020737Z.json`에 이전했다. 수정 배치는 현재 `pending-user-approval`이며 새 `approval-record.json`이 생기기 전까지 G3는 차단된다. 파이프라인을 다시 실행하거나 승인된 해시가 달라지면 같은 방식으로 재승인이 필요하다.

M0 시안 3종은 2026-08-27 사용자 승인을 통과했고 정본은 `docs/games/hyosan-memories-m0-concepts/approval-record.json`에 남아 있다. 그 승인은 G2의 방향 레퍼런스일 뿐 G2 양산 PNG를 승인하지 않는다. 어느 단계든 이미지 또는 스펙 해시가 달라지면 해당 배치를 다시 승인받아야 한다.

## 모델 작업 경계

기획 프롬프트 작성, 공식 레퍼런스 첨부, 이미지 생성·수정·재생성, 시즌1 소스·배우·의상·세트 충실도와 각도·가독성 비전 QA는 모두 **현재 Codex 앱 작업에서 기본 내장 `imagegen`과 이미지 비전을 직접 사용**한다.

- `codex exec`를 호출하지 않는다.
- Image API나 별도 이미지 생성 스크립트를 호출하지 않는다.
- Python `scripts/image_gen.py`로 자동 fallback하지 않는다.
- 하위 Codex 작업을 생성 노드로 띄우지 않는다.

저장소 스크립트는 모델을 호출하지 않는다. direct-session 산출물을 ingest한 뒤 sharp 기반 alpha/size/trim/frame/bbox/edges 기술 QA, safe-padding normalize/trim, 64px named-module repack/catalog, sprite atlas, manifest만 결정론적으로 수행한다.

## 실행 흐름

1. 현재 Codex 앱 작업이 `asset-spec.yaml`에서 정확히 한 항목의 프롬프트를 만든다.
2. 앱 기본 내장 `imagegen`을 항목당 한 번 직접 호출한다.
3. 기본 생성 위치의 결과를 `outputs/hyosan-memories-g2/direct-input/`에 복사한다. 원본은 삭제하지 않는다.
   - 투명 요청에 RGB 체크무늬가 구워졌다면 코드로 체크무늬를 추정 제거하지 않는다. 같은 Codex 앱 작업의 내장 `imagegen` 편집으로 캐릭터는 유지하고 배경만 단색 마젠타 크로마로 바꾼다.
   - 그 결과에만 `technicalTransform: magenta-matte-to-alpha`를 명시한다. 변환은 이미지 가장자리의 마젠타 비율을 검증하고, 가장자리와 연결된 크로마만 alpha 0으로 바꾸며, 흰 셔츠를 포함한 비마젠타 전경은 보존한다. 투명 픽셀 RGB를 0으로 정리하고 경계의 마젠타 오염색과 전경 내부에 고립된 정확한 matte 색만 인접한 비크로마 전경색으로 복원하는 결정론적 패키징이다. 복원할 이웃을 안전 거리 안에서 찾지 못하면 실패한다.
   - 다중 프레임 캐릭터가 정확한 시각적 행렬은 유지했지만 실루엣이 선언 셀 경계를 넘었다면 `technicalTransform: magenta-matte-to-alpha-and-regrid`를 쓸 수 있다. 이 변환은 matte 복원 뒤 정확히 `frames`개의 연결 실루엣을 검출해 시각 중심 순서로 row-major 재배치하고, 공통 scale과 bottom-center anchor를 적용한다. 프레임이 부족하거나 크기가 모호하거나 셀보다 지나치게 큰 실루엣, 또는 버려질 추가 실루엣이 유효 프레임의 절반 이상이면 실패한다. 검출 수·선택 픽셀 범위·가장 큰 제외 성분은 manifest의 기술 변환 결과에 남는다.
   - `kind: tileset`은 스펙의 `moduleGrid`를 필수로 검증한다. 후보를 1024×1024·64px·16×16 시트로 결정론적으로 재패킹하며, source crop 좌표는 파이프라인 내부에만 남고 공개 카탈로그는 이름·종류·cell/pixel rect·anchor만 제공한다. 중복·겹침·범위 이탈·필수 ID 누락·빈 모듈·객체 clipping·바닥 반복 경계 불연속은 실패한다.
4. 같은 작업에서 변환 후 후보를 직접 보고 정확히 6개 품질 차원과 3개 하드 가드를 판정해 `outputs/hyosan-memories-g2/direct-session.json`의 `visionQa`에 기록한다. ImageGen 원본은 `candidateSha256`, 실제 후보 검토본은 `visionQa.reviewedSha256`으로 묶이며 바이트가 다르면 실행을 거부한다. QA root·차원/가드 이름·각 차원/가드 내부 필드의 누락과 추가를 모두 거부한다. `sourceFidelity`·`styleMatch`·`topdownAngle`·`gameplayReadability`는 항상 적용하고, `characterIdentity`는 환경만 제외하며, `animationConsistency`는 다중 프레임일 때만 적용한다. `sourceFidelity`는 평균과 별도로 0.85 이상이어야 하며 스펙도 이 하한을 낮출 수 없다. `identity.mode: canonical` 자산은 `characterIdentity >= minCharacterIdentity`도 독립 게이트다.
5. `npm run hyosan:assets:g2`를 실행한다.
6. 후보가 기술·시각 품질 게이트를 통과하면 normalize/trim한 최종 PNG를 같은 Codex 앱 작업에서 다시 직접 보고 `outputVisionQa`에 기록한다. `outputVisionQa.reviewedSha256`은 최종 PNG 해시와 같아야 한다. 최종 출력도 같은 6개 차원·3개 하드 가드를 전부 통과해야 게시된다.
7. 기술 QA 또는 후보 비전 점수가 부족하면 같은 앱 작업이 직접 edit/regenerate하고 다음 attempt를 추가한다. 최초 생성을 포함해 최대 3회다. 낮은 후보는 최종 출력 검토 대상으로 올리지 않는다.
8. 세 번 모두 soft score만 부족하면 안전 후보 중 `sourceFidelity`를 먼저, 정식 배역은 배우 `characterIdentity`를 다음으로, 평균 점수를 마지막으로 비교해 BEST 한 개를 정한 뒤 그 최종 PNG만 직접 검토한다. 고어·웹툰·시즌2 요소나 기술 QA 실패 후보는 BEST가 될 수 없다. 최종 검토까지 안전하면 warning과 함께 채택한다. 배우 유사도는 금지 항목이 아니며, 정식 캐릭터에서는 필수 충실도 기준이다.

raw 시도는 gitignored `outputs/`에 남는다. 선택 산출물·기술 QA 리포트·atlas·named module catalog·manifest는 사용자 검토를 위해 `docs/games/hyosan-memories-g2-assets/`에 생성된다. 같은 output을 쓰는 실행은 소유 token·host·PID·OS 프로세스 시작 identity를 기록한 lock으로 직렬화한다. 같은 host에서 PID가 종료됐거나 다른 프로세스로 재사용된 것이 OS identity로 확인될 때만 배타적 recovery marker 아래 잔여 output lock을 자동 복구한다. Recovery marker 자체는 자동 회수하지 않는다. 살아 있는 소유자, 다른 host, malformed/구형 lock, 중단된 recovery marker는 강제로 만료시키지 않으며 검증 후 수동 정리가 필요하다. 따라서 event-loop 정지나 장시간 실행만으로 다른 실행이 lock을 탈취할 수 없다. 정상 실행은 30초 heartbeat로 소유권 상실을 감지한다. 소유 token이 바뀌거나 heartbeat가 실패하면 진행 중 모델/QA 작업을 중단하고 완료될 때까지 drain한 뒤, 선택 PNG·atlas·module catalog·QA·최종 manifest의 각 shared publish 전후에 token fencing을 재확인한다. Atlas는 고유 run 디렉터리에서 완성한 뒤에만 게시하고, in-flight heartbeat가 끝난 뒤 lock을 해제한다. 각 실행은 direct-session JSON을 읽기 전 manifest부터 `regeneration-in-progress`로 무효화하고, 성공한 산출물이 모두 기록된 뒤에만 `pending-user-approval`을 원자적으로 게시한다. 따라서 동시 실행이나 세션 JSON 파싱·runner 준비 실패가 이전 통과 결과를 승인 가능한 상태로 되돌리지 않는다. 스펙과 direct-session은 UTF-8 원본 바이트를 한 번만 읽어 fatal decode하므로 잘못된 바이트를 대체 문자로 승인하지 않으며, 스펙은 같은 원본 바이트의 SHA-256을 기록한다. 검증된 스펙과 plan·generation·technical QA·candidate/output QA를 deep-freeze하고 runner 호출 전 SHA를 원시값으로 스냅샷해 임계값·권리·레퍼런스·검토 해시·하드 가드 변조를 막는다. Direct-session 후보는 direct-input 기준의 안전한 상대 POSIX 경로만 허용해 절대 로컬 경로가 manifest에 남지 않는다. project·milestone·planner·generator·vision QA·asset label뿐 아니라 비어 있지 않은 권리 범위, exact-shape의 중복 없는 등록된 Netflix 공식 ID–URL 레퍼런스, 각 자산의 공식 레퍼런스 결속을 필수로 검증하며 manifest에도 이를 보존한다. 캐릭터형 `sprite`·`boss`·`cutin`은 `characterIdentity`를 비적용 처리할 수 없다. 스펙의 작업·출력 경로, direct-input 루트와 후보, direct-session 파일, atlas 이름은 저장소 밖이나 저장소 루트 자체를 허용하지 않으며 lexical 경로뿐 아니라 실제 경로를 확인해 심볼릭 링크 탈출도 거부한다. run 디렉터리는 배타적으로 새로 만들고, JSON·정규화 PNG·atlas·module catalog·게시 이미지는 임의 이름의 `wx` 임시 일반 파일을 만든 뒤 atomic rename하므로 기존 디렉터리·leaf symlink를 따라 외부 파일을 덮지 않는다. Manifest는 atlas PNG와 frame-data JSON 및 module catalog의 SHA-256을 각각 기록한다.

## G2 프레임·atlas 계약

- 각 셀은 지정된 target 크기다. 플레이어·학생 좀비는 128×128, 김경미 보스는 192×192다.
- 4방향 행 순서는 남·서·북·동이며 row-major다. 교표·이름표 방향이 뒤집히므로 좌우 미러링하지 않는다.
- 이동/플레이어 콤보/보스 공격은 방향당 6프레임, 학생 좀비 공격은 방향당 4프레임이다.
- 프레임별 보이는 bbox를 검사한 뒤 전체 시트에서 가장 큰 bbox 기준의 공통 scale, 최소 4% safe padding, bottom-center 발 anchor를 적용한다. 출력 PNG를 다시 셀별로 검사해 빈 셀·bbox 범위 이탈·불투명 edge 초과를 fail closed한다.
- frame key는 `<asset_id>_00`부터 row-major로 만든다. `frames: 1`은 기존 자산 id와 PNG byte 계약을 보존한다.
- atlas는 padding 4px, extrusion 1px, 최대 변 4096px다. 한 행이 상한을 넘기 전에 결정적으로 줄바꿈하고, 전체가 상한을 넘으면 실패한다.
- atlas 비포함 자산도 `alpha: required`면 투명도를 보존하고 정규화 출력에서 크기·alpha·SHA를 다시 검증한다.

## G2 64px module catalog 계약

- 급식실 시트는 정확히 1024×1024 RGBA, 64px 셀, 16열×16행이다.
- `moduleGrid`는 각 이름의 내부 source crop과 공개 cell rect를 분리한다. G3는 `modules/cafeteria_tileset-modules.json`의 이름·pixel rect만 소비하고 source 좌표를 알지 않는다.
- module ID·cell rect는 중복·겹침·범위 이탈을 허용하지 않으며 `requiredIds`는 모두 존재해야 한다.
- 바닥 타일은 1×1 완전 불투명 셀과 맞은편 edge 색 연속성을 검사한다. 구조물·가구·overlay는 셀 안의 투명 gutter를 보존하고 clipping을 거부한다.
- catalog는 대상 PNG SHA-256을 포함하며 catalog 파일 자체 SHA-256도 manifest에 기록한다. PNG·스펙·catalog 중 하나라도 바뀌면 승인은 무효다.

## direct-session 형식

```json
{
  "schemaVersion": 1,
  "generator": "codex-app-built-in-imagegen",
  "assets": [
    {
      "assetId": "player_halfbie_walk",
      "prompt": "Codex 앱에서 직접 사용한 최종 프롬프트",
      "attempts": [
        {
          "attempt": 1,
          "prompt": "해당 시도에서 Codex 앱 ImageGen에 직접 전달한 정확한 프롬프트",
          "technicalTransform": "magenta-matte-to-alpha-and-regrid",
          "candidate": "player_halfbie_walk-attempt-01.png",
          "candidateSha256": "원본 PNG의 lowercase SHA-256",
          "visionQa": {
            "assetId": "player_halfbie_walk",
            "reviewedSha256": "기술 변환 후 실제 검토한 PNG의 lowercase SHA-256",
            "dimensions": {
              "sourceFidelity": { "applicable": true, "score": 0.9, "notes": "공식 시즌1 스틸과 교복·프로덕션 디자인 일치" },
              "styleMatch": { "applicable": true, "score": 0.9, "notes": "..." },
              "characterIdentity": { "applicable": true, "score": 0.9, "notes": "..." },
              "topdownAngle": { "applicable": true, "score": 0.9, "notes": "..." },
              "gameplayReadability": { "applicable": true, "score": 0.9, "notes": "..." },
              "animationConsistency": { "applicable": true, "score": 0.9, "notes": "24개 셀의 체형·의상·발 anchor가 일관됨" }
            },
            "guards": {
              "gore": { "detected": false, "confidence": 0, "notes": "..." },
              "webtoonElements": { "detected": false, "confidence": 0, "notes": "..." },
              "wrongSeasonElements": { "detected": false, "confidence": 0, "notes": "..." }
            },
            "feedback": []
          },
          "outputVisionQa": {
            "assetId": "player_halfbie_walk",
            "reviewedSha256": "normalize/trim된 최종 PNG의 lowercase SHA-256",
            "dimensions": {
              "sourceFidelity": { "applicable": true, "score": 0.9, "notes": "최종 PNG에서도 공식 시즌1 교복과 프로덕션 디자인 일치" },
              "styleMatch": { "applicable": true, "score": 0.9, "notes": "..." },
              "characterIdentity": { "applicable": true, "score": 0.9, "notes": "..." },
              "topdownAngle": { "applicable": true, "score": 0.9, "notes": "..." },
              "gameplayReadability": { "applicable": true, "score": 0.9, "notes": "..." },
              "animationConsistency": { "applicable": true, "score": 0.9, "notes": "정규화 뒤에도 24개 셀의 공통 scale과 발 anchor가 일관됨" }
            },
            "guards": {
              "gore": { "detected": false, "confidence": 0, "notes": "..." },
              "webtoonElements": { "detected": false, "confidence": 0, "notes": "..." },
              "wrongSeasonElements": { "detected": false, "confidence": 0, "notes": "..." }
            },
            "feedback": []
          }
        }
      ]
    }
  ]
}
```
