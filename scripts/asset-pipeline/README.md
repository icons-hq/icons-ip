# 효산의 기억 에셋 파이프라인

M0의 플레이어·학생 좀비·급식실 시안 3종을 검토 가능한 산출물로 만드는 파이프라인이다. `asset-spec.yaml`이 생성 사양의 단일 정본이며, 승인된 M0 산출물의 정본은 `docs/games/hyosan-memories-m0-concepts/approval-record.json`이다.

M0 시안 3종은 2026-08-27 사용자 승인을 통과했다. 승인은 각 PNG와 스펙의 SHA-256에 결속되며, 이미지 재생성 또는 스펙 변경으로 해시가 달라지면 새 승인을 받아야 한다. 승인은 M1·양산·Phaser 통합 게이트를 해제하지만 그 작업을 자동으로 시작하지는 않는다.

## 모델 작업 경계

기획 프롬프트 작성, 공식 레퍼런스 첨부, 이미지 생성·수정·재생성, 시즌1 소스·배우·의상·세트 충실도와 각도·가독성 비전 QA는 모두 **현재 Codex 앱 작업에서 기본 내장 `imagegen`과 이미지 비전을 직접 사용**한다.

- `codex exec`를 호출하지 않는다.
- Image API나 별도 이미지 생성 스크립트를 호출하지 않는다.
- Python `scripts/image_gen.py`로 자동 fallback하지 않는다.
- 하위 Codex 작업을 생성 노드로 띄우지 않는다.

저장소 스크립트는 모델을 호출하지 않는다. direct-session 산출물을 ingest한 뒤 sharp 기반 alpha/size/trim/frame/bbox/edges 기술 QA, normalize/trim, sprite atlas, manifest만 결정론적으로 수행한다.

## 실행 흐름

1. 현재 Codex 앱 작업이 `asset-spec.yaml`에서 정확히 한 항목의 프롬프트를 만든다.
2. 앱 기본 내장 `imagegen`을 항목당 한 번 직접 호출한다.
3. 기본 생성 위치의 결과를 `outputs/hyosan-memories-m0/direct-input/`에 복사한다. 원본은 삭제하지 않는다.
   - 투명 요청에 RGB 체크무늬가 구워졌다면 코드로 체크무늬를 추정 제거하지 않는다. 같은 Codex 앱 작업의 내장 `imagegen` 편집으로 캐릭터는 유지하고 배경만 단색 마젠타 크로마로 바꾼다.
   - 그 결과에만 `technicalTransform: magenta-matte-to-alpha`를 명시한다. 변환은 이미지 가장자리의 마젠타 비율을 검증하고, 가장자리와 연결된 크로마만 alpha 0으로 바꾸며, 흰 셔츠를 포함한 비마젠타 전경은 보존한다. 투명 픽셀 RGB를 0으로 정리하고 경계의 마젠타 오염색만 내부 전경색으로 복원하는 결정론적 패키징이다.
