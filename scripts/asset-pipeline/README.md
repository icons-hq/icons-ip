# 효산의 기억 에셋 파이프라인

M0의 플레이어·학생 좀비·급식실 시안 3종을 검토 가능한 산출물로 만드는 파이프라인이다. `asset-spec.yaml`이 단일 정본이며, 사용자 아트 컨펌 전에는 M1 양산이나 Phaser 통합으로 넘어가지 않는다.

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
4. 같은 작업에서 변환 후 이미지를 직접 보고 6개 품질 차원과 3개 하드 가드를 판정해 `outputs/hyosan-memories-m0/direct-session.json`에 기록한다. ImageGen 원본은 `candidateSha256`, 실제 비전 검토본은 `reviewedSha256`으로 묶이며 바이트가 다르면 실행을 거부한다. `sourceFidelity`는 평균과 별도로 0.85 이상이어야 한다. `identity.mode: canonical` 자산은 `characterIdentity >= minCharacterIdentity`도 독립 게이트다.
5. `npm run hyosan:assets:m0`을 실행한다.
6. 기술 QA 또는 비전 점수가 부족하면 같은 앱 작업이 직접 edit/regenerate하고 다음 attempt를 추가한다. 최초 생성을 포함해 최대 3회다.
7. 세 번 모두 soft score만 부족하면 안전 후보 중 `sourceFidelity`를 먼저, 정식 배역은 배우 `characterIdentity`를 다음으로, 평균 점수를 마지막으로 비교해 BEST를 채택하고 warning을 기록한다. 고어·웹툰·시즌2 요소나 기술 QA 실패 후보는 BEST가 될 수 없다. 배우 유사도는 금지 항목이 아니며, 정식 캐릭터에서는 필수 충실도 기준이다.

raw 시도는 gitignored `outputs/`에 남는다. 선택 시안·기술 QA 리포트·atlas·manifest는 사용자 검토를 위해 `docs/games/hyosan-memories-m0-concepts/`에 생성된다. 재실행 시작 시 manifest를 먼저 `regeneration-in-progress`로 무효화하고 성공한 산출물이 모두 기록된 뒤에만 `pending-user-approval`을 원자적으로 게시한다. 따라서 실패한 재실행이 이전 통과 결과를 승인 가능한 상태로 남기지 않는다. 스펙의 작업·출력 경로와 atlas 이름은 저장소 밖 쓰기를 허용하지 않는다.

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
          }
        }
      ]
    }
  ]
}
```