4. 같은 작업에서 변환 후 후보를 직접 보고 정확히 6개 품질 차원과 3개 하드 가드를 판정해 `outputs/hyosan-memories-m0/direct-session.json`의 `visionQa`에 기록한다. ImageGen 원본은 `candidateSha256`, 실제 후보 검토본은 `visionQa.reviewedSha256`으로 묶이며 바이트가 다르면 실행을 거부한다. QA root·차원/가드 이름·각 차원/가드 내부 필드의 누락과 추가를 모두 거부한다. `sourceFidelity`·`styleMatch`·`topdownAngle`·`gameplayReadability`는 항상 적용하고, `characterIdentity`는 환경만 제외하며, `animationConsistency`는 다중 프레임일 때만 적용한다. `sourceFidelity`는 평균과 별도로 0.85 이상이어야 하며 스펙도 이 하한을 낮출 수 없다. `identity.mode: canonical` 자산은 `characterIdentity >= minCharacterIdentity`도 독립 게이트다.
5. `npm run hyosan:assets:m0`을 실행한다.
6. 후보가 기술·시각 품질 게이트를 통과하면 normalize/trim한 최종 PNG를 같은 Codex 앱 작업에서 다시 직접 보고 `outputVisionQa`에 기록한다. `outputVisionQa.reviewedSha256`은 최종 PNG 해시와 같아야 한다. 최종 출력도 같은 6개 차원·3개 하드 가드를 전부 통과해야 게시된다.
7. 기술 QA 또는 후보 비전 점수가 부족하면 같은 앱 작업이 직접 edit/regenerate하고 다음 attempt를 추가한다. 최초 생성을 포함해 최대 3회다. 낮은 후보는 최종 출력 검토 대상으로 올리지 않는다.
8. 세 번 모두 soft score만 부족하면 안전 후보 중 `sourceFidelity`를 먼저, 정식 배역은 배우 `characterIdentity`를 다음으로, 평균 점수를 마지막으로 비교해 BEST 한 개를 정한 뒤 그 최종 PNG만 직접 검토한다. 고어·웹툰·시즌2 요소나 기술 QA 실패 후보는 BEST가 될 수 없다. 최종 검토까지 안전하면 warning과 함께 채택한다. 배우 유사도는 금지 항목이 아니며, 정식 캐릭터에서는 필수 충실도 기준이다.

raw 시도는 gitignored `outputs/`에 남는다. 선택 시안·기술 QA 리포트·atlas·manifest는 사용자 검토를 위해 `docs/games/hyosan-memories-m0-concepts/`에 생성된다. 같은 output을 쓰는 실행은 소유 token·host·PID·OS 프로세스 시작 identity를 기록한 lock으로 직렬화한다. 같은 host에서 PID가 종료됐거나 다른 프로세스로 재사용된 것이 OS identity로 확인될 때만 배타적 recovery marker 아래 잔여 output lock을 자동 복구한다. Recovery marker 자체는 자동 회수하지 않는다. 살아 있는 소유자, 다른 host, malformed/구형 lock, 중단된 recovery marker는 강제로 만료시키지 않으며 검증 후 수동 정리가 필요하다. 따라서 event-loop 정지나 장시간 실행만으로 다른 실행이 lock을 탈취할 수 없다. 정상 실행은 30초 heartbeat로 소유권 상실을 감지한다. 소유 token이 바뀌거나 heartbeat가 실패하면 진행 중 모델/QA 작업을 중단하고 완료될 때까지 drain한 뒤, 선택 PNG·atlas·QA·최종 manifest의 각 shared publish 전후에 token fencing을 재확인한다. Atlas는 고유 run 디렉터리에서 완성한 뒤에만 게시하고, in-flight heartbeat가 끝난 뒤 lock을 해제한다. 각 실행은 direct-session JSON을 읽기 전 manifest부터 `regeneration-in-progress`로 무효화하고, 성공한 산출물이 모두 기록된 뒤에만 `pending-user-approval`을 원자적으로 게시한다. 따라서 동시 실행이나 세션 JSON 파싱·runner 준비 실패가 이전 통과 결과를 승인 가능한 상태로 되돌리지 않는다. 스펙과 direct-session은 UTF-8 원본 바이트를 한 번만 읽어 fatal decode하므로 잘못된 바이트를 대체 문자로 승인하지 않으며, 스펙은 같은 원본 바이트의 SHA-256을 기록한다. 검증된 스펙과 plan·generation·technical QA·candidate/output QA를 deep-freeze하고 runner 호출 전 SHA를 원시값으로 스냅샷해 임계값·권리·레퍼런스·검토 해시·하드 가드 변조를 막는다. Direct-session 후보는 direct-input 기준의 안전한 상대 POSIX 경로만 허용해 절대 로컬 경로가 manifest에 남지 않는다. project·milestone·planner·generator·vision QA·asset label뿐 아니라 비어 있지 않은 권리 범위, exact-shape의 중복 없는 등록된 Netflix 공식 ID–URL 레퍼런스, 각 자산의 공식 레퍼런스 결속을 필수로 검증하며 manifest에도 이를 보존한다. 캐릭터형 `sprite`·`boss`·`cutin`은 `characterIdentity`를 비적용 처리할 수 없다. 스펙의 작업·출력 경로, direct-input 루트와 후보, direct-session 파일, atlas 이름은 저장소 밖이나 저장소 루트 자체를 허용하지 않으며 lexical 경로뿐 아니라 실제 경로를 확인해 심볼릭 링크 탈출도 거부한다. run 디렉터리는 배타적으로 새로 만들고, JSON·정규화 PNG·atlas·게시 이미지는 임의 이름의 `wx` 임시 일반 파일을 만든 뒤 atomic rename하므로 기존 디렉터리·leaf symlink를 따라 외부 파일을 덮지 않는다. Manifest는 atlas PNG와 frame-data JSON의 SHA-256을 모두 기록한다.

M0 캐릭터 시안은 단일 프레임 512×512다. 스펙의 생산 예시인 프레임당 128×128, 6프레임 walk cycle은 아트 승인 뒤 M1에서 확정한다.

## direct-session 형식

```json
{
  "schemaVersion": 1,
  "generator": "codex-app-built-in-imagegen",
  "assets": [
    {
      "assetId": "player_halfbie_concept",
      "prompt": "Codex 앱에서 직접 사용한 최종 프롬프트",
      "attempts": [
        {
          "attempt": 1,
          "prompt": "해당 시도에서 Codex 앱 ImageGen에 직접 전달한 정확한 프롬프트",
          "technicalTransform": "magenta-matte-to-alpha",
          "candidate": "player_halfbie_concept-attempt-01.png",
          "candidateSha256": "원본 PNG의 lowercase SHA-256",
          "visionQa": {
            "assetId": "player_halfbie_concept",
            "reviewedSha256": "기술 변환 후 실제 검토한 PNG의 lowercase SHA-256",
            "dimensions": {
              "sourceFidelity": { "applicable": true, "score": 0.9, "notes": "공식 시즌1 스틸과 교복·프로덕션 디자인 일치" },
              "styleMatch": { "applicable": true, "score": 0.9, "notes": "..." },
              "characterIdentity": { "applicable": true, "score": 0.9, "notes": "..." },
              "topdownAngle": { "applicable": true, "score": 0.9, "notes": "..." },
              "gameplayReadability": { "applicable": true, "score": 0.9, "notes": "..." },
              "animationConsistency": { "applicable": false, "score": 1, "notes": "M0 single frame" }
            },
            "guards": {
              "gore": { "detected": false, "confidence": 0, "notes": "..." },
              "webtoonElements": { "detected": false, "confidence": 0, "notes": "..." },
              "wrongSeasonElements": { "detected": false, "confidence": 0, "notes": "..." }
            },
            "feedback": []
          },
          "outputVisionQa": {
            "assetId": "player_halfbie_concept",
            "reviewedSha256": "normalize/trim된 최종 PNG의 lowercase SHA-256",
            "dimensions": {
              "sourceFidelity": { "applicable": true, "score": 0.9, "notes": "최종 PNG에서도 공식 시즌1 교복과 프로덕션 디자인 일치" },
              "styleMatch": { "applicable": true, "score": 0.9, "notes": "..." },
              "characterIdentity": { "applicable": true, "score": 0.9, "notes": "..." },
              "topdownAngle": { "applicable": true, "score": 0.9, "notes": "..." },
              "gameplayReadability": { "applicable": true, "score": 0.9, "notes": "..." },
              "animationConsistency": { "applicable": false, "score": 1, "notes": "M0 single frame" }
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
